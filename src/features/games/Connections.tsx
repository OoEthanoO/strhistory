import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { connectionsPuzzles } from './connections-data';
import { CONNECTIONS_MISTAKES, connectionsLayout, connectionsProgress, connectionsShare, earlierNumbers, formatDay, judgeGuess, readDaily, readSavedGuesses, shuffled } from './logic';
import type { ConnectionsGroup, ConnectionsLevel } from './types';
import './games.css';

const storageKey = 'history-games-connections-v1';
const levels: Record<ConnectionsLevel, string> = { 1: 'Most direct', 2: 'Steady', 3: 'Tricky', 4: 'Trickiest' };
type Daily = { number: number; date: string };
type Load = { state: 'loading' } | { state: 'locked' } | { state: 'error' } | { state: 'ready'; daily: Daily; preview: boolean };

const puzzleFor = (number: number) => connectionsPuzzles[number % connectionsPuzzles.length]!;
function readStore(): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}
// The tile's text shrinks until its longest word fits the tile (see games.css);
// soft hyphens in the data mark where the very longest words may break instead.
const longestWord = (item: string) => Math.max(...item.split(/[\s\u00AD-]/).map(word => word.length));
// Without the access service (astro dev or preview) there is no daily position to ask for.
function localPreview(): Daily | null {
  if (!import.meta.env.DEV && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return null;
  const now = new Date();
  return { number: connectionsPuzzles.length - 1, date: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}` };
}

function GroupBar({ group }: { group: ConnectionsGroup }) {
  return <li className={`connections-group level-${group.level}`}><span className="connections-level">{levels[group.level]}</span><strong>{group.label}</strong><span>{group.items.join(', ')}</span></li>;
}

export default function Connections() {
  const [load, setLoad] = useState<Load>({ state: 'loading' }), [attempt, setAttempt] = useState(0);
  const [number, setNumber] = useState<number | null>(null), [guesses, setGuesses] = useState<string[][]>([]);
  const [order, setOrder] = useState<string[]>([]), [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState(''), [copied, setCopied] = useState(''), [wrong, setWrong] = useState(false), [saved, setSaved] = useState(true);
  const title = useRef<HTMLHeadingElement>(null), review = useRef<HTMLHeadingElement>(null), focusNext = useRef<'title' | 'review' | null>(null);

  // Asking for today's puzzle is what counts as the day's view on the server.
  useEffect(() => {
    let live = true;
    fetch('/games/api/connections/today', { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then(async (response): Promise<Load> => {
        if (response.status === 401) return { state: 'locked' };
        const daily = response.ok ? readDaily(await response.json()) : null;
        if (!daily) throw new Error(`Daily puzzle unavailable (${response.status})`);
        return { state: 'ready', daily, preview: false };
      })
      .catch((): Load => {
        const daily = localPreview();
        return daily ? { state: 'ready', daily, preview: true } : { state: 'error' };
      })
      .then(next => { if (live) setLoad(next); });
    return () => { live = false; };
  }, [attempt]);
  useEffect(() => { if (load.state === 'ready') open(load.daily.number, false); }, [load]);
  useEffect(() => {
    if (number === null || !guesses.length) return;
    try {
      const store = readStore();
      store[String(number)] = { puzzle: puzzleFor(number).id, guesses };
      localStorage.setItem(storageKey, JSON.stringify(store));
      setSaved(true);
    } catch { setSaved(false); }
  }, [number, guesses]);
  const store = useMemo(readStore, [number, guesses]);
  // Move focus once the new puzzle or the result has rendered (the button that was used may be gone).
  useEffect(() => {
    if (!focusNext.current) return;
    (focusNext.current === 'review' ? review : title).current?.focus();
    focusNext.current = null;
  });

  function open(next: number, focus = true) {
    const puzzle = puzzleFor(next), restored = readSavedGuesses(readStore(), next, puzzle);
    const found = new Set(connectionsProgress(puzzle, restored).solved.flatMap(group => group.items));
    setNumber(next); setGuesses(restored); setSelected([]); setMessage(''); setCopied('');
    setOrder(connectionsLayout(puzzle).filter(item => !found.has(item)));
    if (focus) focusNext.current = 'title';
  }

  if (load.state === 'loading' || (load.state === 'ready' && number === null)) return <div className="history-game connections-game"><p className="connections-note" role="status">Finding today’s puzzle…</p></div>;
  if (load.state === 'locked') return <div className="history-game connections-game connections-message"><h2>Your access has run out.</h2><p>Enter the department code again to play today’s puzzle.</p><a className="game-button primary" href="/access?next=%2Fgames%2Fconnections">Unlock the games</a></div>;
  if (load.state === 'error') return <div className="history-game connections-game connections-message" role="alert"><h2>Today’s puzzle did not load.</h2><p>Check your connection, then try again.</p><button className="game-button primary" onClick={() => { setLoad({ state: 'loading' }); setAttempt(value => value + 1); }}>Try again</button></div>;

  const today = load.daily.number, current = number!, puzzle = puzzleFor(current);
  const progress = connectionsProgress(puzzle, guesses), left = CONNECTIONS_MISTAKES - progress.mistakes;
  const level = new Map(puzzle.groups.flatMap(group => group.items.map(item => [item, group.level] as const)));
  const archive = earlierNumbers(today, connectionsPuzzles.length);

  function toggle(item: string) {
    if (selected.length === 4 && !selected.includes(item)) { setMessage('Four tiles are selected. Submit them, or deselect one first.'); return; }
    setSelected(old => old.includes(item) ? old.filter(tile => tile !== item) : old.length < 4 ? [...old, item] : old);
  }
  function submit() {
    if (selected.length !== 4) { setMessage('Select four tiles, then submit.'); return; }
    const verdict = judgeGuess(puzzle, guesses, selected);
    if (verdict.kind === 'invalid') return;
    if (verdict.kind === 'repeat') { setMessage('You have already tried those four.'); return; }
    const next = [...guesses, selected], after = connectionsProgress(puzzle, next);
    setGuesses(next);
    if (verdict.kind === 'correct') {
      setOrder(old => old.filter(item => !verdict.group.items.includes(item))); setSelected([]);
      setMessage(`Found: ${verdict.group.label}.`);
    } else {
      const remaining = CONNECTIONS_MISTAKES - after.mistakes;
      setWrong(true); window.setTimeout(() => setWrong(false), 450);
      setMessage(`${verdict.kind === 'one-away' ? 'One away.' : 'Not a group.'} ${remaining ? `${remaining} ${remaining === 1 ? 'mistake' : 'mistakes'} left.` : 'No mistakes left.'}`);
    }
    if (after.over) focusNext.current = 'review';
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(`${connectionsShare(puzzle, current, guesses)}\n${new URL('/games/connections', location.origin)}`);
      setCopied('Result copied. It shows colours only, never the answers.');
    } catch { setCopied('Copying is not available in this browser.'); }
  }
  function status(entry: number) {
    // The open puzzle's newest guess is saved after this render, so use the one in memory.
    const restored = entry === current ? guesses : readSavedGuesses(store, entry, puzzleFor(entry));
    if (!restored.length) return 'Not started';
    const result = connectionsProgress(puzzleFor(entry), restored);
    return result.won ? 'Solved' : result.over ? 'Revealed' : 'Started';
  }

  return <div className="history-game connections-game">
    <div className="connections-layout">
      <section className="connections-play" aria-labelledby="connections-title">
        <div className="connections-heading">
          <p className="game-kicker">{current === today ? `Today’s puzzle · No. ${current + 1} · ${formatDay(load.daily.date)}` : `From the archive · No. ${current + 1}`}</p>
          <h2 id="connections-title" ref={title} tabIndex={-1}>{current === today ? 'Find the four connections.' : `Puzzle No. ${current + 1}`}</h2>
          {current !== today && <button className="game-text-button" onClick={() => open(today)}>Back to today’s puzzle</button>}
          {load.preview && <p className="game-help">Local preview without the access service: this is the newest puzzle, and every other one is under Earlier puzzles. On the website the daily rotation chooses.</p>}
        </div>
        {progress.over ? <div className="connections-review">
          <h3 ref={review} tabIndex={-1}>{progress.won ? (progress.mistakes ? `Solved with ${progress.mistakes} ${progress.mistakes === 1 ? 'mistake' : 'mistakes'}.` : 'Solved without a mistake.') : 'Out of mistakes. Here are the connections.'}</h3>
          <div className="connections-guesses" aria-hidden="true">{guesses.map((guess, index) => <div key={index}>{guess.map(item => <span key={item} className={`level-${level.get(item)}`} />)}</div>)}</div>
          <ol className="connections-explained">{[...puzzle.groups].sort((a, b) => a.level - b.level).map(group => <li key={group.label} className={`connections-group level-${group.level}`}>
            <span className="connections-level">{levels[group.level]}{progress.solved.includes(group) ? ' · found' : ' · revealed'}</span>
            <h4>{group.label}</h4>
            <p className="connections-members">{group.items.join(' · ')}</p>
            <p>{group.explanation}</p>
            <div className="game-links">{group.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}{group.topic && <a href={`/topics/${group.topic}`}>Read the study note →</a>}</div>
          </li>)}</ol>
          <div className="game-actions"><button className="game-button primary" onClick={copy}>Copy result</button>{current === today && archive.length > 0 ? <span>Missed a day? Try an earlier puzzle.</span> : <a href="/games/history-craft">Try History Craft →</a>}</div>
          <p className="game-help" role="status">{copied}</p>
        </div> : <div className="connections-board">
          {progress.solved.length > 0 && <ol className="connections-solved" aria-label="Connections found">{progress.solved.map(group => <GroupBar key={group.label} group={group} />)}</ol>}
          <div className={`connections-grid${wrong ? ' is-wrong' : ''}`} role="group" aria-label={`${order.length} tiles. Select four that share a connection.`}>
            {order.map(item => <button key={item} type="button" className="connections-tile" style={{ '--letters': longestWord(item) } as CSSProperties} aria-pressed={selected.includes(item)} onClick={() => toggle(item)}><span>{item}</span></button>)}
          </div>
          <p className="connections-mistakes">Mistakes left <span aria-hidden="true">{'●'.repeat(left)}{'○'.repeat(progress.mistakes)}</span><span className="visually-hidden">: {left} of {CONNECTIONS_MISTAKES}</span></p>
          <div className="connections-controls">
            <button className="game-button" onClick={() => setOrder(old => shuffled(old))}>Shuffle</button>
            <button className="game-button" aria-disabled={!selected.length} onClick={() => setSelected([])}>Deselect all</button>
            <button className="game-button primary" aria-disabled={selected.length !== 4} onClick={submit}>Submit</button>
          </div>
          <p className="connections-feedback" role="status">{message}</p>
        </div>}
      </section>
      <aside className="connections-side">
        <section className="game-panel connections-rules" aria-labelledby="connections-rules-title">
          <h3 id="connections-rules-title">How to play</h3>
          <ol className="game-instructions">
            <li>Select four tiles that share a connection, then submit.</li>
            <li>Some tiles seem to fit more than one group. Only one arrangement uses all sixteen.</li>
            <li>Four mistakes end the game. Every connection is then explained, with its sources.</li>
          </ol>
          <ul className="connections-legend" aria-label="Group difficulty">{([1, 2, 3, 4] as const).map(value => <li key={value} className={`level-${value}`}>{levels[value]}</li>)}</ul>
          <p className="game-help">A new puzzle arrives each day. If nobody opens a puzzle on its day, it stays for the next one. {saved ? 'Progress saves in this browser.' : 'Storage is unavailable, so progress lasts for this visit only.'}</p>
        </section>
        {archive.length > 0 && <section className="game-panel connections-archive" aria-labelledby="connections-archive-title">
          <h3 id="connections-archive-title">Earlier puzzles</h3>
          <p className="game-help">Missed a day? Playing an earlier puzzle does not change today’s.</p>
          <ul>{archive.map(entry => <li key={entry}><button type="button" aria-current={entry === current ? 'true' : undefined} onClick={() => open(entry)}>No. {entry + 1}<span>{status(entry)}</span></button></li>)}</ul>
        </section>}
      </aside>
    </div>
  </div>;
}
