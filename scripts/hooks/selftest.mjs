#!/usr/bin/env node
// scripts/hooks/selftest.mjs — proves the three AI hooks in .claude/hooks/ do what
// their doc says (ops/workflows/drift-cleanup-2026-10-24/phase-7-hooks.md).
//
//   node scripts/hooks/selftest.mjs
//   node --test src/hooks/hooks-selftest.test.mjs      (the same run, inside npm test)
//
// Each hook runs as its own child process with sample JSON on stdin, the way Claude
// Code runs it. Rule files are only named in the sample JSON; nothing here edits them.
// The temp files live under os.tmpdir() and are deleted at the end.
//
// Exit 0 and one "OK" line when every check holds.
// Exit 1 on the first failure, with the name of the check and what went wrong.
//
// Node built-ins only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_DIR = path.join(REPO, ".claude", "hooks");
const CHECKER = path.join(REPO, "scripts", "ads", "check-script.mjs");

// ---------------------------------------------------------------------------
// Sample ad drafts. The bad one breaks seven independent rules, so it keeps
// failing even if one rule is retired. The clean one passes today's checker.
// If a rule change makes the clean one fail, the precondition below says so.
// ---------------------------------------------------------------------------

const BAD_DRAFT = [
  "# Self-test draft",
  "",
  "## Ad 97 - Self-test bad draft",
  "",
  "We leverage a robust and seamless system. At the end of the day it just works — period.",
  ""
].join("\n");

const CLEAN_DRAFT = [
  "# Self-test draft",
  "",
  "## Ad 98 - Self-test clean draft",
  "",
  "When a bank turns down your business, the file is the reason, and the file can be read.",
  "Most owners never see what the lender saw. The lender saw your score, your balances, and how many times your credit was pulled in the last two years.",
  "We read that same file first. Then we show you which lenders fit it, in what order, and what to fix before a single application goes out.",
  "You do not have to guess. You get a plain list of your options and the reason behind each one.",
  "A funding advisor walks you through the list on a short call. You ask questions and the advisor answers every one of them. Nobody pushes you to apply anywhere.",
  "Then you pick the lenders that fit your file. Applications go out in the order that protects your score, and you can watch each step happen.",
  "Every step is explained before it happens, so you always know what comes next and why it comes next.",
  "Soft pull only. Zero impact on your score. Nothing moves until you say so.",
  ""
].join("\n");

// Fake checkers, written next to a temp draft. They prove which checker the hook picks,
// how it reads the checker's answer, and that a checker that crashes is not a verdict.
const FAKE_CHECKER_LONG = [
  "const out = ['', 'f.md - 1 script checked, 1 needs work.', '', '  \"Ad 1 - Fake\" (starts line 3, 10 words)'];",
  "for (let i = 1; i <= 40; i += 1) out.push('    line ' + i + ': fake failure number ' + i + ' ' + 'x'.repeat(60));",
  "out.push('', '1 of 1 script needs work. Fix and run this again.');",
  "console.log(out.join('\\n'));",
  "process.exit(1);",
  ""
].join("\n");
const FAKE_CHECKER_CRASH = "throw new Error('boom');\n";

// ---------------------------------------------------------------------------
// Small tools
// ---------------------------------------------------------------------------

class SelfTestFailure extends Error {}

let checks = 0;
let tmpRoot = null;

function fail(name, detail) {
  throw new SelfTestFailure(`${name}\n${detail}`);
}

function runHook(hook, input, env = {}) {
  const r = spawnSync(process.execPath, [path.join(HOOK_DIR, hook)], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    timeout: 15000,
    env: { ...process.env, FUNDHUB_RULES_APPROVED: "", FUNDHUB_AD_CHECK: "", ...env }
  });
  return r;
}

function mustExitZero(name, r) {
  if (r.error) fail(name, `the hook did not run: ${r.error.message}`);
  if (r.status !== 0) fail(name, `expected exit 0, got ${r.status}\nstderr: ${r.stderr}`);
  if (r.stderr.trim() !== "") fail(name, `expected a quiet stderr, got: ${r.stderr}`);
}

function expectSilent(name, r) {
  mustExitZero(name, r);
  if (r.stdout.trim() !== "") fail(name, `expected no output, got: ${r.stdout}`);
  checks += 1;
}

function expectJson(name, r) {
  mustExitZero(name, r);
  try {
    return JSON.parse(r.stdout);
  } catch {
    return fail(name, `expected one line of JSON, got: ${JSON.stringify(r.stdout)}`);
  }
}

function expectAsk(name, r) {
  const j = expectJson(name, r);
  const out = j.hookSpecificOutput || {};
  if (out.hookEventName !== "PreToolUse") fail(name, `hookEventName was ${out.hookEventName}`);
  if (out.permissionDecision !== "ask") fail(name, `permissionDecision was ${out.permissionDecision}, expected "ask"`);
  if (!/approval/i.test(String(out.permissionDecisionReason))) fail(name, `the reason does not mention approval: ${out.permissionDecisionReason}`);
  checks += 1;
}

function expectBlock(name, r, tail) {
  const j = expectJson(name, r);
  if (j.decision !== "block") fail(name, `decision was ${j.decision}, expected "block"`);
  const reason = String(j.reason || "");
  if (!reason.includes(tail)) fail(name, `the reason does not name ${tail}:\n${reason}`);
  if (!/ line \S+: /.test(reason)) fail(name, `the reason has no checker failure line:\n${reason}`);
  if (!reason.endsWith("Fix these before showing Chris.")) fail(name, `the reason does not end with the fix line:\n${reason}`);
  if (reason.length > 1200) fail(name, `the reason is ${reason.length} characters, expected about 800 of checker lines plus two short lines`);
  checks += 1;
}

function put(base, rel, text = "x\n") {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
  return p;
}

function link(base, rel, target) {
  const p = path.join(base, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.symlinkSync(target, p);
}

// ---------------------------------------------------------------------------
// 1. session-rules.mjs
// ---------------------------------------------------------------------------

function testSessionRules(proj) {
  const start = (cwd, env = {}) => runHook("session-rules.mjs", { hook_event_name: "SessionStart", source: "startup", cwd }, { CLAUDE_PROJECT_DIR: cwd, ...env });

  // The real repo: reads the live index.
  const indexPath = path.join(REPO, "docs", "rules", "RULES-INDEX.md");
  if (!fs.existsSync(indexPath)) fail("session-rules: the repo has the index", `${indexPath} is missing`);
  const liveHeadings = fs.readFileSync(indexPath, "utf8").split(/\r?\n/).filter((l) => /^##\s+\S/.test(l)).map((l) => l.replace(/^##\s+/, "").trim());
  const real = expectJson("session-rules: real repo answers with JSON", start(REPO));
  const out = real.hookSpecificOutput || {};
  if (out.hookEventName !== "SessionStart") fail("session-rules: event name", `hookEventName was ${out.hookEventName}`);
  const text = String(out.additionalContext || "");
  for (const needle of ["RULES-INDEX", "CLAUDE.md", "AGENTS.md", "needs Chris's approval"]) {
    if (!text.includes(needle)) fail("session-rules: names the rule files", `the context does not contain "${needle}":\n${text}`);
  }
  if (liveHeadings.length && !text.includes(liveHeadings[0])) fail("session-rules: reads the index live", `the first heading "${liveHeadings[0]}" is missing:\n${text}`);
  if (!/\b\d+ rule files? in (?:\.ai|\.cursor)\/rules\./.test(text)) fail("session-rules: counts rule files", `no rule count in:\n${text}`);
  if (text.length > 1500) fail("session-rules: stays short", `${text.length} characters, the limit is 1500`);
  checks += 1;

  // A temp project: exact headings and exact count.
  const small = expectJson("session-rules: temp project answers with JSON", start(proj)).hookSpecificOutput.additionalContext;
  if (!small.includes("1. Alpha topic") || !small.includes("Beta topic")) fail("session-rules: lists the headings", small);
  if (small.includes("not a topic") || small.includes("inside a fence")) fail("session-rules: only ## headings outside code fences", small);
  if (!small.includes("1 rule file in .cursor/rules.")) fail("session-rules: counts .cursor/rules when .ai/rules is absent", small);
  checks += 1;

  // .ai/rules wins when it exists. README does not count.
  const proj2 = path.join(tmpRoot, "proj2");
  put(proj2, "CLAUDE.md");
  put(proj2, ".ai/rules/a.md");
  put(proj2, ".ai/rules/b.mdc");
  put(proj2, ".ai/rules/README.md");
  put(proj2, ".cursor/rules/c.mdc");
  const withAi = expectJson("session-rules: .ai/rules project answers with JSON", start(proj2)).hookSpecificOutput.additionalContext;
  if (!withAi.includes("2 rule files in .ai/rules.")) fail("session-rules: prefers .ai/rules", withAi);
  checks += 1;

  // No index file: it still says where the rules live and still carries the approval line.
  const proj3 = path.join(tmpRoot, "proj3");
  put(proj3, "CLAUDE.md");
  const noIndex = expectJson("session-rules: no index answers with JSON", start(proj3)).hookSpecificOutput.additionalContext;
  if (!noIndex.includes("could not be read") || !noIndex.includes("needs Chris's approval")) fail("session-rules: survives a missing index", noIndex);
  checks += 1;

  // A very long index: the answer stays under 1500 characters and keeps the approval line.
  const proj4 = path.join(tmpRoot, "proj4");
  put(proj4, "CLAUDE.md");
  put(proj4, "docs/rules/RULES-INDEX.md", Array.from({ length: 150 }, (_, i) => `## Topic number ${i} with some extra words in the name\n`).join("\n"));
  const big = expectJson("session-rules: long index answers with JSON", start(proj4)).hookSpecificOutput.additionalContext;
  if (big.length > 1500) fail("session-rules: long index stays under 1500", `${big.length} characters`);
  if (!big.includes("needs Chris's approval") || !big.includes("more, see the index")) fail("session-rules: long index keeps the approval line", big);
  checks += 1;

  // Bad stdin never crashes it.
  mustExitZero("session-rules: garbage stdin", runHook("session-rules.mjs", "not json", { CLAUDE_PROJECT_DIR: proj }));
  checks += 1;
}

// ---------------------------------------------------------------------------
// 2. guard-rule-edits.mjs
// ---------------------------------------------------------------------------

function testGuard(proj) {
  const call = (tool, file, cwd = proj, env = {}, extra = {}) =>
    runHook("guard-rule-edits.mjs", { hook_event_name: "PreToolUse", tool_name: tool, cwd, tool_input: { file_path: file, ...extra } }, { CLAUDE_PROJECT_DIR: cwd, ...env });
  const at = (rel) => path.join(proj, rel);

  // Asks for every kind of rule file.
  expectAsk("guard: rule in .claude/rules", call("Edit", at(".claude/rules/demo.md")));
  expectAsk("guard: rule in .cursor/rules", call("Write", at(".cursor/rules/demo.mdc")));
  expectAsk("guard: CLAUDE.md", call("Write", at("CLAUDE.md")));
  expectAsk("guard: AGENTS.md", call("Edit", at("AGENTS.md")));
  expectAsk("guard: RULES-INDEX.md", call("Edit", at("docs/rules/RULES-INDEX.md")));
  expectAsk("guard: MultiEdit counts too", call("MultiEdit", at(".claude/rules/demo.md")));
  expectAsk("guard: a new rule file that does not exist yet", call("Write", at(".cursor/rules/brand-new-rule.mdc")));
  expectAsk("guard: a new file under .ai/rules", call("Write", at(".ai/rules/brand-new-rule.md")));
  expectAsk("guard: a new file under .agents/skills", call("Write", at(".agents/skills/zz/SKILL.md")));
  expectAsk("guard: a worktree copy inside the project", call("Write", at(".claude/worktrees/w1/.cursor/rules/new.mdc")));

  // Link names count, in both directions.
  expectAsk("guard: a link that points INTO a rule folder", call("Edit", at("notes/alias.md")));
  expectAsk("guard: a path under .claude/skills that is a link to somewhere else", call("Edit", at(".claude/skills/demo/SKILL.md")));

  // A relative path is read from cwd.
  expectAsk("guard: relative path CLAUDE.md", call("Write", "CLAUDE.md"));

  // Silent for everything else.
  expectSilent("guard: ordinary source file", call("Edit", at("src/foo.mjs")));
  expectSilent("guard: ads README", call("Edit", at("marketing/ads/scripts/README.md")));
  expectSilent("guard: a read tool never asks", call("Read", at("CLAUDE.md")));
  expectSilent("guard: approved with FUNDHUB_RULES_APPROVED=1", call("Edit", at("CLAUDE.md"), proj, { FUNDHUB_RULES_APPROVED: "1" }));
  expectSilent("guard: garbage stdin", runHook("guard-rule-edits.mjs", "not json", { CLAUDE_PROJECT_DIR: proj }));
  expectSilent("guard: empty stdin", runHook("guard-rule-edits.mjs", "", { CLAUDE_PROJECT_DIR: proj }));
  expectSilent("guard: tool_input is null", runHook("guard-rule-edits.mjs", { tool_name: "Edit", tool_input: null }, { CLAUDE_PROJECT_DIR: proj }));
  expectSilent("guard: file_path is not a string", runHook("guard-rule-edits.mjs", { tool_name: "Edit", cwd: proj, tool_input: { file_path: 12345 } }, { CLAUDE_PROJECT_DIR: proj }));

  // Codex edits with apply_patch. This is a guess at the Codex shape, not proof of it.
  const patch = (file) => ({ command: `*** Begin Patch\n*** Update File: ${file}\n@@\n-old\n+new\n*** End Patch\n` });
  const codex = (file) => runHook("guard-rule-edits.mjs", { hook_event_name: "PreToolUse", tool_name: "apply_patch", cwd: proj, tool_input: patch(file) }, { CLAUDE_PROJECT_DIR: proj });
  expectAsk("guard: apply_patch on CLAUDE.md (guessed Codex shape)", codex("CLAUDE.md"));
  expectSilent("guard: apply_patch on a source file (guessed Codex shape)", codex("src/foo.mjs"));

  // The real repo.
  const real = (tool, rel) => call(tool, path.join(REPO, rel), REPO);
  expectAsk("guard: the repo's CLAUDE.md", real("Edit", "CLAUDE.md"));
  expectAsk("guard: the repo's AGENTS.md", real("Edit", "AGENTS.md"));
  expectAsk("guard: the repo's RULES-INDEX.md", real("Edit", "docs/rules/RULES-INDEX.md"));
  expectAsk("guard: a path in the repo's .claude/rules", real("Write", ".claude/rules/zz-selftest-does-not-exist.md"));
  expectAsk("guard: a path in the repo's .cursor/skills", real("Write", ".cursor/skills/zz-selftest/SKILL.md"));
  expectSilent("guard: the repo's package.json", real("Edit", "package.json"));
  expectSilent("guard: this self-test file", real("Edit", "scripts/hooks/selftest.mjs"));
}

// ---------------------------------------------------------------------------
// 3. check-ad-script.mjs
// ---------------------------------------------------------------------------

function testAdCheck(proj) {
  // Precondition: the checker still agrees with the two sample drafts.
  const badFile = put(proj, "marketing/ads/scripts/selftest-2099-01-01.md", BAD_DRAFT);
  const cleanFile = put(proj, "marketing/ads/scripts/selftest-2099-01-02.md", CLEAN_DRAFT);
  const cli = (file) => spawnSync(process.execPath, [CHECKER, file], { encoding: "utf8", timeout: 15000 });
  const cleanRun = cli(cleanFile);
  if (cleanRun.status !== 0) fail("ad check: the self-test's clean sample is out of date", `The checker now rejects it. Update CLEAN_DRAFT in scripts/hooks/selftest.mjs.\n${cleanRun.stdout}${cleanRun.stderr}`);
  const badRun = cli(badFile);
  if (badRun.status !== 1) fail("ad check: the self-test's bad sample is out of date", `The checker now passes it. Update BAD_DRAFT in scripts/hooks/selftest.mjs.\n${badRun.stdout}${badRun.stderr}`);

  // Other files that must never be checked, each holding the BAD text so a wrong check would show.
  const readme = put(proj, "marketing/ads/scripts/README.md", BAD_DRAFT);
  const notes = put(proj, "marketing/ads/scripts/ad-system-notes.md", BAD_DRAFT);
  const collection = put(proj, "marketing/ads/scripts/ALL-ADS-since-2099-01-01.md", BAD_DRAFT);
  const notRunning = put(proj, "marketing/ads/scripts/ADS-NOT-RUNNING-since-2099-01-01.md", BAD_DRAFT);
  const machine = put(proj, "marketing/ads/scripts/machine/x-2099-01-01.md", BAD_DRAFT);
  const elsewhere = put(proj, "src/note-2099-01-01.md", BAD_DRAFT);
  const noDate = put(proj, "marketing/ads/scripts/draft.md", BAD_DRAFT);
  const wrongType = put(proj, "marketing/ads/scripts/2099-01-01.txt", BAD_DRAFT);
  const missing = path.join(proj, "marketing/ads/scripts/2099-02-02.md");

  const call = (tool, file, env = {}) =>
    runHook("check-ad-script.mjs", { hook_event_name: "PostToolUse", tool_name: tool, cwd: proj, tool_input: { file_path: file } }, { CLAUDE_PROJECT_DIR: proj, ...env });

  const tail = "marketing/ads/scripts/selftest-2099-01-01.md";
  expectBlock("ad check: blocks a draft that breaks rules (checker found from the hook's own repo)", call("Write", badFile), tail);
  expectBlock("ad check: blocks on Edit", call("Edit", badFile), tail);
  expectBlock("ad check: blocks on MultiEdit", call("MultiEdit", badFile), tail);
  expectBlock("ad check: blocks (checker found from CLAUDE_PROJECT_DIR)", call("Write", badFile, { CLAUDE_PROJECT_DIR: REPO }), tail);
  link(proj, "notes/link-to-draft.md", "../marketing/ads/scripts/selftest-2099-01-01.md");
  expectBlock("ad check: a link name that points at a draft counts", call("Write", path.join(proj, "notes/link-to-draft.md")), tail);
  expectSilent("ad check: passes a clean draft", call("Write", cleanFile));
  expectSilent("ad check: README is not checked", call("Write", readme));
  expectSilent("ad check: a notes file is not checked", call("Write", notes));
  expectSilent("ad check: an ALL-ADS collection is not checked", call("Write", collection));
  expectSilent("ad check: an ADS-NOT-RUNNING report is not checked", call("Write", notRunning));
  expectSilent("ad check: the machine folder is not checked", call("Write", machine));
  expectSilent("ad check: a dated file outside marketing/ads/scripts is not checked", call("Write", elsewhere));
  expectSilent("ad check: a file with no date is not checked", call("Write", noDate));
  expectSilent("ad check: a .txt file is not checked", call("Write", wrongType));
  expectSilent("ad check: a file that is not there", call("Write", missing));
  expectSilent("ad check: FUNDHUB_AD_CHECK=off", call("Write", badFile, { FUNDHUB_AD_CHECK: "off" }));
  expectSilent("ad check: garbage stdin", runHook("check-ad-script.mjs", "not json", { CLAUDE_PROJECT_DIR: proj }));
  expectSilent("ad check: empty stdin", runHook("check-ad-script.mjs", "", { CLAUDE_PROJECT_DIR: proj }));
  expectSilent("ad check: file_path is not a string", runHook("check-ad-script.mjs", { tool_name: "Write", cwd: proj, tool_input: { file_path: 7 } }, { CLAUDE_PROJECT_DIR: proj }));

  // The checker next to the draft wins. Its answer is read line by line and cut to about 800 characters.
  const proj5 = path.join(tmpRoot, "proj5");
  put(proj5, "scripts/ads/check-script.mjs", FAKE_CHECKER_LONG);
  const longDraft = put(proj5, "marketing/ads/scripts/2099-03-03.md", "x\n");
  const longRun = runHook("check-ad-script.mjs", { hook_event_name: "PostToolUse", tool_name: "Write", cwd: proj5, tool_input: { file_path: longDraft } }, { CLAUDE_PROJECT_DIR: proj });
  expectBlock("ad check: reads the nearest checker's lines", longRun, "marketing/ads/scripts/2099-03-03.md");
  const longReason = JSON.parse(longRun.stdout).reason;
  if (!longReason.includes("fake failure number 1 ")) fail("ad check: shows the first failing line", longReason);
  if (longReason.includes("fake failure number 40 ")) fail("ad check: cuts the lines to about 800 characters", longReason);
  if (!/\(\d+ more lines\./.test(longReason)) fail("ad check: says how many lines were left out", longReason);

  // A checker that crashes (exit 1, no summary) is not a verdict. The hook stays silent.
  const proj6 = path.join(tmpRoot, "proj6");
  put(proj6, "scripts/ads/check-script.mjs", FAKE_CHECKER_CRASH);
  const crashDraft = put(proj6, "marketing/ads/scripts/2099-04-04.md", "x\n");
  expectSilent("ad check: a checker that crashes is not a verdict", runHook("check-ad-script.mjs", { hook_event_name: "PostToolUse", tool_name: "Write", cwd: proj6, tool_input: { file_path: crashDraft } }, { CLAUDE_PROJECT_DIR: proj }));

  // A real draft from the repo is read, never written: today's answer must match the checker's own answer.
  const realDraft = path.join(REPO, "marketing", "ads", "scripts", "2026-10-14.md");
  if (fs.existsSync(realDraft)) {
    const direct = cli(realDraft);
    const viaHook = call("Edit", realDraft, { CLAUDE_PROJECT_DIR: REPO });
    if (direct.status === 0) expectSilent("ad check: a real draft that the checker passes stays silent", viaHook);
    else expectBlock("ad check: a real draft that the checker fails is blocked", viaHook, "marketing/ads/scripts/2026-10-14.md");
  }
}

// ---------------------------------------------------------------------------

function main() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "fundhub-hooks-"));
  const proj = path.join(tmpRoot, "proj");

  put(proj, "CLAUDE.md");
  put(proj, "AGENTS.md");
  put(proj, "docs/rules/RULES-INDEX.md", "# Rules index\n\n## 1. Alpha topic\n\n- a rule\n\n### not a topic\n\n```\n## inside a fence\n```\n\n## Beta topic\n");
  put(proj, ".cursor/rules/demo.mdc");
  put(proj, ".claude/rules/demo.md");
  put(proj, "real-skills/demo/SKILL.md");
  put(proj, "src/foo.mjs");
  put(proj, "marketing/ads/scripts/README.md");
  link(proj, ".claude/skills/demo", "../../real-skills/demo"); // a folder link, like .claude/skills/<name> in the repo
  link(proj, "notes/alias.md", "../.claude/rules/demo.md");     // a file link that points into a rule folder

  testSessionRules(proj);
  testGuard(proj);
  testAdCheck(proj);
}

try {
  main();
  console.log(`hooks self-test OK: ${checks} checks passed (session-rules, guard-rule-edits, check-ad-script)`);
} catch (err) {
  if (err instanceof SelfTestFailure) console.error(`hooks self-test FAILED at: ${err.message}`);
  else console.error(`hooks self-test CRASHED: ${err && err.stack ? err.stack : err}`);
  process.exitCode = 1;
} finally {
  if (tmpRoot) {
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
