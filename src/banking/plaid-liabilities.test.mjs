// Plaid liabilities: the /liabilities/get parser, the Plaid → statement cycle
// mapping, and the per-client sync. Stubbed db and Plaid; no network.
import { test, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";

import { fetchLiabilities } from "./providers/plaid-http.mjs";
import { toCycleInput, syncClientLiabilities } from "./plaid-liabilities.mjs";
import { encryptPlaidToken } from "./plaid.mjs";

const ENV = {
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
};

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

/* Shaped like Plaid's documented sandbox answer for a credit card. */
const PLAID_CREDIT = {
  account_id: "plaid-acc-card",
  aprs: [
    { apr_percentage: 15.24, apr_type: "balance_transfer_apr", balance_subject_to_apr: 1562.32, interest_charge_amount: 130.22 },
    { apr_percentage: 27.95, apr_type: "purchase_apr", balance_subject_to_apr: 56.22, interest_charge_amount: 14.81 }
  ],
  is_overdue: false,
  last_payment_amount: 168.25,
  last_payment_date: "2019-05-22",
  last_statement_issue_date: "2019-05-28",
  last_statement_balance: 1708.77,
  minimum_payment_amount: 20,
  next_payment_due_date: "2020-05-28"
};

describe("fetchLiabilities (plaid-http)", () => {
  test("posts the access token to /liabilities/get and parses credit rows with Plaid's field names", async () => {
    let url, sent;
    const r = await fetchLiabilities("access-sandbox-x", {
      environment: "sandbox", clientId: "cid", secret: "sec", env: ENV,
      fetchImpl: async (u, init) => {
        url = u; sent = JSON.parse(init.body);
        return json({ accounts: [], item: { item_id: "i1" }, liabilities: { credit: [PLAID_CREDIT], mortgage: [], student: [] } });
      }
    });
    assert.equal(url, "https://sandbox.plaid.com/liabilities/get");
    assert.equal(sent.access_token, "access-sandbox-x");
    assert.equal(r.ok, true);
    assert.equal(r.credit.length, 1);
    const c = r.credit[0];
    assert.equal(c.account_id, "plaid-acc-card");
    assert.equal(c.next_payment_due_date, "2020-05-28");
    assert.equal(c.minimum_payment_amount, 20);
    assert.equal(c.last_statement_balance, 1708.77);
    assert.equal(c.is_overdue, false);
    assert.equal(c.aprs[1].apr_type, "purchase_apr");
    assert.equal(JSON.stringify(r).includes("access-sandbox-x"), false, "token never echoed");
  });

  test("credit: null is an empty list (no cards), not an error", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({ liabilities: { credit: null, mortgage: null, student: null } })
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.credit, []);
  });

  test("an Item without the product comes back ok:false with Plaid's error code", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({
        error_type: "ITEM_ERROR", error_code: "PRODUCTS_NOT_SUPPORTED",
        error_message: "the following products are not supported by this institution: [\"liabilities\"]"
      }, 400)
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "PRODUCTS_NOT_SUPPORTED");
  });

  test("nulls stay null — an unknown minimum is not $0", async () => {
    const r = await fetchLiabilities("t", {
      environment: "sandbox", clientId: "c", secret: "s", env: ENV,
      fetchImpl: async () => json({ liabilities: { credit: [{ account_id: "a", minimum_payment_amount: null, next_payment_due_date: null }] } })
    });
    assert.equal(r.credit[0].minimum_payment_amount, null);
    assert.equal(r.credit[0].next_payment_due_date, null);
  });
});

describe("toCycleInput", () => {
  test("dollars become cents, due date becomes due day, purchase APR becomes a fraction", () => {
    const row = toCycleInput(PLAID_CREDIT, { asOf: "2026-10-06T12:00:00.000Z" });
    assert.equal(row.payment_due_day, 28);
    assert.equal(row.statement_close_day, 28);
    assert.equal(row.last_statement_date, "2019-05-28");
    assert.equal(row.last_statement_balance_cents, 170877);
    assert.equal(row.minimum_payment_cents, 2000);
    assert.equal(row.apr, 0.2795);
    assert.equal(row.source, "provider");
    assert.equal(row.raw.next_payment_due_date, "2020-05-28");
    assert.equal(row.raw.last_payment_amount_cents, 16825);
    assert.equal(row.raw.last_payment_date, "2019-05-22");
    assert.equal(row.raw.is_overdue, false);
  });

  test("unknown figures stay null", () => {
    const row = toCycleInput({ account_id: "a", next_payment_due_date: "2026-10-21", minimum_payment_amount: null, aprs: [] });
    assert.equal(row.minimum_payment_cents, null);
    assert.equal(row.last_statement_balance_cents, null);
    assert.equal(row.apr, null);
    assert.equal(row.raw.last_payment_amount_cents, null);
  });

  test("no due date and no minimum → nothing to write", () => {
    assert.equal(toCycleInput({ account_id: "a", next_payment_due_date: null, minimum_payment_amount: null }), null);
  });

  test("a 0.5% APR stays 0.5%, not 50%", () => {
    const row = toCycleInput({ account_id: "a", next_payment_due_date: "2026-10-21", aprs: [{ apr_type: "purchase_apr", apr_percentage: 0.5 }] });
    assert.equal(row.apr, 0.005);
  });
});

describe("syncClientLiabilities", () => {
  const ORG = "org-1", CLIENT = "client-1";
  const ITEM_ROW = "item-row-1", PLAID_ITEM = "plaid-item-abc";

  function stubDb({ items, accounts }) {
    const writes = [];
    return {
      writes,
      async query(sql, params) {
        if (/FROM plaid_items/.test(sql)) return { rows: items };
        if (/SELECT id, plaid_account_id/.test(sql)) return { rows: accounts };
        if (/SELECT account_type FROM bank_accounts/.test(sql)) {
          const a = accounts.find((x) => x.id === params[0]);
          return { rows: a ? [{ account_type: a.account_type }] : [] };
        }
        if (/INSERT INTO account_statement_cycles/.test(sql)) {
          writes.push({ sql, params });
          return { rows: [{ id: "cycle-1" }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }
    };
  }

  test("refuses with names when Plaid is not configured", async () => {
    const r = await syncClientLiabilities({ query: () => assert.fail("no db") },
      { orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: {} });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_configured");
    assert.ok(r.missing.includes("PLAID_SECRET"));
  });

  test("decrypts with Plaid's item id, reads liabilities, writes the card's cycle", async () => {
    const enc = encryptPlaidToken("access-sandbox-real", { itemId: PLAID_ITEM, env: ENV });
    const db = stubDb({
      items: [{ id: ITEM_ROW, plaid_item_id: PLAID_ITEM, encrypted_access_token: enc }],
      accounts: [{ id: "ba-card", plaid_account_id: "plaid-acc-card", account_type: "credit", name: "Plaid Credit Card", mask: "3333" }]
    });
    let tokenSeen;
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00.000Z", env: ENV,
      fetchLiabilities: async (token, opts) => {
        tokenSeen = token;
        assert.equal(opts.environment, "sandbox");
        return { ok: true, credit: [PLAID_CREDIT, { ...PLAID_CREDIT, account_id: "not-stored" }] };
      }
    });
    assert.equal(tokenSeen, "access-sandbox-real");
    assert.equal(r.ok, true);
    assert.equal(r.written, 1);
    assert.equal(r.items[0].ok, true);
    assert.deepEqual(r.items[0].skipped, [{ plaidAccountId: "not-stored", reason: "account_not_stored" }]);
    assert.equal(db.writes.length, 1);
    const { sql, params } = db.writes[0];
    const cols = sql.match(/\(([^)]+)\)\s*VALUES/)[1].split(",").map((s) => s.trim());
    const v = Object.fromEntries(cols.map((c, i) => [c, params[i]]));
    assert.equal(v.org_id, ORG);
    assert.equal(v.bank_account_id, "ba-card");
    assert.equal(v.payment_due_day, 28);
    assert.equal(v.minimum_payment_cents, 2000);
    assert.equal(v.source, "provider");
    assert.equal(JSON.parse(v.raw).next_payment_due_date, "2020-05-28");
    assert.equal(JSON.stringify(r).includes("access-sandbox-real"), false, "token never in the result");
  });

  test("an Item Plaid refuses is recorded and the next Item still runs", async () => {
    const enc1 = encryptPlaidToken("tok-1", { itemId: "p1", env: ENV });
    const enc2 = encryptPlaidToken("tok-2", { itemId: "p2", env: ENV });
    const db = stubDb({
      items: [
        { id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc1 },
        { id: "row-2", plaid_item_id: "p2", encrypted_access_token: enc2 }
      ],
      accounts: [{ id: "ba-card", plaid_account_id: "plaid-acc-card", account_type: "credit" }]
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async (token) => (token === "tok-1"
        ? { ok: false, errorCode: "PRODUCTS_NOT_SUPPORTED", error: "not supported" }
        : { ok: true, credit: [PLAID_CREDIT] })
    });
    assert.equal(r.ok, true);
    assert.equal(r.items[0].ok, false);
    assert.equal(r.items[0].errorCode, "PRODUCTS_NOT_SUPPORTED");
    assert.equal(r.items[1].ok, true);
    assert.equal(r.written, 1);
  });

  test("a token bound to another item fails to decrypt and is recorded, not thrown", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "other-item", env: ENV });
    const db = stubDb({ items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }], accounts: [] });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => assert.fail("must not call Plaid")
    });
    assert.equal(r.items[0].errorCode, "token_decrypt_failed");
  });

  test("a non-credit account is skipped by the store's own refusal", async () => {
    const enc = encryptPlaidToken("tok", { itemId: "p1", env: ENV });
    const db = stubDb({
      items: [{ id: "row-1", plaid_item_id: "p1", encrypted_access_token: enc }],
      accounts: [{ id: "ba-chk", plaid_account_id: "plaid-acc-card", account_type: "depository" }]
    });
    const r = await syncClientLiabilities(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T00:00:00Z", env: ENV,
      fetchLiabilities: async () => ({ ok: true, credit: [PLAID_CREDIT] })
    });
    assert.equal(r.written, 0);
    assert.match(r.items[0].skipped[0].reason, /credit account/);
  });
});
