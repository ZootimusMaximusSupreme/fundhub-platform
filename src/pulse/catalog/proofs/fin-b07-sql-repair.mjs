// Finish-853 batch 07: the read-only SQL texts for the Repair queue, stage columns and repair letters live checks.
// Each takes the company as $1::uuid and answers sample_count and bad_count. The common subset of
// Postgres and SQLite on purpose (see fin-b07-display-contracts.mjs), so the test can run the text.
// Imports nothing.

const W60 = "now() - interval '60 days'";
const W30 = "now() - interval '30 days'";

// ── Specialist desk: the Repair queue ────────────────────────────────────────────────────────

export const REPAIR_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR ps.id IS NULL
         OR ps.pipeline_id IS DISTINCT FROM c.pipeline_id
         OR COALESCE(c.entered_at, c.updated_at) IS NULL)::int AS bad_count
  FROM cards c
  JOIN pipelines p ON p.org_id = c.org_id AND p.id = c.pipeline_id AND p.key = 'optimization'
  LEFT JOIN pipeline_stages ps ON ps.org_id = c.org_id AND ps.id = c.stage_id
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false`;

export const REPAIR_ROW_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR EXISTS (SELECT 1 FROM dispute_items di WHERE di.case_id = dc.id AND di.client_id IS DISTINCT FROM dc.client_id)
         OR EXISTS (SELECT 1 FROM dispute_letters dl WHERE dl.case_id = dc.id AND dl.client_id IS DISTINCT FROM dc.client_id)
         OR (dc.pipeline_card_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM cards k WHERE k.id = dc.pipeline_card_id AND k.client_id = dc.client_id)))::int AS bad_count
  FROM dispute_cases dc
  LEFT JOIN clients cl ON cl.org_id = dc.org_id AND cl.id = dc.client_id
 WHERE dc.org_id = $1::uuid AND dc.status NOT IN ('closed', 'cancelled')
   AND COALESCE(cl.is_demo, false) = false
   AND dc.updated_at >= ${W60}`;

/** The cards sitting in one stage of the optimization board, judged by that stage's own clock or its own paper. */
function stageSql(stageKey, badWhere) {
  return `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${badWhere.trim()})::int AS bad_count
  FROM cards c
  JOIN pipelines p ON p.org_id = c.org_id AND p.id = c.pipeline_id AND p.key = 'optimization'
  JOIN pipeline_stages ps ON ps.org_id = c.org_id AND ps.id = c.stage_id AND ps.key = '${stageKey}'
  JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false AND COALESCE(cl.is_demo, false) = false`;
}

const CLOCK = "COALESCE(c.entered_at, c.updated_at)";
const LETTER_IN = (statuses) => `EXISTS (
         SELECT 1 FROM dispute_letters dl
          WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id
            AND dl.status IN (${statuses.map((s) => `'${s}'`).join(", ")}))`;
const OPEN_DUE = `SELECT 1 FROM dispute_cases dc
          WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id
            AND dc.status NOT IN ('closed', 'cancelled') AND dc.response_due_at IS NOT NULL`;

// Three business days are judged at five calendar days, so a weekend never turns a file red.
export const STAGE_INTAKE_SQL = stageSql("intake", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '5 days'`);
export const STAGE_AWAIT_DOCS_SQL = stageSql("awaiting_documents", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '14 days'`);
export const STAGE_ANALYSIS_SQL = stageSql("analysis", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '1 hour'`);
export const STAGE_LETTERS_GEN_SQL = stageSql("letters_generated", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '30 minutes'
         OR NOT EXISTS (
              SELECT 1 FROM dispute_letters dl WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id)`);
export const STAGE_READY_SQL = stageSql("ready_to_send", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '4 hours'
         OR NOT ${LETTER_IN(["generated", "ready"])}`);
export const STAGE_TRANSIT_SQL = stageSql("in_transit", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '10 days'
         OR NOT ${LETTER_IN(["sending", "sent", "delivered"])}`);
export const STAGE_AWAIT_RESP_SQL = stageSql("awaiting_response", `NOT EXISTS (${OPEN_DUE})
         OR (SELECT MIN(dc.response_due_at) FROM dispute_cases dc
              WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id
                AND dc.status NOT IN ('closed', 'cancelled') AND dc.response_due_at IS NOT NULL)
            < now() - interval '5 days'`);
export const STAGE_RESP_RECV_SQL = stageSql("response_received", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '24 hours'
         OR NOT EXISTS (
              SELECT 1 FROM dispute_responses dr WHERE dr.org_id = c.org_id AND dr.client_id = c.client_id)`);
export const STAGE_ROUND_DONE_SQL = stageSql("round_complete", `NOT EXISTS (
              SELECT 1 FROM dispute_responses dr WHERE dr.org_id = c.org_id AND dr.client_id = c.client_id)
         AND NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.client_id = c.client_id
                 AND e.name IN ('repair.round.complete', 'repair.response.parsed'))`);
export const STAGE_STALLED_SQL = stageSql("stalled", `NOT EXISTS (
              SELECT 1 FROM repair_decision_log rd
               WHERE rd.org_id = c.org_id AND rd.client_id = c.client_id
                 AND rd.decision IN ('repair.stalled', 'repair.analysis.empty'))
         AND NOT EXISTS (
              SELECT 1 FROM dispute_cases dc
               WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id AND dc.status = 'stalled')`);
export const STAGE_PROGRAM_DONE_SQL = stageSql("program_complete", `NOT EXISTS (
              SELECT 1 FROM repair_programs rp
               WHERE rp.org_id = c.org_id AND rp.client_id = c.client_id
                 AND rp.status IN ('complete', 'upsell_pending'))
         AND NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.client_id = c.client_id AND e.name = 'repair.program.complete')`);
export const STAGE_CANCELLED_SQL = stageSql("cancelled", `EXISTS (
              SELECT 1 FROM repair_programs rp
               WHERE rp.org_id = c.org_id AND rp.client_id = c.client_id AND rp.status = 'active')`);

// ── Specialist desk: repair letters (dispute_letters) ────────────────────────────────────────

export const ROW_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE dc.id IS NULL
         OR dc.client_id IS DISTINCT FROM dl.client_id
         OR (dl.status IN ('sent', 'delivered') AND (dl.mailed_at IS NULL OR dl.send_claimed_at IS NULL))
         OR (dl.status = 'sending' AND dl.send_claimed_at < now() - interval '1 days')
         OR (dl.mailed_at IS NOT NULL AND dc.response_due_at IS NULL))::int AS bad_count
  FROM dispute_letters dl
  LEFT JOIN dispute_cases dc ON dc.org_id = dl.org_id AND dc.id = dl.case_id
 WHERE dl.org_id = $1::uuid
   AND (dl.status IN ('sending', 'sent', 'delivered') OR dl.mailed_at IS NOT NULL)
   AND dl.created_at >= ${W30}`;

export const LETTER_ONE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)
         OR NULLIF(BTRIM(COALESCE(dl.bureau, '')), '') IS NULL
         OR EXISTS (
              SELECT 1 FROM dispute_letters o
               WHERE o.org_id = dl.org_id AND o.case_id = dl.case_id AND o.bureau = dl.bureau
                 AND o.round = dl.round AND o.target = dl.target
                 AND o.id <> dl.id AND o.mailed_at IS NOT NULL))::int AS bad_count
  FROM dispute_letters dl
 WHERE dl.org_id = $1::uuid AND dl.mailed_at IS NOT NULL
   AND dl.created_at >= ${W30}`;

export const ROW_STAGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE dc.id IS NULL
         OR dc.client_id IS DISTINCT FROM dl.client_id
         OR NULLIF(BTRIM(COALESCE(dl.body_text, '')), '') IS NULL
         OR (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)
         OR dl.mailed_at IS NOT NULL)::int AS bad_count
  FROM dispute_letters dl
  LEFT JOIN dispute_cases dc ON dc.org_id = dl.org_id AND dc.id = dl.case_id
 WHERE dl.org_id = $1::uuid AND dl.status IN ('generated', 'ready')
   AND dl.created_at >= ${W30}`;

