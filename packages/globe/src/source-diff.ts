// Year changes as diffs. MapLibre serialises every feature a GeoJSON source is given to
// its worker, which was most of a timeline drag's main-thread work once the country
// names were fast (AGENTS.md §7.3), yet most of a frame is already on the map: in a drag
// across 1789–1900 about two thirds of each frame's polygon points are in parts the
// frame before it had, many under another record (a new record of the same shape) or
// decoded from the neighbouring chunk.
//
// SourceMirror holds what the frame source holds — each feature with an id of its own,
// its geometry and properties — and turns the next set of features into a
// GeoJSONSource.updateData diff: a feature whose exact geometry is on the map stays
// (its properties updated when they differ), the rest is added, and what is gone is
// removed. When little of the next set is on the map (another level of detail), it is
// sent whole. Pure logic: the map is the caller's.
import type { Feature, Geometry, Position } from '@alexs-atlas/borders';

type Props = Record<string, unknown>;

/** A feature as the frame source holds it: `id` is its own, unique on the source (from 1). */
export interface SourceFeature extends Feature {
  id: number;
}

/** A property-only change of one feature (MapLibre's GeoJSONFeatureDiff). */
export interface PropertyUpdate {
  id: number;
  addOrUpdateProperties?: { key: string; value: unknown }[];
  removeProperties?: string[];
}

/** A GeoJSONSource.updateData diff (MapLibre's GeoJSONSourceDiff). */
export interface SourceDiff {
  remove: number[];
  add: SourceFeature[];
  update: PropertyUpdate[];
}

/** What to send for the next set of features. */
export interface SourceUpdate {
  /** The diff, or null to send the whole set (`SourceMirror.features()`) with setData. */
  diff: SourceDiff | null;
  /** Positions in the features already on the map, which are not sent again. */
  kept: number;
  /** Positions in the whole set. */
  total: number;
}

/** Below this share of positions already on the map, the whole set is sent instead of a diff. */
export const FULL_BELOW = 0.1;

/** What is compared: a polygon's rings (or polygons) or a feature's lines, `depth` levels above the positions. */
interface Shape {
  line: boolean;
  depth: number;
  coords: unknown[];
}

/**
 * The comparable shape of a geometry. A one-part MultiPolygon is its polygon and a
 * one-line MultiLineString its line: MapLibre draws them alike. Points and the rest
 * are never kept (null).
 */
function shapeOf(g: Geometry | null): Shape | null {
  switch (g?.type) {
    case 'Polygon':
      return { line: false, depth: 2, coords: g.coordinates };
    case 'MultiPolygon':
      return g.coordinates.length === 1 ? { line: false, depth: 2, coords: g.coordinates[0] as Position[][] } : { line: false, depth: 3, coords: g.coordinates };
    case 'LineString':
      return { line: true, depth: 1, coords: g.coordinates };
    case 'MultiLineString':
      return g.coordinates.length === 1 ? { line: true, depth: 1, coords: g.coordinates[0] as Position[] } : { line: true, depth: 2, coords: g.coordinates };
    default:
      return null;
  }
}

/** Number of positions under `a`, `depth` levels above them. */
function countPositions(a: unknown[], depth: number): number {
  if (depth === 1) return a.length;
  let n = 0;
  for (const x of a) n += countPositions(x as unknown[], depth - 1);
  return n;
}

/**
 * A lookup key of a shape: its kind, the lengths along its first elements and its first
 * position. Equal shapes have equal keys; unequal ones rarely do, and every candidate is
 * compared in full (sameCoords) before it is kept.
 */
function shapeKey(s: Shape): number {
  let h = s.line ? 2 : 1;
  let a = s.coords;
  for (let level = s.depth; level > 1 && a.length > 0; level--) {
    h = (h * 31 + a.length) % 1000003;
    a = a[0] as unknown[];
  }
  h = (h * 31 + a.length) % 1000003;
  const p = a[0] as Position | undefined;
  return p ? h + (p[0] as number) * 3.6e6 + (p[1] as number) * 1e4 : h;
}

/**
 * Exact comparison, `depth` levels above the positions. Positions are compared by
 * reference first: frames decoded from one chunk share their position arrays.
 */
function sameCoords(a: unknown[], b: unknown[], depth: number): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  if (depth === 1) {
    for (let i = 0; i < a.length; i++) {
      const p = a[i] as Position;
      const q = b[i] as Position;
      if (p !== q && (p[0] !== q[0] || p[1] !== q[1])) return false;
    }
    return true;
  }
  for (let i = 0; i < a.length; i++) if (!sameCoords(a[i] as unknown[], b[i] as unknown[], depth - 1)) return false;
  return true;
}

const sameShape = (a: Shape, b: Shape): boolean => a.line === b.line && a.depth === b.depth && sameCoords(a.coords, b.coords, a.depth);

/** The property changes from `a` to `b` (undefined: none). */
function propertyChange(a: Props | null, b: Props | null): Omit<PropertyUpdate, 'id'> | undefined {
  if (a === b) return undefined;
  const set: { key: string; value: unknown }[] = [];
  const removed: string[] = [];
  if (b) for (const k in b) if (!a || a[k] !== b[k] || !(k in a)) set.push({ key: k, value: b[k] });
  if (a) for (const k in a) if (!b || !(k in b)) removed.push(k);
  if (set.length === 0 && removed.length === 0) return undefined;
  const out: Omit<PropertyUpdate, 'id'> = {};
  if (set.length) out.addOrUpdateProperties = set;
  if (removed.length) out.removeProperties = removed;
  return out;
}

interface Entry {
  feature: SourceFeature;
  shape: Shape | null;
  key: number | null;
  /** The last update that kept this entry (each entry is kept at most once per update). */
  round: number;
}

export class SourceMirror {
  private entries: Entry[] = [];
  private byKey = new Map<number, Entry[]>();
  private byRecord: Map<number, number[]> | null = null;
  private nextId = 1;
  private round = 0;

  /** The features on the source (for a full setData). */
  features(): SourceFeature[] {
    return this.entries.map((e) => e.feature);
  }

  /** Ids of the features on the source whose `recordKey` property is `record` (all parts of a polity). */
  idsOf(record: number, recordKey = 'id'): number[] {
    if (!this.byRecord) {
      this.byRecord = new Map();
      for (const e of this.entries) {
        const r = Number(e.feature.properties?.[recordKey]);
        if (!Number.isFinite(r)) continue;
        const ids = this.byRecord.get(r);
        if (ids) ids.push(e.feature.id);
        else this.byRecord.set(r, [e.feature.id]);
      }
    }
    return this.byRecord.get(record) ?? [];
  }

  /** Forgets the source's content: the next update sends the whole set (after a source reset). */
  clear(): void {
    this.set([]);
  }

  /**
   * The update from what the source holds to `features`, which the mirror holds from
   * now on: the caller must send it (a diff with updateData, or `features()` with
   * setData when `diff` is null), and in order with any other update.
   */
  update(features: readonly Feature[]): SourceUpdate {
    const round = ++this.round;
    const next: Entry[] = [];
    const fresh: { feature: Feature; shape: Shape | null; key: number | null }[] = [];
    const updates: PropertyUpdate[] = [];
    let kept = 0;
    let total = 0;
    for (const f of features) {
      const shape = shapeOf(f.geometry as Geometry | null);
      const n = shape ? countPositions(shape.coords, shape.depth) : 1;
      total += n;
      const key = shape ? shapeKey(shape) : null;
      const hit = shape && key !== null ? this.find(key, shape, round) : undefined;
      if (!hit) {
        fresh.push({ feature: f, shape, key });
        continue;
      }
      hit.round = round;
      kept += n;
      const id = hit.feature.id;
      const change = propertyChange(hit.feature.properties as Props | null, f.properties as Props | null);
      if (change) updates.push({ id, ...change });
      next.push({ feature: { type: 'Feature', id, geometry: f.geometry, properties: f.properties }, shape, key, round });
    }
    if (this.entries.length === 0 || kept < FULL_BELOW * total) {
      this.set(fresh.length === features.length ? fresh.map((x) => this.entry(x.feature, x.shape, x.key)) : features.map((f) => this.entryOf(f)));
      return { diff: null, kept: 0, total };
    }
    const remove: number[] = [];
    for (const e of this.entries) if (e.round !== round) remove.push(e.feature.id);
    const add: SourceFeature[] = [];
    for (const x of fresh) {
      const e = this.entry(x.feature, x.shape, x.key);
      next.push(e);
      add.push(e.feature);
    }
    this.set(next);
    return { diff: { remove, add, update: updates }, kept, total };
  }

  /** An entry on the source that has `shape` and was not kept yet in this update. */
  private find(key: number, shape: Shape, round: number): Entry | undefined {
    for (const e of this.byKey.get(key) ?? []) {
      if (e.round !== round && e.shape && sameShape(e.shape, shape)) return e;
    }
    return undefined;
  }

  private entryOf(f: Feature): Entry {
    const shape = shapeOf(f.geometry as Geometry | null);
    return this.entry(f, shape, shape ? shapeKey(shape) : null);
  }

  /** A new entry with an id never used on this source (so no stale feature-state applies to it). */
  private entry(f: Feature, shape: Shape | null, key: number | null): Entry {
    return { feature: { type: 'Feature', id: this.nextId++, geometry: f.geometry, properties: f.properties }, shape, key, round: this.round };
  }

  private set(entries: Entry[]): void {
    this.entries = entries;
    this.byRecord = null;
    this.byKey = new Map();
    for (const e of entries) {
      if (e.key === null) continue;
      const list = this.byKey.get(e.key);
      if (list) list.push(e);
      else this.byKey.set(e.key, [e]);
    }
  }
}
