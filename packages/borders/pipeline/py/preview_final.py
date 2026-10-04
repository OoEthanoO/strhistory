"""Render the geometry build's output (features.geojsonl) for one year and area into a
PNG: tier-0 polities in their colour slot, unclaimed land pale, tier-1 overlays
hatched, labels at lx/ly. For eyeballing coasts, islands and the antimeridian.

    node packages/borders/pipeline/tools/py.mjs preview_final.py --year 1800 --bbox=-11,49,3,61 [--dir DIR] [--out PNG]
    node packages/borders/pipeline/tools/py.mjs preview_final.py --year 1900 --bbox=160,60,-165,72    (w > e: across 180)

Default --dir .cache/build/final, default --out .cache/previews/final-<year>-<bbox>.png.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402
from matplotlib.path import Path  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
import shapely.affinity  # noqa: E402
from shapely.geometry import box, shape  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402

PALETTE = ['#c9734f', '#5b8fb9', '#8db86a', '#d4b84a', '#a77bb8', '#5fb3a5', '#d98a9a', '#9c8f5a',
           '#6f7fc9', '#c99a5b', '#7aa36f', '#b86a6a', '#4f9cc9', '#b0b04f', '#8a6fb3', '#c97fb0']
UNCLAIMED = '#ece6d6'
OCEAN = '#dfe9f2'
PROPS_END = re.compile(r'\},"geometry":')


def read_alive(path: str, year: int, view) -> list[tuple[dict, object]]:
    """(properties, geometry) of features alive in `year` intersecting the view."""
    out = []
    with open(path, encoding='utf-8') as f:
        for line in f:
            m = PROPS_END.search(line)
            start = line.index('"properties":') + len('"properties":')
            props = json.loads(line[start:m.start() + 1])
            if not (props['from'] <= year <= props['to']):
                continue
            g = shape(json.loads(line[m.end():].rstrip()[:-1]))   # geometry: up to the Feature's closing brace
            if g.intersects(view):
                out.append((props, g))
    return out


def shift(g, w: float):
    """Across-180 views: move geometry west of the view's west edge by +360."""
    parts = []
    for p in getattr(g, 'geoms', [g]):
        parts.append(shapely.affinity.translate(p, xoff=360.0) if p.bounds[2] <= w else p)
    return shapely.geometry.MultiPolygon(parts) if len(parts) > 1 else parts[0]


def patch(g, **kw):
    verts, codes = [], []
    for p in getattr(g, 'geoms', [g]):
        for ring in [p.exterior, *p.interiors]:
            xy = np.asarray(ring.coords)
            verts.append(xy)
            codes += [Path.MOVETO] + [Path.LINETO] * (len(xy) - 2) + [Path.CLOSEPOLY]
    return PathPatch(Path(np.vstack(verts), codes), **kw)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--dir', default=os.path.join(C.BUILD, 'final'))
    ap.add_argument('--year', type=int, required=True)
    ap.add_argument('--bbox', required=True, help='w,s,e,n (w > e crosses the antimeridian)')
    ap.add_argument('--out')
    ap.add_argument('--title', default='')
    ap.add_argument('--min-label-km2', type=float, default=None)
    args = ap.parse_args(argv)
    w, s, e, n = [float(v) for v in args.bbox.split(',')]
    across = w > e
    views = [box(w, s, 180, n), box(-180, s, e, n)] if across else [box(w, s, e, n)]
    view = shapely.union_all(views)
    feats = read_alive(os.path.join(args.dir, 'features.geojsonl'), args.year, view)
    e_plot = e + 360 if across else e
    width = 11.0
    aspect = (n - s) / max(e_plot - w, 1e-6) / max(np.cos(np.radians((s + n) / 2)), 0.2)
    fig, ax = plt.subplots(figsize=(width, max(4.0, min(14.0, width * aspect))))
    ax.set_facecolor(OCEAN)
    min_label = args.min_label_km2 if args.min_label_km2 is not None else (e_plot - w) * (n - s) * 40
    labels = []
    order = sorted(feats, key=lambda pg: (pg[0]['tier'], pg[0]['kind'] != 'unclaimed', -pg[0]['a']))
    for props, g in order:
        g = shapely.intersection(g, view)
        if g.is_empty:
            continue
        g = shift(g, w) if across else g
        polys = [p for p in getattr(g, 'geoms', [g]) if p.geom_type == 'Polygon' and not p.is_empty]
        if not polys:
            continue
        gg = shapely.geometry.MultiPolygon(polys)
        if props['kind'] == 'unclaimed':
            ax.add_patch(patch(gg, facecolor=UNCLAIMED, edgecolor='#b9b09a', linewidth=0.3))
        elif props['tier'] == 1:
            ax.add_patch(patch(gg, facecolor='none', edgecolor='#333333', linewidth=0.7, hatch='///', linestyle='--'))
        else:
            ax.add_patch(patch(gg, facecolor=PALETTE[props['c'] % len(PALETTE)], edgecolor='#222222', linewidth=0.45))
        if props['kind'] != 'unclaimed' and props['a'] >= min_label:
            lx = props['lx'] + (360 if across and props['lx'] < w else 0)
            labels.append((lx, props['ly'], props['name'], props['tier']))
    for lx, ly, name, tier in labels:
        if w <= lx <= e_plot and s <= ly <= n:
            ax.text(lx, ly, name, fontsize=7, ha='center', va='center', style='italic' if tier else 'normal',
                    bbox=dict(boxstyle='round,pad=0.15', fc='white', ec='none', alpha=0.6))
    ax.set_xlim(w, e_plot)
    ax.set_ylim(s, n)
    ax.set_aspect(1 / max(np.cos(np.radians((s + n) / 2)), 0.2))
    ax.set_title(args.title or f'{args.year}  [{args.bbox}]  {len(feats)} features', fontsize=10)
    out = args.out or os.path.join(C.CACHE, 'previews', f'final-{args.year}-{args.bbox.replace(",", "_")}.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.savefig(out, dpi=110, bbox_inches='tight')
    print(out)
    return 0


if __name__ == '__main__':
    sys.exit(main())
