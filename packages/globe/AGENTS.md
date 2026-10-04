# AGENTS.md — @alexs-atlas/globe

A framework-agnostic MapLibre GL JS 6 globe that shows the borders of any year
from `@alexs-atlas/borders`, plus a bring-your-own-map layer module and a bottom
timeline. This file is self-contained so the package can be copied into another
project. Project-wide rules live in the root [AGENTS.md](../../AGENTS.md)
(contract: §5.4–§5.5, UX: §7, privacy: §2.3).

Everything below is implemented and checked: unit tests (`vitest`), a type check
of sources, tests and examples, headless-browser screenshots and timings (Edge or
Chrome, §9; `scripts/screenshots.mjs`) and runnable integration recipes
(`scripts/recipes.mjs`). Where a recipe could not be run as written (React and
Astro are not installed in this repo), §8 says so and names the check that
covers the behaviour it relies on.

## 1. What is in this package

| Path | What |
| --- | --- |
| `src/chrono-globe.ts` | `ChronoGlobe`: map creation, view math, resize, spin, tooltip, ready/failed states. |
| `src/border-layers.ts` | `addBorderLayers()` / `BorderLayers`: sources, layers, year changes, LOD, hover, selection. `ChronoGlobe` uses it too. |
| `src/frames.ts` | `FrameScheduler`: year → frame, latest-wins coalescing, keep-old-until-rendered (pure, unit-tested). |
| `src/cull.ts` | View culling: spherical caps, part bounding boxes, `cullFeatures()` (pure, unit-tested; §3.4). |
| `src/rim.ts` | Label box estimate, the fade of labels at the globe's rim, and `globeDisc` (the globe's outline on screen) (pure, unit-tested; §3.4). |
| `src/label-lines.ts` | Curved labels: `labelLine` (an arc along the long axis of a polity's main body, gaps between its parts filled in), `extendLine` (lead-ins for MapLibre's fit check), sizing by zoom, `shortLabelName` (pure, unit-tested; §3.4). |
| `src/sky.ts` | Star field: a fixed catalogue of stars at infinity projected through the map's camera and painted on a canvas under the map (pure projection, unit-tested; §5.2). |
| `src/style.ts` | Style builder (pure JSON): base style, sources, layers in contract order, `externalUrls()` guard. |
| `src/palette.ts`, `src/color.ts`, `src/theme.ts`, `src/hatch.ts` | 12-slot palette, colour maths, theme + `--ca-*` reading, tier-1 hatch pattern (pixels generated in code). |
| `src/view.ts` | View math (`fitZoom`, scale ↔ zoom, bboxes, padding). |
| `src/element.ts` | Optional `<chrono-globe>` custom element (`defineChronoGlobeElement()`). |
| `src/timeline/` | `Timeline`, `createTimeScale` (maintained by the timeline owner; re-exported here). |
| `src/style.css` | The only stylesheet (also pulls in `timeline/timeline.css`); built to `dist/style.css`. |
| `examples/` | Dev pages served by Vite: `basic`, `host-map`, `lifecycle`, `element`, `synthetic`; `plain.html` (no bundler). |
| `scripts/screenshots.mjs` | Headless browser: scenes → `.cache/screenshots/globe-*.png`, year-change timings, third-party request guard. |
| `scripts/recipes.mjs` | Runs and checks every integration recipe of §8. |
| `scripts/browser.mjs` | `launchBrowser()` for both scripts and the timeline demo: installed Edge, else Chrome; `ALEXS_ATLAS_BROWSER` picks another (§9). |

Commands (from the repo root):

```sh
npm run build -w @alexs-atlas/globe        # dist/index.js, dist/style.css, dist/*.d.ts
npm run dev -w @alexs-atlas/globe          # http://localhost:5173/examples/basic.html (dataset at /data/alexs-atlas/)
npx vitest run packages/globe              # unit tests (jsdom where needed)
npx tsc -p packages/globe/src/tsconfig.json   # type-check sources + tests
npx tsc -p packages/globe/examples            # type-check the examples
node packages/globe/scripts/screenshots.mjs [--only a,b] [--no-timings] [--gpu]
node packages/globe/scripts/recipes.mjs [--gpu]
```

## 2. Setup

- **Peer dependency** `maplibre-gl ^6.11.2` (never bundled into this package);
  dependency `@alexs-atlas/borders`. ESM only, no DOM access at import time
  (the module can be imported during SSR; only constructing a globe needs a browser).
- **CSS**: import both stylesheets once, MapLibre's first:
  `maplibre-gl/dist/maplibre-gl.css` and `@alexs-atlas/globe/style.css`.
  `src/index.ts` imports no CSS, so `import '@alexs-atlas/globe'` never injects styles.
- **Worker** (bundlers only): MapLibre 6's worker is an ES module. Once bundled,
  MapLibre cannot find it on its own; pass its URL:
  `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'`
  (Vite) and `workerUrl` in the options (it calls `setWorkerUrl`, which is global
  for the page). Vite also needs `worker: { format: 'es' }`. Unbundled pages
  (§8.1) need nothing.
- **Data**: serve `@alexs-atlas/borders/data/` as static files, e.g. at
  `/data/alexs-atlas/` (plain JSON; `manifest.json` short-cached, everything else
  content-hashed and immutable). Pass `data: { manifestUrl }`.
- **Fonts**: labels are drawn **locally** from the CSS font family in
  `fontFamily` (default `'sans-serif'`); no glyph server, no URL in the style.
  Verified in MapLibre 6.11.2's `GlyphManager`: without a `glyphs` URL every
  glyph is drawn with TinySDF using the `text-font` stack as the CSS family, after
  `document.fonts.load(...)`, so a self-hosted web font (e.g.
  `@fontsource-variable/inter` → `'Inter Variable'`) is used once it loads.
  The optional `glyphs` option (a same-origin `…/{fontstack}/{range}.pbf`
  template) exists only for hosts that already serve PBF glyphs.

## 3. `ChronoGlobe`

```ts
const globe = new ChronoGlobe(container: HTMLElement, options: ChronoGlobeOptions, callbacks?: ChronoGlobeCallbacks);
```

The component appends `.ca-globe` (star field, map, tooltip) to `container`,
fills it (give the container a size; never `position: fixed`) and sets
`container[data-ca-state]` to `loading` → `ready` (first borders rendered) or
`failed`. `destroy()` removes everything, including the attribute.

### 3.1 Options

| Option | Default | Meaning |
| --- | --- | --- |
| `data` | — | `{ manifestUrl }`, `{ manifest, baseUrl }` or `{ client: BordersClient }` (share one client with the rest of the page). |
| `year` | — | Initial year: integer, historical numbering, **no year 0** (0 is shown as 1 CE with a warning). |
| `view` | `{ center: [20, 30], scale: 1 }` | `scale = 2^(zoom − fitZoom)`; 1 = the globe's diameter ≈ the container's smaller side. |
| `maxZoom` | `7` | MapLibre max zoom. |
| `minScale` | `0.6` | Smallest scale the user can zoom out to. |
| `labels` | `true` | Polity labels. |
| `relief` | — | `{ tiles, tileSize?: 512, maxzoom?: 4, opacity?: 1, under?: false }`: same-origin raster tiles (layer `<prefix>relief`), drawn over the fills and outlines (below borders, overlays and labels), or with `under` first of all, beneath the land, so they show only on water (e.g. sea-floor relief). |
| `labelMode` | `'point'` | `'point'`: each name horizontal at its label point, sized by area. `'curved'`: names in capitals along an arc through each polity, spread to span it (§3.4). |
| `hover` | `true` | Hover outline + `onHover`. `false` also disables the tooltip. |
| `tooltip` | `true` | Built-in "name · years" tooltip after 120 ms; `false` when the host draws its own from `onHover`. |
| `layerPrefix` | `'ca-'` | Prefix of every source, layer and image id (background: `<prefix>ocean`). |
| `palette` | `DEFAULT_PALETTE` | 12 colours (one per slot `c`) or `(props) => cssColour`; both are pre-blended over `land` (opaque fills). |
| `theme` | `DEFAULT_THEME` | `Partial<GlobeTheme>` (§5.2); layered over `--ca-*` custom properties on the container. |
| `fontFamily` | `'sans-serif'` | CSS family list for labels (drawn locally, §2). |
| `glyphs` | — | Optional same-origin glyph template; omit it. |
| `workerUrl` | — | Calls maplibre-gl `setWorkerUrl` (bundlers, §2). |
| `attribution` | `true` | Compact MapLibre attribution with the dataset credits (`attributionHtml(manifest)`); a string = custom HTML; `false` = none (then credit the data elsewhere — CC BY 4.0 requires it). |
| `exposeAs` | — | Dev handle: `window[exposeAs] = globe` (removed on destroy). |
| `padding` | `0` | Default padding (px or `{top,right,bottom,left}`) kept clear by `flyToPolity`, e.g. for a side panel and the timeline. |

### 3.2 Callbacks

| Callback | When |
| --- | --- |
| `onYearApplied(year)` | The borders of `year` are on screen (also when the year stays within the shown frame). |
| `onHover(info \| null)` | `HoverInfo`: `id`, `pid`, `name`, `props` (`PolityProps`), `polity?` (index entry once loaded), `label` ("Name · 395–1453"), `lngLat`, `point` (px), `others` (other polities under the pointer). |
| `onSelect(info \| null)` | `SelectInfo`: `pid`, `props?` (feature in the shown year, absent if not on the map), `polity?`, `reason` (`'click' \| 'api'`), `lngLat?`. May fire a second time for the same pid with `polity` filled in once the polity index has loaded. |
| `onViewChange(view)` | Every camera change, at most once per animation frame. |
| `onInteractionEnd(view)` | A user gesture (drag, wheel, pinch, keyboard) finished. |
| `onLoadingChange(loading)` | True while the wanted year/LOD is loading or rendering. |
| `onFailure(reason, error?)` | `'webgl'` (no map), `'data'` (manifest/chunk failed; after `ready` the old borders stay and the state stays `ready`), `'context-lost'`. |

### 3.3 Methods and properties

| Member | Notes |
| --- | --- |
| `map` | The MapLibre map (escape hatch: markers, extra layers). Throws when there is none (WebGL failure, destroyed). |
| `layers` | The `BorderLayers` controller (§4.2) once the style loaded, else `null`. |
| `borders` | The `BordersClient` in use. `container`, `root` (the `.ca-globe` element), `loadState`. |
| `whenReady()` | Resolves when the first year's borders rendered; rejects on failure or `destroy()` (the rejection is pre-handled, so unawaited promises never warn). |
| `setYear(y)` / `getYear()` | Coalesced, latest wins; works only when the frame changes; the previous borders stay until the new ones rendered. To await the render: `await globe.layers?.setYear(y)`. |
| `setInteracting(bool)` | True while a timeline drag/playback runs: frames load at the coarsest LOD (`l0`); false restores the zoom's LOD. |
| `getView()` / `setView(view, { animate? })` | `{ center: [lon, lat], scale }`, container-size independent. |
| `zoomBy(delta)`, `resetView()` | Zoom levels; back to the initial view. |
| `flyToPolity(pid, { year?, padding? })` | Fits the bbox of the polity's features in `year` (default: the shown year; fetched if needed), else the polity-index bbox, inside `padding` (default: the `padding` option, else 40 px). Max zoom 6. `jumpTo` under `prefers-reduced-motion`. Resolves `false` when unknown. Map padding: see below. |
| `select(pid \| null)`, `getSelected()` | Selection outline (brass) persists across years by `pid`; works before the map loaded. |
| `setLabels(bool)` | Show/hide labels (remembered before load). |
| `startSpin()` / `stopSpin()` / `isSpinning` | Slow eastward spin (3°/s at scale 1, slower when zoomed in); stops on any user input; never under reduced motion. |
| `resize()` | Re-measure (a `ResizeObserver` already does this, keeping the relative scale). |
| `setTheme(partial)` | Runtime theme change (paint properties, sky, hatch). |
| `destroy()` | Removes everything; safe at any point, including mid-load and mid-year-change. |

**`flyToPolity` and host map padding (MapLibre 6.11.2).** With `map.setPadding(...)`,
MapLibre's globe `cameraForBounds` (`VerticalPerspectiveCameraHelper.cameraForBoxAndBearing`)
fits the zoom to the whole canvas minus the call's `padding` only, ignoring the map's
padding, while the camera still centres in the padded area: flights overshot the free
area by up to the smaller map padding of each axis (measured: 34–144 px past the edges).
`flyToPolity` compensates (`view.ts fitInsideMapPadding`): it adds `map.getPadding()` to
the call's padding and cancels the extra centre shift with `offset` (checked in Edge:
every vertex inside the free area, 75–96 % filled). When the map padding takes about
half the canvas on an axis, MapLibre's first (Mercator) pass, which subtracts the map
padding again, cannot fit, so the plain fit is used (it overshoots). Simplest for hosts:
keep the map padding at 0 and pass the chrome insets as `flyToPolity`'s `padding` (the
site does this). Re-check when upgrading MapLibre: once it honours the map padding, the
compensation would undershoot.

### 3.4 Behaviour

- North-up globe: `projection: globe`, `renderWorldCopies: false`, no rotate,
  pitch or roll from mouse, touch or keyboard; `maxPitch: 0`.
- View math: `fitZoom = log2(min(w, h) · π / 512)`, `zoom = fitZoom + log2(scale)`.
  On resize the scale (not the zoom) is kept, and `minZoom` follows `minScale`.
- LOD: `lodForZoom(manifest, zoom)` (last LOD with `minZoom ≤ zoom`), re-checked on
  `zoomend`; `l0` while `setInteracting(true)` and during camera animations that
  leave the culled view (below).
- View culling (`cull.ts`): when zoomed in, the frame and coast sources get only the
  polygon parts and line parts whose bounding box meets the visible cap of the globe
  (view centre + largest angular distance to the canvas corners) grown by 50 % of its
  radius; whole-globe views (grown cap > 100°) are not culled. A pan that leaves the
  cap re-culls (checked every 150 ms while moving and on `moveend`); a camera
  animation (`flyTo`/`easeTo`, recognised by a `movestart` without an input event)
  that leaves it shows the whole world at `l0` until `moveend`, then the zoom's LOD
  culled around the new view. Picking, `featuresOf`, `frameFeatures` and the
  highlight always use the whole frame.
- Labels at the rim (`rim.ts`): MapLibre hides a screen-aligned label only when its
  anchor is behind the globe, so labels anchored near the horizon used to hang out
  into space. Each label's box is estimated from the label typography
  (`LABEL_TYPE` in `style.ts`, shared with the style); a label is fully shown while
  ≤ 25 % of its box lies outside the globe's outline or the canvas, hidden from 50 %,
  and faded in quarter steps between (feature-state `edge` × `text-opacity`, updated
  once per animation frame while the camera moves).
- Curved labels (`labelMode: 'curved'`, `label-lines.ts`): each label point becomes an
  arc along its record's main body: the largest part plus the parts within
  max(100 km, ¼·√area) of it (single linkage over real vertex distance; parts under 2 %
  of the largest left out), so the Eastern Roman Empire's coasts around the Mediterranean
  or Japan's main islands count as one shape. Along the body's principal axis (a roundish
  body reads horizontally) scan lines run across it; on each, a gap between two bands of
  land is bridged unless it is another polity's or unclaimed land (`otherLand`: a 2° grid
  index of the frame's tier-0 land), and only between two parts (a sea, a strait) or,
  inside one part, when at most half as wide as the land on either side (a bay: China's
  Bohai Gulf). The arc follows one band from a wide scan line outward while it keeps
  ≥ 18 % of that land, crossing at most 3 weak or empty scan lines in a row (a thin coast,
  a strait between islands); where the band ends it may hop across open sea to the next
  island within the body's gap (the Philippines, Japan), never across other land, so a
  horseshoe-shaped polity (the 1914 Ottoman Empire, Croatia) is labelled along one arm
  instead of across its neighbours; of 4 starts (the widest scan lines) the fitted arc
  with the most length over the polity's own land wins; a weighted quadratic through the
  band middles is sampled over 94 % of it. It may turn at most 6° for thick bodies (median
  land width ≥ 0.4 × the span: China, France read nearly straight) up to 20° for thin ones
  (≤ 0.2 ×: Chile, Italy, Japan bend with their shape); when that limit flattens the curve,
  its offset and tilt are refitted (in proportion to how much the thickness lowered the
  limit: thin bodies keep their curve's own offset), so it runs through the body's middle
  (not along the bottom of a U, as China's did). Each arc notes which samples lie on the polity
  (`onBody`); cached per
  record and LOD (the other-land index is built once per frame, only when an arc is
  missing). The type size fits the name into 80 % of the arc (and 42 % of the body's
  median land width); it follows the map's scale up to zoom 2 and grows 2^(0.6·Δzoom)
  beyond (smaller relative to the polity when zooming in), at most 30 px.
  `shortLabelName` (a common map name, a leading title or a trailing parenthetical
  dropped) is used when it reads ≥ 1.5× larger or the full name is under 9 px. Below 9 px
  a label keeps 9 px instead of disappearing (overlaps are resolved by area, largest
  first), unless its text would run longer than 1.5× its arc, less than 60 % of it lies
  over the polity's own land (it would spill over the sea and its neighbours), or it sits
  within 25° of the horizon (acos(R/(R+d)) for the camera; it would only smear at the
  rim). Letter spacing spreads
  the name over the arc: up to 2 em from 14 px, less for smaller type (0.3 em at 9 px), so
  small names still read as words. The name slides along its arc to the window with the
  most of it on the polity's own land and in view (within 10° of the view's edge or the
  horizon) when that gains ≥ 10 % over the middle: off a gulf or strait in the middle of
  the arc, and toward the side of the globe facing the viewer (Russia's name moves west
  when Europe is in view); labels refresh after zooms and after pans. A themed halo (the
  site's soft dark glow) is capped to 0.07 em width and 0.05 em blur, inside the glyphs'
  distance field, which MapLibre clips to each glyph's box (wider showed light or dark
  rectangles behind small letters). Each
  label is lettered in its polity's outline colour (`_ink`: its fill shaded by
  `theme.edge`, or 0.2), outlined by `labelHalo`. MapLibre 6 constraints shape the
  implementation: a 'line-center' label is dropped where its line crosses a tile edge,
  its fit is checked with the text size at zoom 18 and laid out at the whole tile zoom.
  So the arcs live in their own source `<prefix>label-arcs` tiled only at zoom 2
  (`buffer` 512, `tolerance` 0, overscaled beyond), and each arc's `_px` and `_ls` are
  computed in JS for the current zoom and re-sent during zooms (every 120 ms), after
  every zoom and on frame changes. MapLibre checks the fit on the line at the whole tile
  zoom, where it is up to 2× shorter than on screen at a fractional zoom; each arc is
  therefore sent with straight lead-ins of half its length at both ends (`extendLine`,
  measured in Web Mercator like MapLibre's tile units; the name is drawn along the
  projected line) and fitted to the arc at the current zoom; a held 9 px name gets lead-ins
  as long as its text needs, and unequal lead-ins put the line's middle, where MapLibre
  centres the name, where the slide wants it. Where a lead-in would leave lon/lat range,
  the fit is checked at the tile zoom. While the globe is shown smaller than
  `CURVED_LABELS.hideBelowScale` (0.5) × the view's smaller side no labels are drawn. A
  compact part (axes within 1.6×) reads horizontally. `text-max-angle` is 180° (the
  check is off): on a globe MapLibre subdivides lines at tile-grid crossings and rounds
  them, and a crossing next to a vertex leaves a micro-segment pointing anywhere; at 85°
  that dropped whole labels, the largest first (its window grows with the type size:
  British Raj in 1914, Qing in 1700); the arcs turn at most 20°.
  `shortLabelName` knows common map names for some long official names ("German
  Empire" → "Germany", "United States of America" → "United States") and drops leading
  titles. The rim fade works by angle from the view centre (`project()` maps far-side
  points inside the disc): an arc whose name centre (after sliding) is past 72° is hidden, one with an end
  past 84° dimmed.
- Hover: `feature-state` (`promoteId: 'id'`) lightens the fill and draws a white
  outline; the pick under the pointer prefers tier-1 overlays, then the smallest
  area; `unclaimed` land is never picked.
- Click: selects the best pick (same order), or clears the selection on empty land/sea.
- Off the globe: a point in space picks nothing (no hover, no selection). MapLibre
  unprojects such a point to the nearest point on the horizon, so without this guard
  the pointer beside the globe hovered polities on its far rim (`globeDisc`).
- Accessibility: the canvas `aria-label` reads "Globe showing borders in 1453,
  130 areas"; MapLibre keyboard pan/zoom stays on (rotation off); the tooltip is
  `aria-hidden` (hosts provide an accessible list of the polities, root §7.3).

## 4. `addBorderLayers` (bring your own map)

```ts
const handle = addBorderLayers(map, {
  borders,                 // BordersClient (createBorders({ manifestUrl }))
  year: 1453,
  beforeId: 'sea',         // optional: insert every layer below this host layer
  prefix: 'ca-',           // ids of sources/layers/images
  palette, theme, fontFamily, labels: true, hover: true, clickSelect: true,
  baseLand: true,          // Natural Earth land until the first frame
  lakes: true,             // Natural Earth lakes above the polities
  onYearApplied, onHover, onSelect, onLoadingChange, onFailure,
});
await handle.setYear(1914);      // resolves once 1914 (or a later request) rendered
handle.layerIds; handle.sourceIds;
handle.remove();                 // removes every layer, source and image it added
```

Call it after the map's `load` (if the style is still loading, it waits for it).
It adds no background, sky or projection: those stay the host's. A missing
`beforeId` logs a warning and adds the layers on top. The handle is a
`BorderLayers` instance; beyond the contract it offers `setInteracting(bool)`,
`select(pid)`, `getSelected()`, `featuresOf(pid)`, `frameFeatures()`,
`featuresAt(point)`, `loadPolities()`, `setTheme()`, `setPalette()`,
`setLabels()`, `timings()` (last year-change timings), `getManifest()` and the
`firstFrame` promise.

Host styles **with** a `glyphs` URL: MapLibre then requests our label font
stack from the host's glyph server and, on a 404, draws locally with a console
warning. Pass a `fontFamily` the server has (the sibling site: `'noto-sans'`) or
one that is fine to draw locally.

### 4.1 Ids (prefix `ca-`) and layer order, bottom → top

| Layer | Source | Draws |
| --- | --- | --- |
| `ca-base-land` | `ca-base-land` | `base/land-<lod>` in the land colour, only until the first frame (kept underneath if a frame has no `unclaimed` features). |
| `ca-fill` | `ca-frame` | Tier-0 fills, opaque pre-blended colours, `unclaimed` = land colour, `fill-sort-key: −a`, no anti-aliasing (shared edges, no seams). |
| `ca-edge` | `ca-frame` | With `theme.edge` > 0 only: each tier-0 polity's own outline, inset by half its width (a positive `line-offset` insets a polygon outline), in its fill shaded `edge` darker; neighbours' outlines sit side by side. |
| `ca-relief` | `ca-relief` | With the `relief` option only: its raster tiles (no fade, linear resampling); with `under` it is the first layer, below `ca-base-land`. |
| `ca-border` | `ca-frame` | `linesAt` kind `border`. |
| `ca-border-approx` | `ca-frame` | Dashes along tier-0 polities with `precision: 'approximate'`. |
| `ca-overlay-tint`, `ca-overlay-hatch`, `ca-overlay-line` | `ca-frame` | Tier-1 overlays: translucent tint, diagonal hatch (image `ca-hatch`, added with `map.addImage`), dashed outline. |
| `ca-lakes`, `ca-lake-shore` | `ca-lakes` | `base/lakes-<lod>` above the polities. |
| `ca-coast` | `ca-coast` | `linesAt` kind `coast` (own source, see below). |
| `ca-labels` | `ca-frame` | `labelsAt` points: one per polity, `symbol-sort-key: −a`, size by area, hidden below an area threshold per zoom (≥ 1.4 M km² at z0 … all at z7); tier-1 labels in `labelOverlay`. |
| `ca-hover-line`, `ca-select-glow`, `ca-select-line` | `ca-highlight` | Hover outline (white) and selection outline (brass). |

`ca-frame` is ONE GeoJSON source holding a frame's polygons, border lines and
label points (`promoteId: 'id'`, `buffer: 32`), so a year change swaps all of them
in one `setData`. The coastline — about 90 % of a frame's line vertices — has its
own source `ca-coast` (`buffer: 32`): the borders client returns the identical coast
feature for frames of a chunk with the same coastline, and the layers then leave
that source alone. `ChronoGlobe` adds the background `ca-ocean`.

**One feature per polygon part.** `ca-frame` gets every multi-part polity as one
`Polygon` feature per part, all with the record's `id` and properties
(`cull.ts splitParts`; `frameFeatures()`/`featuresOf()` still return one feature per
record). MapLibre classifies a feature's rings per tile by winding, relative to the
first ring in the tile, and `@maplibre/geojson-vt` rewinds each ring *before* rounding
it to integer tile coordinates, so a sliver island can flip winding there. Inside one
multi-part feature that flip turned the mainland into a "hole" (unfilled, the ocean
showing through): the USA from 1946 at tile zoom 2 (map zoom 2–3), flipped by Santa
Rosa Island off Pensacola, plus about a dozen other polities at some tile zooms.
Separate features confine a flip to the sliver itself (checked offline for every frame
and LOD with geojson-vt and MapLibre's `classifyRings`, and in the browser).

### 4.2 Year changes (both `ChronoGlobe` and `addBorderLayers`)

1. `frameOf(year)` → if the frame (and LOD) is the one on screen: nothing to load,
   `onYearApplied(year)` only.
2. Otherwise one load runs at a time: `bordersAt` + `linesAt` + `labelsAt` (from
   cached chunks: 5–35 ms), culled to the view (§3.4), then `setData` on `ca-frame`
   and, only when the coast feature or the culled cap changed, on `ca-coast`;
   requests arriving meanwhile only replace the target (latest wins), stale results
   are never drawn.
3. The old frame stays on screen until MapLibre rendered the new one
   (`isSourceLoaded` of both sources on a render, 2.5 s safety timeout for hidden maps).
4. A failed load keeps the old frame and reports `onFailure('data', err)`; a
   later request retries.

## 5. Rendering and theming

### 5.1 Colours

`DEFAULT_PALETTE` has 12 muted slots tuned for the dark navy theme. Fills are
**opaque**: each colour is pre-blended over `theme.land` at `fillBlend` (0.85),
so stacked or overlapping areas never mix into a third colour. Measured (OKLab
ΔE×100, as drawn): worst pair 7.1; slots 0–5 (used most by the pipeline's
adjacency colouring) ≥ 10.7, ≥ 8.5 under protan/deutan simulation; every fill
≥ 20 from unclaimed land; labels (light text, dark halo) ≥ 2.2:1 on every fill.
The pipeline assigns slots (`PolityProps.c`) so neighbours differ and colonies
share their power's colour; a palette function overrides that per feature. The
reference site uses one: identity colours for major powers by `power`, a 12-slot
palette for the rest, in the manner of a grand-strategy game's map
(`apps/site/src/map-colors.ts`, with its ΔE figures).

### 5.2 Theme (`GlobeTheme`) and CSS custom properties

Precedence: `DEFAULT_THEME` < `--ca-*` custom properties on the container
(read once at construction) < `options.theme` < `setTheme()`.

| Key | CSS property | Default | Use |
| --- | --- | --- | --- |
| `space` | `--ca-space` | `#070b14` | Page/space behind the globe (CSS). |
| `ocean` | `--ca-ocean` | `#0e1b2d` | Background layer (sea). |
| `land` | `--ca-land` | `#343a34` | Unclaimed land, base land, blend base of fills. |
| `lake` / `lakeShore` | `--ca-lake` / `--ca-lake-shore` | `#0e1b2d` / `rgba(120,146,170,.55)` | Lakes. |
| `border` | `--ca-border` | `rgba(9,13,21,.78)` | Borders between tier-0 areas. |
| `approximate` | `--ca-approximate` | `rgba(230,237,246,.6)` | Dashes of approximate extents. |
| `coast` | `--ca-coast` | `rgba(136,162,186,.75)` | Coastline. |
| `hatch` | `--ca-hatch` | `rgba(240,244,250,.5)` | Tier-1 hatch lines. |
| `label` / `labelHalo` / `labelOverlay` | `--ca-label` / `--ca-label-halo` / `--ca-label-overlay` | `#eef2f7` / `rgba(7,11,20,.85)` / `#f3e2bf` | Label text, halo, tier-1 label text. |
| `labelHaloWidth` / `labelHaloBlur` | `--ca-label-halo-width` / `--ca-label-halo-blur` | `null` / `null` | Halo width and blur in px (0–8; a wide blurred halo is a soft glow under the letters); `null` keeps the label mode's own (curved 0.9 / 0, point 1.3 / 0.4). The halo is drawn by the glyph shader in one more pass over the same buffers, so it costs next to nothing; its reach is bounded by the glyphs' distance field (a few px). |
| `hover` / `selection` | `--ca-hover` / `--ca-selection` | `#f4f7fb` / `#e9b45f` | Outlines. |
| `fillBlend` | `--ca-fill-blend` | `0.85` | Pre-blend strength of palette colours over `land`. |
| `edge` | `--ca-edge` | `0` | Own outlines (layer `ca-edge`): OKLab lightness drop of each polity's outline from its fill; 0 = none. With outlines the selection replaces the polity's outline in place (no glow). |
| `overlayTint` | `--ca-overlay-tint` | `0.3` | Tier-1 tint opacity. |
| `hoverLighten` | `--ca-hover-lighten` | `0.16` | Hovered fill lightening. |
| `atmosphere` | `--ca-atmosphere` | `0.5` | `sky.atmosphere-blend` at z0, fading to 0 by z7 (capped at 0.6; 1 washes colours out). |
| `stars` | `--ca-stars: off` | `true` | Star field (`sky.ts`): 26 000 stars at infinity (seeded, so always the same sky; most faint, a few bright, three tints) projected through the map's camera — centre, field of view and padding — onto a canvas under the map, repainted when the camera moves. They turn with the camera as in a 3D scene (the sky slides opposite to the surface), are hidden behind the globe and fade in from its rim to 1.75 radii. Hidden under `prefers-contrast: more` and forced colours. |

A line layer whose colour is fully transparent (`coast`, `border`, `lakeShore`, `hover`, `selection`) is not drawn at all (visibility `none`), e.g. a map without coastlines; a fully transparent `labelHalo` draws labels with no halo (width 0).

UI chrome (tooltip, attribution, map focus ring) reads `--ca-text`,
`--ca-text-muted`, `--ca-surface`, `--ca-stroke`, `--ca-focus`, `--ca-font`, each
with a fallback (the timeline's own list: §6.1). Every selector starts with a `.ca-`
class: `.ca-globe`, `.ca-globe__map`, `.ca-globe__tooltip`, `.ca-globe--stars`,
`.ca-globe-host`, `.ca-timeline*`. No `:root` writes, no bare element selectors.

## 6. Timeline, custom element

### 6.1 `Timeline` (from `src/timeline/`, re-exported)

Framework-free bottom timeline (root §5.4, UX §7.2). Everything it creates is in one
`.ca-timeline` root appended to the container; styles in `src/timeline/timeline.css`
(included in `style.css`). Wiring to the globe (coarse LOD while the user scrubs or
plays, full LOD when committed):

```ts
const m = await globe.borders.ready();
const timeline = new Timeline(bar, {
  min: m.years.from, max: m.years.to, present: m.years.present, value: globe.getYear(), frames: m.frames,
  onInput: (y) => { globe.setInteracting(true); globe.setYear(y); },   // live: drag (≤ 1 per animation frame), keys, buttons, playback
  onChange: (y) => { globe.setInteracting(false); globe.setYear(y); }, // committed (URL pushState here)
});
// selection: timeline.setHighlight(info ? info.spans.map(([from, to]) => ({ from, to })) : null)
```

| Option | Default | Notes |
| --- | --- | --- |
| `min`, `max`, `value` | required | Non-zero integer years, `min < max` (else `RangeError`); `value` is rounded and clamped, 0 → 1. |
| `stops` | `defaultStops(present)` | `[year, t][]`, both strictly increasing; extended with the outer slopes when `[min, max]` is wider. |
| `present` | `max(2026, max)` | Last default stop. |
| `frames` | none | `manifest.frames`: density strip and previous/next-change buttons (hidden without frames). |
| `eras` | `DEFAULT_ERAS` | `{ from?, to?, label, short?, title? }[]`, or `false` to hide the band (defaults: the six AP World History periods). |
| `highlight` | `null` | A span or an array of spans (inclusive), drawn as brass bands. |
| `labels` | `DEFAULT_TIMELINE_LABELS` | Partial UI strings, plus `formatYear` (visible) and `spokenYear` (`aria-valuetext`). |
| `speed`, `speeds` | `1`, `[0.5, 1, 2, 4]` | Clamped to 0.25–4 (the reference site: `[0.25, 0.5, 1, 2]`). |
| `sweepSeconds` | `120` | A full sweep of the track at 1×. |
| `layout` | `'stacked'` | `'bar'`: one row of separate controls (transport, year, a thick track with its tick lines inside, speed menu) on a transparent root, the track on a row of its own in compact containers; no density strip, tick labels or era band (`eras` is ignored). See **Bar layout** below. |
| `step` | `'adaptive'` | Step of the back/forward buttons: a whole number of years (e.g. `1`), or `'adaptive'`. Page Up/Page Down stay adaptive. Invalid values fall back to adaptive. |
| `yearField` | `'input'` | `'input'`: the typed-year field; `'label'`: the year as text only (`aria-hidden`; the slider carries the value). |
| `changeButtons` | `true` | `false` leaves out the previous/next-change buttons (`[` and `]` still jump). |
| `onInput(y)`, `onChange(y)`, `onPlayChange(playing)` | | `onInput` on every user change; `onChange` once per commit: pointer release, each key press (auto-repeat commits on keyup), a button click, an applied typed year, playback pausing or reaching the end. |

Methods: `getValue()`; `setValue(y)` (never calls back; ignored during a drag; seeks
during playback); `setHighlight(span | spans | null)`; `setFrames(frames | null)`;
`play()`; `pause()` (commits with `onChange`); `togglePlay()`; `isPlaying()`;
`getSpeed()`; `setSpeed(s)`; `stepBy(±1)` (one step of the back/forward buttons: the
`step` option, adaptive by default); `stepChange(±1)` (previous/next change, `null` when
there is none); `resize()` (only without `ResizeObserver`); `destroy()` (idempotent);
property `element` (the root).

- **Keyboard** (slider focused): ←/↓ and →/↑ ±1 year (skipping 0), Shift ×10,
  PageUp/PageDown the adaptive step (landing on its multiples), Home/End, `[`/`]`
  previous/next change, Space or K play/pause (`[`, `]`, K also work from the other
  timeline buttons). Typed-year field (`parseYear`): Enter applies (invalid or out of
  range → `aria-invalid` and a `role=alert` message), Esc reverts (it stops propagation
  only when there is something to revert, so a host's Esc still closes its panels),
  blur applies a valid edit and reverts an invalid one.
- **Scale:** `createTimeScale(stops)` → `{ toT, toYear, stops, domain, range }`,
  interpolated in astronomical years (1 BCE and 1 CE are one year apart), `toYear`
  never returns 0, `toYear(toT(y)) === y`, clamped outside the stops; `DEFAULT_STOPS`
  (present 2026), `defaultStops(present)`.
- **Behaviour:** adaptive step ≈ 1 % of the visible t span in the direction of travel,
  rounded to 1/5/10/20/50/100/200 years; tick labels by priority (millennia, 1 CE, the
  stops, fill-ins), ≥ 56 px apart centre to centre and 6 px edge to edge, re-laid out on
  resize; density strip = changes per year within ±12 px against the track's 95th
  percentile; playback at constant track speed (reduced motion: 0.5 s steps; frame time
  capped at 0.25 s; stops at `max`, play there restarts from `min`); pointer events on
  the whole 58 px scale area (`touch-action: none`), the thumb grabs within 10 px
  (mouse) / 22 px (touch).
- **Bar layout** (`layout: 'bar'`, `data-ca-layout="bar"`; the reference site uses it
  with `step: 1`, `changeButtons: false` and the typed year): a CSS grid
  `transport | year | track | speed` on a transparent root, every control the same
  surface, themed by `--ca-control-size` (40px), `--ca-control-radius` (12px),
  `--ca-control-gap` (8px), `--ca-control-bg`, `--ca-control-bg-hover`,
  `--ca-control-border`, `--ca-control-text`, `--ca-control-text-hover`,
  `--ca-control-shadow` and `--ca-control-blur` (a host that draws its own buttons from
  the same properties gets identical controls; the site does). The track is as tall as
  the buttons: tick lines centred inside it (majors placed as if labelled, minors ≥ 9 px
  apart), the lifespan band and a brass bar thumb; the hover bubble floats above. A
  fixed step hides the step number (it is in the buttons' names and titles; titles hint
  ←/→ for a one-year step). Compact containers (< 640 px): two rows, the track first;
  the typed year at 16 px (no zoom on phones) with its error centred above the whole
  bar. Tiny containers (< 360 px): 5 px gaps, a narrower year field, the speed menu as
  a square pill (it stays visible), so everything fits from 320 px at 44 px controls.
- **Layout (stacked):** 105 px tall. Below a **container** width of 640 px the compact layout is
  117 px (38–42 px controls, 20 px thumb, typed year at 16 px, speed menu a 44 px pill);
  below 380 px the step buttons drop their numbers and the row tightens; below 360 px
  the speed menu is hidden (playback keeps its speed), so "3400 BCE" fits from 320 px.
  Docked at the bottom: `--ca-timeline-safe-area: env(safe-area-inset-bottom)`, and no
  `overflow: hidden` (the typed-year error floats above the top edge).
- **Theming:** `--ca-surface`, `--ca-surface-2`, `--ca-stroke`, `--ca-text`,
  `--ca-text-muted`, `--ca-text-faint`, `--ca-accent`, `--ca-accent-ink`, `--ca-focus`,
  `--ca-danger`, `--ca-font`, `--ca-font-display`, `--ca-color-scheme`,
  `--ca-timeline-inset`, `--ca-timeline-density`, `--ca-timeline-blur`,
  `--ca-timeline-safe-area`. Rails, ticks and the era band are tints of `--ca-text`, so
  a light theme only needs light surfaces and dark text; forced colours have own styles.
- **Demo and visual QA:** `npx vite --config packages/globe/src/timeline/demo.vite.config.mjs`
  serves `demo.html` on a free port (Vite prints the URL; `packages/borders/data` when
  built, embedded frames otherwise; `window.demoTimeline`); `demo.html?layout=bar` shows
  two bars with the site's options and `--ca-control-*` tokens (typed year, and year
  label). `node packages/globe/src/timeline/demo.screenshot.mjs` writes 20 PNGs to
  `.cache/screenshots/timeline-*.png` (desktop, 2×, light, forced colours, phones at
  390/360/320 px, the bar at desktop/390/320 px) and fails on layout problems at 13
  widths (320–2560 px: label spacing, overflow, controls on one row, year field narrower
  than "3400 BCE"; for the bars: one row ≥ 640 px and two below, equal control heights,
  the year fits "3400 BCE" without moving the track, the speed menu visible, the
  typed-year error on screen), console errors or third-party requests. The bar's DOM
  (and Tab) order is transport, year, track, speed; its year label is at least 7em.

### 6.2 `<chrono-globe>`

`defineChronoGlobeElement(tagName = 'chrono-globe', defaults?)` registers the
element (no-op if already defined). Attributes: `manifest-url` (required),
`year`, `center="lon,lat"`, `scale`, `labels="false"`, `font-family`,
`selected`. Live attributes: `year`, `selected`, `labels`. Property:
`el.globe` (the `ChronoGlobe`), `el.year`. Bubbling `CustomEvent`s with the
callback argument as `detail`: `ca-ready`, `ca-yearapplied`, `ca-hover`,
`ca-select`, `ca-viewchange`, `ca-interactionend`, `ca-loading`, `ca-failure`.
Connect creates the globe, disconnect destroys it.

### 6.3 Helpers

`fitZoom(w, h)`, `scaleToZoom`, `zoomToScale`, `normalizeView`, `roundView`,
`bboxOfCoordinates`, `unionBBoxes`, `bboxCenter`, `bboxToLngLatBounds`,
`wrapLon`; `blendPalette`, `hoverPalette`, `overlayLinePalette`,
`slotColorExpression`; `DEFAULT_THEME`, `resolveTheme`, `readCssTheme`,
`cssVarName`; `buildBaseStyle`, `borderLayerSpecs`, `borderSources`,
`borderIds`, `layerOrder`, `skySpec`, `fontStack`, `externalUrls` (lists every
string in a style that would leave the origin); `splitParts` (one Polygon feature
per part with the same `id` and properties; use it before putting `bordersAt()`
output into your own MapLibre source, §4.1); `FrameScheduler`, `sameFrame`;
`hatchImage`; colour utilities (`parseColor`, `blendOver`, `mix`,
`contrastRatio`, `normalizeColor`); `formatSpan`, `hoverLabel`, `pickOrder`.

## 7. Performance

### 7.1 Real dataset (measured 2026-10-02, pipeline build 0.1.0, site at 1440×900)

The site's year change through the globe (`await globe.layers.setYear(y)`, from the
request to the rendered frame), years 1500–2026 and −500–1200 in other chunks;
"cached" = the chunk was already loaded. Local preview server, so a new chunk's time
includes its download (an l2 chunk: ~1.2 MB gzip, ~190 ms on localhost).

| View (LOD) | GPU p50 · cached | SwiftShader p50 · cached | Before culling + coast source (GPU p50 · cached) |
| --- | --- | --- | --- |
| World, z1.5 (l0) | 247 ms · 143–230 ms | 421 ms · 335–442 ms | 285 ms · 214–266 ms |
| Europe, z3.6 (l1) | 515 ms · 283–452 ms | 891 ms · 564–833 ms | 650 ms · 472–558 ms |
| Aegean, z5.6 (l2) | 374 ms · 106–178 ms | 565 ms · 127–189 ms | 1,130 ms · 866–969 ms |

A frame of this dataset is 3–5× the dev dataset (l0 ~60 k polygon + ~55 k line
vertices; l2 ~320 k + ~310 k). Profiled per year change (l0, world view, GPU):
MapLibre's own message serialisation (~50 ms main thread + ~40 ms worker),
geojson-vt (~35 ms), globe fill subdivision (~25 ms), line buckets (~15 ms),
decoding (5–35 ms). Culling keeps ~12 % of an l2 frame at z5.6 and ~75 % at z3.6
(the visible cap is nearly a hemisphere there); keeping the coast out of the
per-frame source saves ~45 % of the vertices whenever the chunk's coast is
unchanged (most frames: 433 of 546 frame changes at l0, 529 of 546 at l2).
The site's e2e (`apps/site/scripts/e2e.mjs`) prints `yearChangeMs` (l0) and
`yearChangeL2Ms` (l2) on every run, for spotting regressions.

### 7.2 Dev dataset (measured 2026-10-01, 1280×800, world view)

`node packages/globe/scripts/screenshots.mjs [--gpu]` → `.cache/screenshots/globe-timings[-gpu].json`.

| Renderer | Year change, chunk cached (p50 / p90) | New chunk (p50 / p90) | Timeline drag 77 years in ~1.5 s | Settle after release |
| --- | --- | --- | --- | --- |
| GPU (RTX 2080 Ti, Edge/D3D11) | 134 / 150 ms | 99 / 133 ms | 13 frames drawn (l0) | 146 ms |
| SwiftShader (CPU WebGL, CI-like) | 315 / 447 ms | 188 / 274 ms | 8 frames drawn (l0) | 329 ms |

SwiftShader runs vary by about ±25 % between runs; compare like with like.

- Decoding a frame from cached chunks takes 10–30 ms; the rest is MapLibre
  re-tiling the frame source in its worker and drawing. "New chunk" years are
  mostly early ones with few polities, hence faster than the cached 1860–1945 set.
- Use `setInteracting(true)` while scrubbing or playing (l0, ~5 km tolerance).
  Frames inside the same `frameOf` range cost nothing.
- `globe.borders.prefetch(year)` warms a chunk (e.g. on timeline hover);
  `createBorders(…, { cacheChunks })` sizes the chunk LRU.
- Bundle (incl. the timeline): `dist/index.js` ≈ 140 kB unminified (≈ 43 kB
  gzip; MapLibre and the borders client stay external), `dist/style.css`
  ≈ 26 kB (≈ 6 kB gzip).

## 8. Integration recipes

All data paths below assume the dataset at `/data/alexs-atlas/`.
`scripts/recipes.mjs` runs §8.1, §8.2, §8.5, §8.6, the lifecycle behind
§8.3/§8.4 and path A of §8.7 (in headless Edge or Chrome, §9), and fails on any
check, console error or third-party request.

### 8.1 Plain HTML + ES modules (no bundler) — tested (`examples/plain.html`)

Copy to the static host: `node_modules/maplibre-gl/dist/` → `/vendor/maplibre-gl/`,
`node_modules/topojson-client/src/` → `/vendor/topojson-client/`,
`node_modules/@alexs-atlas/borders/dist/` → `/vendor/alexs-atlas-borders/`,
`node_modules/@alexs-atlas/globe/dist/` → `/vendor/alexs-atlas-globe/`,
`node_modules/@alexs-atlas/borders/data/` → `/data/alexs-atlas/`.

```html
<link rel="stylesheet" href="/vendor/maplibre-gl/maplibre-gl.css" />
<link rel="stylesheet" href="/vendor/alexs-atlas-globe/style.css" />
<script type="importmap">
  {
    "imports": {
      "maplibre-gl": "/vendor/maplibre-gl/maplibre-gl.mjs",
      "topojson-client": "/vendor/topojson-client/index.js",
      "@alexs-atlas/borders": "/vendor/alexs-atlas-borders/index.js",
      "@alexs-atlas/globe": "/vendor/alexs-atlas-globe/index.js"
    }
  }
</script>
<div id="globe" style="position: absolute; inset: 0"></div>
<script type="module">
  import { ChronoGlobe } from '@alexs-atlas/globe';
  const globe = new ChronoGlobe(
    document.getElementById('globe'),
    { data: { manifestUrl: '/data/alexs-atlas/manifest.json' }, year: 1453, fontFamily: 'system-ui, sans-serif' },
    { onYearApplied: (y) => console.log('showing', y) },
  );
</script>
```

MapLibre finds `maplibre-gl-worker.mjs` next to `maplibre-gl.mjs` by itself.

### 8.2 Vite — tested (`examples/basic.html` in dev and as a production build)

```ts
// vite.config.ts: export default defineConfig({ worker: { format: 'es' } });
// public/data/alexs-atlas/ = a copy of node_modules/@alexs-atlas/borders/data/
import 'maplibre-gl/dist/maplibre-gl.css';
import '@alexs-atlas/globe/style.css';
import '@fontsource-variable/inter';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ChronoGlobe } from '@alexs-atlas/globe';

const globe = new ChronoGlobe(document.getElementById('globe')!, {
  data: { manifestUrl: '/data/alexs-atlas/manifest.json' },
  year: 1453,
  fontFamily: 'Inter Variable',
  workerUrl,
});
```

### 8.3 React 18/19 (StrictMode-safe `useEffect` wrapper)

React is not installed in this repo, so this file is not compiled here. What it
relies on is tested in the browser by `examples/lifecycle.html`: create → destroy →
create in the same element (StrictMode's double effect), destroy after the
style loaded but before the first frame, destroy during a year change; the
surviving globe keeps working and nothing leaks.

```tsx
// ChronoGlobeView.tsx — client-only wrapper; options are read once at mount
// (change the React `key` to switch datasets).
import { useEffect, useRef, type MutableRefObject } from 'react';
import 'maplibre-gl/dist/maplibre-gl.css';
import '@alexs-atlas/globe/style.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { ChronoGlobe, type ChronoGlobeCallbacks, type ChronoGlobeOptions } from '@alexs-atlas/globe';

type Props = ChronoGlobeCallbacks & {
  options: Omit<ChronoGlobeOptions, 'year' | 'workerUrl'>;
  year: number;
  selected?: string | null;
  globeRef?: MutableRefObject<ChronoGlobe | null>;
  className?: string;
};

export function ChronoGlobeView({ options, year, selected = null, globeRef, className, ...callbacks }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const globe = useRef<ChronoGlobe | null>(null);
  const cb = useRef(callbacks);
  cb.current = callbacks; // handlers see the latest props without re-creating the globe

  useEffect(() => {
    const g = new ChronoGlobe(box.current!, { ...options, year, workerUrl }, {
      onYearApplied: (y) => cb.current.onYearApplied?.(y),
      onHover: (h) => cb.current.onHover?.(h),
      onSelect: (s) => cb.current.onSelect?.(s),
      onViewChange: (v) => cb.current.onViewChange?.(v),
      onInteractionEnd: (v) => cb.current.onInteractionEnd?.(v),
      onLoadingChange: (l) => cb.current.onLoadingChange?.(l),
      onFailure: (r, e) => cb.current.onFailure?.(r, e),
    });
    globe.current = g;
    if (globeRef) globeRef.current = g;
    return () => {
      g.destroy(); // safe mid-load: StrictMode runs mount → cleanup → mount
      globe.current = null;
      if (globeRef?.current === g) globeRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => globe.current?.setYear(year), [year]); // cheap unless the frame changes
  useEffect(() => globe.current?.select(selected), [selected]);

  return <div ref={box} className={className} style={{ position: 'relative', width: '100%', height: '100%' }} />;
}
```

The component touches the DOM only in effects, so it also renders on the server
(an empty `div`). Drive the year from a `Timeline` or your own state; read URL
state after hydration (in an effect) so server and client markup agree.

### 8.4 Astro (`client:only` island, or no framework at all)

Astro is not installed here either; the element path below is the one tested
in the browser (`examples/element.html`), the React path is §8.3.

```astro
---
// src/pages/globe.astro  (astro.config.mjs: vite: { worker: { format: 'es' } })
import { ChronoGlobeView } from '../components/ChronoGlobeView';
---
<div style="height: 80vh">
  <!-- Props must be serialisable: no functions. Put callbacks in a React wrapper island. -->
  <ChronoGlobeView client:only="react" year={1453}
    options={{ data: { manifestUrl: '/data/alexs-atlas/manifest.json' }, fontFamily: 'Inter Variable' }} />
</div>
```

Without a UI framework, a processed `<script>` registers the element:

```astro
<chrono-globe manifest-url="/data/alexs-atlas/manifest.json" year="1453" style="display:block; height:80vh"></chrono-globe>
<script>
  import 'maplibre-gl/dist/maplibre-gl.css';
  import '@alexs-atlas/globe/style.css';
  import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
  import { defineChronoGlobeElement } from '@alexs-atlas/globe';
  defineChronoGlobeElement('chrono-globe', { workerUrl, fontFamily: 'Inter Variable' });
</script>
```

### 8.5 Custom element — tested (`examples/element.html`)

```ts
defineChronoGlobeElement('chrono-globe', { workerUrl, fontFamily: 'Inter Variable' });
const el = document.querySelector('chrono-globe')!;
el.addEventListener('ca-yearapplied', (e) => console.log((e as CustomEvent<number>).detail));
el.setAttribute('year', '1500');                      // or el.year = 1500
el.setAttribute('selected', 'clio:ottoman-empire');
```

### 8.6 Bring your own map — tested (`examples/host-map.html`)

```ts
import { Map, setWorkerUrl } from 'maplibre-gl';
import { createBorders } from '@alexs-atlas/borders';
import { addBorderLayers } from '@alexs-atlas/globe';

const map = new Map({ container: 'map', style: hostStyle /* projection globe or mercator */ });
map.on('load', () => {
  const borders = createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' });
  const layers = addBorderLayers(map, { borders, year: 1453, beforeId: 'graticule', prefix: 'chrono-', fontFamily: 'system-ui, sans-serif' });
  slider.oninput = () => layers.setYear(Number(slider.value));
});
```

Checked: all 14 layers sit directly below `beforeId`, the host's layers stay
intact, `setYear` resolves after the render, `remove()` restores the host's
layer and source lists exactly, and adding again gives the same order.

### 8.7 Migrating the sibling `strhistory` site

The sibling (Astro 7 + React 19 + MapLibre 6) had Gen-1 per-snapshot GeoJSON
(GPL data) and a reverted Gen-2 that streamed third-party vector tiles. Copy no
code from it (it has no licence); these are recipes for its maintainers.

**Path A — Gen-1 drop-in (any year instead of fixed snapshots)** — the data side
is tested in Node (`bordersAt(1783)`: 312 features, every one with `id`, `name`,
`subjecto`, `power`, `partof`, `disputed`, `from`, `to`; `Feature.id` =
`properties.id`). In the code that loaded `world_<year>.geojson`:

```ts
import { createBorders } from '@alexs-atlas/borders';
import { splitParts } from '@alexs-atlas/globe';
const borders = createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' });
let latest = 0;
async function load(year: number) {
  const mine = ++latest;
  const fc = await borders.bordersAt(year, { lod: 'l1' }); // or lodForZoom(await borders.ready(), map.getZoom())
  // One feature per polygon part (§4.1): within one multi-part feature, a sliver island
  // whose winding flips when MapLibre tiles it can leave the whole polity unfilled.
  if (mine === latest) (map.getSource('polities') as GeoJSONSource).setData({ ...fc, features: splitParts(fc.features) });
}
// Dashed approximate extents: a line layer with filter ['==', ['get', 'precision'], 'approximate'].
// Static per-year files instead (Node): createBorders({ manifestUrl: 'data/manifest.json' }, { fetch: fileFetch })
// from '@alexs-atlas/borders/node', then write JSON.stringify(await borders.bordersAt(y)) per year.
```

**Path B — Gen-2 any-year, keep its own style** — tested as §8.6. Replace the
third-party vector source and its year filters with
`addBorderLayers(map, { borders, year, beforeId: 'sea', prefix: 'ca-' })`;
drop the client-side label layout (labels are precomputed); keep the host's
year coalescing or rely on the handle's (latest wins); take the first year from
`(await borders.ready()).years.from`. The sea layer is optional (polygons are
coast-clipped). With a host `glyphs` URL set `fontFamily: 'noto-sans'` (§4).

**Path C — adopt `ChronoGlobe`** — replace the dynamic import of the site's
own controller with `import('@alexs-atlas/globe')` inside the island's effect
(§8.3); keep pins on `globe.map`. API mapping:

| Sibling controller | `@alexs-atlas/globe` |
| --- | --- |
| `new GlobeController(el, callbacks, options)` | `new ChronoGlobe(el, options, callbacks)` |
| `onPolityHover({ name, subjecto, dates, x, y })` | `onHover(info)`: `info.name`, `info.props.subjecto`, `info.label`, `info.point`; `tooltip: false` to keep its own tooltip |
| `setView(center, scale)` | `setView({ center, scale })` |
| `flyTo({ lng, lat }, { minScale })` | `setView({ center: [lng, lat], scale: Math.max(minScale, globe.getView().scale) }, { animate: true })` |
| `fontStack: ['noto-sans']`, `glyphs` | `fontFamily` (local drawing); `glyphs` still accepted |
| `palette(p, year)` | `palette(p)` (`globe.getYear()` if needed) |
| `labelMinScale` | not needed: area thresholds per zoom |
| `onFailure('base-source')` | `onFailure('webgl' \| 'data' \| 'context-lost')` |
| `fitZoom(el)` | `fitZoom(el.clientWidth, el.clientHeight)` |
| `whenReady`, `setYear`, `getView`, `zoomBy`, `resetView`, `startSpin`, `stopSpin`, `destroy` | same names |

### 8.8 Caddy allowlist

The sibling's Caddyfile exposes an explicit `@publicAsset path_regexp` list.
Add this alternative inside its `^( … )$` group, and add
`/data/alexs-atlas/manifest.json` to its access smoke test's public paths:

```
|/data/alexs-atlas/[a-z0-9._/-]+\.json
```

Checked against the dataset: all 148 JSON files match. The character class also
admits `..` and `//` segments, so this line relies on Caddy normalising request
paths before matching. A stricter equivalent rejects them outright (checked: it
also matches all 148 files and none of `/../`, `/./`, `//`, unknown folders):
`|/data/alexs-atlas/(?:(?:chunks/l[0-9]+|base)/)?[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.json`.

## 9. Testing and QA

- Unit tests (`npx vitest run packages/globe`): view math, palette and blending
  (ΔE thresholds, unclaimed land vs ocean), theme/CSS variables, style builder
  (contract layer order, filters, no external URL anywhere in the style JSON),
  frame scheduler (frame-change only, latest wins, stale never drawn, old frame
  kept on failure), `addBorderLayers` against a fake map,
  view culling (cap distance against a brute-force search, part culling), the star
  field's projection (sky: east/north orientation, pinhole scale, orbit direction, rim
  fade), the labels' rim fade, and in the fake-map tests the coast source (re-sent only when the coast
  changes), culling and re-culling after a pan, and the whole-world `l0` fallback
  during camera animations.
- Visual QA (`scripts/screenshots.mjs`): 11 scenes (1914 world/Europe/hover +
  select, 1500 Asia, 500 BCE Mediterranean, 1800 Caribbean, 1700 Americas, 2026
  world, 2026 Aegean z7, 1453 phone, 3000 BCE) plus `synthetic-overlay`
  (tier-1 hatch and approximate dashes, injected into the real 1914 frame
  because the dev dataset has neither yet; a click inside the overlay must
  select it over the polity beneath). Look at the PNGs after style changes.
- Recipes (`scripts/recipes.mjs`): §8. Both scripts fail on console errors and
  on any request to another origin.
- Browser (`scripts/browser.mjs`, shared by both scripts and the timeline demo):
  playwright-core drives an installed browser with SwiftShader WebGL (`--gpu` on
  both scripts: the real GPU). Default: Microsoft Edge, or Google Chrome when Edge
  is not installed (a Mac without Edge). `ALEXS_ATLAS_BROWSER` picks another: a Playwright channel
  (`msedge`, `chrome`, `chromium`, …; `chromium` is Playwright's own build: run
  `npx playwright-core install chromium` first) or an absolute path to a Chromium-based
  executable, e.g. `ALEXS_ATLAS_BROWSER=chrome node packages/globe/scripts/recipes.mjs`.

## 10. Known limitations

- The dev dataset has no `unclaimed` features before 1946: base land then stays
  under the frame at the frame's LOD, and coarse Cliopatria coasts show thin
  land-coloured slivers until the pipeline's clip-to-land step lands.
- Labels sit at one point per polity (the pole of inaccessibility of its largest
  part), so a polity whose label point is near the rim (Qing China or the Russian
  Empire at the default view, a colonial empire labelled at its largest colony) is
  dimmed or unlabelled until the globe turns towards it; at close zoom a polity whose
  label point is off screen shows no name (hover shows it).
- During a fast pan beyond the culled cap, the newly visible strip shows ocean until
  the pan pauses (≤ 150 ms checks) and the re-culled frame is drawn.
- A year change re-sends the whole (culled) frame: MapLibre's `updateData` diffs
  would save the unchanged features (most modern frames change < 10 % of their
  vertices) but need distinct ids for labels and line pieces — not done yet.
- Timeline drags redraw at ~8 fps on a GPU and 3–5 fps on SwiftShader with the
  dev dataset; intermediate frames are skipped, never shown out of order.
