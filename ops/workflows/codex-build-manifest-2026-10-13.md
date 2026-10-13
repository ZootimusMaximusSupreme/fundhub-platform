# Codex heartbeat build manifest — 2026-10-13

Branch: `codex/heartbeat-eight-items-build-2026-10-13` (draft PR #41; never main)

This build changes the heartbeat and its proof harness. It does not add or change a product page, route, screen, customer action, send, live database write, secret, dependency, deploy, or product feature. The branch was rebased onto `origin/main` on 2026-10-13; the agent-editor page and its matching e2e-only timeout change were removed from the PR.

## 1. Display lane

- Changed `src/pulse/coverage/gap-catalog-display.mjs` and its test. The runtime imports compiled `generated.json`; it does not read repository files. A row with no measurable action/result contract returns `NOT_PROVED`. A query contract returns `FAIL` only for a measured missing or bad result. Unread pages and invalid redirects remain visible as `skip` or `FAIL` with the reason; nothing throws.
- Included the three PR #37 commits, then added the honest unread-page failure guard.
- Exact display split: 1,123 rows = 1,093 Not proved, 27 measurable query contracts, and 3 verified retired rows.
- Proof: `env -u DATABASE_URL node --test src/pulse/coverage/gap-catalog-display.test.mjs` — 10 passed, 0 failed, 0 skipped. The wider focused heartbeat command below passed 227 of 227.
- Unfinished: none.

## 2. Broken versus Not proved

- Changed the scorecard, self-audit, morning text, existing morning report page, and the route/flow/read gap lanes and tests. `FAIL` always becomes Broken. `NOT_PROVED` is stored as `not_checked` with an explicit marker and remains counted daily.
- Fixed the coverage runner so a gap lane's explicit `NOT_PROVED` status survives to the scorecard instead of being changed to `skip`.
- Final exact Not proved count from the four explicit gap groups: 1,553 = 1,093 display + 310 route + 123 flow + 27 read. The other 160 flow rows are honest N/A inactive controls, not Not proved.
- Fixed `audit:na-verified`: the old single 2.5-second deadline included time spent waiting behind its eight workers, which could incorrectly call queued rows stale under load. Each started check now gets its own 2.5 seconds and the whole N/A audit hard-stops at 15 seconds. A verifier answer of `ok:false` stays Broken; a timeout, throw, or unread result is `skip` with the exact reason and remains visible through the red `audit:not-checked` row.
- Claude's saved output named six of the 27 affected rows, and all six said `took too long`: `checkout:funnel-no-sale`, `gap-leads:lead:pipe-cut-with-traffic`, `gap-leads:lead:slo-contact-not-in-clickfunnels`, `msg:dead-senders`, `gap-pipeline-boards:pipeline:dead-stage`, and `social:video-stats-stale`. The other 21 ids were truncated from the saved output, so they are not invented here. No live database rerun was used to recover them.
- Proof: the focused Node suite passed 197 tests with 0 failed and 0 skipped. `E2E_PORT=43129 npx playwright test e2e/morning-brief.spec.mjs` passed 15 tests with 0 failed and 0 skipped.
- Repair proof: `env -u DATABASE_URL node --test src/pulse/self-audit.test.mjs src/pulse/na-conditions.test.mjs` — 140 passed, 0 failed, 0 skipped.
- Unfinished: none.

## 3. Forty-two workflow receipt reds

- Added `ops/workflows/heartbeat-workflow-receipts-evidence-2026-10-13.md` with the exact read-only database evidence.
- Result: 42 of 42 are `workflow-did-not-run`; 0 are `receipt-writer-failed`; 0 are unknown. Each event id has zero matching `workflow_runs.bus_event_id`. The rows carry test markers from the named Postgres suites.
- Every database read used `BEGIN READ ONLY`, verified `transaction_read_only=on`, and ended with `ROLLBACK`.
- Proof: `node --test src/pulse/workflow-runs.test.mjs src/pulse/run-evidence.test.mjs` — 117 passed, 0 failed, 0 skipped.
- Claude later confirmed those receipt reds came from tests that had been pointed at production on October 11–12. This repair did not run a database test, did not point `DATABASE_URL` at anything, and did not alter the 116 fake clients or 21 fake funding rounds. Chris decides what happens to that data.
- Unfinished: none in code. No writer change or production cleanup was attempted.

## 4. Hourly money beats

- Added five literal beats: `funding-trip`, `partner-trip`, `money-funding`, `money-checkout`, and `money-operations`. The index now has 15 beats.
- The two trip beats cover both required trips. The three money beats cover all 19 W1/W2 checks exactly once: 6 W1 and 13 W2.
- Hourly beats and daily lanes share side-effect-free SQL and verdict helpers under `src/pulse/beats/lib/`; the rejected daily-lane import design was not committed. Recursive import proof keeps the hourly closure inside `beats/lib` plus `node:crypto`.
- Every new beat has a pass self-test, a fail self-test, a fix guide, and exact `covers`. All fail fixtures ran every declared result (`notRun=[]`).
- Proof: focused beat/shared-truth suite — 65 passed, 0 failed, 0 skipped. Daily truth suites — 204 passed, 0 failed, 0 skipped.
- Proof: `npm run pulse:prove -- --beats` — 15 loaded; 5 honest live truth-red beats; 0 cut; 44 reads; 0 SQL errors; 0 refused reads; 0 commits; transaction rolled back; 62 GET reads; fake message sink only; final `OK`.
- Unfinished: none.

## 5. Money and customer route proof

- Added six exact fake-data handler proofs: commissions `mark_paid`; campaign pause/resume/budget; FinanceOS paydown simulator; invoice read; social schedule; Partner Home money tiles. Commissions `approve` remains Not proved because its declared transition does not match the existing handler.
- Changed four existing handler tests, added `src/pulse/catalog/proofs/door-contracts-money-customer.mjs` and its test, and updated `door-proof.mjs` plus its test and the route-gap count.
- The route Not proved count fell from 316 to 310. Map counts are 97 + 110 + 63 + 40. Of those, 162 are money/customer rows.
- Proof: the nine-file handler/catalog command passed 1,062 tests with 0 failed and 0 skipped.
- Unfinished: the remaining 310 routes stay explicitly Not proved with their reason.

## 6. Re-score the catalog

- Recompiled and committed `src/pulse/catalog/generated.json`.
- Exact fresh totals: 3,975 mapped rows; 33 marked repeats; 3,942 unique rows; coverage 880 none, 560 ping, 1,694 e2e, 808 deep; 3,919 wired and 23 red.
- Proof: two consecutive `node scripts/pulse/compile-catalog.mjs` runs produced the same SHA-256: `8d3bee44e829bf03f10e7162f5a53ea38149aa05b334f2c19fda2f255188b297`.
- Proof: `node --test src/pulse/catalog/compiler.test.mjs` — 13 passed, 0 failed, 0 skipped.
- Rebase repair proof: two more consecutive no-database compiles produced the same SHA-256, and `git diff --exit-code -- src/pulse/catalog/generated.json` passed.
- Unfinished: none.

## 7. Named real breaks

- Added `src/pulse/named-real-breaks.test.mjs`. It keeps the seven required ids Broken/red even if bad metadata adds a Not proved marker. It also keeps `pipeline:repair` and `pipeline:clients` red with their existing `Do not auto-fix` direction.
- Proof: `node --test src/pulse/named-real-breaks.test.mjs` — 2 passed, 0 failed, 0 skipped.
- Unfinished: live-state confirmation waits for Claude after Chris approves a later ship. This build did not act on Bram's file.

## 8. Clean gates

- Rebase: `origin/main` is an ancestor of the repair branch; all five proof-test conflicts were resolved and the affected command passed 46 of 46.
- `env -u DATABASE_URL npm run lint` — 3,452 files and inline scripts parse clean.
- `env -u DATABASE_URL npx --no-install tsc --noEmit` — exit 0; no TypeScript error.
- Focused integration command covering display, scorecard, named breaks, self-audit, N/A conditions, rebase conflicts, and the outbound fence — 227 passed, 0 failed, 0 skipped.
- `npm test` was run only with `DATABASE_URL` removed. The Postgres half made no connection and finished with 83 pass and 1,005 database skips. The unit half found one load-only failure: the display meta-test ran the same Chromium proof deck at the same time as the suite's direct copy. The exact failing meta-test was rerun alone and passed 3 of 3; its full child deck completed in 342 seconds. No test was changed, deleted, skipped, or weakened to hide that load contention.
- The prior morning-brief browser proof remains 15 of 15. No product page was changed in this repair.
- Two consecutive fresh compiles kept SHA-256 `8d3bee44e829bf03f10e7162f5a53ea38149aa05b334f2c19fda2f255188b297`; `git diff --exit-code -- src/pulse/catalog/generated.json` passed.
- `git diff --check` passed after removing two rebase artifacts: one duplicate outbound-fence key and one blank line at the end of the receipt evidence file.
- Audit: no LNR, teleprompter, agent-editor, key, secret, dependency, new route, new page, deploy file, production data, or live database was changed. No `.env` file or link was created.
- Unfinished: Claude still performs the required clean-checkout test of the updated draft PR, including a fresh non-contended full-suite run. Nothing was merged or deployed.
