# Background jobs — heartbeat gaps

Lane 18. 2026-10-08.

This file names any scheduled job that is missing from `src/pulse/heartbeats.mjs` `JOBS`. A later step may add a row. This lane does not add the row. This lane does not start a second clock.

## Add these rows

None.

Every live scheduled job is already on the list.

- 35 Inngest crons in `src/workflows/index.mjs` match `INNGEST_JOBS`.
- 7 Netlify schedules in `netlify.toml` match `NETLIFY_JOBS`.
- That is 42 jobs in `JOBS`.

Re-counted 2026-10-08 by Claude from the code: `INNGEST_JOBS` 35, `NETLIFY_JOBS` 7, `JOBS` 42. `src/workflows/index.mjs` registers 100 functions: 35 with a cron and 65 event-only. `src/pulse/heartbeats.test.mjs` fails if the list drifts from the registered crons or from `netlify.toml`. The new `job-heartbeats-unlisted` row checks the same thing against what jobs really report.

## Do not add

`clarity-insights-sweeper`

The file `src/workflows/clarity-insights-sweeper.mjs` has a daily cron (`30 7 * * *`). It is not registered in `src/workflows/index.mjs`. It is not in `JOBS`. Do not add the row. A daily run would pull Clarity when nobody asked. The rule is one pull each time Chris asks.

`ad-video-sweeper` (the Inngest copy)

The Inngest function is not registered on purpose. A pass was killed at 26 seconds. The Netlify scheduled function with the same name is already in `NETLIFY_JOBS`. Do not add a second row.

Event-only Inngest functions are not on `JOBS` on purpose. There are 65 of them. A heartbeat row is for a schedule. An event job has no schedule. When one throws, the row sits in `failed_events`. `src/pulse/coverage/gap-jobs.mjs` reads that table in the morning. Do not add a heartbeat row for an event-only job. Do not add another sweeper to watch them.

## What the morning read does

`gapChecks` only reads. It returns 2 rows.

| id | What it reads | FAIL when |
|---|---|---|
| `failed-events` | `failed_events` in the database | A dead-letter row is exhausted, or still pending and already late, and is not a test row |
| `job-heartbeats-unlisted` | `job_heartbeats` for the last 3 days against the names in `JOBS` | A job reported a run but is not on the list |

- A `doc-check` pending row waits until it is late by 3 times the 20 minute retry sweeper. That sweeper is already the clock for those rows.
- A row whose payload email is on a name that can never get mail (`example.com`, `.test` and the like) came from a test walk. It is counted and left out of the failure.
- A job that is late, or whose last run ended in an error, is the job heartbeat check's work. The daily pulse already runs it. This lane does not repeat it.
- It does not retry a job. It does not drain the dead-letter queue.

## Test

`node --test src/pulse/coverage/gap-jobs.test.mjs`

Without a database: 13 tests, 13 pass, 0 fail. The 7 Postgres-engine tests skip (no `DATABASE_URL`).

With `DATABASE_URL`: 20 tests, 20 pass, 0 fail. Those 7 run the real `STUCK_SQL` and `UNLISTED_SQL` on made-up rows (a read-only SELECT, nothing stored).

## Review — Claude, 2026-10-08

What was wrong:

- The lane gave back one `job:` row for every known job (42 rows), by running the job heartbeat check again. The daily pulse already runs that check. So every job showed twice, once as `job:x` and once as `gap-jobs:job:x`. A late job would have shown twice. And 40 extra PASS rows made the morning count look bigger than it was. That is a copy, and the prompt said no second watchdog.
- `failed-events` was a live FAIL: "24 stuck dead-letter rows". It was a false alarm. All 24 rows are old test walks. Their emails are on `example.test` and `example.com`. They are from 2026-08-12 and 2026-08-21. No new row has come from `onDepositPaidMoney` since 2026-08-21, while 10 deposit events came in on 6, 17, 18 and 19 September. The `product_id` error has not shown up in the table again. The old check would have told Chris "stuck" every morning until someone cleaned the table.
- The break named in the prompt, "a job that is not in `JOBS`", was only a note in this file. Nothing watched for it while the site ran.
- The old test said a failed read must be a skip. A missing table would have been a skip every morning and nobody would see it.

What changed:

- Removed the repeated `job:` rows.
- `failed-events` leaves out test-address rows. It counts them and says so in the PASS line. A real stuck row beside them still fails.
- Added `job-heartbeats-unlisted`. Every cron run writes a heartbeat under its function name. If a name shows up in the last 3 days that is not on `JOBS`, it fails and names the job.
- A missing table or column is now a FAIL. A blip such as a timeout is still a skip with the reason.
- The error text in the FAIL line is scrubbed. An email or a phone number in it shows as `[email]` or `[number]`.

Live result after (production, read only): prod 2 PASS, 0 FAIL, 0 skip. Plain-role and staff-role runs: same. No write was tried.

Broke one thing per run on the live data to prove each row can FAIL: with the test-address filter off, the old behaviour came back as "24 stuck dead-letter rows". With `daily-pulse` taken off the list, `job-heartbeats-unlisted` failed and named it. Both queries were also run on made-up rows in a read-only transaction. Result: 5 real stuck rows found, 3 test rows left out, `notexample.com` counted as real, a doc-check row inside its grace left alone. Unlisted check: 1 of 3 jobs named.

Not done on purpose: the 24 old rows are still `pending`. Marking them ignored is a write. This lane is read only.

Tests: 13 pass, 0 fail. The old file had 8 tests.

Second pass (checker found the SQL was not guarded):

- The 13 tests above use a fake db that hands back a ready-made answer. They check the wording. They do not check the SQL. In a scratch copy, `status = 'exhausted'` was changed to `'zzz'`, and `handler_name <> $3` was flipped. All the fake-db tests still passed.
- Added 7 tests that run the real SQL on Postgres over made-up rows. They cover: exhausted, late, no retry time, future retry, resolved, ignored; the doc-check wait (59 minutes late passes, 61 fails, other handlers fail at 30); test-address rows (counted and left alone, a real row beside them still fails, `notexample.com` and `example.com.au` count as real, no email counts as real, upper case is read as lower case); newest real row is the "latest" one; the 3 day window, the job list, and newest first for the unlisted read.
- Proof the new tests have teeth: 14 wrong versions of the SQL were tried one at a time in a scratch copy (status, late rule, null retry time, doc-check wait, test-address rule, count, sort order, 3 day window, job list). All 14 made a Postgres test fail. 0 survived.
- Live result still prod 2 PASS, 0 FAIL, 0 skip.

Known and left alone:

- A stuck `doc-check` row can show twice in the morning: once in `gap-documents` and once here. The other lanes (`gap-documents`, `gap-calls`, `gap-underwrite`) each read one handler. This lane reads every handler, which is what the lane asked for. Nothing else retries a pending row except the doc-check sweeper, so a late pending row really is stuck.
- `job-heartbeats-unlisted` looks back 3 days. A weekly or monthly job that is missing from the list shows for 3 mornings after it runs. `src/pulse/heartbeats.test.mjs` is the main guard for those, because it fails when the list drifts from the registered crons and `netlify.toml`.
