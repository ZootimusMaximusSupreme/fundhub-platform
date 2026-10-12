# Launch heartbeat — architecture and build, 2026-10-11

## Plug-and-play coverage compiler — approved 2026-10-11

Owner order: use Claude's completed 20-file map as ground truth. Do not run a new company sweep or manual recount. A broken item becomes a red row with proof; it does not stop wiring the next item.

| Workflow | Owns | Status |
|---|---|---|
| Core | compiler, shared contract, run-one-surface command, frozen ship proof | done |
| Doors | APIs, jobs, webhooks, keys | done |
| Display | buttons, public pages, dashboards | done |
| Data | pipelines, tables, money lines | done |
| Flow | messages, journeys, self-audit | done |

Shared contract: every one of the 3,941 unique mapped items must link to executable proof or stay visibly red as unproved. No inferred green. Existing deep checks, tests and pings are reused. New builds fail when an item is absent from the map or has no declared proof path.

Result: all 3,974 mapped rows compile, the 33 marked repeats are removed, and all 3,941 unique items have exactly one recipe. The honest proof state is 1,534 linked at the required level and 2,407 red or unproved. Red means the proof is missing or too weak; it does not mean 2,407 product features are broken.

## Workflows

| Unit | Owner | Status | Depends on |
|---|---|---|---|
| Architecture and ground brief | This session | done | none |
| Inventory recount and coverage audit | Agent + this session | claimed | ground brief |
| Shared heartbeat refactor | This session | done with open verification limits | ground brief |
| Live launch proof | Agent + this session | done with reds | none |
| Future-change ship guard | This session | done with limits | existing guard tests |
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

### Plug-and-play coverage compiler

- Core files: `src/pulse/catalog/contract.mjs`, `evidence.mjs`, `compiler.mjs`, `generated.json`, four recipe modules, `scripts/pulse/compile-catalog.mjs`, and `scripts/pulse/run-surface.mjs`.
- Every mapped door, display, data item and flow gets one shared recipe. The compiler rejects missing owners, two owners, duplicate ids and a smaller map.
- `src/pulse/coverage/gap-catalog.mjs` adds two morning rows: map completeness and required proof links. Missing proof stays red and work continues.
- `scripts/ship.mjs` checks catalog freshness before both read-only bundle proofs and now shows proof output when a ship stops.
- Focused catalog result: 70 tests passed, 0 failed, 0 skipped. Full read-only morning proof completed with 1,079 expected checks, all 64 lanes, no throw, SQL error, write or real send; its existing live breaks stayed red.
- Backup circuit: `src/pulse/instant-watch.mjs` checks the newest `pulse-hourly` receipt. Fresh closes the loop; more than three hours is red. Circuit-focused result: 86 tests passed, 0 failed, 1 existing database test skipped because this shell has no `DATABASE_URL`.
- Next project, saved in `TODO.md`: refactor the full company codebase in small safe parts after this heartbeat ships.

### Owner-set price, 2026-10-11

- Chris set the one-time FinanceOS setup price to $497. Netlify `FINANCE_OS_SETUP_FEE_CENTS=49700` is now set in production, deploy-preview, and branch-deploy; `.env` has the same full value. Netlify says a redeploy is required, so the live Setup Pay path is **not yet proven fixed**. No secret was committed.

### Future-change guard

- Owner requirement: every new live surface must ship with its heartbeat, and money/customer surfaces also need a deep tripwire and hourly beat. Machine gates on each ship enforce registration and proof without re-scoring all old inventory rows each time.
- Ship now runs the existing registry, heartbeat, tripwire, coverage-module, and beat guard tests plus both read-only bundle proofs before deploy (`scripts/ship.mjs`). `scripts/ship.test.mjs` proves their order. The new `src/pulse/beats/legacy-unbeaten-tripwires.json` pins the 111 existing tripwire surfaces without an hourly beat; a new tripwire cannot join that backlog unnoticed. The list may only shrink.
- This gate catches newly registered surfaces and broken pulse code. It does **not** prove that every changed business rule has the right semantic check; that still needs a domain-specific test/tripwire in the same change. The 111 old not-hourly surfaces remain a backlog, not green coverage.
- Focused ship and pulse-guard tests pass with no skips; the new beat baseline test passes. Lint parses 3,305 files; `git diff --check` passes. Type check remains red only on the pre-existing `src/marketing/filmed-receive.mjs:159` TS2345, outside this pulse change.

### Inventory recount and coverage audit

- Read the 20 existing JSON inventory files; 3,974 rows total. Old scores are not proof of current coverage. Of 1,866 money/customer rows, 219 still carry `none`, but they must be re-matched against W1–W5 before selecting new checks.
- No inventory, check, or customer data changed. The priority coverage build remains pending this re-match. Do not claim all 3,974 rows watched.
- An exact-key join produced 52 possible additional deep rows, but the map can overclaim: do not publish 653 as a confirmed score. Agent code tracing flagged five launch-risk candidates for parent validation: lost unmapped ClickFunnels orders, active due subscriptions with no charge attempt, merchant money doors without event-result checks, bank-approval inbound mail without result checks, and Lendflow callbacks without round-result checks. Two existing tripwire mappings may be false (`soft-pull-approve`, `banking/sync-liabilities`). These are not fixed or marked covered.

### Live launch proof

- Live health and database are green; no migrations pending. Netlify schedules hourly pulse at minute 7 and outside watch every five minutes. Recent receipts match those clocks. Forty-two scheduled jobs are current and two monthly jobs are not due.
- Latest saved morning card: 720 green, 15 red, 65 verified N/A, zero unchecked. The live hourly pulse had two open reds: `brief-link` (newest sent brief 37 h old, limit 36) and `vendor-keys` (Twilio HTTP 401).
- Local credentials match Netlify production and a separate read-only Twilio account GET with the same sending SID/token returned HTTP 401. The alternative account SID/token and API key/secret pairs in `.env` also returned 401 on that read-only account GET. No fresh credential was found in `credentials/env.full.snapshot`. No real text was sent.
- The live deployment during the audit was `d9ffeaf5`. GitHub ship run `38195815987` then succeeded; Netlify published ready production deploy `6acc4612db5937ce5564e748` for `e999ec19` at 02:31 UTC. It includes the refactor and was built after the $497 Netlify env change. The Pay button still needs a real authenticated live click/checkout-link proof.
- The new ship gate was pushed to GitHub at `7409a74e1`; its GitHub ship run `38196477749` was still in progress at last check.

### Shared heartbeat refactor

- Files: `src/pulse/scheduled-shell.mjs`, `netlify/functions/pulse-hourly.mjs`, `netlify/functions/pulse-outside-watch.mjs`, and their two focused test files.
- Pulled identical receipt timeout, late-rejection log, and JSON response code into one shared helper. No beat IDs, check IDs, schedules, business time limits, or send paths changed.
- Focused tests: 53 pass, 0 fail, 0 skipped. Lint: 3,305 files parse clean. Hourly proof: all 10 beats and outside watcher bundled; read-only; 1 existing red (`brief-link`, 37 h since newest sent text vs 36 h limit).
- `npx tsc --noEmit` remains red on pre-existing `src/marketing/filmed-receive.mjs:159` TS2345. This refactor does not touch that file.
- `npm test` exited 0, but the database group skipped 1,005 tests because this shell has no `DATABASE_URL`; do not call that a full database pass.
- Post-change morning proof exited 0: all 1,077 expected checks appeared, all 63 gap lanes answered, 13.8-second morning run under the 20-second cap, no SQL error, write, or real send. Final rows: 712 green, 16 red, 65 verified N/A, 7 laptop-only NOT CHECKED. Reds include real customer-path breaks; this is code proof, not a claim that the business is all green.
- Open verification limits: pre-existing type-check failure and database suite skipped without a safe test `DATABASE_URL`.

### Final ship proof — 2026-10-11

- Catalog proof: 3,974 mapped rows, 33 declared repeats, 3,941 unique company items, 1,534 wired at the required proof level, and 2,407 honestly red or unproved. No wired item lacks an executable proof link.
- Closed backup circuit: a fresh `pulse-hourly` receipt is green; a receipt older than three hours is red. Focused heartbeat and catalog result: 39 passed, 0 failed, 0 skipped. Lint parsed 3,321 files cleanly.
- Full read-only morning proof: all 1,079 expected checks appeared, all 64 lanes answered, no step threw, no SQL error occurred, and nothing tried to write. The proof reported 14 real red rows and 7 laptop-only checks instead of hiding them.
- Production deploy `6acc5f6877f56491516e1e4f` is live at `https://fundhub.ai`. Live health returned app up, database up, and 0 pending migrations. Inngest accepted the live build and re-registered its jobs.
- The saved `SUPABASE_ACCESS_TOKEN` is invalid. It did not affect this release because it has no database changes; Netlify confirmed every migration was already applied. A fresh Supabase login/token is still needed before a future release that adds a migration.
- Type check still has the pre-existing `src/marketing/filmed-receive.mjs:159` TS2345 error. This heartbeat change does not touch that file.
