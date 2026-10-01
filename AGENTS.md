# AGENTS.md — STR History

The single source of truth for **what this site is, how it is designed, how the
code is organised, how to work on it without stepping on anyone else, and how
it is deployed**. It is written for both people and coding agents (Claude,
Codex, Copilot, Cursor…). `CLAUDE.md` only points here — keep all guidance in
this file.

Live site: **https://history.ethanyanxu.com** · Repo: https://github.com/OoEthanoO/strhistory

---

## 1. Purpose

A website for a high-school history department with four connected jobs:

1. **An interactive, timeline-based globe with individual history notes.** The
   home page places the live globe on the left and smaller event previews on
   the right, with department information below. A click or completed gesture
   enters `/globe`, preserving the camera. The exploration timeline runs from
   approximate human origins (300,000 BCE) to the present, independently of the
   course. Each note has its own place, inclusive date range and direct pin link.
   The explorer has a searchable catalogue on the left, year context above the
   bottom timeline, SL/HL filtering and a switch to show pins from all years.
2. **Interactive study notes** for each topic: key quotations are highlighted and
   attributed, key terms reveal their *significance* when clicked, and each
   topic ends with self-test questions and a historians' debate.
3. **A searchable notes library** at `/topics`, plus a glossary. The selected
   first-assessment-2028 course is Political and economic transitions (Paper 1),
   Authoritarian rule (Paper 2), and Europe: the French Revolution and German
   and Italian unification (Paper 3, HL). Earlier notes retain their URLs in a
   clearly labelled archive. SL shows the shared core; HL includes that core
   and the regional studies.
4. **The department's home online**: courses, teacher profiles, news, study
   guides (exam papers, IA, extended essay), and an about page.

Audience: IB Diploma History students (SL and HL, grades 11–12), pre-IB
students, parents, and the department's teachers, who add and edit content.

### Access

Only `/globe` is publicly accessible as a content page. Its event titles, short
summaries, dates, places and map data remain public so the explorer works.
Everything else, including the department home page, notes, glossary, courses,
teachers, news and resources, requires the shared department code. `/access`
provides the unlock form, a link to the public globe and a way to lock the browser
again. A successful unlock returns to the requested page and lasts seven days.
Never commit the access code or session signing key, or embed them in frontend JS.
This gate protects the deployed website, not the source files in the public GitHub
repository. Making source content confidential requires a separate repository decision.

### Content standards (non-negotiable)

This is an educational site; accuracy matters more than volume.

- **Quotations must be real and verbatim** from a named, dated source. Use the
  wording of a published translation and name it when relevant. If you are
  not certain of exact wording, paraphrase in prose instead of using
  `<KeyQuote>`/`<Q>`. If accounts of a quote differ, say so in `note`/`analysis`
  ("as reported by…", "translations vary").
- **Historiography must be attributable**: a real historian, a real work, a
  correct year, a fair one-sentence summary. No invented historians or titles.
- **Dates, figures and names** should match mainstream scholarship; where
  estimates vary (death tolls, crowd sizes), give a range or say "about".
- **Placeholders are labelled.** Sample teachers, courses and news carry
  `placeholder: true`, which shows a "Sample" badge. Never present invented
  people or events as real.
- Current assessment information follows the official IB History subject brief
  for first assessment in 2028, linked from the course and guide pages. The
  public brief confirms the framework; detailed prescribed case-study pairings
  and regional boundaries still require the school's full current guide.
  The older EE guidance is explicitly archived and must not be presented as
  current. Verify assessment changes against official IB sources.

---

## 2. Quick start

Requirements: Node ≥ 22.12 (the server runs Node 24), npm, Git.

```bash
npm install
npm run dev              # http://localhost:4321 (hot reload)
npm run check            # content lint + TypeScript/Astro type check
npm run build            # static site → dist/
npm run preview          # serve dist/ locally
npm run check:content    # fast lint of all content, reports every problem at once
npm run data:snapshots   # rebuild globe border files (only when snapshots change)
npm run data:sea         # rebuild the sea layer drawn over the polities (see §6)
npm run data:check       # cross-check the old border files against Wikidata (network; see §5)
```

Before every push: `npm run check && npm run build` must pass. CI runs the same.

If the dev server shows "Outdated Optimize Dep" errors after installing a
package, restart it (Vite's dependency cache is stale).

---

## 3. Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Astro 7** (static output) | Content-first site; pages are HTML with zero JS unless a component needs it. Caddy serves the build after checking access. |
| Access control | **Caddy forward_auth + Node built-in HTTP/crypto** | A small loopback service checks the shared code and signed HttpOnly cookies; no extra npm dependencies. |
| Interactive globe | **React 19** island + **MapLibre GL 6** (globe projection) | MapLibre renders dated borders (OpenHistoricalMap tiles, from 1700) on a WebGL globe with smooth interaction and no API keys. React only for the globe UI state. |
| Content | **Astro content collections** (Markdown / MDX + Zod schemas) | One file per topic/term/teacher; schemas catch mistakes at build time. |
| Immediate globe | **d3-geo** SVG + React | A baked initial frame (land and pins) is in the HTML; drag, pinch, wheel, keyboard and note links work while MapLibre and the border data arrive. |
| Styling | Plain CSS with design tokens + Astro scoped styles | No framework to learn; tokens keep both themes consistent. |
| Fonts | Newsreader (serif, variable, optical sizes) + Inter (sans), self-hosted via Fontsource | No third-party font requests (student privacy). |
| Hosting | Home server (Windows 11) behind **Caddy** (automatic HTTPS) | See §10. |

Astro 7 specifics worth knowing (they differ from older tutorials):

- Content config lives in `src/content.config.ts`; collections use `glob()`
  loaders; import Zod as `import { z } from 'astro/zod'` (Zod 4); render entries
  with `render(entry)` from `astro:content`.
- The compiler is Rust-based and **strict about HTML**: close every tag, and
  don't put block elements inside `<p>`.
- `compressHTML: true` is set explicitly in `astro.config.mjs`. Astro 7's
  default (`'jsx'`) strips whitespace between inline elements, which breaks
  prose ("<em>a</em> <b>b</b>" → "ab").
- The build's CSS pass merges `-webkit-backdrop-filter` and `backdrop-filter`
  and keeps the last one — write only the unprefixed property.

---

## 4. Repository map and ownership

The code is split so that **most changes touch one folder or one file**. Pick
the area that matches your task and stay inside it; the "shared" files at the
bottom are the only places where parallel work can collide.

```
src/
  content/                 ← CONTENT: one file per entry (see §5). Most PRs live here.
    topics/<slug>.mdx        one event/source note = one pin + one study page
    glossary/<id>.md         key terms used by <Term id="…">
    syllabus/<id>.md         IB syllabus units (papers 1–3)
    snapshots/<year>.md      globe timeline stops + "world in <year>" text
    teachers/ courses/ news/ guides/   department pages
  schemas/                 ← one Zod schema file per collection family
  features/
    globe/                 ← FEATURE: the /globe explorer (React island)
      GlobeExplorer.tsx      state, URL sync, playback; composes the pieces below
      HomeGlobe.tsx          home-page gesture handoff to the full explorer
      PrebakedGlobe.tsx      immediate interactive SVG and WebGL fallback
      pin-layout.ts         groups overlapping note pins into one counted pin
      label-layout.ts       where each polity's label goes (visible land, not sea)
      tile-cache.ts         keeps OHM tiles for a week; starts the first ones early
      map.ts                 GlobeController — the only file that touches MapLibre
      Timeline.tsx EraPanel.tsx TopicList.tsx TopicPreview.tsx
      era.ts                 pure timeline maths (eras, lanes, positions)
      palette.ts             period-aware polity colour schemes
      data.ts                build-time loader → JSON props for the island
      globe.css              the explorer's own dark theme
    notes/                 ← FEATURE: components usable inside MDX notes
      Term.astro Q.astro KeyQuote.astro Callout.astro Perspective.astro
      Chronology.astro Event.astro Recall.astro
      popover-client.ts      positioning + key-term progress (client JS)
      notes.css              prose + component styles
      index.ts               the map of components exposed to MDX
  components/              ← shared UI: Header, Footer, cards, Badge, Avatar, HeroGlobe…
  layouts/BaseLayout.astro ← the HTML shell (head, fonts, theme, header/footer)
  pages/                   ← thin route files; they query content and compose components
  lib/content.ts           ← all content queries (ordering, drafts, lookups)
  lib/format.ts            ← date/year formatting
  config/site.ts           ← site name, school, nav, contact
  styles/tokens.css        ← design tokens (colours, type, spacing) for both themes
  styles/base.css          ← element defaults and a few utilities (.container, .btn…)
public/
  data/snapshots/world_<year>.geojson   generated border files (GPL-3.0, see LICENSE.md there)
  data/sea.geojson                      generated sea (drawn over the polities) and sea graticule
  data/land.geojson                     generated land layer (unused by the globe)
  glyphs/noto-sans/                     map label glyphs
scripts/
  check-content.mjs        content lint (npm run check:content)
  data/build-snapshots.mjs border data pipeline (npm run data:snapshots)
  data/name-overrides.json per-year fixes for anachronistic names in the border data
  data/powers.json         spellings of each controlling power → one colour key
  data/build-cliopatria.mjs  unused: Cliopatria border files, no longer on the globe (see §6)
  data/build-sea.mjs       the sea drawn over the polities (npm run data:sea)
  data/rulers.json         dated colonial rulers for colonies upstream records as self-ruling
  data/check-sovereignty.mjs  Wikidata cross-check (npm run data:check)
  data/sovereignty-reviewed.json  data:check findings reviewed as correct, with reasons
deploy/
  Caddyfile                the site's Caddy config (source of truth)
  access/                  code/session service, provisioning helper, tests
  server/*.ps1             install / poll / deploy / status / rollback on the home server
.github/workflows/ci.yml   check + build on every push and PR
```

### Shared files — edit carefully, keep diffs small

These are the files that many features depend on. Change them in a dedicated,
small PR, and never reformat them wholesale:

`src/content.config.ts`, `src/schemas/*`, `src/lib/content.ts`,
`src/config/site.ts`, `src/styles/tokens.css`, `src/styles/base.css`,
`src/layouts/BaseLayout.astro`, `src/components/Header.astro`,
`astro.config.mjs`, `package.json` / `package-lock.json`,
`deploy/server/tick.ps1`, `deploy/server/common.ps1`.

- Adding a schema field: make it `.optional()` or give it a `.default()` so
  existing files stay valid.
- Adding a dependency: one PR, and explain why in the description. Prefer none.
- Navigation items live in `src/config/site.ts` (`nav`), not in the header.

---

## 5. Content model

| Collection | Folder | Schema | Drives |
| --- | --- | --- | --- |
| `topics` | `src/content/topics/*.mdx` | `src/schemas/topics.ts` | `/topics/<slug>`, globe pins, timeline bars, home & index cards |
| `glossary` | `src/content/glossary/*.md` | `src/schemas/glossary.ts` | `<Term>` popovers, `/glossary`, "Key terms" list on topic pages |
| `syllabus` | `src/content/syllabus/*.md` | `src/schemas/syllabus.ts` | grouping on `/topics` and `/courses`, paper badges |
| `snapshots` | `src/content/snapshots/<year>.md` | `src/schemas/snapshots.ts` | globe timeline stops and era panel text |
| `teachers` | `src/content/teachers/*.md` | `src/schemas/department.ts` | `/teachers`, `/teachers/<slug>` |
| `courses` | `src/content/courses/*.md` | `src/schemas/department.ts` | `/courses`, `/courses/<slug>` |
| `news` | `src/content/news/YYYY-MM-DD-slug.md` | `src/schemas/department.ts` | `/news`, home page |
| `guides` | `src/content/guides/*.mdx` | `src/schemas/department.ts` | `/resources`, `/resources/<slug>` |

Rules:

- The **file name is the id and URL slug**. Use lowercase-kebab-case. Renaming a
  file breaks links and references — search for the old id first.
- Files starting with `_` are ignored (templates: `topics/_template.mdx`,
  `glossary/_template.md`).
- References (`unit`, `related`, `authors`, `courses`, `units`, glossary
  `related`) are ids of files in the target folder. `npm run check:content`
  reports broken ones.
- `draft: true` (topics, news) shows in `npm run dev` but is excluded from builds.
- Notes use `curriculum: '2028'` for the selected course and `archive` for older
  material (the safe default). `level: SL` means shared SL and HL content;
  `level: HL` is the additional Europe study. Each file describes one event or
  focused source, with required `location` and inclusive `period.start/end`.
  A single-year event uses the same start and end. An optional `snapshot` on a
  current note must lie within that range; it does not require a new border file.
- **YAML gotcha:** a value containing `": "` or starting with a quote must be
  wrapped in quotes, e.g. `title: "Guest lecture: archives"`. The content lint
  catches this.

### Recipes

**Add a topic (a new pin + notes)**
1. Copy `src/content/topics/_template.mdx` to `src/content/topics/<slug>.mdx`.
2. Fill in the frontmatter. `unit` must be a file in `src/content/syllabus/`.
   `location` is the event's actual place, even when other events happened there.
   Nearby pins fan out with fine stems to their true positions. Set the
   curriculum and level, and keep the date range as focused as the note.
3. Write the notes (see "Writing notes" below). Create any glossary terms you
   reference.
4. `npm run check:content && npm run dev`, open `/topics/<slug>` and `/globe`.
   Nothing else needs registering — pages, globe, timeline and indexes pick the
   topic up automatically.

**Add a key term** — copy `glossary/_template.md` to `glossary/<id>.md`, then use
`<Term id="<id>">words in the text</Term>`. Unknown ids fail the build.

**Add a timeline snapshot year** — add `src/content/snapshots/<year>.md`, run
`npm run data:snapshots -- <year>` (downloads and simplifies that year from
aourednik/historical-basemaps — available years are listed in that repo's
`geojson/` folder), read the script's warnings and its list of inferred colonial
rulers, check the names on the globe, add fixes to
`scripts/data/name-overrides.json` and re-run if needed, then commit the
markdown file and `public/data/snapshots/world_<year>.geojson` together. If the
reconstruction has a known quirk (a missing state, an undivided country, an
unusual level of detail), say so in the snapshot's `summary`.
Both upstream sources are pinned to a commit (`BASEMAPS_COMMIT`,
`NATURAL_EARTH_COMMIT` in the script) so rebuilds are reproducible; to take
upstream corrections, bump the commit, rebuild every year, and review the diff.
Negative filenames are BCE; the pipeline maps them to upstream `world_bc...`
files. `borderYear: null` creates a land-only exploration stop, and a numeric
`borderYear` reuses an available reconstruction with its actual date visible.
Never relabel an old reconstruction as current borders. The present-day stop
(`PRESENT_YEAR` in the script) is built from Natural Earth instead: ISO 3166
countries, with contested territories dashed and named "(disputed)".

**Fix a wrong country name on the globe** — add an entry for that year in
`scripts/data/name-overrides.json` (string = new display name; object =
`{ "name": …, "subjecto": … }` to also change the controlling power), then
`npm run data:snapshots -- <year>`. The script warns about entries that no
longer match anything upstream.

**Fix a wrong colour on the globe** — colours follow the canonical power in
`scripts/data/powers.json`. Add a missing spelling to `aliases` (e.g. a new way
upstream writes "United Kingdom"). Upstream records many colonies as ruling
themselves (Nigeria, Kenya, India in 1938, the Philippines…); give such a
territory its ruler in `scripts/data/rulers.json` with inclusive `from`/`to`
years (`to` is usually the year before independence), or with a `{ name,
subjecto }` override for one year. Leave occupations and protected states with
their own rulers as they are, and check the dates like any other fact (§1).

**Check the maps against Wikidata** — after changing border data, run
`npm run data:check`. It lists polities shown ruling themselves while Wikidata
has them as a colony or protectorate, shown under a foreign power after the
present-day state was founded, or shown after every state of that name ended
(`--too-early` adds a noisier check). Wikidata is a lead, not an authority, and
names are matched exactly. Fix real errors in `rulers.json` or
`name-overrides.json`; record a finding that is right on the map in
`scripts/data/sovereignty-reviewed.json` with the reason. It needs the network,
so it is not part of CI; the answer is cached in `.cache/` (`--refresh` asks again).

**Add a teacher / course / news post / guide** — copy an existing file in the
folder, edit, remove `placeholder: true` when it is real. Teacher photos go
next to the file (e.g. `teachers/jane-doe.jpg`) and are referenced as
`photo: ./jane-doe.jpg` with `photoAlt`; Astro optimises them.

### Writing notes (MDX components)

These are available in every topic and guide without importing (mapped in
`src/features/notes/index.ts`):

| Component | Use | Example |
| --- | --- | --- |
| `<Term id>` | a key term; click reveals definition + significance | `<Term id="appeasement">appeasement</Term>` |
| `<Q by date source note>` | short inline quotation, highlighted; click reveals attribution | `<Q by="Neville Chamberlain" date="30 September 1938">peace for our time</Q>` |
| `<KeyQuote by role date source analysis>` | stand-alone highlighted quotation with a "Why this quote matters" reveal. **Keep the quote text on one line.** | see any topic |
| `<Callout type title>` | `exam`, `historiography`, `context`, `warning`, `tip` | `<Callout type="exam">…</Callout>` |
| `<Perspective historian work year school>` | one historian's interpretation | in "Historians' debate" |
| `<Chronology title>` + `<Event date>` | key-dates timeline | top of each topic |
| `<Recall q>` | self-test question with hidden answer | "Test yourself" section |

House style for topics: sections in this order — Overview (with
`<Chronology>`), analytical sections answering the key questions, "Historians'
debate", "Test yourself". Use `##` for sections (they build the page's
contents list). British spelling (the IB's), past tense, no second-person
pep talk. Broad archive studies may run 800–1,500 words; current event modules
should stay focused on one question or source rather than pad to a word count.
Every key term that a student
should be able to define gets a `<Term>` the first time it appears.

In JSX attributes, use typographic quotes (“ ” ‘ ’) or single quotes inside
double-quoted values; never raw `{`, `}` or `<` in MDX text.

---

## 6. The globe

Data flow: `src/pages/globe.astro` calls `getGlobeData()` (build time) →
serialisable `{ topics, snapshots, currentYear }` → `<GlobeExplorer client:load>`.
The home page uses `HomeGlobe` with the same data and fixed initial camera.
`PrebakedGlobe` renders land and pins as SVG in the HTML and handles gestures
before WebGL is ready. MapLibre is dynamically imported; the SVG globe stays
until the sea layer has reached a rendered frame, and borders fill in as
they arrive (the year panel says "Loading borders…"). No loading screen
replaces the globe. WebGL failures, or OpenHistoricalMap being unreachable,
leave the SVG usable.

- **Borders come from OpenHistoricalMap (OHM) alone, from 1700**
  (`BORDERS_FROM` in `era.ts`), filtered to the chosen year, so any year works,
  not just timeline stops. Before 1700 the globe shows land and pins only: the
  border layers are hidden, so no OHM tiles are fetched.
  - **Why 1700**: share of land OHM covers, measured on the globe (September
    2026). Before 1600 it is under half everywhere, and before 800 nearly
    nothing. By 1700 Europe, East Asia and North America are 84–90%; the Middle
    East (~50%), sub-Saharan Africa (~26%) and South Asia (~64%) stay patchy
    until about 1900, and are left blank where OHM has nothing. From 1900 every
    region is ≥77%, from 1920 ≥89%.
  - **Levels** (`OHM_LEVELS` in `map.ts`): `admin_level` 2, the country
    level, is drawn on top. Level 3 is drawn underneath, so it shows only where
    OHM has no country: before 1804 OHM maps Austria and Bohemia inside the Holy
    Roman Empire and Hungary and Galicia only at level 3, which would otherwise
    be blank. Level 1 is not drawn; its colonial empires (names containing
    "Empire") give their members the empire's colour and the hover's "Part of".
    Not every colony lies inside its empire for every year (Brazil in 1800,
    Mozambique in 1914), so `powers.json` aliases cover those by name. OHM
    names that carry dates ("New Spain (1795-1803)") are shown without them.
  - **Tiles**: polities from `vtiles.openhistoricalmap.org/maps/ohm_admin`
    (`boundaries` layer), detailed and dated to the day. Every
    date is in each tile (`start_decdate`/`end_decdate`, astronomical years;
    `decimalYear()` converts), so changing year downloads nothing. Tiles are
    heavy (4–8 MB each unzipped, ~0.2–1.2 MB over the wire, every admin level
    and date); the source stops at zoom 6 and overzooms beyond. Unnamed
    polities are not drawn.
  - **Tile cache** (`tile-cache.ts`): OHM lets browsers keep tiles for only 60
    seconds, so the source uses an `ohmtiles://` protocol (MapLibre
    `addProtocol`) that keeps them for a week in the Cache API, gzipped again
    (~1 MB each, oldest dropped past 150); a repeat visit downloads nothing.
    `prefetchWorld` starts the whole-globe tiles (zoom 0 or 1) when the page
    mounts, before MapLibre has loaded (~0.7 s sooner). Bump `CACHE` there to
    discard every visitor's cached tiles.
  - **Main-thread work** (measured September 2026; keep these in mind):
    - `querySourceFeatures` decodes every feature of every loaded tile (~2,000
      per OHM tile) to test its filter, so calling it per year change froze
      timeline scrubbing for over a second at a time. It runs once per batch of
      *new* tiles (`refreshIndex`, ~100 ms) into a list of polity versions with
      their dates; a year change filters that list (`current`). A new year
      makes MapLibre re-process tiles it already has and report them again, so
      only tile keys not seen before mark the index stale. Geometry is decoded
      only when first needed (`piecesOf`).
    - A new year re-filters every tile in MapLibre's worker (~0.3–0.5 s), and
      the timeline slider asks for a year per drag step, so `setYear` keeps
      only the latest request while the map is still settling (`applyYear`).
    - Labels are placed only on `idle` and only when tiles or the year changed
      (`labelsStale`), and the same label data is never re-sent: sending it
      re-renders, which ends in `idle` again and once looped.
    - There is no hover-outline layer: it made the worker build line geometry
      for every polity of every tile; the hovered fill lightens instead.
    - Judge speed on `npm run build && npm run preview`; the dev server runs
      unminified, development-mode React and MapLibre.
  - **Stacking**: OHM contains overlapping polities (an empire and its members,
    a federation and its colonies, duplicates). Fills are opaque — colours
    pre-blended with the land by `onLand()` — and `fill-sort-key` draws larger
    polities first, smaller on top, the same way in every tile; each outline is
    drawn with its own fill (`fill-outline-color`) so covered borders stay
    covered. Without this, the top polity changed from tile to tile.
  - **Cliopatria (removed)**: the globe used to fill OHM's gaps with Cliopatria
    (Seshat Global History Databank). Where the two disagreed (OHM puts the
    Crimean Khanate inside the Ottoman Empire in 1512) no rule for hiding
    Cliopatria avoided both ghost overlaps and blank fringes, so it was dropped.
    `scripts/data/build-cliopatria.mjs` remains, unused; its output
    (`public/data/cliopatria/`) is not served.
- **Sea on top**: OHM's modern polities follow OpenStreetMap and include their
  territorial waters (Canada also Hudson Bay), so filled in colour they were
  puffy and swallowed islands. `public/data/sea.geojson` (Natural Earth 10 m
  simplified to 800 m, 50 m for small islands — a pixel at the deepest zoom is
  ~600 m — 3.3 MB; `npm run data:sea`, `scripts/data/build-sea.mjs`; MapLibre
  simplifies it further per zoom, `GEOMETRY_TOLERANCE`) is drawn over every fill,
  so polities stop at the coast; land is simply a land-coloured base beneath.
  The sea is cut into 10° cells (one world-sized polygon, or cells over
  MapLibre's per-tile vertex limit, painted some islands as sea) and carries
  the graticule, clipped to the sea. Labels avoid it (see below). Hover
  ignores the sea. Bump `SEA_VERSION` in `map.ts` after a rebuild.
- **Access gate**: the globe is public but the rest of the site is not, so every
  data file the globe fetches must match `@publicAsset` in `deploy/Caddyfile`
  (`/data/sea.geojson`); add new ones there and to
  `deploy/access/smoke.mjs`.
- **Snapshots** (`src/content/snapshots/`) are timeline stops for the era
  summaries only; their `borderYear` is no longer used by the globe.
- **Labels** are computed in the browser, since labelling tiled polygons
  repeats a name in every tile. `label-layout.ts` (tested) draws a polity's
  pieces from all loaded tiles onto a grid, removes the sea and whatever is
  drawn over it (smaller polities; for a level-3 polity any country), and
  labels its largest remaining land area at the point furthest from the edges,
  nudged towards the middle (so Canada is not labelled in the Arctic islands or
  Hudson Bay, and New Spain where Cuba's captaincy covers it). A polity in
  several separate areas whose largest is mostly one OHM unit of levels 3–4
  sharing no distinctive word with it gets that unit's name there and its own
  name on its largest other area: in 1800 OHM's Captaincy General of Cuba
  includes Spanish Louisiana, labelled as such, with the captaincy's name on
  Cuba. Results are cached per polity (`labelPolity`) and redone only when its
  pieces, what covers it or the year change; a cold refresh takes ~50–70 ms. The
  sea comes from MapLibre's loaded sea tiles (`querySourceFeatures`), not a
  second download of `sea.geojson`. Below `LABEL_MIN_SCALE` (1.4× the
  whole-globe view, one click of "+") labels are hidden, by a zoom step on
  `text-opacity` (a fractional layer `minzoom` also stops MapLibre building
  them at the next whole zoom level), and not computed at all.
- **Hover** shows the polity's dates and, for colonies, its empire.
- **Credit**: OHM (CC0) and Natural Earth (public domain) need none, but are
  credited with the map (MapLibre's attribution control) and in the info panel.
- **Pins** appear only when `start <= selectedYear <= end`, unless show-all is
  enabled. Course level, archive/current selection and search also filter them.
  Every visible pin links directly to its note. Locate buttons in the catalogue
  choose the note's exact start year and fly to its geographical position.
- **URL state**: `/globe?year=1938&topic=<slug>` — used by the "See the world in
  …" button on every topic page. `level`, `curriculum`, `all` and `q` also persist
  in the URL. Home handoffs carry `lng`, `lat` and `scale`. The shared saved level
  uses localStorage key `history-level`; storage failure must not break controls.
- **Colours**: `palette.ts` selects a colour scheme by year (schemes are listed
  in ascending `fromYear` order; the last matching scheme wins), with named
  colours that keep major empires recognisable. Names differ between sources and
  periods, so `powerOf` maps a name to one power by `scripts/data/powers.json`
  aliases, a ruler in brackets, or a leading adjective ("French Africa").
  A polity inside an OHM colonial empire takes the empire's power colour.
  Otherwise `colorForPolity` tries the polity's own name, then its power, and
  uses the first with a named colour in the scheme, otherwise hashes the power,
  so colonies named after their power ("French West Africa") share its colour. Colours are applied through
  feature-state (style expressions cannot hash strings); crossing into another
  scheme recolours the polities. Add an alias when one power shows in two colours.
- **Rendering**: MapLibre globe projection with a light atmosphere; labels use
  self-hosted glyphs (`public/glyphs/noto-sans`); MapLibre's worker is bundled via
  `?worker&url` + `setWorkerUrl` (MapLibre 6 cannot find it on its own when
  bundled).
- **The old border pipeline** (`npm run data:snapshots`, `name-overrides.json`,
  `rulers.json`, `npm run data:check`, `public/data/snapshots/`, `land.geojson`)
  is kept but no longer feeds the globe; remove it once the new sources are
  settled. Its §5 recipes describe those files only.
- Keyboard: timeline is a native slider (arrows, Home/End, PageUp/Down); pins
  are real links; Escape closes panels.
- In development `window.__globe` exposes the controller for debugging.
- **How OHM behaves** (learned September 2026, before you "fix" the map):
  - It maps who governed a place, not treaty claims: Louisiana stays Spanish
    (inside the Captaincy General of Cuba) until November 1803, although it was
    ceded to France on paper in 1800. Explain such cases rather than override.
  - Country-level polities nest: in 1800 New Spain contains the Captaincy
    General of Cuba, which contains Spanish Louisiana (level 4). The smaller one
    is drawn on top; labels follow what is visible.
  - Level 1 mixes colonial empires with confederations (German Confederation)
    and Indigenous nations (Miwok), hence the `EMPIRE` name test.
  - Austria-Hungary exists only from 1867 and the Austrian Empire from 1804;
    before that the Habsburg core is inside the Holy Roman Empire.
  - Cloudflare answers `curl` with a challenge page; Node's `fetch` and
    browsers get tiles. Decode a tile's layers with a few lines of protobuf
    reading; `ohm_admin` has only `boundaries`, while OHM's main `ohm` tileset
    also has label points (`land_ohm_centroids`) at ~1 MB more per tile.
- **Mixing sources** failed: OHM with Cliopatria (Seshat) filling its gaps gave
  either ghost overlaps or blank fringes whatever rule decided which to show
  (see "Cliopatria (removed)"). Prefer one source per period.
- **Testing the globe**: the scripts used so far drive Microsoft Edge through
  `playwright-core` (not a project dependency; run from a scratch folder) with
  `--use-angle=swiftshader`, wait for `window.__globe.map.areTilesLoaded()` and
  the year panel's "Borders in", and read state through `window.__globe`.
  Software rendering exaggerates drawing costs, so compare before/after rather
  than trusting absolute frame times; use a `longtask` PerformanceObserver and
  CDP's `Profiler` to find main-thread work. After a change that makes the map
  settle faster, wait for a settled state, not the next `idle` event, which may
  already have passed.

---

## 7. Design system

**Personality:** a modern archive — warm paper, ink, oxblood and brass in the
department pages; a dark "planetarium" for the globe. Calm, editorial, serious
about sources, never gamified beyond the key-term progress bar.

- **Tokens only.** Colours, fonts, radii and shadows come from
  `src/styles/tokens.css` (`--paper`, `--ink`, `--accent`, `--brass`,
  `--term`, callout families…). Both themes are defined there; components
  never hard-code colours. The globe has its own palette in `globe.css`
  (always dark).
- **Themes:** light by default, dark via `prefers-color-scheme` or the header
  toggle (`html[data-theme]`, stored in `localStorage`). Check both.
- **Type:** Newsreader for headings and reading text (optical sizing on),
  Inter for UI. Fluid type scale `--step--1 … --step-5`.
- **Semantics:** key terms = teal dotted underline (`--term`); quotations =
  brass highlighter (`--highlight`); exam callouts = teal, historiography =
  violet, context = brass, warnings = red.
- **Layout:** `.container` (max 1200px), prose max 68ch, generous whitespace,
  cards with 16px radius and soft shadows.
- **Accessibility (required):** semantic headings in order; visible focus
  styles; all interactive elements reachable by keyboard; `alt` text on images;
  colour is never the only signal; respect `prefers-reduced-motion`; check
  contrast in both themes.
- **Performance:** pages ship no JS unless they need it; MapLibre loads lazily on
  the home page and `/globe`. The notes directory uses a small search/filter script.

---

## 8. Working together (people and agents)

The structure above is designed so that several people or agents can work in
parallel with few conflicts:

- **One task, one area.** Content work stays in `src/content/<collection>/`
  (usually one or two new files). Globe work stays in `src/features/globe/`.
  Notes-component work stays in `src/features/notes/`. Page work usually touches
  one file in `src/pages/`.
- **Adding beats editing.** New topics, terms, teachers and posts are new files,
  so two contributors adding content never touch the same file. Avoid
  "tidying" files outside your task.
- **Shared files** (§4) get small, focused PRs. If two tasks both need a shared
  change (e.g. a new schema field), do that change first, merge it, then branch
  the feature work from it.
- **Branches and PRs:** branch from `main` as `feature/<short-name>`,
  `content/<topic-slug>` or `fix/<issue>`; open a PR; CI must be green. Keep PRs
  small enough to review in one sitting.
- **Commits:** imperative subject lines ("Add Rwanda topic notes"), explain *why*
  in the body when it isn't obvious.
- **Merging to `main` deploys** within about a minute (§10). Don't push
  unreviewed experiments to `main`.
- **Checks before pushing:** `npm run check && npm run build`. For UI changes,
  look at the page in both themes and at a phone width (375px).
- **Agents:** read this file first; follow existing patterns; don't add
  dependencies or restructure folders without being asked; don't invent quotes,
  historians or statistics (§1); run the checks and report what you verified.

---

## 9. Configuration

- `src/config/site.ts` — site name ("STR History"), department, **school name
  (currently empty — to be confirmed)**, public email, nav.
- `astro.config.mjs` — `site` URL (override with `SITE_URL`), MDX, React,
  sitemap, whitespace handling, Vite options. Only `/globe` is included in the
  sitemap. `/robots.txt` allows the globe and its assets; protected responses
  carry `X-Robots-Tag: noindex, nofollow`. Both use `site` for URLs.
- Environment variables: `GIT_SHA` (set by deploy/CI; written to
  `/version.json`), `SITE_URL` (optional).

---

## 10. Deployment

**Every commit to `main` is deployed automatically to the home server within
about a minute.** No secrets or inbound webhooks are involved — the server
polls GitHub.

```
push to main ──► GitHub ◄── git fetch every minute ── scheduled task "strhistory-deploy" (SYSTEM)
                                                          │ new commit?
                                                          ▼
                                    repo\  git reset --hard <sha>
                                    repo\deploy\server\deploy.ps1:
                                       npm ci (only if package-lock.json changed)
                                       npm run check:content → npm run build (GIT_SHA=<sha>)
                                       dist\ → releases\<sha>\
                                       sync deploy\Caddyfile → validate → reload Caddy
                                       current ──junction──► releases\<sha>   ◄── Caddy serves this
                                       verify /version.json, prune to 5 releases
```

**Server:** `ssh finprint-host` — Windows 11, Windows PowerShell 5.1 as the SSH
shell, Node 24, Git, Caddy 2.11 (also serving finprint and ai subdomains).

**Layout on the server** (`C:\Users\ethan\strhistory`):

| Path | What |
| --- | --- |
| `repo\` | deploy-only clone of this repo (reset to each commit — don't edit it) |
| `releases\<sha>\` | built sites, newest 5 kept |
| `current` | junction to the live release; Caddy's `root` |
| `Caddyfile` | live copy of `deploy/Caddyfile`, imported by the main Caddyfile |
| `bin\tick.ps1` | the poller (copied by install.ps1; not updated by deploys) |
| `server.json` | paths to caddy, node, git, main Caddyfile (written by install.ps1) |
| `state.json` | last attempted/deployed commit, status, errors |
| `logs\deploy.log`, `logs\access.log` | deploy log; Caddy access log |
| `private\access.json` | salted scrypt code hash + random session signing key; outside repo/releases, restricted ACL |
| `bin\access\server.mjs` | running access service, copied and restarted only when changed |

**Access service:** the SYSTEM task `strhistory-access` starts on boot, runs
Node directly on `127.0.0.1:4310`, and restarts on failure. Every deploy runs
`deploy/server/access.ps1` and checks health before installing the Caddy gate.
The default Caddy route requires `forward_auth` before `file_server`; only the
explicit globe/access endpoints, operational version/robots/sitemap files and
map/JS/CSS/font assets are public. Keep that allowlist narrow, never use an
extension-only exception across the site. An unavailable service fails closed
for protected content while the public globe still works. Direct `index.html`
URLs, mixed case and encoded paths must also remain protected.

The code is checked with scrypt and a constant-time comparison. Seven-day sessions
use a signed `__Host-history-access` cookie (Secure, HttpOnly, SameSite=Lax).
Protected responses and authentication responses are `private, no-store`;
`/access` is not cached. Unlock/logout accept same-origin POSTs only. Caddy
overwrites the client-address header used for the 10-attempt/15-minute limit.
Logout removes the cookie; rotating the signing key invalidates all sessions.

Before first deployment, provision `private/access.json` with
`deploy/access/configure.mjs`, supplying the code on stdin and the destination
path as the argument. Do this outside the checkout and document root; restrict
the private directory to SYSTEM and Administrators. The helper stores only a
salted hash and generates a new session key. To rotate the code, repeat this and
restart `strhistory-access`. Never put the code in docs, examples or CI.

Tests: `node --test deploy/access/server.test.mjs` runs in CI and before deploys.
`deploy/access/smoke.mjs <base-url>` (code on stdin) tests the actual Caddy gate
against all built HTML pages and assets. `astro dev` and `astro preview` are
trusted authoring tools and do **not** enforce authentication; production must
always serve through this Caddyfile. The access page can be previewed locally,
but its unlock action requires the access service and the configured origin.

The main Caddyfile (`C:\Users\ethan\finprint\scripts\selfhost\Caddyfile`, run by
the `finprint-caddy` task) contains a managed block:

```
# BEGIN strhistory (managed)
import C:/Users/ethan/strhistory/Caddyfile
# END strhistory (managed)
```

If finprint's `setup.ps1` regenerates that file and drops the block, the poller
notices within a minute and restores it (`deploy/server/caddy.ps1`).

**Operating it** (from any machine with the SSH alias; the server's SSH shell is
PowerShell):

```bash
# status: live commit, last error, poller health, recent log
ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\repo\deploy\server\status.ps1"

# deploy now instead of waiting (or re-deploy the same commit)
ssh finprint-host "schtasks /run /tn strhistory-deploy"
ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\bin\tick.ps1 -Force"

# roll back to an earlier release (list, then choose)
ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\repo\deploy\server\rollback.ps1"
ssh finprint-host "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\repo\deploy\server\rollback.ps1 -To 1a2b3c4"
```

A failed deploy leaves the previous release live; it is retried up to 3 times,
then waits for the next commit. The preferred fix for a bad commit is
`git revert` on `main`, which deploys itself.

**Changing the deployment:**
- Caddy site settings → edit `deploy/Caddyfile`; the next deploy validates and
  reloads it (an invalid file is rejected and the old one kept — check the log).
- Build/release steps → edit `deploy/server/deploy.ps1` (runs from the commit
  being deployed).
- Poller or shared settings (`tick.ps1`, `common.ps1`) → after merging, re-run the
  installer on the server:
  `powershell -ExecutionPolicy Bypass -File C:\Users\ethan\strhistory\repo\deploy\server\install.ps1`
  (idempotent; elevated shell — SSH sessions on this server are elevated).
- Scripts must run on Windows PowerShell 5.1: no `??`, `?.`, `&&`; keep `.ps1`
  files ASCII-only (5.1 reads BOM-less files as Windows-1252).

**DNS:** `ethanyanxu.com` is hosted on Vercel DNS. `history.ethanyanxu.com` must
resolve to the home connection's public IP (the same as `ai.ethanyanxu.com` and
`finprint.ethanyanxu.com`). Caddy obtains the Let's Encrypt certificate
automatically once it does; until then the deploy log shows the HTTPS check as
"unreachable".

**CI:** `.github/workflows/ci.yml` runs `check:content`, `astro check` and the
build on every push and PR. It does not gate the server deploy (the server runs
the same checks before switching releases, so a failing commit never goes live).

---

## 11. Known gaps and backlog

- School name, contact email, real teacher profiles and real course details
  (current ones are labelled samples).
- Expand the seven initial event modules across the selected 2028 studies.
  This is a growing collection, not complete curriculum coverage.
- Globe decisions still open (September 2026):
  - Colour the Habsburg lands as Austria before 1804 (Austria, Bohemia,
    Hungary, Galicia) from a short dated list, since OHM has no Habsburg state
    then; the recommended option.
  - Or split the Holy Roman Empire into its level-3 pieces; these are mostly
    imperial circles, not states, so this is not recommended.
  - Build and host trimmed border tiles (levels 1–4, from 1700) from OHM:
    several times smaller than OHM's, and year changes would re-process far
    less. The largest remaining speed gain, but a pipeline to keep refreshed.
  - Remove the unused Cliopatria script and the old snapshot pipeline.
- The three items below concern the old snapshot pipeline, which no longer
  feeds the globe.
- Some upstream border data is approximate or anachronistic. Known geometry
  gaps, noted in the snapshot summaries: Vietnam is one territory in 1960;
  Manchukuo is part of Japan in 1938; East Timor is blank in 1994 and 2010;
  Kosovo is not separate in 2010; 1492 maps North America far more finely than
  elsewhere. Fix names via `name-overrides.json`; geometry fixes belong
  upstream in aourednik/historical-basemaps.
- Colonial rulers in `rulers.json` were added in September 2026 for the colonies
  found recorded as self-ruling in 1880–1960 (mainly Africa, South and South-East
  Asia, the Caribbean and the Pacific). It is not an exhaustive audit; earlier
  maps and smaller territories may still show colonies as independent.
- `npm run data:check` leaves 36 findings for a teacher to review (September
  2026), e.g. the Western Roman Empire in 500, the Inca Empire in 1600, Egypt
  under the UK in 1930, South Africa under the UK in 1914, the Bukhara and
  Dahomey protectorates, and Xinjiang (a name match to an older state). Fix or
  record each one as the recipe in §5 describes.
- The globe depends on OpenHistoricalMap's tile server (no stated usage policy
  or uptime guarantee; behind Cloudflare). If it is down, the SVG globe shows
  land and pins only.
- No borders before 1700, and blank land after it wherever OHM has not mapped
  a polity (much of the Middle East, Africa and South Asia until about 1900).
- OHM does not map most Indigenous nations and peoples (Aboriginal and
  Torres Strait Islander nations, much of the Americas, Africa and the Pacific
  outside states). Candidate sources and their terms are listed under
  "Indigenous territories" below.
- **Indigenous territories** (checked September 2026; none is added yet). They
  are language or nation areas, mostly undated ("traditional" or at contact),
  so they suit an optional layer rather than the year-filtered borders, labelled
  as approximate and contested. Consult the communities concerned before use.
  - Glottography (github.com/Glottography): ~13,000 language areas from 29
    sources; datasets from Asher & Moseley's *Atlas of the World's Languages*
    are CC BY 4.0. Its Australia dataset (from Bowern 2021) is CC BY-NC 4.0.
  - Native Land Digital (native-land.ca): territories, languages and treaties,
    strongest for the Americas, Australia and Aotearoa. Free API with a key,
    non-commercial use with attribution, but its Data Sovereignty Treaty forbids
    storing or redistributing the data without permission, so it would be
    fetched live.
  - AIATSIS Map of Indigenous Australia (Horton, 1996): reproduction needs a
    paid licence from Aboriginal Studies Press.
  - Aotearoa: Te Puni Kōkiri's iwi areas of interest on data.govt.nz (modern,
    statutory areas; check the licence on the dataset page).
  - OpenHistoricalMap accepts Indigenous territories as edits; data from
    restricted sources must not be copied into it.
- CShapes 2.0 (dated borders 1886–2019) was evaluated in September 2026 and not
  adopted. Its public files have no ruling-power field, use one modern name
  per unit, and omit annexations that were later reversed (it shows Austria
  independent throughout 1938–45 and has no Manchukuo). Its licence is also
  CC BY-NC-SA.
- Site search (e.g. Pagefind over `dist/`).
- Verify detailed prescribed Paper 1 pairings and Europe study boundaries
  against the school's full 2028 History guide; only the public brief is verified.

---

## 12. Licences and credits

- Code: all rights reserved by the repository owner unless a licence is added.
- Globe borders: OpenHistoricalMap contributors, **CC0** — credited with the
  map (MapLibre's attribution control) and in the info panel.
- Unused old border files: aourednik/historical-basemaps, **GPL-3.0** — the
  derived files in `public/data/snapshots/` stay under GPL-3.0 (see the LICENSE.md there).
- Natural Earth (the globe's sea and coastlines in `sea.geojson`, the immediate
  SVG globe via world-atlas, and the unused `land.geojson` and
  `world_2026.geojson`): public domain.
- Map label glyphs: Noto Sans, SIL Open Font License 1.1.
- MapLibre GL JS: BSD-3-Clause. Fonts via Fontsource: OFL.
