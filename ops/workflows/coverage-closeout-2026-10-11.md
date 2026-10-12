# Coverage closeout — 2026-10-11

Owner order: turn all 2,407 weak catalog rows into executable proof at the level their risk requires. A row stays red until its proof really runs. Chris owns the 14 current live red checks listed in `TODO.md`; this batch does not repair those business problems.

## Shared ground

- Catalog: 3,941 unique items; 1,534 wired; 2,407 red or unproved.
- Remaining families: 428 keys, 307 data, 304 buttons, 304 messages, 205 forms, 204 screens, 195 routes, 173 links, 132 journeys, 77 reads, 40 jobs, 25 agents, and 13 webhooks.
- Remaining modes: 1,489 manual-red, 678 test, 189 read-only, and 51 receipt.
- Existing architecture stays: one compiler, one contract, one generated catalog, and four recipe modules. Workflows edit only their recipe module and its tests. This session compiles once after all manifests land.
- No live money move, customer write, text, email, or phone call. Proof is read-only, fake-data, receipt-based, or an existing safe live read.
- No row becomes green from a name match alone. Weak proof stays red.
- Token-smart proof order: compile once, run one batched pulse, group failed rows by shared proof target, run each real target once, then build only the missing checks. Do not spray the full suite after every edit.

## Workflows

| Workflow | Owns | Files | Status | Depends on |
|---|---|---|---|---|
| Core and integration | This session | compiler, contract, evidence, generated catalog, gap lane, ship proof, board | done for batch 3 | all manifests |
| Doors | This session | keys, routes, jobs, webhooks | done for batch 3 | shared ground |
| Display | Agent | buttons, forms, screens, links | done for batch 3 | shared ground |
| Data | Agent | data, reads, pipelines, tables, money/customer data | done for batch 3 | shared ground |
| Flow | Agent | messages, journeys, agents | done for batch 3 | shared ground |

## Change manifests

### Doors

Done in `43651fe73`. Added honest executable proof to 188 door rows. The stricter proof rule also returned 157 weak rows to red. Door gaps remaining: 796.

Batch 2 complete in this commit. Added 281 shared executable proofs: 279 non-sensitive key contracts that check valid names and real code readers without reading values, plus 2 safe public route result checks that call the handlers with fake data. Focused Doors tests passed: 484 passed, 0 failed, 0 skipped. Exact Doors count: 469 wired, 515 red. Remaining red by map: 100 routes-0, 126 routes-1, 67 routes-2, 46 routes-3, 47 jobs, 15 webhooks, 114 keys.

Batch 3 complete in this commit. Added 157 honest executable proofs: 114 key format and health checks, 34 job result and receipt checks, and 9 webhook signature and result checks. Sensitive rows use deep gap or beat result proof. One guard-only ad-video webhook stays red. Route gain is 0: the shared route probe stopped after two failed tries because one handler checked auth before method and the health route accepted `TRACE` with `200`; no weak route proof was added. Exact Doors count: 626 wired, 358 red. Remaining red: 339 routes, 13 jobs, 6 webhooks, and 0 keys. Focused Doors and module-list tests: 651 passed, 0 failed, 0 skipped. Files changed: `src/pulse/catalog/door-recipes.test.mjs`, `src/pulse/catalog/proofs/door-proof.mjs`, `src/pulse/catalog/proofs/door-proof.test.mjs`, `src/pulse/catalog/proofs/door-batch-key-contract.test.mjs`, new `src/pulse/catalog/proofs/door-batch-{key-health,job-result,webhook-result}.test.mjs`, new `src/pulse/coverage/gap-door-batch-{keys,jobs,webhooks}.mjs`, and `src/pulse/coverage/modules.mjs`. `generated.json` was not edited. No provider write ran, and no secret value was read or printed.

### Display

Done in `91b8b1b42`. Added 40 honest executable display proofs: 27 screens, 12 buttons, and 1 link. Focused tests passed. Remaining display gaps stay red.

Batch 2 complete in this commit. Added one safe local browser contract that really clicks 104 public links and checks each resolved destination. It also triggers 3 replay buttons and checks their changed terminal display, then clicks 4 Winner's Board tabs and checks the selected tab, fake API read, and rendered result. Net gain: 111 wired Display rows. Focused Display tests: 9 passed, 0 failed. Remaining Display gaps: 735 total — 285 buttons, 205 forms, 177 screens, and 68 links.

Batch 3 integration accepted 17 new Display rows. The shared local browser batch runs 27 fake-API Playwright specs once, but 100 money/customer rows still have browser proof only. They stay red until a deep result lane checks the saved customer or money result. Remaining Display gaps: 718 total — 278 buttons, 200 forms, 172 screens, and 68 links. Files changed: `src/pulse/catalog/proofs/display-proof-cases.mjs` and `src/pulse/catalog/proofs/display-batch-staff-ui*.mjs`. No live writes ran.

### Data

Done in `acea73f8f`. Added 10 honest deep data proofs. Focused tests passed. Remaining pipeline, table, bank, and link gaps stay red.

Batch 2 complete in this commit. Added shared deep result proof for pipeline and bank targets, plus shared control proof for non-customer rows. Focused Data tests passed. Exact gain: 213 rows changed from red to wired. Data red fell from 297 to 84. The 84 left are 66 money/customer table rows with no real final-result gap lane and 18 rows with no executable result proof. Files changed: `src/pulse/catalog/data-recipes.mjs`, `src/pulse/catalog/data-recipes.test.mjs`, and `src/pulse/catalog/proofs/data-*.mjs`. `generated.json` was not edited.

Batch 3 complete in this commit. Added one shared read-only `gap-catalog-data` judge for the exact 66 sensitive table rows. It checks saved business result fields in six batched reads; an empty table is verified `na`, a missing saved result is `FAIL`, and a read error stays unchecked. Added executable fake-data and source-result proof for the other exact 18 rows. Exact gain: 84 Data rows changed from red to wired. Data wired rose from 585 to 669, and Data red fell from 84 to 0. Focused Data tests: 21 passed, 0 failed, 0 skipped. Files changed: `src/pulse/catalog/data-recipes.test.mjs`, `src/pulse/catalog/proofs/data-*.mjs`, `src/pulse/coverage/gap-catalog-data.mjs`, its test, and `src/pulse/coverage/modules.mjs`. `generated.json` was not edited.

### Flow

Done in `82375bda4`. Added 135 executable flow links, while the stronger ping rule removed 5 weak greens. Net gain: 130 wired rows. Focused linked tests passed. Remaining message, journey, and agent gaps stay red.

Batch 2 Flow complete in `957f5de7`. Added 24 honest executable proofs: 11 messages, 11 journeys, and 2 agents. The candidate-outreach batch queues all eight real cadence templates with fake data, then runs the real gate and dispatcher to the final blocked result. Shared journey tests cover the four Ops pulse steps and seven gate-relay steps. The two agent rows run their real repair-reader and brand-copy behavior tests. Focused Flow result: 9 passed, 0 failed, 0 skipped. Exact Flow count after integration: 346 wired and 307 red — 182 messages, 111 journeys, and 14 agents. Files changed: `src/pulse/catalog/proofs/flow-result-proofs.mjs`, its test, and new `src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs`.

Batch 3 integration accepted 16 new Flow rows: 6 journeys and 12 agents, while 2 payment-link message rows returned to red because their focused endpoint test fails. The generic template-gate batch did not prove each template's own trigger, copy, and placeholders, so it cannot turn 159 message rows green. Exact Flow state: 362 wired and 291 red — 184 messages, 105 journeys, and 2 agents. The journey and agent batches use fake providers and leave final results or run receipts. No provider was reached. Files changed: `src/pulse/catalog/proofs/flow-result-proofs.mjs`, its test, `src/pulse/catalog/proofs/flow-batch-template-gates.test.mjs`, `src/pulse/catalog/proofs/flow-batch-journey-results.test.mjs`, and `src/pulse/catalog/proofs/flow-batch-agent-runtime.test.mjs`.

### Core and integration

Batch 1 complete. The compiler now accepts recipe-level proof only when it has a real executable target, a stated result, and a safe runner. Status pings cannot claim e2e or deep proof. Two integration gaps found by the first pulse were fixed in the display and flow proof declarations.

Batch 2 core: `npm run pulse:catalog:prove` now compares the working catalog with HEAD, deduplicates shared proof targets, runs only changed proof by default, and prints the remaining red families. `--all` runs every wired proof; `--report` does not execute targets.

Batch 3 core: integration rejected weak green claims from Display and Flow. Money/customer browser checks remain red without deep saved-result proof. Generic template blocking remains red without template-specific result proof. The one real failing payment-link target is excluded from proof and its two rows stay red.

## Verification

- Each recipe module runs focused PASS and FAIL tests.
- The compiler must still reject missing owners, duplicate owners, duplicate ids, weak money/customer proof, and a smaller catalog.
- Final catalog target: 3,941 unique, 3,941 wired, 0 red or unproved.
- Then run lint, type check, catalog freshness, hourly proof, full morning proof, ship, live health, and Inngest registration.

## Ship closeout — 2026-10-12

- **Funnel timeouts — done:** live reads are capped at eight at once. The same checks remain. Focused tests passed 72/72. The live read-only lane finished in 3.2 seconds with no skipped rows, and both role runs agreed. Commit `56a8e38be`.
- **CRM links time — done:** page, logo, and pipeline checks now start together. The same checks and row order remain. Focused tests passed 46/46. Commit `d1cb9de4c`.
- **GitHub proof keys — done:** full Meta and Commas keys were saved as GitHub Actions secrets and mapped into the ship job. Secret values were not printed or committed.
- **Twilio and Resend in GitHub — named runner limit:** this repo only has masked local copies. GitHub names this row as live-only and never counts it green. A real live provider refusal still stays red for Chris to fix.
- **Integration — done and live:** focused proof passed, lint passed, and catalog freshness passed. The second CRM fix kept every read and capped a dead file at two five-second tries; its focused live lane finished in 4.9 seconds. GitHub ship run `38277710130` passed in 7 minutes 24 seconds and shipped commit `bfd16774`. The live strict health read says database up, 393 changes applied, 0 pending. Inngest re-registered successfully. Current honest catalog stays 2,496 wired and 1,445 red or unproved; this ship did not turn those rows green.

## Batch 1 result

- 3,941 unique items.
- 1,593 wired.
- 2,348 red.
- Focused integration pass: 22 passed, 0 failed.
- Next pass starts from grouped red targets. Shared tests run once per target.

## Batch 2 result

- 3,941 unique items.
- 2,222 wired.
- 1,719 red.
- Net gain: 629 honestly wired rows.
- Focused catalog proof passed with 505 checks and no skips.
- The first combined target run found that Playwright specs were being sent to Node. The runner now separates Node and browser tests and forces Node to close leaked handles. The broad target run also exposed existing target-test failures, so it was stopped and those targets stay work for the next batch.

## Batch 3 result

- 3,941 unique items.
- 2,496 wired.
- 1,445 red.
- Net gain: 274 honestly wired rows.
- Data and keys now have 0 red rows.
- Remaining red: 339 routes, 278 buttons, 200 forms, 184 messages, 172 screens, 105 journeys, 78 reads, 68 links, 13 jobs, 6 webhooks, and 2 agents.
- No live customer write, money move, text, email, or phone call ran.
- Catalog freshness passed. Lint passed across 3,358 files and inline scripts.
- The focused integration run stopped on the same local Playwright server twice. An orphan `e2e/static-server.mjs` process held port 43117; it was stopped and no third attempt was made under the stuck rule. The agent's earlier focused Display run passed 9 checks with no skips.
- Type check still has the older unrelated error at `src/marketing/filmed-receive.mjs:159` (`TS2345`). This batch did not touch that file.
- The first GitHub live ship found four Batch 3 pulse faults: empty catalog tables used an unknown nothing-to-judge reason, and the three proof-only door lanes returned no rows. Empty tables now use a closed, rechecked reason and share the pulse's six batched reads. The door lanes now answer with honest red rows instead of disappearing.
- The repaired full local bundle reached only three older self-audit timeouts: `checkout:funnel-no-sale`, `msg:dead-senders`, and `social:video-stats-stale`. Two full retries gave the same result, so the stuck rule stopped more changes to those older lanes.

## Batch 4 — final 1,445 rows and refactor map

Owner approval: Chris said to run all lanes and finish the remaining 1,445 rows. While the same code is being inspected, record a whole-company refactor plan. The refactor is planning only in this batch; coverage wiring stays the ship path.

| Workflow | Exact scope | Status | Integration rule |
|---|---|---|---|
| Doors final | 339 routes, 13 jobs, 6 webhooks | done | Exact route gaps stay red; job and webhook result checks are live. Commits `058fc973b`, `752be0a88`. |
| Display final | 278 buttons, 200 forms, 172 screens, 68 links | done | Every control has an exact result check or exact red monitor. Commits `953810d6c`, `184aaeb26`. |
| Flow final | 184 messages, 105 journeys, 2 agents | done | Inactive templates are rechecked in one batch; every active gap stays red by exact name. Commits `f2fb2a250`, `232e382ed`. |
| Reads + refactor map | 78 reads plus read-only architecture findings | done | 38 reads have result proof; 40 have exact red monitors. Refactor plan saved. Commit `0798ceecf`. |
| Core integration | compiler, shared module list, generated catalog, final proof, ship | done | Red proof runs only its exact monitor. The targeted proof no longer sprays old browser tests. |

Batch 4 safety: no live customer write, money move, text, email, or phone call. A real break stays red and is recorded. A row becomes wired only when its own executable proof runs and checks the stated result.

## Batch 4 result

- The map grew by one teleprompter row while this batch ran: 3,975 mapped rows, 33 marked repeats, 3,942 unique items.
- All 3,942 unique items now have an executable proof path. Catalog state: 3,942 wired, 0 invisible or unproved.
- This is not a claim that every item works. The catalog now reports 1,762 exact monitored-red items: 427 buttons, 385 screens, 339 routes, 259 forms, 172 links, 105 journeys, 40 reads, 17 messages, 13 jobs, 4 webhooks, and 1 agent.
- The targeted proof is token-smart: 1,762 red rows collapse to 6 Node test files, 0 browser specs, and 6 read-only pulse lanes. Known-red rows do not rerun old linked tests.
- The exact live read-only proof passed as a checker. It had no SQL error, no skipped row in the four selected lanes, no timed-out inactive-template audit, and no write or provider send.
- The new display SQL bug found by the first pulse was fixed. The inactive-message audit now rechecks all 158 template keys with one batched read.
- Focused integration tests passed. Lint passed across 3,380 files and inline scripts.
- TypeScript still has the older unrelated `TS2345` error at `src/marketing/filmed-receive.mjs:159`. This batch did not touch that file.
- Whole-company refactor plan: `ops/workflows/company-refactor-plan-2026-10-12.md`. It is planning only; no broad product refactor was mixed into this coverage ship.

### Final review repairs

- Unknown `--lanes` names now stop proof before it runs. Commit `401d1ad27`.
- The job lane now accepts the live scope function or a direct database. Thirteen empty-work job tests no longer claim the named business result; those jobs stay exact red. Commit `43d187870`.
- Four webhook no-op or not-found tests no longer claim deep saved-result proof; those webhooks stay exact red. Commit `b26c9b1e8`.
- The final six-lane proof passed: no skipped selected-lane row, no timeout, no SQL error, no write, and no provider send.
