/**
 * Tests de bout en bout de scripts/fetch_items.js.
 *
 * L'API DofusDB n'est pas sollicitée : `tests/mock-api.js` est préchargé et
 * remplace fetch par une fausse API respectant le schéma FeathersJS de DofusDB
 * (pagination $limit/$skip, textes i18n, possibleEffects, panoplies indexées
 * par nombre de pièces). Sont vérifiés la pagination, le classement par
 * emplacement, la normalisation des bornes et les niveaux de confiance.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "fetch_items.js");
const MOCK = path.join(__dirname, "mock-api.js");

/* --- Résolution des libellés : cas relevés dans une extraction réelle -------
   L'API écrit « Dommage Air » quand la table dit « Dommages Air » : le « s »
   est au PREMIER mot. Une tolérance limitée à la fin de chaîne laissait ces
   effets hors de tous les totaux, sans rien signaler. */
{
  const { statKeyForLabel, labelsMatch } = require("../scripts/fetch_items.js");

  const attendus = {
    "Dommage Air": "domAir", "Dommage Critiques": "domCrit", "Soin": "soins",
    "Invocation": "invocations", "Tacle": "tacle", "Portée": "po",
    "% Critique": "critPct", "Vitalité": "vitalite", "PA": "pa",
    "Dommage Terre": "domTerre", "% Résistance Terre": "resPctTerre",
    "Résistance Feu": "resFixeFeu", "Vol de vie": "volVie",
  };
  for (const [label, key] of Object.entries(attendus)) {
    assert.strictEqual(statKeyForLabel(label), key, `« ${label} » doit résoudre vers ${key}`);
  }

  // La tolérance ne doit pas fusionner des effets réellement distincts.
  assert.ok(!labelsMatch("Dommage Air", "Dommage Feu"), "les éléments restent distincts");
  assert.ok(!labelsMatch("Force", "Fuite"), "deux stats proches restent distinctes");
  assert.ok(!labelsMatch("% Critique", "% Coup Critique"), "une vraie divergence reste signalée");
  assert.ok(labelsMatch("Soin", "Soins"), "singulier et pluriel équivalents");
  assert.ok(labelsMatch("Dommages Critiques", "Dommage Critiques"), "pluriel sur le premier mot");
}

/* --- Panoplies : les deux formes de schéma acceptées -----------------------
   Une extraction réelle a rendu zéro panoplie exploitable : le champ des
   paliers ne porte pas toujours le même nom ni la même forme. */
{
  const { transformSet } = require("../scripts/fetch_items.js");
  const opts = { lang: "fr" };

  // Forme tableau : l'indice 0 correspond au palier « 2 pièces ».
  const tableau = transformSet({
    id: 1, name: { fr: "P" }, items: [1, 2],
    effects: [[{ effectId: 125, diceNum: 10, diceSide: 0 }], []],
  }, opts);
  assert.deepStrictEqual(tableau.bonuses, { 2: [{ effectId: 125, value: 10 }] }, "forme tableau");

  // Forme objet : la clé EST le nombre de pièces.
  const objet = transformSet({
    id: 2, name: { fr: "Q" }, items: [3, 4],
    effects: { 3: [{ effectId: 118, diceNum: 15, diceSide: 0 }] },
  }, opts);
  assert.deepStrictEqual(objet.bonuses, { 3: [{ effectId: 118, value: 15 }] }, "forme objet");

  // Champ nommé autrement.
  const alt = transformSet({
    id: 3, name: { fr: "R" }, items: [5],
    bonuses: [[{ effectId: 128, diceNum: 1, diceSide: 0 }]],
  }, opts);
  assert.deepStrictEqual(alt.bonuses, { 2: [{ effectId: 128, value: 1 }] }, "champ alternatif");

  // Absence totale de paliers : ni exception, ni bonus inventé.
  assert.deepStrictEqual(transformSet({ id: 4, name: { fr: "S" } }, opts).bonuses, {}, "aucun palier");
}

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolizeum-fetch-"));

// Une taille de page volontairement petite force plusieurs tours de pagination.
const run = spawnSync(
  process.execPath,
  ["--require", MOCK, SCRIPT, "--out", outDir, "--delay", "0", "--page-size", "4"],
  { encoding: "utf8", cwd: ROOT }
);
assert.strictEqual(run.status, 0, `le script doit réussir :\n${run.stderr}`);

// Les avertissements passent par console.warn : le rapport complet réunit les
// deux flux.
const report = `${run.stdout}\n${run.stderr}`;

const payload = JSON.parse(fs.readFileSync(path.join(outDir, "items.json"), "utf8"));
const byId = new Map(payload.items.map((i) => [i.id, i]));

/* --- Fichiers produits ----------------------------------------------------- */
{
  for (const file of ["items.json", "items.data.js", "effects-map.json"]) {
    assert.ok(fs.existsSync(path.join(outDir, file)), `${file} doit être écrit`);
  }
  const js = fs.readFileSync(path.join(outDir, "items.data.js"), "utf8");
  assert.ok(js.startsWith("window.KOLIZEUM_ITEMS = "), "variante file:// exploitable");
}

/* --- Pagination : tout est récupéré malgré des pages de 4 ------------------ */
{
  // 14 objets dans la fausse API, dont 1 hors type d'équipement (filtré côté
  // requête) et 1 sans effet utile (filtré à la transformation).
  assert.strictEqual(payload.items.length, 12, "objets conservés");
  assert.strictEqual(payload.meta.counts.effects, 15, "effets récupérés");
  assert.strictEqual(payload.sets.length, 1, "panoplies conservées");
}

/* --- Classement par emplacement -------------------------------------------- */
{
  const slots = payload.meta.slotCounts;
  assert.strictEqual(slots.arme, 2, "épée et arc classés en arme");
  assert.strictEqual(slots.anneau, 2, "anneaux classés");
  assert.ok(!("autre" in slots), "aucun objet non classé conservé");
  assert.ok(!byId.has(11), "objet de type Ressource écarté");
  assert.ok(!byId.has(12), "objet sans effet utile écarté");
}

/* --- Normalisation des bornes ---------------------------------------------- */
{
  // La fausse API fournit diceNum=12, diceSide=4 : les bornes doivent être remises
  // dans l'ordre plutôt que de produire une fourchette vide.
  assert.deepStrictEqual(byId.get(14).effects, [{ effectId: 118, min: 4, max: 12 }],
    "bornes inversées corrigées");

  // diceSide nul signale une valeur fixe.
  assert.deepStrictEqual(byId.get(9).effects, [{ effectId: 125, min: 100, max: 100 }],
    "valeur fixe");
}

/* --- Champs d'arme --------------------------------------------------------- */
{
  const epee = byId.get(7).weapon;
  assert.strictEqual(epee.apCost, 4, "coût en PA");
  assert.strictEqual(epee.maxRange, 1, "portée maximale");
  assert.strictEqual(epee.twoHanded, false, "arme à une main");

  const arc = byId.get(8).weapon;
  assert.strictEqual(arc.minRange, 2, "portée minimale");
  assert.strictEqual(arc.maxRange, 7, "portée maximale");
  assert.strictEqual(arc.twoHanded, true, "arme à deux mains");
}

/* --- Panoplies : bonus indexés par nombre de pièces ------------------------ */
{
  const bonuses = payload.sets[0].bonuses;
  assert.deepStrictEqual(bonuses["2"], [{ effectId: 125, value: 10 }], "palier 2 pièces");
  assert.deepStrictEqual(bonuses["3"], [{ effectId: 118, value: 15 }], "palier 3 pièces");
  assert.strictEqual(bonuses["4"].length, 2, "palier 4 pièces");
  assert.ok(!("6" in bonuses), "paliers vides écartés");
}

/* --- Accolades imbriquées dans les gabarits --------------------------------
   Régression observée en production : les gabarits réels imbriquent les
   accolades, et une extraction en une passe laissait des orphelines
   (« } Vitalité », « } Dommage } } »), ce qui cassait toute la résolution
   vers les statistiques agrégées. */
{
  const e = payload.effects;
  for (const [id, attendu] of [[125, "Vitalité"], [118, "Force"], [111, "PA"], [112, "Dommage"]]) {
    assert.strictEqual(e[id].label, attendu, `libellé de l'effet ${id}`);
    assert.ok(!/[{}]/.test(e[id].label), `aucune accolade résiduelle sur ${id}`);
  }
}

/* --- Niveaux de confiance -------------------------------------------------- */
{
  const e = payload.effects;
  assert.strictEqual(e[125].confidence, "verifie", "API et table concordantes");
  assert.strictEqual(e[210].confidence, "probable", "dérivé de l'API seule");
  assert.strictEqual(e[158].confidence, "probable", "hors table de recoupement");

  // Singulier contre pluriel : variation d'écriture, pas divergence de sens.
  assert.strictEqual(e[112].confidence, "verifie", "« Dommage » vaut « Dommages »");

  // Vraie divergence : la table attend « % Critique », l'API dit « % Coup Critique ».
  assert.strictEqual(e[115].confidence, "incertain", "divergence de sens signalée");
  assert.ok(payload.meta.warnings.some((w) => /115/.test(w)), "divergence reportée dans meta");
  assert.ok(/115/.test(report), "divergence affichée à l'utilisateur");
}

/* --- Libellés et statistiques agrégées ------------------------------------- */
{
  const e = payload.effects;
  assert.strictEqual(e[125].statKey, "vitalite", "statistique agrégée résolue");
  assert.strictEqual(e[112].statKey, "domFixe", "le singulier résout vers la même statistique");
  assert.strictEqual(e[210].statKey, "resPctTerre", "résistance en pourcentage");
  assert.strictEqual(e[240].statKey, "resFixeFeu", "résistance fixe");
  assert.strictEqual(e[400].statKey, null, "effet sans statistique agrégée");
}

/* --- Rapport à l'utilisateur ----------------------------------------------- */
{
  assert.ok(/Ressource/.test(report), "types non classés signalés");
  assert.ok(/Potion/.test(report), "types non classés listés");
}

fs.rmSync(outDir, { recursive: true, force: true });
console.log("fetch_items.test.js : OK");
