// @ts-check
// src/marketing/batch-run.mjs — a batch's life after the clock (or Write now) queues it:
// plan it, write it, count it, release it, and later expire what Chris never touched.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §7.7 (Release), §7.5 (the planner),
// §7.6 (the writer), §7.9 (repo files), §7.4 (statuses), §2 items 1 and 4. Plan unit U35.
//
// FOUR WORKER JOBS (src/marketing/job-kinds.mjs, group 'system'; the background worker
// runs them, never the 30-second clock):
//
//   start_batch   {batch_id, count?, funnel_key?, idea_ids?}
//       Queued by the clock (a weekly batch, 3 hours before release_at) or by Write now
//       (an on-command batch, src/marketing/ideas-store.mjs). Pins the rules commit
//       (GitHub's main, else none), reads angles.json at that commit (else the bundled
//       copy), then ONE staff transaction: gatherPlanInputs → planBatch → savePlan, one
//       write_slot job per slot, one finish_batch job, status 'writing'.
//       An empty plan (no funnel turned on) → status 'failed' with the reason in words.
//       A run that throws is tried again by the queue; the last try marks the batch
//       'failed' with the reason, and the clock plans a weekly batch again on every tick
//       until release_at + 24 h.
//   finish_batch  {batch_id, late?}
//       Waits (re-queues itself every 30 seconds, no attempt counted) until no write_slot
//       of the batch is queued or running. Then counts: ready = scripts written (the live
//       version of each), flagged = those still "needs a look", failed = slots with no
//       script. 'writing' → 'ready', and release_batch is queued for release_at (now, for
//       Write now). On a batch already released (a late draft after Chris's Retry): the
//       counts are updated and the new drafts' repo files are queued. Never a buzz.
//   release_batch {batch_id}
//       UPDATE ... SET status='released' WHERE status='ready' AND release_at <= now()
//       RETURNING. Only when that changed a row: every draft's repo file is queued
//       (mode 'replace', serializeScript) and ONE buzz "Scripts: N of M ready, K failed."
//       is queued, all in the same transaction. A Write now batch buzzes only when the
//       page_seen heartbeat is older than 2 minutes (Chris is not on the page).
//   expire_drafts {day}
//       Machine drafts (source 'machine', still 'draft', live version) whose batch was
//       released more than draft_expiry_days ago → 'expired', and their repo file is
//       queued with the new status. Imports and anything Chris touched are never expired.
//
// THE REPO IS PUBLIC. A machine draft's file is queued at release, never before (the
// writer saves drafts to the database only). Drafts are visible only once their batch is
// released and release_at has passed (scripts-store.mjs VISIBLE_SQL).
//
// NO TRANSACTION IS HELD ACROSS A NETWORK CALL. The two GitHub reads in start_batch (the
// main ref and angles.json) run before its transaction opens. ad_scripts and ads force
// partner row security, so every read or write of them runs inside asStaff().
//
// The buzz is a row in marketing_buzzes (src/marketing/notify.mjs queueBuzz); the worker
// sends it after quiet hours. Nothing here sends a text, calls a model, or reaches Meta.

import { asStaff as defaultAsStaff } from "../partners/rls.mjs";
import { gatherPlanInputs, savePlan } from "./planner-data.mjs";
import { planBatch } from "./planner.mjs";
import { enqueueJob, requeueJob, MAX_ATTEMPTS } from "./jobs.mjs";
import { queueScriptFile, isFlagged } from "./scripts-store.mjs";
import { queueBuzz } from "./notify.mjs";
import { getRef as defaultGetRef, getContents as defaultGetContents } from "../repo/github.mjs";
import { ANGLES_PATH } from "../repo/edit-ops.mjs";
import { BATCH_KINDS, FINISH_POLL_MS, chrisOnPage, scriptsReadyText } from "./schedule.mjs";

/** The buzz kind for "your scripts are here". One per batch (group_key = the batch id). */
export const SCRIPTS_READY_KIND = "scripts_ready";

/** Who a file the machine queues is "updated_by" (script-file.mjs front matter). */
export const MACHINE = "machine";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db */

const reasonOf = (err) =>
  String((err && typeof err === "object" && "message" in err ? err.message : err) ?? "unknown error")
    .replace(/\s+/g, " ").trim().slice(0, 500) || "unknown error";

/** A clock for this run: deps.now() or the real one. @param {any} deps */
function nowOf(deps) {
  const n = deps && typeof deps.now === "function" ? deps.now() : new Date();
  return n instanceof Date ? n : new Date(n);
}

/**
 * asStaff() takes a pool. The worker passes src/db.mjs's `db` (query only), which means
 * the app's own pool; a test passes deps.pool (a function) or a pg Pool. Same rule as
 * the writer (src/marketing/writer.mjs scopeDeps).
 * @param {any} db @param {any} deps
 */
function scopeOf(db, deps) {
  if (deps && typeof deps.pool === "function") return { pool: deps.pool };
  if (db && typeof db.connect === "function") return { pool: () => db };
  if (db && typeof db.pool === "function") return { pool: db.pool };
  return {};
}

/**
 * Run fn in one staff transaction.
 * @template T @param {any} db @param {any} deps @param {(tx: Db) => Promise<T>} fn @returns {Promise<T>}
 */
export function inStaff(db, deps, fn) {
  const asStaff = (deps && deps.asStaff) || defaultAsStaff;
  return asStaff(fn, scopeOf(db, deps));
}

/** @param {unknown} id @param {string} what */
function needBatchId(id, what) {
  if (typeof id !== "string" || !UUID_RE.test(id)) {
    throw Object.assign(new Error(`${what}: the job names no batch (batch_id is missing or not an id)`), { final: true });
  }
  return id;
}

/* ── start_batch ─────────────────────────────────────────────────────────── */

/**
 * The commit the batch's rules are read at: main's head on GitHub, or null when GitHub
 * cannot be read (no token, the dry-run fence, an outage). The writer then reads the
 * newest copy it can (GitHub, else the files bundled with the function).
 * @param {Record<string, any>} env @param {any} deps
 */
export async function pinRules(env, deps = {}) {
  const getRef = deps.getRef || defaultGetRef;
  try {
    const r = await getRef({ env, fetchImpl: deps.fetchImpl });
    return r && r.ok && typeof r.sha === "string" && /^[0-9a-f]{7,64}$/i.test(r.sha) ? r.sha : null;
  } catch {
    return null;
  }
}

/**
 * angles.json at the pinned commit as [{key, name}], or null (the planner then reads the
 * copy bundled with the function: planner-data.mjs readBundledAngles).
 * @param {Record<string, any>} env @param {string|null} sha @param {any} deps
 */
export async function readAnglesAt(env, sha, deps = {}) {
  if (!sha) return null;
  const getContents = deps.getContents || defaultGetContents;
  try {
    const r = await getContents(ANGLES_PATH, { ref: sha, env, fetchImpl: deps.fetchImpl });
    if (!r || !r.ok || typeof r.content !== "string") return null;
    const list = JSON.parse(r.content);
    if (!Array.isArray(list)) return null;
    return list
      .filter((a) => a && typeof a.key === "string")
      .map((a) => ({ key: a.key, name: typeof a.name === "string" ? a.name : null }));
  } catch {
    return null;
  }
}

/**
 * Why a plan came out empty, in plain words.
 * @param {any} inputs @param {any} onCommand
 */
export function emptyPlanReason(inputs, onCommand) {
  const funnels = Array.isArray(inputs && inputs.funnels) ? inputs.funnels : [];
  if (onCommand && onCommand.funnel_key && !funnels.some((f) => f.key === onCommand.funnel_key)) {
    return `There is no funnel called ${onCommand.funnel_key}, so there was nothing to write. Pick a funnel from Settings and try again.`;
  }
  if (!funnels.some((f) => f.active !== false)) {
    return "No funnel is turned on, so there was nothing to write. Turn one on in Settings.";
  }
  return "The plan came out with no scripts to write.";
}

/**
 * startBatch(db, env, {orgId, batchId, payload}, deps) → what it did:
 *   {batch_id, kind, status:'writing', slots, rules_sha, ideas_held}
 *   {failed:true, reason}              an empty plan (the batch is now 'failed')
 *   {skipped:'not_found'|'not_planned', status?}
 * Throws on anything else (the queue tries again).
 * @param {any} db @param {Record<string, any>} env
 * @param {{ orgId: string, batchId: string, payload?: any }} args @param {any} [deps]
 */
export async function startBatch(db, env, { orgId, batchId, payload = {} }, deps = {}) {
  const now = nowOf(deps);
  const first = (await db.query(
    `SELECT id, kind, status FROM marketing_batches WHERE id = $1 AND org_id = $2`, [batchId, orgId])).rows[0];
  if (!first) return { skipped: "not_found" };
  if (first.status !== "planned" && first.status !== "failed") return { skipped: "not_planned", status: first.status };

  // The network reads come first, outside every transaction.
  const rulesSha = await pinRules(env, deps);
  const angles = await readAnglesAt(env, rulesSha, deps);

  return inStaff(db, deps, async (tx) => {
    const row = (await tx.query(
      `SELECT id, org_id, kind, status FROM marketing_batches WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [batchId, orgId])).rows[0];
    if (!row) return { skipped: "not_found" };
    if (row.status !== "planned" && row.status !== "failed") return { skipped: "not_planned", status: row.status };
    if (row.status === "failed") {
      await tx.query(`UPDATE marketing_batches SET status = 'planned', error = NULL, updated_at = now() WHERE id = $1`, [batchId]);
    }

    const p = payload && typeof payload === "object" ? payload : {};
    const onCommand = row.kind === "on_command"
      ? {
          count: Number.isInteger(p.count) && p.count > 0 ? p.count : null,
          funnel_key: typeof p.funnel_key === "string" && p.funnel_key ? p.funnel_key : null,
          idea_ids: Array.isArray(p.idea_ids) ? p.idea_ids.map(String) : [],
          batch_id: batchId
        }
      : null;

    const inputs = await gatherPlanInputs(tx, { orgId, now, onCommand, angles });
    const plan = planBatch(inputs);

    if (!plan.slots.length) {
      const reason = emptyPlanReason(inputs, onCommand);
      await tx.query(
        `UPDATE marketing_batches
            SET status = 'failed', error = $2, plan = $3::jsonb, rules_sha = $4, total = 0, updated_at = now()
          WHERE id = $1`,
        [batchId, reason, JSON.stringify(plan), rulesSha]
      );
      return { failed: true, reason };
    }

    const saved = await savePlan(tx, { batchId, plan, rulesSha });
    if (!saved) return { skipped: "not_planned" };

    for (const slot of plan.slots) {
      await enqueueJob(tx, { orgId, kind: BATCH_KINDS.write, payload: { batch_id: batchId, slot } });
    }
    await enqueueJob(tx, {
      orgId, kind: BATCH_KINDS.finish, payload: { batch_id: batchId },
      runAfter: new Date(now.getTime() + FINISH_POLL_MS)
    });
    await tx.query(
      `UPDATE marketing_batches SET status = 'writing', updated_at = now() WHERE id = $1 AND status = 'planned'`,
      [batchId]
    );
    return {
      batch_id: batchId, kind: row.kind, status: "writing", slots: plan.slots.length,
      rules_sha: rulesSha, ideas_held: saved.ideas_held
    };
  });
}

/**
 * The last try of a start_batch that threw: the batch says 'failed', with why, so the
 * Command Center shows it and the clock plans a weekly batch again on its next tick.
 * @param {Db} db @param {string} orgId @param {string} batchId @param {unknown} err
 */
export async function markPlanFailed(db, orgId, batchId, err) {
  const reason = `Planning the batch failed: ${reasonOf(err)}`.slice(0, 1000);
  const r = await db.query(
    `UPDATE marketing_batches SET status = 'failed', error = $3, updated_at = now()
      WHERE id = $1 AND org_id = $2 AND status = 'planned'`,
    [batchId, orgId, reason]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * start_batch's handler. A throw on its last try (3rd run, or an error marked final)
 * marks the batch failed before the queue marks the job failed.
 * @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx]
 */
export async function runStartBatch(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const batchId = needBatchId(p.batch_id, "start_batch");
  try {
    return await startBatch(ctx.db, ctx.env || process.env, { orgId: job.org_id, batchId, payload: p }, ctx.deps || {});
  } catch (err) {
    const last = (Number(job.attempts) || 0) + 1 >= MAX_ATTEMPTS || !!(err && /** @type {any} */ (err).final === true);
    if (last) {
      try { await markPlanFailed(ctx.db, job.org_id, batchId, err); } catch { /* the job's own error is the one worth keeping */ }
    }
    throw err;
  }
}

/* ── finish_batch ────────────────────────────────────────────────────────── */

/**
 * How many write_slot jobs of the batch are still queued or running.
 * @param {Db} db @param {string} orgId @param {string} batchId
 */
export async function openSlots(db, orgId, batchId) {
  const r = await db.query(
    `SELECT count(*)::int AS n FROM marketing_jobs
      WHERE org_id = $1 AND kind = '${BATCH_KINDS.write}' AND status IN ('queued', 'running')
        AND payload->>'batch_id' = $2`,
    [orgId, batchId]
  );
  return Number(r.rows[0] && r.rows[0].n) || 0;
}

/**
 * The batch's counts from its scripts: ready = the live version of every script written
 * for the batch, flagged = those still "needs a look", failed = planned slots with no
 * script. Pure.
 * @param {number} total @param {any[]} scripts
 */
export function countBatch(total, scripts) {
  const list = Array.isArray(scripts) ? scripts : [];
  const ready = list.length;
  const flagged = list.filter((s) => isFlagged(s)).length;
  const t = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0;
  return { total: t, ready, flagged, failed: Math.max(0, t - ready) };
}

const LIVE_SCRIPTS_SQL = `
  SELECT id, root_script_id, source, status, check_results, repo_path
    FROM ad_scripts
   WHERE org_id = $1 AND batch_id = $2 AND archived_at IS NULL
   ORDER BY created_at, id`;

/**
 * finishBatch(db, env, {orgId, batchId}, deps) →
 *   {wait:true, open}                   slots still being written (the handler re-queues)
 *   {status, counts, late_files, release_queued}
 *   {skipped:'not_found'|'not_started'|'failed'}
 * @param {any} db @param {Record<string, any>} env
 * @param {{ orgId: string, batchId: string }} args @param {any} [deps]
 */
export async function finishBatch(db, env, { orgId, batchId }, deps = {}) {
  const first = (await db.query(
    `SELECT id, status FROM marketing_batches WHERE id = $1 AND org_id = $2`, [batchId, orgId])).rows[0];
  if (!first) return { skipped: "not_found" };
  if (first.status === "planned") return { skipped: "not_started" };
  if (first.status === "failed") return { skipped: "failed" };

  const open = await openSlots(db, orgId, batchId);
  if (open > 0) return { wait: true, open };

  return inStaff(db, deps, async (tx) => {
    const b = (await tx.query(
      `SELECT id, kind, status, total, release_at FROM marketing_batches WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [batchId, orgId])).rows[0];
    if (!b) return { skipped: "not_found" };
    const scripts = (await tx.query(LIVE_SCRIPTS_SQL, [orgId, batchId])).rows;
    const counts = countBatch(b.total, scripts);

    const upd = (await tx.query(
      `UPDATE marketing_batches
          SET ready = $2, flagged = $3, failed = $4,
              status = CASE WHEN status = 'writing' THEN 'ready' ELSE status END,
              updated_at = now()
        WHERE id = $1
        RETURNING status, release_at`,
      [batchId, counts.ready, counts.flagged, counts.failed])).rows[0];

    // A batch already out: a late draft (Chris pressed Retry on a slot). Its file now.
    let lateFiles = 0;
    if (b.status === "released") {
      for (const s of scripts) {
        if (s.repo_path) continue;
        await queueScriptFile(tx, { orgId, scriptId: String(s.id), opId: `u35:file:${s.id}`, updatedBy: MACHINE });
        lateFiles += 1;
      }
    }

    // Ready: release at release_at (Write now: right away). Never two waiting.
    let releaseQueued = false;
    if (upd.status === "ready") {
      const already = await tx.query(
        `SELECT 1 FROM marketing_jobs
          WHERE org_id = $1 AND kind = '${BATCH_KINDS.release}' AND status IN ('queued', 'running')
            AND payload->>'batch_id' = $2 LIMIT 1`,
        [orgId, batchId]
      );
      if (!already.rows.length) {
        const at = new Date(upd.release_at);
        await enqueueJob(tx, {
          orgId, kind: BATCH_KINDS.release, payload: { batch_id: batchId },
          runAfter: Number.isFinite(at.getTime()) && at.getTime() > nowOf(deps).getTime() ? at : null
        });
        releaseQueued = true;
      }
    }
    return { status: upd.status, counts, late_files: lateFiles, release_queued: releaseQueued };
  });
}

/**
 * finish_batch's handler: while slots are still being written it puts itself back in the
 * queue 30 seconds out (no attempt counted) and returns.
 * @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx]
 */
export async function runFinishBatch(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const batchId = needBatchId(p.batch_id, "finish_batch");
  const deps = ctx.deps || {};
  /** @type {any} */
  const out = await finishBatch(ctx.db, ctx.env || process.env, { orgId: job.org_id, batchId }, deps);
  if (out && out.wait) {
    const requeue = deps.requeueJob || ((id, opts) => requeueJob(ctx.db, id, opts));
    await requeue(job.id, { runAfter: new Date(nowOf(deps).getTime() + FINISH_POLL_MS) });
  }
  return out;
}

/* ── release_batch ───────────────────────────────────────────────────────── */

/**
 * releaseBatch(db, env, {orgId, batchId}, deps) →
 *   {released:false}                                 not ready, not due, or already out
 *   {released:true, kind, files, buzzed, counts}
 * @param {any} db @param {Record<string, any>} env
 * @param {{ orgId: string, batchId: string }} args @param {any} [deps]
 */
export async function releaseBatch(db, env, { orgId, batchId }, deps = {}) {
  return inStaff(db, deps, async (tx) => {
    const upd = (await tx.query(
      `UPDATE marketing_batches
          SET status = 'released', released_at = now(), updated_at = now()
        WHERE id = $1 AND org_id = $2 AND status = 'ready' AND release_at <= now()
        RETURNING id, kind, total, ready, flagged, failed, released_at`,
      [batchId, orgId])).rows[0];
    if (!upd) return { released: false };

    const scripts = (await tx.query(LIVE_SCRIPTS_SQL, [orgId, batchId])).rows;
    for (const s of scripts) {
      await queueScriptFile(tx, { orgId, scriptId: String(s.id), opId: `u35:file:${s.id}`, updatedBy: MACHINE });
    }

    const counts = { total: Number(upd.total), ready: Number(upd.ready), flagged: Number(upd.flagged), failed: Number(upd.failed) };
    let onPage = false;
    if (upd.kind === "on_command") {
      const seen = (await tx.query(
        `SELECT last_at, now() AS db_now FROM marketing_heartbeats WHERE org_id = $1 AND name = 'page_seen'`,
        [orgId])).rows[0];
      onPage = !!seen && chrisOnPage(seen.last_at, seen.db_now);
    }
    let buzzed = false;
    if (!onPage) {
      const s = (await tx.query(
        `SELECT quiet_start::text AS quiet_start, quiet_end::text AS quiet_end, timezone
           FROM marketing_settings WHERE org_id = $1`,
        [orgId])).rows[0] || {};
      await queueBuzz(tx, {
        orgId, kind: SCRIPTS_READY_KIND, body: scriptsReadyText(counts), groupKey: `batch:${batchId}`,
        quietStart: s.quiet_start ?? undefined, quietEnd: s.quiet_end ?? undefined, tz: s.timezone ?? undefined,
        now: nowOf(deps)
      });
      buzzed = true;
    }
    return { released: true, kind: upd.kind, files: scripts.length, buzzed, counts };
  });
}

/** release_batch's handler. @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx] */
export async function runReleaseBatch(job, ctx = {}) {
  const p = (job && job.payload) || {};
  const batchId = needBatchId(p.batch_id, "release_batch");
  return releaseBatch(ctx.db, ctx.env || process.env, { orgId: job.org_id, batchId }, ctx.deps || {});
}

/* ── expire_drafts ───────────────────────────────────────────────────────── */

/**
 * expireDrafts(db, env, {orgId}, deps) → {expired, days}
 * Machine drafts, still drafts, live version, in a batch released more than
 * draft_expiry_days ago (default 14) → 'expired'. Each one's repo file is queued with
 * the new status. Imports, Chris's own versions and scripts with no batch never expire.
 * @param {any} db @param {Record<string, any>} env
 * @param {{ orgId: string }} args @param {any} [deps]
 */
export async function expireDrafts(db, env, { orgId }, deps = {}) {
  const s = (await db.query(`SELECT draft_expiry_days FROM marketing_settings WHERE org_id = $1`, [orgId])).rows[0];
  const raw = s ? Number(s.draft_expiry_days) : NaN;
  const days = Number.isInteger(raw) && raw > 0 ? raw : 14;
  return inStaff(db, deps, async (tx) => {
    const r = await tx.query(
      `UPDATE ad_scripts s
          SET status = 'expired'
         FROM marketing_batches b
        WHERE s.batch_id = b.id
          AND s.org_id = $1 AND b.org_id = $1
          AND s.source = 'machine' AND s.status = 'draft' AND s.archived_at IS NULL
          AND b.status = 'released' AND b.released_at IS NOT NULL
          AND b.released_at <= now() - make_interval(days => $2::int)
        RETURNING s.id`,
      [orgId, days]
    );
    for (const row of r.rows) {
      await queueScriptFile(tx, { orgId, scriptId: String(row.id), opId: `u35:expire:${row.id}`, updatedBy: MACHINE });
    }
    return { expired: r.rows.length, days };
  });
}

/** expire_drafts' handler. @param {any} job @param {{ db?: any, env?: any, deps?: any }} [ctx] */
export async function runExpireDrafts(job, ctx = {}) {
  return expireDrafts(ctx.db, ctx.env || process.env, { orgId: job.org_id }, ctx.deps || {});
}
