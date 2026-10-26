#!/usr/bin/env node
// Hook for Claude and Cursor. Law: .ai/rules/animation-size-readable.md (owner-set 2026-10-25).
// Overlays must never ship too small, off the screen, as a black empty side, as an empty box behind Chris's head,
// or by reusing an earlier animated export as the source.
//
// Two triggers:
//   1. A save to marketing/ads/animation-plans/**/schedule.json (Claude PostToolUse
//      Write/Edit, Cursor afterFileEdit): runs the size check on that schedule.
//   2. A shell command that lays clips on a video (`build-from-schedule.py`,
//      Claude PreToolUse Bash, Cursor beforeShellExecution): runs the size check
//      on the schedule that script reads (tools/../schedule.json) and denies the
//      command when it fails. The build must also run through animation-clean-source.mjs,
//      which hash-checks the clean post-Submagic/pre-animation source and records the new output.
// The check itself: marketing/broll/scripts/validate-overlay-schedule.mjs.
// After a passing schedule save, also runs animation-overlay-frame-review-check (warn only).
//
// Fail -> deny / block. Builds fail closed; a broken source check is never a reason to lay clips on a video.
// Node built-ins only.

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALIDATOR = path.join(ROOT, 'marketing', 'broll', 'scripts', 'validate-overlay-schedule.mjs');
const FRAME_REVIEW_CHECK = path.join(ROOT, 'scripts', 'animation-overlay-frame-review-check.mjs');
const CLEAN_SOURCE = path.join(ROOT, 'scripts', 'animation-clean-source.mjs');
const SCHEDULE_RE = /(?:^|\/)marketing\/ads\/animation-plans\/.+\/schedule\.json$/;
const BUILD_RE = /([^\s'"]*build-from-schedule\.py)/;
const CLEAN_BUILD_RE = /(?:^|\s)(?:node\s+)?(?:[^\s'"]*\/)?scripts\/animation-clean-source\.mjs\s+build(?:\s|$)/;

function allow(event) {
  if (event === 'cursor-shell') process.stdout.write(JSON.stringify({permission: 'allow'}));
  process.exit(0);
}

function deny(reason, event) {
  const text = `Overlay build blocked. Fix the source or layout before lay-on.\n${reason}`;
  process.stdout.write(JSON.stringify({
    permission: 'deny',
    user_message: text,
    agent_message: text,
    decision: 'block',
    reason: text,
    hookSpecificOutput: {hookEventName: event === 'claude-post' ? 'PostToolUse' : 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: text},
  }));
  process.exit(2);
}

async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  const timer = setTimeout(() => process.stdin.destroy(), 3000);
  try {
    for await (const chunk of process.stdin) chunks.push(chunk);
  } catch { /* closed pipe */ }
  clearTimeout(timer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') || {};
  } catch {
    return {};
  }
}

function warnFrameReview(planDir) {
  if (process.env.FUNDHUB_SKIP_FRAME_REVIEW === '1') return;
  try {
    spawnSync(process.execPath, [FRAME_REVIEW_CHECK, planDir], {
      cwd: ROOT,
      stdio: ['ignore', 'ignore', 'inherit'],
      env: process.env,
    });
  } catch {
    /* warn-only */
  }
}

async function check(schedulePath, event, {warnReview = false} = {}) {
  if (!fs.existsSync(schedulePath)) allow(event);
  const {validateSchedule} = await import(pathToFileURL(VALIDATOR).href);
  const sched = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const {fails} = validateSchedule(sched, {repoRoot: ROOT});
  if (fails.length) deny(`${path.relative(ROOT, schedulePath) || schedulePath}:\n- ${fails.slice(0, 12).join('\n- ')}`, event);
  if (warnReview) warnFrameReview(path.dirname(schedulePath));
  allow(event);
}

async function checkBuild(schedulePath, command, event) {
  if (!CLEAN_BUILD_RE.test(command)) {
    deny(`Direct build-from-schedule.py commands are not allowed. Use:\nnode scripts/animation-clean-source.mjs build --plan <plan-dir> --source <clean-post-submagic.mp4> --out <new-animated.mp4> -- python3 tools/build-from-schedule.py ...`, event);
  }
  if (!fs.existsSync(schedulePath)) deny(`The overlay schedule is missing: ${schedulePath}`, event);
  const {validateSchedule} = await import(pathToFileURL(VALIDATOR).href);
  const sched = JSON.parse(fs.readFileSync(schedulePath, 'utf8'));
  const {fails} = validateSchedule(sched, {repoRoot: ROOT});
  if (fails.length) deny(`${path.relative(ROOT, schedulePath) || schedulePath}:\n- ${fails.slice(0, 12).join('\n- ')}`, event);
  const {readCleanSourceProof, validateCleanSource} = await import(pathToFileURL(CLEAN_SOURCE).href);
  const {proof} = readCleanSourceProof(path.dirname(schedulePath));
  const checked = validateCleanSource({
    planDir: path.dirname(schedulePath),
    sourcePath: proof.source_path,
    outputPath: path.join(path.dirname(schedulePath), '.overlay-source-gate-output.mp4'),
  });
  if (!checked.ok) deny(`Clean source failed:\n- ${checked.errors.join('\n- ')}`, event);
  allow(event);
}

let command = '';
let event = 'claude-pre';

try {
  const input = await readInput();
  const cwd = input.cwd || process.cwd();
  command = String(input.command || input.tool_input?.command || '');
  const isCursorShell = typeof input.command === 'string' && !input.tool_name;
  event = isCursorShell ? 'cursor-shell' : input.hook_event_name === 'PostToolUse' ? 'claude-post' : 'claude-pre';
  if (command) {
    const m = BUILD_RE.exec(command);
    if (!m) allow(event);
    const script = path.resolve(cwd, m[1]);
    await checkBuild(path.join(path.dirname(path.dirname(script)), 'schedule.json'), command, event);
  }
  const file = String(input.file_path || input.tool_input?.file_path || input.tool_input?.path || '');
  if (file && SCHEDULE_RE.test(file.split(path.sep).join('/'))) {
    await check(path.resolve(cwd, file), event, {warnReview: !command});
  }
  allow(event);
} catch (error) {
  if (typeof command === 'string' && BUILD_RE.test(command)) {
    deny(`The clean-source gate could not run: ${error instanceof Error ? error.message : String(error)}`, event);
  }
  process.exit(0);
}
