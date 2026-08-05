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

/* --- Points de caractéristiques -------------------------------------------- */
{
  // 5 points par niveau, du niveau 2 au niveau 200.
  assert.strictEqual(I.pointsAvailable(1), 0, "aucun point au niveau 1");
  assert.strictEqual(I.pointsAvailable(2), 5, "5 points au niveau 2");
  assert.strictEqual(I.pointsAvailable(200), 995, "995 points au niveau 200");
  assert.strictEqual(I.pointsAvailable(200), 199 * I.POINTS_PER_LEVEL, "199 montées de niveau");

  // Paliers de coût sur une caractéristique élémentaire.
  assert.strictEqual(I.costOfNextPoint("force", 0), 1, "1 point jusqu'à 100");
  assert.strictEqual(I.costOfNextPoint("force", 99), 1, "encore 1 à 99");
  assert.strictEqual(I.costOfNextPoint("force", 100), 2, "2 points au-delà de 100");
  assert.strictEqual(I.costOfNextPoint("force", 200), 3, "3 points au-delà de 200");
  assert.strictEqual(I.costOfNextPoint("force", 300), 4, "4 points au-delà de 300");
  // Le barème s'arrête à 4 : il n'existe pas de cinquième palier.
  assert.strictEqual(I.costOfNextPoint("force", 400), 4, "toujours 4 au-delà de 400");
  assert.strictEqual(I.costOfNextPoint("force", 999), 4, "le dernier palier est ouvert");

  // Vitalité et sagesse ont un coût constant.
  assert.strictEqual(I.costOfNextPoint("vitalite", 500), 1, "vitalité toujours à 1");
  assert.strictEqual(I.costOfNextPoint("sagesse", 500), 3, "sagesse toujours à 3");

  // Le coût cumulé suit les tranches, sans compter point par point.
  assert.strictEqual(I.costToBuy("force", 0, 100), 100, "100 premiers points");
  assert.strictEqual(I.costToBuy("force", 0, 200), 300, "100 + 200");
  assert.strictEqual(I.costToBuy("force", 100, 200), 200, "tranche 101-200 seule");

  // Le budget n'est jamais dépassé, et l'attribution est partielle plutôt que
  // refusée en bloc : un « +10 » reste utile s'il ne reste que 6 points.
  const d = I.createDistribution();
  const mis = I.spendPoints(d, "vitalite", 5000, 200);
  assert.strictEqual(mis, 995, "995 points de vitalité attribuables");
  assert.strictEqual(I.pointsSpent(d), 995, "budget entièrement consommé");
  assert.strictEqual(I.spendPoints(d, "force", 10, 200), 0, "plus rien à dépenser");

  const partiel = I.createDistribution();
  I.spendPoints(partiel, "vitalite", 992, 200);
  assert.strictEqual(I.spendPoints(partiel, "sagesse", 10, 200), 1,
    "un seul point de sagesse tient dans les 3 restants");

  // Les maximums atteignables correspondent aux valeurs connues du jeu.
  for (const [stat, attendu] of [["vitalite", 995], ["sagesse", 331], ["force", 398]]) {
    const seul = I.createDistribution();
    I.spendPoints(seul, stat, 9999, 200);
    assert.strictEqual(seul[stat], attendu, `maximum en ${stat}`);
    assert.ok(I.pointsSpent(seul) <= 995, `budget respecté en ${stat}`);
  }

  // Remboursement.
  const r = I.createDistribution();
  I.spendPoints(r, "force", 150, 200);
  assert.strictEqual(I.refundPoints(r, "force", 50), 50, "50 points rendus");
  assert.strictEqual(r.force, 100, "force ramenée à 100");
  assert.strictEqual(I.refundPoints(r, "force", 9999), 100, "on ne descend pas sous zéro");
}

/* --- Saisie directe d'une valeur ------------------------------------------- */
{
  const d = I.createDistribution();

  assert.strictEqual(I.setPoints(d, "force", 250, 200), 250, "valeur saisie appliquée");
  assert.strictEqual(I.pointsSpent(d), 100 + 200 + 150, "coût des trois paliers");

  // Une valeur hors budget est ramenée au maximum atteignable, pas refusée.
  const reste = 995 - I.pointsSpent(d);
  const obtenu = I.setPoints(d, "chance", 9999, 200);
  assert.strictEqual(obtenu, I.maxAffordable("chance", reste), "ramené au maximum possible");
  assert.ok(I.pointsSpent(d) <= 995, "budget jamais dépassé");

  // Redescendre libère les points.
  I.setPoints(d, "force", 50, 200);
  assert.strictEqual(d.force, 50, "valeur redescendue");

  // Une valeur négative ou absurde retombe à zéro.
  assert.strictEqual(I.setPoints(d, "force", -20, 200), 0, "pas de valeur négative");

  // Maximums atteignables, barème corrigé.
  assert.strictEqual(I.maxAffordable("vitalite", 995), 995, "vitalité 1 pour 1");
  assert.strictEqual(I.maxAffordable("sagesse", 995), 331, "sagesse 3 pour 1");
  assert.strictEqual(I.maxAffordable("force", 995), 398, "élémentaire par paliers");
}

/* --- Parchemins ------------------------------------------------------------ */
{
  const lo = I.createLoadout();
  lo.scrolled = true;

  let s = I.computeStats(lo, data, LEVEL);
  for (const stat of I.SCROLLED_STATS) {
    assert.strictEqual(s.fromScrolls[stat], I.SCROLL_VALUE, `${stat} parchotée`);
    assert.strictEqual(s.total[stat], I.SCROLL_VALUE, `${stat} totale sans points`);
  }
  assert.strictEqual(s.fromScrolls.vitalite, 0, "la vitalité n'est pas parchotée");
  assert.strictEqual(s.fromScrolls.sagesse, 0, "la sagesse n'est pas parchotée");
  assert.strictEqual(s.points.spent, 0, "les parchemins ne coûtent aucun point");

  // Le point crucial : les 101 des parchemins n'entrent PAS dans les paliers.
  I.setPoints(lo.distribution, "force", 100, 200);
  s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.points.spent, 100, "100 points achetés au tarif du premier palier");
  assert.strictEqual(s.total.force, 100 + I.SCROLL_VALUE, "total force = points + parchemins");
  assert.strictEqual(I.costOfNextPoint("force", lo.distribution.force), 2,
    "le palier suit la valeur ACHETÉE, pas le total affiché");

  // Sans parchotage, rien n'est ajouté.
  lo.scrolled = false;
  s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.total.force, 100, "sans parchemins, seuls les points comptent");
}

/* --- Les points alimentent les statistiques -------------------------------- */
{
  const lo = I.createLoadout();
  I.spendPoints(lo.distribution, "vitalite", 300, 200);
  I.spendPoints(lo.distribution, "force", 100, 200);

  const s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromPoints.vitalite, 300, "vitalité issue des points");
  assert.strictEqual(s.fromPoints.force, 100, "force issue des points");
  assert.strictEqual(s.total.vitalite, 300, "total incluant les points");

  const vieBase = I.BASE_CHARACTER.vieBase + 199 * I.BASE_CHARACTER.viePerLevel;
  assert.strictEqual(s.life.total, vieBase + 300, "la vie suit la vitalité des points");
  assert.strictEqual(s.points.spent, 300 + 100, "points dépensés");
  assert.strictEqual(s.points.remaining, 995 - 400, "points restants");
}

/* --- Forgemagie ------------------------------------------------------------ */
{
  const lo = I.createLoadout();
  const res = I.equip(lo, item(1), { quality: 0 });    // vitalité 20, force 5
  const entry = res.entry;

  // Modifier une ligne native, au-delà des bornes officielles.
  I.setEffectValue(entry, 125, 999);
  let lignes = I.effectiveEffects(item(1), entry);
  const vita = lignes.find((l) => l.effectId === 125);
  assert.strictEqual(vita.value, 999, "valeur forgée appliquée");
  assert.ok(vita.overmax, "dépassement des bornes signalé");
  assert.ok(!vita.exotic, "la ligne reste native");

  let s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromItems.vitalite, 999, "la valeur forgée est cumulée");

  // Ajouter une ligne exotique.
  assert.ok(I.addExoticEffect(entry, item(1), 128, 3), "ligne exotique ajoutée");
  s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromItems.pm, 3, "la ligne exotique est cumulée");
  assert.strictEqual(s.total.pm, I.BASE_CHARACTER.pm + 3, "PM total");

  lignes = I.effectiveEffects(item(1), entry);
  const exo = lignes.find((l) => l.effectId === 128);
  assert.ok(exo.exotic, "ligne marquée exotique");
  assert.strictEqual(exo.min, null, "une ligne exotique n'a pas de bornes officielles");

  // Un effet déjà natif ne peut pas être ajouté en exotique.
  assert.ok(!I.addExoticEffect(entry, item(1), 125, 50), "pas de doublon avec une ligne native");

  // La relance ne touche que les lignes natives.
  I.rerollEntry(entry, item(1), I.makeRng("relance"), 1);
  assert.strictEqual(entry.roll[125], 40, "ligne native relancée au maximum");
  assert.strictEqual(entry.roll[128], 3, "ligne exotique préservée par la relance");
  assert.deepStrictEqual(entry.exotic, [128], "la liste exotique survit");

  // Retrait d'une ligne exotique.
  assert.ok(I.removeExoticEffect(entry, 128), "ligne exotique retirée");
  assert.strictEqual(entry.roll[128], undefined, "valeur supprimée");
  s = I.computeStats(lo, data, LEVEL);
  assert.strictEqual(s.fromItems.pm, 0, "plus cumulée après retrait");
  assert.ok(!I.removeExoticEffect(entry, 125), "une ligne native n'est pas supprimable");
}

/* --- Export / import : répartition et forge ------------------------------- */
{
  const lo = I.createLoadout();
  I.spendPoints(lo.distribution, "chance", 120, 200);
  lo.scrolled = true;
  const res = I.equip(lo, item(1), { quality: 1 });
  I.setEffectValue(res.entry, 125, 777);
  I.addExoticEffect(res.entry, item(1), 111, 1);

  const avant = JSON.stringify(I.computeStats(lo, data, LEVEL).total);
  const round = I.importLoadout(JSON.parse(JSON.stringify(I.exportLoadout(lo, LEVEL))));
  const apres = JSON.stringify(I.computeStats(round, data, LEVEL).total);

  assert.strictEqual(apres, avant, "aller-retour conservant points et forge");
  assert.strictEqual(round.distribution.chance, 120, "répartition restaurée");
  assert.strictEqual(round.scrolled, true, "parchotage restauré");
  assert.deepStrictEqual(round.slots.coiffe[0].exotic, [111], "ligne exotique restaurée");

  // Un build antérieur, sans répartition, ne doit pas inventer de points.
  const ancien = I.importLoadout({ v: 1, slots: { coiffe: [{ itemId: 1, roll: {} }] } });
  assert.strictEqual(I.pointsSpent(ancien.distribution), 0, "aucun point inventé");
  assert.deepStrictEqual(ancien.slots.coiffe[0].exotic, [], "pas de ligne exotique");
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
