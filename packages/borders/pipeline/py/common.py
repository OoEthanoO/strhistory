"""Shared helpers and the in-memory record contract for the Python pipeline steps.

Record contract (a plain dict; geometry is a shapely Polygon/MultiPolygon in lon/lat):

    rid        str   f"{pid}@{from}" (unique per record; suffix '#n' if a pid starts twice in one year)
    pid        str   'clio:<slug>' | 'ne:<adm0_a3 lower>' | 'ovr:<slug>' | 'none' (unclaimed land)
    name       str   display name for this period ('' for unclaimed land)
    from, to   int   inclusive historical years, never 0
    kind       str   'state' | 'dependency' | 'indigenous' | 'disputed' | 'other' | 'unclaimed'
    tier       int   0 base layer (exclusive areas) | 1 hatched overlay
    power      str   colour key: pid of the controlling polity (defaults to pid)
    partof     str|None   wider grouping name
    subjecto   str|None   controlling power as the period names it
    disputed   bool
    precision  str   'exact' | 'approximate'
    src        str   'cliopatria' | 'naturalearth' | 'override'
    wikidata, wikipedia, altNames, note   optional
    geometry   shapely (Multi)Polygon, valid, lon/lat
    prov       dict  provenance, e.g. {'overrides': ['h-...-0001'], 'islands': 3, 'coastKm2': 120.5}

All years go through `norm_year`; the pipeline never produces year 0.
"""
from __future__ import annotations

import json
import os
import pickle
import re
import unicodedata
from functools import cached_property
from typing import Iterable, Iterator

import shapely
import shapely.ops
from shapely import STRtree
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.polygon import orient
from pyproj import Geod

HERE = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.dirname(HERE)
BORDERS = os.path.dirname(PIPELINE)
ROOT = os.path.dirname(os.path.dirname(BORDERS))

with open(os.path.join(PIPELINE, 'config.json'), encoding='utf-8') as _f:
    CONFIG = json.load(_f)

FIRST_YEAR = CONFIG['years']['first']
HISTORICAL_FROM = CONFIG['years']['historicalFrom']
CUTOVER_YEAR = CONFIG['years']['cutover']
PRESENT_YEAR = CONFIG['years']['present']


def path(*parts: str) -> str:
    """Absolute path from the repository root (config paths are root-relative)."""
    return os.path.join(ROOT, *parts)


CACHE = path(CONFIG['paths']['cache'])
BUILD = path(CONFIG['paths']['build'])
REFERENCE = path(CONFIG['paths']['reference'])
OVERRIDES = path(CONFIG['paths']['overrides'])
DATA = path(CONFIG['paths']['data'])
NE_DIR = path(CONFIG['sources']['naturalearth']['dir'])
CLIO_ZIP = path(CONFIG['sources']['cliopatria']['file'])

# ----------------------------------------------------------------------------- ids


def slug(name: str) -> str:
    s = unicodedata.normalize('NFKD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'unnamed'


def clio_pid(name: str, typ: str = 'POLITY') -> str:
    """Cliopatria pid before collision handling (see disambiguate_pids)."""
    if typ == 'RELATION':
        return 'clio:rel-' + slug(name)
    if name.startswith('(') and name.endswith(')'):
        return 'clio:group-' + slug(name)
    return 'clio:' + slug(name)


def disambiguate_pids(records: list[dict]) -> dict:
    """Different source names that share a slug get '-q<wikidata>' (else '-<n>' in
    name order). Mutates records' pid/rid; returns {old_pid: {name: new_pid}}.
    Must match pipeline/tools/reference.py."""
    names: dict[str, set] = {}
    for r in records:
        names.setdefault(r['pid'], set()).add(r['name'])
    collisions = {k: sorted(v) for k, v in names.items() if len(v) > 1}
    rename = {}
    for pid, ns in collisions.items():
        for n, name in enumerate(ns, start=1):
            qids = sorted({r['wikidata'] for r in records if r['name'] == name and r.get('wikidata')})
            rename[(pid, name)] = f'{pid}-{qids[0].lower()}' if qids else f'{pid}-{n}'
    for r in records:
        new = rename.get((r['pid'], r['name']))
        if new:
            r['pid'] = new
            r['rid'] = f"{new}@{r['from']}"
    return {k: {name: rename[(k, name)] for name in v} for k, v in collisions.items()}


# --------------------------------------------------------------------------- years


def norm_year(y: int, end: bool = False) -> int:
    """Historical numbering has no year 0: 0 as an end year means 1 BCE (-1), as a
    start year 1 CE (1)."""
    y = int(y)
    if y == 0:
        return -1 if end else 1
    return y


def resolve_year(y) -> int:
    return PRESENT_YEAR if y == 'present' else int(y)


def add_years(y: int, n: int) -> int:
    """y + n skipping year 0."""
    a = y + 1 if y < 0 else y  # astronomical: -1 -> 0
    a += n
    return a - 1 if a <= 0 else a


def overlaps(a: tuple[int, int], b: tuple[int, int]) -> bool:
    return a[0] <= b[1] and b[0] <= a[1]


# ------------------------------------------------------------------------ geometry

GEOD = Geod(ellps='WGS84')


def polygonal(g) -> MultiPolygon:
    """Valid MultiPolygon with only polygonal parts (empty MultiPolygon if none)."""
    if g is None or g.is_empty:
        return MultiPolygon()
    if not g.is_valid:
        g = shapely.make_valid(g)
    parts: list[Polygon] = []

    def collect(x):
        if x.is_empty:
            return
        if isinstance(x, Polygon):
            parts.append(x)
        elif isinstance(x, MultiPolygon):
            parts.extend(p for p in x.geoms if not p.is_empty)
        elif hasattr(x, 'geoms'):
            for y in x.geoms:
                collect(y)

    collect(g)
    return MultiPolygon(parts) if parts else MultiPolygon()


def area_km2(g) -> float:
    """Geodesic area on WGS84 in km² (works for any polygonal geometry)."""
    if g is None or g.is_empty:
        return 0.0
    return abs(GEOD.geometry_area_perimeter(g)[0]) / 1e6


def rfc7946(g):
    """Exterior rings counter-clockwise, holes clockwise (RFC 7946)."""
    g = polygonal(g)
    return MultiPolygon([orient(p, sign=1.0) for p in g.geoms])


# ---------------------------------------------------------------- Natural Earth ctx


def _load_fc(name: str) -> list[dict]:
    with open(os.path.join(NE_DIR, name + '.geojson'), encoding='utf-8') as f:
        return json.load(f)['features']


class Ctx:
    """Lazily loaded Natural Earth layers and spatial indexes shared by all steps.

    The pipeline sets `ctx.record_lookup = fn(pid, year) -> geometry | None` before
    resolving override geometry specs of type 'record'.
    """

    def __init__(self):
        self.record_lookup = None

    @cached_property
    def land_parts(self) -> list[Polygon]:
        """Every Natural Earth land part (ne_10m_land ∪ ne_10m_minor_islands), dissolved."""
        cache = os.path.join(BUILD, 'ne-land-parts.pkl')
        if os.path.exists(cache):
            with open(cache, 'rb') as f:
                return pickle.load(f)
        geoms = [shape(f['geometry']) for f in _load_fc('ne_10m_land')]
        geoms += [shape(f['geometry']) for f in _load_fc('ne_10m_minor_islands')]
        merged = polygonal(shapely.union_all([polygonal(g) for g in geoms]))
        parts = list(merged.geoms)
        os.makedirs(BUILD, exist_ok=True)
        with open(cache, 'wb') as f:
            pickle.dump(parts, f)
        return parts

    @cached_property
    def land(self) -> MultiPolygon:
        return MultiPolygon(self.land_parts)

    @cached_property
    def land_tree(self) -> STRtree:
        return STRtree(self.land_parts)

    @cached_property
    def admin0(self) -> dict[str, MultiPolygon]:
        return {f['properties']['ADM0_A3']: polygonal(shape(f['geometry'])) for f in _load_fc('ne_10m_admin_0_countries')}

    @cached_property
    def admin1(self) -> dict[str, MultiPolygon]:
        """Keyed by adm1_code and by iso_3166_2 (when present and unique)."""
        out: dict[str, MultiPolygon] = {}
        iso_count: dict[str, int] = {}
        feats = _load_fc('ne_10m_admin_1_states_provinces')
        for f in feats:
            iso = f['properties'].get('iso_3166_2')
            if iso and iso != '-99':
                iso_count[iso] = iso_count.get(iso, 0) + 1
        for f in feats:
            p = f['properties']
            g = polygonal(shape(f['geometry']))
            out[p['adm1_code']] = g
            iso = p.get('iso_3166_2')
            if iso and iso != '-99' and iso_count.get(iso) == 1:
                out[iso] = g
        return out

    @cached_property
    def disputed(self) -> dict[str, MultiPolygon]:
        out: dict[str, MultiPolygon] = {}
        for f in _load_fc('ne_10m_admin_0_disputed_areas'):
            code = f['properties'].get('BRK_A3')
            g = polygonal(shape(f['geometry']))
            out[code] = polygonal(shapely.union_all([out[code], g])) if code in out else g
        return out

    @cached_property
    def lakes(self) -> MultiPolygon:
        return polygonal(shapely.union_all([polygonal(shape(f['geometry'])) for f in _load_fc('ne_10m_lakes')]))

    def islands_at(self, points: Iterable[tuple[float, float]], snap_km: float = 5.0) -> MultiPolygon:
        """Whole land parts containing each point; a point at sea snaps to the nearest
        part within `snap_km`, else ValueError."""
        from shapely.geometry import Point
        chosen = []
        for lon, lat in points:
            pt = Point(lon, lat)
            hits = self.land_tree.query(pt, predicate='intersects')
            if len(hits):
                chosen.append(self.land_parts[int(hits[0])])
                continue
            i = int(self.land_tree.nearest(pt))
            part = self.land_parts[i]
            near = shapely.ops.nearest_points(pt, part)[1]
            dist_km = GEOD.inv(lon, lat, near.x, near.y)[2] / 1000
            if dist_km > snap_km:
                raise ValueError(f'point {lon},{lat} is {dist_km:.1f} km from the nearest land part (> {snap_km} km)')
            chosen.append(part)
        return polygonal(shapely.union_all(chosen))


# ------------------------------------------------------------------------------ io


def feature(record: dict) -> dict:
    """GeoJSON Feature for a record (geometry RFC 7946-wound, props without geometry/prov)."""
    props = {k: v for k, v in record.items() if k not in ('geometry', 'prov')}
    return {'type': 'Feature', 'id': record.get('id'), 'properties': props, 'geometry': mapping(rfc7946(record['geometry']))}


def write_geojsonl(file: str, features: Iterable[dict]) -> int:
    os.makedirs(os.path.dirname(file), exist_ok=True)
    n = 0
    with open(file, 'w', encoding='utf-8', newline='\n') as f:
        for feat in features:
            f.write(json.dumps(feat, ensure_ascii=False, separators=(',', ':')))
            f.write('\n')
            n += 1
    return n


def read_geojsonl(file: str) -> Iterator[dict]:
    with open(file, encoding='utf-8') as f:
        for line in f:
            if line.strip():
                yield json.loads(line)


def save_pickle(file: str, obj) -> None:
    os.makedirs(os.path.dirname(file), exist_ok=True)
    with open(file, 'wb') as f:
        pickle.dump(obj, f, protocol=pickle.HIGHEST_PROTOCOL)


def load_pickle(file: str):
    with open(file, 'rb') as f:
        return pickle.load(f)
