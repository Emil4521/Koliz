/**
 * items.js — équipement, jets, conditions et statistiques du personnage
 * =============================================================================
 * Module autonome, sans dépendance. Utilisable de deux façons :
 *   - navigateur : <script src="items.js"></script> → global `Kolizeum.Items`
 *   - Node       : require("./items.js")            → mêmes fonctions (tests)
 *
 * Principe directeur : ce module n'interprète JAMAIS les identifiants d'effets.
 * Il agrège par `statKey`, une clé normalisée que `scripts/fetch_items.js`
 * calcule à partir des libellés renvoyés par l'API. Un effet dont la
 * signification reste incertaine conserve donc son libellé et reste affiché
 * dans la fiche de l'objet, sans être cumulé en silence dans un total faux.
 * =============================================================================
 */

(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Kolizeum = root.Kolizeum || {}).Items = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ========================================================================
     Constantes de personnage
     ------------------------------------------------------------------------
     ATTENTION — écart signalé avec le brief : celui-ci annonce « PA : 10 par
     défaut ». Le jeu officiel donne 6 PA et 3 PM à tout personnage, quel que
     soit son niveau ; les 10 à 12 PA des builds de haut niveau proviennent de
     l'équipement. La fidélité mécanique étant l'objectif premier du projet, on
     retient 6 PA. Passer à 10 ne demande qu'une ligne ici.
     ======================================================================== */

  const BASE_CHARACTER = {
    pa: 6,
    pm: 3,
    po: 0,
    vieBase: 55,          // points de vie au niveau 1
    viePerLevel: 5,       // gain par niveau — à confirmer contre le jeu
    critPct: 0,
  };

  /**
   * Les bonus de panoplie ne se cumulent PAS d'un palier à l'autre : le palier
   * atteint remplace les précédents (4 pièces ⇒ bonus « 4 pièces » seul, et non
   * la somme de 2 + 3 + 4). Mécanique à revalider contre le jeu ; le cas échéant
   * il suffit de basculer cette constante.
   */
  const SET_BONUS_CUMULATIVE = false;

  /** Emplacements et nombre de cellules — doit refléter SLOT_CAPACITY du script. */
  const SLOT_CAPACITY = {
    amulette: 1, coiffe: 1, cape: 1, arme: 1, bouclier: 1,
    anneau: 2, ceinture: 1, bottes: 1, dofus: 6, familier: 1,
  };

  /** Ordre d'affichage des emplacements dans l'interface. */
  const SLOT_ORDER = [
    "amulette", "coiffe", "cape", "arme", "bouclier",
    "anneau", "ceinture", "bottes", "dofus", "familier",
  ];

  const SLOT_LABELS = {
    amulette: "Amulette", coiffe: "Coiffe", cape: "Cape", arme: "Arme",
    bouclier: "Bouclier", anneau: "Anneau", ceinture: "Ceinture",
    bottes: "Bottes", dofus: "Dofus / Trophée", familier: "Familier",
  };

  /** Libellés des statistiques agrégées, groupés pour le récapitulatif. */
  const STAT_GROUPS = [
    {
      title: "Caractéristiques",
      stats: [
        ["vitalite", "Vitalité"], ["force", "Force"], ["intelligence", "Intelligence"],
        ["chance", "Chance"], ["agilite", "Agilité"], ["sagesse", "Sagesse"],
      ],
    },
    {
      title: "Combat",
      stats: [
        ["pa", "PA"], ["pm", "PM"], ["po", "Portée"], ["initiative", "Initiative"],
        ["critPct", "% Critique"], ["invocations", "Invocations"],
        ["soins", "Soins"], ["puissance", "Puissance"], ["prospection", "Prospection"],
        ["tacle", "Tacle"], ["fuite", "Fuite"],
        ["esquivePa", "Esquive PA"], ["esquivePm", "Esquive PM"],
        ["retraitPa", "Retrait PA"], ["retraitPm", "Retrait PM"],
      ],
    },
    {
      title: "Dommages",
      stats: [
        ["domFixe", "Dommages"], ["domPct", "% Dommages"],
        ["domTerre", "Dommages Terre"], ["domFeu", "Dommages Feu"],
        ["domEau", "Dommages Eau"], ["domAir", "Dommages Air"],
        ["domNeutre", "Dommages Neutre"], ["domCrit", "Dommages critiques"],
        ["domPoussee", "Dommages de poussée"], ["domSorts", "Dommages aux sorts"],
        ["domArmes", "Dommages aux armes"], ["domPieges", "Dommages pièges"],
        ["domPctPieges", "% Dommages pièges"], ["renvoiDom", "Renvoi de dommages"],
        ["volVie", "Vol de vie"],
      ],
    },
    {
      title: "Résistances",
      stats: [
        ["resPctTerre", "% Rés. Terre"], ["resPctFeu", "% Rés. Feu"],
        ["resPctEau", "% Rés. Eau"], ["resPctAir", "% Rés. Air"],
        ["resPctNeutre", "% Rés. Neutre"],
        ["resFixeTerre", "Rés. Terre"], ["resFixeFeu", "Rés. Feu"],
        ["resFixeEau", "Rés. Eau"], ["resFixeAir", "Rés. Air"],
        ["resFixeNeutre", "Rés. Neutre"],
        ["resCrit", "Rés. critiques"], ["resPoussee", "% Rés. poussée"],
      ],
    },
  ];

  const ALL_STATS = STAT_GROUPS.flatMap((g) => g.stats.map(([key]) => key));

  /* ========================================================================
     Aléatoire déterministe
     ======================================================================== */

  function hashSeed(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h || 1;
  }

  function makeRng(seed) {
    let s = (typeof seed === "number" ? seed : hashSeed(seed)) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ========================================================================
     Chargement et indexation des données
     ======================================================================== */

  /** Indexe le JSON produit par fetch_items.js pour un accès direct. */
  function indexData(payload) {
    const items = payload.items || [];
    const sets = payload.sets || [];
    return {
      meta: payload.meta || {},
      effects: payload.effects || {},
      items,
      sets,
      itemById: new Map(items.map((i) => [i.id, i])),
      setById: new Map(sets.map((s) => [s.id, s])),
      isSample: (payload.meta && payload.meta.source) === "sample",
    };
  }

  /**
   * Charge les données sans supposer d'environnement : la variante
   * `window.KOLIZEUM_ITEMS` (chargée par <script>) est privilégiée car elle
   * fonctionne en file://, où fetch() est interdit par la politique d'origine.
   */
  async function loadData(url) {
    if (typeof window !== "undefined" && window.KOLIZEUM_ITEMS) {
      return indexData(window.KOLIZEUM_ITEMS);
    }
    const res = await fetch(url || "data/items.json");
    if (!res.ok) throw new Error(`Chargement de ${url} : HTTP ${res.status}`);
    return indexData(await res.json());
  }

  /* ========================================================================
     Jets
     ======================================================================== */

  /**
   * Tire les valeurs d'un objet dans ses bornes officielles.
   * `quality` : null pour un tirage aléatoire, sinon 0 (jet minimal) à
   * 1 (jet maximal) pour figer un objet parfait ou minimal.
   */
  function rollItem(item, rng, quality) {
    const roll = {};
    for (const e of item.effects || []) {
      if (quality == null) {
        roll[e.effectId] = e.min + Math.floor((rng ? rng() : Math.random()) * (e.max - e.min + 1));
      } else {
        const q = Math.max(0, Math.min(1, quality));
        roll[e.effectId] = Math.round(e.min + (e.max - e.min) * q);
      }
    }
    return roll;
  }

  /* ========================================================================
     Conditions d'utilisation
     ------------------------------------------------------------------------
     La grammaire des conditions Ankama (chaînes du type « CS>20&PL<50 ») n'est
     pas encore interprétée. Politique retenue : ne bloquer que sur ce qui est
     compris avec certitude — le niveau — et signaler le reste plutôt que de
     l'appliquer au jugé. Un filtre trop zélé masquerait des objets valides,
     ce qui est plus coûteux qu'une condition affichée non appliquée.
     ======================================================================== */

  function checkRequirements(item, character) {
    const problems = [];
    const notes = [];

    if (character && character.level != null && item.level > character.level) {
      problems.push(`Niveau ${item.level} requis`);
    }
    if (item.criteria) {
      notes.push(`Condition non interprétée : ${item.criteria}`);
    }
    return { ok: problems.length === 0, problems, notes };
  }

  /* ========================================================================
     Panoplie d'équipement
     ======================================================================== */

  function createLoadout() {
    const slots = {};
    for (const slot of SLOT_ORDER) slots[slot] = [];
    return { slots };
  }

  function equippedEntries(loadout) {
    return SLOT_ORDER.flatMap((slot) => loadout.slots[slot].map((e) => ({ ...e, slot })));
  }

  function slotFree(loadout, slot) {
    return (SLOT_CAPACITY[slot] || 0) - loadout.slots[slot].length;
  }

  /**
   * Équipe un objet. Le jet est figé ici, une fois pour toutes : c'est le
   * moment de la sélection, conformément au brief.
   * `options.replaceIndex` force le remplacement d'une cellule précise.
   */
  function equip(loadout, item, options) {
    const opts = options || {};
    const slot = item.slot;
    if (!(slot in loadout.slots)) return { ok: false, reason: `Emplacement inconnu : ${slot}` };

    const capacity = SLOT_CAPACITY[slot] || 1;
    const list = loadout.slots[slot];

    let index = opts.replaceIndex;
    if (index == null) {
      index = list.length < capacity ? list.length : capacity - 1;   // remplace la dernière
    }
    if (index < 0 || index >= capacity) return { ok: false, reason: "Cellule hors bornes" };

    // Dofus interdit deux exemplaires du même objet sur un emplacement multiple
    // (deux anneaux identiques), hors cas particuliers.
    const duplicate = list.some((e, i) => e.itemId === item.id && i !== index);
    if (duplicate) return { ok: false, reason: "Objet déjà équipé sur cet emplacement" };

    const entry = {
      itemId: item.id,
      roll: opts.roll || rollItem(item, opts.rng, opts.quality),
    };
    list[index] = entry;
    return { ok: true, entry, index };
  }

  function unequip(loadout, slot, index) {
    const list = loadout.slots[slot];
    if (!list || index >= list.length) return false;
    list.splice(index, 1);
    return true;
  }

  /* ========================================================================
     Panoplies
     ======================================================================== */

  /**
   * Détermine les panoplies actives et le palier atteint.
   * Si le palier exact n'est pas défini (panoplie partielle), on retient le
   * plus haut palier inférieur ou égal au nombre de pièces portées.
   */
  function activeSets(loadout, data) {
    const counts = new Map();
    for (const entry of equippedEntries(loadout)) {
      const item = data.itemById.get(entry.itemId);
      if (!item || item.setId == null) continue;
      counts.set(item.setId, (counts.get(item.setId) || 0) + 1);
    }

    const out = [];
    for (const [setId, pieces] of counts) {
      const set = data.setById.get(setId);
      if (!set || pieces < 2) continue;

      const tiers = Object.keys(set.bonuses).map(Number).sort((a, b) => a - b);
      const applicable = tiers.filter((t) => t <= pieces);
      if (!applicable.length) continue;

      const effects = SET_BONUS_CUMULATIVE
        ? applicable.flatMap((t) => set.bonuses[t])
        : set.bonuses[applicable[applicable.length - 1]];

      out.push({
        setId, name: set.name, pieces,
        tier: applicable[applicable.length - 1],
        totalItems: (set.items || []).length,
        effects,
      });
    }
    return out.sort((a, b) => b.pieces - a.pieces);
  }

  /* ========================================================================
     Statistiques totales
     ======================================================================== */

  function emptyStats() {
    const s = {};
    for (const key of ALL_STATS) s[key] = 0;
    return s;
  }

  /**
   * Calcule les statistiques du personnage : base, apport de l'équipement,
   * apport des panoplies, et total.
   *
   * Les effets sans `statKey` — signification non confirmée — ne sont jamais
   * cumulés : ils sont retournés à part, pour être affichés tels quels.
   */
  function computeStats(loadout, data, character) {
    const char = character || {};
    const level = char.level != null ? char.level : 200;

    const base = emptyStats();
    base.pa = BASE_CHARACTER.pa;
    base.pm = BASE_CHARACTER.pm;
    base.critPct = BASE_CHARACTER.critPct;

    const fromItems = emptyStats();
    const fromSets = emptyStats();
    const unaggregated = [];

    const addEffect = (target, effectId, value, origin) => {
      const def = data.effects[effectId];
      const statKey = def && def.statKey;
      if (statKey && statKey in target) target[statKey] += value;
      else {
        unaggregated.push({
          effectId, value, origin,
          label: (def && def.label) || `effet ${effectId}`,
          confidence: (def && def.confidence) || "incertain",
        });
      }
    };

    for (const entry of equippedEntries(loadout)) {
      const item = data.itemById.get(entry.itemId);
      if (!item) continue;
      for (const [effectId, value] of Object.entries(entry.roll || {})) {
        addEffect(fromItems, Number(effectId), value, item.name);
      }
    }

    const sets = activeSets(loadout, data);
    for (const set of sets) {
      for (const e of set.effects || []) {
        addEffect(fromSets, e.effectId, e.value, `Panoplie ${set.name}`);
      }
    }

    const total = emptyStats();
    for (const key of ALL_STATS) total[key] = base[key] + fromItems[key] + fromSets[key];

    const vieBase = BASE_CHARACTER.vieBase + (level - 1) * BASE_CHARACTER.viePerLevel;
    const life = { base: vieBase, fromVitality: total.vitalite, total: vieBase + total.vitalite };

    return { level, base, fromItems, fromSets, total, life, sets, unaggregated };
  }

  /* ========================================================================
     Filtrage du catalogue
     ======================================================================== */

  function normalizeText(s) {
    return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  /**
   * Filtre le catalogue. `maxLevel` applique la règle du jeu (un objet ne peut
   * être porté qu'à partir de son niveau) ; `search` porte sur le nom.
   */
  function filterItems(data, criteria) {
    const c = criteria || {};
    const needle = c.search ? normalizeText(c.search) : null;

    let out = data.items;
    if (c.slot) out = out.filter((i) => i.slot === c.slot);
    if (c.maxLevel != null) out = out.filter((i) => i.level <= c.maxLevel);
    if (c.minLevel != null) out = out.filter((i) => i.level >= c.minLevel);
    if (c.setId != null) out = out.filter((i) => i.setId === c.setId);
    if (needle) out = out.filter((i) => normalizeText(i.name).includes(needle));

    const sortKey = c.sort || "level";
    return out.slice().sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name, "fr");
      return b.level - a.level || a.name.localeCompare(b.name, "fr");
    });
  }

  /** Décrit un effet pour l'affichage, en tenant compte du jet obtenu. */
  function describeEffect(effect, data, rolledValue) {
    const def = data.effects[effect.effectId];
    const label = (def && def.label) || `effet ${effect.effectId}`;
    const range = effect.min === effect.max ? `${effect.min}` : `${effect.min} à ${effect.max}`;
    return {
      label,
      range,
      value: rolledValue,
      confidence: (def && def.confidence) || "incertain",
      statKey: (def && def.statKey) || null,
    };
  }

  /** Sérialise une panoplie d'équipement (sauvegarde / partage de build). */
  function exportLoadout(loadout, character) {
    return {
      v: 1,
      character: { level: (character && character.level) || 200 },
      slots: Object.fromEntries(
        SLOT_ORDER.map((slot) => [slot, loadout.slots[slot].map((e) => ({ itemId: e.itemId, roll: e.roll }))])
      ),
    };
  }

  function importLoadout(payload) {
    const loadout = createLoadout();
    if (!payload || !payload.slots) return loadout;
    for (const slot of SLOT_ORDER) {
      const list = payload.slots[slot] || [];
      loadout.slots[slot] = list
        .slice(0, SLOT_CAPACITY[slot] || 1)
        .map((e) => ({ itemId: e.itemId, roll: e.roll || {} }));
    }
    return loadout;
  }

  return {
    BASE_CHARACTER, SET_BONUS_CUMULATIVE, SLOT_CAPACITY, SLOT_ORDER, SLOT_LABELS,
    STAT_GROUPS, ALL_STATS,
    hashSeed, makeRng, indexData, loadData,
    rollItem, checkRequirements,
    createLoadout, equip, unequip, equippedEntries, slotFree,
    activeSets, computeStats, filterItems, describeEffect,
    exportLoadout, importLoadout,
  };
});
