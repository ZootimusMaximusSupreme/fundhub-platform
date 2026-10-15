// finish-853 batch 08: POST /api/banking/accounts action=import. The real handler, the real provider
// switch (the mock provider), the real mapper and the real upserts run over a stand-in plaid_items,
// bank_accounts, statement cycles, holdings and transactions that keep the database's own
// one-row-per-key rules. The row's words: pull accounts from the configured banking provider,
// mock or Plaid, into this client. Practice test, fake data, no network, no database.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/banking/accounts.mjs";
import { getAccounts } from "../banking/provider.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { bindProblem, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c9000000-0000-4000-8000-000000000009";
const saved = process.env.BANKING_PROVIDER;
before(() => { delete process.env.BANKING_PROVIDER; });
after(() => { if (saved === undefined) delete process.env.BANKING_PROVIDER; else process.env.BANKING_PROVIDER = saved; });
beforeEach(() => { delete process.env.BANKING_PROVIDER; });

function bankFile() {
  const t = { clients: [{ id: CLIENT, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }], plaid_items: [], bank_accounts: [], cycles: [], holdings: [], transactions: [] };
  let seq = 0;
  const id = (p) => `${p}${String(++seq).padStart(7, "0")}-0000-4000-8000-000000000000`;
  const cols = (s) => /\(([^)]+)\)\s*VALUES/i.exec(s)[1].split(",").map((c) => c.trim());
  const fake = fakeDb([
    [/^\s*SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/i, (_s, p) => t.clients.filter((c) => c.id === p[0] && c.org_id === p[1]).map(() => ({ "?column?": 1 }))],
    [/^\s*SELECT id FROM plaid_items\s+WHERE org_id = \$1 AND client_id = \$2 AND plaid_item_id = \$3/i, (_s, p) => t.plaid_items.filter((r) => r.org_id === p[0] && r.client_id === p[1] && r.plaid_item_id === p[2]).map((r) => ({ id: r.id }))],
    [/^\s*INSERT INTO plaid_items/i, (s, p) => {
      const r = { id: id("a1"), org_id: p[0], client_id: p[1], plaid_item_id: p[2], institution_name: p[3], link_state: /'active'/.test(s) ? "active" : null };
      t.plaid_items.push(r);
      return [{ id: r.id }];
    }],
    [/^\s*INSERT INTO bank_accounts/i, (s, p) => {
      const names = cols(s);
      const row = Object.fromEntries(names.map((c, i) => [c, p[i]]));
      const existing = t.bank_accounts.find((r) => r.plaid_item_id === row.plaid_item_id && r.plaid_account_id === row.plaid_account_id);
      if (existing) {
        const upd = /DO UPDATE SET([\s\S]*?)RETURNING/i.exec(s)[1];
        for (const [, c] of upd.matchAll(/([a-z_]+)\s*=\s*EXCLUDED\.[a-z_]+/gi)) existing[c] = row[c];
        return [{ id: existing.id }];
      }
      const r = { id: id("b1"), ...row };
      t.bank_accounts.push(r);
      return [{ id: r.id }];
    }],
    [/^\s*INSERT INTO account_statement_cycles/i, (_s, p) => {
      const r = { org_id: p[0], client_id: p[1], bank_account_id: p[2], statement_close_day: p[3], payment_due_day: p[4], last_statement_date: p[5], last_statement_balance_cents: p[6], minimum_payment_cents: p[7], apr: p[8], source: "provider" };
      const at = t.cycles.findIndex((c) => c.bank_account_id === r.bank_account_id);
      if (at >= 0) t.cycles[at] = r; else t.cycles.push(r);
      return { rows: [], rowCount: 1 };
    }],
    [/^\s*DELETE FROM investment_holdings WHERE bank_account_id = \$1/i, (_s, p) => { t.holdings = t.holdings.filter((h) => h.bank_account_id !== p[0]); return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO investment_holdings/i, (_s, p) => { t.holdings.push({ org_id: p[0], client_id: p[1], bank_account_id: p[2], symbol: p[3], quantity: p[5], current_value_cents: p[7] }); return { rows: [], rowCount: 1 }; }],
    [/^\s*INSERT INTO bank_transactions/i, (_s, p) => {
      const r = { org_id: p[0], client_id: p[1], bank_account_id: p[2], amount_cents: p[3], posted_on: p[4], merchant_name: p[5], is_pending: p[6], provider_transaction_id: p[7], provider: p[8] };
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

async function call(body, fake, who = [staffSession({ role: "owner" })]) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res));
  return res;
}

describe("POST /api/banking/accounts action=import", () => {
  test("the mock provider's accounts land on this client under this company, with cycles, holdings and transactions, in one transaction", async () => {
    const fake = bankFile();
    const expected = await getAccounts({ itemId: "x", env: {}, today: "2026-10-14" });
    const res = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.provider, "mock");
    assert.equal(res.body.accounts, expected.accounts.length);
    assert.equal(fake.t.bank_accounts.length, expected.accounts.length);
    assert.ok(fake.t.bank_accounts.every((a) => a.org_id === ORG_ID && a.client_id === CLIENT && a.provider === "mock" && a.plaid_item_id === fake.t.plaid_items[0].id));
    assert.equal(fake.t.plaid_items.length, 1);
    assert.equal(fake.t.plaid_items[0].institution_name, "Mock Bank (test data)", "the screen can see these numbers are invented");
    assert.equal(fake.t.plaid_items[0].link_state, "active");
    assert.equal(res.body.statementCycles, expected.accounts.filter((a) => a.statement_cycle).length);
    assert.equal(fake.t.cycles.length, res.body.statementCycles);
    assert.equal(res.body.holdings, expected.accounts.reduce((n, a) => n + (a.holdings || []).length, 0));
    assert.equal(fake.t.holdings.length, res.body.holdings);
    assert.equal(fake.t.transactions.length, res.body.transactions);
    assert.ok(res.body.transactions > 100);
    assert.ok(fake.t.transactions.every((x) => x.amount_cents !== 0 && Number.isInteger(x.amount_cents)), "money stays whole cents and a zero is never a transaction");
    assert.equal(fake.count("BEGIN"), 1);
    assert.equal(fake.count("COMMIT"), 1);
  });

  test("a second import is a refresh: the same rows are updated in place, nothing is doubled", async () => {
    const fake = bankFile();
    const first = await call({ client_id: CLIENT, action: "import" }, fake);
    const sizes = () => [fake.t.plaid_items.length, fake.t.bank_accounts.length, fake.t.cycles.length, fake.t.holdings.length, fake.t.transactions.length];
    const before = sizes();
    const ids = fake.t.bank_accounts.map((a) => a.id);
    const second = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.equal(second.statusCode, 200);
    assert.deepEqual(sizes(), before);
    assert.deepEqual(fake.t.bank_accounts.map((a) => a.id), ids);
    assert.equal(second.body.itemId, first.body.itemId);
    // The stand-in keeps one row per key itself, so the statements' own upsert clauses are pinned.
    const account = fake.calls.find((c) => /INSERT INTO bank_accounts/.test(c.sql));
    assertSqlHas(account.sql, {
      "one account per bank link and provider account": "ON CONFLICT (plaid_item_id, plaid_account_id) WHERE plaid_item_id IS NOT NULL AND plaid_account_id IS NOT NULL DO UPDATE SET",
    });
    assertSqlHas(fake.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql)).sql, { "one cycle per account": "ON CONFLICT (bank_account_id) DO UPDATE SET" });
    assertSqlHas(fake.calls.find((c) => /INSERT INTO bank_transactions/.test(c.sql)).sql, { "one row per provider transaction": "ON CONFLICT (bank_account_id, provider_transaction_id) DO UPDATE SET" });
    const columns = /INSERT INTO bank_accounts\s*\(([^)]+)\)/.exec(account.sql)[1];
    assert.doesNotMatch(columns, /entity_kind/, "a provider is not an authority on whose money an account holds");
  });

  test("the provider answers account types and masks as the book keeps them: a mask is last four digits, the balance is cents, a card keeps its limit", async () => {
    const fake = bankFile();
    await call({ client_id: CLIENT, action: "import" }, fake);
    for (const a of fake.t.bank_accounts) {
      assert.match(String(a.mask), /^\d{4}$/, a.name);
      assert.ok(a.current_balance_cents === null || Number.isInteger(a.current_balance_cents));
    }
    const card = fake.t.bank_accounts.find((a) => a.account_type === "credit");
    assert.ok(Number.isInteger(card.credit_limit_cents) && card.credit_limit_cents > 0);
    const depository = fake.t.bank_accounts.find((a) => a.account_type === "depository");
    assert.equal(depository.credit_limit_cents, null, "a checking account has no limit: unknown stays null, not 0");
  });

  test("an unknown provider name is refused with 503 and nothing is written; it never falls back to the mock", async () => {
    process.env.BANKING_PROVIDER = "Plaid ";
    const fake = bankFile();
    const res = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.reason, "unknown_provider");
    assert.equal(fake.t.bank_accounts.length + fake.t.plaid_items.length, 0);
  });

  test("Plaid selected but not wired answers with its own refusal and writes no account", async () => {
    process.env.BANKING_PROVIDER = "plaid";
    const fake = bankFile();
    const res = await call({ client_id: CLIENT, action: "import" }, fake);
    assert.ok([501, 503].includes(res.statusCode), String(res.statusCode));
    assert.equal(res.body.ok, false);
    assert.equal(fake.t.bank_accounts.length, 0);
    assert.equal(fake.count("ROLLBACK") >= 1, true, "the half-made bank link row is rolled back");
  });

  test("another company's client is 404 and nothing is written; only owner, admin and sales manager may import", async () => {
    const foreign = bankFile();
    const refused = await call({ client_id: FOREIGN_CLIENT, action: "import" }, foreign);
    assert.equal(refused.statusCode, 404);
    assert.equal(foreign.t.bank_accounts.length, 0);
    const letIn = [];
    for (const role of ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
      const f = bankFile();
      const res = await call({ client_id: CLIENT, action: "import" }, f, [staffSession({ role })]);
      if (res.statusCode === 403) assert.equal(f.t.bank_accounts.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "owner", "sales_manager"]);
  });
});
