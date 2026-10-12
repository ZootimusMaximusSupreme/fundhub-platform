# Coverage closeout — 2026-10-11

Owner order: turn all 2,407 weak catalog rows into executable proof at the level their risk requires. A row stays red until its proof really runs. Chris owns the 14 current live red checks listed in `TODO.md`; this batch does not repair those business problems.

## Shared ground

- Catalog: 3,941 unique items; 1,534 wired; 2,407 red or unproved.
- Remaining families: 428 keys, 307 data, 304 buttons, 304 messages, 205 forms, 204 screens, 195 routes, 173 links, 132 journeys, 77 reads, 40 jobs, 25 agents, and 13 webhooks.
- Remaining modes: 1,489 manual-red, 678 test, 189 read-only, and 51 receipt.
- Existing architecture stays: one compiler, one contract, one generated catalog, and four recipe modules. Workflows edit only their recipe module and its tests. This session compiles once after all manifests land.
- No live money move, customer write, text, email, or phone call. Proof is read-only, fake-data, receipt-based, or an existing safe live read.
- No row becomes green from a name match alone. Weak proof stays red.

## Workflows

| Workflow | Owns | Files | Status | Depends on |
|---|---|---|---|---|
| Core and integration | This session | compiler, contract, evidence, generated catalog, gap lane, ship proof, board | claimed | all manifests |
| Doors | Agent | keys, routes, jobs, webhooks | claimed | shared ground |
| Display | Agent | buttons, forms, screens, links | claimed | shared ground |
| Data | Agent | data, reads, pipelines, tables, money/customer data | claimed | shared ground |
| Flow | Agent | messages, journeys, agents | claimed | shared ground |

## Change manifests

### Doors

Pending.

### Display

Pending.

### Data

Pending.

### Flow

Pending.

### Core and integration

Pending.

## Verification

- Each recipe module runs focused PASS and FAIL tests.
- The compiler must still reject missing owners, duplicate owners, duplicate ids, weak money/customer proof, and a smaller catalog.
- Final catalog target: 3,941 unique, 3,941 wired, 0 red or unproved.
- Then run lint, type check, catalog freshness, hourly proof, full morning proof, ship, live health, and Inngest registration.
