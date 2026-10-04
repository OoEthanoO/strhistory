"""Modern timeline generation on synthetic replaces-chains (fake Wikidata client, no network)."""
from __future__ import annotations

import os
import sys

from _harness import run
from shapely.geometry import box

import fcutil as U
import modern_autogen as M

PRESENT = U.PRESENT_YEAR
SOVIET = 'Q15180'


def t(y):
    return [f'+{y:04d}-01-01T00:00:00Z', 11]


def ent(q, label, p31=(), start=None, end=None, p1365=(), p17=(), point=None, links=10, p1366=()):
    claims = {}
    if p31:
        claims['P31'] = [{'v': c, 'r': 'n'} for c in p31]
    if start:
        claims['P571'] = [{'v': t(y), 'r': 'n'} for y in ([start] if isinstance(start, int) else start)]
    if end:
        claims['P576'] = [{'v': t(end), 'r': 'n'}]
    if p1365:
        claims['P1365'] = [{'v': c, 'r': 'n'} for c in p1365]
    if p1366:
        claims['P1366'] = [{'v': c, 'r': 'n'} for c in p1366]
    if p17:
        claims['P17'] = [{'v': c, 'r': 'n'} for c in p17]
    if point:
        claims['P625'] = [{'v': [point[1], point[0]], 'r': 'n'}]
    return {'_v': 1, 'id': q, 'label': label, 'description': '', 'aliases': [], 'enwiki': None,
            'sitelinks': links, 'claims': claims}


class FakeWD:
    def __init__(self, ents):
        self.e = {e['id']: e for e in ents}
        self.stats = {}

    def entities(self, qids, progress=None, refresh=False):
        return {q: self.e.get(q, {'_v': 1, 'id': q, 'missing': True}) for q in qids}

    def sparql(self, query, refresh=False):
        return []


def ne(a3, q, sov=None, admin=None, typ='Sovereign country'):
    return {'ADM0_A3': a3, 'WIKIDATAID': q, 'SOV_A3': sov or a3, 'ADMIN': admin or a3, 'SOVEREIGNT': admin or a3,
            'TYPE': typ, 'NAME_LONG': a3.title()}


def generator(ents, props, geoms):
    shared = {SOVIET: {'pid': 'ovr:soviet-union', 'name': 'Soviet Union', 'wikidata': SOVIET, 'from': 1946,
                       'to': 1991, 'kind': 'state'}}
    g = M.Generator(FakeWD(ents), props, geoms, shared,
                    {'Qcol': {'dependency'}, 'Qssr': {'admin'}, 'Qst': {'state'}}, lambda a3: None)
    g.prefetch([p['WIKIDATAID'] for p in props.values()])
    return g


def setup():
    props = {'AAA': ne('AAA', 'Q100'), 'BBB': ne('BBB', 'Q300'), 'CCC': ne('CCC', 'Q400'), 'DDD': ne('DDD', 'Q500'),
             'EEE': ne('EEE', 'Q600', sov='BBB', admin='Eee', typ='Dependency')}
    props['EEE']['SOVEREIGNT'] = 'BBB'
    geoms = {'AAA': box(0, 0, 10, 10), 'BBB': box(20, 20, 30, 30), 'CCC': box(40, 0, 50, 10),
             'DDD': box(60, 0, 70, 10), 'EEE': box(80, 0, 90, 10)}
    ents = [
        ent('Q100', 'Aaaland', ['Qst'], start=1960, p1365=['Q200'], point=(5, 5)),
        ent('Q200', 'Colony of Aaa', ['Qcol'], start=1890, end=1960, p17=['Q300'], point=(5, 5), p1366=['Q100']),
        ent('Q300', 'Bbbia', ['Qst'], start=1800, point=(25, 25)),
        # restored state: own inception before 1946, predecessor republic of the Soviet Union until 1991
        ent('Q400', 'Cccia', ['Qst'], start=1918, p1365=['Q401'], point=(45, 5)),
        ent('Q401', 'Ccc SSR', ['Qssr'], start=1940, end=1991, p17=[SOVIET], point=(45, 5)),
        ent(SOVIET, 'Soviet Union', ['Qst'], start=1922, end=1991, point=(37.6, 55.7)),
        # merger of two predecessors, the second one located elsewhere is ignored, a third one is ambiguous
        ent('Q500', 'Dddia', ['Qst'], start=1964, p1365=['Q501', 'Q502', 'Q503'], point=(65, 5)),
        ent('Q501', 'Old Ddd', ['Qst'], start=1961, end=1964, point=(65, 5), links=50),
        ent('Q502', 'Far away', ['Qst'], start=1950, end=1964, point=(-100, 40)),
        ent('Q503', 'Ddd islands', ['Qcol'], start=1963, end=1964, point=(69, 9), links=5, p17=['Q300']),
        ent('Q600', 'Eee', ['Qcol'], start=1800, point=(85, 5)),
    ]
    return generator(ents, props, geoms)


def periods(r):
    return [(a, b, st['pid'], st['kind'], st.get('power')) for a, b, st, q in r['periods']]


def test_colony_to_independence():
    r = setup().build('AAA')
    assert periods(r) == [(1946, 1959, 'ovr:colony-of-aaa', 'dependency', 'ne:bbb'),
                          (1960, PRESENT, 'ne:aaa', 'state', None)], periods(r)
    assert not r['issues']


def test_restored_state_after_soviet_union():
    r = setup().build('CCC')
    assert periods(r) == [(1946, 1990, 'ovr:soviet-union', 'state', None),
                          (1991, PRESENT, 'ne:ccc', 'state', None)], periods(r)


def test_merger_is_low_confidence_and_renames_keep_pid():
    g = setup()
    r = g.build('DDD')
    p = periods(r)
    assert p[-1] == (1964, PRESENT, 'ne:ddd', 'state', None)
    assert p[-2][:3] == (1961, 1963, 'ne:ddd') and r['periods'][-2][2]['name'] == 'Old Ddd'  # rename, same pid
    assert any('several predecessors' in i for i in r['issues'])
    assert any('no Wikidata predecessor' in i for i in r['issues'])   # nothing before Old Ddd: fallback
    assert all('Far away' not in i for i in r['issues'])               # located elsewhere: ignored
    u = M.unit_entry(g, r)
    assert u['confidence'] == 'low' and u['timeline'][-1]['years'] == [1964, 'present']
    years = [p['years'] for p in u['timeline']]
    assert years[0][0] == 1946 and all(years[i][1] + 1 == years[i + 1][0] for i in range(len(years) - 1))


def test_dependency_keeps_power_from_natural_earth():
    r = setup().build('EEE')
    assert periods(r) == [(1946, PRESENT, 'ne:eee', 'dependency', 'ne:bbb')], periods(r)


def test_shared_table_parsed_from_agents():
    s = M.parse_shared(os.path.join(U.C.BORDERS, 'AGENTS.md'))
    assert s['Q15180']['pid'] == 'ovr:soviet-union' and s['Q15180']['to'] == 1991
    assert s['Q199841']['pid'] == 'ovr:south-yemen' and s['Q199841']['to'] == 1989 and s['Q199841']['from'] is None
    assert s['Q2415901']['kind'] == 'dependency'


if __name__ == '__main__':
    sys.exit(run(globals()))
