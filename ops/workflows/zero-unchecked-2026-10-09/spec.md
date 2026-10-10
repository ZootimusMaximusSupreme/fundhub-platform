# Zero "not checked", and a heartbeat that checks itself — build contract (2026-10-09)

Architect: Claude (Opus). Builders: Sonnet (back end), each owning its files alone. Integrator and shipper: the Claude main session.
Reads first: `measure.md` in this folder (facts; its numbers win over this file where they differ), `baseline-proposal.json`, `slice-link-map.json`, `event-workflow-rows.json`, `../pulse-hourly-lanes-2026-10-09/spec.md`, `.claude/rules/heartbeat-on-every-build.md`, `.claude/rules/texting-hours.md`, `../fix-batch-2026-10-09.md`.

Owner law, today, his words: "when it's live, if something's not checked ever, you have to check it. Something's messed up at the heartbeat level." The system "needs to audit itself" and "verify that checks are actually running". He also said the report page "is fine the way it is".

## 0. In plain words (for Chris)

- This morning's report had 299 rows that said "not checked". After this build a live thing can only be **green**, **red**, or **nothing to judge today**.
- "Nothing to judge today" must say why, in a way the computer re-checks every morning. Example: "No ad is running. Judged the day one runs." If an ad IS running, that row is not allowed to hide. It turns into a red.
- Anything left "not checked" becomes **one** red line, not 299. It lists how many and the first 10.
- Most of the 299 were not broken. 176 were copies of door pings that ran and passed; the report just never matched them up. 93 were workflows that start on an event, and nothing ever wrote down that they ran. We fix both.
- New: every workflow run writes a small receipt. If a workflow was handed work and never started, or its last run failed, that goes red.
- New: the heartbeat checks itself. Did every check that should run, run? Did a whole group of checks die? Did the morning report get saved? Did the totals drop? Each of those is its own red line.
- Texts: still one morning text. Still at most one hourly line from the new self-check. Never at night.

## 1. The status model — DECIDED

### 1.1 The rule

A row on the morning scorecard has exactly one of four stored statuses. Only three are allowed to stay:

| stored status | means | allowed? |
|---|---|---|
| `green` | ran and passed, with proof (unchanged: a pass with no proof is not green) | yes |
| `red` | ran and failed, or the heartbeat itself failed | yes |
| `na` | nothing to judge today, with a **condition code** from a closed list, its arguments, and a reason. The audit re-runs the condition this run. | yes, only while the condition re-checks true |
| `not_checked` | anything else: a skip with no condition, a failed read, a claim with no check, an N/A whose condition came back false | stored so the totals add up, but **each one is counted into the single red row `audit:not-checked`** |

The pulse-level row statuses become `PASS`, `FAIL`, `na`, `skip`, `up`, `down` (the scorecard maps them). `skip` keeps its old meaning (a failed read, a masked key) and now lands as `not_checked`, so in production it is red through the one aggregate row. A lane that wants "nothing to judge" must return `na` with a condition. There is no other way to be quiet.

### 1.2 The N/A condition list (`src/pulse/na-conditions.mjs`, new)

```js
export const NA_CONDITIONS = Object.freeze({
  // code: { say(args) -> one 4th-grade sentence, verify(args, { db, scope, now, functions }) -> Promise<boolean> }
});
```

Each code has a reason sentence that says when it will be judged, and a `verify()` that is a read (or a pure test on bundled code). Every code has a PASS test and a FAIL test. Codes for today (no others; a new code needs its own verify and tests):

| code | used by | verify() is true when | reason shape |
|---|---|---|---|
| `no-demand` | `wf:<fn>` rows | `event_handoffs` has 0 rows for the function's trigger names since `since`, AND `workflow_runs` has 0 rows for the function since `since` | "No round.started was handed to the workflow engine since 10-09. Judged the day one comes." |
| `no-trigger` | `wf:n-01-cold-nurture`, `wf:n-02-warm-nurture`, `wf:n-03-hot-nurture` | the bundled function has `triggers.length === 0` or `enabled === false` | "Turned off in code (no trigger). Judged the day a trigger is put back." |
| `not-registered` | `05-funnels:clarity-insights-sweeper` | the id is not in the bundled `functions` list | "Built but not switched on (not in the workflow list). Clarity pulls run only when Chris asks." |
| `monthly-not-due` | `job:affiliate-payout-run`, `job:partner-production-floor` (and the slice rows folded into them) | `min(job_heartbeats.finished_at) > lastMonthlyFire(cron, now)` (receipts began after its last due time) | "Runs once a month. Its last due time came before receipts began. First judged 11-01." |
| `no-running-ad` | `ads-spend-day-missing`, `ads-running-no-metrics` (gap-ads) | the lane's own exported count SQL says 0 running ads | "No ad is running. Judged the day one runs." |
| `low-traffic` | `gap-leads:lead:pipe-cut-with-traffic`, `gap-leads:lead:clickfunnels-posts-silent`, `gap-pixels:ad-click-stored` | the lane's own exported count SQL is below the lane's own exported minimum (no number copied) | "Only 0 ad clicks in 2 days. Needs 360 to judge." |
| `no-real-lead` | `gap-leads:lead:slo-contact-not-in-clickfunnels` | the lane's exported count of real `slo.contact_started` in its window is 0 | "No real roadmap lead in 3 days. Judged the day one comes." |
| `not-connected` | `social:video-stats-stale` | the lane's exported count of active YouTube connections is 0 | "YouTube is not connected, so there is no sync to be late." |

Rules for every code:
- The four core codes (`no-demand`, `no-trigger`, `not-registered`, `monthly-not-due`) carry their `verify()` in `na-conditions.mjs`. The four lane codes carry `verify: "lane"`: the lane file that produced the row exports `naVerify = { "<code>": async (args, ctx) => boolean }`, and the audit calls that export on the lane module (found by the row's `sliceId` in `GAP_FILES`). So `na-conditions.mjs` never imports a lane file and no lane query is copied.
- `verify()` re-uses the producer's exported SQL or constant. It never copies a query or a threshold.
- It runs on the same `db` / `scope` the producer used, read only. A verify that throws counts as false.
- "We cannot see it from here" is never a condition. `gate-relay` ("a Mac process, not on this host") has no code, so it lands `not_checked`, which is red (open decision 2).
- A row whose code is unknown, whose args are missing, or whose verify returns false becomes `not_checked` with reason "Said nothing to judge, but <condition> is not true" and is counted by `audit:not-checked`.

Rejected: keeping `skip` as a quiet state (that is how 299 rows hid). Rejected: a free-text N/A reason (the computer cannot re-check text). Rejected: making each `not_checked` its own red (299 reds in one text; the storm rule exists to stop that).

### 1.3 The scorecard, the morning text, the report page

- `src/pulse/scorecard.mjs`: `toContractCheck` maps `na` + a valid `na` object to `{ id, group, status: "na", reason, na_code }`; `countChecks` counts `na`; `saveScorecard` writes `na_count`. A row may carry `also: [ids]` (the slice claims folded into it, section 2).
- Migration (section 9, piece A) adds `na_count` and widens `pulse_scorecards_counts_match` to four statuses. Until it is applied, `saveScorecard` gets error `42703` (no column) or `23514` (check): it saves once more in the old shape (`na` written as `not_checked`, no `na_count`) and logs one line. The morning report is never lost because of this change.
- `src/ops/morning-brief.mjs` `summarizeSystems` only: return `{ status, total, green, red, na, not_checked, reds, line }`; `not_checked` no longer includes `na`. Reds are ordered money tripwire first, then customer tripwire, then `audit:*`, then the rest (stable within each; the tripwire ids come from `TRIPWIRES[*].checks`, matched on the row id or its `checkId`). The line:
  `Systems: 690 of 757 checks green. 3 red: audit:not-checked (2 could not be checked), payments:paid-product-unmapped, audit:tripwire-holes. 64 had nothing to judge today.`
  "Nothing needs you." only when red is 0 and not_checked is 0 (unchanged rule).
- `public/app/morning-brief.html`: **no change today** (Chris: "fine the way it is"). It already reads `systems.red`, `green`, `total`, `not_checked` and `reds`; the aggregate red row shows in the red list with its count and first 10 ids in "What we saw". The "Not checked" tile shows the true count, which must be 0. The `na` count is in the text line, not on a tile (open decision 4 asks about a fourth tile).
- Never a flood: `not_checked` is one row, N/A conditions that fail feed that same row, missing checks are one row, tripwire holes are one row. Worst case the morning text grows by the `audit:*` rows, and it still shows only the first 3 reds plus "and N more in the report". The hourly self-check (section 4.3) is one beat, so it is at most one line an hour, under the existing damping, and never outside 6 a.m. to 10 p.m. Arizona (texting-hours law; it depends on fix-batch piece Q landing first).

## 2. The 176 slice rows that point at a real check — DECIDED: fold, do not copy

Measured (`measure.md` section 1, `slice-link-map.json`): 350 slice rows in 33 files. 176 carry `alreadyInRegistry: true` and say "PASS"; all 176 map to a `reg:` row by `coverageKey`, all 176 targets were green this morning, and they point at only 127 distinct `reg:` rows. Plus 96 rows name an Inngest function, 58 rows are crons already on `JOBS`, 15 map to nothing. 81 ids appear in more than one slice.

### 2.1 Where the mapping lives

- `src/pulse/coverage/run-slices.mjs` `evaluateRow` stops writing "not checked" for a claim. It sets `foldInto` on the row it returns, by this order (first hit wins):
  1. `ALIASES` (new, exported from `src/pulse/coverage/link.mjs`): `morning-brief` -> `job:daily-pulse`; `contracts/sign` -> `contracts:sign-route`. Nothing else today.
  2. registry: a `PULSE_REGISTRY` row with `coverageKey(r) === row.id` or `r.id === row.id` -> `reg:<r.id>`.
  3. `ALLOWED_UNMONITORED` key whose `route:<id>` is in `TRIPWIRES` -> that entry's first non-ping check id.
  4. an id in `JOBS` -> `job:<id>` (this replaces the separate per-slice cron evaluation). Kept on their own evaluation, unchanged: the agent read for `ag-07-cron-daily-pulse` and the four marketing heartbeat rows (`clock`, `worker`, `outbox_drain`; `page_seen` leaves, below). A payout or floor stamp row keeps its own evaluation only when its stamp read returns a time (`affiliate_payouts` does, 45 days old); when the stamp finds nothing (`partner_production_reviews` has 0 rows) it folds into `job:<id>` (the three `partner-production-floor` rows, as the measure says).
  5. a bundled Inngest function id with an event trigger or no trigger -> `wf:<id>` (section 3).
  6. nothing -> no `foldInto`; the row stays `not checked` with reason "Claims covered, but no check ran for <id>". It is counted by `audit:not-checked`.
- `NOT_LIVE_ROWS` (new, in `link.mjs`): rows that are not live surfaces and leave the scorecard, each with a reason, and a test that each still exists in its slice (so the list cannot go stale):
  `02-daily-pulse:script-dry-run-default`, `02-daily-pulse:pulse-never-fixes`, `02-daily-pulse:proof-does-not-text` (code properties; `src/pulse/coverage/slice-02-daily-pulse.test.mjs` and `src/pulse/daily-pulse.test.mjs` prove them), `16-nurture:n-05-repair-complete-nurture` (the file does not exist), `03-marketing:page_seen` (a side effect of a staff page view; the door is `reg:marketing/health`). No slice file is edited for these (fix-batch piece F5b may be in `slice-03-marketing.mjs`).
- `foldCoverage(checks)` (new, pure, `link.mjs`) runs in `runDailyPulse` after every row of the run exists (registry pings run in the `run-pulse` step, slices ran earlier in `coverage-slices`):
  - target found -> the slice row is removed and its id is pushed onto the target's `also` list. The target keeps its own status and proof. A fold never adds depth: a ping stays a ping (measure: "the linked row must carry that depth").
  - target missing from this run -> the slice row stays, `not checked`, reason "Claims covered by <target>, but <target> did not run today". Counted by `audit:not-checked`.
  - returns `{ checks, folded: n, dangling: [ids] }`; `folded` goes on the scorecard (`claims = rows + sum(also.length)`) so a fold never reads as "checks dropped".
- The in-process repair rows (`33-fulfillment:repair.docs.complete`, `33-fulfillment:repair-stage-moves`) are bus handlers, not Inngest functions. Today they fold only if a deep check that reads repair stage moves already exists (builder greps `gap-repair.mjs`, `gap-fulfillment.mjs`; `fulfillment:next-action` is a candidate, confirm it reads stage moves). Otherwise they stay `not checked` (red through the aggregate) and a leftover card is written. The bus twin write in `dispatch()` is NOT today (hot path: every event in the company).

Rejected: copying the target's status onto each slice row (one door down = up to 5 duplicate reds; 49 of 176 are pure duplicates). Rejected: linking in `run-slices.mjs` alone (the `reg:` rows do not exist yet in that step).

### 2.2 Slices that do not load on the server

`slice-09-documents.mjs` and `slice-11-hiring.mjs` read `workflows/index.mjs` from disk at import; `slice-23-pages.mjs` reads `public/app/shell.js` and lists `public/app`; `slice-06-briefs.mjs` reads repo files too (measure section 5). Live: `ENOENT`, one `load-error` row each, 8 + 2 real rows lost. Fix: use imports (`functions` from `src/workflows/index.mjs`, `DESK_FILES`/`PULSE_REGISTRY` from `src/pulse/registry.mjs`) and no `fs`. A `load-error` row is now `not_checked` and `audit:lanes-ran` names the file.

## 3. Run evidence for every Inngest function — DECIDED: a second middleware with a start mark, a finish mark and a hand-off mark

### 3.1 Facts that decide it

- The middleware already exists: `src/workflows/client.mjs` registers `heartbeatHooks()` (`src/pulse/heartbeats.mjs`). It writes `job_heartbeats` on `finished`, only when `ctx.event.name === "inngest/scheduled.timer"`. Live: about 12,377 rows in 2 days, 41 jobs. So `finished` fires on the live Netlify path.
- `onFunctionRun` fires on every HTTP request (one per step); `finished` fires once on success and once per failed attempt (measure, proved with the real serve handler, `design/mw-proof.mjs` in the session scratchpad).
- 17 of the 62 event workflows sleep (20 minutes up to 180 days). A finish-only receipt arrives hours to months late.
- An `events` row is not a hand-off: `src/events/bus.mjs` sends with `void inngest.send(...)` only when `INNGEST_EVENT_KEY` is set and `skipInngest !== true`, and `skipInngest: true` is used on purpose by `src/journeys/runner/index.mjs` (`fireEvent`, imported by about 10 crons), `src/adapters/clickfunnels.mjs` (repeat posts), `src/nudge/run.mjs`, `src/commissions/payout.mjs`, `api/public/slo-interest.mjs`, `api/public/rb2b-webhook.mjs`. So "an event row exists and no run followed" would be a false red.
- Since receipts began (10-07 20:08 UTC) none of the 22 trigger event names was emitted (measure section 2). Every event workflow is idle today, whatever we build.
- The pool (`src/db.mjs`): `connectionTimeoutMillis` 5000, `statement_timeout` 15000. An uncapped write can hold a request 20 s. Netlify cuts each step request at 26 s. The live app role is `fundhub_app`, not a superuser (measured), so a `REVOKE` takes effect.

### 3.2 Tables (in the one migration, section 9 piece A)

```sql
-- One row per Inngest run of a function that was NOT started by its cron timer.
CREATE TABLE IF NOT EXISTS public.workflow_runs (
  run_id            text        PRIMARY KEY CHECK (char_length(run_id) BETWEEN 1 AND 100),
  fn_id             text        NOT NULL CHECK (char_length(fn_id) BETWEEN 1 AND 120),
  event_name        text        CHECK (event_name IS NULL OR char_length(event_name) <= 120),
  inngest_event_id  text        CHECK (inngest_event_id IS NULL OR char_length(inngest_event_id) <= 100),
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  outcome           text        CHECK (outcome IS NULL OR outcome IN ('ok', 'error')),
  attempt           integer     CHECK (attempt IS NULL OR attempt >= 0),
  error             text        CHECK (error IS NULL OR char_length(error) <= 300),
  CONSTRAINT workflow_runs_finish_ck CHECK (finished_at IS NULL OR outcome IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS workflow_runs_fn_started_idx ON public.workflow_runs (fn_id, started_at DESC);
CREATE INDEX IF NOT EXISTS workflow_runs_event_idx ON public.workflow_runs (inngest_event_id) WHERE inngest_event_id IS NOT NULL;

-- One row per event the app actually handed to Inngest (the send came back with an id).
CREATE TABLE IF NOT EXISTS public.event_handoffs (
  inngest_event_id  text        PRIMARY KEY CHECK (char_length(inngest_event_id) BETWEEN 1 AND 100),
  event_name        text        NOT NULL CHECK (char_length(event_name) BETWEEN 1 AND 120),
  sent_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS event_handoffs_name_sent_idx ON public.event_handoffs (event_name, sent_at DESC);
-- Both: platform-wide like job_heartbeats (no org column). ENABLE + FORCE row security, one permissive
-- policy for fundhub_app, GRANT SELECT, INSERT, UPDATE (workflow_runs) / SELECT, INSERT (event_handoffs);
-- no DELETE, no TRUNCATE; REVOKE ALL from anon and authenticated. Copy job_heartbeats' blocks in 430.
```

Rejected: reusing `job_heartbeats` (the measure's pick). It has no way to write a start mark without a row that lies ("finished ok" at the start), it cannot tie a hand-off to its run, and `gap-jobs` `job-heartbeats-unlisted` would flag all 62 event functions as unlisted jobs. Rejected: the Inngest REST API as the main source (beta, outbound from the pulse, the laptop key is masked, and it watches the vendor with the vendor's own word). It is a good second opinion later.

### 3.3 The middleware (`src/pulse/run-evidence.mjs`, new; registered in `src/workflows/client.mjs`)

```js
// client.mjs, the whole hot-path edit:
import { runEvidenceHooks } from "../pulse/run-evidence.mjs";
const runEvidence = new InngestMiddleware({ name: "Run evidence", init: () => runEvidenceHooks({ getDb: () => db }) });
export const inngest = new Inngest({ id: "fundhub-platform", middleware: [heartbeat, runEvidence] });
```

`runEvidenceHooks({ getDb, nowFn, capMs = 1500, log = console.error })` returns:

- `onFunctionRun({ fn, ctx })`, synchronous, wrapped in try/catch (any throw returns `{}`):
  - if `ctx.event.name === "inngest/scheduled.timer"` return `{}` (crons stay with `heartbeatHooks`, unchanged).
  - `reqStart = now`; `fnId = fn.opts.id`; `runId = ctx.runId`; `eventId = ctx.event.id || null`; `eventName = ctx.event.name`; `attempt = ctx.attempt`.
  - returns `{ transformInput({ steps }), finished({ result }) }`. No `transformOutput`: the hook never changes what the function returns.
- `transformInput({ steps })`: only when `steps.length === 0 && attempt === 0` (the first request of the run), one statement:
  `INSERT INTO workflow_runs (run_id, fn_id, event_name, inngest_event_id) VALUES ($1,$2,$3,$4) ON CONFLICT (run_id) DO NOTHING`
  It returns `undefined` (no input change).
- `finished({ result })`, one statement:
  `INSERT INTO workflow_runs (run_id, fn_id, event_name, inngest_event_id, finished_at, outcome, attempt, error) VALUES ($1,$2,$3,$4, now(), $5, $6, $7) ON CONFLICT (run_id) DO UPDATE SET finished_at = EXCLUDED.finished_at, outcome = EXCLUDED.outcome, attempt = EXCLUDED.attempt, error = EXCLUDED.error`
  `outcome = result.error || (result.data && result.data.ok === false) ? 'error' : 'ok'`. `error` = `redact()` from `src/lib/outbound-fetch.mjs`, whitespace collapsed, cut to 300. The newest attempt wins, so retry noise is absorbed.
- `onSendEvent()` returns `{ transformInput({ payloads }) { remember names }, transformOutput({ result }) { write } }`, all in try/catch, never returns a change:
  `INSERT INTO event_handoffs (inngest_event_id, event_name) SELECT * FROM unnest($1::text[], $2::text[]) ON CONFLICT DO NOTHING`
  only when `result.ids` is an array of the same length as the remembered names. `emit()` already does not await the send, so this adds nothing to a web answer; inside a workflow's `step.sendEvent` it adds at most the cap.
- Every write goes through one helper, `safeWrite(getDb, text, values, cap)`:
  - `cap = clamp(23_000 - (now - reqStart), 200, capMs)` (1.5 s; 0.8 s for the start mark and the hand-off).
  - `Promise.race([db.query({ text, values, query_timeout: cap }).then(ok, fail), timeout(cap)])`. Never throws, never rejects, returns `{ written, reason }`.
  - one log line per kind per minute at most, redacted, no values.

Same change, `src/pulse/heartbeats.mjs` (cron path): `recordHeartbeat` gets the same cap (today it has none: a hung pool can hold a cron's last request for 20 s), and `heartbeatHooks.finished` records `outcome: 'error'` when `result.data.ok === false` (measure: 16 cron files return `{ ok: false }` and are saved as `ok` today; Netlify jobs already record it). This can turn some `job:` rows red tomorrow. That is the heartbeat telling the truth, not a new break.

Cost: 2 statements per event-triggered run (start, finish) plus one per failed retry; 1 per send (about 250 sends a day today, mostly `funnel.*` if they go through Inngest). Under 1 MB a month. No new dependency, no vendor call, no AI.

Hot-path risk and the switch-offs:
- Risk: this runs inside every workflow request on launch day. The three ways it could hurt: (1) a throw inside a hook (every hook is wrapped; tests throw on purpose), (2) a slow write delaying the last request toward 26 s (capped at 1.5 s, less when the request is already old), (3) a pool starved by stuck writes (each write is capped and uses `query_timeout`, so a client is handed back).
- Switch-off with no deploy (agent runs it as owner through the Supabase SQL tool, on Chris's word or on the watch rule below): `REVOKE INSERT, UPDATE ON public.workflow_runs FROM fundhub_app; REVOKE INSERT ON public.event_handoffs FROM fundhub_app;`. Every write then fails in milliseconds with a permission error, which the helper swallows. Undo: the matching `GRANT`. Record either in the next migration.
- Switch-off with a deploy: remove `runEvidence` from the `middleware` array in `client.mjs` (one line) and ship.
- Watch rule after ship (integrator, first 60 minutes): `job_heartbeats` rows per 10 minutes must stay within 20% of the hour before; no `[run-evidence]` log line other than the first-row note; `/api/health` stays 200. If any fails: REVOKE first, then read.

### 3.4 The `wf:` rows (`src/pulse/workflow-runs.mjs`, new) and the red rules

`checkWorkflowRuns({ db, now, functions })` returns one row per bundled function that is not a cron: `wf:<fn id>` (62 event + 3 no trigger = 65 today), `kind: "coverage"`, `group: "jobs"`. Four reads at most, one Inngest step of its own (`coverage-workflow-runs`, under 5 s). `since = greatest(min(workflow_runs.started_at), min(event_handoffs.sent_at), now - 7 days)`; when either table is empty, `since` is the deploy and every row with no evidence is `na no-demand` (it re-checks true).

Order (first hit wins):

| # | condition | status | detail |
|---|---|---|---|
| 1 | no trigger, or `enabled === false` | `na` `no-trigger` | as in 1.2 |
| 2 | newest run row has `outcome = 'error'`, no later `ok` row for that function, and `finished_at` is over 2 hours old (retries are done) | `FAIL` "last run failed" | "Last run <time> failed: <error, redacted, 120>." Fix: "Open <fn id> in Inngest and read that run. Do not re-run it from the pulse." |
| 3 | a hand-off of a trigger name since `since`, over 15 minutes old, with no `workflow_runs` row of this function for the same `inngest_event_id` | `FAIL` "handed off, never started" | "3 events handed to the engine since 10-09, no run started (first 10-10 14:02). The engine did not run this workflow." |
| 4 | any run row of this function in the last 30 days, finished ok or still running | `PASS` | "Last run started <t>, finished ok <t>." or "Running, asleep since <t> (it waits by design)." |
| 5 | no hand-off and no run since `since` | `na` `no-demand` | as in 1.2 |
| 6 | anything else (a read failed) | `skip` (lands `not_checked`) | the error |

When is "quiet" normal: rule 5, and only while its verify re-checks true. When is "never ran" red: rule 3 (we handed it work). A dropped `void inngest.send` (the send itself lost when the server froze) leaves no hand-off and stays invisible here; the deep "did the customer get it" checks in `gap-handoff.mjs` and `keys:inngest-event-key` cover that, as they do today. Not built today: "a sleeping run that never woke" (needs each workflow's longest wait; staged).

`isPingId` in `src/pulse/tripwires.mjs` adds `wf:` (proof a workflow ran is a heartbeat, not a tripwire).

## 4. The self-audit — the heartbeat checking itself

### 4.1 Where each audit runs

- Morning: `src/pulse/self-audit.mjs` (new) `auditPulse({ checks, folded, manifest, previous, history, db, scope, now, functions })` returns the `audit:*` rows. It runs inside `runDailyPulse` after `foldCoverage` and before `buildScorecard` (it needs every row of the run, so it cannot be a gap lane: the lanes run in earlier steps and never see the registry, job or wf rows). Every read it makes is wrapped; if the audit itself throws, the pulse adds one red row `audit:crashed` with the error and goes on. Budget: under 3 s (two or three small reads), inside the `run-pulse` step, which must stay under 20 s in the proof.
- `buildManifest({ registry, jobs, sliceModules, gapLanes, functions, namedIds, beats })` (same file, pure): every id the run must contain, built only from bundled code. No repo file is read.
- Hourly: one new beat, `src/pulse/beats/beat-pulse-self.mjs` (section 4.3), runs at minute 7 in `pulse-hourly` (outside Inngest, so it still runs when Inngest stops).
- Build time: one new guard test, `src/pulse/workflow-coverage.test.mjs`.

### 4.2 The morning audit rows (id, question, red when, data, how it is proved it can go red)

All `group: "backend"`, all one row each, detail lists a count and at most the first 10 ids. Each has a PASS test and a FAIL test in `self-audit.test.mjs`, and the proof's `--fixture=audit-red` (section 7) makes each one red from the built bundle.

| id | question | red when | data |
|---|---|---|---|
| `audit:expected-present` | Did every check that should run show up? | any manifest id is absent from this run (and not folded): `reg:<id>` for every `PULSE_REGISTRY` row, `job:<job>` for every `JOBS` row, `wf:<id>` for every non-cron function, every slice CHECKS row not in `NOT_LIVE_ROWS` (present itself or in some `also`), the named pulse ids (`health`, `login`, `apply`, `funnel:roadmap-sales`, `suggestions`, `gate-relay`, `recon`, `unrecorded`, `gmail`), and every beat id in `BEAT_FILES` (judged by `audit:hourly-ran`) | this run |
| `audit:lanes-ran` | Did every group of checks finish? | a gap lane in `GAP_LANES` produced no row, or produced a row with `checkId` in `step`, `threw`, `not-listed`, `bad-row` (the lane died or was cut); a slice produced a `load-error` row | this run |
| `audit:not-checked` | Is any live row not checked? | count of final `not_checked` rows is 1 or more | this run, after N/A verify |
| `audit:na-verified` | Is every "nothing to judge" still true? | any `na` row whose code is unknown or whose `verify()` came back false (those rows are first turned to `not_checked`) | `NA_CONDITIONS[*].verify`, one read per code, batched |
| `audit:never-checks` | Is there a check that never really checks? | an id that was `not_checked` (or a `skip`) on each of the last 3 stored mornings | `pulse_scorecards`, newest 3 rows for the org (one read) |
| `audit:count-drop` | Did checks quietly disappear? | claims today (`rows + folded`) are under 90% of the last stored morning's claims (a card from before this change has no `also`, so its claims are its rows), or any group (reg, job, wf, slice, each gap lane) has fewer claims than the same group yesterday while today's manifest for that group did not shrink | `pulse_scorecards` previous row (already read by the pulse) |
| `audit:totals` | Do the report's own numbers add up? | `green + red + na + not_checked !== total`, a status outside the four, or two rows share one id | the built card (before save) |
| `audit:workflow-coverage` | Is every workflow watched? | a bundled function was made on a client other than the shared `inngest` (`fn.client !== inngest`, so it skips both middlewares); a cron function not on `INNGEST_JOBS`; an event function with no `wf:` row | the bundled `functions` |
| `audit:run-recorder` | Is the run recorder itself able to write, and is it writing? | the app role lacks INSERT on `workflow_runs` or `event_handoffs` (`has_table_privilege(current_user, ..., 'INSERT')` is false: the no-deploy switch-off was left on, so every `wf:` N/A is blind; the detail says so); or `event_handoffs` has a row of a trigger name in the last 24 hours while `workflow_runs` has none at all in that time; or `job_heartbeats` has no `inngest` row in the last 15 minutes (the engine is not calling us) | `job_heartbeats`, `workflow_runs`, `event_handoffs`, `has_table_privilege` |
| `audit:briefs-sent` | Did yesterday's morning and evening reports go out? | no `morning_briefs` row for yesterday (Arizona) with `kind='morning'` and `delivery_status='sent'`, or none with `kind='evening'` | `morning_briefs` (default org, not dry run) |
| `audit:hourly-ran` | Did the hourly self-test run all night, every beat? | fewer than 20 distinct `pulse_beats.run_id` in the last 24 hours; a gap over 90 minutes between runs; a beat in `BEAT_FILES` with no row in 24 hours; a beat whose rows are over half `step='deadline'` (it is always cut, so it never really checks) | `pulse_beats` |
| `audit:tripwire-holes` | Does any money or customer door still have only a ping? | `TRIPWIRE_HOLES` (section 5) has any `impact: "money"` entry. The detail also counts customer holes and weak tripwires. | `src/pulse/tripwires.mjs` (bundled) |

(c) "the morning pulse finished and saved by 6:30" cannot be judged by the run it is about. That is the hourly beat's job (4.3). (d) "every job younger than 3 x its schedule" stays the existing `job:*` rows, now also checked hourly by the beat.

### 4.3 The hourly beat `pulse-self`

`src/pulse/beats/beat-pulse-self.mjs`, `kind: "infra"`, `box: false`, `damp: 1`, `deadlineMs: 9000`, `covers: ["job:daily-pulse", "job:evening-brief"]`, reads only through `ctx.read`. Needs `src/pulse/heartbeats.mjs` added to `PURE_IMPORTS` in `src/pulse/beats/contract.mjs` with the reason "pure constants and cron math: JOBS, cronIntervalMs, lastMonthlyFire, STALE_MULTIPLE; no I/O". A fix guide of 300+ characters; `selfTest.pass()` and `fail()` per the v1 contract.

| step | red when (Arizona time) |
|---|---|
| `morning-saved` | after 6:30 a.m., no `pulse_scorecards` row for today with `ran_at` today, or no `morning_briefs` row for today `kind='morning'` sent. Before 6:30: `ctx.skipStep("morning-saved", "before 6:30")`. |
| `evening-sent` | after 9:30 p.m., no `morning_briefs` row for today `kind='evening'` sent. (Judged at the 10:07 p.m. run, which is outside the text window: the incident is saved and texted at 6:07 a.m. per the texting-hours law.) |
| `clocks-fresh` | any `JOBS` row other than `pulse-hourly` whose newest `job_heartbeats` row is older than 3 times its schedule (monthly: `lastMonthlyFire` + 1 day, and only when receipts began before that fire). One query. This is the "outside Inngest" watcher, every hour. |
| `workflow-failed` | any function whose newest `workflow_runs` row is `error`, over 30 minutes old, with no later `ok` row. |
| `handoff-no-run` | any `event_handoffs` row 15 minutes to 3 hours old, whose name is in `EVENT_TRIGGERS`, with no `workflow_runs` row of any function for that `inngest_event_id`. `EVENT_TRIGGERS` is a literal list of `[fn id, trigger names]` in `src/pulse/heartbeats.mjs` (same pattern as `INNGEST_JOBS`, owned by piece B), and `workflow-coverage.test.mjs` fails when it drifts from the bundled functions. A `funnel.*` hand-off starts no workflow, so it is never judged. |

The text line comes from the v1 runner (one incident for the beat, the step that stopped is named, the detail goes only to the ntfy buzz). At most one line per hour, reminders under the v1 rule.

"The hourly pulse ran in the last 90 minutes" is not this beat's job (it cannot see itself not running). Today the morning `audit:hourly-ran` and `job:pulse-hourly` (3 hours) cover it. The 90-minute live check lands with the lanes build as a cross-watch: the minute-37 lane run checks the minute-7 beats ran, and the `lanes-alive` beat checks the lanes ran (section 10).

### 4.4 The build-time guard `src/pulse/workflow-coverage.test.mjs`

Fails the build when any bundled function:
- was not made on the shared `inngest` client from `src/workflows/client.mjs` (`fn.client === inngest`);
- is a cron not on `INNGEST_JOBS` (the existing `heartbeats.test.mjs` check stays; this one names the law);
- has an event trigger whose name is not in `CANONICAL_EVENTS` (`src/events/canonical.mjs`), unless it is in a written allow-list with a reason;
- has no trigger or is disabled and is not in `NOT_LIVE_WORKFLOWS` (new, in `src/pulse/workflow-runs.mjs`, each with a reason of 40+ characters: today `n-01-cold-nurture`, `n-02-warm-nurture`, `n-03-hot-nurture`).

Also: `run-evidence.test.mjs` must show, driving the real `inngest/edge` serve handler with crafted step requests (the measure's technique), that a function's output is identical with the middleware on a db that works, throws, hangs forever, and answers in 5 s; and that the hang case returns inside the cap.

## 5. The 495-surface baseline to zero today

Measured (`baseline-proposal.json`, validated by the measure agent): 317 not customer facing, 42 tripwires with a real deep check, 10 weak tripwires, 126 holes (39 money, 87 customer). Confidence: 224 route rows are sorted by exclusion from map 08 (the weakest evidence).

What the builder does (piece F1):
1. Copy `src/pulse/tripwires-baseline.json` to `src/pulse/tripwires-baseline-2026-10-09.json` (frozen history, 495 entries) and set the live baseline to `[]` with `BASELINE_MAX = 0`.
2. `NOT_CUSTOMER_FACING` gets the 317, each with its reason. For the 224 sorted by exclusion, the builder confirms one mechanical fact per row before it goes in: a route whose handler gates on a staff role (grep the handler for `requireRole` / staff roles), a desk in the staff sidebar of `public/app/shell.js` and not in its portal lists, a job that sends nothing to a client. A row it cannot confirm goes to holes, never to not-customer-facing.
3. `TRIPWIRES` gets the 42 plus the 10 weak ones, the weak ones with `weak: true` and a one-line `weakness`. The existing test still demands a real, existing, non-ping check id for each.
4. `TRIPWIRE_HOLES` (new export): the 126, plus any moved in step 2, each `{ impact, plannedCheck, lane }`. `plannedCheck` comes from the worklist tier 2 table or the proposal's `related_checks`; when neither names one, `plannedCheck: null` and the entry says "check not designed yet". No id is invented.
5. The conflict rows go to holes (stricter wins): `page:consulting/index.html` (map 06 says money). `desk:closer-call.html` stays a money hole. `send:src/push/send.mjs` stays not customer facing with the measure's note.
6. Guards in `tripwires.test.mjs` (never weakened, only added): the live baseline is empty; every `TRIPWIRE_HOLES` key is in the frozen 2026-10-09 file (a new surface can never become a hole: it must be sorted into a tripwire or not customer facing); `HOLES_MAX` equals today's count and may only go down; the frozen file has exactly 495 entries and never changes.

Holes that get a new deep check today (piece F2, new lane `src/pulse/coverage/gap-money-holes.mjs` so no fixer's lane file is touched; ids from the worklist tier 2, grep before naming):

| check | surfaces it closes | reads |
|---|---|---|
| `payments:paid-round-unpaid` | `route:paid-services`, `route:public/slo-repair-checkout` | `paid_service_requests` open with a paid link, or paid with no pull |
| `payments:subscription-due-none-charged` | `job:subscription-billing-sweeper` | due subscriptions with no charge attempt after the due time |
| `partners:sale-no-commission` | `job:af-02-referral-ownership-capture` | a paid sale with a referral row and no commission row |
| `funding:funded-no-invoice` | `job:f-07-funding-locked` | a funded round with no success-fee invoice |

Each: read only, PASS and FAIL tests, `gap-live.mjs` on live, under 20 s, then it moves from `TRIPWIRE_HOLES` into `TRIPWIRES` in the same change. If a check cannot be written honestly from the tables in 45 minutes (wrong table, needs a product change), it stays a hole and the builder says why. Every other hole is staged, listed in `TRIPWIRE_HOLES`, and counted every morning by `audit:tripwire-holes`.

## 6. The standard — exact additions to `.claude/rules/heartbeat-on-every-build.md` and `.cursor/rules/heartbeat-on-every-build.mdc`

Same words in both files. Add a short owner-set line to `CLAUDE.md` (no renumbering). Do not remove the "3 times its schedule" sentence (`heartbeat-law.test.mjs` reads it).

Under the opening paragraphs, add:

> **Extended (owner-set 2026-10-09, afternoon): "not checked" is a heartbeat failure.** When something is live, it is never "not checked". Every row is green, red, or "nothing to judge today" with a condition the pulse re-checks every run. Anything else is red, counted in one line (`audit:not-checked`). The heartbeat also checks itself every morning and every hour: did every check that should run show up, did a group of checks die, did the reports go out, did the totals drop.

Under "Always", add items 15 to 18:

> 15. **Nothing to judge is a condition, not a skip.** A check that has nothing to judge returns `status: "na"` with `na: { code, args }`. The code must be in `NA_CONDITIONS` (`src/pulse/na-conditions.mjs`) with a `verify()` that reads the same data and a PASS and a FAIL test. "We cannot see it from here" is never a condition. A failed read is still `skip`, and in production that is red.
> 16. **Every workflow is on the shared client.** Make Inngest functions only with `inngest` from `src/workflows/client.mjs`. Its two add-ons write a receipt for every run: crons to `job_heartbeats`, every other run to `workflow_runs` (a start mark and a finish mark), and every event handed to the engine to `event_handoffs`. `src/pulse/workflow-coverage.test.mjs` fails a function made any other way, a cron not on `JOBS`, an event that is not canonical, or a switched-off function with no reason in `NOT_LIVE_WORKFLOWS`. Never add a write to these hooks that can throw or wait more than the cap.
> 17. **A slice row that says "covered" must point at a check that ran.** The pulse folds it into the real row (`src/pulse/coverage/link.mjs`). A claim that points at nothing is red. A row that is not a live surface goes on `NOT_LIVE_ROWS` with a reason, not on the scorecard.
> 18. **The self-audit stays able to go red.** Each `audit:*` row in `src/pulse/self-audit.mjs` and each step of the `pulse-self` beat has a FAIL test, and `npm run pulse:prove -- --fixture=audit-red` must turn every one of them red from the built bundle.

Under "Never", add:

> - Leave a live row "not checked", or turn a skip into N/A without a condition the pulse re-checks.
> - Make an Inngest function on its own client, or remove an add-on from the shared client without Chris saying so.
> - Read a repo file at run time from a slice, a lane or a beat (it ships empty and the rows vanish).
> - Add a surface to `TRIPWIRE_HOLES`, or raise `HOLES_MAX`. Weaken `src/pulse/self-audit.test.mjs` or `src/pulse/workflow-coverage.test.mjs`.

## 7. Proof

`npm run pulse:prove` (default) gains a second half, from the same built api bundle, against live data, read only (same harness: `BEGIN READ ONLY`, poisoned `DATABASE_URL`, GET and HEAD only, recording sinks):
- `runDailyPulse` from the bundle with `dryRun: true`, `sendPulseText: false`, `recordRun: false`, `persist: false` (new parameter: no `saveScorecard`, no agent run; the board file goes to a temp folder), `coverageRows` from the coverage half, the `wf:` rows from `checkWorkflowRuns`, `gateRelayDirs: null`.
- Must be true, or exit 1 and print each problem:
  - every scorecard status is one of the four; `green + red + na + not_checked === total`; no duplicate id;
  - **`not_checked` is 0**, except rows whose detail names a masked key on this laptop (printed as "laptop only", never counted green). Today this also needs open decision 2 (`gate-relay`) and the two repair rows of section 2.1; until those land, the proof prints them by name and fails;
  - every `na` row has a known code and its `verify()` re-runs true on the read-only box;
  - `foldCoverage` dangling is 0; `folded` is about 330 (176 registry claims + 96 workflow claims + about 58 cron claims, minus the rows that keep their own evaluation; the exact number is printed and stored);
  - all 12 `audit:*` rows are present; every one is green except `audit:tripwire-holes` (expected red while money holes remain, printed). Before ship, `audit:run-recorder` reads red on the live database (the two tables do not exist yet); the proof prints that one by name and accepts it only when the reason is "table missing";
  - 0 `load-error` rows; every gap lane produced at least one row; `run-pulse` step under 20 s; `coverage-workflow-runs` under 5 s;
  - 65 `wf:` rows, 0 of them `skip`.
- `--fixture=audit-red`: the same run with a lane that throws, a slice claim to a registry key that does not exist, an `na` row whose verify is false, 15% of rows removed, a fake function on a second client, a card whose totals are off by one. Exit 0 only if `audit:lanes-ran`, `audit:not-checked`, `audit:na-verified`, `audit:count-drop`, `audit:workflow-coverage`, `audit:totals`, `audit:expected-present` are all red. This is what proves the audit has teeth.
- `--middleware`: imports `src/pulse/run-evidence.mjs` and `src/workflows/client.mjs` from the bundle and drives a real two-step function through the bundled `inngest/edge` serve handler, with the db replaced by: the read-only box (writes refused), a db that throws, one that never answers. Must be true: the function's output is identical in all three; each hook returns inside its cap; nothing was written.
- `--beats`: `pulse-self` runs from the built `pulse-hourly` bundle like the other beats; green or red with a real reason; `--selftest pulse-self` shows it green and red.

After ship, the integrator watches: the 3.3 watch rule (60 minutes); the first `workflow_runs` and `event_handoffs` rows (first real event); at 7:07 a.m. tomorrow `pulse-self` `morning-saved` green; tomorrow's scorecard: `not_checked_count = 0`, `na_count` about 70, the `audit:*` rows as above.

## 8. How this fits with the hourly lanes design, and which goes first

**This goes first.** It decides what "checked" means; the lanes build then reuses it. Fit, point by point:
- Status: lanes treat `na` like `SKIP` (nothing to do, no text) in `decideLanes`; `GAP_STATUSES` gains `na` here, once.
- Migration numbers: this work takes the next free number (476 today, `ls db/migrations` first). The lanes migration takes the one after, as its own spec already says ("use the next free number").
- `src/pulse/beats/index.mjs`: this adds `beat-pulse-self.mjs`; lanes adds `beat-lanes-alive.mjs`. The integrator alone edits that list.
- The 90-minute watch of the hourly pulse is part of the lanes build (cross-watch, section 4.3). `audit:lanes-ran` gets an hourly twin there (`lane-<id>` summary rows with `ok=false`).
- `src/pulse/registry.mjs` and `src/pulse/tripwires.mjs` are edited by both builds: this build lands first and the lanes builder rebases on it. The new `NOT_CUSTOMER_FACING` entries the lanes need (`send:src/pulse/lanes/alerts-lanes.mjs`) go in after the baseline is empty, so they are a normal sort, not a baseline add.

## 9. Split and order — Sonnet builders, exclusive files

Rules for every builder: work in your own worktree (`.claude/worktrees/<piece>`), never the main checkout; no commit, push, stash, checkout of main, ship or deploy; no database write (live reads only, `BEGIN READ ONLY`); no POST, no send, no AI call; no new dependency; no repo file read at run time; ids unique across `src/pulse/**` (grep first; other sessions edit live); copy each finished file to `<SCRATCH>/zu-backup/<piece>/`; stuck rule (two tries, then stop and report); Fundhub; 4th grade English in any words a human reads; write your manifest on the board (`ops/workflows/zero-unchecked-2026-10-09/board.md`, the integrator creates it).

Wave 1, five at once (no shared files):

| piece | owns (exclusive) | acceptance |
|---|---|---|
| A status model and migration | `src/pulse/na-conditions.mjs` (+test; `verify()` for `no-demand`, `no-trigger`, `not-registered`, `monthly-not-due`; the four lane codes as `verify: "lane"`, which G fills through each lane's `naVerify` export), `src/pulse/scorecard.mjs` (+test), `summarizeSystems` in `src/ops/morning-brief.mjs` (+ its test lines), `db/migrations/476_zero_unchecked.sql` (scorecard `na_count` + four-status CHECK, `workflow_runs`, `event_handoffs`), `db/expected-migrations.mjs` | constraint `.pg.test.mjs` in one rolled-back transaction: a four-status card saves, a wrong count is refused, the app role cannot DELETE either new table; legacy-shape fallback test; summary line and red ordering tests |
| B run evidence | `src/pulse/run-evidence.mjs` (+test, serve-handler test of 4.4), `src/pulse/workflow-runs.mjs` (`checkWorkflowRuns`, `NOT_LIVE_WORKFLOWS`, +test, + `.pg.test.mjs`), `src/pulse/heartbeats.mjs` (cap, `ok:false`, and the literal `EVENT_TRIGGERS` list only, +test lines), `src/workflows/client.mjs` (the 3 lines), `src/pulse/workflow-coverage.test.mjs` | every row of the 3.4 table, PASS and FAIL; output unchanged with a throwing, hanging, slow db; caps hold; list of the 16 crons that return `ok:false`, with what that means for each, on the board |
| C fold and slice fixes | `src/pulse/coverage/run-slices.mjs` (+test: `foldInto`, `na` in `GAP_STATUSES`), `src/pulse/coverage/link.mjs` (`ALIASES`, `NOT_LIVE_ROWS`, `foldCoverage`, +test), `slice-06-briefs.mjs`, `slice-09-documents.mjs`, `slice-11-hiring.mjs`, `slice-23-pages.mjs` (+ their tests) | 176 of 176 registry claims fold on the live scorecard rows (`slice-link-map.json` as the fixture); the 15 no-match rows each end where section 2.1 says; the four slices load with no `fs`; no slice test weakened |
| D self-audit | `src/pulse/self-audit.mjs` (`auditPulse`, `buildManifest`, +test with a PASS and a FAIL per row) | each of the 12 rows of 4.2 goes red on its fixture and green on a clean one; no read without a catch; under 3 s on live |
| F1 tripwire sort | `src/pulse/tripwires.mjs`, `src/pulse/tripwires.test.mjs`, `src/pulse/tripwires-baseline.json`, `src/pulse/tripwires-baseline-2026-10-09.json` (new) | baseline `[]`, `BASELINE_MAX = 0`; 317 / 52 / 126 (or the moved counts, listed on the board with the reason for each move); the four new guards of section 5; `isPingId` knows `wf:`; the full tripwire test green |

Wave 2, after A's contract is on the board (they only need A's exported names, not its merge):

| piece | owns | acceptance |
|---|---|---|
| E hourly beat | `src/pulse/beats/beat-pulse-self.mjs` (+test), the `PURE_IMPORTS` line in `src/pulse/beats/contract.mjs` | v1 beat contract; each step red on a fixture; SQL tested read only on live; `run-beat.mjs pulse-self` and `--selftest` |
| F2 money holes | `src/pulse/coverage/gap-money-holes.mjs` (+test) | the 4 checks of section 5 or a written reason per check; `gap-live.mjs gap-money-holes` under 20 s |
| G lane N/A | `gap-ads.mjs`, `gap-leads.mjs`, `gap-pixels.mjs`, `gap-social.mjs` (+ their tests): only the seven "nothing to judge" branches measured live, each returns `na` with A's code, and each file exports `naVerify` for its codes (re-using the file's own SQL and minimums) | each of the 7 rows `na` on live with verify true; a fixture where the condition is false makes the row a normal PASS or FAIL, never `na` |

Wave 3, the integrator (Claude main, Opus):
- `src/pulse/daily-pulse.mjs`: call `foldCoverage`, take the `wf:` rows, call `auditPulse`, add `persist`; `src/workflows/daily-pulse.mjs`: the `coverage-workflow-runs` step; `src/pulse/coverage/modules.mjs`: the `gap-money-holes.mjs` line; `src/pulse/beats/index.mjs`: the `beat-pulse-self.mjs` line; `scripts/pulse/prove.mjs`: section 7; both heartbeat rule files and the `CLAUDE.md` line (section 6); `docs/journeys/heartbeat-flow.md` and `docs/journeys/CHANGELOG.md`; the board.
- Merge order: A, B, C, D, F1, then E, F2, G. Full `npm test`, `npm run lint`, `npx tsc --noEmit`, `npm run pulse:prove` (all four modes). Ship once (`npm run ship`, which applies 476 before the deploy). Then the watch rule.
- Check before merge: the fix-batch pieces that may touch the same files (F1b `gap-payments`/`gap-portal`, F2a `gap-handoff`/`gap-email`, F5b `slice-03-marketing`/`gap-sms`). This split avoids every one of those files on purpose.

Hot-path files and the switch-off for each:

| file | change | switch-off |
|---|---|---|
| `src/workflows/client.mjs` | add the `runEvidence` middleware (every workflow request on launch day) | no deploy: `REVOKE INSERT, UPDATE ON workflow_runs FROM fundhub_app; REVOKE INSERT ON event_handoffs FROM fundhub_app;`. With a deploy: drop it from the array |
| `src/pulse/heartbeats.mjs` | cap on the cron receipt; `ok:false` recorded as `error` | revert the two lines and ship. The cap only makes a slow write give up sooner |
| `src/pulse/daily-pulse.mjs`, `src/workflows/daily-pulse.mjs` | fold, wf rows, audit, one new step | each new stage is wrapped: a throw is one red `audit:crashed` row and the morning text still goes. Revert and ship if the 6 a.m. run fails |
| `src/pulse/scorecard.mjs` + migration 476 | `na` status and `na_count` | the legacy-shape save keeps the report if the migration is missing |
| `src/ops/morning-brief.mjs` | `summarizeSystems` only | pure; revert |
| `src/pulse/beats/index.mjs` | + `pulse-self` | remove the line |
| `src/events/bus.mjs`, `netlify/functions/api.mjs`, `public/app/morning-brief.html` | NONE | n/a |

What cannot be finished safely today, said plainly:
- A dropped send (`void inngest.send` lost when the server freezes) still leaves no trace. Fixing it means editing `src/events/bus.mjs` (every event in the company). Staged.
- "A sleeping run that never woke up". Needs each workflow's longest wait. Staged.
- The bus twin receipt for the 61 in-process handlers (the two repair rows). Staged.
- 122 of the 126 holes stay holes tonight (counted every morning by one red line).
- About 620 `skip` branches in the gap files are not reviewed. Only the 7 that fire on live today become `na`. Any other that fires in production lands in the one red line, and is converted the day it shows up.
- The 90-minute watch of the hourly pulse (lanes build).
- The middleware's live proof needs a real event; none of the 22 trigger events has been emitted since 10-07. The first hand-off after ship is the first live proof. The optional hourly canary (open decision 5) would prove it within the hour.

## 10. Not now

Retention of `workflow_runs`, `event_handoffs` and `job_heartbeats` (a delete-data decision nobody has made). The Inngest REST API second opinion. A fourth tile on the report page. The bus twin receipt. Per-lane env. The lanes build (next).

## 11. Decisions only Chris can make (yes or no)

1. Turn on the run receipts on every workflow today, launch day? (Yes = ships with this batch, with the no-deploy switch-off ready. No = everything else ships today and the receipts tomorrow.)
2. `gate-relay` (the Mac messenger): stop checking it from the server pulse? (Yes = the row leaves the report. No = it stays red every morning until the Mac sends its heartbeat to the server.)
3. Money doors that only have a ping: one red line every morning until each has a deep check? And count the 87 customer doors in that red too?
4. Add a fourth tile, "Nothing to judge today: N", to the report page? (A marked draft first.)
5. Add an hourly test signal through the workflow engine (a do-nothing workflow, about 1,500 extra Inngest runs a month, no customer touched), so "nothing came in" is proven, not assumed?
