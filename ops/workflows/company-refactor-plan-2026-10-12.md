# Fundhub company refactor map — 2026-10-12

## Decision

Do the refactor in small, proved slices. Do not rewrite the company at once.
The heartbeat stays live through every step. A refactor may change code shape,
but it may not change a business result, route, job id, message, money rule, or
screen result unless Chris starts a separate product change.

This file is a plan only. No product code was refactored in this batch.

## What was measured

These counts came from the current repository on 2026-10-12.

| Area | Measured fact | Why it matters |
|---|---:|---|
| `src/` | 301,039 non-test lines in 1,148 code files | Most company rules and services live here. |
| `api/` | 50,436 non-test lines in 330 handlers | The same request gates appear in many files. |
| `public/app/` | 100,044 lines in 124 app files | Many screens mix HTML, state, reads, paint, and actions. |
| `scripts/` | 36,638 non-test lines in 176 files | Build, proof, and ops tools are a real app of their own. |
| `db/` | 55,015 lines in 368 SQL files | Data rules are spread across many migrations and seed files. |
| `netlify/functions/api.mjs` | 1,591 lines, 333 imports, 186 commits since Aug. 1 | It is the hottest single join point. |
| `src/workflows/index.mjs` | 522 lines, 99 imports, 58 commits since Aug. 1 | Every job is hand-registered here. |
| `src/pulse/registry.mjs` | 744 lines, 128 commits since Aug. 1 | Every new live door can collide here. |
| `src/pulse/coverage/modules.mjs` | 101 literal module entries | Static imports are needed for the server bundle, but the list is hand-kept. |
| Pulse coverage | 71 gap modules, 33 slice modules, 230 `.mjs` files total | The checks are broad, but the framework repeats itself. |
| Pulse row helpers | 46 coverage files define their own `row` helper | One output contract is copied many times. |
| Pulse reads | 56 coverage modules call `db.query`; 12 use their own `Promise.race` timeout | Query, timeout, and error wording can drift. |
| API handlers | 288 files inspect `req.method`; 286 emit 405; 240 call `requireRole` | Method and access scaffolding is repeated. |
| App pages | 58 HTML files have inline scripts; 57 have inline styles | UI code cannot be tested or reused cleanly. |
| Browser helpers | 18 app files define an `api` helper; 59 use `localStorage` | Request, session, and cache behavior can differ by page. |

The largest app files are `client-control-panel.html` (5,090 lines),
`client-portal.html` (4,148), `inquiry-remover.html` (4,058), `pipeline.html`
(3,407), `teleprompter.js` (3,186), `creative-factory.html` (3,024), and
`campaign-manager.html` (3,002). Large service files include
`src/marketing/api-contract.mjs` (2,494), `src/marketing/catalog.mjs` (1,836),
and `src/handlers/money-chain.mjs` (1,659).

Git history backs up the risk. Since 2026-08-01, the API join point changed
186 times, the pulse registry 128 times, the app shell 107 times, and the
workflow index 58 times. These are the places where a small missed line can
make a finished feature disappear.

## Ranked refactor units

### 1. One pulse check contract and runner

**Payoff:** very high. **Risk:** medium. **Do first.**

Repeated shape:

- `src/pulse/coverage/gap-*.mjs` and `slice-*.mjs` each build row objects.
- 46 files own a local `row` helper.
- DB calls, timeouts, errors, proof text, and PASS/FAIL states are made in
  several forms.
- `src/pulse/coverage/run-slices.mjs`, `src/pulse/daily-pulse.mjs`,
  `src/pulse/self-audit.mjs`, and `src/pulse/records.mjs` must then understand
  all those forms.

Target shape:

- Add one small pulse check-kit module for row creation, safe DB reads,
  bounded HTTP reads, exact red findings, and approved nothing-to-judge rows.
- Keep every check id and business judge in its domain module.
- Convert one gap module at a time. Do not batch-rewrite 71 files.
- Keep literal module imports so Netlify still bundles every check.

Protection before each move:

- The moved module's current focused test.
- `src/pulse/coverage/modules.test.mjs`.
- `src/pulse/self-audit.test.mjs`.
- `src/pulse/catalog/compiler.test.mjs` and recipe tests for rows it owns.
- `npm run pulse:catalog:prove` for changed proof only.
- A before/after fixture that compares ids, status, detail, depth, and proof.

Stop if the scorecard row count, ids, or red wording changes.

### 2. Generate the three static registration files from checked manifests

**Payoff:** very high. **Risk:** high. **Do after unit 1.**

Repeated shape:

- `netlify/functions/api.mjs` holds 333 imports plus the `ROUTES` map.
- `src/workflows/index.mjs` holds 99 imports plus the exported function list.
- `src/pulse/coverage/modules.mjs` holds 101 literal imports.
- `src/pulse/registry.mjs` repeats live doors and special cases.

Target shape:

- Keep static import output. Do not scan folders at live runtime.
- Put route, job, and pulse metadata in small source manifests by domain.
- Generate the three join files during repo build/check.
- Fail when generated output is stale, an id is duplicated, a handler is
  missing, or a money/customer surface has no required heartbeat/tripwire.
- Generated files stay reviewable. The source manifests are hand-edited.

Protection:

- `src/http/routes.test.mjs` for every route and dynamic path.
- `src/workflows/index.test.mjs` for function ids, triggers, and count.
- `src/pulse/coverage/modules.test.mjs` for every gap and slice file.
- `src/pulse/registry.test.mjs` for route, send-path, and page completeness.
- `npm run journeys:check` because routes drive actual journey files.
- Import the built Netlify function once in a test to prove bundling.

This unit removes missed registration. It does not remove explicit ownership.

### 3. A small API handler shell

**Payoff:** high. **Risk:** high. **Do after static route generation.**

Repeated shape:

- 288 API files inspect `req.method`.
- 286 API files build a 405 response.
- 240 API files call `requireRole`.
- JSON parsing, required fields, error shapes, and database setup repeat too.

Target shape:

- Add one tiny handler wrapper for allowed methods, role gate, JSON input,
  and standard errors.
- Keep SQL and business rules in each handler or its domain service.
- Do not make one universal handler with hidden hooks.
- Start with five low-risk read handlers. Compare exact status, headers, and
  JSON before converting any write route.
- Convert money, auth, webhook, and customer-write routes last.

Protection:

- Existing focused handler test for each moved route.
- Contract snapshots for method refusal, signed-out, wrong role, bad input,
  empty result, success, and database failure.
- `src/http/routes.test.mjs`, auth gate tests, and the route's pulse proof.
- Live read-only route proof after ship. Never use a live write for refactor QA.

### 4. Shared browser services, then one screen at a time

**Payoff:** high. **Risk:** medium-high. **Do after unit 3 gives stable APIs.**

Repeated shape:

- 58 app pages hold inline script and 57 hold inline style.
- 18 files define their own `api` helper.
- 59 files read or write `localStorage` directly.
- Large pages mix fetching, state, math, painting, and click actions.

Target shape:

- Put request/session handling, safe text painting, date/money formatting,
  busy-button locks, and storage keys in tested shared modules.
- First extract pure render functions. Then extract reads. Move writes last.
- Keep CSS and screen layout unchanged during code moves.
- Split each large page by its real panels, not by arbitrary line count.

Safe order:

1. Read-only owner screens with no money action.
2. `campaign-manager.html`, `creative-factory.html`, and `social-studio.html`.
3. `pipeline.html` and `client-control-panel.html`.
4. `client-portal.html` and `inquiry-remover.html`.
5. Money, contract-send, teleprompter, and other live action screens last.

Protection:

- Existing `src/http/*-screen.test.mjs` and `src/ui/*.test.mjs` files.
- One Playwright path for every moved panel: load, expected result, action
  disabled/enabled state, error state, and refresh.
- Exact catalog row proof for each control on that panel.
- Screenshot comparison only for layout; business numbers need data asserts.

### 5. Split the three large business engines around pure decisions

**Payoff:** high. **Risk:** very high. **Do only after units 1–4.**

First targets:

- `src/handlers/money-chain.mjs` — 1,659 lines.
- `src/marketing/api-contract.mjs` — 2,494 lines.
- `src/marketing/catalog.mjs` — 1,836 lines.

Target shape:

- Separate pure decisions from DB reads, provider calls, writes, and sends.
- Use one input object and one result object per decision.
- Keep idempotency keys and transaction boundaries at the outer service.
- Keep price, product, stage, and route truth in one named source for each
  domain. Do not make a second config file during the split.

Protection:

- Characterization tests first. Use today's input and exact output as the pin.
- Fake-data tests for each pure rule and transaction rollback tests for writes.
- Existing money tripwires, message delivery proof, and workflow receipts.
- Replay tests: the same event twice must not make two sales, payments,
  messages, cards, or commissions.

Money-chain moves last inside this unit because a wrong split can charge,
enable, pay, or move the wrong client.

### 6. Standard job definition and run receipt

**Payoff:** medium-high. **Risk:** medium-high. **Do with unit 2 or after it.**

Repeated shape:

- Workflow id, name, cron/event trigger, exported handler, registry entry,
  heartbeat, catalog door, and tests are written in different places.
- The existing audit found ids such as `morning-brief` and `daily-pulse` that
  needed an explicit alias.

Target shape:

- One checked job definition owns id, name, trigger, expected cadence,
  handler, and whether it may send or write.
- Generate the Inngest list and pulse registration from that definition.
- Keep event run receipts and scheduled heartbeat receipts separate, because
  long sleeps and event-only jobs have different health rules.

Protection:

- `src/workflows/index.test.mjs`.
- `src/pulse/workflow-runs.test.mjs` and `.pg.test.mjs`.
- `src/pulse/heartbeats.test.mjs`.
- Replay, long-sleep, failed-attempt, and missing-receipt fixtures.

### 7. Test-kit cleanup

**Payoff:** medium. **Risk:** low if done last.

Repeated shape:

- Large pulse tests build similar fake DBs, fetch responses, clocks, and row
  assertions. Some single files are 1,100–1,500 lines.
- Catalog proof tests each discover files and spawn Node in similar ways.

Target shape:

- Shared fake DB queue, fixed clock, HTTP response builder, and pulse-row
  assertion helpers.
- Keep each test's business example beside the domain. Share only mechanics.
- Never hide SQL text or expected business numbers behind a broad helper.

Protection:

- Move helpers with no expected-output changes.
- Run old and new test forms together for one commit where practical.
- Test count may not drop. Skips may not rise.

## Safe run order

1. Freeze current route, workflow, pulse, and catalog inventories in tests.
2. Build the pulse check kit. Move one low-risk gap module. Prove parity.
3. Move gap modules in small domain batches. Money/customer modules last.
4. Build source manifests and generate static join files. Prove bundle parity.
5. Add the small API shell. Convert read routes first, writes last.
6. Add browser services. Split one large screen per change.
7. Split marketing engines. Split money-chain last.
8. Clean test mechanics after product seams are stable.

Every step is its own commit. A red before the refactor stays the same red.
A green before the refactor must stay green. New red, missing row, changed id,
changed money, changed customer result, or changed send count means stop and
revert that unit.

## What not to do

- No whole-repo rewrite.
- No framework swap while moving business rules.
- No runtime folder scan in Netlify.
- No generic source-exists proof in place of a result check.
- No UI redesign mixed into a code split.
- No route rename, workflow id rename, or schema cleanup inside a refactor.
- No live text, email, call, payment, or customer write as proof.
- No auto-fix in the pulse. It reports. Chris fixes reds.

## Best first batch

Start with pulse contract work only:

1. Add the shared row/result builder.
2. Convert three small read-only gap modules.
3. Compare every old and new row field.
4. Run focused module tests, self-audit, and changed catalog proof.
5. Ship only if row count, ids, state, reason, and proof are identical.

That batch cuts repeat code in the system that watches the whole company,
without changing the company itself.
