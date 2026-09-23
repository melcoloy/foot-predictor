import json
from datetime import datetime, timezone
import numpy as np
from core import DATA_DIR, charger, DonneesMulti, matrice_scores, issue_probas

CHAMPIONNATS = ["PL", "PD", "BL1", "SA", "FL1"]
SAISONS = [2024, 2025, 2026]
ACTUELLE = 2026
DEMI_VIE, R, R_PROMU, R_EXT = 365, 2, 10, 5

def ecrire(nom_fichier, donnees):
    (DATA_DIR / nom_fichier).write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")

def equipes_de(matchs):
    return {m[k] for m in matchs for k in ("dom", "ext") if m[k]}

def classement_ligue(matchs):
    """Table de la phase de ligue : 36 équipes, un seul classement."""
    t = {}
    phase = [m for m in matchs if (m.get("phase") or "").startswith("LEAGUE")]
    for m in phase:
        for eq, court, logo in ((m["dom"], m.get("court_dom"), m["logo_dom"]),
                                (m["ext"], m.get("court_ext"), m["logo_ext"])):
            if eq and eq not in t:
                t[eq] = {"equipe": eq, "court": court or eq, "logo": logo,
                         "j": 0, "g": 0, "n": 0, "p": 0, "pts": 0, "bp": 0, "bc": 0}
    for m in phase:
        if m["statut"] != "FINISHED":
            continue
        d, e = t[m["dom"]], t[m["ext"]]
        bd, be = m["buts_dom"], m["buts_ext"]
        d["j"] += 1; e["j"] += 1
        d["bp"] += bd; d["bc"] += be
        e["bp"] += be; e["bc"] += bd
        if bd > be: d["pts"] += 3; d["g"] += 1; e["p"] += 1
        elif bd < be: e["pts"] += 3; e["g"] += 1; d["p"] += 1
        else: d["pts"] += 1; e["pts"] += 1; d["n"] += 1; e["n"] += 1
    return sorted(t.values(), key=lambda x: (-x["pts"], -(x["bp"] - x["bc"]), -x["bp"]))

if __name__ == "__main__":
    # Toutes les compétitions dans un seul jeu de données
    par_comp = {code: [m for s in SAISONS for m in charger(code, s)] for code in CHAMPIONNATS + ["CL"]}

    # Promus : présents en 2026 mais pas en 2025 dans leur championnat
    promues = set()
    for code in CHAMPIONNATS:
        promues |= equipes_de(charger(code, ACTUELLE)) - equipes_de(charger(code, ACTUELLE - 1))

    # Externes : en C1 mais dans aucun des 5 championnats
    domestiques = set().union(*(equipes_de(par_comp[c]) for c in CHAMPIONNATS))
    externes = equipes_de(par_comp["CL"]) - domestiques

    d = DonneesMulti(par_comp, promues, externes)
    print(f"{len(d.equipes)} équipes, dont {len(externes)} hors des 5 championnats")

    t_now = datetime.now(timezone.utc).timestamp() / 86400
    th = d.ajuster(t_now, DEMI_VIE, R, R_PROMU, R_EXT)
    iCL = d.comps.index("CL")
    n, C = len(d.equipes), len(d.comps)
    cl = charger("CL", ACTUELLE)

    print("\nNiveau par compétition (buts moyens, avantage du terrain) :")
    for k, code in enumerate(d.comps):
        print(f"  {code:>4} : mu {np.exp(th[2*n+C+k]):.2f} | domicile x{np.exp(th[2*n+k]):.2f}")

    forces = d.forces_lisibles(th)
    print("\nNiveau moyen des clubs par championnat (attaque ÷ défense, >1 = fort) :")
    for code in CHAMPIONNATS:
        eqs = equipes_de(charger(code, ACTUELLE))
        vals = [forces[e][0] / forces[e][1] for e in eqs if e in forces]
        print(f"  {code:>4} : {np.mean(vals):.2f}")

    print("\nTop 10 des clubs européens selon le modèle :")
    classe = sorted(((forces[e][0] / forces[e][1], e) for e in equipes_de(cl)), reverse=True)
    for v, e in classe[:10]:
        print(f"  {v:.2f}  {e}")

    # Forces des 36 clubs de C1 : permettent de simuler n'importe quelle affiche côté navigateur
    ecrire("forces_cl.json", {
        "mu": float(np.exp(th[2*n+C+iCL])),
        "home": float(np.exp(th[2*n+iCL])),
        "rho": float(th[-1]),
        "equipes": {e: {"att": round(float(np.exp(th[d.idx[e]])), 4),
                        "def": round(float(np.exp(th[n+d.idx[e]])), 4)}
                    for e in equipes_de(cl)},
    })

    # Prédictions des matchs de C1 à venir
    preds = []
    for m in sorted((m for m in cl if m["statut"] in ("SCHEDULED", "TIMED")), key=lambda m: m["date"]):
        lam, nu, rho = d.lambdas(th, d.idx[m["dom"]], d.idx[m["ext"]], iCL)
        mat = matrice_scores(lam, nu, rho)
        p1, pN, p2 = issue_probas(mat)
        si, sj = np.unravel_index(mat.argmax(), mat.shape)
        infos = {k: m[k] for k in ("date", "journee", "phase", "dom", "ext",
                                   "court_dom", "court_ext", "logo_dom", "logo_ext")}
        preds.append(infos | {"lambda_dom": round(float(lam), 2), "lambda_ext": round(float(nu), 2),
                              "p1": round(p1, 3), "pN": round(pN, 3), "p2": round(p2, 3),
                              "score_probable": f"{si}-{sj}"})
    ecrire("predictions_CL.json", preds)
    ecrire("classement_CL.json", classement_ligue(cl))
    print(f"\n{len(preds)} matchs de C1 à venir")
    for p in preds[:5]:
        print(f"  {p['dom']} - {p['ext']} : 1 {p['p1']:.0%} | N {p['pN']:.0%} | 2 {p['p2']:.0%}")