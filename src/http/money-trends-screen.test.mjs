// FinanceOS Trends line graphs (wave 4, H6) — public/app/money-trends.js.
// Runs the page's own render functions in Node against the server's own
// builder output (src/finance/money-trends.mjs buildTrends), so the screen and
// the read are checked against one contract. No browser, no database.
//
// The hard rules: no summed cash line, ever; a gap is a break in the line and
// never a point at 0; estimated points are dashed and said in words; every
// chart has a title, a description, a word legend and a table.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { buildTrends } from "../finance/money-trends.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-trends.js"), "utf8");
const MONEY_JS = fs.readFileSync(path.join(APP, "money.js"), "utf8");
const HOST_JS = fs.readFileSync(path.join(APP, "financeos.js"), "utf8");
const CREDIT_JS = fs.readFileSync(path.join(APP, "money-credit.js"), "utf8");
const HTML = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");

function load(src, key) {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window[key];
}
const T = load(JS, "FHTrends");
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const figure = (html, key) => {
  const m = html.match(new RegExp('<figure class="card tchart" data-chart="' + key + '">[\\s\\S]*?</figure>'));
  assert.ok(m, "no " + key + " chart");
  return m[0];
};

const ASOF = "2026-10-06T15:00:00Z";
/* Ten days of history with a hole on Oct 1-2, the first three days estimated. */
function rollups() {
  const out = [];
  const days = ["2026-09-26", "2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"];
  days.forEach((day, i) => out.push({
    day,
    cash_personal_cents: String(400000 + i * 1000), cash_personal_floor: false,
    cash_business_cents: String(1800000 + i * 5000), cash_business_floor: false,
    cash_unknown_cents: null, cash_unknown_floor: false,
    debt_total_cents: i < 3 ? null : String(5472040 - i * 100), debt_total_floor: false,
    debt_personal_cents: i < 3 ? null : "132040", debt_business_cents: i < 3 ? null : String(5340000 - i * 100),
    debt_unknown_cents: null, cards_used_pct: i < 3 ? null : "20.4",
    source: i < 3 ? "backfill" : "snapshot", estimated: i < 3
  }));
  return out;
}
const DATA = buildTrends({
  client: { id: "c1", first_name: "Sample", last_name: "Client" },
  asOf: ASOF, range: "30d", rollups: rollups(),
  accounts: [{ id: "a1", account_type: "depository", kind: "personal" }, { id: "a2", account_type: "depository", kind: "business" }],
  txMonths: [
    { bank_account_id: "a1", month: "2026-10", in_cents: "300000", out_cents: "120000" },
    { bank_account_id: "a2", month: "2026-09", in_cents: "900000", out_cents: "400000" }
  ]
});

test("cash is two lines, personal and business — never a summed line", () => {
  const html = T.renderTrends(DATA, "30d");
  const cash = figure(html, "cash");
  const classes = [...cash.matchAll(/<polyline class="tline (s\d)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(classes)].sort(), ["s1", "s2"], "exactly the personal and business series");
  assert.match(text(cash), /Personal \$4,080\.00/);
  assert.match(text(cash), /Business \$18,400\.00/);
  // 4,080.00 + 18,400.00 = 22,480.00 must not appear anywhere on the Trends area.
  assert.doesNotMatch(text(html), /22,480/, "personal + business cash was added into one number");
  assert.doesNotMatch(text(html), /total cash|all cash/i);
  // And no line of money-trends.js adds one cash kind to another.
  assert.doesNotMatch(JS, /cash\.(personal|business|unknown)[^;\n]*\+[^;\n]*cash\./);
});

test("a gap is a break in the line, never a point at 0", () => {
  // Direct: the segment walker never joins across a null.
  const segs = T.segments([1000, null, 3000, 4000, null, null, 2000, 2500], []);
  assert.equal(JSON.stringify(segs.map((s) => s.idx)), "[[2,3],[6,7]]");
  // Drawn: the hole on Oct 1-2 splits the cash line, and no point lands on the
  // zero line (the domain never reaches 0 for these values).
  const cash = figure(T.renderTrends(DATA, "30d"), "cash");
  const lines = [...cash.matchAll(/<polyline class="tline s1[^"]*" points="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(lines.length >= 2, "the personal line is broken by the gap");
  assert.doesNotMatch(cash, /class="tzero"/, "no zero line: nothing here is 0 or below");
  // A chart whose values are all null draws no line at all, only words.
  const empty = T.lineChart({ key: "x", title: "X", labels: ["a", "b", "c"], series: [{ name: "Y", cls: "s1", values: [null, null, null] }] });
  assert.doesNotMatch(empty, /<svg|<polyline/);
  assert.match(text(empty), /No history yet/);
  // The days before history starts are gaps in the table, not $0.00.
  assert.match(cash, /<td>Sep 7, 2026<\/td><td class="r num">—<\/td>/);
  assert.doesNotMatch(cash, /\$0\.00/);
});

test("a lone point with no neighbours is still drawn, as a dot", () => {
  const html = T.lineChart({ key: "x", title: "X", labels: ["a", "b", "c"], series: [{ name: "Y", cls: "s1", shape: "round", values: [null, 500, null] }] });
  assert.doesNotMatch(html, /<polyline/);
  assert.match(html, /<path class="tdot s1 rd"/);
});

test("estimated points are dashed, and the page says so in words", () => {
  const html = T.renderTrends(DATA, "30d");
  const cash = figure(html, "cash");
  assert.match(cash, /<polyline class="tline s1 test"/, "the backfilled stretch is dashed");
  assert.match(cash, /<polyline class="tline s1" /, "the snapshot stretch is solid");
  assert.match(text(html), /dashed line is estimated from your bank activity/);
  assert.match(text(cash), /\* estimated from your bank activity/);
});

test("every chart is accessible: role img, title, description, legend in words, a table", () => {
  const html = T.renderTrends(DATA, "30d");
  for (const key of ["cash", "debt", "used", "flow-personal", "flow-business"]) {
    const f = figure(html, key);
    if (/<svg/.test(f)) {
      assert.match(f, /<svg class="tsvg"[^>]*role="img"[^>]*aria-labelledby="(tc\d+t) (tc\d+d)"/);
      assert.match(f, /<title id="tc\d+t">[^<]+<\/title><desc id="tc\d+d">[^<]+<\/desc>/);
      assert.match(f, /<details class="tdata"><summary>Show the numbers<\/summary>/);
      assert.match(f, /<p class="legend caption tlegend">/);
    }
  }
});

test("money in vs out: personal and business are separate charts", () => {
  const html = T.renderTrends(DATA, "30d");
  const p = figure(html, "flow-personal");
  const b = figure(html, "flow-business");
  assert.match(text(p), /Personal money in vs out/);
  assert.match(text(p), /Money in \$3,000\.00 .*Money out \$1,200\.00/);
  assert.match(text(b), /Business money in vs out/);
  assert.match(text(b), /Money in \$9,000\.00/);
  assert.doesNotMatch(text(b), /\$12,000\.00/, "personal + business money in was added");
});

test("range switch: three buttons, the current one pressed", () => {
  const html = T.renderTrends(DATA, "30d");
  const btns = [...html.matchAll(/<button type="button" class="trange-btn" data-range="([^"]+)" aria-pressed="(true|false)">([^<]+)<\/button>/g)];
  assert.deepEqual(btns.map((m) => m[1]), ["30d", "90d", "12m"]);
  assert.deepEqual(btns.map((m) => m[2]), ["true", "false", "false"]);
  assert.match(JS, /"\/api\/money\/trends"/);
});

test("loading and error states say what is happening in words", () => {
  assert.match(T.renderLoading("90d"), /aria-busy="true"/);
  const err = T.renderError("offline", "90d");
  assert.match(text(err), /could not reach the server/);
  assert.match(err, /data-trends-retry/);
});

test("sales: nothing without a processor; a line with month gaps when connected", () => {
  assert.equal(T.renderSales(DATA), "", "no connection → the Connections section says so, not this");
  const d = buildTrends({
    asOf: ASOF, range: "12m",
    sales: { currency: "usd", months: ["2026-08", "2026-09", "2026-10"], totals: [
      { month: "2026-08", net_cents: 0 }, { month: "2026-09", net_cents: 40000 }, { month: "2026-10", net_cents: 125000 }] },
    connections: [{ created_at: "2026-09-01T00:00:00Z" }]
  });
  const html = T.renderSales(d);
  assert.match(text(html), /Sales trend/);
  assert.match(text(html), /Net sales \$1,250\.00/);
  assert.match(html, /<td>Aug 2026<\/td><td class="r num">—<\/td>/, "before the first connection is a gap");
});

test("wiring: Overview has a slot money-trends.js fills; Connections gets the sales line as an extra", () => {
  const M = load(MONEY_JS, "FHMoney");
  const ov = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-overview.sandbox.json"), "utf8"));
  assert.match(M.render(ov), /<div class="trends-slot" data-trends-slot><\/div>/);
  assert.match(MONEY_JS, /root\.FinanceOS\.trends/);
  assert.match(HOST_JS, /FinanceOS\.extras/);
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  assert.equal(typeof sandbox.window.FinanceOS.trends.mount, "function");
  assert.equal(typeof sandbox.window.FinanceOS.extras.connections.mount, "function");
  assert.match(HTML, /<script defer src="money-trends\.js"><\/script>/);
  // No chart library: plain inline SVG only.
  assert.doesNotMatch(HTML, /chart\.js|d3\.|echarts|apexcharts|highcharts/i);
});

test("credit: a pull missing one bureau breaks that bureau's line instead of bridging it", () => {
  const C = load(CREDIT_JS, "FHMoneyCredit");
  const d = {
    ok: true, has_pull: true, client: { name: "S" }, scores: {}, business: {}, accounts: { list: [] },
    history: [
      { pulled_at: "2026-06-30T00:00:00Z", experian: 700, equifax: 710, transunion: 705 },
      { pulled_at: "2026-07-30T00:00:00Z", experian: null, equifax: 715, transunion: 708 },
      { pulled_at: "2026-08-30T00:00:00Z", experian: 720, equifax: 722, transunion: 712 }
    ]
  };
  const html = C.render(d);
  assert.equal((html.match(/<polyline class="line line-ex"/g) || []).length, 0, "Experian has no two pulls in a row");
  assert.equal((html.match(/<polyline class="line line-eq"/g) || []).length, 1);
  assert.equal((html.match(/<circle class="dot"/g) || []).length, 8, "every real score is still a dot");
});
