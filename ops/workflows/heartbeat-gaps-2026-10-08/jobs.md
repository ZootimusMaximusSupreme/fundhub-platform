# Background jobs — heartbeat gaps

Lane 18. 2026-10-08.

This file names any scheduled job that is missing from `src/pulse/heartbeats.mjs` `JOBS`. A later step may add a row. This lane does not add the row. This lane does not start a second clock.

## Add these rows

None.

Every live scheduled job is already on the list.

- 35 Inngest crons in `src/workflows/index.mjs` match `INNGEST_JOBS`.
- 7 Netlify schedules in `netlify.toml` match `NETLIFY_JOBS`.
- That is 42 jobs in `JOBS`.

## Do not add

`clarity-insights-sweeper`

The file `src/workflows/clarity-insights-sweeper.mjs` has a daily cron (`30 7 * * *`). It is not registered in `src/workflows/index.mjs`. It is not in `JOBS`. Do not add the row. A daily run would pull Clarity when nobody asked. The rule is one pull each time Chris asks.

`ad-video-sweeper` (the Inngest copy)

The Inngest function is not registered on purpose. A pass was killed at 26 seconds. The Netlify scheduled function with the same name is already in `NETLIFY_JOBS`. Do not add a second row.

Event-only Inngest functions are not on `JOBS` on purpose. There are 65 of them. A heartbeat row is for a schedule. An event job has no schedule. When one throws, the row sits in `failed_events`. `src/pulse/coverage/gap-jobs.mjs` reads that table in the morning. Do not add a heartbeat row for an event-only job. Do not add another sweeper to watch them.

## What the morning read does

`gapChecks` only reads.

- It fails when a dead-letter row is exhausted, or still pending and already late.
- A `doc-check` pending row waits until it is late by 3 times the 20 minute retry sweeper. That sweeper is already the clock for those rows.
- It fails when the existing heartbeat check says a known job has no recent run.
- It does not retry a job. It does not drain the dead-letter queue.
