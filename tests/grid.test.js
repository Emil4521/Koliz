/**
 * Tests de la géométrie de la grille et de la ligne de vue (v0.1).
 *
 * Le livrable v0.1 est un fichier HTML autonome : on en extrait les sections
 * de calcul (géométrie, LDV, génération de carte) pour les exécuter sous Node,
 * sans navigateur. Les sections de rendu et d'interface sont écartées.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const HTML = path.join(__dirname, "..", "client", "index.html");

function loadCore() {
  const html = fs.readFileSync(HTML, "utf8");
  const script = html.split("<script>")[1].split("</script>")[0];
  const startRender = script.lastIndexOf("/* ====", script.indexOf("   4. RENDU CANVAS"));
  const startTests = script.lastIndexOf("/* ====", script.indexOf("   6. AUTO-TESTS"));
  const code = script.slice(0, startRender) + script.slice(startTests);

  const sandbox = {};
  const exposed = [
    "makeGrid", "cellDistance", "traversedCells", "lineOfSight", "makeMap",
    "generateMap", "neighbors", "selfTest", "CELL_FREE", "CELL_WALL", "CELL_HOLE",
  ];
  const factory = new Function(
    `${code.replace(/\nselfTest\(\);[\s\S]*$/, "\n")}\nreturn {${exposed.join(",")}};`
  );
  return Object.assign(sandbox, factory());
}

const G = loadCore();
const rand = (n) => (Math.random() * n) | 0;

/* --- Auto-tests embarqués dans le livrable --------------------------------- */
{
  const fails = G.selfTest();
  assert.deepStrictEqual(fails, [], `auto-tests du livrable : ${fails.join(" | ")}`);
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

console.log("grid.test.js : OK");
