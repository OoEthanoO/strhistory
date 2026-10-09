// Lifecycle checks behind the React / Astro recipes (packages/globe/AGENTS.md §8.3–8.4).
// React 18/19 StrictMode runs every effect twice in development:
// mount → cleanup → mount, synchronously. A wrapper that creates the globe in
// useEffect and destroys it in the cleanup is safe only if ChronoGlobe can be
// destroyed at any point of its startup and re-created in the same container.
// This page runs those sequences against the real component and publishes the
// outcome on window.__recipe for scripts/recipes.mjs.
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../src/style.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ChronoGlobe, type ChronoGlobeOptions } from '../src/index.js';

const options = (year: number): ChronoGlobeOptions => ({
  data: { manifestUrl: '/data/alexs-atlas/manifest.json' },
  year,
  view: { center: [20, 35], scale: 1 },
  workerUrl,
});
const box = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const settle = (p: Promise<unknown>): Promise<string> => p.then(
  () => 'resolved',
  (e: unknown) => `rejected: ${(e as Error).message}`,
);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const result: Record<string, unknown> = {};

async function run(): Promise<void> {
  // 1) StrictMode: mount → cleanup → mount in the same container, synchronously.
  const main = box('main');
  const first = new ChronoGlobe(main, options(1453));
  const firstReady = settle(first.whenReady());
  first.destroy();
  const second = new ChronoGlobe(main, options(1453));
  result.strictFirstWhenReady = await firstReady;
  result.strictSecondWhenReady = await settle(second.whenReady());
  result.strictChildren = main.querySelectorAll(':scope > .ca-globe').length;
  result.strictState = main.dataset.caState;

  // 2) Unmount after the style loaded but before the first borders rendered.
  const mid = box('mid');
  const third = new ChronoGlobe(mid, options(1700));
  const thirdReady = settle(third.whenReady());
  await new Promise<void>((resolve) => third.map.once('load', () => resolve()));
  third.destroy();
  result.midLoadWhenReady = await thirdReady;
  result.midLoadLeftovers = mid.children.length;
  result.midLoadStateAttr = mid.getAttribute('data-ca-state');

  // 3) Unmount while a year change is loading/rendering.
  const late = box('late');
  const fourth = new ChronoGlobe(late, options(1914));
  await fourth.whenReady();
  fourth.setYear(-500); // a different chunk: fetch + decode + render in flight
  fourth.destroy();
  await sleep(1500); // let any stray callbacks fire
  result.lateLeftovers = late.children.length;

  // 4) The surviving globe still works after its siblings were torn down.
  const t0 = performance.now();
  second.setYear(1914);
  await second.layers?.setYear(1914); // resolves once 1914 has rendered
  result.survivorYear = second.getYear();
  result.survivorYearChangeMs = Math.round(performance.now() - t0);
  result.ok =
    result.strictSecondWhenReady === 'resolved' &&
    String(result.strictFirstWhenReady).startsWith('rejected') &&
    result.strictChildren === 1 &&
    result.strictState === 'ready' &&
    String(result.midLoadWhenReady).startsWith('rejected') &&
    result.midLoadLeftovers === 0 &&
    result.midLoadStateAttr === null &&
    result.lateLeftovers === 0 &&
    result.survivorYear === 1914;
}

run()
  .catch((err: unknown) => {
    result.ok = false;
    result.error = String(err);
  })
  .finally(() => {
    (window as unknown as { __recipe: unknown }).__recipe = result;
  });
