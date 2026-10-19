import { initializeHome } from './home.js';
import { initializeDeparture } from './departure.js';
import { initializeWeather } from './weather.js';
import { initializeDisplay } from './display.js';
import { updateDeviation, createSimulator } from './navigation-tools.mjs';
import { initializePwa } from './pwa.js';
import { initializeOfflineMaps } from './offline-maps-ui.js';
import { startWatching, stopWatching, isFreshPosition, isUsablePosition } from './gps.js';
import { computeRouteNavigation, advanceNavigation } from './navigation.mjs';
import { initializeMap } from './map.js?v=1.9.0';
import {
  addTrackPoint,
  interruptTracking,
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
  getWaypointType,
  getWaypoints,
  removeWaypoint,
  setWaypoints,
  WAYPOINT_TYPES
} from './waypoint.js?v=1.0.0';
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
const display = initializeDisplay();
const map = initializeMap('map');
let firstFix = true;
const MIN_COG_SPEED = 0.5;
let activeNavigationRouteId = null;
let navigationState = { targetIndex: 0, completed: false };
let gpsError = '';
let simulation = null;
let gpsSession = 0;
let deviation = { active: false };
const thresholdKey = `marine-gps-xte:${new URL('../', import.meta.url).pathname}`;
let deviationThreshold = 100;
try {
  const saved = Number(localStorage.getItem(thresholdKey));
  if ([50, 100, 200, 500].includes(saved)) deviationThreshold = saved;
} catch { /* Session settings still work without storage. */ }

let trackBusy = false;
let trackSaveQueue = Promise.resolve(true);
let trackSaveTimer = null;
let lastTrackSave = 0;
let lastTrackRender = 0;
const sessionTracks = new Map();
const deletedTracks = new Set();
let bottomSheetOpen = false;
let sheetTouchStartY = null;
let trackStorageAvailable = true;
let trackStorageInitialized = false;
let waypointStorageAvailable = true;
let waypointStorageInitialized = false;
let pendingWaypoint = null;
let removeWaypointMapClickListener = null;
let generatedWaypointName = '';
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
  const track = getCurrentTrack();
  const recording = isTracking();
  const recordButton = getElement('track-record');
  const saveButton = getElement('track-save');
  const clearButton = getElement('track-clear');
  const finalizeActions = getElement('track-finalize-actions');

  recordButton.disabled = !trackStorageInitialized || trackBusy || Boolean(simulation);
  recordButton.classList.toggle('is-recording', recording);
  recordButton.classList.toggle('is-paused', Boolean(track) && !recording);
  recordButton.setAttribute(
    'aria-label',
    recording ? 'Mettre en pause l’enregistrement' : track ? 'Reprendre l’enregistrement' : 'Démarrer l’enregistrement'
  );
  recordButton.title = recordButton.getAttribute('aria-label');
  finalizeActions.hidden = !track || recording;
  saveButton.hidden = !track || recording;
  saveButton.disabled = !track || track.points.length === 0 || trackBusy;
  getElement('track-to-route').disabled = !track || track.points.length < 2 ||
    Boolean(getActiveRoute()) || trackBusy || !routeStorageInitialized;
  clearButton.hidden = !track || recording;
  clearButton.disabled = !track || trackBusy;
}

function persistTrack(track, immediate = true) {
  if (!track) return Promise.resolve(false);
  if (!immediate && Date.now() - lastTrackSave < 5000) {
    if (trackSaveTimer === null) trackSaveTimer = setTimeout(() => {
      trackSaveTimer = null;
      if (!trackBusy) void persistTrack(getCurrentTrack());
    }, Math.max(0, 5000 - (Date.now() - lastTrackSave)));
    return trackSaveQueue;
  }
  clearTimeout(trackSaveTimer);
  trackSaveTimer = null;
  lastTrackSave = Date.now();
  const snapshot = { ...track, points: [...track.points] };
  trackSaveQueue = trackSaveQueue.then(async () => {
    try {
      await saveTrack(snapshot);
      trackStorageAvailable = true;
      return true;
    } catch {
      trackStorageAvailable = false;
      setTrackStatus('Sauvegarde indisponible : exportez le GPX avant de fermer.');
      return false;
    }
  });
  return trackSaveQueue;
}

function updateWaypointControls() {
  getElement('add-waypoint').disabled = !waypointStorageInitialized || Boolean(getActiveRoute());
}

function renderWaypoints() {
  const waypoints = getWaypoints();
  const list = getElement('waypoint-list');
  list.replaceChildren();
  getElement('waypoint-count').textContent = String(waypoints.length);
  getElement('menu-waypoint-count').textContent = String(waypoints.length);
  getElement('waypoint-empty').hidden = waypoints.length > 0;
  map.updateWaypoints(waypoints);

  waypoints.forEach((waypoint, index) => {
    const type = getWaypointType(waypoint.type);
    const row = document.createElement('li');
    row.className = 'waypoint-row';

    const info = document.createElement('div');
    info.className = 'waypoint-info';
    const name = document.createElement('strong');
    name.textContent = `${index + 1}. ${waypoint.name}`;
    const coordinates = document.createElement('span');
    coordinates.textContent =
      `${type.label} · ${waypoint.latitude.toFixed(5)}°, ${waypoint.longitude.toFixed(5)}°`;
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

function defaultWaypointName(type) {
  const count = getWaypoints().filter(waypoint => waypoint.type === type.id).length + 1;
  return `${type.label} ${count}`;
}

function stopWaypointPlacement() {
  removeWaypointMapClickListener?.();
  removeWaypointMapClickListener = null;
  pendingWaypoint = null;
  map.setWaypointPlacementMode(false);
  getElement('waypoint-placement').hidden = true;
}

function beginWaypointPlacement(waypoint) {
  pendingWaypoint = waypoint;
  closeWaypointSheet();
  getElement('waypoint-dialog').close();
  getElement('waypoint-placement-status').textContent =
    `Touchez la carte pour placer ${waypoint.name}`;
  getElement('waypoint-placement').hidden = false;
  map.setWaypointPlacementMode(true);

  removeWaypointMapClickListener = map.onMapClick(async position => {
    const placement = pendingWaypoint;
    if (!placement) return;

    stopWaypointPlacement();
    const savedWaypoint = createWaypoint(position, placement.name, placement.type);
    let message = `${getWaypointType(savedWaypoint.type).label} enregistré`;
    if (waypointStorageAvailable) {
      try {
        await saveWaypoint(savedWaypoint);
      } catch {
        waypointStorageAvailable = false;
        message = 'Repère conservé en session ; sauvegarde locale indisponible';
      }
    }

    renderWaypoints();
    getElement('waypoint-notice').textContent = message;
    updateWaypointControls();
  });
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

function setBottomSheetState(open) {
  bottomSheetOpen = open;
  const bottomSheet = getElement('bottom-sheet');
  bottomSheet.classList.toggle('expanded', open);
  bottomSheet.classList.toggle('collapsed', !open);
  document.body.classList.toggle('sheet-expanded', open);
  bottomSheet.setAttribute('aria-expanded', String(open));
  getElement('sheet-toggle').setAttribute('aria-expanded', String(open));
  getElement('sheet-toggle').setAttribute('aria-label', open ? 'Réduire le menu de navigation' : 'Ouvrir le menu de navigation');
}

function renderNavigation() {
  const route = activeNavigationRouteId
    ? getRoutes().find(item => item.id === activeNavigationRouteId)
    : null;
  display.setNavigating(Boolean(route && !navigationState.completed && !simulation));
  getElement('bottom-sheet').classList.toggle('following-route', Boolean(route));
  document.body.classList.toggle('sheet-following-route', Boolean(route));
  getElement('navigation-route-name').hidden = !route;
  getElement('navigation-instruments').hidden = !route;
  getElement('navigation-controls').hidden = !route;
  getElement('navigation-previous').disabled = navigationState.targetIndex === 0;
  getElement('navigation-next').disabled = !route || navigationState.targetIndex >= route.points.length - 1;
  getElement('navigation-previous').disabled ||= Boolean(simulation);
  getElement('navigation-next').disabled ||= Boolean(simulation);
  map.updateNavigation(route, navigationState.targetIndex);
  setNavigationTitle(route);

  const setValue = (id, value) => {
    const element = getElement(id);
    if (element) element.textContent = value;
  };

  renderDeviation(route);
  if (!route || !isUsablePosition(latestPosition) || gpsError || navigationState.completed) {
    setValue('xte', '—');
    setValue('dtw', '—');
    setValue('brg', '—');
    setValue('eta', '—');
    return;
  }

  const metrics = computeRouteNavigation(route, latestPosition, latestPosition.speed ?? 0, navigationState.targetIndex);
  setValue('xte', metrics.xteMeters === null ? '—' : `${metrics.xteMeters >= 0 ? '+' : '-'}${Math.round(Math.abs(metrics.xteMeters))} m`);
  setValue('dtw', metrics.distanceToWaypointMeters === null ? '—' : `${Math.round(metrics.distanceToWaypointMeters)} m`);
  setValue('brg', metrics.bearingDegrees === null ? '—' : `${Math.round(metrics.bearingDegrees) % 360}°`);
  setValue('eta', metrics.etaText);
}

function setNavigationTitle(route) {
  getElement('navigation-route-name').textContent = !route ? '' :
    `${route.name} · ${navigationState.completed ? 'Arrivée atteinte' :
      `Point ${navigationState.targetIndex + 1}/${route.points.length}`}`;
}

function renderRoutes() {
  const routes = getRoutes();
  const list = getElement('route-list');
  list.replaceChildren();
  getElement('route-count').textContent = String(routes.length);
  getElement('menu-route-count').textContent = String(routes.length);
  getElement('route-empty').hidden = routes.length > 0;
  map.updateRoutes(routes, getActiveRoute());

  routes.forEach(route => {
    const row = document.createElement('li');
    row.className = activeNavigationRouteId === route.id
      ? 'waypoint-row route-list-row route-row-selected'
      : 'waypoint-row route-list-row';

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
    pointCount.textContent = `${route.points.length} point${route.points.length === 1 ? '' : 's'}`;
    info.append(titleLine, pointCount);

    const controls = document.createElement('div');
    controls.className = 'waypoint-controls route-list-actions';

    const followButton = document.createElement('button');
    followButton.type = 'button';
    followButton.textContent = activeNavigationRouteId === route.id ? 'Arrêter' : 'Suivre';
    followButton.classList.toggle('primary-action', activeNavigationRouteId === route.id);
    followButton.addEventListener('click', () => {
      if (simulation) stopSimulation();
      activeNavigationRouteId = activeNavigationRouteId === route.id ? null : route.id;
      navigationState = { targetIndex: 0, completed: false };
      if (activeNavigationRouteId) {
        route.visible = true;
        map.centerOnRoute(route);
      }
      renderRoutes();
      renderNavigation();
      renderWaypoints();
    });

    const centerButton = document.createElement('button');
    centerButton.type = 'button';
    centerButton.textContent = route.visible ? 'Masquer' : 'Afficher';
    centerButton.setAttribute('aria-pressed', String(route.visible));
    centerButton.addEventListener('click', async () => {
      if (route.id === activeNavigationRouteId) {
        getElement('route-notice').textContent = 'Arrêtez le suivi avant de masquer cette route.';
        return;
      }
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

    controls.append(followButton, centerButton, deleteButton);
    row.append(info, controls);
    list.append(row);
  });

  renderNavigation();
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
  if (getCurrentTrack() || trackBusy) {
    setGpxStatus('Archivez ou supprimez la trace en cours avant l’import.');
    return;
  }

  const importButton = getElement('import-gpx');
  importButton.disabled = true;
  trackBusy = true;
  updateTrackControls();

  try {
    if (file.size > 20 * 1024 * 1024) throw new Error('Fichier trop volumineux (maximum 20 Mo).');
    const importedData = parseGpx(await file.text());
    importedData.tracks.forEach(track => { track.archived = true; });
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

    importedData.tracks.forEach(track => sessionTracks.set(track.id, track));
    if (importedData.tracks.length) {
      map.updateTrack(importedData.tracks.at(-1));
      setTrackStatus('Traces importées dans les sorties.');
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
    trackBusy = false;
    updateTrackControls();
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
    const results = await Promise.allSettled([loadWaypoints(), loadRoutes(), loadTracks()]);
    const merge = (saved, memory) => [...new Map([...saved, ...memory].map(item => [item.id, item])).values()];
    const saved = index => results[index].status === 'fulfilled' ? results[index].value : [];
    const waypoints = waypointStorageInitialized ? getWaypoints() : saved(0);
    const routes = routeStorageInitialized ? getRoutes() : saved(1);
    const current = getCurrentTrack();
    const tracks = merge(saved(2), [...sessionTracks.values(), ...(current ? [current] : [])])
      .filter(track => !deletedTracks.has(track.id));
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
    setGpxStatus(results.some(result => result.status === 'rejected') ?
      'Stockage inaccessible : export des données disponibles en session.' : '');
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
  gpsError = '';
  updateGpsHealth();
  updateWaypointControls();
  getElement('accuracy').textContent = Number.isFinite(position.accuracy)
    ? Math.round(position.accuracy) + ' m'
    : '—';
  getElement('speed-bottom').textContent = Number.isFinite(position.speed)
    ? (position.speed * 1.943844).toFixed(1)
    : '—';
  const hasReliableCourse =
    Number.isFinite(position.course) && position.speed >= MIN_COG_SPEED;
  getElement('course').textContent = hasReliableCourse
    ? String(Math.round(position.course) % 360).padStart(3, '0') + '°'
    : '—';

  map.updateBoatPosition(position, hasReliableCourse ? position.course : null);
  const route = getRoutes().find(item => item.id === activeNavigationRouteId);
  if (route && isUsablePosition(position)) {
    navigationState = advanceNavigation(route, position, navigationState);
  }
  updateGpsHealth();
  renderNavigation();

  if (!simulation && isTracking() && isUsablePosition(position)) {
    const track = addTrackPoint(position);
    if (Date.now() - lastTrackRender >= 2000) {
      map.updateTrack(track);
      lastTrackRender = Date.now();
    }
    persistTrack(track, false);
    if (trackStorageAvailable) setTrackStatus(`Enregistrement en cours · ${track.points.length} points`);
  }

  if (firstFix && isUsablePosition(position)) {
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

  gpsError = messages[error.code] || 'GPS : erreur inconnue.';
  updateGpsHealth();
  renderNavigation();
}

function updateGpsHealth() {
  if (simulation) {
    getElement('status').textContent = simulation.done ? 'SIMULATION · parcours terminé' : 'SIMULATION · position fictive';
    document.body.classList.remove('gps-unreliable');
    map.setGpsStale(false);
    return;
  }
  const fresh = isFreshPosition(latestPosition);
  const usable = isUsablePosition(latestPosition) && !gpsError;
  document.body.classList.toggle('gps-unreliable', !usable);
  if (!usable && isTracking()) {
    interruptTracking();
    if (trackStorageAvailable) setTrackStatus('Enregistrement suspendu · attente d’un GPS fiable');
  }
  map.setGpsStale(!usable);
  const age = latestPosition ? Math.max(0, Math.floor((Date.now() - latestPosition.timestamp) / 1000)) : null;
  getElement('status').textContent = (gpsError ? `${gpsError}${age === null ? '' : ` · dernière position il y a ${age} s`}` : '') || (!latestPosition ? 'GPS : attente de position…' :
    !fresh ? `GPS perdu · dernière position il y a ${age} s` :
    !usable ? `GPS imprécis · ± ${Math.round(latestPosition.accuracy)} m` :
    `GPS actif · ± ${Math.round(latestPosition.accuracy)} m · il y a ${age} s`);
  if (!usable) {
    ['speed-bottom', 'course', 'xte', 'dtw', 'brg', 'eta'].forEach(id => { getElement(id).textContent = '—'; });
  }
}

setInterval(() => { updateGpsHealth(); renderNavigation(); }, 1000);
document.addEventListener('visibilitychange', () => {
  updateGpsHealth();
  if (document.hidden && !trackBusy) persistTrack(getCurrentTrack());
});
window.addEventListener('pagehide', () => { if (!trackBusy) persistTrack(getCurrentTrack()); });

getElement('navigation-previous').addEventListener('click', () => {
  navigationState = { targetIndex: Math.max(0, navigationState.targetIndex - 1), completed: false };
  renderNavigation();
});
getElement('navigation-next').addEventListener('click', () => {
  const route = getRoutes().find(item => item.id === activeNavigationRouteId);
  if (route) navigationState = { targetIndex: Math.min(route.points.length - 1, navigationState.targetIndex + 1), completed: false };
  renderNavigation();
});
getElement('navigation-stop').addEventListener('click', () => {
  if (simulation) stopSimulation();
  activeNavigationRouteId = null;
  renderRoutes();
});

const bottomSheet = getElement('bottom-sheet');
getElement('sheet-toggle').addEventListener('click', () => setBottomSheetState(!bottomSheetOpen));

bottomSheet.addEventListener('pointerdown', event => {
  if (event.target.closest('button') || !event.target.closest('.sheet-toolbar, .bottom-sheet-header')) return;
  sheetTouchStartY = event.clientY;
  bottomSheet.setPointerCapture(event.pointerId);
});

bottomSheet.addEventListener('pointerup', event => {
  if (sheetTouchStartY === null) return;

  const delta = event.clientY - sheetTouchStartY;
  if (delta < -35) setBottomSheetState(true);
  if (delta > 35) setBottomSheetState(false);
  sheetTouchStartY = null;
});

bottomSheet.addEventListener('pointercancel', () => {
  sheetTouchStartY = null;
});

bottomSheet.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp') setBottomSheetState(true);
  if (event.key === 'ArrowDown' || event.key === 'Escape') setBottomSheetState(false);
});

function closeBottomSheet() {
  setBottomSheetState(false);
}

getElement('menu-add-waypoint').addEventListener('click', () => {
  closeBottomSheet();
  getElement('add-waypoint').click();
});

getElement('menu-toggle-waypoints').addEventListener('click', () => {
  closeBottomSheet();
  getElement('toggle-waypoints').click();
});

getElement('menu-start-route').addEventListener('click', () => {
  closeBottomSheet();
  getElement('start-route').click();
});

getElement('menu-toggle-routes').addEventListener('click', () => {
  closeBottomSheet();
  getElement('toggle-routes').click();
});

getElement('locate').addEventListener('click', () => {
  if (!map.centerOnBoat()) getElement('status').textContent = 'GPS : aucune position pour recentrer.';
});

getElement('track-record').addEventListener('click', () => {
  if (trackBusy) return;
  const track = isTracking() ? stopTracking() : startTracking();
  if (!track) return;

  map.updateTrack(track);
  persistTrack(track);
  setTrackStatus(isTracking()
    ? `Enregistrement en cours · ${track.points.length} points`
    : `Trace en pause · ${track.points.length} points`);
  updateTrackControls();
});

getElement('track-clear').addEventListener('click', async () => {
  const track = getCurrentTrack();
  if (!track || trackBusy || !window.confirm('Supprimer définitivement cette trace ?')) return;
  trackBusy = true;
  updateTrackControls();
  await trackSaveQueue;
  try {
    await deleteTrack(track.id);
    deletedTracks.add(track.id);
    sessionTracks.delete(track.id);
    clearTrack();
    map.updateTrack({ points: [] });
    setTrackStatus('Trace supprimée');
  } catch {
    setTrackStatus('Suppression impossible : trace conservée.');
  } finally {
    trackBusy = false;
    updateTrackControls();
  }
});

getElement('track-save').addEventListener('click', async () => {
  const track = getCurrentTrack();
  if (!track || isTracking() || trackBusy || !track.points.length) return;
  trackBusy = true;
  updateTrackControls();
  const archived = { ...track, archived: true,
    name: track.name || `Sortie du ${new Date(track.startedAt).toLocaleString('fr-FR')}` };
  if (await persistTrack(archived)) {
    sessionTracks.set(archived.id, archived);
    clearTrack();
    setTrackStatus('Sortie archivée · disponible dans Sorties et GPX');
  }
  trackBusy = false;
  updateTrackControls();
});

async function convertTrackToRoute(track) {
  if (!track || track.points.length < 2 || getActiveRoute() || trackBusy) return;
  if (new Set(track.points.map(point => point.segment ?? 0)).size > 1) {
    setTrackStatus('Cette trace contient des interruptions : créez une route manuellement pour éviter de les relier.');
    return;
  }
  trackBusy = true;
  updateTrackControls();
  const name = track.name || `Trace du ${new Date(track.startedAt).toLocaleDateString('fr-FR')}`;
  startRoute(name);
  track.points.forEach(point => addRoutePoint(point));
  const route = saveActiveRoute(name);
  try {
    await saveRoute(route);
    renderRoutes();
    setTrackStatus('Route créée · trace originale conservée');
  } catch {
    removeRoute(route.id);
    setTrackStatus('Route non sauvegardée · trace originale conservée');
  } finally {
    trackBusy = false;
    updateTrackControls();
  }
}
getElement('track-to-route').addEventListener('click', () => convertTrackToRoute(getCurrentTrack()));

async function renderTrackLibrary() {
  const list = getElement('track-list');
  list.replaceChildren();
  try {
    (await loadTracks()).forEach(track => sessionTracks.set(track.id, track));
    getElement('track-library-notice').textContent = 'Les traces originales restent conservées après conversion en route.';
  } catch {
    getElement('track-library-notice').textContent = 'Stockage inaccessible : sorties disponibles en session uniquement.';
  }
  const tracks = [...sessionTracks.values()].filter(track => track.id !== getCurrentTrack()?.id && !deletedTracks.has(track.id));
  getElement('track-empty').hidden = tracks.length > 0;
  for (const track of tracks) {
    const row = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = `${track.name || 'Trace'} · ${track.points.length} points · ${new Date(track.startedAt).toLocaleDateString('fr-FR')}`;
    const controls = document.createElement('div');
    controls.className = 'library-actions';
    const action = (label, handler) => {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label; button.addEventListener('click', handler);
      controls.append(button);
    };
    action('Afficher', () => {
      if (isTracking()) { getElement('track-library-notice').textContent = 'Mettez l’enregistrement en pause pour afficher une autre trace.'; return; }
      map.updateTrack(track); map.centerOnRoute(track); getElement('track-library').close();
    });
    action('Créer une route', async () => {
      await convertTrackToRoute(track);
      getElement('track-library-notice').textContent = getElement('track-status').textContent;
    });
    action('Supprimer', async () => {
      if (!window.confirm('Supprimer définitivement cette sortie ?')) return;
      try {
        await deleteTrack(track.id); sessionTracks.delete(track.id); deletedTracks.add(track.id);
        map.updateTrack(getCurrentTrack() || { points: [] });
        await renderTrackLibrary();
      } catch { getElement('track-library-notice').textContent = 'Suppression impossible : sortie conservée.'; }
    });
    row.append(title, controls); list.append(row);
  }
}
getElement('menu-tracks').addEventListener('click', () => {
  getElement('track-library').showModal(); renderTrackLibrary();
});
getElement('close-track-library').addEventListener('click', () => getElement('track-library').close());

getElement('add-waypoint').addEventListener('click', () => {
  if (!waypointStorageInitialized || getActiveRoute()) return;

  const type = getWaypointType(getElement('waypoint-type').value);
  generatedWaypointName = defaultWaypointName(type);
  getElement('waypoint-position').textContent =
    'Choisissez un type et un nom, puis placez-le sur la carte.';
  getElement('waypoint-name').value = generatedWaypointName;
  getElement('waypoint-dialog').showModal();
  getElement('waypoint-name').select();
});

getElement('cancel-waypoint').addEventListener('click', () => {
  getElement('waypoint-dialog').close();
  getElement('waypoint-form').reset();
  generatedWaypointName = '';
});

getElement('waypoint-type').replaceChildren(...WAYPOINT_TYPES.map(type => {
  const option = document.createElement('option');
  option.value = type.id;
  option.textContent = type.label;
  return option;
}));

getElement('waypoint-type').addEventListener('change', event => {
  if (!generatedWaypointName || getElement('waypoint-name').value !== generatedWaypointName) return;
  const type = getWaypointType(event.currentTarget.value);
  generatedWaypointName = defaultWaypointName(type);
  getElement('waypoint-name').value = generatedWaypointName;
});

getElement('waypoint-name').addEventListener('input', () => {
  if (getElement('waypoint-name').value !== generatedWaypointName) generatedWaypointName = '';
});

getElement('waypoint-form').addEventListener('submit', event => {
  event.preventDefault();
  const type = getWaypointType(getElement('waypoint-type').value);
  const name = getElement('waypoint-name').value.trim() || defaultWaypointName(type);
  beginWaypointPlacement({ name, type: type.id });
  getElement('waypoint-form').reset();
  generatedWaypointName = '';
});

getElement('cancel-waypoint-placement').addEventListener('click', () => {
  stopWaypointPlacement();
  getElement('waypoint-notice').textContent = 'Placement annulé';
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
  setGpxStatus(getCurrentTrack()
    ? 'Archivez ou supprimez la trace en cours avant l’import GPX.'
    : '');
  getElement('gpx-dialog').showModal();
  refreshExportSelection();
});

getElement('close-gpx').addEventListener('click', () => {
  getElement('gpx-dialog').close();
});

getElement('import-gpx').addEventListener('click', () => {
  if (getCurrentTrack() || trackBusy) {
    setGpxStatus('Archivez ou supprimez la trace en cours avant l’import.');
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
  if (simulation && activeNavigationRouteId === routeId) stopSimulation();
  removeRoute(routeId);
  if (activeNavigationRouteId === routeId) activeNavigationRouteId = null;
  renderRoutes();
  renderWaypoints();

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
      setTrackStatus(`Trace restaurée en pause · ${track.points.length} points`);
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
  updateTrackControls();
}

updateTrackControls();
updateWaypointControls();
updateRouteControls();
initializeTrack();
initializeWaypoints();
initializeRoutes();
startRealGps();
initializePwa();
initializeOfflineMaps(map);
initializeDeparture(map, () => !simulation && !gpsError ? latestPosition : null);
initializeWeather(map, () => !simulation && !gpsError ? latestPosition : null);

function startRealGps() {
  const session = ++gpsSession;
  startWatching(position => { if (session === gpsSession && !simulation) updateInterface(position); },
    error => { if (session === gpsSession && !simulation) showGpsError(error); });
}

function renderDeviation(route) {
  const usable = Boolean(route && !navigationState.completed && !gpsError && isUsablePosition(latestPosition));
  const metrics = usable ? computeRouteNavigation(route, latestPosition, 0, navigationState.targetIndex) : null;
  deviation = updateDeviation(deviation, { xte: metrics?.xteMeters, accuracy: latestPosition?.accuracy,
    timestamp: latestPosition?.timestamp, threshold: deviationThreshold, usable,
    leg: `${route?.id}:${navigationState.targetIndex}` });
  const message = getElement('navigation-alert');
  message.hidden = !route;
  message.classList.toggle('is-alert', deviation.active);
  message.textContent = !route ? '' : navigationState.completed ? 'Arrivée atteinte' :
    !usable ? 'Alerte d’écart suspendue · position indisponible ou imprécise' :
    metrics.xteMeters === null ? 'Rejoignez le premier point pour surveiller l’écart' :
    deviation.active ? `${simulation ? 'TEST · ' : ''}Écart de route : ${Math.round(Math.abs(metrics.xteMeters))} m · ${metrics.xteMeters > 0 ? 'bâbord' : 'tribord'}` :
    `Surveillance d’écart · seuil ${deviationThreshold} m`;
}

function stopSimulation() {
  if (!simulation) return;
  clearInterval(simulation.timer);
  navigationState = simulation.savedState;
  simulation = null;
  latestPosition = null;
  gpsError = '';
  firstFix = true;
  deviation = { active: false };
  document.body.classList.remove('simulating');
  getElement('simulation-exit').hidden = true;
  getElement('simulation-start').disabled = false;
  getElement('simulation-message').textContent = 'Simulation arrêtée. Attente d’une nouvelle position GPS réelle.';
  ['accuracy', 'speed-bottom', 'course'].forEach(id => { getElement(id).textContent = '—'; });
  map.clearBoat();
  updateTrackControls();
  updateGpsHealth();
  renderNavigation();
  startRealGps();
}

getElement('navigation-settings').addEventListener('click', () => {
  getElement('deviation-threshold').value = String(deviationThreshold);
  getElement('simulation-start').disabled = Boolean(simulation) || isTracking() || trackBusy;
  getElement('simulation-message').textContent = simulation ? 'Simulation en cours. Modifiez l’écart pour tester l’alerte.' :
    isTracking() || trackBusy ? 'Mettez l’enregistrement en pause avant de simuler.' : 'Parcourt la route depuis son premier point, sans enregistrer de trace.';
  getElement('navigation-dialog').showModal();
});
getElement('close-navigation-settings').addEventListener('click', () => getElement('navigation-dialog').close());
getElement('deviation-threshold').addEventListener('change', event => {
  deviationThreshold = Number(event.target.value);
  deviation = { active: false };
  try { localStorage.setItem(thresholdKey, String(deviationThreshold)); } catch { /* Session only. */ }
  renderNavigation();
});
getElement('simulation-exit').addEventListener('click', stopSimulation);
getElement('simulation-start').addEventListener('click', () => {
  const route = getRoutes().find(item => item.id === activeNavigationRouteId);
  if (!route?.points.length || simulation || isTracking() || trackBusy) return;
  ++gpsSession;
  stopWatching();
  simulation = { engine: createSimulator(route.points), savedState: { ...navigationState }, timer: null, done: false };
  navigationState = { targetIndex: 0, completed: false };
  deviation = { active: false };
  document.body.classList.add('simulating');
  getElement('simulation-exit').hidden = false;
  firstFix = false;
  map.centerOnRoute(route);
  updateTrackControls();
  updateInterface({ ...route.points[0], accuracy: 3, timestamp: Date.now(), speed: 0, course: null });
  simulation.timer = setInterval(() => {
    if (document.hidden || !simulation) return;
    const speed = Number(getElement('simulation-speed').value);
    const position = simulation.engine.step(speed, Number(getElement('simulation-offset').value));
    simulation.done = position.done;
    updateInterface({ ...position, accuracy: 3, timestamp: Date.now(), speed: position.done ? 0 : speed });
  }, 1000);
  getElement('navigation-dialog').close();
  setBottomSheetState(false);
});

initializeHome();
