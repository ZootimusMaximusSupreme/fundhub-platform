import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBridge } from '../src/server.mjs';
import {
  tempHome, jl, claude, codex, writeClaude, writeCodex, CODEX_FILE, CODEX_ID, CLAUDE_ID, waitFor,
} from './_helpers.mjs';

async function boot(setup) {
  const dirs = tempHome();
  const files = setup(dirs);
  const bridge = createBridge({ ...dirs, port: 0, host: '127.0.0.1', hostname: 'test-mac', pollMs: 100 });
  const port = await bridge.start();
  const base = `http://127.0.0.1:${port}`;
  const get = (p, token = bridge.token) =>
    fetch(base + p, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });
  return { dirs, files, bridge, port, base, get };
}

const now = Math.floor(Date.now() / 1000);

function standardSetup(dirs) {
  const claudeFile = writeClaude(
    dirs, '-work-demo-app', CLAUDE_ID,
    jl(
      claude.user('Fix the login page please', 1),
      claude.assistantText('On it.', 2),
      claude.bash('b1', 'npm test', 3),
      claude.result('b1', 'Exit code 1\n2 failing', true, 4),
      claude.assistantText('Two tests fail.', 5),
    ),
    now - 600,
  );
  const codexFile = writeCodex(
    dirs, CODEX_FILE,
    jl(
      codex.meta(CODEX_ID, '/work/codex-demo', 1),
      codex.user('List the repo', 2),
      codex.shell('c1', 'ls', 3),
      codex.shellOut('c1', 0, 'a.txt', 4),
    ),
    now - 10,
  );
  return { claudeFile, codexFile };
}

test('http: missing or wrong token is 401 unauthorized', async () => {
  const s = await boot(standardSetup);
  try {
    for (const p of ['/v1/health', '/v1/sessions', `/v1/sessions/claude/${CLAUDE_ID}/events`]) {
      for (const token of [null, 'wrong', s.bridge.token + 'x']) {
        const r = await s.get(p, token);
        assert.equal(r.status, 401, `${p} with ${token}`);
        assert.deepEqual(await r.json(), { error: 'unauthorized' });
      }
    }
  } finally {
    await s.bridge.stop();
  }
});

test('http: /v1/health', async () => {
  const s = await boot(standardSetup);
  try {
    const r = await s.get('/v1/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, name: 'test-mac', version: '1' });
  } finally {
    await s.bridge.stop();
  }
});

test('http: /v1/sessions lists both tools newest first with titles, projects and counts', async () => {
  const s = await boot(standardSetup);
  try {
    const r = await s.get('/v1/sessions');
    assert.equal(r.status, 200);
    const { sessions } = await r.json();
    assert.equal(sessions.length, 2);
    const [first, second] = sessions;
    assert.equal(first.tool, 'codex'); // modified 10 seconds ago
    assert.equal(first.id, CODEX_ID);
    assert.equal(first.project, 'codex-demo');
    assert.equal(first.title, 'List the repo');
    assert.equal(first.live, true);
    assert.equal(first.eventCount, 3);
    assert.equal(second.tool, 'claude'); // 10 minutes ago
    assert.equal(second.id, CLAUDE_ID);
    assert.equal(second.project, 'demo-app');
    assert.equal(second.title, 'Fix the login page please');
    assert.equal(second.live, false);
    assert.equal(second.eventCount, 5);
    for (const x of sessions) assert.match(x.updatedAt, /^\d{4}-\d\d-\d\dT[\d:.]+Z$/);
  } finally {
    await s.bridge.stop();
  }
});

test('http: events with after, limit and unknown ids', async () => {
  const s = await boot(standardSetup);
  try {
    const all = await (await s.get(`/v1/sessions/claude/${CLAUDE_ID}/events`)).json();
    assert.deepEqual(all.events.map((e) => [e.seq, e.kind]), [[1, 'user'], [2, 'assistant'], [3, 'command'], [4, 'output'], [5, 'assistant']]);
    assert.equal(all.events[2].command, 'npm test');
    assert.equal(all.events[3].exitCode, 1);

    const page = await (await s.get(`/v1/sessions/claude/${CLAUDE_ID}/events?after=2&limit=2`)).json();
    assert.deepEqual(page.events.map((e) => e.seq), [3, 4]);
    const tail = await (await s.get(`/v1/sessions/claude/${CLAUDE_ID}/events?after=5`)).json();
    assert.deepEqual(tail.events, []);

    const cx = await (await s.get(`/v1/sessions/codex/${CODEX_ID}/events`)).json();
    assert.deepEqual(cx.events.map((e) => e.kind), ['user', 'command', 'output']);

    for (const p of ['/v1/sessions/claude/nope/events', '/v1/sessions/codex/' + CLAUDE_ID + '/events']) {
      const r = await s.get(p);
      assert.equal(r.status, 404);
      assert.deepEqual(await r.json(), { error: 'not_found' });
    }
    assert.equal((await s.get('/v1/sessions/other/x/events')).status, 404);
  } finally {
    await s.bridge.stop();
  }
});

test('http: limit is capped at 500 and resumes correctly past a checkpoint', async () => {
  const lines = [];
  for (let i = 1; i <= 650; i++) lines.push(claude.assistantText(`message number ${i}`, i % 50));
  const s = await boot((dirs) => writeClaude(dirs, '-work-big', 'big-session', jl(...lines), now - 5));
  try {
    const first = await (await s.get('/v1/sessions/claude/big-session/events?limit=9999')).json();
    assert.equal(first.events.length, 500);
    assert.equal(first.events[499].seq, 500);
    const rest = await (await s.get('/v1/sessions/claude/big-session/events?after=500')).json();
    assert.deepEqual([rest.events[0].seq, rest.events.length], [501, 150]);
    const mid = await (await s.get('/v1/sessions/claude/big-session/events?after=237&limit=3')).json();
    assert.deepEqual(mid.events.map((e) => e.text), ['message number 238', 'message number 239', 'message number 240']);
  } finally {
    await s.bridge.stop();
  }
});

test('seq is stable: re-reading, appending and a half-written last line never renumber', async () => {
  const s = await boot(standardSetup);
  try {
    const url = `/v1/sessions/claude/${CLAUDE_ID}/events`;
    const before = (await (await s.get(url)).json()).events;
    const again = (await (await s.get(url)).json()).events;
    assert.deepEqual(before, again);

    // write half of a line: it must not appear yet
    const full = JSON.stringify(claude.assistantText('late arrival', 9)) + '\n';
    fs.appendFileSync(s.files.claudeFile, full.slice(0, 30));
    const partial = (await (await s.get(url)).json()).events;
    assert.deepEqual(partial, before);

    // finish the line: only one new event, numbered 6, earlier ones unchanged
    fs.appendFileSync(s.files.claudeFile, full.slice(30));
    const done = (await (await s.get(url)).json()).events;
    assert.equal(done.length, 6);
    assert.deepEqual(done.slice(0, 5), before);
    assert.equal(done[5].seq, 6);
    assert.equal(done[5].text, 'late arrival');
    // the running index agrees (a half line must not have been swallowed)
    const { sessions } = await (await s.get('/v1/sessions')).json();
    assert.equal(sessions.find((x) => x.id === CLAUDE_ID).eventCount, 6);
  } finally {
    await s.bridge.stop();
  }
});

test('websocket: a line written in two pieces streams once, whole, with the next seq', async () => {
  const s = await boot(standardSetup);
  try {
    const c = openWs(s);
    await c.opened;
    c.ws.send(JSON.stringify({ type: 'subscribe', tool: 'claude', sessionId: CLAUDE_ID }));
    await new Promise((r) => setTimeout(r, 200));
    const full = JSON.stringify(claude.assistantText('two pieces', 9)) + '\n';
    fs.appendFileSync(s.files.claudeFile, full.slice(0, 40));
    await new Promise((r) => setTimeout(r, 400)); // several polls pass with a half line on disk
    assert.equal(c.messages.some((m) => m.type === 'event'), false);
    fs.appendFileSync(s.files.claudeFile, full.slice(40));
    const msg = await waitFor(() => c.messages.find((m) => m.type === 'event'));
    assert.equal(msg.event.seq, 6);
    assert.equal(msg.event.text, 'two pieces');
    assert.equal(c.messages.filter((m) => m.type === 'event').length, 1);
    c.ws.close();
  } finally {
    await s.bridge.stop();
  }
});

test('http: bad lines are skipped without a crash', async () => {
  const s = await boot((dirs) =>
    writeClaude(dirs, '-work-x', 'messy', '{"type":"user"\nnot json\n' + jl(claude.user('after the mess', 1), { type: 'user', message: null }, [1, 2]) + '\u0000\n', now - 5));
  try {
    const { events } = await (await s.get('/v1/sessions/claude/messy/events')).json();
    assert.deepEqual(events.map((e) => e.text), ['after the mess']);
  } finally {
    await s.bridge.stop();
  }
});

function openWs(s, token = s.bridge.token) {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/v1/stream?token=${token}`);
  const messages = [];
  ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
  const opened = new Promise((res, rej) => {
    ws.addEventListener('open', () => res());
    ws.addEventListener('error', () => rej(new Error('ws error')));
  });
  return { ws, messages, opened };
}

test('websocket: wrong token is refused', async () => {
  const s = await boot(standardSetup);
  try {
    const c = openWs(s, 'nope');
    await assert.rejects(c.opened);
    const r = await fetch(`http://127.0.0.1:${s.port}/v1/stream?token=nope`, { headers: { Connection: 'Upgrade', Upgrade: 'websocket' } }).catch(() => null);
    if (r) assert.notEqual(r.status, 200);
  } finally {
    await s.bridge.stop();
  }
});

test('websocket: hello, subscribe, and a newly appended event arrives with its seq', async () => {
  const s = await boot(standardSetup);
  try {
    const c = openWs(s);
    await c.opened;
    await waitFor(() => c.messages.find((m) => m.type === 'hello'));
    assert.deepEqual(c.messages.find((m) => m.type === 'hello'), { type: 'hello', name: 'test-mac', version: '1' });

    c.ws.send(JSON.stringify({ type: 'subscribe', tool: 'claude', sessionId: CLAUDE_ID }));
    await new Promise((r) => setTimeout(r, 200)); // let the subscription register

    fs.appendFileSync(s.files.claudeFile, jl(claude.assistantText('streamed hello', 20)));
    const msg = await waitFor(() => c.messages.find((m) => m.type === 'event'));
    assert.equal(msg.tool, 'claude');
    assert.equal(msg.sessionId, CLAUDE_ID);
    assert.equal(msg.event.seq, 6);
    assert.equal(msg.event.kind, 'assistant');
    assert.equal(msg.event.text, 'streamed hello');

    // a session update also went out
    const sess = await waitFor(() => c.messages.find((m) => m.type === 'session' && m.session.id === CLAUDE_ID));
    assert.equal(sess.session.eventCount >= 6, true);

    // unsubscribe: further lines do not arrive as events
    c.ws.send(JSON.stringify({ type: 'unsubscribe', tool: 'claude', sessionId: CLAUDE_ID }));
    await new Promise((r) => setTimeout(r, 200));
    const seen = c.messages.filter((m) => m.type === 'event').length;
    fs.appendFileSync(s.files.claudeFile, jl(claude.assistantText('not for you', 21)));
    await waitFor(() => c.messages.filter((m) => m.type === 'session' && m.session.eventCount >= 7).length > 0);
    assert.equal(c.messages.filter((m) => m.type === 'event').length, seen);
    c.ws.close();
  } finally {
    await s.bridge.stop();
  }
});

test('websocket: session updates go to everyone, including for brand new sessions; events only to subscribers', async () => {
  const s = await boot(standardSetup);
  try {
    const a = openWs(s);
    const b = openWs(s);
    await Promise.all([a.opened, b.opened]);
    a.ws.send(JSON.stringify({ type: 'subscribe', tool: 'codex', sessionId: CODEX_ID }));
    await new Promise((r) => setTimeout(r, 200));

    fs.appendFileSync(s.files.codexFile, jl(codex.assistant('codex streamed', 30)));
    await waitFor(() => a.messages.find((m) => m.type === 'event'));
    const ev = a.messages.find((m) => m.type === 'event');
    assert.equal(ev.event.seq, 4);
    assert.equal(ev.tool, 'codex');
    await waitFor(() => b.messages.find((m) => m.type === 'session' && m.session.id === CODEX_ID));
    assert.equal(b.messages.some((m) => m.type === 'event'), false);

    // a new session file shows up for all clients
    const newId = '22222222-2222-3333-4444-555555555555';
    writeClaude(s.dirs, '-work-demo-app', newId, jl(claude.user('A brand new chat', 40)));
    const joined = await waitFor(() => b.messages.find((m) => m.type === 'session' && m.session.id === newId));
    assert.equal(joined.session.title, 'A brand new chat');
    assert.equal(joined.session.live, true);
    a.ws.close();
    b.ws.close();
  } finally {
    await s.bridge.stop();
  }
});

test('sessions: capped at 200, newest first', async () => {
  const s = await boot((dirs) => {
    for (let i = 0; i < 230; i++) writeClaude(dirs, '-work-many', `sess-${String(i).padStart(3, '0')}`, jl(claude.user(`chat ${i}`, 1)), now - 1000 + i);
  });
  try {
    const { sessions } = await (await s.get('/v1/sessions')).json();
    assert.equal(sessions.length, 200);
    assert.equal(sessions[0].id, 'sess-229');
    assert.equal(sessions[199].id, 'sess-030');
  } finally {
    await s.bridge.stop();
  }
});

test('the helper never changes the session folders', async () => {
  const snap = (d) => {
    const out = [];
    const walk = (p) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const f = `${p}/${e.name}`;
        if (e.isDirectory()) walk(f);
        else out.push(`${f}:${fs.statSync(f).size}:${fs.statSync(f).mtimeMs}`);
      }
    };
    walk(d);
    return out.sort();
  };
  const s = await boot(standardSetup);
  try {
    const before = [...snap(s.dirs.claudeDir), ...snap(s.dirs.codexDir)];
    await s.get('/v1/sessions');
    await s.get(`/v1/sessions/claude/${CLAUDE_ID}/events`);
    await s.get(`/v1/sessions/codex/${CODEX_ID}/events`);
    await new Promise((r) => setTimeout(r, 350));
    assert.deepEqual([...snap(s.dirs.claudeDir), ...snap(s.dirs.codexDir)], before);
  } finally {
    await s.bridge.stop();
  }
});

test('codex internal guardian-review rollouts are hidden from the list', async () => {
  const guardianId = '99999999-aaaa-bbbb-cccc-dddddddddddd';
  const s = await boot((dirs) => {
    standardSetup(dirs);
    const meta = codex.meta(guardianId, '/work/codex-demo', 1);
    meta.payload.thread_source = 'guardian_review';
    meta.payload.parent_thread_id = 'parent';
    writeCodex(dirs, `rollout-2026-01-02T03-04-06-${guardianId}.jsonl`, jl(meta, codex.user('You are judging one planned action', 2)), now - 1);
  });
  try {
    const { sessions } = await (await s.get('/v1/sessions')).json();
    assert.equal(sessions.some((x) => x.id === guardianId), false);
    assert.equal(sessions.length, 2);
    assert.equal((await s.get(`/v1/sessions/codex/${guardianId}/events`)).status, 404);
  } finally {
    await s.bridge.stop();
  }
});
