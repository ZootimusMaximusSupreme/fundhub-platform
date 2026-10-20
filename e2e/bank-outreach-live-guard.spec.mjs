import { test, expect } from '@playwright/test';
import http from 'node:http';
import { forwardCheckedRoute } from '../scripts/outreach/verify-live.mjs';

const PASSWORD = 'controlled-offline-password';
const LOGIN_BODY = JSON.stringify({ email: 'e2e+aff-redirect-guard@example.test', password: PASSWORD });
const RESPONSE_BYTES = [0, 1, 2, 127, 128, 255];

async function localServer(handler) {
  const server = http.createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.writeHead(500);
      response.end('Controlled fixture failed');
    });
  });
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
  } catch (error) {
    server.closeAllConnections();
    server.close();
    throw error;
  }
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    async close() {
      const closed = new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      await closed;
    },
  };
}

async function bodyOf(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

test('live proof forwarding blocks real GET and login redirects while preserving ordinary responses', async ({ browser }) => {
  const firstHops = [], trapHops = [];
  let source;
  const trap = await localServer(async (request, response) => {
    const body = await bodyOf(request);
    response.setHeader('Access-Control-Allow-Origin', request.headers.origin === 'null' ? 'null' : source.origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'content-type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    trapHops.push({ path: request.url, method: request.method, body });
    response.writeHead(200, { 'content-type': 'text/plain' });
    response.end('Controlled redirect trap');
  });
  try {
    source = await localServer(async (request, response) => {
      if (request.url === '/start') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<!doctype html><title>Offline request guard</title>');
        return;
      }
      firstHops.push({ path: request.url, method: request.method, body: await bodyOf(request), contentType: request.headers['content-type'] });
      if (request.url === '/ok') {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'x-controlled-response': 'unchanged', 'set-cookie': 'guard_session=controlled; Path=/; HttpOnly; SameSite=Lax' });
        response.end(Buffer.from(RESPONSE_BYTES));
        return;
      }
      const status = request.url === '/read-redirect' ? 302 : Number(request.url.slice('/login-redirect-'.length));
      response.writeHead(status, { location: trap.origin + request.url });
      response.end();
    });

    for (const guarded of [false, true]) {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const state = { routeGuardFailures: 0, firstRouteFailure: null };
      const decisions = [];
      try {
        await context.route('**/*', async route => {
          // Only the first local origin is approved. Redirects must never bypass
          // this policy, even though Playwright continues them automatically.
          if (new URL(route.request().url()).origin !== source.origin) return route.abort('blockedbyclient');
          if (guarded) {
            decisions.push(await forwardCheckedRoute(route, state));
            return;
          }
          return route.continue();
        });
        const page = await context.newPage();
        await page.goto(source.origin + '/start');
        for (const [path, method] of [['/read-redirect', 'GET'], ['/login-redirect-307', 'POST'], ['/login-redirect-308', 'POST']]) {
          const beforeTrap = trapHops.length, beforeSource = firstHops.length;
          const result = await page.evaluate(async ({ path, method, body }) => {
            try {
              const response = await fetch(path, {
                method, credentials: 'include', signal: AbortSignal.timeout(5000),
                ...(method === 'POST' ? { headers: { 'content-type': 'application/json' }, body } : {}),
              });
              return { ok: true, status: response.status, body: await response.text() };
            } catch { return { ok: false }; }
          }, { path, method, body: LOGIN_BODY });
          expect(firstHops.slice(beforeSource)).toEqual([{
            path, method, body: method === 'POST' ? LOGIN_BODY : '',
            contentType: method === 'POST' ? 'application/json' : undefined,
          }]);
          if (guarded) {
            expect(result).toEqual({ ok: false });
            expect(trapHops.length).toBe(beforeTrap);
          } else {
            expect(result).toEqual({ ok: true, status: 200, body: 'Controlled redirect trap' });
            expect(trapHops.slice(beforeTrap)).toEqual([{ path, method, body: method === 'POST' ? LOGIN_BODY : '' }]);
          }
        }
        if (guarded) {
          expect(state).toEqual({ routeGuardFailures: 3, firstRouteFailure: 'REQUEST_REDIRECT_BLOCKED' });
          expect(decisions.filter(value => value === false)).toHaveLength(3);
          const result = await page.evaluate(async () => {
            const response = await fetch('/ok', { credentials: 'include', signal: AbortSignal.timeout(5000) });
            return { status: response.status, header: response.headers.get('x-controlled-response'), bytes: [...new Uint8Array(await response.arrayBuffer())] };
          });
          expect(result).toEqual({ status: 200, header: 'unchanged', bytes: RESPONSE_BYTES });
          expect((await context.cookies(source.origin)).filter(cookie => cookie.name === 'guard_session')).toMatchObject([{ value: 'controlled', httpOnly: true, sameSite: 'Lax' }]);
          expect(state.routeGuardFailures).toBe(3);
          expect(decisions.filter(value => value === true)).toHaveLength(2);
        }
      } finally { await context.close(); }
    }
    expect(trapHops).toHaveLength(3);
    expect(firstHops).toHaveLength(7);
  } finally {
    try { if (source) await source.close(); } finally { await trap.close(); }
  }
});
