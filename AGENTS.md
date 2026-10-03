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
npm run data:snapshots   # rebuild the legacy snapshot border files (see §6)
npm test                 # Alex's Atlas module tests (vitest over packages/)
npm run check:packages   # type-check packages/borders and packages/globe
npm run data:sync        # copy the borders dataset to public/data/alexs-atlas (runs before dev/build)
npm run data:build       # rebuild the borders dataset from pinned sources (~20 min; packages/borders/AGENTS.md)
```

Before every push: `npm run check && npm run build` must pass, and `npm test`
plus `npm run check:packages` when `packages/` changed. CI runs all of them.
The `data:*` pipeline commands (`data:build`, `data:validate`, `data:reference`,
`data:catalog`, `data:factcheck`, `data:tileqa`) need Python 3 and download the
pinned sources into `.cache/` on first use; see `packages/borders/AGENTS.md`.

If the dev server shows "Outdated Optimize Dep" errors after installing a
package, restart it (Vite's dependency cache is stale).

---

## 3. Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Astro 7** (static output) | Content-first site; pages are HTML with zero JS unless a component needs it. Caddy serves the build after checking access. |
| Access control | **Caddy forward_auth + Node built-in HTTP/crypto** | A small loopback service checks the shared code and signed HttpOnly cookies; no extra npm dependencies. |
| Interactive globe | **React 19** island + Alex's Atlas **ChronoGlobe** on **MapLibre GL 6** (globe projection) | A WebGL globe with smooth interaction, no API keys and no glyph server (labels are drawn from the page's own font). React only for the globe UI state. |
| Historical borders | **Alex's Atlas** modules in `packages/` (from alcaholex/chronoatlas): `@alexs-atlas/borders` dataset + pipeline + `bordersAt(year)`, `@alexs-atlas/globe` | Borders for any year from 3400 BCE to the present, clipped to real coastlines, as static same-origin JSON (CC BY 4.0). Used from TypeScript source through Vite aliases, so no package build step. |
| Content | **Astro content collections** (Markdown / MDX + Zod schemas) | One file per topic/term/teacher; schemas catch mistakes at build time. |
| Immediate globe | **d3-geo** SVG + React | A baked initial frame is in the HTML; drag, pinch, wheel, keyboard and note links work while MapLibre details arrive. The initial 1789 borders come from the same dataset and colours as the detailed map. |
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
      baked/                generated initial 1789 border geometry with map colours (CC BY 4.0)
      pin-layout.ts         separates nearby note pins, with stems to their places
      map.ts                 GlobeController — wraps ChronoGlobe; pins as markers on its map
      Timeline.tsx EraPanel.tsx TopicList.tsx TopicPreview.tsx
      era.ts                 pure timeline maths (eras, lanes, positions)
      map-colors.ts          the map's theme and polity colours (from Alex's Atlas)
      country-colors.ts      generated flag colours (scripts/data/country-colors.mjs)
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
  data/land.geojson                     legacy base land layer (unused, see §11)
  glyphs/noto-sans/                     legacy Noto Sans label glyphs (unused, see §11)
scripts/
  check-content.mjs        content lint (npm run check:content)
  data/sync-atlas-data.mjs copies packages/borders/data → public/data/alexs-atlas (git-ignored)
  data/build-prebaked.mjs  bakes the SVG globe's first frame from the dataset and map colours
  data/country-colors.mjs  regenerates country-colors.ts from the dataset's borders
  data/build-snapshots.mjs legacy snapshot border files (npm run data:snapshots)
  data/name-overrides.json per-year name fixes for the legacy snapshot files (not used by the site)
packages/                  ← Alex's Atlas modules; packages/AGENTS.md and TODO.md are their guide
  borders/                 @alexs-atlas/borders: query API (src/), built dataset (data/, CC BY 4.0),
                           pipeline/ (Node + Python: coast clipping, island assignment, overrides
                           engine, LODs, QA, fact-check), overrides/ (sourced manual fixes), research/
  globe/                   @alexs-atlas/globe: ChronoGlobe, addBorderLayers, Timeline, style.css
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
`astro.config.mjs`, `package.json` / `package-lock.json`, `tsconfig.base.json`,
`vitest.config.ts`, `deploy/server/tick.ps1`, `deploy/server/common.ps1`.
`packages/` follows its own guide: `packages/AGENTS.md` and the per-package
`AGENTS.md` files (dataset contract, override editing guide, globe API).

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

**Add a timeline snapshot year** — add `src/content/snapshots/<year>.md`
(`title`, `summary`, `highlights`). The globe draws the borders of that exact
year from the Alex's Atlas dataset by itself (before 3400 BCE, land only), so
the summary should not name a border source or date. `borderYear` is legacy:
`check:content` still requires it to be `null` or the year of an existing
`public/data/snapshots/world_<year>.geojson` (built by the legacy
`npm run data:snapshots -- <year>`), so give new stops `borderYear: null`.

**Fix a wrong country name or border on the globe** — the globe draws only the
Alex's Atlas dataset: add a sourced override entry in
`packages/borders/overrides/` (guide: `packages/borders/AGENTS.md`), rebuild
with `npm run data:build`, then re-run `node scripts/data/build-prebaked.mjs`
(and `node scripts/data/country-colors.mjs` when the colours of neighbours
need it) and commit the results. After any change to the borders dataset or
the map colours, regenerate the baked SVG frame the same way and commit
`src/features/globe/baked/`.

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
`PrebakedGlobe` renders SVG in the HTML and handles gestures before WebGL is
ready. MapLibre is dynamically imported; the initial coloured globe is retained
until land and historical polygons have reached a rendered frame. No loading
screen replaces the globe. WebGL failures leave the SVG usable.

- **Borders** come from the Alex's Atlas dataset (`packages/borders/data`,
  copied to `public/data/alexs-atlas/` before dev and build and served from
  there) for the exact year selected, −3400 … present (no year 0), through
  `createBorders({ manifestUrl }).bordersAt(year, { lod })`. Before 3400 BCE the
  globe shows physical geography only. Polygons are clipped to Natural Earth
  land. Tier 0 partitions the land between polities and `unclaimed` land;
  tier 1 (indigenous nations, disputed areas) overlays it, hatched;
  `precision: 'approximate'` is dashed. Multi-part features are split into one
  feature per part before they reach MapLibre. The level of detail follows the
  zoom (l0 ≈ 5 km, l1 ≈ 1 km from zoom 3, l2 ≈ 250 m from zoom 5). Contract and API:
  `packages/AGENTS.md` §5. Modern coastlines are a reference, not a claim about
  ancient shorelines.
- **The globe** is ChronoGlobe from `packages/globe` (migration path C in
  `packages/globe/AGENTS.md` §8.7), created by `map.ts`'s `GlobeController`,
  which keeps the interface the explorer and the home page use and adds the note
  pins as MapLibre markers on `globe.map`. It draws the polities with their own
  outlines (no shared border or coast lines), tier 1 hatched, curved labels in
  Newsreader (`labelMode: 'curved'`), a star field behind the globe, a hover
  tooltip ("name · years") and click selection (white outline; Escape clears).
  The explorer, the home handoff URL and the baked SVG share one view,
  `{ center, scale }` with `scale = 2^(zoom − fitZoom)` and
  `fitZoom = log2(min(width, height)·π/512)`. The SVG is an orthographic
  approximation of MapLibre's perspective globe, so the globe shifts slightly
  in size and position when WebGL takes over.
- **Snapshots** are the timeline's exploration stops and "world in" texts.
  Their `borderYear` and the GPL files `public/data/snapshots/world_<year>.geojson`
  are legacy: only `check:content` and the geometry test still use them.
- **Pins** appear only when `start <= selectedYear <= end`, unless show-all is
  enabled. Course level, archive/current selection and search also filter them.
  Every visible pin links directly to its note. Locate buttons in the catalogue
  choose the note's exact start year and fly to its geographical position.
- **URL state**: `/globe?year=1938&topic=<slug>` — used by the "See the world in
  …" button on every topic page. `level`, `curriculum`, `all` and `q` also persist
  in the URL. Home handoffs carry `lng`, `lat` and `scale`. The shared saved level
  uses localStorage key `history-level`; storage failure must not break controls.
- **Colours** (`map-colors.ts`, from the Alex's Atlas site): a grand-strategy
  political map in pastel tones. 21 major powers keep classic colours in every
  era by explicit colour keys (`power`, so colonies share their empire's);
  other countries take a flag colour from `country-colors.ts`, which
  `node scripts/data/country-colors.mjs` generates so that neighbours stay
  distinct (re-run after a dataset rebuild; the committed table is the one the
  Alex's Atlas site ships, which a re-run currently changes for about 120
  countries); the rest take one of 12 slot colours by `c`. Charcoal sea
  `#353535`, stone land `#e3e0d9` for unclaimed land, no atmosphere.
- **Rendering**: labels are drawn by MapLibre from the self-hosted Newsreader
  font (no glyph server); MapLibre's worker is bundled via `?worker&url` and
  passed as `workerUrl` (MapLibre 6 cannot find it on its own when bundled).
  `--ca-*` custom properties in `globe.css` theme the globe component.
- **Border detail**: the Alex's Atlas pipeline simplifies each level of detail
  with spherical Douglas–Peucker on shared topology, protecting microstates
  (`packages/borders/AGENTS.md`). Rebuild it with `npm run data:build`; files
  are content-hashed, so no cache-busting is needed. The legacy snapshot
  pipeline (`scripts/data/build-snapshots.mjs`, 100 m Douglas–Peucker, tested by
  `node --test scripts/data/geometry.test.mjs`) no longer feeds the site.
- Keyboard: timeline is a native slider (arrows, Home/End, PageUp/Down); pins
  are real links; Escape closes panels.
- In development `window.__globe` exposes the controller (`.globe` is the
  ChronoGlobe) for debugging.

---

## 7. Design system

**Personality:** a modern archive — warm paper, ink, oxblood and brass in the
department pages; a dark "planetarium" for the globe. Calm, editorial, serious
about sources, never gamified beyond the key-term progress bar.

- **Tokens only.** Colours, fonts, radii and shadows come from
  `src/styles/tokens.css` (`--paper`, `--ink`, `--accent`, `--brass`,
  `--term`, callout families…). Both themes are defined there; components
  never hard-code colours. The globe has its own palette in `globe.css`
  (always dark) and its map colours in `src/features/globe/map-colors.ts`.
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
| `releases\<sha>\` | built sites, newest 5 kept (≈ 350 MB each, mostly the borders dataset in `data\alexs-atlas\`) |
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
map/JS/CSS/font assets, including the borders dataset under
`/data/alexs-atlas/` (its `manifest.json` revalidated, its content-hashed files
immutable), are public. Keep that allowlist narrow, never use an
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
- Border corrections are sourced override entries in
  `packages/borders/overrides/` (guide: `packages/borders/AGENTS.md`); open
  dataset and globe tasks are in `packages/TODO.md`.
- Retire the legacy globe data nothing on the site draws any more: the
  historical-basemaps snapshot files (only the content lint and the geometry
  test read them), `public/data/land.geojson` and the Noto Sans label glyphs.
- Site search (e.g. Pagefind over `dist/`).
- Verify detailed prescribed Paper 1 pairings and Europe study boundaries
  against the school's full 2028 History guide; only the public brief is verified.

---

## 12. Licences and credits

- Code: all rights reserved by the repository owner unless a licence is added.
- Historical borders on the globe: the Alex's Atlas dataset
  (`packages/borders/data`), **CC BY 4.0** — Cliopatria (Seshat Global History
  Databank, Bennett et al. 2025, CC BY 4.0, modified), Natural Earth (public
  domain) and sourced Alex's Atlas overrides, including Native American nations
  adapted from USDA Forest Service *Tribal Lands Ceded to the United States*
  (CC BY 4.0). The globe's info panel and the home globe's credit link credit
  it, one click from every view; full text in
  `packages/borders/data/ATTRIBUTION.md`. The baked first frame in
  `src/features/globe/baked/` is derived from it (CC BY 4.0).
- Alex's Atlas code (`packages/borders`, `packages/globe`): MIT (per package.json).
- Legacy borders: aourednik/historical-basemaps, **GPL-3.0** — the derived
  files in `public/data/snapshots/` stay under GPL-3.0 (see the LICENSE.md there).
- Natural Earth (land, present-day borders in `world_2026.geojson`, and the
  home-page globe via world-atlas): public domain.
- Legacy map label glyphs (unused): Noto Sans, SIL Open Font License 1.1.
- MapLibre GL JS: BSD-3-Clause. Fonts via Fontsource: OFL.
