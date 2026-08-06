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

function extraire(mock, args, env) {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "kolizeum-spells-"));
  const run = spawnSync(
    process.execPath,
    ["--require", path.join(__dirname, mock), SCRIPT, "--out", outDir, "--delay", "0", ...(args || [])],
    { encoding: "utf8", cwd: ROOT, env: { ...process.env, ...(env || {}) } }
  );
  const fichier = path.join(outDir, "spells.json");
  const payload = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, "utf8")) : null;
  return { run, payload, rapport: `${run.stdout}\n${run.stderr}`, outDir };
}

/* --- Schéma réel ----------------------------------------------------------- */
{
  const { run, payload, rapport, outDir } = extraire("mock-api.js");
  assert.strictEqual(run.status, 0, `le script doit réussir :\n${rapport}`);

  // 4 sorts listés par les classes demandées + 2 variantes qui n'y figuraient pas.
  assert.strictEqual(payload.spells.length, 6, "sorts conservés");
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

  // Le libellé seul ne dit pas ce que portent diceNum, diceSide et value : un
  // modificateur y range l'identifiant du sort visé, un jet de dommages y range
  // ses bornes. Les trois nombres sont donc conservés, et un exemplaire brut
  // par identifiant non classé figure au rapport.
  assert.deepStrictEqual(degats.dice, { num: 16, side: 20, value: 0 },
    "les trois nombres sources sont conservés");
  assert.ok(/Forme brute d'un exemplaire/.test(rapport), "un exemplaire brut est exposé");
  assert.ok(/9999 \{"effectId":9999/.test(rapport), "avec tous ses champs");
  assert.ok(/Masques de cible rencontrés/.test(rapport), "les masques de cible sont recensés");
  assert.ok(/Formes de zone non décodées/.test(rapport), "les zones inconnues sont listées");

  /* --- Variantes ---------------------------------------------------------
     Le jumeau d'un sort ne figure pas dans `breedSpellsId` : sans découverte,
     la moitié du grimoire manque. Il hérite de la classe de son jumeau, seule
     information de classe dont il dispose. */
  const jumeau = payload.spells.find((s) => s.name === "Pression Éclatée");
  assert.ok(jumeau, "la variante absente de breedSpellsId est ramenée");
  assert.strictEqual(jumeau.class, "iop", "elle hérite de la classe de son jumeau");
  assert.strictEqual(jumeau.levels[0].apCost, 5, "avec ses propres données de jeu");

  assert.strictEqual(pression.variantGroup, jumeau.variantGroup, "même groupe");
  assert.strictEqual(pression.variantRank, 0, "le sort listé par la classe reste le rang 0");
  assert.strictEqual(jumeau.variantRank, 1, "la variante découverte vient après");

  // Un sort dont le groupe ne compte qu'un membre n'est pas un groupe.
  assert.strictEqual(puissance.variantGroup, null, "un sort sans jumeau n'a pas de groupe");

  // La variante d'une AUTRE classe suit la sienne.
  const sombre = payload.spells.find((s) => s.name === "Flèche Sombre");
  assert.strictEqual(sombre.class, "cra", "la variante Crâ reste chez les Crâ");

  assert.strictEqual(payload.meta.counts.variantGroups, 2, "deux groupes de variantes");
  assert.ok(/spell-variants\?breedId/.test(payload.meta.variants.source),
    "la liaison confirmée est celle employée");

  // La collection rend moins de lignes que le `$limit` réclamé. Le seul groupe
  // Iop exploitable étant placé en SECONDE page, sa présence prouve que la
  // pagination s'appuie sur le nombre de lignes reçues et non sur la taille de
  // page demandée — sans quoi la moitié du grimoire manquerait en silence.
  assert.ok(jumeau, "le groupe de la seconde page a bien été lu");

  fs.rmSync(outDir, { recursive: true, force: true });
}

/* --- Repli : pas de collection, un pointeur sur le document de sort ---------
   Si le schéma bouge, la piste du champ numérique doit prendre le relais et
   retrouver le jumeau par un filtre simple sur /spells. */
{
  const { run, payload, rapport, outDir } =
    extraire("mock-api.js", null, { KOLIZEUM_MOCK_VARIANTS: "pointeur" });
  assert.strictEqual(run.status, 0, `le repli doit réussir :\n${rapport}`);

  assert.strictEqual(payload.spells.length, 6, "les jumeaux sont retrouvés sans la collection");
  assert.ok(/spellVariantId/.test(payload.meta.variants.source), "la piste de repli est nommée");
  const jumeau = payload.spells.find((s) => s.name === "Pression Éclatée");
  assert.strictEqual(jumeau.class, "iop", "la classe vient alors du jumeau");
  assert.strictEqual(jumeau.variantRank, 1, "le sort listé par la classe reste devant");

  fs.rmSync(outDir, { recursive: true, force: true });
}

/* --- Aucune variante : l'état de production d'avant --------------------------
   Rien ne relie les sorts entre eux. L'extraction doit RÉUSSIR quand même — le
   grimoire fonctionne comme avant — mais dire ce qui manque et exposer les
   documents bruts, puisque c'est là que se trouve la liaison. */
{
  const { run, payload, rapport, outDir } =
    extraire("mock-api.js", null, { KOLIZEUM_MOCK_VARIANTS: "aucune" });
  assert.strictEqual(run.status, 0, `l'absence de variante n'est pas fatale :\n${rapport}`);

  assert.strictEqual(payload.spells.length, 4, "seuls les sorts listés par la classe");
  assert.ok(payload.spells.every((s) => s.variantGroup === null), "aucun groupe");
  assert.strictEqual(payload.meta.counts.variantGroups, 0, "zéro groupe compté");
  assert.strictEqual(payload.meta.variants.source, null, "aucune liaison trouvée");

  assert.ok(/aucune variante trouvée/.test(rapport), "le manque est nommé");
  assert.ok(/Champs de \/spells\//.test(rapport), "les champs d'un sort sont exposés");
  assert.ok(/Listes de nombres sur la classe/.test(rapport), "les listes de la classe sont exposées");
  assert.ok(payload.meta.variants.tentatives.length >= 3, "chaque piste tentée est consignée");

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

/* --- Piste « liste sur le sort », en unitaire -------------------------------
   La fausse API exerce la piste du pointeur numérique. L'autre forme plausible
   — le document de sort listant lui-même ses jumeaux — se teste directement,
   sans monter une seconde API. */
{
  const { pisteListeSurSort, ajouterGroupe, VARIANT_GROUP_MAX } = require("../scripts/fetch_spells.js");

  const ctx = {
    connus: new Set([10, 20]),
    docs: new Map([
      // Liste qui s'inclut elle-même.
      [10, { id: 10, spellVariants: [10, 11] }],
      // Liste qui ne cite que les jumeaux : le sort doit s'y ajouter.
      [20, { id: 20, variantIds: [21] }],
      // Aucun champ de variante : pas de groupe.
      [30, { id: 30, name: {} }],
    ]),
  };
  const r = pisteListeSurSort(ctx);
  assert.ok(r.source, "la piste aboutit");
  assert.deepStrictEqual(r.groupes.get(10).membres, [10, 11], "groupe reconstitué");
  assert.deepStrictEqual(r.groupes.get(20).membres, [20, 21], "le sort s'ajoute à sa propre liste");
  assert.ok(!r.groupes.has(30), "aucun groupe sans liaison");

  // Le rang 0 revient au membre déjà listé par la classe, quel que soit
  // l'ordre rendu par l'API : le sort proposé par défaut ne doit pas changer
  // sous prétexte que l'extraction s'est enrichie.
  const groupes = new Map();
  ajouterGroupe(groupes, 1, [99, 10], new Set([10]));
  assert.deepStrictEqual(groupes.get(10).membres, [10, 99], "le sort connu passe en tête");

  // Un « groupe » d'un seul membre n'en est pas un ; un groupe démesuré non
  // plus — ce serait le signe d'un filtre ignoré par l'API.
  assert.strictEqual(ajouterGroupe(new Map(), 1, [10], new Set([10])), false, "un membre : refusé");
  const trop = Array.from({ length: VARIANT_GROUP_MAX + 1 }, (_, i) => 100 + i);
  assert.strictEqual(ajouterGroupe(new Map(), 1, trop, new Set([100])), false, "groupe démesuré : refusé");
}

console.log("fetch_spells.test.js : OK");
