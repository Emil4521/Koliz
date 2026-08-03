# Projet Kolizéum Tactique 1v1 — Brief complet

> Document de référence destiné à un autre agent IA (Claude Code) ou développeur reprenant le projet.
> Cible : un clone jouable dans le navigateur du système de combat tactique PvP en 1v1 du Kolizéum de Dofus, avec une fidélité mécanique maximale mais une sobriété visuelle assumée.

---

## Table des matières

1. [Vision du projet](#1-vision-du-projet)
2. [Décisions techniques fondamentales](#2-décisions-techniques-fondamentales)
3. [Architecture du projet](#3-architecture-du-projet)
4. [Sources de données](#4-sources-de-données)
5. [Feuille de route complète](#5-feuille-de-route-complète)
   - [Version 0.1 — Fondations géométriques](#version-01--fondations-géométriques-jalon-1)
   - [Version 0.2 — Base d'équipements et interface d'équipement](#version-02--base-déquipements-et-interface-déquipement)
   - [Version 0.3 — Sorts du Iop et du Crâ](#version-03--sorts-du-iop-et-du-cra)
   - [Version 1.0 — Combat complet 1v1 local](#version-10--combat-complet-1v1-local)
   - [Version 1.1 — Multijoueur en ligne simple](#version-11--multijoueur-en-ligne-simple)
   - [Version 1.2 — Extension progressive des classes](#version-12--extension-progressive-des-classes)
   - [Version 1.3 — Invocations et mécaniques avancées](#version-13--invocations-et-mécaniques-avancées)
   - [Version 2.0 — Confort et compétitif](#version-20--confort-et-compétitif)
6. [Mécaniques clés à implémenter fidèlement](#6-mécaniques-clés-à-implémenter-fidèlement)
7. [Format des sorts (exemple déclaratif)](#7-format-des-sorts-exemple-déclaratif)
8. [Contraintes et non-objectifs](#8-contraintes-et-non-objectifs)
9. [Validation et tests](#9-validation-et-tests)
10. [Prochaine étape immédiate](#10-prochaine-étape-immédiate)

---

## 1. Vision du projet

- **But** : clone jouable dans le navigateur du système de combat tactique PvP en 1v1 de Dofus (Kolizéum).
- **Cadre d'usage** : jouer **avec des amis**, pas de matchmaking public, pas d'anti-triche avancé.
- **Fidélité mécanique maximale** : sorts, équipements, formules de dégâts, LDV (ligne de vue), PA/PM/PO (points d'action / points de mouvement / portée), résistances, boucliers, états — tout doit coller au comportement du jeu officiel.
- **Apparence sobre et fonctionnelle** : pas d'émulation graphique du jeu original (pas de sprites, pas d'animations complexes, pas de décors 3D). Interface basée sur un **canvas HTML5** avec une grille hexagonale lisible, icônes textuelles ou symboliques, barres d'état claires.
- **Équipements exacts** tirés de la base de données réelle de Dofus : jets aléatoires tirés dans les bornes officielles puis figés à l'équipement.
- **Développement progressif** par versions livrables et testables indépendamment.

---

## 2. Décisions techniques fondamentales

| Sujet | Décision |
|---|---|
| Automatisation / orchestration | **Pas de n8n** (abandonné). |
| Backend | Serveur **Node.js** classique avec **Express + Socket.IO** pour le multijoueur. |
| Déploiement | D'abord **local sur macOS**, puis VPS ou cloud simple. |
| Base de données | **Pas de BDD lourde**. Fichiers **JSON statiques** générés par des scripts d'extraction depuis `api.dofusdb.fr`. Chargés côté client. **Cache local**. |
| Authentification | **Pas d'authentification complexe** : pseudos simples, rooms par code. |
| Anti-triche | **Pas d'anti-triche** : confiance entre amis. |
| Rendu | **Mono-page HTML5 Canvas**. |
| Taille de map | **Paramétrable** (petite / moyenne / grande ou dimensions libres). |

---

## 3. Architecture du projet

Structure des dossiers cible :

```
kolizeum/
├── client/
│   ├── index.html
│   ├── styles.css
│   ├── game.js              # moteur de combat, rendu canvas
│   ├── grid.js              # grille hexagonale, LDV, zones
│   ├── spells.js            # logique des sorts, interpréteur d'effets
│   ├── items.js             # équipement, conditions, filtrage
│   ├── network.js           # communication WebSocket
│   └── data/
│       ├── items.json
│       ├── spells.json
│       └── classes.json
├── server/
│   ├── server.js
│   ├── package.json
│   └── ...
├── scripts/
│   ├── fetch_items.js
│   └── fetch_spells.js
└── package.json
```

**Responsabilités des modules principaux :**

| Module | Rôle |
|---|---|
| `client/game.js` | Moteur de combat (boucle de tour, résolution d'effets), rendu canvas principal. |
| `client/grid.js` | Modèle de la grille hexagonale, calculs de distance, LDV, zones d'effet. |
| `client/spells.js` | Logique des sorts + interpréteur d'effets (damage, heal, boost, state, shield, …). |
| `client/items.js` | Équipement, conditions (niveau, classe, slot), filtrage, calcul des stats totales. |
| `client/network.js` | Communication WebSocket avec le serveur (créer/rejoindre room, envoyer actions). |
| `server/server.js` | Express + Socket.IO : gestion des rooms, état du jeu, diffusion des actions. |
| `scripts/fetch_items.js` | Interroge `api.dofusdb.fr/items`, génère `client/data/items.json`. |
| `scripts/fetch_spells.js` | Interroge `api.dofusdb.fr/spells` pour les classes ciblées, génère `client/data/spells.json`. |

---

## 4. Sources de données

- **API DofusDB** (`api.dofusdb.fr`) :
  - `GET /spells?slug=iop&lang=fr` (et variantes par classe) pour les sorts.
  - `GET /items` pour les équipements.
- **Dofensive** (site web) : référence humaine pour vérifier les sorts et corriger les ambiguïtés.
- **Mapping `effectId` → effet lisible** : sera documenté dans un fichier séparé avec des niveaux de confiance :
  - ✅ vérifié
  - ⚠️ probable
  - ❓ incertain

> Tous les scripts d'extraction doivent produire du JSON **autonome** (cache local), pour éviter de dépendre du réseau à l'exécution du jeu.

---

## 5. Feuille de route complète

### Version 0.1 — Fondations géométriques (Jalon 1)

- Grille hexagonale de taille paramétrable.
- Génération aléatoire de map avec obstacles + zones de départ opposées dégagées.
- Affichage des IDs/coordonnées des cellules.
- Interaction souris : sélection, calcul de distance, tracé de LDV visuel.
- Mode édition : ajout/suppression d'obstacles au clic.
- Implémentation **exacte** de l'algorithme de LDV d'Ankama (rayons passant par les centres des cellules, gestion des cellules « à moitié traversées » qui bloquent la LDV).
- **Livrable** : **1 fichier HTML unique autonome**, ouvrable dans un navigateur. **Aucune dépendance**.
- **Validation** : comparaison visuelle avec le jeu réel pour LDV et distances.

### Version 0.2 — Base d'équipements et interface d'équipement

- Script Node.js `fetch_items.js` : interroge `api.dofusdb.fr`, récupère **TOUS** les équipements avec leurs effets, plages de jets, conditions (niveau, classe, slots).
- Génération de `items.json` : champs utiles uniquement, mapping des `effectId`.
- Interface HTML/CSS : panneau **par slot** (Arme, Coiffe, Cape, Anneau, Ceinture, Bottes, etc.), filtrage par niveau, respect des conditions (classe, unicité par slot).
- **Jets aléatoires tirés dans les bornes officielles, figés à la sélection**.
- **Calcul des stats totales du personnage** :
  - Caractéristiques primaires : force, intelligence, agilité, chance, sagesse.
  - Combat : PA, PM, PO, dommages %, résistances %, résistances fixes, critiques, invocation, etc.
- Gestion des **panoplies** : bonus de set détectés et appliqués automatiquement (X pièces équipées ⇒ bonus).
- **Livrables** : `fetch_items.js` + `items.json` + panneau d'équipement HTML.

### Version 0.3 — Sorts du Iop et du Crâ

- Script `fetch_spells.js` : récupère les sorts des classes **Iop** et **Crâ** depuis DofusDB, conversion en format déclaratif lisible.
- Pour chaque sort : `name`, `level`, `baseApCost`, `ranges` (min/max), `modifiableRange`, `lineOfSight`, `zones` (type, taille, masque de cible, max cibles), `effects` détaillés, conditions d'utilisation.
- **Interpréteur d'effets basique** : `damage`, `heal`, `boost`, `state`, `shield`.
- Intégration avec les caractéristiques du personnage (jets, bonus caractéristiques élémentaires).
- **Interface de test** : grille + 2 entités, lancer un sort et observer le résultat.
- **Livrables** : `fetch_spells.js` + `spells.json` (iop + cra) + module `spells.js` + interface de test.

### Version 1.0 — Combat complet 1v1 local

- Deux joueurs, **deux onglets navigateur** communiquant via WebSocket local ou `BroadcastChannel`.
- Phase d'équipement avant combat pour chaque joueur.
- Génération aléatoire de la map, placement des adversaires.
- **Système de tours** : PA (10 par défaut, ajustables par équipement), PM (3 par défaut), régénération complète en début de tour.
- **Interface de combat** :
  - Grille avec les deux personnages.
  - Barres PA / PM / Vie / Bouclier.
  - Panneau des sorts disponibles.
  - Clic sort → affichage portée + zone → clic cible → résolution.
  - Déplacement avec vérification du chemin et des obstacles.
  - **Fin de tour automatique** si plus assez de PA/PM.
- **Formule de dégâts** proche de l'officielle :
  - Dégâts de base = jets du sort + caractéristique élémentaire + %dommages.
  - Dégâts finaux = base × (1 − résistance% adverse) − résistance fixe adverse.
- **Gestion des états temporaires** (érosion, etc.) et des boucliers.
- **Journal de combat textuel** (liste des actions + résultats).
- **Condition de victoire** : PV à 0.
- **Livrable** : ensemble complet client + serveur local WebSocket.

### Version 1.1 — Multijoueur en ligne simple

- Serveur **Node.js + Socket.IO**.
- **Rooms** avec code de rejoignage (court, partageable).
- Transmission des actions entre clients.
- **État du jeu maintenu côté serveur** (anti-désynchro ; pas d'anti-triche).
- Interface de connexion (pseudo, créer / rejoindre une room).
- Équipement avant combat côté client, stats envoyées au serveur.
- Gestion des déconnexions (pause, reconnexion).

### Version 1.2 — Extension progressive des classes

Déploiement par vagues :

| Vague | Classes | Notes |
|---|---|---|
| Vague 1 | **Eniripsa**, **Féca** | Soins, boucliers — fait émerger la nécessité d'un vrai module `shield` et `heal` robuste. |
| Vague 2 | **Sram**, **Sacrieur** | Pièges, invisibilité, châtiments. |
| Vague 3 | **Ecaflip**, **Pandawa** | Mécaniques aléatoires, portage. |
| Vague 4 | Autres classes sans invocations | Compléter le panel PvP. |

Pour chaque vague :
- Nouveaux sorts récupérés et ajoutés à `spells.json`.
- Ajustements de l'interpréteur d'effets.
- **Sélection de classe** au début du combat.

### Version 1.3 — Invocations et mécaniques avancées

- Création d'**entités d'invocation** avec leurs propres PV, PA, PM, sorts.
- **IA basique** : se déplacer vers l'ennemi, attaquer.
- **Blocage de LDV** par les invocations (le `grid.js` doit les traiter comme obstacles dynamiques).
- Sorts d'invocation des classes concernées (Osamodas, Sadida, …).

### Version 2.0 — Confort et compétitif

- Comptes simples (localStorage ou BDD légère) : **builds sauvegardés**.
- **Classement ELO** entre amis.
- **Mode spectateur**.
- **Replay** : sauvegarde / export JSON de la séquence d'actions.
- Améliorations UI : thèmes, sons optionnels, responsive mobile.

---

## 6. Mécaniques clés à implémenter fidèlement

### Grille et LDV

- Grille hexagonale **pointy-top** ou **flat-top** — à confirmer en comparant au jeu officiel.
- **Algorithme de LDV** : tracer une ligne entre les **centres** de deux cellules. Pour chaque cellule traversée, vérifier si elle contient un obstacle (ou une invocation). Si oui ⇒ **LDV bloquée**.
- **Cellules « à moitié traversées »** (cas où la ligne passe pile entre deux cellules) : elles sont **considérées comme traversées** et **bloquent la LDV** si elles contiennent un obstacle. C'est une subtilité Ankama à ne pas oublier.

### Formule de dégâts

- **Dégâts de base** = jets du sort + caractéristique élémentaire + %dommages.
- **Dégâts finaux** = base × (1 − résistance% adverse) − résistance fixe adverse.
- Prise en compte des dégâts de poussée, vol de vie, etc.

### PA, PM, PO

- **PA** : points d'action par tour (10 par défaut, modifiables par équipement).
- **PM** : points de mouvement par tour (3 par défaut).
- **PO** : portée des sorts (modifiable ou non selon le sort).
- **Régénération complète** en début de tour.

### États et buffs

- Durée exprimée en **tours**.
- **Empilables ou non** selon l'effet.
- Types courants : boost caractéristique, érosion, invulnérabilité, etc.

### Invocations (V1.3+)

- Entité séparée avec ses propres PV / PA / PM.
- **Bloque la LDV** (traitées comme obstacles dynamiques dans `grid.js`).
- **Disparaît si l'invocateur meurt**.

---

## 7. Format des sorts (exemple déclaratif)

```json
{
  "id": "iop_pression_6",
  "name": "Pression",
  "class": "iop",
  "level": 6,
  "baseApCost": 4,
  "ranges": [{ "min": 1, "max": 1 }],
  "modifiableRange": false,
  "lineOfSight": true,
  "zones": [
    {
      "type": "circle",
      "radius": 0,
      "targetMask": "ennemi",
      "maxTargets": 1
    }
  ],
  "effects": [
    { "type": "damage", "element": "terre", "diceNum": 2, "diceSide": 15, "baseValue": 0 }
  ]
}
```

**Notes :**

- `ranges` est un tableau pour gérer les sorts à plusieurs paliers de portée.
- `zones` est un tableau car un sort peut avoir plusieurs zones (ex : une zone principale + un effet résiduel).
- `targetMask` accepte au minimum `ennemi`, `allié`, `soi`, `case_vide`, `tout`.
- `effects` est appliqué séquentiellement sur les cellules résolues par chaque zone.
- `element` parmi `terre`, `feu`, `eau`, `air`, `neutre` (avec règles de maîtrise élémentaire plus tard).

---

## 8. Contraintes et non-objectifs

| Non-objectif | Raison |
|---|---|
| **Pas d'animations** fluides type Dofus | Feedback visuel simple : changement de couleur, flash, texte. |
| **Pas d'apparence 3D** ni de sprites extraits du jeu | Icônes textuelles (ex : « I » pour Iop, « C » pour Crâ) ou formes géométriques simples. |
| **Pas d'anti-triche** avancé | Confiance entre amis uniquement. |
| **Pas de matchmaking** public | Rooms avec code uniquement. |
| **Pas de PvE** ni de monstres | Uniquement PvP 1v1. |
| **Pas de boutique** ni de drops | Tous les équipements sont disponibles dans l'interface d'équipement avant combat, filtrés par niveau et classe. |

---

## 9. Validation et tests

- **Chaque version doit être testable indépendamment** (un livrable = un point de validation).
- **LDV et distances** : validées par comparaison visuelle avec le jeu réel (cas typiques : portée 0, portée max, ligne droite, lignes courbes à travers obstacles).
- **Dégâts** : vérifiés avec des cas simples (stats nulles, résistances nulles, full dégâts) pour valider la formule.
- **Données équipements / sorts** : croisées entre **DofusDB** et **Dofensive** ; divergences ⇒ correction du mapping `effectId` avec changement du niveau de confiance.

---

## 10. Prochaine étape immédiate

**Livrer la Version 0.1** :

- Un fichier **HTML unique** avec :
  - Grille hexagonale interactive (taille paramétrable).
  - Génération aléatoire d'obstacles.
  - Mode édition (clic pour ajouter/supprimer un obstacle).
  - Calcul de distance entre deux cellules.
  - Tracé visuel de la LDV avec gestion correcte des cellules « à moitié traversées ».
  - Affichage des IDs/coordonnées des cellules.
- **Aucune dépendance externe** : le fichier doit s'ouvrir tel quel dans un navigateur.
- **Critère de succès** : un joueur peut comparer la LDV tracée avec celle du jeu officiel sur plusieurs cas et obtenir le même résultat.

---

*Fin du brief — transmettre ce document tel quel à l'agent qui reprend la main sur le code.*
