// addBorderLayers against a fake MapLibre map and a fake BordersClient:
// sources/layers, frame changes (only when the frame or LOD changes, latest
// wins), base land hand-off, LOD switching, hover, click-select, remove().
import { describe, expect, it, vi } from 'vitest';
import { addBorderLayers, formatSpan, hoverLabel, pickOrder } from './border-layers.js';
import { borderIds, layerOrder } from './style.js';
import type { BordersClient, Manifest, PolityProps } from './types.js';

type Handler = (e?: unknown) => void;

class FakeSource {
  data: unknown = null;
  setCalls = 0;
  constructor(readonly spec: unknown) {}
  setData(d: unknown): Promise<void> {
    this.data = d;
    this.setCalls++;
    return Promise.resolve();
  }
}

class FakeMap {
  handlers = new Map<string, Set<Handler>>();
  sources = new Map<string, FakeSource>();
  layers: { id: string; before?: string }[] = [];
  layout = new Map<string, Record<string, unknown>>();
  images = new Set<string>();
  states = new Map<string | number, Record<string, unknown>>();
  zoom = 1.5;
  moving = false;
  rendered: PolityProps[] = [];
  canvas = { setAttribute: vi.fn(), clientWidth: 800, clientHeight: 600 };
  /** View for culling: centre and degrees per pixel (a flat stand-in for the globe). */
  center = { lng: 0, lat: 0 };
  degPerPx = 0.3;

  on(type: string, fn: Handler): { unsubscribe(): void } {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(fn);
    return { unsubscribe: () => this.off(type, fn) };
  }
  off(type: string, fn: Handler): this {
    this.handlers.get(type)?.delete(fn);
    return this;
  }
  fire(type: string, e?: unknown): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(e);
  }
  addSource(id: string, spec: unknown): void {
    this.sources.set(id, new FakeSource(spec));
  }
  getSource(id: string): FakeSource | undefined {
    return this.sources.get(id);
  }
  removeSource(id: string): void {
    this.sources.delete(id);
  }
  addLayer(spec: { id: string; layout?: Record<string, unknown> }, before?: string): void {
    const i = before ? this.layers.findIndex((l) => l.id === before) : -1;
    const entry = { id: spec.id, before };
    if (i >= 0) this.layers.splice(i, 0, entry);
    else this.layers.push(entry);
    this.layout.set(spec.id, { ...(spec.layout ?? {}) });
  }
  getLayer(id: string): unknown {
    return this.layers.find((l) => l.id === id);
  }
  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }
  setLayoutProperty(id: string, k: string, v: unknown): void {
    this.layout.get(id)![k] = v;
  }
  setPaintProperty(): void {}
  addImage(id: string): void {
    this.images.add(id);
  }
  hasImage(id: string): boolean {
    return this.images.has(id);
  }
  removeImage(id: string): void {
    this.images.delete(id);
  }
  setFeatureState(t: { id: string | number }, s: Record<string, unknown>): void {
    this.states.set(t.id, { ...(this.states.get(t.id) ?? {}), ...s });
  }
  queryRenderedFeatures(): { properties: PolityProps }[] {
    return this.rendered.map((p) => ({ properties: p }));
  }
  isSourceLoaded(): boolean {
    return true;
  }
  triggerRepaint(): void {
    queueMicrotask(() => this.fire('render'));
  }
  getZoom(): number {
    return this.zoom;
  }
  isMoving(): boolean {
    return this.moving;
  }
  getCanvas(): { setAttribute: unknown } {
    return this.canvas;
  }
  getCenter(): { lng: number; lat: number } {
    return this.center;
  }
  unproject([x, y]: [number, number]): { lng: number; lat: number } {
    const lat = this.center.lat - (y - this.canvas.clientHeight / 2) * this.degPerPx;
    return { lng: this.center.lng + (x - this.canvas.clientWidth / 2) * this.degPerPx, lat: Math.max(-90, Math.min(90, lat)) };
  }
}

const MANIFEST = {
  schema: 'alexs-atlas.borders/1',
  years: { convention: 'historical-no-zero', from: -3400, to: 2026, present: 2026, cutover: 1946 },
  lods: [
    { id: 'l0', toleranceM: 5000, minZoom: -2 },
    { id: 'l1', toleranceM: 1000, minZoom: 3 },
  ],
  base: { land: { l0: 'base/land-l0.json' }, lakes: { l0: 'base/lakes-l0.json', l1: 'base/lakes-l1.json' } },
} as unknown as Manifest;

function props(id: number, pid: string, over: Partial<PolityProps> = {}): PolityProps {
  return {
    id,
    rid: `${pid}@1900`,
    pid,
    name: pid.replace(/^.*:/, ''),
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
    a: 1000 * id,
    lx: 0,
    ly: 0,
    src: 'test',
    ...over,
  };
}
const square = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };

const box = (x: number, y: number): unknown => ({ type: 'Polygon', coordinates: [[[x, y], [x + 1, y], [x + 1, y + 1], [x, y]]] });
/** One coast object per chunk of 300 years, shared by its frames (as the borders client does). */
const coasts = new Map<number, unknown>();
const coastOf = (year: number): unknown => {
  const chunk = Math.floor(year / 300);
  if (!coasts.has(chunk)) {
    coasts.set(chunk, {
      type: 'Feature',
      properties: { kind: 'coast' },
      geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]], [[120, 0], [121, 1]]] },
    });
  }
  return coasts.get(chunk);
};

const twoParts = { type: 'MultiPolygon', coordinates: [square.coordinates, [[[3, 0], [4, 0], [4, 1], [3, 0]]]] };

function fakeClient(opts: { partition?: boolean; coast?: boolean; spread?: boolean; multi?: boolean } = {}): BordersClient & { calls: { year: number; lod: string | undefined }[] } {
  const calls: { year: number; lod: string | undefined }[] = [];
  const frameOf = (y: number): { from: number; to: number } => {
    const from = Math.floor(y / 100) * 100;
    return { from, to: from + 99 };
  };
  const client = {
    calls,
    ready: () => Promise.resolve(MANIFEST),
    frameOf,
    bordersAt: async (year: number, o?: { lod?: string }) => {
      calls.push({ year, lod: o?.lod });
      const f = frameOf(year).from;
      return {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: f + 1, geometry: opts.spread ? box(120, 0) : opts.multi ? twoParts : square, properties: props(f + 1, `clio:big-${f}`, { a: 5e6 }) },
          { type: 'Feature', id: f + 2, geometry: square, properties: props(f + 2, `clio:small-${f}`, { a: 2e3 }) },
          { type: 'Feature', id: f + 3, geometry: square, properties: props(f + 3, `ovr:nation-${f}`, { a: 9e4, tier: 1, kind: 'indigenous' }) },
          ...(opts.partition === false
            ? []
            : [{ type: 'Feature', id: f + 4, geometry: square, properties: props(f + 4, 'none', { name: '', kind: 'unclaimed', a: 1e6 }) }]),
        ],
      };
    },
    linesAt: async (year: number) => ({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0], [1, 1]]] }, properties: { kind: 'border' } },
        ...(opts.coast ? [coastOf(year)] : []),
      ],
    }),
    base: async (name: string) => ({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: square, properties: { name } }] }),
    polities: async () => ({ 'clio:small-1900': { name: 'small', kind: 'state', spans: [[1850, 1950]], bbox: [0, 0, 1, 1], src: 'test' } }),
    polity: async () => undefined,
    search: async () => [],
    prefetch: () => undefined,
  };
  return client as unknown as BordersClient & { calls: typeof calls };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 5));
};

describe('addBorderLayers', () => {
  it('adds every source and layer, in order, before the host layer', async () => {
    const map = new FakeMap();
    map.addLayer({ id: 'host-labels' });
    const borders = fakeClient();
    const h = addBorderLayers(map as never, { borders, year: 1914, beforeId: 'host-labels' });
    const ids = borderIds('ca-');
    expect(h.layerIds).toEqual(layerOrder(ids));
    expect(map.layers.map((l) => l.id)).toEqual([...layerOrder(ids), 'host-labels']);
    expect(h.sourceIds.every((s) => map.sources.has(s))).toBe(true);
    expect(map.images.has(ids.hatchImage)).toBe(true);
    await h.setYear(1914);
    h.remove();
    expect(map.layers.map((l) => l.id)).toEqual(['host-labels']);
    expect(map.sources.size).toBe(0);
    expect(map.images.size).toBe(0);
  });

  it('shows base land until the first frame, then one combined frame source', async () => {
    const map = new FakeMap();
    const borders = fakeClient();
    const onYearApplied = vi.fn();
    const h = addBorderLayers(map as never, { borders, year: 1914, onYearApplied });
    await h.firstFrame;
    await settle();
    const ids = borderIds('ca-');
    const frame = map.sources.get(ids.frameSrc)!.data as { features: { geometry: { type: string } }[] };
    expect(frame.features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Polygon', 'Polygon', 'Polygon', 'MultiLineString']);
    expect(map.layout.get(ids.baseLand)!.visibility).toBe('none');
    expect(onYearApplied).toHaveBeenCalledWith(1914);
    expect(map.sources.get(ids.lakesSrc)!.setCalls).toBe(1);
  });

  it('hands the map one feature per polygon part (same id), but keeps one feature per record', async () => {
    // A sliver part whose winding flips in tiling must not unfill the mainland (cull.ts splitParts).
    const map = new FakeMap();
    const h = addBorderLayers(map as never, { borders: fakeClient({ multi: true }), year: 1914 });
    await h.firstFrame;
    await settle();
    const frame = map.sources.get(borderIds('ca-').frameSrc)!.data as {
      features: { id?: number; geometry: { type: string }; properties: { id: number } }[];
    };
    const big = frame.features.filter((f) => f.properties.id === 1901);
    expect(big.map((f) => f.geometry.type)).toEqual(['Polygon', 'Polygon']);
    expect(big.map((f) => f.id)).toEqual([1901, 1901]);
    expect(h.frameFeatures().filter((f) => f.properties.id === 1901)).toHaveLength(1);
    expect(h.featuresOf('clio:big-1900').map((f) => f.geometry.type)).toEqual(['MultiPolygon']);
    h.remove();
  });

  it('keeps base land under frames that do not partition the land (no unclaimed features)', async () => {
    const map = new FakeMap();
    const h = addBorderLayers(map as never, { borders: fakeClient({ partition: false }), year: 1914 });
    await h.firstFrame;
    await settle();
    const ids = borderIds('ca-');
    expect(map.layout.get(ids.baseLand)!.visibility).toBe('visible');
    expect((map.sources.get(ids.baseLandSrc)!.data as { features: unknown[] }).features).toHaveLength(1);
  });

  it('reloads only when the frame changes; latest request wins', async () => {
    const map = new FakeMap();
    const borders = fakeClient();
    const h = addBorderLayers(map as never, { borders, year: 1914 });
    await h.firstFrame;
    await settle();
    const src = map.sources.get(borderIds('ca-').frameSrc)!;
    const before = src.setCalls;
    await h.setYear(1950); // same frame (1900–1999)
    expect(src.setCalls).toBe(before);
    void h.setYear(1850);
    void h.setYear(1750);
    await h.setYear(1650);
    await settle();
    const frames = borders.calls.map((c) => Math.floor(c.year / 100) * 100);
    expect(frames).not.toContain(1700); // superseded while busy: never loaded
    expect(frames.at(-1)).toBe(1600);
    expect(h.getYear()).toBe(1650);
  });

  it('switches LOD on zoomend and uses the coarsest LOD while interacting', async () => {
    const map = new FakeMap();
    const borders = fakeClient();
    const h = addBorderLayers(map as never, { borders, year: 1914 });
    await h.firstFrame;
    await settle();
    expect(borders.calls.at(-1)!.lod).toBe('l0');
    map.zoom = 4;
    map.fire('zoomend');
    await settle();
    expect(borders.calls.at(-1)).toEqual({ year: 1914, lod: 'l1' });
    h.setInteracting(true);
    await h.setYear(1814);
    expect(borders.calls.at(-1)).toEqual({ year: 1814, lod: 'l0' });
    h.setInteracting(false);
    await settle();
    expect(borders.calls.at(-1)).toEqual({ year: 1814, lod: 'l1' });
  });

  it('hover: feature-state + info with the lifespan; click: tier 1 first, else smallest area', async () => {
    const map = new FakeMap();
    const borders = fakeClient();
    const onHover = vi.fn();
    const onSelect = vi.fn();
    const h = addBorderLayers(map as never, { borders, year: 1914, onHover, onSelect });
    await h.firstFrame;
    await settle();
    map.rendered = [props(1901, 'clio:big-1900', { a: 5e6 }), props(1902, 'clio:small-1900', { a: 2e3 })];
    map.fire('mousemove', { point: { x: 10, y: 20 }, lngLat: { lng: 1, lat: 2 } });
    await settle();
    expect(map.states.get(1902)).toEqual({ hover: true });
    const info = onHover.mock.calls.at(-1)![0];
    expect(info).toMatchObject({ pid: 'clio:small-1900', id: 1902, others: 1, point: { x: 10, y: 20 }, lngLat: [1, 2] });
    expect(info.label).toBe('small-1900 · 1850–1950'); // period name + lifespan from the polity index spans
    const highlight = map.sources.get(borderIds('ca-').highlightSrc)!.data as { features: { properties: { role: string } }[] };
    expect(highlight.features.map((f) => f.properties.role)).toEqual(['hover']);

    map.rendered = [props(1901, 'clio:big-1900', { a: 5e6 }), props(1903, 'ovr:nation-1900', { a: 9e4, tier: 1 }), props(1902, 'clio:small-1900')];
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ pid: 'ovr:nation-1900', reason: 'click' }));
    expect(h.getSelected()).toBe('ovr:nation-1900');
    map.rendered = [];
    map.fire('click', { point: { x: 1, y: 1 }, lngLat: { lng: 0, lat: 0 } });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    map.fire('mouseout');
    expect(onHover).toHaveBeenLastCalledWith(null);
    expect(map.states.get(1902)).toEqual({ hover: false });
  });

  it('keeps the selection by pid across years (outline only where present)', async () => {
    const map = new FakeMap();
    const borders = fakeClient();
    const h = addBorderLayers(map as never, { borders, year: 1914 });
    await h.firstFrame;
    await settle();
    h.select('clio:small-1900');
    const hl = (): string[] =>
      ((map.sources.get(borderIds('ca-').highlightSrc)!.data as { features: { properties: { role: string } }[] }).features ?? []).map((f) => f.properties.role);
    expect(hl()).toEqual(['select']);
    await h.setYear(1814); // the polity is not on the 1800s map
    await settle();
    expect(h.getSelected()).toBe('clio:small-1900');
    expect(hl()).toEqual([]);
    expect(h.featuresOf('clio:small-1900')).toEqual([]);
  });
});

describe('coast source and view culling', () => {
  const geometryTypes = (src: { data: unknown } | undefined): string[] =>
    ((src?.data as { features: { geometry: { type: string } }[] }).features ?? []).map((f) => f.geometry.type);
  const parts = (src: { data: unknown } | undefined): number =>
    ((src?.data as { features: { geometry: { type: string; coordinates: unknown[] } }[] }).features ?? []).reduce(
      (n, f) => n + (f.geometry.type.startsWith('Multi') ? f.geometry.coordinates.length : 1),
      0,
    );

  it('puts the coast in its own source and re-sends it only when the coast changes', async () => {
    const map = new FakeMap();
    const h = addBorderLayers(map as never, { borders: fakeClient({ coast: true }), year: 1914 });
    await h.firstFrame;
    await settle();
    const ids = borderIds('ca-');
    const coast = map.sources.get(ids.coastSrc)!;
    expect(geometryTypes(coast)).toEqual(['MultiLineString']);
    expect(geometryTypes(map.sources.get(ids.frameSrc))).not.toContain('Point');
    expect(coast.setCalls).toBe(1);
    await h.setYear(1814); // another frame of the same coast "chunk" (1800–2099)
    expect(coast.setCalls).toBe(1);
    await h.setYear(1714); // another chunk: another coast object
    expect(coast.setCalls).toBe(2);
  });

  it('culls zoomed-in views to the parts near the view, and re-culls after a pan', async () => {
    const map = new FakeMap();
    map.degPerPx = 0.01; // an 8° × 6° view around (0, 0)
    const h = addBorderLayers(map as never, { borders: fakeClient({ coast: true, spread: true }), year: 1914 });
    await h.firstFrame;
    await settle();
    const ids = borderIds('ca-');
    const frame = map.sources.get(ids.frameSrc)!;
    // The big polity at 120°E is culled; the coast keeps its part at 0°.
    expect((frame.data as { features: { properties: { pid?: string } }[] }).features.some((f) => f.properties.pid === 'clio:big-1900')).toBe(false);
    expect(parts(map.sources.get(ids.coastSrc))).toBe(1);
    expect(h.featuresOf('clio:big-1900')).toHaveLength(1); // picking and fly-to still see the whole frame
    // Pan to 120°E: the next moveend re-culls around the new view.
    map.center = { lng: 120, lat: 0 };
    map.fire('moveend');
    await settle();
    expect((frame.data as { features: { properties: { pid?: string } }[] }).features.some((f) => f.properties.pid === 'clio:big-1900')).toBe(true);
    expect(parts(map.sources.get(ids.coastSrc))).toBe(1);
  });

  it('does not cull whole-globe views', async () => {
    const map = new FakeMap(); // 0.3°/px: the view spans the globe
    const h = addBorderLayers(map as never, { borders: fakeClient({ coast: true, spread: true }), year: 1914 });
    await h.firstFrame;
    await settle();
    expect(parts(map.sources.get(borderIds('ca-').coastSrc))).toBe(2);
  });

  it('a user zoom-out that leaves the culled view loads the coarser LOD instead of re-culling the finer one', async () => {
    const map = new FakeMap();
    map.degPerPx = 0.01;
    map.zoom = 4; // l1
    const borders = fakeClient({ coast: true, spread: true });
    const h = addBorderLayers(map as never, { borders, year: 1914 });
    await h.firstFrame;
    await settle();
    const before = borders.calls.length;
    map.fire('movestart', { originalEvent: {} }); // a wheel gesture
    map.zoom = 2;
    map.degPerPx = 0.05; // the view grows past the culled cap
    map.fire('move');
    await settle();
    expect(borders.calls.slice(before).map((c) => c.lod)).toEqual(['l0']);
  });

  it('shows the whole world at the coarsest LOD while a camera animation leaves the culled view', async () => {
    const map = new FakeMap();
    map.degPerPx = 0.01;
    map.zoom = 4; // l1
    const borders = fakeClient({ coast: true, spread: true });
    const h = addBorderLayers(map as never, { borders, year: 1914 });
    await h.firstFrame;
    await settle();
    expect(borders.calls.at(-1)!.lod).toBe('l1');
    map.fire('movestart', {}); // flyTo: no originalEvent
    map.center = { lng: 60, lat: 0 };
    map.fire('move');
    await settle();
    expect(borders.calls.at(-1)!.lod).toBe('l0');
    expect(parts(map.sources.get(borderIds('ca-').coastSrc))).toBe(2); // the whole world
    map.center = { lng: 120, lat: 0 };
    map.fire('moveend');
    await settle();
    expect(borders.calls.at(-1)!.lod).toBe('l1');
    expect(parts(map.sources.get(borderIds('ca-').coastSrc))).toBe(1);
  });
});

describe('tooltip and picking helpers', () => {
  it('formats lifespans', () => {
    expect(formatSpan(395, 1453)).toBe('395–1453');
    expect(formatSpan(-509, -27)).toBe('509 BCE – 27 BCE');
    expect(formatSpan(-27, 476)).toBe('27 BCE – 476');
    expect(formatSpan(1949, 2026, 2026)).toBe('1949–present');
    expect(formatSpan(1900, 1900)).toBe('1900');
  });

  it('uses the geometry validity when the index is not loaded', () => {
    expect(hoverLabel(props(1, 'clio:x', { name: 'Kingdom of X', from: 1500, to: 1520 }), undefined)).toBe('Kingdom of X · 1500–1520');
  });

  it('orders picks: tier 1 first, then smallest area', () => {
    const list = [props(1, 'a', { a: 10 }), props(2, 'b', { a: 1 }), props(3, 'c', { a: 100, tier: 1 })].sort(pickOrder);
    expect(list.map((p) => p.pid)).toEqual(['c', 'b', 'a']);
  });
});
