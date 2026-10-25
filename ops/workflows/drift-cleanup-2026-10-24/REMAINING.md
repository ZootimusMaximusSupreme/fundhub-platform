# What is left in the drift cleanup

Written 2026-10-24 when Chris's weekly usage hit 98%. The Claude run was stopped on purpose. Branch: `drift-cleanup`. Not merged. Everything here can be done by a Cursor agent.

## Where it stands

| Phase | State |
|---|---|
| 1. Safety | Done. `.codex/config.toml` was already ignored on main. No real secret is tracked. |
| 2. One home | Done and checked. Rules live once at `.ai/rules/<name>.md`. Skills live once at `.agents/skills/<name>/`. `.cursor/` and `.claude/` hold links. |
| 3. Conflicts | Done. 50 fights listed in `phase-3-conflicts.md`. Chris's deciding rules and all 50 calls are in `phase-3-decisions.md`. **The calls are made but NOT yet applied to the files.** |
| 4. Merge and archive | **Not started on the files.** The two plans are written: `plans/dedupe-plan.md` and `plans/stale-plan.md`. |
| 5. Short CLAUDE.md and AGENTS.md | **Not started.** |
| 6. Old copies | Listed in `phase-6-old-copies.md` (+ `.tsv`). **Nothing removed. Waiting for Chris's yes.** |
| 7. Hooks | Done and wired in `.claude/settings.json` and `.codex/hooks.json`. Self-test passes (58 checks). A few fixes are left (item 5 below). |

## What is left, in order

### 1. Apply the 50 calls
Read `phase-3-decisions.md`, then `phase-3-conflicts.md` for the exact quotes. Change the losing line so it matches the winner. Rule files are `.ai/rules/*.md`, skill files are `.agents/skills/*/SKILL.md`. The memory-note calls (6, 38, 42, 47, 49, 50) are already done by Claude. Calls that live in CLAUDE.md sections (1, 4, 5, 7, 12, 13, 14, 16, 21, 23, 24, 45, 48) are applied when item 3 moves those sections into rule files.

### 2. Merge duplicates and archive stale files
- `plans/dedupe-plan.md`: 134 file sections of exact actions (replace a repeat with a pointer, fold a unique fact into the owner file, at most 8 file merges).
- `plans/stale-plan.md`: files to archive, 44 lines to remove (append each to the archive), a dead-reference fix list, and an "Order I would work in" section at the end.
- Also archive what `phase-3-decisions.md` lists: rules `monday-100-percent`, `pulse-registry`, `grok-lattice-overseer-perpetual`, `ui-standards`, `approved-launch-release-blockers` (fold anything unique into `finish-the-requested-job` first), the board `ops/workflows/codex-build-claude-test-2026-10-13.md`, and the board `ops/archive/ai-instructions-2026-10-24/ops/workflows/ad-scripts-2026-10-02.md` (opener ban in `.ai/rules/ad-no-recycled-lines.md`, day count in `.ai/rules/copy-certainty.md`).
- Archive folder: `ops/archive/ai-instructions-2026-10-24/`. Move, never delete. Text you cut goes to `removed-lines/<path with / as __>.md` in that folder.
- Add new rule `no-test-data-on-production` (call 2).

### 3. Short CLAUDE.md and AGENTS.md (Phase 5)
- CLAUDE.md is 770 lines. Make it about 150 lines (cap 200). Each law lives in ONE rule file. CLAUDE.md points to it.
- **Keep every numbered heading, in order, with its old text: §0 to §12 including 3a, 3b, 3c.** 515 files in `src/`, `api/`, `scripts/` point at them (§12 441 times, §7 110, §8 48, §11 36, §2 19, §4 15, §3a 11, §10 11, §6 9, §3c 9).
- Keep the line `docs/rules/UI-STANDARDS.md` is law inside CLAUDE.md (test `src/ui/screen-standard.test.mjs` reads it).
- CLAUDE.md sections with no rule file yet become new rules (suggested names): §2 and "Owner decisions are final" to `ground-rules`; §3b `everything-in-the-repo`; §3c `marketing-tooling-from-chat`; §4 `journey-documentation`; §5 `orchestration`; §6 `definition-of-done`; §7 `compliance-label-removed`; §8 `guardrails`; §9 `task-report`; §11 `deployment-and-infrastructure`; §12 `traps-in-this-repo`. Fold §0 into `split-and-proceed`, §1 into `model-by-job`, §3a into `build-spec-then-backend-then-frontend`, the plain-language part of §10 into `fourth-grade-english`. Copy the text word for word, then apply the calls.
- AGENTS.md goes under 70 lines. Codex reads only this file, so keep the top laws in one line each and tell it to read `docs/rules/RULES-INDEX.md`. Move the teleprompter checklist into `docs/rules/TELEPROMPTER-VIDEO.md`.
- New rules need front matter (`description` with no colon inside, `alwaysApply: true`) and two relative links. Steps: `.ai/README.md`.

### 4. Checker, index, ignore lists
- `scripts/rules-drift-check.mjs`: the `claudemd` check ("every always-on law is named in CLAUDE.md") no longer fits a short index. Replace it with: CLAUDE.md names RULES-INDEX, has headings 0 to 12, every path it names exists, size caps (CLAUDE.md 220 lines, AGENTS.md 90). Update `src/rules/rules-drift-check.test.mjs` so each check is proven red and green.
- `docs/rules/RULES-INDEX.md`: add the new rules, remove the archived ones, change the "set aside" lines for the ad rule books (call 42), add an "Archived on 2026-10-24" list.
- Add `ops/archive/ai-instructions-2026-10-24/` to `.ignore`, `.cursorindexingignore` and the `ignored_paths` list in `.serena/project.yml`.

### 5. Hook fixes (small)
1. `guard-rule-edits.mjs`: treat `claude.md`, `agents.md`, `rules-index.md` in any letter case (this disk ignores case).
2. Same guard: also guard the MAIN checkout when a session runs in a worktree.
3. Read `*** Update File:` lines only for `apply_patch`, not when a Write merely quotes them.
4. `check-ad-script.mjs`: look at `tool_name` so a Read never answers block.
5. Self-test: add a case that `FUNDHUB_RULES_APPROVED=0` still asks.
6. `check-ad-script.mjs`: skip `marketing/ads/scripts/2026-10-02.md` (hand-written sorting-hat ads under the checker's 135-word floor).
7. New 4th hook `guard-env-masks.mjs`: deny writing a Netlify mask (8 or more stars) into `.env`, `.env.*` or `credentials/`, and deny sending `netlify env:list/get` output into those files. This is the cause of the 39 masked keys. Allow reading `.env`, normal lines, and `.env.example`.
8. `scripts/hooks/wire.mjs`: an idempotent script that merges the hook set into both settings files.

### 6. Needs Chris
- Worktrees and side copies: `phase-6-old-copies.md` has 64 safe, 23 keep, 9 ask, 4 side copies, and the exact removal commands marked NOT RUN. Remove only after Chris says yes.
- The 39 masked keys in `.env` (names: `node scripts/env-audit-masks.mjs`). The real values are not on this Mac. They come from the vendor dashboards (Twilio, Bland, and the rest). Netlify only returns a mask for secret variables.

### 7. Code changes this cleanup must NOT make (own tasks)
`scripts/ship.mjs` pushes every unmerged branch and tag, and has no env-only deploy (calls 5, 24). `marketing/ads/rules-data.mjs` lines 250 and 259 still teach "we think" and "most likely" (call 44). `scripts/ads/check-script.mjs` has a 135-word floor that flags the 115 to 125 word sorting-hat ads (call 42). `.env.example` still lists `GHL_API_KEY`. About 56 older docs and 225 code comments still say COMPLIANCE REVIEW REQUIRED (call 31).

## Rules for whoever finishes this

1. Edit the real file: `.ai/rules/<name>.md` or `.agents/skills/<name>/SKILL.md`. Never a link in `.cursor/` or `.claude/`.
2. Only AI instruction files. No app code (`src/`, `api/`, `public/`, `netlify/`, `db/`, `e2e/`, `.github/`, `scripts/` except the files named above).
3. Archive, never delete. Keep every dated owner-set line and its date. Never soften an owner law.
4. No law lost: for every sentence you remove, know where its meaning lives now. Compare with `git show c54f936a4:<path>` (main before the cleanup).
5. Tests read some of these files. Keep them green: `node --test src/rules/rules-drift-check.test.mjs src/hooks/hooks-selftest.test.mjs src/pulse/heartbeat-law.test.mjs src/ui/screen-standard.test.mjs src/http/monitoring.test.mjs src/marketing/api-contract.test.mjs src/ad-videos/merge-takes.test.mjs` and the non-database tests in `src/marketing/`. The heartbeat rule must keep the words "3 times its schedule".
6. Do not change the numbered Part 0 rules in `marketing/ads/RULES.md` (the app edits them by number). Change wording inside a line only.
7. Before calling it done: `node scripts/rules-drift-check.mjs` says OK, `find .ai .cursor .claude .agents -xtype l` prints nothing, `node scripts/lint.mjs` passes, `node scripts/hooks/selftest.mjs` passes.
8. Do not merge to `main`. Open or update the PR. Do not remove worktrees.
9. Claude Code now asks before any edit to a rule, skill, CLAUDE.md or AGENTS.md. Cursor is not affected. In a Claude session set `FUNDHUB_RULES_APPROVED=1`.
10. Commit after each item. Small commits.

## Not proven yet

Cursor following the `.cursor/rules/*.mdc` links, and Claude Code loading `.claude/rules` through links, were not opened from here. After merge: Cursor Settings, Rules should list 79. A fresh Claude Code session should list the rules. If either shows none, the fallback is a script that writes real copies.

## Starter prompt for Cursor

```text
Finish the Fundhub drift cleanup on branch drift-cleanup. Read
ops/workflows/drift-cleanup-2026-10-24/REMAINING.md first and do items 1 to 5
in order. The inputs are phase-3-decisions.md, phase-3-conflicts.md,
plans/dedupe-plan.md and plans/stale-plan.md in the same folder.
Hard rules: edit real files only (.ai/rules, .agents/skills), never links; no
app code; archive, never delete; no dated owner-set line may lose its date;
CLAUDE.md keeps its numbered headings 0 to 12; do not merge to main; do not
remove any worktree. Commit after each item. Before you say done, run the
checks in the "Rules for whoever finishes this" list and paste the real
output. Then list anything you skipped and why.
```
