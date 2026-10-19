import { useEffect, useMemo, useRef, useState } from 'react';
import { craftItems, craftRecipes, goalId, goalTeaser, starterIds } from './craft-data';
import { availableHint, readDiscoveries, recipeKey, routeToGoal } from './logic';
import type { CraftItem, CraftRecipe } from './types';
import './games.css';

const itemById = new Map(craftItems.map(item => [item.id, item]));
const recipeByPair = new Map(craftRecipes.map(recipe => [recipeKey(...recipe.ingredients), recipe]));
const ingredientIds = new Set(craftRecipes.flatMap(recipe => recipe.ingredients));
const validIds = new Set(itemById.keys());
const storageKey = 'history-games-craft-v1';
const categories: CraftItem['category'][] = ['foundation', 'idea', 'society', 'person', 'event', 'technology'];
const kinds: Record<CraftRecipe['kind'], string> = { history: 'Historical connection', association: 'Conceptual association', school: 'St. Robert connection' };
const goal = itemById.get(goalId)!;

interface Props {
  /** The goal's photograph, shown once it has been crafted. */
  goalPortrait?: { src: string; alt: string };
  /** The goal's profile page. */
  goalProfile?: string;
}

export default function HistoryCraft({ goalPortrait, goalProfile }: Props) {
  const [discovered, setDiscovered] = useState<string[]>(starterIds), [ready, setReady] = useState(false), [saved, setSaved] = useState(true);
  const [slots, setSlots] = useState<[string | null, string | null]>([null, null]), [active, setActive] = useState<0 | 1>(0);
  const [result, setResult] = useState<CraftRecipe | null>(null), [fresh, setFresh] = useState(false), [message, setMessage] = useState('Choose two ingredients to begin.');
  const [search, setSearch] = useState(''), [category, setCategory] = useState(''), [sort, setSort] = useState('recent');
  const [hint, setHint] = useState<CraftRecipe | null>(null), [confirmReset, setConfirmReset] = useState(false);
  const [journal, setJournal] = useState(false), [selected, setSelected] = useState<CraftItem | null>(null);
  const live = useRef<HTMLDivElement>(null);
  useEffect(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) setDiscovered(readDiscoveries(JSON.parse(raw), validIds, starterIds)); }
    catch { setSaved(false); }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) try { localStorage.setItem(storageKey, JSON.stringify(discovered)); setSaved(true); } catch { setSaved(false); } }, [ready, discovered]);
  const inventory = useMemo(() => discovered.map(id => itemById.get(id)!).filter(item => (!category || item.category === category) && item.label.toLocaleLowerCase('en').includes(search.trim().toLocaleLowerCase('en'))).sort((a, b) => sort === 'name' ? a.label.localeCompare(b.label, 'en') : discovered.indexOf(b.id) - discovered.indexOf(a.id)), [discovered, category, search, sort]);
  // Until the goal is crafted, hints follow the cheapest known route to it.
  const route = useMemo(() => routeToGoal(craftRecipes, discovered, goalId), [discovered]);
  const goalReached = discovered.includes(goalId);
  function choose(id: string) {
    if (!discovered.includes(id)) return;
    setSlots(old => active === 0 ? [id, old[1]] : [old[0], id]);
    setActive(active === 0 ? 1 : 0); setSelected(itemById.get(id)!);
  }
  function combine() {
    if (!slots[0] || !slots[1]) return;
    const recipe = recipeByPair.get(recipeKey(slots[0], slots[1]));
    setHint(null);
    if (!recipe) { setResult(null); setFresh(false); setMessage('No connection in this collection yet. Try another pair, or ask for a hint.'); return; }
    const isNew = !discovered.includes(recipe.result);
    setResult(recipe); setFresh(isNew); setMessage(isNew && recipe.result === goalId ? `Discovered: ${goal.label}. You have reached the goal!` : `${isNew ? 'Discovered' : 'Already in your collection'}: ${itemById.get(recipe.result)!.label}.`);
    if (isNew) setDiscovered(old => [...old, recipe.result]);
  }
  function combineFromCollection() {
    combine();
    requestAnimationFrame(() => live.current?.focus());
  }
  function getHint() {
    const suggestion = route?.next ?? availableHint(craftRecipes, discovered);
    setHint(suggestion ?? null);
    setMessage(suggestion ? `Try ${itemById.get(suggestion.ingredients[0])!.label} with ${itemById.get(suggestion.ingredients[1])!.label}.${route ? ` It is a step towards ${goal.label}.` : ''}` : 'You have discovered every reachable connection in this collection.');
  }
  function reset() {
    setDiscovered([...starterIds]); setSlots([null, null]); setActive(0); setResult(null); setFresh(false); setHint(null); setSelected(null); setSearch(''); setCategory(''); setConfirmReset(false); setMessage('Collection reset. Start with the eight foundations.');
  }
  const resultItem = result ? itemById.get(result.result)! : null;
  const isGoal = result?.result === goalId;
  const left = craftItems.length - discovered.length;
  return <div className="history-game craft-game">
    <div className="craft-intro"><div><p className="game-kicker">Small ingredients. Big connections.</p><h2>A workbench for history.</h2><p>Combine ideas, people and places. Discover events—and the context that connects them.</p></div><div className="craft-progress"><strong>{discovered.length}<span> / {craftItems.length}</span></strong><span>in your collection</span><progress aria-label="Discovered history items" value={discovered.length} max={craftItems.length} /></div></div>
    <section className={`craft-goal ${goalReached ? 'is-complete' : ''} ${isGoal && fresh ? 'is-new' : ''}`} aria-labelledby="craft-goal-title"><div className="craft-goal-portrait">{goalReached && goalPortrait ? <img src={goalPortrait.src} alt={goalPortrait.alt} width={64} height={64} /> : <span aria-hidden="true">{goalReached ? goal.icon : '?'}</span>}</div>
      <div className="craft-goal-copy"><p className="game-kicker">{goalReached ? 'Goal complete' : 'The goal'}</p><h3 id="craft-goal-title">{goalReached ? `You crafted ${goal.label}!` : `Craft ${goal.label}`}</h3><p>{goalReached ? <>{left > 0 ? `${left} more ${left === 1 ? 'discovery is' : 'discoveries are'} still out there.` : 'You have found every discovery, too.'}{goalProfile && <> <a href={goalProfile}>Meet {goal.label} →</a></>}</> : goalTeaser}</p></div>
      {route && <p className="craft-goal-count"><strong>{route.remaining}</strong>{route.remaining === 1 ? 'combination to go' : 'combinations to go'}</p>}
    </section>
    <div className="craft-layout"><section className="craft-workbench" aria-labelledby="workbench-title"><div className="craft-toolbar"><h3 id="workbench-title">The workbench</h3><button className="game-text-button" onClick={() => { setSlots([null, null]); setActive(0); }}>Clear ingredients</button></div>
      <div className="craft-slots">{([0, 1] as const).map((slot, index) => <div className="craft-slot-wrap" key={slot}>{index === 1 && <span className="craft-plus" aria-hidden="true">+</span>}<button className={`craft-slot ${active === slot ? 'is-active' : ''}`} aria-pressed={active === slot} aria-label={`Select ingredient ${slot + 1}${slots[slot] ? `: ${itemById.get(slots[slot]!)!.label}` : ''}`} onClick={() => setActive(slot)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData('text/plain'); if (discovered.includes(id)) { setSlots(old => slot === 0 ? [id, old[1]] : [old[0], id]); setActive(slot === 0 ? 1 : 0); } }}>
        {slots[slot] ? <><span className="slot-icon" aria-hidden="true">{itemById.get(slots[slot]!)!.icon}</span><strong>{itemById.get(slots[slot]!)!.label}</strong></> : <><span className="slot-icon" aria-hidden="true">＋</span><span>Ingredient {slot + 1}</span></>}
      </button></div>)}</div>
      <p className="game-help">Select a slot, then choose an item below. On desktop, items can also be dragged into a slot. Ingredients are reusable.</p>
      <button className="game-button primary craft-combine" disabled={!ready || !slots[0] || !slots[1]} onClick={combine}>Combine <span aria-hidden="true">↗</span></button>
      <div className="craft-feedback" ref={live} tabIndex={-1} role="status" aria-live="polite"><p>{message}</p></div>
      {result && resultItem ? <article className={`craft-result ${fresh ? 'is-new' : ''} ${isGoal ? 'is-goal' : ''}`}><p className="game-kicker">{isGoal ? (fresh ? 'Goal complete!' : 'The goal, rediscovered') : fresh ? 'Added to your collection' : 'Connection rediscovered'}</p><div className="craft-result-title">{isGoal && goalPortrait ? <img src={goalPortrait.src} alt="" width={48} height={48} /> : <span aria-hidden="true">{resultItem.icon}</span>}<h3>{resultItem.label}</h3></div><p>{result.explanation}</p><p className="recipe-kind">{kinds[result.kind]}</p>{result.source && <a href={result.source.url} target="_blank" rel="noreferrer">{result.source.label} ↗</a>}{isGoal && goalProfile && <a className="craft-goal-link" href={goalProfile}>Meet {goal.label} →</a>}{ingredientIds.has(result.result) && <button className="game-button" onClick={() => { setSlots([result.result, null]); setActive(1); setMessage(`Choose something to combine with ${resultItem.label}.`); }}>Use in the next combination →</button>}</article> : <div className="craft-note"><span aria-hidden="true">✧</span><p>Start with a hunch.<br />What happens when <strong>people meet ideas</strong>?</p></div>}
      <div className="craft-hint"><button className="game-button" onClick={getHint}>A little nudge</button>{hint && <button className="game-text-button" onClick={() => { setSlots([...hint.ingredients]); setActive(0); }}>Put the hint on the workbench →</button>}</div>
      <details className="game-credit"><summary>How these connections work</summary><p>This is a finite collection of {craftRecipes.length} curated combinations, inspired by discovery games. Recipes are associations to explore, not equations explaining history. Wars and revolutions had multiple causes, and many outcomes were not inevitable.</p><p>For example, Hitler + Stalin reveals the Nazi–Soviet Pact. The pact can then be connected with the invasion of Poland to explore the European outbreak of the Second World War. Each historical recipe includes context and a source.</p><p>The goal is {goal.label}, one of St. Robert’s IB History teachers. Recipes marked “{kinds.school}” come from the department’s teacher page and {goal.label}’s profile. Until the goal is crafted, a nudge points along the shortest route to it.</p><p>Progress stays in this browser. {saved ? 'Discoveries are saved automatically.' : 'Storage is unavailable; discoveries will last for this session only.'}</p></details>
    </section>
    <section className="craft-inventory" aria-labelledby="collection-title"><div className="craft-toolbar"><h3 id="collection-title">Your collection</h3><button className="game-text-button" aria-expanded={journal} onClick={() => setJournal(!journal)}>{journal ? 'Hide' : 'Open'} notebook</button></div>
      <label className="inventory-search"><span className="visually-hidden">Search discovered items</span><input type="search" placeholder="Find a person, idea or event…" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="inventory-filters"><label><span className="visually-hidden">Item category</span><select value={category} onChange={event => setCategory(event.target.value)}><option value="">All categories</option>{categories.map(name => <option key={name} value={name}>{name[0].toUpperCase() + name.slice(1)}</option>)}</select></label><label><span className="visually-hidden">Sort items</span><select value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Newest first</option><option value="name">A–Z</option></select></label></div>
      {slots[0] && slots[1] && <button className="game-button primary craft-mobile-combine" disabled={!ready} onClick={combineFromCollection}>Combine {itemById.get(slots[0])!.label} + {itemById.get(slots[1])!.label} ↑</button>}
      <div className="craft-items">{inventory.map(item => <button key={item.id} className={`craft-item category-${item.category}`} draggable onDragStart={event => { event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'copy'; }} onClick={() => choose(item.id)} title={item.description}><span aria-hidden="true">{item.icon}</span>{item.label}</button>)}{inventory.length === 0 && <p className="game-help">No discovered items match. Try another search or category.</p>}</div>
      {selected && <aside className="selected-item"><strong>{selected.label}</strong><p>{selected.description}</p></aside>}
      {journal && <div className="craft-journal"><h4>Connections in your collection</h4><p className="game-help">Select an entry to revisit its explanation. Some items have more than one route.</p><ul>{craftRecipes.filter(recipe => discovered.includes(recipe.result) && recipe.ingredients.every(id => discovered.includes(id))).map(recipe => <li key={recipeKey(...recipe.ingredients)}><button onClick={() => { setResult(recipe); setFresh(false); setMessage(`Notebook: ${itemById.get(recipe.result)!.label}.`); }}>{itemById.get(recipe.ingredients[0])!.label} + {itemById.get(recipe.ingredients[1])!.label}<strong>→ {itemById.get(recipe.result)!.label}</strong></button></li>)}</ul></div>}
      <div className="craft-reset">{confirmReset ? <div><p>Reset all discoveries on this browser? This cannot be undone.</p><div className="game-actions"><button className="game-button" onClick={() => setConfirmReset(false)}>Keep my collection</button><button className="game-button" onClick={reset}>Reset discoveries</button></div></div> : <button className="game-text-button" onClick={() => setConfirmReset(true)}>Reset discoveries</button>}</div>
    </section></div>
  </div>;
}
