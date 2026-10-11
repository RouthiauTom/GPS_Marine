import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createGpx, parseGpx } from '../js/gpx.js';
const window = new JSDOM('').window;
globalThis.document = window.document;
globalThis.DOMParser = window.DOMParser;
globalThis.XMLSerializer = window.XMLSerializer;
const p = { latitude: 49, longitude: -2, timestamp: 1700000000000 };
test('GPX round trip preserves segments, timestamps and escaped names', () => {
  const data = { waypoints: [{ ...p, name: '<port & abri>', createdAt: p.timestamp }], routes: [],
    tracks: [{ name: 'Sortie', points: [{ ...p, segment: 0 }, { ...p, segment: 1 }] }] };
  const xml = createGpx(data);
  const result = parseGpx(xml);
  assert.equal(result.waypoints[0].name, '<port & abri>');
  assert.equal(result.waypoints[0].createdAt, p.timestamp);
  assert.deepEqual(result.tracks[0].points.map(p => p.segment), [0, 1]);
  assert.equal(result.tracks[0].points[1].timestamp, p.timestamp);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  assert.deepEqual([...doc.querySelector('wpt').children].map(el => el.localName), ['time', 'name', 'type']);
});
test('missing, empty and out-of-range coordinates are rejected', () => {
  for (const attributes of ['lat="" lon="0"', 'lat=" " lon="0"', 'lon="0"', 'lat="91" lon="0"', 'lat="0" lon="NaN"']) {
    assert.throws(() => parseGpx(`<gpx><wpt ${attributes}/></gpx>`));
  }
  assert.throws(() => parseGpx('<gpx>'));
});
