"""Step 6 of the geometry build: feature attributes and the output files.

Per feature (root AGENTS.md section 5.2, PolityProps):
  a      geodesic area in km2 (common.area_km2), computed once per run in the frame workers
  lx/ly  pole of inaccessibility of the largest part (shapely polylabel, ~0.01 deg,
         inside the polygon); unclaimed land uses a point on its surface (never labelled)
  c      colour slot per power (stable for the whole dataset) from a weighted
         DSATUR colouring of the graph of powers ever adjacent - touching tier-0
         features of different power in any frame, weighted by shared border km x
         years - into config palette.size slots; conflicts that cannot be avoided go
         to the lightest edges. Unclaimed land: c = -1.
  id     1..N in (from, pid, rid) order
  rid    `${pid}@${from}` (the record's own rid when the feature starts with the
         record), '#n' when a pid has several features starting in the same year

Outputs: features.geojsonl (one Feature per line, RFC 7946 winding, exactly the
PolityProps keys), frames.json, polities.json (polity index).
"""
from __future__ import annotations

import json
import os
from collections import Counter, defaultdict

import shapely

import common as C
import geom as G

PROP_KEYS = ('id', 'rid', 'pid', 'name', 'from', 'to', 'kind', 'tier', 'power', 'partof', 'subjecto',
             'disputed', 'precision', 'c', 'a', 'lx', 'ly', 'src')
PALETTE = int(C.CONFIG['palette']['size'])
UNCLAIMED = {'pid': 'none', 'name': '', 'kind': 'unclaimed', 'tier': 0, 'power': 'none', 'partof': None,
             'subjecto': None, 'disputed': False, 'precision': 'exact', 'src': 'naturalearth'}


# ----------------------------------------------------------------------- colours


def colour_powers(adjacency: dict, size: int = PALETTE, powers=()) -> tuple[dict[str, int], dict]:
    """Weighted DSATUR: {power: slot} and stats. adjacency = {(p, q): weight}.

    Order: most distinct neighbour colours first (saturation), then heaviest weighted
    degree, then pid. Each power takes the slot with the least conflicting weight
    (ties: the slot used least so far, then the lowest). Then local search moves a
    power to a cheaper slot until nothing improves (at most 20 passes)."""
    nbr: dict[str, dict[str, float]] = defaultdict(dict)
    for (a, b), w in adjacency.items():
        if a == b or w <= 0:
            continue
        nbr[a][b] = nbr[a].get(b, 0.0) + float(w)
        nbr[b][a] = nbr[b].get(a, 0.0) + float(w)
    nodes = sorted(set(powers) | set(nbr))
    rank = {n: k for k, n in enumerate(nodes)}
    wdeg = {n: sum(nbr[n].values()) for n in nodes}
    colour: dict[str, int] = {}
    used = Counter()
    sat: dict[str, set] = {n: set() for n in nodes}
    todo = set(nodes)

    def cost(n, c):
        return sum(w for m, w in nbr[n].items() if colour.get(m) == c)

    while todo:
        n = max(todo, key=lambda x: (len(sat[x]), wdeg[x], -rank[x]))
        best = min(range(size), key=lambda c: (cost(n, c), used[c], c))
        colour[n] = best
        used[best] += 1
        todo.discard(n)
        for m in nbr[n]:
            sat[m].add(best)
    passes = 0
    for passes in range(1, 21):
        moved = 0
        for n in nodes:
            cur = cost(n, colour[n])
            if cur == 0:
                continue
            best = min(range(size), key=lambda c: (cost(n, c), c != colour[n], c))
            if cost(n, best) < cur:
                colour[n] = best
                moved += 1
        if not moved:
            break
    conflicts = [(a, b, w) for a in nodes for b, w in nbr[a].items() if a < b and colour[a] == colour[b]]
    total = sum(w for a in nodes for w in nbr[a].values()) / 2
    stats = {'powers': len(nodes), 'edges': sum(len(v) for v in nbr.values()) // 2, 'slots': size,
             'max_degree': max((len(v) for v in nbr.values()), default=0),
             'conflicts': len(conflicts), 'conflict_weight_share': round(sum(w for *_, w in conflicts) / total, 6) if total else 0.0,
             'worst_conflicts': [{'a': a, 'b': b, 'weight': round(w, 1)} for a, b, w in sorted(conflicts, key=lambda x: -x[2])[:10]],
             'passes': passes}
    return colour, stats


# ---------------------------------------------------------------------- features


def _round_area(a: float) -> float:
    """km2 with enough digits for microstates (Vatican is 0.0122 km2 in Natural Earth)."""
    return round(a, 6) if a < 100 else round(a, 2)


def make_features(metas: list[dict], runs: list[dict], tier1: list[dict], colours: dict[str, int]) -> list[dict]:
    """Feature property dicts (PolityProps + '_src' telling where the geometry is),
    sorted and numbered. runs: merged frame runs (frames.py); tier1: [{'i', 'a',
    'lx', 'ly', 'bbox'}] for tier-1 records with land."""
    feats = []
    for r in runs:
        key = r['key']
        if isinstance(key, tuple) and key[0] == 'u':
            p = dict(UNCLAIMED, c=-1)
            base_rid = None
        else:
            m = metas[key]
            p = {k: m.get(k) for k in ('pid', 'name', 'kind', 'power', 'partof', 'subjecto', 'precision', 'src')}
            p['tier'] = 0
            p['disputed'] = bool(m.get('disputed')) or m.get('kind') == 'disputed'
            p['c'] = colours.get(m.get('power') or m['pid'], 0)
            base_rid = m['rid'] if r['from'] == m['from'] else None
        p.update({'from': r['from'], 'to': r['to'], 'a': _round_area(r['a']), 'lx': r['lx'], 'ly': r['ly']})
        p['_run'] = r
        p['_rid'] = base_rid
        p['_bbox'] = r['bbox']
        p['_i'] = None if p['kind'] == 'unclaimed' else key   # record index (None: unclaimed land)
        feats.append(p)
    for t in tier1:
        m = metas[t['i']]
        p = {k: m.get(k) for k in ('pid', 'name', 'kind', 'power', 'partof', 'subjecto', 'precision', 'src')}
        p.update({'tier': 1, 'disputed': bool(m.get('disputed')) or m.get('kind') == 'disputed',
                  'c': colours.get(m.get('power') or m['pid'], 0), 'from': m['from'], 'to': m['to'], 'a': _round_area(t['a']),
                  'lx': t['lx'], 'ly': t['ly'], '_tier1': t['i'], '_rid': m['rid'], '_bbox': t['bbox'], '_i': t['i']})
        feats.append(p)
    for p in feats:
        if not p.get('power'):
            p['power'] = p['pid']
    feats.sort(key=lambda p: (p['from'], p['pid'], p['tier'], p['to'], -p['a'], p['lx'], p['ly']))
    used: set[str] = set()
    for n, p in enumerate(feats, start=1):
        p['id'] = n
        rid = p['_rid'] or f"{p['pid']}@{p['from']}"
        if rid in used:
            base, k = f"{p['pid']}@{p['from']}", 2
            while f'{base}#{k}' in used:
                k += 1
            rid = f'{base}#{k}'
        used.add(rid)
        p['rid'] = rid
    return feats


def props_of(p: dict) -> dict:
    """Exactly the PolityProps keys, in contract order."""
    return {k: p[k] for k in PROP_KEYS}


def feature_line(p: dict, geom) -> str:
    """One GeoJSON Feature line: RFC 7946 winding (exterior counter-clockwise), a
    single polygon written as Polygon."""
    g = shapely.orient_polygons(G.mp(geom), exterior_cw=False)
    if len(g.geoms) == 1:
        g = g.geoms[0]
    return ('{"type":"Feature","id":%d,"properties":%s,"geometry":%s}'
            % (p['id'], json.dumps(props_of(p), ensure_ascii=False, separators=(',', ':')), shapely.to_geojson(g)))


# ------------------------------------------------------------------ polity index


def _bbox_union(bbs: list[list[float]]) -> list[float]:
    ivs = []
    for w, s, e, n in bbs:
        if w > e:  # crosses the antimeridian (RFC 7946 section 5.2)
            ivs += [(w, 180.0), (-180.0, e)]
        else:
            ivs.append((w, e))
    w, e = G.circular_interval(ivs)
    if e > 180.0:
        e -= 360.0
    return [round(w, 4), round(min(b[1] for b in bbs), 4), round(e, 4), round(max(b[3] for b in bbs), 4)]


def polity_index(feats: list[dict], metas: list[dict]) -> dict:
    """Record<pid, {name, altNames?, kind, spans, wikidata?, wikipedia?, power?, bbox,
    peak?, src, note?}> (root AGENTS.md section 5.2), pids sorted."""
    by_pid: dict[str, list[dict]] = defaultdict(list)
    for p in feats:
        if p['pid'] != 'none':
            by_pid[p['pid']].append(p)
    rec_by_pid: dict[str, list[dict]] = defaultdict(list)
    for m in metas:
        if m.get('kind') != 'unclaimed':
            rec_by_pid[m['pid']].append(m)
    out = {}
    for pid in sorted(by_pid):
        fs = sorted(by_pid[pid], key=lambda p: (p['from'], p['to']))
        last = fs[-1]
        recs = sorted(rec_by_pid.get(pid, []), key=lambda m: (m['from'], m['to']))
        names = []
        for x in [*fs, *recs]:
            if x.get('name') and x['name'] not in names:
                names.append(x['name'])
        for m in recs:
            for n in m.get('altNames') or []:
                if n and n not in names:
                    names.append(n)
        spans: list[list[int]] = []
        for p in fs:
            if spans and p['from'] <= C.add_years(spans[-1][1], 1):
                spans[-1][1] = max(spans[-1][1], p['to'])
            else:
                spans.append([p['from'], p['to']])
        e: dict = {'name': last['name']}
        alt = [n for n in names if n != last['name']]
        if alt:
            e['altNames'] = alt
        e['kind'] = last['kind']
        e['spans'] = spans
        for k in ('wikidata', 'wikipedia'):
            v = next((m.get(k) for m in reversed(recs) if m.get(k)), None)
            if v:
                e[k] = v
        if last['power'] != pid:
            e['power'] = last['power']
        e['bbox'] = _bbox_union([p['_bbox'] for p in fs])
        base = [p for p in fs if p['tier'] == 0] or fs
        e['peak'] = max(base, key=lambda p: (p['a'], -p['from']))['from']
        e['src'] = last['src']
        note = next((m.get('note') for m in reversed(recs) if m.get('note')), None)
        if note:
            e['note'] = note
        out[pid] = e
    return out


# ------------------------------------------------------------------------ writing


def write_json(path: str, obj, indent=None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent, separators=(',', ':') if indent is None else None)
        f.write('\n')
    os.replace(tmp, path)


def write_features(path: str, feats: list[dict], geom_of) -> dict:
    """Writes features.geojsonl; geom_of(p) returns the feature's shapely geometry."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    n = verts = 0
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        for p in feats:
            g = geom_of(p)
            verts += int(shapely.get_num_coordinates(g))
            f.write(feature_line(p, g))
            f.write('\n')
            n += 1
    os.replace(tmp, path)
    return {'features': n, 'vertices': verts, 'bytes': os.path.getsize(path)}
