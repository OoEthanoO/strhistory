"""Check every Wikidata id used by Cliopatria against Wikidata.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/check_cliopatria.py [--offline] [--no-search]

Per unique QID (from .cache/reference/cliopatria-inventory.json):
  (a) type     is the item a political entity (P31 reaches a class in config classes.political)?
               dynasties, peoples, wars, persons, cultures and unknown types are flagged
  (b) name     best normalised similarity of each Cliopatria name to label/aliases/enwiki/P1448
  (c) dates    P571/P580 and P576/P582 vs the union span of the Cliopatria records using the QID;
               flagged when |delta| > max(25 y, 10 % of span) (+ slack for coarse Wikidata precision)
  (d) reuse    one QID used for several Cliopatria names (reported, not an error by itself)
Flagged type/name/missing/redirected items get a replacement search (wbsearchentities on the
Cliopatria name, filtered by type, name similarity and dates); a replacement is accepted only
when exactly one candidate passes.

Writes .cache/factcheck/cliopatria-wikidata.{json,md} and
overrides/historical/auto-wikidata.json (1700..1945) + overrides/early/auto-wikidata.json (<= 1699):
  update  set.wikidata  status active   confident corrections (redirect targets, unique replacements)
  note    status proposed               wrong/suspect ids without a confident fix, date disagreements
Reviewer decisions survive reruns: an existing entry with the same id that carries
`verifiedBy` or `review` keeps its status/verifiedBy/review/confidence.
"""
from __future__ import annotations

import argparse
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fcutil as U  # noqa: E402
import wikidata as W  # noqa: E402

AUTHOR = 'auto:factcheck-wikidata'
FILE = 'auto-wikidata'


def tolerance(span: tuple[int, int], cfg: dict) -> int:
    return max(cfg['dateToleranceYears'], round(cfg['dateToleranceShare'] * U.span_len(*span)))


def date_check(ent: dict, span: tuple[int, int], cfg: dict) -> dict:
    """Compare Wikidata start/end with a Cliopatria span. Missing sides are not flagged."""
    d = W.dates(ent)
    tol = tolerance(span, cfg)
    res = {'tolerance': tol, 'start': None, 'end': None, 'flag': False}
    for side, idx in (('start', 0), ('end', 1)):
        cands = d[side]
        if not cands:
            continue
        best = min(cands, key=lambda c: U.year_diff(c[0], span[idx]))
        delta = U.year_diff(best[0], span[idx])
        slack = W.precision_slack(best[1])
        bad = delta > tol + slack
        res[side] = {'wikidata': best[0], 'precision': best[1], 'prop': best[2], 'cliopatria': span[idx],
                     'delta': delta, 'flag': bad}
        res['flag'] |= bad
    return res


def dates_agree(ent: dict, span: tuple[int, int], cfg: dict) -> bool | None:
    """True when Wikidata has dates and none disagrees; None when it has no dates."""
    r = date_check(ent, span, cfg)
    if r['start'] is None and r['end'] is None:
        return None
    return not r['flag']


def classify(ent: dict, roots_of: dict, political: dict, nonpolitical: dict) -> tuple[str, list[str]]:
    """('political' | 'mixed' | 'non-political' | 'unknown' | 'missing', reached root labels)."""
    if not ent or ent.get('missing'):
        return 'missing', []
    reached = set()
    for c in W.values(ent, 'P31'):
        reached |= roots_of.get(c, set())
    pol = sorted(political[r] for r in reached if r in political)
    non = sorted(nonpolitical[r] for r in reached if r in nonpolitical)
    if pol and non:
        return 'mixed', pol + non
    if pol:
        return 'political', pol
    if non:
        return 'non-political', non
    return 'unknown', []


def search_name(name: str) -> str:
    n = name.strip()
    if n.startswith('(') and n.endswith(')'):
        n = n[1:-1]
    return n.replace(' (Relation)', '').strip()


def merge_reviewed(path: str, entries: list[dict]) -> int:
    """Keep reviewer decisions from the existing file (entries with verifiedBy/review)."""
    if not os.path.exists(path):
        return 0
    try:
        old = {e['id']: e for e in U.read_json(path).get('entries', [])}
    except Exception:  # noqa: BLE001
        return 0
    kept = 0
    for e in entries:
        o = old.get(e['id'])
        if o and (o.get('verifiedBy') or o.get('review')):
            for k in ('status', 'verifiedBy', 'review', 'confidence'):
                if k in o:
                    e[k] = o[k]
            kept += 1
    return kept


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true', help='use the Wikidata cache only')
    ap.add_argument('--no-search', action='store_true', help='skip replacement searches')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)
    t = U.Timer()
    cfg_all = U.load_config()
    cfg = cfg_all['cliopatria']
    political, nonpolitical = cfg_all['classes']['political'], cfg_all['classes']['nonPolitical']
    wd = W.Client(offline=args.offline or None, verbose=args.verbose)
    wd.verify_qids({**political, **nonpolitical})

    inv = U.load_inventory()
    by_qid: dict[str, dict] = {}
    for r in inv:
        q = r.get('wikidata')
        if not q:
            continue
        g = by_qid.setdefault(q, {'names': {}, 'from': r['from'], 'to': r['to']})
        g['from'], g['to'] = min(g['from'], r['from']), max(g['to'], r['to'])
        n = g['names'].setdefault(r['name'], {'pids': Counter(), 'from': r['from'], 'to': r['to'],
                                                'records': 0, 'regions': Counter(), 'type': r['type']})
        n['pids'][r['pid']] += 1
        n['from'], n['to'] = min(n['from'], r['from']), max(n['to'], r['to'])
        n['records'] += 1
        n['regions'][r.get('region') or '?'] += 1
    names_qids = defaultdict(set)
    for q, g in by_qid.items():
        for name in g['names']:
            names_qids[name].add(q)
    qids = sorted(by_qid, key=lambda q: int(q[1:]))
    print(f'[cliopatria] {len(inv)} records, {len(qids)} unique QIDs', file=sys.stderr)

    ents = wd.entities(qids, progress='cliopatria')
    # follow redirects: the slim entity of a redirected id carries the target id
    classes = {c for e in ents.values() for c in W.values(e, 'P31')}
    roots_of = wd.class_roots(classes, list(political) + list(nonpolitical))
    class_labels = {q: (e.get('label') or q) for q, e in wd.entities(sorted(classes), progress='P31 classes').items()}

    results, flagged = [], []
    for q in qids:
        g, e = by_qid[q], ents.get(q)
        span = (g['from'], g['to'])
        typ, reached = classify(e, roots_of, political, nonpolitical)
        res = {
            'qid': q, 'label': (e or {}).get('label'), 'description': (e or {}).get('description'),
            'instanceOf': [class_labels.get(c, c) for c in W.values(e, 'P31')][:8],
            'type': typ, 'typeRoots': reached, 'span': list(span),
            'redirectTo': e.get('id') if e and e.get('redirectedFrom') else None,
            'names': [], 'flags': [],
        }
        labels = W.label_set(e)
        for name, n in sorted(g['names'].items()):
            sim, which = U.best_similarity(search_name(name), labels)
            res['names'].append({'name': name, 'pids': sorted(n['pids']), 'span': [n['from'], n['to']],
                                 'records': n['records'], 'region': n['regions'].most_common(1)[0][0],
                                 'type': n['type'], 'similarity': sim, 'matched': which,
                                 'otherQids': sorted(names_qids[name] - {q})})
        if typ == 'missing':
            res['flags'].append('missing')
        if res['redirectTo']:
            res['flags'].append('redirect')
        if typ in ('non-political', 'unknown'):
            res['flags'].append('type')
        if typ != 'missing' and all(n['similarity'] < cfg['nameMinSimilarity'] for n in res['names']):
            res['flags'].append('name')
        if typ != 'missing':
            dc = date_check(e, span, cfg)
            res['dates'] = dc
            if dc['flag']:
                res['flags'].append('dates')
        if len(g['names']) > 1:
            res['flags'].append('reuse')
        results.append(res)
        if set(res['flags']) & {'missing', 'type', 'name'}:
            flagged.append(res)

    # ---------------------------------------------------------------- replacement search
    searched = 0
    if not args.no_search:
        # pass 1: searches; pass 2: one batched fetch of all plausible candidates; pass 3: one class pass
        jobs = []
        for res in flagged:
            for n in res['names']:
                text = search_name(n['name'])
                hits = wd.search(text, limit=cfg['replacementSearchLimit'])
                searched += 1
                if searched % 50 == 0:
                    print(f'[cliopatria] searches {searched} ({t})', file=sys.stderr)
                # only candidates whose label or matched alias can pass the similarity test are fetched
                cand_ids = [h['id'] for h in hits if h['id'] != res['qid'] and max(
                    U.similarity(text, h.get('label') or ''), U.similarity(text, h.get('match') or ''))
                    >= cfg['replacementMinSimilarity'] - 0.15]
                jobs.append((res, n, text, cand_ids))
        cents = wd.entities(sorted({c for j in jobs for c in j[3]}), progress='candidates')
        ccls = {c for ce in cents.values() for c in W.values(ce, 'P31')}
        missing_roots = [c for c in ccls if c not in roots_of]
        if missing_roots:
            roots_of.update(wd.class_roots(missing_roots, list(political) + list(nonpolitical)))
        for res, n, text, cand_ids in jobs:
            passing, considered = [], []
            for cid in cand_ids:
                ce = cents.get(cid)
                ctyp, _ = classify(ce, roots_of, political, nonpolitical)
                sim, which = U.best_similarity(text, W.label_set(ce))
                agree = dates_agree(ce, tuple(n['span']), cfg) if ce and not ce.get('missing') else None
                ok = ctyp in ('political', 'mixed') and sim >= cfg['replacementMinSimilarity'] and agree is True
                considered.append({'qid': cid, 'label': (ce or {}).get('label'), 'type': ctyp,
                                   'similarity': sim, 'datesAgree': agree, 'pass': ok})
                if ok:
                    passing.append(cid)
            n['candidates'] = considered
            n['replacement'] = passing[0] if len(passing) == 1 else None
            n['ambiguous'] = len(passing) > 1
    # ---------------------------------------------------------------- override entries
    files = {'historical': [], 'early': []}

    def add_entries(kind: str, res: dict, n: dict, op: str, status: str, confidence: str, reason: str,
                    sources: list[dict], new_qid: str | None = None):
        for pid in n['pids']:
            for window in ('early', 'historical'):
                yrs = U.clip(tuple(n['span']), window)
                if not yrs:
                    continue
                prefix = 'e' if window == 'early' else 'h'
                e = {'id': f"{prefix}-auto-wikidata-{kind}-{res['qid'].lower()}-{U.id_part(pid.split(':', 1)[1], 40)}",
                     'op': op, 'years': list(yrs), 'target': {'pid': pid}}
                if op == 'update':
                    e['set'] = {'wikidata': new_qid}
                e.update({'reason': reason, 'sources': sources, 'confidence': confidence, 'status': status,
                          'author': AUTHOR, 'date': U.TODAY})
                files[window].append(e)

    def src(q, ent=None):
        lab = (ent or ents.get(q) or {}).get('label') or q
        return {'title': f'Wikidata {q}: {lab}', 'url': W.entity_url(q)}

    fixed = noted_wrong = noted_dates = 0
    for res in results:
        q = res['qid']
        cur = f"Cliopatria links {{name}} ({{pid}}, {U.fmt_year(res['span'][0])}–{U.fmt_year(res['span'][1])}) to {q} " \
              f"\"{res['label']}\" ({res['description'] or 'no description'}; instance of: {', '.join(res['instanceOf']) or 'nothing'})."
        wrong = set(res['flags']) & {'missing', 'type', 'name'}
        redirect = res['redirectTo']
        for n in res['names']:
            base = cur.format(name=f"\"{n['name']}\"", pid=', '.join(n['pids']))
            new = n.get('replacement') if wrong else None
            if new:
                ne_ = wd.entity(new)
                why = {'missing': 'the item no longer exists on Wikidata', 'type': 'the item is not a political entity',
                       'name': 'its labels do not match the Cliopatria name'}
                probs = '; '.join(why[f] for f in ('missing', 'type', 'name') if f in res['flags'])
                c = next(c for c in n['candidates'] if c['qid'] == new)
                dd = W.dates(ne_)
                dtxt = ', '.join(f"{p} {U.fmt_year(y)}" for side in ('start', 'end') for (y, _, p) in dd[side][:2])
                why = (f"Check failed: {probs}. Unique replacement from a Wikidata name search: {new} \"{ne_.get('label')}\" "
                       f"({ne_.get('description') or 'no description'}; {dtxt or 'no dates'}), a political entity, "
                       f"label similarity {c['similarity']}, dates within tolerance of the Cliopatria span.")
                conf = 'high' if c['similarity'] >= 0.99 else 'medium'
                add_entries('fix', res, n, 'update', 'active', conf, f'{base} {why} Metadata only (geometry unchanged).',
                            [src(q), src(new, ne_)], new)
                fixed += 1
            elif redirect:
                add_entries('fix', res, n, 'update', 'active', 'high',
                            f'{base} {q} is a redirect to {redirect} (items merged on Wikidata); use the target id. '
                            f'Metadata only (geometry unchanged).', [src(q), src(redirect)], redirect)
                fixed += 1
            if wrong and not new:
                cands = [c for c in n.get('candidates', []) if c['type'] in ('political', 'mixed') and c['similarity'] >= 0.6]
                ctxt = ('Search candidates: ' + '; '.join(f"{c['qid']} \"{c['label']}\" (similarity {c['similarity']}, dates "
                                                          f"{'agree' if c['datesAgree'] else 'disagree' if c['datesAgree'] is False else 'missing'})"
                                                          for c in cands[:5])) if cands else 'No political search candidate matched the name.'
                why = {'missing': 'the item no longer exists on Wikidata', 'type': 'the item is not a political entity',
                       'name': 'its labels do not match the Cliopatria name'}
                probs = '; '.join(why[f] for f in ('missing', 'type', 'name') if f in res['flags'])
                amb = ' Several candidates passed, so none was applied.' if n.get('ambiguous') else ''
                add_entries('check', res, n, 'note', 'proposed', 'low',
                            f'{base} Check failed: {probs}.{amb} {ctxt} A reviewer should confirm or replace the id '
                            f'(the schema cannot remove an id; a confirmed replacement becomes an update of set.wikidata).',
                            [src(q)] + [src(c['qid']) for c in cands[:3]])
                noted_wrong += 1
            if 'dates' in res['flags'] and 'missing' not in res['flags']:
                dc = res['dates']
                parts = []
                for side in ('start', 'end'):
                    s = dc[side]
                    if s and s['flag']:
                        parts.append(f"{side} {U.fmt_year(s['wikidata'])} ({s['prop']}) vs Cliopatria {U.fmt_year(s['cliopatria'])} (|Δ| {s['delta']} y)")
                add_entries('dates', res, n, 'note', 'proposed', 'low',
                            f"{base} Dates disagree beyond the tolerance of {dc['tolerance']} y: {'; '.join(parts)}. "
                            f"Cliopatria years are never changed automatically; a reviewer should check which is right "
                            f"(Cliopatria may model only part of the polity's life, or the id may point to a different phase).",
                            [src(q)])
                noted_dates += 1

    summary = {
        'records': len(inv), 'qids': len(qids),
        'flags': dict(Counter(f for r in results for f in r['flags'])),
        'types': dict(Counter(r['type'] for r in results)),
        'flaggedWrong': len(flagged), 'searched': searched, 'fixed': fixed,
        'notesWrong': noted_wrong, 'notesDates': noted_dates,
        'namesWithSeveralQids': sum(1 for v in names_qids.values() if len(v) > 1),
        'seconds': t.seconds, 'wikidata': wd.stats,
    }
    out = {'generated': U.TODAY, 'summary': summary, 'results': results}
    U.write_json(os.path.join(U.OUT_DIR, 'cliopatria-wikidata.json'), out)

    scope = ('Generated by pipeline/factcheck/check_cliopatria.py — every Wikidata id used by Cliopatria checked for type '
             '(political entity), name, dates and reuse. Active entries change metadata only (set.wikidata); notes need review. '
             'Do not edit by hand except to review (set verifiedBy/review/status; reruns keep reviewed entries).')
    for window, kind in (('historical', 'historical'), ('early', 'early')):
        ents_w = sorted(files[window], key=lambda e: e['id'])
        U.unique_ids(ents_w)
        path = U.override_path(kind, FILE)
        kept = merge_reviewed(path, ents_w)
        U.write_json(path, U.override_file(kind, FILE, scope, ents_w))
        summary[f'{window}Entries'] = len(ents_w)
        summary[f'{window}Reviewed'] = kept

    # ---------------------------------------------------------------- markdown
    md = [f'# Cliopatria ↔ Wikidata check ({U.TODAY})', '',
          f"{len(qids)} unique QIDs on {len(inv)} records. Types: {summary['types']}. Flags: {summary['flags']}.",
          f"Replacement searches: {searched}; confident fixes (active updates): {fixed}; "
          f"notes for suspect ids: {noted_wrong}; date-disagreement notes: {noted_dates}.", '',
          '## Suspect ids (type / name / missing / redirect)', '']
    rows = []
    for r in results:
        if set(r['flags']) & {'missing', 'type', 'name', 'redirect'}:
            for n in r['names']:
                rows.append([r['qid'], r['label'], ', '.join(r['instanceOf'][:3]), n['name'], n['similarity'],
                             '/'.join(f for f in r['flags'] if f != 'reuse'), n.get('replacement') or ('ambiguous' if n.get('ambiguous') else '')])
    md += [U.md_table(rows, ['QID', 'Wikidata label', 'instance of', 'Cliopatria name', 'sim', 'flags', 'replacement']), '',
           '## Date disagreements', '']
    rows = []
    for r in results:
        if 'dates' in r['flags'] and r.get('dates'):
            dc = r['dates']
            rows.append([r['qid'], r['label'], '; '.join(n['name'] for n in r['names'])[:60],
                         f"{U.fmt_year(r['span'][0])}–{U.fmt_year(r['span'][1])}",
                         ' / '.join(f"{side} {U.fmt_year(dc[side]['wikidata'])} Δ{dc[side]['delta']}" for side in ('start', 'end')
                                    if dc.get(side) and dc[side]['flag']), dc['tolerance']])
    rows.sort(key=lambda x: x[0])
    md += [U.md_table(rows, ['QID', 'label', 'Cliopatria names', 'Cliopatria span', 'Wikidata (flagged sides)', 'tol']), '',
           '## QIDs used for several Cliopatria names', '']
    rows = [[r['qid'], r['label'], ' | '.join(n['name'] for n in r['names'])] for r in results if 'reuse' in r['flags']]
    md += [U.md_table(rows, ['QID', 'label', 'names']), '']
    U.write_text(os.path.join(U.OUT_DIR, 'cliopatria-wikidata.md'), '\n'.join(md))
    U.write_json(os.path.join(U.OUT_DIR, 'cliopatria-wikidata.json'), out)

    print(f"[cliopatria] qids {len(qids)} | types {summary['types']} | flags {summary['flags']} | fixed {fixed} "
          f"| notes wrong {noted_wrong} dates {noted_dates} | entries h {summary['historicalEntries']} e {summary['earlyEntries']} "
          f"| {t} | requests {wd.stats['requests']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
