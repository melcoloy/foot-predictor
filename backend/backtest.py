from itertools import product
import numpy as np
from core import charger, Donnees, en_jours, matrice_scores, issue_probas

LIGUES = ["PL", "PD", "BL1", "SA", "FL1"]
SAISON_TEST = 2025
GRILLE = {"demi_vie": [365, 540, 730, 1000], "k": [2, 5], "k_promu": [20, 30, 50]}

def issue(m):
    return 0 if m["buts_dom"] > m["buts_ext"] else 1 if m["buts_dom"] == m["buts_ext"] else 2

def preparer():
    jeux = []
    for code in LIGUES:
        ancienne, test = charger(code, SAISON_TEST - 1), charger(code, SAISON_TEST)
        d = Donnees(ancienne, test)
        par_jour = {}
        for m in test:
            if m["statut"] == "FINISHED":
                jour = np.floor(en_jours(m["date"]))
                par_jour.setdefault(jour, []).append((d.idx[m["dom"]], d.idx[m["ext"]], issue(m)))
        # référence naïve : fréquences 1/N/2 de la saison précédente
        freq = np.bincount([issue(m) for m in ancienne if m["statut"] == "FINISHED"], minlength=3)
        jeux.append((d, par_jour, freq / freq.sum()))
    return jeux

def scores(liste_p, liste_o):
    p, o = np.array(liste_p), np.eye(3)[liste_o]
    logloss = -np.mean(np.log(np.clip((p * o).sum(axis=1), 1e-12, 1)))
    brier = np.mean(((p - o) ** 2).sum(axis=1))
    return logloss, brier

def evaluer(jeux, demi_vie, k, k_promu):
    ps, os_ = [], []
    for d, par_jour, _ in jeux:
        for jour, matchs in par_jour.items():
            att, dfn, md, me = d.forces(jour, demi_vie, k, k_promu)
            for i, j, o in matchs:
                p = np.array(issue_probas(matrice_scores(md * att[i] * dfn[j], me * att[j] * dfn[i])))
                ps.append(p / p.sum())
                os_.append(o)
    return scores(ps, os_)

def reference(jeux):
    ps, os_ = [], []
    for _, par_jour, freq in jeux:
        for matchs in par_jour.values():
            for _, _, o in matchs:
                ps.append(freq)
                os_.append(o)
    return scores(ps, os_)

if __name__ == "__main__":
    jeux = preparer()
    ll_ref, br_ref = reference(jeux)
    print(f"Référence naïve      : log-loss {ll_ref:.4f} | Brier {br_ref:.4f}\n")

    resultats = []
    for dv, k, kp in product(GRILLE["demi_vie"], GRILLE["k"], GRILLE["k_promu"]):
        ll, br = evaluer(jeux, dv, k, kp)
        resultats.append((ll, br, dv, k, kp))
    resultats.sort()
    print("Top 5 (trié par log-loss) :")
    for ll, br, dv, k, kp in resultats[:5]:
        print(f"demi_vie {dv:>3} | K {k:>2} | K_promu {kp:>2} : log-loss {ll:.4f} | Brier {br:.4f}")

    ll, br = evaluer(jeux, 180, 5, 5)
    print(f"\nAnciens réglages     : log-loss {ll:.4f} | Brier {br:.4f}")