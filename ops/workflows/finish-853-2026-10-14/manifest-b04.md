# Batch 04 manifest: customer-message screen controls (gap-catalog-display, tier 2)

Branch `fin/b04`, built from `fin/base` (2f4f574a0). Not pushed, not merged. Generation 1.
Tests and checks only. No product code was changed.

## The count

| | Rows |
|---|---|
| Rows in this batch | 28 |
| Still NOT_PROVED before (`count-not-proved.mjs`) | 28 |
| Still NOT_PROVED after, same script | 0 |
| Live checks | 27 |
| Practice tests | 1 |
| Not attachable / N/A | 0 |

Whole display lane: 680 open rows before, 652 after. All four lanes: 853 before, 825 after.

## What was built

Each live check is one read-only query, keyed to the control's exact words in the coverage map, run by the
display lane for the company. It returns how many saved results exist and how many are wrong.
Controls nobody has used yet are green with the words "no saved results yet, none are wrong" and go red on the first wrong
result (`emptyAs: "quiet"`). The one exception is the send-contract panel: a company with no sendable wording is red.
Every window is the last 30 days, so an old bad row ages out; state tables (push devices, vault reviews, queued posts) have none.

The tests run the real SQL text over fake saved rows with a small read-only stand-in (`fin-b04-sql-lite.mjs`).
It reads only the SQL shapes these queries use, uses three-valued logic like Postgres, and refuses a table or column
that `db/schema` and `db/migrations` do not define.
Because there is no local Postgres here, I also ran every fixture (382 variants) through a real Postgres engine
(PGlite, in a scratch folder outside the repo, loaded with this repo's own schema and migrations) and compared:
0 differences. PGlite is not a repo dependency.

## Every row

| # | Row (map file / surface: control) | Outcome | Where | What it judges |
|---|---|---|---|---|
| 1 | desks-a.json / client-portal.html:Chat button (floating widget from shell.js: send message to staff) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (PORTAL_MESSAGE_SQL)` | Judges the saved inbound client note: on the client's own thread and channel, status received, compliance flag, words kept (api/chat/portal-message.mjs). |
| 2 | desks-a.json / client-portal.html:Turn on / off notifications button (web push subscribe) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (PUSH_DEVICE_SQL)` | Judges saved devices: real client, three saved secrets, account kind (client or authorized rep), turned off or expired only after made, one live client per phone (src/push/store.mjs). |
| 3 | desks-a.json / client-portal.html:Unlock modal: Ask an advisor / Talk to an advisor buttons (open chat with topic) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (PORTAL_CALL_REQUEST_SQL)` | Judges notes that start 'I would like a call about:' (the unlock modal's prefill): on the client's thread, topic not empty. |
| 4 | desks-a.json / closer-dashboard.html:Contract panel: Send button | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (CONTRACT_SENT_SQL)` | Judges contracts sent in the last 30 days: client, wording and key, named sender, link expiry after send, a signer, and the signing email queued within an hour when an address exists (src/contracts/send.mjs, notify.mjs). |
| 5 | desks-a.json / closer-dashboard.html:Contract panel: wording select and blank-field inputs | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (CONTRACT_BLANKS_SQL)` | Judges that every required blank the wording declares has a value in the contract's merge_values. |
| 6 | desks-a.json / closer-dashboard.html:Send contract button (opens panel) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (CONTRACT_WORDINGS_SQL)` | Judges active wordings the panel lists: key, name, signature sentence, real words (not the placeholder send refuses). No empty-grace: no sendable wording is red. |
| 7 | desks-b.json / financeos.html#vault:Staff only: 'Reject' with a reason the client reads, then 'Reject file' | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (VAULT_REJECT_SQL)` | Judges rejected vault files: the client's own upload, a named reviewer on staff, covers 1, no period, a written reason (src/finance/document-vault.mjs). |
| 8 | desks-c.json / messaging.html:Blocked result: opt-out or restricted wording refused and a task raised for a human | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (MESSAGE_BLOCKED_SQL)` | Judges blocked staff texts and emails: reason kept, words kept, and for restricted wording a task with an owner (gate.mjs, dispatch.mjs). Browser spec e2e/messaging-inbox.spec.mjs also stays attached. |
| 9 | desks-c.json / messaging.html:Held-for-quiet-hours result: text deferred to the next window and the words stay in the box | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (MESSAGE_HELD_SQL)` | Judges staff texts with a saved send time: sms only, outbound, time is the next 8:00 am Arizona after it was written. Replaces the always-red entry for this control. |
| 10 | desks-c.json / messaging.html:Send button (staff reply to a client by text or email; shift clock-in required) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (STAFF_MESSAGE_SQL)` | Judges staff replies: named sender on staff, the client's own thread and channel, outbound, words kept, provider receipt once sent, and a text sent at once logged on that person's open shift (owner exempt). |
| 11 | desks-f.json / present.html (+ present.js, contract-send.js):'Generate letters and email now' (offer allows letters, not education) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (DECK_LETTERS_SQL)` | Judges closer-deck letter files: real PDF with bytes, key and checksum, offer allows letters, letters email queued within an hour (src/sales/closer-deck.mjs). |
| 12 | desks-f.json / present.html (+ present.js, contract-send.js):'Send contract': picks the agreement that matches the offer, creates the draft, sends it, returns the sign link | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (CONTRACT_SENT_SQL)` | Judges contracts sent in the last 30 days: client, wording and key, named sender, link expiry after send, a signer, and the signing email queued within an hour when an address exists (src/contracts/send.mjs, notify.mjs). |
| 13 | desks-f.json / present.html (+ present.js, contract-send.js):'Send deliverables package now' (education route): saves the 5 UnderwriteIQ files to the portal and emails the client | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (DECK_DELIVERABLES_SQL)` | Judges clients with a deliverables package: the four core UnderwriteIQ pages saved as real files, offer allows letters, funding delivery email queued within an hour. |
| 14 | desks-f.json / present.html (+ present.js, contract-send.js):Cockpit script ('Say this', 'Watch for'): lines filtered by funding / repair / education route, [First Name] filled in, close wrap keyed to the offer actually chosen | practice-test | `src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs` | Browser practice test of the cockpit line filter (FUND, REPAIR, EDU), [First Name] and the close wrap by offer. The script is drawn and written nowhere, so a live check has nothing to read. Six product breaks each turned it red. |
| 15 | desks-e.json / public/app/chat-widget.js (mounted by shell.js on the same desks; skipped for partner and affiliate roles):Message > Client: paste a client id and send (goes through the compliance gate as a text) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (STAFF_MESSAGE_SQL)` | Judges staff replies: named sender on staff, the client's own thread and channel, outbound, words kept, provider receipt once sent, and a text sent at once logged on that person's open shift (owner exempt). |
| 16 | desks-e.json / public/app/pipeline.html:Card: SMS and email lines (links to messaging.html?client_id=&channel=, red 1 badge when the client wrote last) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (THREAD_LINK_SQL)` | Judges inbound texts and emails from known clients sit on that client's own thread for the channel (what the red 1 badge reads). |
| 17 | desks-e.json / public/app/pipeline.html:Funding: Card Stacking column 'Apply Now' (apply_now): shows count and funding est.; accepts a dropped card | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (ROUND_STARTED_SQL)` | Judges card-stacking round.started events: client, apply_now stage, round number and key, and an hour later the round row and the client text (round-started-client-notify). |
| 18 | desks-e.json / public/app/pipeline.html:Funding: Card Stacking column 'Approved' (approved): shows count and funding est.; accepts a dropped card | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (ROUND_APPROVED_SQL)` | Judges card-stacking round.approved events: stage, round number and key, round row, and (when approvedAmount is above zero) the client text and email (f-04). |
| 19 | desks-e.json / public/app/pipeline.html:Funding: Card Stacking column 'Closed' (closed): shows count and funding est.; accepts a dropped card | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (ROUND_CLOSEOUT_NOTIFY_SQL)` | Judges card-stacking round.closeout events: closed stage, round number and key, round row, client text and email (n-04). |
| 20 | desks-e.json / public/app/pipeline.html:Funding: Card Stacking column 'Round Submitted' (round_submitted): shows count and funding est.; accepts a dropped card | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (ROUND_SUBMITTED_NOTIFY_SQL)` | Judges card-stacking round.submitted events: round_submitted stage, round number and key, round row, client text and email (f-03). |
| 21 | desks-e.json / public/app/pipeline.html:MOVE menu: Card Stacking -> funding_card_stacking / apply_now (starts a funding round and texts the client) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (ROUND_STARTED_SQL)` | Judges card-stacking round.started events: client, apply_now stage, round number and key, and an hour later the round row and the client text (round-started-client-notify). |
| 22 | desks-e.json / public/app/pipeline.html:New Client (button opens the modal: name, email, phone, product with 6 choices; Save / Cancel; same save as the apply form) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (PIPELINE_NEW_CLIENT_SQL)` | Judges pipeline entry.captured events: name, email, phone, listed product on the client file, key, and an hour later the board card and the welcome email and text (a client already welcomed counts). |
| 23 | desks-e.json / public/app/pipeline.html:pipeline-clients (server): creates or finds the client through the funnel door and emits entry.captured, which sends the welcome email and text and places the Sales card | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (PIPELINE_NEW_CLIENT_SQL)` | Judges pipeline entry.captured events: name, email, phone, listed product on the client file, key, and an hour later the board card and the welcome email and text (a client already welcomed counts). |
| 24 | desks-c.json / shell.js (shared chrome on every staff desk):Chat widget on every desk: Ask (AI answer), Knowledge, Message staff, Message a client | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (CHAT_WIDGET_SQL)` | Judges widget messages that leave a saved row: staff notes on internal threads and client texts or emails. Ask and Knowledge save nothing, so those two modes have no result to read. |
| 25 | desks-b.json / shell.js shared chrome (on every desk here except financeos.html):Chat widget launcher and its modes (Ask, Knowledge, Message: a teammate, or an SMS to a client by id) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (CHAT_WIDGET_SQL)` | Judges widget messages that leave a saved row: staff notes on internal threads and client texts or emails. Ask and Knowledge save nothing, so those two modes have no result to read. |
| 26 | desks-f.json / social-studio.html:Held row (owner and admin only): 'Approve it' (asks first; the post goes out at its time) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (SOCIAL_APPROVED_SQL)` | Judges approved posts: named approver on staff, on its way out or gone, queue row mirrored as scheduled (api/social/posts.mjs). |
| 27 | desks-f.json / social-studio.html:Tab 'Could not be sent' (posts that gave up after 3 tries, plus the one open 'job to fix' strip) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (SOCIAL_FAILED_SQL)` | Judges failed posts: 3 tries, reason kept, real partner, a social_post_failed job opened. The page itself never lists them (product finding), so this reads the saved posts the tab should show. |
| 28 | desks-f.json / social-studio.html:Waiting row: 'Queue it' with its own time box (sets or keeps the send time, no account needed) | live-check | `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (SOCIAL_QUEUED_SQL)` | Judges queued rows: words kept, real partner, not handed to a social account. Note: nothing sends a row queued this way (product finding in the map). |

Not-attachable or N/A rows: none.

Notes on three rows that judge less than their words:

- Rows 24 and 25 (the two shell chat widget rows) name four modes. Only Message staff and Message a client leave a saved row.
  Ask and Knowledge return an answer to the page and save nothing (`api/chat/ask.mjs`), so there is no result to read for them.
  The live check judges the two modes that leave one and says so in its words.
- Rows 17 to 20 (the four Card Stacking columns) also say "shows count and funding est.". The live check judges what a drop saves
  (the round event, the round row, the client's text and email). The paint of the count and estimate is not judged here.
- Row 27 (tab 'Could not be sent') judges the saved failed posts and the job opened for them. The page never lists them (product finding 3),
  so a break in the page itself is not what this goes red on.

## Files added

- `src/pulse/catalog/proofs/fin-b04-sql-messages.mjs (queries: chat, texts, push, threads)
- `src/pulse/catalog/proofs/fin-b04-sql-flows.mjs (queries: contracts, vault, letters, rounds, new clients, social)
- `src/pulse/catalog/proofs/fin-b04-display-results.mjs (the 27 contracts, keyed by control; the practice row)
- `src/pulse/catalog/proofs/fin-b04-sql-lite.mjs (read-only SQL stand-in for tests, column catalog from migrations)
- `src/pulse/catalog/proofs/fin-b04-display-fixtures.mjs (healthy rows plus every single break, ok variant and ignored row)
- `src/pulse/catalog/proofs/fin-b04-display-results.test.mjs (the query tests, the drop-one-condition sweep, writer guards)
- `src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs (browser practice test, 5 tests)
- `ops/workflows/finish-853-2026-10-14/manifest-b04.md` (this file)

## Shared lines touched (the integrator must merge these)

| File | Change |
|---|---|
| `src/pulse/catalog/proofs/display-saved-result.mjs` | +1 import line; `...FIN_B04_RESULT_CONTRACTS,` added at the end of `DISPLAY_RESULT_CONTRACTS`; the always-red `gap("Held-for-quiet-hours result...")` entry removed (the same control now has a query) |
| `src/pulse/catalog/proofs/display-proof-cases.mjs` | +1 import line; `...FIN_B04_DISPLAY_PROOF_CASES,` added to the plug-in list |
| `scripts/pulse/compile-catalog.mjs` | +1 import line; `staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B04_DISPLAY_PROOF_CASES]` (a live check only reaches the lane if its row is in that list; the four rows a browser spec already presses are left out of my list so they keep that evidence) |
| `src/pulse/coverage/gap-catalog-display.test.mjs` | guard numbers: contracts and cases 40 to 66; pass-capable 27 to 54; always-red 13 to 12 (three places); unique queries 27 to 49 (two places); title 40 to 66 |
| `src/pulse/catalog/proofs/display-proof-cases.test.mjs` | red count 672 to 647 (23 contract rows, the held row and the cockpit row left red) |
| `src/pulse/catalog/generated.json` | recompiled with `node scripts/pulse/compile-catalog.mjs`; expect a conflict, take the integrator's compile |

Other display batches change the same guard numbers. Add the decreases together and use the number the tests print.
My part: contracts +26 (27 new, 1 replaced), always-red -1, unique queries +22, red count -25.

## Product findings (not fixed)

1. `api/closer-deck.mjs` has a role gate and no shift gate, and its pay-link and soft-pull texts call `composeAndSend` with no `shiftId`. A closer who has not clocked in can send them, and the `text_sent` event they leave has no shift. The staff-reply check leaves those two idempotency prefixes out on purpose.
2. The coverage map text for the messaging "Blocked result" says an opt-out raises a task. `gate.mjs` raises a task only for restricted wording; an opt-out clears on its own. The check judges what the code does.
3. The Social Studio 'Could not be sent' tab can never fill: the page reads `marketing_content_queue`, and failed posts live in `social_posts`. Confirmed again while reading `api/social/posts.mjs`.
4. 'Queue it' without an account only marks the queue row `queued` with a time. Nothing hands that row to the sender, so it is never published. The check only judges that such a row is internally consistent.
5. `netlify/functions/staff-message-sweeper.mjs` header says held texts go out at 11:00 Arizona. The dispatcher and gate use 08:00 (`QUIET_END_HOUR = 8`). The comment is stale, the code is right, and the check reads 08:00.
6. The chat widget's Ask and Knowledge modes save nothing, so nothing can tell whether a staff question was answered.
7. `s-00-welcome` welcomes a client once (a lock on the client file). A client created from the pipeline form who was welcomed earlier through another door gets no new welcome. That is by design; the check therefore asks whether the client was ever welcomed.

## Things I found while writing the queries (each one changed a query, so they are recorded)

- An authorized rep's sign-in account has no client id of its own (`accounts_subject_ck`), so the push-device check accepts that account kind. Without this it would have gone red for every rep.
- The closer deck's pay-link and soft-pull texts carry no shift (finding 1), so the shift rule skips them.
- A text held overnight, or retried by the sweeper, is sent outside the request and leaves no `text_sent` event, so the shift rule only judges texts sent on the first try with no schedule.
- The approvals workflow (f-04) says nothing unless `approvedAmount` is above zero, so the approved-column check only expects a text and email when the event carries an amount.
- Opted-out clients get no text from `sendTemplated`, so a missing text is only judged when the client is not opted out.

## Can each check fail? Done on purpose, then put back

- Every condition in every query (WHERE and FILTER, one at a time, 289 conditions across 22 queries) is dropped in a test and some fixture row must change its answer.
  The first run found about 90 conditions nothing proved; each was either removed as redundant or given a fixture. The sweep test now keeps it that way.
- Fixtures: 212 single breaks, 50 "looks odd but right" rows, 76 ignored rows, and every break again inside a second company that must never be counted.
- Cockpit test, product broken in `public/app/present.js` six ways (FUND line always shown, REPAIR shown to funding, EDU never shown, first name not filled, close wrap fixed to funding, line prefix not stripped): red each time, file restored with `git checkout`.
- Writers broken on purpose (each turned `fin-b04-display-results.test.mjs` red, then restored): a second `scheduled_at` writer, the round key format, the portal note status, the quiet-end hour, a new gate clearing code, the owner shift exemption widened, the welcome template key renamed.

## Commands run and results

Measured on this Mac while other builders ran the same group (load average 11 to 68). Nothing was pushed.

| Command | Result |
|---|---|
| `node scripts/pulse/count-not-proved.mjs` (before, on `fin/base`) | total 853 (routes 135, display 680, flow 23, reads 15); this batch 28 of 28 open |
| `node scripts/pulse/count-not-proved.mjs` (after) | total 825 (display 652); this batch 0 of 28 open |
| `node scripts/pulse/compile-catalog.mjs --check` | fresh (exit 0) |
| `node --test src/pulse/catalog/proofs/fin-b04-display-results.test.mjs` | 415 of 415 pass |
| `node --test src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs` | 5 of 5 pass, three runs in a row; red on each of 6 product breaks |
| Differential run against real Postgres schema (scratch, PGlite) | 382 variants, 0 differences |
| `node --test src/pulse/coverage/gap-catalog-display.test.mjs` | 11 of 11 pass (new guard numbers) |
| `node --test src/pulse/catalog/proofs/display-proof-cases.test.mjs` (all 3 tests, with the focused run of every named test) plus my two test files, `gap-catalog-display`, `compiler`, `display-recipes` | 454 of 454 pass |
| Catalog and lane group: `src/pulse/catalog/*.test.mjs`, `src/pulse/catalog/proofs/*.test.mjs`, `gap-catalog*`, `gap-door-batch*` (started before the last two edits) | 2,090 of 2,091 pass. The one failure is `flow-result-proofs` "every test named by a flow proof passes": its child run of `src/sales/closer-deck.test.mjs` was cut by the 120 second limit under load. That file alone: 27 of 27 pass. Not a file of this batch; the same load flake is in the earlier slice manifests. |
| `node --test src/pulse/na-conditions.test.mjs src/lib/no-unfenced-transmit.test.mjs src/pulse/coverage/modules.test.mjs src/pulse/tripwires.test.mjs src/pulse/self-audit.test.mjs` | 164 of 164 pass |
| `npm run lint` | 3,569 files parse clean |

Nothing in this batch sends a text, an email or a vendor call, and nothing writes to a database. The queries are SELECT only.

## Re-verified after the resume (2026-10-14, about 22:30 Arizona)

The branch was found intact after the Mac restart (HEAD `6a40e7328`, clean tree). Nothing in the product or the checks was changed.
Re-measured from a clean export of `fin/base` and from this branch with `scripts/pulse/count-not-proved.mjs`:

| | Open rows of this batch |
|---|---|
| `fin/base` (all lanes 853, display 680) | 28 of 28 |
| `fin/b04` (all lanes 825, display 652) | 0 of 28 |

Also run again:

- `node --test src/pulse/catalog/proofs/fin-b04-display-results.test.mjs`: 415 of 415 pass.
- `node --test src/pulse/catalog/proofs/fin-b04-present-cockpit.test.mjs`: 5 of 5 pass.
- `node --test src/pulse/coverage/gap-catalog-display.test.mjs`: 11 of 11 pass.
- `node scripts/pulse/compile-catalog.mjs --check`: fresh (exit 0).
- `display-proof-cases.test.mjs`, the two guard tests (every case names one exact row; red count 647): pass.
- One more break on purpose: the `status IS DISTINCT FROM 'received'` condition dropped from `PORTAL_MESSAGE_SQL` turned
  `portal-message: BAD when the status is not received` red (414 pass, 1 fail); restored with `git checkout`.
- The focused run of every named test in `display-proof-cases.test.mjs` (the third test in that file) was run once on a Mac at
  load average 60 to 100. All 415 query tests and all 5 cockpit tests of this batch passed inside it. The run as a whole
  failed on browser specs that are not this batch: `agent-editor-promote-demote` (wait for the saved "Escalate to" person),
  `display-contracts-ef-public` (browser closed after its 90 second limit), `bank-amount-suggestion` and `cc-tab-ideas`
  (30 second limits), and the slice-2 wrapper. These are the same load failures the slice manifests name.
