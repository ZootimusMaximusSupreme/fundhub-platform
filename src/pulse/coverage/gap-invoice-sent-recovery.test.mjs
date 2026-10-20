import { test } from "node:test";
import assert from "node:assert/strict";
import { gapChecks } from "./gap-invoice-sent-recovery.mjs";
import { RECOVERY_STUCK_SQL } from "../../workflows/invoice-sent-recovery-query.mjs";

test("fee invoice notice gap is green only with no aged unresolved invoice", async () => {
  let observed;
  const healthy = await gapChecks({ db: { query: async (sql) => {
    observed = sql;
    return { rows: [{ stuck: 0 }] };
  } } });
  assert.equal(observed, RECOVERY_STUCK_SQL);
  assert.equal(healthy[0].status, "PASS");
  const stuck = await gapChecks({ db: { query: async () => ({ rows: [{ stuck: 2 }] }) } });
  assert.equal(stuck[0].status, "FAIL");
  assert.match(stuck[0].detail, /2 aged fee invoices/);
});

test("unavailable fee invoice notice evidence never reports green", async () => {
  assert.equal((await gapChecks())[0].status, "skip");
  const failed = await gapChecks({ db: { query: async () => { throw new Error("no read"); } } });
  assert.equal(failed[0].status, "skip");
});
