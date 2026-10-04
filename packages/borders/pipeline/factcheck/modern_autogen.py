"""Generate 1946 -> present unit timelines for Natural Earth admin-0 units that no curated
file in overrides/modern/ covers, from Natural Earth (SOVEREIGNT, SOV_A3, TYPE) and Wikidata.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/modern_autogen.py [--offline]

Per unit (its NE WIKIDATAID):
  current period   pid ne:<adm0_a3>; kind from NE: metropole/sovereign -> state, a unit whose
                   sovereign is another unit -> dependency (power ne:<metropole>), Indeterminate
                   -> disputed, Antarctica -> unclaimed (policy). Dependencies with dated P17
                   claims are split by administering power.
  its start        latest P571/P580 in 1947..present; with none, the most common end year of
                   predecessors located in the unit (restored or renamed states)
  earlier periods  walk P1365/P155 (+ reverse P1366/P156) back to 1946. A predecessor maps to:
                   a SHARED MODERN PID (table parsed from packages/borders/AGENTS.md), another NE
                   unit, a dependency (colony/protectorate/mandate/... -> ovr:<slug>, power = its
                   dated P17 country), a subdivision (-> the polity of its P17 country), or a state
                   (-> ne:<unit> when it has no other NE successor = rename, else ovr:<slug>).
                   Year rule: a change in year Y is shown from Y.
                   Items that only alias their successor (Kenya (1963–1964)) or are little-documented are
                   looked through to their own predecessors; items whose capital lies in the unit and that
                   ended after 1945 (Wikidata query) are used when no replaces/follows link exists.
  names            only Wikidata labels, dated English official names (P1448) and Natural Earth names.
                   Colonial empires, historical periods, untyped or little-documented items never name a
                   period of the unit's own pid: it keeps the plain current name (plus a note).
  dated P17        claims of the unit item with dates (Western Sahara: Spanish West Africa 1946–1958,
                   Spanish Sahara 1958–1976) set the holder of those years.
  Cliopatria       is NEVER a source of pids, names or powers after 1945 (unreliable there); it is only a
                   cross-check that adds notes.
  consistency      a final pass gives every pid ONE state object per year across all units (curated files,
                   then the shared pid table, then the pid's own Natural Earth unit, then the most used
                   variant win) and separate pids to different Wikidata items that slugify alike.
Confidence 'medium' when every step is unambiguous and resolved, else 'low' plus a 'note'
entry naming what needs curation (multi-predecessor merges = subunits, unknown power, ...).
Writes overrides/modern/auto-wikidata.json and .cache/factcheck/modern-autogen.json; also runs
the same generator on the CURATED units and writes .cache/factcheck/modern-crosscheck.md
(curated start years vs Wikidata inception and the generator; curated files are not edited).
"""
from __future__ import annotations

import argparse
import math
import os
import re
import sys
from collections import Counter

from shapely.geometry import Point, shape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classes as K  # noqa: E402
import fcutil as U  # noqa: E402
import wikidata as W  # noqa: E402

AUTHOR = 'auto:modern-autogen'
FILE = 'auto-wikidata'
PRESENT = U.PRESENT_YEAR
CUT = U.CUTOVER_YEAR
NEAR_DEG = 0.5  # predecessor point within this distance of the unit counts as located in it
WEAK_LINKS = 8  # fewer Wikidata sitelinks: little-documented item (never names or bounds the unit's own periods)
# P31 classes of umbrella items that are not one state in one period (verified labels, 2026-10-02)
UMBRELLA = {'Q1790360': 'colonial empire', 'Q11514315': 'historical period'}
# label prefix of a dependency item -> administering power (only when its P17/P361 name none)
DEMONYMS = (('British', 'GBR'), ('French', 'FRA'), ('Portuguese', 'PRT'), ('Spanish', 'ESP'), ('Italian', 'ITA'),
            ('Belgian', 'BEL'), ('Dutch', 'NLD'), ('Danish', 'DNK'), ('Norwegian', 'NOR'), ('American', 'USA'),
            ('United States', 'USA'), ('Australian', 'AUS'), ('New Zealand', 'NZL'), ('Japanese', 'JPN'),
            ('South African', 'ZAF'), ('Egyptian', 'EGY'), ('Indonesian', 'IDN'), ('Moroccan', 'MAR'))


# ------------------------------------------------------------------------ shared pids
def parse_shared(path: str) -> dict:
    """{qid: {pid, name, wikidata, from, to, kind}} from the 'Shared modern pids' table."""
    out = {}
    with open(path, encoding='utf-8') as f:
        text = f.read()
    sec = text[text.index('**Shared modern pids**'):]
    sec = sec[:sec.index('\n\n', sec.index('| ---'))]
    for line in sec.splitlines():
        if not line.startswith('| `'):
            continue
        cols = [c.strip() for c in line.strip().strip('|').split('|')]
        pids = re.findall(r'`(ovr:[a-z0-9-]+)`', cols[0])
        names = [n.strip() for n in cols[1].split(' / ')]
        qids = re.findall(r'Q\d+', cols[2])
        m = re.match(r'(\d{4})\s*[–-]\s*(\d{4})', cols[3])
        a, b = (int(m.group(1)), int(m.group(2))) if m else (None, int(re.search(r'(\d{4})', cols[3]).group(1)))
        for i, pid in enumerate(pids):
            out[qids[i]] = {'pid': pid, 'name': names[min(i, len(names) - 1)], 'wikidata': qids[i], 'from': a, 'to': b,
                            'kind': 'dependency' if 'occupied' in pid else 'state'}
    if len(out) < 10:
        raise RuntimeError(f'shared pid table not parsed ({len(out)} rows) — check packages/borders/AGENTS.md §3')
    return out


def curated_units() -> dict:
    """{ADM0_A3: (file, unit)} from every non-auto file in overrides/modern."""
    out = {}
    d = os.path.join(U.OVERRIDES, 'modern')
    for f in sorted(os.listdir(d)):
        if not f.endswith('.json') or f.startswith('auto-'):
            continue
        for u in U.read_json(os.path.join(d, f)).get('units', []):
            out[u['unit']] = (f, u)
    return out


# ------------------------------------------------------------------------ generator
class Generator:
    def __init__(self, wd: W.Client, ne_props: dict, ne_geoms: dict, shared: dict, cats: dict, clio_holder):
        self.wd = wd
        self.ne = ne_props            # a3 -> NE properties
        self.geom = ne_geoms          # a3 -> shapely geometry
        self.shared = shared          # qid -> shared descriptor
        self.cats = cats              # class qid -> set of category roots ('dependency', 'state', 'admin')
        # Cliopatria: cross-check signal only (notes), never a source of pids, names or powers
        self.clio_holder = clio_holder  # fn(a3) -> Cliopatria 1945 record at the unit's label point
        self.clio_recs = lambda a3: []  # fn(a3) -> Cliopatria records (any year >= 1945) at the label point
        self.clio_groups = {}  # Cliopatria group name '(British Empire)' -> its Wikidata id
        self.found = {}  # a3 -> items whose capital lies in the unit and that ended in 1946 or later
        self.split_pids = set()  # shared pids of mergers the generator cannot split (config modern.subunitGroups)
        self.qid_a3 = {p['WIKIDATAID']: a3 for a3, p in ne_props.items() if p.get('WIKIDATAID')}
        self.metro = {}
        for a3, p in ne_props.items():
            if p['ADMIN'] == p['SOVEREIGNT']:
                self.metro[p['SOV_A3']] = a3
        sov_count = Counter(p['SOV_A3'] for p in ne_props.values())
        self.empires = {self.metro[sv] for sv, n in sov_count.items() if n > 1 and sv in self.metro}
        self.ents = {}
        self.rev = {}  # qid -> reverse predecessors (items whose P1366/P156 is qid)
        self._tree = None
        self.labels = {}  # a3 -> NE label point (lon, lat)

    # -------------------------------------------------------------- data
    def ent(self, q):
        if q and q not in self.ents:
            try:
                self.ents.update(self.wd.entities([q]))
            except W.CacheMiss:
                self.ents[q] = None
        return self.ents.get(q)

    def prefetch(self, qids: list[str], depth: int = 5):
        """BFS over predecessors (entities, capitals, reverse links) so building is offline."""
        level = list(dict.fromkeys(qids))
        seen = set()
        for _ in range(depth):
            level = [q for q in level if q not in seen]
            if not level:
                break
            seen |= set(level)
            self.ents.update(self.wd.entities([q for q in level if q not in self.ents], progress='modern'))
            self._reverse(level)
            nxt, leaf = [], []
            for q in level:
                e = self.ents.get(q)
                ends = self.life(q)[1]
                if ends and max(ends) < CUT and q not in self.qid_a3:
                    continue  # ended before 1946: its own predecessors cannot matter
                for p in ('P1365', 'P155'):
                    nxt += [v for v in W.values(e, p) if isinstance(v, str)]
                nxt += self.rev.get(q, [])
                for p in ('P17', 'P361', 'P1366', 'P156', 'P36'):  # fetched, not expanded
                    leaf += [v for v in W.values(e, p) if isinstance(v, str)]
            self.ents.update(self.wd.entities([c for c in dict.fromkeys(leaf) if c not in self.ents], progress='modern leaves'))
            level = nxt
        classes = {c for e in self.ents.values() for c in W.values(e, 'P31')}
        return classes

    def _reverse(self, qids):
        todo = [q for q in qids if q not in self.rev]
        for i in range(0, len(todo), 100):
            part = todo[i:i + 100]
            rows = self.wd.sparql('SELECT DISTINCT ?x ?u WHERE { VALUES ?u { ' + ' '.join('wd:' + q for q in part) +
                                  ' } { ?x wdt:P1366 ?u } UNION { ?x wdt:P156 ?u } }')
            for q in part:
                self.rev.setdefault(q, [])
            for r in rows:
                if r['x'].startswith('Q'):
                    self.rev[r['u']].append(r['x'])

    def label(self, q):
        return (self.ent(q) or {}).get('label') or q

    def life(self, q):
        d = W.dates(self.ent(q))
        s = [y for y, _, _ in d['start'] if y <= PRESENT]
        e = [y for y, _, _ in d['end'] if y <= PRESENT]
        return s, e

    def point(self, q):
        """The capital's coordinates (a polity's own P625 is often a centroid near a border), else P625."""
        e = self.ent(q)
        for cap in W.values(e, 'P36'):
            if isinstance(cap, str):
                c = W.coord(self.ent(cap))
                if c:
                    return c
        return W.coord(e)

    def located_in(self, q, a3) -> bool | None:
        pt = self.point(q)
        if pt is None:
            return None
        g = self.geom.get(a3)
        p = Point(*pt)
        if g.contains(p):
            return True
        if self._tree is None:
            from shapely import STRtree
            self._codes = list(self.geom)
            self._tree = STRtree([self.geom[c] for c in self._codes])
        if len(self._tree.query(p, predicate='intersects')):
            return False  # inside another unit (Kinshasa is 4 km from Brazzaville)
        return bool(g.distance(p) <= NEAR_DEG)  # offshore or coastal point: nearest unit within ~50 km

    def is_self(self, q, a3) -> bool:
        """q is the unit itself: its own item or an item that maps to its ne: pid (anachronistic P17)."""
        return bool(a3) and (q == self.ne[a3]['WIKIDATAID'] or self.qid_a3.get(q) == a3)

    def classes(self, q) -> set:
        cats = set()
        for c in W.values(self.ent(q), 'P31'):
            cats |= self.cats.get(c, set())
        return cats

    def category(self, q, a3=None) -> str:
        """dependency | subdivision (admin unit of another country) | own-subdivision (admin unit of the unit
        itself: a province or municipality) | state | unknown (untyped, or an admin-only item without a
        country such as the French Union: never a holder by itself)."""
        cats = self.classes(q)
        if 'dependency' in cats:
            return 'dependency'
        p17_all = [v for v in W.values(self.ent(q), 'P17') if isinstance(v, str) and v != q]
        p17 = [v for v in p17_all if not self.is_self(v, a3)]
        if 'admin' in cats and p17:
            return 'subdivision'
        if 'state' in cats:
            return 'state'
        if 'admin' in cats and p17_all:
            return 'own-subdivision'
        return 'unknown'

    def preds(self, q) -> list[str]:
        e = self.ent(q)
        out = [v for p in ('P1365', 'P155') for v in W.values(e, p) if isinstance(v, str)]
        out += self.rev.get(q, [])
        return [x for x in dict.fromkeys(out) if x != q]

    def successors(self, q) -> list[str]:
        e = self.ent(q)
        return [v for p in ('P1366', 'P156') for v in W.values(e, p) if isinstance(v, str)]

    def umbrella(self, q) -> bool:
        """A colonial empire or historical period item (Spanish Empire, Persian Empire): not one state."""
        return bool(set(W.values(self.ent(q), 'P31')) & set(UMBRELLA))

    def weak(self, q) -> bool:
        """Little-documented, untyped or umbrella item: never sets the start of the unit's current period and
        never names a period of the unit's own pid."""
        return q not in self.shared and ((self.ent(q) or {}).get('sitelinks', 0) < WEAK_LINKS
                                         or self.category(q) == 'unknown' or self.umbrella(q))

    def strong_preds(self, q, a3, depth=0) -> list[str]:
        """Predecessors of q that are shared or located in the unit; weak ones are looked through."""
        out = []
        for x in self.preds(q):
            if not (x in self.shared or self.located_in(x, a3) is not False):
                continue
            if self.weak(x):
                out += self.strong_preds(x, a3, depth + 1) if depth < 3 else []
            else:
                out.append(x)
        return list(dict.fromkeys(out))

    def unit_name(self, a3, years) -> str:
        """The unit's English name in `years`: an English official name (P1448) whose P580/P582 qualifiers
        cover the years, else the current name."""
        for c in W.claims(self.ent(self.ne[a3]['WIKIDATAID']), 'P1448'):
            v = c.get('v')
            a, b = W.qualifier_year(c, 'P580'), W.qualifier_year(c, 'P582')
            if isinstance(v, list) and v[1] == 'en' and (a or b) and \
                    (a[0] if a else -9999) <= years[0] and years[1] < (b[0] if b else 9999):
                return v[0]
        return self.current(a3)['name']

    def own_state(self, a3, years) -> dict:
        """The unit's own descriptor under its plain (or dated official) name in `years`."""
        st = dict(self.current(a3))
        nm = self.unit_name(a3, years)
        if nm != st['name']:
            st['name'] = nm
            st.pop('wikipedia', None)
        return st

    def demonym_power(self, label) -> str | None:
        """'British Military Administration' -> ne:gbr: the power named by the first words of a dependency's
        Wikidata label (only used when its P17/P361 claims name none)."""
        for adj, a3 in DEMONYMS:
            if a3 in self.ne and (re.match(rf'{adj}\b', label or '') or
                                  re.search(rf'\bunder {adj} administration\b', label or '', re.I)):
                return 'ne:' + a3.lower()
        return None

    def description_power(self, q) -> str | None:
        """'Australian external territory' (Territory of Papua) -> ne:aus: a Wikidata description that calls
        the item a colony/territory/protectorate/mandate of a named power."""
        d = (self.ent(q) or {}).get('description') or ''
        for adj, a3 in DEMONYMS:
            if a3 in self.ne and re.search(rf'\b{adj}\b[^.;]*\b(colony|colonial possession|protectorate|external territory|'
                                           rf'overseas territory|trust territory|mandate|possession|dependency)\b', d, re.I):
                return 'ne:' + a3.lower()
        return None

    def discover_all(self, a3s) -> list[str]:
        """Per unit, the items whose capital (P36) lies in the unit's country item today and that ended
        (P576/P582) in 1946 or later and that are not little-documented (>= WEAK_LINKS sitelinks; this also
        drops the thousands of dissolved municipalities that have a seat): colonies, mandates, provinces and
        earlier states that Wikidata does not link to the unit with replaces/follows. One cached query per unit."""
        out = []
        for a3 in a3s:
            q = self.ne[a3].get('WIKIDATAID')
            if not q:
                continue
            try:
                rows = self.wd.sparql('SELECT DISTINCT ?x WHERE { ?x wdt:P36 ?cap . ?cap wdt:P17 wd:%s . '
                                      '{ ?x wdt:P576 ?e } UNION { ?x wdt:P582 ?e } FILTER(YEAR(?e) >= %d) '
                                      '?x wikibase:sitelinks ?n . FILTER(?n >= %d) }' % (q, CUT, WEAK_LINKS))
            except W.WikidataError:
                rows = []
            self.found[a3] = [r['x'] for r in rows if str(r.get('x', '')).startswith('Q') and r['x'] != q]
            out += self.found[a3]
        return list(dict.fromkeys(out))

    # -------------------------------------------------------------- descriptors
    def current(self, a3) -> dict:
        p = self.ne[a3]
        q = p['WIKIDATAID']
        e = self.ent(q) or {}
        st = {'pid': 'ne:' + a3.lower(), 'name': e.get('label') or p['NAME_LONG'], 'kind': 'state', 'wikidata': q}
        if e.get('enwiki'):
            st['wikipedia'] = e['enwiki']
        metro = self.metro.get(p['SOV_A3'])
        if a3 == 'ATA':
            return {'pid': 'ovr:unclaimed', 'name': '', 'kind': 'unclaimed'}
        if p['TYPE'] == 'Indeterminate':
            st['kind'] = 'disputed'
        elif metro and metro != a3:
            st['kind'] = 'dependency'
            st['power'] = 'ne:' + metro.lower()
        return st

    def country_pid(self, c, depth=0) -> str | None:
        """pid of a country item: shared pid, NE unit, the metropole among its parts (Kingdom of the
        Netherlands -> NLD), else the nearest such item breadth-first over country (P17) and replaced-by
        (P1366) links (Kingdom of Italy -> Italy), at most 5 steps."""
        metros = set(self.metro.values())
        # phase 1: the item's country, then that country's own country / replaced-by chain
        # (British Raj -> British Empire -> Kingdom of Great Britain -> ... -> United Kingdom);
        # phase 2: also the item's own replaced-by (Kingdom of Italy -> Italy)
        for start_props in (('P17',), ('P17', 'P1366')):
            level, seen = [(c, True)], set()
            for _ in range(7):
                nxt = []
                for x, first in level:
                    if not x or x in seen:
                        continue
                    seen.add(x)
                    if x in self.shared:
                        return self.shared[x]['pid']
                    if x in self.qid_a3:
                        return 'ne:' + self.qid_a3[x].lower()
                    e = self.ent(x)
                    for p in ('P527', 'P150'):
                        for v in W.values(e, p):
                            if isinstance(v, str) and self.qid_a3.get(v) in metros:
                                return 'ne:' + self.qid_a3[v].lower()
                    for p in (start_props if first else ('P17', 'P1366')):
                        nxt += [(v, False) for v in W.values(e, p) if isinstance(v, str) and v not in seen]
                level = nxt
        return None

    def p17_in(self, q, years, a3=None) -> list[str]:
        """P17 values of q valid during `years` (qualifiers P580/P582), excluding q and the unit itself."""
        out = []
        for c in W.claims(self.ent(q), 'P17'):
            v = c.get('v')
            if not isinstance(v, str) or v == q or self.is_self(v, a3):
                continue
            a = W.qualifier_year(c, 'P580')
            b = W.qualifier_year(c, 'P582')
            if a and a[0] > years[1]:
                continue
            if b and b[0] < years[0]:
                continue
            out.append(v)
        return out

    def power_of(self, q, years, a3, depth=0) -> tuple[str | None, str | None]:
        own = 'ne:' + a3.lower()
        for c in self.p17_in(q, years, a3):
            pid = self.country_pid(c)
            if pid and pid != own:
                return pid, None
            if not pid:
                return 'ovr:' + U.C.slug(self.label(c)), f'power {self.label(c)} ({c}) is not a Natural Earth unit'
        if depth < 2:
            for part in W.values(self.ent(q), 'P361'):
                if isinstance(part, str) and not self.is_self(part, a3):
                    pid, why = self.power_of(part, years, a3, depth + 1)
                    if pid:
                        return pid, why
        return None, f'no administering power (P17) on {self.label(q)} ({q})'

    def describe(self, q, a3, years, depth=0) -> tuple[dict, list[str]]:
        if q in self.shared:
            s = self.shared[q]
            return {'pid': s['pid'], 'name': s['name'], 'kind': s['kind'], 'wikidata': q}, []
        if q == self.ne[a3]['WIKIDATAID']:
            return self.current(a3), []
        if q in self.qid_a3:
            return self.current(self.qid_a3[q]), []
        e = self.ent(q) or {}
        lab = e.get('label') or self.current(a3)['name'] or q
        base = {'name': lab, 'wikidata': q}
        if e.get('enwiki'):
            base['wikipedia'] = e['enwiki']
        p17 = self.p17_in(q, years, a3)
        for c in p17:  # union republics and other parts of a shared-pid union (Soviet Union, Yugoslavia, ...)
            if c in self.shared:
                return self.describe(c, a3, years, depth + 1)
        cat = self.category(q, a3)
        slug_pid = 'ovr:' + U.C.slug(lab)
        same_shared = next((x for x in self.shared.values() if x['pid'] == slug_pid), None)
        if same_shared:  # 'Yugoslavia' (Q36704) is the shared ovr:yugoslavia: one pid, the table's object
            return self.describe(same_shared['wikidata'], a3, years, depth + 1)
        if cat == 'own-subdivision':  # a province or municipality of the unit itself is the unit
            return self.own_state(a3, years), []
        if cat == 'subdivision' and depth < 3 and 'state' not in self.classes(q):
            # a province is held by the polity of its country: Bengal Presidency -> British Raj (a colony item),
            # East Bengal -> Dominion of Pakistan -> (replaced by) Pakistan = ne:pak; Arsi Province -> Ethiopian
            # Empire -> Ethiopia = the unit itself
            for c in p17:
                if c in self.qid_a3 or c in self.shared:
                    break  # a Natural Earth unit or shared pid: handled below
                if self.category(c, a3) == 'dependency':
                    return self.describe(c, a3, years, depth + 1)
                pid = self.country_pid(c)
                if pid == 'ne:' + a3.lower():
                    return self.own_state(a3, years), []
                if pid and pid.startswith('ne:') and pid[3:].upper() in self.ne:
                    return self.current(pid[3:].upper()), []
        if cat == 'dependency':
            power, why = self.power_of(q, years, a3)
            if not power and (self.demonym_power(lab) or self.description_power(q)):
                power, why = self.demonym_power(lab) or self.description_power(q), None
            st = {'pid': slug_pid, **base, 'kind': 'dependency'}
            if power:
                st['power'] = power
            return st, [why] if why else []
        direct = [c for c in p17 if c in self.qid_a3]  # country = another Natural Earth unit (no guessing)
        if direct and 'state' not in self.classes(q) and depth < 3:
            d3 = self.qid_a3[direct[0]]
            if d3 in self.empires and self.geom[a3].distance(self.geom[d3]) > 2.0:
                # an overseas 'territory' of a power that still has dependencies is a dependency (French Dahomey)
                return {'pid': 'ovr:' + U.C.slug(lab), **base, 'kind': 'dependency', 'power': 'ne:' + d3.lower()}, []
            return self.describe(direct[0], a3, years, depth + 1)  # province of another state (East Pakistan)
        if direct:  # a 'country' whose country is another state is not sovereign (Trucial States -> UK)
            return {'pid': 'ovr:' + U.C.slug(lab), **base, 'kind': 'dependency',
                    'power': 'ne:' + self.qid_a3[direct[0]].lower()}, []
        own = 'ne:' + a3.lower()
        shared_pids = {x['pid'] for x in self.shared.values()}
        succ_all = {self.country_pid(x) for x in self.successors(q)} - {None}
        succ_units = succ_all - shared_pids
        issues = [] if cat != 'unknown' else [f'type of {lab} ({q}) not recognised; treated as a state']
        if succ_units <= {own} and self.current(a3)['kind'] in ('state', 'disputed'):
            if self.weak(q):  # same state, but the item cannot name it (Spanish Empire, Taliban, 6-sitelink items)
                why = ('a colonial empire / historical period' if self.umbrella(q) else 'untyped'
                       if cat == 'unknown' else f"little-documented ({(self.ent(q) or {}).get('sitelinks', 0)} sitelinks)")
                return self.own_state(a3, years), [f'{lab} ({q}) is {why}: the period keeps the plain name of the unit']
            return {'pid': own, **base, 'kind': 'state'}, issues  # same state, earlier name or regime
        if self.description_power(q) and self.description_power(q) != own:  # typed as a country, described as a territory
            return {'pid': slug_pid, **base, 'kind': 'dependency', 'power': self.description_power(q)}, issues
        return {'pid': slug_pid, **base, 'kind': 'state'}, issues

    # -------------------------------------------------------------- timeline
    def next_unit(self, x, a3) -> list[str]:
        """Natural Earth units (other than a3, touching it) that the successors of x map to."""
        out = []
        for y in self.successors(x):
            p = self.country_pid(y)
            if p and p.startswith('ne:') and p[3:].upper() in self.ne and p[3:].upper() != a3                     and self.geom[a3].distance(self.geom[p[3:].upper()]) < 0.5:
                out.append(p[3:].upper())
        return list(dict.fromkeys(out))

    def end_gap(self, x, s) -> int:
        ends = self.life(x)[1]
        return min(abs(e - s) for e in ends) if ends else 50

    def build(self, a3) -> dict:
        self.a3_now = a3
        p = self.ne[a3]
        q = p['WIKIDATAID']
        issues, info, used = [], [], [q]
        cur = self.current(a3)
        starts, _ = self.life(q)
        in_range = [y for y in starts if CUT < y <= PRESENT]
        rel = self.strong_preds(q, a3)  # little-documented items (Apartheid regime, 6 sitelinks) are looked through
        if in_range:
            s0 = max(in_range)
            # a state-like predecessor (rename/regime, or a shared union) that began at the unit's inception and
            # lasted beyond it: the current period starts when it ends (Dominion of Ghana 1957-1960, Libyan
            # Jamahiriya 1977-2011, West Germany 1949-1990)
            for _ in range(5):
                pushed = s0
                for x in rel:
                    xs, xe = self.life(x)
                    big = (self.ent(x) or {}).get('sitelinks', 0) >= 0.08 * (self.ent(q) or {}).get('sitelinks', 0)
                    if xs and xe and min(xs) >= s0 - 1 and s0 < max(xe) <= PRESENT and (
                            x in self.shared or (self.category(x, a3) == 'state' and self.located_in(x, a3) and big)):
                        pushed = max(pushed, max(xe))
                if pushed == s0:
                    break
                s0 = pushed
        else:
            ends = Counter(max(self.life(x)[1]) for x in rel
                           if self.life(x)[1] and CUT < max(self.life(x)[1]) <= PRESENT)
            s0 = max(ends.items(), key=lambda kv: (kv[1], kv[0]))[0] if ends else CUT
        if a3 == 'ATA':
            s0 = CUT
        periods = [[max(s0, CUT), PRESENT, cur, q]]
        s, item, visited, pool, through, found_used = s0, q, {q}, [], set(), False
        shared_pids = {x['pid'] for x in self.shared.values()}
        while s > CUT:
            cands = []
            pool += [x for x in self.preds(item) if x not in pool]  # predecessors of every chain item compete
            for x in pool:  # (the pool grows while it is scanned: looked-through items add their predecessors)
                if x in visited or (x not in self.shared and self.located_in(x, a3) is False
                                    and not set(self.successors(x)) & (visited | through)):  # explicit succession beats location
                    continue
                xs, xe = self.life(x)
                if xs and min(xs) >= s:
                    through.add(x)  # an alias that starts with its successor (Kenya (1963–1964)): look through it
                    pool += [p for p in self.preds(x) if p not in pool]
                    continue
                if xe and max(xe) < CUT:
                    continue
                if not xe and (not xs or min(xs) < 1900) and item not in self.successors(x):
                    continue  # no end date and an old or unknown start: nothing shows it reached 1946
                if x not in self.shared and self.category(x, a3) == 'unknown':
                    through.add(x)  # untyped (French North Africa, French Union): never a holder, look through it
                    issues.append(f'{self.label(x)} ({x}) has no state/dependency/admin type: not used as a holder')
                    pool += [p for p in self.preds(x) if p not in pool]
                    continue
                if self.weak(x):
                    through.add(x)
                    pool += [p for p in self.preds(x) if p not in pool]
                cands.append(x)
            if not cands and not found_used and self.found.get(a3) and a3 not in self.empires:  # (a metropole never was a colony)
                found_used = True  # no replaces/follows link: items whose capital lies in the unit
                pool += [x for x in self.found[a3] if x not in pool and x not in visited
                         and self.category(x, a3) in ('dependency', 'state', 'subdivision') and self.located_in(x, a3)]
                continue
            if not cands:
                fb, why = self.fallback(a3, s, visited)
                issues.append(why)
                periods[0:0] = fb
                break
            if self.split_pids and len({self.describe(x, a3, (CUT, s - 1))[0]['pid'] for x in cands} & self.split_pids) > 1:
                names = sorted({self.describe(x, a3, (CUT, s - 1))[0]['name'] for x in cands
                                if self.describe(x, a3, (CUT, s - 1))[0]['pid'] in self.split_pids})
                issues.append(f"merger of {' and '.join(names)} before {s}: needs subunits; the unit keeps its plain "
                              f"name until then")
                periods.insert(0, [CUT, s - 1, self.own_state(a3, (CUT, s - 1)), None])
                break
            desc = {x: self.describe(x, a3, (CUT, s - 1)) for x in cands}

            lab_pt = self.labels.get(a3)

            def dist(x):  # capital nearest the unit's label point (its main body) breaks ties
                pt = self.point(x)
                return round(((pt[0] - lab_pt[0]) ** 2 + (pt[1] - lab_pt[1]) ** 2) ** 0.5) if pt and lab_pt else 99

            def rank(x):
                return (self.category(x, a3) == 'unknown', self.end_gap(x, s), self.umbrella(x),
                        desc[x][0]['pid'] not in shared_pids,
                        self.located_in(x, a3) is None, not (self.ent(x) or {}).get('label'),
                        -int(math.log((self.ent(x) or {}).get('sitelinks', 0) + 1, 4)), dist(x),
                        -((self.ent(x) or {}).get('sitelinks', 0)), x)
            order = sorted(cands, key=rank)
            best = order[0]
            # a part of another candidate (British Military Administration, part of the Allied administration
            # of Libya) gives way to the whole, which then also covers the part's years
            parts = []
            whole = next((w for w in W.values(self.ent(best), 'P361') if w in cands), None)
            if whole:
                parts = [x for x in cands if whole in W.values(self.ent(x), 'P361')]
                info.append(f'{self.label(best)} ({best}) is part of {self.label(whole)} ({whole}): the whole is used')
                best = whole
                order = [best] + [x for x in order if x != best]
            st, why = desc[best]
            key = (st['pid'], st.get('power'))
            same = [x for x in order if (desc[x][0]['pid'], desc[x][0].get('power')) == key or x in parts]
            others = [x for x in order if x not in same]
            if others:
                issues.append(f'several predecessors before {s}: used {self.label(best)} ({best}); also '
                              + '; '.join(f'{self.label(x)} ({x})' for x in others[:6]) + ' — probably needs subunits')
            bs, be = self.life(best)
            for x in same[1:]:  # different states mapped to one pid but alive side by side (North Vietnam / PRG)
                xs, xe = self.life(x)
                if (self.category(x, a3) in ('state', 'unknown') and self.located_in(x, a3) is not False and xs and bs
                        and best not in self.p17_in(x, (CUT, s - 1), a3) and x not in self.p17_in(best, (CUT, s - 1), a3)
                        and min(xs) < (max(be) if be else s) and min(bs) < (max(xe) if xe else s)):
                    issues.append(f'{self.label(best)} ({best}) and {self.label(x)} ({x}) both precede {s} in the same '
                                  f'years — probably needs subunits')
                    break
            issues += why
            links = (self.ent(best) or {}).get('sitelinks', 0)
            if links < 8 and best not in self.shared:
                issues.append(f'little-documented predecessor {self.label(best)} ({best}, {links} sitelinks): verify it '
                              f'held the whole unit')
            if bs is not None and be and self.end_gap(best, s) > 2:
                issues.append(f'{self.label(best)} ({best}) ends {max(be)} but its successor starts {s}')
            bs = bs + [y for x in parts for y in self.life(x)[0]]
            start = min(bs) if bs else None
            if start is None:
                issues.append(f'{self.label(best)} ({best}) has no start date; assumed to hold the unit from {CUT}')
            span = (min(bs) if bs else CUT, s - 1)
            visited |= {best} | set(parts) | {x for x in same if self.life(x)[1] and max(self.life(x)[1]) > span[0]
                                              and (not self.life(x)[0] or min(self.life(x)[0]) <= span[1])}
            used += [x for x in same if x in visited]
            a, b = (max(start, CUT) if start else CUT), s - 1
            own_starts = [y for y in starts if a < y <= b and be and y >= max(be) - 2]
            if be and max(be) <= b and own_starts:
                # the predecessor ended and the unit itself began before the next item (French Equatorial
                # Africa ends 1958, the Republic of the Congo begins 1960, the People's Republic only in 1969)
                y = min(own_starts)
                periods.insert(0, [y, b, self.own_state(a3, (y, b)), q])
                info.append(f'{self.label(best)} ({best}) ends {max(be)}; the unit itself from its inception {y}')
                b = y - 1
            elif be and st['pid'] != 'ne:' + a3.lower() and max(be) <= b - 2 and len(self.next_unit(best, a3)) == 1:
                # a predecessor that ended long before the next item: its one successor state next door held the
                # unit in between (State of Somaliland, 1960 -> Somali Republic until Somaliland's 1991 declaration)
                nxt = self.next_unit(best, a3)[0]
                periods.insert(0, [max(be), b, self.current(nxt), None])
                info.append(f'{self.label(best)} ({best}) ends {max(be)}: its successor ne:{nxt.lower()} until {b}')
                b = max(be) - 1
            elif be and st['pid'] == 'ne:' + a3.lower() and a < max(be) <= b - 2:
                # a former regime of the unit that ended long before the next item starts (Kingdom of Iraq
                # 1932–1958, then nothing until 2003): it holds its own years only, the unit's name the rest
                periods.insert(0, [max(be), b, self.own_state(a3, (max(be), b)), None])
                b = max(be) - 1
            periods.insert(0, [a, b, st, best])
            s, item = (start if start and start > CUT else CUT), best
        placed = {x for per in periods for x in [per[3]]} | visited
        unused = [x for x in pool if x not in placed and self.located_in(x, a3)
                  and self.life(x)[1] and CUT <= max(self.life(x)[1]) <= PRESENT]
        if unused:
            issues.append('predecessors in the unit not placed in the timeline: '
                          + '; '.join(f'{self.label(x)} ({x}, {min(self.life(x)[0]) if self.life(x)[0] else "?"}–'
                                      f'{max(self.life(x)[1])})' for x in unused[:6]) + ' — probably needs subunits')
        periods = self.split_power(a3, periods, issues)
        periods = self.clip_shared(periods, issues)
        merged = []
        for per in periods:
            if per[0] > per[1]:
                continue
            if merged and merged[-1][2] == per[2] and merged[-1][1] + 1 == per[0]:
                merged[-1][1] = per[1]
            else:
                merged.append(per)
        # unit-level checks
        own = 'ne:' + a3.lower()
        merged = self.dated_holders(a3, merged, issues)
        sourced = [i for i, per in enumerate(merged) if per[2]['pid'] == own and per[3]]
        for i, per in enumerate(merged):
            pid = per[2]['pid']
            if pid.startswith('ne:') and pid != own and sourced and min(sourced) < i < max(sourced):
                # another state between two sourced periods of the unit itself held only a part of it
                # (Israeli Military Governorate of Sinai 1967-1982 inside Egypt): the unit keeps its own state
                issues.append(f"{per[0]}–{per[1]}: {per[2]['name']} ({pid}) between periods of the unit itself "
                              f"(an occupation of part of it?): the unit's own state kept")
                merged[i] = [per[0], per[1], self.own_state(a3, (per[0], per[1])), None]
        merged = [per for i, per in enumerate(merged)]
        for i in range(len(merged) - 1, 0, -1):
            if merged[i][2] == merged[i - 1][2] and merged[i - 1][1] + 1 == merged[i][0]:
                merged[i - 1][1] = merged[i][1]
                del merged[i]
        for per in merged:
            nm = per[2].get('name') or ''
            if per[2]['pid'] == own and 'empire' in nm.lower() and nm != cur['name']:
                issues.append(f"{per[0]}–{per[1]} named after the empire item {nm}: check the period name")
        recs = self.clio_recs(a3)
        if recs and cur['kind'] != 'unclaimed':  # independent check: Cliopatria (to 2024) at the label point
            last = max(r['to'] for r in recs)
            bad = []
            for y in range(CUT, min(PRESENT, last) + 1, 5):
                alive = [r for r in recs if r['from'] <= y <= r['to']]
                per = next((x for x in merged if x[0] <= y <= x[1]), None)
                if alive and per and not self.agrees(min(alive, key=lambda r: r.get('areaKm2') or 0), per[2], a3):
                    bad.append(f"{y} {min(alive, key=lambda r: r.get('areaKm2') or 0)['name']} vs {per[2]['name']}")
            if len(bad) >= 2:
                issues.append('Cliopatria disagrees at the label point: ' + '; '.join(bad[:5]))
        hold = self.clio_holder(a3)
        if cur['kind'] == 'disputed':
            issues.append('Indeterminate status in Natural Earth: de facto control and the tier-1 disputed overlay need curation')
        for per in merged:
            if per[2]['kind'] == 'dependency' and not per[2].get('power'):
                issues.append(f"{per[2]['name']} {per[0]}–{per[1]}: dependency without a resolved power")
        return {'a3': a3, 'periods': merged, 'issues': list(dict.fromkeys(issues)), 'info': info, 'used': list(dict.fromkeys(used)),
                'clio1945': hold, 'start': s0}

    def dated_claims(self, a3) -> list[tuple[int, int, dict]]:
        """(first year, last year, holder) from the unit item's P17 claims that carry P580/P582 dates and name a
        colony item (Spanish Sahara) or another Natural Earth / shared state (Portuguese Empire -> ne:prt; the
        unit was its dependency). Claims naming the unit itself, its current power or a state that is no
        Natural Earth unit (Sahrawi Republic: a claim, not control) are skipped."""
        cur = self.current(a3)
        own = 'ne:' + a3.lower()
        out = []
        unit_item = self.ent(self.ne[a3]['WIKIDATAID'])
        for c in [(c, 'P17') for c in W.claims(unit_item, 'P17')] + [(c, 'P361') for c in W.claims(unit_item, 'P361')]:
            c, prop = c
            v = c.get('v')
            a, b = W.qualifier_year(c, 'P580'), W.qualifier_year(c, 'P582')
            if not isinstance(v, str) or self.is_self(v, a3) or not (a or b):
                continue
            # 'part of' is used for regions and organisations too: only a Natural Earth country (Algeria: part of
            # France until 1962), a shared pid or a colony item counts; a P17 value must at least be a state item
            if prop == 'P361' and not (v in self.qid_a3 or v in self.shared or self.category(v, a3) == 'dependency'):
                continue
            if not (v in self.qid_a3 or v in self.shared or self.category(v, a3) in ('dependency', 'state', 'subdivision')):
                continue
            y0, y1 = max(a[0] if a else CUT, CUT), min((b[0] - 1) if b else PRESENT, PRESENT)
            if y0 > y1:
                continue
            if self.category(v, a3) == 'dependency':
                st, _ = self.describe(v, a3, (y0, y1))
            else:
                pid = self.country_pid(v)
                if not pid or pid == own or pid == cur.get('power') or not (pid.startswith('ne:') or pid in
                                                                           {x['pid'] for x in self.shared.values()}):
                    continue
                if v in self.qid_a3 or v in self.shared or self.umbrella(v):
                    # the metropole or its colonial empire: a dependency under the unit's own (plain) name
                    name = self.unit_name(a3, (y0, y1))
                    st = {'pid': 'ovr:' + U.C.slug(name), 'name': name, 'kind': 'dependency', 'power': pid}
                else:  # a named territory of that power (Spanish Sahara, a province of Spain from 1958)
                    lab = self.label(v)
                    st = {'pid': 'ovr:' + U.C.slug(lab), 'name': lab, 'kind': 'dependency', 'power': pid, 'wikidata': v}
                    if (self.ent(v) or {}).get('enwiki'):
                        st['wikipedia'] = self.ent(v)['enwiki']
            out.append((y0, y1, st, v))
        # most specific first: a colony item before its empire, a short claim before a long one
        return sorted(out, key=lambda c: (c[2]['pid'] in {'ovr:' + U.C.slug(self.unit_name(a3, (c[0], c[1])))}, c[1] - c[0]))

    def dated_holders(self, a3, periods, issues) -> list:
        """Years still held by the unit's own state (kind state/disputed) that a dated P17 claim gives to
        another holder (Western Sahara 1946–1975, Angola 1946–1974) get that holder."""
        own = 'ne:' + a3.lower()
        claims = self.dated_claims(a3)
        if not claims:
            return periods
        out, changed = [], []
        for a, b, st, q in periods:
            for y in range(a, b + 1):
                hit = None
                if st['pid'] == own and st['kind'] in ('state', 'disputed'):
                    hit = next(((st2, q2) for y0, y1, st2, q2 in claims if y0 <= y <= y1), None)
                ys, yq = hit if hit else (st, q)
                if hit:
                    changed.append(y)
                if out and out[-1][2] == ys and out[-1][1] == y - 1:
                    out[-1][1] = y
                else:
                    out.append([y, y, ys, yq])
        if changed:
            issues.append(f'{changed[0]}–{changed[-1]}: holder from dated country (P17) claims of the unit item: '
                          + '; '.join(f"{y0}–{y1} {st['name']}" for y0, y1, st, _ in claims))
        return out

    def clio_country(self, h) -> str | None:
        """Polity pid behind a Cliopatria record: its own Wikidata id, else its group's (memberOf)."""
        for q in (h.get('wikidata'), self.clio_groups.get(h.get('memberOf') or '')):
            pid = self.country_pid(q) if q else None
            if pid:
                return pid
        return None

    def agrees(self, h, st, a3) -> bool:
        """Does Cliopatria record h describe the same holder as period state st?"""
        q = h.get('wikidata')
        if q and q == st.get('wikidata'):
            return True
        if U.similarity(h['name'], st.get('name') or '') >= 0.85:
            return True
        hp = self.clio_country(h)
        if hp and hp in (st['pid'], st.get('power')):
            return True
        cur = self.current(a3)
        return st['pid'] == cur['pid'] and U.similarity(h['name'], cur['name']) >= 0.85

    def fallback(self, a3, s, chain=()) -> tuple[list, str]:
        """Periods for [1946, s-1] when Wikidata has no usable predecessor: the unit's own state under its plain
        (or dated official) name; dated P17 claims of the unit item may still give those years to a colony or
        a metropole (dated_holders). Cliopatria is never used here (unreliable after 1945): it only adds a
        cross-check remark to the note."""
        st = self.own_state(a3, (CUT, s - 1))
        h = self.clio_holder(a3)
        hint = f"; Cliopatria 1945 shows {h['name']} there (cross-check only)" if h else ''
        return ([[CUT, s - 1, st, None]],
                f"no Wikidata predecessor before {s}: {st['name']} ({st['kind']}) extended back to {CUT} (unverified{hint})")

    def split_power(self, a3, periods, issues):
        """Dependencies whose P17 claims carry dates: split the current period by power."""
        last = periods[-1]
        st = last[2]
        if st.get('kind') != 'dependency' or st['pid'] != 'ne:' + a3.lower():
            return periods
        dated = []
        for c in W.claims(self.ent(self.ne[a3]['WIKIDATAID']), 'P17'):
            v = c.get('v')
            a = W.qualifier_year(c, 'P580')
            b = W.qualifier_year(c, 'P582')
            if isinstance(v, str) and (a or b):
                pid = self.country_pid(v)
                if pid:
                    dated.append((a[0] if a else None, b[0] if b else None, pid))
        changes = sorted({a for a, b, pid in dated if a and last[0] < a <= PRESENT})
        if not changes:
            return periods
        out = periods[:-1]
        bounds = [last[0]] + changes + [PRESENT + 1]
        for i in range(len(bounds) - 1):
            y0, y1 = bounds[i], bounds[i + 1] - 1
            pw = next((pid for a, b, pid in dated if (a or -9999) <= y0 and (b is None or b > y0)), st.get('power'))
            out.append([y0, y1, {**st, 'power': pw}, last[3]])
        issues.append('administering power split by dated P17 claims: ' + ', '.join(f'{a}–{b or ""} {pid}' for a, b, pid in dated))
        return out

    def clip_shared(self, periods, issues):
        """Per-year normalisation: later periods win overlaps, shared pids only inside their table years
        (other years take the nearest valid holder), gaps take the previous holder. Always returns a
        contiguous, non-overlapping timeline for 1946..present."""
        windows = {x['pid']: (x['from'], x['to']) for x in self.shared.values()}
        year = {}
        for a, b, st, q in periods:
            for y in range(max(a, CUT), min(b, PRESENT) + 1):
                if y in year and year[y][0] != st:
                    issues.append(f"periods overlap in {y} ({year[y][0]['name']} / {st['name']}): later one kept")
                year[y] = (st, q)

        def valid(st, y):
            w = windows.get(st['pid']) if st else None
            return st is not None and (not w or ((w[0] or -9999) <= y <= w[1]))
        bad = [y for y in range(CUT, PRESENT + 1) if y in year and not valid(year[y][0], y)]
        if bad:
            names = sorted({year[y][0]['name'] for y in bad})
            issues.append(f"{', '.join(names)} outside its shared-pid years in {bad[0]}–{bad[-1]}: nearest holder used")
        fixed = {}
        for y in bad:
            pid, w = year[y][0]['pid'], windows[year[y][0]['pid']]
            after = y > w[1]  # after the window: the successor takes over, before it: the predecessor
            n = PRESENT - CUT + 2
            steps = [k for k in range(1, n)] + [-k for k in range(1, n)]  # successor first, then predecessor
            steps = steps if after else [-k for k in steps]
            near = next((y + d for d in steps if CUT <= y + d <= PRESENT and y + d in year
                         and year[y + d][0]['pid'] != pid and valid(year[y + d][0], y)), None)
            fixed[y] = year[near] if near else (self.current(self.a3_now), None)
        year.update(fixed)
        out = []
        for y in range(CUT, PRESENT + 1):
            st, q = year.get(y) or (out[-1][2], out[-1][3]) if out else year.get(y, (None, None))
            if st is None:
                continue
            if out and out[-1][2] == st and out[-1][1] == y - 1:
                out[-1][1] = y
            else:
                out.append([y, y, st, q])
        if out and out[0][0] > CUT:
            out[0][0] = CUT
        return out


# ------------------------------------------------------------------------ consistency
def _years(p) -> range:
    a, b = p['years']
    return range(max(a, CUT), (PRESENT if b == 'present' else b) + 1)


def harmonize(gen: Generator, results: dict, todo: list, curated: dict) -> list[str]:
    """Final pass over every generated unit: (1) different Wikidata items that slugify to one generated ovr: pid
    get distinct pids (the most used item keeps it, the others get '-<unit name>'); (2) every pid gets ONE state
    object per year across all units — curated files win, then the shared pid table, then the pid's own
    Natural Earth unit (ne:pak in PAK), then the variant held by most units; periods are split where needed.
    Changes `results` in place; returns log lines."""
    import json
    log = []
    shared = {x['pid']: x for x in gen.shared.values()}
    cur_periods = [(f'{f}:{a3}', p) for a3, (f, u) in sorted(curated.items())
                   for p in u.get('timeline', []) + [p for su in u.get('subunits', []) for p in su.get('timeline', [])]]
    curated_pids = {p['state']['pid'] for _, p in cur_periods}
    # (1) one pid, one Wikidata item
    by_pid = {}
    for a3 in todo:
        for a, b, st, q in results[a3]['periods']:
            if st['pid'].startswith('ovr:') and st['pid'] not in shared and st['pid'] not in curated_pids and st.get('wikidata'):
                by_pid.setdefault(st['pid'], {}).setdefault(st['wikidata'], set()).add(a3)
    for pid, items in sorted(by_pid.items()):
        if len(items) < 2:
            continue
        ranked = sorted(items.items(), key=lambda kv: (-len(kv[1]), min(kv[1])))
        for q, units in ranked[1:]:
            new = f"{pid}-{U.C.slug(gen.ne[min(units)]['NAME_LONG'])}"
            for a3 in units:
                for per in results[a3]['periods']:
                    if per[2]['pid'] == pid and per[2].get('wikidata') == q:
                        per[2] = {**per[2], 'pid': new}
                results[a3]['info'].append(f'{pid} also names {ranked[0][0]} elsewhere: this item ({q}) uses {new}')
            log.append(f'{pid}: {q} ({", ".join(sorted(units))}) differs from {ranked[0][0]} '
                       f'({", ".join(sorted(ranked[0][1]))}) -> {new}')
    # (2) canonical object per (pid, year)
    canon = {}
    for src, p in cur_periods:
        for y in _years(p):
            canon.setdefault((p['state']['pid'], y), (p['state'], src))
    for pid, x in shared.items():
        for y in range(max(x['from'] or CUT, CUT), x['to'] + 1):
            canon.setdefault((pid, y), ({'pid': pid, 'name': x['name'], 'kind': x['kind'], 'wikidata': x['wikidata']},
                                        'shared pid table'))
    for a3 in todo:
        own = 'ne:' + a3.lower()
        for a, b, st, q in results[a3]['periods']:
            if st['pid'] == own:
                for y in range(a, b + 1):
                    canon.setdefault((own, y), (st, a3))
    votes = {}
    for a3 in todo:
        for a, b, st, q in results[a3]['periods']:
            for y in range(a, b + 1):
                if (st['pid'], y) not in canon:
                    votes.setdefault((st['pid'], y), Counter())[json.dumps(st, sort_keys=True, ensure_ascii=False)] += 1
    for key, cnt in votes.items():
        canon[key] = (json.loads(max(cnt.items(), key=lambda kv: (kv[1], kv[0]))[0]), 'most used')
    # (3) rewrite the generated timelines
    for a3 in todo:
        out, changed = [], []
        for a, b, st, q in results[a3]['periods']:
            for y in range(a, b + 1):
                c = canon.get((st['pid'], y))
                ys = c[0] if c else st
                if ys != st:
                    changed.append((y, st['pid'], c[1]))
                if out and out[-1][2] == ys and out[-1][1] == y - 1:
                    out[-1][1] = y
                else:
                    out.append([y, y, dict(ys), q])
        results[a3]['periods'] = out
        if changed:
            pids = sorted({(p, s) for _, p, s in changed})
            results[a3]['info'].append('state objects aligned with other units: '
                                       + ', '.join(f'{p} ({s})' for p, s in pids))
            log += [f'{a3}: {p} aligned with {s}' for p, s in pids]
        for a, b, st, q in out:
            if st['pid'].startswith('clio:'):
                raise RuntimeError(f'{a3}: Cliopatria pid {st["pid"]} in a modern period ({a}–{b})')
    return log


# ------------------------------------------------------------------------ output
def unit_entry(gen: Generator, r: dict) -> dict:
    a3 = r['a3']
    tl = []
    for a, b, st, q in r['periods']:
        per = {'years': [a, 'present' if b >= PRESENT else b], 'state': {k: v for k, v in st.items() if v is not None}}
        if q:
            per['sources'] = [{'title': f'Wikidata {q}: {gen.label(q)}', 'url': W.entity_url(q)}]
        tl.append(per)
    hold = r['clio1945']
    notes = (f"Generated from Wikidata (P571/P1365/P155/P17) and Natural Earth ({gen.ne[a3]['TYPE']}, sovereign "
             f"{gen.ne[a3]['SOVEREIGNT']}). Cliopatria 1945 at the label point: "
             f"{hold['name'] + ' (' + hold['pid'] + ')' if hold else 'nothing'}.")
    if r.get('info'):
        notes += ' ' + ' | '.join(r['info']) + '.'
    if r['issues']:
        notes += ' Needs curation: ' + ' | '.join(r['issues'])
    return {'unit': a3, 'label': gen.ne[a3]['NAME_LONG'], 'timeline': tl,
            'sources': [{'title': f'Wikidata {q}: {gen.label(q)}', 'url': W.entity_url(q)} for q in r['used'][:8]],
            'notes': notes, 'confidence': 'low' if r['issues'] else 'medium', 'author': AUTHOR, 'date': U.TODAY}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)
    t = U.Timer()
    cfg_all = U.load_config()
    wd = W.Client(offline=args.offline or None, verbose=args.verbose)
    shared = parse_shared(os.path.join(U.C.BORDERS, 'AGENTS.md'))
    shared_labels = wd.entities(list(shared))
    shared_check = {q: (s['name'], (shared_labels.get(q) or {}).get('label')) for q, s in shared.items()}

    ne = U.read_json(os.path.join(U.C.NE_DIR, 'ne_10m_admin_0_countries.geojson'))['features']
    props = {f['properties']['ADM0_A3']: f['properties'] for f in ne}
    geoms = {f['properties']['ADM0_A3']: shape(f['geometry']) for f in ne}
    labels = {a['code']: a.get('label') for a in U.load_admin0()}

    # categories of classes: dependency / state / admin (verified roots + searched classes)
    pol = cfg_all['classes']['political']
    dep_roots = K.verified(wd, cfg_all['modern']['dependencyClasses'])
    extra_dep, dep_log = K.by_search(wd, cfg_all['modern']['dependencySearchTerms'],
                                     cfg_all['classes']['searchTerms']['descriptionKeywords'],
                                     list(K.verified(wd, pol)))
    dep_roots.update(extra_dep)
    state_roots = {q: l for q, l in pol.items() if l in ('state', 'country', 'historical country', 'kingdom', 'empire',
                                                          'confederation', 'city-state', 'principality')}
    admin_roots = {q: l for q, l in pol.items() if l == 'administrative territorial entity'}

    # Cliopatria 1945 holder at each unit's label point
    import pickle
    import shapely
    from shapely import STRtree
    inv = [r for r in U.load_inventory() if r['to'] >= CUT - 1 and r['type'] == 'POLITY'
           and not r['pid'].startswith('clio:group-')]
    with open(os.path.join(U.REFERENCE, 'cliopatria-geoms.pkl'), 'rb') as f:
        wkb = pickle.load(f)
    inv = [r for r in inv if r['rid'] in wkb]
    tree = STRtree([shapely.from_wkb(wkb[r['rid']]) for r in inv])
    del wkb

    point_recs = {}

    def clio_recs(a3):
        if a3 not in point_recs:
            lab = labels.get(a3)
            point_recs[a3] = [inv[i] for i in tree.query(Point(*lab), predicate='intersects')] if lab else []
        return point_recs[a3]

    def clio_holder(a3):
        hits = [h for h in clio_recs(a3) if h['from'] <= CUT - 1 <= h['to']]
        return min(hits, key=lambda h: h.get('areaKm2') or 0) if hits else None

    curated = curated_units()
    todo = sorted(a3 for a3 in props if a3 not in curated)
    gen = Generator(wd, props, geoms, shared, {}, clio_holder)
    gen.clio_recs = clio_recs
    gen.labels = labels
    gen.clio_groups = {r['name']: r['wikidata'] for r in U.load_inventory()
                       if r['pid'].startswith('clio:group-') and r.get('wikidata')}
    # apply the confident Cliopatria id fixes of check_cliopatria.py (auto-wikidata active updates)
    fixes = {}
    for kind in ('historical', 'early'):
        path = U.override_path(kind, 'auto-wikidata')
        if os.path.exists(path):
            for e in U.read_json(path).get('entries', []):
                if e.get('op') == 'update' and e.get('status') == 'active' and (e.get('set') or {}).get('wikidata'):
                    fixes[e['target']['pid']] = e['set']['wikidata']
    for r in inv:
        if r['pid'] in fixes:
            r['wikidata'] = fixes[r['pid']]
    gen.split_pids = set(cfg_all['modern'].get('subunitGroups', {}).get('pids', []))
    gen.prefetch([props[a3]['WIKIDATAID'] for a3 in sorted(props)])
    found = gen.discover_all(sorted(props))  # items whose capital lies in the unit (unlinked predecessors)
    cls = gen.prefetch(found, depth=1)
    roots = {**dep_roots, **state_roots, **admin_roots}
    reach = wd.class_roots(cls, list(roots))
    cat_of_root = {**{q: 'dependency' for q in dep_roots}, **{q: 'state' for q in state_roots},
                   **{q: 'admin' for q in admin_roots}}
    gen.cats = {c: {cat_of_root[r] for r in rs} for c, rs in reach.items()}
    print(f'[modern] {len(todo)} units to generate ({len(curated)} curated), {len(gen.ents)} entities ({t})', file=sys.stderr)

    results = {a3: gen.build(a3) for a3 in sorted(props)}
    hlog = harmonize(gen, results, todo, curated)
    print(f'[modern] consistency pass: {len(hlog)} change(s)' + ''.join(f'\n  {x}' for x in hlog[:40]), file=sys.stderr)
    units, entries = [], []
    for a3 in todo:
        r = results[a3]
        u = unit_entry(gen, r)
        units.append(u)
        if r['issues']:
            entries.append({'id': f'm-auto-wikidata-{a3.lower()}', 'op': 'note', 'years': [CUT, 'present'],
                            'reason': f"AUTO-GENERATED timeline for {a3} ({props[a3]['NAME_LONG']}) has low confidence: "
                                      + ' | '.join(r['issues']),
                            'sources': u['sources'][:4], 'confidence': 'low', 'status': 'proposed',
                            'author': AUTHOR, 'date': U.TODAY})
    scope = ('Generated by pipeline/factcheck/modern_autogen.py for every Natural Earth admin-0 unit that no curated file in '
             'overrides/modern covers (rerun after curated files change; a curated unit always wins). Timelines from Natural '
             'Earth sovereignty plus Wikidata inception/replaces/country claims; confidence medium or low; low units are listed '
             'as note entries. Replace by curated timelines when a region is audited.')
    U.write_json(U.override_path('modern', FILE),
                 U.override_file('modern', FILE, scope, entries, units=units))
    conf = Counter(u['confidence'] for u in units)

    # cross-check of curated units
    rows, agree = [], Counter()
    for a3, (f, u) in sorted(curated.items()):
        own = 'ne:' + a3.lower()
        cper = [p for p in u.get('timeline', []) if p['state']['pid'] == own]
        cstart = min(p['years'][0] for p in cper) if cper else None
        r = results[a3]
        gstart = next((a for a, b, st, q in r['periods'] if st['pid'] == own), None)
        starts, _ = gen.life(props[a3]['WIKIDATAID'])
        wd_in = sorted({y for y in starts if y > 1900})
        cb = sorted({p['years'][0] for p in u.get('timeline', [])} - {CUT})
        gb = sorted({a for a, b, st, q in r['periods']} - {CUT})
        ok_start = cstart == gstart
        agree['start' if ok_start else 'start-diff'] += 1
        agree['bounds' if cb == gb else 'bounds-diff'] += 1
        if not ok_start or (cstart and wd_in and cstart > CUT and cstart not in wd_in):
            rows.append([a3, f, cstart, gstart, ', '.join(map(str, wd_in)) or '–', ', '.join(map(str, cb)) or '–',
                         ', '.join(map(str, gb)) or '–',
                         'curated start not among Wikidata inceptions' if cstart and wd_in and cstart > CUT and cstart not in wd_in
                         else 'generator differs'])
    md = [f'# Modern layer cross-check ({U.TODAY})', '',
          'Curated unit timelines compared with Wikidata inception years (P571/P580 after 1900) and with what '
          '`modern_autogen.py` derives from Wikidata. Curated files are not changed; review each row.', '',
          f"Units: {len(curated)} curated; first year of the unit's own ne: pid equal to the generator in {agree['start']} "
          f"(differs in {agree['start-diff']}); all period boundaries equal in {agree['bounds']} (differ in {agree['bounds-diff']}).",
          '', U.md_table(rows, ['unit', 'file', 'curated start of own pid', 'generator start', 'Wikidata inceptions',
                                'curated boundaries', 'generator boundaries', 'finding']), '',
          '## Shared pid table vs Wikidata labels', '',
          U.md_table([[q, n, l, 'ok' if l and (n.lower() in l.lower() or l.lower() in n.lower() or U.similarity(n, l) >= 0.6) else 'CHECK']
                      for q, (n, l) in shared_check.items()], ['QID', 'AGENTS.md name', 'Wikidata label', ''])]
    U.write_text(os.path.join(U.OUT_DIR, 'modern-crosscheck.md'), '\n'.join(md))
    U.write_json(os.path.join(U.OUT_DIR, 'modern-autogen.json'), {
        'generated': U.TODAY, 'units': len(units), 'confidence': dict(conf), 'curated': len(curated),
        'crosscheck': dict(agree), 'dependencyClasses': dep_roots, 'dependencySearch': dep_log,
        'results': {a3: {**{k: v for k, v in r.items() if k != 'periods'},
                         'periods': [[a, b, st] for a, b, st, q in r['periods']]} for a3, r in results.items()},
        'seconds': t.seconds, 'wikidata': wd.stats})
    print(f"[modern] units {len(units)} (curated {len(curated)}) confidence {dict(conf)} notes {len(entries)} | "
          f"cross-check start agree {agree['start']}/{len(curated)}, boundaries {agree['bounds']}/{len(curated)} | {t} | "
          f"requests {wd.stats['requests']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
