/** Rebuild the initial, interactive SVG globe's small geometry payload:
 *   node scripts/data/build-prebaked.mjs
 * It bakes the Alex's Atlas borders of BAKED_YEAR (the explorer's and the home
 * page's default year) at the coarsest level of detail, simplified further, with
 * each polity's fill and outline colour from src/features/globe/map-colors.ts, so
 * the first frame matches the WebGL globe that replaces it. Re-run after the
 * dataset or the map colours change. The output is CC BY 4.0, like the dataset
 * (see src/features/globe/baked/LICENSE.md). */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { geoArea } from 'd3-geo';
import mapshaper from 'mapshaper';
import { feature } from 'topojson-client';
import { runnerImport } from 'vite';

const BAKED_YEAR = 1789;
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const data = resolve(root, 'packages/borders/data');

// The globe's own colour code, loaded through Vite with the site's package aliases.
const pkg = (p) => resolve(root, 'packages', p);
const viteConfig = {
  configFile: false,
  logLevel: 'warn',
  resolve: {
    alias: [
      { find: /^@alexs-atlas\/borders$/, replacement: pkg('borders/src/index.ts') },
      { find: /^@alexs-atlas\/globe$/, replacement: pkg('globe/src/index.ts') },
    ],
  },
};
const { module: colors } = await runnerImport(resolve(root, 'src/features/globe/map-colors.ts'), viteConfig);
const { module: globe } = await runnerImport(pkg('globe/src/color.ts'), viteConfig);
const theme = colors.MAP_THEME_RESOLVED;

// The frame of BAKED_YEAR: the years that share its borders, and its tier-0 polities.
const manifest = JSON.parse(readFileSync(resolve(data, 'manifest.json'), 'utf8'));
const at = manifest.frames.findLastIndex((y) => y <= BAKED_YEAR);
const frame = [manifest.frames[at], (manifest.frames[at + 1] ?? manifest.years.to + 1) - 1];
const chunk = manifest.chunks.find((c) => c.from <= BAKED_YEAR && BAKED_YEAR <= c.to);
const topo = JSON.parse(readFileSync(resolve(data, chunk.files[manifest.lods[0].id]), 'utf8'));
const alive = feature(topo, topo.objects.polities).features.filter(
  ({ properties: p }) => p.from <= BAKED_YEAR && p.to >= BAKED_YEAR && p.tier === 0 && p.kind !== 'unclaimed',
);
const source = {
  type: 'FeatureCollection',
  features: alive.map(({ geometry, properties: p }) => {
    const fill = colors.fillColor(p);
    return { type: 'Feature', geometry, properties: { fill, edge: globe.shade(fill, theme.edge) } };
  }),
};

// A light first frame: the dataset's l0 (≈ 5 km) is finer than an overview SVG needs.
// Small features keep their shape so microstates do not turn into triangles.
const out = await mapshaper.applyCommands(
  '-i source.json -simplify dp variable "interval=this.area<1e8?5:8000" keep-shapes -o baked.json format=geojson precision=0.0001',
  { 'source.json': source },
);
const simplified = JSON.parse(out['baked.json']);
// d3's spherical geometry uses clockwise exterior rings (the reverse of RFC 7946).
// Normalise each polygon independently so a reversed ring cannot paint the whole globe.
for (const f of simplified.features) {
  if (!f.geometry) continue;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const polygon of polygons) {
    if (geoArea({ type: 'Polygon', coordinates: [polygon[0]] }) > 2 * Math.PI) polygon.forEach((ring) => ring.reverse());
  }
}

const bakedDir = resolve(root, 'src/features/globe/baked');
mkdirSync(bakedDir, { recursive: true });
rmSync(resolve(bakedDir, 'prebaked_1783.json'), { force: true }); // the former GPL-3.0 bake
const baked = {
  year: BAKED_YEAR,
  frame,
  ocean: theme.ocean,
  land: theme.land,
  features: simplified.features.filter((f) => f.geometry).map((f) => ({ d: f.geometry, fill: f.properties.fill, edge: f.properties.edge })),
};
const file = resolve(bakedDir, `prebaked_${BAKED_YEAR}.json`);
writeFileSync(file, JSON.stringify(baked));
console.log(`baked ${baked.features.length} polities of ${BAKED_YEAR} (frame ${frame[0]}–${frame[1]}) → ${file.slice(root.length + 1)} (${(readFileSync(file).length / 1e3).toFixed(0)} kB)`);
