// Live AI agents for the morning pulse. Read only. Report only.
//
// Slice 24 already checks that the agent workflows are named on the pulse list.
// The registry already pings /api/agent-call and /api/agents every morning.
// This file does neither of those again.
//
// Recon (AG-07, cron.daily-pulse) is the morning watchdog. This file does not
// watch it. It never retires an agent, never places a call, never writes.
//
// Two rows:
//   ai-agents:retired       an agent that was wired to run is retired
//   ai-agents:failed-runs   a run failed and nothing tried it again
//
// Review notes (Claude, 2026-10-08):
//   * The first draft sent BEGIN READ ONLY and ROLLBACK on ctx.db. In production
//     that is the shared pool, so those two statements could land on different
//     connections and leave one stuck inside a transaction. Every read is now a
//     single plain SELECT.
//   * The first draft was one row. A PASS could hide "the call route was not
//     probed". Each break now has its own row, so a skip stays a skip.
//   * The call route probe (GET /api/agent-call) is gone. The registry already
//     pings that route (reg:agent-call, 405 counts as up, 500 is down). A GET
//     never reaches the call logic, so it said nothing the registry did not.
//   * A failed run was judged against all of history. It is now the last 7 days,
//     and only a run by a real agent row (the live-playwright-sweep row in
//     agent_runs is a script, not an agent).
//   * Document reads (docs.received) are not judged here. A failed read goes on
//     the dead-letter queue, doc-check-retry-sweeper retries it every 20 minutes,
//     and the documents lane (documents:stuck-processing) watches that queue.
//   * The outcome list now includes Anthropic errors, which the model code writes
//     as "anthropic <status>:" the same way it writes "openai <status>:".
//   * A third row, ai-agents:bland-webhook, is gone (second review, 2026-10-08).
//     It read the status of the latest Bland webhook from webhook_captures and
//     went red at 500. But src/http/router.mjs stores a capture ONLY when the
//     answer was 200 ("verified traffic only"), and the Bland adapter answers
//     only 200, 400 or 401. A stored Bland row always says 200, so that row
//     could never fail. Live check: every stored capture that has a status says
//     200. A Bland webhook that answered 500 leaves nothing in the database.
//   * no_api_key is left out of FAIL_OUTCOMES on purpose. The owner has put the
//     AI spend on hold, and a live agent with no model key writes that outcome by
//     design. A morning red for it would be noise until credit is back.

export const CHECK_RETIRED = "ai-agents:retired";
export const CHECK_FAILED = "ai-agents:failed-runs";

export const CHECK_IDS = Object.freeze([CHECK_RETIRED, CHECK_FAILED]);

/** Morning Recon. Slice 02 already watches this row. */
export const RECON_CODE = "AG-07";
export const RECON_TRIGGER = "cron.daily-pulse";

/** The document reader has its own retry queue, watched by the documents lane. */
export const DOC_READ_TRIGGER = "docs.received";

/** A failed run younger than this may still be inside an in-flight retry. */
export const RETRY_GRACE_MS = 15 * 60 * 1000;

/** A failed run older than this is history, not this morning's news. */
export const FAILED_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

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
 WHERE ($1::uuid IS NULL OR a.org_id = $1::uuid)
   AND a.code <> 'AG-07'
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
  JOIN agents ag ON ag.org_id = r.org_id AND ag.code = r.agent_code
 WHERE ($1::uuid IS NULL OR r.org_id = $1::uuid)
   AND r.agent_code <> 'AG-07'
   AND COALESCE(r.trigger_event, '') <> 'cron.daily-pulse'
   AND COALESCE(r.trigger_event, '') <> 'docs.received'
   AND r.created_at <= $2::timestamptz
   AND r.created_at >= $3::timestamptz
   AND (
     lower(r.outcome) = ANY($4::text[])
     OR r.outcome ILIKE 'openai %'
     OR r.outcome ILIKE 'anthropic %'
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

const FIX_AGENT =
  "Look at the named agent in the Agent Editor. If it was retired by mistake, a person puts it back. " +
  "This pulse leaves every agent status as it is and leaves the phone alone.";
const FIX_RUN =
  "Open the named agent's run list in the Agent Editor and retry the failed run by hand. " +
  "This pulse leaves every agent status as it is and leaves the phone alone.";

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function clip(s, n = 180) {
  const text = s && s.message ? s.message : s == null ? "" : s;
  return String(text)
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

function codeOf(r) {
  return String((r && (r.code || r.agent_code)) || "").trim().toUpperCase();
}

/** Recon and the retired GoHighLevel rows are outside this tripwire. */
export function ignoredAgent(r) {
  const code = codeOf(r);
  if (!code || code === RECON_CODE || code.startsWith("GHL-")) return true;
  if (String((r && r.trigger_event) || "") === RECON_TRIGGER) return true;
  return false;
}

function listCodes(rows) {
  const codes = [];
  for (const r of rows) {
    const code = codeOf(r);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes.slice(0, 8);
}

/** ctx.db first (one plain SELECT per call). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (ctx && typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

async function select(run, sql, params) {
  const out = await run((tx) => tx.query(sql, params));
  return (out && out.rows) || [];
}

/** Rows already read in, one verdict out. Pure, so the tests can feed it. */
export function judgeRetired(rows) {
  const hits = (rows || []).filter((r) => !ignoredAgent(r));
  if (!hits.length) {
    return row(CHECK_RETIRED, "PASS", "no agent with a script, a runtime and a trigger still on is retired");
  }
  const codes = listCodes(hits);
  const verb = codes.length === 1 ? "is" : "are";
  return row(
    CHECK_RETIRED,
    "FAIL",
    `${codes.join(", ")} should be on and ${verb} retired, with a trigger still on`,
    FIX_AGENT
  );
}

export function judgeFailedRuns(rows, { now = new Date() } = {}) {
  const cutoff = now.getTime() - RETRY_GRACE_MS;
  const floor = now.getTime() - FAILED_LOOKBACK_MS;
  const hits = (rows || []).filter((r) => {
    if (ignoredAgent(r)) return false;
    const t = new Date(r && r.created_at).getTime();
    // A row with no usable time cannot be proven old enough, so it is not counted.
    return Number.isFinite(t) && t <= cutoff && t >= floor;
  });
  if (!hits.length) {
    return row(CHECK_FAILED, "PASS", "no failed agent run in the last 7 days is waiting past 15 minutes with no retry");
  }
  const sample = hits[0];
  const codes = listCodes(hits).join(", ");
  const outcome = clip(sample.outcome, 60) || "failed";
  const noun = hits.length === 1 ? "run" : "runs";
  return row(CHECK_FAILED, "FAIL", `${codes} ${hits.length} failed ${noun} (${outcome}) and not retried`, FIX_RUN);
}

async function readRow(id, fix, go) {
  try {
    return await go();
  } catch (err) {
    return row(id, "FAIL", `could not read for this check: ${clip(err)}`, fix);
  }
}

/**
 * Two read-only rows. ctx: { db, scope, orgId, now }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) {
    return CHECK_IDS.map((id) => row(id, "skip", "no database in this run — agent rows not read"));
  }
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const orgId = ctx.orgId || null;
  const cutoff = new Date(now.getTime() - RETRY_GRACE_MS);
  const floor = new Date(now.getTime() - FAILED_LOOKBACK_MS);

  const retired = await readRow(CHECK_RETIRED, FIX_AGENT, async () =>
    judgeRetired(await select(run, RETIRED_SQL, [orgId])));
  const failed = await readRow(CHECK_FAILED, FIX_RUN, async () =>
    judgeFailedRuns(await select(run, FAILED_RUN_SQL, [orgId, cutoff, floor, [...FAIL_OUTCOMES]]), { now }));
  return [retired, failed];
}
