import { test } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import {
  verifyCommasSignature,
  verifyCommasWebhookAuth,
  isSimulatedReceipt,
  normalizeCommasEvent,
  productOf,
  mapToCanonical,
  handleCommasWebhook,
  processCommasInboxRow,
  buildCommasCheckoutUrl,
  paymentIdOf,
  eventTypeOf,
  SIGNATURE_HEADERS,
  PURPOSE_PRODUCT
} from "./commas.mjs";
import { drain, dedupeKeyFor } from "../payments/commas-inbox.mjs";
import { looksMasked } from "../../scripts/sim/push-payment.mjs";
import { _resetOrgCache } from "../events/bus.mjs";
import { on, clearHandlers } from "../events/registry.mjs";

/* Fake db — models every table the payment path touches.
 *
 * It models the unique indexes that carry the money guarantees, because a fake
 * that ignores them lets a test pass while the real thing double-counts:
 *
 *   events        ON CONFLICT (org_id, idempotency_key) DO NOTHING
 *   commas_inbox  ON CONFLICT (org_id, dedupe_key)      DO NOTHING
 *   clients       ON CONFLICT (org_id, lower(email))    DO NOTHING
 *
 * The inbox is the one that matters most now. Under at-most-once delivery the
 * inbox key is the FIRST line of defence against a re-delivery — it stops the
 * duplicate before the payload has even been interpreted.
 *
 * payment_links and clients are modelled WITH their org column. Attributing a
 * payment to another tenant's client is the failure those two answers exist to
 * prevent, and a fake with no org on the row cannot catch it. */
function fakeDb({ dedupEvents = false, store = [], inbox = [], links = [], clients = [], transactions = [] } = {}) {
  let n = 0;
  let inboxN = 0;
  let clientN = 0;
  const eventKeys = new Set();

  return {
    inbox,
    store,
    links,
    clients,
    query(sql, params) {
      if (/FROM transactions t/.test(sql)) {
        const [orgId, paymentId] = params;
        const original = transactions.find((t) => t.org_id === orgId &&
          t.provider === "commas" && t.provider_ref === paymentId && t.status === "succeeded" &&
          clients.some((c) => c.id === t.client_id && c.org_id === orgId));
        return { rows: original ? [{ client_id: original.client_id }] : [] };
      }
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };

      /* --- payment_links ----------------------------------------------------
         The row that says what a payment was FOR and WHOSE it is. Both lookups
         the adapter can make are modelled, because they answer differently: a
         link minted through the checkout-session API comes back keyed by the
         session id, not by our ref. */
      if (/FROM payment_links/.test(sql)) {
        const key = /link_ref = \$1/.test(sql) ? "link_ref" : "commas_session_id";
        const hit = links.find((r) => r[key] && r[key] === params[0]);
        return { rows: hit ? [{ ...hit }] : [] };
      }

      /* --- clients ----------------------------------------------------------
         Modelled with the org column, because attributing a payment to a
         client of another org is the failure this table is here to catch. */
      if (/FROM clients/.test(sql)) {
        if (/lower\(email\) = \$2/.test(sql)) {
          const [orgId, email] = params;
          const hit = clients.find(
            (c) => c.org_id === orgId && String(c.email || "").toLowerCase() === String(email)
          );
          return { rows: hit ? [{ ...hit }] : [] };
        }
        const [id, orgId] = params;
        const hit = clients.find((c) => c.id === id && c.org_id === orgId);
        return { rows: hit ? [{ ...hit }] : [] };
      }
      if (/INSERT INTO clients/.test(sql)) {
        const [orgId, email] = params;
        const lower = String(email || "").toLowerCase();
        // clients_org_email_uniq
        if (clients.some((c) => c.org_id === orgId && String(c.email || "").toLowerCase() === lower)) {
          return { rows: [] };
        }
        const row = { id: `client-${++clientN}`, org_id: orgId, email: lower, ghl_contact_id: "crm-x" };
        clients.push(row);
        return { rows: [{ id: row.id }] };
      }

      // --- commas_inbox -----------------------------------------------------
      if (/SELECT id, raw_body, event_type, dedupe_key FROM commas_inbox/.test(sql)) {
        return { rows: inbox.filter((r) => r.org_id === params[0] && r.event_type.includes("refund") &&
          !r.dedupe_key.startsWith("refund:")) };
      }
      if (/INSERT INTO commas_inbox/.test(sql)) {
        const [orgId, dedupeKey, paymentId, eventType, rawBody, headers, source] = params;
        if (inbox.some((r) => r.org_id === orgId && r.dedupe_key === dedupeKey)) {
          return { rows: [] }; // unique index absorbed it
        }
        const row = {
          id: `inbox-${++inboxN}`,
          org_id: orgId,
          dedupe_key: dedupeKey,
          payment_id: paymentId,
          event_type: eventType,
          raw_body: rawBody,
          headers,
          source,
          status: "pending",
          attempts: 0,
          last_error: null
        };
        inbox.push(row);
        return { rows: [{ id: row.id }] };
      }
      /* ANCHORED. The claim statement below contains "SELECT id FROM
         commas_inbox" inside its own subquery, so an unanchored match here
         swallows the claim and every sweep silently returns zero rows. */
      if (/^\s*SELECT id FROM commas_inbox/.test(sql)) {
        const [orgId, dedupeKey] = params;
        const hit = inbox.find((r) => r.org_id === orgId && r.dedupe_key === dedupeKey);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      if (/UPDATE commas_inbox/.test(sql) && /status = 'processing'/.test(sql)) {
        const limit = params[2];
        const claimable = inbox
          .filter((r) => ["pending", "failed"].includes(r.status))
          .slice(0, limit);
        for (const r of claimable) { r.status = "processing"; r.attempts += 1; }
        return { rows: claimable.map((r) => ({ ...r })) };
      }
      if (/UPDATE commas_inbox/.test(sql)) {
        const id = params[0];
        const row = inbox.find((r) => r.id === id);
        if (row) {
          if (/status = 'done'/.test(sql)) row.status = "done";
          else if (/status = 'ignored'/.test(sql)) { row.status = "ignored"; row.last_error = params[1]; }
          else if (/status = 'failed'/.test(sql)) { row.status = "failed"; row.last_error = params[1]; }
        }
        return { rows: [] };
      }

      // --- events -----------------------------------------------------------
      if (/INSERT INTO events/.test(sql)) {
        if (dedupEvents) return { rows: [] };
        const idem = params[3];
        if (idem != null) {
          const k = `${params[0]}|${idem}`;
          if (eventKeys.has(k)) return { rows: [] };
          eventKeys.add(k);
        }
        const row = { id: `evt-${++n}` };
        // params[4] is events.client_id — the column that says WHOSE payment this is.
        store.push({ ...row, name: params[1], payload: params[5], idempotency_key: idem, client_id: params[4] });
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const SECRET = "whsec_test";
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("hex");

/* deliver — the whole path a real payment takes: webhook stores and answers,
   then a sweep pass interprets. Anything asserting on emitted events has to go
   through both halves now, because the first half deliberately decides
   nothing. */
async function deliver(db, rawBody, { signatureHeader } = {}) {
  const ack = await handleCommasWebhook({
    db,
    rawBody,
    signatureHeader: signatureHeader ?? sign(rawBody),
    secret: SECRET
  });
  const swept = ack.ok
    ? await drain(db, { process: processCommasInboxRow })
    : { claimed: 0, counts: {} };
  return { ack, swept };
}

// --- signature -------------------------------------------------------------
test("verifyCommasSignature: accepts valid, rejects tampered / missing", () => {
  const raw = JSON.stringify({ hi: 1 });
  assert.equal(verifyCommasSignature(raw, sign(raw), SECRET), true);
  assert.equal(verifyCommasSignature(raw, "sha256=" + sign(raw), SECRET), true); // prefixed
  assert.equal(verifyCommasSignature(raw, sign(raw + "x"), SECRET), false);
  assert.equal(verifyCommasSignature(raw, "", SECRET), false);
  assert.equal(verifyCommasSignature(raw, sign(raw), null), false); // no secret => closed
});

test("the documented header is checked FIRST, the old name kept as fallback", () => {
  // The adapter was wired to x-commas-signature, which no delivery has ever
  // carried — every real payment 401'd. Order is the fix, so order is asserted.
  assert.deepEqual(SIGNATURE_HEADERS, ["x-webhook-signature", "x-commas-signature"]);
});

// --- two payload shapes ----------------------------------------------------
/* Real deliveries are enveloped. The dashboard's Test Webhook button sends
   payment.succeeded FLAT. Validating against the test button alone proves
   nothing about production, so both shapes are fixtures. */

const LIVE_ENVELOPE = JSON.stringify({
  id: "evt_delivery_001",
  type: "payment.succeeded",
  created_at: "2026-08-06T04:00:00Z",
  data: {
    payment_id: "pay_live_1",
    amount: 3000,
    product: { title: "Consulting Services Deposit", price: 3000 },
    fan: { email: "live@example.com" }
  }
});

const FLAT_TEST_EVENT = JSON.stringify({
  type: "payment.succeeded",
  payment_id: "pay_flat_1",
  amount: 32,
  product_name: "Business Financial Assessment",
  email: "flat@example.com"
});

test("normalize reads the LIVE ENVELOPE shape ({id,type,data,created_at})", () => {
  const evt = normalizeCommasEvent(JSON.parse(LIVE_ENVELOPE));
  assert.equal(evt.type, "payment.succeeded");
  assert.equal(evt.paymentId, "pay_live_1");
  assert.equal(evt.name, "Consulting Services Deposit");
  assert.equal(evt.amount, 3000);
  assert.equal(evt.email, "live@example.com");
});

test("normalize reads the FLAT test-button shape (no envelope)", () => {
  const evt = normalizeCommasEvent(JSON.parse(FLAT_TEST_EVENT));
  assert.equal(evt.type, "payment.succeeded");
  assert.equal(evt.paymentId, "pay_flat_1");
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.amount, 32);
  assert.equal(evt.email, "flat@example.com");
});

test("paymentIdOf / eventTypeOf work on both shapes and never throw", () => {
  assert.equal(paymentIdOf(JSON.parse(LIVE_ENVELOPE)), "pay_live_1");
  assert.equal(paymentIdOf(JSON.parse(FLAT_TEST_EVENT)), "pay_flat_1");
  assert.equal(eventTypeOf(JSON.parse(LIVE_ENVELOPE)), "payment.succeeded");
  assert.equal(eventTypeOf(JSON.parse(FLAT_TEST_EVENT)), "payment.succeeded");
  assert.equal(paymentIdOf(null), null);
  assert.equal(eventTypeOf(undefined), "");
  assert.equal(paymentIdOf({}), null);
});

test("normalizeCommasEvent: reads FanBasis SDK shape (data.product / data.fan)", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    id: "txn_123",
    data: {
      product: { title: "Business Financial Assessment", price: 32 },
      fan: { email: "JANE@EXAMPLE.com" }
    }
  });
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.amount, 32);
  assert.equal(evt.email, "jane@example.com"); // lowercased/trimmed
  assert.equal(evt.id, "txn_123");
});

/* Documented live envelope (apidocs.fan payment.succeeded): buyer.email,
   item.title, api_metadata.data — not product/fan. Prefer these first so a
   real delivery is not routed unmatched while older fixtures still pass. */
test("normalizeCommasEvent: reads documented envelope (buyer.email / item.title / api_metadata)", () => {
  const evt = normalizeCommasEvent({
    id: "9b2f5c1e-4a7d-4c9e-b1f3-2d8e6a1c0f45",
    type: "payment.succeeded",
    created_at: "2026-07-13T21:42:47+00:00",
    data: {
      payment_id: "ORD-8F3K-2MQ9-X7LP",
      amount: 29.0,
      buyer: { id: "user_4Kd9mQ2xZ7Lp", name: "Alex Johnson", email: "ALEX@EXAMPLE.com" },
      item: { id: "NLxj6", title: "Business Financial Assessment", type: "onetime" },
      api_metadata: { data: { link_ref: "pl_abc123", plan: "monthly" } }
    }
  });
  assert.equal(evt.paymentId, "ORD-8F3K-2MQ9-X7LP");
  assert.equal(evt.name, "Business Financial Assessment");
  assert.equal(evt.email, "alex@example.com");
  assert.equal(evt.ref, "pl_abc123");
  assert.equal(evt.amount, 29);
});

test("normalizeCommasEvent: api_metadata.data.ref is accepted when link_ref absent", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    data: {
      payment_id: "ORD-REF-ONLY",
      amount: 100,
      buyer: { email: "ref@example.com" },
      item: { title: "Consulting Services Deposit" },
      api_metadata: { data: { ref: "pl_ref_only" } }
    }
  });
  assert.equal(evt.ref, "pl_ref_only");
});

test("normalizeCommasEvent: amount_cents downscales, missing amount => null", () => {
  assert.equal(normalizeCommasEvent({ data: { amount_cents: 300000 } }).amount, 3000);
  assert.equal(normalizeCommasEvent({ data: { product: { title: "x" } } }).amount, null);
});

test("normalizeCommasEvent: carries a dispute deadline through as dueBy", () => {
  const evt = normalizeCommasEvent({
    type: "dispute.created",
    data: { payment_id: "pay_d", due_by: "2026-08-20T00:00:00Z", amount: 500 }
  });
  assert.equal(evt.dueBy, "2026-08-20T00:00:00Z");
  assert.equal(normalizeCommasEvent({ data: {} }).dueBy, null, "must not invent a deadline");
});

// --- product routing (name only, never amount) -----------------------------
test("productOf: routes strictly by product name", () => {
  assert.equal(productOf({ name: "Business Financial Assessment" }), "crs");
  assert.equal(productOf({ name: "Consulting Services Deposit" }), "deposit");
  assert.equal(productOf({ name: "Consulting Success Fee" }), "success_fee");
  assert.equal(productOf({ name: "Consulting Services Package" }), "diy");
  assert.equal(productOf({ name: "Mystery Box" }), "unmatched");
});

// --- canonical mapping -----------------------------------------------------
test("mapToCanonical: $32 CRS => payment.received + diagnostic.paid", () => {
  const names = mapToCanonical({ type: "payment.succeeded", name: "Business Financial Assessment" }).map((c) => c.name);
  assert.deepEqual(names, ["payment.received", "diagnostic.paid"]);
});

test("mapToCanonical: deposit => deposit.paid, diy => sale.closed", () => {
  assert.deepEqual(
    mapToCanonical({ type: "payment.succeeded", name: "Consulting Services Deposit" }).map((c) => c.name),
    ["payment.received", "deposit.paid"]
  );
  assert.deepEqual(
    mapToCanonical({ type: "payment.succeeded", name: "Consulting Services Package" }).map((c) => c.name),
    ["payment.received", "sale.closed"]
  );
});

test("mapToCanonical: failed => payment.failed only; unmatched succeeded => payment.received only", () => {
  assert.deepEqual(mapToCanonical({ type: "payment.failed", name: "x" }).map((c) => c.name), ["payment.failed"]);
  assert.deepEqual(mapToCanonical({ type: "payment.succeeded", name: "Mystery Box" }).map((c) => c.name), [
    "payment.received"
  ]);
  assert.deepEqual(mapToCanonical({ type: "checkout.pending", name: "x" }), []); // non-terminal ignored
});

/* THE DECLINE-METRIC RULE. expired and canceled are abandoned checkouts, not
   declines. Mapping them onto payment.failed would inflate the decline rate
   with people who were never declined. */
test("expired / canceled are ops-only: never payment.failed, never money", () => {
  const expired = mapToCanonical({ type: "payment.expired", name: "Consulting Services Deposit" });
  const canceled = mapToCanonical({ type: "payment.canceled", name: "Consulting Services Deposit" });

  assert.deepEqual(expired.map((c) => c.name), ["payment.expired"]);
  assert.deepEqual(canceled.map((c) => c.name), ["payment.canceled"]);

  for (const set of [expired, canceled]) {
    const names = set.map((c) => c.name);
    assert.ok(!names.includes("payment.failed"), "an abandoned checkout was counted as a decline");
    assert.ok(!names.includes("payment.received"), "an abandoned checkout credited money");
    assert.ok(!names.includes("deposit.paid"), "an abandoned checkout advanced the journey");
  }
  // British spelling must not fall through to succeeded either.
  assert.deepEqual(
    mapToCanonical({ type: "payment.cancelled", name: "x" }).map((c) => c.name),
    ["payment.canceled"]
  );
});

test("refund.created and dispute.created map to their own events, crediting nothing", () => {
  const refund = mapToCanonical({ type: "refund.created", refundStatus: "success", name: "Consulting Services Deposit" });
  const dispute = mapToCanonical({ type: "dispute.created", name: "Consulting Services Deposit" });
  assert.deepEqual(refund.map((c) => c.name), ["payment.refunded"]);
  assert.deepEqual(dispute.map((c) => c.name), ["payment.disputed"]);
  for (const set of [refund, dispute]) {
    assert.ok(!set.some((c) => c.name === "payment.received"), "money was credited a second time");
  }
});

// --- ACK BEFORE WORK -------------------------------------------------------

test("the webhook answers 200 having done nothing but store the bytes", async () => {
  _resetOrgCache(); clearHandlers();
  let handlerRan = false;
  on("deposit.paid", () => { handlerRan = true; });

  const db = fakeDb();
  const ack = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET
  });

  assert.equal(ack.ok, true);
  assert.equal(ack.status, 200);
  assert.equal(ack.queued, true);
  assert.equal(db.inbox.length, 1, "the bytes were not made durable before answering");
  assert.equal(db.inbox[0].raw_body, LIVE_ENVELOPE, "stored bytes differ from what was signed");
  assert.equal(db.inbox[0].payment_id, "pay_live_1");

  // The whole point: no interpretation, no events, no handlers, before the 200.
  assert.equal(db.store.length, 0, "an event was emitted on the request path");
  assert.equal(handlerRan, false, "a handler ran on the request path");
});

test("bad signature => 401 and NOTHING is stored", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const res = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: "nope", secret: SECRET
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.queued, false);
  assert.equal(db.inbox.length, 0);
});

test("a signed but UNPARSEABLE body is still stored, not refused", async () => {
  /* It carries a valid signature, so it really came from Commas. A payload we
     could not parse but kept is a bug report; one we refused is a lost
     payment. */
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = "{not json at all";
  const ack = await handleCommasWebhook({
    db, rawBody: raw, signatureHeader: sign(raw), secret: SECRET
  });
  assert.equal(ack.status, 200);
  assert.equal(db.inbox.length, 1);
  assert.match(ack.reason, /^stored_unparseable/);

  // And it terminates rather than retrying forever.
  const swept = await drain(db, { process: processCommasInboxRow });
  assert.equal(swept.counts.ignored, 1);
  assert.equal(db.inbox[0].status, "ignored");
});

test("if the inbox write fails the caller gets 5xx, never a false 200", async () => {
  _resetOrgCache(); clearHandlers();
  const db = {
    query(sql) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      throw new Error("database is down");
    }
  };
  const res = await handleCommasWebhook({
    db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET
  });
  assert.equal(res.ok, false);
  assert.equal(res.status, 500);
  assert.equal(res.reason, "inbox_write_failed");
});

// --- phase two: the sweep --------------------------------------------------

test("the sweep turns a stored deposit into both canonical events + handlers", async () => {
  _resetOrgCache(); clearHandlers();
  const seen = [];
  on("deposit.paid", (e) => seen.push(e.name));
  on("payment.received", (e) => seen.push(e.name));

  const db = fakeDb();
  const { ack, swept } = await deliver(db, LIVE_ENVELOPE);

  assert.equal(ack.status, 200);
  assert.equal(swept.counts.done, 1);
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "deposit.paid"]);
  assert.deepEqual(seen.sort(), ["deposit.paid", "payment.received"]);
  assert.equal(db.inbox[0].status, "done");
});

test("the FLAT test-button payload survives the whole path too", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const { swept } = await deliver(db, FLAT_TEST_EVENT);
  assert.equal(swept.counts.done, 1);
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "diagnostic.paid"]);
});

test("a non-terminal event is stored, then terminates as ignored", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({ type: "checkout.pending", data: { payment_id: "pay_p" } });
  const { ack, swept } = await deliver(db, raw);
  assert.equal(ack.status, 200);
  assert.equal(swept.counts.ignored, 1);
  assert.equal(db.store.length, 0);
  assert.match(db.inbox[0].last_error, /no_canonical_mapping/);
});

// --- IDEMPOTENCY: the payment id, not the envelope id ----------------------

/* THE BUG THIS TEST EXISTS FOR. Commas' envelope `id` is per-DELIVERY. The
   adapter used to key on it, so two deliveries of one payment carried two keys,
   both looked new, and the deposit was counted twice. */
test("two deliveries of ONE payment, different envelope ids, count once", async () => {
  _resetOrgCache(); clearHandlers();
  let depositHandlerRuns = 0;
  on("deposit.paid", () => { depositHandlerRuns += 1; });

  const db = fakeDb();
  const mk = (envelopeId) => JSON.stringify({
    id: envelopeId,               // differs per delivery
    type: "payment.succeeded",
    data: {
      payment_id: "pay_same_1",   // the actual payment — identical
      amount: 3000,
      product: { title: "Consulting Services Deposit", price: 3000 },
      fan: { email: "twice@example.com" }
    }
  });

  const first = await deliver(db, mk("evt_delivery_A"));
  const second = await deliver(db, mk("evt_delivery_B"));

  assert.equal(first.ack.queued, true);
  assert.equal(second.ack.queued, false, "the second delivery was treated as new money");
  assert.equal(second.ack.deduped, true);
  assert.equal(db.inbox.length, 1, "one payment produced two inbox rows");
  assert.equal(depositHandlerRuns, 1, "the deposit was counted twice");
  assert.equal(db.store.filter((e) => e.name === "payment.received").length, 1);
});

test("one payment's DIFFERENT events do not collapse into each other", async () => {
  // succeeded, then later refunded — same payment id, two real events.
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const succeeded = JSON.stringify({
    id: "evt_1", type: "payment.succeeded",
    data: { payment_id: "pay_x", amount: 500, product: { title: "Mystery Box" } }
  });
  const refunded = JSON.stringify({
    id: "evt_2", type: "refund.created",
    data: { payment_id: "pay_x", amount: 500, status: "success", product: { title: "Mystery Box" } }
  });
  await deliver(db, succeeded);
  await deliver(db, refunded);

  assert.equal(db.inbox.length, 2, "a refund was swallowed by its own payment's dedupe key");
  const names = db.store.map((e) => e.name);
  assert.ok(names.includes("payment.received"));
  assert.ok(names.includes("payment.refunded"));
});

test("distinct partial refunds reach the bus once each despite changed delivery ids", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [{ id: CLIENT_A, org_id: "org-1", email: "refund@example.invalid" }],
    transactions: [{ org_id: "org-1", client_id: CLIENT_A, provider: "commas",
      provider_ref: "ORD-original", status: "succeeded" }]
  });
  const receipt = (refundId, envelopeId, amount) => JSON.stringify({
    id: envelopeId, type: "refund.created",
    data: { refund_id: refundId, refund_transaction_id: "originalHashid",
      payment_id: "ORD-original", amount, status: "success" }
  });
  await deliver(db, receipt("refundA", "deliveryA", 40));
  await deliver(db, receipt("refundB", "deliveryB", 60));
  const replay = await deliver(db, receipt("refundA", "anotherDelivery", 40));
  assert.equal(replay.ack.deduped, true);
  assert.equal(db.inbox.length, 2);
  assert.equal(db.store.length, 2);
  assert.deepEqual(db.store.map((e) => e.payload.amount), [40, 60]);
  assert.deepEqual(db.store.map((e) => e.payload.refundId), ["refundA", "refundB"]);
  assert.ok(db.store.every((e) => e.name === "payment.refunded" && e.client_id === CLIENT_A &&
    e.payload.providerRef === "ORD-original" && e.payload.refundTransactionId === "originalHashid"));
});

test("documented refund hashids survive without being guessed as the original payment", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [{ id: CLIENT_A, org_id: "org-1", email: "refund@example.invalid" }],
    transactions: ["pX9vQ", "deliveryA"].map((provider_ref) => ({
      org_id: "org-1", client_id: CLIENT_A, provider: "commas", provider_ref, status: "succeeded"
    }))
  });
  const receipt = (refundId, envelopeId) => JSON.stringify({
    id: envelopeId, type: "refund.created",
    data: { refund_id: refundId, refund_transaction_id: "pX9vQ", amount: 25, status: "success",
      buyer: { email: "refund@example.invalid" }, item: { id: "kQ7wR", title: "Consulting Services Package" } }
  });
  await deliver(db, receipt("d8Kw2", "deliveryA"));
  await deliver(db, receipt("secondRefund", "deliveryB"));
  await deliver(db, receipt("d8Kw2", "changedDelivery"));
  assert.equal(db.inbox.length, 2, "refund id must dedupe even with no payment_id");
  assert.equal(db.store.length, 2);
  assert.ok(db.store.every((e) => e.client_id === null && e.payload.paymentId === null &&
    e.payload.providerRef === null && e.payload.refundTransactionId === "pX9vQ"));
  assert.deepEqual(db.store.map((e) => e.payload.refundId), ["d8Kw2", "secondRefund"]);
  assert.equal(db.clients.length, 1);
});

test("refund replay recognizes old payment and body keys without swallowing a new partial", async () => {
  _resetOrgCache(); clearHandlers();
  for (const [paymentId, type] of [["ORD-original", "refund.created"], [null, "refund.created"],
    ["ORD-original", "refund.succeeded"]]) {
    const oldBody = JSON.stringify({ id: "oldDelivery", type, data: {
      payment_id: paymentId, refund_id: "oldRefund", refund_transaction_id: "pX9vQ", amount: 40, status: "success"
    } });
    const db = fakeDb({ inbox: [{ id: "legacy", org_id: "org-1", status: "done",
      dedupe_key: dedupeKeyFor({ paymentId, eventType: type, refundStatus: "success", rawBody: oldBody }),
      raw_body: oldBody, event_type: type, payment_id: paymentId }] });
    const replay = JSON.parse(oldBody);
    replay.id = "newDelivery";
    replay.type = "refund.created";
    assert.equal((await deliver(db, JSON.stringify(replay))).ack.deduped, true);
    assert.equal(db.store.length, 0, "a previously handled refund was emitted again");
    replay.data.refund_id = "newRefund";
    replay.data.amount = 60;
    assert.equal((await deliver(db, JSON.stringify(replay))).ack.queued, true);
    assert.equal(db.store.length, 1);
  }
});

test("failed and pending refunds cannot revoke access or swallow the later settled callback", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  let refunds = 0;
  on("payment.refunded", () => { refunds += 1; });
  const receipt = (type, status, delivery) => JSON.stringify({ id: delivery, type, data: {
    refund_id: "statusRefund", refund_transaction_id: "pX9vQ", payment_id: "ORD-original",
    amount: 100, status
  } });
  for (const [type, status] of [["refund.failed", "failed"], ["refund.created", "pending"],
    ["refund.created", "failed"], ["refund.created", undefined], ["refund.succeeded", "pending"]]) {
    await deliver(db, receipt(type, status, `${type}-${status}`));
    assert.equal(refunds, 0, `${type}/${status} must not emit a financial reversal`);
  }
  await deliver(db, receipt("refund.created", "success", "settled"));
  await deliver(db, receipt("refund.created", "success", "settled-replay"));
  await deliver(db, receipt("refund.succeeded", "succeeded", "settled-legacy-alias"));
  assert.equal(refunds, 1, "a prior non-settled callback must not swallow settlement");
  assert.equal(db.store.length, 1);
});

test("a webhook with NO payment id still dedupes on replay", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email: "noid@example.com" }
  });
  const first = await deliver(db, raw);
  const second = await deliver(db, raw);

  assert.equal(first.ack.queued, true);
  assert.equal(second.ack.deduped, true, "a replayed id-less webhook was stored twice");
  assert.equal(db.inbox.length, 1);
  assert.ok(db.store.every((e) => e.idempotency_key), "an event was written with no idempotency key");
});

test("id-less webhooks with DIFFERENT bytes are not collapsed", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const mk = (email) => JSON.stringify({
    type: "payment.succeeded",
    data: { name: "Business Financial Assessment", amount: 32, email }
  });
  await deliver(db, mk("a@example.com"));
  await deliver(db, mk("b@example.com"));
  assert.equal(db.inbox.length, 2, "two different payments were collapsed into one");
});

test("dedupeKeyFor prefers the payment id and falls back to a body hash", () => {
  assert.equal(
    dedupeKeyFor({ paymentId: "pay_1", eventType: "payment.succeeded" }),
    "pay_1:payment.succeeded"
  );
  const hashed = dedupeKeyFor({ paymentId: null, eventType: "payment.succeeded", rawBody: "{}" });
  assert.match(hashed, /^body:[0-9a-f]{64}:payment\.succeeded$/);
});

// --- payload reaching handlers ---------------------------------------------

test("a payment link's ref reaches the emitted payment.received payload", async () => {
  _resetOrgCache(); clearHandlers();
  let seenPayload = null;
  on("payment.received", (e) => { seenPayload = e.payload; });
  const raw = JSON.stringify({
    type: "payment.succeeded",
    id: "txn_link_1",
    data: {
      payment_id: "pay_link_1",
      product: { title: "Mystery Box", price: 250 },
      fan: { email: "a@b.com" },
      client_reference_id: "pl_xyz"
    }
  });
  await deliver(fakeDb(), raw);
  assert.ok(seenPayload, "payment.received never dispatched");
  assert.equal(seenPayload.ref, "pl_xyz");
  assert.equal(seenPayload.paymentId, "pay_link_1");
  assert.equal(seenPayload.providerRef, "pay_link_1", "providerRef must be the stable payment id");
});

const INVOICE_A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const ROUND_A = "11111111-2222-4333-8444-555555555555";

test("normalizeCommasEvent: reads invoice_id and funding_round_id from checkout metadata", () => {
  const fromApi = normalizeCommasEvent({
    data: { api_metadata: { data: { invoice_id: INVOICE_A, funding_round_id: ROUND_A } } }
  });
  assert.equal(fromApi.invoiceId, INVOICE_A);
  assert.equal(fromApi.fundingRoundId, ROUND_A);
  const fromMeta = normalizeCommasEvent({
    data: { metadata: { invoice_id: INVOICE_A, funding_round_id: ROUND_A } }
  });
  assert.equal(fromMeta.invoiceId, INVOICE_A);
  assert.equal(fromMeta.fundingRoundId, ROUND_A);
  assert.equal(normalizeCommasEvent({ data: {} }).invoiceId, null);
  assert.equal(
    normalizeCommasEvent({ data: { metadata: { invoice_id: "inv_vendor_9" } } }).invoiceId,
    null,
    "a vendor invoice number is not one of ours"
  );
});

test("a payment link's invoice id reaches the emitted payment.received payload", async () => {
  _resetOrgCache(); clearHandlers();
  let seenPayload = null;
  on("payment.received", (e) => { seenPayload = e.payload; });
  const raw = JSON.stringify({
    type: "payment.succeeded",
    id: "txn_inv_1",
    data: {
      payment_id: "pay_inv_1",
      product: { title: "Consulting Success Fee", price: 1000 },
      fan: { email: "a@b.com" },
      api_metadata: { data: { link_ref: "pl_inv", invoice_id: INVOICE_A, funding_round_id: ROUND_A } }
    }
  });
  await deliver(fakeDb(), raw);
  assert.ok(seenPayload, "payment.received never dispatched");
  assert.equal(seenPayload.invoiceId, INVOICE_A);
  assert.equal(seenPayload.fundingRoundId, ROUND_A);
  assert.equal(seenPayload.ref, "pl_inv");
});

test("a dispute's deadline reaches the payload so the task can carry it", async () => {
  _resetOrgCache(); clearHandlers();
  let seen = null;
  on("payment.disputed", (e) => { seen = e.payload; });
  const raw = JSON.stringify({
    type: "dispute.created",
    id: "evt_d",
    data: {
      payment_id: "pay_disputed",
      amount: 3000,
      due_by: "2026-08-20T00:00:00Z",
      product: { title: "Consulting Services Deposit" },
      fan: { email: "angry@example.com" }
    }
  });
  await deliver(fakeDb(), raw);
  assert.ok(seen, "payment.disputed never dispatched");
  assert.equal(seen.dueBy, "2026-08-20T00:00:00Z");
  assert.equal(seen.amount, 3000);
});

// --- failure handling in the sweep -----------------------------------------

test("one poison row does not stop the payments queued behind it", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  await handleCommasWebhook({ db, rawBody: LIVE_ENVELOPE, signatureHeader: sign(LIVE_ENVELOPE), secret: SECRET });
  await handleCommasWebhook({ db, rawBody: FLAT_TEST_EVENT, signatureHeader: sign(FLAT_TEST_EVENT), secret: SECRET });

  /* One batch, so each row is attempted exactly once and the counts describe
     that pass rather than its retries. The first row is permanently poisoned;
     the question is whether the second still gets processed. */
  const poisonedId = db.inbox[0].id;
  const swept = await drain(db, {
    maxBatches: 1,
    process: async (row, database) => {
      if (row.id === poisonedId) throw new Error("boom");
      return processCommasInboxRow(row, database);
    }
  });

  assert.equal(swept.counts.failed, 1);
  assert.equal(swept.counts.done, 1, "the good payment behind the bad one was not processed");
  assert.equal(db.inbox[0].status, "failed");
  assert.equal(db.inbox[0].last_error, "boom");
  assert.equal(db.inbox[1].status, "done");
});

// --- payment links: outbound checkout URL + inbound ref round-trip ---------

test("buildCommasCheckoutUrl: amount in dollars, ref and description on the query string", () => {
  const url = buildCommasCheckoutUrl({
    baseUrl: "https://pay.commas.io/c/onboarding",
    linkRef: "pl_abc123",
    amountCents: 250000,
    description: "Consulting Services Engagement"
  });
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://pay.commas.io/c/onboarding");
  assert.equal(parsed.searchParams.get("amount"), "2500.00");
  assert.equal(parsed.searchParams.get("ref"), "pl_abc123");
  assert.equal(parsed.searchParams.get("description"), "Consulting Services Engagement");
});

test("buildCommasCheckoutUrl: unsafe description is refused", () => {
  assert.throws(
    () => buildCommasCheckoutUrl({
      baseUrl: "https://pay.commas.io/c/onboarding",
      linkRef: "pl_abc123",
      amountCents: 100,
      description: "Funding deposit"
    }),
    (err) => err && err.code === "commas_unsafe_copy"
  );
});

test("buildCommasCheckoutUrl: description is optional, everything else is not", () => {
  const url = buildCommasCheckoutUrl({ baseUrl: "https://pay.commas.io/c/x", linkRef: "pl_1", amountCents: 100 });
  assert.equal(new URL(url).searchParams.has("description"), false);
  assert.throws(() => buildCommasCheckoutUrl({ linkRef: "pl_1", amountCents: 100 }), TypeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", amountCents: 100 }), TypeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", linkRef: "pl_1", amountCents: 0 }), RangeError);
  assert.throws(() => buildCommasCheckoutUrl({ baseUrl: "https://x", linkRef: "pl_1", amountCents: 19.5 }), RangeError);
});

test("normalizeCommasEvent: reads a client_reference_id back as ref", () => {
  const evt = normalizeCommasEvent({
    type: "payment.succeeded",
    id: "txn_1",
    data: { product: { title: "x" }, client_reference_id: "pl_abc123" }
  });
  assert.equal(evt.ref, "pl_abc123");
});

test("normalizeCommasEvent: ref falls back through metadata.link_ref / metadata.ref / reference / ref", () => {
  assert.equal(normalizeCommasEvent({ data: { metadata: { link_ref: "pl_a" } } }).ref, "pl_a");
  assert.equal(normalizeCommasEvent({ data: { metadata: { ref: "pl_b" } } }).ref, "pl_b");
  assert.equal(normalizeCommasEvent({ data: { reference: "pl_c" } }).ref, "pl_c");
  assert.equal(normalizeCommasEvent({ data: { ref: "pl_d" } }).ref, "pl_d");
  assert.equal(normalizeCommasEvent({ data: {} }).ref, null, "no ref anywhere must not invent one");
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHOSE PAYMENT IS THIS?  (events.client_id)

   Every payment event this adapter wrote used to carry a null client. The
   money landed and nothing in the system could say who paid it. The id was
   already on the checkout session — we mint every session with
   metadata { link_ref, client_id, org_id } — and it was being parsed straight
   past on the way back in.
   ═══════════════════════════════════════════════════════════════════════════ */

const CLIENT_A = "11111111-2222-3333-4444-555555555555";
const CLIENT_B = "99999999-8888-7777-6666-555555555555";

const clientIdsOf = (db) => db.store.map((e) => e.client_id);

test("normalizeCommasEvent: reads OUR client id back out of the checkout metadata", () => {
  assert.equal(
    normalizeCommasEvent({ data: { api_metadata: { data: { client_id: CLIENT_A } } } }).clientId,
    CLIENT_A,
    "the documented envelope's metadata bag was not read"
  );
  assert.equal(
    normalizeCommasEvent({ data: { metadata: { client_id: CLIENT_A } } }).clientId,
    CLIENT_A
  );
  assert.equal(normalizeCommasEvent({ data: {} }).clientId, null, "a client id must not be invented");
});

/* The guard that stops a payment being hung on whichever of our clients
   happens to collide with one of THEIR ids. */
test("normalizeCommasEvent: a client id that is not uuid-shaped is refused", () => {
  assert.equal(
    normalizeCommasEvent({ data: { metadata: { client_id: "user_4Kd9mQ2xZ7Lp" } } }).clientId,
    null,
    "a vendor customer id was accepted as one of ours"
  );
  assert.equal(normalizeCommasEvent({ data: { metadata: { client_id: 42 } } }).clientId, null);
  assert.equal(normalizeCommasEvent({ data: { metadata: { client_id: "" } } }).clientId, null);
});

const paidOnLink = ({ ref, title = "UnderwriteIQ soft-pull assessment", email = "payer@example.com", clientId = null }) =>
  JSON.stringify({
    id: "evt_pl_1",
    type: "payment.succeeded",
    data: {
      payment_id: "pay_pl_1",
      amount: 32,
      item: { id: "8YZPo", title },
      buyer: { email },
      api_metadata: { data: clientId ? { link_ref: ref, client_id: clientId } : { link_ref: ref } }
    }
  });

test("a payment on a link we minted is attributed to that link's client", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-1", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_known", purpose: "diagnostic" }]
  });
  await deliver(db, paidOnLink({ ref: "pl_known" }));

  assert.ok(db.store.length > 0, "nothing was emitted at all");
  assert.deepEqual(
    clientIdsOf(db),
    db.store.map(() => CLIENT_A),
    "a payment on our own link still landed with no client on it"
  );
});

/* link_ref is globally unique, so it arrives with no org scope of its own.
   Trusting it blind would post one tenant's money onto another tenant's
   client. */
test("a link belonging to ANOTHER org never attributes the payment", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-x", org_id: "org-OTHER", client_id: CLIENT_B, link_ref: "pl_other", purpose: "deposit" }]
  });
  await deliver(db, paidOnLink({ ref: "pl_other", email: "" }));

  assert.ok(db.store.length > 0);
  assert.ok(clientIdsOf(db).every((id) => id === null), "a payment was attributed across orgs");
  // and the other org's purpose must not have decided our product either
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received"]);
});

test("checkout metadata naming a client outside this org is ignored, not trusted", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({ clients: [{ id: CLIENT_B, org_id: "org-OTHER", email: "b@example.com", ghl_contact_id: "g" }] });
  await deliver(db, paidOnLink({ ref: null, clientId: CLIENT_B, email: "" }));

  assert.ok(db.store.length > 0);
  assert.ok(clientIdsOf(db).every((id) => id === null), "a cross-org metadata id was believed");
});

test("with no link, a payer we already know is found by email", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [{ id: CLIENT_A, org_id: "org-1", email: "known@example.com", ghl_contact_id: "g" }]
  });
  await deliver(db, paidOnLink({ ref: null, email: "KNOWN@example.com" }));

  assert.ok(db.store.length > 0);
  assert.ok(clientIdsOf(db).every((id) => id === CLIENT_A), "a known payer was left unattributed");
});

/* THE RULE THAT MATTERS MOST. An unattributable payment stays unattributed and
   legible. It is never hung on a guess. */
test("a payment with nothing to identify it keeps a NULL client, and still emits", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({
    id: "evt_anon",
    type: "payment.succeeded",
    data: { payment_id: "pay_anon", amount: 500, item: { title: "Mystery Box" } }
  });
  const { swept } = await deliver(db, raw);

  assert.equal(swept.counts.done, 1, "an unattributable payment was dropped rather than recorded");
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received"]);
  assert.ok(clientIdsOf(db).every((id) => id === null), "a client was invented out of nothing");
  assert.equal(db.clients.length, 0);
});

/* An expired or canceled checkout has NO handler on the bus, so nothing
   downstream would create this person. Creating them here would put a
   customer in the CRM who never paid. */
test("an abandoned checkout never conjures a client into the CRM", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const raw = JSON.stringify({
    type: "payment.expired",
    data: { payment_id: "pay_gone", item: { title: "Consulting Services Deposit" }, buyer: { email: "ghost@example.com" } }
  });
  await deliver(db, raw);

  assert.deepEqual(db.store.map((e) => e.name), ["payment.expired"]);
  assert.equal(db.clients.length, 0, "an abandoned checkout created a client row");
  assert.equal(db.store[0].client_id, null);
});

/* Money-in DOES reach a handler that find-or-creates by email
   (client-lifecycle onPaymentReceived → resolveClient), so resolving here
   changes WHEN that row appears, never WHETHER. */
test("a money-in event from a brand new payer resolves through the same resolver the handlers use", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  await deliver(db, paidOnLink({ ref: null, email: "brand.new@example.com" }));

  assert.equal(db.clients.length, 1, "the payer was not resolved at all");
  assert.equal(db.clients[0].email, "brand.new@example.com");
  assert.ok(clientIdsOf(db).every((id) => id === db.clients[0].id));
});

/* Rows replay. A second pass must add nothing — not a second event, and not a
   second client. */
test("re-running an inbox row emits nothing new and creates nothing new", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-1", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_replay", purpose: "deposit" }],
    clients: [{ id: CLIENT_A, org_id: "org-1", email: "payer@example.com", ghl_contact_id: "g" }]
  });
  await deliver(db, paidOnLink({ ref: "pl_replay" }));
  const afterFirst = db.store.length;
  const keysFirst = db.store.map((e) => e.idempotency_key);

  // the sweeper picking the same row up again
  await processCommasInboxRow(db.inbox[0], db);

  assert.equal(db.store.length, afterFirst, "a replayed row double-wrote its events");
  assert.deepEqual(db.store.map((e) => e.idempotency_key), keysFirst, "the idempotency key shape changed");
  assert.equal(db.clients.length, 1);
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS PAID FOR  (the purpose we set, not the title a vendor stored)

   productOf classified only by substring against four product titles Chris
   created in the Commas dashboard. Nothing this system mints is called any of
   them, so every real link fell through to "unmatched" and diagnostic.paid /
   deposit.paid / sale.closed never fired.
   ═══════════════════════════════════════════════════════════════════════════ */

test("productOf: the link's purpose decides the product, ahead of any title match", () => {
  // The title is an offer name. It matches none of the four legacy strings.
  assert.equal(productOf({ name: "UnderwriteIQ soft-pull assessment" }), "unmatched");
  assert.equal(productOf({ name: "UnderwriteIQ soft-pull assessment", purpose: "diagnostic" }), "crs");
  assert.equal(productOf({ name: "Funding, done-for-you", purpose: "deposit" }), "deposit");
  assert.equal(productOf({ name: "", purpose: "DIAGNOSTIC" }), "crs", "purpose must not be case sensitive");
});

/* Only two purposes have a canonical event that is not a guess. 'repair' has
   no bucket at all — the nearest one, 'diy', means the Consulting Services
   Package and would file a repair sale under the wrong product. 'custom' is
   free text. Both stay unmatched until somebody decides, and this test is here
   so that stays a decision rather than a drift. */
test("PURPOSE_PRODUCT maps ONLY the two purposes that have a canonical event", () => {
  assert.deepEqual(Object.keys(PURPOSE_PRODUCT).sort(), ["deposit", "diagnostic"]);
  assert.equal(productOf({ name: "Credit repair, done-for-you", purpose: "repair" }), "unmatched");
  assert.equal(productOf({ name: "Funding Mastery course (A to Z)", purpose: "custom" }), "unmatched");
});

/* A purpose this map says nothing about must fall THROUGH to the title, not
   short-circuit to unmatched — otherwise adding a purpose could silently take
   a legacy product's routing away from it. */
test("a purpose with no bucket falls through to the title rather than blocking it", () => {
  assert.equal(productOf({ name: "Consulting Services Package", purpose: "custom" }), "diy");
  assert.equal(productOf({ name: "Consulting Services Package", purpose: "" }), "diy");
});

/* Old rows replay through this same function. They must classify identically. */
test("the legacy dashboard titles still classify exactly as they did", () => {
  assert.equal(productOf({ name: "Business Financial Assessment" }), "crs");
  assert.equal(productOf({ name: "Consulting Services Deposit" }), "deposit");
  assert.equal(productOf({ name: "Consulting Success Fee" }), "success_fee");
  assert.equal(productOf({ name: "Consulting Services Package" }), "diy");
  assert.equal(productOf({ name: "Mystery Box" }), "unmatched");
});

test("a $32 link titled 'diagnostic' now fires diagnostic.paid end to end", async () => {
  _resetOrgCache(); clearHandlers();
  let softPullRan = 0;
  on("diagnostic.paid", () => { softPullRan += 1; });

  const db = fakeDb({
    links: [{ id: "pl-d", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_diag", purpose: "diagnostic" }]
  });
  // exactly what api/payment-links.mjs mints with no description: title === purpose
  await deliver(db, paidOnLink({ ref: "pl_diag", title: "diagnostic" }));

  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "diagnostic.paid"]);
  assert.equal(softPullRan, 1, "the soft-pull gate never fired for a real $32 link");
  assert.equal(db.store[0].payload.purpose, "diagnostic", "the evidence for the product was not carried");
  assert.equal(db.store[0].payload.product, "crs");
});

test("a deposit link fires deposit.paid whatever the closer typed in the description", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-f", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_dep", purpose: "deposit" }]
  });
  await deliver(db, paidOnLink({ ref: "pl_dep", title: "Funding, done-for-you" }));
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "deposit.paid"]);
});

test("a repair link records the money and claims nothing more", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-r", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_rep", purpose: "repair" }]
  });
  await deliver(db, paidOnLink({ ref: "pl_rep", title: "Credit repair, done-for-you" }));

  assert.deepEqual(db.store.map((e) => e.name), ["payment.received"]);
  assert.equal(db.store[0].payload.product, "unmatched");
  assert.equal(db.store[0].payload.purpose, "repair", "the purpose is still recorded, it just decides nothing");
  assert.equal(db.store[0].client_id, CLIENT_A, "an unmatched product must still know whose money it is");
});

/* A link minted through the checkout-session API comes back keyed by the
   session id — our ref may not be echoed at all. */
test("a link is still found by its Commas session id when no ref comes back", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [{ id: "pl-s", org_id: "org-1", client_id: CLIENT_A, link_ref: "pl_s", commas_session_id: "8YZPo", purpose: "deposit" }]
  });
  const raw = JSON.stringify({
    id: "evt_sess", type: "payment.succeeded",
    data: { payment_id: "pay_sess", amount: 3000, item: { id: "8YZPo", title: "Funding, done-for-you" } }
  });
  await deliver(db, raw);

  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "deposit.paid"]);
  assert.ok(clientIdsOf(db).every((id) => id === CLIENT_A));
});

test("two valid but contradictory Commas checkout IDs fail inbox processing without paid events", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    links: [
      { id: "pl-a", org_id: "org-1", client_id: CLIENT_A,
        link_ref: "dual-ref-a", commas_session_id: "dual-session-a", purpose: "deposit" },
      { id: "pl-b", org_id: "org-1", client_id: CLIENT_B,
        link_ref: "dual-ref-b", commas_session_id: "dual-session-b", purpose: "repair" }
    ]
  });
  const raw = JSON.stringify({
    id: "evt-dual-link-conflict", type: "payment.succeeded",
    data: {
      payment_id: "pay-dual-link-conflict", amount: 100,
      item: { id: "dual-session-b", title: "Consulting Services Deposit" },
      api_metadata: { data: { link_ref: "dual-ref-a" } }
    }
  });
  const { ack } = await deliver(db, raw);
  assert.equal(ack.ok, true, "keep the signed webhook durably stored");
  assert.equal(db.inbox.length, 1);
  assert.equal(db.inbox[0].status, "failed", "do not falsely complete the money-in inbox row");
  assert.match(db.inbox[0].last_error, /conflicting checkout reference and session identity/);
  assert.equal(db.store.length, 0, "never emit a paid sale or money event for either buyer");
});

/* A payment on a Commas dashboard product page has no link of ours. The
   lookup must come back empty and everything must carry on. */
test("no link behind the payment is normal, not an error", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb();
  const { swept } = await deliver(db, FLAT_TEST_EVENT);
  assert.equal(swept.counts.done, 1);
  assert.deepEqual(db.store.map((e) => e.name), ["payment.received", "diagnostic.paid"]);
  assert.equal(db.store[0].payload.purpose, null);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIMULATED-RECEIPT KEY (F26, 2026-09-03)

   COMMAS_WEBHOOK_SECRET is stored on Netlify with --secret, so it reads back as
   a mask and the walkthrough could never sign a receipt. SIM_WEBHOOK_SECRET is
   the readable second key. The guarantee these tests pin is the one that makes
   a second key safe at all:

     the sim key opens ONLY a body that says it is simulated.

   If that ever stops holding, the sim key becomes a way to post a payment that
   looks live, so every test below is load-bearing. */

const SIM_SECRET = "simwhsec_test";
const simSign = (raw) => crypto.createHmac("sha256", SIM_SECRET).update(raw).digest("hex");

const SIMULATED_RECEIPT = JSON.stringify({
  id: "sim-evt-1",
  type: "payment.succeeded",
  data: { payment_id: "sim-pay-1", amount: 5000, simulated: true }
});
const REAL_RECEIPT = JSON.stringify({
  id: "evt-1",
  type: "payment.succeeded",
  data: { payment_id: "pay-1", amount: 5000 }
});

test("sim key: a SIMULATED receipt signed with the sim key is accepted", () => {
  const out = verifyCommasWebhookAuth({
    rawBody: SIMULATED_RECEIPT,
    providedHeader: simSign(SIMULATED_RECEIPT),
    secret: SECRET,
    simSecret: SIM_SECRET
  });
  assert.deepEqual(out, { ok: true, mode: "simulated" });
});

/* The one that matters. A body with no `simulated` marker is real traffic as far
   as this endpoint can tell, and the sim key must not open it. */
test("sim key: a REAL receipt signed with the sim key is REFUSED", () => {
  const out = verifyCommasWebhookAuth({
    rawBody: REAL_RECEIPT,
    providedHeader: simSign(REAL_RECEIPT),
    secret: SECRET,
    simSecret: SIM_SECRET
  });
  assert.equal(out.ok, false);
});

test("sim key: the live key still opens everything, marker or not", () => {
  assert.deepEqual(
    verifyCommasWebhookAuth({
      rawBody: REAL_RECEIPT, providedHeader: sign(REAL_RECEIPT), secret: SECRET, simSecret: SIM_SECRET
    }),
    { ok: true, mode: "live" }
  );
  assert.deepEqual(
    verifyCommasWebhookAuth({
      rawBody: SIMULATED_RECEIPT, providedHeader: sign(SIMULATED_RECEIPT), secret: SECRET, simSecret: SIM_SECRET
    }),
    { ok: true, mode: "live" }
  );
});

/* No SIM_WEBHOOK_SECRET set is the state of every environment that has not opted
   in, and it must behave exactly like the single-key code that came before. */
test("sim key: absent simSecret refuses the sim signature outright", () => {
  const out = verifyCommasWebhookAuth({
    rawBody: SIMULATED_RECEIPT,
    providedHeader: simSign(SIMULATED_RECEIPT),
    secret: SECRET,
    simSecret: undefined
  });
  assert.equal(out.ok, false);
});

test("sim key: a wrong signature is refused even when the body claims simulated", () => {
  const out = verifyCommasWebhookAuth({
    rawBody: SIMULATED_RECEIPT,
    providedHeader: simSign(SIMULATED_RECEIPT + "x"),
    secret: SECRET,
    simSecret: SIM_SECRET
  });
  assert.equal(out.ok, false);
});

/* An unparseable body cannot be shown to carry the marker, so it cannot reach
   the sim key — even though handleCommasWebhook deliberately STORES unparseable
   bodies once they are authenticated. */
test("sim key: an unparseable body never reaches the sim key", () => {
  const junk = "{not json";
  const out = verifyCommasWebhookAuth({
    rawBody: junk, providedHeader: simSign(junk), secret: SECRET, simSecret: SIM_SECRET
  });
  assert.equal(out.ok, false);
});

test("isSimulatedReceipt reads both payload shapes", () => {
  assert.equal(isSimulatedReceipt({ data: { simulated: true } }), true);   // enveloped
  assert.equal(isSimulatedReceipt({ simulated: true }), true);             // flat
  assert.equal(isSimulatedReceipt({ data: { object: { simulated: true } } }), true);
  assert.equal(isSimulatedReceipt({ data: { simulated: "true" } }), false); // strict true only
  assert.equal(isSimulatedReceipt({}), false);
  assert.equal(isSimulatedReceipt(null), false);
});

/* End to end through the handler, which is what the live endpoint calls. */
test("handleCommasWebhook: sim key stores a simulated receipt and refuses a real one", async () => {
  _resetOrgCache(); clearHandlers();

  const okDb = fakeDb();
  const accepted = await handleCommasWebhook({
    db: okDb,
    rawBody: SIMULATED_RECEIPT,
    signatureHeader: simSign(SIMULATED_RECEIPT),
    secret: SECRET,
    simSecret: SIM_SECRET
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.queued, true);
  assert.equal(accepted.signedWith, "simulated");
  assert.equal(okDb.inbox.length, 1);

  const badDb = fakeDb();
  const refused = await handleCommasWebhook({
    db: badDb,
    rawBody: REAL_RECEIPT,
    signatureHeader: simSign(REAL_RECEIPT),
    secret: SECRET,
    simSecret: SIM_SECRET
  });
  assert.equal(refused.status, 401);
  assert.equal(refused.reason, "bad_signature");
  assert.equal(badDb.inbox.length, 0);
});

/* The mask guard. Netlify hands back asterisks for a --secret var; signing with
   that is what produced the 401 that read like a signature bug. */
test("looksMasked catches Netlify's redaction and passes a real key", () => {
  assert.equal(looksMasked("********************"), true);
  assert.equal(looksMasked("whs****"), true);
  assert.equal(looksMasked("whsec_9f2c1a7b4e"), false);
  assert.equal(looksMasked(""), false);
  assert.equal(looksMasked(undefined), false);
});


/* Refunds and disputes are POST-payment events, not lead capture. The provider
 * can report an email that is no longer known to our customer table. Keep
 * the signed receipt as an unattributed event for original-payment review
 * rather than minting a fake buyer or CRM contact. */
test("unknown refund and dispute webhook never creates a phantom client", async () => {
  for (const type of ["refund.created", "dispute.created"]) {
    _resetOrgCache(); clearHandlers();
    const db = fakeDb();
    const raw = JSON.stringify({
      id: "evt-reversal-" + type,
      type,
      data: {
        payment_id: "pay-reversal-" + type,
        amount: 72.35,
        buyer: { email: "unknown-reversal+new@example.invalid" },
        status: "success",
        due_by: "2026-11-01T00:00:00Z"
      }
    });
    const outcome = await deliver(db, raw);
    assert.equal(outcome.ack.ok, true, type);
    assert.equal(outcome.swept.counts.done, 1, type);
    assert.equal(db.clients.length, 0, type + " minted a customer");
    assert.equal(db.store.length, 1, type);
    assert.equal(db.store[0].client_id, null, type + " guessed the buyer");
    assert.equal(
      db.store[0].name,
      type === "refund.created" ? "payment.refunded" : "payment.disputed",
      type
    );
  }
});

test("refund with existing same-org customer remains attributable without contact mutations", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [{ id: CLIENT_A, org_id: "org-1", email: "known-reversal@example.com", ghl_contact_id: "crm-original" }],
    transactions: [{
      org_id: "org-1", client_id: CLIENT_A, provider: "commas",
      provider_ref: "known-refund-payment", status: "succeeded"
    }]
  });
  const raw = JSON.stringify({
    type: "refund.succeeded", id: "evt-known-refund",
    data: { payment_id: "known-refund-payment", buyer: { email: "known-reversal@example.com" }, amount: 12 }
  });
  await deliver(db, raw);
  assert.equal(db.clients.length, 1);
  assert.equal(db.clients[0].ghl_contact_id, "crm-original");
  assert.equal(db.store[0].client_id, CLIENT_A);
  assert.equal(db.store[0].name, "payment.refunded");
});


test("dispute event belongs to the original settled receipt, not another same-org callback buyer", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [
      { id: CLIENT_A, org_id: "org-1", email: "original+ar@example.invalid", ghl_contact_id: "crm-original" },
      { id: CLIENT_B, org_id: "org-1", email: "wrong+ar@example.invalid", ghl_contact_id: "crm-wrong" }
    ],
    transactions: [{
      org_id: "org-1", client_id: CLIENT_A, provider: "commas",
      provider_ref: "original-disputed-payment", status: "succeeded"
    }]
  });
  const raw = JSON.stringify({
    id: "ci-conflicted-dispute-1", type: "dispute.created",
    data: {
      payment_id: "original-disputed-payment", amount: 55,
      buyer: { email: "wrong+ar@example.invalid" },
      due_by: "2026-11-03T00:00:00Z"
    }
  });
  await deliver(db, raw);
  assert.equal(db.store.length, 1);
  assert.equal(db.store[0].name, "payment.disputed");
  assert.equal(db.store[0].client_id, CLIENT_A, "callback email cannot steal original money identity");
  assert.equal(db.clients.length, 2);
  assert.equal(db.clients[0].ghl_contact_id, "crm-original");
  assert.equal(db.clients[1].ghl_contact_id, "crm-wrong");
});

test("foreign-org receipt with matching provider reference cannot attribute a local refund", async () => {
  _resetOrgCache(); clearHandlers();
  const db = fakeDb({
    clients: [
      { id: CLIENT_A, org_id: "org-OTHER", email: "foreign+ar@example.invalid" },
      { id: CLIENT_B, org_id: "org-1", email: "local+ar@example.invalid" }
    ],
    transactions: [{
      org_id: "org-OTHER", client_id: CLIENT_A, provider: "commas",
      provider_ref: "same-id-other-tenant", status: "succeeded"
    }]
  });
  const raw = JSON.stringify({
    id: "ci-foreign-refund", type: "refund.succeeded",
    data: {
      payment_id: "same-id-other-tenant", amount: 40,
      buyer: { email: "local+ar@example.invalid" }
    }
  });
  await deliver(db, raw);
  assert.equal(db.store.length, 1);
  assert.equal(db.store[0].name, "payment.refunded");
  assert.equal(db.store[0].client_id, null, "different tenant's payment cannot credit local buyer");
  assert.equal(db.clients.length, 2);
});
