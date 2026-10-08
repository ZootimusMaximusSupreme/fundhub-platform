// Marketing machine job queue for the morning pulse. Read only. Report only.
//
// Lane: every marketing_jobs row except meta_load (script writing, research, the
// weekly batch chores, funnel pushes). Slice 3 already watches the marketing
// clock, worker, page_seen, and outbox drain. Slice 4 and the ads lane already
// watch Meta spend sync and the meta_load rows. This file does not repeat any.
//
// A kind list is not used on purpose. A new job kind is watched the day it lands,
// and a renamed kind cannot make the query match nothing.
//
// Tripwire is existing Recon (AG-07). The marketing clock (every 15 minutes,
// red after 3 times that) is the existing wait. Do not add another watcher.
// Do not start a paid model run. Do not claim a job. Do not wake the worker.
//
// The read-API check runs the same SELECT readers GET /api/marketing/health runs,
// in this process, and one GET of the live route to see that it is routed. It
// never calls the handler: the handler writes a settings row and a page_seen beat.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Left to the ads lane. */
export const SKIPPED_KINDS = Object.freeze(["meta_load"]);

/** Same red line as the marketing clock: 15 minutes, then 3 times that. Not a new schedule. */
export const CLOCK_EVERY_MS = 15 * 60 * 1000;
export const RED_MULTIPLIER = 3;
export const QUEUE_WAIT_MS = CLOCK_EVERY_MS * RED_MULTIPLIER;

/** A failed row older than this is history, not this morning's news. */
export const FAILED_LOOKBACK_DAYS = 7;

/** A saved note that says nothing. jobs.mjs reasonOf() writes the first one. Matched anywhere in the note. */
export const EMPTY_FAIL_NOTES = Object.freeze([
  "failed, no reason recorded",
  "no reason recorded",
  "no reason was saved"
]);

export const JOB_READ_PATH = "/api/marketing/health";
const FETCH_TIMEOUT_MS = 10000;

export const CHECK_IDS = Object.freeze([
  "marketing-queue:stuck-queued",
  "marketing-queue:failed-no-note",
  "marketing-queue:read-api"
]);

const TRIP =
  "Recon (AG-07) is the one tripwire. Do not start a paid model run. Do not auto-fix.";

const FIX_STUCK =
  `Read marketing_jobs for rows still queued past the clock wait. ` +
  `Use the existing marketing clock or the existing Mac queue runner. ${TRIP}`;

const FIX_NOTE =
  `Read the failed marketing_jobs row and its error note. A failed job must say why. ${TRIP}`;

const FIX_READ =
  `Read GET ${JOB_READ_PATH}. Do not add another door. ${TRIP}`;

const STUCK_SQL = `
  /* gap:stuck-queued */
  SELECT count(*)::int AS n,
         string_agg(DISTINCT kind, ', ' ORDER BY kind) AS kinds
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND status = 'queued'
     AND kind <> ALL($2::text[])
     AND run_after < $3::timestamptz
`;

const FAILED_SQL = `
  /* gap:failed-no-note */
  SELECT count(*)::int AS n,
         string_agg(DISTINCT kind, ', ' ORDER BY kind) AS kinds
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND status = 'failed'
     AND kind <> ALL($2::text[])
     AND COALESCE(finished_at, updated_at) > $4::timestamptz
     AND (
       error IS NULL
       OR btrim(COALESCE(error, '')) = ''
       OR error ILIKE ANY($3::text[])
     )
`;

const SETTINGS_SQL = `
  /* gap:job-read-settings */
  SELECT enabled, max_batch_cost_usd, max_month_cost_usd
    FROM marketing_settings
   WHERE org_id = $1::uuid
`;

const DEFAULT_ORG_SQL = `SELECT id FROM orgs WHERE is_default LIMIT 1`;

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 180);
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : null;
}

function kindsOf(result) {
  const k = String(result?.rows?.[0]?.kinds || "").trim();
  return k ? ` (${k.slice(0, 80)})` : "";
}

function waitMinutes() {
  return QUEUE_WAIT_MS / 60000;
}

function assertSelect(sql) {
  const bare = String(sql).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  if (!/^select\b/i.test(bare) || /\b(insert|update|delete|drop)\b/i.test(bare)) {
    throw new Error("marketing queue gap check is read-only");
  }
}

function tableNotLive(err) {
  return !!err && err.code === "42P01" && /relation "?(public\.)?marketing_/i.test(String(err.message || ""));
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function originOf(baseUrl) {
  const raw = String(baseUrl || "https://fundhub.ai").trim() || "https://fundhub.ai";
  return raw.replace(/\/+$/, "");
}

function apiAlive(status) {
  return (
    (status >= 200 && status < 300) ||
    status === 400 ||
    status === 401 ||
    status === 403 ||
    status === 405
  );
}

/**
 * Repo-level proof that GET marketing/health is still wired and is still the
 * job-count door that starts no model. It reads source files, which a deployed
 * function does not carry, so the morning pulse does not call it. The test does.
 */
export function jobReadRouteAlive(readText = defaultReadText) {
  const api = readText("netlify/functions/api.mjs");
  const health = readText("api/marketing/health.mjs");
  const imported = /import marketingHealth from ["'][^"']*api\/marketing\/health\.mjs["']/.test(api);
  const routed = /"marketing\/health"\s*:\s*marketingHealth/.test(api);
  const door = /export async function readJobCounts/.test(health)
    && /req\.method !== "GET"/.test(health)
    && /export default async function handler/.test(health);
  const startsModel = /\b(callModel|runPass|enqueueJob|claimJobs|wakeWorker|wakeOfferWorker)\b/.test(health);
  return imported && routed && door && !startsModel;
}

/** Staff scope when the pulse has one (marketing tables are row-secured), else the db. */
function runnerOf(ctx) {
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

async function companyOf(ctx, run) {
  if (ctx.orgId) return String(ctx.orgId);
  if (!run) return null;
  try {
    const out = await run((tx) => tx.query(DEFAULT_ORG_SQL));
    return out?.rows?.[0]?.id ? String(out.rows[0].id) : null;
  } catch {
    return null;
  }
}

async function checkStuck({ run, orgId, now }) {
  const id = "marketing-queue:stuck-queued";
  if (!run) return row(id, "skip", "no database in this run — queued jobs not read");
  if (!orgId) return row(id, "skip", "no company in this run — queued jobs not read");
  const cutoff = new Date(now.getTime() - QUEUE_WAIT_MS).toISOString();
  try {
    assertSelect(STUCK_SQL);
    const out = await run((tx) => tx.query(STUCK_SQL, [orgId, [...SKIPPED_KINDS], cutoff]));
    const n = countOf(out);
    if (n == null) {
      return row(id, "FAIL", "queued job count was not a number", FIX_STUCK);
    }
    if (n === 0) {
      return row(id, "PASS", `no marketing job is queued past the ${waitMinutes()} minute wait`);
    }
    const noun = n === 1 ? "job is" : "jobs are";
    return row(
      id,
      "FAIL",
      `${n} ${noun} still queued past the ${waitMinutes()} minute wait${kindsOf(out)}`,
      FIX_STUCK
    );
  } catch (err) {
    if (tableNotLive(err)) {
      return row(id, "skip", "marketing_jobs is not live yet — queued jobs not read");
    }
    return row(id, "FAIL", `could not read queued jobs: ${clip(err)}`, FIX_STUCK);
  }
}

async function checkFailedNote({ run, orgId, now }) {
  const id = "marketing-queue:failed-no-note";
  if (!run) return row(id, "skip", "no database in this run — failed jobs not read");
  if (!orgId) return row(id, "skip", "no company in this run — failed jobs not read");
  const since = new Date(now.getTime() - FAILED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    assertSelect(FAILED_SQL);
    const notes = EMPTY_FAIL_NOTES.map((n) => `%${n}%`);
    const out = await run((tx) => tx.query(FAILED_SQL, [orgId, [...SKIPPED_KINDS], notes, since]));
    const n = countOf(out);
    if (n == null) {
      return row(id, "FAIL", "failed-job count was not a number", FIX_NOTE);
    }
    if (n === 0) {
      return row(id, "PASS", `every marketing job that failed in the last ${FAILED_LOOKBACK_DAYS} days has a note`);
    }
    const noun = n === 1 ? "failed job has" : "failed jobs have";
    return row(id, "FAIL", `${n} ${noun} no note${kindsOf(out)}`, FIX_NOTE);
  } catch (err) {
    if (tableNotLive(err)) {
      return row(id, "skip", "marketing_jobs is not live yet — failed notes not read");
    }
    return row(id, "FAIL", `could not read failed jobs: ${clip(err)}`, FIX_NOTE);
  }
}

/**
 * The reads GET /api/marketing/health makes, in the order it makes them, minus its
 * two writes (the settings row it creates and the page_seen beat). If any of them
 * throws, the owner's health card answers 500. Throws what the reader threw.
 */
export async function readHealthParts(tx, { orgId, now }) {
  const [health, clock, today, usage] = await Promise.all([
    import("../../../api/marketing/health.mjs"),
    import("../../marketing/clock.mjs"),
    import("../../../api/marketing/today.mjs"),
    import("../../marketing/model-usage.mjs")
  ]);
  assertSelect(SETTINGS_SQL);
  const s = (await tx.query(SETTINGS_SQL, [orgId])).rows[0] || {};
  const settings = {
    enabled: s.enabled === true,
    max_batch_cost_usd: s.max_batch_cost_usd ?? null,
    max_month_cost_usd: s.max_month_cost_usd ?? null
  };
  const beats = await clock.readHeartbeats(tx, orgId);
  const jobs = await health.readJobCounts(tx, { orgId });
  const outbox = await health.readOutbox(tx, { orgId });
  const sync = await today.readLastSync(tx, { orgId });
  const lastBatchId = await health.readLastBatchId(tx, { orgId });
  const cost = await usage.costStatus(tx, {
    orgId,
    batchId: lastBatchId,
    maxBatchUsd: settings.max_batch_cost_usd,
    maxMonthUsd: settings.max_month_cost_usd,
    now
  });
  return health.healthView({
    settings, beats, jobs, outbox, sync, cost, lastBatchId, tokenPresent: false, now
  });
}

async function readGet(fetchImpl, url) {
  const init = { method: "GET", headers: { accept: "application/json" } };
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    init.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  }
  const res = await fetchImpl(url, init);
  return Number(res && res.status);
}

async function checkReadApi({ run, orgId, now, fetchImpl, baseUrl }) {
  const id = "marketing-queue:read-api";
  const bits = [];
  // 1. Is the route there? A signed-out GET answers 401 before it reads or writes anything.
  if (fetchImpl) {
    const url = `${originOf(baseUrl)}${JOB_READ_PATH}`;
    let status;
    try {
      status = await readGet(fetchImpl, url);
    } catch (err) {
      return row(id, "FAIL", `marketing job read API unreachable: GET ${JOB_READ_PATH} ${clip(err)}`, FIX_READ);
    }
    if (status === 503) {
      return row(id, "skip", "marketing job read answered not ready (503), not a 500");
    }
    if (status >= 500) {
      const label = status === 500 ? "marketing job read API 500" : `marketing job read API ${status}`;
      return row(id, "FAIL", `${label}: GET ${JOB_READ_PATH}`, FIX_READ);
    }
    if (!apiAlive(status)) {
      return row(id, "FAIL", `marketing job read API down: GET ${JOB_READ_PATH} ${status}`, FIX_READ);
    }
    bits.push(`GET ${JOB_READ_PATH} answered ${status}`);
  }
  // 2. Does what it reads still read? The same SELECTs, as the staff the route runs as.
  if (run && orgId) {
    try {
      await run((tx) => readHealthParts(tx, { orgId, now }));
      bits.push("the health card's reads ran");
    } catch (err) {
      if (tableNotLive(err)) {
        return row(id, "skip", "marketing_jobs is not live yet — the job read answers not ready, not a 500");
      }
      return row(id, "FAIL", `marketing job read API 500: ${clip(err)}`, FIX_READ);
    }
  }
  if (!bits.length) {
    return row(id, "skip", "no fetch and no database in this run — the job read was not tried");
  }
  return row(id, "PASS", `marketing job read is up: ${bits.join("; ")}`);
}

/**
 * Three read-only checks. ctx: { db, scope, orgId, now, fetchImpl | fetch, baseUrl }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const orgId = await companyOf(ctx, run);
  const fetchImpl = ctx.fetchImpl || ctx.fetch || null;
  const baseUrl = ctx.baseUrl;
  return [
    await checkStuck({ run, orgId, now }),
    await checkFailedNote({ run, orgId, now }),
    await checkReadApi({ run, orgId, now, fetchImpl, baseUrl })
  ];
}
