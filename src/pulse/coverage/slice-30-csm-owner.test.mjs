import test from "node:test";
import assert from "node:assert/strict";

import {
  CHECKS,
  CSM_DOOR_IDS,
  OWNER_APPROVAL_DOOR_IDS,
  OWNER_DASHBOARD_DOOR_IDS,
  SALES_MANAGER_DASHBOARD_DOOR_IDS,
  SHARED_TASK_DOOR_IDS,
  SLICE_ID,
  gaps
} from "./slice-30-csm-owner.mjs";

const ALL_DOOR_IDS = [
  ...OWNER_DASHBOARD_DOOR_IDS,
  ...OWNER_APPROVAL_DOOR_IDS,
  ...SALES_MANAGER_DASHBOARD_DOOR_IDS,
  ...SHARED_TASK_DOOR_IDS,
  ...CSM_DOOR_IDS
];

test("slice 30-csm-owner: slice id and deduped door inventory", () => {
  assert.equal(SLICE_ID, "30-csm-owner");
  const ids = CHECKS.map((row) => row.id);
  assert.equal(ids.length, new Set(ids).size, "duplicate ids in CHECKS");
  assert.deepEqual([...ids].sort(), [...new Set(ALL_DOOR_IDS)].sort());
});

test("slice 30-csm-owner: every row has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(row.schedule, "daily");
    assert.equal(row.redAfter, "3x daily");
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    if (row.alreadyInRegistry) {
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /^Add pulse registry row for /);
      assert.match(row.proof, /Do not auto-fix from this slice/);
      assert.match(row.proof, /Never text/);
    }
  }
});

test("slice 30-csm-owner: role door groups each have a CHECKS row", () => {
  for (const groups of [
    OWNER_DASHBOARD_DOOR_IDS,
    OWNER_APPROVAL_DOOR_IDS,
    SALES_MANAGER_DASHBOARD_DOOR_IDS,
    SHARED_TASK_DOOR_IDS,
    CSM_DOOR_IDS
  ]) {
    for (const id of groups) {
      const row = CHECKS.find((c) => c.id === id);
      assert.ok(row, `missing CHECKS row for ${id}`);
    }
  }
});

test("slice 30-csm-owner: gaps lists every door not in the registry yet", () => {
  const missing = gaps();
  const expected = CHECKS.filter((row) => !row.alreadyInRegistry);
  assert.deepEqual(missing, expected);
});
