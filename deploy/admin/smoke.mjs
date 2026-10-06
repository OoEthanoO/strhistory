// Code on stdin. Read-only apart from login/logout; does not save or publish.
import assert from 'node:assert/strict';
const base = process.argv[2];
if (!base) throw new Error('Supply the base URL');
let code = ''; for await (const chunk of process.stdin) code += chunk; code = code.trim();
if (!code) throw new Error('Supply the admin code on stdin');
const get = (path, headers = {}) => fetch(new URL(path, base), { redirect: 'manual', headers });
const post = (path, body, cookie, origin = new URL(base).origin) => fetch(new URL('/admin/api/' + path, base), { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: origin, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
for (const path of ['/admin', '/admin/', '/admin/index.html', '/ADMIN/INDEX.HTML', '/admin%2Findex.html', '/_astro/../admin/index.html']) {
  const response = await get(path);
  assert.equal(response.status, 303, path); assert.equal(response.headers.get('location'), '/admin/login');
  assert.match(response.headers.get('cache-control'), /no-store/);
}
assert.equal((await get('/admin/login/')).status, 200);
for (const path of ['entries', 'entry?collection=topics&slug=charter-oath-1868', 'status']) assert.equal((await get('/admin/api/' + path)).status, 401);
for (const path of ['draft', 'preview', 'publish', 'discard']) assert.equal((await post(path, {}, null)).status, 401);
assert.equal((await post('login', { code: 'incorrect-test-code' })).status, 401);
let response = await post('login', { code }); assert.equal(response.status, 200);
const cookieHeader = response.headers.get('set-cookie'); assert.match(cookieHeader, /Secure; HttpOnly; SameSite=Strict/);
const cookie = cookieHeader.split(';')[0];
response = await get('/admin/', { Cookie: cookie }); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
assert.ok(!(await response.text()).includes(code));
const { entries } = await (await get('/admin/api/entries', { Cookie: cookie })).json(); assert.ok(entries.length > 200);
const item = await (await get('/admin/api/entry?collection=topics&slug=charter-oath-1868', { Cookie: cookie })).json(); assert.ok(item.body.includes('Charter Oath'));
response = await post('preview', item, cookie); assert.equal(response.status, 200); assert.match((await response.json()).html, /Overview/);
assert.equal((await post('draft', item, cookie, 'https://evil.test')).status, 403);
response = await post('logout', {}, cookie); assert.match(response.headers.get('set-cookie'), /Max-Age=0/);
assert.equal((await get('/admin/api/entries', { Cookie: cookie })).status, 401);
assert.equal((await get('/globe/')).status, 200);
console.log('Admin HTML/alias gate, API isolation, login, content reads, preview, CSRF, logout and public globe passed.');
