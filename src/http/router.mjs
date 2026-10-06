// Webhook router — the single entrypoint every inbound provider webhook flows
// through. Framework-agnostic: takes the raw request pieces, picks the adapter,
// hands it the right signature header + secret, and returns { status, body }.
// The thin Vercel function in api/webhooks/[provider].mjs just adapts req/res to
// this. Handlers are registered on first call so a cold serverless start still
// wires the reactions before dispatching.

import { ensureRegistered } from "../register-all.mjs";
import {
  handleCommasWebhook,
  SIGNATURE_HEADERS as COMMAS_SIG_HEADERS
} from "../adapters/commas.mjs";
import { handleClickFunnelsWebhook } from "../adapters/clickfunnels.mjs";
import { handleBlandWebhook } from "../adapters/bland.mjs";
import { handleTwilioWebhook } from "../adapters/twilio.mjs";
import { handleMailgunWebhook, handleMailgunDeliveryEvent } from "../adapters/mailgun.mjs";
import { handleTwilioStatusWebhook } from "../adapters/twilio-status.mjs";
import { handleResendDeliveryEvent } from "../adapters/resend-events.mjs";
import { handleLendflowWebhook, SIGNATURE_HEADER as LENDFLOW_SIG } from "../adapters/lendflow.mjs";
import {
  handleInquiryRemovalWebhook,
  SIGNATURE_HEADER as INQUIRY_REMOVAL_SIG
} from "../adapters/inquiry-removal.mjs";
import {
  verifyMailWebhook,
  parseMailDeliveryEvent
} from "../messaging/providers/mail-letter.mjs";
import { onMailDelivered } from "../inquiry-ops/call-scheduler.mjs";
import { onRepairEvent } from "../repair/handlers.mjs";
import * as submagicProvider from "../messaging/providers/submagic.mjs";
import { recordSubmagicWebhook } from "../ad-videos/pipeline.mjs";
import { parseMerchantProvider, handleMerchantWebhook } from "../merchant/webhooks.mjs";

/* PROVIDER TABLES ARE NULL-PROTOTYPE. Read this before turning either of the
   two below back into a plain `{}` literal.

   The provider id comes straight off the URL, unauthenticated, from anyone on
   the internet. A plain object literal inherits every member of
   Object.prototype, so `STD["toString"]` returned Object.prototype.toString —
   a truthy value that sailed past the `if (!cfg) return 404` guard and then
   threw TypeError at `cfg.fn(...)`, which api/webhooks/[provider].mjs turned
   into a 500. Same for valueOf, hasOwnProperty, isPrototypeOf, toLocaleString
   and propertyIsEnumerable. `constructor` was worse in a different way: it
   resolved to the Object constructor, missed the STD table, and the 404 body
   interpolated it into the string "unknown provider: function Object() {
   [native code] }" — internals handed back to an unauthenticated caller.

   A table with no prototype has no inherited members to find, so every one of
   those ids is simply absent and answers a clean 404. This is the same defence
   src/http/sync-accounts.test.mjs already pins for the banking provider list. */
const table = (entries) => Object.assign(Object.create(null), entries);

// Standard HMAC-body adapters: same {db, rawBody, signatureHeader, secret} shape.
const STD = table({
  /* `sig` may be a LIST, tried in order. Commas signs with
     `x-webhook-signature`; this table named `x-commas-signature`, which no
     delivery has ever carried, so every real payment webhook failed
     verification and answered 401. The old name is kept as a fallback. */
  /* `simEnv` is a SECOND accepted key, and commas is the only provider with one.
     It exists because COMMAS_WEBHOOK_SECRET is stored on Netlify with --secret and
     reads back as a mask, so the walkthrough's simulated receipts could never be
     signed (F26, 2026-09-03). The adapter offers this key ONLY to a body carrying
     the `simulated` marker, so it cannot post traffic that looks live. */
  commas: {
    fn: handleCommasWebhook,
    sig: COMMAS_SIG_HEADERS,
    env: "COMMAS_WEBHOOK_SECRET",
    simEnv: "SIM_WEBHOOK_SECRET"
  },
  /* CF 2.0 docs: X-Webhook-ClickFunnels-Signature (+ Timestamp). Legacy
     x-clickfunnels-signature kept as fallback for internal probes. */
  clickfunnels: {
    fn: handleClickFunnelsWebhook,
    sig: ["x-webhook-clickfunnels-signature", "x-clickfunnels-signature"],
    env: "CLICKFUNNELS_WEBHOOK_SECRET"
  },
  bland: { fn: handleBlandWebhook, sig: "x-bland-signature", env: "BLAND_WEBHOOK_SECRET" },
  /* lendflow was written, tested and documented as live — and never registered
     here, so /api/webhooks/lendflow answered 404. It is the SOLE emitter of
     round.started / round.submitted / round.approved / round.funded, so eight
     workflows (f-02, f-03, f-04, f-07, f-08, f-10, sys-01, bc-02) and back-end
     commission accrual had no trigger at all. The adapter's own header comment
     points at this table as the place the wiring belongs. */
  lendflow: { fn: handleLendflowWebhook, sig: LENDFLOW_SIG, env: "LENDFLOW_WEBHOOK_SECRET" },
  /* IRA runtime → platform bridge. Writes inquiry_removal_cases / inquiry_log
     and emits inquiry.removed when a case clears. */
  "inquiry-removal": {
    fn: handleInquiryRemovalWebhook,
    sig: INQUIRY_REMOVAL_SIG,
    env: "INQUIRY_REMOVAL_WEBHOOK_SECRET"
  }
});

/* PROVIDER ID ALIASES — the URL segment is not always the STD key.
   Cal.com used to live here as `cal` → `calcom`. Owner deleted that vendor
   2026-08-23. The table stays (null-prototype) so a later alias cannot inherit
   Object.prototype the way STD used to. Empty on purpose.

   Deliberately NOT fixed by adding extra keys to the ROUTES map in
   netlify/functions/api.mjs — see src/http/routes.test.mjs. */
const PROVIDER_ALIASES = table({});

/* IS THE ADAPTER ALREADY WRITING THE RECEIPT?

   Exactly one webhook_captures row per delivery. Two writers is a duplicate;
   zero writers is the bug this function exists to prevent.

   ClickFunnels is the only adapter that writes its own row, and it does so
   CONDITIONALLY: src/adapters/clickfunnels.mjs inserts only when
   process.env.CF_CAPTURE_MODE === "1". That flag is unset on Netlify
   (docs/E2E-REPORT.md, ops/workflows/e2e-verify-run4.md), so in production the
   adapter writes nothing — and while this router skipped ClickFunnels
   unconditionally, one writer minus a default-off flag was ZERO receipts for
   the provider that carries every real booking in the system.

   process.env, NOT the `env` argument, deliberately. `process.env.CF_CAPTURE_MODE`
   is the exact expression the adapter's own gate reads. The only question worth
   asking here is whether THAT gate is open, so this must read the same place it
   does. Keying off the injected `env` would let the two disagree and produce
   either two rows or none for a single delivery — precisely the failure this
   guards against. */
function adapterWritesItsOwnCapture(provider) {
  return provider === "clickfunnels" && process.env.CF_CAPTURE_MODE === "1";
}

/* THE STORED BODY IS CAPPED.

   One row per delivery, no retention job, on a shared production Postgres — and
   a verified 2,000,056-byte body was stored whole. A provider that redelivers a
   large payload, or an authenticated integration that misbehaves, can grow this
   table without bound.

   WHY 64 KiB. Real inbound bodies are nowhere near it: a ClickFunnels order
   is 5–15 KB, a Twilio form post under 2 KB, a
   Mailgun event ~3 KB. 64 KiB stores every one of those verbatim with room to
   spare, while capping the worst case at 64 KiB per delivery instead of the
   platform's 6 MB request limit. The receipt's job is to prove a delivery
   arrived and record what we decided about it — not to be a byte-perfect
   archive. Re-verifying the HMAC off a stored body is not something the cap
   takes away either: capture runs only after the adapter already verified, and
   the signature header is kept alongside.

   TRUNCATION IS MARKED IN THE VALUE ITSELF. A silently shortened payload is a
   worse debugging trap than no payload at all — an operator would read the
   short body as the whole delivery and chase a parsing bug that never existed.
   The marker also breaks JSON parsing on purpose: a truncated body should fail
   loudly rather than parse into a half-object. The row is never dropped; that a
   big delivery arrived is exactly the fact worth keeping. */
const MAX_CAPTURED_BODY_BYTES = 64 * 1024;

function capCapturedBody(rawBody) {
  const body = String(rawBody ?? "");
  const bytes = Buffer.byteLength(body, "utf8");
  if (bytes <= MAX_CAPTURED_BODY_BYTES) return { body, truncated: false, bytes };
  /* Cut on BYTES, not characters, because the cap is about storage. A cut can
     land mid-UTF-8-sequence; the decoder turns that tail into one replacement
     character, which is harmless next to an explicit marker saying the value is
     incomplete. */
  const kept = Buffer.from(body, "utf8")
    .subarray(0, MAX_CAPTURED_BODY_BYTES)
    .toString("utf8");
  return {
    body:
      `${kept}\n\n[TRUNCATED BY WEBHOOK CAPTURE: stored ${MAX_CAPTURED_BODY_BYTES} ` +
      `of ${bytes} bytes; the original delivery was longer than this value]`,
    truncated: true,
    bytes
  };
}

/* Header names that are never worth persisting. A bearer token, cookie or API
   key on an inbound request is a credential, and this table is long-lived
   storage. Signature headers ARE kept: an HMAC of the body is evidence, not a
   secret, and it is the thing an operator needs in order to debug a
   verification failure. */
const CAPTURE_HEADER_DENYLIST = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token"
]);

function captureHeaders(headers = {}) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (CAPTURE_HEADER_DENYLIST.has(String(k).toLowerCase())) continue;
    out[String(k).toLowerCase()] = typeof v === "string" ? v : String(v ?? "");
  }
  return out;
}

/* THE INBOUND RECEIPT. Every provider webhook that VERIFIED lands in
   webhook_captures, here, at the one chokepoint they all pass through.

   WHY THIS EXISTS. PostGrid and Bland both answered their signed test pings
   correctly — PostGrid with `ignored: true` for a letter.updated that is not a
   delivery, Bland with `not_completed` for a call that has not finished — and
   both of those early returns are correct by design and are left exactly as
   they were. The defect was that neither left any trace, so from the outside an
   operator could not tell "received and ignored on purpose" from "vanished".
   A receipt answers that question. Changing the early returns would break the
   behaviour nobody complained about.

   Before this, db/migrations/145_webhook_captures.sql had exactly one writer in
   the entire repo (clickfunnels), so the table only ever described one
   provider. */
async function captureInboundWebhook({ db, provider, rawBody, headers, env, out }) {
  /* Kill switch, DEFAULT ON. Set WEBHOOK_CAPTURE=0 to disable. It must default
     on: a capture that is off unless someone opts in fixes nothing, and the
     missing-receipt bug would still reproduce out of the box. Deliberately NOT
     reusing CF_CAPTURE_MODE — that flag is ClickFunnels-specific and is off by
     default. */
  const flag = String(env?.WEBHOOK_CAPTURE ?? "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off") return;

  /* *** VERIFIED TRAFFIC ONLY — DO NOT WIDEN THIS CONDITION. ***
     Signature verification happens INSIDE each adapter, never in this file. The
     only signal the router gets back is the response, and a normalised 200 is
     the one value that means "the adapter accepted it". Every adapter answers
     401 `bad_signature` when the HMAC does not check out.

     If this also captured 401s / 404s / 400s, anyone on the internet could fill
     the table by POSTing garbage at /api/webhooks/<anything> — an
     unauthenticated storage-exhaustion hole on a shared database. Unverified
     bytes are not evidence; they are someone else's writable disk. */
  if (!out || out.status !== 200) return;

  /* A CLIENT'S OWN merchant webhooks (merchant-whop/<id>, merchant-commas/<id>)
     are not captured here. Their verified payload is already stored, once,
     in merchant_events.raw — scoped to that client's connection. A second
     copy in this table (no row security, no org, no retention) would put the
     client's customers' details somewhere nothing scopes or clears. */
  if (parseMerchantProvider(provider)) return;

  if (adapterWritesItsOwnCapture(provider)) return;
  if (!db || typeof db.query !== "function") return;

  /* org_id stays NULL, matching every row already in the table.
     At this point in the request the tenant is genuinely unknown: provider
     webhook ids are global, not per-org, and attribution happens later, inside
     the adapter and its handlers, from the payload. Stamping the default org
     would invent an answer the router does not have. The column is nullable,
     this table carries no row-level-security policy, and nothing reads it
     org-scoped, so NULL is both honest and free.

     `parsed` records the router's DECISION — the status and the response body
     the provider received. raw_body already holds the payload verbatim, so the
     parsed payload is recoverable from it; what was missing, and what these
     tickets are actually about, is what we did with it.

     When the body was capped, `parsed` carries the same fact as a queryable
     field, so an operator can find truncated receipts with SQL instead of
     scanning text. */
  const capped = capCapturedBody(rawBody);
  try {
    await db.query(
      `INSERT INTO webhook_captures (org_id, provider, headers, raw_body, parsed)
       VALUES ($1,$2,$3,$4,$5)`,
      [
        null,
        String(provider),
        JSON.stringify(captureHeaders(headers)),
        capped.body,
        JSON.stringify({
          status: out.status,
          outcome: out.body ?? null,
          ...(capped.truncated
            ? {
                raw_body_truncated: {
                  stored_bytes: MAX_CAPTURED_BODY_BYTES,
                  original_bytes: capped.bytes
                }
              }
            : {})
        })
      ]
    );
  } catch (err) {
    /* A capture failure must NEVER break a webhook. The provider is waiting on
       a 200 and will retry without one; a missing audit row is a far smaller
       problem than a redelivery storm. Same contract as clickfunnels.mjs. */
    console.warn(
      `[webhooks] capture failed for ${provider} (non-fatal): ${String(err?.message || err)}`
    );
  }
}

const norm = (res) => ({ status: res.status || (res.ok ? 200 : 400), body: res });

/* handleWebhook({ db, provider, rawBody, headers, url, env }) → { status, body }

   A thin wrapper around dispatchWebhook so there is ONE capture point rather
   than a capture call sprinkled at each of the dispatcher's eight returns.
   twilio, twilio-status, mailgun-events, mailgun and postgrid all return early,
   and an edit made only at the bottom of the dispatcher would silently miss
   every one of them — including postgrid, which is the provider this ticket is
   about. */
export async function handleWebhook({ db, provider, rawBody, headers = {}, url, env = process.env }) {
  /* Stringified BEFORE the lookup so the id that flows on is always a string.
     It used to fall through as whatever the caller passed, so a provider id of
     "constructor" resolved to the Object constructor and the 404 body printed
     it. With null-prototype tables the lookup misses; with the String() the
     404 says `unknown provider: constructor` and nothing else. */
  const raw = String(provider ?? "");
  const providerId = PROVIDER_ALIASES[raw.toLowerCase()] ?? raw;
  const out = await dispatchWebhook({ db, provider: providerId, rawBody, headers, url, env });
  /* Awaited, not fire-and-forget: a serverless instance can be frozen the
     moment the response is returned, so an un-awaited insert may never reach
     the database. It cannot throw — captureInboundWebhook swallows its own
     errors. */
  await captureInboundWebhook({ db, provider: providerId, rawBody, headers, env, out });
  return out;
}

async function dispatchWebhook({ db, provider, rawBody, headers = {}, url, env = process.env }) {
  ensureRegistered();
  const h = (name) => headers[name] ?? headers[String(name).toLowerCase()];

  /* A CLIENT'S OWN merchant processor — Finance OS, not Fundhub billing.
     /api/webhooks/merchant-whop/<connection id> and
     /api/webhooks/merchant-commas/<connection id>. The connection id in the
     path picks the client's signing secret; src/merchant/webhooks.mjs checks
     the signature and answers 401 for every kind of refusal alike. Fundhub's
     own /api/webhooks/commas below is untouched. */
  const merchant = parseMerchantProvider(provider);
  if (merchant) {
    return handleMerchantWebhook({ db, provider: merchant.provider, connectionId: merchant.connectionId, rawBody, headers, env });
  }

  // Twilio: urlencoded body + signature over the full URL + params (adapter parses).
  if (provider === "twilio") {
    return norm(await handleTwilioWebhook({
      db, rawBody, signatureHeader: h("x-twilio-signature"), secret: env.TWILIO_AUTH_TOKEN, url
    }));
  }

  /* DELIVERY STATUS CALLBACKS — the CRM cutover Ticket 2.
     /api/webhooks/twilio-status and /api/webhooks/mailgun-events.

     Registered here rather than as their own entries in the ROUTES map in
     netlify/functions/api.mjs, deliberately. That map's exact keys are looked up
     before the `webhooks/` prefix branch, so a key there would work — and
     src/http/routes.test.mjs asserts nobody adds one, because it would work only
     for as long as those two lookups stay in that order. These reach the same
     door every other provider webhook uses and depend on no ordering at all.

     They are separate provider ids rather than a branch inside the inbound
     handlers because the two directions verify the same signature over
     different payloads and must not share a code path: an inbound bank email
     and a bounce notice are not the same event, and the adapter that conflated
     them is the bug Ticket 2 exists to fix. */
  if (provider === "twilio-status") {
    return norm(await handleTwilioStatusWebhook({
      db, rawBody, signatureHeader: h("x-twilio-signature"), secret: env.TWILIO_AUTH_TOKEN, url
    }));
  }

  /* Resend delivery receipts — delivered, bounced, complained.
     Added 2026-08-18 (T5-16). Resend is the live outbound email provider and
     had NO webhook door at all, so `sent` was the last thing that ever happened
     to an email: a bounce, a spam complaint and a confirmed delivery were
     indistinguishable from inside the system.

     Signed with Svix, so the raw body matters — the signature covers
     `<svix-id>.<svix-timestamp>.<rawBody>` byte for byte, which is why rawBody
     is passed through rather than a re-serialised object. Fails closed with no
     RESEND_WEBHOOK_SECRET, like every other branch here. */
  if (provider === "resend") {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    return norm(await handleResendDeliveryEvent({
      db, body, rawBody, headers, secret: env.RESEND_WEBHOOK_SECRET
    }));
  }

  /* Submagic — "your video finished".
     POST /api/webhooks/submagic

     NO ROUTES ENTRY, deliberately, same as twilio-status and mailgun-events
     above: netlify/functions/api.mjs routes `webhooks/` by PREFIX, and
     src/http/routes.test.mjs fails if anybody adds a `webhooks/…` key to that
     map. This door depends on no lookup ordering at all.

     ═════════════════════════════════════════════════════════════════════
     THE PAYLOAD PROVES NOTHING AND IS NOT TREATED AS IF IT DID.

     Submagic documents no signature on this webhook
     (docs/specs/video-pipeline-api-verification-2026-09-22.md), so the body
     arrives unauthenticated from the open internet and anyone who guesses the
     URL can post one. It is therefore trusted for exactly ONE thing — "go and
     look at this project" — and recordSubmagicWebhook then asks Submagic
     directly, with our own key, what the truth is. A forged ping costs one
     read against a 100-an-hour limit and changes nothing.

     It also answers 200 whenever the body parsed, even when nothing moved. A
     non-200 makes a provider retry, and a retry storm on an open door is worse
     than a ping that did nothing — the sweeper polls the same project every
     five minutes anyway, so no ping is load-bearing.
     ═════════════════════════════════════════════════════════════════════ */
  if (provider === "submagic") {
    const parsed = submagicProvider.parseWebhook(rawBody);
    if (!parsed.ok) {
      return { status: 400, body: { ok: false, error: parsed.error } };
    }
    const verified = await recordSubmagicWebhook(parsed, { submagic: submagicProvider, env });
    if (!verified.ok || !Object.keys(verified.patch || {}).length) {
      return { status: 200, body: { ok: true, ignored: true, reason: verified.error || "nothing to change" } };
    }
    /* The ad_videos store is Builder A's and is loaded at run time for the same
       reason src/workflows/ad-video-sweeper.mjs loads it that way: a missing
       module must not take the whole webhook router down. */
    try {
      const store = await import("../ad-videos/store.mjs");
      const row = await store.findByProject(db, verified.projectId);
      if (!row) {
        return { status: 200, body: { ok: true, ignored: true, reason: "no take is waiting on this project" } };
      }
      await store.patch(db, row.id, verified.patch);
      return { status: 200, body: { ok: true, id: row.id, status: verified.patch.status } };
    } catch (err) {
      return { status: 200, body: { ok: true, ignored: true, reason: `store unavailable: ${String(err?.message || err)}` } };
    }
  }

  if (provider === "mailgun-events") {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    return norm(await handleMailgunDeliveryEvent({ db, body, signingKey: env.MAILGUN_SIGNING_KEY }));
  }

  // Mailgun: JSON body, signature fields live inside it, keyed by the signing key.
  if (provider === "mailgun") {
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    return norm(await handleMailgunWebhook({ db, body, signingKey: env.MAILGUN_SIGNING_KEY }));
  }

  // PostGrid letter delivery — call clock starts on delivery.confirmed only.
  if (provider === "postgrid") {
    if (!verifyMailWebhook(rawBody, headers, env)) {
      return { status: 401, body: { ok: false, error: "invalid_signature" } };
    }
    let body;
    try { body = rawBody ? JSON.parse(rawBody) : {}; }
    catch { return { status: 400, body: { ok: false, error: "invalid_json" } }; }
    const parsed = parseMailDeliveryEvent(body);
    if (!parsed.delivered) {
      return { status: 200, body: { ok: true, ignored: true, eventType: parsed.eventType } };
    }
    const result = await onMailDelivered(db, {
      providerId: parsed.letterId,
      deliveredAt: parsed.deliveredAt
    });

    // Two products mail through the same PostGrid account, and only one of them
    // was ever read here. onMailDelivered looks in inquiry_removal_cases; a
    // credit-repair letter's provider id lives in dispute_letters, so every
    // repair delivery came back case_not_found and repair.letters.delivered was
    // emitted by nothing in the repo. The case never moved to awaiting_response.
    //
    // The lookup runs only AFTER the inquiry miss, so the inquiry product's call
    // clock is untouched by this.
    if (result?.ok === false && result?.reason === "case_not_found" && db?.query) {
      const found = await db.query(
        `SELECT l.id AS letter_id, l.case_id, l.org_id, l.client_id
           FROM dispute_letters l
          WHERE l.postgrid_letter_id = $1
          LIMIT 1`,
        [String(parsed.letterId)]
      ).catch(() => null);
      const row = found?.rows?.[0];
      if (row) {
        const repair = await onRepairEvent(db, {
          name: "repair.letters.delivered",
          orgId: row.org_id,
          clientId: row.client_id,
          payload: {
            caseId: row.case_id,
            letterId: row.letter_id,
            providerId: String(parsed.letterId),
            deliveredAt: parsed.deliveredAt
          }
        }).catch((err) => ({ ok: false, reason: String(err?.message || err) }));
        return { status: 200, body: { ok: true, product: "repair", ...repair } };
      }
    }

    return { status: 200, body: { ok: true, ...result } };
  }

  const cfg = STD[provider];
  if (!cfg) return { status: 404, body: { ok: false, error: `unknown provider: ${provider}` } };
  /* cfg.sig is one header name or a list of them, tried in order. First one
     actually present on the request wins; a provider that renamed its header
     keeps working through the old name without a second code path. */
  const signatureHeader = [].concat(cfg.sig).map((name) => h(name)).find(Boolean);
  return norm(await cfg.fn({
    db,
    rawBody,
    signatureHeader,
    secret: env[cfg.env],
    /* undefined for every provider without a simEnv, which keeps their adapters
       on the single-key path they already have. */
    simSecret: cfg.simEnv ? env[cfg.simEnv] : undefined,
    headers,
    /* Apply-survey browser posts are not CF-signed. The adapter reads
       CLICKFUNNELS_APPLY_SURVEY_INGEST_SECRET from this same env object.
       Other providers keep only secret / simSecret. */
    ...(provider === "clickfunnels" ? { env } : {})
  }));
}
