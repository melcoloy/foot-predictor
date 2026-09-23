const LIGUES = [
  { code: "PL", nom: "Premier League", ldc: 4, releg: 3 },
  { code: "PD", nom: "Liga", ldc: 4, releg: 3 },
  { code: "BL1", nom: "Bundesliga", ldc: 4, releg: 2 },
  { code: "SA", nom: "Serie A", ldc: 4, releg: 3 },
  { code: "FL1", nom: "Ligue 1", ldc: 3, releg: 2 },
  { code: "CL", nom: "Ligue des champions", ldc: 8, releg: 12, phaseLigue: true,
    labelTop: "Top 8", labelBas: "Éliminé", labelBasPluriel: "Éliminés" },
];
const PHASES = {
  LEAGUE_STAGE: "Phase de ligue", PLAYOFFS: "Barrages", LAST_16: "Huitièmes",
  QUARTER_FINALS: "Quarts de finale", SEMI_FINALS: "Demi-finales", FINAL: "Finale",
};
const N_SIMS = 10000;
const N_SIMS_C1 = 5000;
const N_SIMS_FICHE = 3000;
const DELAI_LECTURE = 1600;   // ms entre deux journées en lecture automatique
const RENOMMER = { "Brighton Hove": "Brighton" };
const VUES = { pronostics: "vue-pronostics", simulation: "vue-simulation", saison: "vue-saison", equipes: "vue-equipes", pronos: "vue-pronos" };
const GROUPES = [
  ["Gardiens", /keeper|goal/i],
  ["Défenseurs", /back|defen/i],
  ["Milieux", /midfield/i],
  ["Attaquants", /forward|winger|offence|striker|attack/i],
];

const etat = { vue: "pronostics", ligue: "PL", equipe: null, journees: [], index: 0, parJournee: new Map() };
const saison = { ligue: null, classement: [], preds: [], resultats: null, journees: [], etape: 0, timer: null };
const cache = {};
const simCache = {};
let equipesPret = false;

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
const groupePoste = poste => (GROUPES.find(([, re]) => re.test(poste || "")) || ["Autres"])[0];

// Compétitions à élimination directe : on ne simule que la phase de ligue
const matchsLigue = (l, preds) => l.phaseLigue ? preds.filter(p => (p.phase || "").startsWith("LEAGUE")) : preds;
const labelTop = l => l.labelTop || `Top ${l.ldc}`;
const labelBas = l => l.labelBas || "Relégation";
const labelBasPluriel = l => l.labelBasPluriel || "Relégués";
const cleJournee = p => (p.phase && !p.phase.startsWith("LEAGUE"))
  ? (PHASES[p.phase] || p.phase)
  : (p.journee ?? (PHASES[p.phase] || "À venir"));
const rangCle = c => typeof c === "number" ? c : 1000 + Object.values(PHASES).indexOf(c);

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

function age(naissance) {
  if (!naissance) return null;
  const d = new Date(naissance), n = new Date();
  let a = n.getFullYear() - d.getFullYear();
  const m = n.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && n.getDate() < d.getDate())) a--;
  return a;
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
  etat.equipe = null;
  document.querySelectorAll(".ligues button").forEach(b => b.setAttribute("aria-selected", b.dataset.code === code));
  if (majOngletCL()) return;   // l'onglet C1 a disparu : choisirVue a déjà rafraîchi
  rafraichir();
}

async function rafraichir() {
  try {
    if (etat.vue === "pronostics") await afficherPronostics();
    else if (etat.vue === "simulation") await lancerSimulation();
    else if (etat.vue === "saison") await afficherSaison();
    else if (etat.vue === "equipes") await afficherEquipes();
    else await afficherPronos();
  } catch (err) {
    afficherErreur(err);
  }
}

function afficherErreur(err) {
  const zones = { pronostics: "matchs", simulation: "sim-resultats", saison: "s-tableau", equipes: "eq-contenu", pronos: "pr-contenu" };
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
    const cle = cleJournee(p);
    if (!etat.parJournee.has(cle)) etat.parJournee.set(cle, []);
    etat.parJournee.get(cle).push(p);
  }
  etat.journees = [...etat.parJournee.keys()].sort((a, b) => rangCle(a) - rangCle(b));
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
    zone.innerHTML = `<p class="vide">Il n'y a plus de match à venir dans cette compétition.</p>`;
    majBoutons();
    return;
  }
  const j = etat.journees[etat.index];
  titre.textContent = typeof j === "number" ? `Journée ${j}` : j;
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

/* ---------- Vue Simulation ---------- */

function simuler(classement, preds, n) {
  const T = classement.length;
  const idx = new Map(classement.map((e, i) => [e.equipe, i]));
  const matchs = preds
    .filter(p => idx.has(p.dom) && idx.has(p.ext))
    .map(p => [idx.get(p.dom), idx.get(p.ext), p.lambda_dom, p.lambda_ext]);
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
  const classement = await chargerJSON(`classement_${ligue.code}.json`);
  const preds = matchsLigue(ligue, await chargerJSON(`predictions_${ligue.code}.json`));
  const forces = ligue.phaseLigue ? await chargerJSON("forces_cl.json") : null;
  if (ligue.code !== etat.ligue || etat.vue !== "simulation") return;

  const bouton = document.getElementById("lancer");
  bouton.disabled = true;
  document.getElementById("sim-info").textContent = "Simulation en cours…";
  await new Promise(r => setTimeout(r, 30));   // laisse le navigateur afficher le message

  if (ligue.phaseLigue) {
    const resultats = simulerC1(classement, preds, forces, N_SIMS_C1);
    if (ligue.code === etat.ligue) afficherTableauC1(resultats, preds.length);
  } else {
    const resultats = simuler(classement, preds, N_SIMS);
    if (ligue.code === etat.ligue) afficherTableau(resultats, ligue, preds.length);
  }
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
          <th scope="col">1re place</th>
          <th scope="col">${labelTop(ligue)}</th>
          <th scope="col">${labelBas(ligue)}</th>
          <th scope="col">Positions finales</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`;
}

/* ---------- Phase finale de la C1 ---------- */

// Sections de barrages : [tête A, tête B, non-tête A, non-tête B] en positions 0-based
const SECTIONS_PO = [[8, 9, 22, 23], [10, 11, 20, 21], [12, 13, 18, 19], [14, 15, 16, 17]];
// Huitièmes : [tête A, tête B, section de barrage affrontée]
const SECTIONS_R16 = [[0, 1, 3], [2, 3, 2], [4, 5, 1], [6, 7, 0]];

function matchC1(forces, dom, ext, facteur = 1) {
  const a = forces.equipes[dom], b = forces.equipes[ext];
  return [poissonAlea(forces.mu * forces.home * a.att * b.def * facteur),
          poissonAlea(forces.mu * b.att * a.def * facteur)];
}

function duel(forces, tete, autre) {   // la tête de série reçoit au retour
  const [a1, b1] = matchC1(forces, autre, tete);   // aller
  const [a2, b2] = matchC1(forces, tete, autre);   // retour
  let bTete = a2 + b1, bAutre = a1 + b2;
  if (bTete === bAutre) {                          // prolongation au retour
    const [p, q] = matchC1(forces, tete, autre, 1 / 3);
    bTete += p; bAutre += q;
  }
  if (bTete === bAutre) return Math.random() < 0.5 ? tete : autre;   // tirs au but
  return bTete > bAutre ? tete : autre;
}

function phaseFinale(forces, noms) {
  const rang = new Map(noms.map((n, i) => [n, i]));
  const duelR = (a, b) => rang.get(a) < rang.get(b) ? duel(forces, a, b) : duel(forces, b, a);
  const melange = t => Math.random() < 0.5 ? t : [t[1], t[0]];

  const vPO = SECTIONS_PO.map(([s1, s2, u1, u2]) => {
    const [a, b] = melange([u1, u2]);              // tirage : qui affronte qui
    return [duel(forces, noms[s1], noms[a]), duel(forces, noms[s2], noms[b])];
  });
  const h = SECTIONS_R16.map(([t1, t2, po]) => {
    const [x, y] = melange(vPO[po]);
    const [g1, g2] = melange([noms[t1], noms[t2]]);   // répartition dans les deux moitiés
    return [duel(forces, g1, x), duel(forces, g2, y)];
  });

  const huit = [...SECTIONS_R16.flatMap(([t1, t2]) => [noms[t1], noms[t2]]), ...vPO.flat()];
  const quarts = h.flat();
  const demis = [], finalistes = [];
  for (const k of [0, 1]) {                        // une moitié de tableau à la fois
    const q1 = duelR(h[0][k], h[3][k]);            // A contre D
    const q2 = duelR(h[1][k], h[2][k]);            // B contre C
    demis.push(q1, q2);
    finalistes.push(duelR(q1, q2));
  }
  return { huit, quarts, demis, finalistes, titre: finaleRapide(forces, finalistes[0], finalistes[1]) };
}

function simulerC1(classement, preds, forces, n) {
  const T = classement.length;
  const idx = new Map(classement.map((e, i) => [e.equipe, i]));
  const matchs = preds
    .filter(p => idx.has(p.dom) && idx.has(p.ext))
    .map(p => [idx.get(p.dom), idx.get(p.ext), p.lambda_dom, p.lambda_ext]);
  const pts = new Float64Array(T), diff = new Float64Array(T), bp = new Float64Array(T), hasard = new Float64Array(T);
  const st = classement.map(() => ({ ptsTotal: 0, top8: 0, huit: 0, quarts: 0, demis: 0, finale: 0, titre: 0 }));
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
    for (let i = 0; i < T; i++) st[i].ptsTotal += pts[i];
    for (let p = 0; p < 8; p++) st[ordre[p]].top8++;

    const noms = ordre.slice(0, 24).map(i => classement[i].equipe);
    const r = phaseFinale(forces, noms);
    for (const nm of r.huit) st[idx.get(nm)].huit++;
    for (const nm of r.quarts) st[idx.get(nm)].quarts++;
    for (const nm of r.demis) st[idx.get(nm)].demis++;
    for (const nm of r.finalistes) st[idx.get(nm)].finale++;
    st[idx.get(r.titre)].titre++;
  }

  return classement.map((e, i) => ({
    ...e, ptsMoy: st[i].ptsTotal / n,
    top8: st[i].top8 / n, pHuit: st[i].huit / n, pQuarts: st[i].quarts / n,
    pDemis: st[i].demis / n, pFinale: st[i].finale / n, pTitre: st[i].titre / n,
  }));
}

function afficherTableauC1(res, nMatchs) {
  res.sort((a, b) => b.pTitre - a.pTitre || b.ptsMoy - a.ptsMoy);
  document.getElementById("sim-info").textContent =
    `${N_SIMS_C1.toLocaleString("fr-BE")} tournois simulés : ${nMatchs} matchs de phase de ligue, puis barrages, huitièmes, quarts, demies et finale selon le tableau UEFA.`;

  const lignes = res.map((e, i) => `
    <tr>
      <td class="pos">${i + 1}</td>
      <td><div class="eq">${logo(e.logo, 24)}<span>${renommer(e.court)}</span></div></td>
      <td class="num">${e.pts}</td>
      <td class="num fort">${Math.round(e.ptsMoy)}</td>
      ${cellule(e.top8, "--ext")}
      ${cellule(e.pHuit, "--ext")}
      ${cellule(e.pQuarts, "--ext")}
      ${cellule(e.pDemis, "--dom")}
      ${cellule(e.pFinale, "--dom")}
      ${cellule(e.pTitre, "--dom")}
    </tr>`).join("");

  document.getElementById("sim-resultats").innerHTML = `
    <div class="tableau-scroll">
      <table class="sim">
        <thead><tr>
          <th scope="col"><span class="sr">Rang</span></th>
          <th scope="col">Équipe</th>
          <th scope="col">Pts actuels</th>
          <th scope="col">Pts projetés</th>
          <th scope="col" title="Qualifié directement pour les huitièmes">Top 8</th>
          <th scope="col">Huitièmes</th>
          <th scope="col">Quarts</th>
          <th scope="col">Demies</th>
          <th scope="col">Finale</th>
          <th scope="col">Titre</th>
        </tr></thead>
        <tbody>${lignes}</tbody>
      </table>
    </div>`;
}

/* ---------- Vue Ta saison (une seule saison, journée par journée) ---------- */

async function afficherSaison() {
  const ligue = ligueActive();
  const classement = await chargerJSON(`classement_${ligue.code}.json`);
  const preds = matchsLigue(ligue, await chargerJSON(`predictions_${ligue.code}.json`));
  if (ligue.code !== etat.ligue || etat.vue !== "saison") return;
  if (saison.ligue !== ligue.code) {
    const forces = ligue.phaseLigue ? await chargerJSON("forces_cl.json") : null;
    Object.assign(saison, { ligue: ligue.code, classement, preds, forces, resultats: null, journees: [], etape: 0, ko: null });
  }
  rendreSaison();
}

function nouvelleSaison() {
  arreterLecture();
  saison.resultats = new Map();
  for (const p of saison.preds) {
    const cle = p.journee ?? 0;
    if (!saison.resultats.has(cle)) saison.resultats.set(cle, []);
    saison.resultats.get(cle).push({ p, bd: poissonAlea(p.lambda_dom), bx: poissonAlea(p.lambda_ext) });
  }
  saison.journees = [...saison.resultats.keys()].sort((a, b) => a - b);
  saison.etape = 0;
  saison.ko = null;
  saison.etape = 0;
  rendreSaison();
  demarrerLecture();
}

function tableApres(etape) {
  const t = new Map(saison.classement.map(e => [e.equipe, { g: 0, n: 0, p: 0, ...e }]));
  for (let k = 0; k < etape; k++) {
    for (const { p, bd, bx } of saison.resultats.get(saison.journees[k])) {
      const d = t.get(p.dom), x = t.get(p.ext);
      if (!d || !x) continue;
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
  if (saison.ko) { clearInterval(saison.ko.timer); saison.ko.timer = null; }
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

  const prog = document.getElementById("s-progression");
  if (!tire) prog.innerHTML = `Classement actuel`;
  else if (k === 0) prog.innerHTML = `Avant la reprise<small>${nb} journées à jouer</small>`;
  else prog.innerHTML = `Journée ${saison.journees[k - 1]}<small>${k} sur ${nb} jouées</small>`;

  const banniere = document.getElementById("s-banniere");
  if (fin) {
    const premier = table[0];
    const derniers = fmtListe.format(table.slice(T - ligue.releg).map(e => renommer(e.court)));
    banniere.innerHTML = `<p class="banniere"><strong>${renommer(premier.court)} termine en tête</strong> avec ${premier.pts} points. ${labelBasPluriel(ligue)} : ${derniers}.</p>`;
  } else {
    banniere.innerHTML = "";
  }

  document.getElementById("s-resultats").innerHTML = tire && k > 0
    ? `<ul class="resultats">${saison.resultats.get(saison.journees[k - 1]).map(ligneResultat).join("")}</ul>`
    : "";

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
  rendreKO(fin, ligue, table);
}

/* ---------- Vue Équipes ---------- */

function preparerEquipes() {
  if (equipesPret) return;
  equipesPret = true;
  document.getElementById("vue-equipes").addEventListener("click", e => {
    const carte = e.target.closest("[data-club]");
    if (carte) { etat.equipe = carte.dataset.club; afficherEquipes(); return; }
    if (e.target.closest("#eq-retour")) { etat.equipe = null; afficherEquipes(); }
  });
}

async function probasFin(ligue) {
  if (!simCache[ligue.code]) {
    const classement = await chargerJSON(`classement_${ligue.code}.json`);
    const preds = matchsLigue(ligue, await chargerJSON(`predictions_${ligue.code}.json`));
    simCache[ligue.code] = new Map(simuler(classement, preds, N_SIMS_FICHE).map(e => [e.equipe, e]));
  }
  return simCache[ligue.code];
}

function formeRecente(matchs, equipe) {
  return matchs
    .filter(m => m.statut === "FINISHED" && (m.dom === equipe || m.ext === equipe))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-5)
    .map(m => {
      const dom = m.dom === equipe;
      const pour = dom ? m.buts_dom : m.buts_ext;
      const contre = dom ? m.buts_ext : m.buts_dom;
      return {
        issue: pour > contre ? "V" : pour === contre ? "N" : "D",
        detail: `${pour}–${contre} ${dom ? "contre" : "à"} ${renommer(dom ? m.court_ext : m.court_dom)}`,
      };
    });
}

function grilleClubs(classement) {
  return `<div class="eq-grille">${classement.map(e => `
    <button class="eq-carte" data-club="${e.equipe}">
      ${logo(e.logo, 40)}
      <span class="eq-nom">${renommer(e.court)}</span>
      <span class="eq-pts">${e.pts} pts</span>
    </button>`).join("")}</div>`;
}

function ficheClub(f, classement, preds, matchs, palmares, probas, ligue) {
  const T = classement.length;
  const st = classement.find(e => e.equipe === f.nom) || { pts: 0, j: 0, bp: 0, bc: 0 };
  const pos = classement.findIndex(e => e.equipe === f.nom) + 1;
  const pr = probas.get(f.nom);
  const somme = arr => arr.reduce((a, b) => a + b, 0);

  const forme = formeRecente(matchs, f.nom);
  const prochains = preds.filter(p => p.dom === f.nom || p.ext === f.nom).slice(0, 3);
  const stars = new Set(f.effectif.filter(j => j.buts > 0).slice(0, 3).map(j => j.nom));

  const chiffre = (valeur, libelle) => `<div class="chiffre"><b>${valeur}</b><span>${libelle}</span></div>`;

  const blocProbas = pr ? `
    <div class="chiffres">
      ${chiffre(fmtPct(pr.rangs[0]), "1re place")}
      ${chiffre(fmtPct(somme(pr.rangs.slice(0, ligue.ldc))), labelTop(ligue))}
      ${chiffre(fmtPct(somme(pr.rangs.slice(T - ligue.releg))), labelBas(ligue))}
      ${chiffre(rangTexte(pr.rangs.indexOf(Math.max(...pr.rangs)) + 1), "Place probable")}
      ${chiffre(Math.round(pr.ptsMoy), "Points projetés")}
    </div>` : "";

  const blocProchains = prochains.length ? `
    <h3 class="eq-titre">Prochains matchs</h3>
    <ul class="eq-liste">${prochains.map(p => {
      const dom = p.dom === f.nom;
      const proba = dom ? p.p1 : p.p2;
      return `<li>
        <span class="eq-adv">${dom ? "contre" : "à"} ${nom(p, dom ? "ext" : "dom")}</span>
        <span class="eq-date">${fmtJour.format(new Date(p.date))}</span>
        <span class="eq-proba">${fmtPct(proba)} de gagner</span>
      </li>`;
    }).join("")}</ul>` : "";

  const titres = palmares[f.nom];
  const blocPalmares = titres ? `
    <h3 class="eq-titre">Palmarès</h3>
    <ul class="eq-liste">${titres.map(t => `<li>
      <span>${t.titre}</span><span class="eq-date">dernier en ${t.dernier}</span><span class="eq-proba">${t.n}×</span>
    </li>`).join("")}</ul>` : "";

  const effectif = GROUPES.map(([g]) => g).concat("Autres").map(g => {
    const joueurs = f.effectif.filter(j => groupePoste(j.poste) === g);
    if (!joueurs.length) return "";
    return `<div class="poste">
      <h4>${g}</h4>
      <ul>${joueurs.map(j => `<li${stars.has(j.nom) ? ' class="star"' : ""}>
        <span class="j-nom">${stars.has(j.nom) ? "★ " : ""}${j.nom}</span>
        <span class="j-info">${j.nationalite || ""}${age(j.naissance) ? ` · ${age(j.naissance)} ans` : ""}</span>
        ${j.buts ? `<span class="j-buts">${j.buts} but${j.buts > 1 ? "s" : ""}</span>` : ""}
      </li>`).join("")}</ul>
    </div>`;
  }).join("");

  return `
    <button class="bouton-sec" id="eq-retour">‹ Tous les clubs</button>
    <header class="eq-entete">
      ${logo(f.logo, 72)}
      <div>
        <h2>${renommer(f.court)}</h2>
        <p class="eq-meta">${[f.stade, f.fonde && `fondé en ${f.fonde}`, f.entraineur, f.couleurs].filter(Boolean).join(" · ")}</p>
      </div>
    </header>

    <div class="chiffres">
      ${chiffre(rangTexte(pos), "Au classement")}
      ${chiffre(st.pts, "Points")}
      ${chiffre(st.j, "Matchs joués")}
      ${chiffre(signe(st.bp - st.bc), "Différence")}
    </div>

    <h3 class="eq-titre">Forme récente</h3>
    <div class="forme">${forme.length
      ? forme.map(r => `<span class="pastille p-${r.issue}" title="${r.detail}">${r.issue}</span>`).join("")
      : `<span class="eq-meta">Aucun match joué</span>`}</div>

    <h3 class="eq-titre">Fin de saison</h3>
    ${blocProbas}
    ${blocProchains}
    ${blocPalmares}

    <h3 class="eq-titre">Effectif<span class="eq-meta"> — ★ les meilleurs buteurs du club</span></h3>
    <div class="effectif">${effectif}</div>`;
}

async function afficherEquipes() {
  preparerEquipes();
  const ligue = ligueActive();
  const [fiches, classement, preds, matchs, palmares, probas] = await Promise.all([
    chargerJSON(`equipes_${ligue.code}.json`),
    chargerJSON(`classement_${ligue.code}.json`),
    chargerJSON(`predictions_${ligue.code}.json`),
    chargerJSON(`${ligue.code}_2026.json`),
    chargerJSON("palmares.json").catch(() => ({})),
    probasFin(ligue),
  ]);
  if (ligue.code !== etat.ligue || etat.vue !== "equipes") return;

  const parNom = new Map(fiches.map(f => [f.nom, f]));
  document.getElementById("eq-contenu").innerHTML = (etat.equipe && parNom.has(etat.equipe))
    ? ficheClub(parNom.get(etat.equipe), classement, preds, matchs, palmares, probas, ligue)
    : grilleClubs(classement);
}

/* ---------- Démarrage ---------- */

construireNavigation();
majOngletCL();
rafraichir();

/* ---------- Phase finale jouée pas à pas ---------- */

const DELAI_KO = 2200;   // ms entre deux tours

function matchNeutre(forces, a, b, facteur = 1) {   // finale : terrain neutre
  const A = forces.equipes[a], B = forces.equipes[b];
  return [poissonAlea(forces.mu * A.att * B.def * facteur),
          poissonAlea(forces.mu * B.att * A.def * facteur)];
}

function finaleRapide(forces, a, b) {
  let [ga, gb] = matchNeutre(forces, a, b);
  if (ga === gb) { const [p, q] = matchNeutre(forces, a, b, 1 / 3); ga += p; gb += q; }
  if (ga === gb) return Math.random() < 0.5 ? a : b;
  return ga > gb ? a : b;
}

function finaleDetail(forces, a, b) {
  const t = { type: "simple", g: a, d: b };
  let [ga, gb] = matchNeutre(forces, a, b);
  t.score = [ga, gb];
  if (ga === gb) { const [p, q] = matchNeutre(forces, a, b, 1 / 3); ga += p; gb += q; t.prolongation = [p, q]; }
  if (ga === gb) { t.vainqueur = Math.random() < 0.5 ? a : b; t.tab = true; }
  else t.vainqueur = ga > gb ? a : b;
  t.cumul = [ga, gb];
  return t;
}

function duelDetail(forces, tete, autre) {
  const [a1, b1] = matchC1(forces, autre, tete);   // aller chez l'équipe non tête de série
  const [a2, b2] = matchC1(forces, tete, autre);   // retour
  const t = { type: "double", g: tete, d: autre, aller: [b1, a1], retour: [a2, b2] };
  let bt = a2 + b1, ba = a1 + b2;
  if (bt === ba) { const [p, q] = matchC1(forces, tete, autre, 1 / 3); bt += p; ba += q; t.prolongation = [p, q]; }
  if (bt === ba) { t.vainqueur = Math.random() < 0.5 ? tete : autre; t.tab = true; }
  else t.vainqueur = bt > ba ? tete : autre;
  t.cumul = [bt, ba];
  return t;
}

function phaseFinaleDetail(forces, noms) {
  const rang = new Map(noms.map((n, i) => [n, i]));
  const duelR = (a, b) => rang.get(a) < rang.get(b) ? duelDetail(forces, a, b) : duelDetail(forces, b, a);
  const melange = t => Math.random() < 0.5 ? t : [t[1], t[0]];
  const tours = [];

  const barrages = [];
  const vPO = SECTIONS_PO.map(([s1, s2, u1, u2]) => {
    const [a, b] = melange([u1, u2]);              // tirage dans la section
    const d1 = duelDetail(forces, noms[s1], noms[a]);
    const d2 = duelDetail(forces, noms[s2], noms[b]);
    barrages.push(d1, d2);
    return [d1.vainqueur, d2.vainqueur];
  });
  tours.push({ nom: "Barrages", ties: barrages });

  const huitiemes = [];
  const h = SECTIONS_R16.map(([t1, t2, po]) => {
    const [x, y] = melange(vPO[po]);
    const [g1, g2] = melange([noms[t1], noms[t2]]);   // répartition dans les deux moitiés
    const d1 = duelDetail(forces, g1, x), d2 = duelDetail(forces, g2, y);
    huitiemes.push(d1, d2);
    return [d1.vainqueur, d2.vainqueur];
  });
  tours.push({ nom: "Huitièmes de finale", ties: huitiemes });

  const quarts = [], demis = [], finalistes = [];
  for (const k of [0, 1]) {                        // une moitié de tableau à la fois
    const q1 = duelR(h[0][k], h[3][k]);            // A contre D
    const q2 = duelR(h[1][k], h[2][k]);            // B contre C
    quarts.push(q1, q2);
    const s = duelR(q1.vainqueur, q2.vainqueur);
    demis.push(s);
    finalistes.push(s.vainqueur);
  }
  tours.push({ nom: "Quarts de finale", ties: quarts });
  tours.push({ nom: "Demi-finales", ties: demis });
  tours.push({ nom: "Finale", ties: [finaleDetail(forces, finalistes[0], finalistes[1])] });
  return tours;
}

function duelHTML(t, infos) {
  const club = nm => infos.get(nm) || { court: nm, logo: null };
  const gagne = c => t.vainqueur === c ? " gagnant" : "";
  const detail = t.type === "double"
    ? `aller ${t.aller[0]}–${t.aller[1]}, retour ${t.retour[0]}–${t.retour[1]}`
      + (t.prolongation ? `, prol. ${t.prolongation[0]}–${t.prolongation[1]}` : "")
      + (t.tab ? ", tirs au but" : "")
    : `match sec${t.prolongation ? ", prolongation" : ""}${t.tab ? " et tirs au but" : ""}`;
  return `<li class="ko-duel">
    <span class="ko-eq gauche${gagne(t.g)}">${renommer(club(t.g).court)}${logo(club(t.g).logo, 22)}</span>
    <span class="ko-score">${t.cumul[0]}–${t.cumul[1]}</span>
    <span class="ko-eq${gagne(t.d)}">${logo(club(t.d).logo, 22)}${renommer(club(t.d).court)}</span>
    <span class="ko-detail">${detail}</span>
  </li>`;
}

function rendreKO(ligueFinie, ligue, table) {
  const zone = document.getElementById("s-ko");
  if (!ligue.phaseLigue || !ligueFinie) { zone.innerHTML = ""; return; }

  const infos = new Map(saison.classement.map(e => [e.equipe, e]));
  const ko = saison.ko;

  if (!ko) {
    zone.innerHTML = `<h3 class="eq-titre">Phase finale</h3>
      <p class="sim-texte">Les 8 premiers sont qualifiés pour les huitièmes. Les 9e à 24e passent par les barrages, appariés selon le tableau UEFA : 9-10 contre 23-24, 11-12 contre 21-22, 13-14 contre 19-20, 15-16 contre 17-18.</p>
      <button class="bouton" id="ko-jouer">Simuler la phase finale</button>`;
    return;
  }

  const fini = ko.etape >= ko.tours.length;
  const champion = fini ? infos.get(ko.tours.at(-1).ties[0].vainqueur) : null;

  zone.innerHTML = `<h3 class="eq-titre">Phase finale</h3>
    <div class="lecteur">
      <button class="bouton-sec" id="ko-lecture"${fini ? " disabled" : ""}>${ko.timer ? "Pause" : "Lecture"}</button>
      <button class="bouton-sec" id="ko-tout"${fini ? " disabled" : ""}>Tout afficher</button>
      <button class="bouton-sec" id="ko-rejouer">Rejouer la phase finale</button>
    </div>
    ${champion ? `<p class="banniere"><strong>${renommer(champion.court)} remporte la Ligue des champions</strong>.</p>` : ""}
    ${ko.tours.slice(0, ko.etape).map(t =>
      `<h4 class="jour">${t.nom}</h4><ul class="ko-liste">${t.ties.map(x => duelHTML(x, infos)).join("")}</ul>`
    ).join("")}`;
}

function lancerKO() {
  const table = tableApres(saison.journees.length);
  const noms = table.slice(0, 24).map(e => e.equipe);
  saison.ko = { tours: phaseFinaleDetail(saison.forces, noms), etape: 0, timer: null };
  avancerKO(1);
  saison.ko.timer = setInterval(() => {
    avancerKO(1);
    if (saison.ko.etape >= saison.ko.tours.length) { clearInterval(saison.ko.timer); saison.ko.timer = null; rendreSaison(); }
  }, DELAI_KO);
}

function avancerKO(pas) {
  saison.ko.etape = Math.min(saison.ko.etape + pas, saison.ko.tours.length);
  rendreSaison();
}

document.getElementById("s-ko").addEventListener("click", e => {
  if (e.target.closest("#ko-jouer") || e.target.closest("#ko-rejouer")) {
    if (saison.ko?.timer) clearInterval(saison.ko.timer);
    lancerKO();
    return;
  }
  if (e.target.closest("#ko-tout")) {
    if (saison.ko.timer) { clearInterval(saison.ko.timer); saison.ko.timer = null; }
    avancerKO(Infinity);
    return;
  }
  if (e.target.closest("#ko-lecture")) {
    if (saison.ko.timer) { clearInterval(saison.ko.timer); saison.ko.timer = null; rendreSaison(); }
    else {
      saison.ko.timer = setInterval(() => {
        avancerKO(1);
        if (saison.ko.etape >= saison.ko.tours.length) { clearInterval(saison.ko.timer); saison.ko.timer = null; rendreSaison(); }
      }, DELAI_KO);
      avancerKO(1);
    }
  }
});

/* ---------- Ta Ligue des champions : pronostics de l'utilisateur ---------- */

const CLE_PRONOS = "foot-predictor-pronos-cl";
const pro = { preds: [], classement: [], forces: null, picks: {}, bracket: null, seeds: new Map(), pret: false };

const idMatch = p => `${p.dom}|${p.ext}`;
const scoreModele = p => (p.score_probable || "1-1").split("-").map(Number);
const parSec = (ties, s) => ties.filter(t => t.sec === s);
const tousFinis = ties => ties.length > 0 && ties.every(t => t.v);
const melange = t => Math.random() < 0.5 ? t : [t[1], t[0]];
const tds = nm => pro.seeds.has(nm) ? ` <small class="pr-tds">(${pro.seeds.get(nm)})</small>` : "";
const complet = l => l && l.every(x => x !== null && x !== "");

function majOngletCL() {
  const b = document.querySelector('.vues button[data-vue="pronos"]');
  const dispo = !!ligueActive().phaseLigue;
  if (b) b.hidden = !dispo;
  if (!dispo && etat.vue === "pronos") { choisirVue("pronostics"); return true; }
  return false;
}

function proCharger() {
  try {
    const d = JSON.parse(localStorage.getItem(CLE_PRONOS) || "{}");
    pro.picks = d.picks || {};
    pro.bracket = d.bracket || null;
  } catch { pro.picks = {}; pro.bracket = null; }
}

function proSauver() {
  try { localStorage.setItem(CLE_PRONOS, JSON.stringify({ picks: pro.picks, bracket: pro.bracket })); } catch {}
}

function proClassement() {
  const t = new Map(pro.classement.map(e => [e.equipe, { ...e }]));
  for (const p of pro.preds) {
    const d = t.get(p.dom), x = t.get(p.ext);
    if (!d || !x) continue;
    const [bd, be] = pro.picks[idMatch(p)] || scoreModele(p);
    d.j++; x.j++;
    d.bp += bd; d.bc += be; x.bp += be; x.bc += bd;
    if (bd > be) { d.pts += 3; d.g++; x.p++; }
    else if (bd < be) { x.pts += 3; x.g++; d.p++; }
    else { d.pts++; x.pts++; d.n++; x.n++; }
  }
  return [...t.values()].sort((a, b) =>
    b.pts - a.pts || (b.bp - b.bc) - (a.bp - a.bc) || b.bp - a.bp || a.equipe.localeCompare(b.equipe));
}

function probaDuel(a, b, n = 1200) {   // a est tête de série (reçoit au retour)
  let v = 0;
  for (let i = 0; i < n; i++) if (duel(pro.forces, a, b) === a) v++;
  return v / n;
}

// tie : a = tête de série (reçoit au retour), b = adversaire
// l1 = aller chez b [buts b, buts a] ; l2 = retour chez a [buts a, buts b]
function tie(a, b, sec, half, sec_match = false) {
  return { a, b, sec, half, sec_match, l1: [null, null], l2: [null, null], tab: null, v: null,
           p: Math.round(probaDuel(a, b) * 100) };
}

function resoudre(t) {
  if (t.sec_match) {
    if (!complet(t.l1)) { t.v = null; return; }
    const [ga, gb] = t.l1;
    t.v = ga > gb ? t.a : ga < gb ? t.b : t.tab;
    t.cumul = [ga, gb];
    return;
  }
  if (!complet(t.l1) || !complet(t.l2)) { t.v = null; return; }
  const ba = +t.l1[1] + +t.l2[0], bb = +t.l1[0] + +t.l2[1];
  t.cumul = [ba, bb];
  t.v = ba > bb ? t.a : ba < bb ? t.b : t.tab;
}

function ordonne(x, y) {
  return (pro.seeds.get(x) ?? 99) < (pro.seeds.get(y) ?? 99) ? [x, y] : [y, x];
}

function proTirage() {
  const noms = proClassement().slice(0, 24).map(e => e.equipe);
  const po = [];
  SECTIONS_PO.forEach(([s1, s2, u1, u2], sec) => {
    const [x, y] = melange([u1, u2]);              // tirage dans la section
    po.push(tie(noms[s1], noms[x], sec, 0), tie(noms[s2], noms[y], sec, 1));
  });
  pro.bracket = { noms, po, r16: null, qf: null, sf: null, fin: null };
  proSauver();
}

function proSuite() {
  const b = pro.bracket;
  if (!b) return;
  for (const tour of ["po", "r16", "qf", "sf", "fin"]) (b[tour] || []).forEach(resoudre);

  if (!b.r16 && tousFinis(b.po)) {
    b.r16 = [];
    SECTIONS_R16.forEach(([t1, t2, secPO], sec) => {
      const [x, y] = melange(parSec(b.po, secPO).map(t => t.v));
      const [g1, g2] = melange([b.noms[t1], b.noms[t2]]);   // répartition dans les deux moitiés
      b.r16.push(tie(g1, x, sec, 0), tie(g2, y, sec, 1));
    });
  }
  if (b.r16 && !b.qf && tousFinis(b.r16)) {
    const gagnant = (sec, half) => b.r16.find(t => t.sec === sec && t.half === half).v;
    b.qf = [0, 1].flatMap(k => [
      tie(...ordonne(gagnant(0, k), gagnant(3, k)), 0, k),   // A contre D
      tie(...ordonne(gagnant(1, k), gagnant(2, k)), 1, k),   // B contre C
    ]);
  }
  if (b.qf && !b.sf && tousFinis(b.qf)) {
    b.sf = [tie(...ordonne(b.qf[0].v, b.qf[1].v), 0, 0), tie(...ordonne(b.qf[2].v, b.qf[3].v), 0, 1)];
  }
  if (b.sf && !b.fin && tousFinis(b.sf)) {
    b.fin = [tie(...ordonne(b.sf[0].v, b.sf[1].v), 0, 0, true)];   // match sec sur terrain neutre
  }
}

function proClub(nm) {
  return pro.classement.find(e => e.equipe === nm) || { court: nm, logo: null };
}

function nomClub(nm, droite = false) {
  const c = proClub(nm);
  return droite
    ? `${logo(c.logo, 22)}<span>${renommer(c.court)}${tds(nm)}</span>`
    : `<span>${renommer(c.court)}${tds(nm)}</span>${logo(c.logo, 22)}`;
}

function champScore(tour, i, leg, side, valeur) {
  return `<input class="pr-score" type="number" min="0" max="20" inputmode="numeric"
    data-tour="${tour}" data-i="${i}" data-leg="${leg}" data-side="${side}"
    value="${valeur ?? ""}" aria-label="Buts">`;
}

function ligneLeg(t, tour, i, leg, libelle) {
  const dom = leg === 1 ? t.b : t.a;   // le retour se joue chez la tête de série
  const ext = leg === 1 ? t.a : t.b;
  const sc = leg === 1 ? t.l1 : t.l2;
  return `<div class="pr-leg">
    <span class="pr-eq gauche">${nomClub(dom)}</span>
    <span class="pr-saisie">${champScore(tour, i, leg, 0, sc[0])}<b>–</b>${champScore(tour, i, leg, 1, sc[1])}</span>
    <span class="pr-eq droite">${nomClub(ext, true)}</span>
    <span class="pr-leg-nom">${libelle}</span>
  </div>`;
}

function bilanTie(t, tour, i) {
  if (!t.cumul) return `<p class="pr-bilan">Entre les scores pour désigner le qualifié.</p>`;
  const egalite = t.cumul[0] === t.cumul[1];
  if (egalite && !t.v) {
    return `<p class="pr-bilan">Cumul ${t.cumul[0]}–${t.cumul[1]} : qui passe aux tirs au but ?
      <button class="bouton-sec pr-tab" data-tour="${tour}" data-i="${i}" data-tab="${t.a}">${renommer(proClub(t.a).court)}</button>
      <button class="bouton-sec pr-tab" data-tour="${tour}" data-i="${i}" data-tab="${t.b}">${renommer(proClub(t.b).court)}</button></p>`;
  }
  return `<p class="pr-bilan"><b>${renommer(proClub(t.v).court)}</b> qualifié (${t.cumul[0]}–${t.cumul[1]}${egalite ? ", tirs au but" : ""}).</p>`;
}

function tieHTML(t, tour, i) {
  return `<li class="pr-tie">
    <div class="pr-tete">
      <span>${renommer(proClub(t.a).court)}${tds(t.a)} — ${renommer(proClub(t.b).court)}${tds(t.b)}</span>
      <span class="pr-mid" title="Probabilité de qualification selon le modèle">${t.p}\u202F%</span>
    </div>
    ${t.sec_match
      ? `<div class="pr-leg">
          <span class="pr-eq gauche">${nomClub(t.a)}</span>
          <span class="pr-saisie">${champScore(tour, i, 1, 0, t.l1[0])}<b>–</b>${champScore(tour, i, 1, 1, t.l1[1])}</span>
          <span class="pr-eq droite">${nomClub(t.b, true)}</span>
          <span class="pr-leg-nom">terrain neutre</span>
        </div>`
      : ligneLeg(t, tour, i, 1, "aller") + ligneLeg(t, tour, i, 2, "retour")}
    ${bilanTie(t, tour, i)}
  </li>`;
}

function tourHTML(nom, ties, tour) {
  if (!ties) return "";
  return `<h4 class="jour">${nom}</h4><ul class="ko-liste">${ties.map((t, i) => tieHTML(t, tour, i)).join("")}</ul>`;
}

function rendrePronos() {
  const zone = document.getElementById("pr-contenu");
  const b = pro.bracket;
  const table = proClassement();
  pro.seeds = new Map(table.map((e, i) => [e.equipe, i + 1]));
  const remplis = pro.preds.filter(p => pro.picks[idMatch(p)]).length;

  if (!b) {
    const parJ = new Map();
    for (const p of pro.preds) {
      const cle = p.journee ?? 0;
      if (!parJ.has(cle)) parJ.set(cle, []);
      parJ.get(cle).push(p);
    }
    const saisie = p => {
      const sc = pro.picks[idMatch(p)], mod = scoreModele(p);
      const champ = s => `<input class="pr-score" type="number" min="0" max="20" inputmode="numeric"
        data-match="${idMatch(p)}" data-side="${s}" value="${sc ? sc[s] : ""}" placeholder="${mod[s]}" aria-label="Buts">`;
      return `<span class="pr-saisie">${champ(0)}<b>–</b>${champ(1)}</span>`;
    };
    zone.innerHTML = `
      <div class="sim-entete">
        <div>
          <h2>Ta Ligue des champions</h2>
          <p class="sim-texte">Entre le score exact des ${pro.preds.length} matchs restants de la phase de ligue, puis pronostique l'arbre jusqu'à la finale. Les scores grisés sont ceux du modèle, utilisés pour les matchs laissés vides. Tes choix sont conservés dans ce navigateur.</p>
        </div>
        <button class="bouton" id="pr-tirage">Valider et tirer au sort</button>
      </div>
      <p id="sim-info">${remplis} matchs remplis sur ${pro.preds.length}.</p>
      <div class="lecteur">
        <button class="bouton-sec" id="pr-modele">Remplir avec le modèle</button>
        <button class="bouton-sec" id="pr-vider">Tout effacer</button>
      </div>
      ${[...parJ].sort((x, y) => x[0] - y[0]).map(([j, liste]) => `
        <h4 class="jour">Journée ${j}</h4>
        <ul class="ko-liste">${liste.map(p => `<li class="pr-leg">
          <span class="pr-eq gauche"><span>${nom(p, "dom")}</span>${logo(p.logo_dom, 22)}</span>
          ${saisie(p)}
          <span class="pr-eq droite">${logo(p.logo_ext, 22)}<span>${nom(p, "ext")}</span></span>
        </li>`).join("")}</ul>`).join("")}`;
    return;
  }

  proSuite();
  const champion = b.fin?.[0]?.v;
  zone.innerHTML = `
    <div class="sim-entete">
      <div>
        <h2>Ta Ligue des champions</h2>
        <p class="sim-texte">Entre les scores de chaque match : l'équipe à domicile est affichée à gauche, et le retour se joue chez la tête de série. Le numéro entre parenthèses est la place à l'issue de ta phase de ligue. Tirage selon le tableau UEFA : 9-10 contre 23-24, 11-12 contre 21-22, 13-14 contre 19-20, 15-16 contre 17-18.</p>
      </div>
      <button class="bouton-sec" id="pr-retour">Modifier la phase de ligue</button>
    </div>
    ${champion ? `<p class="banniere"><strong>${renommer(proClub(champion).court)} remporte ta Ligue des champions</strong>.</p>` : ""}
    <h4 class="jour">Ton top 8 (qualifié directement pour les huitièmes)</h4>
    <ol class="pr-top8">${table.slice(0, 8).map((e, i) =>
      `<li><span class="pr-tds">${i + 1}</span>${logo(e.logo, 22)}<span>${renommer(e.court)}</span><b>${e.pts}</b></li>`).join("")}</ol>
    ${tourHTML("Barrages", b.po, "po")}
    ${tourHTML("Huitièmes de finale", b.r16, "r16")}
    ${tourHTML("Quarts de finale", b.qf, "qf")}
    ${tourHTML("Demi-finales", b.sf, "sf")}
    ${tourHTML("Finale", b.fin, "fin")}`;
}

function invaliderApres(tour) {
  const suite = ["po", "r16", "qf", "sf", "fin"];
  for (const s of suite.slice(suite.indexOf(tour) + 1)) pro.bracket[s] = null;
}

function preparerPronos() {
  if (pro.pret) return;
  pro.pret = true;
  proCharger();
  const zone = document.getElementById("vue-pronos");

  zone.addEventListener("change", e => {
    const champ = e.target.closest(".pr-score");
    if (!champ) return;
    const val = champ.value === "" ? null : Math.max(0, Math.min(20, +champ.value));

    if (champ.dataset.match) {                       // phase de ligue
      const cle = champ.dataset.match, s = +champ.dataset.side;
      const p = pro.preds.find(x => idMatch(x) === cle);
      const actuel = pro.picks[cle] || [...scoreModele(p)];
      actuel[s] = val;
      if (actuel[0] === null && actuel[1] === null) delete pro.picks[cle];
      else pro.picks[cle] = [actuel[0] ?? scoreModele(p)[0], actuel[1] ?? scoreModele(p)[1]];
    } else {                                         // phase finale
      const { tour, i, leg, side } = champ.dataset;
      const t = pro.bracket[tour][+i];
      (leg === "1" ? t.l1 : t.l2)[+side] = val;
      t.tab = null;
      resoudre(t);
      invaliderApres(tour);
    }
    proSauver(); rendrePronos();
  });

  zone.addEventListener("click", e => {
    const tab = e.target.closest(".pr-tab");
    if (tab) {
      const t = pro.bracket[tab.dataset.tour][+tab.dataset.i];
      t.tab = tab.dataset.tab;
      resoudre(t);
      invaliderApres(tab.dataset.tour);
      proSauver(); rendrePronos(); return;
    }
    if (e.target.closest("#pr-tirage")) { proTirage(); rendrePronos(); return; }
    if (e.target.closest("#pr-retour")) { pro.bracket = null; proSauver(); rendrePronos(); return; }
    if (e.target.closest("#pr-modele")) {
      for (const p of pro.preds) pro.picks[idMatch(p)] = scoreModele(p);
      proSauver(); rendrePronos(); return;
    }
    if (e.target.closest("#pr-vider")) { pro.picks = {}; proSauver(); rendrePronos(); }
  });
}

async function afficherPronos() {
  preparerPronos();
  const ligue = ligueActive();
  pro.classement = await chargerJSON(`classement_${ligue.code}.json`);
  pro.preds = matchsLigue(ligue, await chargerJSON(`predictions_${ligue.code}.json`));
  pro.forces = await chargerJSON("forces_cl.json");
  if (etat.vue !== "pronos") return;
  rendrePronos();
}