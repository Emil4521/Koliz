# Kolizéum — clone tactique 1v1

Clone jouable dans le navigateur du système de combat tactique PvP 1v1 de Dofus
(Kolizéum) : fidélité mécanique maximale, apparence volontairement sobre.

Le brief complet du projet est archivé dans [`docs/brief.md`](docs/brief.md).

---

## État actuel : version 0.1 — fondations géométriques

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

Version 0.2 — extraction des équipements depuis `api.dofusdb.fr` et interface
d'équipement. Voir [`docs/brief.md`](docs/brief.md) pour le détail des jalons.
