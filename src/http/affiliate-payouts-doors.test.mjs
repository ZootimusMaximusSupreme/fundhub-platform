// Who may call the three affiliate payout doors (492). No database.
import { test } from "node:test";
import assert from "node:assert/strict";
import payouts from "../../api/affiliates/payouts.mjs";
import payoutAccount from "../../api/affiliates/payout-account.mjs";
import readPayouts from "../../api/read/affiliate-payouts.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
function resMock() {
  return {
    statusCode: 200, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
    setHeader(k, v) { this.headers[k] = v; }
  };
}
const staffAs = (role) => async () => ({ id: "s1", org_id: ORG, role, name: "T" });
const noDb = { query: async () => { throw new Error("no database in this test"); } };

test("payouts: POST only", async () => {
  const res = resMock();
  await payouts({ method: "GET" }, res, { db: noDb });
  assert.equal(res.statusCode, 405);
});

test("payouts: a closer is not finance and is refused", async () => {
  const res = resMock();
  await payouts({ method: "POST", body: { action: "send", payout_id: ORG } }, res, { db: noDb, requireAuth: staffAs("closer") });
  assert.equal(res.statusCode, 403);
});

test("payouts: unknown action and bad ids are 400 before any read", async () => {
  let res = resMock();
  await payouts({ method: "POST", body: { action: "pay_everyone" } }, res, { db: noDb, requireAuth: staffAs("owner") });
  assert.equal(res.statusCode, 400);
  assert.ok(res.body.allowed.includes("mark_paid"));
  res = resMock();
  await payouts({ method: "POST", body: { action: "mark_paid", payout_id: "nope" } }, res, { db: noDb, requireAuth: staffAs("owner") });
  assert.equal(res.statusCode, 400);
});

test("payout-account: staff are refused — the affiliate's own Link is the consent", async () => {
  const res = resMock();
  await payoutAccount({ method: "POST", body: { action: "link_token" } }, res, {
    db: noDb,
    requirePrincipal: async (req, r, kinds) => { assert.deepEqual(kinds, ["affiliate", "client"]); r.status(403).json({ ok: false }); return null; }
  });
  assert.equal(res.statusCode, 403);
});

test("payout-account: a client who is not an affiliate is refused", async () => {
  const res = resMock();
  await payoutAccount({ method: "POST", body: { action: "link_token" } }, res, {
    db: noDb, requirePrincipal: async () => ({ kind: "client", orgId: ORG, affiliateId: null })
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "not_an_affiliate");
});

test("payout-account: the affiliate id comes from the session, never the body", async () => {
  const res = resMock();
  const mine = "00000000-0000-4000-8000-0000000000cc";
  let asked = null;
  await payoutAccount({ method: "POST", body: { action: "link_token", affiliate_id: "00000000-0000-4000-8000-0000000000dd" } }, res, {
    db: noDb,
    env: { PLAID_CLIENT_ID: "x", PLAID_SECRET: "y", PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64") },
    requirePrincipal: async () => ({ kind: "affiliate", orgId: ORG, affiliateId: mine }),
    plaidHttp: { createLinkToken: async ({ clientUserId, products }) => { asked = { clientUserId, products }; return { ok: true, linkToken: "link-sandbox-1" }; } }
  });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(asked.clientUserId, `affiliate:${mine}`);
  assert.deepEqual(asked.products, ["transfer"]);
});

test("read/affiliate-payouts: GET only, finance only", async () => {
  let res = resMock();
  await readPayouts({ method: "POST" }, res, { db: noDb });
  assert.equal(res.statusCode, 405);
  res = resMock();
  await readPayouts({ method: "GET", query: {} }, res, { db: noDb, requireAuth: staffAs("csm") });
  assert.equal(res.statusCode, 403);
});
