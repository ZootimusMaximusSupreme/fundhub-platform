import test from "node:test";
import assert from "node:assert/strict";
import { gapChecks, STAFF_PAYOUT_INTEGRITY_SQL, HEALTHY_STAFF_PAYOUT_COUNTS, CHECK_IDS } from "./gap-staff-payout-account.mjs";
import { readStaffPayoutTruth } from "../beats/lib/money-staff-payout-truth.mjs";
const org = "0a000000-0000-4000-8000-000000000001";
const run = async counts => gapChecks({ orgId: org, db: { async query(sql, params) {
  assert.equal(sql, STAFF_PAYOUT_INTEGRITY_SQL); assert.deepEqual(params, [org]);
  return { rows: counts == null ? [] : [counts] };
} } });

test("saved staff destination proof uses one scoped SELECT and exposes no bank identifiers", async () => {
  assert.equal(CHECK_IDS[0], "staff-payout:destination-integrity");
  assert.match(STAFF_PAYOUT_INTEGRITY_SQL, /a\.org_id = \$1::uuid AND a\.status = 'active'/);
  assert.doesNotMatch(STAFF_PAYOUT_INTEGRITY_SQL, /\b(?:INSERT|UPDATE|DELETE|ALTER|GRANT|REVOKE|TRUNCATE)\b/i);
  for (const active_n of [0, 2]) {
    const rows = await run({ ...HEALTHY_STAFF_PAYOUT_COUNTS, active_n });
    assert.equal(rows[0].status, "PASS");
    assert.match(rows[0].detail, /does not prove bank ownership or a payment/);
    assert.equal(JSON.stringify(rows).includes(org), false);
  }
});

test("each corrupt owner, environment, missing-field or duplicate count stays red", async () => {
  for (const name of Object.keys(HEALTHY_STAFF_PAYOUT_COUNTS).filter(n => n !== "active_n")) {
    const rows = await run({ ...HEALTHY_STAFF_PAYOUT_COUNTS, active_n: 2, [name]: 1 });
    assert.equal(rows[0].status, "FAIL", name);
  }
});

test("missing or failed SQL cannot become a healthy staff payout destination", async () => {
  for (const counts of [null, {}, { ...HEALTHY_STAFF_PAYOUT_COUNTS, active_n: null },
    { ...HEALTHY_STAFF_PAYOUT_COUNTS, incomplete_n: "" }, { ...HEALTHY_STAFF_PAYOUT_COUNTS, wrong_owner_n: -1 }]) {
    assert.equal((await run(counts))[0].status, "FAIL");
  }
  assert.equal((await gapChecks({ orgId: org }))[0].status, "FAIL");
  assert.equal((await gapChecks({ orgId: org, db: { query() { throw new Error("read refused"); } } }))[0].status, "FAIL");
});

test("hourly and daily staff payout verdicts use identical query and counts", async () => {
  const counts = { ...HEALTHY_STAFF_PAYOUT_COUNTS, active_n: 1, wrong_owner_n: 1 };
  const daily = await run(counts);
  const hourly = await readStaffPayoutTruth({ orgId: org, read(sql, params) {
    assert.equal(sql, STAFF_PAYOUT_INTEGRITY_SQL); assert.deepEqual(params, [org]);
    return { rows: [counts] };
  } });
  assert.deepEqual(hourly, daily);
});
