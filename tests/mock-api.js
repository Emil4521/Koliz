/**
 * Préchargement Node (--require) qui remplace fetch par une fausse API DofusDB.
 * Permet de tester fetch_items.js de bout en bout sans accès réseau.
 */
const TYPES = [
  { id: 1, name: { fr: "Amulette" }, superTypeId: 1 },
  { id: 9, name: { fr: "Anneau" }, superTypeId: 3 },
  { id: 11, name: { fr: "Ceinture" }, superTypeId: 4 },
  { id: 10, name: { fr: "Bottes" }, superTypeId: 5 },
  { id: 16, name: { fr: "Chapeau" }, superTypeId: 8 },
  { id: 17, name: { fr: "Cape" }, superTypeId: 9 },
  { id: 82, name: { fr: "Bouclier" }, superTypeId: 82 },
  { id: 7, name: { fr: "Épée" }, superTypeId: 2 },
  { id: 19, name: { fr: "Arc" }, superTypeId: 2 },
  { id: 23, name: { fr: "Dofus" }, superTypeId: 23 },
  { id: 99, name: { fr: "Ressource" }, superTypeId: 99 },      // non classé
  { id: 98, name: { fr: "Potion" }, superTypeId: 98 },         // non classé
];

const EFFECTS = [
  { id: 125, description: { fr: "+#1{~1~2 à }#2 Vitalité" }, characteristic: 11, operator: "+" },
  { id: 118, description: { fr: "+#1{~1~2 à }#2 Force" }, characteristic: 10, operator: "+" },
  { id: 123, description: { fr: "+#1{~1~2 à }#2 Chance" }, characteristic: 13, operator: "+" },
  { id: 119, description: { fr: "+#1{~1~2 à }#2 Agilité" }, characteristic: 14, operator: "+" },
  { id: 126, description: { fr: "+#1{~1~2 à }#2 Intelligence" }, characteristic: 15, operator: "+" },
  { id: 124, description: { fr: "+#1{~1~2 à }#2 Sagesse" }, characteristic: 12, operator: "+" },
  { id: 111, description: { fr: "+#1{~1~2 à }#2 PA" }, characteristic: 1, operator: "+" },
  { id: 128, description: { fr: "+#1{~1~2 à }#2 PM" }, characteristic: 23, operator: "+" },
  { id: 112, description: { fr: "+#1{~1~2 à }#2 Dommages" }, characteristic: 16, operator: "+" },
  { id: 115, description: { fr: "+#1{~1~2 à }#2 % Critique" }, characteristic: 18, operator: "+" },
  { id: 138, description: { fr: "+#1{~1~2 à }#2 % Dommages" }, characteristic: 25, operator: "+" },
  { id: 210, description: { fr: "+#1{~1~2 à }#2 % Résistance Terre" }, characteristic: 36, operator: "+" },
  { id: 240, description: { fr: "+#1{~1~2 à }#2 Résistance Feu" }, characteristic: 41, operator: "+" },
  // Divergence délibérée avec EFFECT_CROSSCHECK (158 attendu = "Soins")
  { id: 158, description: { fr: "+#1{~1~2 à }#2 Prospection" }, characteristic: 26, operator: "+" },
  // Effet sans statistique agrégée : doit rester affichable, non cumulé
  { id: 400, description: { fr: "Rend l'objet Non Échangeable" }, characteristic: null, operator: null },
];

function mkItem(id, typeId, level, name, effects, extra = {}) {
  return {
    id, typeId, level, name: { fr: name },
    possibleEffects: effects.map(([effectId, diceNum, diceSide]) => ({ effectId, diceNum, diceSide, value: 0 })),
    ...extra,
  };
}

const ITEMS = [
  mkItem(1, 16, 20, "Coiffe de test", [[125, 20, 40], [118, 5, 10]], { itemSetId: 1 }),
  mkItem(2, 17, 20, "Cape de test", [[125, 15, 30], [124, 3, 8]], { itemSetId: 1 }),
  mkItem(3, 1, 20, "Amulette de test", [[126, 5, 12], [115, 1, 3]], { itemSetId: 1 }),
  mkItem(4, 9, 20, "Anneau de test", [[123, 4, 9]], { itemSetId: 1 }),
  mkItem(5, 11, 20, "Ceinture de test", [[119, 6, 14]], { itemSetId: 1 }),
  mkItem(6, 10, 20, "Bottes de test", [[128, 1, 1]], { itemSetId: 1 }),
  mkItem(7, 7, 30, "Épée de test", [[112, 3, 7]], {
    apCost: 4, range: 1, minRange: 1, criticalHitProbability: 30,
    criticalHitBonus: 2, twoHanded: false, maxCastPerTurn: 2,
  }),
  mkItem(8, 19, 50, "Arc de test", [[112, 5, 11]], {
    apCost: 5, range: 7, minRange: 2, criticalHitProbability: 25, twoHanded: true,
  }),
  mkItem(9, 23, 100, "Dofus de test", [[125, 100, 100]], {}),
  mkItem(10, 82, 60, "Bouclier de test", [[210, 5, 10], [240, 8, 15]], {}),
  mkItem(11, 99, 1, "Bois de test", [[125, 1, 1]], {}),          // type non classé
  mkItem(12, 16, 200, "Coiffe sans effet", [], {}),              // aucun effet utile
  mkItem(13, 16, 150, "Coiffe effet inconnu", [[400, 1, 1], [125, 50, 60]], {}),
  mkItem(14, 9, 40, "Anneau bornes inversées", [[118, 12, 4]], {}),  // max < min
];

const SETS = [
  {
    id: 1, name: { fr: "Panoplie de test" },
    items: [1, 2, 3, 4, 5, 6],
    effects: [
      [{ effectId: 125, diceNum: 10, diceSide: 0, value: 0 }],                 // 2 pièces
      [{ effectId: 118, diceNum: 15, diceSide: 0, value: 0 }],                 // 3 pièces
      [{ effectId: 125, diceNum: 30, diceSide: 0 }, { effectId: 111, diceNum: 1, diceSide: 0 }], // 4
      [], [],
    ],
  },
];

function paginate(rows, url) {
  const limit = Number(url.searchParams.get("$limit") || 50);
  const skip = Number(url.searchParams.get("$skip") || 0);
  return { total: rows.length, limit, skip, data: rows.slice(skip, skip + limit) };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  let rows;
  if (url.pathname === "/item-types") rows = TYPES;
  else if (url.pathname === "/effects") rows = EFFECTS;
  else if (url.pathname === "/item-sets") rows = SETS;
  else if (url.pathname === "/items") {
    const allowed = new Set(
      [...url.searchParams.entries()]
        .filter(([k]) => k.startsWith("typeId[$in]"))
        .map(([, v]) => Number(v))
    );
    rows = allowed.size ? ITEMS.filter((i) => allowed.has(i.typeId)) : ITEMS;
  } else {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  const body = paginate(rows, url);
  return { ok: true, status: 200, json: async () => body };
};
