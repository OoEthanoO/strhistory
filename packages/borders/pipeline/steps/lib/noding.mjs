// Noding with a tolerance, before mapshaper builds the topology.
//
// mapshaper detects shared boundaries by shared vertices: two neighbours share an
// arc only where both rings run through the same vertex sequence (vertices closer
// than the import snap interval are merged first). The geometry step's partition is
// exact as areas, but overlay operations leave T-junctions: one ring has a vertex
// on (or within a few metres of) the middle of its neighbour's segment, where the
// neighbour has none (e.g. a sawtooth border against a straight one, once the
// hair-thin slivers between them are left out, lib/features.mjs). Such a boundary
// becomes two separate arcs, simplified independently, and after simplification the
// neighbours no longer meet (gaps and slivers, flagged by lib/verify.mjs as exterior
// arcs off the coastline).
//
// nodeRings() inserts every vertex that lies within `eps` degrees of the interior of
// another segment into that segment, at the vertex's exact coordinates. Afterwards
// both rings run through the same vertices and mapshaper shares the arc. A segment
// moves by at most `eps` (NODE_DEGREES, about 11 m), far below every LOD tolerance
// and output grid.
//
// cleanRings() runs the whole preparation: snapVertices() first merges vertices
// closer than SNAP_DEGREES (about 3 m: neighbours' copies of one border vertex
// become identical, while the vertices of microstates, tens of metres apart, stay),
// then nodeRings(), then despikeRing() removes what the two leave behind in degenerate
// input: repeated vertices and zero-width spikes and slits (… A → B → A …), such as
// a ring that runs along a border and back a few centimetres away. Spikes have no
// area, so removing them never changes a polygon; kept, the ring would use the same
// arcs several times and its neighbour's border would look like an overlap.

const CELL = 0.1; // grid cell, degrees
const key = (cx, cy) => cx * 8192 + cy; // cy in [-900, 900] fits in 8192

/**
 * Prepares the rings of one chunk for mapshaper in place (see the module comment):
 * vertices closer than `eps` merge, vertices within `nodeEps` (≥ eps) of a segment are
 * inserted into it.
 * `polygons` is [feature][polygon][ring]; rings that degenerate (fewer than 3
 * distinct vertices) are removed, and so is a polygon whose outer ring degenerates.
 * Returns { snapped, inserted, spikes, rings } counts (vertices moved, inserted,
 * removed; rings removed).
 */
export function cleanRings(polygons, eps, nodeEps = eps) {
  const rings = polygons.flat(2);
  const snapped = snapVertices(rings, eps);
  const inserted = nodeRings(rings, nodeEps, eps);
  let spikes = 0;
  for (const ring of rings) spikes += despikeRing(ring);
  let removed = 0;
  for (let i = 0; i < polygons.length; i++) {
    const kept = [];
    for (const poly of polygons[i]) {
      if (poly[0].length < 4) {
        removed += poly.length;
        continue;
      }
      const solid = poly.filter((ring, j) => j === 0 || ring.length >= 4);
      removed += poly.length - solid.length;
      kept.push(solid);
    }
    polygons[i] = kept;
  }
  return { snapped, inserted, spikes, rings: removed };
}

/**
 * Merges vertices closer than `eps` degrees into one representative (the first one
 * met), in place, across all rings. Returns the number of vertices moved.
 */
export function snapVertices(rings, eps) {
  const eps2 = eps * eps;
  // cells of `eps` degrees: a representative within eps lies in the same or a
  // neighbouring cell. Keys are unique while |cy| < 2^24 (eps > 90 / 2^24 ≈ 5.4e-6°);
  // a collision would only add candidates, as the distance test is exact.
  const size = eps;
  const cellKey = (cx, cy) => cx * 33554432 + cy;
  const grid = new Map();
  let moved = 0;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const p = ring[i];
      const cx = Math.floor(p[0] / size);
      const cy = Math.floor(p[1] / size);
      let rep = null;
      for (let dx = -1; dx <= 1 && !rep; dx++) {
        for (let dy = -1; dy <= 1 && !rep; dy++) {
          const list = grid.get(cellKey(cx + dx, cy + dy));
          if (!list) continue;
          for (const q of list) {
            if ((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 <= eps2) {
              rep = q;
              break;
            }
          }
        }
      }
      if (rep) {
        if (rep[0] !== p[0] || rep[1] !== p[1]) {
          ring[i] = [rep[0], rep[1]];
          moved++;
        }
      } else {
        const c = cellKey(cx, cy);
        const list = grid.get(c);
        if (list) list.push(p);
        else grid.set(c, [p]);
      }
    }
  }
  return moved;
}

/**
 * Removes repeated vertices and zero-width spikes (… A → B → A …, repeatedly, also
 * across the ring's seam) from a closed ring in place. A ring left with fewer than 3
 * distinct vertices is emptied. Returns the number of vertices removed.
 */
export function despikeRing(ring) {
  const n0 = ring.length;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const out = [];
  for (let i = 0; i < n0 - 1; i++) { // the open ring: the closing copy is added back below
    const p = ring[i];
    if (out.length && same(out[out.length - 1], p)) continue; // repeated vertex
    if (out.length >= 2 && same(out[out.length - 2], p)) { // … p, tip, p: drop the tip
      out.pop();
      continue;
    }
    out.push(p);
  }
  // the seam: … y, z | a, b … with z == a (repeat) or z == b (spike at a) or y == a (spike at z)
  for (let changed = true; changed && out.length >= 3; ) {
    changed = false;
    if (same(out[0], out[out.length - 1])) {
      out.pop();
      changed = true;
    } else if (same(out[1], out[out.length - 1])) {
      out.shift();
      changed = true;
    } else if (same(out[out.length - 2], out[0])) {
      out.pop();
      changed = true;
    }
  }
  ring.length = 0;
  if (out.length >= 3) {
    for (const p of out) ring.push(p);
    ring.push([out[0][0], out[0][1]]);
  }
  return n0 - ring.length;
}

/**
 * Nodes rings in place. `rings` is an array of closed rings ([[x, y], …], first ==
 * last), typically every ring of every feature in one chunk. A vertex within `eps` of
 * a segment's interior is inserted into it, unless it lies within `endEps` of one of
 * the segment's ends (vertex snapping merges those). Returns the number of vertices
 * inserted.
 */
export function nodeRings(rings, eps = 1e-5, endEps = eps) {
  // 1. grid index of segments (ring r, segment k = ring[k] → ring[k + 1])
  const grid = new Map();
  for (let r = 0; r < rings.length; r++) {
    const ring = rings[r];
    for (let k = 0; k + 1 < ring.length; k++) {
      const [x1, y1] = ring[k];
      const [x2, y2] = ring[k + 1];
      const cx0 = Math.floor((Math.min(x1, x2) - eps) / CELL), cx1 = Math.floor((Math.max(x1, x2) + eps) / CELL);
      const cy0 = Math.floor((Math.min(y1, y2) - eps) / CELL), cy1 = Math.floor((Math.max(y1, y2) + eps) / CELL);
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let cy = cy0; cy <= cy1; cy++) {
          const c = key(cx, cy);
          const list = grid.get(c);
          if (list) list.push(r, k);
          else grid.set(c, [r, k]);
        }
      }
    }
  }

  // 2. every distinct vertex against the segments of its cell
  const eps2 = eps * eps;
  const end2 = endEps * endEps;
  const inserts = new Map(); // "r,k" -> [[t, x, y], ...]
  const seen = new Set();
  for (const ring of rings) {
    for (let i = 0; i + 1 < ring.length; i++) {
      const [px, py] = ring[i];
      const vk = `${px},${py}`;
      if (seen.has(vk)) continue;
      seen.add(vk);
      const list = grid.get(key(Math.floor(px / CELL), Math.floor(py / CELL)));
      if (!list) continue;
      for (let n = 0; n < list.length; n += 2) {
        const r = list[n];
        const k = list[n + 1];
        const a = rings[r][k];
        const b = rings[r][k + 1];
        const ax = a[0], ay = a[1], bx = b[0], by = b[1];
        // quick reject on the segment's bbox
        if (px < Math.min(ax, bx) - eps || px > Math.max(ax, bx) + eps || py < Math.min(ay, by) - eps || py > Math.max(ay, by) + eps) continue;
        // the vertex is (near) an endpoint: vertex snapping handles that
        if ((px - ax) ** 2 + (py - ay) ** 2 <= end2 || (px - bx) ** 2 + (py - by) ** 2 <= end2) continue;
        const vx = bx - ax, vy = by - ay;
        const len2 = vx * vx + vy * vy;
        if (len2 === 0) continue;
        const t = ((px - ax) * vx + (py - ay) * vy) / len2;
        if (t <= 0 || t >= 1) continue;
        const dx = ax + t * vx - px, dy = ay + t * vy - py;
        if (dx * dx + dy * dy > eps2) continue;
        const sk = `${r},${k}`;
        const ins = inserts.get(sk);
        if (ins) ins.push([t, px, py]);
        else inserts.set(sk, [[t, px, py]]);
      }
    }
  }

  // 3. rebuild each ring that gets vertices, in one pass (rings can be 100k vertices long)
  const byRing = new Map(); // r -> Map(k -> list)
  for (const [sk, list] of inserts) {
    const comma = sk.indexOf(',');
    const r = Number(sk.slice(0, comma));
    if (!byRing.has(r)) byRing.set(r, new Map());
    byRing.get(r).set(Number(sk.slice(comma + 1)), list);
  }
  let inserted = 0;
  for (const [r, segs] of byRing) {
    const ring = rings[r];
    const out = [];
    for (let k = 0; k < ring.length; k++) {
      out.push(ring[k]);
      const list = segs.get(k);
      if (!list) continue;
      list.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);
      for (const [, x, y] of list) {
        const last = out[out.length - 1];
        if (last[0] !== x || last[1] !== y) {
          out.push([x, y]);
          inserted++;
        }
      }
    }
    ring.length = 0;
    for (const p of out) ring.push(p);
  }
  return inserted;
}
