// Client journey (apply → pay → portal → docs → funding → repair) for the 7:00 a.m.
// pulse. Report only. Never auto-fix. Never text.
// A cron job is red after 3 times its schedule. A GET door is red when missing
// from PULSE_REGISTRY. Event workflows are red when their id is missing from the
// registry. Sweepers are red when they have no MACHINE_CHECKS row.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import {
  SWEEP_CRON as COMMAS_CRON,
  SOURCE_WORKFLOW as COMMAS_ID
} from "../../workflows/commas-inbox-drain.mjs";
import {
  SWEEP_CRON as CHECKOUT_EXPIRY_CRON,
  SOURCE_WORKFLOW as CHECKOUT_EXPIRY_ID
} from "../../workflows/paid-checkout-expiry-sweeper.mjs";
import {
  SWEEP_CRON as DOC_CHECK_RETRY_CRON
} from "../../workflows/doc-check-retry-sweeper.mjs";
import {
  SWEEP_CRON as DOCUMENT_VAULT_CHASE_CRON
} from "../../workflows/document-vault-chase.mjs";
import {
  SWEEP_CRON as DISPATCH_CRON,
  SOURCE_WORKFLOW as DISPATCH_ID
} from "../../workflows/message-dispatch-sweeper.mjs";
import {
  SWEEP_CRON as NUDGE_CRON,
  SOURCE_WORKFLOW as NUDGE_ID
} from "../../workflows/waypoint-nudge-sweeper.mjs";

export const SLICE_ID = "26-client-journey";

const DAILY = "daily";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const machineWorkflowFiles = new Set(MACHINE_CHECKS.map((row) => row.file));

function machineRowForWorkflowFile(workflowFile) {
  return MACHINE_CHECKS.find((row) => row.file === workflowFile) ?? null;
}

function door(id, schedule = DAILY) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route or desk key ${id} to PULSE_REGISTRY. Do not auto-fix from this pulse.`
  };
}

function workflow(id, schedule, note) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add pulse registry row for workflow ${id} (${note}). Do not auto-fix from this pulse.`
  };
}

function sweeper(id, workflowFile, cron, schedule) {
  const machine = machineRowForWorkflowFile(workflowFile);
  const alreadyInRegistry = machineWorkflowFiles.has(workflowFile);
  let proof;
  if (alreadyInRegistry && machine) {
    proof = `PASS — machine row ${machine.id} reads what ${id} leaves behind (${machine.watches}).`;
  } else {
    proof =
      `Add a MACHINE_CHECKS row in src/pulse/machine.mjs for ${workflowFile} ` +
      `(cron ${cron}). Do not auto-fix from this pulse.`;
  }
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    cron,
    workflowFile,
    machineId: machine?.id ?? null,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  // Apply — funnel survey and SLO roadmap widget
  door("public/survey-submit"),
  door("public/slo-interest"),
  door("public/slo-checkout"),
  door("public/slo-status"),
  workflow("s-01-new-lead-intake", "entry.captured", "event entry.captured"),
  workflow("s-02-incomplete-survey-nudge", "entry.captured", "event entry.captured"),
  // Pay — checkout till and payment inbox
  door("public/funnel-checkout"),
  door("payment-success.html"),
  sweeper(COMMAS_ID, "src/workflows/commas-inbox-drain.mjs", COMMAS_CRON, "1m"),
  sweeper(
    CHECKOUT_EXPIRY_ID,
    "src/workflows/paid-checkout-expiry-sweeper.mjs",
    CHECKOUT_EXPIRY_CRON,
    "hourly"
  ),
  workflow("slo-paid-form-nudge", "payment.received", "event payment.received"),
  // Portal — magic link, desk, and reads behind the client UI
  door("auth/magic-link"),
  door("auth/magic-link-verify"),
  door("portal-login.html"),
  door("client-portal.html"),
  door("progress.html"),
  door("read/portal-summary"),
  door("read/client-progress"),
  door("read/portal-contracts"),
  door("read/entitlements"),
  door("chat/portal-message"),
  door("content/welcome-video"),
  door("push/subscribe"),
  // Docs — upload, sign, and doc automation
  door("documents-upload"),
  door("documents-download"),
  door("documents.html"),
  door("contracts/sign"),
  workflow("doc-check", "docs.received", "event docs.received"),
  sweeper(
    "doc-check-retry-sweeper",
    "src/workflows/doc-check-retry-sweeper.mjs",
    DOC_CHECK_RETRY_CRON,
    "20 minutes"
  ),
  sweeper(
    "document-vault-chase",
    "src/workflows/document-vault-chase.mjs",
    DOCUMENT_VAULT_CHASE_CRON,
    DAILY
  ),
  workflow("s-doc-collection", "deposit.paid", "event deposit.paid — staff doc chase after deposit"),
  // Funding — soft pull and round automations
  door("finance/soft-pull"),
  door("soft-pull-approve"),
  door("soft-pull-approve.html"),
  workflow("f-01-funding-intake", "round.started", "event round.started"),
  workflow("f-03-round-submitted", "round.submitted", "event round.submitted"),
  workflow("f-04-round-approvals", "round.approved", "event round.approved"),
  workflow(
    "f-06-funding-conditions-missing-docs",
    "mail.response + docs.received",
    "events mail.response and docs.received — missing-docs gate"
  ),
  // Repair — enrolment, waypoints, and repair lane
  door("consent/capture"),
  door("paid-services"),
  door("waypoint-tick"),
  workflow("c-00-crs-soft-pull-request", "diagnostic.paid", "event diagnostic.paid"),
  workflow("slo-pack-delivery", "analysis.completed", "event analysis.completed — client pack"),
  workflow("c-05-pre-funding-review", "round.started", "event round.started — pre-funding review"),
  sweeper(NUDGE_ID, "src/workflows/waypoint-nudge-sweeper.mjs", NUDGE_CRON, "hourly"),
  sweeper(DISPATCH_ID, "src/workflows/message-dispatch-sweeper.mjs", DISPATCH_CRON, "5m")
];

/** Rows with no pulse watch yet (never edits registry or machine). */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
