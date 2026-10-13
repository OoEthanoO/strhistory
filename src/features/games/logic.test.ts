import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { events } from './events.ts';
import { craftItems, craftRecipes, starterIds } from './craft-data.ts';
import { availableHint, dateValue, distanceKm, filterEvents, parseDate, readDiscoveries, recipeKey, scoreGuess, shuffled, validInsertion } from './logic.ts';
import type { GameCatalogue, HistoricalDate, HistoryEvent } from './types.ts';

const eventAt = (date: HistoricalDate): HistoryEvent => ({ ...events[0]!, date });
const sourceDate = { year: 1789, month: 7, day: 14 };

test('calendar dates reject impossible days and support leap years without local timezone drift', () => {
  assert.deepEqual(parseDate('1789-07-14'), sourceDate);
  assert.deepEqual(parseDate('2000-02-29'), { year: 2000, month: 2, day: 29 });
  for (const invalid of ['1900-02-29', '1789-02-30', '1789-13-01', '1789-00-14', '0000-01-01', '2026-10-00', '', '14/07/1789', '9999-01-01']) assert.equal(parseDate(invalid), null, invalid);
  assert.equal(dateValue({ year: 1789, month: 7, day: 15 }) - dateValue(sourceDate), 1);
});

test('geographic scoring handles the antimeridian and the full-credit site tolerance', () => {
  assert.equal(distanceKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }), 0);
  assert.ok(Math.abs(distanceKm({ lat: 0, lng: 179 }, { lat: 0, lng: -179 }) - 222.39) < 0.1);
  const event = eventAt(sourceDate);
  const exact = scoreGuess(event, event.location, sourceDate);
  assert.equal(exact.total, 10000);
  assert.equal(scoreGuess(event, { ...event.location, lat: event.location.lat + .01 }, sourceDate).placeScore, 5000);
  const distant = scoreGuess(event, { lat: -30, lng: -80 }, { year: 1939, month: 9, day: 1 });
  assert.ok(distant.placeScore < 100 && distant.dateScore < 100);
  const oneDay = scoreGuess(event, event.location, { year: 1789, month: 7, day: 15 });
  assert.ok(oneDay.dateScore < 5000 && oneDay.dateScore > 4000);
});

test('timeline accepts both adjacent positions for an equal date and rejects out-of-order placements', () => {
  const first = eventAt({ year: 1789, month: 5, day: 5 });
  const second = eventAt({ year: 1789, month: 7, day: 14 });
  const middle = eventAt({ year: 1789, month: 6, day: 20 });
  assert.equal(validInsertion([first, second], middle, 1), true);
  assert.equal(validInsertion([first, second], middle, 0), false);
  assert.equal(validInsertion([first, second], middle, 2), false);
  assert.equal(validInsertion([first, second], second, 1), true);
  assert.equal(validInsertion([first, second], second, 2), true);
  for (const index of [-1, 3, 1.5]) assert.equal(validInsertion([first, second], middle, index), false);
});

test('course decks use the actual course unit references; SL excludes HL events', () => {
  const courses = ['ib-history-sl', 'ib-history-hl', 'pre-ib-world-history', 'extended-essay-history'].map(id => {
    const text = readFileSync(`src/content/courses/${id}.md`, 'utf8');
    const frontmatter = load(text.match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!) as { title: string; units: string[]; placeholder?: boolean };
    return { id, title: frontmatter.title, units: frontmatter.units, sample: !!frontmatter.placeholder };
  });
  const catalogue: GameCatalogue = { events, courses, units: [] };
  const sl = filterEvents(catalogue, 'ib-history-sl', '');
  assert.ok(sl.length >= 6);
  assert.ok(sl.every(event => event.level === 'SL'));
  assert.ok(filterEvents(catalogue, 'ib-history-hl', '').length > sl.length);
  assert.equal(filterEvents(catalogue, 'ib-history-sl', 'p3-europe-french-revolution').length, 0);
  assert.equal(filterEvents(catalogue, 'extended-essay-history', '').length, events.length);
  assert.equal(filterEvents(catalogue, '', '').length, events.length);
});

test('curated image rounds have valid dates, sites, references and local reusable images', () => {
  assert.equal(new Set(events.map(event => event.id)).size, events.length);
  const requiredUnits = ['p1-political-economic-transitions', 'p2-authoritarian-rule', 'p3-europe-french-revolution', 'p3-europe-unification'];
  for (const unit of requiredUnits) assert.ok(events.filter(event => event.unit === unit).length >= 3, unit);
  for (const event of events) {
    const iso = `${event.date.year}-${String(event.date.month).padStart(2, '0')}-${String(event.date.day).padStart(2, '0')}`;
    assert.deepEqual(parseDate(iso), event.date, event.id);
    assert.ok(Math.abs(event.location.lat) <= 85 && Math.abs(event.location.lng) <= 180);
    assert.match(event.image.src, /^\/games\/images\/[a-z0-9-]+\.(?:jpg|png|webp)$/);
    assert.ok(readFileSync(`public${event.image.src}`).length > 1000, event.image.src);
    for (const value of [event.image.title, event.image.creator, event.image.created, event.image.licence, event.image.alt, event.summary]) assert.ok(value.length > 0, event.id);
    for (const url of [event.image.source, event.source.url]) assert.equal(new URL(url).protocol, 'https:');
    assert.ok(existsSync(`src/content/syllabus/${event.unit}.md`), event.unit);
    if (event.topic) assert.ok(existsSync(`src/content/topics/${event.topic}.mdx`), event.topic);
    if (event.image.concealBottom) assert.ok(event.image.concealBottom > 0 && event.image.concealBottom < 20);
  }
});

test('crafting has unique commutative pairs, valid ingredients and sources for historical claims', () => {
  const ids = new Set(craftItems.map(item => item.id));
  assert.equal(ids.size, craftItems.length);
  assert.equal(new Set(craftRecipes.map(recipe => recipeKey(...recipe.ingredients))).size, craftRecipes.length);
  assert.equal(recipeKey('hitler', 'stalin'), recipeKey('stalin', 'hitler'));
  for (const recipe of craftRecipes) {
    for (const id of [...recipe.ingredients, recipe.result]) assert.ok(ids.has(id), id);
    assert.ok(recipe.explanation.length > 20);
    if (recipe.kind === 'history') assert.ok(recipe.source?.url.startsWith('https://'), recipe.result);
  }
  assert.equal(craftRecipes.find(recipe => recipeKey(...recipe.ingredients) === recipeKey('hitler', 'stalin'))?.result, 'nazi-soviet-pact');
});

test('hints lead from the starters to every craft item without requiring locked ingredients', () => {
  const discovered = [...starterIds];
  let hint = availableHint(craftRecipes, discovered);
  while (hint) {
    assert.ok(hint.ingredients.every(id => discovered.includes(id)));
    assert.equal(discovered.includes(hint.result), false);
    discovered.push(hint.result);
    assert.ok(discovered.length <= craftItems.length, 'hint cycle');
    hint = availableHint(craftRecipes, discovered);
  }
  assert.equal(new Set(discovered).size, craftItems.length);
});

test('saved discoveries discard invalid entries and always restore foundations', () => {
  const ids = new Set(craftItems.map(item => item.id));
  assert.deepEqual(readDiscoveries(null, ids, starterIds), starterIds);
  assert.deepEqual(readDiscoveries({ fake: 'state' }, ids, starterIds), starterIds);
  const restored = readDiscoveries(['state', 'state', 4, null, '__proto__', 'unknown'], ids, starterIds);
  assert.deepEqual(restored, [...starterIds, 'state']);
});

test('shuffling preserves each event and leaves the source collection unchanged', () => {
  const original = [...events];
  const deck = shuffled(events, () => 0);
  assert.deepEqual(events, original);
  assert.notDeepEqual(deck, events);
  assert.deepEqual(deck.map(item => item.id).sort(), events.map(item => item.id).sort());
});
