import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { load } from 'js-yaml';
import { events } from './events.ts';
import { craftItems, craftRecipes, starterIds } from './craft-data.ts';
import { connectionsPuzzles } from './connections-data.ts';
import { availableHint, CONNECTIONS_MISTAKES, connectionsLayout, connectionsProgress, connectionsShare, dateValue, distanceKm, earlierNumbers, filterEvents, judgeGuess, parseDate, readDaily, readDiscoveries, readSavedGuesses, recipeKey, scoreGuess, seededRandom, shuffled, tilesKey, validInsertion } from './logic.ts';
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

test('every Connections puzzle has four sourced groups of four distinct, short tiles', () => {
  assert.ok(connectionsPuzzles.length >= 30);
  assert.equal(new Set(connectionsPuzzles.map(puzzle => puzzle.id)).size, connectionsPuzzles.length);
  for (const puzzle of connectionsPuzzles) {
    assert.match(puzzle.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    assert.equal(puzzle.groups.length, 4, puzzle.id);
    assert.deepEqual(puzzle.groups.map(group => group.level).sort(), [1, 2, 3, 4], puzzle.id);
    const tiles = puzzle.groups.flatMap(group => group.items);
    assert.equal(new Set(tiles.map(tile => tile.toLocaleLowerCase('en'))).size, 16, `${puzzle.id}: tiles must be unique`);
    assert.equal(new Set(puzzle.groups.map(group => group.label)).size, 4, puzzle.id);
    for (const group of puzzle.groups) {
      assert.equal(group.items.length, 4, group.label);
      for (const tile of group.items) assert.ok(tile.trim() === tile && tile.length > 0 && tile.length <= 24, `${puzzle.id}: ${tile}`);
      assert.ok(group.label.length > 2 && group.explanation.length > 40, `${puzzle.id}: ${group.label}`);
      assert.ok(group.sources.length >= 1, `${puzzle.id}: ${group.label} needs a source`);
      for (const source of group.sources) {
        assert.equal(new URL(source.url).protocol, 'https:', source.url);
        assert.match(source.label, / · /, source.label);
      }
      if (group.topic) assert.ok(existsSync(`src/content/topics/${group.topic}.mdx`), group.topic);
    }
  }
});

test('the opening board is the same for everyone and never shows three of a group in a row', () => {
  for (const puzzle of connectionsPuzzles) {
    const board = connectionsLayout(puzzle);
    assert.deepEqual(board, connectionsLayout(puzzle), puzzle.id);
    assert.deepEqual([...board].sort(), puzzle.groups.flatMap(group => group.items).sort(), puzzle.id);
    for (let start = 0; start < 16; start += 4) {
      const row = board.slice(start, start + 4);
      for (const group of puzzle.groups) assert.ok(row.filter(tile => group.items.includes(tile)).length <= 2, `${puzzle.id} row ${start / 4 + 1}`);
    }
  }
  assert.equal(seededRandom('same')(), seededRandom('same')());
  assert.notEqual(seededRandom('one')(), seededRandom('two')());
});

test('Connections guesses: one away, repeats cost nothing, four mistakes end the game', () => {
  const puzzle = connectionsPuzzles[0]!;
  const [a, b, c, d] = puzzle.groups.map(group => [...group.items]);
  assert.deepEqual(judgeGuess(puzzle, [], a!), { kind: 'correct', group: puzzle.groups[0] });
  assert.equal(judgeGuess(puzzle, [], [...a!].reverse()).kind, 'correct');
  const oneAway = [a![0]!, a![1]!, a![2]!, b![0]!];
  assert.equal(judgeGuess(puzzle, [], oneAway).kind, 'one-away');
  const wrong = [a![0]!, a![1]!, b![0]!, b![1]!];
  assert.equal(judgeGuess(puzzle, [], wrong).kind, 'wrong');
  assert.equal(judgeGuess(puzzle, [wrong], [...wrong].reverse()).kind, 'repeat');
  for (const invalid of [a!.slice(0, 3), [a![0]!, a![0]!, a![1]!, a![2]!], [...a!.slice(0, 3), 'Not a tile']]) assert.equal(judgeGuess(puzzle, [], invalid).kind, 'invalid');
  assert.equal(judgeGuess(puzzle, [a!], [a![0]!, b![0]!, b![1]!, b![2]!]).kind, 'invalid', 'a solved tile has left the board');
  const mistakes = [wrong, oneAway, [b![0]!, b![1]!, c![0]!, c![1]!], [c![2]!, c![3]!, d![0]!, d![1]!]];
  const lost = connectionsProgress(puzzle, mistakes);
  assert.equal(lost.mistakes, CONNECTIONS_MISTAKES);
  assert.ok(lost.over && !lost.won);
  assert.equal(judgeGuess(puzzle, mistakes, d!).kind, 'invalid', 'no guesses after the game ends');
  const won = connectionsProgress(puzzle, [d!, wrong, c!, b!, a!]);
  assert.ok(won.won && won.over);
  assert.equal(won.mistakes, 1);
  assert.deepEqual(won.solved.map(group => group.label), [d, c, b, a].map(items => puzzle.groups.find(group => tilesKey(group.items) === tilesKey(items!))!.label));
});

test('saved Connections progress keeps only legal guesses for the same puzzle', () => {
  const puzzle = connectionsPuzzles[0]!;
  const [a, b] = puzzle.groups.map(group => [...group.items]);
  const wrong = [a![0]!, a![1]!, b![0]!, b![1]!];
  // Repeats, unknown tiles and tiles already solved are dropped, as they were in play.
  const store = { 3: { puzzle: puzzle.id, guesses: [wrong, a, a, [...wrong].reverse(), ['x', 'y', 'z', 'w'], 'text', [1, 2, 3, 4], [a![0]!, b![0]!, b![1]!, b![2]!], b] } };
  assert.deepEqual(readSavedGuesses(store, 3, puzzle), [wrong, a, b]);
  assert.deepEqual(readSavedGuesses(store, 4, puzzle), []);
  assert.deepEqual(readSavedGuesses({ 3: { puzzle: 'another-puzzle', guesses: [a] } }, 3, puzzle), []);
  for (const damaged of [null, 'text', [], { 3: null }, { 3: { puzzle: puzzle.id, guesses: 'all' } }]) assert.deepEqual(readSavedGuesses(damaged, 3, puzzle), []);
});

test('the daily response, the archive and the shared result', () => {
  assert.deepEqual(readDaily({ number: 4, date: '2026-10-18' }), { number: 4, date: '2026-10-18' });
  for (const invalid of [null, {}, { number: -1, date: '2026-10-18' }, { number: 1.5, date: '2026-10-18' }, { number: '4', date: '2026-10-18' }, { number: 4, date: '18/10/2026' }, { error: 'locked' }]) assert.equal(readDaily(invalid), null);
  assert.deepEqual(earlierNumbers(0, 32), []);
  assert.deepEqual(earlierNumbers(3, 32), [2, 1, 0]);
  const late = earlierNumbers(40, 32);
  assert.equal(late.length, 31);
  assert.equal(new Set(late.map(number => number % 32)).size, 31, 'each puzzle at most once');
  assert.ok(!late.map(number => number % 32).includes(40 % 32), 'never today’s puzzle');
  const puzzle = connectionsPuzzles[0]!;
  const [a, b] = puzzle.groups.map(group => [...group.items]);
  const share = connectionsShare(puzzle, 4, [[a![0]!, a![1]!, b![0]!, b![1]!], a!]);
  const square = { 1: '🟨', 2: '🟩', 3: '🟦', 4: '🟪' }[puzzle.groups[0]!.level];
  assert.equal(share.split('\n')[0], 'STR History Connections No. 5');
  assert.equal(share.split('\n')[2], square.repeat(4));
  for (const tile of puzzle.groups.flatMap(group => group.items)) assert.ok(!share.includes(tile), 'no answers in the shared result');
});
