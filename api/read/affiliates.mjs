// GET /api/read/affiliates — affiliates with derived balance and tier state from 033's view
//
// Read-only. Auth + role gate + pagination + redaction all come from
// src/http/read-api.mjs; this file is its SQL and nothing else. See that module
// for why the role default is deny and what redact() strips.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// T10-04 — THE FOUR NUMBERS ON THE AFFILIATE SCREEN
//
// public/app/affiliate.html shows REFERRED / CLICKS / CONVERTED / PAID and every
// one of them was an em dash, because this endpoint returned none of them. It
// now does. Nothing about WHO may call this changed — the screen already made
// this exact request and painted OWED from it; these are extra columns on a
// read that already happens, not a new door.
//
//
// *** REFERRALS ARE COUNTED FROM TWO SOURCES, AND THAT IS NOT BELT-AND-BRACES. ***
//
// There are two records of "who referred this client" and they disagree:
//
//   affiliate_referrals    — 033_affiliates.sql's structured model.
//   clients.custom_fields  — where the LIVE capture actually writes.
//                            src/workflows/af-02-referral-ownership-capture.mjs
//                            sets custom_fields.affiliate_tier1_owner and has
//                            never written an affiliate_referrals row.
//
// 033 backfilled the second into the first ONCE, when it ran. Every referral
// captured since that moment exists only in custom_fields. So counting
// affiliate_referrals alone would report a number that stopped growing the day
// that migration finished — a lie dressed up as a measurement, which is worse
// than the dash it replaced. Both sources are counted and de-duplicated by
// client.
//
// `referred_untracked` is how many of those referrals exist ONLY in
// custom_fields, with no referral row crediting this affiliate. Those clients
// have never been near the conversion path, so their conversion state and their
// money are genuinely UNKNOWN. The screen says so rather than folding them into
// a conversion rate that would then be wrong.
//
// The upstream defect — af-02 writing custom_fields instead of a referral row —
// is reported on the board. It is not fixed here; that file belongs to another
// thread.
//
//
// *** MONEY THAT IS UNKNOWN STAYS UNKNOWN. ***
//
// affiliate_referrals.commission_due is numeric(14,2) and NULL means "not
// calculated" — either not converted, or converted with no matching rule.
// Owner-set schedule (migration 261, 2026-08-24): Tier 1 20% / Tier 2 5%.
// A conversion with no matching rule is still counted in converted_count; its
// money is counted nowhere. `unrated_converted_count` carries that NULL to the
// screen. COALESCE(commission_due, 0) does not appear in this file and must not.
//
// PAID is a different kind of number and a real zero when it is zero:
// affiliate_payout_lines.amount is NOT NULL, so a settled total is always
// computable. `paid_runs` tells the screen whether any run has ever settled, so
// it can say "no payout run has settled yet" instead of a bare, unexplained $0.
//
// TIER. referred_count and converted_count are DIRECT referrals only — people
// who used this affiliate's own link. A 'downline' row is credit flowing up from
// a recruit's referral; it is somebody else's lead and counting it here would
// overstate this affiliate's own reach. Downline money is not lost: balance_due
// (OWED) is 033's rollup and covers every non-void tier.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";

export const run = readHandler({
  roles: ROLE_SETS.FINANCE,
  principals: new Set(["affiliate", "client"]),
  // Staff see the org roster. An affiliate session sees only their own row.
  // The org filter binds the CALLER's org, not orgs.is_default.
  fetch: (db, { limit, offset, query, staff, principal }) => {
    // A client enrolled through /affiliates/refer keeps kind=client. Their
    // persisted affiliateId grants the same SELF read, never the staff roster.
    const isAffiliate = Boolean(principal && (principal.kind === "affiliate" || principal.kind === "client"));
    if (isAffiliate && !principal.affiliateId) return Promise.resolve([]);
    const orgId = isAffiliate
      ? (principal.orgId || null)
      : ((staff && staff.org_id) || null);
    const selfId = isAffiliate ? principal.affiliateId : null;
    return db.query(`SELECT a.id, a.name, a.status, a.tracking_id, a.tier_level, a.tier2_unlocked_at,
           a.recruited_by, a.direct_downline_count, a.balance_due, a.payout_status,
           (a.partner_license_signed_at IS NOT NULL) AS license_signed,
           a.created_at,
           ref.referred_count,
           ref.referred_untracked,
           conv.converted_count,
           conv.unrated_converted_count,
           clk.clicks_count,
           clk.clicks_30d,
           pay.paid_total,
           (SELECT COUNT(*)::int FROM affiliate_payouts p
             WHERE p.affiliate_id = a.id AND p.org_id = a.org_id
               AND p.status = 'paid') AS paid_runs
      FROM affiliates a
      -- REFERRED. Both sources, de-duplicated by client. bool_or() collapses a
      -- client that appears in BOTH down to one row that counts as tracked,
      -- which is why this groups before it counts instead of using a bare UNION.
      --
      -- ONE CLIENT, ONE OWNER. 033's affiliate_referrals_client_tier_uniq makes
      -- the direct referral row unique per client across the whole table, so a
      -- client with a direct row has exactly one direct owner and it is not up
      -- for debate. The code sitting in custom_fields can disagree with that row
      -- — it is the older, unguarded record, and a corrected attribution leaves
      -- the stale code behind. Without the NOT EXISTS below, such a client was
      -- counted for BOTH affiliates: once from the referral row that credits the
      -- real owner, once from the stale code that credits the other one. The
      -- referral row wins, because it is the one the database protects. The
      -- custom_fields arm only ever adds clients no direct referral row claims.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int                              AS referred_count,
               COUNT(*) FILTER (WHERE NOT u.tracked)::int AS referred_untracked
          FROM (
            SELECT s.cid, bool_or(s.tracked) AS tracked
              FROM (
                SELECT r.client_id AS cid, true AS tracked
                  FROM affiliate_referrals r
                 WHERE r.affiliate_id = a.id
                   AND r.org_id = a.org_id
                   AND r.tier = 'direct'
                UNION ALL
                -- The live capture's own key. Matched case-insensitively on the
                -- tracking id, exactly the way 033's backfill matched it.
                SELECT c.id, false
                  FROM clients c
                 WHERE c.org_id = a.org_id
                   AND a.tracking_id IS NOT NULL
                   AND upper(btrim(c.custom_fields->>'affiliate_tier1_owner'))
                       = upper(a.tracking_id)
                   -- Somebody already owns this client. Do not claim them again.
                   AND NOT EXISTS (
                     SELECT 1 FROM affiliate_referrals dr
                      WHERE dr.client_id = c.id
                        AND dr.tier = 'direct')
              ) s
             GROUP BY s.cid
          ) u
      ) ref ON true
      -- CONVERTED, and how many of those carry no rate. 'paid' is a converted
      -- referral a payout run has since settled, so it counts as converted too.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int                                        AS converted_count,
               COUNT(*) FILTER (WHERE r.commission_due IS NULL)::int AS unrated_converted_count
          FROM affiliate_referrals r
         WHERE r.affiliate_id = a.id
           AND r.org_id = a.org_id
           AND r.tier = 'direct'
           AND r.status IN ('converted', 'paid')
      ) conv ON true
      -- CLICKS. Only clicks whose code RESOLVED to this affiliate. A click on a
      -- dead code is stored with affiliate_id NULL and belongs to nobody.
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS clicks_count,
               COUNT(*) FILTER (
                 WHERE k.occurred_at >= now() - interval '30 days')::int AS clicks_30d
          FROM affiliate_link_clicks k
         WHERE k.affiliate_id = a.id
           AND k.org_id = a.org_id
      ) clk ON true
      -- PAID. Settled runs only. Lines carry their own sign — a clawback is
      -- negative — so this is the net amount that actually left.
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(l.amount), 0) AS paid_total
          FROM affiliate_payouts p
          JOIN affiliate_payout_lines l ON l.payout_id = p.id
         WHERE p.affiliate_id = a.id
           AND p.org_id = a.org_id
           AND p.status = 'paid'
      ) pay ON true
     WHERE a.org_id = $4::uuid
       AND ($3::text IS NULL OR a.status = $3)
       AND ($5::uuid IS NULL OR a.id = $5)
     ORDER BY a.created_at DESC
     LIMIT $1 OFFSET $2`,
      [limit + 1, offset, query.status || null, orgId, selfId]).then((r) => r.rows);
  }
});

export default (req, res) => run(req, res, { db, requireAuth, requirePrincipal });
