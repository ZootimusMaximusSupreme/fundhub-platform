// Boot wiring — register every handler module onto the event bus exactly once.
// Call ensureRegistered() before serving traffic (the HTTP router does this).
// on() dedupes by fn reference, so calling register() twice is harmless; the flag
// just avoids redundant work.

import { register as registerLifecycle } from "./handlers/client-lifecycle.mjs";
import { register as registerComms } from "./handlers/comms.mjs";
import { register as registerPaymentLinks } from "./handlers/payment-links.mjs";
import { register as registerPartnerAddOns } from "./handlers/partner-addons.mjs";
import { register as registerMoneyChain } from "./handlers/money-chain.mjs";
import { register as registerPartnerRecruit } from "./partners/recruit.mjs";
import { register as registerPurchaseRouting } from "./handlers/purchase-routing.mjs";
import { register as registerStaffCompAlerts } from "./handlers/staff-comp-alerts.mjs";
import { register as registerCustomerInsights } from "./handlers/customer-insights.mjs";
import { register as registerInquiryGate } from "./handlers/inquiry-gate.mjs";
import { register as registerInquiryDocs } from "./handlers/inquiry-docs.mjs";
import { register as registerInboundMmsDocs } from "./handlers/inbound-mms-docs.mjs";
import { register as registerCommasDisputes } from "./handlers/commas-disputes.mjs";
import { register as registerCommasSubscriptions } from "./handlers/commas-subscriptions.mjs";
import { register as registerDiagnosticSoftPull } from "./handlers/diagnostic-soft-pull.mjs";
import { register as registerCrsDeliverables } from "./handlers/crs-deliverables.mjs";
import { register as registerContractSigned } from "./handlers/contract-signed.mjs";
import { register as registerContractConsent } from "./handlers/contract-consent.mjs";
import { register as registerAgentRuntime } from "./agents/runtime.mjs";
import { register as registerMetaPurchase } from "./handlers/meta-purchase.mjs";
import { register as registerClarityAutopay } from "./handlers/clarity-autopay.mjs";

let _done = false;

export function registerAll() {
  registerLifecycle();
  registerComms();
  registerPaymentLinks();
  /* White-label add-ons. STRICTLY AFTER registerPaymentLinks: that handler is
     what marks the link 'paid', and this one refuses to start a partner's
     recurring add-on off an ask that has not been paid. Handler order is
     registration order. It ignores every client payment. */
  registerPartnerAddOns();
  registerMoneyChain();
  /* The recruit bonus. STRICTLY AFTER registerMoneyChain: that handler writes
     the transactions row this one resolves as its idempotency key, and handler
     order on the bus is registration order. Registered earlier, the $2,000 is
     refused for want of a key rather than paid. It ignores every payment that
     is not a partner's $10,000 entry fee. */
  registerPartnerRecruit();
  /* Payment -> fulfilment board. Strictly after money-chain: handler order is
     registration order, and this reads the sale money-chain has just written to
     decide which board the client belongs on. */
  registerPurchaseRouting();
  /* After money-chain so sale_attributions exist when a deal-close win SMS runs. */
  registerStaffCompAlerts();
  registerCustomerInsights();
  registerInquiryGate();
  registerInquiryDocs();
  /* Photo texts after the inbound message row exists — same docs.received
     path as a portal upload. Must not mint a client. */
  registerInboundMmsDocs();
  /* Chargebacks and refunds → tasks. Registered after the money chain so a
     disputed payment's original payment.received has already been handled;
     these two events never reverse it, but the task text reads better when the
     payment it refers to is on file. */
  registerCommasDisputes();
  /* Subscriptions Commas bills on its own cadence. No ordering constraint: the
     five subscription.* names have exactly one emitter (the Commas adapter) and
     exactly one listener (this handler). It writes a MIRROR of what Commas
     already did and charges nothing — see the header of
     src/handlers/commas-subscriptions.mjs. */
  registerCommasSubscriptions();
  /* A Commas payment to Fundhub → a Clarity Payment / BNPL installment marked
     paid (src/finance/clarity-autopay.mjs). After the money chain so the
     payment is on file first. It writes only its own rows and is idempotent
     on the Commas payment id. */
  registerClarityAutopay();
  /* Soft pull must run even when Inngest is off — same sync rule as card
     placement on entry.captured. After money-chain so the client/tx exist. */
  registerDiagnosticSoftPull();
  /* The five UnderwriteIQ deliverables, on the pull, for the same reason the
     soft pull above is here: C-06 is an Inngest function and the fan-out that
     invokes it is fire-and-forget with a swallowed rejection, so in production
     it has never run. AFTER registerLifecycle: that handler's
     onAnalysisCompleted creates the client row this one delivers to, and
     handler order on the bus is registration order. */
  registerCrsDeliverables();
  registerContractSigned();
  registerContractConsent();
  // After comms: the inbound message row must exist before the runtime
  // looks it up by provider_ref. Handler order on the bus is registration order.
  registerAgentRuntime();
  /* Meta Purchase (server copy). LAST, and strictly after registerPaymentLinks:
     the $297 order's Purchase fires on the same payment.received that handler
     uses to mark the order paid, and every money write should be on file
     before anything is reported outward. It never throws. */
  registerMetaPurchase();
  _done = true;
}

export function ensureRegistered() {
  if (!_done) registerAll();
}

// Test helper — force re-registration on the next ensureRegistered().
export const _resetRegistered = () => { _done = false; };
