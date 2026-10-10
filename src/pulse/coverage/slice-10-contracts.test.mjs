import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-10-contracts.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { CHASE_CRON } from "../../workflows/contract-chaser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

test("slice 10-contracts: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(SLICE_ID, "10-contracts");
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

test("slice 10-contracts: chaser workflow exists; sign door and chaser are gaps", () => {
  const chaser = CHECKS.find((r) => r.id === "contract-chaser");
  const sign = CHECKS.find((r) => r.id === "contracts/sign");
  assert.ok(chaser);
  assert.ok(sign);
  assert.ok(fs.existsSync(path.join(ROOT, chaser.workflowFile)));
  assert.equal(chaser.cron, CHASE_CRON);
  assert.equal(chaser.schedule, "daily");
  assert.equal(chaser.alreadyInRegistry, false);
  assert.equal(chaser.machineId, null);
  assert.match(chaser.proof, /MACHINE_CHECKS/);

  assert.equal(sign.alreadyInRegistry, false);
  assert.match(sign.proof, /^Add route key contracts\/sign\./);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.ok(!machineFiles.has("src/workflows/contract-chaser.mjs"));

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id).sort(),
    ["contract-chaser", "contracts/sign"]
  );
});
