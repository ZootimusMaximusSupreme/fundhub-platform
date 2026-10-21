import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketsFor, isSoftPull, fbclidFromFbc, sweepCortanaPaymentFeed, FEED_CRON, SOURCE_WORKFLOW } from "./cortana-payment-feed.mjs";

test("the soft pull is its own light step; the first real purchase is a new deal; every payment is LTV", () => {
  assert.equal(isSoftPull({ product: "crs" }), true);
  assert.equal(isSoftPull({ productCode: "diagnostic" }), true);
  assert.equal(isSoftPull({ productCode: "repair-bundle", product: "unmatched" }), false);
  assert.deepEqual(bucketsFor({ rawPayload: { product: "crs" }, earlierPurchase: false }), ["soft_pull", "all_payments"]);
  assert.deepEqual(bucketsFor({ rawPayload: { product: "crs" }, earlierPurchase: true }), ["soft_pull", "all_payments"]);
  assert.deepEqual(bucketsFor({ rawPayload: { productCode: "repair-bundle" }, earlierPurchase: false }), ["first_purchase", "all_payments"]);
  assert.deepEqual(bucketsFor({ rawPayload: { productCode: "repair-bundle" }, earlierPurchase: true }), ["all_payments"]);
  assert.equal(FEED_CRON, "*/5 * * * *");
  assert.equal(SOURCE_WORKFLOW, "cortana-payment-feed");
});

test("fbclid is read back out of a stored _fbc value", () => {
  assert.equal(fbclidFromFbc("fb.1.1700000000000.AbC-123"), "AbC-123");
  assert.equal(fbclidFromFbc(null), null);
  assert.equal(fbclidFromFbc("junk"), null);
});

/* A tiny stand-in for Postgres: enough of cortana_feed_sends to prove the claim
   is the dedupe, the order is right, and failures stay retryable. */
function fakeDb({ txns, earlier = {} }) {
  const sends = new Map();
  return {
    sends,
    async query(sql, params = []) {
      if (/FROM transactions t\s+JOIN clients/.test(sql) && /LIMIT \$3/.test(sql)) {
        return { rows: txns.filter((t) => {
          const all = sends.get(`${t.id}:all_payments`);
          const open = [...sends.entries()].some(([k, v]) => k.startsWith(`${t.id}:`) && ["sending", "failed"].includes(v.status));
          return !(all && ["sent", "skipped"].includes(all.status)) || open;
        }) };
      }
      if (/FROM transactions\s+WHERE org_id = \$1 AND client_id = \$2/.test(sql)) {
        return { rows: earlier[params[3]] || [] };
      }
      if (/INSERT INTO cortana_feed_sends/.test(sql)) {
        const key = `${params[1]}:${params[2]}`;
        const cur = sends.get(key);
        if (!cur) { sends.set(key, { id: key, status: "sending", attempts: 1 }); return { rows: [{ id: key }] }; }
        if (cur.status === "failed") { cur.status = "sending"; cur.attempts++; return { rows: [{ id: key }] }; }
        return { rows: [] };
      }
      if (/UPDATE cortana_feed_sends/.test(sql)) {
        const cur = sends.get(params[0]);
        cur.status = params[1];
        cur.error = params[2];
        return { rows: [] };
      }
      throw new Error(`unexpected sql: ${sql.slice(0, 60)}`);
    }
  };
}

const ON = { CORTANA_FEED_ENABLED: "1" };
const T = (id, extra = {}) => ({
  id, org_id: "o1", client_id: "c1", amount_paid: "32.00", provider: "commas", provider_ref: `p_${id}`,
  created_at: "2026-10-21T15:00:00Z", raw_payload: { product: "crs" }, first_name: "Pat", last_name: "Buyer",
  email: "pat@buyer.test", phone: "+15555550111", custom_fields: {}, utm_source: "fb", utm_medium: null,
  utm_campaign: "slo", utm_content: "43", ad_id: "43", ...extra
});

test("one paid soft pull lands in Soft Pull then LTV, exactly once across sweeps", async () => {
  const db = fakeDb({ txns: [T("t1")] });
  const sent = [];
  const send = async (ev) => { sent.push(ev.bucket); return { ok: true }; };
  const first = await sweepCortanaPaymentFeed(db, { send, env: ON });
  assert.deepEqual(sent, ["soft_pull", "all_payments"]);
  assert.equal(first.sent, 2);
  const again = await sweepCortanaPaymentFeed(db, { send, env: ON });
  assert.equal(again.scanned, 0);
  assert.deepEqual(sent, ["soft_pull", "all_payments"], "a second sweep sends nothing");
});

test("a first purchase after a soft pull is a new deal; a later payment is LTV only", async () => {
  const db = fakeDb({
    txns: [T("t2", { amount_paid: "1000.00", raw_payload: { productCode: "repair-bundle" } }),
           T("t3", { amount_paid: "2500.00", raw_payload: { product: "success_fee" } })],
    earlier: { t2: [{ raw_payload: { product: "crs" } }], t3: [{ raw_payload: { product: "crs" } }, { raw_payload: { productCode: "repair-bundle" } }] }
  });
  const sent = [];
  await sweepCortanaPaymentFeed(db, { send: async (ev) => { sent.push(`${ev.bucket}:${ev.amountCents}`); return { ok: true }; }, env: ON });
  assert.deepEqual(sent, ["first_purchase:100000", "all_payments:100000", "all_payments:250000"]);
});

test("company and test emails are skipped for good and never posted", async () => {
  const db = fakeDb({ txns: [T("t4", { email: "chris@fundhub.ai" })] });
  let posts = 0;
  const out = await sweepCortanaPaymentFeed(db, { send: async () => { posts++; return { ok: true }; }, env: ON });
  assert.equal(posts, 0);
  assert.equal(out.skipped, 2);
  assert.equal((await sweepCortanaPaymentFeed(db, { send: async () => { posts++; return { ok: true }; }, env: ON })).scanned, 0);
});

test("a refused send is marked failed, the run throws, and the next sweep retries it", async () => {
  const db = fakeDb({ txns: [T("t5")] });
  await assert.rejects(sweepCortanaPaymentFeed(db, { send: async () => ({ ok: false, error: "HTTP 500" }), env: ON }), /Cortana payment sends failed/);
  assert.equal(db.sends.get("t5:soft_pull").status, "failed");
  const sent = [];
  await sweepCortanaPaymentFeed(db, { send: async (ev) => { sent.push(ev.bucket); return { ok: true }; }, env: ON });
  assert.deepEqual(sent, ["soft_pull", "all_payments"]);
  assert.equal(db.sends.get("t5:soft_pull").attempts, 2);
});

test("with the switch off the clock reads nothing and sends nothing", async () => {
  const db = { query: async () => { throw new Error("must not read"); } };
  const out = await sweepCortanaPaymentFeed(db, { send: async () => { throw new Error("must not send"); }, env: {} });
  assert.equal(out.enabled, false);
});
