"""Step 5 of the geometry build: frames, the coast step for every frame, and the
merge of consecutive identical frames into feature runs.

frames    every record's `from` and `to + 1` plus overrides.change_years(ov), the
          first year and the cut-over (historical numbering, no year 0). Frame i
          spans [frames[i], frames[i+1] - 1]; no record starts or ends inside a span.
blocks    contiguous runs of frames, one pool task each, balanced by an estimated
          cost. A worker runs the coast step (coast.FrameEngine) over a block in time
          order, so its content-keyed caches carry over from frame to frame.
runs      per block, each record's geometry as a run of consecutive frames with
          identical geometry (same engine token, same normalised-WKB hash, or a
          symmetric difference below MERGE_TOL_KM2); unclaimed land as one run per
          connected polygon. Geometry is written once per run to a WKB file per
          block; area, label point and bbox are computed once per run.
merge     runs of the same record (or the same unclaimed polygon) that meet at a
          block boundary are joined in the parent (merge_runs).
pairs     per frame, tier-0 polities whose geometries intersect: the overlap area
          (QA: none above qa.overlapMaxKm2) and the shared border length, which
          weights the colour graph of powers (attributes.py). Polities closer than
          palette.nearDeg without touching (across a strait: Korea and Japan) add a
          light edge (palette.nearWeightKm), so that neighbours across water also
          differ in colour when the palette allows it.
samples   for the QA sample years: unclaimed share per audit region, islands
          assigned per rule and region, the largest unclaimed islands.
"""
from __future__ import annotations

import math
import os
import time
import traceback
from collections import Counter, defaultdict
from multiprocessing import get_context

import numpy as np
import shapely
import shapely.ops
from shapely import STRtree

import coast as K
import common as C
import geom as G
import land as L
import store as S

FRAMES_DIR = os.path.join(C.BUILD, 'geom', 'frames')
QA_CFG = C.CONFIG.get('qa', {})
MERGE_TOL_KM2 = 1e-6                                        # "identical geometry" (task contract)
OVERLAP_MAX_KM2 = float(QA_CFG.get('overlapMaxKm2', 0.5))   # QA hard limit for tier-0 overlaps
LABEL_TOL_DEG = 0.01                                        # polylabel precision (about 1 km)
PAL_CFG = C.CONFIG.get('palette', {})
NEAR_DEG = float(PAL_CFG.get('nearDeg', 1.0))               # "near across water" for colouring
NEAR_WEIGHT_KM = float(PAL_CFG.get('nearWeightKm', 25.0))   # its weight, as km of shared border
NEAR_SIMPLIFY_DEG = 0.02


# ------------------------------------------------------------------------- frames


def years_in(f: int, t: int) -> int:
    """Number of years in [f, t] (historical numbering: there is no year 0)."""
    return t - f + 1 - (1 if f < 0 < t else 0)


def frame_years(metas: list[dict], extra=(), lo: int = C.FIRST_YEAR, hi: int = C.PRESENT_YEAR) -> list[int]:
    """Sorted change years within [lo, hi]: lo, the cut-over, every record's from and
    to + 1, and `extra` (overrides.change_years)."""
    ys = {lo}
    if lo <= C.CUTOVER_YEAR <= hi:
        ys.add(C.CUTOVER_YEAR)
    for m in metas:
        ys.add(int(m['from']))
        ys.add(C.add_years(int(m['to']), 1))
    ys.update(int(y) for y in extra)
    out = sorted(y for y in ys if lo <= y <= hi)
    assert 0 not in out
    return out


def spans_of(frames: list[int], last: int = C.PRESENT_YEAR) -> list[tuple[int, int]]:
    return [(f, C.add_years(frames[k + 1], -1) if k + 1 < len(frames) else last) for k, f in enumerate(frames)]


def plan_blocks(spans: list[tuple[int, int]], costs: list[float], n_blocks: int, max_frames: int = 40) -> list[list[int]]:
    """Contiguous blocks of frame indices of about equal total cost."""
    if not spans:
        return []
    target = max(sum(costs) / max(n_blocks, 1), 1e-9)
    blocks, cur, acc = [], [], 0.0
    for k, c in enumerate(costs):
        if cur and (acc + c > target * 1.05 or len(cur) >= max_frames):
            blocks.append(cur)
            cur, acc = [], 0.0
        cur.append(k)
        acc += c
    if cur:
        blocks.append(cur)
    return blocks


# ----------------------------------------------------------------------- labels


def label_point(g) -> tuple[float, float]:
    """Pole of inaccessibility (shapely polylabel, ~0.01 deg) of the largest part,
    guaranteed inside it (falls back to a point on the surface)."""
    polys = G.polys(g)
    if not polys:
        return (0.0, 0.0)

    def size(p):  # planar area corrected for latitude: enough to pick the largest part
        c = p.centroid
        return p.area * math.cos(math.radians(c.y))
    big = max(polys, key=size) if len(polys) > 1 else polys[0]
    try:
        pt = shapely.ops.polylabel(big, tolerance=LABEL_TOL_DEG)
        if not big.contains(pt):
            pt = big.point_on_surface()
    except Exception:  # noqa: BLE001 - degenerate polygon
        pt = big.point_on_surface()
    return (round(pt.x, 4), round(pt.y, 4))


def surface_point(g) -> tuple[float, float]:
    pt = shapely.point_on_surface(g)
    return (round(pt.x, 4), round(pt.y, 4))


# ------------------------------------------------------------------------ tracker


class Tracker:
    """Runs of identical geometry per key over the consecutive frames of one block.

    `see(key, f, t, g, ...)` extends the key's open run when the frame follows it and
    the geometry is the same, else closes it and opens a new run (writing the WKB).
    `end_frame(f)` closes runs whose key was not seen in frame f."""

    def __init__(self, bin_path: str | None, label_fn=label_point):
        self._fh = open(bin_path, 'wb') if bin_path else None
        self.bin_path = bin_path
        self._off = 0
        self.open: dict = {}
        self.runs: list[dict] = []
        self.label_fn = label_fn
        self.stats = Counter()

    def see(self, key, f: int, t: int, g, token=None, km2: float | None = None, h: bytes | None = None,
            label_fn=None) -> None:
        r = self.open.get(key)
        if r is not None:
            if r['to'] == C.add_years(f, -1):
                if token is not None and token == r['token']:
                    self.stats['same token'] += 1
                    r['to'], r['seen'] = t, f
                    return
                h = h or G.wkb_hash(g)
                if h == r['hash']:
                    self.stats['same hash'] += 1
                    r['to'], r['seen'], r['token'] = t, f, token
                    return
                km2 = C.area_km2(g) if km2 is None else km2
                if abs(km2 - r['a']) < MERGE_TOL_KM2 and G.same_geometry(r['geom'], g, MERGE_TOL_KM2):
                    self.stats['same within tolerance'] += 1
                    r['to'], r['seen'], r['token'] = t, f, token
                    return
            self._close(key)
        h = h or G.wkb_hash(g)
        km2 = C.area_km2(g) if km2 is None else km2
        lx, ly = (label_fn or self.label_fn)(g)
        run = {'key': key, 'from': f, 'to': t, 'hash': h, 'a': km2, 'lx': lx, 'ly': ly,
               'bbox': G.bbox_lonlat([g]), 'off': self._off, 'len': 0,
               'token': token, 'geom': g, 'seen': f}
        if self._fh is not None:
            wkb = shapely.to_wkb(g)
            self._fh.write(wkb)
            run['len'] = len(wkb)
            self._off += len(wkb)
        self.open[key] = run
        self.stats['runs'] += 1

    def end_frame(self, f: int) -> None:
        for key in [k for k, r in self.open.items() if r['seen'] != f]:
            self._close(key)

    def _close(self, key) -> None:
        r = self.open.pop(key)
        for k in ('token', 'geom', 'seen'):
            r.pop(k, None)
        self.runs.append(r)

    def finish(self) -> list[dict]:
        for key in list(self.open):
            self._close(key)
        if self._fh is not None:
            self._fh.close()
            self._fh = None
        return self.runs


def read_wkb(path: str, off: int, n: int):
    with open(path, 'rb') as f:
        f.seek(off)
        return shapely.from_wkb(f.read(n))


class RunReader:
    """Reads run geometries back from the block files (keeps files open)."""

    def __init__(self, paths: dict[int, str]):
        self.paths = paths
        self._fh: dict[int, object] = {}

    def geom(self, run: dict):
        b = run['block']
        fh = self._fh.get(b)
        if fh is None:
            fh = self._fh[b] = open(self.paths[b], 'rb')
        fh.seek(run['off'])
        return shapely.from_wkb(fh.read(run['len']))

    def close(self):
        for fh in self._fh.values():
            fh.close()
        self._fh.clear()


def merge_runs(runs: list[dict], reader: RunReader | None = None) -> tuple[list[dict], int]:
    """Joins runs of the same key that meet (a block boundary): same hash, or areas
    within MERGE_TOL_KM2 and geometries the same within it. Returns (runs, joins)."""
    by_key: dict = defaultdict(list)
    for r in runs:
        by_key[r['key']].append(r)
    out, joins = [], 0
    for key in sorted(by_key, key=repr):
        rs = sorted(by_key[key], key=lambda r: r['from'])
        cur = None
        for r in rs:
            if cur is not None and cur['to'] == C.add_years(r['from'], -1):
                same = r['hash'] == cur['hash']
                if not same and reader is not None and abs(r['a'] - cur['a']) < MERGE_TOL_KM2:
                    same = G.same_geometry(reader.geom(cur), reader.geom(r), MERGE_TOL_KM2)
                if same:
                    cur['to'] = r['to']
                    joins += 1
                    continue
            cur = dict(r)
            out.append(cur)
    return out, joins


# ------------------------------------------------------------------------ worker

_W = None


class _Worker:
    """Per-process state: records, land, overrides and one FrameEngine reused for
    every block the process runs (its caches are content-keyed)."""

    def __init__(self, cfg: dict):
        import overrides as O  # PG2's engine; optional at test time
        self.cfg = cfg
        self.records = S.MultiStore(cfg['stores'])
        self.land = L.Land()
        self.ctx = C.Ctx()
        metas = self.records.meta
        self.from_ = np.array([int(m['from']) for m in metas], dtype=np.int64)
        self.to_ = np.array([int(m['to']) for m in metas], dtype=np.int64)
        self.ov, assign_fn, assign_years = None, None, []
        if cfg.get('overrides', True):
            try:
                self.ov = O.load_overrides()
                assign_fn = O.apply_assign_ops
                assign_years = [tuple(e['years']) for e in O.record_entries(self.ov)
                                if e.get('op') == 'assign' and e.get('status') == 'active' and not e.get('_error')]
            except NotImplementedError as ex:
                print(f'[frames] overrides engine not ready ({ex}); assign entries skipped', flush=True)
        self.by_pid: dict[str, list[int]] = defaultdict(list)
        for i, m in enumerate(metas):
            if int(m.get('tier') or 0) == 0 and m.get('kind') != 'unclaimed':
                self.by_pid[m['pid']].append(i)
        self.engine = K.FrameEngine(self.land, metas, self.records.raw, self.records.clipped,
                                    assign_fn=assign_fn, assign_years=assign_years,
                                    lookup=self.lookup, ctx=self.ctx, ov=self.ov)
        self.pair_cache = K._Cache(2)
        self.simple_cache = K._Cache(2)
        self.reported_pairs: set = set()
        self.gen = 0
        self.report_index = None
        if cfg.get('report_index'):
            self.report_index = C.load_pickle(cfg['report_index'])
        self.region_shares: dict[bytes, tuple] = {}   # unclaimed polygon hash -> ((region, km2), ...)
        self._region_tree = None
        self._region_names: list[str] = []

    def lookup(self, pid: str, year: int):
        """ctx.record_lookup for 'record' specs inside assign entries: the clipped
        tier-0 geometry of pid alive in year."""
        gs = [self.records.clipped(i) for i in self.by_pid.get(pid, ())
              if self.from_[i] <= year <= self.to_[i]]
        gs = [g for g in gs if g is not None and not g.is_empty]
        return G.union(gs) if gs else None

    # ------------------------------------------------------------------ one block
    def run_block(self, task: dict) -> dict:
        t0 = time.time()
        metas = self.records.meta
        tracker = Tracker(task['bin'])
        frames_qa, violations, errors = [], [], []
        adjacency: Counter = Counter()
        samples: dict = {}
        phase = Counter()
        for (f, t) in task['spans']:
            tf = time.time()
            ids = np.nonzero((self.from_ <= f) & (self.to_ >= f))[0].tolist()
            res = self.engine.run(f, t, ids, self.gen)
            self.gen += 1
            t1 = time.time()
            phase['engine'] += t1 - tf
            # polities and unclaimed polygons -> runs
            for i in sorted(res['geoms']):
                tracker.see(i, f, t, res['geoms'][i], token=res['tokens'][i], km2=res['areas'][i])
            for poly, h, km2 in res['unclaimed_parts']:
                tracker.see(('u', h), f, t, poly, km2=km2, h=h, label_fn=surface_point)
            tracker.end_frame(f)
            t2 = time.time()
            phase['runs'] += t2 - t1
            # pairs: overlaps left (QA) and shared borders (colour graph)
            n_years = years_in(f, t)
            pairs, near = self._pairs(res)
            for i, j in near:
                pi, pj = metas[i].get('power') or metas[i]['pid'], metas[j].get('power') or metas[j]['pid']
                if pi != pj:
                    adjacency[(min(pi, pj), max(pi, pj))] += NEAR_WEIGHT_KM * n_years
            for i, j, ov_km2, km in pairs:
                if ov_km2 > OVERLAP_MAX_KM2:
                    key = (metas[i]['rid'], metas[j]['rid'], round(ov_km2, 3))
                    if key not in self.reported_pairs:
                        self.reported_pairs.add(key)
                        violations.append({'frame': [f, t], 'a': metas[i]['rid'], 'b': metas[j]['rid'], 'km2': round(ov_km2, 3)})
                pi, pj = metas[i].get('power') or metas[i]['pid'], metas[j].get('power') or metas[j]['pid']
                if km > 0 and pi != pj:
                    adjacency[(min(pi, pj), max(pi, pj))] += km * n_years
            q = res['qa']
            frames_qa.append({
                'from': f, 'to': t, 'records': q['records'], 'tier1': q['tier1'], 'blockers': q['blockers'],
                'polity_km2': q['polity_km2'], 'unclaimed_km2': q['unclaimed_km2'], 'land_km2': q['land_km2'],
                'counts': res['counts'], 'secs': round(time.time() - tf, 2),
                'assign_log': res['assign_log'], 'overlap_log': res['overlap_log'],
            })
            for e in res['errors']:
                errors.append({'frame': [f, t], 'error': e})
            t3 = time.time()
            phase['pairs'] += t3 - t2
            for y in task.get('samples', {}).get(f, ()):
                samples[y] = self._sample(res, f, t)
            phase['samples'] += time.time() - t3
            self.records.forget(set(ids))
        runs = tracker.finish()
        for r in runs:
            r['block'] = task['block']
        return {'block': task['block'], 'runs': runs, 'frames': frames_qa, 'violations': violations,
                'adjacency': dict(adjacency), 'samples': samples, 'errors': errors,
                'secs': round(time.time() - t0, 1), 'tracker': dict(tracker.stats),
                'phase': {k: round(v, 1) for k, v in phase.items()}}

    def _pairs(self, res):
        """([(i, j, overlap km2, shared border km)] for intersecting tier-0 polities,
        [(i, j)] for polities within NEAR_DEG of each other that do not touch)."""
        ids = sorted(res['geoms'])
        if len(ids) < 2:
            return [], []
        gs = [res['geoms'][i] for i in ids]
        self.pair_cache.prune(self.gen)
        self.simple_cache.prune(self.gen)
        tree = STRtree(gs)
        qa, qb = tree.query(gs, predicate='intersects')
        out, touching = [], set()
        for a, b in zip(qa.tolist(), qb.tolist()):
            if a >= b:
                continue
            i, j = ids[a], ids[b]
            touching.add((a, b))
            key = (i, j, res['tokens'][i], res['tokens'][j])
            hit = self.pair_cache.get(key)
            if hit is None:
                hit = self.pair_cache.put(key, pair_measures(gs[a], gs[b]))
            out.append((i, j, hit[0], hit[1]))
        near = []
        if NEAR_DEG > 0:
            simple = []
            for i, g in zip(ids, gs):
                tok = ('s', i, res['tokens'][i])
                sg = self.simple_cache.get(tok)
                if sg is None:
                    sg = self.simple_cache.put(tok, shapely.simplify(g, NEAR_SIMPLIFY_DEG, preserve_topology=False))
                simple.append(sg)
            qa, qb = STRtree(simple).query(simple, predicate='dwithin', distance=NEAR_DEG)
            near = [(ids[a], ids[b]) for a, b in zip(qa.tolist(), qb.tolist()) if a < b and (a, b) not in touching]
        return out, near

    def _regions_of(self, poly, km2: float) -> tuple:
        """((region, km2), ...) of one unclaimed polygon. A polygon whose bounding box
        meets one region only counts wholly there; others are intersected with the
        (simplified) region geometries."""
        ri = self.report_index
        if self._region_tree is None:
            self._region_names = list(ri['regions'])
            self._region_tree = STRtree([ri['regions'][n]['geom'] for n in self._region_names])
        cand = sorted(int(k) for k in self._region_tree.query(shapely.box(*poly.bounds)))
        if not cand:
            return ()
        if len(cand) == 1:
            return ((self._region_names[cand[0]], km2),)
        ps = G.mp(shapely.simplify(poly, ri['simplify_deg'], preserve_topology=True))
        out = []
        for k in cand:
            a = C.area_km2(G.inter(ps, ri['regions'][self._region_names[k]]['geom']))
            if a > 0:
                out.append((self._region_names[k], a))
        return tuple(out)

    def _sample(self, res, f: int, t: int) -> dict:
        """QA sample: unclaimed share per audit region, islands per rule and region,
        the largest unclaimed islands."""
        ri = self.report_index
        out = {'frame': [f, t], 'unclaimed_km2': res['qa']['unclaimed_km2'], 'land_km2': res['qa']['land_km2'],
               'regions': {}, 'islands': {}, 'largest_unclaimed': []}
        if ri is None:
            return out
        per_region: Counter = Counter()
        for poly, h, km2 in res['unclaimed_parts']:
            shares = self.region_shares.get(h)
            if shares is None:
                shares = self.region_shares[h] = self._regions_of(poly, km2)
            for name, a in shares:
                per_region[name] += a
        for name, reg in ri['regions'].items():
            km2 = per_region.get(name, 0.0)
            out['regions'][name] = {'unclaimed_km2': round(km2, 1), 'land_km2': round(reg['km2'], 1),
                                    'share': round(min(km2 / reg['km2'], 1.0), 5) if reg['km2'] else 0.0}
        per = defaultdict(Counter)
        for k, (_rid, rule) in res['settled'].items():
            per[ri['island_region'].get(int(k), 'other')][rule] += 1
        out['islands'] = {r: dict(c) for r, c in sorted(per.items())}
        for k, km2 in res['unclaimed_islands'][:25]:
            info = ri['islands'].get(int(k), {})
            out['largest_unclaimed'].append({'island': int(k), 'name': info.get('name', ''), 'km2': round(km2, 1),
                                             'island_km2': round(float(self.land.island_area[int(k)]), 1),
                                             'point': info.get('point'), 'region': ri['island_region'].get(int(k), 'other')})
        return out


def pair_measures(a, b) -> tuple[float, float]:
    """(overlap area km2, shared border length km) of two polygonal geometries."""
    x = shapely.intersection(a, b, grid_size=G.GRID)
    if x.is_empty:
        return (0.0, 0.0)
    ov = C.area_km2(G.mp(x))
    lines = [p for p in shapely.get_parts(x) if shapely.get_type_id(p) in (1, 2, 5)]
    km = sum(C.GEOD.geometry_length(ln) for ln in lines) / 1000.0 if lines else 0.0
    return (ov, km)


def _init_worker(cfg: dict) -> None:
    global _W
    _W = _Worker(cfg)


def _run_task(task: dict) -> dict:
    try:
        return _W.run_block(task)
    except Exception:  # noqa: BLE001 - surface the traceback in the parent
        return {'block': task['block'], 'fatal': traceback.format_exc()}


# ------------------------------------------------------------------------- driver


def frame_costs(metas: list[dict], spans: list[tuple[int, int]], prior: dict | None = None) -> list[float]:
    """Cost of each frame for block planning: the seconds it took in the previous run
    (`prior` {from: secs}, written to frame-costs.json), else an estimate from the
    number of tier-0 records alive and the land they cover (historical frames), or
    from the record count (modern frames: Natural Earth units leave little to fill)."""
    fr = np.array([int(m['from']) for m in metas])
    to = np.array([int(m['to']) for m in metas])
    t0 = np.array([int(m.get('tier') or 0) == 0 for m in metas])
    km2 = np.array([float(m.get('clip_area') or 0.0) for m in metas])
    prior = prior or {}
    out = []
    for f, _t in spans:
        if f in prior:
            out.append(float(prior[f]))
            continue
        alive = (fr <= f) & (to >= f) & t0
        n = float(alive.sum())
        if f >= C.CUTOVER_YEAR:
            out.append(4.0 + 0.02 * n)
        else:
            out.append(2.0 + 0.04 * n + 2.5e-7 * float(km2[alive].sum()))
    return out


def run_frames(stores: list[str], extra_years, workers: int, out_dir: str = FRAMES_DIR,
               years: tuple[int, int] | None = None, samples: list[int] = (), report_index: str | None = None,
               overrides: bool = True, prior_costs: dict | None = None, log=print) -> dict:
    """Runs the coast step on every frame and returns the merged runs plus QA data."""
    t0 = time.time()
    view = S.MultiStore(stores)
    metas = view.meta
    lo, hi = years or (C.FIRST_YEAR, C.PRESENT_YEAR)
    frames = frame_years(metas, extra_years, lo, hi)
    spans = spans_of(frames, hi)
    costs = frame_costs(metas, spans, prior_costs)
    n_blocks = max(1, min(len(spans), workers * 2))
    blocks = plan_blocks(spans, costs, n_blocks)
    os.makedirs(out_dir, exist_ok=True)
    for name in os.listdir(out_dir):
        if name.startswith('block-') and name.endswith('.bin'):
            os.remove(os.path.join(out_dir, name))
    sample_frame: dict[int, list[int]] = defaultdict(list)
    for y in samples:
        for f, t in spans:
            if f <= y <= t:
                sample_frame[f].append(y)
                break
    tasks = []
    for b, ks in enumerate(blocks):
        sp = [spans[k] for k in ks]
        tasks.append({'block': b, 'spans': sp, 'bin': os.path.join(out_dir, f'block-{b:04d}.bin'),
                      'samples': {f: sample_frame[f] for f, _ in sp if f in sample_frame},
                      'cost': sum(costs[k] for k in ks)})
    log(f'[frames] {len(spans)} frames {lo}..{hi} in {len(tasks)} blocks on {workers} worker(s); '
        f'{len(metas)} records ({sum(1 for m in metas if m.get("kind") == "unclaimed")} blockers)')
    cfg = {'stores': stores, 'report_index': report_index, 'overrides': overrides}
    results = []
    order = sorted(tasks, key=lambda x: -x['cost'])  # longest first: better packing
    done_frames = 0
    if workers <= 1:
        _init_worker(cfg)
        for task in order:
            results.append(_run_task(task))
            done_frames += len(task['spans'])
    else:
        with get_context('spawn').Pool(workers, initializer=_init_worker, initargs=(cfg,), maxtasksperchild=None) as pool:
            for res in pool.imap_unordered(_run_task, order):
                results.append(res)
                if 'fatal' in res:
                    pool.terminate()
                    raise RuntimeError(f"frame block {res['block']} failed:\n{res['fatal']}")
                done_frames += len(next(t for t in tasks if t['block'] == res['block'])['spans'])
                log(f"[frames]   block {res['block']:3d} done in {res['secs']:6.1f} s "
                    f"({done_frames}/{len(spans)} frames, {time.time() - t0:.0f} s elapsed)")
    for res in results:
        if 'fatal' in res:
            raise RuntimeError(f"frame block {res['block']} failed:\n{res['fatal']}")
    results.sort(key=lambda r: r['block'])
    paths = {r['block']: tasks[r['block']]['bin'] for r in results}
    reader = RunReader(paths)
    runs, joins = merge_runs([run for r in results for run in r['runs']], reader)
    reader.close()
    adjacency: Counter = Counter()
    for r in results:
        adjacency.update(r['adjacency'])
    frames_qa = sorted((fq for r in results for fq in r['frames']), key=lambda q: q['from'])
    tstats, phase = Counter(), Counter()
    for r in results:
        tstats.update(r['tracker'])
        phase.update(r.get('phase', {}))
    out = {
        'frames': frames, 'spans': spans, 'runs': runs, 'paths': paths, 'frames_qa': frames_qa,
        'violations': [v for r in results for v in r['violations']],
        'errors': [e for r in results for e in r['errors']],
        'adjacency': dict(adjacency),
        'samples': {y: s for r in results for y, s in r['samples'].items()},
        'stats': {'blocks': len(tasks), 'block_secs': [r['secs'] for r in results], 'joins': joins,
                  'runs': len(runs), 'tracker': dict(tstats), 'secs': round(time.time() - t0, 1),
                  'phaseSecs': {k: round(v, 1) for k, v in phase.items()}},
        'years': [lo, hi],
    }
    log(f'[frames] {len(spans)} frames -> {len(runs)} runs ({joins} joined across blocks) in {time.time() - t0:.0f} s; '
        f'worker seconds by phase {dict((k, round(v)) for k, v in phase.items())}')
    return out
