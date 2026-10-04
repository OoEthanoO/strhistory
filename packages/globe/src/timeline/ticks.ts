// Tick layout for the timeline track. Pure functions, no DOM.
//
// Major (labelled) ticks are placed by priority, and a lower-priority label is
// dropped when it would sit closer than `minSpacing` px (centre to centre, and
// never closer than the two half-widths plus `gap`) to one already placed:
//   1. multiples of 1000 years      (farthest-first, so they spread out)
//   2. 1 CE (the BCE/CE boundary)
//   3. round stops of the scale     (multiples of 100: the scale is linear between stops)
//   4. each remaining gap between neighbouring labels gets the finest step from
//      LABEL_STEPS whose multiples all fit (after trimming the ones that collide with
//      the gap's end labels) and still cover at least half the gap; the new
//      sub-gaps are refined again with finer steps.
// Step 4 keeps labels regular inside a gap (1000 · 1250 · 1500 rather than
// 1000 · 1200 · 1500), and the layout is recomputed whenever the track resizes.
//
// Minor ticks: per linear segment of the scale, multiples of the finest step from
// MINOR_STEPS that keeps them `minSpacing` px apart, so tick density shows where the
// scale compresses time. No minor tick sits closer than `minSpacing` to another one
// across a segment break (the one on the break wins) or to a labelled tick, so no line
// is drawn doubled.

import { astroOf } from './scale.js';

export interface MajorTick {
  year: number;
  /** Centre of the label, px from the left end of the track. */
  x: number;
  /** Estimated label width (px). */
  width: number;
}

export interface MajorTickInput {
  min: number;
  max: number;
  /** Track width (px). */
  width: number;
  /** Position of a year, px from the left end of the track. */
  xOf(year: number): number;
  /** Estimated width of a year's label (px). */
  labelWidth(year: number): number;
  /** Round years where the scale changes slope (its stops); tried after millennia and 1 CE. */
  anchors?: readonly number[];
  /** Minimum centre-to-centre distance between labels (px). Default 56. */
  minSpacing?: number;
  /** Minimum free space between two label boxes (px). Default 6. */
  gap?: number;
  /** How far a label may extend beyond either end of the track (px). Default 0. */
  overhang?: number;
}

/** Steps (years) used to fill gaps between labels, finest first. */
export const LABEL_STEPS: readonly number[] = Object.freeze([1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]);

/** Steps (years) for minor ticks, finest first. */
export const MINOR_STEPS: readonly number[] = Object.freeze([1, 5, 10, 25, 50, 100, 250, 500, 1000]);

/** Labelled major ticks, sorted by year. Returns [] for a non-positive width or an empty range. */
export function layoutMajorTicks(input: MajorTickInput): MajorTick[] {
  const { min, max, width, xOf, labelWidth } = input;
  const minSpacing = input.minSpacing ?? 56;
  const gap = input.gap ?? 6;
  const overhang = input.overhang ?? 0;
  if (!(width > 0) || !(max > min)) return [];

  const placed: MajorTick[] = []; // sorted by x (and so by year)
  const placedYears = new Set<number>();

  const make = (year: number): MajorTick => ({ year, x: xOf(year), width: labelWidth(year) });
  const insideEdges = (t: MajorTick): boolean => t.x - t.width / 2 >= -overhang && t.x + t.width / 2 <= width + overhang;
  const apart = (a: MajorTick, b: MajorTick): boolean =>
    Math.abs(a.x - b.x) >= Math.max(minSpacing, (a.width + b.width) / 2 + gap);
  // Index of the first placed tick to the right of x.
  const indexAfter = (x: number): number => {
    let lo = 0;
    let hi = placed.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (placed[mid]!.x <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const fits = (t: MajorTick): boolean => {
    if (!insideEdges(t)) return false;
    const i = indexAfter(t.x);
    const prev = placed[i - 1];
    const next = placed[i];
    return (!prev || apart(prev, t)) && (!next || apart(next, t));
  };
  const place = (t: MajorTick): void => {
    placed.splice(indexAfter(t.x), 0, t);
    placedYears.add(t.year);
  };
  const valid = (y: number): boolean => Number.isSafeInteger(y) && y !== 0 && y >= min && y <= max;

  // Farthest-first greedy: repeatedly try the candidate farthest from everything
  // placed (and from the track ends), so a crowded tier keeps an even spread.
  const placeTier = (years: Iterable<number>): void => {
    const cands: MajorTick[] = [];
    for (const y of years) if (valid(y) && !placedYears.has(y)) cands.push(make(y));
    while (cands.length) {
      let best = 0;
      let bestD = -Infinity;
      for (let i = 0; i < cands.length; i++) {
        const c = cands[i]!;
        let d = Math.min(c.x, width - c.x);
        const k = indexAfter(c.x);
        const prev = placed[k - 1];
        const next = placed[k];
        if (prev) d = Math.min(d, c.x - prev.x);
        if (next) d = Math.min(d, next.x - c.x);
        if (d > bestD) {
          bestD = d;
          best = i;
        }
      }
      const c = cands.splice(best, 1)[0]!;
      if (!placedYears.has(c.year) && fits(c)) place(c);
    }
  };

  const multiples = (step: number, from: number, to: number): number[] => {
    const out: number[] = [];
    for (let k = Math.ceil(from / step); k * step <= to; k++) if (k !== 0) out.push(k * step);
    return out;
  };

  placeTier(multiples(1000, min, max));
  placeTier([1]);
  placeTier((input.anchors ?? []).filter((y) => y === 1 || y % 100 === 0));

  // Gap refinement.
  interface Gap {
    left: MajorTick | null;
    right: MajorTick | null;
    /** Only steps finer than this are tried. */
    below: number;
  }
  const queue: Gap[] = [];
  for (let i = 0; i <= placed.length; i++) {
    queue.push({ left: placed[i - 1] ?? null, right: placed[i] ?? null, below: Infinity });
  }
  while (queue.length) {
    const g = queue.pop()!;
    const lo = g.left ? g.left.year : min;
    const hi = g.right ? g.right.year : max;
    for (const step of LABEL_STEPS) {
      if (step >= g.below) break;
      // Candidate multiples k·step strictly between the end labels (inclusive at the
      // track ends); k = 0 is year 0, which does not exist.
      let kFirst = Math.ceil(lo / step);
      if (g.left && kFirst * step <= lo) kFirst++;
      let kLast = Math.floor(hi / step);
      if (g.right && kLast * step >= hi) kLast--;
      if (kFirst > kLast) continue;
      const at = (k: number): MajorTick | null => (k === 0 ? null : make(k * step));
      const okLeft = (t: MajorTick): boolean => insideEdges(t) && (!g.left || apart(g.left, t));
      const okRight = (t: MajorTick): boolean => insideEdges(t) && (!g.right || apart(t, g.right));
      // Trim candidates that collide with the gap's ends.
      let i = kFirst;
      for (; i <= kLast; i++) {
        const t = at(i);
        if (t && okLeft(t)) break;
      }
      let j = kLast;
      for (; j >= i; j--) {
        const t = at(j);
        if (t && okRight(t)) break;
      }
      if (i > j) continue;
      // Every remaining multiple must be clear of its neighbours.
      const run: MajorTick[] = [];
      let ok = true;
      for (let k = i; k <= j && ok; k++) {
        const t = at(k);
        if (!t) continue;
        const prev = run[run.length - 1];
        if (prev && !apart(prev, t)) ok = false;
        else if (!okLeft(t) || !okRight(t)) ok = false;
        else run.push(t);
      }
      if (!ok || run.length === 0) continue;
      // Coverage: the step must suit the gap, not just squeeze one survivor in after
      // trimming (that gives labels like "3100 BCE" against the edge or "1125"
      // between 1000 and 1250). Its labels must span at least half the gap's years.
      if ((run.length + 1) * step * 2 < astroOf(hi) - astroOf(lo)) continue;
      for (const t of run) place(t);
      const ends = [g.left, ...run, g.right];
      for (let k = 0; k < ends.length - 1; k++) queue.push({ left: ends[k]!, right: ends[k + 1]!, below: step });
      break;
    }
  }
  return placed;
}

export interface MinorTickInput {
  min: number;
  max: number;
  /** Years where the scale changes slope (its stops); the scale is linear between them. */
  breaks: readonly number[];
  xOf(year: number): number;
  /** Minimum distance between minor ticks (px). Default 7. */
  minSpacing?: number;
  /** Years to leave out (those with a labelled major tick); minor ticks closer than `minSpacing` to them are left out too. */
  exclude?: ReadonlySet<number>;
}

/** Unlabelled minor tick years, sorted ascending. */
export function layoutMinorTicks(input: MinorTickInput): number[] {
  const { min, max, xOf } = input;
  const minSpacing = input.minSpacing ?? 7;
  if (!(max > min)) return [];
  const bounds = [min, ...input.breaks.filter((y) => y > min && y < max), max];
  const out: number[] = [];
  for (let s = 0; s < bounds.length - 1; s++) {
    const a = bounds[s]!;
    const b = bounds[s + 1]!;
    const pxPerYear = (xOf(b) - xOf(a)) / (astroOf(b) - astroOf(a));
    if (!(pxPerYear > 0)) continue;
    const step = MINOR_STEPS.find((st) => st * pxPerYear >= minSpacing);
    if (step === undefined) continue;
    const last = s === bounds.length - 2;
    for (let k = Math.ceil(a / step); k * step < b || (last && k * step === b); k++) {
      const y = k * step;
      if (y !== 0 && !input.exclude?.has(y)) out.push(y);
    }
  }
  // Each segment picks its own step, so the ticks either side of a break can land closer
  // than minSpacing — a doubled line (1250 BCE on the 250-year grid and the 1200 BCE break
  // were 2.4 px apart on a 1050 px track) — and so can a tick next to a labelled year.
  // Leave out minor ticks near a labelled year; of two neighbours across a break, keep
  // the one on the break.
  const labelled = [...(input.exclude ?? [])].map(xOf);
  const onBreak = new Set(bounds);
  const kept: number[] = [];
  for (const y of out) {
    const x = xOf(y);
    if (labelled.some((lx) => Math.abs(lx - x) < minSpacing)) continue;
    const prev = kept[kept.length - 1];
    if (prev !== undefined && x - xOf(prev) < minSpacing) {
      if (onBreak.has(y) && !onBreak.has(prev)) kept[kept.length - 1] = y;
      continue;
    }
    kept.push(y);
  }
  return kept;
}
