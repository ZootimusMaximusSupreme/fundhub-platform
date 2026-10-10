import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  CHECKS,
  SLICE_ID,
  cronScheduleLabel,
  gaps,
  workflowInIndex
} from "./slice-09-documents.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";
import { SWEEP_CRON as DOCUMENT_VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";

test("slice 09-documents: ids, schedules, and redAfter are 3x schedule", () => {
  assert.equal(SLICE_ID, "09-documents");
  assert.ok(CHECKS.length >= 8);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.equal(typeof row.redAfter, "string");
    assert.match(row.redAfter, /^3x .+/);
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.equal(typeof row.alreadyInRegistry, "boolean");
    assert.equal(typeof row.proof, "string");
  }
});

test("slice 09-documents: document workflows are registered in index.mjs", () => {
  assert.equal(workflowInIndex("doc-check"), true);
  assert.equal(workflowInIndex("doc-check-retry-sweeper"), true);
  assert.equal(workflowInIndex("document-vault-chase"), true);
});

test("slice 09-documents: cron labels match the workflow modules", () => {
  assert.equal(cronScheduleLabel(DOC_CHECK_RETRY_CRON), "20 minutes");
  assert.equal(cronScheduleLabel(DOCUMENT_VAULT_CHASE_CRON), "daily");
});

test("slice 09-documents: gaps is empty when registry and index are complete", () => {
  assert.deepEqual(gaps(), []);
});

test("slice 09-documents: a workflow that is not in the bundled list is not registered", () => {
  assert.equal(workflowInIndex("not-a-real-workflow"), false);
  const row = CHECKS.find((r) => r.id === "doc-check");
  assert.equal(row.alreadyInRegistry, true);
});

test("slice 09-documents: reads no repo file at run time, so it loads on the server", () => {
  const code = fs.readFileSync(new URL("./slice-09-documents.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(code, /node:fs|readFileSync|readdirSync|existsSync/);
});

test("slice 09-documents: gaps lists rows that fail proof", () => {
  const sample = [
    { id: "x", schedule: "daily", redAfter: "3x daily", alreadyInRegistry: true, proof: "PASS" },
    { id: "y", schedule: "daily", redAfter: "3x daily", alreadyInRegistry: false, proof: "Add route key y." }
  ];
  assert.deepEqual(gaps(sample), [sample[1]]);
});
