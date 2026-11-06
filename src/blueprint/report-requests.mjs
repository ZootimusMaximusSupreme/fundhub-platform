import { runCrsPull } from "../finance/crs-pull.mjs";
import { systemPullUsesSimulation } from "../finance/finance-os-pull-fulfil.mjs";
import { runBlueprintMonthlyPullAftercare } from "./monthly-pull-aftercare.mjs";
import { createTask } from "../lib/create-task.mjs";
import { fulfillPaidBlueprintHelp } from "./client-services.mjs";
import { reconcilePaidBlueprintHelpCompletion } from "./service-completion.mjs";

export async function processBlueprintClientServices(db, {
  env = process.env, runPull = runCrsPull, aftercare = runBlueprintMonthlyPullAftercare,
  createTaskImpl = createTask, fulfillHelp = fulfillPaidBlueprintHelp,
  completeHelp = reconcilePaidBlueprintHelpCompletion, limit = 20
} = {}) {
  const tally = { staged: 0, fulfilled: 0, waiting: 0, errors: [] };
  const paid = await db.query(`SELECT s.id,s.org_id FROM blueprint_client_services s
    JOIN paid_service_requests p ON p.id=s.id AND p.org_id=s.org_id AND p.client_id=s.client_id
    WHERE p.status='paid' AND s.state IN ('awaiting_payment','paid','needs_review')
    ORDER BY s.created_at LIMIT $1`, [limit]);
  for (const row of paid.rows) {
    try {
      const result = await fulfillHelp(db, { requestId: row.id, orgId: row.org_id });
      if (result.ok && !result.waiting) tally.staged++;
    } catch (error) { tally.errors.push({ requestId: row.id, reason: error.code || "handoff_failed" }); }
  }
  const completion = await completeHelp(db,{limit});
  tally.completedServices = completion.completed;
  if (!completion.ok) tally.errors.push(...completion.errors);
  const reports = await db.query(`SELECT r.* FROM soft_pull_requests r
    LEFT JOIN blueprint_client_services s ON s.id=r.blueprint_service_request_id
    WHERE r.blueprint_engagement_id IS NOT NULL
      AND (r.idempotency_key LIKE 'blueprint-included:%' OR r.idempotency_key LIKE 'blueprint-service:%:real' OR r.idempotency_key LIKE 'paid_round_pull:%')
      AND (r.status='queued' OR (r.status='fulfilled' AND s.state IN ('in_progress','needs_review')))
    ORDER BY r.requested_at LIMIT $1`, [limit]);
  for (const row of reports.rows) {
    if (systemPullUsesSimulation(env)) { tally.waiting++; continue; }
    try {
      const pull = await runPull(db, { orgId: row.org_id, clientId: row.client_id, requestId: row.id, env, simulate: false });
      if (!pull?.ok || pull.simulated === true || !pull.crsResultId) {
        const error = new Error(pull?.code || "report_result_not_saved");
        error.code = pull?.code;
        throw error;
      }
      const delivery = await aftercare(db, { orgId: row.org_id, clientId: row.client_id, crsResultId: pull.crsResultId });
      if (delivery?.ok !== true) throw new Error("report_plan_delivery_needs_review");
      if (row.blueprint_service_request_id) {
        await db.query(`UPDATE paid_service_requests SET status='fulfilled',produced_kind='crs_result',produced_ref=$2,
          resolved_at=now() WHERE id=$1 AND org_id=$3 AND client_id=$4 AND status IN ('paid','staged')`,
        [row.blueprint_service_request_id, pull.crsResultId, row.org_id, row.client_id]);
        await db.query(`UPDATE blueprint_client_services SET state='completed',updated_at=now()
          WHERE id=$1 AND org_id=$2 AND client_id=$3`, [row.blueprint_service_request_id, row.org_id, row.client_id]);
      }
      tally.fulfilled++;
    } catch (error) {
      if (error?.code === "request_already_claimed") { tally.waiting++; continue; }
      // A report may already exist. Keep its record and escalate instead of ordering again.
      // Only runCrsPull can record a definite provider failure. A thrown error
      // can follow a successful order or storage write: preserve its processing
      // claim (and the one-open-request guard) until the saved receipt is reviewed.
      if (row.blueprint_service_request_id) await db.query(`UPDATE blueprint_client_services SET state='needs_review',updated_at=now()
        WHERE id=$1 AND org_id=$2 AND client_id=$3`, [row.blueprint_service_request_id, row.org_id, row.client_id]);
      await createTaskImpl(db, { orgId: row.org_id, clientId: row.client_id, assigneeRole: "csm",
        title: "Review Blueprint report and its saved delivery", sourceWorkflow: "blueprint-report-delivery",
        eventId: `blueprint-report-review:${row.id}`,
        detail: `Request ${row.id}. Review the provider receipt and saved report before any new request. ${String(error.message || error).slice(0, 150)}` });
      tally.errors.push({ requestId: row.id, reason: error.code || error.message || "report_needs_review" });
    }
  }
  return { ok: tally.errors.length === 0, ...tally };
}
