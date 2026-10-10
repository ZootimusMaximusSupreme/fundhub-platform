// The funding trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:funding   Did every customer who started the funding trip in the last 60 days get every
//                  step the company owes, and what is the first step that is missing?
//
// THE LADDER (the brief's order). The first column is the step key, the second who owes it.
//
//    1 diagnostic_paid   client   paid the diagnostic
//    2 sales_card        system   a Sales card at Diagnostic Paid or later (onDiagnosticPaid moves it)
//    3 booked            client   booked a call
//    4 call_held         person   the call was held and an outcome logged
//    5 deposit_paid      client   paid the funding deposit (a sale in a funding product)
//    6 funding_card      system   a Funding card at Apply Now (purchase-routing places it)
//    7 round_opened      system   a funding round exists (round.started writes it)
//    8 submitted         person   the round went to the banks (round.submitted)
//    9 approved          person   a bank said yes WITH a dollar amount
//   10 funded            person   the round is funded
//   11 closeout          system   the closeout record
//   12 invoice           system   the success-fee bill
//   13 commission        system   the staff commission rows
//
// Steps 11 to 13 are judged by the SAME rule the money lane uses (roundProblems in
// gap-money-funding.mjs), so the trip and funding:funded-no-bill can never disagree about what a
// funded round owes. The waits are the other lanes' own: the paid-to-card wait and the round wait
// are gap-pipeline-facts.mjs (PAID_GRACE_MS, SETTLE_GRACE_MS); the funded-to-bill wait is
// gap-money-funding.mjs (FUNDED_BILL_WAIT_MS).
//
// WHAT IS RED (and only this):
//   * a system step is missing after its wait (2, 6, 7, 11, 12, 13);
//   * the card says Funded and no round is funded;
//   * a round is funded and no bank said yes with an amount, unless every yes was marked "does not
//     count" on purpose (the same escape hatch the biller has).
// A customer waiting on a person or on themselves (3, 4, 5, 8, 9, 10) is counted, never red.
//
// ONE RAIL. The ladder is the card-stacking rail (Apply Now, Round Submitted, Approved, Funded). A
// customer whose newest round is on another rail (alt-fin, Lendflow) owes none of 6, 8, 9, 11.
//
// WHAT THIS CANNOT SEE, SAID PLAINLY
//   * A person who owes a step and has no written clock (no code says how long a call may stay
//     unlogged after the booking). Those customers are counted by step, not failed.
//   * Which round is "the" round: the newest one. An older round is read by funding:funded-no-bill.
//   * A deposit paid with no sale row. That is payments:paid-no-entitlement, not this trip.
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no AI call. A failed read is a skip with the reason, never a PASS.

import { confirmedApprovalConditions } from "../../funding/success-fee.mjs";
import { CARD_STACKING, FUNDED_BILL_WAIT_MS, LOOKBACK_MS, roundProblems } from "./gap-money-funding.mjs";
import { PAID_GRACE_MS, SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE } from "./gap-portal.mjs";
import {
  clip, intOf, nowOf, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import {
  BY, DAY_MS, NO_FIX, defaultOrg, judgeTrip, makeNaVerify, realClientSql, skipRow, whoIs
} from "./trip-kit.mjs";

const ID = "trip:funding";
export const CHECK_IDS = Object.freeze([ID]);

export const TRIP_NAME = "funding";
/** The same 60 days the money lanes look back. A trip that started earlier is for a person to clean up. */
export const WINDOW_MS = LOOKBACK_MS;
export const ROW_CAP = 200;

/** Sales stages that mean "the diagnostic is paid or the sale moved on". Lost ends the trip. */
export const SALES_PAID_OR_LATER = Object.freeze(["diagnostic_paid", "decision_rendered", "closed_won", "downsell", "lost"]);
/** The one Funding stage that claims money landed. (Closed also covers a round that never funded.) */
export const FUNDED_CARD_STAGES = Object.freeze(["funded"]);
/** call_outcomes.outcome values that mean the call was held (src/sales/beliefs.mjs OUTCOMES, minus no_show). */
export const HELD_OUTCOMES = Object.freeze(["deposit", "downsell", "callback", "not_a_fit"]);

export const STEPS = Object.freeze([
  Object.freeze({ key: "diagnostic_paid", label: "paid the diagnostic", by: BY.CLIENT }),
  Object.freeze({
    key: "sales_card", label: "Sales card at Diagnostic Paid or later", by: BY.SYSTEM,
    from: "diagnostic_paid", graceMs: PAID_GRACE_MS,
    source: "src/handlers/client-lifecycle.mjs onDiagnosticPaid moves the card in the same call; wait = PAID_GRACE_MS"
  }),
  Object.freeze({ key: "booked", label: "booked a call", by: BY.CLIENT }),
  Object.freeze({ key: "call_held", label: "call held and logged", by: BY.PERSON }),
  Object.freeze({ key: "deposit_paid", label: "paid the funding deposit", by: BY.CLIENT }),
  Object.freeze({
    key: "funding_card", label: "Funding card at Apply Now", by: BY.SYSTEM,
    from: "deposit_paid", graceMs: PAID_GRACE_MS,
    source: "src/handlers/purchase-routing.mjs places the card on the payment event; wait = PAID_GRACE_MS"
  }),
  Object.freeze({
    key: "round_opened", label: "funding round opened", by: BY.SYSTEM,
    from: "funding_card", graceMs: SETTLE_GRACE_MS,
    source: "round.started writes the round (money-chain ensureFundingRound); wait = SETTLE_GRACE_MS"
  }),
  Object.freeze({ key: "submitted", label: "round sent to the banks", by: BY.PERSON }),
  // required: the money chain refuses to fund a card-stacking round with no bank yes that carries an
  // amount (guardFundedAmount, onRoundFundedMoney). A funded round without one went around the guard.
  Object.freeze({ key: "approved", label: "a bank said yes with a dollar amount", by: BY.PERSON, required: true }),
  Object.freeze({ key: "funded", label: "round funded", by: BY.PERSON }),
  Object.freeze({
    key: "closeout", label: "closeout record", by: BY.SYSTEM,
    from: "funded", graceMs: FUNDED_BILL_WAIT_MS,
    source: "onRoundFundedMoney writes it in the same call; wait = FUNDED_BILL_WAIT_MS (30 minutes)"
  }),
  Object.freeze({
    key: "invoice", label: "success-fee bill", by: BY.SYSTEM,
    from: "funded", graceMs: FUNDED_BILL_WAIT_MS,
    source: "F-07 makes the bill from round.funded; wait = FUNDED_BILL_WAIT_MS"
  }),
  Object.freeze({
    key: "commission", label: "staff commission rows", by: BY.SYSTEM,
    from: "funded", graceMs: FUNDED_BILL_WAIT_MS,
    source: "onRoundFundedMoney writes them in the same call; wait = FUNDED_BILL_WAIT_MS"
  })
]);

/**
 * One row per customer who started the trip in the window. $1 org, $2 window start, $3 test-client
 * pattern, $4 the card-stacking product value, $5 the call outcomes that mean the call was held.
 *
 * Every fact is a time, or null. The round block repeats the subselects of FUNDED_ROUNDS_SQL in
 * gap-money-funding.mjs (a test pins the field names to the ones roundProblems reads), but with no
 * "stopped moving" cut, so a round edited a minute ago is not hidden from the trip.
 */
export const TRIP_SQL = `
  /* gap:trip-funding */
  SELECT t.id::text                          AS client_id,
         t.client_code                       AS client_code,
         d.at                                AS diagnostic_paid_at,
         dep.at                              AS deposit_paid_at,
         sc.entered_at                       AS sales_card_at,
         sc.stage                            AS sales_stage,
         bk.at                               AS booked_at,
         oc.at                               AS call_held_at,
         oc.last_outcome                     AS last_outcome,
         fc.entered_at                       AS funding_card_at,
         fc.stage                            AS funding_stage,
         r.id::text                          AS round_id,
         r.round_number                      AS round_number,
         r.status                            AS round_status,
         r.created_at                        AS round_opened_at,
         r.funded_at                         AS funded_at,
         r.card_stacking                     AS card_stacking,
         r.has_closeout                      AS has_closeout,
         r.bills                             AS bills,
         r.linked_sales                      AS linked_sales,
         r.back_end_staff                    AS back_end_staff,
         r.commission_rows                   AS commission_rows,
         r.confirmed_approvals               AS confirmed_approvals,
         r.excluded_approvals                AS excluded_approvals,
         r.fee_percent                       AS fee_percent,
         r.confirmed_at                      AS approved_at,
         sub.at                              AS submitted_at
    FROM (
      SELECT c.id, c.client_code
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
    LEFT JOIN LATERAL (
      SELECT min(q.at) AS at
        FROM (
          SELECT COALESCE(pl.paid_at, pl.updated_at) AS at
            FROM payment_links pl
           WHERE pl.org_id = $1::uuid AND pl.client_id = t.id AND pl.purpose = 'diagnostic'
             AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
             AND COALESCE(pl.is_demo, false) = false
          UNION ALL
          SELECT e.created_at
            FROM events e
           WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'diagnostic.paid'
             AND COALESCE(e.is_demo, false) = false
        ) q
    ) d ON true
    LEFT JOIN LATERAL (
      SELECT min(s.sold_at) AS at
        FROM sales s
        JOIN products pr ON pr.id = s.product_id
       WHERE s.org_id = $1::uuid AND s.client_id = t.id AND s.status = 'active'
         AND COALESCE(s.is_demo, false) = false AND pr.category = 'funding'
    ) dep ON true
    LEFT JOIN LATERAL (
      SELECT cd.entered_at, ps.key AS stage
        FROM cards cd
        JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id AND p.key = 'sales'
        JOIN pipeline_stages ps ON ps.id = cd.stage_id AND ps.pipeline_id = p.id
       WHERE cd.org_id = $1::uuid AND cd.client_id = t.id AND COALESCE(cd.is_demo, false) = false
       ORDER BY cd.updated_at DESC
       LIMIT 1
    ) sc ON true
    LEFT JOIN LATERAL (
      SELECT min(b.created_at) AS at
        FROM bookings b
       WHERE b.org_id = $1::uuid AND b.client_id = t.id
         AND lower(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled')
    ) bk ON true
    LEFT JOIN LATERAL (
      SELECT min(o.logged_at) FILTER (WHERE o.outcome = ANY($5::text[])) AS at,
             (array_agg(o.outcome ORDER BY o.logged_at DESC))[1]       AS last_outcome
        FROM call_outcomes o
       WHERE o.org_id = $1::uuid AND o.client_id = t.id AND COALESCE(o.is_demo, false) = false
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT cd.entered_at, ps.key AS stage
        FROM cards cd
        JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id AND p.key = 'funding_card_stacking'
        JOIN pipeline_stages ps ON ps.id = cd.stage_id AND ps.pipeline_id = p.id
       WHERE cd.org_id = $1::uuid AND cd.client_id = t.id AND COALESCE(cd.is_demo, false) = false
       ORDER BY cd.updated_at DESC
       LIMIT 1
    ) fc ON true
    LEFT JOIN LATERAL (
      SELECT fr.id, fr.round_number, fr.status, fr.created_at,
             CASE WHEN lower(COALESCE(fr.status, '')) IN ('funded', 'closed')
                    AND COALESCE(fr.funded_amount, 0) > 0
                  THEN fr.updated_at END                              AS funded_at,
             (COALESCE(fr.product, '') = $4::text)                    AS card_stacking,
             EXISTS (
               SELECT 1 FROM funding_closeout fc2
                WHERE fc2.funding_round_id = fr.id AND fc2.org_id = fr.org_id
             )                                                        AS has_closeout,
             (SELECT count(*)::int FROM invoices i
               WHERE i.funding_round_id = fr.id AND i.org_id = fr.org_id
                 AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
                 AND i.status NOT IN ('void', 'written_off'))         AS bills,
             (SELECT count(*)::int FROM funding_round_sales frs
               WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS linked_sales,
             (SELECT count(*)::int FROM funding_round_sales frs
                JOIN sale_attributions sa
                  ON sa.sale_id = frs.sale_id AND sa.org_id = frs.org_id AND sa.basis = 'back_end'
               WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS back_end_staff,
             (SELECT count(*)::int FROM commission_ledger l
               WHERE l.funding_round_id = fr.id AND l.org_id = fr.org_id
                 AND l.basis = 'back_end' AND l.reverses_ledger_id IS NULL
                 AND l.status <> 'void')                              AS commission_rows,
             (SELECT count(*)::int FROM applications a
               WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
                 AND ${confirmedApprovalConditions("a")})             AS confirmed_approvals,
             (SELECT count(*)::int FROM applications a
               WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
                 AND a.status = 'Approved' AND a.approval_excluded_at IS NOT NULL) AS excluded_approvals,
             (SELECT s2.agreed_success_fee_percent::float8
                FROM funding_round_sales frs
                JOIN sales s2 ON s2.id = frs.sale_id AND s2.org_id = frs.org_id
               WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id
               LIMIT 1)                                               AS fee_percent,
             (SELECT min(COALESCE(a.status_updated_date, a.updated_at)) FROM applications a
               WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
                 AND ${confirmedApprovalConditions("a")})             AS confirmed_at
        FROM funding_rounds fr
       WHERE fr.org_id = $1::uuid AND fr.client_id = t.id AND COALESCE(fr.is_demo, false) = false
       ORDER BY fr.round_number DESC
       LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT min(e.created_at) AS at
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'round.submitted'
         AND split_part(e.idempotency_key, ':', 1) = 'card_stacking'
         AND split_part(e.idempotency_key, ':', 2) = t.id::text
         AND split_part(e.idempotency_key, ':', 3) = r.round_number::text
         AND COALESCE(e.is_demo, false) = false
    ) sub ON true
   WHERE LEAST(d.at, dep.at, r.created_at) >= $2::timestamptz
   ORDER BY LEAST(d.at, dep.at, r.created_at) ASC
   LIMIT ${ROW_CAP}
`;

/** Pure. One SQL row to one trip row: the facts, the steps that do not apply, and why a trip ended. */
export function toTripRow(r, now = new Date()) {
  const facts = {};
  const notOwed = [];
  const salesStage = r.sales_stage == null ? null : String(r.sales_stage);
  const fundingStage = r.funding_stage == null ? null : String(r.funding_stage);

  if (r.diagnostic_paid_at) facts.diagnostic_paid = r.diagnostic_paid_at;
  if (r.sales_card_at && SALES_PAID_OR_LATER.includes(salesStage)) facts.sales_card = r.sales_card_at;
  if (r.booked_at) facts.booked = r.booked_at;
  if (r.call_held_at) facts.call_held = r.call_held_at;
  if (r.deposit_paid_at) facts.deposit_paid = r.deposit_paid_at;
  if (r.funding_card_at) facts.funding_card = r.funding_card_at;
  if (r.round_opened_at) facts.round_opened = r.round_opened_at;
  if (r.submitted_at) facts.submitted = r.submitted_at;
  if (r.approved_at || intOf(r.confirmed_approvals) > 0) facts.approved = r.approved_at || true;
  if (r.funded_at) facts.funded = r.funded_at;

  const hasRound = !!r.round_id;
  const cardStacking = r.card_stacking === true;
  const onPurpose = cardStacking && intOf(r.confirmed_approvals) === 0 && intOf(r.excluded_approvals) > 0;

  // The card says Funded and no round is funded. It needs the same 30 minutes the money chain gets.
  const cardAt = r.funding_card_at ? new Date(r.funding_card_at) : null;
  if (FUNDED_CARD_STAGES.includes(fundingStage) && !r.funded_at && cardAt
      && now.getTime() - cardAt.getTime() > FUNDED_BILL_WAIT_MS) {
    facts["funded:claim"] = true;
  }

  // Steps this customer does not owe.
  if (hasRound && !cardStacking) notOwed.push("funding_card", "submitted", "approved", "closeout");
  if (onPurpose) notOwed.push("approved", "closeout", "invoice");
  if (r.funded_at) {
    const problems = roundProblems({
      card_stacking: cardStacking,
      has_closeout: r.has_closeout === true,
      bills: r.bills,
      linked_sales: r.linked_sales,
      fee_percent: r.fee_percent,
      back_end_staff: r.back_end_staff,
      commission_rows: r.commission_rows,
      confirmed_approvals: r.confirmed_approvals,
      excluded_approvals: r.excluded_approvals
    });
    const missing = (head) => problems.some((p) => p.startsWith(head));
    if (cardStacking && !onPurpose && !missing("no closeout record")) facts.closeout = r.funded_at;
    if (!onPurpose && !missing("no success-fee bill")) facts.invoice = r.funded_at;
    if (intOf(r.back_end_staff) === 0) notOwed.push("commission");
    else if (!missing("no staff commission rows")) facts.commission = r.funded_at;
  } else {
    if (intOf(r.back_end_staff) === 0) notOwed.push("commission");
  }

  let ended = null;
  const deposited = !!r.deposit_paid_at;
  const last = r.last_outcome == null ? null : String(r.last_outcome);
  if (!deposited && !hasRound) {
    if (salesStage === "lost") ended = { why: "the Sales card is on Lost" };
    else if (last === "not_a_fit") ended = { why: "the call outcome says not a fit" };
    else if (last === "downsell") ended = { why: "the call outcome says downsell (the buyer took the cheaper product)" };
  }

  return { who: whoIs(r), facts, notOwed: [...new Set(notOwed)], ended, stall: null };
}

/** Pure. The verdict for the rows the SELECT returned. */
export function judgeFunding({ rows = [], now = new Date() } = {}) {
  return judgeTrip({
    id: ID,
    tripName: TRIP_NAME,
    steps: STEPS,
    rows: rows.map((r) => toTripRow(r, now)),
    now,
    windowDays: Math.round(WINDOW_MS / DAY_MS),
    cap: ROW_CAP,
    fix:
      "Open the client's file and read the step named. A missing card, round, closeout, bill or commission row means the handler behind it did not run: " +
      "read failed_events and the funding workflow runs for that client. " + NO_FIX
  });
}

async function startedCount(run, orgId, now) {
  const out = await run((tx) => tx.query(TRIP_SQL, tripParams(orgId, now)));
  return Array.isArray(out && out.rows) ? out.rows.length : 0;
}

export function tripParams(orgId, now) {
  return [
    orgId,
    new Date(now.getTime() - WINDOW_MS).toISOString(),
    INTERNAL_CLIENT_EMAIL_RE,
    CARD_STACKING,
    HELD_OUTCOMES
  ];
}

export const naVerify = makeNaVerify({ id: ID, countStarted: startedCount, runnerOf, nowOf, defaultOrg });

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip"|"na", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the funding trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the funding trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeFunding({ rows: got.rows, now })];
  } catch (err) {
    return [skipRow(ID, `could not judge the funding trips: ${clip(err)}`)];
  }
}
