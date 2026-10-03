"""Verifies the BUILT dataset (packages/borders/data) the way a client sees it.

Decodes the chunk TopoJSON of chosen years and LODs (no topojson library: delta-
decoded arcs + transform, exactly as topojson-client does) and measures, per year
and LOD, for the tier-0 features alive then (polities + unclaimed land):

  coverage  their union against Natural Earth 10m land + minor islands, unsimplified
            (land.py): union, sum of areas (sum - union = overlap), area missing from
            the union and area of the union off land (km2 and share of land)
  topology  arcs used by exactly one feature (exterior) whose vertices lie farther
            from the unsimplified coastline than quantization allows: gaps or slivers
            between neighbours (km, worst places); arcs used twice in one direction or
            by 3+ features: overlaps (km); thin polygon parts (mean width
            2 * area / perimeter under --thin-m metres)
  islands   every logical Natural Earth island (land.py: parts joined across 180 deg)
            by owner: islands of 1,000 km2 and more by area shares, smaller ones by
            the feature containing a point on the island; 'not drawn' when the LOD
            dropped it. Counts and areas per class, top owners, the largest islands
            still unclaimed (names from qa.py's report index)

and renders previews (matplotlib) of named regions from the built data: fills by
colour slot, unclaimed land pale, tier-1 hatched, borders (arcs shared by two
tier-0 features) white, exterior arcs black over the unsimplified coastline in
cyan, so any gap, sliver or misaligned coast shows up.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/steps/qa/verify_built.py
        [--data DIR] [--years 1500,1700,1800,1900,1950,2000,2026] [--lods l0,l1]
        [--previews british-isles:1800,aegean:1700,japan:1850,indonesia:1900,caribbean:1800,chukotka:1900]
        [--preview-lod l1] [--out .cache/build/verify] [--thin-m 50] [--no-islands]

Writes <out>/verify-report.json, <out>/verify-summary.md and <out>/<region>-<year>-<lod>.png.
Exit code 1 when a year/LOD has gaps or overlaps between neighbours above --max-gap-km.
"""
from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import MultiPolygon, Polygon, box

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'py'))
import common as C  # noqa: E402
from land import Land  # noqa: E402

REGIONS = {  # w, s, e, n (w > e: across the antimeridian)
    'british-isles': (-11.0, 49.5, 2.5, 61.0),
    'aegean': (19.5, 34.5, 29.5, 41.5),
    'japan': (128.0, 30.0, 146.5, 46.0),
    'philippines': (116.0, 4.5, 127.5, 21.0),
    'indonesia': (94.0, -11.5, 141.5, 7.0),
    'caribbean': (-86.0, 9.5, -59.0, 27.5),
    'chukotka': (160.0, 60.0, -165.0, 72.0),
    'canadian-arctic': (-125.0, 60.0, -60.0, 83.0),
    'scandinavia': (3.0, 54.0, 32.0, 71.5),
    'europe': (-12.0, 34.0, 42.0, 62.0),
}
PALETTE = ['#c9734f', '#5b8fb9', '#8db86a', '#d4b84a', '#a77bb8', '#5fb3a5', '#d98a9a', '#9c8f5a',
           '#6f7fc9', '#c99a5b', '#7aa36f', '#b86a6a', '#4f9cc9', '#b0b04f', '#8a6fb3', '#c97fb0']
UNCLAIMED = '#ece6d6'
OCEAN = '#dfe9f2'
KM_PER_DEG = 111.32
BIG_ISLAND_KM2 = 1000.0


def say(msg: str) -> None:
    print(f'[verify] {msg}', flush=True)


# ----------------------------------------------------------------------- decoding


class Chunk:
    """One decoded chunk file: arcs in lon/lat and the polities' geometries."""

    def __init__(self, path: str):
        with open(path, encoding='utf-8') as f:
            topo = json.load(f)
        (kx, ky), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
        self.scale = (kx, ky)
        self.arcs: list[np.ndarray] = []
        for arc in topo['arcs']:
            q = np.cumsum(np.asarray(arc, dtype=np.int64).reshape(-1, 2), axis=0)
            self.arcs.append(np.column_stack([q[:, 0] * kx + tx, q[:, 1] * ky + ty]))
        self.geoms = topo['objects']['polities']['geometries']

    def alive(self, year: int, tier: int | None = 0) -> list[dict]:
        return [g for g in self.geoms if g['properties']['from'] <= year <= g['properties']['to']
                and (tier is None or g['properties']['tier'] == tier)]

    def ring(self, idx: list[int]) -> np.ndarray:
        pts = []
        for n, a in enumerate(idx):
            xy = self.arcs[a] if a >= 0 else self.arcs[~a][::-1]
            pts.append(xy if n == 0 else xy[1:])
        return np.concatenate(pts) if pts else np.empty((0, 2))

    def polygons(self, g: dict) -> list[list[list[int]]]:
        if g['type'] == 'Polygon':
            return [g['arcs']]
        if g['type'] == 'MultiPolygon':
            return g['arcs']
        return []

    def shape(self, g: dict) -> MultiPolygon:
        """The feature as a valid MultiPolygon (simplified rings can self-touch)."""
        polys = []
        for rings in self.polygons(g):
            coords = [self.ring(r) for r in rings]
            if len(coords[0]) < 4:
                continue
            p = Polygon(coords[0], [c for c in coords[1:] if len(c) >= 4])
            polys.append(p)
        m = MultiPolygon(polys) if polys else MultiPolygon()
        return m if m.is_valid else C.polygonal(shapely.make_valid(m))


def load_chunks(data_dir: str) -> tuple[dict, dict]:
    with open(os.path.join(data_dir, 'manifest.json'), encoding='utf-8') as f:
        manifest = json.load(f)
    return manifest, {}


def chunk_for(manifest: dict, cache: dict, data_dir: str, year: int, lod: str) -> Chunk:
    c = next((c for c in manifest['chunks'] if c['from'] <= year <= c['to']), None)
    if c is None:
        raise SystemExit(f'no chunk covers {year}')
    key = (c['id'], lod)
    if key not in cache:
        cache.clear()  # one chunk at a time keeps memory flat
        cache[key] = Chunk(os.path.join(data_dir, c['files'][lod]))
    return cache[key]


# ----------------------------------------------------------------------- measures


def arc_km(xy: np.ndarray) -> float:
    if len(xy) < 2:
        return 0.0
    d = np.diff(xy, axis=0)
    lat = np.radians((xy[1:, 1] + xy[:-1, 1]) / 2)
    return float(np.sum(np.hypot(d[:, 0] * np.cos(lat), d[:, 1])) * KM_PER_DEG)


class Coast:
    """Distance (km, lower bound) from points to the unsimplified Natural Earth coastline."""

    def __init__(self, land: Land):
        segs = []
        for p in land.parts:
            for r in [p.exterior, *p.interiors]:
                xy = np.asarray(r.coords)
                # cut long rings into pieces: a tree of short linestrings answers fast
                for k in range(0, len(xy) - 1, 64):
                    segs.append(shapely.LineString(xy[k:k + 65]))
        self.lines = segs
        self.tree = STRtree(segs)

    def distance_km(self, pts: np.ndarray) -> np.ndarray:
        geoms = shapely.points(pts)
        _, d = self.tree.query_nearest(geoms, return_distance=True, all_matches=False)
        # degrees -> km: a degree of longitude is cos(lat) shorter (lower bound)
        return d * KM_PER_DEG * np.maximum(np.cos(np.radians(np.abs(pts[:, 1]))), 0.05)


def topology_stats(ch: Chunk, alive: list[dict], coast: Coast, threshold_km: float, skip: set | None = None) -> dict:
    """Exterior arcs off the coastline (gaps/slivers) and overlapping arcs. `skip`: rids
    whose arcs are left out (the packager's grid stand-ins for collapsed microstates:
    rectangles, not coastline)."""
    uses: dict[int, list[tuple[int, int]]] = defaultdict(list)  # arc -> [(feature id, +1/-1)]
    for g in alive:
        if skip and g['properties']['rid'] in skip:
            continue
        for rings in ch.polygons(g):
            for ring in rings:
                for a in ring:
                    uses[a if a >= 0 else ~a].append((g['id'], 1 if a >= 0 else -1))
    exterior_km = 0.0
    off_km = 0.0
    off = []
    overlap_km = 0.0
    overlaps = []
    for a, us in uses.items():
        xy = ch.arcs[a]
        km = arc_km(xy)
        if len(us) == 1:
            exterior_km += km
            d = coast.distance_km(xy)
            far = d > threshold_km
            if far.any():
                # length of the segments with a far vertex at either end
                seg_far = far[1:] | far[:-1]
                dd = np.diff(xy, axis=0)
                lat = np.radians((xy[1:, 1] + xy[:-1, 1]) / 2)
                km_far = float(np.sum(np.hypot(dd[:, 0] * np.cos(lat), dd[:, 1])[seg_far]) * KM_PER_DEG)
                off_km += km_far
                i = int(np.argmax(d))
                off.append({'km': round(km_far, 2), 'maxDistKm': round(float(d[i]), 2),
                            'at': [round(float(xy[i, 0]), 4), round(float(xy[i, 1]), 4)], 'id': us[0][0]})
        else:
            dirs = Counter(s for _, s in us)
            ids = {f for f, _ in us}
            if len(us) > 2 or dirs[1] > 1 or dirs[-1] > 1 or len(ids) < len(us):
                if len(ids) < len(us) and len(us) == 2 and dirs[1] == 1:
                    continue  # one feature using an arc both ways: an internal edge (cancels)
                overlap_km += km
                overlaps.append({'km': round(km, 2), 'ids': sorted(ids),
                                 'at': [round(float(xy[len(xy) // 2, 0]), 4), round(float(xy[len(xy) // 2, 1]), 4)]})
    off.sort(key=lambda x: -x['km'])
    overlaps.sort(key=lambda x: -x['km'])
    return {'exteriorKm': round(exterior_km, 1), 'offCoastKm': round(off_km, 2), 'offCoastWorst': off[:8],
            'overlapKm': round(overlap_km, 2), 'overlapWorst': overlaps[:8]}


def invalid_polygons(ch: Chunk, alive: list[dict]) -> dict:
    """Polygons (outer ring + holes, one at a time) that are not valid as decoded:
    rings that cross themselves or each other after simplification. A client's
    tessellator draws them with missing or extra triangles. Reports how much area
    repairing them (make_valid) adds or removes."""
    out = []
    for g in alive:
        for rings in ch.polygons(g):
            coords = [ch.ring(r) for r in rings]
            if len(coords[0]) < 4:
                continue
            p = Polygon(coords[0], [c for c in coords[1:] if len(c) >= 4])
            if p.is_valid:
                continue
            reason = shapely.is_valid_reason(p)
            fixed = C.polygonal(shapely.make_valid(p))
            out.append({'rid': g['properties']['rid'], 'reason': reason[:80],
                        'km2Changed': round(abs(C.area_km2(fixed) - C.area_km2(shapely.Polygon(coords[0]))
                                                + sum(C.area_km2(shapely.Polygon(c)) for c in coords[1:] if len(c) >= 4)), 2)})
    out.sort(key=lambda x: -x['km2Changed'])
    return {'count': len(out), 'km2Changed': round(sum(x['km2Changed'] for x in out), 2), 'worst': out[:8]}


def thin_parts(shapes: list[tuple[dict, MultiPolygon]], width_m: float) -> dict:
    """Polygon parts thinner than width_m (mean width 2 * area / perimeter, geodesic)."""
    out = []
    for props, g in shapes:
        for p in g.geoms:
            a_deg, l_deg = p.area, p.length
            if l_deg <= 0:
                continue
            lat = abs(p.centroid.y)
            # cheap planar upper bound first, then geodesic
            if 2 * a_deg / l_deg * KM_PER_DEG * 1000 * math.cos(math.radians(min(lat, 89))) > width_m * 2:
                continue
            area_m2, per_m = C.GEOD.geometry_area_perimeter(p)
            w = 2 * abs(area_m2) / per_m if per_m else 0.0
            if w < width_m:
                pt = p.representative_point()
                out.append({'rid': props['rid'], 'kind': props['kind'], 'km2': round(abs(area_m2) / 1e6, 4),
                            'lengthKm': round(per_m / 2000, 1), 'widthM': round(w, 1),
                            'at': [round(pt.x, 3), round(pt.y, 3)]})
    out.sort(key=lambda x: -x['lengthKm'])
    return {'count': len(out), 'km2': round(sum(x['km2'] for x in out), 3),
            'lengthKm': round(sum(x['lengthKm'] for x in out), 1), 'worst': out[:10]}


def coverage(shapes: list[tuple[dict, MultiPolygon]], land: Land, land_mp: MultiPolygon,
             base: MultiPolygon | None = None) -> dict:
    """Union of the tier-0 features against unsimplified Natural Earth land and, when
    given, against the dataset's own base land layer at the same LOD (what a map draws
    under the polities)."""
    geoms = [g for _, g in shapes]
    union = C.polygonal(shapely.union_all(geoms)) if geoms else MultiPolygon()
    sum_km2 = sum(C.area_km2(g) for g in geoms)
    union_km2 = C.area_km2(union)
    missing = C.polygonal(shapely.difference(land_mp, union))
    extra = C.polygonal(shapely.difference(union, land_mp))
    land_km2 = land.total_area
    miss_km2, extra_km2 = C.area_km2(missing), C.area_km2(extra)
    out = {'landKm2': round(land_km2), 'unionKm2': round(union_km2), 'sumKm2': round(sum_km2),
           'overlapKm2': round(sum_km2 - union_km2, 2),
           'missingKm2': round(miss_km2, 1), 'offLandKm2': round(extra_km2, 1),
           'unionVsLand': round((union_km2 - land_km2) / land_km2, 6),
           'symDiffShare': round((miss_km2 + extra_km2) / land_km2, 6)}
    if base is not None:
        b_miss = C.area_km2(C.polygonal(shapely.difference(base, union)))   # base land no feature covers
        b_extra = C.area_km2(C.polygonal(shapely.difference(union, base)))  # features beyond the base coast
        out.update({'baseLandKm2': round(C.area_km2(base)), 'baseNotCoveredKm2': round(b_miss, 1),
                    'featuresOffBaseKm2': round(b_extra, 1), 'symDiffBaseShare': round((b_miss + b_extra) / land_km2, 6)})
    return out


def decode_base(data_dir: str, path: str) -> MultiPolygon:
    """The dataset's base land layer (one dissolved feature) as a valid MultiPolygon."""
    ch = Chunk.__new__(Chunk)
    with open(os.path.join(data_dir, path), encoding='utf-8') as f:
        topo = json.load(f)
    (kx, ky), (tx, ty) = topo['transform']['scale'], topo['transform']['translate']
    ch.scale = (kx, ky)
    ch.arcs = []
    for arc in topo['arcs']:
        q = np.cumsum(np.asarray(arc, dtype=np.int64).reshape(-1, 2), axis=0)
        ch.arcs.append(np.column_stack([q[:, 0] * kx + tx, q[:, 1] * ky + ty]))
    obj = next(iter(topo['objects'].values()))
    parts = [ch.shape(g) for g in obj['geometries']]
    return C.polygonal(shapely.union_all(parts)) if parts else MultiPolygon()


def islands_by_owner(shapes: list[tuple[dict, MultiPolygon]], land: Land, index: dict, top: int = 10) -> dict:
    """Owner of every logical island (see module docstring)."""
    parts, owner_of_part = [], []
    for props, g in shapes:
        for p in g.geoms:
            parts.append(p)
            owner_of_part.append(props)
    tree = STRtree(parts)
    names = index.get('islands', {})
    classes = Counter()
    class_km2 = Counter()
    owners = Counter()
    unclaimed = []
    for k, ps in enumerate(land.islands):
        km2 = float(land.island_area[k])
        if km2 > 5e6:   # the continents (Afro-Eurasia, the Americas, Antarctica, Australia) are not islands
            continue
        geom = land.island_geom(k)
        if km2 >= BIG_ISLAND_KM2:
            shares = Counter()
            for i in tree.query(geom, predicate='intersects'):
                a = C.area_km2(shapely.intersection(parts[int(i)], geom))
                if a > 0:
                    props = owner_of_part[int(i)]
                    shares[props['pid'] if props['kind'] != 'unclaimed' else 'none'] += a
            covered = sum(shares.values())
            if covered < 0.05 * km2:
                cls, owner, un_share = 'not drawn', None, 0.0
            else:
                owner, top_km2 = shares.most_common(1)[0]
                un_share = shares.get('none', 0.0) / km2
                cls = 'unclaimed' if owner == 'none' else 'polity'
        else:
            big = max((land.parts[i] for i in ps), key=lambda p: p.area)
            pt = big.point_on_surface()
            hit = [int(i) for i in tree.query(pt, predicate='intersects')]
            if not hit:
                cls, owner, un_share = 'not drawn', None, 0.0
            else:
                props = owner_of_part[hit[0]]
                owner = props['pid'] if props['kind'] != 'unclaimed' else 'none'
                cls = 'unclaimed' if owner == 'none' else 'polity'
                un_share = 1.0 if owner == 'none' else 0.0
        classes[cls] += 1
        class_km2[cls] += km2
        if cls == 'polity':
            owners[owner] += 1
        if un_share >= 0.5:
            n = names.get(k, {})
            unclaimed.append({'name': n.get('name') or '(unnamed)', 'km2': round(km2), 'unclaimedShare': round(un_share, 3),
                              'at': n.get('point')})
    unclaimed.sort(key=lambda x: -x['km2'])
    return {'islands': dict(classes), 'km2': {k: round(v) for k, v in class_km2.items()},
            'topOwners': owners.most_common(top), 'largestUnclaimed': unclaimed[:top]}


# ------------------------------------------------------------------------ preview


def render(ch: Chunk, year: int, lod: str, region: str, land: Land, out_png: str, title: str) -> dict:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path

    w, s, e, n = REGIONS[region]
    across = w > e
    e2 = e + 360 if across else e

    def shift_xy(xy):
        """Across-180 views: a ring or arc in the western hemisphere moves by +360 as a
        whole (the data is cut at +/-180, so none straddles it)."""
        if not across or len(xy) == 0 or xy[:, 0].max() > 0:
            return xy
        return xy + np.array([360.0, 0.0])

    def poly_path(rings_xy):
        verts, codes = [], []
        for xy in rings_xy:
            xy = shift_xy(xy)
            if len(xy) < 3:
                continue
            verts.extend(xy.tolist())
            codes.extend([Path.MOVETO] + [Path.LINETO] * (len(xy) - 2) + [Path.CLOSEPOLY])
        return Path(verts, codes) if verts else None

    fig, ax = plt.subplots(figsize=(11, 11 * (n - s) / max(1e-9, (e2 - w)) * 1 / math.cos(math.radians((s + n) / 2)) if (e2 - w) else 11))
    ax.set_facecolor(OCEAN)
    view = box(w, s, e2, n)
    # unsimplified coastline (cyan) underneath
    for p in land.parts:
        b = p.bounds
        if across and b[2] <= 0:
            b = (b[0] + 360, b[1], b[2] + 360, b[3])
        if b[2] < w or b[0] > e2 or b[3] < s or b[1] > n:
            continue
        path = poly_path([np.asarray(r.coords) for r in [p.exterior, *p.interiors]])
        if path is not None:
            ax.add_patch(PathPatch(path, facecolor='none', edgecolor='#19c3e6', lw=1.6, zorder=1))
    tier0 = ch.alive(year, 0)
    tier1 = ch.alive(year, 1)
    in_view = 0
    for g in tier0 + tier1:
        props = g['properties']
        rings = [ch.ring(r) for rings in ch.polygons(g) for r in rings]
        path = poly_path(rings)
        if path is None:
            continue
        ext = path.get_extents()
        if ext.x1 < w or ext.x0 > e2 or ext.y1 < s or ext.y0 > n:
            continue
        in_view += 1
        if props['tier'] == 0:
            fc = UNCLAIMED if props['kind'] == 'unclaimed' else PALETTE[props['c'] % len(PALETTE)]
            ax.add_patch(PathPatch(path, facecolor=fc, edgecolor='none', lw=0, zorder=2))
        else:
            ax.add_patch(PathPatch(path, facecolor='none', edgecolor='#333333', hatch='////', lw=0.6, ls='--', zorder=4))
    # arcs: shared by two tier-0 features = border (white); used once = exterior (black)
    uses = Counter()
    for g in tier0:
        for rings in ch.polygons(g):
            for ring in rings:
                for a in ring:
                    uses[a if a >= 0 else ~a] += 1
    for a, k in uses.items():
        xy = shift_xy(ch.arcs[a])
        b = (xy[:, 0].min(), xy[:, 1].min(), xy[:, 0].max(), xy[:, 1].max())
        if b[2] < w or b[0] > e2 or b[3] < s or b[1] > n:
            continue
        if k >= 2:
            ax.plot(xy[:, 0], xy[:, 1], color='white', lw=0.7, zorder=3)
        else:
            ax.plot(xy[:, 0], xy[:, 1], color='black', lw=0.6, zorder=3)
    # labels of polities large enough to read
    for g in tier0:
        p = g['properties']
        if p['kind'] == 'unclaimed' or p['a'] < 300:
            continue
        lx = p['lx'] + 360 if across and p['lx'] < w else p['lx']
        if w <= lx <= e2 and s <= p['ly'] <= n:
            ax.text(lx, p['ly'], p['name'][:28], fontsize=6.5, ha='center', va='center', zorder=5,
                    bbox={'facecolor': 'white', 'alpha': 0.6, 'lw': 0, 'pad': 0.6})
    ax.set_xlim(w, e2)
    ax.set_ylim(s, n)
    ax.set_aspect(1 / math.cos(math.radians((s + n) / 2)))
    if across:
        ticks = ax.get_xticks()
        ax.set_xticks(ticks)
        ax.set_xticklabels([f'{(t + 180) % 360 - 180:g}' for t in ticks])
    ax.set_title(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(out_png, dpi=110)
    plt.close(fig)
    return {'png': out_png, 'features': in_view}


# --------------------------------------------------------------------------- main


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description='Verify the built dataset')
    ap.add_argument('--data', default=os.path.join(C.ROOT, 'packages', 'borders', 'data'))
    ap.add_argument('--years', default='1500,1700,1800,1900,1950,2000,2026')
    ap.add_argument('--lods', default='l0,l1')
    ap.add_argument('--previews', default='british-isles:1800,aegean:1700,japan:1850,indonesia:1900,caribbean:1800,chukotka:1900')
    ap.add_argument('--preview-lod', default='l1')
    ap.add_argument('--out', default=os.path.join(C.BUILD, 'verify'))
    ap.add_argument('--thin-m', type=float, default=50.0)
    ap.add_argument('--max-gap-km', type=float, default=1.0, help='fail above this off-coast exterior or overlap length')
    ap.add_argument('--no-islands', action='store_true')
    args = ap.parse_args(argv)
    os.makedirs(args.out, exist_ok=True)
    t0 = time.time()
    manifest, cache = load_chunks(args.data)
    say(f"dataset {manifest['dataset']} {manifest['version']} built {manifest['built']}: {len(manifest['chunks'])} chunks")
    land = Land()
    land_mp = C.polygonal(MultiPolygon(land.parts))
    coast = Coast(land)
    index = {}
    ri = os.path.join(C.BUILD, 'geom', 'report-index.pkl')
    if os.path.exists(ri):
        index = C.load_pickle(ri)
    say(f'land: {len(land.parts)} parts, {len(land.islands)} islands, {land.total_area:,.0f} km2 ({time.time() - t0:.1f} s)')
    years = [int(y) for y in args.years.split(',') if y.strip()]
    lods = [x.strip() for x in args.lods.split(',') if x.strip()]
    report = {'dataset': manifest['dataset'], 'version': manifest['version'], 'built': manifest['built'],
              'thinWidthM': args.thin_m, 'frames': [], 'previews': []}
    failed = []
    snap_km = float(C.CONFIG.get('topology', {}).get('snapDegrees', 3e-5)) * KM_PER_DEG
    stand_ins: dict[str, set] = defaultdict(set)   # lod -> rids drawn as grid stand-ins
    try:
        with open(os.path.join(args.data, 'qa-report.json'), encoding='utf-8') as f:
            for x in (json.load(f).get('packaging') or {}).get('standIns') or []:
                stand_ins[x['lod']].add(x['rid'])
    except (OSError, ValueError, KeyError):
        pass
    for lod in lods:
        lod_cfg = next(x for x in manifest['lods'] if x['id'] == lod)
        base = decode_base(args.data, manifest['base']['land'][lod]) if lod in manifest['base']['land'] else None
        for year in years:
            t = time.time()
            ch = chunk_for(manifest, cache, args.data, year, lod)
            alive = ch.alive(year, 0)
            shapes = [(g['properties'], ch.shape(g)) for g in alive]
            # a correct coastal vertex is off the coastline by quantization (half a grid
            # cell diagonal) and import snapping at most (+ 50 m slack)
            q_km = math.hypot(*ch.scale) / 2 * KM_PER_DEG + snap_km + 0.05
            topo = topology_stats(ch, alive, coast, q_km, stand_ins.get(lod))
            cov = coverage(shapes, land, land_mp, base)
            thin = thin_parts(shapes, args.thin_m)
            invalid = invalid_polygons(ch, alive)
            row = {'year': year, 'lod': lod, 'toleranceM': lod_cfg['toleranceM'], 'features': len(alive),
                   'polities': sum(1 for p, _ in shapes if p['kind'] != 'unclaimed'),
                   'unclaimedFeatures': sum(1 for p, _ in shapes if p['kind'] == 'unclaimed'),
                   'coverage': cov, 'topology': {**topo, 'thresholdKm': round(q_km, 3)}, 'thin': thin, 'invalid': invalid}
            if not args.no_islands:
                row['islands'] = islands_by_owner(shapes, land, index)
            row['secs'] = round(time.time() - t, 1)
            report['frames'].append(row)
            if topo['offCoastKm'] > args.max_gap_km or topo['overlapKm'] > args.max_gap_km:
                failed.append(f'{year} {lod}')
            say(f"{year} {lod}: {len(alive)} tier-0 ({row['polities']} polities); union-land {cov['unionVsLand'] * 100:+.3f} %, "
                f"sym.diff {cov['symDiffShare'] * 100:.3f} % (vs base land {cov.get('symDiffBaseShare', 0) * 100:.3f} %), "
                f"overlap {cov['overlapKm2']} km2; off-coast exterior "
                f"{topo['offCoastKm']} km, overlapping arcs {topo['overlapKm']} km; invalid polygons {invalid['count']} "
                f"({invalid['km2Changed']} km2); thin parts {thin['count']} "
                f"({thin['km2']} km2) [{row['secs']} s]")
    for spec in [x for x in args.previews.split(',') if x.strip()]:
        region, year = spec.split(':')
        year = int(year)
        ch = chunk_for(manifest, cache, args.data, year, args.preview_lod)
        png = os.path.join(args.out, f'{region}-{year}-{args.preview_lod}.png')
        info = render(ch, year, args.preview_lod, region, land, png,
                      f"{manifest['dataset']} {manifest['version']} - {region} {year} - {args.preview_lod} "
                      '(white: shared borders, black: exterior arcs, cyan: Natural Earth coast)')
        report['previews'].append({'region': region, 'year': year, 'lod': args.preview_lod, **info})
        say(f'preview {png} ({info["features"]} features)')
    report['failed'] = failed
    report['secs'] = round(time.time() - t0, 1)
    with open(os.path.join(args.out, 'verify-report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=1)
    with open(os.path.join(args.out, 'verify-summary.md'), 'w', encoding='utf-8', newline='\n') as f:
        f.write(summary_markdown(report))
    say(f"{'FAILED: ' + ', '.join(failed) if failed else 'ok'} -> {os.path.join(args.out, 'verify-summary.md')} ({report['secs']} s)")
    return 1 if failed else 0


def summary_markdown(r: dict) -> str:
    lines = [f"# Built dataset verification: {r['dataset']} {r['version']}", '',
             f"Built {r['built']}. Tier-0 features per year and LOD decoded from the chunks.", '',
             'Union vs land and sym. diff compare the union of the tier-0 features with unsimplified Natural Earth land '
             '(simplification error); vs base: with the base land layer of the dataset at that LOD.', '',
             '| year | lod | tier-0 | polities | union vs land | sym. diff | vs base | overlap km2 | off-coast exterior km | overlapping arcs km | invalid polygons (km2) | thin parts (km2) |',
             '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |']
    for x in r['frames']:
        c, t, th = x['coverage'], x['topology'], x['thin']
        lines.append(f"| {x['year']} | {x['lod']} | {x['features']} | {x['polities']} | {c['unionVsLand'] * 100:+.3f} % | "
                     f"{c['symDiffShare'] * 100:.3f} % | {c.get('symDiffBaseShare', 0) * 100:.3f} % | {c['overlapKm2']} | {t['offCoastKm']} | {t['overlapKm']} | "
                     f"{x['invalid']['count']} ({x['invalid']['km2Changed']}) | {th['count']} ({th['km2']}) |")
    if any('islands' in x for x in r['frames']):
        lines += ['', '## Islands by owner', '', 'Logical Natural Earth islands except the four continents; islands of 1,000 km2 and more by area '
                  'shares (owner = largest share), smaller ones by the feature at a point on the island; not drawn = '
                  'dropped at this LOD (islets of large polities under the LOD threshold). Largest still unclaimed: '
                  'islands at least half unclaimed (island area, unclaimed share).', '', '| year | lod | polity | unclaimed | not drawn | largest still unclaimed |', '| --- | --- | --- | --- | --- | --- |']
        for x in r['frames']:
            i = x.get('islands')
            if not i:
                continue
            un = ', '.join(f"{u['name']} {u['km2']:,} km2 ({u['unclaimedShare'] * 100:.0f} % unclaimed)" for u in i['largestUnclaimed'][:5])
            lines.append(f"| {x['year']} | {x['lod']} | {i['islands'].get('polity', 0)} ({i['km2'].get('polity', 0):,} km2) | "
                         f"{i['islands'].get('unclaimed', 0)} ({i['km2'].get('unclaimed', 0):,} km2) | "
                         f"{i['islands'].get('not drawn', 0)} ({i['km2'].get('not drawn', 0):,} km2) | {un} |")
    worst = [(x['year'], x['lod'], w) for x in r['frames'] for w in x['topology']['offCoastWorst'][:3]]
    if worst:
        lines += ['', '## Worst exterior arcs off the coastline', '']
        lines += [f"- {y} {lod}: {w['km']} km, up to {w['maxDistKm']} km from the coast at {w['at']} (feature {w['id']})" for y, lod, w in worst]
    if r['previews']:
        lines += ['', '## Previews', ''] + [f"- {p['region']} {p['year']} {p['lod']}: `{p['png']}`" for p in r['previews']]
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    sys.exit(main())
