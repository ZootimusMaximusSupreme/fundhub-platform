# Heartbeat map, group 02: launch funnels

Fundhub. Read only. Nothing was fixed, changed, shipped or sent. Date of the look: 2026-10-09 (night of 10-08).

## What this covers

The three offers we sell, from ad click to paid to delivered.

| Area | Journey doc it comes from |
|---|---|
| 1. SLO funding roadmap (the paid page at apply.fundhub.ai/roadmap) | `slo-offer-intended.md`, `slo-offer-actual.md`, plus `slo-roadmap-widget-flow.md` (the doc that matches the live page) |
| 2. SLO connections (a ClickFunnels paid order becomes a purchase) | `slo-connections-intended.md`, `slo-connections-actual.md` |
| 3. Climate lead magnet and the $32 unlock | `climate-lead-magnet-intended.md` (there is no `-actual.md`) |

Not scored here: the free apply funnel (`/watch`, `/apply`, `/thank-you`). `funnel:watch`, `funnel:thank-you` and `funnel:apply-form` read those pages. They belong to another group.

## The count

45 steps looked at.

| Status | Steps |
|---|---|
| covered | 18 |
| ping-only | 8 |
| weak | 7 |
| missing | 12 |

19 of the 45 are holes where a paying customer is blocked or we lose money (money: 14, customer-blocked: 5). 8 more are staff-only or internal holes (the climate rows are internal because that page is not live).

## What I found, in plain words

- The page checks are good. A bad page push gets caught.
- The money steps are thin. Nothing tests that a card page can be made. Nothing tests that Commas still trusts our key.
- A paid buyer's soft pull can fail and nothing goes red. No check reads the pull table.
- Every "he left his email and did not pay" text, and the "you paid, fill the form" nudge, says "not checked" forever. They can never go red.
- Nobody opens the page in a real browser. The one browser sweep is run by hand, skips /roadmap, and is already stale.
- The climate lead page is not live. The lead form and the $32 unlock were pulled on 2026-09-18. Today `/climate/` is the dashboard.
- The ClickFunnels order path has never fired. It has 0 maps, and no ClickFunnels order has ever arrived.

## Facts about today that change how to read this

- The live price is $147, with $297 crossed out. The journey docs say $297.
- No one has paid on this page yet. 15 checkout links were made. All 15 still read "sent". The newest is 2026-10-02.
- All 7 ads are paused. From 3 to 6 Oct there were 55 person visits and 0 contact starts. The last one was 2026-10-02.
- Only one soft pull has ever been recorded (fulfilled, 2026-09-30). There are 4 real credit results.
- The coverage rows (gap lanes and slice rows) were shipped on 2026-10-08. The 6 a.m. run on 2026-10-09 is the first one that carries them. Until then none of them has gone red in production.
- The 5-minute watch reads only five things: `health`, `login`, `apply`, `funnel:roadmap-sales`, `pipeline:outbound`. Nothing else here trips fast.

## How to read the ids

- A lane check is written as the lane writes it. In the morning text a lane id that does not start with its lane name gets `gap-<lane>:` in front. Example: `funnel:roadmap-checkout` reads `gap-funnels:funnel:roadmap-checkout`.
- A slice row reads `<slice>:<id>`. Example: `19-slo:slo-genuine-followup`.
- `reg:` rows are page and route pings (red means "down" on a 404, a 5xx, or no answer). `job:` rows are "did it run in 3 times its schedule".
- covered = a deep check exists and would go red within one morning. ping-only = only a door answer or a "job ran" row. weak = a check exists but only part of the step, or it can only say "not checked". missing = nothing would go red.
- trips: `5min` = the 5-minute watch texts Chris. `6am` = it shows in the morning text. `none` = nothing.

## 1A. SLO roadmap: from the ad to the card box

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 1.1 Ad link opens the sales page, apply.fundhub.ai/roadmap | `funnel:roadmap-sales` | deep | yes: red if the page is down, or the checkout anchor or the offer words are gone | 5min + 6am | covered | money |
| 1.2 Old links fundhub.ai/roadmap and /slo hop to the sales page | none (the registry skips `roadmap/index.html` on purpose) | none | no: nothing reads the redirect; ads skip it (they link to apply.fundhub.ai), so only old links break | none | missing | customer-blocked |
| 1.3 Pixel, Clarity and tracking scripts load on the page | `pixel-on-own-pages`, `pixel-on-funnel-page`, `tracking-scripts-live`, `clarity-snippet` | deep | yes: red if a tag, a script file or the Clarity id is gone | 6am | covered | money |
| 1.4 Step 1 saves the contact before Pay (POST slo-interest) | `reg:public/slo-interest`, `utm-capture-route`, `funnel-click-stored` | ping | partly: the GET ping goes red if the door dies; nothing reads a saved contact; the click check waits 7 days | 6am | ping-only | money |
| 1.5 The page and the till agree: widget calls the till, till is ready and not in demo, page shows the price the till charges | `funnel:roadmap-checkout` | deep | yes: red if a call is missing, the till is not ready, demo is on, or the price differs | 6am | covered | money |
| 1.6 The browser may call the till from apply.fundhub.ai (the cross-site rule in `src/slo/cors.mjs`) | none | none | no: the check sends no Origin header, so a blocked call looks fine | none | missing | money |
| 1.7 Pay press makes the Commas card session and the card box loads | `reg:public/slo-checkout`, the "ready" test inside `funnel:roadmap-checkout` | ping | no: "ready" only means the key is set; a dead key still reads ready; a failed make leaves a checkout event with no order row (3 on 2026-09-25) and nothing reads that | 6am | ping-only | money |
| 1.8 A real browser walks the widget: step 1, card box, step 3 | `live-playwright:desks` | none for this page | no: the sweep never opens /roadmap; it is run by hand; last pass was 2026-10-07 21:40 UTC, so it reads red for age | 6am | missing | money |

## 1B. SLO roadmap: taking the money

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 1.9 Commas webhook door is mounted | `webhooks:commas`, `payments:commas-webhook-route` | deep | yes: red if the route is gone; 6 a.m. only (a whole-site outage trips `health` at 5 min); Commas never retries, so a payment lost in a gap leaves no trace | 6am | weak | money |
| 1.10 Commas still signs with the key we hold | none | none | no: the probe uses a throwaway key, and a refused post leaves no row (the router saves only accepted ones) | none | missing | money |
| 1.11 The payment is stored and settled: inbox, payment.received, link paid, transaction row | `job:commas-inbox-drain`, `job:commas-inbox-sweeper`, `webhooks:stuck-failed`, `payments:pay-link-webhook` | deep | yes: red if the sweeper stops 3 minutes, an inbox row gives up, or a link stays open after money landed | 6am | covered | money |
| 1.12 The payment becomes a sale / access record | `payments:paid-no-entitlement`, `portal:paid-entitlement` | deep | blind: "Consulting Services Assessment" matches no product, so the first never sees it; the second likely goes red on any real sale for the wrong reason | 6am | weak | money |
| 1.13 The purchase is sent to Meta so ads learn who bought | none (`meta-server-events` reads page events only) | none | no: the send result is saved on the payment event and nothing reads it | none | missing | money |

## 1C. SLO roadmap: after paying (pull, pack, portal)

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 1.14 Step 3: the live widget posts the pull form and polls the status | `offer:roadmap-pull`, `reg:roadmap-pull`, `reg:public/slo-status` | ping | partly: they read the old pull.html page and the door; the widget's own slo-pull and slo-status calls are not read; slo-status answers 400 to a bare GET | 6am | weak | customer-blocked |
| 1.15 Paid, but never filled the pull form | `consent:required`, `19-slo:slo-paid-form-nudge` | deep | yes: red when a paid client has no consent and no pull 24 hours after paying; the 15-minute nudge says "not checked" | 6am | covered | customer-blocked |
| 1.16 Identity saved means consent saved | `consent:slo-store` | deep | yes: red when an order saved identity over 1 hour ago and has no consent row | 6am | covered | customer-blocked |
| 1.17 The soft pull runs and a file comes back (diagnostic.paid, C-00, CRS) | `26-client-journey:c-00-crs-soft-pull-request`, `failed-events` | none | no: the first is "not checked" (event); `failed-events` sees only a handler that throws; nothing reads the pull table | none | missing | customer-blocked |
| 1.18 The pack is built: 4 documents plus the bonus map | `uw-paid-roadmap-no-pack`, `uw-offer-fulfillment-failed` | deep | yes: red if a pull finished 2+ hours ago with no pack, or the pack job failed; blind if the pull never finishes (1.17) | 6am | covered | customer-blocked |
| 1.19 The pack email and the sign-in link reach the buyer | `email:sending-stuck`, `email:provider-fail`, `email:magic-link-unqueued`, `pipeline:outbound`, `job:message-dispatch-sweeper` | deep | partly: red if a mail sticks, fails, or a sign-in has no mail; nobody checks a pack email was queued at all | 5min (`pipeline:outbound`) + 6am | weak | customer-blocked |
| 1.20 The buyer opens the portal and sees the pack | `portal:page`, `portal:summary`, `reg:client-portal` | ping | no: they read the newest client, not this buyer's pack | 6am | ping-only | customer-blocked |
| 1.21 Repair plan offer after a repair result (POST slo-repair-checkout makes a Commas link) | none (the door is excused as POST-only) | none | no: only `reg:public/slo-status` is pinged for this offer | none | missing | money |

## 1D. SLO roadmap: booking the call

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 1.22 Book a call: roadmap-book page and the framed calendar | `funnel:roadmap-book`, `funnel:funding-book-call` | deep | yes: red if the frame, the calendar box or the booking form is gone | 6am | covered | money |
| 1.23 The booking reaches us: ClickFunnels door, then a bookings row | `webhooks:calendar-booking`, `webhooks:clickfunnels`, `calls:booking-webhook` | deep | yes: red if the door is gone or an accepted booking has no bookings row; a bad secret is the blind spot from 1.10 | 6am | covered | money |
| 1.24 A booked call reaches the closer | `calls:booked-no-outcome` | deep | late: red only after the call time has passed with no outcome | 6am | weak | money |
| 1.25 Thank-you page after booking | `funnel:roadmap-thank-you` | deep | yes: red if the page or its next-step block is gone | 6am | covered | internal |

## 1E. SLO roadmap: follow-up texts and emails, and the numbers

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 1.26 Follow-up when someone left details and did not pay: 15-minute text and email, $197 note, checkout text, reply | `19-slo:slo-genuine-followup`, `19-slo:slo-no-reply-197`, `40-more:slo-genuine-checkout-sms`, `40-more:slo-genuine-reply` | none | no: event rows always say "not checked"; they are never red | none | weak | money |
| 1.27 Roadmap drip email, daily 8 a.m. Arizona | `job:slo-infinite-drip`, `19-slo:slo-infinite-drip`, `email:drip-step-no-email`, `email:morning-no-failure-check` | deep | yes: `email:drip-step-no-email` is red now (1 person, 3 steps, no email); the job rows go red after 3 days of silence | 6am | covered | money |
| 1.28 Welcome text on a new SLO lead | `gap:sms-journey-zero` | deep | yes: red now (2 steps with no text row) | 6am | covered | money |
| 1.29 Texts and emails leave the building | `pipeline:outbound`, `gap:sms-sending-stuck`, `gap:sms-provider-failed`, `email:sending-stuck`, `email:provider-fail`, `job:message-dispatch-sweeper` | deep | yes: red if a row waits 30 minutes, sticks on sending, or the phone or mail company refuses it | 5min (`pipeline:outbound`) + 6am | covered | money |
| 1.30 STOP and unsubscribe are honored | `opt-out:stop-did-not-stick`, `opt-out:send-ignores`, `opt-out:unsubscribe-link`, `opt-out:table-unreadable` | deep | yes; `opt-out:unsubscribe-link` reads red on the laptop only, where the secret is hidden | 6am | covered | money |
| 1.31 Ad numbers and ad clicks land | `meta-sync`, `ads-meta-sync-stale`, `ads-spend-day-missing`, `ads-number-unmapped`, `ad-click-stored` | deep | yes; `ad-click-stored` skips under 20 Meta clicks (skipping now, all 7 ads are paused) | 6am | covered | money |
| 1.32 Visitors arrive and nobody starts | none | none | no: nothing compares visits to starts; today's volume is too small for a rate rule | none | missing | money |

## 2. SLO connections: a ClickFunnels paid order becomes a purchase

This path is asleep. `SLO_POST_PURCHASE_ENABLED` is off, there are 0 connection maps, and in 904 saved ClickFunnels posts there are surveys (491), bookings (56) and 357 others. No order or purchase body.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 2.1 Owner opens Products and Commissions, SLO connections tab | `reg:products-commissions`, `reg:read/slo-connections`, `reg:slo-connections` | ping | yes: red on a 404 or 5xx | 6am | ping-only | staff-only |
| 2.2 ClickFunnels webhook door is mounted | `webhooks:clickfunnels`, `funnel:apply-form` | deep | yes: red if the route is gone; the same door carries the apply form and bookings | 6am | covered | money |
| 2.3 ClickFunnels still signs with the key we hold | none | none | no: same blind spot as 1.10 | none | missing | money |
| 2.4 A signed paid order becomes one purchase on the right client | none | none | no: the code answers 200 and writes nothing when the map is missing or off | none | missing | money |
| 2.5 After-sale stamp and CSM task (flag is off) | none | none | no: nothing runs while the flag is off | none | missing | internal |

## 3. Climate lead magnet and the $32 unlock

Not live as described. The lead form, the bank count and the $32 gate were pulled on 2026-09-18 (commit `f39cec35`). Today `/climate/` is the Darwin dashboard. No page calls `POST /api/public/climate-match`. `docs/tracking/page-inventory.md` says "Spec and mock only. Not deployed." There are 0 climate leads in the database. Rows are internal until the page ships.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Customer impact |
|---|---|---|---|---|---|---|
| 3.1 The dashboard page loads | `reg:climate-index`, `reg:climate-lender-climate-index` | ping | yes: red on a 404 or 5xx; a blank page still reads up | 6am | ping-only | internal |
| 3.2 The map data answers (/api/climate, config, geocode) | `reg:climate`, `reg:climate/config`, `reg:climate/geocode` | ping | yes: red if a route dies; nothing reads the 51 states or the national score | 6am | ping-only | internal |
| 3.3 A real browser walk: map paints, national score reads, a state opens | `live-playwright:desks` (runs `e2e/live-climate.spec.mjs`) | deep | yes, but the sweep is run by hand and reads red for age | 6am | weak | internal |
| 3.4 The bank book is not empty | `funding:lender-book`, `crm-data:lenders` | deep | yes: red if no active bank, or the bank read fails | 6am | covered | internal |
| 3.5 The lead form gives a count and files the lead (POST climate-match) | `reg:public/climate-match` | ping | no: the ping reads the book size; the POST is never run; no page posts it | 6am | ping-only | internal |
| 3.6 A climate lead gets the welcome text | `gap:sms-journey-zero` | deep | yes: the same check as 1.28; no climate lead exists yet | 6am | covered | internal |
| 3.7 The $32 gate makes a Commas checkout (POST optimize) | `reg:public/optimize`, `offer:optimize`, `offer:optimize-plan` | ping | no: they read page hooks and the door; no page calls the POST today | 6am | ping-only | internal |
| 3.8 After the $32 is paid the soft pull runs | none (same as 1.17) | none | no | none | missing | internal |

## Doc problems

- `slo-offer-intended.md` says $297, a pay page, a Commas page, then a pull page. The live page is a three-step widget on apply.fundhub.ai/roadmap. The card comes first, then the pull. The price is $147.
- `slo-offer-actual.md` still draws the pay.html path and says the ClickFunnels page "still has to publish". The page is live. Its price is $297.
- `slo-roadmap-widget-flow.md` (2026-09-27) is the doc that matches the live widget. It is not on the tracked journey list.
- `climate-lead-magnet-actual.md` does not exist. `climate-lead-magnet-intended.md` describes a page that was pulled the day it was built. `optimize-actual.md` (2026-09-17) says nothing calls `POST /api/public/optimize`. The climate doc says the gate calls it. Today nothing does.
- `slo-connections-*` match the code. The path has never fired.

## How I checked

- I read `src/pulse/daily-pulse.mjs`, `registry.mjs`, `heartbeats.mjs`, `instant-watch.mjs`, `funnel-doors.mjs`, `machine.mjs`, the slice and gap files, and the handlers they watch.
- Every id above was found by grep in `src/pulse`.
- I re-ran 8 lanes live and read-only (funnels, payments, webhooks, pixels, underwrite, consent, email, sms): 0 SQL errors, 0 write attempts. I ran the slice rows 19, 26, 40, 12, 18 and 05 the same way. Every event and door slice row came back "not checked".
- Live reads: `GET /api/public/slo-checkout` (price 14700, ready true, demo false), the apply page, the redirects (both 301 to the apply page), the climate page title.
- SQL reads (BEGIN READ ONLY): payment links, SLO events by day, soft pull and credit result counts, ClickFunnels capture kinds, climate leads, connection maps, job heartbeat times, the keep-title product join.

## Checker — 2026-10-09

Read only. I wrote nothing else. Verdict: the map is mostly right, but not all of it. 2 "covered" rows are too kind, 1 has a false claim inside it, and 5 steps were skipped. I found no hidden check for any of the 12 "missing" rows.

### New count

| Status | Mapper | After my look |
|---|---|---|
| covered | 18 | 16 |
| ping-only | 8 | 8 |
| weak | 7 | 8 |
| missing | 12 | 13 |

### Rows I changed

- **1.3 covered becomes weak.** On `/roadmap` only the Meta pixel is read (`pixel-on-own-pages`). `clarity-snippet` and `tracking-scripts-live` read `/watch`, not `/roadmap`. The live `/roadmap` loads `fh-attribution.js` (3 times), `fh-events.js` and `vsl-watch-beacon.js`. If a push drops them, nothing goes red. That is the script that ties a sale to an ad.
- **1.28 covered becomes missing, for the SLO page.** `gap:sms-journey-zero` watches `entry.captured`. That event comes from the ClickFunnels apply survey. An SLO page lead sends `slo.contact_started` and never `entry.captured`. The "red now" rows are 2 ClickFunnels events from 2026-10-02. They fall out of the 7-day window on 2026-10-09 evening with no fix. The four SLO texts (`slo-genuine-followup`, `slo-no-reply-197`, `slo-paid-form-nudge`, `slo-genuine-checkout-sms`) are not in that check's list.
- **1.18 stays covered, but the bonus claim is false.** `uw-paid-roadmap-no-pack` reads the 4 pack files only. The code says "a bonus file is not the pack". The free Business Duplication Map is not read by any check.
- **1.7 small fix.** I count 5 checkout events with no order row on 2026-09-25, not 3. They are marked demo on the event row, so they are test runs. I found 0 real-person cases. The gap is real in the code (the event is written before the Commas make, the order row after). It has only shown in tests.

### What I checked and it held

Id exists, code read, and it would go red if the step broke: 1.1, 1.5, 1.11, 1.15, 1.16, 1.22, 1.23, 1.27, 1.29, 2.2. Also the live hole facts: till price is $147, `ready` only means the key is set, refused webhook posts leave no row, the keep title and the till name both resolve to no product, the live sweep last passed 2026-10-07 21:40 UTC and has no schedule, no spec opens `/roadmap`, and `soft_pull_requests` has 1 row.

### Warnings on rows that stay "covered"

- **Nothing after the card has ever seen a real sale.** There are 0 paid `slo_` links and 0 clients with `crs_paid`. 1.11, 1.15, 1.16 and 1.18 pass because there is nothing to count. They are proven by code and tests only.
- **Page checks read words, not a running page.** 1.1, 1.5, 1.22 and 1.25 pass if the right text is in the HTML. A page with a broken script and the right words stays green. Only the missing browser walk (1.8) would catch that.
- **1.5 price check has a gap.** It passes if the page contains the till price. The page has `$297` struck through, so if the till flips back to `$297` it still passes while the headline says `$147`.
- **1.9, 1.23 and 2.2 share one blind spot.** If the sender stops posting at all, there is no row and nothing is red. No check asks "when did we last accept a post".
- **1.30 cannot see a dead inbound text door** (see S3 below).

### Steps the mapper skipped

| # | Step | Status | Impact | Why |
|---|---|---|---|---|
| S1 | The sales page videos play: `fundhub.ai/funnel/slo-vsl.mp4`, its poster, and 3 testimonial mp4s | missing | money | The live page loads them from fundhub.ai. No pulse file names any mp4. All 5 answer 200 today. |
| S2 | Step 1 and step 3 contact is copied into the ClickFunnels contact Paul uses (`src/slo/cf-contact.mjs`) | missing | money | The newest real lead (2026-10-02 22:43) shows `cf_contact` `ok:false`, 422 "Email address has already been taken". Nothing reads that field. |
| S3 | Reply texts and STOP come in: `POST /api/webhooks/twilio` | missing | money | `webhooks:twilio-status` is the status callback only. The inbound branch is never probed. A dead door means no STOP rows and no $197 reply, and `opt-out:*` stays green. 05-fulfillment found the same gap. |
| S4 | The event reaches Inngest after it is saved | missing | customer-blocked | `emit` in `src/events/bus.mjs` sends to Inngest without waiting and swallows errors. The pull (C-00), the pack, and the follow-ups all start there. A lost send leaves a saved event and no run, with no row. This is a second cause for 1.17. |
| S5 | A chargeback or refund on a roadmap sale | missing | money | `src/handlers/commas-disputes.mjs` makes a task with a response deadline. Miss it and the dispute is lost. No pulse check reads that task. Not in a journey doc. |

### Doc note

`slo-offer-actual.md` and the widget doc both still say `$297`. Live is `$147`. I did not edit them.
