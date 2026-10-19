import { WEATHER_FRESH_MS, weatherPoint, weatherKey, fetchForecast, forecastRows, directionText } from './weather-data.mjs';
import { isUsablePosition } from './gps.js';

export function initializeWeather(map, getPosition) {
  const $ = id => document.getElementById(id);
  const dialog = $('weather-dialog');
  const cacheKey = `marine-gps-weather:${new URL('../', import.meta.url).pathname}`;
  let snapshots = {};
  try {
    const saved = JSON.parse(localStorage.getItem(cacheKey));
    if (saved?.version === 1 && Array.isArray(saved.entries)) {
      for (const entry of saved.entries.slice(0, 6)) {
        const point = weatherPoint(entry.point);
        if ([entry.wind, entry.sea].every(part => !part || (Number.isFinite(part.fetchedAt) && Array.isArray(part.rows) && part.rows.length <= 200 && part.rows.every(row => row && Number.isFinite(row.time))))) snapshots[weatherKey(point)] = { ...entry, point };
      }
    }
  } catch { /* Weather can still be displayed without persistence. */ }
  let selected = weatherPoint(map.getWeatherCenter());
  let request = null;
  let generation = 0;
  let notice = '';
  const attempts = new Map();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = value => new Date(value).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const number = (value, unit) => Number.isFinite(value) ? `${value.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} ${unit}` : '—';
  const save = () => {
    const entries = Object.values(snapshots).sort((a, b) => Math.max(b.wind?.fetchedAt || 0, b.sea?.fetchedAt || 0) - Math.max(a.wind?.fetchedAt || 0, a.sea?.fetchedAt || 0)).slice(0, 6);
    snapshots = Object.fromEntries(entries.map(entry => [weatherKey(entry.point), entry]));
    try { localStorage.setItem(cacheKey, JSON.stringify({ version: 1, entries, selected })); }
    catch { notice += ' Sauvegarde indisponible : ces prévisions restent uniquement dans cette session.'; }
  };
  const render = () => {
    const snapshot = snapshots[weatherKey(selected)];
    $('weather-location').textContent = `${selected.name} · ${selected.latitude.toFixed(3)}°, ${selected.longitude.toFixed(3)}°`;
    $('weather-timezone').textContent = `Heures du téléphone : ${timezone}. Directions de provenance du vent et des vagues.`;
    const rows = forecastRows(snapshot);
    const fresh = [snapshot?.wind, snapshot?.sea].every(part => part && Date.now() - part.fetchedAt < WEATHER_FRESH_MS && part.fetchedAt <= Date.now());
    $('weather-status').textContent = `${!navigator.onLine ? 'Hors connexion · ' : ''}${request ? 'Actualisation… ' : ''}${snapshot ? fresh ? 'Prévisions récupérées récemment. ' : 'Prévisions sauvegardées à actualiser. ' : 'Aucune prévision sauvegardée pour ce point. '}${notice}`;
    $('weather-refresh').disabled = Boolean(request) || !navigator.onLine;
    $('weather-boat').disabled = !isUsablePosition(getPosition());
    for (const kind of ['wind', 'sea']) {
      const part = snapshot?.[kind];
      const grid = Number.isFinite(part?.latitude) && Number.isFinite(part?.longitude) ? ` · maille ${part.latitude.toFixed(3)}°, ${part.longitude.toFixed(3)}°` : '';
      $(`weather-${kind}-date`).textContent = `${kind === 'wind' ? 'Vent' : 'Vagues'} : ${part ? `récupéré le ${date(part.fetchedAt)}${grid}` : 'indisponible'}`;
    }
    const first = rows[0];
    $('weather-wind-now').textContent = number(first?.wind_speed_10m, 'nd');
    $('weather-gust-now').textContent = `Rafales ${number(first?.wind_gusts_10m, 'nd')} · de ${directionText(first?.wind_direction_10m)}`;
    $('weather-wave-now').textContent = number(first?.wave_height, 'm');
    $('weather-period-now').textContent = `Période ${number(first?.wave_period, 's')} · de ${directionText(first?.wave_direction)}`;
    $('weather-valid-time').textContent = first ? `Prévision valable le ${date(first.time)} (heure entière)` : 'Aucune prévision disponible pour les prochaines 48 heures.';
    const table = $('weather-rows');
    table.replaceChildren();
    for (const row of rows.filter(row => (row.time - rows[0].time) % (3 * 3600000) === 0)) {
      const tr = document.createElement('tr');
      const values = [date(row.time), `${number(row.wind_speed_10m, 'nd')} / ${number(row.wind_gusts_10m, 'nd')}\n${directionText(row.wind_direction_10m)}`,
        `${number(row.wave_height, 'm')} · ${number(row.wave_period, 's')}\n${directionText(row.wave_direction)}`];
      for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); }
      table.append(tr);
    }
    $('weather-table').hidden = !rows.length;
  };
  async function load(point, force = false) {
    selected = weatherPoint(point);
    request?.abort(); request = null;
    const token = ++generation;
    notice = '';
    const key = weatherKey(selected);
    const old = snapshots[key];
    const fresh = [old?.wind, old?.sea].every(part => part && Date.now() - part.fetchedAt < WEATHER_FRESH_MS && part.fetchedAt <= Date.now());
    if (!navigator.onLine || (fresh && !force)) { if (old) save(); render(); return; }
    if (Date.now() - (attempts.get(key) || 0) < 60000) { notice = 'Patientez une minute entre deux actualisations de ce point.'; render(); return; }
    attempts.set(key, Date.now());
    const controller = new AbortController(); request = controller;
    render();
    const pointSnapshot = { ...selected };
    const results = await Promise.allSettled(['wind', 'sea'].map(kind => fetchForecast(pointSnapshot, kind, controller.signal)));
    if (generation !== token || controller.signal.aborted) return;
    request = null;
    const next = { ...old, point: pointSnapshot };
    const failures = [];
    results.forEach((result, index) => {
      const kind = index === 0 ? 'wind' : 'sea';
      if (result.status === 'fulfilled') next[kind] = result.value;
      else failures.push(`${kind === 'wind' ? 'Vent' : 'Vagues'} non actualisé`);
    });
    notice = failures.length ? `${failures.join(' ; ')}. Les éventuelles données précédentes gardent leur date de récupération.` : '';
    if (next.wind || next.sea) { snapshots[key] = next; save(); }
    render();
  }
  $('open-weather').addEventListener('click', () => { dialog.showModal(); void load(map.getWeatherCenter()); });
  $('close-weather').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { ++generation; request?.abort(); request = null; });
  $('weather-refresh').addEventListener('click', () => void load(selected, true));
  $('weather-center').addEventListener('click', () => void load(map.getWeatherCenter()));
  $('weather-boat').addEventListener('click', () => {
    const point = getPosition();
    if (isUsablePosition(point)) void load({ ...point, name: 'Position du bateau' });
    else { notice = 'Position GPS réelle indisponible ou périmée.'; render(); }
  });
  window.addEventListener('offline', () => { ++generation; request?.abort(); request = null; if (dialog.open) render(); });
  window.addEventListener('online', () => { if (dialog.open) render(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && dialog.open) render(); });
  setInterval(() => { if (dialog.open) render(); }, 60000);
}
