# Codex heartbeat build manifest — 2026-10-13

Branch: `codex/heartbeat-tripwire-repair-2026-10-13` (review branch; never main)

This build changes the heartbeat, its proof harness, and one existing staff-screen load race exposed by the proof. It does not add a product page, route, screen, customer action, send, live database write, secret, dependency, deploy, or product feature.

## 1. Display lane

- Changed `src/pulse/coverage/gap-catalog-display.mjs` and its test. The runtime imports compiled `generated.json`; it does not read repository files. Missing GET support, unread pages, wrong pages, and invalid URLs return `FAIL` without throwing.
- Included the three PR #37 commits, then added the honest unread-page failure guard.
- Proof: `node --test src/pulse/catalog/compiler.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs src/pulse/coverage/gap-catalog.test.mjs` — 27 passed, 0 failed, 0 skipped.
- Unfinished: none.

## 2. Broken versus Not proved

- Changed the scorecard, self-audit, morning text, existing morning report page, and the route/flow/read gap lanes and tests. `FAIL` always becomes Broken. `NOT_PROVED` is stored as `not_checked` with an explicit marker and remains counted daily.
- Fixed the coverage runner so a gap lane's explicit `NOT_PROVED` status survives to the scorecard instead of being changed to `skip`.
- Final exact Not proved count from the three explicit gap lanes: 460 = 310 route + 123 flow + 27 read. The other 160 flow rows are honest N/A inactive controls, not Not proved.
- Proof: the focused Node suite passed 197 tests with 0 failed and 0 skipped. `E2E_PORT=43129 npx playwright test e2e/morning-brief.spec.mjs` passed 15 tests with 0 failed and 0 skipped.
- Unfinished: none.

## 3. Forty-two workflow receipt reds

- Added `ops/workflows/heartbeat-workflow-receipts-evidence-2026-10-13.md` with the exact read-only database evidence.
- Result: 42 of 42 are `workflow-did-not-run`; 0 are `receipt-writer-failed`; 0 are unknown. Each event id has zero matching `workflow_runs.bus_event_id`. The rows carry test markers from the named Postgres suites.
- Every database read used `BEGIN READ ONLY`, verified `transaction_read_only=on`, and ended with `ROLLBACK`.
- Proof: `node --test src/pulse/workflow-runs.test.mjs src/pulse/run-evidence.test.mjs` — 117 passed, 0 failed, 0 skipped.
- Unfinished: none. No writer change was justified.

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
- Unfinished: none.

## 7. Named real breaks

- Added `src/pulse/named-real-breaks.test.mjs`. It keeps the seven required ids Broken/red even if bad metadata adds a Not proved marker. It also keeps `pipeline:repair` and `pipeline:clients` red with their existing `Do not auto-fix` direction.
- Proof: `node --test src/pulse/named-real-breaks.test.mjs` — 2 passed, 0 failed, 0 skipped.
- Unfinished: live-state confirmation waits for Claude after Chris approves a later ship. This build did not act on Bram's file.

## 8. Clean gates

- `npm run lint` — 3,452 files and inline scripts parse clean.
- `npx tsc --noEmit` — only the existing `src/marketing/filmed-receive.mjs:159` error present on `origin/main`; no new TypeScript error.
- `npm test` — unit: 21,939 tests, 21,916 passed, 0 failed, 23 existing skips; Postgres runner: exit 0 with database-only tests skipped because this isolated worktree intentionally had no writable `DATABASE_URL`; final runner result `unit exit 0, pg exit 0`. No new test was skipped, deleted, or weakened.
- The full-suite proof exposed and fixed an existing response-order race on `public/app/agent-editor.html`: staff options now load before agents, so a fast agent read cannot erase the saved owner/escalation. The exact browser proof passed 8 of 8.
- `E2E_PORT=43173 npx playwright test e2e/morning-brief.spec.mjs --workers=1` — 15 passed, 0 failed, 0 skipped.
- `npm run pulse:prove` — 75 steps; 2,622 final rows; 713 green, 1,209 Broken, 460 Not proved, 205 nothing to judge, 35 unread; every listed file bundled; no step threw or exceeded 20 seconds; no SQL error; nothing tried to write; final `OK`.
- Two consecutive fresh compiles kept SHA-256 `8d3bee44e829bf03f10e7162f5a53ea38149aa05b334f2c19fda2f255188b297`; `git diff --exit-code src/pulse/catalog/generated.json` and `git diff --check` passed.
- Audit: no LNR, teleprompter, key, secret, dependency, new route, new page, or deploy file changed. Temporary `.env` links used only by the read-only proof were removed.
- Unfinished: Claude still performs the required clean-checkout test of the draft PR. Nothing was merged or deployed.
