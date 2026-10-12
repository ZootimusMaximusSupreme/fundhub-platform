# Launch readiness batch — 2026-10-11

## Shared context

- Owner approved the split on 2026-10-11.
- This session owns repo and pull-request cleanup first.
- Existing local work is out of scope and must be preserved.
- GitHub is canonical. Compare with `origin/main`.
- Never force-push, hard-reset, or delete unmerged work.

## Workflows

| Workflow | Owner | Status | Scope |
|---|---|---|---|
| Repo and PR cleanup | Current session | done | Open PRs, branch state, local/GitHub sync |
| Heartbeat build | Follow-up workflow | pending | Heartbeat rows, beats, tripwires, receipts, proofs |
| Launch readiness | Follow-up workflow | pending | TODO research and launch checklist |
| Funnel setup | Follow-up workflow | pending | Named funnel work, including Cortana |
| Sales readiness | Follow-up workflow | pending | Sales journeys, tools, scripts, data, blockers |

## Copy-paste prompts

### Repo and PR cleanup

In `/Users/chrisstanbridge/Developer/fundhub-platform`, inspect all local and GitHub pull requests and make the repo match GitHub. Complete or close every PR as appropriate, remove finished branches, sync local `main` with `origin/main`, and commit any needed local work. Follow `AGENTS.md`, compare only with GitHub, and write a manifest to `ops/workflows/launch-readiness-2026-10-11.md`. Do not touch product work outside repo/PR sync.

### Heartbeat build

In `/Users/chrisstanbridge/Developer/fundhub-platform`, finish the heartbeat build. Read the heartbeat rules and journey docs first. Find missing rows, beats, tripwires, receipts, and proofs. Implement only the heartbeat work. Run the required checks, update actual journey docs and changelog, commit locally, and write the change manifest and blockers to `ops/workflows/launch-readiness-2026-10-11.md`.

### Launch readiness

In `/Users/chrisstanbridge/Developer/fundhub-platform`, research the TODO list and all launch-critical paths. Compare TODOs with the actual repo, journeys, scripts, deploy rules, and tests. Mark each item done, blocked, or still needed. Do not fix unrelated holes. Write an evidence-based launch checklist and manifest to `ops/workflows/launch-readiness-2026-10-11.md`.

### Funnel setup

In `/Users/chrisstanbridge/Developer/fundhub-platform`, audit and finish the named funnel setup, including the Cortana funnel work and the other funnel named in the repo. Read the funnel rules and intended journeys first. Use the API path for ClickFunnels. Make only requested funnel changes, prove them, update actual journeys and the changelog, commit locally, and write the manifest to `ops/workflows/launch-readiness-2026-10-11.md`.

### Sales readiness

In `/Users/chrisstanbridge/Developer/fundhub-platform`, audit sales-team launch readiness against the role-sales-manager, role-closer, and role-funding-advisor journeys. Check the real tools, scripts, data, routes, tests, and blockers. Do not invent missing business rules or fix unnamed holes. Write the evidence and manifest to `ops/workflows/launch-readiness-2026-10-11.md`.

## Repo/PR findings

- GitHub has zero open pull requests.
- PRs 1–25, 27, and 28 are merged. PRs 22, 24, and 26 are closed.
- The only remote branches were two stale branches for merged PRs 27 and 28. Both were deleted.
- Local `main` fast-forwarded from `1882ec7f3` to `c10149f5a`.
- Local `main` now points to the same commit as `origin/main`.
- Existing untracked files and 39 stashes were preserved. They were not part of this cleanup.

## Change manifests

### Repo and PR cleanup — current session

- Changed: deleted remote branches `codex/teleprompter-take-flow-20261011` and `fix/teleprompter-countdown-first-play`.
- Changed: fast-forwarded local `main` to `origin/main` at `c10149f5a`.
- Changed: added this shared board.
- Not changed: product files, untracked agent files, personal files, and stashes.
- Verification: `gh pr list --state open` returned no rows; remote heads now contain only `main`; local `main` and `origin/main` match.

## Blockers and open questions

- The worktree still has pre-existing untracked files and 39 stashes. They were intentionally left alone because they are outside this workflow's scope.

## TODO consolidation — 2026-10-11

- Status: done.
- Canonical document: `TODO.md`.
- Rebuilt `TODO.md` as one clean list with the business list, unique chat items, personal items, priority notes, and leftovers.
- Removed the old source-copy sections. No `## Source:` blocks remain.
- Removed the four old source files and the now-unused `.gitignore` entries for the two root files.
- Preserved the old worktree and evidence copies because they are historical copies, not canonical lists.
