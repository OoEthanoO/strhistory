// Lightweight lon/lat geometry helpers for GeoJSON Polygon/MultiPolygon objects
// (no dependencies besides polylabel). Areas are spherical (authalic radius), which
// is within a fraction of a percent of the geodesic WGS84 areas the Python steps use.
import polylabel from 'polylabel';

const RAD = Math.PI / 180;
/** WGS84 authalic radius (sphere with the ellipsoid's surface area), metres. */
export const EARTH_RADIUS_M = 6371007.181;

/** Polygons of a Polygon/MultiPolygon geometry as arrays of rings (empty for anything else). */
export function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

/**
 * Signed spherical area of a closed ring in m² (negative for counter-clockwise
 * rings in lon/lat). Same formula as @mapbox/geojson-area / turf.
 */
export function ringAreaSigned(ring) {
  const n = ring.length - 1; // closed ring: last == first
  if (n <= 2) return 0;
  let total = 0;
  for (let i = 0; i < n; i++) {
    const lower = ring[i];
    const middle = ring[i + 1 === n ? 0 : i + 1];
    const upper = ring[i + 2 >= n ? (i + 2) % n : i + 2];
    total += (upper[0] - lower[0]) * RAD * Math.sin(middle[1] * RAD);
  }
  return (total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2;
}

/** Area of one polygon (outer ring minus holes), m². */
export function polygonAreaM2(rings) {
  let a = 0;
  rings.forEach((ring, i) => {
    const r = Math.abs(ringAreaSigned(ring));
    a += i === 0 ? r : -r;
  });
  return Math.max(0, a);
}

export const geometryAreaKm2 = (geometry) => polygonsOf(geometry).reduce((s, p) => s + polygonAreaM2(p), 0) / 1e6;

/** Length of a ring or line in metres (great-circle segments, haversine). */
export function lineLengthM(coords) {
  let m = 0;
  for (let i = 1; i < coords.length; i++) {
    const [x1, y1] = coords[i - 1];
    const [x2, y2] = coords[i];
    const s = Math.sin(((y2 - y1) * RAD) / 2) ** 2 + Math.cos(y1 * RAD) * Math.cos(y2 * RAD) * Math.sin(((x2 - x1) * RAD) / 2) ** 2;
    m += 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
  }
  return m;
}

/** Perimeter of one polygon (outer ring and holes), m. */
export const polygonPerimeterM = (rings) => rings.reduce((s, ring) => s + lineLengthM(ring), 0);

/** Planar (lon/lat) shoelace sign: > 0 for counter-clockwise rings. */
export function planarRingArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return a / 2;
}

/** RFC 7946 winding in place: exterior rings counter-clockwise, holes clockwise. */
export function orientRfc7946(geometry) {
  for (const rings of polygonsOf(geometry)) {
    rings.forEach((ring, i) => {
      const ccw = planarRingArea(ring) > 0;
      if ((i === 0) !== ccw) ring.reverse();
    });
  }
  return geometry;
}

export function vertexCount(geometry) {
  let n = 0;
  for (const rings of polygonsOf(geometry)) for (const ring of rings) n += ring.length;
  return n;
}

export function bboxOf(geometry) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const rings of polygonsOf(geometry)) {
    for (const [x, y] of rings[0] ?? []) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return w === Infinity ? null : [w, s, e, n];
}

export function unionBbox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

/** Pole of inaccessibility of the largest part (by spherical area), [lon, lat]. */
export function labelPoint(geometry) {
  let best = null;
  let bestArea = -1;
  for (const rings of polygonsOf(geometry)) {
    const a = polygonAreaM2(rings);
    if (a > bestArea) {
      bestArea = a;
      best = rings;
    }
  }
  if (!best) return null;
  const [w, s, e, n] = bboxOf({ type: 'Polygon', coordinates: best });
  // polylabel returns a bbox corner when the cell size reaches the precision, so the
  // precision must stay well below the polygon's smaller extent.
  const precision = Math.max(1e-7, Math.min(e - w, n - s) / 100);
  const p = polylabel(best, precision);
  return [p[0], p[1]];
}

/** Rounds every coordinate to `digits` decimals and drops repeated positions. */
export function roundGeometry(geometry, digits = 6) {
  const k = 10 ** digits;
  const round = (v) => Math.round(v * k) / k;
  const polys = [];
  for (const rings of polygonsOf(geometry)) {
    const out = [];
    for (const ring of rings) {
      const r = [];
      for (const [x, y] of ring) {
        const p = [round(x), round(y)];
        const last = r[r.length - 1];
        if (!last || last[0] !== p[0] || last[1] !== p[1]) r.push(p);
      }
      if (r.length >= 4) out.push(r);
      else if (out.length === 0) break; // degenerate exterior ring: drop the polygon
    }
    if (out.length) polys.push(out);
  }
  if (!polys.length) return null;
  return polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys };
}

/** Area value as stored in `a`: whole km² for large polities, two decimals for small ones. */
export const roundArea = (km2) => (km2 >= 100 ? Math.round(km2) : Math.round(km2 * 100) / 100);
export const round4 = (v) => Math.round(v * 1e4) / 1e4;
