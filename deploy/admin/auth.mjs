import { createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
export const COOKIE = '__Host-history-admin';
const seconds = 8 * 60 * 60;
export function createAuth(config, now = () => Date.now()) {
  if (!/^[a-f0-9]{32}$/.test(config.salt) || !/^[a-f0-9]{128}$/.test(config.codeHash) || !/^[a-f0-9]{64}$/.test(config.sessionKey)) throw new Error('Invalid private admin configuration');
  const sign = (value) => createHmac('sha256', Buffer.from(config.sessionKey, 'hex')).update(value).digest('base64url');
  const equal = (a, b) => { const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb); };
  const attempts = new Map();
  const revoked = new Map();
  let active = 0;
  const read = (req) => req.headers.cookie?.split(';').map((v) => v.trim()).find((v) => v.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  function authenticated(req) {
    const value = read(req);
    if (!value || value.length > 200 || revoked.has(value)) return false;
    const [expiry, nonce, signature, extra] = value.split('.');
    const time = Math.floor(now() / 1000);
    return !extra && /^\d+$/.test(expiry) && /^[a-f0-9]{32}$/.test(nonce ?? '') && Number(expiry) > time && Number(expiry) <= time + seconds && equal(signature ?? '', sign(`${expiry}.${nonce}`));
  }
  const cookie = (token, age = seconds) => `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${age}`;
  return {
    authenticated,
    async login(code, ip) {
      for (const [key, entry] of attempts) if (entry.until <= now()) attempts.delete(key);
      const entry = attempts.get(ip) ?? { count: 0, until: now() + 15 * 60 * 1000 };
      if (entry.count >= 10 || active >= 4 || attempts.size >= 10000) return { error: 'Too many attempts. Try again in 15 minutes.', status: 429 };
      entry.count++; attempts.set(ip, entry);
      if (typeof code !== 'string' || !code || code.length > 128) return { error: 'That admin code was not recognised.', status: 401 };
      active++;
      let hash;
      try { hash = await derive(code, config.salt, 64); } finally { active--; }
      if (!equal(hash.toString('hex'), config.codeHash)) return { error: 'That admin code was not recognised.', status: 401 };
      attempts.delete(ip);
      const value = `${Math.floor(now() / 1000) + seconds}.${randomBytes(16).toString('hex')}`;
      return { cookie: cookie(`${value}.${sign(value)}`) };
    },
    logout(req) {
      for (const [token, expiry] of revoked) if (expiry <= now()) revoked.delete(token);
      if (authenticated(req)) revoked.set(read(req), Number(read(req).split('.')[0]) * 1000);
      return cookie('', 0);
    },
  };
}
