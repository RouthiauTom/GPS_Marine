let currentTrack = null;
let tracking = false;
let newSegment = false;

export function startTracking() {
  if (tracking) return currentTrack;

  if (currentTrack) {
    currentTrack.stoppedAt = null;
    newSegment = true;
    tracking = true;
    return currentTrack;
  }

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

  const previous = currentTrack.points.at(-1);
  if (previous && position.timestamp <= previous.timestamp) return currentTrack;
  const segment = (previous?.segment ?? 0) + (previous &&
    (newSegment || position.timestamp - previous.timestamp > 15000) ? 1 : 0);
  newSegment = false;
  currentTrack.points.push({
    segment,
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
  newSegment = false;
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