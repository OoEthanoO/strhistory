#!/usr/bin/env node
// Packaging step: turns the geometry step's records into the static dataset in
// packages/borders/data/ exactly as root AGENTS.md §5.2 describes.
//
//   node packages/borders/pipeline/steps/package.mjs            # .cache/build/final → data/
//   node packages/borders/pipeline/steps/package.mjs --dev      # .cache/build/dev   → data/ (dataset "alexs-atlas-borders-dev")
//   options: --input=<dir> --out=<dir> --keep-temp --verbose --workers=<n>
//   An input whose geometry QA failed a hard check (qa-report.json checks) is not
//   published to data/: the step exits 1 unless --out points elsewhere (staging) or
//   --allow-failed-qa is given.
//
// Input  (<input>/): features.geojsonl, frames.json, polities.json, qa-report.json
// Output (<out>/):   manifest.json, chunks/<lod>/<chunkId>.<hash8>.topo.json,
//                    base/{land,lakes}-<lod>.<hash8>.topo.json, polities.<hash8>.json,
//                    ATTRIBUTION.md, LICENSE.md, sources.json, qa-report.json
//
// Records: polygon parts under 100 m² (zero-area spikes) are left out; unclaimed land
// is split into pieces, identical records of touching years are merged, and
// unclaimed pieces with the same lifetime are regrouped (lib/dedupe.mjs).
// Chunks: greedy over frames (boundaries at frame starts, a forced break at the
// 1946 cut-over), sized by the measured gzip size of the l0 file (config.chunks).
// Every record goes into each chunk its [from, to] overlaps. Per chunk, the records'
// rings are noded (T-junctions → shared vertices, lib/noding.mjs); per chunk and LOD,
// mapshaper builds one topology from all of them, simplifies it with spherical
// Douglas–Peucker + keep-shapes per polygon part + microstate protection
// (lib/topo.mjs), and the result is post-processed: arcs made identical by
// simplification are merged, parts joined per record, sub-pixel islets of large
// polities dropped, RFC 7946 winding, contract properties, object `polities`.
// Because the tier-0 records of a year share arcs, borders, unclaimed land and
// coastline stay aligned after simplification; lib/verify.mjs checks this for every
// frame of every chunk/LOD (qa-report.json → packaging.alignment).
import { existsSync, mkdirSync, openSync, writeSync, closeSync, rmSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve, relative } from 'node:path';
import { CONFIG, PATHS, YEARS, ROOT, addYears, hash8, sha256, readJson, writeJson, writeFileAtomic, makeLogger, fmtBytes, parseArgs, rel } from './lib/context.mjs';
import { scanFeatures, readRanges, orderedProps, finaliseIds, SLIVER_KM2, SLIVER_WIDTH_M } from './lib/features.mjs';
import { mergeContiguous, groupUnclaimed, renumber } from './lib/dedupe.mjs';
import { planChunks, checkCoverage, chunkId } from './lib/chunking.mjs';
import { simplifyFileToTopology, finishBaseTopology, SIMPLIFY, SNAP_DEGREES, NODE_DEGREES, intervalExpression, protectionSizeM } from './lib/topo.mjs';
import { cleanRings } from './lib/noding.mjs';
import { buildChunkLod, GZIP_LEVEL } from './lib/chunkbuild.mjs';
import { createPool } from './lib/pool.mjs';
import { totalArcKm } from './lib/verify.mjs';
import { buildSources, buildAttribution, buildSourcesJson, attributionMarkdown, licenseMarkdown } from './lib/attribution.mjs';
import { unionBbox, round4, polygonsOf } from './lib/geo.mjs';

const args = parseArgs(process.argv.slice(2));
const flavour = args.dev ? 'dev' : 'final';
const inputDir = args.input ? resolve(args.input) : flavour === 'dev' ? PATHS.dev : PATHS.final;
const outDir = args.out ? resolve(args.out) : PATHS.data;
const tmpDir = PATHS.packageTmp;
const log = makeLogger('package');
const LODS = CONFIG.lods;
const L0 = LODS[0];
const pkgVersion = readJson(join(ROOT, 'packages/borders/package.json')).version;
/** Features below this area (km²) get their decoded area compared with the source per LOD. */
const WATCH_AREA_KM2 = 1000;
const MICROSTATE_PIDS = new Set((CONFIG.microstates ?? []).map((c) => `ne:${c.toLowerCase()}`));

const gzipSize = (text) => gzipSync(text, { level: GZIP_LEVEL }).length;
const fail = (msg) => {
  log.error(msg);
  process.exit(1);
};

// ------------------------------------------------------------------------- inputs

function loadInputs() {
  const need = ['features.geojsonl', 'frames.json', 'polities.json', 'qa-report.json'];
  const missing = need.filter((f) => !existsSync(join(inputDir, f)));
  if (missing.length) {
    fail(`missing ${missing.join(', ')} in ${rel(inputDir)}` + (flavour === 'final' ? ' — run the geometry step first, or package the dev features with --dev' : ' — run tools/dev-features.mjs first'));
  }
  const { features: scanned, errors, slivers } = scanFeatures(join(inputDir, 'features.geojsonl'), { splitUnclaimed: true });
  const inputRecords = new Set(scanned.map((f) => f.offset)).size + slivers.dropped.length;
  if (slivers.parts) {
    log.warn(`${slivers.parts} sliver part(s) under ${SLIVER_KM2 * 1e6} m² or thinner than ${SLIVER_WIDTH_M} m (${slivers.km2} km² in all) left out of ${slivers.records.length} record(s)` + (slivers.dropped.length ? `; ${slivers.dropped.length} record(s) were nothing else and are dropped: ${slivers.dropped.slice(0, 5).join(', ')}` : '') + ' (qa-report packaging.slivers)');
  }
  const { entries: mergedEntries, merged } = mergeContiguous(scanned);
  const { entries: features, grouped } = groupUnclaimed(mergedEntries);
  renumber(features);
  errors.push(...finaliseIds(features));
  if (errors.length) {
    for (const e of errors.slice(0, 50)) log.error(e);
    fail(`${errors.length} problem(s) in features.geojsonl`);
  }
  if (!features.length) fail('features.geojsonl is empty');
  features.sort((a, b) => a.props.from - b.props.from || a.props.id - b.props.id);
  const dedupe = { inputRecords, afterSplit: scanned.length, merged, grouped, records: features.length };
  if (dedupe.afterSplit !== inputRecords || merged) log.info(`records: ${inputRecords} in, ${scanned.length} after splitting unclaimed land into pieces, ${merged} merged with an identical neighbour year, ${grouped} unclaimed pieces grouped by lifetime → ${features.length}`);
  return {
    features,
    dedupe,
    slivers,
    frames: readJson(join(inputDir, 'frames.json')),
    polities: readJson(join(inputDir, 'polities.json')),
    qa: readJson(join(inputDir, 'qa-report.json')),
  };
}

/**
 * Frames = the years in which the set of records changes (every record's start and
 * end + 1), plus the first year and the cut-over, computed from the (merged)
 * records so that every frame is a visible change. Differences from the geometry
 * step's frames.json are logged.
 */
function computeFrames(inputFrames, features) {
  const set = new Set([YEARS.first, YEARS.cutover]);
  for (const f of features) {
    set.add(f.props.from);
    const next = addYears(f.props.to, 1);
    if (next <= YEARS.present) set.add(next);
  }
  const frames = [...set].filter((y) => y >= YEARS.first && y <= YEARS.present).sort((a, b) => a - b);
  const input = new Set(inputFrames);
  const missing = frames.filter((y) => !input.has(y)).length;
  const unchanged = inputFrames.filter((y) => !set.has(y)).length;
  if (missing) log.warn(`frames.json lacked ${missing} change year(s) present in the records`);
  if (unchanged) log.info(`${unchanged} frame(s) of frames.json show no change after merging identical records; dropped`);
  return { frames, missing, unchanged };
}

// --------------------------------------------------------------------- chunk inputs

/** Source polygons of a record: [{offset, length, part?, keepParts?}] (several for a group of unclaimed pieces). */
const piecesOf = (f) => f.pieces ?? [{ offset: f.offset, length: f.length, part: f.part, keepParts: f.keepParts }];

/** Protection size (lib/topo.mjs) of unclaimed land: larger than any tolerance, i.e. plain LOD tolerance. */
const UNPROTECTED_SIZE_M = 1e9;

/**
 * Writes the chunk's records as the GeoJSON FeatureCollection mapshaper simplifies.
 * Properties: `id` and `sz`, the record's protection size in metres (lib/topo.mjs
 * protectionSizeM). A polity record is written as one feature per polygon part
 * (all with the record's id and size) so that keep-shapes keeps each of its islands
 * and exclaves; lib/topo.mjs finishChunkTopology joins the parts again. Unclaimed
 * land (no identity, often thousands of islets) is one feature with the plain LOD
 * tolerance. Each source line is read and parsed once, however many records or pieces
 * of the chunk it holds. All rings are noded together first (lib/noding.mjs), so
 * neighbours with T-junctions still share arcs. Returns the number of vertices the
 * noding inserted.
 */
function writeChunkInput(path, feats, inputFile) {
  mkdirSync(tmpDir, { recursive: true });
  const byOffset = new Map(); // offset -> { offset, length, refs: [[feature index, piece]] }
  feats.forEach((f, i) => {
    for (const piece of piecesOf(f)) {
      let line = byOffset.get(piece.offset);
      if (!line) byOffset.set(piece.offset, (line = { offset: piece.offset, length: piece.length, refs: [] }));
      line.refs.push([i, piece]);
    }
  });
  const lines = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
  const polygons = feats.map(() => []);
  // read in batches of ≤ 256 MB of source text, sequentially
  for (let k = 0; k < lines.length; ) {
    const batch = [];
    let bytes = 0;
    while (k < lines.length && (batch.length === 0 || bytes + lines[k].length <= 256 * 1024 * 1024)) {
      bytes += lines[k].length;
      batch.push(lines[k++]);
    }
    const bufs = readRanges(inputFile, batch);
    batch.forEach((line, n) => {
      const all = polygonsOf(JSON.parse(bufs[n].toString('utf8')).geometry);
      for (const [i, piece] of line.refs) {
        if (piece.part !== undefined) polygons[i].push(all[piece.part]);
        else for (const j of piece.keepParts ?? all.keys()) polygons[i].push(all[j]); // loop: 10k+ islets
      }
    });
  }
  const cleaned = cleanRings(polygons, SNAP_DEGREES, NODE_DEGREES); // every ring of every record, together
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, '{"type":"FeatureCollection","features":[\n');
    let first = true;
    const write = (properties, geometry) => {
      writeSync(fd, (first ? '' : ',\n') + JSON.stringify({ type: 'Feature', properties, geometry }));
      first = false;
    };
    feats.forEach((f, i) => {
      const p = polygons[i];
      if (!p.length) {
        // nothing but spikes: an empty record collapses like one under the grid (lib/topo.mjs)
        write({ id: f.props.id, sz: UNPROTECTED_SIZE_M }, null);
        return;
      }
      if (f.props.kind === 'unclaimed') {
        write({ id: f.props.id, sz: UNPROTECTED_SIZE_M }, p.length === 1 ? { type: 'Polygon', coordinates: p[0] } : { type: 'MultiPolygon', coordinates: p });
        return;
      }
      const sz = Math.round(protectionSizeM(f.props.a, p.length) * 1000) / 1000;
      for (const rings of p) write({ id: f.props.id, sz }, { type: 'Polygon', coordinates: rings });
    });
    writeSync(fd, '\n]}\n');
  } finally {
    closeSync(fd);
  }
  return cleaned;
}

/** Temp inputs per year range and the build tasks for them. */
function makeChunkInputs(features, frames, inputFile) {
  const inputs = new Map(); // "from..to" -> temp path
  const noded = new Map(); // "from..to" -> cleanRings counts (lib/noding.mjs)
  const key = (r) => `${r.from}..${r.to}`;
  const inRange = (r) => features.filter((f) => f.props.from <= r.to && f.props.to >= r.from);
  return {
    task(range, lod) {
      const feats = inRange(range);
      if (!inputs.has(key(range))) {
        const path = join(tmpDir, `${chunkId(range.from, range.to)}.geojson`);
        noded.set(key(range), writeChunkInput(path, feats, inputFile));
        inputs.set(key(range), path);
      }
      return {
        inputPath: inputs.get(key(range)),
        lod,
        props: feats.map((f) => orderedProps(f.props)),
        bboxes: feats.map((f) => [f.props.id, f.coreBbox ?? f.bbox]),
        frames: frames.filter((y) => y >= range.from && y <= range.to),
        watch: feats.filter((f) => f.props.kind !== 'unclaimed' && (f.props.a < WATCH_AREA_KM2 || MICROSTATE_PIDS.has(f.props.pid))).map((f) => f.props.id),
        microstates: [...MICROSTATE_PIDS],
      };
    },
    /** cleanRings counts of the range's input (undefined before it was written). */
    noded: (range) => noded.get(key(range)),
    drop(range) {
      if (inputs.has(key(range)) && !args['keep-temp']) rmSync(inputs.get(key(range)), { force: true });
      inputs.delete(key(range));
    },
    /** Deletes the temp inputs of measured candidates that did not become chunks. */
    dropOthers(keep) {
      const keys = new Set(keep.map(key));
      for (const k of [...inputs.keys()]) {
        if (keys.has(k)) continue;
        const [from, to] = k.split('..').map(Number);
        this.drop({ from, to });
      }
    },
  };
}

// ---------------------------------------------------------------------- base layers

const BASE_VERSION = 5; // bump when base-layer processing changes (invalidates the cache)

/**
 * Base layers per LOD: Natural Earth 10m land ∪ minor islands dissolved into one
 * feature (the coastline under unclaimed land before the first frame arrives), and
 * lakes. A LOD is used up to the next LOD's minZoom, so it only carries the lakes
 * Natural Earth shows below that zoom (`min_zoom`); the last LOD carries all lakes.
 */
async function buildBase(lod, nextMinZoom) {
  const ne = (name) => join(PATHS.naturalEarth, `${name}.geojson`);
  const key = sha256(JSON.stringify({ v: BASE_VERSION, lod, nextMinZoom, simplify: SIMPLIFY, layers: ['ne_10m_land', 'ne_10m_minor_islands', 'ne_10m_lakes'].map((l) => CONFIG.sources.naturalearth.layers[l]) }));
  const cacheFile = join(tmpDir, 'base', `${lod.id}-${key.slice(0, 16)}.json`);
  if (existsSync(cacheFile)) return { ...readJson(cacheFile), cached: true };
  const land = await simplifyFileToTopology(ne('ne_10m_land'), { layer: 'land', toleranceM: lod.toleranceM, quantization: lod.quantization, idField: null, dissolve: true, extraInputs: [ne('ne_10m_minor_islands')] });
  finishBaseTopology(land, 'land');
  // filter lakes in JS (simple and explicit) before handing them to mapshaper
  const allLakes = readJson(ne('ne_10m_lakes'));
  const keep = allLakes.features.filter((f) => nextMinZoom === undefined || (f.properties.min_zoom ?? 0) < nextMinZoom);
  const lakesInput = join(tmpDir, `lakes-${lod.id}.geojson`);
  writeJson(lakesInput, { type: 'FeatureCollection', features: keep.map((f) => ({ type: 'Feature', properties: { name: f.properties.name ?? null, min_zoom: f.properties.min_zoom ?? null }, geometry: f.geometry })) }, 0);
  const lakes = await simplifyFileToTopology(lakesInput, { layer: 'lakes', toleranceM: lod.toleranceM, quantization: lod.quantization, idField: null });
  rmSync(lakesInput, { force: true });
  const nLakes = finishBaseTopology(lakes, 'lakes');
  const out = { land: JSON.stringify(land), lakes: JSON.stringify(lakes), coastKm: totalArcKm(land), nLakes };
  writeJson(cacheFile, out, 0);
  return out;
}

// ------------------------------------------------------------------- polity index

function buildPolityIndex(inputIndex, features) {
  const index = {};
  for (const [pid, info] of Object.entries(inputIndex ?? {})) if (pid !== 'none') index[pid] = { ...info };
  const byPid = new Map();
  for (const f of features) {
    if (f.props.pid === 'none' || f.props.kind === 'unclaimed') continue;
    if (!byPid.has(f.props.pid)) byPid.set(f.props.pid, []);
    byPid.get(f.props.pid).push(f);
  }
  let added = 0;
  for (const [pid, list] of byPid) {
    list.sort((a, b) => a.props.from - b.props.from);
    const last = list.at(-1).props;
    const e = index[pid] ?? (added++, (index[pid] = {}));
    e.name ??= last.name;
    e.kind ??= last.kind;
    if (!Array.isArray(e.spans) || !e.spans.length) {
      const spans = [];
      for (const f of list) {
        const prev = spans.at(-1);
        if (prev && f.props.from <= addYears(prev[1], 1)) prev[1] = Math.max(prev[1], f.props.to);
        else spans.push([f.props.from, f.props.to]);
      }
      e.spans = spans;
    }
    if (!Array.isArray(e.bbox) || e.bbox.length !== 4) e.bbox = list.reduce((b, f) => unionBbox(b, f.bbox), null).map(round4);
    if (e.power === undefined && last.power !== pid) e.power = last.power;
    if (e.peak === undefined) e.peak = list.reduce((best, f) => (f.props.a > best.props.a ? f : best)).props.from;
    e.src ??= last.src;
    for (const k of ['wikidata', 'wikipedia', 'altNames', 'note']) {
      if (e[k] === undefined) {
        const v = list.findLast((f) => f.extra[k] !== undefined)?.extra[k];
        if (v !== undefined) e[k] = v;
      }
    }
  }
  if (added && Object.keys(inputIndex ?? {}).length) log.warn(`polity index lacked ${added} pid(s) present in the features; added`);
  // stable key order: pids sorted, fields in contract order
  const order = ['name', 'altNames', 'kind', 'spans', 'wikidata', 'wikipedia', 'power', 'bbox', 'peak', 'src', 'note'];
  const out = {};
  for (const pid of Object.keys(index).sort()) {
    const e = index[pid];
    out[pid] = Object.fromEntries([...order.filter((k) => e[k] !== undefined).map((k) => [k, e[k]]), ...Object.keys(e).filter((k) => !order.includes(k)).map((k) => [k, e[k]])]);
  }
  return out;
}

// ---------------------------------------------------------------------------- main

/** Hard checks the geometry step failed (its qa-report.json `checks`), if any. */
function geometryQaFailures() {
  const path = join(inputDir, 'qa-report.json');
  if (!existsSync(path)) return [];
  return (readJson(path).checks ?? []).filter((c) => c.ok === false).map((c) => c.check);
}

async function main() {
  log.info(`packaging ${flavour} dataset from ${rel(inputDir)} into ${rel(outDir)}`);
  // The geometry QA gates fail the build (root AGENTS.md §9): a dataset whose geometry
  // step failed a hard check is never published to packages/borders/data. Packaging it
  // elsewhere (--out, e.g. a staging folder) to inspect it is allowed, with a warning.
  const failedChecks = geometryQaFailures();
  if (failedChecks.length) {
    const msg = `the geometry QA failed (${failedChecks.join(', ')}; see ${rel(join(inputDir, 'qa-summary.md'))})`;
    if (outDir === resolve(PATHS.data) && !args['allow-failed-qa']) {
      fail(`${msg}: not publishing it to ${rel(outDir)} (package it elsewhere with --out=<dir> to inspect it)`);
    }
    log.warn(`${msg}; packaging it into ${rel(outDir)} anyway`);
  }
  const inputFile = join(inputDir, 'features.geojsonl');
  const { features, dedupe, slivers, frames: inputFrames, polities: inputIndex, qa: inputQa } = loadInputs();
  log.info(`scanned ${features.length} records (${features.reduce((s, f) => s + f.vertices, 0).toLocaleString('en')} vertices)`);
  const { frames, missing: framesMissing, unchanged: framesUnchanged } = computeFrames(inputFrames, features);
  const propsById = new Map(features.map((f) => [f.props.id, orderedProps(f.props)]));
  const chunkInputs = makeChunkInputs(features, frames, inputFile);

  const written = new Set(); // output paths relative to outDir
  const writeOut = (relPath, text) => {
    writeFileAtomic(join(outDir, relPath), text);
    written.add(relPath.replaceAll('\\', '/'));
  };

  // 1. base layers -------------------------------------------------------------
  const base = { land: {}, lakes: {} };
  const baseStats = {};
  for (const [k, lod] of LODS.entries()) {
    const b = await buildBase(lod, LODS[k + 1]?.minZoom);
    const land = `base/land-${lod.id}.${hash8(b.land)}.topo.json`;
    const lakes = `base/lakes-${lod.id}.${hash8(b.lakes)}.topo.json`;
    writeOut(land, b.land);
    writeOut(lakes, b.lakes);
    base.land[lod.id] = land;
    base.lakes[lod.id] = lakes;
    baseStats[lod.id] = { landBytes: gzipSize(b.land), lakesBytes: gzipSize(b.lakes), coastKm: Math.round(b.coastKm), lakes: b.nLakes };
    log.info(`base ${lod.id}: land ${fmtBytes(baseStats[lod.id].landBytes)} gz, ${b.nLakes} lakes ${fmtBytes(baseStats[lod.id].lakesBytes)} gz${b.cached ? ' (cached)' : ''}`);
  }

  // 2. plan chunks on the measured l0 size (main thread, sequential) ------------------
  const target = CONFIG.chunks.targetGzipBytesL0;
  log.info(`planning chunks over ${frames.length} frames (l0 target ${fmtBytes(target)} gzip, ≤ ${CONFIG.chunks.maxYears} years, break at ${YEARS.cutover})`);
  const { chunks: plan, measurements } = await planChunks(
    frames,
    features.map((f) => ({ from: f.props.from, to: f.props.to, hash: f.hash, vertices: f.vertices })),
    {
      present: YEARS.present,
      maxYears: CONFIG.chunks.maxYears,
      target,
      breaks: [YEARS.cutover],
      measure: (range) => buildChunkLod(chunkInputs.task(range, L0)),
      log: args.verbose ? (m) => log.info(m) : undefined,
    },
  );
  chunkInputs.dropOthers(plan);
  log.info(`planned ${plan.length} chunks with ${measurements} l0 measurements`);

  // 3. finer LODs in a worker pool ----------------------------------------------------
  const pool = createPool(args.workers ? Number(args.workers) : undefined);
  log.info(`building ${plan.length * (LODS.length - 1)} finer chunk files with ${pool.size} workers`);
  let results;
  try {
    results = await Promise.all(
      plan.map(async (c) => {
        const range = { from: c.from, to: c.to };
        const finer = await Promise.all(
          LODS.slice(1).map((lod) => {
            const task = chunkInputs.task(range, lod);
            return pool.run(task).catch((e) => {
              // e.g. a worker ran out of memory: the main thread has a larger heap
              log.warn(`worker failed on ${chunkId(c.from, c.to)} ${lod.id} (${String(e.message).split('\n')[0]}); retrying in the main thread`);
              return buildChunkLod(task);
            });
          }),
        );
        chunkInputs.drop(range);
        return [c.measured, ...finer];
      }),
    );
  } finally {
    await pool.close();
  }

  // 4. write chunk files ------------------------------------------------------------------
  const chunks = [];
  const verification = [];
  const standIns = [];
  const watched = new Map(); // lod -> rid -> worst entry
  const noding = [];
  for (const [n, c] of plan.entries()) {
    const id = chunkId(c.from, c.to);
    const entry = { id, from: c.from, to: c.to, files: {}, bytes: {}, records: 0 };
    noding.push({ chunk: id, ...(chunkInputs.noded({ from: c.from, to: c.to }) ?? { snapped: 0, inserted: 0, spikes: 0, rings: 0 }) });
    for (const r of results[n]) {
      const path = `chunks/${r.lod}/${id}.${hash8(r.text)}.topo.json`;
      writeOut(path, r.text);
      entry.files[r.lod] = path;
      entry.bytes[r.lod] = r.bytes;
      entry.records = r.records;
      for (const sid of r.standIns) standIns.push({ lod: r.lod, chunk: id, rid: propsById.get(sid).rid, a: propsById.get(sid).a });
      verification.push({ chunk: id, lod: r.lod, ...r.verification, coastKm: baseStats[r.lod].coastKm });
      if (!watched.has(r.lod)) watched.set(r.lod, new Map());
      for (const w of r.watched) watched.get(r.lod).set(w.rid, w);
      log.info(`chunk ${id.padEnd(20)} ${r.lod}: ${String(r.records).padStart(5)} records ${fmtBytes(r.bytes).padStart(10)} gz (${fmtBytes(r.rawBytes)} raw, ${(r.ms / 1000).toFixed(1)} s)${r.standIns.length ? `, ${r.standIns.length} stand-in(s)` : ''}${r.verification.collapsedUnclaimed ? `, ${r.verification.collapsedUnclaimed} collapsed unclaimed left out` : ''}${r.verification.overlapKmMax > 0 ? `, tier-0 overlap ≤ ${Math.round(r.verification.overlapKmMax)} km` : ''}${r.verification.offCoastKmMax > 0 ? `, off-coast exterior ≤ ${Math.round(r.verification.offCoastKmMax)} km` : ''}`);
    }
    chunks.push(entry);
  }
  checkCoverage(chunks, YEARS.first, YEARS.present);

  // small features: decoded area per LOD vs source area
  const smallFeatures = Object.fromEntries(
    LODS.map((l) => {
      const rows = [...(watched.get(l.id)?.values() ?? [])].filter((w) => w.a > 0).map((w) => ({ ...w, errorPct: Math.round(((w.decoded - w.a) / w.a) * 1000) / 10 }));
      rows.sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct));
      const micro = rows.filter((w) => MICROSTATE_PIDS.has(w.rid.split('@')[0]));
      return [l.id, {
        watched: rows.length,
        within1pct: rows.filter((w) => Math.abs(w.errorPct) <= 1).length,
        worst: rows.slice(0, 15),
        microstates: micro.sort((a, b) => a.rid.localeCompare(b.rid)),
      }];
    }),
  );

  // 5. polity index ------------------------------------------------------------------
  const index = buildPolityIndex(inputIndex, features);
  const indexText = JSON.stringify(index);
  const politiesPath = `polities.${hash8(indexText)}.json`;
  writeOut(politiesPath, indexText);

  // 6. manifest + documents -----------------------------------------------------------
  const sources = buildSources({ flavour, version: pkgVersion, withOverrides: flavour === 'final' });
  const bytesByLod = Object.fromEntries(LODS.map((l) => {
    const sizes = chunks.map((c) => c.bytes[l.id]);
    return [l.id, { total: sizes.reduce((s, v) => s + v, 0), max: Math.max(...sizes), min: Math.min(...sizes) }];
  }));
  const manifest = {
    schema: 'alexs-atlas.borders/1',
    dataset: flavour === 'dev' ? 'alexs-atlas-borders-dev' : 'alexs-atlas-borders',
    version: flavour === 'dev' ? `${pkgVersion}-dev` : pkgVersion,
    built: new Date().toISOString(),
    years: { convention: YEARS.convention, from: YEARS.first, to: YEARS.present, present: YEARS.present, cutover: YEARS.cutover },
    lods: LODS.map(({ id, toleranceM, minZoom }) => ({ id, toleranceM, minZoom })),
    chunks,
    frames,
    base,
    polities: politiesPath,
    palette: { size: CONFIG.palette.size },
    sources,
    attribution: buildAttribution(sources),
    stats: {
      records: features.length,
      polities: Object.keys(index).length,
      frames: frames.length,
      chunks: chunks.length,
      gzipBytes: bytesByLod,
      baseGzipBytes: Object.fromEntries(LODS.map((l) => [l.id, { land: baseStats[l.id].landBytes, lakes: baseStats[l.id].lakesBytes }])),
      simplify: {
        method: 'douglas-peucker, spherical, keep-shapes (every polygon part of a polity is protected)',
        interval: intervalExpression('<toleranceM>', SIMPLIFY, 'size'),
        size: 'sqrt(a / parts) / smallFeatureK metres (parts counted under archipelagoMaxAreaKm2); unclaimed land: the plain tolerance',
        ...SIMPLIFY,
      },
      standIns: standIns.length,
    },
  };
  writeOut('sources.json', JSON.stringify(buildSourcesJson(sources), null, 1) + '\n');
  writeOut('ATTRIBUTION.md', attributionMarkdown(manifest));
  writeOut('LICENSE.md', licenseMarkdown(manifest));
  const overBudget = plan.filter((c) => c.overBudget).map((c) => chunkId(c.from, c.to));
  const qa = {
    ...inputQa,
    packaging: {
      dataset: manifest.dataset,
      built: manifest.built,
      gzipLevel: GZIP_LEVEL,
      records: { ...dedupe, note: 'inputRecords lines in features.geojsonl; unclaimed land split into one record per piece (afterSplit); records identical to a touching neighbour year merged (merged)' },
      noding: {
        note: `Per chunk, before mapshaper (lib/noding.mjs cleanRings): vertices merged into one within ${SNAP_DEGREES}° (snapped), vertices inserted into another ring's segment within ${NODE_DEGREES}° (inserted: T-junctions, zigzag borders), vertices removed as repeats or zero-width spikes (spikes), rings that degenerated (rings), so that neighbours share arcs.`,
        snapDegrees: SNAP_DEGREES,
        nodeDegrees: NODE_DEGREES,
        snapped: noding.reduce((s, c) => s + c.snapped, 0),
        inserted: noding.reduce((s, c) => s + c.inserted, 0),
        spikes: noding.reduce((s, c) => s + c.spikes, 0),
        rings: noding.reduce((s, c) => s + c.rings, 0),
        chunks: noding,
      },
      slivers: {
        note: `Polygon parts under ${SLIVER_KM2 * 1e6} m² or with a mean width (2 x area / perimeter) under ${SLIVER_WIDTH_M} m (zero-area spikes, hair-thin slivers and gaps from overlay operations) left out of the input records; 'dropped' records had no other parts.`,
        parts: slivers.parts,
        km2: slivers.km2,
        records: slivers.records.length,
        sample: slivers.records.slice(0, 20),
        dropped: slivers.dropped,
      },
      frames: { count: frames.length, missingFromInput: framesMissing, droppedWithoutChange: framesUnchanged },
      targetGzipBytesL0: target,
      overBudget,
      bytesByLod,
      base: baseStats,
      chunks: chunks.map((c) => ({ id: c.id, from: c.from, to: c.to, records: c.records, bytes: c.bytes })),
      standIns,
      smallFeatures: {
        note: `Records under ${WATCH_AREA_KM2} km² and the config microstates: area decoded from each LOD vs the record's area (a). Quantization and keep-shapes dominate below ~1 km².`,
        ...smallFeatures,
      },
      alignment: {
        note: 'Per chunk and LOD over its frames (tier 0; a feature using an arc in both directions is an internal edge and cancels): overlapKmMax = length of arcs used twice in the same direction or by more than two features (0 for a partition); exteriorKm = length of arcs used once; offCoastKmMax = length of once-used arcs with a vertex farther than offCoastThresholdKm (quantization + snapping) from the unsimplified Natural Earth coastline, i.e. gaps or slivers between neighbours (0 for an exact partition of the land: simplification keeps only original vertices); coastKm = coastline length of base/land at that LOD. mergedArcs = arcs that simplification made identical copies of another (a collapsed sliver between neighbours) and that were merged back into one shared arc; isletsDropped/isletsKm2 = islands of large polities under the LOD threshold (lib/topo.mjs islandMinAreaKm2) left out. collapsedUnclaimed = unclaimed records that collapsed completely on the LOD grid and are left out of that file (no stand-in).',
        chunks: verification,
      },
    },
  };
  writeOut('qa-report.json', JSON.stringify(qa, null, 1) + '\n');
  // manifest last: readers switch to the new files atomically
  writeOut('manifest.json', JSON.stringify(manifest, null, 1) + '\n');

  // 7. validate the output + remove stale hashed files ----------------------------------
  validateOutput(manifest, new Map(verification.map((v) => [`${v.chunk} ${v.lod}`, v.collapsedUnclaimed ?? 0])));
  const removed = removeStale(written);
  for (const l of LODS) {
    const s = smallFeatures[l.id];
    log.info(`${l.id}: ${chunks.length} chunks, ${fmtBytes(bytesByLod[l.id].total)} gzip total, largest ${fmtBytes(bytesByLod[l.id].max)}; small features within 1 % area: ${s.within1pct}/${s.watched}`);
  }
  if (overBudget.length) log.warn(`l0 over budget (single frame, cannot split): ${overBudget.join(', ')}`);
  if (standIns.length) log.info(`${standIns.length} collapsed feature(s) replaced by grid stand-ins (see qa-report.json → packaging.standIns)`);
  const offCoast = verification.filter((v) => v.offCoastKmMax > 0);
  if (offCoast.length) log.warn(`${offCoast.length} chunk file(s) have exterior arcs off the Natural Earth coastline (gaps/slivers or boundaries in the sea; see qa-report.json → packaging.alignment)${flavour === 'dev' ? ' — expected for the unclipped dev features' : ''}`);
  else log.info('alignment: every exterior arc of every frame lies on the Natural Earth coastline');
  const overlapping = verification.filter((v) => v.overlapKmMax > 0);
  if (overlapping.length) log.warn(`${overlapping.length} chunk file(s) have overlapping tier-0 records (see qa-report.json → packaging.alignment)${flavour === 'dev' ? ' — expected for the unclipped dev features' : ''}`);
  log.info(`done: ${chunks.length} chunks, ${Object.keys(index).length} polities, removed ${removed} stale file(s), ${log.elapsed().toFixed(1)} s`);
}

function removeStale(written) {
  let n = 0;
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        walk(p);
        if (!readdirSync(p).length) rmSync(p, { recursive: true });
        continue;
      }
      const r = relative(outDir, p).replaceAll('\\', '/');
      const hashed = /\.[0-9a-f]{8}\.(topo\.)?json$/.test(name);
      if ((hashed || name.includes('.tmp-')) && !written.has(r)) {
        rmSync(p);
        n++;
      }
    }
  };
  walk(join(outDir, 'chunks'));
  walk(join(outDir, 'base'));
  for (const name of readdirSync(outDir)) {
    if (/^polities\.[0-9a-f]{8}\.json$/.test(name) && !written.has(name)) {
      rmSync(join(outDir, name));
      n++;
    }
  }
  return n;
}

/** Contract checks on what was written (root AGENTS.md §5.2). Exits on failure. */
/** `collapsed`: "<chunk id> <lod>" -> unclaimed records that collapsed on that file's grid and were left out of it. */
function validateOutput(manifest, collapsed = new Map()) {
  const problems = [];
  const files = [manifest.polities, ...Object.values(manifest.base.land), ...Object.values(manifest.base.lakes ?? {})];
  for (const c of manifest.chunks) {
    for (const l of manifest.lods) {
      if (!c.files[l.id]) problems.push(`chunk ${c.id} has no ${l.id} file`);
      if (!(c.bytes[l.id] > 0)) problems.push(`chunk ${c.id} has no ${l.id} size`);
    }
    files.push(...Object.values(c.files));
  }
  for (const f of files) {
    if (!/^[a-z0-9._/-]+$/.test(f)) problems.push(`file name not [a-z0-9._-]: ${f}`);
    if (!existsSync(join(outDir, f))) problems.push(`missing file ${f}`);
  }
  // each year maps to exactly one chunk
  try {
    checkCoverage(manifest.chunks, manifest.years.from, manifest.years.to);
  } catch (e) {
    problems.push(e.message);
  }
  // frames sorted, unique, start at the first year
  if (manifest.frames[0] !== manifest.years.from) problems.push('frames[0] is not the first year');
  for (let i = 1; i < manifest.frames.length; i++) if (manifest.frames[i] <= manifest.frames[i - 1]) problems.push(`frames not strictly increasing at ${i}`);
  // every chunk starts at a frame
  const fs = new Set(manifest.frames);
  for (const c of manifest.chunks) if (!fs.has(c.from)) problems.push(`chunk ${c.id} does not start at a frame`);
  // a chunk file's records really overlap its years; ids unique per chunk; one rid per id
  const idRid = new Map();
  for (const c of manifest.chunks) {
    for (const l of manifest.lods) {
      const t = JSON.parse(readFileSync(join(outDir, c.files[l.id]), 'utf8'));
      const seen = new Set();
      for (const g of t.objects.polities.geometries) {
        const p = g.properties;
        if (!g.type) problems.push(`chunk ${c.id} ${l.id}: empty geometry for ${p.rid}`);
        if (p.from > c.to || p.to < c.from) problems.push(`chunk ${c.id}: record ${p.rid} (${p.from}..${p.to}) does not overlap the chunk`);
        if (g.id !== p.id) problems.push(`chunk ${c.id}: Feature.id ${g.id} != properties.id ${p.id}`);
        if (seen.has(p.id)) problems.push(`chunk ${c.id} ${l.id}: duplicate id ${p.id}`);
        seen.add(p.id);
        const prev = idRid.get(p.id);
        if (prev && prev !== p.rid) problems.push(`id ${p.id} used by ${prev} and ${p.rid}`);
        idRid.set(p.id, p.rid);
      }
      const expected = c.records - (collapsed.get(`${c.id} ${l.id}`) ?? 0);
      if (seen.size !== expected) problems.push(`chunk ${c.id} ${l.id}: ${seen.size} records, manifest says ${c.records} (${c.records - expected} collapsed unclaimed)`);
    }
  }
  if (problems.length) {
    for (const p of problems.slice(0, 50)) log.error(p);
    fail(`${problems.length} output problem(s)`);
  }
  log.info(`output valid: ${manifest.chunks.length} chunks cover ${manifest.years.from}..${manifest.years.to}, ${files.length} files present`);
}

main().catch((e) => {
  log.error(e.stack ?? String(e));
  process.exit(1);
});
