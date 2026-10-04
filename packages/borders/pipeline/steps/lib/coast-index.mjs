// Distance from a point to the unsimplified Natural Earth coastline (boundaries of
// ne_10m_land ∪ ne_10m_minor_islands), with a uniform grid index of segments.
// Used by the alignment check: Douglas–Peucker keeps a subset of the original
// vertices, so every vertex of a correct coastal arc lies on this coastline (up to
// the TopoJSON quantization); an exterior arc with vertices off it is a gap/sliver
// between neighbours (or, in the unclipped dev data, a boundary drawn in the sea).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS } from './context.mjs';

const CELL = 0.1; // degrees
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

export class CoastIndex {
  constructor(rings) {
    let n = 0;
    for (const r of rings) n += r.length - 1;
    this.seg = new Float64Array(n * 4);
    this.grid = new Map();
    let k = 0;
    for (const ring of rings) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        this.seg.set([x1, y1, x2, y2], k * 4);
        const cx0 = Math.floor(Math.min(x1, x2) / CELL), cx1 = Math.floor(Math.max(x1, x2) / CELL);
        const cy0 = Math.floor(Math.min(y1, y2) / CELL), cy1 = Math.floor(Math.max(y1, y2) / CELL);
        for (let cx = cx0; cx <= cx1; cx++) {
          for (let cy = cy0; cy <= cy1; cy++) {
            const key = cx * 4096 + cy;
            const list = this.grid.get(key);
            if (list) list.push(k);
            else this.grid.set(key, [k]);
          }
        }
        k++;
      }
    }
  }

  /** Distance in km from (lon, lat) to the nearest coastline segment, or Infinity beyond ~CELL. */
  distanceKm(lon, lat) {
    const kx = KM_PER_DEG_LON * Math.cos((lat * Math.PI) / 180);
    const ky = KM_PER_DEG_LAT;
    const cx = Math.floor(lon / CELL);
    const cy = Math.floor(lat / CELL);
    let best = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = this.grid.get((cx + dx) * 4096 + (cy + dy));
        if (!list) continue;
        for (const s of list) {
          const o = s * 4;
          // local equirectangular frame (km) around the query point
          const ax = (this.seg[o] - lon) * kx, ay = (this.seg[o + 1] - lat) * ky;
          const bx = (this.seg[o + 2] - lon) * kx, by = (this.seg[o + 3] - lat) * ky;
          const vx = bx - ax, vy = by - ay;
          const len2 = vx * vx + vy * vy;
          let t = len2 > 0 ? -(ax * vx + ay * vy) / len2 : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const px = ax + t * vx, py = ay + t * vy;
          const d = Math.sqrt(px * px + py * py);
          if (d < best) best = d;
        }
      }
    }
    return best;
  }
}

let cached = null;
/** The coastline index (built once per thread, ~1 s). */
export function loadCoastIndex() {
  if (cached) return cached;
  const rings = [];
  for (const name of ['ne_10m_land', 'ne_10m_minor_islands']) {
    const fc = JSON.parse(readFileSync(join(PATHS.naturalEarth, `${name}.geojson`), 'utf8'));
    for (const f of fc.features) {
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const p of polys) for (const r of p) rings.push(r);
    }
  }
  cached = new CoastIndex(rings);
  return cached;
}
