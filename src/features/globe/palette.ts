/**
 * Polity colours. A polity's colour comes from hashing its controlling power
 * (SUBJECTO in the data), so an empire and its colonies share a colour within
 * a scheme. Schemes are selected by the source year of the border geometry.
 */

export interface PolityColorScheme {
  name: string;
  /** First border-geometry source year that uses this scheme (inclusive). */
  fromYear: number;
  colors: readonly string[];
  fixed: Readonly<Record<string, string>>;
}

// Muted, mid-value tones for the 19th-century scheme.
const NINETEENTH_CENTURY_COLORS = [
  '#8c7a5b', '#7d8f69', '#6f8aa0', '#a0786f', '#8e7fa3', '#6f9a92', '#a38a5c', '#7a8fa8',
  '#9a7f8f', '#869a6c', '#a47f67', '#6d8795', '#958a6e', '#7f7896', '#8fa08a', '#a08470',
] as const;

// Converted from the supplied 1900 country-colour data's D01-D14 RGB fills.
// These provide varied fallbacks for polities without a named colour below.
const MODERN_COLORS = [
  '#7ab361', '#c28c56', '#c8641f', '#5096b3', '#5c5cc5', '#9a4574', '#c3959b',
  '#d26a2f', '#699356', '#afa26c', '#7c8ca2', '#bb4f56', '#459dd0', '#8e4fc8',
] as const;

// A warmer set for ancient, medieval and early-modern snapshots. Keeping the
// number of entries equal is not required; the hash is resolved per scheme.
const HISTORICAL_COLORS = [
  '#98704f', '#74875f', '#607d92', '#9c6d5e', '#817196', '#5f8b80', '#a1814d', '#697f98',
  '#946e79', '#82905c', '#a87355', '#607c88', '#8f7d5d', '#746c8e', '#7d907a', '#99715b',
] as const;

/** Land with no recorded polity. */
export const UNCLAIMED = '#3a3931';
export const OCEAN = '#0c1a2b';
export const LAND_BASE = '#34332c';

const COMMON_FIXED: Readonly<Record<string, string>> = {
  'United Kingdom': '#b0806a',
  'United Kingdom of Great Britain and Ireland': '#b0806a',
  France: '#6f8fb0',
  'Russian Empire': '#a0707a',
  Russia: '#a0707a',
  Japan: '#b3935c',
  'Ottoman Empire': '#8f7fa6',
  Spain: '#a88f63',
  Portugal: '#7c8fa0',
};

// A few powers get fixed colours so the most-studied states and empires are
// easy to track instead of moving around as the surrounding map changes.
const NINETEENTH_CENTURY_FIXED: Readonly<Record<string, string>> = {
  ...COMMON_FIXED,
  Germany: '#8a8f6a',
  'German Empire': '#8a8f6a',
  USSR: '#b06b6b',
  'Soviet Russia': '#b06b6b',
  'United States': '#7e9f96',
  'United States of America': '#7e9f96',
  'Empire of Japan': '#b3935c',
  China: '#9b8468',
  'Republic of China': '#9b8468',
  Italy: '#7f9c74',
  'Kingdom of Italy': '#7f9c74',
  Belgium: '#9a8a74',
  Netherlands: '#a08463',
};

// Selected `color` values from the supplied 1900 country-colour data, converted
// from RGB (and, for Germany and Japan, HSV) to hex. Aliases match polity names
// used by the historical snapshots so empires and their territories share a fill.
const MODERN_FIXED: Readonly<Record<string, string>> = {
  'United Kingdom': '#c9385d',
  'United Kingdom of Great Britain and Ireland': '#c9385d',
  'British Empire': '#c9385d',
  France: '#3971e4',
  Germany: '#666057',
  'German Empire': '#666057',
  USSR: '#7d0d18',
  'Soviet Russia': '#7d0d18',
  Russia: '#679267',
  'Russian Empire': '#737373',
  'United States': '#1485ed',
  'United States of America': '#1485ed',
  USA: '#1485ed',
  Japan: '#ffc9b3',
  'Empire of Japan': '#ffc9b3',
  'Imperial Japan': '#ffc9b3',
  China: '#f50c37',
  'Republic of China': '#28288c',
  'Qing Empire': '#28288c',
  Italy: '#437f3f',
  'Kingdom of Italy': '#437f3f',
  Spain: '#f2cd5e',
  Portugal: '#277446',
  Belgium: '#c1ab08',
  Netherlands: '#cb8a4a',
  Poland: '#d6668b',
  Austria: '#c2c6d7',
  'Austria Hungary': '#c2c6d7',
  'Austro-Hungarian Empire': '#c2c6d7',
  Turkey: '#abbe98',
  'Republic of Turkey': '#abbe98',
  'Ottoman Empire': '#abbe98',
  Canada: '#e93b3b',
  Mexico: '#689853',
  Argentina: '#919dec',
  Bolivia: '#cca66c',
  Brazil: '#4c913f',
  Chile: '#9b656b',
  Colombia: '#debb5b',
  Ecuador: '#f99262',
  Paraguay: '#3971e4',
  Peru: '#c4bdcc',
  Uruguay: '#abbe98',
  Venezuela: '#abbe98',
  Iran: '#477161',
  Persia: '#477161',
  Australia: '#398f61',
  India: '#e28728',
  'British Raj': '#e28728',
  Sweden: '#2484f7',
  Norway: '#6f4747',
  Denmark: '#99745d',
  Finland: '#cdd4e4',
  Ireland: '#509f5a',
  Switzerland: '#e00505',
  Greece: '#5db5e3',
  Albania: '#952d66',
  Bulgaria: '#339b00',
  Hungary: '#f97e62',
  Romania: '#d7c448',
  Yugoslavia: '#48497e',
  Czechoslovakia: '#36a79c',
  'Czech Republic': '#36a79c',
};

const HISTORICAL_FIXED: Readonly<Record<string, string>> = {
  ...COMMON_FIXED,
  England: '#b0806a',
  'British Empire': '#b0806a',
  'Byzantine Empire': '#817196',
  'Holy Roman Empire': '#8a8f6a',
  'Ming Empire': '#a06f62',
  'Qing Empire': '#9b8468',
  'Mughal Empire': '#7f9c74',
};

/**
 * Add schemes in ascending `fromYear` order. The last matching entry wins, so
 * another period can be introduced by adding one object at its starting year.
 */
export const COLOR_SCHEMES: readonly PolityColorScheme[] = [
  { name: 'historical', fromYear: Number.NEGATIVE_INFINITY, colors: HISTORICAL_COLORS, fixed: HISTORICAL_FIXED },
  { name: 'nineteenth-century', fromYear: 1800, colors: NINETEENTH_CENTURY_COLORS, fixed: NINETEENTH_CENTURY_FIXED },
  { name: 'modern', fromYear: 1900, colors: MODERN_COLORS, fixed: MODERN_FIXED },
];

export function colorSchemeFor(borderYear?: number | null): PolityColorScheme {
  const year = borderYear ?? Number.POSITIVE_INFINITY;
  let selected = COLOR_SCHEMES[0];
  for (const scheme of COLOR_SCHEMES) {
    if (year < scheme.fromYear) break;
    selected = scheme;
  }
  return selected;
}

export function colorFor(key: string | null | undefined, borderYear?: number | null): string {
  if (!key) return UNCLAIMED;
  const scheme = colorSchemeFor(borderYear);
  const fixed = scheme.fixed[key];
  if (fixed) return fixed;
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return scheme.colors[(h >>> 0) % scheme.colors.length];
}
