import { formatDate } from './logic';
import type { HistoryEvent } from './types';

const ccLicence = 'https://creativecommons.org/licenses/by-sa/3.0/de/deed.en';

/** Attribution stays available while the title and event date are hidden. */
export function ClueCredit({ event }: { event: HistoryEvent }) {
  return <span className="clue-credit">{event.image.creator} · {event.image.licence === 'CC BY-SA 3.0 DE' ? <a href={ccLicence} target="_blank" rel="noreferrer">{event.image.licence}</a> : event.image.licence}. <a href={event.image.source} target="_blank" rel="noreferrer">Image source ↗</a></span>;
}

export function ImageCredit({ event }: { event: HistoryEvent }) {
  return <details className="game-credit"><summary>About this image & sources</summary>
    <p><cite>{event.image.title}</cite> — {event.image.creator}. Image made {event.image.created}. {event.image.licence}.</p>
    <p>The image’s creation date may differ from the event date. Paintings are interpretations, not photographs of the past.</p>
    <div className="game-links"><a href={event.image.source} target="_blank" rel="noreferrer">Image & licence ↗</a>{event.image.licence === 'CC BY-SA 3.0 DE' && <a href={ccLicence} target="_blank" rel="noreferrer">CC BY-SA 3.0 DE terms ↗</a>}<a href={event.source.url} target="_blank" rel="noreferrer">{event.source.label} ↗</a></div>
  </details>;
}

export default function EventReveal({ event }: { event: HistoryEvent }) {
  return <div className="event-reveal">
    <p className="game-kicker">The event</p><h3>{event.title}</h3>
    <p className="event-date">{formatDate(event.date)} · {event.location.name}</p>
    <p>{event.summary}</p>
    <div className="game-links">{event.topic && <a href={`/topics/${event.topic}`}>Read the study note →</a>}<a href={`/globe?year=${event.date.year}&lng=${event.location.lng}&lat=${event.location.lat}&scale=4`}>Explore this place & year →</a></div>
    <ImageCredit event={event} />
  </div>;
}
