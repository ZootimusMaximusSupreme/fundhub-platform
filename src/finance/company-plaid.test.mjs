import { test } from "node:test";
import assert from "node:assert/strict";
import { companyCompleteLink, companyPlaidConfig, companyRefreshBalance,
  companySelectAccount } from "./company-plaid.mjs";
import { encryptPlaidToken } from "../banking/plaid.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const STAFF = "00000000-0000-4000-8000-000000000002";
const ACCOUNT = "00000000-0000-4000-8000-000000000003";
const env = { OWNER_PLAID_CLIENT_ID: "client", OWNER_PLAID_SECRET: "secret",
  OWNER_PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  OWNER_PLAID_ENV: "production" };

test("company Plaid is production read-only and refuses incomplete configuration", () => {
  assert.equal(companyPlaidConfig({}).ready, false);
  assert.equal(companyPlaidConfig(env).ready, true);
  assert.equal(companyPlaidConfig({ ...env, OWNER_PLAID_ENV: "sandbox" }).ready, false);
});

test("company link requires selected business account and explicit consent before storage", async () => {
  let exchanged = 0;
  const provider = {
    async exchangePublicToken() { exchanged++; return { ok: true, itemId: "item-1", accessToken: "access" }; },
    async fetchAccounts() { return { ok: true, accounts: [
      { plaidAccountId: "personal", type: "depository", holderCategory: "personal" },
      { plaidAccountId: "business", type: "depository", holderCategory: "business",
        mask: "1234", name: "Business Checking", isoCurrencyCode: "USD" }
    ] }; }
  };
  const db = { async query(sql, params) {
    if (/INSERT INTO company_plaid_items/.test(sql)) return { rows: [{ id: ACCOUNT }] };
    if (/INSERT INTO company_bank_accounts/.test(sql)) return { rows: [{ id: ACCOUNT }] };
    return { rows: [] };
  } };
  let out = await companyCompleteLink(db, { orgId: ORG, staffId: STAFF, publicToken: "public",
    accountId: "business", env, provider });
  assert.equal(out.reason, "business_account_confirmation_required");
  assert.equal(exchanged, 0);
  out = await companyCompleteLink(db, { orgId: ORG, staffId: STAFF, publicToken: "public",
    accountId: "personal", businessConfirmed: true, consentText: "read only", env, provider });
  assert.equal(out.reason, "business_depository_account_required");
  assert.equal(exchanged, 1);
});

test("switching selected bank requires explicit business confirmation", async () => {
  let writes = 0;
  const queries = [];
  const db = { async query(sql, params) {
    queries.push(sql);
    if (/SELECT id,name,mask/.test(sql)) return { rows: [{ id: ACCOUNT, name: "Business", mask: "1234" }] };
    if (/UPDATE company_bank_accounts/.test(sql)) writes++;
    return { rows: [] };
  } };
  const refused = await companySelectAccount(db, { orgId: ORG, staffId: STAFF,
    accountId: ACCOUNT, confirmed: false });
  assert.equal(refused.ok, false);
  assert.equal(writes, 0);
  const selected = await companySelectAccount(db, { orgId: ORG, staffId: STAFF,
    accountId: ACCOUNT, confirmed: true });
  assert.equal(selected.ok, true);
  assert.equal(writes, 2);
  assert.ok(queries.findIndex(sql => /SELECT id FROM orgs WHERE id=\$1 FOR UPDATE/.test(sql)) <
    queries.findIndex(sql => /SELECT id,name,mask/.test(sql)), "org row lock precedes account switch");
  assert.ok(queries.some(sql => /currency_code='USD'/.test(sql)));
});

test("cached account sync stores no fresh balance and rejects non-USD selection", async () => {
  let storedAccountSql = "";
  const db = { async query(sql) {
    if (/INSERT INTO company_plaid_items/.test(sql)) return { rows: [{ id: ACCOUNT }] };
    if (/INSERT INTO company_bank_accounts/.test(sql)) {
      storedAccountSql = sql;
      return { rows: [{ id: ACCOUNT }] };
    }
    return { rows: [] };
  } };
  const provider = {
    async exchangePublicToken() { return { ok: true, itemId: "item-1", accessToken: "access" }; },
    async fetchAccounts() { return { ok: true, accounts: [{ plaidAccountId: "eur", type: "depository",
      holderCategory: "business", isoCurrencyCode: "EUR" }] }; },
    async fetchBalances() { throw new Error("Link must not make a billed balance request"); }
  };
  const refused = await companyCompleteLink(db, { orgId: ORG, staffId: STAFF, publicToken: "public",
    accountId: "eur", businessConfirmed: true, consentText: "read only", env, provider });
  assert.equal(refused.reason, "business_depository_account_required");
  provider.fetchAccounts = async () => ({ ok: true, accounts: [{ plaidAccountId: "usd", type: "depository",
    holderCategory: "business", isoCurrencyCode: "USD", currentBalance: 9999 }] });
  const linked = await companyCompleteLink(db, { orgId: ORG, staffId: STAFF, publicToken: "public",
    accountId: "usd", businessConfirmed: true, consentText: "read only", env, provider });
  assert.equal(linked.ok, true);
  assert.doesNotMatch(storedAccountSql, /balance_as_of|current_balance_cents|available_balance_cents/);
});

test("real-time balance requires explicit server enablement and an owner action", async () => {
  const token = encryptPlaidToken("access", { itemId: "item-1",
    env: { PLAID_TOKEN_ENC_KEY: env.OWNER_PLAID_TOKEN_ENC_KEY } });
  const queries = [];
  const db = { async query(sql, params) {
    queries.push({ sql, params });
    if (/SELECT i.plaid_item_id/.test(sql)) return { rows: [{ plaid_item_id: "item-1",
      encrypted_access_token: token, account_id: ACCOUNT, plaid_account_id: "usd",
      account_type: "depository", holder_category: "business", currency_code: "USD" }] };
    if (/UPDATE company_bank_accounts/.test(sql)) return { rows: [{ id: ACCOUNT }] };
    return { rows: [] };
  } };
  let calls = 0;
  const provider = { async fetchBalances() { calls++; return { ok: true, accounts: [{
    plaidAccountId: "usd", type: "depository", holderCategory: "business", isoCurrencyCode: "USD",
    currentBalance: 1000.15, availableBalance: 900.15
  }] }; } };
  const disabled = await companyRefreshBalance(db, { orgId: ORG, itemId: ACCOUNT, env, provider });
  assert.equal(disabled.reason, "realtime_balance_not_enabled");
  assert.equal(calls, 0);
  const now = new Date("2026-11-12T17:00:00Z");
  const enabled = await companyRefreshBalance(db, { orgId: ORG, itemId: ACCOUNT,
    env: { ...env, OWNER_PLAID_REALTIME_BALANCE_ENABLED: "1" }, provider, now });
  assert.equal(enabled.ok, true);
  assert.equal(calls, 1);
  assert.ok(queries.some(query => /UPDATE company_bank_accounts/.test(query.sql) &&
    query.params[2] === 100015 && query.params[4] === now.toISOString()));
});
