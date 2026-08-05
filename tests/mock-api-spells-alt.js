/**
 * Variante de fausse API où la liaison classe → sorts N'EST PAS `breedId`.
 *
 * C'est le cas rencontré en production : `/spells?breedId=8` répond sans erreur
 * mais sans résultat, la classe porte la liste de ses sorts dans
 * `breedSpellsId`, et les filtres groupés `$in` font tomber l'API en HTTP 500.
 * Seule l'égalité `?id=<n>` fonctionne — le script doit s'y plier.
 */

const BREEDS = [
  { id: 8, shortName: { fr: "Iop" }, name: { fr: "Iop" }, breedSpellsId: [201, 202] },
  { id: 9, shortName: { fr: "Crâ" }, name: { fr: "Crâ" }, breedSpellsId: [203] },
  { id: 1, shortName: { fr: "Féca" }, name: { fr: "Féca" }, breedSpellsId: [204] },
];

const EFFECTS = [
  { id: 97, description: { fr: "#1{{~1~2 à }}#2 dommages Terre" } },
  { id: 98, description: { fr: "#1{{~1~2 à }}#2 dommages Air" } },
  { id: 81, description: { fr: "#1{{~1~2 à }}#2 soins" } },
];

function mkLevel(grade, apCost, range, effects) {
  return {
    grade, apCost, minRange: 1, range,
    castTestLos: true, criticalHitProbability: 30, minPlayerLevel: 1,
    zoneDescr: { shape: 80, param1: 0 },
    effects: effects.map(([effectId, diceNum, diceSide]) =>
      ({ effectId, diceNum, diceSide, value: 0, duration: 0 })),
    criticalEffects: [],
  };
}

const SPELLS = [
  { id: 201, name: { fr: "Pression" }, spellLevels: [mkLevel(6, 4, 1, [[97, 16, 20]])] },
  { id: 202, name: { fr: "Épée Divine" }, spellLevels: [mkLevel(6, 5, 3, [[97, 25, 30]])] },
  { id: 203, name: { fr: "Flèche Magique" }, spellLevels: [mkLevel(6, 4, 8, [[98, 21, 25]])] },
  { id: 204, name: { fr: "Armure Féca" }, spellLevels: [mkLevel(6, 3, 0, [[81, 10, 20]])] },
];

function paginate(rows, url) {
  const limit = Number(url.searchParams.get("$limit") || 50);
  const skip = Number(url.searchParams.get("$skip") || 0);
  return { total: rows.length, limit, skip, data: rows.slice(skip, skip + limit) };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  let rows;
  if (url.pathname === "/effects") rows = EFFECTS;
  else if (url.pathname === "/breeds") rows = BREEDS;
  else if (url.pathname === "/spells") {
    // Le filtre par classe ne donne RIEN, quel que soit son nom : c'est le
    // comportement observé en production.
    const parClasse = ["breedId", "breed", "classId", "characterClassId", "typeId"]
      .some((c) => url.searchParams.has(c));
    if (parClasse) rows = [];
    else if ([...url.searchParams.keys()].some((k) => k.includes("[$in]"))) {
      // Comme la vraie API : un filtre groupé fait tomber la requête.
      return { ok: false, status: 500, json: async () => ({ message: "filtre groupé refusé" }) };
    } else {
      const id = url.searchParams.get("id");
      rows = id === null ? SPELLS : SPELLS.filter((s) => s.id === Number(id));
    }
  } else return { ok: false, status: 404, json: async () => ({}) };

  return { ok: true, status: 200, json: async () => paginate(rows, url) };
};
