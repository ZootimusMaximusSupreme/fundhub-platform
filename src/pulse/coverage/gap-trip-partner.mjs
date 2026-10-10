// The partner trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:partner   Did every affiliate and every white-label partner who applied in the last 60
//                  days get every step the company owes, and what is the first step missing?
//
// TWO KINDS OF PARTNER, ONE BRIEF. The brief's seven steps are "partner applies, approved, page
// published and live, referral clicked, referral converted, commission, payout paid". The product has
// two kinds of partner and each owns different records, so the lane walks each kind on its own ladder
// and keeps the brief's seven keys and order. A step that has no record for a kind is worded for what
// that kind really has, and said so here:
//
//                       affiliate (affiliates)                 white-label partner (partners)
//   applied             the affiliates row                     the partners row
//   approved            status is active (self-signup)         status is active (a person approves)
//   page_live           the referral link has a code           a published page that answers 200
//   referral_clicked    a click credited to the affiliate      a lead owned by the partner (clients.partner_id)
//   referral_converted  a referral marked converted            an owned lead paid for a shared product (sale_payments)
//   commission          the converted referral has a number    a partner_revenue row (the partner's share)
//   payout_paid         a payout with status paid              a partner payout with status paid
//
// WHAT IS RED (and only this):
//   * the referral link has no code (the code is how every click is credited);
//   * a click carried the affiliate's code and was credited to nobody (gap-partners.mjs rule);
//   * a referred client paid for a qualifying product and the referral is still "attributed" 30
//     minutes later (economics.mjs qualifyingOutcome decides what qualifies);
//   * a converted referral has no commission number, because no rate was in force or the basis was
//     unknown (unrated: nobody is told, nobody is paid);
//   * a white-label partner is active and has no published page, or the published page does not
//     answer 200 at /sites/<partner>/<slug> (the partner-pages:live read, GET only);
//   * a payment from a partner's client, on a product the partner shares in, has no accrual row
//     30 minutes later (src/partners/revenue.mjs decides what accrues);
//   * a payout is held past a day, stuck in processing past a week, or commission is payable under
//     the monthly rules (signed license, tax form, the minimum) and is on no run.
//
// WHAT IS NEVER RED: an applicant waiting for approval, a link nobody has clicked, a lead that has
// not paid, a paid referral waiting for the monthly run.
//
// TEST DATA. Live has 23 affiliates and 15 partners, and most are sim, e2e and test rows that nobody
// flagged is_demo. A payee is left out when its name or its contact address looks like a test run
// (TEST_PAYEE_NAME_RE, TEST_PAYEE_EMAIL_RE) or when it has no contact address at all.
//
// READ ONLY. Two SELECTs, then GET only on published partner pages. ctx.db is a shared pool: never
// BEGIN, COMMIT, ROLLBACK or SET here. No text, no email, no payout, no AI call.

import {
  BLUEPRINT_PRODUCT_CODES, FUNDING_PRODUCT_CODES, REPAIR_PRODUCT_CODES
} from "../../affiliates/economics.mjs";
import { PAYOUT_DEFAULTS, previousMonth } from "../../affiliates/payouts.mjs";
import { PARTNER_SHARE_PRODUCT_CODES } from "../../partners/revenue.mjs";
import { DEAD_LINK_WINDOW_MS, PAYOUT_STUCK_AFTER_MS } from "./gap-partners.mjs";
import { FUNDED_BILL_WAIT_MS, LOOKBACK_MS } from "./gap-money-funding.mjs";
import { PAGE_CAP, pickPages, readPage } from "./gap-partner-pages.mjs";
import { SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE } from "./gap-portal.mjs";
import {
  DAY_MS, clip, intOf, nowOf, plural, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import {
  BY, NO_FIX, defaultOrg, judgeTrip, makeNaVerify, skipRow,
  registerTripCount, sharedCount
} from "./trip-kit.mjs";

const ID = "trip:partner";
export const CHECK_IDS = Object.freeze([ID]);

export const TRIP_NAME = "partner";
export const WINDOW_MS = LOOKBACK_MS;
export const ROW_CAP = 200;
/** A payout on hold longer than this is a person's job (the same day W1's partners:payout-held uses). */
export const PAYOUT_HELD_AFTER_MS = DAY_MS;
/** sale_payments.kind values that accrue to a partner (src/partners/revenue.mjs ACCRUABLE_KINDS). */
export const ACCRUABLE_KINDS = Object.freeze(["deposit", "installment", "success_fee"]);

/** A name that is a test run, a demo row or the house account, not a customer. */
export const TEST_PAYEE_NAME_RE =
  String.raw`^(sim[ -]|e2e[ -]|test\b|demo\b|t10|principalread|fundhub direct|fundhub \(house\))`;
/** An address that is a test run: the portal lane's pattern plus the plus-tags the sim runs use. */
export const TEST_PAYEE_EMAIL_RE =
  `${INTERNAL_CLIENT_EMAIL_RE}|` +
  // a local part with a whole segment e2e, sim or test (the rule src/slo/visitor.mjs TEST_LOCAL uses)
  String.raw`^([^@]*[.+_-])?(e2e|sim|test)([.+_-][^@]*)?@|\+(sim|e2e|walk|aff|wl|fhtest)[-_0-9a-z]*@|@demo\.fundhub\.local$`;

const s = (o) => Object.freeze(o);

/** The affiliate ladder. */
export const AFFILIATE_STEPS = Object.freeze([
  s({ key: "applied", label: "applied (a login and a referral link were made)", by: BY.CLIENT }),
  s({ key: "approved", label: "approved (status active)", by: BY.PERSON }),
  s({
    key: "page_live", label: "referral link has a code", by: BY.SYSTEM, from: "applied", graceMs: SETTLE_GRACE_MS,
    source: "the affiliates row gets its tracking_id when it is made; wait = SETTLE_GRACE_MS"
  }),
  s({ key: "referral_clicked", label: "a click credited to the affiliate", by: BY.CLIENT }),
  s({ key: "referral_converted", label: "a referral converted", by: BY.CLIENT }),
  s({
    key: "commission", label: "commission worked out on the converted referral", by: BY.SYSTEM,
    from: "referral_converted", graceMs: SETTLE_GRACE_MS,
    source: "convert() sets commission_due in the same call as the conversion; wait = SETTLE_GRACE_MS"
  }),
  s({ key: "payout_paid", label: "payout paid", by: BY.PERSON })
]);

/** The white-label partner ladder. */
export const PARTNER_STEPS = Object.freeze([
  s({ key: "applied", label: "applied (a partners row was made)", by: BY.CLIENT }),
  s({ key: "approved", label: "approved (status active)", by: BY.PERSON }),
  s({
    key: "page_live", label: "page published and live", by: BY.SYSTEM, from: "approved", graceMs: SETTLE_GRACE_MS,
    source: "approvePartnerApplication publishes the page in the same transaction; wait = SETTLE_GRACE_MS"
  }),
  s({ key: "referral_clicked", label: "a lead came in through the partner", by: BY.CLIENT }),
  s({ key: "referral_converted", label: "a lead of the partner paid for a product the partner shares in", by: BY.CLIENT }),
  s({
    key: "commission", label: "the partner's share accrued", by: BY.SYSTEM,
    from: "referral_converted", graceMs: FUNDED_BILL_WAIT_MS,
    source: "accrueForPayment runs in the money chain with the payment; wait = FUNDED_BILL_WAIT_MS"
  }),
  s({ key: "payout_paid", label: "payout paid", by: BY.PERSON })
]);

/** The qualifying products, lower-case. Funding also needs a funded round (economics.mjs). */
const QUALIFYING_NO_ROUND = Object.freeze([...REPAIR_PRODUCT_CODES, ...BLUEPRINT_PRODUCT_CODES].map((c) => c.toLowerCase()));
const QUALIFYING_FUNDING = Object.freeze(FUNDING_PRODUCT_CODES.map((c) => c.toLowerCase()));

/* Who counts as a partner on this trip, written once so the full reads and the light count read the same
   people: not demo, applied in the window, not a test run by name or address, and with a login (affiliate)
   or a contact address (white-label partner). $1 org, $2 window start, $3 test address pattern, $4 test
   name pattern. */
const AFFILIATE_WHERE = `
   WHERE a.org_id = $1::uuid
     AND COALESCE(a.is_demo, false) = false
     AND a.created_at >= $2::timestamptz
     AND COALESCE(a.name, '') !~* $4::text
     AND EXISTS (
       SELECT 1 FROM accounts ac
        WHERE ac.org_id = a.org_id AND ac.affiliate_id = a.id
          AND COALESCE(btrim(ac.email), '') <> '' AND ac.email !~* $3::text
     )
`;
const PARTNER_WHERE = `
   WHERE p.org_id = $1::uuid
     AND COALESCE(p.is_demo, false) = false
     AND p.created_at >= $2::timestamptz
     AND COALESCE(p.name, '') !~* $4::text
     AND COALESCE(p.brand_name, '') !~* $4::text
     AND COALESCE(btrim(p.contact_email), '') <> ''
     AND p.contact_email !~* $3::text
`;

/**
 * Affiliates who applied in the window.
 * $1 org, $2 window start, $3 test address pattern, $4 test name pattern, $5 funding codes,
 * $6 repair and blueprint codes, $7 convert cut (now - 30 min), $8 payable cutoff (start of this
 * month), $9 stuck cut (now - 7 days), $10 held cut (now - 1 day), $11 click window start (now - 30 days).
 */
export const AFFILIATE_SQL = `
  /* gap:trip-partner-affiliate */
  SELECT a.id::text                                   AS payee_id,
         a.name                                       AS name,
         a.tracking_id                                AS tracking_id,
         a.status                                     AS status,
         a.created_at                                 AS applied_at,
         a.activated_at                               AS activated_at,
         (a.partner_license_signed_at IS NOT NULL)    AS license_ok,
         (a.tax_form_received_at IS NOT NULL)         AS tax_ok,
         k.credited_n                                 AS credited_n,
         k.first_click_at                             AS first_click_at,
         ku.uncredited_n                              AS uncredited_n,
         rf.converted_n                               AS converted_n,
         rf.converted_at                              AS converted_at,
         rf.rated_n                                   AS rated_n,
         rf.unrated_n                                 AS unrated_n,
         rf.unconverted_paid_n                        AS unconverted_paid_n,
         rf.payable_usd                               AS payable_usd,
         po.paid_n                                    AS paid_n,
         po.paid_at                                   AS paid_at,
         po.held_n                                    AS held_n,
         po.stuck_n                                   AS stuck_n
    FROM affiliates a
    LEFT JOIN LATERAL (
      SELECT count(*)::int                 AS credited_n,
             min(c.occurred_at)            AS first_click_at
        FROM affiliate_link_clicks c
       WHERE c.org_id = $1::uuid AND c.affiliate_id = a.id
    ) k ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int                 AS uncredited_n
        FROM affiliate_link_clicks c
       WHERE c.org_id = $1::uuid AND c.affiliate_id IS NULL
         AND c.occurred_at >= $11::timestamptz
         AND c.occurred_at >= a.created_at
         AND upper(c.tracking_id_used) = upper(a.tracking_id)
    ) ku ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE r.status IN ('converted', 'paid'))::int                          AS converted_n,
             min(r.converted_at) FILTER (WHERE r.status IN ('converted', 'paid'))                    AS converted_at,
             count(*) FILTER (WHERE r.status IN ('converted', 'paid') AND r.commission_due IS NOT NULL)::int AS rated_n,
             count(*) FILTER (WHERE r.status IN ('converted', 'paid') AND r.commission_due IS NULL)::int     AS unrated_n,
             count(*) FILTER (
               WHERE r.status = 'attributed'
                 AND (r.tier = 'direct' OR a.tier_level = 'tier2')
                 AND EXISTS (
                   SELECT 1
                     FROM sales sl
                     JOIN products pr ON pr.id = sl.product_id
                     JOIN sale_payments sp ON sp.sale_id = sl.id AND sp.org_id = sl.org_id
                    WHERE sl.org_id = r.org_id AND sl.client_id = r.client_id AND sl.status = 'active'
                      AND COALESCE(sl.is_demo, false) = false
                      AND sp.kind <> 'refund' AND sp.created_at < $7::timestamptz
                      AND (
                        lower(btrim(pr.code)) = ANY($6::text[])
                        OR (lower(btrim(pr.code)) = ANY($5::text[]) AND EXISTS (
                              SELECT 1 FROM funding_rounds fr
                               WHERE fr.client_id = sl.client_id AND COALESCE(fr.funded_amount, 0) > 0))
                        OR (lower(btrim(pr.code)) = 'diagnostic' AND EXISTS (
                              SELECT 1 FROM payment_links pl
                               WHERE pl.org_id = sl.org_id AND pl.client_id = sl.client_id
                                 AND pl.link_ref LIKE 'slo_%' AND pl.status = 'paid'
                                 AND COALESCE(pl.is_demo, false) = false))
                      )
                 ))::int                                                                             AS unconverted_paid_n,
             COALESCE(sum(r.commission_due) FILTER (
               WHERE r.status = 'converted' AND r.commission_due > 0 AND r.converted_at < $8::timestamptz
                 AND NOT EXISTS (
                   SELECT 1
                     FROM affiliate_payout_lines l
                     JOIN affiliate_payouts p ON p.id = l.payout_id
                    WHERE l.referral_id = r.id AND l.kind = 'commission'
                      AND p.status IN ('pending', 'processing', 'paid'))), 0)::float8                AS payable_usd
        FROM affiliate_referrals r
       WHERE r.org_id = $1::uuid AND r.affiliate_id = a.id
    ) rf ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE p.status = 'paid')::int                                         AS paid_n,
             min(p.paid_at) FILTER (WHERE p.status = 'paid')                                        AS paid_at,
             count(*) FILTER (WHERE p.status = 'held' AND p.created_at < $10::timestamptz)::int     AS held_n,
             count(*) FILTER (WHERE p.status = 'processing'
                                AND COALESCE(p.initiated_at, p.created_at) < $9::timestamptz)::int AS stuck_n
        FROM affiliate_payouts p
       WHERE p.org_id = $1::uuid AND p.affiliate_id = a.id
    ) po ON true
${AFFILIATE_WHERE}   ORDER BY a.created_at ASC
   LIMIT ${ROW_CAP}
`;

/**
 * White-label partners who applied in the window.
 * $1 org, $2 window start, $3 test address pattern, $4 test name pattern, $5 the product codes a
 * partner shares in, $6 the payment kinds that accrue, $7 accrual cut (now - 30 min), $8 stuck cut
 * (now - 7 days), $9 held cut (now - 1 day).
 */
export const PARTNER_SQL = `
  /* gap:trip-partner-white-label */
  SELECT p.id::text                                   AS payee_id,
         COALESCE(NULLIF(btrim(p.brand_name), ''), p.name) AS name,
         p.slug                                       AS slug,
         p.status                                     AS status,
         p.created_at                                 AS applied_at,
         COALESCE(p.activated_at, p.updated_at)       AS approved_at,
         (p.agreement_signed_at IS NOT NULL)          AS agreement_signed,
         p.revenue_share_pct::float8                  AS share_pct,
         pg.slug                                      AS page_slug,
         pg.published_at                              AS page_published_at,
         oc.owned_n                                   AS owned_n,
         oc.first_lead_at                             AS first_lead_at,
         pd.paid_in_n                                 AS paid_in_n,
         pd.first_paid_at                             AS first_paid_at,
         pd.unaccrued_n                               AS unaccrued_n,
         rv.revenue_n                                 AS revenue_n,
         rv.first_revenue_at                          AS first_revenue_at,
         po.paid_n                                    AS paid_n,
         po.paid_at                                   AS paid_at,
         po.held_n                                    AS held_n,
         po.stuck_n                                   AS stuck_n
    FROM partners p
    LEFT JOIN LATERAL (
      SELECT g.slug, g.published_at
        FROM partner_pages g
       WHERE g.org_id = $1::uuid AND g.partner_id = p.id AND g.status = 'published'
       ORDER BY g.published_at DESC NULLS LAST
       LIMIT 1
    ) pg ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS owned_n, min(c.created_at) AS first_lead_at
        FROM clients c
       WHERE c.org_id = $1::uuid AND c.partner_id = p.id AND COALESCE(c.is_demo, false) = false
    ) oc ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE shared.ok)::int                          AS paid_in_n,
             min(shared.at) FILTER (WHERE shared.ok)                         AS first_paid_at,
             count(*) FILTER (
               WHERE shared.ok
                 AND shared.created_at < $7::timestamptz
                 AND p.revenue_share_pct > 0
                 AND NOT EXISTS (
                   SELECT 1 FROM partner_revenue rv2
                    WHERE rv2.org_id = shared.org_id AND rv2.partner_id = p.id
                      AND ((rv2.transaction_id IS NOT NULL AND rv2.transaction_id = shared.transaction_id)
                        OR (rv2.source_event_id IS NOT NULL AND rv2.source_event_id = shared.source_event_id))
                 ))::int                                                     AS unaccrued_n
        FROM (
          SELECT sp.org_id, sp.transaction_id, sp.source_event_id, sp.created_at,
                 COALESCE(sp.paid_at, sp.created_at) AS at,
                 (sp.kind = ANY($6::text[]) AND sp.amount > 0
                  AND lower(btrim(COALESCE(pr.code, ''))) = ANY($5::text[])) AS ok
            FROM sale_payments sp
            JOIN sales sl ON sl.id = sp.sale_id AND sl.org_id = sp.org_id
            JOIN clients c ON c.id = sl.client_id AND c.org_id = sl.org_id
            LEFT JOIN products pr ON pr.id = sp.product_id
           WHERE sp.org_id = $1::uuid AND c.partner_id = p.id
             AND COALESCE(sp.is_demo, false) = false AND COALESCE(sl.is_demo, false) = false
             AND sp.kind <> 'refund'
        ) shared
    ) pd ON true
    LEFT JOIN LATERAL (
      SELECT count(*)::int AS revenue_n, min(rv.created_at) AS first_revenue_at
        FROM partner_revenue rv
       WHERE rv.org_id = $1::uuid AND rv.partner_id = p.id AND rv.status <> 'void'
    ) rv ON true
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE x.status = 'paid')::int                                         AS paid_n,
             min(x.paid_at) FILTER (WHERE x.status = 'paid')                                        AS paid_at,
             count(*) FILTER (WHERE x.status = 'held' AND x.created_at < $9::timestamptz)::int      AS held_n,
             count(*) FILTER (WHERE x.status = 'processing'
                                AND COALESCE(x.initiated_at, x.created_at) < $8::timestamptz)::int  AS stuck_n
        FROM partner_payouts x
       WHERE x.org_id = $1::uuid AND x.partner_id = p.id
    ) po ON true
${PARTNER_WHERE}   ORDER BY p.created_at ASC
   LIMIT ${ROW_CAP}
`;

/** The light count behind the nothing-to-judge proof: both kinds of partner, one read. $1 org, $2 window, $3 address pattern, $4 name pattern. */
export const COUNT_SQL = `
  /* gap:trip-partner-count */
  SELECT (
    (SELECT count(*) FROM affiliates a
${AFFILIATE_WHERE})
    +
    (SELECT count(*) FROM partners p
${PARTNER_WHERE})
  )::int AS n
`;

const usd = (n) => `$${(Math.round(Number(n) * 100) / 100).toLocaleString("en-US")}`;

function heldWhy(r, kind) {
  const bits = [];
  if (kind === "affiliate") {
    if (r.license_ok === false) bits.push("the partner license is not signed");
    if (r.tax_ok === false) bits.push("the tax form is not on file");
  } else if (r.agreement_signed === false) {
    bits.push("the partner agreement is not signed");
  }
  return bits.length ? bits.join(" and ") : "no reason written";
}

/** Pure. One affiliate SQL row to one trip row. */
export function toAffiliateRow(r, now = new Date()) {
  const facts = {};
  const defects = [];
  const notOwed = [];
  const status = String(r.status || "");
  if (r.applied_at) facts.applied = r.applied_at;
  if (status === "active") facts.approved = r.activated_at || r.applied_at;
  if (r.tracking_id && String(r.tracking_id).trim() !== "") facts.page_live = r.applied_at;
  if (intOf(r.credited_n) > 0) facts.referral_clicked = r.first_click_at || true;
  if (intOf(r.converted_n) > 0) facts.referral_converted = r.converted_at || true;
  if (intOf(r.converted_n) > 0 && intOf(r.unrated_n) === 0 && intOf(r.rated_n) > 0) {
    facts.commission = r.converted_at || true;
  }
  if (intOf(r.paid_n) > 0) facts.payout_paid = r.paid_at || true;

  const detail = {};
  if (intOf(r.uncredited_n) > 0) {
    defects.push({
      key: "referral_clicked",
      why: `${plural(intOf(r.uncredited_n), "click")} carried this affiliate's code and ${intOf(r.uncredited_n) === 1 ? "was" : "were"} credited to nobody`
    });
  }
  if (intOf(r.unconverted_paid_n) > 0) {
    defects.push({
      key: "referral_converted",
      why: `${plural(intOf(r.unconverted_paid_n), "referred client")} paid for a qualifying product and the referral was never marked converted`
    });
  }
  if (intOf(r.unrated_n) > 0) {
    detail.commission =
      `${plural(intOf(r.unrated_n), "converted referral")} ${intOf(r.unrated_n) === 1 ? "has" : "have"} no commission number (no rate in force, or the basis was unknown), so nobody is told and nobody is paid`;
  }

  // Held and stuck payouts, and commission the rules say is payable and is on no run. These are
  // defects, not stalls: an older payout may be paid and a newer one still held.
  if (intOf(r.held_n) > 0) {
    defects.push({ key: "payout_paid", why: `${plural(intOf(r.held_n), "payout")} on hold for over a day: ${heldWhy(r, "affiliate")}` });
  } else if (intOf(r.stuck_n) > 0) {
    defects.push({ key: "payout_paid", why: `${plural(intOf(r.stuck_n), "payout")} stuck in processing for over 7 days` });
  } else if (Number(r.payable_usd) >= PAYOUT_DEFAULTS.minimumUsd && r.license_ok === true && r.tax_ok === true) {
    defects.push({
      key: "payout_paid",
      why: `${usd(r.payable_usd)} of commission is payable (license signed, tax form on file, at least ${usd(PAYOUT_DEFAULTS.minimumUsd)}) and is on no payout run`
    });
  }

  let ended = null;
  if (status && status !== "active") ended = { why: `the affiliate is ${status}` };

  return {
    who: String(r.name || r.tracking_id || r.payee_id || "an affiliate").slice(0, 40),
    track: "affiliate", facts, notOwed, ended, stall: null, detail, defects
  };
}

/**
 * Pure. One white-label partner SQL row to one trip row.
 * `live` is { ok, why } from the page read, or null when the page was not opened.
 */
export function toPartnerRow(r, live = null, now = new Date()) {
  const facts = {};
  const defects = [];
  const notOwed = [];
  const detail = {};
  const status = String(r.status || "");
  if (r.applied_at) facts.applied = r.applied_at;
  if (status === "active") facts.approved = r.approved_at || r.applied_at;

  const published = !!r.page_published_at || !!r.page_slug;
  if (published) {
    facts.page_live = r.page_published_at || true;
    if (live && live.ok === false) {
      defects.push({ key: "page_live", why: `the published page ${live.why || "does not open"} (GET /sites/${r.payee_id}/${r.page_slug})` });
    }
  }
  if (intOf(r.owned_n) > 0) facts.referral_clicked = r.first_lead_at || true;
  if (intOf(r.paid_in_n) > 0) facts.referral_converted = r.first_paid_at || true;
  if (intOf(r.revenue_n) > 0) facts.commission = r.first_revenue_at || true;
  if (intOf(r.paid_n) > 0) facts.payout_paid = r.paid_at || true;

  // A partner with a rate of 0 earns nothing on purpose (computeAccrual: zero_share_pct). A partner
  // with NO rate is a hole: every payment is refused (unknown_share_pct) and nobody is told.
  const sharePct = r.share_pct == null ? null : Number(r.share_pct);
  if (intOf(r.paid_in_n) > 0 && sharePct === 0) notOwed.push("commission", "payout_paid");
  else if (intOf(r.paid_in_n) > 0 && sharePct == null) {
    defects.push({ key: "commission", why: "the partner has no revenue share percent set, so no payment accrues a share" });
  } else if (intOf(r.unaccrued_n) > 0) {
    defects.push({
      key: "commission",
      why: `${plural(intOf(r.unaccrued_n), "payment")} from this partner's clients, on a product the partner shares in, ${intOf(r.unaccrued_n) === 1 ? "has" : "have"} no accrual row`
    });
  }

  if (intOf(r.held_n) > 0) {
    defects.push({ key: "payout_paid", why: `${plural(intOf(r.held_n), "payout")} on hold for over a day: ${heldWhy(r, "partner")}` });
  } else if (intOf(r.stuck_n) > 0) {
    defects.push({ key: "payout_paid", why: `${plural(intOf(r.stuck_n), "payout")} stuck in processing for over 7 days` });
  }

  // An active partner with no page is the system's miss; an invited one is waiting for a person.
  let ended = null;
  if (status === "paused") ended = { why: "the partner is paused" };

  return {
    who: String(r.name || r.slug || r.payee_id || "a partner").slice(0, 40),
    track: "partner", facts, notOwed, ended, stall: null, detail, defects
  };
}

/** Which ladder a row walks. */
export function stepsFor(row) {
  return row && row.track === "partner" ? PARTNER_STEPS : AFFILIATE_STEPS;
}

/** Pure. Rows from both reads plus the page reads, to the verdict. */
export function judgePartner({
  affiliates = [], partners = [], pages = new Map(), now = new Date(), note = "", orgId = null
} = {}) {
  const rows = [
    ...affiliates.map((r) => toAffiliateRow(r, now)),
    ...partners.map((r) => toPartnerRow(r, pages.get(String(r.payee_id)) || null, now))
  ];
  return judgeTrip({
    id: ID,
    orgId,
    tripName: TRIP_NAME,
    steps: stepsFor,
    rows,
    now,
    windowDays: Math.round(WINDOW_MS / DAY_MS),
    cap: null,
    what: "partner",
    note,
    fix:
      "Open the partner on the affiliates or partners screen and read the step named. A click credited to nobody, a paid referral that is not converted, " +
      "or a payment with no accrual means the money chain or the click door did not finish: read failed_events for that client. Do not pay or release anything from the pulse. " + NO_FIX
  });
}

export function tripParams(orgId, now) {
  const { periodEnd } = previousMonth(now);
  return {
    affiliate: [
      orgId,
      new Date(now.getTime() - WINDOW_MS).toISOString(),
      TEST_PAYEE_EMAIL_RE,
      TEST_PAYEE_NAME_RE,
      QUALIFYING_FUNDING,
      QUALIFYING_NO_ROUND,
      new Date(now.getTime() - FUNDED_BILL_WAIT_MS).toISOString(),
      periodEnd.toISOString(),
      new Date(now.getTime() - PAYOUT_STUCK_AFTER_MS).toISOString(),
      new Date(now.getTime() - PAYOUT_HELD_AFTER_MS).toISOString(),
      new Date(now.getTime() - DEAD_LINK_WINDOW_MS).toISOString()
    ],
    partner: [
      orgId,
      new Date(now.getTime() - WINDOW_MS).toISOString(),
      TEST_PAYEE_EMAIL_RE,
      TEST_PAYEE_NAME_RE,
      PARTNER_SHARE_PRODUCT_CODES.map((c) => c.toLowerCase()),
      ACCRUABLE_KINDS,
      new Date(now.getTime() - FUNDED_BILL_WAIT_MS).toISOString(),
      new Date(now.getTime() - PAYOUT_STUCK_AFTER_MS).toISOString(),
      new Date(now.getTime() - PAYOUT_HELD_AFTER_MS).toISOString()
    ]
  };
}

const countParams = (orgId, now) => tripParams(orgId, now).affiliate.slice(0, 4);
registerTripCount(ID, COUNT_SQL, countParams);

async function startedCount(run, orgId, now, ctx = {}) {
  return sharedCount({
    run, key: ctx.scope || ctx.db, id: ID, orgId, now,
    own: async () => {
      const out = await run((tx) => tx.query(COUNT_SQL, countParams(orgId, now)));
      return intOf(out && out.rows && out.rows[0] && out.rows[0].n);
    }
  });
}

export const naVerify = makeNaVerify({ id: ID, countStarted: startedCount, runnerOf, nowOf, defaultOrg });

/**
 * Read the published pages of the partners in the list. GET only, at most PAGE_CAP, all at once.
 * Returns a Map of partner id to { ok, why }. A partner not read is not in the map.
 */
async function readPages(web, origin, partners, now) {
  const out = new Map();
  const withPage = partners.filter((r) => r.page_slug && r.status === "active");
  const pick = pickPages(withPage.map((r) => ({ partner_id: r.payee_id, slug: r.page_slug })), now, PAGE_CAP);
  const results = await Promise.all(pick.map(async (row) => [row.partner_id, await readPage(web, origin, row)]));
  for (const [id, res] of results) out.set(String(id), res);
  return out;
}

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date, fetchImpl?: Function, baseUrl?: string }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the partner trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  const p = tripParams(orgId, now);
  try {
    const aff = await readRows(run, ID, "the affiliate trips", AFFILIATE_SQL, p.affiliate);
    if (aff.skip) return [aff.skip];
    const par = await readRows(run, ID, "the white-label partner trips", PARTNER_SQL, p.partner);
    if (par.skip) return [par.skip];

    let pages = new Map();
    let note = "";
    // The lane runner hands the same client in as ctx.fetchImpl and ctx.fetch (run-slices.mjs gapContext).
    const web = typeof ctx.fetchImpl === "function" ? ctx.fetchImpl : null;
    const wantsPages = par.rows.some((r) => r.page_slug && r.status === "active");
    if (wantsPages) {
      if (web) {
        const origin = String(ctx.baseUrl || "https://fundhub.ai").replace(/\/+$/, "");
        pages = await readPages(web, origin, par.rows, now);
      } else {
        note = "The published pages were not opened in this run, so \"live\" was not judged.";
      }
    }
    if (aff.rows.length >= ROW_CAP || par.rows.length >= ROW_CAP) {
      note = `${note} Only the first ${ROW_CAP} of one list were read.`.trim();
    }
    return [judgePartner({ affiliates: aff.rows, partners: par.rows, pages, now, note, orgId })];
  } catch (err) {
    return [skipRow(ID, `could not judge the partner trips: ${clip(err)}`)];
  }
}
