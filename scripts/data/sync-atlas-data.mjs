// Copies the built Alex's Atlas borders dataset into the site's static folder:
//   packages/borders/data  →  public/data/alexs-atlas   (git-ignored)
//
//   node scripts/data/sync-atlas-data.mjs [--quiet] [--data <dir>]
//
// Runs before `dev` and `build` (predev/prebuild in package.json), so Astro copies the
// dataset into dist/ and Caddy serves it same-origin at /data/alexs-atlas/ (AGENTS.md §6).
// Another built dataset folder (for example a pipeline build staged in
// .cache/build/package/staging and not yet published to packages/borders/data) is served
// instead with `--data <dir>` or the ALEXS_ATLAS_DATA environment variable; relative paths
// resolve against the repository root. Only the files the manifest references are
// copied (plus the licence/attribution/QA documents), so stale content-hashed chunks
// left over from earlier pipeline runs never ship. Incremental: a file is copied only
// when its size or modification time differs; files that are no longer referenced are
// removed from the destination.
//
// Adapted from the Alex's Atlas reference site (apps/site/scripts/sync-data.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_DIR = path.resolve(here, '../..');
export const SITE_DIR = REPO_DIR;
export const SOURCE_DIR = path.join(REPO_DIR, 'packages', 'borders', 'data');
export const DEST_DIR = path.join(SITE_DIR, 'public', 'data', 'alexs-atlas');

/**
 * The dataset folder to serve: `dir` (a --data value) when given, else $ALEXS_ATLAS_DATA,
 * else packages/borders/data. Relative paths resolve against the repository root.
 */
export function resolveSource(dir = undefined, env = process.env) {
  const raw = (dir ?? env.ALEXS_ATLAS_DATA ?? '').trim();
  return raw ? path.resolve(REPO_DIR, raw) : SOURCE_DIR;
}

/** Documents that travel with the data (packages/AGENTS.md §5.2); optional ones may be missing. */
const DOCUMENTS = ['ATTRIBUTION.md', 'LICENSE.md', 'sources.json', 'qa-report.json'];
const REQUIRED_DOCUMENTS = new Set(['ATTRIBUTION.md', 'LICENSE.md']);
/** Dataset file names are lower-case and safe (packages/AGENTS.md §5.2); documents are listed above. */
const SAFE_PATH = /^(?:[a-z0-9._-]+\/)*[a-z0-9._-]+\.json$/;

/** Relative paths of every file the manifest needs, manifest.json first. */
export function referencedFiles(manifest) {
  const files = new Set(['manifest.json', manifest.polities]);
  for (const chunk of manifest.chunks ?? []) for (const f of Object.values(chunk.files ?? {})) files.add(f);
  for (const group of Object.values(manifest.base ?? {})) for (const f of Object.values(group ?? {})) files.add(f);
  for (const f of files) {
    if (typeof f !== 'string' || !SAFE_PATH.test(f) || f.split('/').includes('..')) {
      throw new Error(`sync-data: unexpected file name in manifest.json: ${JSON.stringify(f)}`);
    }
  }
  return [...files];
}

function sameFile(src, dest) {
  try {
    const a = fs.statSync(src);
    const b = fs.statSync(dest);
    return a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 1;
  } catch {
    return false;
  }
}

function listFiles(dir, base = dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

function removeEmptyDirs(dir, keep) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name), false);
  }
  if (!keep && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

/**
 * Synchronises the dataset into public/data/alexs-atlas. Returns counts; throws with a
 * helpful message when the dataset has not been built.
 */
export function syncData({ quiet = false, source = resolveSource(), dest = DEST_DIR } = {}) {
  const t0 = performance.now();
  const manifestPath = path.join(source, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`sync-data: ${manifestPath} not found. Build the dataset first (npm run data:build).`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schema !== 'alexs-atlas.borders/1') {
    throw new Error(`sync-data: unsupported manifest schema ${JSON.stringify(manifest.schema)}`);
  }
  const wanted = referencedFiles(manifest);
  for (const doc of DOCUMENTS) {
    if (fs.existsSync(path.join(source, doc))) wanted.push(doc);
    else if (REQUIRED_DOCUMENTS.has(doc)) throw new Error(`sync-data: ${doc} is missing from ${source}`);
  }
  for (const rel of wanted) {
    if (!fs.existsSync(path.join(source, rel))) throw new Error(`sync-data: manifest.json references ${rel}, which does not exist`);
  }

  let copied = 0;
  let bytes = 0;
  // manifest.json goes last: a server running meanwhile (vite dev) never sees a manifest
  // that names files which have not arrived yet.
  const order = [...wanted.filter((f) => f !== 'manifest.json'), 'manifest.json'];
  for (const rel of order) {
    const src = path.join(source, rel);
    const dst = path.join(dest, rel);
    if (sameFile(src, dst)) continue;
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    const st = fs.statSync(src);
    fs.utimesSync(dst, st.atime, st.mtime); // lets the next run skip it
    copied += 1;
    bytes += st.size;
  }

  const keep = new Set(wanted);
  let removed = 0;
  for (const rel of listFiles(dest)) {
    if (keep.has(rel)) continue;
    fs.rmSync(path.join(dest, rel));
    removed += 1;
  }
  removeEmptyDirs(dest, true);

  const result = {
    files: wanted.length,
    copied,
    removed,
    bytes,
    ms: Math.round(performance.now() - t0),
    dataset: manifest.dataset,
    version: manifest.version,
    source: path.relative(REPO_DIR, source).split(path.sep).join('/') || source,
  };
  if (!quiet) {
    const mb = (bytes / 1e6).toFixed(1);
    console.log(
      `sync-data: dataset ${manifest.dataset} ${manifest.version} (${result.source}) → ${path.relative(process.cwd(), dest) || dest}: ` +
        `${result.files} files, ${copied} copied (${mb} MB), ${removed} removed, ${result.ms} ms`,
    );
  }
  return result;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try {
    const argv = process.argv.slice(2);
    const at = argv.indexOf('--data');
    if (at >= 0 && !argv[at + 1]) throw new Error('sync-data: --data needs a folder');
    syncData({ quiet: argv.includes('--quiet'), source: resolveSource(at >= 0 ? argv[at + 1] : undefined) });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
