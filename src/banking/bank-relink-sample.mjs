// The sample answers of /api/banking/relink — one realistic client, run through the
// REAL handler, the REAL repair service and the REAL account refresh over fixed rows.
// NOT USED BY ANY PRODUCTION CODE.
//
// It exists so the screen's author reads exactly what the API returns
// (docs/finance/bank-relink.md shows these bodies) and so a test
// (src/http/bank-relink-doc.test.mjs) fails the day the doc and the API drift apart.
// The same idea as src/finance/file-alerts/sample-payload.mjs.
//
// ONE CLIENT, ONE STORY (CLAUDE.md "sample clients make sense"): the same person as the
// file-protection alerts sample — the FinanceOS test client, with Plaid's sandbox bank
// linked on Oct 6 and four accounts: Personal Checking 1101 ($4,210.55), Business
// Checking 2202 ($18,750.00), Business Amex 4404 ($5,400.00 of a $25,000 limit) and
// Personal Visa 3303 ($1,320.40 of $8,000). The daily read on Oct 10 was the last good
// one; on Oct 11 at 07:00 the bank asked for the login again and the refresh marked it.
// Today is Oct 12. The numbers in the finish sample are the same ones, because nothing
// moved while the login was broken: the answer is what Plaid returns for those accounts.

import { encryptPlaidToken } from "./plaid.mjs";
import { fakeBankDb, plaidAccount, stubPlaid } from "./plaid-fake-db.mjs";
import relink from "../../api/banking/relink.mjs";
import { startRelink, finishRelink, listBankLoginStatus } from "./plaid-relink.mjs";

export const SAMPLE_ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
export const SAMPLE_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
export const SAMPLE_ITEM = "3b2f6d1c-7a4e-4c95-9e08-5d1a8f3b6c27";
export const SAMPLE_NOW = "2026-10-12T12:00:00.000Z";

const BANK = "First Platypus Bank (Plaid sandbox — test data)";
const PLAID_ITEM_ID = "item-sandbox-sample-1";
const ACCESS_TOKEN = "access-sandbox-sample-token"; // exists only inside this file's in-memory world
/* A fixed key for the in-memory world only: it seals one made-up token for one fake row. */
const SAMPLE_ENV = Object.freeze({
  PLAID_CLIENT_ID: "sample", PLAID_SECRET: "sample", PLAID_ENV: "sandbox", ADAPTERS_DRY_RUN: "0",
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64")
});

const ACCOUNTS = [
  { id: "c5f61f5c-1111-4b1c-8c32-0a6c4a1f0b11", plaid: "p-1101", name: "Personal Checking", mask: "1101", kind: "personal", type: "depository", subtype: "checking", dollars: 4210.55 },
  { id: "d7a81c3e-2222-4c2d-9d43-1b7d5b2f1c22", plaid: "p-2202", name: "Business Checking", mask: "2202", kind: "business", type: "depository", subtype: "checking", dollars: 18750 },
  { id: "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e", plaid: "p-4404", name: "Business Amex", mask: "4404", kind: "business", type: "credit", subtype: "credit card", dollars: 5400, limit: 25000 },
  { id: "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17", plaid: "p-3303", name: "Personal Visa", mask: "3303", kind: "personal", type: "credit", subtype: "credit card", dollars: 1320.4, limit: 8000 }
];

const LOGIN_REQUIRED = { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "the login details of this item have changed" };
const LINK_TOKEN = {
  link_token: "link-sandbox-4f6c1d2e-8a35-4b7c-9d10-6e2b7a5c8f43", expiration: "2026-10-12T12:30:00Z", request_id: "sample"
};

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

/* The sample client's world: one login in the given state, four stored accounts, a
   stand-in Plaid. Fresh for every call, because the repair changes it. */
function world({ linkState = "error", plaid = { [ACCESS_TOKEN]: LOGIN_REQUIRED } } = {}) {
  const fake = fakeBankDb({
    now: () => new Date(SAMPLE_NOW),
    items: [{
      id: SAMPLE_ITEM, org_id: SAMPLE_ORG, client_id: SAMPLE_CLIENT, plaid_item_id: PLAID_ITEM_ID, institution_name: BANK,
      encrypted_access_token: encryptPlaidToken(ACCESS_TOKEN, { itemId: PLAID_ITEM_ID, env: SAMPLE_ENV }),
      consent_granted_at: "2026-10-06T22:57:00.000Z", created_at: "2026-10-06T22:57:00.000Z",
      link_state: linkState,
      last_error_code: linkState === "error" ? "ITEM_LOGIN_REQUIRED" : null,
      last_error_at: linkState === "error" ? "2026-10-11T07:00:02.000Z" : null,
      transactions_synced_at: "2026-10-10T07:00:05.000Z"
    }],
    accounts: ACCOUNTS.map((a) => ({
      id: a.id, org_id: SAMPLE_ORG, client_id: SAMPLE_CLIENT, plaid_item_id: SAMPLE_ITEM, plaid_account_id: a.plaid,
      name: a.name, mask: a.mask, account_type: a.type, account_subtype: a.subtype,
      current_balance_cents: Math.round(a.dollars * 100), available_balance_cents: a.type === "credit" ? Math.round(((a.limit ?? 0) - a.dollars) * 100) : Math.round(a.dollars * 100),
      credit_limit_cents: a.limit ? a.limit * 100 : null, entity_kind: a.kind, closed_at: null,
      created_at: "2026-10-06T22:57:00.000Z", updated_at: "2026-10-10T07:00:03.000Z", balance_as_of: "2026-10-10T07:00:03.000Z"
    }))
  });

  const accounts = stubPlaid(plaid);
  const fetchImpl = async (url, init) => {
    if (new URL(url).pathname === "/link/token/create") {
      return new Response(JSON.stringify(LINK_TOKEN), { status: 200, headers: { "content-type": "application/json" } });
    }
    return accounts.fetch(url, init);
  };
  const database = {
    query: (sql, params) => (/FROM clients/.test(sql)
      ? Promise.resolve({ rows: params[0] === SAMPLE_CLIENT && params[1] === SAMPLE_ORG ? [{ "?column?": 1 }] : [] })
      : fake.query(sql, params))
  };
  const deps = {
    db: database,
    env: SAMPLE_ENV,
    requireAuth: async () => { throw new Error("a client session must not go through the staff gate"); },
    resolvePrincipal: async () => ({ kind: "client", accountId: "sample-account", orgId: SAMPLE_ORG, clientId: SAMPLE_CLIENT }),
    now: () => new Date(SAMPLE_NOW),
    startRelink: (db, a) => startRelink(db, { ...a, fetchImpl }),
    finishRelink: (db, a) => finishRelink(db, { ...a, fetchImpl }),
    listBankLoginStatus
  };
  const call = async (method, { query = {}, body } = {}) => {
    const res = makeRes();
    await relink({ method, query, body }, res, deps);
    return { status: res.statusCode, body: res.body };
  };
  return { call, state: fake.state };
}

/** What Plaid answers for the four accounts once the client has signed in again. */
const HEALTHY = () => ({
  [ACCESS_TOKEN]: ACCOUNTS.map((a) => plaidAccount({
    id: a.plaid, name: a.name, mask: a.mask, type: a.type, subtype: a.subtype,
    current: a.dollars, available: a.type === "credit" ? (a.limit ?? 0) - a.dollars : a.dollars, limit: a.limit ?? null
  }))
});

/**
 * buildRelinkSamples() → { get, start, startRefused, finishOk, finishStillBroken }
 * each `{ status, body }`, exactly as the handler answers.
 */
export async function buildRelinkSamples() {
  const broken = world();
  const get = await broken.call("GET");
  const start = await broken.call("POST", { body: { action: "start", item_id: SAMPLE_ITEM } });
  const finishStillBroken = await broken.call("POST", { body: { action: "finish", item_id: SAMPLE_ITEM } });

  const fixed = world({ plaid: HEALTHY() });
  const finishOk = await fixed.call("POST", { body: { action: "finish", item_id: SAMPLE_ITEM } });

  const revoked = world({ linkState: "revoked" });
  const startRefused = await revoked.call("POST", { body: { action: "start", item_id: SAMPLE_ITEM } });

  return { get, start, startRefused, finishOk, finishStillBroken };
}

export default buildRelinkSamples;
