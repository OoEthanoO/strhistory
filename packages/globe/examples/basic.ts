// Dev entry for examples/basic.html (served by `npm run dev -w @alexs-atlas/globe`).
// URL parameters: year, lon, lat, scale, select (pid), shot=1 (hide UI).
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
// = '@alexs-atlas/globe/style.css' for an installed package.
import '../src/style.css';
// Vite: the worker as a separate ES module file (MapLibre 6 cannot find it once bundled).
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ChronoGlobe } from '../src/index.js';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number): number => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
if (q.get('shot') === '1') document.body.classList.add('shot');

const status = document.getElementById('status') as HTMLParagraphElement;
const yearInput = document.getElementById('year') as HTMLInputElement;
const log = (msg: string): void => {
  status.textContent = msg;
};

const globe = new ChronoGlobe(
  document.getElementById('globe') as HTMLElement,
  {
    data: { manifestUrl: '/data/alexs-atlas/manifest.json' },
    year: num('year', 1914),
    view: { center: [num('lon', 20), num('lat', 30)], scale: num('scale', 1) },
    workerUrl,
    exposeAs: '__globe',
    padding: { top: 60, right: 40, bottom: 40, left: 40 },
  },
  {
    onYearApplied: (y) => {
      yearInput.value = String(y);
      const t = globe.layers?.timings().at(-1);
      log(`Borders of ${y}${t ? ` — frame ${t.frame}, load ${t.loadMs} ms, render ${t.renderMs} ms` : ''}`);
    },
    onHover: (info) => {
      if (info) log(info.label);
    },
    onSelect: (info) => log(info ? `Selected ${info.props?.name ?? info.pid}` : 'Selection cleared'),
    onFailure: (reason, err) => log(`Failed (${reason}): ${String(err)}`),
  },
);

const select = q.get('select');
if (select) globe.select(select);

document.getElementById('bar')!.addEventListener('click', (e) => {
  const step = (e.target as HTMLElement).closest<HTMLElement>('[data-step]')?.dataset.step;
  if (!step) return;
  let y = globe.getYear() + Number(step);
  if (y === 0) y = Number(step) > 0 ? 1 : -1;
  globe.setYear(y);
});
document.getElementById('bar')!.addEventListener('submit', (e) => {
  e.preventDefault();
  const y = Math.round(Number(yearInput.value));
  if (Number.isFinite(y) && y !== 0) globe.setYear(y);
});
yearInput.addEventListener('change', () => {
  const y = Math.round(Number(yearInput.value));
  if (Number.isFinite(y) && y !== 0) globe.setYear(y);
});
document.getElementById('spin')!.addEventListener('click', () => (globe.isSpinning ? globe.stopSpin() : globe.startSpin()));
