# Mapping `effectId` → effet lisible

Document de référence exigé par le brief (§4). Il décrit **comment** la
correspondance est établie, **quel crédit accorder** à chaque entrée, et
**quoi faire** en cas de divergence.

Le fichier de données correspondant, `client/data/effects-map.json`, est
regénéré à chaque exécution de `scripts/fetch_items.js` : il ne doit pas être
édité à la main. Les corrections se font dans les tables du script.

---

## Pourquoi ce document existe

Les objets de Dofus ne portent pas d'effets lisibles mais des identifiants
numériques (`effectId`). Rien dans les données ne garantit qu'un identifiant
donné signifie « Force » plutôt que « Sagesse ». Une erreur ici ne provoque
aucun plantage : elle produit silencieusement des statistiques fausses, donc
des dégâts faux, donc un simulateur qui a l'air de marcher et ne reproduit pas
le jeu. D'où le parti pris : **aucune correspondance n'est appliquée sans être
tracée, et une correspondance douteuse n'est jamais cumulée dans un total.**

---

## Les trois sources

| Source | Nature | Rôle |
|---|---|---|
| `GET /effects` de DofusDB | Gabarit de description Ankama, ex. `+#1{~1~2 à }#2 Force` | Source primaire : le libellé est extrait du gabarit |
| `EFFECT_CROSSCHECK` (dans `scripts/fetch_items.js`) | Table courte issue de la documentation communautaire | Contrôle croisé indépendant de l'API |
| `STAT_BY_LABEL` (dans `scripts/fetch_items.js`) | Libellé normalisé → statistique agrégée | Décide de ce qui entre dans les totaux |

Le libellé est obtenu en dépouillant le gabarit de ses marqueurs
(`labelFromTemplate`) : `+#1{~1~2 à }#2 Force` → `Force`.

---

## Niveaux de confiance

Chaque entrée de la table porte un champ `confidence` :

| Niveau | Signification | Conséquence |
|---|---|---|
| ✅ `verifie` | L'API **et** la table de recoupement donnent le même libellé | Cumulé si `statKey` est défini |
| ⚠️ `probable` | Dérivé de l'API seule ; absent de la table de recoupement | Cumulé si `statKey` est défini |
| ❓ `incertain` | L'API et la table **divergent**, ou aucun libellé exploitable | Signalé à l'extraction ; à arbitrer |
| `exemple` | Donnée fictive produite par `make_sample.js` | Sans valeur de référence |

Deux sources concordantes ne valent pas une preuve : `verifie` signifie
« aucune raison de douter », pas « validé contre le jeu ». La validation réelle
reste la comparaison avec **Dofensive** ou avec le jeu, prévue par le brief §9.

---

## Découplage : `statKey`

`client/items.js` **n'interprète aucun `effectId`**. Il agrège par `statKey`,
une clé normalisée calculée à l'extraction. Cette indirection a une raison
précise : tant que la signification d'un effet n'est pas confirmée, il ne doit
pas polluer un total.

Un effet sans `statKey` :

- reste **visible** dans la fiche de l'objet, avec son libellé et un ⚠ ;
- est listé dans le bloc « Effets non cumulés » du récapitulatif ;
- n'entre **dans aucun total**.

C'est volontaire. Un effet affiché mais non compté est un manque visible ; un
effet compté à tort est une erreur invisible.

### Statistiques agrégées reconnues

`vitalite`, `force`, `intelligence`, `chance`, `agilite`, `sagesse` ·
`pa`, `pm`, `po`, `initiative`, `critPct`, `invocations`, `soins`, `puissance`,
`prospection`, `tacle`, `fuite`, `esquivePa`, `esquivePm`, `retraitPa`,
`retraitPm` ·
`domFixe`, `domPct`, `domTerre`, `domFeu`, `domEau`, `domAir`, `domNeutre`,
`domCrit`, `domPoussee`, `domSorts`, `domArmes`, `domPieges`, `domPctPieges`,
`renvoiDom`, `volVie` ·
`resPctTerre`, `resPctFeu`, `resPctEau`, `resPctAir`, `resPctNeutre`,
`resFixeTerre`, `resFixeFeu`, `resFixeEau`, `resFixeAir`, `resFixeNeutre`,
`resCrit`, `resPoussee`.

---

## Table de recoupement

Reproduite ici pour relecture ; elle fait foi dans
`scripts/fetch_items.js` → `EFFECT_CROSSCHECK`.

| `effectId` | Libellé attendu |
|---|---|
| 111 | PA |
| 112 | Dommages |
| 115 | % Critique |
| 118 | Force |
| 119 | Agilité |
| 123 | Chance |
| 124 | Sagesse |
| 125 | Vitalité |
| 126 | Intelligence |
| 128 | PM |
| 138 | % Dommages |
| 158 | Soins |

**Ces valeurs ne sont pas des données officielles.** Elles proviennent de la
documentation communautaire et n'ont pas été confrontées à l'API — c'est
justement l'objet du recoupement. Une divergence signalée à l'extraction ne
signifie pas que l'API a tort : elle signifie que cette table doit être
tranchée contre Dofensive, puis corrigée.

La table est volontairement courte. L'étendre à une centaine d'entrées
recopiées sans vérification n'ajouterait pas de fiabilité, seulement de fausses
confirmations : un recoupement n'a de valeur que si ses deux sources sont
réellement indépendantes.

---

## Procédure en cas de divergence

`fetch_items.js` affiche en fin d'exécution :

- les divergences API / table de recoupement ;
- les identifiants attendus mais absents de `/effects` ;
- les effets référencés par des objets mais absents de `/effects` ;
- le nombre d'effets sans `statKey` ;
- les types d'objets non classés par emplacement.

Marche à suivre :

1. Ouvrir la fiche de l'effet sur **Dofensive** ou vérifier un objet connu
   in-game qui le porte.
2. Trancher, puis corriger dans `scripts/fetch_items.js` :
   - un libellé faux ou manquant → `EFFECT_CROSSCHECK` ;
   - un effet correct mais non cumulé → `STAT_BY_LABEL` ;
   - un type d'équipement non classé → `SLOT_BY_TYPE`.
3. Relancer le script. Le niveau de confiance se recalcule seul.

Aucune correction ne se fait dans les fichiers de `client/data/` : ils sont
regénérés et toute édition manuelle serait perdue.

---

## Limite connue : conditions d'utilisation

Le champ `criteria` des objets (chaînes du type `CS>20&PL<50`) est **conservé
brut et non interprété**. `checkRequirements` n'applique que la condition de
niveau, qu'il lit sur le champ `level`.

Les conditions non interprétées sont **affichées** sur la fiche de l'objet, en
orange, mais n'empêchent pas de l'équiper. Ce choix est délibéré : un filtre
fondé sur une grammaire mal comprise masquerait des objets valides, ce qui est
plus coûteux et plus difficile à repérer qu'une condition affichée mais non
appliquée. À reprendre lorsque la grammaire des critères Ankama aura été
documentée.
