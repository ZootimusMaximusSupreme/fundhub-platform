import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-12-messaging.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 12-messaging: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "12-messaging");
  assert.equal(CHECKS.length, 3);
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
  "message-dispatch-sweeper": "src/workflows/message-dispatch-sweeper.mjs",
  "waypoint-nudge-sweeper": "src/workflows/waypoint-nudge-sweeper.mjs",
  "commas-inbox-drain": "src/workflows/commas-inbox-drain.mjs"
};

test("slice 12-messaging: workflow files exist on disk", () => {
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
});

test("slice 12-messaging: none are in MACHINE_CHECKS yet — all three are gaps", () => {
  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  for (const file of Object.values(WORKFLOW_FILES)) {
    assert.ok(!machineFiles.has(file), `expected ${file} absent from MACHINE_CHECKS`);
  }
  for (const row of CHECKS) {
    assert.equal(row.alreadyInRegistry, false);
    assert.match(row.proof, /MACHINE_CHECKS/);
  }
  assert.deepEqual(
    gaps().map((r) => r.id),
    ["message-dispatch-sweeper", "waypoint-nudge-sweeper", "commas-inbox-drain"]
  );
});
