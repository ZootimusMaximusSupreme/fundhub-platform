# Launch heartbeat — architecture and build, 2026-10-11

## Workflows

| Unit | Owner | Status | Depends on |
|---|---|---|---|
| Architecture and ground brief | This session | done | none |
| Inventory recount and coverage audit | This session | done | ground brief |
| Shared heartbeat refactor | This session | done with open verification limits | ground brief |
| Priority coverage build | This session | pending | audit and proven refactor |

## Ground brief

- The inventory has 3,974 rows, 3,941 unique, as of the W6 manifest. A row is a surface or control, not necessarily a separate check. The first 2,690 rows were scored before W1–W5 checks and need recounting.
- Daily coverage is registered by literal imports in `src/pulse/coverage/modules.mjs`; the hourly list is in `src/pulse/beats/index.mjs`. The 5-minute watch runs the existing `engine-alive` beat.
- Checks must keep their IDs, schedules, PASS/FAIL/skip meanings, and read-only behavior. Business time limits remain with their domain rules.
- The first bounded refactor target is duplicated receipt timing and late-rejection handling in `netlify/functions/pulse-hourly.mjs` and `netlify/functions/pulse-outside-watch.mjs`. Both have focused tests.
- The last hourly proof loaded all 10 beats and stayed read-only. It found the latest sent report link 37 hours old versus a 36-hour limit. The full morning bundle proof had no result after three minutes and was stopped.
- Fresh full morning bundle proof completed after a longer run: all 1,077 expected checks present, all 63 gap lanes answered, no SQL errors or writes, and the whole-morning step took 15.8 seconds (limit 20). The earlier pass was stopped before it printed its result.
- Inventory recount of the existing 20 JSON files: 3,974 rows; 830 marked deep, 1,703 e2e, 561 ping, 880 none. Money/customer rows: 1,866; 601 deep, 893 e2e, 153 ping, 219 none. These are historical scores, not a fresh judgment on each old row.

## Refactor pilot plan

- Add `src/pulse/scheduled-shell.mjs` for receipt timeout, late-rejection logging, and the small JSON response shared by the hourly pulse and outside watcher.
- Update `netlify/functions/pulse-hourly.mjs` and `netlify/functions/pulse-outside-watch.mjs` to call it. Keep their exported names, schedules, and visible behavior.
- Update only the exact-import expectations in `src/pulse/pulse-hourly.test.mjs` and `src/pulse/pulse-outside-watch.test.mjs`. Their timeout, redaction, no-env, and schedule assertions stay in force.
- No customer journey changes. Verification: focused tests, lint, type check, hourly bundle proof, and full morning bundle proof.

## Verification gate

Before calling a unit done: focused PASS and FAIL tests, lint, type check, full morning bundle proof, and hourly bundle proof where affected. Record any failed gate as open; do not claim launch coverage is complete from a passing unit test alone.

## Change manifests

### Inventory recount and coverage audit

- Read the 20 existing JSON inventory files; 3,974 rows total. Old scores are not proof of current coverage. Of 1,866 money/customer rows, 219 still carry `none`, but they must be re-matched against W1–W5 before selecting new checks.
- No inventory, check, or customer data changed. The priority coverage build remains pending this re-match. Do not claim all 3,974 rows watched.

### Shared heartbeat refactor

- Files: `src/pulse/scheduled-shell.mjs`, `netlify/functions/pulse-hourly.mjs`, `netlify/functions/pulse-outside-watch.mjs`, and their two focused test files.
- Pulled identical receipt timeout, late-rejection log, and JSON response code into one shared helper. No beat IDs, check IDs, schedules, business time limits, or send paths changed.
- Focused tests: 53 pass, 0 fail, 0 skipped. Lint: 3,305 files parse clean. Hourly proof: all 10 beats and outside watcher bundled; read-only; 1 existing red (`brief-link`, 37 h since newest sent text vs 36 h limit).
- `npx tsc --noEmit` remains red on pre-existing `src/marketing/filmed-receive.mjs:159` TS2345. This refactor does not touch that file.
- `npm test` exited 0, but the database group skipped 1,005 tests because this shell has no `DATABASE_URL`; do not call that a full database pass.
- Post-change morning proof exited 0: all 1,077 expected checks appeared, all 63 gap lanes answered, 13.8-second morning run under the 20-second cap, no SQL error, write, or real send. Final rows: 712 green, 16 red, 65 verified N/A, 7 laptop-only NOT CHECKED. Reds include real customer-path breaks; this is code proof, not a claim that the business is all green.
- Open verification limits: pre-existing type-check failure and database suite skipped without a safe test `DATABASE_URL`.
