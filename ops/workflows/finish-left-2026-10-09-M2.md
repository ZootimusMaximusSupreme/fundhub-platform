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
  rule here is no database write. They skip. This is the biggest gap in the proof. The SQL the branch adds
  (`backfillTags`, `markPageAddress`) was read against migration 425 by hand: setting a tag from NULL is allowed
  by the trigger, and `live_url` may change while `cf_page_id` stays (the guard only blocks id, path, html, funnel).
  The test creates its own hand-mapped rows in its own org, so the new `optimize` row does not break it.
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
- Money: no. No payment, no price, no checkout, no commission.
- Migration: no. The branch adds none. It relies on 425 (already on main and applied).
- Hot path (`src/workflows/client.mjs`, `src/events/bus.mjs`, `api.mjs`): not touched. `api/marketing/funnels/push-live.mjs`
  changed in comments only.
- Live external system: yes, ClickFunnels. When used it POSTs a funnel, POSTs three pages into it, PUTs our own pages,
  and GETs for the proof. It never DELETEs and refuses to make a page outside a funnel. The three behaviors the
  branch's doc marks UNVERIFIED (step path on the funnel's domain, PUT onto a step, the new funnel's step path vs the
  standalone page's path) have never been seen live. Each wrong answer stops the push with the funnel a draft.
- Needs the Playwright check (CLAUDE.md section 6): no, no UI file changed.
- Heartbeat row needed: no. The branch adds no new page, routed api handler, Inngest job, or send path.
  `marketing/funnels/push-live` is already in `PULSE_REGISTRY` and in `tripwires-baseline.json`; the job kind
  `funnel_push` is already on `gap-marketing-queue`; the ClickFunnels provider already existed. The pulse tests
  (`registry`, `heartbeats`, `tripwires`, `beats`, `modules`) pass on the merged tree. No row added.
- One behavior to know: the next Create tags all three hand-mapped live funnels (book_call, optimize, roadmap_147) in
  the database. Tag only; address, status, active and `updated_at` do not change; a tag can never change after (425).
- The Push live button in the Command Center stays off for the live-test funnel (`blueprint`) because a page is
  already on ClickFunnels. The push can be started only through the push-live route or jobs Retry. Known gap in the
  branch's doc, not changed.

## Leftovers (not fixed, per rules)

- The three main failures above (outbound fence on `src/pulse/funnel-doors.mjs` and `instant-watch.mjs`;
  `pulse-instant-watch` missing from `EXPECTED_WORKFLOW_IDS`). Whoever owns the instant-watch build should close them.
- The step page left behind on ClickFunnels when a standalone page is moved into the funnel: deleting it is an owner call.
- Built funnels' live pages have no per-funnel live watcher in the pulse (only the hand-mapped funnels in
  `gap-funnels` / `slice-05-funnels`). Same on main today. Not added here: the branch adds no surface of its own.

## Ready to merge

Yes, with one condition: the pg tests for the funnel builder ran nowhere in this session. Run
`marketing-funnel-builder.pg.test.mjs` against a scratch Postgres (as `fundhub_app`) before or in CI on the PR.
