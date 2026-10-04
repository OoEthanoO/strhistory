import { topology as buildTopology } from 'topojson-server';
import { describe, expect, it } from 'vitest';
import { rect } from './testing/fixture.js';
import { absolutise, coastArcs, decodeLabels, decodeLines, dropCutEdges, isCutEdge, prepareChunk, type Topology } from './topo.js';

describe('absolutise', () => {
  // The l0 transform of the first dev dataset: x = 99999 decodes to 180.00000000000003.
  const scale: [number, number] = [0.0035033954739547395, 1];
  const translate: [number, number] = [-170.336044, -90];

  it('dequantises once, drops the transform and snaps float noise to ±180 / ±90', () => {
    const topology: Topology = {
      type: 'Topology',
      objects: {},
      transform: { scale, translate },
      arcs: [
        [
          [0, 0],
          [99999, 90],
          [-1, 90],
        ],
      ],
    };
    expect(99999 * scale[0] + translate[0]).toBeGreaterThan(180); // the bug being fixed
    absolutise(topology);
    expect(topology.transform).toBeUndefined();
    const [a, b, c] = topology.arcs[0] as number[][];
    expect(a).toEqual([-170.336044, -90]);
    expect(b).toEqual([180, 0]);
    expect(c?.[0]).toBeCloseTo(180 - scale[0], 12);
    expect(c?.[1]).toBe(90);
  });

  it('keeps extra coordinates and leaves real out-of-range values for QA to find', () => {
    const topology: Topology = { type: 'Topology', objects: {}, arcs: [[[180.00000000001, -90.000000000001, 7], [181, 95]]] };
    absolutise(topology);
    expect(topology.arcs[0]).toEqual([
      [180, -90, 7],
      [181, 95],
    ]);
  });

  it('is applied by prepareChunk', () => {
    const json = {
      type: 'Topology',
      transform: { scale, translate },
      objects: { polities: { type: 'GeometryCollection', geometries: [] } },
      arcs: [[[99999, 0]]],
    };
    const chunk = prepareChunk(json, 'x.json');
    expect(chunk.topology.transform).toBeUndefined();
    expect(chunk.topology.arcs[0]).toEqual([[180, -90]]);
  });
});

describe('isCutEdge', () => {
  it.each([
    [[180, 60], [180, 70], true],
    [[-180, 60], [-180, 70], true],
    [[-180, -90], [180, -90], true], // along the south pole
    [[10, 90], [20, 90], true],
    [[180, -80], [-180, -80], false], // along a parallel, across the map: real coast
    [[179.9, 60], [180, 70], false],
    [[180, 60], [170, 60], false],
    [[0, 0], [1, 1], false],
  ])('%j → %j: %s', (a, b, expected) => {
    expect(isCutEdge(a as number[], b as number[])).toBe(expected);
  });
});

describe('dropCutEdges', () => {
  it('splits lines at cut edges and drops parts shorter than two points', () => {
    expect(
      dropCutEdges([
        [
          [170, 60],
          [180, 60],
          [180, 70],
          [170, 70],
        ],
        [
          [180, 0],
          [180, 1],
        ],
        [
          [0, 0],
          [1, 0],
        ],
      ]),
    ).toEqual([
      [
        [170, 60],
        [180, 60],
      ],
      [
        [180, 70],
        [170, 70],
      ],
      [
        [0, 0],
        [1, 0],
      ],
    ]);
  });
});

describe('decodeLines coast cache', () => {
  // A = [0,10]×[0,10] and B = [10,20]×[0,10] share the edge x = 10 in years 1–2; in year 3
  // A holds both halves; the island I = [30,32]×[0,2] exists in year 2 only.
  const square = (x0: number, x1: number) => ({ type: 'Polygon', coordinates: [rect(x0, 0, x1, 10)] });
  const feature = (id: number, from: number, to: number, geometry: unknown) => ({
    type: 'Feature',
    id,
    properties: { id, rid: `r${id}`, pid: `p${id}`, name: `P${id}`, from, to, tier: 0, kind: 'state' },
    geometry,
  });
  const chunk = () =>
    prepareChunk(
      buildTopology({
        polities: {
          type: 'FeatureCollection',
          features: [
            feature(1, 1, 2, square(0, 10)),
            feature(2, 1, 2, square(10, 20)),
            feature(3, 2, 2, { type: 'Polygon', coordinates: [rect(30, 0, 32, 2)] }),
            // The merged area keeps the vertices at x = 10, as the pipeline's shared topology does.
            feature(4, 3, 3, { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [20, 0], [20, 10], [10, 10], [0, 10], [0, 0]]] }),
          ],
        },
      } as never),
      'cache-test.json',
    );
  const coastOf = (fc: ReturnType<typeof decodeLines>) => fc.features.find((f) => f.properties.kind === 'coast');
  const borderOf = (fc: ReturnType<typeof decodeLines>) => fc.features.find((f) => f.properties.kind === 'border');

  it('returns the identical coast feature for frames with the same coastline', () => {
    const c = chunk();
    const y1 = decodeLines(c, 1);
    const y3 = decodeLines(c, 3);
    expect(borderOf(y1)).toBeDefined();
    expect(borderOf(y3)).toBeUndefined();
    expect(coastOf(y3)).toBe(coastOf(y1));
  });

  it('builds a new coast feature when the coastline differs (an island appears)', () => {
    const c = chunk();
    const y1 = coastOf(decodeLines(c, 1));
    const y2 = coastOf(decodeLines(c, 2));
    expect(y2).not.toBe(y1);
    const points = (f: typeof y1) => f?.geometry.coordinates.reduce((n, line) => n + line.length, 0) ?? 0;
    expect(points(y2)).toBeGreaterThan(points(y1));
    expect(coastOf(decodeLines(c, 1))).toBe(y1); // both variants stay cached
  });

  it('is per chunk: another chunk with the same arcs gets its own feature', () => {
    expect(coastOf(decodeLines(chunk(), 1))).not.toBe(coastOf(decodeLines(chunk(), 1)));
  });

  it('coastArcs marks exactly the arcs used by one feature', () => {
    const c = chunk();
    const alive = c.polities.filter((g) => (g.properties as { from: number }).from <= 1 && (g.properties as { to: number }).to >= 1);
    const bits = coastArcs(c.topology, alive);
    const shared = c.topology.arcs.findIndex((arc) => (arc as number[][]).every((p) => p[0] === 10));
    expect(shared).toBeGreaterThanOrEqual(0);
    expect(bits[shared]).toBe(0);
    expect([...bits].filter(Boolean).length).toBeGreaterThan(0);
  });
});

describe('decodeLabels', () => {
  const rect2 = (x0: number, x1: number) => ({ type: 'Polygon', coordinates: [rect(x0, 0, x1, 10)] });
  const rec = (id: number, pid: string, a: number, lx: number, tier = 0, kind = 'state') => ({
    type: 'Feature',
    id,
    properties: { id, rid: `${pid}@${id}`, pid, name: pid, from: 1, to: 9, tier, kind, a, lx, ly: 5 },
    geometry: rect2(lx - 1, lx + 1),
  });
  const chunk = (features: unknown[]) =>
    prepareChunk(buildTopology({ polities: { type: 'FeatureCollection', features } } as never), 'labels-test.json');

  it('labels each polity once: its largest tier-0 record (an override remnant gets none)', () => {
    const c = chunk([rec(1, 'p:iran', 103, 10), rec(2, 'p:iran', 1.6e6, 30), rec(3, 'p:other', 5e4, 50), rec(4, 'p:iran', 2e6, 70, 1, 'disputed')]);
    const labels = decodeLabels(c, 5).features;
    expect(labels.map((f) => [f.properties.pid, f.geometry.coordinates[0]])).toEqual([
      ['p:iran', 30],
      ['p:other', 50],
    ]);
  });

  it('skips unclaimed land', () => {
    const c = chunk([rec(1, 'none', 1e6, 10, 0, 'unclaimed'), rec(2, 'p:a', 10, 30)]);
    expect(decodeLabels(c, 5).features.map((f) => f.properties.pid)).toEqual(['p:a']);
  });
});
