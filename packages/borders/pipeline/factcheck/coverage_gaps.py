"""Find historical polities on Wikidata that Cliopatria does not draw.

    node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/factcheck/coverage_gaps.py [--offline]

1. Classes: gaps.roots and gaps.indigenousRoots from config (labels verified against
   Wikidata) plus classes found by exact label for classes.searchTerms; candidates are
   instances of any class in their P279* closures (SPARQL, cached).
2. Candidates need a location (P625, else the capital's P625) and dates overlapping
   -3400..1945 (P571/P580 start, P576/P582 end). Non-indigenous items need an end date
   (otherwise they are current states/units and out of scope); indigenous items without
   an end run to 1945. Items without any date are counted, not used (no invented dates).
3. At up to `samples` years inside the life, a Cliopatria polygon alive then must
   contain the point with the same QID or a similar name; else the candidate is a gap:
     gap-unclaimed  no Cliopatria polity at the point (unclaimed land or sea)
     gap-covered    inside another Cliopatria polity (often a vassal/sub-unit: lower priority)
   'elsewhere' (same QID or name drawn elsewhere) and 'covered' are reported, not gaps.
4. Rank by significance = sitelinks x log2(2 + years/10) x 1.5 (unclaimed land) x 0.6 (covered).
   Gaps with sitelinks >= minSitelinks and life >= minYears become 'note' entries with
   status 'known-gap' in overrides/{historical,early}/auto-gaps.json (one per candidate per
   window it overlaps); every cut is counted in the report.
Writes .cache/factcheck/coverage-gaps.{json,md}.
"""
from __future__ import annotations

import argparse
import math
import os
import pickle
import re
import sys
from collections import Counter, defaultdict

import shapely
from shapely import STRtree
from shapely.geometry import Point, shape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import classes as K  # noqa: E402
import fcutil as U  # noqa: E402
import wikidata as W  # noqa: E402

AUTHOR = 'auto:factcheck-gaps'
FILE = 'auto-gaps'

QUERY = """
SELECT ?item (SAMPLE(?lab) AS ?label) (SAMPLE(?desc) AS ?description) (SAMPLE(?links) AS ?sitelinks)
  (SAMPLE(?coord) AS ?coord) (SAMPLE(?capcoord) AS ?capcoord) (SAMPLE(?article) AS ?enwiki)
  (MIN(?inc) AS ?inception) (MIN(?st) AS ?start) (MAX(?dis) AS ?dissolved) (MAX(?et) AS ?end)
  (GROUP_CONCAT(DISTINCT STRAFTER(STR(?cls), "entity/"); separator=" ") AS ?classes)
WHERE {
  VALUES ?cls { %s }
  ?item wdt:P31 ?cls .
  ?item wikibase:sitelinks ?links .
  OPTIONAL { ?item wdt:P571 ?inc . FILTER(DATATYPE(?inc) = xsd:dateTime) }
  OPTIONAL { ?item wdt:P580 ?st . FILTER(DATATYPE(?st) = xsd:dateTime) }
  OPTIONAL { ?item wdt:P576 ?dis . FILTER(DATATYPE(?dis) = xsd:dateTime) }
  OPTIONAL { ?item wdt:P582 ?et . FILTER(DATATYPE(?et) = xsd:dateTime) }
  OPTIONAL { ?item wdt:P625 ?coord }
  OPTIONAL { ?item wdt:P36 ?cap . ?cap wdt:P625 ?capcoord }
  OPTIONAL { ?item rdfs:label ?lab . FILTER(LANG(?lab) = "en") }
  OPTIONAL { ?item schema:description ?desc . FILTER(LANG(?desc) = "en") }
  OPTIONAL { ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> }
} GROUP BY ?item
"""


def parse_point(wkt: str | None):
    if not wkt:
        return None
    m = re.match(r'^Point\(([-0-9.eE]+) ([-0-9.eE]+)\)$', wkt.strip())
    if not m:
        return None  # other globes (<http://...> prefix) or malformed
    lon, lat = float(m.group(1)), float(m.group(2))
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return None
    return lon, lat


def run_classes(wd: W.Client, classes: list[str], log: list) -> list[dict]:
    rows = []

    def go(batch):
        q = QUERY % ' '.join('wd:' + c for c in batch)
        try:
            rows.extend(wd.sparql(q))
        except W.WikidataError as e:
            if len(batch) > 1:
                mid = len(batch) // 2
                go(batch[:mid])
                go(batch[mid:])
            else:
                log.append(f'class {batch[0]} skipped: {str(e)[:120]}')

    for i in range(0, len(classes), 80):
        go(classes[i:i + 80])
    return rows


def sample_years(a: int, b: int, n: int) -> list[int]:
    if a == b or n <= 1:
        return [a]
    out = []
    for k in range(n):
        y = round(a + (b - a) * k / (n - 1))
        out.append(1 if y == 0 else y)
    return sorted(set(out))


def ordinal(n: int) -> str:
    suf = 'th' if 10 <= n % 100 <= 20 else {1: 'st', 2: 'nd', 3: 'rd'}.get(n % 10, 'th')
    return f'{n}{suf}'


def century(y: int) -> str:
    if y > 0:
        return f'{ordinal((y - 1) // 100 + 1)} c.'
    return f'{ordinal((-y - 1) // 100 + 1)} c. BCE'


def century_key(y: int) -> int:
    return (y - 1) // 100 if y > 0 else -((-y - 1) // 100) - 1


QUALIFIERS = {'ancient', 'old', 'new', 'middle', 'early', 'late', 'later', 'western', 'eastern', 'northern', 'southern',
              'upper', 'lower', 'first', 'second', 'third', 'fourth', 'great', 'greater', 'little', 'lesser', 'united'}
SUFFIXES = ('ians', 'ian', 'ans', 'an', 'ese', 'ids', 'id', 'ic', 'ish', 'ites', 'ite', 'um', 'us', 'a', 'e', 's')
SETTLEMENT = re.compile(r'^(an? |the )?((ancient|former|historic|historical|medieval|classical|old|abandoned|ruined) )*'
                        r'([\w-]+ ){0,2}(city|town|village|settlement|port|polis|archaeological site|fortress)\b', re.I)
AGGREGATE = re.compile(r'civili[sz]ation|set of territories|colonial empire|\bleague\b|\bculture\b|\bperiod\b', re.I)


def stem(t: str) -> str:
    for suf in SUFFIXES:
        if t.endswith(suf) and len(t) - len(suf) >= 3:
            return t[:-len(suf)]
    return t


def phase_tokens(name: str) -> set:
    """Core name tokens without period qualifiers (ancient, western, later...), lightly stemmed:
    'Ancient Egypt' ~ 'Middle Kingdom of Egypt', 'Western Zhou' ~ 'Zhou Dynasty', 'Ancient Rome' ~ 'Roman Republic'."""
    return {stem(x) for x in U.core_tokens(name) if x not in QUALIFIERS and not x.isdigit()}


def related(a: set, b: set) -> bool:
    if not a or not b:
        return False
    small, big = (a, b) if len(a) <= len(b) else (b, a)

    def eq(x, y):
        n = min(len(x), len(y))
        return x == y or (n >= 5 and x[:n - 1] == y[:n - 1])
    return max(len(x) for x in small) >= 3 and all(any(eq(x, y) for y in big) for x in small)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--offline', action='store_true')
    ap.add_argument('--verbose', action='store_true')
    args = ap.parse_args(argv)
    t = U.Timer()
    cfg_all = U.load_config()
    cfg = cfg_all['gaps']
    wd = W.Client(offline=args.offline or None, verbose=args.verbose)

    # ---------------------------------------------------------------- classes
    roots = K.verified(wd, cfg['roots'])
    indigenous = K.verified(wd, cfg['indigenousRoots'])
    political = K.verified(wd, cfg_all['classes']['political'])
    peoples = {q: l for q, l in K.verified(wd, cfg_all['classes']['nonPolitical']).items()
               if l in ('ethnic group', 'tribe')}
    st = cfg_all['classes']['searchTerms']
    extra, search_log = K.by_search(wd, st['terms'], st['descriptionKeywords'],
                                    list(roots) + list(indigenous) + list(political) + list(peoples))
    extra_reach = wd.class_roots(list(extra), list(indigenous) + list(peoples))
    indigenous_all = set(indigenous) | {q for q, r in extra_reach.items() if r}
    all_roots = {**roots, **indigenous, **extra}
    closure, closure_of = set(), {}
    for r in all_roots:
        cl = wd.subclass_closure(r)
        closure_of[r] = cl
        closure |= cl
    indigenous_classes = set().union(*(closure_of[r] for r in indigenous_all)) if indigenous_all else set()
    print(f'[gaps] {len(all_roots)} root classes, {len(closure)} classes in closure ({t})', file=sys.stderr)

    log: list[str] = []
    rows = run_classes(wd, sorted(closure, key=lambda q: int(q[1:])), log)
    print(f'[gaps] {len(rows)} rows from SPARQL ({t})', file=sys.stderr)

    # ---------------------------------------------------------------- candidates
    cut = Counter()
    cands = {}
    for r in rows:
        q = r['item']
        if not q.startswith('Q'):
            continue
        c = cands.get(q)
        if c:  # same item from another class batch: merge classes
            c['classes'] |= set((r.get('classes') or '').split())
            continue
        cands[q] = {'qid': q, 'label': r.get('label') or q, 'description': r.get('description') or '',
                    'sitelinks': int(r.get('sitelinks') or 0), 'enwiki': r.get('enwiki'),
                    'classes': set((r.get('classes') or '').split()),
                    'coordItem': parse_point(r.get('coord')), 'coordCapital': parse_point(r.get('capcoord')),
                    'starts': [y for y in (W.sparql_year(r.get('inception')), W.sparql_year(r.get('start'))) if y],
                    'ends': [y for y in (W.sparql_year(r.get('dissolved')), W.sparql_year(r.get('end'))) if y]}
    usable, no_loc = [], []
    last = cfg['lastYear']
    for c in cands.values():
        c['indigenous'] = bool(c['classes'] & indigenous_classes)
        pt = c['coordItem'] or c['coordCapital']
        if not pt:
            cut['no location'] += 1
            no_loc.append(c)
            continue
        c['point'], c['pointFrom'] = pt, 'item' if c['coordItem'] else 'capital'
        s = min(c['starts']) if c['starts'] else None
        e = max(c['ends']) if c['ends'] else None
        if s is None and e is None:
            cut['no dates'] += 1
            continue
        if e is None and not c['indigenous']:
            cut['no end date (current or undated end)'] += 1
            continue
        if s is not None and e is not None and e < s:
            cut['end before start'] += 1
            continue
        a = s if s is not None else e
        b = e if e is not None else last
        if a > last or b < U.FIRST_YEAR:
            cut['outside -3400..1945'] += 1
            continue
        c['life'] = (a, b)
        c['span'] = (max(a, U.FIRST_YEAR), min(b, last))
        usable.append(c)
    print(f'[gaps] {len(cands)} distinct items, {len(usable)} usable ({dict(cut)}) ({t})', file=sys.stderr)

    # ---------------------------------------------------------------- Cliopatria
    inv = U.load_inventory()
    with open(os.path.join(U.REFERENCE, 'cliopatria-geoms.pkl'), 'rb') as f:
        wkb = pickle.load(f)
    recs, geoms = [], []
    for r in inv:
        g = wkb.get(r['rid'])
        if g is None:
            continue
        recs.append(r)
        geoms.append(shapely.from_wkb(g) if isinstance(g, (bytes, bytearray)) else g)
    tree = STRtree(geoms)
    by_qid, by_tok = defaultdict(list), defaultdict(list)
    for r in recs:
        if r.get('wikidata'):
            by_qid[r['wikidata']].append(r)
        r['_ph'] = phase_tokens(r['name'])
        for tok in r['_ph']:
            by_tok[tok[:4]].append(r)
    admin0 = {a['code']: a for a in U.load_admin0()}
    ne = U.read_json(os.path.join(U.C.NE_DIR, 'ne_10m_admin_0_countries.geojson'))['features']
    ne_geoms = [shape(f['geometry']) for f in ne]
    ne_codes = [f['properties']['ADM0_A3'] for f in ne]
    ne_tree = STRtree(ne_geoms)
    print(f'[gaps] Cliopatria {len(recs)} geometries indexed ({t})', file=sys.stderr)

    gaps = []
    status_count = Counter()
    for c in usable:
        pt = Point(*c['point'])
        # ~10 km probe: coastal and island points often fall just outside coarse Cliopatria outlines
        hit = [recs[i] for i in tree.query(pt, predicate='dwithin', distance=cfg.get('probeDeg', 0.1))]
        ys = sample_years(c['span'][0], c['span'][1], cfg['samples'])
        matched, cover, phase_hits, rel_rec = False, {}, 0, None
        ph = phase_tokens(c['label'])
        for y in ys:
            alive = [r for r in hit if r['from'] <= y <= r['to']]
            for r in alive:
                if r.get('wikidata') == c['qid'] or U.similarity(c['label'], r['name']) >= cfg['nameMatch']:
                    matched = True
            rel = [r for r in alive if related(ph, r['_ph'])]
            if rel:
                phase_hits += 1
                rel_rec = rel_rec or rel[0]
            cover[y] = min(alive, key=lambda r: r.get('areaKm2') or 0) if alive else None
        land_idx = ne_tree.query(pt, predicate='intersects')
        if len(land_idx):
            code = ne_codes[land_idx[0]]
            on_land = True
        else:
            near = ne_tree.query_nearest(pt, max_distance=1.0)
            code = ne_codes[near[0]] if len(near) else None
            on_land = False
        c['adm0'] = code
        c['region'] = (admin0.get(code) or {}).get('auditRegion', 'ocean') if code else 'ocean'
        c['onLand'] = on_land
        if matched:
            c['status'] = 'covered'
        elif phase_hits * 2 >= len(ys):
            c['status'] = 'covered-related'  # drawn there under a variant/phase name (Ancient Egypt ~ Middle Kingdom of Egypt)
            c['related'] = {'pid': rel_rec['pid'], 'name': rel_rec['name'], 'qid': rel_rec.get('wikidata')}
        else:
            near = [r for tok in ph for r in by_tok.get(tok[:4], []) if related(ph, r['_ph'])]
            same = [r for r in by_qid.get(c['qid'], []) + near
                    if r['from'] <= c['span'][1] and r['to'] >= c['span'][0]]
            if same:
                c['status'] = 'elsewhere'
                c['elsewhere'] = {'pid': same[0]['pid'], 'name': same[0]['name'], 'qid': same[0].get('wikidata')}
            elif all(v is None for v in cover.values()):
                c['status'] = 'gap-unclaimed'
            else:
                c['status'] = 'gap-covered'
        status_count[c['status']] += 1
        if c['status'].startswith('gap'):
            mid = ys[len(ys) // 2]
            cv = cover.get(mid) or next((v for v in cover.values() if v), None)
            c['covering'] = {'pid': cv['pid'], 'name': cv['name'], 'qid': cv.get('wikidata'), 'year': mid} if cv else None
            years = U.span_len(*c['span'])
            score = c['sitelinks'] * min(math.log2(2 + years / 10), 6.0)
            if c['status'] == 'gap-unclaimed' and on_land:
                score *= 1.5
            if c['status'] == 'gap-covered':
                score *= 0.6
            desc = c['description'] or ''
            c['flags'] = [f for f, rx, txt in (('settlement', SETTLEMENT, desc), ('aggregate', AGGREGATE, c['label'] + ' ' + desc))
                          if rx.search(txt)]
            if c['flags']:
                score *= 0.25  # cities/sites and civilisation- or empire-wide aggregates rank low
            c['score'] = round(score, 1)
            c['years'] = years
            gaps.append(c)
    gaps.sort(key=lambda c: (-c['score'], c['qid']))
    for i, c in enumerate(gaps, 1):
        c['rank'] = i
    print(f'[gaps] status {dict(status_count)} ({t})', file=sys.stderr)

    # ---------------------------------------------------------------- entries
    files = {'historical': [], 'early': []}
    kept, cut_entries = [], Counter()
    for c in gaps:
        if c['score'] < cfg['minScore']:
            cut_entries[f"score < {cfg['minScore']}"] += 1
            continue
        if c['years'] < cfg['minYears']:
            cut_entries[f"life < {cfg['minYears']} years"] += 1
            continue
        if not c['onLand'] and c['status'] == 'gap-unclaimed':
            cut_entries['point at sea (no land within the admin-0 layer)'] += 1
            continue
        kept.append(c)
        a, b = c['life']
        lon, lat = c['point']
        cov = c.get('covering')
        where = (f"inside Cliopatria's {cov['name']} ({cov['pid']}) in {U.fmt_year(cov['year'])} — possibly a vassal or "
                 f"sub-unit drawn as part of it" if cov else 'on land Cliopatria leaves unclaimed' if c['onLand'] else 'off the coast')
        reason = (f"KNOWN GAP (auto): {c['label']} — {c['description'] or 'no description'}. Wikidata dates "
                  f"{U.fmt_year(a) if c['starts'] else '?'}–{U.fmt_year(b) if c['ends'] else 'open'}; location {lat:.3f}, {lon:.3f} "
                  f"({'item' if c['pointFrom'] == 'item' else 'capital'} coordinates, region {c['region']}); "
                  f"{c['sitelinks']} sitelinks; rank {c['rank']} of {len(gaps)} (score {c['score']}). "
                  f"No Cliopatria polygon with this id or name contains the point; the point is {where}. "
                  f"To fix: verify extent and dates in the sources, then add the polity (tier 0, or tier 1 if it was a "
                  f"vassal inside the covering polity).")
        src = [{'title': f"Wikidata {c['qid']}: {c['label']}", 'url': W.entity_url(c['qid'])}]
        if c.get('enwiki'):
            src.append({'title': f"Wikipedia: {c['enwiki'].rsplit('/', 1)[-1].replace('_', ' ')}", 'url': c['enwiki']})
        for window in ('early', 'historical'):
            yrs = U.clip(c['span'], window)
            if not yrs:
                continue
            prefix = 'e' if window == 'early' else 'h'
            files[window].append({
                'id': f"{prefix}-auto-gaps-{c['qid'].lower()}", 'op': 'note', 'years': list(yrs), 'reason': reason,
                'sources': src, 'confidence': 'medium' if c['status'] == 'gap-unclaimed' and not c['flags'] and c['sitelinks'] >= 30 else 'low',
                'status': 'known-gap', 'author': AUTHOR, 'date': U.TODAY})
    scope = ('Generated by pipeline/factcheck/coverage_gaps.py — historical polities on Wikidata (with location and dates) that '
             'no Cliopatria polygon alive at sample years contains with a matching id or name. Notes only (status known-gap, '
             f"never applied), ranked by significance; cut-off: score >= {cfg['minScore']}, life >= {cfg['minYears']} years. "
             'Regenerate instead of editing; move resolved items into curated files.')
    for window in ('historical', 'early'):
        es = sorted(files[window], key=lambda e: e['id'])
        U.unique_ids(es)
        U.write_json(U.override_path(window, FILE), U.override_file(window, FILE, scope, es))

    # ---------------------------------------------------------------- reports
    def slim(c):
        return {k: (sorted(v) if isinstance(v, set) else v) for k, v in c.items() if k not in ('starts', 'ends', '_ph')}

    summary = {'rows': len(rows), 'items': len(cands), 'usable': len(usable), 'excluded': dict(cut),
               'status': dict(status_count), 'gaps': len(gaps), 'entries': len(kept),
               'cutFromEntries': dict(cut_entries), 'historicalEntries': len(files['historical']),
               'earlyEntries': len(files['early']),
               'byRegion': dict(Counter(c['region'] for c in kept).most_common()),
               'classesSkipped': log, 'seconds': t.seconds, 'wikidata': wd.stats}
    U.write_json(os.path.join(U.OUT_DIR, 'coverage-gaps.json'),
                 {'generated': U.TODAY, 'summary': summary, 'roots': all_roots, 'searchClasses': search_log,
                  'gaps': [slim(c) for c in gaps]}, indent=None)
    md = [f'# Coverage gaps: Wikidata polities missing from Cliopatria ({U.TODAY})', '',
          f"{len(cands)} candidate items from {len(closure)} classes; {len(usable)} with location and dates in range "
          f"(excluded: {dict(cut)}).", f"Status: {dict(status_count)}.",
          f"{len(gaps)} gaps ranked; {len(kept)} above the cut-off became known-gap notes "
          f"({len(files['historical'])} historical, {len(files['early'])} early entries); cut: {dict(cut_entries)}.", '',
          '## Classes used', '', K.table_md(all_roots, search_log), '',
          '## Most-linked candidates skipped for lack of coordinates (no P625 on the item or its capital)', '',
          U.md_table([[f"[{c['label']}](https://www.wikidata.org/wiki/{c['qid']})", c['sitelinks'], (c['description'] or '')[:80]]
                      for c in sorted(no_loc, key=lambda c: -c['sitelinks'])[:40]], ['item', 'links', 'description']), '']
    by_region = defaultdict(list)
    for c in kept:
        by_region[c['region']].append(c)
    for region in sorted(by_region, key=lambda r: -len(by_region[r])):
        md += [f'## {region} ({len(by_region[region])})', '']
        by_c = defaultdict(list)
        for c in by_region[region]:
            by_c[century_key(c['life'][0])].append(c)
        for ck in sorted(by_c):
            cs = sorted(by_c[ck], key=lambda c: c['rank'])
            md += [f'### {century(cs[0]["life"][0])}', '',
                   U.md_table([[c['rank'], f"[{c['label']}](https://www.wikidata.org/wiki/{c['qid']})",
                                f"{U.fmt_year(c['life'][0])}–{U.fmt_year(c['life'][1])}", c['sitelinks'],
                                c['status'].replace('gap-', ''), (c.get('covering') or {}).get('name', ''),
                                (c['description'] or '')[:70]] for c in cs],
                              ['rank', 'polity', 'years', 'links', 'point', 'Cliopatria there', 'description']), '']
    U.write_text(os.path.join(U.OUT_DIR, 'coverage-gaps.md'), '\n'.join(md))
    print(f"[gaps] items {len(cands)} usable {len(usable)} | status {dict(status_count)} | entries {len(kept)} "
          f"(h {len(files['historical'])}, e {len(files['early'])}) cut {dict(cut_entries)} | {t} | requests {wd.stats['requests']}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
