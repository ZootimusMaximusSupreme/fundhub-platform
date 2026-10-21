---
name: fundhub-repo-hygiene
description: >-
  Inventories Fundhub repo mess and proposes KEEP / ARCHIVE / GITIGNORE / MOVE.
  Never deletes without Chris asking. Use when Chris says organize repo, repo
  hygiene, messy repo, clean up evidence, declutter ops/workflows, or agentify
  hygiene. Does not edit live product code unless he named a path.
---

# Fundhub Repo Hygiene

You inventory the mess. You propose labels. You do **not** mass-delete.

Version-control policy (commits, branches, what never goes in git) is
`fundhub-version-control`. Load that when the ask is about losing work /
commits / branches.

## Agents Chris already has (do not reinvent)

| Skill / tool | Path or home | Job |
|---|---|---|
| `fundhub-auditor` | `.cursor/skills/fundhub-auditor/` | Read-only prove / find broken |
| `fundhub-fixer` | `.cursor/skills/fundhub-fixer/` | Fix only what he named |
| `fundhub-builder` | `.cursor/skills/fundhub-builder/` | New screens / features |
| `fundhub-ui-auditor` | `.cursor/skills/fundhub-ui-auditor/` | UI standards score |
| `fundhub-perf-auditor` | `.cursor/skills/fundhub-perf-auditor/` | Speed / vitals score |
| `fundhub-orchestrator` | `.cursor/skills/fundhub-orchestrator/` | Full loop after plan OK |
| `fundhub-version-control` | `.cursor/skills/fundhub-version-control/` | Git / lose-work prevention |
| Codex: autopilot, split-to-prs, create-rule/skill/hook | `~/.cursor/skills-cursor/` | PR / skill authoring |
| Rules router | `.cursor/rules/audit-vs-fix-router.mdc` + `repo-hygiene-vc-router.mdc` | Which skill to load |

Also obey: owner-scope-minimal-diff, secrets-env-law, CLAUDE.md §0 split / §5 boards.

## Prime rules

1. **Read-only inventory first.** Status, sizes, tracked vs untracked. No deletes in the same pass as inventoring unless Chris already marked rows KEEP/KILL and said go.
2. **Never delete without ask.** Prefer `KEEP` / `ARCHIVE` / `GITIGNORE` / `MOVE`. Deletes only after he marks rows and says go.
3. **Never touch** `.env`, `credentials/`, or print secrets. PII packs stay gitignored.
4. **Never force-push.** Never mass-delete large `*-evidence/` trees in one pass without a KEEP/KILL board.
5. **No live product code** (`src/`, `api/`, `public/app` core) unless he named that path in this message.
6. **Extend, don’t fight** in-flight agent work under `.cursor/skills/` / `.cursor/rules/` (e.g. agentic-audit guardrails). Cross-link; don’t rewrite those files.

## Labels (use these exact words)

| Label | Meaning |
|---|---|
| **KEEP** | Stays where it is (or stays tracked). |
| **ARCHIVE** | Move out of the hot tree later (e.g. old evidence → archive path or git-lfs / off-repo). Propose path; wait. |
| **GITIGNORE** | Stop tracking / never commit; add ignore rule. Still may stay on disk. |
| **MOVE** | Relocate under a clearer folder; name from → to. |
| **ASK** | Ambiguous — Chris decides. |

## Workflow

1. Read the shared board if present: `ops/workflows/repo-hygiene-*.md` (newest date). Also check older purge boards (e.g. `repo-purge-candidates-2026-08-21.md`) — reuse KEEP/KILL rows; do not re-inventory from zero.
2. Categorize mess (examples):
   - Untracked `ops/workflows/*-evidence/` dumps
   - Huge **tracked** evidence (git bloat)
   - Duplicate / orphan workflow `.md` boards
   - Skills/rules that exist but aren’t in a router
   - Branch sprawl / stash pile (hand off detail to `fundhub-version-control`)
   - Missing `.gitignore` for evidence / PII packs
3. Write or update the board with rows: path, size/count, tracked?, proposed label, why, depends on.
4. **Stop** for Chris go before moves, ignores that untrack history, or deletes.
5. After go: smallest diff only for the named unit (e.g. one `.gitignore` block, one MOVE list).

## Evidence packs

- Prefer keep on disk until Chris picks ARCHIVE vs GITIGNORE.
- Annotated screenshots for decisions must follow `audit-screenshot-markups.mdc`.
- Do not commit raw ID/SSN/bank; those belong under gitignored paths only.

## Out of scope

- App feature fixes (→ `fundhub-fixer`)
- Full agentic company audit fences (→ `.cursor/rules/agentic-audit-guardrails.mdc`; leave alone)
- Rewriting `CLAUDE.md` wholesale

## Done bar

Plain-language summary for Chris: inventory counts, proposed labels, board path, one next action (which workflow to greenlight). No secret values.
