#!/usr/bin/env node
/**
 * Builds public/data/sea.geojson, the sea the globe draws on top of the
 * polity fills, from Natural Earth's 10 m land (public domain).
 *
 *   npm run data:sea
 *
 * Why a sea layer: modern polities in OpenHistoricalMap follow OpenStreetMap
 * and include their territorial waters (and Canada its Hudson Bay), so filled
 * in colour they look puffy and swallow islands. Drawing the sea over them cuts
 * every fill back to the coast, whatever source it comes from.
 *
 * The sea is cut into 10° cells: as one world-sized polygon with thousands of
 * island holes, or in cells beyond MapLibre's 65,535-vertex limit per tile,
 * some islands were painted over as sea at some zooms. The file also carries
 * the 15° graticule, clipped to the sea so it does not cross the land.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(ROOT, '.cache/sea');
const OUT = join(ROOT, 'public/data/sea.geojson');
/** nvkelso/natural-earth-vector master (v5.1.2 data) on 2022-06-02. */
const NATURAL_EARTH_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const LAND_URL = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson/ne_10m_land.geojson`;
const MAPSHAPER = 'mapshaper@0.7.67';

mkdirSync(CACHE, { recursive: true });
const rel = (file) => relative(ROOT, file);
/** On Windows npx runs through a shell: pass paths relative to the repo and quote expressions. */
function mapshaper(args) {
  const shell = process.platform === 'win32';
  const quote = (arg) => (shell && !/^[\w.,=:/\\-]+$/.test(arg) ? `"${arg}"` : arg);
  execFileSync('npx', ['-y', MAPSHAPER, ...args.map(quote)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell });
}
const featuresOf = (collection) =>
  collection.features ?? (collection.geometries ?? []).map((geometry) => ({ type: 'Feature', properties: {}, geometry }));
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const landRaw = join(CACHE, `${NATURAL_EARTH_COMMIT.slice(0, 8)}_ne_10m_land.geojson`);
try { statSync(landRaw); } catch {
  process.stdout.write('downloading Natural Earth land... ');
  const res = await fetch(LAND_URL);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(landRaw, Buffer.from(await res.arrayBuffer()));
}

// 800 m, or 50 m for features under 100 km² so small islands keep their shape.
// At the globe's deepest zoom a pixel is ~600 m; finer coasts (100 m, 8 MB)
// only slowed loading and made the sea a third of every frame's drawing.
const land = join(CACHE, 'land.geojson');
console.log('simplifying land...');
mapshaper(['-i', rel(landRaw), '-simplify', 'dp', 'variable', 'interval=this.area<1e8?50:800', 'keep-shapes',
  '-o', rel(land), 'format=geojson', 'precision=0.0001', 'force']);

const cells = [];
for (let x = -180; x < 180; x += 10) for (let y = -90; y < 90; y += 10) {
  const [south, north] = [Math.max(y, -85.06), Math.min(y + 10, 85.06)];
  if (north <= south) continue;
  cells.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[x, south], [x + 10, south], [x + 10, north], [x, north], [x, south]]] } });
}
const grid = join(CACHE, 'cells.geojson');
writeFileSync(grid, JSON.stringify({ type: 'FeatureCollection', features: cells }));
const sea = join(CACHE, 'sea_cells.geojson');
console.log('cutting the sea...');
mapshaper(['-i', rel(grid), '-erase', rel(land), '-o', rel(sea), 'format=geojson', 'precision=0.0001', 'force']);

const lines = [];
for (let lng = -180; lng < 180; lng += 15) lines.push(Array.from({ length: 81 }, (_, i) => [lng, -80 + i * 2]));
for (let lat = -75; lat <= 75; lat += 15) lines.push(Array.from({ length: 181 }, (_, i) => [-180 + i * 2, lat]));
const graticule = join(CACHE, 'graticule.geojson');
writeFileSync(graticule, JSON.stringify({ type: 'FeatureCollection', features: lines.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })) }));
const graticuleSea = join(CACHE, 'graticule_sea.geojson');
mapshaper(['-i', rel(graticule), '-clip', rel(sea), '-o', rel(graticuleSea), 'format=geojson', 'precision=0.001', 'force']);

writeFileSync(OUT, JSON.stringify({
  type: 'FeatureCollection',
  features: [
    ...featuresOf(readJson(sea)).filter((f) => f.geometry).map(({ geometry }) => ({ type: 'Feature', properties: { kind: 'sea' }, geometry })),
    ...featuresOf(readJson(graticuleSea)).filter((f) => f.geometry).map(({ geometry }) => ({ type: 'Feature', properties: { kind: 'graticule' }, geometry })),
  ],
}));
console.log(`wrote ${rel(OUT)}, ${(statSync(OUT).size / 1e6).toFixed(1)} MB`);
