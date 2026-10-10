# Client success gaps

Fundhub. Client success queue only. Read only. Do not text clients.

Recon (AG-07) is the one tripwire. No second watchdog.

Slice 30 already checks the owner desks, the sales manager desks, and whether the client success doors are on the morning list. The registry rows `reg:read/csm-queue` and `reg:csm-queue` already go red when the queue door or the queue page stops answering. This lane does not check those again.

## Checks

`gapChecks(ctx)` in `src/pulse/coverage/gap-csm.mjs` returns 3 rows. Shape is `{ id, status, detail, suggestedFix }`. Status is `PASS`, `FAIL`, or `skip`.

| id | What it reads |
|---|---|
| `csm:queue-api` | Runs the queue's own GET handler (`api/read/csm-queue.mjs`) in the pulse as a read-only owner, asking for 1 row. That runs the queue's real SQL and its real row mapping. A throw, a non-200, or a body that is not a list is a fail. |
| `csm:overdue-unassigned` | Open client success tasks more than 1 day past due with nobody assigned. Demo rows are left out. A task with no due time is not overdue. |
| `csm:missing-step` | A client who paid (`deposit.paid`, `sale.closed`, `payment.received`) must have the halfway accountability call. A client who was funded (`round.funded`) must have the results accountability call. Events from the last 60 days, older than 10 minutes. Demo rows left out. |

## Rules kept

- Do not text clients.
- Read only. No POST. No file reads.
- One tripwire: existing Recon (AG-07). No second watchdog.
- HTML was not edited.
- Owner desks from slice 30 were not checked again.

`ctx` is `{ db, orgId, now, queueHandler? }`. No database skips all three. The workflow names (`customer-insights-mid`, `customer-insights-post`) are imported from `src/handlers/customer-insights.mjs`, not copied.

## Files

- `src/pulse/coverage/gap-csm.mjs`
- `src/pulse/coverage/gap-csm.test.mjs`

## Test

`node --test src/pulse/coverage/gap-csm.test.mjs`

## Review — Claude, 2026-10-08

**What was wrong**

- `csm:queue-api` and `csm:missing-step` read source files (`netlify/functions/api.mjs`, `api/read/csm-queue.mjs`, `src/handlers/customer-insights.mjs`, `src/register-all.mjs`) from disk to see if things were "wired". The shipped function has no source files. In production both would have said FAIL every morning.
- The "queue read" was a hand copy of part of the query. It never ran the real SQL or the real row mapping. A change to the real query would not have been seen.
- The GET to `/api/read/csm-queue` repeated `reg:read/csm-queue`, and it only ever got a 401 (no login), so it proved nothing past "the route exists".
- `csm:missing-step` only knew the halfway call. The results call after funding was not checked at all. It also had no wait and no date window: an event a second old, or one from a year ago, counted.
- `csm:overdue-unassigned` flagged a task one minute late. A task due at 5am is not "nobody is on it" at 6am.
- The old tests returned a made-up count. They never ran the SQL.

**What changed**

- `csm:queue-api` now runs the real handler in the pulse, as a read-only owner, against the real database. It proves the real query and the mapping work.
- `csm:missing-step` checks both calls, reads only the database, and imports the workflow names. 10 minute wait, 60 day window.
- `csm:overdue-unassigned` waits 1 day before it counts a task.
- Reads no repo file. Tests now include a block that runs the real SQL and the real queue handler on Postgres over fixture rows (skips without `DATABASE_URL`).

**Live proof (read-only, as `fundhub_app` inside `BEGIN READ ONLY`)**

- Prod mode: 3 PASS, 0 FAIL, 0 skip. Staff mode matches. No SQL errors. No writes.
- `csm:queue-api` ran the real queue query on production and it answered 200.
- Why the other two are PASS: the database holds 36 open halfway calls for 36 clients, due between 2026-12-29 and 2027-01-05, none overdue. Every client who paid has theirs. No client was funded yet (4 `round.funded` events, all demo).
- Fixture run on the real engine: 27 cases, all matched. Overdue and unclaimed is FAIL; claimed, done, demo, inside the day, other role, and no date are PASS. A paid client with no halfway call is FAIL for each of the three events. A funded client with no results call is FAIL. A halfway call does not stand in for the results call. Young events, old events, demo, and clientless events are PASS. A handler that throws or answers 500 is FAIL.
- Tests: 12 pass, 0 fail without a database. 16 pass, 0 fail with `DATABASE_URL`.

**Left for Chris (not a check problem)**

- "Nobody is assigned" means the task has no `assignee_staff_id`, the same meaning the queue uses ("nobody has taken it"). A client who already has a named client success person still shows up if the task is a day late and nobody has claimed it. Today 1 of the 36 open halfway calls is for such a client (none are overdue yet).
- The route being wired in `netlify/functions/api.mjs` is no longer read from source. If the route is removed, the registry row `reg:read/csm-queue` turns red (a 404 is down). That is the one watcher for it.

## Second pass — Claude, 2026-10-08

- The checker found this board was stale: it listed a file-reading `readText`, "a missing route still fails", and "9/9" tests. It now matches the code: 3 checks, no file reads, no fetch.
- Code did not change this pass. Live: prod 3 PASS, 0 FAIL, 0 skip; staff mode matches; bare 0 PASS, 0 FAIL, 3 skip. No SQL errors, no writes.
- Tests: 12 pass, 0 fail without a database. 16 pass, 0 fail with `DATABASE_URL`.
