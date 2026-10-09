<!--
  Imported from the Alex's Atlas repository (alcaholex/chronoatlas, commit 0a9ce44),
  whose modules now live here in packages/. Where packages/borders/AGENTS.md or
  packages/globe/AGENTS.md say "root AGENTS.md", they mean this file. Commands
  below that start with `npm run` (check, data:*, …) run from the strhistory root.
  "apps/site" is the Alex's Atlas reference site, which was not imported: its
  globe UI is being rebuilt as strhistory's /globe (src/features/globe/). The
  strhistory-wide rules (content accuracy, access, deployment) are in /AGENTS.md.
-->

# AGENTS.md — Alex’s Atlas

The single source of truth for **what this project is, how it is built, the
contracts between its modules, and how other projects adopt it**. Written for
people and coding agents alike. `CLAUDE.md` only points here. Task status lives
in [todo.md](todo.md). Each package also has its own self-contained AGENTS.md
(so it can be copied into another project on its own):
[packages/borders/AGENTS.md](packages/borders/AGENTS.md) (dataset, pipeline,
**override editing guide and catalog**), [packages/globe/AGENTS.md](packages/globe/AGENTS.md)
(globe + timeline component).

---

## 1. Purpose

A website — inspired by [Globe of History](https://www.globeofhistory.com/) —
with a 3D globe and a timeline along the bottom. Instead of event pins it shows
**country, colony and indigenous-nation borders throughout history**,
3400 BCE → present, lined up with real coastlines and islands.

The project is deliberately **modular**. Other projects (and the agents working
in them — first of all the sibling Astro site `../strhistory`) take only what
they need:

| Module | Package | Another project takes… |
| --- | --- | --- |
| Borders dataset + pipeline + query API | `@alexs-atlas/borders` (`packages/borders`) | static files (`data/`) and `bordersAt(year)` — works in the browser, at build time and in Node |
| Globe + timeline UI | `@alexs-atlas/globe` (`packages/globe`) | a framework-agnostic `ChronoGlobe`, or just `addBorderLayers(map)` for an existing MapLibre map, a `Timeline` |
| Reference site | `@alexs-atlas/site` (`apps/site`) | an example of wiring everything together (Vite, no framework) |

## 2. Hard constraints

### 2.1 No proprietary map data

Only the redistributable datasets of §6 are used. Never copy, scrape, export,
decode the caches of, or trace (automatically or by hand) proprietary
historical-border maps or datasets, such as the proprietary sources rejected in
§6. Open sources rejected there for their licence stay out of published geometry
(§2.2).

### 2.2 Only redistributable data ships

Every dataset in a built artifact must allow publication on a public website, and
its attribution must appear in `manifest.json`, `data/ATTRIBUTION.md` and the
site's credits. A build-time licence gate refuses NC (CShapes), SA (Chronas,
OSM-derived geometry baked into polygons) and GPL (historical-basemaps) inputs.
Verified licences: §6.

### 2.3 Privacy: zero third-party requests

Pages built from these modules make **no third-party requests** at all: data
and fonts are same-origin, and styles never reference an external
URL. (The sibling site serves high-school students.)

### 2.4 Accuracy

This is an educational map. Never invent a polity, a date, a boundary or a
Wikidata id. Every manual fix carries sources (packages/borders/AGENTS.md §3–4).
Approximate extents are marked as such in data (`precision`) and in the UI.

## 3. Architecture

```
 pinned sources (.cache/sources)                 overrides/ (sourced manual fixes)
  Cliopatria v0.2.0  Natural Earth 5.1.2          historical/ early/ modern/
          │                │                              │
          ▼                ▼                              ▼
 ┌──────────────────────── packages/borders/pipeline ─────────────────────────┐
 │ historical layer (≤1945): normalise leaf polities → apply overrides →      │
 │   clip to NE 10m land → assign islands + coastal gaps → assign overrides   │
 │ modern layer (1946→present): NE admin units + unit timelines → partition   │
 │ both: validate → attributes (area, inner point, colour slot) → LODs →      │
 │   time chunks (TopoJSON) + manifest + polities index + QA report           │
 └────────────────────────────────────┬────────────────────────────────────────┘
                                      ▼
                  packages/borders/data/  (static files, copy to any site)
                                      ▼
   @alexs-atlas/borders  createBorders().bordersAt(year) → GeoJSON (any runtime)
                                      ▼
   @alexs-atlas/globe   addBorderLayers(map) / ChronoGlobe / Timeline
                                      ▼
   apps/site            full-bleed globe, timeline bar, search + polity list, key, About
```

Key decisions (with evidence in the research notes summarised in §11):

- **Clipped data, shared topology.** Polity polygons are clipped to Natural Earth
  10m land so data consumers get correct coastlines too; island and coastal-gap
  assignment fixes Cliopatria's coarse (≈24 km vertex spacing) coasts.
- **Era-chunked TopoJSON** per level of detail (l0 ≈ 5 km, l1 ≈ 1 km, l2 ≈ 250 m
  tolerance, spherical Douglas–Peucker, keep-shapes, microstates protected; gzip
  per chunk l0 130–340 kB, l1 0.56–0.79 MB, l2 1.0–1.25 MB). The client decodes
  only the features alive in the requested year and hands MapLibre a small GeoJSON
  (a year change renders in ≈ 100–300 ms on a GPU with the chunk loaded, ≈ 1.5–2×
  that on SwiftShader; packages/globe/AGENTS.md §7).
- **Two layers with a hard cut-over at 1946**: Cliopatria is weakest after 1945
  (ghost colonies, missing microstates, wrong names); Natural Earth units plus a
  fact-checked timeline per unit give exact modern borders.
- **MapLibre GL JS 6** globe projection (no API keys, no tiles server); atmosphere
  via `sky`; stars at infinity painted on a canvas under the map, turning with the
  camera.

## 4. Repository map and ownership

```
AGENTS.md  CLAUDE.md  todo.md  package.json (npm workspaces)
packages/
  borders/                    @alexs-atlas/borders
    AGENTS.md                 dataset contract, override guide, catalog summary, pipeline, query API
    src/                      query API (TypeScript, isomorphic); node.ts = @alexs-atlas/borders/node
    pipeline/
      build.mjs, steps/       the pipeline (Node + mapshaper; Python/shapely for coast work);
                              steps/qa/ = frame previews and verify_built.py
      py/                     Python geometry steps + override engine, py/tests/, requirements.txt (venv .cache/venv)
      tools/                  reference.py, validate-overrides.mjs, catalog.mjs, dev-features.mjs, py.mjs
      factcheck/              deterministic fact-check toolkit (Wikidata, coverage gaps, tile QA) → auto-*.json
      tests/                  Node pipeline tests (*.test.mjs, run by vitest)
    overrides/                schema.json + historical/ early/ modern/  ← editors work here
    research/                 research notes kept with the data work (native-nations/: plan, licence checks)
      CATALOG.md              full override catalog (generated by npm run data:catalog)
    data/                     BUILT dataset (generated)
  globe/                      @alexs-atlas/globe
    AGENTS.md                 component contract and tested integration recipes (§8)
    src/                      ChronoGlobe, addBorderLayers, timeline/, style.css
    examples/, scripts/       recipe pages; scripts/recipes.mjs runs them, scripts/screenshots.mjs, scripts/browser.mjs
apps/
  site/                       @alexs-atlas/site (Vite, vanilla TypeScript) — apps/site/AGENTS.md
    src/                      app.ts (composition root), state/url.ts, ui/, styles/
    scripts/                  sync-data.mjs, harness.mjs, e2e.mjs, screenshots.mjs
    public/data/alexs-atlas/  synced copy of the dataset (generated, git-ignored)
.cache/                       git-ignored: sources/, reference/, venv/, build/, screenshots/, wikidata/, factcheck/
```

One task touches one folder. Shared files (this file, `todo.md`, root
`package.json`) are edited by the orchestrator or with care. Dependencies are
installed at the root; do not run `npm install` from parallel agents — ask the
orchestrator (or note it in todo.md).

## 5. Module contracts

### 5.1 Years

`HistYear` = integer, **no year 0**, −1 = 1 BCE, 1 = 1 CE. Ranges are inclusive
`[from, to]`. A change at any date in year Y is shown from year Y (map = borders
at 31 December). URL and UI never offer year 0 (stepping from −1 goes to 1).
Coverage −3400 … present (2026); `manifest.years.cutover = 1946`.

### 5.2 Dataset files (`packages/borders/data/`, served e.g. at `/data/alexs-atlas/`)

```
manifest.json                       entry point (never cached long; everything else is content-hashed)
polities.<hash>.json                polity index for search and lifespans
chunks/<lod>/<chunkId>.<hash>.topo.json
base/land-<lod>.<hash>.topo.json    Natural Earth land for unclaimed land and the coastline
base/lakes-<lod>.<hash>.topo.json   lakes drawn above polities
ATTRIBUTION.md  LICENSE.md  sources.json  qa-report.json
```

All names are lower-case `[a-z0-9._-]`, all files `.json` (compressible by any
static host, no HTTP Range needed).

`manifest.json`:

```ts
interface Manifest {
  schema: 'alexs-atlas.borders/1';
  dataset: string; version: string; built: string;           // ISO time
  years: { convention: 'historical-no-zero'; from: number; to: number; present: number; cutover: number };
  lods: { id: 'l0' | 'l1' | 'l2'; toleranceM: number; minZoom: number }[];   // pick the last with minZoom <= zoom
  chunks: { id: string; from: number; to: number; files: Record<string, string>; bytes: Record<string, number>; records: number }[];
  frames: number[];                  // sorted change years: borders are identical from frames[i] to frames[i+1]-1
  base: { land: Record<string, string>; lakes?: Record<string, string> };
  polities: string;                  // path of the polity index
  palette: { size: number };         // number of colour slots used by `c`
  sources: { id: string; name: string; version: string; url: string; license: string; spdx: string; attribution: string; changes?: string }[];
  attribution: { text: string; html: string };
  stats?: Record<string, unknown>;
}
```

Chunk TopoJSON: one object `polities` (polygons). Feature properties:

```ts
interface PolityProps {
  id: number;            // also Feature.id: positive integer, unique in the dataset (feature-state)
  rid: string;           // record id: `${pid}@${from}`
  pid: string;           // stable polity id (clio:/ne:/ovr:)
  name: string;          // display name for this period
  from: number; to: number;            // inclusive validity of THIS geometry
  kind: 'state' | 'dependency' | 'indigenous' | 'disputed' | 'other' | 'unclaimed';
  tier: 0 | 1;           // 0 base (exclusive areas), 1 hatched overlay
                         // kind 'unclaimed' (pid 'none', name ''): land held by no polity that year
  power: string;         // colour key: controlling polity pid (colonies share their empire's)
  partof: string | null; subjecto: string | null;   // sibling-compatible names
  disputed: boolean;
  precision: 'exact' | 'approximate';
  c: number;             // colour slot 0..palette.size-1, stable per power, adjacency-aware
  a: number;             // area km²
  lx: number; ly: number;  // pole of inaccessibility of the largest part
  src: string;           // source id from manifest.sources ('cliopatria', 'naturalearth', 'override')
}
```

Polity index (`polities.<hash>.json`): `Record<pid, { name; altNames?; kind; spans: [from, to][]; wikidata?; wikipedia?; power?; bbox: [w, s, e, n]; peak?: number; src; note? }>`.

Geometry guarantees: RFC 7946 winding, lon/lat in range, no empty geometries.
**The tier-0 features alive in a year (polities plus `unclaimed`) partition
Natural Earth 10m land exactly** (before simplification; afterwards they share
arcs, so fills, borders and coastline always line up). Tier-1 overlays lie on
land and never carve tier 0.

### 5.3 `@alexs-atlas/borders` (query API)

```ts
loadManifest(url, init?: { fetch?; signal? }): Promise<Manifest>;  validateManifest(json): Manifest
createBorders(opts: { manifestUrl: string } | { manifest: Manifest; baseUrl: string },
              init?: { fetch?: typeof fetch; cacheChunks?: number; cacheFrames?: number }): BordersClient
interface BordersClient {
  ready(): Promise<Manifest>;
  frameOf(year): { from: number; to: number };             // years sharing identical borders
  bordersAt(year, o?: { lod?: string; signal? }): Promise<FeatureCollection<Polygon | MultiPolygon, PolityProps>>;
  linesAt(year, o?): Promise<FeatureCollection<MultiLineString, { kind: 'border' | 'coast' }>>;
      // topojson mesh of the tier-0 features alive in `year`: 'border' = arcs between two
      // different features (frontier with unclaimed land included), 'coast' = arcs used by
      // exactly one feature (a feature's internal seams are neither); frames of one chunk
      // with the same coastline share the identical coast Feature object
  base(name: 'land' | 'lakes', lod): Promise<FeatureCollection>;
  polities(): Promise<Record<string, PolityInfo>>;
  polity(pid): Promise<PolityInfo | undefined>;
  search(q, o?: { limit?; year? }): Promise<(PolityInfo & { pid; matched? })[]>;
      // diacritic-insensitive, typo-tolerant; `matched` = the alt name that matched
  prefetch(year, lod?): void;
}
yearFilter(year): unknown[]             // ['all', ['<=', ['get','from'], y], ['>=', ['get','to'], y]] (plain arrays)
lodForZoom(manifest, zoom): string
attributionHtml(manifest): string
formatYear(y, o?): string               // "500 BCE", "1453"; parseYear("500 BC" | "-500" | "AD 33" | "1453"): number | null
addYears(y, n), clampYear(y, min, max), toAstronomical(y), fromAstronomical(a), isValidYear(y)
```

Isomorphic ESM, no DOM, no MapLibre import, only dependency `topojson-client`.
De-duplicates in-flight requests, honours `AbortSignal`, keeps an LRU of chunks,
memoises the decoded GeoJSON per frame (results are shared and read-only).
`@alexs-atlas/borders/node` adds `fileFetch` (a `fetch` that reads `file:` URLs and
paths from disk) for Node scripts and static builds:
`createBorders({ manifestUrl: 'packages/borders/data/manifest.json' }, { fetch: fileFetch })`.
Details: packages/borders/AGENTS.md (API section).

### 5.4 `@alexs-atlas/globe` (UI)

`maplibre-gl ^6.11.2` is a **peer dependency** (never bundled). No DOM access at
import time. CSS is one file (`@alexs-atlas/globe/style.css`), every class
prefixed `ca-`, theming via `--ca-*` custom properties, no `:root` writes, no
element selectors outside our roots, the component fills its container (never
`position: fixed`). The JS entry imports **no** CSS: the host imports
`maplibre-gl/dist/maplibre-gl.css` and `@alexs-atlas/globe/style.css` (which
includes the timeline styles). Full API: packages/globe/AGENTS.md §3–§6.

```ts
new ChronoGlobe(container, options, callbacks?)
options: {
  data: { manifestUrl } | { manifest, baseUrl } | { client: BordersClient };
  year: number; view?: { center: [lon, lat]; scale?: number };   // scale = 2^(zoom − fitZoom)
  maxZoom?: 7; minScale?: 0.6; hover?: true; tooltip?: true; layerPrefix?: 'ca-';
  palette?: string[] | ((p: PolityProps) => string); theme?: Partial<GlobeTheme>;
  workerUrl?: string;           // maplibre setWorkerUrl; Vite: '…/maplibre-gl-worker.mjs?worker&url'
  padding?: number | { top?; right?; bottom?; left? };   // kept clear by flyToPolity
  attribution?: boolean | string; exposeAs?: string;   // dev handle on window
}
callbacks: { onYearApplied(y), onHover(info | null), onSelect(info | null), onViewChange(v),
             onInteractionEnd(v), onLoadingChange(loading), onFailure(reason, error?) }
methods: map, layers, borders, loadState, whenReady(), setYear(y) (coalesced, latest wins; old
         borders stay until new render), getYear(), setInteracting(bool) (l0 while a timeline
         drag/playback runs), getView(), setView(v, { animate? }),
         flyToPolity(pid, { year?, padding? }): Promise<boolean>, select(pid | null), getSelected(),
         setTheme(partial), zoomBy(d), resetView(), startSpin(), stopSpin(),
         isSpinning, resize(), destroy()
container gets data-ca-state="loading" | "ready" | "failed"

addBorderLayers(map, { borders, year, beforeId?, prefix?, palette?, hover?, theme?, … })
  → { setYear(y): Promise<void>; remove(): void; layerIds: string[]; sourceIds: string[]; … }

new Timeline(container, { min, max, value, present?, stops?, frames?, eras?, highlight?,
                          speed?, speeds?, sweepSeconds?, layout?: 'stacked' | 'bar', step?: number | 'adaptive',
                          yearField?, changeButtons?,
                          onInput?(y), onChange?(y), onPlayChange?(playing) })
  // highlight: { from, to } | { from, to }[] | null
  // layout 'bar': one row of separate controls with a thick track (tick lines inside), themed by --ca-control-*
  → element, getValue(), setValue(y), setHighlight(span | spans | null), setFrames(frames | null),
    play(), pause(), togglePlay(), isPlaying(), getSpeed(), setSpeed(s), stepBy(±1), stepChange(±1),
    resize(), destroy()
createTimeScale(stops: [year, t][]) → { toT(year), toYear(t), … }   // piecewise linear, invertible, no year 0
```

### 5.5 Rendering rules (both `ChronoGlobe` and `addBorderLayers`)

- Style: `projection: { type: 'globe' }`, `renderWorldCopies: false`, north-up
  (no rotate/pitch), `maxZoom` 7, `sky.atmosphere-blend` ≈ 0.5 at z0 fading to 0
  by z7 (never 1 — it washes colours out; the site sets 0, no haze at all). Stars sit
  at infinity on a canvas under MapLibre's (transparent outside the globe): they turn
  with the camera as in a 3D scene and fade out within 1.75 globe radii of the rim
  (packages/globe/AGENTS.md §5.2).
- Picking: points off the globe (space) pick nothing (MapLibre would answer with the
  nearest horizon point).
- Layer order: ocean background → base land (`base/land-<lod>`, only until the
  first frame arrives) → tier-0 fills (polities in opaque colours pre-blended
  with land, `unclaimed` in the land colour, `fill-sort-key: -a`) → border lines
  (`linesAt` kind `border`) → tier-1 hatched fills + dashed outlines → lakes →
  coastline (`linesAt` kind `coast`) → hover/selection outlines.
  Approximate precision draws dashed.
- Fills get one feature per polygon part (same `id`): MapLibre classifies a feature's
  rings by winding per tile, and a sliver part that flips winding when it is tiled would
  otherwise unfill the whole polity (packages/globe/AGENTS.md §4.1).
- Year changes: only when the frame changes; `setData` with a latest-wins guard;
  keep showing the previous frame until the new one rendered; l0 while dragging
  the timeline, the zoom's LOD on release.
- Optional own outlines (`theme.edge` > 0): each tier-0 polity outlined inside its edge
  in a deeper shade of its fill. Line layers whose theme colour is fully transparent
  (coast, border, lake shore, hover) are not drawn.
- `prefers-reduced-motion`: `jumpTo` instead of `flyTo`, no spin.
- Implemented details (coastline in its own `<prefix>coast` source, view culling
  when zoomed in): packages/globe/AGENTS.md §3.4, §4.

## 6. Data sources and licensing

| Source | Version | Licence | Role | Attribution |
| --- | --- | --- | --- | --- |
| [Cliopatria](https://github.com/Seshat-Global-History-Databank/cliopatria) (Seshat Global History Databank) | v0.2.0, commit ad28a691, zip sha256 `d01ae3a2…f3370`, DOI [10.5281/zenodo.20274630](https://doi.org/10.5281/zenodo.20274630) | CC BY 4.0 | historical polities −3400 … 1945 | "Historical borders: Cliopatria (Seshat Global History Databank), Bennett et al., *Scientific Data* 12, 247 (2025), doi:10.1038/s41597-025-04516-9, CC BY 4.0 — modified (leaf polities only, clipped to Natural Earth land, islands assigned, corrected by Alex’s Atlas overrides)." |
| [Natural Earth](https://www.naturalearthdata.com/) | v5.1.2 (GitHub tag) | public domain | land, minor islands, lakes, admin-0/admin-1 units, disputed areas | "Made with Natural Earth." |
| Alex’s Atlas overrides | this repo | CC BY 4.0 (with the dataset) | fixes, indigenous nations, modern unit timelines | sources listed per entry |

The built dataset is published under **CC BY 4.0** (Cliopatria's licence; Natural
Earth adds no conditions). Rejected for published geometry: historical-basemaps
(GPL-3.0), CShapes 2.0 (CC BY-NC-SA), Chronas (CC BY-SA), OSM land polygons
baked into polygons (ODbL), OpenHistoricalMap (CC0 with CC BY-SA 2.0 coastline
imports; thin before 1500 — possible future refinement module), Running Reality,
GeaCron, Euratlas (proprietary).

## 7. The site (apps/site) — UX spec

Minimal by design (2026-10-02): the globe, the year, a timeline bar and a few
buttons. Add UI only when asked.

### 7.1 Layout

Full-bleed globe on a deep-space background with a CSS star field and floating
controls, every button in one style (§7.5):

- **The year**: large (Newsreader), centred on the window at the top, no subtitle;
  it dims gently while a year's borders load.
- **Top left**, a column: **search** (§7.3) and the **map key** directly below it
  (§7.4). Their panels open to the right of their button, one at a time; a press
  elsewhere or Esc closes them.
- **Top right**: **About** (§7.4).
- **Bottom left**, three separate buttons above the timeline: zoom in, zoom out,
  reset view.
- **Bottom**: the timeline bar (§7.2).
- No logo/brand bar, toolbar, side panel, list drawer, credits chip or share button
  (the address bar holds the shareable URL).
- Phones (< 640 px): the timeline bar takes two rows (the track above its
  controls); the search panel covers most of the width and closes after a choice.
  Touch screens get 44 px controls (40 px otherwise).
- Flights to a selection keep it clear of the year, the timeline bar, the corner
  buttons and an open search panel through `flyToPolity`'s `padding` (the map's own
  padding stays 0; apps/site/AGENTS.md §3).

### 7.2 Timeline

`Timeline` with `layout: 'bar'`, `step: 1`, `yearField: 'input'`,
`changeButtons: false` (packages/globe/AGENTS.md §6.1): one row of separate
controls: one year back, play/pause, one year forward, the **typed-year field**
(shows the year; type `1453`, `-500`, `500 BC` or `AD 33` and press Enter; invalid
input shows the accepted range, Esc reverts), a thick track, and the speed menu (0.25×, 0.5×, 1×, 2×).
The track is a bar as tall as the buttons with tick lines inside it (no tick years,
no era band, no change-density strip), the selected polity's lifespan as a brass
band and a brass thumb at the year shown. Hovering shows the year under the pointer
in a bubble; click to jump, drag to scrub (borders follow the thumb, coarse LOD while
dragging or playing). Continuous piecewise-linear scale, injectable, default stops
`[-3400,0] [-1200,.10] [-500,.16] [1,.22] [500,.30] [1000,.38] [1500,.50] [1800,.66] [1900,.80] [present,1]`;
playback at constant track speed. Keyboard: native range semantics with
`aria-valuetext` "500 BCE"; ←/→ ±1 year (skipping 0), Shift ×10, PageUp/PageDown
an adaptive step, Home/End, `[`/`]` previous/next border change, Space play, `/`
search, Esc closes panels.

### 7.3 Globe interaction and search

Hover tooltip "name · years" after ~120 ms; click anywhere in a polygon selects it
(smallest area wins; tier-1 overlays win over tier 0): a brass outline on the globe
and the polity's lifespan on the timeline. The selection persists across years by
`pid`; a click on the sea or Esc clears it. **Search** (top-left button, `/`): a
field over a list. With the field empty the list shows the polities on the map in
the year shown (A–Z, each with its map colour, kind, lifespan and relation; this is
the accessible list of the globe's polities, and `L` opens it). Typing searches every
polity (diacritic-insensitive, typo-tolerant), those on the map in the year shown
first and marked "on the map". Choosing selects the polity and flies to it, first
jumping to its peak (or nearest) year when it is not on the map; on wide screens
the panel stays open for browsing. URL hash
`#y=<year>&p=<pid>&map=<zoom>/<lat>/<lon>` (replaceState while scrubbing,
pushState on search/select).

### 7.4 Map key, About and credits

- **Map key** (below search): tier-1 hatch = indigenous nations and disputed areas
  (approximate), dashed = approximate extent, unclaimed land, coastline, the
  selection outline; swatches drawn from the globe's own colours.
- **About** (top right): a dialog covering what the map is, the **credits and
  licences** (every `manifest.sources` entry with its attribution, the dataset
  files, software and fonts), how borders are drawn, privacy, and a link to the
  keyboard shortcuts. This is where the site credits its data (CC BY 4.0 §3(a)(2):
  a reasonable means, one click from every view); the globe's own attribution
  control is off.

### 7.5 Visual identity

**Chrome:** neutral charcoal greys: space `#1f1f1f` behind the globe with the star field,
menus and buttons `#242424` (translucent with blur over the map), hover `#343434`,
hairline borders `rgba(255,255,255,.09)`, text `#f2f2f2` / `#b8b8b8` / `#8a8a8a`; **white**
as the accent (the open button, the timeline thumb and lifespan band, "BCE"), focus
`#7cc4ff`; one self-hosted typeface, Newsreader (the year, titles, menus and
tooltips). **One button style**: every button of the site and every control of the
timeline bar (buttons, year field, track, speed menu) is the same 40 px (44 px on touch
screens) surface with a hairline border and a 12 px radius, from the `--ca-control-*`
custom properties (`apps/site/src/styles/tokens.css`; the timeline bar reads them too).

**Map** (`apps/site/src/map-colors.ts`), in the manner of a grand-strategy game's
political map (Victoria 3), in pastel watercolour tones:
- 21 major powers in their classic colours, the same in every era (Britain pink, Canada
  red, France blue, the USA light blue, Spain lemon, Portugal deep green, Italy green,
  the Netherlands orange, Prussia/Germany tan, Austria white, the Ottomans/Turkey teal,
  Russia green, the Soviet Union deep red, China (Ming, Qing, the Republic) yellow, the
  People's Republic of China coral red, India saffron, Japan plum, Sweden blue, Denmark
  dusky red, Poland rose, Brazil green), by explicit colour keys (`power`, so colonies
  share them); rival factions of one country (Spanish Nationalists, Free French,
  Southern Ming, …) keep slot colours so splits stay visible. Every other country takes
  a colour from its **flag** (Mexico, Algeria and Libya green, Niger orange, Chad blue,
  …), and clear historical predecessors share it (19th-century Mexico, Persia/Iran,
  Gran Colombia, …): `apps/site/scripts/country-colors.mjs` picks one flag colour and
  pastel shade per country so that polities sharing a border in any frame stay distinct
  (it writes `apps/site/src/country-colors.ts`; re-run after a data rebuild). Remaining
  polities take a 12-slot palette by `c`, tuned on the borders that actually occur.
- A muted mid-blue sea `#3d6a85`, Victoria 3's grey `#a29d92` for unclaimed land, no
  coastline or border lines: each polity has its own outline inside its edge, a shade
  deeper than its fill (`theme.edge`); hovering lightens the fill only; the selected
  polity's outline turns white. No atmosphere.

**Globe of History:** the user chose (2026-10-02) to fit its lighter look: charcoal
greys, white accents and a similar ocean hue, in this project's own values. **Never**
reuse its name, logo, copy, fonts, icons, card geometry, loader, Mapbox style/token or
data.

## 8. Integration recipes for other projects

Tested recipes live in **packages/globe/AGENTS.md §8** (`node packages/globe/scripts/recipes.mjs`
runs them): plain HTML + import map, Vite, React StrictMode-safe `useEffect`
wrapper, Astro (`client:only` or a framework-free `<chrono-globe>`), custom element,
bring-your-own-map (`addBorderLayers`). Common to all:

- **Data** is served same-origin at **`/data/alexs-atlas/`** (a copy of
  `packages/borders/data/`; `manifest.json` revalidated, hashed files immutable).
- **CSS** is imported explicitly: `maplibre-gl/dist/maplibre-gl.css` and
  `@alexs-atlas/globe/style.css` (the JS entry imports none).
- **Vite**: `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'`,
  pass `workerUrl` to `ChronoGlobe`, and set `worker: { format: 'es' }` in vite.config.

Sibling **`strhistory`** migration (Astro 7 + React 19 + MapLibre 6; copy no code
from it), details and API mapping in packages/globe/AGENTS.md §8.7:

- **A — drop-in data**: replace the per-snapshot `world_<year>.geojson` loads with
  `createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' })` and
  `bordersAt(year, { lod })` + `setData` behind a latest-wins guard (any year, same
  property names), splitting multi-part features first (`splitParts` from
  `@alexs-atlas/globe`; without it MapLibre can leave a polity unfilled, §5.5).
  Static per-year files in Node: `fileFetch` from `@alexs-atlas/borders/node`.
- **B — keep its own style**: replace the third-party vector source and year filters
  with `addBorderLayers(map, { borders, year, beforeId: 'sea', prefix: 'ca-' })`.
- **C — adopt `ChronoGlobe`**: `import('@alexs-atlas/globe')` inside the island's
  effect; `new ChronoGlobe(el, options, callbacks)` replaces its controller (same
  method names for `whenReady`, `setYear`, `getView`, `zoomBy`, `resetView`, spin,
  `destroy`); keep pins on `globe.map`.
- **Caddy**: add `|/data/alexs-atlas/[a-z0-9._/-]+\.json` to the `@publicAsset
  path_regexp` group (relies on Caddy's path normalisation; a stricter equivalent is in
  packages/globe/AGENTS.md §8.8) and `/data/alexs-atlas/manifest.json` to its access
  smoke test.

## 9. Testing and QA

- `npm run check` = validate overrides + `tsc -b` + `vitest run`.
- Pipeline QA gates (fail the build; thresholds in `pipeline/config.json` `qa.*`,
  details in packages/borders/AGENTS.md): no override entry in error (stale ones are
  reported), no record silently lost, every frame a partition of NE land (0.01 %),
  no tier-0 overlap above 0.5 km², tier-1 overlays on land, microstates within 1 %
  of their NE area, valid ids/years/frames; the packager refuses to publish a build
  that failed. `data/qa-report.json` lists coverage per region and year, island
  assignments by rule, unassigned land and the packaging alignment checks.
- Site: `npm run e2e` (end-to-end checks in a headless browser, fails on any
  third-party request) and `npm run screenshots` (playwright-core driving an
  installed Microsoft Edge or Google Chrome, SwiftShader WebGL; fixed years,
  archipelagos and UI states into `.cache/screenshots/`); see apps/site/AGENTS.md.
  The browser scripts (these two, `packages/globe/scripts/*.mjs` and the timeline
  demo) use Edge, or Chrome when Edge is not installed; `ALEXS_ATLAS_BROWSER`
  picks another: a Playwright channel (`msedge`, `chrome`, `chromium`, …;
  `chromium` is Playwright's own build: run `npx playwright-core install chromium`
  first) or an absolute path to a Chromium-based executable. Data QA:
  `npm run data:factcheck` and `npm run data:tileqa` (below).
- **Fact-check toolkit** (`packages/borders/pipeline/factcheck/`, deterministic,
  replaces LLM research for routine checks): `npm run data:factcheck -- [--tiles]
  [--tests] [--offline] [--only cliopatria,gaps,modern]` (= `node packages/borders/pipeline/tools/py.mjs
  packages/borders/pipeline/factcheck/run_all.py`); tile QA alone: `npm run data:tileqa -- [--data DIR] [--years …] [--lods l0,l1,l2]`.
  Checks every Cliopatria Wikidata id (type, name, dates, reuse), lists Wikidata
  polities missing from the map as `known-gap` entries, generates modern unit
  timelines for every unit no curated file covers, and runs a raster **tile QA**
  of the built dataset (unowned land, colour over sea, islands split between
  owners; exits 1 above thresholds). Wikidata answers are cached in
  `.cache/wikidata/` (reruns are free; `--offline` never touches the network);
  reports go to `.cache/factcheck/`.

## 10. Working rules for agents

- Read [todo.md](todo.md) first; mark items `[~]` with your area while working,
  `[x]` when verified; add what you discover.
- **Work can be interrupted** (account usage limits stop every agent at once).
  Before starting, check whether your files or your scratch folder
  (`.cache/audit/<name>/`, `.cache/build/`) already hold work for your task and
  continue from it — never start over. Save progress early and often (valid
  files after every few steps, short notes in your scratch folder).
- Be economical with context: don't paste large files or long command output
  into the conversation (use head/grep/small scripts and summarise).
- Stay inside your folder; never `npm install` from a parallel agent.
- Hosts: Windows (Node 24, npm 11, Python 3.12 with the venv `.cache/venv`
  holding shapely, numpy, pyproj; Git Bash; no WSL, Docker or Java) and macOS
  (Node 26, zsh, Google Chrome but no Edge; the venv is created on first use).
  A fresh checkout needs `npm ci` first. Paths contain spaces — quote them; use
  mapshaper's Node API (`mapshaper.runCommands`) instead of long shell command lines
  (32 767-character limit fails silently).
- Large downloads and intermediates go in `.cache/` (git-ignored).
- Copy no code from `../strhistory` (it has no licence); re-implement its ideas
  and credit "approach adapted from strhistory".

## 11. Decisions log

| Date | Decision |
| --- | --- |
| 2026-10-01 | No bulk extraction from Running Reality (policy + watermark); RR only as an opt-in embedded panel. |
| 2026-10-01 | No automated tracing of RR's rendered maps — project decision (§2.1). |
| 2026-10-01 | Open data: Cliopatria v0.2.0 (≤1945) + Natural Earth 5.1.2 (coasts, modern units ≥1946); cut-over 1946. |
| 2026-10-01 | Clip to NE 10m land; island and coastal-gap assignment with explicit override precedence. |
| 2026-10-01 | Era-chunked TopoJSON + client-side per-year decode; MapLibre 6 globe; no PMTiles (keeps hosting plain-JSON). |
| 2026-10-01 | Fact-check audit by region (modern units, 1700–1945, pre-1700) recorded as sourced override entries with a generated catalog. |
| 2026-10-02 | LLM research fan-out stopped (usage limits). Fact-checking is done by deterministic programs in `packages/borders/pipeline/factcheck/` (Wikidata cross-checks, coverage-gap lists, Wikidata-derived modern unit timelines, raster tile QA) that write `auto-*.json` override files; hand-curated files always win; generated files are regenerated, never hand-edited. |
| 2026-10-02 | A tier-0 `add` that carves takes its area out of every other tier-0 record alive in its years, its own pid's included, and re-draws that pid there (a tier-1 or `carve: false` add over the pid's own tier-0 records is still an error). |
| 2026-10-02 | `record` geometry specs in the add phase are read from the records as they stood before the first add (plus records added since), so carving by other adds never changes them. |
| 2026-10-02 | Leftovers of subtract/carve/assign: rims thinner than 50 m (`overrides.rimWidthM`) go with the area taken (absorbed), and record pieces left with no land (< `overrides.landNoiseKm2`) are dropped. |
| 2026-10-02 | The validator rejects a pid that several modern units hold in the same years with a different name, kind, power or wikidata (the engine draws one feature per pid and year); `data:build` also runs the engine's dry run at validate. |
| 2026-10-02 | The packager refuses to publish to `data/` a build whose geometry QA failed a hard check (`--out=<dir>` to inspect, `--allow-failed-qa` to override). |
| 2026-10-02 | Packaging topology: vertices snap at `topology.snapDegrees` 3e-5° (≈ 3.3 m), and vertices within `topology.nodeDegrees` 1e-4° (≈ 11 m) of another ring are noded into it (3.3 m noding left up to 165 km of unshared border, 22 m made a 216 km² overlap). |
| 2026-10-02 | Modern units without a timeline fall back to their NE sovereign, logged `unaudited`, with pid `ne:<home ADM0_A3>`: Natural Earth's 'X1' sovereign codes map to the unit whose ADMIN equals SOVEREIGNT (FR1 → `ne:fra`, GB1 → `ne:gbr`, US1 → `ne:usa`). |
| 2026-10-02 | Unclaimed land is one feature per connected polygon; packaging regroups pieces with the same lifetime into one record. |
| 2026-10-02 | The full override catalog lives in `packages/borders/overrides/CATALOG.md`; packages/borders/AGENTS.md keeps a generated summary (both by `npm run data:catalog`). |
| 2026-10-02 | `@alexs-atlas/globe`'s JS entry imports no CSS; hosts import `@alexs-atlas/globe/style.css`. Unclaimed land is drawn #343a34 so it never reads as water. |
| 2026-10-02 | Running Reality dropped entirely: the opt-in embedded comparison panel (site view, `RunningRealityPanel`, `rrHash`/`rrEmbedUrl`), its CSP allowance and its docs are removed; proprietary sources stay excluded (§2.1, §6). |
| 2026-10-02 | Minimal site UI (user request): only the centred year, search with the list of polities and the map key (top left), About with the credits (top right), three separate map buttons (bottom left) and the timeline bar (`layout: 'bar'`, one-year steps, typed year). The polity panel, list drawer, toolbar, credits chip, share button, era band, tick years and change-density strip are gone; the data is credited in About; every button shares the `--ca-control-*` style (§7). |
| 2026-10-02 | Site look (user request): the Claude app's dark grays (sampled from a screenshot: `#151515` behind the globe, `#212121` menus) for every surface, Newsreader as the only typeface, no atmosphere, a 3D star field (`sky.ts`), and a Victoria 3-style political map: identity colours for 17 major powers by explicit colour keys (`power`), rival factions of one country left in slot colours so splits stay visible (§7.5). |
| 2026-10-02 | Map look, second pass (user requests): pastel watercolour identity colours by classic convention (the USSR and the PRC red, Qing yellow, Canada red), per-polity outlines instead of shared borders and coastlines, Victoria 3 grey for unclaimed land; the site's chrome follows Globe of History's lighter greys and white accents in its own values (§7.5). |
| 2026-10-02 | Sea-floor relief removed from the site (user request): a flat sea colour; the tiles, their generator and the About credit are gone (the globe package keeps its generic `relief` option). |
| 2026-10-02 | Project renamed ChronoAtlas → Alex’s Atlas (user request): packages `@alexs-atlas/*`, data served at `/data/alexs-atlas/`, manifest schema `alexs-atlas.borders/1`, dataset `alexs-atlas-borders`; the built dataset's text files were renamed in place (no geometry changed). |
