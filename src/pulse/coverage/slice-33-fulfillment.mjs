// Staff fulfillment for the 7:00 a.m. pulse. Report only. Never auto-fix.
// Never text. Never mail.
//
// Fulfillment means staff can finish the job:
//   funding queue → next action → docs → apply
//   repair queue → letters → inquiry case
//
// Journeys: docs/journeys/funding-round-flow.md (columns, documents hold,
// Client Control Panel), docs/journeys/role-funding-advisor-intended.md,
// docs/journeys/repair-floor-flow.md (Generate), docs/journeys/repair-letter-send-actual.md
// (Send is a human click), docs/journeys/repair-documents-actual.md,
// docs/journeys/role-inquiry-remover-intended.md (Specialist desk).
//
// A desk or route is on the morning pulse when its key is in PULSE_REGISTRY.
// A cron job is on the morning pulse when src/pulse/heartbeats.mjs lists it
// (the daily pulse calls checkJobHeartbeats) or MACHINE_CHECKS names it.
// An event job or in-process handler is red when none of those watch it.
// Phone inquiry dials stay off this slice: the specialist journey says that
// work is on hold.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import { MACHINE_CHECKS } from "../machine.mjs";
import { JOBS } from "../heartbeats.mjs";
import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";
import { SWEEP_CRON as DOC_CHECK_RETRY_CRON } from "../../workflows/doc-check-retry-sweeper.mjs";
import { SWEEP_CRON as DOCUMENT_VAULT_CHASE_CRON } from "../../workflows/document-vault-chase.mjs";

export const SLICE_ID = "33-fulfillment";

const DAILY = "daily";

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
const heartbeatIds = new Set(JOBS.map((row) => row.job));
const machineIds = new Set(MACHINE_CHECKS.map((row) => row.id));

/** Human schedule label. Matches the 3× red window wording. */
export function cronScheduleLabel(cron) {
  const every = /^\*\/(\d+) \* \* \* \*$/.exec(String(cron || "").trim());
  if (every) return `${every[1]} minutes`;
  if (/^\d{1,2} \d{1,2} \* \* \*$/.test(String(cron || "").trim())) return DAILY;
  return String(cron || "unknown").trim() || "unknown";
}

function onMorningPulse(id) {
  return listed.has(id) || heartbeatIds.has(id) || machineIds.has(id);
}

function door(id) {
  const alreadyInRegistry = listed.has(id);
  return {
    id,
    schedule: DAILY,
    redAfter: `3x ${DAILY}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add route or desk key ${id} to PULSE_REGISTRY. Do not auto-fix from this pulse. Never text. Never mail.`
  };
}

function cronJob(id, cron) {
  const schedule = cronScheduleLabel(cron);
  const alreadyInRegistry = onMorningPulse(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add ${id} to the morning pulse job list (cron ${cron}). Do not auto-fix from this pulse. Never text. Never mail.`
  };
}

function eventJob(id, schedule, missingProof) {
  const alreadyInRegistry = onMorningPulse(id);
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof: alreadyInRegistry ? "PASS" : missingProof
  };
}

const NEVER = "Do not auto-fix from this pulse. Never text. Never mail.";

export const CHECKS = [
  // Funding queue — pipeline board. funding-round-flow.md columns.
  door("pipeline.html"),
  door("dashboard/clients"),
  door("dashboard/pipeline"),
  door("pipeline-cards"),
  door("read/funding-rounds"),

  // Next action — Client Control Panel plus the catch-up clock.
  door("client-control-panel.html"),
  door("dashboard/client"),
  cronJob("next-action-catch-up", CATCH_UP_CRON),

  // Docs — vault doors, then the jobs that set and clear the funding hold.
  door("documents.html"),
  door("read/documents"),
  door("documents-upload"),
  door("documents-download"),
  cronJob("doc-check-retry-sweeper", DOC_CHECK_RETRY_CRON),
  cronJob("document-vault-chase", DOCUMENT_VAULT_CHASE_CRON),
  eventJob(
    "s-doc-collection",
    "deposit.paid",
    "s-doc-collection (deposit.paid) is not on the morning pulse. If it stops, the documents hold is never written and Collect Documents is never set. " +
      NEVER
  ),
  eventJob(
    "doc-check",
    "docs.received",
    "doc-check (docs.received) is not on the morning pulse. If it stops, uploaded IDs stay unread, the funding hold never clears, and repair letters have no proved name. The retry sweeper only replays rows this job already queued. " +
      NEVER
  ),
  eventJob(
    "f-06-funding-conditions-missing-docs",
    "mail.response + docs.received",
    "f-06-funding-conditions-missing-docs is not on the morning pulse. If it stops, a bank ask for more documents never becomes Collect Documents. " +
      NEVER
  ),

  // Apply — match list, application row, proxy door. The pulse never launches a session.
  door("read/lender-matches"),
  door("applications"),
  door("proxy/launch"),

  // Repair queue — Specialist desk, list, stuck files. Stage moves are in-process.
  door("inquiry-remover.html"),
  door("read/repair-cases"),
  door("repair/exceptions"),
  eventJob(
    "repair-stage-moves",
    "in-process",
    "Repair queue stage moves (src/repair/register.mjs on repair events, src/repair/handlers.mjs moveRepairCard) are not on the morning pulse. The Specialist desk can still load while a file never leaves intake. " +
      NEVER
  ),

  // Letters — Generate and Send are human clicks. Auto-build and bureau read are not watched.
  door("repair/generate"),
  door("repair/send"),
  eventJob(
    "repair.docs.complete",
    "repair.docs.complete",
    "Letter build on repair.docs.complete (src/repair/handlers.mjs analyzeAndGenerate) is not on the morning pulse. It mails nothing. Staff Generate is a separate door. If this handler stops, a paid repair file can sit with zero letters. " +
      NEVER
  ),
  eventJob(
    "repair-bureau-response-reader",
    "docs.received",
    "repair-bureau-response-reader (docs.received) is not on the morning pulse. If it stops, a bureau answer never moves the repair file. " +
      NEVER
  ),

  // Inquiry case — list and write doors. The jobs that open and close a case are events.
  door("read/inquiry-cases"),
  door("inquiry-cases"),
  eventJob(
    "c-02-inquiry-created",
    "analysis.completed",
    "c-02-inquiry-created (analysis.completed) is not on the morning pulse. If it stops, new inquiries never land on the specialist queue, and the desk still looks up. " +
      NEVER
  ),
  eventJob(
    "c-02b-inquiry-removal-requested",
    "deposit.paid",
    "c-02b-inquiry-removal-requested (deposit.paid) is not on the morning pulse. If it stops, a paid inquiry case is never queued. " +
      NEVER
  ),
  eventJob(
    "c-03-inquiry-removed-resume-or-hold",
    "inquiry.removed",
    "c-03-inquiry-removed-resume-or-hold (inquiry.removed) is not on the morning pulse. If it stops, a closed inquiry case never resumes or holds funding. " +
      NEVER
  )
];

/** Rows the morning pulse would not notice if they broke. */
export function gaps(checks = CHECKS) {
  return checks.filter((row) => !row.alreadyInRegistry);
}
