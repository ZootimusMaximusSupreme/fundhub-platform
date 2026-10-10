import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { CHECKS, SLICE_ID, gaps } from "./slice-24-agents.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const EXPECTED_IDS = [
  "ai-set-01-josh-setter",
  "ai-set-03-no-answer-cadence",
  "ai-set-04-3way-handoff",
  "bs-01-precall-launcher",
  "ar-collections",
  "bc-01-customer-responsiveness",
  "bc-02-customer-friction"
];

const WORKFLOW_FILES = {
  "ai-set-01-josh-setter": "ai-set-01-josh-setter.mjs",
  "ai-set-03-no-answer-cadence": "ai-set-03-no-answer-cadence.mjs",
  "ai-set-04-3way-handoff": "ai-set-04-3way-handoff.mjs",
  "bs-01-precall-launcher": "bs-01-precall-launcher.mjs",
  "ar-collections": "ar-collections.mjs",
  "bc-01-customer-responsiveness": "bc-01-customer-responsiveness.mjs",
  "bc-02-customer-friction": "bc-02-customer-friction.mjs"
};

test("slice 24-agents: slice id and seven agent workflows", () => {
  assert.equal(SLICE_ID, "24-agents");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 24-agents: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.equal(CHECKS.length, 7);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    if (row.alreadyInRegistry) {
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /^Add pulse registry row for workflow /);
    }
  }
});

test("slice 24-agents: red when the workflow id is not named in the pulse registry", () => {
  const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
  for (const row of CHECKS) {
    assert.equal(row.alreadyInRegistry, listed.has(row.id));
  }
  const missing = gaps();
  assert.deepEqual(missing, CHECKS.filter((row) => !row.alreadyInRegistry));
  assert.deepEqual(missing.map((row) => row.id), EXPECTED_IDS);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
    assert.notEqual(row.proof, "PASS");
  }
});

test("slice 24-agents: schedules match the workflow trigger and the slice never calls", () => {
  const sliceSrc = fs.readFileSync(path.join(HERE, "slice-24-agents.mjs"), "utf8");
  assert.doesNotMatch(sliceSrc, /placeCall|sendTemplated|twilio|bland-voice|createFunction/);

  for (const row of CHECKS) {
    const src = fs.readFileSync(
      path.join(HERE, "../../workflows", WORKFLOW_FILES[row.id]),
      "utf8"
    );
    const idPattern = row.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const schedulePattern = row.schedule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(src, new RegExp(`id:\\s*"${idPattern}"`));
    assert.match(src, new RegExp(`event:\\s*"${schedulePattern}"`));
  }

  const handoff = fs.readFileSync(
    path.join(HERE, "../../workflows/ai-set-04-3way-handoff.mjs"),
    "utf8"
  );
  const precall = fs.readFileSync(
    path.join(HERE, "../../workflows/bs-01-precall-launcher.mjs"),
    "utf8"
  );
  const collections = fs.readFileSync(
    path.join(HERE, "../../workflows/ar-collections.mjs"),
    "utf8"
  );
  assert.match(handoff, /event:\s*"booking\.rescheduled"/);
  assert.match(precall, /event:\s*"booking\.rescheduled"/);
  assert.match(collections, /event:\s*"payment\.received"/);
});
