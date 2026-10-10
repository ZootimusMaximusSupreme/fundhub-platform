# Zero unchecked: measure (2026-10-09)

Read only. Measured on the main checkout at `de03ff94` (clean) and on the live database as a read-only reader. Nothing in the repo was changed except this folder. Scratch proofs live outside the repo in the session scratchpad (`design/`).

Source of every count below: the stored 6 a.m. scorecard of 2026-10-09 (`pulse_scorecards` id `f5df03be-1439-4eaa-aad0-4c561a10118f`, ran 13:01 UTC): **1,008 rows = 695 green + 14 red + 299 not_checked.** The 299 split exactly: **176 slice-PASS + 93 event + 30 other = 299.**

Differences from the brief (measured, not argued):
- The slice-PASS rows are **176** with the exact text "No last-success time in the database. Slice note: PASS". The brief said 178. Six more rows carry a PASS-type slice note but a different tail; they sit inside the 93 and the 30.
- The 93 event rows are **63 distinct workflow ids** (the same workflow shows up in several slices). There are **62 event-triggered Inngest functions** (+3 with no trigger), and 2 of the 93 rows (`repair.docs.complete`, `repair-stage-moves`) are **not Inngest functions at all**: they are in-process bus handlers.
- Three whole slice files do not load on the live server, so their rows are missing from the scorecard (section 5). That is bigger than any single "not checked" row.

Machine-readable outputs in this folder:
- `slice-link-map.json` all 176 slice rows with the real row they map to
- `event-workflow-rows.json` the 93 event rows with workflow id and triggers
- `baseline-proposal.json` the 495 surfaces sorted

---

## 1. The 176 "slice note PASS" rows

### What they are
Rows from `src/pulse/coverage/slice-*.mjs` `CHECKS` with `alreadyInRegistry: true`. The slice builds `listed = new Set(PULSE_REGISTRY.map(coverageKey))` and sets `alreadyInRegistry = listed.has(id)`; the proof text is then the word `PASS`. The row means "this door is already pinged by the registry".

### Why they read "not checked"
`run-slices.mjs` `evaluateRow` only knows four outcomes: marketing heartbeat, the agent_runs cron, a cron string it can time (`cronExpression(row)`; the slice gives `schedule: "daily"`, which is not a cron), and an event-looking schedule. Everything else falls to the last line: `fromUnchecked(row, sliceId, "Not checked. No last-success time in the database.")` plus the slice note. **`alreadyInRegistry` is never read anywhere in `run-slices.mjs`** (grep: zero hits outside the slice files and their tests). So the link from the slice row to the real ping that ran is simply not made.

### The mapping rule (proved)
For a slice row `R` with `alreadyInRegistry: true`:

1. Find the registry row `r` in `PULSE_REGISTRY` with `coverageKey(r) === R.id`.
   - `coverageKey` = `row.file` for `public_static`, the file name for `desk`, and the path without `/api/` for `api`.
2. The real check on the scorecard is `"reg:" + r.id`.
   - `api`: `r.id` is the route key, so `auth/login` becomes `reg:auth/login`.
   - `desk`: `r.id` is the file without `.html`, so `partner-galaxy.html` becomes `reg:partner-galaxy`.
   - `public_static`: `r.id` is `publicStaticId(file)` (`home`, or slashes turned to dashes), so `progress.html` becomes `reg:progress`.
3. For a cron or sweeper row the same idea uses `job:<id>` (JOBS) or the row's `machineId` (MACHINE_CHECKS); both already exist as green rows when they apply.

**Result on the live scorecard: 176 of 176 map, and all 176 targets are green.** 142 are `api`, 32 are `desk`, 2 are `public_static`. The 176 rows point at only **127 distinct** `reg:` rows, so 49 of them are pure duplicates of a row that is already on the scorecard (the same door listed by several slices). Per slice: 01-auth 10, 08-banks 3, 13-calls 1, 21-underwrite 1, 22-partners 19, 26-client-journey 27, 27-closer 13, 28-funding-advisor 12, 29-inquiry-remover 4, 30-csm-owner 37, 31-affiliate-wl 28, 33-fulfillment 21.

What "green" means here: the `reg:` row is a **ping** (the door answers; 401, 405 and 400 count as up). It does not prove the door works. The linked row must carry that depth, or the link would turn a ping into a pass for the slice.

Sample of the mapping, 49 real ids (the full 176 are in `slice-link-map.json`):

| slice row | kind | real row that ran | its status and proof |
|---|---|---|---|
| `01-auth:auth/login` | api | `reg:auth/login` | green: /api/auth/login 200 |
| `01-auth:auth/magic-link-verify` | api | `reg:auth/magic-link-verify` | green: /api/auth/magic-link-verify 405 |
| `01-auth:auth/staff-role` | api | `reg:auth/staff-role` | green: /api/auth/staff-role 405 |
| `08-banks:banking/sync-transactions` | api | `reg:banking/sync-transactions` | green: /api/banking/sync-transactions 405 |
| `22-partners:public/partner-apply` | api | `reg:public/partner-apply` | green: /api/public/partner-apply 405 |
| `22-partners:partner-brand/verify-domain` | api | `reg:partner-brand/verify-domain` | green: /api/partner-brand/verify-domain 405 |
| `22-partners:partner-marketing/generate-logo` | api | `reg:partner-marketing/generate-logo` | green: /api/partner-marketing/generate-logo 405 |
| `22-partners:read/partner-home-tiles` | api | `reg:read/partner-home-tiles` | green: /api/read/partner-home-tiles 401 |
| `22-partners:partner-galaxy.html` | desk | `reg:partner-galaxy` | green: /app/partner-galaxy.html 200 |
| `26-client-journey:public/slo-checkout` | api | `reg:public/slo-checkout` | green: /api/public/slo-checkout 200 |
| `26-client-journey:auth/magic-link` | api | `reg:auth/magic-link` | green: /api/auth/magic-link 405 |
| `26-client-journey:progress.html` | public_static | `reg:progress` | green: /progress.html 200 |
| `26-client-journey:read/entitlements` | api | `reg:read/entitlements` | green: /api/read/entitlements 401 |
| `26-client-journey:documents-upload` | api | `reg:documents-upload` | green: /api/documents-upload 405 |
| `26-client-journey:soft-pull-approve` | api | `reg:soft-pull-approve` | green: /app/soft-pull-approve.html 200 |
| `26-client-journey:waypoint-tick` | api | `reg:waypoint-tick` | green: /api/waypoint-tick 405 |
| `27-closer:read/closer-now` | api | `reg:read/closer-now` | green: /api/read/closer-now 401 |
| `27-closer:closer-dashboard.html` | desk | `reg:closer-dashboard` | green: /app/closer-dashboard.html 200 |
| `27-closer:contracts.html` | desk | `reg:contracts` | green: /app/contracts.html 200 |
| `28-funding-advisor:read/funding-rounds` | api | `reg:read/funding-rounds` | green: /api/read/funding-rounds 401 |
| `28-funding-advisor:documents-upload` | api | `reg:documents-upload` | green: /api/documents-upload 405 |
| `28-funding-advisor:proxy/launch` | api | `reg:proxy/launch` | green: /api/proxy/launch 405 |
| `29-inquiry-remover:inquiry-cases` | api | `reg:inquiry-cases` | green: /api/inquiry-cases 405 |
| `30-csm-owner:dashboard/pipeline` | api | `reg:dashboard/pipeline` | green: /api/dashboard/pipeline 401 |
| `30-csm-owner:read/ops-pulse` | api | `reg:read/ops-pulse` | green: /api/read/ops-pulse 401 |
| `30-csm-owner:company-brain/reviews` | api | `reg:company-brain/reviews` | green: /api/company-brain/reviews 401 |
| `30-csm-owner:hiring/decide` | api | `reg:hiring/decide` | green: /api/hiring/decide 405 |
| `30-csm-owner:sales-floor.html` | desk | `reg:sales-floor` | green: /app/sales-floor.html 200 |
| `30-csm-owner:read/staff` | api | `reg:read/staff` | green: /api/read/staff 401 |
| `30-csm-owner:commission-rules` | api | `reg:commission-rules` | green: /api/commission-rules 401 |
| `30-csm-owner:calendar.html` | desk | `reg:calendar` | green: /app/calendar.html 200 |
| `30-csm-owner:consent/capture` | api | `reg:consent/capture` | green: /api/consent/capture 401 |
| `31-affiliate-wl:affiliates/refer` | api | `reg:affiliates/refer` | green: /api/affiliates/refer 405 |
| `31-affiliate-wl:public/funnel-checkout` | api | `reg:public/funnel-checkout` | green: /api/public/funnel-checkout 200 |
| `31-affiliate-wl:partner-brand` | api | `reg:partner-brand` | green: /api/partner-brand 401 |
| `31-affiliate-wl:partner-marketing/generate-copy` | api | `reg:partner-marketing/generate-copy` | green: /api/partner-marketing/generate-copy 405 |
| `31-affiliate-wl:partners/approve` | api | `reg:partners/approve` | green: /api/partners/approve 405 |
| `31-affiliate-wl:read/partner-training` | api | `reg:read/partner-training` | green: /api/read/partner-training 401 |
| `31-affiliate-wl:campaigns/connections` | api | `reg:campaigns/connections` | green: /api/campaigns/connections 401 |
| `33-fulfillment:dashboard/clients` | api | `reg:dashboard/clients` | green: /api/dashboard/clients 401 |
| `33-fulfillment:client-control-panel.html` | desk | `reg:client-control-panel` | green: /app/client-control-panel.html 200 |
| `33-fulfillment:documents-upload` | api | `reg:documents-upload` | green: /api/documents-upload 405 |
| `33-fulfillment:proxy/launch` | api | `reg:proxy/launch` | green: /api/proxy/launch 405 |
| `33-fulfillment:repair/generate` | api | `reg:repair/generate` | green: /api/repair/generate 405 |
| `22-partners:partner-training.html` | desk | `reg:partner-training` | green: /app/partner-training.html 200 |
| `26-client-journey:payment-success.html` | desk | `reg:payment-success` | green: /app/payment-success.html 200 |
| `26-client-journey:client-portal.html` | desk | `reg:client-portal` | green: /app/client-portal.html 200 |
| `26-client-journey:documents.html` | desk | `reg:documents` | green: /app/documents.html 200 |
| `26-client-journey:soft-pull-approve.html` | desk | `reg:soft-pull-approve` | green: /app/soft-pull-approve.html 200 |
| `26-client-journey:portal-login.html` | public_static | `reg:portal-login` | green: /portal-login.html 200 |
### Rows that claim coverage and map to nothing (the lies the audit must catch)
Checked all 350 slice rows loaded locally. A row with `alreadyInRegistry: true` and **no** `reg:` row and **no** `job:` row:

| row | what it claims | what really watches it |
|---|---|---|
| `17-affiliates:af-02-referral-ownership-capture`, `31-affiliate-wl:af-02-referral-ownership-capture` | "PASS: capture doors public/affiliate-click, affiliates/refer are on the ping list" | Only the doors are pinged. The workflow (entry.captured, credits the referring affiliate) has no check. The map `07-jobs.md` rates it missing. Slice says PASS. |
| `09-documents:doc-check` (event `docs.received`) | PASS | no check of the workflow itself (and the whole slice does not load, see section 5) |
| `03-marketing:page_seen` | "PASS: GET marketing/health writes page_seen" | beats only when staff open the page; nothing on a timer |
| `06-briefs:morning-brief` | on the local file: "already watched in the morning pulse code" | the live server shows a different proof: the slice reads repo files at run time (`fs`), so the proof text changes between laptop and server. The real job is `job:daily-pulse`; the ids differ (`morning-brief` vs `daily-pulse`), so no heartbeat is found. |

All other `alreadyInRegistry: true` rows map to a real, green row.

### What the fix has to do (facts for the design)
- Add the link step: at the end of the slice pass, for each slice row with `alreadyInRegistry` look up `reg:<id by coverageKey>` / `job:<id>` / `machineId` among the checks of the same run and copy status, proof and depth. If the linked row is not on the scorecard, or not green, the slice row must say that, never "PASS".
- A row that points at a real row should not be shown twice. 49 of 176 are plain duplicates; dropping duplicates loses nothing.
- A row whose claim has no target (the 4 above) must turn red or "missing", not stay silent.
- Aliases: `morning-brief` -> `job:daily-pulse` needs an explicit alias.

---

## 2. The 93 event-workflow rows

### The list
93 rows, 63 distinct workflow ids. Registered Inngest functions: **100** (`src/workflows/index.mjs`). By trigger: **35 cron, 62 event-only with a trigger, 3 with no trigger** (`n-01-cold-nurture`, `n-02-warm-nurture`, `n-03-hot-nurture`). The 93 rows cover 62 event functions plus 1 non-function id, `repair.docs.complete`. Full list: `event-workflow-rows.json`.

Trigger events and the functions behind them (22 distinct trigger events):

- `entry.captured`: `af-02-referral-ownership-capture`, `at-01-first-touch-capture`, `s-01-new-lead-intake`, `s-00-welcome`, `s-02-incomplete-survey-nudge`
- `diagnostic.paid`: `af-02-referral-ownership-capture`, `c-00-crs-soft-pull-request`
- `analysis.completed`: `af-02-referral-ownership-capture`, `c-02-inquiry-created`, `c-06-crs-results-router`, `dpc-01-analyzer-lock`, `slo-pack-delivery`, `u-02-analyzer-complete-delivery`, `u-03-crs-snapshot-sync`, `u-04-promote-crs-primary`, `u-05-data-health-monitor`
- `booking.created`: `ai-set-01-josh-setter`, `ai-set-04-3way-handoff`, `bs-01-precall-launcher`, `dpc-02-call-outcome-enforcement`, `dpc-05-no-progress-escalation`, `s-04-call-booked`, `s-04b-booking-reminders`, `s-04c-staff-booked-alert`, `s-portal-invite`
- `call.completed`: `ai-set-03-no-answer-cadence`, `ds-01-repair-referral`, `s-08-post-call-funding-declined`, `s-offer-bucket`
- `booking.rescheduled`: `ai-set-04-3way-handoff`, `bs-01-precall-launcher`, `dpc-02-call-outcome-enforcement`, `s-04b-booking-reminders`
- `invoice.sent`: `ar-collections`
- `payment.received`: `ar-collections`, `ds-02-diy-letters`, `slo-paid-form-nudge`
- `round.started`: `bc-01-customer-responsiveness`, `bc-02-customer-friction`, `c-05-pre-funding-review`, `f-01-funding-intake`, `f-02-portal-id-missing`, `f-10-client-funding-inbox-provisioner`, `round-started-client-notify`
- `deposit.paid`: `c-02b-inquiry-removal-requested`, `s-06-post-call-funding-purchased`, `s-doc-collection`
- `inquiry.removed`: `c-03-inquiry-removed-resume-or-hold`
- `message.inbound`: `dpc-03-inbound-reply-router`, `slo-genuine-reply`
- `round.submitted`: `f-03-round-submitted`
- `round.approved`: `f-04-round-approvals`, `f-05-inquiry-cleanup-gate`, `sys-01-client-value-calculator`
- `mail.response`: `f-06-funding-conditions-missing-docs`, `f-09-funding-declined-no-path`, `f-11-bank-email-event-router`
- `docs.received`: `f-06-funding-conditions-missing-docs`, `doc-check`, `repair-bureau-response-reader`
- `round.funded`: `f-07-funding-locked`, `f-08-post-funding-monitoring`, `n-06-renewal-second-wave`, `sys-01-ltv-calculator`
- `round.closeout`: `n-04-post-funding-nurture`
- `survey.submitted`: `s-nobook-chase`
- `booking.noshow`: `s-05a-no-show-recovery`
- `slo.contact_started`: `slo-genuine-followup`, `slo-no-reply-197`
- `slo.checkout_started`: `slo-genuine-checkout-sms`
Not Inngest functions, but on the 93 rows: `repair.docs.complete` (id on `33-fulfillment`) and `33-fulfillment:repair-stage-moves` (in the "other 30"). Both are **in-process bus handlers** registered by `src/repair/register.mjs`. There are about 61 `on("event", handler)` registrations in `src/` (payment.received 9, deposit.paid 6, sale.closed 5, diagnostic.paid 4, and so on). The Inngest middleware cannot see any of them.

### What the data says about events (read-only, `events` table)
Counts per trigger event, **real (non-demo) events in the last 30 days**:

| trigger event | functions on it | real 30 d | all 30 d | newest real | newest any |
|---|---|---|---|---|---|
| `entry.captured` | 5 | 128 | 232 | 2026-10-02 | 2026-10-02 |
| `diagnostic.paid` | 2 | 0 | 12 | 2026-08-18 | 2026-09-25 |
| `analysis.completed` | 9 | 2 | 32 | 2026-09-30 | 2026-09-30 |
| `booking.created` | 9 | 0 | 20 | 2026-09-04 | 2026-09-26 |
| `call.completed` | 4 | 0 | 10 | 2026-08-21 | 2026-09-19 |
| `booking.rescheduled` | 4 | never emitted | - | - | - |
| `invoice.sent` | 1 | 0 | 2 | - | 2026-09-19 |
| `payment.received` | 3 | 7 | 32 | 2026-10-07 | 2026-10-07 |
| `round.started` | 7 | 0 | 9 | - | 2026-09-19 |
| `deposit.paid` | 3 | 0 | 8 | 2026-08-21 | 2026-09-19 |
| `inquiry.removed` | 1 | 0 | 1 | - | 2026-09-17 |
| `message.inbound` | 2 | 172 | 173 | 2026-10-07 | 2026-10-07 |
| `round.submitted` | 1 | 0 | 3 | - | 2026-09-19 |
| `round.approved` | 3 | 0 | 2 | - | 2026-09-19 |
| `mail.response` | 3 | 0 | 2 | 2026-08-18 | 2026-09-19 |
| `docs.received` | 3 | 6 | 72 | 2026-09-30 | 2026-09-30 |
| `round.funded` | 4 | 0 | 3 | - | 2026-09-19 |
| `round.closeout` | 1 | 0 | 3 | 2026-08-13 | 2026-09-19 |
| `survey.submitted` | 1 | 81 | 154 | 2026-10-02 | 2026-10-02 |
| `booking.noshow` | 1 | 0 | 9 | 2026-08-13 | 2026-09-22 |
| `slo.contact_started` | 2 | 18 | 18 | 2026-10-02 | 2026-10-02 |
| `slo.checkout_started` | 1 | 15 | 25 | 2026-10-02 | 2026-10-02 |

The two facts that shape the design:
1. **Since job receipts began (2026-10-07 20:08 UTC) not one of the 22 trigger events has been emitted.** The only events since then are `funnel.*`, `slo.visit`, `slo.engagement` and one `message.queued`. So a "ran" receipt will not exist for any of the 62 workflows for days or weeks, whatever middleware is used. Nothing here can show that an event workflow has ever run in production on current code. A rule that needs a run to judge it will read "waiting" forever unless a synthetic canary is added.
2. **14 of the 22** trigger events have no real event in 30 days; `booking.rescheduled` has never been emitted. Real trigger events in 30 days in total: about 430 (`message.inbound` 172, `entry.captured` 128, `survey.submitted` 81, the rest small).

### Candidate (a): Inngest middleware on the shared client
**Already half built.** `src/workflows/client.mjs` already registers `heartbeatHooks()` (`src/pulse/heartbeats.mjs`). It returns `onFunctionRun` with a `finished` hook, but returns `{}` unless `ctx.event.name === "inngest/scheduled.timer"` (cron runs only). In production this writes a row for every cron: **12,377 rows in 2 days, 41 distinct jobs, 6,188 inngest rows**, which proves `finished` fires on the live Netlify path. So the "single place" exists and is proven. Removing the cron-only filter is the whole change for event runs.

**Lifecycle, read from `node_modules/inngest` 3.54.2 and proved with a scratch client (`design/mw-proof.mjs`, not in the repo, no network, drives the real serve handler with crafted step requests):**

| fact | evidence |
|---|---|
| `onFunctionRun` fires on **every HTTP request**, i.e. once per step | a 2-step function = 3 requests = 3 `onFunctionRun` calls |
| `finished` fires **once**, on the request where the function returns | the 2-step OK run: `finished` x1, with `result.data` = `{done:2}`; step requests ran `transformOutput` with a step name and no `finished` |
| on a thrown error `finished` fires **once per failed attempt** | `retries: 2` run failed at attempt 0, 1 and 2: `finished` x3, each with `result.error` |
| a `NonRetriableError` fires `finished` once | `wf-nr`: x1 |
| `ctx` in `onFunctionRun` carries `event`, `events`, `runId`, `attempt`, `maxAttempts` | printed from the probe |
| source | `components/execution/v1.js` line 694: `if (!isStepExecution) await this.state.hooks?.finished?.(...)` |
| docs say so | `InngestMiddleware.d.ts`: "may be called multiple times ... for a guaranteed single execution, create a function with an event trigger of inngest/function.finished" |

So: **success = exactly one `finished`; failure = one per attempt.** Final-attempt detection is available (`attempt + 1 >= maxAttempts`), but "newest row wins" makes it unnecessary.

Traps found:
- **17 of the 62 event workflows sleep** (`step.sleep` / `waitForEvent`, from 20 minutes up to 180 days: `ai-set-01/03/04`, `ar-collections`, `bc-01`, `bs-01`, `dpc-02`, `dpc-05`, `f-02`, `n-06` (180 d), `s-02`, `s-04b`, `s-nobook-chase`, `s-05a`, `slo-no-reply-197`, `slo-paid-form-nudge`, `slo-genuine-followup`, `hiring-outreach-cadence` also sleeps but is a cron). `finished` fires only when the whole sequence ends, so for these a finish-only receipt arrives hours to months late. They need a **start beacon**: the first request of a run is `attempt 0` with no memoized steps (`transformInput` gets `steps`), so one extra INSERT per run. (A grep for `step.sleep|waitForEvent|sleepUntil` finds 18 workflow files; 17 are event-triggered.)
- Default retries are 4 (no function sets `retries`), so a failing run writes up to 5 error rows. Rule must read the newest row.
- No function defines `onFailure`, so no failure-handler runs pollute the stream.
- The 16 cron files that `return { ok:false }` are saved as `ok` today, because the hook reads only thrown errors (map `07-jobs.md`, section 2). `finished` hands over `result.data`, so `data.ok === false` can be recorded as `error` in the same change.

### Candidate (b): reuse `job_heartbeats`
Table (migration 430): `id, job text(1..120), runner in ('inngest','netlify'), started_at, finished_at, outcome in ('ok','error'), item_count, error text(<=300)`, index `(job, finished_at DESC)`. **INSERT and SELECT only** (written once, never changed). So:
- An event workflow can use it as is: `job = <function id>`, `runner = 'inngest'`. No migration.
- **Cost per run: one INSERT** (`recordHeartbeat`, never throws), plus one per failed attempt, plus one for a start beacon if used. Event volume is small (about 430 real trigger events in 30 days; 7,393 events of all kinds in 30 days, mostly `funnel.*` tracking that triggers no function), so well under 1,000 rows a month. The table is 2.8 MB at 12,377 rows today; the crons alone add about 1.4 MB a day.
- **UPSERT of one row per job is not possible** without a migration and a grant change. Not recommended: it would destroy history. One INSERT per run is the cheapest safe write.
- The existing red rule (`checkJobHeartbeats`, 3 x schedule) cannot be reused as written: it needs a `cron` string. Event workflows have no schedule.

Rules that fit the data (proposals for the design agent to choose from):
- **Error**: newest row for the function is `error` and older than the retry window (30 minutes), or two error rows with no `ok` after them: red.
- **Missed**: a trigger event exists with `created_at >= receipts start` and older than 15 minutes, and the function has no row with `finished_at` after it: red. "Newest event of that name is older than the function's newest success" is the green condition. Caveats: events written with `skipInngest`, or while `INNGEST_EVENT_KEY` is off, produce no run (the bus sends with `void inngest.send(...).catch(() => {})`); sleepers need the start beacon or they read red for days.
- **Idle**: no trigger event since receipts began. Not red and not "not checked": a stated state, `idle: 0 events since <date>`, honest only if the platform path is proven alive. Today that is true for **all 62**.
- **Canary**: a synthetic event (for example `pulse.canary`) sent hourly to a do-nothing function proves bus -> Inngest -> serve -> middleware -> table end to end, with no customer touched and no spend. It is the only thing that makes "idle" trustworthy, because every real event workflow is idle right now.
- **Never wired**: the 3 functions with no trigger, and any function in `functions` that Inngest does not list, need an explicit "off" or red state; the test `heartbeats.test.mjs` already guards crons against drift and has no twin for events.

### Candidate (c): Inngest REST API
- The v2 spec (`https://api-docs.inngest.com/api-specs/v2.json`, read) lists: `GET /runs`, `GET /runs/{runId}`, `GET /runs/{runId}/trace`, `GET /events/{eventId}/runs`, `GET /apps/{appId}/functions/{functionId}/runs`, `GET /apps/{appId}/functions` (config and status), all marked **beta**. Auth is `BearerAuth`; the visible text does not give the key type, rate limits or retention.
- **I could not test it.** On this Mac both `INNGEST_SIGNING_KEY` and `INNGEST_EVENT_KEY` in `.env` and in `credentials/env.full.snapshot` are 20-character masks (16 asterisks plus 4). The live function holds the real value (the SDK already verifies requests with it), so a live function can read it; the laptop cannot. Not touched, per the key law.
- Verdict: usable from a live function in principle. Costs: an outbound call per check, beta stability, plan-dependent retention, and it depends on the same vendor that is being watched. Good as a **second opinion** (registered function list = "never wired"; failed runs; runs stuck > N hours) and a good source for sleepers. Not the primary source.

### Candidate (d): derived evidence
- `events`: proves an event was **written**, not that a workflow ran.
- `failed_events`: 47 rows total, newest 2026-09-19, handler names are all in-process bus handlers (`onDepositPaidMoney`, `onPaymentReceivedForLink`, ...). **No Inngest function ever writes it.** It does fit the 2 in-process rows.
- `messages`: no `source_workflow` column (checked). A message can only be tied to a workflow through `template_key`, and only for the workflows that send.
- `agent_runs`: only the AI agents.
- Verdict: good for the "what it left behind" deep checks already in the gap lanes; useless as a general "ran" signal.

### Recommendation
**One wrapper, in the middleware that already exists** (`heartbeatHooks`): drop the cron-only filter so every function run writes to `job_heartbeats`.

Exact write, via the existing `recordHeartbeat(db, {...})`:
- on `finished`: `INSERT INTO job_heartbeats (job, runner, started_at, finished_at, outcome, item_count, error)` with `job = fn id`, `runner = 'inngest'`, `outcome = result.error || result.data?.ok === false ? 'error' : 'ok'`, `error` clipped to 300.
- on the first request of a run (attempt 0, no memoized steps): one start beacon row, for the 17 sleepers at least.
- Cost: **one INSERT per finished run (and per failed attempt); one more for a start beacon.**

Then: a new `EVENT_JOBS` list (62 ids + trigger events, test-guarded against `index.mjs` like `INNGEST_JOBS`), a `checkEventHeartbeats` that applies the error, missed and idle rules, the hourly canary, and for the 2 in-process rows a twin write in `src/events/bus.mjs` `dispatch()` (the one place every bus handler runs; it already catches and records failures).

What can go wrong:
1. **A write failure failing the workflow.** `recordHeartbeat` swallows every error and returns `{recorded:false}`, and `finished` returns void. The hook is awaited, so a hung pool would delay the response, close to the 26 s Netlify cut. Put a short timeout (about 2 s) around the write.
2. **A run that never reaches `finished`**: a function killed at 26 s, a crash, a sleeper. A finish-only table cannot tell "still sleeping" from "dead". The start beacon plus a per-workflow "expected within" value, or the REST API, closes this. Until then, say "waiting", never "ok".
3. **Duplicates** from parallel steps: harmless, newest wins.
4. **Retry noise**: up to 5 error rows per failing run; the newest-row rule absorbs it.
5. **Silent success of a swallowed failure**: handlers that catch and return a value look `ok`. Only a workflow that returns `ok:false` can be told apart.
6. **Idle looks green when the platform is broken**: if `INNGEST_EVENT_KEY` is missing the bus never sends and every workflow is "idle" forever. The worklist lane `keys:inngest-event-key` and the canary are the guard; `idle` must not count as pass without them.
7. Table growth: retention is a delete-data decision nobody has made (migration 430 says so). Not touched here.

---

## 3. The other 30 "not checked" rows

| id | why it is not checked | remedy |
|---|---|---|
| `gate-relay` | `daily-pulse.mjs` line 153 skips when the host is not the Mac ("gate-relay is a Mac process"). The server can never see the Mac's file heartbeat. | Real check: the Mac pushes its heartbeat to the server (a row in `job_heartbeats` or a small door), and the pulse reads that. Until then it is an honest "Mac-only". |
| `job:affiliate-payout-run` | Monthly cron `0 3 1 * *`. Receipts began 41 h ago; the last run (Oct 1) predates them. `checkJobHeartbeats` says "too soon". | Wait for the first run: **2026-11-01 03:00 UTC**. Until then show a dated state, "monthly, next run Nov 1, last run before receipts", turning red if no receipt by Nov 1 + grace. The slice already reads a durable stamp (`affiliate_payouts.max(created_at)`, 45 days old); let the job row use it too. Do not run the payout early. |
| `job:partner-production-floor` | Monthly `0 14 1 * *`. Same. `partner_production_reviews` has **0 rows ever**, so its stamp cannot prove a run either. | Wait for **2026-11-01 14:00 UTC**. Same dated state. A manual run is not safe (it can cut a partner's share 50 to 20). |
| `22-partners:partner-production-floor`, `25-rest:partner-production-floor`, `31-affiliate-wl:partner-production-floor` | The same job listed three times; each reads "no last-success time for this cron". The stamp read finds nothing (0 rows). | Link all three to `job:partner-production-floor` (section 1 rule) and drop the duplicates. |
| `02-daily-pulse:script-dry-run-default` | A code-property note ("defaults to dry-run"), not a run. No cron, no event, no data. | A static claim belongs in a test (`daily-pulse.test.mjs`), not on the live scorecard. Either delete the row, or have the pulse record the facts of this run (dryRun false in the live job, sms sent or reason) and pass on those. |
| `02-daily-pulse:pulse-never-fixes` | Same: "returns autoFix false". | Same: test-only, or assert on the run's own result shape. |
| `02-daily-pulse:proof-does-not-text` | Same: "does not call textChris". | Same. |
| `03-marketing:page_seen` | Beats only when staff open `GET marketing/health`; "not on a timer". If nobody opens it, nothing. | Let the hourly pulse perform that read once an hour so the beat exists, or drop the row. The honest condition: "no staff read in N hours" is not an outage. |
| `05-funnels:clarity-insights-sweeper` | The file `src/workflows/clarity-insights-sweeper.mjs` (cron `30 7 * * *`) is **not imported in `src/workflows/index.mjs`**, so it does not run. Not in `INNGEST_JOBS`, not in `MACHINE_CHECKS`. The Clarity law says one pull per ask, which fits "off". | Decide it is off on purpose and show "off (Clarity pull is on demand by owner law)", or register it and add a machine row. Not a heartbeat to wait for: it can never produce one. |
| `06-briefs:morning-brief` | Slice id `morning-brief` has cron `TZ=America/Phoenix 0 6 * * *`, but the heartbeat is stored under `daily-pulse`, so the read finds nothing. The slice also reads repo files with `fs` at run time. | Alias `morning-brief` -> `job:daily-pulse`; remove the `fs` reads (section 5). |
| `slice-09-documents:load-error`, `slice-11-hiring:load-error` | `readFileSync(.../workflows/index.mjs)` at import: `ENOENT /var/task/workflows/index.mjs`. The slice never loads, and its **8 and 2 real rows vanish** from the scorecard. | Remove run-time file reads (use `functions` from the registry directly). CLAUDE.md section 12 already forbids repo reads at run time. |
| `slice-23-pages:load-error` | `readFileSync(public/app/shell.js)` and `readdirSync`: `ENOENT /var/public/app/shell.js`. Locally its `CHECKS` is empty, so even a clean load adds no rows. | Same. Build the desk list at build time or from the tripwire map. |
| `10-contracts:contracts/sign`, `26-client-journey:contracts/sign`, `27-closer:contracts/sign` | Slice note "Add route key contracts/sign". The key is deliberately in `ALLOWED_UNMONITORED` (a GET answers 404 on purpose). The real check exists: `contracts:sign-route` in `gap-contracts.mjs`, and the key is in `TRIPWIRES`. | Make `alreadyInRegistry` also accept `ALLOWED_UNMONITORED` keys that name a gap check, and link to `contracts:sign-route`. |
| `16-nurture:n-01-cold-nurture`, `n-02-warm-nurture`, `n-03-hot-nurture` | The three functions have **no trigger** (n-03 also `enabled:false`); they are registered but cannot run. | Honest "off". Needs an explicit off state with the condition: turns into an event rule the day a trigger is restored. |
| `16-nurture:n-05-repair-complete-nurture` | The slice note itself says there is no `src/workflows/n-05-*.mjs` and no registration. The workflow does not exist. | Delete the row or show "not built". |
| `33-fulfillment:repair-stage-moves` | In-process handler (`src/repair/register.mjs`, `moveRepairCard`). Not on the pulse, not an Inngest function. | Real check: a repair case past intake with no stage move (read the repair card table) and a `failed_events` read for the repair handlers. The bus `dispatch()` write (section 2) also covers it. |
| `ads-spend-day-missing` | "No spend row for 2026-10-08 and no ad is running". Honest. | Nothing to judge today. Judgeable the day an ad is live: red when a live ad has no spend row for yesterday. Label it "no ad running" rather than "not checked". |
| `ads-running-no-metrics` | "No running ad is older than 24 h". Honest. | Same: judgeable when an ad has run more than 24 h. |
| `gap-leads:lead:pipe-cut-with-traffic` | Ads sent 0 link clicks on Oct 7 and 8; the rule needs 360 clicks. | Honest idle. The condition is in the text. Show "no traffic" as a state. |
| `gap-leads:lead:clickfunnels-posts-silent` | Needs 20 funnel opens in the window, saw 0. | Same. |
| `gap-leads:lead:slo-contact-not-in-clickfunnels` | No real roadmap lead in 3 days. | Same. |
| `gap-pixels:ad-click-stored` | 0 Meta link clicks over 3 days, rule needs 20. | Same. |
| `social:video-stats-stale` | No active YouTube connection, so there is no sync to be late. | Connect YouTube, or show "off: not connected". |

Summary of the 30 (8 + 5 + 3 + 3 + 3 + 4 + 1 + 1 + 1 + 1 = 30): **7 honest "nothing to judge today"** (2 ads rows, 3 lead rows, 1 pixel row, 1 YouTube) plus **1 Mac-only** (`gate-relay`). **5 wait on a monthly first run** (2 job rows + 3 slice duplicates of `partner-production-floor`, first runs Nov 1). **3 code-property notes** that should not be rows. **3 slice files fail to load.** **3 contracts rows** have a real check that is not linked. **4 nurture rows** are off or never built. **1 job-id mismatch** (`morning-brief`), **1 unregistered function** (`clarity-insights-sweeper`), **1 real missing check** (`repair-stage-moves`), **1 on-read beat** (`page_seen`).

---

## 4. The 495 unsorted surfaces

Source rules: `src/pulse/tripwires.mjs` buckets, the nine audit maps in `ops/workflows/heartbeat-complete-2026-10-09-map/`, the worklist, `registry.mjs` (`ALLOWED_UNMONITORED`, `SEND_PATHS`) and `public/app/shell.js` role lists. Every `tripwire` row names check ids that appear as quoted strings in `src/pulse/**` (the same test `tripwires.test.mjs` applies); no ping id is the only check; every `not_customer_facing` reason is at least 40 characters. Validated by script; 0 errors. The file covers exactly the 495 baseline entries.

| bucket | routes | pages | desks | jobs | sends | total |
|---|---|---|---|---|---|---|
| not_customer_facing (staff-only or internal) | 225 | 16 | 32 | 35 | 9 | **317** |
| tripwire: money or customer with a real deep check | 16 | 11 | 2 | 13 | 0 | **42** |
| tripwire, weak (check exists but can skip or see only part) | 7 | 1 | 0 | 1 | 1 | **10** |
| hole: money or customer with **no** deep check | 58 | 9 | 22 | 37 | 0 | **126** |
| unknown | 0 | 0 | 0 | 0 | 0 | **0** |
| total | 306 | 37 | 56 | 86 | 10 | **495** |

Holes by impact: **87 customer-blocked, 39 money.**

Confidence, so the unknown count is not read as "all certain":
- 223 rows are named directly in a map table with a status.
- **224 route rows are sorted by exclusion**: the map lists every money or customer-blocked door in `08-routes-pages.md` section O (75 doors), and its section N counts 224 of the 322 doors as staff-only or internal (216 + 8); the remaining 23 are the covered money or customer doors, which I name individually. A door on neither list is therefore staff or internal by the map's own accounting. This is the weakest evidence. I read the full list of 225 for anything customer-looking and found none beyond those already moved to holes, but it rests on the mapper's list.
- 14 desks are sorted because the map groups them as "the other 30 staff desks"; 18 desks and pages are backed by `public/app/shell.js` role lists; 14 sends and unrouted pages come from `registry.mjs`; 1 conflict is flagged (`page:consulting/index.html`: map 06 says money, map 08 says internal; I put it in holes); 1 judgement (`route:health`).
- The 10 "weak" tripwires: `banking/sync-*` (3), `documents-download`, `public/affiliate-click`, `public/unsubscribe`, `auth/reset`, `page:login.html` (the map's check `login` is a ping id by `isPingId`; the sign-in door checks are used and flagged), job `ai-set-01-josh-setter` (the agent is retired, so the check can only pass), and `send:src/metro2/delivery/send.mjs` (sees a stuck file, not the PostGrid hand-off).
- Shared rows in a map (one row naming several pages) are why `page:partner/*` and the money desks cite one row per surface; each check id is individual.
- Surfaces that need a decision from the owner, not from me: `desk:closer-call.html` (staff screen, map says money, put in holes), `page:consulting/index.html`, and `send:src/push/send.mjs` (customer phones, map says internal, put in not_customer_facing with a note).

The 317 + 52 can move into `NOT_CUSTOMER_FACING` and `TRIPWIRES` now, and `BASELINE_MAX` falls from 495 to 126. It reaches 0 only after the 126 holes get deep checks: the test refuses a ping as a tripwire, so a hole cannot move into `TRIPWIRES` until its check is written.

---

## 5. Things the heartbeat cannot see about itself (the audit evidence the owner asked for)

Measured today, each one a place where a check can stop running and the morning report stays calm:

1. **Three slice files do not load on the server and their rows disappear.** The live scorecard has one `load-error` row for each. Lost rows: 8 (documents) + 2 (hiring) + 0 locally (pages). They sit among the "not checked" rows, but nothing says "expected N rows from this slice, got 1".
2. **No expected-count check.** The scorecard was 420 rows on Oct 8 and 1,008 on Oct 9. Nothing compares a run to the list of checks it should have contained, so a slice that vanishes, a gap lane that throws (it becomes one `skip` row) or a file missing from `modules.mjs` is invisible unless someone reads the ids.
3. **Four slice files read repo files at run time** (`slice-06-briefs`, `slice-09-documents`, `slice-11-hiring`, `slice-23-pages`) and **eight gap files import `node:fs`** (`gap-contracts`, `gap-email`, `gap-funding`, `gap-marketing-queue`, `gap-opt-out`, `gap-nurture`, `gap-payments`, `gap-partners`). Three of the slices already fail on the server. I did not test what the eight gap files do with `fs` (their rows are on the scorecard, so they load). The CLAUDE.md section 12 law says no repo reads at run time.
4. **`job:daily-pulse` and `02-daily-pulse:ag-07-cron-daily-pulse` are read by the same run they judge.** At 13:01 UTC the scorecard shows "last run 24 h ago" for the run that was in progress. A pulse that does not run leaves yesterday's receipt looking fresh for 3 days (the 03-owner-ops map says the same).
5. **Everything is judged from inside Inngest.** If Inngest stops, the cron receipts stop and the pulse that would report them stops too. Only Netlify scheduled functions (8 of them, including `pulse-hourly`) run outside it. `gap-outside-inngest` and the worklist's lane 12 are the existing answer; the heartbeat of the heartbeat is not closed.
6. **An unregistered function reads as a pending row for ever** (`clarity-insights-sweeper`): the file exists, has a cron, and is not in `functions`, so it is neither running nor flagged.
7. **A swallowed failure is saved as ok**: 16 Inngest cron files return `{ok:false}`; the receipt writes `ok` (map 07-jobs). Netlify jobs do record it.
8. **A "PASS" slice note is plain text.** `alreadyInRegistry` is computed at import and nothing checks the claim against the run (4 false claims found above).

## 6. Not touched
No repo file outside `ops/workflows/zero-unchecked-2026-10-09/` was changed. No commit, push, stash, checkout, ship or deploy. No key value was printed or sent anywhere. The only outbound calls were reads of public Inngest documentation pages.
