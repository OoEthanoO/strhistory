/**
 * GlobeController — everything that touches MapLibre lives here, so the React
 * components only deal with state. One instance per mounted explorer.
 *
 * Borders come from the Alex's Atlas dataset (packages/borders, served at
 * /data/alexs-atlas/): `bordersAt(year)` gives the borders of any year from
 * 3400 BCE to the present, clipped to Natural Earth coastlines.
 *
 * Layers (bottom → top): ocean, graticule, Natural Earth land, historical
 * polities (fill, overlays, borders), lakes, hover outline, polity labels. Topic
 * pins are HTML markers (real <a> links), which keeps them keyboard- and
 * screen-reader-usable.
 */
import {
  Map as MapLibreMap,
  Marker,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a URL relative to its own module, which a
// bundler cannot see. Bundle the worker explicitly and hand MapLibre its URL.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createBorders, lodForZoom, type BordersClient, type LodId, type Manifest } from '@alexs-atlas/borders';
import { splitParts } from '@alexs-atlas/globe';
import { formatRange } from './era';
import { colorFor, LAND_BASE, OCEAN, UNCLAIMED } from './palette';
import type { GlobeTopic, PolityHover } from './types';
import { pinOffsets } from './pin-layout';

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
  onLoadingChange(loading: boolean): void;
  /** The year whose borders are now on screen (null: physical geography only). */
  onBordersChange?(year: number | null): void;
  onViewChange?(view: { center: [number, number]; scale: number }): void;
  onInteractionEnd?(view: { center: [number, number]; scale: number }): void;
  onFailure?(): void;
}

export interface PinState {
  active: Set<string>;
  selected: string | null;
  hovered: string | null;
}

/** The dataset's entry point; every other file it names is content-hashed. */
export const MANIFEST_URL = '/data/alexs-atlas/manifest.json';
// Tier 0 partitions the land between polities and unclaimed land; tier 1
// (indigenous nations, disputed areas) overlays it without carving it.
const BASE: ExpressionSpecification = ['==', ['get', 'tier'], 0];
const OVERLAY: ExpressionSpecification = ['==', ['get', 'tier'], 1];
const CLAIMED: ExpressionSpecification = ['!=', ['get', 'kind'], 'unclaimed'];
const APPROXIMATE: ExpressionSpecification = ['==', ['get', 'precision'], 'approximate'];
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
// MapLibre creates finer tiles as zoom increases. Retain subpixel coastlines
// and small borders instead of applying the default 0.375-pixel tolerance.
const GEOMETRY_TOLERANCE = 0.1;

/** Zoom at which the whole globe fits comfortably in the element. */
export function fitZoom(el: HTMLElement, _compact = false): number {
  const m = Math.max(100, Math.min(el.clientWidth, el.clientHeight));
  // Calibrated to the baked SVG's 90% diameter at the fixed globe perspective.
  return Math.log2((m * Math.PI) / 512);
}

function graticule(step: number): FeatureCollection {
  const features: Feature[] = [];
  for (let lng = -180; lng < 180; lng += step) {
    const coords: number[][] = [];
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lng, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const coords: number[][] = [];
    for (let lng = -180; lng <= 180; lng += 2) coords.push([lng, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

function buildStyle(): StyleSpecification {
  const hovered = ['boolean', ['feature-state', 'hover'], false];
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
      graticule: { type: 'geojson', data: graticule(15) as never },
      land: { type: 'geojson', data: EMPTY as never, tolerance: GEOMETRY_TOLERANCE },
      polities: { type: 'geojson', data: EMPTY as never, tolerance: GEOMETRY_TOLERANCE },
      lakes: { type: 'geojson', data: EMPTY as never, tolerance: GEOMETRY_TOLERANCE },
      labels: { type: 'geojson', data: EMPTY as never },
    },
    layers: [
      { id: 'ocean', type: 'background', paint: { 'background-color': OCEAN } },
      {
        id: 'graticule',
        type: 'line',
        source: 'graticule',
        paint: { 'line-color': '#a9c1e0', 'line-opacity': 0.07, 'line-width': 0.6 },
      },
      { id: 'land', type: 'fill', source: 'land', paint: { 'fill-color': LAND_BASE } },
      {
        id: 'polity-fill',
        type: 'fill',
        source: 'polities',
        filter: BASE,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', hovered as never, 1, 0.88],
        },
      },
      {
        // Indigenous nations and disputed areas lie over tier 0, translucent.
        id: 'polity-overlay',
        type: 'fill',
        source: 'polities',
        filter: OVERLAY,
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': ['case', hovered as never, 0.7, 0.4],
        },
      },
      {
        id: 'polity-border',
        type: 'line',
        source: 'polities',
        filter: ['all', BASE, CLAIMED, ['!', APPROXIMATE]],
        paint: {
          'line-color': 'rgba(6, 9, 14, 0.75)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.4],
        },
      },
      {
        // Approximate extents and overlays are drawn dashed so students can see it.
        id: 'polity-border-approx',
        type: 'line',
        source: 'polities',
        filter: ['all', CLAIMED, ['any', OVERLAY, APPROXIMATE]],
        paint: {
          'line-color': 'rgba(6, 9, 14, 0.6)',
          'line-width': ['interpolate', ['linear'], ['zoom'], 1, 0.5, 6, 1.2],
          'line-dasharray': [2, 2],
        },
      },
      // Natural Earth lakes are not holes in the land, so draw them over the fills.
      { id: 'lakes', type: 'fill', source: 'lakes', paint: { 'fill-color': OCEAN } },
      {
        id: 'polity-hover',
        type: 'line',
        source: 'polities',
        filter: CLAIMED,
        paint: {
          'line-color': '#fff4dc',
          'line-width': 1.6,
          'line-opacity': ['case', hovered as never, 0.95, 0],
        },
      },
      {
        id: 'polity-label',
        type: 'symbol',
        source: 'labels',
        filter: CLAIMED,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['noto-sans'],
          // `a` is the polity's area in km².
          'text-size': [
            'interpolate', ['linear'], ['zoom'],
            1, ['interpolate', ['linear'], ['get', 'a'], 12000, 8, 500000, 10, 5000000, 12.5],
            5, ['interpolate', ['linear'], ['get', 'a'], 12000, 12, 500000, 15, 5000000, 19],
          ],
          'text-max-width': 7,
          'text-letter-spacing': 0.03,
          'text-padding': 4,
          'symbol-sort-key': ['-', 0, ['get', 'a']],
        },
        paint: {
          'text-color': 'rgba(255, 250, 240, 0.88)',
          'text-halo-color': 'rgba(8, 10, 16, 0.78)',
          'text-halo-width': 1.3,
          'text-halo-blur': 0.4,
        },
      },
    ],
  };
}

/**
 * One feature per polygon part (MapLibre can leave a whole polity unfilled when a
 * sliver part flips winding as it is tiled), coloured by the polity's empire.
 */
function colorize(fc: { features: unknown[] }, year: number): FeatureCollection {
  const features = splitParts(fc.features as Feature[] as never[]) as Feature[];
  return {
    type: 'FeatureCollection',
    features: features.map((feature) => {
      const properties = { ...feature.properties };
      properties.color = properties.kind === 'unclaimed'
        ? UNCLAIMED
        : colorFor((properties.subjecto as string) ?? (properties.partof as string) ?? (properties.name as string), year);
      return { ...feature, properties };
    }),
  };
}

export class GlobeController {
  readonly map: MapLibreMap;
  private cb: GlobeCallbacks;
  private markers = new Map<string, HTMLAnchorElement>();
  private markerObjs: Marker[] = [];
  private pinEntries: Array<{ topic: GlobeTopic; marker: Marker; element: HTMLAnchorElement }> = [];
  private readonly borders: BordersClient = createBorders({ manifestUrl: MANIFEST_URL });
  private manifest: Manifest | undefined;
  private lod: LodId = 'l0';
  private year: number | null = null;
  /** The decoded frame on the map (shared and read-only), to skip same-frame updates. */
  private shown: unknown = null;
  private hoveredId: number | string | null = null;
  private spinning = false;
  private readonly ready: Promise<void>;
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly compact: boolean;
  private destroyed = false;
  private yearRequest = 0;
  private revealCleanup: (() => void) | undefined;
  private fitLevel: number;
  private readonly resizeObserver: ResizeObserver;

  constructor(container: HTMLElement, cb: GlobeCallbacks, center: [number, number] = [15, 30], options: { compact?: boolean } = {}) {
    this.cb = cb;
    this.compact = options.compact ?? false;
    this.fitLevel = fitZoom(container, this.compact);
    this.map = new MapLibreMap({
      container,
      style: buildStyle(),
      center,
      zoom: this.fitLevel,
      minZoom: -1,
      maxZoom: 7,
      attributionControl: false,
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
    });
    this.resizeObserver.observe(container);
    // A loaded style is not a rendered globe. Keep the interactive baked globe
    // visible until the dataset's land has arrived and reached a render frame.
    this.ready = new Promise((resolve) => {
      this.map.once('load', () => {
        this.loadBase()
          .then(() => this.afterRender('land', () => { if (!this.destroyed) resolve(); }))
          .catch((error) => {
            console.error('Could not load the borders dataset', error);
            if (!this.destroyed) this.cb.onFailure?.();
          });
      });
    });
    this.map.getCanvas().addEventListener('webglcontextlost', () => this.cb.onFailure?.());
    this.map.on('move', () => { this.cb.onViewChange?.(this.getView()); this.layoutPins(); });
    for (const type of ['dragend', 'zoomend'] as const) {
      this.map.on(type, (event) => { if (event.originalEvent) this.cb.onInteractionEnd?.(this.getView()); });
    }
    this.map.on('zoomend', () => this.updateLod());
    this.map.on('click', () => this.cb.onInteractionEnd?.(this.getView()));
    this.bindInteractions();
  }

  whenReady() {
    return this.ready;
  }

  // ---------- borders ----------

  /** Natural Earth land and lakes at the current level of detail. */
  private async loadBase() {
    this.manifest ??= await this.borders.ready();
    const lod = this.lod;
    const [land, lakes] = await Promise.all([this.borders.base('land', lod), this.borders.base('lakes', lod)]);
    if (this.destroyed || lod !== this.lod) return;
    (this.map.getSource('land') as GeoJSONSource).setData(land as never);
    (this.map.getSource('lakes') as GeoJSONSource).setData(lakes as never);
  }

  /** Runs `done` once `source` has loaded its data and the map has rendered it. */
  private afterRender(source: string, done: () => void): () => void {
    const check = () => {
      if (this.destroyed || !this.map.isSourceLoaded(source)) return;
      this.map.off('sourcedata', check);
      this.map.once('render', done);
      this.map.triggerRepaint();
    };
    this.map.on('sourcedata', check);
    check();
    return () => this.map.off('sourcedata', check);
  }

  /** Finer geometry as the camera zooms in (the dataset's levels of detail). */
  private updateLod() {
    if (!this.manifest || this.destroyed) return;
    const lod = lodForZoom(this.manifest, this.map.getZoom()) as LodId;
    if (lod === this.lod) return;
    this.lod = lod;
    this.loadBase().catch((error) => console.error('Could not load land at', lod, error));
    void this.setYear(this.year);
  }

  /**
   * Shows the borders of `year` (any year the dataset covers; outside it, and for
   * null, physical geography only). Latest request wins; `onBordersChange`
   * reports the year once its borders have rendered.
   */
  async setYear(year: number | null) {
    const request = ++this.yearRequest;
    this.revealCleanup?.();
    this.cb.onLoadingChange(true);
    try {
      await this.ready;
      const manifest = this.manifest!;
      if (this.destroyed || request !== this.yearRequest) return;
      const covered = year !== null && year >= manifest.years.from && year <= manifest.years.to ? year : null;
      this.year = covered;
      const lod = this.lod;
      const [frame, labels] = covered === null
        ? [null, null]
        : await Promise.all([this.borders.bordersAt(covered, { lod }), this.borders.labelsAt(covered, { lod })]);
      if (this.destroyed || request !== this.yearRequest) return;
      if (frame !== this.shown) {
        this.shown = frame;
        this.clearHover();
        this.cb.onPolityHover(null);
        this.map.removeFeatureState({ source: 'polities' });
        await Promise.all([
          (this.map.getSource('polities') as GeoJSONSource).setData((frame ? colorize(frame, covered!) : EMPTY) as never),
          (this.map.getSource('labels') as GeoJSONSource).setData((labels ?? EMPTY) as never),
        ]);
        if (this.destroyed || request !== this.yearRequest) return;
      }
      this.revealCleanup = this.afterRender('polities', () => {
        if (!this.destroyed && request === this.yearRequest) this.cb.onBordersChange?.(covered);
      });
    } catch (err) {
      console.error(`Could not load the borders of ${year}`, err);
    } finally {
      if (request === this.yearRequest && !this.destroyed) this.cb.onLoadingChange(false);
    }
  }

  /** Warm the cache for years the user is likely to open next. */
  prefetch(years: number[]) {
    const run = () => years.forEach((y) => this.borders.prefetch(y, this.lod));
    if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 3000 });
    else setTimeout(run, 800);
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
        '<svg class="globe-pin__stem" viewBox="-100 -100 200 200" aria-hidden="true"><line x1="0" y1="0" x2="0" y2="0" /></svg><span class="globe-pin__dot"></span><span class="globe-pin__label"></span>';
      el.querySelector('.globe-pin__label')!.textContent = topic.shortTitle;
      el.addEventListener('mouseenter', () => this.cb.onPinEnter(topic));
      el.addEventListener('mouseleave', () => this.cb.onPinLeave(topic));
      el.addEventListener('focus', () => this.cb.onPinEnter(topic));
      el.addEventListener('blur', () => this.cb.onPinLeave(topic));
      el.addEventListener('click', (e) => this.cb.onPinClick(topic, e));
      const marker = new Marker({ element: el, anchor: 'center', opacityWhenCovered: '0' })
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

  private layoutPins() {
    const offsets = pinOffsets(this.pinEntries.map(({ topic }) => {
      const point = this.map.project([topic.lng, topic.lat]);
      return { id: topic.slug, x: point.x, y: point.y };
    }));
    for (const { topic, marker, element } of this.pinEntries) {
      const [x, y] = offsets.get(topic.slug) ?? [0, 0];
      marker.setOffset([x, y]);
      const stem = element.querySelector('line')!;
      stem.setAttribute('x2', String(-x));
      stem.setAttribute('y2', String(-y));
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
  }

  private describePin(el: HTMLAnchorElement, topic: GlobeTopic) {
    const range = formatRange(topic.start, topic.end);
    el.setAttribute(
      'aria-label',
      `${topic.title} (${range}), ${topic.place} — open notes`,
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
    // Overlays (indigenous nations, disputed areas) win over the land beneath them.
    const pick = (e: MapMouseEvent) => {
      let f: MapGeoJSONFeature | undefined;
      try {
        f = map.queryRenderedFeatures(e.point, { layers: ['polity-overlay', 'polity-fill'] })
          .find((feature) => feature.properties?.kind !== 'unclaimed');
      } catch { /* the style is still loading */ }
      if (!f || f.id === undefined) {
        this.clearHover();
        this.cb.onPolityHover(null);
        return;
      }
      if (f.id !== this.hoveredId) {
        this.clearHover();
        this.hoveredId = f.id;
        map.setFeatureState({ source: 'polities', id: f.id }, { hover: true });
      }
      const name = f.properties?.name as string | undefined;
      this.cb.onPolityHover(
        name
          ? { name, subjecto: (f.properties?.subjecto as string) ?? null, x: e.point.x, y: e.point.y }
          : null,
      );
    };
    map.on('mousemove', pick);
    map.on('click', pick); // touch devices have no hover
    map.getCanvas().addEventListener('mouseleave', () => {
      this.clearHover();
      this.cb.onPolityHover(null);
    });
    for (const type of ['mousedown', 'touchstart', 'wheel', 'dragstart'] as const) {
      map.on(type, this.stopSpin);
    }
  }

  private clearHover() {
    if (this.hoveredId !== null) {
      this.map.setFeatureState({ source: 'polities', id: this.hoveredId }, { hover: false });
      this.hoveredId = null;
    }
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.revealCleanup?.();
    this.stopSpin();
    this.map.remove();
  }
}
