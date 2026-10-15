# Batch 22 manifest (Flow lane, 23 rows)

Branch `fin/b22`, from `fin/base`. Generation 1. Local only: not pushed, not merged.
Lane: `src/pulse/coverage/gap-catalog-flow.mjs`. Builder: Sonnet.

## The count

| | Before | After |
|---|---|---|
| Rows of this batch that print NOT_PROVED | 23 | 11 |
| Flow lane NOT_PROVED, whole lane | 23 | 11 |
| All four lanes together (count script) | 853 | 841 |

Measured with `node scripts/pulse/count-not-proved.mjs` (offline, stub fetch, no database).
With no database the nine saved-result checks print `skip` with the words "no database in this run",
never NOT_PROVED. On the server they read real rows.

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
| 4 | `flow:message:provider:web-push-and-client-push` | not-attachable | See "Not attachable" below. |
| 5 | `flow:message:receipt:twilio-status-webhook` | live check + practice test | `TWILIO_RECEIPT_SQL`: texts the carrier took (provider id saved) that are still on sent after 24 hours. Plus `src/http/fin-b22-twilio-status.test.mjs`: the door through the router, signed and unsigned, every status word, the unmatched answer, and `TWILIO_AUTH_TOKEN` is on `LAUNCH_SECRETS` (the row's own finding is stale: it is). 8 product breaks, all red. |
| 6 | `flow:message:script:one-off senders in scripts/` | not-attachable | See below. |
| 7 | `flow:message:template-copy:seed-vs-live-drift` | live check | `TEMPLATE_ROWS_SQL` + `reduceSignOff`: every approved template that carries a sign-off record still hashes (subject, NUL, body) to `approved_body_sha`, the same hash `api/message-templates.mjs` writes. Catches the doc seeder, a SQL seed, or a hand edit changing words under a standing approval. It does not compare to the SQL seed text: an approved edit legitimately differs from its seed, and three writers (doc seeder, SQL seeds with `DO UPDATE` and `DO NOTHING`, the editor) make "the seed body" ambiguous. The sign-off hash is the owner-approved mechanism (migration 116). |
| 8 | `flow:message:template-copy:SQL-seeded-only-keys-not-in-doc-source` | live check | Same read + `reduceSqlOnlyKeys` over `fin-b22-sql-template-keys.json` (142 keys from the SQL seed and migration files that the doc source does not carry; 130 have a sender and are judged): each exists for this company, in its own channel, with real words (no `[DRAFT`, no lorem, no blank) and approved the way the seed approved it. The saved list is rebuilt from the SQL files by a test, so a new seed cannot slip past. A missing result is red here (no `emptyAs`). |
| 9 | `flow:message:ui:ops-admin outbound mail panel` | not-attachable | See below. |
| 10 | `flow:message:owner-alert:owner_notifications queue (finance alerts)` | live check | `OWNER_QUEUE_SQL`: finance owner alerts (90 days) that waited over an hour in `owner_notifications` for a sender, or failed. Red as soon as one exists, because nothing sends them. |
| 11 | `flow:message:manual-proof:comms-map-2026-09-19 (template delivery proof)` | live check | `TEMPLATE_DELIVERY_SQL`: every client template sent in the last 30 days that has two or more rows older than a day and was never once delivered. The hand-run delivery proof, read again each morning from the messages really sent. |
| 12 | `flow:message:workflow:waypoint-nudge-sweeper` | live check | `WAYPOINT_NUDGE_SQL`: every rung spent in 14 days ended in its own message (one of the three named templates, same channel, same client, left the queue) or, at step 4, in the csm task from `waypoint-nudge`; none stuck on `claimed` over 15 minutes or on `template_pending`. |
| 13 | `flow:journey:journey:climate-lead-magnet-intended#1-headline-button` | not-attachable | See below. |
| 14 | `flow:journey:journey:climate-lead-magnet-intended#2-reading-and-map` | not-attachable | See below. |
| 15 | `flow:journey:journey:climate-lead-magnet-intended#3-state-click` | not-attachable | See below. |
| 16 | `flow:journey:journey:climate-lead-magnet-intended#4-form` | not-attachable | See below. |
| 17 | `flow:journey:journey:climate-lead-magnet-intended#6-gate` | not-attachable | See below. |
| 18 | `flow:journey:journey:fh-consulting-intended#2-education-only` | not-attachable | See below. |
| 19 | `flow:journey:journey:fh-consulting-intended#3-three-prices` | not-attachable | See below. |
| 20 | `flow:journey:journey:fh-consulting-intended#5-request-enrollment` | not-attachable | See below. |
| 21 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#2-authorize-first` | practice test | `src/http/fin-b22-soft-pull-flow.test.mjs` (the real handler, stand-in database, signed link): the consent is written before any payment link is minted, in that order; a refused form or a failed consent write mints no link; the words come from the server. `src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs` (the real page in Chromium): no Pay button until the form is saved, the only action is submit, the page says authorize first, then pay. 16 product breaks, all red. |
| 22 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#5-pay-same-page` | practice test | Same two files: the answer carries one link for exactly $32 + $10 per saved company (0, 1, 2, 3, 6, 20 companies tried), an open link at the same total is reused, an open link at another total is expired, and the same page shows "Pay $X assessment" with the server's total and link (not a number the page worked out); a refusal stays on the form; no checkout shows the total to ask for. |
| 23 | `flow:journey:journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files` | live check + practice test | `SOFT_PULL_BUSINESS_SQL`: every company saved on the soft-pull form has its client, name, street, a two-letter state, an EIN as `12-3456789`, and an age. Plus `src/pulse/catalog/proofs/fin-b22-soft-pull-staff.test.mjs`: the form's rows go through the real writer and the real staff read, then the Client Control Panel card and the pipeline drawer in Chromium show name, state, EIN, address, and the extra-owner warning only on the company that has one. |

Count: 9 live checks (two of them also have practice tests), 3 practice tests, 11 not-attachable.
No row is na-verified.

## Not attachable (exact reasons)

1. **`provider:web-push-and-client-push`.** Nothing in `src/`, `api/` or `netlify/` calls `sendToClient`. The only
   caller is the hand-run script `scripts/push/send-test-push.mjs`. So no client push is ever sent and no result
   exists to read (there is no push log table). The sender (`src/push/send.mjs`) is tested only in
   `src/http/push-endpoints.pg.test.mjs`, which needs a database and skips here. A test of a function nothing
   calls would not judge a customer's result. The day a caller exists the
   row can be judged. `src/pulse/tripwires.mjs` already files this surface as dead.
2. **`script:one-off senders in scripts/`.** Three hand-run scripts with fixed ids: a resend to two named hires
   on 2026-08-25, a prove run for one test client, a test push. They run once, on a person's say-so. Two of them
   call a provider directly, so they write no `messages` row. There is no recurring result to read.
3. **`ui:ops-admin outbound mail panel`.** The row names "an alert-address field on `public/app/ops-admin.html`".
   The page has no such field. It has three buttons (Send what is waiting, Pause/Resume sending, Email unsent
   invoices), and each already has its own display row. The alert address can only be set by posting `alert_email`
   to `/api/messages-outbound`. A row that names a control that is not on the page cannot be judged.
4. **Climate rows #1, #2, #3, #4, #6.** The shipped `/climate/` page is the lending-climate dashboard
   (`public/climate/index.html`, a Next.js export). The visitor page the journey describes was reverted
   ("Revert Claude climate visitor page", commit `f39cec357`); `docs/tracking/page-inventory.md` says "Spec and
   mock only. Not deployed." Measured in the page's own files and in Chromium:
   - #1 no headline "See how many banks…" and no button that scrolls to a form.
   - #2 the map draws **5** state shapes (AZ, CA, NY, TX, FL). Both `public/climate/maps/us-states-paths.json`
     and the copy inside the page's bundle hold 5. The 51 states appear only in a table. The row says a map of
     51 states.
   - #3 a clicked state shows its two-letter code and a score and band word. No name, no plain sentence.
   - #4 no four-answer form and no contact fields. `/api/public/climate-match` is called by no page.
   - #6 no gate and no $32 button.
   A check cannot be green and a failing test cannot be committed. Chris decides: build the page, or retire
   the journey.
5. **Consulting rows #2, #3, #5.** `docs/journeys/fh-consulting-intended.md` (2026-09-17) says education for
   business operations, three posted prices ($5,000, $5,000, $10,000), and an email to `support@fundhub.ai`.
   Owner-directed commits on 2026-10-05 (`a9af08158`, `159a537a2`, `c66504716`) rewrote the page to marketing
   consulting for agencies, with no posted price, FH Consulting LLC, and `support@fhconsulting.online`. A check
   of the old words would be red for a reason Chris already decided; a check of the new words contradicts a file
   agents may not edit. Chris decides which one is true, then these three can be judged.

## Files added

- `src/pulse/catalog/proofs/fin-b22-flow-live.mjs` — the nine saved-result checks, the judge, the runner
- `src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs` — runs each check's exact SQL over stand-in rows, 160 tests
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
- `ops/workflows/finish-853-2026-10-14/manifest-b22.md` — this file

## Shared lines touched (smallest possible)

- `src/pulse/coverage/gap-catalog-flow.mjs`: one import; `readInactiveCounts` and the live runner now run in one
  `Promise.all`; one line `if (liveRow) return liveRow;` before the old static result.
- `src/pulse/catalog/proofs/flow-gap-cases.mjs`: one import; `isFinB22ProvedFlowRow` added to
  `needsMessageGapMonitor`, `needsJourneyGapMonitor`, `needsAgentGapMonitor`; `EXPECTED_FLOW_GAP_COUNTS`
  journey 11 to 9 and the `agent: 1` line removed (a family with no row left has no entry).
- `src/pulse/catalog/proofs/flow-result-proofs.mjs`: one import; `|| finB22FlowProof(sourceFile, row)` on the
  plug-in line.
- `src/pulse/catalog/proofs/flow-read-contracts.mjs`: one import; `!isFinB22LiveFlowRow(row)` in
  `CURRENT_FLOW_RED`.
- `src/pulse/coverage/gap-catalog-flow.test.mjs`: 183 to 180, NOT_PROVED 23 to 11, the "every active control"
  guard now names the 11 not-proved ids and the nine judged ones; three tests added.
- `src/pulse/catalog/proofs/flow-result-proofs.test.mjs`: the sample list of red rows, "11 leftovers" to 3,
  the journeys-proxy test, the soft-pull test (they are no longer text-only); two tests added. Counts of rows
  with a proof (447 / 132 / 25) unchanged.
- `src/pulse/catalog/proofs/flow-read-contracts.test.mjs`: flow 23 to 11, total 38 to 26, unproved 37 to 25.
- `src/pulse/catalog/generated.json`: recompiled with `npm run pulse:catalog`. Expect a conflict after merging
  other branches; recompile.

No product file changed. No migration. No `modules.mjs` change (nothing new in `src/pulse/coverage/`).

## Product findings (not fixed)

1. `api/soft-pull-approve.mjs` ends `return dbDown(res, err)`. `dbDown` returns false for an error that is not a
   lost connection and writes no answer. So a refused consent write (a constraint, say) leaves the request
   unanswered: no 201, no error body. No link is minted, which is right, but the client's page hangs.
2. `src/messaging/sms-dedup.mjs` is imported by nothing (known). Also, when wired, it only matches rows with
   `status = 'sent'`, so a first text already moved to `delivered` is invisible to it.
3. The shipped `/climate/` map draws 5 of 51 states (see above).
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

On top of those, each of the nine saved-result queries was broken condition by condition: the test
`dropping any one condition changes the answer for some stand-in set` takes each piece of the SQL text out
(70 pieces in all, from 1 to 16 per query) and fails if no stand-in row set notices. It found eight weak spots in my first draft: three conditions another condition already covered, which I
removed (`m.id IS NULL`, `t.id IS NULL`, `p.id <> a.id`), and five that had no stand-in row set to flip them
(the text-only guard and the email twin, the no-receipt rule needing an old delivered row, the inbound filter,
a template that is named nowhere, another company's copy of a template), for which I added the case.

## Numbers and commands

- `node scripts/pulse/count-not-proved.mjs`: before 853 total, 23 of this batch; after 841 total, 11 of this batch.
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
- Not run: `npm run pulse:prove` (reads the live database; the brief forbids production reads from here) and any
  `.pg.test.mjs` (no local Postgres). The SQL is checked against the real column names from `db/` and run in
  SQLite over stand-in rows; it uses only `FILTER`, `EXISTS`, `COALESCE`, `NULLIF`, `BTRIM`, `->>`, `!~*` and
  `IS DISTINCT FROM`, each of which another Postgres lane in this repo already runs.

## Left for the next generation

- The 11 not-attachable rows above. Each needs a product change or a decision from Chris first.
- A look at whether the nine live checks should also get a heartbeat-style beat (`src/pulse/beats/`). They are
  morning-lane checks, not hourly; I did not add beats.

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
