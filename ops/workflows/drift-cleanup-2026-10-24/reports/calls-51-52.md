# Calls 51 and 52

Commit: `e37da57ed9fefe9af20426362f4d81a23501c423`  
Branch: `drift-cleanup`  
Pushed: no

## What landed

Call 51: account access is standing for all later work. The 2026-10-17 sentence stayed. Added: "Owner-set 2026-10-24: standing, not tied to the launch."

Call 52: polish-order rule archived. Protected Present flow is its own rule, copied word for word, date 2026-08-20 kept.

## Files staged

- `.ai/rules/owner-authorized-account-ops.md`
- `.ai/rules/protected-present-flow.md`
- `.cursor/rules/protected-present-flow.mdc` (link)
- `.claude/rules/protected-present-flow.md` (link)
- `.cursor/rules/redundancy-before-ui-polish.mdc` (removed)
- `.claude/rules/redundancy-before-ui-polish.md` (removed)
- `ops/archive/ai-instructions-2026-10-24/.ai/rules/redundancy-before-ui-polish.md` (git mv, not deleted)
- `CLAUDE.md`
- `AGENTS.md`
- `docs/rules/RULES-INDEX.md`
- `ops/workflows/drift-cleanup-2026-10-24/PROGRESS.md`
- `ops/workflows/drift-cleanup-2026-10-24/plans/stale-plan.md` (M19 and M21)
- `ops/workflows/rules-drift-2026-10-24.md` (old rule name now says archived)

## Left unstaged because of other edits

None of CLAUDE.md, RULES-INDEX.md, or PROGRESS.md. Each of those diffs was only this work (PROGRESS.md still holds the two leftover bullets Chris said to keep).

`.ai/rules/owner-authorized-account-ops.md` already had one uncommitted example line from another agent (`Law: finish-the-requested-job...`). I did not rewrite it. It went in with this file because call 51 required staging the file.

## Pointers I could not change

- `ops/workflows/drift-cleanup-2026-10-24/phase-3-decisions.md` — the call record. Left as written.
- `ops/workflows/two-ios-apps-launch.md` and `ops/workflows/two-ios-apps-launch-2026-10-16.md` — dated launch boards, not instruction files.
- `tools/fundhub-ios/README.md` — dated iOS launch note, not an instruction file.
- `ops/workflows/drift-cleanup-2026-10-24/reports/proof-heartbeat-rules.md` and `reports/agent-work-rules.md` — I rewrote the leftover lines so they no longer say "not edited". Those reports are other agents' untracked files, so they were not staged.
- No pointer in `src/`, `api/`, `public/`, `netlify/`, `db/`, `e2e/`, or `scripts/`.
