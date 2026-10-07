// payment.received (Commas) → mark a Clarity Payment / BNPL installment paid.
//
// The rule and the write live in src/finance/clarity-autopay.mjs. This file
// only decides whether a payment.received is one worth looking at, and hands
// it over. It never throws for a payment that simply does not fit a plan; a
// database fault does throw, so the bus dead-letters it and a replay retries
// (the claim key makes the retry safe).
//
// Commas only. Fundhub takes no Whop payments of its own: the Whop webhook in
// this repo (src/merchant/) is a CLIENT'S own sales and never emits
// payment.received.
import { on } from "../events/registry.mjs";
import { toCents } from "../commissions/money.mjs";
import { applyCommasPayment, notForAPlan } from "../finance/clarity-autopay.mjs";
import { isFinanceOsSetupLink } from "../finance/money-setup.mjs";

async function isSetupLink(db, linkId) {
  if (!linkId) return false;
  const r = await db.query(`SELECT purpose, description FROM payment_links WHERE id = $1 LIMIT 1`, [linkId]);
  return isFinanceOsSetupLink(r.rows[0] || null);
}

/** Exported for tests. `deps.apply` swaps the store call. */
export async function onPaymentReceivedForClarity(event, db, deps = {}) {
  const p = (event && event.payload) || {};
  if (p.source !== "commas") return { outcome: "skip", reason: "not_commas" };
  if (!p.paymentId) return { outcome: "skip", reason: "no_payment_id" };
  if (!event.clientId) return { outcome: "skip", reason: "no_client" };

  let why = notForAPlan({ product: p.product, purpose: p.purpose });
  if (!why && String(p.purpose || "").toLowerCase() === "custom" && await isSetupLink(db, p.paymentLinkId)) {
    why = "financeos_setup_link";
  }
  if (why) return { outcome: "skip", reason: why };

  let amountCents = null;
  try {
    amountCents = p.amount === null || p.amount === undefined || p.amount === "" ? null : toCents(p.amount);
  } catch {
    amountCents = null; // not a number → unknown, never guessed
  }

  const apply = deps.apply || applyCommasPayment;
  return apply(db, {
    orgId: event.orgId,
    clientId: event.clientId,
    paymentId: String(p.paymentId),
    amountCents,
    invoiceId: p.invoiceId || null,
    paymentLinkId: p.paymentLinkId || null
  });
}

export function register() {
  on("payment.received", onPaymentReceivedForClarity);
}
