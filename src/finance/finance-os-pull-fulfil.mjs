// Finance OS — fulfil queued system soft-pull requests (sandbox/sim by default).
//
// The sweeper queues rows; this module orders CRS (or simulates), closes the
// ledger via runCrsPull → coordinateCrsResult, then runs Blueprint aftercare.

import { runCrsPull } from "./crs-pull.mjs";
import { livePullAllowed } from "./crs-identities.mjs";
import { runBlueprintMonthlyPullAftercare } from "../blueprint/monthly-pull-aftercare.mjs";
import { createTask } from "../lib/create-task.mjs";

export const FINANCE_OS_SYSTEM_PULL_LIVE = "FINANCE_OS_SYSTEM_PULL_LIVE";
export const MONTHLY_DELIVERY_EXCEPTION_SOURCE = "blueprint-monthly-delivery";

/** True when both CRS_ALLOW_LIVE and FINANCE_OS_SYSTEM_PULL_LIVE are explicitly on. */
export function systemPullUsesSimulation(env = process.env) {
  const raw = String(env?.[FINANCE_OS_SYSTEM_PULL_LIVE] ?? "").trim().toLowerCase();
  const explicitLive = ["1", "true", "yes", "on"].includes(raw);
  if (explicitLive && livePullAllowed(env)) return false;
  return true;
}

/** Queued system pulls oldest-first. */
export async function queuedSystemPulls(conn, { limit = 50 } = {}) {
  const cap = Math.max(1, Math.min(Number(limit) || 50, 200));
  const res = await conn.query(
    `SELECT id, org_id, client_id, subscription_id, requested_at
       FROM soft_pull_requests
      WHERE status = 'queued'
        AND requested_by_kind = 'system'
      ORDER BY requested_at ASC
      LIMIT $1`,
    [cap]
  );
  return res.rows;
}

/**
 * fulfilQueuedSystemPulls — one pass. Never throws for the whole batch.
 */
export async function fulfilQueuedSystemPulls(conn, {
  env = process.env,
  runPull = runCrsPull,
  aftercare = runBlueprintMonthlyPullAftercare,
  limit = 50
} = {}) {
  const simulate = systemPullUsesSimulation(env);
  const tally = {
    checked: 0,
    fulfilled: 0, // real bureau results only; simulation is a rehearsal
    simulatedFulfilled: 0,
    failed: 0,
    skipped: [],
    errored: [],
    simulated: simulate,
    deliveryExceptions: []
  };

  const rows = await queuedSystemPulls(conn, { limit });
  tally.checked = rows.length;

  for (const row of rows) {
    try {
      const pull = await runPull(conn, {
        orgId: row.org_id,
        clientId: row.client_id,
        requestId: row.id,
        env,
        simulate
      });
      if (!pull?.ok) {
        tally.failed += 1;
        tally.skipped.push({
          clientId: row.client_id,
          requestId: row.id,
          reason: pull?.code || pull?.reason || "pull_failed"
        });
        continue;
      }
      // The provider's persisted-result stamp is authoritative. A successful
      // simulated run proves the pipeline mechanics, not a fresh credit report.
      // It must never update a buyer's Blueprint roadmap or generate letters,
      // and it must not inflate the real-fulfillment count.
      if (pull.simulated === true) {
        tally.simulatedFulfilled += 1;
        tally.skipped.push({
          clientId: row.client_id,
          requestId: row.id,
          reason: "simulated_result_not_customer_delivery"
        });
        continue;
      }
      tally.fulfilled += 1;
      if (aftercare) {
        const delivered = await aftercare(conn, {
          orgId: row.org_id,
          clientId: row.client_id,
          crsResultId: pull.crsResultId ?? null
        }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
        if (delivered?.ok !== true) {
          tally.errored.push({
            clientId: row.client_id,
            requestId: row.id,
            phase: "aftercare",
            error: delivered?.error || delivered?.failures?.map((failure) => `${failure.phase}: ${failure.error}`).join("; ") || "monthly_aftercare_failed"
          });
          const exception = await createTask(conn, {
            orgId: row.org_id, clientId: row.client_id,
            title: "Finish Blueprint monthly delivery from the saved credit result",
            sourceWorkflow: MONTHLY_DELIVERY_EXCEPTION_SOURCE,
            assigneeRole: "owner",
            eventId: `blueprint-monthly-delivery:${row.id}`,
            detail: `Credit result: ${pull.crsResultId || "not recorded"}. Request: ${row.id}. Finish the plan and letters from this saved result; do not request another paid credit pull.`
          }).catch((error) => ({ created: false, error: String(error?.message || error) }));
          tally.deliveryExceptions.push({ clientId: row.client_id, requestId: row.id,
            crsResultId: pull.crsResultId ?? null, task: exception });
        }
      }
    } catch (e) {
      tally.errored.push({
        clientId: row.client_id,
        requestId: row.id,
        error: String(e?.message || e)
      });
    }
  }

  return { ...tally, ok: tally.failed === 0 && tally.errored.length === 0 };
}

export default fulfilQueuedSystemPulls;
