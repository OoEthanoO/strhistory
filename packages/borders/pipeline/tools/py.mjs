#!/usr/bin/env node
// Runs a Python script from pipeline/py or pipeline/tools inside the project's
// virtualenv (.cache/venv), creating it and installing requirements on first use.
//   node packages/borders/pipeline/tools/py.mjs <script.py> [args...]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const venv = join(root, '.cache', 'venv');
const isWin = process.platform === 'win32';
const venvPython = isWin ? join(venv, 'Scripts', 'python.exe') : join(venv, 'bin', 'python');
const requirements = join(here, '..', 'py', 'requirements.txt');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root, ...opts });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

if (!existsSync(venvPython)) {
  const sys = isWin ? 'python' : 'python3';
  console.log(`[py] creating virtualenv at ${venv}`);
  if (run(sys, ['-m', 'venv', venv]) !== 0) process.exit(1);
  if (run(venvPython, ['-m', 'pip', 'install', '--quiet', '--upgrade', 'pip']) !== 0) process.exit(1);
  if (run(venvPython, ['-m', 'pip', 'install', '--quiet', '-r', requirements]) !== 0) process.exit(1);
}

const [script, ...args] = process.argv.slice(2);
if (!script) {
  console.error('usage: py.mjs <script.py> [args...]');
  process.exit(2);
}
const candidates = [resolve(script), join(here, script), join(here, '..', 'py', script)];
const path = candidates.find((p) => existsSync(p));
if (!path) {
  console.error(`[py] script not found: ${script}`);
  process.exit(2);
}
process.exit(run(venvPython, [path, ...args], { env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' } }));
