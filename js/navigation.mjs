export function toRadians(value) {
  return value * Math.PI / 180;
}

export function toDegrees(value) {
  return value * 180 / Math.PI;
}

export function distanceMeters(first, second) {
  if (!first || !second) return Number.POSITIVE_INFINITY;

  const latitude1 = toRadians(first.latitude);
  const latitude2 = toRadians(second.latitude);
  const deltaLatitude = toRadians(second.latitude - first.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);

  const value =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(deltaLongitude / 2) ** 2;

  return 2 * 6371000 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

export function bearingBetween(first, second) {
  if (!first || !second) return null;

  const latitude1 = toRadians(first.latitude);
  const latitude2 = toRadians(second.latitude);
  const deltaLongitude = toRadians(second.longitude - first.longitude);

  const y = Math.sin(deltaLongitude) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(deltaLongitude);

  if (x === 0 && y === 0) return null;

  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
}

export function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';

  const wholeSeconds = Math.max(1, Math.round(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const secs = wholeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }

  if (minutes > 0) {
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(secs).padStart(2, '0')}s`;
}

// Signed geodesic cross-track distance: positive to port of the active leg.
export function crossTrackMeters(position, start, end) {
  const legBearing = bearingBetween(start, end);
  const positionBearing = bearingBetween(start, position);
  if (legBearing === null || positionBearing === null) return 0;
  const angularDistance = distanceMeters(start, position) / 6371000;
  const value = Math.sin(angularDistance) * Math.sin(toRadians(positionBearing - legBearing));
  return -Math.asin(Math.max(-1, Math.min(1, value))) * 6371000;
}

export const ARRIVAL_RADIUS_METERS = 30;

export function advanceNavigation(route, position, state, radius = ARRIVAL_RADIUS_METERS) {
  if (!route?.points?.length || !position || state.completed) return state;
  // Poor fixes must never trigger arrival. Move at most one step per accepted fix.
  if (!Number.isFinite(position.accuracy) || position.accuracy > radius) return state;
  const target = route.points[state.targetIndex];
  if (!target || distanceMeters(position, target) > radius) return state;
  if (state.targetIndex === route.points.length - 1) return { ...state, completed: true };
  return { ...state, targetIndex: state.targetIndex + 1 };
}

export function computeRouteNavigation(route, position, speedMps = 0, targetIndex = 0) {
  const targetPoint = route?.points?.[targetIndex];
  if (!targetPoint || !position) {
    return {
      routeName: route?.name ?? 'Aucune route', xteMeters: null,
      distanceToWaypointMeters: null, bearingDegrees: null,
      remainingDistanceMeters: null, etaText: '—', waypointIndex: null
    };
  }
  const previousPoint = route.points[targetIndex - 1] ?? null;
  const distanceToWaypointMeters = distanceMeters(position, targetPoint);
  let remainingDistanceMeters = distanceToWaypointMeters;
  for (let index = targetIndex; index < route.points.length - 1; index += 1) {
    remainingDistanceMeters += distanceMeters(route.points[index], route.points[index + 1]);
  }
  return {
    routeName: route.name,
    xteMeters: previousPoint ? crossTrackMeters(position, previousPoint, targetPoint) : null,
    distanceToWaypointMeters,
    bearingDegrees: bearingBetween(position, targetPoint),
    remainingDistanceMeters,
    etaText: formatEta(speedMps > 0.2 ? remainingDistanceMeters / speedMps : null),
    waypointIndex: targetIndex,
    previousPoint,
    targetPoint
  };
}
