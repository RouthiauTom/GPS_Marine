import { listOfflineMaps, containsBounds } from './offline-maps.js';
import { loadRoutes, loadWaypoints } from './storage.js';
import { weatherPoint, weatherKey, forecastRows, WEATHER_FRESH_MS } from './weather-data.mjs';
import { isUsablePosition } from './gps.js';

export function initializeDeparture(map, getPosition) {
  const panel = document.getElementById('settings-dialog');
  let generation = 0;
  const show = (id, message, ready = false) => {
    const element = document.getElementById(`departure-${id}`);
    element.textContent = message;
    element.dataset.ready = String(ready);
  };
  const gps = () => {
    const position = getPosition();
    const usable = isUsablePosition(position);
    show('gps', usable ? `Signal reçu · ± ${Math.round(position.accuracy)} m · il y a ${Math.max(0, Math.floor((Date.now() - position.timestamp) / 1000))} s` : 'En attente d’une position GPS réelle et fiable', usable);
  };
  async function refresh() {
    const token = ++generation;
    const bounds = map.getVisibleBounds();
    const point = weatherPoint(map.getWeatherCenter());
    gps();
    for (const id of ['map', 'data']) show(id, 'Vérification…');
    try {
      const saved = JSON.parse(localStorage.getItem(`marine-gps-weather:${new URL('../', import.meta.url).pathname}`));
      const snapshot = saved?.entries?.find(entry => weatherKey(weatherPoint(entry.point)) === weatherKey(point));
      const parts = [snapshot?.wind, snapshot?.sea];
      const dates = parts.filter(Boolean).map(part => part.fetchedAt);
      const current = forecastRows(snapshot).length > 0;
      const fresh = current && parts.every(part => part && Date.now() >= part.fetchedAt && Date.now() - part.fetchedAt < WEATHER_FRESH_MS);
      show('weather', dates.length ? `${fresh ? 'Prévisions récentes' : current ? 'Prévisions partielles ou à actualiser' : 'Prévisions expirées'} · récupération la plus ancienne : ${new Date(Math.min(...dates)).toLocaleString('fr-FR')}` : 'Aucune météo sauvegardée au centre de la carte', fresh);
    } catch { show('weather', 'Météo locale indisponible'); }
    const results = await Promise.allSettled([listOfflineMaps(), loadRoutes(), loadWaypoints()]);
    if (token !== generation || !panel.open) return;
    const [zones, routes, waypoints] = results;
    if (zones.status === 'fulfilled') {
      const covered = zones.value.find(zone => zone.status === 'ready' && containsBounds(zone.bounds, bounds));
      show('map', covered ? `Zone visible couverte · ${covered.name} · détail ${covered.maxZoom}` : 'Zone visible non couverte par une carte téléchargée complète', Boolean(covered));
    } else show('map', 'Impossible de vérifier les cartes locales');
    if (routes.status === 'fulfilled' && waypoints.status === 'fulfilled') {
      const count = routes.value.length + waypoints.value.length;
      show('data', `${routes.value.length} route(s) et ${waypoints.value.length} waypoint(s) sauvegardés sur cet appareil`, count > 0);
    } else show('data', 'Impossible de vérifier les routes et waypoints sauvegardés');
  }
  document.getElementById('open-settings').addEventListener('click', refresh);
  document.getElementById('departure-refresh').addEventListener('click', refresh);
  document.getElementById('departure-open-weather').addEventListener('click', () => { panel.close(); document.getElementById('open-weather').click(); });
  setInterval(() => { if (panel.open) gps(); }, 1000);
}
