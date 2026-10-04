#!/usr/bin/env node
// Alex’s Atlas borders pipeline orchestrator (root `npm run data:build`).
//
//   node packages/borders/pipeline/build.mjs [--only=step,...] [--from=step] [--skip=step,...] [--dev] [--force] [--refetch] [--verbose]
//
// Steps, in order:
//   fetch      verify the sha256 of every pinned source in pipeline/config.json;
//              download missing files from the config URLs into .cache/sources
//   reference  py tools/reference.py → .cache/reference (skipped when up to date; --force reruns)
//   validate   tools/validate-overrides.mjs, then the override engine's dry run
//              (py/overrides.py --dry-run → .cache/build/override-dry-run.json): its errors
//              would fail the geometry QA 'overrides' gate. In --dev builds a validator
//              failure is only a warning and the dry run is skipped (dev builds do not
//              apply overrides)
//   geometry   py py/run_geometry.py → .cache/build/final   (--dev: tools/dev-features.mjs → .cache/build/dev)
//   package    steps/package.mjs → packages/borders/data   (--dev: dataset "alexs-atlas-borders-dev")
//   catalog    tools/catalog.mjs → override catalog in packages/borders/AGENTS.md
//
// --refetch re-downloads sources whose checksum does not match (default: fail).
// Exit code is non-zero when any step fails; a timing summary is printed at the end.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { CONFIG, PIPELINE, ROOT, PATHS, parseArgs, rel, mtime } from './steps/lib/context.mjs';

const STEPS = ['fetch', 'reference', 'validate', 'geometry', 'package', 'catalog'];
const args = parseArgs(process.argv.slice(2));
const dev = !!args.dev;
const node = process.execPath;
const py = join(PIPELINE, 'tools', 'py.mjs');

function stepList() {
  const split = (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []);
  const only = split(args.only);
  const skip = new Set(split(args.skip));
  for (const s of [...only, ...skip, ...(typeof args.from === 'string' ? [args.from] : [])]) {
    if (!STEPS.includes(s)) throw new Error(`unknown step "${s}" (steps: ${STEPS.join(', ')})`);
  }
  let list = only.length ? STEPS.filter((s) => only.includes(s)) : [...STEPS];
  if (typeof args.from === 'string') list = list.filter((s) => STEPS.indexOf(s) >= STEPS.indexOf(args.from));
  return list.filter((s) => !skip.has(s));
}

const say = (msg) => console.log(`[build] ${msg}`);

function run(cmd, argv, label) {
  say(`$ ${label}`);
  const r = spawnSync(cmd, argv, { stdio: 'inherit', cwd: ROOT, env: process.env });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

// ------------------------------------------------------------------------- fetch

/** All pinned files: [{ name, file, url, sha256 }]. */
function pinnedSources() {
  const clio = CONFIG.sources.cliopatria;
  const ne = CONFIG.sources.naturalearth;
  return [
    { name: `cliopatria ${clio.version}`, file: join(ROOT, clio.file), url: clio.url, sha256: clio.sha256 },
    ...Object.entries(ne.layers).map(([layer, sha256]) => ({ name: `natural earth ${layer}`, file: join(ROOT, ne.dir, `${layer}.geojson`), url: `${ne.baseUrl}${layer}.geojson`, sha256 })),
  ];
}

async function sha256File(file) {
  const h = createHash('sha256');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function download(src) {
  mkdirSync(dirname(src.file), { recursive: true });
  const tmp = `${src.file}.download`;
  const res = await fetch(src.url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`${src.url}: HTTP ${res.status}`);
  const h = createHash('sha256');
  let bytes = 0;
  const tap = new Transform({
    transform(chunk, _enc, cb) {
      h.update(chunk);
      bytes += chunk.length;
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body), tap, createWriteStream(tmp));
  const got = h.digest('hex');
  if (got !== src.sha256) {
    rmSync(tmp, { force: true });
    throw new Error(`${src.name}: downloaded file has sha256 ${got}, config pins ${src.sha256}`);
  }
  renameSync(tmp, src.file);
  return bytes;
}

async function stepFetch() {
  let ok = 0;
  for (const src of pinnedSources()) {
    if (existsSync(src.file)) {
      const got = await sha256File(src.file);
      if (got === src.sha256) {
        ok++;
        continue;
      }
      if (!args.refetch) throw new Error(`${rel(src.file)}: sha256 ${got} does not match the pinned ${src.sha256} (run with --refetch to download it again)`);
      say(`checksum mismatch, re-downloading ${src.name}`);
    } else say(`downloading ${src.name} from ${src.url}`);
    const bytes = await download(src);
    say(`  ${rel(src.file)}: ${(bytes / 1e6).toFixed(1)} MB, sha256 verified`);
    ok++;
  }
  say(`fetch: ${ok} pinned source files verified`);
}

// --------------------------------------------------------------------- reference

function referenceUpToDate() {
  const outputs = ['cliopatria-inventory.json', 'ne-admin0.json', 'ne-admin1.json', 'ne-disputed.json', 'frames.json', 'regions.json'].map((f) => join(PATHS.reference, f));
  const inputs = [join(PIPELINE, 'tools', 'reference.py'), PATHS.cliopatriaZip, ...['ne_10m_admin_0_countries', 'ne_10m_admin_1_states_provinces', 'ne_10m_admin_0_disputed_areas'].map((l) => join(PATHS.naturalEarth, `${l}.geojson`))];
  if (outputs.some((f) => !existsSync(f))) return false;
  return Math.min(...outputs.map(mtime)) > Math.max(...inputs.map(mtime));
}

// --------------------------------------------------------------------------- main

async function main() {
  const steps = stepList();
  say(`${dev ? 'DEV build' : 'build'}: ${steps.join(' → ') || '(nothing to do)'}`);
  const timings = [];
  for (const step of steps) {
    const t0 = Date.now();
    say(`── ${step} ${'─'.repeat(Math.max(0, 60 - step.length))}`);
    let status = 0;
    let note = '';
    switch (step) {
      case 'fetch':
        await stepFetch();
        break;
      case 'reference':
        if (!args.force && referenceUpToDate()) {
          note = 'up to date';
          say('reference lists are newer than their inputs; skipping (--force to rebuild)');
        } else status = run(node, [py, 'reference.py'], 'py tools/reference.py');
        break;
      case 'validate':
        status = run(node, [join(PIPELINE, 'tools', 'validate-overrides.mjs')], 'node tools/validate-overrides.mjs');
        if (status !== 0 && dev) {
          say('WARN override validation failed; continuing because --dev builds do not apply overrides');
          note = 'failed (ignored in --dev)';
          status = 0;
        } else if (status === 0 && !dev) {
          // the override engine's own dry run (record ops, assign checks, modern layer):
          // every error it finds would fail the geometry QA 'overrides' gate, so stop
          // here, in seconds, instead of after the geometry step
          status = run(node, [py, 'overrides.py', '--dry-run', '--log', join(PATHS.build, 'override-dry-run.json')], 'py py/overrides.py --dry-run');
          if (status !== 0) note = `override engine errors (see ${rel(join(PATHS.build, 'override-dry-run.json'))})`;
        }
        break;
      case 'geometry':
        if (dev) status = run(node, [join(PIPELINE, 'tools', 'dev-features.mjs')], 'node tools/dev-features.mjs');
        else {
          const script = join(PIPELINE, 'py', 'run_geometry.py');
          if (!existsSync(script)) throw new Error(`${rel(script)} does not exist yet (geometry step); use --dev for the development dataset`);
          status = run(node, [py, script], 'py py/run_geometry.py');
        }
        break;
      case 'package': {
        // the packaging step holds every record's properties and whole chunk topologies: give it room
        const argv = ['--max-old-space-size=16384', join(PIPELINE, 'steps', 'package.mjs'), ...(dev ? ['--dev'] : []), ...(args.verbose ? ['--verbose'] : [])];
        status = run(node, argv, `node steps/package.mjs${dev ? ' --dev' : ''}`);
        break;
      }
      case 'catalog':
        status = run(node, [join(PIPELINE, 'tools', 'catalog.mjs')], 'node tools/catalog.mjs');
        break;
    }
    const secs = (Date.now() - t0) / 1000;
    timings.push({ step, secs, status, note });
    if (status !== 0) {
      summary(timings);
      say(`FAILED at step "${step}" (exit ${status})`);
      process.exit(status);
    }
    say(`✓ ${step} in ${secs.toFixed(1)} s${note ? ` (${note})` : ''}`);
  }
  summary(timings);
}

function summary(timings) {
  say('── summary ' + '─'.repeat(54));
  for (const t of timings) say(`  ${t.step.padEnd(10)} ${t.secs.toFixed(1).padStart(8)} s  ${t.status === 0 ? 'ok' : `exit ${t.status}`}${t.note ? `  (${t.note})` : ''}`);
  say(`  ${'total'.padEnd(10)} ${timings.reduce((s, t) => s + t.secs, 0).toFixed(1).padStart(8)} s`);
}

main().catch((e) => {
  say(`FAILED: ${e.message}`);
  process.exit(1);
});
