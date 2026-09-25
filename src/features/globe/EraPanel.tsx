import type { GlobeSnapshot } from './types';

interface Props {
  snapshot: GlobeSnapshot;
  topicCount: number;
  open: boolean;
  onToggle(): void;
  onShowTopics(): void;
}

/** Top-left card: the snapshot year, what the world looked like, and a way into its topics. */
export default function EraPanel({ snapshot, topicCount, open, onToggle, onShowTopics }: Props) {
  return (
    <section className="gx-panel gx-era" aria-live="polite" aria-label={`The world in ${snapshot.year}`}>
      <div className="gx-era__head">
        <p className="gx-era__year">{snapshot.year}</p>
        <button
          type="button"
          className="gx-icon-btn gx-era__toggle"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={open ? 'Hide era summary' : 'Show era summary'}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path
              d={open ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
      <h2 className="gx-era__title">{snapshot.title}</h2>
      {open && (
        <div className="gx-era__body">
          <p>{snapshot.summary}</p>
          {snapshot.highlights.length > 0 && (
            <ul>
              {snapshot.highlights.map((h) => (
                <li key={h}>{h}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <button type="button" className="gx-era__topics" onClick={onShowTopics}>
        <span className="gx-era__count">{topicCount}</span>
        {topicCount === 1 ? 'IB topic in this era' : 'IB topics in this era'}
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
          <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}
