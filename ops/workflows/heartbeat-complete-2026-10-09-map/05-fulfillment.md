# Heartbeat map, group 05: fulfillment

Fundhub. Read only. Nothing was fixed, changed, shipped or sent. Date of the look: 2026-10-09.

## What this covers

The work staff do after a client pays. Six areas:

| Area | Journey doc it comes from |
|---|---|
| A. Funding advisor desk | `role-funding-advisor-intended.md` and `-actual.md` (see "Doc problems": these list routes, not steps) |
| B. Specialist desk, Inquiries side | `role-inquiry-remover-intended.md` and `-actual.md` |
| C. Specialist desk, Repair side | same two files |
| D. Repair documents (ID and proof of address) | `repair-documents-actual.md` |
| E. Dispute rounds (letters R1 to R6) | `dispute-rounds-actual.md` |
| F. Repair letter send | `repair-letter-send-actual.md` |

## The count

61 steps looked at.

| Status | Steps |
|---|---|
| covered | 22 |
| ping-only | 10 |
| weak | 18 |
| missing | 11 |

32 of the 61 are holes where a paying client is blocked or we lose money (money: 5, customer-blocked: 27). 7 more are staff-only or internal holes.

## What the words mean

- **covered**: a deep check reads the data or runs the real code. It would turn red the same morning the step breaks for a client.
- **ping-only**: only a door check (`reg:`, `login`). It sees a dead door. It cannot see wrong data, a missing send, or a stuck file.
- **weak**: a check exists, but it is "not checked" in production, or its clock is 3 days or more, or it turns red only because work is waiting (so it cannot tell this break from a normal wait).
- **missing**: nothing turns red.
- **Trips**: `6am` is the morning pulse. `5min` is the instant watch that texts Chris. Only `health`, `login`, `apply`, `funnel:roadmap-sales` and `pipeline:outbound` run every 5 minutes. Nothing else in this group does.
- **Gap ids** show as the pulse prints them. The CRM reads print with a `gap-crm-links:` front.

## The main things, in plain words

1. **Paid repair, no program.** If a client pays for repair and the sign-up step fails, nothing turns red. No check looks for "paid repair, no program, no card" (D1).
2. **A repair client who sent everything can sit for 14 days.** Most of the document steps (D2, D4, D8) only turn red when the 14-day (or 3-business-day) file clock runs out. The client already waited by then.
3. **The mail step has almost no tripwire.** No check looks at the mail company, at mailing addresses, at the 30-day bureau clock, or at a letter that went out but was not written down (F2, F3, F4, F6). F4 is the one that can send a second envelope and a second bill.
4. **The letter words are never read.** No check looks at the name, the round wording or the "last letter" line in a stored letter (E9). The client copy of the letters is also never read (D10).
5. **Funded, but no bill.** When a round is marked funded, no check proves the success-fee invoice was made (A17). Saving a bank "yes" with a dollar amount is also never tried (A12).
6. **Every event step is "not checked".** Every job that starts on an event (deposit paid, docs received, inquiry removed, round funded) shows as "not checked" at 6 a.m. Only jobs on a timer have real run checks.

## What is red right now in this group

`repair-letter-round` and `fulfillment:next-action` are red for one paying repair client (FH-000507, in `analysis` since 2026-10-05). That is a real break already on the 2026-10-08 board. It shows that D9 works. I did not touch it.

All other checks in this group read PASS today. The funding, inquiry and repair-case tables hold 0 real rows (0 funding rounds, 0 inquiry cases, 0 dispute cases, 0 letters). So the "covered" rows for those were proved with made-up rows on 2026-10-08, not with live ones.

## How I checked

- I read the six journey docs, the pulse code (`daily-pulse.mjs`, `registry.mjs`, `heartbeats.mjs`, `instant-watch.mjs`, `pipeline-motion.mjs`, `run-slices.mjs`), the slices 14, 15, 28, 29, 33, and the lanes `gap-repair`, `gap-fulfillment`, `gap-funding`, `gap-inquiry`, `gap-documents`. For neighbours I read `gap-consent`, `gap-portal`, `gap-payments`, `gap-crm-links`, `gap-webhooks`.
- I read the repair, inquiry and funding code behind each step to see what really happens when it breaks.
- I ran the five lanes live, read only (`gap-live.mjs`): repair 1 PASS 1 FAIL, fulfillment 2 PASS 1 FAIL, inquiry 4 PASS, funding 5 PASS, documents 4 PASS.
- I ran the slice rows and the job run checks live, read only. Every door row and every event row came back "not checked". The timer jobs (`next-action-catch-up`, `inquiry-call-sweeper`, `doc-check-retry-sweeper`, `document-vault-chase`) came back PASS.
- I did not use `live-playwright:desks`. Its 41 live tests (last run 2026-10-07) sign in and look at the CRM, funnels and money reads. None of them click the funding board, the Specialist desk or the Apply step.

---

## A. Funding advisor desk

Steps come from slice 28, slice 33 and `funding-round-flow.md`, because the role docs have no steps.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| A1. Advisor signs in and sees the right pages | `login`, `reg:auth/login`, `reg:auth/session` | ping | Yes if the login page is dead. No if the wrong role gets in or is kept out. | 5min | ping-only | staff-only |
| A2. Funding board lists the files | `reg:pipeline`, `reg:dashboard/clients`, `reg:dashboard/pipeline`, `reg:pipeline-cards`, `reg:read/funding-rounds`, `gap-crm-links:crm-data:pipeline-cards`, `gap-crm-links:crm-data:pipeline`, `gap-crm-links:crm-data:pipeline-counts`, `gap-crm-links:crm-data:clients` | deep | Yes. The board reads run on the real database (the board read itself uses the sales rail). | 6am | covered | staff-only |
| A3. A funding round stops moving for 72 hours | `funding:round-stuck`, `pipeline:clients` | deep | Yes. An open round with no round or bank move for 72 hours turns red. | 6am | covered | money |
| A4. Control Panel shows a next step | `fulfillment:api`, `gap-crm-links:crm-data:client`, `job:next-action-catch-up`, `reg:dashboard/client`, `reg:client-control-panel` | deep | Yes. It runs the screen's own step code on the 5 newest board files. | 6am | covered | staff-only |
| A5. A waiting file has no next step for 72 hours | `funding:advisor-queue` | deep | Yes. It reads the step the screen shows for each waiting file. | 6am | covered | customer-blocked |
| A6. Deposit paid: docs hold set and docs asked for (s-doc-collection) | `33-fulfillment:s-doc-collection`, `documents:required-unchased` | none | No. The job row says "not checked". The data check needs a first ask to exist. | 6am | weak | customer-blocked |
| A7. Client upload works (POST) | `reg:documents-upload`, `reg:documents-download`, `reg:read/documents`, `reg:documents` | ping | No. GET only. A 405 counts as up. | 6am | ping-only | customer-blocked |
| A8. Saved files sit in the real store and open | `documents:upload-store`, `documents:cannot-open` | deep | Yes. A memory store, a missing newest file or a row with no version turns red. | 6am | covered | customer-blocked |
| A9. The doc reader reads the upload and clears the hold | `33-fulfillment:doc-check`, `documents:stuck-processing`, `job:doc-check-retry-sweeper` | deep | Only if a read failed and was queued for retry. A job that never ran is not seen. | 6am | weak | customer-blocked |
| A10. Lender list loaded and bank match works | `funding:lender-book`, `gap-crm-links:crm-data:lenders`, `gap-crm-links:crm-data:lender-matches`, `reg:read/lender-matches` | deep | Yes. An empty list is red. The match read runs for a real client (1106 banks today). | 6am | covered | customer-blocked |
| A11. Apply tab is on the page and its bank read answers | `apply`, `funding:apply-door`, `reg:applications` | deep | Yes. The page text is checked, and the real GET handler runs for a real client. | 5min | covered | customer-blocked |
| A12. Save a bank answer (Bank yes plus Approved $) | `reg:applications`, `funding:apply-door` | ping | No. The save (POST) is never run. | 6am | ping-only | money |
| A13. Application sits on Apply 72 hours with no submit date | `funding:submit-path` | deep | Yes. | 6am | covered | money |
| A14. Apply step blocked with no reason saved | `fulfillment:apply-blocked` | deep | Yes. Also a proxy row stuck on "verifying". | 6am | covered | staff-only |
| A15. Proxy launch (Oxylabs) works for Apply | `reg:proxy/launch`, `reg:read/proxy-sessions` | ping | No. POST-only route, so GET 405 is up. A bad proxy login stays green. | 6am | ping-only | customer-blocked |
| A16. Card dragged to Funded: round and client marked funded | `funding:round-stuck`, `reg:pipeline-cards` | deep | Only after 72 hours. A round that never became funded stays open and still. | 6am | weak | money |
| A17. Funded: the success-fee invoice is made (F-07) | `28-funding-advisor:f-07-funding-locked`, `payments:invoice-stuck` | none | No. The job row is "not checked". The invoice check reads only bills that exist. | none | missing | money |
| A18. Round notices and inquiry cleanup (F-03, F-04, F-05) | `14-funding:f-03-round-submitted`, `14-funding:f-04-round-approvals`, `14-funding:f-05-inquiry-cleanup-gate`, `pipeline:outbound` | none | No for "never sent". Only a message stuck in the queue 30 minutes is seen. | none | weak | internal |

## B. Specialist desk, Inquiries side

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| B1. Desk page opens, toggle and "Need me" tile | `reg:inquiry-remover`, `login` | ping | Yes if the page is gone. No if the toggle or the tile breaks. | 6am | ping-only | staff-only |
| B2. Inquiry queue loads | `inquiry:specialist-api`, `reg:read/inquiry-cases`, `reg:inquiry`, `reg:inquiry-cases` | deep | Yes. It runs the 3 desk reads on the real database. | 6am | covered | staff-only |
| B3. New inquiries are logged and a specialist task is made (C-02) | `15-repair:c-02-inquiry-created` | none | No. The event row is "not checked". Nothing reads `inquiry_log`. | none | weak | customer-blocked |
| B4. Paid deposit flags removal as queued (C-02B) | `29-inquiry-remover:c-02b-inquiry-removal-requested` | none | No. The event row is "not checked". | none | weak | customer-blocked |
| B5. A case is worked, not left idle | `inquiry:case-stuck`, `job:inquiry-call-sweeper` | deep | Yes. Quiet 72 hours with nothing set, or a due call not started in 45 minutes. | 6am | covered | customer-blocked |
| B6. A funding round with open inquiries has a letter draft | `inquiry:letter-round` | deep | Yes. Only for rounds the inquiry gate made. | 6am | covered | customer-blocked |
| B7. Specialist presses Send: removal letter mails to the bureau | `reg:inquiry-cases` | ping | No. GET 405 is up. The mail call is never tried. | 6am | ping-only | customer-blocked |
| B8. Client sees the inquiry upload box in the portal | `inquiry:upload-door` | deep | Yes. It looks for the box in the page. The upload itself is A7. | 6am | covered | customer-blocked |
| B9. Case closed: funding resumes or holds (C-03) | `29-inquiry-remover:c-03-inquiry-removed-resume-or-hold`, `funding:round-stuck` | none | Only the 72-hour round-stuck line would show it. | 6am | weak | customer-blocked |
| B10. Phone calls and setter events (on hold by owner decision) | `29-inquiry-remover:ai-set-01-josh-setter`, `29-inquiry-remover:ai-set-03-no-answer-cadence`, `29-inquiry-remover:ai-set-04-3way-handoff` | none | No. All "not checked". Phone work is on hold. | none | weak | internal |

## C. Specialist desk, Repair side

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| C1. Repair list and "Need me" number load | `reg:read/repair-cases` | ping | No. A 401 counts as up. No lane runs the list read behind the login. | 6am | ping-only | staff-only |
| C2. Open a repair file: items and letters | `reg:read/repair-cases` | ping | No. Same route, same blind spot. | 6am | ping-only | staff-only |
| C3. Stuck files list shows | `reg:repair/exceptions`, `pipeline:repair`, `repair-case-stuck` | ping | The list route hides read errors as an empty list. The two data checks turn red on their own, so Chris still hears. | 6am | ping-only | staff-only |
| C4. Confirm a bureau answer (POST) | `reg:repair/exceptions`, `pipeline:repair` | ping | Only because a card waiting in `response_received` turns `pipeline:repair` red. The click is never run. | 6am | weak | customer-blocked |

## D. Repair documents (ID and proof of address)

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| D1. Client buys repair: program made, card on intake | `reg:repair/enroll`, `payments:paid-no-entitlement`, `portal:next-step` | none | No. None reads "paid repair, no program or card". Those cover the entitlement and the checklist only. | none | missing | money |
| D2. Enrolment asks "are ID and proof on file?" (docs.needed or docs.complete) | `repair-case-stuck` | deep | Slowly. The intake clock is 3 business days. The event itself is not checked. | 6am | weak | customer-blocked |
| D3. Request email waits in the queue | `pipeline:outbound`, `job:message-dispatch-sweeper` | deep | Yes. A message queued over 30 minutes. | 5min | covered | customer-blocked |
| D4. Request email never queued (the old N8 hole) | `repair-case-stuck`, `documents:required-unchased` | deep | Slowly. Only after 14 days on `awaiting_documents`. The data check needs a first ask. | 6am | weak | customer-blocked |
| D5. Client sends docs at the portal ID door | `reg:client-portal`, `portal:page`, `reg:documents-upload` | ping | No. The portal check looks for tiles only. The ID door is never looked for. | 6am | ping-only | customer-blocked |
| D6. Client texts a photo (MMS door) | none | none | No. The webhook lane watches Twilio status, not inbound texts. | none | missing | customer-blocked |
| D7. Photo is read and filed as ID or proof | `33-fulfillment:doc-check`, `documents:stuck-processing`, `job:doc-check-retry-sweeper` | deep | Only for reads already queued for retry. A wrong label is not seen. | 6am | weak | customer-blocked |
| D8. Both docs in: docs.complete moves the card to analysis | `repair-case-stuck`, `33-fulfillment:repair-stage-moves` | deep | Slowly. 14 days on `awaiting_documents`. The event row is "not checked". | 6am | weak | customer-blocked |
| D9. Letters are built on docs.complete | `repair-letter-round`, `fulfillment:next-action` | deep | Yes. A file on `analysis` past 1 hour turns red. Both are red today. | 6am | covered | customer-blocked |
| D10. Client copy of the letters saved to the portal | none | none | No. The write failure is swallowed. No check reads the client copy. | none | missing | customer-blocked |
| D11. Card moves to letters generated, then ready to send | `pipeline:repair`, `repair-letter-round` | deep | Yes. Any card in those stages is red, or a card that says letters exist and none do. | 6am | covered | customer-blocked |

## E. Dispute rounds (letters R1 to R6)

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| E1. R2 to R6 are written when staff press Generate | `reg:repair/generate`, `pipeline:repair` | ping | Only a waiting card turns `pipeline:repair` red. The route ping sees a dead door. | 6am | weak | customer-blocked |
| E2. Signed repair agreement or dispute authorization on file | `consent:dispute-required`, `repair-letter-round` | deep | Yes. An active repair client over 7 days with neither turns red. | 6am | covered | customer-blocked |
| E3. Round is allowed by the program cap (trial 2, full 6) | none | none | No. Nothing compares `rounds_cap` with what was bought. | none | missing | customer-blocked |
| E4. A stored credit report exists | `repair-letter-round` | deep | Yes. The refusal leaves the card on `analysis`, red in 1 hour. | 6am | covered | customer-blocked |
| E5. R2 and later: newest pull is newer than last round's letters | `pipeline:repair` | deep | Only because the card waits. It does not name this reason. | 6am | weak | customer-blocked |
| E6. Name and address come from the verified ID | `repair-letter-round`, `33-fulfillment:doc-check` | deep | Yes. "Identity not verified" leaves the card on `analysis`, red in 1 hour. | 6am | covered | customer-blocked |
| E7. One letter per bureau (the "too similar" gate can skip one) | `repair-letter-round` | deep | Yes. An open case with items and no letter for 30 minutes. | 6am | covered | customer-blocked |
| E8. Furnisher letters (R1) need a furnisher address | none | none | No. The skip is only a warning. The desk shows a flag. No pulse reads it. | none | missing | customer-blocked |
| E9. Letter words are right (name, round wording, "last letter" only in R6) | none | none | No. The repair lane says it does not read letter words. | none | missing | customer-blocked |
| E10. Waiting on a bureau (in transit 10 days, answer due plus 5 days) | `repair-case-stuck` | deep | Yes. | 6am | covered | internal |

## F. Repair letter send

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| F1. Staff press Send letters (POST, mail on) | `reg:repair/send`, `pipeline:repair` | ping | Only because unsent letters keep the card in `ready_to_send`. Any waiting file does the same. | 6am | weak | customer-blocked |
| F2. A mailing address is known (bureau, furnisher, CFPB, state AG) | none | none | No. | none | missing | customer-blocked |
| F3. The mail company takes the letter (PostGrid) | none | none | No. No ping, no key check, no read of `mailed_at`. | none | missing | customer-blocked |
| F4. Mail company took it, but the write-down failed | none | none | No. `unrecordedMailings` goes to the screen and log only. A re-send means a second envelope and a second bill. | none | missing | money |
| F5. Send claim stuck on "sending", and no screen can clear it | `pipeline:repair` | deep | Only because the card stays on `ready_to_send`. Nothing reads status "sending". | 6am | weak | customer-blocked |
| F6. The 30-day bureau clock starts (`response_due_at`) | none | none | No. The write failure is swallowed. With no date, the late-answer line can never fire. | none | missing | customer-blocked |
| F7. Mailed: card moves to in transit | `pipeline:repair`, `repair-case-stuck` | deep | Yes. A card left on `ready_to_send` is red. In transit past 10 days is red. | 6am | covered | staff-only |
| F8. A bureau answer is read after upload | `33-fulfillment:repair-bureau-response-reader`, `repair-case-stuck` | deep | Slowly. The event row is "not checked". Red at due date plus 5 days (about day 35). | 6am | weak | customer-blocked |

---

## Doc problems

- **`role-funding-advisor-intended.md` and `-actual.md`**: both list routes only (170 of 323 reachable). No steps. The intended file says it was copied from the actual file, so a match proves nothing. I took the steps from slices 28 and 33 and from `funding-round-flow.md`.
- **`role-inquiry-remover-actual.md`**: route list only. The Specialist desk steps exist only in the intended file.
- **`dispute-rounds-actual.md`**: has no intended file. Its last section says `src/identity/` does not exist. It does (`src/identity/verified.mjs`). The same page says so higher up.
- **`repair-documents-actual.md`**: two lines are out of date. (1) It says the only caller of `analyzeAndGenerate()` is `api/repair/generate.mjs`. Since 2026-09-18 (commit `2e19c7c7`) the `repair.docs.complete` handler in `src/repair/handlers.mjs` calls it too. (2) It says the SLA "chases the owner after 14 days". No job runs that sweep. Only the desk "Stuck" chip and the pulse read the clock.
- **`repair-letter-send-actual.md`**: still true on the two open holes. `unrecordedMailings` has no reader, and `clearStuckSendClaim` and `listStuckSendClaims` have no route (I searched `api/` and `src/`). It has no intended file.
- **No intended journey** exists for dispute rounds, repair letter send or repair documents.

## Holes (money or customer-blocked, not covered)

A6, A7, A9, A12, A15, A16, A17, B3, B4, B7, B9, C4, D1, D2, D4, D5, D6, D7, D8, D10, E1, E3, E5, E8, E9, F1, F2, F3, F4, F5, F6, F8. That is 32 rows.

Staff-only or internal holes: A1, B1, C1, C2, C3, A18, B10.

## Checker — 2026-10-09

Read only. I changed nothing except this section.

**Verdict: the map is mostly right. It is not fully right. Fix the points below before anyone trusts the counts.**

### What I did

- Read the whole file. Looked up every id it names. All of them are real.
- Ran the five lane test files (repair, fulfillment, funding, inquiry, documents). 74 pass, 0 fail.
- Ran the five lanes live, read only. Same as the map: repair 1 PASS 1 FAIL, fulfillment 2 PASS 1 FAIL, funding 5 PASS, inquiry 4 PASS, documents 4 PASS. Both FAILs are FH-000507.
- Counted rows in SQL. The map is right here too: 0 funding rounds, 0 inquiry cases, 0 dispute cases, 0 letters, 0 applications. One repair program. One repair card. So no "covered" funding, inquiry or letter row was ever proved on live rows. They were proved with made-up rows.

### The "covered" rows I tried to break

| Row | Result | Why |
|---|---|---|
| D9 `repair-letter-round` | Holds | Red live right now for FH-000507. |
| A3 `funding:round-stuck` | Holds | Real SQL. It also goes red for a round that is only waiting on a bank for 72 hours. |
| A13 `funding:submit-path` | Holds | Real SQL. 'Apply' is a real status. |
| A5 `funding:advisor-queue` | Holds, but narrow | Red only when the screen says "No step applies". A file stuck on "Apply for Funding" never trips it. The 72-hour round line is the backup. |
| A8 `documents:upload-store`, `documents:cannot-open` | Holds | Live: store is netlify-blobs and the newest 5 files read back. |
| A10 `funding:lender-book`, `crm-data:lender-matches` | Holds | Live: 1106 banks, 55 matches. |
| A11 `apply`, `funding:apply-door` | Holds | I fetched the live page. The "client email" line is there. The door ran for a real client. The 5-minute `apply` check reads page words only. |
| B5 `inquiry:case-stuck`, B6 `inquiry:letter-round` | Holds in SQL | No live rows. B6 sees only cases the inquiry gate made. |
| B8 `inquiry:upload-door` | Holds, markup only | It proves the box is in the page file. It does not prove it shows for a client. |
| D3 `pipeline:outbound` | Holds | Runs every 5 minutes. It cannot see a message the gate set to "blocked". 5 such rows exist. Some blocks make a staff task. The pulse stays quiet either way. |
| E4, E6, E7 `repair-letter-round` | Holds | The letter engine makes one case per bureau (`analyze.mjs`). A skipped bureau leaves a case with items and no letter. That goes red. |
| D11 `pipeline:repair`, `repair-letter-round` | Holds, with a caution | The "card says letters exist, none do" half is deep. The "card sits in the stage" half is red by presence. |
| E2 `consent:dispute-required` | Holds only through `repair-letter-round` | Its own clock is 7 days. By the map's own 3-day rule that is slow. The 1-hour card line does the real work. |
| **F7** | **Refuted** | See fix 1. |

### Fixes to the map

1. **F7: covered becomes weak.** `pipeline:repair` counts any card on `ready_to_send` with no clock (`pipeline-motion.mjs`, no time test). `repair-case-stuck` skips that stage on purpose. A letter that was mailed while the card stayed on `ready_to_send` looks the same as a normal waiting file. That is the exact reason the map made F1 and F5 weak.
2. **E1 and E5: weak becomes covered.** After a bureau answer is confirmed, the card goes to `analysis` (`repair.round.escalated`). If nobody presses Generate, or Generate refuses (cap, stale pull, no ID), the card stays on `analysis`. `repair-letter-round` goes red one hour later. **E5 names the wrong id.** `pipeline:repair` does not read `analysis`. The right id is `repair-letter-round`. Caution: a slow human click also trips it.
3. **New counts after fixes 1, 2 and 5:** covered 23, ping-only 10, weak 18, missing 10. Total 61. Money or customer-blocked holes: 30, not 32.
4. **The map missed checks that already exist.** They do not change a status, but they belong in the rows:
   - `gap-jobs:failed-events` goes red when an in-process event handler throws and lands in the dead-letter list. This partly covers D1, D2, D8, D7 and A9. It does not see Inngest jobs such as F-07, and it does not see a handler that quietly skips.
   - `email:provider-fail` (failed or bounced mail, 3 mornings), `email:sending-stuck`, `gap:sms-provider-failed`. These cover D3, D4 and A18 when a send fails. A18 is wrong to say only the 30-minute queue is seen. "Never queued" is still not seen.
   - `portal:paid-entitlement` goes red for a payer whose payment name matches no product and who holds no entitlement at all, one hour after the payment. It covers one way D1 breaks (see fix 5).
5. **D1: missing becomes weak.** D1 already happened once. FH-000507 paid $1000 on 2026-09-17 under the product name "Consulting Services Standard". There is no repair sale for this client. The only entitlement was given by hand on 2026-10-05, the same minute as the `repair.enrolled` event. That is 18 days of a paid client in limbo. `portal:paid-entitlement` would have gone red on this exact break, one hour after the payment (name matches no product, no entitlement held, a `payment.received` event exists). That lane did not exist yet. Still not seen: a payment that does match a repair product, where the sale or the program or the card is not made. Those skips only write a log line. A thrown error is seen by `gap-jobs:failed-events`.
6. **A12 and A17 are sharper than the map says.** The money break is a bank "yes" saved with no dollar amount. The success-fee bill cannot be made without it (`success-fee.mjs`; F-07 makes a staff task and no bill). The board only paints an "amount needed" flag. No check goes red on it. F-07 is an Inngest job, so `gap-jobs:failed-events` does not see it either. `csm:missing-step` sees a funded round with no results call, but that is a different job on the same event.
7. **Doc claims to fix.** The map says no flow doc exists for the repair floor or the ID read. Two do: `docs/journeys/repair-floor-flow.md` (Generate, E1 to E9) and `docs/journeys/doc-check-identity-flow.md` (D7). There is still no `-intended` file for either.

### Steps the map skipped

| Step | Checks that exist | Status | Impact |
|---|---|---|---|
| M1. Bank decision email comes in (Mailgun door, `bank_inbox`, F-11 task and stage move) | none. The webhook lane probes only 4 doors (`twilio-status`, `commas`, `clickfunnels`, `calendar-booking`). `bank_inbox` has 0 rows. | missing | money |
| M2. Bank asks for more documents, client is asked (F-06) | `14-funding:f-06-funding-conditions-missing-docs`, `33-fulfillment:f-06-funding-conditions-missing-docs`, `documents:required-unchased` | weak | customer-blocked |
| M3. Paid funding client gets a card and a round start within 24 hours (the promise in `s-06`) | `funding:advisor-queue`, `pipeline:clients` (both are 72-hour clocks) | weak | customer-blocked |
| M4. Lendflow alt-finance rail (`funding_altfin`): webhook door and cards. 0 cards today. | none | missing | money |
| M5. PostGrid delivery webhook moves the file to awaiting response | `repair-case-stuck` (10 days), `inquiry:case-stuck` (72 hours) | weak | staff-only |
| M6. Next round opens after a confirmed answer (`round_complete` to `analysis`) | none. `round_complete`, `on_hold`, `program_complete` have no clock. The escalate step swallows its error. | missing | customer-blocked |
| M7. Trial hits its 2-round cap: upsell_pending, upsell email, fresh credit check | none | missing | money |
| M8. Repair client emails are queued at each step (welcome, letters sent, results, next round, retake photo) | `pipeline:outbound`, `email:provider-fail`, `email:sending-stuck` | weak | customer-blocked |
| M9. Client bureau-response upload box in the portal (`data-kind="bureau_response"`) | `portal:page`, `portal:paid-entitlement` (tiles and entitlement only) | ping-only | customer-blocked |
| M10. Bank yes saved with no dollar amount | none | missing | money |

### Missing rows that are not fully missing

- D1: `portal:paid-entitlement` and `gap-jobs:failed-events` can go red (see fix 5). It is weak, not missing.
- A17, F2, F3, F4, F6, D6, D10, E3, E8, E9: I searched `src/pulse` for each. Nothing reads them. Still missing.
