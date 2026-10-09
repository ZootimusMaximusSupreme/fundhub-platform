# Heartbeat worklist — what to build tonight (2026-10-09)

Written from the nine audit maps in `ops/workflows/heartbeat-complete-2026-10-09-map/` (with their Checker sections) and the 399 hole rows the mappers found. Read-only. No app code was changed. Law: `.claude/rules/heartbeat-on-every-build.md`. Picture: `docs/journeys/heartbeat-flow.md`. Board: `ops/workflows/heartbeat-complete-2026-10-09.md`.

Company launches tomorrow. The 6:00 a.m. Arizona pulse is the first real run with the gap lanes in it.

## The short answer

| | Rows | What it is |
|---|---|---|
| Tier 1 | **145** of 399 hole rows | **40 new checks in 12 lanes.** Money or a stuck customer, on the path a brand-new customer walks on launch day, plus checks that cover many holes at once. |
| Tier 2 | **253** of 399 hole rows | Other money or customer-blocked holes. 22 clusters. Not on the launch-day walk, or need a product change first. |
| Tier 3 | **161** rows | Staff-only and internal steps. 9 themes. Counted from the map tables, not from the 399. |
| Already covered | 1 | Soft-pull approve link (`soft-pull:approve-*`). |

The 399 rows are many views of fewer breaks. Dedupe: about 62 distinct breaks (40 in tier 1, 22 clusters in tier 2). Row counts are kept so the totals can be checked: 145 + 253 + 1 = 399.

Tier 1 by lane (one lane is one file, one Inngest step, under 20 s):

| # | Lane | File | New or existing | Checks |
|---|---|---|---|---|
| 1 | keys | `gap-keys.mjs` | **NEW** | 5 |
| 2 | leads | `gap-leads.mjs` | **NEW** | 3 |
| 3 | payments | `gap-payments.mjs` | existing | 4 |
| 4 | handoff | `gap-handoff.mjs` | **NEW** | 5 |
| 5 | sms (the message queue) | `gap-sms.mjs` | existing | 5 |
| 6 | soft-pull | `gap-soft-pull.mjs` | existing | 3 |
| 7 | underwrite (the pack) | `gap-underwrite.mjs` | existing | 2 |
| 8 | funnels | `gap-funnels.mjs` | existing | 5 |
| 9 | webhooks | `gap-webhooks.mjs` | existing | 2 |
| 10 | portal | `gap-portal.mjs` | existing | 3 |
| 11 | calls | `gap-calls.mjs` | existing | 1 |
| 12 | outside-inngest | `netlify/functions/pulse-outside-watch.mjs` | **NEW, not a gap lane** | 2 |

Order matters. Build in this order. If time runs out, stop where it runs out.

1. **keys** first. Five reads of server settings. Cheapest. Biggest blast: if the message lock is up or the workflow key is missing, launch-day customers get nothing and nothing says so.
2. **leads** and **payments**. The front door and the till.
3. **handoff** and **sms**. The first texts and emails.
4. **soft-pull** and **underwrite**. After the card: consent, credit pull, pack.
5. **funnels**, **webhooks**, **portal**, **calls**.
6. **outside-inngest** last, and only on Chris's go (it adds a new scheduled function and a new text path).

No lane waits on another. Shared files, edit append-only: `src/pulse/coverage/modules.mjs` (one literal import line per new lane) and `src/pulse/coverage/INDEX.md`. At most 5 builders at once. Suggested split: A = keys + outside; B = leads + payments + soft-pull + underwrite; C = handoff + sms + calls; D = funnels + webhooks + portal.

## Rules every check follows (from the law)

- Read only. `ctx.db` is shared: no BEGIN, COMMIT, SET. Staff-hidden tables go through `ctx.scope` (asStaff). Web calls are GET or HEAD.
- No repo files at run time. Import handlers, call the `ROUTES` map, GET the live door, or read the database.
- A failed read is `skip` with the reason. Never PASS. A mask (rows of asterisks) in a vendor key on the laptop is `skip`, not red. In production the key is real.
- Skip demo rows (`is_demo`), simulated payments (`provider_ref` starts `sim-pay-`) and test clients (same helper `gap-consent.mjs` uses).
- Each check gets a PASS test and a FAIL test. Each new lane goes on `modules.mjs`. Prove with `gap-live.mjs <lane>`, then `npm run pulse:prove`.
- Every id below was grepped in `src/pulse`, `scripts`, `netlify` on 2026-10-09: zero hits. Grep again before naming; other sessions edit this tree live.

---

## Tier 1 — the lanes

### Lane 1 — keys (NEW: `gap-keys.mjs`)

Systemic. These read server settings (`ctx.env`) only. Skip on a laptop (no `AWS_LAMBDA_FUNCTION_NAME`, `LAMBDA_TASK_ROOT` or `NETLIFY`), the same test `gap-auth.mjs` uses.

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `keys:send-fence-open` | Is the lock on customer messages open? | `fenceVerdict("MESSAGING_DRY_RUN", env).allowed` is false (unset, empty, or on). Second line in the detail for `ADAPTERS_DRY_RUN` (every vendor call holds). | `src/lib/dry-run.mjs` (`fenceVerdict`, `MESSAGING_DRY_RUN`, `ADAPTERS_DRY_RUN`), `ctx.env` | g09 H1 and H2 (switches that hold), g09 A1 |
| `keys:inngest-event-key` | Can the app hand work to the workflow engine? | `INNGEST_EVENT_KEY` empty or asterisks in production. `src/events/bus.mjs` skips the send when it is empty, so all 62 event workflows go quiet while every timed job keeps ticking. | `ctx.env`; `src/events/bus.mjs` | g07 event key, g07 event lost on send, g01 S4, g04 M3 |
| `keys:launch-secrets-present` | Is every key the launch needs set on the live site? | Any of these empty or asterisks: `FANBASIS_CHECKOUT_API_KEY`, `COMMAS_WEBHOOK_SECRET`, `CLICKFUNNELS_WEBHOOK_SECRET`, `LENDFLOW_WEBHOOK_SECRET`, `BLAND_WEBHOOK_SECRET`, `INQUIRY_REMOVAL_WEBHOOK_SECRET`, `POSTGRID_API_KEY`, `POSTGRID_WEBHOOK_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `TWILIO_SEND_ACCOUNT_SID`, `TWILIO_SEND_AUTH_TOKEN`, `TWILIO_SEND_FROM`, `UNSUBSCRIBE_TOKEN_SECRET`, `META_CAPI_ACCESS_TOKEN`, `META_PIXEL_ID`, `CRS_API_PASSWORD`. | `ctx.env`. Names read in `src/http/router.mjs` (webhook secrets), `src/pulse/coverage/gap-auth.mjs` (Resend), `src/messaging/providers/*` (Twilio), `src/finance/crs-identities.mjs`. Builder re-reads the router table so the list matches. Names only in output, never values. | g01/g02 Commas key and ClickFunnels key (a refused post leaves no row), g06 A5b, g08 webhook secret, g08 unsubscribe link, g09 A6 |
| `keys:credit-pull-live-allowed` | Will a paying customer get a real credit pull? | `livePullAllowed(env)` is false (`CRS_ALLOW_LIVE` not an explicit on value), or `CRS_API_PASSWORD` empty or asterisks, or `CRS_PROVIDER` names the simulated or sandbox provider. A buyer would pay and get a fake file or nothing. | `src/finance/crs-identities.mjs` (`livePullAllowed`, `CRS_ALLOW_LIVE`), `CRS_PROVIDER`, `CRS_PRODUCTION_HOST`, `CRS_SANDBOX_HOST` | Supports every credit-pull row (g01 step 18, g02 1.17, g09 G7) |
| `keys:vendor-key-read` | Do our text and email keys really work? | A GET to Twilio (fetch the account) or Resend (list domains) answers 401 or 403. Use `TWILIO_SEND_BASE_URL` and `RESEND_BASE_URL` when set. Skip on a mask or no key. GET only, nothing is sent. | `TWILIO_SEND_ACCOUNT_SID`, `TWILIO_SEND_AUTH_TOKEN`, `RESEND_API_KEY` | g01 password reset email, g08 reset, g09 A6 (a bad key kills customer mail and nobody asks the vendor) |

### Lane 2 — leads (NEW: `gap-leads.mjs`)

Systemic: lead flow stopped while traffic continues.

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `lead:pipe-cut-with-traffic` | Are people clicking our ads, but no new lead is being saved? | In the last 48 hours: 15 or more ad link clicks, and zero real leads. A real lead is a non-demo event named `entry.captured`, `survey.submitted` or `slo.contact_started`. Skip when the ad table has no row for those days, and say so. | `ad_metrics_daily` (`link_clicks`, `date`), `events` (`name`, `is_demo`, `created_at`). Both checked on live. | g01 lead becomes a client record, g02 1.32 visitors and nobody starts, g04 M7 leads turn into bookings, g08 paid ad traffic with no lead, g08 lead saved when the email is typed |
| `lead:clickfunnels-posts-silent` | Has ClickFunnels stopped sending us posts? | In the last 48 hours: 15 or more ad link clicks, or 20 or more real `funnel.page` events, and zero `webhook_captures` rows with `provider = 'clickfunnels'`. | `webhook_captures` (`provider`, `created_at`), `ad_metrics_daily`, `events` | g01 apply form, g08 clickfunnels door, g04 A6 signed booking post, g08/g04 checker "refused post leaves no row" |
| `lead:slo-contact-not-in-clickfunnels` | Did a new roadmap lead fail to reach the ClickFunnels list Paul works from? | A real `slo.contact_started` in the last 3 days has `payload.cf_contact.ok = false`. | `events.payload->'cf_contact'` | g02 S2 |

Live today: ClickFunnels posts were 87 on 10-01, 2 on 10-02, **0 from 10-03 on**. Ads spent $95.18 on 10-03 (19 link clicks) and $120.21 on 10-04 (24). 0 leads. The first check would have gone red on 10-04. The newest real lead (10-02) has `cf_contact.ok = false`, status 422, "Email address has already been taken".

### Lane 3 — payments (existing: `gap-payments.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `payments:paid-product-unmapped` | Did a customer pay and we cannot tell what they bought? | A succeeded, non-demo, non-simulated payment in the last 30 days has `resolve_product_id(org_id, product_name)` null, or has no client. Today's `paid-no-entitlement` drops both by design. | `transactions` (`product_name`, `client_id`, `status`, `provider_ref`), function `resolve_product_id(org_id, name)`, `products` | g01 payment with no client, g02 1.12, g04 E5 and F4, g07 unknown product, g08 paid buyer gets access (roadmap), g06 E8 |
| `payments:commas-inbox-waiting` | Is a paid receipt sitting in the inbox and nobody picked it up? | Any `commas_inbox` row is `pending`, or `processing` with `claimed_at` over 10 minutes old, and `received_at` is over 10 minutes old. Today all 36 rows are `done`. | `commas_inbox` (`status`, `attempts`, `received_at`, `claimed_at`) | g07 commas-inbox pending receipt, g03 pending row, g02 1.9 |
| `payments:checkout-started-no-link` | Did someone press Pay and we never made their checkout link? | A real `slo.checkout_started` event is over 10 minutes old and the same client has no `payment_links` row with `link_ref` starting `slo_` made at or after it. | `events` (all 15 real ones carry `client_id`), `payment_links` (`client_id`, `link_ref`, `created_at`; 15 `slo_` links exist) | g02 1.7 pay press, g08 pay button, g08 repair upsell pay, g01 repair checkout in the widget, g01 pay button |
| `payments:card-declined-no-followup` | Did a card fail and nobody reached out? | A real `payment.failed` event is over 1 hour old (and under 3 days) and its client has no message and no task made after it. | `events` (`payment.failed`: 4 real, newest 10-01), `messages`, `tasks` | g04 M2 card declined |

### Lane 4 — handoff (NEW: `gap-handoff.mjs`)

Systemic: an event happened, nothing followed. The workflows run only on Inngest, leave no row, and their slice rows say "not checked". These read the effect instead. Skip a client with both `dnd_sms` and `dnd_email`. Read the template keys from the workflow files at build time, not at run time.

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `handoff:lead-first-touches-missing` | Did a new lead get the first emails? | A real `entry.captured` over 30 minutes old has no `EMAIL-S00-WELCOME` after it. Or no `survey.submitted` and no `EMAIL-S02-FINISH-APPLICATION` after 25 minutes. Or `survey.submitted` over 2 hours old, no booking, and no `EMAIL-NOBOOK-01`. | `events`, `messages.template_key`, `clients` (`dnd_*`) | g07 s-02, s-nobook-chase, g09 B2, B3, B4, g01 welcome email, g04 A15 |
| `handoff:contact-no-followup` | Did someone leave their number and nobody followed up? | A real `slo.contact_started` over 30 minutes old with no paid `slo_` link and no `EMAIL-SLO-GENUINE-01` or `SMS-SLO-GENUINE-01`. Or over 25 hours old and no `EMAIL-SLO-197` or `SMS-SLO-197`. | `events`, `payment_links`, `messages` | g01 unpaid follow-up, g02 1.26, g07 slo-genuine-followup, slo-no-reply-197, slo-genuine-checkout-sms, g09 B18, g01 S4 (lost send), g07 "workflow fails and Inngest gives up" |
| `handoff:booking-no-confirm` | Did a booked customer get the confirm message? | A real `booking.created` over 20 minutes old and under 7 days has no `EMAIL-S04-01-CONFIRM` and no `SMS-S04-01-CONFIRM` after it for that client. | `events` (49 real, last 09-04), `messages` | g01 booking confirm email, g04 A10, g09 B6, g04 A9 (the text twin today shares one row with six steps) |
| `handoff:reminder-missing` | Did the reminders go out before the call? | A booking starts in under 22 hours (booked more than 25 hours ahead) with no `SMS-S04-02-REMIND-24H`. Or starts in under 110 minutes with no `SMS-S04-03-REMIND-2H`. | `events` `booking.created` (`payload.startTime`); `bookings` (`starts_at`, `status`) has 0 rows on live, so read events first. `messages` | g04 A11, g07 s-04b, g09 B7 |
| `handoff:call-outcome-no-followup` | After the call, did the customer get the next message? | A `booking.noshow` over 20 minutes old with no `EMAIL-S05A-NOSHOW-RECOVERY`. Or a `call.completed` over 30 minutes old with a buy or decline outcome and no `EMAIL-OFFER-*` message and no follow-up task. | `events`, `call_outcomes`, `messages`, `tasks` | g01 no-show recovery, g04 B6 and D2, g07 s-05a, s-offer-bucket, ds-01, g09 B9, B22, B23 |

Live: the newest real lead (10-02 22:45 UTC) has no `EMAIL-S00-WELCOME` and `s00_welcome_sent_at` is empty. The builder reads `s-00-welcome.mjs` to see if roadmap-widget leads are meant to skip the welcome, and writes that in the detail.

### Lane 5 — sms (existing: `gap-sms.mjs`, owns the message queue)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `gap:msg-sent-no-receipt` | Did a text or email go out and never get a receipt? | A non-demo message has `status = 'sent'` for over 24 hours. **Red today:** 7 rows, 8 to 18 days old (6 emails, 1 text). | `messages` (`status`, `created_at`, `channel`) | g09 A17 |
| `gap:msg-approved-template-bad-copy` | Is a message we marked ready still full of placeholder words? | A `message_templates` row with `compliance_passed = true` has a body with "lorem ipsum", "DRAFT" or an unedited placeholder. **Red today:** 14 (`BS-REPAIR-D1-E1` to `D3-E6`, `BS-EMAIL-FUNDING-72HR`, `BS-EMAIL-REPAIR-72HR`). | `message_templates` (`template_key`, `body`, `compliance_passed`) | g09 A10, A11, B8 |
| `gap:msg-blocked-by-sender` | Did our own safety gate stop a customer message? | Any non-demo message created in the last 14 days has `status = 'blocked'`. Detail counts by `blocked_reason` and `template_key`. (5 blocked on 08-26, so green today.) | `messages` (`status`, `blocked_reason`, `blocked_at`) | g09 A9, g07 blocked message, g04 M6, g09 B26 contract email, B8 |
| `gap:msg-inbound-unmatched` | Are customer replies landing with no name on them? | In the last 7 days, over half of the real inbound texts have no client, or no saved sender number (`to_address` null). **Red today:** 164 of 165 inbound texts in 30 days have no client and no number. | `messages` (`direction = 'inbound'`, `client_id`, `to_address`) | g09 C5 and C1, g04 M4, g02 S3, g01 client texts back, g05 D6, g06 F7, g07 dpc-03 |
| `gap:msg-failed-no-address` | Did a message fail because we had nowhere to send it? | A non-demo message in the last 7 days failed with the "no address to send to" error (the one `gap:sms-provider-failed` and `email:provider-fail` leave out on purpose). Builder reads the exact text at `src/messaging/dispatch.mjs` line 574. | `messages` (`status`, `last_error`) | g09 A8, g06 F6 |

### Lane 6 — soft-pull (existing: `gap-soft-pull.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `softpull:request-failed-or-stuck` | Did a credit pull fail, or never finish? | Any `soft_pull_requests` row has `status = 'failed'` made in the last 3 days, or `status = 'queued'` for over 15 minutes. Today: 1 row, fulfilled. | `soft_pull_requests` (`status`, `state_reason`, `requested_at`) | g01 step 18, g02 1.17, g07 c-00 and soft-pull refused, g08 credit pull answers, g09 G7 |
| `softpull:paid-form-not-filled-2h` | Did a buyer pay and still not fill the pull form after 2 hours? | A client with `custom_fields.crs_paid = 'true'`, paid over 2 hours ago, has no `soft_pull_consent` and no `crs_results` row, and no `SMS-SLO-PAID-FORM-01` or `EMAIL-SLO-PAID-FORM-01` went out. The 24-hour check `consent:required` stays. | `clients.custom_fields`, `client_consents` (`kind = 'soft_pull_consent'`), `crs_results`, `messages`, `events` | g01 step 11 (buyer never fills the form), g02, g07 slo-paid-form-nudge, g09 B19 |
| `softpull:approve-click-no-pull` | Did a customer approve the pull from the closer's link and nothing ran? | A `soft_pull_consent` was granted over 15 minutes ago through the closer approve link, and the client has no `soft_pull_requests` row at or after it. Builder reads the approve handler to confirm the `capture_method` value. | `client_consents` (`kind`, `granted_at`, `capture_method`), `soft_pull_requests` | g08 approve click starts the pull |

### Lane 7 — underwrite, the pack (existing: `gap-underwrite.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `uw-pack-files-incomplete` | Did the buyer get the whole pack, or only part? | A client has any pack file stored but is missing one of the 4 core files (`PACK_SUBTYPES`) or `funding_summary`; or a pack file has `byte_size` 0 or a failed `delivery_status`. Builder finds the subtype keys for the guide and the Business Duplication Map in `src/deliverables/` before adding them; I did not find them. | `documents` (`client_id`, `kind = 'deliverable'`, `subtype`, `byte_size`, `delivery_status`). Live: 1 of each core file plus `funding_summary`. | g01 step 12 (pack has every file), g01 step 18 bonus map, g09 G12 (print service falls back to smaller documents) |
| `uw-pack-email-not-queued` | Was the buyer told their pack is ready? | The 4 core files were stored over 30 minutes ago and no `messages` row with `template_key = 'EMAIL-U02-ANALYZER-FUNDING-DELIVERY'` exists for that client after the first file. **Today: 0 pack emails ever sent.** | `documents`, `messages` | g01 "pack is ready" email, g02 1.19, g09 B21 |

### Lane 8 — funnels (existing: `gap-funnels.mjs`)

Budget: 12 or so GETs and HEADs, run side by side, 8 s timeout each. Stay under 20 s with the checks already there.

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `funnel:card-box-script-loads` | Will the card box show on step 2? | GET `https://cdn.embedded.fanbasis.io/embed/index.js` is not 200, is empty, or is not JavaScript; or the live `/roadmap` page no longer names that script. The widget has no fallback: no script means no card box and no sale. | That URL (200, 21 KB on 10-08); `apply.fundhub.ai/roadmap` html | g08 card boxes, g02 1.7 |
| `funnel:book-and-order-pages-live` | Can a buyer reach the call calendar and the order page? | `apply.fundhub.ai/schedule/phonecall`, `/funding-book-call`, `/roadmap-book` or `/order` is not 200, or has lost its calendar frame or its price marker, or the order price differs from the price the till reports (`funnel:roadmap-checkout` already reads the till). Cannot see open times: they load in the browser from Cronofy. That part stays tier 2. | The four live pages | g08 phonecall, g08 order page, g08 open times (half), g02 H3, g02 order page |
| `funnel:roadmap-tracking-scripts` | Do the scripts that tie a sale to an ad still load on the sales page? | The live `/roadmap` html no longer names `fh-attribution.js`, `fh-events.js`, `vsl-watch-beacon.js` or the Clarity snippet, or any same-origin script it names is not 200. | `/roadmap` html and each script | g02 1.3 |
| `funnel:sales-videos-play` | Do the sales page videos still play? | HEAD on each video and poster the live `/roadmap` page names (the VSL mp4, its poster, the 3 testimonial mp4s on `fundhub.ai/funnel/`) is not 200, is not a video or image type, or is size 0. | `/roadmap` html, then HEAD on each file. All 5 answered 200 on 10-08. | g02 S1 |
| `funnel:widget-cross-site-call` | Will the browser let the roadmap page talk to our server? | GET `/api/public/slo-status` with header `Origin: https://apply.fundhub.ai` answers 5xx, or comes back without a matching `access-control-allow-origin`. (400 to a bare GET is normal.) | Route `public/slo-status` in `ROUTES` | g02 1.6 |

### Lane 9 — webhooks (existing: `gap-webhooks.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `webhooks:inbound-doors-mounted` | Is every door that vendors knock on still there? | A GET to `/api/webhooks/<provider>` answers 404 for `twilio`, `resend`, `mailgun`, `mailgun-events`, `postgrid`, `bland`, `lendflow`, `inquiry-removal` or `submagic`. 401 or 405 means mounted (same rule as the four doors already watched). | Provider list in `src/http/router.mjs`; `webhooks/` prefix in `netlify/functions/api.mjs` | g08 inbound text, email events, postgrid, lendflow, bland, g05 M1 bank mail, M4 lendflow, g09 C2 and C3 |
| `webhooks:receipts-silent-after-sends` | We sent texts and emails. Did any delivery receipt come back? | 5 or more real texts sent in 24 hours and no `webhook_captures` row with `provider = 'twilio-status'` in 24 hours; or 5 or more emails sent and none with `provider = 'resend'`. | `messages`, `webhook_captures`. Live: both providers have rows every day since 09-29. | g09 A16 (wrong signing key refuses every receipt), g09 C2 |

### Lane 10 — portal (existing: `gap-portal.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `portal:page-scripts-load` | Do the customer pages have all their scripts? | `/portal-login.html`, `/reset-password.html`, `/app/client-portal.html`, `/app/progress.html`, `/app/payment-success.html` or `/app/financeos.html` answers non-200, or any same-origin script or style it names answers non-200 or empty. The check reads each page's own list (client-portal names `shell.js` and `data.js`; financeos names 18 scripts). | The live pages | g08 scripts the pages need, g08 portal-login words, payment-success, g01 login pages |
| `portal:progress-read-real-client` | Does the progress page show real numbers for a real client? | The real `read/client-progress` code, run in process for the newest real paid client under staff scope, throws or returns no stage, no scores or no expected date. Builder confirms the handler writes nothing; if it writes, read the same SQL instead. | `api/read/client-progress.mjs` (route `read/client-progress` in `ROUTES`), `clients` | g01 steps 26, 27, 38, g08 progress |
| `portal:paid-client-never-signed-in` | Did a paying client get access and never sign in? | A non-demo, non-test client holding an active entitlement or a stored pack for over 72 hours has an `accounts` row (`kind = 'client'`) with `last_login_at` null and no consumed `account_magic_links` row. | `entitlements`, `documents`, `accounts` (`last_login_at`, `client_id`), `account_magic_links` (`consumed_at`). Live: 17 client accounts, none has a session or a used link; 25 clients hold access. Test clients must be left out first. | g01 client signs in, g01 what the client may open, contracts list, g01 portal sees the pack |

### Lane 11 — calls (existing: `gap-calls.mjs`)

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `calls:booked-no-join-link` | Does a booked customer have a way to join the call? | Any active closer has `staff.meeting_url` empty, or a real booking in the last 7 days carries no `meetingUrl`. **Red today:** `staff.meeting_url` is empty for all 35 staff rows, and 0 of 49 real `booking.created` events carry a `meetingUrl`. | `staff` (`meeting_url`, `role`, `status`), `events` (`booking.created.payload.meetingUrl`), `tasks.meeting_url` | g04 A16 |

### Lane 12 — outside-inngest (NEW, not a gap lane: `netlify/functions/pulse-outside-watch.mjs`)

Build only on Chris's go. It is a Netlify scheduled function (like `staff-message-sweeper`), every 5 minutes, because every other tripwire runs on Inngest and nothing outside Inngest watches Inngest. It sends one text, so it needs a `SEND_PATHS` row and a `JOBS` row in the same change, and a one-text-per-hour cap like the instant watch.

| Check id | Question | Red when | Data source | Covers |
|---|---|---|---|---|
| `outside:inngest-crons-stale` | Did the engine that runs our alarms stop? | The newest `job_heartbeats` row for `message-dispatch-sweeper` or `pulse-instant-watch` (both every 5 minutes, runner `inngest`) is over 20 minutes old. Newest is 06:45 UTC today. | `job_heartbeats` (`job`, `runner`, `started_at`) | g07 Inngest stops, g09 A20 |
| `outside:health-down-text` | If the database is down, will anyone be told? | GET `/api/health` is not 200 or says the database is down, from the Netlify clock. Today `runInstantWatch` calls `defaultOrgId(db)` at `src/pulse/instant-watch.mjs` line 76 with no catch, so with a dead database both the 5-minute watch and the 6 a.m. job crash before they text. | `/api/health` | g03 alarms when the database is down, g03 A9 |

---

## Tier 2 — other money or customer-blocked holes (253 rows, 22 clusters)

Not on the launch-day walk, or the check needs a product change first. Build after tier 1. Ids here are suggestions; grep before using.

| Step | Impact | Suggested check | Lane | Rows |
|---|---|---|---|---|
| Paid repair round ($100 and up): buy, payment marks it paid, fresh pull, worked, fulfilled. The handler is not switched on (see product breaks). | money | `payments:paid-round-unpaid`: `paid_service_requests` open with a paid link, or paid with no pull | payments | 7 |
| Refund or chargeback: staff task with the vendor's due-by date; affiliate and partner reversals | money | `payments:refund-dispute-no-task`: `payment.refunded` or `payment.disputed` events with no task (`src/handlers/commas-disputes.mjs`) | payments | 5 |
| A payment or order notice never arrives, or is refused, and no row is left to read | money | Router change first: count refused posts. Then `webhooks:refused-posts-counted` | webhooks | 5 |
| Purchase sent to Meta so ads learn who bought; Meta server events skip with a false reason | money | `payments:meta-purchase-unsent`. First find where the send result is saved: no payment event has the field today | payments, pixels | 3 |
| Funded round: success-fee bill made, bank yes has a dollar amount, card moved to Funded | money | `funding:funded-no-invoice`, `funding:yes-no-amount` (`funding_rounds`, `invoices.funding_round_id`, `applications.approved_amount`) | funding | 7 |
| Invoice reminders AR-01 to AR-04, payment applied, ladder stops when paid, overdue call | money | `payments:invoice-reminder-missing` (`invoices`, `v_invoice_aging`, `messages`) | payments | 8 |
| Funding client after the call: card and round in 24 hours, bank mail routed, bank asks for papers, round notices | customer-blocked | `funding:paid-no-card-24h`, `funding:bank-mail-unrouted` (`bank_inbox`, `tasks`) | funding | 11 |
| Documents: upload, open, asked and never sent, ID read and filed, hold cleared | customer-blocked | `documents:asked-never-queued`, `documents:upload-never-read` | documents | 17 |
| Repair floor: buy opens the program, letters, mail, bureau clock, next round, cap, client emails | money | `repair:paid-no-program`, `repair:letter-mailed-not-recorded`, `repair:bureau-clock-missing`, `repair:sending-stuck` (`repair_programs`, `dispute_letters.mailed_at`, `response_due_at`) | repair | 30 |
| Inquiry removal and credit-file jobs (C-02, C-02B, C-03, U-03, C-06, DIY pack), bureau call | customer-blocked | `inquiry:deposit-no-case`, `underwrite:negatives-no-pause`, `repair:diy-pack-failed-stamp` | inquiry, underwrite | 13 |
| CSM accountability calls: made, assigned, done | customer-blocked | `csm:assigned-call-overdue`; widen `csm:missing-step` to find the client by email | csm | 4 |
| Closer and sales desk: call screen, present actions, pay link, calendar, contract email, sign-in, handoffs | money | `closer:booked-call-no-task`, `closer:no-password`, `contracts:send-email-blocked` | closer, calls, sales-manager | 16 |
| Pre-call build-up, AI setter, 15-minute text, reply router, cancelled call still texted | money | `calls:precall-text-missing`, `calls:reply-yes-no-task`, `calls:cancelled-still-texted` | calls, nurture | 14 |
| Affiliate chain: referral row, commission, license and tax gates, payout run, pending payouts | money | `partners:sale-no-commission`, `partners:payout-pending-old`, `partners:gate-never-cleared` | partners | 12 |
| White-label partner money: approval wait, revenue share, $297 trial set-up, recruit bonus, wall, renewals, tills | money | `partners:application-waiting`, `partners:paid-trial-not-provisioned`, `partners:revenue-share-missing` | partners | 17 |
| Partner and affiliate doors that only answer a ping: sign-in, pages, portal reads, rep file | customer-blocked | `partners:real-sign-in`, `funnel:partner-pages-live` (`netlify/functions/partner-site.mjs`) | partners, funnels | 24 |
| FH Consulting, optimize, climate, education, partner referral pages. The consulting mail address has no mail route (see product breaks). | money | `funnel:consulting-mail-works` (MX look-up), `funnel:optimize-alias-live` (`/optimize.com`) | funnels | 14 |
| Finance OS and bank link: timed jobs that only report "ran", bank data goes quiet, money tabs | customer-blocked | `finance-os:reminder-never-queued`, `banks:sync-quiet` | finance-os, banks | 12 |
| Other message paths: nudges, contract chaser, same message again and again, wrong address, routing to a provider that sends nothing, crash inside a send, unsubscribe page | customer-blocked | `gap:msg-repeat-burst`, `gap:msg-wrong-address`, `gap:msg-routing-dead-provider` | sms, email | 13 |
| Money timed jobs that only report "ran": dead checkout links, subscription charge | money | `payments:subscription-due-none-charged`, `payments:checkout-link-never-expired` | payments | 2 |
| Pulse blind spots: staff sign-in never tried, saved-journeys passes empty, cron returns ok:false | customer-blocked | `auth:staff-login-real-handler`, `jobs:cron-ok-false` | auth, jobs | 3 |
| Customer doors that answer a ping only: sign-out, ticks, push, chat, real browser walk, old links, step-1 save, pull-result read, pull-form save | customer-blocked | `portal:tick-writes`, `funnel:old-links-hop`, `funnel:real-browser-walk` | portal, funnels | 16 |

## Tier 3 — staff-only and internal (161 rows, 9 themes)

Counted from the map tables (status missing, weak or ping-only, impact staff-only or internal). Keyword buckets, so counts are close, not exact. No customer feels these first.

| Theme | Rows | Suggested check | Lane |
|---|---|---|---|
| Pulse and alarm delivery: 6 a.m. job runs, brief is built, texts reach Chris, relay, Telegram, 5-minute watch | 24 | `pulse:morning-text-delivered`: the 9 p.m. brief reads today's `morning_briefs.delivery_status` and says if the 6 a.m. text failed | jobs |
| Staff desks and read doors that only answer a ping | 33 | `staff-desk:real-read` per desk, through `ctx.scope` | staff, crm-links |
| Pages and doors nobody asks about on purpose (404s, logos, sidebar, staff-side routes, analytics connect, climate side doors) | 33 | Decide: drop from the list, or add an ask | registry |
| Internal timed jobs that only report "ran" (sweepers, drips, snapshots) | 17 | `jobs:cron-did-nothing-for-days` from `job_heartbeats.item_count` | jobs |
| Staff-only event jobs that move cards and make tasks (s-01, s-04, s-06, s-08, f-01, f-08, f-10, c-05) | 16 | `handoff:event-no-card-move` | jobs |
| Internal scorers, calculators and tags (dpc-01, u-02 to u-05, bc-01, bc-02, sys-01, at-01) | 15 | None. Log only. | none |
| Marketing, social, hiring and brand tools | 15 | One read per tool | owner-tools, social, marketing-queue |
| Repair and funding staff steps (round notices, phone calls on hold, PostGrid event, proxy) | 7 | Folded into the tier 2 repair and funding clusters | repair, funding |
| Client side minor doors (chat, welcome video) | 1 | None | portal |

---

## Product breaks — the product itself is off today

Each one was read on the live database (fundhub_app role, inside BEGIN READ ONLY) or from code on 2026-10-09. Not a missing check. A real break stays red and gets reported, not hidden.

| What | Evidence | Impact |
|---|---|---|
| **Lead pipe has been silent since 10-03.** ClickFunnels sent 0 posts and 0 leads were saved, while ads spent money. It could also be a pause: ads show $0 on 10-06 and 10-07. Nothing today can tell which. | `webhook_captures` provider `clickfunnels`: 87 on 10-01, 2 on 10-02, 0 after. `ad_metrics_daily`: $95.18 and 19 link clicks on 10-03, $120.21 and 24 on 10-04. Last `entry.captured` 10-02 22:45 UTC. | New leads and ad money |
| **Two real paid orders have no product and no access.** | `transactions`: "UnderwriteIQ soft-pull assessment" $32 (ORD-N40H-ZZ26-HKNW, 10-07) and "Consulting Services Standard" $1,000 (ORD-8VE0-X209-3EQR, 09-17). `resolve_product_id` returns null for both. 0 entitlements on either. The $1,000 client got access by hand on 10-05. `resolve_product_id` also returns null for "Consulting Services Assessment", the vendor title `src/config/offers.mjs` sends for the diagnostic. If the roadmap payment arrives under that title, it will not map. | Paid customers without access |
| **14 messages marked ready still hold placeholder text.** The sender's copy guard would stop them, so those customers get nothing. | `message_templates`: 14 rows with `compliance_passed = true` and "lorem ipsum": `BS-REPAIR-D1-E1` to `BS-REPAIR-D3-E6`, `BS-EMAIL-FUNDING-72HR`, `BS-EMAIL-REPAIR-72HR` | Repair and funding pre-call emails |
| **7 messages have sat at "sent" for 8 to 18 days** with no receipt. | `messages`: 6 emails (AF1 x2, `EMAIL-S02-FINISH-APPLICATION` x3, `EMAIL-PORTAL-MAGIC-LINK`) and 1 text (`SMS-DOC-02-REQUEST-MORE`), created 09-21 to 10-01 | Unknown if delivered |
| **Customer text replies cannot be matched to a person.** STOP, YES and RESCHEDULE replies land with no client and no sender number. | `messages` last 30 days: 165 inbound, 164 with `client_id` null, 165 with `to_address` null | Replies lost; STOP may not stick |
| **No call join link exists anywhere.** The reminder text falls back to the portal sign-in page. | `staff.meeting_url` is null for all 35 staff rows. `booking.created` events: 0 of 49 real ones carry `meetingUrl`. | Booked customers cannot join |
| **The newest real lead got no welcome email**, and its copy to the ClickFunnels list was refused. Roadmap-widget leads may skip the welcome by design; not confirmed. | Client of the 10-02 22:45 `entry.captured`: `s00_welcome_sent_at` null, messages are only `EMAIL-SLO-GENUINE-01` and `EMAIL-SLO-197`. `slo.contact_started` `cf_contact`: `ok:false`, 422, "Email address has already been taken". | Lead follow-up |
| **The paid-round payment handler is not switched on.** A paid round would sit open and be cancelled 7 days later. | `src/handlers/paid-service-payment.mjs` is not named in `src/register-all.mjs`. Only its own test and `src/paid-services/expire.mjs` mention it. | Repair round buyers |
| **A declined card makes no text and no task.** | `onPaymentFailed` in `src/handlers/client-lifecycle.mjs` only saves a failed row. 4 real `payment.failed` events, newest 10-01. | Lost sales |
| **Both alarms crash when the database is down.** The 5-minute watch and the 6 a.m. job call `defaultOrgId(db)` with no catch, so no text goes out in the one case that loses sales. | `src/pulse/instant-watch.mjs` line 76. The checker ran it with a dead database in memory: 0 texts from each. | Silent outage |
| **Staff who cannot sign in.** | Active staff with no password: closers 2 of 4, funding advisors 4 of 5, admins 1 of 2, inquiry specialists 1 of 2, setters 1 of 2 (`staff.password_hash` null). | Closers and advisors locked out |
| **The consulting page's only contact address may have no mail route.** | `public/consulting/index.html` builds `mailto:support@fhconsulting.online`. `dig MX fhconsulting.online @8.8.8.8` returns nothing today; name servers are `ns39.domaincontrol.com`, `ns40.domaincontrol.com`. | Buyers cannot reach FH Consulting |
| **Held affiliate payouts can never clear.** | 0 of 23 `affiliates` have `tax_form_received_at`; 2 of 23 have `partner_license_signed_at`. No code in `src`, `api`, `netlify` or `scripts` writes either date. Someone may set them by hand in the database. | Affiliate pay |
| **The 15-minute "your call starts" text is signed by a retired setter.** | `message_templates` `SMS-AISET04-HANDOFF` begins "it's Josh at Fundhub". `agents` AG-04 "Setter Josh" is `retired`. Workflow `ai-set-04-3way-handoff` is registered and fires on every booking. | Every booked customer |

## Notes and limits

- The coverage lanes have never run in a real 6 a.m. job. The only saved scorecard (10-08) has 0 lane rows. Tomorrow's run is the first. All proof so far is from the unpacked bundle and live read-only runs.
- Several tier 1 checks can only be proven red by a test fixture or a what-if, because live has no real case yet: `payments:commas-inbox-waiting`, `softpull:*`, `uw-pack-*`, `handoff:booking-no-confirm`, `handoff:reminder-missing`, `handoff:call-outcome-no-followup`. Live is already red for `gap:msg-sent-no-receipt`, `gap:msg-approved-template-bad-copy`, `gap:msg-inbound-unmatched`, `payments:paid-product-unmapped` and `calls:booked-no-join-link`. A red on day one is the finding, not a bug in the check.
- Thresholds (15 clicks, 20 minutes, 72 hours) are starting numbers. Chris can change them. Pick the quiet-week risk deliberately: `lead:pipe-cut-with-traffic` needs traffic before it can go red.
- The `run-pulse` step has no total time limit (395 asks, 8 at a time, 15 s each at worst). If the site is slow the step can be cut at 26 s and the brief step failure is swallowed. This is a pulse problem, not a hole in the worklist. It is why the 5-minute watch stays separate.
- Row references like "g04 A16" mean group file 04 in the map folder, step A16.
- Row counts use the 399 rows in the audit's merged list. A tier 1 check can cover a row fully or in part; the "Covers" column does not say which. The builder writes that in each check's detail.
