# Heartbeat map — group 07-jobs

Made 2026-10-09 from live reads taken at 05:40 UTC (10:40 p.m. Oct 8 in Arizona). Read only. No code, test, config or env file was changed. This is the only file I wrote.

## What I covered

- All 100 Inngest functions in `src/workflows/index.mjs`: 35 run on a clock, 62 wait for an event, 3 have no trigger and cannot run.
- All 7 Netlify scheduled functions in `netlify.toml`.
- That is 107 functions. 103 are scored below. 4 are not scored (they cannot run, or they do nothing). See the last table.
- 112 rows are scored. A few functions have 2 rows because two halves are watched differently. A few rows are shared gaps (Inngest stops, an error is swallowed).

| Rows scored | Covered | Ping-only | Weak | Missing |
|---|---|---|---|---|
| 112 | 30 | 25 | 4 | 53 |

Money or customer-blocked rows that are not covered: 50 (missing 35, ping-only 12, weak 3). They are listed at the end.

## What I found, in plain words

1. **The receipts work.** 40 of the 42 listed jobs wrote a receipt in the last 2 days. All 40 read green at 05:39 UTC. The other 2 are monthly jobs (`affiliate-payout-run`, `partner-production-floor`). Their next run is Nov 1. Receipts only started on Oct 7 at 20:08 UTC, so most daily jobs have 1 or 2 receipts so far.
2. **A receipt only says the clock ticked.** It does not say the work got done. Sixteen Inngest cron files contain an `ok:false` return. I read `message-dispatch-sweeper` and `commas-inbox-drain`: both catch every error and return `ok:false`. The receipt hook reads only thrown errors, so it saves that pass as ok. Netlify jobs do save `ok:false` as an error. Of the 35 Inngest cron rows, 12 have a deep check and 21 have only the receipt.
3. **The 62 event workflows have no clock and no receipt.** When one fails, nothing is saved. The dead-letter table (`failed_events`) is filled only by the in-process event bus (`src/events/bus.mjs`). It is not filled when an Inngest function fails. The bus also sends each event to Inngest with `void inngest.send(...).catch(() => {})`, so a failed send is lost too. Nothing reads Inngest's own run list. The note in `ops/workflows/heartbeat-gaps-2026-10-08/jobs.md` says an event job that throws leaves a `failed_events` row. That is true for bus handlers. It is not true for these 62.
4. **49 of the 62 event rows have no check at all.** 12 are covered. The covered ones are covered by reading what the job leaves behind: a text row, a pack, a letter, a nurture message, a stalled client.
5. **Everything watches from the same place.** The 6 a.m. pulse, the 5-minute watch and the 9 p.m. brief are all Inngest functions. If Inngest stops or loses sync, they all go quiet at once and nothing outside Inngest notices. Only the Netlify payment clock keeps running.
6. **Timing.** The 5-minute watch runs 5 checks. Only one of them (`pipeline:outbound`) touches a job. Every other job row is read once a day at 6 a.m. A daily job turns red after 3 missed days. That is the owner rule (3 times its schedule). It is not "before the customer waits".
7. **Reds on rows in this file right now:** `gap:sms-journey-zero` (the welcome text, 2 steps), `email:drip-step-no-email` (roadmap drip, 1 person, 3 steps), and `03-marketing:outbox_drain` (13 repo saves waiting since 2026-10-06). `repair-letter-round` is red too and is named on the `c-00` row. Those checks are doing their job.
8. **Most event jobs have never run on real data lately.** Real (non-demo) events: `round.*` 0 ever; `booking.created` 0 in 14 days (last 2026-09-04); `call.completed` and `deposit.paid` 0 in 14 days (last 2026-08-21); `diagnostic.paid` 0 in 14 days (last 2026-08-18). The first real funded round will be the first live test of `f-07-funding-locked`, the job that makes the success-fee bill.

## How to read the tables

- **Covered**: a deep check reads the result the customer gets and would go red within one morning (or within the owner's 3-times rule for daily jobs).
- **Ping-only**: only a `job:` receipt. It proves the clock ticked. It is blind to wrong data or a missing send.
- **Weak**: a check exists, but today it can only pass, only skip, or cannot see the break.
- **Missing**: nothing would go red.
- **Trips**: `6am` is the morning pulse. `5min` is the instant watch. `none` means no check.
- Check ids are written as the check returns them. The pulse may put the lane file name in front (for example `gap-underwrite:uw-letters-missing`). `04-ads:...` style ids are slice rows. Slice rows for a cron read the same receipt as the `job:` row.
- My reads used the read-only database role inside `BEGIN READ ONLY`, and web calls were GET only. Nothing was written or sent.


## 1. Netlify scheduled functions (7 in netlify.toml)

These run on Netlify's clock, not Inngest's. Each one writes a receipt when it finishes. A pass that says ok:false is saved as an error.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| staff-message-sweeper (every 5 min) — sends staff replies that were held for quiet hours | `job:staff-message-sweeper`, `pipeline:outbound`, `gap:sms-sending-stuck` | deep | yes — a held reply still queued 30 min after it was due turns pipeline:outbound red; the 5-minute watch texts Chris | 5min | covered | customer-blocked |
| social-publish-sweeper (every 5 min) — publishes posts when their time comes | `job:social-publish-sweeper` | ping | yes, only if the clock stops or a pass fails; a due post that never goes out stays green | 6am | ping-only | staff-only |
| creative-job-runner (every 2 min) — runs queued Creative Factory jobs | `job:creative-job-runner` | ping | yes, only if the clock stops or a pass fails; a job stuck in the queue stays green | 6am | ping-only | staff-only |
| hubstaff-poll-sweeper (every 10 min) — pulls staff time numbers | `job:hubstaff-poll-sweeper` | ping | yes, only if the clock stops or a pass fails; wrong numbers stay green | 6am | ping-only | internal |
| ad-video-sweeper (every 5 min) — wakes the ad video worker | `job:ad-video-sweeper`, `04-ads:ad-video-sweeper` | ping | yes, only if the clock stops; it does no work itself, so a take stuck in the worker stays green (the 2nd id is the same read) | 6am | ping-only | internal |
| commas-inbox-sweeper (every minute) — turns a paid Commas receipt into a recorded payment | `job:commas-inbox-sweeper`, `job:commas-inbox-drain`, `webhooks:stuck-failed`, `payments:pay-link-webhook`, `payments:paid-no-entitlement` | deep | yes — a dead or failing clock, a receipt that failed 10 tries, or a paid link never settled all go red at 6 a.m. | 6am | covered | money |
| commas-inbox: a paid receipt sits unclaimed (pending, never tried) while both clocks say ok | none | none | no — no check reads how old a pending receipt is, and the 5-minute watch does not read payments; webhooks:stuck-failed only sees rows that already failed 10 times | none | missing | money |
| marketing-clock (every 15 min) — wakes the marketing worker | `job:marketing-clock`, `03-marketing:clock`, `03-marketing:worker`, `marketing-queue:stuck-queued` | deep | yes — clock or worker silent while jobs wait, or a marketing job queued 45 min | 6am | covered | staff-only |
| marketing worker saves to the repo (outbox) | `03-marketing:outbox_drain` | deep | yes — red now: 13 repo saves waiting since 2026-10-06 (limit is 3 min, the clock beats every 15) | 6am | covered | internal |

## 2. Inngest crons — money and payments

Every Inngest cron gets a receipt from one place (client.mjs). The receipt says ok unless the function THROWS. A pass that catches its own error and returns ok:false is saved as ok.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| commas-inbox-drain (every minute) — Inngest twin of the payment queue clock | `job:commas-inbox-drain`, `webhooks:stuck-failed`, `payments:pay-link-webhook` | deep | yes — shared checks go red on a failed receipt; the twin's own receipt says ok even when a pass fails (it catches every error) | 6am | covered | money |
| paid-checkout-expiry-sweeper (hourly) — closes dead checkout links so chase texts can restart | `job:paid-checkout-expiry-sweeper`, `18-billing:paid-checkout-expiry-sweeper` | ping | yes, only if the clock stops; dead links left open stay green (before this job, 200 stale rows blocked a live client's messages) | 6am | ping-only | customer-blocked |
| subscription-billing-sweeper (hourly :17) — charges due subscriptions | `job:subscription-billing-sweeper`, `18-billing:subscription-billing-sweeper` | ping | yes, only if the clock stops; "N due, none charged" is its normal answer and stays green (3 active subscriptions today) | 6am | ping-only | money |
| affiliate-payout-run (1st of month, 03:00 UTC) — batches affiliate commission into payouts | `partners:commission-payable`, `job:affiliate-payout-run` | deep | yes — from the morning after the 1st, a signed affiliate with $50+ due and no pending, processing or paid run goes red; the job: row says not checked until Nov 2, and the slice rows say PASS off a 45-day-old stamp | 6am | covered | money |
| partner-production-floor (1st of month, 14:00 UTC) — can cut a partner's share from 50 to 20 | `job:partner-production-floor`, `22-partners:partner-production-floor` | ping | no today — the job: row reads "not checked" (no run on file since receipts began 10-07); a wrong cut is never read | 6am | weak | money |
| finance-os-money-agent (daily 16:30 UTC) — reminders for money owed to Fundhub | `job:finance-os-money-agent`, `07-finance:finance-os-money-agent` | ping | yes, only after the clock misses 3 days; reminders that never queue stay green | 6am | ping-only | money |
| finance-os-money-transfers (every 15 min) — sends transfers the client approved | `job:finance-os-money-transfers`, `07-finance:finance-os-money-transfers` | ping | yes, only if the clock stops; it returns at once while the transfer caps are unset, and that stays green | 6am | ping-only | money |
| finance-os-card-due-reminders (daily 16:00 UTC) — texts card due dates | `job:finance-os-card-due-reminders`, `07-finance:finance-os-card-due-reminders` | ping | yes, only after 3 missed days; texts that never queue stay green | 6am | ping-only | customer-blocked |
| finance-os-pull-sweeper (daily 06:00 UTC) — requests the included monthly soft pull | `job:finance-os-pull-sweeper`, `07-finance:finance-os-pull-sweeper` | ping | yes, only after 3 missed days; it writes a request row and calls no bureau, and nothing reads whether a pull arrived | 6am | ping-only | customer-blocked |
| finance-os-trend-snapshots (daily 07:30 UTC) — saves money trend rows | `job:finance-os-trend-snapshots` | ping | yes, only after 3 missed days; empty rows stay green | 6am | ping-only | internal |
| merchant-pull-sweeper (daily 07:30 UTC) — reads a client's own processor | `job:merchant-pull-sweeper`, `08-banks:merchant-pull-sweeper` | ping | yes, only after 3 missed days; a pass that returns ok:false is saved as ok | 6am | ping-only | internal |
| plaid-transactions-sweeper (daily 07:00 UTC) — pulls bank charges and deposits | `banks-sync-stale`, `job:plaid-transactions-sweeper` | deep | yes — a live bank login with no sync in 3 days goes red; it reads each login, not the job receipt | 6am | covered | customer-blocked |

## 3. Inngest crons — client messages, files and follow-ups

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| message-dispatch-sweeper (every 5 min) — sends every queued text and email | `pipeline:outbound`, `gap:sms-sending-stuck`, `email:sending-stuck`, `job:message-dispatch-sweeper` | deep | yes — a message queued 30 min with no send turns red, and the 5-minute watch texts Chris (its own receipt says ok even when a pass fails) | 5min | covered | customer-blocked |
| waypoint-nudge-sweeper (hourly) — chases overdue client checklist items | `job:waypoint-nudge-sweeper`, `12-messaging:waypoint-nudge-sweeper` | ping | yes, only if the clock stops; nudges that never queue stay green (only a stuck send is watched) | 6am | ping-only | customer-blocked |
| document-vault-chase (daily 16:45 UTC) — asks Blueprint buyers for missing papers | `documents:required-unchased`, `job:document-vault-chase` | deep | yes — a required paper still missing 3 days after the first ask with no chase goes red | 6am | covered | customer-blocked |
| doc-check-retry-sweeper (every 20 min) — retries uploads the reader could not read | `documents:stuck-processing`, `failed-events`, `job:doc-check-retry-sweeper` | deep | yes — a read still processing 60 min late, or unread after 3 days of tries | 6am | covered | customer-blocked |
| contract-chaser (daily 10:00 UTC) — reminds people holding up a contract | `job:contract-chaser`, `email:morning-no-failure-check` | ping | yes, only after 3 missed days; email:morning-no-failure-check reads source text, not what was sent | 6am | ping-only | money |
| slo-infinite-drip (daily 15:00 UTC) — roadmap drip emails | `email:drip-step-no-email`, `job:slo-infinite-drip` | deep | yes — a person moved up a drip step with no email queued; red now (1 person, 3 steps) | 6am | covered | money |
| inquiry-call-sweeper (every 15 min) — places the bureau calls for inquiry removal | `inquiry:case-stuck`, `job:inquiry-call-sweeper` | deep | yes — a call due 45 min ago and never fired turns red | 6am | covered | customer-blocked |
| next-action-catch-up (every 5 min) — keeps the saved next step equal to the screen | `job:next-action-catch-up`, `16-nurture:next-action-catch-up` | ping | yes, only if the clock stops; a saved step that disagrees with the screen stays green | 6am | ping-only | staff-only |
| blueprint-closer-ready-sweeper (hourly) — alerts a closer when a paid Blueprint file is ready | `job:blueprint-closer-ready-sweeper`, `25-rest:blueprint-closer-ready-sweeper` | ping | yes, only if the clock stops; a ready file with no alert stays green | 6am | ping-only | money |
| blueprint-next-funding-sequence-sweeper (daily 06:30 UTC) — closer task for the next funding sequence | `job:blueprint-next-funding-sequence-sweeper`, `25-rest:blueprint-next-funding-sequence-sweeper` | ping | yes, only after 3 missed days; a missing task stays green | 6am | ping-only | money |
| blueprint-finance-os-alerts (daily 07:30 UTC) — file-protection alerts for paid buyers | `job:blueprint-finance-os-alerts`, `07-finance:blueprint-finance-os-alerts` | ping | yes, only after 3 missed days; alerts that never queue stay green | 6am | ping-only | customer-blocked |

## 4. Inngest crons — calls, hiring and partners

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| blake-lead-watch (every 5 min) — texts Chris when a Blake referral mail arrives | `job:blake-lead-watch`, `13-calls:blake-lead-watch` | ping | yes, only if the clock stops; a referral mail that never becomes a text stays green | 6am | ping-only | money |
| meet-transcript-sweeper (every 10 min) — scans Drive for call tapes and words | `meet-transcript-sweeper`, `meet:recording-no-transcript`, `job:meet-transcript-sweeper` | deep | yes — Drive not scanned in 30 min, or a tape with no words 30 min after it was indexed | 6am | covered | staff-only |
| hiring-bench-sweeper (daily 13:30 UTC) — opens a hiring task when the bench is thin | `job:hiring-bench-sweeper`, `11-hiring:hiring-bench-sweeper` | ping | yes, only after 3 missed days; a task that never opens stays green | 6am | ping-only | staff-only |
| hiring-outreach-cadence (every 30 min) — follow-up messages to job applicants | `job:hiring-outreach-cadence`, `11-hiring:hiring-outreach-cadence` | ping | yes, only if the clock stops; a pass that returns ok:false is saved as ok | 6am | ping-only | internal |
| af-01-affiliate-drip (every 15 min) — backfills the first affiliate email | `job:af-01-affiliate-drip`, `17-affiliates:af-01-affiliate-drip` | ping | yes, only if the clock stops; it only fills in for test affiliates | 6am | ping-only | internal |

## 5. Inngest crons — ads and funnels

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| meta-campaign-sync-hourly (:30 each hour) — today's Meta numbers | `ads-meta-sync-stale`, `ads-spend-day-missing`, `job:meta-campaign-sync-hourly` | deep | yes — the hourly pull late by 3 hours, or a closed day with no spend row | 6am | covered | staff-only |
| meta-campaign-sync-sweeper (daily 07:00 UTC) — 28-day Meta pull | `meta-sync`, `job:meta-campaign-sync-sweeper` | deep | yes — no ad numbers saved in 36 hours, or the last Meta call failed | 6am | covered | staff-only |
| clickfunnels-analytics-sweeper (daily 07:15 UTC) — funnel page numbers | `clickfunnels-night-job`, `job:clickfunnels-analytics-sweeper` | deep | yes — no write landed in the 07:15 slot in 36 hours (a hand-run sync does not count) | 6am | covered | staff-only |
| watch-curve-diagnosis-sweeper (daily 07:30 UTC) — labels where an ad loses people | `job:watch-curve-diagnosis-sweeper`, `04-ads:watch-curve-diagnosis-sweeper` | ping | yes, only after 3 missed days; empty labels stay green | 6am | ping-only | internal |

## 6. The watchers themselves

Who watches the tripwires? All of them run on Inngest.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| daily-pulse (6:00 a.m. Arizona) — runs the whole morning check and sends the text | `02-daily-pulse:ag-07-cron-daily-pulse`, `job:daily-pulse` | ping | no — both checks are rows INSIDE the pulse; if the pulse is dead they cannot go red. The only outside sign is the 9 p.m. brief line "no morning check is stored for today" | none | weak | internal |
| pulse-instant-watch (every 5 min) — texts Chris when a critical door breaks | `job:pulse-instant-watch`, `25-rest:pulse-instant-watch` | ping | yes, but only at 6 a.m. and only because the pulse reads it; a dead watch means no 5-minute texts until then | 6am | ping-only | internal |
| evening-brief (9:00 p.m. Arizona) — the evening text | `job:evening-brief`, `06-briefs:evening-brief` | ping | yes, only after 3 missed days; a missing text is something Chris has to notice | 6am | ping-only | internal |
| Inngest itself stops or loses sync — every cron, the pulse, the instant watch and the brief go quiet at once | none | none | no — every tripwire runs on Inngest and nothing outside it reads the receipts; only the Netlify payment clock keeps going | none | missing | money |
| a new scheduled job is added with no heartbeat row | `job-heartbeats-unlisted` | deep | yes — heartbeats.test.mjs fails the build on drift; a job that reports a run but is not listed goes red (live: all 40 listed) | 6am | covered | internal |

## 7. Event workflows — leads, bookings and calls

Event workflows have no schedule and no receipt. A check can only see what they leave behind. "Real" counts events that are not demo rows.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| at-01-first-touch-capture — saves the lead's first-touch date (entry.captured, 128 real in 14 days) | none | none | no — nothing reads the first-touch date | none | missing | internal |
| af-02-referral-ownership-capture — credits the referring affiliate, writes the referral row commission comes from | none | none | no — partners:referral-link reads clicks, not the referral rows this job writes | none | missing | money |
| s-01-new-lead-intake — puts the lead on the Sales board (entry.captured) | none | none | no — crm-data:pipeline-cards checks cards that exist, not that every lead got one | none | missing | staff-only |
| s-00-welcome — welcome text and email (entry.captured) | `gap:sms-journey-zero` | deep | yes — a lead with no welcome text row 15 min after the event; red now (2 steps); the email half has no check | 6am | covered | money |
| s-02-incomplete-survey-nudge — email 20 min after a lead stops (entry.captured; 8 sent in 14 days) | none | none | no — nothing compares leads who stopped with nudges sent | none | missing | money |
| s-nobook-chase — 3 texts and emails to a lead who never booked (survey.submitted, 81 real in 14 days) | none | none | no — nothing reads whether the chase was queued | none | missing | money |
| s-04-call-booked — tags the booking and moves the card (booking.created; 0 real in 14 days, last 09-04) | none | none | no — calls:booking-webhook checks the booking row, not this tag and card move | none | missing | staff-only |
| s-04b-booking-reminders: confirm text (booking.created and .rescheduled) | `gap:sms-journey-zero` | deep | yes — a booking with no confirm text row 15 min later | 6am | covered | money |
| s-04b-booking-reminders: confirm email and the 24-hour and 2-hour reminders | none | none | no — only the confirm text is read; a missed reminder means a no-show nobody sees coming | none | missing | money |
| s-04c-staff-booked-alert — text to staff when a call is booked (switch is off by default) | none | none | no — nothing reads it | none | missing | staff-only |
| ai-set-01-josh-setter — AI call to confirm the session (booking.created) | `calls:ai-dial-no-failure` | deep | no today — Josh (AG-04) is retired, so no dial is expected and the check can only pass; it can go red only if Josh is turned on | 6am | weak | money |
| ai-set-03-no-answer-cadence — 3 texts after a no-answer call (call.completed) | none | none | no — nothing reads it | none | missing | money |
| ai-set-04-3way-handoff — text 15 min before the call plus an advisor task (booking.created) | none | none | no — nothing reads it | none | missing | money |
| bs-01-precall-launcher — pre-call texts and a 3-day email drip (booking.created) | none | none | no — nothing reads it | none | missing | money |
| dpc-02-call-outcome-enforcement — marks the call showed or no-show, starts no-show recovery (booking.created) | none | none | no — calls:booked-no-outcome reads outcomes a person logs, not what this job does | none | missing | money |
| dpc-03-inbound-reply-router — turns a YES or RESCHEDULE reply into a task or a text (message.inbound, 13 real in 14 days) | none | none | no — a YES reply that is ignored loses the sale and nothing reads it | none | missing | money |
| dpc-05-no-progress-escalation — escalates a paying client with no progress for 72 hours (booking.created) | `pipeline:clients` | deep | yes — a paying client stalled 72h or more and not yet escalated | 6am | covered | customer-blocked |
| s-05a-no-show-recovery — 4 touches after a no-show (booking.noshow) | none | none | no — nothing reads it | none | missing | money |
| s-06-post-call-funding-purchased — tags and tasks after a deposit (deposit.paid; 0 real in 14 days) | none | none | no — nothing reads it | none | missing | staff-only |
| s-doc-collection — asks for papers after a deposit and closes the funding gate (deposit.paid) | `gap:sms-journey-zero`, `documents:required-unchased` | deep | yes — a deposit with no doc-request text row 15 min later (the email half has no check) | 6am | covered | customer-blocked |
| s-08-post-call-funding-declined — tag and follow-up task (call.completed declined) | none | none | no — nothing reads it | none | missing | staff-only |
| s-offer-bucket — emails the offer after a closer saves a call (call.completed) | none | none | no — closer:held-disposition reads the saved call outcome, not the offer email | none | missing | money |
| ds-01-repair-referral — repair offer text and email after a declined funding call (call.completed) | none | none | no — nothing reads it | none | missing | money |

## 8. Event workflows — credit pull, documents and repair

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| c-00-crs-soft-pull-request — runs the credit pull after a paid diagnostic (diagnostic.paid; 0 real in 14 days) | none | none | no — nothing sees "paid, consented, no pull"; repair-letter-round only sees repair files stuck in analysis (1 red now) | none | missing | customer-blocked |
| c-02-inquiry-created — logs new inquiries, holds the round, makes the specialist task (analysis.completed) | none | none | no — inquiry checks read cases and letters, not this job's rows and task | none | missing | customer-blocked |
| c-02b-inquiry-removal-requested — starts inquiry removal after a deposit (deposit.paid) | none | none | no — nothing reads it | none | missing | customer-blocked |
| c-03-inquiry-removed-resume-or-hold — resumes or holds funding after removal (inquiry.removed; never fired) | none | none | no — nothing reads it | none | missing | customer-blocked |
| c-05-pre-funding-review — pre-funding review task (round.started; never fired) | none | none | no — nothing reads it | none | missing | staff-only |
| c-06-crs-results-router — delivers the funding inquiry-removal letters (analysis.completed, crs) | `uw-letters-missing` | deep | yes — a client with inquiries or an open dispute and no letters on file | 6am | covered | customer-blocked |
| dpc-01-analyzer-lock — saves analyzer markers (analysis.completed) | none | none | no — nothing reads it | none | missing | internal |
| u-02-analyzer-complete-delivery — path tags only (delivery was retired) | none | none | no — nothing reads it | none | missing | internal |
| u-03-crs-snapshot-sync — saves CRS fields and pauses funding on negatives (analysis.completed, crs) | none | none | no — a client with negatives would not be paused and nothing reads it | none | missing | customer-blocked |
| u-04-promote-crs-primary — marks CRS as the main snapshot (analysis.completed) | none | none | no — nothing reads it | none | missing | internal |
| u-05-data-health-monitor — tags missing credit data and makes a fix task (analysis.completed) | none | none | no — nothing reads it | none | missing | internal |
| slo-pack-delivery — builds the UnderwriteIQ pack after a roadmap pull (analysis.completed) | `uw-paid-roadmap-no-pack`, `uw-offer-fulfillment-failed` | deep | yes — a paid roadmap buyer whose pull finished and who has no pack, or an open offer failure | 6am | covered | customer-blocked |
| doc-check — reads an uploaded ID or paper (docs.received, 6 real in 14 days) | `documents:stuck-processing`, `failed-events` | deep | yes — a read 60 min late or unread after 3 days of retries; this job writes its own dead-letter row | 6am | covered | customer-blocked |
| repair-bureau-response-reader — reads a bureau reply (docs.received) | none | none | no — nothing reads it | none | missing | customer-blocked |
| ds-02-diy-letters — builds and emails the DIY letter pack for the paid DIY product (payment.received; 7 real in 14 days) | none | none | no — uw-letters-missing reads dispute letters, not this paid pack | none | missing | customer-blocked |

## 9. Event workflows — funding rounds, invoices and nurture

No real round.* event has ever been written (round.started, .submitted, .approved, .funded: 0). These jobs have never run on real data.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| f-01-funding-intake — tags and advisor tasks (round.started) | none | none | no — nothing reads it | none | missing | staff-only |
| f-02-portal-id-missing — asks the client for ID and portal setup (round.started +3h) | none | none | no — documents:required-unchased only sees clients this job already tagged, so a job that never runs is invisible | none | missing | customer-blocked |
| f-03-round-submitted — tells the client the round went in (round.submitted) | `gap:sms-journey-zero` | deep | yes — a submitted round with no text row 15 min later (the email half has no check) | 6am | covered | customer-blocked |
| f-04-round-approvals — tells the client about approved money (round.approved) | `gap:sms-journey-zero` | deep | yes — an approved round with an amount and no text row 15 min later (the email half has no check) | 6am | covered | customer-blocked |
| f-05-inquiry-cleanup-gate — flags open inquiries for removal between rounds (round.approved) | none | none | no — nothing reads it | none | missing | customer-blocked |
| f-06-funding-conditions-missing-docs — asks for what the bank wants (mail.response, docs.received) | none | none | no — documents:required-unchased only sees clients this job already tagged | none | missing | customer-blocked |
| f-07-funding-locked — raises the success-fee invoice when a round is funded (round.funded) | none | none | no — nothing checks that a funded round has a bill; this job is the only thing that makes one | none | missing | money |
| f-08-post-funding-monitoring — 30-day check-in task (round.funded) | none | none | no — csm:missing-step reads a different job's task | none | missing | staff-only |
| f-09-funding-declined-no-path — hold reason and review task on a bank denial (mail.response) | none | none | no — nothing reads it | none | missing | customer-blocked |
| f-10-client-funding-inbox-provisioner — makes the forwarding address and a setup task (round.started) | none | none | no — nothing reads it | none | missing | staff-only |
| f-11-bank-email-event-router — turns a bank reply into a task and moves the stage (mail.response) | none | none | no — an approval email that is not routed sits unseen and nothing reads it | none | missing | money |
| round-started-client-notify — tells the client the round started (round.started) | `gap:sms-journey-zero` | deep | yes — a started round with no text row 15 min later | 6am | covered | customer-blocked |
| bc-01-customer-responsiveness — scores how fast the client answers (round.started) | none | none | no — nothing reads it | none | missing | internal |
| bc-02-customer-friction — scores friction (round.started) | none | none | no — nothing reads it | none | missing | internal |
| sys-01-client-value-calculator — potential value number (round.approved) | none | none | no — nothing reads it | none | missing | internal |
| sys-01-ltv-calculator — lifetime value total (round.funded) | none | none | no — nothing reads it | none | missing | internal |
| n-04-post-funding-nurture — post-funding text and email (round.closeout) | `nurture:never-queued`, `nurture:step-stuck` | deep | yes — a closed round with no nurture message in 7 days, or one stuck sending | 6am | covered | internal |
| n-06-renewal-second-wave — renewal text and email 180 days after funding (round.funded) | `nurture:never-queued`, `nurture:step-stuck` | deep | yes — a funded round past 180 days with no renewal message in 7 days | 6am | covered | money |
| ar-collections — dunning texts and emails on a success-fee bill (invoice.sent, payment.received) | none | none | no — payments:invoice-stuck compares bill status with money, not whether the dunning messages went | none | missing | money |

## 10. Event workflows — the $297 roadmap offer

slo-pack-delivery and slo-infinite-drip are in sections 8 and 3.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| slo-genuine-followup — first message to someone who left their number and did not pay (slo.contact_started, 18 real in 14 days) | none | none | no — nothing reads whether it queued (3 sent in 14 days) | none | missing | money |
| slo-genuine-reply — coupon after a real reply (message.inbound) | none | none | no — nothing reads it | none | missing | money |
| slo-genuine-checkout-sms — text when someone starts checkout and stops (slo.checkout_started, 15 real in 14 days) | none | none | no — nothing reads it | none | missing | money |
| slo-no-reply-197 — $197 offer to someone who did not reply (slo.contact_started) | none | none | no — nothing reads it | none | missing | money |
| slo-paid-form-nudge — asks a buyer who paid $297 to fill in the pull form (payment.received) | none | none | no — consent:slo-store reads saved identity without consent, not a buyer who never filled the form | none | missing | customer-blocked |

## 11. Errors and delivery (all event workflows and crons)

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| an event is written but the send to Inngest fails (bus.mjs sends and swallows the error) | none | none | no — nothing compares events written with workflows run; the send is `void inngest.send(...).catch(() => {})` | none | missing | money |
| an event workflow throws and Inngest gives up (62 functions) | none | none | no — no failed_events row is written for Inngest functions, and nothing reads Inngest's own run list | none | missing | money |
| an in-process event handler throws (src/events/bus.mjs) | `failed-events` | deep | yes — an exhausted or overdue dead-letter row goes red; the 24 old rows are test addresses and are left out | 6am | covered | customer-blocked |
| an Inngest cron pass fails but returns ok:false instead of throwing (16 cron files have an ok:false return; 2 read in full) | `job:message-dispatch-sweeper`, `job:commas-inbox-drain` | ping | no — the receipt hook reads only thrown errors, so the job: row stays green; Netlify jobs do save ok:false as an error | 6am | weak | customer-blocked |

## 12. Not scored (cannot run, or does nothing)

| Function | Why |
|---|---|
| `n-01-cold-nurture` | No trigger (empty list). It cannot run. |
| `n-02-warm-nurture` | No trigger (empty list). It cannot run. |
| `n-03-hot-nurture` | No trigger and enabled:false. It cannot run. |
| `s-portal-invite` | Registered on booking.created, but its handler only returns "owned_by_s04b". It does nothing. |

## Holes: money or customer-blocked, not covered (50)

### money (32)

- **missing** — commas-inbox: a paid receipt sits unclaimed (pending, never tried) while both clocks say ok. Can go red? no — no check reads how old a pending receipt is, and the 5-minute watch does not read payments; webhooks:stuck-failed only sees rows that already failed 10 times.
- **ping-only** — subscription-billing-sweeper (hourly :17) — charges due subscriptions. Can go red? yes, only if the clock stops; "N due, none charged" is its normal answer and stays green (3 active subscriptions today).
- **weak** — partner-production-floor (1st of month, 14:00 UTC) — can cut a partner's share from 50 to 20. Can go red? no today — the job: row reads "not checked" (no run on file since receipts began 10-07); a wrong cut is never read.
- **ping-only** — finance-os-money-agent (daily 16:30 UTC) — reminders for money owed to Fundhub. Can go red? yes, only after the clock misses 3 days; reminders that never queue stay green.
- **ping-only** — finance-os-money-transfers (every 15 min) — sends transfers the client approved. Can go red? yes, only if the clock stops; it returns at once while the transfer caps are unset, and that stays green.
- **ping-only** — contract-chaser (daily 10:00 UTC) — reminds people holding up a contract. Can go red? yes, only after 3 missed days; email:morning-no-failure-check reads source text, not what was sent.
- **ping-only** — blueprint-closer-ready-sweeper (hourly) — alerts a closer when a paid Blueprint file is ready. Can go red? yes, only if the clock stops; a ready file with no alert stays green.
- **ping-only** — blueprint-next-funding-sequence-sweeper (daily 06:30 UTC) — closer task for the next funding sequence. Can go red? yes, only after 3 missed days; a missing task stays green.
- **ping-only** — blake-lead-watch (every 5 min) — texts Chris when a Blake referral mail arrives. Can go red? yes, only if the clock stops; a referral mail that never becomes a text stays green.
- **missing** — Inngest itself stops or loses sync — every cron, the pulse, the instant watch and the brief go quiet at once. Can go red? no — every tripwire runs on Inngest and nothing outside it reads the receipts; only the Netlify payment clock keeps going.
- **missing** — af-02-referral-ownership-capture — credits the referring affiliate, writes the referral row commission comes from. Can go red? no — partners:referral-link reads clicks, not the referral rows this job writes.
- **missing** — s-02-incomplete-survey-nudge — email 20 min after a lead stops (entry.captured; 8 sent in 14 days). Can go red? no — nothing compares leads who stopped with nudges sent.
- **missing** — s-nobook-chase — 3 texts and emails to a lead who never booked (survey.submitted, 81 real in 14 days). Can go red? no — nothing reads whether the chase was queued.
- **missing** — s-04b-booking-reminders: confirm email and the 24-hour and 2-hour reminders. Can go red? no — only the confirm text is read; a missed reminder means a no-show nobody sees coming.
- **weak** — ai-set-01-josh-setter — AI call to confirm the session (booking.created). Can go red? no today — Josh (AG-04) is retired, so no dial is expected and the check can only pass; it can go red only if Josh is turned on.
- **missing** — ai-set-03-no-answer-cadence — 3 texts after a no-answer call (call.completed). Can go red? no — nothing reads it.
- **missing** — ai-set-04-3way-handoff — text 15 min before the call plus an advisor task (booking.created). Can go red? no — nothing reads it.
- **missing** — bs-01-precall-launcher — pre-call texts and a 3-day email drip (booking.created). Can go red? no — nothing reads it.
- **missing** — dpc-02-call-outcome-enforcement — marks the call showed or no-show, starts no-show recovery (booking.created). Can go red? no — calls:booked-no-outcome reads outcomes a person logs, not what this job does.
- **missing** — dpc-03-inbound-reply-router — turns a YES or RESCHEDULE reply into a task or a text (message.inbound, 13 real in 14 days). Can go red? no — a YES reply that is ignored loses the sale and nothing reads it.
- **missing** — s-05a-no-show-recovery — 4 touches after a no-show (booking.noshow). Can go red? no — nothing reads it.
- **missing** — s-offer-bucket — emails the offer after a closer saves a call (call.completed). Can go red? no — closer:held-disposition reads the saved call outcome, not the offer email.
- **missing** — ds-01-repair-referral — repair offer text and email after a declined funding call (call.completed). Can go red? no — nothing reads it.
- **missing** — f-07-funding-locked — raises the success-fee invoice when a round is funded (round.funded). Can go red? no — nothing checks that a funded round has a bill; this job is the only thing that makes one.
- **missing** — f-11-bank-email-event-router — turns a bank reply into a task and moves the stage (mail.response). Can go red? no — an approval email that is not routed sits unseen and nothing reads it.
- **missing** — ar-collections — dunning texts and emails on a success-fee bill (invoice.sent, payment.received). Can go red? no — payments:invoice-stuck compares bill status with money, not whether the dunning messages went.
- **missing** — slo-genuine-followup — first message to someone who left their number and did not pay (slo.contact_started, 18 real in 14 days). Can go red? no — nothing reads whether it queued (3 sent in 14 days).
- **missing** — slo-genuine-reply — coupon after a real reply (message.inbound). Can go red? no — nothing reads it.
- **missing** — slo-genuine-checkout-sms — text when someone starts checkout and stops (slo.checkout_started, 15 real in 14 days). Can go red? no — nothing reads it.
- **missing** — slo-no-reply-197 — $197 offer to someone who did not reply (slo.contact_started). Can go red? no — nothing reads it.
- **missing** — an event is written but the send to Inngest fails (bus.mjs sends and swallows the error). Can go red? no — nothing compares events written with workflows run; the send is `void inngest.send(...).catch(() => {})`.
- **missing** — an event workflow throws and Inngest gives up (62 functions). Can go red? no — no failed_events row is written for Inngest functions, and nothing reads Inngest's own run list.

### customer-blocked (18)

- **ping-only** — paid-checkout-expiry-sweeper (hourly) — closes dead checkout links so chase texts can restart. Can go red? yes, only if the clock stops; dead links left open stay green (before this job, 200 stale rows blocked a live client's messages).
- **ping-only** — finance-os-card-due-reminders (daily 16:00 UTC) — texts card due dates. Can go red? yes, only after 3 missed days; texts that never queue stay green.
- **ping-only** — finance-os-pull-sweeper (daily 06:00 UTC) — requests the included monthly soft pull. Can go red? yes, only after 3 missed days; it writes a request row and calls no bureau, and nothing reads whether a pull arrived.
- **ping-only** — waypoint-nudge-sweeper (hourly) — chases overdue client checklist items. Can go red? yes, only if the clock stops; nudges that never queue stay green (only a stuck send is watched).
- **ping-only** — blueprint-finance-os-alerts (daily 07:30 UTC) — file-protection alerts for paid buyers. Can go red? yes, only after 3 missed days; alerts that never queue stay green.
- **missing** — c-00-crs-soft-pull-request — runs the credit pull after a paid diagnostic (diagnostic.paid; 0 real in 14 days). Can go red? no — nothing sees "paid, consented, no pull"; repair-letter-round only sees repair files stuck in analysis (1 red now).
- **missing** — c-02-inquiry-created — logs new inquiries, holds the round, makes the specialist task (analysis.completed). Can go red? no — inquiry checks read cases and letters, not this job's rows and task.
- **missing** — c-02b-inquiry-removal-requested — starts inquiry removal after a deposit (deposit.paid). Can go red? no — nothing reads it.
- **missing** — c-03-inquiry-removed-resume-or-hold — resumes or holds funding after removal (inquiry.removed; never fired). Can go red? no — nothing reads it.
- **missing** — u-03-crs-snapshot-sync — saves CRS fields and pauses funding on negatives (analysis.completed, crs). Can go red? no — a client with negatives would not be paused and nothing reads it.
- **missing** — repair-bureau-response-reader — reads a bureau reply (docs.received). Can go red? no — nothing reads it.
- **missing** — ds-02-diy-letters — builds and emails the DIY letter pack for the paid DIY product (payment.received; 7 real in 14 days). Can go red? no — uw-letters-missing reads dispute letters, not this paid pack.
- **missing** — f-02-portal-id-missing — asks the client for ID and portal setup (round.started +3h). Can go red? no — documents:required-unchased only sees clients this job already tagged, so a job that never runs is invisible.
- **missing** — f-05-inquiry-cleanup-gate — flags open inquiries for removal between rounds (round.approved). Can go red? no — nothing reads it.
- **missing** — f-06-funding-conditions-missing-docs — asks for what the bank wants (mail.response, docs.received). Can go red? no — documents:required-unchased only sees clients this job already tagged.
- **missing** — f-09-funding-declined-no-path — hold reason and review task on a bank denial (mail.response). Can go red? no — nothing reads it.
- **missing** — slo-paid-form-nudge — asks a buyer who paid $297 to fill in the pull form (payment.received). Can go red? no — consent:slo-store reads saved identity without consent, not a buyer who never filled the form.
- **weak** — an Inngest cron pass fails but returns ok:false instead of throwing (16 cron files have an ok:false return; 2 read in full). Can go red? no — the receipt hook reads only thrown errors, so the job: row stays green; Netlify jobs do save ok:false as an error.

## Other holes (staff-only and internal): 32 in all, worst 12 shown, every one is in the tables above

- **missing** (staff-only) — s-01-new-lead-intake — puts the lead on the Sales board (entry.captured)
- **missing** (staff-only) — s-04-call-booked — tags the booking and moves the card (booking.created; 0 real in 14 days, last 09-04)
- **missing** (staff-only) — s-04c-staff-booked-alert — text to staff when a call is booked (switch is off by default)
- **missing** (staff-only) — s-06-post-call-funding-purchased — tags and tasks after a deposit (deposit.paid; 0 real in 14 days)
- **missing** (staff-only) — s-08-post-call-funding-declined — tag and follow-up task (call.completed declined)
- **missing** (staff-only) — c-05-pre-funding-review — pre-funding review task (round.started; never fired)
- **missing** (staff-only) — f-01-funding-intake — tags and advisor tasks (round.started)
- **missing** (staff-only) — f-08-post-funding-monitoring — 30-day check-in task (round.funded)
- **missing** (staff-only) — f-10-client-funding-inbox-provisioner — makes the forwarding address and a setup task (round.started)
- **ping-only** (staff-only) — social-publish-sweeper (every 5 min) — publishes posts when their time comes
- **ping-only** (staff-only) — creative-job-runner (every 2 min) — runs queued Creative Factory jobs
- **ping-only** (staff-only) — next-action-catch-up (every 5 min) — keeps the saved next step equal to the screen

## Checker — 2026-10-09

**Verdict: not confirmed.** Most of this map is right. Three "covered" rows are weaker than written, four "missing" rows are partly watched, and four steps were skipped. Read only. I wrote nothing else.

**What I checked and it held**
- All 121 check ids in this file exist in the pulse code. The slice ids (like `25-rest:...`) are built on the fly and they exist too.
- The receipts table has 40 rows. All are fresh. The 2 monthly jobs have none, as you said.
- Inngest cron receipts save `ok:false` as ok. True. `message-dispatch-sweeper` and `commas-inbox-drain` both catch their own errors. I count 17 cron files with this, not 16.
- A failed Inngest event job leaves no trace. True. Nothing handles `inngest/function.failed`, and `bus.mjs` sends to Inngest and drops any error.
- The 5-minute watch has 5 checks. Only `pipeline:outbound` touches a job. True.
- The pending-receipt hole is real. `payments:pay-link-webhook` reads only `done` and `ignored` rows. `webhooks:stuck-failed` needs 10 tries. Live inbox: 36 rows, all done.
- Nothing outside Inngest watches Inngest. No other schedule, no outside monitor. True.
- Nothing checks that a funded round has a bill. True (`f-07`).

**"Covered" rows that are really weaker**
1. **document-vault-chase** is ping-only, not covered. `documents:required-unchased` only looks at clients tagged `docs:missing` who got a first ask from DOC-01, F-02 or F-06. The vault chase never writes that tag. So a paid Blueprint buyer who is never asked stays green. Only `job:document-vault-chase` (3 missed days) watches it.
2. **c-06-crs-results-router** is weak, not covered. `uw-letters-missing` reads `crs_inquiries_ex/eq/tu` and `crs_negative_items_count`. Only the sim script, the demo simulator and the sample credit file write those. No real credit pull does. Live: 2 clients have them, both are Chris's test emails. For a real customer this check cannot go red.
3. **doc-check** is weak, not covered. It leaves a dead-letter row only when the reader hits a temporary failure. `documents:stuck-processing` reads outbound deliverables, not uploads. An upload that no one ever reads leaves nothing.

**"Missing" rows that are partly watched**
- **c-00-crs-soft-pull-request** is weak. `src/handlers/diagnostic-soft-pull.mjs` runs the same code inside the bus. If it throws, `failed-events` goes red. A refusal or a provider error is only written to `soft_pull_requests`. Nothing reads that table.
- **dpc-02-call-outcome-enforcement** is weak. `calls:booked-no-outcome` goes red when an ended call has no logged outcome. It does not see the no-show texts.
- **repair-bureau-response-reader** is weak and slow. `repair-case-stuck` reds a case in `awaiting_response` only 5 days after the bureau due date.
- Counts after this: 27 covered, 26 ping-only, 9 weak, 50 missing (112).

**Steps the map skipped**
1. **A message the sender blocks.** Draft copy, placeholder copy and the gate end as `status=blocked`. No check reads that. Draft and placeholder blocks file no task. Live: 5 blocked rows, 3 are contract emails to real-looking people (reason `recipient_unknown`). Customer-blocked.
2. **A credit pull that fails or stays queued.** `soft_pull_requests` has `queued` and `failed`. Nothing in the pulse reads it. The buyer paid and got nothing. Customer-blocked.
3. **A payment with a product we do not know.** `payments:paid-no-entitlement` skips payments whose product name matches nothing, or that have no client. Live: 4 such real-looking payments. They look like test walks, so no loss is proved. A new real product would pass silently. Money.
4. **The Inngest event key missing or wrong.** `bus.mjs` skips the send if `INNGEST_EVENT_KEY` is empty. All 62 event jobs go quiet while every cron keeps ticking. Nothing reads that key. Money.

**Smaller notes**
- `gap:sms-journey-zero` red now is 2 events from one person on Oct 2. That lead also has no welcome email, so the red looks real. Nobody has read why yet.
- `clarity-insights-sweeper` is a daily cron that is built but not registered in `index.mjs`, so it never runs. I did not find out if that is on purpose. It is not a money path.
- A "daily job turns red after 3 days" is slow for `banks-sync-stale` (customer-blocked). It is allowed by the 3x rule.
