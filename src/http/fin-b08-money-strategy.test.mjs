// finish-853 batch 08: GET/POST /api/money/strategy. The real handler runs the real payment
// strategy (src/finance/payment-strategy.mjs, the real overview and the real cash projector behind
// it) over stand-in tables that answer by the client and company each statement names.
// The row's words: GET the payoff inputs and the plan (highest rate first, card use first, smallest
// balance first); POST save_plan recomputes on the server, refuses a first month the cash cannot
// cover, and stores the plan; it moves no money. Practice test, fake data, no network, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/strategy.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { tablesDb } from "../testing/fin-b08-tables.mjs";
import { assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FOREIGN = "c9000000-0000-4000-8000-000000000009";
const STAFF = "5aff0000-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-14T12:00:00Z");
const acct = (over) => ({
  client_id: CLIENT, org_id: ORG, provider: "mock", official_name: null, mask: null, account_subtype: null, available_balance_cents: null,
  credit_limit_cents: null, entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null,
  closed_at: null, institution_name: null, plaid_item_id: null, ...over,
});

function strategyFile({ checking = 900000, plans = [] } = {}) {
  const tables = {
    clients: [
      { id: CLIENT, org_id: ORG, first_name: "Dana", last_name: "Whitfield", custom_fields: {} },
      { id: OTHER_CLIENT, org_id: ORG, first_name: "Pat", last_name: "Other", custom_fields: {} },
      { id: FOREIGN, org_id: OTHER_ORG, first_name: "Foreign", last_name: "Person", custom_fields: {} },
    ],
    bank_accounts: [
      acct({ id: "chk", name: "Checking", account_type: "depository", current_balance_cents: checking, available_balance_cents: checking }),
      acct({ id: "visa", name: "Visa", account_type: "credit", current_balance_cents: 300000, credit_limit_cents: 1000000, mask: "4242" }),
      acct({ id: "mc", name: "Mastercard", account_type: "credit", current_balance_cents: 100000, credit_limit_cents: 500000, mask: "1111" }),
      // Someone else's card and another company's card must never become this client's debt.
      acct({ id: "pat", client_id: OTHER_CLIENT, name: "Pat's Amex", account_type: "credit", current_balance_cents: 999999, credit_limit_cents: 2000000 }),
      acct({ id: "foreign", org_id: OTHER_ORG, name: "Foreign card", account_type: "credit", current_balance_cents: 888888, credit_limit_cents: 2000000 }),
    ],
    account_statement_cycles: [
      { client_id: CLIENT, org_id: ORG, bank_account_id: "visa", statement_close_day: 10, payment_due_day: 5, minimum_payment_cents: 9000, apr: "0.2499", last_statement_balance_cents: 300000 },
      { client_id: CLIENT, org_id: ORG, bank_account_id: "mc", statement_close_day: 12, payment_due_day: 8, minimum_payment_cents: 2500, apr: "0.1599", last_statement_balance_cents: 100000 },
    ],
    payment_strategy_plans: plans,
  };
  const writes = [];
  writes.sqls = [];
  const db = tablesDb({
    tables,
    rules: [
      [/^\s*WITH old AS \(\s*UPDATE payment_strategy_plans/i, (sql, p) => {
        writes.sqls.push(sql);
        for (const r of tables.payment_strategy_plans) {
          if (r.org_id === p[0] && r.client_id === p[1] && r.superseded_at === null) r.superseded_at = NOW.toISOString();
        }
        const row = {
          id: `a${String(tables.payment_strategy_plans.length + 1).padStart(7, "0")}-0000-4000-8000-000000000000`,
          org_id: p[0], client_id: p[1], method: p[2], monthly_cents: p[3], goal_kind: p[4], goal_by: p[5], as_of: p[6], debt_free_on: p[7],
          inputs: JSON.parse(p[8]), milestones: JSON.parse(p[9]), summary: JSON.parse(p[10]), cash_check: p[11], saved_by_kind: p[12],
          saved_by_id: p[13], created_at: NOW.toISOString(), superseded_at: null,
        };
        tables.payment_strategy_plans.push(row);
        writes.push(row);
        return [row];
      }],
    ],
  });
  return { db, tables, writes };
}

async function call({ method = "GET", query = { client_id: CLIENT }, body, principal, file = strategyFile() } = {}) {
  const res = makeRes();
  await handler({ method, query, body }, res, { db: file.db, requirePrincipal: gateAs(principal), env: {}, now: () => NOW });
  return { res, file };
}
const staff = (role = "closer", orgId = ORG) => staffPrincipal(role, orgId, STAFF);

describe("GET /api/money/strategy", () => {
  test("the debts are this client's own cards with their statement rates, and the default plan pays the highest rate first at the minimums", async () => {
    const { res } = await call({ principal: staff() });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.inputs.debts.map((d) => [d.id, d.balance_cents, d.apr_pct, d.min_cents]), [
      ["visa", 300000, 24.99, 9000],
      ["mc", 100000, 15.99, 2500],
    ], "Pat's card and another company's card are not this client's debt");
    assert.deepEqual(res.body.defaults, { method: "avalanche", monthly_cents: 11500, goal: null });
    assert.equal(res.body.plan.ok, true);
    assert.equal(res.body.plan.minimums_cents, 11500);
    assert.equal(res.body.plan.cash.status, "safe");
    assert.equal(res.body.inputs.cash.by_kind.personal.safe_cents, 900000);
    assert.equal(res.body.saved, null);
    assert.deepEqual(res.body.methods && Object.keys(res.body.methods).sort(), ["avalanche", "snowball", "utilization"]);
  });

  test("a saved plan sets the starting settings the page opens with", async () => {
    const file = strategyFile({ plans: [{
      id: "p-old", org_id: ORG, client_id: CLIENT, method: "snowball", monthly_cents: 20000, goal_kind: null, goal_by: null, as_of: "2026-10-01",
      debt_free_on: "2029-01-01", cash_check: "safe", saved_by_kind: "client", saved_by_id: null, created_at: "2026-10-01T00:00:00Z",
      inputs: [], milestones: [{ key: "debt_free" }], summary: {}, superseded_at: null,
    }] });
    const { res } = await call({ principal: staff(), file });
    assert.deepEqual(res.body.defaults, { method: "snowball", monthly_cents: 20000, goal: null });
    assert.equal(res.body.saved.method, "snowball");
    assert.equal(res.body.saved.steps, 1);
  });

  test("a superseded plan is not the saved one, and another client's saved plan is never read", async () => {
    const file = strategyFile({ plans: [
      { id: "p1", org_id: ORG, client_id: CLIENT, method: "snowball", monthly_cents: 20000, as_of: "2026-10-01", debt_free_on: null, cash_check: "safe", saved_by_kind: "client", created_at: "x", inputs: [], milestones: [], summary: {}, superseded_at: "2026-10-05T00:00:00Z" },
      { id: "p2", org_id: ORG, client_id: OTHER_CLIENT, method: "utilization", monthly_cents: 50000, as_of: "2026-10-01", debt_free_on: null, cash_check: "safe", saved_by_kind: "client", created_at: "x", inputs: [], milestones: [], summary: {}, superseded_at: null },
    ] });
    const { res } = await call({ principal: staff(), file });
    assert.equal(res.body.saved, null);
    assert.equal(res.body.defaults.method, "avalanche");
  });

  test("a client reads their own file only; a client_id in the address is never read", async () => {
    const { res } = await call({ query: { client_id: FOREIGN }, principal: clientPrincipal(CLIENT, ORG) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.id, CLIENT);
  });

  test("staff of another company get 404 and no account is read; only the four FinanceOS roles may read", async () => {
    const file = strategyFile();
    const other = await call({ principal: staff("owner", OTHER_ORG), file });
    assert.equal(other.res.statusCode, 404);
    assert.equal(file.db.calls.filter((c) => /FROM bank_accounts/.test(c.sql)).length, 0);
    const letIn = [];
    for (const role of ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
      const f = strategyFile();
      const { res } = await call({ principal: staff(role), file: f });
      if (res.statusCode === 403) assert.equal(f.db.calls.length, 0, role);
      else letIn.push(role);
    }
    assert.deepEqual(letIn.sort(), ["admin", "closer", "owner", "sales_manager"]);
  });
});

describe("POST /api/money/strategy save_plan", () => {
  const save = (over = {}, extra = {}) => call({ method: "POST", body: { client_id: CLIENT, action: "save_plan", method: "avalanche", monthly_cents: 20000, ...over }, ...extra });

  test("saving recomputes on the server and stores one active plan, its steps and who saved it; the old plan is kept but superseded", async () => {
    const file = strategyFile({ plans: [{
      id: "p-old", org_id: ORG, client_id: CLIENT, method: "snowball", monthly_cents: 15000, as_of: "2026-10-01", debt_free_on: null, cash_check: "safe",
      saved_by_kind: "client", saved_by_id: null, created_at: "2026-10-01T00:00:00Z", inputs: [], milestones: [], summary: {}, superseded_at: null,
    }] });
    // The browser claims a different set of debts and a different month count; the server uses its own reads.
    const { res } = await save({ debts: [{ id: "fake", balance_cents: 1 }], plan: { months: 1 } }, { principal: staff("closer"), file });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "save_plan");
    assert.equal(res.body.saved.method, "avalanche");
    assert.equal(res.body.saved.monthly_cents, 20000);
    const active = file.tables.payment_strategy_plans.filter((r) => r.superseded_at === null);
    assert.equal(active.length, 1, "one active plan");
    assert.equal(active[0].org_id, ORG);
    assert.equal(active[0].client_id, CLIENT);
    assert.equal(active[0].saved_by_kind, "staff");
    assert.equal(active[0].saved_by_id, STAFF);
    assert.equal(active[0].cash_check, "safe");
    assert.deepEqual(active[0].inputs.map((d) => [d.id, d.balance_cents]), [["visa", 300000], ["mc", 100000]]);
    assert.ok(active[0].milestones.some((m) => m.key === "debt_free"), "its steps are kept so the timeline can pin them");
    assert.equal(file.tables.payment_strategy_plans.find((r) => r.id === "p-old").superseded_at, NOW.toISOString());
    // The stand-in supersedes by itself, so the statement's own words are pinned.
    assertSqlHas(file.writes.sqls[0], {
      "only this client's active plan is superseded": "UPDATE payment_strategy_plans SET superseded_at = now() WHERE org_id = $1 AND client_id = $2 AND superseded_at IS NULL",
    });
  });

  test("each method pays down in its own order: highest rate first, smallest balance first, card use first", async () => {
    const firstStep = async (method) => {
      const file = strategyFile();
      const { res } = await save({ method, monthly_cents: 60000 }, { principal: staff(), file });
      assert.equal(res.statusCode, 200, method);
      return file.writes[0].milestones[0].key;
    };
    assert.equal(await firstStep("avalanche"), "visa:util10", "the 24.99% Visa first");
    assert.equal(await firstStep("snowball"), "mc:util10", "the $1,000 Mastercard first");
    const util = strategyFile();
    const u = await save({ method: "utilization", monthly_cents: 60000 }, { principal: staff(), file: util });
    assert.equal(u.res.body.saved.method, "utilization");
    assert.equal(util.writes[0].milestones[0].key, "visa:util10", "the card with the most of its limit used first");
  });

  test("a client saves for their own file and is named as the saver", async () => {
    const file = strategyFile();
    const { res } = await save({ client_id: FOREIGN }, { principal: clientPrincipal(CLIENT, ORG), file });
    assert.equal(res.statusCode, 200);
    assert.equal(file.writes[0].client_id, CLIENT);
    assert.equal(file.writes[0].saved_by_kind, "client");
    assert.equal(file.writes[0].saved_by_id, null);
  });

  test("less than the minimum payments is refused with words and nothing is stored", async () => {
    const file = strategyFile();
    const { res } = await save({ monthly_cents: 5000 }, { principal: staff(), file });
    assert.equal(res.statusCode, 422);
    assert.equal(res.body.error, "below_minimums");
    assert.match(res.body.message, /\$115 a month/);
    assert.equal(file.writes.length, 0);
  });

  test("a first month the cash cannot cover is refused with the most that is safe, and nothing is stored", async () => {
    const file = strategyFile({ checking: 10000 }); // $100 in checking, $115 of minimums
    const { res } = await save({ monthly_cents: 20000 }, { principal: staff(), file });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "over_safe_amount");
    assert.match(res.body.message, /without going below zero/);
    assert.equal(file.writes.length, 0);
  });

  test("a bad method, an amount of zero or a goal with no date is a 400 and nothing is stored", async () => {
    for (const bad of [{ method: "yolo" }, { monthly_cents: 0 }, { monthly_cents: "lots" }, { goal: { kind: "util10", by: "soon" } }]) {
      const file = strategyFile();
      const { res } = await save(bad, { principal: staff(), file });
      assert.equal(res.statusCode, 400, JSON.stringify(bad));
      assert.equal(res.body.error, "invalid_settings");
      assert.equal(file.writes.length, 0);
    }
  });

  test("saving moves no money: the only table written is the plan, and no transfer is proposed", async () => {
    const file = strategyFile();
    await save({}, { principal: staff(), file });
    const writes = file.db.calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE|WITH)\b/i.test(c.sql));
    assert.ok(writes.length >= 1);
    for (const w of writes) assert.match(w.sql, /payment_strategy_plans/, w.sql.slice(0, 60));
  });

  test("staff of another company cannot save for this client, and a role outside the FinanceOS four is refused", async () => {
    const file = strategyFile();
    const other = await save({}, { principal: staff("owner", OTHER_ORG), file });
    assert.equal(other.res.statusCode, 404);
    const setter = await save({}, { principal: staff("setter"), file });
    assert.equal(setter.res.statusCode, 403);
    assert.equal(file.writes.length, 0);
  });

  test("an unknown action is 400", async () => {
    const { res } = await call({ method: "POST", body: { client_id: CLIENT, action: "wipe" }, principal: staff() });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "unknown_action");
  });
});
