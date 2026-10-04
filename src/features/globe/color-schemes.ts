import type { PolityProps } from '@alexs-atlas/borders';

/**
 * Paste period-specific colour data here.
 *
 * `fixed` accepts either current Alex's Atlas ids (`ne:fra`, `clio:…`) or the
 * display names used by the old palette (`France`, `Ottoman Empire`, …).
 * `colors` is the fallback list for everything without a fixed match.
 */
export interface PastedColorScheme {
  name: string;
  /** First year that uses this scheme, inclusive. Keep schemes in ascending order. */
  fromYear: number;
  colors: readonly string[];
  fixed: Readonly<Record<string, string>>;
}

// ---- Paste the pre-1900 scheme from the previous commit here ----------------------

const PRE_1900_COLORS = [
  '#3e7abd', '#71960b', '#9c6064', '#5e7537', '#ec9f59', '#598cb0', '#6566a3',
  '#db7c8b', '#7c8ca2', '#d5844c', '#689447', '#a4d97f', '#358c49', '#80aa3f',
] as const;

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

// ---- Paste the 1900-onwards scheme from the previous commit here ------------------

const FROM_1900_COLORS = [
    '#7ab361', '#c28c56', '#c8641f', '#5096b3', '#5c5cc5', '#9a4574', '#c3959b',
  '#d26a2f', '#699356', '#afa26c', '#7c8ca2', '#bb4f56', '#459dd0', '#8e4fc8',
] as const;

const FROM_1900_FIXED: Readonly<Record<string, string>> = {
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

/** Add more periods here in ascending `fromYear` order if needed. */
export const PASTED_COLOR_SCHEMES: readonly PastedColorScheme[] = [
  {
    name: 'pre-1900',
    fromYear: Number.NEGATIVE_INFINITY,
    colors: PRE_1900_COLORS,
    fixed: PRE_1900_FIXED,
  },
  {
    name: '1900-onwards',
    fromYear: 1900,
    colors: FROM_1900_COLORS,
    fixed: FROM_1900_FIXED,
  },
];

type SchemePolity = Pick<PolityProps, 'power' | 'pid' | 'c'> &
  Partial<Pick<PolityProps, 'name' | 'subjecto'>>;

/**
 * The previous palette used display names, while Alex's Atlas uses stable ids.
 * Bridge the major continuous identities so a period name such as "French Third
 * Republic" (and its colonies, whose `power` is the French group id) can still
 * find the pasted `France` entry.
 */
const LEGACY_FIXED_KEY_BY_ID: Readonly<Record<string, string>> = {
  'ne:gbr': 'United Kingdom',
  'clio:group-british-empire': 'United Kingdom',
  'clio:kingdom-of-great-britain': 'Great Britain',
  'clio:group-kingdom-of-england': 'England',
  'clio:kingdom-of-england': 'England',
  'clio:commonwealth-of-england': 'England',
  'clio:english-colonial-empire': 'England',
  'ne:can': 'Canada',
  'clio:canada': 'Canada',

  'ne:fra': 'France',
  'clio:group-kingdom-of-france': 'France',
  'clio:france-antarctique': 'France',
  'clio:french-india': 'France',
  'clio:group-french-first-republic': 'France',
  'clio:group-french-directory': 'France',
  'clio:group-french-consulate': 'France',
  'clio:french-consulate': 'France',
  'clio:french-louisiana': 'France',
  'clio:group-first-french-empire': 'France',
  'clio:first-french-empire': 'France',
  'clio:first-french-colonial-empire': 'France',
  'clio:group-bourbon-kingdom-of-france': 'France',
  'clio:group-french-second-republic': 'France',
  'clio:group-second-french-empire': 'France',
  'clio:group-french-third-republic': 'France',
  'clio:french-third-republic': 'France',
  'clio:group-vichy-france': 'France',
  'clio:vichy-france': 'France',
  'clio:group-french-fourth-republic': 'France',

  'ne:usa': 'United States',
  'clio:united-states-of-america': 'United States',
  'ne:esp': 'Spain',
  'clio:group-spanish-empire': 'Spain',
  'clio:first-spanish-republic': 'Spain',
  'clio:second-spanish-republic': 'Spain',
  'clio:francoist-spain': 'Spain',
  'ne:prt': 'Portugal',
  'clio:group-portuguese-empire': 'Portugal',
  'clio:portuguese-republic': 'Portugal',
  'ne:ita': 'Italy',
  'clio:kingdom-of-italy': 'Italy',
  'ne:nld': 'Netherlands',
  'clio:group-dutch-republic': 'Netherlands',
  'clio:group-netherlands': 'Netherlands',

  'ne:deu': 'Germany',
  'clio:german-empire': 'Germany',
  'clio:weimar-republic': 'Germany',
  'clio:nazi-germany': 'Germany',
  'clio:duchy-of-prussia': 'Prussia',
  'clio:brandenburg-prussia': 'Prussia',
  'clio:kingdom-of-prussia': 'Prussia',
  'ne:aut': 'Austria',
  'clio:group-habsburg-monarchy': 'Austria',
  'clio:austrian-empire': 'Austrian Empire',
  'clio:austria-hungary': 'Austria Hungary',

  'ne:tur': 'Turkey',
  'clio:ottoman-empire': 'Ottoman Empire',
  'clio:ottoman-tripolitania': 'Ottoman Empire',
  'clio:republic-of-turkey': 'Turkey',
  'ne:rus': 'Russia',
  'clio:grand-principality-of-moscow': 'Muscovy',
  'clio:tsardom-of-russia': 'Russia',
  'clio:russian-empire': 'Russian Empire',
  'clio:russian-republic': 'Russia',
  'ovr:soviet-union': 'USSR',
  'clio:republics-of-the-soviet-union': 'USSR',
  'clio:union-of-soviet-socialist-republics': 'USSR',

  'clio:ming-dynasty': 'Ming',
  'clio:qing-dynasty': 'Qing',
  'clio:republic-of-china': 'Republic of China',
  'clio:kuomintang': 'Republic of China',
  'ovr:republic-of-china': 'Republic of China',
  'ne:twn': 'Republic of China',
  'ne:chn': 'China',
  'clio:chinese-communists': 'China',
  'ne:ind': 'India',
  'ne:jpn': 'Japan',
  'clio:tokugawa-shogunate': 'Tokugawa shogunate',
  'clio:empire-of-japan': 'Imperial Japan',
  'ne:swe': 'Sweden',
  'clio:kingdom-of-sweden': 'Sweden',
  'clio:swedish-empire': 'Sweden',
  'ne:dnk': 'Denmark',
  'clio:group-kingdom-of-denmark': 'Denmark',
  'clio:denmark-norway': 'Denmark-Norway',
  'ne:pol': 'Poland',
  'clio:polish-lithuanian-commonwealth': 'Polish–Lithuanian Commonwealth',
  'ne:bra': 'Brazil',
  'clio:empire-of-brazil': 'Brazil',
  'clio:brazilian-republic': 'Brazil',
};

function schemeFor(year: number): PastedColorScheme | undefined {
  let selected: PastedColorScheme | undefined;
  for (const scheme of PASTED_COLOR_SCHEMES) {
    if (year < scheme.fromYear) break;
    selected = scheme;
  }
  return selected;
}

/** Returns undefined while a paste area is empty, preserving the current map colours. */
export function pastedColorFor(p: SchemePolity, year?: number): string | undefined {
  if (year === undefined || !Number.isFinite(year)) return undefined;
  const scheme = schemeFor(year);
  if (!scheme) return undefined;

  for (const key of [p.power, p.pid, p.subjecto, p.name]) {
    if (!key) continue;
    const fixed = scheme.fixed[key];
    if (fixed) return fixed;
  }

  for (const id of [p.power, p.pid]) {
    const legacyKey = LEGACY_FIXED_KEY_BY_ID[id];
    if (!legacyKey) continue;
    const fixed = scheme.fixed[legacyKey];
    if (fixed) return fixed;
  }

  if (scheme.colors.length === 0) return undefined;
  const slot = Number.isFinite(p.c) ? Math.trunc(p.c) : 0;
  return scheme.colors[((slot % scheme.colors.length) + scheme.colors.length) % scheme.colors.length];
}
