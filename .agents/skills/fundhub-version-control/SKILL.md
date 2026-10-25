---
name: fundhub-version-control
description: >-
  Fundhub git hygiene so work stops getting lost: branch policy, what to commit
  vs never commit, small commits, no amend/force without ask, evidence commit
  policy, protect main, stash/WIP boards. Use when Chris says version control,
  VC check, losing work, commit policy, branch cleanup, stash, or "don't lose
  this." Commits finished work locally in the same session.
---

# Fundhub Version Control

You keep git from eating Chris’s work. Law: github-push (.ai/rules/github-push.md) - commit finished work locally in the same session, then push main or a PR branch with git push origin <branch>; the repo is public. Claude Code: CLAUDE.md section 8 and "Commit locally, every session" are the commit and PR steps.

Repo clutter / evidence trees / ignore proposals → also load
`fundhub-repo-hygiene` when both apply. Prefer hygiene for “organize the mess,”
this skill for “make sure we don’t lose it.”

## Agents Chris already has (menu)

| Name | Where | Use for |
|---|---|---|
| `fundhub-auditor` / `fixer` / `builder` / `ui-auditor` / `perf-auditor` / `orchestrator` | `.cursor/skills/fundhub-*` | Product audit/fix/build |
| `fundhub-repo-hygiene` | `.cursor/skills/fundhub-repo-hygiene/` | KEEP/ARCHIVE/GITIGNORE/MOVE |
| Cursor: autopilot, split-to-prs | `~/.cursor/skills-cursor/` | PR readiness / split |
| Git safety | User rules (committing-changes / creating-PRs) | Exact commit/PR steps |

## Why work gets lost here (check these first)

Prove with `git status` / `git stash list` / branch list — don’t invent:

1. **Huge untracked evidence** — agents write `ops/workflows/*-evidence/` and never commit or ignore; machine wipe / branch switch looks like “gone.”
2. **No commit habit** — WIP only on disk; stash pile grows; switch to `main` without a board.
3. **Rules only in chat** — not in `.cursor/rules` / skills, so the next agent doesn’t know the policy.
4. **Branch sprawl + stashes** — work parked in stash/`+` worktrees, not on a named WIP board under `ops/workflows/`.
5. **Evidence already tracked (~thousands of files)** — slows status, confuses “what changed,” encourages abandoning dirty trees.

## Never commit (hard)

- Law: secrets-env-law (.ai/rules/secrets-env-law.md) - never git add .env, .env.* (except .env.example) or credentials/; confirm secrets by name only.
- Law: agentic-audit-guardrails (.ai/rules/agentic-audit-guardrails.md) - raw ID, SSN and bank files stay in gitignored folders.
- Evidence dumps or files that are not part of the finished work

## Commit every session

- Law: github-push (.ai/rules/github-push.md) - commit finished work locally in the same session. Follow git safety rules: status + diff + log, HEREDOC message, no `--no-verify`, no force-push to main, no amend unless the amend rules all pass.
- Prefer **small commits** (one unit / one board row set).
- Protect **`main`**: feature branches for real work; don’t dump multi-day WIP on main without his go.

## Evidence commit policy

| Kind | Default |
|---|---|
| Board `.md` under `ops/workflows/` (task list, findings text) | OK to commit when he asks — small, useful |
| Small JSON prove summaries (no PII) | OK when he asks |
| Huge screenshot / video evidence trees | Prefer **GITIGNORE** or ARCHIVE after hygiene go — do not silently `git add` multi‑hundred‑MB dumps |
| Marked decision screenshots he needs in git | Commit only the marked set he named |

If unsure: propose on the board; wait.

## How not to lose work (order)

1. **Named board** — `ops/workflows/<batch>.md` with status + claim (CLAUDE.md §5).
2. **Named branch** — one concern per branch; push it to GitHub.
3. **Commit every session** — small, green-enough units.
4. **Stash only as short parking** — if you stash, write the stash reason + restore steps on the board the same turn. Stash is not the archive.
5. **Before switching branches** — status clean, or stash+board, or commit. Never “just checkout” over a dirty tree of product work.

## Branch hygiene (propose, don’t mass-delete)

- List local vs remote, merged vs open.
- Merged branch: delete remote and local at once (CLAUDE.md section 8). Do not delete a branch with unique commits or an open PR: open a PR first. Unmerged and done: name what was on it in the task report, then delete.
- Note worktrees (`git worktree list`) if present.

## VC check output (for Chris)

Short plain list:

1. Dirty files (product vs evidence vs agent files)
2. Untracked evidence size / count
3. Stash count + oldest theme
4. Branch count + any “ahead/behind main”
5. Risk of loss (one sentence)
6. One next action

## Never

- Force-push / hard reset unless he explicitly asked in this message
- Amend pushed commits
- `git add -A` when evidence dumps or `.env` could sneak in
- Commit to “clean up” the tree: commit finished work only

## Done bar

Plain language. Board path if you wrote one. No secret values.
