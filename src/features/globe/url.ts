// The globe explorer's URL state, as query parameters:
//
//   /globe?year=1789&level=HL&curriculum=2028&topic=<slug>&polity=<pid>&all=1&q=<text>
//          &lng=<lon>&lat=<lat>&scale=<scale>
//
//  - year        historical year, never 0 (typed forms such as "500 BC" are accepted on input)
//  - level       'SL' | 'HL' (HL includes the SL core)
//  - curriculum  '2028' | 'archive'
//  - topic       the selected history note (a topic slug)
//  - polity      the selected polity (`clio:…`, `ne:…`, `ovr:…`)
//  - all         '1' shows pins from all years
//  - q           the notes and search query
//  - lng/lat/scale  the camera (the home page's handoff writes these too)
//
// Ported from the Alex's Atlas reference site, apps/site/src/state/url.ts (which keeps
// its state in the hash): parsing clamps every value into range and drops what it
// cannot read, so any address (old links, hand edits, garbage) yields a usable state.
// `HistoryWriter` writes the query with replaceState (throttled while the user scrubs
// or pans) or pushState (on a selection, so Back returns to the previous one).
//
// Dependency-free and erasable TypeScript only, so `node --test` runs its tests
// (src/features/globe/url.test.ts) without a build step.

export type GlobeLevel = 'SL' | 'HL';
export type GlobeCurriculum = '2028' | 'grade-10' | 'archive';

/** The camera: centre and `scale = 2^(zoom − fitZoom)` (1 = the globe fits the view). */
export interface GlobeUrlView {
  lng: number;
  lat: number;
  scale: number;
}

export interface GlobeUrlState {
  year?: number;
  level?: GlobeLevel;
  curriculum?: GlobeCurriculum;
  topic?: string;
  polity?: string;
  all?: boolean;
  q?: string;
  view?: GlobeUrlView;
}

export interface GlobeUrlBounds {
  minYear: number;
  maxYear: number;
}

/** Topic slugs: the note's file name (lower-case kebab case). */
const TOPIC = /^[a-z0-9-]{1,120}$/;
/** Polity ids: a lower-case namespace, a colon and a slug (borders AGENTS.md §5.2). */
const PID = /^[a-z][a-z0-9]*:[a-z0-9][a-z0-9._-]{0,119}$/;
/** A plain decimal number ("1789", "-500", "2.5"); no exponents, hex or empty strings. */
const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;
const MAX_LAT = 85;
const MIN_SCALE = 0.5;
const MAX_SCALE = 64;
const MAX_QUERY = 100;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Longitude wrapped into [-180, 180); in-range values are returned untouched (no float noise). */
export const wrapLon = (lon: number): number =>
  lon >= -180 && lon < 180 ? lon : ((((lon + 180) % 360) + 360) % 360) - 180;

// ------------------------------------------------------------------------- years

// Hyphen-like characters people type or paste for a minus sign.
const MINUS = /[‐-―−﹘﹣－]/g;
// [sign] [era] digits [era]; digits may use comma thousands separators ("3,400").
const TYPED_YEAR = /^([+-])?\s*(?:(bce|bc|ce|ad)\s*)?(\d{1,3}(?:,\d{3})+|\d+)\s*(bce|bc|ce|ad)?$/;

/**
 * A typed year: "1453", "-500", "500 BC", "500 BCE", "AD 33", "33 CE", "500 B.C.",
 * "3,400 BCE". Null for year 0, contradictory input ("-500 BC") and anything else.
 * (The same rules as `parseYear` in @alexs-atlas/borders, kept here so this module
 * has no imports.)
 */
export function parseTypedYear(input: string): number | null {
  const s = input
    .trim()
    .toLowerCase()
    .replace(MINUS, '-')
    .replace(/([a-z])\./g, '$1')
    .replace(/\s+/g, ' ');
  const m = TYPED_YEAR.exec(s);
  if (!m) return null;
  const sign = m[1];
  const eraBefore = m[2];
  const digits = m[3] ?? '';
  const eraAfter = m[4];
  if (eraBefore && eraAfter) return null;
  const era = eraBefore ?? eraAfter;
  if (sign && era) return null;
  const n = Number(digits.replace(/,/g, ''));
  if (!Number.isSafeInteger(n) || n === 0) return null;
  return sign === '-' || era === 'bc' || era === 'bce' ? -n : n;
}

/** Rounds, turns 0 into 1 (there is no year 0) and clamps into the bounds. */
function clampYear(y: number, b: GlobeUrlBounds): number {
  let r = Math.round(y);
  if (r === 0) r = 1;
  r = clamp(r, b.minYear, b.maxYear);
  if (r === 0) r = b.maxYear >= 1 ? 1 : -1; // only for bounds that end at 0 themselves
  return r;
}

function readYear(raw: string | null, b: GlobeUrlBounds): number | undefined {
  if (raw === null) return undefined;
  const s = raw.trim();
  if (s === '') return undefined;
  const y = DECIMAL.test(s) ? Number(s) : parseTypedYear(s);
  if (y === null || !Number.isFinite(y)) return undefined;
  return clampYear(y, b);
}

// ---------------------------------------------------------------- other values

function readNumber(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const s = raw.trim();
  if (!DECIMAL.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function readLevel(raw: string | null): GlobeLevel | undefined {
  const s = raw?.trim().toUpperCase();
  return s === 'SL' || s === 'HL' ? s : undefined;
}

function readCurriculum(raw: string | null): GlobeCurriculum | undefined {
  const s = raw?.trim().toLowerCase();
  if (s === '2028' || s === 'archive' || s === 'grade-10') return s;
  if (s === 'g10') return 'grade-10';
  return undefined;
}

function readTopic(raw: string | null): string | undefined {
  const s = raw?.trim().toLowerCase();
  return s !== undefined && TOPIC.test(s) ? s : undefined;
}

function readPolity(raw: string | null): string | undefined {
  const s = raw?.trim().toLowerCase();
  return s !== undefined && PID.test(s) ? s : undefined;
}

function readAll(raw: string | null): boolean | undefined {
  const s = raw?.trim().toLowerCase();
  return s === '1' || s === 'true' ? true : undefined;
}

function readQuery(raw: string | null): string | undefined {
  if (raw === null) return undefined;
  // Cut by code points, so a long query never ends in half an emoji.
  const s = Array.from(raw.trim()).slice(0, MAX_QUERY).join('').trim();
  return s === '' ? undefined : s;
}

function readView(params: URLSearchParams): GlobeUrlView | undefined {
  const lng = readNumber(params.get('lng'));
  const lat = readNumber(params.get('lat'));
  if (lng === undefined || lat === undefined) return undefined;
  const scale = readNumber(params.get('scale'));
  return {
    lng: wrapLon(lng),
    lat: clamp(lat, -MAX_LAT, MAX_LAT),
    scale: scale !== undefined && scale > 0 ? clamp(scale, MIN_SCALE, MAX_SCALE) : 1,
  };
}

/** Parses `location.search` ("?year=1789&topic=…", with or without the leading '?'). */
export function parseGlobeUrl(search: string, bounds: GlobeUrlBounds): GlobeUrlState {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const out: GlobeUrlState = {};
  const year = readYear(params.get('year'), bounds);
  if (year !== undefined) out.year = year;
  const curriculum = readCurriculum(params.get('curriculum'));
  if (curriculum !== undefined) out.curriculum = curriculum;
  const level = readLevel(params.get('level'));
  if (level !== undefined && out.curriculum !== 'grade-10') out.level = level;
  const topic = readTopic(params.get('topic'));
  if (topic !== undefined) out.topic = topic;
  const polity = readPolity(params.get('polity'));
  if (polity !== undefined) out.polity = polity;
  const all = readAll(params.get('all'));
  if (all !== undefined) out.all = all;
  const q = readQuery(params.get('q'));
  if (q !== undefined) out.q = q;
  const view = readView(params);
  if (view !== undefined) out.view = view;
  return out;
}

// ------------------------------------------------------------------- writing

/** `digits` decimals with trailing zeros dropped ("41.9", not "41.900"; never "-0"). */
const fixed = (v: number, digits: number): string => {
  const s = (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits);
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  return t === '-0' ? '0' : t;
};

/**
 * Query-component encoding: spaces as '+', and the apostrophe escaped too (browsers
 * escape it in queries themselves, which would make an unchanged URL look changed).
 */
const enc = (s: string): string => encodeURIComponent(s).replace(/'/g, '%27').replace(/%20/g, '+');

/**
 * "?year=1789&level=HL&curriculum=2028&topic=…&polity=clio:…&all=1&q=…&lng=2.35&lat=48.85&scale=1.4";
 * "" when the state is empty.
 */
export function serialiseGlobeUrl(s: GlobeUrlState): string {
  const parts: string[] = [];
  if (s.year !== undefined && Number.isInteger(s.year) && s.year !== 0) parts.push(`year=${s.year}`);
  if (s.level && s.curriculum !== 'grade-10') parts.push(`level=${enc(s.level)}`);
  if (s.curriculum) parts.push(`curriculum=${enc(s.curriculum)}`);
  if (s.topic) parts.push(`topic=${enc(s.topic)}`);
  // The colon of a polity id stays readable (it needs no escaping in a query).
  if (s.polity) parts.push(`polity=${enc(s.polity).replace(/%3A/gi, ':')}`);
  if (s.all) parts.push('all=1');
  const q = s.q?.trim();
  if (q) parts.push(`q=${enc(q)}`);
  const v = s.view;
  if (v && Number.isFinite(v.lng) && Number.isFinite(v.lat)) {
    parts.push(`lng=${fixed(wrapLon(v.lng), 3)}`, `lat=${fixed(v.lat, 3)}`);
    if (Number.isFinite(v.scale) && v.scale > 0) parts.push(`scale=${fixed(v.scale, 3)}`);
  }
  return parts.length ? `?${parts.join('&')}` : '';
}

// ------------------------------------------------------------------- history

/** The subset of `window` the writer needs (`window` itself fits; injectable for tests). */
export interface HistoryHost {
  location: { pathname: string; search: string; hash: string };
  history: {
    pushState(data: unknown, unused: string, url?: string): void;
    replaceState(data: unknown, unused: string, url?: string): void;
  };
}

/**
 * Writes the query string, keeping the path and the hash. `replace()` is throttled
 * (a leading and a trailing write per window, the latest state wins); `push()` writes
 * now, after flushing a pending replace into the current entry. A query identical to
 * the address bar's is never written. History API errors (browsers rate-limit
 * replaceState) are swallowed: the URL is a convenience, never a reason to break the
 * page.
 */
export class HistoryWriter {
  /** Called after every successful write with the new query ("" or "?…"); pushState fires no event. */
  onWrite?: (search: string) => void;

  private readonly host: HistoryHost;
  private readonly throttleMs: number;
  private readonly now: () => number;
  private pending: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastWrite = -Infinity;

  constructor(win: HistoryHost, throttleMs: number, now: () => number = () => Date.now()) {
    this.host = win;
    this.throttleMs = Math.max(0, throttleMs);
    this.now = now;
  }

  /** Replace the current entry (scrubbing, panning, filters): at most one write per `throttleMs`. */
  replace(state: GlobeUrlState): void {
    this.pending = serialiseGlobeUrl(state);
    const wait = this.lastWrite + this.throttleMs - this.now();
    if (wait <= 0) this.flush();
    else this.timer ??= setTimeout(() => this.flush(), wait);
  }

  /**
   * A new history entry (a selection): a pending replace first goes into the current
   * entry (unless it already holds the pushed state), then the new entry is pushed.
   */
  push(state: GlobeUrlState): void {
    const search = serialiseGlobeUrl(state);
    const pending = this.pending;
    this.cancel();
    if (pending !== null && pending !== search) this.write(pending, 'replace');
    this.write(search, 'push');
  }

  /** Writes a pending replace immediately. */
  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    const search = this.pending;
    this.pending = null;
    if (search !== null) this.write(search, 'replace');
  }

  /** Drops a pending replace (e.g. after popstate restored another entry, or on unmount). */
  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
  }

  private write(search: string, mode: 'push' | 'replace'): void {
    const loc = this.host.location;
    if (search === loc.search) return;
    // Path + new query + hash: an empty query drops the old one entirely.
    const url = `${loc.pathname}${search}${loc.hash}`;
    try {
      if (mode === 'push') this.host.history.pushState(null, '', url);
      else this.host.history.replaceState(null, '', url);
      this.lastWrite = this.now();
      this.onWrite?.(search);
    } catch {
      /* rate-limited by the browser: the next write carries the latest state */
    }
  }
}
