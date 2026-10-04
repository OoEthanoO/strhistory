<!--
  Imported from the Alex's Atlas repository (alcaholex/chronoatlas, commit 0a9ce44)
  together with packages/. Task status of the borders dataset, pipeline and globe
  modules; see packages/AGENTS.md.
-->

# todo.md — Alex’s Atlas

Legend: `[ ]` open · `[~]` in progress (owner) · `[x]` done and verified · `[-]` dropped (reason)
Contracts: [AGENTS.md](AGENTS.md) §5 · override guide: [packages/borders/AGENTS.md](packages/borders/AGENTS.md)

## Phase 0 — Scouting (orchestrator) ✔
- [x] Read Running Reality data-source, data-use-policy, FAQ, embedding, JS-API, privacy, submission, copyright, ad, citation pages; robots.txt
- [x] Decide: no bulk extraction from RR (policy + watermark); RR only via sanctioned iframe embed
- [x] Project decision: no automated tracing of RR's rendered maps (AGENTS.md §2.1)
- [x] Confirm RR can be iframed (no X-Frame-Options / frame-ancestors); `rr.js` not used
- [x] Tooling inventory: Node 24, npm 11, Python 3.12 (+ venv with shapely/numpy/pyproj), 16 CPUs, 32 GB RAM; no WSL/Docker/Java

## Phase 1 — Research ✔ (reports in the session scratchpad; conclusions folded into AGENTS.md)
- [x] Licences + download URLs verified from primary sources (Cliopatria CC BY 4.0, NE public domain, rejected GPL/NC/SA sources)
- [x] Cliopatria deep-dive (508 frames, inclusive years, leaf polities, ghost colonies, coarse coasts, wrong QIDs)
- [x] Globe of History UX teardown (layout to keep, timeline to improve, do-not-copy list)
- [x] Sibling `strhistory` integration contract + lessons
- [x] Running Reality embed spec (hash grammar, update strategy, consent, caption)
- [x] Rendering tech (MapLibre 6 globe, era-chunked TopoJSON, measured ≈115 ms per year change)
- [x] Pipeline feasibility (clip 39 s, sizes per LOD/chunk, island statistics)

## Phase 2 — Contracts ✔ (orchestrator)
- [x] Root AGENTS.md: architecture, module contracts, rendering rules, UX spec, licences, decisions
- [x] packages/borders/AGENTS.md: conventions, override ops, geometry specs, modern unit timelines, editorial policy
- [x] overrides/schema.json + tools/validate-overrides.mjs (tested with planted errors)
- [x] Pinned sources in .cache/sources (Cliopatria sha256 verified, NE 5.1.2 + SHA256SUMS)
- [x] tools/reference.py → .cache/reference (NE admin0/admin1/disputed lists, Cliopatria inventory per region, frames)
- [x] pipeline/config.json + py/common.py (record contract, Ctx with NE layers, tested)
- [x] Monorepo scaffold (npm workspaces), dev dependencies installed

## Interruption log
- 2026-10-01 ~19:55 EDT: account usage limit hit (reset 22:20). ~45 parallel agents had burned the window in under an hour and left most work half-done. Saved on disk: query API (done), large parts of pipeline py/node, globe, timeline; override files modern/caribbean-south-america (complete audit), modern/north-central-america, historical/southern-asia, historical/northern-america-indigenous (all validate).
- 2026-10-02 ~00:05 EDT: user hit usage limits again (Max 20x). STOPPED the LLM research fan-out for good. New approach: deterministic programs (packages/borders/pipeline/factcheck/: Wikidata cross-checks of Cliopatria, Wikidata-based coverage-gap list, Wikidata-based modern unit timelines for every unit not curated, raster tile QA of the built data). LLM agents only build code; curated override files already written stay authoritative.
- 2026-10-01 23:40 EDT: resumed in PRIORITY ORDER with capped concurrency — (1) build (resume of wf_073705e8-f9f; agents continue from files on disk), (2) modern unit timelines (chronoatlas-audit-modern-v2, ≤4 groups at once). Next: (3) historical 1700–1945, (4) pre-1700, (5) final integration + verification.

## Phase 3 — Build ✔ (workflow alexs-atlas-build; docs merged 2026-10-02)
- [x] PG1 pipeline geometry core (py): normalise → overrides → clip to land → modern → frames (islands + coastal gaps) → attributes → QA → `.cache/build/final/*`; unclaimed land per connected polygon (real run: 753 s, 14 workers)
- [x] PG2 override engine (py): geometry-spec resolver, delete/update/subtract/add/assign, modern layer from unit timelines + overlays, application log, `--dry-run`
- [x] PK packaging (node): build.mjs orchestrator, fetch/verify, noding + spherical DP per LOD (microstate-safe), era chunks, TopoJSON, base land/lakes, manifest, polities index, ATTRIBUTION/LICENSE/sources, catalog.mjs, frame previews
- [x] Q query API (`packages/borders/src`) + unit tests; `@alexs-atlas/borders/node` (`fileFetch`)
- [x] G globe component (`packages/globe/src`): ChronoGlobe, addBorderLayers, styles, hatch, labels, hover/select, LOD, RR panel, culling, rim fade; package AGENTS.md + tested recipes (`scripts/recipes.mjs`)
- [x] T timeline component + time scale + tests + demo screenshot QA (320–2560 px)
- [x] S site (`apps/site`): layout, search, polity panel, list view, URL state, credits, RR view, data sync, screenshot + e2e scripts; apps/site/AGENTS.md

## Phase 3b — Fact-check audit (LLM fan-out STOPPED 2026-10-02; replaced by the toolkit in 3c)
- [-] Remaining LLM audit groups (modern units, historical 1700–1945 by region, early < 1700, two verifiers per file) — stopped (usage limits); curated files kept: modern/caribbean-south-america, modern/north-central-america, modern/europe-east-central-asia, historical/northern-america-indigenous, historical/southern-asia
- [ ] `npm run data:validate -- --complete` passes again (blocked: see Open issues 1)

## Phase 3c — Deterministic fact-check toolkit ✔ (packages/borders/pipeline/factcheck/)
- [x] wikidata.py cached client · check_cliopatria.py (QID type/name/date checks → overrides/*/auto-wikidata.json) · coverage_gaps.py (known-gap lists) · modern_autogen.py (timelines for units no curated file covers) · tile_qa.py (raster QA of a built dataset)
- [x] Ran for real: 1,416 QIDs checked (21 active fixes, 307 suspect + 681 date notes proposed), 642 known-gap candidates, 185 modern units generated (70 medium / 115 low)
- [x] Root scripts: `npm run data:factcheck` (run_all.py) and `npm run data:tileqa` (tile_qa.py)
- [ ] Review queue for people: low-confidence modern units (115, notes in modern/auto-wikidata.json), proposed QID notes, coverage gaps by region (.cache/factcheck/*.md)

## Phase 4 — Integrate and verify
- [x] PI pipeline integration: tier-0 carving add re-draws its own pid, `record` specs read before other adds carve, rims < 50 m absorbed / land-less pieces dropped, validator rejects pid attribute conflicts, dry run at validate, snap 3e-5° / node 1e-4°, packager refuses QA-failed builds, `verify_built.py`
- [x] SI site integration on the real build (staged, via `ALEXS_ATLAS_DATA`): coast source, view culling, rim fade, year-change profiling; e2e (99 checks) + screenshots green
- [x] Coast/island alignment QA on the staged real build: 7 years × l0/l1 + 6 archipelago previews (`.cache/build/verify/staging`) — rerun after publishing
- [x] Override catalog generated (`npm run data:catalog`; full catalog moving to `overrides/CATALOG.md`, summary in packages/borders/AGENTS.md)
- [x] Docs pass 2026-10-02: root AGENTS.md §3/§4/§5/§7/§8/§9/§11, packages/borders/AGENTS.md §6 Pipeline + §7 API, packages/globe/AGENTS.md (timeline, flyToPolity + map padding), apps/site/AGENTS.md; root scripts `e2e`, `screenshots`, `data:factcheck`, `data:tileqa`; timeline compact year field fixed in the package (site workaround removed); flyToPolity compensates host map padding
- [ ] Full pipeline run with all overrides published to `packages/borders/data` (≈ 19 min; QA gates green) — blocked by Open issues 1; then rerun `npm run e2e` and `npm run screenshots` without `ALEXS_ATLAS_DATA`
- [ ] Override application check: every active entry applied (last run: 397 applied, 1 stale, 9 errors — all Open issues 1), rendered result spot-checked
- [ ] Code review (bugs) and modularity review (simulated adoption in a scratch copy of strhistory)

## Open issues (2026-10-02)
1. **Blocker — `overrides/modern/auto-wikidata.json` (factcheck `modern_autogen.py`)**: units disagree on a shared pid's attributes (16 validator / 9 engine errors), so `data:validate`, `npm run check` and `data:build` stop at validate: `ne:pak` 1947–1955 (PAK "Dominion of Pakistan" Q2006542 vs BGD "Pakistan" Q843); `ovr:yugoslavia` (SRB, MNE Q36704 vs BIH, HRV, KOS, MKD, SVN Q83286 — AGENTS.md says Q83286); `ne:cod` 1961–1968 given to the COG unit (wrong); `ovr:british-military-administration` 1946–1949 (LBY power `ne:fra` vs SOM `ne:gbr`, different QIDs); BGD 1946 `clio:british-raj` vs PAK `ovr:british-raj`. Also wrong names in some generated timelines.
2. Stale entry `h-northern-america-indigenous-0055` (subtract misses `clio:haudenosaunee` 1768–1782).
3. Microstate QA gate holds at l1/l2 but not at l0 (quantization 1e5 moves atoll states and Monaco by 1.2–2.6 %; NE's 0.01 km² Vatican is 40 % off at l1/l2 and a stand-in at l0): raise l0 quantization (bigger files) or scope the gate to l1/l2.
4. React and Astro recipes (packages/globe/AGENTS.md §8.3/§8.4) are not compiled or run: react, react-dom, @types/react and astro are not installed (the lifecycle they rely on is checked by examples/lifecycle.html). Optional install by the orchestrator.
5. After publishing the real build, re-check: colour slots of neighbours (dev 1800: Haiti and the Spanish Empire both slot 9), Grand Cayman unclaimed in 1800 (British under Jamaica), polity `altNames` in search ("persia", "rome"), `manifest.frames` after 1946 (`]` beyond 1946); site e2e is 99/99 on the staged real build but 98/99 on the dev build (culling check, data effect).
6. `manifest.sources` 'override' URL is repo-relative (`packages/borders/AGENTS.md#5-override-catalog`) until the project has a public repository URL.
7. Resolved 2026-10-02 — macOS without Microsoft Edge: the browser scripts (site harness, globe screenshots/recipes, timeline demo) launch Edge and fall back to Chrome when Edge is not installed; `ALEXS_ATLAS_BROWSER` picks a Playwright channel or an executable path (`packages/globe/scripts/browser.mjs`, root AGENTS.md §9). `npm run dev` needs only `npm ci` first.
8. `packages/borders/pipeline/tests/budgets.test.mjs` fails on macOS: gzip sizes differ with the local zlib (1.2.12; 3400bce l0 chunk 132,469 vs 130,530 bytes in the manifest), so `npm run check` fails there. Compare with a tolerance instead of exact bytes.
9. Cost audit 2026-10-02: no API keys or paid services in code, history or GitHub settings. GitHub Pages from this private repo relies on the account's Pro-level features; no payment method is on file, so Actions/storage overages are blocked, not billed (confirm at github.com/settings/billing; a public repo makes Pages and Actions free on any plan).
10. Resolved 2026-10-02 — polities drawn in the ocean colour at some zooms: from 1946 the USA at map zoom 2–3 (≈ 63 k px unfilled at 900×700), the Spanish Empire 1700–1702 around Central America and the Caribbean at zoom 2–3 (≈ 9–10 k px), India / British Raj specks at the minimum zoom on phones (≈ 90 px). Cause: MapLibre classifies a feature's rings per tile by winding relative to the first ring; geojson-vt rewinds rings before rounding them to tile coordinates, so a sliver part (Santa Rosa Island, Florida) flipped and made the mainland a "hole". Fix: one feature per polygon part (`splitParts`, packages/globe/src/cull.ts; root §5.5, globe AGENTS.md §4.1, exported for path-A hosts). Verified: offline replay of geojson-vt + classifyRings over all 593 frames × 3 LODs × tile zooms 0–7 (3,120 flagged frame/LOD/polity cases → 1, a sub-pixel pinhole case in the Byzantine Empire 1305 at z7 that renders correctly) and before/after renders in Chrome.
11. Data follow-up for the packager: it emits sub-tolerance sliver parts and a few outer rings wound clockwise (1946 l0 USA: two 4-point slivers off Louisiana and Florida) despite the RFC 7946 winding guarantee (§5.2). After simplification: rewind rings, drop parts that collapse below the LOD tolerance, put each polity's largest part first, and add a winding check to QA. Rendering is already protected by `splitParts`.

## Minimal site UI (2026-10-02, user request; root AGENTS.md §7)
- [x] Site rebuilt minimal: centred year (no subtitle); search with the list of polities + map key at the top left (panels open to the right); About with the credits at the top right; zoom in / zoom out / reset view as three separate buttons bottom left; the timeline bar; one button style (`--ca-control-*`). Removed: brand bar, toolbar, polity panel/sheet, list drawer, credits chip, Share, RR view
- [x] `Timeline` options `layout: 'bar'`, `step`, `yearField`, `changeButtons` (packages/globe): thick track with tick lines inside, hover bubble, ±1-year buttons, typed year, play, speed; compact/tiny layouts down to 320 px
- [x] Running Reality removed everywhere (site, globe package, recipes, docs, CSP, `data/ATTRIBUTION.md` regenerated without the "Not a source" note)
- [x] e2e rewritten (178/178 on the production build, 175/175 `--dev`), 54 screenshot scenes, 43 timeline option tests + bar checks in the timeline demo
- [x] Independent spec / bug / leftover review (workflow `minimal-ui-verify-2`): four bugs, fixed in the next section; smaller items open below
- [x] Deployed 2026-10-02 (commit 2e4278e, Pages run 37052229884: build 58 s, deploy 14 s); live check: new UI, 1946 USA filled at zoom 2.5, 0 console errors, same-origin requests only

## Site look and fixes (2026-10-02, user requests; not deployed yet)
- [x] Doubled tick near 1200 BCE: bar minor ticks keep the normal spacing to every neighbour and to labelled ticks; the tick on a scale break wins (ticks.ts + 2 tests)
- [x] Review bugs: (1) a search result from another era now pushes one history entry, so Back returns to the year you came from; (2) typing a year during playback no longer gets overwritten by the running year (the field catches up on blur); (3) forced colours (Windows high contrast): the bar's track and typed-year focus use system colours; (4) Tab from the search field no longer stops on the list's scroll area, and Space inside the search panel or the key no longer toggles playback
- [x] Off-globe picking: a point in space picks nothing (MapLibre answered with the nearest horizon point, e.g. South America beside an Africa-centred globe) — `globeDisc` in rim.ts, guard in `featuresAt`
- [x] Newsreader everywhere (menus, tooltips, labels), Inter removed from the site
- [x] No atmosphere (the whitish haze at the globe's edge)
- [x] 3D star field (`sky.ts`): stars at infinity turn with the camera; 26 000 stars with a visible faint floor on a grey sky; fade within 1.75 globe radii; 8 unit tests
- [x] Recolour: the Claude app's dark greys (sampled from the user's screenshot: chat side `#151515` behind the globe and stars, bubble `#212121` for menus and buttons); Victoria 3-style map (`apps/site/src/map-colors.ts`: 17 identity colours by explicit `power` keys; 12 slots tuned on the borders that occur, every neighbour pair ≥ ΔE 8; slate sea, stone-grey unclaimed land); key and search swatches from the same functions; About text updated
- [x] Speed menu 0.25×, 0.5×, 1×, 2× (site `speeds`; the timeline's minimum speed is now 0.25)
- [x] Map look, second pass: pastel watercolour classic colours (21 powers: Britain pink, Canada red, USSR deep red, PRC coral red, Qing/ROC yellow, India saffron, Germany tan, …), each polity outlined in a deeper shade of its own colour (new `theme.edge`, layer `ca-edge`), no coastlines/shared borders/hover outline, white selection outline, Victoria 3 grey for unclaimed land, muted mid-blue sea; slots re-tuned (neighbour pairs ≥ ΔE 8 but 155 frame-pairs)
- [x] Curved labels (`labelMode: 'curved'`, `label-lines.ts`): capitals along an arc through each polity, letter-spaced, in the polity's outline colour with a dark grey outline, smaller relative to the polity when zooming in, hidden when they do not fit, short form when the full name does not fit; 11 + 2 unit tests
- [x] Chrome: charcoal greys (#1f1f1f / #242424) and white accents in the spirit of Globe of History (user decision; own values, root AGENTS.md §7.5); dimmer stars
- [x] Renamed ChronoAtlas → Alex’s Atlas in every file (packages `@alexs-atlas/*`, `/data/alexs-atlas/`, schema `alexs-atlas.borders/1`, env `ALEXS_ATLAS_*`, test hook `window.alexsAtlas`); the local folder keeps its name; GitHub repo not renamed yet
- [x] USDA Forest Service credit in About (58 North American indigenous override entries use its CC BY 4.0 cession polygons; manifest.json and ATTRIBUTION.md still lack it until the pipeline credits it: Native-nations plan phase 1)
- [ ] Native nations plan (research workflow 2026-10-02, notes in .cache/audit/): phase 1 = credit USFS in the pipeline + a real licence gate, a Royce-cession generator for ~100–250 US nations 1784–1894, ICC/NPS areas, Canada's historic treaties, Alaska/Yukon (≈ 55–90 agent-hours); decisions for the user listed in the plan; needs a data rebuild (sources + venv on this Mac)
- [ ] Data gap: Beijing is unclaimed in 1925 (between `clio:kuomintang` 1920 and the Republic of China from 1930)
- [x] Labels, second pass: MapLibre's angle check disabled for the smooth arcs (globe line subdivision made it reject them), compact polities horizontal, resized while zooming, hidden when zoomed out, common map names for long official names ("German Empire" → "Germany")
- [x] Flag colours for every country without a classic colour, and its clear predecessors (generator `apps/site/scripts/country-colors.mjs` → `src/country-colors.ts`): 188 countries, 133 on their flag's first colour, 5 neighbour pairs below ΔE 8 (Emirate of Afghanistan / Russian Empire 5.2 over 27 frames the longest)
- [x] Sea-floor relief removed again (user request, 2026-10-02: flat sea; tiles, generator and About credit deleted, the globe's `relief` option kept). Was: sea-floor relief on water only (user request; land relief tried and removed; stand-in for Globe of History's Mapbox satellite style, which needs its owner's key and third-party tiles): Natural Earth 1:50m Ocean Bottom → `apps/site/public/sea-relief/` (341 WebP tiles, 21.8 MB) via `apps/site/scripts/sea-relief-tiles.py`; globe option `relief` with `under`
- [x] Labels when zoomed out (user request): shown down to scale 0.5 (was 1.15), and arcs get lead-ins up to tile zoom 2 so names are no longer halved by MapLibre's fit check at the whole tile zoom (1914 at the default view: 0 → 7 labels; zoomed in unchanged). MapLibre still drops an occasional label at some positions (French Africa at scale 0.75)
- [x] Curved labels, third pass (user requests 2026-10-03): Saudi Arabia labelled at mid zoom, Russia spread wider, China centred (its arc reaches Manchuria), the Eastern Roman Empire labelled across the Mediterranean (main body of nearby parts, gaps filled in), small labels held at 9 px when zooming out instead of hidden (left out past 2× their arc). Second pass after an adversarial review: gaps bridged only over sea (other polities' land tested with a grid index of the frame), one band per arc, names slide onto own land, angle check off (British Raj/Qing were dropped), smaller letter spacing at small sizes. Third pass after a second review: 4 seeds (best own-land arc wins), hops between islands across open sea (Philippines, Japan), names slide onto the visible side (Russia west from Europe) and refresh after pans, held 9 px names need 70 % own land and 25° from the horizon, the glow capped to the type size (it drew rectangles) and switched to a soft dark glow (the white one cut contrast to ≈ 2:1)
- [ ] Narrow polities (Italy, Chile, the UK) get a label only from zoom ≈ 4: their height limit (42 % of the width) keeps the type under 9 px before that
- [ ] Open from the review: the open search panel covers the big year on narrow screens; on phones the typed-year error briefly overlaps the reset-view button; unused leftover code
- [ ] Open questions to the user: the yellow lifespan band across the 1946 cut-over (join by Wikidata id / remove the band / label it); Cliopatria's fort and trading-post rhombuses (keep / dots / hide); a sourced fix for US claims vs Native control in the West (blocked by open issue 1)
- [ ] Data gap found while recolouring: 1946–1990 the map shows one unified Germany (`ne:deu` covers Berlin, Leipzig and Bonn in every year): no Allied occupation zones (1946–1949), no West and East Germany (1949–1990). Needs sourced modern unit timelines (`overrides/modern/`; build blocked by open issue 1). In 1945 Cliopatria draws the occupation zones as the occupiers' territory (Berlin and Leipzig Soviet, Bonn French).

## Handoff (2026-10-02, local session → cloud session; branch `alexs-atlas-redesign`)
State: everything below "Site look and fixes" is done and tested on that branch, **not deployed** (Pages deploys `main` only) and the GitHub repo is **not renamed** (the user said "not yet"; renaming moves the site to alcaholex.github.io/alexs-atlas/).
- Verify: `npm ci`, then `npx tsc -b`, `npx vitest run` (one known macOS-only failure: budgets.test.mjs, open issue 8), `npm run e2e` (178 checks with a build; `--dev` 175). The browser scripts need Chrome or Edge, or `ALEXS_ATLAS_BROWSER=chromium` after `npx playwright-core install chromium`.
- Generated site assets: `apps/site/src/country-colors.ts` (`node apps/site/scripts/country-colors.mjs`, needs only the committed dataset).
- Open with the user: Native-nations plan (`packages/borders/research/native-nations/plan.md`, decisions in its §5); the lifespan band across the 1946 cut-over (join by Wikidata id / remove / label it); Cliopatria's fort rhombuses (keep / dots / hide); a sourced US-claims fix (blocked by a data rebuild); plaintext git token in `~/.git-credentials` on the local Mac (`credential.helper store`); deploying (merge to `main`) and renaming the repo.
- The user's recent direction: Victoria 3-style political map (pastel, classic colours, flag colours for the rest), Globe of History's lighter chrome with white accents (own values), curved capital labels, a flat sea (sea-floor and land relief were both tried and removed), no Globe of History assets.

## Later / ideas
- [ ] OpenHistoricalMap refinement module for 1700+ detail (CC0 with OSM-import exceptions)
- [-] Tracing workbench (hand-tracing over RR's embedded map) — dropped (Running Reality dropped 2026-10-02)
- [-] Ask Running Reality for licensed data (email draft in the RR research report) — dropped (Running Reality dropped 2026-10-02)

## Status 2026-10-02 (morning)
- [x] Real dataset published to packages/borders/data (`alexs-atlas-borders` 0.1.0, 304 MB raw on disk, l0/l1/l2): validate 0 errors, 461 overrides applied (0 stale / 0 errors), geometry QA green (0 lost, partition error 4.4e-6, 0 overlaps)
- [x] Tile QA on real data: uncovered land 0.025 %, colour over sea 0.024 %, overlaps 0 — two threshold breaches left as known (Tonga tile at l1 in 1700/1800: 3 of 55 land px; "sliver islands" 952 > 25 — fjord-coast simplification, also present in Natural-Earth-based modern years, not ownership errors)
- [x] Site e2e 99/99 on the published data; 45 screenshots; docs pass done (729 tests green)
- [x] curated-fixes.json (45 sourced entries: Channel Islands, UK/Ireland names, Chukotka, Greenland, Cayman, Hokkaido/Ainu Mosir, Northern Canada, Cape & Sierra Leone, Greece, Congo Free State/Belgian Congo, Hispaniola, Lepanto); full catalog in overrides/CATALOG.md

## Data review queue (people or a small targeted agent — not a fan-out)
- Modern units still shown sovereign before independence (no Wikidata predecessor): Seychelles <1976, Western Samoa <1962, Micronesia & Marshall Is. <1986, Eritrea 1946–61; Korea 1946–47
- Need subunits/curation: Yemen 1946–89 (North/South), Libya 1946–50 (French Fezzan), Northern Cyprus enclaves 1963–73, China 1946–48 vs ROC pid, 'Portuguese Angola' naming
- Dependencies without a power: Bahrain, South-West Africa, Niue, Nauru, Singapore 1959–62
- Historical: west St. Lawrence Island unclaimed 1868–1945; Cliopatria England→Great Britain switch in 1709 (should be 1707); Hispaniola 1780–91 names; Haiti 1806–20 north/south split; Gold Coast 1796 record named 'British Cape Colony'; Rupert's Land <1870 and Sulawesi kingdoms (known gaps); thin sliver on the Gulf of Corinth north shore (Aegean 1700)
- 115 low-confidence modern units, 307 suspect + 681 date notes, 642 coverage-gap candidates (.cache/factcheck/*.md)
- Seen in final screenshots: 1914 'United Kingdom of Great Britain and Ireland' area/label over central-eastern Arabia (check Cliopatria's 1914 British record extent vs Nejd/Jabal Shammar); possible unclaimed speck at the Aran Islands, Galway Bay, 1800
- Live site 1815: Iceland/Greenland labelled 'Denmark-Norway' (union ended 1814 — Cliopatria naming; should be Denmark after 1814)
- Polity identity breaks at the 1946 source cut-over: 225 polities start exactly in 1946 (133 of the 274 alive in 2026), so a modern country's lifespan band and selection start in 1946 (USA `ne:usa` 1946–2026 vs `clio:united-states-of-america` 1776–1945, both Q30). 50 of them have exactly one pre-1946 polity with the same Wikidata id (joinable automatically); the other 175 need curated links (France, UK, Germany change QID at the cut-over)
- Repo size: 304 MB of built data on disk, ≈ 43 MB packed in git (largest file 4.3 MB) — fine as plain git; do not move it to Git LFS (metered quotas; cost audit 2026-10-02)

## Deployment
- [x] GitHub repo https://github.com/alcaholex/alexs-atlas (private) · GitHub Pages https://alcaholex.github.io/alexs-atlas/ via .github/workflows/pages.yml on every push to main (first deploy 2026-10-02: build + deploy green; live check: 0 console errors, same-origin requests only)
