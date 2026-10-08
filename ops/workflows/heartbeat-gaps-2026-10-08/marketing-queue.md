# Marketing job queue gaps

Fundhub. The marketing machine's job queue (`marketing_jobs`): script writing, research, the weekly batch chores, funnel pushes. Read only. Recon (AG-07) is the one tripwire. No second watchdog. Do not start a paid model run.

This lane does not watch Meta spend sync or `meta_load` jobs. Slice 4 and the ads lane own that. This lane does not repeat slice 3 (the marketing clock, the worker, page seen, and the outbox drain).

It does not use a list of job kinds. Every kind except `meta_load` is watched, so a new kind is covered the day it lands.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-marketing-queue.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | Break | FAIL when |
|---|---|---|
| `marketing-queue:stuck-queued` | Job stuck queued past the wait | A job is still `queued` and `run_after` is older than 45 minutes. That is 3 times the 15 minute marketing clock. The kinds are named in the detail. |
| `marketing-queue:failed-no-note` | Failed job with no note | A job that failed in the last 7 days has a blank error, or a note that only says "no reason recorded". (The database already refuses a blank note; the placeholder `jobs.mjs` writes when a handler throws with no message is the real trigger, also when wrapped in "Tried 3 times...".) |
| `marketing-queue:read-api` | Marketing job read API 500 | One GET of `/api/marketing/health` answers 5xx or 404 (or cannot be reached), **or** one of the SELECT readers that route runs throws. A missing `marketing_jobs` table is `skip` (the door answers not ready, not 500). |

Without a database the first two are `skip`. Without a fetch and a database, `read-api` is `skip`. It never passes on nothing.

`ctx` is what the pulse passes: `{ db, scope, orgId, now, fetchImpl | fetch, baseUrl }`. The staff scope is used when given. With no `orgId` the default company is looked up.

The read-API check does **not** call the handler. The handler writes a settings row and a `page_seen` beat on every read. Instead it runs the same readers the handler runs (heartbeats, job counts, outbox, last sync, newest batch, model cost, and the pure `healthView`), as staff, in one read-only pass.

A FAIL names Recon (AG-07) and does not add another watcher. It does not start a model.

## Files

- `src/pulse/coverage/gap-marketing-queue.mjs`
- `src/pulse/coverage/gap-marketing-queue.test.mjs`

## Prove

`node --test src/pulse/coverage/gap-marketing-queue.test.mjs`

- tests 18
- pass 18
- fail 0
- skipped 0

Wired into the pulse by `run-slices.mjs` (it loads every `gap-*.mjs`).

## Review — Claude, 2026-10-08

**What was wrong**

- `read-api` read two source files with `fs.readFileSync` (`netlify/functions/api.mjs`, `api/marketing/health.mjs`). A deployed Netlify function is a bundle that carries only what `netlify.toml` `included_files` lists, and that list holds neither file. So it would most likely have read ENOENT and printed "route is dead" as a FAIL on every real morning. (Not run on the live function. The laptop test passed because the files are there.)
- Even where the files exist, it checked source text, not whether the route works, and the SQL it ran was its own count, not what the route runs.
- `failed-no-note` matched the placeholder only when it was the whole note. After 3 tries `jobs.mjs` wraps it ("Tried 3 times... Last error: failed, no reason recorded"), so that case slipped through. It also looked at all history, so one old row would keep it red forever.
- A kind list (`write_slot, fix_script, funnel, avatar, flywheel_stage, deep_research, offer`) left out `start_batch`, `finish_batch`, `release_batch`, `funnel_push` and the other chores. The one failed job on file today is a `funnel_push` (ClickFunnels put failed 2026-10-06), so no check could ever have seen it.
- With no `orgId` in the context, two of three rows skipped. With no fetch and no database, `read-api` still said PASS from the source text.
- It read with the plain db handle, not the staff scope.

**What changed**

- `read-api`: one GET of the live route (401 is the signed-out answer and counts as up; 404, 5xx and unreachable are FAIL), plus the real readers run as staff. No file reads at runtime. `jobReadRouteAlive` stays for the repo test only.
- `failed-no-note`: matches the placeholder anywhere in the note, looks back 7 days, names the kinds.
- `stuck-queued`: all kinds except `meta_load`, names the kinds.
- Default company lookup, staff scope, 10 second timeout, `fetch`/`fetchImpl` and `baseUrl` honored.
- Tests: 9 became 18, answering by SQL text. One test records every statement of a full run and asserts none writes. One asserts `jobs.mjs` still writes the placeholder this check looks for.

**Live proof (read-only)**

- Prod mode: 3 PASS, 0 FAIL, 0 skip. Staff mode and bare mode match. No SQL errors, no writes. The 11 reads of the health card ran against the real database. The route answered 401.
- The SQL was run on real rows. With the status swapped to `done` the stuck query counts 6 jobs and names `avatar, finish_batch, funnel, release_batch, start_batch, write_slot`; with every kind skipped it counts 0. The failed query, given a pattern that matches the real note, finds the one `funnel_push` job (2 days old) in a 30 day window and nothing in a 1 day window.

**Left for Chris**

- The `funnel_push` job that failed on 2026-10-06 has a note, so it is not a "no note" case. It is not retried or fixed here.
