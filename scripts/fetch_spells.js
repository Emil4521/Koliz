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
  normalize, pickText, labelFromTemplate, statKeyForLabel, isMetadataLabel, effectSign,
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

/**
 * Première page d'une collection, avec son total annoncé.
 *
 * Sert à SONDER un filtre sans s'engager : une API qui ignore un filtre inconnu
 * répond la collection entière, et `fetchCollection` la parcourrait jusqu'au
 * bout. Ici, une requête suffit à voir que le total est aberrant.
 */
async function premierePage(resource, query, opts, reporter) {
  const params = new URLSearchParams({ ...query, lang: opts.lang, $limit: String(opts.pageSize), $skip: "0" });
  const page = await getJson(`${API}/${resource}?${params}`, opts, reporter);
  const rows = Array.isArray(page) ? page : page.data || [];
  return { rows, total: Array.isArray(page) ? rows.length : (page.total ?? rows.length) };
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
 * Récupère un document par son chemin : `/spells/13115?lang=fr`.
 *
 * Cette route rend un OBJET, non une enveloppe paginée — d'où un traitement
 * distinct de `fetchCollection`. C'est aussi la seule forme fiable : l'API
 * répond HTTP 500 à tout filtre groupé `$in`, comme l'ont montré
 * `typeId[$in][0..31]` sur les équipements puis `id[$in][0..21]` sur les sorts.
 */
async function getOne(resource, id, opts, reporter) {
  const doc = await getJson(`${API}/${resource}/${id}?lang=${opts.lang}`, opts, reporter);
  if (doc && Array.isArray(doc.data)) return doc.data[0] || null;
  return doc || null;
}

/**
 * Paliers d'un sort, dans leur collection propre : `/spell-levels?spellId=N`.
 *
 * Les données de jeu — coût en PA, portée, zone, effets — vivent ici, tandis
 * que `/spells/<id>` ne porte que le nom et la description. Il faut donc deux
 * requêtes par sort.
 *
 * SEUL LE PALIER MAXIMAL est conservé : en Kolizéum 1v1 de haut niveau, c'est
 * celui qui sert, et garder les six multiplierait le volume comme la
 * complexité sans rien apporter au combat visé.
 */
async function paliersDuSort(spellId, opts, reporter) {
  const rows = await fetchCollection("spell-levels", { spellId: String(spellId) }, opts, reporter, true);
  if (!rows.length) return null;

  // On trie nous-mêmes plutôt que de dépendre du tri de l'API.
  let meilleur = null;
  for (const niveau of rows) {
    const grade = Number(niveau.grade ?? 0);
    if (!meilleur || grade > Number(meilleur.grade ?? 0)) meilleur = niveau;
  }
  return meilleur;
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
 * Identifiants des sorts d'une classe.
 *
 * La liaison passe par `breedSpellsId`, une liste d'identifiants portée par le
 * document de classe — et non par un filtre sur `/spells`, qui répond sans
 * erreur et sans résultat. Les autres noms de champ restent tentés au cas où
 * le schéma évoluerait, et si rien ne sort, la forme brute est exposée plutôt
 * que de rendre un « aucun sort » muet.
 */
async function identifiantsDeLaClasse(classe, opts, reporter, diagnostic) {
  const liste = firstArray(classe.raw, ["breedSpellsId", "spells", "spellIds", "spellsId"]);
  if (liste) {
    const ids = liste.valeur
      .map((v) => (v && typeof v === "object" ? v.id : v))
      .filter(Number.isFinite);
    if (ids.length) {
      reporter.info(`  ${classe.nom} : ${ids.length} sorts listés dans « ${liste.nom} »`);
      return ids;
    }
  }

  if (!diagnostic.fait) {
    diagnostic.fait = true;
    reporter.warn(`aucune liste de sorts sur la classe ${classe.nom}.`);
    reporter.info("");
    reporter.info("Champs d'une classe — la liaison vers ses sorts devrait s'y trouver :");
    reporter.info(`  ${Object.keys(classe.raw).join(", ")}`);
    const pistes = champsPortant(classe.raw, diagnostic.idsClasses);
    if (pistes.length) reporter.info(`  Champs portant un identifiant connu : ${pistes.join("  ")}`);
    reporter.info(`  ${JSON.stringify(classe.raw).slice(0, 600)}`);
  }
  return [];
}

/* ==========================================================================
   Variantes
   --------------------------------------------------------------------------
   Chaque sort du grimoire possède une version alternative : le joueur retient
   l'une OU l'autre, jamais les deux. `breedSpellsId` ne liste que la première
   de chaque paire.

   La liaison passe par une collection dédiée, interrogée CLASSE PAR CLASSE :

     /spell-variants?breedId=<id>&$skip=0&lang=fr

   C'est la forme qu'emploie le jeu, et la seule qui rattache un groupe à sa
   classe sans passer par un jumeau déjà connu. Elle rend une dizaine d'entrées
   par page quel que soit le `$limit` demandé — la pagination s'appuie donc sur
   le nombre de lignes reçues, jamais sur la taille de page réclamée.

   Deux pistes de repli suivent, au cas où le schéma bougerait : un champ de
   variante sur le document de sort, sous forme de liste ou de pointeur. Si
   aucune n'aboutit, la forme brute des documents est exposée — c'est elle qui
   porte la réponse, et c'est exactement ce qui a débloqué les schémas
   précédents (bonus de panoplie, puis liaison classe → sorts).
   ========================================================================== */

/** Noms de collection candidats pour les groupes de variantes. */
const VARIANT_COLLECTIONS = ["spell-variants", "spellVariants", "spell-variant"];

/** Champs candidats portant la liste des membres d'un groupe. */
const VARIANT_MEMBER_FIELDS = ["spells", "spellIds", "spellsId", "spellsIds", "variants", "spellVariants"];

/**
 * Un groupe de variantes compte deux membres, exceptionnellement trois. Au delà
 * de ce seuil, c'est que le filtre a été ignoré par l'API et qu'on a reçu la
 * collection entière : mieux vaut abandonner la piste que fabriquer un groupe
 * de cent sorts.
 */
const VARIANT_GROUP_MAX = 6;

function idsDeListe(valeur) {
  if (!Array.isArray(valeur)) return [];
  return valeur.map((v) => (v && typeof v === "object" ? v.id : v)).filter(Number.isFinite);
}

/** Clés d'un document dont le nom évoque une variante. */
function clesVariante(doc) {
  return Object.keys(doc || {}).filter((k) => /variant/i.test(k));
}

/**
 * Enregistre un groupe s'il est exploitable, membres réordonnés pour que ceux
 * déjà listés par la classe viennent en tête. Le rang 0 reste ainsi le sort
 * qu'on extrayait déjà : une extraction plus riche ne doit pas changer le sort
 * proposé par défaut.
 */
function ajouterGroupe(groupes, groupId, membres, connus, breedId) {
  const uniques = [...new Set(membres.filter(Number.isFinite))];
  if (uniques.length < 2 || uniques.length > VARIANT_GROUP_MAX) return false;
  const ordonnes = uniques
    .map((id, rang) => ({ id, rang, connu: connus.has(id) ? 0 : 1 }))
    .sort((a, b) => a.connu - b.connu || a.rang - b.rang)
    .map((e) => e.id);
  for (const id of ordonnes) groupes.set(id, { groupId, membres: ordonnes, breedId: breedId ?? null });
  return true;
}

/**
 * Piste 2 — le document de sort liste lui-même ses variantes.
 * Gratuite : les documents sont déjà en mémoire.
 */
function pisteListeSurSort(ctx) {
  const groupes = new Map();
  const champs = new Set();
  for (const [id, doc] of ctx.docs) {
    for (const cle of clesVariante(doc)) {
      const membres = idsDeListe(doc[cle]);
      if (!membres.length) continue;
      // La liste inclut parfois le sort lui-même, parfois seulement ses jumeaux.
      const groupe = membres.includes(id) ? membres : [id, ...membres];
      if (ajouterGroupe(groupes, groupe[0], groupe, ctx.connus)) champs.add(cle);
    }
  }
  return {
    source: champs.size ? `champ « ${[...champs].join(", ")} » du document de sort` : null,
    groupes,
    note: champs.size
      ? `liste sur le sort : ${groupes.size} sorts groupés via « ${[...champs].join(", ")} »`
      : "liste sur le sort : aucun champ « *variant* » ne porte de liste d'identifiants",
  };
}

/**
 * Piste 3 — le document de sort pointe un groupe par un simple nombre.
 *
 * Le jumeau ne figurant pas dans `breedSpellsId`, on le retrouve en demandant à
 * l'API tous les sorts portant la même valeur. Un filtre simple est accepté —
 * c'est déjà ainsi que fonctionne `/spell-levels?spellId=N` ; seuls les filtres
 * groupés `$in` font répondre HTTP 500.
 *
 * Une sonde valide le filtre avant d'en lancer une vingtaine : si l'API le
 * renvoie ignoré (toute la collection), la piste est abandonnée au lieu de
 * fabriquer des groupes absurdes.
 */
async function pistePointeurSurSort(ctx) {
  const parChamp = new Map();          // champ → Map(valeur → ids connus)
  for (const [id, doc] of ctx.docs) {
    for (const cle of clesVariante(doc)) {
      const v = doc[cle];
      if (!Number.isFinite(v) || v === 0) continue;
      if (!parChamp.has(cle)) parChamp.set(cle, new Map());
      const valeurs = parChamp.get(cle);
      valeurs.set(v, [...(valeurs.get(v) || []), id]);
    }
  }
  if (!parChamp.size) {
    return { source: null, groupes: new Map(), note: "pointeur sur le sort : aucun champ « *variant* » numérique" };
  }

  for (const [cle, valeurs] of parChamp) {
    const groupes = new Map();
    let filtreUtile = true;
    for (const [valeur, ids] of valeurs) {
      let membres = ids;
      if (filtreUtile) {
        try {
          // UNE seule page : un filtre ignoré rendrait la collection entière,
          // et la parcourir coûterait des milliers de requêtes pour rien.
          const page = await premierePage("spells", { [cle]: String(valeur) }, ctx.opts, ctx.reporter);
          const trouves = page.rows.map((r) => r.id).filter(Number.isFinite);
          if (page.total > VARIANT_GROUP_MAX || !trouves.some((id) => ids.includes(id))) {
            ctx.reporter.debug(`filtre ${cle}=${valeur} sans effet (${page.total} sorts) — piste abandonnée`);
            filtreUtile = false;
          } else if (trouves.length > membres.length) {
            membres = trouves;
          }
        } catch (err) {
          ctx.reporter.debug(`filtre ${cle}=${valeur} refusé : ${err.message}`);
          filtreUtile = false;
        }
      }
      ajouterGroupe(groupes, valeur, membres, ctx.connus);
      if (ctx.opts.delay) await sleep(ctx.opts.delay);
    }
    if (groupes.size) {
      return {
        source: `champ « ${cle} » du document de sort, résolu par /spells?${cle}=…`,
        groupes,
        note: `pointeur sur le sort : ${groupes.size} sorts groupés via « ${cle} »`,
      };
    }
  }
  return {
    source: null, groupes: new Map(),
    note: `pointeur sur le sort : ${[...parChamp.keys()].join(", ")} n'ont produit aucun groupe`,
  };
}

/**
 * Lit la collection des variantes classe par classe, comme le fait le jeu.
 *
 * Un filtre inconnu est parfois IGNORÉ plutôt que refusé : on recevrait alors
 * les mêmes lignes pour chaque classe et on leur attribuerait une classe au
 * hasard. Le doublon d'identifiant entre deux classes trahit ce cas, et on
 * bascule alors sur une lecture non filtrée, où la classe se déduit du jumeau.
 */
async function lireParClasse(resource, ctx) {
  const lignes = [];
  const vus = new Map();
  for (const classe of ctx.voulues) {
    const lot = await fetchCollection(resource, { breedId: String(classe.id) }, ctx.opts, ctx.reporter, true);
    for (const row of lot) {
      if (row && row.id != null && vus.has(row.id) && vus.get(row.id) !== classe.id) {
        ctx.reporter.debug(`/${resource} : le filtre breedId est ignoré (groupe ${row.id} rendu pour deux classes)`);
        return null;
      }
      if (row && row.id != null) vus.set(row.id, classe.id);
      lignes.push({ row, breedId: classe.id });
    }
    if (ctx.opts.delay) await sleep(ctx.opts.delay);
  }
  return lignes;
}

/** Piste 1 — une collection dédiée regroupe les variantes. */
async function pisteCollection(ctx) {
  const essais = [];
  for (const resource of VARIANT_COLLECTIONS) {
    let lignes = null;
    let filtre = "?breedId=…";
    try {
      lignes = await lireParClasse(resource, ctx);
    } catch (err) {
      // Collection absente ou filtre refusé : inutile d'insister sur ce nom.
      essais.push(`/${resource} : ${err.message}`);
      continue;
    }

    if (!lignes || !lignes.length) {
      // Filtre ignoré, ou classe sans groupe : relire sans filtre. La
      // collection couvre alors les dix-huit classes, d'où le tri par jumeau.
      filtre = "sans filtre";
      try {
        const lot = await fetchCollection(resource, {}, ctx.opts, ctx.reporter, true);
        lignes = lot.map((row) => ({ row, breedId: null }));
      } catch (err) {
        essais.push(`/${resource} sans filtre : ${err.message}`);
        continue;
      }
    }
    if (!lignes.length) { essais.push(`/${resource} vide`); continue; }

    const groupes = new Map();
    let champ = null;
    for (const { row, breedId } of lignes) {
      const liste = firstArray(row, VARIANT_MEMBER_FIELDS);
      if (!liste) continue;
      const membres = idsDeListe(liste.valeur);
      // Sans filtre de classe, seuls les groupes touchant un sort connu nous
      // concernent — les autres appartiennent aux classes non demandées.
      if (breedId == null && !membres.some((id) => ctx.connus.has(id))) continue;
      if (ajouterGroupe(groupes, row.id ?? membres[0], membres, ctx.connus, breedId)) champ = liste.nom;
    }
    if (groupes.size) {
      return {
        source: `/${resource}${filtre === "sans filtre" ? "" : "?breedId=…"} (champ « ${champ} »)`,
        groupes,
        note: `collection dédiée : ${groupes.size} sorts groupés via /${resource} ${filtre}`,
      };
    }
    // Présente mais inexploitable : montrer sa forme plutôt que de la taire.
    const exemple = lignes[0].row || {};
    essais.push(`/${resource} ${filtre} : ${lignes.length} entrées, aucun groupe exploitable`
      + ` — champs : ${Object.keys(exemple).join(", ")}`);
  }
  return { source: null, groupes: new Map(), note: `collection dédiée : ${essais.join(" ; ")}` };
}

/**
 * Essaie les pistes dans l'ordre et rend la première productive. Chaque
 * tentative est consignée : un échec doit rester lisible, pas silencieux.
 */
async function decouvrirVariantes(ctx) {
  const tentatives = [];
  // La collection dédiée d'abord : c'est la liaison confirmée. Les deux autres
  // ne servent que si le schéma bouge.
  for (const piste of [pisteCollection, pisteListeSurSort, pistePointeurSurSort]) {
    const r = await piste(ctx);
    tentatives.push(r.note);
    if (r.groupes.size) return { ...r, tentatives };
  }
  return { source: null, groupes: new Map(), tentatives };
}

/**
 * Aucune piste n'a abouti : exposer les documents bruts. C'est le seul livrable
 * utile dans ce cas — le prochain run part de là.
 */
function diagnosticVariantes(ctx, reporter) {
  reporter.info("");
  reporter.info("Variantes introuvables — voici les documents bruts, la liaison s'y trouve :");

  const [idSort, docSort] = [...ctx.docs][0] || [];
  if (docSort) {
    reporter.info(`  Champs de /spells/${idSort} :`);
    reporter.info(`    ${Object.keys(docSort).join(", ")}`);
    reporter.info(`    ${JSON.stringify(docSort).slice(0, 600)}`);
  }

  const classe = ctx.voulues[0];
  if (classe) {
    // Toute liste de nombres portée par la classe est un candidat : la seconde
    // série de sorts pourrait y vivre à côté de breedSpellsId.
    const listes = Object.entries(classe.raw)
      .map(([cle, v]) => [cle, idsDeListe(v)])
      .filter(([, ids]) => ids.length >= 2)
      .map(([cle, ids]) => `${cle} (${ids.length})`);
    reporter.info(`  Listes de nombres sur la classe ${classe.nom} : ${listes.join(", ") || "aucune"}`);
  }
}

/* ==========================================================================
   Transformation
   ========================================================================== */

/**
 * Retient un effet non classé, avec UN exemplaire de sa forme brute.
 *
 * Le libellé seul ne suffit pas à décider quoi faire d'un effet : « #1 : +#3
 * Portée minimale » range l'identifiant du sort visé et la valeur dans deux
 * champs distincts, et rien dans la sortie transformée ne dit lequel. Un
 * exemplaire brut par identifiant tranche la question sans run supplémentaire.
 */
function noter(nonClasses, effectId, raw) {
  if (!nonClasses.has(effectId)) nonClasses.set(effectId, raw);
}

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
    noter(nonClasses, effectId, raw);
    return baseEffect(effectId, raw, def, null);
  }

  let kind = connu ? connu.kind : null;
  // Un effet porteur d'une statistique et d'une durée est un boost.
  if (!kind && def && def.statKey && Number(raw.duration) !== 0) kind = "boost";
  if (!kind) noter(nonClasses, effectId, raw);

  const effet = baseEffect(effectId, raw, def, kind);
  if (connu) {
    effet.element = connu.element || null;
    if (connu.lifesteal) effet.lifesteal = true;
  }
  if (kind === "boost") {
    effet.statKey = def.statKey;
    // Le gabarit porte le sens ; le libellé, non. Sans ce report, Couperet
    // « -3 PM » devient « +3 PM » : un malus offert à l'adversaire.
    if (def.sign < 0) {
      effet.min = -effet.min;
      effet.max = -effet.max;
      if (effet.min > effet.max) [effet.min, effet.max] = [effet.max, effet.min];
    }
  }
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
    // Les TROIS nombres sources, conservés tels quels. `min`/`max` en sont une
    // lecture — juste pour un jet de dommages, fausse pour les effets qui
    // rangent autre chose dans ces cases : un modificateur de sort met
    // l'identifiant du sort visé dans `diceNum` et sa valeur dans `value`.
    // Sans les trois nombres, impossible de les distinguer après coup.
    dice: { num: diceNum, side: diceSide, value },
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
    const gabarit = pickText(e.description, opts.lang);
    const label = labelFromTemplate(gabarit);
    effectMap[e.id] = {
      id: e.id, label: label || `effet ${e.id}`,
      statKey: statKeyForLabel(label),
      // Un effet qui RETIRE se dépouille en le même libellé que celui qui
      // donne : le sens ne survit que s'il est relevé sur le gabarit.
      sign: effectSign(gabarit),
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

  // 3. Sorts de chaque classe — deux requêtes par sort.
  //
  //   /spells/<id>                nom et description
  //   /spell-levels?spellId=<id>  coût, portée, zone, effets
  //
  // Les deux collections sont distinctes : la seconde porte les données de jeu,
  // la première l'habillage. Seul le palier maximal est retenu.
  //
  // Les documents sont rassemblés AVANT les paliers : c'est en eux que se lit
  // la liaison vers les variantes, et il faut connaître la liste complète des
  // sorts — jumeaux compris — avant de payer une requête de palier par sort.
  const inconnues = new Set();      // formes de zone non décodées
  const nonClasses = new Map();     // effectId → un exemplaire brut, pour le rapport
  const spells = [];
  const sansPalier = [];

  const diagnostic = { fait: false, idsClasses: new Set(breeds.map((b) => b.id)) };

  const classeParSort = new Map();   // id de sort → classe
  const docs = new Map();            // id de sort → document /spells/<id>

  for (const classe of voulues) {
    const ids = await identifiantsDeLaClasse(classe, opts, reporter, diagnostic);
    for (const id of ids) {
      if (classeParSort.has(id)) continue;
      classeParSort.set(id, classe);
      docs.set(id, await getOne("spells", id, opts, reporter));
      if (opts.delay) await sleep(opts.delay);
    }
  }

  // 4. Variantes — la seconde version de chaque sort, absente de breedSpellsId.
  const ctx = { docs, connus: new Set(docs.keys()), voulues, opts, reporter };
  const variantes = docs.size ? await decouvrirVariantes(ctx) : { source: null, groupes: new Map(), tentatives: [] };

  const nouveaux = [];
  for (const [id, groupe] of variantes.groupes) {
    if (classeParSort.has(id)) continue;
    // La classe vient de la requête quand le groupe a été lu par classe ; sinon
    // le jumeau est la seule information dont on dispose.
    const jumeau = groupe.membres.find((m) => classeParSort.has(m));
    const classe = groupe.breedId != null
      ? voulues.find((c) => c.id === groupe.breedId)
      : (jumeau ? classeParSort.get(jumeau) : null);
    if (!classe) continue;
    classeParSort.set(id, classe);
    nouveaux.push(id);
  }
  for (const id of nouveaux) {
    docs.set(id, await getOne("spells", id, opts, reporter));
    if (opts.delay) await sleep(opts.delay);
  }

  if (variantes.source) {
    reporter.info(`  variantes : ${variantes.groupes.size} sorts groupés, `
      + `${nouveaux.length} nouveau(x) — via ${variantes.source}`);
  } else {
    reporter.warn("aucune variante trouvée : le grimoire restera sans choix.");
    for (const note of variantes.tentatives) reporter.info(`    ${note}`);
    if (docs.size) diagnosticVariantes(ctx, reporter);
  }

  // 5. Paliers et conversion, sorts listés et variantes confondus.
  for (const [id, classe] of classeParSort) {
    const niveau = await paliersDuSort(id, opts, reporter);
    if (!niveau) { sansPalier.push(id); continue; }

    const doc = docs.get(id);
    const groupe = variantes.groupes.get(id) || null;
    const palier = transformLevel(niveau, niveau.grade ?? 1, effectMap, reporter, inconnues, nonClasses);
    spells.push({
      id,
      name: pickText(doc && doc.name, opts.lang) || `sort ${id}`,
      description: pickText(doc && doc.description, opts.lang),
      class: normalize(classe.nom),
      breedId: classe.id,
      // Un sort sans groupe est seul de son espèce : toujours disponible.
      variantGroup: groupe ? groupe.groupId : null,
      variantRank: groupe ? groupe.membres.indexOf(id) : 0,
      levels: [palier],
    });
    if (opts.delay) await sleep(opts.delay);
  }

  for (const classe of voulues) {
    const n = spells.filter((s) => s.breedId === classe.id).length;
    reporter.info(`  ${classe.nom} : ${n} sorts retenus`);
  }

  if (sansPalier.length) {
    reporter.warn(`${sansPalier.length} sort(s) sans palier sur /spell-levels : ${sansPalier.slice(0, 10).join(", ")}`
      + (sansPalier.length > 10 ? " …" : ""));
  }

  if (!spells.length) {
    throw new Error(
      "aucun sort exploitable. Le diagnostic ci-dessus liste les champs réellement "
      + "renvoyés par /spells et /breeds : c'est là que se trouve la liaison classe → sorts."
    );
  }

  // 6. Écriture.
  const groupesEcrits = new Set(spells.map((s) => s.variantGroup).filter((g) => g != null));
  const payload = {
    meta: {
      source: "dofusdb", apiBase: API, lang: opts.lang,
      generatedAt: new Date().toISOString(),
      classes: voulues.map((c) => ({ id: c.id, nom: c.nom })),
      counts: {
        spells: spells.length,
        effects: Object.keys(effectMap).length,
        variantGroups: groupesEcrits.size,
      },
      variants: {
        source: variantes.source,
        tentatives: variantes.tentatives,
      },
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

  // 7. Rapport.
  reporter.info("");
  reporter.info(`Écrit : ${path.relative(ROOT, jsonPath)} (${(fs.statSync(jsonPath).size / 1e6).toFixed(2)} Mo)`);
  reporter.info(`Sorts : ${spells.length}`);
  for (const classe of voulues) {
    const n = spells.filter((s) => s.breedId === classe.id).length;
    const seuls = spells.filter((s) => s.breedId === classe.id && s.variantGroup == null).length;
    reporter.info(`  ${classe.nom} : ${n}` + (seuls ? ` (dont ${seuls} sans variante)` : ""));
  }
  reporter.info(`Groupes de variantes : ${groupesEcrits.size}`
    + (variantes.source ? ` — via ${variantes.source}` : ""));

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
    const tri = [...nonClasses.keys()].sort((a, b) => a - b);
    for (const id of tri.slice(0, 30)) {
      reporter.info(`  ${String(id).padStart(5)} : « ${(effectMap[id] || {}).label || "?"} »`);
    }
    if (tri.length > 30) reporter.info(`  … et ${tri.length - 30} autres`);
    reporter.info("  Chacun est soit une mécanique à ajouter à SPELL_EFFECT_KINDS,");
    reporter.info("  soit un effet hors périmètre du 1v1.");

    // Un exemplaire brut par identifiant : c'est là que se lit ce que chaque
    // champ porte réellement, et c'est ce qui manquait pour trancher entre
    // « diceNum est un jet » et « diceNum est l'identifiant du sort visé ».
    reporter.info("");
    reporter.info("Forme brute d'un exemplaire de chacun — pour décider quoi en faire :");
    for (const id of tri) {
      reporter.info(`  ${String(id).padStart(5)} ${JSON.stringify(nonClasses.get(id))}`);
    }
  }

  // Alphabet des masques de cible réellement rencontrés. Le moteur les ignore
  // encore — il applique chaque effet à toute entité de la zone — ce qui est
  // faux dès qu'un sort se lance sur soi. Les recenser est le préalable.
  const masques = new Map();
  for (const s of spells) {
    for (const niv of s.levels) {
      for (const e of [...niv.effects, ...niv.criticalEffects]) {
        for (const jeton of String(e.targetMask || "").split(",")) {
          if (!jeton) continue;
          const lettre = jeton.replace(/[0-9]+$/, "");
          if (!masques.has(lettre)) masques.set(lettre, { n: 0, exemple: `${s.name} / ${e.label}` });
          masques.get(lettre).n++;
        }
      }
    }
  }
  if (masques.size) {
    reporter.info("");
    reporter.info(`Masques de cible rencontrés (${masques.size}) — non encore interprétés :`);
    for (const [lettre, v] of [...masques].sort((a, b) => b[1].n - a[1].n)) {
      reporter.info(`  ${lettre.padEnd(4)} ${String(v.n).padStart(4)}  ex. ${v.exemple}`);
    }
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
  idsDeListe, clesVariante, ajouterGroupe, pisteListeSurSort,
  SPELL_EFFECT_KINDS, ZONE_SHAPES, ELEMENTS, VARIANT_GROUP_MAX,
};
