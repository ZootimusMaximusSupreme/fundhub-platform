# Slice 2 manifest — customer messages (builder S2, repair round)

Branch: `prf/s2-messages` (local only, never pushed). Tests only. No product code changed.

## The count

| | Before | After |
|---|---|---|
| Rows in slice 2 that said NOT_PROVED | 205 | 52 |

Measured by running the four lanes offline (routes, display, flow, reads) with a stand-in
fetch and counting the slice's ids: routes 1, screen controls 28, flows 23, reads 0.
153 rows now have a test that can fail.

First build left 51. The repair gave one row back (see "Un-attached" below), so it is 52.

## What the checker found, and what I did

| Finding | What I did |
|---|---|
| 1. `s2-agent-editor-save` trigger test failed 5 of 18 clean runs | Fixed the wait. The page folds every card after a save, and the test opened cards before that fold. `saveAndRead` now waits for the fold, then opens the cards. Found a second cause too: the page blanks the saved "escalate to" person if the agent list answers before the staff list (about 1 run in 20 under load). The fake server now answers the agents only after the people lists are painted. Same second fix in `e2e/agent-editor-promote-demote.spec.mjs` (it failed 5 of 108 at 12 workers; now 96 of 96, twice). |
| 2. Only `EXPECTED_ROUTE_GAP_COUNTS` touched outside catalog | Unchanged. Listed below. |
| 3. Guard "route counts never prove signed-in role access" was rewritten | Read it again. It demands that the proof signs in as each role (the probe and the reach test), so a row cannot go green on a count. It can fail: if the probe stops signing in, the match on the probe file fails. Kept. |
| 4. Two rows left NOT_PROVED only by leaving the gap monitor | I broke the page behind each one. `optimize.html` book link and the products SLO tab (On/Off, product name) both turn `flow-read-contracts.test.mjs` red. The old rendered-page proofs are real. Kept. |
| 5. `ui:ops-admin outbound mail panel` names an alert-address field the page does not have | Un-attached. That row is NOT_PROVED again. The three buttons keep their own screen rows. |
| 6. Near-duplicates | The two money-alert specs now share one case table (`e2e/s2-money-alerts-cases.mjs`). The two Playwright wrapper tests share one helper (`s2-run-specs.mjs`). The route tests share one `call()` helper, the staff role list and the stand-in fixtures (`s2-route-kit.mjs`, `s2-auth-fixtures.mjs`). |
| 7. `CONTRACT_URL_SECRET` was never restored | Restored in `after()`. |

## The weakness hunt (same class the checker found)

I went through every proof for four weaknesses: a role gate tried with only allowed roles, a
company check decided by a flag, parameters checked but not the SQL, and a row that names more
than its test covers. What I changed:

- **Role gates.** Every gate is now tried with all eight staff roles (`STAFF_ROLES`, read from
  the app's own staff list). Admitted roles get through; every other role is refused and
  nothing is written, queued or sent. Done for: send-portal-link, authorized-rep, agent-call
  (six desks in, funding advisor and csm out), run_reminders and every messages-outbound
  action, payment-links send and expire (closer out), money helper (four FinanceOS roles in),
  message-templates approve, journeys read and save, funnel push-live, partner approve, and the
  money-alerts server. Also a client, partner and affiliate login and no login, where the door
  is staff only. The client control panel page now tries all eight roles for the two controls.
- **Company checks.** The stand-ins used to answer "yes, this client is in your company" from the
  client id alone, or from a flag. They now answer from both statement parameters. Every door
  has a case where a person from another company asks about this company's client, contract,
  invoice, template, funnel, partner, agent or payment ask, and gets 404 with nothing written.
- **Parameters but not SQL.** Where the test read `params[3]`, it now also checks the statement's
  column order, or the `WHERE` it depends on (portal-message insert, magic link insert,
  authorized-rep account insert, staff chat insert, money helper turn insert, journeys insert,
  template save, dispatch claim, outbound calls insert).
- **Compound rows.** Added the missing halves:
  - authorized-rep: the replace path (old link ended, old person's open file cleared, only the
    new person mailed) and adding the same person again (nothing replaced).
  - password reset: the email itself (the link, the one hour copy, the stored token's hash, for
    staff, partner and affiliate), suspended and client addresses, same reply every time.
  - magic link: both limits at the edge (3 per address, 15 per source, 15 minutes).
  - agent-call: the compliance gate stopping the call, a text opt-out not stopping a voice call,
    the fence values (only 0, false, no, off let a call out), no script, not on the phone system.
  - contracts remind: who is mailed (not signed, in order, parallel, declined), the fourth
    reminder is the last, and run_reminders leaves alone a contract with four reminders or one
    reminded yesterday.
  - messages-outbound: the cap of 5 with 4 sent lets exactly one more go, a limit in the request,
    another company's queue untouched, backlog skips emailed, void and other-company invoices.
  - payment-link: a link already sent may be sent again, void is refused, one message per link.
  - chat: a text between 8 pm and 8 am Arizona is held until 8 am, the edges are pinned, and an
    email is never held.
  - message-templates: a changed subject alone clears the approval, approve needs the exact
    subject too, a text with a subject and an email without are refused.
  - partner approve: the brand row, the `partner.approved` event, and a number or tick typed
    into the applicant's own free text cannot decide who is texted.
  - agent editor: all 13 trigger toggles, all five waits, all four channels, three message caps.
  - money alerts: Save day for each card (the second card used to be unproved), Save days leaves
    a card with no day alone, Cancel closes the form (no timer wait).
  - client control panel: the server refusing the portal link, a rep added but not queued.

## What each proof is

- **Routes (17 of 18).** The real `api/` handler runs with a stand-in database, no network, and
  the in-memory mail provider. Each test judges the exact result the row names: what the caller
  is told, and what was queued, saved or refused. Files:
  `src/http/s2-message-routes-{auth,reset-rep,calls,chat,money,contracts,outbound,write,funnel-partner}.test.mjs`.
  Attached by `src/pulse/catalog/proofs/s2-door-contracts.mjs`.
- **Role journeys (90 flows).** `s2-role-probe.mjs` signs in as each of the eight kinds of
  person and sends a GET and an empty POST through the real adapter to every route.
  `s2-role-route-reach.test.mjs` counts a route only when the written gate and the real answer
  agree. A row passes when the agreed count in its group is at least the number the row names
  and at least the count measured today.
- **Screen controls (36).** Two halves that meet at one request. Browser half: a real page driven
  by a Playwright spec with fake routes, judging the exact write (`e2e/s2-agent-editor-save`,
  `s2-money-alerts`, `s2-financeos-alerts` (both use `s2-money-alerts-cases.mjs`),
  `s2-ccp-portal-access`, plus the existing `ops-admin-outbound`, `agent-editor-promote-demote`,
  `documents-clicks`). Server half: the real handler. Attached by `s2-display-contracts.mjs`;
  `s2-display-contracts.test.mjs` runs every spec.
- **Message flows (6) and consulting pages (2).** Attached by `s2-flow-contracts.mjs`; the
  browser half runs from `s2-flow-pages.test.mjs` (the flow guard gives each file 120 seconds).
  Message rows also name `gate.test.mjs` and `dispatch.test.mjs`, which the guard requires.

## Un-attached in this round

- `ui:ops-admin outbound mail panel` (message flow). The catalog row names "an alert-address
  field on public/app/ops-admin.html". The page has no such field. It has three buttons
  (proved by their own screen rows). The alert address can only be set through the API
  (proved by the server test). A row that names a control that is not on the page cannot be
  proved, so it is back in the Flow gap monitor.

## Every proof was broken on purpose

Each break was made in the product file, went red, and was restored with `git checkout`
(`git status` clean after each). 83 breaks in this round went red. Four more changed nothing
anyone could see (the sign-in check already refuses a non-staff login before the role check, so
removing the second check is the same product); they are not counted. Examples by file:

- Role gates widened one role at a time: send-portal-link (setter), authorized-rep (csm),
  agent-call (csm), contracts run_reminders (setter), messages-outbound (setter), payment-links
  (setter, and closer allowed to send), money helper (staff set), message-templates approve
  (closer), journeys (csm), push-live (staff set), partners/approve (staff set), money-alerts
  (staff set), client control panel (csm, setter).
- Company check dropped: client scope, agent-call agent and client, contracts, invoices,
  payment-links, journeys, agents, money-alerts.
- Limits and windows: magic-link per address, per source, window length; chase limit off by
  one; chase every 3 days; cap `<= 0`; cap room; backlog bound 200; negative cap; quiet hours
  start 20 to 22 and end 8 to 9; fence value "on".
- Copy and wiring: reset link path, suspended staff, replaced flag, same person added, subject
  only change, approve condition on subject, partner event, brand row, free-text phone and tick.
- Pages: money-alerts always-true switch, Save day wrong card, Save days day 1, remove promo
  date, promo rate, agent-editor channel, trigger remove, message cap default, optimize.html
  book link, SLO tab On/Off and product name.
- Shared helper: the stand-in database and the one-message-per-link guard (removing
  `ON CONFLICT` in `sendTemplated` turns the new test red).

## Shared lines I touched (for the integrator)

Smallest possible edits. Numbers are the real ones I measured on this branch.

- `proofs/door-proof.mjs`: one import line, one `|| s2DoorProof(sourceFile, row)` line.
- `proofs/door-proof.test.mjs`: one regex word (`s2-door-contracts`); the "known partial rows"
  sample list lost `agent-call` and `authorized-rep` and gained `closer-deck generate_letters`.
- `coverage/gap-door-batch-routes.mjs` `EXPECTED_ROUTE_GAP_COUNTS`: routes-0 97 to 92,
  routes-1 110 to 105, routes-2 63 to 59, routes-3 40 to 37. Its test: 310 to 293.
- `proofs/door-batch-route-result.test.mjs`: rows 310 to 293, targets 240 to 231.
- `proofs/flow-result-proofs.mjs`: one import line, `|| s2FlowProof(sourceFile, row)`.
- `proofs/flow-gap-cases.mjs`: one import, two early returns, `EXPECTED_FLOW_GAP_COUNTS`
  message 177 to 171, journey 105 to 11.
- `coverage/gap-catalog-flow.test.mjs`: 283 to 183, NOT_PROVED 123 to 23.
- `proofs/flow-read-contracts.test.mjs`: flow 123 to 23, total 150 to 50, unproved 138 to 40.
- `proofs/flow-result-proofs.test.mjs`: the guard "route counts never prove signed-in role
  access" now demands a test that signs in; "17 outbound leftovers" is now 11; the per-file run
  timeout in "every test named by a flow proof passes" is 120 seconds, not 30 (the browser
  wrappers need it).
- `proofs/display-proof-cases.mjs`: one import, one spread line.
- `proofs/display-proof-cases.test.mjs`: red count 1,039 to 1,008.
- `proofs/display-saved-result.mjs`: five always-red `gap(...)` entries removed (Save agent,
  Promote, Return to shadow, Prompt textarea, Contract Remind). `coverage/gap-catalog-display.test.mjs`:
  45 contracts to 40, always-red 18 to 13.
- `src/pulse/catalog/generated.json`: recompiled with `node scripts/pulse/compile-catalog.mjs`.
  After merging all five branches, run that command again and take its output.
- Existing tests I made stronger (not weaker): `src/http/money-alerts.test.mjs` (all eight roles,
  the company is a statement parameter, another company is 404) and
  `e2e/agent-editor-promote-demote.spec.mjs` (the agent list waits for the people lists).

New helper files: `proofs/s2-route-kit.mjs`, `proofs/s2-auth-fixtures.mjs`,
`proofs/s2-run-specs.mjs`, `e2e/s2-money-alerts-cases.mjs`. No file is over 400 lines (largest
is `s2-message-routes-outbound.test.mjs`, 328).

## Left NOT_PROVED, and why

- `route:closer-deck generate_letters`: the letter pack needs a document store and a PDF build
  that a stand-in database cannot answer honestly.
- 28 screen controls: closer-dashboard contract panel (3), client-portal chat, notifications and
  unlock buttons (3), the shared chat widgets (3), messaging Send / blocked / held (3), pipeline
  New Client, server, four card-stacking columns, MOVE menu, SMS/email lines (8), present.html
  (4), social-studio (3), money vault Reject (1). Each needs a server test and a rendered spec
  that were not written in this run.
- Flows (23): the 5 climate rows and the 3 soft-pull rows need a rendered page not built here; 3
  consulting rows are false against the live page; the ops-admin outbound mail panel row (above);
  the rest are findings or need live data.

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
9. The role journey pages are copies of the code reading, so a gate that answers "forbidden"
   only after the body is read (`partner-marketing/*`, `social/*`, `brand/review`,
   `money/setup`) cannot be told apart by an empty request. The test names them.
10. **New.** The Agent Editor page loses the saved "escalate to" person when the agent list
    answers before the staff list. The page then shows "Pick a person", and the next Save would
    write that blank. It showed up as a test that failed about 1 run in 20 under load.
11. **New.** A reminder to a contract's second signer who is not the client on file is queued and
    then held by the compliance check ("no client attached"), so it never goes out. Counterparty
    signers have no client id by design (`src/contracts/notify.mjs`), and the gate blocks any
    message with no client unless it is a partner welcome or a candidate invite. The test only
    judges who is queued for them, not that the mail leaves.
12. **New.** The catalog says the Ops & Admin page has an alert-address field. It does not. The
    alert address can only be set by calling the API.

## Tests I ran at the end (all on this branch)

See "Final run" below.

## Run notes

- Playwright runs from many tests at once step on each other's `test-results` folder on a busy
  Mac. Run the browser wrapper tests one at a time if one shows a 30 second timeout.
- The Mac was at a load average of 25 to 60 while I worked (five builders and a checker). Single
  browser tests took 4 to 12 seconds instead of 1. Everything below passed under that load.
- The flaky test is proved fixed by running it alone and under load (numbers in "Final run").
