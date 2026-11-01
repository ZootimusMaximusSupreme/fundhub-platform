// Commas (formerly FanBasis) payment adapter — Master Rebuild Spec Phase 1 (B2).
//
// Commas IS the payment processor. In the platform model an adapter does exactly
// three things and NOTHING else:
//   1. verify the webhook signature (fail-closed),
//   2. normalize the raw body into a flat event,
//   3. emit canonical events onto the bus — handlers (registered elsewhere) react.
//
// ONE THING WAS ADDED TO (2), and it is worth saying out loud because the list
// above is a contract. Before emitting, this file now reads the payment_links
// row the payment came from and resolves WHOSE payment it is. It does that
// because the alternative was worse: every payment event row was being written
// with a null client, so the money landed and nothing could say who paid it,
// and the product bucket was being decided from a vendor product title that no
// link this system mints has carried for years. Both answers live in our own
// database. Reading them is normalisation, not a side effect — the one write
// this path can cause (find-or-create a client by email) is the same write the
// handler on the very next line already made, and is fenced accordingly. See
// resolveInboxClientId().
//
// This is the port of the live underwrite-iq-lite `commas-payment.js` handler.
// The DIFFERENCE: the live handler does the old CRM and spreadsheet side effects inline; here the
// adapter only translates money-in → canonical events. The CRM, spreadsheet and CRS effects
// become handlers on those events (so the same payment can drive many reactions,
// and replay() re-drives them). Routing stays STRICTLY on product NAME, never amount
// (Chris 2026-07-17: deposit + package prices vary per client).
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ ⚠️ CONFIRM the SIG header + body field paths against a real Commas sandbox   │
// │ payload. The paths below match the live handler + the @fanbasis/checkout-sdk │
// │ shape (data.fan.email, data.product.title/price). Adjust only normalize().   │
// └───────────────────────────────────────────────────────────────────────────┘

import crypto from "node:crypto";
import { emit, defaultOrgId } from "../events/bus.mjs";
import { enqueue, isSettledRefund } from "../payments/commas-inbox.mjs";
import { assertCommasSafeCopy } from "../payments/commas-safe-copy.mjs";
/* The SAME resolver every downstream money handler uses, imported rather than
   copied so the two can never drift. Checked for an import cycle before
   adding: client-lifecycle.mjs reaches 17 modules and none of them is this
   file. See resolveInboxClientId() below for the one rule that governs when it
   is allowed to create a client. */
import { resolveClient } from "../handlers/client-lifecycle.mjs";

/* The signature header, in the order we look for it.
 *
 * Commas sends `x-webhook-signature`. This adapter was wired to
 * `x-commas-signature`, which no delivery has ever carried, so every real
 * webhook failed verification and answered 401 — the 401s that were being
 * treated as a secret problem. The old name stays as a fallback because it
 * costs nothing and something may still be pointed at it, but the documented
 * name is checked first. */
export const SIGNATURE_HEADERS = ["x-webhook-signature", "x-commas-signature"];

// Product routing — name match only. Same strings as the live handler.
export const PRODUCT = {
  CRS: { nameIncludes: "business financial assessment" }, // $32 soft-pull gate
  DEPOSIT: { nameIncludes: "consulting services deposit" }, // variable onboarding deposit
  SUCCESS_FEE: { nameIncludes: "consulting success fee" }, // variable success fee
  DIY: { nameIncludes: "consulting services package" } // $1,000 DIY letters downsell (DS-02)
};

// --- 1. Signature verification (fail-closed) --------------------------------
// HMAC-SHA256 of the raw body, keyed by the Commas signing secret. Some processors
// prefix the header ("sha256=..."); accept the raw hex tail. Returns false on any
// mismatch / malformed input — the caller MUST refuse the request when false.
export function verifyCommasSignature(rawBody, providedHeader, secret) {
  if (!secret) return false;
  const provided = String(providedHeader || "").trim();
  if (!provided) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
  const providedHex = provided.includes("=") ? provided.split("=").pop().trim() : provided;
  try {
    return crypto.timingSafeEqual(Buffer.from(providedHex, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

/* --- 1b. The simulated-receipt key -----------------------------------------
 *
 * WHY A SECOND KEY EXISTS AT ALL.
 *
 * COMMAS_WEBHOOK_SECRET is stored on Netlify with --secret, so `netlify env:get`
 * hands back a MASK of asterisks rather than the value. scripts/sim/push-payment.mjs
 * therefore signed every walkthrough receipt with asterisks and this endpoint
 * answered 401 bad_signature — which read like a broken signature and was not
 * (proven 2026-09-03, F26). Rotating the real key would fix it and is forbidden:
 * keys are never rotated here (owner-set, CLAUDE.md section 11).
 *
 * So a SECOND key, SIM_WEBHOOK_SECRET, is set WITHOUT --secret and is therefore
 * readable back. It is still a strong random value — "not secret" means "Netlify
 * will show it to the CLI", not "public".
 *
 * WHAT KEEPS IT FROM BEING A BACK DOOR. The sim key is accepted ONLY for a body
 * that carries the `simulated` marker push-payment.mjs stamps. A real Commas
 * delivery never carries that marker, so a real receipt signed with the sim key
 * is refused, and the sim key can never post money that looks live. The real key
 * keeps working for everything, marker or no marker.
 *
 * Marker position follows the same two payload shapes the parser already handles:
 * enveloped ({data:{simulated:true}}) and flat ({simulated:true}). */
export function isSimulatedReceipt(body) {
  const b = body || {};
  return b.simulated === true || inner(b).simulated === true;
}

/* verifyCommasWebhookAuth — the whole accept/refuse decision, pure and testable
   without a database. Returns the key that matched so the caller can record it.

   ORDER MATTERS. The live key is tried first and unconditionally, so nothing
   about real traffic changes. Only after it fails is the body parsed, and only a
   body that both parses AND self-identifies as simulated is offered the sim key. */
export function verifyCommasWebhookAuth({ rawBody, providedHeader, secret, simSecret }) {
  if (verifyCommasSignature(rawBody, providedHeader, secret)) {
    return { ok: true, mode: "live" };
  }
  if (!simSecret) return { ok: false, mode: null };

  let parsed = null;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    return { ok: false, mode: null };
  }
  if (!isSimulatedReceipt(parsed)) return { ok: false, mode: null };
  if (!verifyCommasSignature(rawBody, providedHeader, simSecret)) return { ok: false, mode: null };
  return { ok: true, mode: "simulated" };
}

/* TWO PAYLOAD SHAPES, AND ONLY ONE OF THEM IS REAL TRAFFIC.
 *
 * A real delivery is always enveloped: { id, type, data, created_at }. The
 * dashboard's "Test Webhook" button sends payment.succeeded and the core
 * subscription events FLAT, with no envelope at all. Validating the parser
 * against the test button therefore proves nothing about production, which is
 * how a parser can look correct and still miss every live payment.
 *
 * `body.data || body` below is what absorbs the difference, and the fixtures
 * in commas.test.mjs cover both shapes deliberately. */
const inner = (b) => (b && b.data && (b.data.object || b.data)) || b || {};

/* eventTypeOf / paymentIdOf — the two fields needed BEFORE the payload is
 * interpreted, because the inbox row has to be written and answered in the
 * time budget of a webhook. Kept tiny and total: neither throws, and either
 * may return null, because an unparseable body must still be stored. */
export function eventTypeOf(body) {
  const b = body || {};
  return String(b.type || b.event || b.event_type || inner(b).type || "").toLowerCase();
}

/* THE IDEMPOTENCY ANCHOR. Commas documents `data.payment_id` as the stable
   identifier for a payment and the envelope `id` as per-DELIVERY. Keying on
   the envelope means two deliveries of one payment look like two payments and
   the money is counted twice. */
export function paymentIdOf(body) {
  const b = body || {};
  const d = inner(b);
  const id = d.payment_id ?? b.payment_id ?? d.paymentId ?? b.paymentId ?? null;
  return id ? String(id) : null;
}

/* Refund identity is separate from payment identity. The documented refund
 * transaction hashid is NOT the payment.succeeded public order ID (ORD-...).
 * https://apidocs.fan/ — refund.created and payment.succeeded schemas. */
export function refundIdOf(body) {
  const id = inner(body).refund_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/* A uuid, or nothing. Written out here rather than imported from
   src/http/read-api.mjs on purpose: this file runs in the webhook and sweeper
   paths and has no business pulling in the HTTP layer for one regex. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (v) => (typeof v === "string" && UUID_RE.test(v.trim()) ? v.trim() : null);

// --- 2. Normalize the webhook body into a flat event ------------------------
// Mirrors extractEvent() in the live handler verbatim, plus an `id` for idempotency.
export function normalizeCommasEvent(body) {
  const b = body || {};
  const d = (b.data && (b.data.object || b.data)) || b;
  const type = String(b.type || b.event || b.event_type || d.type || "").toLowerCase();

  // amount: prefer major-unit fields; fall back to minor units (cents) / 100.
  let amount =
    d.amount ??
    d.amount_total ??
    d.total ??
    d.price ??
    (d.product && d.product.price) ??
    b.amount ??
    b.amount_total;
  if ((amount === undefined || amount === null) && typeof d.amount_cents === "number") {
    amount = d.amount_cents / 100;
  }
  amount = amount === undefined || amount === null || amount === "" ? null : Number(amount);
  if (Number.isNaN(amount)) amount = null;

  const li =
    (Array.isArray(d.line_items) && d.line_items[0]) ||
    (Array.isArray(d.items) && d.items[0]) ||
    {};
  const name =
    (d.item && d.item.title) ||
    d.product_name ||
    (d.product && (d.product.name || d.product.title)) ||
    li.name ||
    li.product_name ||
    (li.price && li.price.product && li.price.product.name) ||
    d.name ||
    b.product_name ||
    "";

  const email =
    (d.buyer && d.buyer.email) ||
    (d.fan && (d.fan.email || d.fan.email_address)) ||
    d.customer_email ||
    (d.customer && (d.customer.email || d.customer.email_address)) ||
    d.email ||
    d.email_address ||
    (d.billing && d.billing.email) ||
    b.email ||
    "";

  // Stable id for idempotency: the processor's event/transaction id.
  const id =
    b.id ||
    b.event_id ||
    d.id ||
    d.transaction_id ||
    d.checkout_session_id ||
    (d.fan && d.fan.id ? `${d.fan.id}:${name}` : null) ||
    null;

  /* ref — OUR OWN reference, round-tripped through the checkout link built by
     buildCommasCheckoutUrl() below and (assumed to be) echoed back on the
     webhook. This is how a payment_links row (119_payment_links.sql) finds its
     way from 'sent' to 'paid': `id` above is the PROCESSOR's transaction id,
     known only after payment, so it cannot be the thing a link is looked up
     by. Same CONFIRM caveat as every other field path in this file — the
     exact key Commas echoes a client reference back under has not been
     observed against a live payload. Checked in the order a checkout-link
     integration is most likely to carry it: an explicit reference id, then a
     generic metadata bag, then a bare `ref` some processors use verbatim. */
  const ref =
    (d.api_metadata && d.api_metadata.data &&
      (d.api_metadata.data.link_ref || d.api_metadata.data.ref)) ||
    d.client_reference_id ||
    (d.metadata && (d.metadata.link_ref || d.metadata.ref)) ||
    d.reference ||
    d.ref ||
    b.client_reference_id ||
    b.ref ||
    null;

  /* clientId — OUR OWN client id, read back out of THE SAME metadata bag `ref`
     comes from.
     src/payments/commas-api.mjs mints every checkout session with
     metadata { link_ref, client_id, org_id } (built by
     src/payment-links/index.mjs), so the id is already on the session. It was
     being parsed straight past on the way back in, which is why every payment
     event row carried a null client and nothing could say whose money it was.

     ONLY THE TWO BAGS WE FILL, and only when the value is uuid-shaped. A bare
     `client_id` at the top of a Commas payload is THEIR customer id in THEIR
     numbering; treating that as one of ours would attribute a payment to
     whichever of our clients happened to collide. Anything that is not a uuid
     is not one of our ids, so it becomes null and the payment stays honestly
     unattributed. */
  const clientId =
    asUuidOrNull(d.api_metadata && d.api_metadata.data && d.api_metadata.data.client_id) ||
    asUuidOrNull(d.metadata && d.metadata.client_id) ||
    null;

  /* invoiceId / fundingRoundId — same two bags we fill at mint
     (src/payment-links/index.mjs). UUID-only, same rule as client_id: a
     vendor-side invoice number is not one of ours. */
  const invoiceId =
    asUuidOrNull(d.api_metadata && d.api_metadata.data && d.api_metadata.data.invoice_id) ||
    asUuidOrNull(d.metadata && d.metadata.invoice_id) ||
    null;
  const fundingRoundId =
    asUuidOrNull(d.api_metadata && d.api_metadata.data && d.api_metadata.data.funding_round_id) ||
    asUuidOrNull(d.metadata && d.metadata.funding_round_id) ||
    null;

  /* dueBy — a dispute's response deadline. Missing it is how a chargeback is
     lost by default, so it is carried through to the task rather than left in
     the raw body for somebody to find. */
  const dueByRaw = d.due_by ?? d.dueBy ?? d.respond_by ?? b.due_by ?? null;

  /* itemId — Commas product / checkout session id (e.g. "8YZPo"). Stored on
     payment_links.commas_session_id at mint so we can settle the row when
     api_metadata.link_ref is missing or mismatched. */
  const itemId =
    (d.item && (d.item.id || d.item.product_id)) ||
    d.product_id ||
    (d.product && d.product.id) ||
    d.checkout_session_id ||
    null;

  return {
    id: id ? String(id) : null,
    paymentId: paymentIdOf(body),
    refundId: refundIdOf(body),
    refundStatus: String(d.status || "").trim().toLowerCase(),
    refundTransactionId: typeof d.refund_transaction_id === "string" ? d.refund_transaction_id : null,
    type,
    name: String(name),
    amount,
    email: String(email).trim().toLowerCase(),
    ref: ref ? String(ref) : null,
    clientId,
    invoiceId,
    fundingRoundId,
    itemId: itemId ? String(itemId) : null,
    dueBy: dueByRaw ? String(dueByRaw) : null,
    /* purpose — NOT read off the payload, and deliberately so. It is our own
       field (payment_links.purpose), and the only trustworthy copy of it is
       the row `ref` points at, which needs a database. processCommasInboxRow
       fills it in before the product is decided. Declared here so the shape of
       a normalized event is the same whether or not that lookup happened. */
    purpose: null,
    productId: null,
    productCode: null,
    saleId: null,
    saleMotion: null,
    paymentLinkId: null,
    closerId: null,
    salesManagerId: null
  };
}

/* buildCommasCheckoutUrl — a checkout link for a VARIABLE amount, for the CRM's
   "send a payment link" action (src/payment-links/index.mjs). Pure URL
   construction, no network call.

   NO LONGER THE PRIMARY PATH. This comment used to say a Commas API endpoint
   for minting a server-side checkout SESSION was not confirmed to exist. It
   does: src/payments/commas-api.mjs createCheckoutSession() posts to
   /checkout-sessions with FANBASIS_CHECKOUT_API_KEY, and
   src/payment-links/index.mjs prefers it. This function is the FALLBACK, used
   only when that key is absent — and a link built here carries no metadata, so
   the payment that comes back has our `ref` and nothing else.

   It assumes (⚠️ CONFIRM against a live Commas
   account, same as the rest of this file) that the page reads `amount`,
   `description` and a caller-supplied reference off the query string the way
   the live handler's product pages do. `ref` is the value normalizeCommasEvent
   above looks for on the way back in — round-tripping it is what lets the
   webhook find this link again. */
export function buildCommasCheckoutUrl({ baseUrl, linkRef, amountCents, description }) {
  if (!baseUrl) throw new TypeError("buildCommasCheckoutUrl: baseUrl is required (COMMAS_CHECKOUT_BASE_URL)");
  if (!linkRef) throw new TypeError("buildCommasCheckoutUrl: linkRef is required");
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`buildCommasCheckoutUrl: amountCents must be a positive integer, got ${amountCents}`);
  }
  const url = new URL(baseUrl);
  url.searchParams.set("amount", (amountCents / 100).toFixed(2));
  url.searchParams.set("ref", linkRef);
  if (description) {
    assertCommasSafeCopy(description, { field: "description" });
    url.searchParams.set("description", description);
  }
  return url.toString();
}

function nameMatches(name, needle) {
  return String(name || "").toLowerCase().includes(needle);
}

/* PURPOSE → product bucket. THE SIGNAL WE CONTROL, CHECKED FIRST.
 *
 * The four PRODUCT strings above are the titles of products Chris created in
 * the Commas dashboard years ago. Nothing this system mints today is called
 * any of them: a link's title is `description || purpose`
 * (src/payment-links/index.mjs), so the CRM's $32 link is titled "diagnostic"
 * and the closer deck's is titled "UnderwriteIQ soft-pull assessment". Both
 * fell through to "unmatched", so a real payment emitted payment.received and
 * nothing else — diagnostic.paid, deposit.paid and sale.closed never fired
 * from a link we sent.
 *
 * `purpose` is ours. It is written on the payment_links row at mint time from
 * src/config/offers.mjs paymentPurpose, and read back off that row here. It
 * does not depend on what an operator typed in a description box, and it does
 * not depend on a vendor-side product title nobody in this repo can see.
 *
 * ONLY TWO OF THE FOUR PURPOSES ARE IN THIS MAP, and the other two are absent
 * by decision rather than by oversight:
 *   deposit    → the onboarding deposit. deposit.paid. Unambiguous.
 *   diagnostic → the $32 soft-pull gate. diagnostic.paid. Unambiguous.
 *   repair     → NO canonical bucket exists. The nearest, "diy", means the
 *                Consulting Services Package, and posting a repair sale under
 *                it would file it against the wrong product code. Nobody has
 *                decided what a repair purchase should emit.
 *   custom     → free text. It covers the deliverables package, the course,
 *                and anything an operator types. It names no single product.
 * Do not add a row here to make a test green. Adding one decides an offer
 * question, and that is the owner's to decide, not this file's.
 *
 * AN ABSENT PURPOSE FALLS THROUGH, it does not short-circuit. A purpose this
 * map says nothing about contributes nothing, and the title below becomes the
 * only signal left — which for a repair or custom link matches none of the
 * four legacy strings, so the honest answer "unmatched" is what comes out, and
 * payment.received is the only event emitted.
 *
 * THE LEGACY TITLES STAY. Old rows replay through this same function and must
 * classify exactly as they did, and a payment made on a Commas dashboard
 * product page has no link and therefore no purpose — the title is all it has.
 */
export const PURPOSE_PRODUCT = Object.freeze({
  deposit: "deposit",
  diagnostic: "crs"
});

const PRODUCT_CODE_BUCKET = Object.freeze({
  diagnostic: "crs",
  "card-stacking-dfy": "deposit",
  "consulting-package": "diy"
});

// Product bucket from a normalized event: "crs" | "deposit" | "success_fee" | "diy" | "unmatched".
export function productOf(evt) {
  const productCode = String((evt && evt.productCode) || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PRODUCT_CODE_BUCKET, productCode)) {
    return PRODUCT_CODE_BUCKET[productCode];
  }
  const purpose = String((evt && evt.purpose) || "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(PURPOSE_PRODUCT, purpose)) return PURPOSE_PRODUCT[purpose];
  if (nameMatches(evt.name, PRODUCT.CRS.nameIncludes)) return "crs";
  if (nameMatches(evt.name, PRODUCT.DIY.nameIncludes)) return "diy";
  if (nameMatches(evt.name, PRODUCT.DEPOSIT.nameIncludes)) return "deposit";
  if (nameMatches(evt.name, PRODUCT.SUCCESS_FEE.nameIncludes)) return "success_fee";
  return "unmatched";
}

// --- 3. Map a normalized event to canonical events (pure) -------------------
// Every successful payment emits `payment.received` (the money-in fact). The
// product then adds a SEMANTIC event the journey reacts to. A failed payment
// emits only `payment.failed`. Unknown/non-terminal events map to nothing.
export function mapToCanonical(evt) {
  const out = [];
  if (!evt || !evt.type) return out;
  const t = evt.type;

  /* ORDER MATTERS HERE, and the ordering is not cosmetic.
     "payment.canceled" contains "cancel"; a refund or dispute type can contain
     other words we match on. The specific outcomes are therefore tested before
     the generic failed/succeeded pair, so a refund can never fall through into
     "succeeded" and credit the money a second time. */

  /* SUBSCRIPTION EVENTS COME FIRST, and the order is load-bearing.
     "subscription.canceled" contains "cancel", so without this block it fell
     into the abandoned-checkout branch below and a partner who ended a paid
     plan was recorded as someone who never paid at all. Worse,
     "subscription.renewed" matched nothing and returned an EMPTY list: Commas
     charges the card every frequency_days and fires that event, so a real
     recurring payment arrived and this adapter dropped it silently. That bug
     only ever shows up in month two.

     COMMAS BILLS SUBSCRIPTIONS, WE DO NOT. type "subscription" on a checkout
     session hands the schedule, the card, the retries and the dunning to
     them. Everything below is therefore a REPORT of something that already
     happened, never an instruction to charge. */
  if (t.startsWith("subscription.")) {
    /* A renewal is money that actually moved. It emits payment.received like
       any other money-in fact, so one ledger writer sees every dollar
       regardless of which door it came through. */
    if (t.includes("renewed") || t.includes("recovered")) {
      out.push({ name: "payment.received", product: productOf(evt) });
      out.push({ name: "subscription.renewed", product: productOf(evt) });
      return out;
    }
    /* The rest move no money. They change the STATE of an arrangement, and
       they are emitted under their own names so nothing downstream mistakes a
       lifecycle change for a payment. */
    if (t.includes("created")) {
      out.push({ name: "subscription.started", product: productOf(evt) });
      return out;
    }
    if (t.includes("past_due")) {
      out.push({ name: "subscription.past_due", product: productOf(evt) });
      return out;
    }
    if (t.includes("cancel")) {
      out.push({ name: "subscription.canceled", product: productOf(evt) });
      return out;
    }
    if (t.includes("completed")) {
      out.push({ name: "subscription.completed", product: productOf(evt) });
      return out;
    }
    return out; // an unknown subscription.* — recorded nowhere rather than guessed
  }

  /* expired / canceled — ABANDONED CHECKOUTS, NOT DECLINES.
     A link that timed out, or a customer who backed out before paying. No
     money moved, so there is no money event and deliberately no
     payment.failed: folding these into the decline path would inflate the
     decline rate with people who were never declined, and decline rate is a
     number the sales floor is managed on. These exist for visibility only. */
  if (t.includes("expired")) {
    out.push({ name: "payment.expired", product: productOf(evt) });
    return out;
  }
  if (t.includes("cancel")) {
    out.push({ name: "payment.canceled", product: productOf(evt) });
    return out;
  }

  /* refund / dispute — money that already moved is now in question.
     NEITHER reverses the ledger here. How a refund should be treated in
     commission accounting, and how a chargeback should, are two different
     questions with two different answers, and neither has been decided. An
     adapter inventing one would silently rewrite somebody's pay. The events
     are emitted; a dispute additionally drives an urgent task, because it has
     a deadline (src/handlers/commas-disputes.mjs). */
  if (t.includes("refund")) {
    if (!isSettledRefund(t, evt.refundStatus)) return out;
    out.push({ name: "payment.refunded", product: productOf(evt) });
    return out;
  }
  if (t.includes("dispute") || t.includes("chargeback")) {
    out.push({ name: "payment.disputed", product: productOf(evt) });
    return out;
  }

  if (t.includes("failed")) {
    // Keep the same title/link-derived identity on decline and capture.
    out.push({ name: "payment.failed", product: productOf(evt) });
    return out;
  }
  if (!t.includes("succeeded")) return out; // pending/other — ignore

  // Money-in fact, always.
  out.push({ name: "payment.received", product: productOf(evt) });

  // Semantic journey event per product.
  const product = productOf(evt);
  if (product === "crs") out.push({ name: "diagnostic.paid", product }); // $32 soft-pull gate
  else if (product === "deposit") out.push({ name: "deposit.paid", product }); // onboarding deposit
  else if (product === "diy") out.push({ name: "sale.closed", product }); // DIY letters downsell purchase
  // success_fee + unmatched: payment.received only (handlers can inspect payload.product).

  return out;
}

// --- Adapter entrypoint: ACK FIRST, WORK LATER ------------------------------
/* handleCommasWebhook({ db, rawBody, signatureHeader, secret })
 *   → { ok, status, queued, deduped, inboxId, reason? }
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT CHANGED, AND WHY IT HAD TO.
 *
 * This function used to verify, normalise, emit every canonical event and run
 * the entire money chain — client creation, commission accrual, entitlements,
 * closeout — all before returning a status code. That is safe with a provider
 * that retries. Commas does not retry. It delivers AT MOST ONCE, and a
 * delivery that fails is logged on their side and dropped, with no way for us
 * to learn it happened.
 *
 * So under the old shape, any failure anywhere in that chain lost a real
 * payment permanently. A deposit would simply never register, and nothing in
 * the system would be able to say a payment had ever arrived.
 *
 * Now it does the smallest durable thing available: verify the signature,
 * write the exact bytes to commas_inbox, answer 200. One INSERT. Everything
 * else — parsing, mapping, emitting, the money chain — is done afterwards by
 * netlify/functions/commas-inbox-sweeper.mjs, and all of it is retryable
 * because the bytes are already safe.
 *
 * IT NO LONGER RETURNS `emitted`. Callers cannot learn from the response what
 * events a payment produced, because at the moment of responding nothing has
 * been decided yet. That is the trade the at-most-once guarantee costs, and it
 * is the right way round: a caller that wanted the answer synchronously was a
 * caller holding a payment hostage to the money chain succeeding on the first
 * try.
 *
 * A MALFORMED BODY IS STILL STORED. It is verified — it carries a valid
 * signature, so it genuinely came from Commas — and a payload we could not
 * parse but kept is a bug report, while one we refused is a lost payment.
 * Only an unsigned request is refused. */
export async function handleCommasWebhook({ db, rawBody, signatureHeader, secret, simSecret, headers = {} }) {
  /* simSecret is the walkthrough key and is offered ONLY to a body that says it
     is simulated — see verifyCommasWebhookAuth. Callers that pass no simSecret
     behave exactly as before. */
  const auth = verifyCommasWebhookAuth({ rawBody, providedHeader: signatureHeader, secret, simSecret });
  if (!auth.ok) {
    return { ok: false, status: 401, reason: "bad_signature", queued: false };
  }

  /* Parse only far enough to key the row. A body that will not parse still
     gets stored, under a hash of its own bytes — see dedupeKeyFor. */
  let body = null;
  let parseError = null;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (err) {
    parseError = String(err?.message || err).slice(0, 200);
  }

  const eventType = body ? eventTypeOf(body) : null;
  const paymentId = body ? paymentIdOf(body) : null;

  try {
    const orgId = await defaultOrgId(db);
    const res = await enqueue(db, {
      orgId,
      rawBody: rawBody ?? "",
      headers,
      paymentId,
      refundId: body ? refundIdOf(body) : null,
      refundStatus: body ? inner(body).status : null,
      eventType,
      source: "webhook"
    });
    return {
      ok: true,
      status: 200,
      queued: !res.deduped,
      deduped: res.deduped,
      inboxId: res.id,
      paymentId,
      eventType,
      signedWith: auth.mode,
      reason: parseError ? `stored_unparseable:${parseError}` : null
    };
  } catch (err) {
    /* The queue write itself failed. This is the one case the caller must hear
       about as a failure: nothing durable happened, so answering 200 would
       tell Commas the payment was safely received when it was not. They will
       not retry either way, but a 5xx is at least visible in their delivery
       log and in ours. */
    console.error(
      `[commas] INBOX WRITE FAILED — payment ${paymentId || "?"} ` +
      `(${eventType || "?"}) may be lost: ${String(err?.message || err).slice(0, 300)}`
    );
    return {
      ok: false,
      status: 500,
      reason: "inbox_write_failed",
      queued: false,
      paymentId,
      eventType
    };
  }
}

/* loadPaymentLink — the payment_links row this payment came from, or null.
 *
 * `link_ref` is globally unique (119_payment_links.sql:50), which is exactly
 * why it can be looked up here with no org context. `commas_session_id` is the
 * fallback for a link minted through the checkout-session API, where the
 * session id is the value that comes back on the webhook. link_ref is tried
 * first because it is the value we chose; the session id is the vendor's.
 *
 * NULL IS A NORMAL ANSWER, not an error. A payment made on a Commas dashboard
 * product page has no link of ours behind it, and never will.
 *
 * A DATABASE ERROR IS NOT SWALLOWED. It propagates, drain() marks the row
 * failed with its bytes intact, and the next sweep retries it. Catching it
 * would emit the event with a null client id, and the idempotency key would
 * then make that wrong answer permanent — a retry would dedupe rather than
 * correct it. Failing loudly is the recoverable option. */
export async function loadPaymentLink(db, { linkRef, sessionId }) {
  // Two valid identifiers in one provider callback must refer to ONE checkout.
  // Returning the first matching row before reading the second could send
  // settled money, entitlements, and commission to the wrong buyer/sale.
  let byRefLink = null;
  let bySessionLink = null;
  if (linkRef) {
    const byRef = await db.query(
      `SELECT pl.id, pl.org_id, pl.client_id, pl.purpose, pl.invoice_id,
              pl.product_id, p.code AS product_code, pl.sale_id, pl.sale_motion,
              pl.closer_staff_id, pl.sales_manager_staff_id
         FROM payment_links pl
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE pl.link_ref = $1
        LIMIT 1`,
      [String(linkRef)]
    );
    byRefLink = byRef.rows[0] || null;
  }
  if (sessionId) {
    const bySession = await db.query(
      `SELECT pl.id, pl.org_id, pl.client_id, pl.purpose, pl.invoice_id,
              pl.product_id, p.code AS product_code, pl.sale_id, pl.sale_motion,
              pl.closer_staff_id, pl.sales_manager_staff_id
         FROM payment_links pl
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE pl.provider = 'commas' AND pl.commas_session_id = $1
        LIMIT 1`,
      [String(sessionId)]
    );
    bySessionLink = bySession.rows[0] || null;
  }
  if (byRefLink && bySessionLink &&
      String(byRefLink.id) !== String(bySessionLink.id)) {
    // The inbox retains the signed/raw webhook and retries safely. Refuse
    // before emitting a canonical payment event; an unverified event must not
    // create a paid sale or assign a receivable to an unrelated customer.
    throw new Error("[commas] conflicting checkout reference and session identity; manual reconciliation required");
  }
  // Missing metadata is normal for product-page checkouts. Retain the legacy
  // fallback when only one identifier resolves; do NOT invent ownership.
  return byRefLink || bySessionLink || null;
}

/* No client creation for abandoned checkouts OR post-payment reversals.
 *
 * A dispute/refund is not a new sale. A late processor event can contain a
 * changed or unknown payer email; creating a CRM/customer row would hide the
 * original receipt and could associate a chargeback with the wrong buyer.
 * Their handler now resolves an existing same-org customer or the original
 * same-org succeeded transaction, then assigns owner review. An unmatched
 * dispute remains unattributed and is dead-lettered, never lead-captured.
 *
 * First-time succeeded money events still use the ordinary lead-resolution
 * path. No payment/ledger/commission behavior changes here. */
const NO_HANDLER_CREATES_A_CLIENT = new Set([
  "payment.expired", "payment.canceled", "payment.refunded", "payment.disputed"
]);

async function findClientIdByEmail(db, orgId, email) {
  if (!orgId || !email) return null;
  const { rows } = await db.query(
    `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
    [orgId, String(email).trim().toLowerCase()]
  );
  return rows[0]?.id ?? null;
}

async function clientIdInOrg(db, orgId, clientId) {
  if (!orgId || !clientId) return null;
  const { rows } = await db.query(
    `SELECT id FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  return rows[0]?.id ?? null;
}

/* Reversals always point BACK to an original succeeded payment; they are
 * never authenticated by the callback's email, checkout metadata or client ID.
 * Both tenant and provider must match. An out-of-order reversal is retained
 * unattributed for dead-letter review and can be retried after the original
 * money-in record appears. Nothing creates or edits a client here. */
export async function reversalOriginalClientId(db, { orgId, paymentId }) {
  if (!orgId || !paymentId) return null;
  const result = await db.query(
    `SELECT t.client_id FROM transactions t
       JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
      WHERE t.org_id = $1 AND t.provider = 'commas'
        AND t.provider_ref = $2 AND t.status = 'succeeded'
      LIMIT 1`,
    [orgId, String(paymentId)]
  );
  return result.rows[0]?.client_id || null;
}

/* resolveInboxClientId — whose payment is this? Returns a client uuid or null.
 *
 * Three sources, best first, and every one of them is checked against the org
 * the inbox row belongs to. A link_ref is globally unique and a metadata bag
 * is whatever the vendor echoed, so neither carries org scope on its own;
 * attributing across orgs would leak one tenant's money onto another's client.
 *
 *   1. the payment_links row we minted — our own table, our own client id
 *   2. the client id we put on the checkout session's metadata
 *   3. the payer's email, through the same resolver the handlers use
 *
 * NULL IS A LEGITIMATE ANSWER AND MUST SURVIVE. A payment we cannot attribute
 * stays unattributed and visible as such. It is never guessed. */
export async function resolveInboxClientId(db, { orgId, evt, link, mayCreate = false }) {
  if (link && link.client_id) {
    if (link.org_id === orgId) return link.client_id;
    console.warn(
      `[commas] payment link ${link.id} belongs to org ${link.org_id} but the ` +
      `webhook arrived on org ${orgId} — not attributing across orgs`
    );
  }

  if (evt.clientId) {
    const confirmed = await clientIdInOrg(db, orgId, evt.clientId);
    if (confirmed) return confirmed;
    console.warn(
      `[commas] checkout metadata named client ${evt.clientId}, which is not a ` +
      `client of org ${orgId} — ignoring it rather than attributing the payment`
    );
  }

  if (!evt.email) return null;
  if (!mayCreate) return findClientIdByEmail(db, orgId, evt.email);
  return (await resolveClient(db, { orgId, clientId: null, payload: { email: evt.email } })) || null;
}

/* processCommasInboxRow(row, db) → { ok, ignored?, reason?, emitted }
 *
 * Phase two. Runs from the sweeper, never from the request path. Interprets
 * one stored row and puts its canonical events on the bus.
 *
 * IDEMPOTENCY IS THE ROW'S DEDUPE KEY, not a fresh guess. `row.dedupe_key` is
 * already anchored to data.payment_id or data.refund_id, so re-running a row — which happens
 * whenever a pass is retried — writes no second event and dispatches no second
 * handler.
 *
 * HANDLER FAILURES DO NOT FAIL THE ROW, deliberately. emit() catches each
 * handler and records it to the dead-letter queue, which owns the retry. If
 * this function threw on a handler error instead, the row would be marked
 * failed and retried, and every retry would dedupe on the idempotency key and
 * dispatch nothing — retrying forever while achieving nothing, and masking the
 * dead-letter entry that actually describes the problem. What DOES fail a row
 * is failing to write the event at all. */
export async function processCommasInboxRow(row, db) {
  let body;
  try {
    body = JSON.parse(row.raw_body || "{}");
  } catch (err) {
    /* Terminal, not retryable — the bytes will not start parsing on the next
       pass. Marked ignored so it stops consuming attempts, with the reason on
       the row. The raw body is retained for whoever looks. */
    return { ok: true, ignored: true, reason: `unparseable_json: ${String(err?.message || err).slice(0, 200)}`, emitted: [] };
  }

  const evt = normalizeCommasEvent(body);

  /* Answered before touching the database on purpose. A non-terminal type maps
     to nothing whatever the product turns out to be, so a row that is going to
     be ignored costs no queries. mapToCanonical is pure, so calling it again
     below after the purpose is known is free. */
  if (mapToCanonical(evt).length === 0) {
    return { ok: true, ignored: true, reason: `no_canonical_mapping:${evt.type || "unknown"}`, emitted: [] };
  }

  /* The link we minted, when this payment came from one. It carries the two
     facts the payload cannot be trusted for: what the money was FOR
     (purpose → the product bucket) and WHOSE it is (client_id). */
  const link = await loadPaymentLink(db, { linkRef: evt.ref, sessionId: evt.itemId });
  if (link && link.org_id === row.org_id) {
    if (link.purpose) evt.purpose = String(link.purpose);
    evt.paymentLinkId = link.id || null;
    evt.productId = link.product_id || null;
    evt.productCode = link.product_code || null;
    evt.saleId = link.sale_id || null;
    evt.saleMotion = link.sale_motion || null;
    evt.closerId = link.closer_staff_id || null;
    evt.salesManagerId = link.sales_manager_staff_id || null;
    if (!evt.invoiceId && link.invoice_id) evt.invoiceId = link.invoice_id;
  }

  const canonical = mapToCanonical(evt);

  /* One resolution for the whole row, so a payment's several canonical events
     can never disagree about who paid. */
  const mayCreate = canonical.some((c) => !NO_HANDLER_CREATES_A_CLIENT.has(c.name));
  const reversal = canonical.some((c) => c.name === "payment.refunded" || c.name === "payment.disputed");
  // The webhook's claimed customer is not evidence for whose money was
  // refunded/disputed. Use the same original paid transaction as the owner
  // task handler, or store an unattributed event for manual reconciliation.
  const clientId = reversal
    ? await reversalOriginalClientId(db, { orgId: row.org_id, paymentId: evt.paymentId })
    : await resolveInboxClientId(db, { orgId: row.org_id, evt, link, mayCreate });

  const emitted = [];
  for (const c of canonical) {
    const payload = {
      product: c.product,
      productName: evt.name,
      amount: evt.amount,
      email: evt.email,
      /* The original payment_id is the money reference. For non-refunds retain
         the legacy envelope fallback. A refund's delivery UUID and transaction
         hashid cannot identify the original ORD payment: without payment_id,
         retain an unattributed event for the existing dead-letter review. */
      providerRef: evt.paymentId || (c.name === "payment.refunded" ? null : evt.id),
      paymentId: evt.paymentId,
      ...(c.name === "payment.refunded" ? {
        refundId: evt.refundId,
        refundTransactionId: evt.refundTransactionId
      } : {}),
      ref: evt.ref, // our own reference, if the payment came from a payment_links checkout URL
      /* purpose — what the link was FOR, from our own payment_links row. Null
         when the payment did not come from a link of ours. Carried so the
         `product` above can be read back to its evidence instead of being
         taken on faith. */
      purpose: evt.purpose,
      productId: evt.productId,
      productCode: evt.productCode,
      saleId: evt.saleId,
      saleMotion: evt.saleMotion,
      paymentLinkId: evt.paymentLinkId,
      invoiceId: evt.invoiceId || null,
      fundingRoundId: evt.fundingRoundId || null,
      closerId: evt.closerId,
      salesManagerId: evt.salesManagerId,
      itemId: evt.itemId,
      dueBy: evt.dueBy, // dispute response deadline, when the event carries one
      source: "commas"
    };
    const res = await emit(db, c.name, payload, {
      orgId: row.org_id,
      /* WHOSE payment this is. May be null — an unattributable payment must
         stay unattributed rather than be attached to a guess. */
      clientId,
      idempotencyKey: `commas:${row.dedupe_key}:${c.name}`
    });
    emitted.push({ name: c.name, id: res.id, deduped: res.deduped });
  }
  return { ok: true, emitted };
}
