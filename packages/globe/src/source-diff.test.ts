// SourceMirror: what a year change sends to the frame source, and that MapLibre's copy
// of the source ends up exactly as the next set of features after each diff.
import { describe, expect, it } from 'vitest';
import type { Feature, Position } from '@alexs-atlas/borders';
import { FULL_BELOW, SourceMirror, type SourceDiff, type SourceFeature } from './source-diff.js';

const ring = (x: number, y: number, size = 1): Position[] => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y],
];
const poly = (record: number, x: number, y: number, more: Record<string, unknown> = {}): Feature => ({
  type: 'Feature',
  id: record,
  geometry: { type: 'Polygon', coordinates: [ring(x, y)] },
  properties: { id: record, kind: 'state', tier: 0, a: 10, c: 1, ...more },
});
/** The same feature decoded again: equal values in new arrays. */
const redecoded = (f: Feature): Feature => JSON.parse(JSON.stringify(f)) as Feature;

/** MapLibre's handling of a diff on its copy of the source (geojson_source_diff.ts applySourceDiff). */
function apply(source: Map<number, SourceFeature>, diff: SourceDiff): void {
  for (const id of diff.remove) source.delete(id);
  for (const f of diff.add) source.set(f.id, f);
  for (const u of diff.update) {
    const f = source.get(u.id);
    if (!f) continue;
    const properties = { ...(f.properties ?? {}) };
    for (const k of u.removeProperties ?? []) delete properties[k];
    for (const { key, value } of u.addOrUpdateProperties ?? []) properties[key] = value;
    source.set(u.id, { ...f, properties });
  }
}

/** Sends an update the way BorderLayers does, onto a model of MapLibre's source. */
function send(mirror: SourceMirror, source: Map<number, SourceFeature>, features: Feature[]): ReturnType<SourceMirror['update']> {
  const u = mirror.update(features);
  if (u.diff) apply(source, u.diff);
  else {
    source.clear();
    for (const f of mirror.features()) source.set(f.id, f);
  }
  return u;
}

/** The source's content without ids (properties in key order), for comparison with the features sent. */
const content = (fs: Iterable<Feature>): string[] =>
  [...fs].map((f) => JSON.stringify([f.geometry, Object.entries(f.properties ?? {}).sort(([a], [b]) => a.localeCompare(b))])).sort();

describe('SourceMirror', () => {
  it('sends the first set whole, with ids of its own from 1', () => {
    const m = new SourceMirror();
    const u = m.update([poly(7, 0, 0), poly(7, 5, 0), poly(9, 2, 2)]);
    expect(u.diff).toBeNull();
    expect(u.total).toBe(12);
    expect(m.features().map((f) => f.id)).toEqual([1, 2, 3]);
    expect(m.features().map((f) => f.properties!.id)).toEqual([7, 7, 9]); // the record stays a property
  });

  it('sends nothing again for features already on the map (same objects or re-decoded)', () => {
    const m = new SourceMirror();
    const a = [poly(1, 0, 0), poly(2, 3, 0)];
    m.update(a);
    expect(m.update(a).diff).toEqual({ remove: [], add: [], update: [] });
    const u = m.update(a.map(redecoded));
    expect(u.diff).toEqual({ remove: [], add: [], update: [] });
    expect(u.kept).toBe(u.total);
  });

  it('keeps a shape that changed records, updating only its properties', () => {
    const m = new SourceMirror();
    m.update([poly(1, 0, 0, { precision: 'approximate' }), poly(2, 3, 0)]);
    const u = m.update([poly(5, 0, 0, { c: 4 }), redecoded(poly(2, 3, 0))]);
    expect(u.diff!.add).toEqual([]);
    expect(u.diff!.remove).toEqual([]);
    expect(u.diff!.update).toEqual([
      {
        id: 1,
        addOrUpdateProperties: [
          { key: 'id', value: 5 },
          { key: 'c', value: 4 },
        ],
        removeProperties: ['precision'],
      },
    ]);
  });

  it('adds new shapes with fresh ids and removes the ones that are gone', () => {
    const m = new SourceMirror();
    m.update([poly(1, 0, 0), poly(2, 3, 0), poly(3, 6, 0), poly(4, 9, 0)]);
    const u = m.update([poly(1, 0, 0), poly(2, 3, 0), poly(3, 6, 0), poly(4, 9.5, 0)]);
    expect(u.diff!.remove).toEqual([4]);
    expect(u.diff!.add.map((f) => f.id)).toEqual([5]);
    const v = m.update([poly(1, 0, 0), poly(2, 3, 0), poly(3, 6, 0), poly(4, 9, 0)]);
    expect(v.diff!.add.map((f) => f.id)).toEqual([6]); // an id is never reused
    expect(v.diff!.remove).toEqual([5]);
  });

  it('never turns a polygon into a line of the same points', () => {
    const m = new SourceMirror();
    const coords = [ring(0, 0)];
    m.update([
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: coords }, properties: { id: 1 } },
      poly(2, 3, 0),
      poly(3, 6, 0),
    ]);
    const u = m.update([
      { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [ring(0, 0), ring(0, 0)] }, properties: { kind: 'border' } },
      { type: 'Feature', geometry: { type: 'LineString', coordinates: ring(0, 0) }, properties: { kind: 'border' } },
      poly(2, 3, 0),
      poly(3, 6, 0),
    ]);
    expect(u.diff!.remove).toEqual([1]);
    expect(u.diff!.add.map((f) => f.geometry.type)).toEqual(['MultiLineString', 'LineString']);
  });

  it('keeps an entry at most once when a shape appears twice', () => {
    const m = new SourceMirror();
    m.update([poly(1, 0, 0), poly(2, 3, 0), poly(3, 6, 0)]);
    const u = m.update([poly(1, 0, 0), poly(9, 0, 0), poly(2, 3, 0), poly(3, 6, 0)]);
    expect(u.diff!.add).toHaveLength(1);
    expect(u.diff!.add[0]!.properties!.id).toBe(9);
    expect(new Set(m.features().map((f) => f.id)).size).toBe(4);
  });

  it('treats a one-part MultiPolygon as its polygon', () => {
    const m = new SourceMirror();
    m.update([poly(1, 0, 0), poly(2, 3, 0)]);
    const u = m.update([
      { type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: [[ring(0, 0)]] }, properties: { id: 1, kind: 'state', tier: 0, a: 10, c: 1 } },
      poly(2, 3, 0),
    ]);
    expect(u.diff).toEqual({ remove: [], add: [], update: [] });
  });

  it(`sends the whole set when less than ${FULL_BELOW * 100} % of it is on the map (another level of detail)`, () => {
    const m = new SourceMirror();
    m.update(Array.from({ length: 20 }, (_, i) => poly(i + 1, i * 2, 0)));
    const u = m.update([poly(1, 0, 0), ...Array.from({ length: 19 }, (_, i) => poly(i + 2, i * 2 + 0.5, 1))]);
    expect(u.diff).toBeNull();
    expect(m.features().map((f) => f.id)).toEqual(Array.from({ length: 20 }, (_, i) => 21 + i));
  });

  it('lists the ids of every part of a record, following the updates', () => {
    const m = new SourceMirror();
    m.update([poly(7, 0, 0), poly(7, 5, 0), poly(9, 2, 2)]);
    expect(m.idsOf(7)).toEqual([1, 2]);
    expect(m.idsOf(8)).toEqual([]);
    m.update([poly(7, 0, 0), poly(8, 5, 0), poly(9, 2, 2), poly(7, 20, 0)]);
    expect(m.idsOf(7)).toEqual([1, 4]);
    expect(m.idsOf(8)).toEqual([2]);
  });

  it('sends the whole set again after clear()', () => {
    const m = new SourceMirror();
    m.update([poly(1, 0, 0)]);
    m.clear();
    expect(m.features()).toEqual([]);
    expect(m.update([poly(1, 0, 0)]).diff).toBeNull();
  });

  it('leaves MapLibre\'s copy of the source equal to each next set (random frames)', () => {
    let seed = 42;
    const random = (): number => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    // A pool of shapes; each frame takes some of them, under varying records and properties.
    const shapes = Array.from({ length: 60 }, (_, i) => [ring(i % 10, Math.floor(i / 10), 0.5 + (i % 3) * 0.25)]);
    const mirror = new SourceMirror();
    const source = new Map<number, SourceFeature>();
    let diffs = 0;
    for (let frame = 0; frame < 200; frame++) {
      const features: Feature[] = [];
      for (const coords of shapes) {
        if (random() < 0.35) continue;
        const record = 1 + Math.floor(random() * 8);
        const props: Record<string, unknown> = { id: record, kind: random() < 0.1 ? 'unclaimed' : 'state', tier: random() < 0.1 ? 1 : 0, c: record % 3 };
        if (random() < 0.3) props.precision = 'approximate';
        const geometry = random() < 0.5 ? { type: 'Polygon' as const, coordinates: coords } : { type: 'Polygon' as const, coordinates: JSON.parse(JSON.stringify(coords)) as Position[][] };
        features.push({ type: 'Feature', geometry, properties: props });
        if (random() < 0.05) features.push({ type: 'Feature', geometry, properties: { ...props, id: record + 100 } }); // a shape twice
      }
      if (random() < 0.2) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [ring(random() * 9, 1), ring(2, 2)] }, properties: { kind: 'border' } });
      const u = send(mirror, source, features);
      if (u.diff) diffs++;
      expect(content(source.values())).toEqual(content(features));
      expect(new Set([...source.keys()]).size).toBe(source.size);
      for (const [id, f] of source) expect(f.id).toBe(id);
    }
    expect(diffs).toBeGreaterThan(150); // most frames went as diffs
  });
});
