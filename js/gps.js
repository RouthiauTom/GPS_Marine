let watchId = null;
let previousFix = null;

export function startWatching(onPosition, onError) {
  if (!navigator.geolocation) {
    onError({ code: 0 });
    return null;
  }

  watchId = navigator.geolocation.watchPosition(
    position => {
      const fix = normalizePosition(position, previousFix);
      previousFix = fix;
      onPosition(fix);
    },
    onError,
    {
      enableHighAccuracy: true,
      maximumAge: 2000,
      timeout: 15000
    }
  );

  return watchId;
}

export function stopWatching() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    previousFix = null;
  }
}

export function calculateSpeed(previous, current) {
  if (!previous) return null;

  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  if (elapsedSeconds <= 0) return null;

  return distanceMeters(previous, current) / elapsedSeconds;
}

export function calculateCourse(previous, current) {
  if (!previous) return null;

  const latitude1 = toRadians(previous.latitude);
  const latitude2 = toRadians(current.latitude);
  const longitudeDifference = toRadians(current.longitude - previous.longitude);

  const y = Math.sin(longitudeDifference) * Math.cos(latitude2);
  const x =
    Math.cos(latitude1) * Math.sin(latitude2) -
    Math.sin(latitude1) * Math.cos(latitude2) * Math.cos(longitudeDifference);

  if (x === 0 && y === 0) return null;

  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function normalizePosition(position, previous) {
  const { latitude, longitude, speed, heading, accuracy } = position.coords;
  const fix = {
    latitude,
    longitude,
    speed: Number.isFinite(speed) ? speed : null,
    course: Number.isFinite(heading) ? heading : null,
    accuracy,
    timestamp: position.timestamp
  };

  if (fix.speed === null) fix.speed = calculateSpeed(previous, fix);
  if (fix.course === null) fix.course = calculateCourse(previous, fix);

  return fix;
}

function distanceMeters(point1, point2) {
  const latitude1 = toRadians(point1.latitude);
  const latitude2 = toRadians(point2.latitude);
  const latitudeDifference = latitude2 - latitude1;
  const longitudeDifference = toRadians(point2.longitude - point1.longitude);

  const value =
    Math.sin(latitudeDifference / 2) ** 2 +
    Math.cos(latitude1) * Math.cos(latitude2) *
    Math.sin(longitudeDifference / 2) ** 2;

  return 2 * 6371000 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}