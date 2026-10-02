const GPX_NAMESPACE = 'http://www.topografix.com/GPX/1/1';

export function parseGpx(xmlText) {
  const document = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (document.getElementsByTagName('parsererror').length > 0 ||
      document.documentElement.localName !== 'gpx') {
    throw new Error('Le fichier sélectionné n’est pas un GPX valide.');
  }

  return {
    waypoints: elementsByName(document.documentElement, 'wpt').map((element, index) => {
      const point = parsePoint(element);
      return {
        id: createId('waypoint'),
        name: childText(element, 'name') || `Waypoint ${index + 1}`,
        type: childText(element, 'type') || 'other',
        latitude: point.latitude,
        longitude: point.longitude,
        createdAt: point.timestamp ?? Date.now()
      };
    }),
    routes: elementsByName(document.documentElement, 'rte').map((element, index) => {
      const points = childElementsByName(element, 'rtept').map(parsePoint);
      if (points.length < 2) {
        throw new Error(`La route ${index + 1} contient moins de deux points.`);
      }

      return {
        id: createId('route'),
        name: childText(element, 'name') || `Route ${index + 1}`,
        createdAt: Date.now(),
        visible: true,
        points: points.map(({ latitude, longitude }) => ({ latitude, longitude }))
      };
    }),
    tracks: elementsByName(document.documentElement, 'trk').map((element, index) => {
      const segments = childElementsByName(element, 'trkseg');
      const sourceSegments = segments.length > 0
        ? segments
        : [element];
      const points = sourceSegments.flatMap((segment, segmentIndex) =>
        childElementsByName(segment, 'trkpt').map(pointElement => ({
          ...parsePoint(pointElement),
          segment: segmentIndex
        }))
      );
      const timestamps = points
        .map(point => point.timestamp)
        .filter(Number.isFinite);

      return {
        id: createId('track'),
        name: childText(element, 'name') || `Trace ${index + 1}`,
        startedAt: timestamps[0] ?? Date.now(),
        stoppedAt: timestamps.at(-1) ?? Date.now(),
        points
      };
    }).filter(track => track.points.length > 0)
  };
}

export function createGpx(data) {
  const document = documentForGpx();
  const root = document.documentElement;
  root.setAttribute('version', '1.1');
  root.setAttribute('creator', 'Marine GPS');

  data.waypoints.forEach(waypoint => {
    const element = appendPoint(document, root, 'wpt', waypoint);
    appendText(document, element, 'name', waypoint.name);
    appendText(document, element, 'type', waypoint.type || 'other');
    appendTime(document, element, waypoint.createdAt);
  });

  data.routes.forEach(route => {
    const element = document.createElementNS(GPX_NAMESPACE, 'rte');
    root.append(element);
    appendText(document, element, 'name', route.name);
    route.points.forEach(point => appendPoint(document, element, 'rtept', point));
  });

  data.tracks.forEach(track => {
    const element = document.createElementNS(GPX_NAMESPACE, 'trk');
    root.append(element);
    appendText(document, element, 'name', track.name || 'Trace');

    const segments = new Map();
    track.points.forEach(point => {
      const segmentIndex = Number.isInteger(point.segment) ? point.segment : 0;
      if (!segments.has(segmentIndex)) segments.set(segmentIndex, []);
      segments.get(segmentIndex).push(point);
    });

    segments.forEach(points => {
      const segment = document.createElementNS(GPX_NAMESPACE, 'trkseg');
      element.append(segment);
      points.forEach(point => {
        const trackPoint = appendPoint(document, segment, 'trkpt', point);
        appendTime(document, trackPoint, point.timestamp);
      });
    });
  });

  return new XMLSerializer().serializeToString(document);
}

function documentForGpx() {
  return document.implementation.createDocument(GPX_NAMESPACE, 'gpx');
}

function appendPoint(document, parent, name, point) {
  const element = document.createElementNS(GPX_NAMESPACE, name);
  element.setAttribute('lat', String(point.latitude));
  element.setAttribute('lon', String(point.longitude));
  parent.append(element);
  return element;
}

function appendText(document, parent, name, value) {
  if (!value) return;
  const element = document.createElementNS(GPX_NAMESPACE, name);
  element.textContent = value;
  parent.append(element);
}

function appendTime(document, parent, timestamp) {
  if (!Number.isFinite(timestamp)) return;
  appendText(document, parent, 'time', new Date(timestamp).toISOString());
}

function parsePoint(element) {
  const latitude = Number(element.getAttribute('lat'));
  const longitude = Number(element.getAttribute('lon'));
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180 ||
      element.getAttribute('lat') === null || element.getAttribute('lon') === null) {
    throw new Error('Le fichier contient des coordonnées GPS invalides.');
  }

  return {
    latitude,
    longitude,
    timestamp: parseTimestamp(childText(element, 'time'))
  };
}

function parseTimestamp(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function childText(element, name) {
  return childElementsByName(element, name)[0]?.textContent.trim() ?? '';
}

function childElementsByName(element, name) {
  return Array.from(element.children).filter(child => child.localName === name);
}

function elementsByName(element, name) {
  return Array.from(element.getElementsByTagName('*'))
    .filter(child => child.localName === name);
}

function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}