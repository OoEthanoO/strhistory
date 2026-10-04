// Stepping helpers for the timeline: adaptive step size, stepping on a grid of
// round years (never landing on year 0) and previous/next border change.
// Pure functions, no DOM.

import { astroOf, histOf, yearsPerT, type TimeScale } from './scale.js';

/** Step sizes the adaptive step is rounded to (years). */
export const STEP_SIZES: readonly number[] = Object.freeze([1, 5, 10, 20, 50, 100, 200]);

/** The entry of {@link STEP_SIZES} nearest to `years` on a logarithmic scale (1 for non-positive input). */
export function niceStep(years: number): number {
  if (!(years > 0)) return 1;
  let best = STEP_SIZES[0]!;
  let bestErr = Infinity;
  for (const s of STEP_SIZES) {
    const err = Math.abs(Math.log(years / s));
    if (err < bestErr) {
      best = s;
      bestErr = err;
    }
  }
  return best;
}

/**
 * Adaptive step at `year` when moving in direction `dir`: the number of years that
 * `fraction` (default 1 %) of the track covers there, rounded with {@link niceStep}.
 * `tSpan` is the t range shown by the track (`toT(max) − toT(min)`).
 * With the default stops: 5 years after 1900, 20 around 1600, 50 in 1–1500,
 * 100 in 1200 BCE–1 CE, 200 before 1200 BCE.
 */
export function adaptiveStep(scale: TimeScale, year: number, dir: 1 | -1, tSpan: number, fraction = 0.01): number {
  return niceStep(yearsPerT(scale, year, dir) * tSpan * fraction);
}

/**
 * The next year from `year` in direction `dir` on the grid of multiples of `step`,
 * clamped to [min, max]. The grid point 0 (a year that does not exist) is 1 CE in
 * both directions, so stepping by 100 runs …, −200, −100, 1, 100, 200, … and back.
 * A step of 1 moves one year, skipping 0 (−1 ↔ 1).
 */
export function gridStep(year: number, step: number, dir: 1 | -1, min: number, max: number): number {
  let next: number;
  if (step <= 1) {
    next = histOf(astroOf(year) + dir);
  } else {
    // Grid coordinate of the year; 1 CE sits exactly on grid point 0.
    const g = year === 1 ? 0 : year / step;
    const k = dir > 0 ? Math.floor(g) + 1 : Math.ceil(g) - 1;
    next = k === 0 ? 1 : k * step;
  }
  return Math.min(max, Math.max(min, next));
}

/**
 * Sorted, de-duplicated frame years inside [min, max]. Non-integers and 0 are
 * dropped. Frames are the years in which borders change (manifest.frames).
 */
export function normalizeFrames(frames: readonly number[] | null | undefined, min: number, max: number): number[] {
  if (!frames) return [];
  const out: number[] = [];
  for (const f of frames) {
    if (typeof f === 'number' && Number.isSafeInteger(f) && f !== 0 && f >= min && f <= max) out.push(f);
  }
  out.sort((a, b) => a - b);
  let w = 0;
  for (let r = 0; r < out.length; r++) {
    if (r === 0 || out[r] !== out[w - 1]) out[w++] = out[r]!;
  }
  out.length = w;
  return out;
}

/** Index of the first frame strictly greater than `year` (frames sorted ascending). */
function upperBound(frames: readonly number[], year: number): number {
  let lo = 0;
  let hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]! <= year) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The latest border change strictly before `year`, or null. */
export function prevChange(frames: readonly number[], year: number): number | null {
  let lo = 0;
  let hi = frames.length;
  // First index with frame >= year; the one before it is the answer.
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (frames[mid]! < year) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? frames[lo - 1]! : null;
}

/** The earliest border change strictly after `year`, or null. */
export function nextChange(frames: readonly number[], year: number): number | null {
  const i = upperBound(frames, year);
  return i < frames.length ? frames[i]! : null;
}
