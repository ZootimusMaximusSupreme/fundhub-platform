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

import { buildTrends, accountChoices, pickAccount } from "../finance/money-trends.mjs";

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

/* ---- One account and any dates (Finance OS CFO build, unit A, 2026-11-07) ---- */

const ENTS = [{ id: "e-p", kind: "personal", name: "Me" }, { id: "e-b", kind: "business", name: "Sample LLC" }];
const ACCT_ROWS = [
  { id: "a-chk", name: "Everyday Checking", mask: "0001", account_type: "depository", account_subtype: "checking", entity_id: "e-p", institution_name: "Sample Bank" },
  { id: "a-card", name: "Sample Rewards Card", mask: "5678", account_type: "credit", account_subtype: "credit card", entity_id: "e-p", institution_name: "Sample Bank" },
  { id: "a-biz", name: "Business Checking", mask: "4455", account_type: "depository", account_subtype: "checking", entity_id: "e-b" },
  { id: "a-loan", name: "Equipment Loan", account_type: "loan", entity_id: "e-b" }
];
const CHOICES = accountChoices({ accounts: ACCT_ROWS, entities: ENTS });
/* Six days of the card: a gap on Oct 3, no limit on Oct 5. */
const CARD_ROWS = [
  { day: "2026-10-01", current_balance_cents: "250000", credit_limit_cents: "1000000", estimated: false },
  { day: "2026-10-02", current_balance_cents: "300000", credit_limit_cents: "1000000", estimated: false },
  { day: "2026-10-04", current_balance_cents: "320000", credit_limit_cents: "1000000", estimated: false },
  { day: "2026-10-05", current_balance_cents: "340000", credit_limit_cents: null, estimated: false },
  { day: "2026-10-06", current_balance_cents: "200000", credit_limit_cents: "1000000", estimated: false }
];
const cardRead = () => buildTrends({
  asOf: ASOF, from: "2026-10-01", to: "2026-10-06", choices: CHOICES,
  account: pickAccount(CHOICES, "a-card"), accountRows: CARD_ROWS
});

test("account picker: All accounts first, then the open accounts grouped by kind, named the overview's way", () => {
  const html = T.renderTrends({ ...DATA, accounts: CHOICES }, "30d");
  const sel = html.match(/<select data-trends-account>[\s\S]*?<\/select>/);
  assert.ok(sel, "the picker is drawn when the read names accounts");
  assert.match(sel[0], /^<select data-trends-account><option value="" selected>All accounts<\/option>/);
  assert.deepEqual([...sel[0].matchAll(/<optgroup label="([^"]+)">/g)].map((m) => m[1]), ["Personal", "Business"]);
  assert.deepEqual([...sel[0].matchAll(/<option value="(a-[^"]+)">([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]), [
    ["a-chk", "Everyday Checking ••0001 · Checking"],
    ["a-card", "Sample Rewards Card ••5678 · Card"],
    ["a-biz", "Business Checking ••4455 · Checking"],
    ["a-loan", "Equipment Loan · Loan"]
  ]);
  assert.match(html, /<span class="tlabel">Account<\/span>/, "the picker has a visible label");
  // No accounts named (an older read, or none connected): no picker at all.
  assert.doesNotMatch(T.renderTrends(DATA, "30d"), /data-trends-account/);
});

test("date fields: From and To show the window on screen, with a button that says what it does", () => {
  const html = T.renderTrends(DATA, "30d");
  assert.match(html, /<input type="date" name="from" data-trends-from value="2026-09-07"/);
  assert.match(html, /<input type="date" name="to" data-trends-to value="2026-10-06"/);
  assert.match(html, /<form class="tdates" data-trends-dates novalidate/);
  assert.match(html, /<button type="submit" class="btn-secondary tshow" data-trends-show>Show these dates<\/button>/);
  assert.match(html, /<p class="caption tmsg" data-trends-msg role="status" aria-live="polite"><\/p>/);
  // Any dates: no preset button is pressed.
  const custom = T.renderTrends(buildTrends({ asOf: ASOF, from: "2026-08-01", to: "2026-08-31", rollups: rollups() }), null);
  const pressed = [...custom.matchAll(/data-range="([^"]+)" aria-pressed="true"/g)].map((m) => m[1]);
  assert.deepEqual(pressed, [], "a custom window presses no preset");
  assert.match(custom, /value="2026-08-01"/);
  // Short client words (owner rule 2026-11-07): no how-it-works line for any dates.
  assert.doesNotMatch(text(custom), /first and last months count only/);
});

test("one card: owed with its limit, and limit used, as two charts; a gap and an unknown limit are breaks", () => {
  const d = cardRead();
  const html = T.renderTrends(d, null);
  assert.match(html, /<option value="a-card" selected>/);
  assert.match(text(html), /Sample Rewards Card ••5678 Personal · Card · Sample Bank/);
  const owed = figure(html, "acct-balance");
  const used = figure(html, "acct-used");
  assert.match(text(owed), /Owed and limit/);
  assert.match(text(owed), /Owed \$2,000\.00 .*Limit \$10,000\.00/);
  assert.deepEqual([...new Set([...owed.matchAll(/<polyline class="tline (s\d)/g)].map((m) => m[1]))].sort(), ["s1", "s3"],
    "personal is blue; the limit is its own line");
  assert.match(text(used), /Limit used 20%/);
  // Oct 3 has no row, Oct 5 has no limit: the used table says — on both, never 0%.
  assert.match(used, /<td>Oct 3, 2026<\/td><td class="r num">—<\/td>/);
  assert.match(used, /<td>Oct 5, 2026<\/td><td class="r num">—<\/td>/);
  assert.match(used, /<td>Oct 4, 2026<\/td><td class="r num">32%<\/td>/);
  const usedTitles = [...used.matchAll(/<title>(Limit used · [^<]+)<\/title>/g)].map((m) => m[1]);
  assert.equal(usedTitles.length, 4, "four days with a known limit; the gap and the no-limit day draw nothing");
  // The all-accounts charts are not drawn under one account.
  assert.doesNotMatch(html, /data-chart="(cash|debt|used|flow-personal|flow-business)"/);
  assert.match(text(html), /This is one account on its own\. A dashed line is an estimate\./);
  assert.doesNotMatch(text(html), /Limit used is what is owed divided by/);
});

test("one bank account: a balance line only, in the kind's colour; no history says so in words", () => {
  const d = buildTrends({
    asOf: ASOF, range: "30d", choices: CHOICES, account: pickAccount(CHOICES, "a-biz"),
    accountRows: [{ day: "2026-10-05", current_balance_cents: "1800000", estimated: true }, { day: "2026-10-06", current_balance_cents: "1850000", estimated: false }]
  });
  const html = T.renderTrends(d, "30d");
  const bal = figure(html, "acct-balance");
  assert.match(text(bal), /Balance over time/);
  assert.match(text(bal), /Balance \$18,500\.00/);
  assert.match(bal, /<polyline class="tline s2 test"/, "business is orange; the estimated day is dashed");
  assert.doesNotMatch(html, /data-chart="acct-used"/, "only a card has limit used");
  const none = T.renderTrends(buildTrends({ asOf: ASOF, range: "30d", choices: CHOICES, account: pickAccount(CHOICES, "a-loan") }), "30d");
  assert.match(text(figure(none, "acct-balance")), /No history for this account yet/);
  assert.doesNotMatch(figure(none, "acct-balance"), /<svg/);
});

test("the read path: dates win over the range, the account rides along, staff keep client_id", () => {
  assert.equal(T.pathFor("12m", ""), "/api/money/trends?range=12m");
  assert.equal(T.pathFor({ range: "30d" }, "c-1"), "/api/money/trends?range=30d&client_id=c-1");
  assert.equal(T.pathFor({ range: "30d", from: "2026-01-01", to: "2026-02-01", account: "a-card" }, "c-1"),
    "/api/money/trends?from=2026-01-01&to=2026-02-01&account=a-card&client_id=c-1");
  assert.equal(T.pathFor({ range: "90d", account: "a-biz" }, ""), "/api/money/trends?range=90d&account=a-biz");
});

test("the screen checks dates with the server's rules before asking", () => {
  assert.equal(T.checkDates("2026-01-01", "2026-03-31"), "");
  assert.equal(T.checkDates("2024-11-06", "2026-11-06"), "", "exactly 24 months is fine");
  assert.match(T.checkDates("2024-11-05", "2026-11-06"), /24 months or less/);
  assert.match(T.checkDates("2026-03-02", "2026-03-01"), /on or before To/);
  assert.match(T.checkDates("2026-02-30", "2026-03-01"), /not real dates/);
  assert.match(T.checkDates("", "2026-03-01"), /both/);
});

test("a long window that crosses a year labels its axis with the year; a short one with the day", () => {
  const short = ["2026-10-04", "2026-10-05", "2026-10-06"];
  assert.deepEqual([...T.dayAxis(short)], ["Oct 4", "Oct 5", "Oct 6"]);
  const long = buildTrends({ asOf: ASOF, from: "2025-01-01", to: "2026-10-06" }).daily.days;
  assert.deepEqual([...T.dayAxis(long)], ["Jan 2025", "Nov 2025", "Oct 2026"]);
});

test("a 400 from the read says to pick the dates again, in words", () => {
  assert.equal(T.classify({ status: 400, body: { ok: false } }), "baddates");
  assert.match(text(T.renderError("baddates", null)), /Pick your dates again, no more than 24 months apart/);
});

/* ---- Bank waypoints on the Cash chart (2026-11-07). Contract: GET
   /api/money/banks deposit_plan[]. Fictional sample banks only. ---- */

const PLAN = [
  { lender_id: "l-a", name: "Sample Bank", logo: "/sample-logos/sample-bank.svg", kind: "bank", open_by: "2026-11-20",
    deposit_cents: 500000, season_days: 60, reason: "Sample reason: a small opening deposit.", status: "planned" },
  { lender_id: "l-b", name: "Sample Credit Union", logo: null, kind: "credit_union", open_by: "2026-09-20",
    deposit_cents: 250000, season_days: null, reason: "Sample reason: members get a business account", status: "deposited" },
  { lender_id: "l-c", name: "Sample Savings", logo: null, kind: "bank", open_by: null,
    deposit_cents: 100000, season_days: null, reason: "Sample reason: date waits on your LLC.", status: "planned" },
  { lender_id: "l-d", name: "Sample Far Bank", logo: null, kind: "bank", open_by: "2027-06-01",
    deposit_cents: null, season_days: null, reason: "", status: "planned" },
  { lender_id: "l-e", name: "Sample Odd Logo", logo: "javascript:alert(1)", kind: "bank", open_by: "2026-10-01",
    deposit_cents: 1000, season_days: null, reason: "", status: "opened" }
];
const waypoint = (html, id) => {
  const m = html.match(new RegExp('<button type="button" class="twp[^"]*" data-waypoint="' + id + '"[^>]*>[\\s\\S]*?</button>'));
  return m ? m[0] : null;
};
const sameMarkup = (a, b) => assert.equal(a.replace(/tc\d+/g, "tc"), b.replace(/tc\d+/g, "tc"));

test("waypoints: a future date draws a marker with the owner's sentence, the logo, a guide and the Plan strip", () => {
  const cash = figure(T.renderTrends(DATA, "30d", { plan: PLAN }), "cash");
  const a = waypoint(cash, "l-a");
  assert.ok(a, "the Nov 20 waypoint is drawn past today");
  assert.match(a, /aria-label="Open Sample Bank and deposit \$5,000\.00 by Nov 20, 2026\. Sample reason: a small opening deposit\. Status: Planned\."/);
  assert.match(a, /<img class="twp-logo" src="\/sample-logos\/sample-bank\.svg" alt=""/);
  assert.match(a, /class="twp st-planned/, "a planned waypoint has the dashed ring");
  assert.match(cash, /<span class="tplan-label caption" aria-hidden="true">Plan<\/span><div class="tplan"/);
  assert.match(text(cash), /Open Sample Bank and deposit \$5,000\.00 by Nov 20, 2026\. Sample reason: a small opening deposit\. Status: Planned/,
    "the tip says the sentence, the reason and the status");
  assert.equal((cash.match(/<line class="tguide"/g) || []).length, 3, "one dashed guide per drawn waypoint (Sep 20, Oct 1, Nov 20)");
  // In-window waypoint: a done one has the solid ring and its status word.
  assert.match(waypoint(cash, "l-b"), /class="twp st-deposited/);
  assert.match(waypoint(cash, "l-b"), /Sample reason: members get a business account\. Status: Deposited\./, "a reason with no period gets one");
});

test("waypoints: the money lines stop at today — nothing is drawn past it but the plan", () => {
  const cash = figure(T.renderTrends(DATA, "30d", { plan: PLAN }), "cash");
  const today = Number(cash.match(/<line class="ttoday" x1="([\d.]+)"/)[1]);
  assert.ok(today < 600, "today sits inside the axis because the axis runs on to the plan");
  const xs = [...cash.matchAll(/<polyline class="tline[^"]*" points="([^"]+)"/g)]
    .flatMap((m) => m[1].trim().split(/\s+/).map((p) => Number(p.split(",")[0])));
  assert.ok(xs.length > 0);
  assert.ok(Math.max(...xs) <= today + 0.05, "no line point is drawn after today");
  const dotsX = [...cash.matchAll(/<path class="thit" d="M([\d.]+) /g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...dotsX) <= today + 0.05, "no point is drawn after today");
  // The table lists only real days: the plan days are not rows of $ amounts.
  assert.doesNotMatch(cash, /<td>Nov 20, 2026<\/td>/);
  assert.match(text(cash), /The money lines stop at today/);
  // The axis now ends after the last waypoint.
  assert.match(cash, /<div class="tx caption" aria-hidden="true"><span>Sep 7<\/span><span>[^<]+<\/span><span>Nov 2\d<\/span><\/div>/);
});

test("waypoints: a row with no date is listed as Date not set and never drawn; too far ahead is listed, not drawn", () => {
  const cash = figure(T.renderTrends(DATA, "30d", { plan: PLAN }), "cash");
  assert.equal(waypoint(cash, "l-c"), null, "no date → no marker");
  assert.match(cash, /<p class="tplan-head">Date not set<\/p><ul class="tplan-list"><li>Open Sample Savings and deposit \$1,000\.00\./);
  assert.equal(waypoint(cash, "l-d"), null, "more than six months ahead → no marker");
  assert.match(cash, /<p class="tplan-head">Not on these dates<\/p><ul class="tplan-list"><li>Open Sample Far Bank by Jun 1, 2027\./);
});

test("waypoints: no logo, or a logo address we will not load, shows the bank name in a chip", () => {
  const cash = figure(T.renderTrends(DATA, "30d", { plan: PLAN }), "cash");
  assert.match(waypoint(cash, "l-b"), /<span class="twp-chip">Sample Credit Union<\/span>/);
  assert.doesNotMatch(waypoint(cash, "l-b"), /<img/);
  assert.match(waypoint(cash, "l-e"), /<span class="twp-chip">Sample Odd Logo<\/span>/);
  assert.doesNotMatch(cash, /javascript:/);
});

/* The banks read hands the logo as a string or as { src, alt, source }
   (src/finance/bank-strategy.mjs pickBankLogo). Plaid's logo is a PNG data URI. */
test("waypoints: a logo object or a Plaid PNG draws the logo; a bad object still shows the name chip", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const plan = [
    { ...PLAN[0], logo: { src: "/sample-logos/sample-bank.svg", alt: "Sample Bank logo", source: { label: "Bank book" } } },
    { ...PLAN[1], logo: { src: png, alt: "Sample Credit Union logo" } },
    { ...PLAN[4], logo: { src: "javascript:alert(1)", alt: "x" } }
  ];
  const cash = figure(T.renderTrends(DATA, "30d", { plan }), "cash");
  assert.match(waypoint(cash, "l-a"), /<img class="twp-logo" src="\/sample-logos\/sample-bank\.svg" alt=""/);
  assert.match(waypoint(cash, "l-b"), /<img class="twp-logo" src="data:image\/png;base64,iVBORw0KGgoAAAANSUhEUg==" alt=""/);
  assert.match(waypoint(cash, "l-e"), /<span class="twp-chip">Sample Odd Logo<\/span>/);
  assert.doesNotMatch(cash, /javascript:|\[object Object\]/);
});

test("waypoints: with no plan (the banks read failed or is empty) the Cash chart is exactly as before", () => {
  const plain = T.renderTrends(DATA, "30d");
  sameMarkup(T.renderTrends(DATA, "30d", { plan: null }), plain);
  sameMarkup(T.renderTrends(DATA, "30d", { plan: [] }), plain);
  assert.doesNotMatch(plain, /tplan|tguide|ttoday|data-waypoint/);
  // And the opposite: the plan really does change the chart.
  assert.notEqual(T.renderTrends(DATA, "30d", { plan: PLAN }).replace(/tc\d+/g, "tc"), plain.replace(/tc\d+/g, "tc"));
});

test("waypoints: positions, the six-month cap, and a window that ends before today", () => {
  const days = buildTrends({ asOf: ASOF, range: "30d" }).daily.days;
  const L = T.planLayout(PLAN, days, "2026-10-06");
  assert.deepEqual([...L.drawn.map((m) => m.item.key)], ["l-b", "l-e", "l-a"], "sorted by day");
  assert.equal(L.extra[0], "2026-10-07", "the axis runs on from the day after today");
  assert.ok(L.extra.at(-1) >= "2026-11-27", "at least a week of room after the last waypoint");
  for (const m of L.drawn) {
    assert.equal(L.allDays[m.idx], m.item.open_by);
    assert.ok(Math.abs(m.x - (m.idx * 100) / (L.xCount - 1)) < 1e-9);
  }
  assert.equal(L.todayIdx, 29);
  // Exactly six months ahead (183 days) is drawn; one day more is listed.
  const edge = [{ name: "Sample A", open_by: "2027-04-07" }, { name: "Sample B", open_by: "2027-04-08" }];
  const E = T.planLayout(edge, days, "2026-10-06");
  assert.deepEqual([...E.drawn.map((m) => m.item.name)], ["Sample A"]);
  assert.deepEqual([...E.outside.map((it) => it.name)], ["Sample B"]);
  // A window that ends before today never runs on into the future.
  const past = buildTrends({ asOf: ASOF, from: "2026-08-01", to: "2026-08-31" }).daily.days;
  const P = T.planLayout(PLAN, past, "2026-10-06");
  assert.equal(P.extra.length, 0);
  assert.equal(P.drawn.length, 0);
  assert.deepEqual([...P.outside.map((it) => it.key)].sort(), ["l-a", "l-b", "l-d", "l-e"]);
});

test("waypoints: no balance history yet → the plan is a list under the empty chart, not a strip", () => {
  const empty = buildTrends({ asOf: ASOF, range: "30d" });
  const cash = figure(T.renderTrends(empty, "30d", { plan: PLAN }), "cash");
  assert.match(text(cash), /No history yet/);
  assert.doesNotMatch(cash, /class="tplan"/);
  assert.match(cash, /<p class="tplan-head">Your bank plan<\/p>/);
  assert.match(text(cash), /Open Sample Bank and deposit \$5,000\.00 by Nov 20, 2026\./);
});

test("waypoints: one account picked → no plan strip (the plan belongs to the all-accounts Cash chart)", () => {
  const html = T.renderTrends(cardRead(), null, { plan: PLAN });
  assert.doesNotMatch(html, /data-waypoint|class="tplan"/);
  assert.equal(T.banksPath(""), "/api/money/banks");
  assert.equal(T.banksPath("c-1"), "/api/money/banks?client_id=c-1");
});
