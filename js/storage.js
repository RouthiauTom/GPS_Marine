const DATABASE_NAME = 'marine-gps';
const DATABASE_VERSION = 1;
const TRACK_STORE = 'tracks';

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