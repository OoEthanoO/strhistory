import type { Feature, Position } from '@alexs-atlas/borders';
import { describe, expect, it } from 'vitest';
import {
  WHOLE,
  angularDistance,
  capContains,
  capMeetsBox,
  cullFeature,
  cullFeatures,
  distanceToBox,
  growCap,
  isWhole,
  lineBox,
  splitParts,
  type Box,
  type Cap,
} from './cull.js';

const square = (x0: number, y0: number, x1: number, y1: number): Position[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
  [x0, y0],
];
const polygon = (ring: Position[]): Feature => ({ type: 'Feature', properties: { id: 1 }, geometry: { type: 'Polygon', coordinates: [ring] } });
const multi = (...rings: Position[][]): Feature => ({
  type: 'Feature',
  properties: { id: 2 },
  geometry: { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
});
const lines = (...ls: Position[][]): Feature => ({ type: 'Feature', properties: { kind: 'coast' }, geometry: { type: 'MultiLineString', coordinates: ls } });

/** Brute force: smallest distance from the point to a dense grid over the box. */
function bruteDistance(lon: number, lat: number, [w, s, e, n]: Box): number {
  let best = Infinity;
  for (let i = 0; i <= 200; i++) {
    for (let j = 0; j <= 200; j++) {
      best = Math.min(best, angularDistance(lon, lat, w + ((e - w) * i) / 200, s + ((n - s) * j) / 200));
    }
  }
  return best;
}

describe('sphere helpers', () => {
  it('angularDistance', () => {
    expect(angularDistance(0, 0, 90, 0)).toBeCloseTo(90, 9);
    expect(angularDistance(10, 90, -170, 80)).toBeCloseTo(10, 9);
    expect(angularDistance(179, 0, -179, 0)).toBeCloseTo(2, 9);
  });

  it('distanceToBox matches a brute-force search (meridian edges, poles, antimeridian)', () => {
    const cases: [number, number, Box][] = [
      [12, 48, [100, 20, 140, 50]], // East Asia from Europe
      [12, 48, [-80, 60, -60, 80]], // Canadian Arctic: nearest point well north of both
      [0, 10, [20, -10, 30, 0]],
      [170, 0, [-180, -5, -170, 5]], // across the antimeridian
      [-100, -60, [10, -80, 60, -60]], // nearer through the south pole region
      [160, 30, [-170, 40, 170, 70]], // a box wider than 180°: inside its longitudes
    ];
    for (const [lon, lat, box] of cases) {
      expect(distanceToBox(lon, lat, box)).toBeCloseTo(bruteDistance(lon, lat, box), 0);
    }
    expect(distanceToBox(15, 45, [10, 40, 20, 50])).toBe(0);
  });

  it('caps: meet, contain, grow', () => {
    const europe: Cap = { lon: 12, lat: 48, r: 30 };
    expect(capMeetsBox(europe, [20, 30, 25, 35])).toBe(true);
    expect(capMeetsBox(europe, [100, -40, 120, -20])).toBe(false);
    expect(capMeetsBox(WHOLE, [100, -40, 120, -20])).toBe(true);
    expect(capContains(europe, { lon: 15, lat: 50, r: 10 })).toBe(true);
    expect(capContains(europe, { lon: 60, lat: 50, r: 10 })).toBe(false); // ~31° away
    expect(growCap(europe, 0.5)).toEqual({ lon: 12, lat: 48, r: 45 });
    expect(isWhole(growCap({ lon: 0, lat: 0, r: 130 }, 0.5))).toBe(true);
  });

  it('lineBox is cached by array identity', () => {
    const ring = square(1, 2, 3, 4);
    const b = lineBox(ring);
    expect(b).toEqual([1, 2, 3, 4]);
    expect(lineBox(ring)).toBe(b);
  });
});

describe('cullFeature', () => {
  const view: Cap = { lon: 5, lat: 5, r: 10 };

  it('keeps or drops a polygon by its outer ring', () => {
    const inside = polygon(square(2, 2, 3, 3));
    expect(cullFeature(inside, view)).toBe(inside);
    expect(cullFeature(polygon(square(40, 40, 50, 50)), view)).toBeNull();
    const around = polygon(square(-50, -50, 50, 50)); // the view inside a big polygon
    expect(cullFeature(around, view)).toBe(around);
  });

  it('keeps only the parts of a MultiPolygon that meet the cap, as a copy', () => {
    const f = multi(square(1, 1, 2, 2), square(60, 60, 61, 61), square(12, 12, 14, 14));
    const c = cullFeature(f, view);
    expect(c).not.toBe(f);
    expect(c?.properties).toBe(f.properties);
    expect((c?.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(2);
    expect((f.geometry as { coordinates: unknown[] }).coordinates).toHaveLength(3); // input untouched
  });

  it('returns the feature itself when every part meets the cap', () => {
    const f = multi(square(1, 1, 2, 2), square(3, 3, 4, 4));
    expect(cullFeature(f, view)).toBe(f);
  });

  it('culls the lines of a MultiLineString', () => {
    const near: Position[] = [
      [1, 1],
      [2, 2],
    ];
    const far: Position[] = [
      [80, 50],
      [81, 51],
    ];
    expect((cullFeature(lines(near, far), view)?.geometry as { coordinates: unknown[] }).coordinates).toEqual([near]);
    expect(cullFeature(lines(far), view)).toBeNull();
  });

  it('keeps points and features without geometry', () => {
    const p: Feature = { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [100, 80] } };
    expect(cullFeature(p, view)).toBe(p);
  });
});

describe('splitParts', () => {
  it('returns the input array when there is nothing to split', () => {
    const fs = [polygon(square(1, 1, 2, 2)), multi(square(5, 5, 6, 6)), lines(square(0, 0, 1, 1))];
    expect(splitParts(fs)).toBe(fs);
  });

  it('makes one Polygon feature per part, sharing id and properties, in order', () => {
    const before = polygon(square(1, 1, 2, 2));
    const m = { ...multi(square(5, 5, 6, 6), square(8, 8, 9, 9), square(-3, 0, -2, 1)), id: 7 };
    const after = lines(square(0, 0, 1, 1));
    const out = splitParts([before, m, after]);
    expect(out).toHaveLength(5);
    expect(out[0]).toBe(before);
    expect(out[4]).toBe(after);
    const parts = out.slice(1, 4);
    expect(parts.map((f) => f.geometry)).toEqual([
      { type: 'Polygon', coordinates: [square(5, 5, 6, 6)] },
      { type: 'Polygon', coordinates: [square(8, 8, 9, 9)] },
      { type: 'Polygon', coordinates: [square(-3, 0, -2, 1)] },
    ]);
    for (const p of parts) {
      expect(p.properties).toBe(m.properties);
      expect((p as { id?: unknown }).id).toBe(7);
    }
  });
});

describe('cullFeatures', () => {
  it('returns the input array for the whole sphere or when nothing is dropped', () => {
    const fs = [polygon(square(1, 1, 2, 2))];
    expect(cullFeatures(fs, WHOLE)).toBe(fs);
    expect(cullFeatures(fs, { lon: 0, lat: 0, r: 10 })).toBe(fs);
  });

  it('drops features outside the cap', () => {
    const a = polygon(square(1, 1, 2, 2));
    const b = polygon(square(100, 1, 102, 2));
    expect(cullFeatures([a, b], { lon: 0, lat: 0, r: 10 })).toEqual([a]);
  });
});
