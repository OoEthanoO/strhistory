// ChronoGlobe: a framework-agnostic MapLibre 6 globe showing the borders of a
// year. Thin shell around addBorderLayers(): map creation, view math, resize,
// spin, tooltip, readiness/failure states. No DOM access at import time.
import { attributionHtml, createBorders } from '@alexs-atlas/borders';
import { AttributionControl, Map as MlMap, setWorkerUrl } from 'maplibre-gl';
import { BorderLayers } from './border-layers.js';
import { globeDisc, type DiscMap } from './rim.js';
import { makeStars, paintStars, type StarCatalog } from './sky.js';
import { buildBaseStyle, skySpec } from './style.js';
import { readCssTheme, resolveTheme } from './theme.js';
import type {
  BordersClient,
  ChronoGlobeCallbacks,
  ChronoGlobeOptions,
  FailureReason,
  GlobeTheme,
  GlobeView,
  HoverInfo,
  PolityFeatureLike,
  SelectInfo,
} from './types.js';
import {
  DEFAULT_VIEW,
  bboxOfCoordinates,
  bboxToLngLatBounds,
  fitInsideMapPadding,
  fitZoom,
  normalizePadding,
  normalizeView,
  positionsOf,
  scaleToZoom,
  unionBBoxes,
  zoomToScale,
  type BBox,
} from './view.js';

type StyleArg = Exclude<ConstructorParameters<typeof MlMap>[0]['style'], undefined>;

export type GlobeState = 'loading' | 'ready' | 'failed';

/** Degrees of longitude per second when spinning at scale 1 (a turn in 2 minutes). */
const SPIN_DEG_PER_S = 3;
/** Hover tooltip delay (AGENTS.md §7.3). */
const TOOLTIP_DELAY_MS = 120;
/** Fallback container size while it is not laid out yet (0×0). */
const FALLBACK_SIZE = { width: 800, height: 600 };

const raf = (cb: FrameRequestCallback): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : (setTimeout(() => cb(Date.now()), 16) as unknown as number);
const cancelRaf = (h: number): void => {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(h);
  else clearTimeout(h);
};

/** Normalises a year: integer, never 0 (1 BCE is −1, the year after it 1). */
function sanitizeYear(y: number): number {
  if (!Number.isFinite(y)) throw new RangeError(`@alexs-atlas/globe: year must be a finite number, got ${y}`);
  const r = Math.round(y);
  if (r === 0) {
    console.warn('@alexs-atlas/globe: there is no year 0 (historical numbering); showing 1 CE.');
    return 1;
  }
  return r;
}

function clientFor(data: ChronoGlobeOptions['data']): BordersClient {
  if ('client' in data) return data.client;
  if ('manifestUrl' in data) return createBorders({ manifestUrl: data.manifestUrl });
  return createBorders({ manifest: data.manifest, baseUrl: data.baseUrl });
}

export class ChronoGlobe {
  readonly container: HTMLElement;
  /** The element this component created inside `container` (star field, map, tooltip). */
  readonly root: HTMLDivElement;
  readonly borders: BordersClient;

  private readonly options: ChronoGlobeOptions;
  private readonly callbacks: ChronoGlobeCallbacks;
  private readonly mapEl: HTMLDivElement;
  /** The star field's canvas (sky.ts), under the map's transparent canvas. */
  private readonly skyEl: HTMLCanvasElement;
  private stars: StarCatalog | null = null;
  /** The view the stars were last painted for (skip repaints when it did not change). */
  private skyKey = '';
  private readonly tooltipEl: HTMLDivElement | null;
  private _map: MlMap | null = null;
  private _layers: BorderLayers | null = null;
  private theme: GlobeTheme;
  private year: number;
  private state: GlobeState = 'loading';
  private destroyed = false;
  private readonly initialView: GlobeView;
  private lastFit: number;
  private minScale: number;
  private resizeObserver: ResizeObserver | null = null;
  private motionQuery: MediaQueryList | null = null;
  private reducedMotion = false;
  private spinning = false;
  private spinRaf = 0;
  private viewRaf = 0;
  private userMoving = false;
  private tooltipTimer: ReturnType<typeof setTimeout> | null = null;
  private interacting = false;
  private labelsVisible: boolean;
  private pendingSelect: string | null | undefined = undefined;
  private readonly ready: Promise<void>;
  private settleReady!: (err?: unknown) => void;
  private readySettled = false;
  private readonly cleanup: (() => void)[] = [];

  constructor(container: HTMLElement, options: ChronoGlobeOptions, callbacks: ChronoGlobeCallbacks = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('@alexs-atlas/globe: container must be an HTMLElement');
    this.container = container;
    this.options = options;
    this.callbacks = callbacks;
    this.year = sanitizeYear(options.year);
    this.minScale = options.minScale ?? 0.6;
    this.labelsVisible = options.labels !== false;
    this.initialView = normalizeView({ center: options.view?.center ?? DEFAULT_VIEW.center, scale: options.view?.scale ?? DEFAULT_VIEW.scale });
    this.ready = new Promise<void>((resolve, reject) => {
      this.settleReady = (err?: unknown) => {
        if (this.readySettled) return;
        this.readySettled = true;
        if (err === undefined) resolve();
        else reject(err);
      };
    });
    this.ready.catch(() => undefined); // never an unhandled rejection; callers still see it

    // DOM: <container data-ca-state> > .ca-globe > (.ca-globe__sky, .ca-globe__map, .ca-globe__tooltip)
    this.root = document.createElement('div');
    this.root.className = 'ca-globe';
    this.skyEl = document.createElement('canvas');
    this.skyEl.className = 'ca-globe__sky';
    this.skyEl.setAttribute('aria-hidden', 'true');
    this.root.appendChild(this.skyEl);
    this.mapEl = document.createElement('div');
    this.mapEl.className = 'ca-globe__map';
    this.root.appendChild(this.mapEl);
    this.tooltipEl = options.tooltip === false || options.hover === false ? null : document.createElement('div');
    if (this.tooltipEl) {
      this.tooltipEl.className = 'ca-globe__tooltip';
      this.tooltipEl.setAttribute('aria-hidden', 'true'); // visual aid; the same text is in the canvas label/host UI
      this.tooltipEl.hidden = true;
      this.root.appendChild(this.tooltipEl);
    }
    container.appendChild(this.root);
    this.setState('loading');

    // Theme: defaults < --ca-* custom properties on the container < options.theme.
    this.theme = resolveTheme(readCssTheme(container), options.theme);
    this.applyRootTheme();

    this.borders = clientFor(options.data);
    if (options.exposeAs && typeof window !== 'undefined') (window as unknown as Record<string, unknown>)[options.exposeAs] = this;

    if (typeof matchMedia === 'function') {
      this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedMotion = this.motionQuery.matches;
      const onMotion = (e: MediaQueryListEvent): void => {
        this.reducedMotion = e.matches;
        if (e.matches) this.stopSpin();
      };
      this.motionQuery.addEventListener('change', onMotion);
      this.cleanup.push(() => this.motionQuery?.removeEventListener('change', onMotion));
    }

    const size = this.size();
    this.lastFit = fitZoom(size.width, size.height);
    this.createMap();
  }

  // ---- public API -----------------------------------------------------------------

  /** The MapLibre map (escape hatch, e.g. for markers). Throws if WebGL failed or after destroy(). */
  get map(): MlMap {
    if (!this._map) throw new Error(`@alexs-atlas/globe: no map (${this.destroyed ? 'destroyed' : this.state})`);
    return this._map;
  }

  /** The border layer controller (advanced: timings, frame features, theme/palette changes). */
  get layers(): BorderLayers | null {
    return this._layers;
  }

  get loadState(): GlobeState {
    return this.state;
  }

  /** Resolves when the first year's borders have rendered; rejects on failure or destroy(). */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Shows `year` (coalesced, latest wins; the previous borders stay until the new ones rendered). */
  setYear(year: number): void {
    if (this.destroyed) return;
    this.year = sanitizeYear(year);
    if (this._layers) void this._layers.setYear(this.year);
  }

  getYear(): number {
    return this.year;
  }

  /** Tell the globe a timeline drag is in progress (loads the coarsest LOD until false). */
  setInteracting(active: boolean): void {
    this.interacting = active;
    this._layers?.setInteracting(active);
  }

  getView(): GlobeView {
    const map = this._map;
    if (!map) return { ...this.initialView, center: [...this.initialView.center] as [number, number] };
    const c = map.getCenter();
    return normalizeView({ center: [c.lng, c.lat], scale: zoomToScale(map.getZoom(), this.lastFit) });
  }

  setView(view: Partial<GlobeView>, o: { animate?: boolean } = {}): void {
    const map = this._map;
    if (!map) return;
    const v = normalizeView(view, this.getView());
    const target = { center: v.center, zoom: scaleToZoom(Math.max(this.minScale, v.scale), this.lastFit) };
    if (o.animate && !this.reducedMotion) map.easeTo({ ...target, duration: 700 });
    else map.jumpTo(target);
  }

  /** Zoom in (+) or out (−) by `delta` zoom levels. */
  zoomBy(delta: number): void {
    const map = this._map;
    if (!map || !Number.isFinite(delta)) return;
    const zoom = map.getZoom() + delta;
    if (this.reducedMotion) map.jumpTo({ zoom });
    else map.easeTo({ zoom, duration: 300 });
  }

  /** Back to the initial camera. */
  resetView(): void {
    this.setView(this.initialView, { animate: true });
  }

  /**
   * Moves the camera to a polity: the bbox of its features in `year` (default:
   * the year shown), else the polity index bbox. Resolves false when unknown.
   */
  async flyToPolity(pid: string, o: { year?: number; padding?: ChronoGlobeOptions['padding'] } = {}): Promise<boolean> {
    const map = this._map;
    if (!map || this.destroyed) return false;
    let bbox: BBox | null = null;
    const year = o.year === undefined ? this.year : sanitizeYear(o.year);
    let feats: PolityFeatureLike[] = year === this.year && this._layers ? this._layers.featuresOf(pid) : [];
    if (!feats.length) {
      try {
        const fc = await this.borders.bordersAt(year);
        feats = fc.features.filter((f) => f.properties.pid === pid);
      } catch {
        feats = [];
      }
    }
    if (feats.length) {
      const boxes = feats.map((f) => bboxOfCoordinates(positionsOf(f.geometry))).filter((b): b is BBox => b !== null);
      bbox = unionBBoxes(boxes);
    }
    if (!bbox) {
      try {
        const info = await this.borders.polity(pid);
        if (info?.bbox) bbox = [...info.bbox] as BBox;
      } catch {
        /* index unavailable */
      }
    }
    if (!bbox || this.destroyed || !this._map) return false;
    const padding = normalizePadding(o.padding ?? this.options.padding);
    const maxZoom = Math.min(6, this.options.maxZoom ?? 7);
    const bounds = bboxToLngLatBounds(bbox);
    let cam;
    try {
      // A host's map padding (map.setPadding) is ignored by MapLibre 6.11.2's globe fit:
      // fit inside it explicitly (view.ts fitInsideMapPadding); when MapLibre cannot fit
      // that (map padding over about half the canvas), use the plain fit.
      const el = map.getContainer();
      const fit = fitInsideMapPadding(padding, map.getPadding(), { width: el.clientWidth, height: el.clientHeight });
      cam = (fit ? map.cameraForBounds(bounds, { ...fit, maxZoom }) : undefined) ?? map.cameraForBounds(bounds, { padding, maxZoom });
    } catch {
      cam = undefined;
    }
    if (!cam?.center) return false;
    const minZoom = scaleToZoom(this.minScale, this.lastFit);
    const target = { center: cam.center, zoom: Math.max(minZoom, Math.min(maxZoom, cam.zoom ?? map.getZoom())) };
    this.stopSpin();
    if (this.reducedMotion) map.jumpTo(target);
    else map.flyTo({ ...target, duration: 1400, essential: false });
    return true;
  }

  /** Selects a polity by pid (outline persists across years); null clears. */
  select(pid: string | null): void {
    if (this._layers) this._layers.select(pid, 'api');
    else this.pendingSelect = pid;
  }

  getSelected(): string | null {
    return this._layers ? this._layers.getSelected() : (this.pendingSelect ?? null);
  }

  /** Shows or hides the polity labels (remembered if the map is not loaded yet). */
  setLabels(visible: boolean): void {
    this.labelsVisible = visible;
    this._layers?.setLabels(visible);
  }

  startSpin(): void {
    if (this.spinning || this.reducedMotion || !this._map || this.destroyed) return;
    this.spinning = true;
    let last = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const step = (t: number): void => {
      if (!this.spinning || !this._map) return;
      const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
      last = t;
      const map = this._map;
      if (!map.isMoving()) {
        const c = map.getCenter();
        const scale = Math.max(1, zoomToScale(map.getZoom(), this.lastFit));
        map.jumpTo({ center: [c.lng + (SPIN_DEG_PER_S * dt) / scale, c.lat] });
      }
      this.spinRaf = raf(step);
    };
    this.spinRaf = raf(step);
  }

  stopSpin(): void {
    this.spinning = false;
    if (this.spinRaf) cancelRaf(this.spinRaf);
    this.spinRaf = 0;
  }

  get isSpinning(): boolean {
    return this.spinning;
  }

  /** Re-measures the container (call after a layout change the ResizeObserver cannot see). */
  resize(): void {
    this.handleResize();
  }

  /** Changes theme colours at runtime (merged over the current theme). */
  setTheme(theme: Partial<GlobeTheme>): void {
    this.theme = resolveTheme(this.theme, theme);
    this.applyRootTheme();
    this.paintSky(true);
    this._layers?.setTheme(this.theme);
    const map = this._map;
    if (map && this._layers) {
      try {
        map.setPaintProperty(this.backgroundId(), 'background-color', this.theme.ocean);
        map.setSky(skySpec(this.theme) as Parameters<MlMap['setSky']>[0]);
      } catch {
        /* style not ready */
      }
    }
  }

  /** Removes everything this component added. Safe to call at any time, including mid-load. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.stopSpin();
    if (this.viewRaf) cancelRaf(this.viewRaf);
    if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
    this.resizeObserver?.disconnect();
    for (const off of this.cleanup.splice(0)) off();
    this._layers?.remove();
    this._layers = null;
    try {
      this._map?.remove();
    } catch {
      /* already gone */
    }
    this._map = null;
    this.root.remove();
    this.container.removeAttribute('data-ca-state');
    const handle = this.options.exposeAs;
    if (handle && typeof window !== 'undefined' && (window as unknown as Record<string, unknown>)[handle] === this) {
      delete (window as unknown as Record<string, unknown>)[handle];
    }
    this.settleReady(new Error('@alexs-atlas/globe: destroyed before it was ready'));
  }

  // ---- internals ------------------------------------------------------------------

  private size(): { width: number; height: number } {
    const width = this.root.clientWidth || this.container.clientWidth;
    const height = this.root.clientHeight || this.container.clientHeight;
    return width > 0 && height > 0 ? { width, height } : FALLBACK_SIZE;
  }

  private setState(s: GlobeState): void {
    this.state = s;
    this.container.setAttribute('data-ca-state', s);
  }

  private fail(reason: FailureReason, error?: unknown): void {
    if (this.destroyed) return;
    if (reason !== 'data' || this.state !== 'ready') this.setState('failed');
    this.callbacks.onFailure?.(reason, error);
    this.settleReady(error ?? new Error(`@alexs-atlas/globe: ${reason} failure`));
  }

  private backgroundId(): string {
    return `${this.options.layerPrefix ?? 'ca-'}ocean`;
  }

  private applyRootTheme(): void {
    this.root.classList.toggle('ca-globe--stars', this.theme.stars);
    if (this.options.theme?.space) this.root.style.setProperty('--ca-space', this.theme.space);
  }

  /**
   * Paints the star field (sky.ts) for the current camera: on every map render, but only
   * when the centre, zoom, size, field of view or padding changed (or `force`).
   */
  private paintSky(force = false): void {
    const map = this._map;
    if (!map || this.destroyed || !this.theme.stars) return;
    const canvas = this.skyEl;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!(w > 0 && h > 0)) return;
    const c = map.getCenter();
    const fovY = typeof map.getVerticalFieldOfView === 'function' ? map.getVerticalFieldOfView() : 36.87;
    const p = map.getPadding();
    const pad = { left: p.left ?? 0, right: p.right ?? 0, top: p.top ?? 0, bottom: p.bottom ?? 0 };
    const key = `${c.lng},${c.lat},${map.getZoom()},${w}x${h},${fovY},${pad.left},${pad.right},${pad.top},${pad.bottom}`;
    if (!force && key === this.skyKey) return;
    this.skyKey = key;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const cw = Math.round(w * dpr);
    const ch = Math.round(h * dpr);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const disc = globeDisc(map as unknown as DiscMap);
    if (!disc) {
      // No rim in view: the globe covers the canvas, so no star can show.
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      return;
    }
    this.stars ??= makeStars();
    const view = { lon: c.lng, lat: c.lat, fovY, width: w, height: h, cx: (w + pad.left - pad.right) / 2, cy: (h + pad.top - pad.bottom) / 2 };
    paintStars(ctx, this.stars, view, disc, dpr);
  }

  private createMap(): void {
    const o = this.options;
    if (o.workerUrl) setWorkerUrl(o.workerUrl);
    const maxZoom = o.maxZoom ?? 7;
    const view = this.initialView;
    let map: MlMap;
    try {
      map = new MlMap({
        container: this.mapEl,
        style: buildBaseStyle({ theme: this.theme, glyphs: o.glyphs, backgroundId: this.backgroundId() }) as unknown as StyleArg,
        center: view.center,
        zoom: scaleToZoom(view.scale, this.lastFit),
        minZoom: scaleToZoom(this.minScale, this.lastFit),
        maxZoom,
        renderWorldCopies: false,
        // North-up globe: no rotation, pitch or roll from any input.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        rollEnabled: false,
        maxPitch: 0,
        attributionControl: false,
        maplibreLogo: false,
        fadeDuration: 150,
        localIdeographFontFamily: o.fontFamily ?? 'sans-serif',
        ...(this.reducedMotion ? { reduceMotion: true } : {}),
      });
    } catch (err) {
      this.fail('webgl', err);
      return;
    }
    this._map = map;
    map.touchZoomRotate.disableRotation();
    map.keyboard.disableRotation();

    map.on('load', () => this.onMapLoad());
    map.on('webglcontextlost', () => this.fail('context-lost'));
    // The stars follow the camera in the same frame as the globe (cheap when it did not move).
    map.on('render', () => this.paintSky());
    map.on('move', () => {
      if (this.viewRaf || !this.callbacks.onViewChange) return;
      this.viewRaf = raf(() => {
        this.viewRaf = 0;
        if (!this.destroyed) this.callbacks.onViewChange?.(this.getView());
      });
    });
    map.on('movestart', (e) => {
      if ((e as { originalEvent?: Event }).originalEvent) {
        this.userMoving = true;
        this.stopSpin();
      }
    });
    map.on('moveend', () => {
      if (!this.userMoving) return;
      this.userMoving = false;
      this.callbacks.onInteractionEnd?.(this.getView());
    });
    // Any direct manipulation stops the spin.
    for (const type of ['mousedown', 'touchstart', 'wheel'] as const) map.on(type, () => this.stopSpin());

    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(() => this.handleResize());
      this.resizeObserver.observe(this.root);
    }
  }

  private onMapLoad(): void {
    const map = this._map;
    if (!map || this.destroyed) return;
    const o = this.options;
    const layers = new BorderLayers(map, {
      borders: this.borders,
      year: this.year,
      prefix: o.layerPrefix ?? 'ca-',
      palette: o.palette,
      labels: this.labelsVisible,
      labelMode: o.labelMode,
      relief: o.relief,
      hover: o.hover !== false,
      theme: this.theme,
      fontFamily: o.fontFamily,
      onYearApplied: (y) => this.callbacks.onYearApplied?.(y),
      onHover: (info) => this.onHover(info),
      onSelect: (info: SelectInfo | null) => this.callbacks.onSelect?.(info),
      onLoadingChange: (l) => this.callbacks.onLoadingChange?.(l),
      onFailure: (reason, err) => this.fail(reason, err),
    });
    this._layers = layers;
    if (this.interacting) layers.setInteracting(true);
    if (this.pendingSelect !== undefined) layers.select(this.pendingSelect, 'api');
    this.pendingSelect = undefined;
    void layers.setYear(this.year);
    layers.firstFrame.then(() => {
      if (this.destroyed) return;
      this.setState('ready');
      this.settleReady();
    });
    this.addAttribution();
  }

  private addAttribution(): void {
    const opt = this.options.attribution ?? true;
    if (opt === false) return;
    const add = (html: string): void => {
      if (!this._map || this.destroyed) return;
      this._map.addControl(new AttributionControl({ compact: true, customAttribution: html }), 'bottom-right');
    };
    if (typeof opt === 'string') add(opt);
    else
      this.borders
        .ready()
        .then((m) => add(attributionHtml(m)))
        .catch(() => undefined);
  }

  private handleResize(): void {
    const map = this._map;
    if (!map || this.destroyed) return;
    const { width, height } = { width: this.root.clientWidth, height: this.root.clientHeight };
    if (width === 0 || height === 0) return; // hidden: keep the last layout
    const scale = zoomToScale(map.getZoom(), this.lastFit);
    map.resize();
    this.lastFit = fitZoom(width, height);
    map.setMinZoom(scaleToZoom(this.minScale, this.lastFit));
    map.jumpTo({ zoom: scaleToZoom(scale, this.lastFit) });
  }

  private onHover(info: HoverInfo | null): void {
    this.callbacks.onHover?.(info);
    const tip = this.tooltipEl;
    if (!tip) return;
    if (!info) {
      if (this.tooltipTimer) clearTimeout(this.tooltipTimer);
      this.tooltipTimer = null;
      tip.hidden = true;
      return;
    }
    tip.textContent = info.others > 0 ? `${info.label} (+${info.others} more)` : info.label;
    this.positionTooltip(info.point);
    if (tip.hidden && !this.tooltipTimer) {
      this.tooltipTimer = setTimeout(() => {
        this.tooltipTimer = null;
        if (!this.destroyed && this._layers && tip.textContent) tip.hidden = false;
      }, TOOLTIP_DELAY_MS);
    }
  }

  private positionTooltip(p: { x: number; y: number }): void {
    const tip = this.tooltipEl;
    if (!tip) return;
    const w = this.root.clientWidth;
    const h = this.root.clientHeight;
    const tw = tip.offsetWidth || 160;
    const th = tip.offsetHeight || 28;
    // Offset from the pointer; flip to the other side near the right/bottom edges.
    const x = p.x + 14 + tw > w ? Math.max(4, p.x - 14 - tw) : p.x + 14;
    const y = p.y + 16 + th > h ? Math.max(4, p.y - 12 - th) : p.y + 16;
    tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  }
}
