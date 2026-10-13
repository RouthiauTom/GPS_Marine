import { distanceMeters, bearingBetween, toRadians, toDegrees } from './navigation.mjs';

export function updateDeviation(state, { xte, accuracy, timestamp, threshold, usable, leg }) {
  if (!usable || !Number.isFinite(xte) || !Number.isFinite(accuracy)) return { active: false, leg };
  if (state.leg !== leg) state = { active: false, leg };
  const distance = Math.abs(xte);
  if (state.active) return { ...state, active: distance + accuracy >= threshold * 0.8 };
  if (distance - accuracy <= threshold) return { active: false, leg };
  const since = state.since ?? timestamp;
  return { active: timestamp - since >= 3000, since, leg };
}

export function destination(start, bearing, meters) {
  const angle = meters / 6371000, course = toRadians(bearing);
  const lat = toRadians(start.latitude), lon = toRadians(start.longitude);
  const endLat = Math.asin(Math.sin(lat) * Math.cos(angle) + Math.cos(lat) * Math.sin(angle) * Math.cos(course));
  const endLon = lon + Math.atan2(Math.sin(course) * Math.sin(angle) * Math.cos(lat), Math.cos(angle) - Math.sin(lat) * Math.sin(endLat));
  return { latitude: toDegrees(endLat), longitude: (toDegrees(endLon) + 540) % 360 - 180 };
}

// Each step ends at most at the next vertex, so even a fast simulation cannot skip a target.
export function createSimulator(points) {
  const path = points.map(point => ({ latitude: point.latitude, longitude: point.longitude }));
  let index = 0, along = 0;
  return {
    step(meters, offset = 0) {
      if (index >= path.length - 1) return { ...path.at(-1), course: null, done: true };
      const start = path[index], end = path[index + 1];
      const length = distanceMeters(start, end);
      const course = bearingBetween(start, end) ?? 0;
      along = Math.min(length, along + Math.max(0, meters));
      let position = destination(start, course, along);
      if (offset) position = destination(position, course - 90, offset);
      const done = along >= length && index === path.length - 2;
      if (along >= length && !offset) { index++; along = 0; }
      return { ...position, course, done: done && !offset };
    }
  };
}
