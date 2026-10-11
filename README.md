# Marine GPS

Application web statique : position GPS, routes, repères nautiques, traces et GPX.
Aucun compte ni abonnement n'est nécessaire. Les fonds de carte utilisent encore
Internet : cette version n'est pas une application hors ligne.

## Démarrer

Depuis ce dossier :

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Ouvrir http://localhost:8000. Pour une utilisation sur téléphone, servir
l'application en HTTPS et autoriser la géolocalisation. Node.js est nécessaire
uniquement pour les tests, pas pour utiliser ou héberger l'application.

## Navigation

- Créer ou importer une route puis choisir **Suivre** dans la liste des routes.
- Le premier point est la cible initiale. **Suivant** et **Précédent** permettent
  de choisir explicitement le point visé ; aucune branche n'est choisie par proximité.
- Le passage automatique se fait dans un rayon de 30 m, avec une précision GPS
  annoncée de 30 m ou mieux. Un seul point peut être validé par nouvelle position.
- Au dernier point, le panneau indique **Arrivée atteinte**. **Terminer** arrête le suivi.
- L'écart transversal (XTE) est géodésique : positif à bâbord du segment actif,
  négatif à tribord. Il n'est pas calculé avant le premier point.
- **ETE** indique une durée estimée à la vitesse fond actuelle, pas une heure d'arrivée.
- Le point cible et le segment actif sont jaunes ; les repères personnels restent visibles.
- Le bouton **◎** recentre la carte sur la dernière position connue.

L'état GPS est toujours visible. Après 15 secondes sans position fraîche, en cas
d'erreur ou au-delà de 50 m de précision annoncée, les instruments deviennent
indisponibles. Les positions imprécises ne sont pas enregistrées et ne font pas
avancer la route. La direction calculée n'est utilisée que lorsque le déplacement
dépasse l'incertitude des positions ; une direction inconnue est représentée par un cercle.

## Traces et sauvegarde

- Le bouton rouge démarre l'enregistrement ; une seconde pression le met en pause.
- En pause, **Archiver la sortie** conserve les positions, horaires, précisions et
  segments, puis permet de commencer une nouvelle sortie indépendante.
- **Créer une route** produit une copie des coordonnées et conserve la trace originale.
  La conversion est refusée pour les traces interrompues afin de ne pas créer de
  liaison fictive entre leurs segments.
- Une pause/reprise ou un intervalle GPS de plus de 15 secondes ouvre un nouveau segment.
- **Sorties enregistrées**, dans le panneau inférieur déplié, donne accès aux traces
  archivées/importées : affichage, conversion et suppression confirmée.
- Le menu **GPX** exporte les éléments sélectionnés, y compris les données en mémoire
  lorsque le stockage échoue. Un export GPX conserve les horaires et segments ;
  la précision GPS reste une donnée du stockage local, sans extension GPX dédiée.
- Archiver ou supprimer la trace active avant d'importer un GPX (limite : 20 Mo).

Le stockage IndexedDB version 4 lit les anciennes traces de la version 3 sans les
supprimer. À leur prochaine sauvegarde, les points sont écrits par blocs de 256.
Pendant l'enregistrement, les sauvegardes sont espacées d'au moins 5 secondes ;
une pause, un archivage et le passage de la page en arrière-plan demandent une
sauvegarde immédiate. La fermeture forcée du navigateur peut perdre les derniers
points non sauvegardés. L'échec d'un archivage laisse la trace active et exportable.
Fermer les anciens onglets si une mise à jour du stockage est bloquée.

## Vérifications

Avec Node.js 22 récent ou ultérieur :

```sh
npm ci
npm test
npx playwright install chromium
npm run test:browser
```

Les tests unitaires couvrent navigation, GPS, segments, GPX et migration IndexedDB.
Les parcours Chromium utilisent la vraie bibliothèque MapLibre, des positions GPS
simulées et un fond de carte de test local. Ils vérifient notamment la sauvegarde,
la reprise, la conservation des repères et l'export après panne de stockage.
Le serveur de test utilise Python 3 et le port local 8765.

MapLibre est figé en version 6.14.0 dans les imports, le HTML et les dépendances de test.
Cette mise à jour inclut le correctif de l'avis
[GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579).

## Prochaines étapes

- Démarrage hors connexion et gestion explicite de zones cartographiques téléchargées.
- Édition/inversion des routes et navigation directe vers un repère.
- Essais sur téléphones réels, notamment écran verrouillé et pendant une longue sortie.
- Homme à la mer, alarmes et météo après validation du comportement mobile.

Les routes dessinées ne sont pas vérifiées contre les profondeurs ou les dangers.
Le fond actuel et la surcouche de balisage ne constituent pas une carte marine complète.
