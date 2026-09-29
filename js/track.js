let currentTrack = null;
let tracking = false;

export function startTracking() {
  if (tracking) return currentTrack;

  currentTrack = {
    id: createTrackId(),
    startedAt: Date.now(),
    stoppedAt: null,
    points: []
  };
  tracking = true;

  return currentTrack;
}

export function stopTracking() {
  if (!tracking) return currentTrack;

  tracking = false;
  currentTrack.stoppedAt = Date.now();
  return currentTrack;
}

export function addTrackPoint(position) {
  if (!tracking) return currentTrack;

  currentTrack.points.push({
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: position.timestamp,
    accuracy: position.accuracy
  });

  return currentTrack;
}

export function getCurrentTrack() {
  return currentTrack;
}

export function clearTrack() {
  const track = currentTrack;
  currentTrack = null;
  tracking = false;
  return track;
}

export function restoreTrack(track) {
  currentTrack = {
    ...track,
    stoppedAt: track.stoppedAt ?? Date.now(),
    points: Array.isArray(track.points) ? track.points : []
  };
  tracking = false;

  return currentTrack;
}

export function isTracking() {
  return tracking;
}

function createTrackId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `track-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}