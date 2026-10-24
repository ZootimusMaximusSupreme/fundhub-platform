# Drift cleanup board, 2026-10-24

Branch: `drift-cleanup` (worktree `.claude/worktrees/drift-cleanup`). Source map: `ops/ai-instructions-map-2026-10-24.md`.
Guardrails (Chris): only AI instruction files, never app code, archive instead of delete (`ops/archive/ai-instructions-2026-10-24/`), plain English, no worktree removed, no merge to main.

**Stopped on purpose at 16:40 on 2026-10-24.** Weekly Claude usage was at 98% (resets Tuesday 2026-10-27 8 a.m. Arizona). The 40-agent run for Phases 4 and 5 was cancelled before any editor started. What is left is in `REMAINING.md`. Cursor finishes it.

| Phase | What | Status |
|---|---|---|
| 1 | Safety: `.codex/config.toml` ignored, no tracked secrets | done, no change needed |
| 2 | One home for rules and skills (links, not copies) | done, checked (`phase-2-layout.md`) |
| 3 | Every rule that fights another: both sides, the call | done: `phase-3-conflicts.md`, `phase-3-decisions.md`. Calls not yet applied to files |
| 4 | Merge duplicates, archive stale | plans written (`plans/dedupe-plan.md`, `plans/stale-plan.md`); edits NOT done |
| 5 | Short CLAUDE.md and AGENTS.md | not started |
| 6 | List old worktrees and side copies | done, nothing removed (`phase-6-old-copies.md`) |
| 7 | Light hook set + self-test | done and wired (`phase-7-hooks.md`); small fixes left |

Outputs in this folder: `REMAINING.md`, `phase-2-layout.md`, `phase-3-conflicts.md`, `phase-3-decisions.md`, `phase-6-old-copies.md` (+ `.tsv`), `phase-7-hooks.md`, `plans/`.
