"""Step 3 (and the clip half of step 4): clip every record to Natural Earth land.

For each record this computes, in parallel:
  clipped     raw footprint ∩ land (grid-snapped; pieces of different land parts are
              disjoint, so they are concatenated without a union)
  coverage    {logical island id: km2 covered} for islands up to
              coast.majorityIslandMaxAreaKm2 (the majority/small-island rules need it)
  clip_area   km2 on land
  clip_status 'ok' | 'nearest-island' | 'lost'

A record whose footprint misses land entirely (typically a small island polity whose
Cliopatria polygon sits a few km off the Natural Earth coast) gets the nearest
logical island when that island is within coast.lostMaxKm, is no larger than
coast.uncoveredIslandMaxAreaKm2 and is unambiguous (the only island that close, or
coast.uncoveredFarRatio times closer than the next); otherwise it is 'lost' and the
QA step fails unless config qa.lostAllowlist names its rid with a reason.
"""
from __future__ import annotations

import math
import os
import time
from collections import defaultdict
from multiprocessing import get_context

import numpy as np
import shapely
from shapely.geometry import MultiPolygon, box

import common as C
import geom as G
import land as L

CFG = C.CONFIG['coast']
MAJ_MAX = float(CFG['majorityIslandMaxAreaKm2'])
UNC_MAX = float(CFG['uncoveredIslandMaxAreaKm2'])
RATIO = float(CFG['uncoveredFarRatio'])
LOST_KM = float(CFG.get('lostMaxKm', 25.0))
BIG_PART_VERTS = 4000   # clip such land parts to the footprint's bbox before intersecting

_LAND: L.Land | None = None


def _init_worker():
    global _LAND
    _LAND = L.Land()


def clip_geometry(raw, land: L.Land) -> tuple[MultiPolygon, dict, float, list[int], list[int]]:
    """(clipped, coverage, km2, parts with land in the footprint, parts wholly inside)
    of a snapped raw footprint."""
    if raw is None or raw.is_empty:
        return G.EMPTY, {}, 0.0, [], []
    shapely.prepare(raw)
    hits = land.tree.query(raw, predicate='intersects')
    pieces, coverage = [], defaultdict(float)
    hit, full = [], []
    total = 0.0
    rb = raw.bounds
    for i in sorted(int(h) for h in hits):
        part = land.parts[i]
        if shapely.contains(raw, part):
            piece = G.mp(part)
            full.append(i)
        else:
            src = part
            if shapely.get_num_coordinates(part) > BIG_PART_VERTS:
                src = shapely.clip_by_rect(part, rb[0] - 0.01, rb[1] - 0.01, rb[2] + 0.01, rb[3] + 0.01)
            piece = G.inter(src, raw)
        if piece.is_empty:
            continue
        hit.append(i)
        a = C.area_km2(piece)
        total += a
        pieces.extend(piece.geoms)
        k = int(land.island_of[i])
        if land.island_area[k] <= MAJ_MAX:
            coverage[k] += a
    return (MultiPolygon(pieces) if pieces else G.EMPTY), dict(coverage), total, hit, full


def nearest_island(raw, land: L.Land) -> tuple[int | None, str]:
    """Logical island to give a record whose footprint has no land, or (None, why)."""
    w, e = G.lon_extent([raw])
    rects = G.window_rects(w, raw.bounds[1], e, raw.bounds[3], LOST_KM)
    cands = set()
    for r in rects:
        cands.update(int(i) for i in land.tree.query(box(*r)))
    frame = G.LocalFrame.around([raw])
    dist: dict[int, float] = {}
    for i in cands:
        d = G.km_distance(raw, land.parts[i], frame)
        k = int(land.island_of[i])
        if d <= LOST_KM and d < dist.get(k, math.inf):
            dist[k] = d
    if not dist:
        return None, f'no land within {LOST_KM:g} km'
    ranked = sorted(dist.items(), key=lambda kv: (kv[1], kv[0]))
    k1, d1 = ranked[0]
    if len(ranked) > 1:
        k2, d2 = ranked[1]
        if d2 < RATIO * d1 or (d1 == 0 and d2 == 0):
            return None, (f'ambiguous: islands {k1} at {d1:.1f} km and {k2} at {d2:.1f} km '
                          f'(need ratio {RATIO:g})')
    if land.island_area[k1] > UNC_MAX:
        return None, (f'nearest land ({land.island_area[k1]:,.0f} km2 at {d1:.1f} km) is larger than '
                      f'{UNC_MAX:g} km2; fix the record with an override')
    return k1, f'given island {k1} ({land.island_area[k1]:,.1f} km2) at {d1:.1f} km'


def _clip_task(batch: list[tuple[int, bytes, bool]]) -> list[tuple]:
    land = _LAND
    out = []
    for i, wkb, blocker in batch:
        raw = shapely.from_wkb(wkb)
        clipped, cov, km2, hit, full = clip_geometry(raw, land)
        status, detail = 'ok', ''
        if clipped.is_empty and blocker:
            status, detail = 'empty', 'blocker without land (nothing to block)'
        elif clipped.is_empty:
            k, detail = nearest_island(raw, land)
            if k is None:
                status = 'lost'
            else:
                status = 'nearest-island'
                clipped = land.island_geom(k)
                km2 = float(land.island_area[k])
                cov = {k: km2} if km2 <= MAJ_MAX else {}
                hit = full = list(land.islands[k])
        out.append((i, shapely.to_wkb(clipped) if not clipped.is_empty else b'', cov, km2, status, detail,
                    hit, full, G.wkb_hash(raw)))
    return out


def clip_records(records: list[dict], workers: int, log=print, label: str = 'clip') -> tuple[list[dict], list[dict]]:
    """Adds clipped / coverage / clip_area / clip_status to every record (in place) and
    returns (records, clip log entries for records that are not plainly 'ok')."""
    t0 = time.time()
    order = sorted(range(len(records)), key=lambda i: -shapely.get_num_coordinates(records[i]['geometry']))
    batches, cur, cur_n = [], [], 0
    for i in order:
        cur.append((i, shapely.to_wkb(records[i]['geometry']), records[i].get('kind') == 'unclaimed'))
        cur_n += 1
        if cur_n >= 16:
            batches.append(cur)
            cur, cur_n = [], 0
    if cur:
        batches.append(cur)
    results = []
    if workers <= 1:
        _init_worker()
        for b in batches:
            results.extend(_clip_task(b))
    else:
        with get_context('spawn').Pool(workers, initializer=_init_worker) as pool:
            for res in pool.imap_unordered(_clip_task, batches):
                results.extend(res)
    steplog = []
    for i, wkb, cov, km2, status, detail, hit, full, raw_hash in results:
        r = records[i]
        r['clipped'] = shapely.from_wkb(wkb) if wkb else G.EMPTY
        r['coverage'] = cov
        r['clip_area'] = km2
        r['clip_status'] = status
        r['parts_hit'] = hit
        r['parts_full'] = full
        r['raw_hash'] = raw_hash
        r['nv'] = int(shapely.get_num_coordinates(r['geometry']))   # frame cost estimate (frames.py)
        if status not in ('ok', 'empty'):
            steplog.append({'rid': r['rid'], 'pid': r['pid'], 'name': r['name'], 'from': r['from'], 'to': r['to'],
                            'tier': r.get('tier', 0), 'status': status, 'detail': detail})
    n_lost = sum(1 for e in steplog if e['status'] == 'lost')
    log(f'[{label}] {len(records)} records clipped to land in {time.time() - t0:.1f} s '
        f'({len(steplog) - n_lost} given their nearest island, {n_lost} lost)')
    return records, steplog
