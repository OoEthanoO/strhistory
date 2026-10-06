import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, readdir, rename, unlink, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { collections } from './collections.mjs';
import { contentPath, createContentTools } from './content.mjs';
const exec = promisify(execFile);
const hash = (value) => createHash('sha256').update(value).digest('hex');
export class EditorError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
async function readOrNull(file) { try { return await readFile(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function atomicJson(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; await writeFile(temp, JSON.stringify(value)); await rename(temp, file); }

export async function createStore(config, { runChecks, git: testGit } = {}) {
  const repo = resolve(config.repo);
  if (!await readOrNull(join(repo, '.teacher-authoring'))) throw new Error('Admin must use a dedicated, marked authoring checkout.');
  const tools = await createContentTools(repo);
  const drafts = join(config.data, 'drafts');
  await mkdir(drafts, { recursive: true });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (config.sshKey) env.GIT_SSH_COMMAND = `ssh -i "${config.sshKey.replaceAll('\\', '/')}" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="${config.knownHosts.replaceAll('\\', '/')}"`;
  const git = testGit ?? (async (...args) => (await exec(config.git ?? 'git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, '-C', repo, ...args], { env, windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 })).stdout.trim());
  let busy = false;
  let job = JSON.parse(await readOrNull(join(config.data, 'job.json')) ?? 'null');
  if (job && !['published', 'failed'].includes(job.phase)) { job.phase = 'failed'; job.message = 'The service restarted. Your draft is saved. Check the live entry, then publish again if needed.'; }
  async function exclusive(fn) { if (busy) throw new EditorError('Another content operation is in progress. Please try again shortly.', 409); busy = true; try { return await fn(); } finally { busy = false; } }
  async function refresh() { await git('fetch', '--quiet', 'origin', 'main'); await git('reset', '--hard', 'origin/main'); }
  function draftPath(collection, slug) { contentPath(collection, slug); return join(drafts, `${collection}.${slug}.json`); }
  async function source(collection, slug) {
    const path = join(repo, contentPath(collection, slug));
    const stat = await lstat(path).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    if (stat?.isSymbolicLink() || (stat && !stat.isFile())) throw new EditorError('This content path is not an editable file.');
    return (await readOrNull(path))?.replace(/\r\n/g, '\n') ?? null;
  }
  async function getDraft(collection, slug) { return JSON.parse(await readOrNull(draftPath(collection, slug)) ?? 'null'); }
  async function entry(collection, slug) {
    const text = await source(collection, slug);
    const saved = await getDraft(collection, slug);
    if (saved) return { ...saved, hasDraft: true, changedUpstream: (text === null ? null : hash(text)) !== saved.revision };
    if (text === null) throw new EditorError('Entry not found.', 404);
    return { collection, slug, ...tools.parse(text), revision: hash(text), draftVersion: null, hasDraft: false };
  }
  async function save(input) {
    const { collection, slug, fields, body, revision, draftVersion } = input;
    contentPath(collection, slug);
    if (revision !== null && !/^[a-f0-9]{64}$/.test(revision)) throw new EditorError('Load this entry again before saving.');
    const old = await getDraft(collection, slug);
    if ((old?.draftVersion ?? null) !== draftVersion) throw new EditorError('Another teacher changed this draft. Reload the saved version before editing further.', 409);
    if (old && old.revision !== revision) throw new EditorError('The source revision does not match this draft.', 409);
    const text = await source(collection, slug);
    if (!old && (text === null ? null : hash(text)) !== revision) throw new EditorError('This entry changed since you opened it. Reload before saving.', 409);
    await tools.validate(collection, fields, body);
    const saved = { collection, slug, fields, body, revision, draftVersion: randomUUID(), savedAt: new Date().toISOString() };
    await atomicJson(draftPath(collection, slug), saved);
    return { ...saved, hasDraft: true };
  }
  async function state(phase, message, extra = {}) {
    job = { ...job, phase, message, ...extra, updatedAt: new Date().toISOString() };
    await atomicJson(join(config.data, 'job.json'), job);
  }
  async function check() {
    if (runChecks) return runChecks(repo);
    const node = config.node ?? process.execPath;
    // npm-cli.js avoids cmd.exe quoting; arguments never contain submitted text.
    const npm = config.npmCli;
    const stamp = join(repo, 'node_modules', '.admin-lock-hash');
    const lock = hash(await readFile(join(repo, 'package-lock.json')));
    const run = (args) => exec(node, [npm, ...args], { cwd: repo, env: { ...env, CI: 'true', ASTRO_TELEMETRY_DISABLED: '1', GIT_SHA: 'teacher-preview' }, windowsHide: true, timeout: 240000, maxBuffer: 4 * 1024 * 1024 });
    if ((await readOrNull(stamp)) !== lock) { await run(['ci', '--no-audit', '--no-fund']); await writeFile(stamp, lock); }
    await run(['run', 'check']);
    await run(['run', 'build']);
  }
  return {
    get busy() { return busy; },
    status: () => job,
    async list() { return exclusive(async () => {
      await refresh();
      const entries = [];
      for (const [collection, spec] of Object.entries(collections)) {
        const names = new Set((await readdir(join(repo, 'src/content', collection))).filter((name) => name.endsWith('.' + spec.extension) && !name.startsWith('_')).map((name) => name.slice(0, -spec.extension.length - 1)));
        for (const name of await readdir(drafts)) if (name.startsWith(collection + '.') && name.endsWith('.json')) names.add(name.slice(collection.length + 1, -5));
        for (const slug of names) {
          const item = await entry(collection, slug);
          entries.push({ collection, slug, title: item.fields.title ?? item.fields.name ?? item.fields.term ?? slug, hasDraft: item.hasDraft, unpublished: item.fields.draft === true, savedAt: item.savedAt });
        }
      }
      return entries.sort((a, b) => a.title.localeCompare(b.title));
    }); },
    read: (collection, slug) => exclusive(async () => { await refresh(); return entry(collection, slug); }),
    save: (input) => exclusive(() => save(input)),
    discard: (collection, slug, version) => exclusive(async () => {
      const saved = await getDraft(collection, slug);
      if (!saved || saved.draftVersion !== version) throw new EditorError('This draft changed. Reload it before discarding.', 409);
      await unlink(draftPath(collection, slug));
      return { ok: true };
    }),
    async preview(input) { return exclusive(async () => {
      contentPath(input.collection, input.slug);
      const tree = await tools.validate(input.collection, input.fields, input.body);
      const glossary = {};
      for (const name of await readdir(join(repo, 'src/content/glossary'))) if (name.endsWith('.md') && !name.startsWith('_')) {
        const term = await entry('glossary', name.slice(0, -3)); glossary[name.slice(0, -3)] = term.fields;
      }
      return { html: tools.preview(tree, glossary) };
    }); },
    async publish(collection, slug, version) {
      if (busy) throw new EditorError('Another operation is in progress.', 409);
      contentPath(collection, slug);
      busy = true;
      try {
        const saved = await getDraft(collection, slug);
        if (!saved || saved.draftVersion !== version) throw new EditorError('Save your latest changes before publishing.', 409);
        job = { id: randomUUID(), collection, slug, startedAt: new Date().toISOString() };
        await state('validating', 'Checking content and building a preview…');
        // Finish asynchronously so the browser can show status and survive navigation.
        void (async () => {
          try {
            await refresh();
            const text = await source(collection, slug);
            if ((text === null ? null : hash(text)) !== saved.revision) throw new EditorError('The published entry changed. Discard this draft and reload the current entry, then reapply your changes.');
            await tools.validate(collection, saved.fields, saved.body);
            const path = contentPath(collection, slug);
            const candidate = tools.serialize(saved.fields, saved.body);
            if (candidate === text) throw new EditorError('There are no changes to publish.');
            await writeFile(join(repo, path), candidate);
            await check();
            await state('publishing', 'Checks passed. Publishing the change…');
            await git('add', '--', path);
            await git('-c', 'user.name=STR History teachers', '-c', 'user.email=teachers@strhistory.ca', 'commit', '-m', `Update ${collection}/${slug} from teacher editor`, '--', path);
            const sha = await git('rev-parse', 'HEAD');
            // Never force or silently rebase: competing updates require another check.
            await git('push', 'origin', 'HEAD:main');
            await state('published', 'Published. The live site will update after deployment, usually within a minute.', { sha });
            await unlink(draftPath(collection, slug));
          } catch (error) {
            const detail = String(error.stdout || error.stderr || error.message).replace(/\x1b\[[0-9;]*m/g, '').slice(-14000);
            await state('failed', 'Publishing did not complete. Your draft is saved; review the details and try again.', { detail });
          } finally {
            // Only this marked scratch checkout is reset; drafts live elsewhere.
            await git('reset', '--hard', 'origin/main').catch(() => {});
            // A new entry that failed before `git add` is still untracked.
            // Remove just that candidate, never other files or saved drafts.
            const path = contentPath(collection, slug);
            if (saved.revision === null && await git('ls-tree', '--name-only', 'origin/main', '--', path).then((s) => !s).catch(() => false)) {
              await unlink(join(repo, path)).catch(() => {});
            }
            busy = false;
          }
        })();
        return job;
      } catch (e) { busy = false; throw e; }
    },
  };
}
