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
import { deleteTrack, loadLatestTrack, saveTrack } from './storage.js';

const getElement = id => document.getElementById(id);
const map = initializeMap('map');
let firstFix = true;
const MIN_COG_SPEED = 0.5;
let trackStorageAvailable = true;
let trackStorageInitialized = false;

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

function updateInterface(position) {
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

updateTrackControls();
initializeTrack();
startWatching(updateInterface, showGpsError);