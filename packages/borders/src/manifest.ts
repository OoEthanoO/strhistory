// manifest.json: loading, validation, frame and chunk lookup, LOD choice, attribution.

import { fetchJson, resolveFetch, withSignal } from './loader.js';
import { addYears, isValidYear } from './years.js';
import type { FetchLike, Frame, HistYear, LodId, LodLike, Manifest, ManifestChunk } from './types.js';

export const SCHEMA = 'alexs-atlas.borders/1';

/** Fetches, validates and returns a dataset manifest. */
export async function loadManifest(
  url: string,
  init: { fetch?: FetchLike; signal?: AbortSignal } = {},
): Promise<Manifest> {
  const json = await withSignal(fetchJson(resolveFetch(init.fetch), url, init.signal), init.signal);
  return validateManifest(json, url);
}

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStringRecord = (x: unknown): x is Record<string, string> =>
  isObject(x) && Object.values(x).every((v) => typeof v === 'string');

/**
 * Checks the parts of the manifest the client relies on and returns it typed. Throws
 * one Error listing every problem found. Unknown extra fields are allowed.
 */
export function validateManifest(json: unknown, where = 'manifest'): Manifest {
  const problems: string[] = [];
  const fail = (msg: string) => problems.push(msg);
  if (!isObject(json)) throw new Error(`@alexs-atlas/borders: ${where} is not a JSON object`);
  const m = json;
  if (m.schema !== SCHEMA) {
    throw new Error(`@alexs-atlas/borders: ${where} has schema ${JSON.stringify(m.schema)}, expected "${SCHEMA}"`);
  }

  const years = m.years;
  if (!isObject(years) || !isValidYear(years.from) || !isValidYear(years.to) || years.from > years.to) {
    fail('years.from/years.to must be valid years with from <= to');
  }
  const yearTo = isObject(years) && isValidYear(years.to) ? years.to : undefined;

  if (!Array.isArray(m.lods) || m.lods.length === 0) fail('lods must be a non-empty array');
  else {
    m.lods.forEach((l: unknown, i) => {
      if (!isObject(l) || typeof l.id !== 'string' || typeof l.minZoom !== 'number') {
        fail(`lods[${i}] needs a string id and a numeric minZoom`);
      }
    });
  }

  if (!Array.isArray(m.frames)) fail('frames must be an array');
  else {
    let prev = -Infinity;
    m.frames.forEach((f: unknown, i) => {
      if (!isValidYear(f)) fail(`frames[${i}] = ${String(f)} is not a valid year`);
      else if (f <= prev) fail(`frames must be strictly increasing (frames[${i}] = ${f})`);
      else prev = f;
    });
    if (yearTo !== undefined && prev > yearTo) fail(`the last frame (${prev}) is after years.to (${yearTo})`);
  }

  if (!Array.isArray(m.chunks)) fail('chunks must be an array');
  else {
    let prevTo = -Infinity;
    m.chunks.forEach((c: unknown, i) => {
      if (!isObject(c) || typeof c.id !== 'string' || !isValidYear(c.from) || !isValidYear(c.to) || c.from > c.to) {
        fail(`chunks[${i}] needs an id and valid years with from <= to`);
        return;
      }
      if (!isStringRecord(c.files) || Object.keys(c.files).length === 0) fail(`chunks[${i}] (${c.id}) has no files`);
      if (c.from <= prevTo) fail(`chunks must be sorted and must not overlap (chunks[${i}] = ${c.id})`);
      prevTo = c.to;
    });
  }

  if (!isObject(m.base) || !isStringRecord(m.base.land)) fail('base.land must map LOD ids to paths');
  else if (m.base.lakes !== undefined && !isStringRecord(m.base.lakes)) fail('base.lakes must map LOD ids to paths');
  if (typeof m.polities !== 'string') fail('polities must be a path');
  if (!Array.isArray(m.sources)) fail('sources must be an array');

  if (problems.length > 0) {
    throw new Error(`@alexs-atlas/borders: invalid ${where}:\n - ${problems.join('\n - ')}`);
  }
  return m as unknown as Manifest;
}

/**
 * The frame (years with identical borders) containing `year`. Years before the first
 * frame get `{ from: -Infinity, to: firstFrame − 1 }`, years after `years.to` get
 * `{ from: years.to + 1, to: Infinity }`; no borders exist in either.
 */
export function frameAt(m: Pick<Manifest, 'frames' | 'years'>, year: HistYear): Frame {
  const { frames } = m;
  const first = frames[0];
  if (first === undefined) return { from: -Infinity, to: Infinity };
  if (year < first) return { from: -Infinity, to: addYears(first, -1) };
  if (year > m.years.to) return { from: addYears(m.years.to, 1), to: Infinity };
  // Last index with frames[i] <= year.
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((frames[mid] as number) <= year) lo = mid;
    else hi = mid - 1;
  }
  const next = frames[lo + 1];
  return { from: frames[lo] as number, to: next === undefined ? m.years.to : addYears(next, -1) };
}

/** True when `frame` holds data (it is not one of the unbounded out-of-coverage frames). */
export const isDataFrame = (frame: Frame): boolean => Number.isFinite(frame.from) && Number.isFinite(frame.to);

/** The chunk whose [from, to] contains `year`, if any (chunks are sorted and disjoint). */
export function chunkAt(chunks: readonly ManifestChunk[], year: HistYear): ManifestChunk | undefined {
  let lo = 0;
  let hi = chunks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = chunks[mid] as ManifestChunk;
    if (year < c.from) hi = mid - 1;
    else if (year > c.to) lo = mid + 1;
    else return c;
  }
  return undefined;
}

/**
 * The LOD to read from `files`: `lod` when present, else the nearest coarser LOD
 * (earlier in `manifest.lods`), else the nearest finer one. Undefined when `files` is empty.
 */
export function pickLod(
  lods: readonly { id: string }[],
  files: Record<string, string>,
  lod: string,
): string | undefined {
  if (Object.hasOwn(files, lod)) return lod;
  const order = lods.map((l) => l.id);
  const at = order.indexOf(lod);
  if (at >= 0) {
    for (let i = at - 1; i >= 0; i--) if (Object.hasOwn(files, order[i] as string)) return order[i];
    for (let i = at + 1; i < order.length; i++) if (Object.hasOwn(files, order[i] as string)) return order[i];
  }
  return order.find((id) => Object.hasOwn(files, id)) ?? Object.keys(files)[0];
}

/** Checks an LOD id against the manifest (throws a RangeError for unknown ids). */
export function checkLod(m: Pick<Manifest, 'lods'>, lod: LodLike | undefined): string {
  const id = lod ?? (m.lods[0] as { id: string }).id;
  if (!m.lods.some((l) => l.id === id)) {
    throw new RangeError(
      `@alexs-atlas/borders: unknown LOD ${JSON.stringify(id)} (dataset has ${m.lods.map((l) => l.id).join(', ')})`,
    );
  }
  return id;
}

/** The LOD for a map zoom: the last entry of `manifest.lods` with minZoom <= zoom (else the first). */
export function lodForZoom(manifest: Pick<Manifest, 'lods'>, zoom: number): LodId {
  let pick = manifest.lods[0];
  if (pick === undefined) throw new Error('@alexs-atlas/borders: manifest has no LODs');
  for (const l of manifest.lods) if (l.minZoom <= zoom) pick = l;
  return pick.id;
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] as string);

// Licence deeds linked by SPDX id. Only licences this dataset may ship (AGENTS.md §2.2);
// public-domain sources such as Natural Earth stay unlinked rather than implying CC0.
const LICENSE_URLS: Record<string, string> = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

const isHttpUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(s);
const text = (s: unknown): string => (typeof s === 'string' ? s.trim() : '');

const link = (url: string, html: string) =>
  `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${html}</a>`;

type Source = Manifest['sources'][number];

/** Public-domain material needs no notice of changes (CC0, PDDL, "Public domain"). */
const isPublicDomain = (s: Source) => /^(CC0-1\.0|PDDL-1\.0)$/i.test(text(s.spdx)) || /public domain/i.test(text(s.license));

/** CC BY 4.0 §3(a)(1)(B): say when the material was modified (manifest sources list their `changes`). */
const isModified = (s: Source) => text(s.changes) !== '' && !isPublicDomain(s);

/** "<a>Name</a> (<a>Licence</a>, modified)". */
function compactAttribution(s: Source): string {
  const name = escapeHtml(text(s.name) || text(s.id));
  const title = isHttpUrl(s.url) ? link(s.url, name) : name;
  const notes: string[] = [];
  const license = text(s.license);
  if (license) {
    const url = LICENSE_URLS[text(s.spdx)];
    notes.push(url ? link(url, escapeHtml(license)) : escapeHtml(license));
  }
  if (isModified(s)) notes.push('modified');
  return notes.length > 0 ? `${title} (${notes.join(', ')})` : title;
}

// "doi:10.1038/s41597-025-04516-9" in an attribution sentence (escaped text).
const DOI = /\bdoi:(10\.\d{4,9}\/[^\s,;<>"]+?)(?=[.)]*(?:\s|$|[,;]))/gi;

/**
 * The source's own attribution sentence, escaped, with links on the first mention of the
 * source's name (to `url`), of its licence (to the licence deed) and on every DOI.
 */
function fullAttribution(s: Source): string {
  const sentence = text(s.attribution);
  const escaped = escapeHtml(sentence);
  const spans: { start: number; end: number; url: string }[] = [];
  const free = (start: number, end: number) => spans.every((x) => end <= x.start || start >= x.end);
  const mention = (needle: string, url: string | undefined) => {
    if (!needle || !url) return;
    for (let at = escaped.indexOf(needle); at >= 0; at = escaped.indexOf(needle, at + 1)) {
      if (free(at, at + needle.length)) {
        spans.push({ start: at, end: at + needle.length, url });
        return;
      }
    }
  };
  mention(escapeHtml(text(s.name)), isHttpUrl(s.url) ? s.url : undefined);
  mention(escapeHtml(text(s.license)), LICENSE_URLS[text(s.spdx)]);
  for (const m of escaped.matchAll(DOI)) {
    const start = m.index;
    if (free(start, start + m[0].length)) spans.push({ start, end: start + m[0].length, url: `https://doi.org/${m[1]}` });
  }
  spans.sort((a, b) => a.start - b.start);
  let html = '';
  let at = 0;
  for (const x of spans) {
    html += escaped.slice(at, x.start) + link(x.url, escaped.slice(x.start, x.end));
    at = x.end;
  }
  html += escaped.slice(at);
  return /[.!?]$/.test(sentence) ? html : `${html}.`;
}

export interface AttributionOptions {
  /**
   * Each source's full attribution sentence (`sources[].attribution`: creators, citation,
   * licence, changes) for a credits page, instead of the compact form. Sources without
   * a sentence fall back to the compact form.
   */
  full?: boolean;
}

/**
 * Attribution HTML built from `manifest.sources` (never from the manifest's own
 * `attribution.html`, so a dataset copy cannot inject markup). Compact (default), for a
 * map's attribution control: "<a>Name</a> (<a>Licence</a>, modified)" per source,
 * joined by " · ". With `full: true`, each source's attribution sentence with links.
 * All text is escaped; only http(s) URLs become links (opening in a new tab).
 */
export function attributionHtml(manifest: Pick<Manifest, 'sources'>, o: AttributionOptions = {}): string {
  const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
  if (o.full) return sources.map((s) => (text(s.attribution) ? fullAttribution(s) : `${compactAttribution(s)}.`)).join(' ');
  return sources.map(compactAttribution).join(' · ');
}
