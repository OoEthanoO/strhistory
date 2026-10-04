"""Tests for the geometry core (coast step, frames, blockers, attributes). Plain asserts.

    node packages/borders/pipeline/tools/py.mjs tests/test_core.py            # all tests
    node packages/borders/pipeline/tools/py.mjs tests/test_core.py -k island  # names containing 'island'

Synthetic land (boxes in lon/lat) and footprints; thresholds from pipeline/config.json
"coast" (majority 50 % / others < 10 %, islands <= 2,500 km2, near 10 km, far 30 km,
ratio 3, coastal band 30 km).
"""
from __future__ import annotations

import os
import sys
import tempfile
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import shapely  # noqa: E402
from shapely.geometry import MultiPolygon, Point, box  # noqa: E402

import attributes as A  # noqa: E402
import blockers as B  # noqa: E402
import clip as CL  # noqa: E402
import coast as K  # noqa: E402
import common as C  # noqa: E402
import frames as F  # noqa: E402
import geom as G  # noqa: E402
import land as L  # noqa: E402
import qa as Q  # noqa: E402

TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


# ------------------------------------------------------------------------ helpers


def run_frame(land_boxes, recs, f=1800, t=1850):
    """One coast-step frame over synthetic land. recs: [{'pid', 'geometry', 'kind'?, 'tier'?}].
    Returns (land, metas, result)."""
    # densified: pyproj measures geodesic edges, so a long box edge would enclose a
    # different area than the same edge cut into pieces by the partition
    land = L.Land.from_parts([shapely.segmentize(box(*b) if isinstance(b, tuple) else b, 0.01) for b in land_boxes])
    metas, raws, clips = [], [], []
    for r in recs:
        raw = G.snap(shapely.segmentize(r['geometry'], 0.01))
        clipped, cov, km2, hit, full = CL.clip_geometry(raw, land)
        metas.append({'rid': f"{r['pid']}@{f}", 'pid': r['pid'], 'name': r['pid'], 'from': f, 'to': t,
                      'kind': r.get('kind', 'state'), 'tier': r.get('tier', 0), 'power': r.get('power', r['pid']),
                      'partof': None, 'subjecto': None, 'disputed': False, 'precision': 'exact', 'src': 'cliopatria',
                      'coverage': cov, 'clip_area': km2, 'parts_hit': hit, 'parts_full': full,
                      'raw_hash': G.wkb_hash(raw)})
        raws.append(raw)
        clips.append(clipped)
    eng = K.FrameEngine(land, metas, raws.__getitem__, clips.__getitem__)
    res = eng.run(f, t, list(range(len(metas))), 0)
    return land, metas, res


def owner(res, metas, lon, lat) -> str | None:
    """pid of the polity holding the point, 'unclaimed', or None (not land)."""
    pt = Point(lon, lat)
    hits = [metas[i]['pid'] for i, g in res['geoms'].items() if g.contains(pt)]
    if res['unclaimed'].contains(pt):
        hits.append('unclaimed')
    assert len(hits) <= 1, f'point {lon},{lat} in several features: {hits}'
    return hits[0] if hits else None


def assert_partition(land, res):
    """Polities + unclaimed cover the land exactly, without overlaps."""
    total = res['qa']['polity_km2'] + res['qa']['unclaimed_km2']
    assert abs(total - land.total_area) / land.total_area < 1e-6, (total, land.total_area)
    gs = list(res['geoms'].values()) + [res['unclaimed']]
    for a in range(len(gs)):
        for b in range(a + 1, len(gs)):
            ov = C.area_km2(G.inter(gs[a], gs[b]))
            assert ov < 1e-3, f'features {a} and {b} overlap by {ov} km2'


# ------------------------------------------------------------------- the rules


@test
def test_majority_island():
    # island ~490 km2: A covers 75 %, B 5 % -> the whole island goes to A (rule a)
    land, metas, res = run_frame(
        [(0, 0, 0.2, 0.2), (2, 0, 3, 1)],
        [{'pid': 'A', 'geometry': box(-1, -1, 0.15, 1)},
         {'pid': 'B', 'geometry': box(0.19, -0.5, 3.5, 1.5)}])
    assert owner(res, metas, 0.17, 0.05) == 'A'          # uncovered strip of the island
    assert owner(res, metas, 0.195, 0.15) == 'A'         # B's small share, given up
    assert res['settled'] == {0: ('A@1800', 'majority')}, res['settled']
    assert owner(res, metas, 2.5, 0.5) == 'B'            # B keeps its own land
    assert res['counts'].get('majority') == 1
    assert_partition(land, res)


@test
def test_majority_needs_small_others():
    # A covers 60 % but B 20 % (> 10 %): no majority; the overlap-free split stays
    land, metas, res = run_frame(
        [(0, 0, 0.2, 0.2)],
        [{'pid': 'A', 'geometry': box(-1, -1, 0.12, 1)},
         {'pid': 'B', 'geometry': box(0.16, -1, 1, 1)}])
    assert res['counts'].get('majority', 0) == 0
    assert owner(res, metas, 0.05, 0.1) == 'A' and owner(res, metas, 0.18, 0.1) == 'B'
    assert_partition(land, res)


def deg(km: float) -> float:
    """Degrees of longitude for km near the equator (the test islands lie at 0.4 N)."""
    return km / 111.32


@test
def test_uncovered_islands_near_and_ratio():
    # distances follow config coast: near uncoveredNearKm, far uncoveredFarKm, ratio
    near, far, ratio = K.NEAR_KM, K.FAR_KM, K.RATIO
    d = 0.6 * far
    land, metas, res = run_frame(
        [  # near: island 0.5 x near from A only
           (10.0 - deg(0.5 * near) - 0.01, 0.40, 10.0 - deg(0.5 * near), 0.45), (10, 0, 11, 1),
           # ratio: d from C, (ratio + 0.5) x d from D
           (20.0 - deg(d) - 0.01, 0.40, 20.0 - deg(d), 0.45), (20, 0, 21, 1),
           (18, 0, 20.0 - deg(d) - 0.01 - deg((ratio + 0.5) * d), 1),
           # ambiguous: d from E, 1.5 d from F (< ratio x d) -> unclaimed
           (30.0 - deg(d) - 0.01, 0.40, 30.0 - deg(d), 0.45), (30, 0, 31, 1),
           (28, 0, 30.0 - deg(d) - 0.01 - deg(1.5 * d), 1),
           # too far: 1.3 x far from G only -> unclaimed
           (40.0 - deg(1.3 * far) - 0.01, 0.40, 40.0 - deg(1.3 * far), 0.45), (40, 0, 41, 1)],
        [{'pid': 'A', 'geometry': box(10, 0, 11, 1)},
         {'pid': 'C', 'geometry': box(20, 0, 21, 1)},
         {'pid': 'D', 'geometry': box(18, 0, 20.0 - deg(d) - 0.01 - deg((ratio + 0.5) * d), 1)},
         {'pid': 'E', 'geometry': box(30, 0, 31, 1)},
         {'pid': 'F', 'geometry': box(28, 0, 30.0 - deg(d) - 0.01 - deg(1.5 * d), 1)},
         {'pid': 'G', 'geometry': box(40, 0, 41, 1)}])
    assert owner(res, metas, 10.0 - deg(0.5 * near) - 0.005, 0.42) == 'A'
    assert owner(res, metas, 20.0 - deg(d) - 0.005, 0.42) == 'C'
    assert owner(res, metas, 30.0 - deg(d) - 0.005, 0.42) == 'unclaimed'
    assert owner(res, metas, 40.0 - deg(1.3 * far) - 0.005, 0.42) == 'unclaimed'
    assert res['counts'].get('near') == 1 and res['counts'].get('ratio') == 1, res['counts']
    assert res['counts'].get('island_ambiguous') == 1, res['counts']
    assert_partition(land, res)


@test
def test_uncovered_island_two_near_polities():
    # 3 km from H and 8 km from J: two polities within 10 km and 8 < 3 x 3 -> unclaimed
    land, metas, res = run_frame(
        [(0.027, 0.40, 0.05, 0.45), (-1, 0, 0, 1), (0.122, 0, 1, 1)],
        [{'pid': 'H', 'geometry': box(-1, 0, 0, 1)}, {'pid': 'J', 'geometry': box(0.122, 0, 1, 1)}])
    assert owner(res, metas, 0.04, 0.42) == 'unclaimed'
    # 2 km from H and 8 km from J: 8 >= 3 x 2 -> H by the ratio rule
    land, metas, res = run_frame(
        [(0.018, 0.40, 0.05, 0.45), (-1, 0, 0, 1), (0.122, 0, 1, 1)],
        [{'pid': 'H', 'geometry': box(-1, 0, 0, 1)}, {'pid': 'J', 'geometry': box(0.122, 0, 1, 1)}])
    assert owner(res, metas, 0.04, 0.42) == 'H'


@test
def test_island_chain():
    # island 1 lies 0.6 x far off A; island 2 lies 0.6 x far beyond island 1 (beyond
    # far from A's own land): it is reached through island 1 in a second pass; island
    # 3, 1.3 x far further out, stays unclaimed
    step, w = deg(0.6 * K.FAR_KM), 0.02
    x1 = 1 + step
    x2 = x1 + w + step
    x3 = x2 + w + deg(1.3 * K.FAR_KM)
    land, metas, res = run_frame(
        [(0, 0, 1, 1), (x1, 0.40, x1 + w, 0.45), (x2, 0.40, x2 + w, 0.45), (x3, 0.40, x3 + w, 0.45)],
        [{'pid': 'A', 'geometry': box(-1, -1, 1, 1)}])
    assert owner(res, metas, x1 + w / 2, 0.42) == 'A'
    assert owner(res, metas, x2 + w / 2, 0.42) == 'A'
    assert owner(res, metas, x3 + w / 2, 0.42) == 'unclaimed'
    assert res['counts'].get('island_chained') == 1 and res['counts'].get('island_passes') == 2, res['counts']
    assert_partition(land, res)


@test
def test_antimeridian_adjacency():
    # Chukotka: a landmass cut at +/-180; the footprint (like Cliopatria's Russia)
    # stops at 180 E. The part east of 180 goes to it across the antimeridian.
    # Wrangel: a small island cut at 180, 5.5 km north of the footprint -> near rule.
    land, metas, res = run_frame(
        [(170, 60, 180, 70), (-180, 60, -175, 70), (179.9, 71.0, 180, 71.1), (-180, 71.0, -179.5, 71.1)],
        [{'pid': 'R', 'geometry': box(165, 55, 180, 70.95)}])
    assert len(land.joins) >= 2, land.joins
    assert owner(res, metas, -177, 65) == 'R'
    assert owner(res, metas, -179.7, 71.05) == 'R' and owner(res, metas, 179.95, 71.05) == 'R'
    assert res['counts'].get('pocket_dateline', 0) == 1, res['counts']
    assert res['counts'].get('near', 0) == 1, res['counts']
    assert_partition(land, res)
    # Chukotka 1900: another footprint (Cliopatria's USA) also touches the far tip; the
    # piece east of 180 is split by nearest boundary instead of staying unclaimed
    land, metas, res = run_frame(
        [(170, 60, 180, 70), (-180, 60, -175, 70)],
        [{'pid': 'R', 'geometry': box(165, 55, 180, 70.95)}, {'pid': 'U', 'geometry': box(-175.3, 64, -170, 66)}])
    assert owner(res, metas, -179, 65) == 'R' and owner(res, metas, -178, 68) == 'R'
    assert owner(res, metas, -175.1, 65) == 'U'
    assert owner(res, metas, -175.5, 65) == 'U'       # nearest to U's boundary
    assert res['counts'].get('pocket_dateline', 0) == 2, res['counts']   # one piece each
    assert_partition(land, res)


@test
def test_coastal_gap_split_between_two_polities():
    # A and B stop ~5.5 km short of the coast; a 44 km wide frontier zone lies between
    # them. The coastal strips go to the nearer polity; the frontier zone (wider than
    # 2 x coastalGapCloseKm) stays unclaimed, also where it reaches the coast.
    land, metas, res = run_frame(
        [(0, 0, 3, 3)],
        [{'pid': 'A', 'geometry': box(0.05, 0.05, 1.3, 2.95)}, {'pid': 'B', 'geometry': box(1.7, 0.05, 2.95, 2.95)}])
    assert owner(res, metas, 0.02, 1.5) == 'A' and owner(res, metas, 0.65, 0.02) == 'A'
    assert owner(res, metas, 0.02, 0.02) == 'A'
    assert owner(res, metas, 2.98, 1.5) == 'B' and owner(res, metas, 2.3, 2.98) == 'B'
    assert owner(res, metas, 1.5, 1.5) == 'unclaimed'          # inland frontier zone
    assert owner(res, metas, 1.5, 0.02) == 'unclaimed'         # the wide zone at the coast
    assert res['counts'].get('gap', 0) >= 2, res['counts']
    assert_partition(land, res)


@test
def test_unclaimed_computation_and_pockets():
    # a hole inside A's footprint (lake-like digitising gap, < pocketMaxAreaKm2) is
    # filled; land nobody touches is unclaimed; polities + unclaimed = land
    a = shapely.difference(box(0, 0, 2, 2), box(0.9, 0.9, 1.1, 1.1))
    land, metas, res = run_frame([(0, 0, 2, 2), (5, 5, 6, 6)], [{'pid': 'A', 'geometry': a}])
    assert owner(res, metas, 1.0, 1.0) == 'A'
    assert owner(res, metas, 5.5, 5.5) == 'unclaimed'
    assert res['counts'].get('pocket') == 1
    u = sum(km2 for _, _, km2 in res['unclaimed_parts'])
    assert abs(u - C.area_km2(shapely.segmentize(box(5, 5, 6, 6), 0.01))) < 1e-3, u
    assert_partition(land, res)


@test
def test_blocker_keeps_removed_land_unclaimed():
    # the same hole, but an override subtracted it: the blocker keeps it unclaimed
    hole = box(0.9, 0.9, 1.1, 1.1)
    before = [{'rid': 'A@1800', 'pid': 'A', 'from': 1800, 'to': 1850, 'tier': 0, 'kind': 'state',
               'geometry': box(0, 0, 2, 2), 'prov': {'index': 7}}]
    after = [dict(before[0], to=1819),
             dict(before[0], rid='A@1820', **{'from': 1820}, geometry=G.diff(box(0, 0, 2, 2), hole),
                  prov={'index': 7, 'overrides': ['h-x-0001']})]
    blk = B.removal_blockers(before, after)
    assert len(blk) == 1 and blk[0]['from'] == 1820 and blk[0]['to'] == 1850 and blk[0]['kind'] == 'unclaimed'
    assert abs(C.area_km2(blk[0]['geometry']) - C.area_km2(hole)) < 1e-6
    deleted = B.removal_blockers(before, [dict(before[0], to=1830)])
    assert [(b['from'], b['to']) for b in deleted] == [(1831, 1850)]
    land, metas, res = run_frame([(0, 0, 2, 2)], [{'pid': 'A', 'geometry': after[1]['geometry']},
                                                  {'pid': 'none', 'kind': 'unclaimed', 'geometry': blk[0]['geometry']}])
    assert owner(res, metas, 1.0, 1.0) == 'unclaimed'
    assert owner(res, metas, 0.5, 0.5) == 'A'
    assert_partition(land, res)


@test
def test_assign_results_rebalance_polities_and_unclaimed():
    # a stand-in for overrides.apply_assign_ops: lon 0.5..1 goes from B to A, and the
    # unclaimed strip 1.8..2 goes to A as an exclave; the engine must take that land
    # out of B and out of the unclaimed land, and keep the partition exact
    import types
    land = L.Land.from_parts([shapely.segmentize(box(0, 0, 2, 1), 0.01)])
    raws = [G.snap(shapely.segmentize(box(-1, -1, 0.5, 2), 0.01)), G.snap(shapely.segmentize(box(0.5, -1, 1.5, 2), 0.01))]
    metas, clips = [], []
    for pid, raw in zip(('A', 'B'), raws):
        clipped, cov, km2, hit, full = CL.clip_geometry(raw, land)
        clips.append(clipped)
        metas.append({'rid': f'{pid}@1800', 'pid': pid, 'name': pid, 'from': 1800, 'to': 1850, 'kind': 'state', 'tier': 0,
                      'power': pid, 'partof': None, 'subjecto': None, 'disputed': False, 'precision': 'exact',
                      'src': 'cliopatria', 'coverage': cov, 'clip_area': km2, 'parts_hit': hit, 'parts_full': full,
                      'raw_hash': G.wkb_hash(raw)})
    west, east = G.inter(box(0.5, 0, 1, 1), land.multipolygon), G.inter(box(1.8, 0, 2, 1), land.multipolygon)

    def fake_assign(records, span, ov, ctx):
        out = []
        for r in records:
            if r['pid'] == 'A':
                r = dict(r, geometry=G.union([r['geometry'], west, east]))
            elif r['pid'] == 'B':
                r = dict(r, geometry=G.diff(r['geometry'], west))
            out.append(r)
        return out, [{'id': 'test-assign', 'status': 'applied'}]

    eng = K.FrameEngine(land, metas, raws.__getitem__, clips.__getitem__, assign_fn=fake_assign,
                        assign_years=[(1800, 1850)], lookup=None, ctx=types.SimpleNamespace(record_lookup=None), ov={})
    res = eng.run(1800, 1850, [0, 1], 0)
    assert owner(res, metas, 0.75, 0.5) == 'A' and owner(res, metas, 1.25, 0.5) == 'B'
    assert owner(res, metas, 1.9, 0.5) == 'A'            # taken out of the unclaimed land
    assert owner(res, metas, 1.65, 0.5) == 'unclaimed'
    assert res['counts'].get('assign_applied') == 1
    assert_partition(land, res)


# ------------------------------------------------------------------- frames


@test
def test_frame_merge():
    g1, g2 = G.snap(box(0, 0, 1, 1)), G.snap(box(0, 0, 1, 2))
    g1b = G.snap(shapely.Polygon([(0, 0), (0.5, 0), (1, 0), (1, 1), (0, 1)]))   # same area, extra vertex
    with tempfile.TemporaryDirectory() as tmp:
        tr = F.Tracker(os.path.join(tmp, 'b0.bin'))
        for f, t, g, tok in [(1800, 1809, g1, 'x'), (1810, 1819, g1, 'x'), (1820, 1829, g1b, 'y'),
                             (1830, 1839, g2, 'z'), (1840, 1849, g1, 'w')]:
            tr.see(7, f, t, g, token=tok)
            tr.end_frame(f)
        runs = tr.finish()
        assert [(r['from'], r['to']) for r in runs] == [(1800, 1829), (1830, 1839), (1840, 1849)], runs
        # a record absent in one frame starts a new run when it comes back
        tr = F.Tracker(os.path.join(tmp, 'b1.bin'))
        tr.see(1, 1850, 1859, g1)
        tr.end_frame(1850)
        tr.end_frame(1860)
        tr.see(1, 1870, 1879, g1)
        tr.end_frame(1870)
        r1 = tr.finish()
        assert [(r['from'], r['to']) for r in r1] == [(1850, 1859), (1870, 1879)]
        # runs meeting at a block boundary are joined when the geometry is identical
        for r in runs:
            r['block'] = 0
        tr = F.Tracker(os.path.join(tmp, 'b2.bin'))
        tr.see(7, 1850, 1899, g1)
        tr.see(('u', b'h'), 1850, 1899, g2, h=b'h')
        tr.end_frame(1850)
        nxt = tr.finish()
        for r in nxt:
            r['block'] = 2
        reader = F.RunReader({0: os.path.join(tmp, 'b0.bin'), 2: os.path.join(tmp, 'b2.bin')})
        merged, joins = F.merge_runs(runs + nxt, reader)
        reader.close()
        assert joins == 1
        assert sorted((str(r['key']), r['from'], r['to']) for r in merged) == sorted(
            [('7', 1800, 1829), ('7', 1830, 1839), ('7', 1840, 1899), ("('u', b'h')", 1850, 1899)])


@test
def test_year_zero_handling():
    assert C.norm_year(0) == 1 and C.norm_year(0, end=True) == -1
    assert C.add_years(-1, 1) == 1 and C.add_years(1, -1) == -1 and C.add_years(-5, 10) == 6
    metas = [{'from': -100, 'to': -1}, {'from': 1, 'to': 50}, {'from': -20, 'to': 30}]
    fr = F.frame_years(metas, extra=[], lo=-100, hi=100)
    assert 0 not in fr and fr == [-100, -20, 1, 31, 51], fr
    sp = F.spans_of(fr, 100)
    assert sp[1] == (-20, -1) and sp[2] == (1, 30), sp
    assert F.years_in(-5, 5) == 10 and F.years_in(1, 10) == 10 and F.years_in(-10, -1) == 10
    sy = Q.sample_years()
    assert 0 not in sy and 1 in sy and -3400 in sy and 1650 in sy and 1700 in sy and 1710 in sy and 2020 in sy
    assert sy == sorted(sy)


# --------------------------------------------------------------- attributes


@test
def test_colours_and_ids():
    adj = {('a', 'b'): 10.0, ('b', 'c'): 5.0, ('a', 'c'): 7.0, ('c', 'd'): 1.0}
    col, st = A.colour_powers(adj, 3, powers=['a', 'b', 'c', 'd', 'e'])
    assert len({col['a'], col['b'], col['c']}) == 3 and col['c'] != col['d'] and st['conflicts'] == 0
    assert A.colour_powers(adj, 3, powers=['a', 'b', 'c', 'd', 'e'])[0] == col      # deterministic
    col2, st2 = A.colour_powers(adj, 2)                                           # a triangle in 2 slots:
    assert st2['conflicts'] == 1 and st2['worst_conflicts'][0]['weight'] == 5.0    # the lightest edge conflicts
    metas = [{'rid': 'clio:x@1800', 'pid': 'clio:x', 'name': 'X', 'from': 1800, 'to': 1900, 'kind': 'state', 'tier': 0,
              'power': 'clio:x', 'partof': None, 'subjecto': None, 'disputed': False, 'precision': 'exact',
              'src': 'cliopatria'}]
    runs = [{'key': 0, 'from': 1800, 'to': 1849, 'a': 10.0, 'lx': 1.0, 'ly': 2.0, 'bbox': [0, 0, 1, 1]},
            {'key': 0, 'from': 1850, 'to': 1900, 'a': 12.0, 'lx': 1.0, 'ly': 2.0, 'bbox': [0, 0, 1, 1]},
            {'key': ('u', b'1'), 'from': 1800, 'to': 1900, 'a': 3.0, 'lx': 5.0, 'ly': 5.0, 'bbox': [4, 4, 6, 6]},
            {'key': ('u', b'2'), 'from': 1800, 'to': 1900, 'a': 2.0, 'lx': 7.0, 'ly': 7.0, 'bbox': [6, 6, 8, 8]}]
    feats = A.make_features(metas, runs, [], {'clio:x': 4})
    got = [(p['id'], p['rid'], p['c']) for p in feats]
    assert got == [(1, 'clio:x@1800', 4), (2, 'none@1800', -1), (3, 'none@1800#2', -1), (4, 'clio:x@1850', 4)], got
    assert list(A.props_of(feats[0])) == list(A.PROP_KEYS)
    idx = A.polity_index(feats, metas)
    assert idx['clio:x']['spans'] == [[1800, 1900]] and idx['clio:x']['peak'] == 1850 and 'none' not in idx
    line = A.feature_line(dict(feats[1]), G.snap(box(4, 4, 6, 6)))
    assert line.startswith('{"type":"Feature","id":2,') and '"kind":"unclaimed"' in line


# --------------------------------------------------------------------------- runner


def main() -> int:
    pattern = sys.argv[sys.argv.index('-k') + 1] if '-k' in sys.argv else ''
    run = [fn for fn in TESTS if pattern in fn.__name__]
    failed = []
    t0 = time.time()
    for fn in run:
        t = time.time()
        try:
            fn()
            print(f'PASS {fn.__name__} ({time.time() - t:.2f}s)')
        except Exception:  # noqa: BLE001
            failed.append(fn.__name__)
            print(f'FAIL {fn.__name__}')
            traceback.print_exc()
    print(f'\n{len(run) - len(failed)} passed, {len(failed)} failed in {time.time() - t0:.1f}s')
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
