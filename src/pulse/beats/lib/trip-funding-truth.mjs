import {
  BY, DAY_MS, NO_FIX, intOf, judgeTrip, realClientSql, whoIs
} from "./trip-truth-kit.mjs";

const ID = "trip:funding";
export const CHECK_IDS = Object.freeze([ID]);
export const TRIP_NAME = "funding";
export const WINDOW_MS = 60 * DAY_MS;
export const ROW_CAP = 200;
export const CARD_STACKING = "card_stacking";
export const FUNDED_BILL_WAIT_MS = 30 * 60 * 1000;
export const PAID_GRACE_MS = 60 * 60 * 1000;
export const SETTLE_GRACE_MS = 15 * 60 * 1000;
export const INTERNAL_CLIENT_EMAIL_RE = String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(test|e2e)\+|\+test[._-]|@fundhub\.ai$`;

export const SALES_PAID_OR_LATER = Object.freeze(["diagnostic_paid", "decision_rendered", "closed_won", "downsell", "lost"]);
export const FUNDED_CARD_STAGES = Object.freeze(["funded"]);
export const HELD_OUTCOMES = Object.freeze(["deposit", "downsell", "callback", "not_a_fit"]);
export const STEPS = Object.freeze([
  Object.freeze({ key: "diagnostic_paid", label: "paid the diagnostic", by: BY.CLIENT }),
  Object.freeze({ key: "sales_card", label: "Sales card at Diagnostic Paid or later", by: BY.SYSTEM, from: "diagnostic_paid", graceMs: PAID_GRACE_MS, source: "src/handlers/client-lifecycle.mjs onDiagnosticPaid moves the card in the same call; wait = PAID_GRACE_MS" }),
  Object.freeze({ key: "booked", label: "booked a call", by: BY.CLIENT }),
  Object.freeze({ key: "call_held", label: "call held and logged", by: BY.PERSON }),
  Object.freeze({ key: "deposit_paid", label: "paid the funding deposit", by: BY.CLIENT }),
  Object.freeze({ key: "funding_card", label: "Funding card at Apply Now", by: BY.SYSTEM, from: "deposit_paid", graceMs: PAID_GRACE_MS, source: "src/handlers/purchase-routing.mjs places the card on the payment event; wait = PAID_GRACE_MS" }),
  Object.freeze({ key: "round_opened", label: "funding round opened", by: BY.SYSTEM, from: "funding_card", graceMs: SETTLE_GRACE_MS, source: "round.started writes the round (money-chain ensureFundingRound); wait = SETTLE_GRACE_MS" }),
  Object.freeze({ key: "submitted", label: "round sent to the banks", by: BY.PERSON }),
  Object.freeze({ key: "approved", label: "a bank said yes with a dollar amount", by: BY.PERSON, required: true }),
  Object.freeze({ key: "funded", label: "round funded", by: BY.PERSON }),
  Object.freeze({ key: "closeout", label: "closeout record", by: BY.SYSTEM, from: "funded", graceMs: FUNDED_BILL_WAIT_MS, source: "onRoundFundedMoney writes it in the same call; wait = FUNDED_BILL_WAIT_MS (30 minutes)" }),
  Object.freeze({ key: "invoice", label: "success-fee bill", by: BY.SYSTEM, from: "funded", graceMs: FUNDED_BILL_WAIT_MS, source: "F-07 makes the bill from round.funded; wait = FUNDED_BILL_WAIT_MS" }),
  Object.freeze({ key: "commission", label: "staff commission rows", by: BY.SYSTEM, from: "funded", graceMs: FUNDED_BILL_WAIT_MS, source: "onRoundFundedMoney writes them in the same call; wait = FUNDED_BILL_WAIT_MS" })
]);

const DIAG_LATERAL = `
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
    ) d ON true`;
const DEP_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT min(s.sold_at) AS at
        FROM sales s
        JOIN products pr ON pr.id = s.product_id
       WHERE s.org_id = $1::uuid AND s.client_id = t.id AND s.status = 'active'
         AND COALESCE(s.is_demo, false) = false AND pr.category = 'funding'
    ) dep ON true`;
const APPROVAL = `a.status = 'Approved'
   AND a.approval_excluded_at IS NULL
   AND a.approved_amount IS NOT NULL
   AND a.approved_amount > 0`;

export const TRIP_SQL = `
  /* gap:trip-funding */
  SELECT t.id::text AS client_id, t.client_code AS client_code, d.at AS diagnostic_paid_at,
         dep.at AS deposit_paid_at, sc.entered_at AS sales_card_at, sc.stage AS sales_stage,
         bk.at AS booked_at, oc.at AS call_held_at, oc.last_outcome AS last_outcome,
         fc.entered_at AS funding_card_at, fc.stage AS funding_stage, r.id::text AS round_id,
         r.round_number, r.status AS round_status, r.created_at AS round_opened_at,
         r.funded_at, r.card_stacking, r.has_closeout, r.bills, r.linked_sales,
         r.back_end_staff, r.commission_rows, r.confirmed_approvals, r.excluded_approvals,
         r.fee_percent, r.confirmed_at AS approved_at, sub.at AS submitted_at
    FROM (
      SELECT c.id, c.client_code FROM clients c
       WHERE c.org_id = $1::uuid AND ${realClientSql("c", "$3")}
    ) t
${DIAG_LATERAL}
${DEP_LATERAL}
    LEFT JOIN LATERAL (
      SELECT cd.entered_at, ps.key AS stage FROM cards cd
        JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id AND p.key = 'sales'
        JOIN pipeline_stages ps ON ps.id = cd.stage_id AND ps.pipeline_id = p.id
       WHERE cd.org_id = $1::uuid AND cd.client_id = t.id AND COALESCE(cd.is_demo, false) = false
       ORDER BY cd.updated_at DESC LIMIT 1
    ) sc ON true
    LEFT JOIN LATERAL (
      SELECT min(b.created_at) AS at FROM bookings b
       WHERE b.org_id = $1::uuid AND b.client_id = t.id
         AND lower(COALESCE(b.status, '')) NOT IN ('cancelled', 'canceled')
    ) bk ON true
    LEFT JOIN LATERAL (
      SELECT min(o.logged_at) FILTER (WHERE o.outcome = ANY($5::text[])) AS at,
             (array_agg(o.outcome ORDER BY o.logged_at DESC))[1] AS last_outcome
        FROM call_outcomes o
       WHERE o.org_id = $1::uuid AND o.client_id = t.id AND COALESCE(o.is_demo, false) = false
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT cd.entered_at, ps.key AS stage FROM cards cd
        JOIN pipelines p ON p.id = cd.pipeline_id AND p.org_id = cd.org_id AND p.key = 'funding_card_stacking'
        JOIN pipeline_stages ps ON ps.id = cd.stage_id AND ps.pipeline_id = p.id
       WHERE cd.org_id = $1::uuid AND cd.client_id = t.id AND COALESCE(cd.is_demo, false) = false
       ORDER BY cd.updated_at DESC LIMIT 1
    ) fc ON true
    LEFT JOIN LATERAL (
      SELECT fr.id, fr.round_number, fr.status, fr.created_at,
             CASE WHEN lower(COALESCE(fr.status, '')) IN ('funded', 'closed') AND COALESCE(fr.funded_amount, 0) > 0 THEN fr.updated_at END AS funded_at,
             (COALESCE(fr.product, '') = $4::text) AS card_stacking,
             EXISTS (SELECT 1 FROM funding_closeout fc2 WHERE fc2.funding_round_id = fr.id AND fc2.org_id = fr.org_id) AS has_closeout,
             (SELECT count(*)::int FROM invoices i WHERE i.funding_round_id = fr.id AND i.org_id = fr.org_id AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee') AND i.status NOT IN ('void', 'written_off')) AS bills,
             (SELECT count(*)::int FROM funding_round_sales frs WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS linked_sales,
             (SELECT count(*)::int FROM funding_round_sales frs JOIN sale_attributions sa ON sa.sale_id = frs.sale_id AND sa.org_id = frs.org_id AND sa.basis = 'back_end' WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS back_end_staff,
             (SELECT count(*)::int FROM commission_ledger l WHERE l.funding_round_id = fr.id AND l.org_id = fr.org_id AND l.basis = 'back_end' AND l.reverses_ledger_id IS NULL AND l.status <> 'void') AS commission_rows,
             (SELECT count(*)::int FROM applications a WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id AND ${APPROVAL}) AS confirmed_approvals,
             (SELECT count(*)::int FROM applications a WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id AND a.status = 'Approved' AND a.approval_excluded_at IS NOT NULL) AS excluded_approvals,
             (SELECT s2.agreed_success_fee_percent::float8 FROM funding_round_sales frs JOIN sales s2 ON s2.id = frs.sale_id AND s2.org_id = frs.org_id WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id LIMIT 1) AS fee_percent,
             (SELECT min(COALESCE(a.status_updated_date, a.updated_at)) FROM applications a WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id AND ${APPROVAL}) AS confirmed_at
        FROM funding_rounds fr
       WHERE fr.org_id = $1::uuid AND fr.client_id = t.id AND COALESCE(fr.is_demo, false) = false
       ORDER BY fr.round_number DESC LIMIT 1
    ) r ON true
    LEFT JOIN LATERAL (
      SELECT min(e.created_at) AS at FROM events e
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

function roundProblems(value) {
  const out = [];
  const cardStacking = value.card_stacking === true;
  const billsNothing = cardStacking && intOf(value.confirmed_approvals) === 0 && intOf(value.excluded_approvals) > 0;
  if (cardStacking && value.has_closeout !== true && !billsNothing) out.push("no closeout record");
  if (intOf(value.bills) === 0 && !billsNothing) {
    let why;
    if (cardStacking && intOf(value.confirmed_approvals) === 0) why = "no bank yes with a dollar amount is on the round";
    else if (intOf(value.linked_sales) === 0) why = "the round is linked to no sale, so no fee percent";
    else if (!(intOf(value.fee_percent) > 0 && intOf(value.fee_percent) <= 100)) why = "the sale agreed no success-fee percent";
    else why = "the bill workflow F-07 did not make one";
    out.push(`no success-fee bill (${why})`);
  }
  if (intOf(value.back_end_staff) > 0 && intOf(value.commission_rows) === 0) out.push("no staff commission rows");
  return out;
}

export function toTripRow(value, now = new Date()) {
  const facts = {};
  const notOwed = [];
  const salesStage = value.sales_stage == null ? null : String(value.sales_stage);
  const fundingStage = value.funding_stage == null ? null : String(value.funding_stage);
  if (value.diagnostic_paid_at) facts.diagnostic_paid = value.diagnostic_paid_at;
  if (value.sales_card_at && SALES_PAID_OR_LATER.includes(salesStage)) facts.sales_card = value.sales_card_at;
  if (value.booked_at) facts.booked = value.booked_at;
  if (value.call_held_at) facts.call_held = value.call_held_at;
  if (value.deposit_paid_at) facts.deposit_paid = value.deposit_paid_at;
  if (value.funding_card_at) facts.funding_card = value.funding_card_at;
  if (value.round_opened_at) facts.round_opened = value.round_opened_at;
  if (value.submitted_at) facts.submitted = value.submitted_at;
  if (value.approved_at || intOf(value.confirmed_approvals) > 0) facts.approved = value.approved_at || true;
  if (value.funded_at) facts.funded = value.funded_at;
  const hasRound = !!value.round_id;
  const cardStacking = value.card_stacking === true;
  const onPurpose = cardStacking && intOf(value.confirmed_approvals) === 0 && intOf(value.excluded_approvals) > 0;
  const cardAt = value.funding_card_at ? new Date(value.funding_card_at) : null;
  if (FUNDED_CARD_STAGES.includes(fundingStage) && !value.funded_at && cardAt && now.getTime() - cardAt.getTime() > FUNDED_BILL_WAIT_MS) facts["funded:claim"] = true;
  if (hasRound && !cardStacking) notOwed.push("funding_card", "submitted", "approved", "closeout");
  if (onPurpose) notOwed.push("approved", "closeout", "invoice");
  if (value.funded_at) {
    const problems = roundProblems(value);
    const missing = (head) => problems.some((problem) => problem.startsWith(head));
    if (cardStacking && !onPurpose && !missing("no closeout record")) facts.closeout = value.funded_at;
    if (!onPurpose && !missing("no success-fee bill")) facts.invoice = value.funded_at;
    if (intOf(value.back_end_staff) === 0) notOwed.push("commission");
    else if (!missing("no staff commission rows")) facts.commission = value.funded_at;
  } else if (intOf(value.back_end_staff) === 0) notOwed.push("commission");
  let ended = null;
  if (!value.deposit_paid_at && !hasRound) {
    const last = value.last_outcome == null ? null : String(value.last_outcome);
    if (salesStage === "lost") ended = { why: "the Sales card is on Lost" };
    else if (last === "not_a_fit") ended = { why: "the call outcome says not a fit" };
    else if (last === "downsell") ended = { why: "the call outcome says downsell (the buyer took the cheaper product)" };
  }
  return { who: whoIs(value), facts, notOwed: [...new Set(notOwed)], ended, stall: null };
}

export function judgeFunding({ rows = [], now = new Date() } = {}) {
  return judgeTrip({
    id: ID, tripName: TRIP_NAME, steps: STEPS, rows: rows.map((value) => toTripRow(value, now)), now,
    windowDays: Math.round(WINDOW_MS / DAY_MS), cap: ROW_CAP,
    fix: "Open the client's file and read the step named. A missing card, round, closeout, bill or commission row means the handler behind it did not run: read failed_events and the funding workflow runs for that client. " + NO_FIX
  });
}

export function tripParams(orgId, now) {
  return [orgId, new Date(now.getTime() - WINDOW_MS).toISOString(), INTERNAL_CLIENT_EMAIL_RE, CARD_STACKING, HELD_OUTCOMES];
}
