// Staff fulfillment breakage for the morning pulse. Read only. Report only.
// Slice 33 names the funding and repair desk doors. This file does not repeat that list.
// Not letter copy. Not inquiry.
//
// Three breaks: a file with no next step past the wait the code already
// defines, a fulfillment API answer of 500, and an apply step that is blocked
// with no reason saved.
//
// Tripwire is existing Recon (AG-07) on daily-pulse. This file does not start
// another watcher. It does not apply to a lender. It does not upload.

import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";
import { NEXT_ACTION_KEY } from "../../workflows/custom-fields.mjs";
import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";
import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";

export const REPAIR_PIPELINE = "optimization";
export const FUNDING_PIPELINE = "funding_card_stacking";

/** Repair stages that already have a clock in src/repair/sla.mjs. */
export const REPAIR_QUEUE_STAGES = Object.freeze(Object.keys(STAGE_SLA));

/** Funding queue stages from db/seed/002_pipelines.sql. Funded and closed are done. */
export const FUNDING_QUEUE_STAGES = Object.freeze([
  "apply_now",
  "round_submitted",
  "approved",
  "action_required"
]);

/** 3 times the next-action catch-up cron. Same red window as the job heartbeat. */
export const NEXT_ACTION_WAIT_MS = (() => {
  const interval = cronIntervalMs(CATCH_UP_CRON);
  return interval == null ? null : STALE_MULTIPLE * interval;
})();

/** Apply statuses that mean the step stopped. A reason has to be stored. */
export const APPLY_BLOCKED_STATUSES = Object.freeze(["Missing Docs", "Action Required"]);

/** Proxy apply rows that stopped. The error columns are the stored reason. */
export const APPLY_FAIL_SESSION_STATUSES = Object.freeze(["failed", "mismatch"]);

/** GET only. No apply launch. No upload. No letter send. No inquiry desk. */
export const FULFILLMENT_GETS = Object.freeze([
  "/api/dashboard/clients?fulfillment=1",
  "/api/dashboard/pipeline",
  "/api/read/funding-rounds",
  "/api/read/documents",
  "/api/read/repair-cases",
  "/api/repair/exceptions",
  "/api/applications",
  "/api/read/lender-matches"
]);

export const CHECK_IDS = Object.freeze([
  "fulfillment:next-action",
  "fulfillment:api",
  "fulfillment:apply-blocked"
]);

const RECON =
  "Recon (AG-07) is the one tripwire. Do not auto-fix from this pulse. " +
  "Do not apply to a real lender. Do not upload.";

function nextActionSql() {
  if (!/^[a-z_]+$/.test(NEXT_ACTION_KEY)) {
    throw new Error("next action key is not a column name");
  }
  return `
/* gap:fulfillment-next-action */
SELECT c.id::text AS id,
       p.key AS pipeline_key,
       ps.key AS stage_key,
       c.entered_at,
       c.updated_at,
       (
         SELECT MIN(dc.response_due_at)
           FROM dispute_cases dc
          WHERE dc.org_id = c.org_id
            AND dc.client_id = c.client_id
            AND dc.status = 'awaiting_response'
       ) AS response_due_at
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p ON p.id = c.pipeline_id AND p.org_id = c.org_id
  JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND COALESCE(cl.is_demo, false) = false
   AND btrim(COALESCE(cl.custom_fields->>'${NEXT_ACTION_KEY}', '')) = ''
   AND (
     (p.key = '${REPAIR_PIPELINE}' AND ps.key = ANY($2::text[]))
     OR (p.key = '${FUNDING_PIPELINE}' AND ps.key = ANY($3::text[]))
   )`;
}

export const NEXT_ACTION_SQL = nextActionSql();

export const APPLY_BLOCKED_SQL = `
/* gap:fulfillment-apply-blocked */
SELECT count(*)::int AS n
  FROM (
    SELECT a.id
      FROM applications a
      LEFT JOIN clients cl ON cl.id = a.client_id AND cl.org_id = a.org_id
     WHERE a.org_id = $1::uuid
       AND COALESCE(a.is_demo, false) = false
       AND COALESCE(cl.is_demo, false) = false
       AND a.status = ANY($2::text[])
       AND btrim(COALESCE(a.condition_text, '')) = ''
       AND NOT EXISTS (
         SELECT 1
           FROM application_decisions d
          WHERE d.org_id = a.org_id
            AND d.application_id = a.id
            AND btrim(COALESCE(d.notes, '')) <> ''
       )
    UNION ALL
    SELECT ps.id
      FROM proxy_sessions ps
      JOIN clients cl ON cl.id = ps.client_id AND cl.org_id = ps.org_id
     WHERE ps.org_id = $1::uuid
       AND COALESCE(cl.is_demo, false) = false
       AND ps.status = ANY($3::text[])
       AND btrim(COALESCE(ps.error_code, '')) = ''
       AND btrim(COALESCE(ps.error_message, '')) = ''
  ) blocked`;

function check(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function assertSelect(sql) {
  const bare = String(sql).replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "").trim();
  if (!/^select\b/i.test(bare)) throw new Error("fulfillment gap check is read-only");
  if (/\b(insert|update|delete|drop)\b/i.test(bare)) {
    throw new Error("fulfillment gap check is read-only");
  }
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * True when this file is past the wait the code already defines
 * and the caller already knows the next step is blank.
 * Repair stages use isBreached (src/repair/sla.mjs).
 * Funding queue stages use 3 times the next-action catch-up cron.
 */
export function pastDefinedWait(row, now = new Date()) {
  if (!row || typeof row !== "object") return false;
  const stage = String(row.stage_key || "");
  const pipeline = String(row.pipeline_key || "");
  const entered = row.entered_at || row.updated_at || null;
  if (pipeline === REPAIR_PIPELINE && STAGE_SLA[stage]) {
    return isBreached({
      stageKey: stage,
      enteredAt: entered,
      asOf: now,
      responseDueAt: row.response_due_at
    }).breached === true;
  }
  if (pipeline === FUNDING_PIPELINE && FUNDING_QUEUE_STAGES.includes(stage)) {
    if (NEXT_ACTION_WAIT_MS == null) return false;
    const start = new Date(entered || "").getTime();
    if (!Number.isFinite(start)) return false;
    return now.getTime() - start > NEXT_ACTION_WAIT_MS;
  }
  return false;
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

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  return { status: Number(res && res.status) };
}

async function checkNextAction({ db, orgId, now }) {
  const id = "fulfillment:next-action";
  if (!db || typeof db.query !== "function" || !orgId) {
    return check(id, "skip", "no database — files with no next step not read");
  }
  try {
    assertSelect(NEXT_ACTION_SQL);
    const result = await db.query(NEXT_ACTION_SQL, [
      orgId,
      [...REPAIR_QUEUE_STAGES],
      [...FUNDING_QUEUE_STAGES]
    ]);
    const rows = Array.isArray(result && result.rows) ? result.rows : [];
    const late = rows.filter((row) => pastDefinedWait(row, now));
    if (late.length === 0) {
      return check(id, "PASS", "no file is past its wait with no next step");
    }
    const shown = late.map((row) => row && row.id).filter(Boolean).slice(0, 5);
    const more = late.length > shown.length ? ` and ${late.length - shown.length} more` : "";
    const tail = shown.length ? ` Look at ${shown.join(", ")}${more}.` : "";
    return check(
      id,
      "FAIL",
      `${plural(late.length, "file")} past the wait with no next step.${tail}`,
      `Open the funding or repair desk and set the next step on the file that has been waiting. ${RECON}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `could not read next steps: ${clip(err)}`,
      `Read the funding and repair queues. ${RECON}`
    );
  }
}

async function checkApi({ fetchImpl, baseUrl }) {
  const id = "fulfillment:api";
  if (typeof fetchImpl !== "function") {
    return check(id, "skip", "no fetch — fulfillment API not read");
  }
  const origin = originOf(baseUrl);
  const bad = [];
  try {
    for (const path of FULFILLMENT_GETS) {
      const { status } = await readGet(fetchImpl, `${origin}${path}`);
      if (!apiAlive(status)) bad.push(`${path} ${status}`);
    }
  } catch (err) {
    return check(
      id,
      "FAIL",
      `fulfillment API unreachable: ${clip(err)}`,
      `Restore the fulfillment desk reads. ${RECON}`
    );
  }
  if (bad.length === 0) {
    return check(id, "PASS", "fulfillment API answered (not 500)");
  }
  const fiveHundred = bad.some((line) => /\s500$/.test(line));
  return check(
    id,
    "FAIL",
    fiveHundred
      ? `fulfillment API 500: ${bad.join("; ")}`
      : `fulfillment API down: ${bad.join("; ")}`,
    `Fix the fulfillment desk API that failed. ${RECON}`
  );
}

async function checkApplyBlocked({ db, orgId }) {
  const id = "fulfillment:apply-blocked";
  if (!db || typeof db.query !== "function" || !orgId) {
    return check(id, "skip", "no database — blocked apply steps not read");
  }
  try {
    assertSelect(APPLY_BLOCKED_SQL);
    const result = await db.query(APPLY_BLOCKED_SQL, [
      orgId,
      [...APPLY_BLOCKED_STATUSES],
      [...APPLY_FAIL_SESSION_STATUSES]
    ]);
    const n = Number(result?.rows?.[0]?.n);
    if (!Number.isFinite(n)) {
      return check(
        id,
        "FAIL",
        "blocked apply count was not a number",
        `Read applications and proxy sessions. ${RECON}`
      );
    }
    if (n === 0) {
      return check(id, "PASS", "no blocked apply step is missing its reason");
    }
    return check(
      id,
      "FAIL",
      `${plural(n, "apply step")} blocked with no reason stored`,
      `Write the reason on the blocked apply step. ${RECON}`
    );
  } catch (err) {
    return check(
      id,
      "FAIL",
      `could not read blocked apply steps: ${clip(err)}`,
      `Read applications and proxy sessions. ${RECON}`
    );
  }
}

/**
 * Three read-only checks.
 * ctx: { db, orgId, now, fetchImpl, baseUrl }.
 * Each row is { id, status, detail, suggestedFix }. Status is PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fetchImpl = ctx.fetchImpl || null;
  const baseUrl = ctx.baseUrl;
  return [
    await checkNextAction({ db, orgId, now }),
    await checkApi({ fetchImpl, baseUrl }),
    await checkApplyBlocked({ db, orgId })
  ];
}
