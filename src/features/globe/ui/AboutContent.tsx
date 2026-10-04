// The body of the globe's "About" dialog: what the globe is, how the history notes
// appear on it, the credits and licences (every `manifest.sources` entry with its full
// attribution: CC BY 4.0 §3(a)(2) asks for the credits one click from every view), how
// the borders are drawn, privacy, and a button to the keyboard shortcuts. The manifest
// may not have loaded yet: the parts that need it then wait for it.
// Ported from the Alex's Atlas reference site, apps/site/src/ui/dialogs.ts
// (`aboutContent`), with the text adapted to the STR History globe and a section on
// its history notes.
import { attributionHtml, formatYear, type Manifest } from '@alexs-atlas/borders';
import type { JSX, ReactNode } from 'react';
import { FIRST_YEAR } from '../era';
import { Icon } from './Icon';

export interface AboutContentProps {
  /** The dataset's manifest, or null while it loads. */
  manifest: Manifest | null;
  /** Same-origin folder of the dataset files (ends with '/'). */
  dataBase: string;
  onShortcuts(): void;
}

const NEW_TAB = ' (opens in a new tab)';
const CC_BY = 'https://creativecommons.org/licenses/by/4.0/';

/** A link to another site, opening in a new tab (and saying so to screen readers). */
function Ext({ href, children }: { href: string; children: ReactNode }): JSX.Element {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <span className="sr-only">{NEW_TAB}</span>
    </a>
  );
}

/**
 * HTML produced by `attributionHtml` (all text escaped, http(s) links only, each link
 * opening a new tab), with the new-tab note added to every link.
 */
function trustedAttribution(html: string): { __html: string } {
  return { __html: html.replace(/<\/a>/g, `<span class="sr-only">${NEW_TAB}</span></a>`) };
}

/** The build date, e.g. "2 October 2026" (UTC, so it reads the same everywhere). */
function builtText(built: string): string {
  const d = new Date(built);
  if (Number.isNaN(d.getTime())) return built;
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
}

/** Build notes straight from the manifest (what this build changed in each source). */
function BuildNotes({ manifest: m }: { manifest: Manifest }): JSX.Element | null {
  const notes = m.sources.filter((s) => s.changes);
  if (!notes.length) return null;
  return (
    <p className="prose__note">
      <strong>{`This build (${m.version}): `}</strong>
      {notes.map((s) => `${s.name.replace(/\s*\(.*\)$/, '')} — ${s.changes}`).join('; ')}.
    </p>
  );
}

export function AboutContent({ manifest: m, dataBase, onShortcuts }: AboutContentProps): JSX.Element {
  const range = m ? `from ${formatYear(m.years.from)} to ${formatYear(m.years.to)}` : 'through history';
  const firstBorders = m ? formatYear(m.years.from) : null;
  const cut = m ? m.years.cutover : null;
  const origins = `${new Intl.NumberFormat('en-GB').format(-FIRST_YEAR)} BCE`;
  const files = (
    <>
      <a href={`${dataBase}ATTRIBUTION.md`}>ATTRIBUTION.md</a>, <a href={`${dataBase}LICENSE.md`}>LICENSE.md</a>,{' '}
      <a href={`${dataBase}manifest.json`}>manifest.json</a>
    </>
  );

  return (
    <>
      <div className="about__intro">
        <p>
          {`This globe is part of STR History, the website of a high-school history department. It shows the borders of states, colonies and indigenous nations ${range}, with a pin for each of the department’s history notes at the place where its events happened. `}
          Drag the timeline to move through time, click an area to highlight it and its lifespan on the timeline, or
          search for a place, a power or a note by name. The map is built on Alex’s Atlas, a globe of historical
          borders whose dataset is published under CC BY 4.0.
        </p>
      </div>

      <section className="prose__section">
        <h3>History notes on the globe</h3>
        <ul className="prose__list">
          <li>
            <strong>Pins. </strong>
            Each pin marks one IB History study note at the place where its events happened. Pins that would overlap
            fan out, with a fine line to their true place.
          </li>
          <li>
            <strong>Dates. </strong>
            A pin shows only in the years its note covers, unless ‘Show pins from all years’ is on in the history
            notes panel.
          </li>
          <li>
            <strong>Level. </strong>
            SL shows the notes for the shared core of the course; HL shows those and adds the regional study.
          </li>
          <li>
            <strong>Collection. </strong>
            The 2028 curriculum holds the notes for the course first assessed in 2028; the archive keeps the
            department’s earlier notes.
          </li>
          <li>
            <strong>Papers. </strong>
            The P1, P2 and P3 badges name the exam paper a note belongs to.
          </li>
          <li>
            <strong>Study notes. </strong>
            A pin opens its study notes, which need the department’s access code. The globe itself is open to
            everyone.
          </li>
        </ul>
      </section>

      <section className="prose__section">
        <h3>Credits and licences</h3>
        {m ? (
          <>
            <p>
              {`Border data: Alex’s Atlas borders ${m.version} (${m.dataset}), built ${builtText(m.built)}, published under `}
              <Ext href={CC_BY}>CC BY 4.0</Ext>. Files: {files}.
            </p>
            <ul className="credits">
              {m.sources.map((s) => (
                <li key={s.id} className="credits__item">
                  <p className="credits__name">
                    {s.name}
                    {s.version ? <span className="credits__ver">{` ${s.version}`}</span> : null}
                    <span className="credits__lic">{s.license}</span>
                  </p>
                  <p
                    className="credits__text"
                    dangerouslySetInnerHTML={trustedAttribution(attributionHtml({ sources: [s] }, { full: true }))}
                  />
                  {/* The changes, unless the attribution sentence already states them. */}
                  {s.changes && !s.attribution.includes(s.changes) ? (
                    <p className="credits__changes">{`Changes: ${s.changes}.`}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p>
            Border data: the Alex’s Atlas borders dataset, published under <Ext href={CC_BY}>CC BY 4.0</Ext>. Files:{' '}
            {files}. Credits load with the map data.
          </p>
        )}
        {/* Override geometry from a third dataset (not yet in the build's manifest.sources):
            CC BY 4.0 asks for this credit wherever the derived shapes are shown. */}
        <p>
          Native American nations (hatched areas in the United States before 1946): extents adapted from{' '}
          <Ext href="https://catalog.data.gov/dataset/tribal-lands-ceded-to-the-united-states-feature-layer">
            Tribal Lands Ceded to the United States
          </Ext>
          , USDA Forest Service, Office of Tribal Relations (2018), <Ext href={CC_BY}>CC BY 4.0</Ext>, digitised from C.
          C. Royce, Indian Land Cessions in the United States (1899). Changes: simplified and merged per nation and
          period.
        </p>
        <p>
          The globe shown while the detailed map loads is drawn from the same border data, with land from{' '}
          <Ext href="https://github.com/topojson/world-atlas">world-atlas</Ext> (ISC; Natural Earth data).
        </p>
        <p>
          Software and fonts: <Ext href="https://maplibre.org/">MapLibre GL JS</Ext> (BSD-3-Clause), the Alex’s Atlas
          globe and border modules (MIT), <Ext href="https://github.com/topojson/topojson-client">topojson-client</Ext>{' '}
          (ISC), <Ext href="https://github.com/d3/d3-geo">d3-geo</Ext> (ISC),{' '}
          <Ext href="https://react.dev/">React</Ext> (MIT), and the{' '}
          <Ext href="https://github.com/productiontype/Newsreader">Newsreader</Ext> and{' '}
          <Ext href="https://rsms.me/inter/">Inter</Ext> typefaces (SIL Open Font License 1.1), served from this site
          through <Ext href="https://fontsource.org/">Fontsource</Ext>.
        </p>
        <p className="prose__fine">
          Neither STR History nor Alex’s Atlas is affiliated with the Seshat Global History Databank or Natural Earth.
        </p>
      </section>

      <section className="prose__section">
        <h3>How borders are drawn</h3>
        <ul className="prose__list">
          <li>
            <strong>Two sources, one cut-over. </strong>
            {cut !== null
              ? `Until ${cut - 1} the map shows historical polities from Cliopatria, a dataset of the Seshat Global History Databank. From ${cut} it shows Natural Earth’s countries and territories. Each year comes from one source only, so the map changes character at ${cut}.`
              : "Earlier years show historical polities from Cliopatria, a dataset of the Seshat Global History Databank; recent decades show Natural Earth’s countries and territories. Each year comes from one source only."}
          </li>
          <li>
            <strong>One map per year. </strong>
            Borders are shown as they stood at the end of the year: a change during a year appears from that year on.
            There is no year 0 — 1 BCE is followed by 1 CE.
          </li>
          <li>
            <strong>Before the first borders. </strong>
            {`The timeline reaches back to about ${origins}, the approximate origin of our species. `}
            {firstBorders
              ? `The border data begins in ${firstBorders}; before that the globe shows land only.`
              : 'Before the border data begins, the globe shows land only.'}
          </li>
          <li>
            <strong>Coastlines. </strong>
            Polity shapes are cut to Natural Earth’s coastline and islands are assigned to the polity that held
            them, so fills, borders and coasts line up. Land that no polity held is drawn in a neutral stone grey.
            The coastline is today’s in every year: a reference, not a claim about ancient shorelines.
          </li>
          <li>
            <strong>Hatched areas. </strong>
            Indigenous nations and disputed areas are drawn as hatched overlays on top of the states around them.
            Their extents are approximate; a dashed outline marks any approximate extent.
          </li>
          <li>
            <strong>Colours. </strong>
            Major powers keep their classic map colours (Britain pink, France blue, Italy green, Spain yellow, the
            Soviet Union red, Qing China yellow, the People’s Republic of China red …). Other countries take a colour
            from their flag. Colonies and dependencies share their ruling power’s colour; neighbours are coloured
            differently where possible. Each polity is outlined in a deeper shade of its own colour.
          </li>
          <li>
            <strong>Accuracy. </strong>
            Historical borders are uncertain, and more so the further back you go or where no state kept records.
            Small or short-lived polities may be missing. Read the map as an overview, not an exact or legal record.
            Every manual correction in the data cites its sources.
          </li>
        </ul>
        {m ? <BuildNotes manifest={m} /> : null}
      </section>

      <section className="prose__section">
        <h3>Privacy</h3>
        <p>
          Everything on this page — map data, fonts and code — comes from this website. There are no analytics, no
          tracking and no requests to other servers. The globe keeps one thing in this browser’s storage: your SL or
          HL choice (under history-level), which the notes library shares. The only cookie is the one that keeps the
          study notes unlocked for seven days once the department’s access code has been entered. What you are
          looking at — the year, the filters and the selected note or place — lives only in the page address (for
          example ?year=1789), which you can share or delete.
        </p>
      </section>

      <p className="about__foot">
        <button type="button" className="ui-btn ui-btn--text" onClick={onShortcuts}>
          <Icon name="keyboard" />
          Keyboard shortcuts
        </button>
      </p>
    </>
  );
}
