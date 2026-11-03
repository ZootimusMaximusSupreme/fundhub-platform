import { test } from "node:test";
import assert from "node:assert/strict";
import bankRoute from "../../api/owner/company-bank.mjs";
import cashRoute from "../../api/owner/company-cash.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const auth = (role = "owner", mfa = true) => async req => {
  req.session = { mfaVerifiedAt: mfa ? new Date() : null };
  return { id: STAFF, org_id: ORG, role };
};
const res = () => ({ statusCode: 200, body: null, jsonCalls: 0,
  status(code) { this.statusCode = code; return this; },
  json(value) { if (++this.jsonCalls !== 1) throw new Error("response written twice");
    this.body = value; return this; },
  setHeader() {} });
const noDb = { query() { throw new Error("unexpected database read"); } };

test("company bank and cash refuse staff roles before any data read", async () => {
  for (const role of ["admin", "closer", "sales_manager", "setter"]) {
    for (const route of [bankRoute, cashRoute]) {
      const response = res();
      await route({ method: "GET" }, response, { db: noDb, requireAuth: auth(role) });
      assert.equal(response.statusCode, 403);
      assert.equal(response.jsonCalls, 1);
    }
  }
});

test("owner GET uses only session org for bank and cash data", async () => {
  const bank = res();
  await bankRoute({ method: "GET", query: { org_id: OTHER } }, bank,
    { db: noDb, requireAuth: auth(), env: {}, read: async (db, args) => {
      assert.equal(args.orgId, ORG);
      return { items: [], accounts: [], transactions: [] };
    } });
  assert.equal(bank.statusCode, 200);
  assert.equal(bank.body.realtime_balance_available, false);
  const enabled = res();
  await bankRoute({ method: "GET" }, enabled, { db: noDb, requireAuth: auth(),
    env: { OWNER_PLAID_CLIENT_ID: "id", OWNER_PLAID_SECRET: "secret",
      OWNER_PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64"),
      OWNER_PLAID_ENV: "production", OWNER_PLAID_REALTIME_BALANCE_ENABLED: "1" },
    read: async () => ({ items: [], accounts: [], transactions: [] }) });
  assert.equal(enabled.body.realtime_balance_available, true);
  const cash = res();
  await cashRoute({ method: "GET", query: { org_id: OTHER } }, cash,
    { db: noDb, requireAuth: auth(), read: async (db, args) => {
      assert.equal(args.orgId, ORG);
      return { summary: { available_cents: null }, obligations: [] };
    } });
  assert.equal(cash.statusCode, 200);
});

test("bank Link, exchange, and selected-account writes require recent staff MFA", async () => {
  for (const action of ["link_token", "exchange", "select_account", "sync", "refresh_balance"]) {
    const response = res();
    await bankRoute({ method: "POST", body: { action, item_id: OTHER, account_id: OTHER,
      public_token: "public", consent: true, confirm_business_account: true } }, response,
    { db: noDb, requireAuth: auth("owner", false),
      linkToken: () => { throw new Error("provider called before MFA"); },
      completeLink: () => { throw new Error("provider called before MFA"); },
      selectAccount: () => { throw new Error("database changed before MFA"); },
      sync: () => { throw new Error("provider called before MFA"); },
      refreshBalance: () => { throw new Error("billed provider called before MFA"); } });
    assert.equal(response.statusCode, 403);
    assert.equal(response.body.error, "mfa_required");
  }
});

test("bank exchange pins owner identity and records consent; cash match pins org", async () => {
  const bank = res();
  await bankRoute({ method: "POST", body: { action: "exchange", org_id: OTHER,
    staff_id: OTHER, public_token: "public", account_id: "plaid-business",
    consent: true, confirm_business_account: true } }, bank,
  { db: noDb, requireAuth: auth(), env: {}, completeLink: async (database, args) => {
    assert.equal(args.orgId, ORG);
    assert.equal(args.staffId, STAFF);
    assert.equal(args.accountId, "plaid-business");
    assert.match(args.consentText, /read-only access/);
    return { ok: true, selectedAccount: { mask: "1234" } };
  } });
  assert.equal(bank.statusCode, 200);
  const cash = res();
  await cashRoute({ method: "POST", body: { action: "match_payment", org_id: OTHER,
    obligation_id: OTHER, transaction_id: OTHER } }, cash,
  { db: noDb, requireAuth: auth(), match: async (database, args) => {
    assert.equal(args.orgId, ORG); return { ok: true };
  } });
  assert.equal(cash.statusCode, 200);
});
