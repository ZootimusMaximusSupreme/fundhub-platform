# Reds: customer records (32) + staff tools (24) + audit — 2026-10-20

Owner of this board: session `reds-records-staff` (worktree `hungry-clarke-3e9917`, branch `claude/hungry-clarke-3e9917`).
Coordinator: session `local_279c24f9-3a58-41a1-88c2-aa4fdaf3fa41` (ships; nobody else runs `npm run ship`).
Source of the ids: today's 6:02 a.m. scorecard (`pulse_scorecards` 2026-10-20), read live, read-only.

## Shared brief (every workflow reads this first)

- Facts (owner, 2026-10-20): Braum (FH-000507) is the ONLY real client and is no-contact / no-change.
  Every other client, lead, booking and round is fake test data from tests run on production Oct 11-12.
  Chris said YES to deleting the fake data (except Braum). Session `delete-fake-data`
  (`local_e3a69c7b-7609-4572-9ce5-a11de30faafc`, worktree `awesome-shaw-4103bc`) does the deleting. Nobody else deletes.
- The CRM was rebuilt (Astra, PR #81). Old screen checks may be stale.
- Live database: `/Users/chrisstanbridge/Developer/fundhub-platform/.env` `DATABASE_URL` (role `fundhub_app`, 6543 pooler).
  Every read inside `BEGIN READ ONLY` … `ROLLBACK`. Never a bare `SET`. Never a write.
- Run a lane live: `node scripts/pulse/prove.mjs --repo --lanes=<lane>` (read-only, GET/HEAD only). Needs
  `node_modules` (symlink `/Users/chrisstanbridge/Developer/fundhub-platform/node_modules` into your worktree)
  and `DATABASE_URL` exported from that `.env`.
- Owner rule 2026-10-14 (`src/pulse/coverage/gap-catalog-display.mjs`, `emptyAs: "quiet"`): a control nobody has
  used yet is green until its first wrong result.
- No dashboard design changes (Codex owns design; write a card). No sends, charges, credit pulls, customer writes.
- Tests both ways (one PASS, one FAIL). Never weaken, skip or delete a test. Never run `.pg.test.mjs` against production.
- Classes: **A** real break → smallest fix. **B** red only from fake rows → list the rows, do not delete.
  **C** stale check → re-point at the current product without weakening. **N/A** → a code from
  `src/pulse/na-conditions.mjs` with a real `verify()`.

## Task list

| # | Unit | Ids | Owner | Status |
|---|---|---|---|---|
| W0 | Quiet rule for first-batch controls; Braum owner hold; reset-link and demo-brand checks; Needs-Chris list | 20 | this session | done — branch `claude/hungry-clarke-3e9917` |
| W1 | Records data rows: which failing rows are fake, which are real | 12 | agent `records-data` | done — notes `w1-records-data-2026-10-20.md` |
| W2 | Staff data rows: which failing rows are fake, which are real | 13 | agent `staff-data` | done — notes `w2-staff-data-2026-10-20.md` |
| W3 | Staff page breaks: Closer Deck / Credit Snapshot links, private leads page, climate map | 5 | agent `staff-pages` | done — PR #105 |
| W4 | Jobs: ClickFunnels night job, desk sweep age, inquiry-call-sweeper practice run | 3 | agent `jobs` | done — PR #103 |
| W6 | Staff product fixes: Drive file names read as client ids (+ migration), reset-link stamp, empty belief flags | 3 | agent `staff-fixes` | done — PR #108 (migration 499) |
| W5 | Not-checked + keys + template list: meta-server-events, pipe-cut-with-traffic, keys-live-proof, SQL-seeded template keys, audit:not-checked | 5 | agent `notchecked-keys` | claimed |

## Ids by unit

W0 (this session)
- quiet: Mark round submitted, Close round, Lender row Approved $ / Approved / Declined / Doesn't count, contracts Wording list, PDF editor Save boxes, csm-queue Save answers, financeos helper Suggestion buttons
- Braum hold: pipeline:repair, fulfillment:next-action, repair-letter-round, gap-trip-repair:trip:repair, gap-pipeline-boards:pipeline:age, inquiry-remover Repair stage analysis, (pipeline:clients if it is Braum)
- Needs Chris: closer-setup:calendar-late, keys:launch-secrets-present (LENDFLOW_WEBHOOK_SECRET), gap-door-batch-webhooks:door-batch:webhook-lendflow-contract, gap-records:bureau-config:complete

W1: calls:booked-no-outcome, calls:booking-webhook, catalog-data:client_custom_fields, catalog-data:repair_decision_log,
contracts:signed-not-stored, documents:cannot-open, pipeline:clients, client-portal Upload door, client-portal What You Own,
contracts Save (edit an existing wording), money-vault documents-upload, client-control-panel Mark round submitted (the 4 bad of 7)

W2: creative-factory (Summary tiles, Write a script, Save this script, Generate form, Run queued jobs, Review queue brand),
sales-floor (Flag belief, Recording rows), social-studio (Who approves posts), staff-teams (Reset password),
gap-door-batch-jobs:door-batch:ad-video-worker-result, gap-door-batch-webhooks:door-batch:webhook-ad-video-worker,
gap-catalog-flow:flow:message:manual-proof:comms-map-2026-09-19

W3: client-control-panel Quick launch links, More menu Open Credit Snapshot, private leads page (public-pages.json),
gap-catalog-flow:flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map, gap-catalog-reads:catalog-read:climate-map

W4: clickfunnels-night-job, live-playwright:desks, gap-door-batch-jobs:catalog-job:jobs.json:workflow:inquiry-call-sweeper

W5: meta-server-events, gap-leads:lead:pipe-cut-with-traffic, audit:not-checked, gap-door-batch-keys:door-batch:keys-live-proof,
gap-catalog-flow:flow:message:template-copy:SQL-seeded-only-keys-not-in-doc-source

## Needs Chris

Verified live, read-only, 2026-10-20 evening. Each is one decision only Chris can make.

1. **4 stuck video uploads (Sept 24):** SLO Portal Welcome Take 1, SLO VSL 1 Open, SLO VSL 1 Middle, SLO VSL 2 Booking (`ad_videos` b7e7b61e, f692a218, 802c10d5, 2d6b83eb). Pick one: (a) clear them and leave the takes failed — no cost; (b) upload again — spends 4 Submagic uploads; (c) drop them if re-filmed. Rows: `gap-door-batch-jobs:door-batch:ad-video-worker-result`, `gap-door-batch-webhooks:door-batch:webhook-ad-video-worker`.
2. **Delete the Aug 16 belief flag** `f248a8af` (filed by Chris, "pain this period 0 vs last 0", no lead source)? yes/no. Row: sales-floor `Flag <belief>`. (W6 blocks new empty flags.)
3. **Delete 2 old hand-made reset links** for affiliate David Ramirez (Sep 29, 7 days long, `f1732962`, `747f6546`)? yes/no. No code makes these. If no, the row stays red until Dec 28. Row: staff-teams `Reset password`.
4. **Desk sweep:** OK to run `node scripts/live-playwright-sweep.mjs` on the Mac (it signs into the live staff desks with the test staff login) and install the nightly job from PR #103? yes/no. Row: `live-playwright:desks` (last run 303 h ago).
5. **Booking page hosts:** Justice Nikkel and Sarah Blankstein are 13 days past due to join the booking page. Only a ClickFunnels team admin can add a host. Pick: more days, drop the ask, or add them. Row: `closer-setup:calendar-late`.
6. **client@fundhub.ai bounces:** the App Store review login (FH-000844) got 2 sign-in emails that bounced (Oct 18, Oct 20). fundhub.ai mail is Google Workspace. Add client@fundhub.ai as a user or alias: https://admin.google.com/ac/users . Row: `gap-catalog-flow:flow:message:manual-proof:comms-map-2026-09-19` (goes red at 6:02 a.m. tomorrow).
7. **Delete fake data:** already yes. Extra rows the client delete misses were sent to `delete-fake-data` (5 events with no client; Oct 12 staff-tool fixtures). Rows that clear when those go: `calls:booked-no-outcome`, `calls:booking-webhook`, creative-factory ×5, social-studio `Who approves posts`, `documents:cannot-open`.

Owner calls applied (recorded, not re-asked): Braum FH-000507 is on owner hold (owner 2026-10-09 "dont worry about bram", 2026-10-20 no-contact/no-change), list in `src/pulse/owner-holds.mjs`. Lendflow paused (B8), bureau calls and Meta sync future (B6), bureau numbers in the caller scripts (B7) — already on main from PR #97.

## Change manifests

(each workflow appends its manifest here when done)

### W0 manifest (this session, branch `claude/hungry-clarke-3e9917`)

- Owner hold: uses the money lane's `src/pulse/owner-hold.mjs` and code `owner-hold-client` (PR #102; this branch merges it, so #102 lands first). Late-file helpers added to that file; `src/pulse/owner-hold-lanes.test.mjs` (15 tests both ways). One list, one code.
- `src/pulse/coverage/gap-fulfillment.mjs`, `gap-repair.mjs`, `gap-pipeline-boards.mjs`: when the only late file is held, the row is "nothing to judge" / `owner-hold`, re-checked by the lane (57-156 ms live); any other late file is red by name. `gap-trip-repair.mjs`: green with the hold named (its read is too heavy for the audit clock, same reason as judgeTrip's empty trip).
- `src/pulse/catalog/proofs/fin-b07-sql-repair.mjs`, `fin-b07-display-contracts.mjs`, `src/pulse/coverage/gap-catalog-display.mjs`: the 12 repair stage columns leave held files out and say so on the green line.
- `src/pulse/catalog/proofs/display-saved-result.mjs` (+ `display-saved-result-quiet.test.mjs`): owner rule 2026-10-14 `emptyAs: "quiet"` for helper suggestions, contract wording list, PDF boxes, CSM answers (the round and lender controls were done on main as `no-real-funding`).
- `src/pulse/catalog/proofs/fin-b21-display-contracts.mjs` (+ test): reset-link check knows a link ended by a newer one is not a use.
- `src/pulse/catalog/proofs/fin-b11-display-contracts.mjs` (+ test): brand approval check skips demo partners, like its siblings.
- `src/pulse/catalog/generated.json` regenerated. No route, job, journey or screen changed.
- Proof: `prove.mjs --repo` full morning on live data, read-only (22.3 s): every W0 row green or owner-hold; `audit:na-verified` 304 of 304 still true.

### W4 manifest (agent `jobs`, branch `claude/w4-jobs-2026-10-20`) — 3 ids, 2026-10-20 evening

Evidence read live, read-only (every query `BEGIN READ ONLY` + `ROLLBACK`; ClickFunnels GET only; no write, no send).

1. `clickfunnels-night-job` — CLASS: not a code break. Waits for the next 07:15 UTC pass.
   - Cause: there was no ClickFunnels connection for the night job to pull. `analytics_connections` has ONE row, created 2026-10-20 10:17 UTC; the
     10:20:51 UTC hand sync wrote the only 12 `funnel_page_stats` rows (all `stat_date` 2026-10-20). Every night pass 10-11 .. 10-20 ran, finished
     in about 0.3 s, and the heartbeat says `ok` with `item_count` empty. 0.3 s is "0 accounts to pull". The sweeper code is registered, on the right cron,
     and reads through `asStaff()`.
   - Proof the pull works: a read-only run of the real `sweep()` from the Mac (writes forced to fail) found the 1 account and made 5 ClickFunnels GETs
     (teams, workspaces, funnels, pages, page stats), all 200, and reached the first INSERT.
   - Result: tomorrow's pass (07:15 UTC = 00:15 Arizona) writes `funnel_page_stats` inside the slot, so the row is green on the 6 a.m. scorecard of 10-21.
     It cannot honestly turn green earlier: the check only counts a write inside the night slot, and the 10:20 write was a hand run.
   - No code changed for this id. Leftover cards (not fixed, by the hard lock): (a) `ACTIVE_ORGS_SQL` only lists `connection_state = 'active'`, and a failed pull
     sets `'error'`, so one blip stops the night job until a hand pull; (b) the sweeper swallows per-account errors and returns, so the heartbeat reads `ok`
     even when every account failed, and it returns no `count`, so `job_heartbeats.item_count` stays empty.
2. `live-playwright:desks` — NOT RUN. `scripts/live-playwright-sweep.mjs` logs into the live staff desks with `STAFF_E2E_PASSWORD` (password entry on production) and
   then writes an `agent_runs` row. Brief says: password needed means do not run. It is 316 h old because nothing schedules it (no plist, no workflow).
   - Changed: added the nightly job file `ops/launchd/ai.fundhub.live-playwright-sweep.plist` (daily 03:30 Arizona, `RunAtLoad` false, no secrets),
     `scripts/live-playwright-launchd.test.mjs` (real file passes; weekly / no schedule / wrong script / late hour / written secret each fail), and the row's
     fix guide in `src/pulse/live-playwright-check.mjs` now names the plist. NOT INSTALLED.
   - Install (lead decides): `cp ops/launchd/ai.fundhub.live-playwright-sweep.plist ~/Library/LaunchAgents/` then
     `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/ai.fundhub.live-playwright-sweep.plist`. Test once: `launchctl kickstart gui/$(id -u)/ai.fundhub.live-playwright-sweep`.
     Log: `~/Library/Logs/fundhub-live-playwright-sweep.log`. The plist runs from the main checkout (that is where `.env` lives).
   - Risk: the 41 old live specs may score under 100 after the Astra CRM rebuild; the first nightly run would then show a real red with titles.
3. `gap-door-batch-jobs:catalog-job:jobs.json:workflow:inquiry-call-sweeper:*` — ALREADY CLASS N/A, no change. Owner answer B6 (commit 620308ce7, 16:34 Arizona, in
   shipped build d1de88a1) parks it: `src/pulse/parked-features.mjs` `bureau-calls`. Read live now: the row returns `na` / `feature-not-set-up`
   ("no real inquiry case has a bureau call due or placed"; 0 cases have `call_due_at`/`call_fired_at`). The 6:02 scorecard line is from before that ship.
   I did NOT add the fake-data run: moving the job into `PROVED_FINAL_JOB_SURFACES` removes the row from `FINAL_JOB_GAP_ROWS`, which the parked-features tests
   index (`INQUIRY_ID`), so it would mean rewriting those tests and undoing today's owner call. When bureau calling is switched on, the row un-parks and
   goes red; the fake-data run is the work for that day.
- Also seen (not mine, not touched): between 01:20 and about 01:52 UTC the Inngest minute/5-minute crons did not run (`message-dispatch-sweeper`, `inquiry-call-sweeper`,
  `pulse-instant-watch` last heartbeats 01:15-01:20 UTC at 01:56 UTC; `commas-inbox-drain` back at 01:52). 11 job rows were red from it in my lane run. Recheck.
- Checks run: `node --test src/pulse/live-playwright-check.test.mjs scripts/live-playwright-launchd.test.mjs` 7/7; `node scripts/pulse/prove.mjs --repo --lanes=gap-door-batch-jobs` OK (no write, no step over 20 s).
### W3 manifest (agent `staff-pages`, branch `claude/w3-staff-pages-2026-10-20`) — 5 ids, 2026-10-20 evening

PR: https://github.com/ZootimusMaximusSupreme/fundhub-platform/pull/105 (commit e716b1199). Not merged, not shipped.
Live reads before the change (`prove.mjs --repo --lanes=gap-catalog-display,gap-catalog-flow,gap-catalog-reads`, read-only, GET only): ids 1-3 PASS, ids 4-5 FAIL.

1. `catalog-display:desks-a.json:client-control-panel.html:Quick launch links…` — already fixed on main (PR #97 / commit 781743160, `CLOSER_DECK` in
   `public/app/shell.js`, live in d1de88a1). Live read now PASS for all 8 staff roles. No change.
2. `catalog-display:desks-a.json:client-control-panel.html:More menu: Open Credit Snapshot link` — same, PASS live. No change.
3. `catalog-display:public-pages.json:page:leads/<32-hex>/index.html…` — CLASS C. The 6:02 page was the real list the GitHub ship writes from
   `PRIVATE_LEADS_PAGE_B64` (ship run 39419900845, deploy 6ad75b96…). Its only "send" is a tap-to-text link `a.href = 'sms:' + lead.phone;`.
   Re-pointed the judge, not weakened: allows only plain `.href =` + a string that is only `sms:`/`tel:` (+ optional number) + at most one property
   read + `; , ) }`. Body, second piece, web address, `+=`, other setter, call on the string, no closing mark, `mailto:` all stay red.
   - Files: `src/pulse/coverage/fin-b07-leads-page.mjs` (`isPhoneLink`, `setsAnAddress`; lexer also returns `strings`),
     `src/pulse/coverage/fin-b07-leads-page.test.mjs` (4 green shapes, 11 red shapes). 6:02 page judged offline: green.
4. `gap-catalog-flow:flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map` — CLASS A. The built chunk still inlined the Darwin pack's 5 boxes;
   the 51 real us-atlas outlines in `public/climate/maps/us-states-paths.json` (since 10-18) were never read by the page.
   - Files: `public/climate/_next/static/chunks/375-9c2ed26a6c945538.js` (those exact outlines inlined; viewBox `0 0 400 340` -> `0 0 975 610`, the us-atlas
     frame; no style change). Tests that pinned "red today" now hold the shipped page green and the same page with the 5 boxes put back red:
     `src/pulse/catalog/proofs/fin-b22-page-reads.test.mjs`, `src/pulse/catalog/proofs/fin-b27-h-read-contracts.test.mjs`, `src/pulse/coverage/gap-catalog-flow.test.mjs`.
   - Proof: real climate judge on the patched page (local server, live `/api/climate` GET passthrough) PASS "draws all 51"; `e2e/live-climate.spec.mjs`
     desktop + phone 2/2 on the patched page; 51 paths drawn.
5. `gap-catalog-reads:catalog-read:climate-map` — same cause and fix as 4. Goes green on the live site after the next ship.
- Checks: 11 related test files pass; `npm run lint` clean (4111 files); `npx tsc --noEmit` clean.
- Leftover cards (not fixed): (a) which leads page is live flips with who ships — a GitHub ship writes the real list from the secret, a Mac/worktree ship
  writes the empty shell from the repo (live right now); the main checkout's untracked copy loads `icloud-leads.js` and has other columns (red if shipped).
  (b) Codex/design: on desktop the climate map card is ~15 px shorter than the map, so the bottom edge of Hawaii is covered.
  (c) `docs/journeys/` has no `climate-lead-magnet-actual.md`, so no actual journey was updated.

### W6 manifest (agent `staff-fixes`, branch `claude/w6-staff-fixes-2026-10-20`, PR #108) — 3 code fixes, 2026-10-20 evening

No database write, no send, no delete. Tests run with `DATABASE_URL` unset. Migration 499 was NOT run anywhere; the coordinator ships it.

1. Recording rows (`sales-floor Recording rows`, 14 of 120 red).
   - Code: `src/company-brain/store.mjs` `upsertExtractedFile` keeps a sniffed client id only when `clients` has that id in the same org, else `client_id` NULL and `unattached` true. A non-UUID id is dropped without asking the database.
   - Migration: `db/migrations/499_brain_files_clear_made_up_client_ids.sql` (checked origin and every branch/worktree: 492-497 taken, 495 and 496 each used twice by other branches, 498 used in a worktree; 499 was free). Sets `brain_files.client_id = NULL` only where `client_id IS NOT NULL` and no `clients` row matches id AND org. Guarded on both tables existing, one UPDATE, no DELETE, only the `client_id` column (the table trigger stamps `updated_at`), second run matches 0 rows. `db/expected-migrations.mjs` regenerated (`npm run migrations:manifest`); other branches that add 495/497/498 will conflict on that one generated file, re-run the manifest after merging.
   - Effect on the 14 rows: client_id NULL passes the check (`bf.client_id IS NOT NULL AND c2.id IS NULL` is false). `unattached` on those old rows stays as saved (owner brief: nothing else touched); nothing reads it.
   - Tests: `src/company-brain/store.test.mjs` (+4), `src/company-brain/brain-client-id-migration.test.mjs` (new, 5).
2. Password links (`staff-reset-link`, "used after it ran out").
   - Code: `src/auth/invite.mjs` three UPDATEs (invite, staff reset, affiliate/partner reset) add `AND expires_at > now()`.
   - Tests: `src/auth/invite.test.mjs` (+4, all fail on the old code, checked), `src/auth/auth.pg.test.mjs` (+1 real-database case, skips locally, runs in CI). The old red rows age out on their own (2026-11-10 / 2026-12-28 per W2 notes); nothing was rewritten.
3. Empty belief flags (`sales-floor Flag belief`).
   - Code: `src/sales/call-outcomes.mjs` `createMarketingFlag` throws `CallOutcomeError` (400, `bad_request`) "There are no calls behind this belief yet, so there is nothing to flag." when outcome count is not above 0, or lead source or setter is empty/blank. The page's existing `alert(r.error...)` in `public/app/sales-floor.js` shows the message (`FHData.write` prefers the server's `message`); no page change, no design change.
   - Tests: `src/http/marketing-flags-handler.test.mjs` (+10: nine refused shapes, one stored). The existing flag in `marketing_flags` (`f248a8af`, count unknown, real staff) is untouched; whether it was a test is still a Needs-Chris item from W2.
- Also: `docs/lessons/pulse-lessons.md` has three new entries (heartbeat rule 13). No journey `-actual.md` change: the route tables for these flows did not change.
- Checks run: `npm run lint` clean; `src/company-brain`, `src/auth`, `src/sales`, `src/http/marketing-flags-handler`, `src/http/staff-invite`, health/migration guards, `src/security`, and the fin-b19/fin-b21/gap-auth/gap-staff pulse tests: 0 fail (33 database tests skipped, as with no `DATABASE_URL`).

## Leftover cards (not fixed; one line each)

- ClickFunnels night job: lists only `active` connections, so one failed pull stops it; per-account errors are swallowed so the heartbeat reads ok (W4).
- Private leads page: which page goes live flips with who ships (GitHub ship = real list from the secret; Mac ship = empty shell) (W3).
- Codex design card: on desktop the climate map card is about 15 px too short and covers the bottom of Hawaii (W3).
- Bookings: no-shows never reach a re-keyed booking (`comms.mjs:452`, `dpc-02-call-outcome-enforcement.mjs:82`) (W1).
- money-vault upload check reads a re-upload of the same bytes as a shared file (W1).
- All Inngest crons stopped at 01:20 UTC (message dispatch, the 5-minute watch); told the coordinator at 02:05 UTC.
- Morning audit: on the Mac, 1 of 2 runs the first "nothing to judge" re-check (`pipeline:clients`, a 24-row count) passed 2.5 s, and the audit then blocks every later re-check. Live server was fine this morning; watch `audit:na-verified` tomorrow.
