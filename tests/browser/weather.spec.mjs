import { test, expect } from '@playwright/test';

function response(kind, value = 12) {
  const time = Math.floor(Date.now() / 3600000) * 3600;
  const fields = kind === 'wind' ? { wind_speed_10m: 'kn', wind_gusts_10m: 'kn', wind_direction_10m: '°' }
    : { wave_height: 'm', wave_period: 's', wave_direction: '°' };
  return { latitude: 46.6, longitude: -2.1, hourly_units: { time: 'unixtime', ...fields },
    hourly: { time: Array.from({ length: 72 }, (_, i) => time + i * 3600),
      ...Object.fromEntries(Object.keys(fields).map(field => [field, Array(72).fill(field.includes('direction') ? 270 : value)])) } };
}
async function prepare(context, page, sea = 1.5) {
  await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [] } }));
  await context.route('https://tiles.openseamap.org/**', route => route.abort());
  await context.route('https://api.open-meteo.com/**', route => route.fulfill({ json: response('wind') }));
  await context.route('https://marine-api.open-meteo.com/**', route => route.fulfill({ json: response('sea', sea) }));
  await page.goto('/');
  await expect(page.locator('#offline-status')).toContainText('Application prête');
  await page.locator('#open-weather').click();
  await expect(page.locator('#weather-wind-now')).toHaveText('12 nd');
}

test('Vendée weather is retrieved once, attributed and restored offline with its dates', async ({ context, page }) => {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.clock.install();
  await prepare(context, page);
  await expect(page.locator('#weather-location')).toContainText('Vendée');
  await expect(page.locator('#weather-wave-now')).toHaveText('1,5 m');
  await expect(page.locator('#weather-rows tr')).toHaveCount(16);
  const date = await page.locator('#weather-wind-date').textContent();
  await page.screenshot({ path: 'test-results/weather-mobile.png' });
  await page.locator('#close-weather').click();
  await context.setOffline(true);
  await page.reload();
  await page.locator('#open-weather').click();
  await expect(page.locator('#weather-status')).toContainText('Hors connexion');
  await expect(page.locator('#weather-wind-now')).toHaveText('12 nd');
  await expect(page.locator('#weather-wind-date')).toHaveText(date);
  await expect(page.locator('#weather-refresh')).toBeDisabled();
  await page.clock.fastForward(4 * 86400000);
  await expect(page.locator('#weather-valid-time')).toContainText('Aucune prévision');
  await expect(page.locator('#weather-wind-now')).toHaveText('—');
  expect(errors).toEqual([]);
});

test('null marine data is never presented as a flat sea; arbitrary map centers use their own forecasts', async ({ context, page }) => {
  await prepare(context, page, null);
  await expect(page.locator('#weather-wave-now')).toHaveText('—');
  const calls = [];
  await context.route('https://api.open-meteo.com/**', route => {
    calls.push(new URL(route.request().url()));
    return route.fulfill({ json: response('wind', 22) });
  });
  await page.locator('#weather-center').click();
  await expect(page.locator('#weather-wind-now')).toHaveText('22 nd');
  await expect(page.locator('#weather-location')).toContainText('Centre de la carte');
  expect(calls[0].searchParams.get('latitude')).toBe('49.35');
  expect(calls[0].searchParams.get('longitude')).toBe('-1.7');
  await page.locator('#close-weather').click();
  await context.setOffline(true); await page.reload();
  await page.locator('#open-weather').click();
  await expect(page.locator('#weather-location')).toContainText('Centre de la carte');
  await expect(page.locator('#weather-wind-now')).toHaveText('22 nd');
});

test('partial refresh retains older marine data and its original date, without frequent retries', async ({ context, page }) => {
  await prepare(context, page);
  const previous = await page.locator('#weather-sea-date').textContent();
  let windRequests = 0;
  await context.route('https://api.open-meteo.com/**', route => { windRequests++; return route.fulfill({ json: response('wind', 20) }); });
  await context.route('https://marine-api.open-meteo.com/**', route => route.fulfill({ status: 503 }));
  await page.clock.install(); await page.clock.fastForward(61000);
  await page.locator('#weather-refresh').click();
  await expect(page.locator('#weather-wind-now')).toHaveText('20 nd');
  await expect(page.locator('#weather-status')).toContainText('Vagues non actualisé');
  await expect(page.locator('#weather-sea-date')).toHaveText(previous);
  await page.locator('#weather-refresh').click();
  await expect(page.locator('#weather-status')).toContainText('Patientez');
  expect(windRequests).toBe(1);
});

test('a late response cannot replace the newly selected location', async ({ context, page }) => {
  await prepare(context, page);
  await context.route('https://api.open-meteo.com/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 500));
    await route.fulfill({ json: response('wind', 30) });
  });
  await page.locator('#weather-center').click();
  await page.locator('#weather-vendee').click();
  await expect(page.locator('#weather-wind-now')).toHaveText('12 nd');
  await page.waitForTimeout(650);
  await expect(page.locator('#weather-location')).toContainText('Vendée');
  await expect(page.locator('#weather-wind-now')).toHaveText('12 nd');
});
