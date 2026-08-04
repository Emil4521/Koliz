#!/usr/bin/env node
/**
 * make_sample.js — jeu de données d'exemple pour l'interface d'équipement
 * =============================================================================
 * L'accès à api.dofusdb.fr n'est pas toujours disponible (réseau, politique de
 * sortie, API en panne). Ce script produit un jeu de données au FORMAT EXACT de
 * `fetch_items.js`, afin que l'interface soit utilisable et testable sans
 * réseau.
 *
 * Les objets sont VOLONTAIREMENT FICTIFS : noms inventés, valeurs inventées.
 * Aucun ne correspond à un objet du jeu, précisément pour qu'on ne puisse pas
 * les confondre avec des données officielles ni s'en servir pour équilibrer
 * quoi que ce soit. Les vraies données proviennent de `fetch_items.js`, qui
 * écrase ces fichiers.
 *
 *   node scripts/make_sample.js
 *
 * Sorties : client/data/items.sample.json et client/data/items.sample.data.js
 * =============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { normalize, labelFromTemplate, STAT_BY_LABEL, SLOT_CAPACITY } = require("./fetch_items.js");

const OUT_DIR = path.join(__dirname, "..", "client", "data");

/** Effets, décrits comme l'API les renvoie, pour passer par le même traitement. */
const EFFECT_TEMPLATES = {
  111: "+#1{~1~2 à }#2 PA",
  112: "+#1{~1~2 à }#2 Dommages",
  115: "+#1{~1~2 à }#2 % Critique",
  118: "+#1{~1~2 à }#2 Force",
  119: "+#1{~1~2 à }#2 Agilité",
  123: "+#1{~1~2 à }#2 Chance",
  124: "+#1{~1~2 à }#2 Sagesse",
  125: "+#1{~1~2 à }#2 Vitalité",
  126: "+#1{~1~2 à }#2 Intelligence",
  128: "+#1{~1~2 à }#2 PM",
  138: "+#1{~1~2 à }#2 % Dommages",
  160: "+#1{~1~2 à }#2 Initiative",
  174: "+#1{~1~2 à }#2 Portée",
  178: "+#1{~1~2 à }#2 Invocations",
  182: "+#1{~1~2 à }#2 Tacle",
  184: "+#1{~1~2 à }#2 Fuite",
  210: "+#1{~1~2 à }#2 % Résistance Terre",
  211: "+#1{~1~2 à }#2 % Résistance Feu",
  212: "+#1{~1~2 à }#2 % Résistance Eau",
  213: "+#1{~1~2 à }#2 % Résistance Air",
  214: "+#1{~1~2 à }#2 % Résistance Neutre",
  240: "+#1{~1~2 à }#2 Résistance Feu",
  241: "+#1{~1~2 à }#2 Résistance Terre",
  400: "Rend l'objet Non Échangeable",
};

/* Objets fictifs : [slot, nom, niveau, effets [effectId, min, max], panoplie]. */
const ITEMS = [
  // --- Panoplie d'Entraînement (bas niveau, 6 pièces) — setId 1 ---
  ["coiffe",   "Coiffe d'Entraînement",   20, [[125, 20, 40], [118, 5, 10]], 1],
  ["cape",     "Cape d'Entraînement",     20, [[125, 15, 30], [124, 3, 8]], 1],
  ["amulette", "Amulette d'Entraînement", 20, [[126, 5, 12], [115, 1, 3]], 1],
  ["anneau",   "Anneau d'Entraînement",   20, [[123, 4, 9], [125, 10, 20]], 1],
  ["ceinture", "Ceinture d'Entraînement", 20, [[119, 6, 14]], 1],
  ["bottes",   "Bottes d'Entraînement",   20, [[119, 8, 16], [184, 2, 5]], 1],

  // --- Panoplie du Vétéran (niveau moyen, 5 pièces) — setId 2 ---
  ["coiffe",   "Coiffe du Vétéran",   100, [[125, 60, 90], [118, 20, 35], [115, 2, 4]], 2],
  ["cape",     "Cape du Vétéran",     100, [[125, 50, 80], [118, 15, 30], [160, 20, 40]], 2],
  ["amulette", "Amulette du Vétéran", 100, [[125, 40, 70], [124, 10, 20]], 2],
  ["anneau",   "Anneau du Vétéran",   100, [[118, 25, 40], [138, 3, 6]], 2],
  ["ceinture", "Ceinture du Vétéran", 100, [[118, 20, 35], [182, 3, 7]], 2],

  // --- Panoplie du Colosse (haut niveau, 4 pièces) — setId 3 ---
  ["coiffe",   "Coiffe du Colosse",   190, [[125, 150, 250], [118, 50, 80], [210, 3, 6]], 3],
  ["cape",     "Cape du Colosse",     190, [[125, 120, 200], [124, 30, 50], [211, 3, 6]], 3],
  ["ceinture", "Ceinture du Colosse", 190, [[125, 100, 180], [118, 40, 70], [212, 3, 6]], 3],
  ["bottes",   "Bottes du Colosse",   190, [[125, 100, 180], [119, 40, 70], [213, 3, 6]], 3],

  // --- Pièces isolées, pour tester le filtrage et les emplacements ---
  ["coiffe",   "Casque du Bricoleur",     50, [[125, 30, 50], [124, 8, 15]], null],
  ["coiffe",   "Heaume de Plomb",        150, [[125, 90, 140], [128, -1, -1], [118, 60, 90]], null],
  ["cape",     "Manteau du Voyageur",     60, [[128, 1, 1], [125, 20, 35]], null],
  ["cape",     "Drapé Ancien",           170, [[126, 45, 75], [138, 5, 10]], null],
  ["amulette", "Collier de Verre",        10, [[125, 5, 15]], null],
  ["amulette", "Pendentif du Stratège",  140, [[111, 1, 1], [124, 25, 40]], null],
  ["anneau",   "Bague de Cuivre",         15, [[118, 3, 8]], null],
  ["anneau",   "Anneau du Tacticien",    120, [[174, 1, 1], [124, 15, 25]], null],
  ["anneau",   "Sceau du Colosse",       180, [[125, 110, 170], [118, 45, 75]], null],
  ["ceinture", "Sangle de Cuir",          30, [[125, 15, 30], [119, 5, 12]], null],
  ["ceinture", "Ceinturon de Guerre",    160, [[118, 55, 85], [112, 4, 8]], null],
  ["bottes",   "Sabots Usés",              5, [[119, 2, 6]], null],
  ["bottes",   "Bottes du Coureur",      110, [[128, 1, 1], [119, 30, 50]], null],
  ["bouclier", "Rondache d'Écolier",      35, [[125, 20, 40], [214, 2, 4]], null],
  ["bouclier", "Pavois du Rempart",      175, [[125, 130, 200], [210, 4, 8], [211, 4, 8]], null],
  ["familier", "Petit Compagnon",         60, [[118, 20, 20]], null],
  ["familier", "Compagnon Aguerri",      160, [[125, 100, 100], [138, 5, 5]], null],

  // --- Emplacement Dofus / Trophées (6 cellules) ---
  ["dofus", "Œuf Vert",       100, [[125, 100, 100]], null],
  ["dofus", "Œuf Pourpre",    150, [[112, 8, 8]], null],
  ["dofus", "Œuf Doré",       180, [[124, 50, 50]], null],
  ["dofus", "Trophée de Puissance", 120, [[138, 10, 10], [125, -100, -100]], null],
  ["dofus", "Trophée d'Agilité",    120, [[119, 60, 60], [123, -60, -60]], null],
  ["dofus", "Trophée Scellé",       200, [[400, 1, 1], [125, 150, 150]], null],
];

/* Armes : champs supplémentaires (coût en PA, portée, critiques). */
const WEAPONS = [
  ["Épée d'Entraînement", 20, [[112, 3, 7]], { apCost: 4, minRange: 1, maxRange: 1, criticalHitProbability: 30, criticalHitBonus: 2, twoHanded: false, maxCastPerTurn: 2 }],
  ["Arc du Chasseur", 50, [[112, 5, 11], [119, 10, 20]], { apCost: 5, minRange: 2, maxRange: 7, criticalHitProbability: 25, criticalHitBonus: 3, twoHanded: true, maxCastPerTurn: 2 }],
  ["Marteau du Colosse", 190, [[112, 25, 45], [118, 40, 60]], { apCost: 6, minRange: 1, maxRange: 2, criticalHitProbability: 20, criticalHitBonus: 8, twoHanded: true, maxCastPerTurn: 1 }],
  ["Dague Rapide", 120, [[112, 10, 18], [115, 3, 6]], { apCost: 3, minRange: 1, maxRange: 1, criticalHitProbability: 15, criticalHitBonus: 4, twoHanded: false, maxCastPerTurn: 3 }],
  ["Baguette d'Apprenti", 15, [[112, 2, 5], [126, 3, 8]], { apCost: 4, minRange: 1, maxRange: 4, criticalHitProbability: 40, criticalHitBonus: 1, twoHanded: false, maxCastPerTurn: 2 }],
];

const SETS = [
  {
    id: 1, name: "Panoplie d'Entraînement",
    bonuses: {
      2: [{ effectId: 125, value: 10 }],
      3: [{ effectId: 125, value: 20 }, { effectId: 118, value: 5 }],
      4: [{ effectId: 125, value: 35 }, { effectId: 118, value: 10 }, { effectId: 124, value: 5 }],
      5: [{ effectId: 125, value: 50 }, { effectId: 118, value: 15 }, { effectId: 124, value: 10 }],
      6: [{ effectId: 125, value: 80 }, { effectId: 118, value: 25 }, { effectId: 124, value: 15 }, { effectId: 115, value: 2 }],
    },
  },
  {
    id: 2, name: "Panoplie du Vétéran",
    bonuses: {
      2: [{ effectId: 125, value: 40 }],
      3: [{ effectId: 125, value: 80 }, { effectId: 118, value: 20 }],
      4: [{ effectId: 125, value: 140 }, { effectId: 118, value: 40 }, { effectId: 160, value: 50 }],
      5: [{ effectId: 125, value: 220 }, { effectId: 118, value: 60 }, { effectId: 111, value: 1 }],
    },
  },
  {
    id: 3, name: "Panoplie du Colosse",
    bonuses: {
      2: [{ effectId: 125, value: 100 }],
      3: [{ effectId: 125, value: 200 }, { effectId: 118, value: 50 }],
      4: [{ effectId: 125, value: 350 }, { effectId: 118, value: 80 }, { effectId: 111, value: 1 }, { effectId: 128, value: 1 }],
    },
  },
];

function build() {
  // Table d'effets, construite par le MÊME traitement que la vraie extraction.
  const effects = {};
  for (const [id, template] of Object.entries(EFFECT_TEMPLATES)) {
    const label = labelFromTemplate(template);
    effects[id] = {
      id: Number(id),
      label,
      template,
      characteristic: null,
      operator: "+",
      statKey: STAT_BY_LABEL[normalize(label)] ?? null,
      confidence: "exemple",
    };
  }

  const items = [];
  let nextId = 1;
  for (const [slot, name, level, rawEffects, setId] of ITEMS) {
    items.push({
      id: nextId++, name, slot, type: slot, typeId: 0, level,
      setId: setId ?? null,
      effects: rawEffects.map(([effectId, min, max]) => ({ effectId, min, max })),
    });
  }
  for (const [name, level, rawEffects, weapon] of WEAPONS) {
    items.push({
      id: nextId++, name, slot: "arme", type: "Arme", typeId: 0, level, setId: null,
      effects: rawEffects.map(([effectId, min, max]) => ({ effectId, min, max })),
      weapon,
    });
  }

  const sets = SETS.map((s) => ({
    ...s,
    items: items.filter((i) => i.setId === s.id).map((i) => i.id),
  }));

  const slotCounts = {};
  for (const i of items) slotCounts[i.slot] = (slotCounts[i.slot] || 0) + 1;

  return {
    meta: {
      source: "sample",
      warning: "DONNÉES FICTIVES — objets et valeurs inventés, sans rapport avec le jeu. "
             + "Lancer scripts/fetch_items.js pour les données officielles.",
      lang: "fr",
      generatedAt: new Date().toISOString(),
      counts: { items: items.length, sets: sets.length, effects: Object.keys(effects).length },
      slotCounts,
      slotCapacity: SLOT_CAPACITY,
      warnings: [],
    },
    effects, sets, items,
  };
}

const payload = build();
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, "items.sample.json"), JSON.stringify(payload, null, 1));
// Assignation non destructive : si items.data.js (données officielles) a déjà
// été chargé, il l'emporte. L'exemple ne sert que de repli.
fs.writeFileSync(
  path.join(OUT_DIR, "items.sample.data.js"),
  `/* Données d'exemple — fictives. Voir scripts/make_sample.js. */\n`
  + `window.KOLIZEUM_ITEMS = window.KOLIZEUM_ITEMS || ${JSON.stringify(payload)};\n`
);

console.log(`Exemple écrit : ${payload.items.length} objets, ${payload.sets.length} panoplies, `
          + `${Object.keys(payload.effects).length} effets`);
console.log(`Par emplacement : ${Object.entries(payload.meta.slotCounts).map(([s, n]) => `${s}=${n}`).join("  ")}`);
