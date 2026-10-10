// Postgres-backed tests for migration 463 (payment_strategy_plans) and the save
// in src/finance/payment-strategy.mjs.
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. The save's one statement (UPDATE the old plan's superseded_at, then
//      INSERT the new one) really leaves exactly one active plan, and keeps the
//      old one — the partial unique index does not trip on the row the same
//      statement just superseded.
//   2. The table itself refuses a plan marked "over" the safe amount, a goal
//      without a date, and a second active plan — whoever writes, not only the
//      module that usually does.
//   3. The payoff plan source reads its pins back from the stored row.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Nothing this file
// writes survives it, whatever database it is pointed at. Expected failures run
// inside SAVEPOINTs so the transaction stays usable.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12:
// a skip is not a pass — CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../db.mjs";
import { savePlan, readSavedPlan } from "./payment-strategy.mjs";
import * as payoff from "./plan-sources/payoff.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const NOW = new Date("2026-10-07T12:00:00Z");

const OVERVIEW = (clientId) => ({
  ok: true,
  client: { id: clientId, name: "Strategy PgTest" },
  sandbox: false,
  tip: null,
  accounts: [
    { id: "00000000-0000-4000-8000-0000000000c1", name: "Checking", type: "depository", kind: "business", current_cents: 1000000 }
  ],
  debt: {
    cards: [{ account_id: "00000000-0000-4000-8000-0000000000a1", name: "Test Card", kind: "business", container_id: null,
      balance_cents: 500000, limit_cents: 1000000, due_on: "2026-10-20", min_due_cents: 15000 }],
    loans: []
  }
});
const depsFor = (clientId) => ({
  moneyOverview: async () => OVERVIEW(clientId),
  listRecurringBillsFor: async () => [],
  loadThresholds: async () => ({})
});

describe("payment_strategy_plans (migration 463)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c;
  let orgId;
  let clientId;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    orgId = (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'Strategy PgTest Org') RETURNING id`,
      [`strategy-pg-test-${process.pid}-${Date.now()}`]
    )).rows[0].id;
    clientId = (await c.query(
      `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, 'Strategy', 'PgTest') RETURNING id`,
      [orgId]
    )).rows[0].id;
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function expectRefused(sql, params, code) {
    await c.query("SAVEPOINT refused");
    try {
      await c.query(sql, params);
      assert.fail(`expected ${code}`);
    } catch (e) {
      assert.equal(e.code, code, e.message);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT refused");
    }
  }

  test("a save keeps one active plan; saving again supersedes the first and keeps it", async () => {
    const first = await savePlan(c, { orgId, clientId, settings: { method: "avalanche", monthly_cents: 60000, goal: null },
      savedByKind: "client", env: {}, asOf: NOW, deps: depsFor(clientId) });
    assert.equal(first.ok, true, JSON.stringify(first));
    const second = await savePlan(c, { orgId, clientId, settings: { method: "snowball", monthly_cents: 80000, goal: { kind: "debt_free", by: "2027-12-31" } },
      savedByKind: "client", env: {}, asOf: NOW, deps: depsFor(clientId) });
    assert.equal(second.ok, true, JSON.stringify(second));
    const rows = (await c.query(
      `SELECT id, method, monthly_cents, superseded_at, cash_check, goal_kind, goal_by::text AS goal_by
         FROM payment_strategy_plans WHERE org_id = $1 AND client_id = $2 ORDER BY created_at, id`,
      [orgId, clientId]
    )).rows;
    assert.equal(rows.length, 2);
    assert.equal(rows.filter((r) => r.superseded_at === null).length, 1);
    const active = rows.find((r) => r.superseded_at === null);
    assert.equal(active.method, "snowball");
    assert.equal(Number(active.monthly_cents), 80000);
    assert.equal(active.cash_check, "safe");
    assert.equal(active.goal_by, "2027-12-31");
  });

  test("the saved plan reads back with its steps; the payoff source turns them into pins", async () => {
    const saved = await readSavedPlan(c, { orgId, clientId });
    assert.equal(saved.method, "snowball");
    assert.ok(saved.milestones.length >= 2);
    const pins = await payoff.pins(c, { orgId, clientId, from: "2026-10-01", to: "2030-12-31", today: "2026-10-07" });
    assert.equal(pins.length, saved.milestones.length);
    assert.ok(pins.every((p) => p.source === "payoff" && p.id.startsWith(`payoff:${saved.id}:`)));
    assert.ok(pins.some((p) => p.title === "Pay off Test Card"));
  });

  const insert = (over = {}) => {
    const v = { method: "avalanche", monthly: 1000, goalKind: null, goalBy: null, cash: "safe", by: "client", byId: null, ...over };
    return [
      `INSERT INTO payment_strategy_plans (org_id, client_id, method, monthly_cents, goal_kind, goal_by, as_of, cash_check, saved_by_kind, saved_by_id, superseded_at)
       VALUES ($1, $2, $3, $4, $5, $6, '2026-10-07', $7, $8, $9, now())`,
      [orgId, clientId, v.method, v.monthly, v.goalKind, v.goalBy, v.cash, v.by, v.byId]
    ];
  };

  test("the table refuses a plan marked over the safe amount — there is no 'over'", async () => {
    await expectRefused(...insert({ cash: "over" }), "23514");
  });

  test("the table refuses a goal with no date, an unknown method, and zero cents", async () => {
    await expectRefused(...insert({ goalKind: "util10", goalBy: null }), "23514");
    await expectRefused(...insert({ method: "fastest" }), "23514");
    await expectRefused(...insert({ monthly: 0 }), "23514");
  });

  test("a client cannot carry a staff id, and a second active plan is refused by the index", async () => {
    await expectRefused(...insert({ by: "client", byId: "00000000-0000-4000-8000-000000000099" }), "23514");
    await expectRefused(
      `INSERT INTO payment_strategy_plans (org_id, client_id, method, monthly_cents, as_of, cash_check, saved_by_kind)
       VALUES ($1, $2, 'avalanche', 1000, '2026-10-07', 'safe', 'client')`,
      [orgId, clientId],
      "23505"
    );
  });
});
