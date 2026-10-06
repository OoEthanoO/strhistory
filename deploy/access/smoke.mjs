// Run against Caddy (staging or production), never astro preview. Code on stdin.
// Usage: <code from secure input> | node deploy/access/smoke.mjs https://strhistory.ca [https://alias.example ...]
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
const base = process.argv[2];
if (!base) throw new Error('Provide the base URL');
const origin = new URL(base).origin;
let code = '';
for await (const chunk of process.stdin) code += chunk;
code = code.trim();
if (!code) throw new Error('Provide the access code on stdin');
const request = (path, options = {}) => fetch(new URL(path, base), { redirect: 'manual', ...options });
const post = (path, value, headers = {}) => request(path, { method: 'POST', headers: {
  Origin: origin, ...headers,
}, body: new URLSearchParams({ code: value, next: '/topics/storming-bastille-1789?from=globe' }) });
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? walk(join(dir, f.name)) : [join(dir, f.name)]);
const protectedPages = walk('dist').filter((f) => f.endsWith('.html')).map((f) => '/' + relative('dist', f).replaceAll('\\', '/'))
  .filter((p) => !['/globe/index.html', '/access/index.html'].includes(p) && !p.startsWith('/admin/'));
for (const path of [...protectedPages, '/', '/topics', '/topics/', '/glossary', '/TOPICS/FIRST-CRUSADE/INDEX.HTML', '/topics%2Ffirst-crusade/index.html', '/globe/../topics/first-crusade/', '/_astro/../topics/first-crusade/', '/topics/first-crusade/index.html?x=.css', '/data/alexs-atlas/../../topics/first-crusade/', '/data/alexs-atlas/chunks/../../../topics/first-crusade/index.html']) {
  const r = await request(path);
  assert.equal(r.status, 303, `locked: ${path}`);
  assert.match(r.headers.get('location'), /^\/access\?next=/);
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.equal(await r.text(), '', `no protected body: ${path}`);
}
console.log(`Protected ${protectedPages.length} built HTML pages plus route aliases.`);
for (const path of ['/globe/', '/access/', '/version.json', '/data/land.geojson', '/data/snapshots/world_1783.geojson', '/glyphs/noto-sans/0-255.pbf']) {
  const r = await request(path);
  assert.equal(r.status, 200, `public: ${path}`);
  await r.arrayBuffer();
}
// Check every bundled asset; none may unexpectedly prompt for a code.
for (const asset of readdirSync('dist/_astro')) {
  const r = await request('/_astro/' + asset, { method: 'HEAD' });
  assert.equal(r.status, 200, `public asset: ${asset}`);
}
// The globe's borders dataset is public too: the manifest revalidated, hashed files immutable.
const atlasFiles = walk('dist/data/alexs-atlas').map((f) => '/' + relative('dist', f).replaceAll('\\', '/'));
for (const path of atlasFiles) {
  const r = await request(path, { method: 'HEAD' });
  assert.equal(r.status, 200, `public dataset file: ${path}`);
  if (path.endsWith('/manifest.json')) assert.match(r.headers.get('cache-control'), /no-cache/);
  else if (/\.[0-9a-f]{8}(\.topo)?\.json$/.test(path)) assert.match(r.headers.get('cache-control'), /immutable/);
}
console.log(`Public: ${atlasFiles.length} borders dataset files.`);
assert.doesNotMatch(await (await request('/sitemap-0.xml')).text(), /\/topics|\/teachers|\/courses/);
let r = await post('/access/unlock', 'wrong-access-code');
assert.match(r.headers.get('location'), /error=invalid/);
assert.equal(r.headers.get('set-cookie'), null);
r = await post('/access/unlock', code);
assert.equal(r.status, 303);
assert.equal(r.headers.get('location'), '/topics/storming-bastille-1789?from=globe');
const cookie = r.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
for (const path of protectedPages) {
  r = await request(path, { headers: { Cookie: cookie } });
  assert.equal(r.status, 200, `unlocked: ${path}`);
  assert.match(r.headers.get('cache-control'), /private, no-store/);
  const html = await r.text();
  assert.match(html, /<!doctype html>/i);
  assert.ok(!html.includes(code), 'code must never appear in delivered HTML');
}
r = await post('/access/logout', '', { Cookie: cookie });
assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
assert.equal((await request('/topics/')).status, 303);
console.log('Public globe/assets, wrong code, unlock, all protected pages, return URL, cache headers and logout passed.');
for (const alias of process.argv.slice(3)) {
  for (const path of ['/globe?year=1789&topic=storming-bastille-1789', '/topics/storming-bastille-1789/', '/access?next=%2Ftopics%2F']) {
    const r = await fetch(new URL(path, alias), { redirect: 'manual' });
    assert.equal(r.status, 308, `permanent redirect: ${alias}${path}`);
    assert.equal(r.headers.get('location'), origin + path, 'redirect retains the full path and query');
  }
  const r = await fetch(new URL('/access/unlock', alias), {
    method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: 'not-a-real-code' }),
  });
  assert.equal(r.status, 303, 'old forms must not forward credentials to another origin');
  assert.equal(r.headers.get('location'), origin + '/access');
  console.log(`Verified redirects from ${alias}.`);
}
