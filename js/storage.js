const DATABASE_NAME = 'marine-gps';
const DATABASE_VERSION = 4;
const TRACK_STORE = 'tracks';
const CHUNK_STORE = 'track-chunks';
const CHUNK_SIZE = 256;
const WAYPOINT_STORE = 'waypoints';
const ROUTE_STORE = 'routes';

let databasePromise;

function openDatabase() {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('IndexedDB is not available'));
  }

  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      let blocked = false;
      request.onblocked = () => {
        blocked = true;
        databasePromise = null;
        reject(new Error('Fermez les autres onglets Marine GPS pour mettre à jour le stockage.'));
      };

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CHUNK_STORE)) {
          database.createObjectStore(CHUNK_STORE, { keyPath: ['trackId', 'index'] });
        }
        if (!database.objectStoreNames.contains(TRACK_STORE)) {
          database.createObjectStore(TRACK_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(WAYPOINT_STORE)) {
          database.createObjectStore(WAYPOINT_STORE, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(ROUTE_STORE)) {
          database.createObjectStore(ROUTE_STORE, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => {
        const database = request.result;
        if (blocked) { database.close(); return; }
        database.onversionchange = () => { database.close(); databasePromise = null; };
        resolve(database);
      };
      request.onerror = () => { databasePromise = null; reject(request.error); };
    });
  }

  return databasePromise;
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveTrack(track) {
  // Snapshot before awaiting: callers may append points during database opening.
  const snapshot = { ...track, points: [...track.points] };
  const database = await openDatabase();
  const transaction = database.transaction([TRACK_STORE, CHUNK_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const tracks = transaction.objectStore(TRACK_STORE);
  const chunks = transaction.objectStore(CHUNK_STORE);
  const request = tracks.get(snapshot.id);
  request.onsuccess = () => {
    const previousCount = request.result?.chunked ? request.result.pointCount : 0;
    const firstChunk = Math.floor(Math.min(previousCount, snapshot.points.length) / CHUNK_SIZE);
    for (let index = firstChunk; index * CHUNK_SIZE < snapshot.points.length; index += 1) {
      chunks.put({ trackId: snapshot.id, index,
        points: snapshot.points.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE) });
    }
    const { points, ...metadata } = snapshot;
    tracks.put({ ...metadata, chunked: true, pointCount: points.length, updatedAt: Date.now() });
  };
  return done;
}

export async function loadLatestTrack() {
  const tracks = (await loadTracks()).filter(track => !track.archived);
  tracks.sort((first, second) =>
    (second.updatedAt ?? second.startedAt) - (first.updatedAt ?? first.startedAt));
  return tracks[0] ?? null;
}

export async function loadTracks() {
  const database = await openDatabase();
  const transaction = database.transaction([TRACK_STORE, CHUNK_STORE], 'readonly');
  const tracksRequest = transaction.objectStore(TRACK_STORE).getAll();
  const chunksRequest = transaction.objectStore(CHUNK_STORE).getAll();
  await transactionDone(transaction);
  const pointsByTrack = new Map();
  for (const chunk of chunksRequest.result) {
    if (!pointsByTrack.has(chunk.trackId)) pointsByTrack.set(chunk.trackId, []);
    pointsByTrack.get(chunk.trackId).push(...chunk.points);
  }
  return tracksRequest.result.map(track => ({ ...track,
    points: track.chunked ? (pointsByTrack.get(track.id) ?? []).slice(0, track.pointCount) : track.points
  })).sort((first, second) => first.startedAt - second.startedAt);
}

export async function deleteTrack(trackId) {
  const database = await openDatabase();
  const transaction = database.transaction([TRACK_STORE, CHUNK_STORE], 'readwrite');
  transaction.objectStore(TRACK_STORE).delete(trackId);
  transaction.objectStore(CHUNK_STORE).delete(IDBKeyRange.bound([trackId, 0], [trackId, Infinity]));
  return transactionDone(transaction);
}

export async function saveWaypoint(waypoint) {
  const database = await openDatabase();
  const transaction = database.transaction(WAYPOINT_STORE, 'readwrite');
  transaction.objectStore(WAYPOINT_STORE).put(waypoint);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadWaypoints() {
  const database = await openDatabase();
  const transaction = database.transaction(WAYPOINT_STORE, 'readonly');
  const request = transaction.objectStore(WAYPOINT_STORE).getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result.sort((first, second) => first.createdAt - second.createdAt));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteWaypoint(waypointId) {
  const database = await openDatabase();
  const transaction = database.transaction(WAYPOINT_STORE, 'readwrite');
  transaction.objectStore(WAYPOINT_STORE).delete(waypointId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveRoute(route) {
  const database = await openDatabase();
  const transaction = database.transaction(ROUTE_STORE, 'readwrite');
  transaction.objectStore(ROUTE_STORE).put(route);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadRoutes() {
  const database = await openDatabase();
  const transaction = database.transaction(ROUTE_STORE, 'readonly');
  const request = transaction.objectStore(ROUTE_STORE).getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result.sort((first, second) => first.createdAt - second.createdAt));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteRoute(routeId) {
  const database = await openDatabase();
  const transaction = database.transaction(ROUTE_STORE, 'readwrite');
  transaction.objectStore(ROUTE_STORE).delete(routeId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveGpxData(data) {
  const database = await openDatabase();
  const transaction = database.transaction(
    [WAYPOINT_STORE, ROUTE_STORE, TRACK_STORE],
    'readwrite'
  );
  const waypoints = transaction.objectStore(WAYPOINT_STORE);
  const routes = transaction.objectStore(ROUTE_STORE);
  const tracks = transaction.objectStore(TRACK_STORE);

  data.waypoints.forEach(waypoint => waypoints.put(waypoint));
  data.routes.forEach(route => routes.put(route));
  data.tracks.forEach(track => tracks.put({ ...track, updatedAt: Date.now() }));

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}