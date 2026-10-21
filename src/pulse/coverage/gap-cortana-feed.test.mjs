import { test } from "node:test";
import assert from "node:assert/strict";
import { gapChecks } from "./gap-cortana-feed.mjs";

test("Cortana feed tripwire is green only when every paid payment is in Cortana", async () => {
  const healthy = await gapChecks({ db: { query: async () => ({ rows: [{ unsent: 0, failing: 0 }] }) } });
  assert.equal(healthy[0].status, "PASS");
  const behind = await gapChecks({ db: { query: async () => ({ rows: [{ unsent: 1, failing: 0 }] }) } });
  assert.equal(behind[0].status, "FAIL");
  const failing = await gapChecks({ db: { query: async () => ({ rows: [{ unsent: 0, failing: 1 }] }) } });
  assert.equal(failing[0].status, "FAIL");
});

test("a failed Cortana feed read is skipped, never green", async () => {
  const rows = await gapChecks({ db: { query: async () => { throw new Error("table unavailable"); } } });
  assert.equal(rows[0].status, "skip");
});
