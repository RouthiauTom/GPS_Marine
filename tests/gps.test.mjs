import test from 'node:test';
import assert from 'node:assert/strict';
import { isFreshPosition, isUsablePosition, calculateSpeed, calculateCourse, normalizePosition } from '../js/gps.js';
const previous = { latitude: 49, longitude: -2, timestamp: 1000, accuracy: 10 };
test('expired and inaccurate fixes cannot drive navigation', () => {
  assert.equal(isFreshPosition(previous, 17000), false);
  assert.equal(isUsablePosition(previous, 2000), true);
  assert.equal(isUsablePosition({ ...previous, accuracy: 100 }, 2000), false);
  assert.equal(isFreshPosition({ ...previous, timestamp: NaN }), false);
});
test('jitter does not create a calculated speed or direction', () => {
  const current = { ...previous, latitude: 49.00001, timestamp: 2000 };
  assert.equal(calculateSpeed(previous, current), null);
  assert.equal(calculateCourse(previous, current), null);
  assert.ok(calculateSpeed(previous, { ...current, latitude: 49.001 }) > 0);
});
test('valid native speed is retained, invalid coordinates rejected', () => {
  assert.equal(normalizePosition({ coords: { ...previous, speed: 2, heading: 90 }, timestamp: 2000 }).speed, 2);
  assert.equal(normalizePosition({ coords: { ...previous, latitude: 91 }, timestamp: 2000 }), null);
});
