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
// THE WEEKLY BATCH IS NOT SCHEDULED HERE YET. Unit U35 adds batch scheduling to tick()
// (batchPart below is where it goes). Until then an enabled company is logged as "on"
// with nothing planned.
//
// HEARTBEATS (marketing_heartbeats, db/migrations/415_marketing_heartbeats.sql). The clock,
// the worker and the outbox drain serve every company the machine serves, so each beat
// is written on every one of those companies' rows (machineOrgIds). The health card
// (api/marketing/health.mjs) reads its own company's rows.
//
// No transaction is held across anything: every statement here is one short statement.

import { JOB_KINDS } from "./job-kinds.mjs";
import { OFFER_KIND, STALE_AFTER_MINUTES } from "./jobs.mjs";
import { wakeWorker } from "./wake.mjs";

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

/** @param {Db} db → [{ org_id, enabled }] for every company with a settings row. */
export async function readSettings(db) {
  const r = await db.query(`SELECT org_id, enabled FROM marketing_settings ORDER BY org_id`);
  return r.rows.map((x) => ({ org_id: String(x.org_id), enabled: x.enabled === true }));
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
 * The weekly-batch part for one company. Plans nothing in this unit.
 * enabled false → "disabled". enabled true → "on", nothing planned yet (U35 adds the
 * schedule here).
 * @param {{ org_id: string, enabled: boolean }} settings
 * @returns {{ org_id: string, batch: 'disabled' | 'on', planned: number, note: string }}
 */
export function batchPart(settings) {
  if (!settings.enabled) {
    return { org_id: settings.org_id, batch: "disabled", planned: 0, note: "the weekly batch is off; nothing planned" };
  }
  return { org_id: settings.org_id, batch: "on", planned: 0, note: "the weekly batch is on; weekly scheduling is not built yet, nothing planned" };
}

/* ── one tick ────────────────────────────────────────────────────────────── */

/**
 * @typedef {{
 *   readSettings: () => Promise<Array<{org_id: string, enabled: boolean}>>,
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
    readWaitingWork: (opts) => readWaitingWork(db, opts),
    machineOrgIds: () => machineOrgIds(db),
    beat: (name, entries) => beat(db, name, entries),
    wake: () => wakeWorker(env),
    log: (line) => console.log(line),
    now: () => new Date()
  };
  return deps;
}

/**
 * tick(ctx) → { ok, at, batch:[...], work, woke }
 *
 * 1. Read every company's settings (never makes a row).
 * 2. The batch part per company: "disabled" or "on", nothing planned.
 * 3. Count the work already waiting (saves, due buzzes, due jobs of kinds the worker
 *    runs, stale claims).
 * 4. Write the 'clock' beat on every company the machine serves.
 * 5. Wake the worker when work waits. Nothing waiting → no wake.
 *
 * Throws only when the database does (the Netlify shell catches it and still answers
 * 200: the next tick is the retry).
 *
 * @param {{ db?: Db, env?: Record<string, any>, registry?: Record<string, any>, deps?: Partial<ClockDeps> }} [ctx]
 */
export async function tick(ctx = {}) {
  const deps = { ...clockDeps({ db: /** @type {Db} */ (ctx.db), env: ctx.env }), ...(ctx.deps || {}) };
  const kinds = workerKinds(ctx.registry || JOB_KINDS);
  const at = deps.now();

  const settings = await deps.readSettings();
  const batch = settings.map((s) => batchPart(s));
  for (const b of batch) {
    deps.log(`${LOG} org ${b.org_id.slice(0, 8)}: weekly batch ${b.batch} — ${b.note}`);
  }
  if (!settings.length) deps.log(`${LOG} no company has marketing settings yet: weekly batch disabled — nothing planned`);

  const work = await deps.readWaitingWork({ kinds });

  const enabledBy = new Map(settings.map((s) => [s.org_id, s.enabled]));
  const orgs = await deps.machineOrgIds();
  await deps.beat("clock", orgs.map((orgId) => {
    const enabled = enabledBy.get(orgId) === true;
    return { orgId, detail: { enabled, batch: enabled ? "on" : "disabled", planned: 0, work } };
  }));

  let woke = null;
  if (hasWork(work)) {
    woke = await deps.wake();
    const how = woke && woke.started ? "started" : `not started (${(woke && (woke.skipped || woke.reason)) || "no answer"})`;
    deps.log(`${LOG} work waiting ${JSON.stringify(work)} — worker ${how}`);
  } else {
    deps.log(`${LOG} nothing waiting — worker not woken`);
  }

  return { ok: true, at: at.toISOString(), batch, work, woke };
}
