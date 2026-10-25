// src/hooks/hooks-selftest.test.mjs
//
// Runs scripts/hooks/selftest.mjs inside `npm test`. That script starts each AI hook
// as its own process, feeds it sample JSON, and checks the answer:
//   session-rules.mjs     SessionStart: where the rules live, the live topic list, the rule count
//   guard-rule-edits.mjs  PreToolUse: asks before a rule, skill, CLAUDE.md, AGENTS.md or RULES-INDEX.md edit
//                         FUNDHUB_RULES_APPROVED=0 still asks; =1 is silent
//   check-ad-script.mjs   PostToolUse: runs the ad checker on a dated draft in marketing/ads/scripts/
//   guard-env-masks.mjs   PreToolUse: denies a Netlify mask in .env / credentials/
//
// Plain `node --test`: no database, no network. The temp files it writes go under
// os.tmpdir() and are deleted when it ends.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELFTEST = fileURLToPath(new URL("../../scripts/hooks/selftest.mjs", import.meta.url));

test("the AI hooks pass their self-test, including FUNDHUB_RULES_APPROVED=0 still asks", () => {
  const run = spawnSync(process.execPath, [SELFTEST], { encoding: "utf8", timeout: 120000 });
  assert.equal(run.error, undefined, `the self-test did not start: ${run.error && run.error.message}`);
  assert.equal(run.status, 0, `hooks self-test failed:\n${run.stderr}\n${run.stdout}`);
  assert.match(run.stdout, /hooks self-test OK: \d+ checks passed/);
});
