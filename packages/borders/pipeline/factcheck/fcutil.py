"""Shared helpers for the fact-check tools: paths, config, name similarity, year windows,
override-file writing. Imports the pipeline's `common` (slug, years) read-only."""
from __future__ import annotations

import difflib
import json
import os
import re
import sys
import time
import unicodedata
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(PIPELINE, 'py'))
sys.path.insert(0, HERE)

import common as C  # noqa: E402  (pipeline helpers: slug, years, paths)

ROOT = C.ROOT
OUT_DIR = os.path.join(C.CACHE, 'factcheck')
OVERRIDES = C.OVERRIDES
REFERENCE = C.REFERENCE
FIRST_YEAR = C.FIRST_YEAR
HISTORICAL_FROM = C.HISTORICAL_FROM
CUTOVER_YEAR = C.CUTOVER_YEAR
PRESENT_YEAR = C.PRESENT_YEAR
TODAY = date.today().isoformat()

os.makedirs(OUT_DIR, exist_ok=True)


def load_config() -> dict:
    """factcheck/config.json, overlaid by an optional "factcheck" object in
    pipeline/config.json (read only; lets the build owner tighten thresholds)."""
    with open(os.path.join(HERE, 'config.json'), encoding='utf-8') as f:
        cfg = json.load(f)
    over = C.CONFIG.get('factcheck') or {}

    def merge(a, b):
        for k, v in b.items():
            if isinstance(v, dict) and isinstance(a.get(k), dict):
                merge(a[k], v)
            else:
                a[k] = v
    merge(cfg, over)
    return cfg


def read_json(path: str):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def write_json(path: str, obj, indent: int | None = 1) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
        f.write('\n')
    os.replace(tmp, path)


def write_text(path: str, text: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)


class Timer:
    def __init__(self):
        self.t0 = time.time()

    def __str__(self):
        return f'{time.time() - self.t0:.1f}s'

    @property
    def seconds(self) -> float:
        return round(time.time() - self.t0, 1)


# ------------------------------------------------------------------------ names
GENERIC = {
    'the', 'of', 'and', 'kingdom', 'empire', 'sultanate', 'khanate', 'emirate', 'caliphate', 'dynasty',
    'state', 'states', 'republic', 'principality', 'duchy', 'grand', 'county', 'confederation', 'confederacy',
    'federation', 'polity', 'chiefdom', 'realm', 'imperial', 'khaganate', 'beylik', 'shogunate', 'tsardom',
    'emirates', 'kingdoms', 'empire)', 'regency', 'imamate', 'principalities', 'city', 'period', 'rule',
    'territory', 'colony', 'protectorate', 'colonial', 'archduchy', 'margraviate', 'electorate', 'landgraviate',
    'tribe', 'nation', 'people', 'peoples', 'of the',
}


def fold(s: str) -> str:
    s = unicodedata.normalize('NFKD', s or '')
    s = ''.join(c for c in s if not unicodedata.combining(c)).lower()
    s = s.replace('&', ' and ')
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()


def core_tokens(s: str) -> list[str]:
    toks = fold(re.sub(r'\([^)]*\)', ' ', s or '')).split()
    core = [t for t in toks if t not in GENERIC]
    return core or toks


def similarity(a: str, b: str) -> float:
    """0..1: max of sequence similarity on folded strings and on generic-free cores,
    and token overlap of the cores (|A∩B| / |A∪B|, with prefix matches for
    adjective forms such as Ottoman/Ottomans, Byzantine/Byzantium)."""
    fa, fb = fold(a), fold(b)
    if not fa or not fb:
        return 0.0
    if fa == fb:
        return 1.0
    ca, cb = core_tokens(a), core_tokens(b)
    sa, sb = ' '.join(ca), ' '.join(cb)
    r1 = difflib.SequenceMatcher(None, fa, fb).ratio()
    r2 = difflib.SequenceMatcher(None, sa, sb).ratio() if sa and sb else 0.0

    def tok_eq(x, y):
        if x == y:
            return True
        n = min(len(x), len(y))
        return n >= 5 and x[:n - 1] == y[:n - 1] and abs(len(x) - len(y)) <= 3

    a_set, b_set = set(ca), set(cb)
    inter = sum(1 for x in a_set if any(tok_eq(x, y) for y in b_set))
    union = len(a_set) + len(b_set) - inter
    r3 = inter / union if union > 0 else 0.0
    return round(max(r1, r2, min(1.0, r3)), 3)


def best_similarity(name: str, labels: list[str]) -> tuple[float, str | None]:
    best, which = 0.0, None
    for lab in labels:
        s = similarity(name, lab)
        if s > best:
            best, which = s, lab
    return best, which


# ------------------------------------------------------------------------ years
def span_len(a: int, b: int) -> int:
    """Number of years in [a, b] (no year 0)."""
    n = b - a + 1
    if a < 0 < b:
        n -= 1
    return max(1, n)


def year_diff(a: int, b: int) -> int:
    """|a - b| in years, skipping year 0."""
    d = abs(a - b)
    if (a < 0 < b) or (b < 0 < a):
        d -= 1
    return d


def fmt_year(y: int) -> str:
    return f'{-y} BCE' if y < 0 else str(y)


WINDOWS = {'early': (FIRST_YEAR, HISTORICAL_FROM - 1), 'historical': (HISTORICAL_FROM, CUTOVER_YEAR - 1)}


def clip(span: tuple[int, int], window: str) -> tuple[int, int] | None:
    lo, hi = WINDOWS[window]
    a, b = max(span[0], lo), min(span[1], hi)
    return (a, b) if a <= b else None


# ------------------------------------------------------------------------ override files
def override_file(kind: str, region: str, scope: str, entries: list | None = None, **extra) -> dict:
    d = {'$schema': '../schema.json', 'kind': kind, 'region': region, 'scope': scope}
    if kind == 'modern':
        d.update(extra)
        if entries is not None:
            d['entries'] = entries
    else:
        d['entries'] = entries or []
    return d


def override_path(kind: str, name: str) -> str:
    return os.path.join(OVERRIDES, kind, name + '.json')


def unique_ids(entries: list[dict]) -> None:
    """Make entry ids unique in place (stable: suffix -2, -3 in order)."""
    seen = {}
    for e in entries:
        base = e['id']
        n = seen.get(base, 0) + 1
        seen[base] = n
        if n > 1:
            e['id'] = f'{base}-{n}'


def id_part(s: str, n: int = 48) -> str:
    return C.slug(s)[:n].strip('-') or 'x'


def md_table(rows: list[list], header: list[str]) -> str:
    def cell(x):
        return str(x).replace('|', '\\|').replace('\n', ' ')
    out = ['| ' + ' | '.join(header) + ' |', '| ' + ' | '.join('---' for _ in header) + ' |']
    out += ['| ' + ' | '.join(cell(x) for x in r) + ' |' for r in rows]
    return '\n'.join(out)


def load_inventory() -> list[dict]:
    return read_json(os.path.join(REFERENCE, 'cliopatria-inventory.json'))


def load_admin0() -> list[dict]:
    return read_json(os.path.join(REFERENCE, 'ne-admin0.json'))
