// Bump the release whenever a precached file changes. Updates wait until all
// existing app windows close; never reload an active navigation session.
const RELEASE = '1.7.0';
const CACHE_PREFIX = `marine-gps-shell-${encodeURIComponent(self.registration.scope)}-`;
const CACHE_NAME = `${CACHE_PREFIX}${RELEASE}`;
const FILES = [
  './index.html', './manifest.webmanifest', './css/app.css', './css/interface.css',
  './js/app.js', './js/map.js', './js/gps.js', './js/navigation.mjs',
  './js/weather.js', './js/weather-data.mjs', './js/navigation-tools.mjs', './js/display.js',
  './js/storage.js', './js/track.js', './js/route.js', './js/waypoint.js',
  './js/gpx.js', './js/pwa.js',
  './js/offline-maps.js', './js/offline-maps-ui.js', './vendor/pmtiles/pmtiles.js', './vendor/pmtiles/fflate.js',
  './vendor/fonts/Noto Sans Regular/0-255.pbf', './vendor/fonts/Noto Sans Regular/256-511.pbf',
  './vendor/maplibre-gl/maplibre-gl.mjs',
  './vendor/maplibre-gl/maplibre-gl-worker.mjs',
  './vendor/maplibre-gl/maplibre-gl-shared.mjs',
  './vendor/maplibre-gl/maplibre-gl.css',
  './icons/app.svg', './icons/app-192.png', './icons/app-512.png', './icons/apple-touch-icon.png'
].map(file => new URL(file, self.registration.scope).href);
const HOME = new URL('./index.html', self.registration.scope).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // addAll is atomic: an incomplete download must never activate this release.
    await cache.addAll(FILES.map(url => new Request(url, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE') return;
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    const complete = (await Promise.all(FILES.map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ ready: complete, release: RELEASE });
  })());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  url.search = '';
  url.hash = '';
  const isHome = url.href === self.registration.scope || url.href === HOME;
  const key = isHome ? HOME : url.href;
  // Region tiles use separate, user-managed caches through the map protocol.
  if (!FILES.includes(key)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(key)) || fetch(event.request);
  })());
});
