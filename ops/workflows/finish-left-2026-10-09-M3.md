# M3: merge U37 (Today additions) with current main

Date: 2026-10-09. Builder: M3. Branch: `merge/M3-mm-u37-today-additions-2026-10-09`
(made from `mm-u37-today-additions`, draft PR #22; main at `e58704577`, same as `origin/main`).
Repair round 2: branch `merge/M3-mm-u37-today-additions-2026-10-09-r2`, cut from the merge commit
`0b101485b`. The round 2 section below answers the independent checker's five findings.

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

Two branches edited the same function in parallel. The two sets of rows do not collide: the Mac row and
the U37 rows are independent rows. **Corrected in round 2:** the first version of this note said there
was "no design clash". That was not true. The words clashed. With `MARKETING_AI_RUNNER=local` the Mac
runs the AI jobs, but U37's Write now and Retry said the work had started ("Writing 3 scripts now.",
"Running again."), and neither one read Today again, so the Mac row stayed hidden until the 5-minute
reload. Main's bridge had made Today and Write ad copy say "Waiting for your Mac". The round 2 change
below makes U37's two buttons say the same thing.

## What changed (on top of the merge)

- `public/app/marketing-cc-today.js`: conflict resolved as above. No other edit in the merge commit.
- `src/ui/marketing-cc-today.test.mjs`: one new test, "MARKETING_AI_RUNNER=local: the Mac's queue row sits
  after scripts and before stuck jobs; no key or nothing queued, no row". Nothing removed or weakened.
- `docs/journeys/marketing-dashboard-flow.md`, `docs/journeys/CHANGELOG.md`: as above.

## Round 2: the checker's findings, and what was done

### 1. (medium) The two sides still clashed in words: FIXED

`public/app/marketing-cc-today.js`

- New `MAC_KINDS`: the job kinds the model writes. It is the page's copy of `AI_JOB_KINDS` in
  `src/marketing/ai-runner.mjs`. A new test in `ai-runner.test.mjs` fails if the two lists differ.
- `summarizeWriteNow(res, n, mac)`: third argument. When `mac` is true (Today's own read carried
  `mac_queue`, so `view.macQueue` is there) the answer is "Saved. Waiting for your Mac to run it. 3
  scripts will show up in Scripts when it is done." It carries `mac: true`. With the Mac off the words are
  exactly the old ones and there is no `mac` key.
- `summarizeRetry(res, nowMs, mac)`: third argument. When `mac` is true and the retried job's kind is in
  `MAC_KINDS` the answer is "Back in line at 12:00 PM. Waiting for your Mac to run it." It carries
  `mac: true`. A retried job that is not AI work (`funnel_push`, `meta_load`, ...) still runs on Netlify
  and keeps "Running again. Started 12:00 PM."
- `writeNow()` and `retry()` call `load()` (the GET marketing/today read) right after a 200 when the answer
  carries `mac: true`, so the Mac row shows at once and not at the 5-minute reload.

Where I did not follow the checker's fix word for word, and why:

- The checker said to call `load()` after every 200 from Write now or Retry. I call it only in the Mac
  case. With the Mac off a retried job leaves the stuck list as soon as it is queued, so an immediate
  Today read would delete the row that says "Running again. Started 3:04 PM." and the user would see
  nothing. U37's e2e test "the row says it is running again" pins that. The Mac off keeps its old
  behavior exactly.
- The checker said "when `view.macQueue` is not null use the Mac words". For Write now that is what I
  did. For Retry I also check the retried job's kind, because Retry lists every failed kind and
  `funnel_push` still runs on Netlify. Saying "Waiting for your Mac" on a job the Mac never takes would
  be a new lie.

Proof (all run in this worktree, no database):

- Unit, `src/ui/marketing-cc-today.test.mjs`: the Mac answer for Write now (3 scripts and 1 script),
  for Retry (every AI kind; the non-AI kinds and an unknown kind keep the old line; the Mac off keeps the
  old line; a refusal is never "Saved" or "Back in line"), and a source check that both handlers read
  `view.macQueue` and call `load()` only on `out.mac`.
- Unit, `src/marketing/ai-runner.test.mjs`: `MAC_KINDS` equals `AI_JOB_KINDS`; both answers wait for the
  Mac.
- Playwright, `e2e/marketing-cc-today.spec.mjs`, four new tests, no clock run (no 5-minute reload):
  Write now with the Mac switch on says "Saved. Waiting for your Mac to run it." and the Mac row is drawn
  from the second GET marketing/today; Retry on a `write_slot` job says back in line, the stuck row is
  gone and the Mac row is drawn; Retry on a `funnel_push` job keeps "Running again." with no extra Today
  read; Write now with the Mac off keeps its old words and makes no extra Today read.
- Mutation check: with the two `load()` calls removed, both Mac e2e tests fail; restored after.

### 2. (low) Journey gap 10 was wrong: FIXED

`docs/journeys/marketing-dashboard-flow.md` gap 10 now says U35 is on main (`start_batch` is registered
in `src/marketing/job-kinds.mjs` line 85, and `api/marketing/batches.mjs` derives `write_now_ready` from
it), so Write now goes live with this ship as Today's one filled button. The live click path stays
UNVERIFIED. Both diagrams (Write now, Retry) got the Mac branch, a paragraph under Retry says which kinds
wait for the Mac, and a new gap 12 names the two limits below.

### 3. (low) The ai-runner test title said the Mac row is first: FIXED

`src/marketing/ai-runner.test.mjs`: the title now says the Mac row is first only when no scripts wait.
Same test, a new case: with `scripts_waiting` set the order is scripts, then the Mac.

### 4. (low) The order test did not cover videos: FIXED

`src/ui/marketing-cc-today.test.mjs`: new test, scripts, Mac, videos, stuck, flywheel redo, in that order
from `waitingList` and as drawn by `renderWaiting` (index of each `data-wait`). Same list with the Mac
off keeps the others in order.

### 5. (low) Test proof in this manifest was partial: FIXED, with the real numbers

Full suite, `npm test`, run in this worktree on the r2 branch with no `DATABASE_URL` set (so the `.pg`
files skip):

- Unit lane: 19871 tests, 19833 pass, 15 fail, 23 skipped, 0 cancelled. That is the checker's 19865 plus
  the 6 tests this round added.
- `.pg.test.mjs` lane: 927 tests, 83 pass, 0 fail, 844 skipped. Nothing here proves anything that needs a
  database.
- The 15 failures are the same 15 that fail on main's parent `e58704577`. I extracted that commit to a
  scratch folder and ran the 10 files that hold them: 156 tests, 141 pass, 15 fail, and the names of the
  failing tests are identical to this branch's. They are, by file:
  `scripts/daily-pulse.test.mjs` (1), `scripts/diagrams/generate.test.mjs` (1),
  `scripts/journeys/generate.test.mjs` (1, nine generated journey pages out of date),
  `src/http/climate-match.test.mjs` (1), `src/http/read-endpoints-org-scope.test.mjs` (1),
  `src/journeys/runner/index.test.mjs` (3, the workflow coverage tests), `src/lib/no-unfenced-transmit.test.mjs`
  (1, the outbound fence), `src/pulse/registry.test.mjs` (1), `src/repo/edit-ops.test.mjs` (4,
  `registry_add_ad` and its neighbours), `src/workflows/index.test.mjs` (1).
- The one flaky test the checker saw, `readbox.test.mjs` "box: close waits out the statement timeout
  before it sends ROLLBACK", is a timing test that fails only under load. It passed in this full run.
- None of the 15 touch a file this branch changed. I did not fix them here (stated scope).
- `npm run lint`: 3218 files parse clean.
- Playwright, `npx playwright test e2e/marketing-cc-today.spec.mjs e2e/marketing-command-center.spec.mjs`
  on the r2 branch: 45 passed (41 before, plus the 4 new Mac tests).
- `node --test src/ui/marketing-cc-today.test.mjs src/ui/marketing-command-center.test.mjs
  src/ui/marketing-avatar-row.test.mjs src/marketing/ai-runner.test.mjs`: 166 pass, 0 fail, 0 skipped.

## Proof (round 1, kept)

- `npm run lint`: 3218 files parse clean.
- `node --test src/ui/marketing-cc-today.test.mjs src/ui/marketing-command-center.test.mjs src/ui/marketing-avatar-row.test.mjs src/marketing/ai-runner.test.mjs`: 159 pass, 0 fail, 0 skipped (before my new test); `marketing-cc-today.test.mjs` alone 36 pass with the new test.
- Playwright (`E2E_PORT=43817 npx playwright test e2e/marketing-cc-today.spec.mjs e2e/marketing-command-center.spec.mjs`):
  41 passed. Offline, static server and `page.route`, the real Today tab in Chromium at 390 and 1280.
- `node --test src/pulse/*.test.mjs src/workflows/index.test.mjs`: 680 pass, 2 fail. Both failures are on
  main itself and not from this branch (see leftovers 1 and 2). These two were only part of the 15; the
  full list is in round 2, item 5.

## Could not run here

- No Postgres here: `src/http/marketing-today.test.mjs` and the `.pg.test.mjs` files that need
  `DATABASE_URL` were not run against a database. The branch changes no server file, so they are not
  affected by it.
- No live click path on https://fundhub.ai/app/marketing-command-center.html#today (not shipped; owner
  decision to ship comes after this merge).
- No live Mac run. The words and the re-read are proved against the API contract's own examples and a
  mocked `mac_queue`; a real `MARKETING_AI_RUNNER=local` run with the Mac queue runner is UNVERIFIED.

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
4. The other 13 failures in the full suite listed in round 2, item 5, all on main already.
5. `src/ui/marketing-command-center.test.mjs` line 506 still says, in its message, "videos come first:
   they have waited longest". After U37 the scripts row sits above the videos, and the Mac row sits
   between them. The assertion passes only because that test's data has no scripts waiting. The order
   itself is now pinned by the new test in `src/ui/marketing-cc-today.test.mjs`. Message left as is.
6. Write now with the Mac switch on: `start_batch` runs on Netlify first and only then queues the
   `write_slot` jobs the Mac takes, so the Today read right after the tap can come before those jobs
   exist. The words ("Saved. Waiting for your Mac to run it.") are true either way; the Mac row can show
   on the next Today read (5 minutes, or coming back into view). A faster fix would re-read Today on the
   20-second batch watch, which is a heavier read; not done.
7. The page knows the Mac switch is on only from `mac_queue` in GET marketing/today. If the server could
   not read that part it sends `mac_queue: null`, and Write now and Retry fall back to the old words.
8. If a Today read is already in flight when the tap answers, `load()` returns at once (the page's
   existing guard) and that read may predate the write. The next reload corrects it. Not changed.

## Risk answers

- Customer-facing path: no. Staff-only Command Center (owner and admin).
- Money: no. It shows spend and numbers read from `GET marketing/today`; the only writes are the two U37
  controls (Write now posts `marketing/batches/write-now` after the cost sheet; Use this angle posts
  `marketing/ideas`; Retry posts `marketing/jobs/retry`), all existing routes, none spends ad money.
  Write now spends model cost, capped and shown first. With `MARKETING_AI_RUNNER=local` that work runs on
  the Mac, not on the API.
- Write now goes live with this ship: U35 is on main, so `write_now_ready` is true and it is Today's
  one filled button (checker finding 2). The round 2 change adds no route and no setting.
- Migration: none.
- Hot path (`src/workflows/client.mjs`, `src/events/bus.mjs`, `api.mjs`): no.
- Live external system (ClickFunnels, Plaid, Meta): none touched by this change.
- Playwright check required (CLAUDE.md section 6, UI change): yes, and it ran: 45 passed.
- Heartbeat law: no new page, route, job or send. The page `marketing-command-center.html` is already in
  `DESK_FILES` in `src/pulse/registry.mjs`. No row to add.
