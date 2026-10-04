"""Blockers: land that overrides deliberately leave without a polity.

The coast step (coast.py) fills uncovered land next to polities: pockets, small
islands and coastal gaps. Land that an override removed on purpose must not be
re-filled by those rules, so it is represented by internal 'blocker' records
(kind 'unclaimed', pid 'none', tier 0) that take part in the coast step like a
polity, lose every overlap with real polities and end up in the unclaimed land.
They are never written as features.

Two sources:

* removal_blockers(before, after): Cliopatria land that the historical/early record
  operations took away from a polity's tier-0 records - `subtract` (ghost
  territories), `delete`, an `update` that moves a record to tier 1, and the area a
  tier-0 `add` carves out (covered by the add itself, so harmless). Records are
  matched by their Cliopatria row (prov['index']), which every piece derived from a
  source record keeps.
* modern_blockers(ov, ctx): unit or subunit periods of the modern timelines whose
  state is unclaimed (kind 'unclaimed' or pid 'ovr:unclaimed'); modern.py makes no
  record for them (overrides/modern, packages/borders/AGENTS.md section 4.3).
"""
from __future__ import annotations

from collections import defaultdict

import common as C
import geom as G

UNCLAIMED_PID = 'ovr:unclaimed'
MIN_KM2 = 0.01          # removed areas smaller than this are numerical noise


def blocker(geometry, y0: int, y1: int, n: int, prov: dict) -> dict:
    """An internal blocker record (common.py record contract, kind 'unclaimed')."""
    return {
        'rid': f'none@{y0}#blk{n}', 'pid': 'none', 'name': '', 'from': y0, 'to': y1,
        'kind': 'unclaimed', 'tier': 0, 'power': 'none', 'partof': None, 'subjecto': None,
        'disputed': False, 'precision': 'exact', 'src': 'override', 'geometry': geometry,
        'prov': {'blocker': True, **prov},
    }


def _tier0(r: dict) -> bool:
    return int(r.get('tier') or 0) == 0 and r.get('kind') != 'unclaimed'


def _gaps(y0: int, y1: int, spans: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Sub-ranges of [y0, y1] covered by none of the spans (historical years)."""
    out, cur = [], y0
    for a, b in sorted(spans):
        if a > cur:
            out.append((cur, C.add_years(a, -1)))
        if b >= cur:
            cur = C.add_years(b, 1)
    if cur <= y1:
        out.append((cur, y1))
    return [(a, b) for a, b in out if a <= b]


def removal_blockers(before: list[dict], after: list[dict]) -> list[dict]:
    """Blockers for Cliopatria land removed from tier 0 by the record operations."""
    pieces: dict[int, list[dict]] = defaultdict(list)
    for r in after:
        idx = (r.get('prov') or {}).get('index')
        if idx is not None and _tier0(r):
            pieces[idx].append(r)
    out: list[dict] = []
    for o in before:
        idx = (o.get('prov') or {}).get('index')
        if idx is None or not _tier0(o):
            continue
        ps = pieces.get(idx, [])
        if len(ps) == 1 and ps[0]['geometry'] is o['geometry'] and ps[0]['from'] == o['from'] and ps[0]['to'] == o['to']:
            continue  # untouched (the common case)
        ids = sorted({x for p in ps for x in (p.get('prov') or {}).get('overrides', [])})
        for a, b in _gaps(o['from'], o['to'], [(p['from'], p['to']) for p in ps]):
            out.append(blocker(o['geometry'], a, b, len(out) + 1, {'of': o['rid'], 'why': 'removed', 'overrides': ids}))
        for p in ps:
            if p['geometry'] is o['geometry']:
                continue
            g = G.diff(o['geometry'], p['geometry'])
            if C.area_km2(g) >= MIN_KM2:
                out.append(blocker(g, p['from'], p['to'], len(out) + 1,
                                   {'of': o['rid'], 'why': 'subtracted', 'overrides': (p.get('prov') or {}).get('overrides', [])}))
    return out


def _unclaimed_state(state) -> bool:
    return isinstance(state, dict) and (state.get('kind') == 'unclaimed' or state.get('pid') == UNCLAIMED_PID)


def modern_blockers(ov: dict, ctx, resolve=None) -> list[dict]:
    """Blockers for the unclaimed periods of modern unit timelines. `resolve(spec, ctx)`
    turns a subunit geometry spec into a MultiPolygon (overrides.resolve_geometry)."""
    out: list[dict] = []

    def years(p):
        a, b = p['years']
        return max(int(a), C.CUTOVER_YEAR), min(int(b), C.PRESENT_YEAR)

    for u in ov.get('units', []):
        code = u.get('unit')
        unit_geom = ctx.admin0.get(code) if code else None
        if unit_geom is None:
            continue
        for p in u.get('timeline', []):
            a, b = years(p)
            if a <= b and _unclaimed_state(p.get('state')):
                out.append(blocker(G.snap(unit_geom), a, b, len(out) + 1, {'unit': code, 'why': 'unclaimed period'}))
        for s in u.get('subunits', []):
            periods = [p for p in s.get('timeline', []) if _unclaimed_state(p.get('state'))]
            if not periods or resolve is None:
                continue
            try:
                g = G.inter(G.snap(resolve(s.get('geometry'), ctx)), G.snap(unit_geom))
            except Exception as ex:  # noqa: BLE001 - a broken spec is PG2's error to report
                print(f"[blockers] {code}/{s.get('id')}: cannot resolve the subunit geometry ({ex}); no blocker")
                continue
            for p in periods:
                a, b = years(p)
                if a <= b and not g.is_empty:
                    out.append(blocker(g, a, b, len(out) + 1, {'unit': code, 'subunit': s.get('id'), 'why': 'unclaimed period'}))
    return out
