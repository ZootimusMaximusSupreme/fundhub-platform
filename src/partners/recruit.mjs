// @ts-check
// The recruit bonus — who brought whom, and when the $6,000 becomes real.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7): fee timing and payout basis.
//
// WHAT WAS BROKEN. src/partners/revenue.mjs has held accrueRecruitBonus() —
// correct, tested, idempotent — since it was written, and it has never fired
// once. It takes `recruiterPartnerId` and nothing in the system could answer
// that question: no column recorded that partner A brought partner B. This
// module is the two missing halves: the record (backed by
// db/migrations/281_partner_recruited_by.sql) and the trigger.
//
// THE RULE, LOCKED (W0-decisions.md, W1-money-model.md D7):
//   A partner who recruits another partner earns 20% of the entry fee: $6,000.
//   Once. On the $30,000 entry fee (owner-set 2026-11-07; it was $2,000 on
//   $10,000). Nothing ongoing, nothing on the recruit's production.
//
// THE SHARP EDGE, AND WHY IT IS DELIBERATE. The entry fee is usually financed,
// and the lender remits a band-dependent slice of the sticker — as little as 30%.
// The bonus is a FLAT $6,000 against the STICKER, not a percentage of what
// arrived. So at the worst band FundHub receives $9,000 and pays out $6,000,
// netting $3,000. That is positive at every band on the D5 table and negative at
// none, and computeEntryEconomics() below is the arithmetic, proved band by band
// in recruit.test.mjs. The remittance varies; the promise does not.
//
// TIMING IS THE WHOLE POINT. The bonus accrues WHEN THE CASH LANDS — not when the
// application is submitted, not when the partner signs, not when the lender
// approves. That single rule is what keeps the edge above survivable: a partner
// who never funds costs FundHub nothing, because nothing accrued. Cash paid in
// full and cash financed take the same path, because both end in money arriving.
//
// NO CLAWBACK (owner-set). If the entry is refunded or charged back after the
// recruiter has been paid, that is FundHub's loss. It is recorded — the accrual
// is voided by the existing reversal path in src/handlers/money-chain.mjs — and
// it is never recovered from the recruiter. Nothing in this file chases anybody.
//
// MONEY IS INTEGER CENTS via src/commissions/money.mjs. Nothing here formats.

import { on } from "../events/registry.mjs";
import {
  accrueRecruitBonus, computeRecruitBonus, ENTRY_FEE_CENTS, RECRUIT_BONUS_PCT
} from "./revenue.mjs";

/** One greppable prefix per refusal that costs somebody money. */
export const RECRUIT_REFUSED = "[partner-recruit] bonus not accrued";

/* WHAT COUNTS AS THE ENTRY FEE.
   products.code for the one-time $30,000 partner entry. The live-trial unit owns
   src/trials/constants.mjs and declares the same code there; recruit.test.mjs
   fails if the two ever disagree, so this is a seam with a test holding it
   shut, not a silent fork. It is a LIST because the code is written by hand in
   migrations and a rename would otherwise mean a partner quietly stops earning. */
export const ENTRY_FEE_PRODUCT_CODES = Object.freeze(["partner-entry"]);

/** payment.received `product` bucket values that mean "the partner entry fee". */
export const ENTRY_FEE_BUCKETS = Object.freeze(["partner_entry", "partner-entry"]);

const ENTRY_CODES = new Set([
  ...ENTRY_FEE_PRODUCT_CODES,
  ...ENTRY_FEE_BUCKETS
].map((c) => c.toLowerCase()));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** @param {unknown} v */
function asUuid(v) {
  if (v == null) return null;
  const s = String(v);
  return UUID_RE.test(s) ? s : null;
}

/**
 * Is this product identity the $30,000 partner entry fee?
 * Compared lower-cased and trimmed, because products.code is hand-written in
 * migrations and payload buckets come off a vendor webhook.
 * @param {unknown} identity
 */
export function isEntryFeeProduct(identity) {
  if (identity == null) return false;
  const s = String(identity).trim().toLowerCase();
  if (s === "") return false;
  return ENTRY_CODES.has(s);
}

/**
 * PURE. What one financed entry fee actually does to FundHub's books.
 *
 * `remittedCents` is what the lender ACTUALLY SENT — the D5 band applied to the
 * sticker — not the sticker. The bonus is flat against the sticker regardless,
 * so the net is simply remittance minus bonus. NULL/undefined remittance is
 * UNKNOWN and stays unknown: it does not become 0, because "we do not know what
 * arrived" and "nothing arrived" are different answers and only one of them
 * means the recruiter is owed nothing yet.
 *
 * @param {{remittedCents?: number|string|null, entryFeeCents?: number, bonusPct?: number}} [args]
 * @returns {{remittedCents: number|null, entryFeeCents: number, bonusCents: number,
 *            fundhubNetCents: number|null, negative: boolean}}
 */
export function computeEntryEconomics({
  remittedCents = null, entryFeeCents = ENTRY_FEE_CENTS, bonusPct = RECRUIT_BONUS_PCT
} = {}) {
  const bonus = computeRecruitBonus({ entryFeeCents, bonusPct });
  if (remittedCents === null || remittedCents === undefined || remittedCents === "") {
    return {
      remittedCents: null,
      entryFeeCents,
      bonusCents: bonus.shareCents,
      fundhubNetCents: null,
      negative: false
    };
  }
  const remitted = Number(remittedCents);
  if (!Number.isFinite(remitted)) {
    throw new RangeError(`computeEntryEconomics: remittedCents must be cents: ${remittedCents}`);
  }
  const net = Math.round(remitted) - bonus.shareCents;
  return {
    remittedCents: Math.round(remitted),
    entryFeeCents,
    bonusCents: bonus.shareCents,
    fundhubNetCents: net,
    negative: net < 0
  };
}

/**
 * PURE. May this partner be recorded as recruited by that one?
 * The database enforces the self-recruit rule too (281's
 * partners_no_self_recruit_ck) — this is the readable half, so a caller gets a
 * reason string instead of a constraint violation.
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkRecruitPair({ partnerId = null, recruiterPartnerId = null } = {}) {
  if (!partnerId) return { ok: false, reason: "no_partner" };
  if (!recruiterPartnerId) return { ok: false, reason: "no_recruiter" };
  if (String(partnerId) === String(recruiterPartnerId)) {
    return { ok: false, reason: "self_recruit" };
  }
  return { ok: true, reason: null };
}

/**
 * Record that `recruiterPartnerId` brought `partnerId` in.
 *
 * WRITE ONCE. Once set, the recruiter is frozen: changing it later moves $6,000
 * of real money from one person to another after the fact, and there is no
 * legitimate reason to do that from application code. Re-writing the SAME
 * recruiter is a successful no-op (`already_set`); writing a DIFFERENT one is
 * refused (`recruiter_conflict`) and must be corrected deliberately by a human.
 *
 * @param {{query: Function}} db
 * @returns {Promise<{set: boolean, reason: string|null, partnerId?: string,
 *                    recruiterPartnerId?: string|null}>}
 */
export async function setRecruiter(db, {
  orgId = null, partnerId = null, recruiterPartnerId = null
} = {}) {
  if (!db) throw new Error("setRecruiter: db is required");
  if (!orgId) return { set: false, reason: "missing_context" };

  const pair = checkRecruitPair({ partnerId, recruiterPartnerId });
  if (!pair.ok) return { set: false, reason: pair.reason };

  /* One round trip for both rows. org_id is on both predicates so a recruiter in
     another org is simply not found — 281's composite foreign key would refuse
     the write anyway, but a reason string beats a constraint violation. */
  const { rows } = await db.query(
    `SELECT id, recruited_by_partner_id
       FROM partners
      WHERE org_id = $1 AND id = ANY($2::uuid[])`,
    [orgId, [partnerId, recruiterPartnerId]]
  );
  const self = rows.find((r) => String(r.id) === String(partnerId));
  const recruiter = rows.find((r) => String(r.id) === String(recruiterPartnerId));
  if (!self) return { set: false, reason: "no_partner" };
  if (!recruiter) return { set: false, reason: "no_recruiter" };

  if (self.recruited_by_partner_id) {
    return String(self.recruited_by_partner_id) === String(recruiterPartnerId)
      ? { set: false, reason: "already_set", partnerId, recruiterPartnerId }
      : {
          set: false,
          reason: "recruiter_conflict",
          partnerId,
          recruiterPartnerId: String(self.recruited_by_partner_id)
        };
  }

  /* The direct loop: B cannot recruit A when A already recruited B. Commercially
     impossible (A was a partner before B existed) and it is how somebody would
     manufacture a second $6,000 out of one real sale. 281 does not forbid it,
     so the writer does. */
  if (recruiter.recruited_by_partner_id
      && String(recruiter.recruited_by_partner_id) === String(partnerId)) {
    return { set: false, reason: "cycle", partnerId, recruiterPartnerId };
  }

  /* WHERE recruited_by_partner_id IS NULL makes the write-once rule the
     database's job too: two concurrent calls cannot both win. */
  const upd = await db.query(
    `UPDATE partners
        SET recruited_by_partner_id = $3, updated_at = now()
      WHERE org_id = $1 AND id = $2 AND recruited_by_partner_id IS NULL
      RETURNING id, recruited_by_partner_id`,
    [orgId, partnerId, recruiterPartnerId]
  );
  if (!upd.rows[0]) return { set: false, reason: "already_set", partnerId, recruiterPartnerId };

  return { set: true, reason: null, partnerId, recruiterPartnerId };
}

/**
 * Who recruited this partner? NULL recruiter is the normal answer and means
 * nobody is owed anything.
 * @param {{query: Function}} db
 */
export async function getRecruiter(db, { orgId = null, partnerId = null } = {}) {
  if (!db) throw new Error("getRecruiter: db is required");
  if (!orgId || !partnerId) return { found: false, recruiterPartnerId: null };
  const { rows } = await db.query(
    `SELECT recruited_by_partner_id FROM partners
      WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, partnerId]
  );
  if (!rows[0]) return { found: false, recruiterPartnerId: null };
  return { found: true, recruiterPartnerId: rows[0].recruited_by_partner_id || null };
}

/**
 * THE WIRE. The entry fee's cash has landed for `partnerId` — pay whoever brought
 * them, once.
 *
 * Idempotency is the database's job, exactly as it is for every other accrual:
 * accrueRecruitBonus() carries the transaction id and the source event id onto
 * the partner_revenue row, and 042's two partial unique indexes make a replay a
 * zero-row no-op. A lender that remits in two instalments against the same
 * transaction therefore pays the bonus once, which is the rule.
 *
 * @param {{query: Function}} db
 */
export async function accrueRecruitBonusForEntry(db, {
  orgId = null, partnerId = null, transactionId = null, sourceEventId = null,
  currency = "USD", now = null
} = {}) {
  if (!db) throw new Error("accrueRecruitBonusForEntry: db is required");
  if (!orgId || !partnerId) return { accrued: false, reason: "missing_context" };

  const { found, recruiterPartnerId } = await getRecruiter(db, { orgId, partnerId });
  if (!found) return { accrued: false, reason: "no_partner" };
  // The normal case. Most partners walked in on their own; nobody is owed.
  if (!recruiterPartnerId) return { accrued: false, reason: "no_recruiter" };

  const res = await accrueRecruitBonus(db, {
    orgId,
    recruiterPartnerId,
    transactionId,
    sourceEventId,
    currency,
    now
  });
  return { ...res, partnerId, recruiterPartnerId };
}

/* transactions.provider_ref is the bridge from a webhook payload to the cash row,
   the same lookup src/handlers/money-chain.mjs does. That function is private to
   that module and this unit may not edit it, so the two-line query is repeated
   here rather than reaching across — see the task report. */
async function findTransactionId(db, orgId, providerRef) {
  if (!orgId || !providerRef) return null;
  const { rows } = await db.query(
    `SELECT id FROM transactions WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
    [orgId, String(providerRef)]
  );
  return rows[0]?.id || null;
}

/**
 * Find the partner this payment is FOR. Two handles, in priority order:
 *   1. an explicit partnerId on the payload — what an internal replay carries
 *   2. the payment_links row the checkout minted, whose partner_id (277) is the
 *      only durable link between a partner and a payment
 * A payment with neither is somebody else's payment, and the answer is null.
 * @param {{query: Function}} db
 */
export async function resolveEntryPartner(db, event) {
  const p = (event && event.payload) || {};
  const orgId = event?.orgId || null;
  if (!orgId) return { partnerId: null, productCode: null, reason: "no_org" };

  const direct = asUuid(p.partnerId);
  if (direct) {
    return {
      partnerId: direct,
      productCode: p.productCode || p.product || p.productName || null,
      reason: null
    };
  }

  const linkId = asUuid(p.paymentLinkId);
  const linkRef = p.ref ? String(p.ref) : null;
  const sessionId = p.commasSessionId ? String(p.commasSessionId) : null;
  if (!linkId && !linkRef && !sessionId) {
    return { partnerId: null, productCode: null, reason: "no_partner_handle" };
  }

  const { rows } = await db.query(
    `SELECT pl.partner_id AS partner_id, pr.code AS product_code
       FROM payment_links pl
       LEFT JOIN products pr ON pr.id = pl.product_id
      WHERE pl.org_id = $1
        AND ($2::uuid IS NULL OR pl.id = $2)
        AND ($3::text IS NULL OR pl.link_ref = $3)
        AND ($4::text IS NULL OR pl.commas_session_id = $4)
      LIMIT 1`,
    [orgId, linkId, linkRef, sessionId]
  );
  const row = rows[0];
  if (!row || !row.partner_id) {
    return { partnerId: null, productCode: row?.product_code || null, reason: "no_partner_handle" };
  }
  return { partnerId: row.partner_id, productCode: row.product_code || null, reason: null };
}

/**
 * PURE. Did cash actually arrive on this payload?
 *
 * NULL IS UNKNOWN AND MUST SURVIVE. Number(null) is 0, and treating a missing
 * amount as zero would read "we cannot see what arrived" as "nothing arrived" —
 * the recruiter silently never gets paid and the row looks correct. So a missing
 * amount is its own answer.
 *
 * @returns {{landed: boolean, reason: string|null, amountCents: number|null}}
 */
export function cashLanded({ amount = null, amountCents = null } = {}) {
  let cents = null;
  if (amountCents !== null && amountCents !== undefined && amountCents !== "") {
    cents = Number(amountCents);
  } else if (amount !== null && amount !== undefined && amount !== "") {
    cents = Math.round(Number(amount) * 100);
  }
  if (cents === null) return { landed: false, reason: "unknown_amount", amountCents: null };
  if (!Number.isFinite(cents)) return { landed: false, reason: "unknown_amount", amountCents: null };
  if (cents <= 0) return { landed: false, reason: "no_cash_landed", amountCents: cents };
  return { landed: true, reason: null, amountCents: cents };
}

/**
 * payment.received — the entry fee's money arrived, so the recruiter is owed.
 *
 * IT MUST NOT THROW ON SOMEBODY ELSE'S PAYMENT. Every client payment in the
 * system passes through this handler and the only correct thing to do with one
 * is nothing at all. A throw here would dead-letter a client's successful
 * payment, so every refusal is a returned reason.
 */
export async function onEntryFeePaid(event, db) {
  const p = (event && event.payload) || {};
  const orgId = event?.orgId || null;
  if (!orgId) return { accrued: false, reason: "no_org" };

  const { partnerId, productCode } = await resolveEntryPartner(db, event);
  if (!partnerId) return { accrued: false, reason: "not_a_partner_entry" };

  /* The product must be the entry fee, never an add-on. The add-on handler
     (src/handlers/partner-addons.mjs) owns those, they are FundHub revenue, and
     no recruit bonus is owed on one. Any of the four identity fields may carry
     it depending on which door the payment came through. */
  const identity = [productCode, p.productCode, p.product, p.productName];
  if (!identity.some(isEntryFeeProduct)) {
    return { accrued: false, reason: "not_the_entry_fee" };
  }

  const cash = cashLanded(p);
  if (!cash.landed) {
    /* The loud case: the entry fee arrived for a recruited partner and we cannot
       see the money, so nobody is paid. Silence here is somebody's $6,000. */
    console.warn(
      `${RECRUIT_REFUSED}: ${cash.reason} (org=${orgId} partner=${partnerId}). ` +
      `The recruit bonus accrues on cash received, so nothing was written. ` +
      `Re-drive it from the same transaction id once the amount is known — the ` +
      `accrual is idempotent.`
    );
    return { accrued: false, reason: cash.reason, partnerId };
  }

  const transactionId = asUuid(p.transactionId)
    || await findTransactionId(db, orgId, p.providerRef);

  return accrueRecruitBonusForEntry(db, {
    orgId,
    partnerId,
    transactionId,
    sourceEventId: event.id || null,
    currency: p.currency || "USD",
    now: null
  });
}

export function register() {
  /* Registered in src/register-all.mjs AFTER registerMoneyChain(): handler order
     on the bus is registration order, and money-chain is what writes the
     transactions row this handler resolves for its idempotency key. Registered
     earlier, the key is missing and the bonus is refused rather than paid. */
  on("payment.received", onEntryFeePaid);
}

export default {
  setRecruiter,
  getRecruiter,
  accrueRecruitBonusForEntry,
  computeEntryEconomics,
  checkRecruitPair,
  isEntryFeeProduct,
  cashLanded,
  onEntryFeePaid,
  register
};
