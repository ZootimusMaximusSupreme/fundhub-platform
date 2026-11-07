// /app/money-alerts.html — runs money-alerts.js's own render functions in Node.
// Organized by unit AL2 (2026-11-07): a switcher for Personal and each business,
// Payments due, Bills and Smart alerts from the GET's `board`, the client's own
// alerts and bills, then Settings (the phone switch and the four texts). Short
// words only: no explanation lines and no disclaimers (owner rule 2026-11-07).
//
// against the real GET /api/money/alerts answer a test pins
// (src/finance/file-alerts/file-alerts.fixture.json, built by the real payload
// builder over the sample client's rows: a Business Amex closing on the 15th
// with a 0% promo ending Dec 6, a hand-entered Personal Visa with no statement
// close day, personal cash short of six months of minimums, business cash
// covered). The states the fixture does not have are the same file with one
// field changed. The mount tests drive the section through ctx.apiGet/apiPost.
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { payoffAtRate } from "../finance/file-alerts/promo.mjs";
import { introCountdown } from "../finance/file-alerts/intro-countdown.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const HTML = fs.readFileSync(path.join(APP, "money-alerts.html"), "utf8");
const JS = fs.readFileSync(path.join(APP, "money-alerts.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-alerts.css"), "utf8");
const FIXTURE = JSON.parse(fs.readFileSync(path.resolve(HERE, "../finance/file-alerts/file-alerts.fixture.json"), "utf8"));

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const A = W.FHMoneyAlerts;
const fx = () => JSON.parse(JSON.stringify(FIXTURE));
const text = (html) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ");
const CID = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const AMEX = "b81cc6c2-dddd-440c-9d5b-ae1c42d5724e";
const VISA = "ef4e1149-3fc5-4e2c-9fa2-331c16da9a17";
const SAMPLE_CO = "5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21";
const BIZ = `biz:${SAMPLE_CO}`;
const SAVINGS = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e1";
const RENT = "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e2";
/* One board section's html (#fa-pay, #fa-bills, #fa-smart). */
function sectionOf(html, id) {
  const start = html.indexOf(`id="${id}"`);
  assert.ok(start > 0, `no section ${id}`);
  const next = html.indexOf("</section>", start);
  return html.slice(start, next);
}
/* The sample with nothing on the board and nothing added: an empty file. */
function emptyBoard(d) {
  d.custom = [];
  d.board = { ...d.board, scopes: d.board.scopes.map((x) => ({ ...x, payments: [], bills: [], smart: [] })) };
  return d;
}
/** One protection card's html, cut out of the whole section. */
function cardOf(html, kind) {
  const start = html.indexOf(`id="fa-k-${kind}"`);
  assert.ok(start > 0, `no card for ${kind}`);
  const next = html.indexOf('<section class="card prot', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

describe("the page", () => {
  test("loads its script and styles, reads /api/money/alerts, keeps out of the staff shell", () => {
    assert.match(HTML, /<script defer src="money-alerts\.js"><\/script>/);
    assert.match(HTML, /<link rel="stylesheet" href="money-alerts\.css">/);
    // The shared bank logo helper (unit H) loads first, so the board's rows can show each bank's own logo.
    assert.match(HTML, /<link rel="stylesheet" href="\/app\/bank-logo\.css">/);
    assert.ok(HTML.indexOf('<script defer src="/app/bank-logo.js"></script>') > 0, "bank-logo.js is on the page");
    assert.ok(HTML.indexOf("/app/bank-logo.js") < HTML.indexOf('src="money-alerts.js"'), "before money-alerts.js");
    assert.ok(HTML.indexOf("/app/bank-logo.css") < HTML.indexOf("/app/fundhub-astra.css"), "before the Astra sheets, which stay last");
    assert.match(HTML, /id="alerts-root"/);
    assert.match(HTML, /<div class="app">/);
    assert.doesNotMatch(HTML, /src="shell\.js"/);
    assert.doesNotMatch(HTML, /crm-sidebar\.css/);
    assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script, no new dependency");
    assert.match(JS, /"\/api\/money\/alerts"/);
    assert.match(HTML, /<title>Fundhub — Alerts<\/title>/);
  });

  test("the shared money nav with Alerts as the one current page", () => {
    const nav = HTML.match(/<nav class="mnav"[\s\S]*?<\/nav>/)[0];
    const hrefs = nav.match(/href="([^"]+)"/g).map((h) => h.slice(6, -1));
    assert.deepEqual(hrefs, [
      "/app/financeos.html#overview", "/app/financeos.html#accounts", "/app/financeos.html#credit",
      "/app/financeos.html#connections", "/app/financeos.html#payments", "/app/financeos.html#setup",
      "/app/money-alerts.html"
    ]);
    assert.match(nav, /href="\/app\/money-alerts\.html" aria-current="page">Alerts</);
    assert.equal((nav.match(/aria-current="page"/g) || []).length, 1);
  });

  test("no px font sizes and no font shorthand with a size (UI-STANDARDS §12.7)", () => {
    const css = HTML.match(/<style>([\s\S]*?)<\/style>/)[1];
    assert.deepEqual(css.match(/font-size:\s*\d+px[^;}]*/g) || [], []);
    assert.deepEqual(CSS.match(/font-size\s*:/g) || [], []);
    assert.doesNotMatch(CSS + css, /font:\s*\d/);
  });

  test("every section style lives under .fh-alerts", () => {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    const selectors = body.replace(/@media[^{]+\{/g, "").split("}").map((r) => r.split("{")[0].trim()).filter(Boolean);
    assert.ok(selectors.length > 60);
    for (const sel of selectors) for (const part of sel.split(",")) assert.match(part.trim(), /^\.fh-alerts( |$)/, part);
  });

  test("the shadow is the token, never hand-rolled (UI-STANDARDS §12.2)", () => {
    assert.deepEqual(CSS.match(/box-shadow:[^;}]+/g) || [], ["box-shadow:var(--panel-shadow)"]);
  });

  test("phone: one column for the cards, the rows, the smart alerts and the two cash boxes; the switcher wraps", () => {
    const phone = CSS.slice(CSS.indexOf("@media (max-width:760px)"));
    assert.match(CSS, /@media \(max-width:1200px\)\{\s*\.fh-alerts \.prots>\*\{grid-column:span 12\}/);
    assert.match(phone, /\.fh-alerts \.row\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(phone, /\.fh-alerts \.cash-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(phone, /\.fh-alerts \.smart-item\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(CSS, /\.fh-alerts \.scopes\{display:flex;flex-wrap:wrap;gap:8px\}/);
  });

  test("every button is at least 44 by 44 (UI-STANDARDS §5): the 40px floor is gone", () => {
    for (const cls of ["btn-primary", "btn-line", "btn-text", "btn-danger", "scope", "switch"]) {
      const rule = CSS.match(new RegExp(`\\.fh-alerts \\.${cls}\\{[^}]*\\}`))[0];
      assert.match(rule, /min-height:44px/, cls);
    }
    assert.doesNotMatch(CSS, /min-height:40px/);
  });
});

describe("full — the sample client", () => {
  const html = A.render(fx(), null, {});
  const t = text(html);

  test("the head is short: Alerts and the two adds; staff also see whose file; the four protections keep the API's order and words", () => {
    assert.match(t, /^ ?Alerts Add alert Add bill /);
    assert.match(text(A.render(fx(), null, { staff: true, clientId: CID })), /^ ?Alerts Sample Client Add alert Add bill /);
    assert.doesNotMatch(t, /We text you before something can hurt your credit file/, "no explanation line under the title");
    const order = [...html.matchAll(/id="fa-k-([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(order, ["payment_timing", "promo_end", "cash_reserve", "new_credit"]);
    for (const [kind, { label }] of Object.entries(FIXTURE.settings.kinds)) {
      assert.match(cardOf(html, kind), new RegExp(`<h2 id="fa-t-${kind}">${label}</h2>`));
    }
  });

  test("each protection has a switch: role=switch, named by its title, on, and the word On", () => {
    const switches = [...html.matchAll(/<button type="button" class="switch" role="switch" aria-checked="(true|false)" aria-labelledby="fa-t-([a-z_]+)" data-act="toggle" data-kind="([a-z_]+)">/g)];
    assert.equal(switches.length, 4);
    for (const m of switches) {
      assert.equal(m[1], "true");
      assert.equal(m[2], m[3]);
    }
    // The four protections live in the grid; the Phone alerts card above it has its own switch (tested below).
    const prots = html.slice(html.indexOf('<div class="grid prots">'));
    assert.equal((prots.match(/<span class="sw-word" aria-hidden="true">On<\/span>/g) || []).length, 4);
  });

  test("no explanation lines (owner rule 2026-11-07); the numbers the settings set still show where they matter", () => {
    assert.doesNotMatch(html, /class="watch"/);
    for (const gone of [/We text you 3 days before, so you can pay it down first/, /We never add them together/,
      /We need it so we can text you before it reports/, /does not count interest/, /Cash counted from/, /the real need may be higher/]) {
      assert.doesNotMatch(t, gone);
    }
    assert.match(text(cardOf(html, "payment_timing")), /The next one goes 3 days before the close after that\./);
    assert.match(text(cardOf(html, "promo_end")), /60 days before Sent 30 days before Nov 6 Next text 7 days before Nov 29/);
    assert.match(text(cardOf(html, "cash_reserve")), /6 months of minimums \$4,296\.12/);
    assert.doesNotMatch(t, /round two/i, "owner-set 2026-10-06: the next funding sequence, never round two");
  });

  test("pay before close: the Business Amex closes Oct 15 in 3 days and was texted today for that close", () => {
    const c = text(cardOf(html, "payment_timing"));
    assert.match(c, /Business Amex ending 4404 Business Statement closes Oct 15 · in 3 days/);
    assert.match(c, /Balance \$5,400\.00 of a \$25,000\.00 limit · 21\.6% used/);
    assert.match(c, /Texted today For the Oct 15 close Closes on the 15th · from your bank/);
    assert.match(c, /Next text Sent for the Oct 15 close\./);
    assert.doesNotMatch(cardOf(html, "payment_timing"), new RegExp(`data-act="edit-day" data-id="${AMEX}"`), "a bank card's day comes from the bank");
  });

  test("the hand-entered Personal Visa is asked for its close day inline, with the reason, first in its card", () => {
    const card = cardOf(html, "payment_timing");
    const ask = card.slice(card.indexOf('class="needs-day"'));
    assert.ok(card.indexOf('class="needs-day"') < card.indexOf('class="next-line'), "the ask comes first in its card");
    assert.match(text(ask), /Needs a day Which day of the month does this card's statement close\?/);
    assert.match(ask, new RegExp(`<label for="fa-cd-${VISA}">Day of the month its statement closes</label><select id="fa-cd-${VISA}" data-cd="${VISA}">`));
    assert.equal((ask.match(/<option value="\d+"/g) || []).length, 31);
    assert.match(ask, /<option value="1">1st<\/option>/);
    assert.match(ask, /<option value="22">22nd<\/option>/);
    assert.match(ask, /<option value="31">31st<\/option>/);
    assert.match(ask, /class="btn-line" data-act="save-days">Save day</, "Add alert is the one filled button");
  });

  test("promo: 0% ends Dec 6, 2026 in 55 days, the API's payoff line, and the 60 / 30 / 7 schedule", () => {
    const card = cardOf(html, "promo_end");
    const c = text(card);
    assert.match(c, /Next text Nov 6 in 25 days · Business Amex ending 4404: 30 days before its promo ends\./);
    assert.match(c, /0% promo ends Dec 6, 2026 · in 55 days/);
    assert.match(c, /Left to pay: \$5,400\.00/);
    assert.match(c, /Pay about \$2,700 a month for the next 2 months to clear it in time\./);
    assert.match(c, /60 days before Sent 30 days before Nov 6 Next text 7 days before Nov 29/);
    assert.match(card, /class="step is-ahead is-next"/);
    assert.match(c, /Added by your Fundhub team on Oct 1, 2026\./);
    assert.match(card, new RegExp(`data-act="edit-promo" data-id="${AMEX}" aria-label="Change promo for Business Amex ending 4404">Change promo<`));
    assert.match(card, new RegExp(`data-act="edit-promo" data-id="${VISA}" aria-label="Add a promo for Personal Visa ending 3303">Add a promo<`));
    assert.ok(card.indexOf(AMEX) < card.indexOf(VISA), "the card with a promo comes first");
  });

  test("cash: personal and business are two checks with their own numbers — and never one added number", () => {
    const card = cardOf(html, "cash_reserve");
    const personal = text(card.slice(card.indexOf('id="fa-cash-personal"'), card.indexOf('id="fa-cash-business"')));
    const business = text(card.slice(card.indexOf('id="fa-cash-business"')));
    assert.match(personal, /Personal cash \$4,210\.55 Short 6 months of minimums \$4,296\.12 Minimums each month \$716\.02 Short by \$85\.57/);
    assert.match(personal, /Minimums include \$650\.00 a month for your Fundhub payment plan\./);
    assert.match(personal, /Texted today\. We text again only after it is covered again and then drops\./);
    assert.match(business, /Business cash \$18,750\.00 Covered 6 months of minimums \$7,920\.00 Minimums each month \$1,320\.00/);
    assert.match(business, /If it drops below \$7,920\.00, we text you\./);
    assert.doesNotMatch(business, /Short by/);
    // personal + business: cash $22,960.55, need $12,216.12, minimums $2,036.02 — none may appear.
    for (const sum of ["$22,960.55", "$12,216.12", "$2,036.02"]) assert.ok(!t.includes(sum), `${sum} is personal + business added`);
  });

  test("texts sent: each card lists its own, with the day, what it was about and the words of the text", () => {
    const pay = text(cardOf(html, "payment_timing"));
    assert.match(pay, /Texts sent Today · Business Amex ending 4404 Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15\./);
    const promo = text(cardOf(html, "promo_end"));
    assert.match(promo, /Texts sent Oct 7 · Business Amex ending 4404 Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 \(in 60 days\)\./);
    const cash = text(cardOf(html, "cash_reserve"));
    assert.match(cash, /Texts sent Today · Personal cash Still open Fundhub alert: your personal cash is \$4,210\.55\./);
    assert.match(cash, /Open until this cash is covered again\./);
    assert.match(text(cardOf(html, "new_credit")), /Texts sent None yet\./);
    assert.match(html, /<time datetime="2026-10-12T07:30:00\.000Z" title="[^"]+">Today<\/time>/, "the exact time is the tooltip");
  });

  test("Needs you lists only what the client can fix; cash that is short is a smart alert with its own See it", () => {
    const needs = text(html.slice(html.indexOf('id="fa-needs-h"'), html.indexOf("</section>", html.indexOf('id="fa-needs-h"'))));
    assert.match(needs, /Needs you Add the statement day for Personal Visa ending 3303\. Add the day/);
    assert.doesNotMatch(needs, /short of/, "a short cushion is not a to-do here");
    assert.match(html, new RegExp(`data-act="jump" data-to="fa-cd-${VISA}">Add the day<`));
    assert.match(sectionOf(html, "fa-smart"), /data-act="jump" data-to="fa-cash-personal">See it</);
    assert.doesNotMatch(html, /class="grid tiles"|Last text/, "the old summary tiles are gone");
  });

  test("new credit says what happens and that the Blueprint client's team gets a task", () => {
    const c = text(cardOf(html, "new_credit"));
    assert.match(c, /Next text The day we find new credit We check every day\./);
    assert.match(c, /Not yours\? Reply to the text\. Your Fundhub team gets a task too\./);
  });

  test("one filled button; every button has a name; every field has a label", () => {
    const open = A.render(fx(), { editPromo: AMEX }, {});
    const form = A.render(fx(), { form: { kind: "bill", id: RENT } }, {});
    assert.match(form, /class="btn-primary" data-act="save-custom">Save bill</);
    assert.doesNotMatch(form, /data-act="add"/, "while the form is open its Save is the one filled button");
    for (const h of [html, open, form]) {
      assert.equal((h.match(/class="btn-primary"/g) || []).length, 1);
      for (const b of h.match(/<button[\s\S]*?<\/button>/g)) {
        const named = /aria-label="[^"]+"/.test(b) || /aria-labelledby="[^"]+"/.test(b) || text(b).trim().length > 0;
        assert.ok(named, b);
        const by = b.match(/aria-labelledby="([^"]+)"/);
        if (by) for (const id of by[1].split(" ")) assert.match(h, new RegExp(`id="${id}"`), `${id} is named but missing`);
      }
      for (const f of h.match(/<(select|input)[^>]*>/g)) {
        const id = (f.match(/ id="([^"]+)"/) || [])[1];
        assert.ok(id && (h.includes(`<label for="${id}">`) || /aria-label="/.test(f)), f);
      }
    }
    assert.match(open, new RegExp(`<label for="fa-pe-${AMEX}">Promo ends on</label>`));
    assert.match(open, new RegExp(`<label for="fa-pa-${AMEX}">Promo rate \\(APR\\)</label>`));
  });

  test("nothing says $NaN, undefined or null", () => {
    assert.doesNotMatch(t, /\$NaN|undefined|null|NaN/);
  });
});

describe("honest states", () => {
  test("unknown is a dash or words, never $0.00", () => {
    assert.equal(A.money(null), "—");
    assert.equal(A.money(undefined), "—");
    assert.equal(A.money(0), "$0.00");
    const d = fx();
    d.cards[0].balance_cents = null;
    d.cards[0].limit_cents = null;
    d.cards[0].used_pct = null;
    d.cards[0].promo.balance_cents = null;
    d.cards[0].promo.payoff = null;
    d.reserve.business = { ...d.reserve.business, state: "unknown", reason: "cash_unknown", cash_cents: null };
    const html = A.render(d, null, {});
    const t = text(html);
    assert.match(t, /Balance — \(not on file\)/);
    assert.match(t, /Left to pay: —/);
    assert.match(t, /We do not have this card's balance, so we cannot work out a monthly amount\./);
    assert.match(text(html.slice(html.indexOf('id="fa-cash-business"'))), /Business cash — Cannot check yet/);
    assert.doesNotMatch(t, /\$0\.00/);
  });

  test("a switched-off alert says Off and no text, where its date would be", () => {
    const d = fx();
    d.settings.kinds.promo_end.enabled = false;
    const html = A.render(d, null, {});
    const card = cardOf(html, "promo_end");
    assert.match(card, /role="switch" aria-checked="false"/);
    assert.match(card, /<span class="sw-word" aria-hidden="true">Off<\/span>/);
    assert.match(text(card), /Next text None This alert is off\./);
    assert.doesNotMatch(card, /is-next/, "no 'next' step while it is off");
  });

  test("STOP: an amber notice in words, no text anywhere, and what already went out still shows", () => {
    const d = fx();
    d.settings.texts_blocked = true;
    const html = A.render(d, null, {});
    const t = text(html);
    assert.match(t, /Texts are off for this phone You replied STOP\. Text START to us to turn texts back on\./);
    assert.match(html, /class="card notice is-warn"/);
    assert.match(t, /Needs you You replied STOP, so we cannot text you\./);
    assert.match(text(cardOf(html, "payment_timing")), /Next text None You replied STOP\./);
    assert.match(text(cardOf(html, "payment_timing")), /Texted today For the Oct 15 close/, "the text that went out is still a fact");
    assert.match(text(cardOf(html, "new_credit")), /Next text None You replied STOP\. Your Fundhub team still gets a task\./);
    assert.match(text(cardOf(html, "cash_reserve")), /Texted today\. No new text\. You replied STOP\./);
    const staff = text(A.render(d, null, { staff: true, clientId: CID }));
    assert.match(staff, /This client replied STOP, so we cannot text them\./);
  });

  test("not on a plan: says no texts go out yet, with the way to set up FinanceOS (client kept for staff)", () => {
    const d = fx();
    d.enrolled = { blueprint: false, finance_os: false, any: false };
    const html = A.render(d, null, { staff: true, clientId: CID });
    assert.match(text(html), /No texts go out yet This client has neither the Capital Blueprint nor a FinanceOS plan, so the daily check skips them\./);
    assert.match(text(A.render(d, null, {})), /No texts go out yet Texts come with the Capital Blueprint or FinanceOS\./);
    assert.match(html, new RegExp(`<a class="btn-line" href="/app/financeos\\.html\\?client_id=${CID}#setup">Set up FinanceOS</a>`));
    assert.match(text(cardOf(html, "promo_end")), /Next text None These texts come with the Capital Blueprint or FinanceOS\./);
    assert.doesNotMatch(text(cardOf(html, "new_credit")), /gets a task/, "no Blueprint, no team task");
  });

  test("a cash check that cannot run says why in the doc's words, per kind", () => {
    const d = fx();
    d.reserve.business = { ...d.reserve.business, state: "unknown", reason: "no_cash_accounts", cash_cents: null, cash_accounts: 0 };
    d.reserve.personal = { ...d.reserve.personal, state: "unknown", reason: "minimums_unknown", minimums_cents: null, need_cents: null, short_cents: null, open_alert_id: null };
    const html = A.render(d, null, {});
    const business = text(html.slice(html.indexOf('id="fa-cash-business"')));
    assert.match(business, /No business checking or savings account linked\./);
    assert.match(business, /We cannot check this yet, so no text goes out\./);
    assert.match(text(html.slice(html.indexOf('id="fa-cash-personal"'))), /Add each card's minimum payment\./);
    assert.match(text(html), /We cannot check your business cash yet\. No business checking or savings account linked\./);
  });

  test("cards and loans not sorted into personal or business are counted in neither check, and said so", () => {
    const d = fx();
    d.reserve.not_counted = { debts: 2, minimums_cents: 9100 };
    const html = A.render(d, null, { staff: true, clientId: CID });
    assert.match(text(cardOf(html, "cash_reserve")), /Not counted 2 cards or loans are not sorted into personal or business yet, so they are in neither check \(\$91\.00 a month in minimums\)\./);
    assert.match(html, new RegExp(`href="/app/financeos\\.html\\?client_id=${CID}#accounts">Sort them in Accounts<`));
  });

  test("empty: nothing to watch, a way to add an account, Add alert still the one filled button, and no board", () => {
    const d = emptyBoard(fx());
    d.cards = [];
    d.alerts = [];
    d.reserve.personal = { state: "unknown", reason: "no_minimums", months: 6, cash_cents: null, cash_is_floor: false, cash_accounts: 0, minimums_cents: null, minimums_is_floor: false, clarity_cents: null, need_cents: null, short_cents: null, open_alert_id: null };
    d.reserve.business = { ...d.reserve.personal };
    assert.equal(A.isEmpty(d), true);
    assert.equal(A.isEmpty(fx()), false);
    const withMine = emptyBoard(fx());
    Object.assign(withMine, { cards: [], alerts: [], reserve: d.reserve, custom: fx().custom });
    assert.equal(A.isEmpty(withMine), false, "an alert the client added is something to watch");
    const html = A.render(d, null, {});
    const t = text(html);
    assert.match(t, /Nothing to watch yet Add an account /, "the heading and the way forward; no explanation line (owner rule 2026-11-07)");
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
    assert.match(html, /class="btn-primary" data-act="add" data-kind="alert">Add alert</);
    assert.match(html, /<a class="btn-line" href="\/app\/financeos\.html#accounts">Add an account<\/a>/);
    assert.doesNotMatch(html, /class="board"/);
    assert.match(text(cardOf(html, "payment_timing")), /No credit cards on file yet\./);
    assert.doesNotMatch(t, /\$NaN|undefined/);
  });

  test("loading is a skeleton in the real layout; errors say what failed in words and offer a retry", () => {
    const l = A.renderLoading();
    assert.match(l, /class="board" aria-busy="true"/);
    assert.match(l, /<h1>Alerts<\/h1>/);
    assert.match(l, /class="grid prots" aria-busy="true"/);
    assert.equal((l.match(/class="card prot skel"/g) || []).length, 4);
    for (const [kind, words] of [
      ["offline", /We could not reach the server\. Check your connection and try again\./],
      ["nodb", /Our database is not answering right now\. Try again in a few minutes\./],
      ["server", /Something went wrong on our side while loading your alerts\./],
      ["forbidden", /This login is not allowed to see these alerts\./],
      ["notfound", /We could not find that client file\./],
      ["needclient", /Open it from a client's file\./]
    ]) {
      const e = A.renderError(kind);
      assert.match(text(e), /We could not load your alerts/);
      assert.match(text(e), words);
      assert.match(e, /class="btn-primary" type="button" data-act="retry">Try again</);
    }
    assert.equal(A.classify({ status: 503, body: { ok: false, db: "down" } }), "nodb");
    assert.equal(A.classify({ status: 0, body: null }), "offline");
    assert.equal(A.classify({ status: 401, body: null }), "signin");
    assert.equal(A.classify({ status: 400, body: { error: "client_id is required and must be a uuid" } }), "needclient");
    assert.equal(A.classify({ status: 200, body: { ok: true } }), "ok");
  });

  test("promo words: one payment left, nothing owed, an ended promo, a rate not given, a staff reader", () => {
    const d = fx();
    const p = d.cards[0].promo;
    Object.assign(p, { days_left: 20, payoff: { payments: 1, monthly_cents: 540000, total_cents: 540000 } });
    assert.match(text(A.render(d, null, {})), /Pay all \$5,400\.00 before Dec 6 to clear it in time\./);
    Object.assign(p, { balance_cents: 0, payoff: null });
    assert.match(text(A.render(d, null, {})), /Nothing is owed on this card, so there is nothing to clear\./);
    const e = fx();
    Object.assign(e.cards[0].promo, { ended: true, days_left: -3, payoff: null, next_alert: null });
    assert.match(text(cardOf(A.render(e, null, {}), "promo_end")), /Ended Its promo ended on Dec 6, 2026\. No more promo texts for it\./);
    const r = fx();
    Object.assign(r.cards[0].promo, { apr_pct: null, source: "client" });
    assert.match(text(A.render(r, null, {})), /Promo rate \(rate not given\) ends Dec 6, 2026/);
    assert.match(text(A.render(r, null, {})), /Added by you on Oct 1, 2026\./);
    assert.match(text(A.render(fx(), null, { staff: true, clientId: CID })), /Added by staff on Oct 1, 2026\./);
    const rate = fx();
    rate.cards[0].promo.apr_pct = 3.99;
    assert.match(text(A.render(rate, null, {})), /3\.99% promo rate ends Dec 6, 2026/);
    assert.doesNotMatch(text(A.render(rate, null, {})), /does not count interest/, "no disclaimer (owner rule 2026-11-07)");
  });

  /* Codex design review (binding): the Settings card says the same amount as the intro
     countdown and the promo text, at the promo rate; with no rate it is only the least. */
  test("promo payoff at the rate: 9.99% says the amount with interest; no rate says at least, never that it clears", () => {
    /* The card's payoff line only: its "Texts sent" keeps the words of the text that went out. */
    const at = (apr, days = 55) => {
      const d = fx();
      const p = d.cards[0].promo;
      Object.assign(p, { apr_pct: apr, days_left: days, payoff: payoffAtRate({ balanceCents: p.balance_cents, daysLeft: days, aprPct: apr }) });
      return text(cardOf(A.render(d, null, {}), "promo_end").match(/<p class="payoff">[\s\S]*?<\/p>/)[0]);
    };
    const plan = payoffAtRate({ balanceCents: 540000, daysLeft: 55, aprPct: 9.99 });
    const dollars = "$" + Math.ceil(plan.monthly_cents / 100).toLocaleString("en-US");
    const rated = at(9.99);
    assert.ok(rated.includes(`Pay about ${dollars} a month for the next 2 months to clear it in time.`), rated);
    assert.doesNotMatch(rated, /\$2,700 a month/, "not the no-interest amount");
    const countdown = introCountdown({ account_id: AMEX, balance_cents: 540000 }, { promo_ends_on: "2026-12-06", promo_apr: "0.09990" }, { today: "2026-10-12" });
    assert.equal(countdown.monthly_cents, plan.monthly_cents, "the intro countdown says the same amount");
    const none = at(null);
    assert.match(none, /At least \$2,700 a month for the next 2 months\. Rate not on file\./);
    assert.doesNotMatch(none, /to clear/);
    assert.match(at(null, 20), /At least \$5,400\.00 before Dec 6\. Rate not on file\./, "one payment left, no rate");
    assert.match(at(0, 20), /Pay all \$5,400\.00 before Dec 6 to clear it in time\./, "0%: the balance clears it");
  });

  test("a promo text inside its 3-day window is due within a day; one whose window passed says so", () => {
    const d = fx();
    // 59 days left: the 60-day mark was yesterday and was not sent — it still goes.
    Object.assign(d.cards[0].promo, { ends_on: "2026-12-10", days_left: 59, alerted_thresholds: [], next_alert: { threshold: 30, on: "2026-11-10" } });
    const steps = A.promoSteps(d, d.cards[0]);
    assert.deepEqual(steps.map((s) => [s.t, s.on, s.state]), [[60, "2026-10-11", "due"], [30, "2026-11-10", "ahead"], [7, "2026-12-03", "ahead"]]);
    assert.deepEqual(A.nextFor(d, "promo_end", {}).when, "soon");
    // 45 days left when typed in: the 60-day mark is long past and is skipped.
    Object.assign(d.cards[0].promo, { ends_on: "2026-11-26", days_left: 45 });
    assert.equal(A.promoSteps(d, d.cards[0])[0].state, "past");
    assert.match(text(cardOf(A.render(d, null, {}), "promo_end")), /60 days before Day passed 30 days before Oct 27 Next text/);
  });

  test("a card with a statement day still to come says when its text goes", () => {
    const d = fx();
    d.cards[1].statement_close_day = 20;
    d.cards[1].pay_before = { next_close_on: "2026-10-20", days_to_close: 8, unknown_reason: null, text_on: "2026-10-17", texted: false, texted_at: null };
    const html = A.render(d, null, {});
    const card = text(cardOf(html, "payment_timing"));
    assert.match(card, /Next text Oct 17 in 5 days · Personal Visa ending 3303: pay it down before Oct 20\./);
    assert.match(card, /Statement closes Oct 20 · in 8 days .* Next text Oct 17 3 days before it closes Closes on the 20th · typed in Change day/);
    assert.doesNotMatch(html, /data-act="save-days"/, "nothing left to ask");
    assert.doesNotMatch(html, /id="fa-needs-h"/, "nothing needs the client, so there is no Needs you");
  });

  test("the texts-sent list shows three, then Show all", () => {
    const d = fx();
    const one = d.alerts[1];
    d.alerts = [0, 1, 2, 3, 4].map((i) => ({ ...one, id: "a" + i, sent_at: `2026-0${9 - (i % 2)}-1${i}T07:30:00.000Z` }));
    const html = A.render(d, null, {});
    const card = cardOf(html, "payment_timing");
    assert.equal((card.match(/class="sent-item"/g) || []).length, 3);
    assert.match(card, /data-act="more" data-kind="payment_timing" aria-expanded="false">Show all 5 texts</);
    const open = cardOf(A.render(d, { expanded: { payment_timing: true } }, {}), "payment_timing");
    assert.equal((open.match(/class="sent-item"/g) || []).length, 5);
    assert.match(open, /aria-expanded="true">Show fewer</);
  });

  test("a promo typed in is checked before it is sent, with the server's own limits", () => {
    const today = "2026-10-12";
    assert.equal(A.checkPromo("2026-12-06", "0", today), null);
    assert.equal(A.checkPromo("2026-10-12", "", today), null, "today is allowed; a blank rate is allowed");
    assert.equal(A.checkPromo("2026-12-06", ".5", today), null);
    assert.deepEqual(A.checkPromo("", "0", today), { field: "ends_on", text: "Pick the day the promo ends." });
    assert.deepEqual(A.checkPromo("2026-10-11", "0", today), { field: "ends_on", text: "That day has passed. Pick today or a later day." });
    assert.deepEqual(A.checkPromo("2026-02-31", "0", today), { field: "ends_on", text: "Pick a real date, like Dec 6, 2026." });
    assert.deepEqual(A.checkPromo("2032-01-01", "0", today), { field: "ends_on", text: "That day is more than 5 years away. Check the year." });
    for (const bad of ["101", "-1", "abc", "1.2.3"]) assert.equal(A.checkPromo("2026-12-06", bad, today).field, "apr_pct", bad);
  });

  test("the server's refusals are said in words, by field", () => {
    const p = (status, body) => A.postProblem({ status, body });
    assert.equal(p(200, { ok: true }), null);
    assert.deepEqual(p(401, null), { signin: true });
    assert.equal(p(0, null).text, "We could not reach the server. Check your connection and try again.");
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "ends_on", message: "that date has already passed" }).text, "That day has passed. Pick today or a later day.");
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "apr_pct", message: "x" }).text, "Type the rate as a number from 0 to 100, like 0 or 3.99.");
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "day", message: "x" }).text, "Pick a day from 1 to 31.");
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "account_id", message: "that card is closed" }).text, "That card is closed, so it cannot get these texts.");
    assert.equal(p(404, { ok: false }).text, "We could not find that card. Reload the page and try again.");
    assert.equal(p(403, { ok: false }).text, "This login is not allowed to change these alerts.");
    assert.equal(p(503, { ok: false, db: "down" }).text, "Our database is not answering right now. Try again in a few minutes.");
  });
});

describe("the section — mount, switches and saves", () => {
  function fakeEl(fields = {}, selects = []) {
    return {
      innerHTML: "", listeners: {},
      addEventListener(t, f) { this.listeners[t] = f; },
      removeEventListener(t) { delete this.listeners[t]; },
      contains: () => true,
      querySelector: (sel) => fields[sel] || null,
      querySelectorAll: (sel) => (sel === "select[data-cd]" ? selects : [])
    };
  }
  function btn(attrs) {
    const b = { getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: () => b };
    return b;
  }
  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
  function section() {
    const sandbox = { window: {} };
    vm.runInNewContext(JS, sandbox);
    return sandbox.window.FinanceOS.sections.alerts;
  }
  const ok = (b) => ({ status: 200, body: { ok: true, action: b.action, saved: b.action === "set_alert" ? { kind: b.kind, enabled: b.enabled } : {} } });

  test("registered as window.FinanceOS.sections.alerts; mount reads through ctx.apiGet, paints with no page chrome", async () => {
    const s = section();
    assert.equal(s.title, "Alerts");
    const el = fakeEl();
    const asked = [];
    const handle = s.mount(el, { clientId: CID, apiGet: async (p) => { asked.push(p); return { status: 200, body: fx() }; }, apiPost: async () => ({ status: 200, body: { ok: true } }) });
    assert.match(el.innerHTML, /aria-busy="true"/, "the skeleton paints first");
    await handle.ready;
    assert.deepEqual(asked, [`/api/money/alerts?client_id=${CID}`]);
    assert.match(el.innerHTML, /^<div class="fh-alerts"><div class="fa-body">/);
    assert.match(el.innerHTML, /<p class="fa-live" role="status" aria-live="polite"><\/p>/);
    assert.match(text(el.innerHTML), /Pay before the statement closes/);
    assert.doesNotMatch(el.innerHTML, /class="mbar"|class="mnav"/);
    assert.equal(typeof handle.reload, "function");
    assert.equal(typeof el.listeners.click, "function");
    handle.unmount();
    assert.equal(el.innerHTML, "");
    assert.equal(el.listeners.click, undefined);
  });

  test("a client session sends no client_id, in the read or the write", async () => {
    const el = fakeEl();
    const asked = [];
    const posts = [];
    const h = section().mount(el, { apiGet: async (p) => { asked.push(p); return { status: 200, body: fx() }; }, apiPost: async (p, b) => { posts.push(b); return ok(b); } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "toggle", "data-kind": "cash_reserve", "aria-checked": "true" }) });
    await flush();
    assert.deepEqual(asked, ["/api/money/alerts"]);
    assert.deepEqual(posts, [{ action: "set_alert", kind: "cash_reserve", enabled: false }]);
  });

  test("a switch posts set_alert with its kind and the flipped value, then paints it off and says so", async () => {
    const el = fakeEl();
    const posts = [];
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => { posts.push([p, b]); return ok(b); } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "toggle", "data-kind": "new_credit", "aria-checked": "true" }) });
    assert.match(cardOf(el.innerHTML, "new_credit"), /aria-busy="true"/, "the switch answers at once");
    await flush();
    assert.deepEqual(posts, [["/api/money/alerts", { action: "set_alert", kind: "new_credit", enabled: false, client_id: CID }]]);
    const card = cardOf(el.innerHTML, "new_credit");
    assert.match(card, /role="switch" aria-checked="false"/);
    assert.match(text(card), /Saved\. This alert is off\. We will not text you about it\./);
    assert.match(text(card), /Next text None This alert is off\./);
    el.listeners.click({ target: btn({ "data-act": "toggle", "data-kind": "new_credit", "aria-checked": "false" }) });
    await flush();
    assert.deepEqual(posts[1][1], { action: "set_alert", kind: "new_credit", enabled: true, client_id: CID });
    assert.match(cardOf(el.innerHTML, "new_credit"), /role="switch" aria-checked="true"/);
  });

  test("a switch that fails stays as it was and says what to do", async () => {
    const el = fakeEl();
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }), apiPost: async () => ({ status: 0, body: null }) });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "toggle", "data-kind": "promo_end", "aria-checked": "true" }) });
    await flush();
    const card = cardOf(el.innerHTML, "promo_end");
    assert.match(card, /role="switch" aria-checked="true"/);
    assert.match(card, /class="msg is-bad"[^>]*>We could not reach the server\. Check your connection and try again\.</);
  });

  test("Save day posts set_statement_close_day with the day picked, then reads the file again", async () => {
    const selects = [{ value: "20", getAttribute: (k) => (k === "data-cd" ? VISA : null) }];
    const el = fakeEl({}, selects);
    const after = fx();
    after.cards[1].statement_close_day = 20;
    // What the real builder answers after that save (fixture server, same rows).
    after.cards[1].pay_before = { next_close_on: "2026-10-20", days_to_close: 8, unknown_reason: null, text_on: "2026-10-17", texted: false, texted_at: null };
    let reads = 0;
    const posts = [];
    const h = section().mount(el, {
      clientId: CID,
      apiGet: async () => { reads += 1; return { status: 200, body: reads === 1 ? fx() : after }; },
      apiPost: async (p, b) => { posts.push([p, b]); return ok(b); }
    });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "save-days" }) });
    await flush();
    assert.deepEqual(posts, [["/api/money/alerts", { action: "set_statement_close_day", account_id: VISA, day: 20, client_id: CID }]]);
    assert.equal(reads, 2, "the new dates come from the server");
    const card = text(cardOf(el.innerHTML, "payment_timing"));
    assert.match(card, /Saved\. We will text you 3 days before it closes\./);
    assert.match(card, /Personal Visa ending 3303 Personal Statement closes Oct 20 · in 8 days/);
    assert.doesNotMatch(el.innerHTML, /data-act="save-days"/);
  });

  test("Save day with no day picked sends nothing and says what to do", async () => {
    const selects = [{ value: "", getAttribute: (k) => (k === "data-cd" ? VISA : null) }];
    const el = fakeEl({}, selects);
    const posts = [];
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => { posts.push(b); return ok(b); } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "save-days" }) });
    await flush();
    assert.deepEqual(posts, []);
    assert.match(text(el.innerHTML), /Pick a day from the list first\./);
  });

  test("Save promo: a past date is stopped before sending; a good one posts set_promo, then reads again", async () => {
    const fields = { [`#fa-pe-${AMEX}`]: { value: "2026-10-01" }, [`#fa-pa-${AMEX}`]: { value: "0" } };
    const el = fakeEl(fields);
    let reads = 0;
    const posts = [];
    const h = section().mount(el, {
      clientId: CID,
      apiGet: async () => { reads += 1; return { status: 200, body: fx() }; },
      apiPost: async (p, b) => { posts.push(b); return ok(b); }
    });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "edit-promo", "data-id": AMEX }) });
    assert.match(el.innerHTML, new RegExp(`<form class="edit" data-form="promo" data-id="${AMEX}" novalidate>`));
    // min is today; max is today + 5 × 366 days, the server's own limit (PROMO_MAX_YEARS_AHEAD).
    assert.match(el.innerHTML, new RegExp(`id="fa-pe-${AMEX}" type="date" min="2026-10-12" max="2031-10-16"`));
    el.listeners.click({ target: btn({ "data-act": "save-promo", "data-id": AMEX }), preventDefault() {} });
    await flush();
    assert.deepEqual(posts, [], "a past date never leaves the page");
    assert.match(el.innerHTML, /aria-invalid="true"/);
    assert.match(text(el.innerHTML), /That day has passed\. Pick today or a later day\./);
    fields[`#fa-pe-${AMEX}`].value = "2027-01-15";
    el.listeners.click({ target: btn({ "data-act": "save-promo", "data-id": AMEX }), preventDefault() {} });
    await flush();
    assert.deepEqual(posts, [{ action: "set_promo", account_id: AMEX, ends_on: "2027-01-15", apr_pct: 0, client_id: CID }]);
    assert.equal(reads, 2);
    assert.match(text(el.innerHTML), /Saved\. The promo texts are set for this card\./);
    assert.doesNotMatch(el.innerHTML, /data-form="promo"/, "the form closes");
  });

  test("Save promo: the server's refusal shows in words next to the field", async () => {
    const fields = { [`#fa-pe-${AMEX}`]: { value: "2026-12-06" }, [`#fa-pa-${AMEX}`]: { value: "50" } };
    const el = fakeEl(fields);
    const h = section().mount(el, {
      clientId: CID,
      apiGet: async () => ({ status: 200, body: fx() }),
      apiPost: async () => ({ status: 400, body: { ok: false, error: "invalid_input", field: "apr_pct", message: "apr_pct must be a percent from 0 to 100 (0 for a 0% promo)" } })
    });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "edit-promo", "data-id": AMEX }) });
    el.listeners.click({ target: btn({ "data-act": "save-promo", "data-id": AMEX }), preventDefault() {} });
    await flush();
    assert.match(el.innerHTML, new RegExp(`id="fa-pa-${AMEX}"[^>]*aria-invalid="true"`));
    assert.match(text(el.innerHTML), /Type the rate as a number from 0 to 100, like 0 or 3\.99\./);
  });

  test("Remove promo asks first, naming what stops, then posts ends_on null", async () => {
    const el = fakeEl({ [`#fa-pe-${AMEX}`]: { value: "2026-12-06" }, [`#fa-pa-${AMEX}`]: { value: "0" } });
    const posts = [];
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => { posts.push(b); return ok(b); } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "edit-promo", "data-id": AMEX }) });
    el.listeners.click({ target: btn({ "data-act": "ask-remove", "data-id": AMEX }) });
    assert.match(text(el.innerHTML), /Remove the promo on Business Amex ending 4404\? Its promo texts stop\. Yes, remove it Keep it/);
    assert.deepEqual(posts, []);
    el.listeners.click({ target: btn({ "data-act": "remove-promo", "data-id": AMEX }) });
    await flush();
    assert.deepEqual(posts, [{ action: "set_promo", account_id: AMEX, ends_on: null, client_id: CID }]);
    assert.match(text(el.innerHTML), /Removed\. No more promo texts for this card\./);
  });

  test("a 401 on the read hands off to sign-in instead of painting", async () => {
    const el = fakeEl();
    let signedOut = 0;
    const h = section().mount(el, { apiGet: async () => ({ status: 401, body: null }), onSignIn: () => { signedOut += 1; } });
    await h.ready;
    assert.equal(signedOut, 1);
  });

  /* ── phone alerts (unit D) ── */
  const BILL_GWS = "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e01";
  const BILL_QBO = "9e3c1f0a-4b2d-4c8e-9f11-2a3b4c5d6e02";
  const phoneOk = (b) => ({ status: 200, body: { ok: true, action: b.action,
    saved: b.action === "set_bill_important" ? { bill_id: b.bill_id, important: b.important } : { phone_alerts: b.enabled } } });

  /* What the server answers after a bill's phone alert is turned on: the bill and its board row. */
  const marked = (d, id, on) => {
    d.bills.forEach((b) => { if (b.id === id) b.important = on; });
    d.board.scopes.forEach((sc) => sc.bills.forEach((r) => { if (r.bill_id === id) { r.important = on; r.phone = { ...r.phone, on }; } }));
    return d;
  };

  test("the phone alert switch on a found bill posts set_bill_important with that bill and reads the dates again", async () => {
    const el = fakeEl();
    const posts = [];
    let reads = 0;
    const h = section().mount(el, {
      clientId: CID,
      apiGet: async () => { reads += 1; return { status: 200, body: reads > 1 ? marked(fx(), BILL_QBO, true) : fx() }; },
      apiPost: async (p, b) => { posts.push([p, b]); return phoneOk(b); }
    });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "scope", "data-scope": BIZ }) });
    el.listeners.click({ target: btn({ "data-act": "toggle-bill", "data-id": BILL_QBO, "aria-checked": "false" }) });
    assert.match(el.innerHTML, /aria-busy="true"/, "the switch answers at once");
    await flush();
    assert.deepEqual(posts, [["/api/money/alerts", { action: "set_bill_important", bill_id: BILL_QBO, important: true, client_id: CID }]]);
    assert.equal(reads, 2, "the dates come from the server");
    assert.match(text(el.innerHTML), /Phone alert on\. It goes 3 days before it charges\./);
    assert.match(el.innerHTML, new RegExp(`aria-checked="true" aria-label="Phone alert for QuickBooks Online" data-act="toggle-bill" data-id="${BILL_QBO}"`));
  });

  test("turning a found bill's phone alert off says so; a 404 says the bill was not found", async () => {
    const el = fakeEl();
    const h = section().mount(el, { apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => phoneOk(b) });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "scope", "data-scope": BIZ }) });
    el.listeners.click({ target: btn({ "data-act": "toggle-bill", "data-id": BILL_GWS, "aria-checked": "true" }) });
    await flush();
    assert.match(text(el.innerHTML), /Phone alert off\./);

    const el2 = fakeEl();
    const h2 = section().mount(el2, { apiGet: async () => ({ status: 200, body: fx() }),
      apiPost: async () => ({ status: 404, body: { ok: false, error: "invalid_input", field: "bill_id", message: "no such bill" } }) });
    await h2.ready;
    el2.listeners.click({ target: btn({ "data-act": "scope", "data-scope": BIZ }) });
    el2.listeners.click({ target: btn({ "data-act": "toggle-bill", "data-id": BILL_GWS, "aria-checked": "true" }) });
    await flush();
    assert.match(text(el2.innerHTML), /We could not find that bill\. Reload the page and try again\./);
  });

  test("the phone switch posts set_phone_alerts and turns every phone alert off on the screen", async () => {
    const el = fakeEl();
    const posts = [];
    const h = section().mount(el, { apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => { posts.push(b); return phoneOk(b); } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "toggle-phone", "aria-checked": "true" }) });
    await flush();
    assert.deepEqual(posts, [{ action: "set_phone_alerts", enabled: false }]);
    const phone = el.innerHTML.slice(el.innerHTML.indexOf('id="fa-phone"'), el.innerHTML.indexOf('<div class="grid prots">'));
    assert.match(phone, /data-act="toggle-phone"/);
    assert.match(phone, /role="switch" aria-checked="false" aria-labelledby="fa-t-phone"/);
    assert.match(text(phone), /Saved\. Phone alerts are off\./);
    assert.doesNotMatch(text(phone), /We will not buzz your phone/, "short client words (owner rule 2026-11-07)");
    assert.doesNotMatch(phone, /class="badge word-ok">On</, "no phone alert says On once they are off");
  });
});

describe("phone alerts card — the settings", () => {
  const phoneHtml = (d, opts = {}) => A.renderPhone(d, null, opts);

  test("the sample: the switch, the phone, every kind on (the two added kinds too), and what went", () => {
    const t = text(phoneHtml(fx()));
    assert.match(t, /^ ?Phone alerts On A buzz before each payment\. No amounts on the lock screen\. Phone set up\./, "one line opens the card (QA21)");
    assert.match(t, /Phone set up\. Alerts go out 9 a\.m\. to 5 p\.m\. Arizona time\./);
    for (const gone of [/We buzz your phone/, /each loan and line of credit/, /Tap it to open these alerts/]) assert.doesNotMatch(t, gone, "no 4-sentence paragraph");
    assert.match(t, /On Card payment due On Statement closes On Important bill On Loan payment due On Credit line payment due On Payment plan due On Alert you added On Bill you added/);
    assert.match(t, /Phone alerts sent .* Important bill · Google Workspace · Oct 14 Waiting for 9 a\.m\./);
    assert.match(t, /Alert you added · Move money to savings · Oct 14 Waiting for 9 a\.m\./);
    assert.doesNotMatch(t, /lock screen never shows/, "no disclaimer line (owner rule 2026-11-07)");
  });

  test("honest states: no phone, STOP, switched off, a failed phone read", () => {
    const noPhone = fx(); noPhone.phone.has_phone = false;
    assert.match(text(phoneHtml(noPhone)), /Turn on notifications on your phone first\. Set up my phone/);
    assert.match(phoneHtml(noPhone), /href="\/app\/client-portal\.html#push-card"/);
    assert.doesNotMatch(phoneHtml(noPhone, { staff: true, clientId: CID }), /Set up my phone/, "staff get no button they cannot use");

    const stop = fx(); stop.phone.opted_out = true;
    const st = text(phoneHtml(stop));
    assert.match(st, /You replied STOP, so no phone alerts go\./);
    assert.match(st, /Off Card payment due Off Statement closes Off Important bill/);

    const off = fx(); off.phone.enabled = false;
    assert.match(text(phoneHtml(off)), /Phone alerts are off\./);

    const unread = fx(); unread.phone.has_phone = null;
    assert.match(text(phoneHtml(unread)), /We could not check for a phone\. Try again soon\./);
  });

  test("the statement push follows the pay-before-close switch", () => {
    const d = fx(); d.settings.kinds.payment_timing.enabled = false;
    assert.equal(A.phoneKindOn(d, "statement_close"), false);
    assert.equal(A.phoneKindOn(d, "card_due"), true);
    assert.match(text(phoneHtml(d)), /Off Statement closes/);
  });

  test("every payment (D2) is on the board: the SBA loan's alert day in the business, the late Fundhub plan in Personal", () => {
    const personal = text(sectionOf(A.render(fx(), null, {}), "fa-pay"));
    assert.match(personal, /Payment plan with Fundhub LLC Due Oct 3 · \$650\.00 left Late/);
    const biz = text(sectionOf(A.render(fx(), { scope: BIZ }, {}), "fa-pay"));
    assert.match(biz, /SBA Loan Due Nov 1 · \$1,050\.00 Alert Oct 29/);
    assert.match(biz, /Business Amex ending 4404 Due Oct 15 · \$270\.00 min · Closes Oct 15 No alert yet/);
  });

  test("the one phone switch off, or a STOP, turns every row's alert off on the board at once", () => {
    for (const set of [(d) => { d.phone.enabled = false; }, (d) => { d.phone.opted_out = true; }]) {
      const d = fx(); set(d);
      const biz = A.render(d, { scope: BIZ }, {});
      assert.match(text(sectionOf(biz, "fa-pay")), /SBA Loan Due Nov 1 · \$1,050\.00 Alert off/);
      assert.doesNotMatch(sectionOf(biz, "fa-pay") + sectionOf(biz, "fa-bills"), /Alert Oct 29|Alert today/);
    }
  });

  test("an answer with no phone block (an older server) paints no phone card", () => {
    const d = fx(); delete d.phone;
    assert.equal(phoneHtml(d), "");
  });

  test("the phone card has no px font size and every control is a real button or link", () => {
    assert.doesNotMatch(CSS.slice(CSS.indexOf("phone alerts (unit D)")), /font-size\s*:\s*\d+px/);
    const html = phoneHtml(fx());
    for (const m of html.matchAll(/data-act="([a-z-]+)"/g)) assert.ok(["toggle-phone", "more"].includes(m[1]), m[1]);
  });
});

/* ── unit AL2: the organized board, the smart alerts, and the client's own alerts and bills ── */
describe("the board — Personal and each business", () => {
  test("Personal shows first: its payments, no bills, and the cash smart alert; the business shows its own", () => {
    const html = A.render(fx(), null, {});
    assert.match(html, /data-act="scope" data-scope="personal" aria-pressed="true">Personal</);
    assert.match(html, new RegExp(`data-act="scope" data-scope="${BIZ}" aria-pressed="false">Sample Co LLC<`));
    assert.match(text(sectionOf(html, "fa-pay")), /Payments due 3 Payment plan with Fundhub LLC .* Move money to savings Oct 14 · Every month Alert today Edit Personal Visa ending 3303 Due Oct 25 · \$66\.02 min · No close day No alert yet/);
    assert.match(text(sectionOf(html, "fa-bills")), /Bills No bills yet\./);
    assert.match(text(sectionOf(html, "fa-smart")), /Smart alerts 2 Pay by Oct 23 Personal Visa ending 3303 Pay \$520\.40 to get under 10%\. Due Oct 25\. Cash low Personal cash \$4,210\.55 of a \$4,296\.12 cushion\. Short \$85\.57\. See it/);
    const biz = A.render(fx(), { scope: BIZ }, {});
    assert.match(biz, new RegExp(`data-scope="${BIZ}" aria-pressed="true"`));
    assert.doesNotMatch(sectionOf(biz, "fa-pay"), /Move money to savings/, "a personal alert is not in the business");
    assert.match(text(sectionOf(biz, "fa-bills")), /Google Workspace \$72\.00 · Every month · Next Oct 14 Alert today .*QuickBooks Online \$90\.00 · Every month · Next Oct 28 .*Office rent Added \$1,200\.00 · Every month · Next Nov 1 Alert Oct 29/);
    assert.match(sectionOf(biz, "fa-bills"), new RegExp(`aria-checked="true" aria-label="Phone alert for Office rent" data-act="toggle-custom" data-id="${RENT}"`));
    assert.match(sectionOf(biz, "fa-bills"), new RegExp(`data-act="edit-custom" data-id="${RENT}"`));
    assert.doesNotMatch(sectionOf(biz, "fa-bills"), /data-act="edit-custom" data-id="9e3c/, "a bill the detector found is not edited here");
  });

  test("the smart alerts say one short fact each, in the server's order", () => {
    const t = text(sectionOf(A.render(fx(), { scope: BIZ }, {}), "fa-smart"));
    assert.match(t, /Smart alerts 4 Charged twice Google Workspace \$72\.00, 2 times, Sep 14\. Pay by Oct 13 Business Amex ending 4404 Pay \$2,900\.00 to report under 10%\. Closes Oct 15\. Price went up QuickBooks Online \$80\.00 to \$90\.00 on Sep 28\. Seasoned in 18 days Chase Opened Sep 30\. Seasoned Oct 30\./);
    const d = fx();
    const pay = d.board.scopes[1].smart.find((s) => s.kind === "pay_by");
    Object.assign(pay, { tight: true, on: "2026-10-12" });
    assert.match(text(sectionOf(A.render(d, { scope: BIZ }, {}), "fa-smart")), /Pay today Business Amex ending 4404/);
  });

  test("Pay by is one Smart alert per card: over 10% is a warning with what to pay; under 10% is calm, with its day only", () => {
    const smart = sectionOf(A.render(fx(), null, {}), "fa-smart");
    assert.match(smart, /<li class="smart-item is-pay_by"><span class="badge word-warn">Pay by Oct 23<\/span>/, "the Visa is over 10%");
    const d = fx();
    const visa = d.board.scopes[0].smart.find((s) => s.kind === "pay_by");
    Object.assign(visa, { over: false, pay_cents: null, used_pct: 8 });
    const calm = sectionOf(A.render(d, null, {}), "fa-smart");
    assert.match(calm, /<span class="badge word-ok">Pay by Oct 23<\/span>/);
    assert.match(text(calm), /Pay by Oct 23 Personal Visa ending 3303 Due Oct 25\. Cash low/);
    assert.doesNotMatch(text(calm), /under 10%/, "nothing to pay down, so no amount");
    // Its day from the statement close instead: it says the close.
    Object.assign(visa, { for: "statement_close", close_on: "2026-10-25", due_on: "2026-11-02" });
    assert.match(text(sectionOf(A.render(d, null, {}), "fa-smart")), /Pay by Oct 23 Personal Visa ending 3303 Closes Oct 25\./);
    // Pay today: still calm for a close when the card is under 10%; a warning when a payment is about to be due.
    Object.assign(visa, { tight: true, on: "2026-10-12", close_on: "2026-10-13" });
    assert.match(sectionOf(A.render(d, null, {}), "fa-smart"), /<span class="badge word-ok">Pay today<\/span>/);
    Object.assign(visa, { for: "due_date", close_on: null, due_on: "2026-10-13" });
    assert.match(sectionOf(A.render(d, null, {}), "fa-smart"), /<span class="badge word-warn">Pay today<\/span>/);
    assert.match(text(sectionOf(A.render(d, null, {}), "fa-smart")), /Pay today Personal Visa ending 3303 Due Oct 13\./);
    // "Pay by" shows nowhere else on the board.
    const all = text(A.render(fx(), null, {}));
    assert.equal((all.match(/Pay by /g) || []).length, 1, "one card in Personal, one Pay by");
  });

  test("a bank's own logo shows beside its row and its Pay by, through the shared helper; no logo, no picture", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(fs.readFileSync(path.join(APP, "bank-logo.js"), "utf8"), sandbox);
    vm.runInNewContext(JS, sandbox);
    const L = sandbox.window.FHMoneyAlerts;
    const d = fx();
    const biz = d.board.scopes[1];
    const logo = "/assets/lenders/american-express.png";
    biz.payments.find((p) => p.account_id === AMEX).logo = logo;
    biz.smart.find((s) => s.kind === "pay_by").logo = logo;
    const html = L.render(d, { scope: BIZ }, {});
    const img = '<img class="fh-bank-logo" src="/assets/lenders/american-express.png" alt="First Platypus Bank logo"';
    assert.ok(sectionOf(html, "fa-pay").includes(img), "the Amex row");
    assert.ok(sectionOf(html, "fa-smart").includes(img), "the Amex Pay by");
    assert.match(sectionOf(html, "fa-smart"), /<img class="fh-bank-logo" src="\/assets\/lenders\/chase\.png" alt="Chase logo"/, "the seasoning row's bank book file");
    assert.equal((sectionOf(html, "fa-pay").match(/<img /g) || []).length, 1, "the SBA loan has no logo, so no picture");
  });

  test("a business cash alert names that business and has no jump to the all-business box", () => {
    const d = fx();
    d.board.scopes[1].smart.push({ id: "cash_low:x", kind: "cash_low", name: null, on: null, cash_cents: 100000, need_cents: 354000, short_cents: 254000, months: 6, minimums_is_floor: false });
    const smart = sectionOf(A.render(d, { scope: BIZ }, {}), "fa-smart");
    assert.match(text(smart), /Cash low Sample Co LLC cash \$1,000\.00 of a \$3,540\.00 cushion\. Short \$2,540\.00\./);
    assert.doesNotMatch(smart, /data-act="jump"/, "the per-business check has no box of its own to open");
  });

  test("honest states: one scope means no switcher; a read that failed is said, never shown as none; nothing on a board is said in words", () => {
    const one = fx();
    one.board.scopes = [one.board.scopes[0]];
    assert.doesNotMatch(A.render(one, null, {}), /data-act="scope"/);
    const unread = fx();
    unread.board.checks.bills = false;
    unread.board.checks.custom = false;
    const biz = A.render(unread, { scope: BIZ }, {});
    assert.match(text(sectionOf(biz, "fa-bills")), /We could not load your bills\. Try again soon\./);
    assert.match(text(sectionOf(biz, "fa-bills")), /We could not load what you added\. Try again soon\./);
    const quiet = emptyBoard(fx());
    const q = A.render(quiet, null, {});
    assert.match(text(sectionOf(q, "fa-pay")), /Payments due Nothing due\./);
    assert.match(text(sectionOf(q, "fa-smart")), /Smart alerts All clear\./);
    const unknown = fx();
    unknown.board.scopes.push({ key: "unknown", kind: "unknown", name: "Not sorted yet", entity_id: null, payments: [], bills: [], smart: [] });
    assert.match(text(A.render(unknown, { scope: "unknown" }, { staff: true, clientId: CID })), /Sort these into personal or business\. Open Accounts/);
  });

  test("no board in the answer (an older server, or a demo without it): no board, and the rest still paints", () => {
    const d = fx();
    delete d.board;
    const html = A.render(d, null, {});
    assert.doesNotMatch(html, /class="board"/);
    assert.match(html, /id="fa-k-payment_timing"/);
    assert.doesNotMatch(text(html), /undefined|NaN/);
  });

  test("no 'Coming up' heading anywhere, and nothing says null, undefined or NaN", () => {
    for (const ui of [null, { scope: BIZ }, { form: { kind: "alert", id: null } }, { form: { kind: "bill", id: RENT } }]) {
      const t = text(A.render(fx(), ui, {}));
      assert.doesNotMatch(t, /Coming up/);
      assert.doesNotMatch(t, /\$NaN|undefined|null|NaN/);
    }
  });
});

describe("the form — an alert or a bill the client adds", () => {
  test("Add alert: name, an optional amount, Repeats (monthly or once), the day or the date, who it is for, the phone switch", () => {
    const html = A.render(fx(), { form: { kind: "alert", id: null } }, {});
    const t = text(html);
    assert.match(t, /Add alert Name Amount \(optional\) \$ Repeats Every month One time Day of the month Pick a day/);
    assert.match(html, /<select id="fa-cf-for" name="target"><option value="personal" selected>Personal<\/option><option value="biz:5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21">Sample Co LLC<\/option><\/select>/);
    assert.match(html, /id="fa-cf-phone" role="switch" aria-checked="true"/);
    const once = A.render(fx(), { form: { kind: "alert", id: null, draft: { name: "Tax", amount: "", cadence: "once", day: "", date: "", target: "personal", phone: true } } }, {});
    assert.match(once, /<label for="fa-cf-date">Date<\/label><input id="fa-cf-date" name="date" type="date" value="" min="2026-10-12">/);
    assert.match(once, /value="Tax"/, "a draft is kept across a repaint");
  });

  test("Add bill from the business picks that business; Edit fills the saved values and offers Remove, which asks first", () => {
    const add = A.render(fx(), { scope: BIZ, form: { kind: "bill", id: null } }, {});
    assert.match(text(add), /Add bill Name Amount \$ How often Every month Every week Every 2 weeks Every year/);
    assert.match(add, /<option value="biz:5b0c7e1a-3d2f-4a6b-9c8d-7e6f5a4b3c21" selected>Sample Co LLC<\/option>/);
    const edit = A.render(fx(), { form: { kind: "bill", id: RENT } }, {});
    assert.match(edit, /<h2 id="fa-cf-h">Edit bill<\/h2>/);
    assert.match(edit, /id="fa-cf-name" name="name" type="text" maxlength="80" autocomplete="off" value="Office rent"/);
    assert.match(edit, /id="fa-cf-amount" name="amount" type="text" inputmode="decimal" autocomplete="off" value="1200\.00"/);
    assert.match(edit, /<option value="1" selected>1st<\/option>/);
    assert.match(edit, new RegExp(`data-act="ask-remove-custom" data-id="${RENT}">Remove this bill<`));
    const ask = A.render(fx(), { form: { kind: "bill", id: RENT }, askRemoveCustom: RENT }, {});
    assert.match(text(ask), /Remove Office rent\? Its phone alerts stop\. Yes, remove it Keep it/);
  });

  test("checkCustom: the server's own limits, by field, before anything is sent", () => {
    const today = "2026-10-12";
    const ok = (kind, v) => A.checkCustom(kind, { name: "Rent", amount: "1,200.50", cadence: "monthly", day: "1", date: "", target: "personal", phone: true, ...v }, today);
    assert.deepEqual(ok("bill", {}).body, { kind: "bill", name: "Rent", amount_cents: 120050, cadence: "monthly", phone_alert: true, day_of_month: 1, scope: "personal" });
    assert.deepEqual(ok("alert", { amount: "", target: BIZ }).body, { kind: "alert", name: "Rent", amount_cents: null, cadence: "monthly", phone_alert: true,
      day_of_month: 1, scope: "business", entity_id: SAMPLE_CO });
    assert.deepEqual(ok("bill", { cadence: "weekly", date: "2026-09-15", target: "business" }).body.scope, "business");
    for (const [kind, v, field] of [
      ["alert", { name: "  " }, "name"],
      ["alert", { name: "x".repeat(81) }, "name"],
      ["bill", { amount: "" }, "amount_cents"],
      ["bill", { amount: "12.345" }, "amount_cents"],
      ["bill", { amount: "0" }, "amount_cents"],
      ["alert", { amount: "abc" }, "amount_cents"],
      ["bill", { cadence: "once" }, "cadence"],
      ["alert", { day: "" }, "day_of_month"],
      ["alert", { cadence: "once", date: "2026-10-11" }, "start_on"],
      ["alert", { cadence: "once", date: "2026-02-31" }, "start_on"],
      ["bill", { cadence: "annual", date: "2032-01-01" }, "start_on"]
    ]) assert.equal(A.checkCustom(kind, { name: "Rent", amount: "10", cadence: "monthly", day: "1", date: "", target: "personal", phone: true, ...v }, today).field, field, JSON.stringify(v));
    assert.equal(A.dollarsToCents("$1,234.5"), 123450);
    assert.equal(A.dollarsToCents(".99"), 99);
    assert.equal(A.dollarsToCents("1.234"), null);
    assert.equal(A.dollarsToCents("-5"), null);
  });

  test("the server's refusals for the form are said in words, by field", () => {
    const p = (status, body) => A.postProblem({ status, body });
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "start_on", message: "that date has already passed" }).text, "That day has passed. Pick today or a later day.");
    assert.equal(p(400, { ok: false, error: "invalid_input", field: "kind", message: "you can keep up to 100 alerts and bills; remove one first" }).text,
      "You have the most alerts and bills you can keep. Remove one first.");
    assert.deepEqual(p(404, { ok: false, error: "invalid_input", field: "entity_id", message: "no such business" }), { field: "entity_id", text: "Pick who it is for from the list." });
    assert.deepEqual(p(404, { ok: false, error: "invalid_input", field: "id", message: "no such alert or bill" }), { field: "id", text: "We could not find that one. Reload the page and try again." });
  });
});

describe("the section — the board's own controls", () => {
  function fakeEl(fields = {}) {
    return {
      innerHTML: "", listeners: {},
      addEventListener(t, f) { this.listeners[t] = f; },
      removeEventListener(t) { delete this.listeners[t]; },
      contains: () => true,
      querySelector: (sel) => fields[sel] || null,
      querySelectorAll: () => []
    };
  }
  function btn(attrs) {
    const b = { getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = v; }, closest: () => b };
    return b;
  }
  const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  function section() {
    const sandbox = { window: {} };
    vm.runInNewContext(JS, sandbox);
    return sandbox.window.FinanceOS.sections.alerts;
  }
  /* The form's fields as a page would hold them after typing. */
  function formFields(v) {
    const phone = btn({ "aria-checked": v.phone === false ? "false" : "true", "data-act": "form-phone" });
    return {
      '[data-form="custom"]': {}, "#fa-cf-name": { value: v.name }, "#fa-cf-amount": { value: v.amount }, "#fa-cf-cadence": { value: v.cadence },
      ...(v.cadence === "monthly" ? { "#fa-cf-day": { value: v.day } } : { "#fa-cf-date": { value: v.date } }),
      "#fa-cf-for": { value: v.target }, '[data-act="form-phone"]': phone
    };
  }

  test("picking a scope repaints with it pressed; nothing is sent", async () => {
    const el = fakeEl();
    const posts = [];
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }), apiPost: async (p, b) => { posts.push(b); return { status: 200, body: { ok: true } }; } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "scope", "data-scope": BIZ }) });
    assert.match(el.innerHTML, new RegExp(`data-scope="${BIZ}" aria-pressed="true"`));
    assert.match(text(el.innerHTML), /Office rent/);
    assert.deepEqual(posts, []);
  });

  test("Add alert, then Save: posts add_custom with what was typed, reads again, closes the form and shows where it went", async () => {
    const fields = formFields({ name: " Pay Dana ", amount: "250", cadence: "monthly", day: "20", target: BIZ, phone: true });
    const el = fakeEl(fields);
    const posts = [];
    let reads = 0;
    const saved = { id: "c0a1e2d3-4b5c-4d6e-8f70-81a2b3c4d5e9", kind: "alert", name: "Pay Dana", scope: "business", entity_id: SAMPLE_CO };
    const h = section().mount(el, {
      clientId: CID,
      apiGet: async () => { reads += 1; return { status: 200, body: fx() }; },
      apiPost: async (p, b) => { posts.push([p, b]); return { status: 200, body: { ok: true, action: b.action, saved } }; }
    });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "add", "data-kind": "alert" }) });
    assert.match(el.innerHTML, /<h2 id="fa-cf-h">Add alert<\/h2>/);
    el.listeners.click({ target: btn({ "data-act": "save-custom" }), preventDefault() {} });
    await flush();
    assert.deepEqual(posts, [["/api/money/alerts", { kind: "alert", name: "Pay Dana", amount_cents: 25000, cadence: "monthly", phone_alert: true,
      day_of_month: 20, scope: "business", entity_id: SAMPLE_CO, action: "add_custom", client_id: CID }]]);
    assert.equal(reads, 2, "the board comes from the server again");
    assert.doesNotMatch(el.innerHTML, /data-form="custom"/, "the form closes");
    assert.match(el.innerHTML, new RegExp(`data-scope="${BIZ}" aria-pressed="true"`), "the business it went to is shown");
  });

  test("a bad value is stopped before sending and named; the server's refusal shows under the form", async () => {
    const fields = formFields({ name: "Gym", amount: "", cadence: "monthly", day: "5", target: "personal", phone: true });
    const el = fakeEl(fields);
    const posts = [];
    const h = section().mount(el, { apiGet: async () => ({ status: 200, body: fx() }),
      apiPost: async (p, b) => { posts.push(b); return { status: 400, body: { ok: false, error: "invalid_input", field: "name", message: "name is required" } }; } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "add", "data-kind": "bill" }) });
    el.listeners.click({ target: btn({ "data-act": "save-custom" }), preventDefault() {} });
    await flush();
    assert.deepEqual(posts, [], "a bill with no amount never leaves the page");
    assert.match(el.innerHTML, /id="fa-cf-amount"[^>]*aria-invalid="true"/);
    assert.match(text(el.innerHTML), /Type the amount like 45 or 45\.99\./);
    fields["#fa-cf-amount"].value = "45";
    el.listeners.click({ target: btn({ "data-act": "save-custom" }), preventDefault() {} });
    await flush();
    assert.equal(posts.length, 1);
    assert.match(el.innerHTML, /id="fa-cf-name"[^>]*aria-invalid="true"/);
    assert.match(text(el.innerHTML), /Give it a name of 80 letters or fewer\./);
  });

  test("Edit, then Remove asks first; Keep it sends nothing; Yes posts remove_custom and the form closes", async () => {
    const el = fakeEl(formFields({ name: "Office rent", amount: "1200.00", cadence: "monthly", day: "1", target: BIZ, phone: true }));
    const posts = [];
    const h = section().mount(el, { clientId: CID, apiGet: async () => ({ status: 200, body: fx() }),
      apiPost: async (p, b) => { posts.push(b); return { status: 200, body: { ok: true, action: b.action, saved: { id: RENT, removed: true } } }; } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "edit-custom", "data-id": RENT }) });
    assert.match(el.innerHTML, /<h2 id="fa-cf-h">Edit bill<\/h2>/);
    el.listeners.click({ target: btn({ "data-act": "ask-remove-custom", "data-id": RENT }) });
    el.listeners.click({ target: btn({ "data-act": "keep-custom" }) });
    assert.deepEqual(posts, []);
    el.listeners.click({ target: btn({ "data-act": "ask-remove-custom", "data-id": RENT }) });
    el.listeners.click({ target: btn({ "data-act": "remove-custom", "data-id": RENT }) });
    await flush();
    assert.deepEqual(posts, [{ action: "remove_custom", id: RENT, client_id: CID }]);
    assert.doesNotMatch(el.innerHTML, /data-form="custom"/);
    assert.match(text(el.innerHTML), /Removed\./);
  });

  test("the phone switch on an added bill posts set_custom_phone; the form's own switch flips before Save", async () => {
    const fields = formFields({ name: "Gym", amount: "45", cadence: "monthly", day: "5", target: "personal", phone: true });
    const el = fakeEl(fields);
    const posts = [];
    const h = section().mount(el, { apiGet: async () => ({ status: 200, body: fx() }),
      apiPost: async (p, b) => { posts.push(b); return { status: 200, body: { ok: true, action: b.action, saved: { id: RENT, phone_alert: false } } }; } });
    await h.ready;
    el.listeners.click({ target: btn({ "data-act": "toggle-custom", "data-id": RENT, "aria-checked": "true" }) });
    await flush();
    assert.deepEqual(posts[0], { action: "set_custom_phone", id: RENT, enabled: false });
    el.listeners.click({ target: btn({ "data-act": "add", "data-kind": "bill" }) });
    el.listeners.click({ target: fields['[data-act="form-phone"]'] });
    el.listeners.click({ target: btn({ "data-act": "save-custom" }), preventDefault() {} });
    await flush();
    assert.equal(posts[1].phone_alert, false, "the switch flipped to off is what is sent");
  });
});
