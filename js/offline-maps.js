import { PMTiles } from '../vendor/pmtiles/pmtiles.js';

// This archive is published for regional extraction, not used for live map browsing.
export const ARCHIVE_URL = 'https://data.source.coop/protomaps/openstreetmap/v4.pmtiles';
export const MAX_TILES = 600;
export const MAX_BYTES = 100 * 1024 * 1024;
const ROOT = new URL('../', import.meta.url).href;
const PREFIX = `marine-gps-maps-${encodeURIComponent(ROOT)}-`;
const manifestUrl = new URL('offline-map/manifest.json', ROOT).href;
const tileUrl = (z, x, y) => new URL(`offline-map/${z}/${x}/${y}.pbf`, ROOT).href;

export function tilesForBounds(bounds, maxZoom) {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || west < -180 || east > 180 || west >= east ||
      south >= north || south < -85.05112878 || north > 85.05112878) {
    throw new Error('Zone non prise en charge. Zoomez et évitez de traverser le méridien ±180°.');
  }
  if (!Number.isInteger(maxZoom) || maxZoom < 0 || maxZoom > 14) throw new Error('Niveau de détail invalide.');
  const result = [];
  for (let z = 0; z <= maxZoom; z++) {
    const n = 2 ** z;
    const x = lon => Math.max(0, Math.min(n - 1, Math.floor((lon + 180) / 360 * n)));
    const y = lat => Math.max(0, Math.min(n - 1, Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n)));
    for (let tx = x(west); tx <= x(east); tx++) {
      for (let ty = y(north); ty <= y(south); ty++) {
        result.push([z, tx, ty]);
        if (result.length > MAX_TILES) throw new Error('Zone trop grande pour ce détail. Zoomez sur une zone plus petite ou réduisez le détail.');
      }
    }
  }
  return result;
}

export function containsBounds(outer, inner) {
  return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

export async function listOfflineMaps() {
  if (!globalThis.caches) return [];
  const zones = [];
  for (const key of await caches.keys()) {
    if (!key.startsWith(PREFIX)) continue;
    const response = await (await caches.open(key)).match(manifestUrl);
    if (!response) continue;
    try { zones.push(await response.json()); } catch { /* incomplete metadata */ }
  }
  return zones.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteOfflineMap(id) {
  await caches.delete(PREFIX + id);
  window.dispatchEvent(new Event('offline-maps-changed'));
}

export async function readOfflineTile(id, z, x, y) {
  // Never reach the network, even if a tile has been evicted.
  const response = await (await caches.open(PREFIX + id)).match(tileUrl(z, x, y));
  if (!response) throw new Error('Tuile hors ligne absente. Téléchargez à nouveau cette zone.');
  return response.arrayBuffer();
}

export async function downloadOfflineMap({ name, bounds, maxZoom, signal, onProgress = () => {} }) {
  const tiles = tilesForBounds(bounds, maxZoom);
  if (!globalThis.caches) throw new Error('Stockage indisponible. Utilisez HTTPS et un navigateur compatible.');
  signal?.throwIfAborted();
  let version = null;
  let sourceDate = null;
  let transferred = 0;
  // Strict ranges prevent accidentally downloading the 100+ GB planet archive.
  const source = {
    getKey: () => ARCHIVE_URL,
    async getBytes(offset, length) {
      signal?.throwIfAborted();
      if (length > 8 * 1024 * 1024) throw new Error('Bloc source trop volumineux.');
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, 20000);
      try {
        const response = await fetch(ARCHIVE_URL, {
          headers: { Range: `bytes=${offset}-${offset + length - 1}` }, signal: controller.signal
        });
        const range = response.headers.get('content-range');
        const etag = response.headers.get('etag');
        if (response.status !== 206 || !range?.startsWith(`bytes ${offset}-${offset + length - 1}/`) || !etag) {
          await response.body?.cancel();
          throw new Error('Le serveur ne permet pas cette extraction. Réessayez plus tard.');
        }
        if (version && etag !== version) {
          await response.body?.cancel();
          throw new Error('La source a changé pendant le téléchargement. Relancez la préparation.');
        }
        version = etag;
        sourceDate ||= response.headers.get('last-modified');
        transferred += length;
        if (transferred > MAX_BYTES * 2) {
          await response.body?.cancel();
          throw new Error('Limite de transfert atteinte. Choisissez une zone plus petite.');
        }
        const data = await response.arrayBuffer();
        if (data.byteLength !== length) throw new Error('Téléchargement incomplet.');
        return { data, etag };
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    }
  };
  const archive = new PMTiles(source);
  const header = await archive.getHeader();
  if (header.tileType !== 1 || header.minZoom > 0 || header.maxZoom < maxZoom) throw new Error('Format de carte incompatible.');
  const metadata = await archive.getMetadata();
  if (!metadata.vector_layers?.some(layer => layer.id === 'earth')) throw new Error('Style de carte incompatible.');
  const estimate = await navigator.storage?.estimate?.();
  if (estimate?.quota && estimate.quota - estimate.usage < tiles.length * 50000) {
    throw new Error('Espace disponible insuffisant. Supprimez une ancienne zone ou réduisez celle-ci.');
  }
  const zone = { id: crypto.randomUUID(), name: name.trim().slice(0, 80) || 'Zone sans nom', bounds,
    maxZoom, createdAt: Date.now(), status: 'downloading', bytes: 0, tileCount: tiles.length,
    sourceDate: metadata['planetiler:osm:osmosisreplicationtime'] || sourceDate, source: ARCHIVE_URL, version };
  const cache = await caches.open(PREFIX + zone.id);
  try {
    await cache.put(manifestUrl, Response.json(zone));
    // Sequential extraction keeps network and memory usage bounded on phones.
    for (let i = 0; i < tiles.length; i++) {
      signal?.throwIfAborted();
      const [z, x, y] = tiles[i];
      const tile = await archive.getZxy(z, x, y, signal);
      const data = tile?.data || new ArrayBuffer(0); // Missing archive tile is a legitimate empty tile.
      zone.bytes += data.byteLength;
      if (zone.bytes > MAX_BYTES) throw new Error('La zone dépasse 100 Mo. Réduisez la zone ou le détail.');
      await cache.put(tileUrl(z, x, y), new Response(data));
      onProgress({ completed: i + 1, total: tiles.length, bytes: zone.bytes });
    }
    signal?.throwIfAborted();
    zone.status = 'ready';
    await cache.put(manifestUrl, Response.json(zone));
    window.dispatchEvent(new Event('offline-maps-changed'));
    return zone;
  } catch (error) {
    await caches.delete(PREFIX + zone.id);
    if (error.name === 'QuotaExceededError') throw new Error('Stockage plein. Libérez de la place et recommencez.');
    throw error;
  }
}

export function offlineMapStyle(zone) {
  const layer = (id, type, sourceLayer, paint, rest = {}) => ({ id, type, source: 'offline-region', 'source-layer': sourceLayer, paint, ...rest });
  return {
    version: 8,
    glyphs: 'marine-glyphs://{fontstack}/{range}.pbf',
    sources: {
      'offline-region': { type: 'vector', tiles: [`marine-offline://${zone.id}/{z}/{x}/{y}`],
        minzoom: 0, maxzoom: zone.maxZoom, bounds: zone.bounds,
        attribution: '<a href="https://protomaps.com/">Protomaps</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Natural Earth' },
      'offline-boundary': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon',
        coordinates: [[[zone.bounds[0], zone.bounds[1]], [zone.bounds[2], zone.bounds[1]],
          [zone.bounds[2], zone.bounds[3]], [zone.bounds[0], zone.bounds[3]], [zone.bounds[0], zone.bounds[1]]]] } } },
      'offline-unknown': { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [
        [[-180, -85.05112878], [180, -85.05112878], [180, 85.05112878], [-180, 85.05112878], [-180, -85.05112878]],
        [[zone.bounds[0], zone.bounds[1]], [zone.bounds[0], zone.bounds[3]], [zone.bounds[2], zone.bounds[3]],
          [zone.bounds[2], zone.bounds[1]], [zone.bounds[0], zone.bounds[1]]]
      ] } } }
    },
    layers: [
      { id: 'offline-background', type: 'background', paint: { 'background-color': '#b4d3df' } },
      layer('offline-land', 'fill', 'earth', { 'fill-color': '#eeebda' }),
      layer('offline-water', 'fill', 'water', { 'fill-color': '#b4d3df' }, { filter: ['==', ['geometry-type'], 'Polygon'] }),
      layer('offline-piers', 'fill', 'landuse', { 'fill-color': '#c5c0ae' }, { filter: ['in', ['get', 'kind'], ['literal', ['pier', 'marina']]] }),
      layer('offline-roads', 'line', 'roads', { 'line-color': '#c4b9a3', 'line-width': 1 }, { minzoom: 10 }),
      layer('offline-buildings', 'fill', 'buildings', { 'fill-color': '#d4cbb9' }, { minzoom: 13 }),
      layer('offline-places', 'symbol', 'places', { 'text-color': '#263b38', 'text-halo-color': '#fff', 'text-halo-width': 1 }, {
        layout: { 'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'], 'text-size': 12 }
      }),
      { id: 'offline-unknown', type: 'fill', source: 'offline-unknown', paint: { 'fill-color': '#e2e5e4' } },
      { id: 'offline-boundary', type: 'line', source: 'offline-boundary', paint: { 'line-color': '#26735e', 'line-width': 2, 'line-dasharray': [3, 2] } }
    ]
  };
}
