import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CHECKS, SLICE_ID, gaps } from "./slice-26-client-journey.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { SWEEP_CRON as COMMAS_CRON } from "../../workflows/commas-inbox-drain.mjs";
import { SWEEP_CRON as CHECKOUT_EXPIRY_CRON } from "../../workflows/paid-checkout-expiry-sweeper.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");

const EXPECTED_IDS = [
  "public/survey-submit",
  "public/slo-interest",
  "public/slo-checkout",
  "public/slo-status",
  "s-01-new-lead-intake",
  "s-02-incomplete-survey-nudge",
  "public/funnel-checkout",
  "payment-success.html",
  "commas-inbox-drain",
  "paid-checkout-expiry-sweeper",
  "slo-paid-form-nudge",
  "auth/magic-link",
  "auth/magic-link-verify",
  "portal-login.html",
  "client-portal.html",
  "progress.html",
  "read/portal-summary",
  "read/client-progress",
  "read/portal-contracts",
  "read/entitlements",
  "chat/portal-message",
  "content/welcome-video",
  "push/subscribe",
  "documents-upload",
  "documents-download",
  "documents.html",
  "contracts/sign",
  "doc-check",
  "doc-check-retry-sweeper",
  "document-vault-chase",
  "s-doc-collection",
  "finance/soft-pull",
  "soft-pull-approve",
  "soft-pull-approve.html",
  "f-01-funding-intake",
  "f-03-round-submitted",
  "f-04-round-approvals",
  "f-06-funding-conditions-missing-docs",
  "consent/capture",
  "paid-services",
  "waypoint-tick",
  "c-00-crs-soft-pull-request",
  "slo-pack-delivery",
  "c-05-pre-funding-review",
  "waypoint-nudge-sweeper",
  "message-dispatch-sweeper"
];

const EXPECTED_GAP_IDS = [
  "s-01-new-lead-intake",
  "s-02-incomplete-survey-nudge",
  "commas-inbox-drain",
  "paid-checkout-expiry-sweeper",
  "slo-paid-form-nudge",
  "contracts/sign",
  "doc-check",
  "doc-check-retry-sweeper",
  "document-vault-chase",
  "s-doc-collection",
  "f-01-funding-intake",
  "f-03-round-submitted",
  "f-04-round-approvals",
  "f-06-funding-conditions-missing-docs",
  "c-00-crs-soft-pull-request",
  "slo-pack-delivery",
  "c-05-pre-funding-review",
  "waypoint-nudge-sweeper",
  "message-dispatch-sweeper"
];

test("slice 26-client-journey: slice id and checks in journey order", () => {
  assert.equal(SLICE_ID, "26-client-journey");
  assert.deepEqual(CHECKS.map((row) => row.id), EXPECTED_IDS);
});

test("slice 26-client-journey: every check has id, schedule, redAfter, alreadyInRegistry, proof", () => {
  assert.ok(CHECKS.length > 0);
  for (const row of CHECKS) {
    assert.equal(typeof row.id, "string");
    assert.ok(row.id.length > 0);
    assert.equal(typeof row.schedule, "string");
    assert.ok(row.schedule.length > 0);
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

test("slice 26-client-journey: pay sweepers and gaps match registry and machine today", () => {
  assert.equal(COMMAS_CRON, "* * * * *");
  assert.equal(CHECKOUT_EXPIRY_CRON, "0 * * * *");

  const machineFiles = new Set(MACHINE_CHECKS.map((r) => r.file));
  for (const id of ["commas-inbox-drain", "paid-checkout-expiry-sweeper"]) {
    const row = CHECKS.find((r) => r.id === id);
    assert.ok(row);
    assert.equal(row.alreadyInRegistry, false);
    assert.match(row.proof, /MACHINE_CHECKS/);
    assert.ok(!machineFiles.has(row.workflowFile));
  }

  for (const id of [
    "public/slo-checkout",
    "client-portal.html",
    "read/client-progress",
    "documents-upload",
    "finance/soft-pull",
    "waypoint-tick",
    "portal-login.html",
    "progress.html"
  ]) {
    const row = CHECKS.find((r) => r.id === id);
    assert.ok(row, id);
    assert.equal(row.alreadyInRegistry, true, id);
    assert.equal(row.proof, "PASS");
  }

  const open = gaps();
  assert.deepEqual(
    open.map((r) => r.id),
    EXPECTED_GAP_IDS
  );
  for (const row of open) {
    assert.equal(row.alreadyInRegistry, false);
  }
});
