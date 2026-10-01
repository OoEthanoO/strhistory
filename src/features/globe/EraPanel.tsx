import { formatYear } from './era';
import type { GlobeSnapshot } from './types';

interface Props {
  year: number;
  snapshot?: GlobeSnapshot;
  borderYear: number | null;
  open: boolean;
  onToggle(): void;
}

/** Selected date and independently sourced world context, just above the timeline. */
export default function EraPanel({ year, snapshot, borderYear, open, onToggle }: Props) {
  return (
    <section className="gx-panel gx-era" aria-label={`The world in ${formatYear(year)}`}>
      <div className="gx-era__head">
        <div><span className="gx-eyebrow">The world in</span><p className="gx-era__year">{formatYear(year)}</p></div>
        <button type="button" className="gx-icon-btn" onClick={onToggle} aria-expanded={open} aria-label={open ? 'Hide year summary' : 'Show year summary'}>{open ? '−' : '+'}</button>
      </div>
      <p className="gx-era__mapdate">{borderYear === null ? 'Physical geography · no political borders shown' : `Political borders: ${formatYear(borderYear)} reconstruction`}</p>
      {open && <div className="gx-era__body">
        {snapshot ? <>
          <h2 className="gx-era__title">{snapshot.title}</h2>
          {snapshot.year !== year && <p className="gx-era__context">Context from {formatYear(snapshot.year)}</p>}
          <p>{snapshot.summary}</p>
        </> : <p>Explore this year on the globe. A historical summary has not yet been added.</p>}
        <p className="gx-era__caveat">Modern coastlines are a reference; historical borders and early dates are approximate.</p>
      </div>}
    </section>
  );
}
