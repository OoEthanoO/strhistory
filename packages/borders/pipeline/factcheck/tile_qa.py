"""Map-tile style alignment QA for the BUILT dataset (packages/borders/data).

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/tile_qa.py [--years 1453,1914] [--lods l0,l1,l2] [--data DIR] [--no-png]

For sample years and Web-Mercator tiles where each LOD is shown (l0 -> z2 whole world,
l1 -> z4 and l2 -> z6 over coastal hot spots, capped per hot spot to the tiles with the
longest coastline), rasterises the tier-0 features alive that year and the same-LOD
Natural Earth land (base/land-<lod>) into 256 px masks and reports per tile:
  uncovered   land pixels not covered by any tier-0 feature (unclaimed features count as cover)
  seaPaint    tier-0 pixels over sea
  overlap     pixels claimed by two tier-0 features (must be 0: tier 0 is a partition)
  islands     land components inside the tile painted by more than one owner, and
              'slivers' among them (minority owner share below the threshold)
  unclaimedAdj  unclaimed land pixels 4-adjacent to a polity (frontier/coast gaps; report only)
Thresholds: factcheck/config.json tileQa.thresholds (overridable via pipeline/config.json
"factcheck"). Exit code 1 when any is exceeded, 2 when the dataset is missing.
Writes .cache/factcheck/tile-qa.json and tile-qa-worst.png.
"""
from __future__ import annotations

import argparse
import hashlib
import heapq
import os
import sys
from collections import Counter

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fcutil as U  # noqa: E402
import raster as R  # noqa: E402
import topo as T  # noqa: E402

PER_CATEGORY = 3  # worst tiles per category in the PNG mosaic


class Layer:
    """Decoded rings in zoom-0 world pixels with bounding boxes (for fast tile culling)."""

    def __init__(self, items: list[dict]):
        self.items = items  # each: rings (list of arrays), bbox (x0,y0,x1,y1), + props

    @staticmethod
    def from_features(feats: list[dict], keep=lambda p: True) -> 'Layer':
        items = []
        for f in feats:
            p = f['props']
            if not keep(p):
                continue
            rings = [T.lonlat_to_world(r) for r in f['rings'] if len(r) >= 4]
            if not rings:
                continue
            allp = np.concatenate(rings)
            items.append({**p, 'rings': rings,
                          'bbox': (allp[:, 0].min(), allp[:, 1].min(), allp[:, 0].max(), allp[:, 1].max()),
                          'ringBoxes': [(r[:, 0].min(), r[:, 1].min(), r[:, 0].max(), r[:, 1].max()) for r in rings]})
        return Layer(items)

    def rings_in(self, item: dict, tb, z: int, tx: int, ty: int) -> list[np.ndarray]:
        k = 2 ** z
        out = []
        for r, b in zip(item['rings'], item['ringBoxes']):
            if b[2] < tb[0] or b[0] > tb[2] or b[3] < tb[1] or b[1] > tb[3]:
                continue
            out.append(r * k - np.array([tx * 256.0, ty * 256.0]))
        return out

    def hits(self, tb):
        for it in self.items:
            b = it['bbox']
            if b[2] < tb[0] or b[0] > tb[2] or b[3] < tb[1] or b[1] > tb[3]:
                continue
            yield it


def land_mask(land: Layer, z, x, y, size) -> np.ndarray:
    tb = T.tile_bounds_world(z, x, y)
    rings = [r for it in land.hits(tb) for r in land.rings_in(it, tb, z, x, y)]
    return R.fill([r * (size / 256.0) for r in rings], size, size)


def coast_len(mask: np.ndarray) -> int:
    return int((mask[1:, :] != mask[:-1, :]).sum() + (mask[:, 1:] != mask[:, :-1]).sum())


def color_of(pid: str) -> tuple[int, int, int]:
    h = hashlib.md5(pid.encode()).digest()
    return 120 + h[0] % 110, 120 + h[1] % 110, 120 + h[2] % 110


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--years', default='', help='extra years, comma-separated (HistYear, no 0)')
    ap.add_argument('--only-years', action='store_true', help='use only --years, not the configured sample years')
    ap.add_argument('--lods', default='l0,l1,l2')
    ap.add_argument('--data', default=U.C.DATA)
    ap.add_argument('--no-png', action='store_true')
    ap.add_argument('--out', default=os.path.join(U.OUT_DIR, 'tile-qa.json'))
    args = ap.parse_args(argv)
    t = U.Timer()
    cfg = U.load_config()['tileQa']
    th = cfg['thresholds']
    size = int(cfg['tileSize'])
    man_path = os.path.join(args.data, 'manifest.json')
    if not os.path.exists(man_path):
        print(f'[tile-qa] no dataset at {args.data} (manifest.json missing)', file=sys.stderr)
        return 2
    man = U.read_json(man_path)
    dev = 'dev' in (man.get('dataset', '') + man.get('version', '')).lower()
    ds = {'dataset': man.get('dataset'), 'version': man.get('version'), 'built': man.get('built'), 'dev': dev}
    print(f"[tile-qa] dataset {ds['dataset']} {ds['version']} built {ds['built']}"
          f" ({'DEV dataset' if dev else 'release dataset'})", file=sys.stderr)

    years = [] if args.only_years else list(cfg['years'])
    years += [int(y) for y in args.years.split(',') if y.strip()]
    years = sorted({y for y in years if y != 0 and man['years']['from'] <= y <= man['years']['to']})
    lods = [l for l in args.lods.split(',') if l in {d['id'] for d in man['lods']}]

    # ---------------------------------------------------------------- tiles per LOD
    land_layers, tiles, land_cache = {}, {}, {}
    for lod in lods:
        lf = man['base']['land'].get(lod)
        if not lf:
            continue
        land_layers[lod] = Layer.from_features(T.features(T.load(os.path.join(args.data, lf))))
        z = cfg['zoomByLod'][lod]
        if lod == 'l0':
            cand = {'world': [(z, x, y) for x in range(2 ** z) for y in range(2 ** z)]}
        else:
            cand = {name: T.tiles_for_bbox(b, z) for name, b in cfg['hotspots'].items()}
        chosen = []
        for name, tl in cand.items():
            scored = []
            for (zz, x, y) in tl:
                key = (lod, zz, x, y)
                if key not in land_cache:
                    m = land_mask(land_layers[lod], zz, x, y, size)
                    lab, n = R.components(m)
                    land_cache[key] = (m, lab, n, R.touches_border(lab, n))
                cl = coast_len(land_cache[key][0])
                if lod == 'l0' or cl > 0:
                    scored.append((cl, (zz, x, y)))
            cap = cfg.get('maxTilesPerHotspot', {}).get(lod)
            scored.sort(key=lambda s: (-s[0], s[1]))
            keep = scored if not cap or lod == 'l0' else scored[:cap]
            chosen += [(name, tt) for _, tt in keep]
        first = {}
        for name, tt in chosen:  # a tile in two hot spots is checked once
            first.setdefault(tt, name)
        tiles[lod] = sorted(((n, tt) for tt, n in first.items()), key=lambda c: (c[1], c[0]))
    print(f"[tile-qa] years {years}; tiles " + ', '.join(f'{l}: {len(v)}' for l, v in tiles.items())
          + f' (land rasters {t})', file=sys.stderr)

    # ---------------------------------------------------------------- per year
    chunk_cache = {}
    results = []
    heaps = {k: [] for k in ('uncoveredPx', 'seaPaintPx', 'overlapPx', 'sliverIslands')}
    refs = Counter()
    for year in years:
        chunk = next((c for c in man['chunks'] if c['from'] <= year <= c['to']), None)
        if not chunk:
            continue
        for lod in tiles:
            key = (chunk['id'], lod)
            if key not in chunk_cache:
                chunk_cache.clear()  # keep memory flat: one decoded chunk at a time
                feats = T.features(T.load(os.path.join(args.data, chunk['files'][lod])), 'polities')
                chunk_cache[key] = Layer.from_features(feats, keep=lambda p: p.get('tier', 0) == 0)
            layer = chunk_cache[key]
            alive = [it for it in layer.items if it['from'] <= year <= it['to']]
            alive_layer = Layer(alive)
            for name, (z, x, y) in tiles[lod]:
                land, lab, ncomp, border = land_cache[(lod, z, x, y)]
                tb = T.tile_bounds_world(z, x, y)
                owner = np.full((size, size), -1, dtype=np.int32)
                overlap = 0
                pids = []
                kinds = []
                for it in alive_layer.hits(tb):
                    rings = alive_layer.rings_in(it, tb, z, x, y)
                    if not rings:
                        continue
                    m = R.fill([r * (size / 256.0) for r in rings], size, size)
                    if not m.any():
                        continue
                    pid = it.get('pid') or '?'
                    if pid in pids:
                        k = pids.index(pid)
                    else:
                        k = len(pids)
                        pids.append(pid)
                        kinds.append(it.get('kind'))
                    overlap += int((m & (owner >= 0) & (owner != k)).sum())
                    owner[m & (owner < 0)] = k
                covered = owner >= 0
                is_unc = np.array([kd == 'unclaimed' for kd in kinds] + [True], dtype=bool)  # index -1 -> True
                unclaimed = land & is_unc[owner]
                polity = covered & ~is_unc[owner]
                uncovered = land & ~covered
                sea = covered & ~land
                # islands painted by several owners (owner -1 = uncovered counts as an owner too)
                multi, slivers, isl_info = 0, 0, []
                if ncomp:
                    inner = ~border
                    sel = (lab >= 0) & inner[np.maximum(lab, 0)]
                    if sel.any():
                        comp = lab[sel]
                        own = owner[sel] + 1  # 0 = uncovered
                        K = len(pids) + 1
                        cnt = np.bincount(comp * K + own, minlength=ncomp * K).reshape(ncomp, K)
                        nown = (cnt > 0).sum(axis=1)
                        for ci in np.nonzero(nown > 1)[0]:
                            row = cnt[ci]
                            tot = int(row.sum())
                            share = 1 - row.max() / tot
                            multi += 1
                            sl = share < th['sliverIslandMinorityShare']
                            slivers += int(sl)
                            if len(isl_info) < 5:
                                isl_info.append({'px': tot, 'minorityShare': round(float(share), 3), 'sliver': bool(sl),
                                                 'owners': {(pids[j - 1] if j else 'uncovered'): int(row[j])
                                                            for j in np.nonzero(row)[0]}})
                adj = int(R.adjacent(unclaimed, polity).sum())
                res = {'year': year, 'lod': lod, 'tile': f'{z}/{x}/{y}', 'area': name,
                       'landPx': int(land.sum()), 'coverPx': int(covered.sum()),
                       'uncoveredPx': int(uncovered.sum()), 'seaPaintPx': int(sea.sum()), 'overlapPx': overlap,
                       'unclaimedPx': int(unclaimed.sum()), 'unclaimedAdjPx': adj,
                       'multiOwnerIslands': multi, 'sliverIslands': slivers, 'islands': isl_info,
                       'owners': len([k for k in kinds if k != 'unclaimed'])}
                res['uncoveredShare'] = round(res['uncoveredPx'] / res['landPx'], 4) if res['landPx'] >= 50 else 0.0
                res['seaPaintShare'] = round(res['seaPaintPx'] / res['coverPx'], 4) if res['coverPx'] >= 50 else 0.0
                res['score'] = res['uncoveredPx'] + res['seaPaintPx'] + 4 * overlap + 50 * slivers
                results.append(res)
                if not args.no_png:
                    # keep rasters only for the current worst tiles of each category (memory stays flat)
                    idx = len(results) - 1
                    for k, h in heaps.items():
                        v = res[k]
                        if v > 0 and (len(h) < PER_CATEGORY or v > h[0][0]):
                            heapq.heappush(h, (v, idx))
                            refs[idx] += 1
                            if len(h) > PER_CATEGORY:
                                _, old = heapq.heappop(h)
                                refs[old] -= 1
                                if refs[old] <= 0:
                                    results[old].pop('_raster', None)
                    if refs[idx] > 0:
                        res['_raster'] = (owner, land, pids, kinds)
        print(f'[tile-qa] {year}: {sum(1 for r in results if r["year"] == year)} tiles ({t})', file=sys.stderr)

    # ---------------------------------------------------------------- totals and thresholds
    def tot(k, lod=None):
        return sum(r[k] for r in results if lod is None or r['lod'] == lod)

    totals = {}
    for lod in [None] + list(tiles):
        land_px, cover_px = tot('landPx', lod), tot('coverPx', lod)
        totals[lod or 'all'] = {
            'tiles': sum(1 for r in results if lod is None or r['lod'] == lod),
            'landPx': land_px, 'uncoveredPx': tot('uncoveredPx', lod), 'seaPaintPx': tot('seaPaintPx', lod),
            'overlapPx': tot('overlapPx', lod), 'multiOwnerIslands': tot('multiOwnerIslands', lod),
            'sliverIslands': tot('sliverIslands', lod), 'unclaimedAdjPx': tot('unclaimedAdjPx', lod),
            'uncoveredShare': round(tot('uncoveredPx', lod) / max(1, land_px), 5),
            'seaPaintShare': round(tot('seaPaintPx', lod) / max(1, cover_px), 5)}
    g = totals['all']
    violations = []
    for r in results:
        if r['uncoveredShare'] > th['tileUncoveredLandShare']:
            violations.append(f"{r['lod']} {r['tile']} {r['year']}: uncovered land {r['uncoveredShare']:.1%} > {th['tileUncoveredLandShare']:.1%}")
        if r['seaPaintShare'] > th['tileSeaPaintShare']:
            violations.append(f"{r['lod']} {r['tile']} {r['year']}: sea paint {r['seaPaintShare']:.1%} > {th['tileSeaPaintShare']:.1%}")
    if g['uncoveredShare'] > th['globalUncoveredLandShare']:
        violations.append(f"global uncovered land {g['uncoveredShare']:.2%} > {th['globalUncoveredLandShare']:.2%}")
    if g['seaPaintShare'] > th['globalSeaPaintShare']:
        violations.append(f"global sea paint {g['seaPaintShare']:.2%} > {th['globalSeaPaintShare']:.2%}")
    if g['overlapPx'] > th['globalOverlapPx']:
        violations.append(f"tier-0 overlap {g['overlapPx']} px > {th['globalOverlapPx']}")
    if g['sliverIslands'] > th['maxSliverIslands']:
        violations.append(f"sliver islands {g['sliverIslands']} > {th['maxSliverIslands']}")

    worst = []
    for k, h in heaps.items():
        for v, idx in sorted(h, reverse=True):
            r = results[idx]
            if r not in worst:
                r['why'] = k
                worst.append(r)
    if args.no_png:
        worst = sorted([r for r in results if r['score'] > 0], key=lambda r: -r['score'])[:12]
    png = None
    if worst and not args.no_png and all('_raster' in r for r in worst):
        png = os.path.join(os.path.dirname(args.out), 'tile-qa-worst.png')
        render_mosaic(worst, png, size)
    for r in results:
        r.pop('_raster', None)
    out = {'generated': U.TODAY, 'dataset': ds, 'years': years, 'thresholds': th, 'totals': totals,
           'violations': violations, 'pass': not violations, 'worst': [
               {k: r[k] for k in ('year', 'lod', 'tile', 'area', 'uncoveredPx', 'seaPaintPx', 'overlapPx', 'sliverIslands', 'score')}
               for r in worst], 'png': png, 'seconds': t.seconds, 'tiles': results}
    U.write_json(args.out, out, indent=None)
    print(f"[tile-qa] {ds['dataset']} {ds['version']}{' (dev)' if dev else ''}: {g['tiles']} tile-years, "
          f"uncovered {g['uncoveredShare']:.3%}, sea paint {g['seaPaintShare']:.3%}, overlap {g['overlapPx']} px, "
          f"multi-owner islands {g['multiOwnerIslands']} (slivers {g['sliverIslands']}), unclaimed-adjacent {g['unclaimedAdjPx']} px; "
          f"{len(violations)} violation(s); {t}")
    for v in violations[:10]:
        print('  ' + v)
    if len(violations) > 10:
        print(f'  ... {len(violations) - 10} more in {args.out}')
    return 1 if violations else 0


def render_mosaic(worst: list[dict], path: str, size: int) -> None:
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    cols = 4
    rows = (len(worst) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3.2, rows * 3.4), dpi=100)
    axes = np.atleast_1d(axes).ravel()
    for ax in axes:
        ax.axis('off')
    for ax, r in zip(axes, worst):
        owner, land, pids, kinds = r['_raster']
        img = np.zeros((size, size, 3), dtype=np.uint8)
        img[:] = (225, 236, 246)  # sea
        pal = np.array([color_of(p) if k != 'unclaimed' else (205, 205, 205) for p, k in zip(pids, kinds)] + [(0, 0, 0)],
                       dtype=np.uint8)
        cov = owner >= 0
        img[cov] = pal[owner[cov]]
        img[land & ~cov] = (228, 26, 28)        # uncovered land: red
        img[cov & ~land] = (31, 58, 147)        # sea paint: dark blue
        ax.imshow(img, interpolation='nearest')
        ax.set_title(f"[{r.get('why', 'score').replace('Px', '')}] {r['lod']} {r['tile']} {r['year']} {r['area']}\n"
                     f"unc {r['uncoveredPx']} sea {r['seaPaintPx']} "
                     f"ovl {r['overlapPx']} sl {r['sliverIslands']}", fontsize=7)
    fig.suptitle('tile QA — worst tiles (red: land without tier 0, dark blue: tier 0 over sea, grey: unclaimed)', fontsize=9)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


if __name__ == '__main__':
    sys.exit(main())
