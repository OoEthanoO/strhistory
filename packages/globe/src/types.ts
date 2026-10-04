// Public types of @alexs-atlas/globe (see packages/globe/AGENTS.md §3).
import type { BordersClient, Manifest, PolityInfo, PolityProps } from '@alexs-atlas/borders';
import type { Feature, Geometry } from '@alexs-atlas/borders';

export type { BordersClient, Manifest, PolityInfo, PolityProps };

/** A polity feature as returned by `bordersAt` (Polygon or MultiPolygon). */
export type PolityFeatureLike = Feature<Geometry, PolityProps>;

/** Camera state independent of the container size: `scale = 2^(zoom − fitZoom)`. */
export interface GlobeView {
  /** [longitude, latitude] of the view centre. */
  center: [number, number];
  /** 1 = the globe's diameter equals the container's smaller side. */
  scale: number;
}

/**
 * Colours and strengths used by the map layers. Every colour accepts hex,
 * `rgb()/rgba()` or `hsl()/hsla()` (other CSS colours are resolved by the browser).
 * Theme from CSS: the same keys as `--ca-<kebab-case>` custom properties on
 * the container (e.g. `--ca-ocean`, `--ca-label-halo`).
 */
/** A relief overlay: raster tiles drawn over the fills (see `relief` options). */
export interface ReliefOptions {
  tiles: string[];
  /** Default 512. */
  tileSize?: number;
  /** Highest zoom with tiles (overscaled beyond). Default 4. */
  maxzoom?: number;
  /** Default 1. */
  opacity?: number;
  /** Draw under the base land and the polity fills, so the tiles show only on water (sea-floor relief). Default false: over the fills. */
  under?: boolean;
}

export interface GlobeTheme {
  /** Page background behind the globe (CSS only; the star field sits on top). */
  space: string;
  /** Sea: the globe's background layer. */
  ocean: string;
  /** Land with no polity (`kind: 'unclaimed'`) and the base land shown before the first frame. */
  land: string;
  /** Lakes (Natural Earth) drawn above polities. */
  lake: string;
  /** Lake shore line. */
  lakeShore: string;
  /** Lines between two different tier-0 areas. */
  border: string;
  /** Dashes drawn over the borders of polities with `precision: 'approximate'`. */
  approximate: string;
  /** Coastline (exterior arcs of the tier-0 partition). */
  coast: string;
  /** Diagonal hatch lines of tier-1 overlays (indigenous nations, disputed areas). */
  hatch: string;
  /** Label text. */
  label: string;
  /** Halo behind label text (fully transparent: no halo). */
  labelHalo: string;
  /** Halo width in px; null = the label mode's own (curved 0.9, point 1.3). 0..8. */
  labelHaloWidth: number | null;
  /** Halo blur in px (a soft glow under the letters); null = the label mode's own (curved 0, point 0.4). 0..8. */
  labelHaloBlur: number | null;
  /** Label text of tier-1 overlays. */
  labelOverlay: string;
  /** Outline of the polity under the pointer. */
  hover: string;
  /** Outline of the selected polity. */
  selection: string;
  /** Opacity used to pre-blend palette colours over `land` (opaque result). 0..1. */
  fillBlend: number;
  /** Opacity of the tint drawn under the hatch of tier-1 overlays. 0..1. */
  overlayTint: number;
  /** Lightening of a hovered fill towards white. 0..1. */
  hoverLighten: number;
  /**
   * Each tier-0 polity's own outline, drawn inside its edge (land borders and coasts)
   * in a deeper shade of its fill: OKLab lightness lowered by this much. 0..1; 0 = none
   * (only the shared `border` lines).
   */
  edge: number;
  /** `sky.atmosphere-blend` at zoom 0; it fades to 0 by zoom 7. Keep ≤ 0.6 (1 washes colours out). */
  atmosphere: number;
  /** Whether to draw the CSS star field. */
  stars: boolean;
}

/** A colour per palette slot (`PolityProps.c`), or a function of the feature. */
export type PaletteOption = readonly string[] | ((props: PolityProps) => string);

/** Where the borders come from. */
export type GlobeDataOption =
  | { manifestUrl: string }
  | { manifest: Manifest; baseUrl: string }
  | { client: BordersClient };

/** Information about the polity under the pointer. */
export interface HoverInfo {
  /** Feature id (`PolityProps.id`). */
  id: number;
  pid: string;
  name: string;
  props: PolityProps;
  /** Polity index entry, once the index has loaded (it is fetched on first hover). */
  polity?: PolityInfo;
  /** "Name · 395–1453" style text used by the built-in tooltip. */
  label: string;
  lngLat: [number, number];
  /** Pointer position in CSS pixels relative to the map container. */
  point: { x: number; y: number };
  /** Number of other polities under the pointer (stacked overlays, enclaves). */
  others: number;
}

/** A selection change. */
export interface SelectInfo {
  pid: string;
  /** Feature of the selected polity in the current year, if it is on the map. */
  props?: PolityProps;
  /** Polity index entry (lifespan, bbox, links), when known. */
  polity?: PolityInfo;
  /** What caused the change. */
  reason: 'click' | 'api';
  lngLat?: [number, number];
}

export type FailureReason = 'webgl' | 'data' | 'context-lost';

export interface ChronoGlobeCallbacks {
  /** Borders for `year` reached a rendered frame (also called when the frame did not change). */
  onYearApplied?(year: number): void;
  onHover?(info: HoverInfo | null): void;
  onSelect?(info: SelectInfo | null): void;
  /** Every camera change (at most once per animation frame). */
  onViewChange?(view: GlobeView): void;
  /** A user gesture (drag, wheel, pinch, keyboard) finished. */
  onInteractionEnd?(view: GlobeView): void;
  /** True while border data for the wanted year/LOD is loading or rendering. */
  onLoadingChange?(loading: boolean): void;
  onFailure?(reason: FailureReason, error?: unknown): void;
}

export interface ChronoGlobeOptions {
  data: GlobeDataOption;
  /** Initial year (historical numbering, no year 0). */
  year: number;
  /** Initial camera. Default: centre [20, 30], scale 1. */
  view?: { center: [number, number]; scale?: number };
  /** Default 7. */
  maxZoom?: number;
  /** Smallest scale the user can zoom out to. Default 0.6. */
  minScale?: number;
  /** Default true. */
  labels?: boolean;
  /**
   * 'point' (default): each name horizontal at its label point, sized by area. 'curved':
   * in capitals along a gentle arc through the polity's largest part, spread out to span
   * it; labels grow more slowly than the map when zooming in, and are hidden while they
   * do not fit.
   */
  labelMode?: 'point' | 'curved';
  /**
   * Optional relief drawn over the polity fills and their outlines (below borders,
   * overlays and labels): same-origin raster tiles that shade whatever lies under them,
   * e.g. light and shadow on a transparent ground. Tile URLs with {z}/{x}/{y}.
   */
  relief?: ReliefOptions;
  /** Hover highlight + `onHover`. Default true. */
  hover?: boolean;
  /** Built-in hover tooltip ("name · years"); false when the host draws its own. Default true. */
  tooltip?: boolean;
  /** Prefix for source/layer/image ids. Default 'ca-'. */
  layerPrefix?: string;
  palette?: PaletteOption;
  theme?: Partial<GlobeTheme>;
  /** CSS font family used for labels (drawn locally — no glyph server). Default 'sans-serif'. */
  fontFamily?: string;
  /**
   * Optional same-origin glyph URL template (`…/{fontstack}/{range}.pbf`). Not needed:
   * MapLibre 6 draws label glyphs locally from `fontFamily` when this is omitted.
   */
  glyphs?: string;
  /** Calls maplibre-gl's `setWorkerUrl` (bundlers: see AGENTS.md "Worker URL"). */
  workerUrl?: string;
  /** true (default): MapLibre attribution control with the dataset credits; a string: custom HTML; false: none. */
  attribution?: boolean | string;
  /** Development handle: `window[exposeAs] = globe`. */
  exposeAs?: string;
  /** Padding (CSS px) kept clear by `flyToPolity` (e.g. for a side panel and the timeline). */
  padding?: number | { top?: number; right?: number; bottom?: number; left?: number };
}

/** Options of {@link addBorderLayers}. */
export interface BorderLayersOptions {
  borders: BordersClient;
  year: number;
  /** Insert every layer before this existing layer id (e.g. the host's labels or sea mask). */
  beforeId?: string;
  /** Prefix for source/layer/image ids. Default 'ca-'. */
  prefix?: string;
  palette?: PaletteOption;
  /** Default true. */
  labels?: boolean;
  /**
   * 'point' (default): each name horizontal at its label point, sized by area. 'curved':
   * in capitals along a gentle arc through the polity's largest part, spread out to span
   * it; labels grow more slowly than the map when zooming in, and are hidden while they
   * do not fit.
   */
  labelMode?: 'point' | 'curved';
  /**
   * Optional relief drawn over the polity fills and their outlines (below borders,
   * overlays and labels): same-origin raster tiles that shade whatever lies under them,
   * e.g. light and shadow on a transparent ground. Tile URLs with {z}/{x}/{y}.
   */
  relief?: ReliefOptions;
  /** Hover feature-state + `onHover`. Default true. */
  hover?: boolean;
  /** Click selects the polity under the pointer. Default true. */
  clickSelect?: boolean;
  theme?: Partial<GlobeTheme>;
  /** CSS font family for labels. Default 'sans-serif'. */
  fontFamily?: string;
  /** Show Natural Earth land until the first frame arrives. Default true. */
  baseLand?: boolean;
  /** Draw Natural Earth lakes above the polities. Default true. */
  lakes?: boolean;
  onYearApplied?(year: number): void;
  onHover?(info: HoverInfo | null): void;
  onSelect?(info: SelectInfo | null): void;
  onLoadingChange?(loading: boolean): void;
  onFailure?(reason: FailureReason, error?: unknown): void;
}

/** Handle returned by {@link addBorderLayers}. */
export interface BorderLayersHandle {
  /** Resolves when the borders of `year` (or of a later request) have rendered. */
  setYear(year: number): Promise<void>;
  /** Removes every layer, source and image this module added. */
  remove(): void;
  readonly layerIds: string[];
  readonly sourceIds: string[];
}
