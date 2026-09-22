import os, requests
from dotenv import load_dotenv

load_dotenv()
H = {"X-Auth-Token": os.getenv("FOOTBALL_API_KEY")}

r = requests.get("https://api.football-data.org/v4/competitions/PL/teams", headers=H)
print("Liste des équipes :", r.status_code)
if r.ok:
    eq = r.json()["teams"][0]
    print(" ->", eq["name"], "| effectif :", len(eq.get("squad") or []), "joueurs")
    print(" -> fondé en", eq.get("founded"), "| stade :", eq.get("venue"), "| couleurs :", eq.get("clubColors"))

    r2 = requests.get(f"https://api.football-data.org/v4/teams/{eq['id']}", headers=H)
    print("Fiche équipe :", r2.status_code, r2.json().get("message", ""))
    if r2.ok:
        squad = r2.json().get("squad") or []
        print(" -> effectif :", len(squad), "joueurs")
        for j in squad[:3]:
            print("   ", j.get("name"), "|", j.get("position"), "|", j.get("nationality"))

r3 = requests.get("https://api.football-data.org/v4/competitions/PL/scorers", headers=H, params={"limit": 5})
print("Buteurs :", r3.status_code, r3.json().get("message", ""))
if r3.ok:
    for s in r3.json()["scorers"]:
        print("   ", s["player"]["name"], "|", s["team"]["shortName"], "|", s.get("goals"), "buts")