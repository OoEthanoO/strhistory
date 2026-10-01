// Run against Caddy (staging or production), never astro preview. Code on stdin.
// Usage: <code from secure input> | node deploy/access/smoke.mjs https://history.ethanyanxu.com
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
const base = process.argv[2];
if (!base) throw new Error('Provide the base URL');
let code = '';
for await (const chunk of process.stdin) code += chunk;
code = code.trim();
if (!code) throw new Error('Provide the access code on stdin');
const request = (path, options = {}) => fetch(new URL(path, base), { redirect: 'manual', ...options });
const post = (path, value, headers = {}) => request(path, { method: 'POST', headers: {
  Origin: 'https://history.ethanyanxu.com', ...headers,
}, body: new URLSearchParams({ code: value, next: '/topics/storming-bastille-1789?from=globe' }) });
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((f) => f.isDirectory() ? walk(join(dir, f.name)) : [join(dir, f.name)]);
const protectedPages = walk('dist').filter((f) => f.endsWith('.html')).map((f) => '/' + relative('dist', f).replaceAll('\\', '/'))
  .filter((p) => !['/globe/index.html', '/access/index.html'].includes(p));
for (const path of [...protectedPages, '/', '/topics', '/topics/', '/glossary', '/TOPICS/FIRST-CRUSADE/INDEX.HTML', '/topics%2Ffirst-crusade/index.html', '/globe/../topics/first-crusade/', '/_astro/../topics/first-crusade/', '/topics/first-crusade/index.html?x=.css']) {
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
