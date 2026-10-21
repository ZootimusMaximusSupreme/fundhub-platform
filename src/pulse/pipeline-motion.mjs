// Pipeline motion — are clients moving, or stuck before they call?
// Audit only. SELECT only. Never fixes, never sends.

import { CLIENT_TAGS, ESCALATED_TAG, isHardStopped, isStalled } from "../workflows/dpc-05-no-progress-escalation.mjs";
import { NO_REAL_WATCHED_CLIENT_CODE } from "./real-funding.mjs";
// The repair half (its stages, its SQL and its verdict) lives in the hourly beat's lib, so the morning
// pulse and the hourly beat repair-trip judge pipeline:repair with the same code (one judge, two clocks).
import { REPAIR_STUCK_SQL, REPAIR_STUCK_STAGES, judgeRepairMotion } from "./beats/lib/repair-motion-truth.mjs";

const OUTBOUND_STUCK_MINUTES = 30;

function row(id, status, detail, suggestedFix = null, customerSees = null, na = null) {
  return { id, status, detail, suggestedFix, customerSees, ...(na ? { na } : {}) };
}

export async function readPipelineMotionCounts(db, { orgId, now = new Date() } = {}) {
  if (!db || !orgId) {
    return { ok: false, reason: "no_db", repair_stuck: 0, client_stalled: 0, client_watched: 0, outbound_stuck: 0 };
  }
  const [repair, outbound, clients] = await Promise.all([
    db.query(REPAIR_STUCK_SQL, [orgId, REPAIR_STUCK_STAGES]),
    db.query(
      `SELECT count(*)::int AS n
         FROM messages
        WHERE org_id = $1::uuid
          AND status = 'queued'
          AND coalesce(scheduled_at, created_at) < $2::timestamptz`,
      [orgId, new Date(now.getTime() - OUTBOUND_STUCK_MINUTES * 60 * 1000)]
    ),
    // Real clients only (owner fact 2026-10-20): a client marked demo is test data and never raises a red.
    db.query(
      `SELECT tags, custom_fields
         FROM clients
        WHERE org_id = $1::uuid
          AND tags && $2::text[]
          AND COALESCE(is_demo, false) = false`,
      [orgId, CLIENT_TAGS]
    )
  ]);
  let clientStalled = 0;
  const clientWatched = (clients.rows || []).length;
  for (const r of clients.rows || []) {
    const tags = r.tags || [];
    if (tags.includes(ESCALATED_TAG)) continue;
    if (isHardStopped(r.custom_fields || {})) continue;
    if (isStalled(r.custom_fields || {}, now.getTime())) clientStalled += 1;
  }
  return {
    ok: true,
    repair_stuck: Number(repair.rows[0]?.n || 0),
    client_stalled: clientStalled,
    client_watched: clientWatched,
    outbound_stuck: Number(outbound.rows[0]?.n || 0)
  };
}

/** Three pulse checks: repair queue, client progress, outbound queue. */
export async function checkPipelineMotion({ db, orgId, now = new Date() } = {}) {
  if (!db || !orgId) {
    return [
      row("pipeline:repair", "skip", "no database — pipeline motion not read"),
      row("pipeline:clients", "skip", "no database — pipeline motion not read"),
      row("pipeline:outbound", "skip", "no database — pipeline motion not read")
    ];
  }
  const n = await readPipelineMotionCounts(db, { orgId, now });
  const out = [];
  out.push(judgeRepairMotion(n.repair_stuck));
  if (n.client_stalled > 0) {
    out.push(row(
      "pipeline:clients",
      "FAIL",
      `${n.client_stalled} paying client${n.client_stalled === 1 ? "" : "s"} with no progress in 72+ hours (not escalated yet).`,
      "Check Client Control Panel and DPC-05 escalations. Do not auto-fix from this pulse.",
      "A client may feel ignored before anyone on staff notices."
    ));
  } else if (n.client_watched === 0) {
    // No real client is on the watch, so there is nothing to judge. The morning audit
    // re-counts real watched clients (na-conditions.mjs) before this may stand.
    out.push(row(
      "pipeline:clients",
      "na",
      "No real client is on the 72-hour watch yet. Test clients are not judged.",
      null,
      null,
      { code: NO_REAL_WATCHED_CLIENT_CODE, args: { orgId: String(orgId || "") } }
    ));
  } else {
    out.push(row("pipeline:clients", "PASS", "no active clients past the 72-hour no-progress line"));
  }
  if (n.outbound_stuck > 0) {
    out.push(row(
      "pipeline:outbound",
      "FAIL",
      `${n.outbound_stuck} outbound message${n.outbound_stuck === 1 ? "" : "s"} still queued past ${OUTBOUND_STUCK_MINUTES} minutes.`,
      "Check message dispatch and messaging_settings.outbound_enabled. Do not auto-fix from this pulse.",
      "A client may not get a text or email they were supposed to get."
    ));
  } else {
    out.push(row("pipeline:outbound", "PASS", `no outbound rows queued longer than ${OUTBOUND_STUCK_MINUTES} minutes`));
  }
  return out;
}

export { OUTBOUND_STUCK_MINUTES, REPAIR_STUCK_STAGES };
