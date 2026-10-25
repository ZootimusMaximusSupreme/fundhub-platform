#!/usr/bin/env node
// Merge the Fundhub hook set into .claude/settings.json and .codex/hooks.json.
//
//   node scripts/hooks/wire.mjs
//
// Running it twice must not duplicate a hook. Unrelated hooks stay.
// Node built-ins only.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const NODE = 'node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || echo .)}';

function cmd(rel) {
  return `${NODE}/${rel}"`;
}

export const HOOK_SET = [
  {
    id: "session-rules.mjs",
    event: "SessionStart",
    entry: {
      hooks: [{ type: "command", command: cmd(".claude/hooks/session-rules.mjs") }]
    }
  },
  {
    id: "guard-rule-edits.mjs",
    event: "PreToolUse",
    entry: {
      matcher: "Write|Edit|MultiEdit|apply_patch",
      hooks: [{ type: "command", command: cmd(".claude/hooks/guard-rule-edits.mjs") }]
    }
  },
  {
    id: "check-ad-script.mjs",
    event: "PostToolUse",
    entry: {
      matcher: "Write|Edit|MultiEdit|apply_patch",
      hooks: [{ type: "command", command: cmd(".claude/hooks/check-ad-script.mjs") }]
    }
  },
  {
    id: "guard-env-masks.mjs",
    event: "PreToolUse",
    entry: {
      matcher: "Write|Edit|MultiEdit|apply_patch|Bash",
      hooks: [{ type: "command", command: cmd("scripts/hooks/guard-env-masks.mjs") }]
    }
  },
  {
    id: "guard-new-markdown.mjs",
    event: "PreToolUse",
    entry: {
      matcher: "Write|Edit|MultiEdit|apply_patch|Bash",
      hooks: [{ type: "command", command: cmd("scripts/hooks/guard-new-markdown.mjs") }]
    }
  }
];

function groupHasId(group, id) {
  return (group.hooks || []).some((h) => typeof h.command === "string" && h.command.includes(id));
}

export function mergeHookSet(hooks) {
  const out = hooks && typeof hooks === "object" ? { ...hooks } : {};
  for (const spec of HOOK_SET) {
    const list = Array.isArray(out[spec.event]) ? out[spec.event].slice() : [];
    if (!list.some((group) => groupHasId(group, spec.id))) list.push(spec.entry);
    out[spec.event] = list;
  }
  return out;
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    if (err && err.code === "ENOENT") return {};
    throw new Error(`${file}: ${err && err.message ? err.message : err}`);
  }
}

function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

export function wireFile(file) {
  const parsed = loadJson(file);
  const before = JSON.stringify(parsed);
  parsed.hooks = mergeHookSet(parsed.hooks);
  if (JSON.stringify(parsed) === before) return { file, changed: false };
  writeJson(file, parsed);
  return { file, changed: true };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const targets = [
    path.join(REPO, ".claude", "settings.json"),
    path.join(REPO, ".codex", "hooks.json")
  ];
  for (const file of targets) {
    const r = wireFile(file);
    console.log(`${r.changed ? "wired" : "already wired"}: ${path.relative(REPO, file)}`);
  }
}
