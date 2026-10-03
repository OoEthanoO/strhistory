import { describe, expect, it } from 'vitest';
import { normalizeText } from './index.js';
import { nearPrefix, SearchIndex } from './search.js';
import type { PolityInfo } from './types.js';

describe('normalizeText', () => {
  it.each([
    ['Đại Việt', 'dai viet'],
    ['ĐẠI VIỆT', 'dai viet'],
    ['Kingdom of Hawaiʻi', 'kingdom of hawaii'],
    ["Ma'rib", 'marib'],
    ['Emirate of Dirʿiyya', 'emirate of diriyya'],
    ['Kurköln', 'kurkoln'],
    ['Østfold', 'ostfold'],
    ['Æthelred’s Wessex', 'aethelreds wessex'],
    ['Großpolen', 'grosspolen'],
    ['Łódź', 'lodz'],
    ['İstanbul', 'istanbul'],
    ['Austria-Hungary', 'austria hungary'],
    ['  Holy   Roman\tEmpire ', 'holy roman empire'],
    ['Ἄλφα', 'αλφα'],
    ['ﬁef', 'fief'], // ligature (NFKD)
    ['大越', '大越'],
    ['(Group) & Co.', 'group co'],
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });
});

describe('nearPrefix (one typo after the first letter)', () => {
  it.each([
    ['rome', 'roman', true], // substituted letter
    ['rome', 'romania', true],
    ['ottomon', 'ottoman', true],
    ['ottman', 'ottoman', true], // missing letter
    ['otttoman', 'ottoman', true], // extra letter
    ['byzantnie', 'byzantine', true], // swapped letters
    ['roamn', 'roman', true],
    ['romex', 'rome', true], // one letter more than the whole word
    ['ottoman', 'ottoman', true], // no typo at all
    ['otomman', 'ottoman', false], // two edits
    ['rmaon', 'roman', false],
    ['romexy', 'rome', false],
    ['xome', 'rome', false], // the first letter must match
    ['rom', 'roman', false], // too short for typos (prefix ranks cover it)
    ['1435', '1453', false], // never for numbers
    ['rome', '', false],
  ])('nearPrefix(%j, %j) = %s', (token, word, expected) => {
    expect(nearPrefix(token, word)).toBe(expected);
  });
});

/** A k×k degree box on the equator: bigger k = bigger polity for search tie-breaks. */
const box = (k: number): PolityInfo['bbox'] => [0, 0, k, k];

const info = (name: string, extra: Partial<PolityInfo> = {}): PolityInfo => ({
  name,
  kind: 'state',
  spans: [[1, 2000]],
  bbox: [0, 0, 1, 1],
  src: 'test',
  ...extra,
});

describe('SearchIndex ranking', () => {
  it('prefers a main-name match to an alternative-name match of the same rank', () => {
    const index = new SearchIndex({
      a: info('Prussia', { bbox: box(1) }),
      b: info('Brandenburg-Prussia', { altNames: ['Prussia'], bbox: box(50) }),
    });
    expect(index.search('prussia').map((h) => [h.pid, h.matched])).toEqual([
      ['a', undefined],
      ['b', 'Prussia'],
    ]);
  });

  it('puts every exact match before any prefix match, whatever the area', () => {
    const index = new SearchIndex({
      big: info('Rome Empire', { bbox: box(80) }),
      small: info('Rome', { bbox: box(1) }),
      alt: info('Latium', { altNames: ['Rome'], bbox: box(60) }),
    });
    expect(index.search('rome').map((h) => h.pid)).toEqual(['small', 'alt', 'big']);
  });

  it('ranks an exact match without designators ("Kingdom of France") right after exact matches', () => {
    const index = new SearchIndex({
      newFrance: info('New France', { bbox: box(60) }),
      kingdom: info('Kingdom of France', { bbox: box(8) }),
      france: info('France', { bbox: box(9) }),
      antarctique: info('France Antarctique', { bbox: box(1) }),
      bourbon: info('Bourbon Kingdom of France', { bbox: box(8) }),
    });
    expect(index.search('france').map((h) => h.pid)).toEqual(['france', 'kingdom', 'antarctique', 'newFrance', 'bourbon']);
    const cherokee = new SearchIndex({ c: info('Cherokee Nation'), e: info('Cherokee Removal Lands', { bbox: box(50) }) });
    expect(cherokee.search('cherokee').map((h) => h.pid)).toEqual(['c', 'e']);
    // A name made only of designators keeps its plain text match.
    expect(new SearchIndex({ e: info('Empire') }).search('empire').map((h) => h.pid)).toEqual(['e']);
  });

  it('matches word prefixes in any order', () => {
    const index = new SearchIndex({ ottoman: info('Ottoman Empire'), other: info('Empire of Japan') });
    expect(index.search('emp otto').map((h) => h.pid)).toEqual(['ottoman']);
    expect(index.search('ottoman emp').map((h) => h.pid)).toEqual(['ottoman']);
    expect(index.search('empire').map((h) => h.pid)).toEqual(['other', 'ottoman']); // prefix before word prefix
  });

  it('breaks ties by bbox size, then shorter name, then name, then pid', () => {
    const index = new SearchIndex({
      z: info('Kingdom of Ba', { bbox: box(10) }),
      y: info('Kingdom of Bo', { bbox: box(10) }),
      x: info('Kingdom of Bor', { bbox: box(10) }),
      w: info('Kingdom of Bi', { bbox: box(30) }),
      v: info('Kingdom of Bo', { bbox: box(10) }),
    });
    expect(index.search('kingdom of b').map((h) => h.pid)).toEqual(['w', 'z', 'v', 'y', 'x']);
  });

  it('measures boxes across the antimeridian by their real width and ignores peak years', () => {
    const index = new SearchIndex({
      wide: info('Russian Empire', { bbox: [27, 38, -169, 78], peak: 1866 }), // crosses 180°: 164° wide
      narrow: info('Russian Republic', { bbox: [30, 40, 60, 70], peak: 1917 }),
    });
    expect(index.search('russian').map((h) => h.pid)).toEqual(['wide', 'narrow']);
  });

  it('survives malformed index entries', () => {
    const index = new SearchIndex({
      ok: info('Alpha'),
      noName: { kind: 'state', spans: [], bbox: [0, 0, 0, 0], src: 'x', altNames: ['Alpha Prime', 42 as unknown as string] } as unknown as PolityInfo,
    });
    expect(index.search('alpha').map((h) => h.pid)).toEqual(['ok', 'noName']);
    const noSpans = new SearchIndex({ x: { name: 'Alpha' } as unknown as PolityInfo });
    expect(noSpans.search('alpha', { year: 5 })).toEqual([]);
  });

  it('returns copies with the pid (the index is not modified)', () => {
    const entry = info('Alpha');
    const index = new SearchIndex({ a: entry });
    const [hit] = index.search('alpha');
    expect(hit).toEqual({ ...entry, pid: 'a' });
    expect(hit).not.toBe(entry);
    expect('pid' in entry).toBe(false);
  });

  it('fills free slots with near matches (one typo), after every strict match', () => {
    const index = new SearchIndex({
      roman: info('Roman Empire', { bbox: box(40) }),
      hre: info('Holy Roman Empire', { bbox: box(20) }),
      prome: info('Prome Kingdom', { bbox: box(5) }),
      home: info('Homeland', { bbox: box(60) }),
      latium: info('Latium', { altNames: ['Romagna'] }),
    });
    // "rome" is in no name but "Prome": the substring hit comes first, then the near matches.
    expect(index.search('rome').map((h) => [h.pid, h.matched])).toEqual([
      ['prome', undefined],
      ['roman', undefined],
      ['hre', undefined],
      ['latium', 'Romagna'],
    ]);
    // No free slot, no near matches.
    expect(index.search('rome', { limit: 1 }).map((h) => h.pid)).toEqual(['prome']);
    // Every query word must match, at most one typo each.
    expect(index.search('holy rome').map((h) => h.pid)).toEqual(['hre']);
    expect(index.search('holy xome').map((h) => h.pid)).toEqual([]);
    expect(index.search('ottomon')).toEqual([]);
  });

  it('applies the year filter to near matches too', () => {
    const index = new SearchIndex({
      early: info('Roman Kingdom', { spans: [[-753, -509]] }),
      late: info('Roman Empire', { spans: [[-27, 476]] }),
    });
    expect(index.search('rome', { year: 100 }).map((h) => h.pid)).toEqual(['late']);
  });

  it('searches ~5k polities quickly', () => {
    const words = ['Kingdom', 'Empire', 'Sultanate', 'Republic', 'Duchy', 'Emirate', 'Khanate', 'Confederacy'];
    const places = ['Ālamūt', 'Bornu', 'Kanem', 'Đà Nẵng', 'Ōuchi', 'Zürich', 'Kraków', 'Maratha', 'Mysore', 'Oyo'];
    const polities: Record<string, PolityInfo> = {};
    for (let i = 0; i < 5000; i++) {
      const name = `${words[i % words.length]} of ${places[i % places.length]} ${i}`;
      polities[`p${i}`] = info(name, { altNames: [`${places[(i + 3) % places.length]} ${i}`, `Alt ${i}`], bbox: box(1 + (i % 40)), spans: [[i - 4000, i - 3000]] });
    }
    const t0 = performance.now();
    const index = new SearchIndex(polities);
    const built = performance.now() - t0;
    const queries = ['kingdom', 'zurich', 'krakow 12', 'of', 'xyz', 'alt 4999', 'da nang', 'emirate maratha'];
    const t1 = performance.now();
    for (const q of queries) index.search(q, { limit: 20 });
    const perQuery = (performance.now() - t1) / queries.length;
    expect(index.search('alt 4999')[0]?.pid).toBe('p4999');
    expect(index.search('kingdom', { year: -3999 }).map((h) => h.pid)).toEqual(['p0']);
    // Generous bounds (CI machines vary); typical values are ~20 ms to build and < 5 ms per query.
    expect(built).toBeLessThan(500);
    expect(perQuery).toBeLessThan(50);
  });
});
