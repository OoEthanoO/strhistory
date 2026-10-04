"""Minimal TopoJSON decoder (numpy) and Web-Mercator helpers for tile QA.

Arcs follow the TopoJSON spec: with a `transform`, positions are quantised and
delta-encoded (cumulative sum, then position * scale + translate); a negative arc
index ~i means arc i reversed; consecutive arcs of a ring share their joint point
(the first point of every following arc is dropped).
"""
from __future__ import annotations

import json
import math

import numpy as np

MAX_LAT = 85.0511287798066


def decode_arcs(topo: dict) -> list[np.ndarray]:
    tr = topo.get('transform')
    out = []
    if tr:
        scale = np.asarray(tr['scale'], dtype=np.float64)
        trans = np.asarray(tr['translate'], dtype=np.float64)
    for a in topo['arcs']:
        arr = np.asarray(a, dtype=np.float64).reshape(-1, len(a[0]) if a else 2)[:, :2]
        if tr:
            arr = np.cumsum(arr, axis=0) * scale + trans
        out.append(arr)
    return out


def ring(arcs: list[np.ndarray], idxs: list[int]) -> np.ndarray:
    parts = []
    for k, i in enumerate(idxs):
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        parts.append(a if k == 0 else a[1:])
    r = np.concatenate(parts) if parts else np.zeros((0, 2))
    if len(r) and not np.array_equal(r[0], r[-1]):
        r = np.vstack([r, r[:1]])
    return r


def geometry_rings(arcs: list[np.ndarray], geom: dict) -> list[np.ndarray]:
    """All rings (outer and holes, lon/lat) of a Polygon / MultiPolygon / GeometryCollection."""
    t = geom.get('type')
    if t == 'Polygon':
        return [ring(arcs, r) for r in geom.get('arcs', [])]
    if t == 'MultiPolygon':
        return [ring(arcs, r) for poly in geom.get('arcs', []) for r in poly]
    if t == 'GeometryCollection':
        return [r for g in geom.get('geometries', []) for r in geometry_rings(arcs, g)]
    return []


def features(topo: dict, obj: str | None = None) -> list[dict]:
    """[{'props': dict, 'rings': [lon/lat arrays]}] for every geometry of an object."""
    arcs = decode_arcs(topo)
    name = obj or next(iter(topo['objects']))
    geoms = topo['objects'][name]
    geoms = geoms.get('geometries', [geoms]) if geoms.get('type') == 'GeometryCollection' else [geoms]
    return [{'props': g.get('properties') or {}, 'rings': geometry_rings(arcs, g)} for g in geoms]


def load(path: str) -> dict:
    with open(path, encoding='utf-8') as f:
        return json.load(f)


# ---------------------------------------------------------------------- Web Mercator
def lonlat_to_world(ll: np.ndarray) -> np.ndarray:
    """lon/lat -> Web-Mercator 'world pixels' at zoom 0 (0..256 in x and y, y down)."""
    lon = ll[:, 0]
    lat = np.clip(ll[:, 1], -MAX_LAT, MAX_LAT)
    x = (lon + 180.0) / 360.0 * 256.0
    s = np.sin(np.radians(lat))
    y = (0.5 - np.log((1 + s) / (1 - s)) / (4 * math.pi)) * 256.0
    return np.column_stack([x, y])


def tile_bounds_world(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(x0, y0, x1, y1) of a tile in zoom-0 world pixels."""
    s = 256.0 / (2 ** z)
    return x * s, y * s, (x + 1) * s, (y + 1) * s


def lonlat_tile(lon: float, lat: float, z: int) -> tuple[int, int]:
    w = lonlat_to_world(np.array([[lon, lat]], dtype=np.float64))[0]
    n = 2 ** z
    return min(n - 1, max(0, int(w[0] / 256.0 * n))), min(n - 1, max(0, int(w[1] / 256.0 * n)))


def tiles_for_bbox(bbox, z: int) -> list[tuple[int, int, int]]:
    w, s, e, n = bbox
    x0, y0 = lonlat_tile(w, n, z)
    x1, y1 = lonlat_tile(e, s, z)
    return [(z, x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
