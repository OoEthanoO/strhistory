"""Generated override structures validate against overrides/schema.json (mini validator; the
real files are also checked when present — run validate-overrides.mjs for the full rules)."""
from __future__ import annotations

import os
import sys

from _harness import run

import fcutil as U
import minischema as S
import modern_autogen as M
import test_timeline as TT

SCHEMA = U.read_json(os.path.join(U.OVERRIDES, 'schema.json'))


def test_validator_rejects_bad_files():
    bad = U.override_file('historical', 'auto-wikidata', 'x', [{'id': 'Bad Id', 'op': 'note', 'years': [1700, 0],
                                                               'reason': 'short', 'confidence': 'low', 'status': 'proposed',
                                                               'author': 'a', 'date': '2026-1-1'}])
    errs = S.validate(bad, SCHEMA)
    assert errs, 'mini validator accepted an invalid file'


def test_historical_entries_validate():
    entries = [
        {'id': 'h-auto-wikidata-fix-q1-x', 'op': 'update', 'years': [1700, 1945], 'target': {'pid': 'clio:x'},
         'set': {'wikidata': 'Q2'}, 'reason': 'Cliopatria links X to Q1, which is a dynasty; unique replacement Q2.',
         'sources': [{'title': 'Wikidata Q1: X', 'url': 'https://www.wikidata.org/wiki/Q1'}],
         'confidence': 'high', 'status': 'active', 'author': 'auto:factcheck-wikidata', 'date': U.TODAY},
        {'id': 'h-auto-gaps-q5', 'op': 'note', 'years': [1750, 1800],
         'reason': 'KNOWN GAP (auto): Example — no Cliopatria polygon contains the point.',
         'sources': [{'title': 'Wikidata Q5: Example', 'url': 'https://www.wikidata.org/wiki/Q5'}],
         'confidence': 'low', 'status': 'known-gap', 'author': 'auto:factcheck-gaps', 'date': U.TODAY}]
    errs = S.validate(U.override_file('historical', 'auto-wikidata', 'scope', entries), SCHEMA)
    assert not errs, errs
    early = U.override_file('early', 'auto-gaps', 'scope', [{**entries[1], 'id': 'e-auto-gaps-q5', 'years': [-500, -400]}])
    assert not S.validate(early, SCHEMA)


def test_modern_units_validate():
    g = TT.setup()
    units = [M.unit_entry(g, g.build(a3)) for a3 in ('AAA', 'CCC', 'DDD', 'EEE')]
    note = {'id': 'm-auto-wikidata-ddd', 'op': 'note', 'years': [1946, 'present'],
            'reason': 'AUTO-GENERATED timeline has low confidence: several predecessors.', 'sources': units[2]['sources'],
            'confidence': 'low', 'status': 'proposed', 'author': 'auto:modern-autogen', 'date': U.TODAY}
    f = U.override_file('modern', 'auto-wikidata', 'scope', [note], units=units)
    errs = S.validate(f, SCHEMA)
    assert not errs, errs[:5]


def test_generated_files_validate_if_present():
    n = 0
    for kind in ('historical', 'early', 'modern'):
        d = os.path.join(U.OVERRIDES, kind)
        for name in sorted(os.listdir(d)) if os.path.isdir(d) else []:
            if name.startswith('auto-') and name.endswith('.json'):
                errs = S.validate(U.read_json(os.path.join(d, name)), SCHEMA)
                assert not errs, f'{kind}/{name}: {errs[:5]}'
                n += 1
    print(f'  ({n} generated files checked)')


if __name__ == '__main__':
    sys.exit(run(globals()))
