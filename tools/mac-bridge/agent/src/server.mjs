import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from './sessions.mjs';
import { acceptUpgrade } from './ws.mjs';
import { loadOrCreateToken, tokenMatches, bearerFrom } from './token.mjs';

export const VERSION = '1';

export function defaultPaths(home = os.homedir()) {
  return {
    claudeDir: path.join(home, '.claude', 'projects'),
    codexDir: path.join(home, '.codex', 'sessions'),
    tokenFile: path.join(home, '.mac-bridge', 'token'),
  };
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
  });
  res.end(data);
}

export function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return '127.0.0.1';
}

export function pairingLink({ host, port, token, name }) {
  return `macbridge://pair?host=${encodeURIComponent(host)}&port=${port}&token=${token}&name=${encodeURIComponent(name)}`;
}

/**
 * Build the bridge. Nothing listens until start().
 * opts: claudeDir, codexDir, tokenFile, port, host, hostname, pollMs, watch
 */
export function createBridge(opts = {}) {
  const paths = { ...defaultPaths(), ...opts };
  const hostname = opts.hostname || os.hostname();
  const token = opts.token || loadOrCreateToken(paths.tokenFile);
  const store = new SessionStore({
    claudeDir: paths.claudeDir,
    codexDir: paths.codexDir,
    pollMs: opts.pollMs ?? 2000,
    watch: opts.watch ?? true,
  });
  const clients = new Set();

  const authed = (req) => tokenMatches(bearerFrom(req), token);

  async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/v1/')) return sendJson(res, 404, { error: 'not_found' });
    if (!authed(req)) return sendJson(res, 401, { error: 'unauthorized' });
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'method_not_allowed' });

    if (url.pathname === '/v1/health') {
      return sendJson(res, 200, { ok: true, name: hostname, version: VERSION });
    }
    if (url.pathname === '/v1/sessions') {
      return sendJson(res, 200, { sessions: await store.list() });
    }
    const m = url.pathname.match(/^\/v1\/sessions\/(claude|codex)\/([^/]+)\/events$/);
    if (m) {
      let id;
      try {
        id = decodeURIComponent(m[2]);
      } catch {
        return sendJson(res, 404, { error: 'not_found' });
      }
      const rec = store.get(m[1], id);
      if (!rec) return sendJson(res, 404, { error: 'not_found' });
      const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
      let limit = parseInt(url.searchParams.get('limit') || '200', 10);
      if (!Number.isFinite(limit) || limit < 1) limit = 200;
      limit = Math.min(limit, 500);
      return sendJson(res, 200, { events: await store.events(rec, after, limit) });
    }
    return sendJson(res, 404, { error: 'not_found' });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) sendJson(res, 500, { error: 'internal' });
      else res.destroy();
    });
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/v1/stream') {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    if (!tokenMatches(url.searchParams.get('token') || '', token)) {
      const body = '{"error":"unauthorized"}';
      socket.end(
        `HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      );
      return;
    }
    const ws = acceptUpgrade(req, socket, opts.ws);
    if (!ws) return;
    const client = { ws, subs: new Set() };
    clients.add(client);
    ws.on('close', () => clients.delete(client));
    ws.on('message', async (text) => {
      let msg;
      try {
        msg = JSON.parse(text);
      } catch {
        return;
      }
      if (!msg || (msg.type !== 'subscribe' && msg.type !== 'unsubscribe')) return;
      if (typeof msg.tool !== 'string' || typeof msg.sessionId !== 'string') return;
      const key = store.key(msg.tool, msg.sessionId);
      if (msg.type === 'unsubscribe') {
        client.subs.delete(key);
        return;
      }
      const rec = store.get(msg.tool, msg.sessionId);
      if (!rec) return;
      try {
        await store.ensureCurrent(rec); // so only bytes written after this point stream out
      } catch {}
      client.subs.add(key);
    });
    ws.send(JSON.stringify({ type: 'hello', name: hostname, version: VERSION }));
  });

  store.on('session', (session) => {
    const msg = JSON.stringify({ type: 'session', session });
    for (const c of clients) c.ws.send(msg);
  });
  store.on('events', ({ tool, sessionId, events }) => {
    const key = store.key(tool, sessionId);
    for (const c of clients) {
      if (!c.subs.has(key)) continue;
      for (const event of events) c.ws.send(JSON.stringify({ type: 'event', tool, sessionId, event }));
    }
  });

  return {
    token,
    hostname,
    store,
    server,
    get port() {
      return server.address()?.port;
    },
    async start() {
      await store.start();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(opts.port ?? 7878, opts.host ?? '0.0.0.0', () => {
          server.off('error', reject);
          resolve();
        });
      });
      return server.address().port;
    },
    async stop() {
      store.stop();
      for (const c of clients) c.ws.close(1001);
      clients.clear();
      await new Promise((r) => {
        server.close(() => r());
        server.closeAllConnections?.();
      });
    },
  };
}
