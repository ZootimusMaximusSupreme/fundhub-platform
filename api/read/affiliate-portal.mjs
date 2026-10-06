// GET /api/read/affiliate-portal — one affiliate's own referrals, payouts,
// rates and gates.
//
// THE HOLE THIS FILLS. public/app/affiliate.html declares `var LEADS=[]` at its
// own :398 and `var PAYOUTS=[]` at :477 and never assigns either, so both tables
// have permanently read "No referrals on file" since the screen was written. No
// endpoint in this repo returns affiliate_referrals or affiliate_payouts rows to
// the person they belong to — api/read/affiliates.mjs returns per-affiliate
// COUNTS to staff, which is a different question. This is the read those two
// arrays were waiting for.
//
//
// *** WHO MAY CALL IT, AND WHY THE LIST HAS THREE KINDS ON IT. ***
//
//   affiliate — their own rows. The original audience.
//   client    — a LIGHT AFFILIATE. ops/workflows/portal-rebuild-plan.md §4 is
//               owner-set: pressing "Refer a friend" in the portal gives a
//               client an affiliate code and access to this screen, while they
//               stay a client principal (see 340_client_light_affiliate.sql).
//               So a client with accounts.affiliate_id set is an affiliate for
//               the purposes of this read and nothing else.
//   staff     — may name an affiliate_id, to answer "what does this partner
//               see". Nobody else may.
//
// A NON-STAFF CALLER IS PINNED TO THEMSELVES. The affiliate_id comes from the
// session, never from the query string, which is the rule
// api/read/portal-summary.mjs:43-51 already applies to clients. A caller with no
// affiliate_id on their session gets `enrolled: false` and empty lists — the
// honest answer for somebody who has not pressed the button, and deliberately
// not a 403, because the screen has a real "not enrolled yet" state to show.
//
//
// *** MONEY THAT IS UNKNOWN STAYS UNKNOWN. ***
//
// affiliate_referrals.commission_due is numeric(14,2) and NULL means "not
// calculated" — either the referral has not converted, or it converted while no
// rule was in force. api/read/affiliates.mjs:47-57 records the same rule for the
// same column and states that COALESCE(commission_due, 0) must not appear in
// that file. It does not appear in this one either. A NULL is passed through as
// null and the screen prints a dash.
//
// These columns are dollars, not cents — they predate src/commissions/money.mjs
// and changing their type is a migration nobody asked for. They are passed
// through as numeric strings from pg, unrounded, and the screen formats them.
// Nothing here multiplies, divides or re-derives a rate; convert()
// (src/affiliates/economics.mjs) already did that once and froze the rule that
// produced it in rule_snapshot.
//
//
// *** THE TWO GATES ARE REPORTED, NOT ENFORCED HERE. ***
//
// This is a read. It changes no payout status and releases no hold. It reports
// what the database says about two conditions so the screen can explain a hold
// instead of showing a bare boolean:
//
//   license — affiliates.partner_license_signed_at. NULL = unsigned.
//   tax     — affiliates.tax_form_received_at (340_client_light_affiliate.sql).
//             NULL = NO RECORD, which is not the same as "not submitted". That
//             column is new and NOTHING WRITES IT YET, so it is null for
//             everybody today and the screen says "we have no record of" rather
//             than "you have not sent us". Whoever wires the tax-form upload
//             writes that column; until then this reports an absence, honestly.

import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { safeError } from "../../src/http/health.mjs";
import { shareUrlFor } from "../affiliates/refer.mjs";
import { offerLinksFor } from "../../src/affiliates/share-link.mjs";

const REFERRAL_LIMIT = 500;
const PAYOUT_LIMIT = 100;

/* THE RATE THE SCREEN SHOWS.
 *
 * Read from affiliate_commission_rules, never written here and never hardcoded.
 * 033_affiliates.sql:16-18: a NULL affiliate_id on a rule means "every
 * affiliate", a NULL product_id means "every product". So the org-wide rows
 * 261_affiliate_tier1_20pct_20260824.sql opened — 20% direct, 5% downline,
 * owner-set — already govern a brand-new affiliate with no rule of their own.
 *
 * THERE IS MORE THAN ONE LIVE RULE PER TIER, AND THAT IS NOT A BUG. Measured on
 * a freshly migrated database 2026-09-05: every rule carries a product_id, so
 * `direct` is TWO live rows — one for the funding product, one for the
 * optimisation product — and `downline` is two more. An earlier draft of this
 * query filtered on `product_id IS NULL` and matched nothing at all, which would
 * have shipped a rate tile reading "not set" to every affiliate on a schedule
 * the owner set three weeks ago.
 *
 * So every live rule for the tier is returned, and `percent` is filled in ONLY
 * when they all agree. When two products pay different rates there is no single
 * number to print, and this returns null rather than picking one — the screen
 * shows the spread. Same rule as everywhere else in this file: a value that
 * cannot be known is null, never a plausible substitute.
 *
 * A rule naming this affiliate is included alongside the org-wide ones and
 * marked, so the screen can say which of them is theirs specifically. */
const RATES_SQL = `
  SELECT r.tier, r.calc_method, r.percent, r.flat_amount, r.amount_basis,
         r.scope_rule, r.name, r.affiliate_id, p.name AS product_name
    FROM affiliate_commission_rules r
    LEFT JOIN products p ON p.id = r.product_id
   WHERE r.org_id = $1
     AND r.active
     AND r.tier IS NOT NULL
     AND (r.affiliate_id IS NULL OR r.affiliate_id = $2)
     AND r.effective_from <= now()
     AND (r.effective_to IS NULL OR r.effective_to > now())
   ORDER BY r.tier, (r.affiliate_id IS NOT NULL) DESC, r.effective_from DESC`;

const REFERRALS_SQL = `
  SELECT r.id,
         r.tier,
         r.status,
         r.attributed_at,
         r.converted_at,
         r.commission_due,
         r.basis_amount,
         r.tracking_id_used,
         c.first_name,
         c.last_name,
         p.name AS product_name
    FROM affiliate_referrals r
    JOIN clients  c ON c.id = r.client_id
    LEFT JOIN sales    s ON s.id = r.converting_sale_id
    LEFT JOIN products p ON p.id = s.product_id
   WHERE r.affiliate_id = $1
     AND r.org_id = $2
   ORDER BY r.attributed_at DESC
   LIMIT ${REFERRAL_LIMIT}`;

/* Payout lines are counted per run so the screen can say "3 referrals" against
   a total. count(*) over a joined table would multiply the payout row; a
   subquery cannot. */
const PAYOUTS_SQL = `
  SELECT po.id,
         po.period_start,
         po.period_end,
         po.amount,
         po.currency,
         po.status,
         po.hold_reason,
         po.method,
         po.paid_at,
         po.created_at,
         (SELECT count(*) FROM affiliate_payout_lines l
           WHERE l.payout_id = po.id) AS line_count
    FROM affiliate_payouts po
   WHERE po.affiliate_id = $1
     AND po.org_id = $2
   ORDER BY po.period_end DESC
   LIMIT ${PAYOUT_LIMIT}`;

const AFFILIATE_SQL = `
  SELECT id, name, tracking_id, status, tier_level, activated_at,
         partner_license_signed_at, partner_license_ref,
         tax_form_received_at, tax_form_ref,
         payout_method, payout_status, balance_due
    FROM affiliates
   WHERE id = $1 AND org_id = $2`;

/** A name for the person referred. NULL parts are dropped, never printed as
 *  "null null". An empty result stays empty and the screen says so. */
function personName(row) {
  return [row.first_name, row.last_name]
    .map((v) => (v == null ? "" : String(v).trim()))
    .filter(Boolean)
    .join(" ");
}

/** numeric(14,2) arrives from pg as a string. null must survive as null; only a
 *  value that is genuinely there is passed on. */
function numberOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* shapeTier — every live rule for one tier, plus the single percentage IF there
 * is one. See RATES_SQL's header for why "if". */
function shapeTier(rows) {
  if (!rows || !rows.length) return null;
  const rules = rows.map((r) => ({
    name: r.name,
    product: r.product_name || null,
    calcMethod: r.calc_method,
    percent: numberOrNull(r.percent),
    flatAmount: numberOrNull(r.flat_amount),
    amountBasis: r.amount_basis,
    scopeRule: r.scope_rule,
    // true when this rule was written for this affiliate rather than the org.
    mine: r.affiliate_id != null
  }));

  const percents = rules.map((r) => r.percent);
  const allPercent = rules.every((r) => r.calcMethod === "percent") && percents.every((p) => p != null);
  const agreed = allPercent && percents.every((p) => p === percents[0]);

  return {
    tier: rows[0].tier,
    // The one number, or null when the tier does not have one.
    percent: agreed ? percents[0] : null,
    percentMin: allPercent ? Math.min(...percents) : null,
    percentMax: allPercent ? Math.max(...percents) : null,
    rules
  };
}

export default async function handler(req, res, deps = {}) {
  if (req.method && req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const database = deps.db || db;
  const principal = await requirePrincipal(req, res, ["staff", "affiliate", "client"], { db: database });
  if (!principal) return;

  /* THE SECOND GATE MUST BE A SEPARATE CALL. requireAuth forwards its opts to
     authenticate(), which reads only { db, env } — a `roles` key there is
     silently dropped (CLAUDE.md §12, src/http/auth-gate.test.mjs). Non-staff
     principals are not role-gated; they are gated by the pinning below, which
     is stronger than any role set. */
  if (principal.kind === "staff"
      && !requireRole(res, principal.staff || { role: principal.role }, ROLE_SETS.STAFF)) {
    return;
  }

  const orgId = principal.orgId || null;
  if (!orgId) return res.status(400).json({ ok: false, error: "org_required" });

  /* WHOSE ROWS. A query parameter is read for STAFF ONLY. For anybody else the
     session decides and the parameter is ignored outright — not validated, not
     compared, ignored — so there is no branch where a crafted value could win. */
  let affiliateId = principal.affiliateId || null;
  if (principal.kind === "staff") {
    const asked = (req.query && (req.query.affiliate_id || req.query.affiliateId)) || null;
    if (asked) {
      if (!isUuid(asked)) return res.status(400).json({ ok: false, error: "invalid_affiliate_id" });
      affiliateId = asked;
    }
  }

  // NOT ENROLLED. A client who has never pressed "Refer a friend", or a staff
  // member who named nobody. Empty lists and a flag, not a refusal: the screen
  // has a real state for this and a 403 would send it to an error page instead.
  if (!affiliateId) {
    return res.status(200).json({
      ok: true, enrolled: false, affiliate: null,
      rates: { direct: null, downline: null },
      referrals: [], payouts: [], gates: null
    });
  }

  try {
    const [aff, rates, referrals, payouts] = await Promise.all([
      database.query(AFFILIATE_SQL, [affiliateId, orgId]),
      database.query(RATES_SQL, [orgId, affiliateId]),
      database.query(REFERRALS_SQL, [affiliateId, orgId]),
      database.query(PAYOUTS_SQL, [affiliateId, orgId])
    ]);

    const a = aff.rows[0];
    // The org clause above is the tenancy gate. An affiliate id that belongs to
    // another company reads as not found, exactly like one that does not exist.
    if (!a) return res.status(404).json({ ok: false, error: "not_found" });

    const byTier = {};
    for (const r of rates.rows) (byTier[r.tier] = byTier[r.tier] || []).push(r);

    return res.status(200).json({
      ok: true,
      enrolled: true,
      affiliate: {
        id: a.id,
        name: a.name,
        code: a.tracking_id,
        shareUrl: a.tracking_id ? shareUrlFor(a.tracking_id, deps.env || process.env) : null,
        // One row per offer on the affiliate page (owner call 2026-10-06).
        offerLinks: offerLinksFor(a.tracking_id),
        status: a.status,
        tierLevel: a.tier_level,
        activatedAt: a.activated_at,
        payoutMethod: a.payout_method,
        payoutStatus: a.payout_status,
        balanceDue: numberOrNull(a.balance_due)
      },
      rates: {
        direct: shapeTier(byTier.direct),
        downline: shapeTier(byTier.downline)
      },
      /* TWO GATES, EACH WITH ITS EVIDENCE. `signed`/`onFile` are booleans the
         screen can branch on; the timestamp and the reference are what let it
         explain itself and link to the document instead of showing a bare
         "false". A null ref means we hold no pointer to the paperwork — which
         is a different sentence from "unsigned", and the screen says so. */
      gates: {
        license: {
          signed: !!a.partner_license_signed_at,
          signedAt: a.partner_license_signed_at,
          documentRef: a.partner_license_ref || null
        },
        tax: {
          onFile: !!a.tax_form_received_at,
          receivedAt: a.tax_form_received_at,
          documentRef: a.tax_form_ref || null
        }
      },
      referrals: referrals.rows.map((r) => ({
        id: r.id,
        tier: r.tier,
        status: r.status,
        attributedAt: r.attributed_at,
        convertedAt: r.converted_at,
        name: personName(r),
        product: r.product_name || null,
        basisAmount: numberOrNull(r.basis_amount),
        // NULL survives. See the header: never 0, never a substituted figure.
        commissionDue: numberOrNull(r.commission_due),
        codeUsed: r.tracking_id_used || null
      })),
      payouts: payouts.rows.map((p) => ({
        id: p.id,
        periodStart: p.period_start,
        periodEnd: p.period_end,
        amount: numberOrNull(p.amount),
        currency: p.currency,
        status: p.status,
        holdReason: p.hold_reason || null,
        method: p.method || null,
        paidAt: p.paid_at,
        lineCount: Number(p.line_count || 0)
      }))
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
