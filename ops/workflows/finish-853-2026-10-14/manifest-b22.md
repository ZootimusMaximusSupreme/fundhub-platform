# Batch 22 manifest (Flow lane, 23 rows)

Branch `fin/b22`, from `fin/base`. Generations 1, 2 and 3. Local only: not pushed, not merged.
Generation 3 is written at the bottom ("Generation 3"). The tables in between are kept current for it:
the outcome table below shows each row's FINAL outcome after generation 3.
Lane: `src/pulse/coverage/gap-catalog-flow.mjs`. Builder: Sonnet.

## The count

| | Start | After gen 1 | After gen 2 | After gen 3 |
|---|---|---|---|---|
| Rows of this batch that print NOT_PROVED | 23 | 11 | 8 | **1** |
| Flow lane NOT_PROVED, whole lane | 23 | 11 | 8 | **1** |
| All four lanes together (count script) | 853 | 841 | 838 | **831** |

Measured with `node scripts/pulse/count-not-proved.mjs` (offline, stub fetch, no database).
With no database the ten saved-result checks print `skip` with the words "no database in this run", and the two
page reads and the seven not-shipped reads print `skip` with "no GET client" when none is handed in. Never
NOT_PROVED. On the server they read real rows and the live page.

## Outcomes, row by row

Words used: **live check** = one read-only query over the saved rows the flow leaves behind, judged by the
Flow lane on the server (`sample_count` and `bad_count`, green until the first wrong result for the ones that
may be empty). **practice test** = a test with fake data that goes red when the product is wrong.
**not-attachable** = looked, and it cannot be done without a product change or a decision only Chris makes.

| # | Row id | Outcome | What judges it |
|---|---|---|---|
| 1 | `flow:agent:ai-caller:api/journeys/ask.mjs` | practice test | `src/http/fin-b22-journeys-ask.test.mjs`: the real handler, a stand-in for the model. Who may ask (all eight staff roles tried: owner and admin in, six out, none upstream), no login, GET, missing text, no key on the server, what goes upstream (the editor's two texts, the server's key, never a key from the browser), what comes back (text blocks only, the key never), model down and unreachable. 8 product breaks, all red. |
| 2 | `flow:message:dispatch:sms-duplicate-guard-NOT-WIRED` | live check | `SMS_DUPLICATE_SQL` in `fin-b22-flow-live.mjs`: automated texts that left in the last 14 days, and how many were the later send of the same template (or same words) to the same phone inside the guard's 30 minutes. Reads what customers got, because the guard itself is not wired. |
| 3 | `flow:message:job:staff-message-sweeper` | live check | `STAFF_REPLY_SQL`: staff-typed replies of the last 7 days that are still queued 30 minutes after they were due, stuck on sending, say they left with no provider id, or sat on sent a day with no receipt. |
| 4 | `flow:message:provider:web-push-and-client-push` | live check + practice test (gen 2) | `PUSH_DEVICE_SQL` in `fin-b22-flow-live.mjs`: every live notification device a client turned on (not retired, not turned off, not a test client) that has waited 7 days with no push ever tried, or that the push service failed 3 times or more and was never retired. Plus `src/push/fin-b22-send-to-client.test.mjs`: the real sender, store and provider over stand-ins (fan out to every device, each body decrypts only with its own device key, 404 and 410 retire a device in the same pass, 503 counts a failure and keeps the row, banned words never reach the network, no VAPID key sends nothing, no endpoint or key in the answer). 18 product breaks, all red. The last test pins who may call `sendToClient`: when a caller appears the file goes red and the caller needs its own trigger-to-device proof. |
| 5 | `flow:message:receipt:twilio-status-webhook` | live check + practice test | `TWILIO_RECEIPT_SQL`: texts the carrier took (provider id saved) that are still on sent after 24 hours. Plus `src/http/fin-b22-twilio-status.test.mjs`: the door through the router, signed and unsigned, every status word, the unmatched answer, and `TWILIO_AUTH_TOKEN` is on `LAUNCH_SECRETS` (the row's own finding is stale: it is). 8 product breaks, all red. |
| 6 | `flow:message:script:one-off senders in scripts/` | not-attachable | See below. |
| 7 | `flow:message:template-copy:seed-vs-live-drift` | live check | `TEMPLATE_ROWS_SQL` + `reduceSignOff`: every approved template that carries a sign-off record still hashes (subject, NUL, body) to `approved_body_sha`, the same hash `api/message-templates.mjs` writes. Catches the doc seeder, a SQL seed, or a hand edit changing words under a standing approval. It does not compare to the SQL seed text: an approved edit legitimately differs from its seed, and three writers (doc seeder, SQL seeds with `DO UPDATE` and `DO NOTHING`, the editor) make "the seed body" ambiguous. The sign-off hash is the owner-approved mechanism (migration 116). |
| 8 | `flow:message:template-copy:SQL-seeded-only-keys-not-in-doc-source` | live check | Same read + `reduceSqlOnlyKeys` over `fin-b22-sql-template-keys.json` (142 keys from the SQL seed and migration files that the doc source does not carry; 130 have a sender and are judged): each exists for this company, in its own channel, with real words (no `[DRAFT`, no lorem, no blank) and approved the way the seed approved it. The saved list is rebuilt from the SQL files by a test, so a new seed cannot slip past. A missing result is red here (no `emptyAs`). |
| 9 | `flow:message:ui:ops-admin outbound mail panel` | na-verified (gen 3) | `fin-b22-not-shipped.mjs` reads the live `/app/ops-admin.html` and the two scripts it loads (`shell.js`, `data.js`) every run: `na` only while none of `alert_email`, `alertEmail`, `alert-email`, "alert address", "alert email" is in them and the page still holds the Outbound Mail card. The three buttons are judged by their own screen rows (`e2e/ops-admin-outbound.spec.mjs`) and the server action by its own door row. The day an alert field is on the page the row is NOT_PROVED again. |
| 10 | `flow:message:owner-alert:owner_notifications queue (finance alerts)` | live check | `OWNER_QUEUE_SQL`: finance owner alerts (90 days) that waited over an hour in `owner_notifications` for a sender, or failed. Red as soon as one exists, because nothing sends them. |
| 11 | `flow:message:manual-proof:comms-map-2026-09-19 (template delivery proof)` | live check | `TEMPLATE_DELIVERY_SQL`: every client template sent in the last 30 days that has two or more rows older than a day and was never once delivered. The hand-run delivery proof, read again each morning from the messages really sent. |
| 12 | `flow:message:workflow:waypoint-nudge-sweeper` | live check | `WAYPOINT_NUDGE_SQL`: every rung spent in 14 days ended in its own message (one of the three named templates, same channel, same client, left the queue) or, at step 4, in the csm task from `waypoint-nudge`; none stuck on `claimed` over 15 minutes or on `template_pending`. |
| 13 | `flow:journey:journey:climate-lead-magnet-intended#1-headline-button` | na-verified (gen 3) | Live read of `/climate/` and `/climate/lender-climate/` and the 8 files they lead to: `na` only while neither "See how many banks in our book fit your state" nor "Get your number" is in them. |
| 14 | `flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map` | live check (gen 2), RED today | `fin-b22-page-reads.mjs` reads `GET /api/climate` (51 states) and the scripts the live `/climate/` page loads. Red because the page ships five state outlines (AZ, CA, NY, TX, FL), so 46 states have no shape on the map. Goes green the day the page holds all 51. Proved by `fin-b22-page-reads.test.mjs`. |
| 15 | `flow:journey:journey:climate-lead-magnet-intended#3-state-click` | na-verified (gen 3) | Same read: `na` only while "not a decision about you", "wider picture" and "Pick a state" are absent. |
| 16 | `flow:journey:journey:climate-lead-magnet-intended#4-form` | na-verified (gen 3) | Same read: `na` only while `climate-match`, `climate_match`, "Show my number" and `website:climate` are absent (no page calls the lead door). |
| 17 | `flow:journey:journey:climate-lead-magnet-intended#6-gate` | na-verified (gen 3) | Same read: `na` only while "Business Financial Assessment", "Get the full list", "more names are in the full list" and `/api/public/optimize` are absent. |
| 18 | `flow:journey:journey:fh-consulting-intended#2-education-only` | na-verified (gen 3) | Live read of `/consulting/` and the file it leads to: `na` only while "education for business operations", "education only" and "not a lender" are absent. |
| 19 | `flow:journey:journey:fh-consulting-intended#3-three-prices` | na-verified (gen 3) | Same read: `na` only while "$5,000", "$10,000" and the three program names are absent. |
| 20 | `flow:journey:journey:fh-consulting-intended#5-request-enrollment` | live check (gen 2), green today | `fin-b22-page-reads.mjs` reads the live `/consulting/` page: the form's submit opens an email to the same support address the page lists, no card field, no payment script, no form posting away, and the page says nothing is charged. Proved by `fin-b22-page-reads.test.mjs` (10 page breaks, all red). |
| 21 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#2-authorize-first` | practice test | `src/http/fin-b22-soft-pull-flow.test.mjs` (the real handler, stand-in database, signed link): the consent is written before any payment link is minted, in that order; a refused form or a failed consent write mints no link; the words come from the server. `src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs` (the real page in Chromium): no Pay button until the form is saved, the only action is submit, the page says authorize first, then pay. 16 product breaks, all red. |
| 22 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#5-pay-same-page` | practice test | Same two files: the answer carries one link for exactly $32 + $10 per saved company (0, 1, 2, 3, 6, 20 companies tried), an open link at the same total is reused, an open link at another total is expired, and the same page shows "Pay $X assessment" with the server's total and link (not a number the page worked out); a refusal stays on the form; no checkout shows the total to ask for. |
| 23 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files` | live check + practice test | `SOFT_PULL_BUSINESS_SQL`: every company saved on the soft-pull form has its client, name, street, a two-letter state, an EIN as `12-3456789`, and an age. Plus `src/pulse/catalog/proofs/fin-b22-soft-pull-staff.test.mjs`: the form's rows go through the real writer and the real staff read, then the Client Control Panel card and the pipeline drawer in Chromium show name, state, EIN, address, and the extra-owner warning only on the company that has one. |

Count after generation 3: 12 live checks (three of them also have practice tests), 3 practice tests,
7 na-verified (new in gen 3, each re-read from the live site every run), 1 not-attachable
(`script:one-off senders in scripts/`).

## Not attachable (exact reasons, challenged again in generation 2; generation 3 moved items 2, 3 and 4 to na-verified)

The text of items 2, 3 and 4 is kept because it is the fact base the generation 3 reads were built on. Only
item 1 is still open after generation 3.

1. **`script:one-off senders in scripts/`.** Three hand-run scripts with fixed ids: a resend to two named hires
   on 2026-08-25, a prove run for one test client, a test push. They run once, on a person's say-so. Two of them
   call a provider directly, so they write no `messages` row, and nothing else logs the send (the fence in
   `src/lib/outbound-fetch.mjs` keeps no table). There is no recurring result to read and no bundle file a verified
   "nothing to judge" could re-check at run time (the live bundle carries no `scripts/`).
2. **`ui:ops-admin outbound mail panel`.** The row names "an alert-address field on `public/app/ops-admin.html`".
   The page has none (searched `public/`, `e2e/`, `docs/journeys/`). It has three buttons (Send what is waiting,
   Pause/Resume sending, Email unsent invoices). Those three are already pressed to their result by
   `e2e/ops-admin-outbound.spec.mjs` (the row's evidence text says no such test exists; that is stale). The alert
   address can only be set by posting `alert_email` to `/api/messages-outbound`, and `src/messaging/outbox.mjs`
   even tells the owner "No alert address is set on the Outbound Mail panel" about a field that is not there. A row
   that names a control that is not on the page cannot be proved without saying the page has it.
3. **Climate rows #1, #3, #4, #6.** The shipped `/climate/` page is the lending-climate dashboard
   (`public/climate/index.html`, a Next.js export). The visitor page the journey describes was reverted by Chris
   the day it was built ("Revert Claude climate visitor page", `f39cec357`, 2026-09-18) and the Darwin dashboard
   shipped in its place; `docs/tracking/page-inventory.md` lists the lead page under "Dead or old pages: spec and
   mock only, not deployed". Measured again on the LIVE site on 2026-10-15 (public GET):
   - #1 no "fit your state" headline and no scroll button in the HTML or any script.
   - #3 a clicked state shows a two-letter code, a score and a band word. No name and no plain sentence.
   - #4 no four-answer form and no contact fields; `/api/public/climate-match` is called by no page.
   - #6 no gate and no $32 button (the string is in no script).
   A check can only say "absent". That would be a finding about a decided call, not a customer's wrong result,
   and the same fact already sits in `ops/workflows/proof-findings-2026-10-14.md` (S4). Chris decides: build the
   page from the mock in `marketing/landing-pages/climate-front-door-2026-09-18/`, or correct the journey.
4. **Consulting rows #2 and #3.** `docs/journeys/fh-consulting-intended.md` (2026-09-17) says education for
   business operations, "not a lender", and three posted prices ($5,000, $5,000, $10,000). Owner-directed commits
   of 2026-10-05 (`a9af08158`, `159a537a2`, `c66504716`) rewrote the page to marketing consulting for agencies:
   no posted price, no "education", no "not a lender" (it still says it does not promise a revenue number). A
   check of the old words is red for a call Chris already made; a check of the new words contradicts a file
   agents may not edit. Row #5 of the same journey is judged (see the table) because its words, "the form opens an
   email to the support address; it takes no card", are still true. Chris updates steps 2 and 3 of the journey.

## Files added

- `src/pulse/catalog/proofs/fin-b22-flow-live.mjs` — the ten saved-result checks, the judge, the runner
- `src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs` — runs each check's exact SQL over stand-in rows, 176 tests
- `src/pulse/catalog/proofs/fin-b22-page-reads.mjs` — (gen 2) the two live page reads and their judges
- `src/pulse/catalog/proofs/fin-b22-page-reads.test.mjs` — (gen 2) 30 tests: the real page files, changed copies, failed reads
- `src/push/fin-b22-send-to-client.test.mjs` — (gen 2) the client push sender over stand-ins, 17 tests
- `src/pulse/catalog/proofs/fin-b22-flow-contracts.mjs` — which rows left the gap monitor and what each rests on
- `src/pulse/catalog/proofs/fin-b22-sql-kit.mjs` — test kit: real column names, SQLite stand-in (tests only)
- `src/pulse/catalog/proofs/fin-b22-sql-template-keys.mjs` — build-time reader of the SQL seed files
- `src/pulse/catalog/proofs/fin-b22-sql-template-snapshot.mjs` — builds the saved key list
- `src/pulse/catalog/proofs/fin-b22-sql-template-keys.json` — the saved list (142 keys), kept fresh by a test
- `scripts/pulse/fin-b22-sql-template-keys.mjs` — rebuilds that list (`--write`)
- `src/http/fin-b22-journeys-ask.test.mjs`
- `src/http/fin-b22-twilio-status.test.mjs`
- `src/http/fin-b22-soft-pull-flow.test.mjs`
- `src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs`
- `src/pulse/catalog/proofs/fin-b22-soft-pull-staff.test.mjs`
- `src/pulse/catalog/proofs/fin-b22-not-shipped.mjs` — (gen 3) the seven "not on the live page" claims, the live
  reader (same reader as batch 06's `fin-b06-not-shipped.mjs`, copied so this branch stands alone), the judge, the
  row builder and the audit's question. Imports nothing, reads no repo file at run time.
- `src/pulse/catalog/proofs/fin-b22-not-shipped.test.mjs` — (gen 3) 36 tests: the real pages, every word and door
  of every step, every way of hiding a word, every kind of unread page, the audit's question
- `ops/workflows/finish-853-2026-10-14/manifest-b22.md` — this file

## Shared lines touched (smallest possible)

- `src/pulse/coverage/gap-catalog-flow.mjs`: two imports (gen 1 live runner, gen 2 page reads);
  `readInactiveCounts`, the live runner and the page reads run in one `Promise.all`; one line
  `const liveRow = live.get(rowId) || pages.get(rowId);` then `if (liveRow) return liveRow;` before the old
  static result.
- `src/pulse/catalog/proofs/flow-gap-cases.mjs`: one import; `isFinB22ProvedFlowRow` added to
  `needsMessageGapMonitor`, `needsJourneyGapMonitor`, `needsAgentGapMonitor`; `EXPECTED_FLOW_GAP_COUNTS`
  journey 11 to 9 and the `agent: 1` line removed (a family with no row left has no entry).
- `src/pulse/catalog/proofs/flow-result-proofs.mjs`: one import; `|| finB22FlowProof(sourceFile, row)` on the
  plug-in line.
- `src/pulse/catalog/proofs/flow-read-contracts.mjs`: one import; `!isFinB22LiveFlowRow(row)` in
  `CURRENT_FLOW_RED`.
- `src/pulse/coverage/gap-catalog-flow.test.mjs`: 183 to 180, NOT_PROVED 23 to 11 (gen 1) and then to 8 (gen 2),
  the "every active control" guard now names the 8 not-proved ids and the twelve judged ones; seven tests added
  (three in gen 1, four in gen 2: the page reads, the page reads going green and red, no GET client, web push).
- `src/pulse/catalog/proofs/flow-result-proofs.test.mjs`: the sample list of red rows, "11 leftovers" to 3,
  the journeys-proxy test, the soft-pull test (they are no longer text-only); two tests added in gen 1. Gen 2:
  the red cases no longer hold web push or climate #2, "3 leftovers" to 2, "8 message rows judged from saved
  results" to 9, two tests added (the two page-read proofs, the web push proof names the sender's test).
  Counts of rows with a proof (447 / 132 / 25) unchanged.
- `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: flow 23 to 11, total 38 to 26, unproved 37 to 25
  (gen 1); then flow 8, total 23, unproved 22 (gen 2).
- `src/pulse/catalog/proofs/fin-b22-flow-contracts.mjs` (my own file): three entries added to
  `FIN_B22_LIVE_PROOFS` in gen 2 (web push, climate #2, consulting #5).
- `src/pulse/catalog/generated.json`: recompiled with `npm run pulse:catalog`. Expect a conflict after merging
  other branches; recompile.
- (gen 3) `src/pulse/na-conditions.mjs`: ONE new code, `catalog-flow-step-not-shipped` (19 lines with its comment),
  inserted just before the `no-sender` code. `verify: "lane"`; the Flow lane answers.
- (gen 3) `src/pulse/na-conditions.test.mjs`: the closed list "fourteen" to "fifteen" and the new code on the
  alphabetical list; the lane-code list names it ("nine" to "ten"); one line in the sample-args table.
  Batch 06 adds a code on the same lines, so expect a conflict here; both codes stay.
- (gen 3) `src/pulse/coverage/gap-catalog-flow.mjs`: one import line; the `Promise.all` gains
  `runFinB22NotShipped(ctx)`; the lookup line becomes `live.get(rowId) || pages.get(rowId) || shipped.get(rowId)`;
  `naVerify` gains `[NOT_SHIPPED_CODE]: (args, ctx = {}) => verifyNotShipped(args, ctx)`.
- (gen 3) `src/pulse/catalog/proofs/fin-b22-flow-contracts.mjs` (my own file): seven entries with `shipped: true`
  in `FIN_B22_LIVE_PROOFS`; `finB22FlowProof` gives a shipped row an evidence line that says "verified
  nothing-to-judge". `asserts` stays the map row's own words (`flow-recipes.test.mjs` holds that).
- (gen 3) `src/pulse/coverage/gap-catalog-flow.test.mjs`: the batch test names seven more rows; the "every
  active control" guard: seven shipped rows are `skip` with "no GET client" there, NOT_PROVED 8 to 1; three tests
  added (the real pages, the audit's check on the lane, an unreadable site).
- (gen 3) `src/pulse/catalog/proofs/flow-result-proofs.test.mjs`: the red cases lose the six journey rows and
  the ops-admin row ("2 leftovers" to "1"), the saved-result test skips shipped rows, one test added.
- (gen 3) `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: flow 8 to 1, total 23 to 16, unproved 22 to 15.

No product file changed. No migration. No `modules.mjs` change (nothing new in `src/pulse/coverage/`).

## Product findings (not fixed)

1. `api/soft-pull-approve.mjs` ends `return dbDown(res, err)`. `dbDown` returns false for an error that is not a
   lost connection and writes no answer. So a refused consent write (a constraint, say) leaves the request
   unanswered: no 201, no error body. No link is minted, which is right, but the client's page hangs.
2. `src/messaging/sms-dedup.mjs` is imported by nothing (known). Also, when wired, it only matches rows with
   `status = 'sent'`, so a first text already moved to `delivered` is invisible to it.
3. The shipped `/climate/` map draws 5 of 51 states. The five outlines are plain boxes
   (`"AZ":"M120,200 L200,200 L200,260 L120,260 Z"`), so the "map" is a placeholder, not a map of the United
   States. The new page read (climate #2) is red on this today.
4. `/climate/` state click shows a code, not a name, and no sentence.
5. The climate lead page and `/api/public/climate-match` have no page in front of them.
6. The consulting page and its intended journey disagree (see above).
7. `owner_notifications` rows are written for finance alerts and nothing sends them (known). The new live check
   will be red on the first morning there is one older than an hour.
8. The catalog row for the Twilio status door says `TWILIO_AUTH_TOKEN` is not on `LAUNCH_SECRETS`. It is
   (`gap-keys.mjs`, "inbound texts and text delivery receipts"). The map text is stale.
9. `web-push`: the catalog says no caller "anywhere in src/api/netlify/scripts". One script
   (`scripts/push/send-test-push.mjs`) does call it. Nothing in the app does.
10. A rung of the waypoint ladder with an unapproved template ends `template_pending` and the rung is spent
    for good (by design: a step is spent once). Until the three templates are approved in the editor, a stalled
    client gets neither message. The new check counts each as wrong, so it will be red until they are approved.
11. (gen 2) `src/push/send.mjs`: a notification the lock-screen gate refuses (a body with a dollar amount, an
    unknown kind, an off-site tap target) is counted as a failure of the phone (`markFailure`). Three such
    refusals to one client make that phone look "failing" to the new check, though the phone is fine.
12. (gen 2) The client portal offers "Turn on notifications" when the server holds the VAPID and storage keys
    (`public/app/client-portal.html`, push card), and nothing ever sends to that device. A client who turns it on
    waits. `docs/journeys/push-flow.md` says so ("Nothing sends a notification today"). The new check goes red
    for a device that has waited 7 days.
13. (gen 2) `src/messaging/outbox.mjs` `alertOnFailures` writes "No alert address is set on the Outbound Mail
    panel" into the owner's task, about a field that is not on that panel.
14. (gen 2) The catalog text for `ui:ops-admin outbound mail panel` says no test presses the three buttons.
    `e2e/ops-admin-outbound.spec.mjs` does. Map text is stale.
15. (gen 2) The consulting button reads "Email this request"; the journey step is "Request enrollment".

16. (gen 3) `scripts/create-csm-staff.mjs --mail <address>` emails a credential link through
    `sendStaffCredentialEmail` (the Resend provider). It is not in the row's list of one-off senders
    (`resend-employee-contracts-2026-08-25`, `prove-soft-pull-live`, `send-test-push`).
17. (gen 3) `scripts/prove-soft-pull-live.mjs` has no flag at all: running it mints a $32 checkout link and a
    soft-pull approval link for one fixed client and emails them straight through the Resend provider, past the
    gate, the opt-out and the unsubscribe footer. `scripts/resend-employee-contracts-2026-08-25.mjs` sends a test
    contract to the prove inbox even without `--send`. Both are single-use scripts that already ran.
18. (gen 3) The seven journey and panel steps in the third table above name things the live site does not have.
    That is the intended journeys and one map row being out of date (or the site missing a build), not a
    customer's wrong result. The reads keep it visible: each flips back to NOT_PROVED the day the site carries
    the step.

## Product breaks made on purpose (each went red, each restored)

Done in a second, throw-away worktree of this branch, one break at a time, `git checkout` after each; this
branch's own files were never touched. 47 breaks, 47 went red, 0 stayed green, 0 did not apply:

| Test file | Breaks | What was broken |
|---|---|---|
| `fin-b22-journeys-ask.test.mjs` | 8 | role gate widened to five more roles; the 400 check off; a key taken from the request body; the key sent back; an upstream failure answered as ok; every block returned, not only text; a fixed wrong key header; the 503 check off |
| `fin-b22-twilio-status.test.mjs` | 8 | signature check off; `undelivered` mapped to delivered; text-only guard off; outbound-only guard off; "unmatched" said as ok; `sending` moves a row; `TWILIO_AUTH_TOKEN` off the launch list; carrier error not cut |
| `fin-b22-soft-pull-flow.test.mjs` | 9 | a payment link minted before the consent; a stale link not expired; the $10 add-on changed; typed-name check off; the link ignoring the companies; SSN check off; consent words taken from the browser; companies not saved; the signed-link check off |
| `fin-b22-soft-pull-page.test.mjs` | 7 | Pay total taken from the page, not the server; a Pay button before submit; a refusal shown as saved; the "authorize first, then pay" words gone; a dead Pay link; the ask-for-the-link sentence gone; the button left disabled after a refusal |
| `fin-b22-soft-pull-staff.test.mjs` | 8 | the extra-owner flag dropped in the staff read; EIN dropped in the staff read; the state not saved by the writer; EIN missing on the control panel card; the warning missing on the card; EIN missing in the drawer; the warning missing in the drawer; the address missing in the drawer |
| `fin-b22-flow-live.test.mjs` and `gap-catalog-flow.test.mjs` | 7 | the judge never red; a different sign-off hash; placeholder copy ignored; a failed read turned into green; the nudge workflow name changed; the lane ignoring the live result; the live read run for no company |

Generation 2, same method (one break at a time, `git checkout` after each, mutation script outside the repo):

| Test file | Breaks | What was broken |
|---|---|---|
| `src/push/fin-b22-send-to-client.test.mjs` | 18, all red | a gone device not retired; 404 no longer gone; only the first device sent to; a failure stamped as a success; retired devices sent to again; turned-off devices sent to; another client's devices sent to; the body sent in the clear; the lock-screen gate skipped; the no-device answer losing its reason; a success not clearing failures; a failure erasing the last success; the retired stamp also marking turned-off; no VAPID signature header; TTL dropped; an endpoint returned in the answer; a bad row throwing instead of being skipped; a new caller of the sender appearing |
| `fin-b22-page-reads.test.mjs` | 23, all red in the end | outlines ignored; a code that is not a state counted; a short list from the data door passing; a data door that says not ok passing; a page with no scripts passing; other sites' scripts fetched; framework files fetched; the map file counted when the page never loads it; a failed read as a pass; any HTTP status accepted; the real site called with no client handed in; the card-field, payment-script, form-posts-away, listed-address, no-charge-sentence, submit-opens-an-email and missing-form checks each switched off; a thrown judge not caught; the per-read and whole-run time limits ignored. Three stayed green on the first run (the not-ok door with all 51 states present, another site's script under the same path, the whole-run limit); each got a test and went red |
| `fin-b22-flow-live.test.mjs` (web push query) | 8 pieces of SQL | each condition taken out of `PUSH_DEVICE_SQL` changes the answer for some stand-in set (the "dropping any one condition" test) |
| `gap-catalog-flow.test.mjs` and `fin-b22-flow-live.test.mjs` | 6, all red | the lane ignoring the page reads; the lane handing the page reads no client; the lane ignoring the saved-result checks; the web push proof entry dropped; the push wait set to 0 days; the push failure limit moved to 10 |

On top of those, each of the nine saved-result queries was broken condition by condition: the test
`dropping any one condition changes the answer for some stand-in set` takes each piece of the SQL text out
(70 pieces in all, from 1 to 16 per query) and fails if no stand-in row set notices. It found eight weak spots in my first draft: three conditions another condition already covered, which I
removed (`m.id IS NULL`, `t.id IS NULL`, `p.id <> a.id`), and five that had no stand-in row set to flip them
(the text-only guard and the email twin, the no-receipt rule needing an old delivered row, the inbound filter,
a template that is named nowhere, another company's copy of a template), for which I added the case.

## Numbers and commands

- `node scripts/pulse/count-not-proved.mjs`: before 853 total, 23 of this batch; after gen 1 841 total, 11 of this
  batch; after gen 2 **838** total (door 135, display 680, flow 8, reads 15), 8 of this batch.
- `npm run pulse:catalog`, then `node scripts/pulse/compile-catalog.mjs --check`: fresh. 3919 wired, 23 red
  (the same 23 as base: those are other lanes). Rows with an explicit red verdict: 850 to 838.
- My seven test files together (`node --test`): 215 tests, 215 pass, 0 fail, run twice (6 to 8 seconds).
- `src/pulse/catalog/*.test.mjs` with `gap-catalog-flow`, `gap-catalog-reads`, `modules`, `tripwires` tests:
  all pass.
- `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: 2 of 2 (12 real pages).
- `src/pulse/catalog/proofs/flow-result-proofs.test.mjs`: 9 of 10 pass. The tenth, "every test named by a flow
  proof passes", ran every named test file and reported ONE failure: `src/sales/closer-deck.test.mjs`
  (all its tests printed ok; the child was killed under a machine load average of 60 to 80). The same file was
  recorded as killed under load in the S1 and S4 manifests. Every file this batch named passed inside it.
- `npm run lint`: 3,574 files parse clean.
- `node scripts/pulse/fin-b22-sql-template-keys.mjs`: fresh (142 keys).
- Gen 2, final run: my nine test files and `flow-read-contracts.test.mjs` together (`node --test`): 284 tests,
  284 pass, 0 fail (`fin-b22-journeys-ask`, `-twilio-status`, `-soft-pull-flow`, `-soft-pull-page`,
  `-soft-pull-staff`, `-flow-live` 176, `-page-reads` 30, `-send-to-client` 17, `gap-catalog-flow` 17).
- Gen 2: `src/pulse/catalog/*.test.mjs` with `modules`, `tripwires` and `gap-catalog-reads` tests: 56 of 56 pass.
  `flow-read-contracts.test.mjs` 2 of 2. `flow-result-proofs.test.mjs` 11 of 11 plus the long "every test named
  by a flow proof passes" case on its own (it ran out its 240 s limit twice while the machine load average was
  130 to 240, and passed in 42 s at load 35; it names `fin-b22-send-to-client` and `fin-b22-page-reads`).
  `node scripts/pulse/compile-catalog.mjs --check`: fresh (3919 wired, 23 red, same as base).
  `npm run lint`: 3,577 files parse clean.
- Gen 2: the live public site was read with plain GETs (`/api/climate`, `/climate/`, its scripts,
  `/climate/maps/us-states-paths.json`, `/consulting/`). The repo's `public/` files are byte for byte what the
  site serves for the pages and map file read.
- Not run: `npm run pulse:prove` (reads the live database; the brief forbids production reads from here) and any
  `.pg.test.mjs` (no local Postgres). The SQL is checked against the real column names from `db/` and run in
  SQLite over stand-in rows; it uses only `FILTER`, `EXISTS`, `COALESCE`, `NULLIF`, `BTRIM`, `->>`, `!~*` and
  `IS DISTINCT FROM`, each of which another Postgres lane in this repo already runs.

## Left for the next generation

- The 8 not-attachable rows above. Each needs a product change or a decision from Chris first.
- A look at whether the ten saved-result checks and the two page reads should also get a heartbeat-style beat
  (`src/pulse/beats/`). They are morning-lane checks, not hourly; I did not add beats.

## Generation 1 resume check (2026-10-14, evening)

The agent resumed on this branch after an interruption and re-measured instead of trusting the notes above.

- `node scripts/pulse/count-not-proved.mjs`: 841 total (door 135, display 680, flow 11, reads 15). The 11 left in
  this batch are exactly the 11 not-attachable rows. The 12 attached rows no longer print NOT_PROVED.
- The not-attachable reasons were re-checked against the LIVE site, not only the repo (public GET, no login):
  - `https://fundhub.ai/climate/` is titled "Lending Climate Dashboard". Its HTML and its script bundle hold no
    "fit your state" headline, no `climate-match` call and no "Business Financial Assessment". So climate rows
    #1, #2, #3, #4, #6 name a page that is not on the live site.
  - `https://fundhub.ai/consulting/` says "Marketing consulting for agencies". It holds no "$5,000", no
    "$10,000", no "education" and no `support@fundhub.ai`. So consulting rows #2, #3, #5 name words that are not
    on the live page.
  - `sendToClient` has no caller in `src/`, `api/`, `netlify/` or `public/`. Callers are one hand-run script and
    one database-only test.
  - `public/app/ops-admin.html` has no alert-address field (the only `alert_email` writer is
    `api/messages-outbound.mjs`, action `settings`).
- Correction to "Not attachable" item 1: the sender does have a test, `src/http/push-endpoints.pg.test.mjs`, but
  it needs a database and nothing calls the sender, so the reason stands.
- Re-run: the 209 tests of the flow lane, journeys proxy, Twilio status door, soft-pull handler and live-check
  files pass; the 18 tests of the two soft-pull page files and the flow-result proofs pass; the catalog is fresh
  (`compile-catalog.mjs --check`); the SQL template key list is fresh.

## Generation 2 (2026-10-14 night to 2026-10-15)

A fresh Sonnet builder continued on this branch with one job: challenge every "not attachable" reason of
generation 1 by reading the real page or handler, and attach a live check or practice test unless the reason is
exactly true. Result: 11 rows in, 3 attached, 8 stay open with sharper reasons. Rows moved: 11 to 8 of this batch,
841 to 838 overall.

| Row | Gen 1 said | Gen 2 found | Outcome |
|---|---|---|---|
| web push (`provider:web-push-and-client-push`) | no caller, so no result exists to read | The sender leaves its result on the device row (`last_success_at`, `failure_count`, `expired_at`), and a client can turn a device on in the portal. That is a saved result. The sender, store and provider were never run by any test that runs without a database. | live check + practice test + caller pin |
| climate #2 reading and map | the visitor page is not deployed | The step names a number and a map from `GET /api/climate`, and the live `/climate/` dashboard has exactly that. It can be read, and it is wrong (5 of 51 outlines). | live check, red today |
| consulting #5 request enrollment | the journey names an address the page does not use | The row's own words are "the form opens an email to the support address; it takes no card". It names no address. Those words are true on the live page. | live check, green today |
| climate #1, #3, #4, #6 | page not deployed | Re-read live: still true. Same fact as `proof-findings-2026-10-14.md` (S4). | not attachable |
| consulting #2, #3 | owner rewrite vs stale journey | Re-read live: still true. | not attachable |
| one-off senders | no recurring result | Re-read: no log table, two scripts bypass `messages`, no bundle file to verify against. | not attachable |
| ops-admin outbound panel | the alert field is not on the page | Re-read: still not on any page. Found that `e2e/ops-admin-outbound.spec.mjs` already presses the three buttons (the catalog's evidence text is stale). | not attachable |

### What each new check says, and what it does not

- **Web push devices (live check, `PUSH_DEVICE_SQL`).** Red when a device a real client turned on has waited more
  than 7 days with no push ever tried, or has failed 3 times or more and is still on file. Green and quiet with
  no devices. It does not prove that a push reached a phone (nothing records that beyond `last_success_at`).
  When someone wires a caller for `sendToClient`, the waiting rule must be revisited (a client with nothing to
  be told legitimately has no push for a week). The caller pin in the practice test makes that happen.
- **Web push sender (practice test).** Real sender, real store, real provider and real crypto. A stand-in database,
  a stand-in push service, fresh browser keys. Each body the sender posted is decrypted with the device's own key
  and read as the device would read it. It does not prove that Apple, Google or Mozilla accept the request.
- **Climate reading (live page read).** Reads the data door and the scripts the page loads. It judges "the data door
  sends a good reading with 51 states" and "the page holds an outline for each of them". It does not render the
  page, so it does not judge that the painted number equals `national.score` or that each fill equals the colour
  the door sent (batch 23's `fin-b23-climate-map.test.mjs` covers the painted number and finds that the page
  ignores the door's colour).
- **Consulting request (live page read).** Reads the page's own HTML and script. It does not click the form or open
  a mail program. It judges what the page does on submit and what it asks for.

### Decisions only Chris can make (unchanged, now exact)

1. **Climate lead page.** Build it from `marketing/landing-pages/climate-front-door-2026-09-18/` (rows #1, #3, #4,
   #6 then get a check), or correct `docs/journeys/climate-lead-magnet-intended.md` to describe the dashboard.
   Either way the map needs 51 real state outlines (row #2 is red until it has them).
2. **Consulting journey.** Update steps 2 and 3 of `docs/journeys/fh-consulting-intended.md` to the page as
   rewritten on 2026-10-05, or put education wording and prices back. Proposed wording from the live page:
   step 2 "Read that this is marketing consulting for agencies: not legal, tax or investment advice, no promise of
   revenue"; step 3 "Prices are on the proposal and at checkout; the page posts none". Agents may not edit that file.
3. **Ops admin panel.** Add the alert-address field the row and the owner's own alert text name, or correct
   the row and the alert text.

## Generation 3 (2026-10-15)

A fresh Sonnet builder continued on this branch with the same job as generation 2: challenge every remaining
"not attachable" reason against the real page or handler. Result: 8 rows in, 7 attached, 1 stays open with an exact
reason. Rows moved: 8 to 1 of this batch, 838 to 831 overall.

### What was challenged and what was found

| Row | Gen 2 said | Gen 3 found | Outcome |
|---|---|---|---|
| climate #1, #3, #4, #6 | the page is not deployed, a check can only say "absent" | "Only say absent" is exactly what a verified nothing-to-judge is. The step names a headline, a state card, a form and a gate that the owner took off the live site on 2026-09-18 (`f39cec357`). Batch 06 already handles the same page's screen controls this way. The honest answer is `na`, re-read from the live site every run, flipping to NOT_PROVED the day the site carries the step. | na-verified |
| consulting #2, #3 | owner rewrite vs stale journey | The same read. The words and prices are not on the page the owner rewrote on 2026-10-05. The journey is a file agents may not edit, and the owner's call is final, so the row is "nothing to judge today", not a red for a decided call. | na-verified |
| ops-admin outbound mail panel | the alert field is not on the page | The page has the three buttons and no alert field (git history shows it never had one). Every button is judged by its own screen row, and the server action by its own door row. The one thing the row names that nothing judges is the field, and it is not there: a verified "not on the live page". | na-verified |
| one-off senders in scripts/ | no recurring result | Scanned `scripts/` for anything that can reach a person (a provider import, `sendTemplated`, a contract send, a vendor send address): 8 files match, and 4 can really transmit: the three the row names plus `create-csm-staff.mjs --mail` (not on the row's list). The other four only name a sender in a comment. Two of the four send through a provider directly and write no `messages` row, one sends through the contracts module, one needs `--send`. Nothing in the database or on the site shows whether or when any of them ran. A "nothing to judge" has to be re-checked at run time, and the live bundle carries no `scripts/` file; a build-time scan would be a guard on the folder, not a result check. | not-attachable |

### How the new read works (what it can and cannot see)

- One GET of the page (redirects not followed), then every same-site file it leads to: script tags (a bare
  `src="data.js"` is resolved against the page), preloads, frames, dynamic and static imports, workers, and, for
  the climate pages, any script or page path named in a string and a webpack chunk map. Up to 40 files, 8 seconds,
  GET only. The ops-admin read follows only files the page really loads (its shell script names every other app
  page in a string; a word on another page says nothing about this panel).
- Words are searched after tags, entities, escapes, `"a" + "b"`, `.concat`, `.join`, `atob` and `fromCharCode`
  are undone. Case and spacing do not matter.
- An anchor must be on EVERY page the claim names, or the read is a skip (a login page that answers 200 is not
  "the page has no such field"). Anchors: `/api/climate` (climate), "consult" (consulting), the Outbound Mail
  card id (ops-admin).
- It cannot see words built at run time from pieces that are not literals in any file. The lead form's SAVED
  result is judged separately by batch 06's `climate-lead-saved` live check, so a form that works shows up there.
- Offline (the count script) the stub page is empty, so the rows print `skip` there. Served the real `public/`
  files they print `na`.

### Decisions only Chris can make (unchanged in content, now they cannot be lost)

1. **Climate lead page.** Build it from `marketing/landing-pages/climate-front-door-2026-09-18/` (rows #1, #3, #4,
   #6 flip to NOT_PROVED by themselves the day the site carries it, then get a real check), or correct
   `docs/journeys/climate-lead-magnet-intended.md` to describe the dashboard (the four rows then disappear).
2. **Consulting journey.** Update steps 2 and 3 of `docs/journeys/fh-consulting-intended.md` to the page as
   rewritten on 2026-10-05, or put education wording and prices back (the two rows flip by themselves).
3. **Ops admin panel.** Add the alert-address field the row and the owner's own alert text
   (`src/messaging/outbox.mjs`) name, or correct the row and the alert text.
4. **One-off scripts.** Retire the two single-use scripts that already ran, or put a `--send` fence and a
   `messages` row in `prove-soft-pull-live.mjs`. Until then the row stays open.

### Product breaks made on purpose (gen 3)

One edit at a time to the module or the lane, the named test files run, the edit put back. 23 breaks, 23 red
(3 stayed green on the first run: a dynamic import and a frame that were also named in a string, and a consulting
price word that another word on the same step also matched. Each got a sharper test and went red).

| What was broken | Red |
|---|---|
| the judge ignoring found words | 21 tests |
| anchors not required; anchors taken from the union of pages; a page answering 404 read as a page; a page that is not HTML accepted; the file cap off | 1 to 2 tests each |
| unread counted as absent | 11 tests |
| a tag's bare relative `src` not resolved against the page; the ops-admin read following guessed pages | 1 and 4 tests |
| entities, concatenation not undone; a dynamic import not followed; a frame not followed | 1 test each |
| the audit's question always true; the audit ignoring the family | 3 and 1 tests |
| the lane ignoring the result; the lane handing the reads no client; the audit hook missing from the lane; the N/A code missing | 4, 2, 1, 2 tests |
| a word dropped from the gate, the alert field, the consulting prices | 2 tests each |
| the flow proof dropping a shipped row | 3 tests |

### Numbers and commands (gen 3)

- `node scripts/pulse/count-not-proved.mjs`: before **838** total (door 135, display 680, flow 8, reads 15), 8 of
  this batch; after **831** (door 135, display 680, flow 1, reads 15), 1 of this batch
  (`flow:message:script:one-off senders in scripts/`).
- `npm run pulse:catalog`: 3919 wired, 23 red (the same 23 as base, other lanes). `compile-catalog.mjs --check`:
  fresh. Rows with an explicit red verdict: 838 to 828 in `generated.json` (7 here, plus 3 counted by the catalog
  that the count script does not print).
- The live read, from this Mac with plain public GETs against `https://fundhub.ai` (15 GETs, 2 seconds): all seven
  rows `na`, and the audit's question true with the global GET client. The repo's `public/` files are byte for
  byte what the site serves for the pages read (`/app/ops-admin.html` 66,745 bytes both).
- `src/pulse/catalog/proofs/fin-b22-not-shipped.test.mjs`: 36 of 36.
- `src/pulse/*.test.mjs`, `src/pulse/catalog/*.test.mjs`, `src/pulse/coverage/*.test.mjs` with the b22 test files:
  all pass (2,627 tests in the last coverage run, 200 skipped: the `.pg.test.mjs` files, no database).
  `flow-result-proofs.test.mjs` 13 of 13 including "every test named by a flow proof passes", which now runs the
  new test file too.
- `npm run lint`: 3,579 files parse clean.
- Not run: `npm run pulse:prove` (reads the live database; forbidden from here) and any `.pg.test.mjs`.
