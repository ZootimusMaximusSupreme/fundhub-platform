import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-27-closer.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as MEET_TRANSCRIPT_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import { CHASE_CRON } from "../../workflows/contract-chaser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "bookings",
  "read/closer-call",
  "closer-call.html",
  "s-04-call-booked",
  "read/closer-now",
  "meet-transcript-sweeper",
  "s-05a-no-show-recovery",
  "present.html",
  "closer-deck",
  "read/closer-deck",
  "closer-dashboard.html",
  "call-outcomes",
  "read/call-outcomes",
  "s-offer-bucket",
  "contracts",
  "contracts.html",
  "contract-chaser",
  "contracts/sign",
  "payment-links"
];

const EXPECTED_GAP_IDS = [
  "s-04-call-booked",
  "meet-transcript-sweeper",
  "s-05a-no-show-recovery",
  "s-offer-bucket",
  "contract-chaser",
  "contracts/sign"
];

test("slice 27-closer: slice id and closer path checks in journey order", () => {
  assert.equal(SLICE_ID, "27-closer");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 27-closer: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
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

test("slice 27-closer: sweepers use live cron constants; gaps are registry and machine holes only", () => {
  assert.equal(MEET_TRANSCRIPT_CRON, "*/10 * * * *");
  assert.equal(CHASE_CRON, "0 10 * * *");

  const meet = CHECKS.find((r) => r.id === "meet-transcript-sweeper");
  const chaser = CHECKS.find((r) => r.id === "contract-chaser");
  assert.ok(meet && chaser);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  for (const row of [meet, chaser]) {
    assert.equal(row.alreadyInRegistry, false);
    assert.equal(row.machineId, null);
    assert.match(row.proof, /MACHINE_CHECKS/);
    assert.ok(!machineFiles.has(row.workflowFile));
  }

  for (const id of ["bookings", "present.html", "payment-links", "call-outcomes"]) {
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
