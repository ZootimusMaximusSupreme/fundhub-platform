// Alerts bundle store — every read is scoped to the org AND the client, demo rows
// never count, and the one write is the three switches. A fake connection records
// each query; no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import * as store from "./bundle-store.mjs";
import { FileAlertInputError } from "./store.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";

function fakeConn(rowsFor = () => []) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: rowsFor(sql, params) };
    }
  };
}

describe("every read is pinned to one org and one client", () => {
  const reads = [
    ["readBundleSettings", (c) => store.readBundleSettings(c, { orgId: ORG, clientId: CLIENT })],
    ["fundedState", (c) => store.fundedState(c, { orgId: ORG, clientId: CLIENT })],
    ["listBusinesses", (c) => store.listBusinesses(c, { orgId: ORG, clientId: CLIENT })],
    ["businessPulls", (c) => store.businessPulls(c, { orgId: ORG, clientId: CLIENT })],
    ["openedBankAccounts", (c) => store.openedBankAccounts(c, { orgId: ORG, clientId: CLIENT })],
    ["openStepCount", (c) => store.openStepCount(c, { orgId: ORG, clientId: CLIENT })],
    ["weekTransactions", (c) => store.weekTransactions(c, { orgId: ORG, clientId: CLIENT, from: "2026-11-02", to: "2026-11-08" })],
    ["bundleAlerts", (c) => store.bundleAlerts(c, { orgId: ORG, clientId: CLIENT })]
  ];
  for (const [name, run] of reads) {
    test(name, async () => {
      const conn = fakeConn();
      await run(conn);
      assert.equal(conn.calls.length, 1);
      const { sql, params } = conn.calls[0];
      assert.ok(params.includes(ORG) && params.includes(CLIENT), `${name} binds both ids`);
      assert.match(sql, /org_id\s*=\s*\$\d/);
      assert.match(sql, /client_id\s*=\s*\$\d/);
      assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i, `${name} only reads`);
    });
  }
});

test("demo funding and demo pulls never count", async () => {
  const conn = fakeConn();
  await store.fundedState(conn, { orgId: ORG, clientId: CLIENT });
  await store.businessPulls(conn, { orgId: ORG, clientId: CLIENT });
  assert.match(conn.calls[0].sql, /f\.is_demo IS NOT TRUE AND a\.is_demo IS NOT TRUE/);
  assert.match(conn.calls[0].sql, /a\.approval_excluded_at IS NULL/);
  assert.match(conn.calls[1].sql, /is_demo IS NOT TRUE/);
});

test("fundedState: one confirmed approval is funded; none is not", async () => {
  assert.deepEqual(await store.fundedState(fakeConn(() => [{ approvals: 2 }]), { orgId: ORG, clientId: CLIENT }), { funded: true, approvals: 2 });
  assert.deepEqual(await store.fundedState(fakeConn(() => [{ approvals: 0 }]), { orgId: ORG, clientId: CLIENT }), { funded: false, approvals: 0 });
});

test("the week's rows are read a few days either side, so an own-account move is seen whole", async () => {
  const conn = fakeConn();
  await store.weekTransactions(conn, { orgId: ORG, clientId: CLIENT, from: "2026-11-02", to: "2026-11-08" });
  assert.deepEqual(conn.calls[0].params.slice(2), ["2026-10-30", "2026-11-11"]);
  assert.match(conn.calls[0].sql, /is_pending = false/);
});

describe("the switches", () => {
  test("no row means every switch is on", async () => {
    assert.deepEqual(await store.readBundleSettings(fakeConn(), { orgId: ORG, clientId: CLIENT }),
      { card_over_10: true, business_credit: true, weekly_money: true, saved: false });
  });

  test("a saved off stays off", async () => {
    const conn = fakeConn(() => [{ card_over_10: true, business_credit: false, weekly_money: true }]);
    assert.equal((await store.readBundleSettings(conn, { orgId: ORG, clientId: CLIENT })).business_credit, false);
  });

  test("one switch writes one column of file_protection_settings, stamped with who", async () => {
    const conn = fakeConn();
    await store.setBundleAlertEnabled(conn, { orgId: ORG, clientId: CLIENT, kind: "weekly_money", enabled: false, by: "staff" });
    const write = conn.calls[0];
    assert.match(write.sql, /INSERT INTO file_protection_settings \(org_id, client_id, weekly_money, updated_by_kind\)/);
    assert.match(write.sql, /SET weekly_money = EXCLUDED\.weekly_money/);
    assert.match(write.sql, /WHERE file_protection_settings\.org_id = EXCLUDED\.org_id/);
    assert.deepEqual(write.params, [ORG, CLIENT, false, "staff"]);
  });

  test("a kind from outside never reaches SQL — not even one every object has", async () => {
    for (const kind of ["payment_timing", "constructor", "__proto__", "weekly_money; DROP TABLE x"]) {
      const conn = fakeConn();
      await assert.rejects(store.setBundleAlertEnabled(conn, { orgId: ORG, clientId: CLIENT, kind, enabled: true }), FileAlertInputError);
      assert.equal(conn.calls.length, 0, kind);
    }
    await assert.rejects(store.setBundleAlertEnabled(fakeConn(), { orgId: ORG, clientId: CLIENT, kind: "card_over_10", enabled: "yes" }), FileAlertInputError);
  });
});
