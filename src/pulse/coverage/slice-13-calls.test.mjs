import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, INQUIRY_CALL_CRON, SLICE_ID, gaps } from "./slice-13-calls.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as MEET_TRANSCRIPT_CRON } from "../../workflows/meet-transcript-sweeper.mjs";
import { BLAKE_LEAD_CRON } from "../../workflows/blake-lead-watch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 13-calls: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "13-calls");
  assert.equal(CHECKS.length, 4);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
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

test("slice 13-calls: cron constants match workflow files", () => {
  assert.equal(MEET_TRANSCRIPT_CRON, "*/10 * * * *");
  assert.equal(BLAKE_LEAD_CRON, "*/5 * * * *");
  assert.equal(INQUIRY_CALL_CRON, "*/15 * * * *");
  const inquirySrc = fs.readFileSync(path.join(ROOT, "src/workflows/inquiry-call-sweeper.mjs"), "utf8");
  assert.match(inquirySrc, /\{ cron: "\*\/15 \* \* \* \*" \}/);
});

test("slice 13-calls: sweepers are MACHINE_CHECKS gaps; bookings is in PULSE_REGISTRY", () => {
  const meet = CHECKS.find((r) => r.id === "meet-transcript-sweeper");
  const blake = CHECKS.find((r) => r.id === "blake-lead-watch");
  const inquiry = CHECKS.find((r) => r.id === "inquiry-call-sweeper");
  const bookings = CHECKS.find((r) => r.id === "bookings");
  assert.ok(meet && blake && inquiry && bookings);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  for (const row of [meet, blake, inquiry]) {
    assert.equal(row.alreadyInRegistry, false);
    assert.equal(row.machineId, null);
    assert.match(row.proof, /MACHINE_CHECKS/);
    assert.ok(!machineFiles.has(row.workflowFile));
  }

  assert.equal(bookings.alreadyInRegistry, true);
  assert.match(bookings.proof, /^PASS/);

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id).sort(),
    ["blake-lead-watch", "inquiry-call-sweeper", "meet-transcript-sweeper"]
  );
});
