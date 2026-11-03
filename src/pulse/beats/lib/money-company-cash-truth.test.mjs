import test from "node:test";
import assert from "node:assert/strict";
import { CHECK_IDS, COMPANY_CASH_INTEGRITY_SQL, HEALTHY_COMPANY_CASH_COUNTS,
  readCompanyCashTruth } from "./money-company-cash-truth.mjs";

const orgId = "0a000000-0000-4000-8000-000000000001";
const probe = counts => readCompanyCashTruth({ orgId, read(sql, params) {
  assert.equal(sql, COMPANY_CASH_INTEGRITY_SQL);
  assert.deepEqual(params, [orgId]);
  return { rows: counts == null ? [] : [counts] };
} });

test("company cash truth is one scoped, read-only SQL aggregate", async () => {
  assert.deepEqual(CHECK_IDS, ["company-cash:integrity"]);
  assert.match(COMPANY_CASH_INTEGRITY_SQL, /org_id=\$1::uuid/g);
  assert.doesNotMatch(COMPANY_CASH_INTEGRITY_SQL, /\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|TRUNCATE)\b/i);
  const empty = (await probe(HEALTHY_COMPANY_CASH_COUNTS))[0];
  assert.equal(empty.status, "PASS");
  assert.match(empty.detail, /No company bank is linked/);
  assert.match(empty.detail, /no company cash balance or transfer readiness/i);
  const selected = (await probe({ ...HEALTHY_COMPANY_CASH_COUNTS, linked_items_n: 1, accounts_n: 1, selected_n: 1 }))[0];
  assert.equal(selected.status, "PASS");
  assert.match(selected.detail, /does not prove a live balance/);
});

test("company cash truth fails every corrupt count and multiple selected banks", async () => {
  for (const name of Object.keys(HEALTHY_COMPANY_CASH_COUNTS).filter(n => /^(bad_|wrong_|duplicate_)/.test(n))) {
    const result = (await probe({ ...HEALTHY_COMPANY_CASH_COUNTS, linked_items_n: 1, accounts_n: 1, selected_n: 1, [name]: 1 }))[0];
    assert.equal(result.status, "FAIL", name);
    assert.equal(JSON.stringify(result).includes(orgId), false);
  }
  assert.equal((await probe({ ...HEALTHY_COMPANY_CASH_COUNTS, selected_n: 2 }))[0].status, "FAIL");
});

test("missing reader, SQL and malformed counts cannot report healthy company cash", async () => {
  for (const counts of [null, {}, { ...HEALTHY_COMPANY_CASH_COUNTS, bad_paid_n: "" },
    { ...HEALTHY_COMPANY_CASH_COUNTS, selected_n: -1 },
    { ...HEALTHY_COMPANY_CASH_COUNTS, accounts_n: "NaN" }]) {
    assert.equal((await probe(counts))[0].status, "FAIL");
  }
  assert.equal((await readCompanyCashTruth({ orgId }))[0].status, "FAIL");
  assert.equal((await readCompanyCashTruth({ orgId, read() { throw Error("SQL failed"); } }))[0].status, "FAIL");
});
