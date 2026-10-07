// The Plaid HTTP client, exercised with a stand-in response. NOTHING HERE
// REACHES THE NETWORK: every test either hands `fetchImpl` a function that
// returns a canned Response, or holds the adapters fence so no request is
// started at all.
//
// WHAT THIS FILE IS ACTUALLY FOR. The two calls it covers are the ones that make
// a bank connection real, and the failure modes that matter are not "does the
// happy path parse". They are: does a credential leak into a returned object or
// an error string; does a Plaid error envelope arriving with HTTP 200 get read
// as success; and does an unknown balance survive as null instead of becoming a
// zero somebody underwrites against.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import {
  PLAID_HOSTS, hostFor, plaidPost, exchangePublicToken, fetchAccounts, fetchBalances
} from "./plaid-http.mjs";

const CREDS = Object.freeze({
  environment: "sandbox",
  clientId: "client-id-value",
  secret: "secret-value",
  env: { ADAPTERS_DRY_RUN: "0" }
});

/** A stand-in fetch. Records what it was asked to send, answers what it is told. */
function stubFetch(status, body, { capture = {} } = {}) {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: new Map(),
      async json() { return body; },
      async text() { return JSON.stringify(body); }
    };
  };
}

describe("hosts", () => {
  test("one host per Plaid environment, and nothing else", () => {
    assert.deepEqual(Object.keys(PLAID_HOSTS).sort(), ["development", "production", "sandbox"]);
    assert.strictEqual(hostFor("sandbox"), "https://sandbox.plaid.com");
    assert.strictEqual(hostFor("Production"), null, "case matters — a near-miss is a misconfiguration");
    assert.strictEqual(hostFor("prod"), null);
    assert.strictEqual(hostFor(undefined), null);
  });

  test("an unknown environment refuses before anything is sent", async () => {
    let called = false;
    const r = await plaidPost("/accounts/get", {}, {
      ...CREDS, environment: "staging",
      fetchImpl: async () => { called = true; }
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.transmitted, false);
    assert.strictEqual(called, false, "nothing may be sent to an unknown host");
  });
});

describe("the fence", () => {
  test("ADAPTERS_DRY_RUN holds the call and nothing is transmitted", async () => {
    let called = false;
    const r = await plaidPost("/accounts/get", {}, {
      ...CREDS,
      env: { ADAPTERS_DRY_RUN: "1" },
      fetchImpl: async () => { called = true; }
    });
    assert.strictEqual(r.blocked, true);
    assert.strictEqual(r.transmitted, false);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(called, false, "a held call must not reach fetch");
  });
});

describe("credentials", () => {
  test("client_id and secret go in the body, which is how Plaid's API works", async () => {
    const capture = {};
    await plaidPost("/accounts/get", { access_token: "tok" }, {
      ...CREDS, fetchImpl: stubFetch(200, { accounts: [] }, { capture })
    });
    const sent = JSON.parse(capture.init.body);
    assert.strictEqual(sent.client_id, "client-id-value");
    assert.strictEqual(sent.secret, "secret-value");
    assert.strictEqual(sent.access_token, "tok");
    assert.strictEqual(capture.url, "https://sandbox.plaid.com/accounts/get");
  });

  test("no credential appears in the returned object, on success or on failure", async () => {
    const ok = await plaidPost("/accounts/get", { access_token: "access-sandbox-secret" }, {
      ...CREDS, fetchImpl: stubFetch(200, { accounts: [] })
    });
    const bad = await plaidPost("/accounts/get", { access_token: "access-sandbox-secret" }, {
      ...CREDS,
      fetchImpl: stubFetch(400, { error_code: "INVALID_ACCESS_TOKEN", error_type: "INVALID_INPUT", error_message: "bad token" })
    });
    for (const r of [ok, bad]) {
      const dumped = JSON.stringify(r);
      assert.ok(!dumped.includes("secret-value"), "PLAID_SECRET must never come back");
      assert.ok(!dumped.includes("client-id-value"), "PLAID_CLIENT_ID must never come back");
      assert.ok(!dumped.includes("access-sandbox-secret"), "the access token must never come back");
    }
  });
});

describe("Plaid's error envelope", () => {
  /* THE ONE THAT WOULD HAVE BITTEN. Plaid answers 200 with an error body for
     some failures. Branching on the status alone reads that as success. */
  test("an error body arriving with HTTP 200 is a failure, not a success", async () => {
    const r = await plaidPost("/accounts/get", {}, {
      ...CREDS,
      fetchImpl: stubFetch(200, {
        error_code: "ITEM_LOGIN_REQUIRED",
        error_type: "ITEM_ERROR",
        error_message: "the login details of this item have changed"
      })
    });
    assert.strictEqual(r.ok, false, "200 with an error_code is not ok");
    assert.strictEqual(r.errorCode, "ITEM_LOGIN_REQUIRED");
    assert.strictEqual(r.data, null);
    assert.strictEqual(r.retryable, false, "a changed login is not fixed by trying again");
  });

  test("rate limits and Plaid-side faults are marked retryable; a bad request is not", async () => {
    const rate = await plaidPost("/accounts/get", {}, {
      ...CREDS,
      fetchImpl: stubFetch(429, { error_code: "RATE_LIMIT", error_type: "RATE_LIMIT_EXCEEDED", error_message: "slow down" })
    });
    assert.strictEqual(rate.retryable, true);

    const bad = await plaidPost("/accounts/get", {}, {
      ...CREDS,
      fetchImpl: stubFetch(400, { error_code: "INVALID_FIELD", error_type: "INVALID_REQUEST", error_message: "nope" })
    });
    assert.strictEqual(bad.retryable, false);
  });

  test("a 500 with no envelope is still a failure, and retryable", async () => {
    const r = await plaidPost("/accounts/get", {}, { ...CREDS, fetchImpl: stubFetch(500, {}) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.retryable, true);
    assert.strictEqual(r.data, null);
  });
});

describe("exchangePublicToken", () => {
  test("returns the access token and item id, and drops the raw body", async () => {
    const r = await exchangePublicToken("public-sandbox-abc", {
      ...CREDS, fetchImpl: stubFetch(200, { access_token: "access-sandbox-xyz", item_id: "item-1" })
    });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accessToken, "access-sandbox-xyz");
    assert.strictEqual(r.itemId, "item-1");
    assert.strictEqual(r.data, null, "the raw body is dropped so a caller cannot spread a credential by accident");
  });

  test("a 200 missing either field is a failure, not a link with a blank token", async () => {
    for (const body of [{ access_token: "a" }, { item_id: "i" }, {}]) {
      const r = await exchangePublicToken("public-sandbox-abc", { ...CREDS, fetchImpl: stubFetch(200, body) });
      assert.strictEqual(r.ok, false, JSON.stringify(body));
    }
  });
});

describe("fetchAccounts", () => {
  const BODY = {
    accounts: [
      { account_id: "a1", name: "Everyday Checking", official_name: "Saguaro Everyday Checking",
        mask: "4419", type: "depository", subtype: "checking",
        balances: { current: 10787.16, available: 10500.00, limit: null, iso_currency_code: "USD" } },
      { account_id: "a2", name: "Platinum Card", official_name: null, mask: "2007",
        type: "credit", subtype: "credit card",
        balances: { current: 5200, available: null, limit: null, iso_currency_code: "USD" } }
    ],
    item: { item_id: "item-1" }
  };

  test("maps the fields the product stores", async () => {
    const r = await fetchAccounts("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, BODY) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.accounts.length, 2);
    assert.strictEqual(r.accounts[0].plaidAccountId, "a1");
    assert.strictEqual(r.accounts[0].mask, "4419");
    assert.strictEqual(r.accounts[0].currentBalance, 10787.16);
  });

  /* A charge card reports no limit. Defaulting that to 0 is the same defect the
     deliverables layer already carries a rule about: a total built from unknowns
     is unknown, and 0 is a number somebody underwrites against. */
  test("an unknown balance or limit stays null and never becomes zero", async () => {
    const r = await fetchAccounts("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, BODY) });
    const card = r.accounts.find((a) => a.plaidAccountId === "a2");
    assert.strictEqual(card.creditLimit, null);
    assert.strictEqual(card.availableBalance, null);
    assert.notStrictEqual(card.creditLimit, 0);
  });

  test("ownership is never inferred — the http layer reports no entity kind at all", async () => {
    const r = await fetchAccounts("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, BODY) });
    for (const a of r.accounts) {
      assert.ok(!("entityKind" in a), "a Plaid subtype is not evidence of personal or business ownership");
    }
  });

  test("an empty list from Plaid is an empty list — that one IS a fact", async () => {
    const r = await fetchAccounts("access-sandbox-xyz", {
      ...CREDS, fetchImpl: stubFetch(200, { accounts: [], item: {} })
    });
    assert.strictEqual(r.ok, true);
    assert.deepEqual(r.accounts, []);
  });

  test("a 200 with no accounts array is a failure, not an empty list", async () => {
    const r = await fetchAccounts("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, { item: {} }) });
    assert.strictEqual(r.ok, false, "a malformed answer must not read as 'this person has no accounts'");
    assert.strictEqual(r.data, null);
  });
});

/* /accounts/balance/get is the REAL-TIME read: billed per call and slow, so only
   src/banking/plaid-refresh.mjs reaches it, and only on PLAID_REALTIME_BALANCES=1. */
describe("fetchBalances", () => {
  const BODY = {
    accounts: [
      { account_id: "a1", name: "Everyday Checking", official_name: null, mask: "4419",
        type: "depository", subtype: "checking",
        balances: { current: 10787.16, available: 10500, limit: null, iso_currency_code: "USD" } },
      { account_id: "a2", name: "Platinum Card", official_name: null, mask: "2007",
        type: "credit", subtype: "credit card",
        balances: { current: 5200, available: null, limit: 20000, iso_currency_code: "USD" } }
    ],
    item: { item_id: "item-1" }
  };

  test("posts the access token to /accounts/balance/get and maps accounts exactly as fetchAccounts does", async () => {
    const capture = {};
    const bal = await fetchBalances("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, BODY, { capture }) });
    assert.strictEqual(capture.url, "https://sandbox.plaid.com/accounts/balance/get");
    const sent = JSON.parse(capture.init.body);
    assert.strictEqual(sent.access_token, "access-sandbox-xyz");
    assert.strictEqual(sent.options, undefined, "no options unless the caller gives a floor");

    const cached = await fetchAccounts("access-sandbox-xyz", { ...CREDS, fetchImpl: stubFetch(200, BODY) });
    assert.strictEqual(bal.ok, true);
    assert.deepEqual(bal.accounts, cached.accounts, "one body, one mapping — the two reads cannot drift apart");
    assert.strictEqual(bal.accounts[1].availableBalance, null, "an unknown balance stays null here too");
  });

  /* Plaid wants YYYY-MM-DDTHH:mm:ssZ. A JavaScript ISO string carries milliseconds. */
  test("a floor goes out as options.min_last_updated_datetime in whole seconds", async () => {
    const capture = {};
    await fetchBalances("t", {
      ...CREDS, minLastUpdatedDatetime: "2026-10-06T07:00:00.123Z", fetchImpl: stubFetch(200, BODY, { capture })
    });
    assert.deepEqual(JSON.parse(capture.init.body).options, { min_last_updated_datetime: "2026-10-06T07:00:00Z" });

    const none = {};
    await fetchBalances("t", { ...CREDS, minLastUpdatedDatetime: "not a date", fetchImpl: stubFetch(200, BODY, { capture: none }) });
    assert.strictEqual(JSON.parse(none.init.body).options, undefined, "an unreadable floor is dropped, not sent");
  });

  test("a Plaid error comes back as the flat failure, with its type so the caller can tell a broken login", async () => {
    const r = await fetchBalances("t", {
      ...CREDS,
      fetchImpl: stubFetch(400, { error_type: "ITEM_ERROR", error_code: "ITEM_LOGIN_REQUIRED", error_message: "log in again" })
    });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.errorType, "ITEM_ERROR");
    assert.strictEqual(r.errorCode, "ITEM_LOGIN_REQUIRED");
    assert.strictEqual(r.accounts, undefined);
  });

  test("a 200 with no accounts array is a failure, not an empty list", async () => {
    const r = await fetchBalances("t", { ...CREDS, fetchImpl: stubFetch(200, { item: {} }) });
    assert.strictEqual(r.ok, false);
    assert.match(r.error, /balance\/get/);
  });

  test("no credential appears in what comes back", async () => {
    const r = await fetchBalances("access-sandbox-secret", { ...CREDS, fetchImpl: stubFetch(200, BODY) });
    const dumped = JSON.stringify(r);
    for (const s of ["secret-value", "client-id-value", "access-sandbox-secret"]) {
      assert.ok(!dumped.includes(s), `${s} came back`);
    }
  });
});
