// Marketing machine job queue for the morning pulse. Read only. Report only.
//
// Lane: ad scripts, research, and write jobs on marketing_jobs.
// Slice 3 already watches the marketing clock, worker, page_seen, and outbox drain.
// Slice 4 already watches Meta spend sync. This file does not repeat either.
//
// Tripwire is existing Recon (AG-07). The marketing clock (every 15 minutes,
// red after 3 times that) is the existing wait. Do not add another watcher.
// Do not start a paid model run. Do not claim a job. Do not wake the worker.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AI_JOB_KINDS } from "../../marketing/ai-runner.mjs";
import { OFFER_KIND } from "../../marketing/jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Script, research, and write kinds. Meta load is left out on purpose. */
export const QUEUE_KINDS = Object.freeze([...AI_JOB_KINDS, OFFER_KIND]);

/** Same red line as the marketing clock: 15 minutes, then 3 times that. Not a new schedule. */
export const CLOCK_EVERY_MS = 15 * 60 * 1000;
export const RED_MULTIPLIER = 3;
export const QUEUE_WAIT_MS = CLOCK_EVERY_MS * RED_MULTIPLIER;

/** A failed row whose saved note is blank or only the placeholder. */
export const EMPTY_FAIL_NOTES = Object.freeze([
  "failed, no reason recorded",
  "no reason recorded",
  "no reason was saved"
]);

export const JOB_READ_PATH = "/api/marketing/health";

export const CHECK_IDS = Object.freeze([
  "marketing-queue:stuck-queued",
  "marketing-queue:failed-no-note",
  "marketing-queue:read-api"
]);

const TRIP =
  "Recon (AG-07) is the one tripwire. Do not start a paid model run. Do not auto-fix.";

const FIX_STUCK =
  `Read marketing_jobs for script, research, and write rows still queued past the clock wait. ` +
  `Use the existing marketing clock or the existing Mac queue runner. ${TRIP}`;

const FIX_NOTE =
  `Read the failed marketing_jobs row and its error note. A failed job must say why. ${TRIP}`;

const FIX_READ =
  `Read GET ${JOB_READ_PATH}. Do not add another door. ${TRIP}`;

const STUCK_SQL = `
  /* gap:stuck-queued */
  SELECT count(*)::int AS n
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND status = 'queued'
     AND kind = ANY($2::text[])
     AND kind <> 'meta_load'
     AND run_after < $3::timestamptz
`;

const FAILED_SQL = `
  /* gap:failed-no-note */
  SELECT count(*)::int AS n
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND status = 'failed'
     AND kind = ANY($2::text[])
     AND kind <> 'meta_load'
     AND (
       error IS NULL
       OR btrim(COALESCE(error, '')) = ''
       OR btrim(error) = ANY($3::text[])
     )
`;

const READ_SQL = `
  /* gap:job-read */
  SELECT count(*) FILTER (WHERE status = 'queued')::int AS queued,
         count(*) FILTER (WHERE status = 'running')::int AS running
    FROM marketing_jobs
   WHERE org_id = $1::uuid
     AND kind = ANY($2::text[])
     AND kind <> 'meta_load'
`;

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

function kinds() {
  return [...QUEUE_KINDS];
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

/** True when GET marketing/health is still the job-count door and does not start a model. */
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

async function checkStuck({ db, orgId, now }) {
  const id = "marketing-queue:stuck-queued";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — queued jobs not read");
  }
  const cutoff = new Date(now.getTime() - QUEUE_WAIT_MS).toISOString();
  try {
    assertSelect(STUCK_SQL);
    const n = countOf(await db.query(STUCK_SQL, [orgId, kinds(), cutoff]));
    if (n == null) {
      return row(id, "FAIL", "queued job count was not a number", FIX_STUCK);
    }
    if (n === 0) {
      return row(id, "PASS", `no script, research, or write job is queued past the ${waitMinutes()} minute wait`);
    }
    const noun = n === 1 ? "job is" : "jobs are";
    return row(
      id,
      "FAIL",
      `${n} ${noun} still queued past the ${waitMinutes()} minute wait`,
      FIX_STUCK
    );
  } catch (err) {
    if (tableNotLive(err)) {
      return row(id, "skip", "marketing_jobs is not live yet — queued jobs not read");
    }
    return row(id, "FAIL", `could not read queued jobs: ${clip(err)}`, FIX_STUCK);
  }
}

async function checkFailedNote({ db, orgId }) {
  const id = "marketing-queue:failed-no-note";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — failed jobs not read");
  }
  try {
    assertSelect(FAILED_SQL);
    const n = countOf(await db.query(FAILED_SQL, [orgId, kinds(), [...EMPTY_FAIL_NOTES]]));
    if (n == null) {
      return row(id, "FAIL", "failed-job count was not a number", FIX_NOTE);
    }
    if (n === 0) {
      return row(id, "PASS", "every failed script, research, and write job has a note");
    }
    const noun = n === 1 ? "failed job has" : "failed jobs have";
    return row(id, "FAIL", `${n} ${noun} no note`, FIX_NOTE);
  } catch (err) {
    if (tableNotLive(err)) {
      return row(id, "skip", "marketing_jobs is not live yet — failed notes not read");
    }
    return row(id, "FAIL", `could not read failed jobs: ${clip(err)}`, FIX_NOTE);
  }
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, { method: "GET", headers: { accept: "application/json" } });
  return Number(res && res.status);
}

async function checkReadApi({ db, orgId, readText, fetchImpl, baseUrl }) {
  const id = "marketing-queue:read-api";
  let alive = false;
  try {
    alive = jobReadRouteAlive(readText);
  } catch (err) {
    return row(id, "FAIL", `marketing job read route is dead: ${clip(err)}`, FIX_READ);
  }
  if (!alive) {
    return row(
      id,
      "FAIL",
      "marketing job read route is dead (GET /api/marketing/health is not wired).",
      FIX_READ
    );
  }
  if (fetchImpl) {
    try {
      const status = await readGet(fetchImpl, `${originOf(baseUrl)}${JOB_READ_PATH}`);
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
    } catch (err) {
      return row(id, "FAIL", `marketing job read API 500: ${clip(err)}`, FIX_READ);
    }
  }
  if (db && orgId) {
    try {
      assertSelect(READ_SQL);
      await db.query(READ_SQL, [orgId, kinds()]);
    } catch (err) {
      if (tableNotLive(err)) {
        return row(id, "skip", "marketing_jobs is not live yet — the job read answers not ready, not a 500");
      }
      return row(id, "FAIL", `marketing job read API 500: ${clip(err)}`, FIX_READ);
    }
  }
  if (!db || !orgId) {
    return row(
      id,
      "PASS",
      fetchImpl
        ? "GET /api/marketing/health answered and it was not a 500"
        : "marketing job read route is wired (GET /api/marketing/health)"
    );
  }
  return row(id, "PASS", "marketing job read query ran and the door is wired");
}

/**
 * Three read-only checks. ctx: { db, orgId, now, readText, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const fetchImpl = ctx.fetchImpl || null;
  const baseUrl = ctx.baseUrl;
  return [
    await checkStuck({ db, orgId, now }),
    await checkFailedNote({ db, orgId }),
    await checkReadApi({ db, orgId, readText, fetchImpl, baseUrl })
  ];
}
