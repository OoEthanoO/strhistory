#!/usr/bin/env node
/**
 * Builds the globe's border files from Cliopatria (Seshat Global History
 * Databank, CC BY 4.0): https://github.com/Seshat-Global-History-Databank/cliopatria
 *
 *   npm run data:cliopatria
 *
 * Cliopatria has one record per polity per span of years (FromYear–ToYear,
 * inclusive; BCE years are negative), 3400 BCE–2024 CE. This script keeps the
 * polities (not alliances or bracketed groupings), simplifies them lightly, and splits them into time
 * chunks of about CHUNK_BYTES each, so the globe downloads only the chunk for
 * the chosen year and filters within it: any year works, not just timeline stops.
 *
 * Output: public/data/cliopatria/<from>_<to>.json and index.json listing them.
 * Each polygon carries name, from, to (this record), start, end (the polity's
 * whole span), area, parent (MemberOf, e.g. "British Empire") and power (the colour
 * key: the parent's power if it has one, see scripts/data/powers.json). Each
 * separate piece of a record is its own polygon feature; one point feature
 * (kind: "label") per record marks where its name goes, and "piece" is the id
 * of the polygon it sits on.
 *
 * The source is pinned to a commit, so a rebuild reproduces the committed files.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import polylabel from 'polylabel';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE = join(ROOT, '.cache/cliopatria');
const OUT = join(ROOT, 'public/data/cliopatria');
/** Seshat-Global-History-Databank/cliopatria, version 0.2.0 (2026-05-16). */
const COMMIT = 'ad28a691b7c07c1fca89d0e0636d324667d2a258';
const SOURCE = `https://github.com/Seshat-Global-History-Databank/cliopatria/raw/${COMMIT}/cliopatria.geojson.zip`;
const MAPSHAPER = 'mapshaper@0.7.67';
/** Target size of one time chunk (bytes, before compression). */
const CHUNK_BYTES = 1_500_000;
const POWERS = JSON.parse(readFileSync(join(ROOT, 'scripts/data/powers.json'), 'utf8'));

mkdirSync(CACHE, { recursive: true });
const rel = (file) => relative(ROOT, file);
const shell = process.platform === 'win32';
const run = (cmd, args, cwd = ROOT) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'], shell });

// ---------- download ----------
const zip = join(CACHE, `cliopatria_${COMMIT.slice(0, 8)}.zip`);
try { statSync(zip); } catch {
  process.stdout.write('downloading Cliopatria... ');
  const res = await fetch(SOURCE);
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
}
const source = () => readdirSync(CACHE).find((f) => /^cliopatria.*\.geojson$/.test(f));
if (!source()) {
  // unzip on Linux and macOS; Windows 10+ has bsdtar as tar.exe, which reads zip.
  const name = basename(zip);
  try { run('unzip', ['-o', '-q', name], CACHE); } catch { run('tar', ['-xf', name], CACHE); }
}
const raw = join(CACHE, source());

// ---------- simplify ----------
// Cliopatria's vertices are already ~25 km apart, so this mostly trims digits.
const simplified = join(CACHE, 'simplified.geojson');
console.log('simplifying...');
run('npx', ['-y', MAPSHAPER, '-i', rel(raw),
  '-filter', shell ? '"Type == \'POLITY\'"' : "Type == 'POLITY'",
  '-filter-fields', 'Name,FromYear,ToYear,MemberOf',
  '-simplify', 'dp', 'interval=1000', 'keep-shapes', 'no-repair',
  '-o', rel(simplified), 'format=geojson', 'precision=0.001', 'force']);

// ---------- colours, spans, labels ----------
const CANONICAL = new Map(Object.entries(POWERS.aliases).flatMap(([power, names]) => names.map((n) => [n, power])));
/** Same rule as powerOf() in src/features/globe/palette.ts. */
function powerOf(name) {
  if (!name) return null;
  if (CANONICAL.has(name)) return CANONICAL.get(name);
  const suffix = name.match(/\(([^()]+)\)\s*$/)?.[1];
  if (suffix && CANONICAL.has(suffix)) return CANONICAL.get(suffix);
  const adjective = POWERS.adjectives[name.split(' ')[0]];
  return adjective ? CANONICAL.get(adjective) ?? adjective : name;
}
const polygonsOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.coordinates);
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) a += (ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]) * Math.cos((ring[i][1] * Math.PI) / 180);
  return Math.abs(a / 2);
}
const round = (n) => Math.round(n * 1000) / 1000;

// Names in brackets, e.g. "(Kingdom of France)", are groupings drawn as the union of
// their members, which are also in the data (checked: they cover the whole group).
// Drawing both would paint members twice and hide their borders, so only members
// are kept; they name the group in MemberOf, which gives them its colour.
const records = JSON.parse(readFileSync(simplified, 'utf8')).features.filter((f) => f.geometry && !/^\(.*\)$/.test(f.properties.Name));
const span = new Map();
for (const { properties: p } of records) {
  const s = span.get(p.Name) ?? [Infinity, -Infinity];
  span.set(p.Name, [Math.min(s[0], p.FromYear), Math.max(s[1], p.ToYear)]);
}
const items = records.map(({ properties: p, geometry }) => {
  // "(British Empire);(Other)" → "British Empire": colonies take their empire's colour.
  const parent = p.MemberOf ? p.MemberOf.split(';')[0].replace(/^\(|\)$/g, '') : null;
  const [start, end] = span.get(p.Name);
  const parts = polygonsOf(geometry);
  const areas = parts.map((poly) => ringArea(poly[0]));
  const largest = areas.indexOf(Math.max(...areas));
  const total = areas.reduce((a, b) => a + b, 0);
  // One feature per separate piece, so the globe can hide the pieces that
  // OpenHistoricalMap already maps and keep the rest (e.g. Egypt within
  // "British Africa"). area (square degrees, latitude-scaled) orders
  // overlapping pieces: smaller on top.
  const pieces = parts.map((coordinates, i) => ({
    type: 'Feature',
    properties: { name: p.Name, from: p.FromYear, to: p.ToYear, start, end, parent, power: powerOf(parent ?? p.Name), area: Math.round(areas[i] * 100) / 100 },
    geometry: { type: 'Polygon', coordinates },
  }));
  const [lng, lat] = polylabel(parts[largest], 0.05);
  // part: index (within this record) of the piece the label sits on; the chunk
  // writer turns it into that piece's feature id.
  const label = { type: 'Feature', properties: { kind: 'label', name: p.Name, from: p.FromYear, to: p.ToYear, area: Math.round(total * 100) / 100, part: largest }, geometry: { type: 'Point', coordinates: [round(lng), round(lat)] } };
  const features = [...pieces, label];
  return { from: p.FromYear, to: p.ToYear, features, bytes: features.reduce((sum, f) => sum + JSON.stringify(f).length, 0) };
});

// ---------- time chunks ----------
// Greedy: grow a chunk year by year (at record boundaries) until the records
// overlapping it pass CHUNK_BYTES. A record spanning chunks goes in each.
const first = Math.min(...items.map((i) => i.from));
const last = Math.max(...items.map((i) => i.to));
// Years where the set of records changes; a chunk always ends just before one.
const boundaries = [...new Set(items.flatMap((i) => [i.from, i.to + 1]))].filter((y) => y > first && y <= last + 1).sort((a, b) => a - b);
const sizeOf = (from, to) => items.reduce((sum, i) => (i.from <= to && i.to >= from ? sum + i.bytes : sum), 0);
const chunks = [];
let from = first;
while (from <= last) {
  let to = null;
  for (const b of boundaries) {
    if (b <= from) continue;
    // Stop before the step that would pass the budget (but take at least one step).
    if (to !== null && sizeOf(from, b - 1) > CHUNK_BYTES) break;
    to = b - 1;
  }
  to ??= last;
  chunks.push([from, to]);
  from = to + 1;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
const index = [];
for (const [a, b] of chunks) {
  const file = `${a}_${b}.json`;
  // Numeric ids let the globe use feature-state for hover highlights and for
  // hiding pieces; a label's "piece" is the id of the piece it sits on.
  const features = [];
  for (const item of items.filter((i) => i.from <= b && i.to >= a)) {
    const first = features.length + 1;
    for (const f of item.features) {
      const copy = { ...f, id: features.length + 1 };
      if (f.properties.kind === 'label') copy.properties = { ...f.properties, piece: first + f.properties.part, part: undefined };
      features.push(copy);
    }
  }
  writeFileSync(join(OUT, file), JSON.stringify({ type: 'FeatureCollection', features }));
  index.push({ from: a, to: b, file });
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ source: `cliopatria@${COMMIT.slice(0, 8)}`, chunks: index }, null, 1));
// CC BY 4.0 asks for credit, a link to the licence, and a note of changes.
writeFileSync(join(OUT, 'LICENSE.md'), `# Border data — licence and attribution

The files in this folder are derived from
[Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria)
(commit \`${COMMIT}\`), by the Seshat Global History Databank, licensed under
[Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/).
They remain under CC BY 4.0.

Changes made by scripts/data/build-cliopatria.mjs: kept polities only (dropped
alliances and bracketed groupings, whose members are kept), simplified outlines
to about 1 km and three decimal places, added colour keys, polity spans and
label points, and split the records into time chunks.

Cite: Bennett, J. S. et al. Cliopatria — A geospatial database of world-wide
political entities from 3400BCE to 2024CE. Scientific Data 12, 247 (2025).
https://doi.org/10.1038/s41597-025-04516-9
`);
const total = index.reduce((sum, c) => sum + statSync(join(OUT, c.file)).size, 0);
console.log(`${records.length} records → ${index.length} chunks, ${(total / 1e6).toFixed(1)} MB in public/data/cliopatria/`);
