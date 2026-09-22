import os, requests
from dotenv import load_dotenv

load_dotenv()
BASE = "https://v3.football.api-sports.io"
H = {"x-apisports-key": os.getenv("API_FOOTBALL_KEY")}
SAISON = 2026   # saison 2026-27

def appel(chemin, **params):
    r = requests.get(f"{BASE}/{chemin}", headers=H, params=params)
    d = r.json()
    if d.get("errors"):
        print(f"  erreurs : {d['errors']}")
    return d

st = appel("status")["response"]
print("Plan :", st["subscription"]["plan"], "| requêtes du jour :",
      st["requests"]["current"], "/", st["requests"]["limit_day"])

eqs = appel("teams", league=39, season=SAISON)["response"]   # 39 = Premier League
print(f"Équipes Premier League {SAISON} :", len(eqs))
if eqs:
    eq = eqs[0]["team"]
    print(" ->", eq["name"], "| id", eq["id"])
    sq = appel("players/squads", team=eq["id"])["response"]
    if sq:
        joueurs = sq[0]["players"]
        print(" -> effectif :", len(joueurs), "joueurs")
        for j in joueurs[:3]:
            print("   ", j["name"], "|", j["position"], "| n°", j.get("number"), "|", j.get("age"), "ans")

buteurs = appel("players/topscorers", league=39, season=SAISON)["response"]
print("Buteurs :", len(buteurs))
for b in buteurs[:3]:
    s = b["statistics"][0]
    print("   ", b["player"]["name"], "|", s["team"]["name"], "|", s["goals"]["total"], "buts")