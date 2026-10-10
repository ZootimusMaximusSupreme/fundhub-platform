# 01 — The doors: can a request run the real handler in "pulse mode"?

Area owner: doors brief. Read-only study, 2026-10-09, main checkout. Board: `ops/workflows/pulse-layer-2026-10-09.md`.

## In plain words

Yes. Every first-beat door can run its real code in pulse mode. Most need no change inside the door file at all.

Here is why. A signal can only leave the building in three ways: the database, a web call, or an Inngest message. The database has one front door in the whole repo, `pool()` in `src/db.mjs`. Web calls all use `fetch`. Inngest has two send spots. So we guard three places, not forty handlers. One edit to `pool()` makes every door save into a test box that is always thrown away. One guard on `fetch` catches every vendor call. Two small edits stop the Inngest sends.

One thing in the board is wrong. It says the door gets "a database" handed in. It does not. `netlify/functions/api.mjs` calls each handler with only `(req, res)` (line 1576). Every handler grabs the shared database itself. So the switch must live in the database file, not in the handlers.

Two traps. First, the pulse could look fine while a handler quietly broke: the event bus catches a failing handler and writes `failed_events` (`src/events/dead-letter.mjs:72`), and the door still says 200. The pulse must read that. Second, a green pulse only proves our half. Vendor calls are caught, not sent, so a dead vendor needs its own read-only probe (those already exist in `src/pulse/coverage/gap-keys.mjs`).

---

## 1. How a request becomes a handler call (facts)

- One Netlify function serves `/api/*`: `netlify/functions/api.mjs`. Default export `handler(request, context)` at line 1439.
- Lookup: `ROUTES[path]` (own properties only, line 1454), then the `webhooks/` prefix (1458-1461), then `documents/` (1464). No match is a 404 JSON at 1470.
- NUL-byte check on query values, then headers lower-cased into a plain object (1488-1489), body read as text and JSON-parsed (1532-1536), `req = { method, url, headers, query, body, rawBody, socket }` (1545).
- `res` is a tiny shim (1558+). `res.json()` resolves the `done` promise.
- The call is `await route(req, res)` at **line 1576**. No `deps`, no db, nothing injected. A handler that returns without writing gets `handler_no_response` 500 (1578). A throw becomes `internal_error` with a scrubbed message (1579+).
- Because `await route()` finishes before `return done` (1588), work a handler does after `res.json()` is still awaited by the adapter. Nothing "after the response" escapes the request unless the handler left a promise un-awaited.
- Every door below imports the shared singleton directly: `import { db } from "../../src/db.mjs"` (survey-submit:4, slo-interest:36, slo-checkout:68, webhooks:11, magic-link, bookings). Three of them accept a third argument `deps` (slo-interest:388, slo-checkout:498) with `deps.db`, `deps.emit`, `deps.fetchImpl`, `deps.fanout`, but the adapter never passes one. The seam exists and is unused in production.
- `src/db.mjs`: the only `new pg.Pool` in non-test code is line 47. `db.query` is `pool().query` (line 77). All 21 files that import `pool` use only `.connect()` or `.query()` on it (grep, no other property). No `DATABASE_URL` read elsewhere creates a connection. So **`pool()` is the single database choke point.**
- `withTransaction` (`src/db/with-transaction.mjs:44-45`) and eight sibling copies do `db === sharedDb ? pool().connect()`. That reaches the real pool and would COMMIT outside any wrapper that only replaced `db.query`. Patching `pool()` itself closes that hole too.

## 2. The three exits, and the one guard for each

| Exit | Where it lives | Guard |
|---|---|---|
| Database write | `pool()` `src/db.mjs:29`; `db.query` `:77` | Change 1 below |
| Web call | `fetch`. Fenced callers use `transmit()` which resolves `fetchImpl \|\| globalThis.fetch` at call time (`src/lib/outbound-fetch.mjs:240, 376`). Raw callers default `fetchImpl = fetch` (e.g. `src/payments/commas-api.mjs:307`). No module captures fetch at load (grep). Only `oxylabs.mjs` uses `node:http(s)`; it is not on any door. | Change 3 below |
| Inngest message | `src/events/bus.mjs:49-53` (`void inngest.send`) and `api/public/slo-interest.mjs:375`. The Inngest client binds fetch **when it is built** (`node_modules/inngest/helpers/env.js:339`, `fetch.bind(globalThis)`), so a later `fetch` patch does NOT catch it. | Change 2 below |
| Other | `@netlify/blobs` only in `src/documents/*` (not on these doors). File writes: none on door paths. Database triggers: no `pg_net` or `dblink` installed (extensions list). `NOTIFY` in `db/migrations/078_alerts.sql` is held until commit. | none needed |

Production facts that matter (read from Netlify, values of plain flags only): `ADAPTERS_DRY_RUN=0`, `MESSAGING_DRY_RUN=0` (both fences OPEN, so the dry-run fence protects nothing), `SLO_DEMO_PAY=0` (checkout takes the real Commas path), `META_CAPI_ENABLED=1`, `CF_CAPTURE_MODE=1`, `INNGEST_EVENT_KEY` and `INNGEST_SIGNING_KEY` set. There is **no `PULSE_SECRET` yet** (names listing). Do not lean on the dry-run flags for pulse safety.

## 3. Cross-cutting change list (build once, every door benefits)

**C1. `src/db.mjs` — pulse scope on `pool()`** (about 40 lines, plus a test file).
- Add an `AsyncLocalStorage` store. Export `runInPulse(store, fn)` and `pulseStore()`.
- `pool()`: if a store is active, return a proxy, else the real pool exactly as today.
- Proxy `.query(sql, params)`: lazily take ONE dedicated client from the real pool on first use, run `BEGIN`, then run the statement on it. Keep a log of `{verb, table, rowCount}` per INSERT/UPDATE/DELETE (cheap regex on the first 80 chars).
- Proxy `.connect()`: return a client view on the same underlying client where `BEGIN` becomes `SAVEPOINT`, `COMMIT` becomes `RELEASE SAVEPOINT`, `ROLLBACK` becomes `ROLLBACK TO SAVEPOINT`, and `release()` does nothing. This makes `withTransaction`, `partners/rls.mjs`, `soft-pulls.mjs` etc. stay inside the outer rollback.
- `store.closed = true` is set before the final ROLLBACK. After that every proxy call throws `pulse_closed`. It must never fall back to the real pool. This is what neutralises orphan promises (slo-interest's ClickFunnels write keeps running past its 3 s wait, `slo-interest.mjs:66,110-142`).
- Do not add `.connect` to the exported `db` object. Adding it would flip the `typeof db.connect === "function"` probes in `src/pii/index.mjs` and `src/documents/register.mjs:46` for live traffic.
- Export a `rawPool()` for the gate only.
- Test (`src/db.pulse.test.mjs`): no store means the real path untouched; store means `pg.Pool.prototype.connect` called once and `COMMIT` never issued; closed store throws; a `withTransaction` inside a store never reaches the real pool.

**C2. Stop the Inngest sends in pulse** (4 lines).
- `src/events/bus.mjs:49`: add `&& !pulseStore()` to the condition and push `{name}` into `store.report.inngestSuppressed`.
- `api/public/slo-interest.mjs:372-380`: same. This branch only runs on a second same-day post that adds a phone, so a pulse with a fresh email per run never reaches it. Still patch it; it is a live leak the day someone adds a phone to the pulse payload.
- The journey runner already documents this exact hazard and uses `skipInngest: true` (`src/journeys/runner/index.mjs:130-154`).
- Add a test that fails if any new `.send(` on an Inngest client appears outside `bus.mjs` without a pulse check (same style as `src/lib/no-unfenced-transmit.test.mjs`).

**C3. `src/pulse/guard.mjs` (new) — `fetch` guard.** Imported first in `api.mjs` and in the pulse runner.
- Replaces `globalThis.fetch` with a wrapper. No store: pass straight through to the original. Store active: never send. Record `{method, host, path}` in `store.report.sends`, return a synthetic `Response`.
- The synthetic answer comes from a per-door `stubs` list (match host and path, give status and JSON), else `202 {"pulse":"captured"}`. Slo-checkout needs stubs or it reports `checkout_failed` (see door 7).
- Needs an allow-list entry in `src/lib/no-unfenced-transmit.test.mjs` (its patterns match `globalThis.fetch`, lines 37-45) with a written reason.

**C4. `src/http/pulse-switch.mjs` (new) + hook in `api.mjs`.**
- Hook point: after `req` is built and before `await route(req, res)` (line 1576). It needs `rawBody` for the signature, so it cannot sit earlier.
- Header: `x-fundhub-pulse: t=<unix>,s=<hex>`, `s = HMAC_SHA256(PULSE_SECRET, t + "." + METHOD + "." + path + "." + sha256(rawBody))`. Window 300 s. Constant-time compare. No `PULSE_SECRET` set means refuse the request, never process it.
- Opt-in list `PULSE_DOORS`, a literal object keyed by the same string `api.mjs` routes on (`"webhooks/commas"`, `"public/survey-submit"`, ...). A header on any other path gets `409 {"error":"pulse_not_supported"}` and the handler is never called.
- Engaged flow: `runInPulse(store, () => route(req, res))`, hard timeout about 20 s, then in a `finally`: set `closed`, `ROLLBACK`, `release(err ? true : undefined)` (destroy the connection if the rollback failed). Run the door's optional `readBack(client)` (cheap SELECTs) and `after(ctx)` (chain step) before the rollback.
- Reply when engaged: HTTP 200 with `{ pulse: { engaged: true, handlerStatus, rolledBack: true, statements, writes: [{verb,table,n}], sends: [...], inngestSuppressed: [...], failedEvents: n }, handler: <original body> }`. The runner reads the handler's real status from `handlerStatus`.
- Test: every `PULSE_DOORS` key resolves through the same lookup `api.mjs` uses; a throwing route is never called when a non-opted path carries a valid header; a bad or old signature never reaches the route.

**C5. Env.** `PULSE_SECRET` is new. Set it per `.claude/rules/secrets-env-law.md` (full value to `.env` and `credentials/env.full.snapshot` first, Netlify without `--secret`). Not set by this brief.

**C6. Heartbeat row** in `src/pulse/registry.mjs` for the runner and for each opted-in door (law: `.claude/rules/heartbeat-on-every-build.md`). `routes.test.mjs` is unaffected because C4 adds no `ROUTES` key.

### Where I disagree with the board text

1. Board: "A wrong or old signature is a normal request." Recommend **refuse** (401), not fall through. A clock skew or a secret mismatch would otherwise run a pulse body as a live request. A real client never sends this header, so refusing costs nothing.
2. Board: "the door has a database whose changes are rolled back." No database is passed in (see section 1). The scope has to be an `AsyncLocalStorage` store read by `pool()`.
3. Board names `webhooks:calendar-booking` as its own door. It is not. Booking webhooks arrive on the ClickFunnels hook (`src/pulse/coverage/gap-webhooks.mjs:3-4,60-63`; the Cal.com provider alias table is empty, `router.mjs` PROVIDER_ALIASES). One door, two payload shapes.
4. `api/bookings.mjs` is not a booking door. It is a staff-only GET list (`bookings.mjs:44-51`). Booking creation is the ClickFunnels webhook.

---

## 4. Synthetic identity (use on every door)

`pulse-test+fhtest-<runid>@example.com`, no phone, name "Pulse Test".
- `classifyVisitor` marks `example.com` and `test`-segment locals as `agent` (`src/slo/visitor.mjs:25-29`). That alone keeps the ClickFunnels copy and the Meta send away on slo-interest (`src/meta/track-send.mjs:57`, `slo-interest.mjs:112`) and keeps `slo-genuine-followup` from running (it skips non-person, `slo-genuine-followup.mjs:122`).
- `isTestEmail` (`src/demo/test-identity.mjs:63`) matches the `+fhtest` segment, so any client the code creates is born `is_demo = true` (`demoFlagForEmail`, `:84`). Two separate detectors, so the address carries both tags on purpose.
- Unique `<runid>` per run so unique indexes never wait on a parallel run.
- No phone: a phone is what turns a leaked lead into a text.

---

## 5. Door by door

Legend: **R** reads, **W** writes. Costs are DB round trips (BEGIN and ROLLBACK add 2). Measured from this laptop to Supabase: connect 189 ms, each statement about 45 ms; a bare GET to a no-DB route 0.2-0.6 s. Netlify-side numbers are unmeasured. Statement counts for the long doors are read from code, not run.

### Door 1. `POST /api/webhooks/commas` (payment receipt door)

- Files: `api/webhooks/[provider].mjs` (db import :11, `handleWebhook({db,...})` :70) → `src/http/router.mjs` `handleWebhook` :300 → `STD.commas` :64 → `handleCommasWebhook` `src/adapters/commas.mjs:570`.
- Signature: `x-webhook-signature` (or `x-commas-signature`), hex HMAC-SHA256 of the raw body keyed `COMMAS_WEBHOOK_SECRET` (`commas.mjs:53,67`). A second key `SIM_WEBHOOK_SECRET` is accepted only for a body with `simulated:true` (`:80-128`). The runner on Netlify can sign with the real key (it is a runtime env var). The pulse cannot prove the key matches Commas' side, only that our verification and the configured key agree.
- R: `orgs` (default org, cached after first call, `events/bus.mjs:169`), `commas_inbox` (dedupe SELECT). W: `commas_inbox` INSERT (`payments/commas-inbox.mjs:96`), `webhook_captures` INSERT (`router.mjs:259`, status 200 only). Both tables have policy `true`, so the unprivileged app role writes them (checked in `pg_policies`).
- Events: none at request time. By design the request only stores the bytes; the sweeper turns them into events later (`commas.mjs` header, `netlify/functions/commas-inbox-sweeper.mjs`).
- Outbound: none. After-response work: none. Uses `db` passed from the handler's imported singleton, so C1 covers it.
- Synthetic payload: enveloped `{ id, type:"payment.pending", created_at, data:{ payment_id:"pulse_<runid>", amount_cents:0, simulated:true } }`. A type that is neither succeeded, failed, refund, dispute, cancel nor expired maps to nothing (`commas.mjs:430-540`), so even if pulse mode failed to engage, the worst live outcome is one `ignored` inbox row. Fixture shapes: `scripts/sim/push-payment.mjs:33-48`.
- Green means: `handlerStatus` 200, `queued:true`, `signedWith:"live"`, writes include `commas_inbox` x1 and `webhook_captures` x1, `sends` empty.
- **Verdict: SMALL.** C1 + C4 only. Zero edits to the door files.
- Stage 2 (BIG, later): after the door, in the same rolled-back box, call `processCommasInboxRow(row, db)` (`commas.mjs:768`) with a `payment.succeeded` body to prove the sweeper half and the money chain. That fires `payment.received` handlers (money-chain, purchase-routing, Meta Purchase, staff alerts, clarity-autopay, `register-all.mjs`) which transmit and write across many tables. Do it only after C3 is proven.

### Door 2. `POST /api/webhooks/clickfunnels` — lead / survey (signed)

- Same router path; `STD.clickfunnels` :72 → `handleClickFunnelsWebhook` `src/adapters/clickfunnels.mjs:820`.
- Signature: `x-webhook-clickfunnels-signature` plus `x-webhook-clickfunnels-timestamp`; HMAC of `<ts>.<rawBody>` keyed `CLICKFUNNELS_WEBHOOK_SECRET`, within 600 s (`:31-52`).
- R/W: `orgs`; `clients` (find or create, `handlers/client-lifecycle.mjs:209`); `client_ad_attribution`; `events` (`bus.mjs:27`); `clients.custom_fields`, `client_custom_fields`, `clients.tags`, `cards` (`workflows/cards.mjs:98-107`); `webhook_captures` (`clickfunnels.mjs:865`, since `CF_CAPTURE_MODE=1`); `slo` connection reads (`handleSloPaidWebhook`, `:875`, a no-op for a non-paid event); dedupe read on `events` (`isRepeatFunnelPost` :692).
- Events: `entry.captured`, and `survey.submitted` when answers are present (`mapToCanonical` :798). Local handlers: `client-lifecycle.mjs:571-572` (database only).
- Outbound: (a) CRM contact create for a brand-new client, `resolveClient` → `syncCrmContact` → `transmit()` GHL upsert, behind the ADAPTERS fence which is OPEN in prod (`client-lifecycle.mjs:96-120`, `messaging/crm-contacts.mjs:92-96`). Real GHL write unless caught. (b) Inngest send per emitted event (`bus.mjs:49`, not skipped here: `clickfunnels.mjs:991`). (c) For apply-survey posts only, `syncApplySurveyClickfunnelsContact` → ClickFunnels contact upsert through `transmit()` (`:1010`).
- After-response: none. Uses the router's passed `db`, so C1 covers it.
- Synthetic payload: `{ event_type:"contact.created", id:"pulse-<runid>", data:{ email_address, first_name:"Pulse", last_name:"Test", custom_attributes:{ cf_svy_* from src/survey/cf-question-map.mjs } } }`. Use `normalizeClickFunnelsEvent` (:254) in the runner's own check to confirm it yields an email and `answers`. Fixtures: `src/adapters/clickfunnels.test.mjs:52-90, 200-240`.
- Green means: 200, `emitted` has two entries each with a non-null `clientId`, writes include `clients`, `events` x2, `cards`; `failedEvents` 0; `sends` shows one GHL upsert attempt captured; `inngestSuppressed` x2.
- Trap: `resolveIngestClientId` swallows errors and returns null (`:648-665`), so a broken client resolver still returns 200. The beat must assert `clientId` is not null.
- **Verdict: SMALL.** C1-C4. Stub for GHL optional (a 202 just yields `ghl_link_missing`, rolled back).

### Door 3. `POST /api/webhooks/clickfunnels` — apply-survey browser post

- Same code; takes the unsigned branch when the header `x-fundhub-apply-survey-ingest` equals `CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET` (`clickfunnels.mjs:490-500, 834-851`). Also answers a CORS preflight for `https://apply.fundhub.ai` (`[provider].mjs:44-58`, OPTIONS returns 200 before anything).
- Payload: `{ source:"apply-survey", email, name, step_key:"pulse", answers:{...}, attribution:{utm_source:"pulse"} }` (`wrapApplySurveyIngestBody` :505). Outbound adds the ClickFunnels contact upsert (`:594`), which only runs with `CLICKFUNNELS_API_KEY` and subdomain set; C3 catches it.
- **Verdict: SMALL.** Same as door 2.

### Door 4. `POST /api/webhooks/clickfunnels` — calendar booking

- Same code. Types: `appointments/scheduled_event.created / rescheduled / canceled` (`clickfunnels.mjs:65-67`).
- Events: `booking.created` etc. Handlers `handlers/comms.mjs:468-509` (tasks, `bookings` upsert `bookings/store.mjs:187`, tags, custom fields, card). Database only. `findBookingBySlot` / `adoptEarlierBooking` read and write `bookings` (:716, :760).
- Outbound: same as door 2 (GHL for a new client, Inngest). No text or email is sent by the local handlers; the confirmation text is an Inngest workflow, which C2 suppresses.
- Payload: copy `cfAppointment()` from `src/adapters/clickfunnels-booking-moves.test.mjs:34-65` (`data.primary_contact.email_address`, `start_on`, `end_on` in the future, `event_type`, `event_id`). Keep `start_on` a day out so the slot dedupe finds nothing.
- Green means: 200, one `booking.created` emitted with a client id, writes include `bookings` x1 and `tasks` x1, `failedEvents` 0.
- **Verdict: SMALL.** Add one more: send `rescheduled` and `canceled` in a second beat only after this passes (they read the earlier row, so they need the created row in the same box; a chain, not a separate request).

### Door 5. `POST /api/public/survey-submit`

- `api/public/survey-submit.mjs`. Validator `parseSurveySubmitBody` (:51, exported) and `classifySurvey`. `runSurveySubmit(parsed, deps)` (:116) already has `deps.db`, `deps.emit`, `deps.resolveClient` seams; the default handler (:170) passes none.
- R/W: `orgs`; `clients` find or create (`resolveSurveyClient` :95 → `resolveClient`); `events` x2 (`entry.captured` :143, `survey.submitted` :147, idempotency key includes `Date.now()`); then the same handler writes as door 2 (`client-lifecycle.mjs:285-335`): `custom_fields`, `client_ad_attribution`, tags, `client_custom_fields`, `cards` (stage `survey_complete` when `cf_svy_available_capital` is present, `:324`).
- Outbound: GHL upsert for a new client (as door 2); Inngest x2 (`bus.mjs:49`, not skipped). After-response: none. Direct `db` singleton: C1 covers it.
- Payload: `{ name:"Pulse Test", email, source:"pulse", answers:{ cf_svy_available_capital: <label from src/survey/cf-question-map.mjs> } }`. Use `parseSurveySubmitBody` in the runner to prove the payload is valid before sending.
- Green means: 200 `{ok:true, qualification, redirect, clientId}` with `clientId` non-null (a swallowed resolver error returns null here too, `:112-114`), writes include `clients`, `events` x2, `cards`; `failedEvents` 0.
- Cost: about 30-50 statements (estimate) so about 1.5-2.5 s; the slowest door.
- **Verdict: SMALL.** C1-C4, no file edit.

### Door 6. `POST /api/public/slo-interest`

- `api/public/slo-interest.mjs`. `recordInterest(body, deps)` :161 with `deps.db`, `deps.emit`, `deps.syncCf`, `deps.fanout`, `deps.env`. Kinds: `visit`, `contact`, `engage`, `page`, `click`, `track`.
- `contact` kind: R `orgs`, `events` (dedupe); W `events` row `slo.contact_started` (key `slo-contact:<email>:<phoenix day>`, :302, allowNonCanonical). Then `startCfWrite` → ClickFunnels contact upsert (`:110`) and the follow-up fan-out. With the synthetic identity the actor is `agent`, so `startCfWrite` returns null (`:111`) and nothing leaves; Meta is also skipped.
- Outbound that could still fire: Inngest `slo.contact_started` (the `skipInngest` flag is false only for `contact`, :309; C2 handles it). The direct `void inngest.send` at :375 (second same-day post).
- After-response work: `settleWithin(cfWrite, 3000)` and `settleWithin(metaSend, 4000)` run after `res.status(200).json()` (:418-421) but are awaited by the adapter. The ClickFunnels job can outlive its 3 s wait; its later `UPDATE events` goes through `pool()` after the store closed, so it throws `pulse_closed`, which the code catches (:136-140). That is fine, and it is exactly why C1 must fail closed.
- Payload: `{ kind:"contact", email, first_name:"Pulse", session_id:"pulse<runid>" }`, plus a second beat `{ kind:"visit", session_id }` (cheapest: one `events` insert, `skipInngest` true, no outbound).
- Green means: 200 `{ok:true, actor:"agent", saved:true}`; writes include `events` x1.
- Also free: the `GET` form of this route answers `{ok:true}` with no database use (:393). Use it as the **handshake** for C4 (a signed GET must come back `pulse.engaged:true` before any POST goes out; a body is sent only after the deployed bundle proves it understands the header).
- **Verdict: SMALL.** C1-C4. Optional 3-line edit at :375.

### Door 7. `POST /api/public/slo-checkout` (roadmap order mint)

- `api/public/slo-checkout.mjs`. Validator `parseSloCheckoutBody` :231 (exported); `runSloCheckout(parsed, deps)` :301 with a rich `deps` seam (`resolveBuyer`, `createCheckoutSession`, `recordLink`, `fetchImpl`, ...).
- R/W: `orgs`; `clients` (`resolveSloBuyer`, `slo/buyer.mjs`), `accounts` (new client only), `client_ad_attribution`, `events` `slo.checkout_started` (:382), `payment_links` (`recordSloPaymentLink`), `products` read.
- Events: `slo.checkout_started` is emitted WITHOUT `skipInngest` (:382-401), so it goes to Inngest in prod. C2 covers it.
- Outbound: with `SLO_DEMO_PAY=0` (prod now) it makes **two real Commas calls**: `POST {base}/checkout-sessions` (:437) and `POST .../checkout-sessions/embedded` (:464), both raw `fetch` in `src/payments/commas-api.mjs:373,471`. Each creates a session (a product record) on Commas. Unguarded, an hourly pulse would create 24 a day. The pulse must not send these.
- With C3 the calls are caught. To get a clean pass the guard needs two stubs: `*/checkout-sessions` → `200 {"data":{"payment_link":"https://pay.example/pulse","id":"pulse-1","checkout_session_id":"pulse-1"}}` and `*/checkout-sessions/embedded` → `200 {"checkout_session_secret":"pulse"}` (shapes from `commas-api.mjs:402-420, 470-500`). Otherwise the door answers 502 `checkout_failed` (:437-440) and the beat goes red for a fake reason. The stubs also mean this beat proves **our** half only (validator, buyer, order row, amount, event, link row). Vendor liveness stays with the read-only key probe in `src/pulse/coverage/gap-keys.mjs`.
- Payload: `{ email, first_name:"Pulse", last_name:"Test", business_count:1 }`. Do NOT send a `businesses` array: that path runs `replaceSloBusinesses` → `withTransaction` (`slo/businesses.mjs`); C1 contains it, but there is no need to test it hourly.
- Green means: 200 `{ok:true, demo:false, ref:"slo_...", priceCents:29700, embedded:{...}}` (price from `sloCheckoutTotalCents(1)`), writes include `payment_links` x1 and `events` x1, `sends` lists exactly the two Commas URLs, nothing else.
- Owner decision, flagged once: whether to ever allow ONE real mint per day (proves Commas end to end, costs one dashboard record per run). Everything above assumes no.
- **Verdict: MEDIUM.** C1-C4 plus the two stubs. No file edit.

### Door 8. Sign-in link: `POST /api/auth/magic-link` (and `/magic-link-verify`)

- `api/auth/magic-link.mjs` → `requestMagicLink` `src/auth/magic-link.mjs:147`. The response never carries the token (header :1-26, reply :78-93). `verify` is `api/auth/magic-link-verify.mjs` → `verifyMagicLink` :393.
- Request path R: `orgs`, `account_magic_links` (rate limit count, `checkLinkRate` :300), `accounts`, `clients`. W: `account_magic_links` INSERT (:192), `messages` INSERT status `queued` via `sendTemplated` (`workflows/messaging.mjs:153`; needs template `EMAIL-PORTAL-MAGIC-LINK`, seed `db/seed/007_portal_magic_link_template.sql`). **Nothing transmits**: queue only (header :41-47). No events. No outbound. No after-response work. `db` singleton: C1 covers it.
- The rate limiter counts rows only, so rolled-back runs never accumulate and never throttle real people.
- A request with no matching client or account yields `no_account`, no token, no email (:175-185). So the pulse needs a fixture client in the box, or it only proves the uniform reply.
- Two ways:
  - **Request only (SMALL):** the pulse's `seed(client)` inserts a `clients` row for the synthetic email (the same insert `resolveClient` makes), then the request runs. Green means: 200 uniform message, and `readBack` finds one `account_magic_links` row with `outcome='issued'` and one `messages` row `status='queued'` whose body contains `portal-login.html?t=`.
  - **Round trip (MEDIUM):** `after(ctx)` pulls the token out of that queued message body inside the same box, then calls `ROUTES["auth/magic-link-verify"]` (exported from `api.mjs`) with `{token}`. Green means: 200 with `principal: "client"` and a `Set-Cookie`. Rows written: `account_sessions`, `accounts` (auto-provisioned), `account_magic_links` used flag. All rolled back. This one hook proves the full sign-in loop with no mailbox.
- The reply wrapper (C4) must keep the real `Set-Cookie` out of the report (strip it).
- **Verdict:** request = SMALL; round trip = MEDIUM (one `after` hook, no door edit).

### Door 9. `GET /api/bookings`

- `api/bookings.mjs`. Staff session only (`requirePrincipal(req,res,["staff"],{db})` :44). Read only, SQL in `src/bookings/store.mjs`. No writes, no events, no outbound.
- Without a staff token a pulse can only see 401, which proves the route and the auth gate are alive (no data check).
- To exercise the real read, `seed` would mint a staff session inside the box (the session helpers in `src/auth/session.mjs`), and `after` would call the route with that token. That is real work and touches staff tables with row security.
- **Verdict: PING-ONLY for now** (signed GET, expect 401 as proof of life). MEDIUM later if wanted.

---

## 6. Verdict table

| Door | Verdict | What it needs beyond C1-C4 |
|---|---|---|
| webhooks/commas (receive and store) | SMALL | nothing |
| webhooks/clickfunnels lead + survey | SMALL | nothing |
| webhooks/clickfunnels apply-survey | SMALL | nothing |
| webhooks/clickfunnels booking | SMALL | nothing (reschedule and cancel are a chain, later) |
| public/survey-submit | SMALL | nothing |
| public/slo-interest | SMALL | optional 3-line edit at :375 |
| public/slo-checkout | MEDIUM | two Commas stubs; owner call on a real daily mint |
| auth/magic-link request | SMALL | fixture client in `seed` |
| auth/magic-link round trip | MEDIUM | `after` hook |
| bookings (staff GET) | PING-ONLY now | staff-session fixture if wanted |
| Commas → inbox → money chain | BIG (stage 2) | in-box `processCommasInboxRow`, many outbound handlers |
| Real vendor sends and real Commas mint | NOT a door | stay as read-only vendor probes |

The only door-file edit in the whole list is the optional one at `slo-interest.mjs:375`. The rest is C1-C4.

## 7. Risks the build must close (ranked)

1. **Engaged-or-nothing.** If the deployed bundle lacks C4, the header is ignored and the body is processed live. Defence: signed GET handshake first; inert payloads (commas type with no mapping, no phone, test identity); refuse on any invalid header.
2. **Fail closed after rollback.** Orphan promises (slo-interest ClickFunnels job, any `void`) must hit `pulse_closed`, never the real pool. Test it.
3. **Inngest is outside the fetch guard** (client binds fetch at build). C2 is mandatory, with a test.
4. **Silent success.** The bus swallows handler errors into `failed_events` (`dead-letter.mjs:72`), and several steps swallow and log (`clickfunnels.mjs:648-665`, `survey-submit.mjs:95-114`, `client-lifecycle.mjs:124-138`). The report must count `failed_events` inserts and assert non-null client ids, or green lies.
5. **Connection hygiene.** A failed ROLLBACK must destroy the connection, not return it to the pool (`release(true)`). A pulse holds one session-pooler connection per door for its duration; 8 doors in parallel is 8 at once (pool max is 10, `src/db.mjs:49`, and real traffic shares the project limit, which I could not read).
6. **Savepoint proxy correctness.** Any code that runs `SET` (not `SET LOCAL`) is fine inside the box (a rolled-back transaction reverts it), but the `pool()` proxy must not swallow errors that abort the transaction: after an aborted statement, later statements fail until `ROLLBACK TO SAVEPOINT`. Handlers that catch an error and carry on (many do) rely on their own savepoints; an un-savepointed failure turns the rest of the request red. That is a false red, not a leak. Add a savepoint around each proxied `.query` only if tests show it.
7. **False green from stubs.** Caught vendor calls prove nothing about the vendor.
8. **Memory caches** (`_orgCache` in `events/bus.mjs:169`, `auth/org.mjs:7`, `meta/token.mjs:35`) hold ids and tokens, never fixture rows. Low risk. Re-check if a cache of a created row is added.

## 8. Timing (honest)

- HTTP hop from the scheduled function to its own site: 0.2-0.6 s (measured from this laptop; Netlify-to-Netlify is unmeasured). A cold `api` function adds seconds because `api.mjs` imports the world; unmeasured.
- Per statement about 45 ms, connect about 190 ms (laptop to Supabase; the function's region is likely closer, unmeasured).
- Estimated per door: commas 5 round trips (about 0.25 s) + hop; slo-interest visit 4-6; magic-link request 8-12; slo-checkout 15-25; CF lead 25-40; survey-submit 30-50 (slowest, about 1.5-2.5 s).
- All doors run in parallel, so the whole pulse is the slowest door plus one hop plus the handshake: about 2-3 s warm. Half a second is only reachable for the no-database ping beats.

## 9. Unknowns (looked, could not settle)

- Whether `PULSE_SECRET` should be `--secret`. The env law says no for anything a laptop or cloud session must read.
- Netlify function region and the real Supabase pooler client cap.
- Whether the scheduled function sees `COMMAS_WEBHOOK_SECRET` and `CLICKFUNNELS_WEBHOOK_SECRET` (set `--secret`, which hides them in the CLI). The deployed `api` function does read them, and both functions share the site's variables unless a scope was set. Unverified.
- Whether Netlify strips or limits an unknown request header: no sign it does; handshake will show.
- Real statement counts per door: only estimates until a scratch database run (no local Postgres on this Mac; running a door in the box against production is a write path and was not done).
