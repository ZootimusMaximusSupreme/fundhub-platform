// Client success queue gaps for the morning pulse. Read only. Report only.
//
// Slice 30 already lists owner desks, sales-manager desks, and whether the
// client success doors are on the morning list. This file does not repeat
// that list. It looks for three breaks: the queue API is dead, a client
// success task is overdue with nobody assigned, and a paid client never got
// the halfway accountability call.
//
// Tripwire is existing Recon (AG-07). No second watchdog. Never text a client.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const CHECK_IDS = Object.freeze([
  "csm:queue-api",
  "csm:overdue-unassigned",
  "csm:missing-step"
]);

export const QUEUE_PATH = "/api/read/csm-queue";

/** Money-in events that must open the halfway accountability call. */
export const MONEY_IN_EVENTS = Object.freeze([
  "deposit.paid",
  "sale.closed",
  "payment.received"
]);

export const MID_SOURCE_WORKFLOW = "customer-insights-mid";

export const QUEUE_PROBE_SQL = `
  /* gap:csm-queue-api */
  SELECT t.id
    FROM tasks t
    JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
    LEFT JOIN staff s ON s.id = c.assigned_csm_staff_id AND s.org_id = c.org_id
    LEFT JOIN v_invoice_aging o ON o.client_id = t.client_id AND o.org_id = t.org_id
    LEFT JOIN v_client_entitlements w ON w.client_id = t.client_id AND w.org_id = t.org_id
   WHERE t.org_id = $1::uuid
     AND t.assignee_role = 'csm'
     AND t.done = false
   LIMIT 1
`;

export const OVERDUE_UNASSIGNED_SQL = `
  /* gap:csm-overdue-unassigned */
  SELECT count(*)::int AS n
    FROM tasks t
    JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
   WHERE t.org_id = $1::uuid
     AND t.assignee_role = 'csm'
     AND t.done = false
     AND COALESCE(t.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND t.due_at IS NOT NULL
     AND t.due_at < $2::timestamptz
     AND t.assignee_staff_id IS NULL
`;

export const MISSING_STEP_SQL = `
  /* gap:csm-missing-step */
  SELECT count(DISTINCT e.client_id)::int AS n
    FROM events e
    JOIN clients c ON c.id = e.client_id AND c.org_id = e.org_id
   WHERE e.org_id = $1::uuid
     AND e.name = ANY($2::text[])
     AND e.client_id IS NOT NULL
     AND COALESCE(e.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND NOT EXISTS (
       SELECT 1
         FROM tasks t
        WHERE t.org_id = e.org_id
          AND t.client_id = e.client_id
          AND t.source_workflow = $3
     )
`;

const TRIPWIRE =
  "Recon (AG-07) is the one tripwire. Do not invent a second watchdog. " +
  "Do not text clients. Do not auto-fix from this pulse.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(err) {
  return String(err?.message || err).slice(0, 180);
}

function countOf(result) {
  const n = Number(result?.rows?.[0]?.n ?? 0);
  return Number.isFinite(n) ? n : null;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function defaultReadText(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
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

/** True when GET /api/read/csm-queue is still wired. No HTTP call. */
export function csmQueueRouteWired(readText = defaultReadText) {
  const api = readText("netlify/functions/api.mjs");
  const handler = readText("api/read/csm-queue.mjs");
  const imported = /import readCsmQueue from ["'][^"']*csm-queue\.mjs["']/.test(api);
  const routed = /["']read\/csm-queue["']\s*:\s*readCsmQueue/.test(api);
  const get =
    /req\.method !== ["']GET["']/.test(handler) &&
    /export default async function handler/.test(handler);
  return imported && routed && get;
}

/** True when a paid client still gets the halfway accountability call. No HTTP call. */
export function halfwayStepWired(readText = defaultReadText) {
  const insights = readText("src/handlers/customer-insights.mjs");
  const boot = readText("src/register-all.mjs");
  const events = MONEY_IN_EVENTS.every((name) =>
    new RegExp(`on\\(\\s*["']${name}["']\\s*,\\s*onPaidMidCheckin\\s*\\)`).test(insights)
  );
  const bootOk = /registerCustomerInsights\(\)/.test(boot);
  return events && bootOk;
}

async function readGet(fetchImpl, url) {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { accept: "application/json" }
  });
  return { status: Number(res && res.status) };
}

async function checkQueueApi({ db, orgId, fetchImpl, baseUrl, readText }) {
  const id = "csm:queue-api";
  const parts = [];
  let wired = false;
  try {
    wired = csmQueueRouteWired(readText);
  } catch (err) {
    parts.push(`route file could not be read (${clip(err)})`);
  }
  if (!wired && parts.length === 0) parts.push("route is not wired");

  let called = false;
  if (fetchImpl) {
    called = true;
    const origin = String(baseUrl || "https://fundhub.ai").trim().replace(/\/+$/, "") || "https://fundhub.ai";
    try {
      const { status } = await readGet(fetchImpl, `${origin}${QUEUE_PATH}`);
      if (!apiAlive(status)) parts.push(`${QUEUE_PATH} answered ${status}`);
    } catch (err) {
      parts.push(`unreachable (${clip(err)})`);
    }
  }

  if (db && orgId) {
    called = true;
    try {
      await db.query(QUEUE_PROBE_SQL, [orgId]);
    } catch (err) {
      parts.push(`queue read failed (${clip(err)})`);
    }
  }

  if (parts.length > 0) {
    return row(id, "FAIL", `CSM queue API is dead: ${parts.join("; ")}.`, `${TRIPWIRE} Restore GET ${QUEUE_PATH}.`);
  }
  if (!called) {
    return row(id, "skip", "CSM queue API not called this run");
  }
  return row(id, "PASS", "CSM queue API answered");
}

async function checkOverdue({ db, orgId, now }) {
  const id = "csm:overdue-unassigned";
  if (!db || !orgId) {
    return row(id, "skip", "no database in this run — overdue client success tasks not read");
  }
  try {
    const result = await db.query(OVERDUE_UNASSIGNED_SQL, [orgId, now.toISOString()]);
    const n = countOf(result);
    if (n == null) {
      return row(id, "FAIL", "overdue client success task count was not a number", `${TRIPWIRE} Read tasks for the client success role.`);
    }
    if (n === 0) {
      return row(id, "PASS", "no overdue client success task is sitting with nobody assigned");
    }
    return row(
      id,
      "FAIL",
      `${plural(n, "client success task")} overdue and nobody is assigned.`,
      `${TRIPWIRE} Open the client success queue and assign the overdue call.`
    );
  } catch (err) {
    return row(
      id,
      "FAIL",
      `could not read overdue client success tasks: ${clip(err)}`,
      `${TRIPWIRE} Read tasks for the client success role.`
    );
  }
}

async function checkMissingStep({ db, orgId, readText }) {
  const id = "csm:missing-step";
  let wired = false;
  let wireError = null;
  try {
    wired = halfwayStepWired(readText);
  } catch (err) {
    wireError = clip(err);
  }

  const parts = [];
  if (wireError) parts.push(`halfway step file could not be read (${wireError})`);
  else if (!wired) parts.push("the halfway accountability call is not wired to deposit paid, sale closed, and payment received");

  if (!db || !orgId) {
    if (parts.length > 0) {
      return row(
        id,
        "FAIL",
        `client success step does not exist: ${parts.join("; ")}.`,
        `${TRIPWIRE} Wire onPaidMidCheckin back onto the three money-in events.`
      );
    }
    return row(id, "skip", "no database in this run — paid clients not read for the halfway call");
  }

  try {
    const result = await db.query(MISSING_STEP_SQL, [orgId, [...MONEY_IN_EVENTS], MID_SOURCE_WORKFLOW]);
    const n = countOf(result);
    if (n == null) parts.push("halfway call count was not a number");
    else if (n > 0) {
      const who = n === 1 ? "1 client paid and has" : `${n} clients paid and have`;
      parts.push(`${who} no halfway accountability call`);
    }
  } catch (err) {
    parts.push(`could not read the halfway call (${clip(err)})`);
  }

  if (parts.length === 0) {
    return row(id, "PASS", "every paid client has the halfway accountability call");
  }
  return row(
    id,
    "FAIL",
    `client success step does not exist: ${parts.join("; ")}.`,
    `${TRIPWIRE} Open the halfway accountability call for the client who paid and has none.`
  );
}

/**
 * Three read-only checks. ctx: { db, orgId, now, fetchImpl, baseUrl, readText }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db || null;
  const orgId = ctx.orgId || null;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const fetchImpl = ctx.fetchImpl || null;
  const readText = typeof ctx.readText === "function" ? ctx.readText : defaultReadText;
  const hasDb = Boolean(db && orgId);
  return [
    await checkQueueApi({
      db: hasDb ? db : null,
      orgId,
      fetchImpl,
      baseUrl: ctx.baseUrl,
      readText
    }),
    await checkOverdue({ db: hasDb ? db : null, orgId, now }),
    await checkMissingStep({ db: hasDb ? db : null, orgId, readText })
  ];
}
