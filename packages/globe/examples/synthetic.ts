// Rendering check for feature kinds the dev dataset does not contain yet:
// tier-1 overlays (tint + hatch + dashed outline) and `precision: 'approximate'`
// (dashed border). It wraps the real client and adds SYNTHETIC attributes and
// one synthetic overlay polygon. A visual test only — nothing here is data.
// Driven by scripts/screenshots.mjs (scene "synthetic-overlay"):
//   examples/synthetic.html?year=1914
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../src/style.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { createBorders, type BordersClient, type PolityProps } from '@alexs-atlas/borders';
import type { Feature, Point, Polygon } from 'geojson';
import { ChronoGlobe } from '../src/index.js';

const real = createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' });

/** Features drawn as if their extent were approximate (dashed border). */
const APPROXIMATE = /nejd|oman|ethiopia/i;
const OVERLAY_CENTER: [number, number] = [50.5, 20];
const overlayProps: PolityProps = {
  id: 990001,
  rid: 'test:overlay@1900',
  pid: 'test:overlay',
  name: 'Synthetic overlay',
  from: 1900,
  to: 1930,
  kind: 'indigenous',
  tier: 1,
  power: 'test:overlay',
  partof: null,
  subjecto: null,
  disputed: false,
  precision: 'approximate',
  c: 3,
  a: 650000,
  lx: OVERLAY_CENTER[0],
  ly: OVERLAY_CENTER[1],
  src: 'override',
};
const overlay: Feature<Polygon, PolityProps> = {
  type: 'Feature',
  id: overlayProps.id,
  properties: overlayProps,
  geometry: { type: 'Polygon', coordinates: [[[45, 16.5], [56, 16.5], [56, 23.5], [45, 23.5], [45, 16.5]]] },
};
const overlayLabel: Feature<Point, PolityProps> = {
  type: 'Feature',
  id: overlayProps.id,
  properties: overlayProps,
  geometry: { type: 'Point', coordinates: OVERLAY_CENTER },
};
const alive = (year: number): boolean => year >= overlayProps.from && year <= overlayProps.to;

const client: BordersClient = {
  ready: () => real.ready(),
  frameOf: (y) => real.frameOf(y),
  linesAt: (y, o) => real.linesAt(y, o),
  base: (name, lod) => real.base(name, lod),
  polities: () => real.polities(),
  polity: (pid) => real.polity(pid),
  search: (q, o) => real.search(q, o),
  prefetch: (y, lod) => real.prefetch(y, lod),
  async bordersAt(year, o) {
    const fc = await real.bordersAt(year, o);
    // Copies: the real client memoises its results, never mutate them.
    const features = fc.features.map((f) =>
      APPROXIMATE.test(f.properties.name) ? { ...f, properties: { ...f.properties, precision: 'approximate' as const } } : f,
    );
    return { ...fc, features: alive(year) ? [...features, overlay] : features };
  },
  async labelsAt(year, o) {
    const fc = await real.labelsAt(year, o);
    return alive(year) ? { ...fc, features: [...fc.features, overlayLabel] } : fc;
  },
};

const year = Number(new URLSearchParams(location.search).get('year') ?? 1914);
new ChronoGlobe(document.getElementById('globe') as HTMLElement, {
  data: { client },
  year,
  view: { center: [47, 21], scale: 4.5 },
  fontFamily: 'Inter Variable',
  workerUrl,
  exposeAs: '__globe',
});
(window as unknown as { __overlayCenter: [number, number] }).__overlayCenter = OVERLAY_CENTER;
