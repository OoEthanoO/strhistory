// @alexs-atlas/borders/node — helpers for Node scripts and static-site builds.
// Kept out of the main entry so browser bundles never see a `node:` import.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * A `fetch` for reading the dataset from disk: `file:` URLs and plain paths
 * (absolute, or relative to the working directory) are read with fs; http(s) URLs go
 * to the global fetch. Missing files answer 404 like a web server would.
 *
 * ```ts
 * import { createBorders } from '@alexs-atlas/borders';
 * import { fileFetch } from '@alexs-atlas/borders/node';
 * const borders = createBorders({ manifestUrl: 'packages/borders/data/manifest.json' }, { fetch: fileFetch });
 * ```
 */
export async function fileFetch(input: string | URL, init: { signal?: AbortSignal | null } = {}): Promise<Response> {
  const url = typeof input === 'string' ? input : input.href;
  if (/^https?:/i.test(url)) return globalThis.fetch(url, init.signal ? { signal: init.signal } : {});
  const path = /^file:/i.test(url) ? fileURLToPath(url) : url;
  try {
    const text = await readFile(path, init.signal ? { encoding: 'utf8', signal: init.signal } : { encoding: 'utf8' });
    return new Response(text, { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return new Response(null, { status: 404, statusText: 'Not Found' });
    throw error;
  }
}
