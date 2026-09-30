import { startWatching } from './gps.js';
import { initializeMap } from './map.js';
import {
  addTrackPoint,
  clearTrack,
  getCurrentTrack,
  isTracking,
  restoreTrack,
  startTracking,
  stopTracking
} from './track.js';
import {
  deleteTrack,
  deleteRoute,
  deleteWaypoint,
  loadLatestTrack,
  loadRoutes,
  loadTracks,
  loadWaypoints,
  saveTrack,
  saveRoute,
  saveGpxData,
  saveWaypoint
} from './storage.js';
import {
  createWaypoint,
  getWaypoints,
  removeWaypoint,
  setWaypoints
} from './waypoint.js';
import {
  addRoutePoint,
  cancelActiveRoute,
  getActiveRoute,
  getRoutes,
  removeRoute,
  saveActiveRoute,
  setRoutes,
  startRoute,
  toggleRouteVisibility,
  undoRoutePoint
} from './route.js';
import { createGpx, parseGpx } from './gpx.js';

const getElement = id => document.getElementById(id);
const map = initializeMap('map');
let firstFix = true;
const MIN_COG_SPEED = 0.5;
let trackStorageAvailable = true;
let trackStorageInitialized = false;
let waypointStorageAvailable = true;
let waypointStorageInitialized = false;
let latestPosition = null;
let waypointPendingDeletion = null;
let routeStorageAvailable = true;
let routeStorageInitialized = false;
let routePendingDeletion = null;
let gpxExportData = { waypoints: [], routes: [], tracks: [] };

function setTrackStatus(message) {
  getElement('track-status').textContent = message;
}

function updateTrackControls() {
  getElement('track-start').disabled = !trackStorageInitialized || isTracking();
  getElement('track-stop').disabled = !isTracking();
  getElement('track-clear').disabled = !getCurrentTrack();
}

function persistTrack(track) {
  if (!trackStorageAvailable || !track) return;

  saveTrack(track).catch(() => {
    trackStorageAvailable = false;
    setTrackStatus('Sauvegarde locale indisponible ; trace gardée en mémoire');
  });
}

function updateWaypointControls() {
  getElement('add-waypoint').disabled = !waypointStorageInitialized || !latestPosition;
}

function renderWaypoints() {
  const waypoints = getWaypoints();
  const list = getElement('waypoint-list');
  list.replaceChildren();
  getElement('waypoint-count').textContent = String(waypoints.length);
  getElement('waypoint-empty').hidden = waypoints.length > 0;
  map.updateWaypoints(waypoints);

  waypoints.forEach((waypoint, index) => {
    const row = document.createElement('li');
    row.className = 'waypoint-row';

    const info = document.createElement('div');
    info.className = 'waypoint-info';
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${waypoint.name}`;
    const coordinates = document.createElement('span');
    coordinates.textContent =
      `${waypoint.latitude.toFixed(5)}°, ${waypoint.longitude.toFixed(5)}°`;
    info.append(name, coordinates);

    const controls = document.createElement('div');
    controls.className = 'waypoint-controls';
    const centerButton = document.createElement('button');
    centerButton.type = 'button';
    centerButton.textContent = 'Centrer';
    centerButton.addEventListener('click', () => {
      map.centerOnWaypoint(waypoint);
      closeWaypointSheet();
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-waypoint';
    deleteButton.textContent = 'Supprimer';
    deleteButton.addEventListener('click', () => {
      waypointPendingDeletion = waypoint.id;
      getElement('delete-waypoint-name').textContent = waypoint.name;
      getElement('delete-dialog').showModal();
    });

    controls.append(centerButton, deleteButton);
    row.append(info, controls);
    list.append(row);
  });
}

function closeWaypointSheet() {
  getElement('waypoint-sheet').hidden = true;
  getElement('toggle-waypoints').setAttribute('aria-expanded', 'false');
}

function closeRouteSheet() {
  getElement('route-sheet').hidden = true;
  getElement('toggle-routes').setAttribute('aria-expanded', 'false');
}

function updateRouteEditor() {
  const route = getActiveRoute();
  if (!route) return;

  const pointCount = route.points.length;
  getElement('route-editor-status').textContent =
    `Touchez la carte pour ajouter les points · ${pointCount} point${pointCount === 1 ? '' : 's'}`;
  getElement('undo-route-point').disabled = pointCount === 0;
  getElement('save-route').disabled = pointCount < 2;
}

function updateRouteControls() {
  getElement('start-route').disabled = !routeStorageInitialized || Boolean(getActiveRoute());
}

function renderRoutes() {
  const routes = getRoutes();
  const list = getElement('route-list');
  list.replaceChildren();
  getElement('route-count').textContent = String(routes.length);
  getElement('route-empty').hidden = routes.length > 0;
  map.updateRoutes(routes, getActiveRoute());

  routes.forEach(route => {
    const row = document.createElement('li');
    row.className = 'waypoint-row';

    const info = document.createElement('div');
    info.className = 'waypoint-info';
    const titleLine = document.createElement('div');
    titleLine.className = 'route-title';
    const color = document.createElement('span');
    color.className = 'route-color';
    color.style.backgroundColor = route.color;
    color.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = route.name;
    titleLine.append(color, name);
    const pointCount = document.createElement('span');
    pointCount.textContent = `${route.points.length} points`;
    info.append(titleLine, pointCount);

    const controls = document.createElement('div');
    controls.className = 'waypoint-controls';
    const centerButton = document.createElement('button');
    centerButton.type = 'button';
    centerButton.textContent = route.visible ? 'Masquer' : 'Afficher';
    centerButton.setAttribute('aria-pressed', String(route.visible));
    centerButton.addEventListener('click', async () => {
      const updatedRoute = toggleRouteVisibility(route.id);
      if (!updatedRoute) return;

      renderRoutes();
      if (updatedRoute.visible) {
        map.centerOnRoute(updatedRoute);
        closeRouteSheet();
      }

      if (routeStorageAvailable) {
        try {
          await saveRoute(updatedRoute);
        } catch {
          routeStorageAvailable = false;
          getElement('route-notice').textContent =
            'Visibilité modifiée en session ; sauvegarde locale indisponible';
        }
      }
    });

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-waypoint';
    deleteButton.textContent = 'Supprimer';
    deleteButton.addEventListener('click', () => {
      routePendingDeletion = route.id;
      getElement('delete-route-name').textContent = route.name;
      getElement('delete-route-dialog').showModal();
    });

    controls.append(centerButton, deleteButton);
    row.append(info, controls);
    list.append(row);
  });
}

function leaveRouteCreationMode() {
  map.setRouteCreationMode(false);
  getElement('route-editor').hidden = true;
  getElement('map-actions').hidden = false;
  updateRouteControls();
}

function setGpxStatus(message) {
  getElement('gpx-status').textContent = message;
}

async function importGpxFile(file) {
  if (isTracking()) {
    setGpxStatus('Arrêtez l’enregistrement de trace avant l’import.');
    return;
  }

  const importButton = getElement('import-gpx');
  importButton.disabled = true;

  try {
    const importedData = parseGpx(await file.text());
    const totalItems =
      importedData.waypoints.length + importedData.routes.length + importedData.tracks.length;
    if (totalItems === 0) throw new Error('Ce fichier GPX ne contient aucun élément exploitable.');

    const previousWaypoints = getWaypoints();
    const previousRoutes = getRoutes();
    const updatedWaypoints = [...previousWaypoints, ...importedData.waypoints];
    const updatedRoutes = setRoutes([...previousRoutes, ...importedData.routes]);
    const addedRoutes = updatedRoutes.slice(previousRoutes.length);

    try {
      await saveGpxData({
        waypoints: importedData.waypoints,
        routes: addedRoutes,
        tracks: importedData.tracks
      });
    } catch (error) {
      setWaypoints(previousWaypoints);
      setRoutes(previousRoutes);
      throw error;
    }

    setWaypoints(updatedWaypoints);
    renderWaypoints();
    setRoutes(updatedRoutes);
    renderRoutes();

    if (importedData.tracks.length > 0) {
      const latestImportedTrack = importedData.tracks.at(-1);
      const restoredTrack = restoreTrack(latestImportedTrack);
      map.updateTrack(restoredTrack);
      setTrackStatus(`Trace importée · ${restoredTrack.points.length} points`);
      updateTrackControls();
    }

    await refreshExportSelection();
    const summary = [
      `${importedData.waypoints.length} waypoint(s)`,
      `${importedData.routes.length} route(s)`,
      `${importedData.tracks.length} trace(s)`
    ].join(' · ');
    setGpxStatus(`Import terminé : ${summary}.`);
  } catch (error) {
    setGpxStatus(error.message || 'Impossible d’importer ce fichier GPX.');
  } finally {
    importButton.disabled = false;
    getElement('gpx-file').value = '';
  }
}

async function exportGpxFile() {
  const exportButton = getElement('export-gpx');
  exportButton.disabled = true;

  try {
    const selected = kind => new Set(
      Array.from(document.querySelectorAll(`[data-export-kind="${kind}"]:checked`))
        .map(input => input.dataset.exportId)
    );
    const selectedWaypoints = selected('waypoints');
    const selectedRoutes = selected('routes');
    const selectedTracks = selected('tracks');
    const waypoints = gpxExportData.waypoints.filter(item => selectedWaypoints.has(item.id));
    const routes = gpxExportData.routes.filter(item => selectedRoutes.has(item.id));
    const tracks = gpxExportData.tracks.filter(item => selectedTracks.has(item.id));
    const totalSelected = waypoints.length + routes.length + tracks.length;
    if (totalSelected === 0) return;

    const xml = createGpx({ waypoints, routes, tracks });
    const blob = new Blob([xml], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.href = url;
    link.download = `marine-gps-selection-${timestamp}.gpx`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setGpxStatus(
      `Export prêt : ${waypoints.length} waypoint(s), ${routes.length} route(s), ${tracks.length} trace(s).`
    );
  } catch {
    setGpxStatus('Impossible de lire les données pour l’export GPX.');
  } finally {
    exportButton.disabled = false;
  }
}

function updateExportSelectionState() {
  const kinds = ['waypoints', 'routes', 'tracks'];
  let total = 0;
  let selected = 0;

  kinds.forEach(kind => {
    const items = Array.from(document.querySelectorAll(`[data-export-kind="${kind}"]`));
    const category = document.querySelector(`[data-export-category="${kind}"]`);
    const selectedCount = items.filter(item => item.checked).length;
    total += items.length;
    selected += selectedCount;
    category.disabled = items.length === 0;
    category.checked = items.length > 0 && selectedCount === items.length;
    category.indeterminate = selectedCount > 0 && selectedCount < items.length;
  });

  getElement('export-gpx').disabled = selected === 0;
  getElement('select-all-export').disabled = total === 0 || selected === total;
  getElement('clear-all-export').disabled = selected === 0;
}

function renderExportCategory(kind, items, labelForItem, emptyMessage) {
  const container = getElement(`export-${kind}`);
  container.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'export-empty';
    empty.textContent = emptyMessage;
    container.append(empty);
    return;
  }

  items.forEach(item => {
    const label = document.createElement('label');
    label.className = 'export-item';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.dataset.exportKind = kind;
    checkbox.dataset.exportId = item.id;
    const text = document.createElement('span');
    text.textContent = labelForItem(item);
    label.append(checkbox, text);
    container.append(label);
  });
}

async function refreshExportSelection() {
  getElement('export-gpx').disabled = true;
  setGpxStatus('Chargement des éléments…');

  try {
    const [waypoints, routes, tracks] = await Promise.all([
      loadWaypoints(),
      loadRoutes(),
      loadTracks()
    ]);
    gpxExportData = { waypoints, routes, tracks };

    renderExportCategory(
      'waypoints',
      waypoints,
      waypoint => `${waypoint.name} · ${waypoint.latitude.toFixed(4)}°, ${waypoint.longitude.toFixed(4)}°`,
      'Aucun waypoint'
    );
    renderExportCategory(
      'routes',
      routes,
      route => `${route.name} · ${route.points.length} points`,
      'Aucune route'
    );
    renderExportCategory(
      'tracks',
      tracks,
      track => `${track.name || 'Trace'} · ${track.points.length} points · ${new Date(track.startedAt).toLocaleDateString('fr-FR')}`,
      'Aucune trace'
    );
    setGpxStatus('');
    updateExportSelectionState();
  } catch {
    setGpxStatus('Impossible de lire les données locales.');
  }
}

function setAllExportSelections(checked) {
  document.querySelectorAll('[data-export-kind]').forEach(input => {
    input.checked = checked;
  });
  updateExportSelectionState();
}

function beginRouteCreation() {
  if (!routeStorageInitialized || getActiveRoute()) return;

  closeWaypointSheet();
  closeRouteSheet();
  startRoute(`Route ${getRoutes().length + 1}`);
  map.setRouteCreationMode(true);
  getElement('map-actions').hidden = true;
  getElement('route-editor').hidden = false;
  updateRouteEditor();
  renderRoutes();
}

function updateInterface(position) {
  latestPosition = position;
  updateWaypointControls();
  getElement('lat').textContent = position.latitude.toFixed(6) + '°';
  getElement('lon').textContent = position.longitude.toFixed(6) + '°';
  getElement('accuracy').textContent = position.accuracy
    ? Math.round(position.accuracy) + ' m'
    : '—';
  getElement('speed').textContent = Number.isFinite(position.speed)
    ? (position.speed * 1.943844).toFixed(1) + ' nd'
    : '—';
  const hasReliableCourse =
    Number.isFinite(position.course) && position.speed >= MIN_COG_SPEED;
  getElement('course').textContent = hasReliableCourse
    ? String(Math.round(position.course) % 360).padStart(3, '0') + '°'
    : '—';

  map.updateBoatPosition(position, hasReliableCourse ? position.course : null);
  getElement('status').textContent = 'GPS : position reçue';

  if (isTracking()) {
    const track = addTrackPoint(position);
    map.updateTrack(track);
    persistTrack(track);
    setTrackStatus(`Enregistrement en cours · ${track.points.length} points`);
  }

  if (firstFix) {
    map.centerOnBoat(15);
    firstFix = false;
  }
}

function showGpsError(error) {
  const messages = {
    0: 'Ce navigateur ne fournit pas de géolocalisation.',
    1: 'GPS : autorisation refusée.',
    2: 'GPS : position indisponible.',
    3: 'GPS : délai dépassé.'
  };

  getElement('status').textContent = messages[error.code] || 'GPS : erreur inconnue.';
}

getElement('locate').addEventListener('click', () => map.centerOnBoat());

getElement('track-start').addEventListener('click', () => {
  const track = startTracking();
  map.updateTrack(track);
  persistTrack(track);
  setTrackStatus('Enregistrement en cours · 0 points');
  updateTrackControls();
});

getElement('track-stop').addEventListener('click', () => {
  const track = stopTracking();
  if (!track) return;

  persistTrack(track);
  setTrackStatus(`Trace arrêtée · ${track.points.length} points`);
  updateTrackControls();
});

getElement('track-clear').addEventListener('click', async () => {
  const track = clearTrack();
  if (!track) return;

  map.updateTrack({ points: [] });
  updateTrackControls();
  setTrackStatus('Effacement de la trace…');
  if (trackStorageAvailable) {
    try {
      await deleteTrack(track.id);
    } catch {
      trackStorageAvailable = false;
      setTrackStatus('Trace effacée de la session ; suppression locale impossible');
    }
  }

  if (trackStorageAvailable) setTrackStatus('Trace effacée');
  updateTrackControls();
});

getElement('add-waypoint').addEventListener('click', () => {
  if (!latestPosition) return;

  const nextNumber = getWaypoints().length + 1;
  getElement('waypoint-position').textContent =
    `${latestPosition.latitude.toFixed(6)}°, ${latestPosition.longitude.toFixed(6)}°`;
  getElement('waypoint-name').value = `Waypoint ${nextNumber}`;
  getElement('waypoint-dialog').showModal();
  getElement('waypoint-name').select();
});

getElement('cancel-waypoint').addEventListener('click', () => {
  getElement('waypoint-dialog').close();
});

getElement('waypoint-form').addEventListener('submit', async event => {
  event.preventDefault();
  const name = getElement('waypoint-name').value.trim();
  if (!name || !latestPosition) return;

  const saveButton = event.currentTarget.querySelector('[type="submit"]');
  saveButton.disabled = true;
  const waypoint = createWaypoint(latestPosition, name);

  if (waypointStorageAvailable) {
    try {
      await saveWaypoint(waypoint);
      getElement('waypoint-notice').textContent = 'Waypoint enregistré';
    } catch {
      waypointStorageAvailable = false;
      getElement('waypoint-notice').textContent =
        'Sauvegarde locale indisponible ; waypoint gardé en session';
    }
  }

  renderWaypoints();
  getElement('waypoint-dialog').close();
  getElement('waypoint-form').reset();
  saveButton.disabled = false;
});

getElement('delete-dialog').addEventListener('close', async event => {
  if (event.currentTarget.returnValue !== 'delete' || !waypointPendingDeletion) return;

  const waypointId = waypointPendingDeletion;
  waypointPendingDeletion = null;
  removeWaypoint(waypointId);
  renderWaypoints();

  if (waypointStorageAvailable) {
    try {
      await deleteWaypoint(waypointId);
      getElement('waypoint-notice').textContent = 'Waypoint supprimé';
    } catch {
      waypointStorageAvailable = false;
      getElement('waypoint-notice').textContent =
        'Waypoint supprimé de la session ; suppression locale impossible';
    }
  }
});

getElement('toggle-waypoints').addEventListener('click', event => {
  const sheet = getElement('waypoint-sheet');
  sheet.hidden = !sheet.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!sheet.hidden));
});

getElement('close-waypoints').addEventListener('click', closeWaypointSheet);

map.onMapClick(position => {
  if (!getActiveRoute()) return;

  addRoutePoint(position);
  updateRouteEditor();
  renderRoutes();
});

getElement('start-route').addEventListener('click', beginRouteCreation);

getElement('undo-route-point').addEventListener('click', () => {
  if (!getActiveRoute()) return;
  undoRoutePoint();
  updateRouteEditor();
  renderRoutes();
});

getElement('cancel-route').addEventListener('click', () => {
  cancelActiveRoute();
  renderRoutes();
  leaveRouteCreationMode();
});

getElement('save-route').addEventListener('click', () => {
  const route = getActiveRoute();
  if (!route || route.points.length < 2) return;

  getElement('route-name').value = route.name;
  getElement('route-name-dialog').showModal();
  getElement('route-name').select();
});

getElement('cancel-route-save').addEventListener('click', () => {
  getElement('route-name-dialog').close();
});

getElement('route-name-form').addEventListener('submit', async event => {
  event.preventDefault();
  const routeName = getElement('route-name').value.trim();
  if (!routeName) return;

  const route = saveActiveRoute(routeName);
  if (!route) return;

  const saveButton = event.currentTarget.querySelector('[type="submit"]');
  saveButton.disabled = true;
  renderRoutes();
  leaveRouteCreationMode();

  if (routeStorageAvailable) {
    try {
      await saveRoute(route);
      getElement('route-notice').textContent = 'Route enregistrée';
    } catch {
      routeStorageAvailable = false;
      getElement('route-notice').textContent =
        'Sauvegarde locale indisponible ; route gardée en session';
    }
  }

  getElement('route-name-dialog').close();
  getElement('route-name-form').reset();
  saveButton.disabled = false;
});

getElement('toggle-routes').addEventListener('click', event => {
  closeWaypointSheet();
  const sheet = getElement('route-sheet');
  sheet.hidden = !sheet.hidden;
  event.currentTarget.setAttribute('aria-expanded', String(!sheet.hidden));
});

getElement('close-routes').addEventListener('click', closeRouteSheet);

getElement('open-gpx').addEventListener('click', () => {
  setGpxStatus(isTracking()
    ? 'Arrêtez l’enregistrement de trace avant l’import GPX.'
    : '');
  getElement('gpx-dialog').showModal();
  refreshExportSelection();
});

getElement('close-gpx').addEventListener('click', () => {
  getElement('gpx-dialog').close();
});

getElement('import-gpx').addEventListener('click', () => {
  if (isTracking()) {
    setGpxStatus('Arrêtez l’enregistrement de trace avant l’import.');
    return;
  }

  getElement('gpx-file').click();
});

getElement('gpx-file').addEventListener('change', event => {
  const file = event.currentTarget.files[0];
  if (file) importGpxFile(file);
});

getElement('export-gpx').addEventListener('click', exportGpxFile);

getElement('select-all-export').addEventListener('click', () => setAllExportSelections(true));
getElement('clear-all-export').addEventListener('click', () => setAllExportSelections(false));
getElement('gpx-dialog').addEventListener('change', event => {
  const category = event.target.dataset.exportCategory;
  if (category) {
    document.querySelectorAll(`[data-export-kind="${category}"]`).forEach(input => {
      input.checked = event.target.checked;
    });
  }

  updateExportSelectionState();
});

getElement('delete-route-dialog').addEventListener('close', async event => {
  if (event.currentTarget.returnValue !== 'delete' || !routePendingDeletion) return;

  const routeId = routePendingDeletion;
  routePendingDeletion = null;
  removeRoute(routeId);
  renderRoutes();

  if (routeStorageAvailable) {
    try {
      await deleteRoute(routeId);
      getElement('route-notice').textContent = 'Route supprimée';
    } catch {
      routeStorageAvailable = false;
      getElement('route-notice').textContent =
        'Route supprimée de la session ; suppression locale impossible';
    }
  }
});

async function initializeTrack() {
  try {
    const savedTrack = await loadLatestTrack();
    if (savedTrack) {
      const track = restoreTrack(savedTrack);
      map.updateTrack(track);
      setTrackStatus(`Dernière trace chargée · ${track.points.length} points`);
    }
  } catch {
    trackStorageAvailable = false;
    setTrackStatus('Stockage local indisponible ; trace disponible en session');
  }

  trackStorageInitialized = true;
  updateTrackControls();
}

async function initializeWaypoints() {
  try {
    setWaypoints(await loadWaypoints());
  } catch {
    waypointStorageAvailable = false;
    getElement('waypoint-notice').textContent =
      'Stockage local indisponible ; waypoints gardés en session';
  }

  renderWaypoints();
  waypointStorageInitialized = true;
  updateWaypointControls();
}

async function initializeRoutes() {
  try {
    setRoutes(await loadRoutes());
  } catch {
    routeStorageAvailable = false;
    getElement('route-notice').textContent =
      'Stockage local indisponible ; routes gardées en session';
  }

  renderRoutes();
  routeStorageInitialized = true;
  updateRouteControls();
}

updateTrackControls();
updateWaypointControls();
updateRouteControls();
initializeTrack();
initializeWaypoints();
initializeRoutes();
startWatching(updateInterface, showGpsError);