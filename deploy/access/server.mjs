// Small, loopback-only authentication service. Caddy still serves the Astro build.
// Credentials live outside the checkout and document root; never log request bodies.
import { createServer } from 'node:http';
import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const derive = promisify(scrypt);
export const COOKIE = '__Host-history-access';
const LIFETIME = 7 * 24 * 60 * 60;

export function safeNext(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\s\u0000-\u001f\u007f]/.test(value)) return '/';
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\u0000-\u001f\u007f]/.test(decoded)) return '/';
    const url = new URL(value, 'https://local.invalid');
    if (url.origin !== 'https://local.invalid' || /^\/access(?:\/|$)/i.test(url.pathname)) return '/';
    return url.pathname + url.search + url.hash;
  } catch { return '/'; }
}

function equal(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createAccessServer(config, { now = () => Date.now() } = {}) {
  if (!/^[a-f0-9]{64}$/.test(config.sessionKey) || !/^[a-f0-9]{32}$/.test(config.salt) ||
      !/^[a-f0-9]{128}$/.test(config.codeHash) || !/^https:\/\/[^/]+$/.test(config.origin)) {
    throw new Error('Invalid access configuration');
  }
  const key = Buffer.from(config.sessionKey, 'hex');
  const sign = (payload) => createHmac('sha256', key).update(payload).digest('base64url');
  const attempts = new Map();
  let inflight = 0;
  function authenticated(req) {
    const token = req.headers.cookie?.split(';').map((x) => x.trim()).find((x) => x.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
    if (!token || token.length > 200) return false;
    const [expiry, nonce, signature, extra] = token.split('.');
    if (extra || !/^\d+$/.test(expiry) || !/^[a-f0-9]{32}$/.test(nonce ?? '') || !signature) return false;
    const seconds = Math.floor(now() / 1000);
    if (Number(expiry) <= seconds || Number(expiry) > seconds + LIFETIME) return false;
    return equal(Buffer.from(signature), Buffer.from(sign(`${expiry}.${nonce}`)));
  }
  function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }
  return createServer({ requestTimeout: 10000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const pathname = new URL(req.url, config.origin).pathname;
    const send = (status, message) => { res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end(message); };
    if (pathname === '/health' && req.method === 'GET') return send(200, 'ok');
    if (pathname === '/verify' && req.method === 'GET') {
      if (authenticated(req)) return send(204, '');
      return redirect(res, `/access?next=${encodeURIComponent(safeNext(req.headers['x-forwarded-uri']))}`);
    }
    if (pathname === '/access/session' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ unlocked: authenticated(req) }));
    }
    if (!['/access/unlock', '/access/logout'].includes(pathname)) return send(404, 'Not found');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(405, 'Use the access form.'); }
    // Ordinary same-origin forms include Origin. Reject cross-site posts and login CSRF.
    if (req.headers.origin !== config.origin) return send(403, 'Please use the access form on this website.');
    if (pathname === '/access/logout') {
      res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
      return redirect(res, '/globe');
    }
    if (!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return send(415, 'Use the access form.');
    if (Number(req.headers['content-length']) > 4096) return send(413, 'Form too large');
    try {
      let body = '';
      for await (const chunk of req) {
        body += chunk.toString();
        if (Buffer.byteLength(body) > 4096) { send(413, 'Form too large'); return; }
      }
      const form = new URLSearchParams(body);
      const next = safeNext(form.get('next'));
      const error = (reason) => redirect(res, `/access?error=${reason}&next=${encodeURIComponent(next)}`);
      // Caddy overwrites this header with the socket peer, never a supplied X-Forwarded-For.
      const ip = req.headers['x-access-client'] ?? req.socket.remoteAddress;
      for (const [address, entry] of attempts) if (entry.until <= now()) attempts.delete(address);
      const entry = attempts.get(ip) ?? { count: 0, until: now() + 15 * 60 * 1000 };
      if (entry.count >= 10 || inflight >= 4 || (attempts.size >= 10000 && !attempts.has(ip))) {
        res.setHeader('Retry-After', String(Math.max(1, Math.ceil((entry.until - now()) / 1000))));
        return error('limited');
      }
      entry.count++;
      attempts.set(ip, entry);
      const code = form.get('code') ?? '';
      if (!code || code.length > 128) return error('invalid');
      inflight++;
      let hash;
      try { hash = await derive(code, config.salt, 64); } finally { inflight--; }
      if (!equal(hash, Buffer.from(config.codeHash, 'hex'))) return error('invalid');
      attempts.delete(ip);
      const payload = `${Math.floor(now() / 1000) + LIFETIME}.${randomBytes(16).toString('hex')}`;
      res.setHeader('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${LIFETIME}`);
      redirect(res, next);
    } catch {
      if (!res.headersSent) send(400, 'Unable to read the access form. Please try again.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
  createAccessServer(config).listen(4310, '127.0.0.1', () => console.log('History access service listening on loopback:4310'));
}
