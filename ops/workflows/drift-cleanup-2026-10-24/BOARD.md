# Drift cleanup board, 2026-10-24

Branch: `drift-cleanup` (worktree `.claude/worktrees/drift-cleanup`). Not pushed.
Source map: `ops/ai-instructions-map-2026-10-24.md`.
Guardrails (Chris): only AI instruction files, never app code, archive instead of delete (`ops/archive/ai-instructions-2026-10-24/`), plain English.

| Phase | What | Owner | Status |
|---|---|---|---|
| 1 | Safety: `.codex/config.toml` ignored, no tracked secrets | lead | done, no change needed (main already ignores it) |
| 2 | One home for rules and skills (links, not copies) | agent `layout` | claimed |
| 3 | Every rule that fights another: both sides + recommendation | agents `conflicts` | claimed |
| 4 | Merge duplicates, archive stale | lead | waits for Chris's Phase 3 answers |
| 5 | Short CLAUDE.md and AGENTS.md indexes | lead | waits for Phase 4 |
| 6 | List of old worktrees and side copies (list only, removes nothing) | agent `old-copies` | claimed |
| 7 | Light hook set + self-test | agent `hooks` | claimed |

No dependencies between 2, 3, 6, 7: all parallel. Each agent owns separate files. Lead does all git commits.

Outputs land in this folder: `phase-2-layout.md`, `phase-3-conflicts.md`, `phase-6-old-copies.md`, `phase-7-hooks.md`.
