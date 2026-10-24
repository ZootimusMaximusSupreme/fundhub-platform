#!/usr/bin/env node
// PreToolUse hook for Write, Edit and MultiEdit. Asks Chris before Claude
// changes a rule, a skill, CLAUDE.md, AGENTS.md or RULES-INDEX.md.
//
//   Rule file      -> prints the "ask" answer. Claude Code stops and shows Chris the edit.
//   Anything else  -> prints nothing (allow).
//   FUNDHUB_RULES_APPROVED=1 in the environment -> prints nothing for every file.
//
// A file counts as a rule file when its path as written OR its real path
// (links followed) lands in a rule folder. So a link name counts both ways:
//   .claude/skills/<name> is a link to .cursor/skills/<name>, and
//   a link made anywhere that points into a rule folder is still a rule file.
//
// What it guards: .ai/rules/, .cursor/rules/, .claude/rules/, .agents/skills/,
// .cursor/skills/, .claude/skills/, and any file named CLAUDE.md, AGENTS.md or
// RULES-INDEX.md. It only sees the edit tools. A shell command such as sed or mv
// is not seen.
//
// It never crashes. On any error it prints nothing and exits 0.
// Node built-ins only.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULE_DIRS = [".ai/rules", ".cursor/rules", ".claude/rules", ".agents/skills", ".cursor/skills", ".claude/skills"];
const RULE_NAMES = new Set(["CLAUDE.md", "AGENTS.md", "RULES-INDEX.md"]);
// If the caller names a tool, only these count. A Read of a rule file must never ask.
const EDIT_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit|apply_patch|ApplyPatch)$/i;

const ASK = {
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "ask",
    permissionDecisionReason: "Rule files need Chris's approval."
  }
};

async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch { /* a closed or broken pipe is fine */ }
  clearTimeout(timer);
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** The real path of p. When p does not exist yet, the real path of its nearest existing parent plus the rest. */
function realLoose(p) {
  let cur = p;
  const tail = [];
  for (let i = 0; i < 64; i += 1) {
    try {
      const real = fs.realpathSync(cur);
      return tail.length ? path.join(real, ...tail.reverse()) : real;
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return p;
      tail.push(path.basename(cur));
      cur = parent;
    }
  }
  return p;
}

/** Every file path the tool call names. */
function pathsIn(input) {
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const out = [];
  for (const key of ["file_path", "path", "notebook_path", "filePath"]) {
    if (typeof ti[key] === "string" && ti[key]) out.push(ti[key]);
  }
  // Codex edits with apply_patch, and the patch text names the files. This reading
  // is a guess at the Codex shape. It has not been proven in Codex.
  for (const value of Object.values(ti)) {
    if (typeof value !== "string" || !value.includes("*** ")) continue;
    for (const m of value.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+?)\s*$/gm)) out.push(m[1]);
  }
  return out;
}

/** The project roots to measure a path against. Both the given and the real spelling of each. */
function rootsFor(input) {
  const roots = new Set();
  for (const r of [process.env.CLAUDE_PROJECT_DIR, input.cwd, SCRIPT_ROOT]) {
    if (typeof r !== "string" || !r) continue;
    const abs = path.resolve(r);
    roots.add(abs);
    roots.add(realLoose(abs));
  }
  return roots;
}

/** The path relative to each root, with forward slashes. Skips roots the path is not inside. */
function relativesOf(raw, input, roots) {
  const base = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const given = raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
  const abs = path.resolve(base, given);
  const rels = new Set();
  for (const spelling of new Set([abs, realLoose(abs)])) {
    for (const root of roots) {
      const rel = path.relative(root, spelling);
      if (!rel || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) continue;
      rels.add(rel.split(path.sep).join("/"));
    }
  }
  return rels;
}

function isRuleRelative(rel) {
  // A worktree folder inside the main checkout holds its own copy of the repo.
  const inside = rel.replace(/^\.claude\/worktrees\/[^/]+\//, "");
  if (RULE_NAMES.has(inside.slice(inside.lastIndexOf("/") + 1))) return true;
  return RULE_DIRS.some((dir) => inside.startsWith(dir + "/"));
}

async function main() {
  const input = await readInput(); // always drain stdin first
  if (process.env.FUNDHUB_RULES_APPROVED === "1") return;
  if (typeof input.tool_name === "string" && input.tool_name && !EDIT_TOOLS.test(input.tool_name)) return;

  const roots = rootsFor(input);
  for (const raw of pathsIn(input)) {
    for (const rel of relativesOf(raw, input, roots)) {
      if (isRuleRelative(rel)) {
        process.stdout.write(JSON.stringify(ASK));
        return;
      }
    }
  }
}

main().catch(() => { /* a broken hook must never block an edit */ });
