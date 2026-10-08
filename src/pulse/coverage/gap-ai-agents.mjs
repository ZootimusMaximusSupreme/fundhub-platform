// Live AI agents — one tripwire for the morning pulse.
//
// Slice 24 already checks that the agent workflows are named on the pulse list.
// This file does not do that again.
//
// Recon (AG-07, cron.daily-pulse) is the morning watchdog. This file does not
// watch it.
//
// Read only. SELECT inside BEGIN READ ONLY, then ROLLBACK.
// The call route is probed with GET only, so this file cannot dial.
// It never retires an agent and never places a call.

export const CHECK_ID = "ai-agents";

/** Morning Recon. Slice 02 already watches this row. */
export const RECON_CODE = "AG-07";
export const RECON_TRIGGER = "cron.daily-pulse";

/** A failed run younger than this may still be inside an in-flight retry. */
export const RETRY_GRACE_MS = 15 * 60 * 1000;

/** How far back the Bland voice webhook answer is read. */
export const BLAND_LOOKBACK_MS = 24 * 60 * 60 * 1000;

/** Outcomes that mean the run broke. Skips and normal replies are not in here. */
export const FAIL_OUTCOMES = Object.freeze([
  "runtime_error",
  "model_error",
  "empty_model_reply",
  "bland_rejected",
  "transport",
  "no_call_id",
  "error",
  "failed",
  "fail"
]);

export const RETIRED_SQL = `
SELECT a.code, a.status
  FROM agents a
 WHERE a.code <> 'AG-07'
   AND a.code NOT LIKE 'GHL-%'
   AND a.runtime IS NOT NULL
   AND btrim(COALESCE(a.prompt, '')) <> ''
   AND a.status = 'retired'
   AND EXISTS (
     SELECT 1
       FROM agent_triggers t
      WHERE t.org_id = a.org_id
        AND t.agent_code = a.code
        AND t.enabled IS TRUE
   )
 ORDER BY a.code`.trim();

export const FAILED_RUN_SQL = `
SELECT r.agent_code, r.outcome, r.trigger_event, r.created_at
  FROM agent_runs r
 WHERE r.agent_code IS NOT NULL
   AND r.agent_code <> 'AG-07'
   AND COALESCE(r.trigger_event, '') <> 'cron.daily-pulse'
   AND r.created_at <= $1::timestamptz
   AND (
     lower(r.outcome) = ANY($2::text[])
     OR r.outcome ILIKE 'openai %'
     OR r.outcome ILIKE '%runtime_error%'
     OR r.outcome ILIKE '%model_error%'
     OR r.outcome ILIKE '%bland_rejected%'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM agent_runs later
      WHERE later.org_id = r.org_id
        AND later.agent_code = r.agent_code
        AND later.created_at > r.created_at
        AND (
          (r.event_id IS NOT NULL AND (
             later.event_id = r.event_id
             OR later.detail ILIKE ('retry of ' || r.event_id::text || '%')
          ))
          OR (
            r.event_id IS NULL
            AND later.client_id IS NOT DISTINCT FROM r.client_id
            AND later.trigger_event = r.trigger_event
          )
        )
   )
 ORDER BY r.created_at DESC
 LIMIT 20`.trim();

export const BLAND_SQL = `
SELECT CASE
         WHEN (parsed->>'status') ~ '^[0-9]+$' THEN (parsed->>'status')::int
         ELSE NULL
       END AS status
  FROM webhook_captures
 WHERE provider = 'bland'
   AND created_at >= $1::timestamptz
 ORDER BY created_at DESC
 LIMIT 1`.trim();

const FIX =
  "Look at the named agent in the Agent Editor and retry the failed run. " +
  "If the call route answered 500, fix that route. " +
  "Leave every agent status as it is. Leave the phone alone.";

function check(status, detail, suggestedFix = null) {
  return { id: CHECK_ID, status, detail, suggestedFix };
}

function clip(s, n = 180) {
  return String(s == null ? "" : s)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

function codeOf(row) {
  return String((row && (row.code || row.agent_code)) || "").trim().toUpperCase();
}

/** Recon and the retired GoHighLevel rows are outside this tripwire. */
export function ignoredAgent(row) {
  const code = codeOf(row);
  if (!code || code === RECON_CODE || code.startsWith("GHL-")) return true;
  if (String((row && row.trigger_event) || "") === RECON_TRIGGER) return true;
  return false;
}

function oldEnough(row, cutoff) {
  if (!row || row.created_at == null || row.created_at === "") return true;
  const t = new Date(row.created_at).getTime();
  if (!Number.isFinite(t)) return true;
  return t <= cutoff.getTime();
}

function listCodes(rows) {
  const codes = [];
  for (const row of rows) {
    const code = codeOf(row);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes.slice(0, 8);
}

/**
 * Turn already-read rows into the one tripwire.
 * route.probed false means nobody asked the call route.
 */
export function judge({
  dbRead = false,
  readError = null,
  retired = [],
  failed = [],
  blandStatus = null,
  route = { probed: false, status: null },
  now = new Date()
} = {}) {
  const cutoff = new Date(now.getTime() - RETRY_GRACE_MS);
  const routeStatus = route && route.probed ? Number(route.status) : null;
  const routeDown = Number.isFinite(routeStatus) && routeStatus >= 500;
  const blandDown = Number.isFinite(Number(blandStatus)) && Number(blandStatus) >= 500;

  const retiredHits = (retired || []).filter((row) => !ignoredAgent(row));
  const failedHits = (failed || []).filter((row) => !ignoredAgent(row) && oldEnough(row, cutoff));

  if (!dbRead) {
    if (routeDown) {
      return check(
        "FAIL",
        `The agent call route answered ${routeStatus}. No call was placed.` +
          (readError ? ` Agent rows could not be read: ${clip(readError.message || readError)}.` : ""),
        FIX
      );
    }
    if (readError) {
      return check("skip", `Agent rows could not be read: ${clip(readError.message || readError)}.`);
    }
    return check("skip", "Agent rows were not read. No call route status was passed in.");
  }

  const parts = [];
  if (retiredHits.length) {
    const codes = listCodes(retiredHits);
    const verb = codes.length === 1 ? "is" : "are";
    parts.push(`${codes.join(", ")} should be on and ${verb} retired, with a trigger still on.`);
  }
  if (failedHits.length) {
    const sample = failedHits[0];
    const codes = listCodes(failedHits).join(", ");
    const outcome = clip(sample.outcome, 60) || "failed";
    parts.push(`${codes} run failed (${outcome}) and was not retried.`);
  }
  if (blandDown) {
    parts.push(`The Bland voice webhook answered ${Number(blandStatus)}.`);
  }
  if (routeDown) {
    parts.push(`The agent call route answered ${routeStatus}. No call was placed.`);
  }

  if (parts.length) {
    return check("FAIL", parts.join(" "), FIX);
  }

  const routeNote = route && route.probed
    ? `The call route answered ${routeStatus}.`
    : "The call route was not probed.";
  const blandNote = blandStatus == null
    ? "The Bland voice webhook is quiet."
    : `The Bland voice webhook answered ${Number(blandStatus)}.`;
  return check(
    "PASS",
    `Agents that should be on are on. No failed run is sitting past 15 minutes. ${routeNote} ${blandNote}`
  );
}

async function readRoute(ctx) {
  if (ctx.agentCallStatus != null && ctx.agentCallStatus !== "") {
    const status = Number(ctx.agentCallStatus);
    return { probed: Number.isFinite(status), status: Number.isFinite(status) ? status : null };
  }
  if (typeof ctx.fetch !== "function" || !ctx.baseUrl) {
    return { probed: false, status: null };
  }
  const base = String(ctx.baseUrl).replace(/\/$/, "");
  try {
    const res = await ctx.fetch(`${base}/api/agent-call`, { method: "GET" });
    const status = Number(res && res.status);
    return { probed: Number.isFinite(status), status: Number.isFinite(status) ? status : null };
  } catch {
    return { probed: false, status: null };
  }
}

async function readRows(db, now) {
  await db.query("BEGIN READ ONLY");
  try {
    const cutoff = new Date(now.getTime() - RETRY_GRACE_MS);
    const blandSince = new Date(now.getTime() - BLAND_LOOKBACK_MS);
    const retired = await db.query(RETIRED_SQL);
    const failed = await db.query(FAILED_RUN_SQL, [cutoff, FAIL_OUTCOMES]);
    const bland = await db.query(BLAND_SQL, [blandSince]);
    const blandRow = (bland.rows || [])[0] || null;
    const blandStatus = blandRow && blandRow.status != null ? Number(blandRow.status) : null;
    return {
      ok: true,
      retired: retired.rows || [],
      failed: failed.rows || [],
      blandStatus: Number.isFinite(blandStatus) ? blandStatus : null
    };
  } catch (err) {
    return { ok: false, error: err };
  } finally {
    try {
      await db.query("ROLLBACK");
    } catch {
      /* The read already failed. Rolling back is best-effort. */
    }
  }
}

/** One tripwire. Shape: { id, status, detail, suggestedFix }. status is PASS, FAIL, or skip. */
export async function gapChecks(ctx = {}) {
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const route = await readRoute(ctx);
  const db = ctx.db;
  if (!db || typeof db.query !== "function") {
    return [judge({ dbRead: false, route, now })];
  }
  const read = await readRows(db, now);
  if (!read.ok) {
    return [judge({ dbRead: false, readError: read.error, route, now })];
  }
  return [judge({
    dbRead: true,
    retired: read.retired,
    failed: read.failed,
    blandStatus: read.blandStatus,
    route,
    now
  })];
}
