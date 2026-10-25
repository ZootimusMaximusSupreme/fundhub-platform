// Proves the new-markdown hook blocks one new file and allows one new file.
// The hook runs as its own process, the way Claude, Codex, and Cursor run it.
// Temp files stay in the system temp folder and are removed at the end.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("./guard-new-markdown.mjs", import.meta.url));
const REPO = path.resolve(path.dirname(HOOK), "..", "..");

function run(cwd, input) {
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd, ...input }),
    encoding: "utf8",
    timeout: 15000,
  });
}

function writeCall(cwd, file) {
  return run(cwd, {
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: { file_path: file },
  });
}

test("blocks a new markdown file outside the allowed folders", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "md-hook-block-"));
  try {
    const target = path.join(cwd, "scripts", "new-note.md");
    const result = writeCall(cwd, target);
    assert.equal(result.status, 2, result.stderr);
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.decision, "block");
    assert.equal(answer.permission, "deny");
    assert.match(answer.reason, /Do not create new \.md files/);
    assert.equal(fs.existsSync(target), false);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("allows a new markdown file inside docs", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "md-hook-allow-"));
  try {
    const target = path.join(cwd, "docs", "new-note.md");
    const result = writeCall(cwd, target);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.equal(result.stdout.trim(), "");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("allows an edit of a markdown file that is already there", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "md-hook-edit-"));
  try {
    const target = path.join(cwd, "scripts", "already.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "already here\n");
    const result = writeCall(cwd, target);
    assert.equal(result.status, 0, result.stdout);
    assert.equal(result.stdout.trim(), "");
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("the hook is wired for Claude, Codex, and Cursor", () => {
  const claude = fs.readFileSync(path.join(REPO, ".claude", "settings.json"), "utf8");
  const codex = fs.readFileSync(path.join(REPO, ".codex", "hooks.json"), "utf8");
  const cursor = fs.readFileSync(path.join(REPO, ".cursor", "hooks.json"), "utf8");
  assert.match(claude, /guard-new-markdown\.mjs/);
  assert.match(codex, /guard-new-markdown\.mjs/);
  assert.match(cursor, /guard-new-markdown\.mjs/);
});
