// /app/money-fundability.html — runs money-fundability.js's own render
// functions against a fixture that is the REAL read of the simulated sample
// client (029964c5…, one sample credit file, read-only, 2026-10-06), and checks
// the page rules: null is a dash never 0, status in words not colour, engine
// sentences verbatim, the "if removed" line says it is not promised, businesses
// one card each and never added up, four states, the shared nav, scoped styles,
// no px font sizes, and a phone layout.
import { test } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { buildFundability, addMonths } from "../finance/fundability.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-fundability.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-fundability.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-fundability.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-fundability.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const F = W.FHMoneyFundability;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/* Two more files for the parts the sample client does not have — one with a
   dispute plan, one with businesses. Each is ONE file (a dispute plan needs
   negative items, so that file is not fundable; the business file is clean).
   Built by the real back end from rows, so the shape is the API's, not a
   hand-typed guess. Test files only, never shown to anyone. */
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
function richer({ negatives = 0, disputes = false } = {}) {
  const line = (id, lender, kind, limit, balance, opened) => ({ id, lender, kind, credit_limit_cents: limit, balance_cents: balance, opened_on: opened, closed_at: null, last4: null });
  return JSON.parse(JSON.stringify(buildFundability({
    client: { id: "c", first_name: "Test", last_name: "File", custom_fields: {
      crs_inquiries_ex: 1, crs_inquiries_eq: 0, crs_inquiries_tu: 0, crs_negative_items_count: negatives, crs_late_payments_count: 0 } },
    asOf: new Date(),
    crsRows: [{ id: "p", created_at: "2026-09-30T00:00:00Z", result: { scores: { ex: 720, eq: 731, tu: 726 }, scoreModels: {} } }],
    tradelineRows: [
      line("t1", "CHASE", "revolving", "2000000", "300000", ago(60)),
      line("t2", "AMEX", "revolving", "1000000", "100000", ago(50)),
      line("t3", "CITI", "revolving", "500000", "50000", ago(40))
    ],
    liabilities: ["t1", "t2", "t3"].map((id) => ({ tradeline_id: id, payment_status: "current" })),
    businessRows: [
      { id: "b1", name: "Alpha Consulting LLC", age_months: 30, created_at: "2026-10-01T00:00:00Z", entity_data: { source: "finance_os", entity_id: "e1", naics: "541611" } },
      { id: "b2", name: "Beta Marketing LLC", age_months: 8, created_at: "2026-10-02T00:00:00Z", entity_data: { source: "finance_os", entity_id: "e2" } }
    ],
    containers: [
      { id: "e1", kind: "business", name: "Alpha Consulting LLC", archived_at: null },
      { id: "e2", kind: "business", name: "Beta Marketing LLC", archived_at: null },
      { id: "e3", kind: "business", name: "Gamma Shop", archived_at: null }
    ],
    disputeItems: disputes ? [{ id: "d1", rule_id: "DEROG-COLLECTION", status: "sent", creditor: "MIDLAND", account_last4: "1234" }] : []
  })));
}
const withDisputes = () => richer({ negatives: 2, disputes: true });
const withBusinesses = () => richer();

test("the page loads its script and stylesheet, reads /api/money/fundability, and keeps out of the staff shell", () => {
  assert.match(HTML, /<script defer src="money-fundability\.js"><\/script>/);
  assert.match(HTML, /<link rel="stylesheet" href="money-fundability\.css">/);
  assert.match(HTML, /id="fundability-root"/);
  assert.match(HTML, /<div class="app">/);
  assert.doesNotMatch(HTML, /src="shell\.js"/);
  assert.doesNotMatch(HTML, /crm-sidebar\.css/);
  assert.match(JS, /"\/api\/money\/fundability"/);
  assert.doesNotMatch(JS, /method: "POST"|"POST"/, "a read-only page sends nothing");
});

test("the shared money nav, with Fundability as the one current page", () => {
  const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
  const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
  assert.deepEqual(hrefs, [
    "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
    "/app/money-fundability.html",
    "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup"
  ]);
  assert.match(nav, /href="\/app\/money-fundability\.html" aria-current="page">Fundability</);
  assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
});

test("no px font size anywhere, no font shorthand, no outside script, no new dependency", () => {
  const style = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
  for (const src of [style, CSS, JS]) {
    assert.doesNotMatch(src, /font-size\s*:\s*\d/);
    assert.doesNotMatch(src, /(?:^|[;{\s])font\s*:\s*[^;}]*\d+px/);
  }
  assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script");
  assert.doesNotMatch(JS, /require\(|import /, "plain browser script");
});

test("the section's styles all live under .fh-fundability, with no hand-rolled shadow", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const selectors = css.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
  assert.ok(selectors.length > 40);
  for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-fundability(\s|$)/, part);
  assert.doesNotMatch(CSS, /box-shadow/, "the resting shadow comes from fundhub-brand.css (UI-STANDARDS §12.2)");
});

test("spacing stays on the 8px scale", () => {
  const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  const bad = [];
  for (const m of css.matchAll(/(?:^|[;{])\s*(gap|padding(?:-\w+)?|margin(?:-\w+)?)\s*:\s*([^;}]+)/g)) {
    for (const px of m[2].match(/-?\d+px/g) || []) {
      if (![0, 8, 16, 24, 32, 48, 64].includes(Math.abs(parseInt(px, 10)))) bad.push(`${m[1]}:${m[2]}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("phone: every card row stacks to one column and nothing forces the page wider than 375px", () => {
  const phone = CSS.match(/@media \(max-width:760px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(phone, /\.fh-fundability \.fd-thirds>\*\{grid-column:span 12\}/);
  const tablet = CSS.match(/@media \(max-width:1100px\)\{([\s\S]*?)\n\}/)[1];
  assert.match(tablet, /\.fh-fundability \.fd-halves>\*\{grid-column:span 12\}/);
  const decls = CSS.replace(/@media[^{]+\{/g, "");
  for (const m of decls.matchAll(/(?:^|[;{])\s*(?:min-)?width\s*:\s*(\d+)px/g)) assert.ok(Number(m[1]) <= 64, m[0]);
  assert.match(CSS, /\.fh-fundability \.fd-scroll\{overflow-x:auto\}/, "the per-business table scrolls inside its own box");
  // "Jan 2027" ran into "Today" at 375px; the phone shows "+3 mo" instead.
  assert.match(phone, /\.fh-fundability \.fd-xl-long\{display:none\}/);
  assert.match(phone, /\.fh-fundability \.fd-xl-short\{display:inline\}/);
  assert.match(F.renderChart(fixture()), /<span class="fd-xl-long">Jan 2027<\/span><span class="fd-xl-short">\+3 mo<\/span>/);
});

test("full: fundability now, the money, and the 12-month comparison — from the real sample read", () => {
  const html = F.render(fixture());
  const t = text(html);
  assert.match(html, /Sample report/);
  assert.match(t, /Fundability now 5 of 6 Fundable UnderwriteIQ checks passed · 1 not yet/);
  assert.match(t, /In 12 months on your plan: 5 of 6/);
  assert.match(t, /Funding estimate \$212,000 UnderwriteIQ's first look, not a bank's yes\./);
  assert.match(t, /In 12 months 5 of 6 Fundable On your plan, by Oct 7, 2027/);
  assert.doesNotMatch(t, /\$636,000/, "never the per-bureau sum (owner walk finding 9)");
});

test("what drives it: six checks, each a word and a mark — never colour alone", () => {
  const html = F.render(fixture());
  const rows = html.match(/<li class="fd-factor [^"]+">[\s\S]*?<\/li>/g);
  assert.equal(rows.length, 6);
  for (const r of rows) assert.match(text(r), /(Pass|Not yet|Not on file)\s*$/);
  const t = text(html);
  assert.match(t, /Credit score 700 or higher Now 778 · needs 700 or higher UnderwriteIQ reads your Equifax score — the highest one on file\. Pass/);
  assert.match(t, /Cards used 30% or less Now 6\.1% · needs 30% or less Pass/);
  assert.match(t, /A card 2\+ years old with a \$5,000\+ limit Now \$20,000 · needs \$5,000 or more Pass/);
  assert.match(t, /No hard inquiries Now 4 · needs 0 Not yet/);
  assert.match(t, /Each check counts the same\. The score is how many pass\./);
});

test("UnderwriteIQ's sentence is printed verbatim, tagged with the check it moves, and escaped", () => {
  const t = text(F.render(fixture()));
  assert.match(t, /Removing unnecessary or duplicate hard inquiries will improve automated underwriting scores and limit increases\. Moves: No hard inquiries/);
  const d = fixture();
  d.now.sentences = [{ text: "<b>x</b>", topic: "inquiries", check: "no_inquiries" }];
  assert.match(F.render(d), /&lt;b&gt;x&lt;\/b&gt;/);
});

test("the chart: today and three dates, a solid plan line, assumptions on the chosen date", () => {
  const html = F.renderChart(fixture());
  assert.equal((html.match(/class="fd-col"/g) || []).length, 4);
  assert.equal((html.match(/aria-pressed="true"/g) || []).length, 1);
  assert.match(html, /<polyline class="fd-line fd-line-plan" points="0,16\.7 25,16\.7 50,16\.7 100,16\.7"/);
  assert.doesNotMatch(html, /fd-line-ifr/, "no dispute plan, no dashed line");
  const t = text(html);
  assert.match(t, /Today/);
  assert.match(t, /Jan 2027/);
  assert.match(t, /Oct 2027/);
  assert.match(t, /Your plan — solid line, filled dots/);
  assert.match(t, /Oct 7, 2027 · in 12 months Your plan 5 of 6 · Fundable · Estimate \$212,000 12 months go by\. Your open accounts stay open\./);
  assert.match(t, /No card paydowns or disputes on file yet, so this line only shows time going by\./);
  assert.match(text(F.renderDetail(fixture(), 0)), /Today Your plan 5 of 6 · Fundable · Estimate \$212,000 Your file as it is today\. No guesses\./);
  for (const m of html.matchAll(/aria-label="([^"]+)"/g)) assert.ok(m[1].length > 8, "every date button says what it is");
});

test("if removed: its own dashed line with open dots, and it always says it is not promised", () => {
  const d = withDisputes();
  const html = F.renderChart(d);
  assert.match(html, /fd-line fd-line-ifr/);
  assert.match(html, /fd-dot-ifr/);
  const t = text(html);
  assert.match(t, /If removed — dashed line, open dots\. Not promised\./);
  assert.match(t, /If removed .* That is not promised — a bureau can keep an item\./);
  assert.match(t, /Your plan on file: disputes on 1 negative account\./);
  const later = text(F.render(d));
  assert.match(later, /If removed: \d of 6/);
});

test("businesses: one card each, a container with no details asks for them, and nothing adds them up", () => {
  const d = withBusinesses();
  const html = F.render(d);
  const cards = html.match(/<section class="card fd-biz"[\s\S]*?<\/section>/g);
  assert.equal(cards.length, 3);
  const t = text(html);
  assert.match(t, /Each business is read on its own\. They are never added together\./);
  assert.match(text(cards[0]), /Alpha Consulting LLC 5 of 5/);
  assert.match(text(cards[1]), /Beta Marketing LLC 3 of 5/);
  assert.match(text(cards[1]), /Industry code \(NAICS\) on file Now not on file · needs On file FinanceOS has no place to save an industry code yet\. Not yet/);
  assert.match(text(cards[2]), /Gamma Shop Add this business's details to see it here\. Add business details/);
  assert.match(cards[2], /href="\/app\/financeos\.html#accounts"/);
  // ("Combined with a strong personal profile" is the engine's own LLC sentence,
  // printed verbatim — it is not a total.)
  assert.doesNotMatch(t, /\bTotal\b|all businesses|businesses combined|combined (estimate|score|funding)/i);
  const alpha = d.businesses[0].now.funding_estimate_cents;
  const beta = d.businesses[1].now.funding_estimate_cents;
  assert.ok(alpha > 0 && beta > 0);
  assert.doesNotMatch(t, new RegExp(F.money(alpha + beta).replace(/[$]/g, "\\$")), "no summed figure on the page");
});

test("no business yet: says what will appear and one way to make it appear", () => {
  const t = text(F.render(fixture()));
  assert.match(t, /Your businesses .* No business on file yet\. Add one to see its fundability here\. Add a business/);
});

test("a null anywhere is a dash, never $0 or 0 of 6", () => {
  const d = fixture();
  d.now.funding_estimate_cents = null;
  d.now.tier = "not_fundable";
  d.now.score = null;
  const t = text(F.render(d));
  assert.match(t, /Fundability now — Not fundable yet/);
  assert.match(t, /Funding estimate — Shows up once your file is fundable\. Your personal file comes first\./);
  assert.doesNotMatch(t, /\$0\b|0 of 6|NaN|undefined|null/);
  assert.equal(F.money(null), "—");
  assert.equal(F.scoreText({ score: null }), "—");
});

test("what this cannot look ahead on is said in words", () => {
  const t = text(F.render(fixture()));
  assert.match(t, /What this cannot look ahead on Credit scores\. UnderwriteIQ reads your scores from a pull\./);
  assert.match(t, /Hard inquiries and late payments\. UnderwriteIQ counts them but has no age window/);
  assert.match(t, /Banking history\./);
});

test("empty: no credit file → 'run your soft pull', one button, to the Setup tab", () => {
  const d = fixture();
  d.has_pull = false;
  const html = F.render(d, { setup: F.withClient("/app/financeos.html#setup", "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e") });
  assert.match(text(html), /No credit file yet — run your soft pull/);
  assert.match(html, /href="\/app\/financeos\.html\?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e#setup"/);
  assert.equal((html.match(/class="fd-btn-primary"/g) || []).length, 1);
  assert.match(F.render(d), /href="\/app\/financeos\.html#setup"/);
  assert.equal(F.isEmpty(null), true);
});

test("one primary button at most: none on the full read-only page", () => {
  assert.equal((F.render(fixture()).match(/fd-btn-primary/g) || []).length, 0);
  assert.equal((F.renderError("server").match(/fd-btn-primary/g) || []).length, 1);
});

test("loading is a skeleton in the real layout; errors say what failed in words", () => {
  assert.match(F.renderLoading(), /aria-busy="true"/);
  assert.match(F.renderLoading(), /fd-sk-chart/);
  assert.match(text(F.renderError("offline")), /could not reach the server/);
  assert.match(text(F.renderError("nodb")), /database is not answering/);
  assert.match(F.renderError("nodb"), /data-act="retry"/);
  assert.equal(F.classify({ status: 401, body: null }), "signin");
  assert.equal(F.classify({ status: 503, body: { db: "down" } }), "nodb");
  assert.equal(F.classify({ status: 200, body: { ok: true } }), "ok");
});

test("FinanceOS section: mount(el, ctx) paints into el through ctx.apiGet, with no page chrome", async () => {
  const section = W.FinanceOS.sections.fundability;
  assert.equal(section.title, "Fundability");
  assert.equal(typeof section.mount, "function");
  const el = { innerHTML: "", listeners: {}, addEventListener(t, f) { this.listeners[t] = f; }, removeEventListener(t) { delete this.listeners[t]; }, contains: () => true };
  const asked = [];
  const handle = section.mount(el, { clientId: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e", apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; } });
  await handle.reload();
  assert.equal(asked[0], "/api/money/fundability?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e");
  assert.match(el.innerHTML, /^<div class="fh-fundability">/);
  assert.match(text(el.innerHTML), /Fundability now 5 of 6/);
  assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
  for (const ev of ["click", "mouseover", "focusin"]) assert.equal(typeof el.listeners[ev], "function", ev);
  handle.unmount();
  assert.equal(el.innerHTML, "");
});

test("a 401 inside the one-page FinanceOS hands sign-in to the host", async () => {
  const section = load().FinanceOS.sections.fundability;
  let signIn = 0;
  const el = { innerHTML: "", addEventListener() {}, removeEventListener() {}, contains: () => true };
  const h = section.mount(el, { apiGet: async () => ({ status: 401, body: null }), onSignIn: () => { signIn += 1; } });
  await h.reload();
  assert.ok(signIn >= 1);
});
