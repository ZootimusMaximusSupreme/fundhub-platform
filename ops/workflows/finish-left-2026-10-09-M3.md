# M3: merge U37 (Today additions) with current main

Date: 2026-10-09. Builder: M3. Branch: `merge/M3-mm-u37-today-additions-2026-10-09`
(made from `mm-u37-today-additions`, draft PR #22; main at `e58704577`, same as `origin/main`).

## What was wrong

Branch `mm-u37-today-additions` was 342 commits behind main. Merging main into it gave two conflicts,
both because main's run queue bridge (`4ebdf3f7e`) and U37 both changed the Today "Waiting on you" list.

| File | Conflict | Resolution |
|---|---|---|
| `public/app/marketing-cc-today.js` | `waitingList()`. U37 made it `(view, videos, nowMs, ui)` with scripts first and stuck jobs with Retry. Main added `macWait()` (the Mac's queue row) and a Mac row first. | Kept both. Kept `macWait()` as main wrote it. `waitingList` keeps U37's signature and rows and adds the Mac row after scripts, before videos and stuck jobs. Order: scripts, Mac, videos, stuck, flywheel. |
| `docs/journeys/marketing-dashboard-flow.md` | Both sides appended new sections at the end of the file. | Kept both: U37 section, then main's U35 and run queue bridge sections. Added the Mac row to U37's "Waiting on you (order)" list. |
| `docs/journeys/CHANGELOG.md` | Auto-merged, but U37's two lines landed above main's 2026-10-09 block (file is newest first). | Moved U37's two lines into the 2026-10-06 block. Added one 2026-10-09 line for the combined behavior. |

No migration on the branch, so no renumbering. `db/expected-migrations.mjs` is not touched by the branch.

## Root cause

Two branches edited the same function in parallel. No design clash: the Mac row and the U37 rows are
independent.

## What changed (on top of the merge)

- `public/app/marketing-cc-today.js`: conflict resolved as above. No other edit.
- `src/ui/marketing-cc-today.test.mjs`: one new test, "MARKETING_AI_RUNNER=local: the Mac's queue row sits
  after scripts and before stuck jobs; no key or nothing queued, no row". Nothing removed or weakened.
- `docs/journeys/marketing-dashboard-flow.md`, `docs/journeys/CHANGELOG.md`: as above.

## Proof

- `npm run lint`: 3218 files parse clean.
- `node --test src/ui/marketing-cc-today.test.mjs src/ui/marketing-command-center.test.mjs src/ui/marketing-avatar-row.test.mjs src/marketing/ai-runner.test.mjs`: 159 pass, 0 fail, 0 skipped (before my new test); `marketing-cc-today.test.mjs` alone 36 pass with the new test.
- Playwright (`E2E_PORT=43817 npx playwright test e2e/marketing-cc-today.spec.mjs e2e/marketing-command-center.spec.mjs`):
  41 passed. Offline, static server and `page.route`, the real Today tab in Chromium at 390 and 1280.
- `node --test src/pulse/*.test.mjs src/workflows/index.test.mjs`: 680 pass, 2 fail. Both failures are on
  main itself and not from this branch (see leftovers 1 and 2).

## Could not run here

- No Postgres here: `src/http/marketing-today.test.mjs` and the `.pg.test.mjs` files that need
  `DATABASE_URL` were not run against a database. The branch changes no server file, so they are not
  affected by it.
- No live click path on https://fundhub.ai/app/marketing-command-center.html#today (not shipped; owner
  decision to ship comes after this merge).

## Leftovers (seen, not fixed, not caused by this branch)

1. `src/workflows/index.test.mjs` "index serves exactly the workflows on disk, and the count is pinned"
   fails on main: `pulse-instant-watch` is registered in `src/workflows/index.mjs` (commit `eee0270dd`)
   but not named in `EXPECTED_WORKFLOW_IDS` in the test.
2. `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file" fails in any
   worktree: `PULSE_REGISTRY` has `leads/c01cb7592c8bb994130158e897e99bf1/index.html`, which is in
   `.git/info/exclude` (`public/leads/`) and exists only in the main checkout, so it is not in git. It
   will fail on a clean clone too.
3. `src/ui/marketing-command-center.test.mjs` message "the only one is copyBtn in TODAY_HTML" is out of
   date once Write now is live (already named in the U37 journey doc, gap 1).

## Risk answers

- Customer-facing path: no. Staff-only Command Center (owner and admin).
- Money: no. It shows spend and numbers read from `GET marketing/today`; the only writes are the two U37
  controls (Write now posts `marketing/batches/write-now` after the cost sheet; Use this angle posts
  `marketing/ideas`; Retry posts `marketing/jobs/retry`), all existing routes, none spends ad money.
  Write now spends model cost, capped and shown first.
- Migration: none.
- Hot path (`src/workflows/client.mjs`, `src/events/bus.mjs`, `api.mjs`): no.
- Live external system (ClickFunnels, Plaid, Meta): none touched by this change.
- Playwright check required (CLAUDE.md section 6, UI change): yes, and it ran: 41 passed.
- Heartbeat law: no new page, route, job or send. The page `marketing-command-center.html` is already in
  `DESK_FILES` in `src/pulse/registry.mjs`. No row to add.
