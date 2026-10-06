// @ts-check
// The flywheel's rows in marketing_jobs: start a stage run (one in flight per
// campaign and stage), and read the newest run of every stage for the Ideas tab.
//
// Design docs/specs/command-center-design-2026-10-05.md §3.2 "Job kinds": stages
// 2, 4 and 5 are marketing_jobs kind 'flywheel_stage' with payload {campaign,
// stage, ...}, one in flight per campaign and stage. Unit X3 builds stages 4 and
// 5 on it (stage 2 is unit X2's). The design puts a partial unique index on that
// rule in a later migration; until it lands the rule is held here, inside the
// caller's transaction, by a transaction-scoped advisory lock on the
// (company, campaign, stage) triple followed by a look for a waiting or running
// row. pg_advisory_xact_lock is the pooler-safe form (a session lock or a bare
// SET sticks to a shared backend on the transaction pooler).

import { enqueueJob } from "../jobs.mjs";

export const FLYWHEEL_STAGE_KIND = "flywheel_stage";

/**
 * startStageJob(tx, { orgId, campaign, stage, payload, staffId })
 *   → { job, created }   created false = that stage was already running; job is that run
 * Runs inside the caller's transaction (withRequest's).
 * @param {{query: Function}} tx
 * @param {{orgId: string, campaign: string, stage: number, payload?: object, staffId?: string|null}} args
 */
export async function startStageJob(tx, { orgId, campaign, stage, payload = {}, staffId = null }) {
  await tx.query(
    `SELECT pg_advisory_xact_lock(hashtextextended('flywheel_stage:' || $1 || ':' || $2 || ':' || $3, 0))`,
    [orgId, campaign, String(stage)]
  );
  const open = (await tx.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${FLYWHEEL_STAGE_KIND}'
        AND payload->>'campaign' = $2 AND payload->>'stage' = $3
        AND status IN ('queued', 'running')
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, campaign, String(stage)]
  )).rows[0];
  if (open) return { job: open, created: false };
  const job = await enqueueJob(tx, {
    orgId,
    kind: FLYWHEEL_STAGE_KIND,
    payload: { ...payload, campaign, stage: Number(stage) }
  });
  if (staffId) {
    await tx.query(`UPDATE marketing_jobs SET requested_by = $2 WHERE id = $1`, [job.id, staffId]);
    job.requested_by = staffId;
  }
  return { job, created: true };
}

/**
 * latestStageJobs(db, { orgId, campaign }) → { [stage]: { job, spentUsd } }
 *
 * The newest flywheel_stage job per stage for this campaign, plus the newest
 * offer job for it (stage 3; the Write offer path stores payload.campaign). Spend
 * is what the ledger holds for that job (marketing_model_usage.job_id); a call
 * with an unknown price makes the job's spend null (unknown, never $0).
 * @param {{query: Function}} db
 * @param {{orgId: string, campaign: string}} args
 */
export async function latestStageJobs(db, { orgId, campaign }) {
  const r = await db.query(
    `WITH newest AS (
       SELECT DISTINCT ON (stage) *
         FROM (
           SELECT j.*, CASE WHEN j.kind = 'offer' THEN 3 ELSE (j.payload->>'stage')::int END AS stage
             FROM marketing_jobs j
            WHERE j.org_id = $1
              AND j.payload->>'campaign' = $2
              AND (j.kind = 'offer'
                   OR (j.kind = '${FLYWHEEL_STAGE_KIND}' AND j.payload->>'stage' ~ '^[0-9]$'))
         ) x
        ORDER BY stage, created_at DESC
     )
     SELECT n.*,
            (SELECT CASE WHEN count(*) = 0 THEN 0
                         WHEN bool_or(u.cost_usd IS NULL) THEN NULL
                         ELSE sum(u.cost_usd) END
               FROM marketing_model_usage u
              WHERE u.job_id = n.id) AS spent_usd
       FROM newest n`,
    [orgId, campaign]
  );
  /** @type {Record<number, {job: any, spentUsd: number|null}>} */
  const out = {};
  for (const row of r.rows) {
    const { stage, spent_usd: spent, ...job } = row;
    out[Number(stage)] = { job, spentUsd: spent == null ? null : Number(spent) };
  }
  return out;
}

/**
 * runSpendUsd(db, jobId) → { usd, unpriced } — what one run has cost so far.
 * A call with an unknown price is counted at the highest known rate by the
 * caller's cap check (src/marketing/model-usage.mjs worstCaseUsd), never as free.
 * @param {{query: Function}} db
 * @param {string} jobId
 */
export async function runSpendUsd(db, jobId) {
  const r = await db.query(
    `SELECT COALESCE(sum(cost_usd), 0) AS priced,
            COALESCE(sum(input_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS null_in,
            COALESCE(sum(output_tokens) FILTER (WHERE cost_usd IS NULL), 0) AS null_out,
            count(*) FILTER (WHERE cost_usd IS NULL)::int AS unpriced
       FROM marketing_model_usage WHERE job_id = $1`,
    [jobId]
  );
  const row = r.rows[0] || {};
  return {
    priced: Number(row.priced) || 0,
    nullInput: Number(row.null_in) || 0,
    nullOutput: Number(row.null_out) || 0,
    unpriced: Number(row.unpriced) || 0
  };
}

/**
 * capsFor(db, orgId) → { runCapUsd, monthCapUsd } from marketing_settings.
 * The run cap is the batch cap (max_batch_cost_usd, $40 by default): the design
 * names no cap of its own for the copy and strategy runs, and the market
 * research run uses the batch cap the same way (§5 rule 13).
 */
export async function capsFor(db, orgId) {
  const r = await db.query(
    `SELECT max_batch_cost_usd, max_month_cost_usd FROM marketing_settings WHERE org_id = $1`,
    [orgId]
  ).catch(() => ({ rows: [] }));
  const row = r.rows[0] || {};
  const num = (v, d) => (v == null || v === "" || !Number.isFinite(Number(v)) ? d : Number(v));
  return { runCapUsd: num(row.max_batch_cost_usd, 40), monthCapUsd: num(row.max_month_cost_usd, 300) };
}
