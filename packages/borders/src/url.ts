// Resolving dataset paths against the manifest location, in browsers, workers and Node.

// A URL scheme has at least two characters, so Windows drive letters ("D:\data") are
// treated as paths, not as a "d:" scheme.
const SCHEME = /^[a-z][a-z0-9+.-]+:/i;

/** True for absolute URLs ("https://…", "file:///…", "data:…") and protocol-relative "//host/…". */
export function isAbsoluteUrl(s: string): boolean {
  return SCHEME.test(s) || s.startsWith('//');
}

/**
 * Resolves `path` (as written in the manifest) against `base` (the manifest URL, or a
 * folder URL ending in '/'), like `new URL(path, base)`. When `base` is relative:
 * in a browser or worker it is first resolved against `location.href`; elsewhere (Node)
 * the result stays a relative path, resolved segment by segment, with '/' separators.
 */
export function resolveUrl(path: string, base: string): string {
  if (isAbsoluteUrl(path)) return path;
  if (SCHEME.test(base)) return new URL(path, base).href;
  const loc = (globalThis as { location?: { href?: unknown } }).location?.href;
  if (typeof loc === 'string' && SCHEME.test(loc)) return new URL(path, new URL(base, loc)).href;
  return joinPath(base, path);
}

/** Folder of a base path ("data/manifest.json" → "data/", "data/" → "data/"). */
function dirOf(base: string): string {
  const clean = base.replace(/\\/g, '/').replace(/[?#].*$/, '');
  return clean.slice(0, clean.lastIndexOf('/') + 1);
}

/** Path-wise resolution for relative bases outside a browser (Node file paths). */
function joinPath(base: string, path: string): string {
  const p = path.replace(/\\/g, '/');
  const full = (p.startsWith('/') ? '' : dirOf(base)) + p;
  // Keep a leading '/' (root) or '//' (UNC share); everything else is segments.
  const lead = full.startsWith('//') ? '//' : full.startsWith('/') ? '/' : '';
  const out: string[] = [];
  for (const seg of full.slice(lead.length).split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      const last = out[out.length - 1];
      if (last !== undefined && last !== '..' && !/^[a-z]:$/i.test(last)) out.pop();
      else if (!lead && (last === undefined || last === '..')) out.push('..');
      // otherwise we are at a root ('/', '//host' or a drive "D:") and stay there
      continue;
    }
    out.push(seg);
  }
  const joined = out.join('/');
  // Keep a trailing slash ("data/" + "x/" → "data/x/").
  return lead + joined + (p.endsWith('/') && joined !== '' ? '/' : '');
}

/**
 * Normalises the `baseUrl` given with an in-memory manifest: a folder gets a trailing
 * slash so `new URL()` keeps its last segment; a path ending in ".json" is taken to be
 * the manifest file itself and is used as is.
 */
export function folderBase(baseUrl: string): string {
  const path = baseUrl.replace(/[?#].*$/, '');
  if (path.endsWith('/') || path.endsWith('\\') || /\.json$/i.test(path)) return baseUrl;
  const rest = baseUrl.slice(path.length);
  // An empty base is the current folder, not the root ('' + '/' would be '/').
  return `${path || '.'}/${rest}`;
}
