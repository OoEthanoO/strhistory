// Runs the integration recipes of packages/globe/AGENTS.md §8 for real and checks them:
//
//   node packages/globe/scripts/recipes.mjs [--gpu]
//
//  plain       examples/plain.html: import map + built dist files, no bundler, static server
//  vite-build  examples/basic.html built by Vite for production (worker ?worker&url, CSS), static server
//  host-map    examples/host-map.html: addBorderLayers on a host map (layer order, setYear, remove, re-add)
//  lifecycle   examples/lifecycle.html: StrictMode-style mount/cleanup/mount, unmount mid-load and mid-year-change
//  element     examples/element.html: <chrono-globe> attributes and events
//  path-a      Node: createBorders + fileFetch → bordersAt(year) GeoJSON with the strhistory Gen-1 properties
//
// Builds packages/globe/dist first (vite build). Uses packages/borders/dist as built by
// `tsc -b` (npm run check). Screenshots go to .cache/screenshots/globe-recipe-<name>.png.
// Exit code 1 on a failed check, a console error or any request to another origin.
// Browser: headless Edge, or Chrome without Edge; ALEXS_ATLAS_BROWSER picks another (browser.mjs).
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, createServer } from 'vite';
import { launchBrowser } from './browser.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = path.resolve(here, '..');
const repo = path.resolve(pkg, '../..');
const nm = path.join(repo, 'node_modules');
const shots = path.join(repo, '.cache', 'screenshots');
const viteDist = path.join(repo, '.cache', 'globe-recipes', 'vite-dist');
const dataDir = path.join(repo, 'packages', 'borders', 'data');
fs.mkdirSync(shots, { recursive: true });
const gpu = process.argv.includes('--gpu');

const failures = [];
const check = (name, cond, msg) => {
  if (!cond) failures.push(`${name}: ${msg}`);
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${msg}`);
};

// ---- builds -------------------------------------------------------------------------
console.log('building packages/globe/dist (vite build)…');
await build({ configFile: path.join(pkg, 'vite.config.ts'), logLevel: 'warn' });
console.log('building examples/basic.html for production…');
await build({
  configFile: false,
  root: pkg,
  base: '/vite-dist/',
  logLevel: 'warn',
  worker: { format: 'es' }, // MapLibre's worker is an ES module
  build: { outDir: viteDist, emptyOutDir: true, target: 'es2022', rolldownOptions: { input: { basic: path.join(pkg, 'examples/basic.html') } } },
});

// ---- static server (what a plain static host does) ----------------------------------
const MOUNTS = [
  ['/vendor/maplibre-gl/', path.join(nm, 'maplibre-gl', 'dist')],
  ['/vendor/topojson-client/', path.join(nm, 'topojson-client', 'src')],
  ['/vendor/alexs-atlas-borders/', path.join(repo, 'packages', 'borders', 'dist')],
  ['/vendor/alexs-atlas-globe/', path.join(pkg, 'dist')],
  ['/data/alexs-atlas/', dataDir],
  ['/examples/', path.join(pkg, 'examples')],
  ['/vite-dist/', viteDist],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.map': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const staticServer = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.resolve(dir, url.slice(prefix.length));
    if (file.startsWith(dir) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  res.writeHead(404).end();
});
await new Promise((r) => staticServer.listen(0, '127.0.0.1', r));
const staticOrigin = `http://127.0.0.1:${staticServer.address().port}`;

// ---- Vite dev server for the source-level examples ----------------------------------
const dev = await createServer({ configFile: path.join(pkg, 'vite.config.ts'), server: { port: 0, host: '127.0.0.1' }, logLevel: 'warn' });
await dev.listen();
const devOrigin = `http://127.0.0.1:${dev.httpServer.address().port}`;

const browser = await launchBrowser({
  headless: true,
  args: gpu ? [] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function open(name, url, origin) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) problems.push(`third-party request ${u}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console.error ${m.text()}`);
  });
  await page.goto(url);
  return { page, problems };
}

async function finish(name, page, problems) {
  await page.screenshot({ path: path.join(shots, `globe-recipe-${name}.png`) });
  check(name, problems.length === 0, problems.length ? problems.join('; ') : 'no console errors, no third-party requests');
  await page.close();
}

const waitState = (page, sel = '#globe') =>
  page.waitForFunction((s) => document.querySelector(s)?.getAttribute('data-ca-state') !== 'loading', sel, { timeout: 120000 }).then(() =>
    page.evaluate((s) => document.querySelector(s)?.getAttribute('data-ca-state'), sel),
  );

/** A ChronoGlobe page with window.__globe: ready, then a year change renders. */
async function globePage(name, url, origin) {
  console.log(`${name}: ${url}`);
  const { page, problems } = await open(name, url, origin);
  check(name, (await waitState(page)) === 'ready', 'data-ca-state becomes "ready"');
  const r = await page.evaluate(async () => {
    const g = window.__globe;
    const t0 = performance.now();
    g.setYear(1914);
    await g.layers.setYear(1914);
    await new Promise((res) => g.map.once('idle', res));
    return { year: g.getYear(), ms: Math.round(performance.now() - t0), features: g.layers.frameFeatures().length };
  });
  check(name, r.year === 1914 && r.features > 0, `setYear(1914) rendered ${r.features} features (${r.ms} ms incl. idle)`);
  await finish(name, page, problems);
}

/** A page publishing window.__recipe. */
async function recipePage(name, url, origin, verify) {
  console.log(`${name}: ${url}`);
  const { page, problems } = await open(name, url, origin);
  await page.waitForFunction(() => window.__recipe !== undefined, null, { timeout: 120000 });
  const r = await page.evaluate(() => window.__recipe);
  check(name, r.ok === true, `page checks pass${r.error ? ` (${r.error})` : ''}`);
  verify?.(r);
  await page.waitForTimeout(300);
  await finish(name, page, problems);
  return r;
}

try {
  await globePage('plain', `${staticOrigin}/examples/plain.html?year=1453`, staticOrigin);
  await globePage('vite-build', `${staticOrigin}/vite-dist/examples/basic.html?year=1453&lon=30&lat=38&shot=1`, staticOrigin);

  await recipePage('host-map', `${devOrigin}/examples/host-map.html`, devOrigin, (r) => {
    const host = ['ocean', 'graticule', 'cities', 'city-labels'];
    const expected = ['ocean', ...r.layerIds, 'graticule', 'cities', 'city-labels'];
    check('host-map', JSON.stringify(r.orderAfterAdd) === JSON.stringify(expected), `border layers sit below the host's 'graticule' (${r.layerIds.length} layers)`);
    check('host-map', JSON.stringify(r.orderAfterRemove) === JSON.stringify(host), 'remove() restores the host layer list exactly');
    check('host-map', JSON.stringify(r.sourcesAfterRemove) === JSON.stringify(['graticule', 'cities']), 'remove() removes every source it added');
    check('host-map', JSON.stringify(r.orderAfterReAdd) === JSON.stringify(expected), 're-adding after remove() gives the same order');
    check('host-map', r.featuresIn1914 === true, `setYear(1914) resolved after render (${r.yearChangeMs} ms)`);
  });

  await recipePage('lifecycle', `${devOrigin}/examples/lifecycle.html`, devOrigin, (r) => {
    console.log(`    ${JSON.stringify(r)}`);
  });

  await recipePage('element', `${devOrigin}/examples/element.html`, devOrigin, (r) => {
    console.log(`    events: ${r.events.join(' ')}`);
  });

  // Path A (Node): the dataset as plain per-year GeoJSON.
  console.log('path-a: Node, createBorders + fileFetch');
  const { createBorders } = await import(pathToFileURL(path.join(repo, 'packages/borders/dist/index.js')).href);
  const { fileFetch } = await import(pathToFileURL(path.join(repo, 'packages/borders/dist/node.js')).href);
  const borders = createBorders({ manifestUrl: path.join(dataDir, 'manifest.json') }, { fetch: fileFetch });
  const fc = await borders.bordersAt(1783);
  const keys = ['id', 'name', 'subjecto', 'power', 'partof', 'disputed', 'from', 'to'];
  const missing = keys.filter((k) => !fc.features.every((f) => k in f.properties));
  check('path-a', fc.type === 'FeatureCollection' && fc.features.length > 0, `bordersAt(1783) → ${fc.features.length} features`);
  check('path-a', missing.length === 0, `every feature has the Gen-1 properties ${keys.join(', ')}${missing.length ? ` (missing ${missing})` : ''}`);
  check('path-a', fc.features.every((f) => f.id === f.properties.id), 'Feature.id equals properties.id (feature-state ready)');
} finally {
  await browser.close();
  await dev.close();
  staticServer.close();
}

if (failures.length) {
  console.error(`\n${failures.length} failure(s):\n${failures.join('\n')}`);
  process.exitCode = 1;
} else {
  console.log('\nall recipes pass');
}
