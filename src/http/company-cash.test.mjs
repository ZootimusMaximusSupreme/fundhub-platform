import { test } from "node:test";
import assert from "node:assert/strict";
import bankRoute from "../../api/owner/company-bank.mjs";
import cashRoute from "../../api/owner/company-cash.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const auth = (role = "owner", mfa = true) => async req => {
  req.session = { id: OTHER, mfaVerifiedAt: mfa ? new Date() : null };
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

test("owner bank actions use verified bank passkey assurance without changing normal login", async () => {
  for (const action of ["link_token", "exchange", "select_account", "sync", "refresh_balance"]) {
    const response = res();
    let called = 0;
    const complete = async (_database, args) => {
      called += 1;
      assert.equal(args.orgId, ORG);
      assert.equal(args.staffId, STAFF);
      return { ok: true };
    };
    const scoped = async (...args) => {
      called += 1;
      assert.equal((args[1] || args[0]).orgId, ORG);
      return { ok: true };
    };
    await bankRoute({ method: "POST", body: { action, item_id: OTHER, account_id: OTHER,
      public_token: "public", consent: true, confirm_business_account: true } }, response,
    { db: noDb, requireAuth: auth("owner", false), passkeyAssurance: async (_db, identity) => {
        assert.equal(identity.sessionId, OTHER); assert.equal(identity.targetId, ORG);
        return { verified_at: new Date() };
      },
      linkToken: scoped, completeLink: complete, selectAccount: complete,
      sync: scoped, refreshBalance: scoped });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(called, 1);
  }
});

test("bank writes still require owner role and explicit business consent", async () => {
  const denied = res();
  await bankRoute({ method: "POST", body: { action: "link_token" } }, denied,
    { db: noDb, requireAuth: auth("admin", false),
      linkToken: () => { throw new Error("non-owner reached bank provider"); } });
  assert.equal(denied.statusCode, 403);
  const noConsent = res();
  await bankRoute({ method: "POST", body: { action: "exchange", public_token: "public",
    account_id: "plaid-business", confirm_business_account: true } }, noConsent,
    { db: noDb, requireAuth: auth("owner", false), passkeyAssurance: async () => ({ verified_at: new Date() }),
      completeLink: () => { throw new Error("bank exchange ran without consent"); } });
  assert.equal(noConsent.statusCode, 400);
  assert.equal(noConsent.body.error, "business_account_and_consent_required");
});

test("bank exchange pins owner identity and records consent; cash match pins org", async () => {
  const bank = res();
  await bankRoute({ method: "POST", body: { action: "exchange", org_id: OTHER,
    staff_id: OTHER, public_token: "public", account_id: "plaid-business",
    consent: true, confirm_business_account: true } }, bank,
  { db: noDb, requireAuth: auth(), env: {}, passkeyAssurance: async () => ({ verified_at: new Date() }), completeLink: async (database, args) => {
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

test("owner matching-debit lookup pins org, pages by date and id, and rejects staff", async () => {
  const lookup = { method: "GET", query: { match_obligation_id: OTHER,
    before_posted_on: "2026-10-12", before_id: STAFF } };
  const denied = res();
  await bankRoute(lookup, denied, { db: noDb, requireAuth: auth("closer"),
    paymentMatches: () => { throw new Error("staff reached matching debits"); } });
  assert.equal(denied.statusCode, 403);
  const response = res();
  await bankRoute(lookup, response, { db: noDb, requireAuth: auth(),
    paymentMatches: async (_db, args) => {
      assert.deepEqual(args, { orgId: ORG, obligationId: OTHER,
        beforePostedOn: "2026-10-12", beforeId: STAFF });
      return { obligation_id: OTHER, transactions: [], has_more: false,
        next_before_posted_on: null, next_before_id: null };
    } });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.has_more, false);
  const invalid = res();
  await bankRoute({ method: "GET", query: { match_obligation_id: OTHER,
    before_posted_on: "2026-02-31", before_id: STAFF } }, invalid,
  { db: noDb, requireAuth: auth(), paymentMatches: () => {
    throw new Error("invalid date must not query database");
  } });
  assert.equal(invalid.statusCode, 400);
});

test("sync conflict is retryable 409 with no server error", async () => {
  const response = res();
  await bankRoute({ method: "POST", body: { action: "sync", item_id: OTHER } }, response,
  { db: noDb, requireAuth: auth(), sync: async () =>
    ({ ok: false, reason: "sync_conflict", retryable: true }) });
  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.body, { ok: false, reason: "sync_conflict", retryable: true });
});

test("owner bank token and exchange refuse missing assurance before calling Plaid", async () => {
  for (const action of ["link_token", "exchange"]) {
    const response = res(); let calls = 0;
    await bankRoute({ method: "POST", body: { action, public_token: "public", account_id: "bank",
      consent: true, confirm_business_account: true } }, response,
      { db: noDb, requireAuth: auth(), passkeyAssurance: async () => null,
        linkToken: async () => { calls++; }, completeLink: async () => { calls++; } });
    assert.equal(response.statusCode, 403); assert.equal(response.body.error, "passkey_required"); assert.equal(calls, 0);
  }
});
