"""Builds reference lists for override authors and auditors into .cache/reference/.

Outputs
  ne-admin0.json     Natural Earth admin-0 units (ADM0_A3 codes) with audit region
  ne-admin1.json     Natural Earth admin-1 units (adm1_code / iso_3166_2)
  ne-disputed.json   Natural Earth disputed areas (BRK_A3 codes)
  regions.json       audit regions -> NE subregions and admin-0 codes
  frames.json        Cliopatria change years (years where the set of live records changes)
  cliopatria-inventory.json   every Cliopatria record, normalised (pid, years, point, region)
  cliopatria-geoms.pkl        {rid: WKB geometry} for previews (raw Cliopatria geometry, unclipped)
  inventory/<region>.json     the same, split by audit region of the record's representative point

Run: node packages/borders/pipeline/tools/py.mjs reference.py
"""
import json
import os
import re
import sys
import unicodedata
import zipfile
from collections import defaultdict

from shapely import STRtree
from shapely.geometry import Point, shape

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
SRC = os.path.join(ROOT, '.cache', 'sources')
OUT = os.path.join(ROOT, '.cache', 'reference')
NE = os.path.join(SRC, 'natural-earth')
CLIO_ZIP = os.path.join(SRC, 'cliopatria', 'cliopatria-v0.2.0.geojson.zip')

# Audit regions (also used for override file names). Keyed by NE SUBREGION;
# Russia gets its own region because it spans Eastern Europe and Siberia.
SUBREGION_TO_REGION = {
    'Northern America': 'northern-america',
    'Central America': 'central-america',
    'Caribbean': 'caribbean',
    'South America': 'south-america',
    'Northern Europe': 'northern-europe',
    'Western Europe': 'western-europe',
    'Southern Europe': 'southern-europe',
    'Eastern Europe': 'eastern-europe',
    'Western Asia': 'western-asia',
    'Central Asia': 'central-asia',
    'Southern Asia': 'southern-asia',
    'Eastern Asia': 'eastern-asia',
    'South-Eastern Asia': 'south-eastern-asia',
    'Northern Africa': 'northern-africa',
    'Western Africa': 'western-africa',
    'Middle Africa': 'middle-africa',
    'Eastern Africa': 'eastern-africa',
    'Southern Africa': 'southern-africa',
    'Australia and New Zealand': 'australia-nz',
    'Melanesia': 'pacific-islands',
    'Micronesia': 'pacific-islands',
    'Polynesia': 'pacific-islands',
    'Antarctica': 'antarctica-remote',
    'Seven seas (open ocean)': 'antarctica-remote',
}
REGION_OVERRIDES = {'RUS': 'russia'}


def slug(name: str) -> str:
    s = unicodedata.normalize('NFKD', name)
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower().replace('&', ' and ')
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'unnamed'


def clio_pid(name: str, typ: str) -> str:
    """pid convention shared with the pipeline (see packages/borders/AGENTS.md)."""
    if typ == 'RELATION':
        return 'clio:rel-' + slug(name)
    if name.startswith('(') and name.endswith(')'):
        return 'clio:group-' + slug(name)
    return 'clio:' + slug(name)


def hist_year(y: int, end: bool) -> int:
    """Cliopatria uses 0 only as an arithmetic artefact; there is no year 0."""
    if y == 0:
        return -1 if end else 1
    return y


def largest_part_point(geom):
    parts = list(geom.geoms) if geom.geom_type == 'MultiPolygon' else [geom]
    big = max(parts, key=lambda g: g.area)
    p = big.representative_point()
    return p


def load_geojson(name):
    with open(os.path.join(NE, name + '.geojson'), encoding='utf-8') as f:
        return json.load(f)


def main():
    os.makedirs(os.path.join(OUT, 'inventory'), exist_ok=True)

    # --- Natural Earth admin-0 ---------------------------------------------------
    a0 = load_geojson('ne_10m_admin_0_countries')
    admin0, a0_geoms, a0_codes = [], [], []
    for f in a0['features']:
        p = f['properties']
        code = p['ADM0_A3']
        region = REGION_OVERRIDES.get(code) or SUBREGION_TO_REGION.get(p['SUBREGION'], 'unassigned')
        admin0.append({
            'code': code, 'name': p['NAME'], 'nameLong': p.get('NAME_LONG'),
            'sovereign': p['SOVEREIGNT'], 'sovA3': p['SOV_A3'], 'type': p['TYPE'],
            'subregion': p['SUBREGION'], 'continent': p.get('CONTINENT'), 'isoA3': p['ISO_A3'],
            'label': [round(p['LABEL_X'], 4), round(p['LABEL_Y'], 4)], 'auditRegion': region,
        })
        a0_geoms.append(shape(f['geometry']))
        a0_codes.append(code)
    admin0.sort(key=lambda r: (r['auditRegion'], r['code']))

    # --- Natural Earth admin-1 ---------------------------------------------------
    a1 = load_geojson('ne_10m_admin_1_states_provinces')
    admin1 = []
    for f in a1['features']:
        p = f['properties']
        admin1.append({
            'code': p['adm1_code'], 'iso': p.get('iso_3166_2'), 'name': p.get('name'),
            'nameEn': p.get('name_en'), 'country': p.get('admin'), 'adm0': p.get('adm0_a3'),
            'type': p.get('type_en'), 'region': p.get('region'),
            'point': [round(p.get('longitude') or 0, 4), round(p.get('latitude') or 0, 4)],
        })
    admin1.sort(key=lambda r: (r['adm0'] or '', r['code']))

    # --- Natural Earth disputed areas ----------------------------------------------
    da = load_geojson('ne_10m_admin_0_disputed_areas')
    disputed = []
    for f in da['features']:
        p = f['properties']
        g = shape(f['geometry'])
        pt = g.representative_point()
        disputed.append({
            'code': p.get('BRK_A3'), 'name': (p.get('BRK_NAME') or '').replace('﻿', ''),
            'sovereign': p.get('SOVEREIGNT'), 'admin': p.get('ADMIN'), 'type': p.get('TYPE'),
            'note': (p.get('NOTE_BRK') or '').replace('﻿', ''),
            'point': [round(pt.x, 4), round(pt.y, 4)],
        })
    disputed.sort(key=lambda r: r['code'] or '')

    regions = defaultdict(lambda: {'subregions': set(), 'admin0': []})
    for r in admin0:
        regions[r['auditRegion']]['subregions'].add(r['subregion'])
        regions[r['auditRegion']]['admin0'].append(r['code'])
    regions_out = {k: {'subregions': sorted(v['subregions']), 'admin0': sorted(v['admin0'])} for k, v in sorted(regions.items())}

    # --- Cliopatria inventory -------------------------------------------------------
    with zipfile.ZipFile(CLIO_ZIP) as z:
        member = next(n for n in z.namelist() if n.endswith('.geojson') and not n.startswith('__MACOSX'))
        with z.open(member) as f:
            clio = json.load(f)

    tree = STRtree(a0_geoms)
    label_pts = [(r['label'][0], r['label'][1]) for r in sorted(admin0, key=lambda r: a0_codes.index(r['code']))]
    code_region = {r['code']: r['auditRegion'] for r in admin0}

    records, change_years, geoms = [], set(), {}
    for i, f in enumerate(clio['features']):
        p = f['properties']
        name = p['Name']
        typ = p.get('Type') or 'POLITY'
        y0 = hist_year(int(p['FromYear']), end=False)
        y1 = hist_year(int(p['ToYear']), end=True)
        g = shape(f['geometry'])
        if not g.is_valid:
            g = g.buffer(0)
        pt = largest_part_point(g) if not g.is_empty else Point(0, 0)
        hits = tree.query(pt, predicate='intersects')
        if len(hits):
            code = a0_codes[int(hits[0])]
        else:
            # point at sea: nearest admin-0 polygon
            code = a0_codes[int(tree.nearest(pt))]
        minx, miny, maxx, maxy = g.bounds if not g.is_empty else (0, 0, 0, 0)
        group = p.get('MemberOf') or None
        records.append({
            'rid': f'{clio_pid(name, typ)}@{y0}', 'pid': clio_pid(name, typ), 'name': name, 'type': typ,
            'from': y0, 'to': y1, 'memberOf': group, 'components': p.get('Components') or None,
            'wikidata': p.get('Wikidata') or None, 'wikipedia': p.get('Wikipedia') or None,
            'seshat': p.get('SeshatID') or None, 'areaKm2': round(float(p.get('Area') or 0)),
            'bbox': [round(minx, 2), round(miny, 2), round(maxx, 2), round(maxy, 2)],
            'point': [round(pt.x, 3), round(pt.y, 3)], 'adm0': code,
            'region': code_region.get(code, 'unassigned'), 'index': i,
        })
        geoms[i] = g.wkb
        change_years.add(y0)
        change_years.add(y1 + 1 if y1 != -1 else 1)

    # Different source names that slug to the same pid (e.g. 'Han' / 'Hán') get a
    # deterministic suffix: '-q<wikidata>' when the name has a QID, else '-<n>' in
    # name order. The pipeline applies the same rule (see disambiguate_pids).
    by_pid = defaultdict(set)
    for r in records:
        by_pid[r['pid']].add(r['name'])
    collisions = {k: sorted(v) for k, v in by_pid.items() if len(v) > 1}
    rename = {}
    for pid, names in collisions.items():
        for n, name in enumerate(names, start=1):
            qids = sorted({r['wikidata'] for r in records if r['name'] == name and r['wikidata']})
            rename[(pid, name)] = f"{pid}-{qids[0].lower()}" if qids else f"{pid}-{n}"
    for r in records:
        new = rename.get((r['pid'], r['name']))
        if new:
            r['pid'] = new
            r['rid'] = f"{new}@{r['from']}"
    collisions = {k: {name: rename[(k, name)] for name in v} for k, v in collisions.items()}
    by_pid = defaultdict(set)
    for r in records:
        by_pid[r['pid']].add(r['name'])
    assert all(len(v) == 1 for v in by_pid.values()), 'pid disambiguation failed'

    records.sort(key=lambda r: (r['region'], r['name'], r['from']))
    per_region = defaultdict(list)
    for r in records:
        per_region[r['region']].append(r)

    def dump(name, obj):
        with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)

    import pickle
    with open(os.path.join(OUT, 'cliopatria-geoms.pkl'), 'wb') as f:
        pickle.dump({r['rid']: geoms[r['index']] for r in records}, f, protocol=pickle.HIGHEST_PROTOCOL)

    dump('ne-admin0.json', admin0)
    dump('ne-admin1.json', admin1)
    dump('ne-disputed.json', disputed)
    dump('regions.json', regions_out)
    dump('frames.json', sorted(y for y in change_years if -3400 <= y <= 2025))
    dump('cliopatria-inventory.json', records)
    dump('pid-collisions.json', collisions)
    for region, rows in per_region.items():
        dump(os.path.join('inventory', f'{region}.json'), rows)

    print(f'admin0={len(admin0)} admin1={len(admin1)} disputed={len(disputed)} records={len(records)} '
          f'pids={len(by_pid)} collisions={len(collisions)} frames={len(change_years)}')
    for region, rows in sorted(per_region.items()):
        h = sum(1 for r in rows if r['to'] >= 1700)
        print(f'  {region:20s} records={len(rows):5d} alive>=1700={h:4d}')


if __name__ == '__main__':
    sys.exit(main())
