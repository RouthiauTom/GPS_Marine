import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const errors = new WeakMap();
test.beforeEach(async ({ page }) => {
  errors.set(page, []);
  page.on('pageerror', error => errors.get(page).push(error.message));
  await page.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: {
    version: 8, sources: {}, layers: [{ id: 'sea', type: 'background', paint: { 'background-color': '#b4d3df' } }]
  } }));
  await page.route('https://tiles.openseamap.org/**', route => route.fulfill({
    contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64')
  }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: {
      watchPosition(success, failure) { window.gpsSuccess = success; window.gpsFailure = failure; return 1; },
      clearWatch() {}
    } });
  });
  // Expose the real map only in tests to check asynchronous layer initialization.
  await page.route('**/js/map.js*', async route => route.fulfill({
    contentType: 'text/javascript',
    body: (await readFile('js/map.js', 'utf8')).replace('const map = new maplibregl.Map', 'const map = window.testMap = new maplibregl.Map')
  }));
  await page.goto('/');
  await expect(page.locator('#track-record')).toBeEnabled();
  await page.waitForFunction(() => typeof window.gpsSuccess === 'function');
  await page.waitForFunction(() => window.testMap?.getLayer('navigation-target-point') && window.testMap?.getSource('gps-track'));
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });
async function fix(page, longitude = -1.7, accuracy = 5, timestamp = Date.now()) {
  await page.evaluate(({ longitude, accuracy, timestamp }) => window.gpsSuccess({
    coords: { latitude: 49.35, longitude, accuracy, speed: 2, heading: 90 }, timestamp
  }), { longitude, accuracy, timestamp });
}
async function expand(page) {
  await page.locator('#bottom-sheet').focus();
  await page.keyboard.press('ArrowUp');
}

test('recenter is clickable and stale/error GPS values are visibly invalidated', async ({ page }) => {
  await fix(page);
  await expect(page.locator('#speed-bottom')).toHaveText('3.9');
  await page.locator('#locate').click();
  await page.clock.install();
  await page.clock.fastForward(16000);
  await expect(page.locator('#status')).toContainText('GPS perdu');
  await expect(page.locator('#speed-bottom')).toHaveText('—');
  await fix(page, -1.7, 5, await page.evaluate(() => Date.now()));
  await page.evaluate(() => window.gpsFailure({ code: 2 }));
  await expect(page.locator('#status')).toContainText('position indisponible');
  await expect(page.locator('#status')).toBeVisible();
  await expect(page.locator('#speed-bottom')).toHaveText('—');
  await expect(page.locator('#status')).toContainText('dernière position');
});

test('route follows explicit targets while personal waypoints remain visible', async ({ page }) => {
  await page.evaluate(async () => {
    const storage = await import('/js/storage.js');
    await storage.saveRoute({ id: 'loop', name: 'Boucle', createdAt: 1, visible: true,
      points: [{ latitude: 49.35, longitude: -1.7 }, { latitude: 49.35, longitude: -1.699 }, { latitude: 49.35, longitude: -1.7 }] });
    await storage.saveWaypoint({ id: 'hazard', name: 'Épave', type: 'wreck', latitude: 49.35, longitude: -1.7, createdAt: 1 });
  });
  await page.reload();
  await expect(page.locator('#track-record')).toBeEnabled();
  await expand(page); await page.locator('#menu-toggle-routes').click();
  await page.getByRole('button', { name: 'Suivre', exact: true }).click();
  await page.locator('#close-routes').click();
  await expect(page.locator('#navigation-route-name')).toContainText('Point 1/3');
  await fix(page);
  await expect(page.locator('#navigation-route-name')).toContainText('Point 2/3');
  await expect(page.locator('.waypoint-marker-wreck')).toBeVisible();
  await expect(page.locator('.is-navigation-target')).toHaveText('2');
  await page.screenshot({ path: 'test-results/navigation-mobile.png' });
  await page.locator('#navigation-previous').click();
  await expect(page.locator('#navigation-route-name')).toContainText('Point 1/3');
  await page.locator('#navigation-next').click();
  await expect(page.locator('#navigation-route-name')).toContainText('Point 2/3');
  await page.locator('#navigation-stop').click();
  await expect(page.locator('#navigation-controls')).toBeHidden();
});

test('archiving preserves timestamps and creates a separate new outing after reload', async ({ page }) => {
  await page.locator('#track-record').click();
  const now = Date.now();
  await fix(page, -1.7, 5, now);
  await fix(page, -1.6999, 5, now + 1000);
  await page.locator('#track-record').click();
  await page.locator('#track-to-route').click();
  await expect(page.locator('#track-status')).toContainText('originale conservée');
  await page.locator('#track-save').click();
  await expect(page.locator('#track-status')).toContainText('archivée');
  const tracks = await page.evaluate(async () => (await import('/js/storage.js')).loadTracks());
  expect(tracks).toHaveLength(1);
  expect(tracks[0].archived).toBe(true);
  expect(tracks[0].points.map(p => p.timestamp)).toEqual([now, now + 1000]);
  await page.reload();
  await expect(page.locator('#track-record')).toHaveAttribute('aria-label', "Démarrer l’enregistrement");
  await expand(page); await page.locator('#menu-tracks').click();
  await expect(page.locator('#track-list li')).toHaveCount(1);
  await page.screenshot({ path: 'test-results/sorties-mobile.png' });
});

test('storage failure retains current trace and GPX can export it from memory', async ({ page }) => {
  await page.locator('#track-record').click();
  await fix(page);
  await page.locator('#track-record').click();
  await page.evaluate(() => { IDBDatabase.prototype.transaction = () => { throw new Error('Simulated quota failure'); }; });
  await page.locator('#track-save').click();
  await expect(page.locator('#track-status')).toContainText('Sauvegarde indisponible');
  await expect(page.locator('#track-save')).toBeVisible();
  await page.locator('#open-gpx').click();
  await expect(page.locator('#gpx-status')).toContainText('session');
  await expect(page.locator('[data-export-kind="tracks"]')).toHaveCount(1);
  const download = page.waitForEvent('download');
  await page.locator('#export-gpx').click();
  expect((await download).suggestedFilename()).toMatch(/\.gpx$/);
});

test('pause/resume splits trace and prevents conversion across missing sections', async ({ page }) => {
  await page.locator('#track-record').click();
  const now = Date.now();
  await fix(page, -1.7, 5, now);
  await page.locator('#track-record').click();
  await page.locator('#track-record').click();
  await fix(page, -1.6999, 5, now + 1000);
  await page.locator('#track-record').click();
  await page.locator('#track-to-route').click();
  await expect(page.locator('#track-status')).toContainText('interruptions');
  await page.locator('#track-save').click();
  await expect(page.locator('#track-status')).toContainText('archivée');
  const tracks = await page.evaluate(async () => (await import('/js/storage.js')).loadTracks());
  expect(tracks[0].points.map(p => p.segment)).toEqual([0, 1]);
});

async function followTestRoute(page) {
  await page.evaluate(async () => {
    const storage = await import('/js/storage.js');
    await storage.saveRoute({ id: 'test-guidance', name: 'Essai guidage', createdAt: 1, visible: true,
      points: [{ latitude: 49.35, longitude: -1.7 }, { latitude: 49.35, longitude: -1.68 }, { latitude: 49.36, longitude: -1.68 }] });
  });
  await page.reload();
  await expect(page.locator('#track-record')).toBeEnabled();
  await expand(page); await page.locator('#menu-toggle-routes').click();
  await page.getByRole('button', { name: 'Suivre', exact: true }).click();
  await page.locator('#close-routes').click();
}

test('simulation exercises the deviation alert without recording and restores live GPS', async ({ page }) => {
  await followTestRoute(page);
  await page.locator('#track-record').click();
  await fix(page);
  await page.locator('#navigation-settings').click();
  await expect(page.locator('#simulation-start')).toBeDisabled();
  await page.locator('#close-navigation-settings').click();
  await page.locator('#track-record').click();
  const pointsBefore = await page.evaluate(async () => (await import('/js/track.js')).getCurrentTrack().points);
  await page.evaluate(() => { window.oldGpsSuccess = window.gpsSuccess; });
  await page.clock.install();
  await page.locator('#navigation-settings').click();
  await page.locator('#simulation-offset').selectOption('300');
  await page.locator('#simulation-start').click();
  await expect(page.locator('#status')).toContainText('SIMULATION');
  await expect(page.locator('#track-record')).toBeDisabled();
  await page.clock.runFor(5000);
  await expect(page.locator('#navigation-alert')).toContainText('TEST · Écart de route');
  await expect(page.locator('#navigation-alert')).toHaveClass('is-alert');
  await page.evaluate(() => window.oldGpsSuccess({ coords: { latitude: 0, longitude: 0, accuracy: 5, speed: 0, heading: 0 }, timestamp: Date.now() }));
  await expect(page.locator('#status')).toContainText('SIMULATION');
  await page.screenshot({ path: 'test-results/simulation-mobile.png' });
  await page.locator('#navigation-settings').click();
  await page.locator('#simulation-offset').selectOption('0');
  await page.locator('#close-navigation-settings').click();
  await page.clock.runFor(1000);
  await expect(page.locator('#navigation-alert')).not.toHaveClass('is-alert');
  const pointsAfter = await page.evaluate(async () => (await import('/js/track.js')).getCurrentTrack().points);
  expect(pointsAfter).toEqual(pointsBefore);
  await page.locator('#simulation-exit').click();
  await expect(page.locator('#status')).toContainText('attente de position');
  await expect(page.locator('.boat')).toHaveCount(0);
  await expect(page.locator('#track-record')).toBeEnabled();
  await fix(page);
  await expect(page.locator('#status')).toContainText('GPS actif');
  await expect(page.locator('#navigation-route-name')).toContainText('Point 2/3');
});

test('deviation threshold persists and GPS expiry suspends the alert', async ({ page }) => {
  await followTestRoute(page);
  await page.locator('#navigation-settings').click();
  await page.locator('#deviation-threshold').selectOption('50');
  await page.locator('#close-navigation-settings').click();
  await page.clock.install();
  await fix(page);
  for (let i = 0; i < 5; i++) {
    await page.clock.runFor(1000);
    await page.evaluate(() => window.gpsSuccess({ coords: {
      latitude: 49.351, longitude: -1.699, accuracy: 5, speed: 2, heading: 90
    }, timestamp: Date.now() }));
  }
  await expect(page.locator('#navigation-alert')).toHaveClass('is-alert');
  await page.clock.fastForward(16000);
  await expect(page.locator('#navigation-alert')).toContainText('suspendue');
  await expect(page.locator('#navigation-alert')).not.toHaveClass('is-alert');
  await page.reload();
  await expand(page); await page.locator('#menu-toggle-routes').click();
  await page.getByRole('button', { name: 'Suivre', exact: true }).click();
  await page.locator('#close-routes').click();
  await page.locator('#navigation-settings').click();
  await expect(page.locator('#deviation-threshold')).toHaveValue('50');
});

test('an offline simulation reaches the final target and Terminer exits simulation', async ({ context, page }) => {
  await followTestRoute(page);
  await context.setOffline(true);
  await page.clock.install();
  await page.locator('#navigation-settings').click();
  await page.locator('#simulation-speed').selectOption('200');
  await page.locator('#simulation-start').click();
  await page.clock.runFor(20000);
  await expect(page.locator('#navigation-route-name')).toContainText('Arrivée atteinte');
  await expect(page.locator('#status')).toContainText('SIMULATION · parcours terminé');
  await page.locator('#navigation-stop').click();
  await expect(page.locator('#simulation-exit')).toBeHidden();
  await expect(page.locator('#navigation-controls')).toBeHidden();
  await expect(page.locator('#status')).not.toContainText('SIMULATION');
});
