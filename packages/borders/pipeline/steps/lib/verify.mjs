// Topological checks on a chunk's TopoJSON: in a year, the tier-0 features must
// form a partition of the land that shares arcs. Every arc is then used either
// once (coastline: land on one side, sea on the other) or exactly twice in opposite
// directions (border between two different features, unclaimed land included).
//   - an arc used twice in the SAME direction, or more than twice, is an overlap;
//   - a gap or sliver between neighbours shows up as extra exterior (once-used)
//     length inland, so the exterior length per year should equal the coastline
//     length and stay the same in every year.

const RAD = Math.PI / 180;
const R_KM = 6371.0072;

function haversineKm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Length of every arc in km (handles quantized, delta-encoded and plain topologies). */
export function arcLengthsKm(topology) {
  const t = topology.transform;
  const [kx, ky] = t ? t.scale : [1, 1];
  const [tx, ty] = t ? t.translate : [0, 0];
  return topology.arcs.map((arc) => {
    let x = 0, y = 0, px = 0, py = 0, len = 0;
    for (let i = 0; i < arc.length; i++) {
      if (t) {
        x += arc[i][0];
        y += arc[i][1];
      } else {
        x = arc[i][0];
        y = arc[i][1];
      }
      const lon = t ? x * kx + tx : x;
      const lat = t ? y * ky + ty : y;
      if (i) len += haversineKm(px, py, lon, lat);
      px = lon;
      py = lat;
    }
    return len;
  });
}

function forEachArc(geometry, fn) {
  const polys = geometry.type === 'Polygon' ? [geometry.arcs] : geometry.type === 'MultiPolygon' ? geometry.arcs : [];
  for (const rings of polys) for (const ring of rings) for (const a of ring) fn(a);
}

/** Absolute [lon, lat] vertices of arc i. */
export function arcCoordinates(topology, i) {
  const t = topology.transform;
  const arc = topology.arcs[i];
  if (!t) return arc.map((p) => [p[0], p[1]]);
  const [kx, ky] = t.scale;
  const [tx, ty] = t.translate;
  let x = 0, y = 0;
  return arc.map((p) => {
    x += p[0];
    y += p[1];
    return [x * kx + tx, y * ky + ty];
  });
}

/** Half the diagonal of a quantization cell in km (worst rounding displacement). */
export function quantizationErrorKm(topology) {
  if (!topology.transform) return 0;
  const [kx, ky] = topology.transform.scale;
  return Math.hypot(kx * 111.32, ky * 110.574) / 2;
}

/**
 * Exterior arcs that leave the coastline: for every frame, the length of tier-0
 * arcs used once whose vertices are farther than `thresholdKm` from the Natural
 * Earth coastline. 0 for an exact partition of the land (a correct coastal arc
 * keeps only original coastline vertices). Distances are cached per arc.
 * `perFrame` are frameTopologyStats results computed with exterior arcs.
 * Returns { offCoastKmMax, year, worst: [{ km, at: [lon, lat], distKm }] }.
 */
export function offCoastStats(topology, perFrame, coast, thresholdKm, { skipArcs = new Set() } = {}) {
  // per arc: length of the segments with an endpoint off the coastline, worst vertex
  const cache = new Map();
  const offOf = (i) => {
    let r = cache.get(i);
    if (r === undefined) {
      const pts = arcCoordinates(topology, i);
      const dist = pts.map(([lon, lat]) => coast.distanceKm(lon, lat));
      let km = 0, d = 0, at = null;
      for (let k = 0; k < pts.length; k++) {
        if (dist[k] > d) {
          d = dist[k];
          at = [Math.round(pts[k][0] * 1e4) / 1e4, Math.round(pts[k][1] * 1e4) / 1e4];
        }
        if (k && (dist[k] > thresholdKm || dist[k - 1] > thresholdKm)) {
          km += Math.hypot((pts[k][0] - pts[k - 1][0]) * 111.32 * Math.cos((pts[k][1] * Math.PI) / 180), (pts[k][1] - pts[k - 1][1]) * 110.574);
        }
      }
      cache.set(i, (r = { km, d, at }));
    }
    return r;
  };
  let best = { offCoastKmMax: 0, year: null, worst: [] };
  for (const s of perFrame) {
    const year = s.year;
    let off = 0;
    const bad = [];
    for (const i of s.exteriorArcs) {
      if (skipArcs.has(i)) continue;
      const { km, d, at } = offOf(i);
      if (km > 0) {
        off += km;
        bad.push({ km: Math.round(km * 10) / 10, at, distKm: d === Infinity ? '>10' : Math.round(d * 100) / 100 });
      }
    }
    if (off > best.offCoastKmMax) best = { offCoastKmMax: off, year, worst: bad.sort((a, b) => b.km - a.km).slice(0, 5) };
  }
  best.offCoastKmMax = Math.round(best.offCoastKmMax * 10) / 10;
  return best;
}

/**
 * Arc-use statistics of the tier-0 features alive in `year`.
 * Returns { features, exteriorKm, borderKm, internalKm, overlapKm, overlapArcs, overlapPairs[, exteriorArcs] }.
 */
export function frameTopologyStats(topology, layer, year, lengths = arcLengthsKm(topology), withExteriorArcs = false) {
  const uses = new Map(); // arc index -> [[featureId, direction], ...]
  let features = 0;
  for (const g of topology.objects[layer].geometries) {
    const p = g.properties;
    if (p.tier !== 0 || p.from > year || p.to < year) continue;
    features++;
    forEachArc(g, (a) => {
      const idx = a < 0 ? ~a : a;
      const list = uses.get(idx);
      const use = [g.id, a < 0 ? -1 : 1];
      if (list) list.push(use);
      else uses.set(idx, [use]);
    });
  }
  let exteriorKm = 0, borderKm = 0, internalKm = 0, overlapKm = 0, overlapArcs = 0;
  const overlapPairs = new Map();
  const exteriorArcs = [];
  for (const [idx, all] of uses) {
    const len = lengths[idx];
    // a feature using an arc in both directions (two of its parts touching, or a
    // hole touching its outer ring) has an internal edge there: cancel such pairs
    let list = all;
    if (all.length > 1) {
      list = [];
      for (const u of all) {
        const k = list.findIndex((v) => v[0] === u[0] && v[1] === -u[1]);
        if (k >= 0) list.splice(k, 1);
        else list.push(u);
      }
      if (list.length < all.length) internalKm += len;
    }
    if (list.length === 0) continue;
    if (list.length === 1) {
      exteriorKm += len;
      if (withExteriorArcs) exteriorArcs.push(idx);
    } else if (list.length === 2 && list[0][1] !== list[1][1]) {
      borderKm += len;
    } else {
      overlapArcs++;
      overlapKm += len;
      const ids = [...new Set(list.map((u) => u[0]))].sort((a, b) => a - b).join('+');
      overlapPairs.set(ids, (overlapPairs.get(ids) ?? 0) + len);
    }
  }
  const pairs = [...overlapPairs].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([ids, km]) => ({ ids, km: Math.round(km * 10) / 10 }));
  return { features, exteriorKm, borderKm, internalKm, overlapKm, overlapArcs, overlapPairs: pairs, ...(withExteriorArcs ? { exteriorArcs } : {}) };
}

/** Total length of all arcs of a base topology (e.g. the land coastline), km. */
export const totalArcKm = (topology) => arcLengthsKm(topology).reduce((s, v) => s + v, 0);
