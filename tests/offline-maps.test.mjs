import test from 'node:test';
import assert from 'node:assert/strict';
import { tilesForBounds, containsBounds, offlineMapStyle } from '../js/offline-maps.js';

test('regional coverage contains every level, unique tiles, and both corners', () => {
  const bounds = [-1.71, 49.34, -1.69, 49.36];
  const tiles = tilesForBounds(bounds, 14);
  assert.deepEqual(tiles[0], [0, 0, 0]);
  assert.equal(new Set(tiles.map(tile => tile.join('/'))).size, tiles.length);
  for (let z = 0; z <= 14; z++) {
    const level = tiles.filter(tile => tile[0] === z);
    assert.ok(level.length);
    for (const [lon, lat] of [[bounds[0], bounds[1]], [bounds[2], bounds[3]]]) {
      const n = 2 ** z;
      const x = Math.floor((lon + 180) / 360 * n);
      const y = Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * n);
      assert.ok(level.some(tile => tile[1] === x && tile[2] === y));
    }
  }
});

test('large, polar, nonfinite and date-line crossing regions are rejected before network use', () => {
  for (const bounds of [[-180, -80, 180, 80], [179, -1, 181, 1], [1, 85, 2, 90], [NaN, 1, 2, 3]]) {
    assert.throws(() => tilesForBounds(bounds, 14));
  }
  assert.throws(() => tilesForBounds([0, 0, 1, 1], 15));
});

test('offline style has no external tile or font dependency and retains coverage and attribution', () => {
  const bounds = [-2, 48, -1, 49];
  const style = offlineMapStyle({ id: 'example', bounds, maxZoom: 12 });
  assert.equal(style.sources['offline-region'].maxzoom, 12);
  assert.deepEqual(style.sources['offline-region'].bounds, bounds);
  assert.match(style.sources['offline-region'].attribution, /OpenStreetMap/);
  assert.match(style.glyphs, /^marine-glyphs:/);
  assert.match(style.sources['offline-region'].tiles[0], /^marine-offline:/);
  assert.equal(containsBounds(bounds, [-1.5, 48.5, -1.4, 48.6]), true);
  assert.equal(containsBounds(bounds, [-3, 48.5, -1.4, 48.6]), false);
});
