/**
 * Tests de bout en bout de scripts/fetch_spells.js, contre deux fausses API.
 *
 * La première reproduit le schéma RÉEL de DofusDB, établi en interrogeant
 * l'API à la main : la classe liste ses sorts dans `breedSpellsId`, le nom
 * vient de `/spells/<id>` et les données de jeu de `/spell-levels?spellId=N`.
 * Aucun filtre groupé n'est accepté.
 *
 * La seconde est dégradée — la classe ne porte aucune liste — pour vérifier
 * que le script expose les champs reçus au lieu d'un « aucun sort » muet, ce
 * qui avait coûté deux runs en production.
 */

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts", "fetch_spells.js");

function extraire(mock, args) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolizeum-spells-"));
  const run = spawnSync(
    process.execPath,
    ["--require", path.join(__dirname, mock), SCRIPT, "--out", outDir, "--delay", "0", ...(args || [])],
    { encoding: "utf8", cwd: ROOT }
  );
  const fichier = path.join(outDir, "spells.json");
  const payload = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, "utf8")) : null;
  return { run, payload, rapport: `${run.stdout}\n${run.stderr}`, outDir };
}

/* --- Schéma réel ----------------------------------------------------------- */
{
  const { run, payload, rapport, outDir } = extraire("mock-api.js");
  assert.strictEqual(run.status, 0, `le script doit réussir :\n${rapport}`);

  assert.strictEqual(payload.spells.length, 4, "sorts conservés");
  assert.ok(/breedSpellsId/.test(rapport), "la liaison passe par breedSpellsId");
  assert.ok(/sans palier/.test(rapport), "un sort sans palier est signalé, pas fatal");
  assert.ok(payload.spells.every((s) => ["iop", "cra"].includes(s.class)),
    "seules les classes demandées sont extraites");
  assert.ok(!payload.spells.some((s) => s.name === "Armure Féca"),
    "une classe non demandée n'est pas extraite");

  // Seul le palier MAXIMAL est conservé : garder les six paliers multiplierait
  // le volume et la complexité sans rien apporter au 1v1 de haut niveau.
  const pression = payload.spells.find((s) => s.name === "Pression");
  assert.strictEqual(pression.levels.length, 1, "un seul palier conservé");
  const dernier = pression.levels[0];
  assert.strictEqual(dernier.level, 6, "c'est bien le palier le plus haut");
  assert.strictEqual(pression.description, "Frappe de près.",
    "la description vient de /spells/<id>, l'autre requête");
  assert.strictEqual(dernier.apCost, 4, "coût en PA");
  assert.deepStrictEqual(dernier.ranges, [{ min: 1, max: 1 }], "portée");
  assert.strictEqual(dernier.lineOfSight, true, "ligne de vue requise");
  assert.strictEqual(dernier.zones[0].type, "point", "zone décodée");

  // Classification des effets.
  const degats = dernier.effects[0];
  assert.strictEqual(degats.kind, "damage", "dommages reconnus");
  assert.strictEqual(degats.element, "terre", "élément reconnu");
  assert.deepStrictEqual([degats.min, degats.max], [16, 20], "bornes du jet");

  // Un effet portant une statistique ET une durée est un boost.
  const puissance = payload.spells.find((s) => s.name === "Puissance");
  const boost = puissance.levels[0].effects[0];
  assert.strictEqual(boost.kind, "boost", "boost reconnu");
  assert.strictEqual(boost.statKey, "force", "statistique du boost");
  assert.strictEqual(boost.duration, 3, "durée du boost");

  // Zones et effets non reconnus : signalés, jamais devinés.
  const exotique = payload.spells.find((s) => s.name === "Sort Exotique");
  const niveau = exotique.levels[0];
  assert.strictEqual(niveau.zones[0].type, "inconnue", "forme de zone non décodée");
  assert.ok(niveau.effects.some((e) => e.kind === null), "effet non classé conservé");
  assert.ok(niveau.effects.some((e) => e.kind === "heal"), "soins reconnus");
  assert.ok(niveau.effects.some((e) => e.kind === "shield"), "bouclier reconnu");
  assert.ok(niveau.effects.some((e) => e.kind === "drainPm"), "retrait PM reconnu");

  assert.ok(/non classés/.test(rapport), "les effets non classés sont listés");
  assert.ok(/Formes de zone non décodées/.test(rapport), "les zones inconnues sont listées");
  fs.rmSync(outDir, { recursive: true, force: true });
}

/* --- Schéma dégradé : aucune liste de sorts sur la classe -------------------
   Le script doit exposer les champs reçus et échouer proprement, jamais rendre
   un « aucun sort » sans explication. */
{
  const { run, rapport, outDir } = extraire("mock-api-spells-alt.js");
  assert.notStrictEqual(run.status, 0, "l'extraction doit échouer explicitement");

  assert.ok(/aucune liste de sorts/.test(rapport), "le manque est nommé");
  assert.ok(/Champs d'une classe/.test(rapport), "les champs reçus sont exposés");
  assert.ok(/someOtherField/.test(rapport), "le contenu réel du document est montré");
  assert.ok(!/\$in/.test(rapport), "aucun filtre groupé n'est employé");

  fs.rmSync(outDir, { recursive: true, force: true });
}

console.log("fetch_spells.test.js : OK");
