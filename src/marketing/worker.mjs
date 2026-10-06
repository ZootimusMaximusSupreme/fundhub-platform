// @ts-check
// The marketing machine's worker: one pass of real work, inside a 15-minute background
// function (netlify/functions/marketing-worker-background.mjs).
//
// Spec docs/specs/marketing-machine-2026-10-04.md §6 Step 4 (the worker, buzzes),
// §6 Step 2 (the outbox drain, at most once a minute) and §4 traps 3 and 5. Plan unit U22.
// Woken by the clock (src/marketing/clock.mjs, every 15 minutes), by a save
// (src/marketing/wake.mjs), and by itself when it stops with work left.
//
// ONE PASS, IN THIS ORDER
//   1. 'worker' heartbeat (state running).
//   2. reclaimStale: a job claimed more than 16 minutes ago has no worker left (a
//      background function dies at 15). Never touches 'offer'.
//   3. Then a loop until minute 9:
//        a. drain the repo outbox — at most once a minute across every pass (the
//           'outbox_drain' heartbeat holds the time and the last result, which the
//           health card reads for held_reason);
//        b. send the buzzes that are due (notify-fanout send(); every 30 seconds);
//        c. claim and start jobs from JOB_KINDS: group 'writer' up to 3 at once,
//           every other group 1 at a time. The caps hold across passes too: a claim
//           counts the running jobs of its group in the database first, under a
//           transaction-scoped advisory lock (pooler-safe, never a session lock);
//        d. nothing to claim and nothing running: read the earliest queued run_after
//           (and when saves are waiting, the next drain minute). If it falls before
//           minute 9, wait until then and loop — so a job that re-queues itself 10
//           seconds out (the Meta video poll) runs in the same pass. Otherwise stop.
//   4. At minute 9 it stops TAKING work. Jobs already running get until minute 14 to
//      finish (the function is killed at 15; reclaimStale picks up anything cut off).
//   5. Work left (a queued job due within the next pass's 9 minutes) → wake itself.
//   6. 'worker' heartbeat (state done, with what the pass did).
//
// NEVER 'offer'. The Write offer button's jobs run on their own path
// (src/marketing/offer-store.mjs). They are filtered out of the kinds, excluded in every
// claim, and a claimed row of that kind would be refused, never run.
//
// NO TRANSACTION IS HELD ACROSS A CALL. Every database step is one short statement or
// one short transaction; the drain, the texts and the job handlers run outside them
// (spec §4 trap 3).
//
// A JOB HANDLER (src/marketing/job-kinds.mjs) exports run(job, ctx), ctx = {db, env, deps,
// finishByMs} (finishByMs: the time, in ms, by which this pass stops waiting for jobs).
// Returning finishes the job with the return value as its result. Throwing fails it
// (jobs.mjs failJob counts an attempt; an error with `final: true` fails it at once, for
// a cost cap). A handler that re-queues its own job (requeueJob) and returns is fine:
// finishJob then finds it no longer running and changes nothing.
//
// Everything outside this file is injected through `deps`, so worker.test.mjs runs whole
// passes on a fake clock with no database, no network and no texts.

import { timingSafeEqual } from "node:crypto";
import { JOB_KINDS } from "./job-kinds.mjs";
import {
  OFFER_KIND, STALE_AFTER_MINUTES,
  claimJobs, finishJob, failJob, reclaimStale, nextRunAfter
} from "./jobs.mjs";
import { sendDueBuzzes } from "./notify.mjs";
import { wakeWorker, workerSecret } from "./wake.mjs";
import { beatMachine, lastBeat, workerKinds } from "./clock.mjs";
import { drainOutbox } from "../repo/outbox.mjs";
import { send as fanoutSend } from "../ad-videos/notify-fanout.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

/** Stop taking new work this long after the pass starts. */
export const STOP_TAKING_MS = 9 * 60 * 1000;

/** At most one outbox drain this often (spec §6 Step 2). */
export const DRAIN_EVERY_MS = 60 * 1000;

/** Buzz check this often while a pass runs. */
export const BUZZ_EVERY_MS = 30 * 1000;

/** While jobs run, look up at least this often (to drain and buzz on time). */
export const TICK_MS = 15 * 1000;

/** A job is due but no slot could be claimed (another pass holds the cap): look again in this long. */
export const BUSY_WAIT_MS = 5 * 1000;

/** The shortest wait in the idle loop, so it can never spin. */
export const MIN_WAIT_MS = 1000;

/** Stop waiting for running jobs this long after the start: Netlify kills the function at 15 minutes. */
export const FINISH_BY_MS = 14 * 60 * 1000;

/** How many jobs of each group run at once. A group not named here runs 1 at a time. */
export const GROUP_CAPS = Object.freeze({ writer: 3, loader: 1, system: 1 });

/** The header the clock and every wake prove themselves with. */
export const AUTH_HEADER = "x-fundhub-worker";

const LOG = "[marketing-worker]";
const MAX_REASON = 300;

/**
 * @typedef {{ query: (sql: string, params?: any[]) => Promise<{ rows: any[], rowCount?: number | null }> }} Db
 * @typedef {{
 *   beat: (name: string, detail: object, opts?: { keepDetail?: boolean }) => Promise<any>,
 *   lastDrain: () => Promise<{ at: Date | null, detail: any }>,
 *   outboxWaiting: () => Promise<number>,
 *   reclaimStale: (opts: { olderThanMin: number }) => Promise<any[]>,
 *   drainOutbox: () => Promise<any>,
 *   recordDrain: (result: any) => Promise<any>,
 *   sendDueBuzzes: () => Promise<any>,
 *   claim: (opts: { group: string, kinds: string[], limit: number }) => Promise<any[]>,
 *   finishJob: (id: string, result: any) => Promise<any>,
 *   failJob: (id: string, error: any, opts: { final: boolean }) => Promise<any>,
 *   nextRunAfter: (opts: { kinds: string[] }) => Promise<Date | null>,
 *   wake: () => Promise<any>,
 *   now: () => Date,
 *   sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
 *   log: (line: string) => void
 * }} WorkerDeps
 */

const reasonOf = (err) =>
  String((err && typeof err === "object" && "message" in err ? err.message : err) ?? "unknown error")
    .replace(/\s+/g, " ").trim().slice(0, MAX_REASON) || "unknown error";

/* ── the drain's record ──────────────────────────────────────────────────── */

/**
 * Why saves are held, from one drain result: 'no_token', 'dry_run' or null.
 * @param {any} result
 * @returns {'no_token' | 'dry_run' | null}
 */
export function heldReasonOf(result) {
  const s = result && result.skipped;
  return s === "no_token" || s === "dry_run" ? s : null;
}

/**
 * What the 'outbox_drain' heartbeat keeps from a drain result: short, no file contents,
 * never a token (drainOutbox already redacts its errors).
 * @param {any} result
 */
export function drainSummary(result) {
  const r = result && typeof result === "object" ? result : {};
  /** @type {Record<string, any>} */
  const out = { held_reason: heldReasonOf(r) };
  if (r.skipped) out.skipped = String(r.skipped);
  if (r.committed_sha) {
    out.committed_sha = String(r.committed_sha);
    out.committed = Array.isArray(r.ids) ? r.ids.length : 0;
  }
  if (Array.isArray(r.deduped) && r.deduped.length) out.deduped = r.deduped.length;
  if (Array.isArray(r.rejected) && r.rejected.length) out.rejected = r.rejected.length;
  if (r.unchanged) out.unchanged = true;
  if (r.error) out.error = reasonOf(r.error);
  if (r.retry) out.retry = true;
  return out;
}

/**
 * Save a drain result on the 'outbox_drain' heartbeat of every company the machine
 * serves. A 'busy' drain (another drain held the lease) moves the time only, so it
 * never hides the last real result from the health card.
 * @param {Db} db @param {any} result
 */
export function recordDrain(db, result) {
  return beatMachine(db, "outbox_drain", drainSummary(result), { keepDetail: !!result && result.skipped === "busy" });
}

/**
 * When a waiting save could next be drained, from the last drain's result: null when
 * draining again would not help (held for no token or dry run, another drain busy, or a
 * refusal that only clears when its claim expires).
 * @param {any} detail the drain summary (drainSummary) or a raw result
 */
export function drainWorthRetrying(detail) {
  if (!detail || typeof detail !== "object") return true;
  if (detail.held_reason || heldReasonOf(detail)) return false;
  if (detail.skipped === "busy") return false;
  if (detail.error && !detail.retry) return false;
  return true;
}

/* ── claims ──────────────────────────────────────────────────────────────── */

/**
 * Claim up to `limit` jobs of one group, holding the group's cap across every pass:
 * one short transaction, a transaction-scoped advisory lock on the group, count its
 * running jobs, claim at most what is left (FOR UPDATE SKIP LOCKED, never 'offer').
 * @param {any} db
 * @param {{ group: string, kinds: string[], limit: number }} opts
 */
export async function claimForGroup(db, { group, kinds, limit }) {
  const cap = Object.prototype.hasOwnProperty.call(GROUP_CAPS, group) ? GROUP_CAPS[/** @type {keyof typeof GROUP_CAPS} */ (group)] : 1;
  const only = (kinds || []).filter((k) => k !== OFFER_KIND);
  if (!only.length || limit <= 0) return [];
  return withTransaction(db, async (tx) => {
    await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended('marketing_jobs:group:' || $1, 0))`, [group]);
    const r = await tx.query(
      `SELECT count(*)::int AS n FROM marketing_jobs
        WHERE status = 'running' AND kind <> '${OFFER_KIND}' AND kind = ANY($1::text[])`,
      [only]
    );
    const free = Math.min(limit, cap - (Number(r.rows[0] && r.rows[0].n) || 0));
    if (free <= 0) return [];
    return claimJobs(tx, { limit: free, kinds: only, excludeKinds: [OFFER_KIND] });
  });
}

/* ── the real deps ───────────────────────────────────────────────────────── */

/** A wait that a race can cancel, so a finished race leaves no timer behind. */
function realSleep(ms, signal) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, Math.max(0, ms));
    if (signal) signal.addEventListener("abort", () => { clearTimeout(t); resolve(undefined); }, { once: true });
  });
}

/**
 * The real deps: the database, the outbox drain, notify-fanout's send, wakeWorker.
 * @param {{ db?: any, env?: Record<string, any>, send?: Function }} [opts]
 * @returns {WorkerDeps}
 */
export function workerDeps({ db, env = process.env, send } = {}) {
  const buzzSend = typeof send === "function" ? send : (message) => fanoutSend(message, { env });
  return {
    beat: (name, detail, opts) => beatMachine(db, name, detail, opts),
    lastDrain: () => lastBeat(db, "outbox_drain"),
    outboxWaiting: async () => {
      const r = await db.query(`SELECT count(*)::int AS n FROM repo_outbox WHERE committed_sha IS NULL`);
      return Number(r.rows[0] && r.rows[0].n) || 0;
    },
    reclaimStale: (opts) => reclaimStale(db, opts),
    drainOutbox: () => drainOutbox(db, env),
    recordDrain: (result) => recordDrain(db, result),
    sendDueBuzzes: async () => {
      // Quiet hours for a retry: the one company's settings when there is exactly one
      // (Fundhub), else the spec default (21:00-07:00 Arizona). A new buzz already
      // waits through quiet hours from the moment it is queued.
      const s = (await db.query(`SELECT quiet_start, quiet_end, timezone FROM marketing_settings LIMIT 2`)).rows;
      const one = s.length === 1 ? s[0] : null;
      return sendDueBuzzes(db, {
        send: buzzSend,
        quietStart: one ? one.quiet_start : undefined,
        quietEnd: one ? one.quiet_end : undefined,
        tz: one ? one.timezone : undefined
      });
    },
    claim: (opts) => claimForGroup(db, opts),
    finishJob: (id, result) => finishJob(db, id, result),
    failJob: (id, error, opts) => failJob(db, id, error, opts),
    nextRunAfter: ({ kinds }) => nextRunAfter(db, { kinds, excludeKinds: [OFFER_KIND] }),
    wake: () => wakeWorker(env),
    now: () => new Date(),
    sleep: realSleep,
    log: (line) => console.log(line)
  };
}

/** Kinds by group, from the registry (never 'offer'). */
export function groupKinds(registry = JOB_KINDS) {
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const kind of workerKinds(registry)) {
    const group = String((registry[kind] && registry[kind].group) || "system");
    if (!groups.has(group)) groups.set(group, []);
    /** @type {string[]} */ (groups.get(group)).push(kind);
  }
  return groups;
}

/* ── one pass ────────────────────────────────────────────────────────────── */

/**
 * runPass(ctx) → what the pass did:
 *   { started_at, finished_at, stopped: 'minute_9' | 'idle', reclaimed, drains,
 *     last_drain, buzzes, claimed, done, handed_back, failed, waits, rewoke, errors }
 *
 * Never throws: a part that fails is logged and counted in `errors`, and the pass goes on.
 *
 * @param {{ db?: any, env?: Record<string, any>, send?: Function,
 *           registry?: Record<string, any>, deps?: Partial<WorkerDeps>, jobDeps?: object }} [ctx]
 */
export async function runPass(ctx = {}) {
  const env = ctx.env || process.env;
  /** @type {WorkerDeps} */
  const deps = { ...workerDeps({ db: ctx.db, env, send: ctx.send }), ...(ctx.deps || {}) };
  const registry = ctx.registry || JOB_KINDS;
  const kinds = workerKinds(registry);
  const groups = groupKinds(registry);
  const startMs = deps.now().getTime();
  const deadline = startMs + STOP_TAKING_MS;
  // finishByMs: when this pass stops waiting for running jobs (minute 14). A multi-step
  // job (the avatar run, unit X1) reads it to size its model calls and to hand a step
  // to the next pass rather than start one it cannot finish before Netlify's 15-minute kill.
  const jobCtx = { db: ctx.db, env, deps: ctx.jobDeps || {}, finishByMs: startMs + FINISH_BY_MS };
  const summary = {
    started_at: new Date(startMs).toISOString(),
    finished_at: /** @type {string | null} */ (null),
    stopped: /** @type {'minute_9' | 'idle' | null} */ (null),
    reclaimed: 0,
    drains: 0,
    last_drain: /** @type {any} */ (null),
    buzzes: { sent: 0, retrying: 0, gave_up: 0, skipped: 0 },
    claimed: 0,
    done: 0,
    handed_back: 0,
    failed: 0,
    waits: 0,
    still_running: 0,
    rewoke: false,
    errors: /** @type {string[]} */ ([])
  };

  /** @template T @param {string} what @param {() => Promise<T>} fn @param {T} fallback @returns {Promise<T>} */
  const safe = async (what, fn, fallback) => {
    try { return await fn(); }
    catch (err) {
      const line = `${what}: ${reasonOf(err)}`;
      summary.errors.push(line);
      deps.log(`${LOG} ${line}`);
      return fallback;
    }
  };

  await safe("heartbeat", () => deps.beat("worker", { state: "running", started_at: summary.started_at }), null);
  const reclaimed = await safe("reclaim", () => deps.reclaimStale({ olderThanMin: STALE_AFTER_MINUTES }), []);
  summary.reclaimed = Array.isArray(reclaimed) ? reclaimed.length : 0;

  /* ── the drain, at most once a minute across every pass ── */
  let myLastDrainMs = -Infinity;
  /** @type {any} */
  let myLastDrain = null;

  /** The last drain anyone made: { atMs, detail }. */
  const lastDrainSeen = async () => {
    const hb = await safe("read drain beat", () => deps.lastDrain(), { at: null, detail: null });
    const hbMs = hb && hb.at ? new Date(hb.at).getTime() : -Infinity;
    if (myLastDrainMs >= hbMs) return { atMs: myLastDrainMs, detail: myLastDrain };
    return { atMs: hbMs, detail: hb.detail };
  };

  const maybeDrain = async (t) => {
    const seen = await lastDrainSeen();
    if (t - seen.atMs < DRAIN_EVERY_MS) return;
    myLastDrainMs = t;
    const result = await safe("drain", () => deps.drainOutbox(), { error: "the drain threw" });
    myLastDrain = drainSummary(result);
    summary.drains += 1;
    summary.last_drain = myLastDrain;
    await safe("record drain", () => deps.recordDrain(result), null);
  };

  /** When waiting saves could next be drained (ms), or null. */
  const nextDrainMs = async () => {
    const waiting = await safe("count waiting saves", () => deps.outboxWaiting(), 0);
    if (!(waiting > 0)) return null;
    const seen = await lastDrainSeen();
    if (!drainWorthRetrying(seen.detail)) return null;
    return Number.isFinite(seen.atMs) ? seen.atMs + DRAIN_EVERY_MS : deps.now().getTime();
  };

  /* ── jobs ── */
  /** @type {Map<string, { group: string, promise: Promise<void> }>} */
  const inFlight = new Map();

  const runJob = async (job) => {
    const entry = registry[job.kind];
    try {
      if (!entry || job.kind === OFFER_KIND) {
        throw Object.assign(new Error(`the worker has no handler for job kind "${job.kind}"`), { final: true });
      }
      const mod = await entry.load();
      if (!mod || typeof mod.run !== "function") {
        throw Object.assign(new Error(`the ${job.kind} handler does not export run(job, ctx)`), { final: true });
      }
      const result = await mod.run(job, jobCtx);
      const row = await safe(`finish ${job.kind}`, () => deps.finishJob(job.id, result), null);
      if (row) summary.done += 1;
      else summary.handed_back += 1;
    } catch (err) {
      summary.failed += 1;
      deps.log(`${LOG} job ${job.kind} ${String(job.id).slice(0, 8)} failed: ${reasonOf(err)}`);
      await safe(`fail ${job.kind}`, () => deps.failJob(job.id, err, { final: !!(err && err.final === true) }), null);
    }
  };

  const start = (job, group) => {
    summary.claimed += 1;
    const promise = runJob(job).finally(() => { inFlight.delete(job.id); });
    inFlight.set(job.id, { group, promise });
  };

  const fill = async () => {
    for (const [group, groupKindsList] of groups) {
      const cap = Object.prototype.hasOwnProperty.call(GROUP_CAPS, group) ? GROUP_CAPS[/** @type {keyof typeof GROUP_CAPS} */ (group)] : 1;
      let busy = 0;
      for (const x of inFlight.values()) if (x.group === group) busy += 1;
      const free = cap - busy;
      if (free <= 0) continue;
      const claimed = await safe(`claim ${group}`, () => deps.claim({ group, kinds: groupKindsList, limit: free }), []);
      let started = 0;
      for (const job of Array.isArray(claimed) ? claimed : []) {
        if (!job || job.kind === OFFER_KIND || !groupKindsList.includes(job.kind)) {
          // Never runs: the claim handed back something this group did not ask for.
          deps.log(`${LOG} refused a claimed job of kind ${JSON.stringify(job && job.kind)} for group ${group}`);
          continue;
        }
        if (started >= free) break;
        started += 1;
        start(job, group);
      }
    }
  };

  /** Wait for any running job to end, or `ms`, whichever comes first. */
  const waitForAny = async (ms) => {
    const ac = new AbortController();
    try {
      await Promise.race([...[...inFlight.values()].map((x) => x.promise), deps.sleep(ms, ac.signal)]);
    } finally {
      ac.abort();
    }
  };

  let lastBuzzMs = -Infinity;
  for (;;) {
    const t = deps.now().getTime();
    if (t >= deadline) { summary.stopped = "minute_9"; break; }

    await maybeDrain(t);

    if (t - lastBuzzMs >= BUZZ_EVERY_MS) {
      lastBuzzMs = t;
      const b = await safe("buzzes", () => deps.sendDueBuzzes(), null);
      if (b && typeof b === "object") {
        for (const k of /** @type {const} */ (["sent", "retrying", "gave_up", "skipped"])) summary.buzzes[k] += Number(b[k]) || 0;
      }
    }

    await fill();

    if (inFlight.size) {
      const left = deadline - deps.now().getTime();
      await waitForAny(Math.max(MIN_WAIT_MS, Math.min(TICK_MS, left)));
      continue;
    }

    // Nothing running and nothing claimable. Wait for the next thing due before minute 9.
    const now = deps.now().getTime();
    const nextJob = await safe("next job", () => deps.nextRunAfter({ kinds }), null);
    const due = [];
    if (nextJob) {
      const ms = new Date(nextJob).getTime();
      // Due already but nobody could claim it: another pass holds the group's slots.
      if (Number.isFinite(ms)) due.push(ms <= now ? now + BUSY_WAIT_MS : ms);
    }
    const drainAt = await nextDrainMs();
    if (drainAt != null && Number.isFinite(drainAt)) due.push(drainAt);
    const next = due.length ? Math.min(...due) : null;
    if (next != null && next < deadline) {
      summary.waits += 1;
      await deps.sleep(Math.min(TICK_MS, Math.max(MIN_WAIT_MS, next - now)));
      continue;
    }
    summary.stopped = "idle";
    break;
  }

  // Minute 9 (or idle): take nothing new, let what is running finish — up to minute 14,
  // so the last heartbeat is written before Netlify kills the function at 15. A job still
  // running then stays 'running' and reclaimStale takes it back after 16 minutes.
  while (inFlight.size && deps.now().getTime() < startMs + FINISH_BY_MS) {
    await waitForAny(Math.max(MIN_WAIT_MS, Math.min(TICK_MS, startMs + FINISH_BY_MS - deps.now().getTime())));
  }
  summary.still_running = inFlight.size;
  if (inFlight.size) deps.log(`${LOG} ${inFlight.size} job(s) still running at minute 14; the next pass takes them back after 16 minutes`);

  // Work left that the next pass could start on: wake it now rather than at the next tick.
  const endMs = deps.now().getTime();
  const nextAfter = await safe("next job", () => deps.nextRunAfter({ kinds }), null);
  if (nextAfter && new Date(nextAfter).getTime() <= endMs + STOP_TAKING_MS) {
    summary.rewoke = true;
    const w = await safe("wake", () => deps.wake(), null);
    deps.log(`${LOG} work left — woke the next pass (${w && w.started ? "started" : `not started: ${(w && (w.skipped || w.reason)) || "no answer"}`})`);
  }

  summary.finished_at = new Date(deps.now().getTime()).toISOString();
  await safe("heartbeat", () => deps.beat("worker", { state: "done", ...summary }), null);
  deps.log(`${LOG} pass done: ${JSON.stringify({ ...summary, errors: summary.errors.length })}`);
  return summary;
}

/* ── the door ────────────────────────────────────────────────────────────── */

/**
 * True only when a secret is set (and not a masked copy) and the header carries exactly
 * that secret. Compared in constant time.
 * @param {string | null} expected @param {unknown} got
 */
export function secretMatches(expected, got) {
  if (!expected || typeof got !== "string" || !got) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(got, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The background function's handler. THIS IS AN OPEN URL: without the header
 * x-fundhub-worker equal to MARKETING_WORKER_SECRET it answers a plain 404 and runs
 * nothing. No secret set (or a masked copy) is a CLOSED door, never an open one —
 * and then nothing queued ever runs, which the health card shows as a worker that
 * never beats.
 * @param {{ db?: any, env?: Record<string, any>, pass?: (ctx: any) => Promise<any> }} [opts]
 */
export function makeWorkerHandler({ db, env = process.env, pass = runPass } = {}) {
  return async function marketingWorker(req) {
    const expected = workerSecret(env);
    const got = req && req.headers && typeof req.headers.get === "function" ? req.headers.get(AUTH_HEADER) : null;
    if (!secretMatches(expected, got)) {
      console.error(`${LOG} refused: ${expected ? "the shared secret did not match" : "MARKETING_WORKER_SECRET is not set (closed door)"}`);
      return new Response("no", { status: 404 });
    }
    console.log(`${LOG} build ${String(env.COMMIT_REF || "unknown").slice(0, 8)} starting a pass`);
    let out;
    try {
      out = await pass({ db, env });
    } catch (err) {
      out = { ok: false, error: reasonOf(err) };
      console.error(`${LOG} pass threw: ${out.error}`);
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  };
}
