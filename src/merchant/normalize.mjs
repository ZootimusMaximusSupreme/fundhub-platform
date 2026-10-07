// Merchant events — turn three processors' payloads into ONE row shape.
//
// The row shape (merchant_events, db/migrations/442_merchant_connections.sql):
//   { provider_event_id, kind, amount_cents, currency, occurred_at, description, raw }
//   kind        sale | refund | payout | fee
//   amount_cents signed minor units: sale >= 0, refund/fee <= 0, payout usually < 0
//
// Pure functions. No database, no network. Signature checks live here too so
// they can be tested byte for byte.
import crypto from "node:crypto";
import {
  verifyCommasSignature,
  normalizeCommasEvent,
  paymentIdOf,
  eventTypeOf,
  SIGNATURE_HEADERS as COMMAS_SIGNATURE_HEADERS
} from "../adapters/commas.mjs";

export const KINDS = Object.freeze(["sale", "refund", "payout", "fee"]);
export const MAX_EVENTS_PER_CALL = 100;

const SIGN_BY_KIND = { sale: 1, refund: -1, fee: -1, payout: -1 };

/* signFor — the stored sign follows the kind, whatever sign the sender used.
   A sender that writes a refund as 500 and one that writes it as -500 both
   mean "500 went back to the buyer". */
export function signFor(kind, cents) {
  const abs = Math.abs(cents);
  return SIGN_BY_KIND[kind] * abs || 0;
}

/* decimalToMinor("1234.56", 2) → 123456. Exact string math, no float. Returns
   null for anything that is not a plain decimal number. */
export function decimalToMinor(value, decimals = 2) {
  if (value === null || value === undefined) return null;
  const s = typeof value === "number" ? (Number.isFinite(value) ? value.toFixed(decimals) : "") : String(value).trim();
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) return null;
  const d = Math.max(0, Math.min(6, Number.isInteger(decimals) ? decimals : 2));
  const frac = (m[3] || "").padEnd(d + 1, "0");
  let minor = Number(m[2]) * 10 ** d + Number(frac.slice(0, d) || 0);
  if (Number(frac[d]) >= 5) minor += 1; // half up on the first dropped digit
  if (!Number.isSafeInteger(minor)) return null;
  return m[1] ? -minor : minor;
}

function isoOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const t = typeof v === "number" ? v * (v < 1e12 ? 1000 : 1) : Date.parse(String(v));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function currencyOf(v) {
  const c = String(v || "usd").trim().toLowerCase();
  return /^[a-z]{3}$/.test(c) ? c : null;
}

function text(v, max = 500) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/* ═════════════════════════════════════════════════════════════════════════
   1. OPEN API — docs/finance/merchant-open-api.md
   Body: { events: [ {id, kind, amount_cents, currency?, occurred_at, description?} ] }
   or a single event object. Every event is checked; bad ones are reported by
   index and never stored, good ones go through.
   ═════════════════════════════════════════════════════════════════════════ */
export function normalizeOpenApiEvents(body) {
  const b = body && typeof body === "object" ? body : null;
  if (!b) return { ok: false, error: "body must be a JSON object", events: [], errors: [] };
  const list = Array.isArray(b.events) ? b.events : (b.id !== undefined ? [b] : null);
  if (!list) return { ok: false, error: "send an `events` array or one event object", events: [], errors: [] };
  if (list.length === 0) return { ok: false, error: "events is empty", events: [], errors: [] };
  if (list.length > MAX_EVENTS_PER_CALL) {
    return { ok: false, error: `at most ${MAX_EVENTS_PER_CALL} events per call`, events: [], errors: [] };
  }

  const events = [];
  const errors = [];
  const seen = new Set();
  list.forEach((e, index) => {
    const bad = (error) => errors.push({ index, id: e && e.id !== undefined ? String(e.id) : null, error });
    if (!e || typeof e !== "object") return bad("event must be an object");
    const id = text(e.id, 200);
    if (!id) return bad("id is required");
    if (seen.has(id)) return bad("id appears twice in this call");
    const kind = String(e.kind || "").toLowerCase();
    if (!KINDS.includes(kind)) return bad(`kind must be one of ${KINDS.join(", ")}`);
    if (!Number.isSafeInteger(e.amount_cents)) return bad("amount_cents must be a whole number of cents");
    if (kind === "sale" && e.amount_cents < 0) return bad("a sale cannot be negative — send a refund instead");
    const currency = currencyOf(e.currency);
    if (!currency) return bad("currency must be a 3-letter code like usd");
    const occurred = isoOrNull(e.occurred_at);
    if (!occurred) return bad("occurred_at must be an ISO 8601 date and time");
    seen.add(id);
    events.push({
      provider_event_id: id,
      kind,
      // A payout keeps the sender's sign: positive means a reversed payout.
      amount_cents: kind === "payout" ? (e.amount_cents > 0 && e.reversed === true ? e.amount_cents : -Math.abs(e.amount_cents)) : signFor(kind, e.amount_cents),
      currency,
      occurred_at: occurred,
      description: text(e.description),
      raw: e
    });
  });
  return { ok: true, events, errors };
}

/* ═════════════════════════════════════════════════════════════════════════
   2. WHOP
   Docs read 2026-10-06:
     https://docs.whop.com/developer/guides/webhooks
       "Whop webhooks use the Standard Webhooks specification." Headers
       `webhook-id`, `webhook-timestamp`, `webhook-signature` ("v1,<base64>").
       Signed string `{webhook-id}.{webhook-timestamp}.{raw body}`, HMAC-SHA256,
       "The key is your `ws_...` secret" — passed as given, prefix kept, not
       base64-decoded. Reject a timestamp more than 5 minutes from now.
       Envelope: { id: "msg_…", type, timestamp, account_id, data }.
     https://docs.whop.com/api-reference/beta/payments/payment-succeeded
     https://docs.whop.com/api-reference/beta/payments/retrieve-payment
       Payment: id "pay_…", currency, total / amount_after_fees are Money
       objects { amount: "10.00" (major units, decimal string), currency,
       decimals }, paid_at, created_at.
     https://docs.whop.com/api-reference/beta/refunds/retrieve-refund
       Refund (refund.created / refund.updated): id, amount (Money), status
       pending | requires_action | succeeded | failed | canceled, created_at.
     https://docs.whop.com/api-reference/beta/payouts/payout-created
     https://docs.whop.com/api-reference/beta/payouts/retrieve-payout
       Payout (payout.created / payout.updated / payout.reversed — "this event
       family replaces withdrawal.*"): id "wdrl_…", amount (decimal string,
       whole currency units), currency, status requested | in_review |
       processing | completed | reversed | canceled | failed | denied,
       created_at.
   ═════════════════════════════════════════════════════════════════════════ */
export const WHOP_TOLERANCE_SECONDS = 5 * 60;

export function verifyWhopSignature({ rawBody, headers = {}, secret, now = Date.now() } = {}) {
  if (!secret) return { ok: false, reason: "no_secret" };
  const h = (n) => headers[n] ?? headers[n.toLowerCase()] ?? headers[n.replace(/(^|-)([a-z])/g, (_, a, b) => a + b.toUpperCase())];
  const id = h("webhook-id");
  const ts = h("webhook-timestamp");
  const sig = h("webhook-signature");
  if (!id || !ts || !sig) return { ok: false, reason: "missing_headers" };
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: "bad_timestamp" };
  if (Math.abs(Math.floor(now / 1000) - tsNum) > WHOP_TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp" };
  const expected = crypto
    .createHmac("sha256", Buffer.from(String(secret), "utf8"))
    .update(`${id}.${ts}.${rawBody || ""}`)
    .digest();
  // Standard Webhooks allows several space-separated "v1,<sig>" entries.
  for (const part of String(sig).split(" ")) {
    const [ver, b64] = part.split(",");
    if (ver !== "v1" || !b64) continue;
    const got = Buffer.from(b64, "base64");
    if (got.length === expected.length && crypto.timingSafeEqual(got, expected)) return { ok: true };
  }
  return { ok: false, reason: "bad_signature" };
}

/* A Money object, or a bare decimal string/number for older API versions. */
function whopMoney(v, fallbackCurrency) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    const minor = decimalToMinor(v.amount, Number.isInteger(v.decimals) ? v.decimals : 2);
    const currency = currencyOf(v.currency || fallbackCurrency);
    return minor === null || !currency ? null : { minor, currency };
  }
  const minor = decimalToMinor(v, 2);
  const currency = currencyOf(fallbackCurrency);
  return minor === null || !currency ? null : { minor, currency };
}

/* whopEventsFrom(payload) → { events, ignored? } */
export function whopEventsFrom(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const type = String(p.type || "").toLowerCase();
  const d = p.data && typeof p.data === "object" ? p.data : {};
  const id = text(d.id, 180);
  if (!id) return { events: [], ignored: "no data.id" };
  const when = isoOrNull(d.paid_at) || isoOrNull(d.created_at) || isoOrNull(p.timestamp);
  if (!when) return { events: [], ignored: "no timestamp" };

  if (type === "payment.succeeded") {
    const total = whopMoney(d.total, d.currency);
    if (!total) return { events: [], ignored: "payment has no total" };
    const events = [{
      provider_event_id: id, kind: "sale", amount_cents: signFor("sale", total.minor),
      currency: total.currency, occurred_at: when, description: text(d.product_id ? `Whop ${d.product_id}` : "Whop payment"), raw: p
    }];
    const kept = whopMoney(d.amount_after_fees, d.currency);
    if (kept && kept.currency === total.currency && total.minor - kept.minor > 0) {
      events.push({
        provider_event_id: `${id}:fee`, kind: "fee", amount_cents: signFor("fee", total.minor - kept.minor),
        currency: total.currency, occurred_at: when, description: "Whop fees", raw: null
      });
    }
    return { events };
  }

  if (type === "refund.created" || type === "refund.updated") {
    if (String(d.status || "") !== "succeeded") return { events: [], ignored: `refund status ${d.status || "unknown"}` };
    const amt = whopMoney(d.amount, d.currency);
    if (!amt) return { events: [], ignored: "refund has no amount" };
    return { events: [{
      provider_event_id: id, kind: "refund", amount_cents: signFor("refund", amt.minor),
      currency: amt.currency, occurred_at: isoOrNull(d.created_at) || when,
      description: text(d.payment_id ? `Refund of ${d.payment_id}` : "Whop refund"), raw: p
    }] };
  }

  if (type === "payout.created" || type === "payout.updated" || type === "payout.reversed") {
    const amt = whopMoney(d.amount, d.currency);
    if (!amt) return { events: [], ignored: "payout has no amount" };
    const status = String(d.status || "");
    if (type === "payout.reversed" || status === "reversed") {
      return { events: [{
        provider_event_id: `${id}:reversed`, kind: "payout", amount_cents: Math.abs(amt.minor),
        currency: amt.currency, occurred_at: isoOrNull(p.timestamp) || when, description: "Whop payout reversed", raw: p
      }] };
    }
    if (status !== "completed") return { events: [], ignored: `payout status ${status || "unknown"}` };
    return { events: [{
      provider_event_id: id, kind: "payout", amount_cents: -Math.abs(amt.minor),
      currency: amt.currency, occurred_at: isoOrNull(d.created_at) || when, description: "Whop payout", raw: p
    }] };
  }

  return { events: [], ignored: `event type ${type || "unknown"}` };
}

/* ═════════════════════════════════════════════════════════════════════════
   3. COMMAS — a CLIENT'S own Commas account.
   Reuses Fundhub's own adapter helpers (src/adapters/commas.mjs) for the
   signature and the field paths, and none of its side effects: no inbox row,
   no bus event, no client find-or-create. Fundhub's own /api/webhooks/commas
   path is untouched.
   ═════════════════════════════════════════════════════════════════════════ */
export { COMMAS_SIGNATURE_HEADERS };

export function verifyClientCommasSignature({ rawBody, headers = {}, secret }) {
  const header = COMMAS_SIGNATURE_HEADERS.map((n) => headers[n] ?? headers[n.toLowerCase()]).find(Boolean);
  return verifyCommasSignature(rawBody, header, secret) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

export function commasEventsFrom(body) {
  const type = eventTypeOf(body);
  const evt = normalizeCommasEvent(body);
  // normalizeCommasEvent reads amounts in MAJOR units (dollars).
  const minor = evt.amount === null ? null : decimalToMinor(evt.amount, 2);
  const anchor = paymentIdOf(body) || evt.id;
  if (!anchor) return { events: [], ignored: "no payment id" };
  if (minor === null) return { events: [], ignored: "no amount" };
  const b = body || {};
  const d = (b.data && (b.data.object || b.data)) || b;
  const when = isoOrNull(d.created_at) || isoOrNull(b.created_at) || isoOrNull(d.paid_at) || new Date().toISOString();
  const currency = currencyOf(d.currency || b.currency) || "usd";

  // Refund tested before "succeeded" for the same reason mapToCanonical does:
  // a refund type must never fall into the sale branch.
  if (type.includes("refund")) {
    return { events: [{
      provider_event_id: `refund:${anchor}`, kind: "refund", amount_cents: signFor("refund", minor),
      currency, occurred_at: when, description: text(evt.name) || "Commas refund", raw: body
    }] };
  }
  const isSale = (type.startsWith("subscription.") && (type.includes("renewed") || type.includes("recovered")))
    || (!type.startsWith("subscription.") && type.includes("succeeded"));
  if (isSale) {
    const pid = type.startsWith("subscription.") ? (evt.id || anchor) : anchor;
    return { events: [{
      provider_event_id: `sale:${pid}`, kind: "sale", amount_cents: signFor("sale", minor),
      currency, occurred_at: when, description: text(evt.name) || "Commas payment", raw: body
    }] };
  }
  return { events: [], ignored: `event type ${type || "unknown"}` };
}

/* ═════════════════════════════════════════════════════════════════════════
   4. PULLED ROWS — what src/merchant/providers/* read with the client's own
   API key (migration 457, mode 'pull'). Pure, like everything above.
   ═════════════════════════════════════════════════════════════════════════ */

/* whopListItemEvents(stream, item) — one row from a Whop list endpoint.
   Whop's list endpoints return the SAME objects its webhooks carry in `data`
   (Payment, Refund, Payout — docs below), so each row is wrapped in the
   webhook envelope and handed to whopEventsFrom. One mapping, two doors: the
   ids, kinds and signs are identical whether a sale was pushed or pulled.
     https://docs.whop.com/api-reference/beta/payments/list-payments
     https://docs.whop.com/api-reference/beta/refunds/list-refunds
     https://docs.whop.com/api-reference/beta/payouts/list-payouts

   payments: only `status: "paid"` is money that moved ("`paid` once the money
     moved"). Anything else is ignored.
   refunds:  whopEventsFrom already keeps only `status: "succeeded"`.
   payouts:  `completed` is money sent to the bank. A payout the list shows as
     `reversed` was completed first and then returned, so it yields BOTH rows —
     the payout and its reversal — which net to zero. The webhook path gets the
     same two rows from two deliveries. */
export function whopListItemEvents(stream, item) {
  const d = item && typeof item === "object" ? item : null;
  if (!d) return { events: [], ignored: "not an object" };
  if (stream === "payments") {
    if (String(d.status || "") !== "paid") return { events: [], ignored: `payment status ${d.status || "unknown"}` };
    return whopEventsFrom({ type: "payment.succeeded", data: d });
  }
  if (stream === "refunds") return whopEventsFrom({ type: "refund.updated", data: d });
  if (stream === "payouts") {
    const status = String(d.status || "");
    if (status === "reversed") {
      const sent = whopEventsFrom({ type: "payout.updated", data: { ...d, status: "completed" } });
      const back = whopEventsFrom({ type: "payout.reversed", data: d, timestamp: d.updated_at || d.created_at });
      return { events: [...sent.events, ...back.events], ignored: sent.ignored || back.ignored };
    }
    return whopEventsFrom({ type: "payout.updated", data: d });
  }
  return { events: [], ignored: `unknown stream ${stream}` };
}

/* commasTransactionEvents(t) — one row from Commas' List Transactions.
     https://commasdocs.com — "List Transactions"
       GET /public-api/checkout-sessions/transactions
     Row: id (integer), transaction_date (ISO 8601), amount (number, dollars —
     "Gross amount charged, in dollars (29.99 = $29.99)"), fee_amount ("Commas
     fee, in dollars"), net_amount, product / service { id, title, price },
     refunds ("Refunds issued against this transaction; empty when none").
   Commas documents no currency on a transaction row; every amount is stated
   "in dollars", so the rows are usd.

   The refund objects inside `refunds` are NOT field-by-field documented on
   that endpoint. Only the field names Commas documents for a refund elsewhere
   are read — refund_id with amount (the refund.created webhook) or
   refund_amount / refund_amount_cents (the Create a Refund response). A refund
   without them is counted as ignored, never guessed at.

   The ids are `txn:<id>` / `txn:<id>:fee` / `refund:<refund_id>` — NOT the
   webhook path's `sale:<ORD-…>`. Commas' webhooks name a payment by its order
   id and this list names it by a numeric id, which is why a connection is
   either push or pull, never both (migration 457). */
export function commasTransactionEvents(t) {
  const row = t && typeof t === "object" ? t : null;
  if (!row) return { events: [], ignored: "not an object" };
  const id = row.id === null || row.id === undefined ? null : text(row.id, 150);
  if (!id) return { events: [], ignored: "no transaction id" };
  const when = isoOrNull(row.transaction_date);
  if (!when) return { events: [], ignored: "no transaction_date" };
  const gross = decimalToMinor(row.amount, 2);
  if (gross === null) return { events: [], ignored: "no amount" };
  const title = text((row.product && row.product.title) || (row.service && row.service.title));

  const events = [{
    provider_event_id: `txn:${id}`, kind: "sale", amount_cents: signFor("sale", gross),
    currency: "usd", occurred_at: when, description: title || "Commas payment", raw: row
  }];
  const fee = decimalToMinor(row.fee_amount, 2);
  if (fee !== null && fee !== 0) {
    events.push({
      provider_event_id: `txn:${id}:fee`, kind: "fee", amount_cents: signFor("fee", fee),
      currency: "usd", occurred_at: when, description: "Commas fees", raw: null
    });
  }

  let skipped = 0;
  for (const r of Array.isArray(row.refunds) ? row.refunds : []) {
    const rid = r && r.refund_id !== undefined && r.refund_id !== null ? text(r.refund_id, 150) : null;
    const status = r && r.status !== undefined && r.status !== null ? String(r.status).toLowerCase() : null;
    const cents = !r ? null
      : Number.isSafeInteger(r.refund_amount_cents) ? r.refund_amount_cents
        : decimalToMinor(r.amount ?? r.refund_amount, 2);
    if (!rid || cents === null || (status && status !== "success" && status !== "succeeded")) { skipped++; continue; }
    events.push({
      provider_event_id: `refund:${rid}`, kind: "refund", amount_cents: signFor("refund", cents),
      currency: "usd", occurred_at: isoOrNull(r.created_at) || when,
      description: text(title ? `Refund of ${title}` : "Commas refund"), raw: r
    });
  }
  return skipped ? { events, ignored: `${skipped} refund(s) without a documented id and amount` } : { events };
}
