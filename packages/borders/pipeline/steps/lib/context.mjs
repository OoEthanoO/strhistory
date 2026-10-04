// Paths, pipeline config and small helpers shared by build.mjs, the Node steps
// and the Node tools. Config paths are relative to the repository root.
import { readFileSync, mkdirSync, writeFileSync, renameSync, existsSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const PIPELINE = resolve(here, '../..');
export const BORDERS = resolve(PIPELINE, '..');
export const ROOT = resolve(BORDERS, '../..');

export const CONFIG = JSON.parse(readFileSync(join(PIPELINE, 'config.json'), 'utf8'));

/** Absolute path from the repository root. */
export const rootPath = (...parts) => join(ROOT, ...parts);

export const PATHS = {
  cache: rootPath(CONFIG.paths.cache),
  build: rootPath(CONFIG.paths.build),
  reference: rootPath(CONFIG.paths.reference),
  overrides: rootPath(CONFIG.paths.overrides),
  data: rootPath(CONFIG.paths.data),
  final: rootPath(CONFIG.paths.build, 'final'),
  dev: rootPath(CONFIG.paths.build, 'dev'),
  packageTmp: rootPath(CONFIG.paths.build, 'package'),
  sources: rootPath(CONFIG.paths.cache, 'sources'),
  naturalEarth: rootPath(CONFIG.sources.naturalearth.dir),
  cliopatriaZip: rootPath(CONFIG.sources.cliopatria.file),
};

export const YEARS = {
  first: CONFIG.years.first,
  historicalFrom: CONFIG.years.historicalFrom,
  cutover: CONFIG.years.cutover,
  present: CONFIG.years.present,
  convention: CONFIG.years.convention,
};

// ------------------------------------------------------------------ years (no year 0)

/** Cliopatria uses 0 only as an arithmetic artefact: as an end year it means 1 BCE, as a start 1 CE. */
export const normYear = (y, end = false) => (y === 0 ? (end ? -1 : 1) : y);

/** y + n, skipping year 0 (−1 + 1 = 1). */
export function addYears(y, n) {
  let a = y < 0 ? y + 1 : y; // astronomical
  a += n;
  return a <= 0 ? a - 1 : a;
}

/** Number of calendar years in an inclusive range (year 0 does not exist). */
export const spanYears = (from, to) => to - from + 1 - (from < 0 && to > 0 ? 1 : 0);

// ------------------------------------------------------------------------- hashing

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const hash8 = (data) => sha256(data).slice(0, 8);

/** 32-bit FNV-1a of a string (stable colour slots, ids). */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ------------------------------------------------------------------------------ io

export const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

/** Writes via a temporary file + rename so readers never see half-written files. */
export function writeFileAtomic(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

export const writeJson = (path, obj, indent = 1) => writeFileAtomic(path, JSON.stringify(obj, null, indent) + '\n');

export const mtime = (p) => (existsSync(p) ? statSync(p).mtimeMs : 0);

/** Root-relative path with forward slashes (for logs and reports). */
export const rel = (p) => p.slice(ROOT.length + 1).replaceAll('\\', '/');

// ----------------------------------------------------------------------------- log

export function makeLogger(tag) {
  const t0 = Date.now();
  const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s`;
  return {
    info: (...a) => console.log(`[${tag}] ${stamp()}`, ...a),
    warn: (...a) => console.warn(`[${tag}] ${stamp()} WARN`, ...a),
    error: (...a) => console.error(`[${tag}] ${stamp()} ERROR`, ...a),
    elapsed: () => (Date.now() - t0) / 1000,
  };
}

export const fmtBytes = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : `${(n / 1e3).toFixed(1)} kB`);

/** Parses `--key=value`, `--key value` and bare `--flag` arguments. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--') && ['input', 'out', 'only', 'from', 'skip', 'file'].includes(a.slice(2))) out[a.slice(2)] = argv[++i];
    else out[a.slice(2)] = true;
  }
  return out;
}
