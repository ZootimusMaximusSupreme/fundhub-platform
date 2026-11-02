// src/slo/status.mjs — the /roadmap widget's status answer. Pure unit test;
// the real-row proof is src/http/slo-status.pg.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bureausFromFailReason,
  bureausFromResult,
  decisionKeyFor,
  loadOrderPullRequests,
  loadSloStatus,
  paFromEstimate,
  sloDemoLedgerPrefix,
  sloStatusFromRows
} from "./status.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REF = "slo_0123456789abcdef01234567";
const FOUND = { id: CLIENT, org_id: ORG, order_id: ORDER, order_ref: REF };

const CRS_ALL = {
  id: "crs-1",
  outcome_tier: "FULL_FUNDING",
  created_at: "2026-09-22T10:05:00Z",
  bureaus_pulled: ["TU", "EX", "EQ"],
  bureau_errors: {},
  bureau_status: {}
};

test("nothing yet: running, not started, every bureau pending, no bucket, no offer", () => {
  const s = sloStatusFromRows({});
  assert.deepEqual(s, {
    ok: true,
    state: "running",
    started: false,
    demo: false,
    bucket: null,
    pa: null,
    bureaus: { TU: "pending", EX: "pending", EQ: "pending" },
    book_url: null,
    repair_offer: null
  });
});

test("a queued or processing request is running", () => {
  for (const status of ["queued", "processing"]) {
    const s = sloStatusFromRows({ request: { status, requested_at: "2026-09-22T10:00:00Z" } });
    assert.equal(s.state, "running");
    assert.equal(s.started, true);
  }
});

test("stored but no decision yet: still running (the tier is being written)", () => {
  const s = sloStatusFromRows({ request: { status: "fulfilled" }, crs: CRS_ALL, decision: null });
  assert.equal(s.state, "running");
  assert.equal(s.bucket, null);
  assert.equal(s.bureaus.TU, "file_returned");
});

test("done, funding: bucket funding, pa whole dollars, booking link carries ?pa=", () => {
  const s = sloStatusFromRows({
    request: { status: "fulfilled" },
    crs: CRS_ALL,
    clientTier: "FULL_FUNDING",
    decision: { outcome_tier: "FULL_FUNDING", funding_estimate: "84500.4" }
  });
  assert.equal(s.state, "done");
  assert.equal(s.bucket, "funding");
  assert.equal(s.pa, 84500);
  assert.equal(s.book_url, "https://apply.fundhub.ai/roadmap-book?pa=84500");
  assert.equal(s.repair_offer, null);
  assert.deepEqual(s.bureaus, { TU: "file_returned", EX: "file_returned", EQ: "file_returned" });
});

test("done, funding with no engine figure: pa null, plain booking link — never invented", () => {
  for (const est of [null, "", "0", "-5", "abc"]) {
    const s = sloStatusFromRows({
      crs: CRS_ALL, clientTier: "PREMIUM_STACK", decision: { funding_estimate: est }
    });
    assert.equal(s.bucket, "funding");
    assert.equal(s.pa, null, `estimate ${JSON.stringify(est)}`);
    assert.equal(s.book_url, "https://apply.fundhub.ai/roadmap-book");
  }
});

test("done, repair: the two catalogue plans + Talk to us first, and no pa", () => {
  const s = sloStatusFromRows({
    crs: { ...CRS_ALL, outcome_tier: "REPAIR_ONLY" },
    clientTier: null,
    decision: { outcome_tier: "REPAIR_ONLY", funding_estimate: "5000" }
  });
  assert.equal(s.state, "done");
  assert.equal(s.bucket, "repair");
  assert.equal(s.pa, null);
  assert.deepEqual(s.repair_offer, {
    plans: [
      { key: "REPAIR_TRIAL", name: "Repair test run (two rounds, done for you)", price_cents: 20000, display: "$200" },
      { key: "REPAIR_DFY", name: "Credit repair, done-for-you", price_cents: 100000, display: "$1,000" }
    ],
    book_url: "https://apply.fundhub.ai/roadmap-book"
  });
  assert.ok(!s.repair_offer.plans.some(plan => plan.name.includes("first round")), "the $200 trial is two rounds");
});

test("bucket: clients.outcome_tier first, then crs_results.outcome_tier", () => {
  const fromClient = sloStatusFromRows({
    crs: { ...CRS_ALL, outcome_tier: "REPAIR_ONLY" }, clientTier: "FULL_FUNDING", decision: {}
  });
  assert.equal(fromClient.bucket, "funding");
  const fromCrs = sloStatusFromRows({
    crs: { ...CRS_ALL, outcome_tier: "REPAIR_ONLY" }, clientTier: null, decision: {}
  });
  assert.equal(fromCrs.bucket, "repair");
  const review = sloStatusFromRows({
    crs: { ...CRS_ALL, outcome_tier: "MANUAL_REVIEW" }, clientTier: null, decision: {}
  });
  assert.equal(review.state, "done");
  assert.equal(review.bucket, null);
  assert.equal(review.repair_offer, null);
});

test("FUNDING_PLUS_REPAIR is a funding tier, not the repair offer", () => {
  const s = sloStatusFromRows({ crs: CRS_ALL, clientTier: "FUNDING_PLUS_REPAIR", decision: {} });
  assert.equal(s.bucket, "funding");
  assert.equal(s.repair_offer, null);
});

test("failed with nothing stored: per-bureau words off the reason, booking link", () => {
  const s = sloStatusFromRows({
    request: {
      status: "failed",
      requested_at: "2026-09-22T10:00:00Z",
      state_reason: "no bureau returned a report — TU: HTTP 500 | EQ: [frozen] EQ: the file is frozen at this bureau (NoFileReturnedCreditFreeze)"
    }
  });
  assert.equal(s.state, "failed");
  assert.deepEqual(s.bureaus, { TU: "error", EX: null, EQ: "frozen" });
  assert.equal(s.book_url, "https://apply.fundhub.ai/roadmap-book");
  assert.equal(s.bucket, null);
});

test("a failed request newer than the stored result is the answer", () => {
  const s = sloStatusFromRows({
    request: { status: "failed", requested_at: "2026-09-22T11:00:00Z", state_reason: "x" },
    crs: CRS_ALL,
    decision: {}
  });
  assert.equal(s.state, "failed");
});

test("per-bureau words off a stored result", () => {
  assert.deepEqual(
    bureausFromResult({ bureaus_pulled: ["EX"], bureau_errors: { EQ: "x" }, bureau_status: { EQ: "frozen" } }),
    { TU: null, EX: "file_returned", EQ: "frozen" }
  );
  assert.deepEqual(
    bureausFromResult({ bureaus_pulled: "[\"TU\"]", bureau_errors: "{\"EX\":\"boom\"}", bureau_status: null }),
    { TU: "file_returned", EX: "error", EQ: null }
  );
  assert.deepEqual(bureausFromFailReason("CRS is not configured — missing CRS_API_HOST"), {});
  assert.deepEqual(bureausFromFailReason("no bureau returned a report — EX: [no_file] EX: none"), { EX: "no_file" });
});

test("pa rounding", () => {
  assert.equal(paFromEstimate(84500), 84500);
  assert.equal(paFromEstimate("84500.6"), 84501);
  assert.equal(paFromEstimate(0), null);
  assert.equal(paFromEstimate(undefined), null);
});

test("the answer never carries a tier name, score or email", () => {
  const s = sloStatusFromRows({
    crs: { ...CRS_ALL, outcome_tier: "REPAIR_ONLY" },
    clientTier: "REPAIR_ONLY",
    decision: { outcome_tier: "REPAIR_ONLY", funding_estimate: "1" }
  });
  const text = JSON.stringify(s);
  assert.equal(/REPAIR_ONLY|FULL_FUNDING|outcome|score|@/.test(text), false);
});

test("loadSloStatus reads only this order's pulls, and the result one of them was fulfilled with", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/FROM soft_pull_requests/.test(sql)) {
        return { rows: [{ status: "fulfilled", crs_result_id: "crs-1", requested_at: "2026-09-22T10:01:00Z" }] };
      }
      if (/FROM crs_results/.test(sql)) return { rows: [CRS_ALL] };
      if (/SELECT outcome_tier FROM clients/.test(sql)) return { rows: [{ outcome_tier: "FULL_FUNDING" }] };
      if (/FROM events/.test(sql)) return { rows: [{ outcome_tier: "FULL_FUNDING", funding_estimate: "40000" }] };
      throw new Error(`unexpected ${sql}`);
    }
  };
  const s = await loadSloStatus(db, { ...FOUND, order_is_demo: true });
  assert.equal(s.state, "done");
  assert.equal(s.pa, 40000);
  assert.equal(s.demo, true);

  const req = seen.find((q) => /FROM soft_pull_requests/.test(q.sql));
  assert.deepEqual(req.params, [ORG, CLIENT, `diagnostic-paid:slo-demo:${REF}:`, REF, ORDER]);
  assert.match(req.sql, /starts_with\(spr\.idempotency_key, \$3\)/);
  assert.match(req.sql, /e\.name = 'diagnostic\.paid'/);
  assert.match(req.sql, /e\.payload->>'ref' = \$4/);
  assert.match(req.sql, /e\.payload->>'paymentLinkId' = \$5::text/);
  const crs = seen.find((q) => /FROM crs_results/.test(q.sql));
  assert.deepEqual(crs.params, ["crs-1", ORG, CLIENT], "the result the order's own request names — not the newest on the client");
  assert.match(crs.sql, /WHERE id = \$1::uuid/);
  assert.doesNotMatch(crs.sql, /ORDER BY created_at DESC/);
  const ev = seen.find((q) => /name = 'decision\.rendered'/.test(q.sql));
  assert.deepEqual(ev.params, [ORG, decisionKeyFor("crs-1")]);
  assert.equal(decisionKeyFor("crs-1"), "crs-result:crs-1:decision.rendered:v1");
  for (const q of seen) assert.equal(/INSERT|UPDATE|DELETE/i.test(q.sql), false, "read only");
});

test("item 2: slo-status never shows a pull this order did not start (another pull on the same client)", async () => {
  /* The client has a finished pull on file — staff ran it, or an older order.
     None of its ledger keys belong to this order, so the order query returns
     nothing, and no crs_results row is even read. */
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      if (/FROM soft_pull_requests/.test(sql)) return { rows: [] };
      if (/FROM crs_results/.test(sql)) return { rows: [CRS_ALL] };
      if (/SELECT outcome_tier FROM clients/.test(sql)) return { rows: [{ outcome_tier: "FULL_FUNDING" }] };
      if (/FROM events/.test(sql)) return { rows: [{ outcome_tier: "FULL_FUNDING", funding_estimate: "99000" }] };
      throw new Error(`unexpected ${sql}`);
    }
  };
  const s = await loadSloStatus(db, { ...FOUND, order_is_demo: false });
  assert.equal(s.state, "running");
  assert.equal(s.started, false);
  assert.equal(s.bucket, null);
  assert.equal(s.pa, null);
  assert.deepEqual(s.bureaus, { TU: "pending", EX: "pending", EQ: "pending" });
  assert.equal(seen.some((sql) => /FROM crs_results/.test(sql)), false);
  assert.equal(seen.some((sql) => /decision\.rendered/.test(sql)), false);
});

test("item 3: after a retry, the NEWEST attempt is the answer", async () => {
  const requests = [
    { status: "queued", crs_result_id: null, requested_at: "2026-09-22T10:05:00Z" },
    { status: "failed", crs_result_id: null, requested_at: "2026-09-22T10:00:00Z", state_reason: "no bureau returned a report — TU: x" }
  ];
  const s = await loadSloStatus({ query: async () => ({ rows: [] }) }, FOUND, { requests });
  assert.equal(s.state, "running", "attempt 2 is running; attempt 1's failure is history");
});

test("loadOrderPullRequests needs the order's ref, or reads nothing", async () => {
  let asked = 0;
  const db = { query: async () => { asked += 1; return { rows: [] }; } };
  assert.deepEqual(await loadOrderPullRequests(db, { id: CLIENT, org_id: ORG }), []);
  assert.equal(asked, 0);
  assert.equal(sloDemoLedgerPrefix(REF), `diagnostic-paid:slo-demo:${REF}:`);
});

test("loadSloStatus: no stored result means no event read", async () => {
  const seen = [];
  const db = {
    async query(sql) {
      seen.push(sql);
      return { rows: [] };
    }
  };
  const s = await loadSloStatus(db, FOUND);
  assert.equal(s.state, "running");
  assert.equal(seen.some((sql) => /decision\.rendered/.test(sql)), false);
});
