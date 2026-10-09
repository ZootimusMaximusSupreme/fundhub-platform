# Manifest R — run receipts for event workflows (Ship 2)

Round 1: branch `build/ZU-R-2026-10-09`, cut from main at `e8e8e086`, commit `5cb82500`.
Round 2 (checker repairs): branch `build/ZU-R-r2-2026-10-09`, cut from `5cb82500`. Read "Round 2" first; the rest is the round 1 manifest, corrected where round 2 changed it.

Goal of piece R: every workflow that was handed an event shows a real green or a real red, not "not checked".

## Round 2 — what the checker found and what I did

| # | severity | finding | what I did | proof |
|---|---|---|---|---|
| 1 | high | A repeat funnel post (`survey.submitted`, `entry.captured`) is stored with `skipInngest: true`, so no run can carry its id. Rule c called it "never started". Six workflows would go red the morning after any ad day. | `RUNS_SQL` miss branch now leaves out a repeat post: same org, name, address (any case) and funnel, an earlier `events` row inside 6 hours (`REPEAT_POST_SQL`, built from `REPEAT_SUPPRESSED_EVENTS` and `FUNNEL_REPEAT_WINDOW_MINUTES`). No address is never a repeat. Words changed (see 2). | Ran the real SQL on a real Postgres (read-only, shadowed rows): 18 scenarios, all pass; removing the rule fails 4 of them. Ran it on the LIVE `events` for 2026-10-01 (read-only): entry.captured 78 events, 65 repeats left out (78 to 13 per workflow); survey.submitted 38 events, 34 left out (38 to 4). Same numbers the checker measured. 67 ms for the read. Static test that the names and the 6-hour window equal `src/adapters/clickfunnels.mjs` (reads the file in test code). |
| 2 | medium | The start mark was tried only on a request with no steps and attempt 0. One lost write meant no row until the run ended; a sleeper was red for days. Rule c's words claimed a cause. | The start mark is now tried on any request of a run this container has not marked yet; a run is marked only after a write lands; `ON CONFLICT DO NOTHING` keeps repeats harmless; `marked` keeps it to one write per run per container. Rule c now says "no receipt shows this workflow started" (no "The engine did not run it"). | New tests: lost first write written on the next request with steps remembered; lost while the breaker is open, written on the first request after the pause; same through the real serve handler. Mutation: putting the old rule back fails 7 tests. |
| 3 | medium | Rule d ignored `canWrite`, and a lost finish write (breaker) read as a lost run. | Rule d: if receipts are switched off (cannot write) and a run is over its limit, the row is `skip` "switched off". A run is called lost (red) only when receipts were still being written after its deadline (`start + limit`): the runs read now returns the newest receipt time of any workflow (meta row, `finished_at`). Otherwise `skip` "receipts may have been paused" (or a PASS note when the workflow finished ok recently). The doc sentence about the switch-off is now true. | PASS/FAIL twins for non-sleeper and sleeper, for `canWrite` false/true and for a receipt at, before and after the deadline. Mutations (ignore canWrite; always "was writing"; off by one; no skip) all fail tests. |
| 4 | medium | `redactText` let phone, SSN, card numbers, short vendor keys, Slack webhooks through. | Added: 7+ digit runs (spaces, dots, dashes, brackets, leading `+` and `(`) become `[number]`; `sk_live_`, `sk_test_`, `pk_`, `rk_`, `whsec_`, `xox?-`, `ghp_` style, `AKIA...`, `sk-...` keys; Slack and `/webhooks/` URLs; URL passwords; URL query strings and fragments. A uuid is set aside first so an all-digit id stays readable (the existing test needs that). | One FAIL/PASS test per shape, all probed shapes from the checker; each rule removed fails a test. |
| 5 | medium | Nothing ran on a real Postgres. | New `src/pulse/run-evidence.pg.test.mjs` (CI runs it; a skipped pg test is not green). Part 1 (any database, read-only): `RUNS_SQL` on made-up rows, 18 tests. Part 2 (loopback only, always rolled back): migration 478 applied, grants, START then FINISH, FINISH twice, a second attempt, DELETE and TRUNCATE refused (42501), CHECKs, the REVOKE switch-off (42501, hooks quiet, breaker opens, meta flag flips to 0). | Part 1: run here against the live database, read-only: 18 of 18 pass. The whole 478 file and both write statements were also parsed by the live server in a read-only transaction: clean parse (the file stops at the read-only error, the statements at "relation does not exist"; a deliberately broken file gives a syntax error, so the check can fail). Part 2: NOT run, see "What I could not verify". |
| 6 | low | Times in UTC. | `minuteOf` and `dayOf` use the Arizona clock (`phoenixClock`, `phoenixTimeWords` from `quiet-hours.mjs`): "2026-10-12 7:05 a.m. Arizona time". | Test for morning, afternoon, evening-before-in-UTC, 12:xx a.m., and no "UTC" left. |
| 7 | low | An error saved as "retry coming" with no max attempts never became final. | The reader treats it as final when `attempt + 1 >= max_attempts`, or when it is older than a day (`RETRY_GIVE_UP_MS`). Words: "No retry was saved after it." | Tests for old, fresh, last-attempt and not-last-attempt. |
| 8 | low | Booking sleepers fixed at 14 / 21 days. | NOT changed. There is no calendar setting in this repo to read (the calendar lives outside it), and judging by the booking's start time needs an events join in the runs read, which is not trivial. Evidence I re-measured today on the live `events`: 68 `booking.created` events, longest lead 2 days 23 h 59 m, median 21 h. That is a hard stop right under 3 days, so the calendar looks capped at 3 days; 14 and 21 days are about 5 and 7 times that. If the calendar window is ever opened past 14 days, raise `SLEEPERS` for `ai-set-04`, `dpc-02`, `s-04b` (14) and `bs-01` (21). | none (not changed) |
| 9 | low | Two log lines when the breaker opens. | Accepted, as the finding allows: a lone failure logs one short line (at most one a minute), then the "paused" line when it opens. I changed the header comment to say exactly that; the brief's "one line" meant the opening line. No test changed. | existing breaker test |
| 10 | low | Words not 4th grade in `audit:run-recorder`. | Detail now reads "the app is not allowed to save run receipts, so the workflow rows cannot tell if work ran". The privilege names and the GRANT line moved to the fix line (for agents). | `self-audit.test.mjs` asserts the plain words and that the detail has no INSERT/UPDATE/blind. |

### Existing tests I changed in round 2 (nothing deleted, skipped or loosened)

Each was encoding a rule the finding replaces on purpose, or a string the finding asked to change.

- `run-evidence.test.mjs`
  - "no start mark when steps are remembered, on a retry, ..." became "the start mark is written once per run on the first request this container sees (whatever steps are remembered), and never for a cron or a run with no id". It still asserts: no second write once marked, no write for a retry on the same container, a cron, a run with no id, a bad call. It now also asserts the first write happens with steps remembered.
  - The three finish-mark tests (`the finish mark: one upsert ...`, `... a failed attempt ...`, `the finish timer ...`) now pick the FINISH statement out of the calls (a start mark can now come first on a container that has not seen the run). Every field they checked, they still check.
  - Serve handler, "rejects every write", "never answers": the number of tries is now `BREAKER_LIMIT` (3 start marks, then the breaker is open and the finish mark is not even tried) instead of 2 (one start, one finish). Transcript and step-count equality, and the timer bounds, are unchanged.
  - Serve handler, "read-only database": was "the set of statements tried equals {START, FINISH}"; now "at least one was tried, and every one is START or FINISH, and every one is an INSERT into workflow_runs". With the breaker opening on three start marks, the finish statement may never be reached. Still proves only our two statements are ever sent.
  - Renamed the first start-mark test title (it says "the first request of a run").
- `workflow-runs.test.mjs`
  - Strings: UTC times became Arizona times; "this workflow never started ... The engine did not run it." became "no receipt shows this workflow started" (4 expected strings, 3 regexes).
  - The fake database now answers the meta row with a `finished_at` (newest receipt time) that defaults to one minute ago ("receipts are alive"), so every old test sees the same world as before; `runRow` can now be given `max: null`.
- `self-audit.test.mjs`: the run-recorder privilege test asserts the new plain detail, and the privilege names in the fix line.

## Files touched (round 1 + round 2, all on my owned list)

| file | what |
|---|---|
| `db/migrations/478_workflow_runs.sql` | new in round 1. Unchanged in round 2. Table `workflow_runs`, two indexes, a start marker row, RLS, grants (no DELETE), public keys revoked. Idempotent. |
| `src/pulse/run-evidence.mjs` | the "Run evidence" add-on. Round 2: start mark on any unmarked request; wider `redactText`. |
| `src/pulse/run-evidence.test.mjs` | 46 tests (was 38). Includes the serve-handler matrix. |
| `src/pulse/run-evidence.pg.test.mjs` | new in round 2. Real Postgres. Part 1 read-only (18 tests), Part 2 rolled back, loopback only (7 tests). |
| `src/workflows/client.mjs` | round 1 only: the second middleware on the shared client. |
| `src/pulse/workflow-runs.mjs` | rules a to h, `SLEEPERS`, two SQL reads. Round 2: repeat posts, rule d guard, retry aging, Arizona time, meta newest-receipt time. |
| `src/pulse/workflow-runs.test.mjs` | 71 tests (was 60). |
| `src/pulse/self-audit.mjs` | `audit:run-recorder`, `RUN_RECORDER_SQL`, `middlewareNames`; round 2: plain words. |
| `src/pulse/self-audit.test.mjs` | +16 tests in round 1; one assertion reworded in round 2. |
| `src/pulse/workflow-coverage.test.mjs` | +3 tests (round 1). |
| `docs/journeys/heartbeat-flow.md`, `docs/journeys/CHANGELOG.md` | round 1 section and line; round 2 corrected the diagram and added one more CHANGELOG line (newest at top). |

Not touched: `src/pulse/heartbeats.mjs`, `src/events/bus.mjs`, `netlify/functions/api.mjs`, `src/adapters/clickfunnels.mjs`, `db/expected-migrations.mjs`, `src/pulse/na-conditions.mjs`, `src/pulse/daily-pulse.mjs`.

## What it does, in plain words

1. A run's first request that a container sees writes a **start mark** (800 ms timer). If that write is lost, the next request of the run tries again. The last request of an attempt writes a **finish mark** (timer: 20 s minus the time the request already used, kept between 500 ms and 5 s). Both go to `workflow_runs`, upsert on `(run_id, attempt)`.
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
export function redactText(value, max = 120) -> string|null
  // repo redact() + URL passwords, Slack/webhook URLs, URL query strings, vendor key prefixes,
  // 7+ digit runs -> [number], emails -> [email], 40+ char tokens; a uuid is kept; cut to max
export function isNonRetriable(error) -> boolean          // name NonRetriableError, or a StepError (has stepId)
export function finishFields(result, { attempt = 0, maxAttempts = null })
  -> { outcome: "ok"|"error", final: boolean, skipped: boolean, note: string|null, error: string|null }
export function createRunEvidence({ getDb, nowFn = () => new Date(), log = console.error,
  startCapMs = 800, finishFloorMs = 500, finishCeilMs = 5000, breakerLimit = 3, breakerPauseMs = 600000 })
  -> { hooks: { onFunctionRun({ fn, ctx }) }, breaker: { allow, ok, fail, state() -> { fails, openUntil, open } } }
export function runEvidenceHooks(options) -> hooks      // what a middleware's init() returns

// src/pulse/workflow-runs.mjs
export const EVENTS_SQL, RUNS_SQL;                        // the two reads (RUNS_SQL: $1..$8, unchanged)
export const SLEEPERS;                                    // frozen { functionId: longestWaitMs }, 17 entries
export const REPEAT_SUPPRESSED_EVENTS = ["survey.submitted", "entry.captured"];   // NEW, copied from the adapter
export const FUNNEL_REPEAT_WINDOW_MINUTES = 360;                                  // NEW, copied from the adapter
export const RETRY_GIVE_UP_MS = 1 day;                                            // NEW
export const START_GRACE_MS = 15 min, FAILED_JUDGE_AFTER_MS = 15 min, OPEN_LIMIT_MS = 30 min,
  SLEEPER_SLACK_MS = 1 day, RECEIPTS_GRACE_MS = 1 hour, NO_DEMAND_MIN_WINDOW_MS = 1 day,
  SKIPPED_RUNS_JUDGED = 3, RUNS_PER_FUNCTION = 25, RUN_WINDOW_DAYS = 30, RECORDER_FUNCTION_ID = "_recorder";
export async function checkWorkflowRuns({ db, scope, now, functions, readTimeoutMs })  // unchanged signature

// src/pulse/self-audit.mjs
export const RUN_RECORDER_SQL;
export function middlewareNames(client) -> string[] | null
AUDIT_ROW_IDS.runRecorder = "audit:run-recorder"
```

The `meta` row of `RUNS_SQL` now also fills `finished_at` with the newest receipt time of any workflow (a finish time, or the start time of a run still open). Row shapes of `checkWorkflowRuns` are unchanged.

`auditPulse` returns 8 rows: the old 7, then `audit:run-recorder` last. The call site in `daily-pulse.mjs` needs no change.

## The rules as built (`checkWorkflowRuns`, first hit wins)

| # | when | status | words |
|---|---|---|---|
| a | no trigger / switched off | `na` `no-trigger` | as before |
| b | newest finished run failed for good, over 15 min ago. "For good" also means: the last attempt by `max_attempts`, or no later attempt in a day | `FAIL` | "Its last run failed <Arizona time>: <redacted error>. No retry is coming." (or "No retry was saved after it."). Younger than 15 min: `skip` "judged once it is 15 minutes old". |
| c | an event over 15 min old, after receipts began (+1 hour), not a repeat funnel post, and no run of THIS workflow carries its id | `FAIL` | "3 payment.received events came and no receipt shows this workflow started (first <Arizona time>)." If the app cannot write receipts: `skip` "receipts are switched off". |
| d | a run with a start mark and no finish: non-sleeper over 30 min; sleeper over its longest wait + 1 day | `FAIL` only if receipts were still being written after the run's deadline | "started and never finished" / "asleep too long". App cannot write receipts: `skip` "switched off". No receipt after the deadline: `skip` "receipts may have been paused" (or a note on a PASS when it finished ok recently). Inside the wait: counted as asleep, PASS "waits by design". |
| (retry) | newest finished run is a failure with a retry still coming | `PASS` | "Retrying: attempt 2 of 4 failed ...". Never red. |
| e | last 3 finished runs all `skipped` | `FAIL` | "Every run skipped: <reason>." |
| f | a run finished ok, or one is asleep / running | `PASS` | "Last run started <t> and finished ok <t>." (+ skip reason, + asleep count) |
| g | no event in 3 days and no run | `na` `no-demand` | args `{ names, since }`, `since` = now minus 3 days |
| h | events came and receipts cannot judge them | `skip` | table unreadable (42P01 says so); no start marker; app cannot write; event came before receipts began and receipts are under a day old. Over a day old and nothing since: `na` `no-demand` with `since` = marker + 1 hour (passes `verifyNa`, tested). An event under 15 min old, after receipts began: `PASS` "has 15 minutes to start". |

A cancelled run (all 8 workflows with `cancelOn` are sleepers) stays open and counts as asleep until its wait has passed, same rule d.

Reads: `EVENTS_SQL` (one grouped read of `events`) and `RUNS_SQL` (one read of `workflow_runs` that returns three kinds of row: `run`, `miss`, `meta`). Both run side by side. Together 2 reads for all 65 workflows.

## Decisions I made that the brief did not spell out

1. **Receipts marker.** The migration inserts one row (`function_id = '_recorder'`) with the time receipts began. Without it "an event came and nothing started" would be red for every event that came before the code was live. Events in the first hour after the marker are not judged (the code deploys minutes after the migration runs). `RUNS_SQL` and the audit both ignore the marker row as a workflow.
2. **StepError is final.** A step that used up its retries reaches `finished` as a `StepError` (it carries `stepId`), at `attempt 0` of a new request, so `attempt + 1 >= maxAttempts` is false and the run would read "retrying" forever. Inngest treats it as not retriable. Proved through the real serve handler.
3. **`has_table_privilege` in the runs read.** When the app cannot write receipts (the REVOKE switch-off), a missed event or an open run is `skip` "receipts are off", not a false red.
4. **A start mark is written once per run per container**, on the first request that container sees (round 2: any request, not only the first of the run), and tried again until a write lands.
5. **Booking sleepers are 14 days** (`ai-set-04`, `dpc-02`, `s-04b`; `bs-01` is 21). See item 8 above.
6. **Platform-wide table, no org column**, copied from `job_heartbeats` (430). Policy `USING (true) WITH CHECK (true)`, grants `SELECT, INSERT, UPDATE` to `fundhub_app`, DELETE and TRUNCATE revoked, `anon` and `authenticated` revoked.
7. `"final"` is quoted everywhere in SQL so no keyword rule can ever read it.
8. **Round 2: the repeat-post names and window are copied, not imported.** `REPEAT_SUPPRESSED_EVENTS` is not exported by `src/adapters/clickfunnels.mjs` and I may not edit that file. Importing the adapter would pull all of it into the pulse. A test reads the adapter source and fails when the two stop matching.

## How a workflow's output is proved unchanged

`run-evidence.test.mjs` drives the REAL `inngest/edge` serve handler with crafted step requests (the engine's own protocol), for a function with 3 steps and one parallel group (4 step bodies, 6 HTTP requests). The whole HTTP transcript and the step-body count must be identical with the add-on off and on, with a database that: works (exactly one start and one finish write), rejects every write with a permission error, throws before it returns (no DATABASE_URL), never answers, answers in 5 seconds, is read-only, and loses its first write. The hang cases are held only for their timers. Also: the real shared client with `DATABASE_URL` removed runs the same function identically to a plain client; throws with the right `final`; `{ ok: false }` and `{ skipped: true }` returns; a cron run writes nothing. Round 2 re-ran all of it after the start-mark change.

## Tests

- `node --test src/pulse/run-evidence.test.mjs src/pulse/workflow-runs.test.mjs src/pulse/workflow-coverage.test.mjs src/pulse/self-audit.test.mjs src/pulse/run-evidence.pg.test.mjs` -> 232 tests, 232 pass (the pg file is skipped here without `DATABASE_URL`).
- `src/pulse` + `src/workflows` + `src/security` + `src/events` + `src/ops`: 3728 tests, 2 fail, both already failing on main: `registry: every registry row names a real handler or desk file` (a leads page that is git-excluded in a worktree) and `index serves exactly the workflows on disk` (`pulse-instant-watch` is not named in `EXPECTED_WORKFLOW_IDS`).
- `npm run lint` clean. `npx tsc --noEmit`: the same 1 error as main (`src/marketing/filmed-receive.mjs(159,75)`).
- The pg file, Part 1, run against the live database in read-only transactions with shadowed rows: 18 of 18. Part 2 skips off loopback by design.
- Mutations I ran in round 2 (each reverted; every one killed by at least one test): old start rule; no number rule; no key rule; no URL query rule; no Slack rule; no webhook-path rule; no URL-password rule; uuid not protected; `marked` never set; rule d ignoring `canWrite`; "was writing" always true; "was writing" off by one; no skip for unsure runs; retry aging off; max-attempts final off; Arizona clock off; repeat names missing one; repeat window 5 hours; meta time not read; old rule c words; repeat clause removed from the SQL (killed by 4 pg tests). Round 1 mutations are listed in the round 1 text of the git history (commit 5cb82500).

## What I could not verify (read this)

- **Part 2 of the pg test has never run.** There is no Postgres on this Mac (no postgres, psql, initdb, docker or podman), and I will not write to the live database. Part 2 does the writes (migration applied, grants, START/FINISH upserts as `fundhub_app`, DELETE refused, REVOKE switch-off). I wrote it by copying the patterns of `pulse-records.pg.test.mjs` and checked each statement by reading, but a wrong guess in it shows up in CI. If CI shows a Part 2 failure, read the message before assuming the migration or add-on is wrong: it may be the test. The pieces that touch only the SQL text I could prove: the whole 478 file and both write statements parse clean on the live server (read-only transaction), and Part 1 runs the real read SQL on a real engine.
- **The migration has never run.** Same reason. It parses clean; it has not executed. The `DO $$` blocks are strings at parse time, so their bodies are untested until CI or the ship.
- **`npm run pulse:prove` was not run** (it builds the real Netlify bundle and reads live data; the integrator runs it). `run-evidence.mjs` imports only `../lib/outbound-fetch.mjs` and `./heartbeats.mjs`; `workflow-runs.mjs` now also imports `./quiet-hours.mjs` (no imports of its own), all already in the live bundle.
- **No live event has run through the add-on.** The first real run will be a customer's. That is why the no-deploy switch-off and the breaker exist, and why `audit:run-recorder` watches for "events came, nothing recorded". The integrator's canary is still the only live proof.
- **Inngest's real retry timing.** Rule d fails a workflow that does not sleep when a run is open over 30 minutes and receipts were being written after that. A step that fails and retries with Inngest's own backoff leaves the run open with only a start mark between attempts (no `finished` fires for a step). If a backoff pushes past 30 minutes, that workflow could read a false "started, never finished". I could not measure Inngest's backoff here. Watch for it in the first days.

## Known limits (honest list)

- The five workflows that were handed events on 10-07 (`ar-collections`, `ds-02-diy-letters`, `slo-paid-form-nudge` on `payment.received`; `dpc-03-inbound-reply-router`, `slo-genuine-reply` on `message.inbound`) were handed them **before** receipts exist. Nothing can say whether they ran, and I will not paint them green. Their events leave the 3-day window on their own: the three `payment.received` ones (last event 10-07 07:07 UTC) are already `na` by the 6 a.m. pulse on 10-10; the two `message.inbound` ones (event 10-07 16:50 UTC) read `skip` ("came before run receipts began") on that one morning and are `na` from the next. If the ship happens later than 10-10 morning, the same rule gives the same answer one day later.
- A **new** workflow whose trigger event already came in the 3 days before it was added (after receipts began) reads "no receipt shows it started" until those events age out.
- **Round 2 left a smaller gap in rule d.** A run is called lost when receipts were still being written after its deadline. If one run's finish write was lost in a short breaker pause and OTHER receipts were written afterwards, it still reads lost (red). Nothing the pulse can read tells those two apart. In a quiet system with nothing written after the deadline, a truly lost run reads "receipts may have been paused" (not checked, which still counts as red on the morning report).
- A **repeat funnel post is judged by the same test the adapter uses.** If a first post is lost and a repeat comes inside 6 hours, only the first is counted (one miss, correct). If the adapter ever suppresses another event name, the copied list in `workflow-runs.mjs` must follow; the guard test fails when the two differ.
- Any other event emitted with `skipInngest: true` whose name is a workflow trigger would read "no receipt shows it started". I checked every `skipInngest` emitter in `src`, `api` and `scripts` on 2026-10-09: `commission.approved`, `commission.paid`, the nudge events, the funnel track events, `rb2b`, `slo.visit`, `slo.engagement`, the journey runner (scratch only) and the buy-box marker are not trigger names; `slo.contact_started` only skips for a non-contact visit. The clickfunnels pair is the only one, and it is now handled.
- A workflow body that returns `{ ok: false }` at the top level is recorded as a final error (red) until a later run is ok. Many step helpers return `{ ok: false, reason }`; only the workflow's own final return counts. Watch the first mornings for workflows that return it as a normal "nothing to do".
- 20 workflow files return `{ skipped: true }`; rule e only fires after three in a row.
- The `audit:run-recorder` events count (`events_n`) still counts repeat funnel posts. It goes red only when events came AND no run of any workflow was recorded in the whole day, so a repeat cannot trip it in practice. Not changed.

## Requests for others (I did not edit their files)

- **Owner of `src/adapters/clickfunnels.mjs`:** export `REPEAT_SUPPRESSED_EVENTS` (it is `const` today, only `FUNNEL_REPEAT_WINDOW_MINUTES` is exported) so `workflow-runs.mjs` can import both instead of copying them. Then delete the copy and the source-reading test.
- **Owner of `src/events/bus.mjs` (longer term):** mark an `events` row that was not handed to Inngest (`skipInngest: true`, or no `INNGEST_EVENT_KEY`) so the pulse never has to guess. A column or a payload flag would do; then the repeat-post SQL goes away.
- **Integrator:** run `npm run migrations:manifest` (the `health-migrations` test goes green). Ship order matters little: migration runs first on production; the code that writes receipts deploys minutes later; the marker + 1 hour grace covers that gap.
- **Integrator:** after the ship, check in CI that `src/pulse/run-evidence.pg.test.mjs` Part 2 ran and passed (it is the only proof of the write side). `scripts/pulse/prove.mjs` could assert `audit:run-recorder` is not `skip` after ship, and that `workflow_runs` gets a row when the canary fires. Add `wf:` to `isPingId` in `src/pulse/tripwires.mjs` (already on your list).
- **Integrator, first 60 minutes after ship:** watch for `[run-evidence]` lines in the Netlify function log (a `paused` line means the database did not answer), `workflow_runs` rows with `outcome = 'error'`, and `/api/inngest` error rate. If anything looks wrong: `REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app;` first, then read. The workflows keep running.
- **Owner of `src/workflows/index.test.mjs`:** add `pulse-instant-watch` to `EXPECTED_WORKFLOW_IDS` (already failing on main).
- **Owner of `src/pulse/heartbeats.mjs`:** the cron path still has no timer on `recordHeartbeat` (the critic's cap idea); I did not touch it, as ordered.
- **Whoever owns the booking calendar setting:** if the maximum days ahead a person can book is ever raised past 14 days, raise the four booking entries in `SLEEPERS`.

## Left undone

- Finding 8 (booking sleepers read from the calendar window): not done, reason above.
- Finding 9 (two log lines): accepted as the finding allows.
- Not built (out of scope here): the canary function, the hourly `pulse-self` beat, cron timer in `recordHeartbeat`.
