// The client's own alerts and repeat bills (unit AL2): the input check, the store's
// SQL (scoped to the company and the client on every statement, removed by
// archived_at, never deleted) and the screen's view. A stub database records each
// statement; no Postgres.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  readCustomInput, addCustomItem, updateCustomItem, removeCustomItem, setCustomPhone, listCustomItems, customKindOf,
  customView, ITEMS_MAX, NAME_MAX
} from "./custom.mjs";
import { FileAlertInputError } from "./store.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = join(HERE, "..", "..", "..", "db", "migrations");
const ORG = "0f000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const ID = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const BIZ = "5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";
const TODAY = "2026-10-12";

const field = (fn) => {
  try { fn(); } catch (e) { assert.ok(e instanceof FileAlertInputError, String(e)); return e.field; }
  assert.fail("no error");
};

describe("readCustomInput — what a person typed, or which field is wrong", () => {
  const alert = { kind: "alert", name: "Pay rent", cadence: "monthly", day_of_month: 1, scope: "personal" };

  test("a monthly alert, a one-time alert and a weekly business bill read cleanly", () => {
    assert.deepEqual(readCustomInput(alert, { today: TODAY }), {
      kind: "alert", name: "Pay rent", amount_cents: null, cadence: "monthly", day_of_month: 1, start_on: null,
      scope: "personal", entity_id: null, phone_alert: true
    });
    assert.deepEqual(readCustomInput({ ...alert, cadence: "once", day_of_month: null, start_on: TODAY, amount_cents: 5000, phone_alert: false }, { today: TODAY }), {
      kind: "alert", name: "Pay rent", amount_cents: 5000, cadence: "once", day_of_month: null, start_on: TODAY,
      scope: "personal", entity_id: null, phone_alert: false
    });
    const bill = readCustomInput({ kind: "bill", name: "Office\trent", amount_cents: "120000", cadence: "weekly", start_on: "2026-01-06",
      scope: "business", entity_id: BIZ.toUpperCase() }, { today: TODAY });
    assert.equal(bill.name, "Office rent", "a tab is a space");
    assert.equal(bill.amount_cents, 120000, "whole cents from a string");
    assert.equal(bill.entity_id, BIZ, "the id is stored lower case");
    assert.equal(bill.day_of_month, null);
  });

  test("each wrong field is named, so the screen can say which one", () => {
    const bill = { kind: "bill", name: "Rent", amount_cents: 1000, cadence: "monthly", day_of_month: 1, scope: "personal" };
    for (const [over, name] of [
      [{ kind: undefined }, "kind"],
      [{ name: undefined }, "name"],
      [{ name: "\u0000 \n" }, "name"],
      [{ name: "a".repeat(NAME_MAX + 1) }, "name"],
      [{ amount_cents: undefined }, "amount_cents"],
      [{ amount_cents: 0 }, "amount_cents"],
      [{ amount_cents: "12.50" }, "amount_cents"],
      [{ amount_cents: 100_000_000_001 }, "amount_cents"],
      [{ cadence: "daily" }, "cadence"],
      [{ day_of_month: 0 }, "day_of_month"],
      [{ day_of_month: "1st" }, "day_of_month"],
      [{ cadence: "annual", start_on: "2026-13-01" }, "start_on"],
      [{ cadence: "annual", start_on: "2032-01-01" }, "start_on"],
      [{ cadence: "annual", start_on: "2014-01-01" }, "start_on"],
      [{ scope: "" }, "scope"],
      [{ entity_id: BIZ }, "entity_id"],
      [{ scope: "business", entity_id: 7 }, "entity_id"],
      [{ phone_alert: 1 }, "phone_alert"]
    ]) {
      assert.equal(field(() => readCustomInput({ ...bill, ...over }, { today: TODAY })), name, JSON.stringify(over));
    }
    assert.equal(field(() => readCustomInput({ ...alert, cadence: "weekly" }, { today: TODAY })), "cadence", "an alert never repeats weekly");
    assert.equal(field(() => readCustomInput({ ...alert, cadence: "once", day_of_month: null, start_on: "2026-10-11" }, { today: TODAY })),
      "start_on", "a one-time date that passed");
    assert.equal(readCustomInput({ ...bill, kind: "alert" }, { today: TODAY, kind: "bill" }).kind, "bill", "an update keeps the saved kind");
  });
});

/* A stub that records each statement and answers by its shape. */
function stubDb({ count = 0, entity = true, row = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const s = String(sql);
      calls.push({ sql: s, params });
      if (/FROM entities/.test(s)) return { rows: entity ? [{ id: params[0] }] : [] };
      if (/count\(\*\)/.test(s)) return { rows: [{ n: count }] };
      if (/^\s*INSERT INTO finance_custom_alerts/.test(s)) return { rows: [{ id: ID, kind: params[2], name: params[3] }] };
      if (/^\s*SELECT kind FROM finance_custom_alerts/.test(s)) return { rows: row ? [row] : [] };
      if (/^\s*UPDATE finance_custom_alerts/.test(s)) return { rows: row ? [{ id: ID, phone_alert: params[3], ...row }] : [] };
      if (/^\s*SELECT id, kind, name/.test(s)) return { rows: row ? [row] : [] };
      throw new Error(`unexpected sql: ${s.slice(0, 80)}`);
    }
  };
}
const INPUT = readCustomInput({ kind: "bill", name: "Office rent", amount_cents: 120000, cadence: "monthly", day_of_month: 1,
  scope: "business", entity_id: BIZ }, { today: TODAY });

describe("the store — scoped, checked, never deleted", () => {
  test("add checks the business is the client's own, counts the live rows, and inserts with org and client", async () => {
    const db = stubDb();
    const row = await addCustomItem(db, { orgId: ORG, clientId: CLIENT, input: INPUT, by: "staff" });
    assert.equal(row.id, ID);
    const [ent, count, ins] = db.calls;
    assert.match(ent.sql, /kind = 'business' AND archived_at IS NULL/);
    assert.deepEqual(ent.params, [BIZ, ORG, CLIENT]);
    assert.deepEqual(count.params, [ORG, CLIENT]);
    assert.deepEqual(ins.params.slice(0, 2), [ORG, CLIENT]);
    assert.equal(ins.params.at(-1), "staff");
  });

  test("a business that is not theirs is a 404, and the cap stops a new one", async () => {
    await assert.rejects(addCustomItem(stubDb({ entity: false }), { orgId: ORG, clientId: CLIENT, input: INPUT }),
      (e) => e.field === "entity_id" && e.status === 404);
    const full = stubDb({ count: ITEMS_MAX });
    await assert.rejects(addCustomItem(full, { orgId: ORG, clientId: CLIENT, input: INPUT }), (e) => e.field === "kind" && e.status === 400);
    assert.ok(!full.calls.some((c) => /INSERT/.test(c.sql)), "nothing inserted past the cap");
  });

  test("update, the phone switch and remove touch only this client's live row; a missing one is a 404", async () => {
    for (const run of [
      (db) => updateCustomItem(db, { orgId: ORG, clientId: CLIENT, id: ID, input: INPUT }),
      (db) => setCustomPhone(db, { orgId: ORG, clientId: CLIENT, id: ID, enabled: false }),
      (db) => removeCustomItem(db, { orgId: ORG, clientId: CLIENT, id: ID }),
      (db) => customKindOf(db, { orgId: ORG, clientId: CLIENT, id: ID })
    ]) {
      const ok = stubDb({ row: { kind: "bill" } });
      await run(ok);
      const write = ok.calls.at(-1);
      assert.match(write.sql, /WHERE id = \$1 AND org_id = \$2 AND client_id = \$3 AND archived_at IS NULL/);
      assert.deepEqual(write.params.slice(0, 3), [ID, ORG, CLIENT]);
      await assert.rejects(run(stubDb({ row: null })), (e) => e.status === 404 && e.field === "id");
    }
  });

  test("remove sets archived_at and nothing in the store deletes", async () => {
    const db = stubDb({ row: { kind: "alert" } });
    assert.deepEqual(await removeCustomItem(db, { orgId: ORG, clientId: CLIENT, id: ID }), { id: ID, removed: true });
    assert.match(db.calls[0].sql, /SET archived_at = now\(\)/);
    const code = readFileSync(join(HERE, "custom.mjs"), "utf8");
    assert.doesNotMatch(code, /\bDELETE\b/);
  });

  test("the list reads one client's live rows", async () => {
    const db = stubDb({ row: { id: ID, kind: "alert" } });
    await listCustomItems(db, { orgId: ORG, clientId: CLIENT });
    assert.match(db.calls[0].sql, /WHERE org_id = \$1 AND client_id = \$2 AND archived_at IS NULL/);
    assert.deepEqual(db.calls[0].params, [ORG, CLIENT]);
  });

  test("an id that is not a uuid never reaches the database", async () => {
    const db = stubDb({ row: { kind: "alert" } });
    await assert.rejects(removeCustomItem(db, { orgId: ORG, clientId: CLIENT, id: "1 OR 1=1" }), (e) => e.field === "id");
    await assert.rejects(setCustomPhone(db, { orgId: ORG, clientId: CLIENT, id: ID, enabled: "yes" }), (e) => e.field === "enabled");
    assert.equal(db.calls.length, 0);
  });
});

describe("customView — what the screen shows", () => {
  const sent = [{ subject_id: ID, about_on: "2026-10-14", state: "waiting" }];
  test("the next date, when the phone alert goes, and whether it is waiting", () => {
    const v = customView({ id: ID, kind: "alert", name: "Savings", amount_cents: null, cadence: "monthly", day_of_month: 14,
      start_on: null, scope: "personal", entity_id: null, phone_alert: true, created_by: "client" }, { today: TODAY, sent });
    assert.equal(v.next_on, "2026-10-14");
    assert.deepEqual(v.phone, { alert_on: TODAY, reason: null, sent: "waiting" });
    assert.equal(v.amount_cents, null, "no amount is null, never 0");
    const later = customView({ id: ID, kind: "bill", name: "Rent", amount_cents: "120000", cadence: "monthly", day_of_month: 1,
      scope: "business", entity_id: BIZ, phone_alert: true, created_by: "staff" }, { today: TODAY });
    assert.equal(later.amount_cents, 120000);
    assert.deepEqual(later.phone, { alert_on: "2026-10-29", reason: "not_yet", sent: null });
    assert.equal(later.added_by, "staff");
  });

  test("switched off: no alert day; a passed one-time date has no next date", () => {
    const off = customView({ id: ID, kind: "alert", name: "x", cadence: "monthly", day_of_month: 14, phone_alert: false }, { today: TODAY });
    assert.deepEqual(off.phone, { alert_on: null, reason: "phone_alert_off", sent: null });
    const gone = customView({ id: ID, kind: "alert", name: "x", cadence: "once", start_on: "2026-10-01", phone_alert: true }, { today: TODAY });
    assert.equal(gone.next_on, null);
    assert.equal(gone.phone.reason, "date_passed");
  });
});

describe("migration 583", () => {
  const FILE = "583_finance_custom_alerts.sql";
  const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");
  const code = SQL.replace(/--.*$/gm, "");
  test("it is number 583 and nothing else owns 583", () => {
    assert.deepEqual(readdirSync(MIGRATIONS).filter((f) => f.startsWith("583_")), [FILE]);
  });
  test("additive and re-runnable: no drop, delete, truncate or rewrite; every create is guarded", () => {
    assert.doesNotMatch(code, /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|POLICY)\b/i);
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(code, /\bTRUNCATE\b/i);
    assert.doesNotMatch(code, /\bUPDATE\s+\w+\s+SET\b/i);
    for (const m of code.matchAll(/CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\s+(?!IF NOT EXISTS)/gi)) assert.fail(`unguarded create: ${m[0]}`);
  });
  test("row security on and forced, one policy, and the app may read, add and change — never delete", () => {
    assert.match(code, /ALTER TABLE public\.finance_custom_alerts ENABLE ROW LEVEL SECURITY/);
    assert.match(code, /ALTER TABLE public\.finance_custom_alerts FORCE ROW LEVEL SECURITY/);
    assert.match(code, /CREATE POLICY finance_custom_alerts_app_all ON public\.finance_custom_alerts/);
    assert.match(code, /GRANT SELECT, INSERT, UPDATE ON public\.finance_custom_alerts TO fundhub_app/);
  });
  test("the database holds the shape: money is whole cents above zero; the schedule, the kind and the scope are checked", () => {
    assert.match(code, /amount_cents\s+bigint CHECK \(amount_cents IS NULL OR \(amount_cents > 0/);
    assert.match(code, /finance_custom_alerts_schedule_ck/);
    assert.match(code, /kind = 'bill' AND cadence IN \('weekly', 'biweekly', 'monthly', 'annual'\) AND amount_cents IS NOT NULL/);
    assert.match(code, /CHECK \(scope = 'business' OR entity_id IS NULL\)/);
    assert.match(code, /org_id\s+uuid NOT NULL REFERENCES orgs\(id\)/);
    assert.match(code, /client_id\s+uuid NOT NULL REFERENCES clients\(id\)/);
  });
});
