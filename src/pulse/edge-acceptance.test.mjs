import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EDGE_CONTRACT_VERSION, CRITICAL_EDGES, changedCriticalEdges, unmappedHighRiskSourceChanges,
  reportCriticalSourceChanges, judgeSyntheticEdge
} from "./edge-acceptance.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const org = "org-synthetic", client = "client-synthetic", id = "event-synthetic";
const event = { id, org_id: org, client_id: client, created_at: "2026-10-29T00:00:00Z" };
const consumer = { event_id: id, org_id: org, client_id: client, outcome: "completed" };
const receipt = { correlation_id: id, org_id: org, client_id: client, outcome: "satisfied" };
const providerReceipt = { event_id: id, org_id: org, client_id: client, outcome: "delivered" };
const basics = { event, consumer, receipt, now: "2026-10-29T01:00:00Z", demandAt: event.created_at, graceMs: 600_000 };

test("A->B contract is versioned and covers ten business families", () => {
  assert.equal(EDGE_CONTRACT_VERSION, 1);
  assert.equal(CRITICAL_EDGES.length, 10);
  for (const edge of CRITICAL_EDGES) {
    assert.match(edge.id, /^[a-z0-9-]+$/);
    assert.match(edge.pulse, /^[a-z0-9:-]+$/);
    assert.ok(edge.paths.length > 0);
    assert.ok(["P0", "P1", "P2"].includes(edge.severity));
  }
  assert.equal(new Set(CRITICAL_EDGES.map((e) => e.id)).size, CRITICAL_EDGES.length);
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
  if (report.edges.length) {
    console.warn("PULSE A->B REPORT ONLY (not a live PASS): " + JSON.stringify(report));
  }
});
