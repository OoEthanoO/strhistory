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
 * Output: public/data/snapshots/world_<year>.geojson. A 100 m simplification
 * threshold (5 m for features under 100 km²) retains outlines at close zoom; Caddy compresses the
 * downloads and MapLibre builds progressively finer tiles from this geometry.
 *
 * Both sources are pinned to a commit so a rebuild reproduces the committed
 * files. To take upstream corrections, bump the commit, rebuild every year and
 * review the diff and the warnings this script prints.
 *
 * Each polity carries `subjecto` (the controlling power as the period spells it,
 * shown on hover) and `power` (one canonical name per power, which picks the
 * colour). See scripts/data/powers.json.
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
const POWERS = JSON.parse(readFileSync(join(ROOT, 'scripts/data/powers.json'), 'utf8'));
const RULERS = JSON.parse(readFileSync(join(ROOT, 'scripts/data/rulers.json'), 'utf8'));
const GLYPH_DIR = join(ROOT, 'public/glyphs/noto-sans');
/** aourednik/historical-basemaps master on 2026-09-15. */
const BASEMAPS_COMMIT = 'da7a4b735ecef70aebdc9c73e409d8a2500d50f3';
/** nvkelso/natural-earth-vector master (v5.1.2 data) on 2022-06-02. */
const NATURAL_EARTH_COMMIT = 'ca96624a56bd078437bca8184e78163e5039ad19';
const SOURCE = `https://raw.githubusercontent.com/aourednik/historical-basemaps/${BASEMAPS_COMMIT}/geojson`;
const NATURAL_EARTH = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${NATURAL_EARTH_COMMIT}/geojson`;
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
  const commit = url.includes(BASEMAPS_COMMIT) ? BASEMAPS_COMMIT : NATURAL_EARTH_COMMIT;
  const file = join(CACHE_DIR, `${commit.slice(0, 8)}_${name}`);
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
 * Runs mapshaper. On Windows npx runs through a shell, which would split a path
 * containing spaces and misread an empty argument or an expression, so paths
 * are passed relative to the repo (use `rel`) and such arguments are quoted.
 */
function mapshaper(args) {
  const shell = process.platform === 'win32';
  const quote = (arg) => (shell && !/^[\w.,=:/\\-]+$/.test(arg) ? `"${arg}"` : arg);
  execFileSync('npx', ['-y', MAPSHAPER, ...args.map(quote)], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'], shell });
}
const rel = (file) => relative(ROOT, file);

/** Simplifies `input` with mapshaper, keeping only `fields`. */
function simplify(input, output, fields) {
  mapshaper([
    '-i', rel(input),
    '-filter-fields', fields,
    // A fixed percentage can reduce a small country to a triangle. Bound
    // distance instead, with shared topology and intersection repair intact.
    '-simplify', 'dp', 'variable',
    // Geographic datasets use square metres for area and metres for interval.
    // Protect microstates whose entire width can be only a few hundred metres.
    'interval=this.area<1e8?5:100', 'keep-shapes',
    '-o', rel(output), 'format=geojson', 'precision=0.00001', 'force',
  ]);
}

/** Every spelling of a power → its canonical name, which picks the colour. */
const CANONICAL = new Map(Object.entries(POWERS.aliases).flatMap(([power, names]) => names.map((n) => [n, power])));
const canonicalPower = (name) => (name ? CANONICAL.get(name) ?? name : null);

/**
 * The ruler a colony's own name states, for polities upstream records as ruling
 * themselves: "Tanganyika (UK)" → UK, "Dutch Guiana" → Netherlands. Only exact
 * power names in parentheses count, so "(Plains Cree)" or "(disputed)" never do.
 */
function rulerNamedIn(name) {
  if (!name || CANONICAL.has(name)) return null;
  const suffix = name.match(/\(([^()]+)\)\s*$/)?.[1];
  if (suffix && CANONICAL.has(suffix)) return canonicalPower(suffix);
  const adjective = name.match(/^(\S+)\s/)?.[1];
  return POWERS.adjectives[adjective] ?? null;
}

/** Glyph ranges the self-hosted map font provides (public/glyphs/noto-sans/<start>-<end>.pbf). */
const GLYPH_RANGES = readdirSync(GLYPH_DIR)
  .map((f) => f.match(/^(\d+)-(\d+)\.pbf$/))
  .filter(Boolean)
  .map((m) => [Number(m[1]), Number(m[2])]);
const drawable = (ch) => GLYPH_RANGES.some(([a, b]) => ch.codePointAt(0) >= a && ch.codePointAt(0) <= b);
/** Conventional ASCII stand-ins, e.g. the Mohawk length mark in "Kanienʼkehá꞉ka". */
const STAND_INS = { '꞉': ':' };

/**
 * Map label text using only characters the map font can draw. Names are kept
 * in full for the hover card, which the browser renders with system fonts.
 * "ᓀᐦᐃᔭᐤ ᐊᐢᑭᕀ Nêhiyaw-Askiy (Plains Cree)" → "Nêhiyaw-Askiy (Plains Cree)".
 */
function labelText(name) {
  if ([...name].every(drawable)) return name;
  let text = [...name].map((ch) => (drawable(ch) ? ch : STAND_INS[ch] ?? ' ')).join('')
    .replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').replace(/\(\s*\)/g, '')
    .replace(/\s+/g, ' ').trim();
  // Nothing readable outside the brackets: use the bracketed name ("… (Osage)" → "Osage").
  const bracketed = text.match(/^([^(]*)\(([^()]+)\)$/);
  if (bracketed && !/\p{L}/u.test(bracketed[1])) text = bracketed[2].trim();
  return /\p{L}/u.test(text) ? text : null;
}

/** Rulers inferred by rulerNamedIn(), printed at the end for review. */
const inferred = [];
/** rulers.json entries that matched a self-ruling polity in some year. */
const usedRulers = new Set();

/** Historical borders from historical-basemaps, with per-year name fixes applied. */
async function historical(year, tmp) {
  const upstreamYear = year < 0 ? `bc${Math.abs(year)}` : year;
  const raw = await cached(`world_${year}.geojson`, `${SOURCE}/world_${upstreamYear}.geojson`);
  process.stdout.write(`${year}: simplifying... `);
  simplify(raw, tmp, 'NAME,SUBJECTO,PARTOF');

  const fixes = OVERRIDES[String(year)] ?? {};
  const unused = new Set(Object.keys(fixes));
  const features = readJson(tmp).features;
  // Upstream includes zero-area rings, zero-area duplicates of named polities
  // and unnamed slivers of a few square metres; mapshaper collapses them to null
  // geometry. Warn only if a name disappears from the map altogether.
  const slivers = features.filter((f) => !f.geometry);
  const kept = new Set(features.filter((f) => f.geometry).map((f) => f.properties?.NAME));
  const lost = [...new Set(slivers.map((f) => f.properties?.NAME).filter((n) => n && !kept.has(n)))];
  if (lost.length) console.warn(`\n  ${year}: named polities with no area left after simplification: ${lost.join(', ')}`);
  const polities = features.filter((f) => f.geometry).map((f) => {
    const p = f.properties ?? {};
    const fix = fixes[p.NAME];
    const subjectFix = fixes[p.SUBJECTO];
    if (fix !== undefined) unused.delete(p.NAME);
    if (subjectFix !== undefined) unused.delete(p.SUBJECTO);
    let name = p.NAME ?? null;
    // A controlling power needs a name: upstream has a few stray values such as "3".
    let subject = /\p{L}/u.test(p.SUBJECTO ?? '') ? p.SUBJECTO : name;
    let explicit = false;
    if (typeof subjectFix === 'string') subject = subjectFix;
    if (typeof fix === 'string') name = fix;
    else if (fix) {
      name = fix.name ?? name;
      if (fix.subjecto) { subject = fix.subjecto; explicit = true; }
    }
    // Upstream records many colonies as ruling themselves. Use rulers.json, or
    // failing that the ruler the name states ("Dutch Guiana").
    if (!explicit && subject === name) {
      const ruler = RULERS[name]?.find(({ from, to }) => from <= year && year <= to)?.ruler ?? rulerNamedIn(name);
      if (RULERS[name]) usedRulers.add(name);
      if (ruler) {
        if (!RULERS[name]) inferred.push(`${year} ${name} → ${ruler}`);
        subject = ruler;
      }
    }
    return {
      name,
      subjecto: subject,
      power: canonicalPower(subject),
      partof: p.PARTOF ?? null,
      geometry: f.geometry,
    };
  });
  if (unused.size) console.warn(`\n  ${year}: name-overrides.json entries that match nothing upstream: ${[...unused].join(', ')}`);
  process.stdout.write(`${slivers.length} empty slivers dropped, `);
  return polities;
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
    return { name, subjecto: own ? name : nameOf(p.SOVEREIGNT), disputed: false, geometry: f.geometry };
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
      disputed: contested,
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
  simplify(raw, tmp, 'name,subjecto,disputed');
  return readJson(tmp).features.filter((f) => f.geometry).map((f) => ({
    name: f.properties.name,
    subjecto: f.properties.subjecto ?? null,
    power: canonicalPower(f.properties.subjecto),
    partof: null,
    // Drawn dashed: the only borders in any snapshot that carry their own claim of uncertainty.
    disputed: f.properties.disputed,
    // Small disputed specks (Rockall, Bir Tawil…) stay hoverable but unlabelled.
    label: !f.properties.disputed || (!!f.geometry && Math.max(...polygonsOf(f.geometry).map((p) => ringArea(p[0]))) >= 1),
    geometry: f.geometry,
  }));
}

const relabelled = [];
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
    const text = labelText(name);
    if (text === null) continue;
    if (text !== name) relabelled.push(`${year} ${name} → ${text}`);
    const [lng, lat] = polylabel(poly, 0.1);
    labels.push({
      type: 'Feature',
      properties: { kind: 'label', name: text, subjecto: props.subjecto, area: Math.round(area * 100) / 100 },
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
  const landRaw = await cached('ne_10m_land.geojson', `${NATURAL_EARTH}/ne_10m_land.geojson`);
  process.stdout.write('land: simplifying... ');
  simplify(landRaw, landOut, '');
  console.log(`${(statSync(landOut).size / 1024).toFixed(0)} KB`);
}

const unusedRulers = Object.keys(RULERS).filter((name) => name !== '$comment' && !usedRulers.has(name));
if (requested.length === 0 && unusedRulers.length) console.warn(`\nrulers.json entries that match no self-ruling polity: ${unusedRulers.join(', ')}`);
if (inferred.length) console.log(`\nRulers inferred from colony names (review; override in name-overrides.json):\n  ${inferred.join('\n  ')}`);
if (relabelled.length) console.log(`\nMap labels shortened to characters the map font can draw (hover shows the full name):\n  ${relabelled.join('\n  ')}`);
console.log(`\nWrote ${years.length} snapshot file(s) to public/data/snapshots/.`);
