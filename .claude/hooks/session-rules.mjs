#!/usr/bin/env node
// SessionStart hook. Tells a new Claude session where the rules live.
//
// It prints one line of JSON with:
//   - the files to read (CLAUDE.md, AGENTS.md, docs/rules/RULES-INDEX.md)
//   - the topic headings, read live from RULES-INDEX.md (never copied here)
//   - how many rule files exist (.ai/rules if that folder exists, else .cursor/rules)
//   - the line that says a rule edit needs Chris's approval
// The text stays under 1500 characters.
//
// It never blocks a session. On any error it prints nothing and exits 0.
// Node built-ins only. Reads stdin only to drain it; the answer does not depend on it.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_CHARS = 1500;
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const INDEX_REL = "docs/rules/RULES-INDEX.md";
const RULE_HOMES = [".ai/rules", ".cursor/rules"]; // the first folder that exists is the one counted

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

/** The project root: the first candidate that looks like this repo. */
function findRoot(input) {
  for (const c of [process.env.CLAUDE_PROJECT_DIR, input.cwd, SCRIPT_ROOT]) {
    if (typeof c !== "string" || !c) continue;
    if (fs.existsSync(path.join(c, "CLAUDE.md")) || fs.existsSync(path.join(c, INDEX_REL))) return c;
  }
  return SCRIPT_ROOT;
}

/** Every "## " heading in RULES-INDEX.md, in file order. null when the file cannot be read. */
function readTopics(root) {
  let text;
  try { text = fs.readFileSync(path.join(root, INDEX_REL), "utf8"); } catch { return null; }
  const topics = [];
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const m = /^##\s+(\S.*?)\s*$/.exec(line); // "###" does not match: the third # is not a space
    if (m) topics.push(m[1]);
  }
  return topics;
}

function countIn(dir, depth) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return 0; }
  let n = 0;
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    if (e.isDirectory()) { if (depth < 3) n += countIn(path.join(dir, e.name), depth + 1); continue; }
    if (/\.(md|mdc)$/i.test(e.name) && !/^readme/i.test(e.name)) n += 1; // a link to a file counts too
  }
  return n;
}

/** { home, n } for the first rule folder that exists, else null. */
function countRuleFiles(root) {
  for (const home of RULE_HOMES) {
    const dir = path.join(root, home);
    let isDir = false;
    try { isDir = fs.statSync(dir).isDirectory(); } catch { /* not there */ }
    if (isDir) return { home, n: countIn(dir, 0) };
  }
  return null;
}

function compose(topics, count) {
  const lines = ["Fundhub rules live in CLAUDE.md, AGENTS.md and docs/rules/RULES-INDEX.md. The index lists every rule by topic. Read it to find the rule for your task."];
  if (topics === null) lines.push("RULES-INDEX.md could not be read, so there is no topic list.");
  else if (topics.length) lines.push(`Topics in RULES-INDEX.md: ${topics.join("; ")}.`);
  if (count) lines.push(`${count.n} rule file${count.n === 1 ? "" : "s"} in ${count.home}.`);
  lines.push(
    "Ad video, broll, Remotion, or animation overlays: read .ai/rules/animation-rules.md and marketing/ads/ANIMATION-RULES.md from disk before plan or edit — not memory."
  );
  lines.push("Editing a rule, skill, CLAUDE.md or AGENTS.md needs Chris's approval.");
  return lines.join("\n");
}

async function main() {
  const input = await readInput();
  const root = findRoot(input);
  const topics = readTopics(root);
  const count = countRuleFiles(root);

  // Over the limit: drop topics from the end until it fits, then say how many were left out.
  let shown = topics ? topics.slice() : topics;
  let text = compose(shown, count);
  while (shown && shown.length && text.length > MAX_CHARS) {
    shown.pop();
    text = compose(shown.concat(`(${topics.length - shown.length} more, see the index)`), count);
  }
  if (text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS - 3) + "...";

  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}

main().catch(() => { /* a broken hook must never block a session */ });
