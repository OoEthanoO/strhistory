#!/usr/bin/env node
// Smoke test + timings for a built dataset, through the package's public entry points.
//
//   npx tsc -p packages/borders/tsconfig.json       (the script imports dist/)
//   node packages/borders/src/tools/smoke.mjs [path/to/manifest.json] [--lod l0] [--quick] [--json]
//
// Default manifest: packages/borders/data/manifest.json. Reads files from disk with
// fileFetch, so timings include reading and parsing JSON but no network.
//   1. sample years: bordersAt / labelsAt / linesAt timings, cold (chunk loaded) or warm
//   2. every frame in order with memoisation off, as when the timeline plays through
//      history (skipped with --quick)
//   3. each LOD cold for a few years; 4. polity index, search, base land
// Exits 1 when a contract check fails: features outside their year, duplicate or
// missing ids, bad geometry, two labels for one polity, antimeridian/pole edges drawn
// as lines, missing coast.

import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBorders, formatYear } from '@alexs-atlas/borders';
import { fileFetch } from '@alexs-atlas/borders/node';

// ---------------------------------------------------------------- arguments

const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const valueOf = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const asJson = has('json');
const quick = has('quick');
const lodArg = valueOf('lod');
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lod');
const manifestPath = positional[0] ?? fileURLToPath(new URL('../../data/manifest.json', import.meta.url));
if (!existsSync(manifestPath)) {
  console.error(`No dataset at ${manifestPath} (run the pipeline first, or pass a manifest path).`);
  process.exit(2);
}
const manifestUrl = pathToFileURL(manifestPath).href;

// ---------------------------------------------------------------- helpers

const problems = [];
const now = () => performance.now();
const ms = (t) => Math.round(t * 10) / 10;
async function time(fn) {
  const t0 = now();
  const value = await fn();
  return { value, t: now() - t0 };
}
const stat = (values) => {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 0) return {};
  const at = (p) => ms(v[Math.min(v.length - 1, Math.floor(v.length * p))]);
  return { n: v.length, median: at(0.5), p95: at(0.95), max: ms(v[v.length - 1]) };
};

const polygonsOf = (geometry) => (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates);

// A segment along the ±180° meridian or a pole: the data's cut lines, never drawn.
const EPS = 1e-7;
const sameEdge = (u, v, limit) => (u >= limit - EPS && v >= limit - EPS) || (u <= -limit + EPS && v <= -limit + EPS);
const isCutEdge = (a, b) => sameEdge(a[0], b[0], 180) || sameEdge(a[1], b[1], 90);

/** Contract checks on one year's bordersAt / labelsAt / linesAt results. */
function check(year, fc, labels, lines) {
  const ids = new Set();
  for (const f of fc.features) {
    const p = f.properties;
    if (!(p.from <= year && year <= p.to)) problems.push(`${year}: ${p.rid} alive ${p.from}..${p.to}`);
    if (f.id !== p.id) problems.push(`${year}: ${p.rid} Feature.id ${f.id} != props.id ${p.id}`);
    if (ids.has(p.id)) problems.push(`${year}: duplicate id ${p.id}`);
    ids.add(p.id);
    if (f.geometry.type !== 'Polygon' && f.geometry.type !== 'MultiPolygon') {
      problems.push(`${year}: ${p.rid} is a ${f.geometry.type}`);
      continue;
    }
    const polys = polygonsOf(f.geometry);
    if (polys.length === 0) problems.push(`${year}: ${p.rid} has an empty geometry`);
    for (const ring of polys.flat()) {
      if (ring.length < 4) problems.push(`${year}: ${p.rid} has a ring with ${ring.length} points`);
      const bad = ring.find(([x, y]) => !(x >= -180 && x <= 180 && y >= -90 && y <= 90));
      if (bad) problems.push(`${year}: ${p.rid} has a point out of range (${bad[0]}, ${bad[1]})`);
    }
  }
  const pids = new Set();
  for (const f of labels.features) {
    const p = f.properties;
    if (p.kind === 'unclaimed') problems.push(`${year}: label for unclaimed land ${p.rid}`);
    if (pids.has(p.pid)) problems.push(`${year}: two labels for ${p.pid}`);
    pids.add(p.pid);
  }
  for (const f of lines.features) {
    for (const line of f.geometry.coordinates) {
      for (let i = 1; i < line.length; i++) {
        if (isCutEdge(line[i - 1], line[i])) {
          problems.push(`${year}: ${f.properties.kind} line along a cut edge at (${line[i][0]}, ${line[i][1]})`);
          break;
        }
      }
    }
  }
  const kinds = lines.features.map((f) => f.properties.kind);
  if (fc.features.some((f) => f.properties.tier === 0) && !kinds.includes('coast')) problems.push(`${year}: no coast lines`);
}

const summarise = (fc) => {
  const tier0 = fc.features.filter((f) => f.properties.tier === 0);
  return {
    features: fc.features.length,
    tier1: fc.features.length - tier0.length,
    unclaimed: tier0.filter((f) => f.properties.kind === 'unclaimed').length,
    tier0AreaMkm2: Math.round(tier0.reduce((s, f) => s + (f.properties.a || 0), 0) / 1e5) / 10,
  };
};

const vertexCount = (fc) => {
  let n = 0;
  for (const f of fc.features) for (const ring of polygonsOf(f.geometry).flat()) n += ring.length;
  return n;
};

// ---------------------------------------------------------------- 1. sample years

const client = createBorders({ manifestUrl }, { fetch: fileFetch });
const { value: m, t: tManifest } = await time(() => client.ready());
const lod = typeof lodArg === 'string' ? lodArg : m.lods[0].id;
const inRange = (y) => y >= m.years.from && y <= m.years.to;
const chunkOf = (y) => m.chunks.find((c) => c.from <= y && y <= c.to);
const YEARS = [-3400, -2000, -1000, -500, -1, 1, 117, 500, 800, 1000, 1200, 1453, 1500, 1648, 1700, 1789, 1815, 1871, 1914, 1920, 1939, 1945, 1946, 1991, 2026].filter(inRange);

const report = {
  dataset: `${m.dataset} ${m.version} (built ${m.built})`,
  years: `${formatYear(m.years.from)} … ${formatYear(m.years.to)}, cut-over ${m.years.cutover}`,
  frames: m.frames.length,
  chunks: m.chunks.length,
  lods: m.lods.map((l) => l.id).join(', '),
  manifestMs: ms(tManifest),
  lod,
  perYear: [],
};

// "cold" = the first year read from its chunk (file read + JSON parse + decode),
// "warm" = chunk cached, new frame decoded; "memo" = the same frame asked again.
const seenChunks = new Set();
for (const year of YEARS) {
  const chunk = chunkOf(year);
  const cold = !seenChunks.has(chunk.id);
  seenChunks.add(chunk.id);
  const b = await time(() => client.bordersAt(year, { lod }));
  const l = await time(() => client.labelsAt(year, { lod }));
  const n = await time(() => client.linesAt(year, { lod }));
  const again = await time(() => client.bordersAt(year, { lod }));
  check(year, b.value, l.value, n.value);
  const frame = client.frameOf(year);
  report.perYear.push({
    year: formatYear(year),
    frame: `${frame.from}..${frame.to}`,
    chunk: chunk.id,
    load: cold ? 'cold' : 'warm',
    bordersMs: ms(b.t),
    labelsMs: ms(l.t),
    linesMs: ms(n.t),
    memoMs: ms(again.t),
    vertices: vertexCount(b.value),
    ...summarise(b.value),
  });
}

// ---------------------------------------------------------------- 2. every frame

if (!quick) {
  const sweep = createBorders({ manifestUrl }, { fetch: fileFetch, cacheFrames: 0 });
  await sweep.ready();
  const rows = { warm: [], chunkLoad: [] };
  let previous;
  const t0 = now();
  for (const year of m.frames) {
    const chunk = chunkOf(year);
    const a = now();
    const fc = await sweep.bordersAt(year, { lod });
    const b = now();
    const lines = await sweep.linesAt(year, { lod });
    const c = now();
    const labels = await sweep.labelsAt(year, { lod });
    const d = now();
    rows[chunk?.id === previous ? 'warm' : 'chunkLoad'].push({ borders: b - a, lines: c - b, labels: d - c, total: d - a });
    previous = chunk?.id;
    check(year, fc, labels, lines);
  }
  const pick = (list, k) => stat(list.map((r) => r[k]));
  report.everyFrame = {
    frames: m.frames.length,
    totalMs: ms(now() - t0),
    warm: { bordersMs: pick(rows.warm, 'borders'), linesMs: pick(rows.warm, 'lines'), labelsMs: pick(rows.warm, 'labels'), frameMs: pick(rows.warm, 'total') },
    withChunkLoad: { bordersMs: pick(rows.chunkLoad, 'borders'), frameMs: pick(rows.chunkLoad, 'total') },
  };
}

// ---------------------------------------------------------------- 3. LODs, cold

report.lodCold = [];
for (const l of m.lods) {
  for (const year of [1453, 1914, 2026].filter(inRange)) {
    const c = createBorders({ manifestUrl }, { fetch: fileFetch });
    await c.ready();
    const r = await time(() => c.bordersAt(year, { lod: l.id }));
    const lines = await time(() => c.linesAt(year, { lod: l.id }));
    report.lodCold.push({ lod: l.id, year, bordersMs: ms(r.t), linesMs: ms(lines.t), features: r.value.features.length, vertices: vertexCount(r.value) });
  }
}

// ---------------------------------------------------------------- 4. index, search, base

const { value: index, t: tIndex } = await time(() => client.polities());
const { t: tFirstSearch } = await time(() => client.search('rome'));
report.polities = { entries: Object.keys(index).length, loadMs: ms(tIndex), firstSearchIncludingIndexBuildMs: ms(tFirstSearch) };
report.search = [];
for (const q of ['rome', 'ottoman', 'ottomon empire', 'byzantine', 'hawaii', 'dai viet', 'ming', 'kingdom of', 'zzzz']) {
  const r = await time(() => client.search(q, { limit: 5 }));
  report.search.push({ q, ms: ms(r.t), top: r.value.map((h) => h.name).join(' | ') });
}
const base = await time(() => client.base('land', lod));
report.baseLand = { ms: ms(base.t), features: base.value.features.length };

report.problems = problems.length;

if (asJson) {
  console.log(JSON.stringify({ ...report, problemList: problems.slice(0, 50) }, null, 1));
} else {
  const { perYear, everyFrame, lodCold, search, ...head } = report;
  console.log(head);
  console.table(perYear);
  if (everyFrame) console.log('Every frame, memo off:', JSON.stringify(everyFrame, null, 1));
  console.table(lodCold);
  console.table(search);
  for (const p of problems.slice(0, 50)) console.log('PROBLEM', p);
  if (problems.length > 50) console.log(`… ${problems.length - 50} more problems`);
}
process.exit(problems.length > 0 ? 1 : 0);
