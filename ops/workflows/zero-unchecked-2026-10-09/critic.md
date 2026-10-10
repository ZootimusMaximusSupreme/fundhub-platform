# Zero-unchecked design — critic findings (Opus, 2026-10-09)

Verdict: **go-with-changes**

Verdict: go, but only with a smaller build today and the fixes below. The plan as written should not ship today.

What holds up after reading the code:
- Inngest 3.54.2 behaves the way the spec says. In v1.js line 694, `finished` runs only on the last request of a run. It runs once when a run succeeds and once for every failed attempt.
- `onFunctionRun` is awaited (`getHookStack`). So a throw inside it breaks every workflow, and every hook really must be wrapped.
- The table permissions are fine. The 430 policy is `USING (true) WITH CHECK (true)` for every action, so the UPDATE in an upsert works under FORCE row-level security.
- The bus is the only place that calls `inngest.send`. Nothing uses `step.sendEvent`, and no function uses debounce, rate limits or an `if` on its trigger. So the "handed off, never started" rule will not fire falsely because of those.

What breaks, in short:
1. Migration 476 is already taken. The texting-hours fixer has it in a worktree.
2. The proof cannot pass before ship. The new tables do not exist yet. `gate-relay` waits on Chris. Two repair rows have no fix. No piece owns the monthly "too soon" job rows.
3. A run that was killed at 26 seconds, crashed, or used up its retries in Inngest reads PASS ("Running, asleep") forever. 45 of the 62 event workflows never sleep.
4. Retries raise red during normal backoff.
5. 20 workflows return `{skipped:true}` and get counted as ok.
6. The "nothing to judge" check for idle workflows only reads the run-receipt tables. If the receipts stop or are switched off, all 65 rows go quiet.
7. Sorting the 495 surfaces mislabels real money and customer work as not customer facing. The new guard also pushes future money surfaces into that same bucket.
8. Reds that stay red for weeks push new reds out of the morning text.

A better design for hand-offs: drop `event_handoffs` and `onSendEvent`. Store `ctx.event.data.id` on each run. The bus always sends the `events.id` there. Then judge "an event came and nothing ran" straight from the `events` table. That catches a lost send without editing `bus.mjs`, and it takes a write off every web request.

Safe today (report side only):
- The `na` status and its conditions.
- Folding the 176 copy rows, plus aliases and the not-live rows.
- The 4 slice files rewritten to stop reading repo files.
- The 7 lane "nothing to judge" rows.
- The cheap audit rows: `audit:not-checked`, `totals`, `expected-present`, `lanes-ran`, `na-verified`, `workflow-coverage`.
- `wf:` rows judged from the `events` table.

Later, as its own ship once Chris says yes to decision 1: the run-receipt add-on, with the fixes below and the canary.

Must wait:
- F1, the bulk sort of the 495 surfaces.
- F2, the 4 new money checks.
- The hourly beat E. It needs the texting-hours work to land first, and a live measure first.
- `audit:count-drop`, `never-checks`, `hourly-ran`, `briefs-sent`.
- `audit:tripwire-holes`, which waits on decision 3.

Files I checked: `src/workflows/client.mjs`, `src/pulse/heartbeats.mjs`, `src/db.mjs`, `src/events/bus.mjs`, `node_modules/inngest/components/execution/v1.js` (lines 620-700 and 1079), `components/InngestMiddleware.js` (line 67), `components/Inngest.js` (lines 505-600), `db/migrations/430_pulse_scorecards.sql`, `src/pulse/scorecard.mjs`, `src/pulse/tripwires.mjs`, `public/app/morning-brief.html`, `ops/workflows/zero-unchecked-2026-10-09/baseline-proposal.json`, and `.claude/worktrees/wf_bde8b523-25c-1/db/migrations/476_morning_briefs_held_quiet_hours.sql`.

## 1. [BLOCKER] migration / collisions

**What:** Migration number 476 is already used by the texting-hours fixer (piece Q). The spec names its own migration db/migrations/476_zero_unchecked.sql.

**Failure scenario:** Two 476_ files land. db/expected-migrations.mjs is generated in two branches and they conflict. migrate.mjs applies the two files in name order, so the integrator's regenerated list fails or drifts. /api/health reads 'behind' after ship.

**Evidence:** .claude/worktrees/wf_bde8b523-25c-1/db/migrations/476_morning_briefs_held_quiet_hours.sql exists. It widens the morning_briefs delivery_status check to add 'held_quiet_hours'. The lanes build also takes 'the next free number'.

**Fix:** Merge Q first. Then take the next free number (477 or later, after `ls db/migrations` on merged main). Regenerate with `npm run migrations:manifest` only on the integrated tree. The lanes build takes the number after that.

## 2. [BLOCKER] proof / ship gate

**What:** The proof as written cannot exit 0 before ship, so ship is blocked or someone fudges the gate.

**Failure scenario:** The integrator hits exit 1 at ship time on launch day and either does not ship or weakens the proof by hand.

**Evidence:** Spec section 7 needs '65 wf: rows, 0 of them skip'. But before ship the tables do not exist: checkWorkflowRuns rule 6 makes every row skip, and the proof accepts 'table missing' only for audit:run-recorder. It also needs 'not_checked is 0', but it admits gate-relay (decision 2) and the two repair rows 'fail' today. job:affiliate-payout-run and job:partner-production-floor come out of checkJobHeartbeats as skip ('too soon', heartbeats.mjs around line 238). No piece owns turning that skip into na monthly-not-due: piece B owns only 'cap, ok:false, EVENT_TRIGGERS'.

**Fix:** Give piece B the change in checkJobHeartbeats: the too-soon branch for monthly jobs returns {status:'na', na:{code:'monthly-not-due', args:{cron}}}. Make the proof accept one closed, printed list and nothing else: rows whose reason is 'table missing (42P01)' before ship, gate-relay named as 'waits on decision 2', and the two repair rows, each with a leftover card id. Any other not_checked row fails the proof.

## 3. [BLOCKER] false green: wf rules

**What:** Rule 4 gives PASS ('Running, asleep since t') to any run that has a start mark and no finish. Most runs like that are dead, not asleep.

**Failure scenario:** s-00-welcome hits the 26 s cut on every attempt. workflow_runs keeps only its start row, and the morning report shows wf:s-00-welcome green for 30 days while no lead gets a welcome. That is the silently-stopped case the audit exists to catch.

**Evidence:** Inngest calls `finished` only when the SDK handles the last request (v1.js line 694). The SDK never hears about a request Netlify kills at 26 s, a crashed container, a run that used up its retries in Inngest Cloud, or a run cancelled by cancelOn (9 files use cancelOn). Only 17 of the 62 event workflows sleep (measure section 2).

**Fix:** Add a literal SLEEPERS map in src/pulse/workflow-runs.mjs: { fnId: longestWaitMs } for the 17, test-guarded by grepping step.sleep, waitForEvent and sleepUntil in the bundled source at build time. Add a rule before rule 4. A non-sleeper with a start and no finish older than 30 minutes is FAIL 'started, never finished'. A sleeper older than its longest wait + 1 day is FAIL. Only a sleeper inside its wait is PASS 'asleep, waits by design'. A cancelled run (cancelOn) counts as asleep, not FAIL, until its longest wait has passed.

## 4. [HIGH] false alarm: retries and rule 6

**What:** Every failed attempt writes outcome='error'. The morning rule waits 2 h and the hourly beat waits 30 min, but neither knows whether more retries are coming. Two normal states also fall into rule 6 and read 'a read failed'.

**Failure scenario:** A booking event arrives at 5:59 a.m. The 6:00 pulse reads it before the run starts and shows a red 'read failed'. Or a workflow on attempt 2 of 5 texts Chris hourly at minute 30 and then heals by itself.

**Evidence:** `finished` runs for every failed attempt, before the SDK decides whether to retry (v1.js lines 694-700). Default retries are 4, and the backoff is set by Inngest's server, not bounded by 2 h in the SDK. The rule table has no row for (a) a newest error that is not final with no earlier ok, or (b) a hand-off younger than 15 minutes with no run yet. Both reach rule 6 'skip', which lands not_checked, which is red.

**Fix:** Store attempt and max_attempts (ctx.maxAttempts) and final = attempt+1 >= maxAttempts OR result.error.name === 'NonRetriableError'. Red only on final=true. Morning and hourly use one rule, exported from workflow-runs.mjs. Add explicit rows: 'retrying (attempt n of m)' and 'just handed off (< 15 min)'. Both are na codes with verify(), or PASS-pending; never rule 6.

## 5. [HIGH] hand-off design

**What:** The event_handoffs write from onSendEvent runs inside the web request's un-awaited `void inngest.send` promise. A lost send leaves no trace at all (the spec says so in section 9). There is a simpler and stronger independent witness.

**Failure scenario:** INNGEST_EVENT_KEY breaks, or a send is dropped by `.catch(()=>{})`. No hand-off row is written, no run happens, and every wf: row reads 'nothing to judge' while leads get nothing.

**Evidence:** bus.mjs lines 49-53 call `void inngest.send({ name, data: { id, payload, orgId, clientId } })`, where data.id is the events row id. A grep finds no other inngest.send and no step.sendEvent in src, api or netlify. In Inngest.js, transformOutput runs after the HTTP send returns, so the write happens after the web answer, possibly in a container Netlify has frozen. None of the skipInngest emitters use any of the 22 trigger names: commission.approved, nudge events, funnel.*, slo.engagement, rb2b. The journeys runner rolls back its own events rows.

**Fix:** Drop event_handoffs and onSendEvent today. Add bus_event_id = ctx.event.data?.id (uuid text, nullable, indexed) to workflow_runs. Rule 3 becomes: an events row with name in that function's triggers, created_at since `since` and over 15 minutes old, with no workflow_runs row of this function where bus_event_id = events.id, is FAIL 'event came, workflow never started'. This has no web-path write, catches a lost send without editing bus.mjs, and keeps one hot-path hook.

## 6. [HIGH] false green: N/A verify

**What:** no-demand verifies itself only against the recorder's own tables. If the recorder is off, every wf: row says 'nothing to judge' and the audit does not notice.

**Failure scenario:** Decision 1 = No, or run-evidence is dropped from client.mjs in a later edit. The tables exist and are empty, all 65 rows verify 'no demand', and audit:run-recorder stays green.

**Evidence:** In section 1.2, no-demand is true when event_handoffs and workflow_runs have 0 rows. audit:run-recorder checks only the INSERT privilege, 'handoff without run', and job_heartbeats inngest rows. Cron receipts come from a different middleware, so they stay green when run-evidence is removed from the array, when decision 1 is No and the tables exist empty, or when the UPDATE grant is revoked.

**Fix:** no-demand verify must also read `events` for that function's trigger names since `since`. Zero events is the only true condition. Add to audit:workflow-coverage, from the bundle: the shared client's middleware list includes 'Run evidence'. Check has_table_privilege for UPDATE as well as INSERT. If the add-on does not ship today, wf: rows with any trigger event since `since` are not_checked 'event came, no run receipt', never na.

## 7. [HIGH] false green: swallowed work

**What:** 'Returned normally' is recorded as ok even when the workflow skipped its work.

**Failure scenario:** A workflow that skips every run because a key or switch is off shows green 'last run finished ok' every morning.

**Evidence:** 20 workflow files return a skipped shape. Examples: document-vault-chase.mjs:57 `{ skipped: true, reason: 'switched_off' }`, c-06-crs-results-router.mjs:182 and ds-02-diy-letters.mjs:119 `{ delivered: true, skipped: true }`, ar-collections `{ skipped: true, reason }`. The spec counts only result.error or data.ok === false as an error.

**Fix:** Add skipped boolean and note text (redacted, 120 characters) to workflow_runs, set when result.data.skipped === true. The PASS detail says 'ran, skipped: <reason>'. If the last 3 runs of a function all skipped, the row is FAIL 'every run skipped: <reason>'.

## 8. [HIGH] hot path: cap too short

**What:** The 1.5 s cap on the finish write, and the same cap added to cron receipts in recordHeartbeat, can drop real receipts on a cold container.

**Failure scenario:** A daily cron, such as the 7:30 sweepers, finishes on a cold container. Its receipt write passes 1.5 s and is dropped. The next morning job:<id> reads red 'no run' (a false alarm). For event runs, a dropped finish plus the fix to the start-without-finish false green above gives a false 'started, never finished' red.

**Evidence:** src/db.mjs builds the pool lazily. The first query in a fresh container opens a TLS connection to the pooler, and connectionTimeoutMillis is 5000. With pg 8.22, query_timeout cancels on the client side and the pool then destroys that client.

**Fix:** Set the finish and cron-receipt cap to clamp(20_000 - elapsed, 500, 5_000). Keep 800 ms only for the start mark. Wrap the db.query call itself in try (pool() throws synchronously when DATABASE_URL is unset, which escapes Promise.race). Add a per-container circuit breaker: after 3 failures or timeouts, skip run-evidence writes for 10 minutes and log once. REVOKE does not help when the database itself is slow, because each write still takes a pooled connection.

## 9. [HIGH] baseline: mislabelled surfaces

**What:** Sorting by exclusion, then confirming with a staff-role gate, proves who clicks a door, not whether it moves money or reaches a customer. The proposal has wrong calls. The new guard ('a new surface can never be a hole') pushes future money surfaces into NOT_CUSTOMER_FACING.

**Failure scenario:** A broken commission rule or a dead funding inbox is filed 'not customer facing'. It never shows in audit:tripwire-holes, and the guard makes that label permanent.

**Evidence:** baseline-proposal.json not_customer_facing includes: job:f-10-client-funding-inbox-provisioner (makes the client's funding mail address; mail.response feeds f-06/f-09/f-11); job:finance-os-trend-snapshots (feeds route:money/trends, itself a customer hole); job:n-04-post-funding-nurture (texts and emails clients, deep check nurture:never-queued, so it is a tripwire, not internal); route:commissions, route:commission-rules, route:read/commissions, desk:products-commissions.html (pay rules); route:partners/approve; route:read/invoices; route:finance/subscriptions; route:public/rb2b-webhook (public lead intake); jobs c-05, f-01, f-08, s-06, s-08 (the advisor task after a funding event; no task means the client's funding stalls). 224 rows have confidence 'map-by-exclusion'.

**Fix:** Do not run F1 today; zero 'not checked' on the report does not need it. When it runs, add a second mechanical test, enforced by tripwires.test.mjs for every NCF route or job: the handler or job file, plus its direct imports, must not import src/messaging/providers/*, src/commissions/*, src/payments/*, or charge or payout modules, and must not INSERT or UPDATE money tables (sale_payments, invoices, commission_ledger, affiliate_payouts, subscriptions, paid_service_requests). A hit cannot be NCF. Move n-04 to TRIPWIRES. Move the f-10, finance-os-trend, commissions, partners/approve, invoices and funding-task jobs to holes, or to Chris as named calls.

## 10. [HIGH] false alarm: standing reds

**What:** Reds that stay red for weeks fill the top of the morning text and hide new reds. 'Nothing needs you' cannot show for weeks.

**Failure scenario:** A job dies overnight. It is a plain red with no tripwire and lands at place 5 or later, behind audit:tripwire-holes, audit:not-checked and gate-relay, so the morning text says 'and 4 more'.

**Evidence:** Section 1.3 orders money tripwire reds, then customer tripwire reds, then audit:*, then the rest, and the text shows only the first 3. audit:tripwire-holes is red by design while about 35 money holes remain, and decision 3, which asks whether Chris wants that, is still open. gate-relay stays red until decision 2. The page shows 'Red · day N' from day_count.

**Fix:** Sort first by day_count === 1 (new today), then by the tripwire and audit order. Until Chris says yes to decision 3, audit:tripwire-holes is a count in the systems line ('35 money doors still only pinged'), not a red row. Keep gate-relay as is pending decision 2.

## 11. [HIGH] time and scope

**What:** The full plan is 8 builder pieces, an integrator, a migration, a hot-path add-on, 4 new proof modes and a rules change. It is being merged on launch day into the same files that 9 fixers are changing.

**Failure scenario:** A large merge plus a hot-path change go out in one deploy. If the 6 a.m. run or a customer's workflow breaks, there is no way to tell which change did it.

**Evidence:** Q (texting hours) edits src/pulse/notify.mjs, the brief send path and migration 476. F5b edits slice-03-marketing and gap-sms. The integrator owns daily-pulse.mjs, which Q also touches. The middleware cannot be proven live today, because none of the 22 trigger events has fired since 10-07, so its first live run is a real customer's run.

**Fix:** Ship 1 today, report side only: A (na status, na_count, conditions), C (fold, aliases, NOT_LIVE_ROWS, 4 slices without fs), G (7 lane na), the monthly na in checkJobHeartbeats, wf: rows judged from the events table, and the pure audit rows: not-checked, totals, expected-present, lanes-ran, na-verified, workflow-coverage. Ship 2, only after decision 1 = yes, as its own deploy: run-evidence (start mark in onFunctionRun, finish, bus_event_id, skipped, final flag, circuit breaker), plus the canary in decision 5 as the live proof. Wait: F1, F2, E (after Q lands and clocks-fresh is measured on live), count-drop, never-checks, hourly-ran, briefs-sent, tripwire-holes.

## 12. [MEDIUM] middleware mechanics

**What:** The start mark is put in a transformInput hook. Adding any transformInput hook makes the SDK rebuild fnArg and stepState on every request, a path this app has never run.

**Failure scenario:** A subtle memoization difference, for example parallel steps or a hashed id not equal to step.id, makes a multi-step workflow re-run a step on launch day.

**Evidence:** v1.js lines 668-679: when the merged result has steps, stepState is rebuilt from steps keyed by step.id, and fnArg is replaced. getHookStack always returns steps once any middleware defines transformInput. onFunctionRun already receives `steps` and is awaited (InngestMiddleware.js line 75; v1.js line 1081).

**Fix:** Write the start mark inside an async onFunctionRun when steps.length === 0 and attempt === 0, wrapped and capped. Return only { finished }. The serve-handler test must cover a 3-step function with one parallel group, with output and step count identical with the add-on on and off.

## 13. [MEDIUM] self-audit false alarms

**What:** audit:count-drop goes red on day one and on any real removal of a check. The per-group test has no stored manifest to compare against.

**Failure scenario:** Tomorrow's first text includes 'audit:count-drop' red for a change that was on purpose.

**Evidence:** Yesterday's card is in the old shape with 1,008 rows and no per-group claims. The fold and the 5 NOT_LIVE_ROWS reshape the slice group. F5b is removing false-alarm checks today. Gap lanes emit varying row counts.

**Fix:** Store manifest_counts per group (jsonb) on each scorecard. Skip the comparison when the previous card has none. Compare manifest-declared ids only, not row counts. Or defer this row. expected-present already covers 'a check went missing'.

## 14. [MEDIUM] self-audit coverage

**What:** The expected-present manifest leaves out gap-lane check ids. A lane that quietly stops sending one of its checks still passes.

**Failure scenario:** A fixer adds an early return in gap-payments. payments:paid-no-entitlement disappears, the lane still sends 5 other rows, and the audit stays green.

**Evidence:** Section 4.2's manifest lists reg, job, wf, slice, named and beat ids. audit:lanes-ran fires only when a lane sends no row or a step/threw/bad-row row. 29 of 41 gap files already export a CHECKS or ids list (grep).

**Fix:** Add each gap lane's exported id list to buildManifest. Write one leftover card for the 12 lanes that do not export a list.

## 15. [MEDIUM] fold alias

**What:** Aliasing morning-brief to job:daily-pulse folds the claim into a row judged by the same run it is about.

**Failure scenario:** The morning brief stops going out, and the folded claim stays green for 3 days.

**Evidence:** Measure section 5.4: job:daily-pulse shows yesterday's receipt during today's run, so a pulse that does not run looks fresh for 3 days.

**Fix:** Fold 06-briefs:morning-brief into audit:briefs-sent, which reads morning_briefs, or keep its own row reading morning_briefs for today. Treat delivery_status 'held_quiet_hours' (from Q's migration) as not sent, with that exact reason.

## 16. [MEDIUM] hourly beat

**What:** pulse-self texts every hour and depends on code that is not in main yet. Its clocks-fresh step repeats the job:* rows.

**Failure scenario:** A stale job, or a non-final error under the 30-minute rule, sends Chris a line every hour from launch, or outside 6 a.m. to 10 p.m. if the beat lands before Q.

**Evidence:** src/pulse/quiet-hours.mjs does not exist on main (grep). Q is still in a worktree. No live measure shows how many JOBS are stale right now. evening-sent is judged at 10:07 p.m., outside the texting window, and also repeats audit:briefs-sent.

**Fix:** Build E only after Q is merged. Run its SQL read-only on live first and post the step results on the board. Use the shared final-error rule. Let the 6:07 a.m. morning-saved step carry the late evening result instead of a separate 10:07 p.m. red.

## 17. [MEDIUM] post-ship watch

**What:** The watch rule measures something run-evidence cannot affect, and no live event exercises the new code.

**Failure scenario:** The first event run after ship is a real customer's. A problem shows up hours later, after the 60-minute watch has ended.

**Evidence:** run-evidence returns {} for inngest/scheduled.timer, so the number of job_heartbeats rows per 10 minutes cannot show harm from it. No trigger event has fired since 10-07 (measure section 2).

**Fix:** Watch the [run-evidence] log lines, workflow_runs rows with outcome 'error', and the /api/inngest error rate. Make the decision-5 canary part of decision 1: a do-nothing function on 'pulse.canary', with the event sent hourly by pulse-hourly. It is the live proof inside the first hour. REVOKE remains the no-deploy switch-off.

## 18. [LOW] audit day one

**What:** audit:hourly-ran needs 20 runs in 24 h. pulse_beats is new (migration 475), so the first morning can be short.

**Failure scenario:** A red the first morning for a beat history that is simply young.

**Evidence:** 475_pulse_beats_incidents.sql is the newest migration on main; the hourly pulse shipped recently.

**Fix:** Use the same 'too soon' logic as checkJobHeartbeats, judged from min(pulse_beats.ran_at).

## 19. [LOW] report page

**What:** With no page change, the Red, Green and Not checked tiles no longer add up to 'Out of N checks', because na is not shown.

**Failure scenario:** Chris sees 3 + 690 + 0 'out of 757' and asks where 64 went.

**Evidence:** public/app/morning-brief.html lines 243-252 show three tiles and 'Out of total checks.'

**Fix:** Keep the page as Chris asked. Put the na count in the systems line, as the spec does. Name it as decision 4 in the reply to Chris.

## 20. [LOW] leftover

**What:** 8 gap files read repo files at run time. Nothing audits whether an empty scan on the server turns into PASS.

**Failure scenario:** A lane reads nothing on the server and reports a clean pass.

**Evidence:** gap-contracts, gap-email, gap-funding, gap-marketing-queue, gap-opt-out, gap-nurture, gap-payments and gap-partners use fs. gap-opt-out's walkSendFiles returns quietly on ENOENT. CLAUDE.md section 12 says folder scans ship empty.

**Fix:** Write one leftover card on the board and do not fix it in this batch.
