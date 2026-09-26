/** Rebuild the initial, interactive SVG globe's small geometry payload.
 * Run after changing world_1783.geojson: node scripts/data/build-prebaked.mjs
 * Derived historical borders retain the GPL-3.0 licence in the output folder. */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { geoArea } from 'd3-geo';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const cache = resolve(root, '.cache');
mkdirSync(cache, { recursive: true });
const source = JSON.parse(readFileSync(resolve(root, 'public/data/snapshots/world_1783.geojson'), 'utf8'));
source.features = source.features.filter(f => f.geometry && f.geometry.type !== 'Point');
const input = resolve(cache, 'prebaked-source.geojson');
const output = resolve(cache, 'prebaked-1783.geojson');
writeFileSync(input, JSON.stringify(source));
execFileSync('npx', ['-y', 'mapshaper@0.7.67', '-i', input, '-simplify', 'weighted', '12%', 'keep-shapes', '-filter-fields', 'name,subjecto', '-o', output, 'format=geojson', 'precision=0.01', 'force'], { shell: process.platform === 'win32', stdio: 'inherit' });
const simplified = JSON.parse(readFileSync(output, 'utf8'));
// D3 spherical geometry uses clockwise exterior rings. Normalise each polygon
// independently so a reversed ring cannot paint the entire globe.
for (const f of simplified.features) {
  if (!f.geometry) continue;
  const polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const polygon of polygons) {
    if (geoArea({ type: 'Polygon', coordinates: [polygon[0]] }) > 2 * Math.PI) polygon.forEach(ring => ring.reverse());
  }
}
const bakedDir = resolve(root, 'src/features/globe/baked');
mkdirSync(bakedDir, { recursive: true });
writeFileSync(resolve(bakedDir, 'prebaked_1783.json'), JSON.stringify(simplified));
