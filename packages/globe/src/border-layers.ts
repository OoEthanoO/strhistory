// addBorderLayers(map, opts): the Alex’s Atlas border sources and layers on any
// MapLibre map — the host's own map (bring-your-own-map) or ChronoGlobe's.
import { formatYear, lodForZoom } from '@alexs-atlas/borders';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from '@alexs-atlas/borders';
import type { Map as MlMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import { isTransparent, normalizeColor, shade } from './color.js';
import { WHOLE, angularDistance, capContains, cullFeatures, growCap, isWhole, splitParts, type Cap } from './cull.js';
import { FrameScheduler, type FrameKey } from './frames.js';
import { hatchImage } from './hatch.js';
import { MapNames } from './map-names.js';
import type { PlacedName } from './names.js';
import { DEFAULT_PALETTE, blendPalette, hoverPalette, isPaletteFunction, overlayLinePalette } from './palette.js';
import { globeDisc, type Disc, type DiscMap } from './rim.js';
import { SourceMirror } from './source-diff.js';
import { EMPTY_FC, borderIds, borderLayers, borderSources, layerOrder, type BorderIds, type BorderStyleContext, type LayerSpec } from './style.js';
import { resolveTheme } from './theme.js';
import type {
  BorderLayersHandle,
  BorderLayersOptions,
  BordersClient,
  GlobeTheme,
  HoverInfo,
  Manifest,
  PaletteOption,
  PolityFeatureLike,
  PolityInfo,
  PolityProps,
  SelectInfo,
} from './types.js';

type AddLayerArg = Parameters<MlMap['addLayer']>[0];
type AddSourceArg = Parameters<MlMap['addSource']>[1];
type SetDataArg = Parameters<GeoJSONSource['setData']>[0];
type UpdateDataArg = Parameters<GeoJSONSource['updateData']>[0];

/**
 * The properties of a polygon on the map: what the layers read (`kind`, `tier`,
 * `precision`, the sort key `a`, the slot `c`) and `id`, the record that picking and
 * hover map it back to. Names, dates and the rest stay in the frame's records.
 */
function mapProps(p: PolityProps): PolityProps {
  const out: Record<string, unknown> = { id: p.id, kind: p.kind, tier: p.tier, a: p.a, c: p.c };
  if (p.precision !== undefined) out.precision = p.precision;
  return out as unknown as PolityProps;
}
type PolityFeature = PolityFeatureLike;

/** Data of one displayed frame. */
interface FrameData {
  key: FrameKey;
  /** What the frame source shows (before culling): polygons, then border lines (when drawn). */
  features: Feature[];
  /** The lines the frame has (linesKey: 'border+coast', 'border', 'coast' or ''): only drawn ones are decoded. */
  lines: string;
  /**
   * The coast lines, for the coast source. The borders client returns the identical
   * object for frames of a chunk with the same coastline, which then is not re-sent.
   */
  coast: Feature | null;
  byId: Map<number, PolityFeature>;
  byPid: Map<string, PolityFeature[]>;
  polygons: number;
  /** The frame has `unclaimed` features, i.e. its tier-0 areas cover all land (AGENTS.md §5.2). */
  partitionsLand: boolean;
  /** The frame's records at the coarsest LOD, for the country names (null: the frame is at it, or they failed to load). */
  coarse: PolityFeature[] | null;
}

/**
 * View culling (cull.ts): the sources get only the parts within the visible cap grown by
 * this share of its radius, so ordinary pans stay inside it.
 */
const CULL_MARGIN = 0.5;
/** A culled cap more than this many times wider than needed is recomputed (after zooming in). */
const CULL_SLACK = 3;
/**
 * Caps wider than this (degrees) are not culled: they keep nearly every part (whole-globe
 * views keep ~97 % of the vertices), so the test would cost more than it saves.
 */
const CULL_MAX_RADIUS = 100;
/** While the camera moves, check at most this often (ms) whether the view left the culled cap. */
const CULL_CHECK_MS = 150;

const sameCap = (a: Cap | null, b: Cap | null): boolean => !!a && !!b && a.lon === b.lon && a.lat === b.lat && a.r === b.r;

/** Year-change timing of one step, in ms (for the dev handle and the docs). */
export interface StepTiming {
  year: number;
  frame: string;
  loadMs: number;
  renderMs: number;
  totalMs: number;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const raf = (cb: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(cb, 16) as unknown as number);
const cancelRaf = (h: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h);
  else clearTimeout(h);
};

/** "395–1453", "509 BCE – 27 BCE", "1949–present". */
export function formatSpan(from: number, to: number, present?: number): string {
  const end = present !== undefined && to >= present ? 'present' : formatYear(to);
  const start = formatYear(from);
  const sep = from < 0 || (to < 0 && end !== 'present') ? ' – ' : '–';
  return from === to ? start : `${start}${sep}${end}`;
}

/** Lifespan from the polity index (first start → last end), else the geometry's validity. */
export function hoverLabel(props: PolityProps, polity: PolityInfo | undefined, present?: number): string {
  const spans = polity?.spans;
  let from = props.from;
  let to = props.to;
  if (spans && spans.length) {
    from = Math.min(...spans.map((s) => s[0]));
    to = Math.max(...spans.map((s) => s[1]));
  }
  const name = props.name || polity?.name || '';
  return `${name} · ${formatSpan(from, to, present)}`;
}

/** Feature priority for picking: tier-1 overlays beat tier 0, then the smallest area wins. */
export function pickOrder(a: PolityProps, b: PolityProps): number {
  if (a.tier !== b.tier) return b.tier - a.tier;
  return a.a - b.a;
}

/**
 * Adds the border sources and layers to `map` and returns a controller.
 * The map's style must be loaded (call it from `map.on('load', …)`); if it is
 * not, the layers are added as soon as it is.
 */
export function addBorderLayers(map: MlMap, opts: BorderLayersOptions): BorderLayers {
  return new BorderLayers(map, opts);
}

export class BorderLayers implements BorderLayersHandle {
  readonly layerIds: string[];
  readonly sourceIds: string[];
  readonly ids: BorderIds;

  private theme: GlobeTheme;
  private palette: PaletteOption;
  private readonly borders: BordersClient;
  private manifest: Manifest | null = null;
  private readonly scheduler: FrameScheduler<FrameData>;
  private current: FrameData | null = null;
  /** The frame before `current`: still on screen while `current` renders, so picking finds its records. */
  private previous: FrameData | null = null;
  private interacting = false;
  private removed = false;
  private added = false;
  private firstFrameShown = false;
  private lakesLod: string | null = null;
  /** LOD of the base land on screen (null: hidden). */
  private baseLandLod: string | null = null;
  private selectedPid: string | null = null;
  private hoverId: number | null = null;
  private hoverRaf = 0;
  private lastPoint: { x: number; y: number } | null = null;
  private lastLngLat: [number, number] | null = null;
  private politiesIndex: Record<string, PolityInfo> | null = null;
  private politiesLoading: Promise<Record<string, PolityInfo> | null> | null = null;
  private lastLoadMs = 0;
  /** Cap the frame and coast sources were last culled to (null before the first frame). */
  private culledCap: Cap | null = null;
  /** Coast feature and cap on the coast source (skips re-sending an identical coast). */
  private shownCoast: { feature: Feature | null; cap: Cap } | null = null;
  /** What MapLibre's frame source holds: year changes and re-culls go to it as diffs (source-diff.ts). */
  private readonly mirror = new SourceMirror();
  /** The frame source the mirror describes (a source added again holds nothing). */
  private frameSource: GeoJSONSource | null = null;
  /** Feature ids on the frame source with the hover feature-state (every part of the hovered polity). */
  private hoverIds: number[] = [];
  /** The view moved while a frame was loading: re-check the culling once it is shown. */
  private cullPending = false;
  private lastCullCheck = 0;
  /** A camera animation (flyTo/easeTo) left the culled region: the whole world at the coarsest LOD until it ends. */
  private animating = false;
  /** The current camera movement comes from the user (its movestart carried an input event), not from code. */
  private userMove = false;
  private wantedYear: number;
  private readonly timingsLog: StepTiming[] = [];
  private readonly cleanup: (() => void)[] = [];
  /** Country names painted on the map (map-names.ts), unless `names: false`. */
  private readonly names: MapNames | null;
  private readyResolve!: () => void;
  /** Resolves when the first frame has rendered. */
  readonly firstFrame: Promise<void>;

  constructor(
    readonly map: MlMap,
    private readonly opts: BorderLayersOptions,
  ) {
    this.wantedYear = opts.year;
    this.borders = opts.borders;
    this.ids = borderIds(opts.prefix ?? 'ca-');
    this.theme = resolveTheme(opts.theme);
    this.palette = opts.palette ?? DEFAULT_PALETTE;
    this.layerIds = layerOrder(this.ids, { relief: !!this.opts.relief?.tiles.length, reliefUnder: !!this.opts.relief?.under });
    this.sourceIds = Object.keys(borderSources({ ids: this.ids, relief: this.opts.relief }));
    this.firstFrame = new Promise((resolve) => (this.readyResolve = resolve));
    this.names =
      opts.names === false
        ? null
        : new MapNames(map, {
            font: opts.nameFont,
            ink: this.theme.nameInk,
            seaInk: this.theme.nameSeaInk,
            // Lakes are drawn over the polities in the sea's colour: names take the sea ink there.
            lakes: this.borders.ready().then((m) => {
              const lod = m.lods[0]?.id ?? 'l0';
              return opts.lakes !== false && m.base.lakes?.[lod] ? this.borders.base('lakes', lod).then((fc) => fc.features as { geometry: Polygon | MultiPolygon | null }[]) : [];
            }),
          });

    this.scheduler = new FrameScheduler<FrameData>({
      frameOf: (y) => this.borders.frameOf(y),
      load: (key, year) => this.loadFrame(key, year),
      apply: (data, key, year) => this.applyFrame(data, key, year),
      onApplied: (year) => {
        this.updateAria(year);
        this.opts.onYearApplied?.(year);
      },
      onLoading: (l) => this.opts.onLoadingChange?.(l),
      onError: (err) => this.opts.onFailure?.('data', err),
      // The next frame's decoding and MapLibre's serialisation of it run in a task of their
      // own, not in the render callback that finished the last one: the page paints and
      // takes input in between (a timeline drag stays responsive), and the target is the latest.
      pause: () => new Promise((resolve) => setTimeout(resolve, 0)),
    });

    this.whenStyleReady(() => this.addToMap());
    void this.init();
  }

  // ---- public API --------------------------------------------------------------

  /** Shows the borders of `year`; resolves once they (or a later request's) have rendered. */
  setYear(year: number): Promise<void> {
    if (this.removed) return Promise.resolve();
    this.wantedYear = year;
    if (!this.manifest) return this.firstFrame;
    this.scheduler.request(year, this.currentLod());
    return this.scheduler.whenSettled();
  }

  getYear(): number {
    return this.wantedYear;
  }

  /** While true (e.g. a timeline drag) frames load at the coarsest LOD; on release the zoom's LOD is restored. */
  setInteracting(active: boolean): void {
    if (this.interacting === active) return;
    this.interacting = active;
    if (!active) this.refreshLod();
  }

  /** Shows or hides the country names on the map. */
  setNames(visible: boolean): void {
    this.names?.setVisible(visible);
  }

  /** The names on the map, largest first (dev handle and tests). */
  namesShown(): readonly PlacedName[] {
    return this.names?.placed() ?? [];
  }

  /** Selects a polity by pid (highlight persists across years); null clears. */
  select(pid: string | null, reason: SelectInfo['reason'] = 'api', lngLat?: [number, number]): void {
    if (pid === this.selectedPid) return;
    this.selectedPid = pid;
    this.refreshHighlight();
    if (!this.opts.onSelect) return;
    if (pid === null) {
      this.opts.onSelect(null);
      return;
    }
    const info: SelectInfo = { pid, reason };
    const feature = this.current?.byPid.get(pid)?.[0];
    if (feature) info.props = feature.properties;
    if (lngLat) info.lngLat = lngLat;
    if (this.politiesIndex?.[pid]) info.polity = this.politiesIndex[pid];
    this.opts.onSelect(info);
    if (!info.polity) {
      void this.loadPolities().then((idx) => {
        // Re-emit with the lifespan/links once the index is in, if still selected.
        if (idx?.[pid] && this.selectedPid === pid && !this.removed) this.opts.onSelect?.({ ...info, polity: idx[pid] });
      });
    }
  }

  getSelected(): string | null {
    return this.selectedPid;
  }

  /** Features of `pid` in the frame on screen (empty when it is not on the map this year). */
  featuresOf(pid: string): PolityFeature[] {
    return this.current?.byPid.get(pid) ?? [];
  }

  /** Every polity feature on screen (tier 0 incl. unclaimed, and tier 1). */
  frameFeatures(): PolityFeature[] {
    return this.current ? [...this.current.byId.values()] : [];
  }

  /** Polities under a screen point, best pick first (tier 1 over tier 0, then smallest area). */
  featuresAt(point: { x: number; y: number }): PolityProps[] {
    if (!this.added || this.removed) return [];
    // MapLibre's globe hit-test takes a point in space beyond the rim as the nearest point
    // of the horizon, so empty space beside the globe picked the polities on its edge
    // (Paraguay beside an Africa-centred globe at minimum zoom). Nothing is under it.
    const disc = this.globeDisc();
    if (disc && Math.hypot(point.x - disc.x, point.y - disc.y) > disc.r) return [];
    let hits;
    try {
      hits = this.map.queryRenderedFeatures([point.x, point.y], { layers: [this.ids.fill, this.ids.overlayTint] });
    } catch {
      return [];
    }
    const seen = new Set<number>();
    const out: PolityProps[] = [];
    for (const h of hits) {
      const p = h.properties as unknown as PolityProps;
      if (!p || p.kind === 'unclaimed' || seen.has(Number(p.id))) continue;
      seen.add(Number(p.id));
      out.push(this.current?.byId.get(Number(p.id))?.properties ?? this.previous?.byId.get(Number(p.id))?.properties ?? p);
    }
    return out.sort(pickOrder);
  }

  /** The loaded polity index (null until something needed it). */
  polities(): Record<string, PolityInfo> | null {
    return this.politiesIndex;
  }

  /** Loads the polity index once (lifespans for tooltips, bboxes for fly-to). */
  loadPolities(): Promise<Record<string, PolityInfo> | null> {
    if (this.politiesIndex) return Promise.resolve(this.politiesIndex);
    this.politiesLoading ??= this.borders
      .polities()
      .then((idx) => (this.politiesIndex = idx))
      .catch(() => {
        this.politiesLoading = null;
        return null;
      });
    return this.politiesLoading;
  }

  /** Changes theme colours at runtime (merged over the current theme). */
  setTheme(theme: Partial<GlobeTheme>): void {
    this.theme = resolveTheme(this.theme, theme);
    this.names?.setColors(this.theme.nameInk, this.theme.nameSeaInk);
    this.refreshPaint();
    this.addHatch(true);
    this.refreshLines();
    if (isPaletteFunction(this.palette) && this.current) {
      // Per-feature colours (fill over land, own outline) follow the theme: re-colour.
      this.current = this.recolor(this.current);
      this.setFrameSource(this.current, this.culledCap ?? WHOLE).catch(() => undefined);
    }
  }

  getTheme(): GlobeTheme {
    return { ...this.theme };
  }

  setPalette(palette: PaletteOption): void {
    const wasFn = isPaletteFunction(this.palette);
    this.palette = palette;
    this.refreshPaint();
    if ((wasFn || isPaletteFunction(palette)) && this.current) {
      // Per-feature colours live in the data: re-colour the frame on screen.
      this.current = this.recolor(this.current);
      this.setFrameSource(this.current, this.culledCap ?? WHOLE).catch(() => undefined);
    }
  }

  /** Last year-change timings (most recent last). */
  timings(): StepTiming[] {
    return [...this.timingsLog];
  }

  /** The manifest once loaded. */
  getManifest(): Manifest | null {
    return this.manifest;
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.scheduler.dispose();
    this.names?.remove();
    if (this.hoverRaf) cancelRaf(this.hoverRaf);
    for (const off of this.cleanup.splice(0)) off();
    if (!this.added) return;
    // Every call is guarded: after map.remove() the style is gone and these throw.
    for (const id of [...this.layerIds].reverse()) {
      try {
        if (this.map.getLayer(id)) this.map.removeLayer(id);
      } catch {
        /* map being torn down */
      }
    }
    for (const id of this.sourceIds) {
      try {
        if (this.map.getSource(id)) this.map.removeSource(id);
      } catch {
        /* ignore */
      }
    }
    try {
      if (this.map.hasImage(this.ids.hatchImage)) this.map.removeImage(this.ids.hatchImage);
    } catch {
      /* ignore */
    }
  }

  // ---- setup -------------------------------------------------------------------

  /** Runs `fn` now if the style accepts sources, else when it does. */
  private whenStyleReady(fn: () => void): void {
    const attempt = (): boolean => {
      if (this.removed) return true;
      try {
        fn();
        return true;
      } catch (err) {
        if (/not done loading/i.test(String((err as Error)?.message))) return false;
        throw err;
      }
    };
    if (attempt()) return;
    const sub = this.map.on('styledata', () => {
      if (attempt()) sub.unsubscribe();
    });
    this.cleanup.push(() => sub.unsubscribe());
  }

  private addToMap(): void {
    if (this.added || this.removed) return;
    const sources = borderSources({ ids: this.ids, relief: this.opts.relief });
    let before = this.opts.beforeId;
    if (before && !this.map.getLayer(before)) {
      console.warn(`@alexs-atlas/globe: beforeId "${before}" is not a layer of this map; adding the border layers on top.`);
      before = undefined;
    }
    // The first addSource throws "Style is not done loading" before anything is added.
    for (const [id, spec] of Object.entries(sources)) {
      if (!this.map.getSource(id)) this.map.addSource(id, spec as unknown as AddSourceArg);
    }
    this.addHatch(false);
    for (const layer of borderLayers(this.styleContext())) {
      if (!this.map.getLayer(layer.id)) this.map.addLayer(layer as unknown as AddLayerArg, before);
    }
    this.added = true;
    this.bindEvents();
    if (this.manifest && this.wantedYear !== undefined) this.kick();
  }

  private styleContext(): BorderStyleContext {
    return {
      ids: this.ids,
      theme: this.theme,
      palette: isPaletteFunction(this.palette) ? DEFAULT_PALETTE : this.palette,
      perFeatureColors: isPaletteFunction(this.palette),
      relief: this.opts.relief,
      baseLand: this.opts.baseLand !== false,
      lakes: this.opts.lakes !== false,
    };
  }

  private addHatch(replace: boolean): void {
    const img = hatchImage({ color: this.theme.hatch });
    const id = this.ids.hatchImage;
    try {
      if (this.map.hasImage(id)) {
        if (!replace) return;
        this.map.removeImage(id);
      }
      this.map.addImage(id, { width: img.width, height: img.height, data: img.data }, { pixelRatio: img.pixelRatio });
    } catch (err) {
      console.warn('@alexs-atlas/globe: could not add the hatch pattern', err);
    }
  }

  private async init(): Promise<void> {
    let manifest: Manifest;
    try {
      manifest = await this.borders.ready();
    } catch (err) {
      if (!this.removed) this.opts.onFailure?.('data', err);
      return;
    }
    if (this.removed) return;
    this.manifest = manifest;
    // Base land: shown until the first frame (the tier-0 partition covers all land).
    if (this.opts.baseLand !== false && !this.firstFrameShown) this.loadBaseLand(manifest.lods[0]?.id ?? 'l0');
    if (this.added) this.kick();
  }

  private loadBaseLand(lod: string): void {
    if (this.baseLandLod === lod) return;
    this.baseLandLod = lod;
    this.borders
      .base('land', lod)
      .then((fc) => {
        if (!this.removed && this.baseLandLod === lod) this.setSourceData(this.ids.baseLandSrc, fc);
      })
      .catch((err) => console.warn('@alexs-atlas/globe: base land failed to load', err));
  }

  /**
   * After a frame rendered: hide the base land when the frame partitions the land
   * (the normal case), otherwise keep it underneath as land colour at the frame's
   * LOD — a fallback for datasets without `unclaimed` features (e.g. dev builds).
   */
  private updateBaseLand(partitionsLand: boolean, lod: string): void {
    if (this.opts.baseLand === false) return;
    if (partitionsLand) {
      if (this.baseLandLod === null) return;
      this.baseLandLod = null;
      this.setVisibility(this.ids.baseLand, false);
      this.setSourceData(this.ids.baseLandSrc, EMPTY_FC);
    } else {
      this.setVisibility(this.ids.baseLand, true);
      this.loadBaseLand(lod);
    }
  }

  /** Starts loading once both the style and the manifest are ready. */
  private kick(): void {
    if (this.removed || !this.manifest || !this.added) return;
    this.scheduler.request(this.wantedYear, this.currentLod());
    this.refreshLakes();
  }

  private bindEvents(): void {
    const map = this.map;
    const keep = (sub: { unsubscribe(): void }): void => {
      this.cleanup.push(() => sub.unsubscribe());
    };
    keep(map.on('zoomend', () => this.refreshLod()));
    // MapLibre's movestart of a gesture carries the input event; flyTo/easeTo/jumpTo's do not.
    keep(map.on('movestart', (e?: unknown) => (this.userMove = !!(e as { originalEvent?: unknown } | undefined)?.originalEvent)));
    keep(map.on('move', () => this.onMove()));
    keep(map.on('moveend', () => this.onMoveEnd()));
    if (this.opts.hover !== false) {
      keep(
        map.on('mousemove', (e: MapMouseEvent) => {
          this.lastPoint = { x: e.point.x, y: e.point.y };
          this.lastLngLat = [e.lngLat.lng, e.lngLat.lat];
          if (!this.hoverRaf) this.hoverRaf = raf(() => this.updateHover());
        }),
      );
      keep(
        map.on('mouseout', () => {
          this.lastPoint = null;
          this.setHover(null);
        }),
      );
      keep(map.on('movestart', () => this.setHover(null)));
    }
    if (this.opts.clickSelect !== false) {
      keep(
        map.on('click', (e: MapMouseEvent) => {
          const best = this.featuresAt(e.point)[0];
          this.select(best ? best.pid : null, 'click', [e.lngLat.lng, e.lngLat.lat]);
        }),
      );
    }
  }

  // ---- frames ------------------------------------------------------------------

  private currentLod(): string {
    const m = this.manifest;
    if (!m || m.lods.length === 0) return 'l0';
    if (this.interacting || this.animating) return m.lods[0]?.id ?? 'l0';
    return lodForZoom(m, this.map.getZoom());
  }

  // ---- view culling ------------------------------------------------------------

  /**
   * The visible part of the globe as a cap: the view centre and the largest angular
   * distance to the canvas corners and edge midpoints (MapLibre unprojects points beyond
   * the globe to its horizon). Null when the map cannot tell.
   */
  private viewCap(): Cap | null {
    try {
      const map = this.map;
      const canvas = map.getCanvas();
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const c = map.getCenter();
      let r = 0;
      for (const [x, y] of [
        [0, 0],
        [w / 2, 0],
        [w, 0],
        [w, h / 2],
        [w, h],
        [w / 2, h],
        [0, h],
        [0, h / 2],
      ] as const) {
        const p = map.unproject([x, y]);
        r = Math.max(r, angularDistance(c.lng, c.lat, p.lng, p.lat));
      }
      return Number.isFinite(r) && r > 0 && w > 0 && h > 0 ? { lon: c.lng, lat: c.lat, r } : null;
    } catch {
      return null;
    }
  }

  /**
   * The cap the next update is culled to: the view grown by CULL_MARGIN; the cap on
   * screen while it still covers the view and is not much too large (so a year change
   * after a small pan leaves the coast source alone); the whole sphere during camera
   * animations, or when the margin reaches all the way round.
   */
  private cullCap(): Cap {
    if (this.animating) return WHOLE;
    const view = this.viewCap();
    if (!view) return WHOLE;
    const wanted = growCap(view, CULL_MARGIN);
    if (isWhole(wanted) || wanted.r > CULL_MAX_RADIUS) return WHOLE;
    const cur = this.culledCap;
    if (cur && !isWhole(cur) && capContains(cur, view) && cur.r <= CULL_SLACK * wanted.r) return cur;
    return wanted;
  }

  /**
   * While the camera moves: when the view leaves the culled region, a user pan re-culls
   * around the new view (at a coarser LOD first if a zoom-out reached one, rather than
   * re-culling the finer frame over a larger area), and a camera animation
   * (flyTo/easeTo, which may zoom out far) switches to the whole world at the coarsest
   * LOD until it ends.
   */
  private onMove(): void {
    if (!this.current || this.removed) return;
    const t = now();
    if (t - this.lastCullCheck < CULL_CHECK_MS) return;
    this.lastCullCheck = t;
    const view = this.viewCap();
    if (!view || !this.culledCap || capContains(this.culledCap, view)) return;
    if (!this.userMove) {
      if (this.animating) return;
      this.animating = true; // the coarsest LOD, the whole world
    }
    this.refreshLod(); // a new LOD defers the culling until it is shown
    this.refreshCull();
  }

  private onMoveEnd(): void {
    if (this.animating) {
      this.animating = false;
      this.refreshLod(); // back to the zoom's LOD, culled around the final view
    }
    this.refreshCull();
  }

  /** Re-culls the frame on screen when the view needs another region (deferred while a frame loads). */
  private refreshCull(): void {
    if (this.removed || !this.added || !this.current) return;
    if (this.scheduler.busy) {
      this.cullPending = true;
      return;
    }
    const cap = this.cullCap();
    if (sameCap(cap, this.culledCap)) return;
    this.showFrame(this.current, cap).catch(() => undefined);
  }

  private refreshLod(): void {
    if (this.removed || !this.manifest || !this.added) return;
    const lod = this.currentLod();
    const shown = this.scheduler.displayed;
    if (!shown || shown.lod !== lod || this.scheduler.busy) {
      this.scheduler.request(this.wantedYear, lod);
    }
    this.refreshLakes();
  }

  /**
   * Which lines frames need: the border lines and the coast are decoded only while the
   * theme draws them (a transparent colour hides a layer, as on a map whose polities
   * have their own outlines). Decoding them costs about as much as the polygons.
   */
  private linesKey(): string {
    return [isTransparent(this.theme.border) ? '' : 'border', isTransparent(this.theme.coast) ? '' : 'coast'].filter(Boolean).join('+');
  }

  /** After a theme change that shows or hides lines: loads the frame on screen again with the lines now drawn. */
  private refreshLines(): void {
    void this.scheduler.whenSettled().then(() => {
      if (this.removed || !this.current || this.current.lines === this.linesKey()) return;
      this.scheduler.invalidate();
      this.scheduler.request(this.wantedYear, this.currentLod());
    });
  }

  private refreshLakes(): void {
    const m = this.manifest;
    if (!m || this.opts.lakes === false || !m.base.lakes || this.removed) return;
    // Lakes keep their LOD through drags and camera animations (only the borders go coarse).
    const lod = (this.interacting || this.animating) && this.lakesLod ? this.lakesLod : this.currentLod();
    if (lod === this.lakesLod || !m.base.lakes[lod]) return;
    this.lakesLod = lod;
    this.borders
      .base('lakes', lod)
      .then((fc) => {
        if (!this.removed && this.lakesLod === lod) this.setSourceData(this.ids.lakesSrc, fc);
      })
      .catch((err) => console.warn('@alexs-atlas/globe: lakes failed to load', err));
  }

  private async loadFrame(key: FrameKey, year: number): Promise<FrameData> {
    const t0 = now();
    const o = { lod: key.lod };
    // Country names come from the coarsest LOD at every zoom (each LOD would give a slightly
    // different arc), loaded with the frame so they change with its borders.
    const coarsest = this.manifest?.lods[0]?.id ?? 'l0';
    const coarse =
      this.names && key.lod !== coarsest
        ? this.borders.bordersAt(year, { lod: coarsest }).then(
            (fc) => fc.features as PolityFeature[],
            () => null,
          )
        : Promise.resolve(null);
    const lines = this.linesKey();
    const [polys, linesFc, coarseFeatures] = await Promise.all([
      this.borders.bordersAt(year, o),
      lines === '' ? Promise.resolve(null) : this.borders.linesAt(year, o),
      coarse,
    ]);
    const byId = new Map<number, PolityFeature>();
    const byPid = new Map<string, PolityFeature[]>();
    for (const f of polys.features as PolityFeature[]) {
      byId.set(Number(f.properties.id), f);
      const list = byPid.get(f.properties.pid);
      if (list) list.push(f);
      else byPid.set(f.properties.pid, [f]);
    }
    const lineFeatures = (linesFc?.features ?? []) as Feature[];
    const isCoast = (f: Feature): boolean => (f.properties as { kind?: string } | null)?.kind === 'coast';
    const data: FrameData = {
      key,
      byId,
      byPid,
      polygons: polys.features.length,
      partitionsLand: polys.features.some((f) => f.properties.kind === 'unclaimed'),
      // The map gets one feature per polygon part (cull.ts splitParts): within one
      // multi-part feature, a sliver whose winding flips in tiling would unfill the
      // mainland. byId/byPid (frameFeatures, featuresOf) keep one feature per record.
      // Polygons carry only what the layers and picking read (mapProps): what is new to
      // the map is serialised to MapLibre's worker on each change; the records stay here.
      features: [
        ...splitParts((polys.features as PolityFeature[]).map((f) => ({ ...f, properties: mapProps(f.properties) })) as Feature[]),
        ...(lines.includes('border') ? lineFeatures.filter((f) => !isCoast(f)) : []),
      ],
      lines,
      coast: lines.includes('coast') ? (lineFeatures.find(isCoast) ?? null) : null,
      coarse: coarseFeatures,
    };
    this.lastLoadMs = now() - t0;
    return isPaletteFunction(this.palette) ? this.recolor(data) : data;
  }

  /** Copies polygons with `_fill/_hover/_line/_edge` colours computed by the palette function. */
  private recolor(data: FrameData): FrameData {
    const fn = this.palette;
    // Slot palettes colour in the style; leftover `_fill` props are simply ignored.
    if (!isPaletteFunction(fn)) return data;
    const cache = new Map<string, [string, string, string, string]>();
    const colorsOf = (p: PolityProps): [string, string, string, string] => {
      const base = normalizeColor(fn(p));
      let hit = cache.get(base);
      if (!hit) {
        const fill = blendPalette([base], this.theme)[0] as string;
        hit = [fill, hoverPalette([fill], this.theme)[0] as string, overlayLinePalette([base])[0] as string, shade(fill, this.theme.edge)];
        cache.set(base, hit);
      }
      return hit;
    };
    // The parts of a record share one properties object, and so one coloured copy of it.
    const coloured = new Map<object, Record<string, unknown>>();
    const features = data.features.map((f) => {
      const p = f.properties as PolityProps | null;
      if (!p || f.geometry?.type === 'MultiLineString' || f.geometry?.type === 'LineString') return f;
      let props = coloured.get(p);
      if (!props) {
        // The palette sees the whole record, not the map's subset of it.
        const [fill, hover, line, edge] = colorsOf(data.byId.get(Number(p.id))?.properties ?? p);
        coloured.set(p, (props = { ...p, _fill: fill, _hover: hover, _line: line, _edge: edge }));
      }
      return { ...f, properties: props };
    });
    return { ...data, features };
  }

  private async applyFrame(data: FrameData, key: FrameKey, year: number): Promise<void> {
    if (this.removed) return;
    const t0 = now();
    this.setHover(null);
    this.previous = this.current;
    this.current = data;
    this.cullPending = false;
    await this.showFrame(data, this.cullCap());
    this.refreshHighlight();
    await this.waitRendered();
    if (this.removed) return;
    const renderMs = now() - t0;
    this.timingsLog.push({
      year,
      frame: `${key.from}..${key.to}@${key.lod}`,
      loadMs: Math.round(this.lastLoadMs * 10) / 10,
      renderMs: Math.round(renderMs * 10) / 10,
      totalMs: Math.round((this.lastLoadMs + renderMs) * 10) / 10,
    });
    if (this.timingsLog.length > 100) this.timingsLog.shift();
    this.updateBaseLand(data.partitionsLand, key.lod);
    this.names?.show(data.coarse ?? [...data.byId.values()]);
    if (!this.firstFrameShown) {
      this.firstFrameShown = true;
      this.readyResolve();
    }
    // Re-pick the hover under a still pointer: the polity under it may have changed.
    if (this.lastPoint && this.opts.hover !== false && !this.hoverRaf) this.hoverRaf = raf(() => this.updateHover());
    // The view moved while this frame loaded: cull again around the view now on screen,
    // once the scheduler is idle (refreshCull defers while it is busy).
    if (this.cullPending) {
      this.cullPending = false;
      void this.scheduler.whenSettled().then(() => this.refreshCull());
    }
  }

  /**
   * Puts a frame on the map, culled to `cap`: the frame source always, the coast source
   * only when its feature or cap changed (the coast is the same in most frames of a
   * chunk and is ~90 % of the line vertices). Resolves when MapLibre took both.
   */
  private showFrame(data: FrameData, cap: Cap): Promise<void> {
    const jobs = [this.setFrameSource(data, cap)];
    const shown = this.shownCoast;
    // Nothing shown (the source's initial empty data) and no coast (hidden): nothing to send.
    if (shown ? shown.feature !== data.coast || (data.coast !== null && !sameCap(shown.cap, cap)) : data.coast !== null) {
      this.shownCoast = { feature: data.coast, cap };
      const features = data.coast ? cullFeatures([data.coast], cap) : [];
      jobs.push(this.setSource(this.ids.coastSrc, { type: 'FeatureCollection', features }));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  /**
   * Sends the frame, culled to `cap`, to the frame source as a diff from what MapLibre
   * holds (source-diff.ts): only features whose geometry is new to the map are
   * serialised to its worker, the rest stay (with property updates where their record
   * changed) and only the tiles they touch are re-tiled. Little in common (another
   * LOD), a first frame or a MapLibre without `updateData` sends the whole set.
   */
  private setFrameSource(data: FrameData, cap: Cap): Promise<void> {
    this.culledCap = cap;
    const src = this.map.getSource(this.ids.frameSrc) as GeoJSONSource | undefined;
    if (!src) return Promise.resolve();
    if (src !== this.frameSource) {
      // A source added again (after a style change) holds nothing.
      this.frameSource = src;
      this.mirror.clear();
    }
    const { diff } = this.mirror.update(cullFeatures(data.features, cap));
    this.syncHoverState();
    if (diff && typeof src.updateData === 'function') {
      if (diff.remove.length === 0 && diff.add.length === 0 && diff.update.length === 0) return Promise.resolve();
      return Promise.resolve(src.updateData(diff as unknown as UpdateDataArg));
    }
    return src.setData({ type: 'FeatureCollection', features: this.mirror.features() } as unknown as SetDataArg);
  }

  private setSource(id: string, fc: FeatureCollection): Promise<void> {
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    if (!src) return Promise.resolve();
    return src.setData(fc as unknown as SetDataArg);
  }

  private setSourceData(id: string, data: unknown): void {
    const src = this.map.getSource(id) as GeoJSONSource | undefined;
    if (src) void src.setData(data as SetDataArg).catch(() => undefined);
  }

  /**
   * Resolves on the first rendered frame in which the frame source has no tile
   * loading (so the new borders are on screen). Times out after 2.5 s so a
   * hidden map (no rendering) never blocks later year changes.
   */
  private waitRendered(timeoutMs = 2500): Promise<void> {
    return new Promise((resolve) => {
      const map = this.map;
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        map.off('render', onRender);
        resolve();
      };
      const onRender = (): void => {
        if (this.removed) return finish();
        try {
          if (map.isSourceLoaded(this.ids.frameSrc) && map.isSourceLoaded(this.ids.coastSrc)) finish();
        } catch {
          finish();
        }
      };
      const timer = setTimeout(finish, timeoutMs);
      map.on('render', onRender);
      map.triggerRepaint();
    });
  }

  // ---- hover & highlight -------------------------------------------------------

  private updateHover(): void {
    this.hoverRaf = 0;
    if (this.removed || !this.lastPoint) return;
    if (this.map.isMoving()) {
      this.setHover(null);
      return;
    }
    const hits = this.featuresAt(this.lastPoint);
    const best = hits[0];
    if (!best) {
      this.setHover(null);
      return;
    }
    this.setHover(Number(best.id));
    const emit = (): void => {
      if (!this.opts.onHover || this.hoverId !== Number(best.id) || !this.lastPoint) return;
      const polity = this.politiesIndex?.[best.pid];
      const info: HoverInfo = {
        id: Number(best.id),
        pid: best.pid,
        name: best.name,
        props: best,
        label: hoverLabel(best, polity, this.manifest?.years.present),
        lngLat: this.lastLngLat ?? [0, 0],
        point: { ...this.lastPoint },
        others: Math.max(0, new Set(hits.map((h) => h.pid)).size - 1),
      };
      if (polity) info.polity = polity;
      this.opts.onHover(info);
    };
    emit();
    if (!this.politiesIndex) void this.loadPolities().then(() => !this.removed && emit());
  }

  private setHover(id: number | null): void {
    if (id === this.hoverId) return;
    this.hoverId = id;
    if (this.added && !this.removed) {
      this.syncHoverState();
      this.refreshHighlight();
    }
    if (id === null) this.opts.onHover?.(null);
  }

  /**
   * Puts the hover feature-state on every part of the hovered polity on the frame
   * source, and takes it off the rest. Each part has an id of its own there (diffs need
   * unique ids), so the polity's record id maps to all of them.
   */
  private syncHoverState(): void {
    if (!this.added || this.removed) return;
    const ids = this.hoverId === null ? [] : this.mirror.idsOf(this.hoverId);
    const prev = this.hoverIds;
    if (ids === prev || (ids.length === 0 && prev.length === 0)) return;
    this.hoverIds = ids;
    const on = new Set(ids);
    const was = new Set(prev);
    try {
      for (const id of prev) if (!on.has(id)) this.map.setFeatureState({ source: this.ids.frameSrc, id }, { hover: false });
      for (const id of ids) if (!was.has(id)) this.map.setFeatureState({ source: this.ids.frameSrc, id }, { hover: true });
    } catch {
      /* source gone */
    }
  }

  private refreshHighlight(): void {
    if (!this.added || this.removed) return;
    const features: Feature[] = [];
    const hover = this.hoverId !== null ? this.current?.byId.get(this.hoverId) : undefined;
    if (hover) features.push({ type: 'Feature', geometry: hover.geometry, properties: { role: 'hover' } });
    if (this.selectedPid) {
      for (const f of this.current?.byPid.get(this.selectedPid) ?? []) {
        features.push({ type: 'Feature', geometry: f.geometry, properties: { role: 'select' } });
      }
    }
    this.setSourceData(this.ids.highlightSrc, { type: 'FeatureCollection', features });
  }

  // ---- globe outline -----------------------------------------------------------

  /** The globe's outline on screen; null when no rim is in view (zoomed in, or not a globe). */
  private globeDisc(): Disc | null {
    return globeDisc(this.map as unknown as DiscMap);
  }

  // ---- paint -------------------------------------------------------------------

  private setVisibility(layerId: string, visible: boolean): void {
    if (!this.added || this.removed) return;
    try {
      if (this.map.getLayer(layerId)) this.map.setLayoutProperty(layerId, 'visibility', visible ? 'visible' : 'none');
    } catch {
      /* ignore */
    }
  }

  /** Re-applies every paint property from the current theme/palette. */
  private refreshPaint(): void {
    if (!this.added || this.removed) return;
    const specs: LayerSpec[] = borderLayers(this.styleContext());
    // Layers whose visibility follows the theme (own outlines on or off, lines in a
    // transparent colour); base land keeps its own switch.
    const ids = this.ids;
    const themed = new Set([ids.edge, ids.border, ids.lakeShore, ids.coast, ids.hoverLine, ids.selectGlow, ids.selectLine]);
    for (const spec of specs) {
      if (!this.map.getLayer(spec.id)) continue;
      const visibility = spec.layout?.visibility;
      if (themed.has(spec.id) && typeof visibility === 'string') this.setVisibility(spec.id, visibility === 'visible');
      for (const [prop, value] of Object.entries(spec.paint ?? {})) {
        try {
          this.map.setPaintProperty(spec.id, prop as Parameters<MlMap['setPaintProperty']>[1], value as Parameters<MlMap['setPaintProperty']>[2]);
        } catch (err) {
          console.warn(`@alexs-atlas/globe: cannot set ${prop} on ${spec.id}`, err);
        }
      }
    }
  }

  private updateAria(year: number): void {
    try {
      const canvas = this.map.getCanvas();
      const count = this.current?.polygons ?? 0;
      canvas.setAttribute('aria-label', `Globe showing borders in ${formatYear(year)}${count ? `, ${count} areas` : ''}`);
    } catch {
      /* no canvas (tests) */
    }
  }
}
