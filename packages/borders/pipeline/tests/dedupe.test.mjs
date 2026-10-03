// lib/dedupe.mjs: unclaimed land split into pieces, identical neighbour years merged.
import { describe, expect, it } from 'vitest';
import { mergeContiguous, splitUnclaimed, renumber } from '../steps/lib/dedupe.mjs';

const base = { pid: 'clio:x', name: 'X', kind: 'state', tier: 0, power: 'clio:x', partof: null, subjecto: null, disputed: false, precision: 'exact', c: 1, a: 10, lx: 0, ly: 0, src: 'cliopatria' };
const entry = (props, hash, extra = {}) => ({ props: { ...base, ...props }, extra, hash, offset: props.id * 100, length: 50, vertices: 10, bbox: [0, 0, 1, 1] });

describe('mergeContiguous', () => {
  it('merges touching records with the same pid, attributes and geometry (also across year 0)', () => {
    const { entries, merged } = mergeContiguous([
      entry({ id: 1, rid: 'clio:x@-10', from: -10, to: -1 }, 'g'),
      entry({ id: 2, rid: 'clio:x@1', from: 1, to: 5 }, 'g'),
      entry({ id: 3, rid: 'clio:x@6', from: 6, to: 9 }, 'g2'), // geometry changed
      entry({ id: 4, rid: 'clio:x@10', from: 10, to: 12 }, 'g2', { wikidata: 'Q1' }), // attribute changed
      entry({ id: 5, rid: 'clio:x@20', from: 20, to: 30 }, 'g2'), // not touching id 3
    ]);
    expect(merged).toBe(1);
    const byId = Object.fromEntries(entries.map((e) => [e.props.id, [e.props.from, e.props.to]]));
    expect(byId).toEqual({ 1: [-10, 5], 3: [6, 9], 4: [10, 12], 5: [20, 30] });
  });
});

describe('splitUnclaimed + renumber', () => {
  it('splits a MultiPolygon into pieces with unique ids and rids', () => {
    const g = { type: 'MultiPolygon', coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]] };
    const e = entry({ id: 7, rid: 'none@1700', pid: 'none', name: '', kind: 'unclaimed', from: 1700, to: 1710 }, null);
    let n = 0;
    const parts = splitUnclaimed(e, g, () => ({ bbox: [0, 0, 1, 1], vertices: 4, hash: `p${n++}`, a: 1, lx: 0.5, ly: 0.5 }));
    expect(parts.map((p) => p.part)).toEqual([0, 1]);
    const other = entry({ id: 9, rid: 'clio:x@1700', from: 1700, to: 1710 }, 'q');
    const all = renumber([...parts, other]);
    const ids = all.map((p) => p.props.id);
    expect(new Set(ids).size).toBe(3);
    expect(all.filter((p) => p.props.pid === 'none').map((p) => p.props.rid)).toEqual(['none@1700', 'none@1700#2']);
    expect(all.find((p) => p.props.pid === 'none' && p.props.rid === 'none@1700#2').props.id).toBe(10);
  });

  it('merges the same unclaimed piece across consecutive frames', () => {
    const piece = (id, from, to, hash) => entry({ id, rid: `none@${from}`, pid: 'none', name: '', kind: 'unclaimed', from, to }, hash);
    const { entries } = mergeContiguous([piece(1, 1700, 1709, 'antarctica'), piece(2, 1710, 1719, 'antarctica'), piece(3, 1710, 1719, 'island')]);
    expect(entries.map((e) => [e.hash, e.props.from, e.props.to]).sort()).toEqual([['antarctica', 1700, 1719], ['island', 1710, 1719]]);
  });
});
