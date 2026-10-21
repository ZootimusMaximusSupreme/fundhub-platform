// v2 tasks: runner, HTTP routes, WebSocket "task" message, router and the Jev slot.
// Every run uses a FAKE claude / codex program written to a temp folder.
// The real claude and codex are never started by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';
import { createBridge } from '../src/server.mjs';
import { TaskRunner, buildArgs, findCodex, findCursor, sessionIdFrom, MAX_PROMPT, KEEP_TASKS } from '../src/tasks.mjs';
import { pick, pickByRules, LANES } from '../src/router.mjs';
import { jevEnabled, jevPick } from '../src/jev.mjs';
import { tempHome, jl, codex, writeCodex, CODEX_FILE, CODEX_ID, waitFor } from './_helpers.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL_REPO = path.resolve(here, '..', '..', '..', '..');

// ---- fake claude / codex
const FAKE_SRC = `
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const base = path.basename(process.argv[1]);
const tool = base.startsWith('fake-codex') ? 'codex' : base.startsWith('fake-cursor') ? 'cursor' : 'claude';
const argv = process.argv.slice(2);
const prompt = argv[argv.length - 1];
const log = { tool, argv, cwd: process.cwd(), signals: [] };
const save = () => fs.writeFileSync(path.join(process.env.FAKE_LOG, tool + '-' + process.pid + '.json'), JSON.stringify(log));
save();
const holding = prompt.includes('HOLD') || prompt.includes('STUBBORN');
if (holding) {
  // handlers go in before the session line, so a stop sent after it is always seen
  process.on('SIGINT', () => { log.signals.push('SIGINT'); save(); if (prompt.includes('HOLD')) process.exit(130); });
  process.on('SIGTERM', () => { log.signals.push('SIGTERM'); save(); process.exit(143); });
}
const ri = argv.indexOf('--resume');
const resume = tool !== 'codex' ? (ri >= 0 ? argv[ri + 1] : null) : (argv[2] === 'resume' ? argv[4] : null);
const sid = resume || (tool === 'codex' ? '' : 'fake-' + tool + '-') + crypto.randomUUID();
if (tool !== 'codex') console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: sid }));
else console.log(JSON.stringify({ type: 'thread.started', thread_id: sid }));
if (prompt.includes('LOGIN')) {
  if (tool !== 'codex') console.log(JSON.stringify({ duration_ms: 1, type: 'result', is_error: true, result: 'Failed to authenticate: please log in' }));
  else { console.log(JSON.stringify({ type: 'error', message: 'You hit your usage limit.' })); console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'You hit your usage limit.' } })); }
  console.error('some noisy log line');
  process.exit(1);
}
if (prompt.includes('ENV')) { console.log(JSON.stringify({ type: 'env', env: process.env })); fs.writeFileSync(path.join(process.env.FAKE_LOG, 'env.json'), JSON.stringify(process.env)); }
if (prompt.includes('FAIL')) { console.error('boom'); process.exit(3); }
if (holding) {
  setInterval(() => {}, 1000);
} else {
  setTimeout(() => { console.log(JSON.stringify({ type: 'result', is_error: false, result: 'ok' })); process.exit(0); }, 50);
}
`;

function makeFakes() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-fake-'));
  const repo = path.join(dir, 'repo');
  const logDir = path.join(dir, 'log');
  fs.mkdirSync(repo);
  fs.mkdirSync(logDir);
  const write = (name) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, `#!${process.execPath}\n${FAKE_SRC}`, { mode: 0o755 });
    return f;
  };
  return { dir, repo, logDir, claudeBin: write('fake-claude'), codexBin: write('fake-codex'), cursorBin: write('fake-cursor') };
}

function readLogs(logDir, tool) {
  return fs
    .readdirSync(logDir)
    .filter((n) => n.startsWith(tool + '-'))
    .map((n) => JSON.parse(fs.readFileSync(path.join(logDir, n), 'utf8')));
}

async function boot({ tasks = {}, setup } = {}) {
  const dirs = tempHome();
  if (setup) setup(dirs);
  const fakes = makeFakes();
  const bridge = createBridge({
    ...dirs, port: 0, host: '127.0.0.1', hostname: 'test-mac', pollMs: 100,
    tasks: {
      repo: fakes.repo,
      claudeBin: fakes.claudeBin,
      codexBin: fakes.codexBin,
      cursorBin: fakes.cursorBin,
      env: { PATH: process.env.PATH, HOME: dirs.home, FAKE_LOG: fakes.logDir },
      ...tasks,
    },
  });
  const port = await bridge.start();
  const base = `http://127.0.0.1:${port}`;
  const req = (method, p, body, token = bridge.token) =>
    fetch(base + p, {
      method,
      headers: { ...(token === null ? {} : { Authorization: `Bearer ${token}` }), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
  const post = (p, body, token) => req('POST', p, body, token);
  const get = (p, token) => req('GET', p, undefined, token);
  const task = async (id) => (await (await get('/v1/tasks')).json()).tasks.find((t) => t.id === id);
  const until = (id, statuses, ms = 6000) =>
    waitFor(async () => {
      const t = await task(id);
      return t && statuses.includes(t.status) ? t : null;
    }, ms);
  return { dirs, fakes, bridge, port, base, post, get, task, until };
}

function openWs(s) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/v1/stream?token=${s.bridge.token}`);
  const messages = [];
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
  const opened = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  return { ws, messages, opened };
}

test('tasks: POST, GET and stop all need the token', async () => {
  const s = await boot();
  try {
    for (const token of [null, 'wrong', s.bridge.token + 'x']) {
      let r = await s.post('/v1/tasks', { tool: 'claude', prompt: 'hello' }, token);
      assert.equal(r.status, 401);
      assert.deepEqual(await r.json(), { error: 'unauthorized' });
      r = await s.get('/v1/tasks', token);
      assert.equal(r.status, 401);
      r = await s.post('/v1/tasks/abc/stop', undefined, token);
      assert.equal(r.status, 401);
    }
    assert.deepEqual((await (await s.get('/v1/tasks')).json()).tasks, []);
    assert.deepEqual(readLogs(s.fakes.logDir, 'claude'), []); // nothing was started
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: claude run goes starting -> running -> done, captures sessionId, and the prompt is never a shell command', async () => {
  const s = await boot();
  const c = openWs(s);
  try {
    await c.opened;
    const marker = path.join(s.fakes.dir, 'pwned');
    const prompt = `Say hi $(touch ${marker}) ; touch ${marker} \`touch ${marker}\``;
    const r = await s.post('/v1/tasks', { tool: 'claude', prompt });
    assert.equal(r.status, 202);
    const { task } = await r.json();
    assert.equal(task.status, 'starting');
    assert.equal(task.tool, 'claude');
    assert.equal(task.pickedBy, 'you');
    assert.equal(task.pickReason, 'You picked Claude.');
    assert.equal(task.prompt, prompt.slice(0, 200));
    assert.equal(task.sessionId, null);
    assert.equal(task.endedAt, null);

    const done = await s.until(task.id, ['done', 'failed']);
    assert.equal(done.status, 'done');
    assert.equal(done.exitCode, 0);
    assert.equal(done.error, null);
    assert.match(done.sessionId, /^fake-claude-/);
    assert.ok(done.endedAt);

    // WebSocket saw every status change, in order
    await waitFor(() => c.messages.some((m) => m.type === 'task' && m.task.id === task.id && m.task.status === 'done'));
    const seen = c.messages.filter((m) => m.type === 'task' && m.task.id === task.id).map((m) => m.task.status);
    assert.deepEqual([...new Set(seen)], ['starting', 'running', 'done']);

    const [log] = readLogs(s.fakes.logDir, 'claude');
    assert.deepEqual(log.argv, ['-p', '--output-format', 'stream-json', '--verbose', '--', prompt]);
    assert.equal(fs.realpathSync(log.cwd), fs.realpathSync(s.fakes.repo));
    assert.equal(fs.existsSync(marker), false);
  } finally {
    c.ws.close();
    await s.bridge.stop();
  }
});

test('tasks: codex run captures its thread id; resume passes the id for both tools', async () => {
  const s = await boot();
  try {
    const { task } = await (await s.post('/v1/tasks', { tool: 'codex', prompt: 'list files' })).json();
    const done = await s.until(task.id, ['done', 'failed']);
    assert.equal(done.status, 'done');
    assert.match(done.sessionId, /^[0-9a-f-]{36}$/);
    assert.equal(done.pickReason, 'You picked Codex.');

    const r1 = await (await s.post('/v1/tasks', { tool: 'codex', prompt: 'and again', resumeSessionId: done.sessionId })).json();
    const d1 = await s.until(r1.task.id, ['done', 'failed']);
    assert.equal(d1.sessionId, done.sessionId);
    const r2 = await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'more', resumeSessionId: 'abc-123' })).json();
    assert.equal(r2.task.sessionId, 'abc-123');
    await s.until(r2.task.id, ['done', 'failed']);

    const cx = readLogs(s.fakes.logDir, 'codex').map((l) => l.argv);
    assert.ok(cx.some((a) => JSON.stringify(a) === JSON.stringify(['exec', '--json', '--', 'list files'])));
    assert.ok(cx.some((a) => JSON.stringify(a) === JSON.stringify(['exec', '--json', 'resume', '--', done.sessionId, 'and again'])));
    const cl = readLogs(s.fakes.logDir, 'claude')[0].argv;
    assert.deepEqual(cl, ['-p', '--output-format', 'stream-json', '--verbose', '--resume', 'abc-123', '--', 'more']);
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: a run that exits non-zero is failed with the exit code and the last error line', async () => {
  const s = await boot();
  try {
    const { task } = await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'please FAIL' })).json();
    const t = await s.until(task.id, ['done', 'failed']);
    assert.equal(t.status, 'failed');
    assert.equal(t.exitCode, 3);
    assert.equal(t.error, 'exited with code 3: boom');
    assert.ok(t.sessionId); // it printed one before failing

    // Claude's own error text (stream-json result line) is what the phone shows
    const l = (await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'LOGIN' })).json()).task;
    const lt = await s.until(l.id, ['done', 'failed']);
    assert.equal(lt.error, 'exited with code 1: Failed to authenticate: please log in');
    const c = (await (await s.post('/v1/tasks', { tool: 'codex', prompt: 'LOGIN' })).json()).task;
    assert.equal((await s.until(c.id, ['done', 'failed'])).error, 'exited with code 1: You hit your usage limit.');
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: stop sends SIGINT; a run that ignores it gets SIGTERM after the grace time', async () => {
  const s = await boot({ tasks: { stopGraceMs: 300 } });
  try {
    const a = (await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'HOLD please' })).json()).task;
    await s.until(a.id, ['running']);
    await waitFor(async () => (await s.task(a.id)).sessionId);
    const r = await s.post(`/v1/tasks/${a.id}/stop`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).task.id, a.id);
    const stopped = await s.until(a.id, ['stopped', 'failed', 'done']);
    assert.equal(stopped.status, 'stopped');

    const b = (await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'STUBBORN please' })).json()).task;
    await s.until(b.id, ['running']);
    await waitFor(async () => (await s.task(b.id)).sessionId);
    const t0 = Date.now();
    await s.post(`/v1/tasks/${b.id}/stop`);
    const sb = await s.until(b.id, ['stopped', 'failed', 'done']);
    assert.equal(sb.status, 'stopped');
    assert.ok(Date.now() - t0 >= 250, 'SIGTERM waited for the grace time');
    const logs = readLogs(s.fakes.logDir, 'claude');
    assert.deepEqual(logs.find((l) => l.argv.at(-1) === 'HOLD please').signals, ['SIGINT']);
    assert.deepEqual(logs.find((l) => l.argv.at(-1) === 'STUBBORN please').signals, ['SIGINT', 'SIGTERM']);

    // stopping a finished task changes nothing; an unknown task is 404; GET is 405
    assert.equal((await (await s.post(`/v1/tasks/${a.id}/stop`)).json()).task.status, 'stopped');
    const nf = await s.post('/v1/tasks/nope/stop');
    assert.equal(nf.status, 404);
    assert.deepEqual(await nf.json(), { error: 'not_found' });
    assert.equal((await s.get(`/v1/tasks/${a.id}/stop`)).status, 405);
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: a 4th run while 3 are running is 429 busy', async () => {
  const s = await boot();
  try {
    const ids = [];
    for (let i = 0; i < 3; i++) {
      const r = await s.post('/v1/tasks', { tool: i === 1 ? 'codex' : 'claude', prompt: `HOLD ${i}` });
      assert.equal(r.status, 202);
      ids.push((await r.json()).task.id);
    }
    const r = await s.post('/v1/tasks', { tool: 'claude', prompt: 'one more' });
    assert.equal(r.status, 429);
    assert.deepEqual(await r.json(), { error: 'busy' });
    assert.equal((await (await s.get('/v1/tasks')).json()).tasks.length, 3);
    for (const id of ids) await s.post(`/v1/tasks/${id}/stop`);
    for (const id of ids) await s.until(id, ['stopped']);
    assert.equal((await s.post('/v1/tasks', { tool: 'claude', prompt: 'now there is room' })).status, 202);
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: bad input is refused before anything runs', async () => {
  const s = await boot();
  try {
    const cases = [
      [{ tool: 'claude', prompt: 'x'.repeat(MAX_PROMPT + 1) }, 400, 'prompt_too_long'],
      [{ tool: 'grok', prompt: 'hi' }, 400, 'bad_tool'],
      [{ tool: 'claude', prompt: '   ' }, 400, 'empty_prompt'],
      [{ tool: 'claude' }, 400, 'empty_prompt'],
      [{ tool: 'claude', prompt: 'hi', resumeSessionId: '--dangerously-skip-permissions' }, 400, 'bad_session_id'],
      [{ tool: 'claude', prompt: 'hi', resumeSessionId: 'a b' }, 400, 'bad_session_id'],
      [{ tool: 'auto', prompt: 'hi', resumeSessionId: 'not-a-known-chat' }, 400, 'unknown_session'],
      ['{not json', 400, 'bad_json'],
      [[1, 2], 400, 'bad_request'],
      [JSON.stringify({ tool: 'claude', prompt: 'y'.repeat(70 * 1024) }), 413, 'too_large'],
    ];
    for (const [body, status, error] of cases) {
      const r = await s.post('/v1/tasks', body);
      assert.equal(r.status, status, error);
      assert.equal((await r.json()).error, error);
    }
    assert.equal(MAX_PROMPT, 20000);
    const ok = await s.post('/v1/tasks', { tool: 'claude', prompt: 'z'.repeat(MAX_PROMPT) });
    assert.equal(ok.status, 202);
    assert.equal((await ok.json()).task.prompt.length, 200);
    const del = await fetch(s.base + '/v1/tasks', { method: 'DELETE', headers: { Authorization: `Bearer ${s.bridge.token}` } });
    assert.equal(del.status, 405);
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: codex not found fails the task with codex_not_found', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-empty-'));
  const s = await boot({ tasks: { codexBin: undefined, binSearch: { env: { PATH: empty, MAC_BRIDGE_CODEX_BIN: '' }, appRoots: [empty] } } });
  try {
    const r = await s.post('/v1/tasks', { tool: 'codex', prompt: 'hi' });
    assert.equal(r.status, 202);
    const t = await s.until((await r.json()).task.id, ['failed', 'done']);
    assert.equal(t.status, 'failed');
    assert.equal(t.error, 'codex_not_found');
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: a run started from inside a Claude Code session does not inherit that session\'s wiring', async () => {
  const s = await boot({
    tasks: {
      env: {
        PATH: process.env.PATH, HOME: '/tmp', KEEP_ME: 'yes', ANTHROPIC_API_KEY: 'kept',
        CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'sdk', CLAUDE_CODE_SESSION_ID: 'host', CLAUDE_AGENT_SDK_VERSION: '1',
        CLAUDE_PID: '9', ANTHROPIC_BASE_URL: 'http://127.0.0.1:1/host-relay',
      },
    },
  });
  try {
    // FAKE_LOG is gone from this env on purpose, so give it back
    s.bridge.runner.env.FAKE_LOG = s.fakes.logDir;
    const { task } = await (await s.post('/v1/tasks', { tool: 'claude', prompt: 'ENV' })).json();
    await s.until(task.id, ['done', 'failed']);
    const env = JSON.parse(fs.readFileSync(path.join(s.fakes.logDir, 'env.json'), 'utf8'));
    assert.equal(env.KEEP_ME, 'yes');
    assert.equal(env.ANTHROPIC_API_KEY, 'kept');
    for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_AGENT_SDK_VERSION', 'CLAUDE_PID', 'ANTHROPIC_BASE_URL']) {
      assert.equal(env[k], undefined, k);
    }
  } finally {
    await s.bridge.stop();
  }
});

test('findCodex: env override, then PATH, then inside an app bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-apps-'));
  const exe = (f) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '#!/bin/sh\n', { mode: 0o755 });
    return f;
  };
  const apps = path.join(root, 'Applications');
  const inApp = exe(path.join(apps, 'ChatGPT.app', 'Contents', 'Resources', 'codex-cli', 'bin', 'codex'));
  fs.mkdirSync(path.join(apps, 'Notes.app'), { recursive: true });
  const none = path.join(root, 'nothing');
  assert.equal(findCodex({ env: { PATH: none }, appRoots: [apps] }), inApp);
  const binDir = path.join(root, 'bin');
  const onPath = exe(path.join(binDir, 'codex'));
  assert.equal(findCodex({ env: { PATH: binDir }, appRoots: [apps] }), onPath);
  const custom = exe(path.join(root, 'my-codex'));
  assert.equal(findCodex({ env: { PATH: binDir, MAC_BRIDGE_CODEX_BIN: custom }, appRoots: [apps] }), custom);
  assert.equal(findCodex({ env: { PATH: none }, appRoots: [none] }), null);
  fs.writeFileSync(path.join(root, 'not-exec'), 'x', { mode: 0o644 });
  assert.equal(findCodex({ env: { PATH: none, MAC_BRIDGE_CODEX_BIN: path.join(root, 'not-exec') }, appRoots: [apps] }), null);
});

test('buildArgs never adds a flag that loosens a guard, and sessionIdFrom reads both tools', () => {
  for (const tool of ['claude', 'codex', 'cursor']) {
    for (const resume of [null, 'abc']) {
      const args = buildArgs(tool, 'do the thing', resume);
      const joined = args.join(' ');
      assert.doesNotMatch(joined, /dangerously|skip-permissions|bypass|--sandbox|danger-full-access|--permission-mode|--approve-for-me|--allowedTools|full-auto|--yolo|--force|--trust|--approve-mcps|--auto-review/i);
      assert.equal(args.includes('-f'), false);
      assert.equal(args.at(-1), 'do the thing');
    }
  }
  assert.equal(sessionIdFrom('claude', '{"type":"system","session_id":"s-1"}'), 's-1');
  assert.equal(sessionIdFrom('claude', 'not json'), null);
  assert.equal(sessionIdFrom('codex', '{"type":"thread.started","thread_id":"t-1"}'), 't-1');
  assert.equal(sessionIdFrom('codex', '{"msg":{"type":"session_configured","session_id":"t-2"}}'), 't-2');
  assert.equal(sessionIdFrom('codex', 'session id: 01a15935-26dc-7cc1-9217-1d0b005528ae'), '01a15935-26dc-7cc1-9217-1d0b005528ae');
  assert.equal(sessionIdFrom('codex', 'session id: nope'), null);
});

test('task list keeps only the newest (50 by default), newest first', async () => {
  assert.equal(KEEP_TASKS, 50);
  const f = makeFakes();
  const runner = new TaskRunner({ repo: f.repo, claudeBin: f.claudeBin, codexBin: f.codexBin, keep: 5, env: { PATH: process.env.PATH, FAKE_LOG: f.logDir } });
  const ids = [];
  for (let i = 0; i < 7; i++) {
    const out = await runner.create({ tool: 'claude', prompt: `quick ${i}` });
    ids.push(out.body.task.id);
    await waitFor(() => runner.get(ids.at(-1))?.status === 'done');
  }
  const list = runner.list();
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((t) => t.id), ids.slice(2).reverse());
});

// ---- router

function ruleRepo(withLane) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-rules-'));
  fs.writeFileSync(path.join(repo, 'AGENTS.md'), '# Rules\nBe kind.\n');
  fs.mkdirSync(path.join(repo, '.claude', 'rules'), { recursive: true });
  if (withLane) {
    fs.writeFileSync(
      path.join(repo, '.claude', 'rules', 'grok-no-displays.md'),
      '# Grok\n**Owner law:** Only Claude may change what people see on a screen or on the web. Grok does not.\n',
    );
  }
  return repo;
}

test('router: screen work goes to Claude by the repo rule; other work defaults to Claude; a removed rule stops applying', () => {
  const repo = ruleRepo(true);
  const screen = pickByRules('Make the sales page button bigger', { repo });
  assert.equal(screen.tool, 'claude');
  assert.equal(screen.pickedBy, 'rules');
  assert.match(screen.pickReason, /only Claude changes screens \(\.claude\/rules\/grok-no-displays\.md\)/);
  const other = pickByRules('Add a retry to the webhook job', { repo });
  assert.deepEqual(other, { tool: 'claude', pickedBy: 'rules', pickReason: 'No repo rule picks a tool for this task, so it goes to Claude (the default).' });
  const gone = pickByRules('Make the sales page button bigger', { repo: ruleRepo(false) });
  assert.match(gone.pickReason, /No repo rule picks/);
  // lanes are a table: a lane that names codex picks codex while its sentence is in the rules
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'Codex owns the nightly cron jobs.\n');
  const lanes = [...LANES, { id: 'cron', tool: 'codex', anchor: 'Codex owns the nightly cron jobs', match: /\bcron\b/i, reason: (f) => `cron (${f})` }];
  assert.deepEqual(pickByRules('fix the cron', { repo, lanes }), { tool: 'codex', pickedBy: 'rules', pickReason: 'cron (CLAUDE.md)' });
});

test('router: the real repo rules files still carry the screens lane', () => {
  const r = pickByRules('Change the dashboard layout', { repo: REAL_REPO });
  assert.equal(r.tool, 'claude');
  assert.match(r.pickReason, /grok-no-displays\.md/);
});

test('tasks: tool "auto" uses the router, and auto + resume stays in the chat\'s own tool', async () => {
  const s = await boot({
    tasks: { repo: ruleRepo(true) },
    setup: (dirs) => writeCodex(dirs, CODEX_FILE, jl(codex.meta(CODEX_ID), codex.user('hi'))),
  });
  try {
    const a = (await (await s.post('/v1/tasks', { tool: 'auto', prompt: 'Fix the colors on the landing page' })).json()).task;
    assert.equal(a.tool, 'claude');
    assert.equal(a.pickedBy, 'rules');
    assert.match(a.pickReason, /screen/);
    const b = (await (await s.post('/v1/tasks', { tool: 'auto', prompt: 'keep going', resumeSessionId: CODEX_ID })).json()).task;
    assert.equal(b.tool, 'codex');
    assert.equal(b.pickedBy, 'rules');
    assert.equal(b.pickReason, 'This chat is a Codex chat, so it stays in Codex.');
    await s.until(a.id, ['done', 'failed']);
    await s.until(b.id, ['done', 'failed']);
  } finally {
    await s.bridge.stop();
  }
});

// ---- Jev slot

function spyNetwork() {
  const calls = [];
  const saved = [];
  const wrap = (obj, key) => {
    const orig = obj[key];
    saved.push([obj, key, orig]);
    obj[key] = (...a) => {
      calls.push(key);
      throw new Error('network not allowed in this test');
    };
  };
  wrap(globalThis, 'fetch');
  wrap(http, 'request');
  wrap(http, 'get');
  wrap(https, 'request');
  wrap(https, 'get');
  wrap(net, 'connect');
  wrap(net, 'createConnection');
  wrap(tls, 'connect');
  return { calls, restore: () => saved.reverse().forEach(([o, k, v]) => (o[k] = v)) };
}

test('jev: off unless MAC_BRIDGE_JEV=on AND JEV_API_KEY; off makes zero network calls; on is a marked stub', async () => {
  const repo = ruleRepo(true);
  assert.equal(jevEnabled({}), false);
  assert.equal(jevEnabled({ MAC_BRIDGE_JEV: 'on' }), false);
  assert.equal(jevEnabled({ JEV_API_KEY: 'k' }), false);
  assert.equal(jevEnabled({ MAC_BRIDGE_JEV: 'yes', JEV_API_KEY: 'k' }), false);
  assert.equal(jevEnabled({ MAC_BRIDGE_JEV: 'on', JEV_API_KEY: 'k' }), true);

  const spy = spyNetwork();
  try {
    for (const env of [{}, { MAC_BRIDGE_JEV: 'on' }, { JEV_API_KEY: 'k' }]) {
      assert.equal(await jevPick('anything', { env }), null);
      const r = await pick('Make the sales page button bigger', { repo, env });
      assert.equal(r.pickedBy, 'rules');
      assert.doesNotMatch(r.pickReason, /Jev/);
    }
    // switched on: the stub says so, the router falls back to repo rules, still no network
    await assert.rejects(jevPick('x', { env: { MAC_BRIDGE_JEV: 'on', JEV_API_KEY: 'k' } }), /jev not wired/);
    const on = await pick('Add a retry', { repo, env: { MAC_BRIDGE_JEV: 'on', JEV_API_KEY: 'k' } });
    assert.equal(on.tool, 'claude');
    assert.equal(on.pickedBy, 'rules');
    assert.match(on.pickReason, /^Jev is switched on but could not run \(jev not wired\)\./);
  } finally {
    spy.restore();
  }
  assert.deepEqual(spy.calls, []);
  const src = fs.readFileSync(path.join(here, '..', 'src', 'jev.mjs'), 'utf8');
  assert.doesNotMatch(src, /^\s*import\b/m, 'jev.mjs imports nothing');
  assert.doesNotMatch(src, /\bfetch\s*\(|node:(?:http|https|net|tls|dgram)/);
});

// ---- Cursor (third tool)

test('tasks: cursor runs in print mode, captures its chat id, and resumes with --resume', async () => {
  const s = await boot();
  try {
    const { task } = await (await s.post('/v1/tasks', { tool: 'cursor', prompt: 'hi cursor' })).json();
    assert.equal(task.tool, 'cursor');
    assert.equal(task.pickReason, 'You picked Cursor.');
    const done = await s.until(task.id, ['done', 'failed']);
    assert.equal(done.status, 'done');
    assert.match(done.sessionId, /^fake-cursor-/);
    const r = (await (await s.post('/v1/tasks', { tool: 'cursor', prompt: 'more', resumeSessionId: done.sessionId })).json()).task;
    assert.equal((await s.until(r.id, ['done', 'failed'])).sessionId, done.sessionId);
    const l = (await (await s.post('/v1/tasks', { tool: 'cursor', prompt: 'LOGIN' })).json()).task;
    assert.equal((await s.until(l.id, ['done', 'failed'])).error, 'exited with code 1: Failed to authenticate: please log in');

    const argvs = readLogs(s.fakes.logDir, 'cursor').map((x) => JSON.stringify(x.argv));
    assert.ok(argvs.includes(JSON.stringify(['-p', '--output-format', 'stream-json', '--', 'hi cursor'])));
    assert.ok(argvs.includes(JSON.stringify(['-p', '--output-format', 'stream-json', '--resume', done.sessionId, '--', 'more'])));
    const log = readLogs(s.fakes.logDir, 'cursor')[0];
    assert.equal(fs.realpathSync(log.cwd), fs.realpathSync(s.fakes.repo));
  } finally {
    await s.bridge.stop();
  }
});

test('tasks: cursor not found fails the task with cursor_not_found', async () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-empty-'));
  const s = await boot({ tasks: { cursorBin: undefined, binSearch: { env: { PATH: empty, MAC_BRIDGE_CURSOR_BIN: '' }, home: empty } } });
  try {
    const r = await s.post('/v1/tasks', { tool: 'cursor', prompt: 'hi' });
    assert.equal(r.status, 202);
    const t = await s.until((await r.json()).task.id, ['failed', 'done']);
    assert.equal(t.status, 'failed');
    assert.equal(t.error, 'cursor_not_found');
  } finally {
    await s.bridge.stop();
  }
});

test('findCursor: env override, cursor-agent on PATH or in ~/.local/bin, and "agent" only when it is Cursor\'s', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-cursor-'));
  const exe = (f) => {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, '#!/bin/sh\n', { mode: 0o755 });
    return f;
  };
  const none = path.join(root, 'nothing');
  const home = path.join(root, 'home');
  const local = path.join(home, '.local', 'bin');
  fs.mkdirSync(local, { recursive: true });
  assert.equal(findCursor({ env: { PATH: none }, home }), null);

  // some other program called "agent" is not Cursor
  const otherBin = path.join(root, 'other');
  exe(path.join(otherBin, 'agent'));
  assert.equal(findCursor({ env: { PATH: otherBin }, home }), null);

  // Cursor's installer links ~/.local/bin/agent -> .../cursor-agent/versions/<v>/cursor-agent
  const real = exe(path.join(home, '.local', 'share', 'cursor-agent', 'versions', '1', 'cursor-agent'));
  fs.symlinkSync(real, path.join(local, 'agent'));
  assert.equal(findCursor({ env: { PATH: none }, home }), path.join(local, 'agent'));
  fs.symlinkSync(real, path.join(local, 'cursor-agent'));
  assert.equal(findCursor({ env: { PATH: none }, home }), path.join(local, 'cursor-agent'));
  const onPath = exe(path.join(root, 'bin', 'cursor-agent'));
  assert.equal(findCursor({ env: { PATH: path.join(root, 'bin') }, home }), onPath);
  const custom = exe(path.join(root, 'my-cursor'));
  assert.equal(findCursor({ env: { PATH: none, MAC_BRIDGE_CURSOR_BIN: custom }, home }), custom);
  assert.equal(findCursor({ env: { PATH: none, MAC_BRIDGE_CURSOR_BIN: path.join(root, 'missing') }, home }), null);
});
