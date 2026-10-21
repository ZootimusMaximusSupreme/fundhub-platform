# Inngest diet — 2026-10-20

Owner (Chris, 2026-10-20 ~20:40 Arizona): "ingest is maxed out i cant afford 99 a month, stop burning ingests".

Goal: Inngest use well under the free plan, at $0. Every cron job runs again, on Netlify.

Split: one lane (this session, `claude/sad-bose-842ac9`). The move touches the same files
(workflow list, heartbeat list, tripwire map, netlify.toml), so two writers would clash.
Read-only helpers only. No parallel prompts for this batch.

| Unit | Owner | Status |
|---|---|---|
| 1. Measure: Inngest free limits, every cron, every event workflow | this session | done |
| 2. Netlify clock + background worker; crons off Inngest | this session | done |
| 3. Heartbeat law: JOBS, tripwires, beats, tests | this session | done |
| 4. Lint, typecheck, tests, pulse:prove, PR, merge | this session | in progress |
| 5. Coordinator ships; confirm runner='netlify' receipts live | coordinator, then this session | pending |

## The free plan (read 2026-10-20 from https://www.inngest.com/pricing)

- **50,000 executions a month.** A run counts 1, and each step inside it counts 1 more
  (Inngest's own example: a function with five `step.run()` calls uses six).
- Events: 500,000 a month (separate count; we send about 7,000).
- At the cap the free plan **pauses**. No overage. Paying is the only way to resume.

## What we were using (measured)

Live receipts (`job_heartbeats`, runner `inngest`) show about 65 cron runs every 15 minutes.
Inngest stopped at 01:20 UTC 2026-10-21 and came back at about 02:15 UTC (cause unknown from
here; it will stop again at the cap).

Per cron, at runs × (steps + 1), 30-day month:

| Job | Schedule | Runs a month | Steps a run | Inngest use a month | Netlify fallback before this change |
|---|---|---:|---:|---:|---|
| commas-inbox-drain | `* * * * *` | 43,200 | 1 | 86,400 | commas-inbox-sweeper (every minute) |
| whop-billing-inbox-drain | `* * * * *` | 43,200 | 1 | 86,400 | whop-billing-inbox-sweeper (every minute) |
| message-dispatch-sweeper | `*/5 * * * *` | 8,640 | 1 | 17,280 | staff-message-sweeper (staff rows only) |
| next-action-catch-up | `*/5 * * * *` | 8,640 | 1 | 17,280 | none |
| pulse-instant-watch | `*/5 * * * *` | 8,640 | 1 | 17,280 | none (pulse-outside-watch only watches it) |
| blake-lead-watch | `*/5 * * * *` | 8,640 | 1 | 17,280 | none |
| meet-transcript-sweeper | `*/10 * * * *` | 4,320 | 1 | 8,640 | none |
| af-01-affiliate-drip | `*/15 * * * *` | 2,880 | 1 | 5,760 | none |
| affiliate-payout-autopay | `*/15 * * * *` | 2,880 | 1 | 5,760 | none |
| finance-os-money-transfers | `*/15 * * * *` | 2,880 | 1 | 5,760 | none |
| inquiry-call-sweeper | `*/15 * * * *` | 2,880 | 1 | 5,760 | none |
| doc-check-retry-sweeper | `*/20 * * * *` | 2,160 | 1 | 4,320 | none |
| hiring-outreach-cadence | `*/30 * * * *` | 1,440 | 1 | 2,880 | none |
| invoice-checkout-retirement-sweeper | `*/30 * * * *` | 1,440 | 1 | 2,880 | none |
| invoice-sent-recovery | `*/30 * * * *` | 1,440 | 1 | 2,880 | none |
| blueprint-closer-ready-sweeper | `0 * * * *` | 720 | 1 | 1,440 | none |
| meta-campaign-sync-hourly | `30 * * * *` | 720 | 1 | 1,440 | none |
| paid-checkout-expiry-sweeper | `0 * * * *` | 720 | 1 | 1,440 | none |
| subscription-billing-sweeper | `17 * * * *` | 720 | 1 | 1,440 | none |
| waypoint-nudge-sweeper | `0 * * * *` | 720 | 1 | 1,440 | none |
| daily-pulse | `TZ=America/Phoenix 0 6 * * *` | 30 | ~40 | 1,230 | none |
| 18 more daily jobs | daily | 30 each | 1–3 | 60–120 each | none |
| affiliate-payout-run, partner-production-floor | monthly | 1 | 1 | 2 each | none |
| **All 40 crons** | | | | **≈ 296,000** | |

Six times the free plan. The two every-minute payment drains alone were 172,800.

Event workflows (65 functions, triggered by `emit()` → `inngest.send`): about **3,700 a month**,
from the last 30 days of the `events` table × the step calls in each file (an upper bound per run).
Heaviest: slo-genuine-reply (≈1,400), s-nobook-chase (≈500), dpc-03-inbound-reply-router (≈450),
the five entry.captured workflows (≈250–350 each). Note: the fake-data cleanup earlier today removed
test events, so this is real traffic, and it grows with real leads.

## The change

- **No cron runs on Inngest any more.** `src/workflows/index.mjs` serves only event workflows.
  A guard test fails if a cron ever goes back into that list.
- **One Netlify clock, `netlify/functions/cron-clock.mjs`, every 5 minutes.** It reads the
  job table (`src/workflows/scheduled.mjs`: the same Inngest function objects, so the same
  job id, the same schedule and the same job body) and starts each job that is due in this
  5-minute slot.
- **Each job runs in `netlify/functions/cron-worker-background.mjs`** (a background function:
  15 minutes, so the 26-second cut is gone). It runs the job's own handler, with a small
  stand-in for Inngest's `step` (each step retried up to 3 times, like Inngest does), and writes
  the job's receipt to `job_heartbeats` with runner `netlify` under the same job id.
- **Retired, because a Netlify copy already existed:** `commas-inbox-drain` →
  `commas-inbox-sweeper`, `whop-billing-inbox-drain` → `whop-billing-inbox-sweeper`.
- **Slowed:** those two payment sweepers, every minute → every 5 minutes (no written owner rule
  needs faster). Their hourly beats now call them stale at 15 minutes (3× the schedule).
- Worker door: a signed header (`CRON_WORKER_SECRET`, new; set in `.env`, the credentials
  snapshot and Netlify without `--secret`) plus a fresh 5-minute slot. Anyone else gets 401.

## After the change

| | Inngest use a month |
|---|---:|
| Crons | 0 |
| Event workflows | ≈ 3,700 |
| **Total** | **≈ 3,700 of 50,000 (about 7%)** |

Netlify gets lighter too: Inngest used to call `/api/inngest` once per step (≈ 300,000 calls a
month into the big api function). The clock is ≈ 8,600 small calls a month plus one worker call
per job run (≈ 75,000), and the two payment sweepers drop from 86,400 to 17,280.

## Manifest

Files: see the PR. Routes: none. Journeys: none change for a customer. Heartbeat: every moved
job keeps its `job:` row (runner now `netlify`); new `job:cron-clock`; tripwires sorted for every
scheduled job whatever its runner.

## Blockers / questions

None.
