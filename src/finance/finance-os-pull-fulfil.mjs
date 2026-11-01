// Finance OS — fulfil queued system soft-pull requests (sandbox/sim by default).
//
// The sweeper queues rows; this module orders CRS (or simulates), closes the
// ledger via runCrsPull → coordinateCrsResult, then runs Blueprint aftercare.

import { runCrsPull } from "./crs-pull.mjs";
import { livePullAllowed } from "./crs-identities.mjs";
import { runBlueprintMonthlyPullAftercare } from "../blueprint/monthly-pull-aftercare.mjs";
import { createTask } from "../lib/create-task.mjs";
import { consentStatus } from "../consent/index.mjs";
import { financeOsEntitlement } from "./finance-os-entitlement.mjs";
import { SoftPullError } from "./soft-pulls.mjs";

export const FINANCE_OS_SYSTEM_PULL_LIVE = "FINANCE_OS_SYSTEM_PULL_LIVE";
export const MONTHLY_DELIVERY_EXCEPTION_SOURCE = "blueprint-monthly-delivery";
export const MONTHLY_PROVIDER_HOLD_SOURCE = "finance-os-monthly-authorization";
export const MONTHLY_PROVIDER_EXCEPTION_SOURCE = "finance-os-monthly-provider-exception";

/** An explicit subscription-scoped real key, never an env-inferred intent. */
export function savedSystemPullIntent(row) {
  const subscription = String(row?.subscription_id || "");
  const match = /^finance-os-monthly:([^:]+):([0-9]+)(:real)?$/.exec(String(row?.idempotency_key || ""));
  if (!subscription || !match || match[1] !== subscription) return "unknown";
  return match[3] ? "real" : "simulated";
}

/** Make an authorization refusal terminal in the saved pull ledger.
 * A task alone leaves status='queued' and the same old request can become a
 * real provider order after flags/consent change. The status write is scoped
 * to the exact tenant and must win before we claim that a hold was recorded. */
export async function persistHeldMonthlyRequest(conn, row, reason) {
  const changed = await conn.query(
    `UPDATE soft_pull_requests
        SET status = 'cancelled',
            state_reason = $4,
            resolved_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND requested_by_kind = 'system' AND status = 'queued'
      RETURNING id`,
    [row.id, row.org_id, row.client_id, `Authorization hold: ${reason}`]
  );
  return changed.rows?.length === 1;
}

/** A real bureau attempt with an unknown outcome must leave the active ledger.
 * Never overwrite a result another worker already resolved. */
export async function persistUncertainMonthlyRequest(conn, row, reason) {
  const scope = [row.id, row.org_id, row.client_id];
  const changed = await conn.query(
    `UPDATE soft_pull_requests
        SET status = 'failed', state_reason = $4,
            resolved_at = now(), updated_at = now()
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND requested_by_kind = 'system' AND status IN ('queued', 'processing')
        AND crs_result_id IS NULL
      RETURNING id`,
    [...scope, `Provider outcome requires owner reconciliation: ${String(reason).slice(0, 160)}`]
  );
  if (changed.rows?.length === 1) return true;
  const current = await conn.query(
    `SELECT status FROM soft_pull_requests
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND requested_by_kind = 'system'`, scope
  );
  return ['failed', 'cancelled', 'fulfilled'].includes(current.rows?.[0]?.status);
}

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
    `SELECT r.id, r.org_id, r.client_id, r.subscription_id, r.idempotency_key, r.requested_at
       FROM soft_pull_requests r
      WHERE r.status = 'queued'
        AND r.requested_by_kind = 'system'
        AND NOT EXISTS (
          SELECT 1 FROM tasks incident
           WHERE incident.org_id = r.org_id AND incident.client_id = r.client_id
             AND incident.source_workflow = $2
             AND incident.body = 'finance-os-monthly-provider:' || r.id::text
        )
      ORDER BY r.requested_at ASC
      LIMIT $1`,
    [cap, MONTHLY_PROVIDER_EXCEPTION_SOURCE]
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
  consentCheck = consentStatus,
  entitlementCheck = financeOsEntitlement,
  createTaskImpl = createTask,
  now = new Date(),
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
    deliveryExceptions: [],
    providerExceptions: [],
    authorizationHolds: []
  };

  // Never re-order an uncertain provider request. Escalate the saved request
  // using a stable task key, then require a human to reconcile the provider.
  async function reportProviderException(row, failure) {
    const record = { clientId: row.client_id, requestId: row.id, reason: failure };
    try {
      if (!(await persistUncertainMonthlyRequest(conn, row, failure))) {
        throw new Error("request_not_terminal_or_wrong_scope");
      }
    } catch (error) {
      tally.errored.push({ ...record, phase: "provider_exception_hold",
        error: String(error?.message || error) });
    }
    try {
      const task = await createTaskImpl(conn, {
        orgId: row.org_id, clientId: row.client_id, assigneeRole: "owner",
        sourceWorkflow: MONTHLY_PROVIDER_EXCEPTION_SOURCE,
        title: "Investigate FinanceOS monthly credit result before any retry",
        eventId: `finance-os-monthly-provider:${row.id}`,
        detail: `Request ${row.id}; saved plan ${row.subscription_id || "unknown"}; outcome: ${String(failure).slice(0, 160)}. Check the saved request, original provider receipt, and valid consent. A transport or storage error may follow a real bureau order. Do not automatically redial or re-pull credit; arrange an authorized recovery only after reconciliation.`
      });
      if (!task || task.error || (task.created === false && !task.id && task.reason !== "duplicate_race")) {
        throw new Error(task?.error || "provider_exception_task_not_persisted");
      }
      tally.providerExceptions.push({ ...record, task });
    } catch (error) {
      tally.errored.push({ ...record, phase: "provider_exception_task", error: String(error?.message || error) });
    }
  }

  const rows = await queuedSystemPulls(conn, { limit });
  tally.checked = rows.length;

  for (const row of rows) {
    let providerAttempted = false;
    try {
      const intent = savedSystemPullIntent(row);
      let reason = null;
      if (simulate && intent === "real") reason = "live_flags_disabled_for_real_request";
      else if (!simulate && intent !== "real") reason = "request_not_explicitly_real";
      else if (!simulate) {
        // Recheck consent and paid access at execution, not only when queued.
        const consent = await consentCheck(conn, {
          orgId: row.org_id, clientId: row.client_id, kind: "soft_pull_consent"
        });
        if (consent?.valid !== true) reason = "consent_no_longer_valid";
        else {
          const entitled = await entitlementCheck(conn, {
            orgId: row.org_id, clientId: row.client_id, asOf: now
          });
          if (entitled?.entitled !== true ||
              String(entitled.subscriptionId) !== String(row.subscription_id)) {
            reason = "paid_access_no_longer_valid";
          }
        }
      }
      if (reason) {
        // Hold and escalate; never translate a rehearsal into a real pull.
        const hold = { clientId: row.client_id, requestId: row.id, reason };
        try {
          if (!(await persistHeldMonthlyRequest(conn, row, reason))) {
            tally.errored.push({ ...hold, phase: "authorization_hold_persist",
              error: "request_not_queued_or_wrong_scope" });
            continue;
          }
        } catch (error) {
          tally.errored.push({ ...hold, phase: "authorization_hold_persist",
            error: String(error?.message || error) });
          continue;
        }
        tally.authorizationHolds.push(hold);
        tally.skipped.push(hold);
        const task = await createTaskImpl(conn, {
          orgId: row.org_id, clientId: row.client_id, assigneeRole: "owner",
          sourceWorkflow: MONTHLY_PROVIDER_HOLD_SOURCE,
          title: "Review held FinanceOS credit request before provider delivery",
          eventId: `finance-os-monthly-authorization:${row.id}`,
          detail: `Request ${row.id}: ${reason}. Recheck current consent, subscription and saved real-vs-rehearsal intent; do not automatically redial. Escalate and queue a new authorized request if appropriate.`
        }).catch(error => ({error: String(error?.message || error)}));
        if (!task || task.error) tally.errored.push({ ...hold, phase: "authorization_hold_task", error: task?.error || "not_saved" });
        continue;
      }
      providerAttempted = true;
      const pull = await runPull(conn, {
        orgId: row.org_id,
        clientId: row.client_id,
        requestId: row.id,
        env,
        simulate
      });
      if (!pull?.ok) {
        const failure = pull?.code || pull?.reason || "pull_failed";
        tally.failed += 1;
        tally.skipped.push({
          clientId: row.client_id,
          requestId: row.id,
          reason: failure
        });
        if (!simulate) await reportProviderException(row, failure);
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
      if (e instanceof SoftPullError && e.code === "request_already_claimed") {
        tally.skipped.push({ clientId: row.client_id, requestId: row.id,
          reason: e.code });
        continue;
      }
      tally.errored.push({
        clientId: row.client_id,
        requestId: row.id,
        error: String(e?.message || e)
      });
      // A thrown provider/storage operation may have charged or returned a
      // bureau report before losing the response. Never automatically retry.
      if (providerAttempted && !simulate) {
        await reportProviderException(row, "provider_or_storage_outcome_unknown");
      }
    }
  }

  return { ...tally, ok: tally.failed === 0 && tally.errored.length === 0 && tally.authorizationHolds.length === 0 };
}

export default fulfilQueuedSystemPulls;
