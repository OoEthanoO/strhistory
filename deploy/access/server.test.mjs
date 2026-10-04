import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { createAccessServer, safeNext, COOKIE } from './server.mjs';

const code = 'test-only-access-code';
const salt = randomBytes(16).toString('hex');
const config = { origin: 'https://strhistory.ca', salt,
  codeHash: scryptSync(code, salt, 64).toString('hex'), sessionKey: randomBytes(32).toString('hex') };

test('return destinations stay on this website', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/%2fexample.com', '/%5cexample.com', '/%0aLocation:evil', '/access/unlock', '/access?next=/topics', '/%zz', null]) {
    assert.equal(safeNext(value), '/', String(value));
  }
  assert.equal(safeNext('/topics/first-crusade?view=notes#overview'), '/topics/first-crusade?view=notes#overview');
});

test('unlock, reject, expiry, logout, origin, request bounds and throttling', async (t) => {
  let clock = Date.now();
  const server = createAccessServer(config, { now: () => clock });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (url, options = {}) => fetch(base + url, { redirect: 'manual', ...options });
  const form = (value, next = '/topics/first-crusade?from=globe', extras = {}) => ({
    method: 'POST', headers: { Origin: config.origin, 'Content-Type': 'application/x-www-form-urlencoded', ...extras },
    body: new URLSearchParams({ code: value, next }),
  });

  let r = await request('/verify', { headers: { 'X-Forwarded-Uri': '/topics/first-crusade?from=globe', Cookie: `${COOKIE}=true` } });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/access?next=%2Ftopics%2Ffirst-crusade%3Ffrom%3Dglobe');
  assert.match(r.headers.get('cache-control'), /no-store/);
  r = await request('/access/unlock', form('wrong'));
  assert.match(r.headers.get('location'), /error=invalid/);
  assert.equal(r.headers.get('set-cookie'), null);
  r = await request('/access/unlock', form(code, '//evil.test'));
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), '/');
  const cookieHeader = r.headers.get('set-cookie');
  assert.match(cookieHeader, /HttpOnly; Secure; SameSite=Lax; Max-Age=604800/);
  const cookie = cookieHeader.split(';')[0];
  assert.equal((await request('/verify', { headers: { Cookie: cookie } })).status, 204);
  assert.deepEqual(await (await request('/access/session', { headers: { Cookie: cookie } })).json(), { unlocked: true });
  assert.deepEqual(await (await request('/access/session')).json(), { unlocked: false });
  assert.equal((await request('/verify', { headers: { Cookie: cookie + 'x' } })).status, 303);
  assert.equal((await request('/access/unlock')).status, 405);
  assert.equal((await request('/access/unlock', form(code, '/', { Origin: 'https://evil.test' }))).status, 403);
  // Redirect aliases must never become trusted login origins.
  for (const origin of ['https://history.ethanyanxu.com', 'https://www.strhistory.ca', 'http://strhistory.ca']) {
    assert.equal((await request('/access/unlock', form(code, '/', { Origin: origin }))).status, 403);
    assert.equal((await request('/access/logout', form('', '/', { Origin: origin }))).status, 403);
  }
  assert.equal((await request('/access/unlock', { method: 'POST', body: 'code=' + code })).status, 403);
  assert.equal((await request('/access/unlock', form('x'.repeat(5000)))).status, 413);
  assert.equal((await request('/access/unlock', form(code, '/', { 'Content-Type': 'application/json' }))).status, 415);
  r = await request('/access/unlock', form(code));
  assert.equal(r.headers.get('location'), '/topics/first-crusade?from=globe');
  r = await request('/access/logout', form(''));
  assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(r.headers.get('location'), '/globe');
  clock += 8 * 24 * 3600 * 1000;
  assert.equal((await request('/verify', { headers: { Cookie: cookie } })).status, 303);
  for (let i = 0; i < 10; i++) await request('/access/unlock', form('wrong', '/', { 'X-Access-Client': 'test-client' }));
  r = await request('/access/unlock', form(code, '/', { 'X-Access-Client': 'test-client' }));
  assert.match(r.headers.get('location'), /error=limited/);
  assert.ok(Number(r.headers.get('retry-after')) > 0);
  clock += 16 * 60 * 1000;
  assert.equal((await request('/access/unlock', form(code, '/', { 'X-Access-Client': 'test-client' }))).headers.get('location'), '/');
});
