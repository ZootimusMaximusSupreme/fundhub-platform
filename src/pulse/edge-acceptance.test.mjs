import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  EDGE_CONTRACT_VERSION, CRITICAL_EDGES, changedCriticalEdges,
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
  assert.equal(judgeSyntheticEdge({ ...basics, demand: false }).verdict, "NA");
  assert.equal(judgeSyntheticEdge({ ...basics, demandAt: null, event: null }).verdict, "NOT_CHECKED");
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
    const raw = execFileSync("git", ["diff", "--name-only", sha + "...HEAD"], {
      cwd: ROOT, encoding: "utf8", timeout: 10_000, maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"]
    });
    return { status: "READ", files: raw.split(/\r?\n/).filter(Boolean), body: payload.pull_request?.body || "" };
  } catch {
    return { status: "NOT_CHECKED", why: "base commit absent or diff unavailable in CI checkout" };
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
