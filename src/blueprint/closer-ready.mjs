// Capital Blueprint — CSM closing prep, then closer alert when the file is ready.
//
// Ready rule (spec §4.4 / §6): UnderwriteIQ fundable on the freshest credit file,
// client prep checklist closed (excluding no_new_credit — that row never auto-
// completes), CSM prep call task done, then one closer task.

import { createTask } from "../lib/create-task.mjs";
import { toBureaus } from "../underwrite/adapter.mjs";
import { computeUnderwrite } from "../underwrite/engine.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";
import { latestCreditFile } from "../waypoints/seed.mjs";
import { isCapitalBlueprintBuyer } from "./coach-exception.mjs";
import { vaultComplete, vaultLine } from "../finance/document-vault.mjs";

export const CSM_PREP_SOURCE = "blueprint-csm-prep";
export const CLOSER_READY_SOURCE = "blueprint-closer-ready";

export const CSM_PREP_TITLE = "Blueprint closing prep call";
export const CLOSER_READY_TITLE =
  "Blueprint client ready — close done-for-you funding";

/* Exported for FinanceOS "Ready to get funded" (src/finance/ready-to-fund.mjs),
   which opens this same prep call and reads it back by this key. */
export const PREP_CALL_DEDUPE = "blueprint-csm-prep-call";
const CLOSER_DEDUPE = "blueprint-closer-funding-ready";

/** Client-owned prep steps closed — every row except no_new_credit is done. */
export async function areBlueprintPrepStepsClosed(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE state IS DISTINCT FROM 'done')::int AS open_count
       FROM client_waypoints
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND COALESCE(verify_kind, '') <> 'no_new_credit'`,
    [orgId, clientId]
  );
  const { total, open_count: open } = r.rows[0] || {};
  return Number(total) > 0 && Number(open) === 0;
}

async function loadAssignedCsmStaffId(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT assigned_csm_staff_id
       FROM clients
      WHERE id = $1::uuid AND org_id = $2::uuid`,
    [clientId, orgId]
  );
  return r.rows[0]?.assigned_csm_staff_id || null;
}

/* THE DOCUMENT VAULT, AS A LINE ON THE TASK (Capital Blueprint B3).
   "The agent collects bank statements, tax returns and ID ahead of time, so the
   file is complete when the closer calls." So when the CSM prep call and the closer
   alert are opened, the person reading them is told, in one sentence, whether the
   vault is complete or what is still open. It is a note (tasks.detail, migration
   472), not part of the dedupe key: the key stays in `body`, so nothing here
   changes when a task is created, only what the person reads on it.

   A vault that cannot be read is "could not be checked", never "complete", and it
   never stops the alert: the closer is told either way. */
export async function vaultNote(db, { orgId, clientId, now = new Date(), env = process.env } = {}) {
  try {
    const result = await vaultComplete(db, { orgId, clientId, now, env });
    if (!result) return { line: null, vault: null };
    return {
      line: vaultLine(result),
      vault: { complete: result.complete, open: result.missing.length, summary: result.summary }
    };
  } catch (err) {
    return {
      line: vaultLine({ complete: null }),
      vault: { complete: null, error: String((err && err.message) || err).slice(0, 200) }
    };
  }
}

/* createTask with a note — falling back to the plain task when the note cannot be
   stored (a database that has not applied 472 has no tasks.detail). The alert
   matters more than its footnote. */
async function createTaskWithNote(db, spec, line) {
  if (!line) return createTask(db, spec);
  try {
    return { ...(await createTask(db, { ...spec, detail: line })), detail: line };
  } catch (err) {
    if (err && err.code === "42703") return createTask(db, spec);
    throw err;
  }
}

/** Fundable from freshest crs_results + tradelines, same path as closer cockpit. */
export async function loadBlueprintFundable(db, { orgId, clientId }) {
  const crs = await latestCreditFile(db, { orgId, clientId });
  if (!crs?.result) return { fundable: false, reason: "no_credit_file" };

  const [tradelines, liabilities, businesses, clientRow] = await Promise.all([
    db.query(
      `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT age_months FROM businesses
        WHERE client_id = $1 AND org_id = $2 ORDER BY created_at ASC`,
      [clientId, orgId]
    ),
    db.query(
      `SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    )
  ]);

  const adapter = toBureaus({
    tradelines: tradelines.rows,
    liabilities: liabilities.rows,
    crsResults: [crs],
    customFields: clientRow.rows[0]?.custom_fields || {},
    businesses: businesses.rows
  });
  const uw = applyStackedBusinessFunding(
    computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
    adapter.businessAges
  );
  return { fundable: uw.fundable === true, reason: uw.fundable ? "fundable" : "not_fundable" };
}

async function findTask(db, { clientId, sourceWorkflow, dedupeBody }) {
  const r = await db.query(
    `SELECT id, done FROM tasks
      WHERE client_id = $1::uuid
        AND source_workflow = $2
        AND body = $3
      LIMIT 1`,
    [clientId, sourceWorkflow, dedupeBody]
  );
  return r.rows[0] || null;
}

/**
 * CSM prep call — created when the file is fundable and prep steps are closed.
 * Idempotent (dedupeOn title would block a second round; event body is stable).
 */
export async function createBlueprintCsmPrepCallTask(db, {
  orgId, clientId, eventId = PREP_CALL_DEDUPE
} = {}) {
  if (!orgId || !clientId) return { created: false, reason: "missing_ids" };
  const assigneeStaffId = await loadAssignedCsmStaffId(db, { orgId, clientId });
  const { line } = await vaultNote(db, { orgId, clientId });
  return createTaskWithNote(db, {
    orgId,
    clientId,
    title: CSM_PREP_TITLE,
    sourceWorkflow: CSM_PREP_SOURCE,
    assigneeRole: "csm",
    assigneeStaffId,
    eventId,
    body: eventId,
    dedupeOn: "event"
  }, line);
}

export async function createBlueprintCloserReadyTask(db, {
  orgId, clientId, eventId = CLOSER_DEDUPE
} = {}) {
  if (!orgId || !clientId) return { created: false, reason: "missing_ids" };
  const { line } = await vaultNote(db, { orgId, clientId });
  return createTaskWithNote(db, {
    orgId,
    clientId,
    title: CLOSER_READY_TITLE,
    sourceWorkflow: CLOSER_READY_SOURCE,
    assigneeRole: "closer",
    eventId,
    body: eventId,
    dedupeOn: "event"
  }, line);
}

/**
 * Gate: fundable + prep steps closed → CSM prep task; after prep is done → closer task.
 *
 * @returns {Promise<object>} branch + task hints for logs/tests
 */
export async function evaluateBlueprintCloserReady(db, {
  orgId, clientId, triggerEventId = null
} = {}) {
  if (!orgId || !clientId) return { ok: false, reason: "missing_ids" };
  const blueprint = await isCapitalBlueprintBuyer(db, { orgId, clientId });
  if (!blueprint) return { ok: true, branch: "skip", reason: "not_blueprint_buyer" };

  const { fundable, reason: fundReason } = await loadBlueprintFundable(db, { orgId, clientId });
  if (!fundable) {
    return { ok: true, branch: "wait", reason: fundReason || "not_fundable" };
  }

  const prepClosed = await areBlueprintPrepStepsClosed(db, { orgId, clientId });
  if (!prepClosed) {
    return { ok: true, branch: "wait", reason: "prep_steps_open" };
  }

  let prepTask = await findTask(db, {
    clientId, sourceWorkflow: CSM_PREP_SOURCE, dedupeBody: PREP_CALL_DEDUPE
  });
  if (!prepTask) {
    const prepCreate = await createBlueprintCsmPrepCallTask(db, {
      orgId, clientId, eventId: PREP_CALL_DEDUPE
    });
    prepTask = await findTask(db, {
      clientId, sourceWorkflow: CSM_PREP_SOURCE, dedupeBody: PREP_CALL_DEDUPE
    });
    if (!prepTask || !prepTask.done) {
      return {
        ok: true,
        branch: "csm_prep_open",
        prepCreate,
        reason: "awaiting_csm_prep_call"
      };
    }
  } else if (!prepTask.done) {
    return { ok: true, branch: "csm_prep_open", reason: "awaiting_csm_prep_call" };
  }

  const closer = await createBlueprintCloserReadyTask(db, {
    orgId,
    clientId,
    eventId: triggerEventId || CLOSER_DEDUPE
  });
  return {
    ok: true,
    branch: closer.created ? "closer_alert" : "closer_already",
    closer,
    reason: closer.created ? "closer_task_created" : closer.reason
  };
}
