// Builds the MapLibre style pieces in code — no style URL, no sprite, no glyph
// server (labels are drawn locally from a CSS font family). Pure functions:
// the output is plain JSON that unit tests inspect.
//
// Layer order (AGENTS.md §5.5), bottom to top:
//   ocean background → base land (until the first frame) → tier-0 fills →
//   each polity's own outline (theme.edge) → borders → approximate-border dashes →
//   tier-1 tint, hatch, dashed outline → lakes → coastline → labels →
//   hover/selection outlines. A line layer whose theme colour is fully transparent is
//   not drawn at all (visibility none).
import { isTransparent } from './color.js';

import { blendPalette, edgePalette, hoverPalette, overlayLinePalette, slotColorExpression } from './palette.js';
import type { GlobeTheme, ReliefOptions } from './types.js';

/** Loose JSON shapes (MapLibre's own spec types are not re-exported by maplibre-gl). */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
export interface LayerSpec {
  id: string;
  type: 'background' | 'fill' | 'line' | 'symbol' | 'raster';
  source?: string;
  filter?: unknown[];
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
  minzoom?: number;
  maxzoom?: number;
}
export interface SourceSpec {
  type: 'geojson' | 'raster';
  data?: unknown;
  tiles?: string[];
  tileSize?: number;
  minzoom?: number;
  promoteId?: string;
  maxzoom?: number;
  tolerance?: number;
  buffer?: number;
  attribution?: string;
}

/** Every id this module adds to a map, derived from one prefix. */
export interface BorderIds {
  prefix: string;
  // sources
  baseLandSrc: string;
  frameSrc: string;
  coastSrc: string;
  lakesSrc: string;
  highlightSrc: string;
  /** Relief tiles (`relief`). */
  reliefSrc: string;
  /** Curved-label arcs (`labelMode: 'curved'`). */
  labelArcsSrc: string;
  // images
  hatchImage: string;
  // layers in drawing order
  baseLand: string;
  fill: string;
  edge: string;
  relief: string;
  border: string;
  approx: string;
  overlayTint: string;
  overlayHatch: string;
  overlayLine: string;
  lakes: string;
  lakeShore: string;
  coast: string;
  labels: string;
  hoverLine: string;
  selectGlow: string;
  selectLine: string;
}

export function borderIds(prefix = 'ca-'): BorderIds {
  const p = prefix;
  return {
    prefix: p,
    baseLandSrc: `${p}base-land`,
    frameSrc: `${p}frame`,
    coastSrc: `${p}coast`,
    lakesSrc: `${p}lakes`,
    highlightSrc: `${p}highlight`,
    reliefSrc: `${p}relief`,
    labelArcsSrc: `${p}label-arcs`,
    hatchImage: `${p}hatch`,
    baseLand: `${p}base-land`,
    fill: `${p}fill`,
    edge: `${p}edge`,
    relief: `${p}relief`,
    border: `${p}border`,
    approx: `${p}border-approx`,
    overlayTint: `${p}overlay-tint`,
    overlayHatch: `${p}overlay-hatch`,
    overlayLine: `${p}overlay-line`,
    lakes: `${p}lakes`,
    lakeShore: `${p}lake-shore`,
    coast: `${p}coast`,
    labels: `${p}labels`,
    hoverLine: `${p}hover-line`,
    selectGlow: `${p}select-glow`,
    selectLine: `${p}select-line`,
  };
}

/** Layer ids in drawing order (bottom → top); the relief layer only with `relief` (first when `under`). */
export function layerOrder(ids: BorderIds, o: { relief?: boolean; reliefUnder?: boolean } = {}): string[] {
  return [
    ...(o.relief && o.reliefUnder ? [ids.relief] : []),
    ids.baseLand,
    ids.fill,
    ids.edge,
    ...(o.relief && !o.reliefUnder ? [ids.relief] : []),
    ids.border,
    ids.approx,
    ids.overlayTint,
    ids.overlayHatch,
    ids.overlayLine,
    ids.lakes,
    ids.lakeShore,
    ids.coast,
    ids.labels,
    ids.hoverLine,
    ids.selectGlow,
    ids.selectLine,
  ];
}

export const EMPTY_FC = Object.freeze({ type: 'FeatureCollection', features: [] as unknown[] });

// ---- filters ----------------------------------------------------------------
const isPolygon = ['==', ['geometry-type'], 'Polygon'];
const isLine = ['==', ['geometry-type'], 'LineString'];
const isPoint = ['==', ['geometry-type'], 'Point'];

export const FILTERS = {
  tier0: ['all', isPolygon, ['==', ['get', 'tier'], 0]],
  tier0Polity: ['all', isPolygon, ['==', ['get', 'tier'], 0], ['!=', ['get', 'kind'], 'unclaimed']],
  tier0Approx: ['all', isPolygon, ['==', ['get', 'tier'], 0], ['==', ['get', 'precision'], 'approximate'], ['!=', ['get', 'kind'], 'unclaimed']],
  tier1: ['all', isPolygon, ['==', ['get', 'tier'], 1]],
  border: ['all', isLine, ['==', ['get', 'kind'], 'border']],
  coast: ['all', isLine, ['==', ['get', 'kind'], 'coast']],
  /**
   * One label per polity point; tiny polities appear only when zoomed in.
   * The area threshold (km²) keeps a polity ≳ 15 px wide at each integer zoom
   * (filters with ["zoom"] are evaluated per integer zoom).
   */
  /** Curved labels: arcs from BorderLayers, sized for the current zoom (`_px`, `_ls`). */
  labelArcs: ['all', isLine, ['has', '_label']],
  labels: [
    'all',
    isPoint,
    ['!=', ['get', 'kind'], 'unclaimed'],
    ['!=', ['to-string', ['get', 'name']], ''],
    ['>=', ['to-number', ['get', 'a'], 0], ['step', ['zoom'], 1.4e6, 1, 3.4e5, 2, 8.6e4, 3, 2.1e4, 4, 5.4e3, 5, 1.3e3, 6, 330, 7, 0]],
  ],
  hover: ['==', ['get', 'role'], 'hover'],
  select: ['==', ['get', 'role'], 'select'],
} as const;

/** log10 of the feature's area in km² (≥ 0). */
const logArea = ['log10', ['max', ['to-number', ['get', 'a'], 1], 1]];

/**
 * Label typography by area, shared by the style and the rim fade (rim.ts), which
 * estimates each label's box: text size per zoom as [log10 km², px] stops (~9 px for small
 * polities, ~16–21 px for empires), upper case from UPPERCASE_KM2, letter spacing (em) by
 * log10 area, line wrap at MAX_WIDTH_EM.
 */
export const LABEL_TYPE = {
  size: [
    [0, [[5, 9], [6, 11], [7, 14]]],
    [3, [[3.5, 10], [5, 12], [6, 14.5], [7, 17]]],
    [7, [[1, 11], [3, 13], [5, 17], [6.5, 21]]],
  ] as const,
  uppercaseKm2: 2.5e6,
  letterSpacing: [[5.5, 0.02], [6.6, 0.14]] as const,
  maxWidthEm: 7,
};

export interface BorderStyleContext {
  ids: BorderIds;
  theme: GlobeTheme;
  /** Base palette (one colour per slot) — ignored when `perFeatureColors` is true. */
  palette: readonly string[];
  /** True when colours come from a palette function: features carry `_fill`, `_hover`, `_line`, `_edge`. */
  perFeatureColors?: boolean;
  /** CSS font family for labels. */
  fontFamily?: string;
  labels?: boolean;
  /** 'curved': arcs from BorderLayers (`_px`, `_ls`, `_ink`), else label points. */
  labelMode?: 'point' | 'curved';
  /** Relief tiles drawn over the fills (layer `<prefix>relief`). */
  relief?: ReliefOptions;
  baseLand?: boolean;
  lakes?: boolean;
}

/** Splits a CSS font-family list into the `text-font` array MapLibre joins back with commas. */
export function fontStack(fontFamily: string | undefined): string[] {
  const fams = (fontFamily ?? 'sans-serif')
    .split(',')
    .map((f) => f.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
  return fams.length ? fams : ['sans-serif'];
}

/** Colour expressions for fills (`fill`), their hover variant, own outlines (`edge`) and tier-1 outlines. */
export function colorExpressions(ctx: BorderStyleContext): { fill: unknown; hover: unknown; edge: unknown; overlayLine: unknown } {
  const { theme } = ctx;
  if (ctx.perFeatureColors) {
    return {
      fill: ['case', ['==', ['get', 'kind'], 'unclaimed'], theme.land, ['to-color', ['coalesce', ['get', '_fill'], theme.land]]],
      hover: ['case', ['==', ['get', 'kind'], 'unclaimed'], theme.land, ['to-color', ['coalesce', ['get', '_hover'], theme.land]]],
      edge: ['to-color', ['coalesce', ['get', '_edge'], theme.border]],
      overlayLine: ['to-color', ['coalesce', ['get', '_line'], theme.hover]],
    };
  }
  const fills = blendPalette(ctx.palette, theme);
  const hovers = hoverPalette(fills, theme);
  return {
    fill: ['case', ['==', ['get', 'kind'], 'unclaimed'], theme.land, slotColorExpression(fills, theme.land)],
    hover: ['case', ['==', ['get', 'kind'], 'unclaimed'], theme.land, slotColorExpression(hovers, theme.land)],
    edge: slotColorExpression(edgePalette(fills, theme), theme.border),
    overlayLine: slotColorExpression(overlayLinePalette(ctx.palette), theme.hover),
  };
}

/** Line widths (px) of each polity's own outline (`theme.edge`) at zoom 0, 3 and 7. */
export const EDGE_WIDTH = [1.3, 2.2, 3.6] as const;

/** Sources (initially empty) for {@link borderLayers}. */
export function borderSources(ctx: Pick<BorderStyleContext, 'ids' | 'relief'>): Record<string, SourceSpec> {
  const { ids, relief } = ctx;
  return {
    ...(relief?.tiles.length
      ? { [ids.reliefSrc]: { type: 'raster' as const, tiles: [...relief.tiles], tileSize: relief.tileSize ?? 512, minzoom: 0, maxzoom: relief.maxzoom ?? 4 } }
      : {}),
    [ids.baseLandSrc]: { type: 'geojson', data: EMPTY_FC, maxzoom: 8 },
    // Polygons, border lines and label points of one frame in ONE source, so a year
    // change swaps all of them in the same tile update.
    // buffer 32 px (default 128): enough for fills and ≤ 3 px lines at tile edges and
    // ~15–20 % less tile work per year change (measured on the dev dataset).
    [ids.frameSrc]: { type: 'geojson', data: EMPTY_FC, promoteId: 'id', maxzoom: 9, buffer: 32 },
    // The coastline (~90 % of a frame's line vertices) has its own source: it is the
    // same in most frames of a chunk (the borders client then returns the identical
    // feature), so a year change usually leaves it alone.
    [ids.coastSrc]: { type: 'geojson', data: EMPTY_FC, maxzoom: 9, buffer: 32 },
    [ids.lakesSrc]: { type: 'geojson', data: EMPTY_FC, maxzoom: 8 },
    [ids.highlightSrc]: { type: 'geojson', data: EMPTY_FC, maxzoom: 9 },
    // Curved-label arcs: tiled at zoom 2 only (overscaled beyond) with a full-tile buffer,
    // so each arc lies whole in one tile and MapLibre places its label once, at the arc's
    // true centre (in a finely tiled source a 'line-center' label is lost wherever the
    // arc crosses a tile edge). No simplification: at zoom 2 it would turn the smooth arcs
    // into a few straight pieces whose corners exceed text-max-angle.
    [ids.labelArcsSrc]: { type: 'geojson', data: EMPTY_FC, promoteId: 'id', maxzoom: 2, buffer: 512, tolerance: 0 },
  };
}

/** The layers, bottom to top, in contract order. */
export function borderLayers(ctx: BorderStyleContext): LayerSpec[] {
  const { ids, theme } = ctx;
  const colors = colorExpressions(ctx);
  const hovered = ['boolean', ['feature-state', 'hover'], false];
  const vis = (on: boolean | undefined): Record<string, unknown> => ({ visibility: on === false ? 'none' : 'visible' });
  // Lines in a fully transparent theme colour are skipped, not drawn invisibly.
  const drawn = (color: string, on?: boolean): Record<string, unknown> => vis(on !== false && !isTransparent(color));
  const width = (z0: number, z3: number, z7: number): unknown[] => ['interpolate', ['linear'], ['zoom'], 0, z0, 3, z3, 7, z7];
  // With own outlines (theme.edge > 0) they sit inside each polity's edge (a positive
  // line-offset insets a polygon's outline), neighbours' outlines side by side; the
  // selection then replaces the selected polity's outline in place.
  const edges = theme.edge > 0;
  const [e0, e3, e7] = EDGE_WIDTH;

  const relief: LayerSpec | null = ctx.relief?.tiles.length
    ? {
        id: ids.relief,
        type: 'raster',
        source: ids.reliefSrc,
        paint: { 'raster-opacity': ctx.relief.opacity ?? 1, 'raster-fade-duration': 0, 'raster-resampling': 'linear' },
      }
    : null;

  return [
    // Relief `under` the land: drawn first, so the land and fills cover it (water only).
    ...(relief && ctx.relief?.under ? [relief] : []),
    {
      id: ids.baseLand,
      type: 'fill',
      source: ids.baseLandSrc,
      layout: vis(ctx.baseLand),
      paint: { 'fill-color': theme.land, 'fill-antialias': false },
    },
    {
      id: ids.fill,
      type: 'fill',
      source: ids.frameSrc,
      filter: [...FILTERS.tier0],
      // Large first, small on top (enclaves, microstates).
      layout: { 'fill-sort-key': ['-', 0, ['to-number', ['get', 'a'], 0]] },
      // No anti-aliasing: neighbouring fills share edges exactly; AA seams would show the land/ocean through.
      paint: { 'fill-color': ['case', hovered, colors.hover, colors.fill], 'fill-antialias': false },
    },
    {
      id: ids.edge,
      type: 'line',
      source: ids.frameSrc,
      filter: [...FILTERS.tier0Polity],
      layout: { ...vis(edges), 'line-join': 'round' },
      paint: { 'line-color': colors.edge, 'line-width': width(e0, e3, e7), 'line-offset': width(e0 / 2, e3 / 2, e7 / 2) },
    },
    ...(relief && !ctx.relief?.under ? [relief] : []),
    {
      id: ids.border,
      type: 'line',
      source: ids.frameSrc,
      filter: [...FILTERS.border],
      layout: { ...drawn(theme.border), 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': theme.border, 'line-width': width(0.45, 0.8, 1.5) },
    },
    {
      id: ids.approx,
      type: 'line',
      source: ids.frameSrc,
      filter: [...FILTERS.tier0Approx],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': theme.approximate, 'line-width': width(0.5, 0.8, 1.3), 'line-dasharray': [2, 2.5] },
    },
    {
      id: ids.overlayTint,
      type: 'fill',
      source: ids.frameSrc,
      filter: [...FILTERS.tier1],
      layout: { 'fill-sort-key': ['-', 0, ['to-number', ['get', 'a'], 0]] },
      paint: { 'fill-color': colors.fill, 'fill-opacity': ['case', hovered, Math.min(1, theme.overlayTint + 0.2), theme.overlayTint] },
    },
    {
      id: ids.overlayHatch,
      type: 'fill',
      source: ids.frameSrc,
      filter: [...FILTERS.tier1],
      paint: { 'fill-pattern': ids.hatchImage },
    },
    {
      id: ids.overlayLine,
      type: 'line',
      source: ids.frameSrc,
      filter: [...FILTERS.tier1],
      layout: { 'line-join': 'round' },
      paint: { 'line-color': colors.overlayLine, 'line-width': width(0.7, 1.0, 1.8), 'line-dasharray': [3, 2] },
    },
    {
      id: ids.lakes,
      type: 'fill',
      source: ids.lakesSrc,
      layout: vis(ctx.lakes),
      paint: { 'fill-color': theme.lake },
    },
    {
      id: ids.lakeShore,
      type: 'line',
      source: ids.lakesSrc,
      layout: drawn(theme.lakeShore, ctx.lakes),
      paint: { 'line-color': theme.lakeShore, 'line-width': width(0.3, 0.5, 1) },
    },
    {
      id: ids.coast,
      type: 'line',
      source: ids.coastSrc,
      filter: [...FILTERS.coast],
      layout: { ...drawn(theme.coast), 'line-join': 'round' },
      paint: { 'line-color': theme.coast, 'line-width': width(0.4, 0.7, 1.4) },
    },
    ctx.labelMode === 'curved'
      ? curvedLabelLayer(ctx, vis(ctx.labels), hovered)
      : {
      id: ids.labels,
      type: 'symbol',
      source: ids.frameSrc,
      filter: [...FILTERS.labels],
      layout: {
        ...vis(ctx.labels),
        'text-field': ['to-string', ['get', 'name']],
        'text-font': fontStack(ctx.fontFamily),
        // Size by area and zoom (LABEL_TYPE).
        'text-size': [
          'interpolate', ['linear'], ['zoom'],
          ...LABEL_TYPE.size.flatMap(([zoom, stops]) => [zoom, ['interpolate', ['linear'], logArea, ...stops.flat()]]),
        ],
        'text-transform': ['case', ['>=', ['to-number', ['get', 'a'], 0], LABEL_TYPE.uppercaseKm2], 'uppercase', 'none'],
        'text-letter-spacing': ['interpolate', ['linear'], logArea, ...LABEL_TYPE.letterSpacing.flat()],
        'text-max-width': LABEL_TYPE.maxWidthEm,
        'text-padding': 3,
        'symbol-sort-key': ['-', 0, ['to-number', ['get', 'a'], 0]],
        'symbol-z-order': 'source',
      },
      paint: {
        'text-color': ['case', ['==', ['get', 'tier'], 1], theme.labelOverlay, theme.label],
        'text-halo-color': theme.labelHalo,
        'text-halo-width': isTransparent(theme.labelHalo) ? 0 : (theme.labelHaloWidth ?? 1.3),
        'text-halo-blur': theme.labelHaloBlur ?? 0.4,
        // × feature-state 'edge' (0–1): labels fade out near the globe's rim, where they
        // would otherwise stick out into space (BorderLayers.updateEdgeFade).
        'text-opacity': ['*', ['case', hovered, 1, 0.92], ['coalesce', ['feature-state', 'edge'], 1]],
      },
    },
    {
      id: ids.hoverLine,
      type: 'line',
      source: ids.highlightSrc,
      filter: [...FILTERS.hover],
      layout: { ...drawn(theme.hover), 'line-join': 'round' },
      paint: { 'line-color': theme.hover, 'line-width': width(1.2, 1.6, 2.4), 'line-opacity': 0.9 },
    },
    {
      id: ids.selectGlow,
      type: 'line',
      source: ids.highlightSrc,
      filter: [...FILTERS.select],
      // No glow with own outlines: the selected polity's outline itself changes colour.
      layout: { ...drawn(theme.selection, !edges), 'line-join': 'round' },
      paint: { 'line-color': theme.selection, 'line-width': width(4, 5, 7), 'line-blur': 3, 'line-opacity': 0.4 },
    },
    {
      id: ids.selectLine,
      type: 'line',
      source: ids.highlightSrc,
      filter: [...FILTERS.select],
      layout: { ...drawn(theme.selection), 'line-join': 'round' },
      paint: edges
        ? { 'line-color': theme.selection, 'line-width': width(e0, e3, e7), 'line-offset': width(e0 / 2, e3 / 2, e7 / 2) }
        : { 'line-color': theme.selection, 'line-width': width(1.6, 2.2, 3), 'line-offset': 0 },
    },
  ];
}

/**
 * Curved labels (label-lines.ts): each name in capitals along its arc (`line-center`),
 * at the size `_px` and letter spacing `_ls` BorderLayers computed for the current zoom
 * (the map's scale up to fitZoom, growing more slowly beyond, at most maxPx; spread to
 * span most of the arc); MapLibre drops a label that does not fit its arc.
 */
/** Largest halo width and blur of curved labels, in em: together within the glyphs' distance field (~0.125 em). */
const HALO_WIDTH_EM = 0.07;
const HALO_BLUR_EM = 0.05;

export function curvedLabelLayer(ctx: BorderStyleContext, visibility: Record<string, unknown>, hovered: unknown): LayerSpec {
  const { ids, theme } = ctx;
  return {
    id: ids.labels,
    type: 'symbol',
    source: ids.labelArcsSrc,
    filter: [...FILTERS.labelArcs],
    layout: {
      ...visibility,
      'symbol-placement': 'line-center',
      // `_text`: the name, or its short form when the full name does not fit.
      'text-field': ['to-string', ['coalesce', ['get', '_text'], ['get', 'name']]],
      'text-font': fontStack(ctx.fontFamily),
      'text-transform': 'uppercase',
      'text-size': ['to-number', ['get', '_px'], 10],
      'text-letter-spacing': ['to-number', ['get', '_ls'], 0],
      // Our arcs turn at most 20° in all, so MapLibre's angle check is off (180°): on a globe
      // it subdivides lines at tile-grid crossings and rounds the vertices, and a crossing
      // next to a vertex leaves a micro-segment pointing anywhere, which dropped whole labels
      // (larger type checks a longer window, so big names went first: British Raj, Qing at
      // 85°). Its fit check stays.
      'text-max-angle': 180,
      'text-keep-upright': true,
      'text-rotation-alignment': 'map',
      'text-padding': 2,
      'symbol-sort-key': ['-', 0, ['to-number', ['get', 'a'], 0]],
      'symbol-z-order': 'source',
    },
    paint: {
      // Each name in its polity's own outline colour (`_ink`, from BorderLayers), outlined by the halo.
      'text-color': ['to-color', ['coalesce', ['get', '_ink'], theme.label]],
      'text-halo-color': theme.labelHalo,
      // A fully transparent halo colour means no outline at all. A themed halo (a glow) is
      // capped to its share of the type size: MapLibre draws halos from the glyphs' distance
      // field, which reaches only ~0.125 em beyond each letter, and clips anything wider to
      // the glyph's box (a light rectangle behind each letter at 9 px).
      'text-halo-width': isTransparent(theme.labelHalo) ? 0 : theme.labelHaloWidth == null ? 0.9 : ['min', theme.labelHaloWidth, ['*', HALO_WIDTH_EM, ['to-number', ['get', '_px'], 10]]],
      'text-halo-blur': theme.labelHaloBlur == null ? 0 : ['min', theme.labelHaloBlur, ['*', HALO_BLUR_EM, ['to-number', ['get', '_px'], 10]]],
      // × feature-state 'edge' (0–1): arcs fade out at the globe's rim (BorderLayers.updateEdgeFade).
      'text-opacity': ['*', ['case', hovered, 1, 0.9], ['coalesce', ['feature-state', 'edge'], 1]],
    },
  };
}

/** `sky` for the globe: a thin atmosphere fading out by zoom 7 (never 1: it washes colours out). */
export function skySpec(theme: Pick<GlobeTheme, 'atmosphere' | 'ocean'>): Record<string, unknown> {
  const a = Math.min(0.6, Math.max(0, theme.atmosphere));
  return {
    'sky-color': '#1b3354',
    'horizon-color': '#5c86b8',
    'fog-color': '#5c86b8',
    'sky-horizon-blend': 0.5,
    'horizon-fog-blend': 0.6,
    'fog-ground-blend': 0.9,
    'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, a, 4, a * 0.5, 7, 0],
  };
}

export interface BaseStyleOptions {
  theme: GlobeTheme;
  /** Optional same-origin glyph template; omitted by default (local glyph drawing). */
  glyphs?: string;
  /** Background layer id. */
  backgroundId?: string;
}

/**
 * The globe's own base style: ocean background, globe projection, atmosphere.
 * Border sources/layers are added afterwards by `addBorderLayers`, exactly as
 * on a host's map.
 */
export function buildBaseStyle(opts: BaseStyleOptions): Record<string, unknown> {
  const style: Record<string, unknown> = {
    version: 8,
    name: 'alexs-atlas-globe',
    projection: { type: 'globe' },
    sky: skySpec(opts.theme),
    // The atmosphere's sun follows `light`. Anchored to the viewport behind and
    // above the globe (MapLibre's default position), the scattering shows as a
    // thin crescent on the limb. A map-anchored or side light puts the day/night
    // terminator across the visible face: a hard brightness seam (verified in
    // headless Edge screenshots).
    light: { anchor: 'viewport', position: [1.15, 210, 30] },
    sources: {},
    layers: [{ id: opts.backgroundId ?? 'ca-ocean', type: 'background', paint: { 'background-color': opts.theme.ocean } }],
  };
  if (opts.glyphs) style.glyphs = opts.glyphs;
  return style;
}

/**
 * Finds strings in a JSON value that would make MapLibre request something
 * from another origin (absolute URLs, protocol-relative URLs, `mapbox://`…).
 * Used by tests and by the dev build to guard the "zero third-party requests" rule.
 */
export function externalUrls(value: unknown, path = '$'): string[] {
  const out: string[] = [];
  const visit = (v: unknown, p: string): void => {
    if (typeof v === 'string') {
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v) || v.startsWith('//')) out.push(`${p}: ${v}`);
    } else if (Array.isArray(v)) {
      v.forEach((x, i) => visit(x, `${p}[${i}]`));
    } else if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) visit(x, `${p}.${k}`);
    }
  };
  visit(value, path);
  return out;
}
