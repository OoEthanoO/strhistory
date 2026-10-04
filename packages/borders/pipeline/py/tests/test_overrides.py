"""Tests for the override engine (py/overrides.py and py/modern.py). Plain asserts.

    node packages/borders/pipeline/tools/py.mjs tests/test_overrides.py           # all tests
    node packages/borders/pipeline/tools/py.mjs tests/test_overrides.py -k assign # names containing 'assign'

Synthetic records live on a fake context (squares in lon/lat near 0,0); geometry
specs are also resolved against the real Natural Earth data in .cache/sources.
"""
from __future__ import annotations

import atexit
import io
import json
import os
import pickle
import shutil
import sys
import tempfile
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))

import shapely  # noqa: E402
from shapely import STRtree  # noqa: E402
from shapely.geometry import MultiPolygon, Point, box  # noqa: E402

import common as C  # noqa: E402
import modern as M  # noqa: E402
import overrides as O  # noqa: E402

FIXTURES = os.path.join(HERE, 'fixtures', 'overrides')
PRESENT = C.PRESENT_YEAR
TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


# ----------------------------------------------------------------------- helpers


def sq(x0, y0, x1, y1) -> MultiPolygon:
    return C.polygonal(box(x0, y0, x1, y1))


def poly(x0, y0, x1, y1) -> dict:
    """Polygon spec of an axis-aligned box."""
    return {'type': 'polygon', 'rings': [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def rec(pid, frm, to, geom, tier=0, **kw) -> dict:
    r = {'rid': f'{pid}@{frm}', 'pid': pid, 'name': pid.split(':', 1)[1], 'from': frm, 'to': to,
         'kind': 'state', 'tier': tier, 'power': pid, 'partof': None, 'subjecto': None, 'disputed': False,
         'precision': 'exact', 'src': 'cliopatria', 'geometry': C.polygonal(geom), 'prov': {}}
    r.update(kw)
    return r


def entry(id_, op, years, **kw) -> dict:
    e = {'id': id_, 'op': op, 'years': list(years), 'reason': 'test entry for the override engine',
         'confidence': 'high', 'status': 'active', 'author': 'test', 'date': '2026-10-01',
         'sources': [{'title': 'test', 'url': 'https://example.org/test'}]}
    e.update(kw)
    return e


_TMP: list[str] = []
atexit.register(lambda: [shutil.rmtree(d, ignore_errors=True) for d in _TMP])


def ov_of(files: dict) -> dict:
    """Write {relative path: data (dict) or raw text} into a temp overrides folder and load it."""
    root = tempfile.mkdtemp(prefix='alexs-atlas-ovr-')
    _TMP.append(root)
    for rel, data in files.items():
        p = os.path.join(root, *rel.split('/'))
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w', encoding='utf-8') as f:
            f.write(data if isinstance(data, str) else json.dumps(data, ensure_ascii=False))
    return O.load_overrides(root)


def hist(*entries, kind='historical') -> dict:
    return ov_of({f'{kind}/test.json': {'kind': kind, 'region': 'test', 'entries': list(entries)}})


def modern_ov(units=(), overlays=(), entries=()) -> dict:
    return ov_of({'modern/test.json': {'kind': 'modern', 'region': 'test', 'units': list(units),
                                       'overlays': list(overlays), 'entries': list(entries)}})


def unit(code, timeline, subunits=None) -> dict:
    u = {'unit': code, 'timeline': timeline, 'sources': [{'title': 't', 'url': 'https://example.org'}]}
    if subunits is not None:
        u['subunits'] = subunits
    return u


def period(a, b, pid, name, kind='state', **kw) -> dict:
    return {'years': [a, b], 'state': {'pid': pid, 'name': name, 'kind': kind, **kw}}


class FakeCtx:
    """Stand-in for common.Ctx over synthetic geometry (same attributes and methods)."""

    def __init__(self, land=None, admin0=None, admin1=None, disputed=None):
        self.record_lookup = None
        self.land_parts = list(land or [box(-60, -60, 60, 60)])
        self.land_tree = STRtree(self.land_parts)
        self.land = MultiPolygon(self.land_parts)
        self.admin0 = admin0 or {}
        self.admin1 = admin1 or {}
        self.disputed = disputed or {}

    def islands_at(self, points, snap_km=5.0):
        out = []
        for lon, lat in points:
            hits = self.land_tree.query(Point(lon, lat), predicate='intersects')
            if not len(hits):
                raise ValueError(f'point {lon},{lat} is not on land')
            out.append(self.land_parts[int(hits[0])])
        return C.polygonal(shapely.union_all(out))


_REAL = []


def real() -> C.Ctx:
    if not _REAL:
        _REAL.append(C.Ctx())
    return _REAL[0]


def by_rid(records) -> dict:
    return {r['rid']: r for r in records}


def statuses(log) -> dict:
    return {x['id']: x['status'] for x in log}


def close(a, b, tol=1e-9) -> bool:
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def check_contract(records):
    """Every record follows common.py's contract; rids unique and pid@from(#n)."""
    rids = [r['rid'] for r in records]
    assert len(rids) == len(set(rids)), 'duplicate rids'
    for r in records:
        for k in ('rid', 'pid', 'name', 'from', 'to', 'kind', 'tier', 'power', 'partof', 'subjecto',
                  'disputed', 'precision', 'src', 'geometry', 'prov'):
            assert k in r, f'{r["rid"]} lacks {k}'
        assert r['rid'].split('#')[0] == f"{r['pid']}@{r['from']}", r['rid']
        assert r['from'] <= r['to'] and r['from'] != 0 and r['to'] != 0, r['rid']
        assert isinstance(r['geometry'], MultiPolygon) and r['geometry'].is_valid and not r['geometry'].is_empty, r['rid']
        assert r['tier'] in (0, 1) and r['precision'] in ('exact', 'approximate'), r['rid']


# ------------------------------------------------------------------------ loading


@test
def test_load_fixture_files():
    ov = O.load_overrides(FIXTURES)
    assert [f['file'] for f in ov['files']] == ['early/test-early.json', 'historical/test-historical.json',
                                                'modern/test-modern.json']
    assert ov['errors'] == [], ov['errors']
    ids = [e['id'] for e in ov['entries']]
    assert ids == ['e-test-0001', 'e-test-0002'] + [f'h-test-000{i}' for i in range(1, 9)] + ['m-test-0001'], ids
    counts = {s: len(v) for s, v in ov['by_status'].items()}
    assert counts == {'active': 8, 'proposed': 1, 'known-gap': 1, 'rejected': 1}, counts
    e = ov['entries'][0]
    assert e['years'] == (-50, -1) and e['_file'] == 'early/test-early.json' and e['_kind'] == 'early'
    assert ov['entries'][-1]['years'] == (1946, PRESENT)          # 'present' resolved
    ton = ov['units'][0]
    assert ton['unit'] == 'TON' and ton['_file'] == 'modern/test-modern.json'
    assert [p['years'] for p in ton['timeline']] == [(1946, 1969), (1970, PRESENT)]
    assert ov['overlays'][0]['timeline'][0]['years'] == (2014, PRESENT)


@test
def test_load_reports_file_problems():
    good = entry('h-x-0001', 'note', [1800, 1801])
    ov = ov_of({
        'historical/a.json': {'kind': 'historical', 'region': 'a', 'entries': [good, entry('h-x-0002', 'note', [1810, 1800]),
                                                                              entry('h-x-0003', 'note', [0, 5])]},
        'historical/b.json': {'kind': 'early', 'region': 'b', 'entries': [dict(good)]},
        'historical/c.json': '{ not json',
        'modern/m1.json': {'kind': 'modern', 'region': 'm1', 'units': [unit('TON', [period(1946, 'present', 'ne:ton', 'Tonga')])]},
        'modern/m2.json': {'kind': 'modern', 'region': 'm2', 'units': [unit('TON', [period(1946, 'present', 'ne:ton', 'Tonga')])]},
    })
    details = [(x['file'], x['detail']) for x in ov['errors']]
    assert any(f == 'historical/b.json' and 'kind is' in d for f, d in details), details
    assert any(f == 'historical/b.json' and 'duplicate entry id' in d for f, d in details), details
    assert any(f == 'historical/c.json' and 'cannot read' in d for f, d in details), details
    assert any(f == 'modern/m2.json' and 'also defined in modern/m1.json' in d for f, d in details), details
    assert len(ov['units']) == 1
    bad = {e['id']: e.get('_error') for e in ov['entries']}
    assert 'backwards' in bad['h-x-0002'] and 'year 0' in bad['h-x-0003'] and bad['h-x-0001'] is None
    # load errors and malformed entries reach the logs of the functions that apply them
    _, log = O.apply_record_ops([], ov, FakeCtx())
    st = statuses(log)
    assert st['h-x-0002'] == 'error' and st['h-x-0003'] == 'error'
    assert any(x['op'] == 'load' and x['file'] == 'historical/c.json' for x in log)
    _, mlog = O.build_modern(ov, FakeCtx(admin0={'TON': sq(0, 0, 1, 1)}), meta={})
    assert any(x['op'] == 'unit' and x['file'] == 'modern/m2.json' and x['status'] == 'error' for x in mlog)


@test
def test_change_years():
    ys = O.change_years(O.load_overrides(FIXTURES))
    # e-test-0001 [-50,-1] -> -50, 1 (no year 0); h-0001 [1791,1894]; h-0002 [1709,1800];
    # h-0005 [1800,1810]; h-0007 [1800,1850]; h-0008 [1900,1910]; TON 1946, 1970;
    # overlay 2014. 'present'+1 = 2027 is beyond coverage; notes and inactive entries add nothing.
    assert ys == {-50, 1, 1791, 1895, 1709, 1801, 1800, 1811, 1851, 1900, 1911, 1946, 1970, 2014}, sorted(ys)


# ---------------------------------------------------------------- geometry specs


@test
def test_resolve_admin0_ton():
    g = O.resolve_geometry({'type': 'admin0', 'codes': ['TON']}, real())
    assert isinstance(g, MultiPolygon) and g.is_valid and len(g.geoms) == 10      # NE 5.1.2: 10 island parts
    assert 590 < C.area_km2(g) < 615, C.area_km2(g)
    assert O.resolve_geometry({'type': 'admin0', 'codes': ['TON']}, real()) is g   # cached


@test
def test_resolve_admin1_by_iso_and_code():
    ctx = real()
    hi = O.resolve_geometry({'type': 'admin1', 'codes': ['US-HI']}, ctx)
    by_code = O.resolve_geometry({'type': 'admin1', 'codes': ['USA-3517']}, ctx)
    assert hi.equals(by_code)
    assert 16000 < C.area_km2(hi) < 17500, C.area_km2(hi)
    # an iso code shared by two NE features means both (Transnistria: MDA-1628 + MDA-1638)
    sn = O.resolve_geometry({'type': 'admin1', 'codes': ['MD-SN']}, ctx)
    parts = [O.snap(ctx.admin1['MDA-1628']), O.snap(ctx.admin1['MDA-1638'])]
    assert close(C.area_km2(sn), C.area_km2(parts[0]) + C.area_km2(parts[1]), 1e-9)
    assert all(not p.difference(sn).area for p in parts)
    try:
        O.resolve_geometry({'type': 'admin1', 'codes': ['XX-NOPE']}, ctx)
        raise AssertionError('unknown code accepted')
    except O.GeometryError as ex:
        assert 'XX-NOPE' in str(ex)


@test
def test_resolve_islands_jersey():
    ctx = real()
    j = O.resolve_geometry({'type': 'islands', 'points': [[-2.13, 49.21]], 'names': ['Jersey']}, ctx)
    assert 110 < C.area_km2(j) < 130, C.area_km2(j)
    # a point ~0.7 km off the easternmost vertex snaps to Jersey; mid-Biscay fails
    x, y = max(((px, py) for p in j.geoms for px, py in p.exterior.coords), key=lambda c: c[0])
    near = O.resolve_geometry({'type': 'islands', 'points': [[x + 0.01, y]]}, ctx)
    assert near.equals(j)
    try:
        O.resolve_geometry({'type': 'islands', 'points': [[-6.0, 46.0]]}, ctx)
        raise AssertionError('point at sea accepted')
    except O.GeometryError as ex:
        assert 'km' in str(ex)


@test
def test_resolve_islands_across_the_antimeridian():
    # Natural Earth cuts Wrangel Island and Fiji's Taveuni at 180 deg: a point on either
    # half gives the whole island (both parts), like the geometry core's logical islands
    ctx = real()
    for west_pt, east_pt, km2 in (([179.6, 71.4], [-179.5, 71.2], (7400, 7900)),     # Wrangel Island
                                  ([179.95, -16.9], [-179.9, -16.85], (430, 500))):  # Taveuni
        a = O.resolve_geometry({'type': 'islands', 'points': [west_pt]}, ctx)
        b = O.resolve_geometry({'type': 'islands', 'points': [east_pt]}, ctx)
        assert a.equals(b) and len(a.geoms) == 2, (west_pt, len(a.geoms))
        assert a.bounds[0] == -180 and a.bounds[2] == 180
        assert km2[0] < C.area_km2(a) < km2[1], C.area_km2(a)
        assert C.area_km2(a) > C.area_km2(ctx.islands_at([tuple(west_pt)])) + 1


@test
def test_resolve_ne_disputed_crimea():
    g = O.resolve_geometry({'type': 'ne-disputed', 'codes': ['B89']}, real())
    assert 24000 < C.area_km2(g) < 29000, C.area_km2(g)
    assert g.contains(Point(34.1, 45.0))
    try:
        O.resolve_geometry({'type': 'ne-disputed', 'codes': ['ZZZ']}, real())
        raise AssertionError('unknown disputed code accepted')
    except O.GeometryError:
        pass


@test
def test_resolve_hand_polygons():
    ctx = FakeCtx()
    holed = O.resolve_geometry({'type': 'polygon', 'rings': [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
                                                             [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]]]}, ctx)
    assert close(holed.area, 15)
    two = O.resolve_geometry({'type': 'polygon', 'polygons': [poly(0, 0, 1, 1)['rings'], poly(5, 5, 7, 6)['rings']]}, ctx)
    assert len(two.geoms) == 2 and close(two.area, 3)
    bowtie = O.resolve_geometry({'type': 'polygon', 'rings': [[[0, 0], [2, 2], [2, 0], [0, 2], [0, 0]]]}, ctx)
    assert bowtie.is_valid and close(bowtie.area, 2)
    unclosed = O.resolve_geometry({'type': 'polygon', 'rings': [[[0, 0], [1, 0], [1, 1], [0, 1]]]}, ctx)
    assert close(unclosed.area, 1)
    # a ring across the antimeridian becomes two parts inside -180..180 (4 x 2 degrees)
    fiji = O.resolve_geometry({'type': 'polygon', 'rings': [[[178, -17], [-178, -17], [-178, -15], [178, -15], [178, -17]]]}, ctx)
    assert len(fiji.geoms) == 2 and close(fiji.area, 8), fiji.area
    assert fiji.bounds[0] == -180 and fiji.bounds[2] == 180
    for bad in ({'type': 'polygon', 'rings': [[[0, 0], [1, 1], [0, 0], [1, 1]]]},
                {'type': 'polygon', 'rings': [[[0, 0], [200, 0], [0, 1], [0, 0]]]},
                {'type': 'polygon'}, {'type': 'nope'}, {'codes': ['TON']}):
        try:
            O.resolve_geometry(bad, ctx)
            raise AssertionError(f'accepted {bad}')
        except O.GeometryError:
            pass


@test
def test_resolve_record_and_combinations():
    ctx = real()
    ctx.record_lookup = lambda pid, year: sq(-3, 49, -1, 50) if (pid, year) == ('clio:x', 1800) else None
    try:
        rec_g = O.resolve_geometry({'type': 'record', 'pid': 'clio:x', 'year': 1800}, ctx)
        assert close(rec_g.area, 2)
        assert O.resolve_geometry({'type': 'record', 'pid': 'clio:x'}, ctx, at_year=1800).equals(rec_g)
        try:
            O.resolve_geometry({'type': 'record', 'pid': 'clio:x', 'year': 1801}, ctx)
            raise AssertionError('missing record accepted')
        except O.MissingRecordError:
            pass
        jersey = {'type': 'islands', 'points': [[-2.13, 49.21]]}
        j = O.snap(ctx.islands_at([(-2.13, 49.21)]))
        u = O.resolve_geometry({'type': 'union', 'parts': [{'type': 'admin0', 'codes': ['TON']}, jersey]}, ctx)
        assert close(C.area_km2(u), C.area_km2(O.snap(ctx.admin0['TON'])) + C.area_km2(j), 1e-9)
        inter = O.resolve_geometry({'type': 'intersection', 'parts': [jersey, {'type': 'record', 'pid': 'clio:x', 'year': 1800}]}, ctx)
        assert close(inter.area, j.area, 1e-9)                               # Jersey lies inside the box
        diff = O.resolve_geometry({'type': 'difference', 'base': {'type': 'record', 'pid': 'clio:x', 'year': 1800},
                                   'minus': [jersey]}, ctx)
        assert close(diff.area, 2 - inter.area, 1e-9)
        # specs with 'record' parts are not cached (the records change while overrides apply)
        assert O.resolve_geometry({'type': 'record', 'pid': 'clio:x', 'year': 1800}, ctx) is not rec_g
    finally:
        ctx.record_lookup = None
    try:
        O.resolve_geometry({'type': 'record', 'pid': 'clio:x', 'year': 1800}, FakeCtx())
        raise AssertionError('record spec without lookup accepted')
    except O.GeometryError as ex:
        assert 'record_lookup' in str(ex)


# --------------------------------------------------------------------- record ops


@test
def test_delete_splits_and_removes():
    a, b = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10)), rec('clio:b', 1700, 1800, sq(10, 0, 20, 10))
    ov = hist(entry('h-t-1', 'delete', [1750, 1760], target={'pid': 'clio:a'}),
              entry('h-t-2', 'delete', [1650, 1900], target={'pid': 'clio:b'}))
    out, log = O.apply_record_ops([a, b], ov, FakeCtx())
    check_contract(out)
    got = {(r['rid'], r['from'], r['to']) for r in out}
    assert got == {('clio:a@1700', 1700, 1749), ('clio:a@1761', 1761, 1800)}, got
    st = statuses(log)
    assert st == {'h-t-1': 'applied', 'h-t-2': 'applied'}, log
    l1 = next(x for x in log if x['id'] == 'h-t-1')
    assert {'clio:a@1700', 'clio:a@1750', 'clio:a@1761'} <= set(l1['rids']), l1


@test
def test_update_splits_at_range_ends():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10), wikidata='Q1')
    ov = hist(entry('h-t-1', 'update', [1720, 1730], target={'pid': 'clio:a'},
                    set={'name': 'Renamed', 'kind': 'dependency', 'power': 'clio:z', 'wikipedia': 'Renamed'}))
    out, log = O.apply_record_ops([a], ov, FakeCtx())
    check_contract(out)
    r = by_rid(out)
    assert set(r) == {'clio:a@1700', 'clio:a@1720', 'clio:a@1731'}
    assert (r['clio:a@1700']['to'], r['clio:a@1731']['from']) == (1719, 1731)
    mid = r['clio:a@1720']
    assert (mid['name'], mid['kind'], mid['power'], mid['wikipedia'], mid['to']) == ('Renamed', 'dependency', 'clio:z', 'Renamed', 1730)
    assert mid['wikidata'] == 'Q1' and mid['prov'] == {'overrides': ['h-t-1']}
    assert r['clio:a@1700']['name'] == 'a' and r['clio:a@1700']['prov'] == {} and r['clio:a@1731']['name'] == 'a'
    assert statuses(log) == {'h-t-1': 'applied'}


@test
def test_update_can_change_pid():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 1, 1))
    ov = hist(entry('h-t-1', 'update', [1750, 1800], target={'pid': 'clio:a'}, set={'pid': 'ovr:new-a', 'name': 'New A'}))
    out, _ = O.apply_record_ops([a], ov, FakeCtx())
    check_contract(out)
    new = next(r for r in out if r['pid'] == 'ovr:new-a')
    assert new['rid'] == 'ovr:new-a@1750' and new['power'] == 'ovr:new-a' and new['to'] == 1800


@test
def test_split_across_year_zero():
    a = rec('clio:a', -10, 10, sq(0, 0, 1, 1))
    out, _ = O.apply_record_ops([a], hist(entry('e-t-1', 'update', [1, 5], target={'pid': 'clio:a'}, set={'name': 'CE'}),
                                          kind='early'), FakeCtx())
    check_contract(out)
    assert sorted((r['from'], r['to'], r['name']) for r in out) == [(-10, -1, 'a'), (1, 5, 'CE'), (6, 10, 'a')]
    out, _ = O.apply_record_ops([a], hist(entry('e-t-2', 'delete', [-5, -1], target={'pid': 'clio:a'}), kind='early'), FakeCtx())
    assert sorted((r['from'], r['to']) for r in out) == [(-10, -6), (1, 10)]


@test
def test_subtract():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    b = rec('clio:b', 1700, 1800, sq(20, 0, 30, 10))
    ov = hist(entry('h-t-1', 'subtract', [1750, 1750], target={'pid': 'clio:a'}, geometry=poly(5, -5, 15, 15)),
              entry('h-t-2', 'subtract', [1790, 1800], target={'pid': 'clio:b'}, geometry=poly(19, -1, 31, 11)),
              entry('h-t-3', 'subtract', [1700, 1800], target={'pid': 'clio:a'}, geometry=poly(40, 40, 41, 41)))
    out, log = O.apply_record_ops([a, b], ov, FakeCtx())
    check_contract(out)
    r = by_rid(out)
    assert close(r['clio:a@1750']['geometry'].area, 50) and r['clio:a@1750']['to'] == 1750
    assert close(r['clio:a@1700']['geometry'].area, 100) and r['clio:a@1700']['to'] == 1749
    assert close(r['clio:a@1751']['geometry'].area, 100)
    assert r['clio:a@1750']['prov'] == {'overrides': ['h-t-1']}
    assert 'clio:b@1790' not in r and r['clio:b@1700']['to'] == 1789       # emptied piece dropped
    st = statuses(log)
    assert st == {'h-t-1': 'applied', 'h-t-2': 'applied', 'h-t-3': 'stale'}, log


@test
def test_add_defaults_and_carve():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    t1 = rec('ovr:overlay', 1700, 1800, sq(0, 0, 10, 10), tier=1)
    ov = hist(entry('h-t-1', 'add', [1750, 1760], geometry=poly(5, 0, 15, 10),
                    set={'pid': 'ovr:new', 'name': 'New', 'kind': 'state', 'wikidata': 'Q42', 'altNames': ['Neu']}))
    out, log = O.apply_record_ops([a, t1], ov, FakeCtx())
    check_contract(out)
    r = by_rid(out)
    new = r['ovr:new@1750']
    assert (new['from'], new['to'], new['tier'], new['kind'], new['power'], new['src']) == (1750, 1760, 0, 'state', 'ovr:new', 'override')
    assert new['precision'] == 'approximate' and new['disputed'] is False and new['prov'] == {'overrides': ['h-t-1']}
    assert new['wikidata'] == 'Q42' and new['altNames'] == ['Neu'] and new['partof'] is None
    assert close(r['clio:a@1750']['geometry'].area, 50) and r['clio:a@1750']['prov'] == {'overrides': ['h-t-1']}
    assert close(r['clio:a@1700']['geometry'].area, 100) and close(r['clio:a@1761']['geometry'].area, 100)
    assert r['ovr:overlay@1700'] is t1                                     # tier 1 is never carved
    l1 = log[0]
    assert l1['status'] == 'applied' and l1['rids'][0] == 'ovr:new@1750' and 'clio:a@1750' in l1['rids']


@test
def test_add_carve_false_and_tier1_defaults():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    ov = hist(entry('h-t-1', 'add', [1750, 1760], geometry=poly(5, 0, 15, 10), carve=False,
                    set={'pid': 'ovr:new', 'name': 'New', 'kind': 'state'}),
              entry('h-t-2', 'add', [1700, 1800], geometry=poly(1, 1, 9, 9),
                    set={'pid': 'ovr:nation', 'name': 'Nation', 'kind': 'indigenous'}),
              entry('h-t-3', 'add', [1700, 1800], geometry=poly(2, 2, 3, 3),
                    set={'pid': 'ovr:zone', 'name': 'Zone', 'kind': 'disputed', 'controller': 'clio:a', 'claimants': ['ovr:new']}))
    out, log = O.apply_record_ops([a], ov, FakeCtx())
    check_contract(out)
    r = by_rid(out)
    assert r['clio:a@1700'] is a                                           # untouched object
    assert r['ovr:nation@1700']['tier'] == 1 and r['ovr:nation@1700']['precision'] == 'approximate'
    zone = r['ovr:zone@1700']
    assert zone['tier'] == 1 and zone['disputed'] is True
    assert zone['prov'] == {'overrides': ['h-t-3'], 'controller': 'clio:a', 'claimants': ['ovr:new']}
    assert 'controller' not in zone and 'claimants' not in zone            # not record properties
    assert all(x['status'] == 'applied' for x in log), log


@test
def test_add_precision_exact_for_admin_units():
    ctx = FakeCtx(admin0={'AAA': sq(0, 0, 1, 1)})
    out, _ = O.apply_record_ops([], hist(entry('h-t-1', 'add', [1800, 1810], geometry={'type': 'admin0', 'codes': ['AAA']},
                                               set={'pid': 'ovr:aaa', 'name': 'A', 'kind': 'dependency', 'power': 'clio:empire'})), ctx)
    assert out[0]['precision'] == 'exact' and out[0]['power'] == 'clio:empire' and out[0]['tier'] == 0
    out, _ = O.apply_record_ops([], hist(entry('h-t-2', 'add', [1800, 1810],
                                               geometry={'type': 'difference', 'base': {'type': 'admin0', 'codes': ['AAA']}, 'minus': [poly(0, 0, 0.5, 1)]},
                                               set={'pid': 'ovr:aaa', 'name': 'A', 'kind': 'state', 'precision': 'exact'})), ctx)
    assert out[0]['precision'] == 'exact' and close(out[0]['geometry'].area, 0.5)   # explicit precision wins


@test
def test_add_same_pid_redraws_or_conflicts():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    b = rec('ovr:b', 1700, 1800, sq(40, 40, 50, 50), tier=1, kind='indigenous')
    ov = hist(# a carving tier-0 add re-draws clio:a: its own record keeps only the rest
              entry('h-t-1', 'add', [1750, 1760], geometry=poly(5, 0, 15, 10), set={'pid': 'clio:a', 'name': 'a', 'kind': 'state'}),
              entry('h-t-2', 'add', [1700, 1710], geometry=poly(30, 0, 31, 1), set={'pid': 'clio:a', 'name': 'a', 'kind': 'state'}),
              # tier-1 adds clash with the pid's own tier-0 records (the polity drawn twice) ...
              entry('h-t-3', 'add', [1790, 1800], geometry=poly(1, 1, 2, 2), set={'pid': 'clio:a', 'name': 'a', 'kind': 'indigenous'}),
              # ... but not outside its years, and a pid's tier-1 records never clash
              entry('h-t-4', 'add', [1801, 1810], geometry=poly(1, 1, 2, 2), set={'pid': 'clio:a', 'name': 'a', 'kind': 'indigenous'}),
              entry('h-t-5', 'add', [1750, 1760], geometry=poly(41, 41, 42, 42), set={'pid': 'ovr:b', 'name': 'b', 'kind': 'state'}),
              # a tier-0 add that does not carve would draw clio:a twice as well
              entry('h-t-6', 'add', [1770, 1780], geometry=poly(2, 2, 3, 3), carve=False,
                    set={'pid': 'clio:a', 'name': 'a', 'kind': 'state'}))
    out, log = O.apply_record_ops([a, b], ov, FakeCtx())
    check_contract(out)
    st = statuses(log)
    assert st == {'h-t-1': 'applied', 'h-t-2': 'applied', 'h-t-3': 'error', 'h-t-4': 'applied', 'h-t-5': 'applied',
                  'h-t-6': 'error'}, log
    detail = {x['id']: x['detail'] for x in log}
    assert 're-draws clio:a' in detail['h-t-1'] and 'clio:a@1750' in detail['h-t-1'], detail['h-t-1']
    assert 'clio:a@1761' in detail['h-t-3'] and 'clio:a@1761' in detail['h-t-6']
    r = by_rid(out)
    # clio:a split at the add's years; in 1750..1760 its own record keeps the western half
    assert (r['clio:a@1700']['to'], r['clio:a@1761']['from']) == (1749, 1761)
    assert close(r['clio:a@1700']['geometry'].area, 100) and close(r['clio:a@1761']['geometry'].area, 100)
    assert close(r['clio:a@1750']['geometry'].area, 50) and r['clio:a@1750']['src'] == 'cliopatria'
    new = r['clio:a@1750#2']
    assert (new['from'], new['to'], new['src']) == (1750, 1760, 'override') and close(new['geometry'].area, 100)
    assert r['clio:a@1750']['geometry'].intersection(new['geometry']).area < 1e-9   # never drawn twice
    assert 'clio:a@1700#2' in r                                          # disjoint exclave: second record, '#2'
    assert r['clio:a@1801']['tier'] == 1


@test
def test_unknown_or_dead_target_is_stale():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    ov = hist(entry('h-t-1', 'update', [1750, 1760], target={'pid': 'clio:nobody'}, set={'name': 'x'}),
              entry('h-t-2', 'delete', [1850, 1860], target={'pid': 'clio:a'}),
              entry('h-t-3', 'subtract', [1750, 1760], target={'pid': 'clio:nobody'}, geometry=poly(0, 0, 1, 1)),
              entry('h-t-4', 'add', [1750, 1760], geometry={'type': 'record', 'pid': 'clio:a', 'year': 1900},
                    set={'pid': 'ovr:b', 'name': 'b', 'kind': 'state'}))
    out, log = O.apply_record_ops([a], ov, FakeCtx())
    assert statuses(log) == {'h-t-1': 'stale', 'h-t-2': 'stale', 'h-t-3': 'stale', 'h-t-4': 'stale'}, log
    assert out == [a]


@test
def test_inactive_entries_and_notes_are_skipped():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    ops = [('delete', {'target': {'pid': 'clio:a'}}), ('update', {'target': {'pid': 'clio:a'}, 'set': {'name': 'x'}}),
           ('subtract', {'target': {'pid': 'clio:a'}, 'geometry': poly(0, 0, 5, 5)}),
           ('add', {'geometry': poly(0, 0, 5, 5), 'set': {'pid': 'ovr:x', 'name': 'x', 'kind': 'state'}}),
           ('assign', {'target': {'pid': 'clio:a'}, 'geometry': poly(0, 0, 5, 5)})]
    entries = [entry(f'h-t-{i}-{s}', op, [1750, 1760], status=s, **kw)
               for i, (op, kw) in enumerate(ops) for s in ('proposed', 'known-gap', 'rejected')]
    entries.append(entry('h-t-note', 'note', [1700, 1800]))
    entries.append(entry('h-t-assign', 'assign', [1700, 1800], target={'pid': 'clio:a'}, geometry=poly(0, 0, 5, 5)))
    out, log = O.apply_record_ops([a], hist(*entries), FakeCtx())
    assert out == [a]
    st = statuses(log)
    assert all(v == 'skipped' for v in st.values()) and len(st) == 16, st
    assert 'h-t-assign' not in st                                          # active assigns: apply_assign_ops


@test
def test_op_order_is_delete_update_subtract_add():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    # listed add-first: the add of clio:a replaces the record only because the delete runs
    # before it (otherwise it would re-draw part of it), and the update must not touch the
    # record the add creates
    ov = hist(entry('h-t-1', 'add', [1750, 1760], geometry=poly(0, 0, 4, 4), set={'pid': 'clio:a', 'name': 'Added', 'kind': 'state'}),
              entry('h-t-2', 'subtract', [1700, 1800], target={'pid': 'clio:a'}, geometry=poly(8, 8, 10, 10)),
              entry('h-t-3', 'update', [1700, 1800], target={'pid': 'clio:a'}, set={'name': 'Updated'}),
              entry('h-t-4', 'delete', [1750, 1760], target={'pid': 'clio:a'}))
    out, log = O.apply_record_ops([a], ov, FakeCtx())
    check_contract(out)
    assert [x['id'] for x in log] == ['h-t-4', 'h-t-3', 'h-t-2', 'h-t-1'], log
    assert all(x['status'] == 'applied' for x in log), log
    names = sorted((r['from'], r['to'], r['name'], round(r['geometry'].area, 6)) for r in out)
    assert names == [(1700, 1749, 'Updated', 96.0), (1750, 1760, 'Added', 16.0), (1761, 1800, 'Updated', 96.0)], names


@test
def test_record_geometry_sees_earlier_adds():
    # listed first, but it builds on the polity the second entry adds: the engine reorders
    ov = hist(entry('h-t-1', 'add', [1761, 1770], geometry={'type': 'record', 'pid': 'ovr:p', 'year': 1760},
                    set={'pid': 'ovr:p', 'name': 'P later', 'kind': 'state'}),
              entry('h-t-2', 'add', [1750, 1760], geometry=poly(0, 0, 2, 2), set={'pid': 'ovr:p', 'name': 'P', 'kind': 'state'}))
    out, log = O.apply_record_ops([], ov, FakeCtx())
    check_contract(out)
    assert [x['id'] for x in log] == ['h-t-2', 'h-t-1'] and all(x['status'] == 'applied' for x in log), log
    r = by_rid(out)
    assert r['ovr:p@1761']['geometry'].equals(r['ovr:p@1750']['geometry'])
    assert r['ovr:p@1761']['precision'] == 'exact'                         # a record spec is not hand-drawn


@test
def test_record_geometry_ignores_carving_between_adds():
    # h-t-1 re-draws clio:a over all of clio:b's land in 1750..1760. h-t-2's overlay is
    # defined as clio:b's 1755 record: that must mean clio:b as it stood before the adds
    # (the southern-asia case: occupation zones = Cliopatria's 1943 records x Iran while
    # another entry re-draws Iran over them), whatever order the two entries run in.
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    b = rec('clio:b', 1700, 1800, sq(10, 0, 20, 10))
    redraw = entry('h-t-1', 'add', [1750, 1760], geometry=poly(0, 0, 20, 10), set={'pid': 'clio:a', 'name': 'A', 'kind': 'state'})
    zone = entry('h-t-2', 'add', [1750, 1760], geometry={'type': 'record', 'pid': 'clio:b', 'year': 1755},
                 set={'pid': 'ovr:zone', 'name': 'Zone', 'kind': 'disputed'})
    for entries in ((redraw, zone), (zone, redraw)):
        out, log = O.apply_record_ops([a, b], hist(*entries), FakeCtx())
        check_contract(out)
        assert all(x['status'] == 'applied' for x in log), log
        r = by_rid(out)
        assert 'clio:b@1750' not in r and close(r['clio:b@1761']['geometry'].area, 100)   # carved away then
        assert r['ovr:zone@1750']['tier'] == 1 and close(r['ovr:zone@1750']['geometry'].area, 100)


@test
def test_subtract_and_carve_leftovers():
    # 0.0003 deg = 33 m at the equator: rims of rounded hand-drawn edges, under RIM_WIDTH_M
    assert O.RIM_WIDTH_M == 50.0
    strip = box(20, 0, 20.0003, 1)                                      # a thin part far from any cut
    a = rec('clio:a', 1700, 1800, shapely.union(box(0, 0, 10, 10), strip))
    ov = hist(entry('h-t-1', 'subtract', [1750, 1760], target={'pid': 'clio:a'}, geometry=poly(0.0003, 5, 11, 11)),
              entry('h-t-2', 'subtract', [1750, 1760], target={'pid': 'clio:a'}, geometry=poly(-1, -1, 11, 5)))
    out, log = O.apply_record_ops([a], ov, FakeCtx())
    check_contract(out)
    r = by_rid(out)
    assert all(x['status'] == 'applied' for x in log), log
    # the first subtract leaves the 33 m strip x 0..0.0003, y 5..10 attached to the southern
    # half (one polygon: not a rim yet); the second one cuts it loose and removes it with its area
    assert 'rim' not in log[0]['detail'] and 'with 1 rim(s)' in log[1]['detail'], log
    mid = r['clio:a@1750']['geometry']
    assert len(mid.geoms) == 1 and mid.geoms[0].equals(strip)           # the far thin part stayed

    # a tier-0 add whose edge stops 33 m short of clio:b's border takes the rim in, so
    # clio:b is emptied in those years; a piece left only in the sea is dropped too
    b = rec('clio:b', 1700, 1800, sq(0, 0, 10, 10))
    c = rec('clio:c', 1700, 1800, sq(30, 0, 40, 10))                    # land 30..35, sea 35..40
    ov = hist(entry('h-t-2', 'add', [1750, 1760], geometry=poly(0.0003, 0, 10, 10), set={'pid': 'ovr:n', 'name': 'N', 'kind': 'state'}),
              entry('h-t-3', 'add', [1750, 1760], geometry=poly(30, 0, 35, 10), set={'pid': 'ovr:m', 'name': 'M', 'kind': 'state'}))
    out, log = O.apply_record_ops([b, c], ov, FakeCtx(land=[box(-60, -60, 35, 60)]))
    check_contract(out)
    r = by_rid(out)
    assert statuses(log) == {'h-t-2': 'applied', 'h-t-3': 'applied'}, log
    assert 'took in 1 rim' in log[0]['detail'] and 'without land dropped' in log[1]['detail'], log
    assert 'clio:b@1750' not in r and 'clio:c@1750' not in r            # emptied / only sea left
    assert close(r['ovr:n@1750']['geometry'].area, 100) and close(r['ovr:m@1750']['geometry'].area, 50)
    assert r['clio:b@1761']['geometry'].equals(b['geometry'])           # other years untouched


@test
def test_carve_only_within_years_and_input_untouched():
    a = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10), prov={'islands': 2})
    b = rec('clio:b', 1700, 1800, sq(10, 0, 20, 10))
    before = pickle.dumps([a, b])
    ov = hist(entry('h-t-1', 'add', [1790, 1800], geometry=poly(8, 0, 12, 10), set={'pid': 'ovr:c', 'name': 'C', 'kind': 'state'}))
    out, _ = O.apply_record_ops([a, b], ov, FakeCtx())
    assert pickle.dumps([a, b]) == before                                 # inputs never mutated
    check_contract(out)
    r = by_rid(out)
    assert (r['clio:a@1700']['to'], r['clio:b@1700']['to']) == (1789, 1789)
    assert close(r['clio:a@1790']['geometry'].area, 80) and close(r['clio:b@1790']['geometry'].area, 80)
    assert r['clio:a@1790']['prov'] == {'islands': 2, 'overrides': ['h-t-1']}
    union = shapely.union_all([x['geometry'] for x in out if x['from'] <= 1795 <= x['to']])
    assert close(union.area, 200)                                          # partition preserved:
    assert close(sum(x['geometry'].area for x in out if x['from'] <= 1795 <= x['to']), union.area)   # no overlaps


@test
def test_bad_entries_are_errors():
    ov = hist(entry('h-t-1', 'add', [1750, 1760], geometry=poly(0, 0, 1, 1), set={'pid': 'ovr:x', 'name': 'x'}),
              entry('h-t-2', 'frobnicate', [1750, 1760]),
              entry('h-t-3', 'update', [1750, 1760], target={'pid': 'clio:a'}, set={'colour': 'red'}),
              entry('h-t-4', 'add', [1750, 1760], geometry={'type': 'admin0', 'codes': ['ZZZ']}, set={'pid': 'ovr:y', 'name': 'y', 'kind': 'state'}),
              entry('h-t-5', 'add', [1750, 1760], geometry=poly(0, 0, 1, 1), set={'pid': 'ovr:z', 'name': 'z', 'kind': 'unclaimed'}),
              entry('h-t-6', 'subtract', [1750, 1760], geometry=poly(0, 0, 1, 1)))
    out, log = O.apply_record_ops([rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))], ov, FakeCtx())
    assert all(v == 'error' for v in statuses(log).values()) and len(log) == 6, log
    assert len(out) == 1


# ------------------------------------------------------------------------ assign


def island_world():
    """Mainland 0..20 x 0..10 and an island 30..31 x 0..1; A held the island after the
    automatic island assignment."""
    land = [box(0, 0, 20, 10), box(30, 0, 31, 1)]
    ctx = FakeCtx(land=land)
    a = rec('clio:a', 1700, 1800, shapely.union_all([box(0, 0, 10, 10), box(30, 0, 31, 1)]))
    b = rec('clio:b', 1700, 1800, sq(10, 0, 20, 10))
    return ctx, a, b


@test
def test_assign_gives_rims_of_losers_to_the_target():
    ctx, a, b = island_world()
    # the assigned area stops 33 m short of x = 0 (rounded coordinates): the strip
    # x 0..0.0003 of clio:a's mainland would stay behind as a hair-thin part
    ov = hist(entry('h-t-1', 'assign', [1700, 1800], target={'pid': 'clio:b'}, geometry=poly(0.0003, 0, 10, 10)))
    out, log = O.apply_assign_ops([a, b], (1750, 1760), ov, ctx)
    r = by_rid(out)
    assert log[0]['status'] == 'applied' and 'with 1 rim(s)' in log[0]['detail'], log
    assert close(r['clio:b@1700']['geometry'].area, 200) and close(r['clio:a@1700']['geometry'].area, 1)  # a keeps its island
    assert r['clio:a@1700']['geometry'].intersection(box(0, 0, 0.0003, 10)).area < 1e-12


@test
def test_assign_wins_over_automatic_assignment():
    ctx, a, b = island_world()
    t1 = rec('ovr:nation', 1700, 1800, sq(30, 0, 31, 1), tier=1)
    ov = hist(entry('h-t-1', 'assign', [1700, 1800], target={'pid': 'clio:b'},
                    geometry={'type': 'islands', 'points': [[30.5, 0.5]]}))
    out, log = O.apply_assign_ops([a, b, t1], (1750, 1760), ov, ctx)
    r = by_rid(out)
    assert close(r['clio:b@1700']['geometry'].area, 101) and close(r['clio:a@1700']['geometry'].area, 100)
    assert r['clio:b@1700']['prov'] == {'overrides': ['h-t-1']} and r['clio:a@1700']['prov'] == {'overrides': ['h-t-1']}
    assert r['ovr:nation@1700'] is t1                                      # tier 1 untouched
    assert len(log) == 1 and log[0]['status'] == 'applied' and log[0]['rids'] == ['clio:b@1700', 'clio:a@1700'], log
    assert a['geometry'].area == 101                                        # input not mutated
    # outside its years the entry does nothing and logs nothing
    out2, log2 = O.apply_assign_ops([a, b], (1801, 1810), ov, ctx)
    assert out2 == [a, b] and log2 == []


@test
def test_assign_later_entry_wins_and_clips_to_land():
    ctx, a, b = island_world()
    c = rec('clio:c', 1700, 1800, sq(-1, -1, -0.5, -0.5))                   # unrelated record, not touched
    ov = hist(entry('h-t-1', 'assign', [1700, 1800], target={'pid': 'clio:a'}, geometry=poly(5, -5, 15, 15)),
              entry('h-t-2', 'assign', [1700, 1800], target={'pid': 'clio:b'}, geometry=poly(8, -5, 12, 15)))
    out, log = O.apply_assign_ops([a, b, c], (1700, 1800), ov, ctx)
    r = by_rid(out)
    # h-t-1 gives x 5..15 to A, but the later h-t-2 takes x 8..12 for B; the polygons'
    # sea (y < 0, y > 10) is clipped away. A keeps its island.
    a_geom, b_geom = r['clio:a@1700']['geometry'], r['clio:b@1700']['geometry']
    assert close(a_geom.area, 80 + 30 + 1), a_geom.area                     # x 0..8, 12..15, island
    assert close(b_geom.area, 40 + 50), b_geom.area                         # x 8..12, 15..20
    assert a_geom.intersection(b_geom).area == 0
    assert a_geom.bounds[1] == 0 and b_geom.bounds[3] == 10                 # nothing at sea
    assert r['clio:c@1700'] is c
    assert statuses(log) == {'h-t-1': 'applied', 'h-t-2': 'applied'}
    assert 'to clio:a@1700' in log[0]['detail'] and 'to clio:b@1700' in log[1]['detail']
    assert log[0]['rids'] == ['clio:a@1700', 'clio:b@1700'] and log[1]['rids'] == ['clio:b@1700', 'clio:a@1700'], log


@test
def test_assign_stale_error_and_partial_span():
    ctx, a, b = island_world()
    nation = rec('ovr:nation', 1700, 1800, sq(1, 1, 2, 2), tier=1)
    ov = hist(entry('h-t-1', 'assign', [1700, 1800], target={'pid': 'clio:gone'}, geometry=poly(1, 1, 2, 2)),
              entry('h-t-2', 'assign', [1700, 1800], target={'pid': 'ovr:nation'}, geometry=poly(1, 1, 2, 2)),
              entry('h-t-3', 'assign', [1755, 1800], target={'pid': 'clio:b'}, geometry=poly(1, 1, 2, 2)),
              entry('h-t-4', 'assign', [1700, 1800], target={'pid': 'clio:b'}, geometry=poly(50, 50, 51, 51)),
              entry('h-t-5', 'assign', [1700, 1800], target={'pid': 'clio:b'}, geometry={'type': 'record', 'pid': 'clio:zz', 'year': 1700}))
    out, log = O.apply_assign_ops([a, b, nation], (1750, 1760), ov, ctx)
    assert statuses(log) == {'h-t-1': 'stale', 'h-t-2': 'error', 'h-t-3': 'error', 'h-t-4': 'error', 'h-t-5': 'stale'}, log
    assert 'straddles' in next(x for x in log if x['id'] == 'h-t-3')['detail']
    assert close(by_rid(out)['clio:b@1700']['geometry'].area, 101)          # h-t-3 still applied


@test
def test_assign_can_empty_a_record_and_use_frame_records():
    ctx, a, b = island_world()
    isl = rec('clio:islanders', 1700, 1800, sq(30, 0, 31, 1))
    a2 = rec('clio:a', 1700, 1800, sq(0, 0, 10, 10))
    ov = hist(entry('h-t-1', 'assign', [1700, 1800], target={'pid': 'clio:a'},
                    geometry={'type': 'record', 'pid': 'clio:islanders', 'year': 1750}))
    out, log = O.apply_assign_ops([a2, b, isl], (1750, 1750), ov, ctx)
    r = by_rid(out)
    assert 'clio:islanders@1700' not in r and close(r['clio:a@1700']['geometry'].area, 101)
    assert log[0]['status'] == 'applied' and 'clio:islanders@1700' in log[0]['rids'] and 'removed' in log[0]['detail']


# ------------------------------------------------------------------------ modern


def modern_world():
    """Units AAA (0..10), BBB (10..12), CCC (20..21) and DDD (25..26) on one continent;
    admin-1 halves of AAA. Sovereign AA1 has its home unit AAA (ADMIN == SOVEREIGNT,
    like NE's FR1 -> FRA) and a dependency DDD; BB1 has no home unit."""
    admin0 = {'AAA': sq(0, 0, 10, 10), 'BBB': sq(10, 0, 12, 10), 'CCC': sq(20, 0, 21, 1), 'DDD': sq(25, 0, 26, 1)}
    admin1 = {'AA-W': sq(0, 0, 5, 10), 'AA-E': sq(5, 0, 10, 10)}
    meta = {'AAA': {'name': 'A', 'admin': 'Aland', 'sovereign': 'Aland', 'sovA3': 'AA1', 'type': 'Country'},
            'BBB': {'name': 'B', 'admin': 'B', 'sovereign': 'Bland', 'sovA3': 'BB1', 'type': 'Dependency'},
            'CCC': {'name': 'C', 'admin': 'C', 'sovereign': 'Bland', 'sovA3': 'BB1', 'type': 'Indeterminate'},
            'DDD': {'name': 'D', 'admin': 'D', 'sovereign': 'Aland', 'sovA3': 'AA1', 'type': 'Dependency'}}
    return FakeCtx(land=[box(-1, -1, 30, 11)], admin0=admin0, admin1=admin1), meta


def alive(records, year, tier=0):
    return [r for r in records if r['from'] <= year <= r['to'] and r['tier'] == tier]


def assert_partition(records, ctx, codes, year):
    rs = alive(records, year)
    total = shapely.union_all([ctx.admin0[c] for c in codes])
    assert close(sum(r['geometry'].area for r in rs), total.area, 1e-9), (year, [r['rid'] for r in rs])
    assert close(shapely.union_all([r['geometry'] for r in rs]).area, total.area, 1e-9), year


@test
def test_modern_partition_with_subunits_and_present():
    ctx, meta = modern_world()
    ov = modern_ov(units=[unit('AAA', [period(1990, 'present', 'ne:aaa', 'Unitedland', wikidata='Q1')], subunits=[
        {'id': 'west', 'geometry': {'type': 'admin1', 'codes': ['AA-W']}, 'timeline': [period(1946, 1989, 'ovr:westland', 'Westland')]},
        {'id': 'east', 'geometry': {'type': 'admin1', 'codes': ['AA-E']}, 'timeline': [period(1946, 1989, 'ovr:eastland', 'Eastland')]},
    ])])
    out, log = O.build_modern(ov, ctx, units=['AAA'], meta=meta)
    check_contract(out)
    got = sorted((r['rid'], r['from'], r['to'], r['geometry'].area) for r in out)
    assert got == [('ne:aaa@1990', 1990, PRESENT, 100.0), ('ovr:eastland@1946', 1946, 1989, 50.0),
                   ('ovr:westland@1946', 1946, 1989, 50.0)], got
    for y in (1946, 1989, 1990, PRESENT):
        assert_partition(out, ctx, ['AAA'], y)
    r = by_rid(out)
    assert r['ne:aaa@1990']['src'] == 'naturalearth' and r['ne:aaa@1990']['precision'] == 'exact'
    assert r['ne:aaa@1990']['wikidata'] == 'Q1' and r['ovr:westland@1946']['prov'] == {'units': ['AAA'], 'overrides': ['AAA/west']}
    assert statuses(log) == {'AAA': 'applied'} and set(log[0]['rids']) == set(r)
    assert log[0]['detail'] == (f'ovr:eastland "Eastland" (state) 1946..1989 [east]; ovr:westland "Westland" (state) '
                                f'1946..1989 [west]; ne:aaa "Unitedland" (state) 1990..{PRESENT} -> 3 record(s)'), log[0]['detail']


@test
def test_modern_later_subunit_wins_and_hand_polygon():
    ctx, meta = modern_world()
    ov = modern_ov(units=[unit('AAA', [period(1946, 'present', 'ne:aaa', 'A')], subunits=[
        {'id': 's1', 'geometry': poly(0, 0, 6, 10), 'timeline': [period(1950, 1960, 'ovr:one', 'One')]},
        {'id': 's2', 'geometry': poly(4, 0, 10, 10), 'timeline': [period(1955, 1960, 'ovr:two', 'Two')]},
    ])])
    out, log = O.build_modern(ov, ctx, units=['AAA'], meta=meta)
    check_contract(out)
    got = sorted((r['rid'], r['from'], r['to'], round(r['geometry'].area, 9), r['precision']) for r in out)
    # 1955..1960: s2 (later) wins x 4..6, s1 keeps x 0..4, nothing is left for the unit
    assert got == [('ne:aaa@1946', 1946, 1949, 100.0, 'exact'), ('ne:aaa@1950', 1950, 1954, 40.0, 'exact'),
                   ('ne:aaa@1961', 1961, PRESENT, 100.0, 'exact'),
                   ('ovr:one@1950', 1950, 1954, 60.0, 'approximate'), ('ovr:one@1955', 1955, 1960, 40.0, 'approximate'),
                   ('ovr:two@1955', 1955, 1960, 60.0, 'approximate')], got
    r = by_rid(out)
    assert r['ovr:two@1955']['geometry'].bounds == (4.0, 0.0, 10.0, 10.0)
    assert r['ovr:one@1950']['src'] == 'override' and r['ne:aaa@1950']['src'] == 'naturalearth'
    for y in (1946, 1950, 1955, 1961):
        assert_partition(out, ctx, ['AAA'], y)
    assert statuses(log) == {'AAA': 'applied'}


@test
def test_modern_fallback_unaudited():
    ctx, meta = modern_world()
    out, log = O.build_modern(modern_ov(), ctx, units=['BBB', 'CCC', 'AAA'], meta=meta)
    check_contract(out)
    r = by_rid(out)
    # AA1 maps to its home unit's code (ne:aaa); BB1 has no home unit and is kept as is
    assert set(r) == {'ne:aaa@1946', 'ne:bb1@1946'}
    bb = r['ne:bb1@1946']                                                   # BBB + CCC dissolved per sovereign
    assert (bb['name'], bb['from'], bb['to'], bb['kind']) == ('Bland', 1946, PRESENT, 'state')
    assert close(bb['geometry'].area, 21) and bb['prov'] == {'units': ['BBB', 'CCC'], 'unaudited': ['BBB', 'CCC']}
    assert r['ne:aaa@1946']['name'] == 'Aland'
    st = statuses(log)
    assert st == {'BBB': 'unaudited', 'CCC': 'unaudited', 'AAA': 'unaudited'}, st
    assert next(x for x in log if x['id'] == 'CCC')['rids'] == ['ne:bb1@1946']
    assert 'drawn as Aland (ne:aaa)' in next(x for x in log if x['id'] == 'AAA')['detail']
    # NE type 'Indeterminate' alone -> kind 'other'
    out, _ = O.build_modern(modern_ov(), ctx, units=['CCC'], meta=meta)
    assert out[0]['kind'] == 'other'
    # an unaudited dependency joins its audited sovereign's record (attributes from the audit)
    ov = modern_ov(units=[unit('AAA', [period(1946, 'present', 'ne:aaa', 'Republic of Aland', wikidata='Q7')])])
    out, log = O.build_modern(ov, ctx, units=['AAA', 'DDD'], meta=meta)
    check_contract(out)
    assert [r['rid'] for r in out] == ['ne:aaa@1946'], out
    a = out[0]
    assert (a['name'], a['kind'], a['wikidata']) == ('Republic of Aland', 'state', 'Q7')
    assert close(a['geometry'].area, 101)
    assert a['prov'] == {'units': ['AAA', 'DDD'], 'overrides': ['AAA'], 'unaudited': ['DDD']}, a['prov']
    assert statuses(log) == {'AAA': 'applied', 'DDD': 'unaudited'}, log
    # audited attributes lead over the placeholder of the (unaudited) unit the pid names
    ov = modern_ov(units=[unit('DDD', [period(1946, 'present', 'ne:aaa', 'Republic of Aland', kind='dependency')])])
    out, log = O.build_modern(ov, ctx, units=['AAA', 'DDD'], meta=meta)
    assert [(r['rid'], r['name'], r['kind']) for r in out] == [('ne:aaa@1946', 'Republic of Aland', 'dependency')], out
    assert statuses(log) == {'AAA': 'unaudited', 'DDD': 'applied'}, log


@test
def test_modern_dissolve_merge_rename_unclaimed_overlays():
    ctx, meta = modern_world()
    ctx.disputed = {'B99': sq(11, 0, 12, 1)}
    ov = modern_ov(
        units=[unit('AAA', [period(1946, 1980, 'ovr:union', 'Union'), period(1981, 1991, 'ovr:union', 'Union of States'),
                            period(1992, 'present', 'ne:aaa', 'A')]),
               unit('BBB', [period(1946, 1980, 'ovr:union', 'Union'), period(1981, 1985, 'ovr:union', 'Union of States'),
                            period(1986, 'present', 'ne:bbb', 'B')]),
               unit('CCC', [period(1946, 'present', 'ovr:unclaimed', '', kind='unclaimed')])],
        overlays=[{'id': 'zone', 'geometry': {'type': 'ne-disputed', 'codes': ['B99']}, 'sources': [{'title': 't', 'url': 'https://e.org'}],
                   'timeline': [{'years': [1990, 'present'], 'set': {'name': 'Zone', 'controller': 'ne:bbb', 'claimants': ['ne:aaa']}}]},
                  {'id': 'hand', 'geometry': poly(1, 1, 2, 40), 'sources': [{'title': 't', 'url': 'https://e.org'}],
                   'timeline': [{'years': [1950, 1960], 'set': {'pid': 'ovr:people', 'name': 'People', 'kind': 'indigenous', 'tier': 0}}]}])
    out, log = O.build_modern(ov, ctx, units=['AAA', 'BBB', 'CCC'], meta=meta)
    check_contract(out)
    got = sorted((r['rid'], r['to'], r['name'], r['geometry'].area, r['tier']) for r in out)
    assert got == [('ne:aaa@1992', PRESENT, 'A', 100.0, 0), ('ne:bbb@1986', PRESENT, 'B', 20.0, 0),
                   ('ovr:people@1950', 1960, 'People', 10.0, 1),
                   ('ovr:union@1946', 1980, 'Union', 120.0, 0), ('ovr:union@1981', 1985, 'Union of States', 120.0, 0),
                   ('ovr:union@1986', 1991, 'Union of States', 100.0, 0), ('ovr:zone@1990', PRESENT, 'Zone', 1.0, 1)], got
    assert not [r for r in out if 20 <= r['geometry'].bounds[0] < 22]       # CCC unclaimed: no record
    r = by_rid(out)
    zone, people = r['ovr:zone@1990'], r['ovr:people@1950']
    assert (zone['kind'], zone['disputed'], zone['precision'], zone['src']) == ('disputed', True, 'exact', 'naturalearth')
    assert zone['prov'] == {'overrides': ['zone'], 'controller': 'ne:bbb', 'claimants': ['ne:aaa']}
    assert people['precision'] == 'approximate' and people['src'] == 'override'
    assert people['geometry'].bounds[3] == 11                              # clipped to land (0..11)
    st = statuses(log)
    assert st == {'AAA': 'applied', 'BBB': 'applied', 'CCC': 'applied', 'zone': 'applied', 'hand': 'error'}, log
    assert 'tier 1' in next(x for x in log if x['id'] == 'hand')['detail']


@test
def test_modern_gaps_conflicts_and_slivers():
    ctx, meta = modern_world()
    ctx.admin1['AA-WX'] = sq(0, 0, 5.000002, 10)        # admin-1 outlines that miss a ~0.6 km2 sliver
    ctx.admin1['AA-EX'] = sq(5.000007, 0, 10, 10)       # of the unit (on the 1e-6 deg grid)
    ov = modern_ov(units=[
        unit('AAA', [period(1990, 'present', 'ne:aaa', 'A')], subunits=[
            {'id': 'w', 'geometry': {'type': 'admin1', 'codes': ['AA-WX']}, 'timeline': [period(1946, 1989, 'ovr:w', 'W')]},
            {'id': 'e', 'geometry': {'type': 'admin1', 'codes': ['AA-EX']}, 'timeline': [period(1946, 1979, 'ovr:e', 'E')]}]),
        unit('BBB', [period(1946, 1960, 'ovr:w', 'Westland'), period(1971, 'present', 'ne:bbb', 'B')])])
    out, log = O.build_modern(ov, ctx, units=['AAA', 'BBB'], meta=meta)
    check_contract(out)
    for y in (1946, 1979):                                                  # the sliver joined a neighbour
        assert_partition(out, ctx, ['AAA', 'BBB'], y)
    sliver = box(5.000002, 0, 5.000007, 10)                                  # wholly in one neighbour
    holders = [r['pid'] for r in alive(out, 1946) if r['geometry'].intersection(sliver).area > 4.9e-5]
    assert len(holders) == 1 and holders[0] in ('ovr:w', 'ovr:e'), holders
    st = statuses(log)
    assert st == {'AAA': 'error', 'BBB': 'error'}, log
    detail = {x['id']: x['detail'] for x in log}
    assert '1980..1989' in detail['AAA'] and 'no holder' in detail['AAA'], detail
    conflict = 'ovr:w name differs between units in 1946..1960: "W" (AAA/w) vs "Westland" (BBB)'
    assert conflict in detail['AAA'] and conflict in detail['BBB'], detail
    assert '1961..1970' in detail['BBB'] and 'no holder' in detail['BBB'], detail
    # nobody holds BBB in its gap years, nor AAA's east half in 1980..1989
    assert not [r for r in alive(out, 1965) if r['geometry'].intersection(box(10, 0, 12, 10)).area > 0]
    assert not [r for r in alive(out, 1985) if r['geometry'].intersection(box(6, 0, 10, 10)).area > 0]
    assert sorted(r['pid'] for r in alive(out, 1985)) == ['ne:bbb', 'ovr:w']


@test
def test_modern_real_germany_and_fallback():
    ctx = real()
    west = ['DE-BW', 'DE-BY', 'DE-HB', 'DE-HH', 'DE-HE', 'DE-NI', 'DE-NW', 'DE-RP', 'DE-SH', 'DE-SL']
    east = ['DE-BB', 'DE-BE', 'DE-MV', 'DE-SN', 'DE-ST', 'DE-TH']
    ov = modern_ov(units=[unit('DEU', [period(1946, 1948, 'ovr:allied-occupied-germany', 'Allied-occupied Germany', kind='dependency'),
                                       period(1990, 'present', 'ne:deu', 'Germany')], subunits=[
        {'id': 'west', 'geometry': {'type': 'admin1', 'codes': west}, 'timeline': [period(1949, 1989, 'ovr:west-germany', 'West Germany')]},
        {'id': 'east', 'geometry': {'type': 'admin1', 'codes': east}, 'timeline': [period(1949, 1989, 'ovr:east-germany', 'East Germany')]}])])
    out, log = O.build_modern(ov, ctx, units=['DEU', 'JEY', 'GGY', 'IMN'])
    check_contract(out)
    assert statuses(log) == {'DEU': 'applied', 'JEY': 'unaudited', 'GGY': 'unaudited', 'IMN': 'unaudited'}, log
    deu = C.area_km2(O.snap(ctx.admin0['DEU']))
    for y in (1946, 1949, 1989, 1990):
        rs = [r for r in alive(out, y) if r['pid'] != 'ne:gbr']
        assert abs(sum(C.area_km2(r['geometry']) for r in rs) - deu) < 1e-6 * deu, y
    r = by_rid(out)
    assert 240000 < C.area_km2(r['ovr:west-germany@1949']['geometry']) < 255000
    assert 104000 < C.area_km2(r['ovr:east-germany@1949']['geometry']) < 112000
    # every fallback pid is ne:<an admin-0 code>, also for NE's 'X1' sovereign codes
    meta = M.ne_admin0_meta()
    homes = M.sovereign_homes(meta)
    assert (homes['FR1'], homes['GB1'], homes['US1'], homes['CH1']) == ('FRA', 'GBR', 'USA', 'CHN'), homes
    bad = sorted({p for p in (M.fallback_state(c, meta, homes)['pid'] for c in meta) if p[3:].upper() not in meta})
    assert not bad, bad
    gb = r['ne:gbr@1946']                     # NE SOV_A3 'GB1' -> home unit GBR (ADMIN == SOVEREIGNT)
    assert gb['name'] == 'United Kingdom' and gb['prov']['units'] == ['GGY', 'IMN', 'JEY']


# ----------------------------------------------------------------------- dry run


@test
def test_dry_run_on_fixtures():
    buf = io.StringIO()
    log_path = os.path.join(tempfile.mkdtemp(prefix='alexs-atlas-ovr-'), 'log.json')
    _TMP.append(os.path.dirname(log_path))
    code = O.dry_run(FIXTURES, log_path=log_path, verbose=True, out=buf)
    text = buf.getvalue()
    assert code == 1, text                                                 # h-test-0008 has an unknown code
    with open(log_path, encoding='utf-8') as f:
        st = statuses(json.load(f))
    want = {'e-test-0001': 'applied', 'e-test-0002': 'skipped', 'h-test-0001': 'applied', 'h-test-0002': 'applied',
            'h-test-0003': 'skipped', 'h-test-0004': 'skipped', 'h-test-0005': 'stale', 'h-test-0006': 'skipped',
            'h-test-0007': 'applied', 'h-test-0008': 'error', 'm-test-0001': 'skipped', 'TON': 'applied',
            'fixture-crimea': 'applied', 'DEU': 'unaudited'}
    assert all(st.get(k) == v for k, v in want.items()), {k: (st.get(k), v) for k, v in want.items() if st.get(k) != v}
    assert sum(1 for v in st.values() if v == 'unaudited') == 257
    for needle in ('historical/test-historical.json', 'ERRORS (1)', "unknown admin1 code 'XX-NOPE'", 'STALE (1)',
                   'UNAUDITED modern units (257)', '1 error(s), 1 stale'):
        assert needle in text, (needle, text)
    # --file narrows the report to one file (a bare file name is enough)
    buf = io.StringIO()
    code = O.dry_run(FIXTURES, only_file='test-early.json', skip_modern=True, out=buf)
    text = buf.getvalue()
    assert code == 0 and 'early/test-early.json' in text and 'test-historical' not in text, text
    assert '0 error(s), 0 stale, 1 applied, 1 skipped' in text, text


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
