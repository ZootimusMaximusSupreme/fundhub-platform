import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-18-billing.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as BILLING_CRON } from "../../workflows/subscription-billing-sweeper.mjs";
import { SWEEP_CRON as EXPIRY_CRON } from "../../workflows/paid-checkout-expiry-sweeper.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 18-billing: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "18-billing");
  assert.equal(CHECKS.length, 2);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    assert.ok(fs.existsSync(path.join(ROOT, row.workflowFile)), `${row.id} workflow file missing`);
  }
});

test("slice 18-billing: hourly crons and both sweepers are MACHINE_CHECKS gaps", () => {
  const billing = CHECKS.find((r) => r.id === "subscription-billing-sweeper");
  const expiry = CHECKS.find((r) => r.id === "paid-checkout-expiry-sweeper");
  assert.ok(billing);
  assert.ok(expiry);
  assert.equal(billing.schedule, "hourly");
  assert.equal(expiry.schedule, "hourly");
  assert.equal(billing.cron, BILLING_CRON);
  assert.equal(expiry.cron, EXPIRY_CRON);
  assert.equal(billing.alreadyInRegistry, false);
  assert.equal(expiry.alreadyInRegistry, false);
  assert.equal(billing.machineId, null);
  assert.equal(expiry.machineId, null);
  assert.match(billing.proof, /MACHINE_CHECKS/);
  assert.match(expiry.proof, /MACHINE_CHECKS/);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.ok(!machineFiles.has("src/workflows/subscription-billing-sweeper.mjs"));
  assert.ok(!machineFiles.has("src/workflows/paid-checkout-expiry-sweeper.mjs"));

  const open = gaps();
  assert.deepEqual(open.map((r) => r.id).sort(), [
    "paid-checkout-expiry-sweeper",
    "subscription-billing-sweeper"
  ]);
});
