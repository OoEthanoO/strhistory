// addBorderLayers(map, opts): the Alex’s Atlas border sources and layers on any
// MapLibre map — the host's own map (bring-your-own-map) or ChronoGlobe's.
import { formatYear, lodForZoom } from '@alexs-atlas/borders';
import type { Feature, FeatureCollection } from '@alexs-atlas/borders';
import type { Map as MlMap, MapMouseEvent, GeoJSONSource } from 'maplibre-gl';
import { normalizeColor, shade } from './color.js';
import { WHOLE, angularDistance, capContains, cullFeatures, growCap, isWhole, splitParts, type Cap } from './cull.js';
import { FrameScheduler, type FrameKey } from './frames.js';
import { hatchImage } from './hatch.js';
import { DEFAULT_PALETTE, blendPalette, hoverPalette, isPaletteFunction, overlayLinePalette } from './palette.js';
import { globeDisc, type Disc, type DiscMap } from './rim.js';
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
type PolityFeature = PolityFeatureLike;

/** Data of one displayed frame. */
interface FrameData {
  key: FrameKey;
  /** What the frame source shows (before culling): polygons, then border lines. */
  features: Feature[];
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
      out.push(this.current?.byId.get(Number(p.id))?.properties ?? p);
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
    this.refreshPaint();
    this.addHatch(true);
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
    const [polys, lines] = await Promise.all([this.borders.bordersAt(year, o), this.borders.linesAt(year, o)]);
    const byId = new Map<number, PolityFeature>();
    const byPid = new Map<string, PolityFeature[]>();
    for (const f of polys.features as PolityFeature[]) {
      byId.set(Number(f.properties.id), f);
      const list = byPid.get(f.properties.pid);
      if (list) list.push(f);
      else byPid.set(f.properties.pid, [f]);
    }
    const lineFeatures = lines.features as Feature[];
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
      features: [...splitParts(polys.features as Feature[]), ...lineFeatures.filter((f) => !isCoast(f))],
      coast: lineFeatures.find(isCoast) ?? null,
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
    const features = data.features.map((f) => {
      const p = f.properties as PolityProps | null;
      if (!p || f.geometry?.type === 'MultiLineString' || f.geometry?.type === 'LineString') return f;
      const [fill, hover, line, edge] = colorsOf(p);
      return { ...f, properties: { ...p, _fill: fill, _hover: hover, _line: line, _edge: edge } };
    });
    return { ...data, features };
  }

  private async applyFrame(data: FrameData, key: FrameKey, year: number): Promise<void> {
    if (this.removed) return;
    const t0 = now();
    this.setHover(null);
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
    if (!this.shownCoast || this.shownCoast.feature !== data.coast || !sameCap(this.shownCoast.cap, cap)) {
      this.shownCoast = { feature: data.coast, cap };
      const features = data.coast ? cullFeatures([data.coast], cap) : [];
      jobs.push(this.setSource(this.ids.coastSrc, { type: 'FeatureCollection', features }));
    }
    return Promise.all(jobs).then(() => undefined);
  }

  private setFrameSource(data: FrameData, cap: Cap): Promise<void> {
    this.culledCap = cap;
    return this.setSource(this.ids.frameSrc, { type: 'FeatureCollection', features: cullFeatures(data.features, cap) });
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
    const prev = this.hoverId;
    this.hoverId = id;
    if (this.added && !this.removed) {
      try {
        if (prev !== null) this.map.setFeatureState({ source: this.ids.frameSrc, id: prev }, { hover: false });
        if (id !== null) this.map.setFeatureState({ source: this.ids.frameSrc, id }, { hover: true });
      } catch {
        /* source gone */
      }
      this.refreshHighlight();
    }
    if (id === null) this.opts.onHover?.(null);
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
