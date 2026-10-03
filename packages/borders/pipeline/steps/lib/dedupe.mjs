// Lossless record de-duplication before chunking.
//
// The geometry step writes one `unclaimed` feature per frame (all land no polity
// holds that year). Consecutive frames repeat most of it (Antarctica, remote islands,
// unclaimed interiors), and a polity may be written as several consecutive records
// with identical geometry and attributes. Both inflate the chunks and blur the
// chunk planner's size estimate. Here:
//   1. unclaimed features are split into their polygons (unclaimed land has no
//      identity, label or selection, so one feature per piece draws identically);
//   2. records with the same pid, attributes and geometry whose year ranges touch
//      are merged into one record (the first keeps its id and rid);
//   3. unclaimed pieces alive in exactly the same years are regrouped into one
//      MultiPolygon record (thousands of unclaimed islets would otherwise each carry
//      a full property set).
// Every year still shows exactly the same areas with the same properties.
import { addYears } from './context.mjs';

const MERGE_KEYS = ['pid', 'name', 'kind', 'tier', 'power', 'partof', 'subjecto', 'disputed', 'precision', 'c', 'src'];

/** Merges contiguous identical records. `entries` are scan entries ({props, extra, hash, ...}). */
export function mergeContiguous(entries) {
  const groups = new Map();
  for (const e of entries) {
    const key = JSON.stringify([...MERGE_KEYS.map((k) => e.props[k]), e.hash, e.extra ?? {}]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  const out = [];
  let merged = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a.props.from - b.props.from);
    let cur = null;
    for (const e of list) {
      if (cur && e.props.from <= addYears(cur.props.to, 1) && e.props.to >= cur.props.from) {
        cur.props.to = Math.max(cur.props.to, e.props.to);
        merged++;
      } else {
        cur = { ...e, props: { ...e.props } };
        out.push(cur);
      }
    }
  }
  return { entries: out, merged };
}

/**
 * Splits an unclaimed feature into one entry per polygon. `geometry` is the parsed
 * geometry; `measure(polygonGeometry)` returns {bbox, vertices, hash, a, lx, ly};
 * `keep` optionally lists the polygon indices to keep (slivers left out). `part` is
 * the polygon's index in the source MultiPolygon (undefined for a Polygon).
 */
export function splitUnclaimed(entry, geometry, measure, keep = null) {
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  const indices = keep ?? polys.map((_, i) => i);
  return indices.map((part) => {
    const m = measure({ type: 'Polygon', coordinates: polys[part] });
    const { keepParts: _unused, ...rest } = entry; // a piece is one whole polygon
    return {
      ...rest,
      part: geometry.type === 'MultiPolygon' ? part : undefined,
      bbox: m.bbox,
      coreBbox: m.bbox,
      vertices: m.vertices,
      hash: m.hash,
      props: { ...entry.props, a: m.a, lx: m.lx, ly: m.ly },
    };
  });
}

/**
 * Regroups unclaimed pieces (after mergeContiguous) that are alive in exactly the same
 * years, with the same attributes, into one MultiPolygon record. Splitting and merging
 * gave every piece its true lifetime; grouping by lifetime then turns thousands of
 * small unclaimed islands into a few records without repeating any of them in a year
 * where it is not unclaimed. A group lists its source polygons in `pieces`
 * ([{offset, length, part}]); `a` is the sum of the pieces, `lx/ly` and `coreBbox`
 * those of the largest piece; the first piece (by id, part) gives id and rid.
 */
export function groupUnclaimed(entries) {
  const out = [];
  const groups = new Map();
  for (const e of entries) {
    if (e.props.kind !== 'unclaimed') {
      out.push(e);
      continue;
    }
    const key = JSON.stringify([...MERGE_KEYS.map((k) => e.props[k]), e.props.from, e.props.to]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  let grouped = 0;
  for (const list of groups.values()) {
    list.sort((a, b) => a.props.id - b.props.id || (a.part ?? -1) - (b.part ?? -1));
    if (list.length === 1) {
      out.push(list[0]);
      continue;
    }
    grouped += list.length - 1;
    const largest = list.reduce((best, e) => (e.props.a > best.props.a ? e : best));
    const area = list.reduce((s, e) => s + e.props.a, 0);
    const first = list[0];
    out.push({
      ...first,
      part: undefined,
      keepParts: undefined,
      pieces: list.map((e) => ({ offset: e.offset, length: e.length, part: e.part })),
      bbox: list.reduce((b, e) => [Math.min(b[0], e.bbox[0]), Math.min(b[1], e.bbox[1]), Math.max(b[2], e.bbox[2]), Math.max(b[3], e.bbox[3])], [Infinity, Infinity, -Infinity, -Infinity]),
      coreBbox: largest.coreBbox ?? largest.bbox,
      vertices: list.reduce((s, e) => s + e.vertices, 0),
      hash: list.map((e) => e.hash).sort().join(','),
      props: { ...first.props, a: area >= 100 ? Math.round(area) : Math.round(area * 100) / 100, lx: largest.props.lx, ly: largest.props.ly },
    });
  }
  return { entries: out, grouped };
}

/**
 * Gives split/merged records unique ids and rids (deterministic order): the first
 * entry keeps an id, later duplicates (pieces of one unclaimed feature) get new ids
 * after the largest; rids get '#n' suffixes until unique (`none@1700#2`, …).
 */
export function renumber(entries) {
  entries.sort((a, b) => a.props.from - b.props.from || (a.props.id ?? 0) - (b.props.id ?? 0) || (a.part ?? -1) - (b.part ?? -1));
  let next = entries.reduce((m, e) => Math.max(m, e.props.id ?? 0), 0) + 1;
  const usedIds = new Set();
  for (const e of entries) {
    if (e.props.id === null || usedIds.has(e.props.id)) e.props.id = next++;
    usedIds.add(e.props.id);
  }
  const seen = new Set();
  for (const e of entries) {
    const base = e.props.rid;
    let rid = base;
    for (let k = 2; seen.has(rid); k++) rid = `${base.replace(/#\d+$/, '')}#${k}`;
    e.props.rid = rid;
    seen.add(rid);
  }
  return entries;
}
