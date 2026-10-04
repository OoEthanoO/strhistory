"""Alex’s Atlas override engine: applies the sourced manual fixes in
packages/borders/overrides/ to the pipeline's records.

Semantics: packages/borders/AGENTS.md §4 and overrides/schema.json. Records follow
the contract in common.py. Input records are never mutated: a changed record is
replaced by a modified copy.

Public API (the pipeline steps call these):

    load_overrides(root=None) -> ov                      read and normalise every override file
    change_years(ov) -> set[int]                         years in which the overrides change the map
    resolve_geometry(spec, ctx, *, at_year=None)         GeometrySpec -> shapely MultiPolygon
    apply_record_ops(records, ov, ctx) -> (records, log) historical + early: delete -> update -> subtract -> add
    apply_assign_ops(frame_records, span, ov, ctx) -> (frame_records, log)
                                                         'assign' entries for one frame (after islands/coast)
    build_modern(ov, ctx) -> (records, log)              modern layer from unit timelines (modern.py)

A log entry is {'id', 'file', 'op', 'status', 'detail', 'rids'} where status is
    'applied'   the entry changed the data as intended
    'stale'     the data it fixes is not there (target not alive, area no longer
                overlaps the target, 'record' geometry gone): review the entry
    'skipped'   not applied on purpose (status proposed / known-gap / rejected, or a note)
    'error'     cannot be applied as written: fix the entry
build_modern also logs 'unaudited' for Natural Earth units without a modern timeline.
`rids` lists every record id the entry created, changed or removed.

CLI for editors (prints what would be applied, exit code 1 on errors):

    node packages/borders/pipeline/tools/py.mjs overrides.py --dry-run [--file F] [--log out.json] [-v]
"""
from __future__ import annotations

import argparse
import copy
import heapq
import json
import os
import pickle
import sys
import time
import weakref
from collections import Counter, defaultdict
from functools import lru_cache
from typing import Callable, Iterable

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import LineString, MultiPolygon, Polygon, box

import common as C

# Folder order is also the application order of files (oldest years first).
KINDS = ('early', 'historical', 'modern')
RECORD_KINDS = ('early', 'historical')
STATUSES = ('active', 'proposed', 'known-gap', 'rejected')
RECORD_OPS = ('delete', 'update', 'subtract', 'add')  # application order (AGENTS.md §4.1)
ATTRIBUTE_KEYS = ('pid', 'name', 'altNames', 'kind', 'tier', 'power', 'subjecto', 'partof',
                  'wikidata', 'wikipedia', 'precision', 'note')
OPTIONAL_KEYS = ('wikidata', 'wikipedia', 'altNames', 'note')
TIER1_KINDS = ('indigenous', 'disputed')

# Thresholds may be tuned in pipeline/config.json under "overrides" (defaults here).
_CFG = C.CONFIG.get('overrides', {})
# Same-pid tier-0 adds count as disjoint while their overlap on land stays below this.
OVERLAP_NOISE_KM2 = float(_CFG.get('overlapNoiseKm2', 0.5))
# Leftovers of subtract and carve (see _leftovers): new parts thinner than this mean
# width (2 x area / perimeter) are rims, and a record piece with less land than this
# is dropped like an emptied one.
RIM_WIDTH_M = float(_CFG.get('rimWidthM', 50.0))
LAND_NOISE_KM2 = float(_CFG.get('landNoiseKm2', 0.01))


class GeometryError(ValueError):
    """A geometry spec cannot be resolved (unknown code, bad ring, point far from land, ...)."""


class MissingRecordError(GeometryError):
    """A 'record' spec names a polity that has no record alive in that year (logged 'stale')."""


# ------------------------------------------------------------------------------- log


def log_entry(id_, file, op, status, detail='', rids: Iterable[str] = ()) -> dict:
    return {'id': id_, 'file': file, 'op': op, 'status': status, 'detail': detail,
            'rids': list(dict.fromkeys(rids))}


def _elog(e: dict, status: str, detail: str = '', rids: Iterable[str] = ()) -> dict:
    return log_entry(e.get('id'), e.get('_file'), e.get('op'), status, detail, rids)


def _span(lo: int, hi: int) -> str:
    return str(lo) if lo == hi else f'{lo}..{hi}'


# --------------------------------------------------------------------------- loading


def load_overrides(root: str | None = None) -> dict:
    """Read every overrides/{early,historical,modern}/*.json file.

    Returns
        root       the overrides folder
        files      [{file, kind, region, entries, units, overlays}] in application order
        entries    every entry (all statuses, all files) in application order, as a
                   shallow copy with years=(from, to) ints ('present' resolved) and
                   _file ('historical/x.json'), _kind, _index; _error when malformed
        by_status  {'active'|'proposed'|'known-gap'|'rejected': [entries]}
        units      modern units (first definition of each code), years resolved, _file
        overlays   modern overlays, years resolved, _file
        errors     file-level problems as log entries (op 'load', status 'error');
                   apply_record_ops / build_modern repeat them in their logs
    The validator (tools/validate-overrides.mjs) is the place for schema errors; this
    loader only refuses what it cannot apply.
    """
    root = os.path.abspath(root or C.OVERRIDES)
    ov = {'root': root, 'files': [], 'entries': [], 'by_status': {s: [] for s in STATUSES},
          'units': [], 'overlays': [], 'errors': []}
    seen_ids: dict[str, str] = {}
    seen_units: dict[str, str] = {}
    for kind in KINDS:
        folder = os.path.join(root, kind)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.endswith('.json'):
                continue
            rel = f'{kind}/{name}'

            def problem(detail, id_=None, op='load', _rel=rel):
                ov['errors'].append(log_entry(id_, _rel, op, 'error', detail))

            try:
                with open(os.path.join(folder, name), encoding='utf-8') as f:
                    data = json.load(f)
            except (OSError, ValueError) as ex:
                problem(f'cannot read file: {ex}')
                continue
            if not isinstance(data, dict):
                problem('file is not a JSON object')
                continue
            if data.get('kind') != kind:
                problem(f'file is in overrides/{kind}/ but its kind is {data.get("kind")!r}; read as {kind}')
            info = {'file': rel, 'kind': kind, 'region': data.get('region'), 'entries': 0, 'units': 0, 'overlays': 0}
            ov['files'].append(info)
            for i, raw in enumerate(data.get('entries') or []):
                e = _normalise_entry(raw, rel, kind, i)
                if e['id'] in seen_ids:
                    problem(f"duplicate entry id (also in {seen_ids[e['id']]})", e['id'], e.get('op') or 'load')
                else:
                    seen_ids[e['id']] = rel
                ov['entries'].append(e)
                ov['by_status'].setdefault(e.get('status') or 'missing', []).append(e)
                info['entries'] += 1
            if kind != 'modern':
                if data.get('units') or data.get('overlays'):
                    problem('units/overlays are only read from overrides/modern/ files')
                continue
            for i, raw in enumerate(data.get('units') or []):
                u = _normalise_unit(raw, rel, i)
                code = u.get('unit')
                if code in seen_units:
                    problem(f'unit {code} is also defined in {seen_units[code]}; this copy is ignored', code, 'unit')
                    continue
                seen_units[code] = rel
                ov['units'].append(u)
                info['units'] += 1
            for i, raw in enumerate(data.get('overlays') or []):
                ov['overlays'].append(_normalise_overlay(raw, rel, i))
                info['overlays'] += 1
    return ov


def _years(v) -> tuple[int, int]:
    if not isinstance(v, (list, tuple)) or len(v) != 2:
        raise ValueError(f'years must be [from, to], got {v!r}')
    try:
        a, b = C.resolve_year(v[0]), C.resolve_year(v[1])
    except (TypeError, ValueError):
        raise ValueError(f'years must be integers or "present", got {v!r}') from None
    if a == 0 or b == 0:
        raise ValueError(f'years {v!r}: there is no year 0 (-1 = 1 BCE, 1 = 1 CE)')
    if a > b:
        raise ValueError(f'years {v!r} run backwards')
    return a, b


def _normalise_entry(raw, rel: str, kind: str, index: int) -> dict:
    e = dict(raw) if isinstance(raw, dict) else {}
    e.update(_file=rel, _kind=kind, _index=index)
    if not isinstance(raw, dict):
        e['id'] = f'{rel}#{index}'
        e['_error'] = 'entry is not a JSON object'
        return e
    if not e.get('id'):
        e['id'] = f'{rel}#{index}'
        e['_error'] = 'entry has no id'
    try:
        e['years'] = _years(raw.get('years'))
    except ValueError as ex:
        e['_error'] = str(ex)
    return e


def _normalise_periods(periods, where: str, errors: list) -> list[dict]:
    out = []
    for j, p in enumerate(periods or []):
        if not isinstance(p, dict):
            errors.append(f'{where}[{j}] is not an object')
            continue
        q = dict(p)
        try:
            q['years'] = _years(p.get('years'))
        except ValueError as ex:
            errors.append(f'{where}[{j}]: {ex}')
            continue
        out.append(q)
    return out


def _normalise_unit(raw, rel: str, index: int) -> dict:
    u = dict(raw) if isinstance(raw, dict) else {}
    errors: list[str] = []
    u.update(_file=rel, _index=index, _errors=errors)
    if not u.get('unit'):
        u['unit'] = f'{rel}#{index}'
        errors.append('unit has no code')
    u['timeline'] = _normalise_periods(u.get('timeline'), 'timeline', errors)
    subs = []
    for j, s in enumerate(u.get('subunits') or []):
        if not isinstance(s, dict) or not s.get('id'):
            errors.append(f'subunits[{j}] has no id')
            continue
        s = dict(s)
        s['timeline'] = _normalise_periods(s.get('timeline'), f"subunit {s['id']} timeline", errors)
        subs.append(s)
    u['subunits'] = subs
    return u


def _normalise_overlay(raw, rel: str, index: int) -> dict:
    o = dict(raw) if isinstance(raw, dict) else {}
    errors: list[str] = []
    o.update(_file=rel, _index=index, _errors=errors)
    if not o.get('id'):
        o['id'] = f'{rel}#overlay{index}'
        errors.append('overlay has no id')
    o['timeline'] = _normalise_periods(o.get('timeline'), 'timeline', errors)
    return o


def record_entries(ov: dict) -> list[dict]:
    """Entries of historical and early files, in application order."""
    return [e for e in ov.get('entries', []) if e.get('_kind') in RECORD_KINDS]


def _usable(e: dict) -> bool:
    return e.get('status') == 'active' and e.get('op') != 'note' and not e.get('_error')


# ----------------------------------------------------------------------- change years


def change_years(ov: dict) -> set[int]:
    """Years in which the overrides change the map: `from` and `to + 1` (no year 0) of
    every active entry (notes excluded), unit and subunit period and overlay period,
    limited to the dataset's coverage FIRST_YEAR..PRESENT_YEAR. Frames must start at
    these years so that apply_assign_ops sees whole entries."""
    years: set[int] = set()

    def add(span):
        years.add(span[0])
        years.add(C.add_years(span[1], 1))

    for e in ov.get('entries', []):
        if _usable(e):
            add(e['years'])
    for u in ov.get('units', []):
        for p in u.get('timeline', []):
            add(p['years'])
        for s in u.get('subunits', []):
            for p in s.get('timeline', []):
                add(p['years'])
    for o in ov.get('overlays', []):
        for p in o.get('timeline', []):
            add(p['years'])
    return {y for y in years if C.FIRST_YEAR <= y <= C.PRESENT_YEAR}


# ------------------------------------------------------------------ precision grid

# Every overlay runs on the geometry core's precision grid (geom.py, config
# geometry.gridDeg): GEOS snap-rounds each result to it, so a carved record and the
# area carved out of it share identical vertices and no sub-grid slivers or gaps
# appear between neighbours.
GRID = float(C.CONFIG.get('geometry', {}).get('gridDeg', 1e-6))


def snap(g) -> MultiPolygon:
    """g as a valid MultiPolygon on the precision grid."""
    g = C.polygonal(g)
    return g if g.is_empty else C.polygonal(shapely.set_precision(g, GRID))


def _overlay(g) -> MultiPolygon:
    """Polygonal parts of a GEOS overlay result. Overlay output is valid by
    construction, so this skips the validity test common.polygonal makes."""
    if g.is_empty:
        return MultiPolygon()
    if isinstance(g, MultiPolygon):
        return g
    if isinstance(g, Polygon):
        return MultiPolygon([g])
    return C.polygonal(g)  # GeometryCollection (lines/points from touching inputs)


def g_union(geoms: Iterable) -> MultiPolygon:
    gs = [g for g in geoms if g is not None and not g.is_empty]
    if not gs:
        return MultiPolygon()
    if len(gs) == 1:
        return snap(gs[0])
    return _overlay(shapely.union_all(gs, grid_size=GRID))


def g_inter(a, b) -> MultiPolygon:
    if a is None or b is None or a.is_empty or b.is_empty:
        return MultiPolygon()
    return _overlay(shapely.intersection(a, b, grid_size=GRID))


def g_diff(a, b) -> MultiPolygon:
    if a is None or a.is_empty:
        return MultiPolygon()
    if b is None or b.is_empty:
        return snap(a)
    return _overlay(shapely.difference(a, b, grid_size=GRID))


# ------------------------------------------------------------------- geometry specs

_CACHES: 'weakref.WeakKeyDictionary[object, dict]' = weakref.WeakKeyDictionary()


def _cache(ctx) -> dict:
    """Per-ctx cache of resolved specs (NE-based specs never change within a build)."""
    try:
        c = _CACHES.get(ctx)
        if c is None:
            c = _CACHES[ctx] = {}
        return c
    except TypeError:  # ctx cannot be weakly referenced
        return ctx.__dict__.setdefault('_overrides_cache', {})


def spec_key(spec) -> str:
    return json.dumps(spec, sort_keys=True, separators=(',', ':'))


def _walk(spec):
    yield spec
    if isinstance(spec, dict):
        for p in spec.get('parts') or []:
            yield from _walk(p)
        if 'base' in spec:
            yield from _walk(spec['base'])
        for p in spec.get('minus') or []:
            yield from _walk(p)


def record_refs(spec) -> list[tuple[str, int]]:
    """(pid, year) of every 'record' node in a spec."""
    return [(s.get('pid'), s.get('year')) for s in _walk(spec) if isinstance(s, dict) and s.get('type') == 'record']


def is_hand_drawn(spec) -> bool:
    """True when any part of the spec is a hand-authored polygon (precision defaults
    to 'approximate')."""
    return any(isinstance(s, dict) and s.get('type') == 'polygon' for s in _walk(spec))


def resolve_geometry(spec, ctx, *, at_year: int | None = None) -> MultiPolygon:
    """Area described by a GeometrySpec (overrides/schema.json $defs.geometry) as a
    valid shapely MultiPolygon in lon/lat. NOT clipped to land (the pipeline clips).

    admin0       union of ctx.admin0[ADM0_A3]
    admin1       union of admin-1 units by adm1_code or iso_3166_2 (an iso code shared
                 by several NE features, e.g. 'MD-SN', means all of them)
    polygon      hand-authored rings; self-intersections are repaired; a ring whose
                 consecutive vertices are > 180 deg of longitude apart is taken to
                 cross the antimeridian and is split there
    islands      ctx.islands_at(points): whole land parts (points at sea snap <= 5 km),
                 plus their continuation across +/-180 where Natural Earth cuts an
                 island there (Vanua Levu, Wrangel Island, Chukotka)
    ne-disputed  union of ctx.disputed[BRK_A3]
    record       ctx.record_lookup(pid, year); `at_year` stands in when a spec has no
                 year (the schema requires one)
    union / intersection / difference   combinations of the above
    The result is snapped to the precision grid (GRID). Raises GeometryError
    (MissingRecordError for absent records). Specs without 'record' parts are cached
    per ctx.
    """
    cacheable = not any(isinstance(s, dict) and s.get('type') == 'record' for s in _walk(spec))
    if cacheable:
        cache = _cache(ctx)
        key = ('spec', spec_key(spec))
        hit = cache.get(key)
        if hit is not None:
            return hit
    g = snap(_resolve(spec, ctx, at_year))
    if cacheable:
        cache[key] = g
    return g


def _short(x, n: int = 120) -> str:
    s = json.dumps(x, ensure_ascii=True) if not isinstance(x, str) else x
    return s if len(s) <= n else s[:n] + '...'


def _codes(spec: dict) -> list[str]:
    codes = spec.get('codes')
    if not isinstance(codes, list) or not codes:
        raise GeometryError(f"{spec.get('type')} spec needs a non-empty 'codes' list")
    return codes


def _parts(spec: dict) -> list:
    parts = spec.get('parts')
    if not isinstance(parts, list) or not parts:
        raise GeometryError(f"{spec.get('type')} spec needs a non-empty 'parts' list")
    return parts


def _resolve(spec, ctx, at_year):
    if not isinstance(spec, dict) or 'type' not in spec:
        raise GeometryError(f'geometry spec must be an object with a "type": {_short(spec)}')
    t = spec['type']
    if t == 'admin0':
        out = []
        for c in _codes(spec):
            if c not in ctx.admin0:
                raise GeometryError(f'unknown admin0 code {c!r} (ADM0_A3; see .cache/reference/ne-admin0.json)')
            out.append(ctx.admin0[c])
        return g_union(out)
    if t == 'admin1':
        return g_union([_admin1(ctx, c) for c in _codes(spec)])
    if t == 'ne-disputed':
        out = []
        for c in _codes(spec):
            if c not in ctx.disputed:
                raise GeometryError(f'unknown ne-disputed code {c!r} (BRK_A3; see .cache/reference/ne-disputed.json)')
            out.append(ctx.disputed[c])
        return g_union(out)
    if t == 'polygon':
        if 'rings' in spec:
            polys = [spec['rings']]
        elif 'polygons' in spec:
            polys = spec['polygons']
        else:
            raise GeometryError('polygon spec needs "rings" or "polygons"')
        if not isinstance(polys, list) or not polys:
            raise GeometryError('polygon spec has no polygons')
        return g_union([_hand_polygon(rings, i) for i, rings in enumerate(polys)])
    if t == 'islands':
        pts = spec.get('points')
        if not isinstance(pts, list) or not pts:
            raise GeometryError('islands spec needs a non-empty "points" list')
        try:
            pts = [(float(p[0]), float(p[1])) for p in pts]
        except (TypeError, ValueError, IndexError):
            raise GeometryError(f'islands points must be [lon, lat] pairs: {_short(spec["points"])}') from None
        try:
            found = C.polygonal(ctx.islands_at(pts))
        except ValueError as ex:
            raise GeometryError(f'islands: {ex}') from None
        return g_union([found, *_antimeridian_twins(list(found.geoms), ctx)])
    if t == 'record':
        pid = spec.get('pid')
        year = spec.get('year', at_year)
        if not pid or year is None:
            raise GeometryError('record spec needs "pid" and "year"')
        lookup = getattr(ctx, 'record_lookup', None)
        if lookup is None:
            raise GeometryError('record specs need ctx.record_lookup (set by the pipeline)')
        g = lookup(pid, int(year))
        if g is None or g.is_empty:
            raise MissingRecordError(f'no record of {pid} alive in {year}')
        return g
    if t == 'union':
        return g_union([resolve_geometry(p, ctx, at_year=at_year) for p in _parts(spec)])
    if t == 'intersection':
        parts = _parts(spec)
        out = resolve_geometry(parts[0], ctx, at_year=at_year)
        for p in parts[1:]:
            if out.is_empty:
                break
            out = g_inter(out, resolve_geometry(p, ctx, at_year=at_year))
        return out
    if t == 'difference':
        if 'base' not in spec:
            raise GeometryError('difference spec needs "base"')
        minus = spec.get('minus')
        if not isinstance(minus, list) or not minus:
            raise GeometryError('difference spec needs a non-empty "minus" list')
        out = resolve_geometry(spec['base'], ctx, at_year=at_year)
        if out.is_empty:
            return out
        return g_diff(out, g_union([resolve_geometry(p, ctx, at_year=at_year) for p in minus]))
    raise GeometryError(f'unknown geometry type {t!r}')


def _dateline_edges(p) -> list[tuple[int, float, float]]:
    """(side, lat_lo, lat_hi) of every boundary edge of polygon p lying on lon = +180
    (side 1) or -180 (side -1)."""
    out = []
    for ring in [p.exterior, *p.interiors]:
        xy = np.asarray(ring.coords)
        x0, x1 = xy[:-1, 0], xy[1:, 0]
        for side in (1, -1):
            for i in np.nonzero((x0 == 180.0 * side) & (x1 == 180.0 * side))[0]:
                a, b = xy[i, 1], xy[i + 1, 1]
                if a != b:
                    out.append((side, min(a, b), max(a, b)))
    return out


def _antimeridian_twins(parts: list, ctx) -> list:
    """Land parts that continue `parts` across +/-180 (Natural Earth cuts land there),
    transitively: the same joins as the geometry core's logical islands (land.py)."""
    found, seen, todo = [], set(), list(parts)
    while todo:
        p = todo.pop()
        if p.bounds[0] > -180.0 and p.bounds[2] < 180.0:
            continue
        for side, lo, hi in _dateline_edges(p):
            x = -180.0 * side
            for i in ctx.land_tree.query(LineString([(x, lo), (x, hi)])):
                i = int(i)
                if i in seen:
                    continue
                q = ctx.land_parts[i]
                if any(s == -side and min(h, hi) - max(l, lo) > 0 for s, l, h in _dateline_edges(q)):
                    seen.add(i)
                    found.append(q)
                    todo.append(q)
    return found


@lru_cache(maxsize=1)
def _admin1_iso_index() -> dict[str, list[str]]:
    """iso_3166_2 -> every adm1_code carrying it. Ctx.admin1 only keys unique iso
    codes; 60 NE iso codes are shared (e.g. 'MD-SN' Transnistria, 'AU-NSW' + Lord Howe)."""
    rows: list[tuple] = []
    ref = os.path.join(C.REFERENCE, 'ne-admin1.json')
    if os.path.exists(ref):
        with open(ref, encoding='utf-8') as f:
            rows = [(r.get('iso'), r.get('code')) for r in json.load(f)]
    else:
        src = os.path.join(C.NE_DIR, 'ne_10m_admin_1_states_provinces.geojson')
        if os.path.exists(src):
            with open(src, encoding='utf-8') as f:
                rows = [(x['properties'].get('iso_3166_2'), x['properties'].get('adm1_code')) for x in json.load(f)['features']]
    out: dict[str, list[str]] = defaultdict(list)
    for iso, code in rows:
        if iso and iso != '-99' and code:
            out[iso].append(code)
    return dict(out)


def _admin1(ctx, code: str):
    g = ctx.admin1.get(code)
    if g is not None:
        return g
    found = [ctx.admin1[c] for c in _admin1_iso_index().get(code, []) if c in ctx.admin1]
    if found:
        return g_union(found)
    raise GeometryError(f'unknown admin1 code {code!r} (adm1_code or iso_3166_2; see .cache/reference/ne-admin1.json)')


def _crosses_antimeridian(rings: list[list[tuple]]) -> bool:
    return any(abs(a[0] - b[0]) > 180 for ring in rings for a, b in zip(ring, ring[1:] + ring[:1]))


def _hand_polygon(rings, i: int) -> MultiPolygon:
    if not isinstance(rings, list) or not rings:
        raise GeometryError(f'polygon {i} has no rings')
    clean = []
    for j, ring in enumerate(rings):
        try:
            pts = [(float(p[0]), float(p[1])) for p in ring]
        except (TypeError, ValueError, IndexError):
            raise GeometryError(f'polygon {i} ring {j}: positions must be [lon, lat]') from None
        if len(set(pts)) < 3:
            raise GeometryError(f'polygon {i} ring {j} has fewer than 3 distinct positions')
        bad = [p for p in pts if not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90)]
        if bad:
            raise GeometryError(f'polygon {i} ring {j}: position {list(bad[0])} is outside lon -180..180 / lat -90..90')
        clean.append(pts)
    if not _crosses_antimeridian(clean):
        return C.polygonal(Polygon(clean[0], clean[1:]))
    # Unwrap to 0..360, then cut at 180 and shift the eastern overflow back.
    shifted = [[(x + 360 if x < 0 else x, y) for x, y in r] for r in clean]
    p = C.polygonal(Polygon(shifted[0], shifted[1:]))
    east = g_inter(p, box(-180, -90, 180, 90))
    west = affinity.translate(g_inter(p, box(180, -90, 540, 90)), xoff=-360)
    return g_union([east, west])


def clip_to_land(g, ctx) -> MultiPolygon:
    """g ∩ Natural Earth land (land parts are disjoint, so their MultiPolygon is valid)."""
    g = C.polygonal(g)
    if g.is_empty:
        return g
    hits = ctx.land_tree.query(g, predicate='intersects')
    if not len(hits):
        return MultiPolygon()
    parts = [q for i in hits for q in C.polygonal(ctx.land_parts[int(i)]).geoms]
    land = parts[0] if len(parts) == 1 else MultiPolygon(parts)
    return g_inter(g, land)


def _resolve_on_land(spec, ctx, at_year=None) -> MultiPolygon:
    """resolve_geometry(...) clipped to land, cached like resolve_geometry."""
    cacheable = not record_refs(spec)
    key = ('land', spec_key(spec))
    if cacheable:
        hit = _cache(ctx).get(key)
        if hit is not None:
            return hit
    g = clip_to_land(resolve_geometry(spec, ctx, at_year=at_year), ctx)
    if cacheable:
        _cache(ctx)[key] = g
    return g


def _overlap_km2(a, b) -> float:
    if a.is_empty or b.is_empty or not _bbox_hit(a.bounds, b.bounds) or not a.intersects(b):
        return 0.0
    return C.area_km2(g_inter(a, b))


def _mean_width_m(p: Polygon) -> float:
    """2 x area / perimeter in metres (geodesic): about the width of a long strip."""
    area, perimeter = C.GEOD.geometry_area_perimeter(p)
    return 2 * abs(area) / perimeter if perimeter else 0.0


def _land_km2_at_least(g, ctx, enough: float) -> float:
    """Land area of g in km2, stopping once it reaches `enough` (largest parts first)."""
    total = 0.0
    for p in sorted(C.polygonal(g).geoms, key=lambda q: -q.area):
        for i in ctx.land_tree.query(p, predicate='intersects'):
            total += C.area_km2(g_inter(p, C.polygonal(ctx.land_parts[int(i)])))
            if total >= enough:
                return total
    return total


def _leftovers(rest: MultiPolygon, cut, ctx, land_check: bool = True) -> tuple[MultiPolygon | None, list[Polygon]]:
    """What a record keeps after `cut` was taken out of it (rest = record - cut), and
    the rims taken off it: (kept geometry or None, rims).

    Hand-authored polygons follow a record's border only to their rounded coordinates
    (about 0.001 deg), and Cliopatria's polygons spill into the sea, so a subtract, a
    carve or an assign can leave pieces that are not territory:
      rims   parts of `rest` along the edge of the cut (within a few grid cells of it)
             thinner than RIM_WIDTH_M: a subtract removes them with the rest of its
             area, a tier-0 add or an assign gives them to the polity that takes the
             area (they lie along its edge), so no hair-thin strip of the old polity
             is left between neighbours
      sea    (land_check) a piece left with less than LAND_NOISE_KM2 of land is dropped
             like an emptied one (its land would be clipped to nothing and the record lost)
    """
    if rest.is_empty:
        return None, []
    keep, rims = [], []
    for p in rest.geoms:
        # planar width (deg x 111.32 km) bounds the geodesic one from above, cheaply
        if (p.length > 0 and 2 * p.area / p.length * 111320.0 < 2 * RIM_WIDTH_M
                and _mean_width_m(p) < RIM_WIDTH_M and shapely.dwithin(p, cut, 4 * GRID)):
            rims.append(p)
        else:
            keep.append(p)
    kept = MultiPolygon(keep) if rims else rest
    if kept.is_empty or (land_check and _land_km2_at_least(kept, ctx, LAND_NOISE_KM2) < LAND_NOISE_KM2):
        return None, rims
    return kept, rims


def _rims_km2(rims: list[Polygon]) -> float:
    return sum(C.area_km2(p) for p in rims)


def _bbox_hit(p, q) -> bool:
    return p[0] <= q[2] and q[0] <= p[2] and p[1] <= q[3] and q[1] <= p[3]


# -------------------------------------------------------------------------- records


def _is_tier0(r: dict) -> bool:
    return int(r.get('tier') or 0) == 0


def _derive(r: dict, entry_id: str | None = None, **changes) -> dict:
    """Copy of a record (prov deep-copied); entry_id is appended to prov['overrides']."""
    n = dict(r)
    prov = copy.deepcopy(r.get('prov') or {})
    if entry_id is not None:
        ids = prov.setdefault('overrides', [])
        if entry_id not in ids:
            ids.append(entry_id)
    n['prov'] = prov
    n.update(changes)
    return n


class _Work:
    """The record list being edited, with record-id bookkeeping: rid = pid@from, plus
    '#n' only while another live record of the pid starts in the same year (the rid
    of a dropped piece is released)."""

    def __init__(self, records: list[dict]):
        self.records = list(records)
        self.used = {r['rid'] for r in self.records}
        # What 'record' geometry resolves against during the add phase: the records as
        # they stood before the first add plus every record added since, but without
        # the carving adds do to each other (None: the records as edited so far).
        self.geo_view: list[dict] | None = None

    def rid(self, pid: str, start: int) -> str:
        base = rid = f'{pid}@{start}'
        n = 2
        while rid in self.used:
            rid = f'{base}#{n}'
            n += 1
        self.used.add(rid)
        return rid

    def release(self, rid: str) -> None:
        self.used.discard(rid)

    def split(self, r: dict, lo: int, hi: int):
        """Cut r's life at [lo, hi] (clamped to r's life). Returns (head, mid, tail);
        head/tail are None when the range reaches r's ends. The piece that starts with
        r keeps r's rid, later pieces get new rids."""
        lo, hi = max(lo, r['from']), min(hi, r['to'])
        head = tail = None
        if r['from'] < lo:
            head = _derive(r, to=C.add_years(lo, -1))
        mid = _derive(r, **{'from': lo, 'to': hi})
        if head is not None:
            mid['rid'] = self.rid(r['pid'], lo)
        if hi < r['to']:
            start = C.add_years(hi, 1)
            tail = _derive(r, **{'from': start})
            tail['rid'] = self.rid(r['pid'], start)
        return head, mid, tail

    def edit(self, match: Callable[[dict], bool], lo: int, hi: int, change: Callable[[dict], dict | None]):
        """Split every record r with match(r) alive in [lo, hi] at the range ends and
        replace its middle piece by change(mid) (a record, or None to drop it).
        Returns (touched, affected_rids, dropped_rids)."""
        out, affected, dropped = [], [], []
        touched = 0
        for r in self.records:
            if r['to'] < lo or r['from'] > hi or not match(r):
                out.append(r)
                continue
            touched += 1
            head, mid, tail = self.split(r, lo, hi)
            new = change(mid)
            affected.append(r['rid'])
            for piece in (head, new, tail):
                if piece is not None:
                    out.append(piece)
                    affected.append(piece['rid'])
            if new is None:
                dropped.append(mid['rid'])
                affected.append(mid['rid'])
            if new is None or new['rid'] != mid['rid']:
                self.release(mid['rid'])
        self.records = out
        return touched, affected, dropped

    def alive(self, pid: str, lo: int, hi: int) -> list[dict]:
        return [r for r in self.records if r['pid'] == pid and r['from'] <= hi and r['to'] >= lo]

    def lookup(self, fallback):
        """ctx.record_lookup over the records as edited so far, or over geo_view during
        the add phase (tier-0 records of the pid preferred), falling back to the
        pipeline's own lookup."""
        def lookup(pid, year):
            pool = self.records if self.geo_view is None else self.geo_view
            hits = [r for r in pool if r['pid'] == pid and r['from'] <= year <= r['to']]
            if hits:
                base = [r for r in hits if _is_tier0(r)] or hits
                return g_union([r['geometry'] for r in base])
            return fallback(pid, year) if fallback else None
        return lookup


# ------------------------------------------------------------------ record operations


def apply_record_ops(records: list[dict], ov: dict, ctx) -> tuple[list[dict], list[dict]]:
    """Apply the historical and early entries to `records` (normalised source records,
    before clipping to land): all deletes, then updates, subtracts and adds, each in
    file order (early, historical; files sorted). Ops on a target split its records at
    the entry's range ends. Adds are reordered only so that an add whose 'record'
    geometry refers to a polity created by another add runs after it.

    add      defaults: tier 1 for kind indigenous/disputed else 0; precision
             'approximate' for hand-drawn geometry else 'exact'; power = pid;
             src 'override'; prov['overrides'] = [id]. A tier-0 add carves its area
             out of every other tier-0 record alive in its years (unless carve:false),
             the pid's own records included: it re-draws the polity there (logged in
             the detail). A tier-1 or carve:false add is an error when the same pid
             already has an overlapping tier-0 record then (it would draw the polity
             twice); disjoint same-pid records (exclaves) are fine.
    'record' geometry sees the records as edited so far, then ctx.record_lookup; in the
    add phase it sees the records as they stood before the first add plus the records
    added since, but not the carving between adds, so what an add's geometry means
    never depends on another add's side effects (e.g. "Cliopatria's 1943 Soviet
    record intersected with Iran" stays that while another add re-draws Iran then).
    Active 'assign' entries are not applied (and not logged) here: see apply_assign_ops.
    Returns (records, log) with one log entry per other entry plus load errors.
    """
    log = [dict(x) for x in ov.get('errors', []) if (x.get('file') or '').split('/')[0] in RECORD_KINDS]
    pending: dict[str, list[dict]] = {op: [] for op in RECORD_OPS}
    for e in record_entries(ov):
        if e.get('_error'):
            log.append(_elog(e, 'error', e['_error']))
        elif e.get('status') != 'active':
            log.append(_elog(e, 'skipped', f"status {e.get('status')}"))
        elif e.get('op') == 'note':
            log.append(_elog(e, 'skipped', 'note (documentation only)'))
        elif e.get('op') == 'assign':
            continue
        elif e.get('op') in pending:
            pending[e['op']].append(e)
        else:
            log.append(_elog(e, 'error', f"unknown op {e.get('op')!r}"))

    work = _Work(records)
    saved = getattr(ctx, 'record_lookup', None)
    ctx.record_lookup = work.lookup(saved)
    try:
        for e in pending['delete']:
            log.append(_guard(_op_delete, work, e, ctx))
        for e in pending['update']:
            log.append(_guard(_op_update, work, e, ctx))
        for e in pending['subtract']:
            log.append(_guard(_op_subtract, work, e, ctx))
        adds, cyclic = _order_adds(pending['add'])
        for e in cyclic:
            log.append(_elog(e, 'error', "circular 'record' references between adds"))
        work.geo_view = list(work.records)
        for e in adds:
            log.append(_guard(_op_add, work, e, ctx))
    finally:
        work.geo_view = None
        ctx.record_lookup = saved
    return work.records, log


def _guard(fn, work: _Work, e: dict, ctx) -> dict:
    """Run one op; an unexpected exception becomes an 'error' log entry for that entry
    (the records stay as they were before it)."""
    before = (list(work.records), set(work.used), None if work.geo_view is None else list(work.geo_view))
    try:
        return fn(work, e, ctx)
    except Exception as ex:  # noqa: BLE001 - one bad entry must not stop the build
        work.records, work.used, work.geo_view = before
        return _elog(e, 'error', f'{type(ex).__name__}: {ex}')


def _target(e: dict) -> str | None:
    t = e.get('target')
    return t.get('pid') if isinstance(t, dict) else None


def _geometry(e: dict, ctx, at_year: int):
    """Resolve an entry's geometry; returns (geometry, None) or (None, log entry)."""
    if 'geometry' not in e:
        return None, _elog(e, 'error', f"op {e.get('op')} needs a geometry")
    try:
        g = resolve_geometry(e['geometry'], ctx, at_year=at_year)
    except MissingRecordError as ex:
        return None, _elog(e, 'stale', f'geometry: {ex}')
    except GeometryError as ex:
        return None, _elog(e, 'error', f'geometry: {ex}')
    if g.is_empty:
        return None, _elog(e, 'error', 'geometry resolves to an empty area')
    return g, None


def _op_delete(work: _Work, e: dict, ctx) -> dict:
    pid = _target(e)
    if not pid:
        return _elog(e, 'error', 'delete needs target.pid')
    lo, hi = e['years']
    n, affected, dropped = work.edit(lambda r: r['pid'] == pid, lo, hi, lambda mid: None)
    if not n:
        return _elog(e, 'stale', f'target {pid} has no records in {_span(lo, hi)}')
    return _elog(e, 'applied', f'deleted {len(dropped)} record piece(s) of {pid} in {_span(lo, hi)}', affected)


def _op_update(work: _Work, e: dict, ctx) -> dict:
    pid = _target(e)
    s = e.get('set')
    if not pid or not isinstance(s, dict) or not s:
        return _elog(e, 'error', 'update needs target.pid and a non-empty set')
    unknown = sorted(k for k in s if k not in ATTRIBUTE_KEYS and k not in ('controller', 'claimants'))
    if unknown:
        return _elog(e, 'error', f'unknown attribute(s) in set: {", ".join(unknown)}')
    lo, hi = e['years']

    def change(mid):
        new = _derive(mid, e['id'])
        _set_attributes(new, s)
        if s.get('pid') and s['pid'] != pid:
            new['rid'] = work.rid(s['pid'], new['from'])
        return new

    n, affected, _ = work.edit(lambda r: r['pid'] == pid, lo, hi, change)
    if not n:
        return _elog(e, 'stale', f'target {pid} has no records in {_span(lo, hi)}')
    return _elog(e, 'applied', f'updated {n} record(s) of {pid} in {_span(lo, hi)}: {", ".join(sorted(s))}', affected)


def _set_attributes(rec: dict, s: dict) -> None:
    old_pid = rec['pid']
    for k in ATTRIBUTE_KEYS:
        if k in s:
            rec[k] = copy.deepcopy(s[k])
    if 'kind' in s:
        rec['disputed'] = s['kind'] == 'disputed'
    if s.get('pid') and s['pid'] != old_pid and 'power' not in s and rec.get('power') == old_pid:
        rec['power'] = s['pid']  # self-coloured polities stay self-coloured under a new pid
    for k in ('controller', 'claimants'):
        if k in s:
            rec['prov'][k] = copy.deepcopy(s[k])


def _op_subtract(work: _Work, e: dict, ctx) -> dict:
    pid = _target(e)
    if not pid:
        return _elog(e, 'error', 'subtract needs target.pid')
    lo, hi = e['years']
    if not work.alive(pid, lo, hi):
        return _elog(e, 'stale', f'target {pid} has no records in {_span(lo, hi)}')
    g, err = _geometry(e, ctx, lo)
    if err:
        return err
    shapely.prepare(g)
    gb = g.bounds
    removed_km2 = 0.0
    rims: list[Polygon] = []

    def match(r):
        rg = r['geometry']
        return r['pid'] == pid and _bbox_hit(rg.bounds, gb) and g.intersects(rg) and not g.touches(rg)

    def change(mid):
        nonlocal removed_km2
        ng, rim = _leftovers(g_diff(mid['geometry'], g), g, ctx)   # rims go with the area
        rims.extend(rim)
        removed_km2 += C.area_km2(mid['geometry']) - (C.area_km2(ng) if ng is not None else 0.0)
        return None if ng is None else _derive(mid, e['id'], geometry=ng)

    n, affected, dropped = work.edit(match, lo, hi, change)
    if not n:
        return _elog(e, 'stale', f'the area does not overlap {pid} in {_span(lo, hi)}')
    detail = f'removed {removed_km2:.0f} km2 from {n} record(s) of {pid} in {_span(lo, hi)}'
    if rims:
        detail += f' (with {len(rims)} rim(s) thinner than {RIM_WIDTH_M:g} m, {_rims_km2(rims):.2f} km2)'
    if dropped:
        detail += f'; {len(dropped)} record piece(s) emptied or left without land dropped'
    return _elog(e, 'applied', detail, affected)


def _order_adds(adds: list[dict]) -> tuple[list[dict], list[dict]]:
    """Stable topological order: an add whose geometry refers ('record' spec) to a pid
    that another add creates in that year runs after it. Returns (ordered, cyclic)."""
    made: dict[str, list[tuple[int, tuple]]] = defaultdict(list)
    for i, e in enumerate(adds):
        pid = (e.get('set') or {}).get('pid')
        if pid:
            made[pid].append((i, e['years']))
    deps: dict[int, set[int]] = {i: set() for i in range(len(adds))}
    for i, e in enumerate(adds):
        for pid, year in record_refs(e.get('geometry')):
            for j, (a, b) in made.get(pid, []):
                if j != i and isinstance(year, int) and a <= year <= b:
                    deps[i].add(j)
    users: dict[int, list[int]] = defaultdict(list)
    for i, ds in deps.items():
        for j in ds:
            users[j].append(i)
    waiting = {i: len(ds) for i, ds in deps.items()}
    ready = [i for i, n in waiting.items() if n == 0]
    heapq.heapify(ready)
    order = []
    while ready:
        i = heapq.heappop(ready)
        order.append(i)
        for k in users[i]:
            waiting[k] -= 1
            if waiting[k] == 0:
                heapq.heappush(ready, k)
    done = set(order)
    return [adds[i] for i in order], [adds[i] for i in range(len(adds)) if i not in done]


def _op_add(work: _Work, e: dict, ctx) -> dict:
    s = e.get('set') if isinstance(e.get('set'), dict) else {}
    missing = [k for k in ('pid', 'name', 'kind') if not s.get(k)]
    if missing:
        return _elog(e, 'error', f'add needs set.{", set.".join(missing)}')
    unknown = sorted(k for k in s if k not in ATTRIBUTE_KEYS and k not in ('controller', 'claimants'))
    if unknown:
        return _elog(e, 'error', f'unknown attribute(s) in set: {", ".join(unknown)}')
    if s['kind'] == 'unclaimed':
        return _elog(e, 'error', "kind 'unclaimed' is only for modern unit periods; use subtract to leave land unclaimed")
    pid, (lo, hi) = s['pid'], e['years']
    g, err = _geometry(e, ctx, lo)
    if err:
        return err
    tier = int(s.get('tier', 1 if s['kind'] in TIER1_KINDS else 0))
    carves = tier == 0 and e.get('carve', True) is not False
    # The pid's own tier-0 records alive in the add's years that overlap it on land. A
    # carving tier-0 add takes its area out of *every* other tier-0 record (section 3 of
    # packages/borders/AGENTS.md), the pid's own included, so it re-draws the polity
    # there and the old record keeps only what lies outside the added area. Any other
    # add (tier 1, or carve: false) would draw the polity twice over the same land.
    own, g_land = [], None
    for r in work.alive(pid, lo, hi):
        if _is_tier0(r) and _bbox_hit(r['geometry'].bounds, g.bounds):
            # Overlap counted on land only: raw source polygons often spill into the sea.
            g_land = clip_to_land(g, ctx) if g_land is None else g_land
            km2 = _overlap_km2(clip_to_land(r['geometry'], ctx), g_land)
            if km2 > OVERLAP_NOISE_KM2:
                own.append(f"{r['rid']} ({km2:.0f} km2)")
    more = f' (+{len(own) - 5} more)' if len(own) > 5 else ''
    if own and not carves:
        return _elog(e, 'error', f'{pid} already has overlapping tier-0 records in {_span(lo, hi)}: '
                                 f'{", ".join(own[:5])}{more}. A tier-1 or carve:false add would draw '
                                 f'{pid} twice over the same land: make the added area disjoint (exclave), '
                                 f'use a tier-0 add that carves (it re-draws {pid} there), or delete first')
    carved, dropped, rims = [], [], []
    if carves:
        shapely.prepare(g)
        gb = g.bounds

        def match(r):
            rg = r['geometry']
            return (_is_tier0(r) and _bbox_hit(rg.bounds, gb)
                    and g.intersects(rg) and not g.touches(rg))

        def change(mid):
            ng, rim = _leftovers(g_diff(mid['geometry'], g), g, ctx)
            rims.extend(rim)
            return None if ng is None else _derive(mid, e['id'], geometry=ng)

        _, carved, dropped = work.edit(match, lo, hi, change)
        if rims:  # hair-thin leftovers along the added area's edge belong to it
            g = g_union([g, *rims])
    rec = {
        'rid': work.rid(pid, lo), 'pid': pid, 'name': s['name'], 'from': lo, 'to': hi,
        'kind': s['kind'], 'tier': tier, 'power': s.get('power') or pid,
        'partof': s.get('partof'), 'subjecto': s.get('subjecto'), 'disputed': s['kind'] == 'disputed',
        'precision': s.get('precision') or ('approximate' if is_hand_drawn(e['geometry']) else 'exact'),
        'src': 'override', 'geometry': g, 'prov': {'overrides': [e['id']]},
    }
    for k in OPTIONAL_KEYS:
        if s.get(k) is not None:
            rec[k] = copy.deepcopy(s[k])
    for k in ('controller', 'claimants'):
        if k in s:
            rec['prov'][k] = copy.deepcopy(s[k])
    work.records.append(rec)
    if work.geo_view is not None:
        work.geo_view.append(rec)
    detail = f"added {rec['rid']} ({C.area_km2(g):.0f} km2, tier {tier}, {rec['precision']})"
    if tier == 0:
        n = len({x.split('@')[0] for x in carved})
        detail += f"; carved from {n} {'polity' if n == 1 else 'polities'}" if carved else '; nothing to carve'
        if rims:
            detail += f'; took in {len(rims)} rim(s) thinner than {RIM_WIDTH_M:g} m ({_rims_km2(rims):.2f} km2)'
        if dropped:
            detail += f'; {len(dropped)} record piece(s) emptied or left without land dropped'
        if own:
            detail += f'; re-draws {pid} over its own record(s) {", ".join(own[:5])}{more}'
        if e.get('carve') is False:
            detail += ' (carve: false)'
    return _elog(e, 'applied', detail, [rec['rid'], *carved])


# --------------------------------------------------------------------------- assign


def apply_assign_ops(frame_records: list[dict], span, ov: dict, ctx) -> tuple[list[dict], list[dict]]:
    """Apply the active 'assign' entries whose years cover the frame `span` = (from, to)
    to the records of that frame (after clipping and automatic island/coast
    assignment, so assigns always win).

    Each entry's area (clipped to land) goes to the target's tier-0 record in the
    frame (its largest one when there are several) and is removed from every other
    tier-0 record; tier-1 records are untouched. Where entries overlap, the later one
    (file order) wins. Targets are looked up in the frame before any entry is applied.
    A target with no record in the frame is 'stale'; one with only tier-1 records is
    an 'error' (assign works on the tier-0 partition). An entry that only partly
    overlaps the span is applied but logged 'error' (frames must start at
    change_years(ov)). Records emptied by an assign are dropped. 'record' geometry
    inside the span is looked up in the frame, otherwise via ctx.record_lookup.
    Returns (frame_records, log) with one log entry per entry overlapping the span.
    """
    f, t = int(span[0]), int(span[1])
    records = list(frame_records)
    entries = [e for e in record_entries(ov) if e.get('op') == 'assign' and _usable(e)
               and e['years'][0] <= t and e['years'][1] >= f]
    if not entries:
        return records, []
    log: list[dict] = []
    todo: list[tuple[dict, int, MultiPolygon, str]] = []  # (entry, target index, area, note)
    saved = getattr(ctx, 'record_lookup', None)
    ctx.record_lookup = _frame_lookup(records, f, t, saved)
    try:
        for e in entries:
            lo, hi = e['years']
            note = '' if lo <= f and t <= hi else f'frame {_span(f, t)} straddles the entry years {_span(lo, hi)}; applied anyway: '
            pid = _target(e)
            if not pid:
                log.append(_elog(e, 'error', 'assign needs target.pid'))
                continue
            idx = [i for i, r in enumerate(records) if r['pid'] == pid and _is_tier0(r)]
            if not idx:
                if any(r['pid'] == pid for r in records):
                    log.append(_elog(e, 'error', f'{note}{_span(f, t)}: target {pid} has only tier-1 records; assign gives tier-0 area'))
                else:
                    log.append(_elog(e, 'stale', f'{note}{_span(f, t)}: target {pid} is not alive'))
                continue
            try:
                g = _resolve_on_land(e.get('geometry'), ctx, at_year=f) if 'geometry' in e else None
            except MissingRecordError as ex:
                log.append(_elog(e, 'stale', f'{note}{_span(f, t)}: geometry: {ex}'))
                continue
            except GeometryError as ex:
                log.append(_elog(e, 'error', f'geometry: {ex}'))
                continue
            if g is None or g.is_empty:
                log.append(_elog(e, 'error', 'assign geometry is missing or not on land'))
                continue
            ti = max(idx, key=lambda i: records[i]['geometry'].area)
            todo.append((e, ti, g, note))
    finally:
        ctx.record_lookup = saved
    if not todo:
        return records, log

    # Later entries win: each entry keeps only the part no later entry assigns.
    effective: list[MultiPolygon] = [MultiPolygon()] * len(todo)
    covered = MultiPolygon()
    for k in range(len(todo) - 1, -1, -1):
        g = todo[k][2]
        effective[k] = g_diff(g, covered)
        covered = g_union([covered, g])
    shapely.prepare(covered)
    targets: dict[int, list[int]] = defaultdict(list)  # record index -> todo indexes
    for k, (_, ti, _, _) in enumerate(todo):
        targets[ti].append(k)

    took: dict[int, list[str]] = defaultdict(list)     # todo index -> rids that lost area
    gone: dict[int, list[str]] = defaultdict(list)     # todo index -> rids emptied
    rims: dict[int, list[Polygon]] = defaultdict(list)  # todo index -> rims taken off losers
    at: dict[int, int] = {}                             # target record index -> its index in out
    out: list[dict] = []
    for i, r in enumerate(records):
        if not _is_tier0(r):
            out.append(r)
            continue
        rg = r['geometry']
        mine = targets.get(i, [])
        if not mine and (not _bbox_hit(rg.bounds, covered.bounds) or not covered.intersects(rg)
                         or covered.touches(rg)):  # no common area: keep the record as it is
            out.append(r)
            continue
        rest = g_diff(rg, covered)
        losers = [k for k in range(len(todo)) if k not in mine and not effective[k].is_empty
                  and _bbox_hit(effective[k].bounds, rg.bounds) and effective[k].intersects(rg)
                  and not effective[k].touches(rg)]
        if mine:
            ng = g_union([rest, *(effective[k] for k in mine)])
        else:
            # a loser's hair-thin leftovers along an assigned area go with it (_leftovers;
            # the records are on land already)
            kept, rim = _leftovers(rest, covered, ctx, land_check=False)
            ng = kept if kept is not None else MultiPolygon()
            for p in rim:
                k = next((k for k in losers if shapely.dwithin(p, effective[k], 4 * GRID)), None)
                if k is not None:
                    rims[k].append(p)
        if ng.is_empty:
            for k in (*mine, *losers):
                gone[k].append(r['rid'])
            continue
        new = _derive(r, geometry=ng)
        ids = new['prov'].setdefault('overrides', [])
        for k in sorted(set(mine) | set(losers)):
            if todo[k][0]['id'] not in ids:
                ids.append(todo[k][0]['id'])
        if mine:
            at[i] = len(out)
        out.append(new)
        for k in losers:
            took[k].append(r['rid'])
    for k, ps in rims.items():
        j = at.get(todo[k][1])
        if j is not None:
            out[j] = dict(out[j], geometry=g_union([out[j]['geometry'], *ps]))

    for k, (e, ti, g, note) in enumerate(todo):
        tr = records[ti]
        km2 = C.area_km2(effective[k])
        detail = f'{note}{_span(f, t)}: {km2:.1f} km2 to {tr["rid"]}'
        if effective[k].is_empty:
            detail += ' (all of it re-assigned by later entries)'
        if took[k]:
            detail += f'; taken from {len(took[k])} record(s)'
        if rims[k]:
            detail += f'; with {len(rims[k])} rim(s) thinner than {RIM_WIDTH_M:g} m ({_rims_km2(rims[k]):.2f} km2)'
        if gone[k]:
            detail += f'; removed emptied record(s): {", ".join(gone[k][:5])}'
        log.append(_elog(e, 'error' if note else 'applied', detail, [tr['rid'], *took[k], *gone[k]]))
    return out, log


def _frame_lookup(records: list[dict], f: int, t: int, fallback):
    def lookup(pid, year):
        if f <= year <= t:
            hits = [r for r in records if r['pid'] == pid]
            if hits:
                base = [r for r in hits if _is_tier0(r)] or hits
                return g_union([r['geometry'] for r in base])
        return fallback(pid, year) if fallback else None
    return lookup


# --------------------------------------------------------------------------- modern


def build_modern(ov: dict, ctx, *, units: Iterable[str] | None = None, meta: dict | None = None):
    """Modern layer (1946..present) from the unit timelines; see modern.build_modern.
    `units` limits the build to some ADM0_A3 codes (previews, tests); `meta` replaces
    the Natural Earth admin-0 attributes ({code: {sovereign, sovA3, type, name}})."""
    import modern  # deferred: modern.py imports this module
    return modern.build_modern(ov, ctx, units=units, meta=meta)


# ---------------------------------------------------------------------------- dry run


def _reference_records() -> list[dict] | None:
    """Cliopatria leaf polities from .cache/reference (raw, unclipped) in the record
    contract, standing in for the pipeline's normalised records in a dry run."""
    inv_path = os.path.join(C.REFERENCE, 'cliopatria-inventory.json')
    geo_path = os.path.join(C.REFERENCE, 'cliopatria-geoms.pkl')
    if not (os.path.exists(inv_path) and os.path.exists(geo_path)):
        return None
    with open(inv_path, encoding='utf-8') as f:
        inv = json.load(f)
    with open(geo_path, 'rb') as f:
        wkb = pickle.load(f)
    leaf = [r for r in inv if r['type'] == 'POLITY' and not r['pid'].startswith('clio:group-')]
    geoms = shapely.from_wkb([wkb[r['rid']] for r in leaf])
    out = []
    for r, g in zip(leaf, geoms):
        rec = {'rid': r['rid'], 'pid': r['pid'], 'name': r['name'], 'from': r['from'], 'to': r['to'],
               'kind': 'state', 'tier': 0, 'power': r['pid'], 'partof': r.get('memberOf'), 'subjecto': None,
               'disputed': False, 'precision': 'exact', 'src': 'cliopatria', 'geometry': C.polygonal(g), 'prov': {}}
        for k in ('wikidata', 'wikipedia'):
            if r.get(k):
                rec[k] = r[k]
        out.append(rec)
    return out


def _check_assigns(records: list[dict], ov: dict, ctx) -> list[dict]:
    """Dry-run stand-in for apply_assign_ops (no frames yet): resolve each active
    assign's geometry and check that its target has tier-0 records for all its years."""
    log = []
    by_pid: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        by_pid[r['pid']].append(r)
    saved = getattr(ctx, 'record_lookup', None)
    ctx.record_lookup = _Work(records).lookup(saved)
    try:
        for e in record_entries(ov):
            if e.get('op') != 'assign':
                continue
            if e.get('_error'):
                log.append(_elog(e, 'error', e['_error']))
                continue
            if e.get('status') != 'active':
                log.append(_elog(e, 'skipped', f"status {e.get('status')}"))
                continue
            pid, (lo, hi) = _target(e), e['years']
            if not pid:
                log.append(_elog(e, 'error', 'assign needs target.pid'))
                continue
            try:
                g = _resolve_on_land(e.get('geometry'), ctx, at_year=lo) if 'geometry' in e else None
            except MissingRecordError as ex:
                log.append(_elog(e, 'stale', f'geometry: {ex}'))
                continue
            except GeometryError as ex:
                log.append(_elog(e, 'error', f'geometry: {ex}'))
                continue
            if g is None or g.is_empty:
                log.append(_elog(e, 'error', 'assign geometry is missing or not on land'))
                continue
            spans = sorted((max(r['from'], lo), min(r['to'], hi)) for r in by_pid.get(pid, [])
                           if _is_tier0(r) and r['from'] <= hi and r['to'] >= lo)
            gaps, y = [], lo
            for a, b in spans:
                if a > y:
                    gaps.append((y, C.add_years(a, -1)))
                y = max(y, C.add_years(b, 1))
            if y <= hi:
                gaps.append((y, hi))
            area = f'{C.area_km2(g):.1f} km2'
            if not spans:
                log.append(_elog(e, 'stale', f'target {pid} has no tier-0 records in {_span(lo, hi)}'))
            elif gaps:
                log.append(_elog(e, 'stale', f'{area} to {pid}; target missing in {", ".join(_span(a, b) for a, b in gaps)}'))
            else:
                log.append(_elog(e, 'applied', f'would assign {area} to {pid} in {_span(lo, hi)}'))
    finally:
        ctx.record_lookup = saved
    return log


def dry_run(root: str | None = None, *, only_file: str | None = None, skip_modern: bool = False,
            log_path: str | None = None, verbose: bool = False, out=None) -> int:
    """Apply every override to the reference data and print a report. Returns 1 when
    any entry has status 'error', else 0."""
    out = out or sys.stdout
    say = lambda s='': print(s, file=out)  # noqa: E731
    t0 = time.time()
    ov = load_overrides(root)
    ctx = C.Ctx()
    by_kind = Counter(f['kind'] for f in ov['files'])
    statuses = Counter(e.get('status') for e in ov['entries'])
    say(f'Override dry run ({os.path.relpath(ov["root"], C.ROOT).replace(os.sep, "/")})')
    by_status = ', '.join(f'{s} {statuses[s]}' for s in STATUSES if statuses[s])
    say(f"files: {len(ov['files'])} (" + ', '.join(f'{k} {by_kind[k]}' for k in KINDS) + ')'
        f" | entries: {len(ov['entries'])}" + (f' ({by_status})' if by_status else '')
        + f" | modern units: {len(ov['units'])} | overlays: {len(ov['overlays'])}")

    log: list[dict] = []
    records = _reference_records()
    if records is None:
        say('! .cache/reference is missing: run `npm run data:reference` (historical/early entries not checked)')
    else:
        say(f'historical/early entries applied to {len(records)} Cliopatria leaf records (.cache/reference, unclipped)')
        t = time.time()
        records, rlog = apply_record_ops(records, ov, ctx)
        log += rlog
        log += _check_assigns(records, ov, ctx)
        say(f'  record ops + assign checks: {time.time() - t:.1f} s')
    if not skip_modern:
        t = time.time()
        mrecords, mlog = build_modern(ov, ctx)
        log += mlog
        say(f'modern layer: {len(mrecords)} records from {len(ctx.admin0)} Natural Earth units in {time.time() - t:.1f} s')

    want = (only_file or '').replace('\\', '/')

    def wanted(file: str | None) -> bool:
        """--file accepts 'southern-asia.json', 'historical/southern-asia.json' or a full path."""
        if not want:
            return True
        return bool(file) and (file == want or want.endswith('/' + file) or file.endswith('/' + want))

    shown = [x for x in log if wanted(x.get('file'))]
    if want and not shown:
        say(f'! no log entries for --file {only_file} (known files: {", ".join(f["file"] for f in ov["files"])})')
    table: dict[tuple, Counter] = defaultdict(Counter)
    for x in shown:
        table[(x.get('file') or '(natural earth)', x.get('op') or '?')][x['status']] += 1
    cols = ['applied', 'stale', 'skipped', 'error', 'unaudited']
    say()
    say(f"{'file':44s} {'op':9s}" + ''.join(f'{c:>10s}' for c in cols))
    for (file, op), c in sorted(table.items()):
        say(f'{file:44s} {op:9s}' + ''.join(f'{c[k] or "-":>10}' for k in cols))
    totals = Counter(x['status'] for x in shown)
    say(f"{'total':44s} {'':9s}" + ''.join(f'{totals[k] or "-":>10}' for k in cols))

    def listing(status, title, limit=None):
        rows = [x for x in shown if x['status'] == status]
        if not rows:
            return
        say()
        say(f'{title} ({len(rows)})')
        for x in rows[:limit]:
            say(f"  {x.get('id')}  [{x.get('file') or '-'} {x.get('op')}]  {x.get('detail')}")
        if limit and len(rows) > limit:
            say(f'  ... {len(rows) - limit} more (use --log)')

    listing('error', 'ERRORS')
    listing('stale', 'STALE')
    unaudited = [x['id'] for x in shown if x['status'] == 'unaudited']
    if unaudited:
        say()
        say(f'UNAUDITED modern units ({len(unaudited)}), drawn as their Natural Earth sovereign 1946..present:')
        line = ' '
        for code in unaudited:
            if len(line) + len(code) > 100:
                say(line)
                line = ' '
            line += ' ' + code
        say(line)
    if verbose:
        listing('applied', 'APPLIED')
        listing('skipped', 'SKIPPED')
    if log_path:
        with open(log_path, 'w', encoding='utf-8') as f:
            json.dump(shown, f, ensure_ascii=False, indent=1)
        say()
        say(f'log written to {log_path}')
    say()
    say(f"{totals['error']} error(s), {totals['stale']} stale, {totals['applied']} applied, "
        f"{totals['skipped']} skipped, {totals['unaudited']} unaudited unit(s) - {time.time() - t0:.1f} s")
    return 1 if totals['error'] else 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog='overrides.py', description='Alex’s Atlas override engine.')
    ap.add_argument('--dry-run', action='store_true',
                    help='apply all overrides to the reference data and report what would be applied')
    ap.add_argument('--root', help='overrides folder (default: packages/borders/overrides)')
    ap.add_argument('--file', help='report only this override file (all files are still applied: entries can depend on each other)')
    ap.add_argument('--skip-modern', action='store_true', help='do not build the modern layer')
    ap.add_argument('--log', help='write the (reported) log as JSON to this path')
    ap.add_argument('-v', '--verbose', action='store_true', help='also list applied and skipped entries')
    a = ap.parse_args(argv)
    if not a.dry_run:
        ap.print_help()
        return 2
    return dry_run(a.root, only_file=a.file, skip_modern=a.skip_modern, log_path=a.log, verbose=a.verbose)


if __name__ == '__main__':
    # Run through the importable module so modern.py and this script share one copy
    # of the classes (GeometryError etc.).
    import overrides as _self
    sys.exit(_self.main())
