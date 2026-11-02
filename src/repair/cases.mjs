// Repair desk queue — optimization pipeline cards plus letter counts + §9 signals.
// List payloads never include letter bodies. Detail does, for a human send.
// No money fields (§2.11).

import { gatherRepairSignals, gatherRepairDetailSignals } from "./read-repair-signals.mjs";
import { rollupCounts } from "./lens.mjs";
import { buildRoundPlan } from "./round-plan.mjs";

export const NEED_ME_STAGES = Object.freeze([
  "letters_generated",
  "ready_to_send",
  "response_received",
  "stalled"
]);

export const STAGE_LABELS = Object.freeze({
  intake: "Setting up",
  awaiting_documents: "Waiting on papers",
  analysis: "Reviewing the report",
  letters_generated: "Letters made",
  ready_to_send: "Ready to send",
  in_transit: "In the mail",
  awaiting_response: "Waiting on the bureau",
  response_received: "Answer in",
  round_complete: "Round done",
  program_complete: "Done",
  on_hold: "On hold",
  stalled: "Stuck",
  cancelled: "Cancelled",
  round_sent: "Round sent",
  bureau_processing: "Bureau working",
  portal_updated: "Portal updated",
  upgrade_invite: "Upgrade invite"
});

const READY_LETTER = new Set(["generated", "ready"]);

export function stageLabel(key) {
  const k = String(key || "");
  return STAGE_LABELS[k] || k || "Unknown";
}

export function isNeedMeStage(key) {
  return NEED_ME_STAGES.includes(String(key || ""));
}

export function countNeedMe(files = []) {
  return files.filter((f) => f && f.need_me).length;
}

function clientName(row) {
  const n = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
  return n || row.email || "Unnamed";
}

function mapFile(row, signals = {}) {
  const stageKey = row.stage_key;
  const ready = Number(row.letters_ready) || 0;
  const sent = Number(row.letters_sent) || 0;
  const due = signals.response_due_at != null
    ? signals.response_due_at
    : (row.response_due_at || null);
  return {
    card_id: row.card_id,
    client_id: row.client_id,
    name: clientName(row),
    email: row.email || null,
    stage_key: stageKey,
    stage_label: stageLabel(stageKey),
    updated_at: row.updated_at,
    entered_at: row.entered_at || null,
    need_me: isNeedMeStage(stageKey),
    round: row.round || null,
    bureaus: Array.isArray(row.bureaus) ? row.bureaus.filter(Boolean) : [],
    letters_ready: ready,
    letters_sent: sent,
    case_count: Number(row.case_count) || 0,
    can_send: ready > 0,
    program: signals.program != null ? signals.program : null,
    rounds_cap: signals.rounds_cap != null ? signals.rounds_cap : null,
    program_status: signals.program_status != null ? signals.program_status : null,
    authorization_ok: signals.authorization_ok,
    address_ok: signals.address_ok,
    response_due_at: due,
    upsell_pending: Boolean(signals.upsell_pending),
    has_unconfirmed_parse: Boolean(signals.has_unconfirmed_parse),
    sla_breached: Boolean(signals.sla_breached),
    no_furnisher_address: Boolean(signals.no_furnisher_address)
  };
}

const LIST_SQL = `
SELECT c.id AS card_id,
       c.client_id,
       cl.first_name,
       cl.last_name,
       cl.email,
       ps.key AS stage_key,
       c.updated_at,
       c.entered_at,
       dc.round,
       dc.bureaus,
       dc.response_due_at,
       COALESCE(dc.case_count, 0) AS case_count,
       COALESCE(dl.letters_ready, 0) AS letters_ready,
       COALESCE(dl.letters_sent, 0) AS letters_sent
  FROM cards c
  JOIN pipeline_stages ps ON ps.id = c.stage_id
  JOIN pipelines p ON p.id = c.pipeline_id AND p.key = 'optimization'
  LEFT JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS case_count,
           MAX(round) AS round,
           ARRAY_AGG(DISTINCT bureau) AS bureaus,
           MIN(response_due_at) AS response_due_at
      FROM dispute_cases
     WHERE org_id = c.org_id
       AND client_id = c.client_id
       AND status NOT IN ('closed', 'cancelled')
  ) dc ON TRUE
  LEFT JOIN LATERAL (
    SELECT COUNT(*) FILTER (WHERE status IN ('generated', 'ready'))::int AS letters_ready,
           COUNT(*) FILTER (WHERE status IN ('sent', 'delivered'))::int AS letters_sent
      FROM dispute_letters
     WHERE org_id = c.org_id
       AND client_id = c.client_id
  ) dl ON TRUE
 WHERE c.org_id = $1::uuid
   AND cl.id IS NOT NULL
   AND cl.custom_fields->>'crm_archived_at' IS NULL
`;

async function attachSignals(db, orgId, rows) {
  const base = (rows || []).map((row) => ({
    client_id: row.client_id,
    stage_key: row.stage_key,
    entered_at: row.entered_at,
    updated_at: row.updated_at,
    response_due_at: row.response_due_at || null
  }));
  const ids = base.map((b) => b.client_id).filter(Boolean);
  const signals = await gatherRepairSignals(db, { orgId, clientIds: ids, files: base });
  return (rows || []).map((row) => mapFile(row, signals.get(String(row.client_id)) || {}));
}

export async function listRepairCases(db, { orgId, limit = 100 } = {}) {
  if (!orgId) throw new Error("orgId required");
  const cap = Math.min(Math.max(Number(limit) || 100, 1), 200);
  /* `total` is COUNT(*) over the same WHERE clause, before the LIMIT. The tiles
     are computed from the rows that came back, so past the cap they count a page
     and not a caseload — and a headline that says "17 need me" when it only
     looked at the first 100 of 143 files is under-reporting on exactly the day
     the desk is busiest. The screen says which of the two it is showing; it can
     only do that if the reader tells it the real size. */
  const r = await db.query(
    `SELECT sub.*, COUNT(*) OVER () AS queue_total FROM (
       ${LIST_SQL}
     ) sub
     ORDER BY (sub.stage_key = ANY($2::text[])) DESC, sub.updated_at DESC
     LIMIT $3`,
    [orgId, [...NEED_ME_STAGES], cap]
  );
  const rows = (r.rows || []).map((row) => {
    const { queue_total, ...rest } = row;
    return rest;
  });
  const total = (r.rows || []).length ? Number(r.rows[0].queue_total) : 0;
  const files = await attachSignals(db, orgId, rows);
  const rollups = rollupCounts(files);
  return {
    files,
    total: Number.isFinite(total) ? total : files.length,
    need_me: rollups.need_me,
    ready: rollups.ready,
    waiting: rollups.waiting,
    stalled: rollups.stalled,
    trial_ending: rollups.trial_ending
  };
}

const LETTERS_SQL_WITH_TARGET = `
SELECT id, bureau, round, status, body_text, rule_ids, target
  FROM dispute_letters
 WHERE org_id = $1::uuid AND client_id = $2::uuid
 ORDER BY created_at DESC
 LIMIT 50`;

const LETTERS_SQL_FALLBACK = `
SELECT id, bureau, round, status, body_text, rule_ids
  FROM dispute_letters
 WHERE org_id = $1::uuid AND client_id = $2::uuid
 ORDER BY created_at DESC
 LIMIT 50`;

async function loadLetters(db, orgId, clientId) {
  try {
    return await db.query(LETTERS_SQL_WITH_TARGET, [orgId, clientId]);
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/target|column/i.test(msg)) {
      return db.query(LETTERS_SQL_FALLBACK, [orgId, clientId]);
    }
    throw err;
  }
}

export async function getRepairCase(db, { orgId, clientId } = {}) {
  if (!orgId) throw new Error("orgId required");
  if (!clientId) throw new Error("clientId required");
  const fileRes = await db.query(`${LIST_SQL} AND c.client_id = $2::uuid LIMIT 1`, [orgId, clientId]);
  const files = await attachSignals(db, orgId, fileRes.rows || []);
  const file = files[0] || null;

  const lettersRes = await loadLetters(db, orgId, clientId);
  const itemsRes = await db.query(
    `SELECT di.id, di.rule_id, di.severity, di.field, di.creditor, di.account_last4,
            di.round, di.status, di.outcome, dc.bureau
       FROM dispute_items di
       JOIN dispute_cases dc ON dc.id = di.case_id
      WHERE di.org_id = $1::uuid AND di.client_id = $2::uuid
      ORDER BY CASE di.severity
                 WHEN 'deletion' THEN 0
                 WHEN 'strong' THEN 1
                 WHEN 'moderate' THEN 2
                 ELSE 3
               END,
               di.created_at DESC
      LIMIT 100`,
    [orgId, clientId]
  );

  const detailSignals = await gatherRepairDetailSignals(db, { orgId, clientId });

  const letters = (lettersRes.rows || []).map((row) => ({
    id: row.id,
    bureau: row.bureau,
    round: row.round,
    status: row.status,
    rule_ids: row.rule_ids || [],
    target: row.target != null ? row.target : null,
    html: READY_LETTER.has(row.status) ? row.body_text || "" : null,
    can_send: READY_LETTER.has(row.status) && Boolean(row.body_text)
  }));

  const items = itemsRes.rows || [];
  const rounds = buildRoundPlan({
    roundsCap: file?.rounds_cap,
    items,
    letters
  });

  return {
    file,
    letters,
    items,
    rounds,
    can_send: letters.some((l) => l.can_send),
    timeline: detailSignals.timeline || [],
    signer_name: detailSignals.signer_name != null ? detailSignals.signer_name : null,
    signed_at: detailSignals.signed_at != null ? detailSignals.signed_at : null
  };
}
