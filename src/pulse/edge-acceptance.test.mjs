import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EDGE_CONTRACT_VERSION, CRITICAL_EDGES, RUNTIME_LENDER_PULSE_PATHS, changedCriticalEdges, unmappedHighRiskSourceChanges,
  reportCriticalSourceChanges, shouldReportCriticalSourceRisk, judgeSyntheticEdge
} from "./edge-acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const org = "org-synthetic", client = "client-synthetic", id = "event-synthetic";
const event = { id, org_id: org, client_id: client, created_at: "2026-10-29T00:00:00Z" };
const consumer = { event_id: id, org_id: org, client_id: client, outcome: "completed" };
const receipt = { correlation_id: id, org_id: org, client_id: client, outcome: "satisfied" };
const providerReceipt = { event_id: id, org_id: org, client_id: client, outcome: "delivered" };
const basics = { event, consumer, receipt, now: "2026-10-29T01:00:00Z", demandAt: event.created_at, graceMs: 600_000 };

test("A->B contract is versioned and covers eleven business families", () => {
  assert.equal(EDGE_CONTRACT_VERSION, 1);
  assert.equal(CRITICAL_EDGES.length, 11);
  for (const edge of CRITICAL_EDGES) {
    assert.match(edge.id, /^[a-z0-9-]+$/);
    assert.match(edge.pulse, /^[a-z0-9:-]+$/);
    assert.ok(edge.paths.length > 0);
    assert.ok(["P0", "P1", "P2"].includes(edge.severity));
  }
  assert.equal(new Set(CRITICAL_EDGES.map((e) => e.id)).size, CRITICAL_EDGES.length);
});

test("shared Pulse lender matcher is a runtime bank-guidance path, not an exempt observer file", () => {
  // src/lenders/store.mjs re-exports matchForClient from this Pulse beat library.
  // Both the Blueprint bank recommendation and lender-match result depend on
  // it; the generic ignore-src/pulse rule previously concealed material edits.
  const runtime = [
    ...RUNTIME_LENDER_PULSE_PATHS,
    "src/lenders/store.mjs",
    "src/lenders/match.mjs"
  ];
  const report = reportCriticalSourceChanges(runtime);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((edge) => [edge.id, edge.severity]), [
    ["blueprint-financeos-report", "P1"],
    ["lender-apply-link", "P1"]
  ]);
  assert.deepEqual(report.edges.map((edge) => edge.files), [runtime, runtime]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.evidenceNote, "MISSING");
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(CRITICAL_EDGES.find((edge) => edge.id === "blueprint-financeos-report").proofStatus,
    "PARTIAL_NEEDS_REAL_SOURCE_PROVENANCE_RECEIPT");

  // No general self-monitor loop: unrelated beat or observer-only edits are
  // not interpreted as new runtime customer-result obligations.
  const observerOnly = [
    "src/pulse/beats/lib/sms-truth.mjs",
    "src/pulse/edge-acceptance.mjs",
    "src/pulse/beats/lib/lenders-truth.test.mjs"
  ];
  assert.deepEqual(changedCriticalEdges(observerOnly), []);
  assert.deepEqual(unmappedHighRiskSourceChanges(observerOnly), []);
  assert.equal(reportCriticalSourceChanges(observerOnly).verdict,
    "NO_CRITICAL_SOURCE_TOUCH_DETECTED");
});

test("the live lender matcher import graph cannot grow beyond Pulse's A-to-B source watcher", () => {
  // src/lenders/store re-exports lenders-truth; lender-truth imports the
  // scorer, credit-file interpreter, product gates and demo-mode reader.
  // A new helper import MUST force an updated A->B contract, not a fake PASS.
  const visited = new Set();
  function walk(filename) {
    if (visited.has(filename)) return;
    visited.add(filename);
    const source = fs.readFileSync(path.join(ROOT, filename), "utf8");
    const imports = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.{1,2}\/[^"']+\.mjs)["']/g;
    for (const m of source.matchAll(imports)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(filename), m[1]));
      assert.ok(dependency.startsWith("src/pulse/beats/lib/"),
        "review new external lender dependency: " + dependency);
      walk(dependency);
    }
  }
  walk("src/pulse/beats/lib/lenders-truth.mjs");
  assert.deepEqual([...visited].sort(), [...RUNTIME_LENDER_PULSE_PATHS].sort(),
    "new/existing runtime dependency must be listed explicitly for source-change review");
  for (const file of visited) {
    assert.deepEqual(changedCriticalEdges([file]).map((e) => e.id), [
      "blueprint-financeos-report", "lender-apply-link"
    ], "lender and Blueprint outcome mapping for " + file);
  }
});

test("sample credit writer and real-bank-guidance provenance cannot escape changed-source review", () => {
  // The sample script inserts simulated crs_results AND stored tradelines.
  // Reading only non-simulated parent CRS results does not prove that a bank
  // recommendation excluded the sampled tradelines. This is source-watch only.
  const files = [
    "scripts/finance-os-sample-v3.mjs",
    "src/finance/bank-strategy.mjs",
    "src/tradelines/store.mjs",
    "src/liabilities/store.mjs",
    "src/finance/sample-credit-file.mjs"
  ];
  const report = reportCriticalSourceChanges(files);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(report.evidenceNote, "MISSING");
  const blueprint = report.edges.find((edge) => edge.id === "blueprint-financeos-report");
  assert.deepEqual(blueprint.files, files);
  assert.equal(blueprint.owner, "Blueprint");
  assert.equal(blueprint.severity, "P1");
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(CRITICAL_EDGES.find((edge) => edge.id === blueprint.id).proofStatus,
    "PARTIAL_NEEDS_REAL_SOURCE_PROVENANCE_RECEIPT");
  assert.deepEqual(changedCriticalEdges(["scripts/finance-os-sample-v3.mjs"])
    .map((edge) => edge.id), ["blueprint-financeos-report"]);
  assert.deepEqual(changedCriticalEdges(["scripts/readme.md"]), []);
  assert.deepEqual(changedCriticalEdges(["src/finance/bank-strategy.mjs"])
    .map((edge) => edge.id), ["blueprint-financeos-report", "lender-apply-link"]);
});

test("source changes require A->B review, including changed existing high-risk files", () => {
  const result = reportCriticalSourceChanges([
    "src/adapters/clickfunnels.mjs", "src/handlers/diagnostic-soft-pull.mjs",
    "src/adapters/clickfunnels.test.mjs", "docs/journeys/CHANGELOG.md"
  ]);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  assert.equal(result.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(result.evidenceNote, "MISSING");
  assert.deepEqual(result.edges.map((x) => x.id), ["lead-booking-call-outcome", "consent-crs-result"]);
  assert.equal(reportCriticalSourceChanges(["docs/README.md"]).verdict, "NO_CRITICAL_SOURCE_TOUCH_DETECTED");
  assert.equal(changedCriticalEdges(["src/pulse/tripwires.mjs"]).length, 0);
  assert.equal(reportCriticalSourceChanges(["src/adapters/clickfunnels.mjs"], "A->B evidence: mock only").evidenceNote, "PRESENT_UNVERIFIED");
  assert.deepEqual(changedCriticalEdges(["api/auth/magic-link.mjs", "public/portal-login.html"]).map((x) => x.id), ["lead-booking-call-outcome"]);
  assert.deepEqual(changedCriticalEdges(["public/app/soft-pull-approve.html"]).map((x) => x.id), ["consent-crs-result"]);
  assert.deepEqual(changedCriticalEdges(["marketing/landing-pages/apply-survey.html"]).map((x) => x.id), ["lead-booking-call-outcome"]);
});

test("two-calendar survey booking PR requires booking, message and attribution outcome review", () => {
  // PR #330 changed existing server-generated SMS/email booking links,
  // calendar route recognition and client-side booking attribution. Each
  // producer is source-mapped; none of the source edits proves delivery.
  const files = [
    "src/workflows/messaging.mjs",
    "src/funnel/pages.mjs",
    "public/funnel/fh-events.js"
  ];
  const report = reportCriticalSourceChanges(files);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((edge) => [edge.id, edge.severity]), [
    ["lead-booking-call-outcome", "P1"],
    ["outbound-message-provider-receipt", "P1"],
    ["ads-spend-attribution", "P2"]
  ]);
  assert.deepEqual(report.edges[0].files, files);
  assert.deepEqual(report.edges[1].files, ["src/workflows/messaging.mjs"]);
  assert.deepEqual(report.edges[2].files, ["public/funnel/fh-events.js"]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(report.evidenceNote, "MISSING");
  // Future funnel/survey producers cannot escape by adding a new filename
  // with no literal "booking" or "payment" word in its path.
  const future = reportCriticalSourceChanges([
    "src/funnel/new-route.mjs", "public/funnel/calendar-v2.html",
    "src/survey/new-question-map.mjs"
  ]);
  assert.deepEqual(future.edges.map((edge) => edge.id), ["lead-booking-call-outcome"]);
  assert.deepEqual(future.unmappedHighRiskFiles, []);
  assert.deepEqual(future.edges[0].files, [
    "src/funnel/new-route.mjs", "public/funnel/calendar-v2.html",
    "src/survey/new-question-map.mjs"
  ]);
});

test("schema migration changes cannot bypass A->B source-watch review", () => {
  // Live PRs change booking-claim and staff APNs schema. This is source-risk
  // reporting, never proof that any recipient or buyer received an outcome.
  const files = [
    "db/migrations/300_booking_portal_claim.sql",
    "db/migrations/522_staff_apns_devices.sql",
    "db/migrations/523_unrelated_index.sql",
    "db/seed/300_booking_portal_claim.sql",
    "docs/journeys/booking-notifications-flow.md"
  ];
  const report = reportCriticalSourceChanges(files, "");
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.unmappedHighRiskFiles, files.slice(0, 2));
  assert.equal(report.evidenceNote, "MISSING");
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(shouldReportCriticalSourceRisk(report), true);
  assert.deepEqual(unmappedHighRiskSourceChanges([
    "db/migrations/523_unrelated_index.sql", "db/seed/300_booking_portal_claim.sql"
  ]), []);
});

test("Netlify /api router and booking/native migration edits cannot silently escape A->B review", () => {
  // PR #307 modifies the one live /api/* adapter and creates the actual
  // authenticated iPhone first-open table. PR #280 changes the persistent
  // call qualification bucket. All were source-watch BLIND SPOTS before this.
  const report = reportCriticalSourceChanges([
    "netlify/functions/api.mjs",
    "db/migrations/521_native_client_app_opens.sql",
    "db/migrations/508_qualification_bucket.sql"
  ]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((edge) => edge.id), [
    "lead-booking-call-outcome", "native-portal-first-open"
  ]);
  assert.deepEqual(report.edges[0].files, ["db/migrations/508_qualification_bucket.sql"]);
  assert.deepEqual(report.edges[1].files, ["db/migrations/521_native_client_app_opens.sql"]);
  assert.deepEqual(report.unmappedHighRiskFiles, ["netlify/functions/api.mjs"]);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(report.evidenceNote, "MISSING");
  // Unseen future schema versions must request review rather than depend
  // only on today's migration numbers.
  assert.deepEqual(unmappedHighRiskSourceChanges([
    "db/migrations/522_another_native_device.sql",
    "db/migrations/523_new_qualification_flag.sql"
  ]), [
    "db/migrations/522_another_native_device.sql",
    "db/migrations/523_new_qualification_flag.sql"
  ]);
  assert.deepEqual(unmappedHighRiskSourceChanges([
    "db/migrations/524_unrelated_index.sql",
    "docs/diagrams/api-routing.md"
  ]), []);
});

test("unmapped high-risk PR edit cannot silently escape the report", () => {
  const report = reportCriticalSourceChanges(["api/invoice-settlement.mjs"]);
  assert.deepEqual(report.edges, []);
  assert.deepEqual(report.unmappedHighRiskFiles, ["api/invoice-settlement.mjs"]);
  assert.equal(shouldReportCriticalSourceRisk(report), true);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(shouldReportCriticalSourceRisk(reportCriticalSourceChanges(["docs/README.md"])), false);
  assert.equal(shouldReportCriticalSourceRisk(reportCriticalSourceChanges(["src/sales/closer-deck.mjs"])), true);
});

test("staff lead SMS and APNs producer edits require real recipient evidence, not send intent", () => {
  // #320 changes existing and new lead/booking/staff-push paths. Its staff
  // recipients are NOT clients, and a generic native delivery-failure check
  // alone is not a matching staff-recipient result.
  const files = [
    "src/staff/lead-alerts.mjs", "src/staff/booked-call-alert.mjs",
    "src/staff/message-recipient.mjs", "src/push/staff-native-store.mjs",
    "src/push/native-send.mjs", "api/push/native-device.mjs",
    "src/workflows/s-01-new-lead-intake.mjs", "src/messaging/dispatch.mjs"
  ];
  const report = reportCriticalSourceChanges(files);
  const edge = report.edges.find((item) => item.id === "staff-lead-alert-delivery");
  assert.ok(edge, "staff send path must not disappear from source-touch warnings");
  assert.equal(edge.severity, "P1");
  assert.deepEqual(edge.files, files);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(CRITICAL_EDGES.find((e) => e.id === edge.id).proofStatus,
    "PARTIAL_NEEDS_CORRELATED_STAFF_DELIVERY_CHECK");

  const staffEvent = { ...event, id: "staff-lead-event" };
  const staffConsumer = { ...consumer, event_id: staffEvent.id };
  const staffReceipt = { ...receipt, correlation_id: staffEvent.id };
  const fixture = { ...basics, event: staffEvent, consumer: staffConsumer,
    receipt: staffReceipt, providerReceipt: null, requireProviderReceipt: true };
  assert.deepEqual(judgeSyntheticEdge(fixture), {
    verdict: "RED", reason: "real-provider-delivery-missing"
  });
  assert.equal(judgeSyntheticEdge({ ...fixture, providerReceipt: {
    ...providerReceipt, event_id: staffEvent.id
  } }).verdict, "PASS");
  assert.equal(judgeSyntheticEdge({ ...fixture, providerReceipt: {
    ...providerReceipt, event_id: "wrong-staff-lead"
  } }).verdict, "RED");
});

test("shared staff shell edit requires real booking and customer-message result review", () => {
  // Staff SOP PR #312 edits shared shell navigation/role/context for actual
  // booking and messaging work. A generic unmapped warning is not sufficient.
  const report = reportCriticalSourceChanges(["public/app/shell.js"]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map(({ id, severity }) => [id, severity]), [
    ["lead-booking-call-outcome", "P1"],
    ["outbound-message-provider-receipt", "P1"]
  ]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(report.evidenceNote, "MISSING");
  assert.deepEqual(changedCriticalEdges(["src/http/app-client-carry.test.mjs"]), []);
});

test("existing closer/dispatch and setter source edits demand call-outcome proof", () => {
  // PR #292 edits closer-deck, which calls logCallOutcome; PR #278 edits
  // cockpit, setter dashboard and the task-claim API. All sit on the
  // lead -> appointment -> held call -> logged sales outcome A-to-B path.
  const touched = reportCriticalSourceChanges([
    "src/sales/closer-deck.mjs", "src/sales/cockpit.mjs",
    "src/setter/dashboard.mjs", "api/tasks.mjs",
    "public/app/closer-dashboard.html"
  ]);
  assert.equal(touched.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(touched.edges.map((edge) => edge.id), ["lead-booking-call-outcome"]);
  assert.deepEqual(touched.edges[0].files, [
    "src/sales/closer-deck.mjs", "src/sales/cockpit.mjs",
    "src/setter/dashboard.mjs", "api/tasks.mjs",
    "public/app/closer-dashboard.html"
  ]);
  assert.deepEqual(touched.unmappedHighRiskFiles, []);
  assert.equal(touched.evidenceNote, "MISSING");
  assert.equal(touched.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.deepEqual(changedCriticalEdges([
    "src/sales/closer-deck.test.mjs", "src/setter/dashboard.spec.mjs"
  ]), []);
});

test("open sales-Kanban and installed iPhone changes require live-result reviews", () => {
  // Open PRs #305/#307 touch the sales pipeline and the actual Swift sources
  // under tools/fundhub-ios. Neither path was previously caught by the v1 map.
  const result = reportCriticalSourceChanges([
    "api/dashboard/pipeline.mjs", "public/app/pipeline.html",
    "public/app/setter-dashboard.html", "api/native/client-activity.mjs",
    "tools/fundhub-ios/Fundhub/App/FundhubApp.swift",
    "tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift",
    "tools/fundhub-ios/Fundhub/App/FundhubApp.spec.swift",
    "tools/fundhub-ios/README.md", "tools/unrelated/build.mjs"
  ]);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(result.edges.map((e) => [e.id, e.severity]), [
    ["lead-booking-call-outcome", "P1"], ["native-portal-first-open", "P1"]
  ]);
  assert.deepEqual(result.edges[0].files, [
    "api/dashboard/pipeline.mjs", "public/app/pipeline.html",
    "public/app/setter-dashboard.html"
  ]);
  assert.deepEqual(result.edges[1].files, [
    "api/native/client-activity.mjs",
    "tools/fundhub-ios/Fundhub/App/FundhubApp.swift",
    "tools/fundhub-ios/Fundhub/Core/FundhubAPI.swift"
  ]);
  assert.deepEqual(result.unmappedHighRiskFiles, []);
  assert.equal(result.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.equal(result.evidenceNote, "MISSING");
  // Documentation and Swift unit-test changes do not claim installed device proof.
  assert.deepEqual(changedCriticalEdges([
    "tools/fundhub-ios/README.md",
    "tools/fundhub-ios/Fundhub/App/FundhubApp.spec.swift"
  ]), []);
  assert.deepEqual(changedCriticalEdges([
    "tools/fundhub-ios/Fundhub.xcodeproj/project.pbxproj"
  ]).map((e) => e.id), ["native-portal-first-open"]);
});

test("Blueprint FinanceOS entitlement edits require P0 paid-access and P1 delivery reviews", () => {
  // Blueprint #301 changes a customer's paid access and included annual term.
  // A monthly delivery check alone cannot prove payment/entitlement integrity.
  const report = reportCriticalSourceChanges(["src/finance/finance-os-entitlement.mjs"]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((edge) => [edge.id, edge.severity]), [
    ["payment-ledger-entitlement", "P0"],
    ["blueprint-financeos-report", "P1"]
  ]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
});

test("shared client lifecycle edits cannot hide payment, CRS or funding effects behind booking coverage", () => {
  // src/handlers/client-lifecycle.mjs registers payment.received,
  // diagnostic.paid, deposit.paid, analysis.completed and booking events.
  // A filename-level source watch must include all the affected P0 receipts.
  const report = reportCriticalSourceChanges(["src/handlers/client-lifecycle.mjs"]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((x) => [x.id, x.severity]), [
    ["lead-booking-call-outcome", "P1"],
    ["payment-ledger-entitlement", "P0"],
    ["consent-crs-result", "P0"],
    ["round-funded-fee-commission", "P0"]
  ]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
});

test("changing central event-bus registration reviews all dependent customer-result consumers", () => {
  // PR #278 modifies src/register-all.mjs; edits here can disconnect the
  // consumer despite unchanged business handler files.
  const report = reportCriticalSourceChanges(["src/register-all.mjs"]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((x) => x.id), [
    "lead-booking-call-outcome", "payment-ledger-entitlement", "consent-crs-result",
    "round-funded-fee-commission", "repair-enrollment-bureau-result",
    "blueprint-financeos-report", "outbound-message-provider-receipt"
  ]);
  assert.equal(report.edges.filter((x) => x.severity === "P0").length, 3);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
});

test("material changes in actually open money/booking/Blueprint PRs are reviewed", () => {
  const files = [
    "src/handlers/money-chain.mjs", // fulfillment PR #294
    "src/messaging/providers/cortana-booking-webhook.mjs", // booking PR #279
    "src/workflows/cortana-booking-feed.mjs", // booking PR #279
    "src/workflows/finance-os-pull-sweeper.mjs", // Blueprint PR #295
    "src/finance/finance-os-entitlement.mjs", // real report access
    "src/finance/soft-pulls.mjs" // explicit credit-pull consent
  ];
  const result = reportCriticalSourceChanges(files);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(result.edges.map((x) => x.id), [
    "lead-booking-call-outcome", "payment-ledger-entitlement", "consent-crs-result",
    "round-funded-fee-commission", "blueprint-financeos-report", "outbound-message-provider-receipt"
  ]);
  assert.deepEqual(result.unmappedHighRiskFiles, []);
  const newRisk = "src/handlers/new-payment-webhook.mjs";
  assert.deepEqual(unmappedHighRiskSourceChanges([newRisk, "src/ui/theme.mjs", "docs/booking.md", "src/handlers/new-payment-webhook.test.mjs"]), [newRisk]);
  assert.equal(reportCriticalSourceChanges([newRisk]).verdict, "REVIEW_REQUIRED");
  assert.equal(reportCriticalSourceChanges([newRisk]).liveReceipt, "NEEDS_LIVE_RECEIPT");
  const sharedUi = reportCriticalSourceChanges([
    "api/read/invoices.mjs", "public/app/calendar.html",
    "public/app/client-portal.html", "public/app/calendar-workspace.css"
  ]);
  assert.deepEqual(sharedUi.edges.map((edge) => edge.id), [
    "lead-booking-call-outcome", "payment-ledger-entitlement",
    "outbound-message-provider-receipt", "native-portal-first-open"
  ]);
  assert.deepEqual(sharedUi.unmappedHighRiskFiles, []);
  assert.deepEqual(unmappedHighRiskSourceChanges(["public/app/calendar-workspace.css"]), []);
});

test("existing portal HTML edits cannot escape paid access, client inbox, or native proof review", () => {
  // Client portal is both the end of the paid-entitlement chain, the rendered
  // customer message inbox, and a native WKWebView target. PR #255 edits it.
  // Source-touch proof is NOT an installed device receipt or live delivery.
  const report = reportCriticalSourceChanges(["public/app/client-portal.html"]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((e) => [e.id, e.severity]), [
    ["payment-ledger-entitlement", "P0"],
    ["outbound-message-provider-receipt", "P1"],
    ["native-portal-first-open", "P1"]
  ]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");
  assert.deepEqual(changedCriticalEdges(["public/app/client-portal.spec.mjs"]), []);
});

test("active funding and A/R producer edits require both P0 money-result reviews", () => {
  // Fulfillment PR #299 and A/R PR #300 have distinct source owners. Merely
  // listing one heartbeat must not hide a change to the other money result.
  const touched = reportCriticalSourceChanges([
    "src/funding/card-stacking-rounds.mjs",
    "src/handlers/money-chain.mjs"
  ]);
  assert.equal(touched.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(touched.edges.map((e) => [e.id, e.severity]), [
    ["payment-ledger-entitlement", "P0"],
    ["round-funded-fee-commission", "P0"]
  ]);
  assert.deepEqual(touched.unmappedHighRiskFiles, []);
  assert.equal(touched.evidenceNote, "MISSING");
  assert.equal(touched.liveReceipt, "NEEDS_LIVE_RECEIPT");
});

test("A/R A77 callback cannot settle a foreign-org link or invent buyer access", () => {
  // #300 changes both existing payment handlers and the link-store family.
  // Watch future source filenames, not just the one known implementation.
  const report = reportCriticalSourceChanges([
    "src/handlers/payment-links.mjs",
    "src/payment-links/index.mjs",
    "src/payment-links/future-checkout.mjs",
    "src/workflows/ar-collections.mjs"
  ]);
  assert.equal(report.verdict, "REVIEW_REQUIRED");
  assert.deepEqual(report.edges.map((edge) => [edge.id, edge.severity]), [
    ["payment-ledger-entitlement", "P0"]
  ]);
  assert.deepEqual(report.unmappedHighRiskFiles, []);
  assert.equal(report.liveReceipt, "NEEDS_LIVE_RECEIPT");

  // This is a normalized, SYNTHETIC payment receipt and joined settlement
  // witness, not proof that a real PSP or live DB exposes these same fields.
  const settled = {
    event_id: id, org_id: org, client_id: client,
    payment_link_id: "plink-sim", provider_ref: "psp-ref-sim",
    sale_id: "sale-sim", outcome: "settled",
    settled_at: "2026-10-29T00:07:00Z"
  };
  const witness = {
    ...basics, requirePaymentLinkReceipt: true,
    expectedContract: {
      eventName: "payment.received", eventVersion: 1,
      consumerName: "onPaymentReceivedMoney", resultKind: "sale_payments"
    },
    event: { ...event, name: "payment.received", version: 1,
      payment_link_id: settled.payment_link_id,
      provider_ref: settled.provider_ref, sale_id: settled.sale_id },
    consumer: { ...consumer, consumer_name: "onPaymentReceivedMoney",
      completed_at: "2026-10-29T00:08:00Z" },
    receipt: { ...receipt, event_id: id, result_kind: "sale_payments",
      sale_id: settled.sale_id, completed_at: "2026-10-29T00:09:00Z" },
    paymentLinkReceipt: settled
  };
  assert.equal(judgeSyntheticEdge(witness).verdict, "PASS");
  // Source-reproduced false green: an event with no original sale anchor,
  // or a correct paid link paired with someone else\'s sale ledger payment,
  // previously returned PASS even with the strict canonical contract.
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, event: { ...witness.event, sale_id: undefined }
  }), { verdict: "NOT_CHECKED", reason: "payment-link-event-identity-unavailable" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, receipt: { ...witness.receipt, sale_id: null }
  }), { verdict: "NOT_CHECKED", reason: "sale-payment-ledger-identity-unavailable" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, receipt: { ...witness.receipt, sale_id: "another-sale" }
  }), { verdict: "RED", reason: "sale-payment-ledger-original-sale-mismatch" });
  assert.equal(changedCriticalEdges(["src/workflows/ar-collections.mjs"])[0].id,
    "payment-ledger-entitlement", "A/R unmatched invoice review is a P0 business-result path");
  assert.deepEqual(unmappedHighRiskSourceChanges(["src/workflows/ar-collections.mjs"]), []);
  for (const changed of [
    { org_id: "other-org" },
    { client_id: "other-client" },
    { event_id: "other-payment" }
  ]) {
    assert.deepEqual(judgeSyntheticEdge({
      ...witness, paymentLinkReceipt: { ...settled, ...changed }
    }), { verdict: "RED", reason: "payment-link-ownership-or-event-mismatch" });
  }
  for (const changed of [
    { payment_link_id: "foreign-link" },
    { provider_ref: "other-provider-reference" },
    { sale_id: "foreign-sale" },
    { outcome: "pending" }
  ]) {
    assert.deepEqual(judgeSyntheticEdge({
      ...witness, paymentLinkReceipt: { ...settled, ...changed }
    }), { verdict: "RED", reason: "payment-link-settlement-identity-mismatch" });
  }
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, paymentLinkReceipt: null
  }), { verdict: "RED", reason: "payment-link-paid-row-missing" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, paymentLinkReceipt: undefined
  }), { verdict: "NOT_CHECKED", reason: "payment-link-settlement-proof-not-queried" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, event: { ...witness.event, provider_ref: null }
  }), { verdict: "NOT_CHECKED", reason: "payment-link-event-identity-unavailable" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, paymentLinkReceipt: { ...settled, settled_at: null }
  }), { verdict: "NOT_CHECKED", reason: "payment-link-settlement-timestamp-missing" });
  for (const settled_at of ["2026-10-28T23:59:00Z", "2026-10-29T02:00:00Z"]) {
    assert.deepEqual(judgeSyntheticEdge({
      ...witness, paymentLinkReceipt: { ...settled, settled_at }
    }), { verdict: "RED", reason: "payment-link-settlement-time-invalid" });
  }
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, paymentLinkReceipt: { ...settled, org_id: "other-org" },
    now: "2026-10-29T00:03:00Z"
  }), { verdict: "PENDING", reason: "payment-link-ownership-or-event-mismatch" });
});

test("wrong source, consumer, identity, trace or business result turns RED after grace", () => {
  const changes = [
    { event: null },
    { consumer: null },
    { consumer: { ...consumer, org_id: "other-org" } },
    { consumer: { ...consumer, client_id: "other-client" } },
    { consumer: { ...consumer, event_id: "other-event" } },
    { consumer: { ...consumer, outcome: "queued" } },
    { receipt: null },
    { receipt: { ...receipt, org_id: "other-org" } },
    { receipt: { ...receipt, client_id: "other-client" } },
    { receipt: { ...receipt, correlation_id: "other-event" } },
    { receipt: { ...receipt, outcome: "row-exists-only" } }
  ];
  for (const change of changes) {
    assert.equal(judgeSyntheticEdge({ ...basics, ...change }).verdict, "RED", JSON.stringify(change));
  }
  assert.equal(judgeSyntheticEdge(basics).verdict, "PASS");
});

test("provider receipt, grace, no-demand and missing data cannot become fake PASS", () => {
  assert.equal(judgeSyntheticEdge({ ...basics, requireProviderReceipt: true }).verdict, "RED");
  assert.equal(judgeSyntheticEdge({ ...basics, requireProviderReceipt: true, providerReceipt }).verdict, "PASS");
  assert.equal(judgeSyntheticEdge({ ...basics, requireProviderReceipt: true,
    providerReceipt: { ...providerReceipt, outcome: "accepted" } }).verdict, "RED");
  assert.equal(judgeSyntheticEdge({ ...basics, receipt: null, now: "2026-10-29T00:03:00Z" }).verdict, "PENDING");
  assert.equal(judgeSyntheticEdge({ ...basics, demand: false, event: null }).verdict, "NA");
  assert.deepEqual(judgeSyntheticEdge({ ...basics, demand: false }), {
    verdict: "NOT_CHECKED", reason: "event-present-but-demand-marked-absent"
  });
  assert.equal(judgeSyntheticEdge({ ...basics, demandAt: null, event: null }).verdict, "NOT_CHECKED");
});

test("shared journey trace cannot launder another event or stale result", () => {
  const tracedEvent = { ...event, correlation_id: "trace-one" };
  const tracedConsumer = { ...consumer, correlation_id: "trace-one" };
  const tracedReceipt = { ...receipt, event_id: id, correlation_id: "trace-one" };
  const traced = { ...basics, event: tracedEvent, consumer: tracedConsumer, receipt: tracedReceipt };
  assert.equal(judgeSyntheticEdge(traced).verdict, "PASS");
  const bad = [
    { consumer: { ...tracedConsumer, event_id: "another-event" } },
    { receipt: { ...tracedReceipt, event_id: "another-event" } },
    { consumer: { ...tracedConsumer, correlation_id: "another-trace" } },
    { receipt: { ...tracedReceipt, correlation_id: "another-trace" } },
    { consumer: { ...tracedConsumer, created_at: "2026-10-28T23:59:00Z" } },
    { receipt: { ...tracedReceipt, created_at: "2026-10-28T23:59:00Z" } },
    { consumer: { ...tracedConsumer, event_id: null, correlation_id: "" } },
    { receipt: { ...tracedReceipt, event_id: null, correlation_id: "" } }
  ];
  for (const change of bad) {
    assert.equal(judgeSyntheticEdge({ ...traced, ...change }).verdict, "RED", JSON.stringify(change));
  }
});

test("shared journey-only correlation is not exact event-to-result proof", () => {
  // Two legitimate events can share one journey trace. A receipt with only
  // that trace must not clear an unrelated event, even inside the same client.
  const journey = "shared-journey";
  const second = { ...event, id: "event-second", correlation_id: journey };
  const first = { ...event, id: "event-first", correlation_id: journey };
  const consumedSecond = { ...consumer, event_id: second.id, correlation_id: journey };
  const receiptFromJourneyOnly = {
    org_id: org, client_id: client, correlation_id: journey, outcome: "satisfied"
  };
  const check = { ...basics, event: second, consumer: consumedSecond, receipt: receiptFromJourneyOnly };
  assert.equal(judgeSyntheticEdge(check).verdict, "RED");
  assert.equal(judgeSyntheticEdge({ ...check, receipt: {
    ...receiptFromJourneyOnly, event_id: first.id
  } }).verdict, "RED");
  assert.equal(judgeSyntheticEdge({ ...check, receipt: {
    ...receiptFromJourneyOnly, event_id: second.id
  } }).verdict, "PASS");
  assert.equal(judgeSyntheticEdge({ ...check, requireProviderReceipt: true,
    receipt: { ...receiptFromJourneyOnly, event_id: second.id },
    providerReceipt: { org_id: org, client_id: client,
      correlation_id: journey, outcome: "delivered" }
  }).verdict, "RED");
  assert.equal(judgeSyntheticEdge({ ...check, requireProviderReceipt: true,
    receipt: { ...receiptFromJourneyOnly, event_id: second.id },
    providerReceipt: { org_id: org, client_id: client, event_id: second.id,
      correlation_id: journey, outcome: "delivered" }
  }).verdict, "PASS");
});

test("NULL-client booking event needs exact org-scoped identity resolution, not an email guess", () => {
  const unlinkedEvent = { ...event, client_id: null, payload: { email: "synthetic@example.invalid" } };
  const noClient = { ...basics, event: unlinkedEvent };
  assert.equal(judgeSyntheticEdge(noClient).verdict, "RED");
  const identityReceipt = { event_id: id, org_id: org, client_id: client, outcome: "resolved" };
  assert.equal(judgeSyntheticEdge({ ...noClient, identityReceipt }).verdict, "PASS");
  for (const bad of [
    { ...identityReceipt, org_id: "other-org" },
    { ...identityReceipt, event_id: "other-event" },
    { ...identityReceipt, outcome: "queued" },
    { ...identityReceipt, client_id: "other-client" }
  ]) {
    assert.equal(judgeSyntheticEdge({ ...noClient, identityReceipt: bad }).verdict, "RED", JSON.stringify(bad));
  }
});

test("every new P0/P1 money, booking and messaging PR source has A->B mapping", () => {
  const files = [
    "src/invoices/index.mjs",                   // A/R PR #298
    "src/finance/finance-os-pull-fulfil.mjs",   // Blueprint #297
    "src/auth/magic-link.mjs",                  // booked-account claim #278
    "src/config/survey-qualification.mjs",     // booking bucket #280
    "src/setter/tasks.mjs",                     // staff calendar #270
    "src/chat/internal.mjs",                    // message ownership #272
    "api/read/inbox.mjs",                       // client inbox #278
    "src/finance/bank-strategy.mjs"             // lender guidance
  ];
  const result = reportCriticalSourceChanges(files);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  for (const id of [
    "lead-booking-call-outcome", "payment-ledger-entitlement",
    "round-funded-fee-commission", "blueprint-financeos-report",
    "outbound-message-provider-receipt", "lender-apply-link"
  ]) {
    assert.ok(result.edges.some((e) => e.id === id), id);
  }
  assert.deepEqual(result.unmappedHighRiskFiles, []);
  assert.equal(result.liveReceipt, "NEEDS_LIVE_RECEIPT");
});

function changedFilesFromPrEnvironment() {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) return { status: "NOT_CHECKED", why: "no GitHub PR event context" };
  let payload;
  try { payload = JSON.parse(fs.readFileSync(eventPath, "utf8")); }
  catch { return { status: "NOT_CHECKED", why: "PR event payload unreadable" }; }
  const sha = payload?.pull_request?.base?.sha;
  if (!sha) return { status: "NOT_CHECKED", why: "not a pull request with a base SHA" };
  try {
    // Actions checkout normally uses depth 1: fetch only the immutable base
    // snapshot when absent. No repository business files are changed.
    try {
      execFileSync("git", ["cat-file", "-e", sha + "^{commit}"], {
        cwd: ROOT, timeout: 3_000, stdio: "ignore"
      });
    } catch {
      execFileSync("git", ["fetch", "--no-tags", "--depth=1", "origin", sha], {
        cwd: ROOT, timeout: 15_000, stdio: "ignore"
      });
    }
    // Base tree versus checked-out PR head works on shallow checkout/merge refs.
    const raw = execFileSync("git", ["diff", "--name-only", sha, "HEAD"], {
      cwd: ROOT, encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return { status: "READ", files: raw.split(/\r?\n/).filter(Boolean), body: payload.pull_request?.body || "" };
  } catch {
    return { status: "NOT_CHECKED", why: "immutable PR base snapshot or diff unavailable" };
  }
}

test("REPORT ONLY: PR modified source requires correlated result evidence review", () => {
  const data = changedFilesFromPrEnvironment();
  if (data.status !== "READ") {
    if (process.env.CI) console.warn("PULSE A->B NOT_CHECKED: " + data.why);
    return;
  }
  const report = reportCriticalSourceChanges(data.files, data.body);
  if (shouldReportCriticalSourceRisk(report)) {
    console.warn("PULSE A->B REPORT ONLY (not a live PASS): " + JSON.stringify(report));
  }
});

test("P0 credit pull and P1 bureau-letter proof require exact, prior unrevoked consent", () => {
  const creditEdge = CRITICAL_EDGES.find((edge) => edge.id === "consent-crs-result");
  const repairEdge = CRITICAL_EDGES.find((edge) => edge.id === "repair-enrollment-bureau-result");
  assert.equal(creditEdge.consentScope, "credit-soft-pull");
  assert.equal(repairEdge.consentScope, "bureau-letter-send");

  // Payment may precede the signature. The actual provider action must not.
  const consentEvent = { ...event, consent_id: "signed-consent-1" };
  const sentAt = "2026-10-29T00:10:00Z";
  const authorization = {
    id: "signed-consent-1", org_id: org, client_id: client,
    scope: creditEdge.consentScope, outcome: "authorized",
    signed_at: "2026-10-29T00:05:00Z"
  };
  const authorized = {
    ...basics, event: consentEvent,
    consumer: { ...consumer, provider_action_at: sentAt },
    consentReceipt: authorization,
    requireConsentReceipt: true, consentScope: creditEdge.consentScope
  };
  assert.equal(judgeSyntheticEdge(authorized).verdict, "PASS");
  const broken = [
    { consentReceipt: null },
    { event: { ...consentEvent, consent_id: "another-consent" } },
    { consentReceipt: { ...authorization, org_id: "foreign-org" } },
    { consentReceipt: { ...authorization, client_id: "another-client" } },
    { consentReceipt: { ...authorization, scope: repairEdge.consentScope } },
    { consentReceipt: { ...authorization, outcome: "pending" } },
    { consentReceipt: { ...authorization, signed_at: "2026-10-29T00:12:00Z" } },
    { consentReceipt: { ...authorization, revoked_at: "2026-10-29T00:09:00Z" } },
    { consentReceipt: { ...authorization, revoked_at: "invalid" } },
    { consumer: { ...consumer } },
    { consentScope: null }
  ];
  for (const change of broken) {
    assert.deepEqual(judgeSyntheticEdge({ ...authorized, ...change }), {
      verdict: "RED", reason: "authorized-consent-before-provider-action-missing"
    });
  }
  assert.equal(judgeSyntheticEdge({
    ...authorized, now: "2026-10-29T00:02:00Z", consentReceipt: null
  }).verdict, "PENDING");
  assert.equal(judgeSyntheticEdge({
    ...authorized, consentScope: repairEdge.consentScope,
    consentReceipt: { ...authorization, scope: repairEdge.consentScope }
  }).verdict, "PASS");
  assert.equal(judgeSyntheticEdge({
    ...authorized, consumer: null
  }).reason, "consumer-not-completed-for-event");
});

test("strict A->B witness rejects wrong canonical event version, consumer and persisted result identity", () => {
  // Contract metadata here is SYNTHETIC and not a production ledger receipt.
  // A matching trace with the wrong event type/handler/table used to false-PASS.
  const expectedContract = {
    eventName: "payment.received", eventVersion: 1,
    consumerName: "onPaymentReceivedMoney", resultKind: "sale_payments"
  };
  const strict = {
    ...basics, expectedContract,
    event: { ...event, name: expectedContract.eventName, version: expectedContract.eventVersion },
    consumer: { ...consumer, consumer_name: expectedContract.consumerName,
      completed_at: "2026-10-29T00:04:00Z" },
    receipt: { ...receipt, result_kind: expectedContract.resultKind,
      completed_at: "2026-10-29T00:05:00Z" }
  };
  assert.equal(judgeSyntheticEdge(strict).verdict, "PASS", "all four correlated contract parts match");

  const negatives = [
    [{ event: { ...strict.event, name: "booking.created" } }, "producer-canonical-contract-mismatch"],
    [{ event: { ...strict.event, version: 2 } }, "producer-canonical-contract-mismatch"],
    [{ event: { ...strict.event, version: undefined } }, "producer-canonical-contract-mismatch"],
    [{ consumer: { ...strict.consumer, consumer_name: "onBookingCreated" } }, "consumer-canonical-contract-mismatch"],
    [{ consumer: { ...strict.consumer, consumer_name: undefined } }, "consumer-canonical-contract-mismatch"],
    [{ receipt: { ...strict.receipt, result_kind: "call_outcomes" } }, "result-canonical-contract-mismatch"],
    [{ receipt: { ...strict.receipt, result_kind: undefined } }, "result-canonical-contract-mismatch"]
  ];
  for (const [change, reason] of negatives) {
    assert.deepEqual(judgeSyntheticEdge({ ...strict, ...change }), { verdict: "RED", reason });
  }

  assert.deepEqual(judgeSyntheticEdge({
    ...strict, expectedContract: { eventName: "payment.received" }
  }), { verdict: "NOT_CHECKED", reason: "incomplete-canonical-edge-contract" });
  assert.deepEqual(judgeSyntheticEdge({
    ...strict, event: { ...strict.event, name: "booking.created" },
    now: "2026-10-29T00:03:00Z"
  }), { verdict: "PENDING", reason: "producer-canonical-contract-mismatch" });
});

test("strict A->B witnesses cannot clear pre-existing or future business results", () => {
  const expectedContract = {
    eventName: "payment.received", eventVersion: 1,
    consumerName: "onPaymentReceivedMoney", resultKind: "sale_payments"
  };
  const strict = {
    ...basics, expectedContract,
    event: { ...event, name: "payment.received", version: 1 },
    consumer: { ...consumer, consumer_name: "onPaymentReceivedMoney",
      completed_at: "2026-10-29T00:04:00Z" },
    receipt: { ...receipt, result_kind: "sale_payments",
      completed_at: "2026-10-29T00:05:00Z" }
  };
  assert.equal(judgeSyntheticEdge(strict).verdict, "PASS");
  for (const change of [
    { consumer: { ...strict.consumer, completed_at: undefined } },
    { receipt: { ...strict.receipt, completed_at: undefined } },
    { event: { ...strict.event, created_at: undefined } }
  ]) {
    assert.deepEqual(judgeSyntheticEdge({ ...strict, ...change }), {
      verdict: "NOT_CHECKED", reason: "canonical-proof-timestamps-missing"
    }, JSON.stringify(change));
  }
  for (const change of [
    { receipt: { ...strict.receipt, completed_at: "2026-10-29T00:03:00Z" } },
    { consumer: { ...strict.consumer, completed_at: "2026-10-29T02:00:00Z" } },
    { receipt: { ...strict.receipt, completed_at: "2026-10-29T02:00:00Z" } }
  ]) {
    assert.deepEqual(judgeSyntheticEdge({ ...strict, ...change }), {
      verdict: "RED", reason: "canonical-proof-timestamp-order-invalid"
    }, JSON.stringify(change));
  }
  // A future event with an earlier consumer is rejected by the correlation
  // gate even before the stricter canonical timestamp witness runs.
  assert.deepEqual(judgeSyntheticEdge({
    ...strict, event: { ...strict.event, created_at: "2026-10-29T02:00:00Z" },
    demandAt: "2026-10-29T00:00:00Z"
  }), { verdict: "RED", reason: "consumer-not-completed-for-event" });
  const delivery = {
    ...strict, requireProviderReceipt: true,
    providerReceipt: { ...providerReceipt, delivered_at: "2026-10-29T00:07:00Z" }
  };
  assert.equal(judgeSyntheticEdge(delivery).verdict, "PASS");
  assert.deepEqual(judgeSyntheticEdge({
    ...delivery, providerReceipt: { ...delivery.providerReceipt, delivered_at: undefined }
  }), { verdict: "NOT_CHECKED", reason: "provider-proof-timestamp-missing" });
  for (const delivered_at of ["2026-10-29T00:02:00Z", "2026-10-29T02:00:00Z"]) {
    assert.deepEqual(judgeSyntheticEdge({
      ...delivery, providerReceipt: { ...delivery.providerReceipt, delivered_at }
    }), { verdict: "RED", reason: "provider-proof-timestamp-order-invalid" });
  }
});


test("P0/P1 consent proof cannot PASS a future or pre-event provider action or a premature result", () => {
  // Strict source-level fixture only: no credit bureau order, provider read or
  // live customer result. The original judge falsely PASSed all three cases.
  const expectedContract = {
    eventName: "diagnostic.paid", eventVersion: 1,
    consumerName: "onDiagnosticPaidSoftPull", resultKind: "crs_results"
  };
  const witness = {
    ...basics, expectedContract, requireConsentReceipt: true,
    consentScope: "credit-soft-pull",
    event: { ...event, consent_id: "consent-sim", name: "diagnostic.paid", version: 1 },
    consumer: { ...consumer, consumer_name: "onDiagnosticPaidSoftPull",
      completed_at: "2026-10-29T00:12:00Z", provider_action_at: "2026-10-29T00:10:00Z" },
    receipt: { ...receipt, result_kind: "crs_results",
      completed_at: "2026-10-29T00:15:00Z" },
    consentReceipt: { id: "consent-sim", org_id: org, client_id: client,
      scope: "credit-soft-pull", outcome: "authorized",
      signed_at: "2026-10-29T00:05:00Z" }
  };
  assert.equal(judgeSyntheticEdge(witness).verdict, "PASS");
  for (const actionTime of ["2026-10-28T23:59:00Z", "2026-10-29T02:00:00Z"]) {
    assert.deepEqual(judgeSyntheticEdge({ ...witness, consumer: {
      ...witness.consumer, provider_action_at: actionTime
    } }), { verdict: "RED", reason: "provider-action-time-outside-observed-window" });
  }
  assert.deepEqual(judgeSyntheticEdge({ ...witness, receipt: {
    ...witness.receipt, completed_at: "2026-10-29T00:08:00Z"
  }, consumer: { ...witness.consumer, completed_at: "2026-10-29T00:07:00Z" }
  }), { verdict: "RED", reason: "business-result-precedes-provider-action" });
  assert.deepEqual(judgeSyntheticEdge({ ...witness,
    event: { ...witness.event, created_at: null }
  }), { verdict: "NOT_CHECKED", reason: "provider-action-event-time-missing" });
  assert.deepEqual(judgeSyntheticEdge({ ...witness, consumer: {
    ...witness.consumer, provider_action_at: "2026-10-29T02:00:00Z"
  }, now: "2026-10-29T00:03:00Z" }), {
    verdict: "PENDING", reason: "provider-action-time-outside-observed-window"
  });
});

test("P0 monthly real CRS provider orders cannot double-fire or borrow a foreign receipt", () => {
  // Blueprint #301's concurrent worker claim path can reach one saved credit
  // request twice. No real bureau call occurs: these are normalized synthetic
  // provider-order witnesses, NOT a live vendor receipt or duplicate claim.
  // Both monthly producer files must request P0 consent/CRS and P1 delivery
  // review whenever their existing source code changes.
  const changes = reportCriticalSourceChanges([
    "src/finance/finance-os-pull-fulfil.mjs",
    "src/workflows/finance-os-pull-sweeper.mjs",
    "src/finance/crs-pull.mjs"
  ]);
  assert.deepEqual(changes.edges.map((x) => [x.id, x.severity]), [
    ["consent-crs-result", "P0"], ["blueprint-financeos-report", "P1"]
  ]);
  assert.equal(changes.liveReceipt, "NEEDS_LIVE_RECEIPT");

  const requestId = "monthly-soft-pull-request-synthetic";
  const consentId = "signed-monthly-credit-consent-synthetic";
  const firstOrder = {
    event_id: id, org_id: org, client_id: client, request_id: requestId,
    provider_order_id: "crs-order-one", ordered_at: "2026-10-29T00:10:30Z"
  };
  const witness = {
    ...basics, requireUniqueProviderOrder: true,
    requireConsentReceipt: true, consentScope: "credit-soft-pull",
    expectedContract: {
      eventName: "finance-os.monthly-pull-requested", eventVersion: 1,
      consumerName: "fulfilQueuedSystemPulls", resultKind: "crs_results"
    },
    event: { ...event, request_id: requestId, consent_id: consentId,
      name: "finance-os.monthly-pull-requested", version: 1 },
    consumer: { ...consumer, consumer_name: "fulfilQueuedSystemPulls",
      provider_action_at: "2026-10-29T00:10:00Z", completed_at: "2026-10-29T00:12:00Z" },
    receipt: { ...receipt, result_kind: "crs_results",
      completed_at: "2026-10-29T00:15:00Z" },
    consentReceipt: { id: consentId, org_id: org, client_id: client,
      scope: "credit-soft-pull", outcome: "authorized",
      signed_at: "2026-10-29T00:05:00Z" },
    providerOrders: [firstOrder]
  };
  assert.equal(judgeSyntheticEdge(witness).verdict, "PASS");
  // Retried webhook/callback for the *same* external provider order is not a
  // second credit pull. Two separate external order IDs are.
  assert.equal(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder }]
  }).verdict, "PASS");
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder, provider_order_id: "crs-order-two" }]
  }), { verdict: "RED", reason: "duplicate-provider-orders-for-request" });
  // A retry may create a new event while reusing the SAME saved pull request.
  // A second external order must still be RED, not hidden by event_id filtering.
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder,
      event_id: "retry-event", provider_order_id: "crs-order-two" }]
  }), { verdict: "RED", reason: "duplicate-provider-orders-for-request" });
  // Repeated receipts for one external order are not double bureau requests.
  assert.equal(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder, event_id: "retry-event" }]
  }).verdict, "PASS");
  // A foreign tenant's order with the same request string cannot contaminate
  // the protected org/client request trace.
  assert.equal(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder, event_id: "foreign-event",
      org_id: "other-org", client_id: "other-client", provider_order_id: "foreign-order" }]
  }).verdict, "PASS");
  // A receipt attached exclusively to a DIFFERENT event is not valid producer
  // proof, even when the request and external order happen to match.
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, providerOrders: [{ ...firstOrder, event_id: "retry-event" }]
  }), { verdict: "RED", reason: "provider-order-event-correlation-missing" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, providerOrders: [firstOrder, { ...firstOrder, org_id: "foreign-org" }]
  }), { verdict: "RED", reason: "provider-order-identity-mismatch" });
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, providerOrders: [{ ...firstOrder, request_id: "other-request" }]
  }), { verdict: "RED", reason: "provider-order-identity-mismatch" });
  assert.deepEqual(judgeSyntheticEdge({ ...witness, providerOrders: [] }), {
    verdict: "RED", reason: "provider-order-receipt-missing"
  });
  assert.deepEqual(judgeSyntheticEdge({ ...witness, providerOrders: undefined }), {
    verdict: "NOT_CHECKED", reason: "provider-order-proof-not-available"
  });
  assert.deepEqual(judgeSyntheticEdge({ ...witness, providerOrders: [{
    ...firstOrder, provider_order_id: null
  }] }), { verdict: "NOT_CHECKED", reason: "provider-order-identity-unavailable" });
  assert.deepEqual(judgeSyntheticEdge({ ...witness, providerOrders: [{
    ...firstOrder, ordered_at: null
  }] }), { verdict: "NOT_CHECKED", reason: "provider-order-timestamp-missing" });
  for (const ordered_at of ["2026-10-29T00:09:59Z", "2026-10-29T02:00:00Z"]) {
    assert.deepEqual(judgeSyntheticEdge({ ...witness, providerOrders: [{
      ...firstOrder, ordered_at
    }] }), { verdict: "RED", reason: "provider-order-timestamp-outside-observed-window" });
  }
  assert.deepEqual(judgeSyntheticEdge({
    ...witness, consentReceipt: null
  }), { verdict: "RED", reason: "authorized-consent-before-provider-action-missing" });
});
