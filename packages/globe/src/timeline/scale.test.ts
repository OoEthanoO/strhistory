import { describe, expect, it } from 'vitest';
import {
  astroOf,
  createTimeScale,
  defaultStops,
  DEFAULT_PRESENT_YEAR,
  DEFAULT_STOPS,
  extendStops,
  yearsPerT,
} from './scale.js';

const MIN = -3400;
const MAX = 2026;

describe('DEFAULT_STOPS', () => {
  it('are the AGENTS.md §7.2 stops with present = 2026', () => {
    expect(DEFAULT_PRESENT_YEAR).toBe(2026);
    expect(DEFAULT_STOPS).toEqual([
      [-3400, 0],
      [-1200, 0.1],
      [-500, 0.16],
      [1, 0.22],
      [500, 0.3],
      [1000, 0.38],
      [1500, 0.5],
      [1800, 0.66],
      [1900, 0.8],
      [2026, 1],
    ]);
    expect(Object.isFrozen(DEFAULT_STOPS)).toBe(true);
    expect(Object.isFrozen(DEFAULT_STOPS[0])).toBe(true);
  });

  it('take a configurable present year', () => {
    expect(defaultStops(2030).at(-1)).toEqual([2030, 1]);
    expect(defaultStops().at(-1)).toEqual([2026, 1]);
    expect(() => defaultStops(1900)).toThrow(RangeError);
    expect(() => defaultStops(2026.5)).toThrow(RangeError);
  });
});

describe('createTimeScale with the default stops', () => {
  const scale = createTimeScale(DEFAULT_STOPS);

  it('passes through every stop', () => {
    for (const [y, t] of DEFAULT_STOPS) {
      expect(scale.toT(y)).toBeCloseTo(t, 12);
      expect(scale.toYear(t)).toBe(y);
    }
    expect(scale.domain).toEqual([MIN, MAX]);
    expect(scale.range).toEqual([0, 1]);
  });

  it('round-trips every year from 3400 BCE to 2026 exactly, skipping year 0', () => {
    const bad: number[] = [];
    let prev = -Infinity;
    let checked = 0;
    for (let y = MIN; y <= MAX; y++) {
      if (y === 0) continue;
      const t = scale.toT(y);
      if (!(t > prev)) bad.push(y); // strictly increasing
      prev = t;
      if (scale.toYear(t) !== y) bad.push(y);
      checked++;
    }
    expect(checked).toBe(5426);
    expect(bad).toEqual([]);
  });

  it('never returns year 0 (or a fractional or out-of-range year) for any t', () => {
    const N = 200_000;
    let prev = -Infinity;
    const bad: number[] = [];
    for (let i = 0; i <= N; i++) {
      const y = scale.toYear(i / N);
      if (y === 0 || !Number.isInteger(y) || y < MIN || y > MAX || y < prev) bad.push(i);
      prev = y;
    }
    expect(bad).toEqual([]);
    // The boundary between 1 BCE and 1 CE goes straight from −1 to 1.
    const mid = (scale.toT(-1) + scale.toT(1)) / 2;
    expect([scale.toYear(mid - 1e-9), scale.toYear(mid + 1e-9)]).toEqual([-1, 1]);
    expect(scale.toYear(mid)).not.toBe(0);
  });

  it('puts 1 BCE and 1 CE exactly one year apart', () => {
    // Both steps lie on the 500 BCE → 1 CE segment (1 CE is a stop).
    const oneYear = scale.toT(-1) - scale.toT(-2);
    expect(scale.toT(1) - scale.toT(-1)).toBeCloseTo(oneYear, 12);
    expect(oneYear).toBeCloseTo(0.06 / 500, 12);
  });

  it('clamps outside the stops', () => {
    expect(scale.toT(-5000)).toBe(0);
    expect(scale.toT(3000)).toBe(1);
    expect(scale.toT(-Infinity)).toBe(0);
    expect(scale.toT(Infinity)).toBe(1);
    expect(scale.toYear(-0.5)).toBe(MIN);
    expect(scale.toYear(1.5)).toBe(MAX);
    expect(scale.toYear(-Infinity)).toBe(MIN);
    expect(scale.toYear(Infinity)).toBe(MAX);
  });

  it('is continuous through the missing year 0 for fractional input', () => {
    expect(scale.toT(0)).toBeGreaterThan(scale.toT(-1));
    expect(scale.toT(0)).toBeLessThan(scale.toT(1));
    expect(scale.toT(-0.5)).toBeLessThan(scale.toT(0.5));
  });

  it('returns NaN for NaN', () => {
    expect(scale.toT(NaN)).toBeNaN();
    expect(scale.toYear(NaN)).toBeNaN();
  });
});

describe('createTimeScale validation', () => {
  const cases: [string, unknown][] = [
    ['fewer than two stops', [[1, 0]]],
    ['not an array', null],
    ['years not increasing', [[10, 0], [10, 1]]],
    ['years decreasing', [[10, 0], [5, 1]]],
    ['t not increasing', [[1, 0.5], [10, 0.5]]],
    ['t decreasing', [[1, 1], [10, 0]]],
    ['year 0', [[0, 0], [10, 1]]],
    ['fractional year', [[1.5, 0], [10, 1]]],
    ['NaN t', [[1, Number.NaN], [10, 1]]],
    ['infinite t', [[1, 0], [10, Infinity]]],
  ];
  it.each(cases)('rejects %s', (_name, stops) => {
    expect(() => createTimeScale(stops as [number, number][])).toThrow(RangeError);
  });
});

describe('custom stops', () => {
  it('a two-stop linear scale across BCE/CE round-trips and skips 0', () => {
    const s = createTimeScale([
      [-100, 0],
      [100, 1],
    ]);
    // 200 years without a year 0: 199 astronomical steps.
    expect(s.toT(-1)).toBeCloseTo(99 / 199, 12);
    expect(s.toT(1)).toBeCloseTo(100 / 199, 12);
    for (let y = -100; y <= 100; y++) if (y !== 0) expect(s.toYear(s.toT(y))).toBe(y);
  });

  it('accepts t outside 0..1 and any spacing', () => {
    const s = createTimeScale([
      [1700, -5],
      [1800, 10],
      [2000, 11],
    ]);
    expect(s.toT(1750)).toBeCloseTo(2.5, 12);
    expect(s.toYear(10.5)).toBe(1900);
  });
});

describe('extendStops', () => {
  it('continues the outer segments with their own slope', () => {
    const ext = extendStops(DEFAULT_STOPS, -5600, 2050);
    expect(ext[0]![0]).toBe(-5600);
    expect(ext.at(-1)![0]).toBe(2050);
    const s = createTimeScale(ext);
    const slopeStart = (DEFAULT_STOPS[1]![1] - DEFAULT_STOPS[0]![1]) / (astroOf(-1200) - astroOf(-3400));
    expect(s.toT(-5600)).toBeCloseTo(-2200 * slopeStart, 12);
    const slopeEnd = 0.2 / 126;
    expect(s.toT(2050)).toBeCloseTo(1 + 24 * slopeEnd, 12);
    for (let y = -5600; y <= 2050; y += 7) if (y !== 0) expect(s.toYear(s.toT(y))).toBe(y);
  });

  it('leaves stops alone when they already cover the range', () => {
    expect(extendStops(DEFAULT_STOPS, 1700, 1945)).toEqual(DEFAULT_STOPS.map((s) => [...s]));
  });
});

describe('yearsPerT', () => {
  const scale = createTimeScale(DEFAULT_STOPS);
  it('uses the segment entered in the direction of travel', () => {
    expect(yearsPerT(scale, 1500, 1)).toBeCloseTo(300 / 0.16, 9); // 1500 → 1800
    expect(yearsPerT(scale, 1500, -1)).toBeCloseTo(500 / 0.12, 9); // 1000 → 1500
    expect(yearsPerT(scale, -250, 1)).toBeCloseTo(500 / 0.06, 9); // 500 BCE → 1 CE: 500 astronomical years
    expect(yearsPerT(scale, MIN, -1)).toBeCloseTo(2200 / 0.1, 9); // outermost segment at the ends
    expect(yearsPerT(scale, MAX, 1)).toBeCloseTo(126 / 0.2, 9);
  });
});
