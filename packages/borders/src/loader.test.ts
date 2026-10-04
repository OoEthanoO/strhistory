import { describe, expect, it } from 'vitest';
import { Loader, withSignal } from './loader.js';
import { makeServer, settle } from './testing/fixture.js';

const URL_ = 'https://example.test/data/alexs-atlas/manifest.json';

describe('Loader', () => {
  it('runs prepare once per download and forgets finished downloads', async () => {
    const server = makeServer();
    const loader = new Loader(server.fetch);
    let prepared = 0;
    const prepare = (json: unknown) => (prepared++, json);
    const [a, b] = await Promise.all([loader.load(URL_, prepare), loader.load(URL_, prepare)]);
    expect(a).toBe(b);
    expect(prepared).toBe(1);
    expect(loader.pending).toBe(0);
    await loader.load(URL_, prepare); // not cached by the loader itself: a new download
    expect(server.count('manifest')).toBe(2);
  });

  it('forgets a download once all its callers have aborted', async () => {
    const server = makeServer();
    server.hold('manifest');
    const loader = new Loader(server.fetch);
    const c1 = new AbortController();
    const c2 = new AbortController();
    const p1 = loader.load(URL_, (j) => j, c1.signal);
    const p2 = loader.load(URL_, (j) => j, c2.signal);
    await settle();
    c1.abort();
    await expect(p1).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader.pending).toBe(1); // c2 still waits
    expect(server.signals[0]?.aborted).toBe(false);
    c2.abort();
    await expect(p2).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader.pending).toBe(0);
    expect(server.signals[0]?.aborted).toBe(true);
    server.release();
    await expect(loader.load(URL_, (j) => (j as { schema: string }).schema)).resolves.toBe('alexs-atlas.borders/1');
  });

  it('a caller without a signal keeps the download alive', async () => {
    const server = makeServer();
    server.hold('manifest');
    const loader = new Loader(server.fetch);
    const c = new AbortController();
    const withAbort = loader.load(URL_, (j) => j, c.signal);
    const plain = loader.load(URL_, (j) => j);
    await settle();
    c.abort();
    await expect(withAbort).rejects.toMatchObject({ name: 'AbortError' });
    server.release();
    await expect(plain).resolves.toMatchObject({ schema: 'alexs-atlas.borders/1' });
    expect(server.signals[0]?.aborted).toBe(false);
    expect(loader.pending).toBe(0);
  });

  it('propagates prepare errors to every caller and retries next time', async () => {
    const server = makeServer();
    const loader = new Loader(server.fetch);
    const boom = () => {
      throw new Error('bad file');
    };
    const results = await Promise.allSettled([loader.load(URL_, boom), loader.load(URL_, boom)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(loader.pending).toBe(0);
    await expect(loader.load(URL_, () => 'ok')).resolves.toBe('ok');
  });
});

describe('withSignal', () => {
  it('passes values and errors through and detaches its listener', async () => {
    const c = new AbortController();
    await expect(withSignal(Promise.resolve(1), c.signal)).resolves.toBe(1);
    await expect(withSignal(Promise.reject(new Error('x')), c.signal)).rejects.toThrow('x');
    c.abort(); // must not throw or reject anything now
    await expect(withSignal(Promise.resolve(2), undefined)).resolves.toBe(2);
  });
});
