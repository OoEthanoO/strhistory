import { describe, expect, it } from 'vitest';
import { createBorders, FetchError, type BordersInit, type FeatureCollection, type MultiLineString, type Position } from './index.js';
import { FILES, makeManifest, makeServer, settle, type FakeServer } from './testing/fixture.js';

function setup(init: BordersInit = {}, server: FakeServer = makeServer()) {
  const borders = createBorders({ manifestUrl: server.manifestUrl }, { fetch: server.fetch, ...init });
  return { server, borders };
}

const ids = (fc: Pick<FeatureCollection, 'features'>) => fc.features.map((f) => f.id as number).sort((a, b) => a - b);

/** Waits until the fake server has `n` requests parked on a hold. */
async function parked(server: FakeServer, n = 1) {
  for (let i = 0; i < 50 && server.waiting < n; i++) await settle();
  expect(server.waiting).toBe(n);
}

describe('createBorders and ready()', () => {
  it('fetches nothing until first use, then loads the manifest once', async () => {
    const { server, borders } = setup();
    expect(server.calls).toEqual([]);
    const [a, b] = await Promise.all([borders.ready(), borders.ready()]);
    expect(a).toBe(b);
    expect(a.schema).toBe('alexs-atlas.borders/1');
    expect(server.calls).toEqual([server.manifestUrl]);
  });

  it('accepts an in-memory manifest plus a folder URL without trailing slash', async () => {
    const server = makeServer();
    const borders = createBorders(
      { manifest: makeManifest(), baseUrl: 'https://example.test/data/alexs-atlas' },
      { fetch: server.fetch },
    );
    expect(borders.frameOf(1453)).toEqual({ from: 1000, to: 1499 }); // usable synchronously
    await borders.bordersAt(1);
    expect(server.calls).toEqual([`${server.baseUrl}${FILES.c1.l0}`]);
  });

  it('keeps relative paths relative outside a browser', async () => {
    const urls: string[] = [];
    const server = makeServer();
    const borders = createBorders(
      { manifest: makeManifest(), baseUrl: 'data/alexs-atlas' },
      { fetch: (url, init) => (urls.push(url), server.fetch(server.baseUrl + url.slice('data/alexs-atlas/'.length), init)) },
    );
    await borders.bordersAt(1);
    expect(urls).toEqual([`data/alexs-atlas/${FILES.c1.l0}`]);
  });

  it('rejects bad sources, bad manifests and bad cache sizes synchronously', () => {
    expect(() => createBorders({} as never)).toThrow(TypeError);
    expect(() => createBorders({ manifest: { schema: 'x' } as never, baseUrl: '/' })).toThrow(/schema/);
    expect(() => createBorders({ manifestUrl: '/m.json' }, { cacheChunks: -1 })).toThrow(RangeError);
    expect(() => createBorders({ manifestUrl: '/m.json' }, { cacheFrames: 1.5 })).toThrow(RangeError);
  });

  it('does not keep a failed manifest load', async () => {
    const { server, borders } = setup();
    server.failWith('manifest', 500);
    await expect(borders.ready()).rejects.toBeInstanceOf(FetchError);
    server.failWith('manifest', undefined);
    await expect(borders.ready()).resolves.toMatchObject({ dataset: 'alexs-atlas-test' });
    expect(server.count('manifest')).toBe(2);
  });
});

describe('frameOf', () => {
  it('needs the manifest first', async () => {
    const { borders } = setup();
    expect(() => borders.frameOf(1)).toThrow(/ready\(\)/);
    await borders.ready();
    expect(borders.frameOf(1)).toEqual({ from: 1, to: 499 });
  });

  it('finds frame edges, crosses year 0 and is unbounded outside coverage', async () => {
    const { borders } = setup();
    await borders.ready();
    expect(borders.frameOf(-500)).toEqual({ from: -500, to: -201 });
    expect(borders.frameOf(-201)).toEqual({ from: -500, to: -201 });
    expect(borders.frameOf(-200)).toEqual({ from: -200, to: -1 });
    expect(borders.frameOf(-1)).toEqual({ from: -200, to: -1 });
    expect(borders.frameOf(1)).toEqual({ from: 1, to: 499 });
    expect(borders.frameOf(2026)).toEqual({ from: 1946, to: 2026 });
    expect(borders.frameOf(-501)).toEqual({ from: -Infinity, to: -501 });
    expect(borders.frameOf(2027)).toEqual({ from: 2027, to: Infinity });
  });

  it('rejects year 0 and non-integers', async () => {
    const { borders } = setup();
    await borders.ready();
    expect(() => borders.frameOf(0)).toThrow(RangeError);
    expect(() => borders.frameOf(1.5)).toThrow(RangeError);
  });
});

describe('bordersAt', () => {
  it.each([
    [-300, [1, 2, 5, 6, 7]],
    [-201, [1, 2, 5, 6, 7]],
    [-200, [3, 4, 5, 6, 7, 8]],
    [-1, [3, 4, 5, 6, 7, 8]],
    [1, [9, 10, 11, 13, 14]],
    [499, [9, 10, 11, 13, 14]],
    [500, [11, 12, 13, 14]],
    [1000, [13, 15, 16, 20, 21]],
    [1500, [13, 15, 17, 20, 21]],
    [1945, [13, 15, 17, 20, 21]],
    [1946, [13, 18, 19, 20, 21, 22]],
    [2026, [13, 18, 19, 20, 21, 22]],
  ])('year %i → records %j', async (year, expected) => {
    const { borders } = setup();
    const fc = await borders.bordersAt(year);
    expect(fc.type).toBe('FeatureCollection');
    expect(ids(fc)).toEqual(expected);
    for (const f of fc.features) {
      expect(f.id).toBe(f.properties.id);
      expect(f.properties.from).toBeLessThanOrEqual(year);
      expect(f.properties.to).toBeGreaterThanOrEqual(year);
      expect(['Polygon', 'MultiPolygon']).toContain(f.geometry.type);
    }
  });

  it('returns full PolityProps, tier-1 overlays and unclaimed land', async () => {
    const { borders } = setup();
    const fc = await borders.bordersAt(-100);
    const delta = fc.features.find((f) => f.properties.pid === 'clio:delta');
    expect(delta?.properties).toMatchObject({ rid: 'clio:delta@-200', kind: 'indigenous', tier: 1, precision: 'approximate', lx: 7.5, ly: 5 });
    expect(Object.keys(delta?.properties ?? {}).sort()).toEqual(
      ['a', 'c', 'disputed', 'from', 'id', 'kind', 'lx', 'ly', 'name', 'partof', 'pid', 'power', 'precision', 'rid', 'src', 'subjecto', 'tier', 'to'].sort(),
    );
    const unclaimed = fc.features.filter((f) => f.properties.kind === 'unclaimed');
    expect(unclaimed.map((f) => [f.properties.pid, f.properties.name, f.properties.tier])).toEqual([
      ['none', '', 0],
      ['none', '', 0],
      ['none', '', 0],
    ]);
  });

  it('decodes unquantised and quantised chunks to the right coordinates', async () => {
    const { borders } = setup();
    const bbox = (coords: Position[]) => [
      Math.min(...coords.map((p) => p[0] as number)),
      Math.min(...coords.map((p) => p[1] as number)),
      Math.max(...coords.map((p) => p[0] as number)),
      Math.max(...coords.map((p) => p[1] as number)),
    ];
    const ring = async (year: number, id: number) => {
      const f = (await borders.bordersAt(year)).features.find((x) => x.id === id);
      if (f?.geometry.type !== 'Polygon') throw new Error('expected a Polygon');
      return f.geometry.coordinates[0] as Position[];
    };
    expect(bbox(await ring(-300, 2))).toEqual([15, 0, 30, 10]); // c0: exact
    const quantised = bbox(await ring(1200, 16)); // c2: 1e5 grid
    [10, 0, 30, 10].forEach((v, i) => expect(quantised[i]).toBeCloseTo(v, 2));
    const epsilon = (await borders.bordersAt(1)).features.find((x) => x.id === 13);
    expect(epsilon?.geometry.type).toBe('MultiPolygon');
    expect((epsilon?.geometry.coordinates as Position[][][]).length).toBe(2);
  });

  it('shares one decoded result per frame and decodes each chunk download once', async () => {
    const { server, borders } = setup();
    const a = await borders.bordersAt(1000);
    const b = await borders.bordersAt(1499);
    const c = await borders.bordersAt(1500);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    expect(server.count('c2.')).toBe(1);
  });

  it('resolves to an empty collection outside the coverage without fetching chunks', async () => {
    const { server, borders } = setup();
    expect(await borders.bordersAt(-501)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(await borders.bordersAt(2027)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(server.calls).toEqual([server.manifestUrl]);
  });

  it('rejects invalid years with a RangeError before fetching anything', async () => {
    const { server, borders } = setup();
    await expect(borders.bordersAt(0)).rejects.toBeInstanceOf(RangeError);
    await expect(borders.bordersAt(-0)).rejects.toBeInstanceOf(RangeError);
    await expect(borders.bordersAt(1.5)).rejects.toBeInstanceOf(RangeError);
    await expect(borders.bordersAt(Number.NaN)).rejects.toBeInstanceOf(RangeError);
    expect(server.calls).toEqual([]);
  });

  it('reads the requested LOD file', async () => {
    const { server, borders } = setup();
    const l1 = await borders.bordersAt(1, { lod: 'l1' });
    expect(server.calls).toContain(`${server.baseUrl}${FILES.c1.l1}`);
    expect(server.count(FILES.c1.l0)).toBe(0);
    expect(ids(l1)).toEqual([9, 10, 11, 13, 14]);
  });

  it('falls back to the nearest coarser LOD a chunk has, sharing the result', async () => {
    const { server, borders } = setup();
    const l0 = await borders.bordersAt(1200, { lod: 'l0' });
    const l1 = await borders.bordersAt(1200, { lod: 'l1' });
    const l2 = await borders.bordersAt(1200, { lod: 'l2' });
    expect(l1).toBe(l0);
    expect(l2).toBe(l0);
    expect(server.count('c2.')).toBe(1);
  });

  it('rejects an unknown LOD', async () => {
    const { borders } = setup();
    await expect(borders.bordersAt(1, { lod: 'l9' })).rejects.toThrow(/unknown LOD "l9" \(dataset has l0, l1, l2\)/);
  });

  it('reports a malformed chunk and retries it next time', async () => {
    const { server, borders } = setup();
    const good = server.files.get(FILES.c1.l0) as string;
    server.files.set(FILES.c1.l0, JSON.stringify({ type: 'Topology', objects: {}, arcs: [] }));
    await expect(borders.bordersAt(1)).rejects.toThrow(/not a chunk/);
    server.files.set(FILES.c1.l0, good);
    expect(ids(await borders.bordersAt(1))).toEqual([9, 10, 11, 13, 14]);
    expect(server.count('c1.')).toBe(2);
  });
});

describe('labelsAt', () => {
  it('gives one point per polity at its label point, skipping unclaimed land', async () => {
    const { borders } = setup();
    const fc = await borders.labelsAt(-100);
    expect(fc.features.map((f) => [f.id, f.properties.pid, f.geometry.coordinates])).toEqual([
      [3, 'clio:alpha', [10, 5]],
      [4, 'clio:beta', [25, 5]],
      [8, 'clio:delta', [7.5, 5]],
    ]);
    expect(fc.features.every((f) => f.geometry.type === 'Point')).toBe(true);
  });

  it('is memoised per frame', async () => {
    const { borders } = setup();
    expect(await borders.labelsAt(1946)).toBe(await borders.labelsAt(2026));
    expect((await borders.labelsAt(1946)).features.map((f) => f.properties.pid)).toEqual([
      'ne:alp',
      'ne:zet',
      'clio:gamma',
      'ovr:epsilon',
      'ovr:disputed-strip',
    ]);
  });
});

// Planar length in degrees: good enough to compare against the fixture's rectangles.
const length = (lines: Position[][]) =>
  lines.reduce((sum, line) => {
    for (let i = 1; i < line.length; i++) {
      const [x0, y0] = line[i - 1] as [number, number];
      const [x1, y1] = line[i] as [number, number];
      sum += Math.hypot(x1 - x0, y1 - y0);
    }
    return sum;
  }, 0);

const segments = (lines: Position[][]) =>
  lines.flatMap((line) => line.slice(1).map((p, i) => [line[i] as Position, p] as const));

describe('linesAt', () => {
  async function lines(year: number) {
    const { borders } = setup();
    const fc = await borders.linesAt(year);
    const byKind = Object.fromEntries(fc.features.map((f) => [f.properties.kind, f.geometry as MultiLineString]));
    return { fc, border: byKind.border?.coordinates ?? [], coast: byKind.coast?.coordinates ?? [] };
  }

  // Coast per fixture year: continent outline 80 + island 8 + east landmass 2 × 30
  // (its ±180° edges dropped) + the south's −80° parallel 360 (its pole and ±180° edges dropped).
  const COAST = 80 + 8 + 60 + 360;

  it('splits borders between different features from the coast (unquantised chunk)', async () => {
    const { fc, border, coast } = await lines(-300);
    expect(fc.features.map((f) => f.properties)).toEqual([{ kind: 'border' }, { kind: 'coast' }]);
    expect(border).toHaveLength(1);
    expect([...(border[0] as Position[])].sort((a, b) => (a[1] as number) - (b[1] as number))).toEqual([
      [15, 0],
      [15, 10],
    ]);
    expect(length(coast)).toBeCloseTo(COAST, 9);
  });

  it('never draws tier-1 overlay edges', async () => {
    const { border, coast } = await lines(-100); // Delta overlay [5,10]×[2,8] is alive
    expect(length(border)).toBeCloseTo(10, 9);
    expect(segments(border).every(([a, b]) => a[0] === 20 && b[0] === 20)).toBe(true);
    expect(segments([...border, ...coast]).some(([a]) => a[0] === 5 || a[0] === 10)).toBe(false);
  });

  it('counts the frontier with unclaimed land as a border (quantised chunk)', async () => {
    const { border, coast } = await lines(1);
    expect(length(border)).toBeCloseTo(10, 2);
    expect(segments(border).every(([a, b]) => Math.abs((a[0] as number) - 20) < 1e-2 && Math.abs((b[0] as number) - 20) < 1e-2)).toBe(true);
    expect(length(coast)).toBeCloseTo(COAST, 1);
  });

  it('omits the border feature when there is no border', async () => {
    const { fc, coast } = await lines(500); // Alpha holds the whole continent
    expect(fc.features.map((f) => f.properties.kind)).toEqual(['coast']);
    expect(length(coast)).toBeCloseTo(COAST, 1);
  });

  it('drops antimeridian and pole edges but keeps real coast next to them', async () => {
    for (const year of [-300, 1, 1946]) {
      const { coast, border } = await lines(year);
      for (const [a, b] of segments([...coast, ...border])) {
        const on = (u: number, v: number, limit: number) => Math.abs(u - limit) < 1e-6 && Math.abs(v - limit) < 1e-6;
        const [ax, ay, bx, by] = [a[0], a[1], b[0], b[1]] as number[] as [number, number, number, number];
        const alongMeridian = on(ax, bx, 180) || on(ax, bx, -180);
        const alongPole = on(ay, by, 90) || on(ay, by, -90);
        expect(alongMeridian || alongPole).toBe(false);
      }
      // The −80° parallel (Antarctica-like coast) is still there (1e4 quantisation: ~0.016° grid).
      expect(segments(coast).some(([a, b]) => Math.abs((a[1] as number) + 80) < 0.02 && Math.abs((b[1] as number) + 80) < 0.02)).toBe(true);
    }
  });

  it('is memoised per frame', async () => {
    const { borders } = setup();
    expect(await borders.linesAt(1500)).toBe(await borders.linesAt(1945));
  });
});

describe('base', () => {
  it('decodes every object of the land topology', async () => {
    const { borders } = setup();
    const land = await borders.base('land', 'l0');
    expect(land.type).toBe('FeatureCollection');
    expect(land.features.map((f) => f.geometry.type)).toEqual(['Polygon', 'Polygon', 'MultiPolygon', 'Polygon']);
  });

  it('defaults to the first LOD and falls back when a LOD file is missing', async () => {
    const { server, borders } = setup();
    const lakes = await borders.base('lakes');
    expect(await borders.base('lakes', 'l2')).toBe(lakes);
    expect(lakes.features).toHaveLength(1);
    expect(server.count('lakes-')).toBe(1);
    await borders.base('land', 'l1');
    expect(server.calls).toContain(`${server.baseUrl}${FILES.land.l1}`);
  });

  it('gives an empty collection when the dataset has no lakes', async () => {
    const server = makeServer();
    const manifest = makeManifest();
    delete manifest.base.lakes;
    const borders = createBorders({ manifest, baseUrl: server.baseUrl }, { fetch: server.fetch });
    expect(await borders.base('lakes')).toEqual({ type: 'FeatureCollection', features: [] });
    expect(server.calls).toEqual([]);
  });

  it('rejects unknown layers and LODs', async () => {
    const { borders } = setup();
    await expect(borders.base('rivers' as never)).rejects.toBeInstanceOf(TypeError);
    await expect(borders.base('land', 'l7')).rejects.toBeInstanceOf(RangeError);
  });
});

describe('polities, polity and search', () => {
  it('loads the index once', async () => {
    const { server, borders } = setup();
    const [a, b] = await Promise.all([borders.polities(), borders.polities()]);
    expect(a).toBe(b);
    expect(a['clio:alpha']?.name).toBe('Alpha');
    await borders.search('alpha');
    expect(server.count('polities.')).toBe(1);
  });

  it('looks up a pid without falling for inherited keys', async () => {
    const { borders } = setup();
    expect((await borders.polity('clio:delta'))?.altNames).toEqual(['Tsalagi']);
    expect(await borders.polity('nope')).toBeUndefined();
    expect(await borders.polity('constructor')).toBeUndefined();
    expect(await borders.polity('__proto__')).toBeUndefined();
  });

  it('ranks exact > prefix > word-prefix > substring', async () => {
    const { borders } = setup();
    const hits = await borders.search('ma');
    expect(hits.map((h) => h.name)).toEqual([
      'Ma', // exact
      'Mali Empire', // prefix
      'Kingdom of Mataram', // word prefix
      'Roman Empire', // substring, larger bbox first
      'Holy Roman Empire',
      'Oman',
      'Gamma',
    ]);
    expect(hits[0]).toMatchObject({ pid: 'test:ma', kind: 'state', spans: [[100, 200]] });
  });

  it('is diacritic-, case- and apostrophe-insensitive in both directions', async () => {
    const { borders } = setup();
    const first = async (q: string) => (await borders.search(q))[0]?.pid;
    expect(await first('dai viet')).toBe('test:dai-viet');
    expect(await first('ĐẠI VIỆT')).toBe('test:dai-viet');
    expect(await first('Viêt')).toBe('test:dai-viet');
    expect(await first('hawaii')).toBe('test:hawaii');
    expect(await first("Hawai'i")).toBe('test:hawaii');
    expect(await first('diriyya')).toBe('test:saud');
    expect(await first('kurkoln')).toBe('test:koln');
    expect(await first('αλφα')).toBe('clio:alpha');
  });

  it('matches alternative names below main names and says which one matched', async () => {
    const { borders } = setup();
    const [hit] = await borders.search('tsalagi');
    expect(hit).toMatchObject({ pid: 'clio:delta', name: 'Delta', matched: 'Tsalagi' });
    const alpha = await borders.search('alpha');
    expect(alpha.map((h) => h.pid)).toEqual(['clio:alpha', 'ne:alp']);
    expect(alpha[0]?.matched).toBeUndefined();
  });

  it('falls back to near matches when nothing else matches', async () => {
    const { borders } = setup();
    // "Rome" is in no polity name; "roman" is one letter away.
    expect((await borders.search('rome')).map((h) => h.pid)).toEqual(['test:roma', 'test:hre']);
    expect((await borders.search('kingdom of mataran')).map((h) => h.pid)).toEqual(['test:mataram']);
  });

  it('filters by year and limits the result count', async () => {
    const { borders } = setup();
    expect((await borders.search('alpha', { year: 2000 })).map((h) => h.pid)).toEqual(['ne:alp']);
    expect((await borders.search('alpha', { year: -300 })).map((h) => h.pid)).toEqual(['clio:alpha']);
    expect(await borders.search('a', { limit: 2 })).toHaveLength(2);
    expect(await borders.search('a', { limit: 0 })).toEqual([]);
    expect(await borders.search('   ')).toEqual([]);
    expect(await borders.search('!!')).toEqual([]);
    await expect(borders.search('alpha', { year: 0 })).rejects.toBeInstanceOf(RangeError);
  });
});

describe('caching and de-duplication', () => {
  it('shares one download between concurrent queries on the same chunk', async () => {
    const { server, borders } = setup();
    await Promise.all([borders.bordersAt(1), borders.bordersAt(500), borders.labelsAt(1), borders.linesAt(600)]);
    expect(server.count('c1.')).toBe(1);
    expect(server.count('manifest')).toBe(1);
  });

  it('keeps `cacheChunks` chunks per LOD (LRU)', async () => {
    const { server, borders } = setup({ cacheChunks: 1, cacheFrames: 0 });
    await borders.bordersAt(1);
    await borders.bordersAt(1, { lod: 'l1' }); // other LOD: separate cache
    await borders.bordersAt(500);
    expect(server.count(FILES.c1.l0)).toBe(1);
    await borders.bordersAt(1200); // evicts c1 from the l0 cache
    await borders.bordersAt(1);
    expect(server.count(FILES.c1.l0)).toBe(2);
    expect(server.count(FILES.c1.l1)).toBe(1);
  });

  it('keeps `cacheFrames` decoded frames (LRU) without refetching chunks', async () => {
    const { server, borders } = setup({ cacheFrames: 1 });
    const a = await borders.bordersAt(1);
    await borders.bordersAt(500);
    const c = await borders.bordersAt(1);
    expect(c).not.toBe(a); // decoded again…
    expect(c).toEqual(a);
    expect(server.count('c1.')).toBe(1); // …from the cached chunk
  });

  it('does not cache failed downloads', async () => {
    const { server, borders } = setup();
    server.failWith('c1.', 500);
    await expect(borders.bordersAt(1)).rejects.toMatchObject({ name: 'FetchError', status: 500 });
    server.failWith('c1.', undefined);
    expect(ids(await borders.bordersAt(1))).toEqual([9, 10, 11, 13, 14]);
  });
});

describe('AbortSignal', () => {
  it('rejects at once for an already aborted signal, fetching nothing', async () => {
    const { server, borders } = setup();
    const controller = new AbortController();
    controller.abort();
    const error = await borders.bordersAt(1, { signal: controller.signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe('AbortError');
    expect(server.calls).toEqual([]);
  });

  it('cancels the download when its only caller aborts, leaving nothing cached', async () => {
    const { server, borders } = setup();
    await borders.ready();
    server.hold('c1.');
    const controller = new AbortController();
    const p = borders.bordersAt(1, { signal: controller.signal });
    await parked(server);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.signals.at(-1)?.aborted).toBe(true);
    expect(server.waiting).toBe(0);
    server.release();
    expect(ids(await borders.bordersAt(1))).toEqual([9, 10, 11, 13, 14]);
    expect(server.count('c1.')).toBe(2);
  });

  it('keeps a shared download alive while another caller still waits', async () => {
    const { server, borders } = setup();
    await borders.ready();
    server.hold('c1.');
    const controller = new AbortController();
    const aborted = borders.bordersAt(1, { signal: controller.signal });
    const other = borders.labelsAt(500);
    await parked(server);
    controller.abort();
    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(server.signals.at(-1)?.aborted).toBe(false);
    server.release();
    expect((await other).features.map((f) => f.properties.pid)).toEqual(['clio:gamma', 'clio:alpha', 'ovr:epsilon']);
    expect(ids(await borders.bordersAt(1))).toEqual([9, 10, 11, 13, 14]);
    expect(server.count('c1.')).toBe(1);
  });

  it('rejects while waiting for the manifest without cancelling it for others', async () => {
    const { server, borders } = setup();
    server.hold('manifest');
    const controller = new AbortController();
    const p = borders.bordersAt(1, { signal: controller.signal });
    const ready = borders.ready();
    await parked(server);
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    server.release();
    await expect(ready).resolves.toMatchObject({ schema: 'alexs-atlas.borders/1' });
    expect(server.count('c1.')).toBe(0);
  });

  it('passes a custom abort reason through', async () => {
    const { server, borders } = setup();
    await borders.ready();
    server.hold('c1.');
    const controller = new AbortController();
    const p = borders.linesAt(1, { signal: controller.signal });
    await parked(server);
    const reason = new Error('superseded');
    controller.abort(reason);
    await expect(p).rejects.toBe(reason);
    server.release();
  });

  it('rejects an aborted signal even when the frame is cached', async () => {
    const { borders } = setup();
    await borders.bordersAt(1);
    const controller = new AbortController();
    controller.abort();
    await expect(borders.bordersAt(1, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('prefetch', () => {
  it('loads the chunk in the background so the query needs no request', async () => {
    const { server, borders } = setup();
    borders.prefetch(1200);
    for (let i = 0; i < 20 && server.count('c2.') === 0; i++) await settle();
    await settle();
    expect(server.count('c2.')).toBe(1);
    await borders.bordersAt(1300);
    expect(server.count('c2.')).toBe(1);
  });

  it('ignores invalid years, unknown LODs and failures', async () => {
    const { server, borders } = setup();
    server.failWith('c1.', 500);
    borders.prefetch(0);
    borders.prefetch(1, 'l9');
    borders.prefetch(1);
    borders.prefetch(-9999);
    for (let i = 0; i < 10; i++) await settle();
    expect(server.count('c1.')).toBe(1);
    expect(server.count('c0.')).toBe(0);
  });
});
