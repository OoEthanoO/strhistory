// Time scale of the timeline (root AGENTS.md §5.4, §7.2): a piecewise-linear,
// monotonic, invertible mapping between historical years and a track position t.
//
// Years use historical numbering (no year 0: −1 = 1 BCE, 1 = 1 CE). Interpolation
// happens in astronomical numbering (1 BCE = 0, 2 BCE = −1), where years are evenly
// spaced, so 1 BCE and 1 CE are exactly one year apart on the track and no position
// ever maps to year 0. Pure math: no DOM, no imports.

/** A scale stop: `[year, t]` — the year (historical, non-zero integer) drawn at track position `t`. */
export type TimeStop = readonly [year: number, t: number];

export interface TimeScale {
  /**
   * Track position of `year` (historical numbering), linear between stops and
   * clamped to the stops' range. Fractional years are accepted (the open interval
   * between −1 and 1 maps continuously onto the single year step 1 BCE → 1 CE).
   * `NaN` gives `NaN`.
   */
  toT(year: number): number;
  /**
   * The year whose position is nearest to `t`: an integer, never 0, clamped to the
   * stops' years. Round-trips exactly: `toYear(toT(y)) === y` for every valid year
   * in the domain. `NaN` gives `NaN`.
   */
  toYear(t: number): number;
  /** The validated stops (frozen copies). */
  readonly stops: readonly TimeStop[];
  /** `[first stop year, last stop year]`. */
  readonly domain: readonly [number, number];
  /** `[first stop t, last stop t]`. */
  readonly range: readonly [number, number];
}

/** The present year used by {@link DEFAULT_STOPS} (`manifest.years.present` when built in 2026). */
export const DEFAULT_PRESENT_YEAR = 2026;

/**
 * The default stops of AGENTS.md §7.2 with a configurable present year:
 * `[-3400,0] [-1200,.10] [-500,.16] [1,.22] [500,.30] [1000,.38] [1500,.50] [1800,.66] [1900,.80] [present,1]`.
 * Early millennia are compressed and recent centuries expanded, so modern border
 * changes stay reachable on a phone-sized track.
 */
export function defaultStops(present: number = DEFAULT_PRESENT_YEAR): TimeStop[] {
  if (!Number.isSafeInteger(present) || present <= 1900) {
    throw new RangeError(`createTimeScale: the present year must be an integer after 1900 (got ${String(present)})`);
  }
  return [
    [-3400, 0],
    [-1200, 0.1],
    [-500, 0.16],
    [1, 0.22],
    [500, 0.3],
    [1000, 0.38],
    [1500, 0.5],
    [1800, 0.66],
    [1900, 0.8],
    [present, 1],
  ];
}

/** {@link defaultStops} for the present year {@link DEFAULT_PRESENT_YEAR} (2026). Frozen. */
export const DEFAULT_STOPS: readonly TimeStop[] = Object.freeze(
  defaultStops().map((s) => Object.freeze(s) as TimeStop),
);

/**
 * Historical → continuous astronomical year. Integers follow the usual rule
 * (−1 → 0, −500 → −499, 1 → 1); values strictly between −1 and 1 (including the
 * non-existent 0) map linearly onto [0, 1] so the function stays continuous and
 * strictly increasing.
 */
export function astroOf(year: number): number {
  if (year >= 1) return year;
  if (year <= -1) return year + 1;
  return (year + 1) / 2;
}

/** Integer astronomical → historical year (0 → −1). */
export function histOf(astro: number): number {
  return astro <= 0 ? astro - 1 : astro;
}

/**
 * Creates the piecewise-linear scale. Stops need strictly increasing, non-zero
 * integer years and strictly increasing finite `t` (at least two stops); anything
 * else throws a `RangeError`, because a flat or reversed segment cannot be inverted.
 */
export function createTimeScale(stops: readonly (readonly [number, number])[]): TimeScale {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new RangeError('createTimeScale: need at least two [year, t] stops');
  }
  const n = stops.length;
  const years = new Array<number>(n);
  const astro = new Array<number>(n);
  const ts = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const stop = stops[i];
    const y = stop?.[0];
    const t = stop?.[1];
    if (typeof y !== 'number' || !Number.isSafeInteger(y) || y === 0) {
      throw new RangeError(`createTimeScale: stop ${i} has an invalid year ${String(y)} (non-zero integers only)`);
    }
    if (typeof t !== 'number' || !Number.isFinite(t)) {
      throw new RangeError(`createTimeScale: stop ${i} has an invalid t ${String(t)}`);
    }
    if (i > 0 && !(y > years[i - 1]!)) {
      throw new RangeError(`createTimeScale: stop years must increase (stop ${i}: ${y} after ${years[i - 1]})`);
    }
    if (i > 0 && !(t > ts[i - 1]!)) {
      throw new RangeError(`createTimeScale: stop t must increase (stop ${i}: ${t} after ${ts[i - 1]})`);
    }
    years[i] = y;
    astro[i] = astroOf(y);
    ts[i] = t;
  }

  // Index of the segment [i, i + 1] containing v in the sorted array `arr`
  // (v is known to lie strictly inside the first and last values).
  const segment = (arr: number[], v: number): number => {
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid]! <= v) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  const first = 0;
  const last = n - 1;

  const toT = (year: number): number => {
    if (Number.isNaN(year)) return NaN;
    const a = astroOf(year);
    if (a <= astro[first]!) return ts[first]!;
    if (a >= astro[last]!) return ts[last]!;
    const i = segment(astro, a);
    const a0 = astro[i]!;
    const a1 = astro[i + 1]!;
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    return t0 + ((a - a0) * (t1 - t0)) / (a1 - a0);
  };

  const toYear = (t: number): number => {
    if (Number.isNaN(t)) return NaN;
    if (t <= ts[first]!) return years[first]!;
    if (t >= ts[last]!) return years[last]!;
    const i = segment(ts, t);
    const a0 = astro[i]!;
    const a1 = astro[i + 1]!;
    const t0 = ts[i]!;
    const t1 = ts[i + 1]!;
    const a = a0 + ((t - t0) * (a1 - a0)) / (t1 - t0);
    // Nearest whole astronomical year; astronomical 0 is 1 BCE, so the result is never 0.
    const y = histOf(Math.round(a));
    return Math.min(years[last]!, Math.max(years[first]!, y));
  };

  const frozenStops = Object.freeze(years.map((y, i) => Object.freeze([y, ts[i]!] as const) as TimeStop));
  return {
    toT,
    toYear,
    stops: frozenStops,
    domain: Object.freeze([years[first]!, years[last]!] as const),
    range: Object.freeze([ts[first]!, ts[last]!] as const),
  };
}

/**
 * Stops covering at least [min, max]: when the timeline's range reaches beyond the
 * stops, the first/last segment is continued with its own slope, so the scale stays
 * invertible over the whole track instead of clamping (several years on one point).
 */
export function extendStops(stops: readonly TimeStop[], min: number, max: number): TimeStop[] {
  const out = stops.map((s) => [s[0], s[1]] as [number, number]);
  const n = out.length;
  if (n < 2) return out;
  const [y0, t0] = out[0]!;
  const [y1, t1] = out[1]!;
  if (min < y0) {
    const slope = (t1 - t0) / (astroOf(y1) - astroOf(y0));
    out.unshift([min, t0 - (astroOf(y0) - astroOf(min)) * slope]);
  }
  const m = out.length;
  const [ya, ta] = out[m - 2]!;
  const [yb, tb] = out[m - 1]!;
  if (max > yb) {
    const slope = (tb - ta) / (astroOf(yb) - astroOf(ya));
    out.push([max, tb + (astroOf(max) - astroOf(yb)) * slope]);
  }
  return out;
}

/**
 * Local density of the scale at `year`: astronomical years per unit of t on the
 * segment that the year enters when moving in direction `dir` (+1 later, −1 earlier).
 * At the ends of the domain the outermost segment is used.
 */
export function yearsPerT(scale: TimeScale, year: number, dir: 1 | -1): number {
  const stops = scale.stops;
  const n = stops.length;
  const a = astroOf(year);
  // Segment i spans stops[i] .. stops[i + 1].
  let i = 0;
  if (a <= astroOf(stops[0]![0])) i = 0;
  else if (a >= astroOf(stops[n - 1]![0])) i = n - 2;
  else {
    for (let k = 0; k < n - 1; k++) {
      const a0 = astroOf(stops[k]![0]);
      const a1 = astroOf(stops[k + 1]![0]);
      if (dir > 0 ? a >= a0 && a < a1 : a > a0 && a <= a1) {
        i = k;
        break;
      }
    }
  }
  const s0 = stops[i]!;
  const s1 = stops[i + 1]!;
  return (astroOf(s1[0]) - astroOf(s0[0])) / (s1[1] - s0[1]);
}
