"""Render override geometry over Natural Earth land and the Cliopatria polities of a
year into a PNG, so editors (people or agents) can eyeball a fix before building.

Examples (run through the venv wrapper):
  node packages/borders/pipeline/tools/py.mjs preview.py --year 1800 --bbox=-100,25,-60,50   (use --bbox= when it starts with "-")
  node packages/borders/pipeline/tools/py.mjs preview.py --file packages/borders/overrides/historical/northern-america.json --year 1800
  node packages/borders/pipeline/tools/py.mjs preview.py --file packages/borders/overrides/historical/northern-america.json --entry h-northern-america-0007
  node packages/borders/pipeline/tools/py.mjs preview.py --file packages/borders/overrides/modern/europe-west.json --year 1955

What it draws: ocean (dark), Natural Earth land (grey), raw (unclipped) Cliopatria
records alive in the year (thin outlines + names; Cliopatria is only used before
1946), and the override geometry clipped to land (coloured, names). For modern files
it colours each unit/subunit by the state holding it in that year.
Output: .cache/previews/<name>.png (path printed). This is a preview with its own
small geometry-spec resolver; the pipeline's override engine is authoritative.
"""
import argparse
import json
import os
import pickle
import sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.patches import PathPatch  # noqa: E402
from matplotlib.path import Path  # noqa: E402
import numpy as np  # noqa: E402
import shapely  # noqa: E402
from shapely import wkb  # noqa: E402
from shapely.geometry import Polygon, box  # noqa: E402

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'py'))
import common as C  # noqa: E402

PALETTE = ['#e9b45f', '#7cc4ff', '#ff7b72', '#7ee787', '#d2a8ff', '#ffa657', '#56d4dd', '#f778ba', '#a5d6ff', '#e3b341']


def load_inventory():
    with open(os.path.join(C.REFERENCE, 'cliopatria-inventory.json'), encoding='utf-8') as f:
        inv = json.load(f)
    with open(os.path.join(C.REFERENCE, 'cliopatria-geoms.pkl'), 'rb') as f:
        geoms = pickle.load(f)
    return inv, geoms


class Resolver:
    def __init__(self, ctx, inv, geoms, entries):
        self.ctx, self.inv, self.geoms, self.entries = ctx, inv, geoms, entries

    def record(self, pid, year):
        for r in self.inv:
            if r['pid'] == pid and r['from'] <= year <= r['to']:
                return C.polygonal(wkb.loads(self.geoms[r['rid']]))
        for e in self.entries:
            s = e.get('set') or {}
            if e.get('op') == 'add' and s.get('pid') == pid:
                y0, y1 = (C.resolve_year(y) for y in e['years'])
                if y0 <= year <= y1:
                    return self.resolve(e['geometry'])
        raise KeyError(f'no record of {pid} alive in {year}')

    def resolve(self, g):
        t = g['type']
        if t == 'admin0':
            return C.polygonal(shapely.union_all([self.ctx.admin0[c] for c in g['codes']]))
        if t == 'admin1':
            return C.polygonal(shapely.union_all([self.ctx.admin1[c] for c in g['codes']]))
        if t == 'ne-disputed':
            return C.polygonal(shapely.union_all([self.ctx.disputed[c] for c in g['codes']]))
        if t == 'islands':
            return self.ctx.islands_at([tuple(p) for p in g['points']])
        if t == 'polygon':
            polys = [g['rings']] if 'rings' in g else g['polygons']
            return C.polygonal(shapely.union_all([Polygon(rings[0], rings[1:]) for rings in polys]))
        if t == 'record':
            return self.record(g['pid'], g['year'])
        if t == 'union':
            return C.polygonal(shapely.union_all([self.resolve(p) for p in g['parts']]))
        if t == 'intersection':
            out = self.resolve(g['parts'][0])
            for p in g['parts'][1:]:
                out = out.intersection(self.resolve(p))
            return C.polygonal(out)
        if t == 'difference':
            out = self.resolve(g['base'])
            for p in g['minus']:
                out = out.difference(self.resolve(p))
            return C.polygonal(out)
        raise ValueError(f'unknown geometry type {t}')


def to_path(geom):
    verts, codes = [], []
    for poly in C.polygonal(geom).geoms:
        for ring in [poly.exterior, *poly.interiors]:
            xy = np.asarray(ring.coords)
            if len(xy) < 3:
                continue
            verts.extend(xy.tolist())
            codes.extend([Path.MOVETO] + [Path.LINETO] * (len(xy) - 2) + [Path.CLOSEPOLY])
    return Path(verts, codes) if verts else None


def draw(ax, geom, **kw):
    p = to_path(geom)
    if p is not None:
        ax.add_patch(PathPatch(p, **kw))


def label(ax, geom, text, color, bbox):
    geom = C.polygonal(geom)
    if geom.is_empty:
        return
    big = max(geom.geoms, key=lambda g: g.area)
    pt = big.representative_point()
    if bbox.contains(pt):
        ax.text(pt.x, pt.y, text, fontsize=7, color=color, ha='center', va='center',
                bbox=dict(boxstyle='round,pad=0.15', fc='#0b1220', ec='none', alpha=0.6))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--file')
    ap.add_argument('--entry', help='entry id (historical/early) or unit code / overlay id (modern)')
    ap.add_argument('--year', type=int)
    ap.add_argument('--bbox', help='w,s,e,n')
    ap.add_argument('--out')
    ap.add_argument('--no-clio', action='store_true')
    a = ap.parse_args()

    ctx = C.Ctx()
    inv, geoms = load_inventory()
    data = {}
    if a.file:
        with open(a.file, encoding='utf-8') as f:
            data = json.load(f)
    entries = data.get('entries', [])
    res = Resolver(ctx, inv, geoms, entries)

    shown = []  # (geom, name, colour, dashed)
    year = a.year
    if data.get('kind') == 'modern':
        year = year or C.CUTOVER_YEAR
        states = {}
        for u in data.get('units', []):
            if a.entry and a.entry != u['unit']:
                continue
            base = ctx.admin0[u['unit']]
            for s in u.get('subunits', []):
                per = next((p for p in s['timeline'] if C.resolve_year(p['years'][0]) <= year <= C.resolve_year(p['years'][1])), None)
                if per:
                    g = res.resolve(s['geometry']).intersection(base)
                    base = base.difference(g)
                    states.setdefault(per['state']['name'], []).append(g)
            per = next((p for p in u['timeline'] if C.resolve_year(p['years'][0]) <= year <= C.resolve_year(p['years'][1])), None)
            states.setdefault(per['state']['name'] if per else f"UNASSIGNED {u['unit']}", []).append(base)
        for i, (name, gs) in enumerate(sorted(states.items())):
            shown.append((C.polygonal(shapely.union_all(gs)), name, PALETTE[i % len(PALETTE)], False))
        for o in data.get('overlays', []):
            if a.entry and a.entry != o['id']:
                continue
            per = next((p for p in o['timeline'] if C.resolve_year(p['years'][0]) <= year <= C.resolve_year(p['years'][1])), None)
            if per:
                shown.append((res.resolve(o['geometry']), (per['set'].get('name') or o['id']) + ' (overlay)', '#ffffff', True))
    else:
        for i, e in enumerate(entries):
            if a.entry and e['id'] != a.entry:
                continue
            if e.get('status') in ('rejected', 'known-gap') or 'geometry' not in e:
                continue
            y0, y1 = (C.resolve_year(y) for y in e['years'])
            if year is not None and not (y0 <= year <= y1) and not a.entry:
                continue
            if year is None:
                year = y0
            try:
                g = res.resolve(e['geometry'])
            except Exception as ex:  # keep going, report
                print(f'warn: {e["id"]}: {ex}')
                continue
            s = e.get('set') or {}
            name = f"{e['id']} {e['op']} {s.get('name') or (e.get('target') or {}).get('pid', '')}"
            dashed = (s.get('tier') == 1) or e['op'] == 'subtract'
            shown.append((g, name, PALETTE[i % len(PALETTE)], dashed))
    if year is None:
        year = 1800

    if a.bbox:
        w, s_, e_, n = (float(x) for x in a.bbox.split(','))
    elif shown:
        b = C.polygonal(shapely.union_all([g for g, *_ in shown])).bounds
        dx, dy = max(b[2] - b[0], 2) * 0.25, max(b[3] - b[1], 2) * 0.25
        w, s_, e_, n = b[0] - dx, b[1] - dy, b[2] + dx, b[3] + dy
    else:
        w, s_, e_, n = -180, -60, 180, 85
    w, e_ = max(w, -180), min(e_, 180)
    s_, n = max(s_, -90), min(n, 90)
    view = box(w, s_, e_, n)

    fig_w = 12
    aspect = (n - s_) / max(e_ - w, 1e-6) / max(np.cos(np.radians((n + s_) / 2)), 0.2)
    fig, ax = plt.subplots(figsize=(fig_w, max(3, min(fig_w * aspect, 14))), dpi=110)
    ax.set_facecolor('#0b1a33')
    land_hits = ctx.land_tree.query(view, predicate='intersects')
    for i in land_hits:
        draw(ax, ctx.land_parts[int(i)], facecolor='#3a4250', edgecolor='#8b949e', linewidth=0.3)

    if not a.no_clio and year < C.CUTOVER_YEAR:
        for r in inv:
            if r['type'] != 'POLITY' or r['pid'].startswith('clio:group-'):
                continue
            if not (r['from'] <= year <= r['to']):
                continue
            bx = r['bbox']
            if bx[2] < w or bx[0] > e_ or bx[3] < s_ or bx[1] > n:
                continue
            g = wkb.loads(geoms[r['rid']])
            draw(ax, g, facecolor='none', edgecolor='#c9d1d9', linewidth=0.6, alpha=0.8)
            label(ax, g, r['name'], '#c9d1d9', view)

    for g, name, col, dashed in shown:
        g = C.polygonal(g.intersection(ctx.land) if not g.is_empty else g)
        draw(ax, g, facecolor=col, alpha=0.45, edgecolor=col, linewidth=1.2, linestyle='--' if dashed else '-')
        label(ax, g, name, col, view)

    ax.set_xlim(w, e_)
    ax.set_ylim(s_, n)
    ax.set_aspect(1 / max(np.cos(np.radians((n + s_) / 2)), 0.2))
    ax.set_title(f'{os.path.basename(a.file) if a.file else "Cliopatria"} — year {year}' + (f' — {a.entry}' if a.entry else ''), fontsize=10)
    ax.tick_params(labelsize=7)
    out = a.out or f"{(os.path.splitext(os.path.basename(a.file))[0] if a.file else 'clio')}-{a.entry or year}.png"
    out_path = os.path.join(C.CACHE, 'previews', out)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    fig.savefig(out_path, bbox_inches='tight', facecolor='#0b1220')
    print(out_path)


if __name__ == '__main__':
    main()
