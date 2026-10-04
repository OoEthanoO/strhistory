import { describe, expect, it, vi } from 'vitest';
import { FrameScheduler, sameFrame, type FrameKey } from './frames.js';

/** Frames of 100 years: 1900–1999 is one frame, etc. */
const frameOf = (y: number): { from: number; to: number } => {
  const from = Math.floor(y / 100) * 100;
  return { from, to: from + 99 };
};

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

/** A scheduler whose loads and renders are held until the test releases them. */
function harness() {
  const loads: { key: FrameKey; year: number; d: Deferred<string> }[] = [];
  const applies: { data: string; key: FrameKey; d: Deferred<void> }[] = [];
  const applied: number[] = [];
  const loading: boolean[] = [];
  const errors: unknown[] = [];
  const s = new FrameScheduler<string>({
    frameOf,
    load: (key, year) => {
      const d = deferred<string>();
      loads.push({ key, year, d });
      return d.promise;
    },
    apply: (data, key) => {
      const d = deferred<void>();
      applies.push({ data, key, d });
      return d.promise;
    },
    onApplied: (y) => applied.push(y),
    onLoading: (l) => loading.push(l),
    onError: (e) => errors.push(e),
  });
  return { s, loads, applies, applied, loading, errors };
}

describe('FrameScheduler', () => {
  it('loads and applies the first frame, then reports it applied', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    expect(h.s.busy).toBe(true);
    expect(h.loads).toHaveLength(1);
    expect(h.loads[0]!.key).toEqual({ from: 1900, to: 1999, lod: 'l0' });
    h.loads[0]!.d.resolve('data-1900');
    await flush();
    expect(h.applies).toHaveLength(1);
    expect(h.s.displayed).toBeNull(); // not displayed until rendered
    h.applies[0]!.d.resolve();
    await flush();
    expect(h.s.displayed).toEqual({ from: 1900, to: 1999, lod: 'l0' });
    expect(h.applied).toEqual([1914]);
    expect(h.loading).toEqual([true, false]);
  });

  it('does no work when the frame does not change', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('a');
    await flush();
    h.applies[0]!.d.resolve();
    await flush();
    h.s.request(1950, 'l0'); // same frame 1900–1999
    h.s.request(1999, 'l0');
    expect(h.loads).toHaveLength(1);
    expect(h.applies).toHaveLength(1);
    expect(h.applied).toEqual([1914, 1950, 1999]);
    h.s.request(1999, 'l0'); // same year again: not re-reported
    expect(h.applied).toEqual([1914, 1950, 1999]);
  });

  it('coalesces: while busy only the latest request is loaded next (latest wins)', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('1900');
    await flush();
    // Rendering 1900s; the user scrubs through 1700s, 1600s, 1500s.
    h.s.request(1750, 'l0');
    h.s.request(1650, 'l0');
    h.s.request(1550, 'l0');
    expect(h.loads).toHaveLength(1);
    h.applies[0]!.d.resolve();
    await flush();
    expect(h.loads).toHaveLength(2);
    expect(h.loads[1]!.key.from).toBe(1500);
    h.loads[1]!.d.resolve('1500');
    await flush();
    h.applies[1]!.d.resolve();
    await flush();
    expect(h.s.displayed!.from).toBe(1500);
    expect(h.applied).toEqual([1550]); // only the settled year is reported
  });

  it('never renders data that went stale while loading', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.s.request(1814, 'l0'); // arrives while 1900s is loading
    h.loads[0]!.d.resolve('1900');
    await flush();
    expect(h.applies).toHaveLength(0); // stale: skipped
    expect(h.loads).toHaveLength(2);
    expect(h.loads[1]!.key.from).toBe(1800);
    h.loads[1]!.d.resolve('1800');
    await flush();
    expect(h.applies.map((a) => a.data)).toEqual(['1800']);
  });

  it('keeps the previous frame until the new one has rendered', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('1900');
    await flush();
    h.applies[0]!.d.resolve();
    await flush();
    h.s.request(1814, 'l0');
    h.loads[1]!.d.resolve('1800');
    await flush();
    expect(h.s.displayed!.from).toBe(1900); // apply (render) still pending
    h.applies[1]!.d.resolve();
    await flush();
    expect(h.s.displayed!.from).toBe(1800);
  });

  it('reloads the same years when the LOD changes (zoom or end of a timeline drag)', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('l0');
    await flush();
    h.applies[0]!.d.resolve();
    await flush();
    h.s.request(1914, 'l1');
    expect(h.loads).toHaveLength(2);
    expect(h.loads[1]!.key).toEqual({ from: 1900, to: 1999, lod: 'l1' });
    expect(sameFrame(h.loads[1]!.key, h.s.displayed)).toBe(false);
  });

  it('a failed load keeps the last good frame and is retried by a later request', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('1900');
    await flush();
    h.applies[0]!.d.resolve();
    await flush();
    h.s.request(1814, 'l0');
    h.loads[1]!.d.reject(new Error('offline'));
    await flush();
    expect(h.errors).toHaveLength(1);
    expect(h.s.busy).toBe(false);
    expect(h.s.displayed!.from).toBe(1900);
    expect(h.loads).toHaveLength(2); // no automatic retry loop
    h.s.request(1814, 'l0');
    expect(h.loads).toHaveLength(3);
  });

  it('scrubbing back to the displayed frame cancels the pending work without rendering', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    h.loads[0]!.d.resolve('1900');
    await flush();
    h.applies[0]!.d.resolve();
    await flush();
    h.s.request(1814, 'l0');
    h.s.request(1920, 'l0'); // back to the 1900s
    h.loads[1]!.d.resolve('1800');
    await flush();
    expect(h.applies).toHaveLength(1);
    expect(h.s.busy).toBe(false);
    expect(h.applied.at(-1)).toBe(1920);
  });

  it('whenSettled resolves once the wanted frame is displayed; dispose stops everything', async () => {
    const h = harness();
    h.s.request(1914, 'l0');
    const settled = vi.fn();
    void h.s.whenSettled().then(settled);
    h.loads[0]!.d.resolve('1900');
    await flush();
    expect(settled).not.toHaveBeenCalled();
    h.applies[0]!.d.resolve();
    await flush();
    expect(settled).toHaveBeenCalledTimes(1);

    h.s.request(1814, 'l0');
    const settled2 = vi.fn();
    void h.s.whenSettled().then(settled2);
    h.s.dispose();
    await flush();
    expect(settled2).toHaveBeenCalledTimes(1);
    h.loads[1]!.d.resolve('1800');
    await flush();
    expect(h.applies).toHaveLength(1); // nothing applied after dispose
    h.s.request(1714, 'l0');
    expect(h.loads).toHaveLength(2);
  });
});
