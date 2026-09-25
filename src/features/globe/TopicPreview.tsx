import { formatRange } from './era';
import type { GlobeTopic } from './types';

interface Props {
  topic: GlobeTopic;
  /** True when the topic belongs to the era on screen (its pin is lit). */
  inEra: boolean;
  /** Shown only for a clicked/selected topic, not a hover preview. */
  onClose?: () => void;
  onJump(topic: GlobeTopic): void;
}

/** Card describing a topic: shown while hovering a pin, or after picking one from the list/timeline. */
export default function TopicPreview({ topic, inEra, onClose, onJump }: Props) {
  return (
    <aside className="gx-panel gx-preview" aria-label={`Topic: ${topic.title}`}>
      <div className="gx-preview__top">
        <p className="gx-preview__unit">
          <span className="gx-paper" data-paper={topic.paper}>
            P{topic.paper}
          </span>
          {topic.unitTitle}
        </p>
        {onClose && (
          <button type="button" className="gx-icon-btn" onClick={onClose} aria-label="Close preview">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <h3 className="gx-preview__title">{topic.title}</h3>
      <p className="gx-preview__when">
        {formatRange(topic.start, topic.end)} · {topic.place}
      </p>
      <p className="gx-preview__summary">{topic.summary}</p>
      <div className="gx-preview__actions">
        <a className="gx-btn gx-btn--primary" href={topic.href}>
          Read the notes
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
            <path d="M5 12h13m-5-6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
        {!inEra && (
          <button type="button" className="gx-btn" onClick={() => onJump(topic)}>
            Show {topic.snapshot} map
          </button>
        )}
      </div>
    </aside>
  );
}
