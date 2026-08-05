/**
 * Tests de l'interpréteur de sorts (v0.3) : zones, conditions de lancer,
 * formule de dégâts et application des effets.
 */

"use strict";

const assert = require("assert");
const G = require("../client/grid.js");
const S = require("../client/spells.js");

const grid = G.makeGrid(14, 20);
const at = (x, y) => grid.coordToId(x, y);
const carte = () => G.makeMap(grid);

/* --- Zones ------------------------------------------------------------------ */
{
  const centre = at(14, 6);

  const point = S.zoneCells(grid, at(10, 6), centre, { type: "point", size: 0 });
  assert.deepStrictEqual(point, [centre], "point : la case visée seule");

  // Disque : |Δx| + |Δy| <= rayon, soit 1 + 4·r cases sur une grille infinie.
  const disque1 = S.zoneCells(grid, at(10, 6), centre, { type: "circle", size: 1 });
  assert.strictEqual(disque1.length, 5, "disque de rayon 1 : 5 cases");
  const disque2 = S.zoneCells(grid, at(10, 6), centre, { type: "circle", size: 2 });
  assert.strictEqual(disque2.length, 13, "disque de rayon 2 : 13 cases");
  for (const id of disque2) {
    assert.ok(G.cellDistance(grid.idToCoord(id), grid.idToCoord(centre)) <= 2, "toutes dans le rayon");
  }

  // Anneau : uniquement la couronne.
  const anneau = S.zoneCells(grid, at(10, 6), centre, { type: "ring", size: 2 });
  assert.strictEqual(anneau.length, 8, "anneau de rayon 2 : 8 cases");
  for (const id of anneau) {
    assert.strictEqual(G.cellDistance(grid.idToCoord(id), grid.idToCoord(centre)), 2, "exactement à distance 2");
  }

  // Croix : la case visée plus les quatre directions.
  const croix = S.zoneCells(grid, at(10, 6), centre, { type: "cross", size: 2 });
  assert.strictEqual(croix.length, 9, "croix de taille 2 : 9 cases");

  // Ligne : prolonge la direction du lancer depuis la cible.
  const ligne = S.zoneCells(grid, at(10, 6), centre, { type: "line", size: 2 });
  assert.strictEqual(ligne.length, 3, "ligne de taille 2 : 3 cases");
  assert.ok(ligne.includes(centre), "la ligne part de la case visée");

  // Une forme non décodée se replie sur la case visée, sans rien inventer.
  const inconnue = S.zoneCells(grid, at(10, 6), centre, { type: "inconnue", size: 5 });
  assert.deepStrictEqual(inconnue, [centre], "forme inconnue : repli sur la case visée");

  // Les cases hors grille ne sont jamais retournées.
  const bord = S.zoneCells(grid, at(1, 0), at(0, 0), { type: "circle", size: 3 });
  assert.ok(bord.every((id) => id >= 0 && id < grid.size), "aucune case hors grille");
}

/* --- Conditions de lancer --------------------------------------------------- */
{
  const map = carte();
  const caster = S.makeEntity({ id: "a", name: "Iop", cellId: at(10, 6), pa: 6, stats: {} });
  const niveau = {
    apCost: 4, ranges: [{ min: 1, max: 5 }], lineOfSight: true,
    modifiableRange: false, zones: [{ type: "point", size: 0 }], effects: [],
  };

  assert.ok(S.canCast(grid, map, caster, niveau, at(13, 6), {}).ok, "cible à portée");

  const trop_pres = S.canCast(grid, map, caster, niveau, caster.cellId, {});
  assert.ok(!trop_pres.ok && /Trop près/.test(trop_pres.reasons[0]), "portée minimale respectée");

  const trop_loin = S.canCast(grid, map, caster, niveau, at(20, 6), {});
  assert.ok(!trop_loin.ok && trop_loin.reasons.some((r) => /Trop loin/.test(r)), "portée maximale respectée");

  // Coût en PA.
  const sansPa = S.makeEntity({ id: "b", name: "Iop", cellId: at(10, 6), pa: 2, stats: {} });
  const cher = S.canCast(grid, map, sansPa, niveau, at(13, 6), {});
  assert.ok(!cher.ok && cher.reasons.some((r) => /PA requis/.test(r)), "PA insuffisants refusés");

  // Ligne de vue.
  map.cells[at(12, 6)] = G.CELL_WALL;
  const bloque = S.canCast(grid, map, caster, niveau, at(14, 6), {});
  assert.ok(!bloque.ok && bloque.reasons.some((r) => /Ligne de vue/.test(r)), "LDV bloquée refusée");

  // Un sort sans exigence de LDV passe malgré l'obstacle.
  const sansLdv = { ...niveau, lineOfSight: false };
  assert.ok(S.canCast(grid, map, caster, sansLdv, at(14, 6), {}).ok, "sort sans LDV");
  map.cells[at(12, 6)] = G.CELL_FREE;

  // Portée modifiable : la PO du lanceur étend la portée, sinon non.
  const modifiable = { ...niveau, modifiableRange: true };
  assert.ok(S.canCast(grid, map, caster, modifiable, at(17, 6), { rangeBonus: 2 }).ok,
    "portée modifiable étendue par la PO");
  assert.ok(!S.canCast(grid, map, caster, niveau, at(17, 6), { rangeBonus: 2 }).ok,
    "portée non modifiable insensible à la PO");

  // Lancer en ligne.
  const enLigne = { ...niveau, castInLine: true };
  assert.ok(S.canCast(grid, map, caster, enLigne, at(13, 6), {}).ok, "aligné accepté");
  assert.ok(!S.canCast(grid, map, caster, enLigne, at(12, 8), {}).ok, "non aligné refusé");
}

/* --- Formule de dégâts ------------------------------------------------------ */
{
  // Sans aucune statistique, les dégâts valent le jet.
  const nu = S.computeDamage({ element: "terre", min: 10, max: 10 }, {}, {}, { roll: 10 });
  assert.strictEqual(nu.finaux, 10, "jet nu");

  // La caractéristique élémentaire multiplie : 10 × (1 + 100/100) = 20.
  const avecCarac = S.computeDamage({ element: "terre", min: 10, max: 10 }, { force: 100 }, {}, { roll: 10 });
  assert.strictEqual(avecCarac.finaux, 20, "la force double les dégâts Terre");

  // Chaque élément puise dans sa propre caractéristique.
  assert.strictEqual(
    S.computeDamage({ element: "feu", min: 10, max: 10 }, { force: 100 }, {}, { roll: 10 }).finaux, 10,
    "la force n'agit pas sur le feu");
  assert.strictEqual(
    S.computeDamage({ element: "feu", min: 10, max: 10 }, { intelligence: 100 }, {}, { roll: 10 }).finaux, 20,
    "l'intelligence porte le feu");
  assert.strictEqual(
    S.computeDamage({ element: "neutre", min: 10, max: 10 }, { force: 100 }, {}, { roll: 10 }).finaux, 20,
    "le neutre est porté par la force");

  // Puissance et % dommages s'ajoutent au multiplicateur.
  assert.strictEqual(
    S.computeDamage({ element: "terre", min: 10, max: 10 }, { force: 50, puissance: 30, domPct: 20 }, {}, { roll: 10 }).finaux,
    20, "puissance et % dommages entrent dans le multiplicateur");

  // Les dommages fixes s'ajoutent après le multiplicateur.
  const fixes = S.computeDamage({ element: "terre", min: 10, max: 10 },
    { force: 100, domTerre: 5, domFixe: 3 }, {}, { roll: 10 });
  assert.strictEqual(fixes.finaux, 28, "20 + 5 + 3");

  // Résistances : pourcentage puis fixe.
  const resiste = S.computeDamage({ element: "terre", min: 10, max: 10 },
    { force: 100 }, { resPctTerre: 50, resFixeTerre: 3 }, { roll: 10 });
  assert.strictEqual(resiste.finaux, 7, "20 → −50% = 10, −3 fixes = 7");

  // Les dégâts ne descendent jamais sous zéro.
  const encaisse = S.computeDamage({ element: "terre", min: 1, max: 1 },
    {}, { resFixeTerre: 100 }, { roll: 1 });
  assert.strictEqual(encaisse.finaux, 0, "jamais de dégâts négatifs");

  // Les dommages critiques s'ajoutent avant les résistances.
  const crit = S.computeDamage({ element: "terre", min: 10, max: 10 },
    { domCrit: 10 }, { resPctTerre: 50 }, { roll: 10, critical: true });
  assert.strictEqual(crit.finaux, 10, "(10 + 10) puis −50%");
}

/* --- Bouclier et points de vie ---------------------------------------------- */
{
  const e = S.makeEntity({ id: "x", name: "Cible", cellId: 0, maxLife: 100, shield: 30 });
  let r = S.applyDamage(e, 20);
  assert.deepStrictEqual([r.absorbe, r.subis], [20, 0], "le bouclier absorbe en premier");
  assert.strictEqual(e.shield, 10, "bouclier entamé");
  assert.strictEqual(e.life, 100, "points de vie intacts");

  r = S.applyDamage(e, 30);
  assert.deepStrictEqual([r.absorbe, r.subis], [10, 20], "le reste passe");
  assert.strictEqual(e.shield, 0, "bouclier consommé");
  assert.strictEqual(e.life, 80, "points de vie entamés");

  S.applyDamage(e, 999);
  assert.strictEqual(e.life, 0, "les points de vie ne descendent pas sous zéro");
}

/* --- Lancement complet ------------------------------------------------------ */
{
  const map = carte();
  const rng = () => 0.99;   // jet maximal, jamais critique

  const iop = S.makeEntity({
    id: "iop", name: "Iop", team: "a", cellId: at(10, 6),
    maxLife: 1000, pa: 6, stats: { force: 100, pa: 6 },
  });
  const cible = S.makeEntity({
    id: "cra", name: "Crâ", team: "b", cellId: at(12, 6),
    maxLife: 1000, pa: 6, stats: { resPctTerre: 0 },
  });

  const spell = { id: 1, name: "Pression", class: "iop" };
  const level = {
    apCost: 4, ranges: [{ min: 1, max: 3 }], lineOfSight: true, modifiableRange: false,
    criticalHitProbability: 0, zones: [{ type: "point", size: 0 }],
    effects: [{ effectId: 97, kind: "damage", element: "terre", label: "dommages Terre", min: 20, max: 20 }],
    criticalEffects: [],
  };

  const res = S.castSpell({ grid, map, caster: iop, spell, level, targetCell: cible.cellId, entities: [iop, cible], rng });
  assert.ok(res.ok, "lancer accepté");
  assert.strictEqual(iop.pa, 2, "les PA sont décomptés");
  assert.strictEqual(cible.life, 1000 - 40, "20 × (1 + 100%) = 40 dégâts");
  assert.ok(res.journal.some((l) => l.type === "damage"), "les dégâts sont journalisés");
  assert.ok(res.journal[0].texte.includes("Pression"), "le lancer est journalisé");

  // Un lancer invalide ne modifie rien.
  const paAvant = iop.pa, vieAvant = cible.life;
  const refuse = S.castSpell({ grid, map, caster: iop, spell, level, targetCell: at(1, 1), entities: [iop, cible], rng });
  assert.ok(!refuse.ok, "lancer hors portée refusé");
  assert.strictEqual(iop.pa, paAvant, "aucun PA consommé");
  assert.strictEqual(cible.life, vieAvant, "aucun dégât infligé");
}

/* --- Effets non reconnus : journalisés, jamais appliqués -------------------- */
{
  const map = carte();
  const iop = S.makeEntity({ id: "a", name: "Iop", cellId: at(10, 6), pa: 6, maxLife: 500, stats: {} });
  const cible = S.makeEntity({ id: "b", name: "Cible", cellId: at(11, 6), pa: 6, pm: 3, maxLife: 500, stats: {} });

  const level = {
    apCost: 2, ranges: [{ min: 1, max: 2 }], lineOfSight: false, criticalHitProbability: 0,
    zones: [{ type: "point", size: 0 }],
    effects: [
      { effectId: 9999, kind: null, label: "Effet mystérieux", min: 5, max: 5 },
      { effectId: 81, kind: "heal", label: "soins", min: 10, max: 10 },
    ],
    criticalEffects: [],
  };
  cible.life = 400;

  const res = S.castSpell({ grid, map, caster: iop, spell: { name: "Test" }, level,
    targetCell: cible.cellId, entities: [iop, cible], rng: () => 0.5 });

  assert.ok(res.journal.some((l) => l.type === "non-applique" && /mystérieux/.test(l.texte)),
    "l'effet inconnu est signalé comme non appliqué");
  assert.strictEqual(cible.life, 410, "l'effet reconnu s'applique quand même");
}

/* --- Buffs ------------------------------------------------------------------ */
{
  const e = S.makeEntity({ id: "a", name: "Iop", cellId: 0, stats: { force: 50 } });
  assert.strictEqual(S.effectiveStats(e).force, 50, "sans buff");

  e.buffs.push({ statKey: "force", value: 100, duration: 2, label: "Puissance" });
  assert.strictEqual(S.effectiveStats(e).force, 150, "le buff s'ajoute");

  assert.strictEqual(S.tickBuffs(e).length, 0, "le buff survit au premier tour");
  assert.strictEqual(S.effectiveStats(e).force, 150, "toujours actif");
  assert.strictEqual(S.tickBuffs(e).length, 1, "il expire au second");
  assert.strictEqual(S.effectiveStats(e).force, 50, "retour à la valeur de base");
}

/* --- Choix du palier selon le niveau du personnage -------------------------- */
{
  const spell = {
    id: 1, name: "Sort", levels: [
      { level: 1, minPlayerLevel: 1, apCost: 3 },
      { level: 5, minPlayerLevel: 60, apCost: 4 },
      { level: 6, minPlayerLevel: 100, apCost: 4 },
    ],
  };
  assert.strictEqual(S.levelFor(spell, 1).level, 1, "niveau 1 : premier palier");
  assert.strictEqual(S.levelFor(spell, 80).level, 5, "niveau 80 : palier 5");
  assert.strictEqual(S.levelFor(spell, 200).level, 6, "niveau 200 : dernier palier");
}

console.log("spells.test.js : OK");
