import { describe, expect, it } from 'vitest';
import { createTimeScale, DEFAULT_STOPS } from './scale.js';
import { adaptiveStep, gridStep, nextChange, niceStep, normalizeFrames, prevChange, STEP_SIZES } from './steps.js';

const MIN = -3400;
const MAX = 2026;

describe('niceStep', () => {
  it.each([
    [0.3, 1],
    [1, 1],
    [6.3, 5],
    [7.14, 10],
    [18.75, 20],
    [41.7, 50],
    [62.5, 50],
    [83.3, 100],
    [116.7, 100],
    [220, 200],
    [5000, 200],
    [0, 1],
    [-4, 1],
    [Number.NaN, 1],
  ])('%f years → %i', (years, step) => {
    expect(niceStep(years)).toBe(step);
  });

  it('only returns the documented sizes', () => {
    expect(STEP_SIZES).toEqual([1, 5, 10, 20, 50, 100, 200]);
  });
});

describe('adaptiveStep (≈1 % of the track)', () => {
  const scale = createTimeScale(DEFAULT_STOPS);
  it.each([
    [2000, 1, 5],
    [1950, -1, 5],
    [1850, 1, 10],
    [1600, 1, 20],
    [1200, 1, 50],
    [750, -1, 50],
    [250, 1, 50],
    [-250, 1, 100],
    [-800, -1, 100],
    [-2000, 1, 200],
    [1500, 1, 20], // entering 1500–1800
    [1500, -1, 50], // entering 1000–1500
    [1900, 1, 5],
    [1900, -1, 10],
  ] as const)('at %i going %i: %i years', (year, dir, step) => {
    expect(adaptiveStep(scale, year, dir, 1)).toBe(step);
  });

  it('scales with the visible t span (a track showing fewer years takes smaller steps)', () => {
    // 1 % of a track showing only 1900–2026 is 1.26 years.
    const tSpan = scale.toT(2026) - scale.toT(1900);
    expect(adaptiveStep(scale, 1950, 1, tSpan)).toBe(1);
    // 1 % of a 1700–2026 track at 1950 is 2.5 years → 5 on the log scale.
    expect(adaptiveStep(scale, 1950, 1, scale.toT(2026) - scale.toT(1700))).toBe(5);
  });
});

describe('gridStep', () => {
  it.each([
    [1453, 50, 1, 1500],
    [1453, 50, -1, 1450],
    [1500, 50, 1, 1550],
    [1500, 50, -1, 1450],
    [-450, 100, -1, -500],
    [-450, 100, 1, -400],
    [-100, 100, 1, 1], // grid point 0 is 1 CE
    [-50, 100, 1, 1],
    [100, 100, -1, 1],
    [50, 100, -1, 1],
    [1, 100, -1, -100],
    [1, 100, 1, 100],
    [-1, 100, 1, 1],
    [-1, 100, -1, -100],
    [2, 5, -1, 1],
    [-1, 1, 1, 1], // step 1 skips year 0
    [1, 1, -1, -1],
    [5, 1, 1, 6],
    [2024, 5, 1, 2025],
    [2025, 5, 1, MAX], // clamped
    [-3390, 200, -1, MIN],
    [MIN, 200, -1, MIN],
  ] as const)('%i by %i in direction %i → %i', (year, step, dir, expected) => {
    expect(gridStep(year, step, dir, MIN, MAX)).toBe(expected);
  });

  it('never lands on year 0 and always moves the right way', () => {
    const bad: string[] = [];
    for (const step of STEP_SIZES) {
      for (let y = MIN; y <= MAX; y++) {
        if (y === 0) continue;
        for (const dir of [1, -1] as const) {
          const n = gridStep(y, step, dir, MIN, MAX);
          const atEnd = (dir > 0 && y === MAX) || (dir < 0 && y === MIN);
          if (n === 0 || (!atEnd && (dir > 0 ? n <= y : n >= y))) bad.push(`${y}/${step}/${dir}→${n}`);
          if (step > 1 && n !== MIN && n !== MAX && n !== 1 && n % step !== 0) bad.push(`${y}/${step}/${dir}→${n} off grid`);
        }
      }
    }
    expect(bad.slice(0, 10)).toEqual([]);
  });
});

describe('frames', () => {
  it('normalizeFrames sorts, de-duplicates and drops invalid years', () => {
    expect(normalizeFrames([1900, -500, 0, 1900, 1.5, 3000, -5000, 1], MIN, MAX)).toEqual([-500, 1, 1900]);
    expect(normalizeFrames(null, MIN, MAX)).toEqual([]);
    expect(normalizeFrames(undefined, MIN, MAX)).toEqual([]);
  });

  const frames = [-500, 1, 1453, 1900];
  it.each([
    [1453, 1, 1900],
    [1460, 1453, 1900],
    [-500, null, 1],
    [-1000, null, -500],
    [1900, 1453, null],
    [2000, 1900, null],
    [-1, -500, 1],
  ] as const)('around %i: previous %s, next %s', (year, prev, next) => {
    expect(prevChange(frames, year)).toBe(prev);
    expect(nextChange(frames, year)).toBe(next);
  });

  it('handles an empty list', () => {
    expect(prevChange([], 1)).toBeNull();
    expect(nextChange([], 1)).toBeNull();
  });
});
