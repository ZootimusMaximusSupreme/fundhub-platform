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
| W0 | Quiet-until-first-result for 9 "no saved receipt" controls; Braum owner hold; Needs-Chris list | 9 display rows + 7 Braum rows + 4 vendor rows | this session | claimed |
| W1 | Records data rows: which failing rows are fake, which are real | 12 | agent `records-data` | claimed |
| W2 | Staff data rows: which failing rows are fake, which are real | 13 | agent `staff-data` | claimed |
| W3 | Staff page breaks: Closer Deck / Credit Snapshot links, private leads page, climate map | 5 | agent `staff-pages` | claimed |
| W4 | Jobs: ClickFunnels night job, desk sweep age, inquiry-call-sweeper practice run | 3 | agent `jobs` | claimed |
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

(filled by W0 once each item is verified)

## Change manifests

(each workflow appends its manifest here when done)

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
