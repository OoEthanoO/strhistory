/**
 * OpenHistoricalMap's boundary tiles are 4–8 MB each once unzipped (every
 * admin level, every date) and its server lets browsers keep them for only a
 * minute. This keeps them for a week in the Cache API, gzipped again so a tile
 * takes ~1 MB of disk, and starts the world view's tiles downloading before
 * MapLibre has even loaded. No MapLibre here, so the pages can import it early.
 */
export const OHM_TILE_URL = 'https://vtiles.openhistoricalmap.org/maps/ohm_admin';
const CACHE = 'ohm-tiles-v1';
const MAX_AGE = 7 * 24 * 3600 * 1000;
/** Oldest tiles go first beyond this many (~1 MB each). */
const MAX_TILES = 150;
const STORED = 'x-stored';

/** Downloads under way or just finished (kept while the gzipped copy is written). */
const inflight = new Map<string, Promise<ArrayBuffer>>();
const KEEP_MS = 120_000;

function openCache(): Promise<Cache | null> {
  try {
    return 'caches' in globalThis ? caches.open(CACHE).catch(() => null) : Promise.resolve(null);
  } catch {
    return Promise.resolve(null);
  }
}

async function readCached(cache: Cache, url: string): Promise<ArrayBuffer | null> {
  const hit = await cache.match(url).catch(() => undefined);
  if (!hit?.body || Date.now() - Number(hit.headers.get(STORED) ?? 0) > MAX_AGE) return null;
  try {
    return await new Response(hit.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  } catch {
    return null;
  }
}

async function store(cache: Cache, url: string, data: ArrayBuffer) {
  try {
    const gzipped = await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
    await cache.put(url, new Response(gzipped, { headers: { [STORED]: String(Date.now()) } }));
    const keys = await cache.keys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await cache.delete(old);
  } catch {
    // Storage full or blocked (private windows): the tile still shows.
  }
}

/** The shared download (or cache read) of one tile. */
function load(path: string): Promise<ArrayBuffer> {
  const url = `${OHM_TILE_URL}/${path}`;
  let request = inflight.get(url);
  if (request) return request;
  request = (async () => {
    const cache = await openCache();
    const cached = cache && (await readCached(cache, url));
    if (cached) return cached;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.arrayBuffer();
    if (cache) void store(cache, url, data.slice(0));
    return data;
  })();
  inflight.set(url, request);
  request.then(() => setTimeout(() => inflight.delete(url), KEEP_MS), () => inflight.delete(url));
  return request;
}

/**
 * One boundary tile, from the week-long cache or the network; concurrent
 * requests share one download. Each caller gets its own copy, since MapLibre
 * hands the buffer to its worker.
 */
export function ohmTile(path: string, signal?: AbortSignal): Promise<ArrayBuffer> {
  const copy = load(path).then((data) => data.slice(0));
  if (!signal) return copy;
  return new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    copy.then(resolve, reject);
  });
}

/** Zoom at which the whole globe fits comfortably in the element. */
export function fitZoom(el: HTMLElement, _compact = false): number {
  const m = Math.max(100, Math.min(el.clientWidth, el.clientHeight));
  // Calibrated to the baked SVG's 90% diameter at the fixed globe perspective.
  return Math.log2((m * Math.PI) / 512);
}

/**
 * Start the tiles a whole-globe view in `el` needs while MapLibre is still
 * loading: it asks for zoom level floor(map zoom), which for a globe fitted to
 * a phone or laptop is 0 or 1, i.e. one or four tiles for the whole world.
 */
export function prefetchWorld(el: HTMLElement, scale: number) {
  const z = Math.floor(fitZoom(el) + Math.log2(Math.max(0.4, scale)));
  if (z < 0 || z > 1) return;
  const n = 2 ** z;
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) load(`${z}/${x}/${y}`).catch(() => {});
}
