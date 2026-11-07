// @ts-check
// Partner revenue — the accrual writer. W1-money-model.md §7, finding F1.
//
// WHAT THIS FIXES. Until this file existed, nothing in production ever wrote a
// partner_revenue row. The only rows on record came from a test fixture in
// scope.pg.test.mjs, so a white-label partner's half was hand arithmetic on a
// spreadsheet. The schema to do it properly has been in place since
// db/migrations/042_partners.sql; this is the missing wire, and nothing else.
//
// THE FIVE RULES, and where each one is actually enforced.
//
// 1. THE PARTNER'S HALF IS HALF OF CASH THAT ARRIVED, never half of the sticker
//    price. Some of what fundhub sells is financed, and a weak-credit lender
//    remits as little as 30% of the contract. Half of sticker on a 30% remittance
//    pays the partner more money than the deal brought in — fundhub goes negative
//    on a sale that looked profitable. So the base is one sale_payments row's
//    settled `amount`, never sales.agreed_price. One payment row in, one accrual
//    row out. (W1 §1.)
//
// 2. THE RATE IS FROZEN ON THE ROW. share_pct_applied is copied off the partner
//    at the instant of accrual and never revisited. Moving a partner from 50 to
//    20 changes what LATER accruals compute and touches nothing already written,
//    which is the entire reason 042 has that column. No percentage for the
//    partner share is written in this file — it is read from partners.
//
// 3. E-PRODUCTS ARE EXCLUDED BY AN ALLOW-LIST, NOT A DENY-LIST. Courses and
//    digital products stay 100% fundhub (W0-decisions.md). A deny-list means the
//    next course somebody adds quietly starts paying out 50%; an allow-list means
//    it defaults to excluded and somebody has to opt it in on purpose.
//
// 4. IDEMPOTENCY IS THE DATABASE'S JOB. 042 carries two partial unique indexes,
//    on (org_id, source_event_id, partner_id) and (org_id, transaction_id,
//    partner_id). Both columns are set whenever both are known and the INSERT
//    carries a bare ON CONFLICT DO NOTHING, which in Postgres covers every unique
//    index on the table. A replayed event and a re-run backfill both land on the
//    same row. Zero rows affected is a SUCCESSFUL no-op, not an error.
//
// 5. REVERSAL IS A VOID WITH A REASON. partner_revenue has a trigger that raises
//    on DELETE and CHECKs that forbid a negative amount, so a refund cannot be
//    expressed as a negative row and money already earned cannot be made to
//    disappear. NO CLAWBACK: owner-set, a reversal after payout is fundhub's
//    loss, recorded and not recovered from the partner.
//    WIRED 2026-08-31: voidForRefund() was built, tested, and called by nothing,
//    so a refund left the partner's accrual standing as if the money were still
//    here. src/handlers/money-chain.mjs now drives it from payment.refunded and
//    payment.disputed. Nothing in this file chases the partner for the money.
//
// WHY resolveClient() IS NOT CALLED HERE. It is the right function for turning a
// bus event into a client, and the money chain already calls it upstream — but it
// CREATES a client row when it cannot find one. An accrual writer must never
// mint a client. By the time a sale_payments row exists the client is already
// resolved and pinned on sales.client_id, which is NOT NULL, so the sale row is
// both the cheaper and the safer source of truth.
//
// COMPLIANCE REVIEW REQUIRED: fee/commission timing and payout basis.

import { toCents, fromCents, applySplit, percentOf } from "../commissions/money.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

/* THE ALLOW-LIST. products.code values that share revenue with a partner.
   Anything not named here — every course, every digital product, the $32 soft
   pull, the consulting package — accrues nothing. Adding a product to this list
   is a commercial decision, so it is made once, here, in the open. */
export const PARTNER_SHARE_PRODUCT_CODES = Object.freeze([
  "card-stacking-dfy", // funding, done-for-you: the $3,000 deposit and the 10% back end
  "repair-bundle",     // credit repair, done-for-you
  "repair-trial"       // the repair test run
]);

const SHARED_CODES = new Set(PARTNER_SHARE_PRODUCT_CODES);

/** sale_payments.kind values that produce an accrual. 'refund' is deliberately
 *  absent — a refund voids, it does not accrue. See voidForRefund. */
const ACCRUABLE_KINDS = new Set(["deposit", "installment", "success_fee"]);

/* THE RECRUIT BONUS (W0-decisions.md, W1 §5/D7). A partner who brings a partner
   is owed 20% of the $30,000 entry fee — $6,000, once, nothing ongoing. It is a
   fixed number set against the STICKER, not against what the lender remitted:
   the remittance varies by credit band, the promise does not.
   owner-set 2026-11-07: the entry fee is $30,000 (src/config/offers.mjs
   PARTNER_ENTRY) and the formula stays 20% of it, so the bonus is $6,000. It
   was $2,000 on the $10,000 entry. */
export const ENTRY_FEE_CENTS = 3_000_000;
export const RECRUIT_BONUS_PCT = 20;

/** One greppable prefix per refusal that costs somebody money. */
export const ACCRUAL_REFUSED = "[partner-revenue] accrual refused";
export const ACCRUAL_FAILED = "[partner-revenue] accrual failed";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} v */
function asUuid(v) {
  if (v == null) return null;
  const s = String(v);
  return UUID_RE.test(s) ? s : null;
}

/** @param {string} reason */
function refuse(reason) {
  return { accrue: false, reason, grossCents: null, shareCents: null, sharePct: null };
}

/**
 * Is this product code one a partner earns on? Codes are compared lower-cased
 * and trimmed because products.code is written by hand in migrations.
 * @param {unknown} productCode
 */
export function sharesWithPartner(productCode) {
  if (productCode == null) return false;
  return SHARED_CODES.has(String(productCode).trim().toLowerCase());
}

/**
 * PURE. Decide whether one settled payment accrues to a partner, and for how
 * much. No database, no clock. Everything the lookup found comes in as
 * arguments so the whole decision is testable without Postgres.
 *
 * `amount` is the sale_payments.amount as Postgres hands it over — a numeric
 * arrives as a STRING. null/undefined mean UNKNOWN and must survive as unknown:
 * toCents() maps them to 0, which would silently write a $0 accrual and call a
 * broken payment a settled one, so they are caught before toCents is reached.
 *
 * @returns {{accrue: boolean, reason: string|null, grossCents: number|null,
 *            shareCents: number|null, sharePct: number|null}}
 */
export function computeAccrual({
  partnerId = null, kind = null, productCode = null, amount = null, sharePct = null
} = {}) {
  if (!partnerId) return refuse("no_partner");
  if (kind === "refund") return refuse("refund_not_accrued");
  if (!ACCRUABLE_KINDS.has(String(kind))) return refuse("kind_not_accruable");

  // An unresolvable product is not an excluded product, and the two must not
  // share a reason code — one is a routing bug, the other is the rule working.
  if (productCode == null || String(productCode).trim() === "") return refuse("unknown_product");
  if (!sharesWithPartner(productCode)) return refuse("product_excluded");

  if (amount === null || amount === undefined || amount === "") return refuse("unknown_amount");

  // NULL is UNKNOWN, and Number(null) is 0 — which would quietly reclassify a
  // missing rate as "this partner earns nothing" and look like a correct answer.
  if (sharePct === null || sharePct === undefined || sharePct === "") return refuse("unknown_share_pct");
  const pct = Number(sharePct);
  if (!Number.isFinite(pct)) return refuse("unknown_share_pct");
  if (pct > 100) return refuse("share_pct_out_of_range");
  // applySplit throws on a split of zero. A partner on 0% earns nothing, which
  // is an answer, not a crash.
  if (pct <= 0) return refuse("zero_share_pct");

  const grossCents = toCents(amount);
  // No base, no commission — the same call clampAmount() in money.mjs already
  // makes. A zero-value payment is not cash arriving.
  if (grossCents <= 0) return refuse("zero_amount");

  return {
    accrue: true,
    reason: null,
    grossCents,
    shareCents: applySplit(grossCents, pct),
    sharePct: pct
  };
}

/**
 * PURE. The recruit bonus in cents. Percent units — 20 means 20%.
 * @returns {{grossCents: number, sharePct: number, shareCents: number}}
 */
export function computeRecruitBonus({
  entryFeeCents = ENTRY_FEE_CENTS, bonusPct = RECRUIT_BONUS_PCT
} = {}) {
  if (!Number.isInteger(entryFeeCents) || entryFeeCents <= 0) {
    throw new RangeError(`computeRecruitBonus: entryFeeCents must be positive cents: ${entryFeeCents}`);
  }
  return {
    grossCents: entryFeeCents,
    sharePct: Number(bonusPct),
    shareCents: percentOf(entryFeeCents, bonusPct)
  };
}

/* Everything the accrual needs, in one round trip. The joins carry org_id on
   every hop so a payment can never reach a partner in another org. */
const SQL_PAYMENT_CONTEXT = `
  SELECT sp.id             AS payment_id,
         sp.sale_id        AS sale_id,
         sp.kind           AS kind,
         sp.amount         AS amount,
         sp.paid_at        AS paid_at,
         sp.transaction_id AS transaction_id,
         sp.source_event_id AS source_event_id,
         s.client_id       AS client_id,
         s.currency        AS currency,
         c.partner_id      AS partner_id,
         pr.code           AS product_code,
         pt.revenue_share_pct AS revenue_share_pct
    FROM sale_payments sp
    JOIN sales   s ON s.id = sp.sale_id  AND s.org_id = sp.org_id
    JOIN clients c ON c.id = s.client_id AND c.org_id = sp.org_id
    LEFT JOIN products pr ON pr.id = sp.product_id
    LEFT JOIN partners pt ON pt.id = c.partner_id AND pt.org_id = sp.org_id
   WHERE sp.id = $1 AND sp.org_id = $2
   LIMIT 1`;

const SQL_INSERT_ACCRUAL = `
  INSERT INTO partner_revenue
    (org_id, partner_id, client_id, transaction_id, source_event_id,
     gross_amount, share_pct_applied, share_amount, currency, status, occurred_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'accrued',$10)
  ON CONFLICT DO NOTHING
  RETURNING id, gross_amount, share_pct_applied, share_amount, occurred_at`;

/** partner_revenue.source_event_id carries a real FK to events(id); sale_payments'
 *  copy of it deliberately does not (137_money_chain_idempotency.sql). So a
 *  handler driven by a replayer or a test can hold an event id with no events
 *  row behind it, and inserting that would fail the whole accrual on a foreign
 *  key. Check first and fall back to the transaction key instead of losing the
 *  row. */
async function eventRowExists(db, id) {
  if (!id) return false;
  const { rows } = await db.query(`SELECT 1 FROM events WHERE id = $1 LIMIT 1`, [id]);
  return !!rows[0];
}

async function transactionRowExists(db, id) {
  if (!id) return false;
  const { rows } = await db.query(`SELECT 1 FROM transactions WHERE id = $1 LIMIT 1`, [id]);
  return !!rows[0];
}

/**
 * Resolve the pair of idempotency keys the two partial unique indexes stand on.
 * Both are set whenever both are known; a row with neither is refused, because
 * it would be re-inserted in full on every replay.
 */
async function resolveKeys(db, { transactionId, sourceEventId }) {
  let txId = asUuid(transactionId);
  if (txId && !(await transactionRowExists(db, txId))) txId = null;
  let evId = asUuid(sourceEventId);
  if (evId && !(await eventRowExists(db, evId))) evId = null;
  return { txId, evId };
}

/**
 * Write one partner_revenue row for one settled sale_payments row, or say why
 * it wrote nothing.
 *
 * Returns { accrued, reason, ... }. accrued:false with reason "already_accrued"
 * is the replay guard working, not a failure — and neither is "no_partner",
 * which is simply a direct fundhub client.
 *
 * @param {{query: Function}} db
 */
export async function accrueForPayment(db, {
  orgId = null, saleId = null, salePaymentId = null,
  transactionId = null, sourceEventId = null, now = null
} = {}) {
  if (!db) throw new Error("accrueForPayment: db is required");
  if (!orgId || !salePaymentId) return { accrued: false, reason: "missing_context" };

  const row = (await db.query(SQL_PAYMENT_CONTEXT, [salePaymentId, orgId])).rows[0] || null;
  if (!row) return { accrued: false, reason: "no_payment" };

  // A caller that names the sale must name the right one. Silently accruing
  // against a different sale is how money lands on the wrong partner's book.
  if (saleId && String(row.sale_id) !== String(saleId)) {
    return { accrued: false, reason: "sale_context_conflict" };
  }

  /* The partners join is org-scoped. A client carrying a partner_id that the
     join could not reach means the partner belongs to another org or no longer
     exists — never a rate of zero. Loud, and its own reason code. */
  if (row.partner_id && row.revenue_share_pct == null) {
    console.warn(
      `${ACCRUAL_REFUSED}: partner_not_found ` +
      `(org=${orgId} payment=${salePaymentId} partner=${row.partner_id}). ` +
      `The client names a partner this org cannot see; no revenue was accrued.`
    );
    return {
      accrued: false, reason: "partner_not_found",
      partnerId: row.partner_id, clientId: row.client_id || null
    };
  }

  const decision = computeAccrual({
    partnerId: row.partner_id,
    kind: row.kind,
    productCode: row.product_code,
    amount: row.amount,
    sharePct: row.revenue_share_pct
  });

  if (!decision.accrue) {
    // Two of these mean a real payment was recorded and somebody's money did not
    // move. Say so out loud, once, with the facts that explain it. The rest are
    // the rule working as designed and stay quiet.
    if (decision.reason === "unknown_amount" || decision.reason === "unknown_product") {
      console.warn(
        `${ACCRUAL_REFUSED}: ${decision.reason} ` +
        `(org=${orgId} payment=${salePaymentId} partner=${row.partner_id || "none"} ` +
        `product=${row.product_code || "none"} kind=${row.kind || "none"}). ` +
        `The payment is recorded; no partner revenue was accrued.`
      );
    }
    return {
      accrued: false,
      reason: decision.reason,
      partnerId: row.partner_id || null,
      clientId: row.client_id || null
    };
  }

  const { txId, evId } = await resolveKeys(db, {
    transactionId: transactionId ?? row.transaction_id,
    sourceEventId: sourceEventId ?? row.source_event_id
  });
  if (!txId && !evId) {
    console.warn(
      `${ACCRUAL_REFUSED}: no_idempotency_key ` +
      `(org=${orgId} payment=${salePaymentId} partner=${row.partner_id}). ` +
      `Neither a transaction nor an event row backs this payment, so an accrual ` +
      `could not be made replay-safe and was not written.`
    );
    return { accrued: false, reason: "no_idempotency_key", partnerId: row.partner_id };
  }

  const occurredAt = row.paid_at || now || new Date();

  const ins = await db.query(SQL_INSERT_ACCRUAL, [
    orgId,
    row.partner_id,
    row.client_id || null,
    txId,
    evId,
    fromCents(decision.grossCents),
    decision.sharePct,
    fromCents(decision.shareCents),
    row.currency || "USD",
    occurredAt
  ]);

  if (!ins.rows[0]) {
    return { accrued: false, reason: "already_accrued", partnerId: row.partner_id };
  }

  return {
    accrued: true,
    reason: null,
    revenueId: ins.rows[0].id,
    partnerId: row.partner_id,
    clientId: row.client_id || null,
    grossCents: decision.grossCents,
    shareCents: decision.shareCents,
    sharePct: decision.sharePct
  };
}

/**
 * The money chain's entry point. Identical to accrueForPayment except that it
 * cannot throw: a partner accrual failing must never stop fundhub from recording
 * that money arrived. Same shape as createFundingCloseoutSafe in
 * src/funding/closeout.mjs, for the same reason.
 *
 * @param {{query: Function}} db
 */
export async function accrueForPaymentSafe(db, args = {}) {
  try {
    return await accrueForPayment(db, args);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(
      `${ACCRUAL_FAILED}: ${msg} ` +
      `(org=${args.orgId || "?"} payment=${args.salePaymentId || "?"}). ` +
      `The payment is recorded; the partner accrual can be re-driven from the ` +
      `same transaction id, which is idempotent.`
    );
    return { accrued: false, reason: "accrual_error", error: msg };
  }
}

/**
 * The recruit bonus (W1 §5, D7): a partner brought a partner, so they are owed
 * 20% of the $30,000 entry fee, once.
 *
 * It is recorded as a partner_revenue row like any other earning, with
 * share_pct_applied = 20 against a gross of the $30,000 sticker, so the row's own
 * arithmetic still reads gross x pct = share for anyone auditing the table. The
 * 20 here is the bonus rule as applied, NOT the recruiter's revenue share — the
 * recruiter's 50% on their own book is untouched by this row.
 *
 * @param {{query: Function}} db
 */
export async function accrueRecruitBonus(db, {
  orgId = null, recruiterPartnerId = null, transactionId = null, sourceEventId = null,
  entryFeeCents = ENTRY_FEE_CENTS, bonusPct = RECRUIT_BONUS_PCT,
  currency = "USD", now = null
} = {}) {
  if (!db) throw new Error("accrueRecruitBonus: db is required");
  if (!orgId || !recruiterPartnerId) return { accrued: false, reason: "missing_context" };

  const partner = (await db.query(
    `SELECT id FROM partners WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [recruiterPartnerId, orgId]
  )).rows[0];
  if (!partner) return { accrued: false, reason: "no_partner" };

  const { txId, evId } = await resolveKeys(db, { transactionId, sourceEventId });
  if (!txId && !evId) {
    console.warn(
      `${ACCRUAL_REFUSED}: no_idempotency_key (recruit bonus, org=${orgId} ` +
      `partner=${recruiterPartnerId}). Without a transaction or event row the ` +
      `bonus could be paid twice on a replay, so it was not written.`
    );
    return { accrued: false, reason: "no_idempotency_key" };
  }

  const bonus = computeRecruitBonus({ entryFeeCents, bonusPct });

  // client_id stays NULL: a recruited partner is not a client, and 042 makes the
  // column nullable for exactly this case.
  const ins = await db.query(SQL_INSERT_ACCRUAL, [
    orgId,
    recruiterPartnerId,
    null,
    txId,
    evId,
    fromCents(bonus.grossCents),
    bonus.sharePct,
    fromCents(bonus.shareCents),
    currency,
    now || new Date()
  ]);

  if (!ins.rows[0]) return { accrued: false, reason: "already_accrued" };

  return {
    accrued: true,
    reason: null,
    revenueId: ins.rows[0].id,
    partnerId: recruiterPartnerId,
    grossCents: bonus.grossCents,
    shareCents: bonus.shareCents,
    sharePct: bonus.sharePct
  };
}

/**
 * Reverse an accrual after a refund or a chargeback.
 *
 * VOID, NEVER DELETE — 042 raises an exception on DELETE and forbids a negative
 * amount, so this is the only shape a reversal can take. NO CLAWBACK: if the
 * partner has already been paid, the balance simply goes down and the shortfall
 * is fundhub's (owner-set, W0-decisions.md). Nothing here chases the partner.
 *
 * PARTIAL REFUND, TWO WAYS TO SAY IT. Pass `netRemainingCents` when the caller
 * already knows what survived, or `refundedCents` when it only knows what went
 * back — the surviving net is then the voided row's own gross minus the refund,
 * floored at zero. `refundedCents` is what a refund webhook actually carries, so
 * it is the shape the money chain uses. If both are given, netRemainingCents
 * wins: an explicit figure beats a derived one. Either way the original row is
 * voided in full and a fresh accrual is written for what survived, at the
 * share_pct_applied the ORIGINAL froze — never the partner's current rate. That
 * is what frozen rates are for.
 *
 * ALL-OR-NOTHING, AND WHERE IT IS NOT. A partial refund is two writes — the void
 * and the replacement — and half of that pair is a real loss: void without
 * re-accrual silently takes the surviving money off the partner's book, and the
 * replacement cannot be retried on its own because the voided row still occupies
 * both unique keys. So the pair now runs inside withTransaction()
 * (src/db/with-transaction.mjs): on a pool, or on the shared singleton, it is one
 * BEGIN/COMMIT and a crash between the two statements rolls the void back rather
 * than leaving it stranded.
 *
 * THE ONE HANDLE THAT STILL CANNOT HONOUR IT, stated plainly rather than papered
 * over: withTransaction's third branch — a plain `{ query }` object that is
 * neither a pool nor the singleton, i.e. a unit-test stub — runs the callback
 * inline under autocommit. No production caller passes such a handle (the money
 * chain passes the handle the bus was given, which is the pool or the singleton),
 * so the exposure is confined to tests. If one ever did, the exposure would be:
 * process dies between the two writes, the accrual is void, the surviving net is
 * never re-accrued, the partner is short by half of what survived, and a retry
 * reports "nothing_to_void" because the void already landed. The correction is
 * manual, and the voided row's void_reason names the refund it came from.
 *
 * IDEMPOTENT BY CONSTRUCTION: the UPDATE only touches rows that are not already
 * void and re-accrues only what this very call voided, so a second delivery of
 * the same refund voids nothing and writes nothing. The re-accrual deliberately
 * carries no transaction or event id, because the voided row still holds both.
 *
 * @param {{query: Function}} db
 */
export async function voidForRefund(db, {
  orgId = null, transactionId = null, sourceEventId = null,
  reason = null, netRemainingCents = null, refundedCents = null, now = null
} = {}) {
  if (!db) throw new Error("voidForRefund: db is required");
  const why = String(reason || "").trim();
  if (!why) {
    // partner_revenue_void_ck makes the reason mandatory in the database. Failing
    // here gives a readable message instead of a constraint violation.
    throw new Error("voidForRefund: a reason is required — a void with no reason is refused by the database");
  }
  if (!orgId) return { voided: 0, reaccrued: 0, reason: "missing_context" };

  const txId = asUuid(transactionId);
  const evId = asUuid(sourceEventId);
  if (!txId && !evId) return { voided: 0, reaccrued: 0, reason: "missing_context" };

  /* Both amounts are validated BEFORE anything is written. A bad figure used to
     void the row first and throw second, which left the accrual reversed on the
     strength of an argument the function had already rejected. */
  const hasNet = netRemainingCents !== null && netRemainingCents !== undefined;
  if (hasNet && (!Number.isInteger(netRemainingCents) || netRemainingCents < 0)) {
    throw new RangeError(`voidForRefund: netRemainingCents must be whole cents >= 0: ${netRemainingCents}`);
  }
  const hasRefunded = refundedCents !== null && refundedCents !== undefined;
  if (hasRefunded && (!Number.isInteger(refundedCents) || refundedCents < 0)) {
    throw new RangeError(`voidForRefund: refundedCents must be whole cents >= 0: ${refundedCents}`);
  }

  return withTransaction(db, async (tx) => {
    const upd = await tx.query(
      `UPDATE partner_revenue
          SET status = 'void', void_reason = $4, updated_at = now()
        WHERE org_id = $1
          AND status <> 'void'
          AND (($2::uuid IS NOT NULL AND transaction_id = $2)
            OR ($3::uuid IS NOT NULL AND source_event_id = $3))
        RETURNING id, partner_id, client_id, gross_amount, share_pct_applied, currency`,
      [orgId, txId, evId, why]
    );
    const voided = upd.rows;
    if (!voided.length) return { voided: 0, reaccrued: 0, reason: "nothing_to_void" };

    const voidedIds = voided.map((r) => r.id);
    // Nothing to re-accrue was asked for: a full reversal, which is the common case.
    if (!hasNet && !hasRefunded) {
      return { voided: voided.length, reaccrued: 0, reason: null, voidedIds };
    }
    // An explicit net of zero says nothing survived, whichever rows were voided.
    if (hasNet && netRemainingCents === 0) {
      return { voided: voided.length, reaccrued: 0, reason: null, voidedIds };
    }
    if (voided.length > 1) {
      // One net figure cannot be split across several accruals without inventing a
      // rule for how. Refuse rather than guess; the voids still stand.
      console.warn(
        `${ACCRUAL_REFUSED}: ambiguous_net (org=${orgId} voided=${voided.length}). ` +
        `The refund voided more than one accrual, so the surviving net was not ` +
        `re-accrued automatically.`
      );
      return { voided: voided.length, reaccrued: 0, reason: "ambiguous_net", voidedIds };
    }

    const original = voided[0];
    /* Derive the survivor from the row that was actually voided, not from
       anything the caller believed the gross to be. gross_amount is a pg numeric
       and arrives as a string. */
    const net = hasNet
      ? netRemainingCents
      : Math.max(0, toCents(original.gross_amount) - refundedCents);
    if (net === 0) {
      return { voided: voided.length, reaccrued: 0, reason: null, voidedIds };
    }

    const frozenPct = Number(original.share_pct_applied);
    const ins = await tx.query(SQL_INSERT_ACCRUAL, [
      orgId,
      original.partner_id,
      original.client_id || null,
      null,
      null,
      fromCents(net),
      frozenPct,
      fromCents(applySplit(net, frozenPct)),
      original.currency || "USD",
      now || new Date()
    ]);

    return {
      voided: voided.length,
      reaccrued: ins.rows[0] ? 1 : 0,
      reason: null,
      voidedIds: [original.id],
      reaccrualId: ins.rows[0]?.id || null,
      netCents: net,
      sharePct: frozenPct
    };
  });
}
