// Practice test for the money.html "link-exchange (server)" row: trades the public token, stores the
// encrypted item, saves every account on it.
//
// The saved bank link cannot say how many accounts Plaid returned, so the live check can only ask for at
// least one. This test runs the REAL completeLink (src/banking/plaid-link.mjs) and the REAL account store
// with Plaid's address answered by a stand-in that returns THREE accounts, and holds:
//   * all three are saved, for this client, under this link;
//   * the stored token is sealed (four parts, bound to Plaid's item id, opens back to the access token)
//     and is never the plain access token;
//   * the consent stamp and scope are written, and the live SQL check reads the saved rows clean;
//   * Plaid refusing the exchange writes nothing; Plaid refusing the account read marks the link errored
//     with a code instead of leaving an active login with no accounts.
// Nothing leaves the process: fetch is replaced for the length of each test.

import assert from "node:assert/strict";
import test from "node:test";

import { decryptPlaidToken } from "../../../banking/plaid.mjs";
import { completeLink } from "../../../banking/plaid-link.mjs";
import { fakeBankDb, plaidAccount } from "../../../banking/plaid-fake-db.mjs";
import { ORG, contractSql, id } from "./fin-b07-case-runner.mjs";
import { makeStandIn } from "./fin-b07-sql-kit.mjs";

const CLIENT = id(1);
const ITEM_ROW = id(700);
const PLAID_ITEM = "item_sandbox_1";
const ACCESS = ["access", "sandbox", "1b2c3d4e"].join("-");
const AS_OF = "2026-10-14T12:00:00.000Z";

const env = () => ({
  PLAID_CLIENT_ID: ["test", "client"].join("-"),
  PLAID_SECRET: ["test", "secret"].join("-"),
  PLAID_TOKEN_ENC_KEY: Buffer.alloc(32, 9).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0",
});

const THREE = [
  plaidAccount({ id: "acc-chk", name: "Business Checking", mask: "2202", current: 20000.5, available: 19000 }),
  plaidAccount({ id: "acc-sav", name: "Reserve Savings", mask: "9981", type: "depository", subtype: "savings", current: 5000, available: 5000 }),
  plaidAccount({ id: "acc-cc", name: "Business Visa", mask: "3303", type: "credit", subtype: "credit card", current: 1233.3, available: null, limit: 8000 }),
];

/** Plaid's two web addresses this exchange talks to, answered here. `exchange` and `accounts` are status + body. */
async function withPlaid({ exchange = [200, { access_token: ACCESS, item_id: PLAID_ITEM, request_id: "r1" }], accounts = [200, { accounts: THREE, item: { item_id: PLAID_ITEM }, request_id: "r2" }] }, fn) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    requests.push({ path, body: JSON.parse(init.body || "{}") });
    const [status, body] = path === "/item/public_token/exchange" ? exchange : accounts;
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = original;
  }
}

/** The account store's stand-in plus the one statement completeLink adds: the login row. */
function bankDb() {
  const bank = fakeBankDb({ now: () => new Date(AS_OF) });
  const logins = [];
  return {
    bank,
    logins,
    async query(sql, params = []) {
      if (/INSERT INTO plaid_items/.test(sql)) {
        const [org, client, plaidItem, institutionId, institutionName, token, consentAt, scope] = params;
        const row = {
          id: ITEM_ROW, org_id: org, client_id: client, plaid_item_id: plaidItem, plaid_institution_id: institutionId,
          institution_name: institutionName, encrypted_access_token: token, link_state: "active",
          consent_granted_at: consentAt, consent_scope: JSON.parse(scope), created_at: AS_OF,
        };
        logins.push(row);
        bank.state.items.push(row);
        return { rows: [{ id: ITEM_ROW }], rowCount: 1 };
      }
      if (/UPDATE plaid_items\s+SET link_state = 'error'/.test(sql)) {
        // completeLink's own statement: ($1 link row id, $2 error code)
        const row = logins.find((l) => l.id === params[0]);
        if (row) {
          row.link_state = "error";
          row.last_error_code = params[1];
        }
        return { rows: [], rowCount: row ? 1 : 0 };
      }
      return bank.query(sql, params);
    },
  };
}

const finish = (db) => completeLink(db, {
  orgId: ORG, clientId: CLIENT, publicToken: "public-sandbox-abc", institution: { institution_id: "ins_1", name: "First Platypus Bank" },
  asOf: AS_OF, env: env(),
});

test("every account Plaid returns is saved for this client under this link, and the token is stored sealed", async () => {
  const db = bankDb();
  await withPlaid({}, async (requests) => {
    const out = await finish(db);
    assert.equal(out.ok, true);
    assert.equal(out.written, 3);
    assert.equal(out.accounts.length, 3);
    assert.deepEqual(requests.map((r) => r.path), ["/item/public_token/exchange", "/accounts/get"]);
  });

  const accounts = db.bank.state.accounts;
  assert.equal(accounts.length, 3, "all three accounts reach the store");
  assert.deepEqual(accounts.map((a) => a.name).sort(), ["Business Checking", "Business Visa", "Reserve Savings"]);
  for (const a of accounts) {
    assert.equal(a.client_id, CLIENT);
    assert.equal(a.org_id, ORG);
    assert.equal(a.plaid_item_id, ITEM_ROW, "each account hangs off this link's row");
  }

  const [login] = db.logins;
  const parts = login.encrypted_access_token.split(":");
  assert.equal(parts.length, 4, "key id, iv, tag, ciphertext");
  assert.ok(!login.encrypted_access_token.includes(ACCESS), "the access token is never stored in the clear");
  assert.equal(decryptPlaidToken(login.encrypted_access_token, { itemId: PLAID_ITEM, env: env() }), ACCESS, "bound to Plaid's item id, opens back to the token");
  assert.equal(login.consent_granted_at, AS_OF);
  assert.deepEqual(login.consent_scope, ["accounts"]);
  assert.equal(login.link_state, "active");
});

test("the saved link and its accounts read clean through the live SQL check, and a link that saved no accounts does not", async () => {
  const db = bankDb();
  await withPlaid({}, () => finish(db));

  const judge = (login, accounts) => {
    const standIn = makeStandIn(["plaid_items", "bank_accounts", "clients"]);
    try {
      standIn.insert("clients", { id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", is_demo: false });
      standIn.insert("plaid_items", { ...login, id: ITEM_ROW, created_at: "2026-10-13 12:00:00" });
      for (const a of accounts) {
        standIn.insert("bank_accounts", { id: a.id, org_id: a.org_id, client_id: a.client_id, plaid_item_id: a.plaid_item_id, provider: a.provider, created_at: "2026-10-13 12:00:00" });
      }
      return standIn.run(contractSql("fin-b07-link-exchange"), ORG);
    } finally {
      standIn.close();
    }
  };
  const [login] = db.logins;
  const saved = db.bank.state.accounts;
  assert.deepEqual(judge(login, saved), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(judge(login, []), { sample_count: 1, bad_count: 1 }, "an active login with no saved account is a wrong result");
  assert.deepEqual(judge({ ...login, encrypted_access_token: ACCESS }, saved), { sample_count: 1, bad_count: 1 }, "a plain token is a wrong result");
});

test("Plaid refusing the exchange saves no login and no account", async () => {
  const db = bankDb();
  await withPlaid({ exchange: [400, { error_code: "INVALID_PUBLIC_TOKEN", error_type: "INVALID_INPUT", error_message: "bad token" }] }, async (requests) => {
    const out = await finish(db);
    assert.equal(out.ok, false);
    assert.equal(requests.length, 1, "no account read follows a refused exchange");
  });
  assert.equal(db.logins.length, 0);
  assert.equal(db.bank.state.accounts.length, 0);
});

test("Plaid refusing the account read marks the saved link errored with a code, never an active login with nothing under it", async () => {
  const db = bankDb();
  await withPlaid({ accounts: [400, { error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "login needed" }] }, async () => {
    const out = await finish(db);
    assert.equal(out.ok, false);
  });
  assert.equal(db.logins.length, 1, "the link was stored before the account read");
  assert.equal(db.logins[0].link_state, "error");
  assert.equal(db.logins[0].last_error_code, "ITEM_LOGIN_REQUIRED");
  assert.equal(db.bank.state.accounts.length, 0);
});
