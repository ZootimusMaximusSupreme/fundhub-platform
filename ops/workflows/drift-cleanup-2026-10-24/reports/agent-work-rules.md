# Agent-work rules

Date: 2026-10-24. Branch: `drift-cleanup`. This agent edited only the agent-work rules it was given. It did not commit.

## Files changed

- `.ai/rules/fourth-grade-english.md` — Added the no-status-code line and the "a handoff is never a refusal" block from the builder, fixer, and orchestrator skills.
- `.ai/rules/finish-the-answer.md` — This file is now the one home of the ask-first list (with the 2026-10-24 test-row exception) and of "never invent." Extra-hole lines point at `no-extra-holes`.
- `.ai/rules/no-remote-control.md` — Call 9: the cloud gets the same GitHub path as the Mac. Dead Mac-bridge paths are gone. The live path points at `github-ships-main`.
- `.ai/rules/split-and-proceed.md` — Folded the required-output list from CLAUDE.md section 0. The ask line points at `finish-the-requested-job`.
- `.ai/rules/owner-go-no-repeat-approval.md` — Folded `stop-asking-follow-the-rules` (owner-set 2026-10-23). The ask-one-question line points at `finish-the-requested-job`.
- `.ai/rules/finish-the-requested-job.md` — Folded the launch release-check law (owner law 2026-10-17), plus the stuck rule (call 12) and the scope-creep line (call 13).
- `.ai/rules/owner-authorized-account-ops.md` — The example's last sentence points at `finish-the-requested-job`.
- `.ai/rules/owner-scope-minimal-diff.md` — Leftovers go on the shared board. The launch pointer now sits inside `finish-the-requested-job`. Call 19 added the third exception (owner-set 2026-09-18): same hole, cause one layer over, fix it and say which file.
- `.ai/rules/no-extra-holes.md` — Launch checks point at `finish-the-requested-job`. Added the 2026-09-08 "other things I noticed" line. The one-hole pointer now names `three-step-repair`.
- `.ai/rules/three-step-repair.md` — Folded `one-issue-per-thread`. Call 22: a different tester tries the hole, and the fixer never marks done.
- `.ai/rules/named-fix-regression-gate.md` — Launch checks, extra holes, and the live-database ban now point at the rules that own them.
- `.ai/rules/audit-vs-fix-router.md` — Full End-To-End Audit, the one-hole law, and parallel work now point at the rules that own them. `stop-asking-follow-the-rules` in the ambiguous-test line is now `owner-go-no-repeat-approval`.
- `.ai/rules/rules-no-drift.md` — Folded `rules-for-claude-and-cursor`, including the 2026-09-21 owner law and the skills home.
- `.ai/rules/no-claude-in-cursor.md` — Call 20: the example now says write the need on the board.
- `.ai/rules/dictator-owner-overrides.md` — The repeated secret, paste, and ops bullets now point at the rules that own them. The cloud-env paste lesson is gone (call 28 with call 9).
- `.ai/rules/owner-calls-settled.md` — Plaid cell keeps Chris's "we just stay in test mode" line. Added the three 2026-10-13 calls from the broken-items board (join link, Twilio credit, five welcome templates).
- `.ai/rules/no-api-spend-for-now.md` — The key ban points at `secrets-env-law`. The rule stays (no end date).

Cut sentences are in `ops/archive/ai-instructions-2026-10-24/removed-lines/`. Each note has the date and the reason.

## Files archived

Moved with `git mv`. Links removed. No Claude link existed for the lattice rule (it was Cursor-only).

- `.ai/rules/stop-asking-follow-the-rules.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/stop-asking-follow-the-rules.md` (merged into `owner-go-no-repeat-approval`)
- `.ai/rules/approved-launch-release-blockers.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/approved-launch-release-blockers.md` (merged into `finish-the-requested-job`)
- `.ai/rules/one-issue-per-thread.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/one-issue-per-thread.md` (merged into `three-step-repair`)
- `.ai/rules/rules-for-claude-and-cursor.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/rules-for-claude-and-cursor.md` (merged into `rules-no-drift`)
- `.ai/rules/grok-lattice-overseer-perpetual.md` → `ops/archive/ai-instructions-2026-10-24/.ai/rules/grok-lattice-overseer-perpetual.md` (call 25; tied to the 2026-09-20 launch board)

## Handoff

Do not copy these laws again. Point at the file that now holds them.

### `docs/rules/RULES-INDEX.md`

- Delete: `` `stop-asking-follow-the-rules` (both homes): When the rules settle a choice, make it and say what you did. ``
- Replace the `owner-go-no-repeat-approval` row with: `` `owner-go-no-repeat-approval` (both homes): Carry authorized work through without repeated approval questions; when the rules settle a choice, make it and say what you did. ``
- Replace the `finish-the-requested-job` row with: `` `finish-the-requested-job` (both homes): Finish approved work through required checks, including the launch release checks; holds the stuck rule and the scope-creep line. ``
- Delete: `` `approved-launch-release-blockers` (both homes): Fix failed required release checks after launch approval without repeat permission prompts. ``
- Delete: `` `one-issue-per-thread` (both homes): One named hole per chat — the agent starts each chat from the board. ``
- Replace the `three-step-repair` row with: `` `three-step-repair` (both homes): Verify → Fix → Finish in one paste; one named hole per chat, started from the board. ``
- Delete: `` `rules-for-claude-and-cursor` (both homes): A rule or skill Chris asks for is written for Claude and Cursor. ``
- Replace the `rules-no-drift` row with: `` `rules-no-drift` (both homes): A rule or skill is written once, linked for Claude and Cursor, updates every line that says otherwise, and updates the index. ``
- Delete: `` `grok-lattice-overseer-perpetual` (Cursor-only on purpose): The Grok overseer stays on the launch lattice and respawns Composer on a fail (glob rule). ``
- Replace the `finish-the-answer` row with: `` `finish-the-answer` (both homes): Look up the next fact and finish the answer in the same reply; the ask-first list lives here. ``

### `CLAUDE.md` (do not copy the folded text into a second rule)

- Lines 125-127: remove the approved-launch paragraph. The law is in `.ai/rules/finish-the-requested-job.md`.
- Line 190: change the same-law target to `.ai/rules/rules-no-drift.md`. Drop `.ai/rules/rules-for-claude-and-cursor.md`, `.cursor/rules/rules-for-claude-and-cursor.mdc`, and `.claude/rules/rules-for-claude-and-cursor.md`.
- Line 356: change to `Same law: .ai/rules/three-step-repair.md.` Drop `.cursor/rules/one-issue-per-thread.mdc`.
- Line 388: keep the `no-claude-in-cursor` half. Remove the sentence `The Grok overseer stays on the launch lattice.` Remove `.cursor/rules/grok-lattice-overseer-perpetual.mdc`.
- Line 420: change the same-law target to `.ai/rules/owner-go-no-repeat-approval.md`. Drop both `stop-asking-follow-the-rules` paths.
- Line 440: change `` `stop-asking-follow-the-rules`, 2026-10-23 `` to `` `owner-go-no-repeat-approval`, 2026-10-23 ``.
- Section 0: the required-output list now lives in `.ai/rules/split-and-proceed.md`. Point there. Do not paste the list again.
- Section 2 "Never invent" and the ask-first list now live in `.ai/rules/finish-the-answer.md`. Point there. Do not paste them again.
- Section 8 "The stuck rule" and "Scope creep check": they now live in `.ai/rules/finish-the-requested-job.md` under `## Stuck rule` and `## Scope creep`. Point there. Do not paste them into a guardrails rule.

### `AGENTS.md`

- Line 41: remove the bullet that starts `An approved launch includes repairs to every required release check that fails`. Lines 23-36 already say it.

### `.ai/README.md`

- Under `## To add or change a rule`, keep steps 1 to 4 and add these two lines, pointer last: `The steps below are the commands.` then `Law: rules-no-drift (.ai/rules/rules-no-drift.md) - a rule is written once, linked for Cursor and Claude, and every older line that says otherwise is rewritten.`

### Skills (other agents own these)

- `.agents/skills/fundhub-fixer/SKILL.md`, `.agents/skills/fundhub-builder/SKILL.md`, and `.agents/skills/fundhub-orchestrator/SKILL.md`: replace the "Third or fourth grade" blocks and the "Never phrase a handoff as a no" blocks with `Law: fourth-grade-english (.ai/rules/fourth-grade-english.md) - talk to Chris at a 4th grade reading level. No status codes. No cryptic shorthand. A handoff is never a refusal.` Put the old "Third or fourth grade" wording in each skill's removed-lines note. Reason: `older wording; fourth-grade-english says 4th grade`.
- `.agents/skills/fundhub-fixer/SKILL.md` Prove path: add `A different tester than the fixer tries to recreate the same hole on the live site. The fixer never marks done.`
- `.agents/skills/fundhub-fixer/SKILL.md` prime rule 3 and `.agents/skills/fundhub-orchestrator/SKILL.md` "Two chances per ticket": change them to `Two failed attempts at the same fix mean change the fix. Never try the same fix a third time. For a required check or any approved work, keep going with a different fix until a finish-the-requested-job stop reason applies.` Keep the orchestrator's quota checkpoint. It also lives in `finish-the-requested-job`.

### Not this agent's files

- `scripts/rules-drift-allow.json`: remove `grok-lattice-overseer-perpetual` from the Cursor-only list. This is code. Left for the leftovers list.
- `ops/workflows/codex-build-claude-test-2026-10-13.md`: archive it (call 25, a one-day rule). Not on this agent's file list.
- `.ai/rules/model-by-job.md` when phase 5 folds CLAUDE.md section 1 (call 48, not applied here): add `Opus plans and checks slices, Sonnet may do the moves (owner-set 2026-10-21). Chris also said on 2026-10-24 that Opus is not really needed here.`
- `monday-100-percent`: "Codex builds, Claude tests" goes away when that rule is archived (call 25). `model-by-job` already says Sonnet for the back end, then Opus for the front end.

## Skipped

- `.ai/rules/ux-guidance-urls-first.md`, `.ai/rules/one-step-adhd.md`, `.ai/rules/texting-hours.md`, `.ai/rules/fundhub-company-name.md`, `.ai/rules/build-spec-then-backend-then-frontend.md`, `.ai/rules/grok-no-displays.md`: no dedupe action, no stale action, and no call changes their text.
- `.ai/rules/model-by-job.md`: no plan edit. Call 25 is already what this file says. Call 48 is in the handoff above.
- `.ai/rules/owner-authorized-account-ops.md` — Call 51 (2026-10-24): account access is standing for all later work, not tied to the launch.
- `ops/workflows/broken-walkthrough-plan-2026-10-14.md` was not archived. The Maybe list says Chris decides. The three owner calls from that board are now in `owner-calls-settled`.

## Drift check lines that name these files

`node scripts/rules-drift-check.mjs` failed. The lines that name this agent's files are all pointers in files this agent was told not to edit:

```
CLAUDE.md:127
  Names ".cursor/rules/approved-launch-release-blockers.mdc" but it does not exist.
CLAUDE.md:127
  Names ".claude/rules/approved-launch-release-blockers.md" but it does not exist.
CLAUDE.md:190
  Names ".ai/rules/rules-for-claude-and-cursor.md" but it does not exist.
CLAUDE.md:190
  Names ".cursor/rules/rules-for-claude-and-cursor.mdc" but it does not exist.
CLAUDE.md:190
  Names ".claude/rules/rules-for-claude-and-cursor.md" but it does not exist.
CLAUDE.md:356
  Names ".cursor/rules/one-issue-per-thread.mdc" but it does not exist.
CLAUDE.md:388
  Names ".cursor/rules/grok-lattice-overseer-perpetual.mdc" but it does not exist.
CLAUDE.md:420
  Names ".cursor/rules/stop-asking-follow-the-rules.mdc" but it does not exist.
CLAUDE.md:420
  Names ".claude/rules/stop-asking-follow-the-rules.md" but it does not exist.
AGENTS.md:41
  Names ".cursor/rules/approved-launch-release-blockers.mdc" but it does not exist.
```

The check did not flag the old index rows. The index handoff above is still required by the plan. Other failures in that run (`no-test-data-on-production`, `animation-ad-style`, `clickfunnels-html-api-push`) belong to other agents.
