// @ts-check
// The marketing machine's clock: every 15 minutes it looks for work and wakes the worker.
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 and §4 traps 5-6. Plan unit
// U22. The Netlify shell is netlify/functions/marketing-clock.mjs (a scheduled function:
// killed at 30 seconds), so this only READS, QUEUES and WAKES. Every real piece of work
// (GitHub saves, buzzes, model calls, Meta) runs in the 15-minute background worker
// (src/marketing/worker.mjs). Nothing here imports a model, GitHub or Meta module;
// clock.test.mjs walks the imports and fails if one appears.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT `enabled` MEANS HERE (a reading of the spec, written down on purpose)
//
// Spec M0 step 4 says the clock "does nothing while enabled is false". This clock reads
// `marketing_settings.enabled` as the WEEKLY-BATCH switch only:
//   * enabled false → the batch part logs "disabled" and plans nothing (M0 Done #4).
//   * Either way, the clock still wakes the worker when work is already waiting: repo
//     saves in repo_outbox, a buzz that is due, a job that is due, or a claim the
//     worker never finished. That work comes from Chris's own taps (Write now, a rule
//     edit, a script save), which must work while the weekly schedule is off. Waking the
//     worker for them spends nothing on its own: the worker runs what was asked.
// The gap is on the board for Chris to see once (plan unit U22, build brief).
// ═══════════════════════════════════════════════════════════════════════════
//
// THE WEEKLY BATCH (unit U35, spec §7.7, §2 item 1). For each company with `enabled`
// true, weeklyTick() runs ONE short transaction (a per-company advisory xact lock, so
// two clocks firing at once queue nothing twice):
//   * inside the plan window (3 hours before release_at): INSERT the weekly batch ON
//     CONFLICT on marketing_batches_one_weekly_uq DO NOTHING — one batch per week, even
//     when the clock fires twice;
//   * a weekly batch that is 'planned' or 'failed', from 3 hours before release_at until
//     24 hours after it, with no start_batch queued or running: (back to 'planned') and
//     queue start_batch. So a failed plan is retried on every tick until release_at + 24 h;
//   * a weekly batch that is 'ready' with release_at passed and no release_batch queued
//     or running: queue release_batch (finish_batch already queues it for release_at;
//     this is the backstop);
//   * from 5 hours before release: one voice_export per week (payload week_key);
//   * from the first tick after 02:00 in the settings zone: one nightly_script_check and
//     one expire_drafts per night (payload day).
// With `enabled` false none of that runs: no batch row, no job (M0 Done #4).
//
// LATE DRAFTS (any company). A write_slot that finishes after its batch was released
// (Chris pressed Retry on a failed slot) gets one finish_batch: it counts the batch
// again and queues the new draft's repo file, with no second buzz (spec §7.7).
// followLateDrafts() is one INSERT ... SELECT; it reacts only to Chris's own Retry, the
// same way the wake below serves his taps while the weekly switch is off.
//
// The clock still makes no model, GitHub, Meta or text call: it only reads, inserts rows,
// queues jobs and wakes the worker.
//
// HEARTBEATS (marketing_heartbeats, db/migrations/415_marketing_heartbeats.sql). The clock,
// the worker and the outbox drain serve every company the machine serves, so each beat
// is written on every one of those companies' rows (machineOrgIds). The health card
// (api/marketing/health.mjs) reads its own company's rows.
//
// No transaction is held across anything: every statement here is one short statement.

import { JOB_KINDS } from "./job-kinds.mjs";
import { OFFER_KIND, STALE_AFTER_MINUTES, enqueueJob } from "./jobs.mjs";
import { wakeWorker } from "./wake.mjs";
import { weeklyWindow, BATCH_KINDS, PLAN_LEAD_MS, PLAN_RETRY_MS, LATE_FOLLOW_DAYS } from "./schedule.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { netlifyRegistry } from "./ai-runner.mjs";

/** The schedule. netlify.toml [functions."marketing-clock"] must say the same. */
export const CLOCK_CRON = "*/15 * * * *";

/** The beat names marketing_heartbeats accepts (its name CHECK). */
export const HEARTBEAT_NAMES = Object.freeze(["clock", "worker", "page_seen", "outbox_drain"]);

const LOG = "[marketing-clock]";

/**
 * @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db
 * @typedef {{ outbox_waiting: number, buzzes_due: number, jobs_due: number, stale_claims: number }} Work
 */

/**
 * The job kinds the worker may claim: every kind in the registry except 'offer'
 * (the Write offer button's own path). The clock counts only these, so it never wakes
 * the worker for a job nothing can run.
 * @param {Record<string, any>} [registry]
 * @returns {string[]}
 */
export function workerKinds(registry = JOB_KINDS) {
  return Object.keys(registry || {}).filter((k) => k !== OFFER_KIND).sort();
}

/* ── heartbeats ──────────────────────────────────────────────────────────── */

/**
 * The companies the machine serves: every company with a settings row, plus any
 * company with a repo save waiting or a job queued or running (never 'offer').
 */
export const MACHINE_ORGS_SQL = `
  SELECT org_id FROM marketing_settings
  UNION
  SELECT org_id FROM repo_outbox WHERE committed_sha IS NULL
  UNION
  SELECT org_id FROM marketing_jobs
   WHERE kind <> '${OFFER_KIND}' AND status IN ('queued', 'running')`;

/** @param {Db} db @returns {Promise<string[]>} */
export async function machineOrgIds(db) {
  const r = await db.query(`SELECT org_id FROM (${MACHINE_ORGS_SQL}) o ORDER BY org_id`);
  return r.rows.map((x) => String(x.org_id));
}

function checkName(name) {
  if (!HEARTBEAT_NAMES.includes(name)) {
    throw new TypeError(`heartbeat name must be one of ${HEARTBEAT_NAMES.join(", ")} (got ${JSON.stringify(name)})`);
  }
}

/**
 * beat(db, name, entries, { keepDetail }) → how many rows were written.
 *
 * entries: [{ orgId, detail }]. One statement for all of them. last_at is the
 * database's now(). keepDetail true moves last_at and keeps the detail already saved
 * (a 'busy' drain must not hide the last real result).
 * @param {Db} db
 * @param {string} name
 * @param {Array<{orgId: string, detail?: object}>} entries
 * @param {{ keepDetail?: boolean }} [opts]
 */
export async function beat(db, name, entries, { keepDetail = false } = {}) {
  checkName(name);
  const list = (entries || []).filter((e) => e && e.orgId);
  if (!list.length) return 0;
  const r = await db.query(
    `INSERT INTO marketing_heartbeats (org_id, name, last_at, detail)
     SELECT x.org_id, $1, now(), x.detail::jsonb
       FROM unnest($2::uuid[], $3::text[]) AS x(org_id, detail)
     ON CONFLICT (org_id, name) DO UPDATE
       SET last_at = EXCLUDED.last_at,
           detail = CASE WHEN $4::boolean THEN marketing_heartbeats.detail ELSE EXCLUDED.detail END`,
    [name, list.map((e) => e.orgId), list.map((e) => JSON.stringify(e.detail ?? {})), keepDetail === true]
  );
  return r.rowCount ?? list.length;
}

/**
 * beatMachine(db, name, detail, opts) — the same beat on every company the machine
 * serves (the clock's, the worker's and the drain's).
 * @param {Db} db @param {string} name @param {object} detail @param {{ keepDetail?: boolean }} [opts]
 */
export async function beatMachine(db, name, detail, opts) {
  const orgs = await machineOrgIds(db);
  return beat(db, name, orgs.map((orgId) => ({ orgId, detail })), opts);
}

/**
 * The newest beat of one name across every company → { at: Date|null, detail }.
 * The worker uses it for "at most one drain a minute" across concurrent passes.
 * @param {Db} db @param {string} name
 */
export async function lastBeat(db, name) {
  checkName(name);
  const r = await db.query(
    `SELECT last_at, detail FROM marketing_heartbeats
      WHERE name = $1 ORDER BY last_at DESC LIMIT 1`,
    [name]
  );
  const row = r.rows[0];
  return { at: row ? new Date(row.last_at) : null, detail: row ? row.detail || {} : null };
}

/**
 * One company's beats → { [name]: { last_at: Date, detail } }.
 * @param {Db} db @param {string} orgId
 */
export async function readHeartbeats(db, orgId) {
  const r = await db.query(
    `SELECT name, last_at, detail FROM marketing_heartbeats WHERE org_id = $1`,
    [orgId]
  );
  /** @type {Record<string, {last_at: Date, detail: any}>} */
  const out = {};
  for (const row of r.rows) out[row.name] = { last_at: new Date(row.last_at), detail: row.detail || {} };
  return out;
}

/* ── the clock's reads ───────────────────────────────────────────────────── */

/**
 * @param {Db} db → [{ org_id, enabled, batch_weekday, batch_time, timezone }] for every
 * company with a settings row (the schedule fields feed weeklyTick).
 */
export async function readSettings(db) {
  const r = await db.query(
    `SELECT org_id, enabled, batch_weekday, batch_time::text AS batch_time, timezone
       FROM marketing_settings ORDER BY org_id`
  );
  return r.rows.map((x) => ({
    org_id: String(x.org_id),
    enabled: x.enabled === true,
    batch_weekday: x.batch_weekday == null ? null : Number(x.batch_weekday),
    batch_time: x.batch_time == null ? null : String(x.batch_time),
    timezone: x.timezone == null ? null : String(x.timezone)
  }));
}

/**
 * What is waiting for the worker right now (all companies). Due means due now; a job
 * due later is picked up by a later tick, or by a worker pass already waiting for it.
 * @param {Db} db
 * @param {{ kinds: string[] }} opts
 * @returns {Promise<Work>}
 */
export async function readWaitingWork(db, { kinds }) {
  const r = await db.query(
    `SELECT
       (SELECT count(*) FROM repo_outbox WHERE committed_sha IS NULL)::int AS outbox_waiting,
       (SELECT count(*) FROM marketing_buzzes
         WHERE sent_at IS NULL AND failed_at IS NULL AND send_after <= now())::int AS buzzes_due,
       (SELECT count(*) FROM marketing_jobs
         WHERE status = 'queued' AND kind <> '${OFFER_KIND}'
           AND kind = ANY($1::text[]) AND run_after <= now())::int AS jobs_due,
       (SELECT count(*) FROM marketing_jobs
         WHERE status = 'running' AND kind <> '${OFFER_KIND}'
           AND COALESCE(claimed_at, created_at) < now() - make_interval(mins => $2::int))::int AS stale_claims`,
    [kinds, STALE_AFTER_MINUTES]
  );
  const row = r.rows[0] || {};
  return {
    outbox_waiting: Number(row.outbox_waiting) || 0,
    buzzes_due: Number(row.buzzes_due) || 0,
    jobs_due: Number(row.jobs_due) || 0,
    stale_claims: Number(row.stale_claims) || 0
  };
}

/** True when anything in `work` needs the worker. */
export function hasWork(work) {
  return !!work && (work.outbox_waiting > 0 || work.buzzes_due > 0 || work.jobs_due > 0 || work.stale_claims > 0);
}

/* ── the weekly batch part ───────────────────────────────────────────────── */

/**
 * The weekly-batch part for one company, before weeklyTick runs. Plans nothing itself.
 * enabled false → "disabled" (and weeklyTick is never called). enabled true → "on";
 * tick() fills in what weeklyTick queued.
 * @param {{ org_id: string, enabled: boolean }} settings
 * @returns {{ org_id: string, batch: 'disabled' | 'on', planned: number, note: string }}
 */
export function batchPart(settings) {
  if (!settings.enabled) {
    return { org_id: settings.org_id, batch: "disabled", planned: 0, note: "the weekly batch is off; nothing planned" };
  }
  return { org_id: settings.org_id, batch: "on", planned: 0, note: "the weekly batch is on; nothing to queue this tick" };
}

/* A job of `kind` for batch b (aliased b) that is still waiting or running. */
const OPEN_BATCH_JOB = (kind) => `
  SELECT 1 FROM marketing_jobs j
   WHERE j.org_id = b.org_id AND j.kind = '${kind}'
     AND j.status IN ('queued', 'running')
     AND j.payload->>'batch_id' = b.id::text`;

/**
 * weeklyTick(db, { settings, now }) → { org_id, release_at, week_key, in_plan_window,
 * made_batch, queued:[{kind, batch_id?, week_key?, day?, retry?}] }
 *
 * The weekly batch for ONE company whose `enabled` is true (see the header). One short
 * transaction with a per-company advisory xact lock (pooler-safe: it ends with the
 * transaction). Writes only marketing_batches and marketing_jobs. Never called for a
 * company with `enabled` false.
 *
 * @param {any} db
 * @param {{ settings: { org_id: string, batch_weekday?: number|null, batch_time?: string|null, timezone?: string|null },
 *           now?: Date }} args
 */
export async function weeklyTick(db, { settings, now = new Date() }) {
  const orgId = settings && settings.org_id;
  if (!orgId) throw new TypeError("weeklyTick: settings.org_id is required");
  const w = weeklyWindow(settings, now);
  const at = (now instanceof Date ? now : new Date(now)).toISOString();

  return withTransaction(db, async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('marketing_batches:weekly:' || $1::text, 0))`, [orgId]);
    /** @type {Array<Record<string, any>>} */
    const queued = [];
    const queue = async (kind, payload, extra = {}) => {
      await enqueueJob(tx, { orgId, kind, payload });
      queued.push({ kind, ...extra });
    };

    // 1. The week's batch row, once, inside the plan window.
    let made = null;
    if (w.in_plan_window) {
      const ins = await tx.query(
        `INSERT INTO marketing_batches (org_id, kind, week_key, status, release_at)
         VALUES ($1, 'weekly', $2, 'planned', $3::timestamptz)
         ON CONFLICT (org_id, week_key) WHERE kind = 'weekly' DO NOTHING
         RETURNING id`,
        [orgId, w.week_key, w.release_at.toISOString()]
      );
      made = ins.rows[0] ? String(ins.rows[0].id) : null;
    }

    // 2. Plan (or plan again) every weekly batch in its window with no start_batch open.
    const toPlan = await tx.query(
      `SELECT b.id, b.status
         FROM marketing_batches b
        WHERE b.org_id = $1 AND b.kind = 'weekly'
          AND b.status IN ('planned', 'failed')
          AND b.release_at - make_interval(secs => $3::double precision) <= $2::timestamptz
          AND b.release_at + make_interval(secs => $4::double precision) > $2::timestamptz
          AND NOT EXISTS (${OPEN_BATCH_JOB(BATCH_KINDS.start)})
        ORDER BY b.release_at, b.id`,
      [orgId, at, PLAN_LEAD_MS / 1000, PLAN_RETRY_MS / 1000]
    );
    for (const b of toPlan.rows) {
      const id = String(b.id);
      if (b.status === "failed") {
        await tx.query(
          `UPDATE marketing_batches SET status = 'planned', error = NULL, updated_at = now()
            WHERE id = $1 AND status = 'failed'`,
          [id]
        );
      }
      await queue(BATCH_KINDS.start, { batch_id: id }, { batch_id: id, retry: b.status === "failed" });
    }

    // 3. The release backstop: ready, release time passed, no release_batch open.
    const toRelease = await tx.query(
      `SELECT b.id
         FROM marketing_batches b
        WHERE b.org_id = $1 AND b.kind = 'weekly' AND b.status = 'ready'
          AND b.release_at <= $2::timestamptz
          AND NOT EXISTS (${OPEN_BATCH_JOB(BATCH_KINDS.release)})
        ORDER BY b.release_at, b.id`,
      [orgId, at]
    );
    for (const b of toRelease.rows) await queue(BATCH_KINDS.release, { batch_id: String(b.id) }, { batch_id: String(b.id) });

    // 4. The week's voice export, once per week.
    if (w.voice_due) {
      const seen = await tx.query(
        `SELECT 1 FROM marketing_jobs WHERE org_id = $1 AND kind = $2 AND payload->>'week_key' = $3 LIMIT 1`,
        [orgId, BATCH_KINDS.voice, w.week_key]
      );
      if (!seen.rows.length) await queue(BATCH_KINDS.voice, { week_key: w.week_key }, { week_key: w.week_key });
    }

    // 5. The nightly chores, once per night.
    for (const kind of [BATCH_KINDS.nightly, BATCH_KINDS.expire]) {
      const seen = await tx.query(
        `SELECT 1 FROM marketing_jobs WHERE org_id = $1 AND kind = $2 AND payload->>'day' = $3 LIMIT 1`,
        [orgId, kind, w.nightly_day]
      );
      if (!seen.rows.length) await queue(kind, { day: w.nightly_day }, { day: w.nightly_day });
    }

    return {
      org_id: orgId,
      release_at: w.release_at.toISOString(),
      week_key: w.week_key,
      in_plan_window: w.in_plan_window,
      made_batch: made,
      queued
    };
  });
}

/**
 * followLateDrafts(db) → [{ org_id, batch_id }] for every finish_batch queued.
 *
 * A released batch (in the last 30 days) with a write_slot that finished after the
 * batch was last counted (marketing_batches.updated_at) and no finish_batch open gets
 * one finish_batch {batch_id, late:true}. That only happens when Chris pressed Retry on
 * a failed slot after the release. One statement, every company.
 * @param {Db} db
 */
export async function followLateDrafts(db) {
  const r = await db.query(
    `INSERT INTO marketing_jobs (org_id, kind, payload, run_after)
     SELECT b.org_id, '${BATCH_KINDS.finish}', jsonb_build_object('batch_id', b.id::text, 'late', true), now()
       FROM marketing_batches b
      WHERE b.status = 'released'
        AND b.released_at > now() - make_interval(days => $1::int)
        AND EXISTS (
              SELECT 1 FROM marketing_jobs w
               WHERE w.org_id = b.org_id AND w.kind = '${BATCH_KINDS.write}'
                 AND w.payload->>'batch_id' = b.id::text
                 AND w.status IN ('done', 'failed')
                 AND w.finished_at > b.updated_at)
        AND NOT EXISTS (${OPEN_BATCH_JOB(BATCH_KINDS.finish)})
     RETURNING org_id, payload->>'batch_id' AS batch_id`,
    [LATE_FOLLOW_DAYS]
  );
  return r.rows.map((x) => ({ org_id: String(x.org_id), batch_id: String(x.batch_id) }));
}

/** One log line for what weeklyTick did. @param {any} done */
export function weeklyNote(done) {
  const q = (done && Array.isArray(done.queued)) ? done.queued : [];
  const when = done && done.release_at ? `next drop ${done.release_at} (${done.week_key})` : "next drop unknown";
  if (!q.length) return `the weekly batch is on; ${when}; nothing to queue this tick`;
  const what = q.map((x) => x.kind + (x.retry ? " (retry)" : "")).join(", ");
  return `the weekly batch is on; ${when}; queued ${what}${done.made_batch ? "; made this week's batch" : ""}`;
}

/* ── one tick ────────────────────────────────────────────────────────────── */

/**
 * @typedef {{
 *   readSettings: () => Promise<Array<{org_id: string, enabled: boolean, batch_weekday?: number|null, batch_time?: string|null, timezone?: string|null}>>,
 *   weeklyTick: (settings: any, now: Date) => Promise<{ queued: any[], release_at?: string, week_key?: string, made_batch?: string|null }>,
 *   followLateDrafts: () => Promise<Array<{org_id: string, batch_id: string}>>,
 *   readWaitingWork: (opts: {kinds: string[]}) => Promise<Work>,
 *   machineOrgIds: () => Promise<string[]>,
 *   beat: (name: string, entries: Array<{orgId: string, detail?: object}>) => Promise<number>,
 *   wake: () => Promise<any>,
 *   log: (line: string) => void,
 *   now: () => Date
 * }} ClockDeps
 */

/** The real deps: the database, wakeWorker, console. */
export function clockDeps({ db, env = process.env } = /** @type {any} */ ({})) {
  /** @type {ClockDeps} */
  const deps = {
    readSettings: () => readSettings(db),
    weeklyTick: (settings, now) => weeklyTick(db, { settings, now }),
    followLateDrafts: () => followLateDrafts(db),
    readWaitingWork: (opts) => readWaitingWork(db, opts),
    machineOrgIds: () => machineOrgIds(db),
    beat: (name, entries) => beat(db, name, entries),
    wake: () => wakeWorker(env),
    log: (line) => console.log(line),
    now: () => new Date()
  };
  return deps;
}

const reasonOf = (err) =>
  String((err && typeof err === "object" && "message" in err ? err.message : err) ?? "unknown error")
    .replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error";

/**
 * tick(ctx) → { ok, at, batch:[...], late, work, woke }
 *
 * 1. Read every company's settings (never makes a row).
 * 2. The batch part per company: "disabled" (nothing runs), or "on": weeklyTick queues
 *    what is due (the week's batch and its plan, the release backstop, the voice
 *    export, the nightly chores). A company whose step fails is logged and the others
 *    go on; the next tick is the retry.
 * 3. Late drafts (every company): followLateDrafts.
 * 4. Count the work already waiting (saves, due buzzes, due jobs of kinds the worker
 *    runs, stale claims) — the jobs just queued included.
 * 5. Write the 'clock' beat on every company the machine serves.
 * 6. Wake the worker when work waits. Nothing waiting → no wake.
 *
 * Throws only when the database does on a read (the Netlify shell catches it and still
 * answers 200: the next tick is the retry).
 *
 * @param {{ db?: Db, env?: Record<string, any>, registry?: Record<string, any>, deps?: Partial<ClockDeps> }} [ctx]
 */
export async function tick(ctx = {}) {
  const deps = { ...clockDeps({ db: /** @type {Db} */ (ctx.db), env: ctx.env }), ...(ctx.deps || {}) };
  // MARKETING_AI_RUNNER=local: AI jobs wait for the Mac, so they never wake the worker.
  const kinds = workerKinds(ctx.registry || netlifyRegistry(ctx.env || process.env, JOB_KINDS));
  const at = deps.now();

  const settings = await deps.readSettings();
  /** @type {Array<ReturnType<typeof batchPart> & { error?: string }>} */
  const batch = [];
  for (const s of settings) {
    /** @type {ReturnType<typeof batchPart> & { error?: string }} */
    const part = batchPart(s);
    if (s.enabled) {
      try {
        const done = await deps.weeklyTick(s, at);
        part.planned = Array.isArray(done && done.queued) ? done.queued.length : 0;
        part.note = weeklyNote(done);
      } catch (err) {
        part.error = reasonOf(err);
        part.note = `the weekly batch step failed (${part.error}); the next tick tries again`;
      }
    }
    batch.push(part);
    deps.log(`${LOG} org ${part.org_id.slice(0, 8)}: weekly batch ${part.batch} — ${part.note}`);
  }
  if (!settings.length) deps.log(`${LOG} no company has marketing settings yet: weekly batch disabled — nothing planned`);

  /** @type {Array<{org_id: string, batch_id: string}>} */
  let late = [];
  try {
    late = await deps.followLateDrafts();
    if (late.length) deps.log(`${LOG} late drafts: queued finish_batch for ${late.map((x) => x.batch_id.slice(0, 8)).join(", ")}`);
  } catch (err) {
    deps.log(`${LOG} late-draft check failed (${reasonOf(err)}); the next tick tries again`);
  }

  const work = await deps.readWaitingWork({ kinds });

  const enabledBy = new Map(settings.map((s) => [s.org_id, s.enabled]));
  const plannedBy = new Map(batch.map((b) => [b.org_id, b.planned]));
  const orgs = await deps.machineOrgIds();
  await deps.beat("clock", orgs.map((orgId) => {
    const enabled = enabledBy.get(orgId) === true;
    return { orgId, detail: { enabled, batch: enabled ? "on" : "disabled", planned: plannedBy.get(orgId) ?? 0, work } };
  }));

  let woke = null;
  if (hasWork(work)) {
    woke = await deps.wake();
    const how = woke && woke.started ? "started" : `not started (${(woke && (woke.skipped || woke.reason)) || "no answer"})`;
    deps.log(`${LOG} work waiting ${JSON.stringify(work)} — worker ${how}`);
  } else {
    deps.log(`${LOG} nothing waiting — worker not woken`);
  }

  return { ok: true, at: at.toISOString(), batch, late, work, woke };
}
