// GET /api/marketing/health — the health card on the Command Center's Today tab.
//
// Route key "marketing/health" (netlify/functions/api.mjs ROUTES; the key is this file's
// path under api/). Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 and §8.3.
// Contract: docs/specs/marketing-machine-api.md §6.5 (fixed shape 6). Plan unit U22.
//
//   GET → 200 {clock:{last_tick_at, enabled},
//              worker:{last_run_at, queued, running, failed_24h:[{kind, error, at}]},
//              outbox:{waiting, oldest_waiting_at, last_commit_sha, last_commit_at,
//                      last_error, token_present, held_reason},
//              sync:{last_sync_at},
//              model:{month_cost_usd, max_month_cost_usd, last_batch_cost_usd, max_batch_cost_usd},
//              as_of}
//
// Where each part comes from:
//   clock / worker   the 'clock' and 'worker' heartbeats (marketing_heartbeats, 415).
//                    clock.enabled is marketing_settings.enabled: the WEEKLY-BATCH switch.
//   worker counts    marketing_jobs for this company, never kind 'offer' (the Write
//                    offer button's own path). failed_24h: failed in the last 24 hours,
//                    newest first, with the plain reason.
//   outbox           repo_outbox for this company: rows waiting, the oldest one, the last
//                    commit, the newest error on a waiting row. token_present says whether
//                    GITHUB_REPO_TOKEN is set and not a masked copy — the value is never
//                    read into the answer. held_reason: 'no_token' when it is not set;
//                    'dry_run' when the last drain (the 'outbox_drain' heartbeat) was held
//                    by the dry-run fence; else null.
//   sync             the later of the Meta connection's last sync and the newest saved
//                    ad-day (readLastSync, api/marketing/today.mjs).
//   model            costStatus (src/marketing/model-usage.mjs): this Arizona month, and
//                    the newest batch (marketing_batches); null when there is no batch.
//                    Model bills in dollars (_usd), not client money.
//   as_of            when this answer was built.
//
// IT ALSO WRITES TWO SMALL THINGS: the settings row on the first read (with the
// defaults, as GET marketing/settings does) and a 'page_seen' heartbeat for the caller
// (Write now uses it to know Chris is on the page). Nothing else.
//
// Owner and admin only: requireAuth, then requireRole(ROLE_SETS.MARKETING) (requireAuth
// ignores roles, CLAUDE.md §12), then a company on the session. One short staff
// transaction; no GitHub, Meta or model call.

import { db } from "../../src/db.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole } from "../../src/http/read-api.mjs";
import { staffRead, sendNotReady, hasCompany } from "../../src/marketing/http.mjs";
import { getOrCreateSettings } from "../../src/marketing/settings-store.mjs";
import { beat, readHeartbeats } from "../../src/marketing/clock.mjs";
import { OFFER_KIND } from "../../src/marketing/jobs.mjs";
import { costStatus } from "../../src/marketing/model-usage.mjs";
import { repoToken } from "../../src/repo/github.mjs";
import { readLastSync } from "./today.mjs";

export const ROUTE = "marketing/health";

/** failed_24h looks back this far and lists at most this many. */
export const FAILED_WINDOW_HOURS = 24;
export const FAILED_LIST_MAX = 20;

function iso(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ── the reads (exported so the .pg test runs the SQL directly) ─────────── */

/** readJobCounts(tx, {orgId}) → { queued, running, failed_24h:[{kind, error, at}] } */
export async function readJobCounts(tx, { orgId }) {
  const counts = await tx.query(
    `SELECT count(*) FILTER (WHERE status = 'queued')::int  AS queued,
            count(*) FILTER (WHERE status = 'running')::int AS running
       FROM marketing_jobs
      WHERE org_id = $1 AND kind <> '${OFFER_KIND}'`,
    [orgId]
  );
  const failed = await tx.query(
    `SELECT kind, error, COALESCE(finished_at, updated_at) AS at
       FROM marketing_jobs
      WHERE org_id = $1 AND kind <> '${OFFER_KIND}' AND status = 'failed'
        AND COALESCE(finished_at, updated_at) > now() - make_interval(hours => $2::int)
      ORDER BY COALESCE(finished_at, updated_at) DESC, id
      LIMIT $3`,
    [orgId, FAILED_WINDOW_HOURS, FAILED_LIST_MAX]
  );
  return {
    queued: Number(counts.rows[0] && counts.rows[0].queued) || 0,
    running: Number(counts.rows[0] && counts.rows[0].running) || 0,
    failed_24h: failed.rows.map((r) => ({ kind: r.kind, error: r.error, at: iso(r.at) }))
  };
}

/** readOutbox(tx, {orgId}) → { waiting, oldest_waiting_at, last_commit_sha, last_commit_at, last_error } */
export async function readOutbox(tx, { orgId }) {
  const r = await tx.query(
    `SELECT
       (SELECT count(*) FROM repo_outbox WHERE org_id = $1 AND committed_sha IS NULL)::int AS waiting,
       (SELECT min(created_at) FROM repo_outbox WHERE org_id = $1 AND committed_sha IS NULL) AS oldest_waiting_at,
       (SELECT error FROM repo_outbox
         WHERE org_id = $1 AND committed_sha IS NULL AND error IS NOT NULL
         ORDER BY id DESC LIMIT 1) AS last_error,
       c.committed_sha AS last_commit_sha,
       c.committed_at  AS last_commit_at
     FROM (SELECT 1) AS one
     LEFT JOIN LATERAL (
       SELECT committed_sha, committed_at FROM repo_outbox
        WHERE org_id = $1 AND committed_sha IS NOT NULL
        ORDER BY committed_at DESC, id DESC LIMIT 1
     ) c ON true`,
    [orgId]
  );
  const row = r.rows[0] || {};
  return {
    waiting: Number(row.waiting) || 0,
    oldest_waiting_at: iso(row.oldest_waiting_at),
    last_commit_sha: row.last_commit_sha || null,
    last_commit_at: iso(row.last_commit_at),
    last_error: row.last_error || null
  };
}

/** The newest batch's id for this company, or null. */
export async function readLastBatchId(tx, { orgId }) {
  const r = await tx.query(
    `SELECT id FROM marketing_batches WHERE org_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
    [orgId]
  );
  return r.rows[0] ? String(r.rows[0].id) : null;
}

/**
 * held_reason: 'no_token' when the token is not set (or masked); 'dry_run' when the last
 * drain was held by the dry-run fence; else null. Pure.
 * @param {{tokenPresent: boolean, drain: any}} args
 */
export function heldReason({ tokenPresent, drain }) {
  if (!tokenPresent) return "no_token";
  const d = drain || {};
  if (d.held_reason === "dry_run" || d.skipped === "dry_run") return "dry_run";
  return null;
}

/** The later of two times, as ISO; null when both are unknown. */
export function laterOf(a, b) {
  const x = iso(a);
  const y = iso(b);
  if (!x) return y;
  if (!y) return x;
  return x > y ? x : y;
}

/**
 * The answer, from what was read. Pure.
 */
export function healthView({ settings, beats, jobs, outbox, sync, cost, lastBatchId, tokenPresent, now }) {
  const drain = beats.outbox_drain ? beats.outbox_drain.detail : null;
  const lastError = outbox.last_error
    || (outbox.waiting > 0 && drain && drain.error ? String(drain.error) : null);
  return {
    clock: {
      last_tick_at: iso(beats.clock && beats.clock.last_at),
      enabled: settings.enabled === true
    },
    worker: {
      last_run_at: iso(beats.worker && beats.worker.last_at),
      queued: jobs.queued,
      running: jobs.running,
      failed_24h: jobs.failed_24h
    },
    outbox: {
      waiting: outbox.waiting,
      oldest_waiting_at: outbox.oldest_waiting_at,
      last_commit_sha: outbox.last_commit_sha,
      last_commit_at: outbox.last_commit_at,
      last_error: lastError,
      token_present: tokenPresent === true,
      held_reason: heldReason({ tokenPresent, drain })
    },
    sync: { last_sync_at: laterOf(sync && sync.meta_synced_at, sync && sync.metrics_synced_at) },
    model: {
      month_cost_usd: numOrNull(cost && cost.month_usd),
      max_month_cost_usd: numOrNull(settings.max_month_cost_usd),
      last_batch_cost_usd: lastBatchId ? numOrNull(cost && cost.batch_usd) : null,
      max_batch_cost_usd: numOrNull(settings.max_batch_cost_usd)
    },
    as_of: iso(now)
  };
}

/* ── the route ───────────────────────────────────────────────────────────── */

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed", message: "Use GET to read the marketing health card." });
  }

  // The gate, in this file on purpose: scripts/journeys/extract.mjs reads each route's
  // gate from the route's own source (src/marketing/http.mjs gateMarketing does the
  // same three steps).
  const auth = deps.requireAuth ?? requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.MARKETING)) return;
  if (!hasCompany(res, staff)) return;
  const orgId = staff.org_id;

  try {
    const now = new Date();
    const tokenPresent = !!repoToken(env);
    const body = await staffRead(database, async (tx) => {
      const settings = await getOrCreateSettings(tx, orgId);
      await beat(tx, "page_seen", [{ orgId, detail: { staff_id: staff.id ?? null, role: staff.role ?? null } }]);
      const beats = await readHeartbeats(tx, orgId);
      const jobs = await readJobCounts(tx, { orgId });
      const outbox = await readOutbox(tx, { orgId });
      const sync = await readLastSync(tx, { orgId });
      const lastBatchId = await readLastBatchId(tx, { orgId });
      const cost = await costStatus(tx, {
        orgId,
        batchId: lastBatchId,
        maxBatchUsd: settings.max_batch_cost_usd,
        maxMonthUsd: settings.max_month_cost_usd,
        now
      });
      return healthView({ settings, beats, jobs, outbox, sync, cost, lastBatchId, tokenPresent, now });
    });
    return res.status(200).json(body);
  } catch (err) {
    if (sendNotReady(res, err, "The marketing health card")) return;
    if (dbDown(res, err)) return;
    throw err;
  }
}
