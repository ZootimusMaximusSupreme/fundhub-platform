# Slice 2 manifest — customer messages (builder S2)

Branch: `prf/s2-messages` (local only, never pushed). Tests only. No product code changed.

## The count

| | Before | After |
|---|---|---|
| Rows in slice 2 that said NOT_PROVED | 205 | 51 |

Measured by running the four lanes offline (routes, display, flow, reads) and counting
the slice's ids. By lane: routes 18 to 1, screen controls 64 to 28, flows 123 to 22.
154 rows now have a test that can fail.

## What each proof is

- **Routes (17 of 18).** The real `api/` handler runs with a stand-in database, no network,
  and the in-memory mail provider. Each test judges the exact result the row names: what
  the caller is told, and what was queued, saved or refused. Files:
  `src/http/s2-message-routes-{auth,calls,chat,contracts,outbound,write}.test.mjs`.
  Attached by `src/pulse/catalog/proofs/s2-door-contracts.mjs`.
- **Role journeys (90 flows).** `s2-role-probe.mjs` signs in as each of the eight kinds of
  person and sends a GET and an empty POST through the real adapter to every route.
  `s2-role-route-reach.test.mjs` counts a route only when the written gate and the real
  answer agree. A row passes when the agreed count in its group is at least the number
  the row names and at least the count measured today, so one route opened or closed by
  mistake turns a row red. The routes where the two disagree are named in the test with
  the reason.
- **Screen controls (36).** Two halves that meet at one request. Browser half: a real page
  driven by a Playwright spec with fake routes, judging the exact write
  (`e2e/s2-agent-editor-save`, `s2-money-alerts`, `s2-financeos-alerts`,
  `s2-ccp-portal-access`, plus the existing `ops-admin-outbound`,
  `agent-editor-promote-demote`, `documents-clicks` specs). Server half: the real handler
  (`s2-agents-save`, the s2 route tests, the existing `money-alerts.test.mjs`). Attached by
  `s2-display-contracts.mjs`; its wrapper test `s2-display-contracts.test.mjs` runs every spec.
- **Message flows (7) and consulting pages (2).** Attached by `s2-flow-contracts.mjs`; their
  browser half runs from the small wrapper `s2-flow-pages.test.mjs` (the flow guard gives each
  test file 120 seconds).
  Message rows also name `gate.test.mjs` and `dispatch.test.mjs`, which the existing guard
  requires. Two rows (`slo-connections#1`, `optimize#2`) already had rendered-page proofs and
  only left the gap monitor.

## Every proof was broken on purpose once

Each was broken in the product file, went red, and was restored with `git checkout`.
Routes: send-portal-link role gate, magic-link reply leak, messages-outbound role gate,
outbox pause, contract chase limit, template save flag, agent-call do-not-call check,
portal-message delivered flag, payment-link status check. Role probe: lender read gate,
admin-reset gate. Screens and servers: agent-editor book switch, money-alerts set_alert,
consulting terms heading, client-control-panel sign-in link, agents save guardrails,
magic-link verify claim, dispatch compliance check, payment-link text url.

## Shared lines I touched (for the integrator)

Smallest possible edits. Numbers are the real ones I measured on this branch.

- `proofs/door-proof.mjs`: one import line, one `|| s2DoorProof(sourceFile, row)` line.
- `proofs/door-proof.test.mjs`: one regex word (`s2-door-contracts`); the "known partial
  rows" sample list lost `agent-call` and `authorized-rep` (now fully proved) and gained
  `closer-deck generate_letters`.
- `coverage/gap-door-batch-routes.mjs` `EXPECTED_ROUTE_GAP_COUNTS`: routes-0 97 to 92,
  routes-1 110 to 105, routes-2 63 to 59, routes-3 40 to 37. Its test: 310 to 293.
- `proofs/door-batch-route-result.test.mjs`: rows 310 to 293, targets 240 to 231.
- `proofs/flow-result-proofs.mjs`: one import line, `|| s2FlowProof(sourceFile, row)`.
- `proofs/flow-gap-cases.mjs`: one import, two early returns, `EXPECTED_FLOW_GAP_COUNTS`
  message 177 to 170, journey 105 to 11.
- `coverage/gap-catalog-flow.test.mjs`: 283 to 182, NOT_PROVED 123 to 22.
- `proofs/flow-read-contracts.test.mjs`: flow 123 to 22, total 150 to 49, unproved 138 to 39.
- `proofs/flow-result-proofs.test.mjs`: the guard "route counts never prove signed-in role
  access" now demands a test that signs in (names the probe and the reach test) instead of a
  red gap row; "17 outbound leftovers" is now 10.
- `proofs/display-proof-cases.mjs`: one import, one spread line.
- `proofs/display-proof-cases.test.mjs`: red count 1,039 to 1,008.
- `proofs/display-saved-result.mjs`: five always-red `gap(...)` entries removed (Save agent,
  Promote, Return to shadow, Prompt textarea, Contract Remind). `coverage/gap-catalog-display.test.mjs`:
  45 contracts to 40, always-red 18 to 13.
- `src/pulse/catalog/generated.json`: recompiled with `node scripts/pulse/compile-catalog.mjs`.
  After merging all five branches, run that command again and take its output.

## Left NOT_PROVED, and why

- `route:closer-deck generate_letters`: the letter pack needs a document store and a PDF build
  that a stand-in database cannot answer honestly.
- 28 screen controls: closer-dashboard contract panel (3), client-portal chat, notifications and
  unlock buttons (3), the shared chat widgets (3), messaging Send / blocked / held (3), pipeline
  New Client, server, four card-stacking columns, MOVE menu, SMS/email lines (8), present.html
  (4), social-studio (3), money vault Reject (1). Each needs a server test and a rendered spec
  that were not written in this run.
- Flows: the 5 climate rows and the 3 soft-pull rows need a rendered page not built here; 3
  consulting rows are false against the live page (see findings); 10 message rows are findings
  or need live data (see below).

## Product findings (not fixed)

1. Any staff role, setter, closer and CSM included, can save an AI agent's prompt and
   guardrails and promote it live. `api/agents.mjs` gates on every staff role, and promote has
   no role check.
2. The consulting page does not match its intended journey. The journey says three posted
   prices ($5,000, $5,000, $10,000), education wording, and an enrollment mail to
   `support@fundhub.ai`. The live page says marketing consulting for agencies, no posted
   price, and mails `support@fhconsulting.online`. Rows #2, #3 and #5 stay not proved.
3. `GET /api/social/posts?partner_id=` returns a partner's queued posts to any staff role.
   The journey reading says only owner and admin; that limit guards approve and reject only.
4. The client journey says clients stay blocked from banking, but `banking/link-token` and
   `banking/link-exchange` answer a signed-in client, and the 17 `money/*` routes plus
   `blueprint/declines` serve a client's own file. The written journey reading calls them
   staff-only.
5. The SMS duplicate guard (`sms-dedup.mjs`) is imported by nothing, so it never runs.
6. `sendToClient` for web push has no caller, so no client push can be sent.
7. `owner_notifications` rows are written and nothing reads or sends them.
8. A staff text to a client with no email or phone on file is still queued, with no
   destination, and only fails later at the sender.
9. Finding about the old guard: the role journey pages are copies of the code reading, so a
   gate that answers "forbidden" only after the body is read (`partner-marketing/*`,
   `social/*`, `brand/review`, `money/setup`) cannot be told apart by an empty request. The
   test names them and does not count them.

## Tests I ran at the end (all on this branch)

- `node --test src/pulse/catalog/*.test.mjs src/pulse/catalog/proofs/*.test.mjs
  src/pulse/coverage/gap-catalog*.test.mjs src/pulse/coverage/gap-door-batch*.test.mjs`:
  1,350 tests. The first full run had 2 failures, both explained and rechecked: the flow guard
  timed out my big browser wrapper (fixed by the small wrapper) and one existing
  agent-editor spec timed out under load (passes alone, 8 of 8). After the fixes, the long
  guards (`flow-result-proofs`, `display-proof-cases`) pass 12 of 12, `read-reviewed-e2e`
  passes, and the 38 gap lane tests pass.
- `npm run lint`: 3,468 files parse clean.
- `node scripts/pulse/compile-catalog.mjs --check`: fresh.

## Run notes

- Playwright runs from many tests at once step on each other's `test-results` folder on a busy
  Mac. Run the browser wrapper tests one at a time if one shows a 30 second timeout.
- A first draft of the outbound test spun a node child at full CPU for 14 minutes because
  `assert.deepEqual` diffed two long email strings. It now compares with `includes`.
