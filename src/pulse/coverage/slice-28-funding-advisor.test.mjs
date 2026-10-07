import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-28-funding-advisor.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "dashboard/clients",
  "pipeline.html",
  "read/funding-rounds",
  "dashboard/client",
  "client-control-panel.html",
  "next-action-catch-up",
  "read/documents",
  "documents-upload",
  "documents.html",
  "read/lender-matches",
  "applications",
  "proxy/launch",
  "pipeline-cards",
  "f-07-funding-locked"
];

const EXPECTED_GAP_IDS = ["next-action-catch-up", "f-07-funding-locked"];

test("slice 28-funding-advisor: slice id and fulfillment path checks in journey order", () => {
  assert.equal(SLICE_ID, "28-funding-advisor");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 28-funding-advisor: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x .+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    if (row.workflowFile) {
      assert.ok(fs.existsSync(path.join(ROOT, row.workflowFile)), `${row.id} workflow file missing`);
    }
  }
});

test("slice 28-funding-advisor: next-action catch-up cron; gaps are registry and machine holes only", () => {
  assert.equal(CATCH_UP_CRON, "*/5 * * * *");

  const catchUp = CHECKS.find((r) => r.id === "next-action-catch-up");
  assert.ok(catchUp);
  assert.equal(catchUp.cron, CATCH_UP_CRON);
  assert.equal(catchUp.schedule, "5 minutes");

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.equal(catchUp.alreadyInRegistry, false);
  assert.equal(catchUp.machineId, null);
  assert.match(catchUp.proof, /MACHINE_CHECKS/);
  assert.ok(!machineFiles.has(catchUp.workflowFile));

  for (const id of ["dashboard/clients", "pipeline.html", "applications", "pipeline-cards"]) {
    const row = CHECKS.find((r) => r.id === id);
    assert.ok(row);
    assert.equal(row.alreadyInRegistry, true, id);
    assert.equal(row.proof, "PASS");
  }

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id),
    EXPECTED_GAP_IDS
  );
  for (const row of open) {
    assert.equal(row.alreadyInRegistry, false);
  }
});
