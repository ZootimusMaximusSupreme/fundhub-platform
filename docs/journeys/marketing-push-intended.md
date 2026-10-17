# Client marketing push — intended journey

Owner approved the marketing-push scope on 2026-10-17. This is the intended behavior, **not proof that marketing push is live**. Existing client push is documented in `push-flow.md`; existing booking timing is in `booking-notifications-flow.md`. `client-intended.md` lists doors only, not message order. The live event order below comes from the named `src/workflows/` files.

## Build gate

| Question | Answer |
|---|---|
| Role | Signed-in client with a registered phone. Owner/staff marketing alerts are a separate audience. |
| One job | Give the client one timely reason to open Fundhub and finish their next step. |
| First question | “What should I do now?” The opened portal must show the named action, not just a generic home page. |
| Reuse | Existing `messages` outbox, dispatch gate, approved push payloads, APNs/web-push devices, and client portal. Do not create a second campaign engine. |
| Data | Company and client IDs, source message ID/template key, booking or SLO state, live device, marketing-push preference, and recent eligible sends. The current `messages` and `clients.custom_fields` can hold a conservative first version without a new table. |
| Files | This intended page and `ops/workflows/two-ios-apps-launch/marketing-push.md` are this workflow's edits. Implementation belongs to the shared dispatcher/push owner and must be named there before editing. |
| Risk and proof | A broad mirror can turn one booking into 18+ buzzes. Prove one alert per allowed touch, current opt-out and quiet-hour checks, a useful tap target, and no alert after blocked/failed sends. |

## One marketing alert's order

1. An existing workflow decides whether the person is still eligible. Booking moved/cancelled, call already held, already booked, already paid, or already replied must stop the old marketing touch exactly as that workflow does now.
2. The workflow queues its existing SMS/email. It does **not** call APNs directly. The normal dispatcher checks opt-out, time window, company pause/cap, approved template, live provider and dry-run fence before sending.
3. Only a real provider's saved `sent` result may make one push candidate. If the touch has both SMS and email, use the successful SMS as its sole push source; the email never creates a second push. An email-only touch can be a candidate if explicitly listed below. A blocked, deferred, failed, draft, synthetic, or test-provider message makes no push.
4. Recheck a signed-in live push device, the client's marketing-push switch, suppression state and marketing cap at send time. Do not use `marketing_use` consent for this: that consent is for using a customer's recording or likeness in ads, not for sending offers to them.
5. Build a fixed, generic lock-screen sentence from `src/push/payload.mjs`. Never copy the email/SMS body, dollar amount, discount, credit data, phone number or a signed link onto the lock screen. Record push delivery separately; a push failure never retries or changes the successful email/SMS.
6. A tap opens the exact action in the signed-in client experience. Until an action is reachable there, that row stays off even if an email/SMS is sent. Current safe push URL allowlist contains only `/app/client-portal.html` (`src/push/payload.mjs`), so campaign-specific destinations need a separately proved route.

## Marketing touch map

“Candidate” means planned, not on. Copy is suggested fixed push copy, never the source template's full body. Each row still needs a real phone receipt and tap test before release.

| Existing event and workflow | Source keys / timing | Push decision and fixed body | Tap target and release condition |
|---|---|---|---|
| `booking.created` / `.rescheduled` → BS-01 pre-call | `SMS-BS01-02-PRECALL`, 48 hours before the call, only if that moment is still future; funding/repair email grid is `BS-FUND-D1..D3-E1..E6` or `BS-REPAIR-D1..D3-E1..E6` (up to 18 email cells). | **One** marketing push from the successful pre-call SMS, not one per email cell. “Your call is coming up. Open Fundhub to get ready.” No push for seeded-but-unsent `SMS-BS01-01-BOOKED` or `SMS-BS01-03-DAYOF`. | `/app/client-portal.html`, only while its call card shows the same live booking. Do not duplicate S-04B's T-24h/T-2h service reminders. |
| `survey.submitted` → never-booked chase | `SMS-NOBOOK-01` + `EMAIL-NOBOOK-01` at +2h; `-02` at +24h; `-03` after another +72h, each stopped by a booking. | At most the first successful touch is a push candidate: “Ready to choose a call time? Open Fundhub.” Later chase messages stay email/SMS only. | Hold until the signed-in portal has a working book-call action. Do not open a generic home page that cannot book. |
| `booking.noshow` → no-show recovery | `SMS-S05A-NOSHOW-RECOVERY` + matching email immediately; `-02`, `-03`, `-04` after 24h, 48h, 96h, stopped by a new booking. | First successful touch only: “Need a new call time? Open Fundhub.” Later recovery messages stay email/SMS only. | Hold until the portal can rebook that client; never reuse a cancelled call link. |
| `slo.contact_started` / `slo.checkout_started` → genuine unpaid follow-up | `SMS/EMAIL-SLO-GENUINE-01` after the existing unpaid/person checks, usually after 15m; checkout can add the missing first SMS. | One push for M1, not another when the checkout catch-up SMS arrives: “Your next step is ready in Fundhub.” | Hold until the signed-in app shows the same offer action. The current checkout is on `apply.fundhub.ai`, outside the push URL allowlist. |
| `slo.contact_started` with no reply → discount follow-up | `SMS/EMAIL-SLO-197` after the no-reply, unpaid and one-time-lock checks. | One push if no earlier marketing push is inside the cap: “An option is ready for you in Fundhub.” Do not put `$197` or a pay link in the alert. | Hold until the app has a signed-in offer door, rather than putting the minted discount URL in a push. |
| `message.inbound` → first-five/coupon reply | `SMS/EMAIL-SLO-FIRST5-REPLY` or `SMS/EMAIL-SLO-COUPON-01` only after a real reply and the workflow's eligibility checks. | One push per newly earned action, subject to the same marketing cap: “You have a new next step in Fundhub.” | Hold until the app displays the correct book/pay action. Do not put signed links or the customer's reply in the payload. |
| `payment.received` → SLO paid-form nudge | `EMAIL-SLO-PAID-FORM-01` and, if a phone exists, `SMS-SLO-PAID-FORM-01`, after 15m and a second incomplete-form check. | This is a paid-service next step, not a sales blast. It can use the service-push lane once the exact form is reachable: “Finish the form for your Fundhub service.” | Hold until the app opens that paid form for this client. |
| SLO infinite drip | Email-only daily sweep, rotating offer templates while unpaid. | No automatic push for the drip. A daily email series must not become a daily phone buzz. | Email continues unchanged; a future deliberate campaign can be added as one named touch. |

## Preference, stop, time and volume

- Notification permission/device registration turns on **service** notifications. Promotional pushes need a separate, visible **Marketing updates** switch, default off, written under the signed-in client. A first version can store the boolean in the existing `clients.custom_fields`, but it must have one authenticated writer and an off action. No marketing push goes out before that switch exists and is on.
- `opt_outs` currently records `sms`, `email`, and `voice`; there is no outbound marketing-push preference in the repo. For this first version, any active SMS **or** email opt-out also suppresses promotional push. Turning marketing push off does not silently re-enable SMS/email.
- Marketing push inherits the SMS waking window: 8 a.m.–8 p.m. America/Phoenix (`src/messaging/gate.mjs`), including email-only campaigns. A push whose time passed is skipped, not delivered late. Service reminders keep their own booking rules.
- At most one promotional push per client per rolling 24 hours and three per seven days, across all named campaign families. With no new push log/table, count recently `sent` source `messages` with the allowlisted marketing keys, excluding the current message. This conservative cap can under-send when an earlier email/SMS succeeded but push did not. It must never over-send. Key each attempt by source message ID and campaign family; SMS/email twins count as one touch.
- No marketing push from ad-copy/video approval to the **client**. Those are owner work. `src/ad-videos/notify-fanout.mjs` already sends the owner SMS plus ntfy directly, outside the client dispatcher. The current native device table is client-session-bound; an owner app alert needs a separate staff/owner device path and a signed-in review target.

## Proof before saying this works

Test each listed touch against sent/blocked/deferred/failed provider outcomes, both SMS+email successes, message replay, no device, switch off, either opt-out, quiet hours, daily/weekly cap, and stale booking/payment state. Check the signed-in tap target on a real iPhone; inspect the actual alert text and action. Add the named push send path to `docs/journeys/heartbeat-flow.md` and the customer tripwire when implementation is made. No production marketing push or provider call is part of writing this document.
