# Marine GPS

Application web statique : position GPS, routes, repères nautiques, traces et GPX.
Aucun compte ni abonnement n'est nécessaire. L’application peut être installée et
rouverte sans réseau après une première préparation en ligne. Les fonds de carte
et le balisage nécessitent encore Internet : ils ne sont pas téléchargés.

## Démarrer

Depuis ce dossier :

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Ouvrir http://localhost:8000. Pour une utilisation sur téléphone, servir
l'application en HTTPS et autoriser la géolocalisation. Node.js est nécessaire
uniquement pour les tests, pas pour utiliser ou héberger l'application.

## Installation et fonctionnement hors connexion

1. Ouvrir l’application avec une connexion (HTTPS, ou localhost pour les essais).
2. Déplier le panneau inférieur et ouvrir **Installation / hors ligne**.
3. Attendre **Application prête hors connexion**. Ce contrôle vérifie tous les
   fichiers nécessaires, y compris MapLibre et son worker.
4. Sur Android, utiliser le bouton **Installer l’application** lorsqu’il est proposé,
   ou le menu du navigateur. Sur iPhone/iPad, dans Safari : **Partager → Sur l’écran d’accueil**.
5. Couper le réseau, fermer puis rouvrir l’application pour vérifier la préparation.

Sans réseau, la position GPS (avec autorisation), les repères, les routes, les traces,
le stockage et les échanges GPX restent utilisables. Une zone téléchargée couvrant
le centre de la carte est affichée automatiquement ; sans zone disponible, un
**fond neutre** remplace la carte. Les couches locales restent fonctionnelles même
si le serveur de cartes est indisponible. La reconnexion rétablit la carte en ligne,
sauf si une carte locale a été explicitement choisie avec **Afficher**.

L’installation ne garantit pas l’enregistrement écran verrouillé. Le navigateur
peut suspendre l’application en arrière-plan. Effacer les données du site supprime
également les traces locales et la copie hors connexion ; conserver des exports GPX.

Une mise à jour complète est préparée séparément puis attend la fermeture de tous
les onglets/fenêtres Marine GPS. Aucun rechargement automatique n’interrompt une
sortie. Les données IndexedDB ne sont pas effacées lors des mises à jour.

### Télécharger des zones gratuites

1. Déplacer et zoomer la carte sur la zone souhaitée.
2. Ouvrir **Installation / hors ligne → Cartes hors ligne**.
3. Nommer la zone, choisir le détail et consulter l’estimation indicative.
4. Lancer **Télécharger la zone** et garder l’application au premier plan.
5. Utiliser **Afficher**, puis tester une réouverture en mode avion.

Le téléchargement prépare tous les niveaux de zoom de 0 au niveau choisi (10, 12
ou 14), avec un plafond de 600 tuiles et 100 Mo stockés par zone. Au-delà, réduire la
zone ou le détail. L’estimation utilise 50 ko par tuile : la taille réelle varie
avec la densité des données. Le zoom reste possible au-delà du détail préparé,
sans ajouter de précision. Le contour vert délimite la zone et un message signale
une vue qui déborde. Les zones traversant le méridien ±180° ou les pôles ne sont
pas prises en charge : préparer des zones distinctes de chaque côté.

Le fond simplifié contient côtes, voies, bâtiments et noms latins (glyphes 0–511).
**Ni balisage OpenSeaMap, ni profondeurs, ni marées ne sont téléchargés.** La date
de la source apparaît dans la liste ; elle peut être ancienne. Il n’y a pas de
mise à jour automatique : télécharger une nouvelle zone puis supprimer l’ancienne.
Les cartes locales sont des fonds de repérage, pas des cartes nautiques officielles.

La source est l’archive Protomaps v4 sur Source Cooperative. Les [extractions
régionales sont documentées par Protomaps](https://docs.protomaps.com/basemaps/downloads)
et par [le dépôt du fournisseur](https://source.coop/protomaps/openstreetmap).
L’application extrait uniquement les tuiles demandées, sans utiliser cette archive
pour la navigation en ligne. Elle exige les réponses HTTP partielles et un ETag
stable pour ne jamais télécharger le fichier planète entier ni mélanger deux
versions. Le miroir v4 consulté le 12 octobre 2026 indiquait une dernière modification
au 31 mars 2026 ; la date OSM des métadonnées est privilégiée à l’affichage.
Les [conditions OpenFreeMap](https://openfreemap.org/tos/) ne permettent pas de
présumer une autorisation de collecte automatisée : aucun téléchargement massif
OpenFreeMap ou OpenSeaMap n’est donc ajouté.

Chaque zone possède son propre cache, indépendant des mises à jour de l’application.
Une zone n’est déclarée prête qu’après l’écriture de toutes les tuiles. Annulation
et erreur effacent l’ajout partiel ; une fermeture forcée laisse éventuellement une
entrée « téléchargement incomplet » à supprimer. **Supprimer** libère seulement
la carte choisie, sans retirer routes, repères ni traces. Le navigateur peut refuser
le stockage ou l’effacer : vérifier avant chaque départ et conserver les exports GPX.

Bibliothèques locales : PMTiles 4.5.0 (BSD-3-Clause), fflate (MIT), glyphes Noto Sans
issus de [Protomaps basemaps-assets](https://github.com/protomaps/basemaps-assets)
(SIL OFL). Les licences sont conservées dans `vendor/`. L’import ESM de fflate dans
PMTiles est adapté au chemin local ; aucune dépendance CDN n’est nécessaire hors ligne.

## Navigation

Pendant le suivi d’une route, **Réglages** permet de choisir un seuil d’alerte
d’écart de 50, 100, 200 ou 500 m (100 m par défaut, sauvegardé sur cet appareil).
L’alerte visuelle se déclenche lorsque l’écart transversal, diminué de l’incertitude
GPS, dépasse le seuil pendant au moins 3 secondes de positions reçues. Elle se
désactive lorsque l’écart augmenté de cette incertitude repasse sous 80 % du seuil.
Une position périmée, imprécise ou en erreur suspend la surveillance. Le premier
point n’a pas encore de segment de référence ; la surveillance commence au deuxième.
Il n’y a ni signal sonore ni garantie d’alerte lorsque l’application est masquée.

Le même panneau propose **Démarrer la simulation** : parcours depuis le premier
point, vitesse réglable et décalage fictif à bâbord pour tester l’alerte. Remettre
l’écart à zéro permet d’atteindre les points suivants. Le statut SIMULATION et le
bouton **Quitter la simulation** restent visibles ; les positions fictives ne
sont jamais ajoutées aux traces. Mettre un enregistrement en pause avant de lancer
ce test. La simulation est suspendue lorsque la page est masquée et n’est pas
restaurée au rechargement. Quitter restitue le point cible initial, retire le
bateau fictif et attend une nouvelle position GPS réelle. Les vitesses accélérées
affichées sont uniquement celles du test. Tout fonctionne aussi hors connexion.

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
Les tests hors ligne effacent le cache HTTP, ferment la page puis la rouvrent sans
réseau via le service worker, à la racine et sous `/marine/`. Ils vérifient aussi
les cas de préparation incomplète, d’échec d’installation et de mise à jour différée
sans perte des traces.
Le serveur de test utilise Python 3 et le port local 8765.

MapLibre 6.14.0 est fourni dans `vendor/maplibre-gl/` avec sa licence, pour que les
fichiers d’exécution soient servis localement sans dépendance à un CDN. Le package
npm de même version est utilisé pour vérifier la copie distribuée.
Cette mise à jour inclut le correctif de l'avis
[GHSA-jrc7-96c5-q579](https://github.com/maplibre/maplibre-gl-js/security/advisories/GHSA-jrc7-96c5-q579).

## Prochaines étapes

- Gestion explicite de zones cartographiques téléchargées (sources et droits à vérifier).
- Édition/inversion des routes et navigation directe vers un repère.
- Essais sur téléphones réels, notamment écran verrouillé et pendant une longue sortie.
- Homme à la mer, alarmes et météo après validation du comportement mobile.

Les routes dessinées ne sont pas vérifiées contre les profondeurs ou les dangers.
Le fond actuel et la surcouche de balisage ne constituent pas une carte marine complète.

## Déploiement et maintenance du cache

Déployer les fichiers statiques, y compris `sw.js`, `manifest.webmanifest`, `icons/`
et `vendor/`. Le projet fonctionne aussi dans un sous-dossier ; conserver les chemins
relatifs et servir `sw.js` avec un type JavaScript. Ne pas publier `node_modules/`.

À chaque modification d’un fichier mis en cache, incrémenter `RELEASE` dans `sw.js`
et conserver la liste `FILES` à jour. Publier une version complète et cohérente.
La copie est mise en cache en une seule opération ; si un fichier manque, l’installation
échoue et la version précédente reste active. Le cache ne contient pas les tuiles
ni les styles distants. Son nom inclut le chemin de l’application pour éviter de
supprimer les caches d’une autre installation sur le même domaine.

Pour actualiser MapLibre, mettre à jour la version npm, copier les fichiers de
production et la licence depuis `node_modules/maplibre-gl/` vers `vendor/maplibre-gl/`,
puis incrémenter la version du cache et exécuter les tests.
