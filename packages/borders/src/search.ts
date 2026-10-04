// Diacritic-insensitive polity search over names and alternative names.

import type { HistYear, PolityInfo, PolitySearchResult } from './types.js';

// Letters that Unicode decomposition (NFKD) does not split into base letter + mark.
const FOLD: Record<string, string> = {
  ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', þ: 'th', ł: 'l', ı: 'i', ħ: 'h', ŋ: 'n', ŧ: 't', ĸ: 'k', ſ: 's',
};
const FOLD_RE = new RegExp(`[${Object.keys(FOLD).join('')}]`, 'g');
// Apostrophes and glottal-stop letters join words: "Hawaiʻi" → "hawaii", "Ma'rib" → "marib".
const APOSTROPHES = /['`´‘’ʹʻʼʽʾʿˈ]/g;

/**
 * Search normalisation: decompose, drop combining marks, lower-case, fold special
 * letters (ß → ss, ø → o, ł → l …), drop apostrophes, and turn every other run of
 * non-letters/digits into one space. "Đại Việt" → "dai viet".
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(FOLD_RE, (c) => FOLD[c] as string)
    .replace(APOSTROPHES, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Generic words of English polity names. Dropping them gives a name's "core"
// ("Kingdom of France" → "france"), so a query for the place finds the polity.
const DESIGNATORS = new Set(
  (
    'the of and de del du la le kingdom empire republic dynasty sultanate emirate caliphate khanate khaganate ' +
    'duchy grand archduchy principality county electorate margraviate landgraviate bishopric prince ' +
    'confederation confederacy federation union league state states commonwealth dominion realm ' +
    'protectorate colony mandate territory viceroyalty shogunate chiefdom imamate sheikhdom beylik regency ' +
    'nation city'
  ).split(' '),
);

interface Key {
  text: string;
  words: string[];
  /** text without designators, when that differs and is not empty. */
  core?: string;
  /** The original alternative name (undefined for the main name). */
  alt?: string;
}

function makeKey(text: string, alt?: string): Key {
  const words = text.split(' ');
  const core = words.filter((w) => !DESIGNATORS.has(w)).join(' ');
  const key: Key = { text, words };
  if (core && core !== text) key.core = core;
  if (alt !== undefined) key.alt = alt;
  return key;
}

interface Entry {
  pid: string;
  info: PolityInfo;
  /** info.name, or '' when the index entry has none. */
  name: string;
  /** Bounding-box area in square degrees, scaled by cos(latitude); 0 when unknown. */
  extent: number;
  keys: Key[];
}

/** Approximate size of a [w, s, e, n] box; handles boxes that cross the antimeridian. */
function bboxExtent(bbox: unknown): number {
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((v) => typeof v === 'number' && Number.isFinite(v))) return 0;
  const [w, s, e, n] = bbox as [number, number, number, number];
  const width = e >= w ? e - w : e - w + 360;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  return Math.max(0, width * (n - s) * Math.cos(midLat));
}

/** Match ranks: lower is better. */
const EXACT = 0;
const CORE_EXACT = 1;
const PREFIX = 2;
const WORD_PREFIX = 3;
const SUBSTRING = 4;
/** One typo away from a word prefix; only fills slots the ranks above leave empty. */
const NEAR = 5;

function rank(key: Key, q: string, tokens: string[]): number {
  if (key.text === q) return EXACT;
  if (key.core === q) return CORE_EXACT;
  if (key.text.startsWith(q)) return PREFIX;
  if (tokens.every((t) => key.words.some((w) => w.startsWith(t)))) return WORD_PREFIX;
  if (key.text.includes(q)) return SUBSTRING;
  return -1;
}

/** Shortest query word that may match with a typo (shorter words match too much). */
const NEAR_MIN_LENGTH = 4;

/** True for query words that may match with a typo: long enough, and no digits. */
const typoTolerant = (token: string) => token.length >= NEAR_MIN_LENGTH && !/\d/.test(token);

/**
 * True when `word` starts with `token` give or take one edit — a substituted, extra,
 * missing or swapped (adjacent) letter — after the first letter, which must match:
 * "rome" ~ "roman", "ottomon" ~ "ottoman", "byzantnie" ~ "byzantine". Only for
 * typo-tolerant tokens (see typoTolerant).
 */
export function nearPrefix(token: string, word: string): boolean {
  const n = token.length;
  if (!typoTolerant(token) || word[0] !== token[0]) return false;
  // The single edit can be placed at the first difference.
  let i = 1;
  while (i < n && i < word.length && token[i] === word[i]) i++;
  if (i === n) return true; // a plain prefix
  if (i === word.length) return n - i === 1; // word ran out: only one trailing letter to drop
  const rest = token.slice(i + 1);
  return (
    word.startsWith(rest, i + 1) || // token[i] substituted
    word.startsWith(rest, i) || // token[i] is extra
    word.startsWith(token.slice(i), i + 1) || // a letter is missing before token[i]
    (token[i] === word[i + 1] && token[i + 1] === word[i] && word.startsWith(token.slice(i + 2), i + 2)) // swapped
  );
}

/**
 * Every query word starts a word of the key, exactly or with one typo each. Only asked
 * for keys without a strict match, so at least one word needed its typo.
 */
const nearMatch = (key: Key, tokens: string[]) =>
  tokens.every((t) => key.words.some((w) => w.startsWith(t) || nearPrefix(t, w)));

const aliveIn = (spans: PolityInfo['spans'] | undefined, year: HistYear) =>
  Array.isArray(spans) && spans.some(([from, to]) => from <= year && year <= to);

/** Precomputed normalised names; build once per polity index. */
export class SearchIndex {
  private readonly entries: Entry[];

  constructor(index: Record<string, PolityInfo>) {
    this.entries = Object.entries(index).map(([pid, info]) => {
      const keys: Key[] = [];
      const seen = new Set<string>();
      const addKey = (name: unknown, alt: boolean) => {
        if (typeof name !== 'string') return;
        const text = normalizeText(name);
        if (!text || seen.has(text)) return;
        seen.add(text);
        keys.push(alt ? makeKey(text, name) : makeKey(text));
      };
      addKey(info.name, false);
      if (Array.isArray(info.altNames)) for (const n of info.altNames) addKey(n, true);
      const name = typeof info.name === 'string' ? info.name : '';
      return { pid, info, name, extent: bboxExtent(info.bbox), keys };
    });
  }

  /**
   * Ranks exact > exact without designators ("france" → "Kingdom of France") > prefix >
   * word-prefix (every query word starts a word of the name, in any order) > substring;
   * within a rank a main-name match beats an alternative name,
   * then the larger bounding box (a cheap proxy for size), then the shorter name, then
   * alphabetical order. When fewer than `limit` polities match, the remaining slots are
   * filled with near matches (word prefixes with one typo, see nearPrefix), ranked last.
   */
  search(q: string, o: { limit?: number; year?: HistYear } = {}): PolitySearchResult[] {
    const query = normalizeText(q);
    const limit = Math.floor(o.limit ?? 10);
    if (!query || !(limit > 0)) return [];
    const tokens = query.split(' ');
    // Within a rank, a main-name match beats an alternative-name match.
    const scoreOf = (r: number, key: Key) => r * 2 + (key.alt === undefined ? 0 : 1);
    const hits: { entry: Entry; score: number; alt?: string }[] = [];
    const add = (entry: Entry, score: number, key: Key) =>
      hits.push(key.alt === undefined ? { entry, score } : { entry, score, alt: key.alt });
    const misses: Entry[] = [];
    for (const entry of this.entries) {
      if (o.year !== undefined && !aliveIn(entry.info.spans, o.year)) continue;
      let best = Infinity;
      let bestKey: Key | undefined;
      for (const key of entry.keys) {
        const r = rank(key, query, tokens);
        if (r < 0) continue;
        const score = scoreOf(r, key);
        if (score < best) {
          best = score;
          bestKey = key;
        }
      }
      if (bestKey) add(entry, best, bestKey);
      else misses.push(entry);
    }
    if (hits.length < limit && tokens.some(typoTolerant)) {
      for (const entry of misses) {
        // Keys list the main name first, so it wins over an alternative name.
        const key = entry.keys.find((k) => nearMatch(k, tokens));
        if (key) add(entry, scoreOf(NEAR, key), key);
      }
    }
    const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
    hits.sort(
      (a, b) =>
        a.score - b.score ||
        b.entry.extent - a.entry.extent ||
        a.entry.name.length - b.entry.name.length ||
        cmp(a.entry.name, b.entry.name) ||
        cmp(a.entry.pid, b.entry.pid),
    );
    return hits.slice(0, limit).map(({ entry, alt }) => {
      const result: PolitySearchResult = { ...entry.info, pid: entry.pid };
      if (alt !== undefined) result.matched = alt;
      return result;
    });
  }
}
