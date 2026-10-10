# Manifest B — event workflow rows, monthly N/A, workflow guard

Branch `build/ZU-B-2026-10-09`, built from main at `fbc54d0e`. Piece B of the Ship 1 build contract.

## Files touched (all on my owned list)

| file | what |
|---|---|
| `src/pulse/workflow-runs.mjs` | new. `checkWorkflowRuns`, `NOT_LIVE_WORKFLOWS`, `workflowSince`, `workflowTriggers`, `WORKFLOW_SINCE_DAYS` |
| `src/pulse/workflow-runs.test.mjs` | new, 23 tests |
| `src/pulse/workflow-coverage.test.mjs` | new, 11 tests (the build-time guard) |
| `src/pulse/heartbeats.mjs` | only the "too soon" branch of `checkJobHeartbeats` (+20 lines) |
| `src/pulse/heartbeats.test.mjs` | +4 tests (file now 7 tests; the 3 old ones are untouched) |

No other file was edited. No migration. No database write.

## Exports (exact names and argument shapes)

```js
// src/pulse/workflow-runs.mjs
export const WORKFLOW_SINCE_DAYS = 3;
export const NOT_LIVE_WORKFLOWS;            // frozen object { [fnId]: reason (40+ chars) }
                                            // n-01-cold-nurture, n-02-warm-nurture, n-03-hot-nurture
export function workflowSince(now = new Date()) -> Date          // now minus 3 days
export function workflowTriggers(fn) -> { id, events: string[], crons: string[], enabled: boolean, hasTrigger: boolean }
export async function checkWorkflowRuns({ db, scope, now, functions, readTimeoutMs }) -> Promise<row[]>
```

`checkWorkflowRuns` arguments:
- `functions` is required: the list exported by `src/workflows/index.mjs`. Without it you get one `skip` row `wf:all`. Never a throw.
- `scope` is the staff-scope runner `(fn) => fn(tx)` (the pulse's `staffScope`). Used for the read when given, else `db.query`. Both work on the live `events` table (measured).
- `now` the clock. `readTimeoutMs` defaults to 5000 (test hook).

Row shape (every row): `{ id: "wf:<fn id>", kind: "coverage", group: "jobs", status, detail, suggestedFix, customerSees: null, schedule }` plus `na: { code, args }` on N/A rows only. `schedule` is the trigger names joined with ` + ` (same convention as the slice rows), `null` for dark ones.

`checkJobHeartbeats` (unchanged signature): a monthly row can now come back `{ id: "job:<job>", group: "jobs", status: "na", detail, suggestedFix: null, customerSees: null, na: { code: "monthly-not-due", args: { cron } } }`.

## The rules as built (first hit wins)

| # | when | status | code and args | detail |
|---|---|---|---|---|
| a | no trigger, or `enabled === false` | `na` | `no-trigger` `{ id }` | "Turned off in code (no trigger). Judged the day a trigger is put back." |
| b | the one `events` read failed (no db, throw, 5 s cut) | `skip` | none | "Events could not be read: <error>. This workflow was not judged." |
| c | at least one of its trigger names has an `events` row since `since` | `skip` | none | "<n> <name> event(s) came since <date> (first <time> UTC). Nothing records that this workflow ran. Run receipts are not switched on yet." |
| d | none of its trigger names has an `events` row since `since` | `na` | `no-demand` `{ names: string[], since: ISO string }` | "No <names> event came since <date>. Judged the day one comes." |

- Never `PASS`. Never `na` when an event came. (Tests prove both.)
- Pure-cron functions get no `wf:` row (they are the `job:` rows). 100 functions today: 35 cron, 62 event, 3 dark, so **65 `wf:` rows**. A function with BOTH a cron and an event trigger would get a `wf:` row judged by its event names; there is none today.
- One grouped read for all 22 trigger names: `SELECT name, count(*)::int AS n, min(created_at), max(created_at) FROM events WHERE name = ANY($1::text[]) AND created_at > $2::timestamptz GROUP BY name`. No `org_id` and no `is_demo` filter on purpose: piece A's `no-demand` verify reads `events` the same way (name + created_at only), so my claim and its re-check cannot disagree.
- `since` is passed in args as an ISO string (`2026-10-06T17:00:00.000Z` for a run at `2026-10-09T17:00:00Z`).

## Monthly N/A (`checkJobHeartbeats`)

In the "no heartbeat yet, too soon" branch, a monthly row (`interval == null`) returns `na` / `monthly-not-due` / `{ cron }` with detail "Runs once a month. Its last due time came before receipts began. First judged after 2026-11-01." (the date is the next due date; it is the first day anything exists to judge).

**Deviation from the contract, on purpose:** the contract says every monthly "too soon" row becomes `na`. I return `na` only when `min(job_heartbeats.finished_at)` is later than `lastMonthlyFire(cron, now)`, which is exactly the condition piece A's `monthly-not-due` verify re-checks. The other monthly "too soon" case is the one-day grace right after a due time when receipts began BEFORE that due time and the run is just not in yet. There the verify would say "false", so an `na` would be turned into `not_checked` with a confusing reason by the audit. I left that case a `skip`, exactly as before. Same final status, honest reason, and no `na` that fails its own check. Non-monthly rows: unchanged `skip`.

Live fact (read only, 2026-10-09 17:30 UTC): `min(job_heartbeats.finished_at)` = 2026-10-07 20:08:00 UTC; `affiliate-payout-run` and `partner-production-floor` have 0 heartbeat rows; last due times were 2026-10-01 03:00 and 14:00 UTC. Both rows are `na` today.

## Second small deviation

The contract rule (a) says "no trigger or `enabled === false`, or in `NOT_LIVE_WORKFLOWS`". I make `na no-trigger` depend on the function truly having no trigger or being off. `NOT_LIVE_WORKFLOWS` is the written list of why, and `workflow-coverage.test.mjs` fails the build if a function is dark and not on it, or if an entry on it is live or gone. Reason: a function that is on the list but has a live trigger would get an `na` that piece A's `no-trigger` verify rejects. This way it is judged by its events like any other.

## Tests added

`workflow-runs.test.mjs` (23): na no-demand with args and exact detail; skip when an event came (never PASS, never na); singular/plural; two triggers (names all listed, any one hit wins, per-name counts); event for another workflow does not leak; no trigger and switched off are `na` and need no database; a dark workflow's events are not read; crons get no row; exactly one read, a plain SELECT with names and a 3-day start; staff scope used when given; read throws -> skip with the error (dark rows stay `na`); no db -> skip; hung read is cut at the timeout; a db that throws synchronously -> skip; no workflow list -> one skip row; no row is ever PASS; every `na` row has a code and plain JSON args; `workflowSince`; `workflowTriggers`; `NOT_LIVE_WORKFLOWS` reasons 40+ chars; the real bundle gives 65 unique `wf:` rows (62 `no-demand`, 3 `no-trigger`, 0 skip with no events); the real bundle with one `round.started` event turns exactly the `round.started` workflows to `skip`; one read, 22 names, under a second.

`workflow-coverage.test.mjs` (11): today's real bundle has no gap, plus one test per rule on the real bundle (shared client, canonical names, dark list, cron list), plus one fail-case and one pass-case per rule on a made-up bundle, plus stale allow-list failures.

`heartbeats.test.mjs` (+4): both real monthly jobs are `na` with the exact code, args and detail; the in-grace case stays `skip` and a late one stays `FAIL` (the `na` is only used when its own condition holds); a monthly job that ran is `PASS`; a frequent job too soon to judge is still `skip` with no `na`. There was no existing test that expected `skip` for the monthly case, so none needed changing.

Mutation checks I ran: rule c returning `PASS` fails 10 tests; widening the monthly condition to every monthly row fails the grace test. Both reverted.

## How to run

```
node --test src/pulse/workflow-runs.test.mjs src/pulse/workflow-coverage.test.mjs src/pulse/heartbeats.test.mjs
node --test "src/pulse/**/*.test.mjs"        # whole pulse folder: 2312 tests, 2246 pass, 65 skipped (database ones), 1 fail (below)
node scripts/lint.mjs                        # 3194 files parse clean
```

Results here: my three files, 41 tests, 0 fail. The whole pulse folder has **1 failure that is not mine**: `registry: every registry row names a real handler or desk file` fails in this worktree only, because `public/leads/c01cb7592c8bb994130158e897e99bf1/index.html` is locally git-excluded in the main checkout (`.git/info/exclude`) and so does not exist in a worktree. `npx tsc --noEmit` shows 1 error, `src/marketing/filmed-receive.mjs(159,75)`, also not mine and not in any file I touched. `src/ops` and the workflow pulse tests (229) pass.

## Findings from the guard (read first, nothing hidden)

None. On today's tree: 22 distinct event trigger names, all in `CANONICAL_EVENTS`; every function is on the shared `inngest` client; the 3 dark functions (`n-01`, `n-02` have `triggers: []`, `n-03` has `triggers: []` and `enabled: false`) are exactly `NOT_LIVE_WORKFLOWS`; all 35 cron functions are on `INNGEST_JOBS`. The allow-list for non-canonical names is empty.

## Live fact the integrator must know (rule c, on purpose)

Measured read-only 2026-10-09 17:30 UTC, the real read took 0.6 s including connect. Of the 22 trigger names only two have events in the 3-day window: `payment.received` (6, first 2026-10-07 07:05 UTC) and `message.inbound` (1, 2026-10-07 16:50 UTC). Run through the real bundle that gives **65 rows: 57 `na no-demand`, 3 `na no-trigger`, 5 `skip`**. The 5 `skip` rows (they land `not_checked`, so red through `audit:not-checked`) are `wf:ar-collections`, `wf:ds-02-diy-letters`, `wf:slo-paid-form-nudge` (payment.received) and `wf:dpc-03-inbound-reply-router`, `wf:slo-genuine-reply` (message.inbound). They age out of the window by 2026-10-10 07:05 and 16:50 UTC if no new event comes.

So the proof's "not_checked is 0" cannot hold on a day when real events came. This is the contract's choice (we handed it work, nothing proves it ran). When real leads flow it will be dozens of `wf:` ids in the one `audit:not-checked` line (first 10 named). Ship 2 (run receipts) is what turns them into judged rows.

## Requests for others (I did not edit their files)

- **A (`na-conditions.mjs`)**: the `no-demand` verify must read `args.names` (string array) and `args.since` (ISO string) from `events` with only `name = ANY(...) AND created_at > since`, to match my read. `no-trigger` gets `args.id` = the plain function id from `fn.opts.id` (no `wf:` prefix). `monthly-not-due` gets `args.cron`; my `na` is only emitted when `min(finished_at)` over the whole `job_heartbeats` table is later than `lastMonthlyFire(cron, now)`.
- **Integrator**: call `checkWorkflowRuns({ db, scope: staffScope, now, functions })` in its own Inngest step (one read, 5 s cap) and guard it like the other reads. Add `wf:` to `isPingId` in `src/pulse/tripwires.mjs` (not mine). The `wf:` ids are all new, I grepped `src/pulse` first; the string `wf:all` is used only when no workflow list is handed in.
- **D (`self-audit.mjs`)**: `audit:expected-present` should expect a `wf:<id>` for every function that has at least one event trigger or no trigger at all (not for pure crons). That is exactly what I emit. `NOT_LIVE_WORKFLOWS` is an object map, not an array.

## Left undone

Nothing on my list. Not built because the contract says OUT: run receipts, `workflow_runs`, the retry/final-attempt rules, the sleeper map.
