// Time-chunk planning: greedy over frames, chunk boundaries at frame starts,
// sized by the real gzip size of the l0 TopoJSON (measured through a callback).
import { addYears, spanYears } from './context.mjs';

/** Last year of frame i (frames[i] … frames[i+1]−1, skipping year 0; the last frame ends at `present`). */
export const frameEnd = (frames, i, present) => (i + 1 < frames.length ? addYears(frames[i + 1], -1) : present);

/** Features whose [from, to] overlaps [from, to]. */
export const overlapping = (features, from, to) => features.filter((f) => f.from <= to && f.to >= from);

/**
 * Cost proxy for chunks starting at frame i: for every j ≥ i, the vertex count of
 * the distinct geometries alive in frames i..j. Identical geometries (a polity
 * unchanged across records) share arcs in TopoJSON, so they are counted once.
 * `features` must be sorted by `from`.
 */
export function costsFrom(frames, features, i, present) {
  const start = frames[i];
  const cand = features.filter((f) => f.to >= start);
  const seen = new Set();
  const out = new Array(frames.length).fill(0);
  let total = 0;
  let k = 0;
  for (let j = i; j < frames.length; j++) {
    const end = frameEnd(frames, j, present);
    while (k < cand.length && cand[k].from <= end) {
      const f = cand[k++];
      if (!seen.has(f.hash)) {
        seen.add(f.hash);
        total += f.vertices;
      }
    }
    out[j] = total;
  }
  return out;
}

/**
 * Plans chunks. `measure({from, to})` builds the chunk's l0 TopoJSON and resolves to
 * { bytes, ... } (gzip size); its result is kept on the chunk (`measured`) so the
 * caller can reuse it. A chunk never spans more than `maxYears` and never crosses
 * a year in `breaks` (e.g. the 1946 cut-over between the two layers). A one-frame
 * chunk is accepted even when it is over budget (reported as `overBudget`).
 *
 * @param {number[]} frames sorted change years (frames[0] = first year)
 * @param {{from:number,to:number,hash:string,vertices:number}[]} features sorted by from
 * @param {{present:number, maxYears:number, target:number, breaks?:Iterable<number>, measure:Function, log?:Function}} opts
 */
export async function planChunks(frames, features, opts) {
  const { present, maxYears, target, measure } = opts;
  const breaks = new Set(opts.breaks ?? []);
  const log = opts.log ?? (() => {});
  const chunks = [];
  let ratio = null; // gzip bytes per cost unit, learned from measurements
  let measurements = 0;
  let i = 0;
  while (i < frames.length) {
    const costs = costsFrom(frames, features, i, present);
    // furthest frame allowed by maxYears and the forced breaks
    let jMax = i;
    while (jMax + 1 < frames.length && !breaks.has(frames[jMax + 1]) && spanYears(frames[i], frameEnd(frames, jMax + 1, present)) <= maxYears) jMax++;
    const lastWithin = (limit) => {
      let j = i;
      while (j + 1 <= jMax && costs[j + 1] <= limit) j++;
      return j;
    };
    let j = ratio === null ? jMax : lastWithin((target * 0.92) / ratio);
    let best = null; // largest measured candidate within budget
    let tried = new Set();
    for (;;) {
      tried.add(j);
      const range = { from: frames[i], to: frameEnd(frames, j, present) };
      const m = await measure(range);
      measurements++;
      if (costs[j] > 0) ratio = m.bytes / costs[j];
      log(`  candidate ${range.from}..${range.to}: ${m.bytes} B gzip (frames ${j - i + 1}, cost ${costs[j]})`);
      if (m.bytes <= target) {
        best = { j, m };
        // well under budget and room to grow: try a bigger chunk once more
        if (m.bytes < target * 0.75 && j < jMax && ratio) {
          const grown = lastWithin((target * 0.92) / ratio);
          if (grown > j && !tried.has(grown)) {
            j = grown;
            continue;
          }
        }
        break;
      }
      if (best && best.j < j) break; // the grown candidate was too big: keep the previous one
      if (j === i) {
        best = { j, m, overBudget: true };
        break;
      }
      const shrunk = Math.min(j - 1, lastWithin((costs[j] * (target / m.bytes)) * 0.9));
      j = tried.has(shrunk) ? Math.max(i, shrunk - 1) : shrunk;
    }
    chunks.push({ from: frames[i], to: frameEnd(frames, best.j, present), frameFrom: i, frameTo: best.j, measured: best.m, overBudget: !!best.overBudget });
    i = best.j + 1;
  }
  return { chunks, measurements };
}

/** Throws unless every year first..present (no year 0) maps to exactly one chunk. */
export function checkCoverage(chunks, first, present) {
  const sorted = [...chunks].sort((a, b) => a.from - b.from);
  if (!sorted.length) throw new Error('no chunks');
  if (sorted[0].from !== first) throw new Error(`first chunk starts at ${sorted[0].from}, not ${first}`);
  for (let k = 0; k < sorted.length; k++) {
    const c = sorted[k];
    if (c.from > c.to) throw new Error(`chunk ${c.id ?? k} runs backwards (${c.from}..${c.to})`);
    if (c.from === 0 || c.to === 0) throw new Error(`chunk ${c.id ?? k} uses year 0`);
    if (k > 0 && c.from !== addYears(sorted[k - 1].to, 1)) throw new Error(`gap or overlap between chunks ending ${sorted[k - 1].to} and starting ${c.from}`);
  }
  if (sorted.at(-1).to !== present) throw new Error(`last chunk ends at ${sorted.at(-1).to}, not ${present}`);
}

/** Readable chunk id from its years, e.g. "3400bce-2501bce", "1700-1745". */
export function chunkId(from, to) {
  const f = (y) => (y < 0 ? `${-y}bce` : `${y}`);
  return `${f(from)}-${f(to)}`;
}
