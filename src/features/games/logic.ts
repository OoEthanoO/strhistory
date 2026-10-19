import type { ConnectionsGroup, ConnectionsPuzzle, Coordinates, CraftRecipe, GameCatalogue, HistoricalDate, HistoryEvent } from './types.ts';

export function shuffled<T>(items: readonly T[], random = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function filterEvents(catalogue: GameCatalogue, course: string, unit: string): HistoryEvent[] {
  const selection = catalogue.courses.find(item => item.id === course);
  return catalogue.events.filter(event =>
    (!selection || !selection.units.length || selection.units.includes(event.unit)) &&
    (!unit || event.unit === unit),
  );
}

export function dateValue(date: HistoricalDate): number {
  const value = new Date(0);
  value.setUTCFullYear(date.year, date.month - 1, date.day);
  value.setUTCHours(0, 0, 0, 0);
  return value.getTime() / 86_400_000;
}

export function parseDate(value: string): HistoricalDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  const check = new Date(dateValue(date) * 86_400_000);
  return date.year > 0 && date.year <= new Date().getFullYear() &&
    check.getUTCFullYear() === date.year && check.getUTCMonth() + 1 === date.month && check.getUTCDate() === date.day ? date : null;
}

export function formatDate(date: HistoricalDate): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dateValue(date) * 86_400_000);
}

export function distanceKm(a: Coordinates, b: Coordinates): number {
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLng = (b.lng - a.lng) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function scoreGuess(event: HistoryEvent, place: Coordinates, date: HistoricalDate) {
  const km = distanceKm(place, event.location);
  const days = Math.abs(dateValue(date) - dateValue(event.date));
  const placeScore = km <= 10 ? 5000 : Math.round(5000 * Math.exp(-(km - 10) / 1200));
  const dateScore = Math.round(5000 * Math.exp(-days / 730));
  return { km, days, placeScore, dateScore, total: placeScore + dateScore };
}

/** Equal dates are valid on either side: the game does not invent a time of day. */
export function validInsertion(timeline: HistoryEvent[], event: HistoryEvent, at: number): boolean {
  if (!Number.isInteger(at) || at < 0 || at > timeline.length) return false;
  const date = dateValue(event.date);
  return (at === 0 || dateValue(timeline[at - 1]!.date) <= date) &&
    (at === timeline.length || date <= dateValue(timeline[at]!.date));
}

export function recipeKey(a: string, b: string): string { return [a, b].sort().join('|'); }

export function availableHint(recipes: CraftRecipe[], discovered: readonly string[]): CraftRecipe | undefined {
  const known = new Set(discovered);
  return recipes.find(recipe => !known.has(recipe.result) && recipe.ingredients.every(item => known.has(item)));
}

/**
 * The cheapest known route from the collection to a goal: how many new items it
 * still needs (the goal included), and a combination available now that starts it.
 * Null once the goal is discovered, or if no recipes lead to it.
 */
export function routeToGoal(recipes: readonly CraftRecipe[], discovered: readonly string[], goal: string): { remaining: number; next: CraftRecipe } | null {
  const known = new Set(discovered);
  if (known.has(goal)) return null;
  // An item costs one more than its cheapest recipe's ingredients (Knuth's generalisation of Dijkstra).
  const cost = new Map([...known].map(id => [id, 0]));
  const best = new Map<string, CraftRecipe>();
  for (let changed = true; changed;) {
    changed = false;
    for (const recipe of recipes) {
      const [a, b] = recipe.ingredients;
      const costA = cost.get(a), costB = cost.get(b);
      if (known.has(recipe.result) || costA === undefined || costB === undefined) continue;
      const total = 1 + costA + (a === b ? 0 : costB);
      if (total < (cost.get(recipe.result) ?? Infinity)) { cost.set(recipe.result, total); best.set(recipe.result, recipe); changed = true; }
    }
  }
  if (!best.has(goal)) return null;
  // Ingredients always cost less than their result, so this walk ends at combinations available now.
  const route = new Set<string>();
  let next: CraftRecipe | undefined;
  const visit = (id: string) => {
    if (known.has(id) || route.has(id)) return;
    route.add(id);
    const recipe = best.get(id)!;
    recipe.ingredients.forEach(visit);
    if (!next && recipe.ingredients.every(item => known.has(item))) next = recipe;
  };
  visit(goal);
  return { remaining: route.size, next: next! };
}

export function readDiscoveries(value: unknown, validIds: ReadonlySet<string>, starters: readonly string[]): string[] {
  const saved = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && validIds.has(item)) : [];
  return [...new Set([...starters, ...saved])];
}

export const CONNECTIONS_MISTAKES = 4;

/** The same tiles in any order give the same key. */
export function tilesKey(items: readonly string[]): string { return [...items].sort().join('\u0000'); }

/** A repeatable random sequence, so every student sees the same opening board. */
export function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.codePointAt(0)!, 16777619);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The opening board, the same for everyone: no row holds more than two tiles of one group. */
export function connectionsLayout(puzzle: ConnectionsPuzzle): string[] {
  const items = puzzle.groups.flatMap(group => group.items);
  const giveaway = (row: string[]) => puzzle.groups.some(group => row.filter(item => group.items.includes(item)).length > 2);
  let order = items;
  for (let attempt = 0; attempt < 100; attempt++) {
    order = shuffled(items, seededRandom(`${puzzle.id}:${attempt}`));
    if (![0, 4, 8, 12].some(start => giveaway(order.slice(start, start + 4)))) break;
  }
  return order;
}

export function connectionsProgress(puzzle: ConnectionsPuzzle, guesses: readonly (readonly string[])[]) {
  const solved: ConnectionsGroup[] = [];
  let mistakes = 0;
  for (const guess of guesses) {
    const group = puzzle.groups.find(item => tilesKey(item.items) === tilesKey(guess));
    if (!group) mistakes++;
    else if (!solved.includes(group)) solved.push(group);
  }
  const won = solved.length === puzzle.groups.length;
  return { solved, mistakes, won, over: won || mistakes >= CONNECTIONS_MISTAKES };
}

export type ConnectionsVerdict =
  | { kind: 'invalid' | 'repeat' | 'one-away' | 'wrong' }
  | { kind: 'correct'; group: ConnectionsGroup };

/** Judges four selected tiles. A repeated guess costs nothing; three from one group is one away. */
export function judgeGuess(puzzle: ConnectionsPuzzle, guesses: readonly (readonly string[])[], selection: readonly string[]): ConnectionsVerdict {
  const progress = connectionsProgress(puzzle, guesses);
  const onBoard = new Set(puzzle.groups.filter(group => !progress.solved.includes(group)).flatMap(group => group.items));
  if (progress.over || selection.length !== 4 || new Set(selection).size !== 4 || selection.some(item => !onBoard.has(item))) return { kind: 'invalid' };
  const key = tilesKey(selection);
  if (guesses.some(guess => tilesKey(guess) === key)) return { kind: 'repeat' };
  const group = puzzle.groups.find(item => tilesKey(item.items) === key);
  if (group) return { kind: 'correct', group };
  return { kind: puzzle.groups.some(item => selection.filter(tile => item.items.includes(tile)).length === 3) ? 'one-away' : 'wrong' };
}

/** Saved progress for one daily number, replayed so that only legal guesses survive. */
export function readSavedGuesses(store: unknown, number: number, puzzle: ConnectionsPuzzle): string[][] {
  const entry = store && typeof store === 'object' ? (store as Record<string, unknown>)[String(number)] : undefined;
  if (!entry || typeof entry !== 'object' || (entry as { puzzle?: unknown }).puzzle !== puzzle.id) return [];
  const saved = (entry as { guesses?: unknown }).guesses;
  const guesses: string[][] = [];
  for (const guess of Array.isArray(saved) ? saved : []) {
    if (!Array.isArray(guess) || !guess.every(item => typeof item === 'string')) continue;
    const verdict = judgeGuess(puzzle, guesses, guess);
    if (verdict.kind !== 'invalid' && verdict.kind !== 'repeat') guesses.push([...guess]);
  }
  return guesses;
}

/** The access service's answer: today's position in the rotation and the school's date. */
export function readDaily(value: unknown): { number: number; date: string } | null {
  if (!value || typeof value !== 'object') return null;
  const { number, date } = value as { number?: unknown; date?: unknown };
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= 0 &&
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? { number, date } : null;
}

/** Earlier daily numbers, newest first: each other puzzle once, never today's. */
export function earlierNumbers(today: number, puzzles: number): number[] {
  const numbers: number[] = [];
  for (let number = today - 1; number >= Math.max(0, today - puzzles + 1); number--) numbers.push(number);
  return numbers;
}

export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(year!, month! - 1, date!));
}

const squares = { 1: '🟨', 2: '🟩', 3: '🟦', 4: '🟪' } as const;

/** A shareable grid of coloured squares: one row per guess, no tile names. */
export function connectionsShare(puzzle: ConnectionsPuzzle, number: number, guesses: readonly (readonly string[])[]): string {
  const level = new Map(puzzle.groups.flatMap(group => group.items.map(item => [item, group.level] as const)));
  return [`STR History Connections No. ${number + 1}`, ...guesses.map(guess => guess.map(item => squares[level.get(item)!]).join(''))].join('\n');
}
