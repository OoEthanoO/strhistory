/**
 * The note preview card (bottom right above the timeline; full width on phones): the
 * note under the pointer or keyboard focus, else the selected note — its paper and
 * unit, dates and place, summary, a link to its study notes and, when its pin is not
 * on the globe in the year shown, a button that goes to its year and place.
 */
import { useRef } from 'react';
import { formatRange, formatYear } from '../era';
import type { GlobeTopic } from '../types';
import { Icon, IconButton } from './Icon';

export interface TopicPreviewProps {
  topic: GlobeTopic;
  /** Whether the note's pin is on the globe in the year shown. */
  inYear: boolean;
  /** Only for the selected note (a hover preview closes on its own). */
  onClose?(): void;
  onLocate(topic: GlobeTopic): void;
  /** The pointer reached or left the card (a hover preview stays while the pointer is on it). */
  onPointerEnter?(): void;
  onPointerLeave?(): void;
}

export function TopicPreview({ topic, inYear, onClose, onLocate, onPointerEnter, onPointerLeave }: TopicPreviewProps) {
  const read = useRef<HTMLAnchorElement>(null);
  return (
    <aside className="preview" aria-label="Note preview" onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
      <div className="preview__head">
        <span className="paper-badge" data-paper={topic.paper} title={`Paper ${topic.paper}`}>
          P{topic.paper}
        </span>
        <span className="preview__unit">{topic.unitTitle}</span>
        {onClose && <IconButton icon="close" className="ui-btn--small preview__close" label="Close preview" onClick={onClose} />}
      </div>
      <h2 className="preview__title">{topic.title}</h2>
      <p className="preview__meta">
        {formatRange(topic.start, topic.end)} · {topic.place}
      </p>
      <p className="preview__summary">{topic.summary}</p>
      <div className="preview__actions">
        <a className="btn-primary" href={topic.href} ref={read}>
          Read the notes <Icon name="arrowRight" />
        </a>
        {!inYear && (
          <button
            type="button"
            className="btn-text"
            onClick={() => {
              // The button goes once the pin is on the globe: keep focus in the card.
              read.current?.focus({ preventScroll: true });
              onLocate(topic);
            }}
          >
            Show on the globe in {formatYear(topic.start)}
          </button>
        )}
      </div>
    </aside>
  );
}
