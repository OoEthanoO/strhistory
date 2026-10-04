import { describe, expect, it } from 'vitest';
import {
  addYears,
  clampYear,
  formatYear,
  fromAstronomical,
  isValidYear,
  parseYear,
  toAstronomical,
  yearFilter,
} from './index.js';

describe('isValidYear', () => {
  it.each([1, -1, 1453, -3400, 2026, Number.MAX_SAFE_INTEGER])('accepts %s', (y) => {
    expect(isValidYear(y)).toBe(true);
  });
  it.each([0, -0, 1.5, Number.NaN, Infinity, -Infinity, 2 ** 53, '1453', null, undefined])('rejects %s', (y) => {
    expect(isValidYear(y)).toBe(false);
  });
});

describe('astronomical numbering', () => {
  it.each([
    [1, 1],
    [-1, 0],
    [-2, -1],
    [-500, -499],
    [1453, 1453],
  ])('toAstronomical(%i) = %i and back', (hist, astro) => {
    expect(toAstronomical(hist)).toBe(astro);
    expect(fromAstronomical(astro)).toBe(hist);
  });
  it('rejects year 0 and non-integers', () => {
    expect(() => toAstronomical(0)).toThrow(RangeError);
    expect(() => toAstronomical(1.5)).toThrow(RangeError);
    expect(() => fromAstronomical(0.5)).toThrow(RangeError);
  });
});

describe('addYears skips year 0', () => {
  it.each([
    [-1, 1, 1],
    [1, -1, -1],
    [-5, 10, 6],
    [5, -10, -6],
    [-1, 0, -1],
    [1453, 1, 1454],
    [-3400, 3400, 1],
    [2026, -2026, -1],
  ])('addYears(%i, %i) = %i', (y, n, expected) => {
    expect(addYears(y, n)).toBe(expected);
  });
  it('never returns 0 when stepping one year at a time', () => {
    let y = -3;
    const seen: number[] = [];
    for (let i = 0; i < 6; i++) seen.push((y = addYears(y, 1)));
    expect(seen).toEqual([-2, -1, 1, 2, 3, 4]);
  });
  it('rejects invalid input', () => {
    expect(() => addYears(0, 1)).toThrow(RangeError);
    expect(() => addYears(1, 0.5)).toThrow(RangeError);
  });
});

describe('clampYear', () => {
  it.each([
    [1453, -3400, 2026, 1453],
    [-5000, -3400, 2026, -3400],
    [3000, -3400, 2026, 2026],
    [1453.4, -3400, 2026, 1453],
    [-Infinity, -3400, 2026, -3400],
    [0, -3400, 2026, 1],
    [-0.4, -3400, 2026, -1],
    [0, -100, -1, -1],
    [0, 1, 100, 1],
  ])('clampYear(%s, %i, %i) = %i', (y, min, max, expected) => {
    expect(clampYear(y, min, max)).toBe(expected);
  });
  it('rejects NaN and empty ranges', () => {
    expect(() => clampYear(Number.NaN, 1, 10)).toThrow(RangeError);
    expect(() => clampYear(5, 10, 1)).toThrow(RangeError);
  });
});

describe('formatYear', () => {
  it.each([
    [-500, {}, '500 BCE'],
    [-1, {}, '1 BCE'],
    [1, {}, '1'],
    [1453, {}, '1453'],
    [-3400, { era: 'BC' as const }, '3400 BC'],
    [33, { ce: true }, '33 CE'],
    [33, { era: 'BC' as const, ce: true }, 'AD 33'],
    [-33, { ce: true }, '33 BCE'],
  ])('formatYear(%i, %o) = %s', (y, o, expected) => {
    expect(formatYear(y, o)).toBe(expected);
  });
  it('rejects year 0', () => {
    expect(() => formatYear(0)).toThrow(RangeError);
  });
  it('round-trips through parseYear', () => {
    for (const y of [-3400, -500, -1, 1, 33, 1453, 2026]) {
      expect(parseYear(formatYear(y))).toBe(y);
      expect(parseYear(formatYear(y, { era: 'BC', ce: true }))).toBe(y);
    }
  });
});

describe('parseYear', () => {
  it.each([
    ['1453', 1453],
    ['-500', -500],
    ['500 BC', -500],
    ['500 BCE', -500],
    ['AD 33', 33],
    ['33 CE', 33],
    ['33 AD', 33],
    ['  1453  ', 1453],
    ['500bc', -500],
    ['500 b.c.', -500],
    ['500 B.C.E.', -500],
    ['A.D. 33', 33],
    ['ad33', 33],
    ['−500', -500], // Unicode minus sign
    ['–500', -500], // en dash
    ['- 500', -500],
    ['+1453', 1453],
    ['3,400 BCE', -3400],
    ['1,000,000', 1000000],
    ['1 BC', -1],
    ['1 AD', 1],
    ['007', 7],
  ])('parses %j as %i', (input, expected) => {
    expect(parseYear(input)).toBe(expected);
  });

  it.each([
    '0',
    '-0',
    '0 BC',
    'AD 0',
    '',
    '   ',
    'abc',
    'BC',
    '1453.5',
    '1453.',
    '12e3',
    '0x10',
    '-500 BC',
    '+33 AD',
    'AD 33 AD',
    '500 BC AD',
    '1,45',
    '1,4530',
    '--5',
    '5-',
    'c. 500 BC',
    '500 – 400 BC',
    '99999999999999999999',
    'Infinity',
  ])('rejects %j', (input) => {
    expect(parseYear(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseYear(1453 as unknown as string)).toBeNull();
    expect(parseYear(undefined as unknown as string)).toBeNull();
  });
});

describe('yearFilter', () => {
  it('builds a plain-array MapLibre filter', () => {
    expect(yearFilter(-500)).toEqual(['all', ['<=', ['get', 'from'], -500], ['>=', ['get', 'to'], -500]]);
  });
  it('rejects year 0', () => {
    expect(() => yearFilter(0)).toThrow(RangeError);
  });
});
