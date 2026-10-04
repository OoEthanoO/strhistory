"""Geometry helpers for the geometry core: a fixed precision grid, local azimuthal
frames (km) that handle the antimeridian, geodesic distances and nearest-boundary
allocation (Voronoi).

Precision. Every geometry is snapped to a 1e-6 degree grid (Natural Earth's native
precision, ~0.1 m) and every overlay uses the same `grid_size`. GEOS then
snap-rounds: two results computed from the same edges get identical vertices, so
neighbouring polygons share their borders exactly and slivers narrower than the
grid collapse instead of turning into micro-gaps.

Local frames. Distances, buffers and Voronoi diagrams need metric coordinates. A
`LocalFrame` is a spherical azimuthal-equidistant projection in km centred on the
area being processed (exact distances from the centre, < 0.5 % error elsewhere at
the few-hundred-km scales used here). Geometry is cut to lon/lat windows around the
centre before projecting (`window_rects` returns two rectangles when a window
crosses +/-180), and results are un-projected, unwrapped around the centre and cut
back at +/-180 (`to_lonlat`).
"""
from __future__ import annotations

import hashlib
import math
from typing import Iterable, Sequence

import numpy as np
import shapely
import shapely.affinity
import shapely.errors
import shapely.ops
from shapely.geometry import MultiPolygon, Polygon, box
from pyproj import Geod

import common as C

GRID = float(C.CONFIG.get('geometry', {}).get('gridDeg', 1e-6))
R_EARTH_KM = 6371.0088          # mean Earth radius (IUGG)
KM_PER_DEG = math.pi * R_EARTH_KM / 180.0
TOUCH_DEG = 1e-5                # ~1 m: closer than this counts as touching
GEOD = Geod(ellps='WGS84')
EMPTY = MultiPolygon()


# ------------------------------------------------------------------ precision grid


def mp(g) -> MultiPolygon:
    """The polygonal parts of g as a MultiPolygon (empty if none). No validity check:
    use it on GEOS overlay output (valid by construction); external input goes
    through snap()."""
    if g is None:
        return EMPTY
    t = shapely.get_type_id(g)
    if t == 6:
        return g
    if t == 3:
        return EMPTY if g.is_empty else MultiPolygon([g])
    if t == 7:
        out = []
        stack = list(shapely.get_parts(g))
        while stack:
            p = stack.pop(0)
            tp = shapely.get_type_id(p)
            if tp == 3 and not p.is_empty:
                out.append(p)
            elif tp == 6:
                out.extend(shapely.get_parts(p))
            elif tp == 7:
                stack.extend(shapely.get_parts(p))
        return MultiPolygon(out) if out else EMPTY
    return EMPTY


def snap(g) -> MultiPolygon:
    """g (any input, possibly invalid) repaired, on the precision grid, polygonal."""
    g = C.polygonal(g)
    if g.is_empty:
        return g
    return mp(shapely.set_precision(g, GRID))


def inter(a, b) -> MultiPolygon:
    if a is None or b is None or a.is_empty or b.is_empty:
        return EMPTY
    return mp(shapely.intersection(a, b, grid_size=GRID))


def diff(a, b) -> MultiPolygon:
    if a is None or a.is_empty:
        return EMPTY
    if b is None or b.is_empty:
        return mp(a)
    return mp(shapely.difference(a, b, grid_size=GRID))


def union(geoms: Iterable) -> MultiPolygon:
    gs = [g for g in geoms if g is not None and not g.is_empty]
    if not gs:
        return EMPTY
    if len(gs) == 1:
        return mp(gs[0])
    return mp(shapely.union_all(gs, grid_size=GRID))


def valid(g):
    """g itself when GEOS considers it valid, else its polygonal make_valid repair.
    Geometry projected into a local frame can self-intersect where thin features
    meet the window edge; overlays on such input raise TopologyException."""
    if g is None or g.is_empty or shapely.is_valid(g):
        return g
    return mp(shapely.make_valid(g))


def polys(g) -> list[Polygon]:
    """The polygons of a (multi)polygon as a list."""
    g = mp(g)
    return list(g.geoms)


def wkb_hash(g) -> bytes:
    """Content hash of a geometry (normalised, so vertex order does not matter)."""
    if g is None or g.is_empty:
        return b'empty'
    return hashlib.blake2b(shapely.to_wkb(shapely.normalize(g)), digest_size=16).digest()


def same_geometry(a, b, tol_km2: float = 1e-6) -> bool:
    """Identical geometry: same normalised WKB, or symmetric difference < tol_km2."""
    if a is b:
        return True
    if a.is_empty or b.is_empty:
        return a.is_empty and b.is_empty
    if shapely.to_wkb(shapely.normalize(a)) == shapely.to_wkb(shapely.normalize(b)):
        return True
    if not shapely.intersects(shapely.box(*a.bounds), shapely.box(*b.bounds)):
        return False
    if abs(a.area - b.area) > 1e-6:  # degrees^2: way above tol_km2 everywhere
        return False
    return C.area_km2(mp(shapely.symmetric_difference(a, b, grid_size=GRID))) < tol_km2


# ------------------------------------------------------------------------- windows


def lon_extent(geoms: Sequence) -> tuple[float, float]:
    """(west, east) of the smallest longitude interval holding all geoms, unwrapped
    so that east may exceed 180 when the interval crosses the antimeridian."""
    ivs = []
    for g in geoms:
        if g is None or g.is_empty:
            continue
        for p in polys(g):
            w, _, e, _ = p.bounds
            ivs.append((w, e))
    if not ivs:
        return (0.0, 0.0)
    return circular_interval(ivs)


def circular_interval(ivs: list[tuple[float, float]]) -> tuple[float, float]:
    """Smallest arc of the longitude circle covering all intervals (w <= e, each in
    [-180, 180]). Returns (w, e) with e possibly > 180 (unwrapped)."""
    ivs = sorted(ivs)
    merged = []
    for w, e in ivs:
        if merged and w <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], e)
        else:
            merged.append([w, e])
    if len(merged) == 1:
        return (merged[0][0], merged[0][1])
    # largest gap between consecutive merged intervals (circularly)
    best, bi = -1.0, None
    for i in range(len(merged)):
        a_end = merged[i][1]
        b_start = merged[(i + 1) % len(merged)][0] + (360 if i == len(merged) - 1 else 0)
        gap = b_start - a_end
        if gap > best:
            best, bi = gap, i
    if bi == len(merged) - 1:  # the largest gap wraps around: no crossing
        return (merged[0][0], merged[-1][1])
    w = merged[bi + 1][0]
    e = merged[bi][1] + 360
    return (w, e)


def window_rects(w: float, s: float, e: float, n: float, margin_km: float) -> list[tuple]:
    """Lon/lat rectangles covering the box (w..e may be unwrapped, e <= w + 360)
    grown by margin_km on every side; split at +/-180, full longitude near poles."""
    dlat = margin_km / KM_PER_DEG
    s2, n2 = max(s - dlat, -90.0), min(n + dlat, 90.0)
    maxlat = max(abs(s2), abs(n2))
    if maxlat >= 89.0:
        return [(-180.0, s2, 180.0, n2)]
    dlon = margin_km / (KM_PER_DEG * math.cos(math.radians(maxlat)))
    w2, e2 = w - dlon, e + dlon
    if e2 - w2 >= 360.0:
        return [(-180.0, s2, 180.0, n2)]
    # normalise so that w2 is in [-180, 180)
    while w2 >= 180.0:
        w2, e2 = w2 - 360.0, e2 - 360.0
    while w2 < -180.0:
        w2, e2 = w2 + 360.0, e2 + 360.0
    if e2 <= 180.0:
        return [(w2, s2, e2, n2)]
    return [(w2, s2, 180.0, n2), (-180.0, s2, e2 - 360.0, n2)]


def clip_rects(g, rects: list[tuple]):
    """Parts of g inside the rectangles (clip_by_rect; polygonal result)."""
    if g is None or g.is_empty:
        return EMPTY
    out = []
    for r in rects:
        bx = g.bounds
        if bx[2] < r[0] or bx[0] > r[2] or bx[3] < r[1] or bx[1] > r[3]:
            continue
        if bx[0] >= r[0] and bx[2] <= r[2] and bx[1] >= r[1] and bx[3] <= r[3]:
            out.append(g)
            continue
        c = shapely.clip_by_rect(g, *r)
        if not c.is_empty:
            out.append(c)
    if not out:
        return EMPTY
    if len(out) == 1:
        return mp(out[0])
    return MultiPolygon([p for o in out for p in polys(o)])


def rects_boxes(rects: list[tuple]) -> list:
    return [box(*r) for r in rects]


# --------------------------------------------------------------------- local frame


class LocalFrame:
    """Spherical azimuthal-equidistant projection in km centred at (lon0, lat0)."""

    def __init__(self, lon0: float, lat0: float):
        lon0 = ((lon0 + 180.0) % 360.0) - 180.0
        self.lon0, self.lat0 = lon0, lat0
        self._l0 = math.radians(lon0)
        self._p0 = math.radians(lat0)
        self._sp0, self._cp0 = math.sin(self._p0), math.cos(self._p0)

    @classmethod
    def around(cls, geoms: Sequence) -> 'LocalFrame':
        w, e = lon_extent(geoms)
        lats = [b for g in geoms if g is not None and not g.is_empty for b in (g.bounds[1], g.bounds[3])]
        return cls((w + e) / 2.0, (min(lats) + max(lats)) / 2.0 if lats else 0.0)

    # numpy kernels ----------------------------------------------------------------
    def fwd(self, xy: np.ndarray) -> np.ndarray:
        lam = np.radians(xy[:, 0]) - self._l0
        phi = np.radians(xy[:, 1])
        sphi, cphi = np.sin(phi), np.cos(phi)
        slam, clam = np.sin(lam), np.cos(lam)
        # haversine central angle (stable for small distances)
        dphi = phi - self._p0
        h = np.sin(dphi / 2) ** 2 + self._cp0 * cphi * np.sin(lam / 2) ** 2
        c = 2 * np.arcsin(np.sqrt(np.clip(h, 0.0, 1.0)))
        az = np.arctan2(slam * cphi, self._cp0 * sphi - self._sp0 * cphi * clam)
        r = R_EARTH_KM * c
        return np.column_stack([r * np.sin(az), r * np.cos(az)])

    def inv(self, xy: np.ndarray) -> np.ndarray:
        x, y = xy[:, 0], xy[:, 1]
        c = np.hypot(x, y) / R_EARTH_KM
        az = np.arctan2(x, y)
        sc, cc = np.sin(c), np.cos(c)
        phi = np.arcsin(np.clip(self._sp0 * cc + self._cp0 * sc * np.cos(az), -1.0, 1.0))
        lam = np.arctan2(np.sin(az) * sc * self._cp0, cc - self._sp0 * np.sin(phi))
        return np.column_stack([self.lon0 + np.degrees(lam), np.degrees(phi)])

    # geometry ---------------------------------------------------------------------
    def to_local(self, g):
        if g is None or g.is_empty:
            return g
        return shapely.transform(g, self.fwd)

    def to_lonlat(self, g) -> MultiPolygon:
        """Local polygon(s) back to lon/lat: unwrapped around lon0, cut at +/-180,
        snapped to the grid."""
        if g is None or g.is_empty:
            return EMPTY
        ll = mp(shapely.make_valid(shapely.transform(mp(g), self.inv)))
        if ll.is_empty:
            return EMPTY
        w, _, e, _ = ll.bounds
        if w >= -180.0 and e <= 180.0:
            return snap(ll)
        pieces = [shapely.clip_by_rect(ll, -180.0, -90.0, 180.0, 90.0)]
        if e > 180.0:
            pieces.append(shapely.affinity.translate(shapely.clip_by_rect(ll, 180.0, -90.0, 540.0, 90.0), xoff=-360.0))
        if w < -180.0:
            pieces.append(shapely.affinity.translate(shapely.clip_by_rect(ll, -540.0, -90.0, -180.0, 90.0), xoff=360.0))
        return snap(union([snap(p) for p in pieces]))

    def window_local(self, rects: list[tuple], step_deg: float = 0.25) -> Polygon:
        """The window rectangles as one local polygon (edges densified)."""
        parts = [self.to_local(shapely.segmentize(box(*r), step_deg)) for r in rects]
        return shapely.make_valid(shapely.union_all(parts)) if len(parts) > 1 else parts[0]


def km_distance(a, b, frame: LocalFrame | None = None) -> float:
    """Geodesic (WGS84) distance in km between two lon/lat geometries, 0 when they
    touch or overlap (closer than TOUCH_DEG). Nearest points are found in a local
    frame (antimeridian-safe); the distance between them is then measured on the
    ellipsoid."""
    if a.is_empty or b.is_empty:
        return math.inf
    if shapely.dwithin(a, b, TOUCH_DEG):
        return 0.0
    frame = frame or LocalFrame.around([a])
    la, lb = frame.to_local(a), frame.to_local(b)
    if shapely.dwithin(la, lb, 0.005):  # 5 m: touching (e.g. across +/-180) up to projection noise
        return 0.0
    pa, pb = shapely.ops.nearest_points(la, lb)
    ll = frame.inv(np.array([[pa.x, pa.y], [pb.x, pb.y]]))
    return GEOD.inv(ll[0, 0], ll[0, 1], ll[1, 0], ll[1, 1])[2] / 1000.0


def km_extent(frame: LocalFrame, g) -> float:
    """Diameter-ish size (km) of g in the frame (bbox diagonal)."""
    if g is None or g.is_empty:
        return 0.0
    x0, y0, x1, y1 = frame.to_local(g).bounds
    return math.hypot(x1 - x0, y1 - y0)


# ------------------------------------------------------------- nearest-boundary split


def boundary_points(g_local, spacing_km: float) -> np.ndarray:
    """Vertices of g's boundary densified to spacing_km, as an (N, 2) array."""
    if g_local is None or g_local.is_empty:
        return np.empty((0, 2))
    b = shapely.segmentize(shapely.boundary(g_local), spacing_km)
    return shapely.get_coordinates(b)


def nearest_regions(frame: LocalFrame, owners: list, rects: list[tuple], spacing_km: float,
                    max_km: float | None = None, around=None) -> list[MultiPolygon]:
    """For each owner geometry (lon/lat), the local region of points closer to its
    boundary than to any other owner's (Voronoi cells of densified boundary points,
    dissolved per owner), optionally limited to max_km from the owner. Regions are
    returned in lon/lat (grid-snapped), one per owner (empty when the owner has no
    boundary inside the window). `around` (local geometry) limits which boundary
    points are used to those within reach of it, keeping the diagram small."""
    env = frame.window_local(rects)
    pts, labels, locals_ = [], [], []
    reach = None
    if around is not None and not around.is_empty:
        reach = shapely.buffer(around, (max_km or 0.0) + 4 * spacing_km)
        shapely.prepare(reach)
    for k, g in enumerate(owners):
        gl = frame.to_local(clip_rects(g, rects))
        locals_.append(gl)
        p = boundary_points(gl, spacing_km)
        if reach is not None and len(p):
            keep = shapely.contains_xy(reach, p[:, 0], p[:, 1])
            p = p[keep]
        if len(p):
            pts.append(p)
            labels.append(np.full(len(p), k))
    out: list[MultiPolygon] = [EMPTY] * len(owners)
    if not pts:
        return out
    pts_a = np.vstack(pts)
    lab = np.concatenate(labels)
    # drop duplicate points (shared borders): the first owner keeps them
    _, first = np.unique(np.round(pts_a, 7), axis=0, return_index=True)
    first.sort()
    pts_a, lab = pts_a[first], lab[first]
    present = np.unique(lab)
    big_env = shapely.buffer(shapely.envelope(env), 10.0)
    if len(present) == 1:
        regions = {int(present[0]): big_env}
    else:
        cells = shapely.get_parts(shapely.voronoi_polygons(shapely.multipoints(pts_a), extend_to=big_env, ordered=True))
        if len(cells) != len(pts_a):  # should not happen with ordered=True and unique points
            raise RuntimeError(f'voronoi returned {len(cells)} cells for {len(pts_a)} points')
        regions = {}
        for k in present:
            sel = cells[lab == k]
            try:
                regions[int(k)] = shapely.coverage_union_all(sel)
            except shapely.errors.GEOSException:
                regions[int(k)] = shapely.union_all(sel)
    for k, reg in regions.items():
        if max_km is not None:
            reg = shapely.intersection(reg, shapely.buffer(locals_[k], max_km, quad_segs=8))
        reg = shapely.intersection(reg, shapely.buffer(env, 1.0))
        out[k] = frame.to_lonlat(reg)
    return out


def split_by_regions(target: MultiPolygon, regions: list[MultiPolygon]) -> tuple[list[MultiPolygon], MultiPolygon]:
    """Cut target (lon/lat) into one piece per region, in order, so pieces never
    overlap even where regions do; returns (pieces, rest not in any region)."""
    rest = target
    pieces = []
    for reg in regions:
        if rest.is_empty or reg.is_empty:
            pieces.append(EMPTY)
            continue
        piece = inter(rest, reg)
        if not piece.is_empty:
            rest = diff(rest, piece)
        pieces.append(piece)
    return pieces, rest


# -------------------------------------------------------------------------- misc


def opening_local(g_local, r_km: float, overshoot_km: float, simplify_km: float = 0.1):
    """Morphological opening of a local polygon (erode by r, dilate by r + overshoot):
    the parts of g at least 2r wide, slightly over-covering g's own boundary so that
    `g - opening` keeps only genuinely narrow parts."""
    if g_local is None or g_local.is_empty:
        return g_local
    s = shapely.simplify(g_local, simplify_km, preserve_topology=True)
    core = shapely.buffer(s, -r_km, quad_segs=8)
    if core.is_empty:
        return core
    return shapely.buffer(core, r_km + overshoot_km, quad_segs=8)


def bbox_lonlat(geoms: Sequence) -> list[float]:
    """[w, s, e, n] of geometries; when they cross the antimeridian w > e (RFC 7946
    section 5.2)."""
    w, e = lon_extent(geoms)
    lats = [b for g in geoms if g is not None and not g.is_empty for b in (g.bounds[1], g.bounds[3])]
    if e > 180.0:
        e -= 360.0
    return [round(w, 4), round(min(lats), 4), round(e, 4), round(max(lats), 4)]
