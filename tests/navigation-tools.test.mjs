import test from 'node:test';
import assert from 'node:assert/strict';
import { updateDeviation, createSimulator, destination } from '../js/navigation-tools.mjs';
import { distanceMeters } from '../js/navigation.mjs';

test('deviation needs sustained reliable positions, accounts for accuracy, and clears with hysteresis', () => {
  const fix = { xte: 150, accuracy: 5, timestamp: 0, threshold: 100, usable: true, leg: 'a:1' };
  let state = updateDeviation({}, fix);
  assert.equal(state.active, false);
  state = updateDeviation(state, { ...fix, timestamp: 2999 });
  assert.equal(state.active, false);
  state = updateDeviation(state, { ...fix, timestamp: 3000 });
  assert.equal(state.active, true);
  state = updateDeviation(state, { ...fix, xte: -90, timestamp: 4000 });
  assert.equal(state.active, true);
  assert.equal(updateDeviation(state, { ...fix, xte: 70 }).active, false);
  assert.equal(updateDeviation(state, { ...fix, usable: false }).active, false);
  assert.equal(updateDeviation(state, { ...fix, leg: 'a:2' }).active, false);
  assert.equal(updateDeviation({}, { ...fix, xte: 120, accuracy: 25 }).since, undefined);
});

test('simulation stops at every vertex, including repeated points, and crosses the date line', () => {
  const first = { latitude: 1, longitude: 179.999 };
  const second = destination(first, 90, 500);
  const last = destination(second, 0, 500);
  const sim = createSimulator([first, second, second, last]);
  assert.ok(second.longitude < 0);
  const one = sim.step(10000);
  assert.ok(distanceMeters(one, second) < 0.01);
  assert.equal(one.done, false);
  assert.equal(sim.step(10000).done, false);
  const end = sim.step(10000);
  assert.ok(distanceMeters(end, last) < 0.01);
  assert.equal(end.done, true);
});

test('simulated offset holds the current vertex until the boat returns to the route', () => {
  const a = { latitude: 49, longitude: -1 };
  const b = destination(a, 90, 100);
  const sim = createSimulator([a, b]);
  const off = sim.step(1000, 300);
  assert.equal(off.done, false);
  assert.ok(Math.abs(distanceMeters(off, b) - 300) < 0.01);
  const back = sim.step(1, 0);
  assert.equal(back.done, true);
  assert.ok(distanceMeters(back, b) < 0.01);
});
