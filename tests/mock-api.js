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
  // Gabarits à accolades IMBRIQUÉES, comme ceux renvoyés par la vraie API.
  // Avec l'ancienne extraction ils produisaient « } Vitalité », « } Force »…
  // — c'est la régression que ces entrées verrouillent.
  { id: 125, description: { fr: "+#1{~1~2 à {#2}} Vitalité" }, characteristic: 11, operator: "+" },
  { id: 118, description: { fr: "+#1{~1~2 à {#2}} Force" }, characteristic: 10, operator: "+" },
  { id: 123, description: { fr: "+#1{~1~2 à }#2 Chance" }, characteristic: 13, operator: "+" },
  { id: 119, description: { fr: "+#1{~1~2 à }#2 Agilité" }, characteristic: 14, operator: "+" },
  { id: 126, description: { fr: "+#1{~1~2 à }#2 Intelligence" }, characteristic: 15, operator: "+" },
  { id: 124, description: { fr: "+#1{~1~2 à }#2 Sagesse" }, characteristic: 12, operator: "+" },
  { id: 111, description: { fr: "+#1{~1~2 à {#2}} PA" }, characteristic: 1, operator: "+" },
  { id: 128, description: { fr: "+#1{~1~2 à }#2 PM" }, characteristic: 23, operator: "+" },
  // Singulier côté API, pluriel côté table de recoupement : variation
  // d'écriture, pas divergence de sens — doit rester « vérifié » et résoudre
  // quand même vers domFixe.
  { id: 112, description: { fr: "+#1{~1~2 à {#2}} Dommage" }, characteristic: 16, operator: "+" },
  // Vraie divergence de sens, délibérée : la table attend « % Critique ».
  { id: 115, description: { fr: "+#1{~1~2 à }#2 % Coup Critique" }, characteristic: 18, operator: "+" },
  { id: 138, description: { fr: "+#1{~1~2 à }#2 Puissance" }, characteristic: 25, operator: "+" },
  { id: 210, description: { fr: "+#1{~1~2 à }#2 % Résistance Terre" }, characteristic: 36, operator: "+" },
  { id: 240, description: { fr: "+#1{~1~2 à }#2 Résistance Feu" }, characteristic: 41, operator: "+" },
  // Hors table de recoupement : ressort en « probable ».
  { id: 158, description: { fr: "+#1{~1~2 à }#2 Pod" }, characteristic: 26, operator: "+" },
  // Effet sans statistique agrégée : affichable, non cumulé.
  { id: 400, description: { fr: "Rend l'objet Non Échangeable" }, characteristic: null, operator: null },

  // Effets de SORT, pour que le recoupement des libellés soit exercé.
  { id: 97, description: { fr: "#1{{~1~2 à }}#2 dommages Terre" } },
  { id: 98, description: { fr: "#1{{~1~2 à }}#2 dommages Air" } },
  { id: 81, description: { fr: "#1{{~1~2 à }}#2 soins" } },
  { id: 1040, description: { fr: "#1{{~1~2 à }}#2 Bouclier" } },
  { id: 412, description: { fr: "#1{{~1~2 à }}#2 Retrait PM" } },
  // Pendant NÉGATIF du 128 ci-dessus : les deux se dépouillent en « PM », seul
  // le MOINS initial du gabarit distingue le malus du bonus. C'est ce qui
  // faisait offrir 3 PM à l'adversaire là où Couperet doit lui en retirer 3.
  { id: 127, description: { fr: "-#1{{~1~2 à -}}#2 PM" } },
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
    // L'entrée d'indice i vaut pour i + 1 pièces : l'indice 0 (une pièce) est
    // vide, comme dans les données réelles.
    effects: [
      [],                                                                      // 1 pièce
      [{ effectId: 125, diceNum: 10, diceSide: 0, value: 0 }],                 // 2 pièces
      [{ effectId: 118, diceNum: 15, diceSide: 0, value: 0 }],                 // 3 pièces
      [{ effectId: 125, diceNum: 30, diceSide: 0 }, { effectId: 111, diceNum: 1, diceSide: 0 }], // 4
      [], [],
    ],
  },
];


/* ---------------------------------------------------------------------------
   Sorts — schéma réel de DofusDB, établi en interrogeant l'API à la main :

     /breeds                       breedSpellsId : liste d'identifiants
     /spells/<id>                  nom et description (objet, non paginé)
     /spell-levels?spellId=<id>    coût, portée, zone, effets (paginé)

   Les filtres groupés `$in` et les filtres par classe sur /spells sont
   refusés, exactement comme en production.
   --------------------------------------------------------------------------- */

const BREEDS = [
  { id: 8, shortName: { fr: "Iop" }, name: { fr: "Iop" }, breedSpellsId: [101, 102, 106] },
  { id: 9, shortName: { fr: "Crâ" }, name: { fr: "Crâ" }, breedSpellsId: [103, 104] },
  { id: 1, shortName: { fr: "Féca" }, name: { fr: "Féca" }, breedSpellsId: [105] },
];

/* Variantes — un sort du grimoire a une version alternative, et on emporte
   l'une OU l'autre. Le jumeau ne figure PAS dans `breedSpellsId` : c'est tout
   le problème que cette extraction résout.

   La liaison réelle passe par une collection dédiée, interrogée classe par
   classe : `/spell-variants?breedId=8`. Trois modes rejouables :

     collection  la liaison confirmée (défaut)
     pointeur    un champ `spellVariantId` sur le document de sort (repli)
     aucune      rien du tout : l'état de production d'avant */
const MODE_VARIANTES = process.env.KOLIZEUM_MOCK_VARIANTS || "collection";

function mkSpellDoc(id, name, description, variantId) {
  const doc = { id, name: { fr: name }, description: { fr: description } };
  if (variantId != null && MODE_VARIANTES === "pointeur") doc.spellVariantId = variantId;
  return doc;
}

/* La vraie collection rend une dizaine d'entrées par page quel que soit le
   `$limit` demandé. On plafonne ici à UNE seule, pour éprouver la pagination
   avec un jeu d'essai minuscule : c'est la même propriété — le serveur rend
   moins que ce qu'on réclame — et le script doit s'appuyer sur le nombre de
   lignes reçues, jamais sur la taille de page demandée. */
const VARIANTS_PAR_PAGE = 1;

/* L'ORDRE compte : le seul groupe Iop exploitable est en SECONDE page. Une
   pagination qui s'arrêterait à la première le perdrait, et rien d'autre ne le
   signalerait. */
const SPELL_VARIANTS = [
  // Un seul membre : ce n'est pas un groupe, et Puissance doit rester sans
  // variante plutôt que de devenir un groupe d'un sort.
  { id: 502, breedId: 8, spells: [102] },
  { id: 501, breedId: 8, spells: [101, 107] },
  // Références HYDRATÉES en objets complets, comme l'a fait `set.items` sur
  // les panoplies : la lecture des identifiants doit tenir les deux formes.
  { id: 503, breedId: 9, spells: [{ id: 103 }, { id: 108 }] },
];

const SPELL_DOCS = {
  101: mkSpellDoc(101, "Pression", "Frappe de près.", 501),
  102: mkSpellDoc(102, "Puissance", "Renforce.", 502),          // seule de son groupe
  103: mkSpellDoc(103, "Flèche Magique", "Tire de loin.", 503),
  104: mkSpellDoc(104, "Sort Exotique", "Effets variés."),
  105: mkSpellDoc(105, "Armure Féca", "Protège."),
  106: mkSpellDoc(106, "Sort Sans Palier", "Rien à extraire."),
  // Jumeaux, absents de breedSpellsId : c'est la découverte qui doit les
  // ramener, sans quoi la moitié du grimoire manque.
  107: mkSpellDoc(107, "Pression Éclatée", "Variante de zone.", 501),
  108: mkSpellDoc(108, "Flèche Sombre", "Variante de Flèche Magique.", 503),
};

function mkLevel(spellId, grade, apCost, minRange, range, effects, extra = {}) {
  return {
    spellId, grade, apCost, minRange, range,
    castTestLos: true, rangeCanBeBoosted: false,
    criticalHitProbability: 30, maxCastPerTurn: 2, minPlayerLevel: grade * 10,
    zoneDescr: { shape: 80, param1: 0, param2: 0 },   // 'P' : case unique
    // `targetMask` dit QUI l'effet touche — le lanceur (« C ») n'est pas la
    // cible (« A »). Le moteur ne l'interprète pas encore ; l'extraction doit
    // au moins le recenser pour qu'on sache ce qu'il reste à traiter.
    effects: effects.map(([effectId, diceNum, diceSide, duration, targetMask]) =>
      ({ effectId, diceNum, diceSide, value: 0, duration: duration || 0,
         targetMask: targetMask || "a,A" })),
    criticalEffects: [],
    ...extra,
  };
}

// Plusieurs paliers par sort : seul le plus haut doit être retenu.
const SPELL_LEVELS = [
  mkLevel(101, 1, 3, 1, 1, [[97, 2, 15]]),
  mkLevel(101, 6, 4, 1, 1, [[97, 16, 20]]),
  mkLevel(102, 6, 2, 0, 0, [[118, 40, 40, 3, "C"], [127, 3, 3, 1]]),   // buff sur SOI + malus PM
  mkLevel(103, 6, 4, 1, 8, [[98, 21, 25]], {
    rangeCanBeBoosted: true,
    zoneDescr: { shape: 67, param1: 2, param2: 0 },   // 'C' : disque de 2
  }),
  mkLevel(104, 6, 3, 1, 4, [
    [81, 10, 20],     // soins
    [1040, 50, 50],   // bouclier
    [412, 1, 2],      // retrait PM
    [9999, 1, 1],     // effet inconnu : doit rester non classé
  ], { zoneDescr: { shape: 90, param1: 1 } }),        // 'Z' : forme non décodée
  mkLevel(105, 6, 3, 0, 0, [[1040, 100, 100]]),
  // Le sort 106 n'a aucun palier : il doit être signalé, pas planté.
  mkLevel(107, 6, 5, 1, 3, [[97, 30, 34]], {
    zoneDescr: { shape: 67, param1: 1, param2: 0 },   // 'C' : la variante frappe en zone
  }),
  mkLevel(108, 6, 4, 1, 6, [[98, 26, 30]]),
];

function paginate(rows, url) {
  const limit = Number(url.searchParams.get("$limit") || 50);
  const skip = Number(url.searchParams.get("$skip") || 0);
  return { total: rows.length, limit, skip, data: rows.slice(skip, skip + limit) };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  // Aucun filtre groupé n'est accepté, quelle que soit la collection : c'est
  // ainsi que la vraie API se comporte, et deux extractions s'y sont cassé les
  // dents avant qu'on en tire la leçon.
  if ([...url.searchParams.keys()].some((k) => k.includes("[$in]"))) {
    return { ok: false, status: 500, json: async () => ({ message: "filtre groupé refusé" }) };
  }
  let rows;
  if (url.pathname === "/item-types") rows = TYPES;
  else if (url.pathname === "/effects") rows = EFFECTS;
  else if (url.pathname === "/item-sets") rows = SETS;
  else if (url.pathname === "/breeds") rows = BREEDS;
  else if (url.pathname === "/spell-levels") {
    const spellId = url.searchParams.get("spellId");
    rows = spellId === null ? SPELL_LEVELS : SPELL_LEVELS.filter((n) => n.spellId === Number(spellId));
  }
  else if (/^\/spells\/\d+$/.test(url.pathname)) {
    // Route par chemin : rend un OBJET, pas une enveloppe paginée.
    const doc = SPELL_DOCS[Number(url.pathname.split("/")[2])];
    return { ok: Boolean(doc), status: doc ? 200 : 404, json: async () => doc || {} };
  }
  else if (url.pathname === "/spell-variants") {
    if (MODE_VARIANTES !== "collection") return { ok: false, status: 404, json: async () => ({}) };
    const breedId = url.searchParams.get("breedId");
    const lot = breedId === null
      ? SPELL_VARIANTS
      : SPELL_VARIANTS.filter((v) => v.breedId === Number(breedId));
    // Plafond serveur : moins de lignes que le `$limit` réclamé.
    const skip = Number(url.searchParams.get("$skip") || 0);
    const body = {
      total: lot.length, limit: VARIANTS_PAR_PAGE, skip,
      data: lot.slice(skip, skip + VARIANTS_PAR_PAGE),
    };
    return { ok: true, status: 200, json: async () => body };
  }
  else if (url.pathname === "/spells") {
    // Comme en production : aucun filtre par CLASSE ne fonctionne ici — la
    // requête aboutit et ne rend rien. Un filtre sur un champ du document,
    // lui, fonctionne : c'est ainsi que la piste de repli retrouve un jumeau.
    const variantId = url.searchParams.get("spellVariantId");
    if (variantId === null) {
      return { ok: true, status: 200, json: async () => ({ total: 0, limit: 50, skip: 0, data: [] }) };
    }
    rows = Object.values(SPELL_DOCS).filter((d) => d.spellVariantId === Number(variantId));
  }
  else if (url.pathname === "/items") {
    // Le script interroge un type à la fois (`typeId=<id>`) : la requête
    // groupée `typeId[$in][0..31]` fait répondre la vraie API en HTTP 500.
    const groupe = [...url.searchParams.keys()].some((k) => k.startsWith("typeId[$in]"));
    if (groupe) return { ok: false, status: 500, json: async () => ({ message: "filtre groupé refusé" }) };
    const typeId = url.searchParams.get("typeId");
    rows = typeId === null ? ITEMS : ITEMS.filter((i) => i.typeId === Number(typeId));
  } else {
    return { ok: false, status: 404, json: async () => ({}) };
  }
  const body = paginate(rows, url);
  return { ok: true, status: 200, json: async () => body };
};
