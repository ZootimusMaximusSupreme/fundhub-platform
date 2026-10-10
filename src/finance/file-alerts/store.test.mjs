// The database half, against a stub connection: what is asked, and what is refused
// before anything is asked. The real SQL runs in store.pg.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  readSettings, setAlertEnabled, recentKeys, recordAlert, listAlerts, reserveState, clearReserve,
  setPromo, setStatementCloseDay, readCloseDay, assignedCsm, FileAlertInputError
} from "./store.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "22222222-2222-2222-2222-222222222222";
const CARD = "33333333-3333-3333-3333-333333333333";

function stub(answers = []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql).replace(/\s+/g, " ").trim(), params });
      const hit = answers.find((a) => a.when.test(String(sql)));
      return hit ? { rows: hit.rows } : { rows: [] };
    }
  };
}
const ownCard = (over = {}) => ({ when: /FROM bank_accounts WHERE id = \$1/, rows: [{ id: CARD, account_type: "credit", closed_at: null, name: "Visa", mask: "1111", ...over }] });

describe("settings", () => {
  test("a client with no row has every kind ON", async () => {
    const s = await readSettings(stub(), { orgId: ORG, clientId: CLIENT });
    assert.deepEqual(
      [s.payment_timing, s.promo_end, s.cash_reserve, s.new_credit, s.saved],
      [true, true, true, true, false]
    );
  });

  test("a saved row is read column by column", async () => {
    const s = await readSettings(stub([{ when: /FROM file_protection_settings/, rows: [{ payment_timing: true, promo_end: false, cash_reserve: true, new_credit: false, updated_by_kind: "staff" }] }]),
      { orgId: ORG, clientId: CLIENT });
    assert.deepEqual([s.promo_end, s.new_credit, s.saved, s.updated_by_kind], [false, false, true, "staff"]);
  });

  test("switching a kind off writes only that column, by org and client", async () => {
    const db = stub();
    await setAlertEnabled(db, { orgId: ORG, clientId: CLIENT, kind: "promo_end", enabled: false, by: "staff" });
    const write = db.calls[0];
    assert.match(write.sql, /INSERT INTO file_protection_settings \(org_id, client_id, promo_end, updated_by_kind\)/);
    assert.match(write.sql, /ON CONFLICT \(client_id\) DO UPDATE SET promo_end = EXCLUDED\.promo_end/);
    assert.doesNotMatch(write.sql, /payment_timing|cash_reserve|new_credit/, "no other kind is touched");
    assert.deepEqual(write.params, [ORG, CLIENT, false, "staff"]);
  });

  test("a kind from outside is looked up in a closed map — it never reaches the SQL text", async () => {
    const db = stub();
    for (const kind of ["promo_end; DROP TABLE clients", "", undefined, "payment timing", "constructor"]) {
      await assert.rejects(setAlertEnabled(db, { orgId: ORG, clientId: CLIENT, kind, enabled: true, by: "client" }),
        (e) => e instanceof FileAlertInputError && e.field === "kind");
    }
    await assert.rejects(setAlertEnabled(db, { orgId: ORG, clientId: CLIENT, kind: "new_credit", enabled: "yes", by: "client" }),
      (e) => e instanceof FileAlertInputError && e.field === "enabled");
    assert.equal(db.calls.length, 0, "nothing was asked of the database");
  });

  test("who changed it is 'client' unless it was staff", async () => {
    const db = stub();
    await setAlertEnabled(db, { orgId: ORG, clientId: CLIENT, kind: "cash_reserve", enabled: true, by: "someone-else" });
    assert.equal(db.calls[0].params[3], "client");
  });
});

describe("the alerts that went out", () => {
  test("recentKeys is scoped to org and client and a start date", async () => {
    const db = stub([{ when: /dedupe_key/, rows: [{ dedupe_key: "a" }, { dedupe_key: "b" }] }]);
    const keys = await recentKeys(db, { orgId: ORG, clientId: CLIENT, since: "2025-01-01T00:00:00.000Z" });
    assert.deepEqual([...keys].sort(), ["a", "b"]);
    assert.match(db.calls[0].sql, /WHERE org_id = \$1 AND client_id = \$2 AND created_at >= \$3/);
  });

  test("recordAlert is ON CONFLICT DO NOTHING and says whether it wrote", async () => {
    const wrote = stub([{ when: /INSERT INTO file_protection_alerts/, rows: [{ id: "row-1" }] }]);
    const dupe = stub();
    const row = {
      orgId: ORG, clientId: CLIENT, kind: "payment_timing", key: "fpa:pay:x:2026-10-15", bankAccountId: CARD, label: "Visa",
      threshold: 3, dueOn: "2026-10-15", body: "b", delivery: "text", messageId: "m1", sentAt: "2026-10-12T07:30:00.000Z", detail: { a: 1 }
    };
    assert.deepEqual(await recordAlert(wrote, row), { created: true, id: "row-1" });
    assert.deepEqual(await recordAlert(dupe, row), { created: false, id: null });
    assert.match(wrote.calls[0].sql, /ON CONFLICT DO NOTHING RETURNING id/);
    assert.equal(wrote.calls[0].params[13], "fpa:pay:x:2026-10-15");
    assert.equal(wrote.calls[0].params[14], JSON.stringify({ a: 1 }));
    assert.equal(wrote.calls[0].params[7], null, "no cash kind on a card alert");
  });

  test("the list brings dates back as text, newest first, capped", async () => {
    const db = stub();
    await listAlerts(db, { orgId: ORG, clientId: CLIENT, limit: 9999 });
    assert.match(db.calls[0].sql, /due_on::text AS due_on/);
    assert.match(db.calls[0].sql, /ORDER BY sent_at DESC/);
    assert.equal(db.calls[0].params[2], 200);
  });
});

describe("the cash cushion's memory", () => {
  test("reserveState reads the open alert and the number of drops per kind", async () => {
    const db = stub([{ when: /GROUP BY cash_kind/, rows: [
      { cash_kind: "personal", episodes: 2, open_id: "open-1" },
      { cash_kind: "business", episodes: 1, open_id: null }
    ] }]);
    const s = await reserveState(db, { orgId: ORG, clientId: CLIENT });
    assert.deepEqual(s.open.get("personal"), { id: "open-1" });
    assert.equal(s.open.has("business"), false);
    assert.equal(s.episodes.get("personal"), 2);
    assert.equal(s.episodes.get("business"), 1);
  });

  test("clearReserve only touches an OPEN cash alert, and says whether it did", async () => {
    const db = stub([{ when: /UPDATE file_protection_alerts/, rows: [{ id: "x" }] }]);
    assert.equal(await clearReserve(db, { orgId: ORG, id: "x", at: "2026-10-09T07:30:00.000Z" }), true);
    assert.match(db.calls[0].sql, /kind = 'cash_reserve' AND cleared_at IS NULL/);
    assert.equal(await clearReserve(stub(), { orgId: ORG, id: "x", at: "2026-10-09T07:30:00.000Z" }), false);
  });
});

describe("setPromo — one column group, never the whole cycle row", () => {
  test("a promo upserts the four promo columns and nothing else", async () => {
    const db = stub([ownCard(), { when: /INSERT INTO account_statement_cycles/, rows: [{ ends_on: "2026-12-06", promo_apr: "0.00000", promo_source: "staff", promo_set_at: "t" }] }]);
    const r = await setPromo(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06", aprFraction: 0, by: "staff" });
    const write = db.calls[1];
    assert.match(write.sql, /ON CONFLICT \(bank_account_id\) DO UPDATE SET promo_ends_on = EXCLUDED\.promo_ends_on, promo_apr = EXCLUDED\.promo_apr, promo_source = EXCLUDED\.promo_source, promo_set_at = EXCLUDED\.promo_set_at, updated_at = now\(\)/);
    for (const col of ["statement_close_day", "payment_due_day", "minimum_payment_cents", "last_statement", "raw"]) {
      assert.equal(write.sql.includes(col), false, `the promo write must not mention ${col}`);
    }
    // The cycle's own `source` (manual / provider) is left alone; only promo_source is set.
    assert.doesNotMatch(write.sql, /(?<![a-z_])source = /);
    assert.match(write.sql, /WHERE account_statement_cycles\.org_id = EXCLUDED\.org_id/);
    assert.deepEqual(write.params, [ORG, CLIENT, CARD, "2026-12-06", 0, "staff"]);
    assert.deepEqual(r, { cleared: false, promo: { ends_on: "2026-12-06", apr: 0, source: "staff", set_at: "t" } });
  });

  test("clearing updates an existing row and never makes one", async () => {
    const db = stub([ownCard()]);
    const r = await setPromo(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: null, by: "client" });
    assert.deepEqual(r, { cleared: true, promo: null });
    assert.match(db.calls[1].sql, /^UPDATE account_statement_cycles SET promo_ends_on = NULL, promo_apr = NULL, promo_source = NULL, promo_set_at = NULL/);
    assert.doesNotMatch(db.calls[1].sql, /INSERT/);
  });

  test("it is stamped 'client' unless staff made the change", async () => {
    const db = stub([ownCard(), { when: /INSERT INTO account_statement_cycles/, rows: [] }]);
    await setPromo(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06", aprFraction: null, by: "anyone" });
    assert.equal(db.calls[1].params[5], "client");
  });

  test("the card must be this client's own, open, and a credit card", async () => {
    await assert.rejects(setPromo(stub(), { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06" }),
      (e) => e instanceof FileAlertInputError && e.status === 404);
    await assert.rejects(setPromo(stub([ownCard({ account_type: "depository" })]), { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06" }),
      (e) => e.field === "account_id" && /credit card/.test(e.message));
    await assert.rejects(setPromo(stub([ownCard({ closed_at: "2026-10-01" })]), { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06" }),
      (e) => e.field === "account_id" && /closed/.test(e.message));
  });

  test("the ownership read is filtered on org AND client", async () => {
    const db = stub([ownCard(), { when: /INSERT/, rows: [] }]);
    await setPromo(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, endsOn: "2026-12-06" });
    assert.match(db.calls[0].sql, /WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/);
    assert.deepEqual(db.calls[0].params, [CARD, ORG, CLIENT]);
  });
});

describe("setStatementCloseDay", () => {
  test("a day upserts that one column", async () => {
    const db = stub([ownCard(), { when: /INSERT INTO account_statement_cycles/, rows: [{ statement_close_day: 12 }] }]);
    const r = await setStatementCloseDay(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, day: 12 });
    assert.deepEqual(r, { statement_close_day: 12 });
    assert.match(db.calls[1].sql, /DO UPDATE SET statement_close_day = EXCLUDED\.statement_close_day, updated_at = now\(\)/);
    assert.doesNotMatch(db.calls[1].sql, /payment_due_day|minimum_payment_cents|promo_/);
  });

  test("null clears the day on an existing row", async () => {
    const db = stub([ownCard()]);
    assert.deepEqual(await setStatementCloseDay(db, { orgId: ORG, clientId: CLIENT, accountId: CARD, day: null }), { statement_close_day: null });
    assert.match(db.calls[1].sql, /^UPDATE account_statement_cycles SET statement_close_day = NULL/);
  });

  test("readCloseDay takes a whole day of the month and nothing else", () => {
    assert.equal(readCloseDay(15), 15);
    assert.equal(readCloseDay("31"), 31);
    assert.equal(readCloseDay(null), null);
    assert.equal(readCloseDay(""), null);
    for (const bad of [0, 32, -1, 1.5, "abc", "15th"]) {
      assert.throws(() => readCloseDay(bad), (e) => e instanceof FileAlertInputError && e.field === "day", String(bad));
    }
  });
});

test("assignedCsm reads the client's own CSM, scoped by org", async () => {
  const db = stub([{ when: /assigned_csm_staff_id/, rows: [{ assigned_csm_staff_id: "staff-9" }] }]);
  assert.equal(await assignedCsm(db, { orgId: ORG, clientId: CLIENT }), "staff-9");
  assert.deepEqual(db.calls[0].params, [CLIENT, ORG]);
  assert.equal(await assignedCsm(stub(), { orgId: ORG, clientId: CLIENT }), null);
});
