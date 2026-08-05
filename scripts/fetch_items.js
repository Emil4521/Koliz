#!/usr/bin/env node
/**
 * fetch_items.js — extraction des équipements depuis api.dofusdb.fr
 * =============================================================================
 * Génère un cache local autonome : le jeu ne dépend jamais du réseau à
 * l'exécution. Aucune dépendance npm — Node 18+ suffit (fetch natif).
 *
 *   node scripts/fetch_items.js                    # extraction complète
 *   node scripts/fetch_items.js --max 200          # échantillon rapide
 *   node scripts/fetch_items.js --lang en
 *   node scripts/fetch_items.js --cache .cache     # reprise sans re-télécharger
 *
 * Sorties :
 *   client/data/items.json        — jeu de données canonique
 *   client/data/items.data.js     — même contenu en `window.KOLIZEUM_ITEMS`,
 *                                   pour ouvrir l'interface en file:// sans
 *                                   serveur (fetch() y est bloqué par CORS)
 *   client/data/effects-map.json  — mapping effectId → effet lisible, isolé
 *                                   pour relecture et suivi de confiance
 *
 * Le script est volontairement bavard : il liste en fin de course les types
 * d'objets non classés et les effets non reconnus, afin que chaque correction
 * se fasse en une ligne dans les tables ci-dessous.
 * =============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");

/* ==========================================================================
   Configuration
   ========================================================================== */

const API = "https://api.dofusdb.fr";
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "client", "data");

/**
 * Emplacements d'équipement et nombre de cellules disponibles, tels que dans
 * l'interface du jeu. `dofus` couvre les Dofus, trophées et prysmaradites, qui
 * partagent les mêmes six emplacements.
 */
const SLOT_CAPACITY = {
  amulette: 1, arme: 1, coiffe: 1, cape: 1, ceinture: 1,
  bottes: 1, anneau: 2, bouclier: 1, dofus: 6, familier: 1,
};

/**
 * Classement des types d'objets par emplacement, par nom de type français.
 * On se fonde sur le NOM et non sur `superTypeId` : le nom est vérifiable d'un
 * coup d'œil contre le jeu, l'identifiant non. Les types inconnus ne sont pas
 * perdus : ils atterrissent dans l'emplacement `autre` et sont signalés en fin
 * d'exécution pour être ajoutés ici.
 */
const SLOT_BY_TYPE = {
  amulette: ["amulette"],
  coiffe: ["chapeau", "coiffe"],
  cape: ["cape", "sac à dos", "sac a dos"],
  ceinture: ["ceinture"],
  bottes: ["bottes"],
  anneau: ["anneau"],
  bouclier: ["bouclier"],
  familier: ["familier", "montilier", "muldo", "volkorne"],
  dofus: ["dofus", "trophée", "trophee", "prysmaradite"],
  arme: [
    "arc", "baguette", "bâton", "baton", "dague", "épée", "epee", "marteau",
    "pelle", "hache", "pioche", "faux", "outil", "arme magique", "lance",
  ],
};

/**
 * Normalisation des effets vers les statistiques agrégées du personnage.
 * La clé est le libellé de l'effet, débarrassé de sa ponctuation et de ses
 * accents ; la valeur est la statistique cumulée correspondante.
 *
 * Ce niveau d'indirection est délibéré : `client/items.js` agrège par `statKey`
 * et ignore totalement les identifiants d'effets, dont la signification exacte
 * reste à confirmer. Un effet non reconnu reste affiché tel quel dans la fiche
 * de l'objet — jamais supprimé en silence — il n'est simplement pas cumulé.
 */
const STAT_BY_LABEL = {
  // Caractéristiques primaires
  "vitalite": "vitalite", "force": "force", "intelligence": "intelligence",
  "chance": "chance", "agilite": "agilite", "sagesse": "sagesse",

  // Combat
  "pa": "pa", "pm": "pm", "po": "po", "portee": "po",
  "initiative": "initiative", "prospection": "prospection",
  "invocations": "invocations", "invocation": "invocations",
  "soins": "soins", "puissance": "puissance",
  "tacle": "tacle", "fuite": "fuite",
  "esquive pa": "esquivePa", "esquive pm": "esquivePm",
  "retrait pa": "retraitPa", "retrait pm": "retraitPm",

  // Dommages
  "dommages": "domFixe",
  "dommages terre": "domTerre", "dommages feu": "domFeu",
  "dommages eau": "domEau", "dommages air": "domAir",
  "dommages neutre": "domNeutre",
  "% dommages": "domPct", "dommages %": "domPct",
  "dommages critiques": "domCrit", "dommages de poussee": "domPoussee",
  "dommages aux sorts": "domSorts", "dommages aux armes": "domArmes",
  "dommages pieges": "domPieges", "% dommages pieges": "domPctPieges",
  "renvoi de dommages": "renvoiDom", "vol de vie": "volVie",

  // Critiques
  "% critique": "critPct", "critique": "critPct", "coups critiques": "critPct",
  "% resistance critiques": "resCrit",
  // L'API écrit ces trois-là sans le « % » ni le « de » attendus. Relevés sur
  // une extraction réelle : sans ces clés, la résistance aux critiques et les
  // dommages/résistances de poussée n'entraient dans aucun total.
  "resistance critiques": "resCrit",
  "resistance poussee": "resPoussee",
  "dommages poussee": "domPoussee",

  // Résistances en pourcentage
  "% resistance terre": "resPctTerre", "% resistance feu": "resPctFeu",
  "% resistance eau": "resPctEau", "% resistance air": "resPctAir",
  "% resistance neutre": "resPctNeutre",

  // Résistances fixes
  "resistance terre": "resFixeTerre", "resistance feu": "resFixeFeu",
  "resistance eau": "resFixeEau", "resistance air": "resFixeAir",
  "resistance neutre": "resFixeNeutre",
  "% resistance poussee": "resPoussee",
};

/**
 * Table de recoupement des identifiants d'effets.
 *
 * Ces valeurs proviennent de la documentation communautaire, PAS de l'API :
 * elles ne servent qu'à CROISER ce que renvoie `/effects`. Le script compare
 * les deux sources et attribue le niveau de confiance en conséquence :
 *
 *   verifie   — l'API et cette table concordent (deux sources indépendantes)
 *   probable  — dérivé de l'API seule, absent de cette table
 *   incertain — l'API et cette table divergent, ou aucune des deux ne conclut
 *
 * Les divergences sont affichées en fin d'exécution : ce sont elles qu'il faut
 * arbitrer contre Dofensive, en corrigeant ici puis en relançant le script.
 */
const EFFECT_CROSSCHECK = {
  111: "PA", 112: "Dommages", 115: "% Critique", 118: "Force",
  119: "Agilité", 123: "Chance", 124: "Sagesse", 125: "Vitalité",
  126: "Intelligence", 128: "PM",
  // 138 et 158 retirés le 2026-08-04 : la table annonçait « % Dommages » et
  // « Soins », l'API répond « Puissance » et « Pod ». Ces deux entrées étaient
  // fausses. Les réintroduire avec la réponse de l'API rendrait le recoupement
  // circulaire — il conclurait « vérifié » en comparant l'API à elle-même. Ils
  // ressortent donc en « probable », ce qui est le niveau honnête tant qu'une
  // source indépendante (Dofensive, jeu) n'a pas tranché.
};

/* ==========================================================================
   Utilitaires
   ========================================================================== */

function parseArgs(argv) {
  const opts = {
    lang: "fr", pageSize: 50, max: Infinity, delay: 120,
    outDir: OUT_DIR, cache: null, verbose: false, retries: 4,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--lang") opts.lang = next();
    else if (a === "--max") opts.max = Number(next());
    else if (a === "--page-size") opts.pageSize = Number(next());
    else if (a === "--delay") opts.delay = Number(next());
    else if (a === "--out") opts.outDir = path.resolve(next());
    else if (a === "--cache") opts.cache = path.resolve(next());
    else if (a === "--retries") opts.retries = Number(next());
    else if (a === "-v" || a === "--verbose") opts.verbose = true;
    else if (a === "-h" || a === "--help") { usage(); process.exit(0); }
    else { console.error(`Option inconnue : ${a}`); usage(); process.exit(2); }
  }
  return opts;
}

function usage() {
  console.log(`
Usage : node scripts/fetch_items.js [options]

  --lang <fr|en|es|de>   Langue des libellés            (défaut : fr)
  --max <n>              Limiter le nombre d'objets     (défaut : tous)
  --page-size <n>        Taille de page de l'API        (défaut : 50)
  --delay <ms>           Pause entre requêtes           (défaut : 120)
  --retries <n>          Tentatives en cas d'échec      (défaut : 4)
  --out <dir>            Dossier de sortie              (défaut : client/data)
  --cache <dir>          Cache des réponses brutes (reprise sans réseau)
  -v, --verbose          Journal détaillé
`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retire accents et ponctuation superflue pour comparer des libellés. */
function normalize(s) {
  return String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")   // marques diacritiques
    .toLowerCase()
    .replace(/[’']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Les textes de l'API sont tantôt des chaînes, tantôt des objets i18n. */
function pickText(value, lang) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") return value[lang] || value.fr || value.en || "";
  return String(value);
}

/**
 * Extrait un libellé lisible d'un gabarit de description Ankama.
 * Exemple : "+#1{~1~2 à }#2 Force" → "Force".
 *
 * Les gabarits réels contiennent des accolades IMBRIQUÉES : une simple passe
 * de `\{[^}]*\}` s'arrête à la première fermante et laisse des orphelines,
 * d'où les libellés « } PA » ou « } Dommage } } » observés en production.
 * On dépouille donc les groupes les plus internes jusqu'à stabilisation, puis
 * on balaie les accolades restées seules.
 */
function labelFromTemplate(tpl) {
  let s = String(tpl || "");
  for (let pass = 0; pass < 12; pass++) {
    const next = s.replace(/\{[^{}]*\}/g, " ");   // groupes les plus internes
    if (next === s) break;
    s = next;
  }
  return s
    .replace(/[{}]/g, " ")          // accolades orphelines (imbrication impaire)
    .replace(/[#~]\d+/g, " ")       // marqueurs de valeurs
    .replace(/%\d+/g, " ")
    .replace(/^[\s+\-–]+/, " ")     // signe de tête
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Ramène chaque MOT au singulier. La tolérance doit être mot à mot, pas
 * seulement en fin de chaîne : l'API écrit « Dommage Air » là où la table dit
 * « Dommages Air », et le « s » est au premier mot. Une comparaison sur la
 * seule terminaison laissait ces effets hors de tous les totaux.
 */
function singularize(n) {
  return n
    .split(" ")
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w))
    .join(" ");
}

/** Index des libellés au singulier, construit une fois. */
const STAT_INDEX = new Map(
  Object.entries(STAT_BY_LABEL).map(([label, key]) => [singularize(normalize(label)), key])
);

/** Résout la statistique agrégée d'un libellé. */
function statKeyForLabel(label) {
  const n = normalize(label);
  return STAT_BY_LABEL[n] ?? STAT_INDEX.get(singularize(n)) ?? null;
}

/**
 * Deux libellés désignent-ils le même effet ? La différence singulier/pluriel
 * est une variation d'écriture, pas une divergence de sens : la signaler
 * noierait les vraies divergences sous du bruit.
 */
function labelsMatch(a, b) {
  const na = normalize(a), nb = normalize(b);
  return na === nb || singularize(na) === singularize(nb);
}

/**
 * Certaines entrées de la liste d'effets d'un objet ne sont pas des
 * caractéristiques mais des mentions descriptives : « Compatible avec : »,
 * « Échangeable : », « Titre : ». Elles encombrent les fiches sans rien
 * apporter. On ne les écarte que sur un critère syntaxique — un libellé qui
 * s'achève par deux points, ou dépourvu de toute lettre — plutôt que sur une
 * liste noire d'identifiants, qui vieillirait mal.
 */
function isMetadataLabel(label) {
  const l = String(label || "").trim();
  return l.endsWith(":") || !/[\p{L}\p{N}]/u.test(l);
}

class Reporter {
  constructor(verbose) { this.verbose = verbose; this.warnings = []; }
  info(msg) { console.log(msg); }
  debug(msg) { if (this.verbose) console.log(`  ${msg}`); }
  warn(msg) { this.warnings.push(msg); console.warn(`  ! ${msg}`); }
}

/* ==========================================================================
   Client HTTP
   ========================================================================== */

/**
 * GET avec reprises et repli sur cache disque. Les erreurs 4xx autres que 429
 * ne sont pas retentées : elles traduisent une requête fautive, pas un aléa.
 */
async function getJson(url, opts, reporter) {
  const cacheFile = opts.cache
    ? path.join(opts.cache, Buffer.from(url).toString("base64url").slice(0, 180) + ".json")
    : null;

  if (cacheFile && fs.existsSync(cacheFile)) {
    reporter.debug(`cache ${url}`);
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  let lastErr;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt) {
      const wait = 1000 * 2 ** (attempt - 1);
      reporter.debug(`nouvelle tentative dans ${wait} ms — ${lastErr}`);
      await sleep(wait);
    }
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        const retryable = res.status === 429 || res.status >= 500;
        lastErr = `HTTP ${res.status}`;
        if (!retryable) throw new Error(`${lastErr} sur ${url}`);
        continue;
      }
      const json = await res.json();
      if (cacheFile) {
        fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(json));
      }
      return json;
    } catch (err) {
      lastErr = err.message;
      if (/HTTP 4\d\d/.test(lastErr) && !/HTTP 429/.test(lastErr)) throw err;
    }
  }
  throw new Error(`Échec après ${opts.retries + 1} tentatives : ${url} (${lastErr})`);
}

/**
 * Parcourt une collection paginée FeathersJS ($skip / $limit).
 * S'arrête dès que l'API cesse de progresser, pour ne jamais boucler.
 */
async function fetchCollection(resource, query, opts, reporter, cap = Infinity, flags = {}) {
  const out = [];
  let skip = 0, total = null;

  while (out.length < cap) {
    const params = new URLSearchParams({ ...query, lang: opts.lang, $limit: String(opts.pageSize), $skip: String(skip) });
    const page = await getJson(`${API}/${resource}?${params}`, opts, reporter);
    const rows = Array.isArray(page) ? page : page.data || [];
    if (total === null) {
      total = Array.isArray(page) ? rows.length : (page.total ?? rows.length);
      if (!flags.silent) reporter.info(`  ${resource} : ${Math.min(total, cap)} entrées à récupérer`);
    }
    out.push(...rows);
    if (!rows.length || out.length >= total) break;
    skip += rows.length;
    if (!flags.silent) {
      process.stdout.write(`\r  ${resource} : ${Math.min(out.length, cap)}/${Math.min(total, cap)}   `);
    }
    if (opts.delay) await sleep(opts.delay);
  }
  if (!flags.silent) process.stdout.write("\r\x1b[K");
  return out.slice(0, cap);
}

/* ==========================================================================
   Transformation
   ========================================================================== */

/** Construit la table effectId → effet lisible, avec niveau de confiance. */
function buildEffectMap(rawEffects, opts, reporter) {
  const map = {};
  const disagreements = [];

  for (const e of rawEffects) {
    const id = e.id;
    if (id == null) continue;

    const template = pickText(e.description, opts.lang);
    const label = labelFromTemplate(template);
    const expected = EFFECT_CROSSCHECK[id];

    let confidence;
    if (!label) confidence = "incertain";
    else if (expected === undefined) confidence = "probable";
    else if (labelsMatch(expected, label)) confidence = "verifie";
    else {
      confidence = "incertain";
      disagreements.push(`effectId ${id} : API « ${label} » vs table « ${expected} »`);
    }

    map[id] = {
      id,
      label: label || `effet ${id}`,
      template,
      characteristic: e.characteristic ?? null,
      operator: e.operator ?? null,
      statKey: statKeyForLabel(label),
      confidence,
    };
  }

  // Identifiants attendus mais absents de l'API : à ne pas passer sous silence.
  for (const [id, expected] of Object.entries(EFFECT_CROSSCHECK)) {
    if (!map[id]) {
      map[id] = {
        id: Number(id), label: expected, template: null, characteristic: null,
        operator: null, statKey: statKeyForLabel(expected),
        confidence: "incertain",
      };
      reporter.warn(`effectId ${id} (« ${expected} ») absent de /effects — conservé en « incertain »`);
    }
  }

  for (const d of disagreements) reporter.warn(d);
  return map;
}

/** Normalise les bornes d'un effet d'objet : min/max dans l'ordre croissant. */
function normalizeEffect(raw) {
  const id = raw.effectId ?? raw.actionId ?? raw.id;
  if (id == null) return null;

  const dn = Number(raw.diceNum ?? 0);
  const ds = Number(raw.diceSide ?? 0);
  const val = Number(raw.value ?? 0);

  // Sur un équipement, la fourchette du jet est portée par diceNum..diceSide ;
  // diceSide nul signale une valeur fixe.
  let min = dn, max = ds !== 0 ? ds : dn;
  if (min === 0 && max === 0 && val !== 0) min = max = val;
  if (max < min) [min, max] = [max, min];
  if (min === 0 && max === 0) return null;   // effet purement décoratif

  return { effectId: Number(id), min, max };
}

/** Associe un type d'objet à un emplacement d'équipement. */
function slotForType(typeName) {
  const n = normalize(typeName);
  for (const [slot, names] of Object.entries(SLOT_BY_TYPE)) {
    if (names.some((candidate) => n === candidate || n.startsWith(candidate + " "))) return slot;
  }
  return null;
}

function transformItem(raw, typeById, opts) {
  const typeId = raw.typeId ?? raw.type?.id ?? null;
  const type = typeById.get(typeId) || {};
  const typeName = pickText(type.name, opts.lang) || pickText(raw.type?.name, opts.lang);
  const slot = slotForType(typeName);

  const effects = [];
  for (const rawEffect of raw.possibleEffects || raw.effects || []) {
    const e = normalizeEffect(rawEffect);
    if (e) effects.push(e);
  }

  const item = {
    id: raw.id,
    name: pickText(raw.name, opts.lang),
    slot: slot || "autre",
    type: typeName,
    typeId,
    level: raw.level ?? 0,
    setId: raw.itemSetId != null && raw.itemSetId >= 0 ? raw.itemSetId : null,
    effects,
  };

  if (raw.criteria) item.criteria = raw.criteria;          // conservé brut : la
  // grammaire des conditions Ankama n'est pas encore interprétée (cf. README).

  if (slot === "arme") {
    // `range` est tantôt un nombre (portée maximale), tantôt un objet {min,max}.
    const rangeIsObject = raw.range !== null && typeof raw.range === "object";
    item.weapon = {
      apCost: raw.apCost ?? null,
      minRange: raw.minRange ?? (rangeIsObject ? raw.range.min : null) ?? null,
      maxRange: (rangeIsObject ? raw.range.max : raw.range) ?? null,
      criticalHitProbability: raw.criticalHitProbability ?? null,
      criticalHitBonus: raw.criticalHitBonus ?? null,
      twoHanded: Boolean(raw.twoHanded),
      maxCastPerTurn: raw.maxCastPerTurn ?? null,
    };
  }
  return item;
}

/**
 * Normalise une panoplie : bonus indexés par nombre de pièces équipées.
 *
 * Le champ portant les paliers n'a pas le même nom selon les versions de l'API,
 * et se présente tantôt comme un tableau de tableaux (indice 0 ⇒ 2 pièces),
 * tantôt comme un objet indexé par le nombre de pièces. On accepte les deux
 * plutôt que de rendre zéro panoplie en silence.
 */
function transformSet(raw, opts) {
  // Une extraction réelle a montré que `effects` existe mais reste vide, les
  // bonus se trouvant dans `possibleEffects`. Un simple `a || b` choisirait le
  // tableau vide, qui est truthy : on essaie donc chaque champ candidat et on
  // retient le PREMIER qui produit réellement des bonus.
  const candidats = [raw.effects, raw.possibleEffects, raw.bonuses, raw.itemSetBonus];

  let bonuses = {};
  for (const source of candidats) {
    if (!source) continue;
    const entries = Array.isArray(source)
      // Tableau : l'indice 0 correspond au palier « 2 pièces ».
      ? source.map((list, index) => [index + 2, list])
      // Objet : la clé EST le nombre de pièces.
      : Object.entries(source).map(([pieces, list]) => [Number(pieces), list]);

    const trouves = {};
    for (const [pieces, list] of entries) {
      if (!Number.isFinite(pieces) || !Array.isArray(list)) continue;
      const parsed = [];
      for (const rawEffect of list) {
        const e = normalizeEffect(rawEffect);
        // Un bonus de panoplie est une valeur fixe, jamais un jet.
        if (e) parsed.push({ effectId: e.effectId, value: e.max });
      }
      if (parsed.length) trouves[pieces] = parsed;
    }
    if (Object.keys(trouves).length) { bonuses = trouves; break; }
  }

  return {
    id: raw.id,
    name: pickText(raw.name, opts.lang),
    items: raw.items || raw.itemIds || [],
    bonuses,
  };
}

/* ==========================================================================
   Programme principal
   ========================================================================== */

async function main() {
  const opts = parseArgs(process.argv);
  const reporter = new Reporter(opts.verbose);

  reporter.info(`Extraction depuis ${API} (langue : ${opts.lang})`);
  if (opts.cache) reporter.info(`Cache : ${opts.cache}`);

  // 1. Types d'objets — indispensables pour classer par emplacement.
  const rawTypes = await fetchCollection("item-types", {}, opts, reporter);
  const typeById = new Map(rawTypes.map((t) => [t.id, t]));

  const equipmentTypeIds = [];
  const unclassified = [];
  for (const t of rawTypes) {
    const name = pickText(t.name, opts.lang);
    if (slotForType(name)) equipmentTypeIds.push(t.id);
    else unclassified.push(name);
  }
  reporter.info(`  ${equipmentTypeIds.length} types d'équipement reconnus sur ${rawTypes.length}`);

  // 2. Effets — table de correspondance et niveaux de confiance.
  const rawEffects = await fetchCollection("effects", {}, opts, reporter);
  const effectMap = buildEffectMap(rawEffects, opts, reporter);

  // 3. Objets, interrogés UN TYPE À LA FOIS.
  //
  // Une requête unique filtrée par `typeId[$in][0..31]` fait répondre l'API en
  // HTTP 500 : elle n'encaisse pas ce filtre groupé sur une trentaine de
  // valeurs. On paie donc quelques requêtes de plus, mais chacune est une
  // égalité simple, et surtout l'échec d'un type ne fait plus perdre toute
  // l'extraction — il est signalé et le reste continue.
  //
  // `--max` est un budget RÉPARTI entre les types, non un plafond global
  // appliqué dans l'ordre : sinon un petit budget se vide entièrement sur le
  // premier type et ne produit que des amulettes — un jeu de données inutile
  // pour tester une interface d'équipement.
  const perTypeCap = opts.max === Infinity
    ? Infinity
    : Math.max(1, Math.ceil(opts.max / equipmentTypeIds.length));
  if (perTypeCap !== Infinity) {
    reporter.info(`  budget : ${opts.max} objets, soit ${perTypeCap} par type sur ${equipmentTypeIds.length}`);
  }

  const rawItems = [];
  const failedTypes = [];
  // Coupe-circuit : poursuivre malgré les échecs évite de tout perdre, mais si
  // l'API est en panne ou limite le débit, chaque type coûte le cycle complet
  // de reprises. Enchaîner 32 fois ce cycle fait expirer le job sans rien
  // produire d'exploitable. Au-delà de quelques échecs d'affilée, on s'arrête
  // et on rend ce qui a été collecté.
  const MAX_ECHECS_CONSECUTIFS = 4;
  let echecsConsecutifs = 0;

  for (const typeId of equipmentTypeIds) {
    const typeName = pickText((typeById.get(typeId) || {}).name, opts.lang) || `#${typeId}`;
    try {
      const rows = await fetchCollection(
        "items", { typeId: String(typeId) }, opts, reporter, perTypeCap, { silent: true }
      );
      rawItems.push(...rows);
      echecsConsecutifs = 0;
      reporter.debug(`${typeName} (#${typeId}) : ${rows.length} objets`);
    } catch (err) {
      failedTypes.push({ typeId, typeName });
      echecsConsecutifs++;
      reporter.warn(`type « ${typeName} » (#${typeId}) non récupéré : ${err.message}`);
      if (echecsConsecutifs >= MAX_ECHECS_CONSECUTIFS) {
        reporter.warn(
          `${echecsConsecutifs} échecs consécutifs — arrêt de la récupération des objets. `
          + "L'API semble indisponible ; réessayer plus tard."
        );
        break;
      }
    }
    process.stdout.write(`\r  items : ${rawItems.length} récupérés   `);
  }
  process.stdout.write("\r\x1b[K");

  // Aucun type récupéré : inutile d'écrire un jeu de données vide.
  if (!rawItems.length) {
    throw new Error(
      `aucun objet récupéré (${failedTypes.length} type(s) en échec sur ${equipmentTypeIds.length}). `
      + "L'API a-t-elle changé de schéma ?"
    );
  }

  const items = [];
  const slotCounts = {};
  const unknownEffectIds = new Set();
  let mentionsEcartees = 0;
  for (const raw of rawItems) {
    const item = transformItem(raw, typeById, opts);
    if (item.slot === "autre") continue;              // filtré : hors équipement

    item.effects = item.effects.filter((e) => {
      const def = effectMap[e.effectId];
      if (def && isMetadataLabel(def.label)) { mentionsEcartees++; return false; }
      return true;
    });
    if (!item.effects.length && item.slot !== "arme") continue;   // objet sans stat
    for (const e of item.effects) if (!effectMap[e.effectId]) unknownEffectIds.add(e.effectId);
    slotCounts[item.slot] = (slotCounts[item.slot] || 0) + 1;
    items.push(item);
  }

  // 4. Panoplies.
  const rawSets = await fetchCollection("item-sets", {}, opts, reporter);
  const sets = rawSets.map((s) => transformSet(s, opts)).filter((s) => Object.keys(s.bonuses).length);

  // Auto-diagnostic : des panoplies récupérées mais aucun bonus lisible signale
  // un schéma différent de celui attendu. Plutôt que de rendre zéro panoplie en
  // silence, on expose la forme reçue — le prochain run suffit alors à corriger
  // `transformSet` sans avoir à interroger l'API à la main.
  if (rawSets.length && !sets.length) {
    const sample = rawSets[0];
    reporter.warn(
      `${rawSets.length} panoplies récupérées, aucune avec des bonus exploitables. `
      + `Champs reçus : ${Object.keys(sample).join(", ")}`
    );
    reporter.info("");
    reporter.info("Forme brute de la première panoplie (tronquée) — à reporter dans transformSet :");
    reporter.info(`  ${JSON.stringify(sample).slice(0, 800)}`);
  }

  // 5. Écriture.
  const payload = {
    meta: {
      source: "dofusdb",
      apiBase: API,
      lang: opts.lang,
      generatedAt: new Date().toISOString(),
      counts: { items: items.length, sets: sets.length, effects: Object.keys(effectMap).length },
      slotCounts,
      slotCapacity: SLOT_CAPACITY,
      warnings: reporter.warnings,
    },
    effects: effectMap,
    sets,
    items,
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = path.join(opts.outDir, "items.json");
  const jsPath = path.join(opts.outDir, "items.data.js");
  const mapPath = path.join(opts.outDir, "effects-map.json");

  fs.writeFileSync(jsonPath, JSON.stringify(payload));
  // Variante JS : `fetch()` est interdit en file://, un <script> ne l'est pas.
  fs.writeFileSync(jsPath, `window.KOLIZEUM_ITEMS = ${JSON.stringify(payload)};\n`);
  fs.writeFileSync(mapPath, JSON.stringify(effectMap, null, 2));

  // 6. Rapport final : tout ce qui demande un arbitrage humain.
  reporter.info("");
  reporter.info(`Écrit : ${path.relative(ROOT, jsonPath)} (${(fs.statSync(jsonPath).size / 1e6).toFixed(2)} Mo)`);
  reporter.info(`Écrit : ${path.relative(ROOT, jsPath)}`);
  reporter.info(`Écrit : ${path.relative(ROOT, mapPath)}`);
  reporter.info("");
  reporter.info(`Objets : ${items.length}   Panoplies : ${sets.length}   Effets : ${Object.keys(effectMap).length}`);
  reporter.info(`Par emplacement : ${Object.entries(slotCounts).map(([s, n]) => `${s}=${n}`).join("  ")}`);

  const byConfidence = { verifie: 0, probable: 0, incertain: 0 };
  let unmappedStat = 0;
  for (const e of Object.values(effectMap)) {
    byConfidence[e.confidence]++;
    if (!e.statKey) unmappedStat++;
  }
  reporter.info(`Confiance des effets : ${byConfidence.verifie} vérifiés, ${byConfidence.probable} probables, ${byConfidence.incertain} incertains`);
  reporter.info(`Effets sans statistique agrégée : ${unmappedStat} (affichés dans la fiche, non cumulés)`);
  reporter.info(`Mentions descriptives écartées des objets : ${mentionsEcartees}`);

  if (unclassified.length) {
    reporter.info("");
    reporter.info(`Types d'objets non classés (${unclassified.length}) — compléter SLOT_BY_TYPE si l'un d'eux est un équipement :`);
    reporter.info(`  ${unclassified.slice(0, 40).join(", ")}${unclassified.length > 40 ? ", …" : ""}`);
  }
  if (unknownEffectIds.size) {
    reporter.info("");
    reporter.info(`Effets référencés par des objets mais absents de /effects : ${[...unknownEffectIds].join(", ")}`);
  }
  if (failedTypes.length) {
    reporter.info("");
    reporter.info(`Types non récupérés (${failedTypes.length}/${equipmentTypeIds.length}) — les objets correspondants MANQUENT :`);
    for (const f of failedTypes) reporter.info(`  ${f.typeName} (#${f.typeId})`);
    reporter.info("  Relancer le script complète le jeu de données ; le cache (--cache) évite de tout retélécharger.");
  }
  if (reporter.warnings.length) {
    reporter.info("");
    reporter.info(`${reporter.warnings.length} avertissement(s) — repris dans meta.warnings de items.json.`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nÉchec : ${err.message}`);
    if (/fetch failed|ENOTFOUND|EAI_AGAIN|403/.test(err.message)) {
      console.error("Vérifiez l'accès réseau à api.dofusdb.fr (proxy ou politique de sortie).");
    }
    process.exit(1);
  });
}

module.exports = {
  normalize, pickText, labelFromTemplate, normalizeEffect,
  statKeyForLabel, labelsMatch, isMetadataLabel,
  slotForType, transformItem, transformSet, buildEffectMap,
  SLOT_CAPACITY, SLOT_BY_TYPE, STAT_BY_LABEL, EFFECT_CROSSCHECK,
};
