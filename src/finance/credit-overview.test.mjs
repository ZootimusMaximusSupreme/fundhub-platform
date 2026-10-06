// src/finance/credit-overview.mjs — the credit page read. Stubbed db, no network,
// no Postgres. The rules under test: unknown is null (never 0), sandbox pulls
// never paint, sample pulls are flagged, history needs two pulls, the engine's
// sentences come back word for word, every query is scoped to org AND client.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCreditOverview, creditOverview, scorePoints, personalScores,
  inquiriesSummary, accountsSummary, usableSuggestions
} from "./credit-overview.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CID = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const CLIENT = { id: CID, first_name: "Sim", last_name: "Client", custom_fields: {} };
const AS_OF = "2026-10-06T18:00:00.000Z";

const pull = (at, scores, extra = {}) => ({
  id: "r-" + at, created_at: at,
  result: { scores, scoreModels: {}, ...extra }
});

const LINE = (o) => ({
  lender: "CHASE", kind: "revolving", credit_limit_cents: "2000000", balance_cents: "120000",
  closed_at: null, opened_on: "2019-05-28", last4: null, raw: { accountStatusType: "Open" }, ...o
});

describe("scores", () => {
  test("each bureau's newest score, with the date it was pulled", () => {
    const points = scorePoints([
      pull("2026-08-01T00:00:00Z", { ex: 700, eq: 710, tu: null }),
      pull("2026-09-30T00:00:00Z", { ex: 720, eq: null, tu: null })
    ]);
    assert.equal(points.length, 2);
    assert.equal(points[0].pulled_at, "2026-08-01T00:00:00.000Z", "oldest first");
    const p = personalScores(points);
    assert.deepEqual(p.experian, { score: 720, pulled_at: "2026-09-30T00:00:00.000Z", sample: false });
    assert.deepEqual(p.equifax, { score: 710, pulled_at: "2026-08-01T00:00:00.000Z", sample: false });
    assert.deepEqual(p.transunion, { score: null, pulled_at: null, sample: false });
  });

  test("a sandbox pull never paints; a pull with no FICO is skipped", () => {
    const points = scorePoints([
      pull("2026-09-01T00:00:00Z", { ex: 800, eq: 800, tu: 800 }, { environment: "sandbox" }),
      pull("2026-09-02T00:00:00Z", { ex: null, eq: null, tu: null }),
      pull("2026-09-03T00:00:00Z", { ex: 42, eq: null, tu: null })
    ]);
    assert.deepEqual(points, []);
  });

  test("a sample report is flagged on the score and on the page", () => {
    const d = buildCreditOverview({
      client: CLIENT, asOf: AS_OF,
      crsRows: [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 }, { environment: "simulated", simulated: true })]
    });
    assert.equal(d.sample, true);
    assert.equal(d.personal.experian.sample, true);
  });

  test("history is empty with one pull and lists every scored pull with two", () => {
    const one = buildCreditOverview({ client: CLIENT, asOf: AS_OF,
      crsRows: [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 })] });
    assert.deepEqual(one.history, []);
    const two = buildCreditOverview({ client: CLIENT, asOf: AS_OF, crsRows: [
      pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 }),
      pull("2026-08-30T00:00:00Z", { ex: 750, eq: 760, tu: 745 })
    ] });
    assert.equal(two.history.length, 2);
    assert.equal(two.history[0].experian, 750);
    assert.equal(two.history[1].experian, 771);
  });
});

describe("unknown is null, never 0", () => {
  test("a client with nothing on file: every number null, every gap named", () => {
    const d = buildCreditOverview({ client: { ...CLIENT, custom_fields: {} }, asOf: AS_OF });
    assert.equal(d.ok, true);
    assert.equal(d.has_pull, false);
    assert.equal(d.personal.experian.score, null);
    assert.equal(d.business.intelliscore, null);
    assert.equal(d.utilization.percent, null);
    assert.equal(d.accounts.open, null, "no accounts anywhere is unknown, not 0 open");
    assert.equal(d.inquiries.total, null);
    assert.equal(d.negative_items.count, null);
    assert.equal(d.late_payments.count, null);
    assert.deepEqual(d.suggestions, []);
    for (const k of ["credit_pull", "experian_score", "business_score", "utilization",
      "open_accounts", "inquiries", "negative_items", "late_payments"]) {
      assert.ok(d.missing.includes(k), k + " should be named as missing");
    }
  });

  test("a measured zero stays zero", () => {
    const d = buildCreditOverview({
      client: { ...CLIENT, custom_fields: { crs_negative_items_count: 0, crs_late_payments_count: "0",
        crs_inquiries_ex: 0, crs_inquiries_eq: 0, crs_inquiries_tu: 0 } },
      asOf: AS_OF
    });
    assert.equal(d.negative_items.count, 0);
    assert.equal(d.late_payments.count, 0);
    assert.equal(d.inquiries.total, 0);
    assert.ok(!d.missing.includes("negative_items"));
  });
});

describe("inquiries", () => {
  test("custom fields first; one unknown bureau leaves the total unknown", () => {
    const s = inquiriesSummary({ crs_inquiries_ex: 2, crs_inquiries_eq: 1 }, []);
    assert.deepEqual(s.by_bureau, { experian: 2, equifax: 1, transunion: null });
    assert.equal(s.total, null);
    assert.equal(s.source, "custom_fields");
  });

  test("no custom fields: the newest scored pull's own inquiry list is counted", () => {
    const s = inquiriesSummary({}, [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 }, {
      bureausPulled: ["TU", "EX", "EQ"],
      inquiries: [{ source: "EX" }, { source: "EX" }, { source: "TU" }]
    })]);
    assert.deepEqual(s.by_bureau, { experian: 2, equifax: 0, transunion: 1 });
    assert.equal(s.total, 3);
    assert.equal(s.source, "credit_report");
  });

  test("a pull with no inquiry list is not 'none'", () => {
    const s = inquiriesSummary({}, [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 })]);
    assert.equal(s.total, null);
    assert.equal(s.source, null);
  });
});

describe("accounts and utilization", () => {
  test("closed lines are not open; installment counted apart", () => {
    const a = accountsSummary([
      LINE({}),
      LINE({ lender: "AMEX", closed_at: "2025-01-01" }),
      LINE({ lender: "OLD", raw: { accountStatusType: "Closed" } }),
      LINE({ lender: "TOYOTA", kind: "installment" })
    ], "tradelines");
    assert.equal(a.open, 2);
    assert.equal(a.revolving, 1);
    assert.equal(a.installment, 1);
    assert.equal(a.list[0].limit_cents, 2000000, "bigint string → integer cents");
  });

  test("utilization from the accounts, as a percent with a band", () => {
    const d = buildCreditOverview({ client: CLIENT, asOf: AS_OF, tradelineRows: [LINE({})] });
    assert.equal(d.utilization.percent, 6);
    assert.equal(d.utilization.band, "excellent");
    assert.equal(d.utilization.source, "accounts");
  });
});

describe("UnderwriteIQ sentences", () => {
  test("filtered like pickTip, never rewritten", () => {
    const out = usableSuggestions([
      { text: "Exact engine words.", topic: "inquiries", recognised: true, restsOnMissingData: false },
      { text: "Rests on a blank.", topic: "utilization", recognised: true, restsOnMissingData: true },
      { text: "Unknown line.", topic: null, recognised: false },
      { text: "You're close.", topic: "fallback", recognised: true, restsOnMissingData: false }
    ]);
    assert.deepEqual(out, [{ text: "Exact engine words.", topic: "inquiries" }]);
  });

  test("a full file gets at least one engine sentence back", () => {
    const d = buildCreditOverview({
      client: { ...CLIENT, custom_fields: { crs_inquiries_ex: 2, crs_inquiries_eq: 1, crs_inquiries_tu: 1,
        crs_negative_items_count: 0, crs_late_payments_count: 0 } },
      asOf: AS_OF,
      crsRows: [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 })],
      tradelineRows: [LINE({}), LINE({ lender: "AMEX", credit_limit_cents: "1500000", balance_cents: "85000" })]
    });
    assert.ok(Array.isArray(d.suggestions));
    for (const s of d.suggestions) assert.equal(typeof s.text, "string");
  });
});

describe("creditOverview — the reads", () => {
  test("null when the client is not in the org; every query scoped to org AND client", async () => {
    const seen = [];
    const db = { query: async (sql, params) => { seen.push({ sql, params }); return { rows: [] }; } };
    assert.equal(await creditOverview(db, { orgId: ORG, clientId: CID }), null);
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0].params, [CID, ORG]);
  });

  test("reads five tables, each with client_id and org_id, demo rows left out", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push({ sql, params });
        if (/FROM clients/.test(sql)) return { rows: [CLIENT] };
        if (/FROM crs_results/.test(sql)) return { rows: [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 })] };
        return { rows: [] };
      }
    };
    const d = await creditOverview(db, { orgId: ORG, clientId: CID, asOf: new Date(AS_OF) });
    assert.equal(d.personal.experian.score, 771);
    assert.equal(d.client.name, "Sim Client");
    assert.equal(seen.length, 5);
    for (const q of seen) {
      assert.match(q.sql, /client_id = \$1 AND org_id = \$2|id = \$1 AND org_id = \$2/);
      assert.deepEqual(q.params, [CID, ORG]);
    }
    assert.match(seen.find((q) => /crs_results/.test(q.sql)).sql, /is_demo IS NOT TRUE/);
    assert.match(seen.find((q) => /FROM tradelines/.test(q.sql)).sql, /is_demo IS NOT TRUE/);
    for (const q of seen) assert.doesNotMatch(q.sql, /\b(INSERT|UPDATE|DELETE)\b/i, "read only");
  });
});
