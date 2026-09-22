import requests

URL = "https://query.wikidata.org/sparql"
H = {"User-Agent": "FootPredictor/1.0 (projet etudiant)"}
CLUB = "Q9617"   # Arsenal FC

def sparql(requete):
    r = requests.get(URL, headers=H, params={"query": requete, "format": "json"})
    r.raise_for_status()
    return r.json()["results"]["bindings"]

effectif = sparql(f"""
SELECT ?joueurLabel ?posteLabel WHERE {{
  ?joueur p:P54 ?st .
  ?st ps:P54 wd:{CLUB} .
  FILTER NOT EXISTS {{ ?st pq:P582 ?fin }}
  OPTIONAL {{ ?joueur wdt:P413 ?poste }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en". }}
}}""")
print("Effectif :", len(effectif), "joueurs")
for j in effectif[:5]:
    print("   ", j["joueurLabel"]["value"], "|", j.get("posteLabel", {}).get("value", "?"))

palmares = sparql(f"""
SELECT ?competitionLabel (COUNT(DISTINCT ?edition) AS ?titres) (MAX(?annee) AS ?dernier) WHERE {{
  ?edition wdt:P1346 wd:{CLUB} ; wdt:P3450 ?competition .
  OPTIONAL {{ ?edition wdt:P585 ?date BIND(YEAR(?date) AS ?annee) }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en". }}
}} GROUP BY ?competitionLabel ORDER BY DESC(?titres)""")
print("\nPalmarès :", len(palmares), "compétitions")
for p in palmares[:5]:
    print("   ", p["competitionLabel"]["value"], ":", p["titres"]["value"], "titres |", p.get("dernier", {}).get("value", "?"))