let waypoints = [];

export function setWaypoints(savedWaypoints) {
  waypoints = [...savedWaypoints].sort((first, second) => first.createdAt - second.createdAt);
  return getWaypoints();
}

export function createWaypoint(position, name) {
  const waypoint = {
    id: createWaypointId(),
    name: name.trim(),
    latitude: position.latitude,
    longitude: position.longitude,
    createdAt: Date.now()
  };

  waypoints.push(waypoint);
  return waypoint;
}

export function getWaypoints() {
  return [...waypoints];
}

export function removeWaypoint(waypointId) {
  const waypoint = waypoints.find(item => item.id === waypointId);
  waypoints = waypoints.filter(item => item.id !== waypointId);
  return waypoint ?? null;
}

function createWaypointId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `waypoint-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}