# AGENTS.md — @alexs-atlas/borders

Historical world borders from 3400 BCE to the present, as static time-chunked
TopoJSON files plus a small isomorphic query API. This file is self-contained so
the package can be copied into another project. Project-wide rules live in the
root [AGENTS.md](../../AGENTS.md); task status in [todo.md](../../todo.md).

## 1. What is in this package

| Path | What |
| --- | --- |
| `src/` | Query API (`loadManifest`, `createBorders`, `bordersAt`, year helpers; `@alexs-atlas/borders/node`). No DOM, no MapLibre import (§7). |
| `pipeline/` | Build pipeline: pinned sources → normalised records → overrides → clip to coasts → islands → LODs → chunks + manifest (§6). |
| `pipeline/tools/` | `reference.py` (code lists for editors), `validate-overrides.mjs`, `catalog.mjs`, `preview.py`, `dev-features.mjs`, `py.mjs` (runs Python in `.cache/venv`). |
| `pipeline/factcheck/` | Deterministic fact-check toolkit (`npm run data:factcheck`, `npm run data:tileqa`); writes the generated `auto-*.json` override files (§4.4). |
| `overrides/` | **Manual, sourced fixes** — the editable part of the dataset (§4); `CATALOG.md` = the generated full catalog (§5). |
| `data/` | Built dataset (generated; copy it to your site's static folder). |

## 2. Two layers, one cut-over

| Years | Layer | Source of geometry |
| --- | --- | --- |
| −3400 … 1945 | historical | Cliopatria v0.2.0 (CC BY 4.0) leaf polities, cleaned, clipped to Natural Earth 10m land, islands and coastal gaps assigned, then `overrides/early` and `overrides/historical` applied |
| 1946 … present | modern | Natural Earth admin-0/admin-1 units (public domain) assembled per year from the unit timelines in `overrides/modern` |

Never mix the two layers within one year: a year is drawn from exactly one
layer. `CUTOVER_YEAR = 1946` lives in `pipeline/tools/validate-overrides.mjs`
and the pipeline config.

## 3. Conventions every editor must follow

**Years.** Integers, historical numbering with no year 0: −1 is 1 BCE, 1 is
1 CE. Ranges are inclusive `[from, to]`. A change that takes effect at any date
in year Y is first shown in year Y (the map for year Y shows borders as at
31 December of Y). So Algeria (independent 5 July 1962) is French Algeria for
`[1946, 1961]` and Algeria for `[1962, "present"]`. `"present"` means the build's
present year (currently 2026).

**Polity ids (`pid`).**
- `clio:<slug>` — Cliopatria polities. slug = NFKD-normalise, drop accents,
  lowercase, `&` → `and`, every run of other non-alphanumerics → `-`. Bracketed
  composites are `clio:group-<slug>`, RELATION records `clio:rel-<slug>`. Two
  different names with the same slug get `-q<wikidata>` (e.g. `clio:han-q1968654`).
  Look pids up in `.cache/reference/cliopatria-inventory.json` (field `pid`).
- `ne:<adm0_a3 lowercase>` — present-day states and territories as Natural Earth
  names them (`ne:fra`, `ne:usa`, `ne:twn`). Use the same pid for the whole
  continuous history of that state after 1945, even across renames (Ceylon →
  Sri Lanka is `ne:lka` with two periods).
- `ovr:<slug of the common English name>` — everything else added by overrides
  (`ovr:soviet-union`, `ovr:cherokee-nation`, `ovr:french-algeria`). Reuse the
  exact pid when another file adds the same polity; the validator warns when one
  pid is used with different names.

**Shared modern pids** (several regions touch these; use exactly these ids,
names and Wikidata ids):

| pid | name | Wikidata | years |
| --- | --- | --- | --- |
| `ovr:soviet-union` | Soviet Union | Q15180 | 1946–1991 |
| `ovr:yugoslavia` | Yugoslavia | Q83286 | 1946–1991 (FPR, then SFR from 1963 — one pid) |
| `ovr:fr-yugoslavia` | Federal Republic of Yugoslavia | Q838261 | 1992–2002 |
| `ovr:serbia-and-montenegro` | Serbia and Montenegro | Q37024 | 2003–2005 |
| `ovr:czechoslovakia` | Czechoslovakia | Q33946 | 1946–1992 |
| `ovr:west-germany` | West Germany | Q713750 | 1949–1989 |
| `ovr:east-germany` | East Germany | Q16957 | 1949–1989 |
| `ovr:allied-occupied-germany` | Allied-occupied Germany | Q2415901 | 1946–1948 |
| `ovr:united-arab-republic` | United Arab Republic | Q170468 | 1958–1960 |
| `ovr:north-yemen` / `ovr:south-yemen` | Yemen Arab Republic / People's Democratic Republic of Yemen | Q267584 / Q199841 | to 1989 |

Colonies and other dependencies get their own `ovr:` pid (e.g.
`ovr:belgian-congo`), `kind: "dependency"` and `power: "ne:<metropole>"` so they
share the colonial power's colour.

**kind and tier.**
- `kind`: `state` (sovereign or de facto independent), `dependency` (colony,
  protectorate, mandate, occupied or administered territory; set `power`),
  `indigenous` (indigenous nation or confederacy), `disputed` (contested area),
  `other`.
- `tier 0` is the base layer: areas are exclusive. A tier-0 `add` carves its area
  out of every other tier-0 record alive in the same years unless `carve: false`.
- `tier 1` is an overlay drawn hatched on top, never carving: indigenous
  territories inside colonial claims, disputed or occupied areas, approximate
  extents.

**Precision.** `exact` when the boundary follows sources or admin units closely;
`approximate` when it is an indicative extent (drawn dashed, labelled
"approximate extent").

**Wikidata ids.** Never write a QID from memory — look every one up
(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q…&props=labels|descriptions&languages=en&format=json`
or `action=wbsearchentities`) and check the label and description match. Leave
`wikidata` out when unsure.

**Sources.** Every active fix needs at least one source a reader can open:
scholarly works, government or treaty texts, national/tribal nation sources,
reputable encyclopedias (Britannica), Wikipedia articles (acceptable, but prefer
the sources they cite). Never invent a fact, a date or a boundary. When sources
disagree, say so in `reason` and pick the mainstream reading.

## 4. Override files

```
overrides/
  schema.json                     JSON Schema (the contract)
  historical/<region>.json        fixes for 1700–1945  (kind "historical")
  early/<macro-region>.json       fixes before 1700    (kind "early")
  modern/<group>.json             unit timelines 1946–present (kind "modern")
```

Validate after every edit:

```bash
npm run data:reference                                   # once: builds .cache/reference
node packages/borders/pipeline/tools/validate-overrides.mjs --file packages/borders/overrides/historical/caribbean.json
npm run data:validate                                    # all files (CI runs this)
```

Reference lists for codes and pids (generated into `.cache/reference/`):
`ne-admin0.json` (ADM0_A3 codes, audit region), `ne-admin1.json` (adm1_code /
iso_3166_2), `ne-disputed.json` (BRK_A3), `cliopatria-inventory.json` and
`inventory/<region>.json` (every Cliopatria record with pid, years, point,
region), `frames.json` (Cliopatria change years).

### 4.1 Entries (historical and early files)

```jsonc
{
  "id": "h-northern-america-0012",          // unique, stable, prefixed by file
  "op": "add",                               // add | subtract | assign | update | delete | note
  "years": [1794, 1838],                     // inclusive; historical files 1700–1945, early files ≤ 1699
  "geometry": { "type": "polygon", "rings": [[[-85.6,35.0], [-83.1,35.2], [-83.0,34.0], [-85.5,34.2], [-85.6,35.0]]] },
  "set": { "pid": "ovr:cherokee-nation", "name": "Cherokee Nation", "altNames": ["Tsalagi"], "kind": "indigenous",
           "tier": 1, "precision": "approximate", "wikipedia": "Cherokee Nation (1794–1907)" },
  "reason": "Cliopatria has no Cherokee polity. Cherokee territory in the southern Appalachians before Removal (1838), reduced by cessions; extent after the 1819 treaty boundary.",
  "sources": [{ "title": "Royce, Indian Land Cessions in the United States (1899), Cherokee cessions", "url": "https://www.loc.gov/item/13023487/" }],
  "confidence": "medium", "status": "active",
  "author": "agent:audit-historical-northern-america", "date": "2026-10-01"
}
```

| op | Needs | Effect |
| --- | --- | --- |
| `add` | `geometry`, `set.pid`, `set.name`, `set.kind` | New record alive in `years`. Tier 0 carves its area from every other tier-0 record, its own pid's included, and re-draws the pid there (unless `carve:false`; a tier-1 or `carve:false` add over its own pid's tier-0 records is an error, §6.3). Extending an existing polity's life = `add` with `geometry: {type:"record", pid, year}`. |
| `subtract` | `target`, `geometry` | Removes the area from the target's records alive in `years` (ghost territories). |
| `assign` | `target`, `geometry` | Gives the area to the target in `years`, removing it from every other tier-0 record then. Applied **after** automatic island/coast assignment, so it always wins. |
| `update` | `target`, `set` | Changes attributes (name, kind, power, wikidata, …) of the target in `years`, splitting records at the range ends. |
| `delete` | `target` | Removes the target's records (or the part of their life inside `years`). |
| `note` | — | Documentation only: editorial decisions, verified-correct items, known gaps. |

`status`: `active` (applied), `proposed` (documented, not applied — needs a
reviewer), `known-gap` (missing item we cannot draw yet; describe it), `rejected`
(kept for the record).

Application order inside the build: delete → update → subtract → add → clip to
land → automatic islands/coast fill → assign.

### 4.2 Geometry specs

| type | Example | Notes |
| --- | --- | --- |
| `admin0` | `{"type":"admin0","codes":["TON"]}` | Natural Earth admin-0 units (ADM0_A3) |
| `admin1` | `{"type":"admin1","codes":["US-HI"]}` | admin-1 by `iso_3166_2` or `adm1_code` |
| `polygon` | `{"type":"polygon","rings":[[[lon,lat],…]]}` | Hand-authored; may run into the sea (clipped to land). `polygons` for several. Close every ring. |
| `islands` | `{"type":"islands","points":[[-2.13,49.21]],"names":["Jersey"]}` | Whole Natural Earth land parts containing the points |
| `ne-disputed` | `{"type":"ne-disputed","codes":["B89"]}` | Natural Earth disputed areas |
| `record` | `{"type":"record","pid":"clio:new-france","year":1750}` | Geometry of an existing record alive in that year |
| `union` / `intersection` | `{"type":"union","parts":[…]}` | |
| `difference` | `{"type":"difference","base":{…},"minus":[{…}]}` | |

Hand-authored polygons: follow the boundary the sources describe (rivers, ridges,
treaty lines, coasts); use enough vertices to follow it at about 10–25 km; do not
fake precision; mark `precision: "approximate"` unless the sources are exact.

### 4.3 Modern unit timelines (1946 → present)

Every Natural Earth admin-0 unit (ADM0_A3) gets exactly one `units[]` entry in one
modern file, saying who held it each year:

```jsonc
{
  "unit": "DEU",
  "timeline": [
    { "years": [1990, "present"], "state": { "pid": "ne:deu", "name": "Germany", "kind": "state", "wikidata": "Q183" } }
  ],
  "subunits": [
    { "id": "west-germany", "label": "West German Länder",
      "geometry": { "type": "admin1", "codes": ["DE-BW", "DE-BY", "DE-HB", "DE-HH", "DE-HE", "DE-NI", "DE-NW", "DE-RP", "DE-SH"] },
      "timeline": [
        { "years": [1946, 1948], "state": { "pid": "ovr:allied-occupied-germany", "name": "Allied-occupied Germany", "kind": "dependency", "wikidata": "Q2415901" } },
        { "years": [1949, 1989], "state": { "pid": "ovr:west-germany", "name": "West Germany", "kind": "state", "wikidata": "Q713750" } } ] },
    { "id": "saar-protectorate", "geometry": { "type": "admin1", "codes": ["DE-SL"] },
      "timeline": [ { "years": [1947, 1956], "state": { "pid": "ovr:saar-protectorate", "name": "Saar Protectorate", "kind": "dependency", "power": "ne:fra", "wikidata": "Q310293" } } ] }
    // ABBREVIATED EXAMPLE: the real DEU unit also needs East German Länder, West and
    // East Berlin (custom polygons) and the Saarland's West German years (1957–1989).
  ],
  "sources": [{ "title": "German reunification", "url": "https://en.wikipedia.org/wiki/German_reunification" }]
}
```

Rules: in each year, a subunit with a matching period takes its area; the rest of
the unit goes to the unit's own timeline period for that year (which must then
exist). A subunit without a period for a year falls back to the unit. Gaps or
overlaps in a timeline are errors. Later subunits win where subunits overlap.
Tier-1 `overlays[]` mark disputed/occupied areas without changing the partition
(`set.kind: "disputed"`, `controller`, `claimants`).

### 4.4 Generated override files (`auto-*.json`)

Written by the fact-check toolkit (`pipeline/factcheck/`, see the root AGENTS.md
§9); curated files always win over them.

- `historical|early/auto-wikidata.json` — `check_cliopatria.py` checks every
  Cliopatria Wikidata id for type, name, dates and reuse. Dates "disagree" when
  |Δ| > max(25 y, 10 % of the span), with slack for century-precision dates.
  `active` entries only change `set.wikidata` (redirect targets, unique
  replacements); everything else is a `proposed` note.
- `historical|early/auto-gaps.json` — `coverage_gaps.py`: `known-gap` notes
  (never applied) for Wikidata polities that no Cliopatria polygon contains under
  a matching id or name, ranked by sitelinks × duration × location; cutoff and
  weights in `factcheck/config.json`. This is the to-do list for future editors.
- `modern/auto-wikidata.json` — `modern_autogen.py`: medium/low-confidence unit
  timelines for every admin-0 unit no curated modern file covers. Names, pids and
  powers come only from Wikidata and Natural Earth (never from Cliopatria, which
  is unreliable after 1945); empires, periods, untyped or obscure items never name
  a unit; one canonical state object per pid per year (curated files > shared-pid
  table > the pid's own unit > most-used); a `clio:` pid is an error. **Rerun it after
  adding or removing a unit in a curated modern file** (otherwise the validator
  reports a duplicate unit).
- Don't hand-edit generated files. To review an entry set `verifiedBy`, `review`
  or `status` (`check_cliopatria.py` keeps reviewed entries on rerun); to change
  data, move the entry into a curated file.
- Wikidata rules for tools and people: verify every class QID against its English
  label (`Q1371849` is "filmography", not a polity class); entity JSON dates have
  no year 0 but query-service dates do; stay at or below 5 requests/s (search 1/s).
- Tile-QA thresholds: `factcheck/config.json` → `tileQa.thresholds` (a
  `"factcheck"` object in `pipeline/config.json` can override them).

### 4.5 Editorial policy

- **Control, not claims, in tier 0 after 1945.** The modern layer shows de facto
  control at year end; internationally disputed or occupied areas also get a
  tier-1 `disputed` overlay naming the controller and the claimants (Crimea,
  Kashmir, Western Sahara, Northern Cyprus, Golan, Abkhazia, South Ossetia,
  Transnistria, Somaliland, Taiwan's status, etc.).
- **Before 1946 tier 0 follows Cliopatria's polity footprints** (including
  colonial claims), corrected by overrides. Indigenous nations and confederacies
  inside claimed land are tier-1 overlays, so neither layer is erased.
- **Indigenous peoples.** Represent nations and confederacies whose territories
  sources describe, with the names they use for themselves where common in
  English (`altNames` for others), approximate extents, and changes at major
  treaty, cession or removal points. Where hundreds of peoples lived without
  sources giving individual extents (e.g. Aboriginal Australia, much of
  Amazonia), add one documented regional overlay or a `known-gap` note — never
  invented boundaries.
- **Granularity.** Polities of roughly 1,000 km² or more, plus every sovereign
  microstate (Monaco, Vatican, San Marino, Liechtenstein, Andorra, Malta…).
  Where Cliopatria lumps hundreds of units (e.g. Holy Roman Empire estates,
  Indian princely states), document it as `known-gap` unless a correct open
  geometry exists.
- **Antarctica** is land with no polity; territorial claims are not drawn
  (a `note` entry records this). In modern timelines give such units a period
  with `state: { "pid": "ovr:unclaimed", "name": "", "kind": "unclaimed" }`.
- **Names** are the period's English names ("Gold Coast", "Ceylon", "Zaire"),
  with renames as separate timeline periods of the same pid.

## 5. Override catalog

The list below is generated from `overrides/` by `npm run data:catalog`. Do not
edit it by hand.

<!-- overrides:start -->
_Generated by `npm run data:catalog` from `overrides/` — do not edit by hand. 11 file(s), 2263 entries, 258 modern unit(s), 36 overlay(s). **Full catalog** (every entry, unit and overlay with its sources, and the known gaps): [overrides/CATALOG.md](overrides/CATALOG.md)._

### Summary

| File | Op | active | proposed | known-gap | rejected | total |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| historical/auto-gaps.json | note |  |  | 420 |  | 420 |
| historical/auto-wikidata.json | update | 4 |  |  |  | 4 |
| historical/auto-wikidata.json | note |  | 249 |  |  | 249 |
| historical/curated-fixes.json | add | 17 |  |  |  | 17 |
| historical/curated-fixes.json | subtract | 1 |  |  |  | 1 |
| historical/curated-fixes.json | assign | 12 |  |  |  | 12 |
| historical/curated-fixes.json | update | 12 |  |  |  | 12 |
| historical/curated-fixes.json | note | 1 |  | 2 |  | 3 |
| historical/northern-america-indigenous.json | add | 57 |  |  |  | 57 |
| historical/northern-america-indigenous.json | subtract | 1 | 1 |  |  | 2 |
| historical/northern-america-indigenous.json | assign | 3 |  |  |  | 3 |
| historical/northern-america-indigenous.json | update | 1 |  |  |  | 1 |
| historical/southern-asia.json | add | 25 |  |  |  | 25 |
| historical/southern-asia.json | subtract | 4 |  |  |  | 4 |
| historical/southern-asia.json | assign | 10 |  |  |  | 10 |
| historical/southern-asia.json | update | 3 |  |  |  | 3 |
| historical/southern-asia.json | note | 2 |  | 2 |  | 4 |
| early/auto-gaps.json | note |  |  | 487 |  | 487 |
| early/auto-wikidata.json | update | 17 |  |  |  | 17 |
| early/auto-wikidata.json | note |  | 750 |  |  | 750 |
| modern/auto-wikidata.json | note |  | 111 |  |  | 111 |
| modern/auto-wikidata.json | units |  |  |  |  | 185 |
| modern/caribbean-south-america.json | note | 20 |  | 15 |  | 35 |
| modern/caribbean-south-america.json | units |  |  |  |  | 43 |
| modern/caribbean-south-america.json | overlays |  |  |  |  | 13 |
| modern/europe-east-central-asia.json | note | 12 |  | 5 |  | 17 |
| modern/europe-east-central-asia.json | units |  |  |  |  | 16 |
| modern/europe-east-central-asia.json | overlays |  |  |  |  | 13 |
| modern/north-central-america.json | note | 9 | 1 | 9 |  | 19 |
| modern/north-central-america.json | units |  |  |  |  | 14 |
| modern/north-central-america.json | overlays |  |  |  |  | 10 |
| **all files** | entries | **211** | **1112** | **940** | **0** | **2263** |

### Curated files

- `historical/curated-fixes.json` — 45 entries (43 active, 2 known gaps). Sourced fixes for concrete errors found in the built 1700-1945 data (Cliopatria) by integration review: polities on the wrong islands or continents (Channel …
- `historical/northern-america-indigenous.json` — 63 entries (62 active, 1 proposed). Indigenous nations of North America north of Mexico, 1700-1945 (tier-1 "indigenous" overlays plus fixes to the Cliopatria Haudenosaunee record).
- `historical/southern-asia.json` — 46 entries (44 active, 2 known gaps). Historical audit 1700-1945 of Southern Asia (Natural Earth subregion: Afghanistan, Bangladesh, Bhutan, India, Iran, Maldives, Nepal, Pakistan, Sri Lanka).
- `modern/caribbean-south-america.json` — 35 entries (20 active, 15 known gaps), 43 unit(s), 13 overlay(s). Modern unit timelines 1946–present for the 43 Natural Earth admin-0 units of audit regions caribbean and south-america (ABW AIA ATG BHS BJN BLM BRB CUB CUW CYM …
- `modern/europe-east-central-asia.json` — 17 entries (12 active, 5 known gaps), 16 unit(s), 13 overlay(s). Modern unit timelines 1946–present for the 16 Natural Earth admin-0 units of audit regions eastern-europe, russia and central-asia (BGR BLR CZE HUN MDA POL ROU SVK UKR RUS KAZ KAB KGZ TJK TKM UZB).
- `modern/north-central-america.json` — 19 entries (9 active, 1 proposed, 9 known gaps), 14 unit(s), 10 overlay(s). Modern unit timelines 1946–present for the Natural Earth admin-0 units of the audit regions northern-america and central-america: BLZ, CLP, CRI, GTM, HND, MEX, …

Generated by `pipeline/factcheck/` (never hand-edit; §4.5): `historical/auto-gaps.json`, `historical/auto-wikidata.json`, `early/auto-gaps.json`, `early/auto-wikidata.json`, `modern/auto-wikidata.json`.

Regenerate with `npm run data:catalog` (also the last step of `npm run data:build`); `node packages/borders/pipeline/tools/catalog.mjs --check` fails when this summary or overrides/CATALOG.md is out of date.
<!-- overrides:end -->

## 6. Pipeline

Shared thresholds live in `pipeline/config.json` (Node and Python read it; change
them there, never inline, and note the change here). Python runs in `.cache/venv`
through `node packages/borders/pipeline/tools/py.mjs <script.py> …`.

### 6.1 Steps and commands

```sh
npm run data:build   # node packages/borders/pipeline/build.mjs [--only=a,b] [--from=step] [--skip=a,b]
                     #   [--dev] [--force] [--refetch] [--verbose]
```

| Step | Does | Writes |
| --- | --- | --- |
| `fetch` | Checks the sha256 of every pinned source (`config.sources`), downloads missing files; `--refetch` replaces mismatches (default: fail). | `.cache/sources/` |
| `reference` | `tools/reference.py` (code lists for editors; skipped when up to date, `--force` reruns). Alone: `npm run data:reference`. | `.cache/reference/` |
| `validate` | `tools/validate-overrides.mjs` (`npm run data:validate`, 0.3 s), then the override engine's dry run (§6.3, ≈ 26 s): its errors would fail the geometry QA `overrides` gate 13 minutes later. `--dev`: a validator failure only warns, no dry run. | `.cache/build/override-dry-run.json` |
| `geometry` | `py/run_geometry.py` (§6.2). `--dev`: `tools/dev-features.mjs` (Cliopatria as is, no overrides, no clipping). | `.cache/build/final/` (`--dev`: `.cache/build/dev/`) |
| `package` | `steps/package.mjs` (§6.4). | `packages/borders/data/` (`--dev`: dataset `alexs-atlas-borders-dev`) |
| `catalog` | `tools/catalog.mjs` (`npm run data:catalog`; `--check` exits 1 when stale, `--stdout` prints). | `overrides/CATALOG.md` + the summary in §5 |

It prints timings per step and stops at the first failure. Re-package without
recomputing geometry: `npm run data:build -- --from=package`. Standalone runs:

```sh
node packages/borders/pipeline/tools/py.mjs run_geometry.py [--steps normalise,…,qa] [--workers N]
     [--years 1790..1810] [--out DIR] [--no-overrides]          # --years = development subset
node packages/borders/pipeline/steps/package.mjs [--dev] [--input=<dir>] [--out=<dir>]
     [--workers=<n>] [--keep-temp] [--verbose] [--allow-failed-qa]
```

Inputs/outputs: geometry → `<dir>/{features.geojsonl, frames.json, polities.json,
qa-report.json, qa-summary.md}`; package → `manifest.json` (written last),
`chunks/<lod>/<chunkId>.<hash8>.topo.json`, `base/{land,lakes}-<lod>.<hash8>.topo.json`,
`polities.<hash8>.json`, `ATTRIBUTION.md`, `LICENSE.md`, `sources.json`,
`qa-report.json`. A real-data build verified but not yet published waits in
`.cache/build/package/staging` (serve it to the site with `ALEXS_ATLAS_DATA`, see
apps/site/AGENTS.md).

### 6.2 Geometry steps (`py/run_geometry.py`)

Each step caches under `.cache/build/geom/<tag>/` (`full`, or `y<A>_<B>` for a
`--years` subset, which drops records outside the range and truncates the rest); a
step left out of `--steps` reuses its cache.

`normalise` (Cliopatria leaf polities → records) → `overrides` (delete, update,
subtract, add + blockers for land the ops removed) → `clip` (historical records to
NE 10m land) → `modern` (unit timelines → records, overlays, clipped to land) →
`frames` (coast step per frame: islands and coastal gaps assigned by the
`config.coast` rules, then `assign` entries; identical consecutive frames merged) →
`attributes` (colour slots with `config.palette`, ids, polity index) → `qa` (§6.5;
exit 1 on a hard failure). Unclaimed land is emitted as one feature per connected
polygon.

### 6.3 Override engine (`py/overrides.py`, `py/modern.py`)

`load_overrides` reads `overrides/{early,historical,modern}/*.json` (files sorted;
the first definition of a modern unit wins, a duplicate is an error);
`change_years` gives the years historical frames must start at;
`resolve_geometry` handles every geometry spec on the 1e-6° grid shared with
`geom.py` (`geometry.gridDeg`); `apply_record_ops` applies historical + early
entries in the order delete → update → subtract → add (each in file order, splitting
target records at the range ends); `apply_assign_ops` applies `assign` per frame
after island/coast assignment; `build_modern` assembles the modern layer. Log
entries are `{id, file, op, status, detail, rids}` with status `applied`, `stale`,
`skipped`, `error` (and `unaudited` for fallback units); proposed, known-gap and
rejected entries and notes are `skipped`.

Rules editors should know:

- **add defaults:** tier 1 for kind `indigenous`/`disputed`, else tier 0;
  precision `approximate` when any part is a hand-drawn polygon; power = pid,
  src `override`, `prov.overrides = [id]`.
- **Carving:** a tier-0 add takes its area out of every other tier-0 record alive
  in its years, its own pid's records included, and re-draws the polity there (log:
  "re-draws <pid> over its own record(s)"). A tier-1 or `carve: false` add whose pid
  already has a tier-0 record there overlapping it by more than
  `overrides.overlapNoiseKm2` (0.5 km²) is an error (delete first; disjoint
  exclaves are fine).
- **`record` geometry** in the add phase is read from the records as they stood
  before the first add, plus records added since; carving by other adds never
  changes it. An add that refers to a pid created by another add runs after it.
- **Leftovers:** rims thinner than `overrides.rimWidthM` (50 m mean width,
  2·area/perimeter) along the edge of an area taken out go with that area (a
  subtract removes them; an add or assign gives them to the taker); a record piece
  left with less than `overrides.landNoiseKm2` (0.01 km²) of land is dropped.
- **Stale:** delete/update/subtract on a pid with no record in those years, or a
  subtract whose area misses the target. **assign:** the area (clipped to land) goes
  to the target's largest tier-0 record in the frame; a target not alive is stale,
  one with only tier-1 records an error.
- **Modern units:** per year, subunits with a period take subunit ∩ unit (later
  subunits win), the rest goes to the unit's own period (none = error); slivers up
  to max(`overrides.modernSliverKm2` 1 km², `modernSliverShare` 1e-6 × unit area)
  join the neighbour. Records are dissolved per pid and merged across unchanged
  years; several units giving one pid must agree on name, kind, power and wikidata
  (the validator reports conflicts as errors). Overlays are tier 1, land-clipped,
  pid `ovr:<overlay id>` by default.
- **Fallback:** a unit with no timeline in any file is drawn as its NE sovereign for
  1946–present, logged `unaudited`, pid `ne:<home ADM0_A3>` (NE 'X1' codes map to the
  unit whose ADMIN equals SOVEREIGNT: FR1 → `ne:fra`).

```sh
node packages/borders/pipeline/tools/py.mjs overrides.py --dry-run                        # all files, exit 1 on any error
node packages/borders/pipeline/tools/py.mjs overrides.py --dry-run --file southern-asia.json -v
node packages/borders/pipeline/tools/py.mjs overrides.py --dry-run --skip-modern --log .cache/override-log.json
node packages/borders/pipeline/tools/py.mjs tests/test_overrides.py [-k name]             # engine tests (≈ 17 s)
```

The dry run applies every file to the raw Cliopatria reference records (`npm run
data:reference`) and builds the modern layer; `--file` only filters the report.

### 6.4 Packaging (`steps/package.mjs`)

1. Input slivers out: polygon parts under 100 m² or with a mean width under 2 m
   (`qa-report.packaging.slivers`).
2. Unclaimed land split into pieces; identical records of touching years merged;
   unclaimed pieces with the same lifetime regrouped into one record
   (`lib/dedupe.mjs`, lossless).
3. Frames recomputed from the records; chunks planned greedily at frame
   boundaries on the measured gzip size of the l0 file (`chunks.targetGzipBytesL0`
   350 kB, `chunks.maxYears` 1000), with a forced break at 1946.
4. Per chunk, `lib/noding.mjs cleanRings`: vertices closer than
   `topology.snapDegrees` (3e-5° ≈ 3.3 m) merge, a vertex within
   `topology.nodeDegrees` (1e-4° ≈ 11 m) of another ring's segment is inserted into it,
   repeated vertices and zero-width spikes go (3.3 m noding left up to 165 km of
   unshared border per frame, 22 m made a 216 km² overlap, 11 m neither).
5. Per chunk and LOD (`config.lods`: l0 5 km / quantization 1e5 / from zoom −2, l1
   1 km / 1e6 / z3, l2 250 m / 1e6 / z5) mapshaper builds one topology and simplifies
   it with spherical Douglas–Peucker + keep-shapes per polygon part: interval =
   min(toleranceM, max(5 m, √(a/parts)/50)) with parts counted under 5,000 km²
   (unclaimed land: the plain tolerance); a shared arc takes its users' smallest
   interval, so microstates (`config.microstates`) stay protected.
6. `lib/topo.mjs`: duplicate grid points removed, arcs made identical merged,
   zero-width corridors split, each hole of a split polygon given to its shell (holes
   moved outside dropped), zero-area rings dropped (a record with nothing left gets a
   grid stand-in), isolated islets of large polities under (2 × toleranceM)² dropped,
   unclaimed land that collapses on a LOD's grid left out; RFC 7946 winding.
7. Verification per chunk/LOD/frame (`lib/verify.mjs` → `qa-report.packaging.alignment`):
   `overlapKmMax`, `exteriorKm` vs `coastKm`, `offCoastKmMax` (exterior arcs off the
   unsimplified coastline = gaps/slivers), `mergedArcs`, `isletsDropped`,
   `collapsedUnclaimed`, plus small features, stand-ins, noding and slivers.
8. Output validated (every year in exactly one chunk, unique ids, files present,
   names `[a-z0-9._-]`), stale hashed files deleted, manifest written last.
   Deterministic: the same input gives byte-identical files.

### 6.5 QA gates and checks

| Gate (geometry `py/qa.py`, hard) | Threshold (`config.json`) |
| --- | --- |
| `lost` — every record keeps geometry | `qa.lostAllowlist` ({rid: reason}) |
| `partition` — per frame \|polities + unclaimed − land\| / land | `qa.partitionMaxRelDiff` 1e-4 |
| `overlaps` — tier-0 pairs alive in one frame | `qa.overlapMaxKm2` 0.5 km² (the coast step logs source overlaps it resolved above `qa.overlapLogKm2`, 10 km²) |
| `tier1` — overlays on land | `qa.overlapMaxKm2` |
| `microstates` — `ne:<code>` features vs NE admin-0 area | `qa.microstateMaxRelDiff` 1 % |
| `ids`, `years`, `frames`, `overrides` (no entry in error) | — |

The packager refuses to publish to `data/` an input whose geometry QA failed a hard
check (`--out=<dir>` to inspect, `--allow-failed-qa` to override). Reports (not
gates): coverage per audit region and sample year, islands assigned per rule,
largest unclaimed islands (`qa-summary.md`). Tile QA of a built dataset: `npm run
data:tileqa` (pipeline/factcheck). Known limit: the microstate gate holds at l1/l2,
not at l0, where quantization 1e5 moves atoll states and Monaco by 1.2–2.6 %.

### 6.6 Previews and verification

```sh
node packages/borders/pipeline/tools/py.mjs preview.py --file <override file> (--year Y | --entry ID) [--bbox=w,s,e,n]
node packages/borders/pipeline/tools/py.mjs preview_final.py --year 1800 --bbox=-11,49,3,61 [--dir DIR]
node packages/borders/pipeline/steps/qa/frame.mjs --year=Y --lod=l0|l1|l2 (--preset=europe|aegean|…|archipelagos | --bbox=w,s,e,n) [--data=<dir>]
node packages/borders/pipeline/tools/py.mjs packages/borders/pipeline/steps/qa/verify_built.py [--data DIR]
     [--years 1500,1700,1800,1900,1950,2000,2026] [--lods l0,l1] [--previews british-isles:1800,aegean:1700]
     [--preview-lod l1] [--out .cache/build/verify] [--max-gap-km 1] [--no-islands]
```

`preview.py` draws override geometry over NE land and raw Cliopatria (before a
build); `preview_final.py` the geometry output; `frame.mjs` a year decoded from a
built dataset like a client (fills by colour slot, unclaimed grey, white borders,
black coast, cyan unsimplified NE coastline; PNGs in `.cache/build/package/qa/`);
`verify_built.py` decodes chunks like a client and reports coverage against NE land,
exterior arcs off the coastline (gaps/slivers), arcs used twice (overlaps), invalid
or thin parts and islands by owner, exiting 1 above `--max-gap-km`.

### 6.7 Timings and sizes (2026-10-02, 14 workers)

- Geometry, real data: 753 s (normalise 15, overrides 11, clip 52, modern 24,
  frames 608, attributes 36, qa 8 s); 30,437 features (13,265 polity, 17,051
  unclaimed, 121 overlays), 1,765 polities, 591 frames, 60 M vertices.
  Packaging 348 s; a full `npm run data:build` ≈ 19 min. Dev build ≈ 30 s.
- Real dataset (staging): 43 chunks, 589 frames, 14,774 records; gzip per chunk
  l0 130–341 kB (12.5 MB in all), l1 0.56–0.79 MB (31.3 MB), l2 1.03–1.25 MB
  (51.0 MB); base land l0/l1/l2 135/568/1,020 kB, lakes 17/104/325 kB; 302 MB raw.
- Dev dataset: 13 chunks, 483 frames, 10,747 records, 49.6 MB raw.

## 7. Query API (`src/`)

```ts
import { createBorders, formatYear, parseYear, yearFilter, lodForZoom, attributionHtml } from '@alexs-atlas/borders';
const borders = createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' });
const fc = await borders.bordersAt(1453, { lod: 'l1' });   // FeatureCollection<Polygon | MultiPolygon, PolityProps>
```

- `createBorders(source, { fetch?, cacheChunks?, cacheFrames? })`, `source` =
  `{ manifestUrl }` or `{ manifest, baseUrl }`; `loadManifest(url, { fetch?, signal? })`;
  `validateManifest(json)` (throws on an invalid manifest).
- Client: `ready()`, `frameOf(year)` (`{ from, to }`, ±Infinity outside the
  coverage), `bordersAt`, `labelsAt` (one point per pid, at its largest tier-0
  record), `linesAt` (`kind: 'border'` = arcs between two different features,
  unclaimed land included; `'coast'` = arcs used by exactly one feature, internal
  seams excluded; frames of one chunk with the same coastline share one coast Feature
  object), `base('land' | 'lakes', lod)`, `polities()`, `polity(pid)`,
  `search(q, { limit?, year? })` (diacritic-insensitive, typo-tolerant; hits are
  `PolityInfo & { pid, matched? }`, `matched` = the alt name that matched),
  `prefetch(year, lod?)`. Every query takes `{ lod?, signal? }`.
- Helpers: `formatYear`, `parseYear` ("500 BC", "-500", "AD 33", "1453"), `addYears`,
  `clampYear`, `toAstronomical`, `fromAstronomical`, `isValidYear`, `yearFilter`,
  `lodForZoom(manifest, zoom)`, `attributionHtml(manifest)`, `normalizeText`,
  `FetchError`.
- Behaviour: isomorphic ESM, no DOM, no MapLibre; in-flight requests de-duplicated,
  `AbortSignal` honoured, chunks kept in an LRU per LOD, decoded GeoJSON memoised per
  frame. Results are shared: treat them as read-only.
- **Node:** `@alexs-atlas/borders/node` exports `fileFetch`, a `fetch` that reads
  `file:` URLs and plain paths from disk (missing files answer 404; http(s) goes to
  the global fetch): `createBorders({ manifestUrl: 'packages/borders/data/manifest.json' }, { fetch: fileFetch })`.
  Kept out of the main entry so browser bundles never see a `node:` import.
