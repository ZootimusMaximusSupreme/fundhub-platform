import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-05-funnels.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 05-funnels: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "05-funnels");
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
  }
});

const WORKFLOW_FILES = {
  "clickfunnels-analytics-sweeper": "src/workflows/clickfunnels-analytics-sweeper.mjs",
  "clarity-insights-sweeper": "src/workflows/clarity-insights-sweeper.mjs"
};

test("slice 05-funnels: workflow files exist on disk", () => {
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
});

test("slice 05-funnels: ClickFunnels sweeper is in MACHINE_CHECKS; Clarity is a gap", () => {
  const cf = CHECKS.find((r) => r.id === "clickfunnels-analytics-sweeper");
  const clarity = CHECKS.find((r) => r.id === "clarity-insights-sweeper");
  assert.ok(cf);
  assert.ok(clarity);
  assert.equal(cf.alreadyInRegistry, true);
  assert.match(cf.proof, /clickfunnels-night-job/);
  assert.equal(clarity.alreadyInRegistry, false);
  assert.match(cf.proof, /^PASS/);
  assert.match(clarity.proof, /MACHINE_CHECKS/);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.ok(machineFiles.has("src/workflows/clickfunnels-analytics-sweeper.mjs"));
  assert.ok(!machineFiles.has("src/workflows/clarity-insights-sweeper.mjs"));

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id),
    ["clarity-insights-sweeper"]
  );
});
