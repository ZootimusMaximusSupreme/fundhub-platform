// /app/money-credit.html — the client's credit page.
// Runs money-credit.js's own render functions against a fixture that is the
// real read of the simulated sample client (029964c5…, one sample credit file),
// and checks the page rules: null is a dash never 0, sample says so, engine
// words verbatim, no chart from one pull, the shared nav, four states.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-credit.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-credit.js"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-credit.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHMoneyCredit;
}
const C = load();
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the page loads money-credit.js, reads /api/money/credit, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-credit\.js"><\/script>/);
  assert.match(HTML, /id="credit-root"/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.doesNotMatch(HTML, /crm-sidebar\.css/);
  assert.match(JS, /"\/api\/money\/credit"/);
  assert.doesNotMatch(JS, /method: "POST"|"POST"/, "a read-only page sends nothing");
});

test("the shared money nav, in the board's order, with Credit as the current page", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
  const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, [
    "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"
  ]);
  assert.match(nav, /href="\/app\/financeos\.html#credit" aria-current="page">Credit</);
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
});

test("no px font sizes except the one chart escape hatch; no new dependency", () => {
  const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  const px = css.match(/font-size:\s*\d+px[^;}]*/g) || [];
  assert.deepEqual(px, ["font-size:11px !important"]);
  assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script");
});

test("full: three bureau scores with pulled dates, words beside each, and the sample banner", () => {
  const html = C.render(fixture());
  const t = text(html);
  assert.match(t, /Experian 771 Very good/);
  assert.match(t, /Equifax 778 Very good/);
  assert.match(t, /TransUnion 766 Very good/);
  assert.match(t, /Pulled Sep 30, 2026/);
  assert.match(t, /Very good is 740–799/, "with one pull the comparison is the band range");
  assert.match(html, /Sample report/);
  assert.equal((html.match(/class="gauge-fill"/g) || []).length, 3, "no gauge drawn for the missing business score");
});

test("the sample banner shows only when the read says sample, never on a real pull", () => {
  const sample = fixture();
  assert.equal(sample.sample, true);
  assert.match(C.render(sample), /Sample report/);
  assert.match(text(C.render(sample)), /These scores came from a sample credit report, not a real bureau pull\./);
  const real = fixture();
  real.sample = false;
  assert.doesNotMatch(C.render(real), /Sample report|sample credit report/);
  const unsaid = fixture();
  delete unsaid.sample;
  assert.doesNotMatch(C.render(unsaid), /Sample report|sample credit report/);
});

test("the business score is a dash with words when nothing is stored, never 0", () => {
  const t = text(C.render(fixture()));
  assert.match(t, /Business · Experian — No business score on file yet/);
  const d = fixture();
  d.business = { name: "Fundhub LLC", intelliscore: 82, fsr: 61 };
  const t2 = text(C.render(d));
  assert.match(t2, /Business · Experian 82 Low risk/);
  assert.match(t2, /Financial stability 61 of 100/);
});

test("facts: cards used, open accounts, inquiries per bureau, negative items", () => {
  const t = text(C.render(fixture()));
  assert.match(t, /Cards used 6\.1% Excellent — 10% or less/);
  assert.match(t, /Open accounts 4 3 cards or lines · 1 loan/);
  assert.match(t, /Hard inquiries 4 EX 2 · EQ 1 · TU 1/);
  assert.match(t, /Negative items 0 Late payments: 0/);
});

test("a null anywhere is a dash, not 0", () => {
  const d = fixture();
  d.negative_items.count = null;
  d.inquiries = { total: null, by_bureau: { experian: null, equifax: null, transunion: null }, source: null };
  d.utilization = { percent: null, band: null, partial: false, source: null };
  d.accounts = { open: null, revolving: null, installment: null, source: "none", list: [] };
  const t = text(C.render(d));
  assert.match(t, /Negative items — Not on file yet/);
  assert.match(t, /Hard inquiries — Not on file yet/);
  assert.match(t, /Cards used — Not on file yet/);
  assert.match(t, /Open accounts — Not on file yet/);
  assert.doesNotMatch(t, /Negative items 0|Hard inquiries 0|Open accounts 0/);
});

test("UnderwriteIQ sentences are printed verbatim and escaped", () => {
  const d = fixture();
  d.suggestions = [{ text: "Engine words <b>here</b> & there.", topic: "inquiries" }];
  const html = C.render(d);
  assert.match(html, /Engine words &lt;b&gt;here&lt;\/b&gt; &amp; there\./);
  assert.match(text(C.render(fixture())), /Removing unnecessary or duplicate hard inquiries will improve automated underwriting scores and limit increases\./);
});

test("history: no line from one pull; a chart and a change from two", () => {
  const one = C.render(fixture());
  assert.match(text(one), /One pull so far/);
  assert.doesNotMatch(one, /<polyline/);
  const d = fixture();
  d.history = [
    { pulled_at: "2026-08-30T04:30:03.759Z", experian: 750, equifax: 760, transunion: 745, sample: true },
    { pulled_at: "2026-09-30T04:30:03.759Z", experian: 771, equifax: 778, transunion: 766, sample: true }
  ];
  const two = C.render(d);
  assert.equal((two.match(/<polyline/g) || []).length, 3);
  assert.match(text(two), /\+21 since Aug 30, 2026/);
  assert.match(text(two), /Experian Equifax TransUnion/, "legend in words, not colour alone");
});

test("accounts table lists every line from the read", () => {
  const html = C.render(fixture());
  for (const lender of ["TOYOTA MOTOR CREDIT", "AMEX", "CHASE CARD SERVICES", "CAPITAL ONE"]) {
    assert.match(html, new RegExp(lender));
  }
  assert.match(text(html), /CHASE CARD SERVICES Card \$1,200 \$20,000 6%/);
});

test("accounts table: each line says its own type, opened date, and Open or Closed, column by column", () => {
  const d = fixture();
  d.accounts.list = [
    { lender: "TOYOTA MOTOR CREDIT", kind: "installment", last4: null, limit_cents: 3400000, balance_cents: 1120000, opened_on: "2023-06-28", open: true },
    { lender: "AMEX", kind: "revolving", last4: "4321", limit_cents: 1500000, balance_cents: 85000, opened_on: "2021-05-28", open: false },
    { lender: "FIRST BANK LOC", kind: "loc", last4: null, limit_cents: 500000, balance_cents: 0, opened_on: null, open: true },
  ];
  const html = C.render(d);
  const head = [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);
  assert.deepEqual(head, ["Lender", "Type", "Balance", "Limit or loan", "Used", "Opened", "Status"]);
  const rows = [...html.match(/<tbody>[\s\S]*?<\/tbody>/)[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
    .map((tr) => [...tr[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((td) => text(td[1]).trim()));
  const cell = (row, column) => rows[row][head.indexOf(column)];
  assert.equal(rows.length, 3, "one table row per account in the read");
  assert.deepEqual(rows.map((_, i) => cell(i, "Status")), ["Open", "Closed", "Open"], "an open account is never called closed");
  assert.deepEqual(rows.map((_, i) => cell(i, "Opened")), ["Jun 28, 2023", "May 28, 2021", "—"], "no opened date is a dash, never a made-up date");
  assert.deepEqual(rows.map((_, i) => cell(i, "Type")), ["Loan", "Card", "Line of credit"]);
  assert.equal(cell(1, "Lender"), "AMEX ••4321");
  assert.deepEqual(rows.map((_, i) => cell(i, "Balance")), ["$11,200", "$850", "$0"]);
  assert.equal(cell(0, "Used"), "—", "a loan has no used percent");
});

test("empty: no pull and no business score → 'No credit pull yet' and one link to setup", () => {
  const d = fixture();
  d.has_pull = false;
  d.business.intelliscore = null;
  assert.ok(C.isEmpty(d));
  const html = C.render(d, "/app/money-setup.html?client_id=x");
  assert.match(html, /No credit pull yet/);
  assert.match(html, /href="\/app\/money-setup\.html\?client_id=x"/);
  assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
  assert.doesNotMatch(html, /class="gauge"/);
  assert.match(C.render(d), /href="\/app\/money-setup\.html"/);
});

test("error and loading states say what is happening in words", () => {
  assert.match(C.renderError("offline"), /could not reach the server/);
  assert.match(C.renderError("server"), /role="alert"/);
  assert.match(C.renderError("server"), /data-act="retry"/);
  assert.match(C.renderLoading(), /aria-busy="true"/);
  assert.equal(C.classify({ status: 401, body: null }), "signin");
  assert.equal(C.classify({ status: 503, body: { ok: false } }), "nodb");
  assert.equal(C.classify({ status: 200, body: { ok: true } }), "ok");
  assert.match(JS, /\/portal-login\.html/);
  assert.match(JS, /\/login\.html\?next=/);
});

/* ── Credit over time (spec item 4, 2026-11-06) ──────────────────────────
   credit_history off the read (src/finance/credit-history.mjs): one line per
   bureau from every saved pull, a picker with each saved business's lines,
   and a break wherever the server marked a gap. */
const P = (at, score, gap = false, extra = {}) => ({ pulled_at: at, score, sample: false, gap_before: gap, ...extra });
const JUL = "2026-07-31T12:00:00.000Z", AUG = "2026-08-31T12:00:00.000Z", OCT = "2026-10-30T12:00:00.000Z";
function withHistory() {
  const d = fixture();
  d.credit_history = {
    personal: {
      pulls: [JUL, AUG, OCT].map((at) => ({ pulled_at: at, sample: false })),
      series: [
        { bureau: "experian", points: [P(JUL, 740), P(AUG, 760), P(OCT, 771, true)] },
        { bureau: "equifax", points: [P(JUL, 752), P(OCT, 778, true)] },
        { bureau: "transunion", points: [P(JUL, 749), P(AUG, 770), P(OCT, 766, true)] }
      ],
      usage: [
        { pulled_at: JUL, percent: 38, partial: false, source: "report_accounts", sample: false, gap_before: false },
        { pulled_at: AUG, percent: 21.5, partial: false, source: "report_accounts", sample: false, gap_before: false },
        { pulled_at: OCT, percent: 6.1, partial: false, source: "report_accounts", sample: false, gap_before: true }
      ]
    },
    businesses: [
      { id: "b1", name: "Fundhub LLC", state: "AZ", has_report: true,
        reports: [{ pulled_at: JUL, sample: false }, { pulled_at: AUG, sample: false }],
        series: [
          { field: "commercialScore", points: [P(JUL, 61), P(AUG, 68)] },
          { field: "fsrScore", points: [P(JUL, 40), P(AUG, 47)] }
        ] },
      { id: "b2", name: "Second Co", state: "NV", has_report: false, reports: [], series: [] }
    ]
  };
  return d;
}
/* The score chart, or the cards-used chart, out of a render. */
const chartOf = (html, use = false) =>
  (html.match(/<svg class="chart[^"]*"[\s\S]*?<\/svg>/g) || []).filter((s) => /^<svg class="chart chart-use"/.test(s) === use)[0] || "";

test("credit over time: one line per bureau, a point and a tick for every pull, breaks where the server said", () => {
  const html = C.renderHistory(withHistory());
  const t = text(html);
  assert.match(t, /Credit over time/);
  assert.match(t, /One line for each bureau, one point for each saved credit pull\./);
  const svg = chartOf(html);
  // Experian Jul–Aug joined, then Oct after a gap month: 1 line. Equifax: none
  // (its two points are split by a gap). TransUnion: 1 line. Never bridged.
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.equal((svg.match(/<circle class="dot"/g) || []).length, 8, "one dot per real point, no made-up ones");
  for (const words of ["Experian 740 on Jul 31, 2026", "Equifax 778 on Oct 30, 2026", "TransUnion 770 on Aug 31, 2026"]) {
    assert.ok(svg.includes("<title>" + words + "</title>"), words);
  }
  assert.doesNotMatch(svg, /Equifax \d+ on Aug 31/, "no Equifax point on the pull that lacked it");
  assert.match(t, /Experian Equifax TransUnion/, "legend in words, not colour alone");
  assert.match(t, /3 pulls · Jul 31, 2026 to Oct 30, 2026/);
  assert.match(t, /A break in a line means a month with no pull, or a pull that did not have that score\./);
  assert.doesNotMatch(t, /sample report, not a real bureau pull/, "no sample note on real pulls");
});

test("credit over time: the date of each pull is on the axis when there is room", () => {
  const wide = chartOf(C.renderHistory(withHistory(), { width: 900 }));
  assert.match(wide, /viewBox="0 0 900 220"/, "drawn at the card's real width");
  for (const d of ["Jul 31", "Aug 31", "Oct 30"]) assert.match(wide, new RegExp(">" + d + "<"));
  const phone = chartOf(C.renderHistory(withHistory(), { width: 300 }));
  assert.match(phone, /viewBox="0 0 300 220"/);
  assert.match(phone, />Oct 30</, "the newest pull is always labelled");
  const lines = (phone.match(/<line class="chart-base"/g) || []).length;
  assert.equal(lines, 3 + 3, "three gridlines plus one tick per pull, even when a label is left off");
});

test("credit over time: cards used at each pull is its own line, only from pulls that have it", () => {
  const html = C.renderHistory(withHistory());
  assert.match(text(html), /Cards used at each pull/);
  const use = chartOf(html, true);
  assert.ok(use, "the cards-used chart is drawn");
  assert.equal((use.match(/<circle class="dot"/g) || []).length, 3);
  assert.ok(use.includes("<title>Cards used 6.1% on Oct 30, 2026</title>"));
  assert.equal((use.match(/<polyline/g) || []).length, 1, "Jul–Aug joined, Oct after the gap is a lone dot");
  const none = withHistory();
  none.credit_history.personal.usage = [];
  assert.doesNotMatch(C.renderHistory(none), /chart-use|Cards used at each pull/, "no pull has it: no chart, never 0%");
});

/* The picker's options as [label, value, selected]. */
const options = (html) => [...html.matchAll(/<option value="([^"]+)"( selected)?>([^<]+)<\/option>/g)]
  .map((m) => [m[3], m[1], m[2] === " selected"]);

test("business picker: Personal plus one choice per saved business; each shows only its own lines", () => {
  const d = withHistory();
  const personal = C.renderHistory(d);
  assert.match(personal, /<label class="hist-pick"><span class="caption">Show credit for<\/span> <select data-hist-pick aria-controls="hist-panel">/,
    "a labelled native select: the Astra client control, 48px tall, never sideways scroll");
  assert.deepEqual(options(personal), [["Personal", "personal", true], ["Fundhub LLC", "biz:0", false], ["Second Co", "biz:1", false]]);
  assert.doesNotMatch(personal, /role="tab"|fh-astra-tabs/, "no tab strip that can scroll sideways on a phone");

  const biz = C.renderHistory(d, { view: "biz:0" });
  const bt = text(biz);
  assert.deepEqual(options(biz).filter((o) => o[2]).map((o) => o[1]), ["biz:0"]);
  assert.match(bt, /Each score on the saved Experian business reports for Fundhub LLC\./);
  assert.match(bt, /Intelliscore Financial stability \(FSR\)/, "the report's scores, named in words");
  assert.match(bt, /2 reports · Jul 31, 2026 to Aug 31, 2026 · Experian business scores run 1 to 100\./);
  const svg = chartOf(biz);
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.ok(svg.includes("<title>Intelliscore 68 on Aug 31, 2026</title>"));
  assert.doesNotMatch(svg, /Experian|Equifax|TransUnion/, "no bureau line on a business view");

  const empty = C.renderHistory(d, { view: "biz:1" });
  assert.match(text(empty), /No business credit report is saved for Second Co yet\./);
  assert.doesNotMatch(empty, /<svg class="chart/);

  assert.deepEqual(options(C.renderHistory(d, { view: "biz:9" })).filter((o) => o[2]).map((o) => o[1]), ["personal"],
    "a business that is not there falls back to Personal");
  assert.match(text(C.renderHistory(d, { view: "biz:9" })), /One line for each bureau/);
});

test("business picker: no saved business, no picker; one report says its numbers and draws no line", () => {
  const d = withHistory();
  d.credit_history.businesses = [];
  assert.doesNotMatch(C.renderHistory(d), /data-hist-pick|<select/);
  const one = withHistory();
  one.credit_history.businesses[0].reports = [{ pulled_at: AUG, sample: false }];
  one.credit_history.businesses[0].series = [
    { field: "commercialScore", points: [P(AUG, 68)] }, { field: "fsrScore", points: [P(AUG, 47)] }
  ];
  const html = C.renderHistory(one, { view: "biz:0" });
  assert.match(text(html), /One report so far, on Aug 31, 2026: Intelliscore 68, Financial stability \(FSR\) 47\. The lines start with the next report\./);
  assert.doesNotMatch(html, /<svg class="chart/);
});

test("credit over time: one saved pull, and no pull at all, say so plainly", () => {
  const one = withHistory();
  one.credit_history.personal = {
    pulls: [{ pulled_at: OCT, sample: false }],
    series: [{ bureau: "experian", points: [P(OCT, 771)] }, { bureau: "equifax", points: [] }, { bureau: "transunion", points: [] }],
    usage: []
  };
  const h1 = C.renderHistory(one);
  assert.match(text(h1), /One pull so far, on Oct 30, 2026\. The lines start with your next pull\./);
  assert.doesNotMatch(h1, /<svg class="chart/);
  const none = withHistory();
  none.has_pull = false;
  none.credit_history.personal = { pulls: [], series: [], usage: [] };
  assert.match(text(C.renderHistory(none)), /No credit pulls are saved yet\. Your score lines show up here after your first pull\./);
  // With only a business score the page still renders, with the business picker.
  none.business.intelliscore = 70;
  assert.match(C.render(none), /No credit pulls are saved yet/);
  assert.match(C.render(none), /<option value="biz:0">Fundhub LLC<\/option>/);
});

test("credit over time: a sample point says so in words, once", () => {
  const d = withHistory();
  d.sample = false;
  d.credit_history.personal.series[0].points[2].sample = true;
  assert.match(text(C.renderHistory(d)), /Some points came from a sample report, not a real bureau pull\./);
  d.sample = true;
  assert.doesNotMatch(text(C.renderHistory(d)), /Some points came from a sample report/,
    "the page's Sample banner already says it; the card does not repeat it");
  assert.match(C.render(d), /Sample report/);
});

test("credit over time styles use the shared tokens only, and the picker is never under 44px", () => {
  const css = fs.readFileSync(path.join(APP, "money-credit-ios.css"), "utf8");
  const block = css.slice(css.indexOf("/* Credit over time"));
  assert.ok(block.length > 100, "the Credit over time block is in money-credit-ios.css");
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, "no hard-coded colour; var(--line), var(--ink) and friends only");
  for (const token of ["var(--line)", "var(--ink)", "var(--gray)", "var(--surface)"]) assert.ok(block.includes(token), token);
  assert.match(block, /\.hist-pick select\{[^}]*min-height:48px/);
  assert.match(block, /\.hist-pick select\{[^}]*max-width:100%/, "fits a 390px phone");
});

test("the section redraws at the card's real width, and the picker switches views, with no write", () => {
  assert.match(JS, /new root\.ResizeObserver\(refit\)/);
  assert.match(JS, /requestAnimationFrame/, "the redraw waits a frame, never inside the resize callback");
  assert.match(JS, /el\.addEventListener\("change"[\s\S]{0,200}data-hist-pick/);
  assert.doesNotMatch(JS, /method: "POST"|"POST"/, "switching a view sends nothing");
});
