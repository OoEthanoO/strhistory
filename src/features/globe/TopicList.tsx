import { formatRange } from './era';
import type { GlobeTopic } from './types';

interface Props {
  year: number;
  inEra: GlobeTopic[];
  others: GlobeTopic[];
  selected: string | null;
  onSelect(topic: GlobeTopic): void;
  onHover(topic: GlobeTopic | null): void;
  onClose(): void;
}

function Item({
  topic,
  selected,
  onSelect,
  onHover,
}: {
  topic: GlobeTopic;
  selected: boolean;
  onSelect(t: GlobeTopic): void;
  onHover(t: GlobeTopic | null): void;
}) {
  return (
    <li className="gx-list__item" data-selected={selected || undefined}>
      <button
        type="button"
        className="gx-list__pick"
        onClick={() => onSelect(topic)}
        onMouseEnter={() => onHover(topic)}
        onMouseLeave={() => onHover(null)}
      >
        <span className="gx-paper" data-paper={topic.paper}>
          P{topic.paper}
        </span>
        <span className="gx-list__text">
          <span className="gx-list__title">{topic.title}</span>
          <span className="gx-list__meta">
            {formatRange(topic.start, topic.end)} · {topic.place}
          </span>
        </span>
      </button>
      <a className="gx-list__notes" href={topic.href} aria-label={`Notes: ${topic.title}`}>
        Notes
      </a>
    </li>
  );
}

/** Drawer listing every topic: the current era first, then the rest by date. */
export default function TopicList({ year, inEra, others, selected, onSelect, onHover, onClose }: Props) {
  return (
    <aside className="gx-panel gx-list" aria-label="IB topics">
      <div className="gx-list__head">
        <h2>IB topics</h2>
        <button type="button" className="gx-icon-btn" onClick={onClose} aria-label="Close topic list">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
      <div className="gx-list__scroll">
        <h3>On the {year} map</h3>
        {inEra.length ? (
          <ul>
            {inEra.map((t) => (
              <Item key={t.slug} topic={t} selected={selected === t.slug} onSelect={onSelect} onHover={onHover} />
            ))}
          </ul>
        ) : (
          <p className="gx-list__empty">No topics in this era yet.</p>
        )}
        {others.length > 0 && (
          <>
            <h3>Other eras</h3>
            <ul>
              {others.map((t) => (
                <Item key={t.slug} topic={t} selected={selected === t.slug} onSelect={onSelect} onHover={onHover} />
              ))}
            </ul>
          </>
        )}
      </div>
      <a className="gx-list__all" href="/topics">
        Browse all notes by syllabus →
      </a>
    </aside>
  );
}
