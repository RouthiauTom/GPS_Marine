import test from 'node:test';
import assert from 'node:assert/strict';
import { startTracking, stopTracking, addTrackPoint, clearTrack, restoreTrack } from '../js/track.js';
const fix = timestamp => ({ latitude: 49, longitude: -2, accuracy: 5, timestamp });
test('pause, resume and GPS gaps create separate segments without dropping points', () => {
  clearTrack(); startTracking();
  addTrackPoint(fix(1000)); addTrackPoint(fix(2000)); stopTracking(); startTracking();
  addTrackPoint(fix(3000)); addTrackPoint(fix(4000));
  const track = addTrackPoint(fix(25000));
  assert.deepEqual(track.points.map(p => p.segment), [0, 0, 1, 1, 2]);
  assert.equal(addTrackPoint(fix(25000)).points.length, 5);
  assert.equal(track.points[0].accuracy, 5);
});
test('resuming a restored segmented trace starts a new segment', () => {
  clearTrack(); restoreTrack({ id: 'test', points: [{ ...fix(1000), segment: 3 }] });
  startTracking(); assert.equal(addTrackPoint(fix(2000)).points.at(-1).segment, 4);
  clearTrack(); startTracking(); assert.equal(addTrackPoint(fix(1000)).points[0].segment, 0);
});
