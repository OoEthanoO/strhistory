# AGENTS.md — STR History

The single source of truth for **what this site is, how it is designed, how the
code is organised, how to work on it without stepping on anyone else, and how
it is deployed**. It is written for both people and coding agents (Claude,
Codex, Copilot, Cursor…). `CLAUDE.md` only points here — keep all guidance in
this file.

Live site: **https://history.ethanyanxu.com** · Repo: https://github.com/OoEthanoO/strhistory

---

## 1. Purpose

A website for a high-school history department with two jobs:

1. **An interactive, timeline-based globe of IB History.** A 3D globe shows the
   world's political borders at a chosen snapshot in time (1100 → 2010). Each
   IB History topic is a pin. Clicking a lit pin opens that topic's study notes.
   A timeline along the bottom moves between snapshots. Inspired by
   globeofhistory.com.
2. **Interactive study notes** for each topic: key quotations are highlighted and
   attributed, key terms reveal their *significance* when clicked, and each
   topic ends with self-test questions and a historians' debate.
3. **The department's home online**: courses, teacher profiles, news, study
   guides (exam papers, IA, extended essay), and an about page.

Audience: IB Diploma History students (SL and HL, grades 11–12), pre-IB
students, parents, and the department's teachers, who add and edit content.

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
- The IB assessment details on the site follow the History guide first
  assessed in 2017 (and the EE guide first assessed in 2018). Pages say so.
  Verify against the current guide before changing them.

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
```

Before every push: `npm run check && npm run build` must pass. CI runs the same.

If the dev server shows "Outdated Optimize Dep" errors after installing a
package, restart it (Vite's dependency cache is stale).

---

## 3. Tech stack

| Concern | Choice | Why |
| --- | --- | --- |
| Framework | **Astro 7** (static output) | Content-first site; pages are HTML with zero JS unless a component needs it. Static output means the server only serves files — nothing to crash or restart. |
| Interactive globe | **React 19** island + **MapLibre GL 6** (globe projection) | MapLibre renders GeoJSON borders on a WebGL globe with smooth interaction and no API keys. React only for the globe UI state. |
| Content | **Astro content collections** (Markdown / MDX + Zod schemas) | One file per topic/term/teacher; schemas catch mistakes at build time. |
| Home-page globe | **d3-geo** at build time | An orthographic SVG rendered during the build — no client JS. |
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
    topics/<slug>.mdx        IB topics = globe pins + study notes
    glossary/<id>.md         key terms used by <Term id="…">
    syllabus/<id>.md         IB syllabus units (papers 1–3)
    snapshots/<year>.md      globe timeline stops + "world in <year>" text
    teachers/ courses/ news/ guides/   department pages
  schemas/                 ← one Zod schema file per collection family
  features/
    globe/                 ← FEATURE: the /globe explorer (React island)
      GlobeExplorer.tsx      state, URL sync, playback; composes the pieces below
      map.ts                 GlobeController — the only file that touches MapLibre
      Timeline.tsx EraPanel.tsx TopicList.tsx TopicPreview.tsx
      era.ts                 pure timeline maths (eras, lanes, positions)
      palette.ts             polity colours
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
  data/land.geojson                     generated base land layer
  glyphs/noto-sans/                     map label glyphs
scripts/
  check-content.mjs        content lint (npm run check:content)
  data/build-snapshots.mjs border data pipeline (npm run data:snapshots)
  data/name-overrides.json per-year fixes for anachronistic names in the border data
deploy/
  Caddyfile                the site's Caddy config (source of truth)
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
- **YAML gotcha:** a value containing `": "` or starting with a quote must be
  wrapped in quotes, e.g. `title: "Guest lecture: archives"`. The content lint
  catches this.

### Recipes

**Add a topic (a new pin + notes)**
1. Copy `src/content/topics/_template.mdx` to `src/content/topics/<slug>.mdx`.
2. Fill in the frontmatter. `unit` must be a file in `src/content/syllabus/`.
   `location` is where the pin goes — choose a place that is distinct from
   existing pins (check the globe).
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
`geojson/` folder), check the names on the globe, add fixes to
`scripts/data/name-overrides.json` and re-run if needed, then commit the
markdown file and `public/data/snapshots/world_<year>.geojson` together.

**Fix a wrong country name on the globe** — add an entry for that year in
`scripts/data/name-overrides.json` (string = new display name; object =
`{ "name": …, "subjecto": … }` to also change the controlling power used for
colour), then `npm run data:snapshots -- <year>`.

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
pep talk. Aim for 800–1,500 words of prose. Every key term that a student
should be able to define gets a `<Term>` the first time it appears.

In JSX attributes, use typographic quotes (“ ” ‘ ’) or single quotes inside
double-quoted values; never raw `{`, `}` or `<` in MDX text.

---

## 6. The globe

Data flow: `src/pages/globe.astro` calls `getGlobeData()` (build time) →
serialisable `{ topics, snapshots }` → `<GlobeExplorer client:only="react">`.

- **Snapshots** are the timeline stops. Each has a border file
  `public/data/snapshots/world_<year>.geojson`, fetched when selected and
  cached; neighbours are prefetched. Polygon features carry `name`,
  `subjecto` (controlling power — drives colour), `partof`, `precision`
  (1 = approximate border → drawn dashed). Point features with `kind: "label"`
  are pre-computed label anchors (one per polity).
- **Eras**: snapshot *i* covers `[year_i, year_{i+1})`. A topic's pin is **lit**
  in an era if its period overlaps the era *and* the snapshot year is within 10
  years of the topic's dates, or if it is the topic's own `snapshot`
  (`era.ts → topicInEra`). Lit pins link to the notes; faint pins move the
  timeline to their era.
- **URL state**: `/globe?year=1938&topic=<slug>` — used by the "See the world in
  …" button on every topic page. Keep it working.
- **Colours**: `palette.ts` hashes the controlling power's name, with fixed
  colours for major empires so they stay recognisable across years.
- **Rendering**: MapLibre globe projection with a light atmosphere; labels use
  self-hosted glyphs (`public/glyphs/noto-sans`); MapLibre's worker is bundled via
  `?worker&url` + `setWorkerUrl` (MapLibre 6 cannot find it on its own when
  bundled).
- Keyboard: timeline is a `role="slider"` (arrows, Home/End, PageUp/Down); pins
  are real links; Escape closes panels.
- In development `window.__globe` exposes the controller for debugging.

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
- **Performance:** pages ship no JS unless they need it; the globe's MapLibre
  bundle (~1 MB) loads only on `/globe`.

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
  whitespace handling, Vite options.
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
- More topics: Richard I (PS1), final stages of Muslim rule in Spain and the
  conquest of Peru (PS2), and more Paper 2 / Paper 3 content.
- Some upstream border data is approximate or anachronistic (for example,
  Vietnam is not shown divided in 1960). Fix names via
  `name-overrides.json`; geometry fixes belong upstream in
  aourednik/historical-basemaps.
- Site search (e.g. Pagefind over `dist/`) and a sitemap.
- Verify assessment details against the current IB History guide.

---

## 12. Licences and credits

- Code: all rights reserved by the repository owner unless a licence is added.
- Historical borders: aourednik/historical-basemaps, **GPL-3.0** — the derived
  files in `public/data/snapshots/` stay under GPL-3.0 (see the LICENSE.md there).
- Natural Earth (land, and the home-page globe via world-atlas): public domain.
- Map label glyphs: Noto Sans, SIL Open Font License 1.1.
- MapLibre GL JS: BSD-3-Clause. Fonts via Fontsource: OFL.
