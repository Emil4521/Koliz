/**
 * Tests de la géométrie de la grille et de la ligne de vue (v0.1).
 *
 * `client/grid.js` étant un module autonome, il est chargé directement : plus
 * besoin d'extraire le code du fichier HTML, comme c'était le cas quand tout
 * le livrable v0.1 tenait dans une seule page.
 */

"use strict";

const assert = require("assert");
const G = require("../client/grid.js");


const rand = (n) => (Math.random() * n) | 0;

/* --- Règle Ankama des cellules « à moitié traversées » ---------------------
   Sur une diagonale parfaite, le rayon passe pile par les coins de deux
   cellules voisines. En mode strict elles comptent comme traversées et
   bloquent ; en mode permissif elles sont ignorées. C'est LA subtilité que le
   jalon devait reproduire. */
{
  const g = G.makeGrid(14, 20);
  const m = G.makeMap(g);
  const at = (x, y) => g.coordToId(x, y);

  const strictes = G.traversedCells(g, { x: 5, y: 5 }, { x: 7, y: 7 }, true)
    .map((c) => `${c.x},${c.y}`);
  assert.ok(strictes.includes("6,5") && strictes.includes("5,6"), "coins comptés en mode strict");

  const permissives = G.traversedCells(g, { x: 5, y: 5 }, { x: 7, y: 7 }, false)
    .map((c) => `${c.x},${c.y}`);
  assert.ok(!permissives.includes("6,5") && !permissives.includes("5,6"),
    "coins ignorés en mode permissif");

  m.cells[at(6, 5)] = G.CELL_WALL;
  assert.ok(!G.lineOfSight(g, m, at(5, 5), at(7, 7), true).clear, "coin bloquant en strict");
  assert.ok(G.lineOfSight(g, m, at(5, 5), at(7, 7), false).clear, "coin non bloquant en permissif");
  m.cells[at(6, 5)] = G.CELL_FREE;

  // La cible ne se masque jamais elle-même.
  m.cells[at(9, 5)] = G.CELL_WALL;
  assert.ok(G.lineOfSight(g, m, at(5, 5), at(9, 5), true).clear, "cible non bloquante");
  m.cells[at(9, 5)] = G.CELL_FREE;

  // Bordure de carte : le rayon effleure des cellules hors grille sans bloquer.
  assert.ok(G.lineOfSight(g, m, 0, g.W - 1, true).clear, "LDV le long de la rangée du haut");
  assert.ok(G.lineOfSight(g, m, g.size - g.W, g.size - 1, true).clear, "LDV le long de la rangée du bas");

  // Les quatre voisins d'une cellule intérieure sont à distance 1.
  const mid = at(10, 5);
  assert.strictEqual(G.neighbors(g, mid).length, 4, "quatre voisins");
  for (const nb of G.neighbors(g, mid)) {
    assert.strictEqual(G.cellDistance(g.idToCoord(mid), g.idToCoord(nb)), 1, "voisin à distance 1");
  }
}

/* --- Bijection identifiant ↔ coordonnées ----------------------------------- */
{
  for (const [W, H] of [[14, 20], [7, 7], [20, 12], [3, 3]]) {
    const g = G.makeGrid(W, H);
    assert.strictEqual(g.size, W * H * 2, `taille de grille ${W}x${H}`);
    for (let id = 0; id < g.size; id++) {
      const c = g.idToCoord(id);
      assert.strictEqual(g.coordToId(c.x, c.y), id, `aller-retour id ${id} en ${W}x${H}`);
    }
  }
}

/* --- Continuité du parcours et extrémités ---------------------------------- */
{
  const g = G.makeGrid(14, 20);
  for (let n = 0; n < 4000; n++) {
    const a = { x: rand(30), y: rand(20) }, b = { x: rand(30), y: rand(20) };
    const cells = G.traversedCells(g, a, b, true);
    assert.ok(cells[0].x === a.x && cells[0].y === a.y, "source en tête du parcours");
    const last = cells[cells.length - 1];
    assert.ok(last.x === b.x && last.y === b.y, "cible en queue du parcours");
    for (let i = 1; i < cells.length; i++) {
      // Sur une diagonale parfaite, plusieurs cellules entrent au même instant :
      // elles ne forment alors pas une chaîne d'adjacence.
      const contiguous = G.cellDistance(cells[i - 1], cells[i]) === 1;
      assert.ok(contiguous || cells[i - 1].t === cells[i].t, "parcours continu");
    }
  }
}

/* --- Le mode permissif est inclus dans le mode strict ---------------------- */
{
  const g = G.makeGrid(14, 20);
  for (let n = 0; n < 2000; n++) {
    const a = { x: rand(20), y: rand(20) }, b = { x: rand(20), y: rand(20) };
    const strict = new Set(G.traversedCells(g, a, b, true).map((c) => `${c.x},${c.y}`));
    for (const c of G.traversedCells(g, a, b, false)) {
      assert.ok(strict.has(`${c.x},${c.y}`), "permissif ⊆ strict");
    }
  }
}

/* --- Symétrie de la ligne de vue ------------------------------------------- */
{
  const g = G.makeGrid(14, 20);
  for (let t = 0; t < 30; t++) {
    const map = G.generateMap(g, `sym${t}`, 25);
    for (let n = 0; n < 200; n++) {
      const a = rand(g.size), b = rand(g.size);
      for (const strict of [true, false]) {
        assert.strictEqual(
          G.lineOfSight(g, map, a, b, strict).clear,
          G.lineOfSight(g, map, b, a, strict).clear,
          `LDV symétrique entre ${a} et ${b}`
        );
      }
    }
  }
}

/* --- Cellules hors grille : effleurées, jamais traversées ------------------ */
{
  for (const [W, H] of [[14, 20], [7, 7], [20, 12]]) {
    const g = G.makeGrid(W, H);
    for (let a = 0; a < g.size; a += 5) {
      for (let b = a; b < g.size; b += 11) {
        for (const c of G.traversedCells(g, g.idToCoord(a), g.idToCoord(b), true)) {
          if (c.id < 0) {
            assert.strictEqual(c.tOut, c.t,
              `cellule hors grille (${c.x},${c.y}) réellement traversée entre ${a} et ${b}`);
          }
        }
      }
    }
  }
}

/* --- Adjacence : deux cellules voisines se voient toujours ----------------- */
{
  const g = G.makeGrid(14, 20);
  const map = G.generateMap(g, "adjacence", 45);
  for (let id = 0; id < g.size; id++) {
    for (const nb of G.neighbors(g, id)) {
      assert.ok(G.lineOfSight(g, map, id, nb, true).clear, `voisins ${id}/${nb} en vue`);
    }
  }
}

/* --- Obstacles et trous ---------------------------------------------------- */
{
  const g = G.makeGrid(14, 20);
  const map = G.makeMap(g);
  const at = (x, y) => g.coordToId(x, y);

  assert.ok(G.lineOfSight(g, map, at(12, 6), at(16, 6), true).clear, "ligne dégagée");

  map.cells[at(14, 6)] = G.CELL_WALL;
  assert.ok(!G.lineOfSight(g, map, at(12, 6), at(16, 6), true).clear, "obstacle bloquant");
  assert.ok(G.lineOfSight(g, map, at(12, 7), at(16, 7), true).clear, "ligne voisine dégagée");

  map.cells[at(14, 6)] = G.CELL_HOLE;
  assert.ok(G.lineOfSight(g, map, at(12, 6), at(16, 6), true).clear, "trou transparent");
  assert.ok(!map.walkable(at(14, 6)), "trou infranchissable");
}

/* --- Génération de carte --------------------------------------------------- */
{
  const g = G.makeGrid(14, 20);
  for (let t = 0; t < 50; t++) {
    const map = G.generateMap(g, `gen${t}`, 45);
    for (const id of [...map.startA, ...map.startB]) {
      assert.strictEqual(map.cells[id], G.CELL_FREE, "zone de départ dégagée");
    }
    // Connectivité entre les deux zones de départ.
    const seen = new Uint8Array(g.size);
    const queue = [[...map.startA][0]];
    seen[queue[0]] = 1;
    let reached = false;
    while (queue.length && !reached) {
      const cur = queue.pop();
      if (map.startB.has(cur)) { reached = true; break; }
      for (const nb of G.neighbors(g, cur)) {
        if (!seen[nb] && map.cells[nb] === G.CELL_FREE) { seen[nb] = 1; queue.push(nb); }
      }
    }
    assert.ok(reached, `carte ${t} : zones de départ reliées`);
  }
}

/* --- Déterminisme de la génération ----------------------------------------- */
{
  const g = G.makeGrid(14, 20);
  const a = G.generateMap(g, "graine", 20).cells.join(",");
  const b = G.generateMap(g, "graine", 20).cells.join(",");
  const c = G.generateMap(g, "autre", 20).cells.join(",");
  assert.strictEqual(a, b, "même graine, même carte");
  assert.notStrictEqual(a, c, "graines différentes, cartes différentes");
}

/* --- Déplacement : cases atteignables et chemin ----------------------------- */
{
  const g = G.makeGrid(14, 20);
  const at = (x, y) => g.coordToId(x, y);
  const map = G.makeMap(g);
  const depart = at(10, 6);

  // Sur terrain dégagé, le nombre de cases à distance <= n d'un point vaut
  // 2n² + 2n : 4 à 1 PM, 12 à 2 PM. C'est la même géométrie que le disque des
  // zones d'effet, décomptée sans la case centrale.
  assert.strictEqual(G.reachableCells(g, map, depart, 1).size, 4, "1 PM : quatre cases");
  assert.strictEqual(G.reachableCells(g, map, depart, 2).size, 12, "2 PM : douze cases");
  assert.ok(!G.reachableCells(g, map, depart, 3).has(depart), "la case de départ n'y figure pas");

  // Le coût annoncé est bien la distance de la grille.
  for (const [id, info] of G.reachableCells(g, map, depart, 3)) {
    assert.strictEqual(info.cost, G.cellDistance(g.idToCoord(id), g.idToCoord(depart)),
      "coût = distance en diamant");
  }

  // Murs et trous ne se traversent pas — un trou bloque le pas même s'il
  // laisse passer la ligne de vue.
  {
    const m = G.makeMap(g);
    for (const [x, y] of [[11, 6], [9, 6], [10, 7]]) m.cells[at(x, y)] = G.CELL_WALL;
    m.cells[at(10, 5)] = G.CELL_HOLE;
    assert.strictEqual(G.reachableCells(g, m, depart, 5).size, 0, "encerclé : aucune case");
  }

  // Un combattant bloque : on ne le traverse pas et on ne s'arrête pas dessus.
  {
    const m = G.makeMap(g);
    for (const [x, y] of [[10, 5], [10, 7], [9, 6]]) m.cells[at(x, y)] = G.CELL_WALL;
    const libre = G.reachableCells(g, m, depart, 4);
    const barre = G.reachableCells(g, m, depart, 4, { blocked: new Set([at(11, 6)]) });
    assert.ok(libre.size > 0 && barre.size === 0,
      "le seul passage étant occupé, plus rien n'est atteignable");
  }

  // Chemin : départ exclu, arrivée incluse, longueur égale au coût.
  {
    const acces = G.reachableCells(g, map, depart, 4);
    const arrivee = at(13, 6);
    const chemin = G.pathTo(acces, arrivee);
    assert.strictEqual(chemin.length, 3, "trois pas");
    assert.strictEqual(chemin[chemin.length - 1], arrivee, "se termine à l'arrivée");
    assert.ok(!chemin.includes(depart), "ne contient pas le départ");
    // Chaque pas est un voisin du précédent : pas de saut.
    let precedent = depart;
    for (const id of chemin) {
      assert.ok(G.neighbors(g, precedent).includes(id), "pas à pas, sans diagonale");
      precedent = id;
    }
    assert.deepStrictEqual(G.pathTo(acces, at(0, 0)), [], "case inatteignable : chemin vide");
  }

  // Un budget nul n'ouvre rien — le cas du combattant sans PM.
  assert.strictEqual(G.reachableCells(g, map, depart, 0).size, 0, "0 PM : aucun déplacement");
}

console.log("grid.test.js : OK");
