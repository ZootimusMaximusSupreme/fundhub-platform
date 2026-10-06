// Saving and reading offer runs. Table: marketing_jobs (db/migrations/409_marketing_jobs.sql).
//
// One row per press of "Write offer": kind = 'offer', the inputs in `payload`,
// the finished offer in `result`. The states and the event that moves each one
// are drawn in docs/journeys/marketing-offer-flow.md:
//
//   queued ──worker claims it──▶ running ──offer written──▶ done
//      │                            │
//      └── worker never started ────┴── writer failed / stopped ──▶ failed
//
// The database, not this file, holds the two rules that matter:
//   * a failed row must say why, and a done row must hold its result;
//   * only ONE offer may be in flight per company (partial unique index), so a
//     double press cannot pay for two runs.
//
// The table is org-scoped with an app-wide policy (the 403 pattern), so these
// are plain queries — and every one of them names the org.
//
// BEFORE THE MIGRATION SHIPS the table does not exist. isNotReady() lets the
// endpoint say "not live yet" instead of a 500.

export const OFFER_KIND = "offer";

/* The background worker is killed at 15 minutes. A row still in flight after 16
   has no worker behind it, so it is closed with a reason, not left to block the
   next press forever. */
export const STALE_AFTER_MINUTES = 16;

const STALE_REASON =
  "The writer stopped without finishing (no word for 16 minutes). Nothing was chosen. Press Write offer again.";

/** Postgres "relation does not exist": the migration has not shipped yet. */
export function isNotReady(err) {
  return !!err && (err.code === "42P01" || /relation "?marketing_jobs"? does not exist/i.test(String(err.message || "")));
}

export async function expireStaleOfferJobs(db, { orgId }) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'failed', error = $2, finished_at = now()
      WHERE org_id = $1 AND kind = '${OFFER_KIND}'
        AND status IN ('queued', 'running')
        AND COALESCE(claimed_at, created_at) < now() - interval '${STALE_AFTER_MINUTES} minutes'
      RETURNING id`,
    [orgId, STALE_REASON]
  );
  return r.rows.length;
}

/**
 * createOfferJob(db, { orgId, staffId, payload }) → { job, created }
 * created:false means an offer was already being written; that row comes back
 * instead, so the screen can follow it rather than start a second paid run.
 */
export async function createOfferJob(db, { orgId, staffId, payload }) {
  await expireStaleOfferJobs(db, { orgId });
  const ins = await db.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, requested_by)
     VALUES ($1, '${OFFER_KIND}', $2::jsonb, $3)
     ON CONFLICT (org_id) WHERE kind = '${OFFER_KIND}' AND status IN ('queued', 'running')
     DO NOTHING
     RETURNING *`,
    [orgId, JSON.stringify(payload || {}), staffId || null]
  );
  if (ins.rows[0]) return { job: ins.rows[0], created: true };
  const cur = await db.query(
    `SELECT * FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${OFFER_KIND}' AND status IN ('queued', 'running')
      ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  return { job: cur.rows[0] || null, created: false };
}

/** queued → running. Null when the row is not queued (already taken, or gone). */
export async function claimOfferJob(db, { jobId, orgId }) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'running', claimed_at = now(), attempts = attempts + 1
      WHERE id = $1 AND org_id = $2 AND kind = '${OFFER_KIND}' AND status = 'queued'
      RETURNING *`,
    [jobId, orgId]
  );
  return r.rows[0] || null;
}

/** running → done, with the offer. */
export async function finishOfferJob(db, { jobId, orgId, result }) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'done', result = $3::jsonb, error = NULL, finished_at = now()
      WHERE id = $1 AND org_id = $2 AND status = 'running'
      RETURNING id`,
    [jobId, orgId, JSON.stringify(result)]
  );
  return r.rows.length === 1;
}

/** queued|running → failed, with the reason (and whatever was written so far). */
export async function failOfferJob(db, { jobId, orgId, error, result = null }) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'failed', error = $3, result = $4::jsonb, finished_at = now()
      WHERE id = $1 AND org_id = $2 AND status IN ('queued', 'running')
      RETURNING id`,
    [jobId, orgId, String(error || "failed, no reason recorded").slice(0, 1000), result == null ? null : JSON.stringify(result)]
  );
  return r.rows.length === 1;
}

export async function getOfferJob(db, { orgId, jobId }) {
  const r = await db.query(
    `SELECT * FROM marketing_jobs WHERE id = $1 AND org_id = $2 AND kind = '${OFFER_KIND}'`,
    [jobId, orgId]
  );
  return r.rows[0] || null;
}

/** The newest run of any state, and the newest finished offer. */
export async function latestOfferJobs(db, { orgId }) {
  const latest = await db.query(
    `SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = '${OFFER_KIND}'
      ORDER BY created_at DESC LIMIT 1`,
    [orgId]
  );
  const done = await db.query(
    `SELECT * FROM marketing_jobs WHERE org_id = $1 AND kind = '${OFFER_KIND}' AND status = 'done'
      ORDER BY finished_at DESC NULLS LAST, created_at DESC LIMIT 1`,
    [orgId]
  );
  return { latestJob: latest.rows[0] || null, latestDone: done.rows[0] || null };
}

/* ── WHAT THE ENDPOINT RETURNS ───────────────────────────────────────────── */

const iso = (v) => (v instanceof Date ? v.toISOString() : v || null);

/** A run's status, without the offer itself. */
export function jobView(row) {
  if (!row) return null;
  const payload = row.payload || {};
  return {
    id: row.id,
    status: row.status,
    campaign: payload.campaign || null,
    created_at: iso(row.created_at),
    claimed_at: iso(row.claimed_at),
    finished_at: iso(row.finished_at),
    attempts: row.attempts ?? 0,
    requested_by: row.requested_by || null,
    error: row.error || null
  };
}

/** A finished offer, as the dashboard shows it. Null unless the run is done. */
export function offerView(row) {
  if (!row || row.status !== "done" || !row.result) return null;
  const r = row.result;
  return {
    job_id: row.id,
    campaign: r.campaign,
    as_of: r.asOf,
    finished_at: iso(row.finished_at),
    offer: r.offer,
    review_card: r.reviewCard,
    document: r.document,
    synthesized: r.synthesized,
    winner: r.winner,
    runner_up: r.runnerUp,
    runoff_advised: r.runoffAdvised,
    scores: r.scores,
    unjudged: r.unjudged,
    candidates: r.candidates,
    counts: r.counts,
    checks: r.checks,
    inputs: r.inputs,
    model: r.model || null,
    usage: r.usage
  };
}
