// Finance OS monthly pull sweeper — the clock behind the included soft pull.
//
// WHAT ONE PASS DOES. For every client with an active `finance-os` subscription
// whose paid access period is open and whose last system request was at least
// 30 days ago, write one queued row via requestSoftPull(). The included year
// is an access window, not the refresh cadence. Duplicate runs share a key.
//
// requestSoftPull() records the request. The existing fulfil hook then runs
// with its existing consent, simulation and explicit-live-provider gates.
// A queued request is not proof that a fresh credit file has arrived.
//
// NEVER THROWS FOR THE WHOLE PASS. One client's consent revocation, a missing
// billing period, or a race with a human-initiated pull must not stop every
// other client's row from being written — same reasoning as
// waypoint-nudge-sweeper.mjs's per-candidate catch.
//
// THE CONSENT GATE STILL APPLIES. requestSoftPull()'s GUARD 0 reads
// soft_pull_consent at request time regardless of requester kind. A client who
// revoked consent, or never granted it, is silently skipped here — refused,
// not erred — exactly as a client-initiated pull would be.
//
// DAILY, NOT HOURLY. A billing period is measured in a month; the only thing a
// faster clock buys is a pull landing a few hours sooner in the rare case a
// period just turned over. Against that: every pass reads every client with an
// active finance-os subscription. See waypoint-nudge-sweeper.mjs's header for
// the same cadence argument at finer grain.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { requestSoftPull, SoftPullError } from "../finance/soft-pulls.mjs";
import { FINANCE_OS_TIER } from "../finance/finance-os-entitlement.mjs";
import { BLUEPRINT_PRODUCT_CODE } from "../waypoints/purchase.mjs";
import { fulfilQueuedSystemPulls, systemPullUsesSimulation } from "../finance/finance-os-pull-fulfil.mjs";

export const SWEEP_CRON = "0 6 * * *"; // 06:00 UTC daily — matches the other daily sweepers' quiet-hours-safe slot
export const SOURCE_WORKFLOW = "finance-os-pull-sweeper";
export const MONTHLY_PULL_DAYS = 30;

export const SCHEDULED_PULL_REASON =
  "Finance OS monthly optimization pull — included with the client's finance-os subscription, requested automatically.";

/** Every active finance-os subscriber with no meaningful system request in 30 days.
 * When a real pull is authorized, already-completed simulations cannot spend
 * the buyer's included monthly credit refresh. A pending or failed request
 * still blocks auto-redial and requires normal recovery; permission and consent
 * are checked again by requestSoftPull at request time.
 *  One row per (org, client, subscription) — a client cannot hold
 *  two active finance-os subscriptions at once (075's window constraint). */
export async function dueClients(conn, now, { realPull = false } = {}) {
  const res = await conn.query(
    `WITH blueprint_access AS (
       SELECT DISTINCT ON (e.org_id, e.client_id)
              e.id AS subscription_id, e.org_id, e.client_id,
              COALESCE(sp.paid_at, t.created_at) AS current_period_start
         FROM entitlements e
         JOIN transactions t ON t.id = e.source_transaction_id
           AND t.org_id = e.org_id AND t.client_id = e.client_id
         LEFT JOIN sale_payments sp ON sp.transaction_id = t.id AND sp.org_id = t.org_id
         JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
           AND p.org_id = t.org_id
        WHERE e.entitlement_code = 'credit-optimization-roadmap'
          AND e.revoked_at IS NULL
          AND (e.expires_at IS NULL OR e.expires_at > $2)
          AND lower(btrim(COALESCE(t.status, ''))) = 'succeeded'
          AND lower(btrim(p.code)) = $5
          AND COALESCE(sp.paid_at, t.created_at) <= $2
          AND (COALESCE(sp.paid_at, t.created_at) + interval '12 months') > $2
        ORDER BY e.org_id, e.client_id, COALESCE(sp.paid_at, t.created_at) DESC, e.id DESC
      ), entitled AS (
       SELECT s.id AS subscription_id, s.org_id, s.client_id, s.current_period_start
         FROM subscriptions s
        WHERE s.tier = $1
          AND s.status = 'active'
          AND s.effective_from <= $2
          AND (s.effective_to IS NULL OR s.effective_to > $2)
          AND s.current_period_start IS NOT NULL
          AND s.current_period_end IS NOT NULL
          AND s.current_period_start <= $2
          AND s.current_period_end > $2
       UNION ALL
       SELECT b.subscription_id, b.org_id, b.client_id, b.current_period_start
         FROM blueprint_access b
        WHERE NOT EXISTS (
          SELECT 1 FROM subscriptions paid
           WHERE paid.org_id = b.org_id AND paid.client_id = b.client_id
             AND paid.tier = $1 AND paid.status = 'active'
             AND paid.effective_from <= $2
             AND (paid.effective_to IS NULL OR paid.effective_to > $2)
             AND (paid.current_period_start IS NULL OR paid.current_period_start <= $2)
             AND (paid.current_period_end IS NULL OR paid.current_period_end > $2)
        )
      )
      SELECT s.subscription_id, s.org_id, s.client_id, s.current_period_start
        FROM entitled s
       WHERE NOT EXISTS (
          SELECT 1 FROM soft_pull_requests r
           WHERE r.client_id = s.client_id
             AND r.org_id = s.org_id
             AND r.requested_by_kind = 'system'
             AND r.requested_at > $2::timestamptz - ($3::int * interval '1 day')
             AND (
               NOT $4::boolean OR r.status <> 'fulfilled' OR NOT EXISTS (
                 SELECT 1 FROM crs_results cr
                  WHERE cr.id = r.crs_result_id
                    AND cr.org_id = r.org_id AND cr.client_id = r.client_id
                    AND (
                      COALESCE(cr.provider, '') = 'crs_softview_simulated'
                      OR LOWER(COALESCE(cr.result->>'simulated', '')) IN ('true', '1')
                      OR LOWER(COALESCE(cr.result->>'environment', '')) IN ('sandbox', 'simulated')
                    )
               )
             )
        )`,
    [FINANCE_OS_TIER, now, MONTHLY_PULL_DAYS, !!realPull, BLUEPRINT_PRODUCT_CODE]
  );
  return res.rows;
}

export function monthlyPullKey(row, now, { realPull = false } = {}) {
  const start = new Date(row.current_period_start).getTime();
  const at = new Date(now).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(at) || at < start) {
    throw new Error("The monthly pull needs a valid open access period");
  }
  const window = Math.floor((at - start) / (MONTHLY_PULL_DAYS * 86400000));
  return `finance-os-monthly:${row.subscription_id}:${window}${realPull ? ':real' : ''}`;
}

/** sweep — one pass. `db` and the clock are arguments so tests drive it
    without Inngest. Returns a tally rather than throwing. */
export async function sweep(conn = db, { now = new Date(), env = process.env, fulfil = fulfilQueuedSystemPulls } = {}) {
  const tally = { checked: 0, requested: 0, skipped: [], errored: [], fulfil: null };
  const realPull = !systemPullUsesSimulation(env);
  const rows = await dueClients(conn, now, { realPull });
  tally.checked = rows.length;

  for (const row of rows) {
    try {
      const out = await requestSoftPull(conn, {
        orgId: row.org_id,
        clientId: row.client_id,
        requestedBy: { kind: "system" },
        reason: SCHEDULED_PULL_REASON,
        subscriptionId: row.subscription_id,
        idempotencyKey: monthlyPullKey(row, now, { realPull }),
        provider: "internal"
      });
      if (out.created) {
        tally.requested += 1;
      } else {
        // GUARD 2 already caught an open request (e.g. a human-initiated pull
        // this period) — correct to skip, not an error.
        tally.skipped.push({ clientId: row.client_id, reason: out.reason || "already_open" });
      }
    } catch (e) {
      // consent_required is the expected, common refusal — a client with no
      // valid soft_pull_consent on file is skipped, not logged as a fault.
      if (e instanceof SoftPullError && e.code === "consent_required") {
        tally.skipped.push({ clientId: row.client_id, reason: "consent_required" });
      } else {
        tally.errored.push({ clientId: row.client_id, error: e?.message || String(e) });
      }
    }
  }

  if (typeof fulfil === "function") {
    try {
      tally.fulfil = await fulfil(conn, { env });
    } catch (e) {
      tally.fulfil = { checked: 0, fulfilled: 0, failed: 0, errored: [{ error: String(e?.message || e) }] };
    }
  }

  return {
    ...tally,
    ok: tally.errored.length === 0 && Number(tally.fulfil?.failed || 0) === 0
      && !(tally.fulfil?.errored?.length) && tally.fulfil?.ok !== false
  };
}

/* handle — the shape src/journeys/runner/registry.mjs expects. No event
   trigger (it is a cron), so it appears in the runner's neverFired list by
   design, same as waypoint-nudge-sweeper.mjs. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const financeOsPullSweeper = inngest.createFunction(
  { id: "finance-os-pull-sweeper", name: "Finance OS monthly pull sweeper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
