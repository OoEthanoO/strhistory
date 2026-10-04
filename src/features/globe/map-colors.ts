// The globe's map colours (from the Alex's Atlas reference site, apps/site/src/map-colors.ts),
// in the manner of a grand-strategy game's political map
// (Victoria 3): the major powers in their traditional colours (Britain red, France blue,
// Russia green, …) through every era of the data, every other polity in one of twelve
// softer colours by its colour slot `c`, a charcoal sea and stone-grey land that
// no polity held. Passed to the globe as `theme` and `palette`; the key and the search
// list draw their swatches from the same functions, so they match the map.
//
// All polity colours pass through the tunable HSL adjustment in color-schemes.ts.
// Pasted period schemes remain available through USE_PASTED_COLOR_SCHEMES below.
//
// How the original base colours were chosen (before HSL adjustment, OKLab ΔE×100),
// checked against the borders
// that actually occur (every pair of colour keys sharing an edge in any of the 593
// frames): neighbouring identity colours are at least 9.9 apart (Italy/Russia, at their
// Tianjin concessions; Ottoman/Russia 10.1, Britain/Denmark 11.6); a minor polity is at
// least 8.0 from any neighbour (the slots were tuned on those pairs, within 15° of
// their hues). The slots are at least 10 apart (10.2 among slots 0–5, which the
// pipeline's adjacency colouring uses most; 8.1 under protan/deutan simulation); every
// fill is at least 11 from the sea and 9.5 from the land.
import type { PolityProps } from '@alexs-atlas/borders';
import { blendOver, resolveTheme, type GlobeTheme } from '@alexs-atlas/globe';
import { adjustSchemeColor, pastedColorFor } from './color-schemes';
import { COUNTRY_COLORS } from './country-colors';

/** Opt in to the retained pasted period schemes; the Atlas palette is the default. */
export const USE_PASTED_COLOR_SCHEMES = false;

/** Globe theme, layered over the package defaults. */
export const MAP_THEME: Partial<GlobeTheme> = {
  // A charcoal sea, and Victoria 3's grey for decentralized, unclaimed land.
  ocean: '#353535',
  lake: '#353535',
  land: '#e3e0d9',
  // No coastline, lake shore or shared border lines: each polity has its own outline
  // instead, inside its edge, a shade deeper than its fill (like pigment pooling at the
  // edge of a watercolour wash).
  coast: 'rgba(0, 0, 0, 0)',
  lakeShore: 'rgba(0, 0, 0, 0)',
  border: 'rgba(0, 0, 0, 0)',
  edge: 0.2,
  // Dashes and hatching in dark ink on the paper-light map; names in each polity's own
  // border colour (curved labels), set off by a soft dark glow instead of a hard outline
  // (the globe caps its width and blur to the type size, so it stays a glow at 9 px).
  approximate: 'rgba(48, 40, 32, 0.6)',
  hatch: 'rgba(48, 40, 32, 0.38)',
  label: '#2b2621',
  labelHalo: 'rgba(0, 0, 0, 0.45)',
  labelHaloWidth: 2,
  labelHaloBlur: 2,
  labelOverlay: '#4a3c2c',
  // Hovering lightens the fill but leaves the outline alone; the selected polity's
  // outline turns white.
  hover: 'rgba(0, 0, 0, 0)',
  selection: '#ffffff',
  // Opaque colours as given (no blend over the land colour).
  fillBlend: 1,
  // No atmosphere: no whitish haze at the globe's edge when zoomed out.
  atmosphere: 0,
};

/** The resolved theme (package defaults < MAP_THEME), for swatches. */
export const MAP_THEME_RESOLVED: GlobeTheme = resolveTheme(MAP_THEME);

/**
 * Every other polity: one colour per slot `PolityProps.c` (the pipeline gives
 * neighbours different slots and keeps a power's slot stable across years).
 */
export const SLOT_PALETTE: readonly string[] = Object.freeze([
  '#9f824c', // 0 ochre
  '#52beb3', // 1 jade
  '#9974b3', // 2 violet
  '#c7e49c', // 3 pale lime
  '#8aacec', // 4 cornflower
  '#f8c2fd', // 5 pink lilac
  '#2a98a7', // 6 lagoon
  '#ffc2b1', // 7 peach
  '#b8a558', // 8 olive
  '#accffe', // 9 sky
  '#d5a2dd', // 10 orchid
  '#83ede5', // 11 aqua
]);

/**
 * Identity colours by colour key (`PolityProps.power`: a colony shares its empire's
 * key). Explicit keys, not patterns: rival factions of one country (Spanish
 * Nationalists, Free French, Southern Ming, Pro-Habsburg Spain, Japan's warring
 * states) keep slot colours, so a civil war or a split stays visible.
 */
const IDENTITY: readonly (readonly [color: string, keys: readonly string[]])[] = [
  // Britain and England: pink
  ['#e89fb3', ['ne:gbr', 'clio:group-british-empire', 'clio:kingdom-of-great-britain', 'clio:group-kingdom-of-england', 'clio:kingdom-of-england', 'clio:commonwealth-of-england', 'clio:english-colonial-empire']],
  // Canada: red
  ['#cd6058', ['ne:can', 'clio:canada']],
  // France: blue
  [
    '#6a8ed5',
    [
      'ne:fra',
      'clio:group-kingdom-of-france',
      'clio:france-antarctique',
      'clio:french-india',
      'clio:group-french-first-republic',
      'clio:group-french-directory',
      'clio:group-french-consulate',
      'clio:french-consulate',
      'clio:french-louisiana',
      'clio:group-first-french-empire',
      'clio:first-french-empire',
      'clio:first-french-colonial-empire',
      'clio:group-bourbon-kingdom-of-france',
      'clio:group-french-second-republic',
      'clio:group-second-french-empire',
      'clio:group-french-third-republic',
      'clio:french-mandate-for-syria-and-lebanon',
      'clio:group-vichy-france',
      'clio:group-french-fourth-republic',
    ],
  ],
  // The United States: light blue
  ['#8cbde8', ['ne:usa', 'clio:united-states-of-america']],
  // Spain and Castile: yellow
  ['#ebe192', ['ne:esp', 'clio:kingdom-of-castile', 'clio:crown-of-castile', 'clio:group-spanish-empire', 'clio:first-spanish-republic', 'clio:second-spanish-republic', 'clio:francoist-spain']],
  // Portugal: deep green
  ['#358e61', ['ne:prt', 'clio:county-of-portugal', 'clio:kingdom-of-portugal', 'clio:group-portuguese-empire', 'clio:portuguese-colonies', 'clio:portuguese-republic']],
  // Italy: green
  ['#98cb8d', ['ne:ita', 'clio:kingdom-of-italy', 'clio:italian-africa']],
  // The Netherlands: orange
  ['#f99e65', ['ne:nld', 'clio:group-dutch-republic', 'clio:new-netherland', 'clio:group-batavian-republic', 'clio:sovereign-principality-of-the-united-netherlands', 'clio:group-netherlands', 'clio:netherlands-antilles']],
  // Prussia and Germany: tan (as in Victoria 3)
  ['#cbbf9f', ['ne:deu', 'clio:duchy-of-prussia', 'clio:brandenburg-prussia', 'clio:kingdom-of-prussia', 'clio:german-empire', 'clio:german-africa', 'clio:weimar-republic', 'clio:nazi-germany']],
  // Austria and the Habsburgs: white
  ['#ede8d9', ['ne:aut', 'ovr:allied-occupied-austria', 'clio:group-habsburg-monarchy', 'clio:austrian-empire', 'clio:austria-hungary', 'clio:republic-of-austria']],
  // The Ottoman Empire and Turkey: teal
  ['#75c0c0', ['ne:tur', 'clio:ottoman-empire', 'clio:ottoman-tripolitania', 'clio:republic-of-turkey']],
  // Russia (Muscovy, the Tsardom, the Empire, 1917 and since 1991): green
  ['#6aa36c', ['ne:rus', 'clio:grand-principality-of-moscow', 'clio:tsardom-of-russia', 'clio:russian-empire', 'clio:russian-republic']],
  // The Soviet Union: deep red
  ['#a74449', ['ovr:soviet-union', 'clio:republics-of-the-soviet-union', 'clio:union-of-soviet-socialist-republics']],
  // China (the Ming, the Qing, the Republic, also on Taiwan): yellow
  ['#efc469', ['clio:ming-dynasty', 'clio:qing-dynasty', 'clio:republic-of-china', 'clio:kuomintang', 'ovr:republic-of-china', 'ne:twn']],
  // The People's Republic of China (and the Chinese Soviet Republic before it): red
  ['#e37e6a', ['ne:chn', 'clio:chinese-communists']],
  // India since 1947 (British India is Britain's): saffron
  ['#ebb16c', ['ne:ind']],
  // Japan: plum
  ['#bf8ab9', ['ne:jpn', 'clio:asuka-japan', 'clio:nara-japan', 'clio:heian-japan', 'clio:kamakura-shogunate', 'clio:ashikaga-shogunate', 'clio:tokugawa-shogunate', 'clio:empire-of-japan']],
  // Sweden (with Norway 1815–1904): blue
  ['#3d91b3', ['ne:swe', 'clio:kingdom-of-sweden', 'clio:swedish-empire', 'clio:new-sweden', 'clio:united-kingdoms-of-sweden-and-norway']],
  // Denmark: dusky red
  ['#ae6976', ['ne:dnk', 'clio:group-kingdom-of-denmark', 'clio:denmark-norway', 'clio:danish-india', 'clio:denmark']],
  // Poland (and Poland–Lithuania): rose
  [
    '#ce84a7',
    ['ne:pol', 'clio:group-polish-lithuania-kingdom', 'clio:group-kingdom-of-poland', 'clio:group-duchies-of-poland', 'clio:polish-lithuanian-commonwealth', 'clio:duchy-of-warsaw', 'clio:polish-armed-forces', 'clio:second-polish-republic'],
  ],
  // Brazil (Portuguese Brazil is Portugal's): green
  ['#80b761', ['ne:bra', 'clio:empire-of-brazil', 'clio:brazilian-republic', 'clio:unitary-state-of-brazil']],
];

const BY_KEY: ReadonlyMap<string, string> = new Map(IDENTITY.flatMap(([color, keys]) => keys.map((k) => [k, color] as const)));

/** The active, adjusted colours of Britain, France, Italy and Spain for the map key. */
export function keyColorsFor(year?: number): readonly string[] {
  return ['ne:gbr', 'ne:fra', 'ne:ita', 'ne:esp'].map((key) =>
    fillColor({ power: key, pid: key, c: 0 }, year),
  );
}

/** A polity's palette colour, adjusted once before the globe blends it over land. */
export function mapColor(
  p: Pick<PolityProps, 'power' | 'pid' | 'c'> & Partial<Pick<PolityProps, 'name' | 'subjecto'>>,
  year?: number,
): string {
  if (USE_PASTED_COLOR_SCHEMES) {
    const pasted = pastedColorFor(p, year);
    if (pasted) return pasted;
  }
  const key = p.power || p.pid;
  // A classic colour, else the country's flag colour (country-colors.ts), else a slot.
  const identity = BY_KEY.get(key) ?? COUNTRY_COLORS[key];
  if (identity) return adjustSchemeColor(identity);
  const n = SLOT_PALETTE.length;
  const slot = Number.isFinite(p.c) ? ((Math.trunc(p.c) % n) + n) % n : 0;
  return adjustSchemeColor(SLOT_PALETTE[slot]!);
}

/** A polity's colour as the globe draws it (blended over the land colour at `fillBlend`). */
export function fillColor(
  p: Pick<PolityProps, 'power' | 'pid' | 'c'> & Partial<Pick<PolityProps, 'name' | 'subjecto'>>,
  year?: number,
): string {
  return blendOver(mapColor(p, year), MAP_THEME_RESOLVED.land, MAP_THEME_RESOLVED.fillBlend);
}
