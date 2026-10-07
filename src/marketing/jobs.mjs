// @ts-check
// The marketing machine's job queue. Table: marketing_jobs (db/migrations/409_marketing_jobs.sql),
// claim index marketing_jobs_claim_idx (db/migrations/411_marketing_buzzes_usage_shoots.sql).
// Spec: docs/specs/marketing-machine-2026-10-04.md §6 Step 3 (the table) and Step 4 (the worker).
//
// The states and the event that moves each one (drawn in docs/journeys/marketing-dashboard-flow.md,
// section "U04"):
//
//   enqueueJob ─▶ queued ──claimJobs──▶ running ──finishJob──▶ done
//                   ▲  ▲                   │ │
//                   │  └── requeueJob ─────┘ │   (wait loop: no attempt counted)
//                   └──── failJob, tries left┤
//                         reclaimStale ──────┤   (no word for 16 minutes: counts an attempt)
//                                            ▼
//                                          failed ──retryJob (Chris)──▶ queued, attempts 0
//
// WHAT `attempts` COUNTS HERE: runs that went wrong — a failJob() or a claim the worker
// never finished (reclaimStale). Claiming does not count, and a requeue does not count,
// so a job that polls Meta every 10 seconds for ten minutes never "runs out of tries".
// The third run that goes wrong marks the job failed, with the reason in plain words.
//
// THE OFFER IS NOT HERE. kind = 'offer' belongs to the "Write offer" button's own path
// (src/marketing/offer-store.mjs): it claims by id with the owner's token and fails a
// 16-minute-stale offer itself. Nothing in this file creates, claims, reclaims, fails,
// requeues or retries an offer row, so nothing ever runs twice.
//
// marketing_jobs is org-scoped with an app-wide policy (the 403 pattern), so these are
// plain queries. Every statement is one short statement: no transaction is ever held
// open across a model, GitHub or Meta call (spec §4 trap 3).

/** The M12 offer path's kind. Never touched by this queue. */
export const OFFER_KIND = "offer";

/** A run that goes wrong this many times is marked failed. */
export const MAX_ATTEMPTS = 3;

/** Wait before the next try: after the 1st failure 1 minute, after the 2nd 5 minutes. */
export const BACKOFF_MINUTES = Object.freeze([1, 5]);

/* A background function is killed at 15 minutes (spec §4 trap 5). A claim older than
   16 has no worker behind it. Reclaiming any sooner could run a job twice. */
export const STALE_AFTER_MINUTES = 16;

const MAX_CLAIM = 50;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db
 */

/** Plain words from whatever was thrown or passed. Never empty: a failed row must say why. */
function reasonOf(error) {
  const raw = error && typeof error === "object" && "message" in error ? error.message : error;
  const text = String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  return (text || "failed, no reason recorded").slice(0, 1000);
}

/** A list of kinds, or null for "no filter". An empty list stays empty (matches nothing). */
function kindList(kinds, name) {
  if (kinds == null) return null;
  if (!Array.isArray(kinds)) throw new TypeError(`${name} must be an array of job kinds`);
  return kinds.map((k) => String(k));
}

function timeOrNull(v, name) {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(/** @type {any} */ (v));
  if (Number.isNaN(d.getTime())) throw new TypeError(`${name} is not a time`);
  return d.toISOString();
}

/**
 * enqueueJob(dbOrTx, { orgId, kind, payload, runAfter }) → the new row.
 * Works inside a caller's transaction (pass the client). Refuses 'offer'.
 */
export async function enqueueJob(dbOrTx, { orgId, kind, payload = {}, runAfter } = /** @type {any} */ ({})) {
  if (!orgId) throw new TypeError("enqueueJob: orgId is required");
  const k = String(kind || "").trim();
  if (!k) throw new TypeError("enqueueJob: kind is required");
  if (k === OFFER_KIND) {
    throw new Error("enqueueJob: an offer job is made by createOfferJob (src/marketing/offer-store.mjs), not by this queue");
  }
  const r = await dbOrTx.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, run_after)
     VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, now()))
     RETURNING *`,
    [orgId, k, JSON.stringify(payload == null ? {} : payload), timeOrNull(runAfter, "runAfter")]
  );
  return r.rows[0];
}

/**
 * claimJobs(db, { limit, kinds, excludeKinds }) → the claimed rows (now 'running').
 *
 * One statement: pick due queued rows with FOR UPDATE SKIP LOCKED and mark them running.
 * Two workers claiming at the same moment get different rows. 'offer' is never claimed.
 * kinds: only these kinds (an empty list claims nothing). excludeKinds: never these.
 */
export async function claimJobs(db, { limit = 1, kinds, excludeKinds } = /** @type {{ limit?: number, kinds?: string[] | null, excludeKinds?: string[] | null }} */ ({})) {
  const only = kindList(kinds, "kinds");
  const not = kindList(excludeKinds, "excludeKinds") || [];
  if (only && only.length === 0) return [];
  const n = Math.max(1, Math.min(MAX_CLAIM, Math.floor(Number(limit) || 1)));
  const r = await db.query(
    `WITH picked AS (
       SELECT id
         FROM marketing_jobs
        WHERE status = 'queued'
          AND run_after <= now()
          AND kind <> '${OFFER_KIND}'
          AND ($2::text[] IS NULL OR kind = ANY($2::text[]))
          AND NOT (kind = ANY($3::text[]))
        ORDER BY run_after, created_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     UPDATE marketing_jobs j
        SET status = 'running', claimed_at = now(), finished_at = NULL
       FROM picked
      WHERE j.id = picked.id
     RETURNING j.*`,
    [n, only, not]
  );
  return r.rows.slice().sort((a, b) =>
    (new Date(a.run_after).getTime() - new Date(b.run_after).getTime()) ||
    (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()));
}

/**
 * finishJob(db, id, result) → the row (now 'done'), or null when it was not running.
 * A done job must hold a result (409's check), so a handler that returns nothing
 * is saved as {}.
 */
export async function finishJob(db, id, result) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'done', result = $2::jsonb, error = NULL, finished_at = now()
      WHERE id = $1 AND status = 'running' AND kind <> '${OFFER_KIND}'
      RETURNING *`,
    [id, JSON.stringify(result == null ? {} : result)]
  );
  return r.rows[0] || null;
}

/**
 * requeueJob(db, id, { runAfter }) → the row (back to 'queued'), or null when it was
 * not running. For wait loops (for example Meta still processing a video): the job
 * comes back at runAfter and NO attempt is counted.
 */
export async function requeueJob(db, id, { runAfter } = /** @type {{ runAfter?: Date | string | number | null }} */ ({})) {
  const r = await db.query(
    `UPDATE marketing_jobs
        SET status = 'queued', claimed_at = NULL,
            run_after = COALESCE($2::timestamptz, now())
      WHERE id = $1 AND status = 'running' AND kind <> '${OFFER_KIND}'
      RETURNING *`,
    [id, timeOrNull(runAfter, "runAfter")]
  );
  return r.rows[0] || null;
}

/**
 * failJob(db, id, error, { final }) → the row, or null when it was not running.
 *
 * Counts one attempt. Tries left: back to 'queued' with run_after pushed out
 * (BACKOFF_MINUTES) and the reason kept in `error` so the screen can say why it is
 * trying again. The MAX_ATTEMPTS-th failure: 'failed', with the reason in plain words.
 * final: true fails it now, for an error that will not fix itself (a cost cap reached).
 */
export async function failJob(db, id, error, { final = false } = {}) {
  const reason = reasonOf(error);
  const r = await db.query(
    `UPDATE marketing_jobs
        SET attempts = attempts + 1,
            status = CASE WHEN $3::boolean OR attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
            error = CASE
                      WHEN $3::boolean THEN $2::text
                      WHEN attempts + 1 >= ${MAX_ATTEMPTS}
                        THEN 'Tried ${MAX_ATTEMPTS} times and it still failed. Last error: ' || $2::text
                      ELSE $2::text
                    END,
            claimed_at = CASE WHEN $3::boolean OR attempts + 1 >= ${MAX_ATTEMPTS} THEN claimed_at ELSE NULL END,
            finished_at = CASE WHEN $3::boolean OR attempts + 1 >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END,
            run_after = CASE
                          WHEN $3::boolean OR attempts + 1 >= ${MAX_ATTEMPTS} THEN run_after
                          WHEN attempts + 1 = 1 THEN now() + interval '${BACKOFF_MINUTES[0]} minutes'
                          ELSE now() + interval '${BACKOFF_MINUTES[1]} minutes'
                        END
      WHERE id = $1 AND status = 'running' AND kind <> '${OFFER_KIND}'
      RETURNING *`,
    [id, reason, final === true]
  );
  return r.rows[0] || null;
}

/**
 * reclaimStale(db, { olderThanMin }) → [{ id, kind, status, attempts }] for every row
 * taken back.
 *
 * A 'running' row claimed more than olderThanMin minutes ago has no worker left (the
 * background function dies at 15). It counts one attempt: back to 'queued' when tries
 * are left, else 'failed' with the reason. Never touches 'offer'. Refuses anything
 * under 16 minutes, because a live worker could still be running that job.
 */
export async function reclaimStale(db, { olderThanMin = STALE_AFTER_MINUTES, kinds, excludeKinds } = /** @type {{ olderThanMin?: number, kinds?: string[] | null, excludeKinds?: string[] | null }} */ ({})) {
  const minutes = Number(olderThanMin);
  if (!Number.isFinite(minutes) || minutes < STALE_AFTER_MINUTES) {
    throw new RangeError(
      `reclaimStale: olderThanMin must be at least ${STALE_AFTER_MINUTES} — a worker can run 15 minutes, so a younger claim may still be running`
    );
  }
  /* kinds / excludeKinds (added 2026-10-06, src/marketing/ai-runner.mjs): when the Mac
     runs the AI jobs, the Netlify worker takes back only its own kinds and the Mac only
     the AI kinds — neither takes a job the other may still be running. No list: every
     kind, exactly as before. */
  const only = kindList(kinds, "kinds");
  const not = kindList(excludeKinds, "excludeKinds");
  if (only && only.length === 0) return [];
  /** @type {any[]} */
  const params = [Math.floor(minutes)];
  let scope = "";
  if (only) { params.push(only); scope += ` AND kind = ANY($${params.length}::text[])`; }
  if (not && not.length) { params.push(not); scope += ` AND NOT (kind = ANY($${params.length}::text[]))`; }
  const r = await db.query(
    `UPDATE marketing_jobs
        SET attempts = attempts + 1,
            status = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'queued' END,
            error = CASE
                      WHEN attempts + 1 >= ${MAX_ATTEMPTS}
                        THEN 'The worker stopped without finishing ${MAX_ATTEMPTS} times (no word for ' || ($1::int)::text || ' minutes each time). It will not try again on its own.'
                      ELSE 'The worker stopped without finishing (no word for ' || ($1::int)::text || ' minutes). Trying again.'
                    END,
            claimed_at = NULL,
            finished_at = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN now() ELSE NULL END,
            run_after = CASE WHEN attempts + 1 >= ${MAX_ATTEMPTS} THEN run_after ELSE now() END
      WHERE status = 'running'
        AND kind <> '${OFFER_KIND}'
        AND COALESCE(claimed_at, created_at) < now() - make_interval(mins => $1::int)${scope}
      RETURNING id, kind, status, attempts`,
    params
  );
  return r.rows;
}

/**
 * retryJob(dbOrTx, { orgId, id, kinds }) → the row (back to 'queued'), or null.
 *
 * What Chris's Retry button calls (POST marketing/jobs/retry). Only a FAILED job of
 * that org, whose kind is in `kinds` (the caller passes the kinds the worker knows),
 * and never 'offer'. Starts clean: attempts 0, no error, no result, due now.
 * Another org's job, an unknown kind, a job that is not failed, or a bad id → null.
 *
 * SAVED STEPS ARE KEPT (unit X2, design §5 rule 18 and §3.2 "Retry … resumes from the
 * saved steps"; "Resume … continues from the saved steps"): a job whose result is a
 * saved-step checkpoint (src/marketing/research/runner.mjs: an object with `steps` and
 * `state`) keeps it, so Retry and Resume carry on from the step that stopped and never pay
 * for a finished step twice. Any other result is cleared as before.
 */
export async function retryJob(dbOrTx, { orgId, id, kinds } = /** @type {any} */ ({})) {
  if (!orgId || !id || !UUID_RE.test(String(id))) return null;
  const only = kindList(kinds, "kinds");
  if (!only || only.length === 0) return null;
  const r = await dbOrTx.query(
    `UPDATE marketing_jobs
        SET status = 'queued', attempts = 0, error = NULL,
            result = CASE
                       WHEN jsonb_typeof(result -> 'steps') = 'object' AND jsonb_typeof(result -> 'state') = 'object'
                         THEN result
                       ELSE NULL
                     END,
            claimed_at = NULL, finished_at = NULL, run_after = now()
      WHERE id = $1 AND org_id = $2
        AND status = 'failed'
        AND kind <> '${OFFER_KIND}'
        AND kind = ANY($3::text[])
      RETURNING *`,
    [String(id), orgId, only]
  );
  return r.rows[0] || null;
}

/**
 * nextRunAfter(db, { kinds, excludeKinds }) → the earliest run_after among queued jobs
 * (a Date), or null when nothing is queued. Never counts 'offer'. The worker uses it to
 * wait inside its pass for a job that is due in a few seconds; pass the same kinds the
 * worker claims, so it never waits on a job it cannot run.
 */
export async function nextRunAfter(db, { kinds, excludeKinds } = /** @type {{ kinds?: string[] | null, excludeKinds?: string[] | null }} */ ({})) {
  const only = kindList(kinds, "kinds");
  const not = kindList(excludeKinds, "excludeKinds") || [];
  if (only && only.length === 0) return null;
  const r = await db.query(
    `SELECT min(run_after) AS next
       FROM marketing_jobs
      WHERE status = 'queued'
        AND kind <> '${OFFER_KIND}'
        AND ($1::text[] IS NULL OR kind = ANY($1::text[]))
        AND NOT (kind = ANY($2::text[]))`,
    [only, not]
  );
  const v = r.rows[0] && r.rows[0].next;
  return v == null ? null : new Date(v);
}
