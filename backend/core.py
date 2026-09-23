import json
from datetime import datetime
from pathlib import Path
import numpy as np
from scipy.stats import poisson
from scipy.optimize import minimize

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
MAX_BUTS = 10
PRIOR_PROMU = (0.85, 1.15)   # (attaque, défense) de départ d'un promu

def charger(code, saison):
    return json.loads((DATA_DIR / f"{code}_{saison}.json").read_text(encoding="utf-8"))

def to_dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00"))

def en_jours(s):
    return to_dt(s).timestamp() / 86400

class Donnees:
    """Matchs joués (saison précédente + saison étudiée) sous forme de tableaux numpy."""
    def __init__(self, ancienne, actuelle):
        tous = ancienne + actuelle
        self.equipes = sorted({m["dom"] for m in tous if m["dom"]} | {m["ext"] for m in tous if m["ext"]})
        self.idx = {e: i for i, e in enumerate(self.equipes)}
        joues = [m for m in tous if m["statut"] == "FINISHED"]
        self.dom = np.array([self.idx[m["dom"]] for m in joues])
        self.ext = np.array([self.idx[m["ext"]] for m in joues])
        self.bd = np.array([m["buts_dom"] for m in joues], dtype=float)
        self.be = np.array([m["buts_ext"] for m in joues], dtype=float)
        self.t = np.array([en_jours(m["date"]) for m in joues])
        avant = {m["dom"] for m in ancienne}
        self.promu = np.array([e not in avant for e in self.equipes])

    # ---------- Modèle 1 : Poisson par moyennes pondérées ----------
    def forces(self, t_ref, demi_vie, k, k_promu):
        m = self.t < t_ref
        dom, ext, bd, be = self.dom[m], self.ext[m], self.bd[m], self.be[m]
        w = 0.5 ** ((t_ref - self.t[m]) / demi_vie)
        moy_dom, moy_ext = np.average(bd, weights=w), np.average(be, weights=w)
        n = len(self.equipes)
        bc = lambda idx, poids: np.bincount(idx, weights=poids, minlength=n)
        att = bc(dom, w * bd / moy_dom) + bc(ext, w * be / moy_ext)
        dfn = bc(dom, w * be / moy_ext) + bc(ext, w * bd / moy_dom)
        sw = bc(dom, w) + bc(ext, w)
        kk = np.where(self.promu, k_promu, k)
        p_att = np.where(self.promu, PRIOR_PROMU[0], 1.0)
        p_def = np.where(self.promu, PRIOR_PROMU[1], 1.0)
        return (att + kk * p_att) / (sw + kk), (dfn + kk * p_def) / (sw + kk), moy_dom, moy_ext

    # ---------- Modèle 2 : Dixon-Coles (maximum de vraisemblance pénalisé) ----------
    def ajuster_dc(self, t_ref, demi_vie, r, r_promu, x0=None):
        """Renvoie theta = [attaques (n), défenses (n), avantage_dom, mu, rho]."""
        m = self.t < t_ref
        hi, ai, x, y = self.dom[m], self.ext[m], self.bd[m], self.be[m]
        w = 0.5 ** ((t_ref - self.t[m]) / demi_vie)
        n = len(self.equipes)
        prior_att = np.where(self.promu, np.log(PRIOR_PROMU[0]), 0.0)
        prior_def = np.where(self.promu, np.log(PRIOR_PROMU[1]), 0.0)
        R = np.where(self.promu, r_promu, r)
        c00, c01 = (x == 0) & (y == 0), (x == 0) & (y == 1)
        c10, c11 = (x == 1) & (y == 0), (x == 1) & (y == 1)
        bc = lambda idx, poids: np.bincount(idx, weights=poids, minlength=n)

        def objectif(th):
            att, dfn, home, mu, rho = th[:n], th[n:2*n], th[2*n], th[2*n+1], th[2*n+2]
            lam = np.exp(mu + home + att[hi] + dfn[ai])   # buts attendus domicile
            nu = np.exp(mu + att[ai] + dfn[hi])           # buts attendus extérieur
            tau = np.ones_like(lam)
            tau[c00] = 1 - lam[c00] * nu[c00] * rho
            tau[c01] = 1 + lam[c01] * rho
            tau[c10] = 1 + nu[c10] * rho
            tau[c11] = 1 - rho
            tau = np.maximum(tau, 1e-10)
            # dérivées de log(tau) par rapport à log(lam), log(nu) et rho
            dl, dn, dr = np.zeros_like(lam), np.zeros_like(lam), np.zeros_like(lam)
            dl[c00] = dn[c00] = -lam[c00] * nu[c00] * rho / tau[c00]
            dr[c00] = -lam[c00] * nu[c00] / tau[c00]
            dl[c01] = lam[c01] * rho / tau[c01]
            dr[c01] = lam[c01] / tau[c01]
            dn[c10] = nu[c10] * rho / tau[c10]
            dr[c10] = nu[c10] / tau[c10]
            dr[c11] = -1 / tau[c11]

            ll = np.sum(w * (x * np.log(lam) - lam + y * np.log(nu) - nu + np.log(tau)))
            ea, ed = att - prior_att, dfn - prior_def
            penalite = np.sum(R * (ea**2 + ed**2))

            gl, gn = w * (x - lam + dl), w * (y - nu + dn)
            g = np.empty_like(th)
            g[:n] = -(bc(hi, gl) + bc(ai, gn)) + 2 * R * ea
            g[n:2*n] = -(bc(ai, gl) + bc(hi, gn)) + 2 * R * ed
            g[2*n] = -gl.sum()
            g[2*n+1] = -(gl.sum() + gn.sum())
            g[2*n+2] = -np.sum(w * dr)
            return -ll + penalite, g

        if x0 is None:
            x0 = np.zeros(2 * n + 3)
            x0[2*n], x0[2*n+1] = 0.1, 0.2
        bornes = [(None, None)] * (2 * n + 2) + [(-0.3, 0.3)]
        return minimize(objectif, x0, jac=True, method="L-BFGS-B", bounds=bornes).x

    def lambdas_dc(self, th, i, j):
        n = len(self.equipes)
        att, dfn, home, mu, rho = th[:n], th[n:2*n], th[2*n], th[2*n+1], th[2*n+2]
        return np.exp(mu + home + att[i] + dfn[j]), np.exp(mu + att[j] + dfn[i]), rho

def matrice_scores(lam_d, lam_e, rho=0.0):
    buts = np.arange(MAX_BUTS + 1)
    mat = np.outer(poisson.pmf(buts, lam_d), poisson.pmf(buts, lam_e))  # [i, j] = P(i-j)
    mat[0, 0] *= 1 - lam_d * lam_e * rho
    mat[0, 1] *= 1 + lam_d * rho
    mat[1, 0] *= 1 + lam_e * rho
    mat[1, 1] *= 1 - rho
    return mat / mat.sum()

def issue_probas(mat):
    return float(np.tril(mat, -1).sum()), float(np.trace(mat)), float(np.triu(mat, 1).sum())

class DonneesMulti:
    """Plusieurs compétitions à la fois : forces d'équipe communes, niveau et avantage du terrain par compétition."""

    def __init__(self, matchs_par_comp, promues=(), externes=()):
        self.comps = list(matchs_par_comp)
        promues, externes = set(promues), set(externes)
        paires = [(c, m) for c, code in enumerate(self.comps) for m in matchs_par_comp[code]]
        self.equipes = sorted({m[k] for _, m in paires for k in ("dom", "ext") if m[k]})
        self.idx = {e: i for i, e in enumerate(self.equipes)}
        joues = [(c, m) for c, m in paires if m["statut"] == "FINISHED"]
        self.comp = np.array([c for c, _ in joues])
        self.dom = np.array([self.idx[m["dom"]] for _, m in joues])
        self.ext = np.array([self.idx[m["ext"]] for _, m in joues])
        self.bd = np.array([m["buts_dom"] for _, m in joues], dtype=float)
        self.be = np.array([m["buts_ext"] for _, m in joues], dtype=float)
        self.t = np.array([en_jours(m["date"]) for _, m in joues])
        self.promu = np.array([e in promues for e in self.equipes])
        self.externe = np.array([e in externes for e in self.equipes])

    def ajuster(self, t_ref, demi_vie, r, r_promu, r_externe, x0=None):
        """theta = [attaques (n), défenses (n), avantage_dom (C), mu (C), rho]."""
        m = self.t < t_ref
        hi, ai, ci, x, y = self.dom[m], self.ext[m], self.comp[m], self.bd[m], self.be[m]
        w = 0.5 ** ((t_ref - self.t[m]) / demi_vie)
        n, C = len(self.equipes), len(self.comps)
        prior_att = np.where(self.promu, np.log(PRIOR_PROMU[0]), 0.0)
        prior_def = np.where(self.promu, np.log(PRIOR_PROMU[1]), 0.0)
        R = np.where(self.externe, r_externe, np.where(self.promu, r_promu, r))
        c00, c01 = (x == 0) & (y == 0), (x == 0) & (y == 1)
        c10, c11 = (x == 1) & (y == 0), (x == 1) & (y == 1)
        bt = lambda idx, poids: np.bincount(idx, weights=poids, minlength=n)
        bk = lambda idx, poids: np.bincount(idx, weights=poids, minlength=C)

        def objectif(th):
            att, dfn = th[:n], th[n:2*n]
            home, mu, rho = th[2*n:2*n+C], th[2*n+C:2*n+2*C], th[-1]
            lam = np.exp(mu[ci] + home[ci] + att[hi] + dfn[ai])
            nu = np.exp(mu[ci] + att[ai] + dfn[hi])
            tau = np.ones_like(lam)
            tau[c00] = 1 - lam[c00] * nu[c00] * rho
            tau[c01] = 1 + lam[c01] * rho
            tau[c10] = 1 + nu[c10] * rho
            tau[c11] = 1 - rho
            tau = np.maximum(tau, 1e-10)
            dl, dn, dr = np.zeros_like(lam), np.zeros_like(lam), np.zeros_like(lam)
            dl[c00] = dn[c00] = -lam[c00] * nu[c00] * rho / tau[c00]
            dr[c00] = -lam[c00] * nu[c00] / tau[c00]
            dl[c01] = lam[c01] * rho / tau[c01]
            dr[c01] = lam[c01] / tau[c01]
            dn[c10] = nu[c10] * rho / tau[c10]
            dr[c10] = nu[c10] / tau[c10]
            dr[c11] = -1 / tau[c11]

            ll = np.sum(w * (x * np.log(lam) - lam + y * np.log(nu) - nu + np.log(tau)))
            ea, ed = att - prior_att, dfn - prior_def
            penalite = np.sum(R * (ea**2 + ed**2))

            gl, gn = w * (x - lam + dl), w * (y - nu + dn)
            g = np.empty_like(th)
            g[:n] = -(bt(hi, gl) + bt(ai, gn)) + 2 * R * ea
            g[n:2*n] = -(bt(ai, gl) + bt(hi, gn)) + 2 * R * ed
            g[2*n:2*n+C] = -bk(ci, gl)
            g[2*n+C:2*n+2*C] = -(bk(ci, gl) + bk(ci, gn))
            g[-1] = -np.sum(w * dr)
            return -ll + penalite, g

        if x0 is None:
            x0 = np.zeros(2 * n + 2 * C + 1)
            x0[2*n:2*n+C] = 0.1
            x0[2*n+C:2*n+2*C] = 0.2
        bornes = [(None, None)] * (2 * n + 2 * C) + [(-0.3, 0.3)]
        return minimize(objectif, x0, jac=True, method="L-BFGS-B", bounds=bornes).x

    def lambdas(self, th, i, j, c):
        n, C = len(self.equipes), len(self.comps)
        att, dfn = th[:n], th[n:2*n]
        home, mu, rho = th[2*n:2*n+C], th[2*n+C:2*n+2*C], th[-1]
        return np.exp(mu[c] + home[c] + att[i] + dfn[j]), np.exp(mu[c] + att[j] + dfn[i]), rho

    def forces_lisibles(self, th):
        n = len(self.equipes)
        return {e: (float(np.exp(th[i])), float(np.exp(th[n+i]))) for i, e in enumerate(self.equipes)}