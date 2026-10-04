import { describe, expect, it } from 'vitest';
import { attributionHtml, loadManifest, lodForZoom, validateManifest } from './index.js';
import { chunkAt, frameAt, pickLod } from './manifest.js';
import { Lru } from './lru.js';
import { folderBase, resolveUrl } from './url.js';
import { makeManifest, makeServer } from './testing/fixture.js';

describe('validateManifest', () => {
  it('accepts the fixture manifest and returns it', () => {
    const m = makeManifest();
    expect(validateManifest(m)).toBe(m);
  });

  it('rejects a wrong schema with a clear message', () => {
    expect(() => validateManifest({ ...makeManifest(), schema: 'other/2' })).toThrow(/schema "other\/2".*alexs-atlas\.borders\/1/);
    expect(() => validateManifest([])).toThrow(/not a JSON object/);
  });

  it('lists every structural problem at once', () => {
    const bad = {
      ...makeManifest(),
      frames: [1, 0, -5],
      lods: [],
      chunks: [
        { id: 'b', from: 10, to: 20, files: { l0: 'b.json' }, bytes: {}, records: 1 },
        { id: 'a', from: 1, to: 5, files: {}, bytes: {}, records: 1 },
      ],
      polities: 42,
    };
    let message = '';
    try {
      validateManifest(bad);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/lods must be a non-empty array/);
    expect(message).toMatch(/frames\[1\] = 0 is not a valid year/);
    expect(message).toMatch(/strictly increasing/);
    expect(message).toMatch(/chunks\[1\] \(a\) has no files/);
    expect(message).toMatch(/sorted/);
    expect(message).toMatch(/polities must be a path/);
  });

  it('rejects frames after years.to', () => {
    expect(() => validateManifest({ ...makeManifest(), frames: [-500, 3000] })).toThrow(/after years\.to/);
  });
});

describe('loadManifest', () => {
  it('fetches and validates', async () => {
    const server = makeServer();
    const m = await loadManifest(server.manifestUrl, { fetch: server.fetch });
    expect(m.dataset).toBe('alexs-atlas-test');
    expect(server.calls).toEqual([server.manifestUrl]);
  });

  it('reports HTTP errors with the URL and status', async () => {
    const server = makeServer();
    server.failWith('manifest', 503);
    await expect(loadManifest(server.manifestUrl, { fetch: server.fetch })).rejects.toMatchObject({
      name: 'FetchError',
      status: 503,
      url: server.manifestUrl,
    });
  });

  it('reports invalid JSON', async () => {
    const server = makeServer();
    server.files.set('manifest.json', '{ nope');
    await expect(loadManifest(server.manifestUrl, { fetch: server.fetch })).rejects.toThrow(/invalid JSON in .*manifest\.json/);
  });

  it('honours an abort signal', async () => {
    const server = makeServer();
    server.hold('manifest');
    const controller = new AbortController();
    const p = loadManifest(server.manifestUrl, { fetch: server.fetch, signal: controller.signal });
    controller.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('frameAt', () => {
  const m = makeManifest(); // frames −500, −200, 1, 500, 1000, 1500, 1946; years.to 2026
  it.each([
    [-500, -500, -201],
    [-201, -500, -201],
    [-200, -200, -1],
    [-1, -200, -1], // the frame before year 1 ends at 1 BCE, not at year 0
    [1, 1, 499],
    [499, 1, 499],
    [500, 500, 999],
    [1945, 1500, 1945],
    [1946, 1946, 2026],
    [2026, 1946, 2026],
  ])('year %i is in [%i, %i]', (year, from, to) => {
    expect(frameAt(m, year)).toEqual({ from, to });
  });

  it('gives unbounded frames outside the coverage', () => {
    expect(frameAt(m, -501)).toEqual({ from: -Infinity, to: -501 });
    expect(frameAt(m, -9999)).toEqual({ from: -Infinity, to: -501 });
    expect(frameAt(m, 2027)).toEqual({ from: 2027, to: Infinity });
  });

  it('skips year 0 when the first frame is year 1', () => {
    expect(frameAt({ frames: [1, 10], years: { ...m.years, to: 20 } }, -5)).toEqual({ from: -Infinity, to: -1 });
  });

  it('handles an empty frame list', () => {
    expect(frameAt({ frames: [], years: m.years }, 5)).toEqual({ from: -Infinity, to: Infinity });
  });
});

describe('chunkAt', () => {
  const { chunks } = makeManifest();
  it.each([
    [-500, 'c0'],
    [-1, 'c0'],
    [1, 'c1'],
    [999, 'c1'],
    [1000, 'c2'],
    [2026, 'c2'],
  ])('year %i is in chunk %s', (year, id) => {
    expect(chunkAt(chunks, year)?.id).toBe(id);
  });
  it('returns undefined outside every chunk', () => {
    expect(chunkAt(chunks, -501)).toBeUndefined();
    expect(chunkAt(chunks, 2027)).toBeUndefined();
    expect(chunkAt([], 1)).toBeUndefined();
  });
});

describe('pickLod', () => {
  const lods = [{ id: 'l0' }, { id: 'l1' }, { id: 'l2' }];
  it('uses the requested LOD when present', () => {
    expect(pickLod(lods, { l0: 'a', l1: 'b' }, 'l1')).toBe('l1');
  });
  it('falls back to the nearest coarser LOD, then to a finer one', () => {
    expect(pickLod(lods, { l0: 'a', l1: 'b' }, 'l2')).toBe('l1');
    expect(pickLod(lods, { l0: 'a' }, 'l2')).toBe('l0');
    expect(pickLod(lods, { l2: 'c' }, 'l0')).toBe('l2');
  });
  it('ignores inherited object keys', () => {
    expect(pickLod([{ id: 'constructor' }, { id: 'l0' }], { l0: 'a' }, 'constructor')).toBe('l0');
  });
});

describe('lodForZoom', () => {
  const m = makeManifest(); // l0 from −2, l1 from 3, l2 from 5
  it.each([
    [-5, 'l0'],
    [0, 'l0'],
    [2.99, 'l0'],
    [3, 'l1'],
    [4.5, 'l1'],
    [5, 'l2'],
    [7, 'l2'],
    [Number.NaN, 'l0'],
  ])('zoom %s → %s', (zoom, lod) => {
    expect(lodForZoom(m, zoom)).toBe(lod);
  });
});

describe('attributionHtml', () => {
  it('links sources and CC BY licences', () => {
    const html = attributionHtml(makeManifest());
    expect(html).toBe(
      '<a href="https://github.com/Seshat-Global-History-Databank/cliopatria" target="_blank" rel="noopener noreferrer">Cliopatria (Seshat Global History Databank)</a>' +
        ' (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>)' +
        ' · <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> (Public domain)' +
        ' · Alex’s Atlas overrides (<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>)',
    );
  });

  it('escapes text and never links non-http URLs', () => {
    const html = attributionHtml({
      sources: [
        { id: 'x', name: '<script>alert("x")</script> & co', version: '1', url: 'javascript:alert(1)', license: 'MIT <b>', spdx: 'MIT', attribution: '' },
        { id: 'y', name: 'Quote', version: '1', url: 'https://example.org/a"onmouseover="x', license: '', spdx: '', attribution: '' },
      ],
    });
    expect(html).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co (MIT &lt;b&gt;) · Quote');
    expect(html).not.toMatch(/<(?!\/?a\b)/); // no tags other than <a>
  });

  it('does not reuse the manifest’s own attribution HTML', () => {
    expect(attributionHtml(makeManifest())).not.toContain('onerror');
    expect(attributionHtml(makeManifest(), { full: true })).not.toContain('onerror');
  });

  // The two sources of the dev dataset's manifest, as the pipeline writes them.
  const cliopatria = {
    id: 'cliopatria',
    name: 'Cliopatria (Seshat Global History Databank)',
    version: 'v0.2.0',
    url: 'https://github.com/Seshat-Global-History-Databank/cliopatria',
    license: 'CC BY 4.0',
    spdx: 'CC-BY-4.0',
    attribution:
      'Historical borders: Cliopatria (Seshat Global History Databank), Bennett et al., Scientific Data 12, 247 (2025), doi:10.1038/s41597-025-04516-9, CC BY 4.0 — modified (leaf polities only).',
    changes: 'leaf polities only',
  };
  const naturalEarth = {
    id: 'naturalearth',
    name: 'Natural Earth',
    version: 'v5.1.2',
    url: 'https://www.naturalearthdata.com/',
    license: 'Public domain',
    spdx: 'CC0-1.0',
    attribution: 'Made with Natural Earth.',
    changes: 'simplified per level of detail',
  };
  const CC_BY = '<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>';
  const CLIO = '<a href="https://github.com/Seshat-Global-History-Databank/cliopatria" target="_blank" rel="noopener noreferrer">Cliopatria (Seshat Global History Databank)</a>';
  const NE = '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a>';

  it('marks modified sources (CC BY 4.0 §3(a)(1)(B)), but not public-domain ones', () => {
    expect(attributionHtml({ sources: [cliopatria, naturalEarth] })).toBe(`${CLIO} (${CC_BY}, modified) · ${NE} (Public domain)`);
  });

  it('gives each source’s full sentence with links on request', () => {
    expect(attributionHtml({ sources: [cliopatria, naturalEarth] }, { full: true })).toBe(
      `Historical borders: ${CLIO}, Bennett et al., Scientific Data 12, 247 (2025), ` +
        '<a href="https://doi.org/10.1038/s41597-025-04516-9" target="_blank" rel="noopener noreferrer">doi:10.1038/s41597-025-04516-9</a>, ' +
        `${CC_BY} — modified (leaf polities only). Made with ${NE}.`,
    );
  });

  it('escapes full sentences, falls back to the compact form and ends every sentence', () => {
    const html = attributionHtml(
      {
        sources: [
          { ...naturalEarth, name: 'NE <1>', attribution: 'Data <b>by</b> NE <1> & friends (doi:10.1000/a.b).' },
          { ...cliopatria, attribution: '' },
          { ...naturalEarth, url: 'javascript:alert(1)', attribution: 'Made with Natural Earth' },
        ],
      },
      { full: true },
    );
    expect(html).toBe(
      'Data &lt;b&gt;by&lt;/b&gt; <a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">NE &lt;1&gt;</a> &amp; friends ' +
        '(<a href="https://doi.org/10.1000/a.b" target="_blank" rel="noopener noreferrer">doi:10.1000/a.b</a>).' +
        ` ${CLIO} (${CC_BY}, modified).` +
        ' Made with Natural Earth.',
    );
  });
});

describe('resolveUrl', () => {
  it.each([
    ['chunks/l0/a.json', 'https://x.test/data/alexs-atlas/manifest.json', 'https://x.test/data/alexs-atlas/chunks/l0/a.json'],
    ['chunks/l0/a.json', 'https://x.test/data/alexs-atlas/', 'https://x.test/data/alexs-atlas/chunks/l0/a.json'],
    ['../shared/a.json', 'https://x.test/data/alexs-atlas/manifest.json', 'https://x.test/data/shared/a.json'],
    ['https://cdn.test/a.json', 'https://x.test/data/manifest.json', 'https://cdn.test/a.json'],
    ['chunks/a b.json', 'file:///D:/Documents/vibe%20coding/data/manifest.json', 'file:///D:/Documents/vibe%20coding/data/chunks/a%20b.json'],
    // Relative bases outside a browser stay paths.
    ['chunks/a.json', 'packages/borders/data/manifest.json', 'packages/borders/data/chunks/a.json'],
    ['chunks/a.json', '/data/alexs-atlas/manifest.json', '/data/alexs-atlas/chunks/a.json'],
    ['chunks/a.json', 'manifest.json', 'chunks/a.json'],
    ['chunks/a.json', '../data/manifest.json', '../data/chunks/a.json'],
    ['../../x.json', 'data/manifest.json', '../x.json'],
    ['../x.json', '/manifest.json', '/x.json'],
    ['chunks/a.json', 'D:\\Documents\\vibe coding\\data\\manifest.json', 'D:/Documents/vibe coding/data/chunks/a.json'],
    ['../../../x.json', 'D:\\data\\manifest.json', 'D:/x.json'],
    ['chunks/a.json', '\\\\server\\share\\data\\manifest.json', '//server/share/data/chunks/a.json'],
    ['chunks/a.json', 'data/manifest.json?v=3', 'data/chunks/a.json'],
  ])('resolveUrl(%j, %j) = %j', (path, base, expected) => {
    expect(resolveUrl(path, base)).toBe(expected);
  });

  it('resolves relative bases against location.href when there is one (browsers, workers)', () => {
    const g = globalThis as { location?: unknown };
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'location');
    g.location = { href: 'https://site.test/app/index.html' };
    try {
      expect(resolveUrl('chunks/a.json', '/data/alexs-atlas/manifest.json')).toBe('https://site.test/data/alexs-atlas/chunks/a.json');
      expect(resolveUrl('chunks/a.json', 'data/manifest.json')).toBe('https://site.test/app/data/chunks/a.json');
    } finally {
      if (saved) Object.defineProperty(globalThis, 'location', saved);
      else delete g.location;
    }
  });
});

describe('folderBase', () => {
  it.each([
    ['https://x.test/data', 'https://x.test/data/'],
    ['https://x.test/data/', 'https://x.test/data/'],
    ['https://x.test/data/manifest.json', 'https://x.test/data/manifest.json'],
    ['https://x.test/data?v=1', 'https://x.test/data/?v=1'],
    ['data', 'data/'],
    ['D:\\data\\', 'D:\\data\\'],
    ['', './'], // the current folder, not the root
  ])('folderBase(%j) = %j', (input, expected) => {
    expect(folderBase(input)).toBe(expected);
  });

  it('an empty base resolves files in the current folder', () => {
    expect(resolveUrl('chunks/a.json', folderBase(''))).toBe('chunks/a.json');
  });
});

describe('Lru', () => {
  it('evicts the least recently used entry', () => {
    const lru = new Lru<string, number>(2);
    lru.set('a', 1);
    lru.set('b', 2);
    expect(lru.get('a')).toBe(1); // a is now most recent
    lru.set('c', 3);
    expect(lru.has('b')).toBe(false);
    expect(lru.has('a')).toBe(true);
    expect(lru.size).toBe(2);
  });
  it('keeps nothing with capacity 0 and rejects invalid sizes', () => {
    const lru = new Lru<string, number>(0);
    lru.set('a', 1);
    expect(lru.size).toBe(0);
    expect(() => new Lru(-1)).toThrow(RangeError);
    expect(() => new Lru(1.5)).toThrow(RangeError);
  });
});
