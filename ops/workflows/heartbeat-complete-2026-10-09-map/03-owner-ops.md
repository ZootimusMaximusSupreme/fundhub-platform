# Heartbeat map — group 03-owner-ops (2026-10-09)

Read-only audit. No app code, tests, config or env were changed. This is the only file written.

## What I covered

- `docs/journeys/role-owner-intended.md` (15 areas)
- `docs/journeys/role-csm-actual.md` (there is **no** `role-csm-intended.md`; steps come from the hand-traced actual file)
- `docs/journeys/ops-pulse-intended.md` (the Ops Admin screen, not the 6 a.m. job)
- `docs/journeys/gate-relay-intended.md`
- The morning text itself, and the alarm path it rides on

## Counts (58 steps)

| covered | ping-only | weak | missing |
|---|---|---|---|
| 19 | 17 | 5 | 17 |

## The plain answers

1. **Is the morning text watched? No.**
   - If the 6 a.m. job does not run, nothing goes red. Both rows that watch it (`job:daily-pulse`, `02-daily-pulse:ag-07-cron-daily-pulse`) are read by the same job. One missed day stays green for 3 days.
   - If the job runs but the text does not send, nothing goes red. The result is saved on `morning_briefs.delivery_status`, and nothing reads it.
   - If the brief step crashes, it is only logged. The old "morning check" text is switched off while the brief is live. So Chris gets no text, and the job still looks fine.
   - The first sign is Chris noticing there is no text. The 9 p.m. text would say "no morning check is stored for today", but only if the evening job and the phone line both work.
2. **The 5-minute watch is the only fast alarm.** It covers 5 things: site and database, login page, apply page, the $297 sales page, and texts stuck in the queue. It runs on the same system (Inngest) and sends on the same phone line (Twilio) as the 6 a.m. job. If either one dies, every alarm goes quiet. Nothing outside Inngest checks Inngest.
3. **The money holes are the bill-chasing steps.** The funding success-fee ladder (notice 1, notice 2, notice 3, hand-off to a person) has no real tripwire. The hand-off task has no due date, so the "overdue and unassigned" check skips it. Also, a payment webhook that never arrives cannot be seen. The authors of `gap-payments.mjs` say so in the file header.
4. **37 owner/CSM door rows are "not checked" every morning.** All 37 rows in `slice-30-csm-owner` come back "not checked" in production (measured read-only 2026-10-09). They were written as a list, not as checks. The real coverage for those doors is the plain GET pings (`reg:`) and a few deep rows (`csm:*`, `owner-tools:*`).
5. **Gate relay is a Mac tool and production cannot see it.** The 6 a.m. job always says "not checked" for it. No `.fundhub-relay` folder and no relay process were found at this checkout on 2026-10-08 night.

## Proof I ran (read-only)

- Live SQL as `fundhub_app` in `BEGIN READ ONLY`:
  - `morning_briefs`: morning 2026-10-08 sent 13:01Z, evening 2026-10-08 sent 04:00Z. So the text works today. Only 3 rows exist (the feature is new).
  - `pulse_scorecards` 2026-10-08: 420 checks, 411 green, 0 red, 9 not checked. `gate-relay` = not checked ("Mac process — not on this host"). `job:daily-pulse` = not checked ("too soon").
  - That run was **before** the gap lanes shipped (2026-10-08 16:07 -0700). It holds no slice rows and no gap rows. The first production morning with them is 2026-10-09. My "covered" calls on gap lanes rest on the built-bundle proof in `scratchpad/live-bundle/*.json`, not on a production morning.
  - `job_heartbeats`: `daily-pulse` 1 row (ok), `evening-brief` 2 rows (ok), `pulse-instant-watch` 397 rows (ok). `agent_runs`: AG-07 passed 10-06, 10-07, 10-08. No `pulse-instant` alert has ever been recorded.
  - `tasks` for the CSM role: 36, all "halfway check-in", all unassigned, first due 2026-12-29. `customer_insights`: 0 rows. `events`: `round.funded` 4 and `invoice.sent` 3, **all demo** (never a real client). `invoices` read 0 rows.
- My own read-only runner `scratchpad/slices-live.mjs` ran all slice rows against live data: 350 rows, 292 not checked, 57 PASS, 1 FAIL (`03-marketing:outbox_drain`, not my area).
- `GET https://fundhub.ai/app/morning-brief.html?date=2026-10-08` answered **404**. The morning text ends with that link.
- Bundle proof read (`scratchpad/live-bundle/*.json`, run 2026-10-08 evening): `csm` 3/3 PASS, `owner-tools` 7/7 PASS. `consent`, `contracts`, `documents`, `finance-os`, `banks`, `payments`, `webhooks`, `staff`, `meet`, `jobs` all PASS. `ads` and `auth` PASS except one skip each (`ads-running-no-metrics`: no ad old enough; `gap:auth-reset-mail`: that run had no live email key).

## Stale or missing journey docs

- `role-csm-intended.md` does not exist. CLAUDE.md §4 says Chris writes intended files, so I did not draw one.
- `role-owner-intended.md` is stale and says so itself. It was written after the fact on 2026-08-02 from route data. It lists 15 areas and 26 read routes. The actual file now shows 40 areas and 66 read routes. It cannot catch a missing step because it was copied from the code.
- `src/ops/morning-brief.mjs` cites `docs/journeys/morning-brief-flow.md` and `docs/specs/morning-brief-2026-10-05.md`. Neither is on disk. There is no journey doc for the 6 a.m. text.
- Name clash: `ops-pulse-intended.md` is the Ops Admin screen. The 6 a.m. job is the "daily pulse". Different things. No journey doc covers the 6 a.m. job.

Status key: covered = a deep check would go red within a morning. ping-only = only up/down or "has run". weak = a check exists but cannot really go red in production. missing = nothing goes red.

---

## A. The morning text and the alarm path

| # | Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| A1 | The 6 a.m. job runs at all | `job:daily-pulse`, `02-daily-pulse:ag-07-cron-daily-pulse`, `recon` | ping | Barely — a crashed run shows red next morning; a run that never starts is never read; 1 missed day stays green (72 h / 3 mornings) | none | weak | internal |
| A2 | Inngest itself is alive (runs the 6 a.m. job and the 5-minute watch) | none (`inngest` is on the not-pinged list; `health` reads only the database and migrations) | none | No — nothing outside Inngest reads Inngest | none | missing | internal |
| A3 | The morning brief is built and saved after the check | `06-briefs:morning-brief` | none | No — it looks for a job named `morning-brief`, the real job is `daily-pulse`, so it is "not checked" forever; a crash is only logged | none | weak | internal |
| A4 | The morning text reaches Chris's phone | none (`morning_briefs.delivery_status` is saved, nothing reads it) | none | No — "failed" or "no_number" is stored and no row goes red | none | missing | internal |
| A5 | The 5-minute alert text reaches Chris's phone | none (`agent_runs` outcome is saved, nothing reads it) | none | No — and a failed alert is not retried for an hour (the cooldown ignores the outcome) | none | missing | internal |
| A6 | The "Full report" link in the text opens | none (`reg:read/morning-brief` pings the data door only) | none | No — `/app/morning-brief.html` is 404 on a live GET today; no page file, so no desk row | none | missing | internal |
| A7 | The 9 p.m. evening brief runs | `job:evening-brief`, `06-briefs:evening-brief` | ping | Yes — red if no run in 3 days or last run errored; says nothing about the text | 6am | ping-only | internal |
| A8 | The 5-minute watch keeps running | `job:pulse-instant-watch` | ping | Yes — but read once a day at 6 a.m., so a death at 6:05 shows about 24 h later | 6am | ping-only | internal |
| A9 | The 5-minute doors: site and database, login page, apply page, $297 sales page, queued texts | `health`, `login`, `apply`, `funnel:roadmap-sales`, `pipeline:outbound` | deep | Yes — each can FAIL and text Chris within 5 minutes; login and apply read page words only, not a real sign-in | 5min | covered | money |

## B. Ops Admin screen (ops-pulse-intended.md)

| # | Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| B1 | Owner opens Ops Admin (page and read door answer) | `reg:ops-admin`, `reg:read/ops-pulse` | ping | Yes — red on 404/5xx; a 401 counts as up, so the query never runs | 6am | ping-only | staff-only |
| B2 | Ops Admin can read today's company numbers | `owner-tools:ops-admin` | deep | Yes — runs `computePulse` as staff; red if the KPI read throws or no numbers come back; does not run the API handler or the brief-text builder | 6am | covered | staff-only |
| B3 | The numbers and the 27/27 bars are right, not just present | none | none | No — deposits, funded files and ad spend turn errors into "missing" on purpose; nothing compares to source rows | none | missing | staff-only |
| B4 | Loading the page writes nothing (no task, no LinkedIn post) | none | none | No — unit tests only, no live check | none | missing | internal |
| B5 | Hire button: `POST /api/ops/hire-closer`, one hire task a month | `reg:ops/hire-closer` | ping | Yes — red on 404/5xx; a GET answers 405 which counts as up, the write never runs | 6am | ping-only | staff-only |
| B6 | The LinkedIn closer post lands (or says "not configured") | none | none | No — nothing checks the LinkedIn connection or the post | none | missing | staff-only |
| B7 | Ad spend feeds the pulse | `meta-sync`, `ads-meta-sync-stale`, `ads-spend-day-missing`, `job:meta-campaign-sync-hourly` | deep | Yes — red when Meta numbers are over 36 h old, a spend day is missing, or Meta errored | 6am | covered | staff-only |

Fire / raise / bonus: the intended file says no rule exists and nothing runs. There is no behavior to watch, so I did not count it as a step.

## C. Gate relay (gate-relay-intended.md)

| # | Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| G1 | A skill writes a gate file, the relay sees it, the question goes out, a decision file comes back, the waiting session continues (steps 1, 2, 3, 7) | none | none | No — only `scripts/gate-relay/gate-relay.test.mjs`; no live check on a Mac-only tool | none | missing | internal |
| G2 | The relay is running (heartbeat file fresh, process alive) | `gate-relay` | ping | No in production — the 6 a.m. job passes no folder, so it is always "not checked" (stored 10-08 scorecard); only the Mac script reads it; the local watchdog texts "went down" but nothing watches the watchdog | none | weak | internal |
| G3 | The Telegram question actually arrives on Chris's phone | none | none | No — the bot token and chat id are never tested | none | missing | internal |
| G4 | Only Chris's Telegram id can answer; strangers are ignored | none | none | No — tests only | none | missing | internal |
| G5 | A voice note is heard, or "Couldn't hear that" comes back (steps 4 and 5) | none | none | No — the speech-to-text key and the fallback are never tested live | none | missing | internal |

SMS channel is a stub by design ("not wired"). Not a step.

## D. Role owner (role-owner-intended.md)

Route counts are from the intended file. The actual file now shows more (see "Stale" above).

| # | Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| O1 | Signing in and out (7 routes) | `login`, `reg:auth/login`, `reg:auth/session`, `reg:auth/logout`, `reg:auth/magic-link`, `reg:auth/reset`, `gap:auth-staff-login`, `gap:auth-session-read`, `gap:auth-signin-no-session`, `gap:auth-magic-link-dead` | deep | Yes — red if sessions cannot be read or written, or 5+ failed sign-ins from 2+ emails with 0 successes in 24 h; with 0 sign-ins a day, a quiet break waits for the first try | 5min + 6am | covered | customer-blocked |
| O2 | "Recognised as owner?" and the role's home desk | `gap-staff:role-gate`, `gap-staff:role-desk` | ping | Yes — red if a bad cookie crashes (500) or a role's desk will not load; it never checks that a non-owner is refused with 403 | 6am | ping-only | internal |
| O3 | banking (3 sync routes) | `reg:banking/sync-accounts`, `reg:banking/sync-liabilities`, `reg:banking/sync-transactions`, `banks-plaid-item-error`, `banks-sync-stale`, `banks-active-link-no-accounts`, `job:plaid-transactions-sweeper` | deep | Yes — a bank login in error shows next morning; a silent stall shows after 3 days | 6am | covered | staff-only |
| O4 | Campaigns (6 routes) | `reg:campaigns/list`, `reg:campaigns/spend`, `meta-sync`, `ads-meta-sync-stale`, `ads-spend-day-missing`, `ads-number-unmapped`, `job:meta-campaign-sync-hourly` | deep | Yes — red on old Meta numbers, a missing spend day, or an ad with no Fundhub number | 6am | covered | money |
| O5 | consent (1 route) | `reg:consent/capture`, `consent:page`, `consent:required`, `consent:store`, `consent:slo-store`, `consent:dispute-required` | deep | Yes — red if a paid client has no live soft-pull consent or a signed paper has no consent row | 6am | covered | customer-blocked |
| O6 | contracts (1 route) | `reg:contracts`, `contracts:sent-unsignable`, `contracts:signed-not-stored`, `contracts:template-missing`, `contracts:sign-route`, `job:contract-chaser` | deep | Yes — red if a sent contract cannot be signed, a signed one has no copy, or a template is gone | 6am | covered | money |
| O7 | Creative Factory (4 routes) | `reg:creative-factory`, `reg:creative/generate`, `reg:creative/jobs`, `reg:creative/approvals`, `owner-tools:creative-factory`, `job:creative-job-runner` | ping | Yes — red if the page or route is dead, the jobs list query throws, or the runner stops for 6 minutes; nothing counts stuck or failed jobs | 6am | ping-only | staff-only |
| O8 | The dashboard: company KPIs | `reg:dashboard/kpis`, `owner-tools:ops-admin` | deep | Yes — same KPI code as Ops Admin; red when it throws; wrong numbers are not seen (see B3) | 6am | covered | staff-only |
| O9 | The dashboard: pipeline, counts, client lists | `reg:dashboard/pipeline`, `reg:dashboard/pipeline-counts`, `reg:dashboard/clients`, `reg:dashboard/client` | ping | Yes — red on 404/5xx; a 401 counts as up, the query never runs | 6am | ping-only | staff-only |
| O10 | Documents (1 route) | `reg:documents`, `documents:upload-store`, `documents:required-unchased`, `documents:stuck-processing`, `documents:cannot-open` | deep | Yes — red if uploads fail, a required doc is unchased past 3 days, or a row is stuck | 6am | covered | customer-blocked |
| O11 | Finance (10 routes) | `reg:finance-os`, `reg:read/finance-os`, `finance-os:credit`, `finance-os:plan`, `finance-os:declines`, `finance-os:vault`, `finance-os:transfers`, `finance-os:payments`, `finance-os:helper`, `job:finance-os-pull-sweeper` | deep | Yes — each screen is read as a real linked client; red on a crash or non-200; wrong math is not seen; 3 finance jobs still "not checked" (too soon) | 6am | covered | customer-blocked |
| O12 | Hiring: a candidate applies (public door) | `gap-staff:hiring-apply`, `staff-invite-link`, `reg:hiring` | deep | Yes — red if the apply door is not 200 or lists no open roles | 6am | covered | staff-only |
| O13 | Hiring: owner decides, outreach cadence runs | `reg:hiring/decide`, `job:hiring-outreach-cadence`, `job:hiring-bench-sweeper` | ping | Yes — red if the route is dead or a job is quiet for 3x its schedule; the decision write and the sends are never run | 6am | ping-only | staff-only |
| O14 | journeys editor (2 routes) | `reg:journeys`, `reg:journeys/run`, `reg:journeys/ask`, `owner-tools:journeys` | deep | Yes — red if a saved journey's steps are not a list; 0 saved today, so it passes on nothing | 6am | covered | staff-only |
| O15 | privacy erasure (1 route) | `reg:privacy/erasure` | ping | Yes — red on 404/5xx only; the erasure itself is never run | 6am | ping-only | internal |
| O16 | Reading data (26 routes intended, 66 actual) | `reg:read/*` (for example `reg:read/invoices`, `reg:read/staff`, `reg:read/commissions`) | ping | Yes — red on 404/5xx; an unsigned GET gets 401 before any query, so a broken query is invisible; deep for only 4: `csm:queue-api`, `owner-tools:ops-admin`, `sales-manager:read-api` (sales floor, my numbers) | 6am | ping-only | staff-only |
| O17 | Everything else (15 routes intended, 43 actual) | `reg:tasks`, `reg:shifts`, `reg:bookings`, `reg:call-outcomes` and the rest of `reg:*` | ping | Yes — same as O16: door only | 6am | ping-only | staff-only |
| O18 | Incoming webhooks: Commas payments are processed and settle the link | `webhooks:commas`, `webhooks:stuck-failed`, `payments:pay-link-webhook`, `payments:commas-webhook-route`, `job:commas-inbox-drain` | deep | Yes — red if a processed payment's link is not settled, or an inbox row sits failed | 6am | covered | money |
| O18b | Incoming webhooks: a Commas payment webhook ever arrives (customer paid, Fundhub never told) | none | none | No — a webhook that never arrives leaves no row; `gap-payments.mjs` header says no read-only check can see it | none | missing | money |
| O19 | Incoming webhooks: ClickFunnels, calendar booking, Twilio status | `webhooks:clickfunnels`, `webhooks:calendar-booking`, `webhooks:twilio-status` | ping | Yes — red if the door is gone; they only prove the router is mounted (405 plus a 401 to an empty probe); a missing order or booking is not seen here | 6am | ping-only | money |

## E. Role CSM (role-csm-actual.md; no intended file)

| # | Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| C1 | Halfway call is created when a client pays (`deposit.paid`, `sale.closed`, `payment.received`) | `csm:missing-step`, `gap-jobs:failed-events` | deep | Yes — red if a real client with one of those events in 60 days has no halfway task, or the handler threw; demo clients are left out | 6am | covered | staff-only |
| C2 | Results call is created when a round funds (`round.funded`) | `csm:missing-step` | deep | Yes — same read for the results task; the 4 `round.funded` events on file are all demo, so this path has never run for a real client | 6am | covered | staff-only |
| C3 | The results call gets its booking link and time (`booking.created` stamps the task) | none | none | No — event step with no last-run time; nothing reads the task's meeting link | none | missing | staff-only |
| C4 | No call sits unassigned | `csm:overdue-unassigned` | deep | Yes — red if a CSM task is over a day past due with nobody on it; first real due date is 2026-12-29, so it has never been tested live | 6am | covered | staff-only |
| C5 | The CSM sees their queue (page and `GET /api/read/csm-queue`) | `csm:queue-api`, `reg:csm-queue`, `reg:read/csm-queue` | deep | Yes — `csm:queue-api` runs the real queue handler and SQL; red if it throws or answers non-200; the page's own buttons are not run | 6am | covered | staff-only |
| C6 | CSM clocks in and claims a task (`/api/shifts`, `PATCH /api/tasks`) | `reg:shifts`, `reg:tasks` | ping | Yes — red on 404/5xx only; the 2026-09-17 break (claim blocked without a shift) would not show | 6am | ping-only | staff-only |
| C7 | CSM saves the answers (`POST /api/customer-insights` makes a `customer_insights` row) | `reg:customer-insights`, `reg:read/customer-insights` | ping | Yes — red on 404/5xx only; a GET answers 405 which counts as up; `customer_insights` has 0 rows, so the path is unproven live | 6am | ping-only | staff-only |
| C8 | Recording and marketing consent is captured (`call_recording`, `marketing_use`) | `reg:consent-capture`, `consent:page` | ping | Yes — red if the page is gone; the consent lanes only check soft-pull and dispute kinds; nothing blocks a recording with no consent | 6am | ping-only | internal |
| C9 | Words from the Meet recording and the answers reach the AI | `meet-transcript-sweeper`, `job:meet-transcript-sweeper`, `meet:recording-no-transcript`, `meet:transcript-unreadable` | deep | The sweeper rows can go red, but they cover sales-call words on `call_outcomes`; nothing links words to the CSM's `customer_insights` row or checks the AI reads them | 6am | weak | internal |
| C10 | Marketing clearance only with live consent (database guard and `v_insight_ad_eligible`) | none | none | No — a database trigger and a view; no tripwire reads them | none | missing | internal |
| C11 | CSM is paid 10% of cash on what they sell | `reg:commissions`, `reg:commission-rules`, `reg:read/commissions` | ping | Yes — red on 404/5xx only; nothing checks the rule row exists or that pay is worked out | 6am | ping-only | staff-only |
| C12 | CSM lands on the queue as their home desk | `gap-staff:role-desk` | ping | Yes — red if a role's home desk will not load; includes `csm` | 6am | ping-only | staff-only |
| C13 | Chasing money: first notice by email and text when a success-fee invoice is sent (AR-01) | `24-agents:ar-collections`, `pipeline:outbound`, `email:sending-stuck`, `gap:sms-sending-stuck` | ping | `24-agents:ar-collections` is "not checked" (event job); the send watchers only see a message row that already exists; "never queued" and a notice sent with no pay link are invisible | 5min (stuck queue only) | weak | money |
| C14 | Chasing money: reminder after 7 days and final notice after 14 days (AR-02, AR-03) | none | none | No — both sleeps live inside one Inngest run; if it dies, no notice goes out; it is not a bus handler, so `failed_events` never sees it | none | missing | money |
| C15 | Chasing money: the ladder stops when the invoice is paid | `payments:invoice-stuck` | deep | Yes — red when a paid pay link sits on an open invoice, or the invoice status and the money disagree | 6am | covered | money |
| C16 | Chasing money: hand-off marks the invoice escalated, tags the client, makes the CSM task (AR-04) | none | none | No — `24-agents:ar-collections` is "not checked"; nothing looks for an escalated invoice with no task | none | missing | money |
| C17 | Chasing money: the CSM calls about "Overdue balance — call the client" | none (`csm:overdue-unassigned` skips it) | none | No — the task is made with no due date and that check needs one; no `invoice.sent` or `round.funded` event has ever been real | none | missing | money |

Customer insights handlers (C1, C2) use the dead-letter list, so a throw shows in `gap-jobs:failed-events`. The AR ladder is an Inngest function, not a bus handler, so it does not.

---

## Checker — 2026-10-09

Verdict: **not confirmed.** Most of the map is right. Six "covered" calls are too strong. I only read code, ran read-only SQL, ran the live lane tool, and ran two tests in memory. I changed no app file.

### What held up

- All 131 check ids are real. I rebuilt the id list from the code and matched every one.
- The counts add up: 58 = 19 + 17 + 5 + 17.
- All 37 `slice-30-csm-owner` rows are "not checked". I ran them with an empty database.
- The morning text is not watched. The 404 on `/app/morning-brief.html` is real, and that page was never in git.
- The 12 hard "covered" rows, in short:
  - Held: O4 ads, O5 consent, O6 contracts, O10 documents, O11 finance, O18 Commas, C4, C5. They read real tables or run the real handler.
  - Caveat on O5 and O6: there are 0 paid clients and 0 contracts today, so those checks have never fired on a real row.
  - Caveat on O18: a Commas row that sits "pending" is not read by anything (see below).

### "Covered" that is too strong (my suggestion: weak)

1. **A9, the 5-minute watch.** If the database is down, the watch crashes before it sends the text. `runInstantWatch` calls `defaultOrgId(db)` right after the health check. I ran it in memory with a dead database and a 503 health answer. Result: it threw, 0 texts. The 6 a.m. job does the same (`runDailyPulse` throws at the same call). So when the database dies, both alarms go quiet. Also `login` and `apply` only match words on a page.
2. **O1, sign-in.** Live read: "11 active staff, 0 sign-ins in 24 hours." Nobody tried, so nothing was tested. No check runs the real login handler. `GET /api/auth/login` returns fixed text and never touches the database, so `reg:auth/login` is a pure ping.
3. **C1, halfway call.** `csm:missing-step` only counts events that have a `client_id`. Of 50 real money-in events in 60 days, only 8 have one. The other 42 are invisible. All 25 real `deposit.paid` events have no `client_id`. The handler finds the client by email, so a silent "no client" skip would never show.
4. **C2, results call.** All 4 `round.funded` events on file have no `client_id`. The check can never flag a missing results call.
5. **C15, ladder stops when paid.** In `v_invoice_aging`, `status_reconciled` is true for a "sent", "reminded" or "escalated" invoice that is fully paid. I checked the live view and ran it on sample rows. Only the "paid pay link on an open invoice" half of `payments:invoice-stuck` works. There are 0 invoices, so it never ran on a real one.
6. **O14, journeys editor.** The live row says "0 saved journeys". It passes on nothing.

### Under-credited

- **O9 should be covered, not ping-only.** Deep checks exist: `gap-crm-links:crm-data:pipeline`, `gap-crm-links:crm-data:pipeline-counts`, `gap-crm-links:crm-data:clients`, `gap-crm-links:crm-data:client`. All PASS live. This also means O16 "deep for only 4" is wrong, and it names only 3.
- `staff-invite-link` checks staff invites, not hiring apply. It fits O1, not O12.
- C13 is "weak", but a send that was queued and then failed is seen by `email:provider-fail` and `gap:sms-provider-failed` (3 day look-back).
- A1: the 9 p.m. text says "no morning check is stored for today" if the 6 a.m. job never saved one. That is a late net, 15 hours after. It needs the database, Inngest and Twilio to work.

### Steps the map skipped

| Step | Impact | Status |
|---|---|---|
| Alarms still text when the database is down | money | missing |
| A funded round gets its success-fee invoice made and sent (F-07). This starts the whole AR ladder. Only `gap-payments` reads invoices, and not this. | money | missing |
| A payment is applied to its invoice (`payment.received` in `ar-collections`). It is an Inngest event job with no run receipt. | money | weak |
| An assigned CSM call gets done. `csm:overdue-unassigned` needs `assignee_staff_id IS NULL`. | customer-blocked | missing |
| A Commas row sits "pending" and nothing picks it up. `webhooks:stuck-failed` reads only failed and processing rows. Only `job:commas-inbox-drain` and `job:commas-inbox-sweeper` watch it, once at 6 a.m. | money | weak |

### My suggested counts

63 steps (58 plus the 5 above):

| covered | ping-only | weak | missing |
|---|---|---|---|
| 14 | 16 | 13 | 20 |

How I got there: 6 "covered" go to weak (A9, O1, C1, C2, C15, O14). O9 goes from ping-only to covered. The 5 new rows add 3 missing and 2 weak.
