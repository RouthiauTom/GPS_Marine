const DATABASE_NAME = 'marine-gps';
const DATABASE_VERSION = 3;
const TRACK_STORE = 'tracks';
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

      request.onupgradeneeded = () => {
        const database = request.result;
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

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return databasePromise;
}

export async function saveTrack(track) {
  const database = await openDatabase();
  const transaction = database.transaction(TRACK_STORE, 'readwrite');
  transaction.objectStore(TRACK_STORE).put({ ...track, updatedAt: Date.now() });

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function loadLatestTrack() {
  const database = await openDatabase();
  const transaction = database.transaction(TRACK_STORE, 'readonly');
  const request = transaction.objectStore(TRACK_STORE).getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      const tracks = request.result;
      tracks.sort((first, second) =>
        (second.updatedAt ?? second.startedAt) - (first.updatedAt ?? first.startedAt)
      );
      resolve(tracks[0] ?? null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function loadTracks() {
  const database = await openDatabase();
  const transaction = database.transaction(TRACK_STORE, 'readonly');
  const request = transaction.objectStore(TRACK_STORE).getAll();

  return new Promise((resolve, reject) => {
    request.onsuccess = () => {
      resolve(request.result.sort((first, second) => first.startedAt - second.startedAt));
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteTrack(trackId) {
  const database = await openDatabase();
  const transaction = database.transaction(TRACK_STORE, 'readwrite');
  transaction.objectStore(TRACK_STORE).delete(trackId);

  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
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