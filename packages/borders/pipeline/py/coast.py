"""Step 5, the COAST step: turns one frame's tier-0 footprints into an exact partition
of Natural Earth land (polities + unclaimed land).

Rules, in order (thresholds in config.json "coast"; distances geodesic; the
antimeridian is handled: land parts cut at +/-180 form one logical island, and a
footprint running along one side of +/-180 is adjacent to land on the other side):

  U  uncovered land = land - union(raw footprints of the frame's tier-0 records)
  a  majority islands: a logical island <= majorityIslandMaxAreaKm2 covered >=
     majorityShare by one polity while every other covers < majorityOtherMaxShare
     goes wholly to it (Crete, Lesbos, Rhodes behind Cliopatria's coarse outlines)
  b  small islands <= uncoveredIslandMaxAreaKm2 not settled by (a): to the single
     polity within uncoveredNearKm, or to the nearest polity within uncoveredFarKm
     when it is uncoveredFarRatio x closer than the second. A polity covering part of
     the island is at distance 0, so a partly covered islet goes wholly to the polity
     covering it unless another polity covers part of it too; islands won in (a)
     count as their winner's land. The rule runs in passes: an island assigned in
     one pass is its winner's land in the next, so it chains through archipelagos
     (each pass decides against the state at its start: order-independent)
  c1 pockets: a connected piece of uncovered land (it touches only polities and the
     sea) no larger than pocketMaxAreaKm2 - or mostly lake (pocketLakeShare), or met
     by a polity across +/-180 (Chukotka east of 180 deg next to Russia), whatever
     its size - is filled: wholly by its only neighbour, or split between its
     neighbours by nearest boundary (holes in footprints, lakes cut out of
     footprints, slivers between footprints and the coast, digitising gaps between
     neighbours)
  c2 coastal gaps: in larger uncovered areas, land lying in a narrow gap (less than
     2 x coastalGapCloseKm wide) between a neighbouring polity and the coast, within
     coastalGapBandKm of both, is split between the neighbouring polities by nearest
     boundary (Voronoi cells of densified boundaries). Inland frontier zones and wide
     coastal plains stay unclaimed
  d  'assign' overrides (overrides.apply_assign_ops) - explicit assignments win
  e  remaining tier-0 overlaps: the smaller polity keeps the overlap
  f  unclaimed = what is left, returned per connected polygon (frames.py writes one
     run per polygon over the consecutive frames where it is unchanged)

'Blockers' (kind 'unclaimed') take part as if they were polities, so the rules never
re-fill land that overrides deliberately left unclaimed (subtract and delete entries,
unclaimed modern periods); they lose every overlap and end up in the unclaimed
feature.

Frames are processed in time order inside a worker and every local result is cached
by content (geometry hashes), so a frame only recomputes what changed around the
records that changed.
"""
from __future__ import annotations

import math
import time
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import MultiPolygon, Polygon, box

import common as C
import geom as G

CFG = C.CONFIG['coast']
MAJ_MAX = float(CFG['majorityIslandMaxAreaKm2'])
MAJ_SHARE = float(CFG['majorityShare'])
MAJ_OTHER = float(CFG['majorityOtherMaxShare'])
UNC_MAX = float(CFG['uncoveredIslandMaxAreaKm2'])
NEAR_KM = float(CFG['uncoveredNearKm'])
FAR_KM = float(CFG['uncoveredFarKm'])
RATIO = float(CFG['uncoveredFarRatio'])
BAND_KM = float(CFG['coastalGapBandKm'])
CLOSE_KM = float(CFG.get('coastalGapCloseKm', BAND_KM / 2))
POCKET_MAX = float(CFG.get('pocketMaxAreaKm2', 2500))
LAKE_SHARE = float(CFG.get('pocketLakeShare', 0.5))
SPACING_KM = float(CFG.get('voronoiSpacingKm', 1.0))
TILE_DEG = float(CFG.get('tileDeg', 2.0))
OVERSHOOT_KM = 0.5           # the opening over-covers by this much (simplification + arc chords)
OVERLAP_LOG_KM2 = float(C.CONFIG.get('qa', {}).get('overlapLogKm2', 10.0))
TILE_MARGIN_KM = max(2 * CLOSE_KM + OVERSHOOT_KM, BAND_KM) + 2.0
CONTINENT_KM2 = 1_000_000    # islands larger than this are reported as landmasses, not islands


def is_blocker(m: dict) -> bool:
    return m.get('kind') == 'unclaimed'


def tiles_for(bounds) -> list[tuple[int, int]]:
    w, s, e, n = bounds
    i0, i1 = int(math.floor((w + 180) / TILE_DEG)), int(math.floor((min(e, 179.999999) + 180) / TILE_DEG))
    j0, j1 = int(math.floor((s + 90) / TILE_DEG)), int(math.floor((min(n, 89.999999) + 90) / TILE_DEG))
    return [(i, j) for i in range(i0, i1 + 1) for j in range(j0, j1 + 1)]


def tile_rect(t: tuple[int, int]) -> tuple:
    w, s = -180 + t[0] * TILE_DEG, -90 + t[1] * TILE_DEG
    return (w, s, min(w + TILE_DEG, 180.0), min(s + TILE_DEG, 90.0))


def dateline_lats(poly) -> list[tuple[int, float, float]]:
    """(side, lat_lo, lat_hi) of the edges of a polygon lying on lon = +180 (side 1)
    or -180 (side -1)."""
    out = []
    for ring in [poly.exterior, *poly.interiors]:
        xy = np.asarray(ring.coords)
        for side in (1, -1):
            on = (xy[:-1, 0] == 180.0 * side) & (xy[1:, 0] == 180.0 * side)
            for i in np.nonzero(on)[0]:
                a, b = xy[i, 1], xy[i + 1, 1]
                if a != b:
                    out.append((side, min(a, b), max(a, b)))
    return out


class _Cache(dict):
    """dict whose entries remember the last frame that used them; prune(gen) drops
    the ones unused for more than `keep` frames."""

    def __init__(self, keep: int = 2):
        super().__init__()
        self.used: dict = {}
        self.keep = keep
        self.gen = 0

    def get(self, key, default=None):
        if key in self:
            self.used[key] = self.gen
            return dict.__getitem__(self, key)
        return default

    def put(self, key, value):
        self[key] = value
        self.used[key] = self.gen
        return value

    def prune(self, gen: int):
        self.gen = gen
        old = [k for k, g in self.used.items() if g < gen - self.keep]
        for k in old:
            self.pop(k, None)
            self.used.pop(k, None)


class _Comp:
    """A connected piece of uncovered land (one polygon of one land part)."""
    __slots__ = ('poly', 'part', 'hash', 'km2', 'nbr_hashes')

    def __init__(self, poly, part, nbr_hashes):
        self.poly, self.part = poly, part
        self.hash = G.wkb_hash(poly)
        self.km2 = C.area_km2(poly)
        self.nbr_hashes = nbr_hashes


class FrameEngine:
    """Runs the coast step frame after frame (see module docstring)."""

    def __init__(self, land, metas: list[dict], get_raw, get_clipped, assign_fn=None, assign_years=None,
                 lookup=None, ctx=None, ov=None):
        self.land = land
        self.metas = metas
        self.get_raw = get_raw
        self.get_clipped = get_clipped
        self.assign_fn = assign_fn              # overrides.apply_assign_ops or None
        self.assign_years = assign_years or []  # [(from, to)] of active assign entries
        self.lookup = lookup                    # ctx.record_lookup for assign 'record' specs
        self.ctx, self.ov = ctx, ov
        n_isl = len(land.islands)
        self._small_ids = np.array([k for k in range(n_isl) if land.island_area[k] <= UNC_MAX], dtype=np.int64)
        self._win30 = [self._island_window(int(k), FAR_KM) for k in self._small_ids]
        self._win90 = [self._island_window(int(k), FAR_KM * RATIO) for k in self._small_ids]
        self._small_pos = {int(k): n for n, k in enumerate(self._small_ids)}
        self._isl_geom: dict[int, MultiPolygon] = {}
        self._isl_frame: dict[int, G.LocalFrame] = {}
        self._static_u: dict[int, tuple] = {}
        self.c_u = _Cache(1)          # (part, raw hashes) -> (uncovered geometry, [_Comp])
        self.c_dist = _Cache(40)      # (island, raw hash) -> km
        self.c_idist = _Cache(40)     # (island, island) -> km
        self.c_pocket = _Cache(2)     # pocket split
        self.c_tile = _Cache(2)       # coastal-gap tile job
        self.c_rest = _Cache(2)       # component minus what it gave away
        self.c_band: dict = {}        # tile -> (frame, rects, local coast band) - static
        self.c_final = _Cache(1)
        self.c_overlap = _Cache(40)   # (i, j) -> overlap on land, or None
        self.c_final3 = _Cache(1)
        self.c_area = _Cache(1)
        self.c_lake = _Cache(2)       # uncovered group (component hashes) -> km2 of lakes
        self.c_asm = _Cache(2)        # (record, land part, piece hashes) -> assembled polygons
        self._base_parts: dict[int, list[int]] = {}   # record -> land part of each clipped polygon
        self.logged_overlaps: set = set()
        self.errors: list[str] = []   # GEOS failures handled by a fallback (reported by QA)

    # ------------------------------------------------------------------ helpers
    def _island_window(self, k: int, km: float):
        g = self.land.island_geom(k)
        w, e = G.lon_extent([g])
        b = g.bounds
        rects = G.window_rects(w, b[1], e, b[3], km)
        return shapely.union_all([box(*r) for r in rects]) if len(rects) > 1 else box(*rects[0])

    def island_geom(self, k: int) -> MultiPolygon:
        g = self._isl_geom.get(k)
        if g is None:
            g = self._isl_geom[k] = self.land.island_geom(k)
        return g

    def island_frame(self, k: int) -> G.LocalFrame:
        f = self._isl_frame.get(k)
        if f is None:
            f = self._isl_frame[k] = G.LocalFrame.around([self.island_geom(k)])
        return f

    def area(self, token, g) -> float:
        a = self.c_area.get(token)
        if a is None:
            a = self.c_area.put(token, C.area_km2(g))
        return a

    def _lake_km2(self, members, comps, gm) -> float:
        key = frozenset(comps[a].hash for a in members)
        v = self.c_lake.get(key)
        if v is None:
            v = self.c_lake.put(key, self.land.lake_km2(gm))
        return v

    def parts_of(self, polys: list) -> list[int]:
        """Land part holding each polygon (every polygon here lies inside one part)."""
        if not polys:
            return []
        pts = shapely.point_on_surface(polys)
        qa, qb = self.land.tree.query(pts, predicate='intersects')
        out = [-1] * len(polys)
        for a, b in zip(qa.tolist(), qb.tolist()):
            if out[a] < 0:
                out[a] = int(b)
        for a, v in enumerate(out):
            if v < 0:  # on a part boundary up to the grid: the nearest part
                out[a] = int(self.land.tree.nearest(pts[a]))
        return out

    def base_parts(self, i: int, g) -> list[int]:
        ent = self._base_parts.get(i)
        if ent is None:
            ent = self._base_parts[i] = self.parts_of(G.polys(g))
        return ent

    def _assemble(self, i: int, base, won_k: set, lost_k: set, pieces: list) -> MultiPolygon:
        """Record i's clipped geometry plus islands won and pieces assigned, minus
        islands lost, assembled per land part: polygons of different parts are
        disjoint, so only parts that receive pieces need a union."""
        land = self.land
        drop: set[int] = set()
        for k in won_k | lost_k:
            drop.update(land.islands[k])
        by_part: dict[int, list] = defaultdict(list)
        for poly, p in zip(G.polys(base), self.base_parts(i, base)):
            if p not in drop:
                by_part[p].append(poly)
        added: dict[int, list] = defaultdict(list)
        for g in pieces:
            gp = G.polys(g)
            for poly, p in zip(gp, self.parts_of(gp)):
                added[p].append(poly)
        out = [land.parts[p] for k in sorted(won_k) for p in land.islands[k]]
        for p in sorted(set(by_part) | set(added)):
            ps, new = by_part.get(p, []), added.get(p, [])
            if not new or len(ps) + len(new) == 1:
                out.extend(ps + new)
                continue
            # the base polygons of record i on part p never change: key on the pieces only
            key = ('asm', i, p, frozenset(G.wkb_hash(q) for q in new))
            got = self.c_asm.get(key)
            if got is None:
                got = self.c_asm.put(key, G.polys(G.union(ps + new)))
            out.extend(got)
        return MultiPolygon(out) if out else G.EMPTY

    def dist_raw(self, k: int, i: int) -> float:
        key = (k, self.metas[i]['raw_hash'])
        d = self.c_dist.get(key)
        if d is None:
            win = self._win90[self._small_pos[k]]
            near = G.clip_rects(self.get_raw(i), [tuple(p.bounds) for p in G.polys(win)])
            d = G.km_distance(self.island_geom(k), near, self.island_frame(k)) if not near.is_empty else math.inf
            self.c_dist.put(key, d)
        return d

    def dist_island(self, k: int, j: int) -> float:
        key = (min(k, j), max(k, j))
        d = self.c_idist.get(key)
        if d is None:
            d = self.c_idist.put(key, G.km_distance(self.island_geom(k), self.island_geom(j), self.island_frame(k)))
        return d

    @staticmethod
    def local_key(g, rects) -> bytes:
        """Hash of the part of g inside the window (what a local computation sees)."""
        return G.wkb_hash(G.clip_rects(g, rects))

    # ---------------------------------------------------------------- the frame
    def run(self, f: int, t: int, ids: list[int], gen: int) -> dict:
        t0 = time.time()
        for c in (self.c_u, self.c_dist, self.c_idist, self.c_pocket, self.c_tile, self.c_rest, self.c_final,
                  self.c_overlap, self.c_final3, self.c_area, self.c_lake, self.c_asm):
            c.prune(gen)
        M, land = self.metas, self.land
        R0 = sorted(i for i in ids if int(M[i].get('tier') or 0) == 0)
        R1 = sorted(i for i in ids if int(M[i].get('tier') or 0) == 1)
        real0 = [i for i in R0 if not is_blocker(M[i])]
        raw = {i: self.get_raw(i) for i in R0}
        clipped = {i: self.get_clipped(i) for i in R0}
        by_hash: dict[bytes, list[int]] = defaultdict(list)
        for i in R0:
            by_hash[M[i]['raw_hash']].append(i)
        counts: Counter = Counter()
        timing: dict = {}

        def lap(name):
            timing[name] = round(time.time() - t0, 3)

        fp_ids = np.array(R0, dtype=np.int64)
        fp_tree = STRtree([raw[i] for i in R0]) if R0 else None

        U = self._uncovered(R0, raw)                                  # part -> [_Comp]
        lap('U')
        settled, won, lost = self._majority(R0, U, counts)
        lap('a')
        self._small_islands(fp_tree, fp_ids, U, settled, won, counts)
        for k in settled:
            for p in land.islands[k]:
                U.pop(p, None)
        lap('b')

        comps: list[_Comp] = [c for p in sorted(U) for c in U[p]]
        groups, nbrs, cross = self._groups(comps, by_hash, fp_tree, fp_ids, raw)
        lap('groups')
        pieces: dict[int, list] = defaultdict(list)       # record -> [(geometry, km2)]
        taken: dict[int, list] = defaultdict(list)        # component index -> [geometry]
        big = []
        for members in groups:
            nb_all = sorted(set().union(*(nbrs[a] for a in members)) | set().union(*(cross[a] for a in members)))
            if not nb_all:
                continue
            gm = MultiPolygon([comps[a].poly for a in members])
            km2 = sum(comps[a].km2 for a in members)
            reason = None
            if km2 <= POCKET_MAX:
                reason = 'pocket'
            elif any(cross[a] for a in members):
                # a polity meets it across +/-180 (Chukotka east of 180 deg: Cliopatria's
                # Russia stops at 180 E): filled whatever its size, split by nearest
                # boundary when other footprints touch it too
                reason = 'pocket_dateline'
            elif self._lake_km2(members, comps, gm) >= LAKE_SHARE * km2:
                reason = 'pocket_lake'
            if reason is None:
                big.append((members, nb_all))
                continue
            for i, g, a in self._pocket(gm, nb_all, raw):
                pieces[i].append(g)
                counts[reason] += 1
                counts[f'{reason}_km2'] += a
                for m in members:
                    taken[m].append(g)
        lap('c1')
        for members, nb_all in big:
            for a in members:
                for i, g, km2 in self._coastal_gaps(comps[a].poly, nb_all, raw):
                    pieces[i].append(g)
                    taken[a].append(g)
                    counts['gap'] += 1
                    counts['gap_km2'] += km2
        lap('c2')

        final, token, changed = self._final1(R0, clipped, won, lost, pieces)
        lap('final1')
        alog, added, removed = self._assign(f, t, real0, R1, final, token, changed, counts)
        lap('d')
        final3, token3, overlap_log = self._overlaps(real0, raw, clipped, final, token, changed, counts, f, t)
        blocker_final = self._blockers(R0, real0, final, final3)
        lap('e')

        rest, rest_part = self._rest(comps, taken)
        items = list(zip(rest, self._rest_hashes, rest_part))      # unclaimed (polygon, hash, land part)
        minus = G.union(added) if added else G.EMPTY               # land that assign entries gave away
        plus = list(blocker_final)                                 # blocked land no polity holds
        if removed:
            rem_all = G.union(removed)
            if not rem_all.is_empty:                               # land assigns took and nobody holds
                held = [final3[i] for i in real0 if not final3[i].is_empty and final3[i].intersects(rem_all)]
                orphan = G.diff(rem_all, G.union(held))
                if not orphan.is_empty:
                    plus.append(orphan)
        if not minus.is_empty or plus:
            items = self._adjust_unclaimed(items, minus, plus)
        unclaimed = MultiPolygon([q for q, _, _ in items]) if items else G.EMPTY
        lap('f')

        out_geoms = {i: final3[i] for i in real0 if not final3[i].is_empty}
        areas = {i: self.area(token3[i], final3[i]) for i in out_geoms}
        polity_km2 = sum(areas.values())
        parts = [(q, h, self.area(('rest', h), q)) for q, h, _ in items]   # (polygon, hash, km2)
        unclaimed_km2 = sum(a for _, _, a in parts)
        counts['unclaimed_km2'] = unclaimed_km2
        errors, self.errors = self.errors, []
        lap('total')
        return {
            'from': f, 'to': t, 'geoms': out_geoms, 'tokens': {i: token3[i] for i in out_geoms}, 'areas': areas,
            'unclaimed': unclaimed, 'unclaimed_parts': parts, 'counts': dict(counts), 'errors': errors,
            'qa': {'polity_km2': polity_km2, 'unclaimed_km2': unclaimed_km2, 'land_km2': land.total_area,
                   'records': len(real0), 'tier1': len(R1), 'blockers': len(R0) - len(real0)},
            'settled': {int(k): (M[w]['rid'], rule) for k, (w, rule) in settled.items()},
            'unclaimed_islands': self._unclaimed_islands(rest, rest_part),
            'assign_log': alog, 'overlap_log': overlap_log, 'timing': timing,
        }

    # ------------------------------------------------------------- U and islands
    def _uncovered(self, R0, raw) -> dict[int, list[_Comp]]:
        """Uncovered land per land part, as components with their neighbours' raw hashes."""
        M, land = self.metas, self.land
        touch: dict[int, list[int]] = defaultdict(list)
        full: set[int] = set()
        for i in R0:
            for p in M[i]['parts_hit']:
                touch[p].append(i)
            full.update(M[i]['parts_full'])
        U: dict[int, list[_Comp]] = {}
        for p in range(len(land.parts)):
            if p in full:
                continue
            ts = touch.get(p)
            if not ts:
                ent = self._static_u.get(p)
                if ent is None:
                    ent = self._static_u[p] = [_Comp(land.parts[p], p, ())]
                U[p] = ent
                continue
            key = (p, frozenset(M[i]['raw_hash'] for i in ts))
            ent = self.c_u.get(key)
            if ent is None:
                u = G.diff(land.parts[p], G.union([raw[i] for i in ts]))
                polys = list(u.geoms)
                nb: dict[int, set] = defaultdict(set)
                if polys:
                    qa, qb = STRtree([raw[i] for i in ts]).query(polys, predicate='dwithin', distance=G.TOUCH_DEG)
                    for a, b in zip(qa.tolist(), qb.tolist()):
                        nb[a].add(M[ts[b]]['raw_hash'])
                ent = [_Comp(poly, p, tuple(sorted(nb.get(a, ())))) for a, poly in enumerate(polys)]
                self.c_u.put(key, ent)
            if ent:
                U[p] = ent
        return U

    def _majority(self, R0, U, counts):
        """Rule (a). Returns (settled {island: (record, rule)}, won, lost)."""
        M, land = self.metas, self.land
        cov: dict[int, dict[int, float]] = defaultdict(dict)
        for i in R0:
            for k, a in M[i]['coverage'].items():
                cov[k][i] = a
        settled: dict[int, tuple[int, str]] = {}
        won: dict[int, set] = defaultdict(set)
        lost: dict[int, set] = defaultdict(set)
        for k in sorted(cov):
            A = land.island_area[k]
            ranked = sorted(cov[k].items(), key=lambda kv: (-kv[1], kv[0]))
            i1, a1 = ranked[0]
            if a1 >= MAJ_SHARE * A and all(a < MAJ_OTHER * A for _, a in ranked[1:]):
                uncovered = any(p in U for p in land.islands[k])
                if not uncovered and len(ranked) == 1:
                    continue  # already wholly inside one footprint
                settled[k] = (i1, 'majority')
                won[i1].add(k)
                for j, _ in ranked[1:]:
                    lost[j].add(k)
                counts['majority'] += 1
                counts['majority_km2'] += float(sum(c.km2 for p in land.islands[k] for c in U.get(p, ())))
        return settled, won, lost

    def _small_islands(self, fp_tree, fp_ids, U, settled, won, counts):
        """Rule (b), in place on settled/won. Runs in passes while it assigns islands:
        an island assigned in one pass is its winner's land in the next, so the rule
        chains through archipelagos whose islands lie within reach of each other (the
        Cyclades, the Philippines). Each pass decides against the state at its start,
        so the result does not depend on the order of the islands."""
        if not len(self._small_ids):
            return
        M, land = self.metas, self.land

        def uncovered(k):
            return any(p in U for p in land.islands[k])

        cand: set[int] = set()
        if fp_tree is not None:
            cand = {int(self._small_ids[a]) for a in fp_tree.query(self._win30, predicate='intersects')[0]}
        near_fp: dict[int, list[int]] = {}
        undecided: set[int] = set()
        fresh = sorted(settled)        # islands settled since the last pass
        passes = 0
        while True:
            if fresh:                  # islands within reach of the newly settled ones
                ftree = STRtree([self.island_geom(k) for k in fresh])
                cand |= {int(self._small_ids[a]) for a in ftree.query(self._win30, predicate='intersects')[0]}
            todo = sorted(k for k in cand if k not in settled and uncovered(k))
            if not todo:
                break
            passes += 1
            pos = [self._small_pos[k] for k in todo]
            new_fp = [k for k in todo if k not in near_fp]
            if new_fp:
                for k in new_fp:
                    near_fp[k] = []
                if fp_tree is not None:
                    q90 = fp_tree.query([self._win90[self._small_pos[k]] for k in new_fp], predicate='intersects')
                    for a, x in zip(q90[0], q90[1]):
                        near_fp[new_fp[int(a)]].append(int(fp_ids[int(x)]))
            won_ids = sorted(settled)
            won_near: dict[int, list[int]] = defaultdict(list)
            if won_ids:
                won_tree = STRtree([self.island_geom(k) for k in won_ids])
                qw = won_tree.query([self._win90[n] for n in pos], predicate='intersects')
                for a, x in zip(qw[0], qw[1]):
                    won_near[todo[int(a)]].append(won_ids[int(x)])
            new: dict[int, tuple[int, str]] = {}
            for k in todo:
                d: dict[int, float] = {}
                for i in near_fp[k]:
                    d[i] = 0.0 if M[i]['coverage'].get(k, 0.0) > 0 else self.dist_raw(k, i)
                for j in won_near.get(k, ()):
                    if j == k:
                        continue
                    owner = settled[j][0]
                    d[owner] = min(d.get(owner, math.inf), self.dist_island(k, j))
                ranked = sorted((v, i) for i, v in d.items() if v <= FAR_KM * RATIO)
                if not ranked:
                    continue
                near = [i for v, i in ranked if v <= NEAR_KM]
                winner = rule = None
                if len(near) == 1:
                    winner, rule = near[0], 'near'
                else:
                    d1, i1 = ranked[0]
                    d2 = ranked[1][0] if len(ranked) > 1 else math.inf
                    if d1 <= FAR_KM and d2 > 0 and d2 >= RATIO * d1:
                        winner, rule = i1, 'ratio'
                if winner is None:
                    undecided.add(k)
                    continue
                new[k] = (winner, rule)
            if not new:
                break
            for k, (winner, rule) in new.items():
                settled[k] = (winner, rule)
                won[winner].add(k)
                undecided.discard(k)
                counts[rule] += 1
                counts[f'{rule}_km2'] += float(sum(c.km2 for p in land.islands[k] for c in U.get(p, ())))
                if passes > 1:
                    counts['island_chained'] += 1
            fresh = sorted(new)
        counts['island_ambiguous'] += len(undecided)
        counts['island_passes'] = max(counts.get('island_passes', 0), passes)

    # ------------------------------------------------------------- components
    def _groups(self, comps, by_hash, fp_tree, fp_ids, raw):
        """Groups of components (joined across +/-180), each component's neighbours
        (record ids) and its neighbours across +/-180."""
        nbrs = [set(i for h in c.nbr_hashes for i in by_hash.get(h, ())) for c in comps]
        cross: list[set] = [set() for _ in comps]
        parent = list(range(len(comps)))

        def find(a):
            while parent[a] != a:
                parent[a] = parent[parent[a]]
                a = parent[a]
            return a
        dl = {}
        for a, c in enumerate(comps):
            b = c.poly.bounds
            if b[0] <= -180.0 or b[2] >= 180.0:
                ivs = dateline_lats(c.poly)
                if ivs:
                    dl[a] = ivs
        for a, ivs in dl.items():
            for side, lo, hi in ivs:
                for b_, ivs2 in dl.items():
                    if b_ != a and any(s2 == -side and min(hi, hi2) - max(lo, lo2) > 0 for s2, lo2, hi2 in ivs2):
                        if find(a) != find(b_):
                            parent[find(a)] = find(b_)
                if fp_tree is None:
                    continue
                # an edge on +180 faces land on -180 and vice versa
                probe = box(-180.0, lo, -180.0 + 1e-5, hi) if side == 1 else box(180.0 - 1e-5, lo, 180.0, hi)
                for x in fp_tree.query(probe, predicate='intersects'):
                    i = int(fp_ids[int(x)])
                    seg = shapely.intersection(raw[i], probe)
                    if not seg.is_empty and seg.bounds[3] - seg.bounds[1] > 1e-6:  # runs along the line
                        cross[a].add(i)
        groups: dict[int, list[int]] = defaultdict(list)
        for a in range(len(comps)):
            groups[find(a)].append(a)
        return [groups[r] for r in sorted(groups)], nbrs, cross

    # ------------------------------------------------------------- c1 pockets
    def _pocket(self, gm: MultiPolygon, nbrs: list[int], raw) -> list[tuple[int, MultiPolygon, float]]:
        """Fill a pocket: wholly to its only neighbour, else split by nearest boundary."""
        if len(nbrs) == 1:
            return [(nbrs[0], gm, C.area_km2(gm))]
        M = self.metas
        frame = G.LocalFrame.around([gm])
        diam = G.km_extent(frame, gm)
        w, e = G.lon_extent([gm])
        b = gm.bounds
        rects = G.window_rects(w, b[1], e, b[3], min(diam, 400.0) + 5.0)
        local = {i: self.local_key(raw[i], rects) for i in nbrs}
        order = sorted(nbrs, key=lambda i: (local[i], M[i]['pid'], i))
        key = ('pocket', G.wkb_hash(gm), tuple((local[i], M[i]['pid']) for i in order))
        hit = self.c_pocket.get(key)
        if hit is None:
            try:
                regions = G.nearest_regions(frame, [raw[i] for i in order], rects, self._spacing(diam),
                                            around=frame.to_local(gm))
                got, rest = G.split_by_regions(gm, regions)
            except shapely.errors.GEOSException as ex:
                # fall back to whole polygons: each to the neighbour footprint nearest to it
                self.errors.append(f'pocket split at {[round(v, 3) for v in gm.bounds]}: {ex}')
                polys_of: list[list] = [[] for _ in order]
                for poly in gm.geoms:
                    best = min(range(len(order)), key=lambda p: (shapely.distance(poly, raw[order[p]]), p))
                    polys_of[best].append(poly)
                got = [MultiPolygon(ps) if ps else G.EMPTY for ps in polys_of]
                rest = G.EMPTY
            if not rest.is_empty:  # numerical leftovers: give each to its nearest piece
                got = self._attach_rest(rest, got)
            hit = self.c_pocket.put(key, [(pos, g, C.area_km2(g)) for pos, g in enumerate(got) if not g.is_empty])
        return [(order[pos], g, a) for pos, g, a in hit]

    @staticmethod
    def _attach_rest(rest, got):
        got = list(got)
        for poly in rest.geoms:
            best, bd = 0, math.inf
            for pos, g in enumerate(got):
                if not g.is_empty:
                    dd = shapely.distance(poly, g)
                    if dd < bd:
                        best, bd = pos, dd
            got[best] = G.union([got[best], MultiPolygon([poly])])
        return got

    @staticmethod
    def _spacing(diam_km: float) -> float:
        """Boundary densification: SPACING_KM, coarser for very large pockets."""
        return max(SPACING_KM, diam_km / 400.0)

    # ------------------------------------------------------------- c2 coastal gaps
    def _coast_band(self, tile) -> tuple:
        """(frame, window rects, local band of land within BAND_KM of the sea) of a tile."""
        hit = self.c_band.get(tile)
        if hit is not None:
            return hit
        r = tile_rect(tile)
        frame = G.LocalFrame((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)
        rects = G.window_rects(r[0], r[1], r[2], r[3], TILE_MARGIN_KM)
        env = frame.window_local(rects)
        parts = []
        for rr in rects:
            for x in self.land.tree.query(box(*rr)):
                c = shapely.clip_by_rect(self.land.parts[int(x)], *rr)
                if not c.is_empty:
                    parts.append(frame.to_local(c))
        land_l = shapely.union_all(parts) if parts else Polygon()
        sea = shapely.difference(env, land_l)
        if sea.is_empty or sea.area < 1e-6:
            band = Polygon()
        else:
            band = shapely.intersection(shapely.buffer(shapely.simplify(sea, 0.1), BAND_KM, quad_segs=8), env)
        hit = self.c_band[tile] = (frame, rects, band)
        return hit

    def _coastal_gaps(self, comp: Polygon, nbrs: list[int], raw) -> list[tuple[int, MultiPolygon, float]]:
        """Rule c2 for one large uncovered component, tile by tile."""
        out = []
        M = self.metas
        cg = MultiPolygon([comp])
        nb_boxes = [(i, raw[i].bounds) for i in nbrs]
        for tile in tiles_for(comp.bounds):
            r = tile_rect(tile)
            rects = G.window_rects(r[0], r[1], r[2], r[3], TILE_MARGIN_KM)
            cand = [i for i, b in nb_boxes
                    if any(b[0] <= rr[2] and b[2] >= rr[0] and b[1] <= rr[3] and b[3] >= rr[1] for rr in rects)]
            if not cand:
                continue
            boxes = [box(*rr) for rr in rects]
            near = [i for i in cand if any(shapely.intersects(raw[i], bx) for bx in boxes)]
            if not near:
                continue
            in_tile = G.clip_rects(cg, [r])
            if in_tile.is_empty:
                continue
            frame, rects, band = self._coast_band(tile)
            if band.is_empty:
                continue
            u_win = G.clip_rects(cg, rects)
            local = {i: self.local_key(raw[i], rects) for i in near}
            order = sorted(near, key=lambda i: (local[i], M[i]['pid'], i))
            key = ('tile', tile, G.wkb_hash(u_win), tuple((local[i], M[i]['pid']) for i in order))
            hit = self.c_tile.get(key)
            if hit is None:
                try:
                    jobs = self._tile_job(frame, rects, band, in_tile, u_win, [raw[i] for i in order])
                except shapely.errors.GEOSException as ex:  # leave this tile's gap unclaimed, report it
                    self.errors.append(f'coastal gap tile {tile}: {ex}')
                    jobs = []
                hit = self.c_tile.put(key, [(pos, g, C.area_km2(g)) for pos, g in jobs])
            out.extend((order[pos], g, a) for pos, g, a in hit)
        return out

    def _tile_job(self, frame, rects, band, in_tile, u_win, owners) -> list[tuple[int, MultiPolygon]]:
        u_l = G.valid(frame.to_local(u_win))
        opening = G.opening_local(u_l, CLOSE_KM, OVERSHOOT_KM) if CLOSE_KM > 0 else None
        owners_l = [G.valid(frame.to_local(G.clip_rects(g, rects))) for g in owners]
        pol_band = shapely.buffer(shapely.union_all([o for o in owners_l if not o.is_empty]), BAND_KM, quad_segs=8)
        mask = shapely.intersection(band, pol_band)
        if opening is not None and not opening.is_empty:
            mask = shapely.difference(mask, opening)
        if mask.is_empty:
            return []
        gap = G.inter(in_tile, frame.to_lonlat(mask))
        if gap.is_empty:
            return []
        if len(owners) == 1:
            return [(0, gap)]
        regions = G.nearest_regions(frame, owners, rects, SPACING_KM, max_km=BAND_KM, around=frame.to_local(gap))
        got, _rest = G.split_by_regions(gap, regions)
        return [(pos, g) for pos, g in enumerate(got) if not g.is_empty]

    # ------------------------------------------------------------- final geometry
    def _final1(self, R0, clipped, won, lost, pieces):
        final, token, changed = {}, {}, set()
        for i in R0:
            w_, l_, ps = won.get(i, set()), lost.get(i, set()), pieces.get(i, [])
            if not w_ and not l_ and not ps:
                final[i], token[i] = clipped[i], ('clip', i)
                continue
            key = ('f1', i, frozenset(w_), frozenset(l_), frozenset(G.wkb_hash(g) for g in ps))
            g = self.c_final.get(key)
            if g is None:
                g = self.c_final.put(key, self._assemble(i, clipped[i], w_, l_, ps))
            final[i], token[i] = g, key
            if l_:
                changed.add(i)
        return final, token, changed

    def _assign(self, f, t, real0, R1, final, token, changed, counts):
        """Rule (d): overrides.apply_assign_ops on the frame. Returns (log, added, removed)."""
        if self.assign_fn is None or not any(a <= t and b >= f for a, b in self.assign_years):
            return [], [], []
        M = self.metas

        def props(i):
            return {k: v for k, v in M[i].items() if not k.startswith('_') and k not in
                    ('coverage', 'parts_hit', 'parts_full', 'raw_hash')}
        frame_records = [dict(props(i), geometry=final[i]) for i in real0]
        frame_records += [dict(props(i), geometry=self.get_clipped(i)) for i in R1]
        by_rid = {M[i]['rid']: i for i in real0}
        saved = getattr(self.ctx, 'record_lookup', None)
        self.ctx.record_lookup = self.lookup
        try:
            out, alog = self.assign_fn(frame_records, (f, t), self.ov, self.ctx)
        finally:
            self.ctx.record_lookup = saved
        added, removed, seen = [], [], set()
        for r in out:
            i = by_rid.get(r['rid'])
            if i is None:
                continue
            seen.add(i)
            if r['geometry'] is not final[i]:
                ng = G.snap(r['geometry'])
                added.append(G.diff(ng, final[i]))
                removed.append(G.diff(final[i], ng))
                final[i], token[i] = ng, ('pg2', G.wkb_hash(ng))
                changed.add(i)
        for i in real0:
            if i not in seen:  # emptied and dropped by an assign
                removed.append(final[i])
                final[i], token[i] = G.EMPTY, ('pg2', b'empty')
                changed.add(i)
        counts['assign_applied'] += sum(1 for e in alog if e.get('status') == 'applied')
        add_all = G.union(added)
        if not add_all.is_empty:  # blockers give way to assigned land
            for i in final:
                if is_blocker(M[i]) and final[i].intersects(add_all):
                    final[i] = G.diff(final[i], add_all)
                    token[i] = ('blk', G.wkb_hash(final[i]))
        return alog, added, removed

    def _overlaps(self, real0, raw, clipped, final, token, changed, counts, f, t):
        """Rule (e): the smaller polity (by area on land) keeps an overlap."""
        M = self.metas
        size = {i: (M[i].get('clip_area') or 0.0, i) for i in real0}
        partners: dict[int, list[int]] = defaultdict(list)
        if len(real0) > 1:
            tree = STRtree([raw[i] for i in real0])
            q = tree.query([raw[i] for i in real0], predicate='intersects')
            for a, b in zip(q[0], q[1]):
                if a < b:
                    i, j = real0[int(a)], real0[int(b)]
                    if self._overlap(i, j, raw, clipped) is not None:
                        partners[i].append(j)
                        partners[j].append(i)
        final3, token3, log = {}, {}, []
        for i in real0:
            subs, keys = [], []
            for j in sorted(partners.get(i, ())):
                if size[j] >= size[i]:
                    continue
                o = self.c_overlap.get((min(i, j), max(i, j)))
                if j in changed:
                    o = G.inter(o, final[j])
                    keys.append((j, token[j]))
                else:
                    keys.append((j, 'O'))
                if not o.is_empty:
                    subs.append(o)
            if not subs:
                final3[i], token3[i] = final[i], token[i]
                continue
            key = ('f3', token[i], tuple(keys))
            g = self.c_final3.get(key)
            if g is None:
                g = self.c_final3.put(key, G.diff(final[i], G.union(subs)))
                km2 = self.area(token[i], final[i]) - self.area(key, g)
                counts['overlap_pairs'] += len(subs)
                counts['overlap_km2'] += km2
                for j, _ in keys:
                    pair = (M[i]['rid'], M[j]['rid'])
                    if pair in self.logged_overlaps:
                        continue
                    self.logged_overlaps.add(pair)
                    okm2 = C.area_km2(self.c_overlap.get((min(i, j), max(i, j))) or G.EMPTY)
                    if okm2 > OVERLAP_LOG_KM2:
                        log.append({'kept_by': M[j]['rid'], 'removed_from': M[i]['rid'], 'km2': round(okm2, 1),
                                    'first_frame': [f, t]})
            final3[i], token3[i] = g, key
        return final3, token3, log

    def _overlap(self, i: int, j: int, raw, clipped):
        key = (min(i, j), max(i, j))
        if key in self.c_overlap:
            return self.c_overlap.get(key)
        o = G.inter(raw[i], raw[j])
        if not o.is_empty:
            o = G.inter(clipped[i], clipped[j])
        return self.c_overlap.put(key, None if o.is_empty else o)

    def _blockers(self, R0, real0, final, final3) -> list:
        """Blockers lose every overlap with real polities; what is left is unclaimed."""
        M = self.metas
        blk = [i for i in R0 if is_blocker(M[i])]
        if not blk:
            return []
        live = [i for i in real0 if not final3[i].is_empty]
        tree = STRtree([final3[i] for i in live]) if live else None
        out = []
        for i in blk:
            g = final[i]
            if tree is not None and not g.is_empty:
                hit = [final3[live[int(x)]] for x in tree.query(g, predicate='intersects')]
                if hit:
                    g = G.diff(g, G.union(hit))
            if not g.is_empty:
                out.append(g)
        return out

    def _adjust_unclaimed(self, items, minus, plus) -> list[tuple]:
        """Unclaimed polygons minus `minus` plus the polygons of `plus` (blocked land,
        land orphaned by assign entries). Works part by part and only on polygons that
        intersect or touch the change, so no world-wide union is needed."""
        items = list(items)
        if not minus.is_empty and items:
            hit = sorted(int(k) for k in STRtree([q for q, _, _ in items]).query(minus, predicate='intersects'))
            if hit:
                gone = set(hit)
                kept = [it for k, it in enumerate(items) if k not in gone]
                for k in hit:
                    q, _, part = items[k]
                    kept.extend((x, G.wkb_hash(x), part) for x in G.diff(q, minus).geoms)
                items = kept
        adds: dict[int, list] = defaultdict(list)
        for g in plus:
            gp = G.polys(g)
            for q, part in zip(gp, self.parts_of(gp)):
                adds[part].append(q)
        if not adds:
            return items
        by_part: dict[int, list] = defaultdict(list)
        for it in items:
            by_part[it[2]].append(it)
        for part, new in adds.items():
            cur = by_part.get(part, [])
            touch: set[int] = set()
            if cur:
                qa, _ = STRtree(new).query([q for q, _, _ in cur], predicate='intersects')
                touch = {int(k) for k in qa}
            key = ('uadd', frozenset(cur[k][1] for k in touch), frozenset(G.wkb_hash(q) for q in new))
            merged = self.c_rest.get(key)
            if merged is None:
                u = G.union([cur[k][0] for k in sorted(touch)] + new)
                merged = self.c_rest.put(key, [(x, G.wkb_hash(x)) for x in u.geoms])
            by_part[part] = [it for k, it in enumerate(cur) if k not in touch] + [(x, h, part) for x, h in merged]
        return [it for part in sorted(by_part) for it in by_part[part]]

    def _rest(self, comps, taken):
        rest, rest_part, hashes = [], [], []
        for a, c in enumerate(comps):
            gs = taken.get(a)
            if not gs:
                rest.append(c.poly)
                rest_part.append(c.part)
                hashes.append(c.hash)
                continue
            key = ('rest', c.hash, frozenset(G.wkb_hash(g) for g in gs))
            r = self.c_rest.get(key)
            if r is None:
                r = self.c_rest.put(key, [(p, G.wkb_hash(p)) for p in G.diff(MultiPolygon([c.poly]), G.union(gs)).geoms])
            for p, h in r:
                rest.append(p)
                rest_part.append(c.part)
                hashes.append(h)
        self._rest_hashes = hashes
        return rest, rest_part

    def _unclaimed_islands(self, rest: list, rest_part: list[int]) -> list[tuple[int, float]]:
        """Islands (not the continental landmasses) at least half unclaimed:
        [(island, km2)], largest first (top 200)."""
        per: dict[int, float] = defaultdict(float)
        land = self.land
        for poly, p, h in zip(rest, rest_part, self._rest_hashes):
            k = int(land.island_of[p])
            if land.island_area[k] > CONTINENT_KM2:
                continue
            per[k] += self.area(('rest', h), poly)
        out = [(k, a) for k, a in per.items() if a >= 0.5 * land.island_area[k]]
        out.sort(key=lambda ka: -ka[1])
        return out[:200]
