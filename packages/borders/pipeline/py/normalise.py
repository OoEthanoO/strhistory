"""Step 1: Cliopatria v0.2.0 -> normalised source records (common.py record contract).

* Leaf polities only: Type POLITY with a non-bracketed name. Bracketed composites
  ("(British Empire)") are never drawn; they give their members `partof` (the root of
  the MemberOf chain, brackets stripped) and `power` (that root's pid,
  clio:group-<slug>), so members of one composite share a colour. Non-members get
  power = their own pid.
* RELATION rows (alliances, allegiances) are kept as metadata only.
* Years: Cliopatria's ranges are inclusive; 0 never appears as a start and means
  1 BCE as an end (common.norm_year). Records are cut at CUTOVER - 1 (1945); the
  modern layer takes over in 1946.
* pids: common.clio_pid + common.disambiguate_pids over every Cliopatria row, exactly
  as tools/reference.py; checked against .cache/reference/cliopatria-inventory.json.
* Geometry: make_valid, polygonal parts only, snapped to the precision grid.
"""
from __future__ import annotations

import json
import os
import time
import zipfile
from collections import Counter, defaultdict

from shapely.geometry import shape

import common as C
import geom as G


def read_cliopatria(path: str = C.CLIO_ZIP) -> list[dict]:
    with zipfile.ZipFile(path) as z:
        member = next(n for n in z.namelist() if n.endswith('.geojson') and not n.startswith('__MACOSX'))
        with z.open(member) as f:
            return json.load(f)['features']


def _names(member_of: str | None) -> list[str]:
    return [n.strip() for n in (member_of or '').split(';') if n.strip()]


class GroupChains:
    """MemberOf chains of the bracketed composites, resolved per year range."""

    def __init__(self, rows: list[dict]):
        self.parents: dict[str, list[tuple[int, int, list[str]]]] = defaultdict(list)
        for r in rows:
            if r['bracketed']:
                self.parents[r['name']].append((r['from'], r['to'], _names(r['memberOf'])))

    def _parents(self, name: str, y0: int, y1: int) -> Counter:
        """Parents of a group during [y0, y1], weighted by overlapping years."""
        c: Counter = Counter()
        for a, b, ps in self.parents.get(name, []):
            ov = min(b, y1) - max(a, y0)
            if ov >= 0:
                for p in ps:
                    if p != name:
                        c[p] += ov + 1
        return c

    def root(self, name: str, y0: int, y1: int, seen: frozenset = frozenset()) -> str:
        ps = self._parents(name, y0, y1)
        for p in list(ps):
            if p in seen:
                del ps[p]
        if not ps:
            return name
        best = max(sorted(ps), key=lambda p: ps[p])
        return self.root(best, y0, y1, seen | {name})

    def leaf_root(self, member_of: str | None, y0: int, y1: int) -> str | None:
        names = _names(member_of)
        if not names:
            return None
        roots = [self.root(n, y0, y1) for n in names]
        count = Counter(roots)
        return max(roots, key=lambda n: count[n])  # most common root; ties: first listed


def normalise(log=print) -> dict:
    """Returns {'records', 'relations', 'groups', 'stats', 'log'}."""
    t0 = time.time()
    feats = read_cliopatria()
    rows = []
    for i, f in enumerate(feats):
        p = f['properties']
        name = p['Name']
        typ = p.get('Type') or 'POLITY'
        rows.append({
            'index': i, 'name': name, 'type': typ,
            'bracketed': name.startswith('(') and name.endswith(')'),
            'pid': C.clio_pid(name, typ), 'from': C.norm_year(p['FromYear']), 'to': C.norm_year(p['ToYear'], end=True),
            'wikidata': p.get('Wikidata') or None, 'wikipedia': p.get('Wikipedia') or None,
            'seshat': p.get('SeshatID') or None, 'memberOf': p.get('MemberOf') or None,
            'components': p.get('Components') or None, 'areaKm2': p.get('Area'),
        })
        rows[-1]['rid'] = f"{rows[-1]['pid']}@{rows[-1]['from']}"
    collisions = C.disambiguate_pids(rows)

    # pids must match the reference inventory the auditors use
    inv_path = os.path.join(C.REFERENCE, 'cliopatria-inventory.json')
    mismatches = []
    if os.path.exists(inv_path):
        with open(inv_path, encoding='utf-8') as f:
            inv = {r['index']: r for r in json.load(f)}
        for r in rows:
            ref = inv.get(r['index'])
            if ref is None or ref['pid'] != r['pid'] or ref['rid'] != r['rid']:
                mismatches.append((r['index'], r['rid'], ref and ref['rid']))
        if mismatches:
            raise AssertionError(f'{len(mismatches)} pid/rid mismatches with the reference inventory, e.g. {mismatches[:5]} '
                                 '- run `npm run data:reference` and keep common.py and reference.py in sync')
    else:
        log('[normalise] warning: .cache/reference/cliopatria-inventory.json missing; pids not cross-checked')

    chains = GroupChains(rows)
    group_pid = {r['name']: r['pid'] for r in rows if r['bracketed'] and r['type'] == 'POLITY'}
    leaf_pid_by_name = {r['name']: r['pid'] for r in rows if r['type'] == 'POLITY' and not r['bracketed']}

    records, relations, steplog = [], [], []
    stats = Counter()
    last = C.CUTOVER_YEAR - 1
    for r in rows:
        if r['type'] == 'RELATION':
            stats['relations'] += 1
            relations.append({
                'rid': r['rid'], 'pid': r['pid'], 'name': r['name'].strip('()'), 'from': r['from'], 'to': r['to'],
                'members': [leaf_pid_by_name.get(n.strip(), None) or n.strip() for n in (r['components'] or '').split(';') if n.strip()],
                'wikidata': r['wikidata'], 'wikipedia': r['wikipedia'],
            })
            continue
        if r['bracketed']:
            stats['composites'] += 1
            continue
        if r['type'] != 'POLITY':
            stats[f"skipped type {r['type']}"] += 1
            continue
        if r['from'] > last:
            stats['after cutover'] += 1
            continue
        y1 = min(r['to'], last)
        if y1 != r['to']:
            stats['truncated at cutover'] += 1
        g = G.snap(shape(feats[r['index']]['geometry']))
        if g.is_empty:
            steplog.append({'rid': r['rid'], 'status': 'empty-source', 'detail': 'source geometry is empty after make_valid'})
            stats['empty geometry'] += 1
            continue
        root = chains.leaf_root(r['memberOf'], r['from'], y1)
        rec = {
            'rid': r['rid'], 'pid': r['pid'], 'name': r['name'], 'from': r['from'], 'to': y1,
            'kind': 'state', 'tier': 0,
            'power': group_pid.get(root, C.clio_pid(root)) if root else r['pid'],
            'partof': root[1:-1] if root and root.startswith('(') else root,
            'subjecto': None, 'disputed': False, 'precision': 'exact', 'src': 'cliopatria',
            'geometry': g,
            'prov': {'source': 'cliopatria', 'index': r['index'], **({'seshat': r['seshat']} if r['seshat'] else {})},
        }
        if r['wikidata']:
            rec['wikidata'] = r['wikidata']
        if r['wikipedia']:
            rec['wikipedia'] = r['wikipedia']
        records.append(rec)
        stats['leaf records'] += 1
    stats['pid collisions'] = len(collisions)
    log(f'[normalise] {len(feats)} rows -> {len(records)} leaf records <= {last}, {len(relations)} relations '
        f'({dict(stats)}) in {time.time() - t0:.1f} s')
    groups = {name: {'pid': pid, 'name': name[1:-1]} for name, pid in group_pid.items()}
    return {'records': records, 'relations': relations, 'groups': groups, 'stats': dict(stats), 'log': steplog,
            'collisions': collisions}
