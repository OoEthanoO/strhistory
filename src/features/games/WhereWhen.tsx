import { useEffect, useRef, useState } from 'react';
import DeckChooser from './DeckChooser';
import EventReveal, { ClueCredit } from './EventReveal';
import GuessMap from './GuessMap';
import { useDeck } from './useDeck';
import { filterEvents, formatDate, parseDate, scoreGuess, shuffled } from './logic';
import type { Coordinates, GameCatalogue, HistoryEvent, MapArtwork } from './types';
import './games.css';

interface Props { catalogue: GameCatalogue; artwork: MapArtwork }
type Result = ReturnType<typeof scoreGuess> & { event: HistoryEvent };

export default function WhereWhen({ catalogue, artwork }: Props) {
  const { course, setCourse, unit, setUnit } = useDeck(catalogue);
  const [rounds, setRounds] = useState<HistoryEvent[]>([]), [index, setIndex] = useState(0);
  const [place, setPlace] = useState<Coordinates | null>(null), [date, setDate] = useState('');
  const [results, setResults] = useState<Result[]>([]), [revealed, setRevealed] = useState(false);
  const [complete, setComplete] = useState(false), [imageError, setImageError] = useState(false);
  const [message, setMessage] = useState(''), [best, setBest] = useState(0);
  const focusTarget = useRef<HTMLHeadingElement>(null);
  useEffect(() => { try { const stored = Number(localStorage.getItem('history-games-where-best-v1')); if (Number.isFinite(stored) && stored >= 0 && stored <= 50000) setBest(stored); } catch {} }, []);
  useEffect(() => { if (rounds.length || complete) focusTarget.current?.focus(); }, [index, rounds.length, revealed, complete]);
  const event = rounds[index];
  const total = results.reduce((sum, result) => sum + result.total, 0);
  const available = filterEvents(catalogue, course, unit);
  function start() {
    setRounds(shuffled(available).slice(0, 5)); setIndex(0); setPlace(null); setDate(''); setResults([]); setRevealed(false); setComplete(false); setImageError(false); setMessage('');
  }
  function submit() {
    const parsed = parseDate(date);
    if (!place || !parsed || !event || revealed) { setMessage('Place a pin and enter a valid event date before revealing the answer.'); return; }
    const result = scoreGuess(event, place, parsed);
    setResults(old => [...old, { ...result, event }]); setRevealed(true); setMessage('');
  }
  function next() {
    if (index === rounds.length - 1) {
      setComplete(true);
      // Only compare like-for-like five-round runs.
      if (rounds.length === 5 && total > best) { setBest(total); try { localStorage.setItem('history-games-where-best-v1', String(total)); } catch {} }
    } else { setIndex(old => old + 1); setPlace(null); setDate(''); setRevealed(false); setImageError(false); }
  }
  if (!rounds.length) return <div className="history-game game-setup">
    <div><p className="game-kicker">Look closely. Place your pin.</p><h2>A moment in history.<br />Where—and when?</h2><p className="game-intro">Read the clues in a painting or photograph. Pin the place, enter the exact date, then see the story behind the image.</p>
      <ol className="game-instructions"><li>Choose a course and unit.</li><li>Guess up to five events, with no timer.</li><li>Earn up to 5,000 points each for place and date.</li></ol>
      {best > 0 && <p className="game-help">Best five-round score on this browser: {best.toLocaleString()} / 50,000.</p>}
    </div>
    <div className="game-panel"><h3>Build your expedition</h3><DeckChooser catalogue={catalogue} course={course} unit={unit} onCourse={setCourse} onUnit={setUnit} />
      <button className="game-button primary" disabled={!available.length} onClick={start}>Start {Math.min(5, available.length)} rounds <span aria-hidden="true">→</span></button>
      <p className="game-help">Images include later artistic depictions. Dates refer to the event, not the making of the image. Sources appear after each guess.</p>
    </div>
  </div>;
  if (complete) return <div className="history-game game-summary">
    <p className="game-kicker">Expedition complete</p><h2 ref={focusTarget} tabIndex={-1}>{total.toLocaleString()} <span>/ {(rounds.length * 10000).toLocaleString()}</span></h2>
    <p>Every image has a place in the story. Revisit the sources behind your guesses.</p>
    <ol className="round-results">{results.map(result => <li key={result.event.id}><img src={result.event.image.src} alt="" /><div><strong>{result.event.title}</strong><span>{formatDate(result.event.date)} · {result.event.location.name}</span><a href={result.event.source.url} target="_blank" rel="noreferrer">Event source ↗</a></div><strong>{result.total.toLocaleString()}<small>points</small></strong></li>)}</ol>
    <div className="game-actions"><button className="game-button primary" onClick={start}>Play another round</button><button className="game-button" onClick={() => { setRounds([]); setComplete(false); }}>Choose another deck</button><a href="/games/timeline">Try the timeline →</a></div>
  </div>;
  const result = results[index];
  return <div className="history-game">
    <div className="game-status"><h2 ref={focusTarget} tabIndex={-1}>{revealed ? 'The story behind the image' : `Where & when?`}</h2><p>Round {index + 1} / {rounds.length} <span>·</span> <strong>{total.toLocaleString()} points</strong></p><button className="game-text-button" onClick={() => { setRounds([]); setComplete(false); }}>New expedition</button></div>
    <div className="where-layout">
      <div className="image-column"><figure className="event-image"><img key={event.id} src={event.image.src} alt={event.image.alt} style={!revealed && event.image.concealBottom ? { clipPath: `inset(0 0 ${event.image.concealBottom}% 0)` } : undefined} onError={() => setImageError(true)} /><figcaption>{imageError ? 'The image could not load. Check your connection and reload this page.' : 'Inspect the image, then date and locate the event it depicts.'}<ClueCredit event={event} /></figcaption></figure>
        {revealed && <EventReveal event={event} />}
      </div>
      <div className="guess-column"><GuessMap key={index} artwork={artwork} value={place} onChange={setPlace} answer={revealed ? event.location : undefined} />
        {revealed && result ? <div className="game-panel result-panel" role="status"><p className="game-kicker">Your round</p><div className="score-pair"><div><strong>{result.km < 1 ? '< 1' : Math.round(result.km).toLocaleString()} km</strong><span>from the site · {result.placeScore.toLocaleString()} points</span></div><div><strong>{result.days === 0 ? 'Exact date' : `${result.days.toLocaleString()} days`}</strong><span>{result.days === 0 ? '' : 'from the date · '}{result.dateScore.toLocaleString()} points</span></div></div><button className="game-button primary" onClick={next}>{index === rounds.length - 1 ? 'See expedition results' : 'Next image'} →</button></div> : <form className="game-panel" onSubmit={e => { e.preventDefault(); submit(); }}>
          <label className="date-guess">When did it happen?<input type="date" required min="0001-01-01" max={`${new Date().getFullYear()}-12-31`} value={date} onChange={e => setDate(e.target.value)} /></label>
          <p className="game-help">Choose day, month and year. Full date points require the exact day; closer guesses earn more.</p>
          <button className="game-button primary" disabled={!place || !parseDate(date) || imageError}>Reveal the event →</button><p role="status" className="game-help">{message || (!place ? 'Place a pin on the map to continue.' : 'Pin placed. Ready when you are.')}</p>
        </form>}
      </div>
    </div>
  </div>;
}
