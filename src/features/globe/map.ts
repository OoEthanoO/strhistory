/**
 * GlobeController — everything that touches the globe lives here, so the React
 * components only deal with state. One instance per mounted explorer.
 *
 * The globe is Alex's Atlas's ChronoGlobe (packages/globe, migration path C in
 * packages/globe/AGENTS.md §8.7): the borders of any year from the Alex's Atlas
 * dataset (served at /data/alexs-atlas/), the political-map colours of
 * map-colors.ts with each polity's own outline, curved labels in Newsreader, the
 * star field, the hover tooltip and click selection. Topic pins are HTML markers
 * on its MapLibre map (real <a> links), which keeps them keyboard- and
 * screen-reader-usable.
 */
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@alexs-atlas/globe/style.css';
// MapLibre 6 loads its worker from a URL relative to its own module, which a
// bundler cannot see. Bundle the worker explicitly and hand ChronoGlobe its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createBorders, type BordersClient, type Manifest } from '@alexs-atlas/borders';
import { ChronoGlobe, type GlobeView, type SelectInfo } from '@alexs-atlas/globe';
import { formatRange } from './era';
import { MAP_THEME, mapColor } from './map-colors';
import type { GlobeTopic } from './types';
import { pinOffsets } from './pin-layout';

/** The dataset's entry point; every other file it names is content-hashed. */
export const MANIFEST_URL = '/data/alexs-atlas/manifest.json';
/** Map labels are drawn locally from this self-hosted CSS font (BaseLayout loads it). */
const LABEL_FONT = 'Newsreader Variable';
/** The default camera: Europe, Africa and western Asia in view. */
const HOME_CENTER: [number, number] = [15, 30];
/** A note's pin is shown at least this close when the globe flies to it. */
const PIN_SCALE = 2 ** 0.9;

export interface GlobeCallbacks {
  onPinEnter(topic: GlobeTopic): void;
  onPinLeave(topic: GlobeTopic): void;
  /** Called on pin click. Leave the event alone to follow the link to the notes. */
  onPinClick(topic: GlobeTopic, event: MouseEvent): void;
  onLoadingChange(loading: boolean): void;
  /** The year whose borders are now on screen (null: before the dataset, physical geography only). */
  onBordersChange?(year: number | null): void;
  /** The year now shown, whether or not the dataset has borders for it. */
  onYearApplied?(year: number): void;
  onViewChange?(view: GlobeView): void;
  onInteractionEnd?(view: GlobeView): void;
  /** A polity was selected on the map (click) or by select(); null when cleared. */
  onSelect?(info: SelectInfo | null): void;
  /** The borders of a later year could not be loaded; the previous borders stay. */
  onDataError?(error: unknown): void;
  onFailure?(): void;
}

export interface GlobeOptions {
  year: number;
  view?: GlobeView;
  /** The explorer's own client, shared with its search and timeline (one download cache). */
  borders?: BordersClient;
  /** Smallest scale the user can zoom out to (default 0.6). */
  minScale?: number;
  /** The home page's preview: no hover tooltip. */
  compact?: boolean;
}

export interface PinState {
  active: Set<string>;
  selected: string | null;
  hovered: string | null;
}

export class GlobeController {
  readonly globe: ChronoGlobe;
  private readonly cb: GlobeCallbacks;
  private readonly container: HTMLElement;
  readonly borders: BordersClient;
  private manifest: Manifest | undefined;
  private markers = new Map<string, HTMLAnchorElement>();
  private pinEntries: Array<{ topic: GlobeTopic; marker: Marker; element: HTMLAnchorElement }> = [];
  private readonly ready: Promise<void>;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(container: HTMLElement, cb: GlobeCallbacks, options: GlobeOptions) {
    this.cb = cb;
    this.container = container;
    this.borders = options.borders ?? createBorders({ manifestUrl: MANIFEST_URL });
    const compact = options.compact ?? false;
    this.globe = new ChronoGlobe(
      container,
      {
        data: { client: this.borders },
        year: options.year,
        view: options.view ?? { center: HOME_CENTER, scale: 1 },
        minScale: options.minScale ?? 0.6,
        fontFamily: LABEL_FONT,
        // Names in capitals along each polity's shape, as on grand-strategy maps.
        labelMode: 'curved',
        // Map colours in the manner of a grand-strategy game (map-colors.ts).
        theme: MAP_THEME,
        palette: mapColor,
        hover: !compact,
        workerUrl,
        // The site credits the data itself, one click from every view (CC BY 4.0
        // §3(a)(2)): the explorer's info panel and the home globe's credit link.
        attribution: false,
      },
      {
        onYearApplied: (year) => {
          this.cb.onYearApplied?.(year);
          this.cb.onBordersChange?.(this.covers(year) ? year : null);
        },
        onLoadingChange: (loading) => this.cb.onLoadingChange(loading),
        onViewChange: (view) => this.cb.onViewChange?.(view),
        onInteractionEnd: (view) => this.cb.onInteractionEnd?.(view),
        onSelect: (info) => this.cb.onSelect?.(info),
        onFailure: (reason, error) => {
          // After the first frame, a year whose borders fail to load leaves ChronoGlobe
          // 'ready' with the previous borders, and the next year change retries: log it
          // and keep the map. Anything that leaves the globe 'failed' (WebGL, a lost
          // context, no first frame) falls back to the baked SVG globe. The state is
          // read from the container: a WebGL failure arrives inside ChronoGlobe's
          // constructor, before this.globe is assigned.
          if (reason === 'data' && container.getAttribute('data-ca-state') === 'ready') {
            console.error('Could not load the borders', error);
            this.cb.onDataError?.(error);
            return;
          }
          this.cb.onFailure?.();
        },
      },
    );
    this.borders.ready().then((manifest) => { this.manifest = manifest; }, () => {});
    // Resolves once the first year's borders rendered; on failure onFailure reports it
    // and this never resolves (the baked SVG globe stays in place).
    this.ready = this.globe.whenReady().catch(() => new Promise<void>(() => {}));
    const map = this.mapOrNull();
    if (map) {
      map.on('move', () => this.layoutPins());
      // A click is a completed gesture too (the home page hands off to /globe on it).
      map.on('click', () => this.cb.onInteractionEnd?.(this.getView()));
    }
  }

  /** The MapLibre map, or null when WebGL failed or after destroy(). */
  get map(): MapLibreMap | null {
    return this.mapOrNull();
  }

  private mapOrNull(): MapLibreMap | null {
    try {
      return this.globe.map;
    } catch {
      return null;
    }
  }

  whenReady() {
    return this.ready;
  }

  // ---------- borders ----------

  /** Whether the dataset has borders for `year` (before it: physical geography). */
  private covers(year: number): boolean {
    const years = this.manifest?.years;
    return !years || (year >= years.from && year <= years.to);
  }

  /** Shows the borders of `year` (coalesced, latest wins; the old borders stay until the new ones rendered). */
  setYear(year: number) {
    this.globe.setYear(year);
  }

  /** While true (a timeline drag or playback) borders load at the coarsest level of detail. */
  setInteracting(active: boolean) {
    this.globe.setInteracting(active);
  }

  /** Warm the cache for years the user is likely to open next. */
  prefetch(years: number[]) {
    if (this.globe.loadState === 'failed') return; // nothing could show them
    const run = () => years.forEach((y) => { if (y !== 0) this.borders.prefetch(y); });
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 800);
  }

  /** Clears the polity selected by a click on the map. */
  clearSelection() {
    this.globe.select(null);
  }

  // ---------- pins ----------

  setTopics(topics: GlobeTopic[]) {
    // A removed pin never fires mouseleave or blur.
    this.container.classList.remove('is-pin-hovered');
    for (const { marker } of this.pinEntries) marker.remove();
    this.pinEntries = [];
    this.markers.clear();
    const map = this.mapOrNull();
    if (!map) return;
    for (const topic of topics) {
      const el = document.createElement('a');
      el.className = 'globe-pin';
      el.href = topic.href;
      el.dataset.slug = topic.slug;
      el.dataset.paper = String(topic.paper);
      el.innerHTML =
        '<svg class="globe-pin__stem" viewBox="-100 -100 200 200" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0" /></svg><span class="globe-pin__dot"></span><span class="globe-pin__label"></span>';
      el.querySelector('.globe-pin__label')!.textContent = topic.shortTitle;
      // The map's polity tooltip stays hidden while a pin has the pointer or focus.
      const enter = () => { this.container.classList.add('is-pin-hovered'); this.cb.onPinEnter(topic); };
      const leave = () => { this.container.classList.remove('is-pin-hovered'); this.cb.onPinLeave(topic); };
      el.addEventListener('mouseenter', enter);
      el.addEventListener('mouseleave', leave);
      el.addEventListener('focus', enter);
      el.addEventListener('blur', leave);
      el.addEventListener('click', (e) => {
        // The link opens the note; the click must not also select the polity under the pin.
        e.stopPropagation();
        this.cb.onPinClick(topic, e);
      });
      const marker = new Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' })
        .setLngLat([topic.lng, topic.lat])
        .addTo(map);
      this.pinEntries.push({ topic, marker, element: el });
      this.markers.set(topic.slug, el);
      this.describePin(el, topic);
      el.classList.add('is-active');
    }
    this.layoutPins();
  }

  private layoutPins() {
    const map = this.mapOrNull();
    if (!map) return;
    const { clientWidth: width, clientHeight: height } = map.getContainer();
    const points = this.pinEntries.map(({ topic }) => {
      const point = map.project([topic.lng, topic.lat]);
      return { id: topic.slug, x: point.x, y: point.y };
    });
    const offsets = pinOffsets(points);
    this.pinEntries.forEach(({ topic, marker, element }, i) => {
      const [x, y] = offsets.get(topic.slug) ?? [0, 0];
      marker.setOffset([x, y]);
      const stem = element.querySelector('line')!;
      stem.setAttribute('x2', String(-x));
      stem.setAttribute('y2', String(-y));
      // Pins off the screen leave the Tab order (the notes panel still reaches them).
      const px = points[i].x + x;
      const py = points[i].y + y;
      element.tabIndex = px < 0 || py < 0 || px > width || py > height ? -1 : 0;
    });
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
  }

  private describePin(el: HTMLAnchorElement, topic: GlobeTopic) {
    const range = formatRange(topic.start, topic.end);
    el.setAttribute(
      'aria-label',
      `${topic.title} (${range}), ${topic.place} — open notes`,
    );
  }

  // ---------- camera ----------
  // A view is { center, scale } with scale = 2^(zoom − fit zoom), shared with the home
  // page's handoff URL and the baked SVG globe (PrebakedGlobe). The SVG is an
  // orthographic approximation of MapLibre's perspective globe, so the globe shifts
  // slightly in size and position when WebGL takes over.

  getView(): GlobeView {
    return this.globe.getView();
  }

  setView(center: [number, number], scale = 1) {
    this.globe.setView({ center, scale });
  }

  /**
   * Flies to a note's place. `offset` (px) moves the place off the centre of the map,
   * e.g. to keep it clear of panels and cards over the globe.
   */
  flyTo(topic: GlobeTopic, o: { offset?: [number, number]; animate?: boolean } = {}) {
    this.globe.stopSpin();
    const map = this.mapOrNull();
    if (!map) return;
    const { scale } = this.getView();
    map.flyTo({
      center: [topic.lng, topic.lat],
      zoom: map.getZoom() + Math.log2(Math.max(scale, PIN_SCALE) / scale),
      offset: o.offset ?? [0, 0],
      duration: this.reducedMotion || o.animate === false ? 0 : 1800,
      essential: true,
    });
  }

  zoomBy(delta: number) {
    this.globe.stopSpin();
    this.globe.zoomBy(delta);
  }

  resetView() {
    this.globe.stopSpin();
    this.globe.setView({ center: HOME_CENTER, scale: 1 }, { animate: true });
  }

  /** Slow idle rotation until the user touches the globe. */
  startSpin() {
    this.globe.startSpin();
  }

  stopSpin() {
    this.globe.stopSpin();
  }

  destroy() {
    this.pinEntries = [];
    this.markers.clear();
    this.globe.destroy();
  }
}
