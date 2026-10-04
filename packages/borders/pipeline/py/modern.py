"""Modern layer (1946..present): Natural Earth admin-0 units assigned year by year
from the unit timelines in overrides/modern/ (packages/borders/AGENTS.md §4.3).

Called through overrides.build_modern(ov, ctx). For every year and unit:

  * each subunit with a period that year takes its area (subunit geometry ∩ unit);
    where subunits overlap, the later one in the list wins;
  * the rest of the unit goes to the unit's own period for that year. When there
    is none, the subunits must cover the unit: remainder slivers up to
    max(modernSliverKm2, modernSliverShare x unit area) - admin-1 and admin-0
    outlines differ by fractions of a km2 - join the neighbouring subunit piece,
    anything bigger is an error and stays without a holder;
  * periods whose state is unclaimed (kind 'unclaimed' or pid 'ovr:unclaimed') make
    no record: the pipeline treats that land as unclaimed.

The pieces are then dissolved per state pid and year and merged across consecutive
years while the pieces and attributes stay the same, giving tier-0 records with
from/to. Geometry is exact Natural Earth admin-0 (not clipped to land), so each
year partitions admin-0. Units without any modern timeline fall back to their
Natural Earth sovereign for 1946..present (pid ne:<SOV_A3 lowercase>, where NE's
'X1' sovereign codes map to the home unit: FR1 -> ne:fra, GB1 -> ne:gbr; name
SOVEREIGNT; kind 'other' for NE type 'Indeterminate', else 'state') and are logged
'unaudited'. Overlays become tier-1 records (clipped to land), one per period.
"""
from __future__ import annotations

import copy
import json
import os
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache

import shapely
import shapely.errors
from shapely.geometry import MultiPolygon

import common as C
import overrides as O

UNCLAIMED_PID = 'ovr:unclaimed'
STATE_OPTIONAL = ('partof', 'subjecto', 'wikidata', 'wikipedia', 'altNames', 'note')
# Attributes that must agree when several units give the same pid in the same year.
CONFLICT_KEYS = ('name', 'kind', 'power', 'wikidata')

_CFG = C.CONFIG.get('overrides', {})
SLIVER_KM2 = float(_CFG.get('modernSliverKm2', 1.0))
SLIVER_SHARE = float(_CFG.get('modernSliverShare', 1e-6))


@lru_cache(maxsize=1)
def ne_admin0_meta() -> dict[str, dict]:
    """{ADM0_A3: {name, admin, sovereign, sovA3, type}} from the pinned Natural Earth
    admin-0 file (NAME, ADMIN, SOVEREIGNT, SOV_A3, TYPE)."""
    with open(os.path.join(C.NE_DIR, 'ne_10m_admin_0_countries.geojson'), encoding='utf-8') as f:
        feats = json.load(f)['features']
    return {p['ADM0_A3']: {'name': p.get('NAME'), 'admin': p.get('ADMIN'), 'sovereign': p.get('SOVEREIGNT'),
                           'sovA3': p.get('SOV_A3'), 'type': p.get('TYPE')}
            for p in (x['properties'] for x in feats)}


def sovereign_homes(meta: dict) -> dict[str, str]:
    """{SOV_A3: ADM0_A3 of the sovereign's home unit}. Natural Earth gives the 12
    sovereigns with dependencies a SOV_A3 that is not an admin-0 code (FR1 France, GB1
    United Kingdom, US1, NL1, DN1, AU1, NZ1, CH1, IS1, KA1, FI1, CU1); their home unit
    is the one whose ADMIN equals SOVEREIGNT (FR1 -> FRA). Fallback pids use the home
    code, so they follow the ne:<adm0_a3> convention and merge with the audited state
    (an unaudited New Caledonia joins ne:fra, not a separate 'ne:fr1')."""
    homes = {m['sovA3']: code for code, m in meta.items() if m.get('sovA3') == code}
    for code, m in sorted(meta.items()):
        sov = m.get('sovA3')
        if sov and sov not in homes and m.get('admin') and m.get('admin') == m.get('sovereign'):
            homes[sov] = code
    return homes


def unit_area(ctx, code: str):
    """Natural Earth admin-0 unit on the precision grid (cached per ctx)."""
    cache = O._cache(ctx)
    key = ('unit', code)
    if key not in cache:
        cache[key] = O.snap(ctx.admin0[code])
    return cache[key]


def fallback_state(code: str, meta: dict, homes: dict[str, str] | None = None) -> dict:
    """Holder of a unit that has no modern timeline: its Natural Earth sovereign, as
    pid ne:<home ADM0_A3 of SOV_A3, lowercase> (see sovereign_homes), name SOVEREIGNT;
    kind 'other' for NE type 'Indeterminate' (no-man's lands, reefs), else 'state'."""
    m = meta.get(code) or {}
    homes = sovereign_homes(meta) if homes is None else homes
    sov = m.get('sovA3') or code
    return {'pid': f"ne:{homes.get(sov, sov).lower()}",
            'name': m.get('sovereign') or m.get('name') or code,
            'kind': 'other' if m.get('type') == 'Indeterminate' else 'state'}


def _is_unclaimed(state: dict) -> bool:
    return state.get('kind') == 'unclaimed' or state.get('pid') == UNCLAIMED_PID


def _attrs(state: dict) -> dict:
    pid = state['pid']
    a = {'pid': pid, 'name': state.get('name') or '', 'kind': state.get('kind') or 'state',
         'power': state.get('power') or pid}
    for k in STATE_OPTIONAL:
        a[k] = copy.deepcopy(state.get(k))
    return a


def _attrs_key(attrs: dict) -> str:
    return json.dumps(attrs, sort_keys=True, ensure_ascii=False)


def _span_list(years: list[int]) -> str:
    """'1946..1950, 1960' for a sorted list of years."""
    out, start, prev = [], None, None
    for y in years:
        if start is None:
            start = prev = y
        elif y == prev + 1:
            prev = y
        else:
            out.append(O._span(start, prev))
            start = prev = y
    if start is not None:
        out.append(O._span(start, prev))
    return ', '.join(out)


@dataclass(slots=True)
class _Holder:
    state: dict      # timeline state object (or the fallback state)
    attrs: dict      # record attributes derived from it
    piece: tuple     # key into _Builder.pieces
    unit: str        # ADM0_A3 the piece belongs to
    origin: str      # 'DEU' or 'DEU/west-germany' (log/prov id)
    fallback: bool   # unit without a modern timeline


def _period_at(periods: list[dict], year: int) -> dict | None:
    for p in periods:
        if p['years'][0] <= year <= p['years'][1]:
            return p
    return None


def _attach_target(part, pieces: dict) -> str:
    """Subunit piece a remainder sliver joins: longest shared boundary, else nearest."""
    x0, y0, x1, y1 = part.bounds
    eps = 1e-6
    best, best_len = None, 0.0
    for sid, piece in pieces.items():
        local = shapely.clip_by_rect(piece, x0 - eps, y0 - eps, x1 + eps, y1 + eps)
        if local.is_empty:
            continue
        shared = part.boundary.intersection(local.boundary).length
        if shared > best_len:
            best, best_len = sid, shared
    if best is None:
        best = min(pieces, key=lambda sid: pieces[sid].distance(part))
    return best


class _Builder:
    def __init__(self, ctx, meta: dict):
        self.ctx, self.meta = ctx, meta
        self.homes = sovereign_homes(meta)
        self.pieces: dict[tuple, MultiPolygon] = {}
        self.hand: set[tuple] = set()                     # pieces drawn by hand (polygon specs)
        self.holders: dict[int, list[_Holder]] = defaultdict(list)
        self.problems: dict[str, list[str]] = defaultdict(list)
        self.units: dict[str, dict] = {}                  # code -> {'file', 'fallback'}

    # -- units -------------------------------------------------------------------

    def fallback(self, code: str) -> None:
        state = fallback_state(code, self.meta, self.homes)
        key = (code, 'fallback', '')
        self.pieces[key] = unit_area(self.ctx, code)
        h = _Holder(state, _attrs(state), key, code, code, True)
        for y in range(C.CUTOVER_YEAR, C.PRESENT_YEAR + 1):
            self.holders[y].append(h)
        self.units[code] = {'file': None, 'fallback': True}

    def unit(self, u: dict) -> None:
        code = u['unit']
        probs = self.problems[code]
        probs.extend(u.get('_errors') or [])
        self.units[code] = {'file': u.get('_file'), 'fallback': False}
        area = unit_area(self.ctx, code)

        subs = []  # (id, geometry within the unit, periods, hand-drawn)
        for s in u.get('subunits') or []:
            sid = s['id']
            try:
                g = O.resolve_geometry(s.get('geometry'), self.ctx, at_year=C.CUTOVER_YEAR)
            except O.GeometryError as ex:
                probs.append(f'subunit {sid}: geometry: {ex}')
                continue
            g = O.g_inter(g, area)
            if g.is_empty:
                probs.append(f'subunit {sid} does not overlap unit {code}')
                continue
            subs.append((sid, g, self._periods(s.get('timeline') or [], f'subunit {sid}', probs),
                         O.is_hand_drawn(s.get('geometry'))))
        own = self._periods(u.get('timeline') or [], 'timeline', probs)

        breaks = {C.CUTOVER_YEAR, C.PRESENT_YEAR + 1}
        for p in own + [p for s in subs for p in s[2]]:
            breaks.update((p['years'][0], p['years'][1] + 1))
        breaks = sorted(y for y in breaks if C.CUTOVER_YEAR <= y <= C.PRESENT_YEAR + 1)

        partitions: dict[tuple, tuple] = {}
        for a, nxt in zip(breaks, breaks[1:]):
            b = nxt - 1
            up = _period_at(own, a)
            active = tuple(sid for sid, _, periods, _ in subs if _period_at(periods, a))
            pkey = (active, up is None)
            if pkey not in partitions:
                partitions[pkey] = self._partition(area, subs, active, attach=up is None)
            pieces, rest, rest_km2 = partitions[pkey]
            slots = [(sid, _period_at(periods, a)['state'], f'{code}/{sid}', hand)
                     for sid, _, periods, hand in subs if sid in pieces]
            if not rest.is_empty:
                if up is not None:
                    slots.append(('', up['state'], code, False))
                else:
                    probs.append(f'{O._span(a, b)}: {rest_km2:.1f} km2 of {code} has no holder (no unit period then, '
                                 'and the subunits with periods do not cover the unit)')
            for slot, state, origin, hand in slots:
                if _is_unclaimed(state):
                    continue
                key = (code, pkey, slot)
                self.pieces[key] = pieces[slot] if slot else rest
                if hand:
                    self.hand.add(key)
                h = _Holder(state, _attrs(state), key, code, origin, False)
                for y in range(a, b + 1):
                    self.holders[y].append(h)

    @staticmethod
    def _periods(timeline: list[dict], where: str, probs: list[str]) -> list[dict]:
        """Periods sorted, clamped to the modern window; overlaps reported and trimmed."""
        out: list[dict] = []
        for p in sorted(timeline, key=lambda p: p['years']):
            st = p.get('state')
            a, b = p['years']
            if not isinstance(st, dict) or not st.get('pid'):
                probs.append(f'{where} {O._span(a, b)}: period has no state.pid')
                continue
            if a < C.CUTOVER_YEAR or b > C.PRESENT_YEAR:
                probs.append(f'{where} {O._span(a, b)}: outside {C.CUTOVER_YEAR}..{C.PRESENT_YEAR}')
                a, b = max(a, C.CUTOVER_YEAR), min(b, C.PRESENT_YEAR)
            if out and a <= out[-1]['years'][1]:
                probs.append(f'{where}: periods {O._span(*out[-1]["years"])} and {O._span(a, b)} overlap')
                a = out[-1]['years'][1] + 1
            if a <= b:
                out.append({'years': (a, b), 'state': st})
        return out

    @staticmethod
    def _partition(area, subs, active: tuple, attach: bool):
        """Pieces of a unit for one set of active subunits (later subunits win).
        Returns ({subunit id: geometry}, remainder, remainder km2)."""
        taken = MultiPolygon()
        pieces: dict[str, MultiPolygon] = {}
        for sid, g, _, _ in reversed(subs):
            if sid not in active:
                continue
            piece = O.g_diff(g, taken)
            if piece.is_empty:
                continue
            pieces[sid] = piece
            taken = O.g_union([taken, piece])
        rest = O.g_diff(area, taken) if pieces else area
        rest_km2 = C.area_km2(rest)
        if attach and pieces and not rest.is_empty and rest_km2 <= max(SLIVER_KM2, SLIVER_SHARE * C.area_km2(area)):
            for part in rest.geoms:
                sid = _attach_target(part, pieces)
                pieces[sid] = O.g_union([pieces[sid], part])
            rest = MultiPolygon()
        return pieces, rest, rest_km2

    def summaries(self, limit: int = 8) -> dict[str, str]:
        """{unit code: 'pid "name" (kind) years [subunit]; ...'} for log details."""
        runs: dict[str, dict[tuple, list[int]]] = defaultdict(lambda: defaultdict(list))
        for y in sorted(self.holders):
            for h in self.holders[y]:
                runs[h.unit][(h.origin, h.attrs['pid'], h.attrs['name'], h.attrs['kind'])].append(y)
        out = {}
        for code, by in runs.items():
            parts = []
            for (origin, pid, name, kind), ys in sorted(by.items(), key=lambda kv: (kv[1][0], kv[0][0])):
                sub = f" [{origin.split('/', 1)[1]}]" if '/' in origin else ''
                parts.append(f'{pid} "{name}" ({kind}) {_span_list(ys)}{sub}')
            more = f'; +{len(parts) - limit} more' if len(parts) > limit else ''
            out[code] = '; '.join(parts[:limit]) + more
        return out

    # -- dissolve ----------------------------------------------------------------------

    def records(self, alloc) -> tuple[list[dict], dict[str, set[str]]]:
        """Dissolve per pid and year, merge unchanged consecutive years. Returns
        (records, {unit code: rids of records holding part of it})."""
        per_pid: dict[str, dict[int, tuple]] = defaultdict(dict)
        conflicts: dict[tuple, list[int]] = defaultdict(list)
        for y in sorted(self.holders):
            groups: dict[str, list[_Holder]] = defaultdict(list)
            for h in self.holders[y]:
                groups[h.attrs['pid']].append(h)
            for pid, hs in groups.items():
                attrs, clash = _merge(pid, hs)
                for c in clash:
                    conflicts[c].append(y)
                per_pid[pid][y] = (_attrs_key(attrs), frozenset(h.piece for h in hs), attrs, hs)
        for (pid, field, pairs), ys in conflicts.items():
            msg = (f'{pid} {field} differs between units in {_span_list(ys)}: '
                   + ' vs '.join(f'{v} ({o})' for v, o in sorted(pairs)))
            for _, origin in pairs:
                self.problems[origin.split('/')[0]].append(msg)

        out: list[dict] = []
        unit_rids: dict[str, set[str]] = defaultdict(set)
        geoms: dict[frozenset, MultiPolygon] = {}
        for pid in sorted(per_pid):
            years = sorted(per_pid[pid])
            spans, start, prev = [], years[0], years[0]
            for y in years[1:]:
                cur, nxt = per_pid[pid][prev], per_pid[pid][y]
                if y == prev + 1 and cur[0] == nxt[0] and cur[1] == nxt[1]:
                    prev = y
                    continue
                spans.append((start, prev))
                start = prev = y
            spans.append((start, prev))
            for a, b in spans:
                _, comp, attrs, hs = per_pid[pid][a]
                if comp not in geoms:
                    geoms[comp] = dissolve([self.pieces[k] for k in sorted(comp, key=repr)])
                hand = any(k in self.hand for k in comp)
                prov = {'units': sorted({h.unit for h in hs})}
                audited = sorted({h.origin for h in hs if not h.fallback})
                unaudited = sorted({h.unit for h in hs if h.fallback})
                if audited:
                    prov['overrides'] = audited
                if unaudited:
                    prov['unaudited'] = unaudited
                rec = {'rid': alloc.rid(pid, a), 'pid': pid, 'name': attrs['name'], 'from': a, 'to': b,
                       'kind': attrs['kind'], 'tier': 0, 'power': attrs['power'],
                       'partof': attrs.get('partof'), 'subjecto': attrs.get('subjecto'),
                       'disputed': attrs['kind'] == 'disputed', 'precision': 'approximate' if hand else 'exact',
                       'src': 'override' if hand else 'naturalearth', 'geometry': geoms[comp], 'prov': prov}
                for k in O.OPTIONAL_KEYS:
                    if attrs.get(k) is not None:
                        rec[k] = attrs[k]
                out.append(rec)
                for k in comp:
                    unit_rids[k[0]].add(rec['rid'])
        return out, unit_rids


def dissolve(pieces: list) -> MultiPolygon:
    """Union of pieces that tile without overlaps (unit partitions on the precision
    grid; neighbouring NE units share identical borders). GEOS coverage union removes
    the shared edges in linear time and keeps the input vertices (so the result stays
    on the grid); if the pieces turn out not to form a clean coverage, fall back to
    the snap-rounding union."""
    gs = [g for g in pieces if not g.is_empty]
    if len(gs) <= 1:
        return gs[0] if gs else MultiPolygon()
    try:
        u = shapely.coverage_union_all(gs)
    except shapely.errors.GEOSException:
        u = None
    if (u is not None and not u.is_empty and u.is_valid
            and abs(u.area - sum(g.area for g in gs)) <= 1e-9 * max(u.area, 1e-12)):
        return u if isinstance(u, MultiPolygon) else C.polygonal(u)
    return O.g_union(gs)


def _merge(pid: str, hs: list[_Holder]) -> tuple[dict, set]:
    """Attributes of one pid in one year from all units giving it. Audited units lead
    over fallback placeholders; among those, the unit named by the pid (ne:fra -> FRA)
    leads, else the first by origin. Missing optional attributes are filled from the
    others; disagreements in CONFLICT_KEYS between audited units are returned."""
    want = pid[3:].upper() if pid.startswith('ne:') else None
    ordered = sorted(hs, key=lambda h: (h.fallback, h.unit != want, h.origin))
    lead = ordered[0]
    attrs = dict(lead.attrs)
    clash = set()
    for h in ordered[1:]:
        for k in CONFLICT_KEYS:
            if lead.fallback or h.fallback:
                break  # fallback attributes are placeholders (e.g. kind from the NE type)
            a, b = lead.state.get(k), h.state.get(k)
            if a is not None and b is not None and a != b:
                clash.add((pid, k, frozenset({(json.dumps(a, ensure_ascii=False), lead.origin),
                                              (json.dumps(b, ensure_ascii=False), h.origin)})))
        for k in STATE_OPTIONAL:
            if attrs.get(k) is None and h.state.get(k) is not None:
                attrs[k] = copy.deepcopy(h.state[k])
    return attrs, clash


def _overlays(ov: dict, ctx, alloc) -> tuple[list[dict], list[dict]]:
    records, log = [], []
    for o in ov.get('overlays', []):
        oid, probs = o['id'], list(o.get('_errors') or [])
        try:
            g = O._resolve_on_land(o.get('geometry'), ctx, at_year=C.CUTOVER_YEAR)
        except O.MissingRecordError as ex:
            log.append(O.log_entry(oid, o.get('_file'), 'overlay', 'stale', f'geometry: {ex}'))
            continue
        except O.GeometryError as ex:
            log.append(O.log_entry(oid, o.get('_file'), 'overlay', 'error', f'geometry: {ex}'))
            continue
        if g.is_empty:
            log.append(O.log_entry(oid, o.get('_file'), 'overlay', 'error', 'overlay geometry is empty or not on land'))
            continue
        hand = O.is_hand_drawn(o.get('geometry'))
        rids = []
        for p in o.get('timeline') or []:
            s = p.get('set') if isinstance(p.get('set'), dict) else {}
            a, b = p['years']
            if a < C.CUTOVER_YEAR or b > C.PRESENT_YEAR:
                probs.append(f'period {O._span(a, b)} is outside {C.CUTOVER_YEAR}..{C.PRESENT_YEAR}')
                a, b = max(a, C.CUTOVER_YEAR), min(b, C.PRESENT_YEAR)
            if a > b:
                continue
            kind = s.get('kind') or 'disputed'
            if kind == 'unclaimed':
                probs.append(f'period {O._span(a, b)}: an overlay cannot be unclaimed')
                continue
            if s.get('tier', 1) != 1:
                probs.append('overlays are always tier 1 (set.tier ignored)')
            pid = s.get('pid') or f'ovr:{oid}'
            rec = {'rid': alloc.rid(pid, a), 'pid': pid, 'name': s.get('name') or o.get('label') or oid,
                   'from': a, 'to': b, 'kind': kind, 'tier': 1, 'power': s.get('power') or pid,
                   'partof': s.get('partof'), 'subjecto': s.get('subjecto'), 'disputed': kind == 'disputed',
                   'precision': s.get('precision') or ('approximate' if hand else 'exact'),
                   'src': 'override' if hand else 'naturalearth', 'geometry': g, 'prov': {'overrides': [oid]}}
            for k in O.OPTIONAL_KEYS:
                if s.get(k) is not None:
                    rec[k] = copy.deepcopy(s[k])
            for k in ('controller', 'claimants'):
                if k in s:
                    rec['prov'][k] = copy.deepcopy(s[k])
            records.append(rec)
            rids.append(rec['rid'])
        if probs:
            log.append(O.log_entry(oid, o.get('_file'), 'overlay', 'error', '; '.join(dict.fromkeys(probs)), rids))
        else:
            log.append(O.log_entry(oid, o.get('_file'), 'overlay', 'applied',
                                   f'{len(rids)} tier-1 record(s), {C.area_km2(g):.0f} km2', rids))
    return records, log


def build_modern(ov: dict, ctx, *, units=None, meta: dict | None = None) -> tuple[list[dict], list[dict]]:
    """Records of the modern layer and a log with one entry per unit ('applied',
    'error' or 'unaudited'), per overlay and per modern-file note, plus load errors
    of modern files. See the module docstring for the rules."""
    meta = ne_admin0_meta() if meta is None else meta
    log = [dict(x) for x in ov.get('errors', []) if (x.get('file') or '').startswith('modern/')]
    for e in ov.get('entries', []):
        if e.get('_kind') != 'modern':
            continue
        if e.get('_error'):
            log.append(O._elog(e, 'error', e['_error']))
        elif e.get('op') != 'note':
            log.append(O._elog(e, 'error', "modern files may only hold 'note' entries; use units and overlays"))
        else:
            log.append(O._elog(e, 'skipped', 'note (documentation only)' if e.get('status') == 'active'
                               else f"status {e.get('status')}"))

    defined = {u['unit']: u for u in ov.get('units', [])}
    codes = sorted(ctx.admin0) if units is None else list(dict.fromkeys(units))
    if units is None:
        codes += sorted(c for c in defined if c not in ctx.admin0)
    b = _Builder(ctx, meta)
    for code in codes:
        if code not in ctx.admin0:
            log.append(O.log_entry(code, (defined.get(code) or {}).get('_file'), 'unit', 'error',
                                   f'unknown admin0 code {code} (see .cache/reference/ne-admin0.json)'))
        elif code in defined:
            b.unit(defined[code])
        else:
            b.fallback(code)

    alloc = O._Work([])
    records, unit_rids = b.records(alloc)
    held = b.summaries()
    for code in codes:
        info = b.units.get(code)
        if info is None:
            continue
        probs = list(dict.fromkeys(b.problems.get(code, [])))
        rids = sorted(unit_rids.get(code, ()))
        if info['fallback']:
            st = fallback_state(code, meta, b.homes)
            detail = f"no modern timeline: drawn as {st['name']} ({st['pid']}) {C.CUTOVER_YEAR}..{C.PRESENT_YEAR}"
            log.append(O.log_entry(code, None, 'unit', 'unaudited', '; '.join([detail, *probs]), rids))
        elif probs:
            detail = '; '.join(probs) + f" | held: {held.get(code) or 'by nobody'}"
            log.append(O.log_entry(code, info['file'], 'unit', 'error', detail, rids))
        else:
            detail = f"{held.get(code) or 'unclaimed throughout'} -> {len(rids)} record(s)"
            log.append(O.log_entry(code, info['file'], 'unit', 'applied', detail, rids))
    overlay_records, overlay_log = _overlays(ov, ctx, alloc)
    return records + overlay_records, log + overlay_log
