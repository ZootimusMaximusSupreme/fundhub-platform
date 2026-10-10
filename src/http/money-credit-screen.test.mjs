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
