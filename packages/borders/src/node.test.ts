import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBorders } from './index.js';
import { fileFetch } from './node.js';
import { makeFiles } from './testing/fixture.js';

let root = '';
let dataDir = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'alexs-atlas-borders-'));
  dataDir = join(root, 'vibe coding', 'data'); // a space, like this repository's path
  for (const [path, text] of makeFiles()) {
    const file = join(dataDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

describe('fileFetch', () => {
  it('serves a dataset from a Windows/POSIX path with spaces', async () => {
    const borders = createBorders({ manifestUrl: join(dataDir, 'manifest.json') }, { fetch: fileFetch });
    expect((await borders.bordersAt(1)).features).toHaveLength(5);
    expect((await borders.search('alpha'))[0]?.pid).toBe('clio:alpha');
  });

  it('serves a dataset from a file: URL', async () => {
    const borders = createBorders({ manifestUrl: pathToFileURL(join(dataDir, 'manifest.json')).href }, { fetch: fileFetch });
    expect((await borders.linesAt(-300)).features.map((f) => f.properties.kind)).toEqual(['border', 'coast']);
    expect((await borders.base('land')).features).toHaveLength(4);
  });

  it('answers 404 for missing files', async () => {
    const res = await fileFetch(join(dataDir, 'nope.json'));
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    const borders = createBorders({ manifestUrl: join(root, 'missing', 'manifest.json') }, { fetch: fileFetch });
    await expect(borders.ready()).rejects.toMatchObject({ name: 'FetchError', status: 404 });
  });

  it('honours an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(fileFetch(join(dataDir, 'manifest.json'), { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes http(s) URLs to the global fetch', async () => {
    const saved = globalThis.fetch;
    const seen: string[] = [];
    globalThis.fetch = (async (url: string) => (seen.push(url), new Response('{}'))) as typeof fetch;
    try {
      await fileFetch('https://example.test/x.json');
    } finally {
      globalThis.fetch = saved;
    }
    expect(seen).toEqual(['https://example.test/x.json']);
  });
});
