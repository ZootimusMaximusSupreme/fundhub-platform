# Heartbeat map, group 09: every send

Fundhub. Read only. Nothing was fixed, changed, shipped or sent. Date of the look: 2026-10-09 (early UTC; the evening of 10-08 in Arizona).

## What this covers

Every way Fundhub sends something out, and what turns red if it quietly stops, goes to the wrong person, or fails at the other end.

| Area | What I read |
|---|---|
| A. The customer line | `src/messaging/dispatch.mjs`, `outbox.mjs`, `gate.mjs`, `src/workflows/messaging.mjs` (sendTemplated), `message-dispatch-sweeper`, `staff-message-sweeper`, the Resend and Twilio providers |
| B. Who writes the rows | Every file that calls sendTemplated or inserts into `messages` (grep: 90 lines with sendTemplated( outside tests) and the 143 EMAIL-/SMS- keys named in production code |
| C. Return doors | The webhook router (`api/webhooks/[provider].mjs`, `src/http/router.mjs`) and the receipt adapters |
| D. Sends that skip the queue | The 10 files in `SEND_PATHS` (`src/pulse/registry.mjs`) plus the brief and alert texts |
| E. Phone calls | `bland-voice.mjs`, `api/inquiry.mjs`, `call-scheduler.mjs`, `bureau-call.mjs` |
| F. Paper mail and letter files | `mail-letter.mjs` (PostGrid), `src/repair/send.mjs`, ds-02, c-06 |
| G. Vendor writes | Every file that imports `src/lib/outbound-fetch.mjs` (28) and the `ALLOWED_RAW_FETCH` list in `no-unfenced-transmit.test.mjs` |
| H. The switches | `src/lib/dry-run.mjs`, `message_channel_routing` |

The 19 files in `src/messaging/providers/` are 17 vendor modules and 2 helpers (the list and the HTTP helper). Live routing sends email through Resend and text through Twilio. The other providers are built but not routed.

## The count

91 steps looked at.

| Status | Steps |
|---|---|
| covered | 21 |
| ping-only | 15 |
| weak | 19 |
| missing | 36 |

52 of the 91 are holes where money or a paying customer is hit (money: 22, customer-blocked: 30). 18 more are staff-only or internal holes.

## What the words mean

- **covered**: a deep check reads the data or runs the real code. It would turn red the same morning the step breaks.
- **ping-only**: only a door check, or a "did the job run" row. It cannot see a missing send or wrong data.
- **weak**: a check exists but sees only part of the step. Maybe one template, only the text twin, only after 3 days, or the event row says "not checked" and can never go red.
- **missing**: nothing turns red.
- **Trips**: `5min` is the instant watch (`health`, `login`, `apply`, `funnel:roadmap-sales`, `pipeline:outbound`). `6am` is the morning pulse. `none` is nothing.
- **gate**: the step that checks opt-out, quiet hours and banned words before a send.
- **test switch** (the fence): `MESSAGING_DRY_RUN` holds anything that reaches a person. `ADAPTERS_DRY_RUN` holds calls to outside services. Unset means held.
- **slice row**: a line in the morning list for one workflow. For a workflow that starts on an event it says "not checked" and can never go red.
- **text twin**: the text and the email that the same workflow step sends.
- Gap ids show as the pulse prints them. A lane id that does not start with the lane name gets a prefix (`gap-jobs:failed-events`).

## The main things, in plain words

1. **One wire carries the customer texts and Chris's alarm.** The morning brief, the evening brief and the 5-minute alert text go out on the same Twilio account and the same test switch as customer texts. If they fail, the failure is saved on a row that nothing reads (D1, D2). A Twilio problem breaks the customer texts and hides itself.
2. **A bad Resend or Twilio key kills customer messages in about 25 minutes. The only alarm is 6 a.m. the next day.** A bad key is tried 5 times, 5 minutes apart. Then the row is failed for good. It is never "queued over 30 minutes", so the 5-minute watch stays green. No check asks Resend or Twilio if the key works (A5, A6).
3. **Four quiet ways a message dies with no red.** The gate blocks it. The copy guard blocks it. The client has no address. The template is not approved so no row is ever written (A8 to A11). 14 templates are marked approved but hold lorem-ipsum text.
4. **Most "this step should send" breaks are not watched.** Only 7 text steps, the sign-in link, the roadmap drip and the two after-funding sequences are read for a missing row. 16 of the 35 message families in section B have nothing. The slice rows for event workflows say "not checked" and cannot go red.
5. **Receipts and return doors are thin.** 7 messages sit at "sent" for 8 to 18 days and nothing notices (A17). The doors for Twilio STOP replies, Resend bounces and complaints, PostGrid and Bland have no check (C1 to C4).
6. **Some money-side sends have no reader.** The Meta purchase event (G4), ad pause and budget writes (G10), the credit pull request (G7), paper mail that was taken but not written down (F2) and the print service that quietly shrinks documents (G12).
7. **The queue itself is well watched.** A message that waits over 30 minutes texts Chris within 5 minutes (A1 to A4). Stuck, failed, opt-out and unsubscribe-link checks are deep checks.

## What is red right now in this group

- `gap:sms-journey-zero`: a real lead from 2026-10-02 got no welcome text. Already on the 10-08 review board.
- `email:drip-step-no-email`: one person moved forward 3 roadmap drip steps with no email queued.
- `03-marketing:outbox_drain`: 13 repo saves waiting since 2026-10-06. None was ever tried (0 attempts, no error).
- `opt-out:unsubscribe-link` reads red from a laptop run only. The laptop copy of the signing key is a mask. The live server holds the real key.

No other check I cite reads red today. 25 cited event rows say "not checked". 1 (`gap:auth-reset-mail`) reads skip from the laptop.


## A. The customer line: one queue for every email and text

The path: a workflow writes a row in `messages` (status queued) -> the 5-minute sender (Inngest `message-dispatch-sweeper`) -> the gate (opt-out, quiet hours, banned words) -> the route (email to Resend, text to Twilio, checked live) -> a receipt by webhook. 96 outbound rows exist live, ever. Quiet hours are 8 p.m. to 8 a.m. Arizona.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| A1. The 5-minute sender runs and empties the queue | `pipeline:outbound`, `job:message-dispatch-sweeper`, `12-messaging:message-dispatch-sweeper` | deep | Yes. If the sender stops, rows wait past 30 minutes and the 5-minute watch texts Chris. The two job rows only say it ran. A pass that fails still logs ok (shown with a fake database). | 5min | covered | customer-blocked |
| A2. Staff-typed replies leave (Netlify sender, every 5 minutes) | `pipeline:outbound`, `job:staff-message-sweeper`, `gap:sms-sending-stuck`, `gap:sms-provider-failed` | deep | Yes. A held reply is a queued row, so the 30-minute check sees it. The text checks count staff rows too. | 5min | covered | customer-blocked |
| A3. A message waits over 30 minutes (sending paused, daily cap, no route, route off, test fence, one bad row) | `pipeline:outbound` | deep | Yes. It counts queued rows older than 30 minutes and the 5-minute watch texts Chris. If Twilio is the broken part, that alert text cannot go (D2). | 5min | covered | customer-blocked |
| A4. A text held overnight is let out at 8 a.m. | `pipeline:outbound` | deep | Yes. The hold sets the due time to 8 a.m. If the sender does not let it go, it is red by 8:30. | 5min | covered | customer-blocked |
| A5. Resend or Twilio says no to a real message (bad key, outage, bad number) | `email:provider-fail`, `gap:sms-provider-failed` | deep | Yes, at 6 a.m. A bad key is tried 5 times, 5 minutes apart, then the row is marked failed for good in about 25 minutes. It is never queued past 30 minutes, so the 5-minute watch stays green. | 6am | covered | customer-blocked |
| A6. A key goes bad or the account is shut off, before any customer message | `gap:auth-reset-mail` | ping | Only for a Resend key that is empty or a row of asterisks on the live server (it reads skip from a laptop). Nobody asks Resend or Twilio if the key works. | 6am | weak | customer-blocked |
| A7. A message is stuck on sending (the sender died mid-send) | `email:sending-stuck`, `gap:sms-sending-stuck` | deep | Yes. A row on sending for over 15 minutes turns red. | 6am | covered | customer-blocked |
| A8. The client has no email or phone, so the row ends failed | none | none | No. Both failure checks leave out the line 'the client has no email or phone to send to' on purpose. Seen live once (a welcome text, 10-01). | none | missing | customer-blocked |
| A9. The gate blocks a real message (no client attached, a banned word, a gate error) | none | none | No. Nothing reads blocked rows or the task the gate files. Live: 5 blocked rows from 08-26 (4 contract emails, 1 affiliate email). | none | missing | customer-blocked |
| A10. The sender's copy guard holds a message (a DRAFT mark, lorem-ipsum text, a retired doc text) | none | none | No. The row ends blocked and nothing reads it. 14 templates hold lorem-ipsum text yet are marked approved (the repair pre-call grid and two 72-hour emails). | none | missing | customer-blocked |
| A11. A template is missing, not approved or a draft when a workflow asks to send | `gap:auth-magic-link-dead`, `gap:sms-journey-zero` | deep | Only for one key. sendTemplated quietly returns template_pending and writes no row. The sign-in check watches its own template. The text check skips any step with an unapproved template, so it excuses this break. All 340 templates are approved today. | 6am | weak | customer-blocked |
| A12. Code that sends crashes | `gap-jobs:failed-events` | deep | Only for in-app event handlers (doc-check and the like): a failed-event row turns red, test addresses left out. A crash inside an Inngest workflow leaves no row in our database (group 01, step 80). A step that quietly does nothing leaves no row. | 6am | weak | customer-blocked |
| A13. Mail or text goes to the wrong address (not the client's, or an old authorized-rep address) | none | none | No. Nothing compares the saved address with the client's email or phone. A live compare found no real mismatch (4 differ, all test tags). | none | missing | customer-blocked |
| A14. The same person gets the same message again and again | none | none | No. Code blocks repeats (30-minute window, one row per event). Nothing watches for a burst. A loop stops at the 500-a-day cap, and then the stuck queue turns A3 red, after the harm. | none | missing | money |
| A15. Routing points at a provider that sends nothing | `email:provider-fail`, `gap:sms-provider-failed` | deep | Only for internal, which fails every row. The memory provider marks rows sent and sends nothing. No check reads the routing table. Live routing is right today (email Resend, text Twilio). | 6am | weak | customer-blocked |
| A16. Twilio delivery receipts come back (status door) | `webhooks:twilio-status` | ping | Yes if the door is gone. No if the signing key is wrong: every receipt is refused and a dropped text stays sent. | 6am | ping-only | customer-blocked |
| A17. A text or email stays sent for days with no receipt | none | none | No. 7 rows have sat at sent for 8 to 18 days (1 text to a client, 6 emails). | none | missing | customer-blocked |
| A18. Every email carries a working unsubscribe link | `opt-out:unsubscribe-link` | deep | Yes. It signs a link, reads it back, and tries a forged one. It reads red on a laptop run because the laptop key is a mask. | 6am | covered | internal |
| A19. Opted-out people are not sent to, and every STOP or complaint is saved | `opt-out:send-ignores`, `opt-out:stop-did-not-stick`, `opt-out:table-unreadable` | deep | Yes. It runs the real gate with an opted-out person and expects a block. It also checks that each STOP and complaint saved an opt-out. | 6am | covered | internal |

## B. Who writes the rows: every message family

One row per workflow family. The question: if this step should send and writes nothing, does anything go red? A workflow that runs on an event shows 'not checked' on the slice row, and that row can never go red. Production code names 143 EMAIL- and SMS- template keys, and all 143 exist in the table. Some families use older names (AF1, CONTRACT-SEND-EMAIL, INVOICE-SENT-EMAIL, payment_link_notice, the BS grid). Grep finds 90 lines with sendTemplated( outside tests; a few are comments.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| B1. Welcome text after apply (s-00-welcome, on entry.captured) | `gap:sms-journey-zero` | deep | Yes. A captured lead with no welcome text row after 15 minutes turns red. It is red now: a lead from 10-02 got none. | 6am | covered | money |
| B2. Welcome email (same workflow) | `gap:sms-journey-zero`, `20-sales:s-00-welcome` | deep | Only through the text twin. A break of just the email (bad template, email step crashes) stays green. The event row says not checked. | 6am | weak | money |
| B3. Finish-your-application email (s-02) | `20-sales:s-02-incomplete-survey-nudge` | none | No. The event row says not checked. 8 sent ever; 5 failed on test addresses. | none | missing | money |
| B4. Not-booked chase, 3 texts and 3 emails (s-nobook-chase) | `20-sales:s-nobook-chase` | none | No. Not checked. 12 rows sent live. The 51-text day (09-03) came from this chase. | none | missing | money |
| B5. Booking confirmation text (s-04b, sent at once) | `gap:sms-journey-zero` | deep | Yes. A booking with no confirmation text row turns red. | 6am | covered | money |
| B6. Booking confirmation email and the portal link email | `gap:sms-journey-zero`, `email:magic-link-unqueued`, `20-sales:s-04b-booking-reminders` | deep | Only the portal link email is read. The confirm email is seen only through its text twin. | 6am | weak | money |
| B7. 24-hour and 2-hour reminder texts | `20-sales:s-04b-booking-reminders` | none | No. Not checked. They wait on a timer inside the job. | none | missing | money |
| B8. Pre-call build-up (bs-01: email grid and 3 texts) | `24-agents:bs-01-precall-launcher` | none | No. Not checked. The repair grid emails hold lorem-ipsum text, so the sender would block them (A10). | none | missing | money |
| B9. No-show recovery (4 emails, 4 texts, s-05a) | `20-sales:s-05a-no-show-recovery` | none | No. Not checked. | none | missing | money |
| B10. Doc request text after the deposit (s-doc-collection) | `gap:sms-journey-zero`, `documents:required-unchased` | deep | Yes. A deposit with no text row turns red. The 3-day paper check is the backup. | 6am | covered | customer-blocked |
| B11. Doc request emails and the ID and bank asks (DOC-01, F-02, F-06) | `documents:required-unchased`, `14-funding:f-02-portal-id-missing`, `14-funding:f-06-funding-conditions-missing-docs` | deep | Only after 3 days. A needed paper with no ask for 3 days turns red. The event rows say not checked. | 6am | weak | customer-blocked |
| B12. Doc reader replies ('send a better photo', 'approved') (doc-check) | `documents:stuck-processing`, `job:doc-check-retry-sweeper` | deep | Only for a read that failed and waits for a retry. A reply that was never queued leaves no trace. | 6am | weak | customer-blocked |
| B13. Round started, submitted and approved texts | `gap:sms-journey-zero` | deep | Yes. A round event with no text row turns red (submitted needs a round number, approved needs a dollar amount above 0). | 6am | covered | customer-blocked |
| B14. Round submitted and approved emails | `gap:sms-journey-zero`, `14-funding:f-03-round-submitted`, `14-funding:f-04-round-approvals` | deep | Only through the text twin. An email-only break stays green. The event rows say not checked. | 6am | weak | customer-blocked |
| B15. Funded notice and the success-fee bill (f-07) | `28-funding-advisor:f-07-funding-locked` | none | No. Not checked. Nothing reads the funded email, the funded text or the bill. | none | missing | money |
| B16. Funding paused after the credit read (AX07 email and text) | none | none | No. No slice row and no gap row names it. | none | missing | customer-blocked |
| B17. Thanks after funding and the 6-month renewal (N-04, N-06) | `nurture:never-queued`, `nurture:step-stuck`, `nurture:on-without-send` | deep | Yes. A closeout or funded event with no message row, or a step stuck past 15 minutes, turns red. | 6am | covered | money |
| B18. Roadmap follow-ups after contact (genuine, first-5, coupon, gift, $197) | `19-slo:slo-genuine-followup`, `19-slo:slo-no-reply-197` | none | No. Both say not checked. 10 rows sent live. | none | missing | money |
| B19. Paid $297 but no pull form: the nudge (slo-paid-form-nudge) | `19-slo:slo-paid-form-nudge` | none | No. Not checked. A buyer who pays and never fills the form stays green (group 01, step 11). | none | missing | money |
| B20. Roadmap drip (slo-infinite-drip, daily) | `email:drip-step-no-email`, `job:slo-infinite-drip` | deep | Yes. A person moved forward a step with no email row turns red. It is red now for one person. | 6am | covered | money |
| B21. The 'your pack is ready' email (slo deliver, u-02) | `gap-underwrite:uw-offer-fulfillment-failed`, `40-more:u-02-analyzer-complete-delivery` | deep | Only for a crash or a failure stamp. 0 pack emails have ever been sent live, and a missing one would not be noticed. | 6am | weak | customer-blocked |
| B22. Offer email after a sales call (s-offer-bucket, and the closer's send-now) | `20-sales:s-offer-bucket` | none | No. Not checked. The closer's send goes out at once and nothing reads it. 0 offer emails ever sent. | none | missing | money |
| B23. Repair referral after a call (ds-01) | `15-repair:ds-01-repair-referral` | none | No. Not checked. | none | missing | money |
| B24. Pay link text from the CRM (payment_link_notice) | none | none | No. Neighbor payments:pay-link-webhook sees a paid link that was not settled, not a text that never left. Only the staff member sees message_queued on screen. | none | missing | money |
| B25. Invoice email and the 3-step reminder ladder (INVOICE-SENT-EMAIL, AR-01 to AR-03) | `payments:invoice-stuck`, `24-agents:ar-collections` | deep | Only the bill state. It turns red when the reminder step and the money disagree. A reminder that never left is not read. | 6am | weak | money |
| B26. Contract send and reminder emails (daily chaser) | `contracts:sent-unsignable`, `job:contract-chaser`, `10-contracts:contract-chaser` | deep | Only that the sign link works and the chaser ran. A contract email blocked at the gate leaves the contract sent and green. 4 of 4 test contract emails ended blocked. | 6am | weak | money |
| B27. Repair client emails (welcome, docs needed, letters sent, round advanced, results, retake photo, upsell) | none | none | No. Neighbor repair-case-stuck sees a stuck file, not a missing email. 1 repair welcome sent live. | none | missing | customer-blocked |
| B28. Waypoint nudges (text, email, text; hourly) | `job:waypoint-nudge-sweeper`, `12-messaging:waypoint-nudge-sweeper` | ping | No. They say the job ran. If it dies after its claim, that nudge is spent and never retried. | 6am | ping-only | customer-blocked |
| B29. Money-agent, card-due and file-alert texts | `job:finance-os-money-agent`, `job:finance-os-card-due-reminders`, `job:blueprint-finance-os-alerts` | ping | No. They say the jobs ran. A reminder that was never queued is not read. | 6am | ping-only | customer-blocked |
| B30. 72-hour stalled-client email and text (dpc-05) | `pipeline:clients`, `40-more:dpc-05-no-progress-escalation` | deep | Only the stall. A client past 72 hours and not yet escalated turns red. The escalation message is not read. | 6am | weak | customer-blocked |
| B31. Partner welcome email and text (sent at sign-up) | none | none | No. Only the general queue checks see it. Live: 2 emails and 3 texts delivered. | none | missing | customer-blocked |
| B32. Affiliate drip (AF1 to AF4, every 15 minutes) | `job:af-01-affiliate-drip`, `17-affiliates:af-01-affiliate-drip` | ping | No. They say the job ran. It is the busiest live sender: 17 rows, 4 bad, 2 stuck at sent. | 6am | ping-only | internal |
| B33. Applicant outreach and the EEO invite (hiring, every 30 minutes) | `job:hiring-outreach-cadence`, `11-hiring:hiring-outreach-cadence` | ping | No. The code's own note says every outreach row is blocked at the gate (no client attached). The job still logs ok. 0 outreach rows live. | 6am | ping-only | internal |
| B34. Staff alert texts and mail (booked-call text, commission paid email, deal-win text) | none | none | No. The registry gives a reason instead of a check: no schedule and no door to ping. The booked-call text is off by default. | none | missing | staff-only |
| B35. Reschedule link text when a client replies to a reminder (dpc-03) | `40-more:dpc-03-inbound-reply-router` | none | No. Not checked. A reply that gets no answer leaves no trace. | none | missing | money |

## C. Return doors that protect the send

These doors bring news back: receipts, STOP replies, complaints. The Twilio receipt door is A16.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| C1. Twilio inbound door (STOP and replies) | `opt-out:stop-did-not-stick` | deep | Only after a STOP arrives. If the door is dead no STOP arrives and nothing is red. No check pings this door (webhooks:twilio-status is the receipt door). Live: 274 inbound texts, latest 10-07. | 6am | weak | money |
| C2. Resend event door (delivered, bounced, complained) | `opt-out:stop-did-not-stick` | deep | Only after a complaint arrives. If the door is dead, bounces and complaints never land. No door check. | 6am | weak | customer-blocked |
| C3. PostGrid event door (letter delivered or returned; this sets the inquiry call clock) | `inquiry:case-stuck` | deep | Slowly. A case with no call set stays quiet for 72 hours before it turns red. | 6am | weak | customer-blocked |
| C4. Bland call-result door | none | none | No door check and no read of call results. | none | missing | internal |

## D. Sends that skip the queue (a provider is called straight away)

These call Twilio, Resend, ntfy or web push directly. They leave no `messages` row, so the queue checks never see them. The registry guard (`SEND_PATHS`) accepts a ping or a job-ran row as cover.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| D1. Morning and evening brief text to Chris | none | none | No. A failed text is saved on the brief row (delivery_status, delivery_error) and nothing reads it. It uses the same Twilio account and the same test switch as customer texts, so one problem silences both. Both briefs were sent live on 10-08. | none | missing | internal |
| D2. 5-minute watch text to Chris | `job:pulse-instant-watch`, `25-rest:pulse-instant-watch` | ping | No. They say the watch ran. A failed alert text is saved as fail and nothing reads it. It shares Twilio with customer texts, so a Twilio problem hides itself. No alert row exists, so it has never had to text. | 6am | ping-only | internal |
| D3. Blake referral text to Chris | `job:blake-lead-watch`, `13-calls:blake-lead-watch`, `gmail` | ping | Only if the job or the Gmail search dies. A failed text just waits for the next pass. | 6am | ping-only | money |
| D4. Ad-video buzz to Chris (ntfy and Twilio) | `job:ad-video-sweeper`, `04-ads:ad-video-sweeper`, `dying-ad-scan` | ping | No. The scan row proves it ran, not that the buzz left. | 6am | ping-only | internal |
| D5. Teleprompter live text (one-shot POST) | none | none | No. The registry gives a reason instead of a check: no schedule and no door to ping. | none | missing | internal |
| D6. Staff invite and password-reset mail (Resend straight, no row) | `gap:auth-reset-mail`, `staff-invite-link`, `reg:auth/reset`, `reg:auth/invite` | ping | Only if the Resend key is empty or masked on the server. A refused mail leaves no row. | 6am | weak | staff-only |
| D7. Web push to phones | `reg:push/subscribe`, `reg:push/key` | ping | No. GET answers only. A dead push key stays green. | 6am | ping-only | internal |
| D8. WhatsApp ticket to Darwin | none | none | No. It sends only if DARWIN_WHATSAPP is set. Nothing reads the result. | none | missing | internal |

## E. Phone calls (Bland)

The 15-minute sweeper does not call anyone. It stamps the case queued (`fireDueCalls`). The Bland call is placed when a specialist presses launch (`POST /api/inquiry?action=launch`). The header of `inquiry-call-sweeper.mjs` still says it places calls.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| E1. A bureau call is due and gets queued (sweeper, every 15 minutes) | `inquiry:case-stuck`, `job:inquiry-call-sweeper`, `13-calls:inquiry-call-sweeper` | deep | Yes. A call due for 45 minutes and not queued turns red. | 6am | covered | customer-blocked |
| E2. A specialist launches the call and Bland rings the bureau | `reg:inquiry` | ping | No. A GET with no session is a 401 and counts as up. The launch and the Bland key are never tried. A call left queued turns red only at the 72-hour case clock. | 6am | ping-only | customer-blocked |
| E3. The AI setter dials a new booking (Josh, AG-04) | `calls:ai-dial-no-failure`, `24-agents:ai-set-01-josh-setter` | deep | Yes when Josh is live: a booking with no dial and no failure row turns red. He is retired, so it passes by design. | 6am | covered | money |
| E4. AI no-answer texts and the 3-way handoff (ai-set-03, ai-set-04) | `24-agents:ai-set-03-no-answer-cadence`, `24-agents:ai-set-04-3way-handoff` | none | No. Both say not checked. Phone work is on hold. | none | missing | internal |

## F. Paper mail and letter files

Paper mail goes out through PostGrid (`mail-letter.mjs`), from `src/metro2/delivery/send.mjs`, when staff press Send. The old exceptions in CLAUDE.md section 12 for `ds-02` and `c-06` are stale: both now save PDFs inside the repo (`DELIVER_LETTERS_URL = null`) and make no outside call. Group 05 section F holds the full repair-letter detail.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| F1. PostGrid takes the letter (staff press Send) | `reg:repair/send` | ping | No. A GET 405 counts as up. No key check and no read of mailed_at. Same hole as group 05, F3. | 6am | ping-only | customer-blocked |
| F2. PostGrid took it but the write-down failed (a re-send means a second envelope and bill) | none | none | No. It goes to the screen and the log only. Same hole as group 05, F4. | none | missing | money |
| F3. A bureau address is known and the 30-day clock starts | none | none | No. Same holes as group 05, F2 and F6. | none | missing | customer-blocked |
| F4. DIY letter files are saved for the client (ds-02) | `15-repair:ds-02-diy-letters` | none | No. The job stamps 'Delivery Failed - Retry' and still queues the 'letters ready' email. Nothing reads the stamp. The event row says not checked. | none | missing | customer-blocked |
| F5. Funding letter files are saved (c-06: inquiry-removal and personal-info PDFs) | `gap-underwrite:uw-letters-missing` | deep | Yes for the inquiry-removal PDF: a client with inquiries and no file turns red. The other PDFs are not read. | 6am | covered | customer-blocked |

## G. Vendor writes and other outbound calls

Most of these sit behind the vendor fence (`ADAPTERS_DRY_RUN`, blocked unless set to an off value). A few older ones do not (social posts, ad campaign writes, creative generation: listed in `ALLOWED_RAW_FETCH`). Reads that never change anything (Gmail, Drive reads, Commas reads, model questions) are not counted.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| G1. ClickFunnels page push (funnel pages go live) | `funnel:roadmap-sales`, `gap-funnels:funnel:roadmap-checkout`, `gap-funnels:funnel:apply-form`, `gap-funnels:offer:roadmap-pay` | deep | Yes. The checks read the live page for its markers. A push that breaks a page turns red (the roadmap sales page every 5 minutes). A push that fails and changes nothing leaves the old page up. | 5min | covered | money |
| G2. ClickFunnels contact copy (apply survey, roadmap pull) | none | none | No. A refused or held call is logged and swallowed. | none | missing | internal |
| G3. Meta server events from funnel pages | `meta-server-events` | deep | Yes. It reads each event's saved Meta reply. Real events with no accept turn red. It skips when there are no real visitors. | 6am | covered | money |
| G4. Meta purchase event (a payment tells Meta who bought) | none | none | No. The reply is saved on the payment event and nothing reads it. Same as group 02, 1.13. | none | missing | money |
| G5. Repo saves from the marketing machine (GitHub) | `03-marketing:outbox_drain` | deep | Yes. Saves waiting while the drain beat is over 3 minutes old turns red. It is red now: 13 saves waiting since 10-06, none ever tried (0 attempts, no error). | 6am | covered | staff-only |
| G6. Ad video upload, captions and buzz (Drive, Submagic, ntfy) | `job:ad-video-sweeper`, `04-ads:ad-video-sweeper` | ping | No. They say the sweeper ran. A refused upload or caption is not read. | 6am | ping-only | internal |
| G7. Credit pull request to the bureau (CRS soft view) | `consent:required`, `15-repair:c-00-crs-soft-pull-request` | none | No. A failed or silent pull stays green (group 01, step 18). consent:required only checks that consent exists. | none | missing | customer-blocked |
| G8. Bank link and sync (Plaid) | `banks-plaid-item-error`, `banks-sync-stale`, `banks-active-link-no-accounts`, `job:plaid-transactions-sweeper` | deep | Yes. A bank login in error, a sync older than 3 days, or a live login with no account turns red. | 6am | covered | customer-blocked |
| G9. Merchant processor pulls | `job:merchant-pull-sweeper`, `08-banks:merchant-pull-sweeper` | ping | No. They say the job ran. | 6am | ping-only | internal |
| G10. Ad campaign changes by a staff click (pause, budget, launch) | `reg:campaigns/write` | ping | No. A GET answers 405 and counts as up. A refused pause or budget change is not read. The partner autopilot loop has no caller and no schedule. | 6am | ping-only | money |
| G11. Social posts to company pages (Facebook, Instagram, LinkedIn) | `job:social-publish-sweeper`, `social:studio-read` | ping | No. The job row says it ran and the read check opens the studio. A failed post is not read. | 6am | ping-only | internal |
| G12. Printed client documents (print service, with a smaller Node printer as fallback) | none | none | No. If the service is down, documents quietly come out smaller (5, 4, 6 and 4 pages, not 12, 9, 9 and 14). Nothing reads which printer ran. | none | missing | customer-blocked |
| G13. Hiring writes (Zoho, calendar free and busy, LinkedIn job post) | none | none | No. | none | missing | staff-only |
| G14. Lendflow submit and the GHL contact copy | none | none | No. Lendflow's submit has no caller anywhere. The GHL copy runs only when GHL_API_KEY is set. | none | missing | internal |

## H. The switches that hold every send

Two flags hold sending: `MESSAGING_DRY_RUN` (people) and `ADAPTERS_DRY_RUN` (vendors). Unset means held. The sending pause switch and the daily cap are in A3.

| Step | Check id(s) | Depth | Can go red? | Trips | Status | Impact |
|---|---|---|---|---|---|---|
| H1. MESSAGING_DRY_RUN is on or unset on the live site | `pipeline:outbound` | deep | Yes for client mail and texts: they hold and age. No for Chris's own alert and brief texts, which use the same fence (D1). | 5min | weak | customer-blocked |
| H2. ADAPTERS_DRY_RUN is on or unset on the live site (every vendor call holds) | `banks-sync-stale`, `meta-server-events`, `03-marketing:outbox_drain` | deep | Slowly and only some: a bank sync older than 3 days, Meta replies, a save waiting. ClickFunnels copy, Zoho and merchant pulls say nothing. | 6am | weak | customer-blocked |

---

## Doc problems

- **No journey doc exists for the send line.** `docs/journeys/` has no intended or actual file for the queue, the gate, the sender and the receipts. Only `repair-letter-send-actual.md` touches paper mail, and it has no intended file. I built every step from code.
- **CLAUDE.md section 12 and `no-unfenced-transmit.test.mjs` are stale on ds-02 and c-06.** Both say these two workflows POST to a letter-delivery URL. They do not. `DELIVER_LETTERS_URL = null` in ds-02, and neither file makes an outside call. They save PDFs inside the repo.
- **The top of `src/workflows/inquiry-call-sweeper.mjs` says it places real calls every 15 minutes.** `fireDueCalls` only stamps the case queued. The Bland call is placed by `POST /api/inquiry?action=launch`.
- **`src/lib/no-unfenced-transmit.test.mjs` fails today** on `src/pulse/funnel-doors.mjs` and `src/pulse/instant-watch.mjs`. Both are on the 10-08 leftover list. Not touched.

## Holes (money or customer-blocked, not covered)

A6 (weak), A8 (missing), A9 (missing), A10 (missing), A11 (weak), A12 (weak), A13 (missing), A14 (missing), A15 (weak), A16 (ping-only), A17 (missing), B2 (weak), B3 (missing), B4 (missing), B6 (weak), B7 (missing), B8 (missing), B9 (missing), B11 (weak), B12 (weak), B14 (weak), B15 (missing), B16 (missing), B18 (missing), B19 (missing), B21 (weak), B22 (missing), B23 (missing), B24 (missing), B25 (weak), B26 (weak), B27 (missing), B28 (ping-only), B29 (ping-only), B30 (weak), B31 (missing), B35 (missing), C1 (weak), C2 (weak), C3 (weak), D3 (ping-only), E2 (ping-only), F1 (ping-only), F2 (missing), F3 (missing), F4 (missing), G4 (missing), G7 (missing), G10 (ping-only), G12 (missing), H1 (weak), H2 (weak). That is 52 rows.

Staff-only or internal holes: B32 (ping-only), B33 (ping-only), B34 (missing), C4 (missing), D1 (missing), D2 (ping-only), D4 (ping-only), D5 (missing), D6 (weak), D7 (ping-only), D8 (missing), E4 (missing), G2 (missing), G6 (ping-only), G9 (ping-only), G11 (ping-only), G13 (missing), G14 (missing).

## How I checked

- I read the send code: `dispatch.mjs`, `outbox.mjs`, `gate.mjs`, `sendTemplated`, the Resend, Twilio, internal and memory providers, `http.mjs` (the retry rule), `outbound-fetch.mjs`, `dry-run.mjs`, the receipt adapters and the webhook router.
- I read the pulse code: `daily-pulse.mjs`, `instant-watch.mjs`, `notify.mjs`, `heartbeats.mjs`, `registry.mjs` (SEND_PATHS), `machine.mjs`, `run-slices.mjs`, `pipeline-motion.mjs`, and the gap lanes sms, email, opt-out, nurture, webhooks, auth, calls, inquiry, documents, payments, contracts, underwrite, jobs.
- I ran 15 gap lanes live with `gap-live.mjs` (sms, email, opt-out, nurture, webhooks, auth, jobs, calls, ai-agents, documents, underwrite, contracts, inquiry, repair, payments). 0 SQL errors, 0 writes.
- I ran all 350 slice rows read-only: 292 not checked, 57 PASS, 1 FAIL (`03-marketing:outbox_drain`).
- I ran read-only SQL for the live facts: routing (email Resend, text Twilio), 96 outbound rows by status, 340 templates (all approved, 14 with lorem-ipsum text, 1 draft), 5 blocked rows, 7 rows stuck at "sent", the brief delivery rows, the address compare.
- I ran the sweeper through the real heartbeat code with a fake database that always fails. The heartbeat wrote "ok".
- I read `claimDue` and `dispatchOne` for the retry maths (5 claims, 5 minutes apart, then failed). A test pins the give-up rule (`dispatch.test.mjs`).
- Every check id in the tables was looked up in the registry, the job list, the slice files and the live gap output. 102 distinct ids, 0 unknown.
- I sent nothing, did not touch any key or env value, and changed no code.

## Checker — 2026-10-09

Verdict: **not confirmed.** The map is mostly right. Two "covered" rows are not covered. One "ping-only" row is really a deep check. Three steps were skipped. One doc claim is wrong. I read the code, re-ran the sms, email, opt-out, webhooks and auth lanes live (read-only), read the 6 a.m. scorecard saved in the database, and ran read-only SQL. All 109 check ids in the map exist (the `gap-jobs:`, `gap-underwrite:` and `gap-funnels:` ones need that prefix). I sent nothing and changed nothing but this section.

### Big caution for the whole map

- The last real 6 a.m. run (10-08, 13:01 UTC) had 420 checks: 360 page pings and 42 job rows. It had **0 slice rows and 0 gap rows**. The gap lanes shipped later that day (Arizona 16:13 to 22:32). The first real morning with them is today at 13:00 UTC.
- So every "covered" row was proved from a laptop copy of the live code, not from a live night. Read "covered" as "should go red". Today's brief is the first proof.

### The 12 covered rows I tried to break

| Row | Result |
|---|---|
| A1, A3 | Stands. Queued over 30 minutes turns `pipeline:outbound` red and the 5-minute watch texts Chris. But the sender and the watch both run on Inngest (see A20 below). |
| A5 | Stands, at 6 a.m. only. Five tries, then failed (`dispatch.mjs` line 94 and 688). A 401 or 403 is retried (`http.mjs` line 91). A Twilio "undelivered" receipt is saved as failed (`twilio-status.mjs` line 31), so a carrier block is caught too. |
| A7 | Stands. |
| B1 | Stands. Red now. The lead (two events, 10-02 22:45 UTC) has no welcome text and no welcome email. The `s00_welcome_sent_at` lock is empty, so the welcome flow never ran for this person. The row falls out of the 7-day window at 22:45 UTC today, after 6 a.m. |
| B5, B10 | Stand. I ran the same SQL with a 60-day window. It flagged 685 old events, including `booking.created` and `deposit.paid`. So it can go red. But the last real booking is 09-04 (and those 6 are Chris's own `+sim` tests), so it has never been tested on a real booking. |
| B13 | Stands on the logic. Never seen on real data: there are 0 real `round.started`, `round.submitted` or `round.approved` events. |
| B17 | Stands. |
| B20 | Stands. Red now for one person, 3 steps. |
| **E3** | **Does not stand. Weak.** `calls:ai-dial-no-failure` returns PASS the moment the Josh agent is retired (`gap-calls.mjs` line 307). Josh is retired (live: "Josh (AG-04) is retired"). It cannot go red today. |
| **G3** | **Does not stand. Weak.** A missing Meta token writes `skipped: "no_token"` on every event (`meta-capi.mjs` line 163). Then `machine.mjs` line 215 returns **skip**, with the false words "test or company sessions". I proved it with a stand-in: 12 events, all `no_token`, gave skip, not FAIL. Only an error from Meta turns it red. It also skips when there are no real visitors. |

Also flag A18: `opt-out:unsubscribe-link` reads FAIL in the built-bundle run too, not only on the laptop. "The live server holds the real key" is **not proven**. The board says so itself (`heartbeat-gaps-2026-10-08/opt-out.md` line 104): tomorrow's 6 a.m. row is the proof. If the live key is also a mask, customer email goes out with no unsubscribe link and the red is right. Leave it covered, but unproven.

### Missing rows: did the mapper miss a check?

No. I searched all 37 gap lanes, the 5 machine checks, the registry and the slices. Nothing reads `messages.status = 'blocked'` (A9, A10), the age of a `sent` row (A17), PostGrid or `mailed_at` (F2, F3), a Meta purchase event (G4: `meta-server-events` reads `funnel.*` events only), a Bland result (C4), the brief `delivery_status` (D1), or a failed `pulse-instant` alert row (D2; 0 such rows exist, 0 alerts ever sent). The nobook, s-02, reminder, offer, referral and funded-notice slice rows are all "not checked".

One upgrade the other way: **D4 is deep, not ping-only.** `dying-ad-scan` reads every running ad that dies before 25% and fails if no buzz row exists. The buzz row is only written after the send worked (`watch-curve.mjs` line 184 to 186). It says "nothing to buzz" today because no ad has video numbers, so it has never fired.

### Steps the mapper skipped

1. **A20. Inngest stops.** The customer sender (`message-dispatch-sweeper`), the 5-minute alarm (`pulse-instant-watch`) and the 6 a.m. pulse are all Inngest crons. If Inngest stops, customer mail stops and no alarm can fire. Nothing outside Inngest watches it. The Netlify sweepers cover staff replies only. Missing. Customer-blocked.
2. **B36. The 15-minute "your call starts in 15 minutes" text** (`ai-set-04-3way-handoff`). It is live and registered, and it fires on every `booking.created` and `booking.rescheduled`. The map filed it under E4 as "internal, phone work on hold". It is a text to every booked customer, so it affects show rate (money). Its slice row is "not checked". `gap:sms-journey-zero` leaves it out on purpose. The text says "it's Josh at Fundhub" and Josh is retired. Missing.
3. **C5. A customer's text reply reaches a person.** 165 inbound texts in 30 days. 164 are attached to no client, and no sender number is saved on the row, so nothing can say who they are. Nothing reads unanswered replies. The STOP check only runs if a STOP shows up, and there have been 0 opt-out rows ever. Missing.

Small fix to B11: the vault ask ladder (`SMS-VAULT-ASK-1`, `EMAIL-VAULT-ASK-2`, `SMS-VAULT-ASK-3`, daily job `document-vault-chase`) is read by `documents:required-unchased` too. Same 3-day weakness.

### Corrections to the map's text

- New counts: covered 19, weak 21, ping-only 15, missing 36 (E3 and G3 move from covered to weak). Holes that hit money or a paying customer: **54** in the map's own rows, **57** with the 3 skipped steps.
- "No journey doc exists for the send line" is half wrong. There is no doc for the queue, gate, sender and receipts (true). But `docs/journeys/booking-notifications-flow.md` (2026-09-04) covers booking, confirm, reminders, the 15-minute text and no-show. It records the 09-03 loop that sent one phone 69 texts in 2.5 hours, 46 the same. That is real proof for A14. `candidate-outreach-flow.md`, `push-flow.md` and `waypoint-nudge-actual.md` also touch sends.
- "What is red right now" leaves out `email:morning-no-failure-check`. It is FAIL in the repo run and the bundle run: `slo-infinite-drip.mjs` sends email and never reads whether it queued. It is a code-shape check, so it stays red every morning until that file reads its result.
- `03-marketing:outbox_drain` is red because the marketing worker is switched off, not because a send broke. The clock row says `enabled: false`, `batch: disabled`, `outbox_waiting: 13`.
