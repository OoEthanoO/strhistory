"""Static Natural Earth land index used by every geometry step.

* parts         Natural Earth 10m land + minor islands, dissolved, snapped to the grid
                (each part is one Polygon; parts are disjoint)
* islands       "logical islands": parts joined across the antimeridian. Natural Earth
                cuts land at +/-180, so Chukotka east of 180 deg, Wrangel Island and
                Vanua Levu (Fiji) are two parts each; parts whose +180 and -180 edges
                overlap in latitude form one island (Antarctica joins only itself)
* lakes         Natural Earth 10m lakes (they are land in ne_10m_land)

Built once and cached in .cache/build/geom/land.pkl (keyed by the pinned NE hashes).
"""
from __future__ import annotations

import json
import os
import pickle
import time
from functools import cached_property

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import MultiPolygon, shape

import common as C
import geom as G

GEOM_DIR = os.path.join(C.BUILD, 'geom')
CACHE_FILE = os.path.join(GEOM_DIR, 'land.pkl')
SOURCE_KEY = json.dumps(C.CONFIG['sources']['naturalearth']['layers'], sort_keys=True) + f'|grid={G.GRID}'


def _dateline_intervals(p) -> list[tuple[int, float, float]]:
    """(side, lat_lo, lat_hi) of every boundary edge lying on lon = +180 (side 1) or
    -180 (side -1)."""
    out = []
    for ring in [p.exterior, *p.interiors]:
        xy = np.asarray(ring.coords)
        x0, x1 = xy[:-1, 0], xy[1:, 0]
        for side in (1, -1):
            on = (x0 == 180.0 * side) & (x1 == 180.0 * side)
            for i in np.nonzero(on)[0]:
                a, b = xy[i, 1], xy[i + 1, 1]
                if a != b:
                    out.append((side, min(a, b), max(a, b)))
    return out


def _build() -> dict:
    t = time.time()
    ctx = C.Ctx()
    raw = MultiPolygon([q for p in ctx.land_parts for q in G.polys(p)])
    snapped = G.snap(raw)
    parts = list(snapped.geoms)
    # deterministic order: by bbox (west, south) then area
    parts.sort(key=lambda p: (round(p.bounds[0], 6), round(p.bounds[1], 6), -p.area))
    area = np.array([C.area_km2(p) for p in parts])

    # antimeridian joins (union-find)
    parent = list(range(len(parts)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    east, west = [], []  # (lat_lo, lat_hi, part)
    for i, p in enumerate(parts):
        b = p.bounds
        if b[0] > -180.0 and b[2] < 180.0:
            continue
        for side, lo, hi in _dateline_intervals(p):
            (east if side == 1 else west).append((lo, hi, i))
    joins = []
    for lo, hi, i in east:
        for lo2, hi2, j in west:
            if min(hi, hi2) - max(lo, lo2) > 0:
                if find(i) != find(j):
                    parent[find(i)] = find(j)
                joins.append((i, j))
    roots = {}
    island_of = np.zeros(len(parts), dtype=np.int32)
    for i in range(len(parts)):
        island_of[i] = roots.setdefault(find(i), len(roots))
    islands = [[] for _ in range(len(roots))]
    for i, k in enumerate(island_of):
        islands[k].append(i)

    lakes = []
    with open(os.path.join(C.NE_DIR, 'ne_10m_lakes.geojson'), encoding='utf-8') as f:
        for feat in json.load(f)['features']:
            lakes.extend(G.polys(shape(feat['geometry'])))
    data = {
        'key': SOURCE_KEY,
        'parts': shapely.to_wkb(np.array(parts, dtype=object)),
        'area': area,
        'island_of': island_of,
        'islands': islands,
        'joins': sorted(set(joins)),
        'lakes': shapely.to_wkb(np.array(lakes, dtype=object)),
    }
    C.save_pickle(CACHE_FILE, data)
    print(f'[land] built land index: {len(parts)} parts, {len(islands)} islands, {len(joins)} antimeridian joins, '
          f'{len(lakes)} lakes ({time.time() - t:.1f} s)', flush=True)
    return data


class Land:
    """Natural Earth land parts, logical islands and lakes (see module docstring)."""

    def __init__(self, data: dict | None = None):
        if data is None:
            data = None
            if os.path.exists(CACHE_FILE):
                data = C.load_pickle(CACHE_FILE)
                if data.get('key') != SOURCE_KEY:
                    data = None
            if data is None:
                data = _build()
        self.parts: list = list(shapely.from_wkb(data['parts']))
        self.area: np.ndarray = data['area']
        self.island_of: np.ndarray = data['island_of']
        self.islands: list[list[int]] = data['islands']
        self.joins: list[tuple[int, int]] = data['joins']
        self._lakes_wkb = data['lakes']
        self.island_area = np.array([float(self.area[ps].sum()) for ps in self.islands])
        self.total_area = float(self.area.sum())

    @classmethod
    def from_parts(cls, parts: list) -> 'Land':
        """Small in-memory land for tests (no antimeridian joins unless parts touch +/-180)."""
        parts = [p for g in parts for p in G.polys(G.snap(g))]
        area = np.array([C.area_km2(p) for p in parts])
        land = cls.__new__(cls)
        land.parts, land.area = parts, area
        # joins
        parent = list(range(len(parts)))

        def find(i):
            while parent[i] != i:
                i = parent[i]
            return i
        east, west = [], []
        for i, p in enumerate(parts):
            for side, lo, hi in _dateline_intervals(p):
                (east if side == 1 else west).append((lo, hi, i))
        joins = []
        for lo, hi, i in east:
            for lo2, hi2, j in west:
                if min(hi, hi2) - max(lo, lo2) > 0:
                    if find(i) != find(j):
                        parent[find(i)] = find(j)
                    joins.append((i, j))
        roots = {}
        land.island_of = np.array([roots.setdefault(find(i), len(roots)) for i in range(len(parts))], dtype=np.int32)
        land.islands = [[] for _ in range(len(roots))]
        for i, k in enumerate(land.island_of):
            land.islands[k].append(i)
        land.joins = joins
        land._lakes_wkb = shapely.to_wkb(np.array([], dtype=object))
        land.island_area = np.array([float(area[ps].sum()) for ps in land.islands])
        land.total_area = float(area.sum())
        return land

    @cached_property
    def tree(self) -> STRtree:
        return STRtree(self.parts)

    @cached_property
    def multipolygon(self) -> MultiPolygon:
        return MultiPolygon(self.parts)

    @cached_property
    def lakes(self) -> list:
        return list(shapely.from_wkb(self._lakes_wkb)) if len(self._lakes_wkb) else []

    @cached_property
    def lake_tree(self) -> STRtree:
        return STRtree(self.lakes)

    def island_geom(self, k: int) -> MultiPolygon:
        ps = self.islands[k]
        return MultiPolygon([self.parts[i] for i in ps])

    def island_touches_dateline(self, k: int) -> bool:
        return any(self.parts[i].bounds[0] <= -180.0 or self.parts[i].bounds[2] >= 180.0 for i in self.islands[k])

    def lake_km2(self, g) -> float:
        """Area of g covered by Natural Earth lakes."""
        if not self.lakes or g.is_empty:
            return 0.0
        hits = self.lake_tree.query(g, predicate='intersects')
        if not len(hits):
            return 0.0
        return C.area_km2(G.mp(shapely.intersection(g, shapely.union_all([self.lakes[int(i)] for i in hits]))))


def load_land() -> Land:
    return Land()


if __name__ == '__main__':
    t = time.time()
    if os.path.exists(CACHE_FILE):
        os.remove(CACHE_FILE)
    land = Land()
    big = np.argsort(-land.island_area)[:8]
    print(f'{len(land.parts)} parts, {len(land.islands)} islands, total {land.total_area:,.0f} km2 ({time.time() - t:.1f} s)')
    for k in big:
        print(f'  island {k}: {len(land.islands[k])} part(s), {land.island_area[k]:,.0f} km2')
    for i, j in land.joins:
        print(f'  join part {i} {[round(b, 2) for b in land.parts[i].bounds]} <-> part {j} {[round(b, 2) for b in land.parts[j].bounds]}')
