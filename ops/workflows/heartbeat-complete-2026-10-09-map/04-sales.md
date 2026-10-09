# Heartbeat map, group 04-sales

Read-only audit, 2026-10-08 evening. Nothing in the app was changed. This is the only file I wrote.

## What I covered

The sales steps, in order: booking, the call, the recording, the outcome, the contract and pay link, the deposit, and the handoff after the deposit. I also covered who on staff can open the sales screens.

The two role journey docs I was given do not list sales steps. They only list which web addresses a closer and a sales manager may open (189 of 323 for a closer, 204 of 323 for a sales manager). So I took the steps from the code, from `docs/journeys/booking-notifications-flow.md`, and from the closer path written in `src/pulse/coverage/slice-27-closer.mjs`.

## The count (49 steps)

| status | steps |
|---|---|
| covered | 19 |
| ping-only | 8 |
| weak | 14 |
| missing | 8 |

22 of the 30 steps that are not covered cost money or block a paying customer. 8 are staff-only or internal.

## The short story

- Most of the sales path cannot go red today. The 6 a.m. job lists the sales workflows, but each one prints "not checked" and can never turn red.
- Of 36 rows in the sales lists (slice 13, 20 and 27), 31 say "not checked". The other 5 are job-ran-recently rows that copy the `job:` rows. I ran them live to be sure.
- The check that texts Chris within 5 minutes only watches the site doors and one thing from this path: messages stuck in the queue (`pipeline:outbound`). Every other sales check waits for 6 a.m. the next day.
- Every call and deposit check passes today because there is nothing to find. `bookings` has 0 rows, `call_outcomes` has 0, `contracts` has 0. The last real booking event was 2026-09-04. A green here does not prove the step works.
- Three breaks have no tripwire at all and lose money: a booking post that is refused, a call with no way to join, and a payment whose notice never arrives.

## Facts I measured (read-only)

- 49 real `booking.created` events exist (2026-08-12 to 2026-09-04). 0 of them carry a meeting link. 47 carry an end time.
- All 25 real `deposit.paid` events and all 49 real `booking.created` events have no client id. Any check that joins on the event's client id cannot see them. `csm:missing-step` does this.
- Josh the AI setter (AG-04) is `retired`. Active staff: 4 closers, 2 sales managers.
- The last live browser sweep (`live-playwright:desks`) ran 2026-10-07 21:40 UTC and nothing schedules it. At 6 a.m. on Oct 9 it will be about 39 hours old, and the limit is 26. It will read red unless someone runs it.
- Live runs of the sales lanes (calls, closer, meet, sales-manager, funnels, webhooks, csm, sms) show no SQL errors and no writes. All pass today except `gap:sms-journey-zero`. That one is red for the welcome text, not for booking.
- Today every cited page and door answers up: calendar, closer-call, closer-dashboard, present, sales-floor, my-numbers, contracts, payment-success, and the API doors (401 or 405 when signed out).

## Journey docs: missing or stale

- `role-sales-manager-intended.md` and `role-closer-intended.md`: written after the fact from the actual files. Each says a match proves nothing. They hold route access only.
- `role-sales-manager-actual.md` and `role-closer-actual.md`: made 2026-10-06. The code now has 2 routes they lack (`read/morning-brief`, `marketing/shoot/take`). Neither is a sales route. Yesterday's review also listed the journeys generator as stale.
- No journey doc exists for the closer path (booked, show, present, close, contract, pay link, deposit, handoff). `docs/journeys/CHANGELOG.md` (2026-08-30) already says this gap is the finding.
- `booking-notifications-flow.md` covers the booking half only, and it is not an intended and actual pair.

How I checked ids: each id below was found in the code, or computed with `namespaceGapId` for the 6 a.m. name. Funnel and jobs lanes get a `gap-funnels:` or `gap-jobs:` prefix at 6 a.m.

Column "trips": 6am means the 6 a.m. job (next morning). 5min means the every-5-minute watch.

## A. Booking and the first messages

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| A1 Booking page shows the calendar and form | `gap-funnels:funnel:funding-book-call`, `gap-funnels:funnel:roadmap-book` | deep | yes: page down, or the calendar picker or form is gone from the page | 6am | covered | money |
| A2 Calendar has open times and a test booking lands | none | none | no: the widget code can stay while no times show | none | missing | money |
| A3 Apply survey posts the lead | `gap-funnels:funnel:apply-form` | deep | yes: survey field or the post line gone, or the post door is dead | 6am | covered | money |
| A4 Thank-you page after booking | `gap-funnels:funnel:thank-you`, `gap-funnels:funnel:roadmap-thank-you` | deep | yes: page copy or script is gone | 6am | covered | money |
| A5 ClickFunnels booking route exists on our side | `webhooks:clickfunnels`, `webhooks:calendar-booking` | deep | yes: route unmounted (router answers 404, not 401) | 6am | covered | money |
| A6 A real signed booking post is accepted | none | none | no: a wrong secret gets 401 and writes nothing; no email gets 200 and writes nothing | none | missing | money |
| A7 Booking saved with a closer task | `calls:booking-webhook`, `gap-jobs:failed-events` | deep | yes: event 10 minutes old with no bookings row, or a handler threw | 6am | covered | money |
| A8 Sales card moves to Booked (s-04) | `20-sales:s-04-call-booked` | none | no: prints "not checked" every morning | none | weak | staff-only |
| A9 Confirmation text | `gap:sms-journey-zero`, `pipeline:outbound`, `gap:sms-sending-stuck`, `gap:sms-provider-failed`, `job:message-dispatch-sweeper` | deep | yes: no text row, or stuck 30 minutes (this part trips in 5 min) | 5min / 6am | covered | money |
| A10 Confirmation email | none for "never written" | none | no: only failed or stuck email is watched (`email:provider-fail`, `email:sending-stuck`) | none | missing | money |
| A11 24 hour and 2 hour reminders (s-04b) | `20-sales:s-04b-booking-reminders` | none | no: prints "not checked" | none | weak | money |
| A12 15 minute "call starts" text and advisor task (ai-set-04) | `24-agents:ai-set-04-3way-handoff` | none | no: prints "not checked" | none | weak | money |
| A13 Pre-call video and text drip (bs-01) | `24-agents:bs-01-precall-launcher` | none | no: prints "not checked" | none | weak | money |
| A14 A cancelled or moved call gets no wrong texts | none | none | no: this was repaired 2026-10-05 and nothing watches it | none | missing | money |
| A15 Filled the survey, never booked: chase texts (s-nobook-chase) | `20-sales:s-nobook-chase` | none | no: prints "not checked" | none | weak | money |
| A16 Customer has a way to join the call | none | none | no: 0 of 49 real bookings carry a meeting link | none | missing | money |
| A17 Closer sees the call on the calendar | `calls:calendar`, `reg:calendar`, `reg:tasks` | ping | the page check is deep; the tasks data behind sign-in only answers a ping | 6am | ping-only | money |
| A18 Staff booked-call text (s-04c, default off) | `20-sales:s-04c-staff-booked-alert` | none | no: prints "not checked" | none | weak | staff-only |
| A19 Blake referral lead reaches Chris | `job:blake-lead-watch`, `13-calls:blake-lead-watch`, `gmail` | ping | only if it stops; "gmail not ready" ends as a normal pass | 6am | ping-only | money |
| A20 Josh the AI setter dials | `calls:ai-dial-no-failure` | deep | no today: Josh is retired, so it only passes | 6am | weak | internal |

## B. The call

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| B1 Closer opens the live call screen | `reg:closer-call`, `reg:read/closer-call`, `reg:read/closer-now` | ping | only on 404 or 5xx; signed out gets 401 before the data code runs | 6am | ping-only | money |
| B2 Closer Dashboard and Present are the right pages | `closer:desk-pages`, `reg:closer-dashboard`, `reg:present` | deep | yes: wrong title, shell.js missing, present.js down or no longer posts the outcome | 6am | covered | money |
| B3 Present actions work (log outcome, send soft pull, ebook, pay link) | `reg:closer-deck`, `reg:read/closer-deck` | ping | only on 404 or 5xx; the save is never tried | 6am | ping-only | money |
| B4 No-show check runs (dpc-02) | `calls:booked-no-outcome` | deep | yes if it never ran: ended call stays booked with no outcome 30 minutes later | 6am | covered | money |
| B5 A customer who showed is not marked no-show | none | none | no: dpc-02 decides once, 5 minutes after the booked end, from one event | none | missing | money |
| B6 No-show recovery texts and emails go out (s-05a) | `20-sales:s-05a-no-show-recovery` | none | no: prints "not checked" | none | weak | money |

B5 is a code risk, not a measured break. dpc-02 moves the card to lost and starts four rounds of "you missed us" if no `call.completed` exists at that moment. s-05a stops only on a new booking, not on a logged call. No real call exists yet to test it on.

## C. The recording

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| C1 Call has a tape or words on it | `unrecorded`, `reg:read/unrecorded-calls` | deep | yes: logged call with no tape 20 minutes later (not for no-shows) | 6am | covered | staff-only |
| C2 Drive is scanned for Meet files | `meet-transcript-sweeper`, `job:meet-transcript-sweeper` | deep | yes: no scan in 30 minutes, a scan error, or a file with no words after 30 minutes | 6am | covered | staff-only |
| C3 Words reach the call and the closer's context | `meet:recording-no-transcript`, `meet:transcript-unreadable` | deep | yes: tape link with no words, or the real context read cannot see the words | 6am | covered | staff-only |

## D. The outcome

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| D1 Closer's outcome is saved | `closer:held-disposition`, `calls:booked-no-outcome` | deep | yes: saved disposition with no row, deck used with no outcome, or an ended call with none | 6am | covered | money |
| D2 Offer email after the call (s-offer-bucket) | `20-sales:s-offer-bucket` | none | no: prints "not checked"; no email journey check exists | none | weak | money |
| D3 "Funding did not buy" follow-up task (s-08) | `20-sales:s-08-post-call-funding-declined` | none | no: prints "not checked" | none | weak | staff-only |
| D4 Sales Floor and My Numbers read right | `sales-manager:read-api`, `sales-manager:totals`, `sales-manager:dropped-closer`, `reg:read/sales-floor`, `reg:read/my-numbers` | deep | yes: the real reads throw or return bad numbers | 6am | covered | staff-only |
| D5 Commission screens | `reg:read/commissions`, `reg:commissions`, `reg:products-commissions` | ping | only on 404 or 5xx | 6am | ping-only | staff-only |

D4 is green today on zeros: 0 booked, 0 held, 0 deposits. `dropped-closer` only guards the roster code, not data.

## E. Contract, pay link, deposit

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| E1 Contract can be signed and the copy is stored | `contracts:sent-unsignable`, `contracts:sign-route`, `contracts:signed-not-stored`, `contracts:template-missing`, `job:contract-chaser` | deep | yes: sent but unsignable, route gone, signed with no file, or no template | 6am | covered | money |
| E2 Closer makes a pay link | `reg:payment-links`, `gap-funnels:funnel:roadmap-checkout` | ping | no: the till only says a key is set, never that the vendor accepts it | 6am | ping-only | money |
| E3 Payment notice door works and gets processed | `webhooks:commas`, `payments:commas-webhook-route`, `webhooks:stuck-failed`, `payments:pay-link-webhook`, `job:commas-inbox-drain`, `job:commas-inbox-sweeper` | deep | yes: door gone, notice stuck in the inbox, or recorded but the link was never settled | 6am | covered | money |
| E4 A payment whose notice never arrives | none | none | no: the vendor sends once and never retries; our own code says this is not covered | none | missing | money |
| E5 Paid, so access is granted | `payments:paid-no-entitlement`, `gap-jobs:failed-events` | deep | yes: paid for a mapped product with no entitlement after 3 minutes | 6am | covered | customer-blocked |
| E6 Paid, so the sale and the closer's commission are saved | none | none | no: the money handler can skip quietly without an error | none | missing | staff-only |
| E7 Customer lands on the success page | `reg:payment-success` | ping | only on 404 or 5xx | 6am | ping-only | money |

E2 has a real past case. Until 2026-09-29 the stored checkout key answered 401 on every route, so no card page came back. The "ready" flag read true the whole time. Nothing probes the key today.

E1 note: `reg:contracts` is one id for two rows (the API route and the desk page), so one can hide the other.

## F. Handoff after the deposit

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| F1 Paid client gets the document request text | `gap:sms-journey-zero`, `documents:required-unchased` | deep | yes: no text row after a deposit, or a paper asked for and never chased in 3 days | 6am | covered | customer-blocked |
| F2 Funding card placed and intake task made within 24 hours | `20-sales:s-06-post-call-funding-purchased`, `pipeline:clients`, `funding:advisor-queue`, `gap-jobs:failed-events` | none | only after 72 hours, or if a handler throws; the 24 hour promise is not watched | none | weak | customer-blocked |
| F3 CSM accountability call is created | `csm:missing-step` | deep | no for deposits: it joins on a client id that all 25 real deposit events lack | 6am | weak | customer-blocked |
| F4 Client can sign in and sees entitlement | `portal:paid-entitlement`, `portal:next-step`, `gap:auth-magic-link-dead` | deep | yes: paid with no entitlement; next-step reads blueprint and repair only | 6am | covered | customer-blocked |
| F5 Blueprint buyer ready, closer alerted | `job:blueprint-closer-ready-sweeper` | ping | only if the job stops; one bad file is swallowed and the run still counts ok | 6am | ping-only | money |

## G. Staff access (what the two role docs describe)

| step | check id(s) | depth | can go red? | trips | status | customer impact |
|---|---|---|---|---|---|---|
| G1 Closer and sales manager can sign in | `login`, `reg:auth/login`, `gap:auth-staff-login`, `gap:auth-signin-no-session`, `gap-staff:role-desk` | deep | yes for the whole company; nothing tests a closer or sales manager login | 5min / 6am | covered | staff-only |
| G2 Each role reaches only what the docs say | `gap-staff:role-gate` | ping | no: one hiring route, turned away before the role check runs | 6am | weak | staff-only |
| G3 Signed-in sales screens work | `live-playwright:desks` | deep | only when someone runs it on the Mac; no schedule; logs in as owner and admin only | 6am | weak | staff-only |

G2: the allowed and blocked lists (closer 189 and 134, sales manager 204 and 119) are guarded by unit tests only. No heartbeat checks them.

## What I ran

- `gap-live.mjs` for calls, closer, meet, sales-manager, funnels, webhooks, csm, sms. Read-only, no writes.
- A read-only run of slices 13, 20, 27 and 30, to see which rows can go red.
- Read-only SQL for counts, events, templates, staff roles and the Drive scan time.
- GET only on 26 page and API addresses, plus the GETs the lane runs make.
- Nothing else. I did not call any vendor with a key.

## Checker — 2026-10-09

Read-only check by a second agent. I changed nothing else in the repo. I ran live read-only reads (the `sms` and `soft-pull` lanes, the sales slice rows, and SQL), and I read the code behind each claim.

**Verdict: not confirmed.** The map is honest about most things. But 5 "covered" rows are weaker than it says. 1 "missing" row is half covered. And 7 steps that touch money or a paying customer are not on the map.

### New count if you take my changes

| status | map said | I say |
|---|---|---|
| covered | 19 | 14 |
| ping-only | 8 | 8 |
| weak | 14 | 20 |
| missing | 8 | 7 |
| total | 49 | 49 |

Add the 7 skipped steps below (1 covered, 3 weak, 3 missing). New total 56: covered 15, ping-only 8, weak 23, missing 10.

### The 12 riskiest "covered" rows

| step | my call | one-line reason |
|---|---|---|
| E3 Payment notice door works and gets processed | **wrong: weak** | The door check cannot tell a good door from one that refuses every real payment. |
| E5 Paid, so access is granted | **wrong: weak** | The check skips any paid order whose product name matches no product. 2 real ones sit there now. |
| F4 Client sees entitlement | **wrong: weak** | Same blind spot as E5 (`portal:paid-entitlement`). |
| G1 Closer and manager can sign in | **wrong: weak** | Red only if nobody can sign in. 2 of 4 active closers have no password and it is green. |
| A9 Confirmation text | **wrong for now: weak** | The one row is already red for another step. And an un-approved template hides the step. |
| A7 Booking saved | holds | `calls:booking-webhook` compares events to `bookings` rows. It is the only net, because the save swallows its own errors. |
| B4 No-show check | holds | `calls:booked-no-outcome` reads real booking rows. Green today only because there are no real calls. |
| D1 Outcome saved | holds, small hole | The "saved but no row" half cannot really fire. The code says Present writes the row first. `calls:booked-no-outcome` is the real net. |
| E1 Contract signed and stored | holds | The forged-link probe really runs. The 3 database checks are green on 0 contracts. |
| B2 Closer pages | holds | Real page markers, passed live. |
| A1 Booking page | holds | It proves the calendar widget code is on the page. It cannot see an empty calendar (A2). |
| A3 Apply survey posts | holds as written | It proves the page has the post line and the door is mounted. It cannot see a refused real post (A6). |

### Why the 5 are wrong

**E3.**
- `payments:commas-webhook-route` posts an empty, unsigned body and wants a 401. A door that refuses every real signed payment also answers 401. So it passes both ways.
- This has happened. The router comment says a wrong header name made every real payment answer 401 (`src/http/router.mjs`).
- The router does not save refused posts. It keeps only 200s. A wrong secret leaves no trace.
- No check reads `commas_inbox` rows that are waiting with 0 tries. On 2026-09-17 six sat that way (`src/workflows/commas-inbox-drain.mjs`, top note). `job:commas-inbox-drain` and `job:commas-inbox-sweeper` only say the clock ran.
- Still good: stuck failed rows, and a link left open after money landed.

**E5 and F4.**
- `payments:paid-no-entitlement` joins on the product name. A paid order with a name that matches no product drops out.
- Live now: 2 real paid orders have no entitlement. One is $32 "UnderwriteIQ soft-pull assessment". One is $1,000 "Consulting Services Standard". Every check is green.
- `portal:paid-entitlement` says it left out "3 under a product name that matches no product".
- Both also skip a payment with no client id.
- The money handler returns quietly when it cannot write a sale (`no_sale`, one console warning, `src/handlers/money-chain.mjs`).
- I could not prove those 2 orders were meant to get an entitlement. The check cannot tell either way.

**G1.**
- `login` only loads `/login.html`. `reg:auth/login` is a GET ping.
- `gap:auth-staff-login` goes red only if no staff has a password, or 5 or more fails from 2 or more emails with 0 wins.
- Live: 4 active closers, 2 with a password. The row says "Active staff logins: 11" and passes.

**A9 (and F1, same row).**
- `gap:sms-journey-zero` is one row for 6 steps. I ran it live. It is red today for the welcome text (2 leads, `entry.captured`). A booking-text break cannot turn it red. It stays red for up to 7 days.
- It joins only approved templates. If `SMS-S04-01-CONFIRM` is un-approved, `sendTemplated` sends nothing and says `template_pending` (`src/workflows/messaging.mjs`). The check then cannot see the step. Nothing watches template approval for sales texts. Both texts are approved today.
- Still good: `pipeline:outbound` (5 minutes) and `gap:sms-provider-failed`.

### One "missing" row is not missing

- **E6** is weak, not missing. `gap-jobs:failed-events` goes red when the money handler throws for a real customer. Proof it fires: `onDepositPaidMoney` threw 21 times on 2026-08-21 ("null value in column product_id"). Those rows are on test addresses, which the check counts and leaves out. Still blind: the quiet `no_sale` return. I would also call E6 money, not staff-only. The sale row feeds the closer's pay.

I looked for hidden checks for A2, A6, A10, A14, A16, B5 and E4. I searched `src/pulse` for the calendar vendor, meeting links, the confirm and no-show emails, cancel and move, and refused posts. I found none. One partial: `calls:booking-webhook` already catches a verified post that has an email but made no booking event. It does not see a refused post (401), or a post with no email. A booking post with no email did arrive on 2026-09-26 at 04:41 UTC (just after a test booking), and nothing noted it.

### Small fixes to the map's notes

- `reg:contracts` is one id on two rows. It does not hide a red. Both rows print. It only mixes up the "days red" counter.
- A19: the `gmail` row can go red when the Gmail login is dead. It is "skip" when the login is not set. What ends normal with `gmail_not_ready` is the job row.
- A5 is a door check. It proves the route is mounted and refuses an unsigned post. It does not prove a real signed post is accepted.

### Steps the map skipped

| step | checks | status | impact | why |
|---|---|---|---|---|
| M1 Chargeback or refund makes an owner task with the vendor's due date | none | missing | money | `src/handlers/commas-disputes.mjs` makes the task from `payment.disputed` and `payment.refunded`. A missed due date forfeits the dispute. No file in `src/pulse` mentions disputes, chargebacks or refunds. |
| M2 Card declined on a pay link | none | missing | money | `onPaymentFailed` only saves a failed row (`src/handlers/client-lifecycle.mjs`). No text, no task. 4 real failed notices. Newest 2026-10-01, on a diagnostic link with a client. |
| M3 Hand-off from the app to the workflow engine | `gap:sms-journey-zero` | weak | money | `src/events/bus.mjs` sends with `void inngest.send(...).catch(() => {})`, and only when `INNGEST_EVENT_KEY` is set. A failure is swallowed (`docs/journeys/booking-notifications-flow.md`, section 7). At least 11 sales workflows start from it. `gap:sms-journey-zero` reads only 3 text steps. I did not test the live key. |
| M4 Customer replies YES, RESCHEDULE or CLOSE to a sales text | `40-more:dpc-03-inbound-reply-router` | weak | money | 282 real inbound messages, newest 2026-10-07. The only row says "not checked". The webhook lane probes `twilio-status`, not the inbound door `twilio`. YES makes a send-contract task. RESCHEDULE sends the booking link. |
| M5 Customer opens the soft-pull link the closer sent | `soft-pull:approve-page`, `soft-pull:approve-read`, `soft-pull:approve-signed-read` | covered | money | Deep. It checks the page, the unsigned answer, and a signed read that returns the words and price. I ran it live: 3 pass. |
| M6 Closer sends the contract and the signing email is written | `reg:contracts`, `contracts:sent-unsignable` | weak | money | `src/contracts/notify.mjs` says the contract still counts as sent when the email cannot go. `CONTRACT-SEND-EMAIL` and `CONTRACT-REMIND-EMAIL` are approved today. No check reads them or the email row. |
| M7 Leads turn into bookings | none | missing | money | No check compares one step to the next. Ad spend ran every day 2026-09-28 to 2026-10-04 (about $707). 128 real new leads and 81 real survey posts came in over 14 days. The last real booking was 2026-09-04. Ads show $0 on 10-06 and 10-07. The pulse cannot say if that is normal. |

### What the map got right

- Every check id it named exists. I looked up each one.
- The counts match the rows: 49 steps, 19 / 8 / 14 / 8.
- 31 of 36 sales slice rows say "not checked". I re-ran them live. Same.
- Only `pipeline:outbound` from the sales path reaches the 5-minute watch.
- `live-playwright:desks` will read red at 6 a.m. on Oct 9 (about 39 hours old, limit 26). Nothing on this Mac schedules it.
- Zero real bookings in 35 days, 0 meeting links on 49, 25 real deposits with no client id. All true.

Ruling: confirmed = false.
