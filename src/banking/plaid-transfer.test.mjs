// Plaid Transfer — the wire calls (providers/plaid-http.mjs) and the provider
// that turns a leg into them (plaid-transfer.mjs). FinanceOS wave 5, unit W7.
//
// NOTHING HERE REACHES THE NETWORK. Every call gets a stand-in fetch that
// records what it was asked to send. What this file pins:
//   * the request bodies use Plaid's own field names, one for one
//     (https://plaid.com/docs/api/products/transfer/initiating-transfers/);
//   * money goes to Plaid as "20.00", made from integer cents with no floats;
//   * THE PRODUCTION HOST IS UNREACHABLE unless PLAID_ENV=production AND
//     FINANCE_OS_TRANSFERS_LIVE=1 — refused before a byte is sent;
//   * sandbox simulation never runs against anything but the sandbox host;
//   * a decrypted access token never comes back in a result.
import test, { describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import {
  authorizeTransfer, createTransfer, getTransfer, cancelTransfer, syncTransferEvents, getTransferLedger,
  sandboxSimulateTransfer, sandboxSimulateLedgerAvailable, transferHostRefusal
} from "./providers/plaid-http.mjs";
import {
  plaidTransferProvider, transfersNotEnabledProvider, centsToPlaidAmount, achClassFor, NOT_ENABLED
} from "./plaid-transfer.mjs";
import { encryptPlaidToken } from "./plaid.mjs";

const ENV = Object.freeze({ ADAPTERS_DRY_RUN: "0", PLAID_ENV: "sandbox" });
const CREDS = Object.freeze({ environment: "sandbox", clientId: "client-id-value", secret: "secret-value", env: ENV });

function stub(body, capture = {}, status = 200) {
  return async (url, init) => {
    capture.calls = (capture.calls || 0) + 1;
    capture.url = url;
    capture.body = JSON.parse(init.body);
    return { ok: status >= 200 && status < 300, status, headers: new Map(),
      async json() { return body; }, async text() { return JSON.stringify(body); } };
  };
}

describe("money to Plaid's decimal string", () => {
  test("integer cents in, two-digit decimal out, no float drift", () => {
    assert.equal(centsToPlaidAmount(2000), "20.00");
    assert.equal(centsToPlaidAmount(1999), "19.99");
    assert.equal(centsToPlaidAmount(5), "0.05");
    assert.equal(centsToPlaidAmount(2000000), "20000.00");
    assert.equal(centsToPlaidAmount(123456789), "1234567.89");
  });
  test("zero, negative, fractional or missing is refused, never sent as 0.00", () => {
    for (const v of [0, -100, 10.5, null, undefined, "2000", NaN]) assert.equal(centsToPlaidAmount(v), null, String(v));
  });
});

describe("ACH SEC codes (https://plaid.com/docs/transfer/creating-transfers/#ach-sec-codes)", () => {
  test("business → ccd; personal or unknown → web for a debit, ppd for a credit", () => {
    assert.equal(achClassFor({ entityKind: "business", type: "debit" }), "ccd");
    assert.equal(achClassFor({ entityKind: "business", type: "credit" }), "ccd");
    assert.equal(achClassFor({ entityKind: "personal", type: "debit" }), "web");
    assert.equal(achClassFor({ entityKind: "personal", type: "credit" }), "ppd");
    assert.equal(achClassFor({ entityKind: "unknown", type: "debit" }), "web");
  });
});

describe("the production host is gated at the wire", () => {
  test("sandbox is always allowed", () => {
    assert.equal(transferHostRefusal("sandbox", {}), null);
  });
  test("production needs BOTH PLAID_ENV=production and FINANCE_OS_TRANSFERS_LIVE=1", () => {
    assert.match(transferHostRefusal("production", {}), /FINANCE_OS_TRANSFERS_LIVE=1/);
    assert.match(transferHostRefusal("production", { PLAID_ENV: "production" }), /FINANCE_OS_TRANSFERS_LIVE=1/);
    assert.match(transferHostRefusal("production", { FINANCE_OS_TRANSFERS_LIVE: "1" }), /PLAID_ENV=production/);
    assert.match(transferHostRefusal("production", { PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "true" }), /LIVE=1/);
    assert.equal(transferHostRefusal("production", { PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" }), null);
  });
  test("development and anything else is refused", () => {
    assert.ok(transferHostRefusal("development", { PLAID_ENV: "development" }));
    assert.ok(transferHostRefusal("staging", {}));
  });

  test("every Transfer call refuses production without both switches — fetch is never called", async () => {
    const cap = {};
    const opts = { ...CREDS, environment: "production", env: { ADAPTERS_DRY_RUN: "0", PLAID_ENV: "production" }, fetchImpl: stub({}, cap) };
    const results = [
      await authorizeTransfer("tok", { accountId: "a", type: "debit", amount: "1.00", achClass: "web", legalName: "X", idempotencyKey: "k" }, opts),
      await createTransfer("tok", { accountId: "a", authorizationId: "z", description: "TRANSFER" }, opts),
      await getTransfer({ transferId: "t" }, opts),
      await cancelTransfer("t", opts),
      await syncTransferEvents({ afterId: 0 }, opts),
      await getTransferLedger(opts)
    ];
    for (const r of results) {
      assert.equal(r.ok, false);
      assert.equal(r.transmitted, false);
    }
    assert.equal(cap.calls || 0, 0, "nothing may reach production.plaid.com");
  });

  test("with both switches the production host is the one used", async () => {
    const cap = {};
    await getTransfer({ transferId: "t" }, {
      ...CREDS, environment: "production",
      env: { ADAPTERS_DRY_RUN: "0", PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" },
      fetchImpl: stub({ transfer: { id: "t", status: "pending" } }, cap)
    });
    assert.equal(cap.url, "https://production.plaid.com/transfer/get");
  });

  test("sandbox simulation refuses any host but sandbox", async () => {
    const cap = {};
    const live = { ...CREDS, environment: "production", env: { ADAPTERS_DRY_RUN: "0", PLAID_ENV: "production", FINANCE_OS_TRANSFERS_LIVE: "1" }, fetchImpl: stub({}, cap) };
    assert.equal((await sandboxSimulateTransfer("t", "posted", {}, live)).ok, false);
    assert.equal((await sandboxSimulateLedgerAvailable(live)).ok, false);
    assert.equal(cap.calls || 0, 0);
  });
});

describe("request bodies — Plaid's field names", () => {
  test("/transfer/authorization/create", async () => {
    const cap = {};
    const r = await authorizeTransfer("access-sandbox-1", {
      accountId: "acc-1", type: "debit", network: "ach", amount: "20.00", achClass: "web",
      legalName: "Test Test", idempotencyKey: "mt-abc-d", userPresent: false
    }, { ...CREDS, fetchImpl: stub({ authorization: { id: "auth-1", decision: "approved", decision_rationale: null, created: "2026-10-07T00:00:00Z" } }, cap) });
    assert.equal(cap.url, "https://sandbox.plaid.com/transfer/authorization/create");
    assert.deepEqual(cap.body, {
      access_token: "access-sandbox-1", account_id: "acc-1", type: "debit", network: "ach", amount: "20.00",
      ach_class: "web", user: { legal_name: "Test Test" }, idempotency_key: "mt-abc-d", user_present: false,
      client_id: "client-id-value", secret: "secret-value"
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.authorization, { id: "auth-1", decision: "approved", rationaleCode: null, rationaleDescription: null, created: "2026-10-07T00:00:00Z" });
  });

  test("an idempotency key over Plaid's 50 characters is refused before sending", async () => {
    const cap = {};
    const r = await authorizeTransfer("t", { accountId: "a", type: "debit", amount: "1.00", achClass: "web", legalName: "X", idempotencyKey: "k".repeat(51) },
      { ...CREDS, fetchImpl: stub({}, cap) });
    assert.equal(r.ok, false);
    assert.equal(cap.calls || 0, 0);
  });

  test("a declined authorization carries Plaid's rationale code", async () => {
    const r = await authorizeTransfer("t", { accountId: "a", type: "debit", amount: "1.00", achClass: "web", legalName: "X", idempotencyKey: "k" },
      { ...CREDS, fetchImpl: stub({ authorization: { id: "a2", decision: "declined", decision_rationale: { code: "NSF", description: "Insufficient funds" } } }) });
    assert.equal(r.authorization.decision, "declined");
    assert.equal(r.authorization.rationaleCode, "NSF");
  });

  test("/transfer/create uses authorization_id and a ≤10 character description", async () => {
    const cap = {};
    const r = await createTransfer("access-sandbox-1", {
      accountId: "acc-1", authorizationId: "auth-1", amount: "20.00", description: "TRANSFER",
      metadata: { fundhub_transfer_id: "t-1", leg: "debit" }
    }, { ...CREDS, fetchImpl: stub({ transfer: { id: "tr-1", authorization_id: "auth-1", status: "pending", cancellable: true, amount: "20.00", type: "debit", failure_reason: null } }, cap) });
    assert.equal(cap.url, "https://sandbox.plaid.com/transfer/create");
    assert.equal(cap.body.authorization_id, "auth-1");
    assert.equal(cap.body.description, "TRANSFER");
    assert.deepEqual(cap.body.metadata, { fundhub_transfer_id: "t-1", leg: "debit" });
    assert.equal(r.transfer.id, "tr-1");
    assert.equal(r.transfer.status, "pending");
    assert.equal(r.transfer.cancellable, true);
  });

  test("/transfer/event/sync parses events and the last id", async () => {
    const cap = {};
    const r = await syncTransferEvents({ afterId: 41 }, { ...CREDS, fetchImpl: stub({
      transfer_events: [
        { event_id: 42, event_type: "posted", transfer_id: "tr-1", timestamp: "2026-10-07T01:00:00Z", failure_reason: null },
        { event_id: 43, event_type: "returned", transfer_id: "tr-2", failure_reason: { ach_return_code: "R01", description: "Insufficient funds" } },
        { event_id: 44, event_type: "sweep.posted", transfer_id: "", sweep_id: "sw-1" }
      ],
      has_more: false
    }, cap) });
    assert.deepEqual(cap.body.after_id, 41);
    assert.equal(r.events.length, 3);
    assert.equal(r.lastId, 44);
    assert.equal(r.events[1].failureReason.achReturnCode, "R01");
    assert.equal(r.events[2].transferId, null, "a sweep event belongs to no transfer");
    assert.equal(r.hasMore, false);
  });

  test("a Plaid error envelope is a failure even on HTTP 200", async () => {
    const r = await getTransfer({ transferId: "t" }, { ...CREDS, fetchImpl: stub({ error_type: "INVALID_REQUEST", error_code: "TRANSFER_NOT_FOUND", error_message: "transfer not found" }) });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "TRANSFER_NOT_FOUND");
  });
});

describe("the provider", () => {
  const KEY = crypto.randomBytes(32).toString("base64");
  const env = { ...ENV, PLAID_CLIENT_ID: "cid", PLAID_SECRET: "sec", PLAID_TOKEN_ENC_KEY: KEY };
  const SECRET_TOKEN = "access-sandbox-the-real-secret-token";
  const account = (over = {}) => ({
    plaid_account_id: "acc-1", entity_kind: "personal",
    item: { plaid_item_id: "item-1", link_state: "active", consent_granted_at: "2026-10-01T00:00:00Z",
      encrypted_access_token: encryptPlaidToken(SECRET_TOKEN, { itemId: "item-1", env }) },
    ...over
  });

  test("decrypts the token for one call and never returns it", async () => {
    const cap = {};
    const p = plaidTransferProvider({ env, environment: "sandbox",
      fetchImpl: stub({ authorization: { id: "auth-9", decision: "approved", decision_rationale: null } }, cap) });
    const r = await p.authorizeLeg({ type: "debit", account: account(), amountCents: 2000, legalName: "Test Test", idempotencyKey: "mt-x-d" });
    assert.equal(cap.body.access_token, SECRET_TOKEN, "the plaintext goes to Plaid, nowhere else");
    assert.equal(cap.body.amount, "20.00");
    assert.equal(cap.body.ach_class, "web");
    assert.equal(r.ok, true);
    assert.equal(r.authorizationId, "auth-9");
    assert.ok(!JSON.stringify(r).includes(SECRET_TOKEN));
  });

  test("an account with no login, an inactive login, or a token for another item sends nothing", async () => {
    const cap = {};
    const p = plaidTransferProvider({ env, environment: "sandbox", fetchImpl: stub({}, cap) });
    const noItem = await p.authorizeLeg({ type: "debit", account: account({ item: null }), amountCents: 100, legalName: "X", idempotencyKey: "k" });
    const inactive = await p.authorizeLeg({ type: "debit", account: account({ item: { ...account().item, link_state: "error" } }), amountCents: 100, legalName: "X", idempotencyKey: "k" });
    const wrongItem = await p.authorizeLeg({ type: "debit", account: account({ item: { ...account().item, plaid_item_id: "item-2" } }), amountCents: 100, legalName: "X", idempotencyKey: "k" });
    assert.equal(noItem.reason, "no_bank_login");
    assert.equal(inactive.reason, "bank_login_not_active");
    assert.equal(wrongItem.reason, "token_unreadable");
    assert.equal(cap.calls || 0, 0);
  });

  test("a held fence says held, and a retryable Plaid error says so", async () => {
    const held = plaidTransferProvider({ env: { ...env, ADAPTERS_DRY_RUN: "1" }, environment: "sandbox", fetchImpl: stub({}) });
    const h = await held.getLeg("t");
    assert.equal(h.ok, false);
    assert.equal(h.reason, "held");
    const flaky = plaidTransferProvider({ env, environment: "sandbox", fetchImpl: stub({}, {}, 503) });
    const f = await flaky.getLeg("t");
    assert.equal(f.reason, "provider_error");
    assert.equal(f.retryable, true);
  });

  test("the not-enabled provider sends nothing and names its state", async () => {
    const p = transfersNotEnabledProvider("TRANSFER_PRODUCT_NOT_ENABLED");
    for (const m of ["authorizeLeg", "createLeg", "getLeg", "cancelLeg", "eventsPage", "ledger", "simulate", "ledgerAvailable"]) {
      const r = await p[m]({});
      assert.equal(r.ok, false);
      assert.equal(r.reason, NOT_ENABLED);
    }
  });
});
