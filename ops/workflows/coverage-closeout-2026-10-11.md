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
| Core and integration | This session | compiler, contract, evidence, generated catalog, gap lane, ship proof, board | done for batch 1 | all manifests |
| Doors | Agent | keys, routes, jobs, webhooks | done for batch 1 | shared ground |
| Display | Agent | buttons, forms, screens, links | done for batch 1 | shared ground |
| Data | Agent | data, reads, pipelines, tables, money/customer data | done for batch 1 | shared ground |
| Flow | Agent | messages, journeys, agents | done for batch 1 | shared ground |

## Change manifests

### Doors

Done in `43651fe73`. Added honest executable proof to 188 door rows. The stricter proof rule also returned 157 weak rows to red. Door gaps remaining: 796.

### Display

Done in `91b8b1b42`. Added 40 honest executable display proofs: 27 screens, 12 buttons, and 1 link. Focused tests passed. Remaining display gaps stay red.

### Data

Done in `acea73f8f`. Added 10 honest deep data proofs. Focused tests passed. Remaining pipeline, table, bank, and link gaps stay red.

### Flow

Done in `82375bda4`. Added 135 executable flow links, while the stronger ping rule removed 5 weak greens. Net gain: 130 wired rows. Focused linked tests passed. Remaining message, journey, and agent gaps stay red.

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
