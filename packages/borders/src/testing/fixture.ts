// A tiny synthetic dataset in the real file layout (AGENTS.md §5.2), built with
// topojson-server, plus a fake HTTP server whose fetch can be held, failed and observed.
//
// World (lon/lat):
//   continent  [0,30]×[0,10]   split between polities that change over time
//   island     [40,42]×[0,2]   unclaimed, later Gamma
//   east       [170,180]×[60,70] + [−180,−170]×[60,70]   cut at the antimeridian
//   south      [−180,180]×[−90,−80]   Antarctica-like, closed along the pole
//
// Chunks: c0 [−500, −1] (unquantised), c1 [1, 999] (quantised 1e4), c2 [1000, 2026]
// (quantised 1e5, l0 only). Frames: −500, −200, 1, 500, 1000, 1500, 1946.

import { topology } from 'topojson-server';
import type { FetchLike, Manifest, PolityInfo, PolityKind, PolityProps } from '../types.js';

type Ring = [number, number][];
type Geom = { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] };

/** Counter-clockwise rectangle ring (RFC 7946 exterior). */
export const rect = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];

const poly = (r: Ring): Geom => ({ type: 'Polygon', coordinates: [r] });
const CONTINENT = (x0: number, x1: number) => poly(rect(x0, 0, x1, 10));
const ISLAND = () => poly(rect(40, 0, 42, 2));
const EAST = (): Geom => ({ type: 'MultiPolygon', coordinates: [[rect(170, 60, 180, 70)], [rect(-180, 60, -170, 70)]] });
const SOUTH = () => poly(rect(-180, -90, 180, -80));

interface Rec {
  id: number;
  pid: string;
  name: string;
  from: number;
  to: number;
  geometry: () => Geom;
  /** Label point. */
  at: [number, number];
  kind?: PolityKind;
  tier?: 0 | 1;
  rid?: string;
  power?: string;
  precision?: 'exact' | 'approximate';
  src?: string;
}

const KM_PER_DEG = 111.32;
function areaKm2(g: Geom): number {
  const rings = g.type === 'Polygon' ? [g.coordinates[0] as Ring] : g.coordinates.map((p) => p[0] as Ring);
  let sum = 0;
  for (const r of rings) {
    const xs = r.map((p) => p[0]);
    const ys = r.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs);
    const h = Math.max(...ys) - Math.min(...ys);
    const lat = ((Math.max(...ys) + Math.min(...ys)) / 2) * (Math.PI / 180);
    sum += w * KM_PER_DEG * Math.cos(lat) * h * KM_PER_DEG;
  }
  return Math.round(sum);
}

function props(r: Rec): PolityProps {
  const kind = r.kind ?? 'state';
  return {
    id: r.id,
    rid: r.rid ?? `${r.pid}@${r.from}`,
    pid: r.pid,
    name: r.name,
    from: r.from,
    to: r.to,
    kind,
    tier: r.tier ?? 0,
    power: r.power ?? r.pid,
    partof: null,
    subjecto: null,
    disputed: kind === 'disputed',
    precision: r.precision ?? 'exact',
    c: r.id % 12,
    a: areaKm2(r.geometry()),
    lx: r.at[0],
    ly: r.at[1],
    src: r.src ?? (r.pid.startsWith('ne:') ? 'naturalearth' : r.pid.startsWith('ovr:') ? 'override' : 'cliopatria'),
  };
}

const none = (id: number, from: number, to: number, geometry: () => Geom, at: [number, number], n = 1): Rec => ({
  id,
  pid: 'none',
  name: '',
  from,
  to,
  geometry,
  at,
  kind: 'unclaimed',
  rid: n > 1 ? `none@${from}#${n}` : `none@${from}`,
});

const EPSILON: Rec = { id: 13, pid: 'ovr:epsilon', name: 'Epsilon', from: 1, to: 2026, geometry: EAST, at: [175, 65] };

export const RECORDS: Record<'c0' | 'c1' | 'c2', Rec[]> = {
  c0: [
    { id: 1, pid: 'clio:alpha', name: 'Alpha', from: -500, to: -201, geometry: () => CONTINENT(0, 15), at: [7.5, 5] },
    { id: 2, pid: 'clio:beta', name: 'Beta', from: -500, to: -201, geometry: () => CONTINENT(15, 30), at: [22.5, 5] },
    { id: 3, pid: 'clio:alpha', name: 'Alpha', from: -200, to: -1, geometry: () => CONTINENT(0, 20), at: [10, 5] },
    { id: 4, pid: 'clio:beta', name: 'Beta', from: -200, to: -1, geometry: () => CONTINENT(20, 30), at: [25, 5] },
    none(5, -500, -1, ISLAND, [41, 1]),
    none(6, -500, -1, EAST, [175, 65], 2),
    none(7, -500, -1, SOUTH, [0, -85], 3),
    {
      id: 8,
      pid: 'clio:delta',
      name: 'Delta',
      from: -200,
      to: -1,
      geometry: () => poly(rect(5, 2, 10, 8)),
      at: [7.5, 5],
      kind: 'indigenous',
      tier: 1,
      precision: 'approximate',
    },
  ],
  c1: [
    { id: 9, pid: 'clio:alpha', name: 'Alpha', from: 1, to: 499, geometry: () => CONTINENT(0, 20), at: [10, 5] },
    none(10, 1, 499, () => CONTINENT(20, 30), [25, 5]),
    { id: 11, pid: 'clio:gamma', name: 'Gamma', from: 1, to: 999, geometry: ISLAND, at: [41, 1] },
    { id: 12, pid: 'clio:alpha', name: 'Alpha', from: 500, to: 999, geometry: () => CONTINENT(0, 30), at: [15, 5] },
    EPSILON,
    none(14, 1, 999, SOUTH, [0, -85], 2),
  ],
  c2: [
    { id: 15, pid: 'clio:alpha', name: 'Alpha', from: 1000, to: 1945, geometry: () => CONTINENT(0, 10), at: [5, 5] },
    {
      id: 16,
      pid: 'clio:zeta',
      name: 'Zeta',
      from: 1000,
      to: 1499,
      geometry: () => CONTINENT(10, 30),
      at: [20, 5],
      kind: 'dependency',
      power: 'clio:alpha',
    },
    { id: 17, pid: 'clio:zeta', name: 'Zēta Republic', from: 1500, to: 1945, geometry: () => CONTINENT(10, 30), at: [20, 5] },
    { id: 18, pid: 'ne:alp', name: 'Alpha', from: 1946, to: 2026, geometry: () => CONTINENT(0, 10), at: [5, 5] },
    { id: 19, pid: 'ne:zet', name: 'Zeta', from: 1946, to: 2026, geometry: () => CONTINENT(10, 30), at: [20, 5] },
    { id: 20, pid: 'clio:gamma', name: 'Gamma', from: 1000, to: 2026, geometry: ISLAND, at: [41, 1] },
    EPSILON,
    none(21, 1000, 2026, SOUTH, [0, -85]),
    {
      id: 22,
      pid: 'ovr:disputed-strip',
      name: 'Disputed strip',
      from: 1946,
      to: 2026,
      geometry: () => poly(rect(8, 4, 12, 6)),
      at: [10, 5],
      kind: 'disputed',
      tier: 1,
      precision: 'approximate',
    },
  ],
};

export const FRAMES = [-500, -200, 1, 500, 1000, 1500, 1946];

const chunkTopology = (records: Rec[], quantization?: number) =>
  topology(
    {
      polities: {
        type: 'FeatureCollection',
        features: records.map((r) => ({ type: 'Feature', id: r.id, properties: props(r), geometry: r.geometry() })),
      },
    },
    quantization,
  );

const LAND_FEATURES = () => ({
  type: 'FeatureCollection',
  features: [CONTINENT(0, 30), ISLAND(), EAST(), SOUTH()].map((geometry) => ({ type: 'Feature', properties: {}, geometry })),
});

// `peak` is the year of largest extent; search breaks ties by bbox size.
export const POLITIES: Record<string, PolityInfo> = {
  'clio:alpha': { name: 'Alpha', altNames: ['Alfa', 'Ἄλφα'], kind: 'state', spans: [[-500, 1945]], bbox: [0, 0, 30, 10], peak: 500, src: 'cliopatria', wikidata: 'Q1' },
  'clio:beta': { name: 'Beta', kind: 'state', spans: [[-500, -1]], bbox: [15, 0, 30, 10], peak: -500, src: 'cliopatria' },
  'clio:gamma': { name: 'Gamma', kind: 'state', spans: [[1, 2026]], bbox: [40, 0, 42, 2], peak: 1, src: 'cliopatria' },
  'clio:delta': { name: 'Delta', altNames: ['Tsalagi'], kind: 'indigenous', spans: [[-200, -1]], bbox: [5, 2, 10, 8], peak: -200, src: 'cliopatria' },
  'ovr:epsilon': { name: 'Epsilon', kind: 'state', spans: [[1, 2026]], bbox: [170, 60, -170, 70], peak: 1, src: 'override' },
  'clio:zeta': { name: 'Zeta', altNames: ['Zēta Republic'], kind: 'dependency', spans: [[1000, 1945]], bbox: [10, 0, 30, 10], peak: 1000, src: 'cliopatria' },
  'ne:alp': { name: 'Alpha', kind: 'state', spans: [[1946, 2026]], bbox: [0, 0, 10, 10], peak: 1946, src: 'naturalearth' },
  'ne:zet': { name: 'Zeta', kind: 'state', spans: [[1946, 2026]], bbox: [10, 0, 30, 10], peak: 1946, src: 'naturalearth' },
  'ovr:disputed-strip': { name: 'Disputed strip', kind: 'disputed', spans: [[1946, 2026]], bbox: [8, 4, 12, 6], peak: 1946, src: 'override' },
  // Index-only entries for search ranking and normalisation tests.
  'test:ma': { name: 'Ma', kind: 'state', spans: [[100, 200]], bbox: [0, 0, 1, 1], peak: 100, src: 'cliopatria' },
  'test:mali': { name: 'Mali Empire', kind: 'state', spans: [[1226, 1670]], bbox: [-17, 10, 0, 24], peak: 1350, src: 'cliopatria' },
  'test:mataram': { name: 'Kingdom of Mataram', kind: 'state', spans: [[1587, 1755]], bbox: [106, -9, 115, -6], peak: 1650, src: 'cliopatria' },
  'test:oman': { name: 'Oman', kind: 'state', spans: [[1946, 2026]], bbox: [52, 16.6, 60, 26.4], peak: 1946, src: 'naturalearth' },
  'test:dai-viet': { name: 'Đại Việt', kind: 'state', spans: [[1054, 1804]], bbox: [102, 8.5, 110, 23.5], peak: 1760, src: 'cliopatria' },
  'test:hawaii': { name: 'Kingdom of Hawaiʻi', kind: 'state', spans: [[1795, 1893]], bbox: [-160.3, 18.9, -154.8, 22.3], peak: 1810, src: 'override' },
  'test:saud': { name: 'Emirate of Dirʿiyya', altNames: ['First Saudi State'], kind: 'state', spans: [[1727, 1818]], bbox: [40, 20, 52, 29], peak: 1810, src: 'cliopatria' },
  'test:koln': { name: 'Electorate of Cologne', altNames: ['Kurköln'], kind: 'state', spans: [[1356, 1803]], bbox: [6, 50.5, 8.5, 52], peak: 1600, src: 'cliopatria' },
  'test:roma': { name: 'Roman Empire', kind: 'state', spans: [[-27, 395]], bbox: [-10, 15, 49, 58], peak: 117, src: 'cliopatria' },
  'test:hre': { name: 'Holy Roman Empire', kind: 'state', spans: [[962, 1806]], bbox: [4, 43, 19, 55], peak: 1200, src: 'cliopatria' },
};

export const FILES = {
  c0: { l0: 'chunks/l0/c0.aaaa0000.topo.json', l1: 'chunks/l1/c0.aaaa0001.topo.json' },
  c1: { l0: 'chunks/l0/c1.bbbb0000.topo.json', l1: 'chunks/l1/c1.bbbb0001.topo.json' },
  c2: { l0: 'chunks/l0/c2.cccc0000.topo.json' },
  land: { l0: 'base/land-l0.dddd0000.topo.json', l1: 'base/land-l1.dddd0001.topo.json' },
  lakes: { l0: 'base/lakes-l0.eeee0000.topo.json' },
  polities: 'polities.ffff0000.json',
} as const;

export function makeManifest(): Manifest {
  const chunk = (id: 'c0' | 'c1' | 'c2', from: number, to: number) => ({
    id,
    from,
    to,
    files: { ...FILES[id] } as Record<string, string>,
    bytes: Object.fromEntries(Object.keys(FILES[id]).map((k) => [k, 1000])),
    records: RECORDS[id].length,
  });
  return {
    schema: 'alexs-atlas.borders/1',
    dataset: 'alexs-atlas-test',
    version: '0.0.0-test',
    built: '2026-10-01T00:00:00Z',
    years: { convention: 'historical-no-zero', from: -500, to: 2026, present: 2026, cutover: 1946 },
    lods: [
      { id: 'l0', toleranceM: 5000, minZoom: -2 },
      { id: 'l1', toleranceM: 1000, minZoom: 3 },
      { id: 'l2', toleranceM: 250, minZoom: 5 },
    ],
    chunks: [chunk('c0', -500, -1), chunk('c1', 1, 999), chunk('c2', 1000, 2026)],
    frames: [...FRAMES],
    base: { land: { ...FILES.land }, lakes: { ...FILES.lakes } },
    polities: FILES.polities,
    palette: { size: 12 },
    sources: [
      {
        id: 'cliopatria',
        name: 'Cliopatria (Seshat Global History Databank)',
        version: 'v0.2.0',
        url: 'https://github.com/Seshat-Global-History-Databank/cliopatria',
        license: 'CC BY 4.0',
        spdx: 'CC-BY-4.0',
        attribution: 'Historical borders: Cliopatria …',
      },
      {
        id: 'naturalearth',
        name: 'Natural Earth',
        version: 'v5.1.2',
        url: 'https://www.naturalearthdata.com/',
        license: 'Public domain',
        spdx: 'CC0-1.0',
        attribution: 'Made with Natural Earth.',
      },
      {
        id: 'override',
        name: 'Alex’s Atlas overrides',
        version: 'test',
        url: '',
        license: 'CC BY 4.0',
        spdx: 'CC-BY-4.0',
        attribution: 'Alex’s Atlas overrides',
      },
    ],
    attribution: { text: 'test', html: '<img src=x onerror=alert(1)>' },
  };
}

/** Every dataset file by its path relative to the manifest, as JSON text. */
export function makeFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const put = (path: string, json: unknown) => files.set(path, JSON.stringify(json));
  put('manifest.json', makeManifest());
  put(FILES.c0.l0, chunkTopology(RECORDS.c0));
  put(FILES.c0.l1, chunkTopology(RECORDS.c0));
  put(FILES.c1.l0, chunkTopology(RECORDS.c1, 1e4));
  put(FILES.c1.l1, chunkTopology(RECORDS.c1, 1e5));
  put(FILES.c2.l0, chunkTopology(RECORDS.c2, 1e5));
  put(FILES.land.l0, topology({ land: LAND_FEATURES() }, 1e5));
  put(FILES.land.l1, topology({ land: LAND_FEATURES() }));
  put(FILES.lakes.l0, topology({ lakes: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: poly(rect(2, 2, 4, 4)) }] } }));
  put(FILES.polities, POLITIES);
  return files;
}

export interface FakeServer {
  /** Folder URL of the dataset (ends with '/'). */
  readonly baseUrl: string;
  readonly manifestUrl: string;
  readonly files: Map<string, string>;
  readonly fetch: FetchLike;
  /** Every requested URL, in order. */
  readonly calls: string[];
  /** The AbortSignal each request received, in call order. */
  readonly signals: (AbortSignal | undefined)[];
  /** Requests for URLs containing a held pattern wait until release(). */
  hold(pattern: string): void;
  /** Lets held requests (all, or those matching `pattern`) proceed. */
  release(pattern?: string): void;
  /** Answer with an HTTP error status for URLs containing `pattern`; undefined clears it. */
  failWith(pattern: string, status: number | undefined): void;
  /** Number of requests whose URL contains `pattern`. */
  count(pattern: string): number;
  /** Requests currently waiting on a hold. */
  readonly waiting: number;
}

export function makeServer(baseUrl = 'https://example.test/data/alexs-atlas/', files = makeFiles()): FakeServer {
  const calls: string[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const holds = new Set<string>();
  const failures = new Map<string, number>();
  const parked: { url: string; go: () => void }[] = [];

  const fetch: FetchLike = async (url, init) => {
    calls.push(url);
    const signal = init?.signal;
    signals.push(signal);
    signal?.throwIfAborted();
    if ([...holds].some((p) => url.includes(p))) {
      await new Promise<void>((resolve, reject) => {
        const entry = { url, go: resolve };
        parked.push(entry);
        signal?.addEventListener(
          'abort',
          () => {
            parked.splice(parked.indexOf(entry), 1);
            reject(signal.reason);
          },
          { once: true },
        );
      });
    }
    for (const [pattern, status] of failures) {
      if (url.includes(pattern)) return new Response('error', { status, statusText: 'Test Error' });
    }
    const body = url.startsWith(baseUrl) ? files.get(url.slice(baseUrl.length)) : undefined;
    if (body === undefined) return new Response('not found', { status: 404, statusText: 'Not Found' });
    return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } });
  };

  return {
    baseUrl,
    manifestUrl: `${baseUrl}manifest.json`,
    files,
    fetch,
    calls,
    signals,
    hold: (pattern) => void holds.add(pattern),
    release(pattern) {
      if (pattern === undefined) holds.clear();
      else holds.delete(pattern);
      for (const p of [...parked]) {
        if (pattern === undefined || p.url.includes(pattern)) {
          parked.splice(parked.indexOf(p), 1);
          p.go();
        }
      }
    },
    failWith(pattern, status) {
      if (status === undefined) failures.delete(pattern);
      else failures.set(pattern, status);
    },
    count: (pattern) => calls.filter((u) => u.includes(pattern)).length,
    get waiting() {
      return parked.length;
    },
  };
}

/** Lets pending promise callbacks run (a few macrotask turns). */
export const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
