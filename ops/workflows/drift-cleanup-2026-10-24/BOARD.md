# Drift cleanup board, 2026-10-24

Branch: `drift-cleanup` (worktree `.claude/worktrees/drift-cleanup`). PR: #134 (draft, not merged). Source map: `ops/ai-instructions-map-2026-10-24.md`.
Guardrails (Chris): only AI instruction files, never app code, archive instead of delete (`ops/archive/ai-instructions-2026-10-24/`), plain English, no merge to main without his word.

**Finished 2026-10-24.** Claude did Phases 1, 2, 3, 6 and 7. The Claude run for Phases 4 and 5 was stopped when weekly usage hit 98%, so Cursor (Grok) did them from `REMAINING.md`. Claude then ran the checks itself: rules check OK, 222 tests pass, lint clean, hooks self-test 82 checks, no broken links, no app code touched. Chris's two answers (calls 51 and 52) are applied.

| Phase | What | Status |
|---|---|---|
| 1 | Safety: `.codex/config.toml` ignored, no tracked secrets | done, no change needed |
| 2 | One home for rules and skills (links, not copies) | done (`phase-2-layout.md`) |
| 3 | Every rule that fights another: both sides, the call | done and applied (`phase-3-conflicts.md`, `phase-3-decisions.md`, calls 1 to 52) |
| 4 | Merge duplicates, archive stale | done (13 rules archived, 44 stale lines checked) |
| 5 | Short CLAUDE.md and AGENTS.md | done (155 and 52 lines; headings 0 to 12 kept) |
| 6 | Old worktrees and side copies | done after Chris's yes: 62 removed, 58 merged branches deleted, 41.3 GB freed. 1 skipped because it had new commits. 23 keep and 9 ask stay. Side copies untouched (`phase-6-old-copies.md`) |
| 7 | Hooks + self-test | done and wired: 4 hooks, 82 checks (`phase-7-hooks.md`) |

## Left for Chris

- Merge PR #134 when its checks are green. Before that, one 30-second check: in Cursor, open this folder, Settings, Rules. It should list the rules (proves the links work).
- The 39 masked keys in the local `.env`: real values come only from the vendors (Twilio, Bland, and the rest).
- Code and database comments this cleanup must not touch: two comments in `src/pulse/`, one in `db/migrations/407_ad_number_from_meta.sql`, `marketing/ads/rules-data.mjs`, the 135-word floor in `scripts/ads/check-script.mjs`, `scripts/ship.mjs`.
- Worktree `hungry-clarke-3e9917` was safe at 15:00 and got new commits later. It stays until its owner is done.

Outputs in this folder: `REMAINING.md`, `PROGRESS.md`, `CURSOR-PROMPT.md`, `phase-2-layout.md`, `phase-3-conflicts.md`, `phase-3-decisions.md`, `phase-6-old-copies.md` (+ `.tsv`), `phase-7-hooks.md`, `plans/`.
