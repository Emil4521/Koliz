/**
 * Tests du moteur d'équipement (v0.2) : jets, capacité des emplacements,
 * conditions, statistiques totales et bonus de panoplie.
 *
 * Le jeu de données est défini ici, en clair : les tests ne doivent dépendre
 * ni du réseau, ni du contenu de client/data/, qui est regénérable.
 */

"use strict";

const assert = require("assert");
const I = require("../client/items.js");

/* --- Jeu de données de test ------------------------------------------------ */

const fx = (effectId, min, max) => ({ effectId, min, max });

const PAYLOAD = {
  meta: { source: "test", lang: "fr" },
  effects: {
    111: { id: 111, label: "PA", statKey: "pa", confidence: "verifie" },
    115: { id: 115, label: "% Critique", statKey: "critPct", confidence: "verifie" },
    118: { id: 118, label: "Force", statKey: "force", confidence: "verifie" },
    119: { id: 119, label: "Agilité", statKey: "agilite", confidence: "verifie" },
    123: { id: 123, label: "Chance", statKey: "chance", confidence: "verifie" },
    124: { id: 124, label: "Sagesse", statKey: "sagesse", confidence: "verifie" },
    125: { id: 125, label: "Vitalité", statKey: "vitalite", confidence: "verifie" },
    126: { id: 126, label: "Intelligence", statKey: "intelligence", confidence: "verifie" },
    128: { id: 128, label: "PM", statKey: "pm", confidence: "verifie" },
    // Effet dont la signification n'est pas confirmée : jamais cumulé.
    400: { id: 400, label: "Non Échangeable", statKey: null, confidence: "incertain" },
  },
  sets: [{
    id: 1, name: "Panoplie de test", items: [1, 2, 3, 4, 5, 6],
    bonuses: {
      2: [{ effectId: 125, value: 10 }],
      3: [{ effectId: 118, value: 15 }],
      4: [{ effectId: 125, value: 30 }, { effectId: 111, value: 1 }],
    },
  }],
  items: [
    { id: 1, name: "Coiffe de test", slot: "coiffe", level: 20, setId: 1, effects: [fx(125, 20, 40), fx(118, 5, 10)] },
    { id: 2, name: "Cape de test", slot: "cape", level: 20, setId: 1, effects: [fx(125, 15, 30), fx(124, 3, 8)] },
    { id: 3, name: "Amulette de test", slot: "amulette", level: 20, setId: 1, effects: [fx(126, 5, 12), fx(115, 1, 3)] },
    { id: 4, name: "Anneau de test", slot: "anneau", level: 20, setId: 1, effects: [fx(123, 4, 9)] },
    { id: 5, name: "Ceinture de test", slot: "ceinture", level: 20, setId: 1, effects: [fx(119, 6, 14)] },
    { id: 6, name: "Bottes de test", slot: "bottes", level: 20, setId: 1, effects: [fx(128, 1, 1)] },
    { id: 9, name: "Dofus de test", slot: "dofus", level: 100, setId: null, effects: [fx(125, 100, 100)] },
    { id: 13, name: "Coiffe effet inconnu", slot: "coiffe", level: 150, setId: null, effects: [fx(400, 1, 1), fx(125, 50, 60)] },
    { id: 14, name: "Anneau bornes larges", slot: "anneau", level: 40, setId: null, effects: [fx(118, 4, 12)] },
    { id: 15, name: "Épée de test", slot: "arme", level: 30, setId: null, effects: [fx(118, 3, 7)],
      weapon: { apCost: 4, minRange: 1, maxRange: 1, criticalHitProbability: 30 } },
  ],
};

const data = I.indexData(PAYLOAD);
const item = (id) => data.itemById.get(id);
const LEVEL = { level: 200 };

/* --- Jets ------------------------------------------------------------------ */
{
  const rng = I.makeRng("jets");
  for (let n = 0; n < 3000; n++) {
    for (const it of data.items) {
      const roll = I.rollItem(it, rng);
      for (const e of it.effects) {
        const v = roll[e.effectId];
        assert.ok(Number.isInteger(v) && v >= e.min && v <= e.max,
          `jet hors bornes sur ${it.name} : ${v} ∉ [${e.min}, ${e.max}]`);
      }
    }
  }

  // Toute la fourchette doit être atteignable, bornes comprises.
  const seen = new Set();
  for (let n = 0; n < 20000; n++) seen.add(I.rollItem(item(1), rng)[125]);
  assert.strictEqual(seen.size, 21, `distribution incomplète : ${seen.size}/21`);
  assert.ok(seen.has(20) && seen.has(40), "les bornes doivent être atteignables");

  assert.strictEqual(I.rollItem(item(1), null, 0)[125], 20, "qualité 0 → jet minimal");
  assert.strictEqual(I.rollItem(item(1), null, 1)[125], 40, "qualité 1 → jet maximal");
}

/* --- Le jet est figé à l'équipement ---------------------------------------- */
{
  const lo = I.createLoadout();
  const res = I.equip(lo, item(1), { rng: I.makeRng(1) });
  const frozen = JSON.stringify(res.entry.roll);
  for (let n = 0; n < 50; n++) I.computeStats(lo, data, LEVEL);
  assert.strictEqual(JSON.stringify(lo.slots.coiffe[0].roll), frozen, "le jet doit rester figé");
}

/* --- Capacité des emplacements --------------------------------------------- */
{
  const lo = I.createLoadout();
  I.equip(lo, item(4), { rng: I.makeRng(1) });
  assert.strictEqual(I.slotFree(lo, "anneau"), 1, "un anneau libre");

  const dup = I.equip(lo, item(4), { rng: I.makeRng(2) });
  assert.ok(!dup.ok, "doublon du même anneau refusé");

  I.equip(lo, item(14), { rng: I.makeRng(3) });
  assert.strictEqual(lo.slots.anneau.length, 2, "deux anneaux équipés");
  assert.strictEqual(I.slotFree(lo, "anneau"), 0, "plus d'anneau libre");

  const repl = I.equip(lo, item(4), { rng: I.makeRng(4), replaceIndex: 0 });
  assert.ok(repl.ok && lo.slots.anneau.length === 2, "remplacement explicite sans dépassement");

  // Emplacement simple : le nouvel objet remplace l'ancien.
  I.equip(lo, item(1), { rng: I.makeRng(5) });
  I.equip(lo, item(13), { rng: I.makeRng(6) });
  assert.strictEqual(lo.slots.coiffe.length, 1, "une seule coiffe");
  assert.strictEqual(lo.slots.coiffe[0].itemId, 13, "coiffe remplacée");
}

/* --- Conditions de niveau -------------------------------------------------- */
{
  assert.ok(!I.checkRequirements(item(9), { level: 50 }).ok, "niveau insuffisant refusé");
  assert.ok(I.checkRequirements(item(9), { level: 150 }).ok, "niveau suffisant accepté");
}

/* --- Statistiques : objets, panoplie, total séparés ------------------------ */
{
  const lo = I.createLoadout();
  I.equip(lo, item(1), { quality: 1 });      // vitalité 40, force 10
  I.equip(lo, item(3), { quality: 1 });      // intelligence 12, critique 3
  const s = I.computeStats(lo, data, LEVEL);

  assert.strictEqual(s.fromItems.vitalite, 40, "vitalité issue des objets");
  assert.strictEqual(s.fromSets.vitalite, 10, "vitalité issue de la panoplie (2 pièces)");
  assert.strictEqual(s.total.vitalite, 50, "vitalité totale");
  assert.strictEqual(s.total.force, 10, "force totale");
  assert.strictEqual(s.total.intelligence, 12, "intelligence totale");
  assert.strictEqual(s.total.critPct, 3, "critique total");
  assert.strictEqual(s.total.pa, I.BASE_CHARACTER.pa, "PA de base sans bonus");

  const vieBase = I.BASE_CHARACTER.vieBase + 199 * I.BASE_CHARACTER.viePerLevel;
  assert.strictEqual(s.life.base, vieBase, "vie de base au niveau 200");
  assert.strictEqual(s.life.fromVitality, 50, "la vie suit la vitalité totale");
  assert.strictEqual(s.life.total, vieBase + 50, "vie totale");
}

/* --- Panoplies : paliers non cumulatifs ------------------------------------ */
{
  const lo = I.createLoadout();
  I.equip(lo, item(1), { quality: 0 });
  assert.strictEqual(I.activeSets(lo, data).length, 0, "une pièce : aucun bonus");

  I.equip(lo, item(2), { quality: 0 });
  assert.strictEqual(I.activeSets(lo, data)[0].tier, 2, "deux pièces : palier 2");
  assert.strictEqual(I.computeStats(lo, data, LEVEL).fromSets.vitalite, 10, "bonus du palier 2");

  I.equip(lo, item(3), { quality: 0 });
  let s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromSets.force, 15, "palier 3 appliqué");
  assert.strictEqual(s.fromSets.vitalite, 0, "palier 3 : le palier 2 ne s'ajoute pas");

  I.equip(lo, item(4), { quality: 0 });
  s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromSets.vitalite, 30, "palier 4 : vitalité");
  assert.strictEqual(s.fromSets.pa, 1, "palier 4 : PA");
  assert.strictEqual(s.fromSets.force, 0, "palier 4 : le palier 3 ne s'ajoute pas");
  assert.strictEqual(s.total.pa, I.BASE_CHARACTER.pa + 1, "le PA de panoplie s'ajoute à la base");

  // Cinquième pièce sans palier défini : on retient le plus haut palier atteint.
  I.equip(lo, item(5), { quality: 0 });
  const set = I.activeSets(lo, data)[0];
  assert.strictEqual(set.pieces, 5, "cinq pièces portées");
  assert.strictEqual(set.tier, 4, "repli sur le palier 4");
}

/* --- Effets non reconnus : affichés, jamais cumulés ------------------------ */
{
  const lo = I.createLoadout();
  I.equip(lo, item(13), { quality: 1 });
  const s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.total.vitalite, 60, "la vitalité connue est cumulée");
  assert.strictEqual(s.unaggregated.length, 1, "un effet non cumulé");
  assert.strictEqual(s.unaggregated[0].effectId, 400, "effet 400 remonté à part");
  assert.strictEqual(s.unaggregated[0].origin, "Coiffe effet inconnu", "origine indiquée");
}

/* --- Filtrage -------------------------------------------------------------- */
{
  assert.ok(I.filterItems(data, { slot: "anneau" }).every((i) => i.slot === "anneau"), "filtre par emplacement");
  assert.ok(I.filterItems(data, { maxLevel: 30 }).every((i) => i.level <= 30), "filtre par niveau");
  assert.strictEqual(I.filterItems(data, { search: "epee" }).length, 1, "recherche insensible aux accents");
  assert.strictEqual(I.filterItems(data, { search: "ÉPÉE" }).length, 1, "recherche insensible à la casse");

  const sorted = I.filterItems(data, {});
  for (let i = 1; i < sorted.length; i++) {
    assert.ok(sorted[i - 1].level >= sorted[i].level, "tri par niveau décroissant");
  }
}

/* --- Export / import d'un build -------------------------------------------- */
{
  const lo = I.createLoadout();
  const rng = I.makeRng("build");
  for (const id of [1, 2, 3, 4, 14]) I.equip(lo, item(id), { rng });
  const before = JSON.stringify(I.computeStats(lo, data, LEVEL).total);

  const round = I.importLoadout(JSON.parse(JSON.stringify(I.exportLoadout(lo, LEVEL))));
  const after = JSON.stringify(I.computeStats(round, data, LEVEL).total);
  assert.strictEqual(after, before, "aller-retour export/import conserve les statistiques");

  // L'import ne doit jamais dépasser la capacité d'un emplacement.
  const overflow = I.importLoadout({
    slots: { anneau: [{ itemId: 4, roll: {} }, { itemId: 14, roll: {} }, { itemId: 4, roll: {} }] },
  });
  assert.strictEqual(overflow.slots.anneau.length, 2, "import tronqué à la capacité");
}

/* --- Déterminisme par graine ----------------------------------------------- */
{
  const build = (seed) => {
    const lo = I.createLoadout();
    const rng = I.makeRng(seed);
    for (const id of [1, 2, 3, 4, 5, 6]) I.equip(lo, item(id), { rng });
    return JSON.stringify(I.computeStats(lo, data, LEVEL).total);
  };
  assert.strictEqual(build("A"), build("A"), "même graine → même build");
  assert.notStrictEqual(build("A"), build("B"), "graines différentes → builds différents");
}

/* --- Invariant entre les deux modules --------------------------------------
   `scripts/fetch_items.js` produit les `statKey`, `client/items.js` les agrège.
   Une clé connue du premier mais pas du second ne provoque aucune erreur : elle
   fait silencieusement basculer l'effet en « non cumulé ». C'est précisément le
   genre de désynchronisation qu'on ne remarque qu'en relisant des totaux faux. */
{
  const { STAT_BY_LABEL } = require("../scripts/fetch_items.js");
  const connues = new Set(I.ALL_STATS);
  const orphelines = [...new Set(Object.values(STAT_BY_LABEL))].filter((k) => !connues.has(k));
  assert.deepStrictEqual(orphelines, [],
    `statKey produites par l'extraction mais inconnues de items.js : ${orphelines.join(", ")}`);

  // Et l'inverse : une statistique affichée que rien ne peut jamais remplir.
  const produites = new Set(Object.values(STAT_BY_LABEL));
  const jamaisRemplies = I.ALL_STATS.filter((k) => !produites.has(k));
  assert.deepStrictEqual(jamaisRemplies, [],
    `statistiques affichées mais qu'aucun libellé ne produit : ${jamaisRemplies.join(", ")}`);
}

console.log("items.test.js : OK");
