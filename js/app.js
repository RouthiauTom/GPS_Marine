import { startWatching } from './gps.js';
import { initializeMap } from './map.js';

const getElement = id => document.getElementById(id);
const map = initializeMap('map');
let firstFix = true;
const MIN_COG_SPEED = 0.5;

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
startWatching(updateInterface, showGpsError);