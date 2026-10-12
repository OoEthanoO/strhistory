import { useEffect, useRef, useState } from 'react';
import DeckChooser from './DeckChooser';
import EventReveal, { ClueCredit } from './EventReveal';
import { useDeck } from './useDeck';
import { dateValue, filterEvents, formatDate, shuffled, validInsertion } from './logic';
import type { GameCatalogue, HistoryEvent } from './types';
import './games.css';

export default function TimelineGame({ catalogue }: { catalogue: GameCatalogue }) {
  const { course, setCourse, unit, setUnit } = useDeck(catalogue);
  const [deck, setDeck] = useState<HistoryEvent[]>([]), [timeline, setTimeline] = useState<HistoryEvent[]>([]);
  const [turn, setTurn] = useState(1), [mistakes, setMistakes] = useState(0), [correct, setCorrect] = useState(0);
  const [streak, setStreak] = useState(0), [longest, setLongest] = useState(0);
  const [verdict, setVerdict] = useState<boolean | null>(null), [complete, setComplete] = useState(false);
  const focusTarget = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (deck.length) focusTarget.current?.focus(); }, [turn, verdict, complete, deck.length]);
  const available = filterEvents(catalogue, course, unit), current = deck[turn];
  function start() {
    const events = shuffled(available).slice(0, 9);
    setDeck(events); setTimeline(events.slice(0, 1)); setTurn(1); setMistakes(0); setCorrect(0); setStreak(0); setLongest(0); setVerdict(null); setComplete(false);
  }
  function insert(index: number) {
    if (verdict !== null || !current || complete) return;
    const right = validInsertion(timeline, current, index);
    setVerdict(right);
    if (right) { setCorrect(value => value + 1); setStreak(value => value + 1); setLongest(value => Math.max(value, streak + 1)); }
    else { setMistakes(value => value + 1); setStreak(0); }
    setTimeline(old => [...old, current].sort((a, b) => dateValue(a.date) - dateValue(b.date)));
  }
  function next() {
    if (mistakes === 3 || turn === deck.length - 1) setComplete(true);
    else { setTurn(value => value + 1); setVerdict(null); }
  }
  if (!deck.length) return <div className="history-game game-setup">
    <div><p className="game-kicker">A little perspective on the past</p><h2>What came first?</h2><p className="game-intro">A railway opens. A revolution begins. An empire is proclaimed. Build a timeline, one image at a time.</p><ol className="game-instructions"><li>Start with one dated event.</li><li>Place each new event before, after or between the others.</li><li>Learn from every reveal. The run ends after three mistakes.</li></ol></div>
    <div className="game-panel"><h3>Choose a thread through history</h3><DeckChooser catalogue={catalogue} course={course} unit={unit} onCourse={setCourse} onUnit={setUnit} /><button className="game-button primary" disabled={available.length < 2} onClick={start}>Start the timeline →</button><p className="game-help">Up to eight placements. No timer. Earlier events stay visible as your timeline grows.</p></div>
  </div>;
  if (complete) return <div className="history-game game-summary"><p className="game-kicker">Your timeline</p><h2 ref={focusTarget} tabIndex={-1}>{correct} of {turn} in the right place.</h2><p>Longest correct sequence: {longest}. {mistakes === 3 ? 'Three mistakes reached—try the connections again with a fresh deck.' : 'You reached the end of this deck.'}</p><ol className="finished-timeline">{timeline.map(event => <li key={event.id}><time>{formatDate(event.date)}</time><div><strong>{event.title}</strong><p>{event.location.name}</p><a href={event.source.url} target="_blank" rel="noreferrer">Event source ↗</a></div></li>)}</ol><div className="game-actions"><button className="game-button primary" onClick={start}>Try a fresh timeline</button><button className="game-button" onClick={() => setDeck([])}>Choose another deck</button><a href="/games/history-craft">Try History Craft →</a></div></div>;
  return <div className="history-game">
    <div className="game-status"><h2 ref={focusTarget} tabIndex={-1}>{verdict === null ? 'Find its place in time' : verdict ? 'Right on the timeline.' : 'A useful connection to remember.'}</h2><p>Card {turn} / {deck.length - 1} <span>·</span> {correct} correct <span>·</span> <strong>{3 - mistakes} mistakes left</strong></p><button className="game-text-button" onClick={() => setDeck([])}>New timeline</button></div>
    <div className="timeline-layout"><div className="timeline-prompt"><figure className="event-image"><img key={current.id} src={current.image.src} alt={current.image.alt} style={verdict === null && current.image.concealBottom ? { clipPath: `inset(0 0 ${current.image.concealBottom}% 0)` } : undefined} /><figcaption>{verdict === null ? 'Date hidden until you place the event.' : formatDate(current.date)}<ClueCredit event={current} /></figcaption></figure><h3>{current.title}</h3>{verdict !== null ? <><p className={`timeline-verdict ${verdict ? 'is-correct' : ''}`} role="status">{verdict ? 'Correct placement.' : 'Not quite. The event has been placed at its correct date below.'}</p><EventReveal event={current} /><button className="game-button primary" onClick={next}>{mistakes === 3 || turn === deck.length - 1 ? 'See your timeline' : 'Next event'} →</button></> : <p className="game-help">Select a gap in the timeline. Dates are compared to the day; events on the same day can go in either order.</p>}</div>
      <div className="timeline-board"><p className="game-kicker">Earlier → later</p><ol className="timeline-track">{Array.from({ length: timeline.length + 1 }, (_, index) => <li className="timeline-step" key={index}>
        {verdict === null && <button className="insert-event" onClick={() => insert(index)} aria-label={index === 0 ? `Place before ${timeline[0]!.title}` : index === timeline.length ? `Place after ${timeline[index - 1]!.title}` : `Place between ${timeline[index - 1]!.title} and ${timeline[index]!.title}`}><span aria-hidden="true">＋</span> {index === 0 ? 'Before everything' : index === timeline.length ? 'After everything' : 'Place here'}</button>}
        {timeline[index] && <div className={`timeline-event ${timeline[index]!.id === current.id ? 'just-placed' : ''}`}><img src={timeline[index]!.image.src} alt="" /><div><time>{formatDate(timeline[index]!.date)}</time><strong>{timeline[index]!.title}</strong></div></div>}
      </li>)}</ol></div>
    </div>
  </div>;
}
