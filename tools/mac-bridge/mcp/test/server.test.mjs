// Tests for the Mac Bridge MCP server. They run the real server.mjs as a child
// process over stdio and point it at a FAKE helper on a random port. They never
// touch the real helper on 7878 or the real ~/.mac-bridge/token.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const SERVER = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.mjs');
const TOKEN = 'a'.repeat(64);

let tmp, tokenFile, helper, helperPort, deadPort;
const seen = []; // requests the fake helper received
const tasks = [];
const children = new Set(); // every server we start; killed in after() so a failed test never hangs the run

function fakeHelper() {
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      const send = (status, obj) => {
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: 'unauthorized' });
      const url = new URL(req.url, 'http://x');
      if (req.method === 'GET' && url.pathname === '/v1/sessions') {
        return send(200, {
          sessions: [
            { id: 's-claude-1', tool: 'claude', project: 'fundhub-platform', title: 'fix the page', updatedAt: '2026-10-20T10:00:00Z', live: true, eventCount: 3 },
            { id: 's-codex-1', tool: 'codex', project: 'fundhub-platform', title: 'build the job', updatedAt: '2026-10-20T09:00:00Z', live: false, eventCount: 9 },
          ],
        });
      }
      const ev = url.pathname.match(/^\/v1\/sessions\/(claude|codex)\/([^/]+)\/events$/);
      if (req.method === 'GET' && ev) {
        if (ev[2] !== 's-claude-1') return send(404, { error: 'not_found' });
        const after = Number(url.searchParams.get('after') || 0);
        const all = [
          { seq: 1, ts: '2026-10-20T10:00:00Z', kind: 'user', text: 'fix the page' },
          { seq: 2, ts: '2026-10-20T10:00:01Z', kind: 'command', text: 'ls', command: 'ls' },
          { seq: 3, ts: '2026-10-20T10:00:02Z', kind: 'output', text: 'a b', exitCode: 0 },
        ];
        return send(200, { events: all.filter((e) => e.seq > after).slice(0, Number(url.searchParams.get('limit') || 200)) });
      }
      if (url.pathname === '/v1/tasks' && req.method === 'GET') return send(200, { tasks });
      if (url.pathname === '/v1/tasks' && req.method === 'POST') {
        const b = JSON.parse(body);
        if (b.tool === 'cursor') return send(400, { error: 'bad_tool' });
        if (b.prompt === 'make it busy') return send(429, { error: 'busy' });
        const task = {
          id: `t-${tasks.length + 1}`,
          tool: b.tool === 'auto' ? 'claude' : b.tool,
          pickedBy: b.tool === 'auto' ? 'rules' : 'you',
          pickReason: b.tool === 'auto' ? 'No rule decides, so Claude.' : 'You picked it.',
          prompt: b.prompt.slice(0, 200),
          status: 'starting',
          sessionId: b.resumeSessionId || null,
          startedAt: '2026-10-20T10:01:00Z',
          endedAt: null,
          exitCode: null,
          error: null,
        };
        tasks.unshift(task);
        return send(202, { task });
      }
      const stop = url.pathname.match(/^\/v1\/tasks\/([^/]+)\/stop$/);
      if (stop && req.method === 'POST') {
        const t = tasks.find((x) => x.id === stop[1]);
        if (!t) return send(404, { error: 'not_found' });
        t.status = 'stopped';
        return send(200, { task: t });
      }
      send(404, { error: 'not_found' });
    });
  });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-mcp-'));
  tokenFile = path.join(tmp, 'token');
  fs.writeFileSync(tokenFile, TOKEN + '\n', { mode: 0o600 });
  helper = fakeHelper();
  await new Promise((r) => helper.listen(0, '127.0.0.1', r));
  helperPort = helper.address().port;
  // A port with nothing on it: open, read the number, close.
  const s = http.createServer();
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  deadPort = s.address().port;
  await new Promise((r) => s.close(r));
});

after(async () => {
  for (const ch of children) if (ch.exitCode === null) ch.kill('SIGKILL');
  helper.closeAllConnections();
  await new Promise((r) => helper.close(r));
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Start server.mjs with the given port and token file. Returns a tiny client. */
function startServer({ port = helperPort, token = tokenFile } = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, MAC_BRIDGE_PORT: String(port), MAC_BRIDGE_TOKEN_FILE: token, HOME: tmp },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.add(child);
  const lines = [];
  const waiters = [];
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    lines.push(line);
    const msg = JSON.parse(line); // every stdout line MUST be JSON
    const i = waiters.findIndex((w) => w.id === msg.id);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
  });
  let nextId = 1;
  return {
    child,
    lines,
    stderr: () => stderr,
    send(obj) {
      child.stdin.write(JSON.stringify(obj) + '\n');
    },
    request(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 5000);
        waiters.push({ id, resolve: (m) => (clearTimeout(timer), resolve(m)) });
        this.send({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
      });
    },
    async init() {
      const r = await this.request('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'test', version: '0' },
      });
      this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return r;
    },
    call(name, args) {
      return this.request('tools/call', { name, arguments: args });
    },
    async close() {
      child.stdin.end();
      await new Promise((r) => (child.exitCode !== null ? r() : child.on('exit', r)));
    },
  };
}

test('initialize handshake, ping, notifications get no answer', async () => {
  const c = startServer();
  const r = await c.init();
  assert.equal(r.jsonrpc, '2.0');
  assert.equal(r.result.protocolVersion, '2025-06-18');
  assert.deepEqual(r.result.serverInfo, { name: 'mac-bridge', version: '1.0.0' });
  assert.ok(r.result.capabilities.tools);
  const p = await c.request('ping');
  assert.deepEqual(p.result, {});
  // an unknown protocol version gets our newest one
  const r2 = await c.request('initialize', { protocolVersion: '1999-01-01', capabilities: {} });
  assert.equal(r2.result.protocolVersion, '2025-11-25');
  const bad = await c.request('no/such/method');
  assert.equal(bad.error.code, -32601);
  await c.close();
  // ping + 2 initialize + 1 error = 4 answers; the initialized notification got none
  assert.equal(c.lines.length, 4);
});

test('tools/list names the five tools with schemas', async () => {
  const c = startServer();
  await c.init();
  const r = await c.request('tools/list');
  const names = r.result.tools.map((t) => t.name);
  assert.deepEqual(names, ['list_sessions', 'read_session', 'delegate_task', 'list_tasks', 'stop_task']);
  for (const t of r.result.tools) assert.equal(t.inputSchema.type, 'object');
  const del = r.result.tools.find((t) => t.name === 'delegate_task');
  assert.deepEqual(del.inputSchema.properties.tool.enum, ['claude', 'codex', 'cursor', 'auto']);
  assert.deepEqual(del.inputSchema.required, ['tool', 'prompt']);
  await c.close();
});

test('list_sessions returns sessions and sends the bearer token', async () => {
  const c = startServer();
  await c.init();
  seen.length = 0;
  const r = await c.call('list_sessions', {});
  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.sessions.length, 2);
  assert.match(r.result.content[0].text, /2 session\(s\) shown, 2 on the Mac/);
  assert.equal(seen[0].auth, `Bearer ${TOKEN}`);
  const only = await c.call('list_sessions', { tool: 'codex' });
  assert.deepEqual(only.result.structuredContent.sessions.map((s) => s.id), ['s-codex-1']);
  await c.close();
});

test('read_session passes after/limit and reports the last seq', async () => {
  const c = startServer();
  await c.init();
  seen.length = 0;
  const r = await c.call('read_session', { tool: 'claude', id: 's-claude-1', after: 1, limit: 50 });
  assert.equal(r.result.isError, false);
  assert.deepEqual(r.result.structuredContent.events.map((e) => e.seq), [2, 3]);
  assert.equal(r.result.structuredContent.lastSeq, 3);
  assert.equal(seen[0].url, '/v1/sessions/claude/s-claude-1/events?after=1&limit=50');
  const missing = await c.call('read_session', { tool: 'claude', id: 'nope' });
  assert.equal(missing.result.isError, true);
  assert.match(missing.result.content[0].text, /No session with that tool and id/);
  const noId = await c.call('read_session', { tool: 'claude' });
  assert.equal(noId.result.isError, true);
  assert.match(noId.result.content[0].text, /Missing "id"/);
  await c.close();
});

test('delegate_task starts a task, passes resumeSessionId, explains auto', async () => {
  const c = startServer();
  await c.init();
  seen.length = 0;
  const r = await c.call('delegate_task', { tool: 'codex', prompt: 'build the job', resumeSessionId: 's-codex-1' });
  assert.equal(r.result.isError, false);
  assert.equal(r.result.structuredContent.task.tool, 'codex');
  assert.deepEqual(JSON.parse(seen[0].body), { tool: 'codex', prompt: 'build the job', resumeSessionId: 's-codex-1' });
  assert.match(r.result.content[0].text, /read_session tool=codex id=s-codex-1/);
  const auto = await c.call('delegate_task', { tool: 'auto', prompt: 'something' });
  assert.match(auto.result.content[0].text, /started with Claude .*No rule decides/);
  const cur = await c.call('delegate_task', { tool: 'cursor', prompt: 'x' });
  assert.equal(cur.result.isError, true);
  assert.match(cur.result.content[0].text, /older version that cannot run Cursor tasks/);
  const busy = await c.call('delegate_task', { tool: 'claude', prompt: 'make it busy' });
  assert.equal(busy.result.isError, true);
  assert.match(busy.result.content[0].text, /3 tasks are already running/);
  const badTool = await c.call('delegate_task', { tool: 'grok', prompt: 'x' });
  assert.equal(badTool.result.isError, true);
  assert.match(badTool.result.content[0].text, /must be one of/);
  await c.close();
});

test('list_tasks and stop_task', async () => {
  const c = startServer();
  await c.init();
  const started = await c.call('delegate_task', { tool: 'claude', prompt: 'stop me' });
  const id = started.result.structuredContent.task.id;
  const list = await c.call('list_tasks', {});
  assert.equal(list.result.isError, false);
  assert.ok(list.result.structuredContent.tasks.some((t) => t.id === id));
  const stop = await c.call('stop_task', { id });
  assert.equal(stop.result.isError, false);
  assert.equal(stop.result.structuredContent.task.status, 'stopped');
  const none = await c.call('stop_task', { id: 'no-such-task' });
  assert.equal(none.result.isError, true);
  assert.match(none.result.content[0].text, /No task with that id/);
  await c.close();
});

test('helper down gives a plain-words tool error, not a crash', async () => {
  const c = startServer({ port: deadPort });
  await c.init();
  for (const [name, args] of [
    ['list_sessions', {}],
    ['read_session', { tool: 'codex', id: 'x' }],
    ['delegate_task', { tool: 'claude', prompt: 'x' }],
    ['list_tasks', {}],
    ['stop_task', { id: 'x' }],
  ]) {
    const r = await c.call(name, args);
    assert.equal(r.result.isError, true, name);
    assert.equal(
      r.result.content[0].text,
      'Mac Bridge helper is not running — start it with node tools/mac-bridge/agent/bin/mac-bridge.mjs',
      name,
    );
  }
  // still alive after the errors
  assert.deepEqual((await c.request('ping')).result, {});
  await c.close();
});

test('missing token file and wrong token give plain words', async () => {
  const c = startServer({ token: path.join(tmp, 'no-such-token') });
  await c.init();
  const r = await c.call('list_sessions', {});
  assert.equal(r.result.isError, true);
  assert.match(r.result.content[0].text, /No Mac Bridge token at .*no-such-token/);
  await c.close();

  const wrong = path.join(tmp, 'wrong-token');
  fs.writeFileSync(wrong, 'b'.repeat(64));
  const c2 = startServer({ token: wrong });
  await c2.init();
  const r2 = await c2.call('list_tasks', {});
  assert.equal(r2.result.isError, true);
  assert.match(r2.result.content[0].text, /token is wrong/);
  await c2.close();
});

test('stdout carries only JSON-RPC, even for bad input and console.log', async () => {
  const c = startServer();
  c.child.stdin.write('this is not json\n');
  await c.init();
  await c.call('list_sessions', {});
  await c.close();
  for (const line of c.lines) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  assert.equal(JSON.parse(c.lines[0]).error.code, -32700);
});

test('an older watch-only helper (no /v1/tasks) gives plain words', async () => {
  // Same answers the v1 helper gives: GET /v1/tasks -> 404, POST -> 405.
  const old = http.createServer((req, res) => {
    const status = req.method === 'GET' ? 404 : 405;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: status === 404 ? 'not_found' : 'method_not_allowed' }));
  });
  await new Promise((r) => old.listen(0, '127.0.0.1', r));
  old.unref(); // never keeps the run alive if an assert fails
  const c = startServer({ port: old.address().port });
  await c.init();
  for (const [name, args] of [['list_tasks', {}], ['delegate_task', { tool: 'codex', prompt: 'x' }]]) {
    const r = await c.call(name, args);
    assert.equal(r.result.isError, true, name);
    assert.match(r.result.content[0].text, /older watch-only version, so it cannot take tasks/, name);
  }
  await c.close();
  await new Promise((r) => old.close(r));
});
