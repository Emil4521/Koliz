/**
 * grid.js — géométrie de la grille, ligne de vue et génération de carte
 * =============================================================================
 * Module autonome, sans dépendance. Utilisable de deux façons :
 *   - navigateur : <script src="grid.js"></script> → global `Kolizeum.Grid`
 *   - Node       : require("./grid.js")            → mêmes fonctions (tests)
 *
 * Extrait du livrable v0.1, où tout tenait dans un fichier HTML unique. La
 * géométrie sert désormais à plusieurs interfaces — la carte de la v0.1 et le
 * banc d'essai des sorts — et le brief prévoit de toute façon `client/grid.js`
 * comme module à part (§3). Le chargement reste possible en file:// sans
 * serveur : une balise <script> classique n'est pas soumise à la politique
 * d'origine, contrairement à fetch().
 * =============================================================================
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Kolizeum = root.Kolizeum || {}).Grid = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";


  /* ==========================================================================
     1. GÉOMÉTRIE DE LA GRILLE
     --------------------------------------------------------------------------
     Dofus n'utilise pas une grille hexagonale mais une grille isométrique en
     losanges : un réseau carré tourné à 45°. On travaille donc dans un repère
     « diamant » (x, y) où chaque cellule est un carré unité centré sur des
     coordonnées entières — ce qui rend la LDV et les distances exactes et
     simples à raisonner.

       - écran :  sx = (x - y) * hw        (hw = demi-largeur d'une cellule)
                  sy = (x + y) * hh        (hh = demi-hauteur d'une cellule)
       - voisins : (x±1, y) et (x, y±1)  → les 4 losanges adjacents à l'écran
       - distance Dofus : |Δx| + |Δy|     (distance de Manhattan dans ce repère)

     Numérotation des cellules (identique à Dofus) : W cellules par rangée
     écran, 2H rangées écran décalées d'une demi-cellule, ids croissants de
     gauche à droite puis de haut en bas. Total = W * H * 2 (560 pour 14 × 20).
     ========================================================================== */

  function makeGrid(W, H) {
    const rows = H * 2;
    return {
      W, H, rows,
      size: W * rows,

      idToCoord(id) {
        const r = (id / W) | 0, c = id % W, k = r >> 1;
        return { x: k + c + (r & 1), y: k - c };
      },
      coordToId(x, y) {
        const r = x + y;
        if (r < 0 || r >= rows) return -1;
        const k = r >> 1, c = x - k - (r & 1);
        if (c < 0 || c >= W) return -1;
        return r * W + c;
      },
      /** Rangée écran (0 .. rows-1) et colonne dans la rangée (0 .. W-1). */
      idToRC(id) { return { r: (id / W) | 0, c: id % W }; },
    };
  }

  /** Distance Dofus entre deux cellules (Manhattan dans le repère diamant). */
  function cellDistance(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }


  /* ==========================================================================
     2. LIGNE DE VUE (LDV)
     --------------------------------------------------------------------------
     Algorithme : on trace un segment entre les CENTRES des deux cellules, puis
     on collecte toutes les cellules dont le carré unité FERMÉ est intersecté
     par ce segment (« supercover »). Une cellule seulement effleurée — le
     segment passant pile par un de ses coins — compte donc comme traversée :
     c'est la subtilité Ankama des cellules « à moitié traversées », qui
     bloquent la LDV si elles contiennent un obstacle.

     Les cellules de départ et d'arrivée ne bloquent jamais : la cible ne se
     masque pas elle-même, et l'on voit depuis sa propre case.

     Arithmétique exacte : les extrémités sont entières et les bords de cellule
     sont sur des demi-entiers. On double toutes les coordonnées pour rester
     dans les entiers, et les instants t sont comparés sous forme de fractions
     (produits en croix). Aucun epsilon, donc aucune ambiguïté sur les cas
     limites — précisément ceux qui définissent la règle.
     ========================================================================== */

  /** Compare deux fractions n/d (d > 0). */
  function cmpFrac(a, b) {
    const v = a.n * b.d - b.n * a.d;
    return v < 0 ? -1 : v > 0 ? 1 : 0;
  }

  /**
   * Intervalle de t pour lequel C0 + D·t reste dans la tranche fermée [B0, B1].
   * Retourne { lo, hi } (fractions) ou null si la tranche n'est jamais atteinte.
   */
  function slabInterval(C0, D, B0, B1) {
    if (D === 0) {
      return (C0 >= B0 && C0 <= B1) ? { lo: { n: 0, d: 1 }, hi: { n: 1, d: 1 } } : null;
    }
    let t0, t1;
    if (D > 0) { t0 = { n: B0 - C0, d: D }; t1 = { n: B1 - C0, d: D }; }
    else       { t0 = { n: C0 - B0, d: -D }; t1 = { n: C0 - B1, d: -D }; }
    return cmpFrac(t0, t1) <= 0 ? { lo: t0, hi: t1 } : { lo: t1, hi: t0 };
  }

  /**
   * Intervalle { lo, hi } des instants passés par le segment (x0,y0)→(x1,y1)
   * dans la cellule (i,j), ou null si le segment ne la touche pas.
   * strict = true  : le simple effleurement d'un coin compte comme traversée
   *                  (lo == hi, cellule « à moitié traversée »).
   * strict = false : il faut traverser l'intérieur de la cellule (lo < hi).
   */
  function segmentEntersCell(x0, y0, x1, y1, i, j, strict) {
    const Cx = 2 * x0, Dx = 2 * (x1 - x0);
    const Cy = 2 * y0, Dy = 2 * (y1 - y0);

    const sx = slabInterval(Cx, Dx, 2 * i - 1, 2 * i + 1); if (!sx) return null;
    const sy = slabInterval(Cy, Dy, 2 * j - 1, 2 * j + 1); if (!sy) return null;

    let lo = { n: 0, d: 1 }, hi = { n: 1, d: 1 };
    if (cmpFrac(sx.lo, lo) > 0) lo = sx.lo;
    if (cmpFrac(sy.lo, lo) > 0) lo = sy.lo;
    if (cmpFrac(sx.hi, hi) < 0) hi = sx.hi;
    if (cmpFrac(sy.hi, hi) < 0) hi = sy.hi;

    const c = cmpFrac(lo, hi);
    if (strict ? c > 0 : c >= 0) return null;
    return { lo, hi };
  }

  /**
   * Toutes les cellules traversées par le segment A→B, dans l'ordre du parcours
   * (extrémités incluses). Chaque entrée : { x, y, id, t, tOut }.
   *
   * Sur une diagonale parfaite, le rayon passe pile par les coins : la cellule
   * réellement traversée et ses deux voisines « à moitié traversées » entrent
   * au même instant. On départage par l'instant de sortie croissant : les
   * cellules effleurées (durée nulle) précèdent la cellule traversée, si bien
   * que la source reste en tête et la cible en queue de liste.
   */
  function traversedCells(grid, a, b, strict) {
    const out = [];
    const xMin = Math.min(a.x, b.x), xMax = Math.max(a.x, b.x);
    const yMin = Math.min(a.y, b.y), yMax = Math.max(a.y, b.y);

    for (let i = xMin; i <= xMax; i++) {
      for (let j = yMin; j <= yMax; j++) {
        const span = segmentEntersCell(a.x, a.y, b.x, b.y, i, j, strict);
        if (!span) continue;
        out.push({
          x: i, y: j, id: grid.coordToId(i, j),
          t: span.lo.n / span.lo.d,
          tOut: span.hi.n / span.hi.d,
        });
      }
    }
    out.sort((p, q) => (p.t - q.t) || (p.tOut - q.tOut));
    return out;
  }

  /**
   * Résout la LDV entre deux cellules.
   * @returns { clear, cells, blockers }
   */
  function lineOfSight(grid, map, aId, bId, strict) {
    const a = grid.idToCoord(aId), b = grid.idToCoord(bId);
    const cells = traversedCells(grid, a, b, strict);
    const blockers = [];
    for (const c of cells) {
      if (c.id === aId || c.id === bId) continue;   // extrémités jamais bloquantes
      // Une cellule hors grille n'est jamais un obstacle : un rayon reliant deux
      // cellules valides ne peut que l'effleurer en bordure (vérifié pour toutes
      // les paires sur plusieurs tailles de grille), jamais la traverser. La
      // compter comme bloquante couperait la LDV le long des rangées de bord.
      if (c.id < 0) continue;
      if (map.blocksLos(c.id)) blockers.push(c);
    }
    return { clear: blockers.length === 0, cells, blockers };
  }


  /* ==========================================================================
     3. ÉTAT DE LA CARTE
     ========================================================================== */

  const CELL_FREE = 0;   // libre
  const CELL_WALL = 1;   // obstacle : bloque la LDV et le déplacement
  const CELL_HOLE = 2;   // trou : bloque le déplacement, laisse passer la LDV

  function makeMap(grid) {
    return {
      grid,
      cells: new Uint8Array(grid.size),
      startA: new Set(),
      startB: new Set(),
      blocksLos(id) { return this.cells[id] === CELL_WALL; },
      walkable(id) { return this.cells[id] === CELL_FREE; },
    };
  }

  /** Générateur pseudo-aléatoire déterministe (mulberry32) : cartes reproductibles. */
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Hache une graine textuelle en entier 32 bits. */
  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  /** Cellules voisines franchissables (4 directions dans le repère diamant). */
  function neighbors(grid, id) {
    const { x, y } = grid.idToCoord(id);
    const out = [];
    const cand = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
    for (const [nx, ny] of cand) {
      const nid = grid.coordToId(nx, ny);
      if (nid >= 0) out.push(nid);
    }
    return out;
  }

  /**
   * Génère une carte : obstacles aléatoires (par amas, plus lisibles que du
   * bruit pur), zones de départ opposées dégagées, et connectivité garantie
   * entre les deux zones.
   */
  function generateMap(grid, seedStr, densityPct) {
    const map = makeMap(grid);
    const rng = makeRng(hashSeed(String(seedStr)));
    const density = densityPct / 100;

    // --- Zones de départ : deux colonnes à chaque extrémité, tiers médian ---
    const rowLo = Math.floor(grid.rows / 3), rowHi = Math.ceil(grid.rows * 2 / 3);
    const zoneW = Math.min(2, Math.max(1, Math.floor(grid.W / 4)));
    for (let r = rowLo; r < rowHi; r++) {
      for (let c = 0; c < zoneW; c++) {
        map.startA.add(r * grid.W + c);
        map.startB.add(r * grid.W + (grid.W - 1 - c));
      }
    }

    // --- Obstacles : amas de 1 à 4 cellules ---
    const target = Math.floor(grid.size * density);
    let placed = 0, guard = 0;
    while (placed < target && guard++ < grid.size * 20) {
      let id = Math.floor(rng() * grid.size);
      const clump = 1 + Math.floor(rng() * 4);
      for (let k = 0; k < clump && placed < target; k++) {
        if (map.cells[id] === CELL_FREE && !map.startA.has(id) && !map.startB.has(id)) {
          map.cells[id] = rng() < 0.12 ? CELL_HOLE : CELL_WALL;
          placed++;
        }
        const nb = neighbors(grid, id);
        if (!nb.length) break;
        id = nb[Math.floor(rng() * nb.length)];
      }
    }

    // --- Zones de départ toujours dégagées ---
    for (const id of map.startA) map.cells[id] = CELL_FREE;
    for (const id of map.startB) map.cells[id] = CELL_FREE;

    carveConnection(grid, map);
    return map;
  }

  /**
   * Garantit qu'un chemin franchissable relie les deux zones de départ.
   * Dijkstra où franchir un obstacle coûte cher : on suit le chemin le moins
   * coûteux et on dégage les obstacles rencontrés (au minimum).
   */
  function carveConnection(grid, map) {
    const from = [...map.startA][Math.floor(map.startA.size / 2)];
    const goal = new Set(map.startB);
    const INF = Infinity;
    const dist = new Float64Array(grid.size).fill(INF);
    const prev = new Int32Array(grid.size).fill(-1);
    const seen = new Uint8Array(grid.size);
    dist[from] = 0;

    // File de priorité simpliste : suffisante pour quelques centaines de cellules.
    const queue = [from];
    let target = -1;
    while (queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (dist[queue[i]] < dist[queue[bi]]) bi = i;
      const cur = queue.splice(bi, 1)[0];
      if (seen[cur]) continue;
      seen[cur] = 1;
      if (goal.has(cur)) { target = cur; break; }
      for (const nb of neighbors(grid, cur)) {
        if (seen[nb]) continue;
        const cost = map.cells[nb] === CELL_FREE ? 1 : 60;
        if (dist[cur] + cost < dist[nb]) {
          dist[nb] = dist[cur] + cost;
          prev[nb] = cur;
          queue.push(nb);
        }
      }
    }
    if (target < 0) return;
    for (let id = target; id !== -1; id = prev[id]) map.cells[id] = CELL_FREE;
  }

  /* ========================================================================
     Projection isométrique
     ------------------------------------------------------------------------
     Partagée par toutes les interfaces : la formule ne doit exister qu'à un
     seul endroit, sous peine de dériver d'une page à l'autre.

     `hw` et `hh` sont la demi-largeur et la demi-hauteur d'une cellule. Le
     ratio 2:1 (hh = hw / 2) donne l'aplatissement du jeu.
     ======================================================================== */

  /** Centre d'une cellule, en pixels, depuis ses coordonnées diamant. */
  function cellCenter(coord, hw, hh) {
    return { px: (coord.x - coord.y) * hw + hw, py: (coord.x + coord.y) * hh + hh };
  }

  /**
   * Cellule sous un point — l'inverse exact de cellCenter.
   * Une cellule étant un carré unité dans le repère diamant, arrondir chaque
   * coordonnée indépendamment désigne toujours la bonne case.
   */
  function pickCoord(px, py, hw, hh) {
    const u = (px - hw) / hw;   // u = x - y
    const v = (py - hh) / hh;   // v = x + y
    return { x: Math.round((u + v) / 2), y: Math.round((v - u) / 2) };
  }

  /** Dimensions du plateau en pixels. */
  function boardSize(grid, hw, hh) {
    return { width: (2 * grid.W + 1) * hw, height: (2 * grid.rows + 1) * hh };
  }

  return {
    makeGrid, cellDistance,
    cellCenter, pickCoord, boardSize,
    cmpFrac, slabInterval, segmentEntersCell, traversedCells, lineOfSight,
    CELL_FREE, CELL_WALL, CELL_HOLE,
    makeMap, makeRng, hashSeed, neighbors, generateMap, carveConnection,
  };
});
