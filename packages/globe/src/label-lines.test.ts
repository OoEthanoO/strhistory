import { describe, expect, it } from 'vitest';
import type { MultiPolygon, Polygon } from '@alexs-atlas/borders';
import { CURVED_LABELS, PX_PER_KM_Z0, extendLine, labelLine, labelPx, labelScale, labelSizing, labelSpacing, shortLabelName } from './label-lines.js';

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

describe('labelLine', () => {
  it('runs along the long axis of a wide polity, west to east, over most of its length', () => {
    const line = labelLine(rect(0, -2.5, 20, 2.5))!;
    expect(line).not.toBeNull();
    const [w, e] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(w[0]).toBeLessThan(e[0]);
    for (const [, lat] of line.coords) expect(Math.abs(lat)).toBeLessThan(0.05); // straight, through the middle
    expect(line.lengthKm).toBeGreaterThan(0.85 * 20 * KM);
    expect(line.lengthKm).toBeLessThan(20 * KM);
    expect(line.widthKm).toBeCloseTo(5 * KM, -1);
  });

  it('turns with a tall polity (north–south)', () => {
    const line = labelLine(rect(10, 0, 13, 20))!;
    const [a, b] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(Math.abs(b[1] - a[1])).toBeGreaterThan(15);
    expect(Math.abs(b[0] - a[0])).toBeLessThan(0.5);
  });

  it('reads a roundish polity horizontally', () => {
    const line = labelLine(rect(0, 0, 10, 10))!;
    const [a, b] = [line.coords[0]!, line.coords[line.coords.length - 1]!];
    expect(Math.abs(b[1] - a[1])).toBeLessThan(0.2);
    expect(b[0] - a[0]).toBeGreaterThan(8);
  });

  it('reads a thick U-shaped polity along a nearly straight line through its middle', () => {
    // China's profile: tall west and east, a lower middle (the band middles zig-zag).
    const u: Polygon = { type: 'Polygon', coordinates: [[[0, 4], [8, 4], [8, 0], [16, 0], [16, 4], [24, 4], [24, 14], [16, 14], [16, 10], [8, 10], [8, 14], [0, 14], [0, 4]]] };
    const c = labelLine(u)!.coords;
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
      const line = labelLine(shape)!;
      expect(line.onBody.slice(4, 20).filter(Boolean).length).toBeGreaterThanOrEqual(12);
    }
  });

  it('bends with a thin arched polity, at most 20° from end to end', () => {
    const line = labelLine(arch(10, 11))!;
    const c = line.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    const chordLat = (c[0]![1] + c[c.length - 1]![1]) / 2;
    expect(mid[1]).toBeGreaterThan(chordLat + 0.5); // the middle bows north, with the arch
    const dir = (p: number[], q: number[]): number => Math.atan2(q[1]! - p[1]!, q[0]! - p[0]!);
    const turn = Math.abs(dir(c[c.length - 2]!, c[c.length - 1]!) - dir(c[0]!, c[1]!));
    expect((turn * 180) / Math.PI).toBeLessThanOrEqual(21);
  });

  it('leaves a small far-off part out of the label shape', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(40, 0, 41, 1).coordinates, rect(0, -2, 20, 2).coordinates] };
    const line = labelLine(multi)!;
    for (const [lon] of line.coords) expect(lon).toBeLessThan(21);
  });

  it('spans nearby parts across the sea between them (one body)', () => {
    // Two coasts of one polity 1.5° apart (≈ 170 km, within a quarter of √area): the arc
    // crosses the gap and reaches into both.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 0, 10, 4).coordinates, rect(11.5, 0, 21.5, 4).coordinates] };
    const lons = labelLine(multi)!.coords.map(([lon]) => lon);
    expect(Math.min(...lons)).toBeLessThan(3);
    expect(Math.max(...lons)).toBeGreaterThan(18.5);
  });

  it('runs over the sea between coasts made of separate parts (the Eastern Roman Empire)', () => {
    // North and south coasts as two parts around an inner sea 2° (≈ 220 km) wide: the arc crosses the sea.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 5, 30, 8).coordinates, rect(0, 0, 30, 3).coordinates] };
    const c = labelLine(multi)!.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    expect(mid[1]).toBeGreaterThan(3);
    expect(mid[1]).toBeLessThan(5);
    expect(c[c.length - 1]![0] - c[0]![0]).toBeGreaterThan(20);
  });

  it('does not bridge a gap inside one part that is more than half as wide as the land on either side', () => {
    // One part around a 4°-wide hole between 3° of land: the arc keeps to one side.
    const ring: Polygon = { type: 'Polygon', coordinates: [rect(0, 0, 30, 10).coordinates[0]!, [...rect(3, 3, 27, 7).coordinates[0]!].reverse()] };
    const c = labelLine(ring)!.coords;
    const mid = c[Math.floor(c.length / 2)]!;
    expect(mid[1] < 3 || mid[1] > 7).toBe(true);
  });

  it('bridges a narrow bay inside one part, unless the gap is other land', () => {
    // One part around a 1°-wide hole between 4.5° of land (a bay, a lake): bridged, so the
    // arc runs through the middle; marked as another polity's land (an enclave): not.
    const bay: Polygon = { type: 'Polygon', coordinates: [rect(0, 0, 30, 10).coordinates[0]!, [...rect(3, 4.5, 27, 5.5).coordinates[0]!].reverse()] };
    const midOf = (l: ReturnType<typeof labelLine>): number => l!.coords[Math.floor(l!.coords.length / 2)]![1];
    expect(midOf(labelLine(bay))).toBeGreaterThan(4);
    expect(midOf(labelLine(bay))).toBeLessThan(6);
    const enclave = (lon: number, lat: number): boolean => lon > 3 && lon < 27 && lat > 4.5 && lat < 5.5;
    const kept = midOf(labelLine(bay, enclave));
    expect(kept < 4.5 || kept > 5.5).toBe(true);
  });

  it('hops across open sea to the next island, but not across other land', () => {
    // Three islands in a zig-zag, the middle one shifted sideways past the others (no band
    // overlaps the next): with sea between them the arc spans all three; with the water
    // marked as other land it stays on one.
    const boxes: [number, number, number, number][] = [[0, 0, 16, 2], [17, 2.8, 33, 4.8], [34, 0, 50, 2]];
    const isles: MultiPolygon = { type: 'MultiPolygon', coordinates: boxes.map((b) => rect(...b).coordinates) };
    const span = (l: ReturnType<typeof labelLine>): number => l!.coords[l!.coords.length - 1]![0] - l!.coords[0]![0];
    expect(span(labelLine(isles, () => false))).toBeGreaterThan(30);
    const water = (lon: number, lat: number): boolean => !boxes.some(([w, s, e, n]) => lon >= w && lon <= e && lat >= s && lat <= n);
    expect(span(labelLine(isles, water))).toBeLessThan(18);
  });

  it('does not bridge parts across land held by another polity', () => {
    // Two coasts 2° apart; with the land between them held by someone else, the arc keeps
    // to one coast; with sea between them it crosses.
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 4, 20, 8).coordinates, rect(0, -2, 20, 2).coordinates] };
    const otherBetween = (_lon: number, lat: number): boolean => lat > 2 && lat < 4;
    const midOf = (l: ReturnType<typeof labelLine>): number => l!.coords[Math.floor(l!.coords.length / 2)]![1];
    const over = midOf(labelLine(multi));
    const kept = midOf(labelLine(multi, otherBetween));
    expect(over).toBeGreaterThan(1);
    expect(over).toBeLessThan(5);
    expect(kept < 2 || kept > 4).toBe(true);
  });

  it('marks which points of the arc lie on the polity', () => {
    const multi: MultiPolygon = { type: 'MultiPolygon', coordinates: [rect(0, 0, 10, 4).coordinates, rect(11.5, 0, 21.5, 4).coordinates] };
    const line = labelLine(multi)!;
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
    const short = labelLine(dumbbell(14, 16))!.coords;
    expect(short[0]![0]).toBeLessThan(3);
    expect(short[short.length - 1]![0]).toBeGreaterThan(27);
    const long = labelLine(dumbbell(10, 20))!.coords;
    expect(long[long.length - 1]![0] - long[0]![0]).toBeLessThan(15);
  });

  it('gives up on degenerate shapes and never crosses the antimeridian', () => {
    expect(labelLine({ type: 'Polygon', coordinates: [[[0, 0], [1, 0], [0, 0]]] })).toBeNull();
    const across = labelLine(rect(170, -2, 190, 2));
    if (across) for (const [lon] of across.coords) expect(Math.abs(lon)).toBeLessThanOrEqual(180);
  });
});

describe('label sizing', () => {
  it('fits a name to its arc, bounded by the polity width', () => {
    const s = labelSizing('France', { lengthKm: 900, widthKm: 800 })!;
    expect(s.sizeKm).toBeCloseTo((CURVED_LABELS.span * 900) / (6 * CURVED_LABELS.capAdvance), 6);
    const thin = labelSizing('Chile', { lengthKm: 3000, widthKm: 150 })!;
    expect(thin.sizeKm).toBeCloseTo(CURVED_LABELS.heightShare * 150, 6);
    expect(labelSizing('', { lengthKm: 900, widthKm: 800 })).toBeNull();
  });

  it('grows with the map up to fitZoom, more slowly beyond, capped at maxPx', () => {
    const z = CURVED_LABELS.fitZoom;
    expect(labelScale(z) / labelScale(z - 1)).toBeCloseTo(2, 6);
    expect(labelScale(z + 1) / labelScale(z)).toBeCloseTo(2 ** CURVED_LABELS.growth, 6);
    expect(labelScale(0)).toBeCloseTo(PX_PER_KM_Z0, 9);
    expect(labelPx(10_000, 7)).toBe(CURVED_LABELS.maxPx);
    const s = labelSizing('Persia', { lengthKm: 1500, widthKm: 900 })!;
    expect(labelPx(s.sizeKm, s.minZoom)).toBeGreaterThanOrEqual(CURVED_LABELS.minPx);
    if (s.minZoom > 0) expect(labelPx(s.sizeKm, s.minZoom - 1)).toBeLessThan(CURVED_LABELS.minPx);
  });

  it('spreads letters to span the arc, within 0..maxSpacing em', () => {
    // 6 letters at 20 px over 160 px: (160/20 − 6·capAdvance) / 5
    expect(labelSpacing(6, 20, 160)).toBeCloseTo((8 - 6 * CURVED_LABELS.capAdvance) / 5, 9);
    expect(labelSpacing(6, 20, 40)).toBe(0);
    expect(labelSpacing(6, 20, 10_000)).toBe(CURVED_LABELS.maxSpacing);
    expect(labelSpacing(1, 20, 160)).toBe(0);
  });

  it('spreads small type less, so its letters still read as a word', () => {
    const T = CURVED_LABELS;
    expect(labelSpacing(6, T.minPx, 10_000)).toBeCloseTo(0.15 * T.maxSpacing, 9);
    expect(labelSpacing(6, T.spacingFullPx, 10_000)).toBe(T.maxSpacing);
    expect(labelSpacing(6, (T.minPx + T.spacingFullPx) / 2, 10_000)).toBeCloseTo(0.5 * T.maxSpacing, 9);
  });
});

describe('extendLine', () => {
  // Lengths in Web Mercator (degrees of longitude at the equator), as MapLibre measures lines.
  const y = (lat: number): number => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  const merc = (a: [number, number], b: [number, number]): number => Math.hypot(b[0] - a[0], y(b[1]) - y(a[1]));
  const length = (c: [number, number][]): number => c.slice(1).reduce((s, p, i) => s + merc(c[i]!, p), 0);

  it('adds equally long straight lead-ins along the end tangents, keeping the arc and its middle', () => {
    const arc: [number, number][] = [[0, 40], [5, 43], [10, 45], [15, 46], [20, 46.5]];
    const out = extendLine(arc, 0.5)!;
    expect(out.slice(1, -1)).toEqual(arc);
    expect(length(out) / length(arc)).toBeCloseTo(2, 6);
    expect(merc(out[0]!, arc[0]!)).toBeCloseTo(merc(out[out.length - 1]!, arc[arc.length - 1]!), 6);
    // Along the end tangents: the head lies west and south of the first point, the tail east of the last.
    expect(out[0]![0]).toBeLessThan(0);
    expect(out[0]![1]).toBeLessThan(40);
    expect(out[out.length - 1]![0]).toBeGreaterThan(20);
  });

  it('returns null when a lead-in would leave lon/lat range, the arc itself for no extra', () => {
    expect(extendLine([[170, 0], [179, 0]], 0.5)).toBeNull();
    expect(extendLine([[0, 80], [0, 84]], 0.5)).toBeNull();
    expect(extendLine([[0, 0], [1, 0]], 0)).toEqual([[0, 0], [1, 0]]);
  });
});

describe('shortLabelName', () => {
  it('drops a leading title, also after a dynasty name', () => {
    expect(shortLabelName('Kingdom of Spain')).toBe('Spain');
    expect(shortLabelName('Bourbon Kingdom of France')).toBe('France');
    expect(shortLabelName('Empire of Japan')).toBe('Japan');
    expect(shortLabelName('Kingdom of the Two Sicilies')).toBe('Two Sicilies');
    expect(shortLabelName('Grand Duchy of Lithuania')).toBe('Lithuania');
    expect(shortLabelName('United Kingdom of Great Britain and Ireland')).toBe('United Kingdom');
  });

  it('uses common map names for some long official names', () => {
    expect(shortLabelName('United States of America')).toBe('United States');
    expect(shortLabelName('German Empire')).toBe('Germany');
    expect(shortLabelName('French Third Republic')).toBe('France');
    expect(shortLabelName('Union of Soviet Socialist Republics')).toBe('Soviet Union');
    expect(shortLabelName('Oriental Republic of Uruguay')).toBe('Uruguay');
    expect(shortLabelName('Federated Republic of Mexico')).toBe('Mexico');
  });

  it('drops a trailing parenthetical note', () => {
    expect(shortLabelName('Crimea (annexed by Russia; claimed by Ukraine)')).toBe('Crimea');
    expect(shortLabelName('Kingdom of Spain (Bourbon restoration)')).toBe('Spain');
  });

  it('leaves other names alone', () => {
    for (const n of ['Ottoman Empire', 'Holy Roman Empire', 'Austria-Hungary', 'Persia', 'Kingdom of']) expect(shortLabelName(n)).toBeNull();
  });
});
