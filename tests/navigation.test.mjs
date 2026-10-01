import test from 'node:test';
import assert from 'node:assert/strict';

import { computeRouteNavigation, toDegrees, toRadians } from '../js/navigation.mjs';

test('bearing helpers produce compact direction values', () => {
  assert.equal(toDegrees(Math.PI), 180);
  assert.equal(toRadians(180), Math.PI);
});

test('computeRouteNavigation returns waypoint and ETA values for an active route', () => {
  const route = {
    name: 'Route test',
    points: [
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 1, longitude: 1 }
    ]
  };

  const result = computeRouteNavigation(route, { latitude: 0.08, longitude: 0.52 }, 1.2);

  assert.ok(result.xteMeters >= 0);
  assert.ok(Number.isFinite(result.distanceToWaypointMeters));
  assert.ok(Number.isFinite(result.bearingDegrees));
  assert.ok(result.bearingDegrees >= 0 && result.bearingDegrees <= 360);
  assert.ok(result.remainingDistanceMeters >= 0);
  assert.match(result.etaText, /\d/);
});
