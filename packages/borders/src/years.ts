// Year helpers (AGENTS.md §5.1). Historical numbering has no year 0:
// −1 is 1 BCE, 1 is 1 CE, and stepping forward from −1 lands on 1.
// Astronomical numbering (used for arithmetic) has a year 0: 1 BCE = 0, 2 BCE = −1.

import type { HistYear } from './types.js';

/** True for non-zero safe integers (the only valid historical years). */
export function isValidYear(y: unknown): y is HistYear {
  return typeof y === 'number' && Number.isSafeInteger(y) && y !== 0;
}

/** Throws a RangeError unless `y` is a valid historical year. */
export function assertYear(y: unknown, what = 'year'): asserts y is HistYear {
  if (!isValidYear(y)) {
    throw new RangeError(
      `@alexs-atlas/borders: invalid ${what} ${String(y)} (years are non-zero integers: -1 = 1 BCE, 1 = 1 CE)`,
    );
  }
}

/** Historical → astronomical year (1 BCE → 0, 500 BCE → −499, 1453 → 1453). */
export function toAstronomical(y: HistYear): number {
  assertYear(y);
  return y < 0 ? y + 1 : y;
}

/** Astronomical → historical year (0 → −1 = 1 BCE). */
export function fromAstronomical(a: number): HistYear {
  if (!Number.isSafeInteger(a)) throw new RangeError(`@alexs-atlas/borders: invalid astronomical year ${String(a)}`);
  return a <= 0 ? a - 1 : a;
}

/** `y + n` years, skipping year 0 (addYears(−1, 1) = 1, addYears(1, −1) = −1). */
export function addYears(y: HistYear, n: number): HistYear {
  if (!Number.isSafeInteger(n)) throw new RangeError(`@alexs-atlas/borders: invalid year count ${String(n)}`);
  return fromAstronomical(toAstronomical(y) + n);
}

/**
 * The valid year nearest to `y` inside [min, max]: rounds to an integer, clamps, and
 * moves 0 (which does not exist) to 1, or to −1 when `y` was negative or 1 is above `max`.
 */
export function clampYear(y: number, min: HistYear, max: HistYear): HistYear {
  if (Number.isNaN(y)) throw new RangeError('@alexs-atlas/borders: cannot clamp NaN');
  if (!(min <= max)) throw new RangeError(`@alexs-atlas/borders: empty year range [${min}, ${max}]`);
  let r = Math.round(y);
  if (r < min) r = min;
  else if (r > max) r = max;
  if (r === 0) {
    const preferred = y < 0 ? -1 : 1;
    const other = -preferred;
    if (preferred >= min && preferred <= max) r = preferred;
    else if (other >= min && other <= max) r = other;
    else throw new RangeError(`@alexs-atlas/borders: no valid year in [${min}, ${max}]`);
  }
  return r;
}

export interface FormatYearOptions {
  /** Suffix for years before 1 CE: 'BCE' (default) or 'BC'. */
  era?: 'BCE' | 'BC';
  /** Also mark CE years: "33 CE" (era 'BCE') or "AD 33" (era 'BC'). Default false: "33". */
  ce?: boolean;
}

/** "500 BCE", "1 BCE", "1453" (or "1453 CE" / "AD 1453" with `ce: true`). */
export function formatYear(y: HistYear, o: FormatYearOptions = {}): string {
  assertYear(y);
  const era = o.era ?? 'BCE';
  if (y < 0) return `${-y} ${era}`;
  if (!o.ce) return String(y);
  return era === 'BC' ? `AD ${y}` : `${y} CE`;
}

// Hyphen-like characters people type or paste for a minus sign.
const MINUS = /[‐-―−﹘﹣－]/g;
// [sign] [era] digits [era]; digits may use comma thousands separators ("3,400").
const YEAR = /^([+-])?\s*(?:(bce|bc|ce|ad)\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(bce|bc|ce|ad)?$/;

/**
 * Parses a typed year: "1453", "-500", "500 BC", "500 BCE", "AD 33", "33 CE", "33 AD",
 * "500 B.C.", "3,400 BCE", "−500" (Unicode minus). Returns null for year 0, decimals,
 * contradictory input ("-500 BC", "AD 33 AD") and anything else.
 */
export function parseYear(input: string): HistYear | null {
  if (typeof input !== 'string') return null;
  const s = input
    .trim()
    .toLowerCase()
    .replace(MINUS, '-')
    .replace(/([a-z])\./g, '$1') // "b.c.e." → "bce"; digits keep their dots, so "1453.5" fails below
    .replace(/\s+/g, ' ');
  const m = YEAR.exec(s);
  if (!m) return null;
  const [, sign, eraBefore, digits = '', eraAfter] = m;
  if (eraBefore && eraAfter) return null;
  const era = eraBefore ?? eraAfter;
  if (sign && era) return null;
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isSafeInteger(n) || n === 0) return null;
  return sign === '-' || era === 'bc' || era === 'bce' ? -n : n;
}

/** MapLibre filter expression selecting features alive in `year` (plain arrays, no MapLibre import). */
export function yearFilter(year: HistYear): unknown[] {
  assertYear(year);
  return ['all', ['<=', ['get', 'from'], year], ['>=', ['get', 'to'], year]];
}
