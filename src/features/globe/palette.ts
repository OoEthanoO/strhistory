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

// Selected recurring `color1` colours from the supplied pre-1900 data.
// These provide fallbacks for snapshot polities without a named match below.
const PRE_1900_COLORS = [
  '#3e7abd', '#71960b', '#9c6064', '#5e7537', '#ec9f59', '#598cb0', '#6566a3',
  '#db7c8b', '#7c8ca2', '#d5844c', '#689447', '#a4d97f', '#358c49', '#80aa3f',
] as const;

// Converted from the supplied 1900 country-colour data's D01-D14 RGB fills.
// These provide varied fallbacks for polities without a named colour below.
const MODERN_COLORS = [
  '#7ab361', '#c28c56', '#c8641f', '#5096b3', '#5c5cc5', '#9a4574', '#c3959b',
  '#d26a2f', '#699356', '#afa26c', '#7c8ca2', '#bb4f56', '#459dd0', '#8e4fc8',
] as const;

/** Land with no recorded polity. */
export const UNCLAIMED = '#3a3931';
export const OCEAN = '#0c1a2b';
export const LAND_BASE = '#34332c';

// Active named entries from the supplied pre-1900 data, using `color1` as
// requested. Additional keys are snapshot spelling or title aliases for the
// same polity; they deliberately share the extracted colour.
const PRE_1900_FIXED: Readonly<Record<string, string>> = {
  Sweden: '#0852a5',
  'Sweden–Norway': '#0852a5',
  Denmark: '#be4646',
  'Denmark-Norway': '#be4646',
  Finland: '#b68664',
  'Grand Duchy of Finland (Russia)': '#b68664',
  Norway: '#75a5bc',
  Holstein: '#dc969e',
  Albania: '#b50014',
  Bosnia: '#f0a782',
  'Bosnia-Herzegovina': '#f0a782',
  Bulgaria: '#746b8c',
  Croatia: '#685ef7',
  Cyprus: '#f5c81e',
  Greece: '#090967',
  Montenegro: '#276c8c',
  Serbia: '#a64839',
  Hungary: '#98555c',
  'Kingdom of Hungary': '#98555c',
  'Imperial Hungary': '#98555c',
  Moldavia: '#889d17',
  Moldova: '#889d17',
  Wallachia: '#a17e80',
  'Principality of Wallachia': '#a17e80',
  Transylvania: '#d3cfad',
  Livonia: '#140e96',
  'Livonian Order': '#7d1e64',
  'Ottoman Empire': '#7ecb78',
  England: '#c11a0e',
  'Angevin Empire': '#6e008c',
  'Great Britain': '#990000',
  UK: '#990000',
  'United Kingdom': '#990000',
  'United Kingdom of Great Britain and Ireland': '#990000',
  'United Kingdom of Netherlands': '#dc8a39',
  Scotland: '#c7af0c',
  Ireland: '#709669',
  'Kingdom of Ireland': '#709669',
  Iceland: '#2b3c75',
  'Icelandic Commonwealth': '#2b3c75',
  Wales: '#757fae',
  Lithuania: '#9a4574',
  Poland: '#c55c6a',
  'Poland-Lithuania': '#b0516f',
  'Polish–Lithuanian Commonwealth': '#b0516f',
  Prussia: '#003153',
  'Teutonic Order': '#666968',
  'Teutonic Knights': '#666968',
  Brittany: '#766397',
  Britany: '#766397',
  Burgundy: '#941e46',
  Burgandy: '#941e46',
  Corsica: '#6ab22e',
  France: '#1432d2',
  'Kingdom of France': '#1432d2',
  Anhalt: '#cb5d7c',
  Brandenburg: '#7b5a5a',
  Germany: '#4b8287',
  Austria: '#dcdcdc',
  'Habsburg Austria': '#dcdcdc',
  'Austrian Empire': '#dcdcdc',
  'Austria Hungary': '#efefef',
  'Holy Roman Empire': '#96b1a1',
  Hamburg: '#e35f07',
  Hanover: '#a4d97f',
  Oldenburg: '#938276',
  Palatinate: '#39978e',
  Saxony: '#9b93b4',
  Switzerland: '#997a6c',
  'Swiss Confederation': '#997a6c',
  Castille: '#c1ab08',
  Castile: '#c1ab08',
  Castilla: '#c1ab08',
  Portugal: '#286e8c',
  Spain: '#e7b50c',
  Italy: '#7dab54',
  Parma: '#80ca81',
  Sardinia: '#7592a7',
  'Kingdom of Sardinia': '#7592a7',
  'Sardinia-Piedmont': '#61d1fb',
  Savoy: '#ebc4e7',
  'Savoy-Piedmont': '#61d1fb',
  Sicily: '#49984c',
  'Kingdom of the Two Sicilies': '#9a999d',
  'Papal States': '#d3dcb2',
  Venice: '#36a79c',
  Venetia: '#36a79c',
  Luxembourg: '#358c49',
  Netherlands: '#dc8a39',
  'Dutch Republic': '#dc8a39',
  Holland: '#9c6064',
  Armenia: '#911e4b',
  Pskov: '#527b5f',
  Polotsk: '#10719b',
  'Principality of Polotsk': '#10719b',
  Muscovy: '#ceb561',
  'Grand Duchy of Moscow': '#ceb561',
  'Tsardom of Muscovy': '#ceb561',
  Russia: '#608350',
  'Russian Empire': '#608350',
  Astrakhan: '#1a1b9a',
  'Astrakhan Khanate': '#1a1b9a',
  Sibir: '#8b8aa0',
  'Khanate of Sibir': '#8b8aa0',

  Brazil: '#81b17d',
  'Kingdom of Brazil': '#81b17d',
  'Viceroyalty of Brazil': '#81b17d',
  Canada: '#5e7537',
  Chile: '#ec9f59',
  Colombia: '#598cb0',
  'Viceroyalty of New Granada': '#598cb0',
  Louisiana: '#903435',
  Mexico: '#db7c8b',
  'Viceroyalty of New Spain': '#db7c8b',
  Peru: '#7c8ca2',
  'Viceroyalty of Peru': '#7c8ca2',
  Quebec: '#c28c56',
  'United States': '#459dd0',
  'United States of America': '#459dd0',
  'United Provinces of the Río de la Plata': '#6566a3',

  Afghanistan: '#668034',
  Annam: '#ba0e5c',
  Aceh: '#5889ac',
  Ayutthaya: '#3c9846',
  Pegu: '#8cd2a0',
  Ainu: '#c9c57c',
  Assam: '#a3054d',
  Berar: '#1acf51',
  Bhutan: '#5db44c',
  Bijapur: '#287942',
  Multan: '#5f8bd6',
  Gondwana: '#e09271',
  Gujarat: '#e7e06b',
  Carnatic: '#e84f8e',
  Mysore: '#ecf2f3',
  Orissa: '#d26a2f',
  Oudh: '#7ab361',
  Punjab: '#bb4f56',
  Air: '#1e1fa2',
  Korea: '#1a35b1',
  Japan: '#c2353c',
  'Imperial Japan': '#c2353c',
  'Tokugawa shogunate': '#2f5d50',
  'Japan (Warring States)': '#c2353c',
  Ming: '#b38068',
  'Ming Empire': '#b38068',
  'Ming Chinese Empire': '#b38068',
  Qing: '#ed9812',
  'Qing Empire': '#ed9812',
  Manchu: '#a58439',
  'Manchu Empire': '#a58439',
  'Mongol Empire': '#82b4f0',
  Mongols: '#82b4f0',
  'Great Khanate': '#6c9941',
  Khmer: '#7fb43c',
  'Khmer Empire': '#7fb43c',
  'Lan Na': '#4a5c80',
  'Luang Prabang': '#5d9358',
  Mataram: '#e3a25e',
  Ryukyu: '#5a8a85',
  Sulu: '#59a490',
  Tonkin: '#51907e',
  Vientiane: '#97ae1c',
  Mughal: '#216030',
  'Mughal Empire': '#216030',
  Oirat: '#ccb8b1',
  'Oirat Confederation': '#ccb8b1',
  Chagatai: '#575c68',
  'Chagatai Khanate': '#575c68',
  Kazan: '#616687',
  'Kazan Khanate': '#616687',
  Timurid: '#d50027',
  'Timurid Empire': '#d50027',
  'Timurid Emirates': '#d50027',
  Kazakh: '#cad9aa',
  'Quazaq Khanate': '#cad9aa',
  Khiva: '#d2af3c',
  'Khiva Khanate': '#d2af3c',
  Delhi: '#9dc82a',
  'Sultanate of Delhi': '#9dc82a',
  'Mysore (Indian princely state)': '#ecf2f3',
  'Byzantine Empire': '#952d66',
  Ukraine: '#7cb797',
  Yemen: '#6a262c',
  Oman: '#628699',
  Chinook: '#790a0f',
  Rwanda: '#d5a012',
  'Great Zimbabwe': '#ffd300',
  Buganda: '#1515e3',
  Bunyoro: '#ae1842',
  Kuba: '#9f3cbd',
  Luba: '#61d1fb',
  Nkore: '#7cd479',
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
  Russia: '#608350',
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

/**
 * Add schemes in ascending `fromYear` order. The last matching entry wins, so
 * another period can be introduced by adding one object at its starting year.
 */
export const COLOR_SCHEMES: readonly PolityColorScheme[] = [
  { name: 'pre-1900', fromYear: Number.NEGATIVE_INFINITY, colors: PRE_1900_COLORS, fixed: PRE_1900_FIXED },
  { name: 'modern', fromYear: 1900, colors: MODERN_COLORS, fixed: MODERN_FIXED },
];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/**
 * Adjust a hex colour's HSL saturation and lightness by percentage points.
 * Accepts #RGB[A] and #RRGGBB[AA], clamps both results to 0–100%, and
 * preserves an alpha channel when one is supplied.
 */
function adjustHexColor(
  color: string,
  saturationAdjustment: number,
  lightnessAdjustment: number,
): string {
  if (!Number.isFinite(saturationAdjustment) || !Number.isFinite(lightnessAdjustment)) {
    throw new Error('Colour adjustments must be finite numbers');
  }

  const match = /^#?([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(color.trim());
  if (!match) throw new Error(`Invalid HEX colour: ${color}`);

  const expanded = match[1].length <= 4
    ? [...match[1]].map((digit) => digit + digit).join('')
    : match[1].toLowerCase();
  const alpha = expanded.length === 8 ? expanded.slice(6, 8) : '';
  const red = Number.parseInt(expanded.slice(0, 2), 16) / 255;
  const green = Number.parseInt(expanded.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(expanded.slice(4, 6), 16) / 255;
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  let hue = 0;
  let saturation = 0;
  let lightness = (maximum + minimum) / 2;

  if (delta !== 0) {
    saturation = delta / (1 - Math.abs(2 * lightness - 1));
    if (maximum === red) hue = 60 * (((green - blue) / delta) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / delta + 2);
    else hue = 60 * ((red - green) / delta + 4);
  }

  hue = (hue + 360) % 360;
  saturation = clamp(saturation + (saturation * saturationAdjustment / 100), 0, 1);
  lightness = clamp(lightness + (lightness * lightnessAdjustment / 100), 0, 1);

  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const intermediate = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  let adjustedRed = 0;
  let adjustedGreen = 0;
  let adjustedBlue = 0;

  if (hue < 60) [adjustedRed, adjustedGreen] = [chroma, intermediate];
  else if (hue < 120) [adjustedRed, adjustedGreen] = [intermediate, chroma];
  else if (hue < 180) [adjustedGreen, adjustedBlue] = [chroma, intermediate];
  else if (hue < 240) [adjustedGreen, adjustedBlue] = [intermediate, chroma];
  else if (hue < 300) [adjustedRed, adjustedBlue] = [intermediate, chroma];
  else [adjustedRed, adjustedBlue] = [chroma, intermediate];

  const toHex = (value: number): string =>
    Math.round(clamp(value + offset, 0, 1) * 255).toString(16).padStart(2, '0');
  return `#${toHex(adjustedRed)}${toHex(adjustedGreen)}${toHex(adjustedBlue)}${alpha}`;
}

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
  let fixed = scheme.fixed[key];
  if (fixed) {
    fixed = adjustHexColor(fixed, -60, -10);
    return fixed;
  }
  // FNV-1a
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let color = scheme.colors[(h >>> 0) % scheme.colors.length];
  color = adjustHexColor(color, -60, -10);
  return color
}
