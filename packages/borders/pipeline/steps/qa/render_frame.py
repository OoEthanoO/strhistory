"""Renders a decoded frame (from steps/qa/frame.mjs) to a PNG for visual QA.

    python render_frame.py <frame.json> <out.png> <w,s,e,n> [title]

Draws: Natural Earth 10m land ∪ minor islands, unsimplified, as a cyan coastline
underneath; tier-0 fills by colour slot (unclaimed land grey); tier-1 overlays
hatched; borders (mesh between different features) white; coast (exterior mesh)
black. Where the black coast and the cyan reference separate, the simplified data
leaves the real coastline; white lines inland that are doubled or gaps of the dark
background between fills are alignment errors.
"""
import json
import os
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402
from matplotlib.path import Path  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
from shapely.geometry import box  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'py'))
import common as C  # noqa: E402

PALETTE = ['#6f8fb5', '#b58f6f', '#7fa07a', '#a77fa0', '#b5a86f', '#6fa5a8', '#b57f7f', '#8f8fbf', '#9fae6c', '#c08a5a', '#7a9e9e', '#a0758f']
UNCLAIMED = '#3b4252'


def rings_path(polys):
    verts, codes = [], []
    for rings in polys:
        for ring in rings:
            if len(ring) < 3:
                continue
            verts.extend(ring)
            codes.extend([Path.MOVETO] + [Path.LINETO] * (len(ring) - 2) + [Path.CLOSEPOLY])
    return Path(np.array(verts), codes) if verts else None


def polys_of(g):
    if not g:
        return []
    return [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []


def lines_of(g):
    if not g:
        return []
    return g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']] if g['type'] == 'LineString' else []


def main():
    src, out, bbox = sys.argv[1], sys.argv[2], [float(v) for v in sys.argv[3].split(',')]
    title = sys.argv[4] if len(sys.argv) > 4 else ''
    with open(src, encoding='utf-8') as f:
        frame = json.load(f)
    w, s, e, n = bbox
    lat0 = (s + n) / 2
    aspect = 1 / max(0.2, np.cos(np.radians(lat0)))
    width = 14
    height = max(4, min(14, width * (n - s) * aspect / (e - w)))
    fig, ax = plt.subplots(figsize=(width, height), dpi=110)
    ax.set_facecolor('#0b1220')
    ax.set_xlim(w, e)
    ax.set_ylim(s, n)
    ax.set_aspect(aspect)

    # reference coastline (unsimplified Natural Earth), clipped to the view
    ctx = C.Ctx()
    view = box(w - 1, s - 1, e + 1, n + 1)
    idx = ctx.land_tree.query(view)
    for i in idx:
        part = shapely.clip_by_rect(ctx.land_parts[int(i)], w - 1, s - 1, e + 1, n + 1)
        for p in C.polygonal(part).geoms:
            for ring in [p.exterior, *p.interiors]:
                xy = np.asarray(ring.coords)
                ax.plot(xy[:, 0], xy[:, 1], color='#22d3ee', lw=1.6, alpha=0.9, zorder=1)

    feats = frame['features']['features']
    tier0 = sorted([f for f in feats if f['properties']['tier'] == 0], key=lambda f: -f['properties']['a'])
    tier1 = [f for f in feats if f['properties']['tier'] == 1]
    for f in tier0:
        p = f['properties']
        path = rings_path(polys_of(f['geometry']))
        if path is None:
            continue
        color = UNCLAIMED if p['kind'] == 'unclaimed' else PALETTE[p['c'] % len(PALETTE)]
        ax.add_patch(PathPatch(path, facecolor=color, edgecolor='none', alpha=0.92, zorder=2))
    for f in tier1:
        path = rings_path(polys_of(f['geometry']))
        if path is not None:
            ax.add_patch(PathPatch(path, facecolor='none', edgecolor='#f8d38a', hatch='///', lw=0.8, ls='--', zorder=4))
    for line in lines_of(frame['borders']):
        xy = np.asarray(line)
        ax.plot(xy[:, 0], xy[:, 1], color='white', lw=0.6, zorder=3)
    for line in lines_of(frame['coast']):
        xy = np.asarray(line)
        ax.plot(xy[:, 0], xy[:, 1], color='black', lw=0.7, zorder=3)
    # labels for the larger polities in view
    for f in tier0 + tier1:
        p = f['properties']
        if p['kind'] == 'unclaimed' or not (w <= p['lx'] <= e and s <= p['ly'] <= n):
            continue
        ax.text(p['lx'], p['ly'], p['name'][:28], fontsize=6.5, color='#111', ha='center', va='center', zorder=5,
                bbox=dict(boxstyle='round,pad=0.12', fc='white', ec='none', alpha=0.55))
    ax.set_title(title, fontsize=10)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.savefig(out, bbox_inches='tight')
    print(f'wrote {out} ({len(tier0)} tier-0, {len(tier1)} tier-1 features)')


if __name__ == '__main__':
    main()
