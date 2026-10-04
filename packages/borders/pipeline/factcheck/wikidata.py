"""Cached, polite Wikidata client for the fact-check tools (stdlib only).

    from wikidata import Client
    wd = Client()                       # cache in .cache/wikidata/, <= 5 requests/s
    ents = wd.entities(['Q15180'])      # slim entities (labels, aliases, descriptions, enwiki, claims)
    wd.search('Mali Federation')        # wbsearchentities
    wd.sparql('SELECT ...')             # WDQS bindings as plain dicts

Every request is cached on disk keyed by the request (api/ and sparql/ hold the raw
answers, entity/ the slimmed entities), so reruns cost nothing. `offline=True` (or the
env var FACTCHECK_OFFLINE=1) never touches the network and raises on a cache miss.

Date conventions (verified against the live API, see AGENTS notes): the JSON API uses
historical numbering (1 BCE = -0001, -0100 = 100 BC) while WDQS/RDF uses astronomical
numbering (-0099 = 100 BC). `json_year` and `sparql_year` both return HistYear (no 0).
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
CACHE_DIR = os.path.join(ROOT, '.cache', 'wikidata')
API = 'https://www.wikidata.org/w/api.php'
SPARQL_URL = 'https://query.wikidata.org/sparql'
USER_AGENT = 'Alex’s Atlas-factcheck/0.1 (non-commercial historical map; local research)'
ENTITY_URL = 'https://www.wikidata.org/wiki/{}'

# Claims kept in the slim entity cache (bump SLIM_VERSION when this list changes).
KEEP_PROPS = (
    'P17', 'P30', 'P31', 'P36', 'P122', 'P131', 'P150', 'P155', 'P156', 'P279', 'P361', 'P527',
    'P571', 'P576', 'P580', 'P582', 'P585', 'P625', 'P1001', 'P1365', 'P1366', 'P1448', 'P1813',
)
KEEP_QUALIFIERS = ('P580', 'P582', 'P585', 'P642', 'P1319', 'P1326', 'P1480')
SLIM_VERSION = 1
BATCH = 20  # big country items: 50 per request can exceed the 8 MB API result limit and local memory

# Uncertainty (years) added to date tolerances by Wikidata time precision.
PRECISION_SLACK = {11: 0, 10: 0, 9: 0, 8: 10, 7: 100, 6: 1000, 5: 10000}


class WikidataError(RuntimeError):
    pass


class CacheMiss(WikidataError):
    pass


class SparqlTimeout(WikidataError):
    pass


def entity_url(qid: str) -> str:
    return ENTITY_URL.format(qid)


def _key(obj) -> str:
    return hashlib.sha1(json.dumps(obj, sort_keys=True, ensure_ascii=False).encode('utf-8')).hexdigest()


class Client:
    def __init__(self, cache_dir: str = CACHE_DIR, rate: float = 5.0, offline: bool | None = None,
                 verbose: bool = False, retries: int = 6, timeout: float = 90.0):
        self.cache_dir = cache_dir
        self.min_interval = 1.0 / max(0.1, min(rate, 5.0))  # never more than 5 requests/s
        self.offline = bool(int(os.environ.get('FACTCHECK_OFFLINE', '0'))) if offline is None else offline
        self.verbose = verbose
        self.retries = retries
        self.timeout = timeout
        self._last = 0.0
        self._last_search = 0.0
        self.stats ={'requests': 0, 'cacheHits': 0, 'retries': 0, 'entityHits': 0, 'entityFetched': 0}
        for sub in ('api', 'sparql', 'entity'):
            os.makedirs(os.path.join(cache_dir, sub), exist_ok=True)

    # ------------------------------------------------------------------ transport
    def _throttle(self):
        wait = self._last + self.min_interval - time.monotonic()
        if wait > 0:
            time.sleep(wait)
        self._last = time.monotonic()

    def _http(self, url: str, data: bytes | None = None, headers: dict | None = None) -> bytes:
        if self.offline:
            raise CacheMiss(f'offline and not cached: {url[:200]}')
        h = {'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip'}
        h.update(headers or {})
        delay = 2.0
        last_err = None
        for attempt in range(self.retries + 1):
            self._throttle()
            self.stats['requests'] += 1
            try:
                req = urllib.request.Request(url, data=data, headers=h)
                with urllib.request.urlopen(req, timeout=self.timeout) as f:
                    body = f.read()
                    if f.headers.get('Content-Encoding') == 'gzip':
                        body = gzip.decompress(body)
                    return body
            except urllib.error.HTTPError as e:
                last_err = e
                detail = ''
                try:
                    detail = e.read()[:3000].decode('utf-8', 'replace')
                except Exception:  # noqa: BLE001
                    pass
                if 'TimeoutException' in detail:  # WDQS query timeout: deterministic, do not retry
                    raise SparqlTimeout(f'SPARQL timeout for {url[:120]}') from e
                if e.code not in (429, 500, 502, 503, 504):
                    raise WikidataError(f'HTTP {e.code} for {url[:200]}: {detail[:500]}') from e
                retry_after = e.headers.get('Retry-After') if e.headers else None
                sleep = float(retry_after) if retry_after and retry_after.isdigit() else delay
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                last_err = e
                sleep = delay
            if attempt == self.retries:
                break
            self.stats['retries'] += 1
            if self.verbose:
                print(f'[wikidata] retry {attempt + 1} in {sleep:.0f}s: {last_err}', file=sys.stderr)
            time.sleep(min(sleep, 120))
            delay *= 2
        raise WikidataError(f'giving up after {self.retries} retries: {last_err}')

    def _cache_path(self, kind: str, key: str) -> str:
        return os.path.join(self.cache_dir, kind, key + '.json')

    def _cached(self, kind: str, key_obj, fetch, refresh: bool = False):
        key = _key(key_obj)
        p = self._cache_path(kind, key)
        if not refresh and os.path.exists(p):
            self.stats['cacheHits'] += 1
            with open(p, encoding='utf-8') as f:
                return json.load(f)['data']
        data = fetch()
        tmp = p + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump({'key': key_obj, 'fetched': datetime.now(timezone.utc).isoformat(timespec='seconds'),
                       'data': data}, f, ensure_ascii=False)
        os.replace(tmp, p)
        return data

    # ------------------------------------------------------------------ MediaWiki API
    def api(self, params: dict, refresh: bool = False) -> dict:
        params = {**params, 'format': 'json', 'formatversion': '2'}

        def fetch():
            for attempt in range(4):
                body = self._http(API + '?' + urllib.parse.urlencode({**params, 'maxlag': '5'}))
                d = json.loads(body)
                err = d.get('error')
                if err and err.get('code') == 'maxlag':
                    time.sleep(5 * (attempt + 1))
                    continue
                if err:
                    raise WikidataError(f"API error {err.get('code')}: {err.get('info')}")
                return d
            raise WikidataError('API lagged too long')

        return self._cached('api', params, fetch, refresh)

    def search(self, text: str, limit: int = 10, language: str = 'en') -> list[dict]:
        params = {'action': 'wbsearchentities', 'search': text, 'language': language, 'uselang': language,
                  'type': 'item', 'limit': str(limit), 'strictlanguage': '1'}
        if not os.path.exists(self._cache_path('api', _key({**params, 'format': 'json', 'formatversion': '2'}))):
            # wbsearchentities answers HTTP 429 above roughly 25 calls a minute: pace it to one a second
            wait = self._last_search + 1.0 - time.monotonic()
            if wait > 0:
                time.sleep(wait)
            self._last_search = time.monotonic()
        d = self.api(params)
        return [{'id': r['id'], 'label': r.get('label'), 'description': r.get('description'),
                 'match': (r.get('match') or {}).get('text')} for r in d.get('search', [])]

    # ------------------------------------------------------------------ entities
    def entities(self, qids, refresh: bool = False, progress: str | None = None) -> dict:
        """{requested qid: slim entity} (missing items come back as {'id', 'missing': True})."""
        qids = [q for q in dict.fromkeys(qids) if q and re.fullmatch(r'Q\d+', q)]
        out, todo = {}, []
        for q in qids:
            p = self._cache_path('entity', q)
            if not refresh and os.path.exists(p):
                with open(p, encoding='utf-8') as f:
                    e = json.load(f)
                if e.get('_v') == SLIM_VERSION:
                    out[q] = e
                    self.stats['entityHits'] += 1
                    continue
            todo.append(q)
        batches = [todo[i:i + BATCH] for i in range(0, len(todo), BATCH)]
        done = 0
        while batches:
            batch = batches.pop(0)
            done += len(batch)
            if progress:
                print(f'[wikidata] {progress}: entities {done}/{len(todo)}', file=sys.stderr)
            params = {'action': 'wbgetentities', 'ids': '|'.join(batch), 'languages': 'en',
                      'props': 'labels|descriptions|aliases|claims|sitelinks', 'format': 'json'}
            try:
                body = self._http(API + '?' + urllib.parse.urlencode({**params, 'maxlag': '5'}))
                d = json.loads(body)
            except MemoryError:
                body = d = None
                if len(batch) == 1:
                    raise
                done -= len(batch)
                batches[:0] = [[q] for q in batch]  # very large items: one per request
                continue
            del body
            if d.get('error'):
                for attempt in range(8):  # replication lag: back off and retry (busy hours can need minutes)
                    if (d.get('error') or {}).get('code') != 'maxlag':
                        break
                    time.sleep(min(120, 5 * 2 ** attempt))
                    body = self._http(API + '?' + urllib.parse.urlencode({**params, 'maxlag': '5'}))
                    d = json.loads(body)
                if d.get('error'):
                    raise WikidataError(f"wbgetentities: {d['error']}")
            got = d.get('entities', {})
            for q in batch:
                raw = got.get(q)
                if raw is None:  # redirected: find the entity that says it came from q
                    raw = next((e for e in got.values() if (e.get('redirects') or {}).get('from') == q), None)
                if raw is None:  # not in the answer at all: retry alone, never cache as missing
                    one = json.loads(self._http(API + '?' + urllib.parse.urlencode(
                        {**params, 'ids': q, 'maxlag': '5'}))).get('entities', {})
                    raw = one.get(q) or next(iter(one.values()), None)
                    if raw is None:
                        raise WikidataError(f'wbgetentities returned nothing for {q}')
                slim = slim_entity(raw, q)
                with open(self._cache_path('entity', q), 'w', encoding='utf-8') as f:
                    json.dump(slim, f, ensure_ascii=False)
                out[q] = slim
                self.stats['entityFetched'] += 1
        return out

    def entity(self, qid: str) -> dict:
        return self.entities([qid])[qid]

    # ------------------------------------------------------------------ SPARQL
    def sparql(self, query: str, refresh: bool = False) -> list[dict]:
        """Bindings as {var: value} (entity URIs shortened to Q-ids, literals as strings)."""
        q = re.sub(r'[ \t]+', ' ', query.strip())

        def fetch():
            data = urllib.parse.urlencode({'query': q, 'format': 'json'}).encode('utf-8')
            body = self._http(SPARQL_URL, data=data, headers={
                'Accept': 'application/sparql-results+json',
                'Content-Type': 'application/x-www-form-urlencoded'})
            try:
                d = json.loads(body)
            except json.JSONDecodeError as e:
                raise WikidataError(f'SPARQL answer is not JSON (timeout?): {body[:300]!r}') from e
            rows = []
            for b in d['results']['bindings']:
                row = {}
                for k, v in b.items():
                    val = v.get('value')
                    if v.get('type') == 'uri' and val.startswith('http://www.wikidata.org/entity/'):
                        val = val.rsplit('/', 1)[1]
                    row[k] = val
                rows.append(row)
            return rows

        return self._cached('sparql', {'query': q}, fetch, refresh)

    # ------------------------------------------------------------------ classes
    def verify_qids(self, expected: dict) -> dict:
        """expected {qid: label substring}. Returns {qid: label} for matching ones and
        raises WikidataError naming every QID whose English label does not match."""
        ents = self.entities(list(expected))
        bad, ok = [], {}
        for q, want in expected.items():
            lab = (ents.get(q) or {}).get('label') or ''
            if want.lower() in lab.lower():
                ok[q] = lab
            else:
                bad.append(f'{q} is "{lab}", expected "{want}"')
        if bad:
            raise WikidataError('class QIDs failed verification: ' + '; '.join(bad))
        return ok

    def subclass_closure(self, root: str) -> set:
        """All classes C with C wdt:P279* root (cached SPARQL)."""
        rows = self.sparql(f'SELECT DISTINCT ?c WHERE {{ ?c wdt:P279* wd:{root} . }}')
        return {r['c'] for r in rows if r['c'].startswith('Q')}

    def class_roots(self, classes, roots) -> dict:
        """{class: set(roots it is a (transitive) subclass of)} via upward P279* paths."""
        classes = sorted({c for c in classes if c and re.fullmatch(r'Q\d+', c)})
        roots = sorted(set(roots))
        out = {c: set() for c in classes}
        vroots = ' '.join('wd:' + r for r in roots)
        for i in range(0, len(classes), 150):
            part = classes[i:i + 150]
            vals = ' '.join('wd:' + c for c in part)
            rows = self.sparql(
                'SELECT DISTINCT ?c ?root WHERE { VALUES ?c { ' + vals + ' } VALUES ?root { ' + vroots + ' } '
                '?c wdt:P279* ?root . hint:Prior hint:gearing "forward" . }')
            for r in rows:
                out.setdefault(r['c'], set()).add(r['root'])
        return out


# ---------------------------------------------------------------------- slimming
def _value(snak):
    if not snak or snak.get('snaktype') != 'value':
        return None
    dv = snak.get('datavalue') or {}
    t, v = dv.get('type'), dv.get('value')
    if t == 'wikibase-entityid':
        return v.get('id') or ('Q%d' % v['numeric-id'])
    if t == 'time':
        return [v['time'], v.get('precision', 9)]
    if t == 'globecoordinate':
        if (v.get('globe') or '').endswith('/Q2'):
            return [v['latitude'], v['longitude']]
        return None
    if t == 'monolingualtext':
        return [v['text'], v['language']]
    if t == 'string':
        return v
    if t == 'quantity':
        return v.get('amount')
    return None


def slim_entity(raw: dict | None, requested: str) -> dict:
    if raw is None or 'missing' in raw:
        return {'_v': SLIM_VERSION, 'id': requested, 'missing': True}
    claims = {}
    for pid in KEEP_PROPS:
        out = []
        for c in raw.get('claims', {}).get(pid, []):
            item = {'v': _value(c.get('mainsnak')), 'r': c.get('rank', 'normal')[0]}
            if c.get('mainsnak', {}).get('snaktype') != 'value':
                item['st'] = c.get('mainsnak', {}).get('snaktype')
            qs = {}
            for qp in KEEP_QUALIFIERS:
                vals = [_value(s) for s in (c.get('qualifiers') or {}).get(qp, [])]
                vals = [x for x in vals if x is not None]
                if vals:
                    qs[qp] = vals
            if qs:
                item['q'] = qs
            out.append(item)
        if out:
            claims[pid] = out
    sl = raw.get('sitelinks') or {}
    return {
        '_v': SLIM_VERSION,
        'id': raw.get('id', requested),
        'redirectedFrom': requested if raw.get('id') and raw.get('id') != requested else None,
        'label': (raw.get('labels', {}).get('en') or {}).get('value'),
        'description': (raw.get('descriptions', {}).get('en') or {}).get('value'),
        'aliases': [a['value'] for a in raw.get('aliases', {}).get('en', [])],
        'enwiki': (sl.get('enwiki') or {}).get('title'),
        'sitelinks': len(sl),
        'claims': claims,
    }


# ---------------------------------------------------------------------- claim helpers
def claims(ent: dict | None, pid: str, deprecated: bool = False) -> list[dict]:
    if not ent or ent.get('missing'):
        return []
    cs = ent.get('claims', {}).get(pid, [])
    return [c for c in cs if deprecated or c.get('r') != 'd']


def values(ent: dict | None, pid: str, preferred_only: bool = False) -> list:
    cs = [c for c in claims(ent, pid) if c.get('v') is not None]
    if preferred_only and any(c['r'] == 'p' for c in cs):
        cs = [c for c in cs if c['r'] == 'p']
    return [c['v'] for c in cs]


def json_year(tv) -> tuple[int, int] | None:
    """[time string, precision] from the JSON API -> (HistYear, precision). The JSON API
    already uses historical numbering (no year 0)."""
    if not tv:
        return None
    m = re.match(r'^([+-])(\d+)-', tv[0])
    if not m:
        return None
    y = int(m.group(2)) * (-1 if m.group(1) == '-' else 1)
    if y == 0:
        y = -1
    return y, int(tv[1])


def sparql_year(xsd: str | None) -> int | None:
    """xsd:dateTime from WDQS (astronomical numbering: 0 = 1 BCE) -> HistYear."""
    if not xsd:
        return None
    m = re.match(r'^(-?)(\d+)-', xsd)
    if not m:
        return None
    y = int(m.group(2)) * (-1 if m.group(1) == '-' else 1)
    return y - 1 if y <= 0 else y


def qualifier_year(claim: dict, pid: str) -> tuple[int, int] | None:
    vals = (claim.get('q') or {}).get(pid) or []
    ys = [json_year(v) for v in vals]
    ys = [y for y in ys if y]
    return ys[0] if ys else None


def dates(ent: dict | None) -> dict:
    """{'start': [(year, precision, prop)], 'end': [...]} from P571/P580 and P576/P582."""
    out = {'start': [], 'end': []}
    for side, props in (('start', ('P571', 'P580')), ('end', ('P576', 'P582'))):
        for p in props:
            for c in claims(ent, p):
                y = json_year(c.get('v'))
                if y:
                    out[side].append((y[0], y[1], p))
    return out


def coord(ent: dict | None) -> tuple[float, float] | None:
    """(lon, lat) of the preferred/first P625."""
    vs = values(ent, 'P625', preferred_only=True)
    if not vs:
        return None
    lat, lon = vs[0]
    return float(lon), float(lat)


def label_set(ent: dict | None) -> list[str]:
    if not ent or ent.get('missing'):
        return []
    names = [ent.get('label')] + list(ent.get('aliases') or []) + [ent.get('enwiki')]
    names += [v[0] for v in values(ent, 'P1448') if isinstance(v, list)]
    names += [v[0] for v in values(ent, 'P1813') if isinstance(v, list) and v[1] == 'en']
    return [n for n in dict.fromkeys(names) if n]


def precision_slack(precision: int) -> int:
    if precision >= 9:
        return 0
    return PRECISION_SLACK.get(precision, 10000)
