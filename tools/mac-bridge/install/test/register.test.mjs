// Pure tests for the config edits in register-mcp.mjs. No real config files are read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codexBlock, upsertCodexToml, upsertCursorJson } from '../register-mcp.mjs';

const block = codexBlock('/n/node', '/s/server.mjs');

test('codex: appends our table and keeps everything else', () => {
  const before = 'model = "x"\n\n[mcp_servers.node_repl]\ncommand = "r"\n\n[features]\nmemories = true\n';
  const after = upsertCodexToml(before, block);
  assert.ok(after.startsWith(before));
  assert.match(after, /\[mcp_servers\.mac-bridge\]\ncommand = "\/n\/node"\nargs = \["\/s\/server\.mjs"\]/);
  assert.equal(upsertCodexToml(after, block), after, 'second run changes nothing');
});

test('codex: re-points an existing table in place, sub-tables too, neighbours kept', () => {
  const before = 'a = 1\n[mcp_servers.mac-bridge]\ncommand = "old"\nargs = ["old.mjs"]\n[mcp_servers.mac-bridge.env]\nX = "1"\n[features]\nmemories = true\n';
  const after = upsertCodexToml(before, block);
  assert.doesNotMatch(after, /old/);
  assert.doesNotMatch(after, /X = "1"/);
  assert.match(after, /^a = 1\n/);
  assert.match(after, /\[features\]\nmemories = true/);
  assert.equal((after.match(/\[mcp_servers\.mac-bridge\]/g) || []).length, 1);
});

test('cursor: creates, merges and keeps other servers', () => {
  const fresh = JSON.parse(upsertCursorJson('', '/n/node', '/s/server.mjs'));
  assert.deepEqual(fresh, { mcpServers: { 'mac-bridge': { command: '/n/node', args: ['/s/server.mjs'] } } });
  const merged = JSON.parse(upsertCursorJson(JSON.stringify({ mcpServers: { other: { command: 'o' } }, keep: true }), '/n/node', '/s/new.mjs'));
  assert.deepEqual(merged.mcpServers.other, { command: 'o' });
  assert.equal(merged.keep, true);
  assert.deepEqual(merged.mcpServers['mac-bridge'].args, ['/s/new.mjs']);
  assert.throws(() => upsertCursorJson('[1]', 'n', 's'));
});
