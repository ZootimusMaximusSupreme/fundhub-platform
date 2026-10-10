// Plaid /transactions/sync → bank_transactions. Stubbed db and a stand-in
// fetch; NOTHING HERE REACHES THE NETWORK OR A DATABASE.
//
// The failure that matters most is the sign: Plaid says a positive amount is
// money OUT, and this repo says negative is money out. Get it backwards and
// rent reads as income with no error anywhere. So the first tests are about that.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { toTransactionRow, syncClientTransactions, DROP_REASONS } from "./plaid-transactions.mjs";
import { syncTransactions } from "./providers/plaid-http.mjs";
import { encryptPlaidToken } from "./plaid.mjs";

const ENV = Object.freeze({
  PLAID_CLIENT_ID: "cid",
  PLAID_SECRET: "sec",
  PLAID_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
  PLAID_ENV: "sandbox",
  ADAPTERS_DRY_RUN: "0"
});
const ORG = "00000000-0000-0000-0000-0000000000aa";
const CLIENT = "00000000-0000-0000-0000-0000000000cc";
const ITEM_ROW = "00000000-0000-0000-0000-0000000000ee";
const PLAID_ITEM = "item-sandbox-1";
const ACC_CHECKING = "00000000-0000-0000-0000-000000000001";
const ACCESS_TOKEN = "access-sandbox-secret-value";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" }
});

function tx(over = {}) {
  return {
    transaction_id: "t1", account_id: "plaid-acc-1", amount: 2500, date: "2026-09-01",
    authorized_date: "2026-08-31", name: "RENT PAYMENT", merchant_name: null, pending: false,
    personal_finance_category: { primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_RENT" },
    ...over
  };
}

describe("toTransactionRow — the sign flip", () => {
  test("a Plaid charge (positive) lands as a negative outflow in cents", () => {
    const { row } = toTransactionRow(tx({ amount: 2500 }), { bankAccountId: ACC_CHECKING });
    assert.equal(row.amount_cents, -250000);
    assert.equal(row.raw.amount, 2500, "raw keeps Plaid's own number");
  });

  test("a Plaid deposit (negative) lands as a positive inflow", () => {
    const { row } = toTransactionRow(tx({ amount: -5000.5, name: "PAYROLL" }), { bankAccountId: ACC_CHECKING });
    assert.equal(row.amount_cents, 500050);
  });

  test("dates: settled row uses date as posted_on and keeps authorised", () => {
    const { row } = toTransactionRow(tx(), { bankAccountId: ACC_CHECKING });
    assert.equal(row.posted_on, "2026-09-01");
    assert.equal(row.authorized_on, "2026-08-31");
    assert.equal(row.is_pending, false);
    assert.equal(row.category, "RENT_AND_UTILITIES_RENT");
    assert.equal(row.merchant_name, "RENT PAYMENT", "the bank descriptor, verbatim");
  });

  test("the bank's own name wins over Plaid's enriched merchant_name", () => {
    const { row } = toTransactionRow(tx({ name: "Oakwood Apartments Rent", merchant_name: "Oakwood Apartments" }),
      { bankAccountId: ACC_CHECKING });
    assert.equal(row.merchant_name, "Oakwood Apartments Rent");
    assert.equal(row.raw.merchant_name, "Oakwood Apartments", "enriched name kept in raw");
  });

  test("a pending row has no posted date and carries the day as authorised", () => {
    const { row } = toTransactionRow(tx({ pending: true, authorized_date: null }), { bankAccountId: ACC_CHECKING });
    assert.equal(row.posted_on, null);
    assert.equal(row.authorized_on, "2026-09-01");
    assert.equal(row.is_pending, true);
  });

  test("an authorised date after the posted date is dropped, not stored backwards", () => {
    const { row } = toTransactionRow(tx({ authorized_date: "2026-09-05" }), { bankAccountId: ACC_CHECKING });
    assert.equal(row.authorized_on, null);
  });

  test("rows 085 would refuse are dropped with a reason", () => {
    assert.equal(toTransactionRow(tx({ amount: 0 }), { bankAccountId: ACC_CHECKING }).dropped, DROP_REASONS.ZERO_AMOUNT);
    assert.equal(toTransactionRow(tx({ amount: null }), { bankAccountId: ACC_CHECKING }).dropped, DROP_REASONS.NO_AMOUNT);
    assert.equal(toTransactionRow(tx({ transaction_id: "" }), { bankAccountId: ACC_CHECKING }).dropped, DROP_REASONS.NO_ID);
    assert.equal(toTransactionRow(tx(), { bankAccountId: null }).dropped, DROP_REASONS.UNKNOWN_ACCOUNT);
    assert.equal(toTransactionRow(tx({ date: null }), { bankAccountId: ACC_CHECKING }).dropped, DROP_REASONS.NO_DATE);
  });
});

describe("syncTransactions — paging", () => {
  test("follows has_more, carries the cursor, returns the last next_cursor", async () => {
    const sent = [];
    const pages = [
      { added: [tx({ transaction_id: "a" })], modified: [], removed: [], next_cursor: "c1", has_more: true },
      { added: [tx({ transaction_id: "b" })], modified: [], removed: [{ transaction_id: "z", account_id: "plaid-acc-1" }], next_cursor: "c2", has_more: false, transactions_update_status: "HISTORICAL_UPDATE_COMPLETE" }
    ];
    const r = await syncTransactions(ACCESS_TOKEN, { cursor: "c0" }, {
      environment: "sandbox", clientId: "cid", secret: "sec", env: { ADAPTERS_DRY_RUN: "0" },
      fetchImpl: async (url, init) => { sent.push({ url, body: JSON.parse(init.body) }); return json(pages.shift()); }
    });
    assert.equal(r.ok, true);
    assert.equal(r.added.length, 2);
    assert.equal(r.removed.length, 1);
    assert.equal(r.nextCursor, "c2");
    assert.equal(r.updateStatus, "HISTORICAL_UPDATE_COMPLETE");
    assert.equal(sent[0].url, "https://sandbox.plaid.com/transactions/sync");
    assert.equal(sent[0].body.cursor, "c0");
    assert.equal(sent[1].body.cursor, "c1");
    assert.equal(JSON.stringify(r).includes(ACCESS_TOKEN), false, "no token in the result");
  });

  test("restarts the whole loop from the first cursor on a mutation error", async () => {
    const cursors = [];
    const answers = [
      { added: [tx({ transaction_id: "a" })], modified: [], removed: [], next_cursor: "c1", has_more: true },
      { error_code: "TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION", error_type: "TRANSACTIONS_ERROR", error_message: "x" },
      { added: [tx({ transaction_id: "a" }), tx({ transaction_id: "b" })], modified: [], removed: [], next_cursor: "c9", has_more: false }
    ];
    const r = await syncTransactions(ACCESS_TOKEN, {}, {
      environment: "sandbox", clientId: "cid", secret: "sec", env: { ADAPTERS_DRY_RUN: "0" },
      fetchImpl: async (_u, init) => { cursors.push(JSON.parse(init.body).cursor ?? null); const a = answers.shift(); return json(a, a.error_code ? 400 : 200); }
    });
    assert.equal(r.ok, true);
    assert.deepEqual(cursors, [null, "c1", null], "restart begins again with no cursor");
    assert.equal(r.added.length, 2, "rows from the abandoned loop are not kept");
  });

  test("a Plaid error comes back as a flat failure", async () => {
    const r = await syncTransactions(ACCESS_TOKEN, {}, {
      environment: "sandbox", clientId: "cid", secret: "sec", env: { ADAPTERS_DRY_RUN: "0" },
      fetchImpl: async () => json({ error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "login" }, 400)
    });
    assert.equal(r.ok, false);
    assert.equal(r.errorCode, "ITEM_LOGIN_REQUIRED");
  });
});

/* A fake database that answers by the shape of the SQL and records writes. */
function fakeDb({ cursorColumn = true, items = null } = {}) {
  const calls = { upserts: [], removed: [], itemUpdates: [], bills: 0, queries: [] };
  const stored = [];
  const itemRows = items ?? [{
    id: ITEM_ROW, plaid_item_id: PLAID_ITEM,
    encrypted_access_token: encryptPlaidToken(ACCESS_TOKEN, { itemId: PLAID_ITEM, env: ENV }),
    transactions_cursor: cursorColumn ? "cur-0" : null
  }];
  const db = {
    calls, stored,
    async query(sql, params = []) {
      calls.queries.push(sql);
      if (/FROM plaid_items/.test(sql) && /SELECT/.test(sql)) {
        if (!cursorColumn && /SELECT id, plaid_item_id, encrypted_access_token, transactions_cursor/.test(sql)) {
          const e = new Error('column "transactions_cursor" does not exist'); e.code = "42703"; throw e;
        }
        return { rows: itemRows };
      }
      if (/SELECT id, plaid_account_id FROM bank_accounts/.test(sql)) {
        return { rows: [{ id: ACC_CHECKING, plaid_account_id: "plaid-acc-1" }] };
      }
      if (/INSERT INTO bank_transactions/.test(sql)) {
        const rows = JSON.parse(params[2]);
        calls.upserts.push(...rows);
        for (const r of rows) stored.push({ id: crypto.randomUUID(), client_id: CLIENT, ...r });
        return { rowCount: rows.length, rows: [] };
      }
      if (/UPDATE bank_transactions/.test(sql)) {
        const rows = JSON.parse(params[3]);
        calls.removed.push(...rows);
        return { rowCount: rows.length, rows: [] };
      }
      if (/UPDATE plaid_items/.test(sql)) { calls.itemUpdates.push({ sql, params }); return { rowCount: 1, rows: [] }; }
      if (/SELECT id, entity_kind FROM bank_accounts/.test(sql)) {
        return { rows: [{ id: ACC_CHECKING, entity_kind: "personal" }] };
      }
      if (/FROM bank_transactions t/.test(sql)) return { rows: stored.filter((r) => !r.is_pending) };
      if (/INSERT INTO recurring_bills/.test(sql)) { calls.bills += 1; return { rows: [{ id: crypto.randomUUID() }] }; }
      return { rows: [], rowCount: 0 };
    }
  };
  return db;
}

/* Three months of rent: enough for the detector to call it a bill. */
const RENT = ["2026-07-01", "2026-08-01", "2026-09-01"].map((d, i) =>
  tx({ transaction_id: `rent-${i}`, date: d, authorized_date: d, amount: 2500, name: "Landlord Rent" }));
const PAY = tx({ transaction_id: "pay-1", amount: -5000, name: "ACME PAYROLL", date: "2026-09-15", authorized_date: null });

describe("syncClientTransactions", () => {
  test("not configured → refuses with names, sends nothing", async () => {
    const r = await syncClientTransactions(fakeDb(), {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: {},
      fetchImpl: () => assert.fail("must not transmit")
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "not_configured");
    assert.ok(r.missing.includes("PLAID_SECRET"));
  });

  test("writes negated rows, marks removed, saves cursor, runs detection", async () => {
    const db = fakeDb();
    let sentCursor;
    const r = await syncClientTransactions(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: ENV,
      fetchImpl: async (_u, init) => {
        const b = JSON.parse(init.body);
        sentCursor = b.cursor;
        assert.equal(b.access_token, ACCESS_TOKEN, "decrypted with the Plaid item id as AAD");
        return json({
          added: [...RENT, PAY, tx({ transaction_id: "zero", amount: 0 }), tx({ transaction_id: "other", account_id: "not-saved" })],
          modified: [], removed: [{ transaction_id: "old-pending", account_id: "plaid-acc-1" }],
          next_cursor: "cur-1", has_more: false
        });
      }
    });
    assert.equal(r.ok, true);
    assert.equal(sentCursor, "cur-0", "carries on from the stored cursor");
    assert.equal(r.items[0].written, 4);
    assert.deepEqual(r.items[0].dropped, { zero_amount: 1, account_not_saved: 1 });
    assert.equal(r.items[0].markedRemoved, 1);
    assert.equal(r.items[0].cursorSaved, true);

    const rent = db.calls.upserts.find((x) => x.provider_transaction_id === "rent-0");
    assert.equal(rent.amount_cents, -250000, "rent is money out");
    const pay = db.calls.upserts.find((x) => x.provider_transaction_id === "pay-1");
    assert.equal(pay.amount_cents, 500000, "payroll is money in");

    const cursorUpdate = db.calls.itemUpdates.find((u) => /transactions_cursor/.test(u.sql));
    assert.equal(cursorUpdate.params[1], "cur-1");

    assert.equal(r.bills.ran, true);
    assert.equal(r.bills.bills, 1, "three monthly rent charges are one bill");
    assert.ok(db.calls.bills >= 1);
    assert.equal(JSON.stringify(r).includes(ACCESS_TOKEN), false, "no token in the result");
  });

  test("without migration 431 it still syncs from the start and saves no cursor", async () => {
    const db = fakeDb({ cursorColumn: false });
    let sentCursor = "unset";
    const r = await syncClientTransactions(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: ENV,
      fetchImpl: async (_u, init) => {
        sentCursor = JSON.parse(init.body).cursor;
        return json({ added: RENT, modified: [], removed: [], next_cursor: "cur-1", has_more: false });
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.cursorColumn, false);
    assert.equal(sentCursor, undefined, "no cursor → full history");
    assert.equal(r.items[0].cursorSaved, false);
    assert.equal(db.calls.itemUpdates.length, 0);
  });

  test("a login-required error marks the item, writes no rows, skips detection", async () => {
    const db = fakeDb();
    const r = await syncClientTransactions(db, {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: ENV,
      fetchImpl: async () => json({ error_code: "ITEM_LOGIN_REQUIRED", error_type: "ITEM_ERROR", error_message: "log in" }, 400)
    });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "upstream_error");
    assert.equal(r.items[0].errorCode, "ITEM_LOGIN_REQUIRED");
    assert.equal(db.calls.upserts.length, 0);
    assert.equal(r.bills, null);
    const u = db.calls.itemUpdates[0];
    assert.equal(u.params[1], "ITEM_LOGIN_REQUIRED");
    assert.equal(u.params[2], true, "ITEM_ERROR flips link_state to error");
  });

  test("no linked bank is an answer, not an error", async () => {
    const r = await syncClientTransactions(fakeDb({ items: [] }), {
      orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: ENV,
      fetchImpl: () => assert.fail("must not transmit")
    });
    assert.equal(r.ok, true);
    assert.equal(r.ran, false);
    assert.equal(r.reason, "no_linked_bank");
  });

  test("the item read only takes active, consented items with a token", async () => {
    const db = fakeDb({ items: [] });
    await syncClientTransactions(db, { orgId: ORG, clientId: CLIENT, asOf: "2026-10-06T12:00:00Z", env: ENV });
    const sql = db.calls.queries.find((q) => /FROM plaid_items/.test(q));
    assert.match(sql, /consent_granted_at IS NOT NULL/);
    assert.match(sql, /link_state = 'active'/);
    assert.match(sql, /encrypted_access_token IS NOT NULL/);
  });
});
