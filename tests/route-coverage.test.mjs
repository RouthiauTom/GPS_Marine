import test from 'node:test';
import assert from 'node:assert/strict';
import { routeCoverage } from '../js/route-coverage.mjs';
const point = longitude => ({ latitude: 46, longitude });
const zone = (west, east, status = 'ready') => ({ status, bounds: [west, 45, east, 47] });
test('covered endpoints do not conceal a gap between downloaded areas', () => {
  const result = routeCoverage([point(0), point(4)], [zone(-1, 1), zone(3, 5)]);
  assert.deepEqual(result.missing, [1]);
  assert.deepEqual(result.portions.map(p => p.covered), [true, false, true]);
  assert.equal(result.portions[1].a[0], 1);
  assert.equal(result.portions[1].b[0], 3);
});
test('adjacent and overlapping regions jointly cover a reversed route', () => {
  assert.deepEqual(routeCoverage([point(4), point(0)], [zone(-1, 2), zone(2, 5), zone(1, 3)]).missing, []);
});
test('incomplete downloads do not count and repeated points are handled', () => {
  assert.deepEqual(routeCoverage([point(0), point(0), point(1)], [zone(-1, 2, 'downloading')]).missing, [1, 2]);
  assert.deepEqual(routeCoverage([point(0), point(0)], [zone(-1, 2)]).missing, []);
});
test('dateline crossings and invalid routes are explicitly unsupported', () => {
  assert.ok(routeCoverage([point(179), point(-179)], []).error);
  assert.ok(routeCoverage([point(0)], []).error);
});
