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
| Core and integration | This session | compiler, contract, evidence, generated catalog, gap lane, ship proof, board | done for batch 2 | all manifests |
| Doors | Agent | keys, routes, jobs, webhooks | done for batch 2 | shared ground |
| Display | Agent | buttons, forms, screens, links | done for batch 2 | shared ground |
| Data | Agent | data, reads, pipelines, tables, money/customer data | done for batch 3 | shared ground |
| Flow | Agent | messages, journeys, agents | done for batch 2 | shared ground |

## Change manifests

### Doors

Done in `43651fe73`. Added honest executable proof to 188 door rows. The stricter proof rule also returned 157 weak rows to red. Door gaps remaining: 796.

Batch 2 complete in this commit. Added 281 shared executable proofs: 279 non-sensitive key contracts that check valid names and real code readers without reading values, plus 2 safe public route result checks that call the handlers with fake data. Focused Doors tests passed: 484 passed, 0 failed, 0 skipped. Exact Doors count: 469 wired, 515 red. Remaining red by map: 100 routes-0, 126 routes-1, 67 routes-2, 46 routes-3, 47 jobs, 15 webhooks, 114 keys.

### Display

Done in `91b8b1b42`. Added 40 honest executable display proofs: 27 screens, 12 buttons, and 1 link. Focused tests passed. Remaining display gaps stay red.

Batch 2 complete in this commit. Added one safe local browser contract that really clicks 104 public links and checks each resolved destination. It also triggers 3 replay buttons and checks their changed terminal display, then clicks 4 Winner's Board tabs and checks the selected tab, fake API read, and rendered result. Net gain: 111 wired Display rows. Focused Display tests: 9 passed, 0 failed. Remaining Display gaps: 735 total — 285 buttons, 205 forms, 177 screens, and 68 links.

Batch 3 complete in this commit. Added one shared local browser batch across 28 staff-page groups. It runs 27 fake-API Playwright specs once. Every mapped button or form is triggered and its visible or API result is checked. Every mapped screen checks the data shown. All 100 money/customer rows check the final visible or API result. Exact gain: 117 Display rows — 55 buttons, 40 forms, and 22 screens. Focused Display tests: 9 passed, 0 failed, 0 skipped. Remaining Display gaps: 618 total — 230 buttons, 165 forms, 155 screens, and 68 links. Files changed: `src/pulse/catalog/proofs/display-proof-cases.mjs` and `src/pulse/catalog/proofs/display-batch-staff-ui*.mjs`. `generated.json` was not edited. No live writes ran.

### Data

Done in `acea73f8f`. Added 10 honest deep data proofs. Focused tests passed. Remaining pipeline, table, bank, and link gaps stay red.

Batch 2 complete in this commit. Added shared deep result proof for pipeline and bank targets, plus shared control proof for non-customer rows. Focused Data tests passed. Exact gain: 213 rows changed from red to wired. Data red fell from 297 to 84. The 84 left are 66 money/customer table rows with no real final-result gap lane and 18 rows with no executable result proof. Files changed: `src/pulse/catalog/data-recipes.mjs`, `src/pulse/catalog/data-recipes.test.mjs`, and `src/pulse/catalog/proofs/data-*.mjs`. `generated.json` was not edited.

Batch 3 complete in this commit. Added one shared read-only `gap-catalog-data` judge for the exact 66 sensitive table rows. It checks saved business result fields in six batched reads; an empty table is verified `na`, a missing saved result is `FAIL`, and a read error stays unchecked. Added executable fake-data and source-result proof for the other exact 18 rows. Exact gain: 84 Data rows changed from red to wired. Data wired rose from 585 to 669, and Data red fell from 84 to 0. Focused Data tests: 21 passed, 0 failed, 0 skipped. Files changed: `src/pulse/catalog/data-recipes.test.mjs`, `src/pulse/catalog/proofs/data-*.mjs`, `src/pulse/coverage/gap-catalog-data.mjs`, its test, and `src/pulse/coverage/modules.mjs`. `generated.json` was not edited.

### Flow

Done in `82375bda4`. Added 135 executable flow links, while the stronger ping rule removed 5 weak greens. Net gain: 130 wired rows. Focused linked tests passed. Remaining message, journey, and agent gaps stay red.

Batch 2 Flow complete in `957f5de7`. Added 24 honest executable proofs: 11 messages, 11 journeys, and 2 agents. The candidate-outreach batch queues all eight real cadence templates with fake data, then runs the real gate and dispatcher to the final blocked result. Shared journey tests cover the four Ops pulse steps and seven gate-relay steps. The two agent rows run their real repair-reader and brand-copy behavior tests. Focused Flow result: 9 passed, 0 failed, 0 skipped. Exact Flow count after integration: 346 wired and 307 red — 182 messages, 111 journeys, and 14 agents. Files changed: `src/pulse/catalog/proofs/flow-result-proofs.mjs`, its test, and new `src/pulse/catalog/proofs/flow-batch-message-delivery.test.mjs`.

### Core and integration

Batch 1 complete. The compiler now accepts recipe-level proof only when it has a real executable target, a stated result, and a safe runner. Status pings cannot claim e2e or deep proof. Two integration gaps found by the first pulse were fixed in the display and flow proof declarations.

Batch 2 core: `npm run pulse:catalog:prove` now compares the working catalog with HEAD, deduplicates shared proof targets, runs only changed proof by default, and prints the remaining red families. `--all` runs every wired proof; `--report` does not execute targets.

## Verification

- Each recipe module runs focused PASS and FAIL tests.
- The compiler must still reject missing owners, duplicate owners, duplicate ids, weak money/customer proof, and a smaller catalog.
- Final catalog target: 3,941 unique, 3,941 wired, 0 red or unproved.
- Then run lint, type check, catalog freshness, hourly proof, full morning proof, ship, live health, and Inngest registration.

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
