// Affiliate economics — attribution, accrual, and tier unlocking.
//
// 033_affiliates.sql models the affiliate and the referral; it does not decide
// when money is earned. This is that decision, and only that: no migration, no
// new table, no rate written in code.
//
// FOUR RULES, and where each one actually lives.
//
// 1. FIRST TOUCH IS IMMUTABLE. Enforced by the database, not here: the unique
//    index affiliate_referrals_client_tier_uniq means one direct owner and one
//    downline owner per client, forever, and every write uses ON CONFLICT DO
//    NOTHING. That single statement is both replay-idempotent and incapable of
//    stealing an existing attribution. attribute() below relies on that rather
//    than checking first and inserting second, because a check-then-insert has a
//    race and this is somebody's commission.
//
// 2. ACCRUAL ON QUALIFIED COMPLETED OUTCOMES ONLY. Not on a payment, not on a
//    signup — on an outcome that actually completed:
//      a funded engagement          (funding_rounds.funded_amount > 0)
//      a completed repair enrolment (a paid repair product on the sale)
//      a paid $297 roadmap order    (diagnostic + paid slo_* payment_links row)
//      a Capital Blueprint sale     (consulting-package)
//    A $32 soft-pull diagnostic is not a roadmap sale. Idempotent per source event.
//
// 3. TIER 2 UNLOCKS on the FIRST funded referral OR the FIRST recruited
//    affiliate, whichever happens first, and unlocking is one-way. Once unlocked,
//    the recruiter earns a downline override on their recruits' conversions.
//
// 4. RATES ARE ROWS. Every amount comes from affiliate_commission_rules.
//    Owner-set 2026-08-24 (migrations 260–261): Tier 1 direct 20%, Tier 2 downline 5%.
//    Owner-set 2026-08-31 (migration 272): on FUNDING those same two rates now
//    apply to the partner's half of every non-refund payment on the sale, so an
//    affiliate earns on the 10% success fee and not only on the deposit. Rates
//    are versioned — 272 closes the deposit-basis rows and opens new ones; it
//    never UPDATEs a live percent.
//    This module still does not hardcode those numbers — it reads the rows.
//    With no rule in force, commission_due stays NULL, the balance stays zero and
//    nothing pays. `unrated` in the return value is how that stays visible rather
//    than looking like a zero-value conversion.
//
// WHERE THIS IS CALLED FROM. attribute() runs on the referral-capture workflow
// (src/workflows/af-02-referral-ownership-capture.mjs). convertSafe() runs from
// ensureSalePayment() in src/handlers/money-chain.mjs — the one place a
// sale_payments row is written, which is the one durable moment money is known to
// have arrived. Until 2026-08-31 nothing in production called convert() at all
// and no affiliate commission was ever accrued (W1-money-model.md finding F1).

// Which products count as which kind of completed outcome. Product CODES, matched
// against products.code, because routing on a dollar amount is how a price change
// silently re-routes an outcome.
import { toCents, fromCents, percentOf, applySplit } from "../commissions/money.mjs";

export const FUNDING_PRODUCT_CODES = ["card-stacking-dfy"];
export const REPAIR_PRODUCT_CODES = ["repair-bundle"];
/* Capital Blueprint ($5,000). Code only — never the dollar amount. */
export const BLUEPRINT_PRODUCT_CODES = ["consulting-package", "blueprint-self-funding"];

export const TIER = { ONE: "tier1", TWO: "tier2" };

/* attribute — record first touch. Idempotent and non-stealing by construction.

   Returns { attributed, referralId, reason }. attributed:false with
   reason "already_attributed" is the sticky rule working, not a failure. */
export async function attribute(db, {
  orgId, affiliateId, clientId, tier = "direct",
  trackingIdUsed = null, source = null, sourceEvent = null,
  attributedAt = new Date(), detail = {}
} = {}) {
  if (!orgId || !affiliateId || !clientId) {
    throw new Error("attribute: orgId, affiliateId and clientId are required");
  }
  if (tier !== "direct" && tier !== "downline") {
    throw new Error(`attribute: tier must be "direct" or "downline", got "${tier}"`);
  }

  const ins = await db.query(
    `INSERT INTO affiliate_referrals
       (org_id, affiliate_id, client_id, tier, tracking_id_used, attributed_at,
        source, source_event, detail, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'attributed')
     ON CONFLICT (client_id, tier) DO NOTHING
     RETURNING id`,
    [orgId, affiliateId, clientId, tier, trackingIdUsed, attributedAt,
     source, sourceEvent, JSON.stringify(detail)]
  );

  if (ins.rows[0]) {
    // A recruited affiliate's recruiter may now qualify for tier 2.
    return { attributed: true, referralId: ins.rows[0].id, reason: null };
  }

  const existing = await db.query(
    `SELECT id, affiliate_id FROM affiliate_referrals WHERE client_id = $1 AND tier = $2`,
    [clientId, tier]
  );
  const row = existing.rows[0];
  return {
    attributed: false,
    referralId: row ? row.id : null,
    reason: row && row.affiliate_id === affiliateId ? "already_attributed" : "owned_by_other",
    ownedBy: row ? row.affiliate_id : null
  };
}

/* attributeWithUpline — record the direct referral AND the downline one above it.

   THIS IS THE SECOND TIER. Before 2026-09-20 nothing in production ever called
   attribute() with tier "downline": the only callers were this file's own
   tests, so the 5% rate seeded by db/migrations/261_affiliate_tier1_20pct_20260824.sql
   was defined, tested and unreachable. Measured 2026-09-20 —
   `grep -rn "tier: *[\'\"]downline" src/ api/ scripts/` hit test files only.

   OWNER-SET 2026-09-20 — WHERE THE UPLINE COMES FROM. The downline credit goes
   to `affiliates.recruited_by` of the direct referrer. It is NOT read from the
   `a2` URL parameter. a2 lives in the address bar, so the person who profits
   from changing it is the person who can change it; recruited_by is written
   once, server-side, by api/affiliates/refer.mjs, from an attribution row that
   is immutable by trigger.

   af-02-referral-ownership-capture.mjs still mirrors a2 into
   clients.custom_fields.affiliate_tier2_owner. That stays as the CRM record of
   what the link claimed. It is not what gets paid.

   The direct result is returned unchanged, so a caller that only cares about
   tier 1 reads this exactly as it read attribute(). A downline that cannot be
   written is never an error: no recruiter, or a downline row already owned by
   somebody else, both mean there is nothing to pay and the direct attribution
   still stands. */
export async function attributeWithUpline(db, opts = {}) {
  const direct = await attribute(db, { ...opts, tier: "direct" });

  /* Only a NEW direct attribution opens the downline. A repeat call that hits
     "already_attributed" must not re-walk the chain — the downline row is
     already there from the first call, or was deliberately not written. */
  if (!direct.attributed) return { ...direct, downline: { attributed: false, reason: "direct_not_new" } };

  const { rows } = await db.query(
    `SELECT recruited_by FROM affiliates WHERE id = $1 AND org_id = $2`,
    [opts.affiliateId, opts.orgId]
  );
  const recruiter = rows[0] && rows[0].recruited_by;
  if (!recruiter) return { ...direct, downline: { attributed: false, reason: "no_recruiter" } };

  /* A recruiter cannot be their own downline. The database refuses a circular
     recruit chain (033_affiliates.sql:167-175) so this should be unreachable,
     but a self-referral would silently pay somebody twice for one sale, which
     is worth one comparison to rule out. */
  if (String(recruiter) === String(opts.affiliateId)) {
    return { ...direct, downline: { attributed: false, reason: "self_recruit" } };
  }

  const downline = await attribute(db, {
    ...opts,
    affiliateId: recruiter,
    tier: "downline",
    /* The tracking id used was the DIRECT referrer's. Carrying it here would
       claim the recruiter's own code was on the link, which it was not. */
    trackingIdUsed: null,
    detail: { ...(opts.detail || {}), viaAffiliateId: String(opts.affiliateId) }
  });

  return { ...direct, downline };
}

/* qualifyingOutcome — is this sale a completed outcome that earns commission?
   Returns { qualifies, kind, basis } or { qualifies: false, reason }.

   Routes on product CODE, never on amount. A funding engagement additionally
   requires a funded round: a signed deal that never funded is not an outcome. */
export async function qualifyingOutcome(db, { orgId, clientId, saleId } = {}) {
  if (!saleId) return { qualifies: false, reason: "no_sale" };

  const { rows } = await db.query(
    `SELECT s.id, s.client_id, p.code AS product_code
       FROM sales s
       LEFT JOIN products p ON p.id = s.product_id
      WHERE s.id = $1 AND s.org_id = $2`,
    [saleId, orgId]
  );
  const sale = rows[0];
  if (!sale) return { qualifies: false, reason: "sale_not_found" };

  const code = String(sale.product_code || "").trim().toLowerCase();

  if (FUNDING_PRODUCT_CODES.includes(code)) {
    // A funding sale earns only once money actually landed.
    const funded = await db.query(
      `SELECT 1 FROM funding_rounds
        WHERE client_id = $1 AND COALESCE(funded_amount, 0) > 0 LIMIT 1`,
      [sale.client_id]
    );
    if (!funded.rows[0]) return { qualifies: false, reason: "funding_not_completed" };
    return { qualifies: true, kind: "funded_engagement", productCode: code,
             clientId: sale.client_id };
  }

  if (REPAIR_PRODUCT_CODES.includes(code)) {
    return { qualifies: true, kind: "repair_enrolment", productCode: code,
             clientId: sale.client_id };
  }

  if (BLUEPRINT_PRODUCT_CODES.includes(code)) {
    return { qualifies: true, kind: "blueprint_sale", productCode: code,
             clientId: sale.client_id };
  }

  /* The $297 roadmap uses the same `diagnostic` product code as the $32
     soft-pull. A paid `slo_*` payment_links row is the order, not the amount. */
  if (code === "diagnostic") {
    const slo = await db.query(
      `SELECT 1 FROM payment_links
        WHERE org_id = $1
          AND client_id = $2
          AND link_ref LIKE 'slo_%'
          AND status = 'paid'
          AND COALESCE(is_demo, false) = false
        LIMIT 1`,
      [orgId, sale.client_id]
    );
    if (slo.rows[0]) {
      return { qualifies: true, kind: "slo_roadmap", productCode: code,
               clientId: sale.client_id };
    }
  }

  return { qualifies: false, reason: code ? `not_qualifying:${code}` : "no_product" };
}

/* findRule — the rate in force for (tier, product, affiliate), most specific
   first. Returns null when nothing matches. Owner-set defaults live in
   migration 261 (20% direct / 5% downline); a missing match must not invent a %. */
export async function findRule(db, {
  orgId, tier, productCode = null, affiliateId = null, asOf = new Date()
} = {}) {
  const { rows } = await db.query(
    `SELECT r.*, p.code AS product_code
       FROM affiliate_commission_rules r
       LEFT JOIN products p ON p.id = r.product_id
      WHERE r.org_id = $1
        AND (r.tier IS NULL OR r.tier = $2)
        AND (r.affiliate_id IS NULL OR r.affiliate_id = $3)
        AND (r.product_id IS NULL OR lower(btrim(p.code)) = $4)
        -- A retired rule must not keep paying. 033 carries both switches and
        -- ignoring them would let a deactivated or expired schedule accrue money
        -- nobody agreed to any more.
        AND r.active = true
        AND r.effective_from <= $5
        AND (r.effective_to IS NULL OR r.effective_to > $5)
      ORDER BY (r.affiliate_id IS NOT NULL) DESC,
               (r.product_id IS NOT NULL) DESC,
               (r.tier IS NOT NULL) DESC,
               r.effective_from DESC,
               r.created_at DESC
      LIMIT 1`,
    [orgId, tier, affiliateId, productCode ? String(productCode).toLowerCase() : null, asOf]
  );
  return rows[0] || null;
}

/* commissionFor — apply a rule to a basis. Pure, so the arithmetic is testable
   without a database. Returns null when there is no rule: a missing schedule must
   not become a zero-value conversion that looks settled. */
export function commissionFor(rule, basisAmount) {
  if (!rule) return null;
  const basis = Number(basisAmount || 0);
  if (rule.calc_method === "flat") {
    return { amount: fromCentsNumber(toCents(Number(rule.flat_amount || 0))), basis };
  }
  if (rule.calc_method === "percent") {
    /* INTEGER CENTS, not floats.

       This was `round2(basis * (percent / 100))`, where round2 was
       `Math.round((n + Number.EPSILON) * 100) / 100`. The EPSILON nudge is a
       no-op for any magnitude above 1 — EPSILON is relative to 1.0 — so
       near-tie products rounded DOWN and commission_due was persisted a cent
       short of what Postgres computes for the same expression. 15% of $1,010.10
       came out as 151.51 against an exact 151.52; the float path disagreed with
       exact half-up on 12 of 2730 realistic (price, percent) pairs.

       That matters more here than it looks: affiliate_commission_rules freezes
       rule_snapshot at conversion and nothing recalculates the accrual, so the
       wrong cent is permanent and the statement disagrees with any spreadsheet.

       src/commissions/money.mjs already does this exactly, and is what the
       commission ledger uses. Using it here removes the second, worse
       implementation rather than adding a third. */
    return {
      amount: fromCentsNumber(percentOf(toCents(basis), Number(rule.percent || 0))),
      basis
    };
  }
  return null;
}

/* money.mjs returns cents; this module's callers and the numeric(14,2) columns
   want a dollar Number. fromCents gives a fixed 2dp STRING, which is the right
   shape for display but not for arithmetic, so parse it back exactly once here. */
function fromCentsNumber(cents) {
  return Number(fromCents(cents));
}

/* THE PARTNER'S HALF, as a basis. 272_affiliate_success_fee_share adds
   'partner_share_of_cash' to the amount_basis enum, so this is the code change
   033's note says an enum value costs.

   WHAT IT IS. Every non-refund payment on the sale — the funding deposit AND the
   10% success fee that lands months later — multiplied by the partner's own
   revenue_share_pct. Owner-set 2026-08-31 (docs/specs/W0-decisions.md, "Affiliates
   earn on the back end"): a sub-affiliate is paid out of the PARTNER'S half, so
   the partner's half is what their rate applies to, and fundhub's 50% cannot move
   however many people sit under the partner:

     $12,000 collected → partner half $6,000 → tier 1 20% = $1,200
                                             → tier 2  5% =   $300
     fundhub keeps $6,000, every time.

   WHEN THERE IS NO PARTNER. A fundhub-direct client has no partner half to take
   from — fundhub owns the whole of that cash and pays its own affiliate out of
   it — so the basis is the cash in full. That is a real change for the direct
   book: the schedule used to pay on the deposit alone and now pays on everything
   collected, which is exactly the owner decision, applied to everyone.

   WHEN THE PARTNER CANNOT BE READ. A client naming a partner this query cannot
   reach (deleted, or another org) is UNKNOWN, and unknown is null — never zero
   and never the undiluted cash. convert() leaves commission_due NULL, and
   unratedConversions() lists it.

   KNOWN LIMIT, RECORDED NOT HIDDEN. A referral converts ONCE (033's design: one
   status flip, one frozen rule_snapshot, scope_rule 'first_paid_product'), so
   this basis is whatever had been collected at that moment. A success fee paid
   in one go is the whole fee and the affiliate is paid on all of it. A success
   fee paid in three instalments converts on the first one, and the two after it
   do not raise the commission — the partner accrues 50% of each instalment, the
   affiliate does not. Making the affiliate follow every instalment means
   re-opening a converted referral, which is the one thing the frozen snapshot
   exists to prevent, so it is an owner decision and not a code fix. */
const SQL_PARTNER_SHARE_OF_CASH = `
  SELECT COALESCE(sum(sp.amount) FILTER (WHERE sp.kind <> 'refund'), 0) AS cash,
         c.partner_id           AS partner_id,
         pt.revenue_share_pct   AS share_pct
    FROM sales s
    JOIN clients c ON c.id = s.client_id AND c.org_id = s.org_id
    LEFT JOIN partners pt ON pt.id = c.partner_id AND pt.org_id = s.org_id
    LEFT JOIN sale_payments sp ON sp.sale_id = s.id AND sp.org_id = s.org_id
   WHERE s.id = $1
   GROUP BY c.partner_id, pt.revenue_share_pct`;

async function partnerShareOfCash(db, saleId) {
  const { rows } = await db.query(SQL_PARTNER_SHARE_OF_CASH, [saleId]);
  const row = rows[0];
  if (!row) return 0;                       // no such sale — same answer the other bases give

  const cashCents = toCents(row.cash);
  if (row.partner_id == null) return fromCentsNumber(cashCents);

  if (row.share_pct === null || row.share_pct === undefined) return null;
  const pct = Number(row.share_pct);
  if (!Number.isFinite(pct)) return null;
  // applySplit refuses a split of zero. A partner on 0% has no half, which is an
  // answer, not a crash.
  if (pct <= 0) return 0;
  return fromCentsNumber(applySplit(cashCents, pct));
}

/* basisFor — what the rate applies to. The enum is a formula per value and is
   NOT admin-editable (033's note); adding one is a code change.

   Returns a dollar Number, or null when the formula's inputs are genuinely
   unknown. null is NOT zero: convert() must not turn it into a settled $0. */
export async function basisFor(db, { amountBasis, saleId } = {}) {
  const one = async (sql, params) => {
    const { rows } = await db.query(sql, params);
    return rows[0] ? Number(rows[0].v || 0) : 0;
  };
  switch (amountBasis) {
    // The column is agreed_price (011_sales.sql), not price. 013/033 call the
    // basis "sale_price"; that is the enum value, not the column name.
    case "sale_price":
      return one(`SELECT agreed_price AS v FROM sales WHERE id = $1`, [saleId]);
    case "deposit_collected":
      return one(`SELECT COALESCE(sum(amount),0) AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind = 'deposit'`, [saleId]);
    case "cash_collected":
      return one(`SELECT COALESCE(sum(amount),0) AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind <> 'refund'`, [saleId]);
    case "first_payment":
      return one(`SELECT amount AS v FROM sale_payments
                   WHERE sale_id = $1 AND kind <> 'refund'
                   ORDER BY created_at ASC LIMIT 1`, [saleId]);
    case "partner_share_of_cash":
      return partnerShareOfCash(db, saleId);
    default:
      throw new Error(`basisFor: unknown amount_basis "${amountBasis}"`);
  }
}

/* convert — the accrual. Marks a referral converted and records the commission,
   idempotently.

   Returns { converted, unrated, commissionDue, reason }. `unrated: true` means the
   conversion is real but no rule matched, so commission_due stays NULL —
   surfaced rather than defaulted to zero. */
export async function convert(db, {
  orgId, clientId, saleId, sourceEventId = null, now = new Date()
} = {}) {
  const outcome = await qualifyingOutcome(db, { orgId, clientId, saleId });
  if (!outcome.qualifies) return { converted: false, reason: outcome.reason };

  /* The money chain knows the sale, not the client. sales.client_id is NOT NULL
     and qualifyingOutcome has already read it, so the sale is both the cheaper
     and the safer answer than resolving the client a second time from the event
     — resolveClient() CREATES a client when it cannot find one, and a commission
     writer must never mint one. */
  const forClientId = clientId || outcome.clientId || null;
  if (!forClientId) return { converted: false, reason: "no_client" };

  const refs = await db.query(
    `SELECT id, affiliate_id, tier, status FROM affiliate_referrals
      WHERE client_id = $1 AND status IN ('attributed', 'converted')`,
    [forClientId]
  );
  if (!refs.rows.length) return { converted: false, reason: "no_attribution" };

  const results = [];
  for (const ref of refs.rows) {
    // Already converted: idempotent no-op. The event may be a replay.
    if (ref.status === "converted") {
      results.push({ referralId: ref.id, tier: ref.tier, converted: false,
                     reason: "already_converted" });
      continue;
    }

    // A downline override only pays if the recruiter has actually unlocked tier 2.
    if (ref.tier === "downline") {
      const up = await db.query(
        `SELECT tier_level FROM affiliates WHERE id = $1`, [ref.affiliate_id]);
      if (!up.rows[0] || up.rows[0].tier_level !== TIER.TWO) {
        results.push({ referralId: ref.id, tier: ref.tier, converted: false,
                       reason: "recruiter_not_tier2" });
        continue;
      }
    }

    const rule = await findRule(db, {
      orgId, tier: ref.tier, productCode: outcome.productCode, affiliateId: ref.affiliate_id
    });
    let due = null, basis = null, snapshot = {};
    if (rule) {
      basis = await basisFor(db, { amountBasis: rule.amount_basis, saleId });
      /* A null basis is UNKNOWN. commissionFor would read it as Number(null) = 0
         and hand back a settled $0 commission, which looks exactly like a
         correct answer. Leaving commission_due NULL keeps it in
         unratedConversions() where somebody sees it. */
      const c = basis == null ? null : commissionFor(rule, basis);
      due = c ? c.amount : null;
      snapshot = {
        rule_name: rule.name, calc_method: rule.calc_method,
        percent: rule.percent, flat_amount: rule.flat_amount,
        amount_basis: rule.amount_basis
      };
    }

    await db.query(
      `UPDATE affiliate_referrals
          SET status = 'converted',
              converted_at = COALESCE(converted_at, $2),
              converting_sale_id = COALESCE(converting_sale_id, $3),
              commission_due = $4,
              basis_amount = $5,
              rule_id = $6,
              rule_snapshot = $7,
              updated_at = now()
        WHERE id = $1 AND status = 'attributed'`,
      [ref.id, now, saleId, due, basis, rule ? rule.id : null, JSON.stringify(snapshot)]
    );

    results.push({
      referralId: ref.id, tier: ref.tier, affiliateId: ref.affiliate_id,
      // unrated is "commission_due came out NULL" — no rule matched, OR the
      // rule's basis was unknown. It is the same condition unratedConversions()
      // selects on, so the flag and the report can never disagree.
      converted: true, unrated: due === null, commissionDue: due, basisAmount: basis
    });
  }

  // A funded referral may unlock the direct affiliate's tier 2.
  const unlocked = [];
  if (outcome.kind === "funded_engagement") {
    for (const r of results.filter((x) => x.converted && x.tier === "direct")) {
      const u = await maybeUnlockTier2(db, { orgId, affiliateId: r.affiliateId, now });
      if (u.unlocked) unlocked.push(r.affiliateId);
    }
  }

  return {
    converted: results.some((r) => r.converted),
    kind: outcome.kind,
    unrated: results.some((r) => r.converted && r.unrated),
    results,
    tier2Unlocked: unlocked
  };
}

/** One greppable prefix for a conversion that fell over. */
export const CONVERT_FAILED = "[affiliate-economics] conversion failed";

/* convertSafe — the money chain's entry point. Identical to convert() except
   that it cannot throw.

   An affiliate conversion failing must never stop fundhub from recording that
   money arrived: the payment row and the partner's half are the load-bearing
   writes, and this rides behind both. Same shape and same reason as
   accrueForPaymentSafe in src/partners/revenue.mjs. convert() is idempotent, so
   a failure here is re-drivable from the same sale with no double-pay risk. */
export async function convertSafe(db, args = {}) {
  try {
    return await convert(db, args);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(
      `${CONVERT_FAILED}: ${msg} ` +
      `(org=${args.orgId || "?"} sale=${args.saleId || "?"}). ` +
      `The payment is recorded; the conversion can be re-driven from the same ` +
      `sale, which is idempotent.`
    );
    return { converted: false, reason: "convert_error", error: msg };
  }
}

/* maybeUnlockTier2 — tier 2 opens on the FIRST funded referral OR the FIRST
   recruited affiliate, whichever comes first. One-way: it never re-locks, because
   a downline that was earning cannot stop mid-relationship. */
export async function maybeUnlockTier2(db, { orgId, affiliateId, now = new Date() } = {}) {
  if (!affiliateId) return { unlocked: false, reason: "no_affiliate" };

  const cur = await db.query(
    `SELECT tier_level, tier2_unlocked_at FROM affiliates WHERE id = $1`, [affiliateId]);
  if (!cur.rows[0]) return { unlocked: false, reason: "not_found" };
  if (cur.rows[0].tier_level === TIER.TWO) {
    return { unlocked: false, reason: "already_tier2" };
  }

  const funded = await db.query(
    `SELECT 1 FROM affiliate_referrals r
       JOIN funding_rounds f ON f.client_id = r.client_id
      WHERE r.affiliate_id = $1 AND r.tier = 'direct'
        AND r.status IN ('converted', 'paid')
        AND COALESCE(f.funded_amount, 0) > 0
      LIMIT 1`, [affiliateId]);

  const recruited = await db.query(
    `SELECT 1 FROM affiliates WHERE recruited_by = $1 LIMIT 1`, [affiliateId]);

  const reason = funded.rows[0] ? "funded_referral"
               : recruited.rows[0] ? "recruited_affiliate" : null;
  if (!reason) return { unlocked: false, reason: "no_qualifying_event" };

  await db.query(
    `UPDATE affiliates
        SET tier_level = $2, tier2_unlocked_at = COALESCE(tier2_unlocked_at, $3),
            updated_at = now()
      WHERE id = $1 AND tier_level <> $2`,
    [affiliateId, TIER.TWO, now]
  );
  return { unlocked: true, reason };
}

/* voidReferral — disqualify or claw back. Excluded from the balance by 033's
   derived state; the row is kept. */
export async function voidReferral(db, { referralId, reason } = {}) {
  if (!reason) throw new Error("voidReferral: a reason is required");
  const { rows } = await db.query(
    `UPDATE affiliate_referrals
        SET status = 'void', void_reason = $2, updated_at = now()
      WHERE id = $1 AND status <> 'paid'
      RETURNING id, status`,
    [referralId, reason]
  );
  return rows[0] || null;
}

/* unratedConversions — conversions that earned nothing because no rule matched.
   With migration 260 seeded, this should stay empty for normal funding/repair
   outcomes; it still surfaces gaps if a product or org has no rule. */
export async function unratedConversions(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT r.id, r.affiliate_id, r.client_id, r.tier, r.converted_at
       FROM affiliate_referrals r
      WHERE r.org_id = $1 AND r.status = 'converted' AND r.commission_due IS NULL
      ORDER BY r.converted_at DESC`,
    [orgId]
  );
  return rows;
}
