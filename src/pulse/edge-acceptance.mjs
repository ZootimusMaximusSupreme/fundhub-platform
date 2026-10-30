// Audit-only A->B evidence contract (v1). No live reads, writes, sends, billing or new monitors.
// The client portal HTML is a real result surface for paid entitlement and
// message inbox, and the webview payload the native app depends upon.
// Editing it must review those A→B results; Apple installed-build proof stays separate.
// A source mapping, check ID, or heartbeat is NOT a verified downstream business result.
// Source-touch checks are REPORT-ONLY until false positives and ownership are reviewed.
// Reference the one registered soft-pull check instead of declaring its ID twice.
import { PULL_CHECK_IDS } from "./beats/lib/soft-pull-truth.mjs";

export const EDGE_CONTRACT_VERSION = 1;

// register-all.mjs is the *real* event-bus handler registration chokepoint:
// changing ordering/imports can disconnect payment, consent, booking, repair,
// finance and customer-message consumers without changing any handler file.
// Audit each dependent edge on an edit; lender URL/native source-state edges do
// not use this bus. REPORT ONLY until diff-specific proofs are enforceable.
// Closer deck writes real call outcomes, cockpit displays missing outcomes,
// setter dashboard advances the sales card, and /api/tasks claims follow-ups.
// Changes to these existing endpoints must review the booking-to-call-result edge.
// client-lifecycle.mjs hosts payment.received, diagnostic.paid, deposit.paid and
// analysis.completed alongside booking work. Every changed existing copy needs
// all relevant P0 money/consent/funding proof reviews, not booking alone.
export const CRITICAL_EDGES = Object.freeze([
  {
    id: "lead-booking-call-outcome", severity: "P1", owner: "Front-house",
    event: "booking.created", consumer: "onBookingCreated / s-04-call-booked",
    receipt: "bookings + confirmation message + call_outcomes", graceMinutes: 30,
    pulse: "calls:booked-no-outcome",
    paths: ["src/register-all.mjs", "src/adapters/clickfunnels.mjs", "src/bookings/", "src/handlers/client-lifecycle.mjs", "src/workflows/s-04", "src/workflows/cortana-booking-feed.mjs", "src/messaging/providers/cortana-booking-webhook.mjs", "src/config/survey-qualification.mjs", "src/setter/tasks.mjs", "src/auth/magic-link.mjs", "src/auth/booking-account", "src/sales/call-outcomes.mjs", "src/sales/closer-now.mjs", "src/sales/closer-deck.mjs", "src/sales/cockpit.mjs", "src/setter/dashboard.mjs", "api/tasks.mjs", "public/app/closer-dashboard.html", "public/app/setter-dashboard.html", "public/app/calendar.html", "public/app/pipeline.html", "api/dashboard/pipeline.mjs", "api/auth/magic-link.mjs", "src/auth/booking-account", "src/auth/magic-link", "public/portal-login.html", "marketing/landing-pages/"]
  },
  {
    id: "payment-ledger-entitlement", severity: "P0", owner: "A/R",
    event: "payment.received", consumer: "onPaymentReceived / entitlement handlers",
    receipt: "payment ledger + active entitlement + portal read", graceMinutes: null,
    pulse: "payments:paid-no-entitlement",
    paths: ["src/register-all.mjs", "src/merchant/", "src/billing/", "src/payments/", "src/entitlements/", "src/finance/finance-os-entitlement.mjs", "src/ledger/", "src/handlers/money-chain.mjs", "src/handlers/client-lifecycle.mjs", "src/handlers/payment-links.mjs", "src/invoices/", "api/read/invoices.mjs", "public/app/client-portal.html", "src/adapters/whop", "api/payment", "api/checkout"]
  },
  {
    id: "consent-crs-result", severity: "P0", owner: "Fulfillment",
    event: "diagnostic.paid", consumer: "onDiagnosticPaidSoftPull / c-00-crs-soft-pull-request",
    receipt: "consent + credit-pull result + stored CRS report", graceMinutes: null,
    pulse: PULL_CHECK_IDS[0],
    paths: ["src/register-all.mjs", "api/soft-pull-approve.mjs", "src/handlers/client-lifecycle.mjs", "src/handlers/diagnostic-soft-pull.mjs", "src/handlers/crs-full-report.mjs", "src/finance/crs", "src/finance/soft-pulls.mjs", "src/workflows/c-00-crs", "public/app/soft-pull-approve.html"]
  },
  {
    id: "round-funded-fee-commission", severity: "P0", owner: "Fulfillment / A/R",
    event: "round.funded", consumer: "onRoundFundedMoney / fee and payout handlers",
    receipt: "funding_rounds + applications + fee bill + commission", graceMinutes: 30,
    pulse: "trip:funding",
    paths: ["src/register-all.mjs", "src/funding/", "src/finance/funding", "src/invoices/", "src/inquiry-ops/", "src/handlers/funding", "src/handlers/client-lifecycle.mjs", "src/handlers/money-chain.mjs", "src/commissions/", "src/money/", "api/funding"]
  },
  {
    id: "repair-enrollment-bureau-result", severity: "P1", owner: "Fulfillment",
    event: "repair.enrolled / repair.response.received", consumer: "repair round and bureau response processing",
    receipt: "repair case + letters + response", graceMinutes: null,
    pulse: "pipeline:repair",
    paths: ["src/register-all.mjs", "src/repair/", "src/workflows/repair", "api/repair/"]
  },
  {
    id: "blueprint-financeos-report", severity: "P1", owner: "Blueprint",
    event: "payment.received", consumer: "FinanceOS monthly pull and delivery",
    receipt: "active subscription + real monthly report + client delivery", graceMinutes: null,
    pulse: "blueprint:monthly-delivery",
    paths: ["src/register-all.mjs", "src/finance-os/", "src/finance/finance-os-", "src/blueprint/", "src/workflows/finance-os", "api/finance-os"]
  },
  {
    id: "outbound-message-provider-receipt", severity: "P1", owner: "Front-house",
    event: "message.queued / message.sent / message.failed", consumer: "message-dispatch-sweeper + provider callbacks",
    receipt: "messages row + provider delivery/callback + client inbox", graceMinutes: 15,
    pulse: "gap:sms-journey-zero",
    paths: ["src/register-all.mjs", "src/messaging/", "src/chat/", "src/adapters/twilio", "src/adapters/resend", "api/read/inbox.mjs", "api/chat/messages.mjs", "public/app/client-portal.html", "netlify/functions/staff-message-sweeper.mjs"]
  },
  {
    id: "lender-apply-link", severity: "P1", owner: "Fulfillment / Lender outreach",
    event: "SOURCE-STATE: lender application_url", consumer: "apply-links beat / lender UI",
    receipt: "lenders.application_url + pulse_bank_links read-only result", graceMinutes: null,
    pulse: "url-shape",
    paths: ["src/lenders/", "src/banks/", "src/finance/bank-strategy.mjs", "api/lenders", "api/banks"]
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
    paths: ["ios/", "macos/", "native/", "tools/fundhub-ios/", "tools/fundhub-macos/", "api/native/client-activity.mjs", "public/app/client-ios.js", "public/app/client-portal.html", "src/push/native"]
  }
]);

const NON_RUNTIME = /(?:^|\/)(?:__tests__|fixtures|docs)\//;
const TEST_FILE = /(?:\.test\.|\.spec\.|\.snap$)/;
const NON_EXECUTABLE_ASSET = /\.(?:css|scss|less|svg|png|jpe?g|webp|ico|woff2?|gif|map)$/i;
function materialSource(file) {
  // Installed native app code lives in tools/fundhub-ios, not top-level ios/.
  // Watch app code/project configuration but not screenshots or documentation.
  const nativeAppSource = /^tools\/fundhub-(?:ios|macos)\/.*\.(?:swift|plist|entitlements|pbxproj|xcconfig|m|mm|h)$/i.test(file);
  return (/^(?:src|api|netlify|public|marketing|ios|macos|native)\//.test(file) || nativeAppSource)
    && !file.startsWith("src/pulse/")
    && !TEST_FILE.test(file) && !NON_EXECUTABLE_ASSET.test(file) && !NON_RUNTIME.test(file);
}

export function changedCriticalEdges(filenames = []) {
  const changed = [...new Set(filenames.map(String).filter(materialSource))];
  return CRITICAL_EDGES.flatMap((edge) => {
    const files = changed.filter((file) => edge.paths.some((prefix) => file === prefix || file.startsWith(prefix)));
    return files.length ? [{ id: edge.id, owner: edge.owner, severity: edge.severity, pulse: edge.pulse, files }] : [];
  });
}

// Report-only catch for future high-risk source files outside the ten mapped
// families. This MUST NOT become a 403-legacy fail-closed rule by accident.
const HIGH_RISK_UNMAPPED = /(?:^|[/._-])(?:pay(?:ment)?|bill(?:ing)?|ledger|entitlements?|bookings?|calendars?|consent|soft[_-]?pull|crs|credit|funding|funded|round|commissions?|invoices?|repair|blueprint|finance[_-]?os|messages?|messaging|sms|emails?|delivery|lenders?|apply|attribution|callbacks?|webhooks?|cortana|portal)(?:$|[/._-])/i;
export function unmappedHighRiskSourceChanges(filenames = []) {
  const mapped = new Set(changedCriticalEdges(filenames).flatMap((edge) => edge.files));
  return [...new Set(filenames.map(String).filter(materialSource))]
    .filter((file) => HIGH_RISK_UNMAPPED.test(file) && !mapped.has(file));
}

// Explicitly never returns PASS. A PR note and source-level tests are not live proof.
export function reportCriticalSourceChanges(filenames = [], prBody = "") {
  const touched = changedCriticalEdges(filenames);
  const unmappedHighRiskFiles = unmappedHighRiskSourceChanges(filenames);
  const note = /A\s*(?:->|→|to)\s*B\s+evidence\s*:/i.test(String(prBody));
  return {
    contractVersion: EDGE_CONTRACT_VERSION,
    verdict: touched.length || unmappedHighRiskFiles.length ? "REVIEW_REQUIRED" : "NO_CRITICAL_SOURCE_TOUCH_DETECTED",
    evidenceNote: note ? "PRESENT_UNVERIFIED" : "MISSING",
    edges: touched,
    unmappedHighRiskFiles,
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
  const eventId = String(event.id || "");
  const traceId = String(event.correlation_id || eventId);
  const hasEventId = row.event_id != null && String(row.event_id).length > 0;
  const hasTraceId = row.correlation_id != null && String(row.correlation_id).length > 0;
  if (!eventId || (!hasEventId && !hasTraceId)) return false;
  // A journey correlation_id can cover many events. A receipt with only that
  // shared ID cannot prove which producer event caused its business outcome.
  // Require the exact event_id whenever the journey trace differs from it.
  if (traceId !== eventId && !hasEventId) return false;
  // A shared journey trace cannot turn a *different event's* result green.
  // When both keys exist, each must match rather than choosing the favorable one.
  if (hasEventId && String(row.event_id) !== eventId) return false;
  if (hasTraceId && String(row.correlation_id) !== traceId) return false;
  const eventTime = milliseconds(event.created_at);
  const rowTime = milliseconds(row.created_at || row.completed_at);
  if (Number.isFinite(eventTime) && Number.isFinite(rowTime) && rowTime < eventTime) return false;
  return true;
}

// Pure SYNTHETIC fixture judge, not a claim that production receipts carry these columns.
// Only a matching source event, successful consumer, persisted *business* outcome and,
// when required, a provider delivery receipt, may return PASS.
export function judgeSyntheticEdge({
  demand = true, demandAt, event, consumer, receipt, providerReceipt,
  identityReceipt, requireProviderReceipt = false,
  now = Date.now(), graceMs = 15 * 60 * 1000
} = {}) {
  // A present producer event contradicts a "no demand" claim; never hide it as NA.
  if (demand === false) return event?.id
    ? { verdict: "NOT_CHECKED", reason: "event-present-but-demand-marked-absent" }
    : { verdict: "NA", reason: "no-demand" };
  const start = milliseconds(demandAt || event?.created_at);
  if (!Number.isFinite(start)) return { verdict: "NOT_CHECKED", reason: "missing-demand-time" };
  const current = milliseconds(now);
  if (!Number.isFinite(current) || !Number.isFinite(graceMs) || graceMs < 0) {
    return { verdict: "NOT_CHECKED", reason: "bad-clock-or-grace" };
  }
  const due = current >= start + graceMs;
  const failed = (reason) => ({ verdict: due ? "RED" : "PENDING", reason });
  if (!event?.id || !event?.org_id) return failed("producer-event-missing");
  // Some real booking/funding events have NULL client_id. They can only be
  // judged when a trusted, org-scoped identity-resolution receipt links the
  // exact event id to the persisted client. An email string is not enough.
  const resolved = event.client_id ? event :
    identityReceipt?.event_id === event.id &&
    identityReceipt?.org_id === event.org_id &&
    identityReceipt?.outcome === "resolved" &&
    identityReceipt?.client_id
      ? { ...event, client_id: identityReceipt.client_id } : event;
  if (!resolved.client_id) return failed("producer-client-identity-unresolved");
  if (!matchesEvent(consumer, resolved) || consumer.outcome !== "completed") {
    return failed("consumer-not-completed-for-event");
  }
  if (!matchesEvent(receipt, resolved) || receipt.outcome !== "satisfied") {
    return failed("downstream-business-result-missing");
  }
  if (requireProviderReceipt && (!matchesEvent(providerReceipt, resolved) || providerReceipt.outcome !== "delivered")) {
    return failed("real-provider-delivery-missing");
  }
  return { verdict: "PASS", reason: "event-consumer-and-business-result-correlated" };
}
