/**
 * spells.js — zones, ciblage, formule de dégâts et interpréteur d'effets
 * =============================================================================
 * Module autonome, sans dépendance. Utilisable de deux façons :
 *   - navigateur : <script src="spells.js"></script> → global `Kolizeum.Spells`
 *   - Node       : require("./spells.js")            → mêmes fonctions (tests)
 *
 * Comme `items.js`, ce module n'interprète aucun identifiant d'effet : il agit
 * sur le champ `kind` calculé à l'extraction (`damage`, `heal`, `boost`,
 * `shield`, `drainPa`, `drainPm`, `push`, `pull`). Un effet dont la nature
 * n'est pas confirmée sort avec `kind: null` : il est journalisé comme non
 * appliqué, jamais deviné.
 * =============================================================================
 */

(function (root, factory) {
  const grid = (typeof module === "object" && module.exports)
    ? require("./grid.js")
    : (root.Kolizeum && root.Kolizeum.Grid);
  const api = factory(grid);
  if (typeof module === "object" && module.exports) module.exports = api;
  else (root.Kolizeum = root.Kolizeum || {}).Spells = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (Grid) {
  "use strict";

  /* ========================================================================
     Correspondances élémentaires
     ------------------------------------------------------------------------
     Chaque élément est porté par une caractéristique, et défendu par une
     résistance en pourcentage doublée d'une résistance fixe. Le neutre est
     porté par la force, comme dans le jeu.
     ======================================================================== */

  /**
   * Version du module, affichée par la page.
   *
   * Les données portent déjà leur date d'extraction, mais le CODE n'avait
   * aucune marque : impossible de distinguer « le déploiement n'est pas passé »
   * de « le navigateur sert un ancien spells.js » — deux pannes identiques à
   * l'écran, et qui ont coûté trois allers-retours. À bomber à chaque
   * changement de comportement du module.
   */
  const MODULE_VERSION = "0.4.0";

  const ELEMENT_STATS = {
    terre:  { carac: "force",        domFixe: "domTerre",  resPct: "resPctTerre",  resFixe: "resFixeTerre" },
    feu:    { carac: "intelligence", domFixe: "domFeu",    resPct: "resPctFeu",    resFixe: "resFixeFeu" },
    eau:    { carac: "chance",       domFixe: "domEau",    resPct: "resPctEau",    resFixe: "resFixeEau" },
    air:    { carac: "agilite",      domFixe: "domAir",    resPct: "resPctAir",    resFixe: "resFixeAir" },
    neutre: { carac: "force",        domFixe: "domNeutre", resPct: "resPctNeutre", resFixe: "resFixeNeutre" },
  };

  const ELEMENT_LABELS = {
    terre: "Terre", feu: "Feu", eau: "Eau", air: "Air", neutre: "Neutre",
  };

  /* ========================================================================
     Chargement
     ======================================================================== */

  function indexData(payload) {
    const spells = (payload && payload.spells) || [];
    const byClass = spells.reduce((acc, s) => {
      (acc[s.class] = acc[s.class] || []).push(s);
      return acc;
    }, {});
    const groupsByClass = {};
    for (const classe of Object.keys(byClass)) groupsByClass[classe] = variantGroups(byClass[classe]);

    return {
      meta: (payload && payload.meta) || {},
      effects: (payload && payload.effects) || {},
      spells,
      spellById: new Map(spells.map((s) => [s.id, s])),
      byClass,
      groupsByClass,
    };
  }

  /* ========================================================================
     Variantes
     ------------------------------------------------------------------------
     Un sort du grimoire et sa variante s'excluent : on emporte l'un OU
     l'autre, jamais les deux. Les sorts partageant un `variantGroup` forment
     donc un groupe dont un seul membre est actif à la fois.

     Un sort dont le groupe est inconnu (`variantGroup: null`) est seul dans le
     sien et reste toujours actif : tant que l'extraction n'a pas trouvé la
     liaison, le grimoire se comporte comme avant plutôt que de disparaître.
     ======================================================================== */

  function variantGroups(spells) {
    const ordre = [];
    const par = new Map();
    for (const s of spells) {
      const key = s.variantGroup == null ? `solo:${s.id}` : `grp:${s.variantGroup}`;
      if (!par.has(key)) { par.set(key, { key, spells: [] }); ordre.push(par.get(key)); }
      par.get(key).spells.push(s);
    }
    // Rang 0 en tête : c'est le sort listé par la classe, choisi par défaut.
    for (const g of ordre) g.spells.sort((a, b) => (a.variantRank || 0) - (b.variantRank || 0));
    return ordre;
  }

  /** Sélection par défaut : le sort de rang 0 de chaque groupe. */
  function defaultSelection(groups) {
    const sel = new Map();
    for (const g of groups) sel.set(g.key, g.spells[0].id);
    return sel;
  }

  /**
   * Les sorts réellement emportés : exactement un par groupe. Une sélection
   * absente ou périmée retombe sur le rang 0 — jamais sur zéro sort.
   */
  function activeSpells(groups, selection) {
    return groups.map((g) => {
      const id = selection && selection.get(g.key);
      return g.spells.find((s) => s.id === id) || g.spells[0];
    });
  }

  /** Fait tourner la sélection d'un groupe vers le membre suivant. */
  function cycleVariant(group, selection) {
    const courant = selection.get(group.key);
    const i = group.spells.findIndex((s) => s.id === courant);
    const suivant = group.spells[(i + 1) % group.spells.length];
    selection.set(group.key, suivant.id);
    return suivant;
  }

  /** Palier d'un sort : le plus haut disponible au niveau du personnage. */
  function levelFor(spell, playerLevel) {
    const utilisables = spell.levels.filter((n) => (n.minPlayerLevel || 1) <= playerLevel);
    const choix = utilisables.length ? utilisables : spell.levels;
    return choix[choix.length - 1] || null;
  }

  /* ========================================================================
     Zones d'effet
     ------------------------------------------------------------------------
     Résolues dans le repère diamant, où la distance est |Δx| + |Δy|. Une forme
     non reconnue se replie sur la case visée seule, et le signale : mieux vaut
     une zone visiblement réduite qu'une zone inventée.
     ======================================================================== */

  function zoneCells(grid, casterCell, targetCell, zone) {
    const t = grid.idToCoord(targetCell);
    const c = grid.idToCoord(casterCell);
    const size = Number(zone && zone.size) || 0;
    const type = (zone && zone.type) || "point";

    const garde = (x, y) => {
      const id = grid.coordToId(x, y);
      return id >= 0 ? id : null;
    };
    const out = new Set();
    const ajoute = (x, y) => { const id = garde(x, y); if (id !== null) out.add(id); };

    // Direction du lancer, ramenée au pas cardinal dominant.
    const dx = t.x - c.x, dy = t.y - c.y;
    const dir = Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx) || 1, y: 0 }
      : { x: 0, y: Math.sign(dy) || 1 };

    switch (type) {
      case "point":
        ajoute(t.x, t.y);
        break;

      case "circle":
        for (let x = t.x - size; x <= t.x + size; x++) {
          for (let y = t.y - size; y <= t.y + size; y++) {
            if (Math.abs(x - t.x) + Math.abs(y - t.y) <= size) ajoute(x, y);
          }
        }
        break;

      case "ring":
        for (let x = t.x - size; x <= t.x + size; x++) {
          for (let y = t.y - size; y <= t.y + size; y++) {
            if (Math.abs(x - t.x) + Math.abs(y - t.y) === size) ajoute(x, y);
          }
        }
        break;

      case "cross":
        ajoute(t.x, t.y);
        for (let i = 1; i <= size; i++) {
          ajoute(t.x + i, t.y); ajoute(t.x - i, t.y);
          ajoute(t.x, t.y + i); ajoute(t.x, t.y - i);
        }
        break;

      case "line":
        for (let i = 0; i <= size; i++) ajoute(t.x + dir.x * i, t.y + dir.y * i);
        break;

      case "perpendicular": {
        const perp = { x: dir.y, y: dir.x };
        ajoute(t.x, t.y);
        for (let i = 1; i <= size; i++) {
          ajoute(t.x + perp.x * i, t.y + perp.y * i);
          ajoute(t.x - perp.x * i, t.y - perp.y * i);
        }
        break;
      }

      case "rect": {
        const p2 = Number(zone.param2) || 0;
        for (let x = t.x - size; x <= t.x + size; x++) {
          for (let y = t.y - p2; y <= t.y + p2; y++) ajoute(x, y);
        }
        break;
      }

      case "all":
        for (let id = 0; id < grid.size; id++) out.add(id);
        break;

      default:
        // Forme non décodée : on n'affecte que la case visée, sans l'inventer.
        ajoute(t.x, t.y);
        break;
    }
    return [...out];
  }

  /* ========================================================================
     Conditions de lancer
     ======================================================================== */

  /**
   * Le sort peut-il être lancé sur cette case ?
   * Retourne { ok, reasons } — toutes les raisons, pas seulement la première,
   * pour que l'interface puisse les afficher ensemble.
   */
  function canCast(grid, map, caster, niveau, targetCell, options) {
    const opts = options || {};
    const reasons = [];
    if (targetCell < 0 || targetCell >= grid.size) reasons.push("Case hors de la carte");

    const from = grid.idToCoord(caster.cellId);
    const to = grid.idToCoord(targetCell);
    const distance = Grid.cellDistance(from, to);

    const portee = niveau.ranges && niveau.ranges[0] ? niveau.ranges[0] : { min: 0, max: 0 };
    // La portée modifiable profite de la PO du lanceur.
    const bonusPo = niveau.modifiableRange ? (opts.rangeBonus || 0) : 0;
    const max = (portee.max || 0) + bonusPo;
    const min = portee.min || 0;
    if (distance < min) reasons.push(`Trop près (portée ${min}–${max})`);
    if (distance > max) reasons.push(`Trop loin (portée ${min}–${max})`);

    if (niveau.apCost != null && caster.pa != null && caster.pa < niveau.apCost) {
      reasons.push(`${niveau.apCost} PA requis, ${caster.pa} disponibles`);
    }

    if (niveau.castInLine && from.x !== to.x && from.y !== to.y) {
      reasons.push("Lancer en ligne uniquement");
    }
    if (niveau.castInDiagonal && Math.abs(to.x - from.x) !== Math.abs(to.y - from.y)) {
      reasons.push("Lancer en diagonale uniquement");
    }
    if (niveau.needFreeCell && (opts.occupants || new Map()).has(targetCell)) {
      reasons.push("La case doit être libre");
    }
    if (niveau.lineOfSight && caster.cellId !== targetCell) {
      const los = Grid.lineOfSight(grid, map, caster.cellId, targetCell, true);
      if (!los.clear) reasons.push("Ligne de vue bloquée");
    }
    return { ok: reasons.length === 0, reasons, distance };
  }

  /** Cases atteignables par un sort, pour l'aperçu de portée. */
  function rangeCells(grid, map, caster, niveau, options) {
    const out = [];
    for (let id = 0; id < grid.size; id++) {
      if (canCast(grid, map, caster, niveau, id, options).ok) out.push(id);
    }
    return out;
  }

  /* ========================================================================
     Formule de dégâts
     ------------------------------------------------------------------------
     Reprend la structure annoncée par le brief (§6) :

        base   = jet du sort
        bruts  = base × (1 + (caractéristique + puissance + %dommages) / 100)
                 + dommages fixes de l'élément + dommages fixes génériques
                 [+ dommages critiques si le coup est critique]
        finaux = bruts × (1 − résistance% cible / 100) − résistance fixe cible

     Les arrondis se font à l'entier inférieur à chaque étape, comme dans le
     jeu, et le résultat ne descend jamais sous zéro.

     À CONFIRMER contre le jeu : l'ordre exact des arrondis, et le fait que les
     dommages critiques s'ajoutent aux dégâts bruts avant l'application des
     résistances — c'est ce qui a été retenu ici.
     ======================================================================== */

  function computeDamage(effect, casterStats, targetStats, options) {
    const opts = options || {};
    const element = effect.element || "neutre";
    const map = ELEMENT_STATS[element] || ELEMENT_STATS.neutre;

    const base = opts.roll != null
      ? opts.roll
      : Math.floor((effect.min + effect.max) / 2);

    const carac = (casterStats[map.carac] || 0) + (casterStats.puissance || 0);
    const pourcent = casterStats.domPct || 0;
    const fixes = (casterStats[map.domFixe] || 0) + (casterStats.domFixe || 0);

    const multiplie = Math.floor(base * (100 + carac + pourcent) / 100);
    let bruts = multiplie + fixes;
    if (opts.critical) bruts += casterStats.domCrit || 0;

    const resPct = targetStats[map.resPct] || 0;
    const resFixe = targetStats[map.resFixe] || 0;
    const apresPct = Math.floor(bruts * (100 - resPct) / 100);
    const finaux = Math.max(0, apresPct - resFixe);

    // Chaque terme est nommé : le journal doit pouvoir se comparer au jeu
    // ligne à ligne, et un écart doit désigner le terme fautif, pas un total.
    const termes = [`${casterStats[map.carac] || 0} ${map.carac}`];
    if (casterStats.puissance) termes.push(`${casterStats.puissance} puissance`);
    if (pourcent) termes.push(`${pourcent}% dommages`);

    return {
      element, base, carac, pourcent, fixes,
      bruts, resPct, resFixe, finaux,
      detail: `${base} × (100 + ${termes.join(" + ")})/100 = ${multiplie}`
            + (fixes ? ` + ${fixes} fixes` : "")
            + (opts.critical && casterStats.domCrit ? ` + ${casterStats.domCrit} crit.` : "")
            + ` → ${bruts}, puis −${resPct}% ${resFixe ? `et −${resFixe} fixe ` : ""}→ ${finaux}`,
    };
  }

  /**
   * Fourchette de dégâts RÉELLEMENT infligés, bornes du jet passées par la
   * formule complète.
   *
   * « 28–32 dommages Feu » sur une fiche de sort n'est pas ce que la cible
   * encaisse : c'est le jet de base, avant caractéristique, puissance,
   * dommages fixes et résistances. Afficher l'un pour l'autre donne une
   * lecture fausse du grimoire.
   */
  function damageRange(effect, casterStats, targetStats, options) {
    const opts = options || {};
    const bas = computeDamage(effect, casterStats, targetStats, { ...opts, roll: effect.min });
    const haut = computeDamage(effect, casterStats, targetStats, { ...opts, roll: effect.max });
    return { min: bas.finaux, max: haut.finaux, element: bas.element, detail: haut.detail };
  }

  /* ========================================================================
     Entités
     ======================================================================== */

  function makeEntity(spec) {
    const stats = spec.stats || {};
    const maxLife = spec.maxLife != null ? spec.maxLife : 1000;
    return {
      id: spec.id,
      name: spec.name || spec.id,
      team: spec.team || "a",
      cellId: spec.cellId,
      stats,
      maxLife,
      life: spec.life != null ? spec.life : maxLife,
      shield: spec.shield || 0,
      pa: spec.pa != null ? spec.pa : (stats.pa || 6),
      pm: spec.pm != null ? spec.pm : (stats.pm || 3),
      buffs: [],
    };
  }

  /** Statistiques effectives : celles du personnage, modifiées par les buffs. */
  function effectiveStats(entity) {
    const out = { ...entity.stats };
    for (const buff of entity.buffs) {
      if (!buff.statKey) continue;
      out[buff.statKey] = (out[buff.statKey] || 0) + buff.value;
    }
    return out;
  }

  /* ========================================================================
     Déplacements forcés
     ------------------------------------------------------------------------
     Poussée et attirance suivent la ligne lanceur → cible, ramenée au pas
     cardinal dominant : c'est la règle du jeu, et elle est sans ambiguïté sur
     une grille en diamant où l'on ne se déplace que de quatre façons.

     Le trajet se fait CASE PAR CASE et s'arrête au premier obstacle — bord,
     mur, trou, autre combattant. Les cases non parcourues sont comptées et
     rendues : en Dofus elles infligent des dommages de collision, dont la
     formule reste à confirmer et n'est donc pas appliquée ici.
     ======================================================================== */

  /** Pas cardinal dominant d'une case vers une autre, ou null si confondues. */
  function pushDirection(grid, fromCell, toCell) {
    const a = grid.idToCoord(fromCell), b = grid.idToCoord(toCell);
    const dx = b.x - a.x, dy = b.y - a.y;
    if (dx === 0 && dy === 0) return null;
    return Math.abs(dx) >= Math.abs(dy)
      ? { x: Math.sign(dx), y: 0 }
      : { x: 0, y: Math.sign(dy) };
  }

  /**
   * Déplace une entité de `cases` cases dans une direction donnée.
   *
   * `occupants` est mis à jour au passage, sans quoi deux poussées successives
   * dans le même lancer se traverseraient. L'entité est déplacée en place.
   */
  function forcedMove(grid, map, occupants, entity, dir, cases) {
    const depart = entity.cellId;
    let courant = depart, faites = 0, obstacle = null;

    for (let i = 0; i < cases; i++) {
      const c = grid.idToCoord(courant);
      const suivant = grid.coordToId(c.x + dir.x, c.y + dir.y);
      if (suivant < 0) { obstacle = "le bord de la carte"; break; }
      if (map && !map.walkable(suivant)) {
        obstacle = map.cells[suivant] === Grid.CELL_HOLE ? "un trou" : "un obstacle";
        break;
      }
      const occupant = occupants && occupants.get(suivant);
      if (occupant) { obstacle = occupant.name; break; }
      courant = suivant;
      faites++;
    }

    if (faites) {
      if (occupants) { occupants.delete(depart); occupants.set(courant, entity); }
      entity.cellId = courant;
    }
    return { from: depart, to: courant, faites, bloquees: cases - faites, obstacle };
  }

  /**
   * Applique des dégâts en tenant compte du bouclier, qui absorbe en premier.
   */
  function applyDamage(entity, montant) {
    const absorbe = Math.min(entity.shield, montant);
    entity.shield -= absorbe;
    const subis = montant - absorbe;
    entity.life = Math.max(0, entity.life - subis);
    return { absorbe, subis };
  }

  /* ========================================================================
     Lancement d'un sort
     ======================================================================== */

  /**
   * Résout un lancer complet et retourne le journal des évènements.
   *
   * L'état des entités est modifié en place : c'est un moteur de combat, pas
   * une fonction pure. Le journal, lui, est exhaustif — chaque effet appliqué,
   * ignoré ou non reconnu y figure, ce qui permet de comparer au jeu ligne à
   * ligne plutôt que de constater un total qui ne tombe pas juste.
   */
  function castSpell(context) {
    const { grid, map, caster, spell, level, targetCell, entities } = context;
    const rng = context.rng || Math.random;
    const journal = [];

    const occupants = new Map(entities.filter((e) => e.life > 0).map((e) => [e.cellId, e]));
    const verdict = canCast(grid, map, caster, level, targetCell, {
      occupants, rangeBonus: (caster.stats && caster.stats.po) || 0,
    });
    if (!verdict.ok) {
      return { ok: false, reasons: verdict.reasons, journal };
    }

    // Coup critique.
    const proba = level.criticalHitProbability || 0;
    const bonusCrit = (caster.stats && caster.stats.critPct) || 0;
    const critique = proba > 0 && rng() < Math.min(1, (1 / proba) + bonusCrit / 100);

    if (caster.pa != null && level.apCost != null) caster.pa -= level.apCost;
    journal.push({
      type: "cast",
      texte: `${caster.name} lance ${spell.name}${critique ? " (critique)" : ""}`
           + ` sur la case ${targetCell} — ${level.apCost} PA`,
    });

    const zone = (level.zones && level.zones[0]) || { type: "point", size: 0 };
    const cases = zoneCells(grid, caster.cellId, targetCell, zone);
    if (zone.type === "inconnue") {
      journal.push({
        type: "avertissement",
        texte: `Forme de zone « ${zone.rawShape || "?"} » non décodée : seule la case visée est affectée.`,
      });
    }

    const effets = critique && level.criticalEffects && level.criticalEffects.length
      ? level.criticalEffects
      : level.effects;

    const casterStats = effectiveStats(caster);
    const touches = entities.filter((e) => e.life > 0 && cases.includes(e.cellId));
    if (!touches.length) journal.push({ type: "info", texte: "Aucune cible dans la zone." });

    for (const effet of effets) {
      // La nature de l'effet n'est pas confirmée : on le dit, on ne l'invente pas.
      if (!effet.kind) {
        journal.push({
          type: "non-applique",
          texte: `Effet non reconnu, non appliqué : « ${effet.label} » (id ${effet.effectId})`,
        });
        continue;
      }

      for (const cible of touches) {
        const cibleStats = effectiveStats(cible);
        const jet = effet.min + Math.floor(rng() * (effet.max - effet.min + 1));

        switch (effet.kind) {
          case "damage": {
            const calcul = computeDamage(effet, casterStats, cibleStats, { roll: jet, critical: critique });
            const { absorbe, subis } = applyDamage(cible, calcul.finaux);
            journal.push({
              type: "damage",
              texte: `${cible.name} subit ${subis} dégâts ${ELEMENT_LABELS[calcul.element]}`
                   + (absorbe ? ` (${absorbe} absorbés par le bouclier)` : "")
                   + ` — ${calcul.detail}`,
              cible: cible.id, montant: subis, detail: calcul,
            });
            if (effet.lifesteal) {
              const rendu = Math.floor(subis / 2);
              caster.life = Math.min(caster.maxLife, caster.life + rendu);
              journal.push({ type: "heal", texte: `${caster.name} récupère ${rendu} PV (vol de vie)`, montant: rendu });
            }
            break;
          }

          case "heal": {
            const soigne = Math.min(cible.maxLife - cible.life, jet);
            cible.life += soigne;
            journal.push({ type: "heal", texte: `${cible.name} récupère ${soigne} PV`, cible: cible.id, montant: soigne });
            break;
          }

          case "shield": {
            cible.shield += jet;
            journal.push({ type: "shield", texte: `${cible.name} gagne ${jet} de bouclier`, cible: cible.id, montant: jet });
            break;
          }

          case "boost": {
            cible.buffs.push({
              statKey: effet.statKey, value: jet,
              duration: effet.duration || 1, label: effet.label, source: spell.name,
            });

            // Les PA et les PM sont des RÉSERVES, pas des caractéristiques :
            // un retrait ampute le tour en cours, il n'attend pas la
            // régénération suivante. Sans cela, « −3 PM » sur l'adversaire ne
            // se voyait nulle part avant son tour d'après.
            let immediat = "";
            if (effet.statKey === "pa" || effet.statKey === "pm") {
              const avant = cible[effet.statKey];
              cible[effet.statKey] = Math.max(0, avant + jet);
              const delta = cible[effet.statKey] - avant;
              immediat = ` — ${effet.statKey.toUpperCase()} ${avant} → ${cible[effet.statKey]}`
                + (delta !== jet ? " (plancher à 0)" : "");
            }

            journal.push({
              type: "boost",
              texte: `${cible.name} : ${effet.label} ${jet >= 0 ? "+" : ""}${jet}`
                   + ` pendant ${effet.duration || 1} tour(s)${immediat}`,
              cible: cible.id,
            });
            break;
          }

          case "drainPa":
          case "drainPm": {
            const champ = effet.kind === "drainPa" ? "pa" : "pm";
            const retire = Math.min(cible[champ], jet);
            cible[champ] -= retire;
            journal.push({
              type: "drain",
              texte: `${cible.name} perd ${retire} ${champ.toUpperCase()}`,
              cible: cible.id, montant: retire,
            });
            break;
          }

          case "push":
          case "pull": {
            // Un lanceur poussé par son propre sort n'a pas de direction : la
            // ligne lanceur → cible est alors dégénérée.
            const axe = pushDirection(grid, caster.cellId, cible.cellId);
            if (!axe) {
              journal.push({
                type: "non-applique",
                texte: `${effet.label} : ${cible.name} est sur la case du lanceur, aucune direction`,
                cible: cible.id,
              });
              break;
            }
            const sens = effet.kind === "push"
              ? axe
              : { x: -axe.x, y: -axe.y };
            const dep = forcedMove(grid, map, occupants, cible, sens, jet);

            journal.push({
              type: "deplacement",
              texte: dep.faites
                ? `${cible.name} est ${effet.kind === "push" ? "repoussé" : "attiré"} de ${dep.faites} case(s)`
                  + ` (${dep.from} → ${dep.to})`
                  + (dep.bloquees ? `, arrêté par ${dep.obstacle}` : "")
                : `${cible.name} ne bouge pas : ${dep.obstacle} bloque immédiatement`,
              cible: cible.id, montant: dep.faites, detail: dep,
            });

            // En Dofus, les cases non parcourues infligent des dommages de
            // collision. La formule n'étant pas confirmée, on la signale au
            // lieu de l'inventer : un effet compté à tort est invisible.
            if (dep.bloquees) {
              journal.push({
                type: "non-applique",
                texte: `Dommages de collision non appliqués (${dep.bloquees} case(s) bloquée(s)) :`
                     + " formule à confirmer",
                cible: cible.id,
              });
            }
            break;
          }

          default:
            journal.push({
              type: "non-applique",
              texte: `Nature « ${effet.kind} » non gérée : « ${effet.label} »`,
            });
        }

        if (cible.life === 0) {
          journal.push({ type: "mort", texte: `${cible.name} est vaincu.`, cible: cible.id });
        }
      }
    }

    return { ok: true, critique, cases, touches: touches.map((e) => e.id), journal };
  }

  /** Décrémente les buffs en fin de tour et retire ceux qui expirent. */
  function tickBuffs(entity) {
    const expires = [];
    entity.buffs = entity.buffs.filter((b) => {
      b.duration -= 1;
      if (b.duration > 0) return true;
      expires.push(b);
      return false;
    });
    return expires;
  }

  return {
    MODULE_VERSION,
    ELEMENT_STATS, ELEMENT_LABELS,
    indexData, levelFor,
    variantGroups, defaultSelection, activeSpells, cycleVariant,
    zoneCells, canCast, rangeCells,
    computeDamage, damageRange, makeEntity, effectiveStats, applyDamage,
    pushDirection, forcedMove,
    castSpell, tickBuffs,
  };
});
