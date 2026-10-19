export const WEATHER_FRESH_MS = 30 * 60 * 1000;
const definitions = {
  wind: { endpoint: 'https://api.open-meteo.com/v1/forecast', fields: { wind_speed_10m: 'kn', wind_gusts_10m: 'kn', wind_direction_10m: '°' } },
  sea: { endpoint: 'https://marine-api.open-meteo.com/v1/marine', fields: { wave_height: 'm', wave_period: 's', wave_direction: '°' } }
};
export function weatherPoint(point) {
  if (!Number.isFinite(point?.latitude) || Math.abs(point.latitude) > 90 || !Number.isFinite(point?.longitude) || Math.abs(point.longitude) > 180) throw new Error('Position invalide.');
  return { latitude: Math.round(point.latitude * 1000) / 1000, longitude: Math.round(point.longitude * 1000) / 1000, name: point.name || 'Point choisi' };
}
export const weatherKey = point => `${point.latitude.toFixed(3)},${point.longitude.toFixed(3)}`;
export function parseForecast(json, kind, fetchedAt = Date.now()) {
  const fields = definitions[kind].fields;
  const times = json?.hourly?.time;
  if (!Array.isArray(times) || !times.length || times.length > 200 || json.hourly_units?.time !== 'unixtime' ||
    times.some((time, i) => !Number.isFinite(time) || time < 0 || time > 8640000000000 || (i && time <= times[i - 1]))) throw new Error('Horaires reçus invalides.');
  for (const [field, unit] of Object.entries(fields)) {
    if (json.hourly_units?.[field] !== unit || !Array.isArray(json.hourly[field]) || json.hourly[field].length !== times.length) throw new Error('Prévisions reçues incomplètes.');
  }
  const rows = times.map((time, i) => {
    const row = { time: time * 1000 };
    for (const field of Object.keys(fields)) {
      const value = json.hourly[field][i];
      row[field] = Number.isFinite(value) && value >= 0 && (!field.includes('direction') || value <= 360) ? value : null;
    }
    return row;
  });
  return { fetchedAt, latitude: json.latitude, longitude: json.longitude, rows };
}
export async function fetchForecast(point, kind, signal) {
  const definition = definitions[kind];
  const url = new URL(definition.endpoint);
  const parameters = { latitude: point.latitude, longitude: point.longitude, hourly: Object.keys(definition.fields).join(','),
    forecast_days: '3', timeformat: 'unixtime', cell_selection: kind === 'sea' ? 'sea' : 'nearest' };
  if (kind === 'wind') parameters.wind_speed_unit = 'kn';
  for (const [key, value] of Object.entries(parameters)) url.searchParams.set(key, value);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 12000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(response.status === 429 ? 'Limite du service atteinte. Réessayez plus tard.' : 'Service momentanément indisponible.');
    return parseForecast(await response.json(), kind);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export function forecastRows(snapshot, now = Date.now()) {
  const start = Math.floor(now / 3600000) * 3600000;
  const rows = new Map();
  for (const forecast of [snapshot?.wind, snapshot?.sea]) {
    for (const row of forecast?.rows || []) {
      if (row.time < start || row.time >= start + 48 * 3600000) continue;
      rows.set(row.time, { ...rows.get(row.time), ...row });
    }
  }
  return [...rows.values()].sort((a, b) => a.time - b.time);
}
export function directionText(value) {
  if (!Number.isFinite(value)) return '—';
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return `${names[Math.round(value / 22.5) % 16]} ${Math.round(value) % 360}°`;
}
