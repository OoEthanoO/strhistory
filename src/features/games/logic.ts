import type { Coordinates, CraftRecipe, GameCatalogue, HistoricalDate, HistoryEvent } from './types.ts';

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

export function readDiscoveries(value: unknown, validIds: ReadonlySet<string>, starters: readonly string[]): string[] {
  const saved = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && validIds.has(item)) : [];
  return [...new Set([...starters, ...saved])];
}
