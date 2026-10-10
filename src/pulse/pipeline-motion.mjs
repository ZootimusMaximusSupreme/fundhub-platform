// Pipeline motion — are clients moving, or stuck before they call?
// Audit only. SELECT only. Never fixes, never sends.

import { CLIENT_TAGS, ESCALATED_TAG, isHardStopped, isStalled } from "../workflows/dpc-05-no-progress-escalation.mjs";

const REPAIR_STUCK_STAGES = Object.freeze(["stalled", "letters_generated", "ready_to_send", "response_received"]);
const OUTBOUND_STUCK_MINUTES = 30;

function row(id, status, detail, suggestedFix = null, customerSees = null) {
  return { id, status, detail, suggestedFix, customerSees };
}

export async function readPipelineMotionCounts(db, { orgId, now = new Date() } = {}) {
  if (!db || !orgId) {
    return { ok: false, reason: "no_db", repair_stuck: 0, client_stalled: 0, outbound_stuck: 0 };
  }
  const [repair, outbound, clients] = await Promise.all([
    db.query(
      `SELECT count(*)::int AS n
         FROM cards c
         JOIN pipeline_stages ps ON ps.id = c.stage_id
         JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
        WHERE c.org_id = $1::uuid
          AND ps.key = ANY($2::text[])`,
      [orgId, REPAIR_STUCK_STAGES]
    ),
    db.query(
      `SELECT count(*)::int AS n
         FROM messages
        WHERE org_id = $1::uuid
          AND status = 'queued'
          AND coalesce(scheduled_at, created_at) < $2::timestamptz`,
      [orgId, new Date(now.getTime() - OUTBOUND_STUCK_MINUTES * 60 * 1000)]
    ),
    db.query(
      `SELECT tags, custom_fields
         FROM clients
        WHERE org_id = $1::uuid
          AND tags && $2::text[]`,
      [orgId, CLIENT_TAGS]
    )
  ]);
  let clientStalled = 0;
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
  if (n.repair_stuck > 0) {
    out.push(row(
      "pipeline:repair",
      "FAIL",
      `${n.repair_stuck} repair file${n.repair_stuck === 1 ? "" : "s"} need staff (stuck stage or letters waiting).`,
      "Open Repair desk and work the stuck queue. Do not auto-fix from this pulse.",
      "A repair client may be waiting on letters or a bureau answer with no one moving their file."
    ));
  } else {
    out.push(row("pipeline:repair", "PASS", "no repair files in a stuck need-me stage"));
  }
  if (n.client_stalled > 0) {
    out.push(row(
      "pipeline:clients",
      "FAIL",
      `${n.client_stalled} paying client${n.client_stalled === 1 ? "" : "s"} with no progress in 72+ hours (not escalated yet).`,
      "Check Client Control Panel and DPC-05 escalations. Do not auto-fix from this pulse.",
      "A client may feel ignored before anyone on staff notices."
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
