// Marketing machine heartbeats for the 7:00 a.m. pulse. Report only. Never auto-fix.
// Never text. A beat is red after 3 times its schedule (clock every 15 min → 45 min).
//
// Sources: db/migrations/415_marketing_heartbeats.sql, src/marketing/clock.mjs,
// api/marketing/health.mjs, src/marketing/worker.mjs (worker + outbox_drain).

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";
import {
  CLOCK_CRON,
  hasWork,
  readWaitingWork,
  workerKinds
} from "../../marketing/clock.mjs";
import { DRAIN_EVERY_MS } from "../../marketing/worker.mjs";
import { netlifyRegistry } from "../../marketing/ai-runner.mjs";
import { JOB_KINDS } from "../../marketing/job-kinds.mjs";

export const SLICE_ID = "03-marketing";

/** Red when last_at is older than scheduleMs × this. */
export const RED_MULTIPLIER = 3;

const MIN_MS = 60 * 1000;
export const CLOCK_INTERVAL_MS = 15 * MIN_MS;

const listed = new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));

/** @param {string} schedule short label in CHECKS (15m, 1m, on-read) */
export function scheduleMs(schedule) {
  if (schedule === "15m") return CLOCK_INTERVAL_MS;
  if (schedule === "1m") return DRAIN_EVERY_MS;
  return null;
}

/** @param {string} schedule */
export function redAfterMs(schedule) {
  const base = scheduleMs(schedule);
  return base == null ? null : base * RED_MULTIPLIER;
}

function beatMeta(id, schedule, proof, { alreadyInRegistry = false } = {}) {
  return {
    id,
    schedule,
    redAfter: `3x ${schedule}`,
    alreadyInRegistry,
    proof
  };
}

export const CHECKS = [
  beatMeta(
    "clock",
    "15m",
    `PASS when max(last_at) for 'clock' is within ${RED_MULTIPLIER * 15} min (415; clock.mjs tick; ${CLOCK_CRON})`
  ),
  beatMeta(
    "worker",
    "15m",
    "PASS when max(last_at) for 'worker' is within 45 min while work waits (415; worker.mjs runPass)"
  ),
  beatMeta(
    "page_seen",
    "on-read",
    "PASS: GET marketing/health writes page_seen (415; api/marketing/health.mjs)",
    { alreadyInRegistry: listed.has("marketing/health") }
  ),
  beatMeta(
    "outbox_drain",
    "1m",
    `PASS when max(last_at) for 'outbox_drain' is within ${RED_MULTIPLIER} min while repo_outbox waits (415; worker.mjs recordDrain)`
  )
];

export const BEATS_SQL = `
  SELECT name, max(last_at) AS last_at
    FROM marketing_heartbeats
   WHERE name = ANY($1::text[])
   GROUP BY name`;

export const MACHINE_ORG_COUNT_SQL = `
  SELECT count(*)::int AS n
    FROM (
      SELECT org_id FROM marketing_settings
      UNION
      SELECT org_id FROM repo_outbox WHERE committed_sha IS NULL
      UNION
      SELECT org_id FROM marketing_jobs WHERE status IN ('queued', 'running')
    ) s`;

const FIX =
  "Read marketing_heartbeats and the Netlify marketing-clock / marketing-worker logs. Do not auto-fix from this pulse.";

function row(id, status, detail, suggestedFix = null) {
  return { id, kind: "marketing", status, detail, suggestedFix };
}

function toDate(v) {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d : null;
}

function stamp(d) {
  return `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function minutesAgo(d, now) {
  return Math.round(((now.getTime() - d.getTime()) / MIN_MS) * 10) / 10;
}

function clip(s, n = 160) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

/**
 * @param {{ scope: (fn: (tx: any) => Promise<any>) => Promise<any>, now?: Date, beats?: Record<string, Date|null>, work?: import("../../marketing/clock.mjs").Work|null, machineOrgs?: number }} ctx
 */
export async function checkClock(ctx) {
  const id = "clock";
  const limit = redAfterMs("15m");
  const last = toDate(ctx.beats && ctx.beats.clock);
  if (ctx.machineOrgs === 0) {
    return row(id, "skip", "no company on the marketing machine yet — nothing for the clock to serve");
  }
  if (!last) {
    return row(id, "FAIL", "the marketing clock has never written a 'clock' heartbeat", FIX);
  }
  const age = minutesAgo(last, ctx.now);
  if (age * MIN_MS > limit) {
    return row(
      id,
      "FAIL",
      `marketing clock last tick ${stamp(last)} (${age} min ago; red after ${limit / MIN_MS} min)`,
      FIX
    );
  }
  return row(id, "PASS", `marketing clock last tick ${stamp(last)} (${age} min ago)`);
}

export async function checkWorker(ctx) {
  const id = "worker";
  const work = ctx.work;
  if (!work || !hasWork(work)) {
    return row(id, "skip", "nothing waiting for the worker — a missing worker beat is not an outage");
  }
  const limit = redAfterMs("15m");
  const last = toDate(ctx.beats && ctx.beats.worker);
  if (!last) {
    return row(id, "FAIL", "work is waiting but the worker has never written a 'worker' heartbeat", FIX);
  }
  const age = minutesAgo(last, ctx.now);
  if (age * MIN_MS > limit) {
    const w = JSON.stringify(work);
    return row(
      id,
      "FAIL",
      `work is waiting (${w}) but the worker last ran ${stamp(last)} (${age} min ago; red after ${limit / MIN_MS} min)`,
      FIX
    );
  }
  return row(id, "PASS", `worker last ran ${stamp(last)} (${age} min ago) with work waiting`);
}

export async function checkPageSeen() {
  return row(
    "page_seen",
    "skip",
    "page_seen beats only when staff read GET marketing/health — not on a timer"
  );
}

export async function checkOutboxDrain(ctx) {
  const id = "outbox_drain";
  const waiting = ctx.work ? Number(ctx.work.outbox_waiting) || 0 : 0;
  if (waiting <= 0) {
    return row(id, "skip", "no repo save waiting — outbox_drain is not expected to beat");
  }
  const limit = redAfterMs("1m");
  const last = toDate(ctx.beats && ctx.beats.outbox_drain);
  if (!last) {
    return row(id, "FAIL", `${waiting} repo save(s) waiting but outbox_drain has never beat`, FIX);
  }
  const age = minutesAgo(last, ctx.now);
  if (age * MIN_MS > limit) {
    return row(
      id,
      "FAIL",
      `${waiting} repo save(s) waiting but outbox_drain last ran ${stamp(last)} (${age} min ago; red after ${limit / MIN_MS} min)`,
      FIX
    );
  }
  return row(id, "PASS", `outbox_drain last ran ${stamp(last)} (${age} min ago) with ${waiting} save(s) waiting`);
}

const RUNNERS = {
  clock: checkClock,
  worker: checkWorker,
  page_seen: checkPageSeen,
  outbox_drain: checkOutboxDrain
};

/** @param {Record<string, any>} rows keyed by heartbeat name */
export function beatsFromRows(rows) {
  /** @type {Record<string, Date|null>} */
  const out = { clock: null, worker: null, page_seen: null, outbox_drain: null };
  for (const r of rows || []) {
    if (r && r.name in out) out[r.name] = toDate(r.last_at);
  }
  return out;
}

/**
 * Run every marketing heartbeat row. `scope(fn)` runs fn(tx) with staff visibility.
 * One broken query becomes its own FAIL; nothing is sent or fixed.
 */
export async function checkMarketing({ scope = null, now = new Date(), checks = CHECKS } = {}) {
  if (!scope) {
    return checks.map((c) => row(c.id, "skip", "no database in this run — heartbeats not read"));
  }
  try {
    const kinds = workerKinds(netlifyRegistry(process.env, JOB_KINDS));
    const { beats, work, machineOrgs } = await scope(async (tx) => {
      const beatRows = (await tx.query(BEATS_SQL, [checks.map((c) => c.id)])).rows;
      const orgRow = (await tx.query(MACHINE_ORG_COUNT_SQL)).rows[0] || {};
      const workNow = await readWaitingWork(tx, { kinds });
      return {
        beats: beatsFromRows(beatRows),
        work: workNow,
        machineOrgs: Number(orgRow.n) || 0
      };
    });
    const ctx = { scope, now, beats, work, machineOrgs };
    const out = [];
    for (const c of checks) {
      const run = RUNNERS[c.id];
      try {
        out.push(await run(ctx));
      } catch (err) {
        out.push(row(
          c.id,
          "FAIL",
          `could not read the ${c.id} heartbeat: ${clip((err && err.message) || err)}`,
          FIX
        ));
      }
    }
    return out;
  } catch (err) {
    return checks.map((c) => row(
      c.id,
      "FAIL",
      `could not read marketing heartbeats: ${clip((err && err.message) || err)}`,
      FIX
    ));
  }
}
