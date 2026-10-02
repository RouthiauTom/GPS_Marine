let waypoints = [];

export const WAYPOINT_TYPES = [
  { id: 'buoy-port', label: 'Bouée bâbord', marker: 'B' },
  { id: 'buoy-starboard', label: 'Bouée tribord', marker: 'T' },
  { id: 'cardinal-north', label: 'Cardinale Nord', marker: 'N' },
  { id: 'cardinal-south', label: 'Cardinale Sud', marker: 'S' },
  { id: 'cardinal-east', label: 'Cardinale Est', marker: 'E' },
  { id: 'cardinal-west', label: 'Cardinale Ouest', marker: 'O' },
  { id: 'wreck', label: 'Épave', marker: '×' },
  { id: 'port', label: 'Port', marker: '⚓' },
  { id: 'fishing-zone', label: 'Zone de pêche', marker: 'P' },
  { id: 'other', label: 'Autre repère', marker: '•' }
];

export function getWaypointType(typeId) {
  return WAYPOINT_TYPES.find(type => type.id === typeId) ?? WAYPOINT_TYPES.at(-1);
}

export function setWaypoints(savedWaypoints) {
  waypoints = [...savedWaypoints].sort((first, second) => first.createdAt - second.createdAt);
  return getWaypoints();
}

export function createWaypoint(position, name, type = 'other') {
  const waypoint = {
    id: createWaypointId(),
    name: name.trim(),
    type: getWaypointType(type).id,
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