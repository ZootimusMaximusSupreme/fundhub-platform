// Postgres-backed tests for migration 583 (finance_custom_alerts) and its store: the
// alerts and repeat bills a client adds by hand (unit AL2, 2026-11-07).
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. The table refuses what the rules say it refuses, whoever writes: a bill with
//      no amount, a monthly row with a date and no day, a personal row that names a
//      business, an amount of zero.
//   2. The store reads and writes one client of one company only, checks the business
//      is the client's own, and removes by archived_at (the row stays).
//   3. The daily pass's phone step queues one push per date for a row added here.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Nothing this file writes
// survives it. Expected failures run inside SAVEPOINTs.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (a skip is not a pass:
// CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../../db.mjs";
import {
  readCustomInput, addCustomItem, updateCustomItem, removeCustomItem, setCustomPhone, listCustomItems, customKindOf
} from "./custom.mjs";
import { planPhoneAlerts } from "./phone-alerts.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const TODAY = "2026-10-12";

describe("the client's own alerts and bills (migration 583)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c;
  let db;
  let orgId;
  let otherOrg;
  let seq = 0;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    db = { query: (...args) => c.query(...args) };
    const org = async (tag) => (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'CustomAlerts PgTest Org') RETURNING id`,
      [`custom-alerts-pg-${tag}-${process.pid}-${Date.now()}`]
    )).rows[0].id;
    orgId = await org("a");
    otherOrg = await org("b");
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
  const client = async (org = orgId) => (await c.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, $2, 'CustomAlertsPg') RETURNING id`,
    [org, `Client${++seq}`]
  )).rows[0].id;
  const entity = async (clientId, kind = "business", org = orgId) => (await c.query(
    `INSERT INTO entities (org_id, client_id, kind, name) VALUES ($1, $2, $3, $4) RETURNING id`,
    [org, clientId, kind, `Entity${++seq}`]
  )).rows[0].id;
  const INSERT = `INSERT INTO finance_custom_alerts
    (org_id, client_id, kind, name, amount_cents, cadence, day_of_month, start_on, scope, entity_id, created_by, updated_by)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9, $10, 'client', 'client')`;

  test("the table refuses a bill with no amount, a monthly row with a date, a personal row with a business, a zero amount", async () => {
    const id = await client();
    const biz = await entity(id);
    await expectRefused(INSERT, [orgId, id, "bill", "Rent", null, "monthly", 1, null, "personal", null], "23514");
    await expectRefused(INSERT, [orgId, id, "alert", "Rent", null, "monthly", 1, "2026-10-20", "personal", null], "23514");
    await expectRefused(INSERT, [orgId, id, "alert", "Rent", null, "monthly", null, null, "personal", null], "23514");
    await expectRefused(INSERT, [orgId, id, "alert", "Rent", null, "weekly", null, "2026-10-20", "personal", null], "23514");
    await expectRefused(INSERT, [orgId, id, "alert", "Rent", null, "monthly", 1, null, "personal", biz], "23514");
    await expectRefused(INSERT, [orgId, id, "bill", "Rent", 0, "monthly", 1, null, "personal", null], "23514");
    await expectRefused(INSERT, [orgId, id, "alert", "  ", null, "monthly", 1, null, "personal", null], "23514");
    await c.query(INSERT, [orgId, id, "bill", "Rent", 120000, "monthly", 1, null, "business", biz]);
  });

  test("the store: add, list, change, switch off and remove one client's rows; another client's id is a 404", async () => {
    const id = await client();
    const other = await client();
    const biz = await entity(id);
    const input = readCustomInput({ kind: "bill", name: "Office rent", amount_cents: 120000, cadence: "monthly", day_of_month: 1,
      scope: "business", entity_id: biz }, { today: TODAY });
    const row = await addCustomItem(db, { orgId, clientId: id, input, by: "client" });
    assert.equal(row.kind, "bill");
    assert.equal(Number(row.amount_cents), 120000);
    assert.equal(String(row.entity_id), String(biz));
    assert.equal(await customKindOf(db, { orgId, clientId: id, id: String(row.id) }), "bill");
    await assert.rejects(customKindOf(db, { orgId, clientId: other, id: String(row.id) }), (e) => e.status === 404);
    await assert.rejects(customKindOf(db, { orgId: otherOrg, clientId: id, id: String(row.id) }), (e) => e.status === 404);

    const changed = await updateCustomItem(db, { orgId, clientId: id, id: String(row.id), by: "staff",
      input: readCustomInput({ name: "Office rent", amount_cents: 125000, cadence: "monthly", day_of_month: 5, scope: "business", entity_id: biz },
        { today: TODAY, kind: "bill" }) });
    assert.deepEqual([Number(changed.amount_cents), changed.day_of_month, changed.updated_by], [125000, 5, "staff"]);
    assert.deepEqual(await setCustomPhone(db, { orgId, clientId: id, id: String(row.id), enabled: false }), { id: String(row.id), phone_alert: false });

    assert.equal((await listCustomItems(db, { orgId, clientId: id })).length, 1);
    assert.equal((await listCustomItems(db, { orgId, clientId: other })).length, 0, "one client never sees another's");
    await assert.rejects(removeCustomItem(db, { orgId, clientId: other, id: String(row.id) }), (e) => e.status === 404);
    assert.deepEqual(await removeCustomItem(db, { orgId, clientId: id, id: String(row.id) }), { id: String(row.id), removed: true });
    assert.equal((await listCustomItems(db, { orgId, clientId: id })).length, 0);
    const kept = (await c.query(`SELECT archived_at FROM finance_custom_alerts WHERE id = $1`, [row.id])).rows[0];
    assert.ok(kept && kept.archived_at, "removed by archived_at; the row stays");
  });

  test("a business must be the client's own live business entity", async () => {
    const id = await client();
    const theirs = await entity(await client());
    const personal = await entity(id, "personal");
    for (const bad of [theirs, personal]) {
      const input = readCustomInput({ kind: "alert", name: "Payroll", cadence: "monthly", day_of_month: 15, scope: "business", entity_id: String(bad) }, { today: TODAY });
      await assert.rejects(addCustomItem(db, { orgId, clientId: id, input, by: "client" }), (e) => e.field === "entity_id" && e.status === 404);
    }
  });

  test("the daily planner owes one push per date for a stored row, and none once it is switched off", async () => {
    const id = await client();
    const input = readCustomInput({ kind: "alert", name: "Savings", cadence: "monthly", day_of_month: 14, scope: "personal" }, { today: TODAY });
    const row = await addCustomItem(db, { orgId, clientId: id, input, by: "client" });
    const stored = await listCustomItems(db, { orgId, clientId: id });
    const owed = planPhoneAlerts({ custom: stored, today: TODAY }).owed;
    assert.deepEqual(owed.map((o) => [o.kind, o.key]), [["custom_alert", `custom:${row.id}:2026-10-14`]]);
    await setCustomPhone(db, { orgId, clientId: id, id: String(row.id), enabled: false });
    assert.deepEqual(planPhoneAlerts({ custom: await listCustomItems(db, { orgId, clientId: id }), today: TODAY }).owed, []);
  });
});
