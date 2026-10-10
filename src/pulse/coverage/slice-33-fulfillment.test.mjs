import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import assert from "node:assert/strict";

import { CHECKS, SLICE_ID, cronScheduleLabel, gaps } from "./slice-33-fulfillment.mjs";
import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { JOBS } from "../heartbeats.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";
import { SWEEP_CRON as DOCUMENT_VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const EXPECTED_IDS = [
  "pipeline.html",
  "dashboard/clients",
  "dashboard/pipeline",
  "pipeline-cards",
  "read/funding-rounds",
  "client-control-panel.html",
  "dashboard/client",
  "next-action-catch-up",
  "documents.html",
  "read/documents",
  "documents-upload",
  "documents-download",
  "doc-check-retry-sweeper",
  "document-vault-chase",
  "s-doc-collection",
  "doc-check",
  "f-06-funding-conditions-missing-docs",
  "read/lender-matches",
  "applications",
  "proxy/launch",
  "inquiry-remover.html",
  "read/repair-cases",
  "repair/exceptions",
  "repair-stage-moves",
  "repair/generate",
  "repair/send",
  "repair.docs.complete",
  "repair-bureau-response-reader",
  "read/inquiry-cases",
  "inquiry-cases",
  "c-02-inquiry-created",
  "c-02b-inquiry-removal-requested",
  "c-03-inquiry-removed-resume-or-hold"
];

const HEARTBEAT_CRONS = {
  "next-action-catch-up": CATCH_UP_CRON,
  "doc-check-retry-sweeper": DOC_CHECK_RETRY_CRON,
  "document-vault-chase": DOCUMENT_VAULT_CHASE_CRON
};

const EXPECTED_GAP_IDS = [
  "s-doc-collection",
  "doc-check",
  "f-06-funding-conditions-missing-docs",
  "repair-stage-moves",
  "repair.docs.complete",
  "repair-bureau-response-reader",
  "c-02-inquiry-created",
  "c-02b-inquiry-removal-requested",
  "c-03-inquiry-removed-resume-or-hold"
];

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const heartbeatIds = new Set(JOBS.map((row) => row.job));
const machineIds = new Set(MACHINE_CHECKS.map((row) => row.id));

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test("slice 33-fulfillment: slice id and live steps in journey order", () => {
  assert.equal(SLICE_ID, "33-fulfillment");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
});

test("slice 33-fulfillment: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.deepEqual(Object.keys(row).sort(), [
      "alreadyInRegistry",
      "id",
      "proof",
      "redAfter",
      "schedule"
    ]);
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.match(row.redAfter, /^3x .+$/);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 0);
    if (row.alreadyInRegistry) {
      assert.equal(row.proof, "PASS");
    } else {
      assert.match(row.proof, /not on the morning pulse/);
      assert.match(row.proof, /Do not auto-fix from this pulse/);
      assert.match(row.proof, /Never text/);
      assert.match(row.proof, /Never mail/);
    }
  }
});

test("slice 33-fulfillment: desks and routes on the registry are not gaps", () => {
  const doorIds = [
    "pipeline.html",
    "dashboard/clients",
    "dashboard/pipeline",
    "pipeline-cards",
    "read/funding-rounds",
    "client-control-panel.html",
    "dashboard/client",
    "documents.html",
    "read/documents",
    "documents-upload",
    "documents-download",
    "read/lender-matches",
    "applications",
    "proxy/launch",
    "inquiry-remover.html",
    "read/repair-cases",
    "repair/exceptions",
    "repair/generate",
    "repair/send",
    "read/inquiry-cases",
    "inquiry-cases"
  ];
  for (const id of doorIds) {
    assert.equal(listed.has(id), true, `${id} missing from PULSE_REGISTRY`);
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, id);
    assert.equal(row.schedule, "daily");
    assert.equal(row.alreadyInRegistry, true, id);
    assert.equal(row.proof, "PASS");
  }
});

test("slice 33-fulfillment: cron jobs match their source clocks and heartbeats", () => {
  assert.equal(cronScheduleLabel("*/5 * * * *"), "5 minutes");
  assert.equal(cronScheduleLabel("*/20 * * * *"), "20 minutes");
  assert.equal(cronScheduleLabel("45 16 * * *"), "daily");
  for (const [id, cron] of Object.entries(HEARTBEAT_CRONS)) {
    assert.equal(heartbeatIds.has(id), true, `${id} missing from job heartbeats`);
    const row = CHECKS.find((c) => c.id === id);
    assert.ok(row, id);
    assert.equal(row.schedule, cronScheduleLabel(cron));
    assert.equal(row.alreadyInRegistry, true, id);
    assert.equal(row.proof, "PASS");
  }
  assert.match(read("src/workflows/next-action-catch-up.mjs"), /CATCH_UP_CRON = "\*\/5 \* \* \* \*"/);
  assert.match(read("src/workflows/doc-check-retry-sweeper.mjs"), /SWEEP_CRON = "\*\/20 \* \* \* \*"/);
  assert.match(read("src/workflows/document-vault-chase.mjs"), /SWEEP_CRON = "45 16 \* \* \*"/);
});

test("slice 33-fulfillment: event jobs match the journey files and are unwatched", () => {
  assert.match(read("src/workflows/s-doc-collection.mjs"), /\{ event: "deposit\.paid" \}/);
  assert.match(read("src/workflows/doc-check.mjs"), /\{ event: "docs\.received" \}/);
  assert.match(read("src/workflows/f-06-funding-conditions-missing-docs.mjs"), /\{ event: "mail\.response" \}/);
  assert.match(read("src/workflows/f-06-funding-conditions-missing-docs.mjs"), /\{ event: "docs\.received" \}/);
  assert.match(read("src/repair/register.mjs"), /"repair\.enrolled"/);
  assert.match(read("src/repair/handlers.mjs"), /moveRepairCard/);
  assert.match(read("src/repair/handlers.mjs"), /name === "repair\.docs\.complete"/);
  assert.match(read("src/repair/handlers.mjs"), /analyzeAndGenerate/);
  assert.match(read("src/workflows/repair-bureau-response.mjs"), /id: "repair-bureau-response-reader"/);
  assert.match(read("src/workflows/repair-bureau-response.mjs"), /\{ event: "docs\.received" \}/);
  assert.match(read("src/workflows/c-02-inquiry-created.mjs"), /\{ event: "analysis\.completed" \}/);
  assert.match(read("src/workflows/c-02b-inquiry-removal-requested.mjs"), /\{ event: "deposit\.paid" \}/);
  assert.match(read("src/workflows/c-03-inquiry-removed-resume-or-hold.mjs"), /\{ event: "inquiry\.removed" \}/);

  for (const id of EXPECTED_GAP_IDS) {
    assert.equal(listed.has(id), false, `${id} unexpectedly in PULSE_REGISTRY`);
    assert.equal(heartbeatIds.has(id), false, `${id} unexpectedly in job heartbeats`);
    assert.equal(machineIds.has(id), false, `${id} unexpectedly in MACHINE_CHECKS`);
  }
});

test("slice 33-fulfillment: gaps are the steps the morning pulse would miss", () => {
  const missing = gaps();
  assert.deepEqual(missing, CHECKS.filter((row) => !row.alreadyInRegistry));
  assert.deepEqual(missing.map((row) => row.id), EXPECTED_GAP_IDS);
  for (const row of missing) {
    assert.equal(row.alreadyInRegistry, false);
  }
});

test("slice 33-fulfillment: this file never texts or mails", () => {
  const src = read("src/pulse/coverage/slice-33-fulfillment.mjs");
  assert.match(src, /Never text\. Never mail\./);
  assert.doesNotMatch(src, /sendTemplated|mailBureauLetter|twilio|messages\.create/i);
});
