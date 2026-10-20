import { test } from "node:test";
import assert from "node:assert";
import {
  commasConfig,
  getPayment,
  reconcilePayment,
  createCheckoutSession,
  createEmbeddedCheckoutSession,
  checkoutConfig,
  checkoutEnvironmentName,
  parseCreatorHandle,
  withCheckoutIdentifiers,
  DEFAULT_API_BASE,
  API_KEY_ENV
} from "./commas-api.mjs";

/* A fetch stand-in, same seam src/messaging/providers/*.test.mjs uses. */
function fakeFetch(responses = []) {
  const calls = [];
  const queue = [...responses];
  const impl = async (url, opts) => {
    calls.push({ url, opts });
    const next = queue.shift();
    if (!next) throw new Error("no queued response");
    if (next.throws) throw new Error(next.throws);
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => next.body ?? ""
    };
  };
  impl.calls = calls;
  return impl;
}

// --- configuration fails closed --------------------------------------------

/* An unconfigured reconciliation path that quietly reports "nothing to
   reconcile" is worse than one that says it is switched off: the first reads
   as a clean bill of health on the money path. */
test("no API key => not configured, and it SAYS so", () => {
  const cfg = commasConfig({});
  assert.equal(cfg.ok, false);
  assert.match(cfg.reason, new RegExp(API_KEY_ENV));
  assert.match(cfg.reason, /no payment can be reconciled/);
});

test("a key gives a usable config with a trimmed base url", () => {
  assert.equal(commasConfig({ COMMAS_API_KEY: "k" }).base, DEFAULT_API_BASE);
  assert.equal(
    commasConfig({ COMMAS_API_KEY: "k", COMMAS_API_BASE: "https://x.test/api///" }).base,
    "https://x.test/api"
  );
});

test("getPayment refuses to call out when unconfigured", async () => {
  const fetchImpl = fakeFetch([]);
  const res = await getPayment(commasConfig({}), "pay_1", { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(fetchImpl.calls.length, 0, "an unconfigured client still made a network call");
});

// --- the request -----------------------------------------------------------

test("getPayment authenticates and encodes the id into the path", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: JSON.stringify({ payment_id: "pay 1" }) }]);
  const cfg = commasConfig({ COMMAS_API_KEY: "secret-key", COMMAS_API_BASE: "https://x.test" });
  const res = await getPayment(cfg, "pay 1", { fetchImpl });

  assert.equal(res.ok, true);
  assert.equal(fetchImpl.calls[0].url, "https://x.test/payments/pay%201");
  assert.equal(fetchImpl.calls[0].opts.headers.authorization, "Bearer secret-key");
  assert.equal(fetchImpl.calls[0].opts.method, "GET");
});

/* A scheduled pass runs against an API we do not control. One 500 from them
   must not take the pass down — the next pass is the retry. */
test("HTTP errors and transport failures come back as values, never throws", async () => {
  const cfg = commasConfig({ COMMAS_API_KEY: "k" });
  const server500 = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 500, body: "boom" }]) });
  assert.equal(server500.ok, false);
  assert.equal(server500.status, 500);

  const notFound = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 404, body: "" }]) });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404, "a 404 is a data problem and must stay distinguishable");

  const dead = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ throws: "ECONNREFUSED" }]) });
  assert.equal(dead.ok, false);
  assert.match(dead.reason, /unreachable/);

  const garbage = await getPayment(cfg, "p", { fetchImpl: fakeFetch([{ status: 200, body: "<html>" }]) });
  assert.equal(garbage.ok, false);
  assert.match(garbage.reason, /invalid_json/);
});

// --- reconciliation lands in the same inbox --------------------------------

function fakeDb() {
  const inbox = [];
  let i = 0;
  return {
    inbox,
    async query(sql, params) {
      if (/FROM orgs/.test(sql)) return { rows: [{ id: "org-1" }] };
      if (/INSERT INTO commas_inbox/.test(sql)) {
        const [orgId, dedupeKey, paymentId, eventType, rawBody, , source] = params;
        if (inbox.some((r) => r.dedupe_key === dedupeKey)) return { rows: [] };
        const row = { id: `inbox-${++i}`, org_id: orgId, dedupe_key: dedupeKey, payment_id: paymentId, event_type: eventType, raw_body: rawBody, source };
        inbox.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/^\s*SELECT id FROM commas_inbox/.test(sql)) {
        const hit = inbox.find((r) => r.dedupe_key === params[1]);
        return { rows: hit ? [{ id: hit.id }] : [] };
      }
      return { rows: [] };
    }
  };
}

test("a reconciled payment enters the SAME inbox, marked source=reconcile", async () => {
  const db = fakeDb();
  const payment = { payment_id: "pay_recon_1", amount: 3000, status: "succeeded" };
  const res = await reconcilePayment(db, {
    paymentId: "pay_recon_1",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 200, body: JSON.stringify(payment) }])
  });

  assert.equal(res.ok, true);
  assert.equal(res.enqueued, true);
  assert.equal(db.inbox.length, 1);
  assert.equal(db.inbox[0].source, "reconcile");
  assert.equal(db.inbox[0].payment_id, "pay_recon_1");
  /* GET /payments/:id returns a payment, not a webhook event, so the envelope
     is synthesised. The normaliser must see the shape it expects. */
  const stored = JSON.parse(db.inbox[0].raw_body);
  assert.equal(stored.type, "payment.succeeded");
  assert.deepEqual(stored.data, payment);
});

/* The property that makes reconciling always safe to run, including on a
   payment nobody is sure about — which is the entire point of having it. */
test("reconciling a payment whose webhook DID arrive changes nothing", async () => {
  const db = fakeDb();
  const opts = {
    paymentId: "pay_dup",
    env: { COMMAS_API_KEY: "k" }
  };
  const body = JSON.stringify({ payment_id: "pay_dup", status: "succeeded" });

  const first = await reconcilePayment(db, { ...opts, fetchImpl: fakeFetch([{ status: 200, body }]) });
  const second = await reconcilePayment(db, { ...opts, fetchImpl: fakeFetch([{ status: 200, body }]) });

  assert.equal(first.enqueued, true);
  assert.equal(second.enqueued, false);
  assert.equal(second.alreadyKnown, true);
  assert.equal(db.inbox.length, 1, "reconciling twice created a second copy of one payment");
});

test("the payload's own status wins over the assumed one", async () => {
  const db = fakeDb();
  await reconcilePayment(db, {
    paymentId: "pay_failed",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 200, body: JSON.stringify({ payment_id: "pay_failed", status: "failed" }) }])
  });
  assert.equal(JSON.parse(db.inbox[0].raw_body).type, "payment.failed");
});

test("an unreachable API enqueues NOTHING rather than a half-built row", async () => {
  const db = fakeDb();
  const res = await reconcilePayment(db, {
    paymentId: "pay_x",
    env: { COMMAS_API_KEY: "k" },
    fetchImpl: fakeFetch([{ status: 500, body: "" }])
  });
  assert.equal(res.ok, false);
  assert.equal(res.enqueued, false);
  assert.equal(db.inbox.length, 0);
});

test("with no API key, reconcile does nothing and reports why", async () => {
  const db = fakeDb();
  const res = await reconcilePayment(db, { paymentId: "pay_x", env: {} });
  assert.equal(res.ok, false);
  assert.equal(res.enqueued, false);
  assert.match(res.reason, new RegExp(API_KEY_ENV));
  assert.equal(db.inbox.length, 0);
});

/* ── the success URL carries the two ids the thank-you page needs ───────────
 *
 * public/app/payment-success.html is public and has no session. It was handed
 * a bare URL with nothing on it, so it could not tell whether the payment had
 * actually landed — its copy had to hedge with "if your payment went through".
 * The contract is exactly two query parameters, `ref` and `client_id`, and
 * this file and that page are the two halves of it. */

const CHECKOUT_ENV = { FANBASIS_CHECKOUT_API_KEY: "ck_test", FANBASIS_CHECKOUT_API_BASE: "https://x.test/api" };
const META = { link_ref: "pl_abc123", client_id: "11111111-2222-3333-4444-555555555555", org_id: "org-1" };

test("withCheckoutIdentifiers: appends ref and client_id, and nothing else", () => {
  const url = new URL(withCheckoutIdentifiers("https://fundhub.ai/app/payment-success.html", META));
  assert.equal(url.searchParams.get("ref"), "pl_abc123");
  assert.equal(url.searchParams.get("client_id"), "11111111-2222-3333-4444-555555555555");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "ref"], "something else reached the query string");
  assert.equal(url.origin + url.pathname, "https://fundhub.ai/app/payment-success.html");
});

test("withCheckoutIdentifiers: an existing query string survives, and nothing doubles up", () => {
  const once = withCheckoutIdentifiers("https://fundhub.ai/app/payment-success.html?utm=email", META);
  const twice = withCheckoutIdentifiers(once, META);
  const url = new URL(twice);
  assert.equal(url.searchParams.get("utm"), "email");
  assert.deepEqual(url.searchParams.getAll("ref"), ["pl_abc123"], "the ref was appended twice");
});

test("withCheckoutIdentifiers: nothing to add, or nothing to add it to, leaves the url alone", () => {
  const plain = "https://fundhub.ai/app/payment-success.html";
  assert.equal(withCheckoutIdentifiers(plain, null), plain);
  assert.equal(withCheckoutIdentifiers(plain, {}), plain);
  assert.equal(withCheckoutIdentifiers(plain, { org_id: "org-1" }), plain, "org_id must not travel on the url");
  // A payer landing on a plain thank-you page is cosmetic; landing nowhere is not.
  assert.equal(withCheckoutIdentifiers("not a url at all", META), "not a url at all");
});

test("withCheckoutIdentifiers: whichever id is known goes on, the other is simply absent", () => {
  const refOnly = new URL(withCheckoutIdentifiers("https://x.test/ok", { link_ref: "pl_1" }));
  assert.deepEqual([...refOnly.searchParams.keys()], ["ref"]);
  const clientOnly = new URL(withCheckoutIdentifiers("https://x.test/ok", { client_id: "c1" }));
  assert.deepEqual([...clientOnly.searchParams.keys()], ["client_id"]);
});

test("createCheckoutSession sends a success_url the thank-you page can act on", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: JSON.stringify({ data: { payment_link: "https://pay/x", id: "sess_1" } }) }]);
  const res = await createCheckoutSession({
    amountCents: 3200,
    productTitle: "Consulting Services Assessment",
    metadata: META,
    env: CHECKOUT_ENV,
    fetchImpl
  });
  assert.equal(res.ok, true);

  const sent = JSON.parse(fetchImpl.calls[0].opts.body);
  const url = new URL(sent.success_url);
  assert.equal(url.searchParams.get("ref"), "pl_abc123");
  assert.equal(url.searchParams.get("client_id"), "11111111-2222-3333-4444-555555555555");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["client_id", "ref"]);
  // and the metadata itself is untouched — the ids still round-trip on the webhook
  assert.equal(sent.metadata.link_ref, "pl_abc123");
  assert.equal(sent.metadata.client_id, "11111111-2222-3333-4444-555555555555");
});

test("createCheckoutSession decorates an explicitly supplied success url too", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: JSON.stringify({ data: { payment_link: "https://pay/x", id: "s" } }) }]);
  await createCheckoutSession({
    amountCents: 100,
    productTitle: "Consulting Services Package",
    metadata: { link_ref: "pl_z" },
    successUrl: "https://custom.test/thanks",
    env: CHECKOUT_ENV,
    fetchImpl
  });
  const sent = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(sent.success_url, "https://custom.test/thanks?ref=pl_z");
});

test("createCheckoutSession with no metadata still sends a plain success url", async () => {
  const fetchImpl = fakeFetch([{ status: 200, body: JSON.stringify({ data: { payment_link: "https://pay/x", id: "s" } }) }]);
  await createCheckoutSession({
    amountCents: 100,
    productTitle: "Consulting Services Package",
    env: CHECKOUT_ENV,
    fetchImpl
  });
  const sent = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.equal(sent.success_url, "https://fundhub.ai/app/payment-success.html");
});

test("createCheckoutSession bounds an invoice mint when a timeout is requested", async () => {
  let receivedSignal;
  const fetchImpl = async (_url, opts) => {
    receivedSignal = opts.signal;
    return new Promise((_resolve, reject) => {
      const failsafe = setTimeout(() => reject(new Error("fake fetch did not abort")), 1000);
      opts.signal.addEventListener("abort", () => {
        clearTimeout(failsafe);
        reject(opts.signal.reason);
      }, { once: true });
    });
  };
  const result = await createCheckoutSession({
    amountCents: 100,
    productTitle: "Consulting Services Package",
    timeoutMs: 10,
    env: CHECKOUT_ENV,
    fetchImpl
  });
  assert.ok(receivedSignal?.aborted);
  assert.equal(result.ok, false);
  assert.equal(result.status, 0);
  assert.match(result.reason, /^checkout_unreachable:/);
});

test("createCheckoutSession refuses unsafe product titles before calling fetch", async () => {
  const fetchImpl = fakeFetch([]);
  const res = await createCheckoutSession({
    amountCents: 100,
    productTitle: "Funding deposit",
    env: CHECKOUT_ENV,
    fetchImpl
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "commas_unsafe_copy");
  assert.equal(fetchImpl.calls.length, 0);
});

/* ── Embedded checkout: the card boxes on our own page ───────────────────── */

test("the working key name wins, and the broken one is still accepted alone", () => {
  /* Measured 2026-09-29: the value stored as FANBASIS_CHECKOUT_API_KEY answers
     401 on every route, CORTANA_COMMAS_API_KEY answers 200 for the same seller.
     Both names are read; the working one is preferred. Neither is ever removed. */
  const both = checkoutConfig({
    CORTANA_COMMAS_API_KEY: "good",
    FANBASIS_CHECKOUT_API_KEY: "stale"
  });
  assert.equal(both.ok, true);
  assert.equal(both.apiKey, "good");
  assert.equal(both.keyEnv, "CORTANA_COMMAS_API_KEY");

  const legacyOnly = checkoutConfig({ FANBASIS_CHECKOUT_API_KEY: "stale" });
  assert.equal(legacyOnly.ok, true);
  assert.equal(legacyOnly.apiKey, "stale");

  assert.equal(checkoutConfig({}).ok, false);
});

test("the seller handle is read off the minted link, not stored twice", () => {
  assert.equal(
    parseCreatorHandle("https://www.fanbasis.com/agency-checkout/fundhub-1/ol7zk"),
    "fundhub-1"
  );
  /* No handle to find => no embedded session is attempted. */
  assert.equal(parseCreatorHandle("https://pay.example.test/slo"), null);
  assert.equal(parseCreatorHandle(null), null);
});

test("the SDK gets the word 'sandbox', never the host's 'qa'", () => {
  assert.equal(checkoutEnvironmentName({ base: "https://www.fanbasis.com/public-api" }), "production");
  assert.equal(checkoutEnvironmentName({ base: "https://qa.dev-fan-basis.com/public-api" }), "sandbox");
});

test("createEmbeddedCheckoutSession returns the secret the card form is built from", async () => {
  const fetchImpl = fakeFetch([{
    status: 200,
    body: JSON.stringify({
      status: "success",
      data: { id: 3204, checkout_session_secret: "550e8400-e29b-41d4-a716-446655440000" }
    })
  }]);
  const res = await createEmbeddedCheckoutSession({
    creatorId: "fundhub-1",
    productId: "ol7zk",
    metadata: { link_ref: "slo_abc", client_id: null },
    env: CHECKOUT_ENV,
    fetchImpl
  });
  assert.equal(res.ok, true);
  assert.equal(res.sessionSecret, "550e8400-e29b-41d4-a716-446655440000");
  assert.equal(res.environment, "production");

  const call = fetchImpl.calls[0];
  assert.equal(call.url, "https://x.test/api/checkout-sessions/embedded");
  assert.equal(call.opts.headers["x-api-key"], "ck_test");
  const sent = JSON.parse(call.opts.body);
  assert.equal(sent.creator_id, "fundhub-1");
  assert.equal(sent.product_id, "ol7zk");
  assert.equal(sent.metadata.link_ref, "slo_abc");
  assert.ok(!("client_id" in sent.metadata), "null metadata is dropped, not sent as 'null'");
  /* Nothing card-shaped can be here — no vendor route accepts one. */
  assert.ok(!/card|cvv|cvc|pan|number/i.test(call.opts.body.replace(/checkout_session|creator_id|product_id/g, "")));
});

test("a refused or unreachable embedded mint is a value, never a throw", async () => {
  const bad = await createEmbeddedCheckoutSession({
    creatorId: "fundhub-1",
    productId: "ol7zk",
    env: CHECKOUT_ENV,
    fetchImpl: fakeFetch([{ status: 401, body: JSON.stringify({ message: "Invalid API key" }) }])
  });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "Invalid API key");

  const down = await createEmbeddedCheckoutSession({
    creatorId: "fundhub-1",
    productId: "ol7zk",
    env: CHECKOUT_ENV,
    fetchImpl: fakeFetch([{ throws: "socket hang up" }])
  });
  assert.equal(down.ok, false);
  assert.match(down.reason, /^embedded_unreachable/);

  const noKey = await createEmbeddedCheckoutSession({ creatorId: "a", productId: "b", env: {} });
  assert.equal(noKey.ok, false);
});

test("an embedded mint without a creator or a product never calls out", async () => {
  const fetchImpl = fakeFetch([]);
  assert.equal((await createEmbeddedCheckoutSession({ productId: "ol7zk", env: CHECKOUT_ENV, fetchImpl })).reason, "embedded_creator_required");
  assert.equal((await createEmbeddedCheckoutSession({ creatorId: "fundhub-1", env: CHECKOUT_ENV, fetchImpl })).reason, "embedded_product_required");
  assert.equal(fetchImpl.calls.length, 0);
});
