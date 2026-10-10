// Clarity autopay — a Commas payment to Fundhub marks a Clarity Payment (or a
// buy now, pay later plan) paid, without staff clicking "Record payment".
//
// FinanceOS wave 4, unit H1 (ops/workflows/finance-os-wave4-2026-10-06.md).
// Wired as a payment.received handler: src/handlers/clarity-autopay.mjs.
//
// It moves no money. It writes down money Commas already says landed, through
// the SAME store call the staff button uses (recordClarityPayment in
// src/finance/clarity-payments.mjs): oldest unpaid installment first, never
// more than is left, a plan with nothing left becomes settled.
//
// ═══════════════════════════════════════════════════════════════════════════
// THE MATCHING RULE — strongest key first. If no rule fits, DO NOT GUESS.
//
//   0. Is this payment even a candidate?
//        * it came from Commas and carries a Commas payment id (the
//          idempotency key — no id, nothing is done);
//        * we know whose it is. The adapter already resolved the client from
//          (a) the payment link we minted, (b) the client id we put on the
//          checkout metadata, (c) the payer's email on file
//          (resolveInboxClientId in src/adapters/commas.mjs). No client → stop;
//        * it is not plainly for something else: a known product (the $32
//          assessment, a deposit, DIY letters), a payment link whose purpose is
//          deposit / diagnostic / repair, or the FinanceOS setup-fee link;
//        * the client has at least one open plan. No plan → it is an ordinary
//          payment, not a plan payment. Nothing is written.
//   1. PLAN REFERENCE. The payment names an invoice (checkout metadata or the
//      link's own invoice_id) and exactly one open plan mirrors that invoice
//      (clarity_payments.invoice_id) → that plan, any amount up to what is
//      left. A payment that names an invoice no open plan carries is paying
//      that invoice (the AR ladder owns it) → skipped, nothing written.
//      There is no direct payment-link → plan column today; a link reaches a
//      plan only through the invoice both carry.
//   2. EXACT CLIENT + EXACT AMOUNT. The amount equals one open plan's NEXT
//      unpaid installment (what is left on it), or that plan's FULL remaining
//      balance → that plan. If more than one plan fits, the one whose next
//      payment is due OLDEST wins (oldest-due-first). Two fitting plans due
//      the same day → unmatched.
//   3. Anything else → UNMATCHED: the plan is not touched, and one
//      'payment_unmatched' row goes in money_agent_log for the staff Payments
//      tab.
//
// IDEMPOTENT ON THE COMMAS PAYMENT ID. Whatever the outcome (applied or
// unmatched), it is claimed with one money_agent_log row keyed
// 'commas-payment:<payment id>' (unique per org). The claim and the payment
// are written in ONE transaction, so a failed write leaves neither, and a
// repeat webhook or a dead-letter replay finds the claim and does nothing.
//
// THE MONEY HELPER STOPS. src/finance/money-agent.mjs only looks at
// installments with paid_cents < amount_cents on open plans, and its brain
// answers "paid" for anything with nothing left. A paid installment is never
// chased again (proved in clarity-autopay.test.mjs).
//
// MONEY IS INTEGER CENTS. An unknown amount stays unknown (null) and is never
// matched.

import {
  listClarityPayments as defaultList,
  recordClarityPayment as defaultRecord,
  logMoneyAction as defaultLog
} from "./clarity-payments.mjs";
import { withTransaction as defaultTx } from "../db/with-transaction.mjs";

export const VIA = "commas";
export const KEY_PREFIX = "commas-payment";

/** Canonical product buckets (src/adapters/commas.mjs productOf) that are a
 *  sale of something else, never a plan payment. */
export const NOT_PLAN_PRODUCTS = Object.freeze(new Set(["crs", "deposit", "diy"]));
/** payment_links.purpose values (119) minted for a product, never a plan. */
export const NOT_PLAN_PURPOSES = Object.freeze(new Set(["deposit", "diagnostic", "repair"]));

/** The claim key for one Commas payment. */
export function keyForPayment(paymentId) {
  return `${KEY_PREFIX}:${paymentId}`;
}

const isPosInt = (v) => Number.isSafeInteger(v) && v > 0;

/**
 * notForAPlan({ product, purpose, setupLink }) → a reason string, or null when
 * the payment may be a plan payment. Pure.
 */
export function notForAPlan({ product = null, purpose = null, setupLink = false } = {}) {
  const prod = String(product || "").toLowerCase();
  if (NOT_PLAN_PRODUCTS.has(prod)) return `product:${prod}`;
  const purp = String(purpose || "").toLowerCase();
  if (NOT_PLAN_PURPOSES.has(purp)) return `link_purpose:${purp}`;
  if (setupLink) return "financeos_setup_link";
  return null;
}

/**
 * matchClarityPayment({ plans, amountCents, invoiceId }) → decision. Pure.
 *
 *   plans        planView() rows for ONE client (src/finance/clarity-payments.mjs)
 *   amountCents  integer cents, or null when the payment had no amount
 *   invoiceId    the invoice the payment names, or null
 *
 * decision:
 *   { outcome: 'apply', planId, rule: 'plan_reference' | 'next_installment' | 'full_balance', amountCents }
 *   { outcome: 'unmatched', reason }
 *   { outcome: 'skip', reason }       not a plan payment; nothing is written
 */
export function matchClarityPayment({ plans = [], amountCents = null, invoiceId = null } = {}) {
  const open = (Array.isArray(plans) ? plans : []).filter((p) => p && p.status === "open" && p.left_cents > 0);
  if (!open.length) return { outcome: "skip", reason: "no_open_plan" };

  // 1. plan reference — the invoice the payment names.
  if (invoiceId) {
    const tied = open.filter((p) => p.invoice_id && String(p.invoice_id) === String(invoiceId));
    if (!tied.length) return { outcome: "skip", reason: "pays_an_invoice_no_plan_carries" };
    if (tied.length > 1) return { outcome: "unmatched", reason: "two_plans_share_the_invoice" };
    if (!isPosInt(amountCents)) return { outcome: "unmatched", reason: "no_amount" };
    const p = tied[0];
    if (amountCents > p.left_cents) return { outcome: "unmatched", reason: "more_than_owed" };
    return { outcome: "apply", planId: p.id, rule: "plan_reference", amountCents };
  }

  if (!isPosInt(amountCents)) return { outcome: "unmatched", reason: "no_amount" };

  // 2. exact amount: the next unpaid installment, or the whole balance.
  const fits = [];
  for (const p of open) {
    const next = p.next && p.next.left_cents > 0 ? p.next : null;
    if (next && amountCents === next.left_cents) fits.push({ p, rule: "next_installment", due: next.due_on || "9999-12-31" });
    else if (amountCents === p.left_cents) fits.push({ p, rule: "full_balance", due: (next && next.due_on) || "9999-12-31" });
  }
  if (!fits.length) {
    const most = open.reduce((s, p) => s + p.left_cents, 0);
    return { outcome: "unmatched", reason: amountCents > most ? "more_than_owed" : "amount_does_not_match" };
  }
  fits.sort((a, b) => a.due.localeCompare(b.due));
  if (fits.length > 1 && fits[0].due === fits[1].due) return { outcome: "unmatched", reason: "two_plans_fit" };
  const win = fits[0];
  return { outcome: "apply", planId: win.p.id, rule: win.rule, amountCents };
}

/**
 * applyCommasPayment(conn, payment, deps) → { outcome, reason?, planId?, rule?, settled? }
 *
 * payment: { orgId, clientId, paymentId, amountCents, invoiceId?, paymentLinkId?, paidAt?, sample? }
 *
 * outcome: 'applied' | 'unmatched' | 'skip' | 'already_done'
 */
export async function applyCommasPayment(conn, payment = {}, deps = {}) {
  const list = deps.listClarityPayments || defaultList;
  const record = deps.recordClarityPayment || defaultRecord;
  const log = deps.logMoneyAction || defaultLog;
  const tx = deps.withTransaction || defaultTx;
  const now = deps.now ? deps.now() : new Date();

  const { orgId, clientId, paymentId } = payment;
  if (!paymentId) return { outcome: "skip", reason: "no_payment_id" };
  if (!orgId || !clientId) return { outcome: "skip", reason: "no_client" };
  const amountCents = Number.isSafeInteger(payment.amountCents) ? payment.amountCents : null;
  const today = now.toISOString().slice(0, 10);

  const plans = await list(conn, { orgId, clientId, today });
  const m = matchClarityPayment({ plans, amountCents, invoiceId: payment.invoiceId || null });
  if (m.outcome === "skip") return m;

  const detail = {
    via: VIA,
    payment_id: String(paymentId),
    payment_link_id: payment.paymentLinkId || null,
    invoice_id: payment.invoiceId || null,
    ...(m.outcome === "apply" ? { rule: m.rule, plan_id: m.planId } : { reason: m.reason }),
    ...(payment.sample ? { sample: true } : {})
  };
  const plan = m.outcome === "apply" ? plans.find((p) => p.id === m.planId) : null;
  const paidAt = payment.paidAt ? new Date(payment.paidAt) : now;

  return tx(conn, async (c) => {
    const claim = await log(c, m.outcome === "apply"
      ? {
          orgId, clientId, itemKind: "clarity_payment", itemId: m.planId, itemLabel: plan ? plan.name : null,
          decidedOn: today, action: "payment_recorded", actor: "agent", brain: "rules",
          amountCents, reason: `Paid via Commas (${m.rule})`,
          idempotencyKey: keyForPayment(paymentId), detail
        }
      : {
          orgId, clientId, itemKind: "client", itemId: clientId, itemLabel: "Commas payment",
          decidedOn: today, action: "payment_unmatched", actor: "agent", brain: "rules",
          amountCents, reason: m.reason,
          idempotencyKey: keyForPayment(paymentId), detail
        });
    if (!claim.created) return { outcome: "already_done", reason: "payment_already_handled" };
    if (m.outcome !== "apply") return { outcome: "unmatched", reason: m.reason };

    const r = await record(c, { orgId, clientId, planId: m.planId, amountCents, paidAt });
    if (!r.ok) {
      // Throw so the claim rolls back with it. The bus dead-letters the
      // handler and a replay decides again against the plan as it is then.
      const e = new Error(`clarity autopay: plan ${m.planId} refused the payment (${r.error})`);
      e.code = r.error;
      throw e;
    }
    return { outcome: "applied", planId: m.planId, rule: m.rule, settled: !!r.settled };
  });
}

export default { matchClarityPayment, notForAPlan, applyCommasPayment, keyForPayment };
