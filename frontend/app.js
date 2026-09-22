const LIGUES = [
  { code: "PL", nom: "Premier League", ldc: 4, releg: 3 },
  { code: "PD", nom: "Liga", ldc: 4, releg: 3 },
  { code: "BL1", nom: "Bundesliga", ldc: 4, releg: 2 },
  { code: "SA", nom: "Serie A", ldc: 4, releg: 3 },
  { code: "FL1", nom: "Ligue 1", ldc: 3, releg: 2 },
];
const N_SIMS = 10000;
const DELAI_LECTURE = 1600;   // ms entre deux journées en lecture automatique
const RENOMMER = { "Brighton Hove": "Brighton" };
const VUES = { pronostics: "vue-pronostics", simulation: "vue-simulation", saison: "vue-saison" };

const etat = { vue: "pronostics", ligue: "PL", journees: [], index: 0, parJournee: new Map() };
const saison = { ligue: null, classement: [], preds: [], resultats: null, journees: [], etape: 0, timer: null };
const cache = {};

const fmtPct = p => Math.round(p * 100) + "\u202F%";
const fmtNb = x => x.toLocaleString("fr-BE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmtJour = new Intl.DateTimeFormat("fr-BE", { weekday: "long", day: "numeric", month: "long" });
const fmtHeure = new Intl.DateTimeFormat("fr-BE", { hour: "2-digit", minute: "2-digit" });
const fmtListe = new Intl.ListFormat("fr", { type: "conjunction" });
const renommer = n => RENOMMER[n] || n;
const nom = (p, cote) => renommer(p[`court_${cote}`] || p[cote]);
const rangTexte = n => (n === 1 ? "1er" : `${n}e`);
const signe = n => (n > 0 ? `+${n}` : `${n}`);
const ligueActive = () => LIGUES.find(l => l.code === etat.ligue);
const mouvementReduit = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

async function chargerJSON(fichier) {
  if (!cache[fichier]) {
        const r = await fetch(`../data/${fichier}?v=${Math.floor(Date.now() / 3.6e6)}`);
    if (!r.ok) throw new Error(`${fichier} : HTTP ${r.status}`);
    cache[fichier] = await r.json();
  }
  return cache[fichier];
}

function logo(url, taille = 32) {
  return url
    ? `<img src="${url}" alt="" width="${taille}" height="${taille}" loading="lazy">`
    : `<span class="logo-vide"></span>`;
}

function poissonAlea(lambda) {   // tirage d'une loi de Poisson (méthode de Knuth)
  const L = Math.exp(-lambda);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

/* ---------- Navigation ---------- */

function construireNavigation() {
  const nav = document.querySelector(".ligues");
  nav.innerHTML = LIGUES.map(l =>
    `<button role="tab" data-code="${l.code}" aria-selected="${l.code === etat.ligue}">${l.nom}</button>`
  ).join("");
  nav.addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) choisirLigue(b.dataset.code);
  });
  document.querySelector(".vues").addEventListener("click", e => {
    const b = e.target.closest("button");
    if (b) choisirVue(b.dataset.vue);
  });
  document.getElementById("prec").addEventListener("click", () => { etat.index--; afficherJournee(); });
  document.getElementById("suiv").addEventListener("click", () => { etat.index++; afficherJournee(); });
  document.getElementById("lancer").addEventListener("click", () => rafraichir());
  document.getElementById("jouer").addEventListener("click", nouvelleSaison);
  document.getElementById("s-prec").addEventListener("click", () => { arreterLecture(); avancer(-1); });
  document.getElementById("s-suiv").addEventListener("click", () => { arreterLecture(); avancer(1); });
  document.getElementById("s-lecture").addEventListener("click", basculerLecture);
  document.getElementById("s-fin").addEventListener("click", () => { arreterLecture(); avancer(Infinity); });
}

function choisirVue(vue) {
  if (vue !== "saison") arreterLecture();
  etat.vue = vue;
  document.querySelectorAll(".vues button").forEach(b => b.setAttribute("aria-pressed", b.dataset.vue === vue));
  for (const [v, id] of Object.entries(VUES)) document.getElementById(id).hidden = v !== vue;
  rafraichir();
}

function choisirLigue(code) {
  arreterLecture();
  etat.ligue = code;
  document.querySelectorAll(".ligues button").forEach(b => b.setAttribute("aria-selected", b.dataset.code === code));
  rafraichir();
}

async function rafraichir() {
  try {
    if (etat.vue === "pronostics") await afficherPronostics();
    else if (etat.vue === "simulation") await lancerSimulation();
    else await afficherSaison();
  } catch (err) {
    afficherErreur(err);
  }
}

function afficherErreur(err) {
  const zones = { pronostics: "matchs", simulation: "sim-resultats", saison: "s-tableau" };
  if (etat.vue === "pronostics") {
    document.getElementById("titre-journee").textContent = "Prédictions indisponibles";
    etat.journees = [];
    majBoutons();
  }
  document.getElementById("lancer").disabled = false;
  document.getElementById(zones[etat.vue]).innerHTML = `<p class="erreur">Un fichier de données n'a pas pu être chargé (${err.message}).
    Lance <code>python backend/update.py</code>, puis ouvre le site via <code>python -m http.server</code> depuis le dossier du projet.</p>`;
}

/* ---------- Vue Pronostics ---------- */

async function afficherPronostics() {
  const preds = await chargerJSON(`predictions_${etat.ligue}.json`);
  etat.parJournee = new Map();
  for (const p of preds) {
    if (!etat.parJournee.has(p.journee)) etat.parJournee.set(p.journee, []);
    etat.parJournee.get(p.journee).push(p);
  }
  etat.journees = [...etat.parJournee.keys()].sort((a, b) => a - b);
  etat.index = 0;
  afficherJournee();
}

function segment(classe, p, fort) {
  const pct = p * 100;
  const texte = pct >= 14 ? fmtPct(p) : "";
  return `<span class="seg ${classe}${fort ? " fort" : ""}" style="width:${pct}%">${texte}</span>`;
}

function carteMatch(p) {
  const max = Math.max(p.p1, p.pN, p.p2);
  const dom = nom(p, "dom"), ext = nom(p, "ext");
  const resume = `Victoire ${dom} ${fmtPct(p.p1)}, nul ${fmtPct(p.pN)}, victoire ${ext} ${fmtPct(p.p2)}`;
  return `
    <article class="match">
      <div class="equipe dom"><span class="nom">${dom}</span>${logo(p.logo_dom)}</div>
      <div class="centre">
        <time datetime="${p.date}">${fmtHeure.format(new Date(p.date))}</time>
        <div class="barre" role="img" aria-label="${resume}">
          ${segment("s1", p.p1, p.p1 === max)}${segment("sN", p.pN, p.pN === max)}${segment("s2", p.p2, p.p2 === max)}
        </div>
        <p class="details">Buts attendus ${fmtNb(p.lambda_dom)} – ${fmtNb(p.lambda_ext)}<span class="sep"></span>Score le plus probable ${p.score_probable}</p>
      </div>
      <div class="equipe ext">${logo(p.logo_ext)}<span class="nom">${ext}</span></div>
    </article>`;
}

function afficherJournee() {
  const zone = document.getElementById("matchs");
  const titre = document.getElementById("titre-journee");
  if (!etat.journees.length) {
    titre.textContent = "Saison terminée";
    zone.innerHTML = `<p class="vide">Il n'y a plus de match à venir dans ce championnat.</p>`;
    majBoutons();
    return;
  }
  const j = etat.journees[etat.index];
  titre.textContent = `Journée ${j}`;
  const jours = new Map();
  for (const p of etat.parJournee.get(j)) {
    const cle = fmtJour.format(new Date(p.date));
    if (!jours.has(cle)) jours.set(cle, []);
    jours.get(cle).push(p);
  }
  zone.innerHTML = [...jours].map(([jour, liste]) =>
    `<h3 class="jour">${jour}</h3>${liste.map(carteMatch).join("")}`
  ).join("");
  majBoutons();
}

function majBoutons() {
  document.getElementById("prec").disabled = etat.index === 0;
  document.getElementById("suiv").disabled = etat.index >= etat.journees.length - 1;
}

/* ---------- Vue Simulation (10 000 saisons) ---------- */

function simuler(classement, preds, n) {
  const T = classement.length;
  const idx = new Map(classement.map((e, i) => [e.equipe, i]));
  const matchs = preds.map(p => [idx.get(p.dom), idx.get(p.ext), p.lambda_dom, p.lambda_ext]);
  const pts = new Float64Array(T), diff = new Float64Array(T), bp = new Float64Array(T), hasard = new Float64Array(T);
  const rangs = Array.from({ length: T }, () => new Float64Array(T));
  const ptsTotal = new Float64Array(T);
  const ordre = [...Array(T).keys()];

  for (let s = 0; s < n; s++) {
    for (let i = 0; i < T; i++) {
      const e = classement[i];
      pts[i] = e.pts; diff[i] = e.bp - e.bc; bp[i] = e.bp; hasard[i] = Math.random();
    }
    for (const [d, x, ld, lx] of matchs) {
      const bd = poissonAlea(ld), bx = poissonAlea(lx);
      bp[d] += bd; bp[x] += bx;
      diff[d] += bd - bx; diff[x] += bx - bd;
      if (bd > bx) pts[d] += 3;
      else if (bd < bx) pts[x] += 3;
      else { pts[d] += 1; pts[x] += 1; }
    }
    ordre.sort((a, b) => pts[b] - pts[a] || diff[b] - diff[a] || bp[b] - bp[a] || hasard[b] - hasard[a]);
    ordre.forEach((eq, pos) => { rangs[eq][pos]++; });
    for (let i = 0; i < T; i++) ptsTotal[i] += pts[i];
  }
  return classement.map((e, i) => ({ ...e, ptsMoy: ptsTotal[i] / n, rangs: Array.from(rangs[i], c => c / n) }));
}

async function lancerSimulation() {
  const ligue = ligueActive();
  const [classement, preds] = await Promise.all([
    chargerJSON(`classement_${ligue.code}.json`),
    chargerJSON(`predictions_${ligue.code}.json`),
  ]);
  if (ligue.code !== etat.ligue || etat.vue !== "simulation") return;

  const bouton = document.getElementById("lancer");
  bouton.disabled = true;
  document.getElementById("sim-info").textContent = "Simulation en cours…";
  await new Promise(r => setTimeout(r, 30));   // laisse le navigateur afficher le message

  const resultats = simuler(classement, preds, N_SIMS);
  if (ligue.code === etat.ligue) afficherTableau(resultats, ligue, preds.length);
  bouton.disabled = false;
}

function cellule(p, couleur) {
  const texte = p === 0 ? "–" : p < 0.005 ? "<1\u202F%" : fmtPct(p);
  const fonce = p > 0.45 ? " fonce" : "";
  return `<td class="proba${fonce}" style="--c: var(${couleur}); --a: ${Math.round(p * 100)}%">${texte}</td>`;
}

function histogramme(rangs, ligue) {
  const T = rangs.length, max = Math.max(...rangs);
  const barres = rangs.map((p, pos) => {
    const zone = pos === 0 ? "z-titre" : pos < ligue.ldc ? "z-ldc" : pos >= T - ligue.releg ? "z-rel" : "z-milieu";
    return `<span class="${zone}" style="height:${(p / max) * 100}%" title="${rangTexte(pos + 1)} : ${fmtPct(p)}"></span>`;
  }).join("");
  const probable = rangTexte(rangs.indexOf(max) + 1);
  return `<td class="histo-cell"><div class="histo" role="img" aria-label="Position la plus probable : ${probable}">${barres}</div></td>`;
}

function afficherTableau(res, ligue, nMatchs) {
  const T = res.length;
  const somme = arr => arr.reduce((a, b) => a + b, 0);
  res.sort((a, b) => b.ptsMoy - a.ptsMoy);
  document.getElementById("sim-info").textContent =
    `${N_SIMS.toLocaleString("fr-BE")} saisons simulées à partir des ${nMatchs} matchs restants.`;

  const lignes = res.map((e, i) => `
    <tr>
      <td class="pos">${i + 1}</td>
      <td><div class="eq">${logo(e.logo, 24)}<span>${renommer(e.court)}</span></div></td>
      <td class="num">${e.pts}</td>
      <td class="num fort">${Math.round(e.ptsMoy)}</td>
      ${cellule(e.rangs[0], "--dom")}
      ${cellule(somme(e.rangs.slice(0, ligue.ldc)), "--ext")}
      ${cellule(somme(e.rangs.slice(T - ligue.releg)), "--rel")}
      ${histogramme(e.rangs, ligue)}
    </tr>`).join("");

  document.getElementById("sim-resultats").innerHTML = `
    <div class="tableau-scroll">
      <table class="sim">
        <thead><tr>
          <th scope="col"><span class="sr">Rang projeté</span></th>
          <th scope="col">Équipe</th>
          <th scope="col">Pts actuels</th>
          <th scope="col">Pts projetés</th>
          <th scope="col">Titre</th>
          <th scope="col">Top ${ligue.ldc}</th>
          <th scope="col">Relégation</th>
          <th scope="col">Positions finales</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`;
}

/* ---------- Vue Ta saison (une seule saison, journée par journée) ---------- */

async function afficherSaison() {
  const ligue = ligueActive();
  const [classement, preds] = await Promise.all([
    chargerJSON(`classement_${ligue.code}.json`),
    chargerJSON(`predictions_${ligue.code}.json`),
  ]);
  if (ligue.code !== etat.ligue || etat.vue !== "saison") return;
  if (saison.ligue !== ligue.code) {
    Object.assign(saison, { ligue: ligue.code, classement, preds, resultats: null, journees: [], etape: 0 });
  }
  rendreSaison();
}

function nouvelleSaison() {
  arreterLecture();
  saison.resultats = new Map();
  for (const p of saison.preds) {
    if (!saison.resultats.has(p.journee)) saison.resultats.set(p.journee, []);
    saison.resultats.get(p.journee).push({ p, bd: poissonAlea(p.lambda_dom), bx: poissonAlea(p.lambda_ext) });
  }
  saison.journees = [...saison.resultats.keys()].sort((a, b) => a - b);
  saison.etape = 0;
  rendreSaison();
  demarrerLecture();
}

function tableApres(etape) {
  const t = new Map(saison.classement.map(e => [e.equipe, { g: 0, n: 0, p: 0, ...e }]));
  for (let k = 0; k < etape; k++) {
    for (const { p, bd, bx } of saison.resultats.get(saison.journees[k])) {
      const d = t.get(p.dom), x = t.get(p.ext);
      d.j++; x.j++;
      d.bp += bd; d.bc += bx; x.bp += bx; x.bc += bd;
      if (bd > bx) { d.pts += 3; d.g++; x.p++; }
      else if (bd < bx) { x.pts += 3; x.g++; d.p++; }
      else { d.pts++; x.pts++; d.n++; x.n++; }
    }
  }
  return [...t.values()].sort((a, b) =>
    b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp || a.equipe.localeCompare(b.equipe));
}

function avancer(pas) {
  saison.etape = Math.min(Math.max(saison.etape + pas, 0), saison.journees.length);
  rendreSaison();
}

function demarrerLecture() {
  if (!saison.resultats) return;
  if (saison.etape >= saison.journees.length) saison.etape = 0;
  saison.timer = setInterval(() => {
    avancer(1);
    if (saison.etape >= saison.journees.length) arreterLecture();
  }, DELAI_LECTURE);
  majLecteur();
}

function arreterLecture() {
  clearInterval(saison.timer);
  saison.timer = null;
  majLecteur();
}

function basculerLecture() {
  if (saison.timer) arreterLecture();
  else demarrerLecture();
}

function majLecteur() {
  const tire = !!saison.resultats, nb = saison.journees.length;
  document.getElementById("lecteur").hidden = !tire;
  document.getElementById("jouer").textContent = tire ? "Rejouer une saison" : "Jouer la fin de saison";
  document.getElementById("s-lecture").textContent = saison.timer ? "Pause" : "Lecture";
  document.getElementById("s-prec").disabled = saison.etape === 0;
  document.getElementById("s-suiv").disabled = saison.etape >= nb;
  document.getElementById("s-fin").disabled = saison.etape >= nb;
}

function ligneResultat({ p, bd, bx }) {
  const issue = bd > bx ? "v-dom" : bd < bx ? "v-ext" : "nul";
  return `<li class="res ${issue}">
    <span class="r-dom">${nom(p, "dom")}</span>${logo(p.logo_dom, 20)}
    <span class="score">${bd}–${bx}</span>
    ${logo(p.logo_ext, 20)}<span class="r-ext">${nom(p, "ext")}</span>
  </li>`;
}

function rendreSaison() {
  const ligue = ligueActive();
  const T = saison.classement.length;
  const tire = !!saison.resultats, nb = saison.journees.length, k = saison.etape;
  const fin = tire && k === nb;
  const table = tire ? tableApres(k) : tableApres(0);
  const rangAvant = tire && k > 0 ? new Map(tableApres(k - 1).map((e, i) => [e.equipe, i])) : null;

  // En-tête de progression
  const prog = document.getElementById("s-progression");
  if (!tire) prog.innerHTML = `Classement actuel`;
  else if (k === 0) prog.innerHTML = `Avant la reprise<small>${nb} journées à jouer</small>`;
  else prog.innerHTML = `Journée ${saison.journees[k - 1]}<small>${k} sur ${nb} jouées</small>`;

  // Bannière de fin
  const banniere = document.getElementById("s-banniere");
  if (fin) {
    const champion = table[0];
    const relegues = fmtListe.format(table.slice(T - ligue.releg).map(e => renommer(e.court)));
    banniere.innerHTML = `<p class="banniere"><strong>${renommer(champion.court)} champion</strong> avec ${champion.pts} points. Relégués : ${relegues}.</p>`;
  } else {
    banniere.innerHTML = "";
  }

  // Résultats de la journée affichée
  document.getElementById("s-resultats").innerHTML = tire && k > 0
    ? `<ul class="resultats">${saison.resultats.get(saison.journees[k - 1]).map(ligneResultat).join("")}</ul>`
    : "";

  // Classement, avec animation des changements de place
  const zone = document.getElementById("s-tableau");
  const avant = new Map([...zone.querySelectorAll("tr[data-equipe]")]
    .map(r => [r.dataset.equipe, r.getBoundingClientRect().top]));

  const lignes = table.map((e, i) => {
    const classeZone = i === 0 ? "z-titre" : i < ligue.ldc ? "z-ldc" : i >= T - ligue.releg ? "z-rel" : "";
    let mouv = "";
    if (rangAvant) {
      const d = rangAvant.get(e.equipe) - i;
      if (d > 0) mouv = `<span class="monte" title="Gagne ${d} place${d > 1 ? "s" : ""}">▲${d}</span>`;
      if (d < 0) mouv = `<span class="descend" title="Perd ${-d} place${d < -1 ? "s" : ""}">▼${-d}</span>`;
    }
    return `<tr data-equipe="${e.equipe}" class="${classeZone}">
      <td class="pos">${i + 1}</td>
      <td class="mouv">${mouv}</td>
      <td><div class="eq">${logo(e.logo, 24)}<span>${renommer(e.court)}</span></div></td>
      <td>${e.j}</td><td>${e.g}</td><td>${e.n}</td><td>${e.p}</td>
      <td>${e.bp}:${e.bc}</td>
      <td>${signe(e.bp - e.bc)}</td>
      <td class="num fort">${e.pts}</td>
    </tr>`;
  }).join("");

  zone.innerHTML = `
    <div class="tableau-scroll">
      <table class="sim">
        <thead><tr>
          <th scope="col"><span class="sr">Position</span></th>
          <th scope="col"><span class="sr">Évolution</span></th>
          <th scope="col">Équipe</th>
          <th scope="col" title="Matchs joués">J</th>
          <th scope="col" title="Victoires">V</th>
          <th scope="col" title="Nuls">N</th>
          <th scope="col" title="Défaites">D</th>
          <th scope="col" title="Buts pour : buts contre">Buts</th>
          <th scope="col" title="Différence de buts">Diff</th>
          <th scope="col">Pts</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`;

  // Animation FLIP : chaque ligne glisse depuis son ancienne position
  if (!mouvementReduit() && avant.size) {
    for (const r of zone.querySelectorAll("tr[data-equipe]")) {
      const dy = avant.get(r.dataset.equipe) - r.getBoundingClientRect().top;
      if (dy) r.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
                        { duration: 600, easing: "cubic-bezier(.2, .8, .2, 1)" });
    }
  }
  majLecteur();
}

/* ---------- Démarrage ---------- */

construireNavigation();
rafraichir();