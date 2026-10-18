import { test, expect } from '@playwright/test';
import { PbfWriter } from 'pbf';

// A valid tiny archive: every tile has a land polygon and a named place.
// Exercises the real PMTiles reader, range requests, persistence and MapLibre renderer.
function archiveFixture() {
  const pbf = new PbfWriter();
  pbf.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'earth'); layer.writeVarintField(15, 2); layer.writeVarintField(5, 4096);
    layer.writeMessage(2, (_, feature) => {
      feature.writeVarintField(3, 3);
      feature.writePackedVarint(4, [9, 0, 0, 26, 8192, 0, 0, 8192, 8191, 0, 15]);
    });
  });
  pbf.writeMessage(3, (_, layer) => {
    layer.writeStringField(1, 'places'); layer.writeVarintField(15, 2); layer.writeVarintField(5, 4096);
    layer.writeStringField(3, 'name');
    layer.writeMessage(4, (_, value) => value.writeStringField(1, 'Port témoin'));
    layer.writeMessage(2, (_, feature) => {
      feature.writeVarintField(3, 1); feature.writePackedVarint(2, [0, 0]);
      feature.writePackedVarint(4, [9, 4096, 4096]);
    });
  });
  const tile = Buffer.from(pbf.finish());
  const directory = new PbfWriter();
  for (const value of [1, 0, (4 ** 15 - 1) / 3, tile.length, 1]) directory.writeVarint(value);
  const index = Buffer.from(directory.finish());
  const metadata = Buffer.from(JSON.stringify({ vector_layers: [{ id: 'earth' }, { id: 'places' }],
    'planetiler:osm:osmosisreplicationtime': '2026-03-31T00:00:00Z' }));
  const result = Buffer.alloc(16384 + tile.length);
  result.write('PMTiles'); result[7] = 3;
  for (const [offset, value] of [[8, 127], [16, index.length], [24, 127 + index.length], [32, metadata.length],
    [56, 16384], [64, tile.length], [72, (4 ** 15 - 1) / 3], [80, 1], [88, 1]]) result.writeBigUInt64LE(BigInt(value), offset);
  result[96] = result[97] = result[98] = result[99] = 1; result[101] = 14;
  index.copy(result, 127); metadata.copy(result, 127 + index.length); tile.copy(result, 16384);
  return result;
}

async function prepare(context, page, { prefix = '/', failTile = false, changeVersion = false } = {}) {
  const archive = archiveFixture();
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await context.route('https://tiles.openseamap.org/**', route => route.abort());
  await context.route('https://data.source.coop/**', async route => {
    const [, first, last] = route.request().headers().range.match(/bytes=(\d+)-(\d+)/);
    const start = Number(first), end = Number(last);
    if (failTile && start === 16384) return route.fulfill({ status: 503, body: 'Unavailable' });
    await route.fulfill({ status: 206, body: archive.subarray(start, end + 1), headers: {
      'content-range': `bytes ${start}-${end}/${archive.length}`, etag: changeVersion && start !== 0 ? '"changed"' : '"fixture"',
      'access-control-allow-origin': '*', 'access-control-expose-headers': '*'
    } });
  });
  await page.goto(prefix);
  await expect(page.locator('#offline-status')).toContainText('Application prête hors connexion');
  await openMaps(page);
  await page.locator('#map-detail').selectOption('10');
}

async function openMaps(page) {
  await page.locator('#bottom-sheet').focus(); await page.keyboard.press('ArrowUp');
  await page.locator('#open-settings').click();
  await page.locator('#menu-offline').click(); await page.locator('#open-offline-maps').click();
}

for (const prefix of ['/', '/marine/']) {
  test(`downloads, cold reopens and deletes a region at ${prefix}`, async ({ context, page }) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await prepare(context, page, { prefix });
    await page.locator('#download-map').click();
    await expect(page.locator('#maps-status')).toContainText('téléchargée');
    await expect(page.locator('#downloaded-maps li')).toHaveCount(1);
    await expect(page.locator('#downloaded-maps')).toContainText('31/03/2026');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('ServiceWorker.enable');
    await context.setOffline(true);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await page.close();
    page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(prefix);
    await expect(page.locator('#map-status')).toContainText('Carte locale');
    await expect(page.locator('#map-status')).not.toContainText('incomplètes');
    await openMaps(page);
    await expect(page.locator('#downloaded-maps li')).toHaveCount(1);
    await expect(page.locator('#download-map')).toBeDisabled();
    await page.getByRole('button', { name: 'Afficher', exact: true }).click();
    await expect(page.locator('#map-status')).toContainText('sans balisage');
    await page.screenshot({ path: `test-results/downloaded-map-${prefix === '/' ? 'root' : 'subpath'}.png` });
    await openMaps(page);
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await expect(page.locator('#downloaded-maps li')).toHaveCount(0);
    await expect(page.locator('#map-status')).toContainText('sans fond de carte');
    expect(errors).toEqual([]);
  });
}

test('network failures and changing archives never publish partial regions', async ({ context, page }) => {
  await prepare(context, page, { failTile: true });
  await page.locator('#download-map').click();
  await expect(page.locator('#maps-status')).toContainText('Échec');
  await expect(page.locator('#downloaded-maps li')).toHaveCount(0);
  expect(await page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('marine-gps-maps-')))).toEqual([]);
  await context.unroute('https://data.source.coop/**');
  await page.locator('#close-maps').click();
  await prepare(context, page, { changeVersion: true });
  await page.locator('#download-map').click();
  await expect(page.locator('#maps-status')).toContainText('source a changé');
  await expect(page.locator('#downloaded-maps li')).toHaveCount(0);
});

test('cancelling an extraction discards the partial cache', async ({ context, page }) => {
  await prepare(context, page);
  await page.route('https://data.source.coop/**', async route => {
    if (route.request().headers().range.startsWith('bytes=16384-')) await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fallback();
  });
  await page.locator('#download-map').click();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('marine-gps-maps-')).length)).toBe(1);
  await page.locator('#cancel-map-download').click();
  await expect(page.locator('#maps-status')).toContainText('annulé');
  await expect(page.locator('#downloaded-maps li')).toHaveCount(0);
  await expect(page.locator('#download-map')).toBeEnabled();
  expect(await page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('marine-gps-maps-')))).toEqual([]);
});

test('quota failure keeps previously downloaded maps and updates preserve their caches', async ({ context, page }) => {
  await prepare(context, page);
  await page.locator('#download-map').click();
  await expect(page.locator('#maps-status')).toContainText('téléchargée');
  await page.evaluate(() => {
    const original = Cache.prototype.put;
    Cache.prototype.put = function(request, response) {
      if (String(request).includes('/offline-map/0/0/0.pbf')) return Promise.reject(new DOMException('Full', 'QuotaExceededError'));
      return original.call(this, request, response);
    };
  });
  await page.locator('#download-map').click();
  await expect(page.locator('#maps-status')).toContainText('Stockage plein');
  await expect(page.locator('#downloaded-maps li')).toHaveCount(1);
  await context.request.post('/__test/release', { data: { release: '1.3.1-maps-test' } });
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await page.close();
    page = await context.newPage();
    await page.goto('/');
    await openMaps(page);
    await expect(page.locator('#downloaded-maps li')).toHaveCount(1);
  } finally { await context.request.post('/__test/release', { data: { release: null } }); }
});
