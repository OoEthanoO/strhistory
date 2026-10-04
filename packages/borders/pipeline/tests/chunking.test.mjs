// Unit tests for chunk planning and the topology post-processing.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as topojson from 'topojson-client';
import { planChunks, checkCoverage, chunkId, frameEnd, costsFrom } from '../steps/lib/chunking.mjs';
import { reverseRing, toRfc7946Winding, simplifyFileToTopology, finishChunkTopology, addStandInRectangle } from '../steps/lib/topo.mjs';
import { frameTopologyStats } from '../steps/lib/verify.mjs';
import { addYears, spanYears } from '../steps/lib/context.mjs';
import { planarRingArea } from '../steps/lib/geo.mjs';

describe('years without 0', () => {
  it('addYears and spanYears skip year 0', () => {
    expect(addYears(-1, 1)).toBe(1);
    expect(addYears(1, -1)).toBe(-1);
    expect(addYears(-5, 10)).toBe(6);
    expect(spanYears(-1, 1)).toBe(2);
    expect(spanYears(-500, 499)).toBe(999); // 500 BCE … 1 BCE (500) + 1 … 499 (499)
  });
  it('frameEnd ends a frame the year before the next one (1 CE → 1 BCE)', () => {
    expect(frameEnd([-10, 1, 5], 0, 2026)).toBe(-1);
    expect(frameEnd([-10, 1, 5], 1, 2026)).toBe(4);
    expect(frameEnd([-10, 1, 5], 2, 2026)).toBe(2026);
  });
  it('chunk ids are readable and safe', () => {
    expect(chunkId(-3400, -2501)).toBe('3400bce-2501bce');
    expect(chunkId(-500, 499)).toBe('500bce-499');
    expect(chunkId(1946, 2026)).toBe('1946-2026');
  });
});

describe('planChunks', () => {
  // synthetic history: a frame every 10 years, each frame adds a new 1000-vertex record
  const frames = [];
  for (let y = -3400; y <= 2020; y += 10) frames.push(y === 0 ? 1 : y);
  if (!frames.includes(1946)) frames.push(1946);
  frames.sort((a, b) => a - b);
  const features = frames.map((y, i) => ({ from: y, to: frameEnd(frames, i, 2026), hash: `h${i}`, vertices: 1000 }));
  features.push({ from: -3400, to: 2026, hash: 'world', vertices: 5000 }); // one long-lived record
  features.sort((a, b) => a.from - b.from);

  it('costs count each distinct geometry once', () => {
    const c = costsFrom(frames, features, 0, 2026);
    expect(c[0]).toBe(6000);
    expect(c[1]).toBe(7000);
  });

  it('covers every year, stays in budget, respects maxYears and the forced break', async () => {
    const measure = async ({ from, to }) => {
      const alive = features.filter((f) => f.from <= to && f.to >= from);
      return { bytes: alive.reduce((s, f) => s + f.vertices, 0) * 2 }; // 2 bytes per vertex
    };
    const { chunks, measurements } = await planChunks(frames, features, { present: 2026, maxYears: 1000, target: 100_000, breaks: [1946], measure });
    const withIds = chunks.map((c) => ({ ...c, id: chunkId(c.from, c.to) }));
    expect(() => checkCoverage(withIds, -3400, 2026)).not.toThrow();
    for (const c of chunks) {
      expect(c.measured.bytes).toBeLessThanOrEqual(100_000);
      expect(spanYears(c.from, c.to)).toBeLessThanOrEqual(1000);
      expect(c.from < 1946 && c.to >= 1946).toBe(false);
      expect(frames).toContain(c.from);
    }
    expect(chunks.some((c) => c.from === 1946)).toBe(true);
    // greedy: chunks are filled reasonably (no chunk under a third of the budget except the last ones per segment)
    const small = chunks.filter((c) => c.measured.bytes < 33_000 && c.to !== 1945 && c.to !== 2026);
    expect(small.length).toBe(0);
    expect(measurements).toBeLessThan(chunks.length * 4);
  });

  it('accepts a single over-budget frame and flags it', async () => {
    const { chunks } = await planChunks([1, 10, 20], [{ from: 1, to: 2026, hash: 'x', vertices: 10 }], {
      present: 2026, maxYears: 1000, target: 100, measure: async () => ({ bytes: 500 }),
    });
    expect(chunks.every((c) => c.overBudget)).toBe(true);
    expect(chunks.map((c) => [c.from, c.to])).toEqual([[1, 9], [10, 19], [20, 2026]]);
  });

  it('checkCoverage rejects gaps, overlaps and wrong ends', () => {
    expect(() => checkCoverage([{ from: -3400, to: -1 }, { from: 1, to: 2026 }], -3400, 2026)).not.toThrow();
    expect(() => checkCoverage([{ from: -3400, to: -2 }, { from: 1, to: 2026 }], -3400, 2026)).toThrow(/gap or overlap/);
    expect(() => checkCoverage([{ from: -3400, to: 100 }, { from: 100, to: 2026 }], -3400, 2026)).toThrow(/gap or overlap/);
    expect(() => checkCoverage([{ from: -3400, to: 2025 }], -3400, 2026)).toThrow(/last chunk/);
  });
});

describe('topology post-processing', () => {
  it('reverses rings arc-wise', () => {
    expect(reverseRing([0, 1, ~2])).toEqual([2, ~1, ~0]);
    const g = { type: 'MultiPolygon', arcs: [[[0, 1]], [[2], [~3]]] };
    toRfc7946Winding(g);
    expect(g.arcs).toEqual([[[~1, ~0]], [[~2], [3]]]);
  });

  it('adds a grid-aligned stand-in rectangle wound counter-clockwise', () => {
    const t = { transform: { scale: [0.01, 0.01], translate: [0, 0] }, arcs: [] };
    const i = addStandInRectangle(t, [0.0005, 0.0005, 0.0012, 0.0013]);
    expect(t.arcs[i]).toEqual([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]]);
  });

  it('keeps neighbours and unclaimed land aligned after simplification (shared arcs)', async () => {
    // A 3-feature partition of a 10° square with a wiggly shared border (many vertices)
    // plus a later-year feature that covers both, as in a multi-year chunk.
    const wiggle = [];
    for (let k = 0; k <= 200; k++) wiggle.push([5 + 0.2 * Math.sin(k / 3), k * 0.05]);
    const left = [[0, 0], ...wiggle, [0, 10], [0, 0]];
    const right = [[10, 0], [10, 10], ...wiggle.slice().reverse(), [10, 0]];
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Polygon', coordinates: [left] } },
        { type: 'Feature', properties: { id: 2 }, geometry: { type: 'Polygon', coordinates: [right] } },
        { type: 'Feature', properties: { id: 3 }, geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
      ],
    };
    const dir = mkdtempSync(join(tmpdir(), 'topo-'));
    try {
      const file = join(dir, 'chunk.geojson');
      writeFileSync(file, JSON.stringify(fc));
      const t = await simplifyFileToTopology(file, { layer: 'polities', toleranceM: 20000, quantization: 100000 });
      const props = new Map([
        [1, { id: 1, rid: 'a@1', pid: 'a', name: 'A', from: 1, to: 10, kind: 'state', tier: 0 }],
        [2, { id: 2, rid: 'none@1', pid: 'none', name: '', from: 1, to: 10, kind: 'unclaimed', tier: 0 }],
        [3, { id: 3, rid: 'b@11', pid: 'b', name: 'B', from: 11, to: 20, kind: 'state', tier: 0 }],
      ]);
      const standIns = finishChunkTopology(t, 'polities', props, new Map());
      expect(standIns).toEqual([]);
      const s = frameTopologyStats(t, 'polities', 5);
      expect(s.features).toBe(2);
      expect(s.overlapKm).toBe(0);
      expect(s.borderKm).toBeGreaterThan(1000); // the wiggly border is shared, not duplicated
      const later = frameTopologyStats(t, 'polities', 15);
      expect(later.features).toBe(1);
      expect(Math.abs(later.exteriorKm - s.exteriorKm)).toBeLessThan(1); // same outline both years
      // decoded exterior rings are counter-clockwise (RFC 7946)
      const decoded = topojson.feature(t, t.objects.polities);
      for (const f of decoded.features) expect(planarRingArea(f.geometry.coordinates[0])).toBeGreaterThan(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
