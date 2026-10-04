import { describe, expect, it } from 'vitest';
import { createTimeScale, DEFAULT_STOPS } from './scale.js';
import { layoutMajorTicks, layoutMinorTicks, type MajorTick } from './ticks.js';

const MIN = -3400;
const MAX = 2026;
const scale = createTimeScale(DEFAULT_STOPS);
const STOP_YEARS = DEFAULT_STOPS.map((s) => s[0]);

// Same label text and width estimate as the component ("3000 BCE", "500 CE", "1453").
const text = (y: number): string => (y < 0 ? `${-y} BCE` : y < 1000 ? `${y} CE` : String(y));
const labelWidth = (y: number): number => {
  const m = /^(.*?)\s+(BCE|CE)$/.exec(text(y));
  const num = m ? m[1]! : text(y);
  return Math.ceil(num.length * 6.6 + (m ? 2.5 + m[2]!.length * 6.1 : 0));
};

function majors(width: number, overhang = 18): MajorTick[] {
  return layoutMajorTicks({
    min: MIN,
    max: MAX,
    width,
    xOf: (y) => scale.toT(y) * width,
    labelWidth,
    anchors: STOP_YEARS,
    minSpacing: 56,
    gap: 6,
    overhang,
  });
}

const WIDTHS = [280, 320, 343, 400, 560, 640, 768, 984, 1024, 1240, 1400, 1880, 2520];

describe('layoutMajorTicks', () => {
  it.each(WIDTHS)('at %i px: labels stay ≥ 56 px apart, inside the track and never on year 0', (width) => {
    const ticks = majors(width);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (let i = 0; i < ticks.length; i++) {
      const t = ticks[i]!;
      expect(t.year).not.toBe(0);
      expect(Number.isInteger(t.year)).toBe(true);
      expect(t.year).toBeGreaterThanOrEqual(MIN);
      expect(t.year).toBeLessThanOrEqual(MAX);
      expect(t.x).toBeCloseTo(scale.toT(t.year) * width, 9);
      expect(t.x - t.width / 2).toBeGreaterThanOrEqual(-18);
      expect(t.x + t.width / 2).toBeLessThanOrEqual(width + 18);
      const prev = ticks[i - 1];
      if (prev) {
        expect(t.year).toBeGreaterThan(prev.year);
        expect(t.x - prev.x).toBeGreaterThanOrEqual(56);
        expect(t.x - prev.x).toBeGreaterThanOrEqual((t.width + prev.width) / 2 + 6);
      }
    }
  });

  it('labels round years: millennia and 1 CE first, then the scale stops, then regular steps', () => {
    const years = majors(1240).map((t) => t.year);
    expect(years).toEqual([-3000, -2000, -1000, 1, 500, 1000, 1250, 1500, 1600, 1700, 1800, 1850, 1900, 1950, 2000]);
    expect(majors(560).map((t) => t.year)).toEqual([-1000, 1, 1000, 1500, 1800, 1900, 2000]);
  });

  it('drops lower-priority labels first when the track narrows', () => {
    const phone = majors(343).map((t) => t.year);
    // Only millennia and round stops survive on a phone.
    for (const y of phone) expect(y % 1000 === 0 || STOP_YEARS.includes(y)).toBe(true);
    expect(phone).toContain(1000);
    expect(phone).toContain(2000);
    // Wider tracks keep every label of a narrower one that is a millennium.
    const wide = new Set(majors(1240).map((t) => t.year));
    for (const y of phone) if (y % 1000 === 0) expect(wide.has(y)).toBe(true);
  });

  it('shows more labels as the track widens', () => {
    let prev = 0;
    for (const w of WIDTHS) {
      const n = majors(w).length;
      expect(n).toBeGreaterThanOrEqual(prev);
      prev = n;
    }
    expect(majors(2520).length).toBeGreaterThan(25);
  });

  it('keeps labels inside a gap evenly spaced in years', () => {
    // Between the 1500 and 1800 stops the scale is linear: 1600 and 1700, not a lone 1650.
    const years = majors(1240).map((t) => t.year);
    expect(years.filter((y) => y > 1500 && y < 1800)).toEqual([1600, 1700]);
    const wide = majors(2520).map((t) => t.year);
    expect(wide.filter((y) => y > 1000 && y < 1500)).toEqual([1100, 1200, 1300, 1400]);
  });

  it('does not squeeze a lone off-grid label into a gap', () => {
    // Every label sits on a round step: 1 CE, or a multiple of 10 or 25 years.
    for (const w of WIDTHS) {
      for (const t of majors(w)) expect(t.year === 1 || t.year % 10 === 0 || t.year % 25 === 0).toBe(true);
    }
    // Regression: at 560 px a lone "3100 BCE" used to sit against the left edge.
    expect(majors(560)[0]!.year).toBe(-1000);
    // …and "1125" / "1375" between 1000, 1250 and 1500 on wide tracks.
    expect(majors(1880).map((t) => t.year).filter((y) => y > 1000 && y < 1500)).toEqual([1250]);
  });

  it('works for a linear custom range, labelling the finest step that fits', () => {
    const s = createTimeScale([
      [1700, 0],
      [2026, 1],
    ]);
    const ticks = layoutMajorTicks({
      min: 1700,
      max: 2026,
      width: 800,
      xOf: (y) => s.toT(y) * 800,
      labelWidth,
      minSpacing: 56,
      overhang: 18,
    });
    const years = ticks.map((t) => t.year);
    // 2.45 px per year: 25-year steps are 61 px apart, 10-year steps would be 25 px.
    expect(years).toEqual(Array.from({ length: 14 }, (_, i) => 1700 + 25 * i));
  });

  it('returns nothing for an unmeasured (0 px) track', () => {
    expect(majors(0)).toEqual([]);
  });
});

describe('layoutMinorTicks', () => {
  const width = 1240;
  const xOf = (y: number): number => scale.toT(y) * width;
  const major = new Set(majors(width).map((t) => t.year));
  const minor = layoutMinorTicks({ min: MIN, max: MAX, breaks: STOP_YEARS, xOf, minSpacing: 7, exclude: major });

  it('are sorted, in range, never year 0 and never on a labelled year', () => {
    expect(minor.length).toBeGreaterThan(50);
    for (let i = 0; i < minor.length; i++) {
      const y = minor[i]!;
      expect(y).not.toBe(0);
      expect(y).toBeGreaterThanOrEqual(MIN);
      expect(y).toBeLessThanOrEqual(MAX);
      expect(major.has(y)).toBe(false);
      if (i > 0) expect(y).toBeGreaterThan(minor[i - 1]!);
    }
  });

  it('keep at least 7 px between neighbours inside each linear segment', () => {
    for (let s = 0; s < STOP_YEARS.length - 1; s++) {
      const a = STOP_YEARS[s]!;
      const b = STOP_YEARS[s + 1]!;
      const inSeg = minor.filter((y) => y >= a && y < b);
      for (let i = 1; i < inSeg.length; i++) expect(xOf(inSeg[i]!) - xOf(inSeg[i - 1]!)).toBeGreaterThanOrEqual(6.99);
    }
  });

  it('keep at least 7 px between all neighbours, across segment breaks too, and from labelled years', () => {
    for (let i = 1; i < minor.length; i++) expect(xOf(minor[i]!) - xOf(minor[i - 1]!)).toBeGreaterThanOrEqual(6.99);
    const labelledX = [...major].map(xOf);
    for (const y of minor) for (const lx of labelledX) expect(Math.abs(xOf(y) - lx)).toBeGreaterThanOrEqual(6.99);
  });

  it('never doubles a line at a break: the bar track at 1050 px (1250 BCE next to the 1200 BCE break)', () => {
    // The site's bar at 1440 px: 1050 px of track, minor ticks ≥ 9 px apart.
    const w = 1050;
    const x = (y: number): number => scale.toT(y) * w;
    const labelled = new Set(majors(w).map((t) => t.year));
    const ys = layoutMinorTicks({ min: MIN, max: MAX, breaks: STOP_YEARS, xOf: x, minSpacing: 9, exclude: labelled });
    const all = [...ys.map(x), ...[...labelled].map(x)].sort((p, q) => p - q);
    for (let i = 1; i < all.length; i++) expect(all[i]! - all[i - 1]!).toBeGreaterThanOrEqual(8.99);
    // The break wins over the tick just before it.
    if (!labelled.has(-1200)) expect(ys).toContain(-1200);
    expect(ys).not.toContain(-1250);
  });

  it('get denser where the scale gives years more room', () => {
    // Smallest gap between consecutive minor ticks (labelled years are left out).
    const step = (a: number, b: number): number => {
      const ys = minor.filter((y) => y > a && y < b);
      let d = Infinity;
      for (let i = 1; i < ys.length; i++) d = Math.min(d, ys[i]! - ys[i - 1]!);
      return d;
    };
    expect(step(-3400, -1200)).toBe(250);
    expect(step(1500, 1800)).toBe(25);
    expect(step(1900, 2026)).toBe(5);
  });
});
