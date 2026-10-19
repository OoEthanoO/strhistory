import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccessServer, safeNext, COOKIE } from './server.mjs';
import { advance, createDailyRotation, schoolDay } from './daily.mjs';

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

const day = 24 * 60 * 60 * 1000;

test('daily puzzles follow the school calendar in Toronto, through daylight saving time', () => {
  assert.equal(schoolDay(Date.parse('2026-10-19T03:59:00Z')), '2026-10-18');
  assert.equal(schoolDay(Date.parse('2026-10-19T04:00:00Z')), '2026-10-19');
  assert.equal(schoolDay(Date.parse('2026-12-01T04:59:00Z')), '2026-11-30');
  assert.equal(schoolDay(Date.parse('2026-12-01T05:00:00Z')), '2026-12-01');
});

test('a daily puzzle moves on only after a day on which someone opened it', () => {
  let state = advance({ number: 0, viewed: null }, '2026-10-19');
  assert.deepEqual(state, { number: 0, viewed: '2026-10-19' });
  assert.equal(advance(state, '2026-10-19'), state);
  state = advance(state, '2026-10-20');
  assert.deepEqual(state, { number: 1, viewed: '2026-10-20' });
  // The 21st brings puzzle 2. Nobody opens it that day or the next, so it waits for the 23rd.
  state = advance(state, '2026-10-23');
  assert.deepEqual(state, { number: 2, viewed: '2026-10-23' });
  assert.deepEqual(advance(state, '2026-10-22'), { number: 2, viewed: '2026-10-22' }, 'a clock set back');
});

test('the daily position survives restarts and ignores damaged state', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'history-daily-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'access-data', 'connections.json');
  let clock = Date.parse('2026-10-19T15:00:00Z');
  const logs = [];
  const options = { now: () => clock, log: (message) => logs.push(message) };
  assert.deepEqual(createDailyRotation(file, options).view(), { number: 0, date: '2026-10-19' });
  clock += day;
  assert.deepEqual(createDailyRotation(file, options).view(), { number: 1, date: '2026-10-20' });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { number: 1, viewed: '2026-10-20' });
  assert.deepEqual(logs, []);
  for (const damaged of ['{"number":-1,"viewed":null}', '{"number":2,"viewed":"tomorrow"}', 'not json']) {
    writeFileSync(file, damaged);
    assert.equal(createDailyRotation(file, options).view().number, 0, damaged);
  }
  assert.equal(logs.length, 3);
});

test('the daily puzzle needs a session, and only a GET counts as the day’s view', async (t) => {
  let clock = Date.parse('2026-10-19T15:00:00Z');
  const now = () => clock;
  const server = createAccessServer(config, { now, connections: createDailyRotation(null, { now }) });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const today = (options = {}) => fetch(base + '/games/api/connections/today', options);
  let r = await today();
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { error: 'locked' });
  assert.match(r.headers.get('cache-control'), /no-store/);
  r = await fetch(base + '/access/unlock', { method: 'POST', redirect: 'manual', headers: {
    Origin: config.origin, 'Content-Type': 'application/x-www-form-urlencoded',
  }, body: new URLSearchParams({ code, next: '/games/connections' }) });
  const headers = { Cookie: r.headers.get('set-cookie').split(';')[0] };
  assert.equal((await today({ method: 'HEAD', headers })).status, 200);
  r = await today({ headers });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('cache-control'), /private, no-store/);
  assert.deepEqual(await r.json(), { number: 0, date: '2026-10-19' });
  // A HEAD check is not a view: had it counted on the 20th, the 21st would bring puzzle 2.
  clock += day;
  assert.equal((await today({ method: 'HEAD', headers })).status, 200);
  clock += day;
  assert.deepEqual(await (await today({ headers })).json(), { number: 1, date: '2026-10-21' });
  assert.equal((await today({ method: 'POST', headers })).status, 405);
  assert.equal((await today({ headers: { Cookie: headers.Cookie + 'x' } })).status, 401);
});
