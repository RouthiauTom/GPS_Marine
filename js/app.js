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
  deleteWaypoint,
  loadLatestTrack,
  loadWaypoints,
  saveTrack,
  saveWaypoint
} from './storage.js';
import {
  createWaypoint,
  getWaypoints,
  removeWaypoint,
  setWaypoints
} from './waypoint.js';

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

updateTrackControls();
updateWaypointControls();
initializeTrack();
initializeWaypoints();
startWatching(updateInterface, showGpsError);