import os, json, time, requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()
HEADERS = {"X-Auth-Token": os.getenv("FOOTBALL_API_KEY")}
LIGUES = {"PL": "Premier League", "PD": "Liga", "BL1": "Bundesliga",
          "SA": "Serie A", "FL1": "Ligue 1", "CL": "Champions League"}

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

def simplifier(m):
    return {
        "id": m["id"],
        "date": m["utcDate"],
        "statut": m["status"],          # FINISHED, SCHEDULED, TIMED...
        "journee": m.get("matchday"),
        "phase": m.get("stage"),        # utile pour la C1
        "dom": m["homeTeam"]["name"],
        "ext": m["awayTeam"]["name"],
        "logo_dom": m["homeTeam"].get("crest"),
        "logo_ext": m["awayTeam"].get("crest"),
        "buts_dom": m["score"]["fullTime"]["home"],
        "buts_ext": m["score"]["fullTime"]["away"],
        "court_dom": m["homeTeam"].get("shortName") or m["homeTeam"]["name"],
        "court_ext": m["awayTeam"].get("shortName") or m["awayTeam"]["name"],
    }

SAISONS = [2026]   # 2025 = saison 2025-26, 2026 = saison en cours

for code, nom in LIGUES.items():
    for saison in SAISONS:
        r = requests.get(f"https://api.football-data.org/v4/competitions/{code}/matches",
                         headers=HEADERS, params={"season": saison})
        r.raise_for_status()
        matchs = [simplifier(m) for m in r.json()["matches"]]
        fichier = DATA_DIR / f"{code}_{saison}.json"
        fichier.write_text(json.dumps(matchs, ensure_ascii=False, indent=2), encoding="utf-8")
        joues = sum(m["statut"] == "FINISHED" for m in matchs)
        print(f"{nom} {saison}: {joues} joués / {len(matchs)} au total")
        time.sleep(7)