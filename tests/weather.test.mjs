import test from 'node:test';
import assert from 'node:assert/strict';
import { parseForecast, forecastRows, directionText, weatherPoint } from '../js/weather-data.mjs';
const payload = {
  hourly_units: { time: 'unixtime', wind_speed_10m: 'kn', wind_gusts_10m: 'kn', wind_direction_10m: '°' },
  hourly: { time: [3600, 7200], wind_speed_10m: [0, null], wind_gusts_10m: [null, 12], wind_direction_10m: [360, 90] }
};
test('weather preserves missing values, legitimate calm and Unix UTC instants', () => {
  const forecast = parseForecast(payload, 'wind', 100);
  assert.equal(forecast.fetchedAt, 100);
  assert.equal(forecast.rows[0].time, 3600000);
  assert.equal(forecast.rows[0].wind_speed_10m, 0);
  assert.equal(forecast.rows[1].wind_speed_10m, null);
  assert.equal(directionText(360), 'N 0°');
  assert.equal(directionText(null), '—');
});
test('unexpected units and unordered or incomplete series are rejected', () => {
  assert.throws(() => parseForecast({ ...payload, hourly_units: { ...payload.hourly_units, wind_speed_10m: 'km/h' } }, 'wind'));
  assert.throws(() => parseForecast({ ...payload, hourly: { ...payload.hourly, time: [7200, 3600] } }, 'wind'));
  assert.throws(() => parseForecast({ ...payload, hourly: { ...payload.hourly, wind_gusts_10m: [] } }, 'wind'));
});
test('wind and waves join by timestamp rather than array index; expired forecasts are omitted', () => {
  const snapshot = { wind: { rows: [{ time: 3600000, wind_speed_10m: 5 }, { time: 7200000, wind_speed_10m: 10 }] },
    sea: { rows: [{ time: 7200000, wave_height: 1.5 }] } };
  const rows = forecastRows(snapshot, 3600000);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].wave_height, undefined);
  assert.equal(rows[1].wave_height, 1.5);
  assert.equal(rows[1].wind_speed_10m, 10);
  assert.deepEqual(forecastRows(snapshot, 10800000), []);
});
test('world coordinates are supported and invalid positions rejected', () => {
  assert.deepEqual(weatherPoint({ latitude: -36.12345, longitude: 179.99949 }).latitude, -36.123);
  assert.throws(() => weatherPoint({ latitude: 91, longitude: 0 }));
  assert.throws(() => weatherPoint({ latitude: 45, longitude: NaN }));
});
