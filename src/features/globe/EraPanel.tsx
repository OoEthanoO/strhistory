import { BORDERS_FROM, formatYear } from './era';
import type { GlobeSnapshot } from './types';

interface Props {
  year: number;
  snapshot?: GlobeSnapshot;
  /** The border data for the chosen year is still downloading. */
  loading: boolean;
  open: boolean;
  onToggle(): void;
}

function mapDate(year: number, loading: boolean): string {
  if (year < BORDERS_FROM) return `No borders shown before ${formatYear(BORDERS_FROM)}`;
  if (loading) return 'Loading borders…';
  return `Borders in ${formatYear(year)}: OpenHistoricalMap`;
}

/** Selected date and independently sourced world context, just above the timeline. */
export default function EraPanel({ year, snapshot, loading, open, onToggle }: Props) {
  return (
    <section className="gx-panel gx-era" aria-label={`The world in ${formatYear(year)}`}>
      <div className="gx-era__head">
        <div><span className="gx-eyebrow">The world in</span><p className="gx-era__year">{formatYear(year)}</p></div>
        <button type="button" className="gx-icon-btn" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Hide year summary' : 'Show year summary'}>{open ? '−' : '+'}</button>
      </div>
      <p className="gx-era__mapdate" aria-live="polite">{mapDate(year, loading)}</p>
      {open && <div className="gx-era__body">
        {snapshot ? <>
          <h2 className="gx-era__title">{snapshot.title}</h2>
          {snapshot.year !== year && <p className="gx-era__context">Context from {formatYear(snapshot.year)}</p>}
          <p>{snapshot.summary}</p>
        </> : <p>Explore this year on the globe. A historical summary has not yet been added.</p>}
        <p className="gx-era__caveat">Borders come from OpenHistoricalMap, drawn by volunteers, and are shown from {formatYear(BORDERS_FROM)}. It still has gaps, especially before 1900 in Africa, the Middle East and South Asia, and its outlines and dates are approximate. Modern coastlines are a reference only.</p>
      </div>}
    </section>
  );
}
