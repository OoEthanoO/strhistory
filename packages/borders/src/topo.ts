// Decoding era-chunk TopoJSON into per-year GeoJSON. Internal module: the TopoJSON
// types here are minimal on purpose so no topojson type package leaks into the
// public .d.ts files.

import { feature, mesh } from 'topojson-client';
import type {
  Feature,
  FeatureCollection,
  Geometry,
  HistYear,
  LineProps,
  MultiLineString,
  MultiPolygon,
  Point,
  Polygon,
  Position,
  PolityProps,
} from './types.js';

export interface TopoGeometry {
  type: string | null;
  id?: string | number;
  properties?: Record<string, unknown>;
  arcs?: unknown;
  geometries?: TopoGeometry[];
}

export interface Topology {
  type: 'Topology';
  objects: Record<string, TopoGeometry>;
  arcs: unknown[];
  transform?: { scale: [number, number]; translate: [number, number] };
  bbox?: number[];
}

/** A decoded chunk: the topology plus its polity geometries. */
export interface PreparedChunk {
  topology: Topology;
  polities: TopoGeometry[];
}

// topojson-client's own typings use @types/topojson-specification and @types/geojson.
// We call it through these narrow signatures instead.
type FeatureFn = (topology: Topology, o: TopoGeometry) => Feature<Geometry | null> | FeatureCollection<Geometry | null>;
type MeshFn = (
  topology: Topology,
  o: TopoGeometry,
  filter: (a: TopoGeometry, b: TopoGeometry) => boolean,
) => MultiLineString;
const toFeature = feature as unknown as FeatureFn;
const toMesh = mesh as unknown as MeshFn;

function isTopology(json: unknown): json is Topology {
  if (typeof json !== 'object' || json === null) return false;
  const t = json as Partial<Topology>;
  return t.type === 'Topology' && typeof t.objects === 'object' && t.objects !== null && Array.isArray(t.arcs);
}

// Float noise from dequantising (x · scale + translate) can land a hair outside the
// world, e.g. 180.00000000000003. Snap such values; larger errors stay visible to QA.
const SNAP = 1e-9;
const snap = (v: number, limit: number) => (v > limit && v - limit < SNAP ? limit : v < -limit && -limit - v < SNAP ? -limit : v);

/**
 * Rewrites a topology's arcs in place as absolute lon/lat (undoing quantisation and
 * delta encoding once per file instead of on every decode), snaps float noise at
 * ±180/±90 (so coordinates stay in range and cut edges are recognised) and drops the
 * transform. Decoding then only copies point references (1.8× faster on the
 * 2026-10-01 dev dataset), so decoded features share their position arrays with the
 * cached chunk: results must be treated as read-only.
 */
export function absolutise(topology: Topology): void {
  const arcs = topology.arcs as number[][][];
  const t = topology.transform;
  if (t) {
    const [kx, ky] = t.scale;
    const [dx, dy] = t.translate;
    for (const arc of arcs) {
      let x = 0;
      let y = 0;
      for (const p of arc) {
        x += p[0] as number;
        y += p[1] as number;
        p[0] = snap(x * kx + dx, 180);
        p[1] = snap(y * ky + dy, 90);
      }
    }
    delete topology.transform;
  } else {
    for (const arc of arcs) {
      for (const p of arc) {
        p[0] = snap(p[0] as number, 180);
        p[1] = snap(p[1] as number, 90);
      }
    }
  }
}

/** Validates a chunk file (a Topology with a 'polities' GeometryCollection) and absolutises it. */
export function prepareChunk(json: unknown, url: string): PreparedChunk {
  const polities = isTopology(json) ? json.objects.polities : undefined;
  if (!isTopology(json) || !polities || polities.type !== 'GeometryCollection' || !Array.isArray(polities.geometries)) {
    throw new Error(`@alexs-atlas/borders: ${url} is not a chunk (a Topology with a 'polities' GeometryCollection)`);
  }
  absolutise(json);
  return { topology: json, polities: polities.geometries };
}

const props = (g: TopoGeometry) => g.properties as unknown as PolityProps | undefined;

/** Geometries alive in `year` (from <= year <= to), optionally only one tier. */
export function aliveIn(chunk: PreparedChunk, year: HistYear, tier?: 0 | 1): TopoGeometry[] {
  const out: TopoGeometry[] = [];
  for (const g of chunk.polities) {
    const p = props(g);
    if (!p || g.type === null || p.from > year || p.to < year) continue;
    if (tier !== undefined && p.tier !== tier) continue;
    out.push(g);
  }
  return out;
}

/** Polygons alive in `year`, decoded with topojson-client; Feature.id = properties.id. */
export function decodeBorders(
  chunk: PreparedChunk,
  year: HistYear,
): FeatureCollection<Polygon | MultiPolygon, PolityProps> {
  const features: Feature<Polygon | MultiPolygon, PolityProps>[] = [];
  for (const g of aliveIn(chunk, year)) {
    const f = toFeature(chunk.topology, g) as Feature<Polygon | MultiPolygon, PolityProps>;
    if (!f.geometry) continue;
    if (f.id === undefined) f.id = f.properties.id;
    features.push(f);
  }
  return { type: 'FeatureCollection', features };
}

/**
 * One point per polity alive in `year` at its label point (lx, ly); unclaimed land is
 * skipped. When several records of one pid are alive (an override that re-draws a
 * polity can leave a small remnant record of it), the label goes to the tier-0 record
 * with the largest area.
 */
export function decodeLabels(chunk: PreparedChunk, year: HistYear): FeatureCollection<Point, PolityProps> {
  // Map keeps the position of each pid's first record: deterministic order.
  const best = new Map<string, TopoGeometry>();
  for (const g of aliveIn(chunk, year)) {
    const p = props(g) as PolityProps;
    if (p.kind === 'unclaimed' || !Number.isFinite(p.lx) || !Number.isFinite(p.ly)) continue;
    const held = best.get(p.pid);
    const q = held && (props(held) as PolityProps);
    if (!q || p.tier < q.tier || (p.tier === q.tier && p.a > q.a)) best.set(p.pid, g);
  }
  const features: Feature<Point, PolityProps>[] = [];
  for (const g of best.values()) {
    const p = props(g) as PolityProps;
    features.push({
      type: 'Feature',
      id: g.id ?? p.id,
      properties: p,
      geometry: { type: 'Point', coordinates: [p.lx, p.ly] },
    });
  }
  return { type: 'FeatureCollection', features };
}

type LineFeature = Feature<MultiLineString, LineProps>;

/** Calls `fn` with every arc index (≥ 0) of a Polygon or MultiPolygon topology geometry. */
function forEachArc(g: TopoGeometry, fn: (arc: number) => void): void {
  const visitRing = (ring: unknown) => {
    for (const a of ring as number[]) fn(a < 0 ? ~a : a);
  };
  if (g.type === 'Polygon') for (const ring of g.arcs as unknown[]) visitRing(ring);
  else if (g.type === 'MultiPolygon') for (const poly of g.arcs as unknown[][]) for (const ring of poly) visitRing(ring);
}

/**
 * Coast arcs of these geometries: arcs used exactly once, i.e. with a feature on one
 * side and nothing alive on the other (1 marks a coast arc). An arc used twice by the
 * same feature is an internal seam or a zero-width spike, so it is neither coast nor
 * border (topojson's mesh with `(a, b) => a === b` would draw it as coast).
 */
export function coastArcs(topology: Topology, geometries: readonly TopoGeometry[]): Uint8Array {
  const n = topology.arcs.length;
  const uses = new Uint8Array(n);
  for (const g of geometries) {
    forEachArc(g, (a) => {
      if ((uses[a] as number) < 2) uses[a] = (uses[a] as number) + 1;
    });
  }
  const coast = new Uint8Array(n);
  for (let a = 0; a < n; a++) if (uses[a] === 1) coast[a] = 1;
  return coast;
}

/** FNV-1a over the set arcs, plus their count: a cache key (entries are verified on a hit). */
function arcSetKey(bits: Uint8Array): string {
  let h = 0x811c9dc5;
  let count = 0;
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === 0) continue;
    count += 1;
    h = Math.imul(h ^ i, 0x01000193) >>> 0;
  }
  return `${count}:${h.toString(36)}`;
}

const sameBits = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * Coast features built for a chunk, by arc set. Within one chunk most frames share
 * their coastline (the tier-0 features partition the same land), so the coast — about
 * 90 % of all line vertices — is built once and the same Feature object is returned for
 * every frame with that coastline.
 */
const coastCache = new WeakMap<PreparedChunk, Map<string, { bits: Uint8Array; feature: LineFeature | null }[]>>();

function cachedCoast(chunk: PreparedChunk, geometries: readonly TopoGeometry[]): LineFeature | null {
  const bits = coastArcs(chunk.topology, geometries);
  const key = arcSetKey(bits);
  let byKey = coastCache.get(chunk);
  if (!byKey) coastCache.set(chunk, (byKey = new Map()));
  const entries = byKey.get(key) ?? [];
  const hit = entries.find((e) => sameBits(e.bits, bits));
  if (hit) return hit.feature;
  // One line per arc (no stitching): the arcs are absolute after prepareChunk and are
  // shared read-only, like every decoded position.
  const arcs = chunk.topology.arcs as Position[][];
  const lines: Position[][] = [];
  for (let a = 0; a < bits.length; a++) if (bits[a] === 1) lines.push(arcs[a] as Position[]);
  const coordinates = dropCutEdges(lines);
  const feature: LineFeature | null =
    coordinates.length > 0 ? { type: 'Feature', properties: { kind: 'coast' }, geometry: { type: 'MultiLineString', coordinates } } : null;
  entries.push({ bits, feature });
  byKey.set(key, entries);
  return feature;
}

/**
 * Lines of the tier-0 geometries alive in `year`. An arc used by two different
 * features is a 'border' (including frontiers with unclaimed land; topojson mesh,
 * stitched into long lines); an arc used by exactly one feature is 'coast' (one line
 * per arc). Edges that only exist because the data is cut at the antimeridian or
 * closed at a pole (Antarctica's ±180° and −90° edges) are dropped.
 *
 * Frames of one chunk whose coastline is identical get the identical coast Feature
 * object (`===`), so a renderer can skip re-uploading it; like every decoded result it
 * is shared and must be treated as read-only.
 */
export function decodeLines(chunk: PreparedChunk, year: HistYear): FeatureCollection<MultiLineString, LineProps> {
  const geometries = aliveIn(chunk, year, 0);
  const features: LineFeature[] = [];
  const collection: TopoGeometry = { type: 'GeometryCollection', geometries };
  const borders = dropCutEdges(toMesh(chunk.topology, collection, (a, b) => a !== b).coordinates);
  if (borders.length > 0) {
    features.push({ type: 'Feature', properties: { kind: 'border' }, geometry: { type: 'MultiLineString', coordinates: borders } });
  }
  const coast = cachedCoast(chunk, geometries);
  if (coast) features.push(coast);
  return { type: 'FeatureCollection', features };
}

// Decoded coordinates of points on the antimeridian/poles are exact up to float noise
// (quantised grid steps are >= 1e-5 degrees), so a tiny epsilon is enough.
const EPS = 1e-7;
/** Both values at +limit, or both at −limit (one edge of the lon/lat rectangle). */
const sameEdge = (u: number, v: number, limit: number) =>
  (u >= limit - EPS && v >= limit - EPS) || (u <= -limit + EPS && v <= -limit + EPS);

/**
 * True for a segment lying on the +180° or −180° meridian, or on a pole. A segment
 * from +180° to −180° is not one: it runs along a parallel and may be real coast.
 */
export function isCutEdge(a: Position, b: Position): boolean {
  return sameEdge(a[0] as number, b[0] as number, 180) || sameEdge(a[1] as number, b[1] as number, 90);
}

/** Splits lines at cut edges (see isCutEdge) and drops parts shorter than two points. */
export function dropCutEdges(lines: Position[][]): Position[][] {
  const out: Position[][] = [];
  for (const line of lines) {
    let part: Position[] = [];
    for (const p of line) {
      const prev = part[part.length - 1];
      if (prev && isCutEdge(prev, p)) {
        if (part.length > 1) out.push(part);
        part = [];
      }
      part.push(p);
    }
    if (part.length > 1) out.push(part);
  }
  return out;
}

/** Every object of a base-layer topology (land, lakes) as one FeatureCollection. */
export function decodeBase(json: unknown, url: string): FeatureCollection {
  if (!isTopology(json)) throw new Error(`@alexs-atlas/borders: ${url} is not a TopoJSON Topology`);
  absolutise(json);
  const features: Feature[] = [];
  for (const object of Object.values(json.objects)) {
    const decoded = toFeature(json, object);
    const list = decoded.type === 'FeatureCollection' ? decoded.features : [decoded];
    for (const f of list) if (f.geometry) features.push(f as Feature);
  }
  return { type: 'FeatureCollection', features };
}
