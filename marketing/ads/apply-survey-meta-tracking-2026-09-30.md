# Apply survey rebuild — Meta tracking plan (2026-09-30)

Read-only implementation plan. **No live campaign, pixel, or Events Manager changes in this doc.**

**Inputs:** rebuild handoff §4 in `docs/clickfunnels/apply-survey-extract-2026-09-30.md` (CRM keys, webhook granularity, completion sentinel), repo grep of pixel / CAPI / money events.

**Pixel (ground truth):** `2403674420141513` — `clickfunnels-fragments/tracking-manifest.mjs`, `docs/workflows/archive/ads-revenue-model-2026-08-24.md`.

---

## 1. Event catalog

| Funnel step | Meta event name | Standard vs custom | Primary channel | Dedupe key (proposed) |
|-------------|-----------------|--------------------|-----------------|------------------------|
| Apply survey **finished** (all branches) | **Lead** | Standard | **CAPI** (required); optional browser backup | `lead:{client_id}` or `lead:{email}` once `cf_svy_available_capital` stored |
| Call **booked** on `/funding-book-call` | **Schedule** | Standard | **CAPI**; optional browser on scheduler confirm | `schedule:{booking_id}` or `clickfunnels:{provider_uid}` |
| Client **showed** on the sales call | **ShowedCall** | **Custom** (Direct ROAS / ad account convention) | **CAPI only** | `showed:{call_outcome_id}` or `showed:{client_id}:{booking_ref}` |
| Money in (deposit, $32 pull, closed sale, $297 SLO, etc.) | **Purchase** | Standard | **CAPI** | `purchase:{source_event_id}` from `events.id` or `sale_payments.source_event_id` |
| Lender funded + backend success fee economics | **BackendRevenue** | **Custom** | **CAPI only** | `backend:{round_id}` or `backend:{source_event_id}` on `round.funded` |

**Browser vs CAPI**

| Channel | What exists today | Role after rebuild |
|---------|-------------------|--------------------|
| **Browser (fbq)** | Base **PageView** only in pushed head snippet (`metaPixelHeadHtml`). Thank-you: `AddToCalendar`, `OpenInboxConfirm` (`clickfunnels-fragments/05-thank-you.html`). `$297` pay click: **InitiateCheckout** in `public/funnel/fh-attribution.js` (homepage widget path, not apply survey). **Direct ROAS** hub script on book head (`directRoasHeadHtml`) — third party; not Fundhub code. | Keep PageView on funnel pages. **Do not** rely on browser alone for Lead / Schedule / Purchase — ad blockers and iOS break browser. Optional: mirror Lead on survey redirect and Schedule on calendar confirm **with the same `event_id` as CAPI** for dedupe. |
| **CAPI (server)** | **Not implemented** in this repo. `META_ACCESS_TOKEN` is wired for **Marketing API read/sync** (`docs/workflows/marketing-data-pipeline-2026-09-22.md`, `src/adplatforms/meta.mjs`) — ads insights, not `/{pixel-id}/events`. | **New** adapter: POST Graph API `/{API_VERSION}/{pixel-id}/events` with `action_source: website`, hashed PII, `event_id`, UTMs from `client_ad_attribution`. |

**Handoff §4 rule that drives Lead timing:** ClickFunnels fires **`survey.submitted` on every screen**, not only at the end (`src/adapters/clickfunnels.mjs` comment; ~15–17 per full apply in `docs/workflows/archive/comms-logic-2026-08-23-slice-capture.md`). **Survey complete** in CRM is when **`cf_svy_available_capital`** is present (`src/handlers/client-lifecycle.mjs` `CF_SURVEY_COMPLETE_KEY`). **Lead must fire once, on that completion only** — not on contact step, not on mid-survey webhooks.

---

## 2. Where to fire in the repo (implementation map)

### Lead — survey submit (complete only)

| Option | Location | Gate |
|--------|----------|------|
| **Recommended** | New handler registered on `survey.submitted`, or tail of `onSurveySubmitted` in `src/handlers/client-lifecycle.mjs` (~324–332) | `answersIncludeSurveyComplete(answers)` |
| **Do not** | `mapToCanonical` / webhook adapter | Would need CF “final step only” signal; adapter cannot distinguish partial vs complete without reading answers |
| **Optional browser** | `clickfunnels-fragments/02b-apply-bottom.html` (or small deferred script) | Observe CF native `Survey/V1` end redirect / end copy — fragile; prefer CAPI |

Payload should include: email, phone, first/last name, `client_id`, attribution from `client_ad_attribution` / event payload (`utm_*`, `fbc`, `fbp` if ever captured — today UTMs live in attribution row and `fh-attribution.js` hidden fields).

### Schedule — book

| Option | Location | Gate |
|--------|----------|------|
| **Recommended** | New meta handler on **`booking.created`** after CRM writes succeed | `src/handlers/comms.mjs` `onBookingCreated` (~467–507) or sibling handler on same event |
| **Ingress** | `src/adapters/clickfunnels.mjs` | `appointments/scheduled_event.created` or form submission with `startTime` → `booking.created` |
| **Optional browser** | Book fragments `04a-book-top.html` / `04c-book-framed.html` | Hook CF `AppointmentScheduler/V1` confirm — only if same `event_id` as server |

Skip **`isInterviewBooking`** paths (same guard as `onBookingCreated`).

### ShowedCall — CRM

| Location | Gate |
|----------|------|
| `src/sales/call-outcomes.mjs` after successful insert / `emitCloserCallCompleted` | `outcome` ∈ **`deposit`, `downsell`, `callback`** (attended). **Not** `no_show`, **not** `not_a_fit` |
| Alternate read | `call.completed` event (emitted from call-outcomes) — handler could listen here instead of inline |

### Purchase — CRM money events

| Canonical event | Typical product | Handler / chain |
|-----------------|-----------------|-----------------|
| **`deposit.paid`** | $3k (etc.) deposit | `src/handlers/money-chain.mjs` `onDepositPaidMoney`; Comms → `src/adapters/commas.mjs` |
| **`diagnostic.paid`** | $32 soft pull | `onDiagnosticPaid` in `client-lifecycle.mjs` |
| **`sale.closed`** | Repair trial, courses, DIY, etc. | `money-chain.mjs` / `purchase-routing.mjs` |
| **`payment.received`** | Often paired with deposit/sale | Same money chain |

Use **`value` + `currency: USD`** from event payload / `sale_payments.amount` (integer cents → dollars in CAPI).

### BackendRevenue — CRM

| Location | Gate |
|----------|------|
| Handler on **`round.funded`** | `funded_amount` (and optionally success-fee invoice paid — separate event if needed) |
| Reference | `src/workflows/sys-01-ltv-calculator.mjs`, affiliate success-fee paths |

Define **BackendRevenue** value with Chris: funded amount vs success fee only vs both (two events).

---

## 3. Does the CRM already fire Meta on deposit?

**No.** Grep across `src/` shows **no** `fbq`, **no** Graph `/{pixel}/events`, and **no** Meta conversion helper on **`deposit.paid`** or any money handler.

On deposit, the CRM today:

- Emits / handles **`deposit.paid`** (`src/adapters/commas.mjs`, `src/handlers/money-chain.mjs`)
- Updates client flags (`onDepositPaid` → `deposit_paid: true` in `client-lifecycle.mjs`)
- Runs workflows (`s-06-post-call-funding-purchased.mjs`, inquiry gate, commissions, staff alerts, etc.)

**Purchase** for Meta is **net-new server work**, not a wire-up of existing code.

Direct ROAS (browser hub on funnel pages) may send its own signals to Meta; that is **outside this repo** and must not be assumed to match Fundhub’s Lead / Schedule / Purchase / BackendRevenue definitions.

---

## 4. CAPI module (built 2026-10-02)

Contract: `docs/tracking/meta-events.md`. Sender: `src/messaging/providers/meta-capi.mjs`. Handler and test: `src/handlers/meta-purchase.mjs`, `src/handlers/meta-purchase.test.mjs`.

| Piece | Path | Notes |
|-------|------|-------|
| Send helper | `src/messaging/providers/meta-capi.mjs` | Live sender. POST to Meta Conversions API. |
| Config | `.env` / Netlify | `META_CAPI_ENABLED`, `META_PIXEL_ID`, optional `META_API_VERSION` |
| Idempotency | event id on the event row (`payload.meta`) | Prevent double Purchase on replay |
| Registration | `src/handlers/meta-purchase.mjs` | Payment webhook sends Purchase when the money lands |
| Tests | `src/handlers/meta-purchase.test.mjs` | Mock fetch; no live Graph calls in CI |

**User data:** hash email / phone per Meta spec; pass `client_ip` / `user_agent` when available from webhook or session (often missing on CRM-only events — document lowered match quality).

**Attribution:** Read `client_ad_attribution` for `utm_*`; map `utm_content` → ad id via existing `fundhub_ad_id()` logic in DB.

**Non-blocking:** CAPI failures must **log and not block** client creation, booking, or payments (same pattern as `upsertClientAdAttribution` warnings).

---

## 5. Apply survey rebuild — tracking constraints

From extract §4 and §8:

- Preserve **`cf_svy_*`** keys and per-screen webhooks; Meta Lead is **not** tied to webhook count.
- **`entry.captured`** still means New Lead on pipeline; Meta **Lead** aligns with **Survey Complete** (available capital answered), not first contact field.
- Attribution hidden fields unchanged (`utm_*`, `landing_path`, `referrer_domain`, `a1`, `a2`) — CAPI should read stored row, not re-parse CF payloads on every screen.
- Post-submit funnel step stays **`/funding-book-call`** → Schedule fires there, not on `/apply`.

---

## 6. Verification (when implemented)

1. **Unit:** each handler fires at most once per dedupe key; partial survey does not emit Lead.
2. **Scratch sim:** one apply path (personal + business) → expect one Lead, one Schedule; deposit sim → one Purchase (no live card).
3. **Events Manager** (human / Paul): Test Events for pixel `2403674420141513` — compare browser vs server; confirm dedupe with shared `event_id`.
4. **No change** to `npm run marketing:data:bootstrap` scope unless token gains **`ads_management`** / pixel send permission — confirm against Business Manager system user.

---

## 7. Out of scope (this plan)

- Editing Meta campaigns, ad sets, or optimization events in Ads Manager
- Changing Direct ROAS hub script or partner access
- Replacing native CF `Survey/V1` (cutover doc still applies)
- Clarity export (`clarity-export-rate-limit` — separate)

---

**One-line summary:** Lead once when `cf_svy_available_capital` lands (CAPI on `survey.submitted`), Schedule on `booking.created`, ShowedCall on attended call outcomes, Purchase on money canonical events, BackendRevenue on fund — **CRM does not fire Meta on deposit today**; browser pixel is PageView + a few optional fbq customs only.

---

## 8. Browser event test checklist (`apply-survey.html`)

`clickfunnels-fragments/apply-survey.html` calls `fbq('track'` once, through `fhTrack`. Lead and Schedule are the only browser events. ShowedCall, Purchase, and BackendRevenue stay off this page. CAPI is still not in the repo, so the browser `eventID` is ready for a later server send with the same id.

| Check | Pass when | 2026-09-30 |
|-------|-----------|------------|
| Lead | Fires once, on the result screen, only after `cf_svy_available_capital` is answered. Same `event_id` as the later CAPI Lead. | In the fragment: `fhTrack('Lead', 'lead:' + email)` after the result screen, gated on `cf_svy_available_capital` |
| Schedule | Fires when the call is booked (calendar confirm), browser + CAPI, same `event_id`. | Browser slice: `fhTrack('Schedule', …)` when `fh_booking_v1` is written by the live `/funding-book-call` embed. CAPI still not built |
| ShowedCall | Not in this HTML. CRM → CAPI only. | Absent, as planned |
| Purchase | Not in this HTML. CRM → CAPI only. | Absent, as planned |
| BackendRevenue | Not in this HTML. CRM → CAPI only. | Absent, as planned |
| PageView | Optional. Do not add a second pixel if the funnel head already sends one. | Not in this file |
| Unit lock | `src/http/apply-survey-webhook.test.mjs` fails if Lead is not gated on `cf_svy_available_capital`, if Schedule is missing, or if the ingest secret is hardcoded. | In place |

Repo gate for the payload (not Meta): `node --test src/http/apply-survey-webhook.test.mjs`. Browser walk: `npm test -- tests/apply-survey.spec.mjs` inside `clickfunnels-fragments`.
