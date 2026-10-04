// lib/features.mjs: scanning features.geojsonl (contract props, sliver parts left out).
import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanFeatures, keepParts, isSliverPart, SLIVER_KM2, SLIVER_WIDTH_M } from '../steps/lib/features.mjs';

const dir = mkdtempSync(join(tmpdir(), 'alexs-atlas-features-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

// a 0.1° square (~120 km² at 10°N) and a zero-area "spike" (collinear points, a few m²)
const square = (x, y, d = 0.1) => [[[x, y], [x + d, y], [x + d, y + d], [x, y + d], [x, y]]];
const spike = (x, y) => [[[x, y], [x + 0.000015, y + 0.004456], [x + 0.000012, y + 0.00369], [x, y]]];

function feature(props, geometry) {
  return { type: 'Feature', id: props.id, properties: { kind: 'state', tier: 0, src: 'cliopatria', ...props }, geometry };
}

function scan(features, opts) {
  const file = join(dir, `f${Math.random().toString(36).slice(2)}.geojsonl`);
  writeFileSync(file, features.map((f) => JSON.stringify(f)).join('\n') + '\n');
  return scanFeatures(file, opts);
}

describe('scanFeatures', () => {
  it('fills the contract properties and keeps whole geometries', () => {
    const { features, errors, slivers } = scan([feature({ id: 1, pid: 'clio:a', name: 'A', from: -500, to: -1 }, { type: 'Polygon', coordinates: square(10, 10) })]);
    expect(errors).toEqual([]);
    expect(slivers.parts).toBe(0);
    const p = features[0].props;
    expect(p.rid).toBe('clio:a@-500');
    expect(p.power).toBe('clio:a');
    expect(p.a).toBeGreaterThan(100);
    expect(p.a).toBeLessThan(130);
    expect(p.lx).toBeCloseTo(10.05, 2);
    expect(features[0].keepParts).toBeUndefined();
  });

  it('leaves zero-area spike parts out of polities and unclaimed land, and reports them', () => {
    const multi = { type: 'MultiPolygon', coordinates: [square(10, 10), spike(10.78169, 51.543515), square(20, 10)] };
    const { features, errors, slivers } = scan(
      [
        feature({ id: 1, pid: 'clio:a', name: 'A', from: 1800, to: 1805 }, multi),
        feature({ id: 2, pid: 'none', name: '', kind: 'unclaimed', from: 1800, to: 1805 }, multi),
        feature({ id: 3, pid: 'clio:b', name: 'B', from: 1800, to: 1805 }, { type: 'Polygon', coordinates: spike(8.408284, 51.487419) }),
      ],
      { splitUnclaimed: true },
    );
    expect(errors).toEqual([]);
    expect(slivers.parts).toBe(3);
    expect(slivers.records).toEqual(['clio:a@1800', 'none@1800', 'clio:b@1800']);
    expect(slivers.dropped).toEqual(['clio:b@1800']);
    expect(slivers.km2).toBeLessThan(SLIVER_KM2 * 3);

    const a = features.find((f) => f.props.pid === 'clio:a');
    expect(a.keepParts).toEqual([0, 2]);
    expect(a.vertices).toBe(10);
    expect(a.bbox).toEqual([10, 10, 20.1, 10.1]);
    // pieces of unclaimed land keep their index into the source MultiPolygon
    expect(features.filter((f) => f.props.kind === 'unclaimed').map((f) => f.part)).toEqual([0, 2]);
    expect(features.some((f) => f.props.pid === 'clio:b')).toBe(false);
  });

  it('leaves hair-thin parts out however long they are, but keeps small islets', () => {
    // 30 km long, 1e-5 deg (~1.1 m) wide: about 33,000 m², far above SLIVER_KM2, width < SLIVER_WIDTH_M
    const hair = [[[30, 0], [30.27, 0], [30.27, 0.00001], [30, 0.00001], [30, 0]]];
    // 30 m x 30 m rock: 900 m², width 15 m
    const rock = [[[40, 0], [40.00027, 0], [40.00027, 0.00027], [40, 0.00027], [40, 0]]];
    const { features, slivers } = scan([feature({ id: 1, pid: 'none', name: '', kind: 'unclaimed', from: 1800, to: 1805 },
      { type: 'MultiPolygon', coordinates: [square(10, 10), hair, rock] })], { splitUnclaimed: true });
    expect(SLIVER_WIDTH_M).toBe(2);
    expect(isSliverPart(hair)).toBe(true);
    expect(isSliverPart(rock)).toBe(false);
    expect(slivers.parts).toBe(1);
    expect(features.map((f) => f.part)).toEqual([0, 2]);
  });
});

describe('keepParts', () => {
  const multi = { type: 'MultiPolygon', coordinates: [square(0, 0), square(1, 1), square(2, 2)] };
  it('returns the geometry unchanged when nothing is left out', () => {
    expect(keepParts(multi, undefined)).toBe(multi);
    expect(keepParts(multi, [0, 1, 2])).toBe(multi);
  });
  it('returns a Polygon for one kept part, a MultiPolygon for several', () => {
    expect(keepParts(multi, [1])).toEqual({ type: 'Polygon', coordinates: square(1, 1) });
    expect(keepParts(multi, [0, 2])).toEqual({ type: 'MultiPolygon', coordinates: [square(0, 0), square(2, 2)] });
  });
});
