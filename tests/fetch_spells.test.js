/**
 * Tests de bout en bout de scripts/fetch_spells.js, contre deux fausses API.
 *
 * La première suppose que `/spells?breedId=N` fonctionne. La seconde reproduit
 * ce qui a été observé en production : ce filtre répond sans erreur mais sans
 * résultat, et c'est la CLASSE qui porte la liste de ses sorts. Le script doit
 * s'en sortir dans les deux cas — et, s'il n'y arrive pas, exposer les champs
 * reçus au lieu de se contenter d'un « aucun sort ».
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

/* --- Schéma nominal : le filtre par classe fonctionne ---------------------- */
{
  const { run, payload, rapport, outDir } = extraire("mock-api.js");
  assert.strictEqual(run.status, 0, `le script doit réussir :\n${rapport}`);

  assert.strictEqual(payload.spells.length, 4, "sorts conservés");
  assert.ok(payload.spells.every((s) => ["iop", "cra"].includes(s.class)),
    "seules les classes demandées sont extraites");
  assert.ok(!payload.spells.some((s) => s.name === "Armure Féca"),
    "une classe non demandée n'est pas extraite");

  // Les paliers sont convertis au format déclaratif du brief.
  const pression = payload.spells.find((s) => s.name === "Pression");
  assert.strictEqual(pression.levels.length, 2, "deux paliers");
  const dernier = pression.levels[1];
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

/* --- Schéma réel : le filtre par classe ne donne rien ----------------------
   Le premier run en production a échoué exactement là, en disant « aucun sort
   renvoyé » sans indiquer par quoi remplacer le filtre. Le script doit
   désormais trouver la liaison tout seul. */
{
  const { run, payload, rapport, outDir } = extraire("mock-api-spells-alt.js");
  assert.strictEqual(run.status, 0, `le script doit réussir malgré le filtre inopérant :\n${rapport}`);

  assert.strictEqual(payload.spells.length, 3, "sorts retrouvés via la liste de la classe");
  assert.ok(/breedSpellsId/.test(rapport), "la piste retenue est annoncée");
  // La fausse API renvoie HTTP 500 sur tout filtre groupé, comme la vraie : si
  // le script en employait un, l'extraction échouerait au lieu d'aboutir.
  assert.ok(!/\$in/.test(rapport), "aucun filtre groupé n'apparaît dans le rapport");

  const parClasse = payload.spells.reduce((acc, s) => {
    acc[s.class] = (acc[s.class] || 0) + 1;
    return acc;
  }, {});
  assert.strictEqual(parClasse.iop, 2, "deux sorts de Iop");
  assert.strictEqual(parClasse.cra, 1, "un sort de Crâ");
  assert.ok(!payload.spells.some((s) => s.name === "Armure Féca"),
    "la classe non demandée reste exclue même par cette piste");

  fs.rmSync(outDir, { recursive: true, force: true });
}

console.log("fetch_spells.test.js : OK");
