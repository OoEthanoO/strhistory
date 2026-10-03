"""Rules of the modern timeline generator that integration depends on (fake Wikidata, no network):

1. Cliopatria is never a source of pids, names or powers after 1945 (only a cross-check note).
2. One canonical state object per pid and year across all units (consistency pass), distinct pids
   for distinct Wikidata items that slugify alike, the shared-pid table's object for shared pids.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/tests/test_modern_rules.py
"""
from __future__ import annotations

import sys

from _harness import run
from shapely.geometry import box

import fcutil as U
import modern_autogen as M
from test_timeline import FakeWD, ent, ne, t

PRESENT = U.PRESENT_YEAR
YUGO = 'Q83286'
CLASSES = {'Qcol': {'dependency'}, 'Qprov': {'admin'}, 'Qst': {'state'}, 'Qemp': {'state'}}


def dated(v, a=None, b=None):
    """A claim with P580/P582 qualifiers."""
    q = {}
    if a:
        q['P580'] = [t(a)]
    if b:
        q['P582'] = [t(b)]
    return {'v': v, 'r': 'n', 'q': q}


def build_gen(ents, props, geoms, clio=None, labels=None):
    shared = {YUGO: {'pid': 'ovr:yugoslavia', 'name': 'Yugoslavia', 'wikidata': YUGO, 'from': 1946, 'to': 1991,
                     'kind': 'state'}}
    clio = clio or {}
    g = M.Generator(FakeWD(ents), props, geoms, shared, CLASSES,
                    lambda a3: next((r for r in clio.get(a3, []) if r['from'] <= 1945 <= r['to']), None))
    g.clio_recs = lambda a3: clio.get(a3, [])
    g.labels = labels or {}
    g.prefetch([p['WIKIDATAID'] for p in props.values()])
    return g


def periods(r):
    return [(a, b, st['pid'], st['name'], st['kind'], st.get('power')) for a, b, st, q in r['periods']]


# ------------------------------------------------------------------ rule 1: no Cliopatria
def world_cliopatria():
    """CCC: independent since 1960, Wikidata knows nothing earlier. Cliopatria at its label point has a
    record 'Estado Novo' (1930-1974) whose Wikidata id is the neighbour unit DDD (the COG/COD case)."""
    props = {'CCC': ne('CCC', 'Q10'), 'DDD': ne('DDD', 'Q20'), 'MMM': ne('MMM', 'Q30')}
    geoms = {'CCC': box(0, 0, 10, 10), 'DDD': box(10, 0, 20, 10), 'MMM': box(40, 40, 50, 50)}
    ents = [ent('Q10', 'Cccland', ['Qst'], start=1960, point=(5, 5)),
            ent('Q20', 'Dddland', ['Qst'], start=1960, point=(15, 5)),
            ent('Q30', 'Mmmland', ['Qst'], start=1800, point=(45, 45))]
    clio = {'CCC': [{'pid': 'clio:estado-novo', 'name': 'Estado Novo', 'wikidata': 'Q20', 'from': 1930, 'to': 1974,
                     'areaKm2': 10, 'memberOf': None},
                    {'pid': 'clio:republic-of-ddd', 'name': 'Republic of the Ddd', 'wikidata': 'Q20', 'from': 1975,
                     'to': 2024, 'areaKm2': 10, 'memberOf': None}]}
    return build_gen(ents, props, geoms, clio)


def test_no_cliopatria_pid_name_or_power_in_modern_periods():
    g = world_cliopatria()
    r = g.build('CCC')
    for a, b, pid, name, kind, power in periods(r):
        assert not pid.startswith('clio:'), periods(r)
        assert name not in ('Estado Novo', 'Republic of the Ddd'), periods(r)
        assert pid != 'ne:ddd' and power != 'ne:ddd', periods(r)  # Congo-Brazzaville never becomes Congo-Kinshasa
    # nothing in Wikidata before 1960: the unit keeps its plain current name, flagged for curation
    assert periods(r)[0][:4] == (1946, PRESENT, 'ne:ccc', 'Cccland'), periods(r)
    assert any('no Wikidata predecessor before 1960' in i for i in r['issues'])
    assert any('Cliopatria' in i and 'cross-check' in i for i in r['issues'])  # still reported, as a cross-check
    u = M.unit_entry(g, r)
    assert u['confidence'] == 'low'


def test_dated_country_claims_give_colony_years_without_cliopatria():
    """Angola-like: P17 'Portuguese Empire' (replaced by the metropole) dated until independence."""
    props = {'AAA': ne('AAA', 'Q10'), 'PPP': ne('PPP', 'Q30')}
    geoms = {'AAA': box(0, 0, 10, 10), 'PPP': box(40, 40, 50, 50)}
    a = ent('Q10', 'Aaaland', ['Qst'], start=1975, point=(5, 5))
    a['claims']['P17'] = [{'v': 'Q10', 'r': 'n'}, dated('Q31', 1575, 1975)]
    emp = ent('Q31', 'Ppp Empire', ['Qemp', 'Q1790360'], start=1415, end=1999, p1366=['Q30'])  # a colonial empire
    ents = [a, emp, ent('Q30', 'Pppland', ['Qst'], start=1143, point=(45, 45))]
    clio = {'AAA': [{'pid': 'clio:estado-novo', 'name': 'Estado Novo', 'wikidata': None, 'from': 1930, 'to': 1974,
                     'areaKm2': 10, 'memberOf': None}]}
    r = build_gen(ents, props, geoms, clio).build('AAA')
    p = periods(r)
    assert p[0] == (1946, 1974, 'ovr:aaaland', 'Aaaland', 'dependency', 'ne:ppp'), p
    assert p[-1][:5] == (1975, PRESENT, 'ne:aaa', 'Aaaland', 'state'), p


def test_umbrella_and_little_documented_items_never_name_the_unit():
    """Spain-like (colonial empire predecessor) and South-Africa-like (6-sitelink regime item between the
    Union and the present state): plain names, and the regime does not move the current period's start."""
    props = {'SSS': ne('SSS', 'Q10'), 'ZZZ': ne('ZZZ', 'Q20')}
    geoms = {'SSS': box(0, 0, 10, 10), 'ZZZ': box(20, 0, 30, 10)}
    sss = ent('Q10', 'Sssland', ['Qst'], start=[1715, 1978], p1365=['Q11'], point=(5, 5))
    sss_emp = ent('Q11', 'Sss Empire', ['Qemp', 'Q1790360'], start=1492, end=1976, p1366=['Q10'], point=(5, 5))
    zzz = ent('Q20', 'Zzzland', ['Qst'], start=1910, p1365=['Q21'], point=(25, 5))
    regime = ent('Q21', 'The Regime in Zzzland', ['Qst'], start=1948, end=1994, point=(25, 5), links=6, p1366=['Q20'])
    regime['claims']['P155'] = [{'v': 'Q22', 'r': 'n'}]
    union = ent('Q22', 'Union of Zzzland', ['Qst'], start=1910, end=1961, point=(25, 5), links=60, p1366=['Q20'])
    g = build_gen([sss, sss_emp, zzz, regime, union], props, geoms)
    s = periods(g.build('SSS'))
    assert all(x[2] == 'ne:sss' and x[3] == 'Sssland' for x in s), s
    z = periods(g.build('ZZZ'))
    assert z == [(1946, 1960, 'ne:zzz', 'Union of Zzzland', 'state', None),
                 (1961, PRESENT, 'ne:zzz', 'Zzzland', 'state', None)], z


def test_former_regime_holds_only_its_own_years():
    """Iraq-like: Kingdom (1932-1958) then nothing until an authority of 2003: the kingdom ends in 1957."""
    props = {'III': ne('III', 'Q10')}
    geoms = {'III': box(0, 0, 10, 10)}
    iii = ent('Q10', 'Iiiland', ['Qst'], start=[1932, 2004], p1365=['Q12'], point=(5, 5))
    iii['claims']['P155'] = [{'v': 'Q11', 'r': 'n'}]
    king = ent('Q11', 'Kingdom of Iii', ['Qst'], start=1932, end=1958, point=(5, 5), links=60, p1366=['Q10'])
    auth = ent('Q12', 'Provisional Authority', ['Qst'], start=2003, end=2004, point=(5, 5), links=60, p1366=['Q10'])
    p = periods(build_gen([iii, king, auth], props, geoms).build('III'))
    assert p[0] == (1946, 1957, 'ne:iii', 'Kingdom of Iii', 'state', None), p
    assert p[1] == (1958, 2002, 'ne:iii', 'Iiiland', 'state', None), p


def test_own_inception_splits_a_predecessor_that_ended_early():
    """Congo-Brazzaville-like: federation of colonies ends 1958, the unit itself begins 1960, the next
    Wikidata item (People's Republic) only in 1969: 1960-1968 is the unit, not the federation."""
    props = {'CGO': ne('CGO', 'Q10'), 'FRR': ne('FRR', 'Q90')}
    geoms = {'CGO': box(0, 0, 10, 10), 'FRR': box(40, 40, 50, 50)}
    cgo = ent('Q10', 'Cgoland', ['Qst'], start=1960, p1365=['Q11'], point=(5, 5), links=300)
    prc = ent('Q11', "People's Republic of Cgo", ['Qst'], start=1969, end=1992, point=(5, 5), links=40, p1366=['Q10'])
    fea = ent('Q12', 'Frr Equatorial Federation', ['Qcol'], start=1910, end=1958, point=(5, 5), links=50, p17=['Q90'])
    g = build_gen([cgo, prc, fea, ent('Q90', 'Frrland', ['Qst'], start=1800, point=(45, 45))], props, geoms)
    g.found = {'CGO': ['Q12']}  # found by the capital query (no replaces/follows link)
    p = periods(g.build('CGO'))
    assert p[0] == (1946, 1959, 'ovr:frr-equatorial-federation', 'Frr Equatorial Federation', 'dependency', 'ne:frr'), p
    assert p[1][:4] == (1960, 1968, 'ne:cgo', 'Cgoland'), p


def test_specific_dated_claim_beats_the_empire_claim():
    """Western-Sahara-like: P17 Empire 1884-1976 and the colony items 1946-1958 / 1958-1976; a claimed
    state that is no Natural Earth unit (1976-) is ignored (claims are not control)."""
    props = {'WSA': ne('WSA', 'Q10', typ='Indeterminate'), 'ESS': ne('ESS', 'Q30')}
    geoms = {'WSA': box(0, 0, 10, 10), 'ESS': box(40, 40, 50, 50)}
    wsa = ent('Q10', 'West Saharaland', point=(5, 5), links=200)
    wsa['claims']['P17'] = [dated('Q31', 1884, 1976), dated('Q32', 1946, 1958), dated('Q33', 1958, 1976), dated('Q34', 1976)]
    ents = [wsa, ent('Q30', 'Essland', ['Qst'], start=1500, point=(45, 45)),
            ent('Q31', 'Ess Empire', ['Qemp'], start=1492, end=1976, p1366=['Q30']),
            ent('Q32', 'Ess West Africa', ['Qcol'], start=1946, end=1958, p17=['Q30']),
            ent('Q33', 'Ess Sahara', ['Qcol'], start=1958, end=1976, p17=['Q30']),
            ent('Q34', 'Saharan Republic', ['Qst'], start=1976, point=(5, 5))]
    p = periods(build_gen(ents, props, geoms).build('WSA'))
    assert p[0] == (1946, 1957, 'ovr:ess-west-africa', 'Ess West Africa', 'dependency', 'ne:ess'), p
    assert p[1] == (1958, 1975, 'ovr:ess-sahara', 'Ess Sahara', 'dependency', 'ne:ess'), p
    assert p[2][:5] == (1976, PRESENT, 'ne:wsa', 'West Saharaland', 'disputed'), p


# ------------------------------------------------------------------ rule 2: one object per pid
def world_merge():
    """PPP: Dominion of P (1947-1956) then P; BBB: its eastern province (P17 = P) 1947-1971, then BBB.
    SOM/LBY: two different items both labelled 'British Military Administration'. SRB: predecessor item
    labelled 'Yugoslavia' that is not the shared table's QID."""
    props = {'PPP': ne('PPP', 'Q10'), 'BBB': ne('BBB', 'Q20'), 'GBR': ne('GBR', 'Q90'), 'SOM': ne('SOM', 'Q40'),
             'LBY': ne('LBY', 'Q50'), 'SRB': ne('SRB', 'Q60')}
    for a3 in props:
        props[a3]['NAME_LONG'] = {'SOM': 'Somalia', 'LBY': 'Libya'}.get(a3, a3.title())
    geoms = {'PPP': box(0, 0, 10, 10), 'BBB': box(20, 0, 30, 10), 'GBR': box(-10, 50, 0, 60), 'SOM': box(40, 0, 50, 10),
             'LBY': box(10, 20, 20, 30), 'SRB': box(20, 40, 25, 45)}
    ents = [
        ent('Q10', 'P', ['Qst'], start=1956, p1365=['Q11'], point=(5, 5), links=300),
        ent('Q11', 'Dominion of P', ['Qst'], start=1947, end=1956, point=(5, 5), links=60, p1366=['Q10']),
        ent('Q20', 'Bbbland', ['Qst'], start=1971, p1365=['Q21'], point=(25, 5), links=300),
        ent('Q21', 'East P', ['Qprov'], start=1947, end=1971, p17=['Q11'], point=(25, 5), links=60, p1366=['Q20']),
        ent('Q90', 'Gbr', ['Qst'], start=1707, point=(-5, 55)),
        ent('Q40', 'Somland', ['Qst'], start=1950, p1365=['Q41'], point=(45, 5), links=300),
        ent('Q41', 'British Military Administration', ['Qcol'], start=1941, end=1950, point=(45, 5), links=4,
            p1366=['Q40']),
        ent('Q50', 'Libland', ['Qst'], start=1951, p1365=['Q51'], point=(15, 25), links=300),
        ent('Q51', 'British Military Administration', ['Qcol'], start=1943, end=1951, point=(15, 25), links=14,
            p1366=['Q50'], p17=['Q90']),
        ent('Q60', 'Srbland', ['Qst'], start=2006, p1365=['Q61'], point=(22, 42), links=300),
        ent('Q61', 'Yugoslavia', ['Qst'], start=1918, end=2006, point=(20.5, 44.8), links=200, p1366=['Q60']),
        ent(YUGO, 'Socialist Federal Republic of Yugoslavia', ['Qst'], start=1945, end=1992, point=(20.5, 44.8)),
    ]
    return build_gen(ents, props, geoms)


def harmonized(curated=None):
    g = world_merge()
    todo = ['BBB', 'LBY', 'PPP', 'SOM', 'SRB']
    res = {a3: g.build(a3) for a3 in todo}
    log = M.harmonize(g, res, todo, curated or {})
    return g, res, log


def state_in(res, a3, y):
    return next(st for a, b, st, q in res[a3]['periods'] if a <= y <= b)


def test_units_sharing_a_pid_use_the_same_state_object_each_year():
    g, res, log = harmonized()
    for y in range(1947, 1971):  # the province year by year equals the state it belonged to
        assert state_in(res, 'BBB', y) == state_in(res, 'PPP', y), (y, state_in(res, 'BBB', y), state_in(res, 'PPP', y))
    assert state_in(res, 'BBB', 1950)['name'] == 'Dominion of P' and state_in(res, 'BBB', 1960)['name'] == 'P'
    assert any(x.startswith('BBB: ne:ppp aligned') for x in log), log


def test_shared_pid_uses_the_table_object_in_every_unit():
    g, res, log = harmonized()
    st = state_in(res, 'SRB', 1960)
    assert st == {'pid': 'ovr:yugoslavia', 'name': 'Yugoslavia', 'kind': 'state', 'wikidata': YUGO}, st


def test_different_items_with_the_same_name_get_different_pids():
    g, res, log = harmonized()
    som, lby = state_in(res, 'SOM', 1947), state_in(res, 'LBY', 1947)
    assert som['name'] == lby['name'] == 'British Military Administration'
    assert som['pid'] != lby['pid'], (som, lby)
    assert som['power'] == 'ne:gbr' and lby['power'] == 'ne:gbr'  # demonym / P17, never Cliopatria
    assert {som['pid'], lby['pid']} == {'ovr:british-military-administration', 'ovr:british-military-administration-somalia'}


def test_curated_state_objects_win():
    cur_pak = {'unit': 'PPP', 'timeline': [
        {'years': [1946, 1946], 'state': {'pid': 'ovr:british-raj', 'name': 'British Raj', 'kind': 'dependency', 'power': 'ne:gbr'}},
        {'years': [1947, 1955], 'state': {'pid': 'ne:ppp', 'name': 'Dominion of P (curated)', 'kind': 'state', 'wikidata': 'Q11'}},
        {'years': [1956, 'present'], 'state': {'pid': 'ne:ppp', 'name': 'P', 'kind': 'state', 'wikidata': 'Q10'}}]}
    g, res, log = harmonized({'PPP': ('south-asia.json', cur_pak)})
    assert state_in(res, 'BBB', 1950)['name'] == 'Dominion of P (curated)'


if __name__ == '__main__':
    sys.exit(run(globals()))
