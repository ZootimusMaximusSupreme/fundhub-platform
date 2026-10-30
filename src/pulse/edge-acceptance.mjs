// Audit-only A->B evidence contract (v1). No live reads, writes, sends, billing or new monitors.
// A source mapping, check ID, or heartbeat is NOT a verified downstream business result.
// Source-touch checks are REPORT-ONLY until false positives and ownership are reviewed.
export const EDGE_CONTRACT_VERSION = 1;

export const CRITICAL_EDGES = Object.freeze([
  {
    id: "lead-booking-call-outcome", severity: "P1", owner: "Front-house",
    event: "booking.created", consumer: "onBookingCreated / s-04-call-booked",
    receipt: "bookings + confirmation message + call_outcomes", graceMinutes: 30,
    pulse: "calls:booked-no-outcome",
    paths: ["src/adapters/clickfunnels.mjs", "src/bookings/", "src/handlers/client-lifecycle.mjs", "src/workflows/s-04", "src/sales/call-outcomes.mjs"]
  },
  {
    id: "payment-ledger-entitlement", severity: "P0", owner: "A/R",
    event: "payment.received", consumer: "onPaymentReceived / entitlement handlers",
    receipt: "payment ledger + active entitlement + portal read", graceMinutes: null,
    pulse: "payments:paid-no-entitlement",
    paths: ["src/merchant/", "src/billing/", "src/payments/", "src/entitlements/", "src/ledger/", "src/adapters/whop", "api/payment", "api/checkout"]
  },
  {
    id: "consent-crs-result", severity: "P0", owner: "Fulfillment",
    event: "diagnostic.paid", consumer: "onDiagnosticPaidSoftPull / c-00-crs-soft-pull-request",
    receipt: "consent + credit-pull result + stored CRS report", graceMinutes: null,
    pulse: "softpull:request-failed-or-stuck",
    paths: ["api/soft-pull-approve.mjs", "src/handlers/diagnostic-soft-pull.mjs", "src/handlers/crs-full-report.mjs", "src/finance/crs", "src/workflows/c-00-crs"]
  },
  {
    id: "round-funded-fee-commission", severity: "P0", owner: "Fulfillment / A/R",
    event: "round.funded", consumer: "onRoundFundedMoney / fee and payout handlers",
    receipt: "funding_rounds + applications + fee bill + commission", graceMinutes: 30,
    pulse: "trip:funding",
    paths: ["src/funding/", "src/finance/funding", "src/handlers/funding", "src/commissions/", "src/money/", "api/funding"]
  },
  {
    id: "repair-enrollment-bureau-result", severity: "P1", owner: "Fulfillment",
    event: "repair.enrolled / repair.response.received", consumer: "repair round and bureau response processing",
    receipt: "repair case + letters + response", graceMinutes: null,
    pulse: "pipeline:repair",
    paths: ["src/repair/", "src/workflows/repair", "api/repair/"]
  },
  {
    id: "blueprint-financeos-report", severity: "P1", owner: "Blueprint",
    event: "payment.received", consumer: "FinanceOS monthly pull and delivery",
    receipt: "active subscription + real monthly report + client delivery", graceMinutes: null,
    pulse: "blueprint:monthly-delivery",
    paths: ["src/finance-os/", "src/blueprint/", "src/workflows/finance-os", "api/finance-os"]
  },
  {
    id: "outbound-message-provider-receipt", severity: "P1", owner: "Front-house",
    event: "message.queued / message.sent / message.failed", consumer: "message-dispatch-sweeper + provider callbacks",
    receipt: "messages row + provider delivery/callback + client inbox", graceMinutes: 15,
    pulse: "gap:sms-journey-zero",
    paths: ["src/messaging/", "src/adapters/twilio", "src/adapters/resend", "api/chat/messages.mjs", "netlify/functions/staff-message-sweeper.mjs"]
  },
  {
    id: "lender-apply-link", severity: "P1", owner: "Fulfillment / Lender outreach",
    event: "SOURCE-STATE: lender application_url", consumer: "apply-links beat / lender UI",
    receipt: "lenders.application_url + pulse_bank_links read-only result", graceMinutes: null,
    pulse: "url-shape",
    paths: ["src/lenders/", "src/banks/", "api/lenders", "api/banks"]
  },
  {
    id: "ads-spend-attribution", severity: "P2", owner: "Front-house / Ads",
    event: "SOURCE-STATE: Meta spend import", consumer: "ad-number mapping / lead attribution",
    receipt: "spend row + fundhub_ad_number + attributed lead", graceMinutes: null,
    pulse: "ads-number-unmapped",
    paths: ["src/ads/", "src/attribution/", "src/adapters/meta", "api/ads"]
  },
  {
    id: "native-portal-first-open", severity: "P1", owner: "Native apps",
    event: "SOURCE-STATE: installed first open", consumer: "native webview / portal authentication",
    receipt: "real installed app + authenticated portal result (device proof separately)", graceMinutes: null,
    pulse: "portal:summary",
    paths: ["ios/", "macos/", "native/", "public/app/client-ios.js", "src/push/native"]
  }
]);

const NON_RUNTIME = /(?:^|\/)(?:__tests__|fixtures|docs)\//;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.snap$)/;
function materialSource(file) {
  return /^(?:src|api|netlify|public|ios|macos|native)\//.test(file)
    && !file.startsWith("src/pulse/")
    && !TEST_FILE.test(file) && !NON_RUNTIME.test(file);
}

export function changedCriticalEdges(filenames = []) {
  const changed = [...new Set(filenames.map(String).filter(materialSource))];
  return CRITICAL_EDGES.flatMap((edge) => {
    const files = changed.filter((file) => edge.paths.some((prefix) => file === prefix || file.startsWith(prefix)));
    return files.length ? [{ id: edge.id, owner: edge.owner, severity: edge.severity, pulse: edge.pulse, files }] : [];
  });
}

// Explicitly never returns PASS. A PR note and source-level tests are not live proof.
export function reportCriticalSourceChanges(filenames = [], prBody = "") {
  const touched = changedCriticalEdges(filenames);
  const note = /A\s*(?:->|→|to)\s*B\s+evidence\s*:/i.test(String(prBody));
  return {
    contractVersion: EDGE_CONTRACT_VERSION,
    verdict: touched.length ? "REVIEW_REQUIRED" : "NO_CRITICAL_SOURCE_TOUCH_DETECTED",
    evidenceNote: note ? "PRESENT_UNVERIFIED" : "MISSING",
    edges: touched,
    liveReceipt: "NEEDS_LIVE_RECEIPT"
  };
}

function milliseconds(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

function matchesEvent(row, event) {
  if (!row || !event) return false;
  if (String(row.org_id || "") !== String(event.org_id || "")) return false;
  if (String(row.client_id || "") !== String(event.client_id || "")) return false;
  const eventKey = event.correlation_id || event.id;
  return Boolean(eventKey) && (
    String(row.event_id || "") === String(event.id || "") ||
    String(row.correlation_id || "") === String(eventKey)
  );
}

// Pure SYNTHETIC fixture judge, not a claim that production receipts carry these columns.
// Only a matching source event, successful consumer, persisted *business* outcome and,
// when required, a provider delivery receipt, may return PASS.
export function judgeSyntheticEdge({
  demand = true, demandAt, event, consumer, receipt, providerReceipt,
  requireProviderReceipt = false, now = Date.now(), graceMs = 15 * 60 * 1000
} = {}) {
  if (demand === false) return { verdict: "NA", reason: "no-demand" };
  const start = milliseconds(demandAt || event?.created_at);
  if (!Number.isFinite(start)) return { verdict: "NOT_CHECKED", reason: "missing-demand-time" };
  const current = milliseconds(now);
  if (!Number.isFinite(current) || !Number.isFinite(graceMs) || graceMs < 0) {
    return { verdict: "NOT_CHECKED", reason: "bad-clock-or-grace" };
  }
  const due = current >= start + graceMs;
  const failed = (reason) => ({ verdict: due ? "RED" : "PENDING", reason });
  if (!event?.id || !event?.org_id || !event?.client_id) return failed("producer-event-missing");
  if (!matchesEvent(consumer, event) || consumer.outcome !== "completed") {
    return failed("consumer-not-completed-for-event");
  }
  if (!matchesEvent(receipt, event) || receipt.outcome !== "satisfied") {
    return failed("downstream-business-result-missing");
  }
  if (requireProviderReceipt && (!matchesEvent(providerReceipt, event) || providerReceipt.outcome !== "delivered")) {
    return failed("real-provider-delivery-missing");
  }
  return { verdict: "PASS", reason: "event-consumer-and-business-result-correlated" };
}
