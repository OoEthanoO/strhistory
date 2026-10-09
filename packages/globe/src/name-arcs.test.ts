import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from '@alexs-atlas/borders';
import { nameArc, nameArcs, otherLand, shortName } from './name-arcs.js';

const KM = 111.32;
const rect = (w: number, s: number, e: number, n: number): Polygon => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
});

/** An arched band: the upper half of a ring around (0, 0) between radii r0 and r1 (degrees). */
function arch(r0: number, r1: number, steps = 48): Polygon {
  const outer: number[][] = [];
  const inner: number[][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI - (Math.PI * i) / steps;
    outer.push([r1 * Math.cos(a), r1 * Math.sin(a)]);
    inner.push([r0 * Math.cos(a), r0 * Math.sin(a)]);
  }
  return { type: 'Polygon', coordinates: [[...outer, ...inner.reverse(), outer[0]!]] };
}

describe('nameArc', () => {
  it('runs along the long axis of a wide polity, west to east, over most of its length', () => {
    const line = nameArc(rect(0, -2.5, 20, 2.5))!;
    expect(line).not.toBeNull();
    const [w, e] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(w[0]).toBeLessThan(e[0]);
    for (const [, lat] of line.coords) expect(Math.abs(lat)).toBeLessThan(0.05); // straight, through the middle
    expect(line.lengthKm).toBeGreaterThan(0.85 * 20 * KM);
    expect(line.lengthKm).toBeLessThan(20 * KM);
    expect(line.widthKm).toBeCloseTo(5 * KM, -1);
    expect(line.onBody).toHaveLength(line.coords.length);
    expect(line.onBody.every(Boolean)).toBe(true);
  });

  it('reads west to east whichever way round the rings are wound', () => {
    const cw: Polygon = { type: 'Polygon', coordinates: [[...rect(0, -2.5, 20, 2.5).coordinates[0]!].reverse()] };
    const line = nameArc(cw)!;
    expect(line.coords[0]![0]).toBeLessThan(line.coords[line.coords.length - 1]![0]);
  });

  it('turns with a tall polity (north–south)', () => {
    const line = nameArc(rect(10, 0, 13, 20))!;
    const [a, b] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(Math.abs(b[1] - a[1])).toBeGreaterThan(15);
    expect(Math.abs(b[0] - a[0])).toBeLessThan(0.5);
  });

  it('reads a roundish polity horizontally', () => {
    const line = nameArc(rect(0, 0, 10, 10))!;
    const [a, b] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(Math.abs(b[1] - a[1])).toBeLessThan(0.2);
    expect(b[0] - a[0]).toBeGreaterThan(8);
  });

  it('reads a thick U-shaped polity along a nearly straight line through its middle', () => {
    // China's profile: tall west and east, a lower middle (the band middles zig-zag).
    const u: Polygon = { type: 'Polygon', coordinates: [[[0, 4], [8, 4], [8, 0], [16, 0], [16, 4], [24, 4], [24, 14], [16, 14], [16, 10], [8, 10], [8, 14], [0, 14], [0, 4]]] };
    const c = nameArc(u)!.coords;
    const dir = (p: number[], q: number[]): number => Math.atan2(q[1]! - p[1]!, q[0]! - p[0]!);
    const turn = Math.abs(dir(c[c.length - 2]!, c[c.length - 1]!) - dir(c[0]!, c[1]!));
    expect((turn * 180) / Math.PI).toBeLessThanOrEqual(7);
    const mid = c[Math.floor(c.length / 2)]!;
    // Through the body's weighted middle (≈ 7.6°), not along the bottom of the U (≈ 6.3°,
    // where a clipped curve that kept its own offset would lie).
    expect(mid[1]).toBeGreaterThan(7);
    expect(mid[1]).toBeLessThan(10);
  });

  it('keeps a crescent on its land (a thin body keeps its curve and its offset)', () => {
    // A chunky half-ring, and a thin 60° crescent (rotated so it opens southward).
    const crescent: Polygon = { type: 'Polygon', coordinates: [[] as number[][]] };
    const outer: number[][] = [];
    const inner: number[][] = [];
    for (let i = 0; i <= 24; i++) {
      const a = (2 * Math.PI) / 3 - (Math.PI / 3) * (i / 24);
      outer.push([12 * Math.cos(a), 12 * Math.sin(a)]);
      inner.push([10 * Math.cos(a), 10 * Math.sin(a)]);
    }
    crescent.coordinates[0] = [...outer, ...inner.reverse(), outer[0]!];
    for (const shape of [arch(8, 12), crescent]) {
      const line = nameArc(shape)!;
      expect(line.onBody.slice(4, 20).filter(Boolean).length).toBeGreaterThanOrEqual(12);
    }
  });

  it('bends with a thin arched polity, at most 20° from end to end', () => {
    const line = nameArc(arch(10, 11))!;
    const c = line.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    const chordLat = (c[0]![1] + c[c.length - 1]![1]) / 2;
    expect(mid[1]).toBeGreaterThan(chordLat + 0.5); // the middle bows north, with the arch
    const dir = (p: number[], q: number[]): number => Math.atan2(q[1]! - p[1]!, q[0]! - p[0]!);
    const turn = Math.abs(dir(c[c.length - 2]!, c[c.length - 1]!) - dir(c[0]!, c[1]!));
    expect((turn * 180) / Math.PI).toBeLessThanOrEqual(21);
  });

  it('leaves a small far-off part out of the name arc', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(40, 0, 41, 1).coordinates, rect(0, -2, 20, 2).coordinates] };
    const line = nameArc(multi)!;
    for (const [lon] of line.coords) expect(lon).toBeLessThan(21);
  });

  it('spans nearby parts across the sea between them (one body)', () => {
    // Two coasts of one polity 1.5° apart (≈ 170 km, within a quarter of √area): the arc
    // crosses the gap and reaches into both.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 0, 10, 4).coordinates, rect(11.5, 0, 21.5, 4).coordinates] };
    const lons = nameArc(multi)!.coords.map(([lon]) => lon);
    expect(Math.min(...lons)).toBeLessThan(3);
    expect(Math.max(...lons)).toBeGreaterThan(18.5);
  });

  it('runs over the sea between coasts made of separate parts (the Eastern Roman Empire)', () => {
    // North and south coasts as two parts around an inner sea 2° (≈ 220 km) wide: the arc crosses the sea.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 5, 30, 8).coordinates, rect(0, 0, 30, 3).coordinates] };
    const c = nameArc(multi)!.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    expect(mid[1]).toBeGreaterThan(3);
    expect(mid[1]).toBeLessThan(5);
    expect(c[c.length - 1]![0] - c[0]![0]).toBeGreaterThan(20);
  });

  it('does not bridge a gap inside one part that is more than half as wide as the land on either side', () => {
    // One part around a 4°-wide hole between 3° of land: the arc keeps to one side.
    const ring: Polygon = { type: 'Polygon', coordinates: [rect(0, 0, 30, 10).coordinates[0]!, [...rect(3, 3, 27, 7).coordinates[0]!].reverse()] };
    const c = nameArc(ring)!.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    expect(mid[1] < 3 || mid[1] > 7).toBe(true);
  });

  it('bridges a narrow bay inside one part, unless the gap is other land', () => {
    // One part around a 1°-wide hole between 4.5° of land (a bay, a lake): bridged, so the
    // arc runs through the middle; marked as another polity's land (an enclave): not.
    const bay: Polygon = { type: 'Polygon', coordinates: [rect(0, 0, 30, 10).coordinates[0]!, [...rect(3, 4.5, 27, 5.5).coordinates[0]!].reverse()] };
    const midOf = (l: ReturnType<typeof nameArc>): number => l!.coords[Math.floor(l!.coords.length / 2)]![1];
    expect(midOf(nameArc(bay))).toBeGreaterThan(4);
    expect(midOf(nameArc(bay))).toBeLessThan(6);
    const enclave = (lon: number, lat: number): boolean => lon > 3 && lon < 27 && lat > 4.5 && lat < 5.5;
    const kept = midOf(nameArc(bay, enclave));
    expect(kept < 4.5 || kept > 5.5).toBe(true);
  });

  it('hops across open sea to the next island, but not across other land', () => {
    // Three islands in a zig-zag, the middle one shifted sideways past the others (no band
    // overlaps the next): with sea between them the arc spans all three; with the water
    // marked as other land it stays on one.
    const boxes: [number, number, number, number][] = [[0, 0, 16, 2], [17, 2.8, 33, 4.8], [34, 0, 50, 2]];
    const isles: MultiPolygon = { type: 'MultiPolygon', coordinates: boxes.map((b) => rect(...b).coordinates) };
    const span = (l: ReturnType<typeof nameArc>): number => l!.coords[l!.coords.length - 1]![0] - l!.coords[0]![0];
    expect(span(nameArc(isles, () => false))).toBeGreaterThan(30);
    const water = (lon: number, lat: number): boolean => !boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
    expect(span(nameArc(isles, water))).toBeLessThan(18);
  });

  it('does not bridge parts across land held by another polity', () => {
    // Two coasts 2° apart; with the land between them held by someone else, the arc keeps
    // to one coast; with sea between them it crosses.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 4, 20, 8).coordinates, rect(0, -2, 20, 2).coordinates] };
    const otherBetween = (_lon: number, lat: number): boolean => lat > 2 && lat < 4;
    const midOf = (l: ReturnType<typeof nameArc>): number => l!.coords[Math.floor(l!.coords.length / 2)]![1];
    const over = midOf(nameArc(multi));
    const kept = midOf(nameArc(multi, otherBetween));
    expect(over).toBeGreaterThan(1);
    expect(over).toBeLessThan(5);
    expect(kept < 2 || kept > 4).toBe(true);
  });

  it('marks which points of the arc lie on the polity', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 0, 10, 4).coordinates, rect(11.5, 0, 21.5, 4).coordinates] };
    const line = nameArc(multi)!;
    expect(line.onBody).toHaveLength(line.coords.length);
    expect(line.onBody.filter(Boolean).length).toBeGreaterThan(line.onBody.length * 0.7);
    expect(line.onBody.some((b) => !b)).toBe(true); // the strait between the parts
  });

  it('crosses a short narrow neck between two wide blocks, but not a long one', () => {
    // Two 8°-tall blocks joined by a 1°-tall neck: a 2°-long neck (2 scan lines) is crossed,
    // a 10°-long one (11 scan lines, like the arm of a horseshoe) ends the arc.
    const dumbbell = (x0: number, x1: number): Polygon => ({
      type: 'Polygon',
      coordinates: [[[0, 0], [x0, 0], [x0, 3.5], [x1, 3.5], [x1, 0], [30, 0], [30, 8], [x1, 8], [x1, 4.5], [x0, 4.5], [x0, 8], [0, 8], [0, 0]]],
    });
    const short = nameArc(dumbbell(14, 16))!.coords;
    expect(short[0]![0]).toBeLessThan(3);
    expect(short[short.length - 1]![0]).toBeGreaterThan(27);
    const long = nameArc(dumbbell(10, 20))!.coords;
    expect(long[long.length - 1]![0] - long[0]![0]).toBeLessThan(15);
  });

  it('gives up on degenerate shapes and never crosses the antimeridian', () => {
    expect(nameArc({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] })).toBeNull();
    expect(nameArc({ type: 'MultiPolygon', coordinates: [] })).toBeNull();
    const across = nameArc(rect(170, -2, 190, 2));
    if (across) for (const [lon] of across.coords) expect(Math.abs(lon)).toBeLessThanOrEqual(180);
  });
});

describe('otherLand', () => {
  const features = [
    { id: 1, tier: 0, geometry: rect(0, 0, 10, 10) },
    { id: 2, tier: 0, geometry: rect(10, 0, 20, 10) },
    // An overlay over both and beyond: tier 1, never counted as land.
    { id: 3, tier: 1, geometry: rect(0, 0, 40, 10) },
    // Two parts, one of them with a hole (a lake or an enclave of nobody's).
    {
      id: 4,
      tier: 0,
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [rect(50, -10, 60, 0).coordinates[0]!, [...rect(53, -7, 57, -3).coordinates[0]!].reverse()],
          rect(70, -10, 72, -8).coordinates,
        ],
      } as MultiPolygon,
    },
  ];
  const land = otherLand(features);

  it("says whether a point is on another feature's tier-0 land", () => {
    expect(land(1)(15, 5)).toBe(true); // feature 2's land
    expect(land(1)(5, 5)).toBe(false); // its own
    expect(land(2)(5, 5)).toBe(true);
    expect(land(2)(15, 5)).toBe(false);
    expect(land(1)(30, 5)).toBe(false); // only the overlay: not land
    expect(land(1)(30, 30)).toBe(false); // sea
  });

  it('treats id −1 as nobody: any tier-0 land counts', () => {
    const any = land(-1);
    expect(any(5, 5)).toBe(true);
    expect(any(15, 5)).toBe(true);
    expect(any(30, 5)).toBe(false);
    expect(any(-30, 5)).toBe(false);
  });

  it('honours holes and every part of a multipolygon', () => {
    const any = land(-1);
    expect(any(51, -1)).toBe(true);
    expect(any(55, -5)).toBe(false); // the hole
    expect(any(71, -9)).toBe(true); // the second part
    expect(land(4)(71, -9)).toBe(false);
  });

  it('finds land far from the grid cell of a polygon’s corner (large parts span many cells)', () => {
    const wide = otherLand([{ id: 9, tier: 0, geometry: rect(-100, -40, 100, 40) }]);
    for (const [lon, lat] of [[-99, -39], [0, 0], [99, 39], [57.3, -12.1]] as const) expect(wide(-1)(lon, lat)).toBe(true);
    expect(wide(-1)(101, 0)).toBe(false);
    expect(wide(-1)(0, 41)).toBe(false);
  });

  it('wraps longitudes into −180…180', () => {
    const east = otherLand([{ id: 1, tier: 0, geometry: rect(170, 0, 179, 10) }]);
    expect(east(-1)(-185, 5)).toBe(true); // = 175°E
    expect(east(-1)(535, 5)).toBe(true); // = 175°E
    expect(east(-1)(5, 5)).toBe(false);
  });

  it('ignores degenerate rings', () => {
    const none = otherLand([{ id: 1, tier: 0, geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] } }]);
    expect(none(-1)(0.2, 0.1)).toBe(false);
  });
});

describe('shortName', () => {
  it('drops a leading title, also after a dynasty name', () => {
    expect(shortName('Kingdom of Spain')).toBe('Spain');
    expect(shortName('Bourbon Kingdom of France')).toBe('France');
    expect(shortName('Empire of Japan')).toBe('Japan');
    expect(shortName('Kingdom of the Two Sicilies')).toBe('Two Sicilies');
    expect(shortName('Grand Duchy of Lithuania')).toBe('Lithuania');
    expect(shortName('United Kingdom of Great Britain and Ireland')).toBe('United Kingdom');
  });

  it('uses common map names for some long official names', () => {
    expect(shortName('United States of America')).toBe('United States');
    expect(shortName('German Empire')).toBe('Germany');
    expect(shortName('French Third Republic')).toBe('France');
    expect(shortName('Union of Soviet Socialist Republics')).toBe('Soviet Union');
    expect(shortName('Oriental Republic of Uruguay')).toBe('Uruguay');
    expect(shortName('Federated Republic of Mexico')).toBe('Mexico');
  });

  it('gives both Congos the same short form (map-names.ts then keeps their full names)', () => {
    expect(shortName('Republic of the Congo')).toBe('Congo');
    expect(shortName('Democratic Republic of the Congo')).toBe('Congo');
  });

  it('drops a trailing parenthetical note', () => {
    expect(shortName('Crimea (annexed by Russia; claimed by Ukraine)')).toBe('Crimea');
    expect(shortName('Kingdom of Spain (Bourbon restoration)')).toBe('Spain');
  });

  it('leaves other names alone', () => {
    for (const n of ['Ottoman Empire', 'Holy Roman Empire', 'Austria-Hungary', 'Persia', 'Kingdom of']) expect(shortName(n)).toBeNull();
  });
});

describe('nameArcs: separate territories', () => {
  const square = (w: number, s: number, size: number): number[][][] => [[[w, s], [w + size, s], [w + size, s + size], [w, s + size], [w, s]]];
  it('names a homeland and a distant colony each, largest first', () => {
    const empire: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(10, 5, 20), square(-5, 45, 6)] };
    const arcs = nameArcs(empire);
    expect(arcs).toHaveLength(2);
    expect(arcs[0]!.coords[12]![1]).toBeLessThan(30); // the large colony first
    expect(arcs[1]!.coords[12]![1]).toBeGreaterThan(45); // then the homeland
  });

  it('names the islands of an archipelago, or land within 2,000 km, once', () => {
    const archipelago: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(0, 0, 8), square(12, 0, 6), square(0, 12, 6)] };
    expect(nameArcs(archipelago)).toHaveLength(1);
  });

  it('leaves out territories smaller than 3 % of the largest part', () => {
    const tiny: MultiPolygon = { type: 'MultiPolygon', coordinates: [square(0, 0, 20), square(80, 0, 2)] };
    expect(nameArcs(tiny)).toHaveLength(1);
    expect(nameArcs(tiny, undefined, 1)).toHaveLength(1);
  });
});

describe('nameArcs: inner seas and trimmed ends', () => {
  it('runs a ring of land around an inner sea across the sea, not along one arm', () => {
    // A frame of land 3° wide around an inner sea 24° × 14° (a hole: water, not other land).
    const ring: Polygon = {
      type: 'Polygon',
      coordinates: [
        [[0, 0], [30, 0], [30, 20], [0, 20], [0, 0]],
        [[3, 3], [3, 17], [27, 17], [27, 3], [3, 3]],
      ],
    };
    const line = nameArcs(ring, () => false)[0]!;
    const mid = line.coords[Math.floor(line.coords.length / 2)]!;
    expect(mid[1]).toBeGreaterThan(6); // through the middle of the sea, not along an arm (≈ 1.5° or 18.5°)
    expect(mid[1]).toBeLessThan(14);
    expect(line.coords[line.coords.length - 1]![0] - line.coords[0]![0]).toBeGreaterThan(20);
  });

  it('trims an end where the arc leaves its band (a notch of sea at the east end)', () => {
    // A thick body with a notch of sea 4° deep in the middle of its east end: a straight
    // arc through the middle would run on over the notch.
    const notched: Polygon = {
      type: 'Polygon',
      coordinates: [[[0, 0], [20, 0], [20, 3], [16, 3], [16, 7], [20, 7], [20, 10], [0, 10], [0, 0]]],
    };
    const line = nameArc(notched)!;
    const east = Math.max(line.coords[0]![0], line.coords[line.coords.length - 1]![0]);
    expect(east).toBeLessThan(16.8); // untrimmed: ≈ 19.4
    // Its end may touch the notch; the name, centred on 80 % of the arc, does not reach it.
    expect(line.onBody.filter(Boolean).length).toBeGreaterThanOrEqual(22);
  });
});
