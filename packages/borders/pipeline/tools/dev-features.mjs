#!/usr/bin/env node
// Quick DEVELOPMENT features straight from the raw sources, so the query API, globe
// and site can be built and tested before the real geometry step exists:
//   ≤ 1945  Cliopatria v0.2.0 leaf polities (no groups/relations), years normalised
//           (no year 0) and cut at 1945, pids as in .cache/reference, NOT clipped to
//           land, no islands assigned, no overrides.
//   ≥ 1946  Natural Earth admin-0 countries as they are today, for every year.
// Output (same shape as the geometry step's .cache/build/final/):
//   .cache/build/dev/{features.geojsonl, frames.json, polities.json, qa-report.json}
// Then `node packages/borders/pipeline/steps/package.mjs --dev` publishes it.
//
//   node packages/borders/pipeline/tools/dev-features.mjs
import { existsSync, mkdirSync, openSync, writeSync, closeSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG, PATHS, YEARS, normYear, addYears, fnv1a, readJson, writeJson, makeLogger, rel } from '../steps/lib/context.mjs';
import { readZipEntry } from '../steps/lib/zip.mjs';
import { geometryAreaKm2, labelPoint, bboxOf, unionBbox, orientRfc7946, roundGeometry, roundArea, round4 } from '../steps/lib/geo.mjs';

const log = makeLogger('dev-features');
const OUT = PATHS.dev;
const LAST_HISTORICAL = YEARS.cutover - 1;
const PALETTE_SIZE = CONFIG.palette.size;

// ------------------------------------------------------------------- pid convention

/** slug per packages/borders/AGENTS.md §3 (fallback when .cache/reference is missing). */
function slug(name) {
  const s = name.normalize('NFKD').replace(/\p{Mn}/gu, '').toLowerCase().replaceAll('&', ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'unnamed';
}
const isGroupName = (name) => name.startsWith('(') && name.endsWith(')');
function clioPid(name, type) {
  if (type === 'RELATION') return 'clio:rel-' + slug(name);
  if (isGroupName(name)) return 'clio:group-' + slug(name);
  return 'clio:' + slug(name);
}

/** pid for each Cliopatria feature index: from the reference inventory (authoritative), else computed. */
function pidLookup(features) {
  const inv = join(PATHS.reference, 'cliopatria-inventory.json');
  if (existsSync(inv)) {
    const byIndex = new Map(readJson(inv).map((r) => [r.index, r.pid]));
    if (byIndex.size === features.length) return (i) => byIndex.get(i);
    log.warn(`reference inventory has ${byIndex.size} records, source has ${features.length}; computing pids`);
  } else log.warn('no .cache/reference (npm run data:reference); computing pids');
  // Same rule as reference.py / common.disambiguate_pids: names sharing a slug get -q<wikidata> or -<n>.
  const base = features.map((f) => clioPid(f.properties.Name, f.properties.Type));
  const names = new Map();
  base.forEach((pid, i) => {
    if (!names.has(pid)) names.set(pid, new Set());
    names.get(pid).add(features[i].properties.Name);
  });
  const rename = new Map();
  for (const [pid, set] of names) {
    if (set.size < 2) continue;
    [...set].sort().forEach((name, n) => {
      const qids = [...new Set(features.filter((f) => f.properties.Name === name && f.properties.Wikidata).map((f) => f.properties.Wikidata))].sort();
      rename.set(`${pid}\u0000${name}`, qids.length ? `${pid}-${qids[0].toLowerCase()}` : `${pid}-${n + 1}`);
    });
  }
  return (i) => rename.get(`${base[i]}\u0000${features[i].properties.Name}`) ?? base[i];
}

// ----------------------------------------------------------------------------- build

function cliopatriaRecords() {
  const buf = readZipEntry(PATHS.cliopatriaZip, (n) => n.endsWith('.geojson') && !n.startsWith('__MACOSX'));
  const fc = JSON.parse(buf.toString('utf8'));
  log.info(`Cliopatria: ${fc.features.length} records read`);
  const pidOf = pidLookup(fc.features);
  const out = [];
  fc.features.forEach((f, i) => {
    const p = f.properties;
    if (isGroupName(p.Name) || p.Type === 'RELATION') return; // composites: their leaves are drawn
    const from = normYear(p.FromYear, false);
    if (from > LAST_HISTORICAL) return;
    const to = Math.min(normYear(p.ToYear, true), LAST_HISTORICAL);
    const geometry = roundGeometry(f.geometry, 6);
    if (!geometry) return;
    const pid = pidOf(i);
    const power = p.MemberOf ? clioPid(p.MemberOf, 'POLITY') : pid;
    out.push({
      pid, name: p.Name, from, to, kind: 'state', tier: 0, power,
      partof: p.MemberOf ? p.MemberOf.replace(/^\(|\)$/g, '') : null, subjecto: null,
      disputed: false, precision: 'exact', src: 'cliopatria',
      wikidata: p.Wikidata || undefined, wikipedia: p.Wikipedia || undefined,
      geometry,
    });
  });
  return out;
}

function naturalEarthRecords() {
  const fc = readJson(join(PATHS.naturalEarth, 'ne_10m_admin_0_countries.geojson'));
  // Dependencies are coloured with their sovereign: SOVEREIGNT name -> the sovereign's ADM0_A3.
  const sovereignCode = new Map();
  for (const f of fc.features) {
    const p = f.properties;
    if (p.ADMIN === p.SOVEREIGNT) sovereignCode.set(p.SOVEREIGNT, p.ADM0_A3);
  }
  const kindOf = { 'Sovereign country': 'state', Country: 'state', Dependency: 'dependency', Lease: 'dependency', Disputed: 'disputed', Indeterminate: 'disputed' };
  return fc.features.map((f) => {
    const p = f.properties;
    const geometry = roundGeometry(f.geometry, 6);
    if (p.ADM0_A3 === 'ATA') {
      // Antarctica: land with no polity (territorial claims are not drawn).
      return { pid: 'none', name: '', from: YEARS.cutover, to: YEARS.present, kind: 'unclaimed', tier: 0, power: 'none', partof: null, subjecto: null, disputed: false, precision: 'exact', src: 'naturalearth', geometry };
    }
    const pid = `ne:${p.ADM0_A3.toLowerCase()}`;
    const kind = kindOf[p.TYPE] ?? 'state';
    const sov = sovereignCode.get(p.SOVEREIGNT);
    const power = kind === 'dependency' && sov ? `ne:${sov.toLowerCase()}` : pid;
    return {
      pid, name: p.NAME, from: YEARS.cutover, to: YEARS.present, kind, tier: 0, power,
      partof: null, subjecto: kind === 'dependency' && p.SOVEREIGNT !== p.ADMIN ? p.SOVEREIGNT : null,
      disputed: kind === 'disputed', precision: 'exact', src: 'naturalearth',
      wikidata: p.WIKIDATAID || undefined, geometry,
    };
  });
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const records = [...cliopatriaRecords(), ...naturalEarthRecords()];
  log.info(`${records.length} records (${records.filter((r) => r.src === 'cliopatria').length} Cliopatria leaves ≤ ${LAST_HISTORICAL}, ${records.filter((r) => r.src === 'naturalearth').length} Natural Earth units)`);

  // Stable order and ids; rid = pid@from with '#n' when a pid starts twice in a year.
  records.sort((a, b) => a.from - b.from || (a.pid < b.pid ? -1 : a.pid > b.pid ? 1 : 0) || a.to - b.to);
  const ridCount = new Map();
  records.forEach((r, i) => {
    r.id = i + 1;
    const base = `${r.pid}@${r.from}`;
    const n = (ridCount.get(base) ?? 0) + 1;
    ridCount.set(base, n);
    r.rid = n === 1 ? base : `${base}#${n}`;
    orientRfc7946(r.geometry);
    r.a = roundArea(geometryAreaKm2(r.geometry));
    const lp = labelPoint(r.geometry) ?? [0, 0];
    r.lx = round4(lp[0]);
    r.ly = round4(lp[1]);
    r.c = fnv1a(r.power) % PALETTE_SIZE;
  });

  // features.geojsonl (written to a temp file first so a crash never leaves a half file)
  const file = join(OUT, 'features.geojsonl');
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w');
  for (const r of records) {
    const { geometry, ...rest } = r;
    const properties = {
      id: rest.id, rid: rest.rid, pid: rest.pid, name: rest.name, from: rest.from, to: rest.to,
      kind: rest.kind, tier: rest.tier, power: rest.power, partof: rest.partof, subjecto: rest.subjecto,
      disputed: rest.disputed, precision: rest.precision, c: rest.c, a: rest.a, lx: rest.lx, ly: rest.ly, src: rest.src,
      ...(rest.wikidata ? { wikidata: rest.wikidata } : {}), ...(rest.wikipedia ? { wikipedia: rest.wikipedia } : {}),
    };
    writeSync(fd, JSON.stringify({ type: 'Feature', id: r.id, properties, geometry }) + '\n');
  }
  closeSync(fd);
  renameSync(tmp, file);

  // frames: every year in which the set of live records changes
  const frames = new Set([YEARS.first]);
  for (const r of records) {
    if (r.from >= YEARS.first) frames.add(r.from);
    const next = addYears(r.to, 1);
    if (next <= YEARS.present) frames.add(next);
  }
  const frameList = [...frames].filter((y) => y >= YEARS.first && y <= YEARS.present).sort((a, b) => a - b);
  writeJson(join(OUT, 'frames.json'), frameList, 0);

  // polity index
  const polities = {};
  for (const r of records) {
    if (r.pid === 'none') continue;
    const p = (polities[r.pid] ??= { name: r.name, kind: r.kind, spans: [], power: r.power, bbox: null, src: r.src, _peakArea: -1 });
    p.name = r.name; // records are sorted by year: the latest name wins
    p.spans.push([r.from, r.to]);
    p.bbox = unionBbox(p.bbox, bboxOf(r.geometry));
    if (r.wikidata) p.wikidata = r.wikidata;
    if (r.wikipedia) p.wikipedia = r.wikipedia;
    if (r.a > p._peakArea) {
      p._peakArea = r.a;
      p.peak = r.from;
    }
  }
  for (const p of Object.values(polities)) {
    p.spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const s of p.spans) {
      const last = merged[merged.length - 1];
      if (last && s[0] <= addYears(last[1], 1)) last[1] = Math.max(last[1], s[1]);
      else merged.push([...s]);
    }
    p.spans = merged;
    p.bbox = p.bbox.map(round4);
    if (p.power === undefined) delete p.power;
    delete p._peakArea;
  }
  writeJson(join(OUT, 'polities.json'), polities, 0);
  writeJson(join(OUT, 'qa-report.json'), {
    dataset: 'alexs-atlas-borders-dev',
    note: 'Development build: raw Cliopatria leaf polities (not clipped to land, no island assignment, no overrides) and present-day Natural Earth admin-0 units for 1946-present. Not for publication as the real dataset.',
    records: records.length, polities: Object.keys(polities).length, frames: frameList.length,
    bySource: { cliopatria: records.filter((r) => r.src === 'cliopatria').length, naturalearth: records.filter((r) => r.src === 'naturalearth').length },
  });
  log.info(`wrote ${rel(file)} (${records.length} features), ${frameList.length} frames, ${Object.keys(polities).length} polities in ${log.elapsed().toFixed(1)} s`);
}

main();
