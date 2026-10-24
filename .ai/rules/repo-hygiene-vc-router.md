---
description: Route repo organize / version-control / messy hygiene to Fundhub skills
alwaysApply: true
---

# Repo hygiene & version control router

**Owner law (2026-08-24):** Organizing the repo and fixing “things keep getting lost” are their own doors. Load the matching skill before inventoring or changing git/ignore layout.

## Router

| Chris said something like… | Load this skill | Do |
|---|---|---|
| organize repo, repo hygiene, messy repo, declutter, clean up evidence, agentify hygiene | `fundhub-repo-hygiene` | Inventory → KEEP/ARCHIVE/GITIGNORE/MOVE. **No delete without ask.** |
| version control, VC check, losing work, commit policy, branch cleanup, stash, “don’t lose this” | `fundhub-version-control` | Branch/commit/evidence policy. **Commit finished work locally in the same session (CLAUDE.md, 2026-09-08).** |

Skill paths:

- `.cursor/skills/fundhub-repo-hygiene/SKILL.md`
- `.cursor/skills/fundhub-version-control/SKILL.md`

Shared board for mass organize: `ops/workflows/repo-hygiene-*.md` (newest date). Reuse older purge boards when present (e.g. `repo-purge-candidates-2026-08-21.md`).

## Both in one message

Run **hygiene inventory** (or read the board) first. Hand VC details to `fundhub-version-control`. Do not mass-move/delete and rewrite git history in the same pass without his go on named units.

## Never

- Mass-delete `*-evidence/` without KEEP/KILL rows + go
- Commit `.env` / `credentials/` / secrets
- Force-push or amend unless he explicitly asked
- Drive-by refactors of live product code during organize
