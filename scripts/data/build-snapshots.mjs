#!/usr/bin/env node
/**
 * Builds the simplified historical-border files the globe loads.
 *
 *   npm run data:snapshots            # build every year that has a snapshot entry
 *   npm run data:snapshots -- 1914    # rebuild one year
 *
 * Source: aourednik/historical-basemaps (GPL-3.0). The years to build come from
 * the snapshot content collection (src/content/snapshots/<year>.md), so adding a
 * snapshot is: add the markdown file, run this script, commit both.
 *
 * Output: public/data/snapshots/world_<year>.geojson, simplified to a size that
 * is reasonable to download on a school Chromebook (~100-300 KB each).
 *
 * mapshaper is run through npx on demand rather than installed as a dependency:
 * it pulls in native SQLite modules that every `npm ci` (including the deploy on
 * the home server) would otherwise have to deal with, for a script that only
 * runs when the snapshot list changes.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import polylabel from 'polylabel';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT_CONTENT = join(ROOT, 'src/content/snapshots');
const OUT_DIR = join(ROOT, 'public/data/snapshots');
const CACHE_DIR = join(ROOT, '.cache/basemaps');
const OVERRIDES = JSON.parse(readFileSync(join(ROOT, 'scripts/data/name-overrides.json'), 'utf8'));
const SOURCE = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';
const MAPSHAPER = 'mapshaper@0.7.67';

const requested = process.argv.slice(2).map(Number).filter(Boolean);
const years = readdirSync(SNAPSHOT_CONTENT)
  .filter((f) => /^\d+\.mdx?$/.test(f))
  .map((f) => Number.parseInt(f, 10))
  .filter((y) => requested.length === 0 || requested.includes(y))
  .sort((a, b) => a - b);

if (years.length === 0) {
  console.error('No matching snapshot years in src/content/snapshots/.');
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(CACHE_DIR, { recursive: true });

/** Planar ring area in square degrees; only used to rank polygons against each other. */
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  return Math.abs(a / 2);
}
const round = (n) => Math.round(n * 1000) / 1000;

for (const year of years) {
  const raw = join(CACHE_DIR, `world_${year}.geojson`);
  const out = join(OUT_DIR, `world_${year}.geojson`);

  try {
    statSync(raw);
  } catch {
    process.stdout.write(`${year}: downloading... `);
    const res = await fetch(`${SOURCE}/world_${year}.geojson`);
    if (!res.ok) throw new Error(`download failed for ${year}: HTTP ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  }

  process.stdout.write(`${year}: simplifying... `);
  const tmp = `${out}.tmp.geojson`;
  execFileSync(
    'npx',
    [
      '-y', MAPSHAPER,
      '-i', raw,
      '-filter-fields', 'NAME,SUBJECTO,PARTOF,BORDERPRECISION',
      // keep-shapes stops small islands (and small states) from disappearing.
      '-simplify', 'weighted', '12%', 'keep-shapes',
      '-o', tmp, 'format=geojson', 'precision=0.001',
    ],
    { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' },
  );

  // Post-process: apply name fixes, drop unnamed slivers' null props, and add a
  // stable numeric id so the globe can use feature-state for hover highlights.
  const geo = JSON.parse(readFileSync(tmp, 'utf8'));
  const fixes = OVERRIDES[String(year)] ?? {};
  geo.features = geo.features.map((f, i) => {
    const p = f.properties ?? {};
    const fix = fixes[p.NAME];
    const subjectFix = fixes[p.SUBJECTO];
    let name = p.NAME ?? null;
    let subject = p.SUBJECTO ?? p.NAME ?? null;
    if (typeof subjectFix === 'string') subject = subjectFix;
    if (typeof fix === 'string') name = fix;
    else if (fix) {
      name = fix.name ?? name;
      subject = fix.subjecto ?? subject;
    }
    return {
      type: 'Feature',
      id: i + 1,
      properties: {
        name,
        subjecto: subject,
        partof: p.PARTOF ?? null,
        precision: p.BORDERPRECISION ?? 1,
      },
      geometry: f.geometry,
    };
  });

  // One label point per named polity, at the pole of inaccessibility of its
  // largest ring. Letting MapLibre place polygon labels itself produces one
  // label per tile fragment, so large empires get labelled several times.
  const labels = [];
  const byName = new Map();
  for (const f of geo.features) {
    if (!f.properties.name || !f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const poly of polys) {
      const area = ringArea(poly[0]);
      const prev = byName.get(f.properties.name);
      if (!prev || area > prev.area) byName.set(f.properties.name, { area, poly, props: f.properties });
    }
  }
  for (const [name, { area, poly, props }] of byName) {
    const [lng, lat] = polylabel(poly, 0.1);
    labels.push({
      type: 'Feature',
      properties: { kind: 'label', name, subjecto: props.subjecto, area: Math.round(area * 100) / 100 },
      geometry: { type: 'Point', coordinates: [round(lng), round(lat)] },
    });
  }
  geo.features.push(...labels);

  writeFileSync(out, JSON.stringify(geo));
  rmSync(tmp);
  console.log(`${(statSync(out).size / 1024).toFixed(0)} KB, ${geo.features.length} features`);
}

// Base land layer (Natural Earth, public domain). Drawn under the historical
// polities so land the historical data leaves uncovered still reads as land.
const landOut = join(ROOT, 'public/data/land.geojson');
if (requested.length === 0 || process.argv.includes('--land')) {
  const landRaw = join(CACHE_DIR, 'ne_50m_land.geojson');
  try {
    statSync(landRaw);
  } catch {
    process.stdout.write('land: downloading... ');
    const res = await fetch('https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_land.geojson');
    if (!res.ok) throw new Error(`land download failed: HTTP ${res.status}`);
    writeFileSync(landRaw, Buffer.from(await res.arrayBuffer()));
  }
  process.stdout.write('land: simplifying... ');
  execFileSync(
    'npx',
    ['-y', MAPSHAPER, '-i', landRaw, '-filter-fields', '', '-simplify', 'weighted', '10%', 'keep-shapes', '-o', landOut, 'format=geojson', 'precision=0.001'],
    { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' },
  );
  console.log(`${(statSync(landOut).size / 1024).toFixed(0)} KB`);
}

console.log(`\nWrote ${years.length} snapshot file(s) to public/data/snapshots/.`);
