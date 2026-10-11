import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRouteNavigation, crossTrackMeters, advanceNavigation, distanceMeters, bearingBetween } from '../js/navigation.mjs';
const point = (latitude, longitude) => ({ latitude, longitude, accuracy: 5 });
const route = { name: 'Boucle', points: [point(49, -2), point(49, -1), point(50, -1), point(49, -2)] };

test('a loop near the finish does not skip the explicitly selected waypoint', () => {
  const result = computeRouteNavigation(route, point(49, -1.999), 2, 1);
  assert.equal(result.waypointIndex, 1);
  assert.ok(result.distanceToWaypointMeters > 70000);
});
test('first target has no cross-track leg and remaining distance includes the route', () => {
  const result = computeRouteNavigation(route, point(49, -2.01), 2);
  assert.equal(result.xteMeters, null);
  assert.ok(result.remainingDistanceMeters > result.distanceToWaypointMeters);
  assert.notEqual(result.etaText, '—');
});
test('arrival advances one point and never rewinds or skips on poor accuracy', () => {
  assert.deepEqual(advanceNavigation(route, point(49, -1), { targetIndex: 1, completed: false }), { targetIndex: 2, completed: false });
  const state = { targetIndex: 1, completed: false };
  assert.equal(advanceNavigation(route, { ...point(49, -1), accuracy: 100 }, state), state);
  assert.equal(advanceNavigation(route, point(49, -2), state), state);
  assert.deepEqual(advanceNavigation(route, point(49, -2), { targetIndex: 3, completed: false }), { targetIndex: 3, completed: true });
});
test('cross track is geodesic, signed, and not distance to an endpoint', () => {
  assert.ok(Math.abs(crossTrackMeters(point(0.001, .5), point(0, 0), point(0, 1)) - 111.195) < .01);
  assert.ok(crossTrackMeters(point(-.001, .5), point(0, 0), point(0, 1)) < 0);
  assert.ok(Math.abs(crossTrackMeters(point(0, 2), point(0, 0), point(0, 1))) < 1e-8);
  // A meridian has an unambiguous great-circle plane even at high latitude.
  assert.ok(Math.abs(crossTrackMeters(point(60, .001), point(59, 0), point(61, 0)) + 55.597) < .01);
});
test('identical points and antimeridian remain finite', () => {
  assert.equal(crossTrackMeters(point(49, -1), point(49, -2), point(49, -2)), 0);
  assert.equal(bearingBetween(point(0, 0), point(0, 0)), null);
  assert.ok(distanceMeters(point(0, 179.9), point(0, -179.9)) < 23000);
  assert.ok(Number.isFinite(distanceMeters(point(0, 0), point(0, 180))));
});
