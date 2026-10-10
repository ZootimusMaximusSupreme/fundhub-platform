# Heartbeat map — group 01-client

Written 2026-10-08 (late evening, Arizona) by the coverage audit (read-only). Group: the client journey.
Files read: docs/journeys/client-intended.md, client-actual.md, client-progress-actual.md, paid-round-actual.md, deliverables-actual.md.
Checked against: src/pulse (registry, heartbeats, daily-pulse, instant-watch, machine, pipeline-motion, slice-*, gap-*), the live database (read-only) and the last built-bundle lane runs.

## The short answer

**No. The client journey does not have a tripwire on every step.**
83 steps mapped. 45 are covered. 14 are ping-only. 10 are weak. 14 are missing.
The doors are well watched. The money steps in the middle are not.

Biggest holes, in plain words:
- A buyer pays the $297 and never fills the pull form. Nothing goes red (step 11).
- A buyer fills the form but the credit pull fails or never starts. Nothing goes red (step 18).
- Commas takes a card but never calls us. No row exists, so nothing can go red (step 8).
- The paid round ($100 and up) has no wired handler and no check. A paid round would sit open and be cancelled 7 days later (steps 46 to 50).
- The "pack is ready" email has no tripwire. There are 0 delivery emails on live, ever (step 23).
- People still visit the funnel (429 person events on 10-03, 166 on 10-05) but there is no new lead since 2026-10-02 22:45 UTC. Nothing asks why (step 3).
- The progress page can show blank or wrong data and still answer 200 (step 38).

## How to read this file

- **Depth.** deep = reads data or runs the real code and can go red when the customer result is wrong. ping = only proves a door or page answers. none = nothing.
- **Trips.** 5min = the instant watch (src/pulse/instant-watch.mjs) texts within 5 minutes. 6am = the morning pulse. none = nothing would trip.
- **Status.** covered = a deep check goes red inside one morning. ping-only = only a door or job-ran check. weak = a check exists but cannot see this break. missing = nothing.
- **Impact.** money = we lose a sale or a payment. customer-blocked = a paying customer cannot get what they paid for. staff-only = an internal screen. internal = nobody outside sees it.
- A step that is only a door (is the app up?) can be covered by a ping, because the door is the break.
- Check ids: reg:<key> is a page or route ping. job:<name> is a "has it run" row. A bare id like portal:summary is a lane check. Lane ids that do not start with the lane name show on the scorecard with a prefix (uw-paid-roadmap-no-pack shows as gap-underwrite:uw-paid-roadmap-no-pack).
- The live data is thin: 61 clients (3 demo), 0 paid roadmap links out of 15, 1 pack ever, 1 soft pull ever. A lot of green is green because nobody has done the step yet. I judged the check logic, not the colour.
- The gap lanes shipped 2026-10-08 18:44 (81b50d23). The first 6 a.m. run with them is the next one.

## What the five journey docs are worth

| Doc | Date | Verdict |
|---|---|---|
| client-intended.md | 2026-08-02 | **Stale and not a step list.** Route groups only: 15 reachable, 73 blocked. It says itself it was copied from the route data, not written by a human. No apply, pay, pack, progress or paid-round steps. |
| client-actual.md | 2026-10-06 | Current for routes (55 reachable, 268 blocked of 323). Route list only, no steps. |
| client-progress-actual.md | 2026-09-29 | Good for the progress read. Traced from code. |
| paid-round-actual.md | 2026-09-08 | **Stale on one point.** It says there is no button. public/progress.html now posts to /api/paid-services. The handler is still not on the bus. |
| deliverables-actual.md | 2026-10-02 | Good. The delivery-email path is not drawn in it. |

There is no client-progress-intended, paid-round-intended or deliverables-intended file. The *-flow.md files are design notes, not the owner's intended journey. So the step list below is built from the four actual docs, slice 26 and the code. I did not invent steps.

## 1. Find us, apply, and buy the $297 roadmap

Docs behind it: client-actual.md (public/slo-*, survey-submit, funnel-checkout), slice 26 Apply and Pay. The client-intended file has no steps for this.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 1 | Ad lands on the video, apply and sales pages | `funnel:roadmap-sales`, `funnel:watch`, `funnel:apply-form`, `reg:home`, `reg:start` | deep | yes — red if a page loses its order button, offer words or survey form | 5min | covered | money |
| 2 | Apply form still posts to us (ClickFunnels hook) | `funnel:apply-form`, `webhooks:clickfunnels`, `webhooks:calendar-booking`, `offer:home-survey`, `reg:public/survey-submit` | ping | yes — red if the page loses its form post or the hook is gone. no — blind if the post breaks after it arrives | 6am | ping-only | money |
| 3 | A lead who applies becomes a client record (entry.captured) | none | none | no — nothing counts new leads. People still visit (429 person funnel events on 10-03, 166 on 10-05) but 0 leads since 10-02 22:45 UTC. A break or a quiet week? Nothing says | none | missing | money |
| 4 | Welcome text after apply | `gap:sms-journey-zero` | deep | yes — red if a step that should text has no text row. It is red now: a lead from 10-02 got no welcome | 6am | covered | money |
| 5 | Sales page shows the right price and Pay is wired | `funnel:roadmap-checkout`, `reg:public/slo-checkout`, `reg:public/slo-interest`, `reg:public/slo-status` | deep | yes — red if the till is not ready, is in demo mode, shows another price, or the Pay call is gone | 6am | covered | money |
| 6 | Pay button makes a Commas checkout link | `funnel:roadmap-checkout` | ping | no — it reads setup only and never makes a link, so a Commas refusal goes unseen | none | weak | money |
| 7 | Commas takes the card; we record it and close the order | `payments:pay-link-webhook`, `webhooks:stuck-failed`, `webhooks:commas`, `job:commas-inbox-drain`, `job:commas-inbox-sweeper` | deep | yes — red if a recorded payment left the order open, an inbox row is stuck, or the 1-minute job stops | 6am | covered | money |
| 8 | Commas takes the card but never calls us | none | none | no — no row exists anywhere to read. The payments check file says so itself | none | missing | money |
| 9 | Payment unlocks what they bought | `portal:paid-entitlement`, `payments:paid-no-entitlement`, `failed-events` | deep | yes — red if a paid sale has no unlock row, or the code that handles the payment crashed | 6am | covered | money |
| 10 | Pay, thank-you and pull-form pages load | `reg:payment-success`, `reg:roadmap-pay`, `reg:roadmap-pull`, `offer:roadmap-pay`, `offer:roadmap-pull` | deep | yes — red if a page goes down or loses its form post | 6am | covered | customer-blocked |
| 11 | Buyer paid but never finishes the pull form | `19-slo:slo-paid-form-nudge` | none | no — the nudge row says not checked. consent:required only sees clients the pull form already marked paid. 15 roadmap links on file, 0 paid, never tested | none | missing | customer-blocked |
| 12 | Buyer sends identity and consent on the pull form | `consent:slo-store` | deep | yes — red if an identity was saved in the last 7 days with no consent. A post that saves nothing is the row above | 6am | covered | customer-blocked |

## 2. Consent and the credit pull

Docs behind it: client-actual.md (consent/capture, finance/soft-pull, soft-pull-approve), slice 26 Funding. The pull never runs from the pulse (rule: never live CRS).

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 13 | Consent page loads and saves | `consent:page`, `reg:consent/capture`, `reg:consent-capture` | deep | yes — red if the page is gone or stops calling the save door | 6am | covered | customer-blocked |
| 14 | Paid client with no consent on file (CRM path) | `consent:required` | deep | yes — red 24 hours after a paid client with no pull has no live consent | 6am | covered | customer-blocked |
| 15 | Signed soft-pull paper has its consent row | `consent:store` | deep | yes — red if a signed paper has no consent row | 6am | covered | customer-blocked |
| 16 | Repair client has a dispute OK or a signed agreement | `consent:dispute-required` | deep | yes — red if an active repair client past 7 days has neither | 6am | covered | customer-blocked |
| 17 | Emailed approve link opens and reads | `soft-pull:approve-page`, `soft-pull:approve-read`, `soft-pull:approve-signed-read`, `reg:soft-pull-approve` | deep | yes — red if the screen is wrong or a signed read fails to return words, price and consent state | 6am | covered | customer-blocked |
| 18 | Credit pull runs and finishes after consent (C-00 to the bureau) | `15-repair:c-00-crs-soft-pull-request`, `failed-events` | none | no — C-00 stops quietly if there is no account, no consent or the pull fails. The failure is saved on a soft_pull_requests row that no check reads. failed-events only sees a crash | none | missing | customer-blocked |

## 3. The pack (deliverables-actual.md)

The scorecard shows lane ids as written, except ids that do not start with the lane name get a prefix (uw-... shows as gap-underwrite:uw-...).

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 19 | Pack saved after the pull (4 core files) | `uw-paid-roadmap-no-pack` | deep | yes — red if a roadmap buyer's pull ended 2 hours ago and none of the 4 core files exist | 6am | covered | customer-blocked |
| 20 | Pack has every file (4 core + summary + guide + duplication map) | none | none | no — red only when all 4 core files are missing. Summary, guide and map are never read. The printer can drop a file with no trace | none | missing | customer-blocked |
| 21 | Pack build crashes | `failed-events`, `uw-offer-fulfillment-failed` | deep | yes — red if the build crashed (failed-events list) or the client is stamped 'Delivery Failed' | 6am | covered | customer-blocked |
| 22 | Letters exist when the file has inquiries or bad items | `uw-letters-missing` | deep | yes — red if a file with inquiries or an open dispute case has no letter | 6am | covered | customer-blocked |
| 23 | 'Your pack is ready' email is queued to the buyer | `uw-offer-fulfillment-failed` | deep | no — a background job (Inngest) sends the email. Its in-app twin onAnalysisCompletedSloPack is not turned on, so a miss leaves no trace. 0 delivery emails ever on live | none | weak | customer-blocked |
| 24 | Hold or fraud tier gets a notice instead of a pack | none | none | no — nothing is built and nothing is read on that branch | none | missing | internal |

## 4. Sign in and the portal

Docs behind it: client-actual.md (auth/*, read/portal-summary, read/entitlements, read/portal-contracts, chat, push, content).

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 25 | Login pages load | `login`, `reg:login`, `reg:portal-login`, `reg:reset-password` | ping | yes — red if login.html loses its sign-in words (5 min). portal-login is only a page-up check | 5min | ping-only | customer-blocked |
| 26 | Client signs in with a password | `gap:auth-session-read`, `reg:auth/login`, `reg:auth/session` | ping | no — it only proves the sign-in tables can be read and written. Client sign-ins are never counted or tried. gap:auth-staff-login is staff only | 6am | weak | customer-blocked |
| 27 | Magic link email goes out | `gap:auth-magic-link-dead`, `email:magic-link-unqueued`, `email:provider-fail`, `email:sending-stuck`, `pipeline:outbound` | deep | yes — red if a link has no email, it bounced, it sticks in sending, or it waits over 30 minutes | 5min | covered | customer-blocked |
| 28 | Magic link click makes a session | `gap:auth-signin-no-session`, `reg:auth/magic-link-verify` | deep | yes — red if a used link has no client session row | 6am | covered | customer-blocked |
| 29 | Password reset email leaves | `gap:auth-reset-mail`, `reg:auth/reset` | ping | no — red only if the Resend key is missing on the server. Reset mail skips the queue, so a lost one leaves no row | 6am | weak | customer-blocked |
| 30 | Portal page loads with its tiles | `portal:page`, `reg:client-portal` | deep | yes — red on a 404 or if the tile markers are gone | 6am | covered | customer-blocked |
| 31 | Portal summary reads for a client | `portal:summary`, `reg:read/portal-summary` | deep | yes — red if any of the 5 reads fails for the newest real client. The real portal code is not run | 6am | covered | customer-blocked |
| 32 | What the client may open (entitlements read) | `reg:read/entitlements` | ping | no — a signed-out 401 counts as up. Nothing reads it for a real client | 6am | ping-only | customer-blocked |
| 33 | Contracts list in the portal | `reg:read/portal-contracts` | ping | no — a signed-out 401 counts as up | 6am | ping-only | customer-blocked |
| 34 | Chat to staff from the portal | `reg:chat/portal-message` | ping | no — page-up only. A send that breaks inside is unseen | 6am | ping-only | internal |
| 35 | Welcome video, push alerts, refer-a-friend, brand, authorized-rep file | `reg:content/welcome-video`, `reg:push/key`, `reg:push/subscribe`, `reg:affiliates/refer`, `reg:org-brand`, `reg:auth/authorized-rep-file` | ping | no — page-up only. A broken video or button inside is unseen | 6am | ping-only | internal |

## 5. Progress page and checklist (client-progress-actual.md)

Traced from api/read/client-progress.mjs and public/progress.html. Every read in that handler fails soft, so a broken source blanks one part and the page still answers 200.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 36 | Progress page loads | `reg:progress` | ping | no — page-up only (any 2xx) | 6am | ping-only | customer-blocked |
| 37 | Progress read answers (GET /api/read/client-progress) | `reg:read/client-progress`, `26-client-journey:read/client-progress` | ping | yes — red on a 404 or 5xx. no — a signed-out 401 counts as up; the slice row says not checked | 6am | ping-only | customer-blocked |
| 38 | Progress read is right: scores, stage, round, expected date, timeline | none | none | no — nothing runs the read for a real client. Wrong or blank data still answers 200 | none | missing | customer-blocked |
| 39 | Every paid checklist client and repair enrolment has a next step | `portal:next-step` | deep | yes — red if a paid blueprint buyer or repair client has no checklist rows | 6am | covered | customer-blocked |
| 40 | Tick a step off (POST /api/waypoint-tick) | `reg:waypoint-tick` | ping | no — a GET gets 405, which counts as up. The tick itself is never tried | 6am | ping-only | customer-blocked |
| 41 | Mailing-proof upload closes the mail-receipt step | `failed-events` | deep | no — red only if the code crashes. If it quietly does nothing, no red | 6am | weak | customer-blocked |
| 42 | Overdue-step nudges go out | `job:waypoint-nudge-sweeper` | ping | yes — red if the hourly job is silent for 3 hours. no — it runs but nudges nobody | 6am | ping-only | internal |
| 43 | Paying client with no progress for 72 hours | `pipeline:clients` | deep | yes — red if a paying client is past 72 hours with no move and not escalated | 6am | covered | customer-blocked |
| 44 | Timeline lines and R4/R5 states (prepared, sent, filed) | none | none | no — nothing reads them. 'filed' is false for every client by design | none | missing | internal |

## 6. The paid round (paid-round-actual.md)

paid_service_requests has 0 rows on live, so this path has never run. The Buy button is in public/progress.html (POST /api/paid-services). The handler that marks a payment is not registered in src/register-all.mjs (checked today; src/paid-services/expire.mjs says the same).

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 45 | Offer and price list load (GET /api/paid-services) | `reg:paid-services` | ping | no — page-up only | 6am | ping-only | money |
| 46 | Press Buy: request row and a hosted checkout link (POST) | none | none | no — the pulse never presses it and nothing reads paid_service_requests | none | missing | money |
| 47 | Payment for a round reaches the right request | `webhooks:commas`, `payments:pay-link-webhook` | ping | no — the door check is fine; the pay-link check reads payment_links, never paid_service_requests | none | weak | money |
| 48 | Payment marks the request paid and orders the fresh pull | none | none | no — the code that marks a payment paid is not turned on. A paid round would sit open and be cancelled 7 days later. No check sees it | none | missing | money |
| 49 | Short payment is refused and the money kept on the row | none | none | no — same code, same silence | none | missing | money |
| 50 | A staged round is worked and marked fulfilled | none | none | no — nothing moves a round from staged to fulfilled, and nothing reads the row | none | missing | customer-blocked |
| 51 | Unpaid links expire | `job:paid-checkout-expiry-sweeper`, `18-billing:paid-checkout-expiry-sweeper` | ping | yes — red if the hourly sweeper is silent for 3 hours | 6am | ping-only | internal |

## 7. Documents and contracts

Docs behind it: client-actual.md (documents-upload, documents-download, documents/:id, contracts/sign) and deliverables-actual.md section 2.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 52 | Client uploads a document | `reg:documents-upload`, `documents:upload-store` | ping | no — it proves the file store is real and the newest file is there. A broken upload door is unseen | 6am | weak | customer-blocked |
| 53 | Uploaded document is read by doc-check | `documents:stuck-processing`, `failed-events`, `job:doc-check-retry-sweeper` | deep | yes — red if a document waits over 3 days, a read is over 60 minutes late, or the read crashed | 6am | covered | customer-blocked |
| 54 | Missing documents get chased | `documents:required-unchased`, `job:document-vault-chase` | deep | yes — red if a required document is over 3 days late with no chase and no file | 6am | covered | customer-blocked |
| 55 | Open or download a saved document | `reg:documents-download`, `documents:cannot-open`, `soft-pull:approve-signed-read` | deep | no — it reads the newest 5 files from the store and signs a test link. Nobody opens a document through documents/:id | 6am | weak | customer-blocked |
| 56 | A sent contract can be signed | `contracts:sent-unsignable` | deep | yes — red if a sent contract has no signer or a bad frozen copy | 6am | covered | customer-blocked |
| 57 | Sign door and signing secret are alive | `contracts:sign-route` | deep | yes — red if a forged link gets the wrong answer or the secret is missing | 6am | covered | customer-blocked |
| 58 | Signed contract has a stored copy | `contracts:signed-not-stored` | deep | yes — red if a signed contract has no stored copy | 6am | covered | customer-blocked |
| 59 | Offer contract templates exist | `contracts:template-missing` | deep | yes — red if a live offer has no template | 6am | covered | customer-blocked |
| 60 | Unsigned contracts get chased | `job:contract-chaser` | ping | yes — red if the daily job is silent for 3 days | 6am | ping-only | internal |
| 61 | Signed contract makes the consent paper | `consent:store`, `failed-events` | deep | yes — red if a signed paper has no consent row, or the code behind it crashed | 6am | covered | customer-blocked |

## 8. After the pack: calls, repair, funding rounds

The client waits on these. Staff do the work; the client sees the result in the portal and progress page.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 62 | Book the funding call | `funnel:roadmap-book`, `funnel:funding-book-call`, `calls:booking-webhook`, `calls:calendar`, `calls:booked-no-outcome` | deep | yes — red if a booking page loses its picker or a booking has no row or no outcome | 6am | covered | money |
| 63 | Repair file gets analysed and letters made inside 1 hour | `repair-letter-round`, `fulfillment:next-action` | deep | yes — red if a file sits in analysis past its clock with no letters. Red now for one paying file (FH-000507 on the 10-08 review board) | 6am | covered | customer-blocked |
| 64 | Repair file stuck on a stage clock | `repair-case-stuck`, `pipeline:repair` | deep | yes — red if a case is past its stage clock or a card sits in a need-me stage | 6am | covered | customer-blocked |
| 65 | Bureau answer is read | `repair-case-stuck`, `15-repair:repair-bureau-response-reader` | ping | no — only silence past the clock turns red. The reader row says not checked | 6am | weak | customer-blocked |
| 66 | Funding round keeps moving | `funding:round-stuck`, `funding:advisor-queue`, `funding:submit-path` | deep | yes — red if a round or apply step sits still 72 hours | 6am | covered | customer-blocked |
| 67 | Round texts: booked, started, submitted, approved | `gap:sms-journey-zero` | deep | yes — red if a step that should text has no text row | 6am | covered | customer-blocked |
| 68 | Inquiry removal work moves and the upload door exists | `inquiry:case-stuck`, `inquiry:letter-round`, `inquiry:upload-door` | deep | yes — red if a case is still 72 hours, a letter draft is missing, or the portal lost its upload door | 6am | covered | customer-blocked |
| 69 | Accountability calls after pay and after funding | `csm:missing-step`, `csm:overdue-unassigned` | deep | yes — red if a paid or funded client has no call task, or a task is a day late with no owner | 6am | covered | customer-blocked |
| 70 | After-funding and renewal messages queue | `nurture:never-queued`, `nurture:step-stuck`, `nurture:on-without-send` | deep | yes — red if a person is missing a message a live sequence owes them | 6am | covered | money |

## 9. Texts and emails to the client

The 5-minute watch covers queued mail. Everything else here is read at 6 a.m.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 71 | Queued message waits over 30 minutes | `pipeline:outbound`, `job:message-dispatch-sweeper` | deep | yes — red if any outbound row waits over 30 minutes, or the 5-minute sender stops | 5min | covered | customer-blocked |
| 72 | Message sticks in 'sending' | `email:sending-stuck`, `gap:sms-sending-stuck` | deep | yes — red if a text or email sits in sending past 15 minutes | 6am | covered | customer-blocked |
| 73 | Phone company or mail provider fails or bounces | `email:provider-fail`, `gap:sms-provider-failed` | deep | yes — red if a text failed in 7 days or an email failed or bounced in 3 | 6am | covered | customer-blocked |
| 74 | Twilio delivery receipts reach us | `webhooks:twilio-status` | ping | yes — red if the door is gone. no — blind to a bad receipt | 6am | ping-only | internal |
| 75 | STOP and unsubscribe are honored | `opt-out:stop-did-not-stick`, `opt-out:send-ignores`, `opt-out:table-unreadable` | deep | yes — red if a STOP did not stick or an opted-out person got a message after | 6am | covered | internal |
| 76 | Email unsubscribe link can be signed | `opt-out:unsubscribe-link`, `reg:public/unsubscribe`, `reg:unsubscribe` | deep | yes — red if the signing key is missing. It is red on a laptop run only, because the laptop copy of the key is a mask | 6am | covered | internal |
| 77 | Roadmap drip emails reach each person | `email:drip-step-no-email`, `job:slo-infinite-drip` | deep | yes — red if a person moved forward a step with no email queued. Red now for one person | 6am | covered | money |

## 10. The platform under the journey

These are not client steps. Every client step above depends on them.

| # | Step | Check id(s) | Depth | Can it go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|---|
| 78 | App and database answer, migrations applied | `health`, `reg:health` | ping | yes — red on a 503 from health?strict=1 (database down or a migration pending) | 5min | covered | customer-blocked |
| 79 | A handler on the event bus throws | `failed-events` | deep | yes — red on any stuck failed-event row for a real address | 6am | covered | customer-blocked |
| 80 | An Inngest-only event workflow fails or never starts (s-01, s-02, slo-paid-form-nudge, slo-pack-delivery, f-01 to f-11) | `26-client-journey:s-01-new-lead-intake`, `26-client-journey:slo-pack-delivery`, `26-client-journey:f-01-funding-intake` | none | no — a failed run leaves no row in our database, and a failed send is swallowed. 292 of 350 slice rows read 'not checked' on live | none | missing | money |
| 81 | A new job runs that nobody put on the list | `job-heartbeats-unlisted` | deep | yes — red if a job that reported a run is not on the heartbeat list | 6am | covered | internal |
| 82 | A client can click through sign-in and the portal | `live-playwright:desks` | ping | no — the sweep clicks staff desks, funnel pages and climate. It has no client sign-in. No scheduler is set up, so it goes red from age alone | 6am | weak | customer-blocked |
| 83 | A client token cannot reach staff routes or another client's file | none | none | no — only build-time tests (auth-gate, journey generator, row security). Nothing at 6 a.m. tries a client login on a staff route or another client's file | none | missing | internal |

## 11. Route index: the 55 routes a client can reach

Every route in client-actual.md and where its check sits. Routes marked "Other groups" are open to anyone, are not client steps, and are not counted.

| Route | Where it is covered in this file |
|---|---|
| `/api/affiliates/refer` | 4. Sign in and the portal |
| `/api/auth/authorized-rep-file` | 4. Sign in and the portal |
| `/api/auth/login` | 4. Sign in and the portal |
| `/api/auth/logout` | 4. Sign in and the portal |
| `/api/auth/magic-link` | 4. Sign in and the portal |
| `/api/auth/magic-link-verify` | 4. Sign in and the portal |
| `/api/auth/reset` | 4. Sign in and the portal |
| `/api/auth/session` | 4. Sign in and the portal |
| `/api/chat/portal-message` | 4. Sign in and the portal |
| `/api/climate` | Other groups (table below) |
| `/api/climate/config` | Other groups (table below) |
| `/api/climate/geocode` | Other groups (table below) |
| `/api/consent/capture` | 2. Consent and the credit pull |
| `/api/content/welcome-video` | 4. Sign in and the portal |
| `/api/contracts/sign` | 7. Documents and contracts |
| `/api/documents-download` | 7. Documents and contracts |
| `/api/documents-upload` | 7. Documents and contracts |
| `/api/documents/:id` | 7. Documents and contracts |
| `/api/finance/soft-pull` | 2. Consent and the credit pull |
| `/api/health` | 10. The platform under the journey |
| `/api/hiring/apply` | Other groups (table below) |
| `/api/inngest` | 10. The platform under the journey |
| `/api/merchant/events` | Other groups (table below) |
| `/api/org-brand` | 4. Sign in and the portal |
| `/api/paid-services` | 6. The paid round (paid-round-actual.md) |
| `/api/public/ad-video-approve` | Other groups (table below) |
| `/api/public/affiliate-click` | Other groups (table below) |
| `/api/public/climate-match` | Other groups (table below) |
| `/api/public/education-enroll` | Other groups (table below) |
| `/api/public/eeo-survey` | Other groups (table below) |
| `/api/public/funnel-checkout` | Other groups (table below) |
| `/api/public/optimize` | Other groups (table below) |
| `/api/public/partner-apply` | Other groups (table below) |
| `/api/public/partner-page` | Other groups (table below) |
| `/api/public/rb2b-webhook` | Other groups (table below) |
| `/api/public/slo-checkout` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/slo-interest` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/slo-pull` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/slo-repair-checkout` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/slo-status` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/survey-submit` | 1. Find us, apply, and buy the $297 roadmap |
| `/api/public/unsubscribe` | 9. Texts and emails to the client |
| `/api/public/vsl-watch` | Other groups (table below) |
| `/api/push/key` | 4. Sign in and the portal |
| `/api/push/subscribe` | 4. Sign in and the portal |
| `/api/push/unsubscribe` | 4. Sign in and the portal |
| `/api/read/affiliate-portal` | Other groups (table below) |
| `/api/read/client-progress` | 5. Progress page and checklist (client-progress-actual.md) |
| `/api/read/entitlements` | 4. Sign in and the portal |
| `/api/read/portal-contracts` | 4. Sign in and the portal |
| `/api/read/portal-summary` | 4. Sign in and the portal |
| `/api/soft-pull-approve` | 2. Consent and the credit pull |
| `/api/trials/eligibility` | Other groups (table below) |
| `/api/waypoint-tick` | 5. Progress page and checklist (client-progress-actual.md) |
| `/api/webhooks/:provider` | 1. Find us, apply, and buy the $297 roadmap |

## 12. Open doors that are not client steps (not counted)

| Route | Check id(s) | Depth | Owner |
|---|---|---|---|
| /api/climate, /api/climate/config, /api/climate/geocode, /api/public/climate-match | `reg:climate`, `reg:climate/config`, `reg:climate/geocode`, `reg:public/climate-match` | ping | marketing lead magnet |
| /api/public/education-enroll | `reg:public/education-enroll`, `offer:education-enroll` | ping | education offer |
| /api/public/optimize | `reg:public/optimize`, `offer:optimize` | ping | optimize offer |
| /api/public/partner-apply, /api/public/partner-page, /api/public/funnel-checkout, /api/trials/eligibility | `reg:public/partner-apply`, `reg:public/partner-page`, `reg:public/funnel-checkout`, `reg:trials/eligibility` | ping | white-label group |
| /api/public/affiliate-click, /api/read/affiliate-portal | `reg:public/affiliate-click`, `reg:read/affiliate-portal`, `partners:referral-link` | deep | affiliate group |
| /api/hiring/apply, /api/public/eeo-survey | `reg:hiring/apply`, `reg:public/eeo-survey`, `hiring-apply` | deep | hiring group |
| /api/public/rb2b-webhook, /api/public/vsl-watch, /api/public/ad-video-approve | `reg:public/rb2b-webhook`, `vsl-watch-route` | ping | marketing group |
| /api/merchant/events | `reg:money/connections` | ping | finance-os group |

## 13. The routes a client must stay blocked from

client-intended.md lists 73 blocked routes; client-actual.md lists 268. The only run-time tripwire is the staff lane check role-gate (a bad cookie gets 401). No check tries a client sign-in on a staff route. That is step 83 above.

## Counts

| Total | Covered | Ping-only | Weak | Missing |
|---|---|---|---|---|
| 83 | 45 | 14 | 10 | 14 |

## Holes that cost money or block a paying customer

- **missing** — A lead who applies becomes a client record (entry.captured) (money). no — nothing counts new leads. People still visit (429 person funnel events on 10-03, 166 on 10-05) but 0 leads since 10-02 22:45 UTC. A break or a quiet week? Nothing says
- **missing** — Commas takes the card but never calls us (money). no — no row exists anywhere to read. The payments check file says so itself
- **missing** — Press Buy: request row and a hosted checkout link (POST) (money). no — the pulse never presses it and nothing reads paid_service_requests
- **missing** — Payment marks the request paid and orders the fresh pull (money). no — the code that marks a payment paid is not turned on. A paid round would sit open and be cancelled 7 days later. No check sees it
- **missing** — Short payment is refused and the money kept on the row (money). no — same code, same silence
- **missing** — An Inngest-only event workflow fails or never starts (s-01, s-02, slo-paid-form-nudge, slo-pack-delivery, f-01 to f-11) (money). no — a failed run leaves no row in our database, and a failed send is swallowed. 292 of 350 slice rows read 'not checked' on live
- **weak** — Pay button makes a Commas checkout link (money). no — it reads setup only and never makes a link, so a Commas refusal goes unseen
- **weak** — Payment for a round reaches the right request (money). no — the door check is fine; the pay-link check reads payment_links, never paid_service_requests
- **ping-only** — Apply form still posts to us (ClickFunnels hook) (money). yes — red if the page loses its form post or the hook is gone. no — blind if the post breaks after it arrives
- **ping-only** — Offer and price list load (GET /api/paid-services) (money). no — page-up only
- **missing** — Buyer paid but never finishes the pull form (customer-blocked). no — the nudge row says not checked. consent:required only sees clients the pull form already marked paid. 15 roadmap links on file, 0 paid, never tested
- **missing** — Credit pull runs and finishes after consent (C-00 to the bureau) (customer-blocked). no — C-00 stops quietly if there is no account, no consent or the pull fails. The failure is saved on a soft_pull_requests row that no check reads. failed-events only sees a crash
- **missing** — Pack has every file (4 core + summary + guide + duplication map) (customer-blocked). no — red only when all 4 core files are missing. Summary, guide and map are never read. The printer can drop a file with no trace
- **missing** — Progress read is right: scores, stage, round, expected date, timeline (customer-blocked). no — nothing runs the read for a real client. Wrong or blank data still answers 200
- **missing** — A staged round is worked and marked fulfilled (customer-blocked). no — nothing moves a round from staged to fulfilled, and nothing reads the row
- **weak** — 'Your pack is ready' email is queued to the buyer (customer-blocked). no — a background job (Inngest) sends the email. Its in-app twin onAnalysisCompletedSloPack is not turned on, so a miss leaves no trace. 0 delivery emails ever on live
- **weak** — Client signs in with a password (customer-blocked). no — it only proves the sign-in tables can be read and written. Client sign-ins are never counted or tried. gap:auth-staff-login is staff only
- **weak** — Password reset email leaves (customer-blocked). no — red only if the Resend key is missing on the server. Reset mail skips the queue, so a lost one leaves no row
- **weak** — Mailing-proof upload closes the mail-receipt step (customer-blocked). no — red only if the code crashes. If it quietly does nothing, no red
- **weak** — Client uploads a document (customer-blocked). no — it proves the file store is real and the newest file is there. A broken upload door is unseen
- **weak** — Open or download a saved document (customer-blocked). no — it reads the newest 5 files from the store and signs a test link. Nobody opens a document through documents/:id
- **weak** — Bureau answer is read (customer-blocked). no — only silence past the clock turns red. The reader row says not checked
- **weak** — A client can click through sign-in and the portal (customer-blocked). no — the sweep clicks staff desks, funnel pages and climate. It has no client sign-in. No scheduler is set up, so it goes red from age alone
- **ping-only** — Login pages load (customer-blocked). yes — red if login.html loses its sign-in words (5 min). portal-login is only a page-up check
- **ping-only** — What the client may open (entitlements read) (customer-blocked). no — a signed-out 401 counts as up. Nothing reads it for a real client
- **ping-only** — Contracts list in the portal (customer-blocked). no — a signed-out 401 counts as up
- **ping-only** — Progress page loads (customer-blocked). no — page-up only (any 2xx)
- **ping-only** — Progress read answers (GET /api/read/client-progress) (customer-blocked). yes — red on a 404 or 5xx. no — a signed-out 401 counts as up; the slice row says not checked
- **ping-only** — Tick a step off (POST /api/waypoint-tick) (customer-blocked). no — a GET gets 405, which counts as up. The tick itself is never tried

## Notes and one-line leftovers

- Not fixed, by rule. These are findings, not edits.
- Real breaks the checks already catch today (not mine to fix): gap:sms-journey-zero (lead from 10-02 got no welcome text), repair-letter-round and fulfillment:next-action (paying repair file FH-000507, id 64212914..., stuck in analysis since 10-05), email:drip-step-no-email (one person skipped on the roadmap drip).
- Leftover: live-playwright:desks has no scheduler on this Mac (no launchd job). Last run 2026-10-07 21:40. It goes red from age alone each morning until someone runs it.
- Leftover: slice rows for event workflows and doors always read "not checked" (292 of 350 on live). They add rows, not protection.

## Checker — 2026-10-09

Checked by a second agent, read-only. Verdict: **not confirmed.** The file is mostly right. But one "missing" row is wrong, one "covered" row says too much, two "5 min" claims say too much, and 9 steps are left out.

What I did: loaded the pulse registry, the job list and every slice list, and every check id in this file exists. Read the code behind 14 covered rows. Ran read-only queries on the live database. Ran one "what if" on `consent:required`. Changed nothing.

### Corrections to rows

| Step | The file says | What is true | Proof |
|---|---|---|---|
| 11. Buyer paid, never fills the pull form | missing | **Not missing. Weak and slow.** `consent:required` goes red once the payment is 24 hours old and there is no consent and no pull. The payment (not the pull form) sets `crs_paid`. So it goes red at the first 6 a.m. run after the 24-hour mark, 1 to 2 days after pay. The customer waits that long. | `onDiagnosticPaid` stamps `crs_paid` (src/handlers/client-lifecycle.mjs:360, on the bus). `REQUIRED_SQL` in gap-consent.mjs. What-if on live: a fake paid buyer with no consent made it return 1. |
| 43. Paying client, no progress 72 hours | covered | **Covered only for funding, repair and DIY-letter clients.** The check reads three tags: `client:funding`, `client:repair-referral`, `client:diy-letters`. A $297 roadmap buyer has none, so it cannot go red for them. For roadmap buyers this is weak. | CLIENT_TAGS, dpc-05-no-progress-escalation.mjs:44. `readPipelineMotionCounts` filters `tags && CLIENT_TAGS`. |
| 1 and 27. "5min" | trips 5min | The 5-minute watch only runs 5 ids: `health`, `login`, `apply`, `funnel:roadmap-sales`, `pipeline:outbound`. In row 1 only `funnel:roadmap-sales` is 5 min. In row 27 only a stuck queue (`pipeline:outbound`) is 5 min. The rest is 6 a.m. Also `apply` is the staff Client Control Panel page, not the lead form. | src/pulse/instant-watch.mjs CRITICAL_CHECK_IDS. |
| 12. Pull form saves consent | covered | Covered for $297 buyers. `consent:slo-store` only reads link refs that start `slo_`. The $197 discount links start `slo197`, so they are skipped there. `consent:required` still catches them at 24 hours. | `left(pl.link_ref, 4) = 'slo_'` in SLO_STORE_SQL. newDiscountRef gives `slo197_<hex>`. |
| 62. Book the funding call | covered | Holds for page words and "webhook accepted, row not saved". It cannot see a booking that never arrives. The `bookings` table has **0 rows, ever**, so these checks have never seen a real booking. `calls:calendar` is the staff page. | `SELECT max(created_at) FROM bookings` is null. |
| 4 and 67. `gap:sms-journey-zero` | covered | Holds. It reads the last 7 days only. The 10-02 lead drops out of the window on 10-09 at 22:45 UTC and the red clears **with no fix**. It also only checks the 7 listed steps (no reminders). | JOURNEY_LOOKBACK_DAYS = 7 in gap-sms.mjs. |
| 76. Unsubscribe link | covered | Unproven live. The check is red on the laptop run. The board says the live key is real, but no live run has shown it yet. | opt-out lane in live-bundle result. |
| Route index | `finance/soft-pull` and `auth/logout` sit in sections 2 and 4 | No row in those sections names a check for them. `reg:finance/soft-pull` and `reg:auth/logout` exist in the registry but are not listed. | grep of the file. |

### Step 3 is worse than the file says

The file says "a break or a quiet week? Nothing says." Here is what the database says, and still nothing is red:

- Meta spent **$95.18 on 10-03** and **$120.21 on 10-04**, with 19 and 24 link clicks.
- The ClickFunnels webhook had 78 deliveries on 10-01 and 59 on 10-02 (Arizona days; the router saves one receipt row per delivery). It has had **0 from 10-03 to now**.
- `entry.captured` and `survey.submitted`: 0 since 10-02. Funnel page events kept coming (33 on 10-04).
- `funnel:apply-form`, `webhooks:clickfunnels` and `offer:home-survey` all say PASS. They only look at the page words and the door.

I cannot tell a dead lead pipe from a bad two days. That is the hole. A check that compares ad spend or page views to new leads, or counts ClickFunnels deliveries per day, would tell.

### The 12 covered rows I tried to break

| Row | Check | Result |
|---|---|---|
| 4 | `gap:sms-journey-zero` | Holds. Real, deep, red now. See the 7-day note. |
| 5 | `funnel:roadmap-checkout` | Holds. Reads the till: ready, not demo, price on page. |
| 7 | `payments:pay-link-webhook`, `webhooks:stuck-failed` | Holds for "paid and recorded but link still open". Blind to "never called" (row 8, correctly missing). |
| 9 | `portal:paid-entitlement`, `payments:paid-no-entitlement` | Holds, with one hole: both skip a payment with no client attached (see skipped steps). |
| 12 | `consent:slo-store` | Holds for $297. See the $197 note. |
| 14 | `consent:required` | Holds. Also covers row 11. |
| 19 | `uw-paid-roadmap-no-pack` | Holds, but only after the pull finished. Quiet if the pull never ran (row 18, correctly missing). |
| 22 | `uw-letters-missing` | Holds. Second branch needs an open dispute case to exist first. |
| 31 | `portal:summary` | Holds. Runs the reads, not the real portal code. File says so. |
| 43 | `pipeline:clients` | **Overstated.** See table. |
| 62 | calls lane | Holds with the caveat above. |
| 70, 77 | nurture, `email:drip-step-no-email` | Hold. The drip check is red now for one person. |

### Missing rows I searched for a hidden check

I grepped src/pulse for a check the mapper missed on rows 3, 8, 18, 20, 24, 38, 44, 46 to 50, 80 and 83. I found none. Row 18 is half covered: the "no consent" leg goes to `consent:required`. The "consent saved, pull fails or never starts" leg stays missing, because C-00 returns `pulled:false` without throwing.

### Steps the file skipped

1. **Unpaid contact follow-up.** The 15-minute note, the abandoned-checkout text and the $197 offer. All Inngest-only. All read "not checked." Live shows they send: EMAIL-SLO-197 delivered twice, SMS-SLO-GENUINE-01 once. They also mint a Commas link, so a Commas refusal goes unseen. (money)
2. **Welcome EMAIL and booking confirm EMAIL.** The booking confirm email carries portal access. Only the SMS twins are checked. The 24-hour and 2-hour reminders are not checked either. (money)
3. **No-show recovery, post-call follow-up, no-book chase.** All event workflows, all "not checked." May belong in group 04-sales. (money)
4. **Client texts back.** Replies, ID photos by text, STOP. The inbound door `webhooks/twilio` is not probed. Only `twilio-status` is. Reply routing is "not checked." (customer-blocked)
5. **Repair buyer pays and the repair program opens.** Nothing reads "paid for repair, no program." Only a stuck board card, after 3 business days, would show. (customer-blocked)
6. **Repair plan checkout in the roadmap widget.** POST only, never probed. Same blind spot as row 6. (money)
7. **A paid payment with no client.** `recordTransaction` saves it with a blank client when the person cannot be found. Both entitlement checks skip blank clients. (money)
8. **Refund or chargeback.** Opens a task with a deadline. Only a crash would show in `failed-events`. (money)
9. **Sale and commission rows for a paid order.** Nothing in src/pulse reads sales or commissions. May belong in 04-sales. (staff-only)
10. **Slice rows are notes, not tripwires.** The law test accepts a name in INDEX.md or a slice file. That is why 292 of 350 slice rows read "not checked" and yet the test is green.

### Counts after my corrections

Row 11 moves from missing to weak. Row 43 moves from covered to weak for roadmap buyers. Counts become: covered 44, ping-only 14, weak 12, missing 13 (83 rows). Nine more steps are not yet in the table (list above, items 1 to 9).
