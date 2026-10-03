// JSON loading with in-flight de-duplication and per-caller AbortSignal support.

import type { FetchLike } from './types.js';

/** A dataset file could not be fetched (HTTP error status). */
export class FetchError extends Error {
  readonly status: number;
  readonly url: string;
  constructor(url: string, status: number, statusText?: string) {
    super(`@alexs-atlas/borders: HTTP ${status}${statusText ? ` ${statusText}` : ''} for ${url}`);
    this.name = 'FetchError';
    this.status = status;
    this.url = url;
  }
}

/** The rejection value for an aborted signal: its reason, or an AbortError DOMException. */
export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError');
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw abortReason(signal);
}

/** Settles like `promise`, or rejects as soon as `signal` aborts (the promise itself keeps running). */
export function withSignal<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortReason(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortReason(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** The fetch to use: the given one, else the global fetch called unbound (browsers reject other `this`). */
export function resolveFetch(fetchFn: FetchLike | undefined): FetchLike {
  if (fetchFn) return fetchFn;
  return (url, init) => {
    if (typeof globalThis.fetch !== 'function') {
      throw new Error('@alexs-atlas/borders: no global fetch; pass init.fetch');
    }
    return globalThis.fetch(url, init);
  };
}

/** GET + JSON.parse with HTTP status and JSON errors that name the URL. */
export async function fetchJson(fetchFn: FetchLike, url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetchFn(url, signal ? { signal } : {});
  if (!res.ok) throw new FetchError(url, res.status, res.statusText);
  try {
    return await res.json();
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`@alexs-atlas/borders: invalid JSON in ${url}: ${message}`, { cause: error });
  }
}

interface Inflight {
  promise: Promise<unknown>;
  controller: AbortController;
  /** Callers still waiting for this download. */
  waiters: number;
}

/**
 * Loads JSON files once for all concurrent callers.
 *
 * Every caller may pass its own AbortSignal: aborting rejects that caller at once
 * with the signal's reason (an AbortError by default). The shared download is
 * cancelled only when no caller is left waiting, and it is then forgotten, so an
 * abort never leaves a rejected promise behind for later callers. Failed downloads
 * are forgotten too (the next call retries).
 */
export class Loader {
  private readonly inflight = new Map<string, Inflight>();

  constructor(private readonly fetchFn: FetchLike) {}

  /** Number of downloads in progress (for tests and diagnostics). */
  get pending(): number {
    return this.inflight.size;
  }

  /**
   * Resolves with `prepare(json)`. `prepare` runs once per download, before any caller
   * resumes, so it is the place to fill caches (even if every caller has since moved on).
   */
  load<T>(url: string, prepare: (json: unknown) => T, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    let entry = this.inflight.get(url);
    if (!entry) {
      const controller = new AbortController();
      const promise = fetchJson(this.fetchFn, url, controller.signal).then(prepare);
      const created: Inflight = { promise, controller, waiters: 0 };
      const forget = () => {
        if (this.inflight.get(url) === created) this.inflight.delete(url);
      };
      promise.then(forget, forget); // also marks the rejection as handled
      this.inflight.set(url, created);
      entry = created;
    }
    const e = entry;
    const shared = e.promise as Promise<T>;
    e.waiters += 1;
    let waiting = true;
    const leave = () => {
      if (waiting) {
        waiting = false;
        e.waiters -= 1;
      }
    };
    if (!signal) return shared.finally(leave);
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        leave();
        if (e.waiters === 0 && this.inflight.get(url) === e) {
          // Nobody else wants this file: stop the download and forget it.
          this.inflight.delete(url);
          e.controller.abort();
        }
        reject(abortReason(signal));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      shared.then(
        (value) => {
          signal.removeEventListener('abort', onAbort);
          leave();
          resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener('abort', onAbort);
          leave();
          reject(error);
        },
      );
    });
  }
}
