import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLines, cut, projectName } from '../src/parse.mjs';
import { claude, codex, jl } from './_helpers.mjs';

test('claude: maps user, assistant, command, output, tool; skips thinking and sidechains', () => {
  const text = jl(
    { type: 'queue-operation', operation: 'enqueue' },
    claude.user('Please run the build', 1),
    claude.thinking(2),
    claude.assistantText('Sure, running it.', 3),
    claude.bash('t1', 'npm run build', 4),
    claude.result('t1', 'Exit code 2\nboom: failed', true, 5),
    claude.tool('t2', 'Read', { file_path: '/work/demo-app/a.txt' }, 6),
    claude.result('t2', 'file body that is not shown', false, 7),
    { ...claude.assistantText('subagent chatter', 8), isSidechain: true },
    claude.bash('t3', 'ls', 9),
    claude.result('t3', [{ type: 'text', text: 'a.txt\nb.txt' }], false, 10),
  ) + 'this line is not json\n';
  const { events, meta } = parseLines('claude', text);
  assert.deepEqual(events.map((e) => e.kind), ['user', 'assistant', 'command', 'output', 'tool', 'command', 'output']);
  assert.deepEqual(events.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(events[2].command, 'npm run build');
  assert.equal(events[3].exitCode, 2);
  assert.equal(events[3].text, 'boom: failed');
  assert.equal(events[4].text, 'Read /work/demo-app/a.txt');
  assert.equal(events[6].exitCode, 0);
  assert.equal(events[6].text, 'a.txt\nb.txt');
  assert.equal(events[0].ts, '2026-01-02T03:04:01.000Z');
  assert.equal(meta.cwd, '/work/demo-app');
});

test('claude: strips system reminders, maps slash commands and user shell mode', () => {
  const text = jl(
    claude.user('<system-reminder>ignore this</system-reminder>', 1),
    claude.user('real question <system-reminder>hidden</system-reminder>', 2),
    claude.user('<command-name>/model</command-name><command-args>fast</command-args>', 3),
    claude.user('<bash-input>echo hi</bash-input>', 4),
    claude.user('<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>', 5),
    claude.user('<local-command-caveat>x</local-command-caveat>', 6),
    { ...claude.user('meta line', 7), isMeta: true },
  );
  const { events } = parseLines('claude', text);
  assert.deepEqual(events.map((e) => [e.kind, e.text]), [
    ['user', 'real question'],
    ['system', 'Ran /model fast'],
    ['command', 'echo hi'],
    ['output', 'hi'],
  ]);
});

test('codex: maps messages, shell calls and outputs; hides injected context and reasoning', () => {
  const text = jl(
    codex.meta('cx-1', '/Users/x/.codex/worktrees/abcd/my-repo', 1),
    codex.user('# AGENTS.md instructions for /work\n<INSTRUCTIONS>fake</INSTRUCTIONS>', 2),
    codex.user('<environment_context><cwd>/work</cwd></environment_context>', 3),
    codex.user('Please list the files', 4),
    codex.reasoning(5),
    codex.assistant('Listing now.', 6),
    codex.shell('c1', 'ls -la', 7),
    codex.shellOut('c1', 1, 'ls: nope', 8),
    codex.call('apply_patch_fake', { path: '/work/a.txt' }, 9),
    codex.call('sleep', { duration_ms: 5 }, 10),
    codex.call('shell', { command: ['bash', '-lc', 'echo old-style'] }, 11),
    { timestamp: '2026-01-02T03:04:12.000Z', type: 'response_item', payload: { type: 'function_call_output', call_id: 'c-shell', output: JSON.stringify({ output: 'old-style', metadata: { exit_code: 0 } }) } },
    { timestamp: '2026-01-02T03:04:13.000Z', type: 'compacted', payload: { message: '' } },
  );
  const { events, meta } = parseLines('codex', text);
  assert.deepEqual(events.map((e) => e.kind), ['user', 'assistant', 'command', 'output', 'tool', 'command', 'output', 'system']);
  assert.equal(events[0].text, 'Please list the files');
  assert.equal(events[2].command, 'ls -la');
  assert.equal(events[3].exitCode, 1);
  assert.equal(events[3].text, 'ls: nope');
  assert.equal(events[4].text, 'apply_patch_fake /work/a.txt');
  assert.equal(events[5].command, 'echo old-style');
  assert.equal(events[6].exitCode, 0);
  assert.equal(events[6].text, 'old-style');
  assert.equal(meta.cwd, '/Users/x/.codex/worktrees/abcd/my-repo');
});

test('codex: exec script wrapper yields one command per cmd and an output', () => {
  const code = 'const r = await tools.exec_command({cmd:"git status --short", workdir:"/w"});\nawait tools.exec_command({cmd:"pwd"});';
  const text = jl(
    { timestamp: '2026-01-02T03:04:01.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'k1', input: code } },
    { timestamp: '2026-01-02T03:04:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'k1', output: [{ type: 'input_text', text: 'Script completed\nWall time 0.1 seconds\nOutput:\n' }, { type: 'input_text', text: JSON.stringify({ output: 'M a.txt', exit_code: 0 }) }] } },
    { timestamp: '2026-01-02T03:04:03.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'k2', input: '*** Begin Patch\n*** Update File: /w/a.txt\n@@\n-a\n+b\n*** End Patch' } },
  );
  const { events } = parseLines('codex', text);
  assert.deepEqual(events.map((e) => e.kind), ['command', 'command', 'output', 'tool']);
  assert.equal(events[0].command, 'git status --short');
  assert.equal(events[1].command, 'pwd');
  assert.equal(events[2].text, 'M a.txt');
  assert.equal(events[2].exitCode, 0);
  assert.equal(events[3].text, 'apply_patch /w/a.txt');
});

test('codex: exec script with JSON-style keys and injected app tags', () => {
  const code = 'const r = await Promise.all([ tools.exec_command({"cmd":"echo \\"hi there\\" && pwd","workdir":"/w"}) ]);';
  const text = jl(
    codex.user('<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>', 1),
    { timestamp: '2026-01-02T03:04:02.000Z', type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'k9', input: code } },
  );
  const { events } = parseLines('codex', text);
  assert.deepEqual(events.map((e) => e.kind), ['command']);
  assert.equal(events[0].command, 'echo "hi there" && pwd');
});

test('text is cut at 8000 chars with an ellipsis; project names come from the working folder', () => {
  const long = 'x'.repeat(9000);
  const { events } = parseLines('claude', jl(claude.assistantText(long, 1)));
  assert.equal(events[0].text.length, 8000);
  assert.ok(events[0].text.endsWith('…'));
  assert.equal(cut('short'), 'short');
  assert.equal(projectName('/Users/x/Developer/fundhub-platform/.claude/worktrees/mac-bridge'), 'fundhub-platform');
  assert.equal(projectName('/Users/x/.codex/worktrees/ab12/fundhub-platform'), 'fundhub-platform');
});

test('parsing the same text twice gives identical seq numbers', () => {
  const text = jl(claude.user('hello', 1), claude.bash('a', 'pwd', 2), claude.result('a', '/x', false, 3), claude.assistantText('done', 4));
  const a = parseLines('claude', text).events;
  const b = parseLines('claude', text).events;
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((e) => e.seq), [1, 2, 3, 4]);
});
