import { distanceMeters, bearingBetween } from './navigation.mjs';

export const GPS_MAX_AGE_MS = 15000;
export const GPS_MAX_ACCURACY_METERS = 50;
let watchId = null;
let previousFix = null;
let motionAnchor = null;
let watchGeneration = 0;

export function isFreshPosition(position, now = Date.now()) {
  return Boolean(position && Number.isFinite(position.timestamp) &&
    now - position.timestamp >= -2000 && now - position.timestamp <= GPS_MAX_AGE_MS);
}

export function isUsablePosition(position, now = Date.now()) {
  return isFreshPosition(position, now) && Number.isFinite(position.accuracy) &&
    position.accuracy >= 0 && position.accuracy <= GPS_MAX_ACCURACY_METERS;
}

export function startWatching(onPosition, onError) {
  stopWatching();
  const generation = watchGeneration;
  if (!navigator.geolocation) {
    onError({ code: 0 });
    return null;
  }
  watchId = navigator.geolocation.watchPosition(position => {
    if (generation !== watchGeneration) return;
    const fix = normalizePosition(position, motionAnchor);
    if (!fix || !isFreshPosition(fix)) {
      onError({ code: 2 });
      return;
    }
    if (previousFix && fix.timestamp <= previousFix.timestamp) return;
    if (previousFix && distanceMeters(previousFix, fix) >
      100 * (fix.timestamp - previousFix.timestamp) / 1000 + previousFix.accuracy + fix.accuracy) {
      onError({ code: 2 });
      return;
    }
    if (isUsablePosition(fix)) {
      if (!motionAnchor || fix.timestamp - motionAnchor.timestamp > GPS_MAX_AGE_MS ||
          calculateSpeed(motionAnchor, fix) !== null) motionAnchor = fix;
      previousFix = fix;
    }
    onPosition(fix);
  }, error => { if (generation === watchGeneration) onError(error); }, { enableHighAccuracy: true, maximumAge: 2000, timeout: GPS_MAX_AGE_MS });
  return watchId;
}

export function stopWatching() {
  watchGeneration++;
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  previousFix = null;
  motionAnchor = null;
}

function reliableDisplacement(previous, current) {
  if (!previous) return false;
  const elapsed = current.timestamp - previous.timestamp;
  const uncertainty = Math.max(3, previous.accuracy ?? 0, current.accuracy ?? 0);
  return elapsed > 0 && elapsed <= GPS_MAX_AGE_MS && distanceMeters(previous, current) > uncertainty;
}

export function calculateSpeed(previous, current) {
  if (!reliableDisplacement(previous, current)) return null;
  return distanceMeters(previous, current) / ((current.timestamp - previous.timestamp) / 1000);
}

export function calculateCourse(previous, current) {
  return reliableDisplacement(previous, current) ? bearingBetween(previous, current) : null;
}

export function normalizePosition(position, previous) {
  const { latitude, longitude, speed, heading, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 ||
      !Number.isFinite(longitude) || Math.abs(longitude) > 180 ||
      !Number.isFinite(accuracy) || accuracy < 0) return null;
  const fix = {
    latitude, longitude, accuracy, timestamp: position.timestamp,
    speed: Number.isFinite(speed) && speed >= 0 ? speed : null,
    course: Number.isFinite(heading) && heading >= 0 && heading < 360 ? heading : null
  };
  if (fix.speed === null) fix.speed = calculateSpeed(previous, fix);
  if (fix.course === null) fix.course = calculateCourse(previous, fix);
  return fix;
}
