// Cursor agent transcripts as sessions (tool "cursor"). Fake files only; the real
// ~/.cursor folder is never read by these tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createBridge } from '../src/server.mjs';
import { parseLines, cursorTimestamp, cursorProjectName } from '../src/parse.mjs';
import { tempHome, jl, waitFor } from './_helpers.mjs';

const CURSOR_ID = 'c84cdf48-ee70-4f3f-b556-ce1f91b3c4f6';
const SLUG = 'Users-someone-Developer-demo-app';

const lines = () => [
  { role: 'user', message: { content: [{ type: 'text', text: '<timestamp>Monday, Oct 12, 2026, 7:46 PM (UTC-7)</timestamp>\n<user_query>\nFix the login page\n</user_query>' }] } },
  { role: 'assistant', message: { content: [{ type: 'text', text: 'Looking now.\n\n[REDACTED]' }, { type: 'tool_use', name: 'Shell', input: { command: 'npm test' } }] } },
  { role: 'assistant', message: { content: [{ type: 'text', text: '[REDACTED]' }, { type: 'tool_use', name: 'Read', input: { path: '/work/demo-app/src/login.mjs' } }] } },
  { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'CallDynamicTool', input: { namespace: 'cursor', toolName: 'WebSearch', arguments: { search_term: 'login bug' } } }] } },
  { role: 'assistant', message: { content: [{ type: 'tool_use', name: 'UpdateCurrentStep', input: { current_step: 'x' } }] } },
  { type: 'turn_ended', status: 'error', error: 'new_message_submitted' },
  { role: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
  { type: 'turn_ended', status: 'aborted', error: 'User aborted/interrupted manually.' },
  { type: 'turn_ended', status: 'success' },
];

function writeCursor(dirs, slug, id, text, mtimeSec) {
  const dir = path.join(dirs.cursorDir, slug, 'agent-transcripts', id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, text);
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

test('cursor parse: user query, assistant text without hidden thinking, shell commands, tools, aborts', () => {
  const { events } = parseLines('cursor', jl(...lines()));
  assert.deepEqual(
    events.map((e) => [e.kind, e.text]),
    [
      ['user', 'Fix the login page'],
      ['assistant', 'Looking now.'],
      ['command', 'npm test'],
      ['tool', 'Read /work/demo-app/src/login.mjs'],
      ['tool', 'WebSearch {"search_term":"login bug"}'],
      ['assistant', 'Done.'],
      ['system', 'User aborted/interrupted manually.'],
    ],
  );
  assert.equal(events[2].command, 'npm test');
  assert.equal(events[0].ts, '2026-10-13T02:46:00.000Z');
  assert.equal(events[5].ts, '2026-10-13T02:46:00.000Z'); // carries the last known time
  assert.equal(cursorTimestamp('Tue, Jan 2, 2026, 12:05 AM (UTC+5:30)'), '2026-01-01T18:35:00.000Z');
  assert.equal(cursorTimestamp('no time here'), null);
  assert.equal(cursorProjectName('Users-chrisstanbridge-Developer-fundhub-platform'), 'fundhub-platform');
  assert.equal(cursorProjectName('empty-window'), 'empty-window');
});

test('cursor sessions: listed with tool "cursor", events served, sub-agents skipped, folders untouched', async () => {
  const dirs = tempHome();
  const now = Math.floor(Date.now() / 1000);
  const file = writeCursor(dirs, SLUG, CURSOR_ID, jl(...lines()), now - 5);
  // a sub-agent transcript is not a chat
  const sub = path.join(dirs.cursorDir, SLUG, 'agent-transcripts', CURSOR_ID, 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'sub-1.jsonl'), jl(lines()[0]));
  // other Cursor folders are ignored
  fs.mkdirSync(path.join(dirs.cursorDir, SLUG, 'terminals'), { recursive: true });
  fs.writeFileSync(path.join(dirs.cursorDir, SLUG, 'terminals', '1.txt'), 'x');
  const before = fs.statSync(file).mtimeMs;

  const bridge = createBridge({ ...dirs, port: 0, host: '127.0.0.1', hostname: 'test-mac', pollMs: 100, tasks: { claudeBin: '/nope', codexBin: '/nope', cursorBin: '/nope' } });
  const port = await bridge.start();
  const get = (p) => fetch(`http://127.0.0.1:${port}${p}`, { headers: { Authorization: `Bearer ${bridge.token}` } });
  try {
    const { sessions } = await (await get('/v1/sessions')).json();
    assert.equal(sessions.length, 1);
    assert.deepEqual(
      { ...sessions[0], updatedAt: undefined },
      { id: CURSOR_ID, tool: 'cursor', project: 'demo-app', title: 'Fix the login page', updatedAt: undefined, live: true, eventCount: 7 },
    );
    const { events } = await (await get(`/v1/sessions/cursor/${CURSOR_ID}/events?after=2&limit=2`)).json();
    assert.deepEqual(events.map((e) => [e.seq, e.kind]), [[3, 'command'], [4, 'tool']]);
    assert.equal((await get('/v1/sessions/cursor/sub-1/events')).status, 404);

    // a new line streams to a subscriber like any other tool
    const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/stream?token=${bridge.token}`);
    const messages = [];
    ws.addEventListener('message', (e) => messages.push(JSON.parse(e.data)));
    await new Promise((r) => ws.addEventListener('open', r));
    ws.send(JSON.stringify({ type: 'subscribe', tool: 'cursor', sessionId: CURSOR_ID }));
    await new Promise((r) => setTimeout(r, 200));
    fs.appendFileSync(file, jl({ role: 'assistant', message: { content: [{ type: 'text', text: 'One more thing.' }] } }));
    const msg = await waitFor(() => messages.find((m) => m.type === 'event'));
    assert.deepEqual([msg.tool, msg.sessionId, msg.event.seq, msg.event.text], ['cursor', CURSOR_ID, 8, 'One more thing.']);
    ws.close();

    // auto + resume of a Cursor chat stays in Cursor (the fake path fails, which is fine here)
    const r = await fetch(`http://127.0.0.1:${port}/v1/tasks`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ tool: 'auto', prompt: 'keep going', resumeSessionId: CURSOR_ID }),
    });
    const { task } = await r.json();
    assert.equal(task.tool, 'cursor');
    assert.equal(task.pickReason, 'This chat is a Cursor chat, so it stays in Cursor.');
  } finally {
    await bridge.stop();
  }
  assert.ok(fs.statSync(file).mtimeMs >= before); // only this test appended to it; the helper never writes
  assert.equal(fs.readdirSync(path.join(dirs.cursorDir, SLUG, 'agent-transcripts', CURSOR_ID)).sort().join(','), `${CURSOR_ID}.jsonl,subagents`);
});
