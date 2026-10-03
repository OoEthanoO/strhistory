// Shared-arc guarantees of the chunk topologies: noding T-junctions (lib/noding.mjs),
// merging arcs that simplification made identical (lib/topo.mjs) and the arc-use
// classification of the alignment check (lib/verify.mjs).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeRings, snapVertices, despikeRing, cleanRings } from '../steps/lib/noding.mjs';
import { mergeCoincidentArcs, removeDuplicatePoints, simplifyFileToTopology, finishChunkTopology, dropSmallIslands, protectionSizeM, splitRing } from '../steps/lib/topo.mjs';
import { frameTopologyStats, arcLengthsKm } from '../steps/lib/verify.mjs';

const dir = mkdtempSync(join(tmpdir(), 'alexs-atlas-topology-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const props = (id) => ({ id, tier: 0, from: 1800, to: 1800 });

describe('nodeRings', () => {
  it('inserts a neighbour vertex that lies on, or within eps of, a segment', () => {
    const a = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    // B shares A's right edge but has vertices in the middle of it: exactly on it, and 1 cm off
    const b = [[1, 0], [2, 0], [2, 1], [1, 1], [1 + 1e-7, 0.6], [1, 0.3], [1, 0]];
    const inserted = nodeRings([a, b], 1e-5);
    expect(inserted).toBe(2);
    expect(a).toEqual([[0, 0], [1, 0], [1, 0.3], [1 + 1e-7, 0.6], [1, 1], [0, 1], [0, 0]]);
    expect(b).toHaveLength(7); // nothing of A lies inside B's segments
  });

  it('leaves vertices near segment ends to vertex snapping and ignores far vertices', () => {
    const a = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const b = [[1 + 1e-6, 1e-6], [2, 0], [2, 1], [1.001, 0.5], [1 + 1e-6, 1e-6]];
    expect(nodeRings([a, b], 1e-5)).toBe(0);
  });
});

describe('snapVertices / despikeRing / cleanRings', () => {
  it('merges vertices closer than eps into the first one met, across rings', () => {
    const a = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const b = [[1 + 2e-5, 1e-5], [2, 0], [1 + 2e-5, 1e-5]];
    expect(snapVertices([a, b], 3e-5)).toBe(2);
    expect(b[0]).toEqual([1, 0]);
    expect(b[2]).toEqual([1, 0]);
    expect(snapVertices([[[0, 0], [5e-5, 0], [0, 0]]], 3e-5)).toBe(0); // farther than eps: kept
  });

  it('removes repeated vertices and spikes, also across the seam', () => {
    const r1 = [[0, 0], [1, 0], [1, 0], [2, 0], [1, 0], [1, 1], [0, 1], [0, 0]]; // repeat + spike at (2, 0)
    expect(despikeRing(r1)).toBe(3);
    expect(r1).toEqual([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]);
    const r2 = [[5, 5], [0, 0], [1, 0], [1, 1], [0, 0], [5, 5]]; // spike to (5, 5) across the seam
    despikeRing(r2);
    expect(r2).toEqual([[0, 0], [1, 0], [1, 1], [0, 0]]);
    const r3 = [[0, 0], [1, 0], [2, 0], [1, 0], [0, 0]]; // nothing but a spike
    despikeRing(r3);
    expect(r3).toEqual([]);
  });

  it('drops the polygons and holes that degenerate', () => {
    const square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
    const flatHole = [[0.2, 0.2], [0.5, 0.2], [0.2, 0.2]];
    const flat = [[3, 3], [4, 3], [3, 3]];
    const polygons = [[[square, flatHole], [flat]]];
    const counts = cleanRings(polygons, 3e-5);
    expect(polygons).toEqual([[[square]]]);
    expect(counts.rings).toBe(2);
  });
});

describe('T-junctions end to end (mapshaper topology)', () => {
  // two squares sharing x = 1; the right one has an extra vertex on the shared edge
  const fc = {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
      { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Polygon', coordinates: [[[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1, 0]]] } },
    ],
  };
  const build = async (data, name) => {
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(data));
    const t = await simplifyFileToTopology(path, { layer: 'polities', toleranceM: 1000, quantization: 1e6 });
    for (const g of t.objects.polities.geometries) g.properties = props(g.id);
    return frameTopologyStats(t, 'polities', 1800, arcLengthsKm(t));
  };

  it('without noding the shared edge is two separate arcs', async () => {
    const s = await build(fc, 'raw.geojson');
    expect(s.borderKm).toBe(0);
  });

  it('after noding the neighbours share the edge', async () => {
    const noded = structuredClone(fc);
    nodeRings(noded.features.map((f) => f.geometry.coordinates[0]), 1e-5);
    const s = await build(noded, 'noded.geojson');
    expect(s.borderKm).toBeGreaterThan(110); // 1° of meridian
    expect(s.borderKm).toBeLessThan(112);
    expect(s.overlapKm).toBe(0);
  });

  // The right square's border runs down to y = 0.5, out along a 2 cm wide slit to y = 0.1
  // and back, then on to y = 0 (overlay residue seen in the 617 Gwynedd/Mercia border)
  const slit = structuredClone(fc);
  slit.features[1].geometry.coordinates[0] = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], [1 + 2e-7, 0.1], [1 + 1e-7, 0.5000001], [1, 0]];

  const tip = [1 + 2e-7, 0.1];

  it('noding alone leaves the slit as a spike the ring runs twice', () => {
    const rings = structuredClone(slit).features.map((f) => f.geometry.coordinates[0]);
    nodeRings(rings, 3e-5);
    expect(rings[1].filter((p) => p[0] === tip[0] && p[1] === tip[1])).toHaveLength(2);
  });

  it('cleanRings removes the slit and the neighbours share one clean border', async () => {
    const cleaned = structuredClone(slit);
    const polygons = cleaned.features.map((f) => [f.geometry.coordinates]);
    const counts = cleanRings(polygons, 3e-5);
    polygons.forEach((p, i) => (cleaned.features[i].geometry.coordinates = p[0]));
    expect(counts).toMatchObject({ snapped: 1, spikes: 2, rings: 0 });
    // the slit's far end stays as a vertex both rings run through once
    expect(cleaned.features[1].geometry.coordinates[0]).toEqual([[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.5], tip, [1, 0]]);
    expect(cleaned.features[0].geometry.coordinates[0]).toEqual([[0, 0], [1, 0], tip, [1, 0.5], [1, 1], [0, 1], [0, 0]]);
    const s = await build(cleaned, 'slit-clean.geojson');
    expect(s.overlapKm).toBe(0);
    expect(s.borderKm).toBeGreaterThan(110);
    expect(s.borderKm).toBeLessThan(112);
  });
});

describe('mergeCoincidentArcs', () => {
  it('merges identical and reversed copies and compacts the arcs', () => {
    const t = {
      type: 'Topology',
      arcs: [
        [[0, 0], [1, 0]],
        [[1, 0], [0, 0]], // reversed copy of 0
        [[0, 0], [0, 1], [1, 0]], // same ends, different path: kept
        [[0, 0], [1, 0]], // identical copy of 0
        [[5, 5], [6, 6]], // unused: dropped
      ],
      objects: {
        polities: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Polygon', id: 1, arcs: [[0, ~2]] },
            { type: 'Polygon', id: 2, arcs: [[1, 2]] },
            { type: 'Polygon', id: 3, arcs: [[~3, 2]] },
          ],
        },
      },
    };
    expect(mergeCoincidentArcs(t)).toBe(2);
    expect(t.arcs).toEqual([[[0, 0], [1, 0]], [[0, 0], [0, 1], [1, 0]]]);
    expect(t.objects.polities.geometries.map((g) => g.arcs)).toEqual([[[0, ~1]], [[~0, 1]], [[~0, 1]]]);
  });

  it('compares absolute coordinates of quantized (delta-encoded) arcs', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [1, 1], translate: [0, 0] },
      arcs: [[[0, 0], [3, 4]], [[3, 4], [-3, -4]]],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0]] }, { type: 'Polygon', id: 2, arcs: [[1]] }] } },
    };
    expect(mergeCoincidentArcs(t)).toBe(1);
    expect(t.objects.polities.geometries[1].arcs).toEqual([[~0]]);
  });
});

describe('removeDuplicatePoints', () => {
  it('drops [0,0] deltas so copies that differ by a repeated point merge', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [1, 1], translate: [0, 0] },
      // arc 1 is arc 0 reversed, with its last point repeated (two vertices on one grid cell)
      // arc 0: (0,0) (3,4) (5,4); arc 1: (5,4) (3,4) (0,0) (0,0)
      arcs: [[[0, 0], [3, 4], [2, 0]], [[5, 4], [-2, 0], [-3, -4], [0, 0]], [[7, 7], [0, 0]]],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0]] }, { type: 'Polygon', id: 2, arcs: [[1]] }, { type: 'Polygon', id: 3, arcs: [[2]] }] } },
    };
    expect(removeDuplicatePoints(t)).toBe(1); // the zero-length arc 2 keeps its two points
    expect(t.arcs[1]).toEqual([[5, 4], [-2, 0], [-3, -4]]);
    expect(t.arcs[2]).toEqual([[7, 7], [0, 0]]);
    expect(mergeCoincidentArcs(t)).toBe(1);
    expect(t.objects.polities.geometries[1].arcs).toEqual([[~0]]);
  });
});

describe('protectionSizeM', () => {
  it('is sqrt(area / parts) / K, counting parts only for small records', () => {
    expect(protectionSizeM(2, 1)).toBeCloseTo(Math.sqrt(2e6) / 50, 6); // Monaco-sized: ~28 m
    expect(protectionSizeM(100, 4)).toBeCloseTo(Math.sqrt(25e6) / 50, 6); // archipelago state: per islet
    expect(protectionSizeM(1e6, 400)).toBeCloseTo(Math.sqrt(1e12) / 50, 6); // empire: parts ignored
    expect(protectionSizeM(0, 1)).toBe(0);
  });
});

describe('finishChunkTopology', () => {
  it('joins the parts of a record and gives a fully collapsed record a stand-in', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      arcs: [[[0, 0], [0, 10], [10, 0], [0, -10], [-10, 0]], [[50, 50], [0, 10], [10, 0], [0, -10], [-10, 0]]],
      objects: {
        polities: {
          type: 'GeometryCollection',
          geometries: [
            { type: 'Polygon', id: 7, arcs: [[0]] },
            { type: null, id: 9 },
            { type: 'Polygon', id: 7, arcs: [[1]] },
          ],
        },
      },
    };
    const propsById = new Map([[7, { id: 7, rid: 'a@1' }], [9, { id: 9, rid: 'b@1' }]]);
    const standIns = finishChunkTopology(t, 'polities', propsById, new Map([[9, [1, 1, 1.001, 1.001]]]));
    expect(standIns).toEqual([9]);
    const [a, b] = t.objects.polities.geometries;
    expect(a).toMatchObject({ type: 'MultiPolygon', id: 7, properties: { rid: 'a@1' } });
    expect(a.arcs).toEqual([[[~0]], [[~1]]]); // RFC 7946 winding: mapshaper's clockwise rings reversed
    expect(b).toMatchObject({ type: 'Polygon', id: 9, arcs: [[2]] });
    expect(t.arcs).toHaveLength(3);
  });

  it('treats rings that collapsed on the quantization grid as collapsed', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      // arc 0: a ring flattened onto a line (zero area); arc 1: a proper square
      arcs: [[[0, 0], [5, 0], [-5, 0]], [[20, 20], [0, 10], [10, 0], [0, -10], [-10, 0]]],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0]] }, { type: 'Polygon', id: 2, arcs: [[1], [0]] }] } },
    };
    const propsById = new Map([[1, { id: 1, rid: 'vatican@1946' }], [2, { id: 2, rid: 'b@1946' }]]);
    expect(finishChunkTopology(t, 'polities', propsById, new Map([[1, [0, 0, 0.001, 0.001]]]))).toEqual([1]);
    const [a, b] = t.objects.polities.geometries;
    // the flat arc 0 is unused afterwards and compacted away: the square is arc 0, the stand-in arc 1
    expect(t.arcs).toHaveLength(2);
    expect(a.arcs).toEqual([[1]]); // stand-in rectangle
    expect(b.arcs).toEqual([[~0]]); // the degenerate hole is gone
  });

  it('splits a ring at an arc it uses both ways (spike or corridor)', () => {
    expect(splitRing([0, 1, 2])).toEqual([[0, 1, 2]]);
    expect(splitRing([0, 5, ~5, 1])).toEqual([[0, 1]]); // a spike: nothing between the two uses
    // a corridor (arc 3) between two lobes [0, 1] and [7, 8]: two rings, the arc gone
    expect(splitRing([0, 3, 7, 8, ~3, 1]).sort()).toEqual([[0, 1], [7, 8]].sort());
    expect(splitRing([4, ~4])).toEqual([]);
  });

  it('turns a corridor-joined polygon into two parts that no longer use the corridor', () => {
    // lobes: squares (0,0)-(10,10) and (20,0)-(30,10) in grid units, joined along y = 5 by
    // arc 2 (the corridor, run east then west by the same clockwise ring)
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      arcs: [
        [[10, 5], [0, -5], [-10, 0], [0, 10], [10, 0], [0, -5]], // west lobe, clockwise from (10, 5) back to (10, 5)
        [[20, 5], [0, 5], [10, 0], [0, -10], [-10, 0], [0, 5]], // east lobe, clockwise from (20, 5) back to (20, 5)
        [[10, 5], [10, 0]], // corridor (10, 5) -> (20, 5)
      ],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0, 2, 1, ~2]] }] } },
    };
    finishChunkTopology(t, 'polities', new Map([[1, { id: 1, rid: 'x@1', kind: 'state' }]]), new Map());
    const [g] = t.objects.polities.geometries;
    expect(g.type).toBe('MultiPolygon');
    expect(g.arcs.flat(2).map((a) => (a < 0 ? ~a : a)).sort()).toEqual([0, 1]); // the corridor is gone
    expect(t.arcs).toHaveLength(2);
  });

  it('gives a hole of a split polygon to the lobe that contains it', () => {
    // lobes A (0,0)-(10,10) and B (20,2)-(28,8) joined by corridor arc 2; hole H in B
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      arcs: [
        [[10, 5], [0, -5], [-10, 0], [0, 10], [10, 0], [0, -5]], // A, clockwise from (10, 5)
        [[20, 5], [0, 3], [8, 0], [0, -6], [-8, 0], [0, 3]], // B, clockwise from (20, 5)
        [[10, 5], [10, 0]], // corridor (10, 5) -> (20, 5)
        [[23, 4], [2, 0], [0, 2], [-2, 0], [0, -2]], // H, counter-clockwise
      ],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0, 2, 1, ~2], [3]] }] } },
    };
    finishChunkTopology(t, 'polities', new Map([[1, { id: 1, rid: 'x@1', kind: 'state' }]]), new Map());
    const [g] = t.objects.polities.geometries;
    expect(g.type).toBe('MultiPolygon');
    const flat = (p) => p.flat().map((a) => (a < 0 ? ~a : a));
    const withHole = g.arcs.find((p) => p.length === 2);
    expect(t.arcs).toHaveLength(3); // the corridor is unused and compacted away: H is arc 2 now
    expect(flat(withHole)).toEqual([1, 2]); // B and its hole, not the larger A
    expect(g.arcs.find((p) => p.length === 1).map((r) => r.map((a) => (a < 0 ? ~a : a)))).toEqual([[0]]);
  });

  it('drops a hole that simplification moved outside its shell', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      arcs: [
        [[0, 0], [0, 10], [10, 0], [0, -10], [-10, 0]], // shell (0,0)-(10,10), clockwise
        [[3, 3], [2, 0], [0, 2], [-2, 0], [0, -2]], // hole inside, counter-clockwise
        [[13, 3], [2, 0], [0, 2], [-2, 0], [0, -2]], // 'hole' outside the shell
      ],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0], [1], [2]] }] } },
    };
    finishChunkTopology(t, 'polities', new Map([[1, { id: 1, rid: 'x@1', kind: 'state' }]]), new Map());
    const [g] = t.objects.polities.geometries;
    expect(g.type).toBe('Polygon');
    expect(g.arcs).toHaveLength(2); // shell + the inside hole
    expect(t.arcs).toHaveLength(2); // the outside ring's arc is compacted away
  });

  it('leaves collapsed unclaimed land out instead of standing it in', () => {
    const t = {
      type: 'Topology',
      transform: { scale: [0.01, 0.01], translate: [0, 0] },
      arcs: [[[0, 0], [5, 0], [-5, 0]], [[20, 20], [0, 10], [10, 0], [0, -10], [-10, 0]]],
      objects: { polities: { type: 'GeometryCollection', geometries: [{ type: 'Polygon', id: 1, arcs: [[0]] }, { type: 'Polygon', id: 2, arcs: [[1]] }] } },
    };
    const propsById = new Map([[1, { id: 1, rid: 'none@1700#3', kind: 'unclaimed' }], [2, { id: 2, rid: 'b@1700', kind: 'state' }]]);
    const dropped = [];
    expect(finishChunkTopology(t, 'polities', propsById, new Map([[1, [0, 0, 0.05, 0.001]]]), dropped)).toEqual([]);
    expect(dropped).toEqual([1]);
    expect(t.objects.polities.geometries.map((g) => g.id)).toEqual([2]);
    expect(t.arcs).toHaveLength(1); // the collapsed strip's arc is compacted away
    expect(t.objects.polities.geometries[0].arcs).toEqual([[~0]]);
  });
});

describe('dropSmallIslands', () => {
  // record 1: a 1°×1° block + a 0.1°×0.1° islet (~120 km² at the equator) + a shared-edge part
  const square = (x, y, d) => [[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]];
  const topo = () => ({
    type: 'Topology',
    arcs: [square(0, 0, 1), square(5, 5, 0.1), square(10, 0, 0.1), square(20, 0, 0.1)],
    objects: {
      polities: {
        type: 'GeometryCollection',
        geometries: [
          { type: 'MultiPolygon', id: 1, properties: { a: 12400 }, arcs: [[[0]], [[1]], [[2]]] },
          { type: 'Polygon', id: 2, properties: { a: 120 }, arcs: [[~2]] }, // shares the third part's ring
          { type: 'MultiPolygon', id: 3, properties: { a: 240 }, arcs: [[[3]], [[1]]] },
        ],
      },
    },
  });

  it('drops isolated islets under the threshold, keeping shared and largest parts', () => {
    const t = topo();
    t.objects.polities.geometries.pop(); // record 3 would make the islet's arc shared
    const r = dropSmallIslands(t, 'polities', 200);
    expect(r.parts).toBe(1);
    expect(r.km2).toBeGreaterThan(100);
    // arcs compacted: the islet's arc and the arc of the removed record 3 are gone
    expect(t.objects.polities.geometries[0].arcs).toEqual([[[0]], [[1]]]);
    expect(t.objects.polities.geometries[1].arcs).toEqual([[~1]]);
    expect(t.arcs).toEqual([square(0, 0, 1), square(10, 0, 0.1)]);
  });

  it('keeps everything of protected records and of islets used by another record', () => {
    const t = topo();
    const r = dropSmallIslands(t, 'polities', 200, (g) => g.properties.a < 5000);
    expect(r.parts).toBe(0); // record 1's islet is also used by record 3; record 3 is small
    expect(t.arcs).toHaveLength(4);
  });
});

describe('frameTopologyStats', () => {
  const lengths = [1, 2, 4, 8];
  const topo = (geometries) => ({ type: 'Topology', arcs: [[], [], [], []], objects: { polities: { type: 'GeometryCollection', geometries } } });
  const geom = (id, arcs, extra = {}) => ({ type: 'MultiPolygon', id, properties: { ...props(id), ...extra }, arcs });

  it('classifies exterior, border, internal and overlapping arcs', () => {
    const s = frameTopologyStats(
      topo([
        geom(1, [[[0, 1]], [[~1, 2]]]), // arc 1 used both ways by feature 1: internal
        geom(2, [[[~2, 3]]]), // arc 2: border between 1 and 2
        geom(3, [[[3]]]), // arc 3 used twice in the same direction: overlap
      ]),
      'polities',
      1800,
      lengths,
    );
    expect(s).toMatchObject({ features: 3, exteriorKm: 1, internalKm: 2, borderKm: 4, overlapKm: 8 });
  });

  it('keeps a border when a feature also touches itself along it', () => {
    const s = frameTopologyStats(topo([geom(1, [[[0]], [[~0]], [[0]]]), geom(2, [[[~0]]])]), 'polities', 1800, lengths);
    expect(s).toMatchObject({ internalKm: 1, borderKm: 1, overlapKm: 0, exteriorKm: 0 });
  });

  it('ignores tier-1 overlays and records not alive in the year', () => {
    const s = frameTopologyStats(topo([geom(1, [[[0]]]), geom(2, [[[~0]]], { tier: 1 }), geom(3, [[[~0]]], { from: 1801, to: 1810 })]), 'polities', 1800, lengths);
    expect(s).toMatchObject({ features: 1, exteriorKm: 1, borderKm: 0 });
  });
});
