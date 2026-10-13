# Heartbeat build board — 2026-10-13

Goal: pass the eight items in `codex-build-claude-test-2026-10-13.md`. No new product feature, route, page, screen, send, or live write.

## Workflows

| Work | Owner | State | Files |
| --- | --- | --- | --- |
| Item 1: PR #37 display lane | display_lane | done | PR #37 files only |
| Item 2: broken vs not proved | status_split | done | scorecard, morning text, report page, focused tests |
| Item 3: 42 workflow receipts | receipt_reds | done | run evidence, workflow rows, focused tests, written evidence |
| Item 4: hourly money beats | hourly_money_beats | built; focused and bundle proof green | beat files, shared read helpers, focused tests |
| Item 5: money/customer route proof | route_proofs | claimed | handler proof tests and catalog proof recipes |
| Item 7: named real breaks | named_breaks | claimed | focused status tests only |
| Items 6 and 8: rescore, clean gates, manifest | root | claimed | catalog output, full gates, manifest |

## Shared rules

- Worktree: `/Users/chrisstanbridge/.codex/worktrees/heartbeat-eight-items/fundhub-platform`.
- Base: `origin/main`. PR #37 commits were cherry-picked first.
- Read only. No send, event, AI, Plaid, charge, secret change, or live database write.
- Do not touch LNR or teleprompter files.
- Do not commit. Root integrates and commits once each unit is proved.
- Add a short manifest below before reporting done.

## Agent prompts

### display_lane

Audit item 1 only. Confirm the PR #37 display lane has no run-time repo-file read, cannot throw on missing work files, and judges the retired page by a real GET. Run focused tests. Fix only item 1 files if needed. Record files and commands here.

### status_split

Build item 2 only. Show separate BROKEN and NOT PROVED counts in the saved scorecard, morning text, and report page. Unproved stays counted and never green. A measured break cannot be classified as NOT PROVED. Add tests that fail if those rules break. Do not add a product route or page.

### receipt_reds

Resolve item 3 only. Use read-only evidence to classify all 42 `wf:` reds as workflow-did-not-run or receipt-writer-failed, fix the writer only if code proves it, and write a database-verifiable cause. No unknown cause may remain. Add tests that fail if receipt logic always passes.

### hourly_money_beats

Build item 4 only. Add `funding-trip`, `partner-trip`, and the smallest clean set of data-driven beats that gives every W1/W2 check hourly coverage. Keep the literal list, `covers`, fix guides, and pass/fail self-tests exact. Reuse shared judges; do not copy lane SQL. Reach at least 14 total beats and prove the focused suite.

### route_proofs

Build item 5 only. Add fake-data tests that call real existing money/customer handlers and judge exact results, then link only those executable proofs in the catalog. Leave every unproved route marked NOT PROVED with its reason. No product code, new route, or weakened test.

### named_breaks

Prove item 7 only. Add or strengthen focused tests so the seven named real breaks and Bram's repair row stay Broken and visible. Do not act on the breaks, contact anyone, or change product logic.

## Manifests

Agents append their exact files, commands, counts, and unfinished work here.

### Item 1 — display_lane

- State: proved in this worktree. The retired-page result is `na` after the two required GETs succeed and `FAIL` for a wrong page, an unread page, a missing GET client, or an invalid base URL. It no longer produces `skip` / `not_checked`.
- Files changed: `src/pulse/coverage/gap-catalog-display.mjs`; `src/pulse/coverage/gap-catalog-display.test.mjs`.
- Runtime-data audit: the lane imports only `src/pulse/catalog/generated.json`; `rg -n "node:fs|ops/workflows|netlify\\.toml|readFile|readFileSync|createReadStream" src/pulse/coverage/gap-catalog-display.mjs` returned no matches. The shipped-bundle test removes `ops/` and `netlify.toml` and still imports the lane.
- Command: `node --test src/pulse/coverage/gap-catalog-display.test.mjs` — 9 passed, 0 failed, 0 skipped.
- Command: `node --test src/pulse/catalog/compiler.test.mjs src/pulse/coverage/gap-catalog-display.test.mjs src/pulse/coverage/gap-catalog.test.mjs` — 27 passed, 0 failed, 0 skipped.
- Command: real read via `gapChecks({ baseUrl: "https://fundhub.ai" })` — the retired Autopsy row returned verified `na` after GET `/partner/autopsy/` and GET `/partner/menu/`; it did not throw or return `skip`.
- Command: `git diff --check` — clean.
- Command: `npx tsc --noEmit` — only the known out-of-scope error at `src/marketing/filmed-receive.mjs:159`; no display-lane error.
- Unfinished: no item 1 work. No deploy was run.

### Item 3 — receipt_reds

- State: evidence complete. All 42 rows are `workflow-did-not-run`; 0 are `receipt-writer-failed`; 0 causes are unknown.
- Files changed: `ops/workflows/heartbeat-workflow-receipts-evidence-2026-10-13.md` and this board only. No app or test code changed.
- Live database reads: every connection issued `BEGIN READ ONLY`, verified `transaction_read_only=on`, and ended with `ROLLBACK`. No live row changed.
- Count: October 13 scorecard has 42 red `wf:` rows. The exact event groups total `5 + 9 + 4 + 7 + 3 + 2 + 1 + 3 + 3 + 4 + 1 = 42`.
- Cause: the unmatched event rows carry markers from `comms.pg.test.mjs`, `purchase-routing.pg.test.mjs`, `approval-amount-guard.pg.test.mjs`, and `card-stacking-rounds.pg.test.mjs`. Each exact event id has zero matching `workflow_runs.bus_event_id` rows.
- Writer proof: `fundhub_app` has `INSERT` and `UPDATE`; 31 non-marker receipt rows exist for 16 workflows; an October 13 finish mark saved after the test-event bursts. No writer repair was justified, so none was made.
- Command: `node --test src/pulse/workflow-runs.test.mjs src/pulse/run-evidence.test.mjs` — 117 passed, 0 failed, 0 skipped.
- Mutation guard: the existing focused tests fail if missing receipts are forced to PASS, including the real-bundle `round.started` fan-out test. A duplicate test was not added.
- Unfinished: no item 3 work. No event, send, deploy, or database write was run.

### Item 2 — status_split

- State: done in this worktree. The saved scorecard, morning text, and existing report page show separate **Broken** and **Not proved** counts. Not-proved rows remain in the daily total and can never turn green. A raw measured `FAIL` always remains Broken, even if bad metadata carries a not-proved marker.
- Files changed: `src/pulse/scorecard.mjs`, `src/pulse/scorecard.test.mjs`, `src/pulse/scorecard.pg.test.mjs`, `src/pulse/self-audit.mjs`, `src/pulse/self-audit.test.mjs`, `src/ops/morning-brief.mjs`, `src/ops/morning-brief.test.mjs`, `public/app/morning-brief.html`, `src/http/morning-brief-page.test.mjs`, `e2e/morning-brief.spec.mjs`, `src/pulse/coverage/gap-door-batch-routes.mjs`, `src/pulse/coverage/gap-door-batch-routes.test.mjs`, `src/pulse/coverage/gap-catalog-flow.mjs`, `src/pulse/coverage/gap-catalog-flow.test.mjs`, `src/pulse/coverage/gap-catalog-reads.mjs`, `src/pulse/coverage/gap-catalog-reads.test.mjs`, `docs/journeys/heartbeat-flow.md`, `docs/journeys/CHANGELOG.md`, and this board.
- Counts: 466 explicit not-proved rows: 316 route rows + 123 flow rows + 27 read rows. A fake compile produced 626 total rows: 0 green, 0 broken, 466 not proved, 160 nothing to judge. The stored counts were 466 `not_checked`, all 466 carrying the explicit `not_proved` marker.
- Command: focused Node suite covering scorecard save/map, morning text, public report handler/page, the three proof-gap lanes, self-audit, and daily pulse — 197 passed, 0 failed, 0 skipped.
- Command: `E2E_PORT=43129 npx playwright test e2e/morning-brief.spec.mjs` — 15 passed, 0 failed, 0 skipped. The first default-port run reached another agent's stale local server and failed 4 label assertions; the isolated clean-port run is the valid result.
- Command: `npm run lint` — passed.
- Unfinished: no item 2 work. Root still owns the combined full-suite gates and final compile. No live database write, send, deploy, product route, page, or customer behavior was added.

### Item 5 — route_proofs

- State: six exact money/customer route rows now point to fake-data tests that call their real handlers and judge the named result. Every other route still uses the NOT PROVED lane with its reason.
- Rows proved: commissions `mark_paid`; campaigns `pause|resume|update_budget`; FinanceOS paydown simulator; invoice read; social schedule; Partner Home money tiles. Commissions `approve` stays NOT PROVED because the catalog says pending-to-approved while the real handler only moves earned-to-approved.
- Files changed: `src/http/campaigns-write-handler.test.mjs`; `src/http/paydown-simulator-handler.test.mjs`; `src/http/read-invoices-handler.test.mjs`; `src/http/partner-home-tiles.test.mjs`; `src/pulse/catalog/proofs/door-contracts-money-customer.mjs`; `src/pulse/catalog/proofs/door-contracts-money-customer.test.mjs`; `src/pulse/catalog/proofs/door-proof.mjs`; `src/pulse/catalog/proofs/door-proof.test.mjs`; and this board.
- Count: the exact route recipe count moved from 316 NOT PROVED to 310. By map it is now `routes-0.json` 97, `routes-1.json` 110, `routes-2.json` 63, `routes-3.json` 40. Sensitive money/customer rows still NOT PROVED: 162.
- Command: `node --test src/http/partner-home-tiles.test.mjs src/pulse/catalog/proofs/door-contracts-money-customer.test.mjs` — 18 passed, 0 failed, 0 skipped.
- Command: focused handler plus catalog suite covering all six mapped results — 1,065 passed, 0 failed, 0 skipped.
- Command: direct `makeRecipe` recount across the four route maps — 310 total: 97 + 110 + 63 + 40; 162 are money/customer rows.
- Command: `git diff --check` on the item 5 files — clean.
- Safety: no product code, route, page, screen, live database, provider call, send, event, secret, LNR file, or teleprompter file changed.
- Unfinished handoff: item 2 owns `gap-door-batch-routes.mjs/.test.mjs`; their fixed 316 guard must be changed by root to 310 with the per-file counts above. Root also owns the final catalog compile, so `generated.json` has not been written by this agent.

### Item 7 — named_breaks

- State: proved in this worktree. The exact seven named failures remain red and visible under their original ids. A stray `not_proved` marker cannot move a measured `FAIL` out of Broken.
- Bram guard: the real `pipeline:repair` and `pipeline:clients` check is exercised with one stuck repair file and one stalled paying client. Both rows stay `FAIL`, become stored `red`, and keep the existing `Do not auto-fix` direction. No customer row or live data was touched.
- File changed: `src/pulse/named-real-breaks.test.mjs`; this board.
- Count: 7 required named breaks stored as Broken, 0 stored as Not proved. The repair guard adds 2 Broken rows, 0 Not proved.
- Command: `node --test src/pulse/named-real-breaks.test.mjs` — 2 passed, 0 failed, 0 skipped.
- Command: `node --test src/pulse/machine.test.mjs src/pulse/coverage/gap-ads.test.mjs src/pulse/coverage/gap-calls.test.mjs src/pulse/coverage/gap-finance-os-setup.test.mjs src/pulse/coverage/gap-records.test.mjs src/pulse/catalog/proofs/data-pipeline-motion.test.mjs src/pulse/named-real-breaks.test.mjs` — 132 passed, 0 failed. Two pre-existing database-only suites reported `# SKIP no DATABASE_URL`; the final Node summary reported 0 skipped tests. The new item 7 file has no skip.
- Command: `npx tsc --noEmit` — only the known out-of-scope error at `src/marketing/filmed-receive.mjs:159`; no item 7 error.
- Command: `git diff --check -- src/pulse/named-real-breaks.test.mjs` — clean.
- Unfinished: no item 7 code work. Live red state is verified after ship by Claude's read-only check; this build did not contact Bram, write live data, send anything, deploy, or change product logic.

### Item 4 — hourly_money_beats

- State: focused proof green after the safety rebuild. Five new literal beats take the list from 10 to 15: `funding-trip`, `partner-trip`, `money-funding`, `money-checkout`, and `money-operations`.
- Coverage: the two trip beats run `trip:funding` and `trip:partner`. The three data beats run all 19 W1/W2 checks exactly once: 6 W1 and 13 W2. The old not-hourly baseline shrank from 111 to 86 mapped surfaces.
- Safety design: `PURE_IMPORTS` remains empty. Daily lanes and hourly beats now import the same SQL, constants, and verdict runners from `src/pulse/beats/lib/`. A recursive test starts at `money-hourly.mjs` and proves its full runtime import closure stays inside `beats/lib` except the permitted `node:crypto`. The hourly context exposes only read-only SQL plus GET/HEAD web reads.
- Beat files: `src/pulse/beats/beat-funding-trip.mjs` and test; `beat-partner-trip.mjs` and test; `beat-money-funding.mjs` and test; `beat-money-checkout.mjs` and test; `beat-money-operations.mjs` and test; `index.mjs`; `legacy-unbeaten-tripwires.json`; `beats.test.mjs`.
- Shared truth files: `src/pulse/beats/lib/money-hourly.mjs`; `money-hourly.test.mjs`; `money-funding-truth.mjs`; `money-funding-sql.mjs`; `money-funding-checks.mjs`; `money-funding-truth.test.mjs`; `money-checkout-truth.mjs`; `money-checkout-config.mjs`; `money-finance-setup-truth.mjs`; `money-unmatched-truth.mjs`; `money-subscriptions-truth.mjs`; `money-moves-truth.mjs`; `money-ads-meta-truth.mjs`; `money-truth-utils.mjs`; `money-w2-truth.test.mjs`; `token-decrypt.mjs`; `trip-funding-truth.mjs`; `trip-partner-sql.mjs`; `trip-partner-truth.mjs`; `trip-truth-kit.mjs`; `trip-truth-imports.test.mjs`.
- Daily wrappers changed: `src/pulse/coverage/gap-money-funding.mjs`; `gap-checkout.mjs`; `gap-finance-os-setup.mjs`; `gap-payments-unmatched.mjs`; `gap-subscriptions.mjs`; `gap-money-moves.mjs`; `gap-ads-meta.mjs`; `gap-trip-funding.mjs`; `gap-trip-partner.mjs`. They delegate to and re-export the same shared truth; no lane SQL is copied into a beat.
- Command: beat contract, recursive closure, shared-truth parity, helper, and five beat tests — 65 passed, 0 failed, 0 skipped.
- Command: six W2 daily-lane suites — 91 passed, 0 failed, 0 skipped.
- Command: W1 money lane plus dependent trip suites — 191 passed, 0 failed, 0 skipped.
- Command: broader beat/daily focused suite — 701 tests total, 679 passed, 0 failed, 22 database-only suites skipped because this worktree has no `DATABASE_URL`.
- Commands: `node scripts/pulse/run-beat.mjs --selftest <id>` for all five new ids — every pass fixture green; every fail fixture red; `notRun` empty. The three multi-result fail fixtures reach the final declared result: `books:sample-rows`, `checkout:funnel-no-sale`, and `ads-meta:load-jobs`.
- Command: `npm run lint` — 3,452 files and inline scripts parse clean.
- Command: line-count gate after the clean split — `money-checkout-config.mjs` 156 lines, `money-checkout-truth.mjs` 337, `money-funding-sql.mjs` 306, `money-funding-checks.mjs` 327, and the funding facade 2; every new runtime file is below 400 lines.
- Command: `git diff --check` — clean. Direct count: 15 beats; 0 `PURE_IMPORTS` entries.
- Command: `npm run pulse:prove -- --beats` through the root read-only bundle proof — 15 beats loaded; 5 expected truth-red fixtures; 0 cut; 44 reads, 0 errors, 0 refused; 0 commits sent; transaction rolled back and connection destroyed; 62 GETs; fake sink only; final `OK`.
- Unfinished: no item 4 build work remains. This agent did not read a secret, write live data, send anything, deploy, or change customer-facing behavior. Root owns the full repository gates and Claude tests the review branch next.
