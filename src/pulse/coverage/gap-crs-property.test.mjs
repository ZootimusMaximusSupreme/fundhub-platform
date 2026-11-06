import test from "node:test";
import assert from "node:assert/strict";
import { gapChecks, PROPERTY_LEDGER_SQL, PROPERTY_LEDGER_COUNTS } from "./gap-crs-property.mjs";
import { readPropertyReportTruth } from "../beats/lib/crs-property-truth.mjs";

const orgId = "11111111-1111-4111-8111-111111111111";
const readCounts = counts => ({ orgId, db: { query(sql, params) {
  assert.equal(sql, PROPERTY_LEDGER_SQL); assert.deepEqual(params, [orgId]);
  return { rows: [counts] };
} } });

test("daily and hourly property integrity share the exact scoped read and verdict", async () => {
  const counts = { ...PROPERTY_LEDGER_COUNTS, rows_n: 1, receipt_n: 1 };
  const daily = await gapChecks(readCounts(counts));
  const hourly = await readPropertyReportTruth({ orgId, read: (sql, params) => readCounts(counts).db.query(sql, params) });
  assert.deepEqual(daily, hourly); assert.equal(daily[0].status, "FAIL");
});

test("missing reader, scope, schema or partial counts never become a healthy property ledger", async () => {
  assert.equal((await gapChecks({ orgId }))[0].status, "FAIL");
  assert.equal((await gapChecks({ db: { query() { throw Error("not reached"); } } }))[0].status, "FAIL");
  assert.equal((await gapChecks({ orgId, db: { query() { throw Error("missing table"); } } }))[0].status, "FAIL");
  for (const missing of Object.keys(PROPERTY_LEDGER_COUNTS)) {
    const counts = { ...PROPERTY_LEDGER_COUNTS }; delete counts[missing];
    assert.equal((await gapChecks(readCounts(counts)))[0].status, "FAIL", missing);
  }
  for (const invalid of [null, "", -1, 0.5, "bad", Infinity]) {
    assert.equal((await gapChecks(readCounts({ ...PROPERTY_LEDGER_COUNTS, rows_n: invalid })))[0].status, "FAIL");
  }
});

test("all recorded break families stay red with counts only", async () => {
  for (const key of Object.keys(PROPERTY_LEDGER_COUNTS).filter(k => k !== "rows_n")) {
    const result = await gapChecks(readCounts({ ...PROPERTY_LEDGER_COUNTS, rows_n: 1, [key]: 1 }));
    assert.equal(result[0].status, "FAIL", key); assert.match(result[0].detail, new RegExp(key+"=1"));
  }
  assert.equal((await gapChecks(readCounts({ ...PROPERTY_LEDGER_COUNTS, rows_n: 5001 })))[0].status, "FAIL");
});

test("empty and consistent saved rows do not claim a production order or equity", async () => {
  const empty = (await gapChecks(readCounts(PROPERTY_LEDGER_COUNTS)))[0];
  assert.equal(empty.status, "PASS"); assert.match(empty.detail, /no production report or client flow is proved/);
  const saved = (await gapChecks(readCounts({ ...PROPERTY_LEDGER_COUNTS, rows_n: 2 })))[0];
  assert.equal(saved.status, "PASS"); assert.match(saved.detail, /does not prove current equity/);
});
