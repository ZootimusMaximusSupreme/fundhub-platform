// Capital Blueprint — Next Funding Sequence (staff-set ready date → closer task).
//
// The staff date WINS when it is set. When it is not, the file math suggests one
// (src/blueprint/next-sequence-plan.mjs computeNextSequenceDate) and the same
// closer alert goes out on that date (sweepSuggested, same file). One task per
// date or per finished sequence: see nextSequenceAlertKey.

import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { createTask } from "../lib/create-task.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";

export const NEXT_SEQUENCE_READY_DATE_KEY = "blueprint_next_sequence_ready_date";

export const SOURCE_WORKFLOW = "blueprint-next-funding-sequence";
export const SWEEP_CRON = "30 6 * * *"; // daily, after finance-os-pull sweeper

/** Parse YYYY-MM-DD; invalid → null. */
export function parseReadyDate(value) {
  const s = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : s;
}

/** Staff sets the date the file is ready for the next sequence of rounds. */
export async function setNextFundingSequenceReadyDate(db, {
  orgId,
  clientId,
  readyDate
} = {}) {
  if (!orgId || !clientId) return { ok: false, error: "missing_ids" };
  const parsed = parseReadyDate(readyDate);
  if (!parsed) return { ok: false, error: "invalid_ready_date" };
  const blueprint = await isCapitalBlueprintBuyer(db, { orgId, clientId });
  if (!blueprint) return { ok: false, error: "not_blueprint_buyer" };
  await mergeCustomFields(db, clientId, { [NEXT_SEQUENCE_READY_DATE_KEY]: parsed });
  return { ok: true, readyDate: parsed };
}

/** Clients whose ready date is today or earlier (UTC calendar day). */
export async function dueForNextSequenceAlert(db, { today = new Date() } = {}) {
  const day = today.toISOString().slice(0, 10);
  const r = await db.query(
    `SELECT c.id AS client_id, c.org_id,
            c.custom_fields->>$2 AS ready_date
       FROM clients c
      WHERE c.custom_fields->>$2 IS NOT NULL
        AND btrim(c.custom_fields->>$2) <> ''
        AND (c.custom_fields->>$2)::date <= $1::date`,
    [day, NEXT_SEQUENCE_READY_DATE_KEY]
  );
  return r.rows;
}

/** The closer task's title. The push after a sequence is "the next funding sequence". */
export function nextSequenceTitle(basis = "staff") {
  return basis === "suggested"
    ? "Next funding sequence — file is ready, close it (date from the file math)"
    : "Next funding sequence — file is ready, close it (date set by staff)";
}

/**
 * The task's dedupe key. It is also the task's `body` (createTask stores the key
 * there), so it must be the same every day.
 *   staff      one task per staff date.
 *   suggested  one task per finished sequence: keyed on the last funded round, not
 *              on the date, because a suggestion can move. A later funded round
 *              is a later sequence and earns its own alert.
 */
export function nextSequenceAlertKey({ clientId, basis = "staff", readyDate = null, alertKey = null }) {
  return basis === "suggested"
    ? `blueprint-next-sequence:${clientId}:after:${alertKey}`
    : `blueprint-next-sequence:${clientId}:${readyDate}`;
}

export async function createNextSequenceCloserTask(db, {
  orgId,
  clientId,
  readyDate,
  basis = "staff",
  alertKey = null
} = {}) {
  if (!orgId || !clientId || !readyDate) {
    return { created: false, reason: "missing_args" };
  }
  if (basis === "suggested" && !alertKey) return { created: false, reason: "missing_args" };
  const blueprint = await isCapitalBlueprintBuyer(db, { orgId, clientId });
  if (!blueprint) return { created: false, reason: "not_blueprint_buyer" };

  /* The body IS the dedupe key (createTask stores the key there). It used to be
     { readyDate, alertedAt: now }, which changed on every run, so the same client
     got a new task every day. A stable string makes a second run create nothing. */
  const key = nextSequenceAlertKey({ clientId, basis, readyDate, alertKey });
  return createTask(db, {
    orgId,
    clientId,
    title: nextSequenceTitle(basis),
    sourceWorkflow: SOURCE_WORKFLOW,
    assigneeRole: "closer",
    eventId: key,
    body: key
  });
}

/** One pass: alert closers for every due Blueprint client. Never throws whole pass. */
export async function sweep(db, { now = new Date() } = {}) {
  const tally = { checked: 0, created: 0, skipped: [], errored: [] };
  const rows = await dueForNextSequenceAlert(db, { today: now });
  tally.checked = rows.length;

  for (const row of rows) {
    try {
      const out = await createNextSequenceCloserTask(db, {
        orgId: row.org_id,
        clientId: row.client_id,
        readyDate: row.ready_date
      });
      if (out.created) tally.created += 1;
      else tally.skipped.push({ clientId: row.client_id, reason: out.reason || "not_created" });
    } catch (e) {
      tally.errored.push({ clientId: row.client_id, error: e?.message || String(e) });
    }
  }
  return tally;
}
