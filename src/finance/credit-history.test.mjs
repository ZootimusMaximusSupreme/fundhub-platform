// src/finance/credit-history.mjs — credit score over time (spec item 4,
// ops/workflows/finance-os-cfo-build-2026-11-06.txt). Stubbed rows, no network,
// no Postgres. The rules under test: one line per bureau from every saved pull,
// one line per score a saved business report carries, under the report's own
// field names; a month with no pull and a pull without that score are gaps,
// never made-up points; a business with no report has no lines; every read is
// scoped to one org AND one client.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildCreditHistory, personalHistory, businessHistory, withGaps, monthIndex,
  reportScores, usageAtPull, scorePoints as historyScorePoints
} from "./credit-history.mjs";
import { creditOverview, buildCreditOverview, scorePoints, personalScores } from "./credit-overview.mjs";
import { businessScoreFromPulls } from "../http/client-detail.mjs";

const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CID = "029964c5-4d8e-47ed-88c9-53ac13863fd4";
const CLIENT = { id: CID, first_name: "Sim", last_name: "Client", custom_fields: {} };

const pull = (at, scores, extra = {}) => ({
  id: "r-" + at, created_at: at,
  result: { scores, scoreModels: {}, ...extra }
});
const at = (p) => p.points.map((x) => [x.pulled_at.slice(0, 10), x.score, x.gap_before]);
const line = (series, key) => series.find((s) => s.bureau === key || s.field === key);

/* The shape deriveBusinessSignals() reads: report.data.scoreInformation. */
const bizReport = (info) => ({ data: { scoreInformation: info } });
const COMPANY = {
  id: "b1", name: "Fundhub LLC", entity_data: { state: "AZ" },
  created_at: "2026-01-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z"
};
const SECOND = {
  id: "b2", name: "Second Co", entity_data: { state: "NV" },
  created_at: "2026-05-01T00:00:00Z", updated_at: "2026-05-01T00:00:00Z"
};

describe("the gap rule", () => {
  test("month to month joins; a skipped month, a pull without the score, or no date breaks", () => {
    assert.equal(monthIndex("2026-09-30T04:30:03Z") - monthIndex("2026-08-01T00:00:00Z"), 1);
    const pts = withGaps(
      ["2026-01-15T00:00:00Z", "2026-02-10T00:00:00Z", "2026-02-25T00:00:00Z", "2026-04-02T00:00:00Z",
        "2026-04-20T00:00:00Z", "2026-05-01T00:00:00Z", null],
      [700, 705, 706, 710, null, 720, 730]
    );
    assert.deepEqual(pts.map((p) => p.gap_before), [false, false, false, true, true, true]);
    // Jan → Feb: next month. Feb → Feb: same month. Feb → Apr: March had no pull.
    // Apr 2 → May 1: next month, but the Apr 20 pull did not carry this score.
    // May → (no date): unknown.
    assert.deepEqual(pts.map((p) => p.value), [700, 705, 706, 710, 720, 730]);
  });

  test("a value that is null is no point at all, never a 0", () => {
    const pts = withGaps(["2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z"], [null, null]);
    assert.deepEqual(pts, []);
  });
});

describe("personal: one line per bureau from every saved pull", () => {
  test("several monthly pulls make three joined lines, oldest first, and the newest point is the tile", () => {
    const rows = [
      pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 }),
      pull("2026-07-31T00:00:00Z", { ex: 740, eq: 752, tu: 749 }),
      pull("2026-08-31T00:00:00Z", { ex: 760, eq: 770, tu: 770 })
    ];
    const h = personalHistory(rows);
    assert.equal(h.pulls.length, 3);
    assert.deepEqual(at(line(h.series, "experian")),
      [["2026-07-31", 740, false], ["2026-08-31", 760, false], ["2026-09-30", 771, false]]);
    assert.deepEqual(at(line(h.series, "transunion")).map((p) => p[1]), [749, 770, 766]);
    const tiles = personalScores(scorePoints(rows));
    for (const b of ["experian", "equifax", "transunion"]) {
      const pts = line(h.series, b).points;
      assert.equal(pts[pts.length - 1].score, tiles[b].score, b + ": the line ends on the tile's number");
    }
  });

  test("a bureau missing on one pull is a gap in that line only; the others stay joined", () => {
    /* All three pulls sit in neighbouring months, so only the missing score
       can break the line. */
    const h = personalHistory([
      pull("2026-08-01T00:00:00Z", { ex: 740, eq: 752, tu: 749 }),
      pull("2026-08-20T00:00:00Z", { ex: 760, eq: null, tu: 770 }),
      pull("2026-09-10T00:00:00Z", { ex: 771, eq: 778, tu: 766 })
    ]);
    assert.deepEqual(at(line(h.series, "equifax")),
      [["2026-08-01", 752, false], ["2026-09-10", 778, true]], "never bridged across the pull that lacked it");
    assert.ok(line(h.series, "experian").points.every((p) => p.gap_before === false));
    assert.equal(line(h.series, "equifax").points.length, 2, "no made-up August 20 point");
  });

  test("a month with no pull breaks every line; a sandbox or no-score pull is not a pull", () => {
    const h = personalHistory([
      pull("2026-05-31T00:00:00Z", { ex: 700, eq: 710, tu: 705 }),
      pull("2026-06-15T00:00:00Z", { ex: 800, eq: 800, tu: 800 }, { environment: "sandbox" }),
      pull("2026-06-30T00:00:00Z", { ex: 710, eq: 715, tu: 712 }),
      pull("2026-07-10T00:00:00Z", { ex: null, eq: null, tu: null }),
      pull("2026-09-30T00:00:00Z", { ex: 730, eq: 735, tu: 731 })
    ]);
    assert.equal(h.pulls.length, 3, "the sandbox file and the empty pull are not points");
    assert.deepEqual(at(line(h.series, "experian")),
      [["2026-05-31", 700, false], ["2026-06-30", 710, false], ["2026-09-30", 730, true]]);
  });

  test("a sample pull is flagged on its points", () => {
    const h = personalHistory([pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 },
      { environment: "simulated", simulated: true })]);
    assert.equal(line(h.series, "experian").points[0].sample, true);
    assert.equal(h.pulls[0].sample, true);
  });

  test("no pulls: three empty lines, no points", () => {
    const h = personalHistory([]);
    assert.deepEqual(h.pulls, []);
    assert.deepEqual(h.series.map((s) => [s.bureau, s.points.length]),
      [["experian", 0], ["equifax", 0], ["transunion", 0]]);
    assert.deepEqual(h.usage, []);
  });

  test("scorePoints moved, not copied: the credit read and trends read the same function", () => {
    assert.equal(scorePoints, historyScorePoints);
  });
});

describe("cards used at each pull", () => {
  const card = (limit, balance) => ({ creditorName: "CHASE", accountType: "Revolving", creditLimit: limit, currentBalance: balance });

  test("from the pull's own accounts, then the stored percent; neither is no point, never 0", () => {
    assert.deepEqual(usageAtPull(pull("2026-09-30T00:00:00Z", { ex: 771 }, { tradelines: [card(10000, 2500)] })),
      { percent: 25, partial: false, source: "report_accounts" });
    assert.deepEqual(usageAtPull(pull("2026-09-30T00:00:00Z", { ex: 771 }, { utilization: 6.1 })),
      { percent: 6.1, partial: false, source: "credit_report" });
    assert.equal(usageAtPull(pull("2026-09-30T00:00:00Z", { ex: 771 })), null);
  });

  test("one point per pull that has it, with the same gap rule", () => {
    const h = personalHistory([
      pull("2026-08-01T00:00:00Z", { ex: 740 }, { tradelines: [card(10000, 5000)] }),
      pull("2026-08-20T00:00:00Z", { ex: 760 }),
      pull("2026-09-10T00:00:00Z", { ex: 771 }, { tradelines: [card(10000, 1000)] })
    ]);
    assert.deepEqual(h.usage.map((u) => [u.pulled_at.slice(0, 10), u.percent, u.gap_before]),
      [["2026-08-01", 50, false], ["2026-09-10", 10, true]]);
  });
});

describe("businesses: one set of lines per saved business", () => {
  const withBiz = (when, reports, extra = {}) =>
    pull(when, { ex: 771, eq: 778, tu: 766 }, { businessReports: reports, ...extra });

  test("a business with no saved report is listed with no lines", () => {
    const [b] = businessHistory([pull("2026-09-30T00:00:00Z", { ex: 771 })], [COMPANY]);
    assert.equal(b.name, "Fundhub LLC");
    assert.equal(b.has_report, false);
    assert.deepEqual(b.series, []);
    assert.deepEqual(b.reports, []);
  });

  test("one line per score the report carries, under the report's own field names", () => {
    const rows = [
      withBiz("2026-07-31T00:00:00Z", [{ name: "Fundhub LLC", state: "AZ",
        report: bizReport({ commercialScore: { score: 61 }, fsrScore: { score: 40 }, commercialScoreFactors: [{ code: "1" }] }) }]),
      withBiz("2026-08-31T00:00:00Z", [{ name: "Fundhub LLC", state: "AZ",
        report: bizReport({ commercialScore: { score: 68 }, fsrScore: { score: 720 } }) }]),
      withBiz("2026-09-30T00:00:00Z", [{ name: "Fundhub LLC", state: "AZ",
        report: bizReport({ commercialScore: { score: 76 }, fsrScore: { score: 58 } }) }])
    ];
    const [b] = businessHistory(rows, [COMPANY]);
    assert.equal(b.has_report, true);
    assert.deepEqual(b.series.map((s) => s.field), ["commercialScore", "fsrScore"], "factors are not a score");
    assert.deepEqual(at(line(b.series, "commercialScore")),
      [["2026-07-31", 61, false], ["2026-08-31", 68, false], ["2026-09-30", 76, false]]);
    assert.deepEqual(at(line(b.series, "fsrScore")),
      [["2026-07-31", 40, false], ["2026-09-30", 58, true]], "an off-scale FSR is a gap, not a point");
    const tab = businessScoreFromPulls(rows, COMPANY);
    assert.equal(line(b.series, "commercialScore").points.at(-1).score, tab.intelliscore,
      "the line ends on the Credit tab's business score");
    assert.equal(line(b.series, "fsrScore").points.at(-1).score, tab.fsr);
  });

  test("another company's report, a wrong state, or a sandbox pull never makes a point", () => {
    const rows = [
      withBiz("2026-07-31T00:00:00Z", [{ name: "Other Co", state: "AZ", report: bizReport({ commercialScore: { score: 90 } }) }]),
      withBiz("2026-08-31T00:00:00Z", [{ name: "Fundhub LLC", state: "TX", report: bizReport({ commercialScore: { score: 90 } }) }]),
      withBiz("2026-09-30T00:00:00Z", [{ name: "Fundhub LLC", state: "AZ", report: bizReport({ commercialScore: { score: 90 } }) }],
        { environment: "sandbox" })
    ];
    const [b] = businessHistory(rows, [COMPANY]);
    assert.equal(b.has_report, false);
    assert.deepEqual(b.series, []);
  });

  test("a pull between two reports that did not carry one breaks the line", () => {
    const rows = [
      withBiz("2026-08-01T00:00:00Z", [{ name: "Fundhub LLC", state: "AZ", report: bizReport({ commercialScore: { score: 61 } }) }]),
      withBiz("2026-08-20T00:00:00Z", []),
      withBiz("2026-09-10T00:00:00Z", [{ name: "fundhub  llc", state: "az", report: bizReport({ commercialScore: { score: 70 } }) }])
    ];
    const [b] = businessHistory(rows, [COMPANY]);
    assert.deepEqual(at(line(b.series, "commercialScore")), [["2026-08-01", 61, false], ["2026-09-10", 70, true]]);
    assert.equal(b.reports.length, 2);
  });

  test("two businesses, oldest company first, each with only its own lines", () => {
    const rows = [
      withBiz("2026-08-31T00:00:00Z", [
        { name: "Second Co", state: "NV", report: bizReport({ commercialScore: { score: 33 } }) },
        { name: "Fundhub LLC", state: "AZ", report: bizReport({ commercialScore: { score: 70 } }) }
      ]),
      withBiz("2026-09-30T00:00:00Z", [
        { name: "Second Co", state: "NV", report: bizReport({ commercialScore: { score: 41 } }) },
        { name: "Fundhub LLC", state: "AZ", report: bizReport({ commercialScore: { score: 72 } }) }
      ], { environment: "simulated", simulated: true })
    ];
    const out = businessHistory(rows, [SECOND, COMPANY]);
    assert.deepEqual(out.map((b) => [b.id, b.name, b.state]), [["b1", "Fundhub LLC", "AZ"], ["b2", "Second Co", "NV"]]);
    assert.deepEqual(at(line(out[0].series, "commercialScore")).map((p) => p[1]), [70, 72]);
    assert.deepEqual(at(line(out[1].series, "commercialScore")).map((p) => p[1]), [33, 41]);
    assert.equal(line(out[1].series, "commercialScore").points[1].sample, true, "a sample report says so");
  });

  test("reportScores reads only 1-100 scores off scoreInformation", () => {
    assert.deepEqual(reportScores(bizReport({ commercialScore: { score: "64" }, fsrScore: { score: null } })),
      { commercialScore: 64 });
    assert.deepEqual(reportScores({}), {});
    assert.deepEqual(reportScores(null), {});
  });
});

describe("the credit read carries it", () => {
  test("credit_history rides on the credit read, built from the rows it already has", () => {
    const d = buildCreditOverview({
      client: CLIENT, asOf: "2026-10-06T18:00:00.000Z", businesses: [COMPANY],
      crsRows: [
        pull("2026-08-31T00:00:00Z", { ex: 760, eq: 770, tu: 770 }),
        pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 })
      ]
    });
    assert.deepEqual(line(d.credit_history.personal.series, "experian").points.map((p) => p.score), [760, 771]);
    assert.equal(d.credit_history.businesses.length, 1);
    assert.equal(d.credit_history.businesses[0].has_report, false);
    assert.equal(d.history.length, 2, "the older history field is unchanged");
    assert.deepEqual(buildCreditHistory(), { personal: personalHistory([]), businesses: [] });
  });

  test("scoped: every query carries client_id AND org_id; another org's client reads nothing", async () => {
    const seen = [];
    const db = {
      query: async (sql, params) => {
        seen.push({ sql, params });
        const mine = params[0] === CID && params[1] === ORG;
        if (/FROM clients/.test(sql)) return { rows: mine ? [CLIENT] : [] };
        if (/FROM crs_results/.test(sql)) return { rows: mine ? [pull("2026-09-30T00:00:00Z", { ex: 771, eq: 778, tu: 766 },
          { businessReports: [{ name: "Fundhub LLC", state: "AZ", report: bizReport({ commercialScore: { score: 76 } }) }] })] : [] };
        if (/FROM businesses/.test(sql)) return { rows: mine ? [COMPANY] : [] };
        return { rows: [] };
      }
    };
    const d = await creditOverview(db, { orgId: ORG, clientId: CID });
    for (const q of seen) {
      assert.match(q.sql, /client_id = \$1 AND org_id = \$2|id = \$1 AND org_id = \$2/);
      assert.deepEqual(q.params, [CID, ORG]);
    }
    assert.match(seen.find((q) => /FROM businesses/.test(q.sql)).sql, /SELECT id, name/);
    const [b] = d.credit_history.businesses;
    assert.deepEqual([b.id, b.has_report, b.series[0].points[0].score], ["b1", true, 76]);

    seen.length = 0;
    assert.equal(await creditOverview(db, { orgId: "00000000-0000-4000-8000-000000000000", clientId: CID }), null);
    assert.equal(seen.length, 1, "a client outside the org stops at the first read: no pulls, no businesses");
  });
});
