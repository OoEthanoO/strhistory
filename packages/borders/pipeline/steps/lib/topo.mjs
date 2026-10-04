// mapshaper (Node API) wrapper: spherical Douglas–Peucker simplification with
// microstate protection, TopoJSON export, and the post-processing our contract
// needs (RFC 7946 winding, contract-ordered properties, no empty geometries).
import mapshaper from 'mapshaper';
import { CONFIG } from './context.mjs';
import { polygonAreaM2 } from './geo.mjs';

/**
 * Simplification settings (microstate protection). A feature of area A gets the
 * Douglas–Peucker interval min(toleranceM, max(minIntervalM, size / smallFeatureK))
 * where size = sqrt(A), or sqrt(A / parts) for features under
 * archipelagoMaxAreaKm2 (atoll states such as the Maldives are many islets, each far
 * smaller than the whole). So microstates, city states and small island states keep
 * their shape and area while large polities use the LOD tolerance. Shared arcs take
 * the smallest interval of the features using them (mapshaper's variable
 * simplification), so neighbours stay aligned. config.json → "simplify" overrides.
 */
export const SIMPLIFY = {
  smallFeatureK: 50,
  minIntervalM: 5,
  archipelagoMaxAreaKm2: 5000,
  ...(CONFIG.simplify ?? {}),
};

/**
 * Import snapping and noding distance in degrees (config.json → topology.snapDegrees;
 * 3e-5 ≈ 3.3 m at the equator). Vertices closer than this merge, and a vertex this
 * close to a neighbour's segment is inserted into it (lib/noding.mjs), so borders that
 * the geometry step's overlay operations left a few metres apart share one arc. Far
 * below every LOD's tolerance and quantization grid (≥ 20 m), and below the spacing
 * of microstates' vertices.
 */
export const SNAP_DEGREES = Number(CONFIG.topology?.snapDegrees ?? 0.00003);

/**
 * Noding distance in degrees (config.json → topology.nodeDegrees, default SNAP_DEGREES):
 * a vertex this close to the interior of another ring's segment is inserted into it
 * (lib/noding.mjs), so a neighbour's border that zigzags a few metres around a
 * straight one ends up sharing its vertices. Larger than SNAP_DEGREES, as it only adds
 * vertices and never merges the closely spaced vertices of microstates and islets.
 */
export const NODE_DEGREES = Number(CONFIG.topology?.nodeDegrees ?? SNAP_DEGREES);

/** Size (metres) below which a feature's simplification interval shrinks: sqrt(A / parts) / smallFeatureK (see SIMPLIFY). */
export function protectionSizeM(areaKm2, parts, s = SIMPLIFY) {
  const n = areaKm2 < s.archipelagoMaxAreaKm2 ? Math.max(1, parts) : 1;
  return Math.sqrt((Math.max(0, areaKm2) * 1e6) / n) / s.smallFeatureK;
}

/**
 * mapshaper expression for the per-feature interval in metres (spherical for lon/lat
 * data): min(toleranceM, max(minIntervalM, size)).
 *   - chunks pass `sizeField`: each input feature carries its record's protection size
 *     (protectionSizeM, computed in JS; a huge value for unclaimed land, which gets the
 *     plain tolerance). A record's polygon parts are separate input features with the
 *     record's size, so keep-shapes keeps every part from vanishing (it only protects
 *     each feature's largest ring) while every part uses the record's interval.
 *   - base layers (land, lakes) use mapshaper's own area and part count.
 * `this.originalArea` is clamped at 0: a feature that collapses on import (snapping)
 * can report a tiny negative area, and mapshaper rejects a NaN interval.
 */
export function intervalExpression(toleranceM, s = SIMPLIFY, sizeField = null) {
  if (sizeField) return `Math.min(${toleranceM},Math.max(${s.minIntervalM},${sizeField}))`;
  const parts = `(this.originalArea<${s.archipelagoMaxAreaKm2 * 1e6}?Math.max(1,this.partCount):1)`;
  return `Math.min(${toleranceM},Math.max(${s.minIntervalM},Math.sqrt(Math.max(0,this.originalArea)/${parts})/${s.smallFeatureK}))`;
}

/**
 * Runs mapshaper on a GeoJSON file and returns the TopoJSON object (parsed).
 * `layer` names the TopoJSON object. Topology is built on import, so features that
 * share boundaries share arcs and are simplified together. `sizeField`: see
 * intervalExpression.
 */
export async function simplifyFileToTopology(inputPath, { layer, toleranceM, quantization, idField = 'id', keepFields = null, dissolve = false, extraInputs = [], sizeField = null }) {
  // snap-interval (SNAP_DEGREES, a few metres): vertices that differ only by overlay
  // noise (two neighbours cut by different overlay operations) are merged before the
  // topology is built, so their shared border becomes one arc. A fixed interval
  // (instead of mapshaper's default 0.25 % of the mean segment length) cannot move
  // the vertices of microstates and islets, which are tens of metres apart.
  const argv = ['-quiet', '-i', inputPath, ...extraInputs, ...(extraInputs.length ? ['combine-files'] : []), `snap-interval=${SNAP_DEGREES}`];
  // Declaring the CRS matters for speed: without it mapshaper re-derives the CRS
  // from the dataset bounds (a scan of every vertex) for each feature during
  // variable simplification — 50× slower on a 2,000-record chunk.
  argv.push('-proj', 'init=wgs84');
  if (extraInputs.length) argv.push('-merge-layers', 'force');
  if (dissolve) argv.push('-dissolve2');
  if (keepFields) argv.push('-filter-fields', keepFields.join(','));
  argv.push('-rename-layers', layer);
  // Douglas–Peucker (mapshaper's default is weighted Visvalingam), spherical for
  // lat/lon data; `variable` evaluates the interval expression per feature
  argv.push('-simplify', 'dp', 'variable', `interval=${intervalExpression(toleranceM, SIMPLIFY, sizeField)}`, 'keep-shapes');
  argv.push('-o', `${layer}.json`, 'format=topojson', `quantization=${quantization}`);
  if (idField) argv.push(`id-field=${idField}`);
  const out = await mapshaper.applyCommands(argv);
  const text = out[`${layer}.json`];
  if (!text) throw new Error(`mapshaper produced no ${layer}.json (outputs: ${Object.keys(out).join(', ')})`);
  return JSON.parse(typeof text === 'string' ? text : Buffer.from(text).toString('utf8'));
}

/**
 * Merges arcs whose (quantized) coordinates are identical, forwards or backwards, and
 * drops arcs no geometry uses. Simplification can make two distinct arcs coincide:
 * when a small polygon part between two neighbours collapses (an 80 km² exclave at
 * l0, say), its two bounding arcs both reduce to the same straight segment and the
 * neighbours are left with separate copies of one boundary, which a client would
 * draw as coastline. After merging they share the arc again. Lossless: every ring
 * keeps its coordinates. Works on quantized (delta-encoded) and plain topologies.
 * Returns the number of arcs merged away.
 */
export function mergeCoincidentArcs(topology) {
  const quantized = !!topology.transform;
  const absolute = (arc) => {
    if (!quantized) return arc;
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
  };
  const keyOf = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(';');
  const map = new Int32Array(topology.arcs.length); // old index -> new reference (index or ~index), before compaction
  // candidates: same vertex count and the same two end points (in either order)
  const groups = new Map();
  topology.arcs.forEach((arc, i) => {
    map[i] = i;
    const pts = absolute(arc);
    const a = `${pts[0]}`;
    const b = `${pts.at(-1)}`;
    const k = `${pts.length}|${a < b ? `${a}|${b}` : `${b}|${a}`}`;
    const list = groups.get(k);
    if (list) list.push(i);
    else groups.set(k, [i]);
  });
  let merged = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const firstOf = new Map(); // full forward key of a kept arc -> its index
    for (const i of list) {
      const pts = absolute(topology.arcs[i]);
      const fwd = keyOf(pts);
      const same = firstOf.get(fwd);
      const reversed = same === undefined ? firstOf.get(keyOf(pts.slice().reverse())) : undefined;
      if (same !== undefined) map[i] = same;
      else if (reversed !== undefined) map[i] = ~reversed;
      else {
        firstOf.set(fwd, i);
        continue;
      }
      merged++;
    }
  }
  if (!merged) return 0;
  const remap = (a) => (a >= 0 ? map[a] : ~map[~a]);
  const walk = (arcs) => arcs.map((x) => (Array.isArray(x) ? walk(x) : remap(x)));
  for (const g of geometriesOf(topology)) if (g.arcs) g.arcs = walk(g.arcs);
  compactArcs(topology);
  return merged;
}

/**
 * Removes consecutive duplicate points from every arc (two vertices that quantized
 * onto the same grid cell: a [0, 0] delta), keeping at least two points per arc.
 * Lossless for rendering; it also lets mergeCoincidentArcs recognise copies that
 * differ only by such a repeat. Returns the number of points removed.
 */
export function removeDuplicatePoints(topology) {
  let removed = 0;
  const quantized = !!topology.transform;
  topology.arcs = topology.arcs.map((arc) => {
    const out = [arc[0]];
    for (let i = 1; i < arc.length; i++) {
      const p = arc[i];
      const dup = quantized ? p[0] === 0 && p[1] === 0 : p[0] === out[out.length - 1][0] && p[1] === out[out.length - 1][1];
      if (dup) removed++;
      else out.push(p);
    }
    if (out.length < 2) {
      out.push(quantized ? [0, 0] : arc[arc.length - 1]);
      removed--;
    }
    return out;
  });
  return removed;
}

/** Every geometry of every object of a topology. */
const geometriesOf = (topology) => Object.values(topology.objects).flatMap((o) => (o.type === 'GeometryCollection' ? o.geometries : [o]));

/** Drops arcs no geometry uses, keeping the others in order, and re-indexes the references. */
export function compactArcs(topology) {
  const objects = geometriesOf(topology);
  const used = new Uint8Array(topology.arcs.length);
  const mark = (arcs) => arcs.forEach((x) => (Array.isArray(x) ? mark(x) : (used[x < 0 ? ~x : x] = 1)));
  for (const g of objects) if (g.arcs) mark(g.arcs);
  const index = new Int32Array(topology.arcs.length).fill(-1);
  const arcs = [];
  topology.arcs.forEach((arc, i) => {
    if (used[i]) {
      index[i] = arcs.length;
      arcs.push(arc);
    }
  });
  const compact = (list) => list.map((x) => (Array.isArray(x) ? compact(x) : x >= 0 ? index[x] : ~index[~x]));
  for (const g of objects) if (g.arcs) g.arcs = compact(g.arcs);
  const removed = topology.arcs.length - arcs.length;
  topology.arcs = arcs;
  return removed;
}

/** Absolute [lon, lat] coordinates of a ring given as arc references. */
function ringCoordinates(topology, ring) {
  const t = topology.transform;
  const out = [];
  for (const a of ring) {
    const arc = topology.arcs[a < 0 ? ~a : a];
    let pts;
    if (t) {
      let x = 0, y = 0;
      pts = arc.map(([dx, dy]) => [(x += dx) * t.scale[0] + t.translate[0], (y += dy) * t.scale[1] + t.translate[1]]);
    } else pts = arc;
    if (a < 0) pts = pts.slice().reverse();
    // consecutive arcs share their end point (loop: arcs can hold 100k vertices)
    for (let i = out.length ? 1 : 0; i < pts.length; i++) out.push(pts[i]);
  }
  return out;
}

/**
 * Twice the planar area of a ring (arc references) in the topology's own units:
 * exact integer arithmetic for quantized topologies, so 0 means the ring collapsed.
 */
export function ringArea2(topology, ring) {
  const pts = [];
  for (const a of ring) {
    const arc = topology.arcs[a < 0 ? ~a : a];
    let seq;
    if (topology.transform) {
      let x = 0, y = 0;
      seq = arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
    } else seq = arc;
    if (a < 0) seq = seq.slice().reverse();
    // consecutive arcs share their end point (loop: arcs can hold 100k vertices)
    for (let i = pts.length ? 1 : 0; i < seq.length; i++) pts.push(seq[i]);
  }
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1];
  return s;
}

/**
 * Island area threshold of a LOD (km²): a square of twice the LOD tolerance (100 km²
 * at l0, 4 km² at l1, 0.25 km² at l2), about one pixel at the deepest zoom the LOD
 * serves (z3: ~10 km/px, z5: ~2.4 km/px, z7: ~0.6 km/px at the equator).
 */
export const islandMinAreaKm2 = (lod) => ((2 * lod.toleranceM) / 1000) ** 2;

/**
 * Drops islets of large records: polygon parts below `minAreaKm2` whose arcs no other
 * polygon of the chunk uses (an island in every year of the chunk, so dropping it opens
 * no gap) — far below a pixel at the LOD's zoom levels, yet keep-shapes would keep each
 * of them. A record always keeps its largest part, and records for which
 * `keep(geometry)` is true (small polities, archipelago states) keep everything.
 * Returns { parts, km2 } dropped.
 */
export function dropSmallIslands(topology, layer, minAreaKm2, keep = () => false) {
  const geometries = topology.objects[layer].geometries;
  const uses = new Uint32Array(topology.arcs.length);
  const count = (arcs) => arcs.forEach((x) => (Array.isArray(x) ? count(x) : uses[x < 0 ? ~x : x]++));
  for (const g of geometries) if (g.arcs) count(g.arcs);
  let parts = 0;
  let km2 = 0;
  for (const g of geometries) {
    if (g.type !== 'MultiPolygon' || keep(g)) continue;
    const list = g.arcs.map((rings) => ({
      rings,
      isolated: rings.every((ring) => ring.every((a) => uses[a < 0 ? ~a : a] === 1)),
      area: polygonAreaM2(rings.map((ring) => ringCoordinates(topology, ring))) / 1e6,
    }));
    const largest = list.reduce((b, p) => (p.area > b.area ? p : b));
    const kept = list.filter((p) => p === largest || !p.isolated || p.area >= minAreaKm2);
    if (kept.length === list.length) continue;
    for (const p of list) {
      if (kept.includes(p)) continue;
      parts++;
      km2 += p.area;
    }
    if (kept.length === 1) {
      g.type = 'Polygon';
      g.arcs = kept[0].rings;
    } else g.arcs = kept.map((p) => p.rings);
  }
  if (parts) compactArcs(topology);
  return { parts, km2: Math.round(km2 * 100) / 100 };
}

/** Reverses a TopoJSON ring (arc order reversed, every arc index complemented). */
export const reverseRing = (ring) => ring.slice().reverse().map((i) => ~i);

/**
 * mapshaper writes exterior rings clockwise (shapefile convention); RFC 7946 wants
 * them counter-clockwise, holes clockwise. Flips every ring of every polygon in place.
 */
export function toRfc7946Winding(geometry) {
  if (geometry.type === 'Polygon') geometry.arcs = geometry.arcs.map(reverseRing);
  else if (geometry.type === 'MultiPolygon') geometry.arcs = geometry.arcs.map((p) => p.map(reverseRing));
  return geometry;
}

/**
 * A feature can collapse to nothing when the TopoJSON quantization grid is coarser
 * than the feature (Natural Earth's Vatican is ~110 m across; the l0 grid is
 * ~400 × 200 m). Instead of an empty geometry it gets the smallest grid-aligned
 * rectangle covering its source bounding box — its footprint at this resolution.
 * Returns the index of the new arc.
 */
export function addStandInRectangle(topology, bbox) {
  const [kx, ky] = topology.transform.scale;
  const [tx, ty] = topology.transform.translate;
  const x0 = Math.floor((bbox[0] - tx) / kx);
  const y0 = Math.floor((bbox[1] - ty) / ky);
  const x1 = Math.max(x0 + 1, Math.ceil((bbox[2] - tx) / kx));
  const y1 = Math.max(y0 + 1, Math.ceil((bbox[3] - ty) / ky));
  const dx = x1 - x0;
  const dy = y1 - y0;
  // counter-clockwise, delta-encoded, closed
  topology.arcs.push([[x0, y0], [dx, 0], [0, dy], [-dx, 0], [0, -dy]]);
  return topology.arcs.length - 1;
}

/**
 * Splits a ring (arc indexes) that uses one arc in both directions (… a … ~a …) into
 * the rings on either side of that arc, dropping the arc from both, until no arc is
 * used twice. Such a ring runs along a line and back: a zero-width spike, or a
 * corridor joining two lobes of a polygon (or a hole to the outside) that overlay
 * noise left in the geometry step's output. Kept, the arc would be used by the record
 * twice and by its neighbours as well, and their shared border would count as an
 * overlap. A ring that is nothing but a spike yields no ring.
 */
export function splitRing(ring) {
  const out = [];
  const todo = [ring];
  while (todo.length) {
    const r = todo.pop();
    const first = new Map(); // arc -> index of its first use in r
    let cut = null;
    for (let j = 0; j < r.length && !cut; j++) {
      const k = r[j] < 0 ? ~r[j] : r[j];
      const i = first.get(k);
      if (i === undefined) first.set(k, j);
      else if (r[i] === ~r[j]) cut = [i, j];
    }
    if (!cut) {
      if (r.length) out.push(r);
      continue;
    }
    const [i, j] = cut;
    todo.push(r.slice(i + 1, j), [...r.slice(0, i), ...r.slice(j + 1)]);
  }
  return out;
}

/**
 * One mapshaper polygon (outer ring first, then holes; outer rings clockwise) after
 * splitRing: rings with the outer ring's orientation are outer rings, the others
 * holes, zero-area rings are dropped. When nothing was split the polygon is kept as
 * it is; otherwise each hole goes to the outer ring that contains it (a hole inside
 * none of them encloses nothing and is dropped). Returns a list of polygons.
 */
function splitPolygon(topology, rings) {
  const pieces = rings.flatMap(splitRing);
  const sign = Math.sign(ringArea2(topology, rings[0]));
  const outer = [];
  const holes = [];
  for (const r of pieces) {
    const a = ringArea2(topology, r);
    if (a === 0) continue;
    (Math.sign(a) === sign ? outer : holes).push({ r, a: Math.abs(a) });
  }
  if (!outer.length) return [];
  const split = pieces.length !== rings.length || pieces.some((r, i) => r !== rings[i]);
  if (!split) {
    // simplification can move a shell past a hole near it: a hole outside its shell
    // encloses nothing of the polygon (its land is the neighbour's) and is dropped
    if (!holes.length) return [[outer[0].r]];
    const shell = ringPoints(topology, outer[0].r);
    return [[outer[0].r, ...holes.filter((h) => ringInside(ringPoints(topology, h.r), shell)).map((h) => h.r)]];
  }
  outer.sort((p, q) => p.a - q.a); // smallest first: the innermost ring that contains a hole
  const polygons = outer.map((o) => [o.r]);
  const outerPts = outer.map((o) => ringPoints(topology, o.r));
  for (const h of holes) {
    const k = outerPts.findIndex((pts) => ringInside(ringPoints(topology, h.r), pts));
    if (k >= 0) polygons[k].push(h.r);
  }
  return polygons.reverse(); // largest first
}

/** Ring vertices as [x, y] in the topology's (quantized) coordinates. */
function ringPoints(topology, ring) {
  const pts = [];
  for (const a of ring) {
    const arc = topology.arcs[a < 0 ? ~a : a];
    let seq;
    if (topology.transform) {
      let x = 0, y = 0;
      seq = arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
    } else seq = arc;
    if (a < 0) seq = seq.slice().reverse();
    for (let i = pts.length ? 1 : 0; i < seq.length; i++) pts.push(seq[i]);
  }
  return pts;
}

/**
 * Does ring `inner` lie inside ring `outer`? Decided by the first vertex of `inner`
 * that is not on `outer`'s boundary (rings that share arcs touch); false when every
 * vertex is on it.
 */
function ringInside(inner, outer) {
  for (const [px, py] of inner) {
    let inside = false;
    let onEdge = false;
    for (let i = 0, j = outer.length - 1; i < outer.length; j = i++) {
      const [xi, yi] = outer[i];
      const [xj, yj] = outer[j];
      const cross = (xj - xi) * (py - yi) - (yj - yi) * (px - xi);
      if (cross === 0 && Math.min(xi, xj) <= px && px <= Math.max(xi, xj) && Math.min(yi, yj) <= py && py <= Math.max(yi, yj)) {
        onEdge = true;
        break;
      }
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (!onEdge) return inside;
  }
  return false;
}

/**
 * Post-processes a chunk topology in place: joins the parts of a record (input
 * features sharing an id) into one Polygon/MultiPolygon in input order, RFC 7946
 * winding, contract-ordered properties from `propsById`, a stand-in for a polity
 * record whose every part collapsed. Unclaimed land that collapsed completely is left
 * out of this file instead (its id is pushed to `dropped`): it has no identity to
 * keep, and a stand-in rectangle would draw land where the source has a hair-thin
 * strip or a speck. Returns the list of stand-in ids. Geometries with an id missing
 * from `propsById` are an error (ids come from our input).
 */
export function finishChunkTopology(topology, layer, propsById, bboxById, dropped = []) {
  const obj = topology.objects[layer];
  const polygonsById = new Map(); // id -> arcs of its polygons (insertion order = input order)
  // A ring can survive simplification (keep-shapes) and still collapse on the
  // quantization grid (the ~100 m Vatican on the ~300 m l0 grid): zero-area rings
  // are dropped, holes and parts alike, so no record is left as a degenerate polygon.
  for (const g of obj.geometries) {
    if (!propsById.has(g.id)) throw new Error(`topology geometry with unknown id ${g.id}`);
    if (!polygonsById.has(g.id)) polygonsById.set(g.id, []);
    const polygons = g.type === 'Polygon' ? [g.arcs] : g.type === 'MultiPolygon' ? g.arcs : [];
    for (const rings of polygons) {
      if (!rings.length || ringArea2(topology, rings[0]) === 0) continue;
      polygonsById.get(g.id).push(...splitPolygon(topology, rings));
    }
  }
  const standIns = [];
  const geometries = [];
  for (const [id, polygons] of polygonsById) {
    const props = propsById.get(id);
    if (!polygons.length) {
      if (props.kind === 'unclaimed') {
        dropped.push(id);
        continue;
      }
      const bbox = bboxById.get(id);
      if (!bbox || !topology.transform) throw new Error(`feature ${props.rid} collapsed and cannot get a stand-in`);
      standIns.push(id);
      geometries.push({ type: 'Polygon', id, properties: props, arcs: [[addStandInRectangle(topology, bbox)]] });
      continue;
    }
    const g = polygons.length === 1 ? { type: 'Polygon', arcs: polygons[0] } : { type: 'MultiPolygon', arcs: polygons };
    toRfc7946Winding(g);
    geometries.push({ type: g.type, id, properties: props, arcs: g.arcs });
  }
  obj.geometries = geometries;
  compactArcs(topology); // arcs of collapsed land and of split-off corridors may be unused now
  return standIns;
}

/** Post-processes a base-layer topology (land, lakes): RFC 7946 winding, drops empty geometries. */
export function finishBaseTopology(topology, layer) {
  const obj = topology.objects[layer];
  obj.geometries = obj.geometries.filter((g) => g.type).map((g) => toRfc7946Winding(g));
  return obj.geometries.length;
}
