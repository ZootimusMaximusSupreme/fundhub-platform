# Manifest R — run receipts for event workflows (Ship 2)

Branch `build/ZU-R-2026-10-09`, cut from main at `e8e8e086`. Piece R of the zero-unchecked batch. Goal: every workflow that was handed an event shows a real green or a real red, not "not checked".

## Files touched (all on my owned list)

| file | what |
|---|---|
| `db/migrations/478_workflow_runs.sql` | new. Table `workflow_runs`, two indexes, a start marker row, RLS, grants (no DELETE), public keys revoked. Idempotent. |
| `src/pulse/run-evidence.mjs` | new. The "Run evidence" add-on: `createRunEvidence`, `runEvidenceHooks`, `finishFields`, `redactText`, `isNonRetriable`, the two SQL strings and the cap constants. |
| `src/pulse/run-evidence.test.mjs` | new, 38 tests (includes the serve-handler matrix). |
| `src/workflows/client.mjs` | only added the second middleware to the shared client. |
| `src/pulse/workflow-runs.mjs` | rewritten: rules a to h, `SLEEPERS`, two SQL reads. Same exports and row shape as before, plus new ones. |
| `src/pulse/workflow-runs.test.mjs` | rewritten, 60 tests (see "Existing tests" below). |
| `src/pulse/self-audit.mjs` | added `audit:run-recorder`, `RUN_RECORDER_SQL`, `middlewareNames`; `audit:workflow-coverage` now also needs the add-on on the shared client. |
| `src/pulse/self-audit.test.mjs` | +16 tests; 4 existing assertions updated for the new row (see below). |
| `src/pulse/workflow-coverage.test.mjs` | +3 tests (add-on on the client, cancelOn on SLEEPERS). |
| `docs/journeys/heartbeat-flow.md`, `docs/journeys/CHANGELOG.md` | one short section; one line, newest at top. |

Not touched: `src/pulse/heartbeats.mjs`, `src/events/bus.mjs`, `netlify/functions/api.mjs`, `db/expected-migrations.mjs`, `src/pulse/na-conditions.mjs`, `src/pulse/daily-pulse.mjs`.

## What it does, in plain words

1. The first request of a run (no steps remembered, attempt 0) writes a **start mark** (800 ms timer). The last request of an attempt writes a **finish mark** (timer: 20 s minus the time the request already used, kept between 500 ms and 5 s). Both go to `workflow_runs`, upsert on `(run_id, attempt)`.
2. Each row carries `bus_event_id` = `ctx.event.data.id`, the `events.id` the bus sends. So "an event came and nothing started" is judged from the `events` table. No change to `bus.mjs`, no write on the web path.
3. Crons (`inngest/scheduled.timer`) are skipped here. They keep `job_heartbeats`.
4. The morning `wf:` rows read the receipts and say a real green or a real red.

## Exports (exact names and argument shapes)

```js
// src/pulse/run-evidence.mjs
export const RUN_EVIDENCE_NAME = "Run evidence";
export const START_CAP_MS = 800, FINISH_FLOOR_MS = 500, FINISH_CEIL_MS = 5000, REQUEST_BUDGET_MS = 20000;
export const BREAKER_LIMIT = 3, BREAKER_PAUSE_MS = 600000, NOTE_MAX = 120, ERROR_MAX = 120;
export const START_SQL, FINISH_SQL;                       // exact statements, all values bound and cast
export function redactText(value, max = 120) -> string|null  // repo redact() + emails + 40+ char tokens, cut to max
export function isNonRetriable(error) -> boolean          // name NonRetriableError, or a StepError (has stepId)
export function finishFields(result, { attempt = 0, maxAttempts = null })
  -> { outcome: "ok"|"error", final: boolean, skipped: boolean, note: string|null, error: string|null }
export function createRunEvidence({ getDb, nowFn = () => new Date(), log = console.error,
  startCapMs = 800, finishFloorMs = 500, finishCeilMs = 5000, breakerLimit = 3, breakerPauseMs = 600000 })
  -> { hooks: { onFunctionRun }, breaker: { allow, ok, fail, state() -> { fails, openUntil, open } } }
export function runEvidenceHooks(options) -> hooks      // what a middleware's init() returns

// src/pulse/workflow-runs.mjs (new exports; the old ones are unchanged)
export const EVENTS_SQL, RUNS_SQL;                        // the two reads
export const SLEEPERS;                                    // frozen { functionId: longestWaitMs }, 17 entries
export const START_GRACE_MS = 15 min, FAILED_JUDGE_AFTER_MS = 15 min, OPEN_LIMIT_MS = 30 min,
  SLEEPER_SLACK_MS = 1 day, RECEIPTS_GRACE_MS = 1 hour, NO_DEMAND_MIN_WINDOW_MS = 1 day,
  SKIPPED_RUNS_JUDGED = 3, RUNS_PER_FUNCTION = 25, RUN_WINDOW_DAYS = 30, RECORDER_FUNCTION_ID = "_recorder";
export async function checkWorkflowRuns({ db, scope, now, functions, readTimeoutMs })  // unchanged signature

// src/pulse/self-audit.mjs (new)
export const RUN_RECORDER_SQL;
export function middlewareNames(client) -> string[] | null
AUDIT_ROW_IDS.runRecorder = "audit:run-recorder"
```

`auditPulse` returns 8 rows now: the old 7, then `audit:run-recorder` last. The call site in `daily-pulse.mjs` needs no change.

## The rules as built (`checkWorkflowRuns`, first hit wins)

| # | when | status | words |
|---|---|---|---|
| a | no trigger / switched off | `na` `no-trigger` | as before |
| b | newest finished run failed for good, over 15 min ago | `FAIL` | "Its last run failed <time>: <redacted error>. No retry is coming." Younger than 15 min: `skip` "judged once it is 15 minutes old". |
| c | an event over 15 min old, after receipts began (+1 hour), and no run of THIS workflow carries its id | `FAIL` | "3 payment.received events came and this workflow never started (first <time>). The engine did not run it." If the app cannot write receipts: `skip` "receipts are switched off". |
| d | a run with a start mark and no finish: non-sleeper over 30 min; sleeper over its longest wait + 1 day | `FAIL` | "started and never finished" / "asleep too long". Inside the wait: counted as asleep, PASS "waits by design". |
| (retry) | newest finished run is a failure with a retry still coming | `PASS` | "Retrying: attempt 2 of 4 failed ...". Never red. |
| e | last 3 finished runs all `skipped` | `FAIL` | "Every run skipped: <reason>." |
| f | a run finished ok, or one is asleep / running | `PASS` | "Last run started <t> and finished ok <t>." (+ skip reason, + asleep count) |
| g | no event in 3 days and no run | `na` `no-demand` | args `{ names, since }`, `since` = now minus 3 days |
| h | events came and receipts cannot judge them | `skip` | table unreadable (42P01 says so); no start marker; app cannot write; event came before receipts began and receipts are under a day old. Over a day old and nothing since: `na` `no-demand` with `since` = marker + 1 hour (passes `verifyNa`, tested). An event under 15 min old, after receipts began: `PASS` "has 15 minutes to start". |

A cancelled run (all 8 workflows with `cancelOn` are sleepers) stays open and counts as asleep until its wait has passed, same rule d.

Reads: `EVENTS_SQL` (one grouped read of `events`, same shape as before) and `RUNS_SQL` (one read of `workflow_runs` that returns three kinds of row: `run`, `miss`, `meta`). Both run side by side. Together 2 reads for all 65 workflows.

## Decisions I made that the brief did not spell out

1. **Receipts marker.** The migration inserts one row (`function_id = '_recorder'`) with the time receipts began. Without it "an event came and nothing started" would be red for every event that came before the code was live. Events in the first hour after the marker are not judged (the code deploys minutes after the migration runs). `RUNS_SQL` and the audit both ignore the marker row as a workflow.
2. **StepError is final.** A step that used up its retries reaches `finished` as a `StepError` (it carries `stepId`), at `attempt 0` of a new request, so `attempt + 1 >= maxAttempts` is false and the run would read "retrying" forever. Inngest treats it as not retriable. Proved through the real serve handler (test "a step that used up its retries (StepError) is final even on attempt 0 of 4").
3. **`has_table_privilege` in the runs read.** When the app cannot write receipts (the REVOKE switch-off), a missed event is `skip` "receipts are off", not a false "never started".
4. **A start mark is written once per run per container** (a run that opens with parallel steps asks again with nothing remembered).
5. **Booking sleepers are 14 days** (`ai-set-04`, `dpc-02`, `s-04b`; `bs-01` is 21). Measured live: the longest lead on 68 real bookings is 2 days 23 hours. If bookings are ever taken further ahead, raise those four numbers in `SLEEPERS`.
6. **Platform-wide table, no org column**, copied from `job_heartbeats` (430). The brief said "the usual org scoping/RLS pattern copied from 430/475"; 430's heartbeat table has no org column, and a run has no org. Policy `USING (true) WITH CHECK (true)`, grants `SELECT, INSERT, UPDATE` to `fundhub_app`, DELETE and TRUNCATE revoked, `anon` and `authenticated` revoked.
7. `"final"` is quoted everywhere in SQL so no keyword rule can ever read it.

## Existing tests (nothing skipped or deleted)

- `workflow-runs.test.mjs`: I rewrote the file. The old tests encoded Ship 1 behavior that this change replaces on purpose: "an event came: skip with the words 'Run receipts are not switched on yet'", "no row is ever PASS", "one read", "the staff scope is used once", "5 of 65 turn to skip". Each is replaced by a test of the new behavior at the same spot (events came and receipts cannot judge -> skip, now with its reason; no PASS without a run behind it; two reads; two scope calls). Every other old test is kept as it was (no-demand detail and args, two triggers, other workflow's event, dark workflows need no db, crons get no row, read failed, no db, hung read, sync throw, no list, na rows carry code and args, `workflowSince`, `workflowTriggers`, `NOT_LIVE_WORKFLOWS`, real bundle 65 rows). 
- `self-audit.test.mjs`: `briefsDb` now also answers the new recorder read (and does not count it in `calls`, so the morning-report tests still see one read); the "in the contract order" list gained `audit:run-recorder`; the totals line is 15 rows = 13 green (was 14 / 12); the count-mismatch message says 15 rows (was 14). No assertion was loosened.
- `heartbeats.mjs` and its tests are untouched.

## Tests added and how they were proved able to fail

`node --test src/pulse/run-evidence.test.mjs src/pulse/workflow-runs.test.mjs src/pulse/workflow-coverage.test.mjs src/pulse/self-audit.test.mjs` -> 213 tests, 213 pass. Whole `src/pulse` + `src/workflows` + `src/security` + `src/events` + `src/ops`: 3709 tests, 2 fail, both already failing on main (below). `npm run lint` clean. `npx tsc --noEmit`: the same 1 error as main (`src/marketing/filmed-receive.mjs(159,75)`).

**How a workflow's output is proved unchanged** (`run-evidence.test.mjs`): the real `inngest/edge` serve handler is driven with crafted step requests (the engine's own protocol: ask for the next step, run each planned parallel step with its own request, remember every answer, ask again). The workflow has 3 steps and one parallel group of two (4 step bodies, 6 HTTP requests). The whole HTTP transcript (every status and body, timings stripped) and the count of step bodies run must be identical with the add-on off and on, with a database that: works (and then exactly 2 writes: one start, one finish), rejects every write with a permission error (the REVOKE switch-off), throws before it returns (no DATABASE_URL), never answers, answers in 5 seconds, and is read-only (no write lands; only our two INSERT statements are ever tried). The hang cases are held only for their timers (the slowest request is under timer + 400 ms). Also: the real shared client with `DATABASE_URL` removed runs the same function identically to a plain client. Also: throws with the right `final` for attempts 0, 2 and 3 of 4; `{ ok: false }` and `{ skipped: true }` returns; a cron run writes nothing.

Mutation checks I ran (each reverted; all killed by at least one test): no timer on the write; breaker never opens; cron runs also written; start mark on every request; StepError not final; db answering without a promise counted as a failure; `onFunctionRun` not wrapped; `finished` not wrapped; rule c off; sleeper judged at 30 minutes; retry judged red; rule e using `some`; the no-demand claim made under a day; recorder ignoring UPDATE; workflow-coverage ignoring the add-on. Two survivors at first (sync throw not wrapped, `onFunctionRun` not wrapped) needed two new tests; I added them.

`SLEEPERS` is guarded by a test that reads the bundled workflow files (test code, not server code): every event workflow whose file reaches `step.sleep`, `sleepUntil` or `waitForEvent` must be on the map, nothing else may be, and a workflow with `cancelOn` must be on it. Two functions share a file with a sleeper but never sleep (`slo-genuine-reply`, `slo-genuine-checkout-sms`); they are named in the test with a reason.

## Failures in the full suite that are NOT mine

`npm test` (no `DATABASE_URL`): 19,663 unit tests, 14 distinct failing tests (the runner's own count says 16). I ran the same files on a clean copy of main (`git archive main`): 13 of the 14 fail the same way there (identical messages, only the path differs): `scripts/daily-pulse.test.mjs --db hands the pulse ...`, `docs/diagrams is in sync`, `the journeys are not stale`, `climate page ...`, `every read endpoint scopes to the caller's company`, the three journey-runner registry tests, `fence: nothing reaches the network ...`, `registry: every registry row names a real handler or desk file` (the git-excluded leads file), `registry_add_ad`, `dispatch and checks`, and `index serves exactly the workflows on disk ...` (it fails because `pulse-instant-watch` is registered in `src/workflows/index.mjs` and not named in `EXPECTED_WORKFLOW_IDS` in `src/workflows/index.test.mjs`; not my file, left alone). The 14th is `the expected list is exactly what db/ holds`: it fails on my branch because migration 478 is not in `db/expected-migrations.mjs`. That is the integrator's `npm run migrations:manifest`, as ordered.

## What I could not verify (read this)

- **The migration has never run.** There is no local Postgres. I did not run it anywhere. I checked the table-reading SQL (`RUNS_SQL`) against the LIVE `events` table in a read-only transaction, with `workflow_runs` stood in by a VALUES CTE: the grammar, the column types of the `UNION ALL`, `DISTINCT ON` with the window `min`, the `row_number` cap and the miss join all ran (the miss branch returned the live `payment.received` and `message.inbound` events when the marker was set 4 days back). `has_table_privilege(current_user, 'public.workflow_runs', ...)` was checked on `job_heartbeats`, and the `to_regclass` form returns NULL for a missing table. The `CREATE TABLE` / policy / grant text itself was written by copying 430 and 475 and was not parsed by a server. The `rls-shape` and `superuser-guard` static tests pass.
- **`npm run pulse:prove` was not run** (it builds the real Netlify bundle and reads live data; the integrator runs it). `run-evidence.mjs` imports only `../lib/outbound-fetch.mjs` and `./heartbeats.mjs`, both already in the live bundle.
- **No live event has run through the add-on.** None of the 22 trigger events has fired since 10-07. The first real run will be a customer's. That is why the no-deploy switch-off and the breaker exist, and why `audit:run-recorder` watches for "events came, nothing recorded". The integrator's canary (decision 5 in the critic) is still the only live proof.
- **Inngest's real retry timing.** Rule d fails a workflow that does not sleep when a run is open over 30 minutes (the brief's number). A step that fails and retries with Inngest's own backoff leaves the run open with only a start mark between attempts (no `finished` fires for a step). If a backoff pushes past 30 minutes, that workflow reads a false "started, never finished". I could not measure Inngest's backoff here. Watch for it in the first days.

## Known limits (honest list)

- The five workflows that were handed events on 10-07 (`ar-collections`, `ds-02-diy-letters`, `slo-paid-form-nudge` on `payment.received`; `dpc-03-inbound-reply-router`, `slo-genuine-reply` on `message.inbound`) were handed them **before** receipts exist. Nothing can say whether they ran, and I will not paint them green. Their events leave the 3-day window on their own: the three `payment.received` ones (last event 10-07 07:07 UTC) are already `na` by the 6 a.m. pulse on 10-10; the two `message.inbound` ones (event 10-07 16:50 UTC) read `skip` ("came before run receipts began") on that one morning and are `na` from the next. If the ship happens later than 10-10 morning, the same rule gives the same answer one day later.
- A **new** workflow whose trigger event already came in the 3 days before it was added (after receipts began) reads "never started" until those events age out.
- An event emitted with `skipInngest: true` for one of the 22 trigger names would read "never started". Today none does (critic item 5).
- A workflow body that returns `{ ok: false }` at the top level is recorded as a final error (red) until a later run is ok. Many step helpers return `{ ok: false, reason }`; only the workflow's own final return counts. Watch the first mornings for workflows that return it as a normal "nothing to do".
- A non-final error that never gets its retry (lost finish write) reads "retrying" forever (PASS). The brief says never red; the start-mark rule d only catches runs with no finish at all.
- 20 workflow files return `{ skipped: true }`; rule e only fires after three in a row.

## Requests for others (I did not edit their files)

- **Integrator:** run `npm run migrations:manifest` (the `health-migrations` test goes green). Ship order matters little: migration runs first on production; the code that writes receipts deploys minutes later; the marker + 1 hour grace covers that gap.
- **Integrator:** `scripts/pulse/prove.mjs` could assert `audit:run-recorder` is not `skip` after ship, and that `workflow_runs` gets a row when the canary fires. Add `wf:` to `isPingId` in `src/pulse/tripwires.mjs` (already on your list).
- **Integrator, first 60 minutes after ship:** watch for `[run-evidence]` lines in the Netlify function log (a `paused` line means the database did not answer), `workflow_runs` rows with `outcome = 'error'`, and `/api/inngest` error rate. If anything looks wrong: `REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app;` first, then read. The workflows keep running.
- **Owner of `src/workflows/index.test.mjs`:** add `pulse-instant-watch` to `EXPECTED_WORKFLOW_IDS` (already failing on main).
- **Owner of `src/pulse/heartbeats.mjs`:** the cron path still has no timer on `recordHeartbeat` (the critic's cap idea); I did not touch it, as ordered.

## Left undone

Nothing on my list. Not built (out of scope here): the canary function, the hourly `pulse-self` beat, cron timer in `recordHeartbeat`.
