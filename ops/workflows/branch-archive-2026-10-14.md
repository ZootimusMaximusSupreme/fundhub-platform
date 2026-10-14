# Branch and PR cleanup — 2026-10-14

Owner order (Chris): everything merged on main, locally and on GitHub; no branches and no open PRs, no matter what.

## Result

- GitHub: only `main`. Open PRs: 0.
- This Mac: only `main`, equal to `origin/main`.
- Nothing was lost. Every branch that held work not on main is kept as an `archive/...` tag (tags are not branches).

## Merged to main today

Docs only, from their own PRs: #39 Pollfish note, #40 mobile CRM todo, #45 weakness scorecard, #46 launch batch board, #47 Blueprint scripts, #49 bank outreach plan. (TODO.md: both added lines kept.) Earlier today: the proof round (700 rows proved, tests only) and the PR #41 heartbeat build.

## Archived (not merged on purpose) — restore with `git switch -c <name> <tag>`

| Tag | Was | Why not merged |
|---|---|---|
| `archive/pr48-hourly-capacity-71d7727ff` | PR #48 hourly beat capacity (Codex) | Tests pass, but an independent review found the lanes can starve beats behind a slow bank page. Fix list: `ops/workflows/pr48-review-findings-2026-10-14.md`. Ship is blocked until this is fixed. |
| `archive/codex-local-repair-tip-d12d53205` | Codex's last local commit on that branch | Follow-up to #48. |
| `archive/pr41-first-tip-ce3aac2bc` | first tip of PR #41 | Superseded: the merged version is on main. |
| `archive/pr43-fix-red-browser-tests-066966256` | PR #43 pipeline drag test fix | Touches `public/app/pipeline.html`; needs Chris's call. |
| `archive/pr44-teleprompter-harden-030eb7ffd` | PR #44 teleprompter mirror and 30 fps | Teleprompter changes need a real iPhone preview first (AGENTS.md). |
| `archive/feat-hiring-funnel-join-e7b595756` | hiring funnel join (5 commits, 16 code files) | A product feature, never reviewed. |
| `archive/fix-ship-nonblocking-heavy-morning-pulse-20261012-35f6e93a2` | ship script change | Not reviewed; the beat-capacity fix may replace it. |
| `archive/codex-heartbeat-tripwire-review-2026-10-13-141f297f8` | review branch for old PR #37 | Content merged through #41. |
| `archive/fix-teleprompter-*-20261012-*` (6 tags: 60fps-flip-and-portrait, camera-preview-record-only, front-4k60, iphone17pro-60fps, mic-and-upload-flow, two-second-end-tail) | six teleprompter fix branches from Oct 12 | Not on main by patch; teleprompter work moved on. Needs a real iPhone preview before any of it merges. |

## Left alone on purpose

- 39 git stashes on this Mac (other sessions' unfinished edits). Not branches; nothing dropped.
- One Codex work folder `/Users/chrisstanbridge/.codex/worktrees/heartbeat-full-build/fundhub-platform` holds uncommitted edits (18 modified, 37 untracked). Its branch was detached so no branch remains; the edits were not touched.
- 38 untracked files in the main folder (agent skill folders under `.agents/skills/`). Not committed, not deleted.
