// The facts behind the boards: is each card in the stage the facts say, did each card move fire
// its event, do the two records that hold one fact agree. Report only. Read only.
// Never moves a card. Never texts. Never charges. Never pulls credit.
//
// Built for the 2026-10-10 coverage batch, workflow W3 "Pipelines truth".
// Board: ops/workflows/coverage-every-surface-2026-10-10.md, section 3 (P2, P4, P7).
// The shape half (columns count true, ages, dead stages, nobody lost) is gap-pipeline-boards.mjs.
//
//   pipeline:stage-vs-fact   P2  a card is in the stage the real facts say (paid, booked, funded,
//                                case cleared, partner status, invoice status)
//   pipeline:move-receipt    P4  every Funding card move in the last day fired its round event, and
//                                the event's result is there
//   pipeline:two-records     P7  funding round vs funding card, repair case vs repair card, Sales
//                                floor vs Sales board
//
// A card sits where a person or a handler put it. These checks never trust the card. They read the
// fact the card is meant to follow and say where the two disagree.
//
// The brief lists "funding_rounds.status vs the card" and "dispute_cases.status vs the repair card" in
// both P2 and P7. Each is written once here. P2 holds the Funding fact (a funded round, a funded
// card). P7 holds the repair case ladder and the Funding rounds that have no card (and cards that have
// no round), which P2 cannot see because it needs both rows.
//
// What is not invented: "paid" is the two marks the deposit.paid and sale.closed handlers stamp on the
// client (custom_fields.deposit_paid, custom_fields.sale_closed) or an active sale in a client product.
// payment.received alone is not a deposit: the $32 diagnostic fires it too, and that client belongs on
// Diagnostic Paid.

import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";

export const CHECK_IDS = Object.freeze([
  "pipeline:stage-vs-fact",
  "pipeline:move-receipt",
  "pipeline:two-records"
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_AUTOFIX = "The pulse only reports. Do not auto-fix from this pulse. Chris fixes reds.";
const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

/** A payment, a booking, a case this fresh is still on its way to the board. */
export const PAID_GRACE_MS = HOUR_MS;
export const SETTLE_GRACE_MS = 15 * MIN_MS;
/** P4 looks at moves in this window. */
export const MOVE_WINDOW_MS = DAY_MS;
const NAME_AT_MOST = 4;
const ROWS_AT_MOST = 25;

/** The Sales stages a paying client may sit on. Closed Won is the deposit; Downsell is the cheaper buy. */
export const SALES_PAID_STAGES = Object.freeze(["closed_won", "downsell"]);
/** A booked call puts the card on Booked or later. These are the two stages before it. */
export const SALES_BEFORE_BOOKED = Object.freeze(["new_lead", "survey_complete"]);
/** Where a funded round leaves its card. */
export const FUNDING_DONE_STAGES = Object.freeze(["funded", "closed"]);
/** Where a cleared inquiry case may leave its card. Hold is the fraud-alert landing. */
export const INQUIRY_CLEARED_STAGES = Object.freeze(["removed", "resume_funding", "hold"]);
/** A partner's status and the card stages that say the same thing. */
export const PARTNER_STAGES = Object.freeze({
  active: Object.freeze(["active"]),
  paused: Object.freeze(["paused"]),
  invited: Object.freeze(["invited", "recruiting", "agreement_signed"])
});
/** The invoice status each AR stage names. A card on a stage no invoice of that client is in disagrees. */
export const AR_STAGE_INVOICE = Object.freeze({
  invoice_sent: "sent",
  reminder: "reminded",
  escalation: "escalated",
  paid: "paid",
  written_off: "written_off"
});
/** Repair stages before the first letter is mailed, and after. */
export const REPAIR_BEFORE_SEND = Object.freeze(["intake", "awaiting_documents", "analysis", "letters_generated", "ready_to_send"]);
export const REPAIR_AFTER_SEND = Object.freeze(["in_transit", "awaiting_response", "response_received"]);
/** Funding stages after Apply Now. Each needs a round row behind it. */
export const FUNDING_AFTER_START = Object.freeze(["round_submitted", "approved", "action_required", "funded", "closed"]);

/** Funding stage -> the round event its move fires (src/funding/card-stacking-rounds.mjs STAGE_TO_EVENT). action_required fires none. */
export const STAGE_EVENTS = Object.freeze({
  apply_now: "round.started",
  round_submitted: "round.submitted",
  approved: "round.approved",
  funded: "round.funded",
  closed: "round.closeout"
});

/* ───────────── SQL ─────────────
   Every statement is one SELECT. No write verb, no transaction control. The test-client test is the
   one gap-consent.mjs exports. $N below is always named in the comment. */

const REAL_CLIENT = `
     AND COALESCE(cd.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $2::text
     AND (c.custom_fields->>'crm_archived_at') IS NULL`;

/** P2 rule S1. $1 org, $2 test-client pattern, $3 paid stages, $4 paid-after cut. */
export const SALES_PAID_SQL = `
  /* gap:pipeline-sales-paid */
  SELECT c.id::text AS client_id,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'sales' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND s.key <> ALL($3::text[])
     AND (
           c.custom_fields->>'deposit_paid' = 'true'
        OR c.custom_fields->>'sale_closed' = 'true'
        OR EXISTS (
             SELECT 1
               FROM sales sl
               JOIN products pr ON pr.id = sl.product_id
              WHERE sl.client_id = c.id
                AND sl.org_id = c.org_id
                AND sl.status = 'active'
                AND COALESCE(sl.is_demo, false) = false
                AND pr.category NOT IN ('diagnostic', 'partner_service')
           )
         )
     AND NOT EXISTS (
       SELECT 1 FROM sales fresh
        WHERE fresh.client_id = c.id AND fresh.org_id = c.org_id AND fresh.sold_at > $4::timestamptz
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P2 rule S2. $1 org, $2 test-client pattern, $3 stages before Booked, $4 booking-made-before cut. */
export const SALES_BOOKED_SQL = `
  /* gap:pipeline-sales-booked */
  SELECT c.id::text AS client_id,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'sales' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND s.key = ANY($3::text[])
     AND EXISTS (
       SELECT 1
         FROM bookings b
        WHERE b.client_id = c.id
          AND b.org_id = cd.org_id
          AND lower(btrim(COALESCE(b.status, ''))) NOT IN ('cancelled', 'canceled', 'noshow', 'no_show', 'no-show')
          AND b.created_at < $4::timestamptz
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P2 rule F, both ways. $1 org, $2 test-client pattern, $3 funded and closed stages. */
export const FUNDING_FUNDED_SQL = `
  /* gap:pipeline-funding-funded */
  WITH latest AS (
    SELECT DISTINCT ON (fr.client_id) fr.client_id, fr.status, fr.round_number
      FROM funding_rounds fr
     WHERE fr.org_id = $1::uuid
       AND COALESCE(fr.is_demo, false) = false
     ORDER BY fr.client_id, fr.round_number DESC
  )
  SELECT c.id::text AS client_id,
         s.key AS stage,
         l.round_number,
         CASE
           WHEN lower(btrim(COALESCE(l.status, ''))) = 'funded' AND s.key <> ALL($3::text[]) THEN 'round_funded_card_behind'
           WHEN s.key = 'funded' AND NOT EXISTS (
                  SELECT 1 FROM funding_rounds fx
                   WHERE fx.client_id = c.id AND fx.org_id = cd.org_id
                     AND lower(btrim(COALESCE(fx.status, ''))) = 'funded'
                ) THEN 'card_funded_no_funded_round'
         END AS problem,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'funding_card_stacking' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
    LEFT JOIN latest l ON l.client_id = c.id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND (
           (lower(btrim(COALESCE(l.status, ''))) = 'funded' AND s.key <> ALL($3::text[]))
        OR (s.key = 'funded' AND NOT EXISTS (
              SELECT 1 FROM funding_rounds fx
               WHERE fx.client_id = c.id AND fx.org_id = cd.org_id
                 AND lower(btrim(COALESCE(fx.status, ''))) = 'funded'
           ))
         )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P2 rule I. $1 org, $2 test-client pattern, $3 stages a cleared case may leave the card on, $4 cleared-before cut. */
export const INQUIRY_CLEARED_SQL = `
  /* gap:pipeline-inquiry-cleared */
  SELECT c.id::text AS client_id,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'inquiry_removal' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND s.key <> ALL($3::text[])
     AND EXISTS (
       SELECT 1 FROM inquiry_removal_cases ic
        WHERE ic.client_id = c.id AND ic.org_id = cd.org_id
          AND ic.case_status::text <> 'Canceled'
          AND COALESCE(ic.is_demo, false) = false
     )
     AND NOT EXISTS (
       SELECT 1 FROM inquiry_removal_cases ic
        WHERE ic.client_id = c.id AND ic.org_id = cd.org_id
          AND ic.case_status::text NOT IN ('Completed', 'Canceled')
          AND COALESCE(ic.is_demo, false) = false
     )
     AND NOT EXISTS (
       SELECT 1 FROM inquiry_removal_cases ic
        WHERE ic.client_id = c.id AND ic.org_id = cd.org_id
          AND COALESCE(ic.completed_at, ic.updated_at) > $4::timestamptz
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P2 rule P. $1 org. A partner's own status against the card on the Partners board. */
export const PARTNER_STATUS_SQL = `
  /* gap:pipeline-partner-status */
  SELECT pr.id::text AS partner_id,
         pr.status,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'affiliates_white_label' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN partners pr ON pr.id = cd.partner_id AND pr.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid
     AND COALESCE(pr.is_demo, false) = false
     AND NOT (
          (pr.status = 'active' AND s.key = 'active')
       OR (pr.status = 'paused' AND s.key = 'paused')
       OR (pr.status = 'invited' AND s.key IN ('invited', 'recruiting', 'agreement_signed'))
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P2 rule A. $1 org. An AR card names an invoice state; one of that client's invoices must be in it. */
export const AR_CARD_SQL = `
  /* gap:pipeline-ar-card */
  SELECT c.id::text AS client_id,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'ar_collections' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid
     AND COALESCE(cd.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND NOT EXISTS (
       SELECT 1
         FROM invoices i
        WHERE i.client_id = cd.client_id
          AND i.org_id = cd.org_id
          AND COALESCE(i.is_demo, false) = false
          AND i.status = CASE s.key
                WHEN 'invoice_sent' THEN 'sent'
                WHEN 'reminder' THEN 'reminded'
                WHEN 'escalation' THEN 'escalated'
                WHEN 'paid' THEN 'paid'
                WHEN 'written_off' THEN 'written_off'
              END
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** The stage-to-event table as a VALUES list. The text is built from STAGE_EVENTS, never from input. */
const STAGE_EVENT_VALUES = Object.entries(STAGE_EVENTS)
  .map(([stage, event]) => `('${stage}', '${event}')`)
  .join(", ");

/**
 * P4. $1 org, $2 test-client pattern, $3 moved-since, $4 moved-before (the grace).
 * One row per Funding card that entered a stage with an event in the window, with the event row that
 * move should have written (key card_stacking:<client>:<round>:<stage>:<event>) and what came of it.
 */
export const MOVE_RECEIPT_SQL = `
  /* gap:pipeline-move-receipt */
  SELECT m.client_id_text AS client_id,
         m.stage,
         m.event_name,
         m.entered_at,
         ev.id::text AS event_id,
         EXISTS (
           SELECT 1 FROM failed_events fe
            WHERE fe.event_id = ev.id
              AND fe.status NOT IN ('resolved', 'ignored')
         ) AS dead_letter,
         EXISTS (
           SELECT 1 FROM funding_rounds fr
            WHERE fr.client_id = m.client_id AND fr.org_id = $1::uuid
         ) AS has_round,
         (
           SELECT fr.status FROM funding_rounds fr
            WHERE fr.client_id = m.client_id AND fr.org_id = $1::uuid
            ORDER BY fr.round_number DESC
            LIMIT 1
         ) AS round_status,
         count(*) OVER ()::int AS total
    FROM (
      SELECT cd.client_id,
             cd.client_id::text AS client_id_text,
             s.key AS stage,
             map.event_name,
             cd.entered_at
        FROM cards cd
        JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'funding_card_stacking' AND p.org_id = cd.org_id
        JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
        JOIN (VALUES ${STAGE_EVENT_VALUES}) AS map(stage, event_name) ON map.stage = s.key
        JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
       WHERE cd.org_id = $1::uuid${REAL_CLIENT}
         AND cd.entered_at >= $3::timestamptz
         AND cd.entered_at < $4::timestamptz
    ) m
    LEFT JOIN LATERAL (
      SELECT e.id
        FROM events e
       WHERE e.org_id = $1::uuid
         AND e.client_id = m.client_id
         AND e.name = m.event_name
         AND split_part(e.idempotency_key, ':', 1) = 'card_stacking'
         AND split_part(e.idempotency_key, ':', 2) = m.client_id_text
         AND split_part(e.idempotency_key, ':', 4) = m.stage
         AND split_part(e.idempotency_key, ':', 5) = m.event_name
       ORDER BY e.created_at DESC
       LIMIT 1
    ) ev ON true
   ORDER BY m.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P7 rule F1. $1 org, $2 test-client pattern, $3 made-before cut. A round still going with no card on any Funding board. */
export const ROUND_NO_CARD_SQL = `
  /* gap:pipeline-round-no-card */
  SELECT c.id::text AS client_id,
         fr.round_number,
         fr.status,
         count(*) OVER ()::int AS total
    FROM funding_rounds fr
    JOIN clients c ON c.id = fr.client_id AND c.org_id = fr.org_id
   WHERE fr.org_id = $1::uuid
     AND COALESCE(fr.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
     AND COALESCE(c.email, '') !~* $2::text
     AND (c.custom_fields->>'crm_archived_at') IS NULL
     AND lower(btrim(COALESCE(fr.status, ''))) IN ('started', 'open')
     AND fr.created_at < $3::timestamptz
     AND NOT EXISTS (
       SELECT 1
         FROM cards cd
         JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id
        WHERE cd.client_id = fr.client_id
          AND cd.org_id = fr.org_id
          AND p.key IN ('funding_card_stacking', 'funding_altfin')
     )
   ORDER BY fr.created_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/** P7 rule F2. $1 org, $2 test-client pattern, $3 stages that need a round behind them. A card past Apply Now with no round row. */
export const CARD_NO_ROUND_SQL = `
  /* gap:pipeline-card-no-round */
  SELECT c.id::text AS client_id,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'funding_card_stacking' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND s.key = ANY($3::text[])
     AND NOT EXISTS (
       SELECT 1 FROM funding_rounds fr
        WHERE fr.client_id = c.id AND fr.org_id = cd.org_id
     )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/**
 * P7 rule R. $1 org, $2 test-client pattern, $3 stages before the first letter, $4 stages after it.
 * The case statuses of the client's CURRENT round only. Round 1 cases never leave awaiting_response
 * (nothing writes the next state), so reading every round would call every round 2 client wrong.
 */
export const REPAIR_CASE_CARD_SQL = `
  /* gap:pipeline-repair-case-card */
  WITH ranked AS (
    SELECT dc.client_id,
           dc.status,
           CASE WHEN dc.round ~ '^R[0-9]+$' THEN substr(dc.round, 2)::int
                WHEN dc.round = 'FURNISHER' THEN 7 END AS rn
      FROM dispute_cases dc
     WHERE dc.org_id = $1::uuid
       AND dc.status NOT IN ('closed', 'cancelled', 'round_complete', 'stalled')
  ), current_round AS (
    SELECT r.client_id,
           bool_or(r.status = 'awaiting_response') AS any_awaiting,
           bool_and(r.status = 'open') AS all_open
      FROM ranked r
     WHERE r.rn = (SELECT max(r2.rn) FROM ranked r2 WHERE r2.client_id = r.client_id)
     GROUP BY r.client_id
  )
  SELECT c.id::text AS client_id,
         s.key AS stage,
         cr.any_awaiting,
         cr.all_open,
         count(*) OVER ()::int AS total
    FROM cards cd
    JOIN pipelines p ON p.id = cd.pipeline_id AND p.key = 'optimization' AND p.org_id = cd.org_id
    JOIN pipeline_stages s ON s.id = cd.stage_id AND s.pipeline_id = p.id
    JOIN clients c ON c.id = cd.client_id AND c.org_id = cd.org_id
    JOIN current_round cr ON cr.client_id = cd.client_id
   WHERE cd.org_id = $1::uuid${REAL_CLIENT}
     AND (
           (cr.any_awaiting AND s.key = ANY($3::text[]))
        OR (cr.all_open AND s.key = ANY($4::text[]))
         )
   ORDER BY cd.entered_at ASC
   LIMIT ${ROWS_AT_MOST}
`;

/**
 * P7 rule S. $1 org, $2 test-client pattern, $3 month start, $4 month end.
 * One row per client the Sales floor counted a deposit or a downsell for this month, with where their
 * Sales card sits. The floor's own funnel is src/sales/metrics.mjs floorFunnel (call_outcomes this month).
 */
export const FLOOR_VS_BOARD_SQL = `
  /* gap:pipeline-floor-vs-board */
  WITH per AS (
    SELECT o.client_id,
           count(*) FILTER (WHERE o.outcome = 'deposit')::int AS deposits,
           count(*) FILTER (WHERE o.outcome = 'downsell')::int AS downsells
      FROM call_outcomes o
      JOIN clients c ON c.id = o.client_id AND c.org_id = o.org_id
     WHERE o.org_id = $1::uuid
       AND o.logged_at >= $3::timestamptz
       AND o.logged_at < $4::timestamptz
       AND o.outcome IN ('deposit', 'downsell')
       AND o.client_id IS NOT NULL
       AND COALESCE(o.is_demo, false) = false
       AND COALESCE(c.is_demo, false) = false
       AND COALESCE(c.custom_fields->>'synthetic', '') <> 'true'
       AND COALESCE(c.email, '') !~* $2::text
     GROUP BY o.client_id
  )
  SELECT per.client_id::text AS client_id,
         per.deposits,
         per.downsells,
         s.key AS stage,
         count(*) OVER ()::int AS total
    FROM per
    LEFT JOIN pipelines p ON p.org_id = $1::uuid AND p.key = 'sales'
    LEFT JOIN cards cd ON cd.client_id = per.client_id AND cd.pipeline_id = p.id AND cd.org_id = p.org_id
    LEFT JOIN pipeline_stages s ON s.id = cd.stage_id
   ORDER BY per.client_id ASC
   LIMIT 500
`;

/* ───────────── small helpers ───────────── */

function clip(s, n = 400) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);
}

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail: clip(detail, 500), suggestedFix: suggestedFix ? clip(suggestedFix, 300) : null };
}

function errText(err) {
  return clip(err && err.message ? err.message : err, 140);
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function short(id) {
  return String(id || "").slice(0, 8);
}

/** ctx.db is what the read routes use (the plain role). The staff scope is only the fallback. */
function bind(ctx) {
  if (ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  if (typeof ctx.scope === "function") return (fn) => ctx.scope(fn);
  return null;
}

async function read(run, sql, params) {
  try {
    const out = await run((tx) => tx.query(sql, params));
    return { rows: (out && out.rows) || [], error: null };
  } catch (err) {
    return { rows: [], error: errText(err) };
  }
}

function skipAll(why) {
  return CHECK_IDS.map((id) => row(id, "skip", why));
}

/** The full count behind a read that was cut at ROWS_AT_MOST (count(*) OVER () runs before LIMIT). */
function totalOf(rows) {
  return rows.length ? Math.max(Number(rows[0].total) || 0, rows.length) : 0;
}

function idList(rows, key = "client_id") {
  return rows.slice(0, NAME_AT_MOST).map((r) => short(r[key])).join(", ");
}

/** The calendar month as the Sales floor reads it (src/sales/metrics.mjs monthWindow: UTC month). */
export function monthWindow(now = new Date()) {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  };
}

/** Run named reads side by side. Returns { name: { rows, error } }. */
async function readAll(run, jobs) {
  const out = {};
  await Promise.all(Object.entries(jobs).map(async ([name, [sql, params]]) => {
    out[name] = await read(run, sql, params);
  }));
  return out;
}

/** Fold the sub-rules of one check into one row. A found problem is red. A failed read with no problem is a skip. */
function settle(id, found, failed, passText, fix) {
  if (found.length) return row(id, "FAIL", `${found.join(". ")}.`, fix);
  if (failed.length) return row(id, "skip", `could not read everything, so this is not proved: ${failed.join("; ")}`);
  return row(id, "PASS", passText);
}

/* ───────────── P2 pipeline:stage-vs-fact ───────────── */

const FUNDING_PROBLEM = Object.freeze({
  round_funded_card_behind: "the round says funded and the card is not on Funded",
  card_funded_no_funded_round: "the card is on Funded and no round says funded"
});

async function checkStageVsFact(run, orgId, now) {
  const id = "pipeline:stage-vs-fact";
  const fix = `Open Pipeline. The card is not where the facts say. Find which record is right and move the card by hand. ${NO_AUTOFIX}`;
  const paidCut = new Date(now.getTime() - PAID_GRACE_MS).toISOString();
  const settleCut = new Date(now.getTime() - SETTLE_GRACE_MS).toISOString();
  const r = await readAll(run, {
    paid: [SALES_PAID_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...SALES_PAID_STAGES], paidCut]],
    booked: [SALES_BOOKED_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...SALES_BEFORE_BOOKED], settleCut]],
    funded: [FUNDING_FUNDED_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...FUNDING_DONE_STAGES]]],
    inquiry: [INQUIRY_CLEARED_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...INQUIRY_CLEARED_STAGES], settleCut]],
    partner: [PARTNER_STATUS_SQL, [orgId]],
    ar: [AR_CARD_SQL, [orgId]]
  });
  const found = [];
  const failed = [];
  const note = (name, label) => { if (r[name].error) failed.push(`${label} (${r[name].error})`); };
  note("paid", "paid clients");
  note("booked", "booked clients");
  note("funded", "funded rounds");
  note("inquiry", "cleared inquiry cases");
  note("partner", "partner status");
  note("ar", "AR invoices");

  if (r.paid.rows.length) {
    const n = totalOf(r.paid.rows);
    const where = [...new Set(r.paid.rows.map((x) => x.stage))].slice(0, 3).join(", ");
    found.push(`${plural(n, "paying client")} ${n === 1 ? "is" : "are"} not on Closed Won or Downsell (on ${where}): ${idList(r.paid.rows)}`);
  }
  if (r.booked.rows.length) {
    const n = totalOf(r.booked.rows);
    found.push(`${plural(n, "client")} with a booked call ${n === 1 ? "is" : "are"} still before Booked: ${idList(r.booked.rows)}`);
  }
  if (r.funded.rows.length) {
    const n = totalOf(r.funded.rows);
    const kinds = [...new Set(r.funded.rows.map((x) => FUNDING_PROBLEM[x.problem]).filter(Boolean))];
    found.push(`${plural(n, "Funding card")} ${n === 1 ? "disagrees" : "disagree"} with ${n === 1 ? "its" : "their"} round (${kinds.join("; ")}): ${idList(r.funded.rows)}`);
  }
  if (r.inquiry.rows.length) {
    const n = totalOf(r.inquiry.rows);
    found.push(`${plural(n, "inquiry client")} ${n === 1 ? "has" : "have"} every case Completed and ${n === 1 ? "the card is" : "the cards are"} not on Removed or Resume Funding: ${idList(r.inquiry.rows)}`);
  }
  if (r.partner.rows.length) {
    const n = totalOf(r.partner.rows);
    const say = r.partner.rows.slice(0, NAME_AT_MOST).map((x) => `${short(x.partner_id)} is ${x.status} on card ${x.stage}`).join(", ");
    found.push(`${plural(n, "partner")} ${n === 1 ? "has" : "have"} a status the card does not match: ${say}`);
  }
  if (r.ar.rows.length) {
    const n = totalOf(r.ar.rows);
    found.push(`${plural(n, "AR card")} name${n === 1 ? "s" : ""} an invoice state none of that client's invoices is in: ${idList(r.ar.rows)}`);
  }
  return settle(
    id,
    found,
    failed,
    "Every Sales, Funding, Inquiry, Partner and AR card sits where its facts say: paid clients on Closed Won or Downsell, booked clients on Booked or later, funded rounds on Funded, cleared cases on Removed or Resume Funding, partners on their own status, AR cards on a real invoice state.",
    fix
  );
}

/* ───────────── P4 pipeline:move-receipt ───────────── */

/**
 * Pure. Turn MOVE_RECEIPT_SQL rows into what is wrong with each move.
 * A move is right when its event is there, no handler failed on it, and the result the round row
 * should show is there (a round row for round.started, a funded round for round.funded).
 */
export function judgeMoves(rows) {
  const bad = [];
  for (const r of rows || []) {
    const stage = String(r.stage);
    if (!r.event_id) {
      bad.push({ client_id: r.client_id, stage, why: `moved to ${stage} and ${r.event_name} was never written` });
    } else if (r.dead_letter) {
      bad.push({ client_id: r.client_id, stage, why: `${r.event_name} fired and a handler failed on it` });
    } else if (stage === "apply_now" && !r.has_round) {
      bad.push({ client_id: r.client_id, stage, why: "round.started fired and no round row exists" });
    } else if (stage === "funded" && String(r.round_status || "").toLowerCase() !== "funded") {
      bad.push({ client_id: r.client_id, stage, why: "round.funded fired and the round does not say funded" });
    }
  }
  return bad;
}

async function checkMoveReceipt(run, orgId, now) {
  const id = "pipeline:move-receipt";
  const fix = `Open the Funding client and read the Failed events screen. The card moved and the round did not follow. ${NO_AUTOFIX}`;
  const since = new Date(now.getTime() - MOVE_WINDOW_MS).toISOString();
  const before = new Date(now.getTime() - SETTLE_GRACE_MS).toISOString();
  const read1 = await read(run, MOVE_RECEIPT_SQL, [orgId, TEST_CLIENT_EMAIL_RE, since, before]);
  if (read1.error) return row(id, "skip", `could not read the Funding card moves and their events: ${read1.error}`);
  const bad = judgeMoves(read1.rows);
  if (bad.length) {
    const lines = bad.slice(0, NAME_AT_MOST).map((b) => `${short(b.client_id)} ${b.why}`);
    const more = bad.length > NAME_AT_MOST ? `, and ${bad.length - NAME_AT_MOST} more` : "";
    return row(id, "FAIL", `${plural(bad.length, "Funding card move")} in the last day did not finish: ${lines.join("; ")}${more}.`, fix);
  }
  const n = totalOf(read1.rows);
  return row(
    id,
    "PASS",
    n
      ? `${plural(n, "Funding card move")} in the last day. Each wrote its round event, and no handler failed on one.`
      : "No Funding card moved in the last day, so there is no event to check."
  );
}

/* ───────────── P7 pipeline:two-records ───────────── */

/**
 * Pure. Rows of FLOOR_VS_BOARD_SQL. A client the floor counted a deposit for must be on Closed Won; a
 * client counted only for a downsell must be on Downsell. Returns { clients, deposits, wrong }.
 */
export function judgeFloor(rows) {
  const wrong = [];
  let deposits = 0;
  for (const r of rows || []) {
    const dep = Number(r.deposits) || 0;
    deposits += dep;
    const want = dep > 0 ? "closed_won" : "downsell";
    const have = r.stage == null ? null : String(r.stage);
    if (have !== want) wrong.push({ client_id: r.client_id, want, have });
  }
  return { clients: (rows || []).length, deposits, wrong };
}

async function checkTwoRecords(run, orgId, now) {
  const id = "pipeline:two-records";
  const fix = `Open Pipeline and the record that disagrees. Two tables hold one fact and say two things. ${NO_AUTOFIX}`;
  const settleCut = new Date(now.getTime() - SETTLE_GRACE_MS).toISOString();
  const window = monthWindow(now);
  const r = await readAll(run, {
    roundNoCard: [ROUND_NO_CARD_SQL, [orgId, TEST_CLIENT_EMAIL_RE, settleCut]],
    cardNoRound: [CARD_NO_ROUND_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...FUNDING_AFTER_START]]],
    repair: [REPAIR_CASE_CARD_SQL, [orgId, TEST_CLIENT_EMAIL_RE, [...REPAIR_BEFORE_SEND], [...REPAIR_AFTER_SEND]]],
    floor: [FLOOR_VS_BOARD_SQL, [orgId, TEST_CLIENT_EMAIL_RE, window.start.toISOString(), window.end.toISOString()]]
  });
  const found = [];
  const failed = [];
  const note = (name, label) => { if (r[name].error) failed.push(`${label} (${r[name].error})`); };
  note("roundNoCard", "Funding rounds");
  note("cardNoRound", "Funding cards");
  note("repair", "repair cases");
  note("floor", "Sales floor outcomes");

  if (r.roundNoCard.rows.length) {
    const n = totalOf(r.roundNoCard.rows);
    found.push(`${plural(n, "Funding round")} ${n === 1 ? "is" : "are"} still going and ${n === 1 ? "the client has" : "the clients have"} no Funding card: ${idList(r.roundNoCard.rows)}`);
  }
  if (r.cardNoRound.rows.length) {
    const n = totalOf(r.cardNoRound.rows);
    found.push(`${plural(n, "Funding card")} ${n === 1 ? "sits" : "sit"} past Apply Now with no round row: ${idList(r.cardNoRound.rows)}`);
  }
  if (r.repair.rows.length) {
    const n = totalOf(r.repair.rows);
    const kinds = new Set(r.repair.rows.map((x) => (x.any_awaiting ? "a case says the letter is out and the card is before Letters Sent" : "the card says letters are out and every case is still open")));
    found.push(`${plural(n, "Repair client")} ${n === 1 ? "has" : "have"} a case and a card that disagree (${[...kinds].join("; ")}): ${idList(r.repair.rows)}`);
  }
  const floor = judgeFloor(r.floor.rows);
  if (floor.wrong.length) {
    const have = r.floor.rows.length;
    const where = floor.wrong.slice(0, NAME_AT_MOST).map((w) => `${short(w.client_id)} should be on ${w.want} and is on ${w.have || "no Sales card"}`).join(", ");
    found.push(`the Sales floor counted ${plural(floor.deposits, "deposit")} this month for ${plural(have, "client")} and the board disagrees on ${floor.wrong.length}: ${where}`);
  }
  return settle(
    id,
    found,
    failed,
    "The two records agree. Every Funding round that is going has a Funding card, and every Funding card past Apply Now has a round. Every Repair client's case and card tell the same story. Every client the Sales floor counted this month sits where the call result says.",
    fix
  );
}

/* ───────────── the lane ───────────── */

/**
 * Morning-pulse rows for the facts behind the boards.
 * ctx: { db, scope, now, orgId }. SELECT only. No POST. Nothing is sent.
 */
export async function gapChecks(ctx = {}) {
  const run = bind(ctx);
  if (!run) return skipAll("no database in this run — the facts behind the boards were not read");
  const orgRaw = String(ctx.orgId || "").trim();
  if (!UUID_RE.test(orgRaw)) return skipAll("no company id in this run — the facts behind the boards were not read");
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const [stage, move, two] = await Promise.all([
    checkStageVsFact(run, orgRaw, now).catch((err) => row("pipeline:stage-vs-fact", "skip", `the stage check threw: ${errText(err)}`)),
    checkMoveReceipt(run, orgRaw, now).catch((err) => row("pipeline:move-receipt", "skip", `the move check threw: ${errText(err)}`)),
    checkTwoRecords(run, orgRaw, now).catch((err) => row("pipeline:two-records", "skip", `the two-records check threw: ${errText(err)}`))
  ]);
  return [stage, move, two];
}
