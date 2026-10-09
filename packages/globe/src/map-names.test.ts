// MapNames against a small fake map (no canvas container, so nothing is painted) with
// injected font metrics: which records are named, in which form, in which order, and
// that arcs are found asynchronously and cached by record.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Polygon } from '@alexs-atlas/borders';
import { MapNames } from './map-names.js';
import { nameArcs } from './name-arcs.js';
import type { PolityFeatureLike, PolityProps } from './types.js';

vi.mock('./name-arcs.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./name-arcs.js')>();
  return { ...mod, nameArcs: vi.fn(mod.nameArcs) };
});

const arcCalls = vi.mocked(nameArcs);
const METRICS = { advance: () => 0.7, capHeight: 0.7 };

type Handler = () => void;

class FakeMap {
  handlers = new Map<string, Set<Handler>>();
  repaints = 0;
  on(type: string, fn: Handler): { unsubscribe(): void } {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return { unsubscribe: () => void this.handlers.get(type)?.delete(fn) };
  }
  fire(type: string): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn();
  }
  count(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
  triggerRepaint(): void {
    this.repaints++;
  }
  getZoom(): number {
    return 2;
  }
  getCenter(): { lng: number; lat: number } {
    return { lng: 0, lat: 0 };
  }
  getCanvas(): { clientWidth: number; clientHeight: number } {
    return { clientWidth: 800, clientHeight: 600 };
  }
}

const rect = (w: number, s: number, e: number, n: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

let nextId = 1;
function feature(name: string, geometry: Polygon, over: Partial<PolityProps> = {}): PolityFeatureLike {
  const id = nextId++;
  const pid = over.pid ?? `clio:${name.toLowerCase().replace(/\W+/g, '-') || 'unnamed'}-${id}`;
  const properties: PolityProps = {
    id,
    rid: `${pid}@1900`,
    pid,
    name,
    from: 1900,
    to: 1999,
    kind: 'state',
    tier: 0,
    power: pid,
    partof: null,
    subjecto: null,
    disputed: false,
    precision: 'exact',
    c: id % 12,
    a: 1e5,
    lx: 0,
    ly: 0,
    src: 'test',
    ...over,
  };
  return { type: 'Feature', id, geometry, properties };
}

/** Lets the time-sliced arc work run (each slice handles at least one record; tests use at most three). */
async function flush(limit = 25): Promise<void> {
  for (let i = 0; i < limit; i++) await new Promise((r) => setTimeout(r, 0));
}

const make = (map = new FakeMap()): { map: FakeMap; names: MapNames } => ({ map, names: new MapNames(map as never, { ink: '#000', seaInk: '#333', metrics: METRICS }) });
const geometriesOfCalls = (): unknown[] => arcCalls.mock.calls.map((c) => c[0]);

beforeEach(() => {
  arcCalls.mockClear();
});

describe('MapNames', () => {
  it('names tier-0 and tier-1 records, not unclaimed land or unnamed records', async () => {
    const { names } = make();
    const state = feature('Persia', rect(40, 25, 60, 35), { a: 3e6 });
    const overlay = feature('Lenape', rect(-80, 38, -72, 42), { tier: 1, kind: 'indigenous', a: 4e4 });
    const unclaimed = feature('Unclaimed land', rect(100, -30, 130, -20), { kind: 'unclaimed', a: 9e6 });
    const unnamed = feature('', rect(0, -40, 20, -30), { a: 2e6 });
    const blank = feature('   ', rect(0, 40, 20, 50), { a: 2e6 });
    const line = { ...feature('Lines', rect(0, 0, 1, 1)), geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] } } as PolityFeatureLike;
    names.show([state, overlay, unclaimed, unnamed, blank, line]);
    await flush();
    expect(names.placed().map((n) => n.key).sort()).toEqual([state.properties.rid, overlay.properties.rid].sort());
    expect(geometriesOfCalls()).toHaveLength(2); // no arcs for the others either
    const tiers = new Map(names.placed().map((n) => [n.key, n.tier]));
    expect(tiers.get(overlay.properties.rid)).toBe(1);
    expect(tiers.get(state.properties.rid)).toBe(0);
  });

  it('uses the short form of a name', async () => {
    const { names } = make();
    names.show([feature('Kingdom of France', rect(-5, 42, 8, 51)), feature('German Empire', rect(6, 47, 22, 55))]);
    await flush();
    expect(names.placed().map((n) => n.text).sort()).toEqual(['France', 'Germany']);
  });

  it('keeps the full names when two polities of the frame share a short form', async () => {
    const { names } = make();
    const a = feature('Republic of the Congo', rect(11, -5, 18, 3), { a: 3e5 });
    const b = feature('Democratic Republic of the Congo', rect(18.5, -13, 31, 5), { a: 2e6 });
    const c = feature('Kingdom of Spain', rect(-9, 36, 3, 43), { a: 5e5 });
    names.show([a, b, c]);
    await flush();
    expect(names.placed().map((n) => n.text).sort()).toEqual(['Democratic Republic of the Congo', 'Republic of the Congo', 'Spain']);
  });

  it('keeps the short form when the records sharing it are one polity', async () => {
    const { names } = make();
    const a = feature('Kingdom of France', rect(-5, 42, 8, 51), { pid: 'clio:france', rid: 'clio:france@1', a: 5e5 });
    const b = feature('Kingdom of France', rect(-61, 14, -60, 15), { pid: 'clio:france', rid: 'clio:france@2', tier: 1, a: 1e3 });
    names.show([a, b]);
    await flush();
    expect(names.placed().map((n) => n.text)).toContain('France');
    expect(names.placed().every((n) => n.text === 'France')).toBe(true);
  });

  it('finds arcs asynchronously, largest polities first, and lists names largest first', async () => {
    const { map, names } = make();
    const small = feature('Portugal', rect(-9.5, 37, -6.5, 42), { a: 9e4 });
    const big = feature('Russian Empire', rect(30, 45, 140, 70), { a: 2e7 });
    const middle = feature('Persia', rect(44, 25, 62, 38), { a: 1.6e6 });
    const repaints = map.repaints;
    names.show([small, big, middle]);
    // Nothing is computed during show(): the work runs in later time slices.
    expect(arcCalls).not.toHaveBeenCalled();
    expect(names.placed()).toEqual([]);
    await flush();
    expect(geometriesOfCalls()).toEqual([big.geometry, middle.geometry, small.geometry]);
    expect(names.placed().map((n) => n.key)).toEqual([big, middle, small].map((f) => f.properties.rid));
    const ranks = names.placed().map((n) => n.rank);
    expect([...ranks].sort((x, y) => y - x)).toEqual(ranks);
    expect(map.repaints).toBeGreaterThan(repaints); // the map repaints to show them
  });

  it('works in time slices, showing the names that are ready after each', async () => {
    // A clock that jumps 10 ms per reading: every slice runs out after one record.
    let t = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (t += 10));
    try {
      const { names } = make();
      names.show([
        feature('Persia', rect(44, 25, 62, 38), { a: 1.6e6 }),
        feature('Kingdom of Spain', rect(-9, 36, 3, 43), { a: 5e5 }),
        feature('Kingdom of Portugal', rect(-9.5, 37, -6.5, 42), { a: 9e4 }),
      ]);
      const seen: number[] = [];
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 0));
        seen.push(arcCalls.mock.calls.length);
        expect(names.placed()).toHaveLength(arcCalls.mock.calls.length);
      }
      expect(seen).toEqual([1, 2, 3, 3]);
    } finally {
      clock.mockRestore();
    }
  });

  it('caches arcs by record: the same records again need no new arc work', async () => {
    const { names } = make();
    const a = feature('Persia', rect(44, 25, 62, 38), { a: 1.6e6 });
    const b = feature('Kingdom of Spain', rect(-9, 36, 3, 43), { a: 5e5 });
    names.show([a, b]);
    await flush();
    expect(arcCalls).toHaveBeenCalledTimes(2);
    const before = names.placed();
    // The same records (a new array, another order, copies of the features): nothing new.
    names.show([{ ...b }, { ...a }]);
    await flush();
    expect(arcCalls).toHaveBeenCalledTimes(2);
    expect(names.placed().map((n) => n.key)).toEqual(before.map((n) => n.key));
    // A subset, then the set again plus one more: only the new record's arc is found.
    names.show([a]);
    await flush();
    expect(names.placed().map((n) => n.key)).toEqual([a.properties.rid]);
    const c = feature('Kingdom of Portugal', rect(-9.5, 37, -6.5, 42), { a: 9e4 });
    names.show([a, b, c]);
    await flush();
    expect(arcCalls).toHaveBeenCalledTimes(3);
    expect(arcCalls.mock.calls.at(-1)![0]).toBe(c.geometry);
    expect(names.placed()).toHaveLength(3);
  });

  it('reuses a cached arc when a record changes its text (a short form becomes shared)', async () => {
    const { names } = make();
    const a = feature('Republic of the Congo', rect(11, -5, 18, 3), { a: 3e5 });
    names.show([a]);
    await flush();
    expect(names.placed().map((n) => n.text)).toEqual(['Congo']);
    expect(arcCalls).toHaveBeenCalledTimes(1);
    const b = feature('Democratic Republic of the Congo', rect(18.5, -13, 31, 5), { a: 2e6 });
    names.show([a, b]);
    await flush();
    expect(names.placed().map((n) => n.text).sort()).toEqual(['Democratic Republic of the Congo', 'Republic of the Congo']);
    expect(arcCalls).toHaveBeenCalledTimes(2); // only b's; a's text changed, its arc did not
    expect(arcCalls.mock.calls.at(-1)![0]).toBe(b.geometry);
  });

  it('paints nothing without a canvas, and hides and recolours without errors', async () => {
    const { map, names } = make();
    names.show([feature('Persia', rect(44, 25, 62, 38))]);
    await flush();
    expect(() => map.fire('render')).not.toThrow();
    const r = map.repaints;
    names.setVisible(false);
    names.setVisible(false); // no change: no repaint
    names.setColors('#fff', '#eee');
    expect(map.repaints).toBe(r + 2);
    expect(names.placed()).toHaveLength(1); // hidden names stay set
  });

  it('remove() unsubscribes from the map and stops the work in progress', async () => {
    const { map, names } = make();
    expect(map.count('render')).toBe(1);
    names.show([feature('Persia', rect(44, 25, 62, 38)), feature('Kingdom of Spain', rect(-9, 36, 3, 43))]);
    names.remove();
    expect(map.count('render')).toBe(0);
    await flush();
    expect(arcCalls).not.toHaveBeenCalled();
    expect(names.placed()).toEqual([]);
    // Later calls do nothing.
    names.show([feature('Kingdom of Portugal', rect(-9.5, 37, -6.5, 42))]);
    await flush();
    expect(arcCalls).not.toHaveBeenCalled();
    expect(() => names.remove()).not.toThrow();
  });
});
