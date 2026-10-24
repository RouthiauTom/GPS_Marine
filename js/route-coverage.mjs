// Clip each straight map leg against the union of downloaded rectangles.
// Work in Web Mercator, matching straight GeoJSON lines on the map.
const project = point => [point.longitude, Math.log(Math.tan(Math.PI / 4 + point.latitude * Math.PI / 360)) * 180 / Math.PI];
export function routeCoverage(points, zones) {
  if (!Array.isArray(points) || points.length < 2) return { error: 'Choisissez une route comportant au moins deux points.' };
  if (points.some(p => !Number.isFinite(p.latitude) || Math.abs(p.latitude) > 85 || !Number.isFinite(p.longitude) || Math.abs(p.longitude) > 180) ||
      points.some((p, i) => i && Math.abs(p.longitude - points[i - 1].longitude) > 180)) {
    return { error: 'Couverture non vérifiable pour cette route (pôle ou passage du méridien ±180°).' };
  }
  const rectangles = zones.filter(z => z.status === 'ready' && Array.isArray(z.bounds) && z.bounds.length === 4 && z.bounds.every(Number.isFinite) && z.bounds[0] < z.bounds[2] && z.bounds[1] < z.bounds[3] && z.bounds[1] > -90 && z.bounds[3] < 90).map(z => {
    const [w, s, e, n] = z.bounds;
    return [...project({ longitude: w, latitude: s }), ...project({ longitude: e, latitude: n })];
  });
  const vertices = points.map(project);
  const portions = [];
  const missing = [];
  for (let i = 1; i < vertices.length; i++) {
    const a = vertices[i - 1], b = vertices[i];
    const delta = b.map((v, axis) => v - a[axis]);
    const intervals = [];
    for (const bounds of rectangles) {
      let lo = 0, hi = 1;
      for (let axis = 0; axis < 2; axis++) {
        if (delta[axis] === 0) {
          if (a[axis] < bounds[axis] || a[axis] > bounds[axis + 2]) { hi = -1; break; }
        } else {
          const ends = [(bounds[axis] - a[axis]) / delta[axis], (bounds[axis + 2] - a[axis]) / delta[axis]];
          lo = Math.max(lo, Math.min(...ends)); hi = Math.min(hi, Math.max(...ends));
        }
      }
      if (lo <= hi) intervals.push([lo, hi]);
    }
    intervals.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
      else merged.push([...interval]);
    }
    const add = (start, end, covered) => {
      if (end <= start) return;
      portions.push({ leg: i, covered, a: a.map((v, j) => v + delta[j] * start), b: a.map((v, j) => v + delta[j] * end) });
    };
    let cursor = 0;
    for (const [lo, hi] of merged) { add(cursor, lo, false); add(lo, hi, true); cursor = hi; }
    add(cursor, 1, false);
    if (portions.some(p => p.leg === i && !p.covered)) missing.push(i);
  }
  return { portions, missing, vertices };
}
