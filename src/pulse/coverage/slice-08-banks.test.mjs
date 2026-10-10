import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-08-banks.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 08-banks: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "08-banks");
  assert.equal(CHECKS.length, 5);
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
  }
});

const WORKFLOW_FILES = {
  "plaid-transactions-sweeper": "src/workflows/plaid-transactions-sweeper.mjs",
  "merchant-pull-sweeper": "src/workflows/merchant-pull-sweeper.mjs"
};

test("slice 08-banks: workflow files exist on disk", () => {
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
});

test("slice 08-banks: sync doors are in the registry; both sweepers are gaps", () => {
  const plaid = CHECKS.find((r) => r.id === "plaid-transactions-sweeper");
  const merchant = CHECKS.find((r) => r.id === "merchant-pull-sweeper");
  assert.ok(plaid);
  assert.ok(merchant);
  assert.equal(plaid.alreadyInRegistry, false);
  assert.equal(merchant.alreadyInRegistry, false);
  assert.match(plaid.proof, /MACHINE_CHECKS/);
  assert.match(merchant.proof, /MACHINE_CHECKS/);

  for (const id of ["banking/sync-accounts", "banking/sync-liabilities", "banking/sync-transactions"]) {
    const row = CHECKS.find((r) => r.id === id);
    assert.ok(row, id);
    assert.equal(row.alreadyInRegistry, true);
    assert.equal(row.proof, "PASS");
  }

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.ok(!machineFiles.has("src/workflows/plaid-transactions-sweeper.mjs"));
  assert.ok(!machineFiles.has("src/workflows/merchant-pull-sweeper.mjs"));

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id),
    ["plaid-transactions-sweeper", "merchant-pull-sweeper"]
  );
});
