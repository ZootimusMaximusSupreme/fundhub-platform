import { test } from "node:test";
import assert from "node:assert/strict";
import { gapChecks } from "./gap-invoice-checkout-retirement.mjs";

test("fee checkout tripwire is green only with no stale hosted link", async () => {
  const healthy = await gapChecks({ db: { query: async () => ({ rows: [{ stale_active: 0, stranded_expired: 0 }] }) } });
  assert.equal(healthy[0].status, "PASS");
  const stale = await gapChecks({ db: { query: async () => ({ rows: [{ stale_active: 1, stranded_expired: 0 }] }) } });
  assert.equal(stale[0].status, "FAIL");
  const failedDelete = await gapChecks({ db: { query: async () => ({ rows: [{ stale_active: 0, stranded_expired: 1 }] }) } });
  assert.equal(failedDelete[0].status, "FAIL");
});

test("a failed fee checkout read is skipped, never green", async () => {
  const rows = await gapChecks({ db: { query: async () => { throw new Error("table unavailable"); } } });
  assert.equal(rows[0].status, "skip");
});
