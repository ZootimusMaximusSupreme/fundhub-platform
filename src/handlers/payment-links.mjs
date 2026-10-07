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

export async function onPaymentReceivedForLink(event, db) {
  const p = event.payload || {};
  const paidAmountCents = p.amount != null ? toCents(p.amount) : null;
  /* Commas ids only. p.productId is OUR products.id, copied off the link by
     processCommasInboxRow — every deposit link shares one. Writing it into
     commas_session_id let the first payment per product claim it, and every
     later payment for that product hit the unique index
     payment_links_commas_session and left its link unpaid (N2, 2026-09-18). */
  const sessionId = p.itemId || p.commasSessionId || null;

  if (p.ref) {
    const byRef = await markPaid(db, {
      linkRef: p.ref,
      commasSessionId: sessionId || p.providerRef || null,
      paidAmountCents
    });
    if (byRef) {
      await openSloPortalIfPaid(db, byRef);
      await turnOnFinanceOsIfSetup(db, byRef);
      return;
    }
  }

  if (sessionId) {
    const bySession = await markPaidBySession(db, {
      commasSessionId: sessionId,
      paidAmountCents
    });
    await openSloPortalIfPaid(db, bySession);
    if (bySession) {
      await turnOnFinanceOsIfSetup(db, bySession);
      return;
    }
  }

  /* HEAL ON REPLAY. markPaid only returns a row on the open → paid move, so a
     replay of a setup payment whose grant failed the first time finds nothing
     above. Read the link and finish the grant; it is a no-op if already done. */
  if (p.ref) {
    const link = await getByLinkRef(db, { linkRef: p.ref });
    if (link && link.status === "paid") await turnOnFinanceOsIfSetup(db, link);
  }
}

export function register() {
  on("payment.received", onPaymentReceivedForLink);
}
