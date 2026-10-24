#!/usr/bin/env node
// PostToolUse hook for Write, Edit and MultiEdit. After Claude saves an ad script
// draft, it runs the ad checker on that file. If the checker fails, it tells
// Claude to fix the lines before the draft goes to Chris.
//
// WHICH FILES. Only dated draft files that sit directly in marketing/ads/scripts/:
//   2026-10-02.md, book-a-call-final-2026-10-03.md      (name ends in YYYY-MM-DD.md)
// Not checked: README.md and notes (no date), the collections named ALL-* and
// ADS-NOT-RUNNING-* or with "-since-" in the name (old filmed ads, not drafts),
// and anything in a subfolder (marketing/ads/scripts/machine/ is written by the
// app's writer, which runs its own strict check).
//
// WHICH MODE. File mode: `node scripts/ads/check-script.mjs <file>`, the same one
// `npm run ads:check` runs. The app's writer uses strict mode (checkScriptText with
// strict: true). The checker's command line has no strict switch, and strict mode
// reads one script body at a time, not a file of many ads and notes. So this hook
// does not run strict mode.
//
// Switch off for a session: FUNDHUB_AD_CHECK=off.
//
// Answers:   fail  -> {"decision":"block","reason":"..."}   (Claude reads the reason)
//            pass, crash, timeout, no checker -> prints nothing, exits 0.
// Node built-ins only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHECKER_REL = path.join("scripts", "ads", "check-script.mjs");
const DRAFT_DIR_RE = /(?:^|\/)marketing\/ads\/scripts\/([^/]+)$/;
const MAX_LINES_CHARS = 800; // the checker lines in the reason
const MAX_LINE_CHARS = 230;

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

/** True for a dated draft file directly inside marketing/ads/scripts/. */
function isDraftPath(p) {
  const m = DRAFT_DIR_RE.exec(String(p).split(path.sep).join("/"));
  if (!m) return false;
  const name = m[1];
  if (!/\.md$/i.test(name)) return false;
  if (/^(ALL-|ADS-NOT-RUNNING)/i.test(name) || /-since-/i.test(name)) return false;
  return /(?:^|[-_ ])\d{4}-\d{2}-\d{2}\.md$/i.test(name);
}

/** The checker nearest the file (its own repo), then the project, then the repo this hook lives in. */
function findChecker(abs, input) {
  let dir = path.dirname(abs);
  for (let i = 0; i < 10; i += 1) {
    const candidate = path.join(dir, CHECKER_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const base of [process.env.CLAUDE_PROJECT_DIR, input.cwd, SCRIPT_ROOT]) {
    if (typeof base !== "string" || !base) continue;
    const candidate = path.join(base, CHECKER_REL);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

/** The checker's own failing lines, trimmed to about 800 characters. */
function failingLines(stdout) {
  const lines = stdout.split(/\r?\n/).filter((l) => /^ {2}"/.test(l) || /^ {4}line /.test(l));
  const kept = [];
  let used = 0;
  for (const l of lines) {
    const t = l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS - 3) + "..." : l;
    if (used + t.length + 1 > MAX_LINES_CHARS) break;
    kept.push(t);
    used += t.length + 1;
  }
  return { kept, left: lines.length - kept.length };
}

async function main() {
  const input = await readInput(); // always drain stdin first
  if (process.env.FUNDHUB_AD_CHECK === "off") return;
  const ti = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  if (typeof ti.file_path !== "string" || !ti.file_path) return;

  const base = typeof input.cwd === "string" && input.cwd ? input.cwd : process.cwd();
  const abs = path.resolve(base, ti.file_path);
  let real;
  try { real = fs.realpathSync(abs); } catch { return; } // the file is not there: nothing to check
  const draftPath = isDraftPath(abs) ? abs : isDraftPath(real) ? real : null; // a link name counts, both ways
  if (!draftPath) return;

  const found = findChecker(abs, input);
  if (!found) return;
  // The checker starts itself only when its path matches its real path, so hand it the real one.
  const checker = fs.realpathSync(found);
  const repoRoot = path.resolve(path.dirname(checker), "..", "..");

  const run = spawnSync(process.execPath, [checker, abs], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 5000,
    maxBuffer: 4 * 1024 * 1024
  });
  if (run.error || run.status !== 1) return; // 0 = pass. Anything else is a crash or timeout, not a verdict.
  const out = String(run.stdout || "");
  if (!/need(?:s)? work/.test(out)) return;  // exit 1 without the checker's own summary = it crashed

  const normalized = draftPath.split(path.sep).join("/");
  const tail = normalized.slice(normalized.indexOf("marketing/ads/scripts/"));
  const { kept, left } = failingLines(out);
  const reason = [
    `Ad script check failed for ${tail} (node scripts/ads/check-script.mjs ${tail}):`,
    ...kept,
    left > 0 ? `(${left} more lines. Run the command above to see all of them.)` : "",
    "Fix these before showing Chris."
  ].filter(Boolean).join("\n");

  process.stdout.write(JSON.stringify({ decision: "block", reason }));
}

main().catch(() => { /* a broken hook must never block Claude */ });
