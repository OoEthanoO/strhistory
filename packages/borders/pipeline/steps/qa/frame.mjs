#!/usr/bin/env node
// Visual QA of the BUILT dataset: decodes one year at one LOD from
// packages/borders/data (exactly as a client would, via topojson-client), writes
// the features, border mesh and coast mesh to .cache/build/package/qa/, and renders
// a PNG with steps/qa/render_frame.py (fills by colour slot, borders white, coast
// black, Natural Earth's unsimplified coastline in cyan underneath for alignment).
//
//   node packages/borders/pipeline/steps/qa/frame.mjs --year=1815 --lod=l1 --bbox=-12,34,32,62 [--name=europe-1815] [--data=<dir>]
//   node packages/borders/pipeline/steps/qa/frame.mjs --preset=archipelagos --year=1900     (every archipelago)
//   node packages/borders/pipeline/steps/qa/frame.mjs --preset=caribbean --year=2000 --lod=l0 (one region of PRESETS)
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as topojson from 'topojson-client';
import { PATHS, PIPELINE, ROOT, parseArgs, readJson } from '../lib/context.mjs';

export const PRESETS = {
  'british-isles': [-11, 49.5, 2.5, 61],
  aegean: [19.5, 34.5, 29.5, 41.5],
  japan: [128, 30, 146.5, 46],
  philippines: [116, 4.5, 127.5, 21],
  indonesia: [94, -11.5, 141.5, 7],
  caribbean: [-86, 9.5, -59, 27.5],
  pacific: [160, -25, 200, 5],
  'canadian-arctic': [-125, 60, -60, 83],
  chile: [-80, -56.5, -64, -40],
  scandinavia: [3, 54, 32, 71.5],
  europe: [-12, 34, 42, 62],
  world: [-180, -60, 180, 84],
};

const args = parseArgs(process.argv.slice(2));
const dataDir = args.data ? resolve(args.data) : PATHS.data;
const outDir = join(PATHS.packageTmp, 'qa');

export function decodeYear(manifest, dataDir, year, lod) {
  const chunk = manifest.chunks.find((c) => c.from <= year && year <= c.to);
  if (!chunk) throw new Error(`no chunk for ${year}`);
  const topo = JSON.parse(readFileSync(join(dataDir, chunk.files[lod]), 'utf8'));
  const alive = topo.objects.polities.geometries.filter((g) => g.properties.from <= year && year <= g.properties.to);
  const tier0 = { type: 'GeometryCollection', geometries: alive.filter((g) => g.properties.tier === 0) };
  return {
    chunk: chunk.id,
    features: topojson.feature(topo, { type: 'GeometryCollection', geometries: alive }),
    borders: topojson.mesh(topo, tier0, (a, b) => a !== b),
    coast: topojson.mesh(topo, tier0, (a, b) => a === b),
  };
}

function main() {
  const manifest = readJson(join(dataDir, 'manifest.json'));
  const year = Number(args.year ?? 1900);
  const lod = args.lod ?? 'l1';
  // --preset=archipelagos renders every archipelago; --preset=<name> or --region=<name> one region
  const named = args.region ?? (args.preset !== 'archipelagos' ? args.preset : undefined);
  if (named !== undefined && !PRESETS[named]) throw new Error(`unknown region "${named}" (regions: ${Object.keys(PRESETS).join(', ')}, or --preset=archipelagos)`);
  const regions = args.preset === 'archipelagos'
    ? ['british-isles', 'aegean', 'japan', 'philippines', 'indonesia', 'caribbean', 'pacific', 'canadian-arctic', 'chile', 'scandinavia']
    : [named ?? null];
  mkdirSync(outDir, { recursive: true });
  const decoded = decodeYear(manifest, dataDir, year, lod);
  const file = join(outDir, `frame-${year}-${lod}.json`);
  writeFileSync(file, JSON.stringify({ year, lod, dataset: manifest.dataset, chunk: decoded.chunk, features: decoded.features, borders: decoded.borders, coast: decoded.coast }));
  for (const region of regions) {
    const bbox = region ? PRESETS[region] : (args.bbox ?? '-180,-60,180,84').split(',').map(Number);
    const name = args.name && !region ? args.name : `${region ?? 'custom'}-${year}-${lod}`;
    const png = join(outDir, `${name}.png`);
    const r = spawnSync(process.execPath, [join(PIPELINE, 'tools', 'py.mjs'), join(PIPELINE, 'steps', 'qa', 'render_frame.py'), file, png, bbox.join(','), args.title ?? `${manifest.dataset} · ${year} · ${lod} · ${region ?? 'custom'}`], { stdio: 'inherit', cwd: ROOT });
    if (r.status !== 0) process.exit(r.status ?? 1);
    console.log(png);
  }
}

if (import.meta.url === `file:///${process.argv[1].replaceAll('\\', '/')}` || process.argv[1]?.endsWith('frame.mjs')) main();
