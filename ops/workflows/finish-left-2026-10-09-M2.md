# M2: merge-ready check for mm-x4f-funnel-push-on-domain (X4F, draft PR #25)

Date: 2026-10-09. Builder: merge builder M2. Branch worked on: `merge/M2-mm-x4f-funnel-push-on-domain-2026-10-09`
(cut from `mm-x4f-funnel-push-on-domain`, then `git merge main`). Nothing was merged into main, pushed, shipped or deployed.

## What was wrong

The X4F branch was cut when main was 342 commits behind today's main (merge base `bf6b5716b`). It had one
conflict with current main and one stale fact.

1. `docs/journeys/marketing-dashboard-flow.md`: both sides appended a section at the end of the file
   (branch: "X4F Push live on apply.fundhub.ai"; main: "U35 clock's weekly batch tick" and "The run queue
   bridge"). Git could not pick an order.
2. `docs/journeys/CHANGELOG.md`: the branch's 2026-10-06 line merged cleanly but sat above the 2026-10-09
   lines, which breaks "newest at top".
3. Stale fact: migration 473 (on main after the branch was cut) added a third hand-mapped funnel, `optimize`
   (credit repair door, `https://fundhub.ai/optimize`, live). The X4F note on tag-on-create named only
   book_call and roadmap_147.

## Root cause

Ordinary drift: a long-lived branch against a busy main. No code file conflicted. None of the seven source files
the branch touches was changed on main since the merge base (`git log bf6b5716b..main -- <files>` is empty).

## What changed (this branch, on top of the X4F commit)

- Merge commit: kept BOTH doc sections. Main's U35 and run-queue sections first, then the X4F section.
- `docs/journeys/CHANGELOG.md`: X4F's line moved to the top of the 2026-10-06 block (correct order); one new
  2026-10-09 line for this merge.
- `docs/journeys/marketing-dashboard-flow.md`: one added bullet under "Tag on create" saying the same create also
  tags `optimize` as `fnl-optimize` (database only). Read from the live table, SELECT only.
- No migration number collision: the branch adds no migration. `db/expected-migrations.mjs` was not touched.
- No code change by M2. The branch's design was not changed.

## Proof

Run in this worktree, no database, no live write.

| Check | Result |
|---|---|
| `npm run lint` | clean, 3219 files parse |
| `funnel-copy`, `funnel-paths`, `funnel-push`, `clickfunnels-pages` tests (the four the branch touched) | 68 of 68 pass |
| `src/marketing/*.test.mjs` and `src/messaging/providers/*.test.mjs` (neighbours) | 1237 of 1237 pass |
| `funnel-pages`, `funnel-worker`, `job-kinds`, `settings-store`, `ai-runner`, `worker`, `cc-tab-ideas`, `funnel-checkout`, `funnel-page-script` | pass |
| `src/http/routes.test.mjs`, `auth-gate.test.mjs`, `src/repo/allow-list.test.mjs`, `pulse/coverage/slice-40-more.test.mjs` | 30 of 30 pass |
| `src/pulse/*.test.mjs`, `beats`, `coverage`, `src/workflows/index.test.mjs` | 2580 pass, 2 fail, 55 skipped (the 2 fails are NOT from this branch, see below) |

### Could not run here

- `src/http/marketing-funnel-builder.pg.test.mjs` (the branch rewrote it, 270 lines), `marketing-funnels.pg.test.mjs`,
  `marketing-funnels-stats.pg.test.mjs`: need a real `DATABASE_URL`. No local Postgres on this Mac, and the
  rule here is no database write. They skip here.
  **Corrected in round 2 (r2).** The funnel builder test DID run on real Postgres, in CI, on this branch's code:
  GitHub Actions run 37500688925 (workflow `tests`, draft PR #25, push of 2026-10-06, head
  `a915519c0e4c738f9c7eaab76e476968e616855b`), job 112401447413 "suite (real Postgres - blocks)". All 25 of 25
  subtests of "the funnel builder" are `ok` in that job's log (create, tag by hand, build, push, retry, move the
  standalone page, the track door, the worker). The job as a whole was RED: its step "Run the suite against
  Postgres" failed on other tests this branch does not touch (`climate-match.test.mjs` "climate page: no
  approval odds", the `marketing-ads.pg.test.mjs` EXPLAIN on `ad_metrics_daily`, `/api/marketing/ads`, and
  others). So that run proves the 25, and it is not a green job. Every file the test and the push use
  (`funnel-push.mjs`, `funnel-store.mjs`, `funnel-paths.mjs`, `funnel-copy.mjs`, `clickfunnels-pages.mjs`,
  `push-live.mjs`, `fake-clickfunnels.mjs`, and the pg test itself) is byte for byte the same at the merge
  (`git diff a915519c0 <merge head> -- <those files>` is empty, checked in r2). Since that run the only change
  to `marketing_funnels` on main is migration 473 (one hand-mapped row, `optimize`, in the default company); the
  test makes its own rows in its own company. It has NOT been run again after the merge, and no Postgres exists on
  this Mac, so CI's real-Postgres job on the merge is the next run.
  The SQL the branch adds (`backfillTags`, `markPageAddress`) was also read against migration 425 by hand:
  setting a tag from NULL is allowed by the trigger, and `live_url` may change while `cf_page_id` stays (the
  guard only blocks id, path, html, funnel).
- No Playwright run: the branch changes no file under `public/app/` and no screen.
- Nothing was run against live ClickFunnels (owner law for this unit; the branch's own doc says UNVERIFIED there).

### Failures that are on main already, not from this branch

Verified by unpacking main (`git archive main`) into the scratchpad and running the same test.

1. `src/lib/no-unfenced-transmit.test.mjs` "nothing reaches the network except through src/lib/outbound-fetch.mjs":
   `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs` make a raw outbound call. Same failure on main.
   The branch's own provider passes the sibling test "every messaging provider that transmits routes through the chokepoint".
2. `src/workflows/index.test.mjs` "index serves exactly the workflows on disk": `pulse-instant-watch` is registered
   but not named in `EXPECTED_WORKFLOW_IDS`. Same failure on main.
3. `src/pulse/registry.test.mjs` "every registry row names a real handler or desk file": the row for
   `leads/c01cb7592c8bb994130158e897e99bf1/index.html` points at a file excluded locally (`.git/info/exclude`), present
   in the main checkout and absent in a worktree. A worktree artifact, not a real break.

## Risk notes (the answers asked for)

- Customer-facing path: yes, indirectly. A push puts three public pages on `https://apply.fundhub.ai/...`. Nothing runs
  until Chris presses Push live (or the push-live route / jobs Retry is called).
- Money: no direct charge (no payment, no price, no checkout, no commission). Indirectly yes, which round 1 left
  out: a live built funnel turns on (`active = true`), shows on every affiliate's link list, and can take ad
  traffic. Round 2 adds a tripwire for that (below).
- Migration: no. The branch adds none. It relies on 425 (already on main and applied).
- Hot path (`src/workflows/client.mjs`, `src/events/bus.mjs`, `api.mjs`): not touched. `api/marketing/funnels/push-live.mjs`
  changed in comments only.
- Live external system: yes, ClickFunnels. When used it POSTs a funnel, POSTs three pages into it, PUTs our own pages,
  and GETs for the proof. It never DELETEs and refuses to make a page outside a funnel. The three behaviors the
  branch's doc marks UNVERIFIED (step path on the funnel's domain, PUT onto a step, the new funnel's step path vs the
  standalone page's path) have never been seen live. Each wrong answer stops the push with the funnel a draft.
- Needs the Playwright check (CLAUDE.md section 6): no, no UI file changed.
- Heartbeat row needed: a new ping, no. A tripwire, yes (round 1 said no row at all; round 2 corrects that). The
  branch adds no new page, routed api handler, Inngest job, or send path, so no new ping row:
  `marketing/funnels/push-live` is already in `PULSE_REGISTRY`, and the job kind `funnel_push` is already on
  `gap-marketing-queue`. But this branch is the change that lets a built funnel go live on apply.fundhub.ai for
  the first time, and a ping is not enough for a path that takes ad traffic. Round 2 adds the tripwire: see
  "Round 2 repair" below.
- One behavior to know: the next Create tags all three hand-mapped live funnels (book_call, optimize, roadmap_147) in
  the database. Tag only; address, status, active and `updated_at` do not change; a tag can never change after (425).
- The Push live button in the Command Center stays off for the live-test funnel (`blueprint`) because a page is
  already on ClickFunnels. The push can be started only through the push-live route or jobs Retry. Known gap in the
  branch's doc, not changed.

## Leftovers (not fixed, per rules)

- The three main failures above (outbound fence on `src/pulse/funnel-doors.mjs` and `instant-watch.mjs`;
  `pulse-instant-watch` missing from `EXPECTED_WORKFLOW_IDS`). Whoever owns the instant-watch build should close them.
- The step page left behind on ClickFunnels when a standalone page is moved into the funnel: deleting it is an owner call.
- (Closed in round 2.) Built funnels' live pages had no per-funnel live watcher in the pulse. Now they have one:
  `src/pulse/coverage/gap-built-funnels.mjs`, see "Round 2 repair".

## Ready to merge

Yes, with one condition (restated in round 2): the funnel builder pg test passed 25 of 25 on real Postgres in CI
run 37500688925 (job 112401447413, head `a915519c0`), on the same code, but it has not run on the merge. Let CI's
real-Postgres job run on the merge before it lands on main (that needs a push, which no session here does).
Main moved after round 1 (3e739e046 teleprompter, 2d95387f5 ship log; neither touches a file this branch
touches). `git merge-tree --write-tree main <r2 head>` was clean on 2026-10-09 (exit 0, one tree, no conflict lines).

## Round 2 repair (r2, 2026-10-09)

Branch `merge/M2-mm-x4f-funnel-push-on-domain-2026-10-09-r2`, on top of the round 1 head `405d635c2`. An independent
checker found one medium and four low issues. Nothing was pushed, shipped, deployed or merged. No database write.

| # | Severity | Finding | What was done |
|---|---|---|---|
| 1 | medium | Nothing re-reads a built funnel's pages after they go live. | New lane `src/pulse/coverage/gap-built-funnels.mjs`. Fixed in code. |
| 2 | low | The manifest said the pg test ran nowhere. | Checked against GitHub: it ran in CI, 25 of 25. Lines above corrected. The job as a whole was red for other tests. |
| 3 | low | Main moved. | Dry-run merge into today's main is clean. No code change, as the checker said. |
| 4 | low | Three ClickFunnels behaviors never seen live. | Agent-run API steps written: `docs/sops/clickfunnels-funnel-push-stops.md`. Documented, not tried. |
| 5 | low | The lead-with-funding check blocks good headlines. | Fixed in `src/marketing/funnel-copy.mjs`, with tests. |

### 1. The lane (medium)

**Root cause.** The push proves a funnel's pages once, on the day it goes live (steps 6 and 7 of
`funnel-push.mjs`). After that nothing read `marketing_funnels` or `marketing_funnel_pages`. `gap-funnels.mjs`
and `slice-05-funnels.mjs` read pages written into the code (`GAP_DOORS`), and `gap-marketing-queue` only sees
a job that failed. A built funnel is a database row, so no code names its pages. Once live it turns on
(`active = true`, `markFunnelLive`), shows on every affiliate's link list (`LIVE_OFFERS_SQL`), and can take ad
traffic. A page that went dead weeks later would have turned no row red.

**What changed.**

- `src/pulse/coverage/gap-built-funnels.mjs` (new). One check, id `built-funnels:live-pages-answer`.
  - Read: `marketing_funnels` where `kind IS NOT NULL AND status = 'live'`, left joined to its pages
    (`LIVE_SQL`). SELECT only.
  - For each page with a `live_url`: one GET with a cache-busting `fh_cb=<time>` query (the same word the push
    proof uses). GET only, no key, no ClickFunnels API call. Eight seconds a call, 15 seconds for the lane,
    60 pages at most.
  - RED when: the page answers anything but 200; the page cannot be reached; the page answers 200 without
    `<meta name="fh-funnel-tag" content="<tag>">` (`tagMeta` from `funnel-tracking.mjs`, the exact string the
    database trigger and the push proof use); a live funnel is missing one of its three pages on file; a page
    has no live address.
  - PASS only when every page was read and is right.
  - SKIP, never PASS, when: no database; a read threw (the reason is written); pages exist and there is no
    fetch; a page did not answer before the deadline or was over the 60 page limit (a red page still wins).
  - NOTHING TO JUDGE (`na`) when no built funnel is live and the table has funnel rows: code `low-traffic`
    (the existing lane code, "too few X to judge", `what: "live built funnels"`, `count: 0`, `min: 1`).
    `naVerify["low-traffic"]` re-reads with the same `LIVE_SQL` and the same `MIN_LIVE_FUNNELS` constant on
    every audit, and also with `SEEN_SQL`, so a table that reads as empty (a blind read) is a skip, not "none
    live". No new code was added to `na-conditions.mjs` (the list stays closed at eight).
- `src/pulse/coverage/modules.mjs`: the lane is on the list.
- `src/pulse/tripwires.mjs`: `route:marketing/funnels/push-live` in `TRIPWIRES`, impact `money`, check
  `built-funnels:live-pages-answer`. `src/pulse/tripwires-baseline.json`: the entry is gone (495 to 494).
  `src/pulse/tripwires.test.mjs`: `BASELINE_MAX` 495 to 494, as that test's own comment instructs (only ever lowered).
- `src/lib/no-unfenced-transmit.test.mjs`: the lane is on `ALLOWED_RAW_FETCH` with the same `PULSE_GAP_READS`
  reason the 18 other gap lanes carry (a read-only GET of our own pages). That list is how the repo records a raw
  GET; its "no entry is stale" test needs the file to make a call, and it does.

**Tests.** `src/pulse/coverage/gap-built-funnels.test.mjs`, 24 tests, all pass.
PASS: every page 200 with its tag, GET only, cache-busted, one funnel and two funnels, plain db handle.
FAIL: a 404, a 200 with another funnel's tag, an unreachable page, a missing page on file, a page with no
address, a live funnel with no page rows at all, one bad page among healthy funnels. SKIP (never PASS): no
database, a failed read, no fetch, a page that hangs past the deadline (and a red page still wins), over the
60 page limit. NA: none live in a table with funnels (nothing fetched); a table that reads empty is a skip;
hand-mapped funnels (`kind` NULL) never count. `naVerify`: true only at zero live built funnels in a non-empty
table; false with one live, an empty table, no database, another row's proof, a lying `min`. End to end through
the audit: `runGapLane` keeps `na`, and `makeLaneNaVerify` + `verifyNa` say true while none is live and false the
day one goes live.

**Proved from the built bundle** (`node --env-file=<main .env> scripts/pulse/prove.mjs`, which is what
`npm run pulse:prove` runs; a worktree has no `.env`): "OK: every listed file is in the bundle, no step threw or
passed 20 s, no SQL error, nothing tried to write." The lane ran in the bundle in 0.3 s; "audit:lanes-ran: All
43 gap lanes answered"; "audit:expected-present: All 1026 checks that should run showed up" (the new id is one);
"audit:na-verified: All 71 'nothing to judge' rows were checked again and are still true". The lane's own row, run
from that bundle on live data, read only: `na`, code `low-traffic`, and `verifyNa` returned ok. Today the live
database holds one built funnel (`blueprint`, draft) and three hand-mapped ones, so today the lane says `na`. The
PASS and FAIL paths are proved with fakes in the unit tests; there is no live built funnel to read yet. The
8 red rows in that run are other lanes on the live site (a masked key on this laptop, the `/order` price, and
so on) and are not from this branch. `--beats` was not run: no beat was added (see leftovers).

### 2. The pg test (low)

Checked, not assumed. Read from GitHub (GET only): run 37500688925 is workflow `tests`, event `push`, branch
`mm-x4f-funnel-push-on-domain`, head `a915519c0e4c738f9c7eaab76e476968e616855b`, 2026-10-06, linked to PR 25.
Job 112401447413 "suite (real Postgres - blocks)": "Apply every migration to an empty database" success; "Run the
suite against Postgres" failure. In that job's log, "the funnel builder" has 25 subtests, all `ok`. The red came
from tests that do not touch this branch. The checker's statement is right, and the lines above are corrected
to say it that way, including that the job as a whole was red.

### 3. Main moved (low)

`main` is `2d95387f5`. Its two new commits touch six files, all teleprompter or the ship log, and none is a file this
branch touches (0 overlap). `git merge-tree --write-tree main <r2 head>` exits 0 with one tree and no conflict
lines. No code change. A merge of main into r2 was NOT made, on purpose: it would put main's two commits into this
branch's own diff. Whoever merges into main does that merge.

### 4. The three unverified behaviors (low)

`docs/sops/clickfunnels-funnel-push-stops.md`, one section per stop, each with the agent-run API calls, drawn only
from the ClickFunnels docs read on 2026-10-09 (Update Funnel, Update Page, Fetch Funnel Structure, Fetch Funnel,
Fetch Page, Create Custom HTML Page, Archive a Funnel) and from the 2026-10-01 split recorded in
`docs/sops/clickfunnels-custom-html-push.md`.
A (funnel made without the domain): `PUT /funnels/{id}` with `domain_id`, then Retry; a refusal falls back to an
owner call (archive), asked first. B (steps in the wrong order): `PUT /pages/{cf_page_id}` with `sort_order` 0, 1, 2
on our own three pages, read back with `GET /funnels/{id}/structure`, then Retry. C (a step refused at the old
standalone page's path): `PUT /pages/25568231` with a new `current_path`, then Retry; never delete.
It also holds the checklist for an agent to watch the first live push. It is marked "documented, not tried". The
X4F "Gaps" bullet in `docs/journeys/marketing-dashboard-flow.md` points to it.

### 5. The copy check (low)

`CREDIT_WORD` and `CREDIT_FIX` in `src/marketing/funnel-copy.mjs` both had the bare word `score`. Dropping it from
`CREDIT_FIX` alone would not have freed "Score $100,000 in business funding": the same bare word in `CREDIT_WORD`
still made it "credit before funding". So both changed. "score" is credit talk only after your, my, our, their, his,
her, its, this, that, the, a (a score the buyer has; "credit score" is still caught by the word credit). And the
"raise ... credit" part no longer takes "credit limit" or "credit line" (that is funding, and `FUNDING_WORD` already
counts credit lines). "Score $100,000 in business funding" and "Get funded and raise your credit limit" now pass.
"Raise your score", "Know your score before you apply", "Improve your credit score" and "Fix your credit" still
fail. Two tests were added in `funnel-copy.test.mjs`; the three existing lead-with-funding tests are unchanged and
pass.
One owner-rule note, said once: prompt rule 8 says no headline talks about "a score". That still holds for "your
score" and "the score". It no longer holds for "score" used as a verb. If the owner wants the bare word refused
again, it is the two regexes named above.

### Round 2 proof

| Check | Result |
|---|---|
| `npm run lint` | clean, 3221 files parse |
| `npx tsc --noEmit` | 1 error, `src/marketing/filmed-receive.mjs(159,75)` TS2345. That file is identical to main. Not from this branch |
| `gap-built-funnels.test.mjs` (new) | 24 of 24 pass |
| `funnel-copy.test.mjs` | 21 of 21 pass (2 new) |
| `src/marketing/*.test.mjs` + `src/messaging/providers/*.test.mjs` | 1239 of 1239 pass |
| `src/pulse/*`, `beats`, `coverage`, `workflows/index`, `workflows/daily-pulse` | 2815 tests: 2748 pass, 65 skipped, 2 fail (both on main already, below) |
| `routes`, `auth-gate`, `allow-list`, `no-unfenced-transmit`, funnel builder pg (skips here) | 28 of 29 pass; the 1 fail is on main already (below) |
| `pulse:prove`, full, from the bundle | OK, exit 0 |

Failures that are on main already (confirmed with `git show main:<file>`): (a) the fence test lists
`src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`, which main's test does not allow; (b)
`src/workflows/index.test.mjs` does not name `pulse-instant-watch` in `EXPECTED_WORKFLOW_IDS` while main's
`index.mjs` registers it; (c) `registry.test.mjs` "leads/c01cb...": that file is excluded locally in a worktree.

### Round 2 leftovers (not fixed, per rules)

- **No hourly beat for built funnels.** The checker's scenario says "no morning row and no hourly beat goes red".
  The fix asked for the morning lane, the tripwire map entry and `pulse:prove`, and those are done. A beat
  (`src/pulse/beats/beat-<id>.mjs`) is a separate piece: its list `src/pulse/beats/index.mjs` says only the
  integrator edits it, and a beat needs a fix guide, a self test, and `--beats` proof. Until then a dead built page
  is red at the next 6 a.m. pulse, not within the hour. Worth a card.
- **`tsc` has one error on main:** `src/marketing/filmed-receive.mjs(159,75)` TS2345. Not this branch.
- **The three main failures** from round 1 are still on main (fence test, `pulse-instant-watch`, and the
  worktree-only registry row). Their owner is whoever built `src/pulse/funnel-doors.mjs` and
  `src/pulse/instant-watch.mjs`.
- **CI on the merge.** The funnel builder pg test has not run on the merged code. A push is needed for that, and no
  session here pushes.
- **The sentence of the code `low-traffic`** ("The traffic is too low to judge.") is generic. It is only returned
  inside a passing audit, which prints a count and names no sentence, so no reader sees it. A ninth, exact code
  ("no live funnel") would need the closed-list test in `na-conditions.test.mjs` changed, which was not worth it
  for a sentence nobody reads. Not changed.
