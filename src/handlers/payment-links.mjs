// Settle payment_links when Commas says money cleared.
// Prefer link_ref (metadata). Fall back to Commas product/session id so a
// mismatched mint script cannot leave paid money invisible on the board.
import { on } from "../events/registry.mjs";
import { markPaid, markPaidBySession, getByLinkRef } from "../payment-links/index.mjs";
import { toCents } from "../commissions/money.mjs";
import {
  ensureSloPortalForPaidClient,
  isSloCheckoutLinkRef
} from "../slo/buyer.mjs";
import { ensureFinanceOsForSetupPayment, isFinanceOsSetupLink } from "../finance/money-setup.mjs";

async function openSloPortalIfPaid(db, link) {
  if (!link || !isSloCheckoutLinkRef(link.link_ref)) return;
  if (!link.org_id || !link.client_id) return;
  await ensureSloPortalForPaidClient(db, {
    orgId: link.org_id,
    clientId: link.client_id
  });
}

/* Finance OS setup link paid → Finance OS on. Only the setup link; every other
   link returns at isFinanceOsSetupLink and nothing changes for it. Once per link
   (keyed on the link id inside ensureFinanceOsForSetupPayment). A database fault
   throws so the bus dead-letters it; the replay lands in the heal branch below. */
async function turnOnFinanceOsIfSetup(db, link) {
  if (!isFinanceOsSetupLink(link)) return null;
  const out = await ensureFinanceOsForSetupPayment(db, link);
  if (!out.created && out.reason && !["already_granted", "already_entitled"].includes(out.reason)) {
    console.warn(`[payment-links] Finance OS not turned on for link ${link.id}: ${out.reason}`);
  }
  return out;
}

function receiptHint(...values) {
  const present = values.filter((value) => value != null && String(value) !== "").map(String);
  return { value: present[0] || null, conflict: new Set(present).size > 1 };
}

function receiptMatchesLink(link, { orgId, clientId, invoiceId, paymentLinkId, paidAmountCents }) {
  return link && String(link.org_id) === String(orgId) &&
    (!clientId || String(link.client_id) === clientId) &&
    (!invoiceId || String(link.invoice_id) === invoiceId) &&
    (!paymentLinkId || String(link.id) === paymentLinkId) &&
    (link.paid_amount_cents == null || Number(link.paid_amount_cents) === paidAmountCents);
}

export async function onPaymentReceivedForLink(event, db) {
  const p = event.payload || {};
  // Whop settles its own saved link after checking the signed checkout identity.
  // Its pay_ reference must never enter the Commas session column.
  if (event.source === "whop" || p.source === "whop" || p.provider === "whop") return;
  // A paid checkout transition requires its canonical tenant.
  if (!event.orgId) return;
  const paidAmountCents = p.amount != null ? toCents(p.amount) : null;
  // Do not settle a checkout or heal paid access from a missing/zero receipt.
  if (!Number.isSafeInteger(paidAmountCents) || paidAmountCents <= 0) return;
  const client = receiptHint(event.clientId, p.clientId, p.client_id);
  const invoice = receiptHint(p.invoiceId, p.invoice_id);
  const paymentLink = receiptHint(p.paymentLinkId, p.payment_link_id);
  if (client.conflict || invoice.conflict || paymentLink.conflict) return;
  const identity = {
    orgId: event.orgId, clientId: client.value, invoiceId: invoice.value,
    paymentLinkId: paymentLink.value, paidAmountCents
  };
  /* Commas ids only. p.productId is OUR products.id, copied off the link by
     processCommasInboxRow — every deposit link shares one. Writing it into
     commas_session_id let the first payment per product claim it, and every
     later payment for that product hit the unique index
     payment_links_commas_session and left its link unpaid (N2, 2026-09-18). */
  const sessionId = p.itemId || p.commasSessionId || null;

  if (p.ref) {
    const byRef = await markPaid(db, {
      ...identity,
      linkRef: p.ref,
      commasSessionId: sessionId || p.providerRef || null
    });
    if (byRef) {
      await openSloPortalIfPaid(db, byRef);
      await turnOnFinanceOsIfSetup(db, byRef);
      return;
    }
    // A known ref owns this callback. Do not fall through and pay a different
    // checkout by session ID, including on a replay of an already-paid ref.
    const referencedLink = await getByLinkRef(db, { linkRef: p.ref });
    if (referencedLink) {
      if (referencedLink.status === "paid" && receiptMatchesLink(referencedLink, identity)) {
        await turnOnFinanceOsIfSetup(db, referencedLink);
      }
      return;
    }
  }

  if (sessionId) {
    const bySession = await markPaidBySession(db, {
      ...identity, commasSessionId: sessionId
    });
    await openSloPortalIfPaid(db, bySession);
    if (bySession) {
      await turnOnFinanceOsIfSetup(db, bySession);
      return;
    }
  }

}

export function register() {
  on("payment.received", onPaymentReceivedForLink);
}
