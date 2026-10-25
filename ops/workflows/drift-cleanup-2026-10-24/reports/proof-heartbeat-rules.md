# Proof and heartbeat rules

Date: 2026-10-24. Branch: `drift-cleanup`. No commit.

## Files changed

- `.ai/rules/test-means-human-click.md` — Absorbed the live Playwright gate (merge M3), including the iPhone check (call 21) and the batch-board sentence (stale D4).
- `.ai/rules/full-end-to-end-audit.md` — Repeated phone, quiet-hours, checklist, and hard-stop lines now point at their owner files. Call 2 says sim people on live are removed right after.
- `.ai/rules/agentic-audit-guardrails.md` — Repeated audit, prove, and product-is-live lines now point at their owner files. Added the real-client ban. Kept "never turn red green by editing the test."
- `.ai/rules/sim-assume-paid.md` — Minting a sim person on the live CRM is only the Full End-To-End Audit carve-out (call 2). The credit-pull line points at the guardrails.
- `.ai/rules/product-is-live.md` — Folded the rest of the Inngest stay-on law. Plaid points at owner-calls-settled. Direct mail stays unbuilt until Chris names the switch (call 3).
- `.ai/rules/features-stay-on.md` — The key ban and the two ask-first items now point at their owner files.
- `.ai/rules/heartbeat-on-every-build.md` — Kept "3 times its schedule." Added the 6:00 a.m. Arizona pulse, owner-declined reds (call 17), the Mac OK line (call 29), and the fake-data ban from the Monday rule.
- `.ai/rules/no-test-data-on-production.md` — New rule (call 2). Two relative links, not copies.

## New rule law text

**Owner law (2026-10-20):** No test rows and no test logins are left on production; tests run on scratch databases.

The one carve-out: a Full End-To-End Audit that Chris orders by name may make sim people on live while it runs, and the agent removes them right after with the guarded delete (allowed since 2026-10-24).

## Files archived

Moved with `git mv`. Both links removed. Not deleted.

- `.ai/rules/live-playwright-100-before-manual.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/live-playwright-100-before-manual.md`
- `.ai/rules/pulse-registry.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/pulse-registry.md`
- `.ai/rules/monday-100-percent.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/monday-100-percent.md`

Cut sentences are in `ops/archive/ai-instructions-2026-10-24/removed-lines/`.

## Handoff

Do not treat these as done. They are files this agent does not own.

1. `docs/rules/RULES-INDEX.md`
   - Delete the `live-playwright-100-before-manual` row.
   - Change the test-means-human-click row to: test-means-human-click (both homes): When Chris says test: live Playwright to 100/100, then the agent clicks the live site like a person. Chris does no QA unless he offers.
   - Remove the `pulse-registry` row and the `monday-100-percent` row.
   - Add one line for `no-test-data-on-production`.

2. `CLAUDE.md`
   - Line 376: point the Test means click section at `test-means-human-click`, not `live-playwright-100-before-manual`.
   - Lines 288-290: remove the Monday is 100% section. The deadline passed.
   - Line 300: remove the `pulse-registry` paragraph. Keep the human-click line above it. Rename the heading at line 296 to "Human-click tests (owner-set 2026-08-16)".
   - In "Agents run the work," add this exception: Chris checks the shipped teleprompter on a real iPhone (owner-set 2026-10-13). Do not add the money walk. That walk was part of the Monday sweep and is archived with `monday-100-percent`.
   - Line 610: point the screenshot paragraph at `audit-screenshot-markups` (numbered red circles and yellow arrows). Drop the missing tool names `_mark-shots.mjs` and `_apply-marks.py`.
   - Add one short owner-set line for the new rule that ends: Same law: `.ai/rules/no-test-data-on-production.md`.

3. `AGENTS.md` line 45: say numbered red circles and yellow arrows, not a red box. Call 45.

4. `.agents/skills/fundhub-fixer/SKILL.md` lines 47-49 (D34, with call 22): keep step 1 and step 5. Replace steps 2 to 4 with these two lines:
   - Law: test-means-human-click (`.ai/rules/test-means-human-click.md`) - live Playwright to 100/100, then the agent walks the live path like a person; Chris does no manual pass unless he offers.
   - Law: named-fix-regression-gate (`.ai/rules/named-fix-regression-gate.md`) - after the fix a different tester tries to recreate the hole on the live site; the fixer never marks it done.

5. `.agents/skills/fundhub-fixer/SKILL.md` line 32 (D33): Law: test-means-human-click (`.ai/rules/test-means-human-click.md`) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); outbound prove sends go to Chris or prove addresses only; never print passwords.

6. `.agents/skills/fundhub-auditor/SKILL.md` line 54 (D14): Law: test-means-human-click (`.ai/rules/test-means-human-click.md`) - the agent or CI runs Playwright; Chris does not run it and does no QA.

7. `.agents/skills/fundhub-auditor/SKILL.md` lines 72-76 (D15): Law: test-means-human-click (`.ai/rules/test-means-human-click.md`) - fake e2e emails only (e2e+aff-*@, e2e+wl-*@); never print passwords. Keep "Never production client records." The credentials line becomes: Law: secrets-env-law (`.ai/rules/secrets-env-law.md`) - credentials come from gitignored .env / Netlify env only. The harness line becomes: Law: verify-scratch-only (`.ai/rules/verify-scratch-only.md`) - never run verify:e2e or the scratch harness against the live database.

8. `.agents/skills/fundhub-ui-auditor/SKILL.md` line 14 (call 2): replace "logged in with the existing e2e+ test accounts" with: Law: no-test-data-on-production (`.ai/rules/no-test-data-on-production.md`) - no test rows and no test logins are left on production; tests run on scratch databases. The one carve-out: a Full End-To-End Audit that Chris orders by name may make sim people on live while it runs, and the agent removes them right after with the guarded delete (allowed since 2026-10-24).

9. `src/pulse/registry.mjs` line 5 and `src/pulse/machine.mjs` line 10: the comments name `.cursor/rules/pulse-registry.mdc`. Point them at `heartbeat-on-every-build`. This agent does not edit app code.

## Skipped

- `.ai/rules/audit-screenshot-markups.md` — Call 45 changes CLAUDE.md and AGENTS.md. This rule already says numbered red circles and yellow arrows.
- `.ai/rules/sample-clients-consistent.md` — No call and no plan edit.
- `.ai/rules/verify-scratch-only.md` — It is the owner other files point at. No edit was planned.
- `.ai/rules/commas-catalog-hands-off.md` — No call and no plan edit.
- `.ai/rules/ghl-blacklisted.md` — No call and no plan edit.
- `.ai/rules/clarity-export-rate-limit.md` — No call and no plan edit.
- `.ai/rules/redundancy-before-ui-polish.md` — Call 52: polish-order job is done. File archived. The Protected core flow section now lives in `protected-present-flow`.
- Monday deadline text was not copied into heartbeat: the 2026-10-19 date, the 853 sweep, the 48-hour refactor watch, "Codex builds, Claude tests," and the money walk. Calls 21, 25, and 26 archive those with the rule.
- The Monday sentence "a real break reaches Chris by email (texts return when Twilio does)" stayed in the archived file. It is a status from that push, not a standing law.
- The Plaid quote "we just stay in test mode" is already on the Plaid row in `.ai/rules/owner-calls-settled.md`. No second edit.

## rules-drift-check lines that name these files

The check failed. 21 problems in the whole tree. These lines name this agent's files. The rest belong to other agents. This agent did not edit CLAUDE.md or the index.

```
CLAUDE.md:290
  Names ".cursor/rules/monday-100-percent.mdc" but it does not exist.
CLAUDE.md:290
  Names ".claude/rules/monday-100-percent.md" but it does not exist.
CLAUDE.md:300
  Names ".cursor/rules/pulse-registry.mdc" but it does not exist.
CLAUDE.md:300
  Names ".claude/rules/pulse-registry.md" but it does not exist.
CLAUDE.md:376
  Names ".cursor/rules/live-playwright-100-before-manual.mdc" but it does not exist.
CLAUDE.md:376
  Names ".claude/rules/live-playwright-100-before-manual.md" but it does not exist.
.ai/rules/no-test-data-on-production.md:1
  Rule "no-test-data-on-production" is not in docs/rules/RULES-INDEX.md.
.ai/rules/no-test-data-on-production.md:1
  Always-on owner law "no-test-data-on-production" is not named in CLAUDE.md.
```
