// Visual + timing check of the globe in a real browser (headless Microsoft Edge, or
// Google Chrome without Edge, via playwright-core, SwiftShader WebGL — the setup root
// AGENTS.md §9 uses; ALEXS_ATLAS_BROWSER picks another browser, see browser.mjs).
//
//   node packages/globe/scripts/screenshots.mjs [--only name1,name2] [--no-timings] [--gpu]
//
// Starts the package's Vite dev server (examples/basic.html, dataset from
// packages/borders/data mounted at /data/alexs-atlas/), renders fixed views to
// .cache/screenshots/globe-<name>.png, measures year-change timings, and fails
// if the page makes any request to another origin or logs an error.
// SwiftShader renders on the CPU: timings are pessimistic compared to a GPU;
// --gpu uses the machine's GPU instead (headless Edge on Windows picks it up via ANGLE/D3D11).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { launchBrowser } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../..');
const outDir = path.join(repo, '.cache', 'screenshots');
fs.mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const only = args.includes('--only') ? new Set(args[args.indexOf('--only') + 1].split(',')) : null;
const doTimings = !args.includes('--no-timings');
const gpu = args.includes('--gpu');

/** name, year, lon, lat, scale, viewport, extra query, optional page action. */
const SCENES = [
  { name: '1914-world', year: 1914, lon: 20, lat: 30, scale: 1 },
  { name: '1914-europe', year: 1914, lon: 15, lat: 50, scale: 7 },
  { name: '1500-asia', year: 1500, lon: 80, lat: 30, scale: 1.4 },
  { name: '500bce-mediterranean', year: -500, lon: 30, lat: 35, scale: 3 },
  { name: '1800-caribbean', year: 1800, lon: -70, lat: 17, scale: 14 },
  { name: '1700-americas', year: 1700, lon: -85, lat: 30, scale: 1.3 },
  { name: '2026-world', year: 2026, lon: -40, lat: 20, scale: 1 },
  { name: '2026-aegean-z7', year: 2026, lon: 25, lat: 38, scale: 40 },
  { name: '1453-phone', year: 1453, lon: 30, lat: 40, scale: 1, viewport: { width: 390, height: 844 } },
  { name: '1914-hover-select', year: 1914, lon: 10, lat: 48, scale: 5, hover: true, select: 'auto' },
  { name: '3000bce-world', year: -3000, lon: 40, lat: 25, scale: 1.2 },
];

const server = await createServer({ configFile: path.join(pkg, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
await server.listen();
const addr = server.httpServer.address();
const origin = `http://127.0.0.1:${addr.port}`;
console.log(`dev server ${origin}`);

const browser = await launchBrowser({
  headless: true,
  args: gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

const problems = [];
const foreign = new Set();

async function openPage(url, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.add(u);
  });
  page.on('pageerror', (e) => problems.push(`pageerror ${url}: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error ${url}: ${m.text()}`);
    if (m.type() === 'warning' && /maplibre|alexs-atlas|style|layer|expression/i.test(m.text())) problems.push(`console.warn ${url}: ${m.text()}`);
  });
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('globe')?.getAttribute('data-ca-state') !== 'loading', null, { timeout: 120000 });
  const state = await page.evaluate(() => document.getElementById('globe').getAttribute('data-ca-state'));
  if (state !== 'ready') throw new Error(`globe state ${state} for ${url}`);
  return page;
}

/** Waits until MapLibre is idle (all tiles loaded and drawn). */
async function idle(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const map = window.__globe.map;
        const done = () => resolve();
        const t = setTimeout(done, 15000);
        map.once('idle', () => {
          clearTimeout(t);
          setTimeout(done, 250); // a moment for the last paint
        });
        map.triggerRepaint();
      }),
  );
}

for (const s of SCENES) {
  if (only && !only.has(s.name)) continue;
  const q = new URLSearchParams({ year: String(s.year), lon: String(s.lon), lat: String(s.lat), scale: String(s.scale), shot: '1' });
  const page = await openPage(`${origin}/examples/basic.html?${q}`, s.viewport);
  await idle(page);
  if (s.select === 'auto') {
    // Select the polity under the centre, as a click would.
    const vp = s.viewport ?? { width: 1280, height: 800 };
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await idle(page);
  }
  if (s.hover) {
    const vp = s.viewport ?? { width: 1280, height: 800 };
    await page.mouse.move(vp.width * 0.62, vp.height * 0.42);
    await page.waitForTimeout(400);
  }
  const info = await page.evaluate(() => {
    const g = window.__globe;
    return { zoom: g.map.getZoom(), view: g.getView(), lod: g.layers?.timings().at(-1)?.frame, selected: g.getSelected(), polygons: g.layers?.frameFeatures().length };
  });
  const file = path.join(outDir, `globe-${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(`${path.relative(repo, file)}  zoom ${info.zoom.toFixed(2)}  frame ${info.lod}  features ${info.polygons}${info.selected ? `  selected ${info.selected}` : ''}`);
  await page.close();
}

// Tier-1 overlay (tint + hatch + dashed outline) and approximate precision (dashed
// borders): the dev dataset has neither yet, so examples/synthetic.html injects
// SYNTHETIC attributes and one synthetic overlay into the real 1914 frame.
if (!only || only.has('synthetic-overlay')) {
  const page = await openPage(`${origin}/examples/synthetic.html?year=1914`);
  await idle(page);
  await page.screenshot({ path: path.join(outDir, 'globe-synthetic-overlay.png') });
  const pt = await page.evaluate(() => {
    const p = window.__globe.map.project(window.__overlayCenter);
    return { x: p.x, y: p.y };
  });
  await page.mouse.click(pt.x, pt.y); // inside the overlay AND a tier-0 area: tier 1 must win
  await idle(page);
  await page.mouse.move(pt.x + 30, pt.y + 10);
  await page.waitForTimeout(400); // tooltip delay is 120 ms
  const r = await page.evaluate(() => ({
    selected: window.__globe.getSelected(),
    tooltip: document.querySelector('.ca-globe__tooltip:not([hidden])')?.textContent ?? null,
  }));
  if (r.selected !== 'test:overlay') problems.push(`synthetic-overlay: a click on the overlay selected ${r.selected} (tier 1 must beat tier 0)`);
  if (!r.tooltip?.startsWith('Synthetic overlay')) problems.push(`synthetic-overlay: hover tooltip was "${r.tooltip}"`);
  await page.screenshot({ path: path.join(outDir, 'globe-synthetic-overlay-select.png') });
  console.log(`.cache/screenshots/globe-synthetic-overlay(-select).png  selected ${r.selected}  tooltip "${r.tooltip}"`);
  await page.close();
}

if (doTimings) {
  const page = await openPage(`${origin}/examples/basic.html?year=1914&lon=20&lat=30&scale=1&shot=1`);
  await idle(page);
  const result = await page.evaluate(async () => {
    const g = window.__globe;
    const L = g.layers;
    const pct = (a, p) => {
      const s = [...a].sort((x, y) => x - y);
      return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] * 10) / 10;
    };
    const step = async (y) => {
      const t0 = performance.now();
      g.setYear(y);
      await L.setYear(y);
      return performance.now() - t0;
    };
    // 1) Within loaded chunks: frames of 1857–1928 and 1929–1945 (warm the chunks first).
    await step(1860);
    await step(1930);
    const warm = [];
    for (const y of [1861, 1866, 1871, 1878, 1885, 1890, 1899, 1905, 1912, 1918, 1922, 1927, 1931, 1936, 1939, 1942, 1945, 1880, 1895, 1910]) warm.push(await step(y));
    // 2) Crossing into chunks not loaded yet (fetch + decode + render).
    const cold = [];
    for (const y of [1600, 1300, 1000, 700, 200, -300, -1000, -2000, 1700, 1820]) cold.push(await step(y));
    // 3) Continuous scrub (timeline drag at 60 Hz, l0 while interacting), then release.
    const before = L.timings().length;
    g.setInteracting(true);
    const t0 = performance.now();
    for (let y = 1780; y <= 1856; y++) {
      g.setYear(y);
      await new Promise((r) => setTimeout(r, 16));
    }
    const dragMs = performance.now() - t0;
    const duringDrag = L.timings().length - before;
    const tRelease = performance.now();
    g.setInteracting(false);
    await L.setYear(1856);
    const settleMs = performance.now() - tRelease;
    return {
      warmFrameChange: { n: warm.length, p50: pct(warm, 50), p90: pct(warm, 90), max: pct(warm, 100) },
      coldChunk: { n: cold.length, p50: pct(cold, 50), p90: pct(cold, 90), max: pct(cold, 100) },
      scrub: { years: 77, dragMs: Math.round(dragMs), framesRenderedDuringDrag: duringDrag, settleAfterReleaseMs: Math.round(settleMs) },
      lastSteps: L.timings().slice(-5),
    };
  });
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const e = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return gl ? (e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'no webgl2';
  });
  result.renderer = renderer;
  console.log(`year-change timings (ms, 1280x800, world view) on ${renderer}:`);
  console.log(JSON.stringify(result, null, 1));
  fs.writeFileSync(path.join(outDir, `globe-timings${gpu ? '-gpu' : ''}.json`), JSON.stringify(result, null, 1));
  await page.close();
}

await browser.close();
await server.close();

if (foreign.size) problems.push(`third-party requests: ${[...foreign].join(', ')}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nno third-party requests, no console errors');
}
