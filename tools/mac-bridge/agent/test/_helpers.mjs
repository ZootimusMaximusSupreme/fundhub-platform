// Test helpers: hand-built fake session files in a temp "home". All text is fake.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-bridge-test-'));
  const dirs = {
    home,
    claudeDir: path.join(home, '.claude', 'projects'),
    codexDir: path.join(home, '.codex', 'sessions'),
    cursorDir: path.join(home, '.cursor', 'projects'),
    tokenFile: path.join(home, '.mac-bridge', 'token'),
  };
  fs.mkdirSync(dirs.claudeDir, { recursive: true });
  fs.mkdirSync(dirs.codexDir, { recursive: true });
  fs.mkdirSync(dirs.cursorDir, { recursive: true });
  return dirs;
}

export const jl = (...objs) => objs.map((o) => JSON.stringify(o)).join('\n') + '\n';

let n = 0;
const ts = (sec) => new Date(Date.UTC(2026, 0, 2, 3, 4, sec)).toISOString();

// ---- Claude Code fixture lines
export const claude = {
  user: (text, sec = n++, extra = {}) => ({
    type: 'user', timestamp: ts(sec), cwd: '/work/demo-app', sessionId: 's1',
    message: { role: 'user', content: text }, ...extra,
  }),
  assistantText: (text, sec = n++) => ({
    type: 'assistant', timestamp: ts(sec), message: { role: 'assistant', content: [{ type: 'text', text }] },
  }),
  thinking: (sec = n++) => ({
    type: 'assistant', timestamp: ts(sec), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] },
  }),
  bash: (id, command, sec = n++) => ({
    type: 'assistant', timestamp: ts(sec),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command, description: 'x' } }] },
  }),
  tool: (id, name, input, sec = n++) => ({
    type: 'assistant', timestamp: ts(sec),
    message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] },
  }),
  result: (id, content, isError = false, sec = n++) => ({
    type: 'user', timestamp: ts(sec),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  }),
};

// ---- Codex fixture lines
export const codex = {
  meta: (id, cwd = '/work/codex-demo', sec = n++) => ({
    timestamp: ts(sec), type: 'session_meta', payload: { id, cwd, timestamp: ts(sec) },
  }),
  user: (text, sec = n++) => ({
    timestamp: ts(sec), type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
  }),
  assistant: (text, sec = n++) => ({
    timestamp: ts(sec), type: 'response_item',
    payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] },
  }),
  shell: (callId, cmd, sec = n++) => ({
    timestamp: ts(sec), type: 'response_item',
    payload: { type: 'function_call', name: 'exec_command', call_id: callId, arguments: JSON.stringify({ cmd, workdir: '/work' }) },
  }),
  shellOut: (callId, code, out, sec = n++) => ({
    timestamp: ts(sec), type: 'response_item',
    payload: {
      type: 'function_call_output', call_id: callId,
      output: `Chunk ID: abc\nWall time: 0.1 seconds\nProcess exited with code ${code}\nOriginal token count: 3\nOutput:\n${out}`,
    },
  }),
  call: (name, args, sec = n++) => ({
    timestamp: ts(sec), type: 'response_item',
    payload: { type: 'function_call', name, call_id: 'c-' + name, arguments: JSON.stringify(args) },
  }),
  reasoning: (sec = n++) => ({ timestamp: ts(sec), type: 'response_item', payload: { type: 'reasoning', summary: [] } }),
};

export function writeClaude(dirs, project, id, text, mtimeSec) {
  const dir = path.join(dirs.claudeDir, project);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, text);
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

export function writeCodex(dirs, name, text, mtimeSec) {
  const dir = path.join(dirs.codexDir, '2026', '01', '02');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  if (mtimeSec) fs.utimesSync(file, mtimeSec, mtimeSec);
  return file;
}

export const CODEX_ID = '01a15935-26dc-7cc1-9217-1d0b005528ae';
export const CODEX_FILE = `rollout-2026-01-02T03-04-05-${CODEX_ID}.jsonl`;
export const CLAUDE_ID = '11111111-2222-3333-4444-555555555555';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out waiting');
    await sleep(25);
  }
}
