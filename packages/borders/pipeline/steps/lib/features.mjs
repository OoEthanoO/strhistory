// Reading the geometry step's features.geojsonl without holding it in memory:
// one scan records each feature's normalised properties (AGENTS.md §5.2
// PolityProps), byte range, bbox, vertex count and geometry hash; geometry is
// re-read by byte range when a chunk is assembled.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { CONFIG, YEARS, fnv1a } from './context.mjs';
import { geometryAreaKm2, labelPoint, bboxOf, vertexCount, roundArea, round4, polygonsOf, polygonAreaM2, polygonPerimeterM } from './geo.mjs';
import { splitUnclaimed as splitUnclaimedEntry } from './dedupe.mjs';

export const KINDS = ['state', 'dependency', 'indigenous', 'disputed', 'other', 'unclaimed'];
/** Chunk feature properties, in contract order (root AGENTS.md §5.2). */
export const PROP_KEYS = ['id', 'rid', 'pid', 'name', 'from', 'to', 'kind', 'tier', 'power', 'partof', 'subjecto', 'disputed', 'precision', 'c', 'a', 'lx', 'ly', 'src'];
/** Extra record fields that belong in the polity index, not in chunks. */
export const INDEX_KEYS = ['wikidata', 'wikipedia', 'altNames', 'note'];

/** Calls `onLine(buffer, offset, length)` for every non-empty line of a file. */
export function forEachLine(file, onLine, blockSize = 64 * 1024 * 1024) {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    let carryOffset = 0;
    let pos = 0;
    while (pos < size) {
      const block = Buffer.alloc(Math.min(blockSize, size - pos));
      const n = readSync(fd, block, 0, block.length, pos);
      pos += n;
      const buf = carry.length ? Buffer.concat([carry, block.subarray(0, n)]) : block.subarray(0, n);
      const base = carry.length ? carryOffset : pos - n;
      let start = 0;
      for (let i = buf.indexOf(10); i !== -1; i = buf.indexOf(10, start)) {
        let end = i;
        if (end > start && buf[end - 1] === 13) end--; // tolerate CRLF
        if (end > start) onLine(buf.subarray(start, end), base + start, end - start);
        start = i + 1;
      }
      carry = Buffer.from(buf.subarray(start));
      carryOffset = base + start;
    }
    if (carry.length) {
      let end = carry.length;
      if (carry[end - 1] === 13) end--;
      if (end > 0) onLine(carry.subarray(0, end), carryOffset, end);
    }
  } finally {
    closeSync(fd);
  }
}

/** Reads the byte ranges [{offset, length}] of a file (sorted access is fastest). */
export function readRanges(file, ranges) {
  const fd = openSync(file, 'r');
  try {
    return ranges.map(({ offset, length }) => {
      const buf = Buffer.alloc(length);
      let done = 0;
      while (done < length) done += readSync(fd, buf, done, length - done, offset + done);
      return buf;
    });
  } finally {
    closeSync(fd);
  }
}

const isYear = (y) => Number.isInteger(y) && y !== 0;

/**
 * Normalises one feature's properties to PolityProps, filling what the geometry
 * step may leave out (c, a, lx/ly, defaults) and collecting contract violations.
 */
export function normaliseProps(feature, errors) {
  const p = feature.properties ?? {};
  const where = `feature ${p.rid ?? p.pid ?? feature.id ?? '?'}`;
  const props = {};
  props.id = Number.isInteger(p.id) && p.id > 0 ? p.id : Number.isInteger(feature.id) && feature.id > 0 ? feature.id : null;
  props.pid = typeof p.pid === 'string' && p.pid ? p.pid : null;
  if (!props.pid) errors.push(`${where}: missing pid`);
  props.from = p.from;
  props.to = p.to;
  if (!isYear(p.from) || !isYear(p.to) || p.from > p.to) errors.push(`${where}: bad years ${p.from}..${p.to}`);
  else if (p.from < YEARS.first || p.to > YEARS.present) errors.push(`${where}: years ${p.from}..${p.to} outside ${YEARS.first}..${YEARS.present}`);
  props.rid = typeof p.rid === 'string' && p.rid ? p.rid : `${props.pid}@${props.from}`;
  props.kind = KINDS.includes(p.kind) ? p.kind : (errors.push(`${where}: bad kind ${p.kind}`), 'other');
  props.name = typeof p.name === 'string' ? p.name : props.kind === 'unclaimed' ? '' : (errors.push(`${where}: missing name`), '');
  props.tier = p.tier === 1 ? 1 : 0;
  props.power = typeof p.power === 'string' && p.power ? p.power : props.pid;
  props.partof = typeof p.partof === 'string' && p.partof ? p.partof : null;
  props.subjecto = typeof p.subjecto === 'string' && p.subjecto ? p.subjecto : null;
  props.disputed = p.disputed === true || props.kind === 'disputed';
  props.precision = p.precision === 'approximate' ? 'approximate' : 'exact';
  props.c = Number.isInteger(p.c) && p.c >= 0 && p.c < CONFIG.palette.size ? p.c : fnv1a(props.power) % CONFIG.palette.size;
  props.a = typeof p.a === 'number' && p.a >= 0 ? p.a : roundArea(geometryAreaKm2(feature.geometry));
  if (typeof p.lx === 'number' && typeof p.ly === 'number') {
    props.lx = p.lx;
    props.ly = p.ly;
  } else {
    const lp = labelPoint(feature.geometry) ?? [0, 0];
    props.lx = round4(lp[0]);
    props.ly = round4(lp[1]);
  }
  props.src = typeof p.src === 'string' && p.src ? p.src : (errors.push(`${where}: missing src`), 'other');
  const extra = {};
  for (const k of INDEX_KEYS) if (p[k] !== undefined && p[k] !== null && p[k] !== '') extra[k] = p[k];
  return { props, extra };
}

const geometryHash = (g) => createHash('sha1').update(JSON.stringify(g.coordinates)).digest('base64');

/**
 * Polygon parts smaller than SLIVER_KM2 (100 m²) or thinner than SLIVER_WIDTH_M (mean
 * width 2 × area / perimeter) are not land: they are zero-area spikes, hair-thin
 * slivers and gaps left by overlay operations on near-coincident borders (collinear
 * "triangles" a few m² in size; unclaimed strips a few centimetres wide and tens of
 * kilometres long; sawtooth triangles under a metre wide along a neighbour's border).
 * They are dropped on input and reported (qa-report packaging.slivers). Kept, they
 * collapse on import or simplification, and their neighbours' borders, which run
 * within SLIVER_WIDTH_M of each other once they are gone, would not share arcs; the
 * noding (lib/noding.mjs, SNAP_DEGREES ≥ SLIVER_WIDTH_M) joins those borders instead.
 */
export const SLIVER_KM2 = 1e-4;
export const SLIVER_WIDTH_M = 2;

/** Is this polygon (rings) a sliver part (see SLIVER_KM2)? */
export function isSliverPart(rings) {
  const a = polygonAreaM2(rings);
  if (a / 1e6 < SLIVER_KM2) return true;
  const perimeter = polygonPerimeterM(rings);
  return perimeter > 0 && (2 * a) / perimeter < SLIVER_WIDTH_M;
}

/** Per-polygon measures for split unclaimed land (see lib/dedupe.mjs). */
function measurePart(g) {
  const lp = labelPoint(g) ?? [0, 0];
  return { bbox: bboxOf(g), vertices: vertexCount(g), hash: geometryHash(g), a: roundArea(geometryAreaKm2(g)), lx: round4(lp[0]), ly: round4(lp[1]) };
}

/**
 * Indices of the polygon parts of `g` that are not slivers (isSliverPart), and the
 * bbox of the largest part (where a collapsed feature's stand-in goes, lib/topo.mjs).
 */
function partsToKeep(g) {
  const keep = [];
  let largest = null;
  let largestArea = -1;
  polygonsOf(g).forEach((rings, i) => {
    const a = polygonAreaM2(rings);
    if (!isSliverPart(rings)) keep.push(i);
    if (a > largestArea) {
      largestArea = a;
      largest = rings;
    }
  });
  return { keep, coreBbox: largest ? bboxOf({ type: 'Polygon', coordinates: largest }) : null };
}

/** `g` restricted to the polygon parts `keep` (indices into polygonsOf(g)). */
export function keepParts(g, keep) {
  const polys = polygonsOf(g);
  if (!keep || keep.length === polys.length) return g;
  return keep.length === 1 ? { type: 'Polygon', coordinates: polys[keep[0]] } : { type: 'MultiPolygon', coordinates: keep.map((i) => polys[i]) };
}

/**
 * Scans features.geojsonl. Returns { features, errors, slivers } where each feature
 * is { props, extra, offset, length, bbox, vertices, hash, part?, keepParts? }. With
 * `splitUnclaimed`, every unclaimed feature becomes one entry per polygon (`part` =
 * index into its MultiPolygon); ids of such pieces are fixed later (dedupe.renumber).
 * Sliver parts (< SLIVER_KM2) are left out: `keepParts` lists the kept part indices of
 * a MultiPolygon that lost some; a record that is nothing but slivers is dropped.
 * `slivers` = { parts, km2, records: [rid of each record that lost parts], dropped: [rid] }.
 */
export function scanFeatures(file, { splitUnclaimed = false } = {}) {
  const features = [];
  const errors = [];
  const slivers = { parts: 0, km2: 0, records: [], dropped: [] };
  forEachLine(file, (buf, offset, length) => {
    let f;
    try {
      f = JSON.parse(buf.toString('utf8'));
    } catch (e) {
      errors.push(`line at byte ${offset}: invalid JSON (${e.message})`);
      return;
    }
    const source = f.geometry;
    if (!source || (source.type !== 'Polygon' && source.type !== 'MultiPolygon')) {
      errors.push(`feature ${f.properties?.rid ?? offset}: geometry is ${source?.type ?? 'null'}, expected Polygon/MultiPolygon`);
      return;
    }
    if (!vertexCount(source)) {
      errors.push(`feature ${f.properties?.rid ?? offset}: empty geometry`);
      return;
    }
    const { keep, coreBbox } = partsToKeep(source);
    const total = polygonsOf(source).length;
    const rid = f.properties?.rid ?? `${f.properties?.pid}@${f.properties?.from}`;
    if (keep.length < total) {
      slivers.parts += total - keep.length;
      slivers.km2 += geometryAreaKm2(source) - geometryAreaKm2(keepParts(source, keep));
      slivers.records.push(rid);
      if (!keep.length) {
        slivers.dropped.push(rid);
        return;
      }
    }
    // properties (a, lx, ly when missing) are measured on the kept parts
    const g = keepParts(source, keep);
    const { props, extra } = normaliseProps({ ...f, geometry: g }, errors);
    const entry = { props, extra, offset, length, bbox: bboxOf(g), coreBbox, vertices: vertexCount(g), hash: null };
    if (keep.length < total && source.type === 'MultiPolygon') entry.keepParts = keep;
    if (splitUnclaimed && props.kind === 'unclaimed') {
      for (const piece of splitUnclaimedEntry(entry, source, measurePart, keep)) features.push(piece); // can be 10k+ islets
      return;
    }
    entry.hash = geometryHash(g);
    features.push(entry);
  });
  slivers.km2 = Math.round(slivers.km2 * 1e6) / 1e6;
  if (!splitUnclaimed) errors.push(...finaliseIds(features));
  return { features, errors, slivers };
}

/**
 * Keeps the geometry step's ids, assigns ids after the largest one where missing,
 * and reports duplicate ids and rids (errors as strings).
 */
export function finaliseIds(features) {
  const errors = [];
  let next = features.reduce((m, f) => Math.max(m, f.props.id ?? 0), 0) + 1;
  const seen = new Map();
  for (const f of features) {
    if (f.props.id === null) f.props.id = next++;
    if (seen.has(f.props.id)) errors.push(`duplicate id ${f.props.id} (${seen.get(f.props.id)} and ${f.props.rid})`);
    seen.set(f.props.id, f.props.rid);
  }
  const rids = new Set();
  for (const f of features) {
    if (rids.has(f.props.rid)) errors.push(`duplicate rid ${f.props.rid}`);
    rids.add(f.props.rid);
  }
  return errors;
}

/** Contract-ordered PolityProps object. */
export const orderedProps = (props) => Object.fromEntries(PROP_KEYS.map((k) => [k, props[k]]));
