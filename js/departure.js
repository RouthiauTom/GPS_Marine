import { routeCoverage } from './route-coverage.mjs';
import { listOfflineMaps, containsBounds } from './offline-maps.js';
import { loadRoutes, loadWaypoints } from './storage.js';
import { weatherPoint, weatherKey, forecastRows, WEATHER_FRESH_MS } from './weather-data.mjs';
import { isUsablePosition } from './gps.js';

export function initializeDeparture(map, getPosition) {
  const panel = document.getElementById('settings-dialog');
  let generation = 0;
  let savedRoutes = [], savedZones = null;
  const selector = document.getElementById('departure-route');
  function coverage() {
    const route = savedRoutes.find(route => route.id === selector.value);
    const preview = document.getElementById('departure-preview');
    const legend = document.getElementById('departure-legend');
    const status = document.getElementById('departure-coverage');
    preview.replaceChildren(); preview.setAttribute('hidden', ''); legend.hidden = true;
    if (!route) { status.textContent = ''; return; }
    const result = savedZones ? routeCoverage(route.points, savedZones) : { error: 'Cartes locales indisponibles : couverture non vérifiée.' };
    if (result.error) { status.textContent = result.error; return; }
    status.textContent = result.missing.length ? `Portions non couvertes entre les points : ${result.missing.map(i => `${i} → ${i + 1}`).join(', ')}.` : 'Tous les segments de cette route sont couverts par les zones téléchargées.';
    const xs = result.vertices.map(p => p[0]), ys = result.vertices.map(p => p[1]);
    const minX = Math.min(...xs), maxY = Math.max(...ys);
    const scale = Math.min(280 / (Math.max(...xs) - minX || 1), 140 / (maxY - Math.min(...ys) || 1));
    const xy = p => [20 + (p[0] - minX) * scale, 20 + (maxY - p[1]) * scale];
    const element = (tag, attrs) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value); preview.append(node); return node; };
    for (const portion of result.portions) {
      const [x1, y1] = xy(portion.a), [x2, y2] = xy(portion.b);
      element('line', { x1, y1, x2, y2, stroke: portion.covered ? '#19745a' : '#bd6413', 'stroke-width': 4, 'stroke-dasharray': portion.covered ? 'none' : '6 4' });
    }
    result.vertices.forEach((p, i) => { const [x, y] = xy(p); element('circle', { cx: x, cy: y, r: 3, fill: 'currentColor' }); element('text', { x: x + 5, y: y - 5, fill: 'currentColor', 'font-size': 11 }).textContent = i + 1; });
    preview.removeAttribute('hidden'); legend.hidden = false;
  }
  selector.addEventListener('change', coverage);
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
    selector.disabled = true;
    document.getElementById('departure-coverage').textContent = 'Vérification des routes…';
    document.getElementById('departure-preview').setAttribute('hidden', '');
    document.getElementById('departure-legend').hidden = true;
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
    savedZones = zones.status === 'fulfilled' ? zones.value : null;
    savedRoutes = routes.status === 'fulfilled' ? routes.value : [];
    const selected = selector.value;
    selector.replaceChildren(new Option('Zone visible uniquement', ''));
    for (const route of savedRoutes) selector.add(new Option(route.name || 'Route sans nom', route.id));
    selector.value = savedRoutes.some(route => route.id === selected) ? selected : '';
    selector.disabled = routes.status !== 'fulfilled';
    coverage();
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
