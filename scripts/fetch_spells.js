#!/usr/bin/env node
/**
 * fetch_spells.js — extraction des sorts depuis api.dofusdb.fr
 * =============================================================================
 * Génère `client/data/spells.json`, cache local autonome au format déclaratif
 * décrit par le brief (§7). Aucune dépendance npm — Node 18+ suffit.
 *
 *   node scripts/fetch_spells.js                     # Iop et Crâ
 *   node scripts/fetch_spells.js --classes iop,cra,eniripsa
 *   node scripts/fetch_spells.js --cache .cache      # reprise sans réseau
 *
 * Le schéma exact de l'API n'étant pas documenté, le script essaie plusieurs
 * champs candidats à chaque étape et, lorsqu'il ne trouve rien, EXPOSE la forme
 * brute reçue au lieu de rendre un résultat vide en silence. Cette approche a
 * déjà permis de débloquer deux schémas inattendus lors de l'extraction des
 * équipements ; la même discipline s'applique ici.
 * =============================================================================
 */

"use strict";

const fs = require("fs");
const path = require("path");
const {
  normalize, pickText, labelFromTemplate, statKeyForLabel, isMetadataLabel,
} = require("./fetch_items.js");

const API = "https://api.dofusdb.fr";
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "client", "data");

/* ==========================================================================
   Classification des effets de sort
   --------------------------------------------------------------------------
   Contrairement aux statistiques d'équipement, la nature d'un effet de sort ne
   se déduit pas de son libellé : « dommages Terre » (effet de sort) et
   « Dommage Terre » (bonus fixe d'équipement) se normalisent en la même
   chaîne. La classification se fait donc par IDENTIFIANT.

   Ces identifiants ne sont pas devinés : ils proviennent de la table d'effets
   réellement téléchargée. Deux familles indépendantes s'y recoupent et
   partagent le même ordre d'éléments — Eau, Terre, Air, Feu, Neutre — ce qui
   rend la lecture peu douteuse :

     91..95   vol de vie par élément
     96..100  dommages par élément

   Le libellé attendu est conservé pour recoupement : si l'API renvoie autre
   chose à cet identifiant, l'extraction le signale au lieu de l'appliquer.
   ========================================================================== */

const ELEMENTS = ["eau", "terre", "air", "feu", "neutre"];

const SPELL_EFFECT_KINDS = {
  96:  { kind: "damage", element: "eau", label: "dommages Eau" },
  97:  { kind: "damage", element: "terre", label: "dommages Terre" },
  98:  { kind: "damage", element: "air", label: "dommages Air" },
  99:  { kind: "damage", element: "feu", label: "dommages Feu" },
  100: { kind: "damage", element: "neutre", label: "dommages Neutre" },

  91:  { kind: "damage", element: "eau", lifesteal: true, label: "vol Eau" },
  92:  { kind: "damage", element: "terre", lifesteal: true, label: "vol Terre" },
  93:  { kind: "damage", element: "air", lifesteal: true, label: "vol Air" },
  94:  { kind: "damage", element: "feu", lifesteal: true, label: "vol Feu" },
  95:  { kind: "damage", element: "neutre", lifesteal: true, label: "vol Neutre" },

  81:   { kind: "heal", label: "soins" },
  1040: { kind: "shield", label: "Bouclier" },

  410: { kind: "drainPa", label: "Retrait PA" },
  411: { kind: "drainPa", label: "Retrait PA" },
  412: { kind: "drainPm", label: "Retrait PM" },
  413: { kind: "drainPm", label: "Retrait PM" },

  5: { kind: "push", label: "Repousse de case" },
  6: { kind: "pull", label: "Attire de case" },
};

/**
 * Formes de zone d'Ankama, encodées par un caractère.
 * Les formes non reconnues sont conservées telles quelles et signalées : mieux
 * vaut une zone affichée « inconnue » qu'une zone silencieusement ramenée à
 * une case unique.
 */
const ZONE_SHAPES = {
  P: "point",        // la case visée seule
  C: "circle",       // disque de rayon N
  X: "cross",        // croix
  L: "line",         // ligne dans la direction du lancer
  T: "perpendicular",// ligne perpendiculaire
  A: "all",          // toute la carte
  G: "rect",         // rectangle
  D: "ring",         // anneau
};

/* ==========================================================================
   Utilitaires
   ========================================================================== */

function parseArgs(argv) {
  const opts = {
    lang: "fr", classes: ["iop", "cra"], pageSize: 50, delay: 120,
    outDir: OUT_DIR, cache: null, verbose: false, retries: 4,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--lang") opts.lang = next();
    else if (a === "--classes") opts.classes = next().split(",").map((s) => normalize(s.trim()));
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
Usage : node scripts/fetch_spells.js [options]

  --classes <a,b>   Classes à extraire            (défaut : iop,cra)
  --lang <fr|en>    Langue des libellés           (défaut : fr)
  --page-size <n>   Taille de page de l'API       (défaut : 50)
  --delay <ms>      Pause entre requêtes          (défaut : 120)
  --out <dir>       Dossier de sortie             (défaut : client/data)
  --cache <dir>     Cache des réponses brutes
  -v, --verbose     Journal détaillé
`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Reporter {
  constructor(verbose) { this.verbose = verbose; this.warnings = []; }
  info(msg) { console.log(msg); }
  debug(msg) { if (this.verbose) console.log(`  ${msg}`); }
  warn(msg) { this.warnings.push(msg); console.warn(`  ! ${msg}`); }
}

async function getJson(url, opts, reporter) {
  const cacheFile = opts.cache
    ? path.join(opts.cache, Buffer.from(url).toString("base64url").slice(0, 180) + ".json")
    : null;
  if (cacheFile && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));

  let lastErr;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt) await sleep(1000 * 2 ** (attempt - 1));
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        if (res.status !== 429 && res.status < 500) throw new Error(`${lastErr} sur ${url}`);
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

async function fetchCollection(resource, query, opts, reporter, silent) {
  const out = [];
  let skip = 0, total = null;
  for (;;) {
    const params = new URLSearchParams({ ...query, lang: opts.lang, $limit: String(opts.pageSize), $skip: String(skip) });
    const page = await getJson(`${API}/${resource}?${params}`, opts, reporter);
    const rows = Array.isArray(page) ? page : page.data || [];
    if (total === null) {
      total = Array.isArray(page) ? rows.length : (page.total ?? rows.length);
      if (!silent) reporter.info(`  ${resource} : ${total} entrées`);
    }
    out.push(...rows);
    if (!rows.length || out.length >= total) break;
    skip += rows.length;
    if (opts.delay) await sleep(opts.delay);
  }
  return out;
}

/** Premier champ non vide parmi plusieurs candidats. */
function firstArray(obj, noms) {
  for (const nom of noms) {
    const v = obj[nom];
    if (Array.isArray(v) && v.length) return { nom, valeur: v };
  }
  return null;
}

/**
 * Récupère des documents UN IDENTIFIANT À LA FOIS.
 *
 * L'API refuse les filtres groupés : `?id[$in][0..21]=…` répond HTTP 500, tout
 * comme `typeId[$in][0..31]` lors de l'extraction des équipements. La leçon
 * avait été tirée là-bas puis oubliée ici. Une égalité simple par requête est
 * plus bavarde en réseau, mais c'est la seule forme que cette API accepte de
 * façon fiable.
 *
 * Un identifiant introuvable est signalé sans interrompre le reste.
 */
async function fetchParIdentifiant(resource, ids, opts, reporter) {
  const out = [];
  const manquants = [];
  for (const id of ids) {
    try {
      const rows = await fetchCollection(resource, { id: String(id) }, opts, reporter, true);
      if (rows.length) out.push(...rows);
      else manquants.push(id);
    } catch (err) {
      manquants.push(id);
      reporter.debug(`${resource} #${id} : ${err.message}`);
    }
    if (opts.delay) await sleep(opts.delay);
  }
  if (manquants.length) {
    reporter.warn(`${manquants.length} ${resource} introuvables : ${manquants.slice(0, 10).join(", ")}`
      + (manquants.length > 10 ? " …" : ""));
  }
  return out;
}

/**
 * Cherche, dans un document, les champs dont la valeur vaut l'un des
 * identifiants fournis. Sert à découvrir COMMENT un sort référence sa classe
 * quand le nom du champ n'est pas celui qu'on croyait.
 */
function champsPortant(doc, valeurs) {
  const trouves = [];
  for (const [cle, valeur] of Object.entries(doc)) {
    if (typeof valeur === "number" && valeurs.has(valeur)) trouves.push(`${cle}=${valeur}`);
    else if (Array.isArray(valeur) && valeur.some((v) => typeof v === "number" && valeurs.has(v))) {
      trouves.push(`${cle}=[…${valeur.filter((v) => valeurs.has(v)).join(",")}…]`);
    }
  }
  return trouves;
}

/**
 * Récupère les sorts d'une classe, sans présumer du schéma.
 *
 * Trois pistes, dans l'ordre : la liste d'identifiants portée par la classe
 * elle-même, puis les filtres candidats sur /spells, et enfin — si rien ne
 * marche — un échantillon non filtré dont on analyse les champs pour révéler
 * la liaison réelle. Le premier run avait échoué faute de cette dernière
 * étape : « aucun sort renvoyé » sans dire pourquoi.
 */
async function sortsDeLaClasse(classe, opts, reporter, diagnostic) {
  // Piste 1 — la classe porte-t-elle la liste de ses sorts ?
  const liste = firstArray(classe.raw, ["breedSpellsId", "spells", "spellIds", "spellsId"]);
  if (liste) {
    const ids = liste.valeur.map((v) => (v && typeof v === "object" ? v.id : v)).filter(Number.isFinite);
    if (ids.length) {
      reporter.info(`  ${classe.nom} : ${ids.length} identifiants via « ${liste.nom} »`);
      const rows = await fetchParIdentifiant("spells", ids, opts, reporter);
      if (rows.length) return rows;
    }
  }

  // Piste 2 — filtres candidats sur /spells.
  for (const champ of ["breedId", "breed", "classId", "characterClassId", "typeId"]) {
    const rows = await fetchCollection("spells", { [champ]: String(classe.id) }, opts, reporter, true);
    if (rows.length) {
      reporter.info(`  ${classe.nom} : ${rows.length} sorts via le filtre « ${champ} »`);
      return rows;
    }
  }

  // Piste 3 — échantillon non filtré, pour découvrir la liaison réelle.
  if (!diagnostic.fait) {
    diagnostic.fait = true;
    // Une seule page suffit pour inspecter le schéma : inutile de rapatrier
    // plusieurs milliers de sorts pour lire des noms de champs.
    const params = new URLSearchParams({ lang: opts.lang, $limit: "5", $skip: "0" });
    const page = await getJson(`${API}/spells?${params}`, opts, reporter);
    const echantillon = Array.isArray(page) ? page : page.data || [];
    const total = Array.isArray(page) ? echantillon.length : (page.total ?? echantillon.length);
    reporter.warn(
      `aucun filtre ne relie un sort à sa classe. ${total} sorts existent pourtant sur /spells.`
    );
    if (echantillon.length) {
      const sort = echantillon[0];
      reporter.info("");
      reporter.info("Champs d'un sort — pour trouver comment il référence sa classe :");
      reporter.info(`  ${Object.keys(sort).join(", ")}`);
      const pistes = champsPortant(sort, diagnostic.idsClasses);
      reporter.info(pistes.length
        ? `  Champs portant un identifiant de classe connu : ${pistes.join("  ")}`
        : "  Aucun champ ne porte d'identifiant de classe connu.");
      reporter.info(`  ${JSON.stringify(sort).slice(0, 600)}`);
      reporter.info("");
      reporter.info("Champs d'une classe — au cas où elle porterait la liste de ses sorts :");
      reporter.info(`  ${Object.keys(classe.raw).join(", ")}`);
    }
  }
  return [];
}

/* ==========================================================================
   Transformation
   ========================================================================== */

/** Décode la forme d'une zone d'effet. */
function decodeZone(raw, reporter, inconnues) {
  if (!raw || typeof raw !== "object") return { type: "point", size: 0 };

  // `shape` est tantôt un caractère, tantôt son code numérique.
  const brut = raw.shape ?? raw.zoneShape ?? null;
  const car = typeof brut === "number" ? String.fromCharCode(brut) : (brut || "");
  const type = ZONE_SHAPES[car];
  if (!type && car) inconnues.add(car);

  return {
    type: type || "inconnue",
    rawShape: car || null,
    size: raw.param1 ?? raw.zoneSize ?? 0,
    param2: raw.param2 ?? 0,
    stopAtTarget: Boolean(raw.isStopAtTarget),
    losOnly: Boolean(raw.onlyAffectIfInSightLine),
  };
}

/**
 * Convertit un effet brut d'Ankama au format déclaratif.
 * Un effet dont la nature n'est pas confirmée conserve son libellé et sort avec
 * `kind: null` : il est affiché, jamais appliqué au jugé.
 */
function transformEffect(raw, effectMap, reporter, inconnues, nonClasses) {
  const effectId = raw.effectId ?? raw.actionId ?? raw.id;
  if (effectId == null) return null;

  const def = effectMap[effectId] || null;
  const connu = SPELL_EFFECT_KINDS[effectId] || null;

  // Recoupement : l'API doit dire à peu près la même chose que la table.
  if (connu && def && def.label && normalize(def.label) !== normalize(connu.label)) {
    reporter.warn(
      `effectId ${effectId} : la table attend « ${connu.label} », l'API répond « ${def.label} ». `
      + "Classification suspendue pour cet effet."
    );
    nonClasses.add(effectId);
    return baseEffect(effectId, raw, def, null);
  }

  let kind = connu ? connu.kind : null;
  // Un effet porteur d'une statistique et d'une durée est un boost.
  if (!kind && def && def.statKey && Number(raw.duration) !== 0) kind = "boost";
  if (!kind) nonClasses.add(effectId);

  const effet = baseEffect(effectId, raw, def, kind);
  if (connu) {
    effet.element = connu.element || null;
    if (connu.lifesteal) effet.lifesteal = true;
  }
  if (kind === "boost") effet.statKey = def.statKey;
  return effet;
}

function baseEffect(effectId, raw, def, kind) {
  const diceNum = Number(raw.diceNum ?? 0);
  const diceSide = Number(raw.diceSide ?? 0);
  const value = Number(raw.value ?? 0);

  // Sur un sort, diceNum est la borne basse et diceSide la borne haute ;
  // diceSide nul signale une valeur fixe.
  let min = diceNum, max = diceSide !== 0 ? diceSide : diceNum;
  if (min === 0 && max === 0 && value !== 0) min = max = value;
  if (max < min) [min, max] = [max, min];

  return {
    effectId,
    kind,
    label: (def && def.label) || `effet ${effectId}`,
    min, max,
    duration: Number(raw.duration ?? 0),
    targetMask: raw.targetMask || null,
    delay: Number(raw.delay ?? 0),
    random: Number(raw.random ?? 0),
  };
}

/** Convertit un palier de sort. */
function transformLevel(raw, niveau, effectMap, reporter, inconnues, nonClasses) {
  const zone = decodeZone(raw.zoneDescr || raw.zone || null, reporter, inconnues);
  const conv = (liste) => (liste || [])
    .map((e) => transformEffect(e, effectMap, reporter, inconnues, nonClasses))
    .filter(Boolean);

  return {
    level: niveau,
    apCost: raw.apCost ?? null,
    ranges: [{
      min: raw.minRange ?? 0,
      max: raw.range ?? raw.maxRange ?? 0,
    }],
    modifiableRange: Boolean(raw.rangeCanBeBoosted),
    lineOfSight: raw.castTestLos !== undefined ? Boolean(raw.castTestLos) : true,
    castInLine: Boolean(raw.castInLine),
    castInDiagonal: Boolean(raw.castInDiagonal),
    needFreeCell: Boolean(raw.needFreeCell),
    criticalHitProbability: raw.criticalHitProbability ?? 0,
    maxCastPerTurn: raw.maxCastPerTurn ?? 0,
    maxCastPerTarget: raw.maxCastPerTarget ?? 0,
    minCastInterval: raw.minCastInterval ?? 0,
    minPlayerLevel: raw.minPlayerLevel ?? 1,
    zones: [zone],
    effects: conv(raw.effects),
    criticalEffects: conv(raw.criticalEffects),
  };
}

/* ==========================================================================
   Programme principal
   ========================================================================== */

async function main() {
  const opts = parseArgs(process.argv);
  const reporter = new Reporter(opts.verbose);
  reporter.info(`Extraction des sorts depuis ${API} (langue : ${opts.lang})`);
  reporter.info(`Classes demandées : ${opts.classes.join(", ")}`);

  // 1. Table d'effets, pour les libellés.
  const rawEffects = await fetchCollection("effects", {}, opts, reporter);
  const effectMap = {};
  for (const e of rawEffects) {
    if (e.id == null) continue;
    const label = labelFromTemplate(pickText(e.description, opts.lang));
    effectMap[e.id] = {
      id: e.id, label: label || `effet ${e.id}`,
      statKey: statKeyForLabel(label),
    };
  }

  // 2. Classes, pour relier chaque sort à la sienne.
  const breeds = await fetchCollection("breeds", {}, opts, reporter);
  const voulues = [];
  for (const breed of breeds) {
    const nom = pickText(breed.shortName || breed.name, opts.lang);
    if (opts.classes.includes(normalize(nom))) voulues.push({ id: breed.id, nom, raw: breed });
  }
  if (!voulues.length) {
    const dispo = breeds.map((b) => pickText(b.shortName || b.name, opts.lang)).filter(Boolean);
    throw new Error(
      `aucune classe ne correspond à « ${opts.classes.join(", ")} ». Classes disponibles : ${dispo.join(", ")}`
    );
  }
  reporter.info(`  classes trouvées : ${voulues.map((c) => `${c.nom} (#${c.id})`).join(", ")}`);

  // 3. Sorts de chaque classe.
  const inconnues = new Set();      // formes de zone non décodées
  const nonClasses = new Set();     // effets dont la nature n'est pas confirmée
  const spells = [];
  let schemaExpose = false;

  const diagnostic = { fait: false, idsClasses: new Set(breeds.map((b) => b.id)) };

  for (const classe of voulues) {
    const rawSpells = await sortsDeLaClasse(classe, opts, reporter, diagnostic);
    if (!rawSpells.length) continue;

    for (const raw of rawSpells) {
      // Les paliers sont tantôt peuplés, tantôt réduits à des identifiants.
      const trouve = firstArray(raw, ["spellLevels", "levels", "spellLevelIds"]);
      if (!trouve) {
        if (!schemaExpose) {
          schemaExpose = true;
          reporter.warn(`sort « ${pickText(raw.name, opts.lang)} » sans paliers exploitables.`);
          reporter.info("");
          reporter.info("Champs reçus sur ce sort — à reporter dans le script :");
          reporter.info(`  ${Object.keys(raw).join(", ")}`);
          reporter.info(`  ${JSON.stringify(raw).slice(0, 700)}`);
        }
        continue;
      }

      const paliers = trouve.valeur
        .filter((niv) => niv && typeof niv === "object")
        .map((niv, i) => transformLevel(niv, niv.grade ?? i + 1, effectMap, reporter, inconnues, nonClasses));

      if (!paliers.length) continue;
      spells.push({
        id: raw.id,
        name: pickText(raw.name, opts.lang),
        description: pickText(raw.description, opts.lang),
        class: normalize(classe.nom),
        breedId: classe.id,
        levels: paliers,
      });
    }
  }

  if (!spells.length) {
    throw new Error(
      "aucun sort exploitable. Le diagnostic ci-dessus liste les champs réellement "
      + "renvoyés par /spells et /breeds : c'est là que se trouve la liaison classe → sorts."
    );
  }

  // 4. Écriture.
  const payload = {
    meta: {
      source: "dofusdb", apiBase: API, lang: opts.lang,
      generatedAt: new Date().toISOString(),
      classes: voulues.map((c) => ({ id: c.id, nom: c.nom })),
      counts: { spells: spells.length, effects: Object.keys(effectMap).length },
      warnings: reporter.warnings,
    },
    effects: effectMap,
    spells,
  };

  fs.mkdirSync(opts.outDir, { recursive: true });
  const jsonPath = path.join(opts.outDir, "spells.json");
  fs.writeFileSync(jsonPath, JSON.stringify(payload));
  fs.writeFileSync(
    path.join(opts.outDir, "spells.data.js"),
    `window.KOLIZEUM_SPELLS = ${JSON.stringify(payload)};\n`
  );

  // 5. Rapport.
  reporter.info("");
  reporter.info(`Écrit : ${path.relative(ROOT, jsonPath)} (${(fs.statSync(jsonPath).size / 1e6).toFixed(2)} Mo)`);
  reporter.info(`Sorts : ${spells.length}`);
  for (const classe of voulues) {
    const n = spells.filter((s) => s.breedId === classe.id).length;
    reporter.info(`  ${classe.nom} : ${n}`);
  }

  const parKind = {};
  for (const s of spells) {
    for (const niv of s.levels) {
      for (const e of [...niv.effects, ...niv.criticalEffects]) {
        parKind[e.kind || "non classé"] = (parKind[e.kind || "non classé"] || 0) + 1;
      }
    }
  }
  reporter.info(`Effets par nature : ${Object.entries(parKind).map(([k, n]) => `${k}=${n}`).join("  ")}`);

  if (nonClasses.size) {
    reporter.info("");
    reporter.info(`Effets de sort non classés (${nonClasses.size}) — affichés, jamais appliqués :`);
    const tri = [...nonClasses].sort((a, b) => a - b);
    for (const id of tri.slice(0, 30)) {
      reporter.info(`  ${String(id).padStart(5)} : « ${(effectMap[id] || {}).label || "?"} »`);
    }
    if (tri.length > 30) reporter.info(`  … et ${tri.length - 30} autres`);
    reporter.info("  Chacun est soit une mécanique à ajouter à SPELL_EFFECT_KINDS,");
    reporter.info("  soit un effet hors périmètre du 1v1.");
  }
  if (inconnues.size) {
    reporter.info("");
    reporter.info(`Formes de zone non décodées : ${[...inconnues].join(", ")} — compléter ZONE_SHAPES.`);
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
  decodeZone, transformEffect, transformLevel, baseEffect,
  firstArray, champsPortant,
  SPELL_EFFECT_KINDS, ZONE_SHAPES, ELEMENTS,
};
