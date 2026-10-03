"""Step 7 of the geometry build: QA -> qa-report.json and qa-summary.md.

Hard checks (any failure makes run_geometry.py exit 1):
  lost         every record (blockers aside) has output geometry, unless config
               qa.lostAllowlist names its rid with a reason
  partition    per frame, |polities + unclaimed - land| / land below
               qa.partitionMaxRelDiff (1e-4 = 0.01 %)
  overlaps     no two tier-0 features alive in one frame overlap by more than
               qa.overlapMaxKm2 (0.5 km2; checked pairwise in every frame)
  tier1        tier-1 overlays lie on land (less than qa.overlapMaxKm2 off land)
  microstates  config.microstates: modern features of pid ne:<code> within
               qa.microstateMaxRelDiff (1 %) of the Natural Earth admin-0 area
  ids          positive unique ids, unique rids
  years        no year 0, from <= to, inside first..present
  frames       sorted, unique, no year 0
  overrides    no override entry with status 'error' (root AGENTS.md section 9)

Report (not gates): per audit region (.cache/reference/regions.json) and sample year
(every 50 years before 1700, every 10 after): unclaimed share of the region's land,
islands assigned per rule, and the largest islands still unclaimed (Natural Earth
name when there is one, area, point); plus clip, override, coast and colour logs.
"""
from __future__ import annotations

import json
import os
import time
from collections import Counter, defaultdict

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import shape

import common as C
import geom as G

QA = C.CONFIG.get('qa', {})
PARTITION_MAX = float(QA.get('partitionMaxRelDiff', 1e-4))
OVERLAP_MAX = float(QA.get('overlapMaxKm2', 0.5))
MICRO_MAX = float(QA.get('microstateMaxRelDiff', 0.01))
LOST_ALLOW = dict(QA.get('lostAllowlist', {}))
REPORT_INDEX = os.path.join(C.BUILD, 'geom', 'report-index.pkl')
SIMPLIFY_DEG = 0.01


def sample_years(first: int = C.FIRST_YEAR, present: int = C.PRESENT_YEAR) -> list[int]:
    """Every 50 years before 1700, every 10 years from 1700 (year 0 becomes 1 CE)."""
    out = []
    y = first
    while y < 1700:
        out.append(1 if y == 0 else y)
        y += 50
    y = 1700
    while y <= present:
        out.append(y)
        y += 10
    return out


# ------------------------------------------------------------------- report index


def build_report_index(land, ctx, path: str = REPORT_INDEX) -> str:
    """Audit regions (union of their Natural Earth admin-0 units, simplified), the
    region, Natural Earth name and a point of every logical island. Cached."""
    if os.path.exists(path):
        data = C.load_pickle(path)
        if data.get('key') == (len(land.parts), round(land.total_area, 1)):
            return path
    t = time.time()
    with open(os.path.join(C.REFERENCE, 'regions.json'), encoding='utf-8') as f:
        regions_ref = json.load(f)
    code_region = {code: name for name, r in regions_ref.items() for code in r.get('admin0', [])}
    admin0 = ctx.admin0
    regions = {}
    for name, r in sorted(regions_ref.items()):
        gs = [admin0[c] for c in r.get('admin0', []) if c in admin0]
        g = G.mp(shapely.simplify(G.union([G.snap(x) for x in gs]), SIMPLIFY_DEG, preserve_topology=True)) if gs else G.EMPTY
        regions[name] = {'geom': g, 'km2': C.area_km2(g)}
    codes = sorted(admin0)
    a0 = [admin0[c] for c in codes]
    tree = STRtree(a0)
    names_src = []
    with open(os.path.join(C.NE_DIR, 'ne_10m_geography_regions_polys.geojson'), encoding='utf-8') as f:
        for feat in json.load(f)['features']:
            p = feat['properties']
            if p.get('FEATURECLA') in ('Island', 'Island group') and p.get('NAME'):
                names_src.append((0 if p['FEATURECLA'] == 'Island' else 1, p['NAME'], G.snap(shape(feat['geometry']))))
    ntree = STRtree([g for *_, g in names_src]) if names_src else None
    islands, island_region = {}, {}
    for k, ps in enumerate(land.islands):
        big = max((land.parts[i] for i in ps), key=lambda p: p.area)
        pt = big.point_on_surface()
        hits = tree.query(pt, predicate='intersects')
        if not len(hits):
            j = int(tree.nearest(pt))
            hits = [j] if shapely.distance(pt, a0[j]) < 1.0 else []
        island_region[k] = code_region.get(codes[int(hits[0])], 'other') if len(hits) else 'other'
        name = ''
        if ntree is not None:
            cand = sorted((names_src[int(i)][0], names_src[int(i)][1]) for i in ntree.query(pt, predicate='intersects'))
            if cand:
                name = cand[0][1]
        islands[k] = {'name': name, 'point': [round(pt.x, 3), round(pt.y, 3)]}
    C.save_pickle(path, {'key': (len(land.parts), round(land.total_area, 1)), 'regions': regions,
                         'island_region': island_region, 'islands': islands, 'simplify_deg': SIMPLIFY_DEG})
    print(f'[qa] report index: {len(regions)} regions, {len(islands)} islands ({time.time() - t:.1f} s)', flush=True)
    return path


# ------------------------------------------------------------------------ checks


def _check(name: str, ok: bool, detail: str, items=None) -> dict:
    out = {'check': name, 'ok': bool(ok), 'detail': detail}
    if items:
        out['items'] = items[:200]
        out['count'] = len(items)
    return out


def run_qa(*, metas: list[dict], feats: list[dict], geom_of, frames: list[int], fres: dict, clip_log: list[dict],
           override_log: list[dict], modern_log: list[dict], land, ctx, colour_stats: dict,
           timings: dict, years: tuple[int, int], extra: dict | None = None) -> dict:
    """All checks plus the report sections (geom_of(p) returns a feature's geometry).
    Returns the qa-report dict."""
    checks = []
    # lost records ------------------------------------------------------------
    present = {p['_i'] for p in feats if p.get('_i') is not None}
    clip_by_rid = {e['rid']: e for e in clip_log}
    lost, allowed = [], []
    for i, m in enumerate(metas):
        if m.get('kind') == 'unclaimed' or i in present:
            continue
        e = clip_by_rid.get(m['rid'])
        why = e['detail'] if e and e.get('status') == 'lost' else 'no land left after the coast step (overlaps or assign)'
        item = {'rid': m['rid'], 'name': m.get('name'), 'from': m['from'], 'to': m['to'], 'tier': int(m.get('tier') or 0),
                'reason': why}
        if m['rid'] in LOST_ALLOW:
            item['allowlisted'] = LOST_ALLOW[m['rid']]
            allowed.append(item)
        else:
            lost.append(item)
    checks.append(_check('lost', not lost, f'{len(lost)} record(s) lost, {len(allowed)} allowlisted', lost))

    # partition -----------------------------------------------------------------
    bad = []
    worst = 0.0
    for q in fres['frames_qa']:
        rel = (q['polity_km2'] + q['unclaimed_km2'] - q['land_km2']) / q['land_km2']
        worst = max(worst, abs(rel))
        if abs(rel) >= PARTITION_MAX:
            bad.append({'frame': [q['from'], q['to']], 'relDiff': rel})
    checks.append(_check('partition', not bad, f'max |polities + unclaimed - land| / land = {worst:.2e} '
                                               f'(limit {PARTITION_MAX:g}) over {len(fres["frames_qa"])} frames', bad))

    # overlaps ------------------------------------------------------------------
    v = fres['violations']
    checks.append(_check('overlaps', not v, f'{len(v)} tier-0 overlap(s) above {OVERLAP_MAX:g} km2', v))

    # tier-1 on land ----------------------------------------------------------
    off = []
    for p in feats:
        if p['tier'] != 1:
            continue
        g = geom_of(p)
        hits = land.tree.query(g, predicate='intersects')
        rest = G.diff(g, G.union([land.parts[int(k)] for k in hits])) if len(hits) else g
        km2 = C.area_km2(rest)
        if km2 > OVERLAP_MAX:
            off.append({'rid': p['rid'], 'km2_off_land': round(km2, 3)})
    n1 = sum(1 for p in feats if p['tier'] == 1)
    checks.append(_check('tier1', not off, f'{n1} tier-1 feature(s), {len(off)} with area off land', off))

    # microstates -------------------------------------------------------------
    # A modern feature of pid ne:<code> must hold its Natural Earth admin-0 unit's
    # land within MICRO_MAX and take no land of another admin-0 unit; land outside
    # every admin-0 unit (minor islands of ne_10m_minor_islands given by the island
    # rules) is reported as extra, not counted. Microstates that never appear in
    # the built years are failures only when the build reaches the present.
    micro_items, micro_bad = [], []
    if years[1] >= C.CUTOVER_YEAR:
        a0_codes = sorted(ctx.admin0)
        a0_tree = STRtree([ctx.admin0[c] for c in a0_codes])
        for code in C.CONFIG.get('microstates', []):
            ref = ctx.admin0.get(code)
            if ref is None:
                micro_bad.append({'code': code, 'problem': 'not a Natural Earth admin-0 unit'})
                continue
            ref = G.snap(ref)
            hits = land.tree.query(ref, predicate='intersects')
            ref_km2 = C.area_km2(G.inter(ref, G.union([land.parts[int(k)] for k in hits]))) if len(hits) else 0.0
            pid = 'ne:' + code.lower()
            fs = [p for p in feats if p['pid'] == pid and p['tier'] == 0 and p['to'] >= C.CUTOVER_YEAR]
            if not fs:
                if years[1] >= C.PRESENT_YEAR:
                    micro_bad.append({'code': code, 'pid': pid, 'problem': 'no modern tier-0 feature'})
                else:
                    micro_items.append({'code': code, 'pid': pid, 'note': f'not built in {years[0]}..{years[1]}'})
                continue
            for p in fs:
                g = geom_of(p)
                inside = C.area_km2(G.inter(g, ref))
                outside = G.diff(g, ref)
                taken = 0.0
                if not outside.is_empty:
                    others = [ctx.admin0[a0_codes[int(k)]] for k in a0_tree.query(outside, predicate='intersects')
                              if a0_codes[int(k)] != code]
                    if others:
                        taken = C.area_km2(G.inter(outside, G.union([G.snap(o) for o in others])))
                rel = inside / ref_km2 - 1 if ref_km2 else 0.0
                item = {'code': code, 'rid': p['rid'], 'years': [p['from'], p['to']], 'km2': round(C.area_km2(g), 6),
                        'admin0OnLandKm2': round(ref_km2, 6), 'relDiff': round(rel, 6),
                        'extraKm2': round(C.area_km2(outside) - taken, 6), 'takenFromOthersKm2': round(taken, 6)}
                micro_items.append(item)
                if abs(rel) > MICRO_MAX or taken > max(OVERLAP_MAX, MICRO_MAX * ref_km2):
                    micro_bad.append(item)
        n_feat = sum(1 for it in micro_items if 'rid' in it)
        checks.append(_check('microstates', not micro_bad, f'{n_feat} modern microstate feature(s), {len(micro_bad)} '
                                                           f'outside {MICRO_MAX:.0%} of their admin-0 land or '
                                                           f'holding land of other units', micro_bad))

    # ids, years, frames --------------------------------------------------------
    ids = [p['id'] for p in feats]
    rids = [p['rid'] for p in feats]
    dup_ids = [k for k, n in Counter(ids).items() if n > 1]
    dup_rids = [k for k, n in Counter(rids).items() if n > 1]
    bad_ids = [k for k in ids if not isinstance(k, int) or k <= 0]
    checks.append(_check('ids', not (dup_ids or dup_rids or bad_ids),
                         f'{len(ids)} features, {len(dup_ids)} duplicate id(s), {len(dup_rids)} duplicate rid(s)',
                         [*map(str, dup_ids), *dup_rids, *map(str, bad_ids)]))
    bad_years = [p['rid'] for p in feats if p['from'] == 0 or p['to'] == 0 or p['from'] > p['to']
                 or p['from'] < C.FIRST_YEAR or p['to'] > C.PRESENT_YEAR]
    checks.append(_check('years', not bad_years, f'{len(bad_years)} feature(s) with bad years', bad_years))
    fr_ok = frames == sorted(set(frames)) and 0 not in frames
    checks.append(_check('frames', fr_ok, f'{len(frames)} frames {frames[0] if frames else None}..'
                                          f'{frames[-1] if frames else None}'))

    # overrides -----------------------------------------------------------------
    ov_all = [*override_log, *modern_log]
    errs = [e for e in ov_all if e.get('status') == 'error']
    by_status = Counter(e.get('status') for e in ov_all)
    checks.append(_check('overrides', not errs, f'override log: {dict(by_status)}',
                         [{'id': e.get('id'), 'file': e.get('file'), 'op': e.get('op'), 'detail': e.get('detail')} for e in errs]))

    # report sections -------------------------------------------------------------
    fq = fres['frames_qa']
    rule_totals = Counter()
    for q in fq:
        for k in ('majority', 'near', 'ratio', 'pocket', 'pocket_dateline', 'pocket_lake', 'gap', 'assign_applied',
                  'island_ambiguous'):
            rule_totals[k] += q['counts'].get(k, 0)
    samples = {str(y): s for y, s in sorted(fres['samples'].items())}
    centroids: dict[int, list[float]] = {}
    for smp in samples.values():  # island centroids next to the representative point
        for it in smp.get('largest_unclaimed', []):
            k = int(it['island'])
            if k not in centroids:
                # largest part: an island cut at +/-180 has pieces on both sides
                c = max((land.parts[i] for i in land.islands[k]), key=lambda q: q.area).centroid
                centroids[k] = [round(c.x, 3), round(c.y, 3)]
            it['centroid'] = centroids[k]
    feat_counts = Counter('unclaimed' if p['kind'] == 'unclaimed' else f"tier{p['tier']}" for p in feats)
    report = {
        'schema': 'alexs-atlas.geometry-qa/1',
        'built': time.strftime('%Y-%m-%dT%H:%M:%S'),
        'years': list(years),
        'ok': all(c['ok'] for c in checks),
        'checks': checks,
        'counts': {'records': sum(1 for m in metas if m.get('kind') != 'unclaimed'),
                   'blockers': sum(1 for m in metas if m.get('kind') == 'unclaimed'),
                   'features': len(feats), 'byKind': dict(feat_counts), 'frames': len(frames),
                   'polities': len({p['pid'] for p in feats if p['pid'] != 'none'}),
                   'runsJoinedAcrossBlocks': fres['stats'].get('joins'), 'tracker': fres['stats'].get('tracker')},
        'rules': {'perFrameSum': dict(rule_totals),
                  'note': 'counts summed over frames: islands by rule a (majority) and b (near, ratio); '
                          'pockets and coastal gaps (c1/c2) as pieces; assign entries applied (d)'},
        'frames': [{'from': q['from'], 'to': q['to'], 'records': q['records'], 'tier1': q['tier1'],
                    'unclaimedShare': round(q['unclaimed_km2'] / q['land_km2'], 6),
                    'relDiff': (q['polity_km2'] + q['unclaimed_km2'] - q['land_km2']) / q['land_km2'],
                    'islands': {k: q['counts'].get(k, 0) for k in ('majority', 'near', 'ratio')},
                    'rules': {k: (round(v, 1) if isinstance(v, float) else v) for k, v in sorted(q['counts'].items())},
                    'secs': q['secs']} for q in fq],
        'samples': samples,
        'lostAllowlisted': allowed,
        'clip': {'status': dict(Counter(e['status'] for e in clip_log)),
                 'nearestIsland': [e for e in clip_log if e['status'] == 'nearest-island'][:500]},
        'overrides': {'status': dict(by_status),
                      'problems': [{'id': e.get('id'), 'file': e.get('file'), 'op': e.get('op'), 'status': e.get('status'),
                                    'detail': e.get('detail')} for e in ov_all if e.get('status') in ('error', 'stale')]},
        'coastErrors': fres['errors'][:200],
        'overlapsResolved': sorted((x for q in fq for x in q['overlap_log']), key=lambda x: -x['km2'])[:200],
        'assign': [x for q in fq for x in q['assign_log'] if x.get('status') != 'applied'][:200],
        'colours': colour_stats,
        'microstates': micro_items,
        'timings': timings,
    }
    if extra:
        report.update(extra)
    return report


# ------------------------------------------------------------------------ summary


def summary_markdown(report: dict) -> str:
    L = []
    ok = report['ok']
    L.append(f"# Geometry QA {'PASSED' if ok else 'FAILED'}")
    L.append('')
    L.append(f"Built {report['built']}, years {report['years'][0]}..{report['years'][1]}. "
             f"{report['counts']['features']} features ({report['counts']['byKind']}), "
             f"{report['counts']['polities']} polities, {report['counts']['frames']} frames, "
             f"{report['counts']['records']} records + {report['counts']['blockers']} blockers.")
    L.append('')
    L.append('| check | result | detail |')
    L.append('| --- | --- | --- |')
    for c in report['checks']:
        L.append(f"| {c['check']} | {'ok' if c['ok'] else '**FAIL**'} | {c['detail']} |")
    for c in report['checks']:
        if not c['ok'] and c.get('items'):
            L.append('')
            L.append(f"**{c['check']}** (first {min(10, len(c['items']))} of {c.get('count', len(c['items']))}):")
            for it in c['items'][:10]:
                L.append(f'- `{json.dumps(it, ensure_ascii=False)[:300]}`')
    L.append('')
    L.append('## Unclaimed share of land per audit region (sample years)')
    L.append('')
    samples = report.get('samples', {})
    regions = sorted({r for s in samples.values() for r in s.get('regions', {})})
    show = [y for y in samples if int(y) in (-3000, -2000, -1000, -500, 1, 500, 1000, 1200, 1400, 1500, 1600, 1700,
                                             1750, 1800, 1850, 1900, 1930, 1950, 2000, 2020)]
    if regions and show:
        L.append('| region | ' + ' | '.join(show) + ' |')
        L.append('| --- |' + ' --- |' * len(show))
        for r in regions:
            L.append(f'| {r} | ' + ' | '.join(f"{samples[y]['regions'][r]['share'] * 100:.1f} %" for y in show) + ' |')
    L.append('')
    L.append('## Largest islands still unclaimed')
    L.append('')
    for y in [y for y in ('1700', '1800', '1900', '1940', '2020') if y in samples]:
        items = samples[y]['largest_unclaimed'][:8]
        desc = ', '.join(f"{it['name'] or '(unnamed)'} {it['km2']:,.0f} km2 @ {it['point']}" for it in items)
        L.append(f'- {y}: {desc or "none"}')
    L.append('')
    L.append('## Automatic assignment (summed over frames)')
    L.append('')
    L.append(', '.join(f'{k}: {v:,}' for k, v in report['rules']['perFrameSum'].items()))
    L.append('')
    col = report.get('colours') or {}
    if col:
        L.append(f"Colours: {col.get('powers')} powers, {col.get('edges')} adjacencies, {col.get('slots')} slots, "
                 f"{col.get('conflicts')} same-colour neighbours ({col.get('conflict_weight_share', 0) * 100:.3f} % of "
                 f"border weight).")
    L.append('')
    tm = report.get('timings') or {}
    if tm:
        L.append('Timings (s): ' + ', '.join(f'{k} {v}' for k, v in tm.items()))
    return '\n'.join(L) + '\n'
