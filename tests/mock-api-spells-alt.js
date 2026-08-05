/**
 * Fausse API DÉGRADÉE : la classe ne porte aucune liste de sorts.
 *
 * Ce cas ne doit pas produire un « aucun sort » muet — c'est précisément ce
 * qui avait fait perdre deux runs en production. Le script doit exposer les
 * champs réellement reçus, puis échouer proprement.
 */

const BREEDS = [
  { id: 8, shortName: { fr: "Iop" }, name: { fr: "Iop" }, someOtherField: 42 },
  { id: 9, shortName: { fr: "Crâ" }, name: { fr: "Crâ" }, someOtherField: 7 },
];

const EFFECTS = [{ id: 97, description: { fr: "#1{{~1~2 à }}#2 dommages Terre" } }];

function paginate(rows, url) {
  const limit = Number(url.searchParams.get("$limit") || 50);
  const skip = Number(url.searchParams.get("$skip") || 0);
  return { total: rows.length, limit, skip, data: rows.slice(skip, skip + limit) };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  if ([...url.searchParams.keys()].some((k) => k.includes("[$in]"))) {
    return { ok: false, status: 500, json: async () => ({ message: "filtre groupé refusé" }) };
  }
  let rows;
  if (url.pathname === "/effects") rows = EFFECTS;
  else if (url.pathname === "/breeds") rows = BREEDS;
  else if (url.pathname === "/spell-levels") rows = [];
  else if (url.pathname === "/spells") rows = [];
  else return { ok: false, status: 404, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => paginate(rows, url) };
};
