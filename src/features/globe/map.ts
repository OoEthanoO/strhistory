/**
 * GlobeController — everything that touches MapLibre lives here, so the React
 * components only deal with state. One instance per mounted explorer.
 *
 * Borders come from OpenHistoricalMap (OHM) vector tiles, filtered to the
 * chosen year, from BORDERS_FROM (1700) on. Before then OHM covers too little
 * of the world (under half of the land before 1600), so the globe shows land
 * and pins only. A Natural Earth sea is drawn over the borders, so every
 * polity stops at the coast (OHM's modern polities include territorial waters).
 *
 * Layers (bottom → top): ocean, land, OHM fills (each with its outline; the
 * hovered one lightens), sea, graticule, labels. Topic
 * pins are HTML markers (real <a> links), which keeps them keyboard- and
 * screen-reader-usable.
 */
import {
  addProtocol,
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type FilterSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a URL relative to its own module, which a
// bundler cannot see. Bundle the worker explicitly and hand MapLibre its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { BORDERS_FROM, formatRange, formatYear } from './era';
import { colorForPolity, colorSchemeFor, LAND_BASE, OCEAN, onLand, powerOf } from './palette';
import type { GlobeTopic, PolityHover } from './types';
import { pinClusters } from './pin-layout';
import { boxOf, labelAreas, type Box, type LabelArea, type Polygon } from './label-layout';
import { fitZoom, ohmTile } from './tile-cache';

setWorkerUrl(workerUrl);

type Feature = {
  type: 'Feature';
  id?: number | string;
  properties: Record<string, unknown>;
  geometry: unknown;
};
type FeatureCollection = { type: 'FeatureCollection'; features: Feature[] };

export interface GlobeCallbacks {
  onPinEnter(topic: GlobeTopic): void;
  onPinLeave(topic: GlobeTopic): void;
  /** Called on pin click. Leave the event alone to follow the link to the notes. */
  onPinClick(topic: GlobeTopic, event: MouseEvent): void;
  onPolityHover(hover: PolityHover | null): void;
  /** True while border data for the chosen year and view is still arriving. */
  onLoadingChange(loading: boolean): void;
  onViewChange?(view: { center: [number, number]; scale: number }): void;
  onInteractionEnd?(view: { center: [number, number]; scale: number }): void;
  onFailure?(): void;
}

export interface PinState {
  active: Set<string>;
  selected: string | null;
  hovered: string | null;
}

/** OHM tiles go through tile-cache.ts, which keeps them for a week. */
const OHM_PROTOCOL = 'ohmtiles';
addProtocol(OHM_PROTOCOL, async (params, abort) => ({ data: await ohmTile(params.url.slice(OHM_PROTOCOL.length + 3), abort.signal) }));
/** Labels show from this much zoom past the whole-globe view; zoomed further out they crowd. */
const LABEL_MIN_SCALE = 1.4;
/**
 * Hidden below `zoom` by opacity: a fractional layer minzoom would also stop
 * MapLibre building labels for the whole tile zoom level just above it.
 */
const labelOpacity = (zoom: number): ExpressionSpecification => ['step', ['zoom'], 0, zoom, 1];
/** Boundary polygons in OHM's ohm_admin tiles; admin_level 2 is the country level. */
const BOUNDARIES = 'boundaries';
// Bump after rebuilding public/data/sea.geojson.
const SEA_VERSION = '2';
const ATTRIBUTION =
  'Borders: <a href="https://www.openhistoricalmap.org/copyright">OpenHistoricalMap</a> contributors (CC0) · ' +
  'Coast: <a href="https://www.naturalearthdata.com/">Natural Earth</a>';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
// MapLibre simplifies the sea per zoom level by this many pixels (its default
// is 0.375). Keeping subpixel detail (0.1) made the sea a third of every frame.
const GEOMETRY_TOLERANCE = 0.5;
/** Screen distance (px) below which two pins count as overlapping. */
const PIN_OVERLAP = 18;
/**
 * OHM admin levels drawn by each layer. Level 2 is the country level. Level 3
 * is drawn underneath, so it shows only where OHM has no country: in 1800 the
 * Kingdom of Hungary and West Galicia are mapped only as Habsburg crown lands.
 * Level 1 holds colonial empires, which are not drawn but colour their members
 * (refreshColours).
 */
const OHM_LEVELS: Record<string, string[]> = { 'ohm-sub-fill': ['3'], 'ohm-fill': ['2'] };
/** Longest wait for the map to settle on one year before taking the next (setYear). */
const YEAR_SETTLE_MAX = 1500;
/** Hidden before BORDERS_FROM; with no visible layer, MapLibre fetches no OHM tiles. */
const BORDER_LAYERS = [...Object.keys(OHM_LEVELS), 'ohm-label'];
/** Level-1 polities that are colonial empires, not confederations or Indigenous nations. */
const EMPIRE = /empire/i;
const bordersShown = (year: number) => year >= BORDERS_FROM;
const visibility = (year: number) => (bordersShown(year) ? 'visible' : 'none');
const BORDER_COLOR = 'rgba(6, 9, 14, 0.75)';
const LABEL_LAYOUT = {
  'text-field': ['get', 'name'] as ExpressionSpecification,
  'text-font': ['noto-sans'],
  'text-size': [
    'interpolate', ['linear'], ['zoom'],
    1, ['interpolate', ['linear'], ['get', 'area'], 1, 8, 40, 10, 400, 12.5],
    5, ['interpolate', ['linear'], ['get', 'area'], 1, 12, 40, 15, 400, 19],
  ] as ExpressionSpecification,
  'text-max-width': 7,
  'text-letter-spacing': 0.03,
  'text-padding': 2,
  // Larger polities first when labels compete for space.
  'symbol-sort-key': ['-', 0, ['get', 'area']] as ExpressionSpecification,
};
const LABEL_PAINT = {
  'text-color': 'rgba(255, 250, 240, 0.88)',
  'text-halo-color': 'rgba(8, 10, 16, 0.78)',
  'text-halo-width': 1.3,
  'text-halo-blur': 0.4,
};

/**
 * OHM stores dates as decimal years on the astronomical calendar (1 BCE is
 * year 0). The timeline has no year 0, so 500 BCE is -500 here and -499 there;
 * mid-year stands for the whole year.
 */
export function decimalYear(year: number): number {
  return (year < 0 ? year + 1 : year) + 0.5;
}

/**
 * OHM polities at the given admin levels that existed in the middle of `year`.
 * Unnamed ones are left out: they would show as blank shapes.
 */
function ohmInYear(year: number, levels: string[]): FilterSpecification {
  const d = decimalYear(year);
  return [
    'all',
    ['in', ['to-string', ['get', 'admin_level']], ['literal', levels]],
    ['any', ['has', 'name_en'], ['has', 'name']],
    ['<=', ['coalesce', ['get', 'start_decdate'], -1e7], d],
    ['>', ['coalesce', ['get', 'end_decdate'], 1e7], d],
  ] as FilterSpecification;
}

/** A polity's English name, without the dates some OHM names carry ("New Spain (1795-1803)", "Japan (1977-)"). */
function ohmName(p: Record<string, unknown>): string | undefined {
  const name = (p.name_en ?? p.name) as string | undefined;
  return name?.replace(/\s*\(\d{3,4}\s*[-–]\s*(\d{3,4}|present)?\)$/, '');
}

/** "1871-01-18", "1918-11-09" → "1871–1918" in timeline years ("since 1958" when open-ended). */
function ohmDates(start: unknown, end: unknown): string | null {
  const year = (value: unknown) => {
    const m = typeof value === 'string' ? value.match(/^(-?\d+)/) : null;
    if (!m) return null;
    const astronomical = Number(m[1]);
    return astronomical <= 0 ? astronomical - 1 : astronomical;
  };
  const from = year(start), to = year(end);
  if (from === null) return to === null ? null : `until ${formatYear(to)}`;
  return to === null ? `since ${formatYear(from)}` : formatRange(from, to);
}

/** Ring area in square degrees scaled for latitude; only compares polygons with each other. */
function ringArea(ring: number[][]): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const k = Math.cos((((ring[i][1] + ring[i + 1][1]) / 2) * Math.PI) / 180);
    a += (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) * k;
  }
  return Math.abs(a / 2);
}

/**
 * A point inside a polygon, for its label: the middle of the widest stretch of
 * the horizontal line through its vertical centre. Holes count as edges too, so
 * unlike a centroid it cannot fall outside a curved shape or inside a hole.
 */
function interiorPoint(polygon: number[][][]): [number, number] | null {
  const [outer] = polygon;
  if (!outer || outer.length < 4) return null;
  let south = Infinity, north = -Infinity;
  for (const [, y] of outer) { south = Math.min(south, y); north = Math.max(north, y); }
  const y = (south + north) / 2;
  const xs: number[] = [];
  for (const ring of polygon) for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
    if ((y1 > y) !== (y2 > y)) xs.push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((a, b) => a - b);
  let best: [number, number] | null = null, width = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > width) { width = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, y]; }
  }
  return best;
}

interface Area { name: string; rings: Polygon; box: Box }
/** An OHM polity with its pieces from every loaded tile; `stack` is OHM's area, which orders the fills. */
interface Polity { id: number | string; name: string; level: string; stack: number; pieces: Area[] }
type TileFeature = ReturnType<MapLibreMap['querySourceFeatures']>[number];
/**
 * One OHM feature (a polity between two dates) as found in the loaded tiles.
 * Its geometry is decoded only when first needed (piecesOf).
 */
interface Version { id: number | string; name: string; level: string; stack: number; start: number; end: number; tiles: TileFeature[]; pieces?: Area[] }
const piecesOf = (v: Version): Area[] => (v.pieces ??= v.tiles.flatMap((f) => areasOf(v.name, polygonsOf(f.geometry))));
/** A unit names an area of its polity when it covers this much of it… */
const SUBUNIT_SHARE = 0.8;
/** …and the polity has another area at least this fraction of that one's size for its own name. */
const HOME_MIN = 0.01;

const inBox = ([x, y]: number[], [w, s, e, n]: Box) => x >= w && x <= e && y >= s && y <= n;
const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

function inRing([x, y]: number[], ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (pt: number[], [outer, ...holes]: Polygon) => inRing(pt, outer) && !holes.some((h) => inRing(pt, h));
const areaAt = (areas: Area[], pt: number[]) => areas.find((a) => inBox(pt, a.box) && inPolygon(pt, a.rings));

/** The polygons of a GeoJSON geometry; other geometries have none. */
function polygonsOf(g: { type: string; coordinates?: unknown }): Polygon[] {
  return g.type === 'Polygon' ? [g.coordinates as Polygon] : g.type === 'MultiPolygon' ? (g.coordinates as Polygon[]) : [];
}
const areasOf = (name: string, polygons: Polygon[]): Area[] => polygons.filter((rings) => rings[0]?.length >= 4).map((rings) => ({ name, rings, box: boxOf(rings[0]) }));

/**
 * Words that tell a polity apart: an area whose own unit shares one with the
 * polity ("Metropolitan France" in France) is not named separately.
 */
const GENERIC_WORDS = new Set(['kingdom', 'republic', 'state', 'states', 'province', 'colony', 'captaincy', 'general', 'empire', 'viceroyalty', 'territory', 'region', 'united', 'federal', 'democratic', 'people', 'peoples', 'grand', 'duchy', 'principality', 'sultanate', 'emirate', 'protectorate', 'crown', 'islands']);
const nameWords = (name: string) => new Set(name.toLowerCase().split(/[^\p{L}]+/u).filter((w) => w.length >= 4 && !GENERIC_WORDS.has(w)));

export { fitZoom };

/** Land colour everywhere below the sea layer; the sea drawn over it leaves land. */
const LAND_EXTENT: FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[-180, -85.06], [180, -85.06], [180, 85.06], [-180, 85.06], [-180, -85.06]]] } }],
};

function buildStyle(year: number, labelZoom: number): StyleSpecification {
  const hovered = ['boolean', ['feature-state', 'hover'], false];
  const shown = { visibility: visibility(year) } as const;
  // Overlapping polities (an empire and its members, a federation and its
  // colonies) must stack the same way in every tile, or the top one changes from
  // tile to tile. Larger polities are drawn first, smaller ones on top; fills are
  // opaque (pre-blended with the land, see onLand) so overlaps never mix colours,
  // and each outline is drawn with its own fill so a covered border stays covered.
  const largestFirst = (area: ExpressionSpecification): ExpressionSpecification => ['-', 0, ['coalesce', ['to-number', area], 0]];
  // Colours are set per polity once its tile arrives (refreshColours).
  const fill = (id: string) => ({
    id,
    type: 'fill' as const,
    source: 'ohm',
    'source-layer': BOUNDARIES,
    filter: ohmInYear(year, OHM_LEVELS[id]),
    layout: { ...shown, 'fill-sort-key': largestFirst(['get', 'area']) },
    paint: {
      'fill-color': ['case', hovered as never,
        ['coalesce', ['feature-state', 'hoverColor'], '#8c8674'],
        ['coalesce', ['feature-state', 'color'], '#6f6a5c']] as ExpressionSpecification,
      'fill-outline-color': BORDER_COLOR,
    },
  });
  return {
    version: 8,
    projection: { type: 'globe' },
    glyphs: '/glyphs/{fontstack}/{range}.pbf',
    // A light atmosphere: at full strength it washes the polity colours out.
    sky: {
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 0.28, 4, 0.28, 7, 0],
    },
    light: { anchor: 'map', position: [1.5, 90, 80] },
    sources: {
      land: { type: 'geojson', data: LAND_EXTENT as never },
      // Natural Earth sea in 10° cells, and the graticule over it (build-sea.mjs).
      sea: { type: 'geojson', data: `/data/sea.geojson?v=${SEA_VERSION}`, tolerance: GEOMETRY_TOLERANCE },
      // Boundary tiles are several MB each; past zoom 6 MapLibre overzooms
      // rather than fetching more. promoteId lets feature-state hold colours.
      ohm: { type: 'vector', tiles: [`${OHM_PROTOCOL}://{z}/{x}/{y}`], minzoom: 0, maxzoom: 6, promoteId: { [BOUNDARIES]: 'osm_id' } },
      'ohm-labels': { type: 'geojson', data: EMPTY as never },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND_BASE } },
      fill('ohm-sub-fill'),
      fill('ohm-fill'),
      // The sea covers every fill, so polities stop at the coast: OHM's modern
      // polities include their territorial waters, which made them puffy.
      { id: 'sea', type: 'fill', source: 'sea', filter: ['==', ['get', 'kind'], 'sea'], paint: { 'fill-color': OCEAN } },
      { id: 'graticule', type: 'line', source: 'sea', filter: ['==', ['get', 'kind'], 'graticule'], paint: { 'line-color': '#a9c1e0', 'line-opacity': 0.07, 'line-width': 0.6 } },
      { id: 'ohm-label', type: 'symbol', source: 'ohm-labels', layout: { ...LABEL_LAYOUT, ...shown }, paint: { ...LABEL_PAINT, 'text-opacity': labelOpacity(labelZoom) } },
    ],
  };
}

export class GlobeController {
  readonly map: MapLibreMap;
  private cb: GlobeCallbacks;
  private markers = new Map<string, HTMLAnchorElement>();
  private markerObjs: Marker[] = [];
  private pinEntries: Array<{ topic: GlobeTopic; marker: Marker; element: HTMLAnchorElement }> = [];
  private preferredPins: string[] = [];
  private hovered: number | string | null = null;
  private spinning = false;
  private readonly ready: Promise<void>;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly compact: boolean;
  private destroyed = false;
  private fitLevel: number;
  private readonly resizeObserver: ResizeObserver;
  /** The year the map shows; `wantedYear` is the one last asked for (setYear). */
  private year: number;
  private wantedYear: number;
  private yearBusy = false;
  // OHM: colours through feature-state, labels computed from loaded tiles.
  private coloured = new Set<number | string>();
  /** The colonial empire each coloured polity belongs to, shown on hover. */
  private empireOf = new Map<number | string, string>();
  /** Labels per polity, with what they were placed from (labelPolity). */
  private labelCache = new Map<number | string, { key: string; labels: Feature[] }>();
  private colourTimer: ReturnType<typeof setTimeout> | undefined;
  /** Tiles or the year changed since labels were last placed. */
  private labelsStale = true;
  /** OHM polity versions in the loaded tiles (refreshIndex); stale when tiles arrive. */
  private versions: Version[] = [];
  private indexStale = true;
  private indexedTiles = new Set<string>();
  /** The label data last sent, to skip sending (and re-rendering) the same again. */
  private labelKey = '';

  constructor(container: HTMLElement, cb: GlobeCallbacks, center: [number, number] = [15, 30], options: { compact?: boolean; year?: number } = {}) {
    this.cb = cb;
    this.compact = options.compact ?? false;
    this.year = this.wantedYear = options.year ?? 1789;
    this.fitLevel = fitZoom(container, this.compact);
    this.map = new MapLibreMap({
      container,
      style: buildStyle(this.year, this.labelZoom()),
      center,
      zoom: this.fitLevel,
      minZoom: -1,
      maxZoom: 7,
      attributionControl: { compact: true, customAttribution: ATTRIBUTION },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      renderWorldCopies: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.keyboard.disableRotation();
    this.resizeObserver = new ResizeObserver(() => {
      if (this.destroyed || !container.clientWidth || !container.clientHeight) return;
      const next = fitZoom(container, this.compact);
      const delta = next - this.fitLevel;
      if (Math.abs(delta) < 0.001) return;
      this.fitLevel = next;
      this.map.resize();
      this.map.jumpTo({ zoom: this.map.getZoom() + delta });
      if (this.map.getLayer('ohm-label')) this.map.setPaintProperty('ohm-label', 'text-opacity', labelOpacity(this.labelZoom()));
    });
    this.resizeObserver.observe(container);
    // A loaded style is not a rendered globe. Keep the interactive baked globe
    // visible until the sea has arrived and reached a render frame;
    // borders fill in afterwards.
    this.ready = new Promise((resolve) => {
      let pending = false;
      const check = () => {
        if (pending || this.destroyed || !this.map.isStyleLoaded() || !this.map.isSourceLoaded('sea')) return;
        pending = true;
        this.map.off('sourcedata', check);
        this.map.once('render', () => { if (!this.destroyed) resolve(); });
        this.map.triggerRepaint();
      };
      this.map.on('sourcedata', check);
      this.map.once('load', check);
    });
    let landShown = false;
    this.ready.then(() => { landShown = true; });
    this.map.on('error', (event) => {
      // Without the sea there is no coastline: the baked globe stays in charge.
      if ('sourceId' in event && event.sourceId === 'sea' && !landShown) this.cb.onFailure?.();
    });
    this.map.getCanvas().addEventListener('webglcontextlost', () => this.cb.onFailure?.());
    this.map.on('move', () => { this.cb.onViewChange?.(this.getView()); this.layoutPins(); });
    for (const type of ['dragend', 'zoomend'] as const) {
      this.map.on(type, (event) => { if (event.originalEvent) this.cb.onInteractionEnd?.(this.getView()); });
    }
    this.map.on('click', () => this.cb.onInteractionEnd?.(this.getView()));
    this.map.on('sourcedata', (event) => {
      if (event.sourceId === 'sea' && event.tile) this.labelsStale = true;
      if (event.sourceId !== 'ohm' || !bordersShown(this.year)) return;
      this.setLoading(!this.map.isSourceLoaded('ohm'));
      // A new year re-processes the tiles already loaded and reports each again;
      // only tiles not seen before bring new polities.
      const key = (event.tile as { tileID?: { key?: string } } | undefined)?.tileID?.key;
      if (key && !this.indexedTiles.has(key)) {
        this.indexedTiles.add(key);
        this.indexStale = true;
        this.labelsStale = true;
        this.scheduleColours();
      }
    });
    // Labels wait until the map is still: placing them while tiles stream in
    // during a pan made panning stutter. Only new tiles or a new year make them
    // stale; new label data re-renders and ends in 'idle' again.
    this.map.on('idle', () => { this.setLoading(false); if (this.labelsStale) this.refreshLabels(); });
    this.bindInteractions();
  }

  /** Map zoom from which labels show (LABEL_MIN_SCALE). */
  private labelZoom() {
    return this.fitLevel + Math.log2(LABEL_MIN_SCALE);
  }

  whenReady() {
    return this.ready;
  }

  // ---------- year ----------

  /**
   * Show the polities of `year`, or none before BORDERS_FROM. A new year makes
   * MapLibre re-process every loaded tile (~0.3–0.5 s), and dragging the
   * timeline asks for a year per step, so requests made while the map is still
   * catching up only replace the pending year: the map then jumps straight to
   * the latest one instead of working through each in turn.
   */
  setYear(year: number) {
    this.wantedYear = year;
    if (!this.yearBusy) this.applyYear();
  }

  private applyYear() {
    const year = this.wantedYear;
    if (year === this.year) return;
    this.yearBusy = true;
    const done = () => {
      clearTimeout(fallback);
      this.map.off('idle', done);
      this.yearBusy = false;
      if (!this.destroyed && this.wantedYear !== this.year) this.applyYear();
    };
    const fallback = setTimeout(done, YEAR_SETTLE_MAX);
    this.map.on('idle', done);
    // A different period's colour scheme: colour everything again.
    if (colorSchemeFor(year).name !== colorSchemeFor(this.year).name) { this.coloured.clear(); this.empireOf.clear(); }
    const wasShown = bordersShown(this.year);
    this.year = year;
    for (const [id, levels] of Object.entries(OHM_LEVELS)) if (this.map.getLayer(id)) this.map.setFilter(id, ohmInYear(year, levels));
    if (bordersShown(year) !== wasShown) {
      for (const id of BORDER_LAYERS) if (this.map.getLayer(id)) this.map.setLayoutProperty(id, 'visibility', visibility(year));
      if (!bordersShown(year)) { this.setLoading(false); this.cb.onPolityHover(null); }
    }
    this.clearHover();
    this.scheduleColours();
    // New filters re-render; the 'idle' that follows places the new labels.
    this.labelsStale = true;
    this.map.triggerRepaint();
  }

  private setLoading(loading: boolean) {
    this.cb.onLoadingChange(loading);
  }

  private scheduleColours() {
    clearTimeout(this.colourTimer);
    this.colourTimer = setTimeout(() => this.refreshColours(), 100);
  }

  /**
   * Every named OHM polity version (levels 1–4, still existing in BORDERS_FROM
   * or later) in the loaded tiles, with its pieces. querySourceFeatures decodes
   * every feature of every tile to test a filter (~2,000 per tile), which made
   * each year change take a second or more; so it runs once per batch of new
   * tiles, and a year change only filters this list by date.
   */
  private refreshIndex() {
    this.indexStale = false;
    const since = decimalYear(BORDERS_FROM);
    const versions = new Map<number | string, Version>();
    for (const f of this.map.querySourceFeatures('ohm', {
      sourceLayer: BOUNDARIES,
      filter: ['all',
        ['in', ['to-string', ['get', 'admin_level']], ['literal', ['1', '2', '3', '4']]],
        ['>', ['coalesce', ['get', 'end_decdate'], 1e7], since]] as FilterSpecification,
    })) {
      const name = ohmName(f.properties);
      if (f.id === undefined || !name) continue;
      let v = versions.get(f.id);
      if (!v) {
        const p = f.properties;
        v = { id: f.id, name, level: String(p.admin_level), stack: Number(p.area) || 0, start: Number(p.start_decdate ?? -1e7), end: Number(p.end_decdate ?? 1e7), tiles: [] };
        versions.set(f.id, v);
      }
      v.tiles.push(f);
    }
    this.versions = [...versions.values()];
  }

  /** The versions that exist in the middle of the shown year, at the given levels. */
  private current(levels: string[]): Version[] {
    if (this.indexStale) this.refreshIndex();
    const d = decimalYear(this.year);
    return this.versions.filter((v) => levels.includes(v.level) && v.start <= d && v.end > d);
  }

  /**
   * Colours for the OHM polities of the shown year. Style expressions cannot
   * hash a name, so each polity gets its colour through feature-state: a member
   * of a colonial empire (level 1) takes the empire's colour, so the Viceroyalty
   * of Peru shows as Spanish; otherwise colorForPolity by name and powerOf.
   */
  private refreshColours() {
    if (this.destroyed || !this.map.getSource('ohm') || !bordersShown(this.year)) return;
    const fresh = this.current(['2', '3']).filter((v) => !this.coloured.has(v.id));
    if (!fresh.length) return;
    const empires = this.current(['1']).filter((v) => EMPIRE.test(v.name)).flatMap(piecesOf);
    for (const v of fresh) {
      this.coloured.add(v.id);
      const pieces = piecesOf(v);
      const largest = pieces.length ? pieces.reduce((a, b) => (ringArea(b.rings[0]) > ringArea(a.rings[0]) ? b : a)) : null;
      const inside = largest && interiorPoint(largest.rings);
      const empire = inside ? areaAt(empires, inside)?.name : undefined;
      if (empire) this.empireOf.set(v.id, empire);
      const color = empire ? colorForPolity([powerOf(empire)], this.year) : colorForPolity([v.name, powerOf(v.name)], this.year);
      this.map.setFeatureState({ source: 'ohm', sourceLayer: BOUNDARIES, id: v.id }, { color: onLand(color), hoverColor: color });
    }
  }

  /**
   * Labels for the OHM polities in the loaded tiles, placed by labelPolity.
   * Only once the map is idle, and not while zoomed out past LABEL_MIN_SCALE,
   * where the label layer is hidden anyway.
   */
  private refreshLabels() {
    // Zoomed out, labels stay stale and are placed when zooming in.
    if (this.destroyed || !this.map.getSource('ohm') || !bordersShown(this.year) || this.map.getZoom() < this.labelZoom()) return;
    this.labelsStale = false;
    const polities: Polity[] = this.current(['2', '3', '4']).map((v) => ({ id: v.id, name: v.name, level: v.level, stack: v.stack, pieces: piecesOf(v) }));
    // The sea as MapLibre already holds it for the loaded tiles.
    const sea = this.map.querySourceFeatures('sea', { filter: ['==', ['get', 'kind'], 'sea'] }).flatMap((f) => areasOf('', polygonsOf(f.geometry)));
    const drawn = polities.filter((p) => (p.level === '2' || p.level === '3') && p.pieces.length);
    const units = polities.filter((p) => p.level === '3' || p.level === '4');
    const labels = drawn.flatMap((p) => this.labelPolity(p, drawn, units, sea));
    const key = labels.map((l) => `${l.properties.name}@${(l.geometry as { coordinates: number[] }).coordinates.join(',')}`).join('|');
    if (key === this.labelKey) return;
    this.labelKey = key;
    (this.map.getSource('ohm-labels') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: labels } as never);
  }

  /**
   * Labels for one polity, at the visible middle of its land (labelAreas): not
   * at sea, not under a smaller polity drawn over it, and for a level-3 polity
   * not under any country. A polity in several separate areas whose largest is
   * mostly one named unit of its own (in 1800 the Captaincy General of Cuba
   * stretches over Spanish Louisiana) labels that area with the unit's name and
   * puts its own name on its largest other area, here Cuba.
   */
  private labelPolity(p: Polity, drawn: Polity[], units: Polity[], sea: Area[]): Feature[] {
    const near = (a: Area) => p.pieces.some((b) => overlaps(a.box, b.box));
    const covers = (q: Polity) => q !== p && (p.level === '3' ? q.level === '2' || q.stack < p.stack : q.level === '2' && q.stack < p.stack);
    const above = drawn.filter(covers).flatMap((q) => q.pieces).filter(near);
    const water = sea.filter(near);
    // Recompute only when this polity, what covers it or the year changed.
    const vertices = (pieces: Area[]) => pieces.reduce((n, a) => n + a.rings.reduce((m, r) => m + r.length, 0), 0);
    const key = `${this.year}|${vertices(p.pieces)}|${vertices(above)}|${vertices(water)}|${units.length}`;
    const cached = this.labelCache.get(p.id);
    if (cached?.key === key) return cached.labels;
    const labels = this.placeLabels(p, above, water, units);
    this.labelCache.set(p.id, { key, labels });
    return labels;
  }

  private placeLabels(p: Polity, above: Area[], water: Area[], units: Polity[]): Feature[] {
    const areas = labelAreas(p.pieces.map((a) => a.rings), (box) => ({
      water: water.filter((a) => overlaps(a.box, box)).map((a) => a.rings),
      above: above.filter((a) => overlaps(a.box, box)).map((a) => a.rings),
    }));
    if (!areas.length) return [];
    const label = (name: string, area: LabelArea): Feature =>
      ({ type: 'Feature', properties: { name, area: Math.round(area.area * 100) / 100 }, geometry: { type: 'Point', coordinates: area.point } });
    const own = nameWords(p.name);
    const near = (u: Polity) => u.pieces.some((a) => p.pieces.some((b) => overlaps(a.box, b.box)));
    const candidates = areas.length < 2 ? [] : units.filter((u) => u !== p && (p.level === '2' || u.level === '4') && near(u) && ![...nameWords(u.name)].some((w) => own.has(w)));
    const subunit = (area: LabelArea) => {
      for (const u of candidates) if (area.share(u.pieces.map((a) => a.rings)) >= SUBUNIT_SHARE) return u.name;
      return null;
    };
    const main = subunit(areas[0]);
    if (!main) return [label(p.name, areas[0])];
    const home = areas.slice(1).find((a) => a.area >= areas[0].area * HOME_MIN && !subunit(a));
    return home ? [label(main, areas[0]), label(p.name, home)] : [label(p.name, areas[0])];
  }

  // ---------- pins ----------

  setTopics(topics: GlobeTopic[]) {
    for (const m of this.markerObjs) m.remove();
    this.markerObjs = [];
    this.pinEntries = [];
    this.markers.clear();
    for (const topic of topics) {
      const el = document.createElement('a');
      el.className = 'globe-pin';
      el.href = topic.href;
      el.dataset.slug = topic.slug;
      el.dataset.paper = String(topic.paper);
      el.innerHTML =
        '<span class="globe-pin__dot"></span><span class="globe-pin__count" aria-hidden="true"></span><span class="globe-pin__label"></span>';
      el.querySelector('.globe-pin__label')!.textContent = topic.shortTitle;
      el.addEventListener('mouseenter', () => this.cb.onPinEnter(topic));
      el.addEventListener('mouseleave', () => this.cb.onPinLeave(topic));
      el.addEventListener('focus', () => this.cb.onPinEnter(topic));
      el.addEventListener('blur', () => this.cb.onPinLeave(topic));
      el.addEventListener('click', (e) => {
        // A counted pin stands for several notes: zoom in until they separate.
        // (The compact home globe hands every click to the full explorer.)
        if (el.dataset.count && !this.compact) {
          e.preventDefault();
          this.stopSpin();
          this.map.easeTo({ center: [topic.lng, topic.lat], zoom: Math.min(this.map.getMaxZoom(), this.map.getZoom() + 2), duration: this.reducedMotion ? 0 : 700 });
          return;
        }
        this.cb.onPinClick(topic, e);
      });
      // Visibility behind the globe is decided in layoutPins(): MapLibre only
      // re-checks it while a marker is inside the viewport, so pins crossing the
      // horizon could keep a stale state.
      const marker = new Marker({ element: el, anchor: 'center', opacity: '1', opacityWhenCovered: '1' })
        .setLngLat([topic.lng, topic.lat])
        .addTo(this.map);
      this.markerObjs.push(marker);
      this.pinEntries.push({ topic, marker, element: el });
      this.markers.set(topic.slug, el);
      this.describePin(el, topic);
      el.classList.add('is-active');
    }
    this.layoutPins();
  }

  /**
   * Pins stay on their places. Hide those on the far side of the globe, and
   * where visible pins overlap, show one with a count and hide the rest until
   * zooming in separates them.
   */
  private layoutPins() {
    const placed = this.pinEntries.map((entry) => {
      const { lng, lat } = entry.topic;
      const point = this.map.project([lng, lat]);
      // A far-side place projects to the screen point of the front-facing place
      // in line with it, so projecting back does not return the same place.
      const back = this.map.unproject(point);
      const drift = Math.max(Math.abs(((back.lng - lng + 540) % 360) - 180) * Math.cos((lat * Math.PI) / 180), Math.abs(back.lat - lat));
      return { entry, point, facing: drift < 1e-4 };
    });
    const clusters = pinClusters(
      placed
        .filter(({ entry, facing }) => facing && !entry.element.hidden)
        .map(({ entry, point }) => ({ id: entry.topic.slug, x: point.x, y: point.y })),
      PIN_OVERLAP,
      this.preferredPins,
    );
    for (const { entry: { topic, element }, facing } of placed) {
      const cluster = clusters.get(topic.slug);
      const count = cluster && cluster.leader === topic.slug && cluster.count > 1 ? cluster.count : 0;
      element.classList.toggle('is-behind', !facing);
      element.classList.toggle('is-grouped', !!cluster && cluster.leader !== topic.slug);
      if (String(count || '') === (element.dataset.count ?? '')) continue;
      if (count) element.dataset.count = String(count);
      else delete element.dataset.count;
      element.querySelector('.globe-pin__count')!.textContent = count ? String(count) : '';
      this.describePin(element, topic);
    }
  }

  updatePins(state: PinState, topics: GlobeTopic[]) {
    for (const topic of topics) {
      const el = this.markers.get(topic.slug);
      if (!el) continue;
      const active = state.active.has(topic.slug);
      el.hidden = !active;
      el.classList.toggle('is-active', active);
      el.classList.toggle('is-selected', state.selected === topic.slug);
      el.classList.toggle('is-hovered', state.hovered === topic.slug);
      this.describePin(el, topic);
    }
    // The selected or hovered note always shows, leading any group it is in.
    this.preferredPins = [state.selected, state.hovered].filter((slug): slug is string => !!slug);
    // Which pins are shown changes which ones overlap.
    this.layoutPins();
  }

  private describePin(el: HTMLAnchorElement, topic: GlobeTopic) {
    const range = formatRange(topic.start, topic.end);
    const count = Number(el.dataset.count ?? 0);
    el.setAttribute(
      'aria-label',
      count && !this.compact
        ? `${count} notes here, including ${topic.title} (${range}), ${topic.place} — zoom in to see them`
        : `${topic.title} (${range}), ${topic.place} — open notes`,
    );
  }

  // ---------- camera ----------

  baseZoom() {
    return this.fitLevel;
  }

  getView(): { center: [number, number]; scale: number } {
    const center = this.map.getCenter();
    return { center: [center.lng, center.lat], scale: 2 ** (this.map.getZoom() - this.baseZoom()) };
  }

  setView(center: [number, number], scale = 1) {
    this.map.jumpTo({ center, zoom: this.baseZoom() + Math.log2(Math.max(0.4, scale)) });
  }

  flyTo(topic: GlobeTopic) {
    this.stopSpin();
    this.map.flyTo({
      center: [topic.lng, topic.lat],
      zoom: Math.max(this.map.getZoom(), this.baseZoom() + 0.9),
      duration: this.reducedMotion ? 0 : 1800,
      essential: true,
    });
  }

  zoomBy(delta: number) {
    this.stopSpin();
    this.map.easeTo({ zoom: this.map.getZoom() + delta, duration: this.reducedMotion ? 0 : 300 });
  }

  resetView() {
    this.stopSpin();
    this.map.easeTo({ center: [15, 30], zoom: this.baseZoom(), duration: this.reducedMotion ? 0 : 900 });
  }

  /** Slow idle rotation until the user touches the globe. */
  startSpin() {
    if (this.reducedMotion || this.spinning) return;
    this.spinning = true;
    this.map.on('moveend', this.spinStep);
    this.ready.then(this.spinStep);
  }

  stopSpin = () => {
    if (!this.spinning) return;
    this.spinning = false;
    this.map.off('moveend', this.spinStep);
  };

  private spinStep = () => {
    if (!this.spinning) return;
    const center = this.map.getCenter();
    center.lng -= 4;
    this.map.easeTo({ center, duration: 1000, easing: (n) => n });
  };

  // ---------- hover ----------

  private bindInteractions() {
    const map = this.map;
    const describe = (f: MapGeoJSONFeature): PolityHover | null => {
      const p = f.properties ?? {};
      const name = ohmName(p);
      // Shown as "Part of …", e.g. the Spanish Empire.
      const empire = f.id === undefined ? null : this.empireOf.get(f.id) ?? null;
      return name ? { name, subjecto: empire, dates: ohmDates(p.start_date, p.end_date), x: 0, y: 0 } : null;
    };
    const fills = ['ohm-fill', 'ohm-sub-fill'];
    const onPointer = (e: MapLayerMouseEvent) => {
      // The sea is drawn over the fills: nothing to describe there.
      if (map.queryRenderedFeatures(e.point, { layers: ['sea'] }).length) { this.clearHover(); this.cb.onPolityHover(null); return; }
      // Topmost first: a country wherever one covers a level-3 polity.
      const [f] = map.queryRenderedFeatures(e.point, { layers: fills });
      const hover = f && f.id !== undefined ? describe(f) : null;
      if (!f || f.id === undefined || !hover) { this.clearHover(); this.cb.onPolityHover(null); return; }
      if (this.hovered !== f.id) {
        this.clearHover();
        this.hovered = f.id;
        map.setFeatureState({ source: 'ohm', sourceLayer: BOUNDARIES, id: f.id }, { hover: true });
      }
      this.cb.onPolityHover({ ...hover, x: e.point.x, y: e.point.y });
    };
    for (const layer of fills) {
      map.on('mousemove', layer, onPointer);
      map.on('click', layer, onPointer); // touch devices have no hover
      map.on('mouseleave', layer, onPointer);
    }
    for (const type of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) {
      map.on(type, this.stopSpin);
    }
  }

  private clearHover() {
    if (this.hovered !== null) {
      this.map.setFeatureState({ source: 'ohm', sourceLayer: BOUNDARIES, id: this.hovered }, { hover: false });
      this.hovered = null;
    }
  }

  destroy() {
    this.destroyed = true;
    clearTimeout(this.colourTimer);
    this.resizeObserver.disconnect();
    this.stopSpin();
    this.map.remove();
  }
}
