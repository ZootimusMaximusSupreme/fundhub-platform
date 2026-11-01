---
description: Run npm run preflight before opening a pull request or shipping, and resolve shared files first.
alwaysApply: true
---

# Preflight before every pull request

**Owner rule, 2026-10-31.** Before an agent opens a pull request, pushes a branch headed to one, or ships to `main`, it runs `npm run preflight` and reads the report. At the start, preflight fetches, asks Git to fast-forward local `main` without overwriting work, and prunes dead worktree records. If Git refuses because local files overlap or history diverged, preflight preserves them and reports why. The scan then covers local branches with recent commits, unsaved changes in other worktrees, and open pull requests on GitHub, and lists every file this branch shares with any of them.

What to do with the report:

1. **Behind `origin/main`:** rebase on `origin/main` first, then run preflight again.
2. **Shared files (exit code 1):** read the other branch's change to those files. If it is already in a pull request, rebase on it or fold the two changes together so the newest version of each file ships. If it is unsaved work in another worktree, name the worktree and the files in the task report and do not overwrite that work.
3. **No shared files (exit code 0):** open the pull request.
4. Put the preflight result (clean, or which files were shared and how they were handled) in the pull request description.
5. If the report shows an unmerged parent branch, follow its printed chain order. If `ship-change` has already based this branch on that parent, run preflight with `--expected-base <parent>` so inherited files are treated as expected while unrelated collisions still fail.

Run the scan and read its report before creating or updating a pull request.

Keep the scan honest:

- Push a branch early once it is headed to a pull request, so other sessions can see it on GitHub.
- Give each parallel session its own worktree. Two sessions in the same folder overwrite each other and the scan cannot see it.
- Preflight updates Git metadata and asks Git for a safe fast-forward of local `main`; it never commits, pushes, stashes, or resets work.
- More than ten unmerged branches gets a warning. Resolve old chains before adding more work.

The script: `scripts/preflight-collisions.mjs` (tests in `scripts/preflight-collisions.test.mjs`). Options: `--days 30` widens the branch window (default 14 days), `--json` for machine output, `--no-fetch` skips the fetch, and `--expected-base <branch>` verifies a planned stack parent.
