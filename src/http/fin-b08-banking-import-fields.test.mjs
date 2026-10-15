// finish-853 batch 08, repair cycle 1: POST /api/banking/accounts action=import, what every saved row
// SAYS. The first test file counted the rows. This one reads each saved row back, column by column,
// against what the provider answered, and against the company and the client of the call:
//   - every row of every table (bank link, account, statement cycle, holding, transaction) is saved
//     under the signed-in company and under this client, even when the body names another company;
//   - a transaction keeps the provider's amount and sign, its date, its merchant and its pending flag;
//   - an account keeps its current balance and its available balance in their own columns;
//   - a statement cycle and a holding keep the provider's own figures;
//   - a mask is cut to its last four digits and a provider cannot write a full number.
// The mock provider only answers four-digit masks and settled transactions, so the second half of the
// file puts a doctored answer under the real provider seam (a load hook rewrites one line of
// src/banking/provider.mjs so a test may hand getAccounts a different answer). The handler, the import
// library and every statement under them are the real ones. Practice test, fake data, no network, no
// database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { bindProblem } from "../testing/s3-scoped-rows.mjs";

const PROVIDER_URL = new URL("../banking/provider.mjs", import.meta.url).href;
const SEAM = "return IMPLEMENTATIONS[sel.name].getAccounts({ itemId, env });";
let seamSeen = false;
registerHooks({
  load(url, context, nextLoad) {
    const out = nextLoad(url, context);
    if (url !== PROVIDER_URL) return out;
    const text = String(out.source);
    if (!text.includes(SEAM)) throw new Error("the provider seam line moved: this test must be re-pointed");
    seamSeen = true;
    return {
      ...out,
      source: text.replace(
        SEAM,
        `{ const real = () => IMPLEMENTATIONS[sel.name].getAccounts({ itemId, env });
           return globalThis.__finB08Provider ? globalThis.__finB08Provider({ itemId, env }, real) : real(); }`,
      ),
    };
  },
});

const { default: handler } = await import("../../api/banking/accounts.mjs");
const { getAccounts } = await import("../banking/provider.mjs");

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const saved = process.env.BANKING_PROVIDER;
before(() => { delete process.env.BANKING_PROVIDER; });
after(() => {
  delete globalThis.__finB08Provider;
  if (saved === undefined) delete process.env.BANKING_PROVIDER; else process.env.BANKING_PROVIDER = saved;
});
beforeEach(() => { delete process.env.BANKING_PROVIDER; delete globalThis.__finB08Provider; });

/** Stand-in tables. Every INSERT is read column by column from its own statement text. */
function bankFile() {
  const t = { clients: [{ id: CLIENT, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }], plaid_items: [], bank_accounts: [], cycles: [], holdings: [], transactions: [] };
  let seq = 0;
  const id = (p) => `${p}${String(++seq).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const rowOf = (sql, params) => {
    const names = /\(([^)]+)\)\s*VALUES/i.exec(sql)[1].split(",").map((c) => c.trim());
    const values = /VALUES\s*\(([\s\S]*?)\)\s*(?:ON\s+CONFLICT|RETURNING|$)/i.exec(sql)[1].split(",").map((c) => c.trim());
    return Object.fromEntries(names.map((c, i) => {
      const v = values[i];
      const m = /^\$(\d+)$/.exec(v);
      return [c, m ? params[Number(m[1]) - 1] : /^'(.*)'$/.exec(v) ? /^'(.*)'$/.exec(v)[1] : v];
    }));
  };
  const fake = fakeDb([
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (_s, p) => t.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map(() => ({ "?column?": 1 }))],
    [/^\s*SELECT id FROM plaid_items\s+WHERE org_id = \$1 AND client_id = \$2 AND plaid_item_id = \$3/i, (_s, p) => t.plaid_items.filter((r) => r.org_id === p[0] && r.client_id === p[1] && r.plaid_item_id === p[2]).map((r) => ({ id: r.id }))],
    [/^\s*INSERT INTO plaid_items/i, (s, p) => {
      const r = { id: id("a1"), ...rowOf(s, p) };
      t.plaid_items.push(r);
      return [{ id: r.id }];
    }],
    [/^\s*INSERT INTO bank_accounts/i, (s, p) => {
      const row = rowOf(s, p);
      const existing = t.bank_accounts.find((r) => r.plaid_item_id === row.plaid_item_id && r.plaid_account_id === row.plaid_account_id);
      if (existing) { Object.assign(existing, row); return [{ id: existing.id }]; }
      const r = { id: id("b1"), ...row };
      t.bank_accounts.push(r);
      return [{ id: r.id }];
    }],
    [/^\s*INSERT INTO account_statement_cycles/i, (s, p) => {
      const r = rowOf(s, p);
      const at = t.cycles.findIndex((c) => c.bank_account_id === r.bank_account_id);
      if (at >= 0) t.cycles[at] = r; else t.cycles.push(r);
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*DELETE FROM investment_holdings WHERE bank_account_id = \$1/i, (_s, p) => { t.holdings = t.holdings.filter((h) => h.bank_account_id !== p[0]); return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO investment_holdings/i, (s, p) => { t.holdings.push(rowOf(s, p)); return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO bank_transactions/i, (s, p) => {
      const r = rowOf(s, p);
      const at = t.transactions.findIndex((x) => x.bank_account_id === r.bank_account_id && x.provider_transaction_id === r.provider_transaction_id);
      if (at >= 0) t.transactions[at] = r; else t.transactions.push(r);
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => { fake.connected += 1; return { query: fake.query, release() { fake.released += 1; } }; };
  fake.t = t;
  return fake;
}

async function call(body, fake) {
  const session = fakeDb([staffSession({ role: "owner" })]);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res));
  return res;
}

const last4 = (mask) => String(mask).replace(/\D/g, "").slice(-4);
const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));

describe("POST /api/banking/accounts action=import: what each saved row says", () => {
  test("the provider seam hook is in place (the second half of this file depends on it)", () => {
    assert.equal(seamSeen, true);
  });

  test("every row of every table lands under the signed-in company and this client, even when the body names another company", async () => {
    const fake = bankFile();
    const res = await call({ client_id: CLIENT, action: "import", org_id: OTHER_ORG_ID, client: FOREIGN_CLIENT }, fake);
    assert.equal(res.statusCode, 200);
    const everyRow = [
      ["plaid_items", fake.t.plaid_items], ["bank_accounts", fake.t.bank_accounts], ["account_statement_cycles", fake.t.cycles],
      ["investment_holdings", fake.t.holdings], ["bank_transactions", fake.t.transactions],
    ];
    for (const [table, rows] of everyRow) {
      assert.ok(rows.length > 0, `${table} has rows to judge`);
      for (const r of rows) {
        assert.equal(r.org_id, ORG_ID, `${table}: saved under the company on the sign-in`);
        assert.equal(r.client_id, CLIENT, `${table}: saved on the client of the call`);
      }
    }
    // The bank link row says where its rows came from.
    assert.equal(fake.t.plaid_items[0].plaid_item_id, `mock:${CLIENT}`);
    // Child rows hang off their own account: the cycle and holdings belong to a card and the brokerage.
    const accountIds = new Set(fake.t.bank_accounts.map((a) => a.id));
    for (const r of [...fake.t.cycles, ...fake.t.holdings, ...fake.t.transactions]) assert.ok(accountIds.has(r.bank_account_id));
  });

  test("a transaction keeps the provider's amount and sign, date, merchant and pending flag; an account keeps its two balances in their own columns", async () => {
    const fake = bankFile();
    const res = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.equal(res.statusCode, 200);
    const expected = await getAccounts({ itemId: fake.t.plaid_items[0].id, env: {} });
    assert.equal(expected.ok, true);
    const stored = byKey(fake.t.bank_accounts, "plaid_account_id");
    let compared = 0;
    for (const a of expected.accounts) {
      const row = stored.get(a.provider_account_id);
      assert.ok(row, `account ${a.name} saved`);
      assert.equal(row.name, a.name);
      assert.equal(row.official_name, a.official_name ?? null);
      assert.equal(row.mask, last4(a.mask));
      assert.equal(row.account_type, a.account_type);
      assert.equal(row.account_subtype, a.account_subtype);
      assert.equal(row.currency_code, a.currency_code);
      assert.equal(row.current_balance_cents, a.current_balance_cents, `${a.name}: current balance is the current balance`);
      assert.equal(row.available_balance_cents, a.available_balance_cents, `${a.name}: available balance is the available balance`);
      assert.equal(row.credit_limit_cents, a.credit_limit_cents ?? null);
      assert.equal(row.balance_as_of, a.balance_as_of);
      assert.equal(row.provider, "mock");
      assert.equal(row.provider_account_id, a.provider_account_id);
      for (const t of a.transactions) {
        const txRow = fake.t.transactions.find((x) => x.bank_account_id === row.id && x.provider_transaction_id === t.provider_transaction_id);
        assert.ok(txRow, `transaction ${t.provider_transaction_id} saved`);
        assert.equal(txRow.amount_cents, t.amount_cents, "money keeps its sign: negative is money out");
        assert.equal(txRow.posted_on, t.posted_on);
        assert.equal(txRow.merchant_name, t.merchant_name);
        assert.equal(txRow.is_pending, Boolean(t.pending));
        assert.equal(txRow.provider, "mock");
        compared += 1;
      }
      if (a.statement_cycle) {
        const c = fake.t.cycles.find((x) => x.bank_account_id === row.id);
        assert.ok(c, `${a.name}: a statement cycle`);
        for (const k of ["statement_close_day", "payment_due_day", "last_statement_date", "last_statement_balance_cents", "minimum_payment_cents", "apr"]) {
          assert.equal(c[k], a.statement_cycle[k], `${a.name}: cycle ${k}`);
        }
      } else {
        assert.equal(fake.t.cycles.filter((x) => x.bank_account_id === row.id).length, 0);
      }
      if (a.holdings) {
        const rows = fake.t.holdings.filter((h) => h.bank_account_id === row.id);
        assert.equal(rows.length, a.holdings.length);
        for (const h of a.holdings) {
          const r = rows.find((x) => x.symbol === String(h.symbol).toUpperCase());
          assert.ok(r, `holding ${h.symbol}`);
          assert.equal(r.quantity, h.quantity);
          assert.equal(r.cost_basis_cents, h.cost_basis_cents);
          assert.equal(r.current_value_cents, h.current_value_cents);
          assert.equal(r.description, h.description);
          assert.equal(r.currency_code, h.currency_code);
          assert.equal(r.as_of, h.as_of);
        }
      }
    }
    assert.ok(compared > 100, "a long history was compared line by line");
    // The two balances are different numbers on a bank account, so a swap cannot hide.
    const checking = expected.accounts.find((a) => a.account_type === "depository");
    assert.notEqual(checking.current_balance_cents, checking.available_balance_cents);
  });

  test("a provider's long mask is cut to its last four digits, a pending transaction stays pending with no posted date, and a transaction the ledger cannot take is counted and dropped", async () => {
    const fake = bankFile();
    let doctored = null;
    globalThis.__finB08Provider = async (_args, real) => {
      const answer = await real();
      doctored = {
        ...answer,
        accounts: answer.accounts.map((a, i) => ({
          ...a,
          mask: `9876543210${a.mask}`,
          transactions: i === 0
            ? [
                { provider_transaction_id: "fin-b08-pending", posted_on: null, amount_cents: -4321, merchant_name: "HOLD CO", pending: true },
                { provider_transaction_id: "fin-b08-refund", posted_on: "2026-10-01", amount_cents: 1250, merchant_name: "REFUND CO", pending: false },
                { provider_transaction_id: "fin-b08-zero", posted_on: "2026-10-01", amount_cents: 0, merchant_name: "ZERO CO", pending: false },
                { provider_transaction_id: "fin-b08-float", posted_on: "2026-10-01", amount_cents: 12.5, merchant_name: "FLOAT CO", pending: false },
                { provider_transaction_id: "fin-b08-undated", posted_on: null, amount_cents: -100, merchant_name: "NO DATE CO", pending: false },
                { provider_transaction_id: null, posted_on: "2026-10-01", amount_cents: -100, merchant_name: "NO ID CO", pending: false },
              ]
            : a.transactions,
        })),
      };
      return doctored;
    };
    const res = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.equal(res.statusCode, 200);
    for (const r of fake.t.bank_accounts) assert.match(String(r.mask), /^\d{4}$/, "a full number is never saved");
    for (const a of doctored.accounts) {
      const row = fake.t.bank_accounts.find((r) => r.plaid_account_id === a.provider_account_id);
      assert.equal(row.mask, a.mask.slice(-4));
    }
    const first = fake.t.bank_accounts.find((r) => r.plaid_account_id === doctored.accounts[0].provider_account_id);
    const mine = fake.t.transactions.filter((x) => x.bank_account_id === first.id);
    assert.deepEqual(mine.map((x) => x.provider_transaction_id).sort(), ["fin-b08-pending", "fin-b08-refund"]);
    const pending = mine.find((x) => x.provider_transaction_id === "fin-b08-pending");
    assert.equal(pending.is_pending, true, "a pending transaction stays pending");
    assert.equal(pending.posted_on, null);
    assert.equal(pending.amount_cents, -4321);
    const refund = mine.find((x) => x.provider_transaction_id === "fin-b08-refund");
    assert.equal(refund.is_pending, false);
    assert.equal(refund.amount_cents, 1250, "money in stays positive");
    assert.deepEqual(res.body.droppedTransactions.map((d) => d.why).sort(), [
      "no_provider_transaction_id", "settled_with_no_posted_date", "zero_or_non_integer_amount", "zero_or_non_integer_amount",
    ]);
  });
});
