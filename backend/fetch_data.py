import os, json, time, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
BASE = "https://api.football-data.org/v4"
HEADERS = {"X-Auth-Token": os.getenv("FOOTBALL_API_KEY")}
LIGUES = {"PL": "Premier League", "PD": "Liga", "BL1": "Bundesliga",
          "SA": "Serie A", "FL1": "Ligue 1", "CL": "Champions League"}
CHAMPIONNATS = ["PL", "PD", "BL1", "SA", "FL1"]
SAISONS = [2026]
PAUSE = 7   # secondes entre deux requêtes (limite : 10 par minute)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

def ecrire(nom_fichier, donnees):
    (DATA_DIR / nom_fichier).write_text(json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")

def api(chemin, **params):
    r = requests.get(f"{BASE}/{chemin}", headers=HEADERS, params=params)
    r.raise_for_status()
    time.sleep(PAUSE)
    return r.json()

def simplifier(m):
    return {
        "id": m["id"],
        "date": m["utcDate"],
        "statut": m["status"],          # FINISHED, SCHEDULED, TIMED...
        "journee": m.get("matchday"),
        "phase": m.get("stage"),        # utile pour la C1
        "dom": m["homeTeam"]["name"],
        "ext": m["awayTeam"]["name"],
        "court_dom": m["homeTeam"].get("shortName") or m["homeTeam"]["name"],
        "court_ext": m["awayTeam"].get("shortName") or m["awayTeam"]["name"],
        "logo_dom": m["homeTeam"].get("crest"),
        "logo_ext": m["awayTeam"].get("crest"),
        "buts_dom": m["score"]["fullTime"]["home"],
        "buts_ext": m["score"]["fullTime"]["away"],
    }

def simplifier_joueur(j, buts):
    return {"nom": j["name"], "poste": j.get("position"),
            "nationalite": j.get("nationality"), "naissance": j.get("dateOfBirth"),
            "buts": buts.get(j["name"], 0)}

def fiche(e, effectif_brut, buts):
    effectif = [simplifier_joueur(j, buts) for j in effectif_brut]
    effectif.sort(key=lambda j: -j["buts"])
    return {
        "nom": e["name"], "court": e.get("shortName") or e["name"], "tla": e.get("tla"),
        "logo": e.get("crest"), "fonde": e.get("founded"), "stade": e.get("venue"),
        "couleurs": e.get("clubColors"), "site": e.get("website"),
        "entraineur": (e.get("coach") or {}).get("name"),
        "effectif": effectif,
    }

def equipes(code, effectifs_connus):
    """Fiches des clubs : identité, effectif, buts marqués dans cette compétition."""
    scorers = api(f"competitions/{code}/scorers", limit=100)["scorers"]
    buts = {s["player"]["name"]: s.get("goals") or 0 for s in scorers}
    fiches = []
    for e in api(f"competitions/{code}/teams")["teams"]:
        brut = e.get("squad") or []
        if not brut:
            brut = effectifs_connus.get(e["name"])          # déjà vu dans un championnat
            if brut is None:
                brut = api(f"teams/{e['id']}").get("squad") or []   # sinon, fiche du club
        effectifs_connus.setdefault(e["name"], brut)
        fiches.append(fiche(e, brut, buts))
    return fiches

if __name__ == "__main__":
    for code, nom in LIGUES.items():
        for saison in SAISONS:
            matchs = [simplifier(m) for m in api(f"competitions/{code}/matches", season=saison)["matches"]]
            ecrire(f"{code}_{saison}.json", matchs)
            joues = sum(m["statut"] == "FINISHED" for m in matchs)
            print(f"{nom} {saison}: {joues} joués / {len(matchs)} au total")

    effectifs_connus = {}
    for code in CHAMPIONNATS + ["CL"]:
        fiches = equipes(code, effectifs_connus)
        ecrire(f"equipes_{code}.json", fiches)
        joueurs = sum(len(f["effectif"]) for f in fiches)
        print(f"{LIGUES[code]}: {len(fiches)} clubs, {joueurs} joueurs")