// Tests of the globe explorer's URL state (url.ts). Run: node --test src/features/globe/url.test.ts
// Expectations follow the Alex's Atlas reference site's apps/site/src/state/url.test.ts,
// adapted to query parameters.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import { HistoryWriter, parseGlobeUrl, parseTypedYear, serialiseGlobeUrl, wrapLon, type GlobeUrlState, type HistoryHost } from './url.ts';

const B = { minYear: -300000, maxYear: 2026 };

describe('parseGlobeUrl', () => {
  it('reads every parameter', () => {
    assert.deepEqual(
      parseGlobeUrl('?year=1789&level=HL&curriculum=2028&topic=storming-of-the-bastille&polity=clio:french-kingdom&all=1&q=bastille&lng=2.369&lat=48.853&scale=2.5', B),
      {
        year: 1789,
        level: 'HL',
        curriculum: '2028',
        topic: 'storming-of-the-bastille',
        polity: 'clio:french-kingdom',
        all: true,
        q: 'bastille',
        view: { lng: 2.369, lat: 48.853, scale: 2.5 },
      },
    );
  });

  it('accepts a query without "?" and an encoded colon', () => {
    assert.deepEqual(parseGlobeUrl('year=-500&polity=clio%3Aachaemenid-empire', B), { year: -500, polity: 'clio:achaemenid-empire' });
  });

  it('never yields year 0, rounds and clamps to the bounds', () => {
    assert.equal(parseGlobeUrl('?year=0', B).year, 1);
    assert.equal(parseGlobeUrl('?year=-0', B).year, 1);
    assert.equal(parseGlobeUrl('?year=0.2', B).year, 1);
    assert.equal(parseGlobeUrl('?year=1938.4', B).year, 1938);
    assert.equal(parseGlobeUrl('?year=1938.5', B).year, 1939);
    assert.equal(parseGlobeUrl('?year=-999999', B).year, -300000);
    assert.equal(parseGlobeUrl('?year=3000', B).year, 2026);
    assert.equal(parseGlobeUrl('?year=+1453', B).year, 1453);
    assert.equal(parseGlobeUrl('?year=1453', { minYear: 1500, maxYear: 1600 }).year, 1500);
    assert.equal(parseGlobeUrl('?year=0', { minYear: -3400, maxYear: -1 }).year, -1);
  });

  it('accepts typed years', () => {
    assert.equal(parseGlobeUrl('?year=500BC', B).year, -500);
    assert.equal(parseGlobeUrl('?year=500+BCE', B).year, -500); // '+' is a space in query syntax
    assert.equal(parseGlobeUrl('?year=AD%2033', B).year, 33);
    assert.equal(parseGlobeUrl('?year=3,400+BCE', B).year, -3400);
    assert.equal(parseGlobeUrl('?year=%E2%88%92500', B).year, -500); // Unicode minus
  });

  it('drops values it cannot read', () => {
    assert.deepEqual(parseGlobeUrl('?year=abc&level=XL&curriculum=2020&topic=<script>&polity=no-namespace&all=0&q=%20%20', B), {});
    assert.deepEqual(parseGlobeUrl('?year=&lng=&lat=', B), {});
    assert.deepEqual(parseGlobeUrl('?year=1e3', B), {});
    assert.deepEqual(parseGlobeUrl('?year=-500BC', B), {}); // contradictory
    assert.deepEqual(parseGlobeUrl('?topic=a/b&polity=x:<y>', B), {});
    assert.deepEqual(parseGlobeUrl('?utm_source=mail&foo=bar', B), {});
    assert.deepEqual(parseGlobeUrl('', B), {});
    assert.deepEqual(parseGlobeUrl('?', B), {});
  });

  it('normalises case where the meaning is clear', () => {
    assert.deepEqual(parseGlobeUrl('?level=hl&curriculum=Archive&topic=Enabling-Act&polity=CLIO:Roman-Empire&all=true', B), {
      level: 'HL',
      curriculum: 'archive',
      topic: 'enabling-act',
      polity: 'clio:roman-empire',
      all: true,
    });
    assert.equal(parseGlobeUrl('?level=SL', B).level, 'SL');
    assert.equal(parseGlobeUrl('?curriculum=grade-10', B).curriculum, 'grade-10');
    assert.equal(parseGlobeUrl('?curriculum=g10', B).curriculum, 'grade-10');
    assert.equal(parseGlobeUrl('?curriculum=grade-10&level=HL', B).level, undefined);
  });

  it('trims the query and caps it at 100 characters', () => {
    assert.equal(parseGlobeUrl('?q=++french+revolution++', B).q, 'french revolution');
    const long = parseGlobeUrl(`?q=${'a'.repeat(150)}`, B).q;
    assert.equal(long?.length, 100);
    // Cut by code points: never half a surrogate pair.
    const emoji = parseGlobeUrl(`?q=${encodeURIComponent('🌍'.repeat(120))}`, B).q ?? '';
    assert.equal(Array.from(emoji).length, 100);
    assert.equal(emoji, '🌍'.repeat(100));
  });

  it('reads the view only with both lng and lat, and clamps it', () => {
    assert.equal(parseGlobeUrl('?lng=2.35', B).view, undefined);
    assert.equal(parseGlobeUrl('?lat=48.85&scale=2', B).view, undefined);
    assert.equal(parseGlobeUrl('?lng=abc&lat=48.85', B).view, undefined);
    assert.deepEqual(parseGlobeUrl('?lng=2.35&lat=48.85', B).view, { lng: 2.35, lat: 48.85, scale: 1 });
    assert.deepEqual(parseGlobeUrl('?lng=190&lat=95&scale=100', B).view, { lng: -170, lat: 85, scale: 64 });
    assert.deepEqual(parseGlobeUrl('?lng=-540&lat=-89&scale=0.1', B).view, { lng: -180, lat: -85, scale: 0.5 });
    assert.deepEqual(parseGlobeUrl('?lng=180&lat=0&scale=0', B).view, { lng: -180, lat: 0, scale: 1 });
    assert.deepEqual(parseGlobeUrl('?lng=10&lat=20&scale=-2', B).view, { lng: 10, lat: 20, scale: 1 });
    assert.deepEqual(parseGlobeUrl('?lng=10&lat=20&scale=Infinity', B).view, { lng: 10, lat: 20, scale: 1 });
  });

  it('reads the home page handoff', () => {
    // HomeGlobe writes year, level, lng, lat and scale (toFixed(3)).
    assert.deepEqual(parseGlobeUrl('?year=1789&level=SL&lng=12.500&lat=41.900&scale=1.250', B), {
      year: 1789,
      level: 'SL',
      view: { lng: 12.5, lat: 41.9, scale: 1.25 },
    });
  });
});

describe('serialiseGlobeUrl', () => {
  it('writes the stable order and precision', () => {
    assert.equal(
      serialiseGlobeUrl({
        view: { lng: 2.369449, lat: 48.85301, scale: 1.4 },
        q: 'french revolution',
        all: true,
        polity: 'clio:french-kingdom',
        topic: 'storming-of-the-bastille',
        curriculum: '2028',
        level: 'HL',
        year: 1789,
      }),
      '?year=1789&level=HL&curriculum=2028&topic=storming-of-the-bastille&polity=clio:french-kingdom&all=1&q=french+revolution&lng=2.369&lat=48.853&scale=1.4',
    );
  });

  it('omits missing parts and never writes year 0', () => {
    assert.equal(serialiseGlobeUrl({}), '');
    assert.equal(serialiseGlobeUrl({ year: 0 }), '');
    assert.equal(serialiseGlobeUrl({ year: 1453.5 }), '');
    assert.equal(serialiseGlobeUrl({ year: -500 }), '?year=-500');
    assert.equal(serialiseGlobeUrl({ all: false, q: '   ' }), '');
    assert.equal(serialiseGlobeUrl({ curriculum: 'grade-10', level: 'HL', year: 1914 }), '?year=1914&curriculum=grade-10');
    assert.equal(serialiseGlobeUrl({ view: { lng: Number.NaN, lat: 0, scale: 1 } }), '');
  });

  it('drops trailing zeros, wraps longitude and never writes -0', () => {
    assert.equal(serialiseGlobeUrl({ view: { lng: 180, lat: -0.0001, scale: 2 } }), '?lng=-180&lat=0&scale=2');
    assert.equal(serialiseGlobeUrl({ view: { lng: 12.5, lat: 41.9, scale: 1.25 } }), '?lng=12.5&lat=41.9&scale=1.25');
    assert.equal(serialiseGlobeUrl({ view: { lng: 1, lat: 2, scale: 0 } }), '?lng=1&lat=2');
  });

  it('escapes characters outside the alphabets', () => {
    assert.equal(serialiseGlobeUrl({ polity: 'x:a&b' }), '?polity=x:a%26b');
    assert.equal(serialiseGlobeUrl({ q: "people's republic & co+" }), '?q=people%27s+republic+%26+co%2B');
  });

  it('round-trips through parseGlobeUrl', () => {
    const states: GlobeUrlState[] = [
      { year: -300000, level: 'SL', curriculum: 'archive', all: true },
      { year: 1933, level: 'HL', curriculum: '2028', topic: 'enabling-act', polity: 'ovr:soviet-union', q: 'Kroll Opera House', view: { lng: 13.375, lat: 52.517, scale: 3.25 } },
      { year: -1, q: "people's republic & co+ = 100%", view: { lng: -179.5, lat: -33.869, scale: 0.5 } },
      { polity: 'ne:fra' },
    ];
    for (const s of states) assert.deepEqual(parseGlobeUrl(serialiseGlobeUrl(s), B), s);
  });
});

describe('year helpers', () => {
  it('parses typed years like @alexs-atlas/borders parseYear', () => {
    assert.equal(parseTypedYear('1453'), 1453);
    assert.equal(parseTypedYear('-500'), -500);
    assert.equal(parseTypedYear('500 B.C.'), -500);
    assert.equal(parseTypedYear('33 ce'), 33);
    assert.equal(parseTypedYear('AD 33 AD'), null);
    assert.equal(parseTypedYear('-500 BC'), null);
    assert.equal(parseTypedYear('0'), null);
    assert.equal(parseTypedYear('1453.5'), null);
    assert.equal(parseTypedYear('year'), null);
  });

  it('wraps longitude into [-180, 180)', () => {
    assert.equal(wrapLon(190), -170);
    assert.equal(wrapLon(-190), 170);
    assert.equal(wrapLon(180), -180);
    assert.equal(wrapLon(0), 0);
  });
});

describe('HistoryWriter', () => {
  type Call = [mode: string, url: string];
  let calls: Call[];
  let host: HistoryHost;
  let now: number;

  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
    now = 1000;
    calls = [];
    const location = { pathname: '/globe', search: '', hash: '#notes' };
    const write = (mode: string) => (_d: unknown, _u: string, url?: string) => {
      const u = url ?? '';
      calls.push([mode, u]);
      const q = u.indexOf('?');
      const h = u.indexOf('#');
      location.search = q < 0 ? '' : u.slice(q, h < 0 ? undefined : h);
      location.hash = h < 0 ? '' : u.slice(h);
    };
    host = { location, history: { pushState: write('push'), replaceState: write('replace') } };
  });
  afterEach(() => mock.timers.reset());

  /** Advances the injected clock and the mocked timers together. */
  const advance = (ms: number) => {
    now += ms;
    mock.timers.tick(ms);
  };

  it('throttles replaceState to one write per window, keeping the latest state', () => {
    const w = new HistoryWriter(host, 300, () => now);
    w.replace({ year: 1 }); // leading edge: written now
    w.replace({ year: 2 });
    w.replace({ year: 3 });
    assert.deepEqual(calls, [['replace', '/globe?year=1#notes']]);
    advance(299);
    assert.equal(calls.length, 1);
    advance(1);
    assert.deepEqual(calls, [
      ['replace', '/globe?year=1#notes'],
      ['replace', '/globe?year=3#notes'],
    ]);
    // The window restarts after the trailing write.
    w.replace({ year: 4 });
    assert.equal(calls.length, 2);
    advance(300);
    assert.deepEqual(calls.at(-1), ['replace', '/globe?year=4#notes']);
  });

  it('flushes a pending replace into the current entry, then pushes', () => {
    const w = new HistoryWriter(host, 300, () => now);
    w.replace({ year: 1 });
    w.replace({ year: 2 }); // pending
    w.push({ year: 2, polity: 'ne:fra' });
    advance(1000);
    assert.deepEqual(calls, [
      ['replace', '/globe?year=1#notes'],
      ['replace', '/globe?year=2#notes'],
      ['push', '/globe?year=2&polity=ne:fra#notes'],
    ]);
  });

  it('does not flush a pending replace that already holds the pushed state', () => {
    const w = new HistoryWriter(host, 300, () => now);
    w.replace({ year: 1 });
    w.replace({ year: 5, polity: 'ne:fra' }); // pending, same as the push below
    w.push({ year: 5, polity: 'ne:fra' });
    advance(1000);
    assert.deepEqual(calls, [
      ['replace', '/globe?year=1#notes'],
      ['push', '/globe?year=5&polity=ne:fra#notes'],
    ]);
  });

  it('skips identical queries', () => {
    const w = new HistoryWriter(host, 300, () => now);
    w.push({ year: 7 });
    w.push({ year: 7 });
    advance(500);
    w.replace({ year: 7 });
    advance(500);
    assert.equal(calls.length, 1);
  });

  it('keeps the path and hash, and drops the query when the state is empty', () => {
    host.location.search = '?year=1789';
    const w = new HistoryWriter(host, 300, () => now);
    const seen: string[] = [];
    w.onWrite = (s) => seen.push(s);
    w.replace({});
    assert.deepEqual(calls, [['replace', '/globe#notes']]);
    assert.deepEqual(seen, ['']);
  });

  it('cancel drops a pending replace', () => {
    const w = new HistoryWriter(host, 300, () => now);
    w.replace({ year: 1 });
    w.replace({ year: 2 });
    w.cancel();
    advance(1000);
    assert.deepEqual(calls, [['replace', '/globe?year=1#notes']]);
  });

  it('survives a browser that rate-limits the History API', () => {
    host.history.replaceState = () => {
      throw new Error('SecurityError: too many calls');
    };
    const w = new HistoryWriter(host, 300, () => now);
    const seen: string[] = [];
    w.onWrite = (s) => seen.push(s);
    assert.doesNotThrow(() => w.replace({ year: 9 }));
    assert.doesNotThrow(() => w.push({ year: 10 }));
    assert.deepEqual(seen, ['?year=10']);
  });

  it('works with the real clock and timers', async () => {
    mock.timers.reset();
    const w = new HistoryWriter(host, 20);
    w.replace({ year: 1 });
    w.replace({ year: 2 });
    assert.equal(calls.length, 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(calls.at(-1), ['replace', '/globe?year=2#notes']);
  });
});
