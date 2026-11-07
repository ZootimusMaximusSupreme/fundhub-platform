// The monthly report (src/finance/monthly-report.mjs): the month it covers,
// the numbers it picks out of FinanceOS's own reads, and the PDF it draws.
// Fictional numbers only. No database: the four reads are stubbed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PDFDocument } from "pdf-lib";

import {
  readReportMonth, monthWindow, monthMinus, lastDayOfMonth, buildMonthlyReport, monthlyReport,
  renderMonthlyReportPdf, reportFileName, valueWords, changeWords, changeIsGood, heroOf, usd, pdfText,
  NEXT_STEPS_MAX
} from "./monthly-report.mjs";
import { WORDMARK } from "./fundhub-wordmark.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASOF = new Date("2026-11-07T15:00:00Z");

/* October 2026, a sample file: two pulls (Sep 6 and Oct 6), a month of days. */
const OCT = Array.from({ length: 31 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
const ramp = (a, b) => OCT.map((_, i) => Math.round(a + ((b - a) * i) / 30));
function trends() {
  const personal = ramp(939495, 600000);
  personal[3] = null; // a day with no save is a gap, never $0
  return {
    client: { name: "Alex Sample" },
    daily: {
      days: OCT,
      cash: {
        personal: { cents: personal, floor: OCT.map(() => false) },
        business: { cents: ramp(125000, 180000), floor: OCT.map((_, i) => i === 30) }
      },
      debt: { total: { cents: ramp(1225000, 965000) } },
      cards_used_pct: ramp(25, 5)
    },
    monthly: {
      months: ["2026-10"], has_transactions: true,
      personal: { in_cents: [750000], out_cents: [612340] },
      business: { in_cents: [410000], out_cents: [null] }
    }
  };
}
const credit = (pulls = ["2026-09-06T12:00:00Z", "2026-10-06T12:00:00Z"]) => ({
  credit_history: {
    personal: {
      pulls: pulls.map((p) => ({ pulled_at: p })),
      series: [
        { bureau: "experian", points: pulls.map((p, i) => ({ pulled_at: p, score: [662, 712][i] })) },
        { bureau: "equifax", points: pulls.map((p, i) => ({ pulled_at: p, score: [668, null][i] })) },
        { bureau: "transunion", points: pulls.map((p, i) => ({ pulled_at: p, score: [665, 715][i] })) }
      ]
    }
  }
});
const FUND = {
  now: { score: 4, score_max: 6, tier: "not_fundable" },
  opportunity: { personal: { currentCents: 9360000, projectedCents: 10400000 }, source: { asOf: "2026-10-06T12:00:00Z" } }
};
const TASKS = { tasks: Array.from({ length: 7 }, (_, i) => ({ title: `Step ${i + 1}`, due_on: i ? `2026-11-${10 + i}` : null, late_days: i === 2 ? 3 : null })) };
const build = (over = {}) => buildMonthlyReport({ month: "2026-10", asOf: ASOF, client: { name: "Alex Sample" }, trends: trends(), credit: credit(), fund: FUND, tasks: TASKS, ...over });
const row = (r, key) => r.changed.find((x) => x.key === key);

describe("the month a report covers", () => {
  test("empty is this month; any YYYY-MM in the last 24 months; never the future", () => {
    assert.deepEqual(readReportMonth(undefined, ASOF), { ok: true, month: "2026-11" });
    assert.deepEqual(readReportMonth("", ASOF), { ok: true, month: "2026-11" });
    assert.deepEqual(readReportMonth("2026-10", ASOF), { ok: true, month: "2026-10" });
    assert.deepEqual(readReportMonth(monthMinus("2026-11", 23), ASOF), { ok: true, month: "2024-12" });
    for (const bad of ["2026-12", "2024-11", "2026-13", "2026-1", "Oct 2026", "2026-10-01"]) {
      assert.equal(readReportMonth(bad, ASOF).ok, false, bad);
    }
  });

  test("a past month runs to its last day; this month stops today", () => {
    assert.deepEqual(monthWindow("2026-10", ASOF), { from: "2026-10-01", to: "2026-10-31", last: "2026-10-31", partial: false });
    assert.deepEqual(monthWindow("2026-11", ASOF), { from: "2026-11-01", to: "2026-11-07", last: "2026-11-30", partial: true });
    assert.equal(lastDayOfMonth("2028-02"), "2028-02-29");
    assert.equal(monthMinus("2026-01", 1), "2025-12");
  });
});

describe("what changed — read off FinanceOS's own reads, nothing made up", () => {
  test("each bureau: the score before the month and the newest score in it", () => {
    const r = build();
    assert.deepEqual([row(r, "score_experian").start, row(r, "score_experian").end], [662, 712]);
    assert.deepEqual([row(r, "score_transunion").start, row(r, "score_transunion").end], [665, 715]);
    const eq = row(r, "score_equifax");
    assert.deepEqual([eq.start, eq.end], [668, 668], "Equifax had no score on the Oct pull: its newest is still Sep's");
    assert.equal(row(r, "score_experian").note, null);
  });

  test("a month with no pull says so; a file with no pull says so — never a guessed score", () => {
    const none = build({ month: "2026-11" });
    assert.equal(row(none, "score_experian").note, "No new pull this month");
    assert.equal(row(none, "score_experian").end, 712);
    const empty = build({ credit: { credit_history: { personal: { pulls: [], series: [] } } } });
    assert.deepEqual(empty.changed.filter((x) => x.kind === "score"), []);
    assert.equal(row(empty, "score_none").note, "No credit pull yet");
  });

  test("cash: personal and business are their own rows and are never added", () => {
    const r = build();
    assert.deepEqual([row(r, "cash_personal").start, row(r, "cash_personal").end], [939495, 600000]);
    assert.deepEqual([row(r, "cash_business").start, row(r, "cash_business").end], [125000, 180000]);
    assert.equal(row(r, "cash_business").endFloor, true, "a total with holes says 'at least'");
    assert.equal(r.changed.some((x) => /^cash$|cash_total|total_cash/.test(x.key)), false, "no combined cash row");
    assert.equal(valueWords("money", 180000, true), "at least $1,800.00");
  });

  test("a day with no save is skipped, never read as $0", () => {
    const t = trends();
    t.daily.cash.personal.cents[0] = null;
    const r = build({ trends: t });
    assert.equal(row(r, "cash_personal").start, t.daily.cash.personal.cents[1], "the first SAVED day");
    assert.notEqual(row(r, "cash_personal").start, 0);
  });

  test("debt and cards used come from the same daily lines; money in and out per kind", () => {
    const r = build();
    assert.deepEqual([row(r, "debt").start, row(r, "debt").end], [1225000, 965000]);
    assert.deepEqual([row(r, "cards_used").start, row(r, "cards_used").end], [25, 5]);
    assert.deepEqual(r.flows.map((f) => [f.key, f.value]), [["personal_in", 750000], ["personal_out", 612340], ["business_in", 410000]],
      "business money out is unknown, so it is left out — not $0");
  });

  test("no bank yet: no money rows, and the report says how to fill them", () => {
    const r = build({ trends: null });
    assert.equal(r.changed.some((x) => x.kind === "money" || x.kind === "pct"), false);
    assert.deepEqual(r.notes, ["Connect a bank to track cash and debt here."]);
    assert.deepEqual(r.flows, []);
  });

  test("the hero is UnderwriteIQ's own figure and fundability count", () => {
    const h = heroOf(FUND);
    assert.deepEqual(h, { funding_cents: 9360000, projected_cents: 10400000, as_of: "2026-10-06", fundability: { score: 4, max: 6, tier: "not_fundable_yet" } });
    assert.deepEqual(heroOf(null), { funding_cents: null, projected_cents: null, as_of: null, fundability: null });
    assert.equal(heroOf({ now: { score: null, score_max: 6 } }).fundability, null, "no pull: nothing is counted");
  });

  test("next steps: the Next steps tab's list, the first five", () => {
    const r = build();
    assert.equal(r.next.length, NEXT_STEPS_MAX);
    assert.deepEqual(r.next[0], { title: "Step 1", due_on: null, late_days: null });
    assert.deepEqual(r.next[2], { title: "Step 3", due_on: "2026-11-12", late_days: 3 });
  });

  test("words for numbers", () => {
    assert.equal(usd(9360000, { whole: true }), "$93,600");
    assert.equal(usd(123456), "$1,234.56");
    assert.equal(usd(null), "—");
    assert.equal(valueWords("score", 712), "712");
    assert.equal(valueWords("pct", 12.34), "12.3%");
    assert.equal(changeWords({ kind: "score", start: 662, end: 712 }), "+50");
    assert.equal(changeWords({ kind: "money", start: 939495, end: 600000 }), "-$3,394.95");
    assert.equal(changeWords({ kind: "pct", start: 25, end: 5 }), "-20 pts");
    assert.equal(changeWords({ kind: "money", start: null, end: 5 }), "");
    assert.equal(changeIsGood({ better: "down", start: 25, end: 5 }), true);
    assert.equal(changeIsGood({ better: "up", start: 712, end: 700 }), false);
    assert.equal(changeIsGood({ better: null, start: 1, end: 2 }), null, "cash has no good way");
    assert.equal(reportFileName("2026-10"), "fundhub-report-2026-10.pdf");
  });
});

describe("the read: four FinanceOS reads, scoped to one client", () => {
  const db = (found = true) => ({ async query(sql, params) {
    assert.match(sql, /FROM clients WHERE id = \$1 AND org_id = \$2/);
    assert.deepEqual(params, ["client-1", "org-1"]);
    return { rows: found ? [{ id: "client-1", first_name: "Alex", last_name: "Sample" }] : [] };
  } });
  const reads = (over = {}) => {
    const seen = {};
    const stub = (name, value) => async (_db, args) => { seen[name] = args; if (value instanceof Error) throw value; return value; };
    return {
      seen,
      reads: {
        moneyTrends: stub("moneyTrends", trends()),
        creditOverview: stub("creditOverview", credit()),
        fundability: stub("fundability", FUND),
        moneyTasks: stub("moneyTasks", TASKS),
        isDbDown: (e) => !!(e && e.code === "08006"),
        ...over
      }
    };
  };

  test("each read gets the same org and client; trends gets the month's days", async () => {
    const r = reads();
    const out = await monthlyReport(db(), { orgId: "org-1", clientId: "client-1", month: "2026-10", asOf: ASOF, reads: r.reads });
    for (const k of ["moneyTrends", "creditOverview", "fundability", "moneyTasks"]) {
      assert.equal(r.seen[k].orgId, "org-1", k);
      assert.equal(r.seen[k].clientId, "client-1", k);
    }
    assert.deepEqual([r.seen.moneyTrends.from, r.seen.moneyTrends.to], ["2026-10-01", "2026-10-31"]);
    assert.equal(out.client.name, "Alex Sample");
    assert.deepEqual(out.failed, []);
  });

  test("not this org's client is null (the endpoint answers 404)", async () => {
    assert.equal(await monthlyReport(db(false), { orgId: "org-1", clientId: "client-1", month: "2026-10", asOf: ASOF, reads: reads().reads }), null);
  });

  test("one read failing names its part instead of a silent gap; a database outage still throws", async () => {
    const r = reads({ creditOverview: async () => { throw new Error("bad pull json"); } });
    const out = await monthlyReport(db(), { orgId: "org-1", clientId: "client-1", month: "2026-10", asOf: ASOF, reads: r.reads });
    assert.deepEqual(out.failed, ["credit"]);
    assert.ok(out.notes.includes("Credit scores could not be read today."));
    const down = Object.assign(new Error("connection lost"), { code: "08006" });
    await assert.rejects(
      monthlyReport(db(), { orgId: "org-1", clientId: "client-1", month: "2026-10", asOf: ASOF, reads: reads({ fundability: async () => { throw down; } }).reads }),
      /connection lost/);
  });
});

describe("the PDF", () => {
  test("two pages — the designed cover and the details — with a title", async () => {
    const bytes = await renderMonthlyReportPdf(build());
    assert.equal(Buffer.from(bytes.slice(0, 5)).toString(), "%PDF-");
    const doc = await PDFDocument.load(bytes);
    assert.equal(doc.getPageCount(), 2);
    assert.equal(doc.getTitle(), "Fundhub monthly report · October 2026");
    assert.deepEqual(doc.getPage(0).getSize(), { width: 612, height: 792 });
  });

  test("draws an empty file and a name Helvetica cannot write without throwing", async () => {
    const r = buildMonthlyReport({ month: "2026-11", asOf: ASOF, client: { name: "Zoë 🚀 Ng" }, trends: null, credit: null, fund: null, tasks: null });
    const doc = await PDFDocument.load(await renderMonthlyReportPdf(r));
    assert.equal(doc.getPageCount(), 2);
    assert.equal(pdfText("Zoë 🚀 Ng → done"), "Zoë  Ng to done");
  });

  test("the cover's logo is the real wordmark from public/assets, path for path", () => {
    const svg = fs.readFileSync(path.resolve(HERE, "../../public/assets/fundhub-wordmark.svg"), "utf8");
    const paths = [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual([...WORDMARK.paths], paths);
    const vb = /viewBox="([^"]+)"/.exec(svg)[1].split(/\s+/).map(Number);
    assert.deepEqual([WORDMARK.width, WORDMARK.height], [vb[2], vb[3]]);
    assert.match(svg, new RegExp(`translate\\(${WORDMARK.transform.tx}\\.0+,${WORDMARK.transform.ty}\\) scale\\(0\\.1(0+)?,-0\\.1(0+)?\\)`));
  });
});
