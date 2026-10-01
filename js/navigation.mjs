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

  return 2 * 6371000 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
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

function segmentProjection(position, start, end) {
  const deltaLongitude = end.longitude - start.longitude;
  const deltaLatitude = end.latitude - start.latitude;

  if (deltaLongitude === 0 && deltaLatitude === 0) {
    return {
      projectedLatitude: start.latitude,
      projectedLongitude: start.longitude,
      progress: 0,
      sign: 0
    };
  }

  const dx = position.longitude - start.longitude;
  const dy = position.latitude - start.latitude;
  const segmentLengthSquare = deltaLongitude * deltaLongitude + deltaLatitude * deltaLatitude;
  const projection = Math.max(0, Math.min(1, (dx * deltaLongitude + dy * deltaLatitude) / segmentLengthSquare));
  const projectedLongitude = start.longitude + deltaLongitude * projection;
  const projectedLatitude = start.latitude + deltaLatitude * projection;
  const cross = deltaLongitude * (position.latitude - start.latitude) - deltaLatitude * (position.longitude - start.longitude);

  return {
    projectedLatitude,
    projectedLongitude,
    progress: projection,
    sign: cross >= 0 ? 1 : -1
  };
}

export function computeRouteNavigation(route, position, speedMps = 0) {
  if (!route || !position || !Array.isArray(route.points) || route.points.length < 2) {
    return {
      routeName: route?.name ?? 'Aucune route',
      xteMeters: null,
      distanceToWaypointMeters: null,
      bearingDegrees: null,
      remainingDistanceMeters: null,
      etaText: '—',
      waypointIndex: null
    };
  }

  let selectedSegmentIndex = 0;
  let selectedProjection = null;
  let shortestDistance = Number.POSITIVE_INFINITY;

  for (let index = 1; index < route.points.length; index += 1) {
    const start = route.points[index - 1];
    const end = route.points[index];
    const projection = segmentProjection(position, start, end);
    const projectedPoint = {
      latitude: projection.projectedLatitude,
      longitude: projection.projectedLongitude
    };
    const distanceToSegment = distanceMeters(position, projectedPoint);

    if (distanceToSegment < shortestDistance) {
      shortestDistance = distanceToSegment;
      selectedSegmentIndex = index;
      selectedProjection = projection;
    }
  }

  const previousPoint = route.points[selectedSegmentIndex - 1] ?? route.points[selectedSegmentIndex];
  const targetPoint = route.points[selectedSegmentIndex];
  const xteMeters = selectedProjection ? selectedProjection.sign * shortestDistance : 0;
  const distanceToWaypointMeters = distanceMeters(position, targetPoint);

  let distanceAfterTarget = 0;
  for (let index = selectedSegmentIndex; index < route.points.length - 1; index += 1) {
    distanceAfterTarget += distanceMeters(route.points[index], route.points[index + 1]);
  }

  const remainingDistanceMeters = distanceToWaypointMeters + distanceAfterTarget;
  const speedInMps = Number.isFinite(speedMps) ? speedMps : 0;
  const etaSeconds = speedInMps > 0.2 ? remainingDistanceMeters / speedInMps : null;

  return {
    routeName: route.name,
    xteMeters,
    distanceToWaypointMeters,
    bearingDegrees: bearingBetween(position, targetPoint),
    remainingDistanceMeters,
    etaText: formatEta(etaSeconds),
    waypointIndex: selectedSegmentIndex,
    previousPoint,
    targetPoint
  };
}
