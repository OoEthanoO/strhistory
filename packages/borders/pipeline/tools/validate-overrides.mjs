#!/usr/bin/env node
// Validates override files against overrides/schema.json plus cross-file rules:
// unique ids, year windows per file kind, Natural Earth codes, polity ids that
// exist (Cliopatria inventory or an 'add'), modern unit timelines without gaps or
// overlaps, and (with --complete) one modern unit per Natural Earth admin-0 code.
//
//   node packages/borders/pipeline/tools/validate-overrides.mjs            # all files
//   node packages/borders/pipeline/tools/validate-overrides.mjs --file packages/borders/overrides/historical/caribbean.json
//   node packages/borders/pipeline/tools/validate-overrides.mjs --complete # also require full modern coverage
//
// Needs .cache/reference (npm run data:reference).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const PRESENT_YEAR = 2026;
export const CUTOVER_YEAR = 1946; // first year of the modern (Natural Earth) layer
export const HISTORICAL_FROM = 1700;
export const FIRST_YEAR = -3400;

const here = dirname(fileURLToPath(import.meta.url));
const borders = resolve(here, '../..');
const root = resolve(borders, '../..');
const overridesDir = join(borders, 'overrides');
const refDir = join(root, '.cache', 'reference');

const args = process.argv.slice(2);
const onlyFile = args.includes('--file') ? resolve(args[args.indexOf('--file') + 1]) : null;
const complete = args.includes('--complete');

const errors = [];
const warnings = [];
const err = (file, msg) => errors.push(`${file}: ${msg}`);
const warn = (file, msg) => warnings.push(`${file}: ${msg}`);

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const yr = (y) => (y === 'present' ? PRESENT_YEAR : y);

if (!existsSync(refDir)) {
  console.error('Missing .cache/reference — run `npm run data:reference` first.');
  process.exit(2);
}
const admin0 = readJson(join(refDir, 'ne-admin0.json'));
const admin1 = readJson(join(refDir, 'ne-admin1.json'));
const disputed = readJson(join(refDir, 'ne-disputed.json'));
const inventory = readJson(join(refDir, 'cliopatria-inventory.json'));

const admin0Codes = new Set(admin0.map((r) => r.code));
const admin1Codes = new Set(admin1.flatMap((r) => [r.code, r.iso].filter((c) => c && c !== '-99')));
const disputedCodes = new Set(disputed.map((r) => r.code));
const clioSpans = new Map(); // pid -> [[from,to],...]
for (const r of inventory) {
  if (!clioSpans.has(r.pid)) clioSpans.set(r.pid, []);
  clioSpans.get(r.pid).push([r.from, r.to]);
}

const schema = readJson(join(overridesDir, 'schema.json'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateSchema = ajv.compile(schema);

function listFiles() {
  const out = [];
  for (const kind of ['historical', 'early', 'modern']) {
    const dir = join(overridesDir, kind);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) if (f.endsWith('.json')) out.push(join(dir, f));
  }
  return out.sort();
}

const files = listFiles();
const loaded = [];
for (const path of files) {
  const rel = relative(root, path).replaceAll('\\', '/');
  let data;
  try {
    data = readJson(path);
  } catch (e) {
    err(rel, `invalid JSON: ${e.message}`);
    continue;
  }
  const folder = path.split(/[\\/]/).at(-2);
  if (!validateSchema(data)) {
    // oneOf errors are noisy: show the ones from the branch matching the file kind
    const other = data?.kind === 'modern' ? 'historicalFile' : 'modernFile';
    const seen = new Set();
    for (const e of validateSchema.errors) {
      if (e.schemaPath.includes(other) || e.keyword === 'oneOf' || e.keyword === 'if') continue;
      if (e.instancePath === '' && e.keyword === 'required' && e.params?.missingProperty === 'units' && data?.kind !== 'modern') continue;
      if (e.instancePath === '/kind' && e.keyword === 'const') continue;
      const msg = `schema ${e.instancePath || '/'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`;
      if (seen.has(msg)) continue;
      seen.add(msg);
      if (seen.size <= 40) err(rel, msg);
    }
    if (!seen.size) err(rel, 'schema: file does not match the historical/early or modern file shape');
  }
  if (data?.kind && folder !== data.kind) err(rel, `file is in overrides/${folder}/ but kind is "${data.kind}"`);
  const base = path.split(/[\\/]/).at(-1).replace(/\.json$/, '');
  if (data?.region && data.region !== base) warn(rel, `region "${data.region}" differs from file name "${base}"`);
  loaded.push({ path, rel, data });
}

// ---- collect polities added by overrides (needed for target checks) -------------
const added = new Map(); // pid -> [{years, name, file}]
for (const { rel, data } of loaded) {
  for (const e of data.entries ?? []) {
    if (e.op === 'add' && e.set?.pid && (e.status === 'active' || e.status === 'proposed')) {
      if (!added.has(e.set.pid)) added.set(e.set.pid, []);
      added.get(e.set.pid).push({ years: e.years.map(yr), name: e.set.name, file: rel, id: e.id });
    }
  }
}
for (const { rel, data } of loaded) {
  for (const u of data.units ?? []) {
    for (const p of u.timeline ?? []) {
      const pid = p.state?.pid;
      if (!pid) continue;
      if (!added.has(pid)) added.set(pid, []);
      added.get(pid).push({ years: p.years.map(yr), name: p.state.name, file: rel, id: u.unit });
    }
    for (const s of u.subunits ?? []) {
      for (const p of s.timeline ?? []) {
        const pid = p.state?.pid;
        if (!pid) continue;
        if (!added.has(pid)) added.set(pid, []);
        added.get(pid).push({ years: p.years.map(yr), name: p.state.name, file: rel, id: `${u.unit}/${s.id}` });
      }
    }
  }
}

const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];
function aliveSpans(pid) {
  const spans = [...(clioSpans.get(pid) ?? []), ...((added.get(pid) ?? []).map((a) => a.years))];
  return spans;
}
function pidKnown(pid) {
  return clioSpans.has(pid) || added.has(pid);
}

// ---- geometry reference checks ---------------------------------------------------
function checkGeometry(rel, where, g, years) {
  if (!g || typeof g !== 'object') return;
  switch (g.type) {
    case 'admin0':
      for (const c of g.codes ?? []) if (!admin0Codes.has(c)) err(rel, `${where}: unknown admin0 code ${c}`);
      break;
    case 'admin1':
      for (const c of g.codes ?? []) if (!admin1Codes.has(c)) err(rel, `${where}: unknown admin1 code ${c}`);
      break;
    case 'ne-disputed':
      for (const c of g.codes ?? []) if (!disputedCodes.has(c)) err(rel, `${where}: unknown ne-disputed code ${c}`);
      break;
    case 'polygon': {
      const polys = g.rings ? [g.rings] : g.polygons ?? [];
      polys.forEach((rings, i) =>
        rings.forEach((ring, j) => {
          const a = ring[0];
          const b = ring.at(-1);
          if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) err(rel, `${where}: polygon ${i} ring ${j} is not closed (first != last)`);
          if (new Set(ring.map((p) => p.join(','))).size < 3) err(rel, `${where}: polygon ${i} ring ${j} has < 3 distinct positions`);
        }),
      );
      break;
    }
    case 'record': {
      if (!pidKnown(g.pid)) err(rel, `${where}: record geometry refers to unknown pid ${g.pid}`);
      else if (!aliveSpans(g.pid).some((s) => s[0] <= g.year && g.year <= s[1]))
        err(rel, `${where}: pid ${g.pid} is not alive in ${g.year}`);
      break;
    }
    case 'union':
    case 'intersection':
      (g.parts ?? []).forEach((p, i) => checkGeometry(rel, `${where}.parts[${i}]`, p, years));
      break;
    case 'difference':
      checkGeometry(rel, `${where}.base`, g.base, years);
      (g.minus ?? []).forEach((p, i) => checkGeometry(rel, `${where}.minus[${i}]`, p, years));
      break;
    default:
      break;
  }
}

// ---- per-file rules ---------------------------------------------------------------
const seenIds = new Map();
const seenUnits = new Map();
const windows = {
  historical: [HISTORICAL_FROM, CUTOVER_YEAR - 1],
  early: [FIRST_YEAR, HISTORICAL_FROM - 1],
  modern: [CUTOVER_YEAR, PRESENT_YEAR],
};

function checkYears(rel, where, years, kind) {
  const [a, b] = years.map(yr);
  if (a > b) err(rel, `${where}: years ${JSON.stringify(years)} run backwards`);
  const [lo, hi] = windows[kind] ?? [FIRST_YEAR, PRESENT_YEAR];
  if (a < lo || b > hi) err(rel, `${where}: years ${a}..${b} fall outside the ${kind} window ${lo}..${hi}`);
}

for (const { rel, data, path } of loaded) {
  if (onlyFile && resolve(path) !== onlyFile) continue;
  const kind = data.kind;
  for (const [i, e] of (data.entries ?? []).entries()) {
    const where = `entries[${i}] ${e.id ?? ''}`;
    if (e.id) {
      if (seenIds.has(e.id)) err(rel, `${where}: duplicate id (also in ${seenIds.get(e.id)})`);
      seenIds.set(e.id, rel);
    }
    if (!Array.isArray(e.years)) continue;
    checkYears(rel, where, e.years, kind);
    if (kind === 'modern' && e.op !== 'note') err(rel, `${where}: modern files may only hold 'note' entries; use units/overlays`);
    if (e.target?.pid && e.status !== 'rejected' && e.status !== 'known-gap') {
      if (!pidKnown(e.target.pid)) err(rel, `${where}: target ${e.target.pid} is neither a Cliopatria pid nor added by any override`);
      else if (!aliveSpans(e.target.pid).some((s) => overlaps(s, e.years.map(yr))))
        warn(rel, `${where}: target ${e.target.pid} is not alive in ${e.years.map(yr).join('..')}`);
    }
    if (e.op === 'add' && e.set?.pid?.startsWith('clio:') && !clioSpans.has(e.set.pid))
      warn(rel, `${where}: added pid uses the clio: prefix but is not a Cliopatria polity — use ovr:`);
    if (e.geometry && e.status !== 'rejected') checkGeometry(rel, where, e.geometry, e.years);
    if (e.set?.power && !pidKnown(e.set.power)) warn(rel, `${where}: power ${e.set.power} is not a known pid`);
  }
  for (const [i, u] of (data.units ?? []).entries()) {
    const where = `units[${i}] ${u.unit}`;
    if (!admin0Codes.has(u.unit)) err(rel, `${where}: unknown admin0 code`);
    if (seenUnits.has(u.unit)) err(rel, `${where}: unit also defined in ${seenUnits.get(u.unit)}`);
    seenUnits.set(u.unit, rel);
    const spans = (u.timeline ?? []).map((p, j) => {
      checkYears(rel, `${where}.timeline[${j}]`, p.years, 'modern');
      return p.years.map(yr);
    }).sort((a, b) => a[0] - b[0]);
    for (let j = 1; j < spans.length; j++) {
      if (spans[j][0] <= spans[j - 1][1]) err(rel, `${where}: timeline periods overlap (${spans[j - 1]} / ${spans[j]})`);
      else if (spans[j][0] !== spans[j - 1][1] + 1) {
        const gap = `${spans[j - 1][1] + 1}..${spans[j][0] - 1}`;
        (u.subunits?.length ? warn : err)(rel, `${where}: timeline gap ${gap}${u.subunits?.length ? ' (allowed only if subunits cover the whole unit then)' : ''}`);
      }
    }
    if (spans.length) {
      if (spans[0][0] > CUTOVER_YEAR) (u.subunits?.length ? warn : err)(rel, `${where}: timeline starts in ${spans[0][0]}, not ${CUTOVER_YEAR}`);
      if (spans.at(-1)[1] < PRESENT_YEAR) (u.subunits?.length ? warn : err)(rel, `${where}: timeline ends in ${spans.at(-1)[1]}, not present`);
    } else if (!u.subunits?.length) err(rel, `${where}: empty timeline and no subunits`);
    for (const [j, s] of (u.subunits ?? []).entries()) {
      checkGeometry(rel, `${where}.subunits[${j}] ${s.id}`, s.geometry);
      const ss = s.timeline.map((p) => p.years.map(yr)).sort((a, b) => a[0] - b[0]);
      s.timeline.forEach((p, k) => checkYears(rel, `${where}.subunits[${j}].timeline[${k}]`, p.years, 'modern'));
      for (let k = 1; k < ss.length; k++) if (ss[k][0] <= ss[k - 1][1]) err(rel, `${where}.subunits[${j}]: periods overlap`);
    }
  }
  for (const [i, o] of (data.overlays ?? []).entries()) {
    const where = `overlays[${i}] ${o.id}`;
    checkGeometry(rel, where, o.geometry);
    o.timeline.forEach((p, k) => checkYears(rel, `${where}.timeline[${k}]`, p.years, 'modern'));
  }
}

// ---- cross-file: pid naming consistency -------------------------------------------------
for (const [pid, uses] of added) {
  const names = new Set(uses.map((u) => u.name));
  if (names.size > 1 && !onlyFile) warn('(all)', `pid ${pid} is used with several names: ${[...names].join(' | ')}`);
  if (clioSpans.has(pid)) {
    // overrides that re-add a Cliopatria pid are fine (extensions); flag only exact overlaps
    for (const u of uses) {
      if (clioSpans.get(pid).some((s) => overlaps(s, u.years)) && u.file.includes('/historical/'))
        warn(u.file, `${u.id}: adds ${pid} in ${u.years.join('..')} while Cliopatria already has it then (double geometry?)`);
    }
  }
}

// ---- cross-file: one pid, one set of attributes per year ------------------------------
// The modern layer draws a pid held by several units (or subunits) in one year as one
// feature, so they must agree on its attributes then: the build (py/modern.py _merge,
// CONFLICT_KEYS) reports a disagreement as an error. Checked here so editors see it
// in seconds rather than after the geometry step.
const CONFLICT_KEYS = ['name', 'kind', 'power', 'wikidata'];
const holders = new Map(); // pid -> [{ origin, file, years: [a, b], state }]
for (const { rel, data } of loaded) {
  for (const u of data.units ?? []) {
    const hold = (origin, p) => {
      const pid = p.state?.pid;
      if (!pid || !Array.isArray(p.years)) return;
      if (!holders.has(pid)) holders.set(pid, []);
      holders.get(pid).push({ origin, file: rel, years: p.years.map(yr), state: p.state });
    };
    for (const p of u.timeline ?? []) hold(u.unit, p);
    for (const s of u.subunits ?? []) for (const p of s.timeline ?? []) hold(`${u.unit}/${s.id}`, p);
  }
}
for (const [pid, hs] of holders) {
  const seen = new Set();
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i], b = hs[j];
      if (a.origin === b.origin || !overlaps(a.years, b.years)) continue;
      if (onlyFile && ![a.file, b.file].includes(relative(root, onlyFile).replaceAll('\\', '/'))) continue;
      const lo = Math.max(a.years[0], b.years[0]), hi = Math.min(a.years[1], b.years[1]);
      for (const k of CONFLICT_KEYS) {
        const va = a.state[k], vb = b.state[k];
        if (va === undefined || va === null || vb === undefined || vb === null || JSON.stringify(va) === JSON.stringify(vb)) continue;
        const msg = `${pid} ${k} differs between units in ${lo}..${hi}: ${JSON.stringify(va)} (${a.origin}) vs ${JSON.stringify(vb)} (${b.origin})`;
        if (seen.has(msg)) continue;
        seen.add(msg);
        err(a.file === b.file ? a.file : `${a.file} + ${b.file}`, msg);
      }
    }
  }
}

if (complete && !onlyFile) {
  const missing = [...admin0Codes].filter((c) => !seenUnits.has(c));
  if (missing.length) err('(modern)', `admin-0 units without a modern timeline: ${missing.join(', ')}`);
}

const scope = onlyFile ? relative(root, onlyFile) : `${loaded.length} files`;
for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`\n${scope}: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
