import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECKS,
  SLICE_ID,
  PAYOUT_RED_AFTER_MS,
  gaps,
  isRed
} from "./slice-17-affiliates.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as AF01_CRON } from "../../workflows/af-01-affiliate-drip.mjs";
import { PAYOUT_CRON } from "../../workflows/affiliate-payout-run.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "af-01-affiliate-drip",
  "af-02-referral-ownership-capture",
  "affiliate-payout-run"
];

const WORKFLOW_FILES = {
  "af-01-affiliate-drip": "src/workflows/af-01-affiliate-drip.mjs",
  "af-02-referral-ownership-capture": "src/workflows/af-02-referral-ownership-capture.mjs",
  "affiliate-payout-run": "src/workflows/affiliate-payout-run.mjs"
};

test("slice 17-affiliates: slice id and three affiliate jobs", () => {
  assert.equal(SLICE_ID, "17-affiliates");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 17-affiliates: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
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

test("slice 17-affiliates: workflow files exist and crons match modules", () => {
  assert.equal(AF01_CRON, "*/15 * * * *");
  assert.equal(PAYOUT_CRON, "0 3 1 * *");
  for (const [id, file] of Object.entries(WORKFLOW_FILES)) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${id} workflow file missing`);
  }
});

test("slice 17-affiliates: af-02 capture doors are in registry; crons are MACHINE_CHECKS gaps", () => {
  const af01 = CHECKS.find((r) => r.id === "af-01-affiliate-drip");
  const af02 = CHECKS.find((r) => r.id === "af-02-referral-ownership-capture");
  const payout = CHECKS.find((r) => r.id === "affiliate-payout-run");
  assert.ok(af01 && af02 && payout);

  assert.equal(af02.alreadyInRegistry, true);
  assert.match(af02.proof, /^PASS/);

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  assert.ok(!machineFiles.has(WORKFLOW_FILES["af-01-affiliate-drip"]));
  assert.ok(!machineFiles.has(WORKFLOW_FILES["affiliate-payout-run"]));
  assert.equal(af01.alreadyInRegistry, false);
  assert.equal(payout.alreadyInRegistry, false);
  assert.match(af01.proof, /MACHINE_CHECKS/);
  assert.match(payout.proof, /MACHINE_CHECKS/);

  assert.deepEqual(gaps().map((r) => r.id), ["af-01-affiliate-drip", "affiliate-payout-run"]);
});

test("slice 17-affiliates: isRed — registry gap or payout silent 3x monthly", () => {
  const payout = CHECKS.find((r) => r.id === "affiliate-payout-run");
  const af01 = CHECKS.find((r) => r.id === "af-01-affiliate-drip");
  const af02 = CHECKS.find((r) => r.id === "af-02-referral-ownership-capture");
  const now = new Date("2026-10-07T12:00:00Z");

  assert.equal(isRed(af01, { now }), true);
  assert.equal(isRed(af02, { now }), false);

  const recent = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  assert.equal(isRed({ ...payout, alreadyInRegistry: true }, { lastRunAt: recent, now }), false);

  const stale = new Date(now.getTime() - PAYOUT_RED_AFTER_MS - 1);
  assert.equal(isRed({ ...payout, alreadyInRegistry: true }, { lastRunAt: stale, now }), true);
});
