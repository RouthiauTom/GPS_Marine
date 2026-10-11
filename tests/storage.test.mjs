import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { saveTrack, loadTracks, loadLatestTrack, deleteTrack, saveGpxData } from '../js/storage.js';
const open = version => new Promise((resolve, reject) => {
  const request = indexedDB.open('marine-gps', version);
  request.onupgradeneeded = () => {
    for (const name of ['tracks', 'routes', 'waypoints']) request.result.createObjectStore(name, { keyPath: 'id' });
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const complete = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = resolve;
  transaction.onabort = () => reject(transaction.error);
});
const point = i => ({ latitude: 49, longitude: -2 + i * .00001, accuracy: 5, timestamp: 1000 + i * 1000, segment: 0 });

test('version 3 inline traces survive migration and append across chunk boundaries', async () => {
  const old = await open(3);
  const transaction = old.transaction('tracks', 'readwrite');
  const legacy = { id: 'legacy', startedAt: 1000, points: [point(0)] };
  transaction.objectStore('tracks').put(legacy);
  await complete(transaction); old.close();
  assert.deepEqual((await loadLatestTrack()).points, legacy.points);
  const track = { ...legacy, points: Array.from({ length: 257 }, (_, i) => point(i)) };
  await saveTrack(track);
  track.points.push(point(257)); await saveTrack(track);
  assert.deepEqual((await loadLatestTrack()).points, track.points);
  const db = await open(4);
  const read = db.transaction(['tracks', 'track-chunks']);
  const meta = read.objectStore('tracks').get('legacy');
  const chunks = read.objectStore('track-chunks').getAll();
  await complete(read);
  assert.equal(meta.result.points, undefined);
  assert.equal(meta.result.pointCount, 258);
  assert.equal(chunks.result.length, 2);
  assert.equal(chunks.result[0].points.length, 256);
  assert.equal(chunks.result[1].points.length, 2);
  db.close();
});

test('archiving retains the full original but excludes it from automatic resume', async () => {
  const track = await loadLatestTrack();
  await saveTrack({ ...track, archived: true });
  assert.equal(await loadLatestTrack(), null);
  assert.equal((await loadTracks())[0].points.length, 258);
  await saveGpxData({ waypoints: [], routes: [], tracks: [{ id: 'imported', startedAt: 2000, archived: true, points: [{ ...point(0), segment: 2 }] }] });
  assert.equal(await loadLatestTrack(), null);
  assert.equal((await loadTracks())[1].points[0].segment, 2);
});

test('deleting a track also deletes its chunks and leaves other tracks intact', async () => {
  await deleteTrack('legacy');
  assert.deepEqual((await loadTracks()).map(t => t.id), ['imported']);
  const db = await open(4);
  const read = db.transaction('track-chunks');
  const chunks = read.objectStore('track-chunks').getAll(); await complete(read);
  assert.equal(chunks.result.length, 0); db.close();
});

test('save takes a snapshot before an asynchronous database write', async () => {
  const track = { id: 'snapshot', startedAt: 3000, points: [point(0)] };
  const saving = saveTrack(track);
  track.points.push(point(1));
  await saving;
  assert.equal((await loadLatestTrack()).points.length, 1);
});
