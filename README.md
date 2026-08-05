# Kolizéum — clone tactique 1v1

Clone jouable dans le navigateur du système de combat tactique PvP 1v1 de Dofus
(Kolizéum) : fidélité mécanique maximale, apparence volontairement sobre.

Le brief complet du projet est archivé dans [`docs/brief.md`](docs/brief.md).

---

## Démarrage rapide

```bash
node scripts/make_sample.js     # données d'exemple (fictives), sans réseau
npm test                        # suite de tests, sans dépendance
```

Puis ouvrir directement dans un navigateur (aucun serveur nécessaire) :

| Fichier | Version | Contenu |
|---|---|---|
| `client/index.html` | v0.1 | Grille tactique, distance, ligne de vue |
| `client/equipment.html` | v0.2 | Catalogue d'équipement, jets, panoplies, statistiques |

Pour les **données officielles** (nécessite un accès à `api.dofusdb.fr`) :

```bash
node scripts/fetch_items.js             # extraction complète
node scripts/fetch_items.js --max 200   # échantillon rapide
node scripts/fetch_items.js --help      # options
```

Le script écrit `client/data/items.json` et sa variante `items.data.js`, qui
prend automatiquement le pas sur les données d'exemple au chargement de la page.

> Tant que `fetch_items.js` n'a pas tourné, la console du navigateur signale un
> `ERR_FILE_NOT_FOUND` sur `data/items.data.js` : c'est attendu, la page bascule
> alors sur les données d'exemple et le bandeau orange le rappelle.

### Extraire les données sans machine de développement

iOS n'exécute pas Node.js : aucune app de l'App Store ne fournit de vrai
runtime, le système interdisant l'exécution de code arbitraire. Le workflow
[`.github/workflows/fetch-items.yml`](.github/workflows/fetch-items.yml) fait
donc tourner le script sur les serveurs de GitHub, ce qui suffit depuis un
téléphone.

**Onglet Actions → « Extraire les équipements (DofusDB) » → Run workflow.**

> ⚠️ Après une correction du code, il faut un **nouveau** run : le bouton
> **« Re-run jobs »** d'un run existant rejoue le commit figé de ce run, donc la
> version d'avant la correction. Le bouton **« Run workflow »** est le seul à
> prendre la dernière version de la branche.

Options du formulaire :

| Entrée | Effet |
|---|---|
| `lang` | Langue des libellés (`fr` par défaut) |
| `max` | Nombre maximal d'objets — mettre `200` pour un premier essai rapide |
| `commit` | Commiter les données dans le dépôt (activé par défaut) |

Le workflow lance la suite de tests, extrait les données, puis publie le
**rapport d'extraction dans le résumé du run** : types d'objets non classés,
effets inconnus, divergences de mapping. C'est ce rapport qu'il faut lire pour
savoir quoi corriger dans les tables en tête de `scripts/fetch_items.js`.

Les données sont également conservées en artefact téléchargeable pendant 14
jours, y compris si le commit est désactivé.

### Tout faire sans installer Node

Un navigateur suffit, sur n'importe quel système :

1. **Lancer le workflow** (onglet Actions) — l'extraction tourne chez GitHub.
2. **Récupérer les données** : soit elles ont été commitées dans le dépôt, soit
   l'artefact `items-fr` du run se télécharge en ZIP depuis la page du run.
3. **Récupérer le projet** : bouton `Code` → `Download ZIP`, puis décompresser.
4. Si vous avez pris l'artefact, y copier `items.data.js` dans `client/data/`.
5. **Double-cliquer sur `client/equipment.html`.**

Les données d'exemple étant versionnées, l'étape 4 est facultative : les pages
s'ouvrent et fonctionnent dès la décompression, sur le jeu fictif.

Node n'est nécessaire que pour lancer l'extraction ou les tests en local. Sous
Windows : `winget install OpenJS.NodeJS.LTS` dans PowerShell, ou l'installeur
de [nodejs.org](https://nodejs.org).

---

## Version 0.2 — équipements et interface d'équipement

### Livrables

| Fichier | Rôle |
|---|---|
| `scripts/fetch_items.js` | Extraction DofusDB → `items.json` (aucune dépendance, Node 18+) |
| `scripts/make_sample.js` | Jeu de données fictif au format exact, pour travailler sans réseau |
| `client/items.js` | Jets, emplacements, conditions, statistiques, panoplies |
| `client/equipment.html` | Panneau d'équipement complet |
| `docs/effects.md` | Mapping `effectId` → effet lisible et niveaux de confiance |

### Ce que fait l'interface

- Catalogue filtrable par emplacement, niveau et nom.
- **Jets tirés dans les bornes officielles et figés à l'équipement**, avec
  affichage de la fourchette et de la position du jet obtenu.
- Modes de jet : aléatoire, minimal, moyen, maximal — pour comparer un objet
  parfait à un objet moyen. Graine reproductible.
- Capacité respectée par emplacement (2 anneaux, 6 Dofus/trophées, etc.) et
  refus des doublons sur un même emplacement.
- **Panoplies** détectées automatiquement, avec palier atteint et bonus appliqué.
- **Points de caractéristiques** : 5 par niveau du 2 au 200, soit 995 au niveau
  200, à répartir entre vitalité, sagesse, force, intelligence, chance et
  agilité. La valeur se saisit directement au clavier ; une valeur hors budget
  est ramenée au maximum atteignable plutôt que refusée. Le coût du prochain
  point est affiché en permanence.

  | Caractéristique | Coût |
  |---|---|
  | Vitalité | 1 pour 1, sans palier |
  | Sagesse | 3 pour 1, sans palier |
  | Force, Intelligence, Chance, Agilité | 1 pour 1 jusqu'à 100, puis 2, puis 3, puis 4 au-delà de 300 |

  Soit, au niveau 200 : **995** en vitalité, **331** en sagesse, **398** en
  élémentaire.
- **Parchemins** : une case porte les quatre éléments à 101 sans dépenser un
  point. Ces 101 **n'entrent pas dans le calcul des paliers** — le coût du
  prochain point suit la seule valeur achetée avec des points.
- **Forgemagie** : modifier la valeur de n'importe quelle ligne d'un objet
  équipé, ou lui ajouter une ligne exotique. Le dépassement des bornes
  officielles est signalé, jamais interdit — c'est un outil de théorycraft, pas
  une simulation d'atelier. La forge appartient à l'exemplaire porté, pas à la
  définition de l'objet.
- Récapitulatif des statistiques : base, points, apport des objets, apport des
  panoplies, total — et points de vie dérivés de la vitalité.
- Export / import d'un build en JSON, répartition et forge comprises.

### Le point délicat : les identifiants d'effets

Les objets ne portent pas d'effets lisibles mais des identifiants numériques.
Se tromper sur l'un d'eux ne provoque aucun plantage : cela produit des
statistiques fausses, donc des dégâts faux, dans un simulateur qui a l'air de
fonctionner. Trois garde-fous :

1. Le libellé est **dérivé de l'API** (gabarit de description Ankama), pas
   d'une table recopiée à la main.
2. Il est **recoupé** avec une table indépendante ; concordance ⇒ `verifie`,
   API seule ⇒ `probable`, divergence ⇒ `incertain`, signalée à l'extraction.
3. `client/items.js` **n'interprète aucun identifiant** : il agrège par clé
   normalisée. Un effet non confirmé reste **affiché** dans la fiche de l'objet
   et dans un encart dédié, mais **n'entre dans aucun total**.

Un effet affiché mais non compté est un manque visible ; un effet compté à tort
est une erreur invisible. Voir [`docs/effects.md`](docs/effects.md).

### Deuxième écart assumé avec le brief : les PA de base

Le brief annonce « PA : 10 par défaut ». Le jeu officiel donne **6 PA et 3 PM**
à tout personnage quel que soit son niveau — les 10 à 12 PA des builds de haut
niveau viennent de l'équipement. La fidélité mécanique étant l'objectif premier,
`client/items.js` retient 6 PA, dans la constante `BASE_CHARACTER` : revenir à
10 ne demande qu'une ligne.

Sont également marquées « à confirmer » dans le code, faute de source
vérifiable hors ligne : les points de vie de base (55 au niveau 1, +5 par
niveau) et le caractère **non cumulatif** des paliers de panoplie (4 pièces ⇒
bonus « 4 pièces » seul, et non la somme des paliers).

Le barème des points de caractéristiques, lui, a été confirmé et n'est plus une
hypothèse.

### Limites connues

- Le champ `criteria` des objets (conditions du type `CS>20&PL<50`) est
  **conservé brut et non interprété**. Seule la condition de niveau est
  appliquée. Les autres conditions sont **affichées** sur la fiche sans
  empêcher d'équiper : un filtre fondé sur une grammaire mal comprise
  masquerait des objets valides, ce qui est plus difficile à repérer.
- Le classement d'un type d'objet vers un emplacement repose sur le **nom** du
  type, vérifiable d'un coup d'œil, et non sur un identifiant numérique. Les
  types non reconnus sont listés en fin d'extraction pour être ajoutés en une
  ligne à `SLOT_BY_TYPE`.

### Tests

`npm test` couvre les deux versions, sans réseau ni navigateur :

| Fichier | Portée |
|---|---|
| `tests/grid.test.js` | Géométrie et LDV de la v0.1, extraites du livrable HTML |
| `tests/items.test.js` | Jets, emplacements, statistiques, panoplies |
| `tests/fetch_items.test.js` | `fetch_items.js` de bout en bout contre une fausse API DofusDB |

L'interface d'équipement a par ailleurs été vérifiée dans un navigateur
(équipement, filtres, relance des jets, export/import, effets non cumulés).

---

## Version 0.1 — fondations géométriques

**Livrable : [`client/index.html`](client/index.html)** — un fichier HTML unique,
sans aucune dépendance. Ouvrez-le directement dans un navigateur (double-clic,
aucun serveur requis).

### Contenu

- Grille tactique de taille paramétrable (14 × 20 par défaut, soit 560 cellules
  comme une carte Dofus).
- Génération aléatoire déterministe (graine) : obstacles en amas, zones de
  départ opposées dégagées, connectivité entre les deux zones garantie.
- Trois natures de cellule : libre, **obstacle** (bloque LDV + déplacement),
  **trou** (bloque le déplacement, laisse passer la LDV).
- Mode édition : pinceau obstacle / trou / libre, peinture au glisser.
- Distance Dofus entre deux cellules, ligne de vue tracée et surlignée.
- Affichage des identifiants ou des coordonnées `(x, y)` des cellules.
- Export / import de la carte en JSON, pour rejouer un cas de test précis.
- Auto-tests exécutés au chargement (résultats dans la console du navigateur).

### Commandes

| Action | Commande |
|---|---|
| Placer **A** (source) | Clic gauche (mode inspection) |
| Placer **B** (cible) | Clic droit (mode inspection) |
| Peindre / effacer | Clic gauche / clic droit (mode édition) |
| Basculer le mode édition | <kbd>E</kbd> |
| Régénérer la carte | <kbd>R</kbd> |
| Règle des cellules « à moitié traversées » | <kbd>L</kbd> |
| Étiquettes (rien / id / x,y) | <kbd>C</kbd> |

---

## Écart assumé avec le brief : la grille n'est pas hexagonale

Le brief demande une grille **hexagonale**, tout en précisant (§6) que
l'orientation reste « à confirmer en comparant au jeu officiel », et fixe comme
critère de réussite d'obtenir **la même LDV que le jeu réel**.

Or Dofus n'utilise pas de grille hexagonale : le damier du Kolizéum est une
grille **isométrique en losanges**, c'est-à-dire un réseau carré tourné à 45° et
aplati verticalement (ratio 2:1). Chaque cellule a **4 voisins** — et non 6.
Une implémentation hexagonale rendrait le critère de réussite inatteignable :
ni les distances, ni les portées, ni la LDV ne pourraient coïncider avec le jeu.

La géométrie isométrique est donc implémentée, et c'est elle qui sera conservée
pour la suite du projet. Les termes du brief restent valables partout ailleurs.

### Repère utilisé

On travaille dans un repère « diamant » `(x, y)` où **chaque cellule est un
carré unité centré sur des coordonnées entières**. C'est le repère naturel de la
grille de Dofus, et il rend les calculs exacts et simples :

```
écran :     sx = (x - y) · demi-largeur
            sy = (x + y) · demi-hauteur
voisins :   (x±1, y) et (x, y±1)      → les 4 losanges adjacents à l'écran
distance :  |Δx| + |Δy|               → distance de Manhattan
```

Conséquence conforme au jeu : deux cellules **côte à côte horizontalement à
l'écran** sont à **distance 2**, pas 1 — elles ne sont pas adjacentes au sens
tactique.

Numérotation identique à Dofus : `W` cellules par rangée écran, `2H` rangées
décalées d'une demi-cellule, identifiants croissants de gauche à droite puis de
haut en bas, total `W × H × 2`.

---

## Algorithme de ligne de vue

1. Tracer un segment entre les **centres** des deux cellules.
2. Collecter toutes les cellules dont le carré **fermé** est intersecté par ce
   segment (*supercover*).
3. Une cellule contenant un obstacle bloque la LDV — **sauf** les cellules de
   départ et d'arrivée, qui ne bloquent jamais (la cible ne se masque pas
   elle-même).

Le point 2 encode la subtilité Ankama : une cellule seulement **effleurée** — le
segment passant pile par l'un de ses coins — compte comme traversée et bloque
donc la LDV si elle contient un obstacle. C'est la règle des cellules « à moitié
traversées », activée par défaut et débrayable dans l'interface pour comparer
les deux comportements côte à côte.

**Arithmétique exacte, sans epsilon.** Les extrémités sont entières et les bords
de cellule tombent sur des demi-entiers : toutes les coordonnées sont doublées
pour rester dans les entiers, et les instants de parcours sont comparés sous
forme de fractions (produits en croix). Les cas limites — précisément ceux qui
définissent la règle — sont donc tranchés exactement, jamais par tolérance
numérique.

### Propriétés vérifiées

Les auto-tests embarqués (console) et les campagnes de test hors ligne
confirment :

- bijection identifiant ↔ `(x, y)` sur toute la grille ;
- parcours continu, source en tête et cible en queue de liste ;
- **symétrie** de la LDV (16 000 paires sur cartes aléatoires, sous les deux
  règles) ;
- cellules adjacentes toujours en vue ;
- les trous laissent passer la LDV, les obstacles la bloquent ;
- mode permissif ⊆ mode strict ;
- anneaux de portée à `4·r` cellules, propriété de la distance Dofus ;
- génération : zones de départ dégagées et reliées, jusqu'à 45 % d'obstacles.

### Bordure de carte

Un rayon reliant deux cellules valides peut **effleurer** des cellules situées
hors de la grille (typiquement le long des rangées de bord). Vérification faite
sur toutes les paires de plusieurs tailles de grille : ces cellules sont
toujours effleurées, **jamais réellement traversées**. Elles sont donc
transparentes — les compter comme bloquantes couperait la LDV le long des
rangées de bord.

---

## Validation restant à faire

Conformément au brief, la fidélité finale se valide **par comparaison visuelle
avec le jeu officiel**. La marche à suivre :

1. Reproduire une situation du jeu dans l'outil (mode édition).
2. Comparer distance et LDV entre les mêmes cellules.
3. En cas de divergence, le bouton **Exporter** produit un JSON rejouable à
   joindre au rapport.

Cas à couvrir en priorité : portée 0 et portée maximale, ligne droite, rayons
diagonaux passant par les coins (le cas discriminant pour la règle des cellules
« à moitié traversées »), et obstacles en quinconce.

---

## Suite de la feuille de route

Version 0.3 — sorts du Iop et du Crâ : `scripts/fetch_spells.js`, format
déclaratif des sorts, interpréteur d'effets (`damage`, `heal`, `boost`,
`state`, `shield`) et interface de test sur la grille.

Voir [`docs/brief.md`](docs/brief.md) pour le détail des jalons.
