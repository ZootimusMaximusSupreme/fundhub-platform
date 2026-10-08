# Marketing job queue gaps

Fundhub. Ad scripts, research, and write jobs only. Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not start a paid model run.

This lane does not watch Meta spend sync. Slice 4 owns that. This lane does not repeat slice 3 (the marketing clock, the worker, page seen, and the outbox drain).

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-marketing-queue.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | Break | FAIL when |
|---|---|---|
| `marketing-queue:stuck-queued` | Job stuck queued past the wait | A script, research, or write job is still `queued` and `run_after` is older than 45 minutes. That is 3 times the 15 minute marketing clock. Meta load jobs are left out. |
| `marketing-queue:failed-no-note` | Failed job with no note | A failed job of those kinds has a blank error, or the saved note is only the empty placeholder. |
| `marketing-queue:read-api` | Marketing job read API 500 | GET `/api/marketing/health` answers 500, the route is not wired, or the job-count query throws. A missing `marketing_jobs` table is `skip` (the door answers not ready, not 500). |

No database in the run: the two row checks are `skip`. The route check still runs.

A FAIL names Recon (AG-07) and does not add another watcher. It does not start a model.

`ctx` is `{ db, orgId, now, readText, fetchImpl, baseUrl }`.

## Files

- `src/pulse/coverage/gap-marketing-queue.mjs`
- `src/pulse/coverage/gap-marketing-queue.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-marketing-queue.test.mjs`

- tests 9
- pass 9
- fail 0
- skipped 0

Not wired into the shared pulse runner. That file was left alone.
