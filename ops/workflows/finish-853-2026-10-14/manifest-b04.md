# Batch 04 manifest: customer-message screen controls (gap-catalog-display, tier 2)

Branch `fin/b04`, built from `fin/base` (2f4f574a0). Not pushed, not merged.
Generation 1 built the checks. **Repair cycle 1 (2026-10-15)** is described first, because an independent
checker broke the product on purpose and found 22 of the 28 rows green when they should have been red.
Tests and checks only. No product code was changed (every product break was made in a scratch edit and put back).

## The count (repair cycle 1)

| | Rows of this batch |
|---|---|
| Open at the start of this cycle (`count-not-proved.mjs`) | 0 of 28 |
| Open at the end of this cycle | 1 of 28 |
| Live checks (a query over saved results) | 25 of 28 (7 of them also run a practice test for the half no saved result shows: rows 8, 11, 12, 13 to 16) |
| Practice tests with no query | 2 of 28 (the cockpit script, the push button) |
| Not attachable | 1 of 28 |

Whole display lane open: 652 at the start of this cycle, 653 after. All four lanes: 825 at the start, 826 after (the one row went
back). Numbers re-measured from this worktree with `node scripts/pulse/count-not-proved.mjs`.

## What the checker found, and what each of the 22 rows is now

Every row names what was added. "Break" means the checker's own break (or a nested one found while repairing) was turned into a
fixture and goes red. Words like "live check" and "practice test" are used on purpose; nothing here is called deep.

| # | Row | Final outcome | Where | What was strengthened |
|---|---|---|---|---|
| 1 | present.html: Cockpit script ('Say this', 'Watch for') | practice-test | `fin-b04-present-cockpit.test.mjs` (17 tests) | Was 3 of 5 wraps and 2 of 4 routes. Now 12 routes (funding, funding plus repair, repair top / trial / DIY rung, descent to repair / trial / DIY, education Funding Mastery / deliverables, descent to either education rung). For each: the lines on The investment slide, the close logistics, the exact wrap words and the exact "Watch for" words. All 8 of the checker's product breaks go red; so does each of the 5 old tests' product. |
| 2 | present.html: 'Send contract' | live-check | `CONTRACT_DECK_SEND_SQL` in `fin-b04-sql-flows.mjs` | Reads the company, not only the contracts: every wording the deck can pick must exist as an active, real (not placeholder) agreement, and every contract sent in 30 days must have a registered document, a signer, a wording its chosen offer sells (pay link product or the call's `closer_deck_disposition.offer_key`), a signing email addressed to the signer (or the live representative) and not failed or stuck. |
| 3 | present.html: 'Send deliverables package now' | live-check | `DECK_DELIVERABLES_SQL` | The four core pages must each come from this button (`generated_by closer-deck`, `closer-deck-deliverables:` source), not from an earlier workflow. A client on the EDUCATION route who got the repair letter pack (F41) now enters the sample and goes red. The email must exist and not be failed or stuck. |
| 4 | messaging.html: Held-for-quiet-hours | live-check | `MESSAGE_HELD_SQL` | A hold must be the next 8:00 am Arizona AND no more than 12 hours after the claim that held it (a day or a week too long is red while the text waits). A text sent between 8 pm and 8 am with nothing holding it is red (prove / sim files and a minute on each edge excepted). A text blocked for quiet hours (the permanent-loss bug) is red. |
| 5 | messaging.html: Blocked result | live-check | `MESSAGE_BLOCKED_SQL` | Sample now includes sent and delivered staff messages. Red: sent to a client who had opted out on that channel (opt-out and opt-in times compared with the send), sent with words an active, unscoped, non-warning restricted-wording rule matches (phrase and regex). A task must be owned by a real staff role. |
| 6 | messaging.html: Send button | live-check | `STAFF_MESSAGE_SQL` | Added: failed with nothing reaching the client after it, stuck queued or sending a day, sent to an opted-out client, a text sent at night, and the shift rule judged from the `shifts` table at the moment the message was written, on both channels (email logs no event, but the route's shift gate held). |
| 7 | closer-dashboard.html: wording select and blank-field inputs | live-check | `CONTRACT_BLANKS_SQL` | Every blank the price list fills (`defaultContractValues`, read from the app config at load, 7 wordings, 21 blanks) must hold the price list's figure: a typed 1, abc, undefined or a lower fee is red. The wording must be one the chosen offer sells. |
| 8 | client-portal.html: Unlock modal buttons | live-check + practice test | `PORTAL_CALL_REQUEST_SQL`; `fin-b04-portal-prefill.test.mjs` (8 tests) | Topic empty or undefined / null / NaN / [object Object] is red. The buttons save nothing, so the page code is also RUN: each button on the page opens the chat with `I would like a call about: <topic>`, falls back to a real topic, keeps what the client typed, and works with no chat on the page. 6 product breaks go red. |
| 9 | client-portal.html: Turn on / off notifications | practice-test | `fin-b04-push-store.test.mjs` (10 tests) | Was a live check that could not see the 'off' half. The store's own functions are run against a stand-in for its one table (reads the real SQL text): saved sealed and tied to the login, same device refreshed not duplicated, a phone signed in as another client moves, a revoke turns off exactly that client's exactly that device, a revoke of someone else's device turns nothing off, twice is fine, everything off is that client's only. 8 product breaks go red. |
| 10 | chat-widget.js: Message > Client | live-check | `STAFF_MESSAGE_SQL` | Same as row 6. |
| 11 | shell.js (desks-c): Chat widget on every desk | live-check + practice test | `CHAT_WIDGET_SQL`; `fin-b04-chat-ask.test.mjs` (10 tests) | Message staff and Message a client are judged live (the note half judged as before, the client half is row 6's rule). Ask and Knowledge save nothing, so the route `api/chat/ask.mjs` is RUN with its model and retrieval handed in (the route takes them as deps): method, staff gate, company, question rules, mode to call, role and company passed to retrieval, answer and sources shown, failures shown. 12 product breaks go red. A real model's wording is not held by a test and is not claimed. |
| 12 | shell.js (desks-b): Chat widget launcher | live-check + practice test | same | Same as row 11. |
| 13 | pipeline.html: column 'Apply Now' | live-check + practice test | `ROUND_STARTED_SQL`; `fin-b04-pipeline-columns.test.mjs` | Starts from the CARDS in the column, not from events. A card dropped whose round event was lost (the move is kept when the emit fails) now goes red after an hour. The text and email must exist and not be failed or stuck (opted out of texts excepted). The count and funding est. are painted from the read (`stageAmount`), so the page is RUN too. |
| 14 | pipeline.html: column 'Approved' | live-check + practice test | `ROUND_APPROVED_SQL`; same page test | Same shape, plus the approved amount rule (a text and email owed only when the amount is above zero). |
| 15 | pipeline.html: column 'Closed' | live-check + practice test | `ROUND_CLOSEOUT_NOTIFY_SQL`; same page test | Same shape. |
| 16 | pipeline.html: column 'Round Submitted' | live-check + practice test | `ROUND_SUBMITTED_NOTIFY_SQL`; same page test | Same shape. |
| 17 | pipeline.html: MOVE menu | live-check | `ROUND_STARTED_SQL` | Same query as row 13 (the MOVE menu posts to the same route and the same `moveCardToStage`). |
| 18 | pipeline.html: New Client | live-check | `PIPELINE_NEW_CLIENT_SQL` | The client file must hold the typed email, a first name, an E.164 phone, and a listed product; a client this save created holds the typed first name; a card on the SALES board (not any board); welcome email and text exist and are not failed or stuck. |
| 19 | pipeline.html: pipeline-clients (server) | live-check | `PIPELINE_NEW_CLIENT_SQL` | Same query as row 18. |
| 20 | social-studio.html: 'Approve it' | live-check | `SOCIAL_APPROVED_SQL` | The approver must be an owner or admin on staff (APPROVAL_ROLES). The post must have a send time, and one still queued an hour past its time on an active account is red. |
| 21 | social-studio.html: Tab 'Could not be sent' | not-attachable | none | See below. |
| 22 | social-studio.html: 'Queue it' | live-check | `SOCIAL_QUEUED_SQL` | The one column the control writes is read: an hour after it was queued the row must carry a send time, and one more than a day past is red (nothing hands a row queued without an account to the sender). |

### The one row that cannot be made honest

Row 21, tab 'Could not be sent'. The tab can never show a failed post: the page lists `GET /api/social/posts`, which reads
`marketing_content_queue`, whose status check (migration 243) admits draft, queued, scheduled, awaiting_approval, discarded and
blocked and never `failed`. Failed posts live in `social_posts`, which the page never reads. A check of `social_posts` judges a
different table from the one the tab draws and would stay green while the tab says "Nothing has failed"; a practice test of the
route would have to assert the bug and stay red. It needs a product change in `api/social/posts.mjs`. The row is back to NOT_PROVED.

### Rows whose limits are said out loud

- **Rows 13 to 16 (count and funding est.).** The number is computed when the board is read (`count`, `stageAmount` in
  `api/dashboard/pipeline.mjs`). No saved result holds it, so the page practice test holds it, not the live check.
- **Row 17 (MOVE menu).** The same move deletes the old rail's card when `from_pipeline_key` is sent. A client can hold cards on two rails
  legitimately (workflows advance rails without deleting), so a card left behind cannot be told from a legitimate one. Not judged.
- **Row 5 (Blocked result).** The map words say an opt-out raises a task. `gate.mjs` raises a task only for restricted wording; an
  opt-out clears on its own. The check judges what the code does (product finding 2, unchanged). A task that a person closed still
  counts as raised: a person read it.
- **Rows 3 (education route).** The route is read from `custom_fields.closer_deck_disposition.route = 'EDUCATION'`, which the deck
  writes when the call is logged. A deck button pressed and the call never logged leaves no route to read.
- **Row 5 and row 6.** Restricted-wording rules are read the way the gate reads them (`compliance_rules`, active, no platform scope,
  not `warn`; phrase = case-insensitive substring, regex = case-insensitive, the patterns are written to read the same in both
  engines per migration 047). A rule written after the message does not count against it.
- **Texts are dead until Twilio is back (RESUME.md).** Every staff text and round text now reads red while texts fail, until a
  later text reaches the client. That is the break, not a false alarm.

## Honest numbers: breaks put in on purpose and put back

| Where the product (or the SQL) was broken | Count | Result |
|---|---|---|
| Nested SQL conditions, one at a time, in `fin-b04-sql-messages.mjs` and `fin-b04-sql-flows.mjs` (opt-out channel, opt-in after send, failed recovered by an earlier / other-client / failed later text, stuck threshold, owner shift exemption, other person's shift, quiet-hours edges, prove file, rule scope / warn / inactive / later / other company / regex / phrase, hold bound, task role, undefined topic, signing email address / signer id / representative removed or other client's, failed / stuck email, resend of another signer, any client's pay link, disposition, combined agreement, price list, deck wording presence / inactive / placeholder, any generator's file, education route, delivery email failed, lost round event, grace, failed text, email opt-out, opted-in, welcome failed, any board's card, phone shape, created name, approver role, active account, past time) | 55 | all 55 red after fixtures were added for 9 that first survived or did not match |
| Every top-level condition dropped one at a time (the drop-one sweep inside `fin-b04-display-results.test.mjs`, now 21 queries) | all | a condition no fixture row can tell from its absence fails the test; none left |
| `public/app/present.js`, cockpit | 8 | all red |
| `public/app/client-portal.html`, prefill | 6 | all red |
| `public/app/pipeline.html` and `api/dashboard/pipeline.mjs`, column paint and drop | 6 | all red |
| `src/push/store.mjs` | 8 | all red |
| `api/chat/ask.mjs` | 12 | all red |

The product files were restored with a byte copy after each run; `git status` shows no product file changed.

A real Postgres could not be run on this Mac (no local Postgres, no install). The queries are run by `fin-b04-sql-lite.mjs`,
which reads the SQL text, uses three-valued logic like Postgres, and refuses a table or column the repo's migrations do not define.
Two bugs it found in the new SQL (a `NULL = 'KEY'` that read as "not bad", and a dollar sign next to a digit in a query text) were
fixed. Differences from Postgres that remain possible: regex dialect on rows I cannot see (the 047 trigger validates every stored
regex in Postgres), `LIKE` with a literal `%` in a phrase (a phrase is read with `strpos`, so none), and plan time on a large
`messages` table (every query is bounded by company and a 30 day window; the correlated reads run per bad-candidate row).

## Files added or changed

Added:

- `src/pulse/catalog/proofs/fin-b04-portal-prefill.test.mjs` (8 tests, row 8)
- `src/pulse/catalog/proofs/fin-b04-pipeline-columns.test.mjs` (2 tests, rows 13 to 16)
- `src/pulse/catalog/proofs/fin-b04-push-store.test.mjs` (10 tests, row 9)
- `src/pulse/catalog/proofs/fin-b04-chat-ask.test.mjs` (10 tests, rows 11 and 12)

Changed (all of them mine from generation 1):

- `fin-b04-sql-messages.mjs`, `fin-b04-sql-flows.mjs` (the queries), `fin-b04-sql-lite.mjs` (`strpos`)
- `fin-b04-display-results.mjs` (rows, the practice rows, the one not-attachable row)
- `fin-b04-display-fixtures.mjs` (every break and every "looks odd but is right" row, run by the 823 tests)
- `fin-b04-display-results.test.mjs` (823 tests), `fin-b04-present-cockpit.test.mjs` (17 tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b04.md` (this file)

## Shared lines touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | unchanged this cycle (generation 1 added the import and the spread; the always-red entry for the Held-for-quiet-hours control stays removed) |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | unchanged this cycle |
| `scripts/pulse/compile-catalog.mjs` | unchanged this cycle |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers: contracts and cases 40 to 64; pass-capable 27 to 52; always-red 13 to 12 (three places); unique queries 27 to 48 (two places); title 40 to 64 |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 648 (the one not-attachable row stays red) |
| `src/pulse/catalog/generated.json` | recompiled with `node scripts/pulse/compile-catalog.mjs`; expect a conflict, take the integrator's compile |

Other display batches change the same guard numbers. Add the decreases together and use the number the tests print.
My part: contracts +24 (25 rows with a query, 1 always-red entry replaced), always-red -1, unique queries +21, red count -24.

## Product findings (not fixed)

1. `api/closer-deck.mjs` has a role gate and no shift gate, and its pay-link and soft-pull messages (texts and emails) call
   `composeAndSend` with no `shiftId`. A closer who has not clocked in can send them. The staff-reply check leaves those two
   idempotency prefixes out on purpose.
2. The coverage map text for the messaging "Blocked result" says an opt-out raises a task. `gate.mjs` raises a task only for
   restricted wording; an opt-out clears on its own. The check judges what the code does.
3. The Social Studio 'Could not be sent' tab can never fill (reads `marketing_content_queue`; failed posts live in `social_posts`).
4. 'Queue it' without an account only marks the queue row `queued` with a time. Nothing hands that row to the sender, so it is never
   published. The page says "Past its time, it goes out on the next send". A row more than a day past its time now reads red.
5. `netlify/functions/staff-message-sweeper.mjs` header says held texts go out at 11:00 Arizona. The dispatcher and gate use 08:00.
   The comment is stale, the code is right, and the check reads 08:00.
6. `revokeSubscription` (turning notifications off) writes no event and no log, so "off" leaves nothing a query can read.
7. `s-00-welcome` welcomes a client once (a lock on the client file); a client created from the pipeline form who was welcomed earlier
   through another door gets no new welcome. By design; the check asks whether the client was ever welcomed.
8. A second save of the same email from the pipeline form with another product writes the new product to the client file, but the
   event is deduped by its key and keeps the first product. The check only requires a LISTED product on the file, not this
   event's product.
9. `safeError` (`src/http/health.mjs`) scrubs database hosts but passes the rest of an error message through, so a model failure
   message reaches the staff screen as written.
10. The deck's "Send contract" says "No agreement is set up for this offer yet" and saves nothing when a wording is missing. A
    missing wording is only visible from the wordings table; this batch reads it there (row 2).

## Commands run and results (this Mac, repair cycle 1)

| Command | Result |
|---|---|
| `node --test src/pulse/catalog/proofs/fin-b04-display-results.test.mjs` | 823 of 823 pass |
| `node --test src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs` | 17 of 17 pass (5 old, 12 new) |
| `node --test src/pulse/catalog/proofs/fin-b04-portal-prefill.test.mjs` | 8 of 8 pass |
| `node --test src/pulse/catalog/proofs/fin-b04-pipeline-columns.test.mjs` | 2 of 2 pass |
| `node --test src/pulse/catalog/proofs/fin-b04-push-store.test.mjs` | 10 of 10 pass |
| `node --test src/pulse/catalog/proofs/fin-b04-chat-ask.test.mjs` | 10 of 10 pass |
| `node --test src/pulse/catalog/*.test.mjs` plus `gap-catalog-display`, `gap-catalog-flow`, `gap-catalog-reads`, `gap-door-batch-routes`, `modules`, `tripwires`, `na-conditions`, `self-audit`, `no-unfenced-transmit` | 234 of 234 pass |
| `node --test display-proof-cases.test.mjs` (the two guard tests, then the focused every-named-test run) | 3 of 3 pass |
| `node scripts/pulse/compile-catalog.mjs --check` | fresh (exit 0) |
| `node scripts/pulse/count-not-proved.mjs` | 826 total, this batch 1 of 28 open |
| `npm run lint` | 3,573 files parse clean |

The third test in `display-proof-cases.test.mjs` ("the focused proof test runs every executable test named by every case") runs
every named test of every batch, browser specs included. It passed in this cycle (1 of 1), on a Mac with other builders running.
In generation 1 it failed on load flakes that were not this batch's files.

Nothing in this batch sends a text, an email or a vendor call, and nothing writes to a database. The queries are SELECT only, and
the practice tests run against stand-ins held in memory.

---

# Generation 1 (kept for the record)

Built 28 rows: 27 live checks and 1 practice test. Whole display lane 680 open before, 652 after; all lanes 853 before, 825
after. The checker then found the weaknesses repaired above. What generation 1 built and still stands: the read-only SQL stand-in
(`fin-b04-sql-lite.mjs`), the fixture scheme (healthy rows, single breaks, looks-odd-but-right rows, ignored rows, every break
again inside a second company that must never be counted), the drop-one-condition sweep, and the writer pins in
`fin-b04-display-results.test.mjs` (the dispatcher is the only writer of `messages.scheduled_at`, the shift exemption is the owner
alone, the gate's clearing codes, the quiet window, the portal note and staff send shapes, the round, contract, letter, pipeline
and social writers).

The first run also found these while writing the queries (each one changed a query): an authorized rep's sign-in account has no
client id of its own; a held text, or one retried by the sweeper, is sent outside the request and leaves no `text_sent` event; the
approvals workflow (f-04) says nothing unless `approvedAmount` is above zero; opted-out clients get no text from `sendTemplated`.
