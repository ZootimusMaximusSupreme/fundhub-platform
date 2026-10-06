// src/finance/money-accounts.mjs — stubbed db, no network, no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert";

import { readHandAccount, readLast4, dollarsToCents, addHandAccount, accountsView } from "./money-accounts.mjs";

const ORG = "org-1";
const CLIENT = "11111111-2222-3333-4444-555555555555";
const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const NEW_ACCT = "cccccccc-0000-0000-0000-000000000001";

function fakeDb(routes) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      for (const [re, rows] of routes) {
        if (re.test(sql)) return { rows: typeof rows === "function" ? rows(sql, params) : rows };
      }
      return { rows: [] };
    }
  };
}

describe("reading a hand-entered account", () => {
  test("a card: dollars become integer cents, blanks stay null", () => {
    const a = readHandAccount({ name: "Sample Chase Ink", type: "credit_card", last4: "9999", balance: "2,000", limit: "$10,000", due_day: "15", minimum: "" });
    assert.equal(a.balance, 200000);
    assert.equal(a.limit, 1000000);
    assert.equal(a.dueDay, 15);
    assert.equal(a.minimum, null, "blank minimum is unknown, not $0");
    assert.equal(a.mask, "9999");
  });

  test("last 4 only — a full account number is refused, not trimmed", () => {
    assert.throws(() => readLast4("4111111111111111"), /never store one/);
    assert.equal(readLast4("•• 9999"), "9999");
    assert.equal(readLast4(""), null);
    assert.throws(() => readLast4("1"), /at least 2/);
  });

  test("limit, due day and minimum are for cards only", () => {
    assert.throws(() => readHandAccount({ name: "Checking", type: "checking", limit: "100" }), /only for a credit card/);
    assert.throws(() => readHandAccount({ name: "Loan", type: "loan", due_day: "3" }), /only for a credit card/);
  });

  test("name and type are required; bad values name the field", () => {
    assert.throws(() => readHandAccount({ type: "checking" }), /name is required/);
    assert.throws(() => readHandAccount({ name: "X", type: "brokerage" }), /type must be one of/);
    assert.throws(() => readHandAccount({ name: "X", type: "credit_card", due_day: "32" }), /1 to 31/);
    assert.throws(() => dollarsToCents("ten", "balance"), /balance/);
  });
});

describe("addHandAccount", () => {
  const input = () => readHandAccount({
    name: "Sample Chase Ink", type: "credit_card", last4: "9999", balance: "2000", limit: "10000",
    due_day: "15", minimum: "35", container_id: BIZ
  });

  test("checks the container first, then account → container (client_stated) → due day", async () => {
    const db = fakeDb([
      [/SELECT id, archived_at FROM entities/, [{ id: BIZ, archived_at: null }]],
      [/INSERT INTO bank_accounts/, [{ id: NEW_ACCT }]],
      [/SELECT id, client_id, entity_id, entity_kind/, [{ id: NEW_ACCT, client_id: CLIENT, entity_id: null, entity_kind: "unknown" }]],
      [/SELECT id, client_id, kind, archived_at FROM entities/, [{ id: BIZ, client_id: CLIENT, kind: "business", archived_at: null }]],
      [/UPDATE bank_accounts/, (_s, p) => [{ id: p[0], client_id: CLIENT, entity_id: p[2], entity_kind: p[3] }]],
      [/SELECT account_type FROM bank_accounts/, [{ account_type: "credit" }]],
      [/INSERT INTO account_statement_cycles/, [{ id: "cy-1" }]]
    ]);
    const r = await addHandAccount(db, { orgId: ORG, clientId: CLIENT, input: input(), by: { kind: "client", id: "acc-1" } });
    assert.deepEqual(r, { ok: true, account_id: NEW_ACCT });

    const order = db.calls.map((c) => c.sql);
    const iEnt = order.findIndex((s) => /SELECT id, archived_at FROM entities/.test(s));
    const iIns = order.findIndex((s) => /INSERT INTO bank_accounts/.test(s));
    assert.ok(iEnt < iIns, "container checked before anything is written");
    assert.deepEqual(db.calls[iEnt].params, [BIZ, ORG, CLIENT]);

    const ins = db.calls[iIns];
    assert.ok(ins.params.includes(200000), "balance in cents");
    assert.ok(ins.params.includes(1000000), "limit in cents");
    assert.ok(ins.params.includes("credit"));
    assert.ok(ins.params.includes("9999"));
    assert.equal(ins.params[2], null, "no plaid item — hand entered");

    const up = db.calls.find((c) => /UPDATE bank_accounts/.test(c.sql));
    assert.equal(up.params[3], "business");
    assert.equal(up.params[4], "client_stated");

    const cyc = db.calls.find((c) => /INSERT INTO account_statement_cycles/.test(c.sql));
    assert.ok(cyc.params.includes(15));
    assert.ok(cyc.params.includes(3500));
  });

  test("another client's container: refused before any write", async () => {
    const db = fakeDb([]);
    const r = await addHandAccount(db, { orgId: ORG, clientId: CLIENT, input: input(), by: { kind: "client" } });
    assert.equal(r.reason, "container_not_found");
    assert.equal(db.calls.some((c) => /INSERT|UPDATE/.test(c.sql)), false);
  });

  test("no container → the account waits in Not sorted yet; no due day → no cycle row", async () => {
    const db = fakeDb([[/INSERT INTO bank_accounts/, [{ id: NEW_ACCT }]]]);
    const r = await addHandAccount(db, {
      orgId: ORG, clientId: CLIENT, input: readHandAccount({ name: "Savings", type: "savings", balance: "500" }), by: { kind: "client" }
    });
    assert.equal(r.ok, true);
    assert.equal(db.calls.some((c) => /UPDATE bank_accounts|account_statement_cycles/.test(c.sql)), false);
  });
});

describe("accountsView", () => {
  test("business containers carry their info; cards carry due day and minimum from the cycle", async () => {
    const db = fakeDb([
      [/count\(\*\)/, [{ n: 1 }]],
      [/FROM entities/, [{ id: BIZ, kind: "business", name: "Fundhub LLC", archived_at: null }]],
      [/FROM bank_accounts\s+WHERE/, [{ id: NEW_ACCT, name: "Sample Chase Ink", mask: "9999", account_type: "credit",
        entity_kind: "business", entity_id: BIZ, current_balance_cents: "200000", credit_limit_cents: "1000000" }]],
      [/FROM businesses/, [{ id: "b-1", name: "Fundhub LLC", age_months: 66, entity_data: { source: "finance_os", entity_id: BIZ, ein_last4: "0000" } }]],
      [/FROM account_statement_cycles/, [{ bank_account_id: NEW_ACCT, payment_due_day: 15, minimum_payment_cents: null }]]
    ]);
    const v = await accountsView(db, { orgId: ORG, clientId: CLIENT, env: {} });
    const c = v.containers[0];
    assert.equal(c.business.ein_last4, "0000");
    assert.equal(c.cards[0].current_cents, 200000);
    assert.equal(c.cards[0].due_day, 15);
    assert.equal(c.cards[0].min_due_cents, null, "unknown minimum stays null");
    assert.deepEqual(v.billing, { containers: 1, price_per_container_cents: null, monthly_cents: null });
  });
});
