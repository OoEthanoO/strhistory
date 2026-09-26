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
 * The present-day stop (PRESENT_YEAR) is built from Natural Earth instead
 * (public domain), because historical-basemaps ends in 2010. See presentDay().
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
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import polylabel from 'polylabel';
import { load as parseYaml } from 'js-yaml';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SNAPSHOT_CONTENT = join(ROOT, 'src/content/snapshots');
const OUT_DIR = join(ROOT, 'public/data/snapshots');
const CACHE_DIR = join(ROOT, '.cache/basemaps');
const OVERRIDES = JSON.parse(readFileSync(join(ROOT, 'scripts/data/name-overrides.json'), 'utf8'));
const SOURCE = 'https://raw.githubusercontent.com/aourednik/historical-basemaps/master/geojson';
const NATURAL_EARTH = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';
const MAPSHAPER = 'mapshaper@0.7.67';
/** The snapshot year built from Natural Earth's present-day borders. Keep in step with src/content/snapshots. */
const PRESENT_YEAR = 2026;

const requested = process.argv.slice(2).map(Number).filter(Boolean);
const years = [...new Set(readdirSync(SNAPSHOT_CONTENT)
  .filter((f) => /^-?\d+\.mdx?$/.test(f))
  .flatMap((f) => {
    const source = readFileSync(join(SNAPSHOT_CONTENT, f), 'utf8').replace(/\r\n/g, '\n');
    const data = parseYaml(source.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '') ?? {};
    return data.borderYear === null ? [] : [data.borderYear ?? data.year];
  }))]
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
const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const contains = (geometry, point) =>
  polygonsOf(geometry).some(([outer, ...holes]) => inRing(point, outer) && !holes.some((h) => inRing(point, h)));

/** Downloads `url` into the cache once and returns the cached path. */
async function cached(name, url) {
  const file = join(CACHE_DIR, name);
  try {
    statSync(file);
  } catch {
    process.stdout.write(`downloading ${name}... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`download failed for ${name}: HTTP ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return file;
}

/**
 * Simplifies `input` with mapshaper, keeping only `fields`. On Windows npx runs
 * through a shell, which would split a path containing spaces and drop an empty
 * argument, so paths are passed relative to the repo and "" is quoted.
 */
function simplify(input, output, fields, percent) {
  const shell = process.platform === 'win32';
  execFileSync(
    'npx',
    [
      '-y', MAPSHAPER,
      '-i', relative(ROOT, input),
      '-filter-fields', shell && fields === '' ? '""' : fields,
      // keep-shapes stops small islands (and small states) from disappearing.
      '-simplify', 'weighted', percent, 'keep-shapes',
      '-o', relative(ROOT, output), 'format=geojson', 'precision=0.001',
    ],
    { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell },
  );
}

/** Historical borders from historical-basemaps, with per-year name fixes applied. */
async function historical(year, tmp) {
  const upstreamYear = year < 0 ? `bc${Math.abs(year)}` : year;
  const raw = await cached(`world_${year}.geojson`, `${SOURCE}/world_${upstreamYear}.geojson`);
  process.stdout.write(`${year}: simplifying... `);
  simplify(raw, tmp, 'NAME,SUBJECTO,PARTOF,BORDERPRECISION', '12%');

  const fixes = OVERRIDES[String(year)] ?? {};
  return readJson(tmp).features.map((f) => {
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
      name,
      subjecto: subject,
      partof: p.PARTOF ?? null,
      precision: p.BORDERPRECISION ?? 1,
      geometry: f.geometry,
    };
  });
}

// Natural Earth's short English names where NAME_EN reads oddly on a map.
const PRESENT_NAMES = {
  "People's Republic of China": 'China',
  'Jan Mayen': 'Svalbard and Jan Mayen',
  Cocos: 'Cocos (Keeling) Islands',
};
const ABBREVIATIONS = { 'U.S.A.': 'United States of America', 'U.S.A': 'United States of America', 'U.K.': 'United Kingdom' };

/** Who administers a disputed area, from Natural Earth's note ("Admin. by Russia; Claimed by Ukraine"). */
function administrator(p) {
  const note = (p.NOTE_BRK ?? '').trim();
  if (!note) return p.SOVEREIGNT;
  const admin = note.match(/^Admin\.? by (.+?)(?: for (.+?))?;/i);
  if (admin) return admin[2] ?? admin[1];
  const lease = note.match(/^Leased to (.+?) by /i);
  if (lease) return lease[1];
  // "Self admin.", "Claimed by A and B", "Between A and B": no single administrator.
  return note.match(/patrolled by (.+)$/i)?.[1] ?? null;
}

/**
 * Present-day borders from Natural Earth's ISO 3166 point of view, which draws
 * countries as ISO lists them and leaves contested areas (Crimea, Kashmir, the
 * Golan Heights…) out of every country. Those gaps are filled from Natural
 * Earth's disputed-areas layer: named "(disputed)", drawn dashed, and coloured
 * by whoever administers them, so the map records control without taking a side.
 */
async function presentDay(year, tmp) {
  const iso = readJson(await cached('ne_10m_admin_0_countries_iso.geojson', `${NATURAL_EARTH}/ne_10m_admin_0_countries_iso.geojson`));
  const disputed = readJson(await cached('ne_10m_admin_0_disputed_areas.geojson', `${NATURAL_EARTH}/ne_10m_admin_0_disputed_areas.geojson`));

  const displayName = (p) => PRESENT_NAMES[p.NAME_EN] ?? p.NAME_EN ?? p.NAME;
  // Overseas parts (Mayotte, Bouvet Island…) share their country's ADMIN, so a
  // country's display name comes from its home part.
  const display = new Map();
  for (const { properties: p } of iso.features) {
    if (p.HOMEPART === 1 || !display.has(p.ADMIN)) display.set(p.ADMIN, displayName(p));
  }
  const nameOf = (admin) => (admin ? display.get(ABBREVIATIONS[admin] ?? admin) ?? ABBREVIATIONS[admin] ?? admin : null);

  const features = iso.features.map((f) => {
    const p = f.properties;
    const name = displayName(p);
    // Dependencies share their sovereign's colour. An indeterminate area that is
    // its own unit (Palestine, whose SOVEREIGNT is Israel here) is attributed to no one.
    const own = p.TYPE === 'Indeterminate' && p.SOVEREIGNT !== p.ADMIN;
    return { name, subjecto: own ? name : nameOf(p.SOVEREIGNT), precision: 3, geometry: f.geometry };
  });
  for (const f of disputed.features) {
    const p = f.properties;
    const largest = polygonsOf(f.geometry).reduce((a, b) => (ringArea(b[0]) > ringArea(a[0]) ? b : a));
    const point = polylabel(largest, 0.01);
    // Only fill gaps: areas the ISO view already assigns to a country stay as they are.
    if (iso.features.some((c) => contains(c.geometry, point))) continue;
    const label = p.BRK_NAME.trim();
    const contested = ['Disputed', 'Breakaway', 'Indeterminate'].includes(p.TYPE);
    features.push({
      name: contested ? `${label} (disputed)` : label,
      subjecto: nameOf(administrator(p)),
      precision: 1,
      geometry: f.geometry,
    });
  }

  // Simplify countries and disputed areas together so their shared borders stay shared.
  const raw = join(CACHE_DIR, `present_${year}.geojson`);
  writeFileSync(raw, JSON.stringify({
    type: 'FeatureCollection',
    features: features.map(({ geometry, ...properties }) => ({ type: 'Feature', properties, geometry })),
  }));
  process.stdout.write(`${year}: simplifying... `);
  simplify(raw, tmp, 'name,subjecto,precision', '1.2%');
  return readJson(tmp).features.map((f) => ({
    name: f.properties.name,
    subjecto: f.properties.subjecto ?? null,
    partof: null,
    precision: f.properties.precision,
    // Small disputed specks (Rockall, Bir Tawil…) stay hoverable but unlabelled.
    label: f.properties.precision > 1 || (!!f.geometry && Math.max(...polygonsOf(f.geometry).map((p) => ringArea(p[0]))) >= 1),
    geometry: f.geometry,
  }));
}

for (const year of years) {
  const out = join(OUT_DIR, `world_${year}.geojson`);
  const tmp = `${out}.tmp.geojson`;
  const polities = year === PRESENT_YEAR ? await presentDay(year, tmp) : await historical(year, tmp);

  // Add a stable numeric id so the globe can use feature-state for hover highlights.
  const unlabelled = new Set();
  const geo = {
    type: 'FeatureCollection',
    features: polities.map(({ geometry, label = true, ...properties }, i) => {
      if (!label) unlabelled.add(i);
      return { type: 'Feature', id: i + 1, properties, geometry };
    }),
  };

  // One label point per named polity, at the pole of inaccessibility of its
  // largest ring. Letting MapLibre place polygon labels itself produces one
  // label per tile fragment, so large empires get labelled several times.
  const labels = [];
  const byName = new Map();
  for (const [i, f] of geo.features.entries()) {
    if (!f.properties.name || !f.geometry || unlabelled.has(i)) continue;
    for (const poly of polygonsOf(f.geometry)) {
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
  const landRaw = await cached('ne_50m_land.geojson', `${NATURAL_EARTH}/ne_50m_land.geojson`);
  process.stdout.write('land: simplifying... ');
  simplify(landRaw, landOut, '', '10%');
  console.log(`${(statSync(landOut).size / 1024).toFixed(0)} KB`);
}

console.log(`\nWrote ${years.length} snapshot file(s) to public/data/snapshots/.`);
