import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps, workflowInIndex, hiringRegistryDoorCount } from "./slice-11-hiring.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as BENCH_CRON } from "../../workflows/hiring-bench-sweeper.mjs";
import { SWEEP_CRON as OUTREACH_CRON } from "../../workflows/hiring-outreach-cadence.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const WORKFLOW_FILES = {
  "hiring-bench-sweeper": "src/workflows/hiring-bench-sweeper.mjs",
  "hiring-outreach-cadence": "src/workflows/hiring-outreach-cadence.mjs"
};

test("slice 11-hiring: registry lists hiring GET doors", () => {
  assert.ok(hiringRegistryDoorCount >= 7);
});

test("slice 11-hiring: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "11-hiring");
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

test("slice 11-hiring: workflow files exist and crons match", () => {
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
  const bench = CHECKS.find((r) => r.id === "hiring-bench-sweeper");
  const outreach = CHECKS.find((r) => r.id === "hiring-outreach-cadence");
  assert.ok(bench);
  assert.ok(outreach);
  assert.equal(bench.schedule, "daily");
  assert.equal(outreach.schedule, "30m");
  assert.equal(BENCH_CRON, "30 13 * * *");
  assert.equal(OUTREACH_CRON, "*/30 * * * *");
});

test("slice 11-hiring: both workflows are in index.mjs; neither is in MACHINE_CHECKS yet", () => {
  assert.equal(workflowInIndex("hiring-bench-sweeper"), true);
  assert.equal(workflowInIndex("hiring-outreach-cadence"), true);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  for (const file of Object.values(WORKFLOW_FILES)) {
    assert.ok(!machineFiles.has(file), `expected ${file} absent from MACHINE_CHECKS`);
  }

  for (const row of CHECKS) {
    assert.equal(row.alreadyInRegistry, false);
    assert.match(row.proof, /MACHINE_CHECKS/);
  }

  assert.deepEqual(gaps().map((r) => r.id).sort(), [
    "hiring-bench-sweeper",
    "hiring-outreach-cadence"
  ]);
});
