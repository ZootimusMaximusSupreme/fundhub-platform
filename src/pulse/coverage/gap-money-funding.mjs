// Money A for the morning pulse: funding, fees and payouts. Report only. Read only.
//
// Six yes-or-no questions a paying customer or a paid person would feel:
//
//   funding:funded-no-bill      Did every funded round get its closeout, its success-fee bill
//                               and its staff commission rows?
//   funding:approved-no-amount  Is any bank yes missing its dollar amount (so it can never be billed)?
//   partners:payout-held        Is an affiliate or partner payout stuck on hold? Why?
//   commissions:ledger          Is approved commission left unpaid, does a row name a rule that was not
//                               in force, or does one pay scope have two open rate versions?
//   commissions:slo-map         Does every product sold through ClickFunnels have an active map and a
//                               commission rule?
//   books:sample-rows           Did the dashboard "sample client" tool leave fake money in the live books?
//
// BOARD: ops/workflows/coverage-every-surface-2026-10-10.md, workflow W1. Gaps ranked there:
// Money 1 (funded with no bill), 3 (affiliate payouts), 5 (staff commissions), 11 (sample data), 14
// (approved amounts).
//
// READ ONLY. Every statement below is one SELECT. ctx.db is a shared pool: this file never sends
// BEGIN, COMMIT, ROLLBACK or SET, never writes, and makes no web call, no text, no email and no model
// call. No repo file is read at run time.
//
// HONEST STATUS. A read that fails is a skip with the reason, never a PASS.
//
// THE REAL TIMING OF THE MONEY CHAIN, read from the code (2026-10-10):
//   * onRoundFundedMoney (src/handlers/money-chain.mjs) writes the funded round, the staff commission
//     rows and the closeout row inside the SAME call. There is no timer between them.
//   * F-07 (src/workflows/f-07-funding-locked.mjs) makes the success-fee bill from the same
//     round.funded event. It has no sleep. The only wait is the workflow engine picking the event up
//     and retrying a failed step.
//   So there is no designed delay to wait out. The pulse already gives any workflow that does not sleep
//   30 minutes to finish (OPEN_LIMIT_MS in src/pulse/workflow-runs.mjs). This lane uses that same number.
//
// WHAT IS A PULSE CHOICE, NOT AN OWNER RULE (each one is a named constant below):
//   * LOOKBACK: 60 days. An older break is for a person to clean up by hand, not a morning alarm.
//   * APPROVED_UNPAID_AFTER: 35 days. No staff pay date is modelled anywhere
//     (src/commissions/commission-model-open-questions.md, section 13). The only payout rhythm in the
//     code is the monthly affiliate run, so one month plus 5 days reads as stuck.

import { confirmedApprovalConditions, unpricedApprovalConditions } from "../../funding/success-fee.mjs";
import { OPEN_LIMIT_MS } from "../workflow-runs.mjs";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const CHECK_IDS = Object.freeze([
  "funding:funded-no-bill",
  "funding:approved-no-amount",
  "partners:payout-held",
  "commissions:ledger",
  "commissions:slo-map",
  "books:sample-rows"
]);

/** Same value as PRODUCT in src/funding/card-stacking-rounds.mjs (a test pins the two equal). */
export const CARD_STACKING = "card_stacking";

/** The Funded stage of the card-stacking board. */
export const CARD_BOARD_KEY = "funding_card_stacking";
export const FUNDED_STAGE_KEY = "funded";

/** F-07 does not sleep, so it has the pulse's own limit for a workflow with no sleep. */
export const FUNDED_BILL_WAIT_MS = OPEN_LIMIT_MS;
/** A bank yes this young may still be getting its number typed in. */
export const APPROVED_NO_AMOUNT_AFTER_MS = DAY_MS;
/** A payout run is written held on purpose when a stamp is missing. One day gives a person time to act. */
export const PAYOUT_HELD_AFTER_MS = DAY_MS;
/** Approved and still not marked paid after this long reads as stuck. No staff pay date is modelled. */
export const APPROVED_UNPAID_AFTER_MS = 35 * DAY_MS;
/** How far back a funded round, a funded card, a bank yes or a sold product is read. */
export const LOOKBACK_MS = 60 * DAY_MS;

/** What api/dashboard/seed.mjs writes. A client email, and two payment refs. */
export const SEED_CLIENT_EMAIL_RE = "^sample\\+[0-9]+@fundhub\\.demo$";
export const SEED_PAYMENT_REF_RE = "^seed_(t32|tdep)_[0-9]+$";

/** The two marks src/slo/purchase.mjs puts on every ClickFunnels sale it records. */
export const SLO_SALE_NOTE = "source:slo.clickfunnels";
export const SLO_SALE_REF_LIKE = "clickfunnels:order:%";

/** How many names a detail line spells out before it says "and N more". */
const SHOWN = 3;

/* ──────────────────────────── SQL (one SELECT each) ──────────────────────────── */

/* Funded rounds with the facts the money chain should have left behind.
   $1 org, $2 only rounds that stopped moving before this, $3 only rounds that moved after this,
   $4 the card-stacking product value.
   The bill is the success-fee invoice F-07 raises (the same two marks billed-fee-check.mjs reads).
   Commission rows are the BACK END rows for the round. They are only owed when the sale the round is
   linked to has a back end attribution, so a self-serve round with nobody to pay is not a break. */
export const FUNDED_ROUNDS_SQL = `
  /* gap:money-funded-rounds */
  SELECT fr.id::text                               AS round_id,
         fr.client_id::text                        AS client_id,
         c.client_code                             AS client_code,
         fr.round_number::int                      AS round_number,
         (COALESCE(fr.product, '') = $4::text)     AS card_stacking,
         EXISTS (
           SELECT 1 FROM funding_closeout fc
            WHERE fc.funding_round_id = fr.id AND fc.org_id = fr.org_id
         )                                         AS has_closeout,
         (SELECT count(*)::int FROM invoices i
           WHERE i.funding_round_id = fr.id AND i.org_id = fr.org_id
             AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
             AND i.status NOT IN ('void', 'written_off'))   AS bills,
         (SELECT count(*)::int FROM funding_round_sales frs
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id) AS linked_sales,
         (SELECT count(*)::int FROM funding_round_sales frs
            JOIN sale_attributions sa
              ON sa.sale_id = frs.sale_id AND sa.org_id = frs.org_id AND sa.basis = 'back_end'
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id)  AS back_end_staff,
         (SELECT count(*)::int FROM commission_ledger l
           WHERE l.funding_round_id = fr.id AND l.org_id = fr.org_id
             AND l.basis = 'back_end' AND l.reverses_ledger_id IS NULL
             AND l.status <> 'void')               AS commission_rows,
         (SELECT count(*)::int FROM applications a
           WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
             AND ${confirmedApprovalConditions("a")})  AS confirmed_approvals,
         (SELECT count(*)::int FROM applications a
           WHERE a.funding_round_id = fr.id AND a.org_id = fr.org_id
             AND a.status = 'Approved' AND a.approval_excluded_at IS NOT NULL) AS excluded_approvals,
         (SELECT s.agreed_success_fee_percent::float8
            FROM funding_round_sales frs
            JOIN sales s ON s.id = frs.sale_id AND s.org_id = frs.org_id
           WHERE frs.funding_round_id = fr.id AND frs.org_id = fr.org_id
           LIMIT 1)                                AS fee_percent,
         count(*) OVER ()::int                     AS total
    FROM funding_rounds fr
    JOIN clients c ON c.id = fr.client_id AND c.org_id = fr.org_id
   WHERE fr.org_id = $1::uuid
     AND lower(fr.status) IN ('funded', 'closed')
     AND COALESCE(fr.funded_amount, 0) > 0
     AND COALESCE(fr.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND fr.updated_at < $2::timestamptz
     AND fr.updated_at >= $3::timestamptz
   ORDER BY fr.updated_at ASC
   LIMIT 100
`;

/* Cards sitting in Funded on the card-stacking board whose client has no funded round at all.
   The move to Funded is supposed to fire round.funded. A card here with no funded round means the
   money chain never ran, so there is no closeout, no bill and no commission.
   $1 org, $2 only cards that entered before this, $3 only cards that entered after this. */
export const FUNDED_CARDS_SQL = `
  /* gap:money-funded-cards */
  SELECT c.id::text                                AS card_id,
         c.client_id::text                         AS client_id,
         cl.client_code                            AS client_code,
         COALESCE(c.entered_at, c.updated_at)      AS entered_at,
         count(*) OVER ()::int                     AS total
    FROM cards c
    JOIN pipelines p
      ON p.id = c.pipeline_id AND p.org_id = c.org_id AND p.key = '${CARD_BOARD_KEY}'
    JOIN pipeline_stages ps
      ON ps.id = c.stage_id AND ps.pipeline_id = p.id AND ps.key = '${FUNDED_STAGE_KEY}'
    JOIN clients cl ON cl.id = c.client_id AND cl.org_id = c.org_id
   WHERE c.org_id = $1::uuid
     AND COALESCE(c.is_demo, false) = false
     AND COALESCE(cl.is_demo, false) = false
     AND COALESCE(c.entered_at, c.updated_at) < $2::timestamptz
     AND COALESCE(c.entered_at, c.updated_at) >= $3::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM funding_rounds fr
        WHERE fr.client_id = c.client_id AND fr.org_id = c.org_id
          AND lower(fr.status) IN ('funded', 'closed')
          AND COALESCE(fr.funded_amount, 0) > 0
     )
   ORDER BY COALESCE(c.entered_at, c.updated_at) ASC
   LIMIT 100
`;

/* Bank yes answers with no dollar amount. The test for "no usable amount" is the one the biller and the
   board already share (unpricedApprovalConditions in src/funding/success-fee.mjs), so this can never
   drift from what the invoice would skip.
   $1 org, $2 only answers recorded before this, $3 only answers recorded after this. */
export const APPROVED_NO_AMOUNT_SQL = `
  /* gap:money-approved-no-amount */
  SELECT a.id::text                                AS application_id,
         COALESCE(NULLIF(btrim(a.lender_name), ''), NULLIF(btrim(a.bank), ''), 'Unnamed bank') AS bank,
         c.client_code                             AS client_code,
         COALESCE(a.status_updated_date, a.updated_at, a.created_at) AS since,
         count(*) OVER ()::int                     AS total
    FROM applications a
    LEFT JOIN funding_rounds fr ON fr.id = a.funding_round_id AND fr.org_id = a.org_id
    LEFT JOIN clients c ON c.id = COALESCE(a.client_id, fr.client_id) AND c.org_id = a.org_id
   WHERE a.org_id = $1::uuid
     AND COALESCE(a.is_demo, false) = false
     AND COALESCE(fr.is_demo, false) = false
     AND COALESCE(c.is_demo, false) = false
     AND ${unpricedApprovalConditions("a")}
     AND COALESCE(a.status_updated_date, a.updated_at, a.created_at) < $2::timestamptz
     AND COALESCE(a.status_updated_date, a.updated_at, a.created_at) >= $3::timestamptz
   ORDER BY COALESCE(a.status_updated_date, a.updated_at, a.created_at) ASC
   LIMIT 100
`;

/* Payouts the run wrote as held, for an affiliate and for a partner. The affiliate run holds on two
   stamps (src/affiliates/payouts.mjs): affiliates.partner_license_signed_at and affiliates.tax_form_received_at.
   A partner payout holds on the partner agreement (partners.agreement_signed_at).
   $1 org, $2 only payouts written before this. */
export const HELD_PAYOUTS_SQL = `
  /* gap:money-payout-held */
  SELECT q.kind, q.payout_id, q.who, q.amount, q.hold_reason, q.created_at,
         q.license_missing, q.tax_missing,
         count(*) OVER ()::int AS total
    FROM (
      SELECT 'affiliate'::text                     AS kind,
             p.id::text                            AS payout_id,
             a.name                                AS who,
             p.amount::float8                      AS amount,
             p.hold_reason                         AS hold_reason,
             p.created_at                          AS created_at,
             (a.partner_license_signed_at IS NULL) AS license_missing,
             (a.tax_form_received_at IS NULL)      AS tax_missing
        FROM affiliate_payouts p
        JOIN affiliates a ON a.id = p.affiliate_id AND a.org_id = p.org_id
       WHERE p.org_id = $1::uuid
         AND p.status = 'held'
         AND COALESCE(a.is_demo, false) = false
         AND p.created_at < $2::timestamptz
      UNION ALL
      SELECT 'partner'::text,
             p.id::text,
             pt.name,
             p.amount::float8,
             p.hold_reason,
             p.created_at,
             (pt.agreement_signed_at IS NULL),
             false
        FROM partner_payouts p
        JOIN partners pt ON pt.id = p.partner_id AND pt.org_id = p.org_id
       WHERE p.org_id = $1::uuid
         AND p.status = 'held'
         AND COALESCE(pt.is_demo, false) = false
         AND p.created_at < $2::timestamptz
    ) q
   ORDER BY q.created_at ASC
   LIMIT 50
`;

/* Commission approved by a person and never marked paid. $1 org, $2 approved before this. */
export const APPROVED_UNPAID_SQL = `
  /* gap:commissions-approved-unpaid */
  SELECT count(*)::int                             AS n,
         COALESCE(sum(l.amount), 0)::float8        AS dollars,
         min(l.approved_at)                        AS oldest
    FROM commission_ledger l
   WHERE l.org_id = $1::uuid
     AND l.status = 'approved'
     AND l.paid_at IS NULL
     AND COALESCE(l.is_demo, false) = false
     AND l.approved_at < $2::timestamptz
`;

/* Earned or approved rows that do not name a rule version that was in force on the day of the sale.
   The calculator picks the rate as of the sale date (money-chain.mjs: asOf = sale.sold_at), so a row
   whose rule did not exist, was a different basis, or was not open on that day was not made by it.
   A reversal row (it points at the row it reverses) is left out. Paid history is left out: it is frozen.
   $1 org. */
export const LEDGER_RULE_SQL = `
  /* gap:commissions-ledger-rule */
  SELECT count(*)::int                                              AS read_rows,
         count(*) FILTER (WHERE l.rule_id IS NULL)::int             AS no_rule,
         count(*) FILTER (
           WHERE l.rule_id IS NOT NULL
             AND (
               r.id IS NULL
               OR r.org_id <> l.org_id
               OR r.basis <> l.basis
               OR r.effective_from > COALESCE(s.sold_at, l.earned_at)
               OR (r.effective_to IS NOT NULL AND r.effective_to <= COALESCE(s.sold_at, l.earned_at))
             )
         )::int                                                     AS wrong_version
    FROM commission_ledger l
    LEFT JOIN commission_rules r ON r.id = l.rule_id
    LEFT JOIN sales s ON s.id = l.sale_id AND s.org_id = l.org_id
   WHERE l.org_id = $1::uuid
     AND l.status IN ('earned', 'approved')
     AND l.reverses_ledger_id IS NULL
     AND COALESCE(l.is_demo, false) = false
`;

/* Pay scopes with more than one OPEN base rate version. The database refuses this today
   (commission_rules_no_overlap, db/migrations/013 and later). This reads it anyway, so a migration that
   weakens that rule turns the morning red. Bonus rules stack on purpose and are left out.
   $1 org. */
export const OPEN_VERSIONS_SQL = `
  /* gap:commissions-open-versions */
  SELECT count(*)::int AS scopes
    FROM (
      SELECT 1
        FROM commission_rules r
       WHERE r.org_id = $1::uuid
         AND r.active
         AND r.stacking = 'base'
         AND r.effective_to IS NULL
       GROUP BY r.basis,
                COALESCE(r.product_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(lower(r.role), '*'),
                COALESCE(r.staff_id, '00000000-0000-0000-0000-000000000000'::uuid),
                COALESCE(r.sale_motion, '*')
      HAVING count(*) > 1
    ) q
`;

/* Products sold through ClickFunnels, with the two things each one needs.
   $1 org, $2 now, $3 only sales after this.
   mapped: an ACTIVE slo_connections row sends a paid order for this product to it.
   ruled:  a front end commission rule that is open now and covers this product (its own, or all products)
           and this sale motion. A rule that names a role or a person still counts. */
export const SLO_PRODUCTS_SQL = `
  /* gap:commissions-slo-map */
  SELECT s.product_id::text                        AS product_id,
         COALESCE(p.code, p.name, s.product_id::text) AS product,
         count(DISTINCT s.id)::int                 AS sales,
         EXISTS (
           SELECT 1 FROM slo_connections sc
            WHERE sc.org_id = s.org_id AND sc.product_id = s.product_id AND sc.active
         )                                         AS mapped,
         EXISTS (
           SELECT 1 FROM commission_rules r
            WHERE r.org_id = s.org_id
              AND r.basis = 'front_end'
              AND r.active
              AND r.effective_from <= $2::timestamptz
              AND (r.effective_to IS NULL OR r.effective_to > $2::timestamptz)
              AND (r.product_id IS NULL OR r.product_id = s.product_id)
              AND (r.sale_motion IS NULL OR r.sale_motion = s.sale_motion)
         )                                         AS ruled
    FROM sales s
    LEFT JOIN products p ON p.id = s.product_id AND p.org_id = s.org_id
   WHERE s.org_id = $1::uuid
     AND s.status = 'active'
     AND COALESCE(s.is_demo, false) = false
     AND s.sold_at >= $3::timestamptz
     AND (s.notes = '${SLO_SALE_NOTE}' OR s.external_ref LIKE '${SLO_SALE_REF_LIKE}')
   GROUP BY s.org_id, s.product_id, s.sale_motion, p.code, p.name
   ORDER BY count(DISTINCT s.id) DESC
   LIMIT 50
`;

/* What api/dashboard/seed.mjs leaves behind. A sample client is a client with a sample@fundhub.demo
   address, or one that owns a seed payment. Everything else hangs off the client or the payment ref.
   A row someone has already flagged is_demo is out of the live totals, so it is not counted.
   $1 org, $2 the seed client email pattern, $3 the seed payment ref pattern. */
export const SAMPLE_ROWS_SQL = `
  /* gap:books-sample-rows */
  WITH sample_clients AS (
    SELECT c.id
      FROM clients c
     WHERE c.org_id = $1::uuid
       AND COALESCE(c.is_demo, false) = false
       AND lower(c.email) ~ $2::text
    UNION
    SELECT t.client_id
      FROM transactions t
     WHERE t.org_id = $1::uuid
       AND COALESCE(t.is_demo, false) = false
       AND t.client_id IS NOT NULL
       AND t.provider_ref ~ $3::text
  )
  SELECT (SELECT count(*)::int FROM sample_clients)                          AS clients,
         (SELECT count(*)::int FROM transactions t
           WHERE t.org_id = $1::uuid AND COALESCE(t.is_demo, false) = false
             AND t.provider_ref ~ $3::text)                                  AS payments,
         (SELECT COALESCE(sum(t.amount_paid), 0)::float8 FROM transactions t
           WHERE t.org_id = $1::uuid AND COALESCE(t.is_demo, false) = false
             AND t.provider_ref ~ $3::text)                                  AS payment_dollars,
         (SELECT count(*)::int FROM sales s
           WHERE s.org_id = $1::uuid AND COALESCE(s.is_demo, false) = false
             AND (s.client_id IN (SELECT id FROM sample_clients) OR s.external_ref ~ $3::text)) AS sales,
         (SELECT COALESCE(sum(s.agreed_price), 0)::float8 FROM sales s
           WHERE s.org_id = $1::uuid AND COALESCE(s.is_demo, false) = false
             AND (s.client_id IN (SELECT id FROM sample_clients) OR s.external_ref ~ $3::text)) AS sale_dollars,
         (SELECT count(*)::int FROM commission_ledger l
           WHERE l.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false
             AND l.client_id IN (SELECT id FROM sample_clients))             AS commission_rows,
         (SELECT count(*)::int FROM invoices i
           WHERE i.org_id = $1::uuid AND COALESCE(i.is_demo, false) = false
             AND i.client_id IN (SELECT id FROM sample_clients))             AS invoices,
         (SELECT count(*)::int FROM messages m
           WHERE m.org_id = $1::uuid AND COALESCE(m.is_demo, false) = false
             AND m.client_id IN (SELECT id FROM sample_clients))             AS messages
`;

/* ──────────────────────────── small helpers ──────────────────────────── */

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function clip(err) {
  return String((err && err.message) || err).replace(/\s+/g, " ").trim().slice(0, 160);
}

function dollars(n) {
  const v = Math.round(num(n) * 100) / 100;
  const [whole, cents] = v.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return cents === "00" ? `$${grouped}` : `$${grouped}.${cents}`;
}

function dayText(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "an unknown day";
  return d.toISOString().slice(0, 10);
}

function who(r) {
  const code = r && r.client_code ? String(r.client_code).trim() : "";
  if (code) return code;
  const id = r && r.client_id ? String(r.client_id) : "";
  return id ? id.slice(0, 8) : "an unknown client";
}

function listed(items, shown = SHOWN) {
  const head = items.slice(0, shown).join("; ");
  const more = items.length > shown ? `; and ${items.length - shown} more` : "";
  return head + more;
}

function orgOrNull(ctx) {
  return ctx && typeof ctx.orgId === "string" && ctx.orgId ? ctx.orgId : null;
}

/* ──────────────────────────── 1. funded with no bill ──────────────────────────── */

/** What a funded round is missing, and the likeliest cause for each gap. Pure. */
export function roundProblems(r) {
  const out = [];
  const cardStacking = r.card_stacking === true;
  const bills = num(r.bills);
  /* A card-stacking round where a person marked every bank yes as "does not count" bills nothing on
     purpose, with a name against it (src/funding/success-fee.mjs: SQL_EXCLUDED_APPROVALS). That round
     is allowed to close with no closeout and no bill. It is not a break. */
  const billsNothingOnPurpose = cardStacking && num(r.confirmed_approvals) === 0 && num(r.excluded_approvals) > 0;
  if (cardStacking && r.has_closeout !== true && !billsNothingOnPurpose) out.push("no closeout record");
  if (bills === 0 && !billsNothingOnPurpose) {
    let why;
    if (cardStacking && num(r.confirmed_approvals) === 0) {
      why = "no bank yes with a dollar amount is on the round";
    } else if (num(r.linked_sales) === 0) {
      why = "the round is linked to no sale, so no fee percent";
    } else if (!(num(r.fee_percent) > 0 && num(r.fee_percent) <= 100)) {
      why = "the sale agreed no success-fee percent";
    } else {
      why = "the bill workflow F-07 did not make one";
    }
    out.push(`no success-fee bill (${why})`);
  }
  if (num(r.back_end_staff) > 0 && num(r.commission_rows) === 0) {
    out.push(`no staff commission rows (${plural(num(r.back_end_staff), "staff member")} attributed)`);
  }
  return out;
}

/** The verdict for the funded rounds and the funded cards. Pure. */
export function judgeFundedBills({ rounds = [], cards = [] } = {}) {
  const id = "funding:funded-no-bill";
  const broken = [];
  for (const r of rounds) {
    const problems = roundProblems(r);
    if (problems.length) broken.push({ r, problems });
  }
  const roundsRead = rounds.length ? num(rounds[0].total) || rounds.length : 0;
  const cardsRead = cards.length ? num(cards[0].total) || cards.length : 0;

  if (broken.length === 0 && cards.length === 0) {
    const days = Math.round(LOOKBACK_MS / DAY_MS);
    if (roundsRead === 0) {
      return row(id, "PASS", `no round has been funded in the last ${days} days, so no bill is due to be checked`);
    }
    return row(
      id,
      "PASS",
      `${plural(roundsRead, "funded round")} in the last ${days} days each ${roundsRead === 1 ? "has" : "have"} its closeout, success-fee bill and commission rows`
    );
  }

  const parts = [];
  if (broken.length) {
    const lines = broken.map(({ r, problems }) => `${who(r)} round ${num(r.round_number) || "?"}: ${problems.join(", ")}`);
    parts.push(`${plural(broken.length, "funded round")} the money chain did not finish. ${listed(lines)}`);
  }
  if (cards.length) {
    const names = cards.map((c) => who(c));
    parts.push(
      `${plural(cardsRead, "card")} sit${cardsRead === 1 ? "s" : ""} in Funded on the card-stacking board but the client has no funded round, so nothing was billed (${listed(names, 5)})`
    );
  }
  return row(
    id,
    "FAIL",
    `${parts.join(". ")}.`,
    "Open the client's funding round and the funded card. Re-run the funded step so the closeout, the success-fee bill and the commission rows are made. The pulse does not fix this."
  );
}

async function fundedNoBill(db, orgId, now) {
  const newerThan = new Date(now.getTime() - FUNDED_BILL_WAIT_MS);
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const rounds = await db.query(FUNDED_ROUNDS_SQL, [orgId, newerThan, olderThan, CARD_STACKING]);
  const cards = await db.query(FUNDED_CARDS_SQL, [orgId, newerThan, olderThan]);
  return judgeFundedBills({ rounds: rounds.rows || [], cards: cards.rows || [] });
}

/* ──────────────────────────── 2. approved with no amount ──────────────────────────── */

/** Pure. */
export function judgeApprovedNoAmount({ rows = [] } = {}) {
  const id = "funding:approved-no-amount";
  if (rows.length === 0) {
    return row(id, "PASS", "no bank yes older than a day is missing its dollar amount");
  }
  const total = num(rows[0].total) || rows.length;
  const names = rows.map((a) => `${a.bank} (${who(a)}, since ${dayText(a.since)})`);
  return row(
    id,
    "FAIL",
    `${plural(total, "bank yes", "bank yes answers")} older than a day ${total === 1 ? "has" : "have"} no dollar amount, so ${total === 1 ? "it" : "they"} can never be billed. ${listed(names)}.`,
    "Open each file and type in the approved amount from the bank's answer, or mark the approval as not counting. The pulse does not fix this."
  );
}

async function approvedNoAmount(db, orgId, now) {
  const newerThan = new Date(now.getTime() - APPROVED_NO_AMOUNT_AFTER_MS);
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const res = await db.query(APPROVED_NO_AMOUNT_SQL, [orgId, newerThan, olderThan]);
  return judgeApprovedNoAmount({ rows: res.rows || [] });
}

/* ──────────────────────────── 3. payouts on hold ──────────────────────────── */

/** The plain reason a payout is held, from the live stamps and the reason the run wrote. Pure. */
export function heldReason(p) {
  const bits = [];
  if (p.kind === "partner") {
    if (p.license_missing === true) bits.push("the partner agreement is not signed (agreement_signed_at is empty)");
  } else {
    if (p.license_missing === true) bits.push("the partner license is not signed (partner_license_signed_at is empty)");
    if (p.tax_missing === true) bits.push("the tax form is not on file (tax_form_received_at is empty)");
  }
  if (bits.length === 0) {
    const why = p.hold_reason ? String(p.hold_reason) : "no reason written";
    return `held as "${why}" but its stamps are now set, so the hold was never released`;
  }
  return bits.join(" and ");
}

/** Pure. */
export function judgeHeldPayouts({ rows = [] } = {}) {
  const id = "partners:payout-held";
  if (rows.length === 0) {
    return row(id, "PASS", "no affiliate or partner payout is on hold");
  }
  const total = num(rows[0].total) || rows.length;
  const sum = rows.reduce((n, p) => n + num(p.amount), 0);
  const lines = rows.map((p) => `${p.who || "an unnamed payee"} ${dollars(p.amount)}: ${heldReason(p)} (held since ${dayText(p.created_at)})`);
  return row(
    id,
    "FAIL",
    `${plural(total, "payout")} ${total === 1 ? "is" : "are"} on hold${total > rows.length ? "" : `, ${dollars(sum)} in all`}. ${listed(lines)}.`,
    "Get the missing license or tax form recorded for each person, then the next payout run can release the money. The pulse does not release or pay anything."
  );
}

async function payoutHeld(db, orgId, now) {
  const olderThan = new Date(now.getTime() - PAYOUT_HELD_AFTER_MS);
  const res = await db.query(HELD_PAYOUTS_SQL, [orgId, olderThan]);
  return judgeHeldPayouts({ rows: res.rows || [] });
}

/* ──────────────────────────── 4. the commission ledger and its rates ──────────────────────────── */

/** Pure. approved: { n, dollars, oldest }, rules: { read_rows, no_rule, wrong_version }, open: { scopes }. */
export function judgeLedger({ approved = {}, rules = {}, open = {} } = {}) {
  const id = "commissions:ledger";
  const parts = [];

  const unpaid = num(approved.n);
  if (unpaid > 0) {
    parts.push(
      `${plural(unpaid, "approved commission row")} (${dollars(approved.dollars)}) ${unpaid === 1 ? "has" : "have"} sat unpaid for more than ${Math.round(APPROVED_UNPAID_AFTER_MS / DAY_MS)} days, the oldest approved ${dayText(approved.oldest)}`
    );
  }

  const noRule = num(rules.no_rule);
  const wrong = num(rules.wrong_version);
  if (noRule + wrong > 0) {
    const bits = [];
    if (noRule > 0) bits.push(`${noRule} name no rule`);
    if (wrong > 0) bits.push(`${wrong} name a rule that was not in force on the sale date`);
    parts.push(`${plural(noRule + wrong, "earned or approved row")} ${noRule + wrong === 1 ? "does" : "do"} not match a rate version (${bits.join(", ")})`);
  }

  const scopes = num(open.scopes);
  if (scopes > 0) {
    parts.push(`${plural(scopes, "pay scope")} ${scopes === 1 ? "has" : "have"} more than one open rate version, so the rate it pays is a coin flip`);
  }

  if (parts.length) {
    return row(
      id,
      "FAIL",
      `${parts.join(". ")}.`,
      "Open the commissions screen. Mark paid what was paid, void or correct a row that names no rate, and close the extra rate version. The pulse does not approve, pay or change a rate."
    );
  }

  const read = num(rules.read_rows);
  if (read === 0) {
    return row(id, "PASS", "the ledger has no earned or approved commission rows yet, and no pay scope has two open rate versions");
  }
  return row(
    id,
    "PASS",
    `${plural(read, "earned or approved row")} read: none is unpaid past ${Math.round(APPROVED_UNPAID_AFTER_MS / DAY_MS)} days, each names a rate version in force on its sale date, and no pay scope has two open versions`
  );
}

async function ledger(db, orgId, now) {
  const cutoff = new Date(now.getTime() - APPROVED_UNPAID_AFTER_MS);
  const approved = await db.query(APPROVED_UNPAID_SQL, [orgId, cutoff]);
  const rules = await db.query(LEDGER_RULE_SQL, [orgId]);
  const open = await db.query(OPEN_VERSIONS_SQL, [orgId]);
  return judgeLedger({
    approved: (approved.rows || [])[0] || {},
    rules: (rules.rows || [])[0] || {},
    open: (open.rows || [])[0] || {}
  });
}

/* ──────────────────────────── 5. the ClickFunnels product map ──────────────────────────── */

/** Pure. */
export function judgeSloMap({ rows = [] } = {}) {
  const id = "commissions:slo-map";
  const days = Math.round(LOOKBACK_MS / DAY_MS);
  if (rows.length === 0) {
    return row(id, "PASS", `no product has been sold through ClickFunnels in the last ${days} days, so there is no map to judge`);
  }
  const products = new Map();
  for (const r of rows) {
    const key = String(r.product_id || r.product);
    const cur = products.get(key) || { product: r.product, sales: 0, mapped: true, ruled: true };
    cur.sales += num(r.sales);
    // A product with two sale motions is judged on its worst one.
    cur.mapped = cur.mapped && r.mapped === true;
    cur.ruled = cur.ruled && r.ruled === true;
    products.set(key, cur);
  }
  const bad = [];
  for (const p of products.values()) {
    const gaps = [];
    if (!p.mapped) gaps.push("no active map, so the next paid order for it is turned away");
    if (!p.ruled) gaps.push("no commission rule is open for it");
    if (gaps.length) bad.push(`${p.product} (sold ${plural(p.sales, "time")}): ${gaps.join(" and ")}`);
  }
  if (bad.length === 0) {
    return row(id, "PASS", `${plural(products.size, "product")} sold through ClickFunnels in the last ${days} days, and each has an active map and a commission rule`);
  }
  return row(
    id,
    "FAIL",
    `${plural(bad.length, "ClickFunnels product")} ${bad.length === 1 ? "is" : "are"} not set up. ${listed(bad)}.`,
    "Open the SLO connections tab and map the ClickFunnels product to the Fundhub product, and add the commission rule on the commissions tab. The pulse does not change a map or a rate."
  );
}

async function sloMap(db, orgId, now) {
  const olderThan = new Date(now.getTime() - LOOKBACK_MS);
  const res = await db.query(SLO_PRODUCTS_SQL, [orgId, now, olderThan]);
  return judgeSloMap({ rows: res.rows || [] });
}

/* ──────────────────────────── 6. sample rows in the live books ──────────────────────────── */

/** Pure. */
export function judgeSampleRows({ counts = {} } = {}) {
  const id = "books:sample-rows";
  const c = {
    clients: num(counts.clients),
    payments: num(counts.payments),
    sales: num(counts.sales),
    commission_rows: num(counts.commission_rows),
    invoices: num(counts.invoices),
    messages: num(counts.messages)
  };
  const total = c.clients + c.payments + c.sales + c.commission_rows + c.invoices + c.messages;
  if (total === 0) {
    return row(id, "PASS", "no sample client or sample payment from the dashboard seed tool is in the live books");
  }
  const bits = [];
  if (c.clients) bits.push(plural(c.clients, "sample client"));
  if (c.payments) bits.push(`${plural(c.payments, "sample payment")} (${dollars(counts.payment_dollars)})`);
  if (c.sales) bits.push(`${plural(c.sales, "sale")} (${dollars(counts.sale_dollars)})`);
  if (c.commission_rows) bits.push(plural(c.commission_rows, "commission row"));
  if (c.invoices) bits.push(plural(c.invoices, "invoice"));
  if (c.messages) bits.push(plural(c.messages, "message"));
  return row(
    id,
    "FAIL",
    `The dashboard sample-client tool left fake money in the live books: ${bits.join(", ")}. They count toward real totals.`,
    "Flag these rows as demo or remove them (the sim purge script reports them first). Do not use the sample-client tool on the live company. The pulse does not delete anything."
  );
}

async function sampleRows(db, orgId) {
  const res = await db.query(SAMPLE_ROWS_SQL, [orgId, SEED_CLIENT_EMAIL_RE, SEED_PAYMENT_REF_RE]);
  return judgeSampleRows({ counts: (res.rows || [])[0] || {} });
}

/* ──────────────────────────── the lane ──────────────────────────── */

/**
 * @param {{ db?: { query: Function }, orgId?: string, now?: Date }} [ctx]
 * @returns {Promise<Array<{ id: string, status: "PASS"|"FAIL"|"skip", detail: string, suggestedFix: string|null }>>}
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = orgOrNull(ctx);
  if (!db || typeof db.query !== "function") {
    return CHECK_IDS.map((id) => row(id, "skip", "no database in this run, so the money books were not read"));
  }
  if (!orgId) {
    return CHECK_IDS.map((id) => row(id, "skip", "no company id in this run, so the money books were not read"));
  }
  const now = ctx.now instanceof Date && !Number.isNaN(ctx.now.getTime()) ? ctx.now : new Date();

  // A failed read is a skip with the reason. It is never a PASS and never a made-up FAIL.
  async function run(id, fn) {
    try {
      return await fn();
    } catch (err) {
      return row(id, "skip", `could not read the books for this check: ${clip(err)}`);
    }
  }

  return Promise.all([
    run("funding:funded-no-bill", () => fundedNoBill(db, orgId, now)),
    run("funding:approved-no-amount", () => approvedNoAmount(db, orgId, now)),
    run("partners:payout-held", () => payoutHeld(db, orgId, now)),
    run("commissions:ledger", () => ledger(db, orgId, now)),
    run("commissions:slo-map", () => sloMap(db, orgId, now)),
    run("books:sample-rows", () => sampleRows(db, orgId))
  ]);
}
