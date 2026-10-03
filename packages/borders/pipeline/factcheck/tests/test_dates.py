"""Year conventions, date-tolerance logic and name similarity (synthetic entities)."""
from __future__ import annotations

import sys

from _harness import run

import check_cliopatria as CC
import fcutil as U
import wikidata as W

CFG = {'dateToleranceYears': 25, 'dateToleranceShare': 0.1}


def ent(**claims):
    return {'id': 'Q1', 'label': 'X', 'claims': {p: [{'v': v, 'r': 'n'} for v in vs] for p, vs in claims.items()}}


def t(y, prec=9):
    return [('+' if y > 0 else '-') + f'{abs(y):04d}-00-00T00:00:00Z', prec]


def test_year_conventions():
    assert W.json_year(['-0100-07-12T00:00:00Z', 11]) == (-100, 11)  # JSON: historical numbering
    assert W.json_year(['+1960-08-01T00:00:00Z', 11]) == (1960, 11)
    assert W.sparql_year('-0099-07-01T00:00:00Z') == -100            # RDF: astronomical numbering
    assert W.sparql_year('0000-01-01T00:00:00Z') == -1
    assert W.sparql_year('1960-08-01T00:00:00Z') == 1960
    assert U.year_diff(-1, 1) == 1 and U.year_diff(1900, 1950) == 50
    assert U.span_len(-10, 10) == 20 and U.span_len(1700, 1700) == 1
    assert U.clip((1650, 1750), 'early') == (1650, 1699) and U.clip((1650, 1750), 'historical') == (1700, 1750)
    assert U.clip((1950, 1960), 'historical') is None


def test_tolerance_rule():
    assert CC.tolerance((1310, 1490), CFG) == 25           # 10 % of 181 years < 25
    assert CC.tolerance((1000, 1600), CFG) == 60           # 10 % of 601 years


def test_date_check_flags():
    e = ent(P571=[t(1300)], P576=[t(1500)])
    assert not CC.date_check(e, (1310, 1490), CFG)['flag']
    r = CC.date_check(e, (1350, 1500), CFG)
    assert r['flag'] and r['start']['delta'] == 50 and not r['end']['flag']
    # several values: the closest one counts
    e2 = ent(P571=[t(900), t(1352)], P582=[t(1500)])
    assert not CC.date_check(e2, (1350, 1500), CFG)['flag']
    # century precision adds 100 years of slack
    e3 = ent(P571=[t(1400, 7)])
    assert not CC.date_check(e3, (1310, 1490), CFG)['flag']
    # BCE across year 0
    e4 = ent(P571=[t(-20)], P576=[t(30)])
    assert not CC.date_check(e4, (-10, 40), CFG)['flag']
    assert CC.dates_agree(ent(), (1, 2), CFG) is None


def test_similarity():
    assert U.similarity('Ottoman Empire', 'Ottoman Empire') == 1.0
    assert U.similarity('Kingdom of France', 'France') >= 0.85
    assert U.similarity('Byzantine Empire', 'Eastern Roman Empire') < 0.85
    assert U.similarity('Mughal Empire', 'Ming dynasty') < 0.5
    assert U.best_similarity('Ayutthaya', ['Ayutthaya Kingdom', 'Siam'])[0] >= 0.85


if __name__ == '__main__':
    sys.exit(run(globals()))
