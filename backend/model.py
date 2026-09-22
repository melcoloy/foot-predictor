import json
from datetime import datetime, timezone
import numpy as np
from core import DATA_DIR, charger, Donnees, matrice_scores, issue_probas

LIGUES = ["PL", "PD", "BL1", "SA", "FL1"]
SAISON = 2026
DEMI_VIE, R, R_PROMU = 365, 2, 10   # réglés avec backtest_dc.py

def ecrire(nom_fichier, donnees):
    (DATA_DIR / nom_fichier).write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")

def classement(actuelle):
    table = {}
    for m in actuelle:
        for eq, court, logo in ((m["dom"], m.get("court_dom"), m["logo_dom"]),
                                (m["ext"], m.get("court_ext"), m["logo_ext"])):
            if eq and eq not in table:
                table[eq] = {"equipe": eq, "court": court or eq, "logo": logo,
                             "j": 0, "g": 0, "n": 0, "p": 0, "pts": 0, "bp": 0, "bc": 0}
    for m in actuelle:
        if m["statut"] != "FINISHED":
            continue
        d, e = table[m["dom"]], table[m["ext"]]
        bd, be = m["buts_dom"], m["buts_ext"]
        d["j"] += 1; e["j"] += 1
        d["bp"] += bd; d["bc"] += be
        e["bp"] += be; e["bc"] += bd
        if bd > be:
            d["pts"] += 3; d["g"] += 1; e["p"] += 1
        elif bd < be:
            e["pts"] += 3; e["g"] += 1; d["p"] += 1
        else:
            d["pts"] += 1; e["pts"] += 1; d["n"] += 1; e["n"] += 1
    return sorted(table.values(), key=lambda t: (-t["pts"], -(t["bp"] - t["bc"]), -t["bp"]))

def generer():
    t_now = datetime.now(timezone.utc).timestamp() / 86400
    for code in LIGUES:
        actuelle = charger(code, SAISON)
        d = Donnees(charger(code, SAISON - 1), actuelle)
        th = d.ajuster_dc(t_now, DEMI_VIE, R, R_PROMU)
        n = len(d.equipes)

        a_venir = sorted((m for m in actuelle if m["statut"] in ("SCHEDULED", "TIMED")),
                         key=lambda m: m["date"])
        preds = []
        for m in a_venir:
            lam, nu, rho = d.lambdas_dc(th, d.idx[m["dom"]], d.idx[m["ext"]])
            mat = matrice_scores(lam, nu, rho)
            p1, pN, p2 = issue_probas(mat)
            si, sj = np.unravel_index(mat.argmax(), mat.shape)
            infos = {k: m[k] for k in ("date", "journee", "dom", "ext", "court_dom", "court_ext", "logo_dom", "logo_ext")}
            preds.append(infos | {"lambda_dom": round(float(lam), 2), "lambda_ext": round(float(nu), 2),
                                  "p1": round(p1, 3), "pN": round(pN, 3), "p2": round(p2, 3),
                                  "score_probable": f"{si}-{sj}"})
        ecrire(f"predictions_{code}.json", preds)
        ecrire(f"classement_{code}.json", classement(actuelle))

        print(f"\n=== {code} ({len(preds)} matchs) | avantage dom x{np.exp(th[2*n]):.2f} | rho {th[2*n+2]:+.3f} ===")
        for p in preds[:5]:
            print(f"{p['dom']} - {p['ext']} : 1 {p['p1']:.0%} | N {p['pN']:.0%} | 2 {p['p2']:.0%}  ({p['score_probable']})")

if __name__ == "__main__":
    generer()