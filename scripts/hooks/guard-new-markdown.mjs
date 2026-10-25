#!/usr/bin/env node
// PreToolUse hook. Blocks a brand-new .md file outside the allowed folders.
// Editing a markdown file that is already there is allowed.
//
// Allowed folders: docs/, ops/, marketing/, .claude/rules/, .cursor/rules/, .ai/rules/
// .ai/rules/ is included because it is the real home of a rule. The other two
// rule folders are links to it.
//
// A new file  -> prints the deny answer and exits 2.
// An edit, or a new file in an allowed folder -> prints nothing and exits 0.
// On any unexpected error it prints nothing and exits 0, so a broken hook
// does not freeze every edit.
// Node built-ins only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALLOWED_PREFIXES = [
  "docs/",
  "ops/",
  "marketing/",
  ".claude/rules/",
  ".cursor/rules/",
  ".ai/rules/",
];

const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch|ApplyPatch|Bash|Shell|TabWrite)$/i;
const REASON = "Do not create new .md files unless I ask for one. Update an existing file instead. A new .md file has to go in docs/, ops/, marketing/, .claude/rules/, .cursor/rules/, or .ai/rules/.";

function allow() {
  process.exit(0);
}

function block(reason) {
  const text = reason || REASON;
  process.stdout.write(JSON.stringify({
    permission: "deny",
    user_message: text,
    agent_message: text,
    decision: "block",
    reason: text,
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: text,
    },
  }));
  process.exit(2);
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch { /* a closed pipe is fine */ }
  clearTimeout(timer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function repoRoot(cwd) {
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout && r.stdout.trim()) return r.stdout.trim();
  } catch { /* a missing git still allows the check to use this folder */ }
  return path.resolve(cwd);
}

function isMarkdown(p) {
  return typeof p === "string" && /\.md$/i.test(p.trim());
}

/** Repo-relative path with forward slashes, or null when the file is outside the repo. */
export function relativeToRepo(abs, root) {
  const rel = path.relative(root, abs);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

export function allowedRelative(rel) {
  if (!rel) return false;
  const lower = rel.toLowerCase();
  return ALLOWED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * True when this path is a new markdown file outside the allowed folders.
 * `exists` is passed in so the self-test can prove the choice without the disk.
 */
export function shouldBlockPath(rel, exists) {
  if (!isMarkdown(rel)) return false;
  if (exists) return false;
  return !allowedRelative(rel);
}

function resolvePath(raw, cwd) {
  const trimmed = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
  if (!trimmed) return "";
  return path.resolve(cwd, trimmed);
}

function namedPaths(input, cwd) {
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const out = [];
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) {
    if (typeof ti[key] === "string" && ti[key]) out.push(resolvePath(ti[key], cwd));
    if (typeof input[key] === "string" && input[key]) out.push(resolvePath(input[key], cwd));
  }
  const tool = String(input.tool_name || "");
  if (/^(apply_patch|ApplyPatch)$/i.test(tool)) {
    for (const value of Object.values(ti)) {
      if (typeof value !== "string" || !value.includes("*** ")) continue;
      for (const m of value.matchAll(/^\*\*\* Add File:\s*(.+?)\s*$/gm)) out.push(resolvePath(m[1], cwd));
    }
  }
  return out;
}

/** Destinations a shell command would create. git mv and mv are moves, not new files. */
export function shellCreateTargets(command) {
  if (typeof command !== "string" || !command.trim()) return [];
  const targets = [];
  const segments = command.split(/(?:&&|\|\||;|\n)/);
  for (const raw of segments) {
    const segment = raw.trim();
    if (!segment) continue;
    if (/^(?:git\s+mv|mv)\b/.test(segment)) continue;
    const patterns = [
      /(?:^|[\s])>>?\s*(['"]?)([^\s'";|&]+\.md)\1/gi,
      /\btouch\s+(?:-\S+\s+)*(['"]?)([^\s'";|&]+\.md)\1/gi,
      /\btee\s+(?:-\S+\s+)*(['"]?)([^\s'";|&]+\.md)\1/gi,
      /\bcp\s+(?:-\S+\s+)*\S+\s+(['"]?)([^\s'";|&]+\.md)\1/gi,
    ];
    for (const re of patterns) {
      for (const m of segment.matchAll(re)) targets.push(m[2]);
    }
  }
  return targets;
}

function commandText(input) {
  if (typeof input.command === "string") return input.command;
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  return typeof ti.command === "string" ? ti.command : "";
}

async function main() {
  const input = await readInput();
  const tool = String(input.tool_name || "");
  if (tool && !EDIT_TOOLS.test(tool)) allow();

  const cwd = path.resolve(
    (typeof input.cwd === "string" && input.cwd) ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd()
  );
  const root = repoRoot(cwd);
  const paths = namedPaths(input, cwd);
  for (const raw of shellCreateTargets(commandText(input))) paths.push(resolvePath(raw, cwd));

  for (const abs of paths) {
    if (!isMarkdown(abs)) continue;
    let exists = false;
    try { exists = fs.existsSync(abs); } catch { exists = false; }
    const rel = relativeToRepo(abs, root);
    if (shouldBlockPath(rel, exists)) block(REASON);
  }
  allow();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(() => process.exit(0));
