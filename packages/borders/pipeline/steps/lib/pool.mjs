// A small worker pool for chunk builds (mapshaper is CPU-bound and single-threaded).
// A worker that dies (e.g. out of memory on a huge chunk) rejects its job and is
// replaced; the caller decides whether to retry elsewhere.
import { Worker } from 'node:worker_threads';
import { availableParallelism, totalmem } from 'node:os';

const GB = 1024 ** 3;

/** Default size: half the CPUs, at most 6, and at most one worker per 4 GB of RAM above 8 GB. */
export function defaultPoolSize(workerHeapMb = 4096) {
  const byCpu = Math.floor(availableParallelism() / 2);
  const byMem = Math.floor((totalmem() - 8 * GB) / (workerHeapMb * 1024 * 1024));
  return Math.max(1, Math.min(6, byCpu, byMem));
}

export function createPool(size = defaultPoolSize(), maxOldGenerationSizeMb = 4096) {
  const url = new URL('./chunk-worker.mjs', import.meta.url);
  const idle = [];
  const queue = [];
  const current = new Map(); // worker -> job
  const workers = new Set();
  let seq = 0;
  let closing = false;

  function spawn() {
    const w = new Worker(url, { resourceLimits: { maxOldGenerationSizeMb } });
    workers.add(w);
    w.on('message', ({ result, error }) => {
      const job = current.get(w);
      current.delete(w);
      idle.push(w);
      if (job) error ? job.reject(new Error(error)) : job.resolve(result);
      pump();
    });
    const die = (err) => {
      if (!workers.has(w)) return;
      workers.delete(w);
      const i = idle.indexOf(w);
      if (i >= 0) idle.splice(i, 1);
      const job = current.get(w);
      current.delete(w);
      if (job) job.reject(err instanceof Error ? err : new Error(`worker exited (${err})`));
      if (!closing) {
        spawn();
        pump();
      }
    };
    w.on('error', die);
    w.on('exit', (code) => die(code));
    idle.push(w);
  }
  for (let i = 0; i < size; i++) spawn();

  function pump() {
    while (idle.length && queue.length) {
      const w = idle.pop();
      const job = queue.shift();
      current.set(w, job);
      w.postMessage({ id: job.id, task: job.task });
    }
  }

  return {
    size,
    run(task) {
      return new Promise((resolve, reject) => {
        queue.push({ id: ++seq, task, resolve, reject });
        pump();
      });
    },
    async close() {
      closing = true;
      await Promise.all([...workers].map((w) => w.terminate()));
    },
  };
}
