import test from "node:test";
import assert from "node:assert/strict";
import { gapChecks, COMPANY_CASH_INTEGRITY_SQL, HEALTHY_COMPANY_CASH_COUNTS } from "./gap-company-cash.mjs";
import { readCompanyCashTruth } from "../beats/lib/money-company-cash-truth.mjs";

const orgId = "0a000000-0000-4000-8000-000000000001";
test("daily and hourly company cash use the same query and verdict", async () => {
  const counts = { ...HEALTHY_COMPANY_CASH_COUNTS, linked_items_n: 1, accounts_n: 1,
    selected_n: 1, bad_paid_n: 1 };
  const read = (sql, params) => {
    assert.equal(sql, COMPANY_CASH_INTEGRITY_SQL);
    assert.deepEqual(params, [orgId]);
    return { rows: [counts] };
  };
  const daily = await gapChecks({ orgId, db: { query: read } });
  const hourly = await readCompanyCashTruth({ orgId, read });
  assert.deepEqual(daily, hourly);
  assert.equal(daily[0].status, "FAIL");
});

test("daily company cash fails closed without SQL", async () => {
  assert.equal((await gapChecks({ orgId }))[0].status, "FAIL");
  assert.equal((await gapChecks({ orgId, db: { query() { throw Error("not migrated"); } } }))[0].status, "FAIL");
});
