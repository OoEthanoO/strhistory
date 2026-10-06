import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createAuth } from './auth.mjs';
import { createStore } from './store.mjs';
export function createAdminServer(config, store, { now } = {}) {
  if (!/^https:\/\/[^/]+$/.test(config.origin)) throw new Error('Invalid admin origin');
  const auth = createAuth(config, now);
  let draining = false;
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    const path = new URL(req.url, config.origin).pathname;
    if (path === '/health' && req.method === 'GET') return send(200, { ok: true, busy: store.busy });
    // Only reached over loopback; Caddy exposes /admin/api/*, never /drain.
    if (path === '/drain' && req.method === 'POST') { draining = true; return send(200, { busy: store.busy }); }
    if (path === '/verify' && req.method === 'GET') {
      if (auth.authenticated(req)) { res.writeHead(204); return res.end(); }
      res.writeHead(303, { Location: '/admin/login' }); return res.end();
    }
    if (path === '/admin/api/session' && req.method === 'GET') return send(200, { authenticated: auth.authenticated(req) });
    try {
      const mutation = req.method === 'POST';
      if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed.' });
      if (mutation && req.headers.origin !== config.origin) return send(403, { error: 'Use the admin panel on this website.' });
      if (path !== '/admin/api/login' && !auth.authenticated(req)) return send(401, { error: 'Enter the separate admin code to continue.' });
      if (draining) return send(503, { error: 'The editor is updating. Please retry shortly; your saved drafts are safe.' });
      let input = {};
      if (mutation) {
        if (req.headers['content-type']?.split(';')[0] !== 'application/json') return send(415, { error: 'Send JSON.' });
        const limit = path === '/admin/api/login' ? 4096 : 128 * 1024;
        if (Number(req.headers['content-length']) > limit) return send(413, { error: 'This entry is too large.' });
        let size = 0; const chunks = [];
        for await (const chunk of req) { size += chunk.length; if (size > limit) return send(413, { error: 'This entry is too large.' }); chunks.push(chunk); }
        try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'Invalid JSON.' }); }
        if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { error: 'Invalid request.' });
      }
      if (path === '/admin/api/login' && mutation) {
        const result = await auth.login(input.code, req.headers['x-admin-client'] ?? req.socket.remoteAddress);
        if (result.error) return send(result.status, { error: result.error });
        res.setHeader('Set-Cookie', result.cookie); return send(200, { ok: true });
      }
      if (path === '/admin/api/logout' && mutation) { res.setHeader('Set-Cookie', auth.logout(req)); return send(200, { ok: true }); }
      if (path === '/admin/api/entries' && !mutation) return send(200, { entries: await store.list() });
      if (path === '/admin/api/entry' && !mutation) { const url = new URL(req.url, config.origin); return send(200, await store.read(url.searchParams.get('collection'), url.searchParams.get('slug'))); }
      if (path === '/admin/api/draft' && mutation) return send(200, await store.save(input));
      if (path === '/admin/api/discard' && mutation) return send(200, await store.discard(input.collection, input.slug, input.draftVersion));
      if (path === '/admin/api/preview' && mutation) return send(200, await store.preview(input));
      if (path === '/admin/api/publish' && mutation) return send(202, await store.publish(input.collection, input.slug, input.draftVersion));
      if (path === '/admin/api/status' && !mutation) {
        let live = null;
        try { live = JSON.parse(await readFile(join(config.siteRoot, 'current/version.json'), 'utf8')).commit; } catch { /* Deployment might be switching releases. */ }
        return send(200, { job: store.status(), live });
      }
      return send(404, { error: 'Not found.' });
    } catch (e) {
      // Content errors are actionable, but never expose process configuration/credentials.
      return send(e.status ?? 400, { error: e.code ? 'The server could not complete the operation. Your saved draft is safe; try again shortly.' : String(e.message).slice(0, 1500) });
    }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const config = JSON.parse((await readFile(process.argv[2], 'utf8')).replace(/^\uFEFF/, ''));
  const store = await createStore(config);
  createAdminServer(config, store).listen(4311, '127.0.0.1', () => console.log('Teacher editor listening on loopback:4311'));
}
