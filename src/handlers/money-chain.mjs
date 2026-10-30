// Money-chain writers — sale / payment / funding-round / commission / entitlement.
//
// The calculators (src/commissions/) and grant() (src/entitlements/) already
// exist. Nothing called them. This module is the missing wire: live canonical
// events → durable Postgres rows the read APIs and payout screens trust.
//
// Pattern matches src/handlers/client-lifecycle.mjs and payment-links.mjs:
// register() → on(event, handler). Every write is idempotent (Rule 9).
//
// Owner calls made in this session (also in ops/workflows/money-chain-writers.md):
//   1. sale.closed writes the sales row — no separate sale.recorded event.
//   2. Product resolve: name/alias first, then semantic-bucket → product code.
//   3. Attribution only from the event payload (attributions[] / staffId /
//      closerId / advisorId). No invented owner.
//   4. product_entitlements stays empty in migrations; grantFromTransaction
//      no-ops when unmapped. Tests seed the mapping.
//      SUPERSEDED IN PART, 2026-08-18: leaving it empty meant every paid
//      purchase granted nothing, silently, in production.
//      180_product_entitlements_seed.sql now seeds the four pairs that shipped
//      code already answers (the portal's own MAP, offers.mjs, BUCKET_TO_CODE,
//      015's product codes) and no others. grantFromTransaction still no-ops
//      when unmapped — that part is unchanged and deliberate — but the no-op is
//      no longer silent. See warnNothingUnlocked below.
//   5. commission.earned is NOT emitted — not in CANONICAL_EVENTS yet.
//
// COMPLIANCE REVIEW REQUIRED: payment rails + fee/commission timing.

import { on } from "../events/registry.mjs";
import { emit } from "../events/bus.mjs";
import { resolveClient } from "./client-lifecycle.mjs";
import {
  computeFrontEnd,
  computeBackEnd,
  SQL_RULES_IN_FORCE,
  SQL_ATTRIBUTIONS_FOR_SALE,
  SQL_SALE_CONTEXT,
  SQL_SALE_FOR_ROUND,
  SQL_RESOLVE_PRODUCT,
  SQL_LINK_ROUND_TO_SALE,
  SQL_INSERT_LEDGER,
  ledgerInsertParams
} from "../commissions/index.mjs";
import { grantFromTransaction } from "../entitlements/entitlements.mjs";
import { seedChecklistForPurchase } from "../waypoints/purchase.mjs";
import { createWelcomeKitTaskForPurchase } from "../blueprint/welcome-kit.mjs";
import { ensureFinanceOsForBlueprintPurchase } from "../finance/finance-os-entitlement.mjs";
import { createFundingCloseoutSafe } from "../funding/closeout.mjs";
import { attachGateToRound } from "../inquiry-ops/gate.mjs";
import { accrueForPaymentSafe, voidForRefund } from "../partners/revenue.mjs";
import { toCents } from "../commissions/money.mjs";
import { convertSafe } from "../affiliates/economics.mjs";
import { listConfirmedApprovals, listExcludedApprovals, NO_CONFIRMED_APPROVALS } from "../funding/success-fee.mjs";
import { PRODUCT as CARD_STACKING_PRODUCT } from "../funding/card-stacking-rounds.mjs";
import { moveCardToStage } from "../workflows/cards.mjs";

/** Semantic product bucket → products.code when name/alias resolve fails. */
export const BUCKET_TO_CODE = Object.freeze({
  crs: "diagnostic",
  diagnostic: "diagnostic",
  deposit: "card-stacking-dfy",
  success_fee: "card-stacking-dfy",
  /* THE DIY LETTER DOWNSELL, AND WHY IT IS NO LONGER 'consulting-package'.
     Until 2026-09-17 this bucket pointed at the SAME product code that
     src/config/offers.mjs UWIQ_DELIVERABLES ("Capital Blueprint", $5,000) sells
     on. Two products, two prices, one code — so nothing downstream could tell
     which one a payment had bought, and the entitlement that unlocks a tile is
     looked up BY PRODUCT CODE. Measured on production: Sim Eleven-Blueprint paid
     $5,000, was granted the DIY letter pack, and the Capital Blueprint tile he
     had actually paid for stayed locked.

     383_blueprint_entitlement.sql added the missing roadmap row and wrote the
     collision down as "RECORDED, NOT FIXED". This is the fix it named: the DIY
     downsell has its own products row now
     (db/migrations/384_diy_letter_pack_product.sql), so this fallback lands on
     the $1,000 letter pack and nothing else.

     WHAT THIS DOES NOT CHANGE. resolveProductId() below tries productId, then
     productName, and only then this bucket — so every payment that carries the
     Commas title "Consulting Services Package" still resolves to the Capital
     Blueprint exactly as before, and so does every payment from a link we
     minted. The only caller that reaches this line is a sale.closed carrying no
     product at all (onSaleClosedMoney's last-resort default). Before today that
     default silently minted a $5,000 Capital Blueprint sale and, since 383,
     unlocked its tile for free. */
  diy: "diy-letter-pack",
  // 'repair' is offers.mjs' own paymentPurpose for REPAIR_DFY and REPAIR_TRIAL
  // (src/config/offers.mjs), and 'repair-bundle' is the only product with
  // category 'repair' (015_seed_products.sql). Without this entry a repair
  // payment resolves to NO product, and onSaleClosedMoney's last-resort 'diy'
  // default then files it under consulting-package — which is exactly how a
  // repair sale ended up on the wrong product (live audit 2026-08-18). This
  // entry only ever turns "no product" into the right one; it reroutes nothing
  // that already resolved.
  repair: "repair-bundle",
  unmatched: null
});

/* WHY NOTHING UNLOCKED — and why that sentence now gets written down.
   Refusing to grant an entitlement nobody has mapped is correct and stays.
   Doing it in silence was not: grantForPurchase returned { unmapped: true }, the
   return value went nowhere, and "he paid, why is his portal still locked?" had
   no readable answer. These two make it legible — a pure reason code a test can
   assert, and one greppable line in the function log per occurrence. */
export const NOTHING_UNLOCKED = "[money-chain] nothing unlocked";
export const PRODUCT_ASSUMED = "[money-chain] product assumed";

/** Why a purchase could grant nothing, before the mapping is even consulted.
 *  null means "nothing in the way — go look the mapping up". */
export function nothingUnlockedReason({ clientId, product } = {}) {
  if (!clientId) return "no_client";
  if (!product || !product.code) return "no_product";
  return null;
}

function warnNothingUnlocked(event, reason, { clientId = null, productCode = null } = {}) {
  console.warn(
    `${NOTHING_UNLOCKED}: ${reason} ` +
    `(event=${event?.name || "?"} org=${event?.orgId || "?"} ` +
    `client=${clientId || "none"} product=${productCode || "none"}). ` +
    `Money was recorded; no entitlement was granted.`
  );
}

/** payment.received product bucket → sale_payments.kind */
export function paymentKindFor(productBucket, sourceEvent) {
  if (sourceEvent === "deposit.paid" || productBucket === "deposit") return "deposit";
  if (productBucket === "success_fee") return "success_fee";
  if (sourceEvent === "diagnostic.paid" || productBucket === "crs") return "deposit";
  if (sourceEvent === "sale.closed" || productBucket === "diy") return "deposit";
  return "installment";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function asUuid(v) {
  if (v == null) return null;
  const s = String(v);
  return UUID_RE.test(s) ? s : null;
}

function saleExternalRef(event) {
  const p = event.payload || {};
  if (p.providerRef) return String(p.providerRef);
  if (p.externalRef) return String(p.externalRef);
  if (event.id) return `event:${event.id}`;
  return null;
}

export async function resolveProductId(db, orgId, { productId, productName, productBucket } = {}) {
  if (!orgId) return null;
  if (productId) {
    const exact = await db.query(
      `SELECT id FROM products WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [productId, orgId]
    );
    return exact.rows[0]?.id || null;
  }
  if (productName) {
    const r = await db.query(SQL_RESOLVE_PRODUCT, [orgId, String(productName)]);
    if (r.rows[0]?.product_id) return r.rows[0].product_id;
    const asCode = await db.query(
      `SELECT id FROM products WHERE org_id = $1 AND lower(code) = lower($2) LIMIT 1`,
      [orgId, String(productName)]
    );
    if (asCode.rows[0]?.id) return asCode.rows[0].id;
  }
  const code = BUCKET_TO_CODE[productBucket] || productBucket || null;
  if (!code) return null;
  const byCode = await db.query(
    `SELECT id FROM products WHERE org_id = $1 AND lower(code) = lower($2) LIMIT 1`,
    [orgId, code]
  );
  return byCode.rows[0]?.id || null;
}

async function loadProduct(db, productId) {
  if (!productId) return null;
  const { rows } = await db.query(
    `SELECT id, org_id, code, name, category, default_price, default_success_fee_percent
       FROM products WHERE id = $1`,
    [productId]
  );
  return rows[0] || null;
}

/** Find or create a sales row. Returns { sale, created, product, clientId }. */
export async function ensureSale(db, event, { productBucket = null } = {}) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) return { sale: null, created: false, product: null, clientId };

  const p = event.payload || {};
  const productId = await resolveProductId(db, orgId, {
    productId: p.productId || null,
    productName: p.productName || p.product || null,
    productBucket: productBucket || p.product || null
  });
  const product = await loadProduct(db, productId);
  if (!product) return { sale: null, created: false, product: null, clientId };

  if (p.saleId) {
    const exact = await db.query(
      `SELECT * FROM sales
        WHERE id = $1 AND org_id = $2 AND client_id = $3 AND product_id = $4
          AND sale_motion IS NOT DISTINCT FROM $5::text
        LIMIT 1`,
      [p.saleId, orgId, clientId, product.id, p.saleMotion || null]
    );
    if (exact.rows[0]) {
      return { sale: exact.rows[0], created: false, product, clientId };
    }
    return { sale: null, created: false, product, clientId, conflict: true };
  }

  const ext = saleExternalRef(event);

  if (ext) {
    const existing = await db.query(
      `SELECT * FROM sales WHERE org_id = $1 AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    if (existing.rows[0]) {
      // Same external_ref belonging to a different client is a conflict — never
      // silently attach money to the wrong person. Refuse without throwing so a
      // bus replay of historical stamp collisions can continue.
      if (String(existing.rows[0].client_id) !== String(clientId)) {
        console.warn(
          `[money-chain] sale external_ref ${ext} already belongs to another client — refusing attach`
        );
        return { sale: null, created: false, product, clientId, conflict: true };
      }
      if (
        String(existing.rows[0].product_id) !== String(product.id) ||
        (existing.rows[0].sale_motion ?? null) !== (p.saleMotion ?? null)
      ) {
        console.warn(
          `[money-chain] sale external_ref ${ext} has conflicting product or motion — refusing attach`
        );
        return { sale: null, created: false, product, clientId, conflict: true };
      }
      return { sale: existing.rows[0], created: false, product, clientId };
    }
  }

  const prior = await db.query(
    `SELECT * FROM sales
      WHERE org_id = $1 AND client_id = $2 AND product_id = $3 AND status = 'active'
        AND sale_motion IS NOT DISTINCT FROM $4::text
      ORDER BY sold_at DESC LIMIT 1`,
    [orgId, clientId, product.id, p.saleMotion || null]
  );
  if (prior.rows[0]) {
    return { sale: prior.rows[0], created: false, product, clientId };
  }

  const amount = p.amount != null && p.amount !== "" ? Number(p.amount) : null;
  // Zero / negative / absurd amounts must not invent a sale.
  // Align with src/commissions/money.mjs MAX_CENTS ($1bn).
  const MAX_SALE = 1_000_000_000;
  if (amount != null && !Number.isNaN(amount) && (amount <= 0 || Math.abs(amount) >= MAX_SALE)) {
    return { sale: null, created: false, product, clientId };
  }
  const agreed = (amount != null && !Number.isNaN(amount) && amount > 0)
    ? amount
    : (product.default_price != null ? Number(product.default_price) : 0);
  if (!(agreed > 0) || Math.abs(agreed) >= MAX_SALE) {
    return { sale: null, created: false, product, clientId };
  }
  const feePct = p.agreedSuccessFeePercent != null
    ? Number(p.agreedSuccessFeePercent)
    : (product.default_success_fee_percent != null
      ? Number(product.default_success_fee_percent)
      : null);
  const soldAt = p.soldAt || p.paidAt || event.occurredAt || new Date().toISOString();

  const ins = await db.query(
    `INSERT INTO sales (
       org_id, client_id, product_id, agreed_price, agreed_success_fee_percent,
       currency, sold_at, status, external_ref, notes, sale_motion
     ) VALUES ($1,$2,$3,$4,$5,'USD',$6,'active',$7,$8,$9)
     ON CONFLICT (org_id, external_ref) WHERE external_ref IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [
      orgId, clientId, product.id, agreed, feePct, soldAt, ext,
      p.notes || `source:${event.name}`, p.saleMotion || null
    ]
  );
  if (ins.rows[0]) {
    return { sale: ins.rows[0], created: true, product, clientId };
  }

  if (ext) {
    const again = await db.query(
      `SELECT * FROM sales WHERE org_id = $1 AND external_ref = $2 LIMIT 1`,
      [orgId, ext]
    );
    if (again.rows[0]) {
      return { sale: again.rows[0], created: false, product, clientId };
    }
  }
  return { sale: null, created: false, product, clientId };
}

/** Attribution from the event payload only. Never invents a staff member. */
export async function ensureAttributions(db, { orgId, saleId, event, basisHint = null } = {}) {
  if (!orgId || !saleId) return { written: 0 };
  const p = event.payload || {};
  const candidates = [];

  if (Array.isArray(p.attributions)) {
    for (const a of p.attributions) {
      if (!a?.staffId) continue;
      candidates.push({
        staffId: a.staffId,
        role: a.role || null,
        basis: a.basis || basisHint || null,
        split: a.splitPercent != null ? Number(a.splitPercent) : 100
      });
    }
  }

  if (p.closerId) {
    for (const basis of ["front_end", "back_end"]) {
      candidates.push({
        staffId: p.closerId,
        role: "closer",
        basis,
        split: p.closerSplit != null ? Number(p.closerSplit) : 100
      });
    }
  }
  if (p.salesManagerId) {
    for (const basis of ["front_end", "back_end"]) {
      candidates.push({
        staffId: p.salesManagerId,
        role: "sales_manager",
        basis,
        split: p.salesManagerSplit != null ? Number(p.salesManagerSplit) : 100
      });
    }
  }
  if (p.advisorId) {
    candidates.push({
      staffId: p.advisorId,
      role: "funding_advisor",
      basis: "back_end",
      split: p.advisorSplit != null ? Number(p.advisorSplit) : 100
    });
  }
  if (p.staffId && candidates.length === 0) {
    candidates.push({
      staffId: p.staffId,
      role: null,
      basis: basisHint,
      split: 100
    });
  }

  const list = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const staff = (await db.query(
      `SELECT id, role
         FROM staff
        WHERE id = $1 AND org_id = $2 AND status = 'active'
        LIMIT 1`,
      [candidate.staffId, orgId]
    )).rows[0];
    if (!staff) continue;
    if (candidate.role && candidate.role !== staff.role) continue;

    const role = staff.role;
    const bases = candidate.basis
      ? [candidate.basis]
      : role === "closer" || role === "sales_manager"
        ? ["front_end", "back_end"]
        : role === "funding_advisor"
          ? ["back_end"]
          : [];
    for (const basis of bases) {
      const key = `${staff.id}|${role}|${basis}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ staffId: staff.id, role, basis, split: candidate.split });
    }
  }

  let written = 0;
  for (const a of list) {
    // The split-check trigger runs BEFORE INSERT and rejects a duplicate 100%
    // row as "200%" before ON CONFLICT can absorb it. Probe first.
    const exists = await db.query(
      `SELECT 1 FROM sale_attributions
        WHERE sale_id = $1 AND staff_id = $2 AND role = $3 AND basis = $4
        LIMIT 1`,
      [saleId, a.staffId, a.role, a.basis]
    );
    if (exists.rows[0]) continue;

    // Replay / second staff at 100%: split limits are independent per role.
    // A closer at 100% must not block a real sales manager at 100%.
    const basisSum = await db.query(
      `SELECT COALESCE(SUM(split_percent), 0)::float AS s
         FROM sale_attributions
        WHERE sale_id = $1 AND basis = $2 AND role = $3`,
      [saleId, a.basis, a.role]
    );
    const already = Number(basisSum.rows[0]?.s) || 0;
    if (already + Number(a.split) > 100.0001) continue;

    const r = await db.query(
      `INSERT INTO sale_attributions (org_id, sale_id, staff_id, role, basis, split_percent)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (sale_id, staff_id, role, basis) DO NOTHING
       RETURNING id`,
      [orgId, saleId, a.staffId, a.role, a.basis, a.split]
    );
    if (r.rows[0]) written += 1;
  }
  return { written };
}

async function findTransactionId(db, orgId, providerRef) {
  if (!providerRef) return null;
  const { rows } = await db.query(
    `SELECT id FROM transactions
      WHERE org_id = $1 AND provider_ref = $2
      LIMIT 1`,
    [orgId, String(providerRef)]
  );
  return rows[0]?.id || null;
}

export async function ensureSalePayment(db, event, {
  saleId, productId, paymentLinkId = null, saleMotion = null, kind, amount = null
} = {}) {
  const orgId = event.orgId;
  if (!orgId || !saleId || !productId) return { payment: null, created: false };

  const p = event.payload || {};
  const paid = amount != null ? Number(amount)
    : (p.amount != null ? Number(p.amount) : null);
  if (paid == null || Number.isNaN(paid) || paid < 0) {
    return { payment: null, created: false };
  }

  const transactionId = await findTransactionId(db, orgId, p.providerRef);
  const sourceEventId = asUuid(event.id);
  if (!transactionId && !sourceEventId) {
    return { payment: null, created: false };
  }
  const paidAt = p.paidAt || new Date().toISOString();

  /* THE WHITE-LABEL PARTNER'S HALF — the one hook, and the reason it is here.
     A sale_payments row is the single durable moment money is known to have
     arrived, and every path that records money reaches this function. Hanging
     the partner accrual off any of the six bus handlers instead would mean six
     places to keep in step and a seventh that quietly forgets. Nothing new is
     registered on the bus; this rides what register() already binds.

     accrueForPaymentSafe never throws and is idempotent on both the transaction
     and the event id, so a replay writes nothing and a failure cannot stop
     fundhub from recording that the money came in. A payment for a client with
     no partner_id — the direct book, which is most of them — returns
     { accrued: false, reason: "no_partner" } and writes nothing.
     See src/partners/revenue.mjs and docs/specs/W1-money-model.md §7. */
  /* THE AFFILIATE'S CUT — the other half of the same hole.
     src/affiliates/economics.mjs has exported convert() since 033 and, until
     today, NO production file called it: attribute() recorded who referred a
     client and nothing ever turned that into money (W1-money-model.md finding
     F1). It rides here for the same reason the partner accrual does — one
     durable moment, one place to keep in step.

     It is safe to attempt on EVERY payment. qualifyingOutcome() routes on the
     product code and, on funding, additionally demands a funded round, so a
     course sale, a soft pull or a signed deal that never funded all come back
     "does not qualify" and write nothing. Conversion is idempotent: the UPDATE
     is guarded on status = 'attributed', so a re-delivered webhook reports
     "already_converted" rather than paying twice. convertSafe never throws.

     Ordering is deliberate. The partner's half is recorded first, then the
     affiliate's share of that half — the arithmetic is independent (the basis
     reads sale_payments, not partner_revenue) but the books read in the order
     the money actually splits.

     WHY IT IS NOT ALSO HUNG OFF round.funded. round.funded writes no
     sale_payments row — it funds the round and raises the success-fee closeout,
     and the cash for that closeout arrives later as its own payment.received.
     Converting at round.funded would freeze the affiliate's basis on the deposit
     alone, which is the deposit-only schedule the owner replaced on 2026-08-31.
     The consequence, recorded and not hidden: a deal that funds and then never
     pays its success fee never reaches another payment event, so its referral
     stays 'attributed' and earns nothing. Nothing regresses — until today no
     production path called convert() at all — but a funded-and-unpaid deal is
     still a gap, and closing it needs an owner call on what it should pay. */
  const settle = async (paymentRow, created) => {
    if (!paymentRow) return { payment: null, created: false };
    const partnerRevenue = await accrueForPaymentSafe(db, {
      orgId,
      saleId,
      salePaymentId: paymentRow.id,
      transactionId: paymentRow.transaction_id ?? transactionId,
      sourceEventId: paymentRow.source_event_id ?? sourceEventId
    });
    const affiliate = await convertSafe(db, {
      orgId,
      saleId,
      sourceEventId: paymentRow.source_event_id ?? sourceEventId
    });
    return { payment: paymentRow, created, partnerRevenue, affiliate };
  };

  const ins = await db.query(
    `INSERT INTO sale_payments (
       org_id, sale_id, transaction_id, product_id, payment_link_id, sale_motion,
       kind, amount, paid_at, notes, source_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      orgId, saleId, transactionId, productId, paymentLinkId, saleMotion,
      kind, paid, paidAt, p.notes || `source:${event.name}`, sourceEventId
    ]
  );
  if (ins.rows[0]) return settle(ins.rows[0], true);

  if (transactionId) {
    const ex = await db.query(
      `SELECT * FROM sale_payments WHERE org_id = $1 AND transaction_id = $2 LIMIT 1`,
      [orgId, transactionId]
    );
    if (ex.rows[0]) return settle(ex.rows[0], false);
  }
  if (sourceEventId) {
    const ex = await db.query(
      `SELECT * FROM sale_payments WHERE org_id = $1 AND client_id = $2 AND source_event_id = $3 LIMIT 1`,
      [orgId, clientId, sourceEventId]
    );
    if (ex.rows[0]) return settle(ex.rows[0], false);
  }
  return { payment: null, created: false };
}

async function loadRules(db, orgId, basis, asOf) {
  const { rows } = await db.query(SQL_RULES_IN_FORCE, [orgId, basis, asOf]);
  return rows.map((r) => ({
    ...r,
    tiers: typeof r.tiers === "string" ? JSON.parse(r.tiers) : (r.tiers || [])
  }));
}

async function insertDrafts(db, drafts) {
  let inserted = 0;
  for (const draft of drafts) {
    const r = await db.query(SQL_INSERT_LEDGER, ledgerInsertParams(draft));
    if (r.rows[0]) inserted += 1;
  }
  return inserted;
}

export async function writeFrontEndCommissions(db, { saleId, payment = null, event } = {}) {
  if (!saleId) return { inserted: 0, warnings: [], drafts: [] };

  const ctx = await db.query(SQL_SALE_CONTEXT, [saleId]);
  const saleRow = ctx.rows[0];
  if (!saleRow) return { inserted: 0, warnings: [{ code: "no_sale" }], drafts: [] };

  const attributions = (await db.query(SQL_ATTRIBUTIONS_FOR_SALE, [saleId])).rows;
  let paymentRow = payment;
  if (paymentRow?.id) {
    paymentRow = (await db.query(
      `SELECT id, sale_id, transaction_id, product_id, payment_link_id, sale_motion,
              kind, amount, paid_at
         FROM sale_payments
        WHERE id = $1 AND sale_id = $2
        LIMIT 1`,
      [paymentRow.id, saleId]
    )).rows[0] || null;
  }
  if (!paymentRow) {
    return {
      inserted: 0,
      warnings: [{ code: "no_payment", sale_id: saleId }],
      drafts: []
    };
  }
  const payments = [paymentRow];
  const asOf = saleRow.sold_at || new Date().toISOString();
  const rules = await loadRules(db, saleRow.org_id, "front_end", asOf);
  const product = {
    id: saleRow.product_id,
    name: saleRow.product_name,
    category: saleRow.product_category
  };
  const client = { id: saleRow.client_id, client_code: saleRow.client_code };
  const occurredAt = event.payload?.paidAt || event.payload?.soldAt || asOf;

  const { drafts, warnings } = computeFrontEnd({
    org_id: saleRow.org_id,
    sale: saleRow,
    product,
    client,
    payments,
    payment: paymentRow,
    attributions,
    rules,
    occurredAt,
    sourceEvent: event.name,
    saleMotion: paymentRow.sale_motion,
    eventRef: paymentRow.id
  });

  const inserted = await insertDrafts(db, drafts);
  return { inserted, warnings, drafts };
}

export async function writeBackEndCommissions(db, { roundId, event } = {}) {
  if (!roundId) return { inserted: 0, warnings: [], drafts: [] };

  const link = await db.query(SQL_SALE_FOR_ROUND, [roundId]);
  const saleId = link.rows[0]?.sale_id;
  if (!saleId) {
    return { inserted: 0, warnings: [{ code: "no_sale_link", funding_round_id: roundId }], drafts: [] };
  }

  const ctx = await db.query(SQL_SALE_CONTEXT, [saleId]);
  const saleRow = ctx.rows[0];
  if (!saleRow) return { inserted: 0, warnings: [{ code: "no_sale" }], drafts: [] };

  const round = (await db.query(
    `SELECT id, org_id, client_id, round_number, status,
            submitted_amount, approved_amount, funded_amount, created_at
       FROM funding_rounds WHERE id = $1`,
    [roundId]
  )).rows[0];
  if (!round) return { inserted: 0, warnings: [{ code: "no_round" }], drafts: [] };
  if (round.status !== "funded" || round.funded_amount == null) {
    return {
      inserted: 0,
      warnings: [{ code: "missing_funded_amount", funding_round_id: roundId }],
      drafts: []
    };
  }

  const attributions = (await db.query(SQL_ATTRIBUTIONS_FOR_SALE, [saleId])).rows;
  const asOf = saleRow.sold_at || new Date().toISOString();
  const rules = await loadRules(db, saleRow.org_id, "back_end", asOf);
  const product = {
    id: saleRow.product_id,
    name: saleRow.product_name,
    category: saleRow.product_category
  };
  const client = { id: saleRow.client_id, client_code: saleRow.client_code };
  const occurredAt = event.payload?.fundedAt || event.payload?.paidAt || new Date().toISOString();

  const { drafts, warnings } = computeBackEnd({
    org_id: saleRow.org_id,
    sale: saleRow,
    product,
    client,
    round,
    attributions,
    rules,
    occurredAt,
    sourceEvent: event.name || "round.funded"
  });

  const inserted = await insertDrafts(db, drafts);
  return { inserted, warnings, drafts };
}

async function grantForPurchase(db, event, { clientId, product } = {}) {
  const blocked = nothingUnlockedReason({ clientId, product });
  if (blocked) {
    warnNothingUnlocked(event, blocked, { clientId, productCode: product?.code || null });
    return {
      productCode: product?.code || null,
      granted: [], skipped: [], unmapped: true, reason: blocked
    };
  }
  const p = event.payload || {};
  const transactionId = await findTransactionId(db, event.orgId, p.providerRef);
  const out = await grantFromTransaction(db, {
    orgId: event.orgId,
    clientId,
    transactionId,
    productCode: product.code,
    sourceEventId: asUuid(event.id)
  });
  // The mapping table said nothing about this product. Normal, never guessed at,
  // and now readable: src/entitlements/entitlements.mjs unmappedProducts() lists
  // every product still in this state.
  if (out.unmapped) {
    warnNothingUnlocked(event, out.reason || "no_mapping", {
      clientId, productCode: out.productCode
    });
  }

  /* THE CLIENT'S CHECKLIST — owner rule, Chris 2026-09-17: "paying for the
     blueprint should create the client checklist ... the payment process
     generates waypoints."

     HOOKED HERE, inside grantForPurchase, and not at any of its three callers.
     This is the ONE funnel every purchase path already goes through —
     recordPurchase() for diagnostic.paid / deposit.paid / sale.closed, and both
     branches of onPaymentReceivedMoney(). Hooking the funnel is why a payment
     cannot arrive down a path that grants the entitlement and forgets the
     checklist, and why nobody has to remember to add a fourth call site next to
     a fourth payment event.

     It runs AFTER the grant, deliberately. The entitlement is the thing the
     customer paid for; the checklist is how they use it.

     BEST-EFFORT, exactly like src/repair/enroll.mjs:166. seedChecklistForPurchase
     never throws — it catches and reports in its return value. By the time we
     reach this line the money is taken, the sale row is written, the commission
     is booked and the entitlement is granted. A checklist that could not be
     built must never undo any of them.

     IDEMPOTENT THROUGH THIS PATH TOO. Every writer in this module is replay-safe
     and the events bus replays; the seeder upserts on UNIQUE (client_id, key)
     and never touches `state` or `completed_at`. So a replayed payment leaves
     ONE checklist with the client's ticks intact.

     A product that does not create a checklist returns
     { skipped: 'not_a_checklist_product' } and touches nothing. */
  out.checklist = await seedChecklistForPurchase(db, {
    orgId: event.orgId,
    clientId,
    productCode: product.code
  });
  if (out.checklist.ok === false) {
    console.warn(
      `[money-chain] checklist not built for client ${clientId} on ${product.code}: ${out.checklist.error}`
    );
  }

  out.financeOs = await ensureFinanceOsForBlueprintPurchase(db, {
    orgId: event.orgId,
    clientId,
    paidAt: event.occurredAt ? new Date(event.occurredAt) : new Date(),
    productCode: product.code
  }).catch((err) => ({
    created: false,
    subscriptionId: null,
    reason: String(err?.message || err)
  }));
  if (out.financeOs?.created === false && out.financeOs?.reason
      && !["already_entitled", "not_blueprint_product"].includes(out.financeOs.reason)) {
    console.warn(
      `[money-chain] finance-os subscription not opened for client ${clientId} on ${product.code}: ${out.financeOs.reason}`
    );
  }

  out.welcomeKit = await createWelcomeKitTaskForPurchase(db, {
    orgId: event.orgId,
    clientId,
    productCode: product.code
  });

  return out;
}

async function recordPurchase(event, db, { productBucket, paymentKind }) {
  const { sale, product, clientId } = await ensureSale(db, event, { productBucket });
  if (!sale) {
    // Money arrived and no sale row could be written, so no entitlement can be
    // granted either. Say so once, out loud, with the two facts that explain it.
    warnNothingUnlocked(event, "no_sale", {
      clientId: clientId || null,
      productCode: product?.code || null
    });
    return { done: false, reason: "no_sale", clientId: clientId || null };
  }

  await ensureAttributions(db, {
    orgId: event.orgId,
    saleId: sale.id,
    event,
    basisHint: "front_end"
  });

  const pay = await ensureSalePayment(db, event, {
    saleId: sale.id,
    productId: sale.product_id,
    paymentLinkId: event.payload?.paymentLinkId || null,
    saleMotion: event.payload?.saleMotion || sale.sale_motion || null,
    kind: paymentKind
  });

  let commission = { inserted: 0, warnings: [] };
  try {
    commission = await writeFrontEndCommissions(db, {
      saleId: sale.id,
      payment: pay.payment,
      event
    });
  } catch (err) {
    // Replay of adversarial / typo'd huge amounts must not kill the bus.
    if (err && (err.name === "RangeError" || /out of range/i.test(String(err.message || "")))) {
      console.warn(
        `[money-chain] commission refused for sale ${sale.id}: ${err.message}`
      );
      return { done: false, reason: "amount_out_of_range", saleId: sale.id };
    }
    throw err;
  }
  const entitlements = await grantForPurchase(db, event, { clientId, product });

  return {
    done: true,
    saleId: sale.id,
    clientId,
    paymentId: pay.payment?.id || null,
    commissionInserted: commission.inserted,
    entitlements
  };
}

export async function onDiagnosticPaidMoney(event, db) {
  return recordPurchase(event, db, {
    productBucket: "crs",
    paymentKind: paymentKindFor("crs", "diagnostic.paid")
  });
}

export async function onDepositPaidMoney(event, db) {
  const purchase = await recordPurchase(event, db, {
    productBucket: "deposit",
    paymentKind: paymentKindFor("deposit", "deposit.paid")
  });
  if (!purchase.done) return purchase;
  if (!purchase.paymentId || !purchase.clientId) {
    throw new Error("Paid deposit has no saved payment or client for the Sales card.");
  }
  const salesCard = await moveCardToStage(db, {
    orgId: event.orgId,
    clientId: purchase.clientId,
    pipelineKey: "sales",
    stageKey: "closed_won"
  });
  if (!salesCard.moved) {
    throw new Error(`Paid deposit did not reach Closed Won: ${salesCard.reason || "unknown"}`);
  }
  return { ...purchase, salesCard };
}

export async function onSaleClosedMoney(event, db) {
  const bucket = event.payload?.product || "diy";
  if (!event.payload?.product) {
    // A sale.closed carrying no product bucket gets filed under the DIY
    // consulting package by this default, and that default is how a repair sale
    // ended up on consulting-package (live audit 2026-08-18). Dropping the
    // default would silently stop writing sales for the emitters that lean on
    // it (api/dashboard/seed.mjs, scripts/demo-journey.mjs), and what a
    // productless sale.closed means is an owner decision — so it stays, but it
    // no longer happens quietly.
    console.warn(
      `${PRODUCT_ASSUMED}: sale.closed carried no product bucket; filing it as ` +
      `'diy' → ${BUCKET_TO_CODE.diy} (org=${event?.orgId || "?"}). ` +
      `If this was a repair or course sale it is now on the wrong product.`
    );
  }
  return recordPurchase(event, db, {
    productBucket: bucket,
    paymentKind: paymentKindFor(bucket, "sale.closed")
  });
}

/* THE SUCCESS-FEE INVOICE A RECEIPT PAYS, or null. (N1, live 2026-09-18.)
 *
 * WHY THIS EXISTS. Sim Eight-Funding paid INV-B4B9C768 — the $2,500 success
 * fee on his $3,000 Card Stacking DFY sale. The pay link for a bill is minted
 * by src/workflows/ar-collections.mjs with purpose 'custom', so the receipt
 * reached this handler as product 'unmatched', was hung on "the newest funding
 * sale" by guess, and was booked as kind 'installment' — FRONT-END money paid
 * against the $3,000 price. The same receipt then paid the invoice
 * (src/invoices/allocate.mjs). One receipt, counted as the sale's price paid
 * AND as the fee paid.
 *
 * 011_sales.sql already has the right shape: 'success_fee' is the sale's BACK
 * END, a separate kind from the deposit and the installments paid against the
 * agreed price. A receipt that names a success-fee invoice is that back end,
 * on the invoice's own sale. Nothing else about it changes — partner accrual
 * (ACCRUABLE_KINDS), affiliate cash and commissions read success_fee exactly as
 * they read installment, so no one's pay moves.
 *
 * Scoped to the client and org the money was already resolved to: an invoice
 * id off a payload is never trusted to name somebody else's bill. */
async function successFeeInvoiceFor(db, { orgId, clientId, invoiceId }) {
  if (!orgId || !clientId || !asUuid(invoiceId)) return null;
  const { rows } = await db.query(
    `SELECT id, sale_id FROM invoices
      WHERE id = $1 AND org_id = $2 AND client_id = $3
        AND (source = 'funding_success_fee' OR invoice_type = 'success_fee')
      LIMIT 1`,
    [invoiceId, orgId, clientId]
  );
  return rows[0] || null;
}

/**
 * payment.received — attach money to an existing sale, or create one only when
 * our payment link carries durable product identity. Unknown/unlinked products
 * still do not invent a sale.
 */
export async function onPaymentReceivedMoney(event, db) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) {
    // The single loudest case: a real payment whose client we cannot identify.
    // Every Commas-sourced payment event measured on 2026-08-18 landed here,
    // because the inbox row carries no clientId and the payload email is the
    // only fallback. Nothing is written and nothing unlocks — say which.
    warnNothingUnlocked(event, "no_client", {
      productCode: event.payload?.productName || event.payload?.product || null
    });
    return { done: false, reason: "no_client" };
  }

  const p = event.payload || {};
  let linkContext = null;
  if (p.paymentLinkId) {
    linkContext = (await db.query(
      `SELECT id, product_id, sale_id, sale_motion,
              closer_staff_id, sales_manager_staff_id
         FROM payment_links
        WHERE id = $1 AND org_id = $2 AND client_id = $3
        LIMIT 1`,
      [p.paymentLinkId, orgId, clientId]
    )).rows[0] || null;
    if (!linkContext) {
      return {
        done: false,
        reason: "payment_link_context_conflict",
        detail: "the payment link is not for this client and org"
      };
    }
  }
  const paymentPayload = {
    ...p,
    paymentLinkId: linkContext?.id || p.paymentLinkId || null,
    productId: linkContext?.product_id || p.productId || null,
    saleId: linkContext?.sale_id || p.saleId || null,
    saleMotion: linkContext?.sale_motion || p.saleMotion || null,
    closerId: linkContext?.closer_staff_id || p.closerId || null,
    salesManagerId: linkContext?.sales_manager_staff_id || p.salesManagerId || null
  };
  const paymentEvent = { ...event, payload: paymentPayload };
  const bucket = paymentPayload.product || null;
  const ext = saleExternalRef(event);
  const feeInvoice = await successFeeInvoiceFor(db, {
    orgId, clientId, invoiceId: paymentPayload.invoiceId
  });

  let sale = null;
  if (paymentPayload.saleId) {
    sale = (await db.query(
      `SELECT * FROM sales
        WHERE id = $1 AND org_id = $2 AND client_id = $3
          AND ($4::uuid IS NULL OR product_id = $4)
          AND sale_motion IS NOT DISTINCT FROM $5::text
        LIMIT 1`,
      [
        paymentPayload.saleId,
        orgId,
        clientId,
        paymentPayload.productId,
        paymentPayload.saleMotion
      ]
    )).rows[0] || null;
    if (!sale) {
      return {
        done: false,
        reason: "sale_context_conflict",
        detail: "the stored sale does not match this client, product, and motion"
      };
    }
  }
  if (ext) {
    sale ||= (await db.query(
      `SELECT * FROM sales
        WHERE org_id = $1 AND external_ref = $2 AND client_id = $3
          AND ($4::uuid IS NULL OR product_id = $4)
          AND sale_motion IS NOT DISTINCT FROM $5::text
        LIMIT 1`,
      [
        orgId,
        ext,
        clientId,
        paymentPayload.productId,
        paymentPayload.saleMotion
      ]
    )).rows[0] || null;
  }
  // A success fee belongs to the sale its invoice bills, not to whichever
  // funding sale happens to be newest.
  if (!sale && feeInvoice?.sale_id) {
    sale = (await db.query(
      `SELECT * FROM sales WHERE id = $1 AND org_id = $2 AND client_id = $3 LIMIT 1`,
      [feeInvoice.sale_id, orgId, clientId]
    )).rows[0] || null;
  }
  if (!sale) {
    const productId = await resolveProductId(db, orgId, {
      productId: paymentPayload.productId,
      productName: paymentPayload.productName || paymentPayload.product || null,
      productBucket: bucket
    });
    if (productId) {
      sale = (await db.query(
        `SELECT * FROM sales
          WHERE org_id = $1 AND client_id = $2 AND product_id = $3 AND status = 'active'
            AND sale_motion IS NOT DISTINCT FROM $4::text
          ORDER BY sold_at DESC LIMIT 1`,
        [orgId, clientId, productId, paymentPayload.saleMotion]
      )).rows[0] || null;
    }
  }

  if (!sale && paymentPayload.paymentLinkId && paymentPayload.productId) {
    ({ sale } = await ensureSale(db, paymentEvent, { productBucket: bucket }));
  }

  if (!sale && (bucket === "success_fee" || bucket === "unmatched" || !bucket)) {
    sale = (await db.query(
      `SELECT s.* FROM sales s
         JOIN products pr ON pr.id = s.product_id
        WHERE s.org_id = $1 AND s.client_id = $2 AND s.status = 'active'
          AND pr.category = 'funding'
        ORDER BY s.sold_at DESC LIMIT 1`,
      [orgId, clientId]
    )).rows[0] || null;
  }

  if (!sale) {
    const productId = await resolveProductId(db, orgId, {
      productId: paymentPayload.productId,
      productName: paymentPayload.productName || null,
      productBucket: bucket
    });
    const product = await loadProduct(db, productId);
    const entitlements = await grantForPurchase(db, event, { clientId, product });
    return { done: true, saleId: null, entitlements, reason: "no_sale_yet" };
  }

  if (paymentPayload.paymentLinkId) {
    await db.query(
      `UPDATE payment_links
          SET sale_id = COALESCE(sale_id, $2)
        WHERE id = $1 AND org_id = $3
          AND (sale_id IS NULL OR sale_id = $2)`,
      [paymentPayload.paymentLinkId, sale.id, orgId]
    );
  }

  await ensureAttributions(db, {
    orgId,
    saleId: sale.id,
    event: paymentEvent,
    basisHint: "front_end"
  });

  const kind = feeInvoice ? "success_fee" : paymentKindFor(bucket, "payment.received");
  const pay = await ensureSalePayment(db, paymentEvent, {
    saleId: sale.id,
    productId: sale.product_id,
    paymentLinkId: paymentPayload.paymentLinkId,
    saleMotion: paymentPayload.saleMotion || sale.sale_motion || null,
    kind
  });
  const commission = await writeFrontEndCommissions(db, {
    saleId: sale.id,
    payment: pay.payment,
    event: paymentEvent
  });
  const product = await loadProduct(db, sale.product_id);
  const entitlements = await grantForPurchase(db, paymentEvent, { clientId, product });

  return {
    done: true,
    saleId: sale.id,
    paymentId: pay.payment?.id || null,
    paymentCreated: pay.created,
    commissionInserted: commission.inserted,
    entitlements
  };
}

export async function ensureFundingRound(db, event, { status = "started" } = {}) {
  const orgId = event.orgId;
  const clientId = await resolveClient(db, event);
  if (!orgId || !clientId) return { round: null, created: false, clientId };

  const p = event.payload || {};
  const roundNumber = Number(p.roundNumber ?? p.round_number ?? 1);
  if (!Number.isInteger(roundNumber) || roundNumber < 1) {
    return { round: null, created: false, clientId, reason: "invalid_round_number" };
  }
  const sourceEventId = asUuid(event.id);

  if (p.fundingRoundId) {
    const existing = await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1 AND org_id = $2 AND client_id = $3 LIMIT 1`,
      [p.fundingRoundId, orgId, clientId]
    );
    // An explicit round reference is exact; never fall back to another buyer's round.
    return { round: existing.rows[0] || null, created: false, clientId };
  }

  if (sourceEventId) {
    const byEvent = await db.query(
      `SELECT * FROM funding_rounds WHERE org_id = $1 AND source_event_id = $2 LIMIT 1`,
      [orgId, sourceEventId]
    );
    if (byEvent.rows[0]) {
      return { round: byEvent.rows[0], created: false, clientId };
    }
  }

  const byNum = await db.query(
    `SELECT * FROM funding_rounds WHERE org_id = $1 AND client_id = $2 AND round_number = $3 LIMIT 1`,
    [orgId, clientId, roundNumber]
  );
  if (byNum.rows[0]) {
    return { round: byNum.rows[0], created: false, clientId };
  }

  const ins = await db.query(
    `INSERT INTO funding_rounds (
       org_id, client_id, round_number, status, product,
       submitted_amount, approved_amount, funded_amount, source_event_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (client_id, round_number) DO NOTHING
     RETURNING *`,
    [
      orgId,
      clientId,
      roundNumber,
      status,
      p.product || p.productName || null,
      p.submittedAmount ?? null,
      p.approvedAmount ?? null,
      p.fundedAmount ?? null,
      sourceEventId
    ]
  );
  if (ins.rows[0]) return { round: ins.rows[0], created: true, clientId };

  const again = await db.query(
    `SELECT * FROM funding_rounds WHERE org_id = $1 AND client_id = $2 AND round_number = $3 LIMIT 1`,
    [orgId, clientId, roundNumber]
  );
  return { round: again.rows[0] || null, created: false, clientId };
}

export async function onRoundStartedMoney(event, db) {
  const { round, clientId } = await ensureFundingRound(db, event, { status: "started" });
  if (!round) return { done: false, reason: "no_round" };

  const link = await db.query(SQL_LINK_ROUND_TO_SALE, [event.orgId, round.id]);

  let saleId = link.rows[0]?.sale_id || null;
  if (!saleId && event.payload?.saleId) {
    const explicit = await db.query(
      `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
       VALUES ($1,$2,$3,'explicit')
       ON CONFLICT (funding_round_id) DO NOTHING
       RETURNING sale_id`,
      [event.orgId, round.id, event.payload.saleId]
    );
    saleId = explicit.rows[0]?.sale_id || event.payload.saleId;
  }

  if (saleId) {
    await ensureAttributions(db, {
      orgId: event.orgId,
      saleId,
      event,
      basisHint: "back_end"
    });
  }

  // Per-bureau inquiry gate — attach status; if all blocked, task the closer.
  // Never refuses to start the round.
  let bureauGate = null;
  if (clientId) {
    bureauGate = await attachGateToRound(db, {
      orgId: event.orgId,
      clientId,
      fundingRoundId: round.id
    });
  }

  return {
    done: true,
    fundingRoundId: round.id,
    saleId,
    clientId,
    bureauGate: bureauGate?.status || null,
    bureauGateTaskId: bureauGate?.task?.id || null
  };
}

/* THE PERSON ROW FOLLOWS THE ROUNDS (hole 8).
   clients.funded and clients.funded_amount are the outcome labels every other
   screen reads — the Client Control Panel's "Funded" line, the pipeline
   board, the sales metrics, the agent context. Nothing ever wrote them, so on
   the 2026-09-17 live walk Sim Eight-Funding had two funded $25,000 rounds and
   the person row still said funded = false with no amount.

   Called right after a round is written funded, so it runs on every path that
   funds a round (the board's Funded drag and any replay of round.funded both
   arrive here). funded_amount is the total of the client's funded rounds. If
   any funded round has no amount on it the total is unknown and stays NULL —
   never a partial sum, never 0. Only ever sets funded to true; it never
   un-funds a client. Idempotent. */
export const SQL_SYNC_CLIENT_FUNDED = `
  UPDATE clients c
     SET funded = true,
         funded_amount = s.total
    FROM (
      SELECT CASE WHEN bool_and(fr.funded_amount IS NOT NULL)
                  THEN SUM(fr.funded_amount) END AS total
        FROM funding_rounds fr
       WHERE fr.client_id = $1
         AND fr.org_id = $2
         AND fr.status = 'funded'
      HAVING count(*) > 0
    ) s
   WHERE c.id = $1
     AND c.org_id = $2
  RETURNING c.id, c.funded, c.funded_amount`;

export async function syncClientFunded(db, { clientId, orgId } = {}) {
  if (!clientId || !orgId) return null;
  return (await db.query(SQL_SYNC_CLIENT_FUNDED, [clientId, orgId])).rows[0] || null;
}

/**
 * Read-only funding result identity gate. A funded event belongs to exactly the
 * existing round named by its org and buyer; a bad explicit ID must NOT fall
 * back to another round. Never call lead-creating resolveClient on this path.
 */
export async function findRoundForFundedEvent(db, event) {
  const orgId = event?.orgId;
  const p = event?.payload || {};
  if (!orgId) return null;

  let clientId = event.clientId || null;
  if (!clientId) {
    const email = String(p.email || "").trim().toLowerCase();
    if (!email) return null;
    const owner = await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [orgId, email]
    );
    clientId = owner.rows[0]?.id || null;
  }
  if (!clientId) return null;

  const suppliedRoundNumber = p.roundNumber ?? p.round_number ?? null;
  if (suppliedRoundNumber != null &&
      (!Number.isInteger(Number(suppliedRoundNumber)) || Number(suppliedRoundNumber) <= 0)) {
    return null;
  }

  let row;
  if (p.fundingRoundId) {
    row = (await db.query(
      `SELECT * FROM funding_rounds WHERE id = $1 AND org_id = $2 AND client_id = $3 LIMIT 1`,
      [p.fundingRoundId, orgId, clientId]
    )).rows[0] || null;
  } else {
    // An unspecified round number must not silently borrow round 1 (or latest).
    if (suppliedRoundNumber == null) return null;
    row = (await db.query(
      `SELECT * FROM funding_rounds
        WHERE org_id = $1 AND client_id = $2 AND round_number = $3 LIMIT 1`,
      [orgId, clientId, Number(suppliedRoundNumber)]
    )).rows[0] || null;
  }
  if (!row || String(row.org_id) !== String(orgId) ||
      String(row.client_id) !== String(clientId)) return null;
  if (suppliedRoundNumber != null &&
      Number(row.round_number) !== Number(suppliedRoundNumber)) return null;
  return row;
}

export async function onRoundFundedMoney(event, db) {
  const p = event?.payload || {};
  // This is an existing paid customer's downstream funding result, not intake.
  // A foreign ID, unknown buyer or mismatched round must fail before ANY
  // status, commission, closeout, email or client update.
  let round = await findRoundForFundedEvent(db, event);
  if (!round) {
    console.error(
      `[money-chain] round.funded refused: no owned existing round ` +
      `(org=${event?.orgId || "?"} event=${event?.id || "?"}).`
    );
    return {
      done: false,
      reason: "no_prior_round",
      detail: "round.funded requires an existing round owned by the event organization and buyer"
    };
  }

  // A supplied sale may not be borrowed from another org/client or product.
  // Also refuse an incoming sale ID that contradicts this round's frozen link.
  // Check BEFORE marking the round funded, not after the ledger changes.
  const frozenLink = await db.query(SQL_SALE_FOR_ROUND, [round.id]);
  const linkedSaleId = frozenLink.rows[0]?.sale_id || null;
  if (linkedSaleId && p.saleId && String(linkedSaleId) !== String(p.saleId)) {
    return { done: false, reason: "sale_context_conflict" };
  }
  if (linkedSaleId || p.saleId) {
    const saleId = linkedSaleId || p.saleId;
    const owner = await db.query(
      `SELECT s.id FROM sales s
         JOIN products pr ON pr.id = s.product_id AND pr.category = 'funding'
        WHERE s.id = $1 AND s.org_id = $2 AND s.client_id = $3
          AND s.status = 'active' LIMIT 1`,
      [saleId, event.orgId, round.client_id]
    );
    if (!owner.rows[0]) return { done: false, reason: "sale_context_conflict" };
  }

  const fundedAmount = p.fundedAmount != null
    ? Number(p.fundedAmount)
    : (round.funded_amount != null ? Number(round.funded_amount) : null);
  const approvedAmount = p.approvedAmount != null ? Number(p.approvedAmount) : null;
  if (!Number.isFinite(fundedAmount) || fundedAmount <= 0) {
    return {
      done: false,
      reason: "missing_funded_amount",
      detail: "round.funded requires the actual fundedAmount; approved amount is not a substitute"
    };
  }

  /* NO BANK YES, NO FUNDED ROUND — the same rule the card board enforces
     (guardFundedAmount in src/funding/card-stacking-rounds.mjs), enforced again
     here because the board is not the only way this event arrives. An event
     replay, the verification harness or any future caller can emit round.funded
     straight at this handler and walk past the board's refusal.

     WHY IT MATTERS. The success fee is a percent of CONFIRMED APPROVALS
     (docs/finance/CLOSEOUT-FEE-BASIS.md). A card-stacking round closed with no bank yes
     on it can never be invoiced, and once it is closed nobody goes back for it.
     Measured 2026-09-16 on the live walk: round 1 on Sim Eight-Funding was
     marked funded for $25,000 with zero application rows.

     SCOPE. Card-stacking rounds only. The alt-fin rail (src/adapters/lendflow.mjs)
     records no per-bank application rows at all, so the same test there would
     refuse every genuine Lendflow funding. That rail's rounds are not billed off
     confirmed approvals, so they are left exactly as they were.

     An ALREADY-funded round is never re-blocked: replays of a delivered event
     are routine and must stay idempotent. */
  const alreadyFunded = round.status === "funded" && Number(round.funded_amount) > 0;
  const isCardStacking = String(round.product || "") === CARD_STACKING_PRODUCT;
  if (!alreadyFunded && isCardStacking) {
    const orgForRound = round.org_id || event.orgId || null;
    const confirmed = await listConfirmedApprovals(db, {
      orgId: orgForRound,
      fundingRoundId: round.id
    });
    /* Same carve-out as the board guard: a round where every bank yes was
       explicitly marked as not counting has been looked at by a human and
       closes. Only a round with nothing recorded on it at all is refused. */
    const excused = confirmed.length
      ? []
      : await listExcludedApprovals(db, { orgId: orgForRound, fundingRoundId: round.id });
    if (!confirmed.length && !excused.length) {
      console.error(
        `[money-chain] round.funded refused: no confirmed bank approval on the round ` +
        `(org=${event.orgId} client=${event.clientId || "?"} round=${round.id}).`
      );
      return {
        done: false,
        reason: NO_CONFIRMED_APPROVALS,
        detail:
          "round.funded on a card-stacking round requires at least one Approved " +
          "application with a dollar amount recorded against it"
      };
    }
  }

  /* THE ROUND'S APPROVED FIGURE IS NOT OURS TO WRITE when the round has per-bank
     rows. Migration 382 keeps funding_rounds.approved_amount equal to the
     confirmed approvals on the round by trigger; writing the event payload over
     the top is the drift that left $25,000 in the round box against a $10,000
     bank yes. A round with NO application rows at all is untouched by that
     trigger (an imported summary, or the alt-fin rail), so there the payload is
     still the only source and is still used. Passing null keeps COALESCE on the
     stored value — an unknown stays unknown, it never becomes 0. */
  const hasApplicationRows = (await db.query(
    `SELECT 1 FROM applications WHERE funding_round_id = $1 LIMIT 1`,
    [round.id]
  )).rows.length > 0;
  const approvedAmountToWrite = hasApplicationRows ? null : approvedAmount;

  const updated = await db.query(
    `UPDATE funding_rounds
        SET status = 'funded',
            funded_amount = COALESCE($2, funded_amount),
            approved_amount = COALESCE($3, approved_amount),
            updated_at = now()
      WHERE id = $1 AND org_id = $4 AND client_id = $5
      RETURNING *`,
    [round.id, fundedAmount, approvedAmountToWrite, event.orgId, round.client_id]
  );
  round = updated.rows[0] || round;

  // The person row says funded too, from the rounds (hole 8).
  await syncClientFunded(db, { clientId: round.client_id, orgId: round.org_id });

  let link = await db.query(SQL_SALE_FOR_ROUND, [round.id]);
  if (!link.rows[0]) {
    await db.query(SQL_LINK_ROUND_TO_SALE, [event.orgId, round.id]);
    if (p.saleId) {
      await db.query(
        `INSERT INTO funding_round_sales (org_id, funding_round_id, sale_id, link_method)
         VALUES ($1,$2,$3,'explicit')
         ON CONFLICT (funding_round_id) DO NOTHING`,
        [event.orgId, round.id, p.saleId]
      );
    }
    link = await db.query(SQL_SALE_FOR_ROUND, [round.id]);
  }

  const saleId = link.rows[0]?.sale_id || null;
  if (saleId) {
    await ensureAttributions(db, {
      orgId: event.orgId,
      saleId,
      event,
      basisHint: "back_end"
    });
  }

  const commission = await writeBackEndCommissions(db, { roundId: round.id, event });

  // Success-fee closeout from CONFIRMED APPROVALS (owner-set 2026-08-30).
  // Idempotent per round. Refuses — no row, named reason — when nothing on the
  // round is confirmed or the sale agreed no rate. It never writes a $0 fee.
  //
  // feePercentUnits, not feePercent: the event carries PERCENT UNITS (10 = 10%)
  // while funding_closeout.fee_percent stores a fraction (0.10). Passing the
  // payload straight into the old `feePercent` argument silently fell back to a
  // hardcoded 10% for every rate that was not 10. Omitted, the rate is read
  // from the sale — which is where it belongs on both funding rails.
  const closeout = await createFundingCloseoutSafe(db, {
    orgId: event.orgId,
    fundingRoundId: round.id,
    feePercentUnits: p.feePercent != null ? Number(p.feePercent) : null
  });

  // Distinct from round.funded — inquiry gate (and anything else between rounds)
  // listens here. Idempotent per funding_round_id.
  let closeoutEvent = null;
  if (closeout.closeout?.id) {
    // The already-validated round owner is authoritative; never create or
    // patch a CRM contact from an incoming funding result.
    const clientId = round.client_id;
    closeoutEvent = await emit(
      db,
      "round.closeout",
      {
        fundingRoundId: round.id,
        closeoutId: closeout.closeout.id,
        created: !!closeout.created
      },
      {
        orgId: event.orgId,
        clientId: clientId || null,
        idempotencyKey: `round.closeout:${round.id}`
      }
    );
  }

  return {
    done: true,
    fundingRoundId: round.id,
    saleId,
    commissionInserted: commission.inserted,
    warnings: commission.warnings,
    closeoutId: closeout.closeout?.id || null,
    closeoutError: closeout.error || null,
    closeoutEventId: closeoutEvent?.id || null
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   MONEY THAT LEFT AGAIN — refunds and chargebacks reach the partner ledger.

   THE HOLE THIS CLOSES. src/partners/revenue.mjs has had voidForRefund() since
   the accrual writer shipped: built, unit-tested, proved against real Postgres —
   and called by absolutely nothing. So a refund issued today left the partner's
   accrual sitting at status 'accrued', payable, as though the money were still
   in the building. The next payout run would pay a half-share of cash that had
   already gone back to the customer.

   WHAT A REVERSAL IS, AND IS NOT.
     * It is a VOID WITH A REASON. 042_partners.sql raises on DELETE and CHECKs
       that gross and share are >= 0, so a reversal cannot be a negative row and
       cannot be a deletion. The row stays, marked void, naming the refund.
     * It is NOT A CLAWBACK. Owner-set (W0-decisions.md): the partner is never
       chased for money already paid out. If the accrual was already settled
       through a payout line, the void records the fact and the shortfall is
       fundhub's. Nothing here recovers it, and nothing here should be extended
       to.

   WHY A CHARGEBACK REVERSES TOO, when src/handlers/commas-disputes.mjs says it
   deliberately does not touch the money. That file's job is the RESPONSE
   DEADLINE — it turns a dispute into an urgent task and says so. The money
   question it left open is answered here, and the answer is: the processor pulls
   the funds when the dispute opens, not when it is decided, so an accrual that
   still reads 'accrued' is describing money that is not there. The two handlers
   are registered independently and both run; neither replaces the other.

   THE GAP THAT COMES WITH THAT, stated rather than hidden: A DISPUTE WE LATER
   WIN DOES NOT UN-VOID ITSELF. There is no dispute.won event on the bus, so
   nothing re-accrues when the money comes back. The voided row's void_reason
   starts with "chargeback:" precisely so those rows can be listed and corrected
   by hand. Closing it properly needs a won/lost outcome event, which is a
   separate unit.

   WHAT IS STILL NOT REVERSED, and is not this unit's to decide:
     * STAFF COMMISSION (commission_ledger). Whether a closer's pay is reversed
       on a refund is an open policy question —
       src/commissions/commission-model-open-questions.md.
     * THE AFFILIATE'S CUT (src/affiliates/economics.mjs). convert() has no
       inverse yet.
     * ENTITLEMENTS. A refunded course is still unlocked.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Greppable prefixes. One per case where money moved and the ledger did not. */
export const REVERSAL_REFUSED = "[money-chain] reversal refused";
export const REVERSAL_APPLIED = "[money-chain] reversal applied";

/** void_reason prefixes. `chargeback:` is the one a won dispute is found by. */
export const REVERSAL_PREFIX = Object.freeze({
  "payment.refunded": "refund",
  "payment.disputed": "chargeback"
});

/**
 * The processor's reference for the payment BEING REVERSED.
 *
 * A refund and its original payment share one payment id in Commas' model, and
 * normalizeCommasEvent puts that id on `providerRef` for every event it emits —
 * so the same reference that created the transaction row is the one that finds
 * it again. The two `original*` keys are checked first because that assumption
 * is not confirmed against a live refund payload: if Commas turns out to send
 * the REFUND's own id under `payment_id`, an adapter can put the original on
 * `originalProviderRef` and this keeps working with no change here.
 */
export function reversalProviderRef(event) {
  const p = event?.payload || {};
  const ref = p.originalProviderRef || p.originalPaymentId || p.providerRef || p.paymentId;
  return ref ? String(ref) : null;
}

/**
 * How much went back, in integer cents, or null when the event does not say.
 *
 * Amounts arrive in major units. Some processors express a reversal as a
 * negative, so the magnitude is what counts — a refund of -3000 and a refund of
 * 3000 are the same $3,000 leaving.
 */
export function reversedCents(event) {
  const raw = event?.payload?.amount;
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  const cents = toCents(Math.abs(n));
  return cents > 0 ? cents : null;
}

/**
 * Find the accrual keys of the ORIGINAL payment from the reversal's reference.
 *
 * partner_revenue rows are keyed on the original payment's transaction_id and
 * source_event_id. The reversal event knows neither — it knows the processor's
 * reference. transactions.provider_ref is the bridge (client-lifecycle.mjs
 * writes that row on payment.received, ensureSalePayment reads it back the same
 * way), and the sale_payments row hanging off that transaction carries the event
 * id the accrual may have been keyed by instead.
 *
 * Both keys are returned and both are handed to voidForRefund, because an
 * accrual written when the transaction row did not yet exist is keyed on the
 * event id alone.
 */
export async function findOriginalPaymentKeys(db, orgId, providerRef) {
  const empty = { transactionId: null, sourceEventId: null, payment: null };
  if (!orgId || !providerRef) return empty;

  const transactionId = await findTransactionId(db, orgId, providerRef);
  if (!transactionId) return empty;

  const { rows } = await db.query(
    `SELECT id, sale_id, amount, source_event_id
       FROM sale_payments
      WHERE org_id = $1 AND transaction_id = $2
      ORDER BY paid_at ASC
      LIMIT 1`,
    [orgId, transactionId]
  );
  return {
    transactionId,
    sourceEventId: asUuid(rows[0]?.source_event_id) || null,
    payment: rows[0] || null
  };
}

/**
 * Drive one reversal into the partner ledger. Shared by both handlers because a
 * refund and a chargeback differ only in the word written into void_reason and
 * in what happens afterwards, which is a person's job either way.
 */
async function reversePartnerRevenue(event, db) {
  const orgId = event?.orgId;
  const prefix = REVERSAL_PREFIX[event?.name] || "reversal";
  if (!orgId) return { reversed: false, reason: "no_org" };

  const providerRef = reversalProviderRef(event);
  const keys = await findOriginalPaymentKeys(db, orgId, providerRef);

  if (!keys.transactionId && !keys.sourceEventId) {
    /* No original payment on file, so there is nothing to point a void at. This
       is the loud one: real money went back and the partner's book still says it
       arrived. Refusing beats guessing — matching a reversal to an accrual by
       amount would eventually reverse somebody else's deal. */
    console.warn(
      `${REVERSAL_REFUSED}: no_original_payment ` +
      `(org=${orgId} event=${event.name} ref=${providerRef || "none"}). ` +
      `Money was ${prefix === "chargeback" ? "charged back" : "refunded"} but no ` +
      `original payment could be matched, so no partner accrual was voided. ` +
      `Check the partner's balance by hand.`
    );
    return { reversed: false, reason: "no_original_payment", providerRef };
  }

  /* The reason is mandatory in the database (partner_revenue_void_ck) and is the
     only trace of WHY a row went void, so it carries the word and the reference. */
  const reason = `${prefix}:${providerRef || `event:${event.id}`}`;

  /* HOW MUCH SURVIVED. The event says what went back; voidForRefund subtracts it
     from the gross on the row it actually voided and re-accrues the remainder at
     the ORIGINAL frozen rate. A reversal for the full amount leaves nothing, so
     nothing is re-accrued.

     AN UNREADABLE AMOUNT VOIDS IN FULL. There is no honest partial when the size
     of the refund is unknown, and leaving the accrual standing would pay a half
     share of money that has gone. Voiding all of it is the conservative answer
     and it is said out loud, because a partner owed part of it has to be put
     back by hand. */
  const refundedCents = reversedCents(event);
  if (refundedCents === null) {
    console.warn(
      `${REVERSAL_REFUSED}: unknown_reversal_amount ` +
      `(org=${orgId} event=${event.name} ref=${providerRef || "none"}). ` +
      `The accrual is being voided in full because the event carries no readable ` +
      `amount. If only part of the payment went back, the partner's surviving ` +
      `share must be restored by hand.`
    );
  }

  const out = await voidForRefund(db, {
    orgId,
    transactionId: keys.transactionId,
    sourceEventId: keys.sourceEventId,
    reason,
    refundedCents
  });

  if (out.voided > 0) {
    console.warn(
      `${REVERSAL_APPLIED}: ${prefix} (org=${orgId} ref=${providerRef || "none"} ` +
      `voided=${out.voided} reaccrued=${out.reaccrued}). ` +
      `NO CLAWBACK — anything already paid to the partner stays paid.`
    );
  }

  return {
    reversed: out.voided > 0,
    reason: out.reason,
    voided: out.voided,
    reaccrued: out.reaccrued,
    voidedIds: out.voidedIds || [],
    reaccrualId: out.reaccrualId || null,
    netCents: out.netCents ?? null,
    providerRef,
    transactionId: keys.transactionId,
    salePaymentId: keys.payment?.id || null
  };
}

/**
 * payment.refunded — money we sent back. Void the partner's accrual for it, and
 * re-accrue whatever the refund did not cover.
 */
export async function onPaymentRefundedMoney(event, db) {
  return reversePartnerRevenue(event, db);
}

/**
 * payment.disputed — money the processor pulled while a chargeback is decided.
 * Same void, a different word in void_reason, and no automatic way back if the
 * dispute is won. See the block comment above.
 */
export async function onPaymentDisputedMoney(event, db) {
  return reversePartnerRevenue(event, db);
}

export function register() {
  on("diagnostic.paid", onDiagnosticPaidMoney);
  on("deposit.paid", onDepositPaidMoney);
  on("sale.closed", onSaleClosedMoney);
  on("payment.received", onPaymentReceivedMoney);
  on("round.started", onRoundStartedMoney);
  on("round.funded", onRoundFundedMoney);
  /* Money that left again. Registered here rather than in commas-disputes.mjs so
     the partner ledger has exactly one owner module, and so a reversal that
     fails cannot stop the urgent chargeback task that handler creates — the bus
     catches per handler and dead-letters, and this one is registered first. */
  on("payment.refunded", onPaymentRefundedMoney);
  on("payment.disputed", onPaymentDisputedMoney);
}
