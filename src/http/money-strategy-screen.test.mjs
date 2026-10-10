// /app/money-strategy.html — runs money-strategy.js's own render functions in
// Node against the real read of the test client (src/http/fixtures/
// money-strategy.sample.json: GET /api/money/strategy for f1cb9c27…, read inside
// BEGIN READ ONLY on 2026-10-07 — Plaid sandbox cards and cash, the hand-entered
// Sample Chase Ink and SBA Loan). The plans come from the SAME math module the
// browser loads, so what is checked here is what the page paints.
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import * as math from "../../public/app/money-strategy-math.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-strategy.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-strategy.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-strategy.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-strategy.sample.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const S = W.FHMoneyStrategy;
const fixture = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");
const at = (d, settings) => math.buildPlan(d.inputs, settings);
const S1500 = { method: "avalanche", monthly_cents: 150000, goal: null };

describe("the page", () => {
  test("loads its script and styles, reads /api/money/strategy, keeps out of the staff shell", () => {
    assert.match(HTML, /<script defer src="money-strategy\.js"><\/script>/);
    assert.match(HTML, /<link rel="stylesheet" href="money-strategy\.css">/);
    assert.match(HTML, /id="strategy-root"/);
    assert.match(HTML, /<div class="app">/);
    assert.doesNotMatch(HTML, /src="shell\.js"/);
    assert.doesNotMatch(HTML, /crm-sidebar\.css/);
    assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script, no new dependency");
    assert.match(JS, /"\/api\/money\/strategy"/);
    assert.match(JS, /"\/app\/money-strategy-math\.js"/, "the browser loads the one shared math file");
  });

  test("the shared money nav with Strategy as the one current page", () => {
    const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
    const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
    assert.deepEqual(hrefs, [
      "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
      "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup",
      "/app/money-strategy.html"
    ]);
    assert.match(nav, /href="\/app\/money-strategy\.html" aria-current="page">Strategy</);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  });

  test("no px font sizes on the page; the section has exactly one chart escape hatch", () => {
    const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.deepEqual(css.match(/font-size:\s*\d+px[^;}]*/g) || [], []);
    assert.deepEqual(CSS.match(/font-size:\s*\d+px[^;}]*/g) || [], ["font-size:11px !important"]);
    assert.doesNotMatch(CSS + css, /font:\s*\d/, "no font shorthand with a size");
  });

  test("every section style lives under .fh-strategy", () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const selectors = body.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    assert.ok(selectors.length > 40);
    for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-strategy /, part);
  });

  test("the shadow is the token, never hand-rolled (UI-STANDARDS §12.2)", () => {
    const shadows = CSS.match(/box-shadow:[^;}]+/g) || [];
    assert.deepEqual(shadows, ["box-shadow:var(--panel-shadow)"]);
  });
});

describe("full: the real read at $1,500 a month", () => {
  const d = fixture();
  const plan = at(d, S1500);
  const html = S.render(d, plan, S1500);
  const t = text(html);

  test("the four tiles: debt-free date (at the earliest), interest saved, card use vs targets, cash this month", () => {
    assert.match(t, /Debt-free by Jan 7, 2030 At the earliest\. A rate \(APR\) is missing, so it could take longer\./);
    assert.match(t, /Interest saved vs\. minimums — No rate \(APR\) on file for Sample Chase Ink and SBA Loan\. Add it to see the interest saved\./);
    assert.match(t, /Card use 20\.3% Now\. Under 30% now \(UnderwriteIQ's fundable line\)\. Under 10% by Oct 7, 2027 at the earliest\./);
    assert.match(t, /Cash this month Safe Personal: \$315\.00 of the \$1,530\.55 its cash can cover\. Business: \$1,185\.00 of the \$18,450\.00 its cash can cover\./);
  });

  test("the form: amount, the three methods (one pressed), the goal, and the one primary button", () => {
    assert.match(html, /id="s-range"[^>]*min="122500"/);
    assert.match(html, /id="s-amount"[^>]*value="1,500\.00"/);
    assert.match(t, /Minimum payments: \$1,225\.00 a month\. This month's cash can cover up to \$19,797\.90\./);
    assert.deepEqual([...html.matchAll(/data-method="(\w+)" aria-pressed="(\w+)"/g)].map((m) => [m[1], m[2]]),
      [["avalanche", "true"], ["utilization", "false"], ["snowball", "false"]]);
    assert.match(t, /Highest rate first Card use first Smallest balance first/);
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
    assert.match(html, /<button class="btn-primary" type="button" data-act="save">Save this plan<\/button>/);
    assert.match(t, /Not saved yet\. Saving puts each step on your FinanceOS timeline\./);
  });

  test("each debt in the order the plan pays it, with what is missing said in words", () => {
    assert.match(t, /1 Personal Visa Personal \$1,320\.40 24\.99% \$40\.00 Mar 7, 2027 \$76\.36/);
    assert.match(t, /2 Business Amex Business \$5,400\.00 18\.24% \$135\.00 Apr 7, 2028 \$910\.09/);
    assert.match(t, /3 Sample Chase Ink Business \$2,000\.00 Not on file Not on file Aug 7, 2028 · at the earliest —/);
    assert.match(t, /4 SBA Loan Business \$48,000\.00 Not on file \$1,050\.00 Jan 7, 2030 · at the earliest —/);
    assert.match(t, /Missing No rate \(APR\) on file for Sample Chase Ink and SBA Loan\./);
    assert.match(t, /Missing No minimum payment on file for Sample Chase Ink\. The plan sets nothing aside for it\./);
  });

  test("the card-use chart: all cards plus each card, against 30% and 10%, drawn at the box's width", () => {
    const svg = S.chartSvg(plan, 500);
    assert.match(svg, /viewBox="0 0 500 220"/);
    assert.match(svg, /class="target-label"[^>]*>30% · fundable line</);
    assert.match(svg, /class="target-label"[^>]*>10% · target</);
    assert.equal((svg.match(/class="card-line"/g) || []).length, 3 + 3, "three card lines + three legend keys");
    assert.match(svg, /class="all-line" points="/);
    assert.match(svg, /<title>Under 10% by Oct 7, 2027<\/title>/);
    assert.match(svg, /aria-label="Card use by month: 20\.3% now, under 10% by Oct 7, 2027"/);
    assert.match(text(svg), /All cards Business Amex Sample Chase Ink Personal Visa UnderwriteIQ targets/);
  });

  test("month by month: 24 rows at a time, the money and who gets the extra", () => {
    const rows = (html.match(/<details class="card months-card"[\s\S]*?<\/details>/)[0].match(/<tr>/g) || []).length;
    assert.equal(rows, 1 + 24);
    assert.match(t, /Nov 7, 2026 \$1,500\.00 \$109\.58 \$55,329\.98 19\.5% Personal Visa/);
    assert.match(html, /data-act="more-months">Show 15 more months</);
    assert.match(t, /Interest \(known rates\)/);
  });

  test("how the cash check works: each kind's own cash, bills by name, never added together", () => {
    assert.match(t, /Business cash: \$18,750\.00 in Business Checking\. Bills by Nov 6, 2026: \$300\.00 \(HubSpot Software Subscription \$300\.00 on Nov 4, 2026\)\. It can send up to \$18,450\.00 to business debts this month; this plan sends \$1,185\.00\./);
    assert.match(t, /Personal cash: \$4,210\.55 in Personal Checking\. Bills by Nov 6, 2026: \$2,680\.00/);
    assert.match(t, /Only this month is checked\. Money coming in is not counted yet/);
    assert.match(t, /Personal cash and business cash are never added together\./);
  });

  test("the sources show for staff only", () => {
    assert.doesNotMatch(t, /Staff only · sources/);
    const staff = text(S.render(d, plan, S1500, { staff: true }));
    assert.match(staff, /Staff only · sources: .*src\/banking\/cashflow\.mjs.*src\/underwrite\/vendor\/underwriter\.cjs/);
  });

  test("the server's plan and the browser's recompute are the same numbers", () => {
    const server = FIXTURE.plan;
    const browser = at(d, FIXTURE.defaults);
    for (const k of ["debt_free", "crossings", "milestones", "minimums_cents", "interest_known_cents", "cash"]) {
      assert.deepEqual(JSON.parse(JSON.stringify(browser[k])), server[k], k);
    }
  });
});

describe("the method switch and the goal change the numbers", () => {
  const d = fixture();

  test("card use first sends the extra to Business Amex first, and the order says so", () => {
    const s = { method: "utilization", monthly_cents: 150000, goal: null };
    const t = text(S.render(d, at(d, s), s));
    assert.match(t, /1 Business Amex Business/);
    assert.match(t, /Each card goes down to 10% of its limit, highest card use first\. Then highest APR first\./);
  });

  test("a goal date gives the money a month needed, with a button to use it", () => {
    const s = { method: "avalanche", monthly_cents: 150000, goal: { kind: "debt_free", by: "2028-12-31" } };
    const plan = at(d, s);
    const note = S.renderGoalNote(d, plan, s);
    assert.match(text(note), new RegExp("To get there by Dec 31, 2028 you need \\$[\\d,]+\\.00 a month \\(highest rate first\\)\\."));
    assert.match(note, new RegExp(`data-act="use-amount" data-cents="${plan.goal.monthly_cents}"`));
  });

  test("card use under 30% is already met, said as such", () => {
    const s = { method: "avalanche", monthly_cents: 150000, goal: { kind: "util30", by: "2027-06-30" } };
    assert.match(text(S.renderGoalNote(d, at(d, s), s)), /Card use is already under 30% — UnderwriteIQ's fundable line\./);
  });

  test("a goal with no date asks for one; a date too soon says so", () => {
    assert.match(S.renderGoalNote(d, at(d, S1500), { ...S1500, goal: { kind: "debt_free", by: null } }), /Pick a date for this goal/);
    const soon = { ...S1500, goal: { kind: "debt_free", by: "2026-10-20" } };
    assert.match(text(S.renderGoalNote(d, at(d, soon), soon)), /Pick a date at least one month from today\./);
  });
});

describe("never past the safe amount", () => {
  test("too much for this month's cash: the word, the kind, and a button for the most that is safe", () => {
    const d = fixture();
    d.inputs.cash.by_kind.personal.safe_cents = 12000;
    const plan = at(d, S1500);
    const html = S.render(d, plan, S1500);
    const t = text(html);
    assert.match(html, /class="big status-over">Too much</);
    assert.match(t, /This plan sends \$315\.00 to personal debts this month\. Personal cash can cover \$120\.00\./);
    assert.match(html, /data-act="use-amount" data-cents="130500">Use \$1,305\.00</);
  });

  test("a kind the server could not check shows the projector's refusal in words", () => {
    const d = fixture();
    d.inputs.cash.by_kind.personal = { ok: false, code: "UNKNOWN_BALANCE", message: "The balance of account \"Personal Checking\" is unknown, so the opening balance is unknown. An unknown balance is not zero." };
    const t = text(S.render(d, at(d, S1500), S1500));
    assert.match(t, /Cash this month Partly checked/);
    assert.match(t, /Personal: not checked — The balance of account "Personal Checking" is unknown/);
  });
});

describe("a missing limit is never 'pay to $0'", () => {
  test("a $0-limit card: no card-use target, no 'down to $0', and the missing limit is said", () => {
    const d = fixture();
    const ink = d.inputs.debts.find((x) => x.name === "Sample Chase Ink");
    ink.limit_cents = 0;
    const plan = at(d, S1500);
    const html = S.render(d, plan, S1500);
    assert.doesNotMatch(text(html), /down to \$0/);
    assert.ok(!plan.milestones.some((m) => m.debt_id === ink.id && m.target_pct !== null));
    assert.match(text(html), /No credit limit on file for Sample Chase Ink\. It is left out of card use and gets no card-use target\./);
  });
});

describe("the other three states", () => {
  test("loading is a skeleton in the real layout", () => {
    assert.match(S.renderLoading(), /aria-busy="true"/);
    assert.match(S.renderLoading(), /class="card skel controls"/);
  });

  test("errors say what failed, in words, with a way to try again", () => {
    assert.match(text(S.renderError("offline")), /could not reach the server/);
    assert.match(text(S.renderError("math")), /part of the page that does the math did not load/);
    assert.match(S.renderError("nodb"), /data-act="retry"/);
    assert.doesNotMatch(text(S.renderError("server")), /\b5\d\d\b/, "never a raw status code");
  });

  test("empty: no card or loan with a balance → says so, with one action", () => {
    const d = fixture();
    d.inputs.debts = [];
    const html = S.render(d, at(d, S1500), S1500);
    assert.match(text(html), /No cards or loans with a balance yet/);
    assert.match(html, /<a class="btn-primary" href="\/app\/financeos\.html#accounts">Add an account<\/a>/);
    assert.doesNotMatch(html, /\$NaN|undefined/);
  });

  test("less than the minimums: says so, offers the minimum", () => {
    const d = fixture();
    const s = { method: "avalanche", monthly_cents: 100000, goal: null };
    const html = S.render(d, at(d, s), s);
    assert.match(text(html), /That is less than the minimum payments \(\$1,225\.00 a month\)\. Pick at least that much\./);
    assert.match(html, /data-act="use-amount" data-cents="122500"/);
  });
});

describe("helpers", () => {
  test("money is cents; null is a dash; typed dollars become cents without float maths", () => {
    assert.equal(S.money(150000), "$1,500.00");
    assert.equal(S.money(null), "—");
    assert.equal(S.toCents("1,500.05"), 150005);
    assert.equal(S.toCents("$19.9"), 1990);
    assert.equal(S.toCents("abc"), null);
    assert.equal(S.day("2030-01-07"), "Jan 7, 2030");
    assert.equal(S.pct(20.28), "20.3%");
    assert.equal(S.apr(24.99), "24.99%", "an APR is never rounded to 25%");
    assert.equal(S.apr(12.5), "12.5%");
  });

  test("classify: 401 sign in, 403, offline, no database", () => {
    assert.equal(S.classify({ status: 401, body: null }), "signin");
    assert.equal(S.classify({ status: 403, body: {} }), "forbidden");
    assert.equal(S.classify({ status: 0, body: null }), "offline");
    assert.equal(S.classify({ status: 503, body: { db: "down" } }), "nodb");
    assert.equal(S.classify({ status: 200, body: { ok: true } }), "ok");
  });
});

describe("FinanceOS section", () => {
  test("registered as window.FinanceOS.sections.strategy with a title", () => {
    assert.equal(W.FinanceOS.sections.strategy.title, "Strategy");
    assert.equal(typeof W.FinanceOS.sections.strategy.mount, "function");
  });

  test("mount(el, ctx) reads through ctx.apiGet, runs the shared math, paints with no page chrome", async () => {
    const sandbox = { window: {} };
    vm.runInNewContext(JS, sandbox);
    const section = sandbox.window.FinanceOS.sections.strategy;
    const el = {
      innerHTML: "", listeners: {},
      addEventListener(t, f) { this.listeners[t] = f; },
      removeEventListener(t) { delete this.listeners[t]; },
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => []
    };
    const asked = [];
    const handle = section.mount(el, {
      clientId: "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e",
      math,
      apiGet: async (p) => { asked.push(p); return { status: 200, body: fixture() }; },
      apiPost: async () => ({ status: 200, body: { ok: true } })
    });
    await handle.ready;
    assert.equal(asked[0], "/api/money/strategy?client_id=f1cb9c27-f858-4db1-b6bb-4eddc898bb8e");
    assert.match(el.innerHTML, /^<div class="fh-strategy">/);
    assert.match(text(el.innerHTML), /Debt-free by/);
    assert.match(el.innerHTML, /Staff only · sources/, "a clientId (staff desk) shows the sources");
    assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
    assert.equal(typeof el.listeners.input, "function");
    assert.equal(typeof el.listeners.click, "function");
    handle.unmount();
    assert.equal(el.innerHTML, "");
  });
});
