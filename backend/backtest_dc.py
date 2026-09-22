from itertools import product
import numpy as np
from core import matrice_scores, issue_probas
from backtest import preparer, scores, evaluer

GRILLE_DC = {"demi_vie": [365, 540], "r": [0.5, 1, 2], "r_promu": [10]}

def evaluer_dc(jeux, demi_vie, r, r_promu):
    ps, os_ = [], []
    for d, par_jour, _ in jeux:
        th = None   # démarrage à chaud : on repart de l'ajustement de la veille
        for jour in sorted(par_jour):
            th = d.ajuster_dc(jour, demi_vie, r, r_promu, x0=th)
            for i, j, o in par_jour[jour]:
                lam, nu, rho = d.lambdas_dc(th, i, j)
                ps.append(np.array(issue_probas(matrice_scores(lam, nu, rho))))
                os_.append(o)
    return scores(ps, os_)

if __name__ == "__main__":
    jeux = preparer()
    ll, br = evaluer(jeux, 365, 5, 20)
    print(f"Poisson (365, 5, 20)            : log-loss {ll:.4f} | Brier {br:.4f}\n")
    for dv, r, rp in product(GRILLE_DC["demi_vie"], GRILLE_DC["r"], GRILLE_DC["r_promu"]):
        ll, br = evaluer_dc(jeux, dv, r, rp)
        print(f"DC demi_vie {dv:>3} | R {r} | R_promu {rp:>2} : log-loss {ll:.4f} | Brier {br:.4f}")