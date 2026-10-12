import { test, expect } from '@playwright/test';

async function prepare(context, page, prefix = '/') {
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#b4d3df' } }]
  } }));
  await context.route('https://tiles.openseamap.org/**', route => route.abort());
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success) { window.gpsSuccess = success; return 1; }, clearWatch() {}
    } });
  });
  await page.goto(prefix);
  await expect(page.locator('#track-record')).toBeEnabled();
  await expect(page.locator('#offline-status')).toContainText('Application prête hors connexion', { timeout: 15000 });
  await expect(page.locator('#offline-update')).toHaveAttribute('hidden', '');
}

async function fix(page, longitude) {
  await page.evaluate(longitude => window.gpsSuccess({
    coords: { latitude: 49.35, longitude, accuracy: 5, speed: 2, heading: 90 }, timestamp: Date.now()
  }), longitude);
}

for (const prefix of ['/', '/marine/']) {
  test(`reopens offline at ${prefix}, restores data, records and exports without HTTP cache`, async ({ context, page }) => {
    await prepare(context, page, prefix);
    await page.evaluate(async prefix => {
      const storage = await import(`${prefix}js/storage.js`);
      await storage.saveRoute({ id: 'offline-route', name: 'Route locale', createdAt: 1, visible: true,
        points: [{ latitude: 49.35, longitude: -1.7 }, { latitude: 49.35, longitude: -1.69 }] });
      await storage.saveWaypoint({ id: 'offline-waypoint', name: 'Abri', type: 'port', createdAt: 1, latitude: 49.35, longitude: -1.7 });
      await storage.saveTrack({ id: 'offline-archived', archived: true, name: 'Ancienne sortie', startedAt: 1,
        points: [{ latitude: 49.35, longitude: -1.7, timestamp: 1, accuracy: 5, segment: 0 }] });
    }, prefix);
    // Remove the HTTP cache and stop workers: reopening must use the installed shell.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    await cdp.send('ServiceWorker.enable');
    await context.setOffline(true);
    await cdp.send('ServiceWorker.stopAllWorkers');
    await page.close();
    const reopened = await context.newPage();
    const errors = [];
    reopened.on('pageerror', e => errors.push(e.message));
    const response = await reopened.goto(prefix);
    expect(response.fromServiceWorker()).toBe(true);
    await expect(reopened.locator('#track-record')).toBeEnabled();
    await expect(reopened.locator('#map-status')).toContainText('sans fond de carte');
    await expect(reopened.locator('#menu-waypoint-count')).toHaveText('1');
    await expect(reopened.locator('#menu-route-count')).toHaveText('1');
    await expect(reopened.locator('.waypoint-marker-port')).toHaveCount(1);
    await expect(reopened.locator('#offline-status')).toContainText('Application prête hors connexion');
    await reopened.locator('#track-record').click();
    await fix(reopened, -1.7);
    await reopened.clock.install();
    await reopened.clock.fastForward(1000);
    await fix(reopened, -1.6999);
    await expect(reopened.locator('#speed-bottom')).toHaveText('3.9');
    await reopened.locator('#track-record').click();
    await reopened.locator('#track-save').click();
    await expect(reopened.locator('#track-status')).toContainText('archivée');
    await reopened.locator('#open-gpx').click();
    await expect(reopened.locator('[data-export-kind="tracks"]')).toHaveCount(2);
    await expect(reopened.locator('[data-export-kind="routes"]')).toHaveCount(1);
    await expect(reopened.locator('[data-export-kind="waypoints"]')).toHaveCount(1);
    const pending = reopened.waitForEvent('download');
    await reopened.locator('#export-gpx').click();
    const download = await pending;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const xml = Buffer.concat(chunks).toString();
    expect(xml).toContain('Ancienne sortie');
    expect(xml).toContain('Route locale');
    expect(xml).toContain('Abri');
    expect(xml.match(/<trk>/g)).toHaveLength(2);
    expect(errors).toEqual([]);
    await reopened.locator('#close-gpx').click();
    await reopened.screenshot({ path: `test-results/offline-${prefix === '/' ? 'root' : 'subpath'}.png` });
    await context.setOffline(false);
    await expect(reopened.locator('#map-status')).not.toContainText('Hors connexion');
    await expect(reopened.locator('.waypoint-marker-port')).toHaveCount(1);
  });
}

test('missing cached asset is reported as incomplete rather than ready', async ({ context, page }) => {
  await prepare(context, page);
  await page.evaluate(async () => {
    const key = (await caches.keys()).find(key => key.startsWith('marine-gps-shell-'));
    const cache = await caches.open(key);
    await cache.delete(new URL('./js/gpx.js', location.href));
  });
  await page.locator('#bottom-sheet').focus();
  await page.keyboard.press('ArrowUp');
  await page.locator('#menu-offline').click();
  await expect(page.locator('#offline-status')).toContainText('Préparation incomplète');
});

test('installation failure never announces offline readiness', async ({ context, page }) => {
  await context.route('**/icons/app-512.png', route => route.fulfill({ status: 503, body: 'Unavailable' }));
  await context.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.goto('/');
  await expect(page.locator('#track-record')).toBeEnabled();
  await expect(page.locator('#offline-status')).toContainText(/interrompue|impossible/, { timeout: 15000 });
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false);
  await expect(page.locator('#map-status')).toContainText('indisponible');
});


test('an update waits for closing the app and preserves the recorded trace', async ({ context, page }) => {
  await prepare(context, page);
  await page.locator('#track-record').click();
  await fix(page, -1.7);
  await context.request.post('/__test/release', { data: { release: '1.2.1-test' } });
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration()).waiting))).toBe(true);
    await expect(page.locator('#track-record')).toHaveAttribute('aria-label', 'Mettre en pause l’enregistrement');
    expect(await page.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('marine-gps-shell-')).length)).toBe(2);
    await page.locator('#bottom-sheet').focus();
    await page.keyboard.press('ArrowUp');
    await page.locator('#menu-offline').click();
    await expect(page.locator('#offline-update')).toBeVisible();
    await page.locator('#close-offline').click();
    await page.locator('#track-record').click();
    await page.locator('#track-save').click();
    await expect(page.locator('#track-status')).toContainText('archivée');
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('/');
    await expect(reopened.locator('#track-record')).toBeEnabled();
    await expect.poll(() => reopened.evaluate(async () => (await caches.keys()).filter(key => key.startsWith('marine-gps-shell-'))))
      .toEqual([expect.stringContaining('1.2.1-test')]);
    const tracks = await reopened.evaluate(async () => (await import('/js/storage.js')).loadTracks());
    expect(tracks).toHaveLength(1);
    expect(tracks[0].archived).toBe(true);
    expect(tracks[0].points).toHaveLength(1);
  } finally {
    await context.request.post('/__test/release', { data: { release: null } });
  }
});
