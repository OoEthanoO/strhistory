// createBorders(): the query client (AGENTS.md §5.3).

import { Loader, resolveFetch, throwIfAborted, withSignal } from './loader.js';
import { Lru } from './lru.js';
import { checkLod, chunkAt, frameAt, isDataFrame, loadManifest, pickLod, validateManifest } from './manifest.js';
import { SearchIndex } from './search.js';
import { decodeBase, decodeBorders, decodeLabels, decodeLines, prepareChunk, type PreparedChunk } from './topo.js';
import { folderBase, resolveUrl } from './url.js';
import { assertYear, isValidYear } from './years.js';
import type {
  BordersClient,
  BordersInit,
  BordersSource,
  FeatureCollection,
  Frame,
  Geometry,
  HistYear,
  LineProps,
  LodLike,
  Manifest,
  ManifestChunk,
  MultiLineString,
  MultiPolygon,
  Point,
  PolityInfo,
  PolityProps,
  PolitySearchResult,
  Polygon,
  QueryOptions,
  SearchOptions,
} from './types.js';

const DEFAULT_CACHE_CHUNKS = 4;
const DEFAULT_CACHE_FRAMES = 8;

type Borders = FeatureCollection<Polygon | MultiPolygon, PolityProps>;
type Labels = FeatureCollection<Point, PolityProps>;
type Lines = FeatureCollection<MultiLineString, LineProps>;

const emptyCollection = <G extends Geometry | null, P>(): FeatureCollection<G, P> => ({
  type: 'FeatureCollection',
  features: [],
});

/** Where a per-year query reads from. */
interface Target {
  chunk: ManifestChunk;
  /** LOD of the file actually read (after fallback). */
  lod: string;
  /** Memo key: chunk, file LOD and frame. */
  key: string;
}

function cacheSize(name: string, value: number | undefined, fallback: number): number {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < 0) {
    throw new RangeError(`@alexs-atlas/borders: ${name} must be a non-negative integer, got ${String(n)}`);
  }
  return n;
}

function validatePolities(json: unknown, url: string): Record<string, PolityInfo> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new Error(`@alexs-atlas/borders: ${url} is not a polity index (an object keyed by pid)`);
  }
  return json as Record<string, PolityInfo>;
}

/**
 * Creates a client for a dataset given by its manifest URL, or by an already loaded
 * manifest plus the URL of the folder it lives in. Dataset paths are resolved
 * relative to the manifest. Nothing is fetched until the first call.
 */
export function createBorders(source: BordersSource, init: BordersInit = {}): BordersClient {
  const fetchFn = resolveFetch(init.fetch);
  const loader = new Loader(fetchFn);
  const cacheChunks = cacheSize('cacheChunks', init.cacheChunks, DEFAULT_CACHE_CHUNKS);
  const cacheFrames = cacheSize('cacheFrames', init.cacheFrames, DEFAULT_CACHE_FRAMES);

  let manifest: Manifest | undefined;
  let manifestPromise: Promise<Manifest> | undefined;
  /** URL or path that the manifest's relative paths are resolved against. */
  let base: string;
  if ('manifest' in source && source.manifest !== undefined && typeof source.baseUrl === 'string') {
    manifest = validateManifest(source.manifest);
    base = folderBase(source.baseUrl);
  } else if ('manifestUrl' in source && typeof source.manifestUrl === 'string') {
    base = source.manifestUrl;
  } else {
    throw new TypeError('@alexs-atlas/borders: createBorders needs { manifestUrl } or { manifest, baseUrl }');
  }

  /** Decoded chunks, one LRU per LOD. */
  const chunkCaches = new Map<string, Lru<string, PreparedChunk>>();
  const bordersMemo = new Lru<string, Borders>(cacheFrames);
  const labelsMemo = new Lru<string, Labels>(cacheFrames);
  const linesMemo = new Lru<string, Lines>(cacheFrames);
  const baseCache = new Map<string, FeatureCollection>();
  let politiesPromise: Promise<Record<string, PolityInfo>> | undefined;
  let searchIndex: { index: Record<string, PolityInfo>; search: SearchIndex } | undefined;

  function ready(): Promise<Manifest> {
    if (manifest) return Promise.resolve(manifest);
    if (!manifestPromise) {
      const p = loadManifest(base, { fetch: fetchFn }).then((m) => (manifest = m));
      manifestPromise = p;
      // A failed load is not kept: the next call tries again.
      p.catch(() => {
        if (manifestPromise === p) manifestPromise = undefined;
      });
    }
    return manifestPromise;
  }

  function frameOf(year: HistYear): Frame {
    assertYear(year);
    if (!manifest) throw new Error('@alexs-atlas/borders: frameOf() needs the manifest; await ready() first');
    return frameAt(manifest, year);
  }

  /** Resolves the chunk, LOD and memo key for a year; undefined outside the dataset's coverage. */
  async function target(year: HistYear, o: QueryOptions): Promise<Target | undefined> {
    assertYear(year);
    throwIfAborted(o.signal);
    const m = await withSignal(ready(), o.signal);
    const lod = checkLod(m, o.lod);
    const frame = frameAt(m, year);
    if (!isDataFrame(frame)) return undefined;
    const chunk = chunkAt(m.chunks, year);
    if (!chunk) return undefined;
    const fileLod = pickLod(m.lods, chunk.files, lod);
    if (fileLod === undefined) return undefined;
    return { chunk, lod: fileLod, key: `${chunk.id}|${fileLod}|${frame.from}` };
  }

  function loadChunk(chunk: ManifestChunk, lod: string, signal?: AbortSignal): Promise<PreparedChunk> {
    let cache = chunkCaches.get(lod);
    if (!cache) chunkCaches.set(lod, (cache = new Lru(cacheChunks)));
    const hit = cache.get(chunk.id);
    if (hit) return Promise.resolve(hit);
    const lru = cache;
    const url = resolveUrl(chunk.files[lod] as string, base);
    // The cache is filled by the shared download itself, so it is filled once even when
    // several callers wait for it, and never with an aborted or failed result.
    return loader.load(
      url,
      (json) => {
        const prepared = prepareChunk(json, url);
        lru.set(chunk.id, prepared);
        return prepared;
      },
      signal,
    );
  }

  /** Per-year query: memoised per (chunk, LOD, frame), decoded from the chunk on a miss. */
  async function query<T>(
    memo: Lru<string, T>,
    year: HistYear,
    o: QueryOptions,
    decode: (chunk: PreparedChunk, year: HistYear) => T,
    empty: () => T,
  ): Promise<T> {
    const t = await target(year, o);
    throwIfAborted(o.signal); // the signal may have fired while we were resuming
    if (!t) return empty();
    const hit = memo.get(t.key);
    if (hit) return hit;
    const chunk = await loadChunk(t.chunk, t.lod, o.signal);
    throwIfAborted(o.signal);
    // Concurrent callers share the download; the first to resume decodes, the rest reuse it.
    let value = memo.get(t.key);
    if (!value) {
      value = decode(chunk, year);
      memo.set(t.key, value);
    }
    return value;
  }

  const bordersAt = (year: HistYear, o: QueryOptions = {}): Promise<Borders> =>
    query<Borders>(bordersMemo, year, o, decodeBorders, emptyCollection);

  const labelsAt = (year: HistYear, o: QueryOptions = {}): Promise<Labels> =>
    query<Labels>(labelsMemo, year, o, decodeLabels, emptyCollection);

  const linesAt = (year: HistYear, o: QueryOptions = {}): Promise<Lines> =>
    query<Lines>(linesMemo, year, o, decodeLines, emptyCollection);

  async function baseLayer(name: 'land' | 'lakes', lod?: LodLike): Promise<FeatureCollection> {
    if (name !== 'land' && name !== 'lakes') {
      throw new TypeError(`@alexs-atlas/borders: unknown base layer ${JSON.stringify(name)} (use 'land' or 'lakes')`);
    }
    const m = await ready();
    const id = checkLod(m, lod);
    const files = m.base[name];
    const fileLod = files ? pickLod(m.lods, files, id) : undefined;
    if (!files || fileLod === undefined) return emptyCollection();
    const url = resolveUrl(files[fileLod] as string, base);
    const hit = baseCache.get(url);
    if (hit) return hit;
    return loader.load(url, (json) => {
      const fc = decodeBase(json, url);
      baseCache.set(url, fc);
      return fc;
    });
  }

  function polities(): Promise<Record<string, PolityInfo>> {
    if (!politiesPromise) {
      const p = ready().then((m) => {
        const url = resolveUrl(m.polities, base);
        return loader.load(url, (json) => validatePolities(json, url));
      });
      politiesPromise = p;
      p.catch(() => {
        if (politiesPromise === p) politiesPromise = undefined;
      });
    }
    return politiesPromise;
  }

  async function polity(pid: string): Promise<PolityInfo | undefined> {
    const index = await polities();
    return Object.hasOwn(index, pid) ? index[pid] : undefined;
  }

  async function search(q: string, o: SearchOptions = {}): Promise<PolitySearchResult[]> {
    if (o.year !== undefined) assertYear(o.year, 'search year');
    const index = await polities();
    if (searchIndex?.index !== index) searchIndex = { index, search: new SearchIndex(index) };
    return searchIndex.search.search(q, o);
  }

  function prefetch(year: HistYear, lod?: LodLike): void {
    if (!isValidYear(year)) return;
    const o: QueryOptions = lod === undefined ? {} : { lod };
    target(year, o)
      .then((t) => t && loadChunk(t.chunk, t.lod))
      .catch(() => {
        /* prefetching is best effort; the real request reports errors */
      });
  }

  return { ready, frameOf, bordersAt, labelsAt, linesAt, base: baseLayer, polities, polity, search, prefetch };
}
