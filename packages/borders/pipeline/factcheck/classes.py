"""Class resolution for the fact-check tools: never trust a QID from memory.

`verified(wd, table)` checks {qid: expected label} against Wikidata and stops on a
mismatch. `by_search(wd, terms, keywords, roots)` finds extra classes by exact English
label (wbsearchentities), keeps those whose description contains a keyword, that are
classes (have P279) and that reach one of `roots` via P279*. Both return
{qid: label}; `table_md` renders what was used, for the reports.
"""
from __future__ import annotations

import wikidata as W


def verified(wd: W.Client, table: dict) -> dict:
    table = {k: v for k, v in table.items() if not k.startswith('$')}
    return wd.verify_qids(table)


def by_search(wd: W.Client, terms: list[str], keywords: list[str], roots: list[str]) -> tuple[dict, list[dict]]:
    found, log = {}, []
    for term in terms:
        hits = wd.search(term, limit=10)
        exact = [h for h in hits if (h.get('label') or '').lower() == term.lower()]
        ok = [h for h in exact if any(k in (h.get('description') or '').lower() for k in keywords)]
        if not ok:
            log.append({'term': term, 'result': 'no exact label with a matching description',
                        'seen': [f"{h['id']} {h.get('label')} — {h.get('description')}" for h in exact[:3]]})
            continue
        ents = wd.entities([h['id'] for h in ok])
        cls = [h for h in ok if W.values(ents.get(h['id']), 'P279')]
        if not cls:
            log.append({'term': term, 'result': 'match is not a class (no P279)', 'seen': [h['id'] for h in ok]})
            continue
        reach = wd.class_roots([h['id'] for h in cls], roots)
        good = [h for h in cls if reach.get(h['id'])]
        if not good:
            log.append({'term': term, 'result': 'class does not reach a root class',
                        'seen': [f"{h['id']} {h.get('description')}" for h in cls]})
            continue
        for h in good[:1]:
            found[h['id']] = h['label']
            log.append({'term': term, 'result': 'used', 'qid': h['id'], 'description': h.get('description')})
    return found, log


def table_md(classes: dict, log: list[dict] | None = None) -> str:
    lines = ['| QID | label | how |', '| --- | --- | --- |']
    for q, lab in classes.items():
        lines.append(f'| [{q}](https://www.wikidata.org/wiki/{q}) | {lab} | verified label |')
    for e in log or []:
        if e['result'] == 'used':
            lines.append(f"| [{e['qid']}](https://www.wikidata.org/wiki/{e['qid']}) | {e['term']} | search: {e.get('description')} |")
        else:
            lines.append(f"| – | {e['term']} | not used: {e['result']} |")
    return '\n'.join(lines)
