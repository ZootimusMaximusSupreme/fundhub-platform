// /app/money-alerts.html — runs money-alerts.js's own render functions in Node
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
    assert.match(HTML, /id="alerts-root"/);
    assert.match(HTML, /<div class="app">/);
    assert.doesNotMatch(HTML, /src="shell\.js"/);
    assert.doesNotMatch(HTML, /crm-sidebar\.css/);
    assert.doesNotMatch(HTML, /<script[^>]+src="https?:/, "no outside script, no new dependency");
    assert.match(JS, /"\/api\/money\/alerts"/);
    assert.match(HTML, /<title>Fundhub — File protection alerts<\/title>/);
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

  test("phone: one column for the tiles, the cards, the rows and the two cash boxes", () => {
    const phone = CSS.slice(CSS.indexOf("@media (max-width:760px)"));
    assert.match(CSS, /@media \(max-width:1200px\)\{\s*\.fh-alerts \.prots>\*\{grid-column:span 12\}/);
    assert.match(CSS, /@media \(max-width:900px\)\{\s*\.fh-alerts \.tiles>\*\{grid-column:span 12\}/);
    assert.match(phone, /\.fh-alerts \.row\{grid-template-columns:minmax\(0,1fr\)\}/);
    assert.match(phone, /\.fh-alerts \.cash-grid\{grid-template-columns:minmax\(0,1fr\)\}/);
  });
});

describe("full — the sample client", () => {
  const html = A.render(fx(), null, {});
  const t = text(html);

  test("the head names the client; the four protections come in the API's order with the API's words", () => {
    assert.match(t, /File protection alerts Sample Client · We text you before something can hurt your credit file\./);
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
    assert.equal((html.match(/<span class="sw-word" aria-hidden="true">On<\/span>/g) || []).length, 4);
  });

  test("what each one watches uses the settings: 3 days, 60/30/7 days, 6 months", () => {
    assert.match(text(cardOf(html, "payment_timing")), /We text you 3 days before, so you can pay it down first\./);
    assert.match(text(cardOf(html, "promo_end")), /We text you 60, 30 and 7 days before it ends, with how much to pay each month\./);
    assert.match(text(cardOf(html, "cash_reserve")), /We check your cash against 6 months of your minimum payments\./);
    assert.match(text(cardOf(html, "cash_reserve")), /before your next funding sequence/);
    assert.doesNotMatch(t, /round two/i, "owner-set 2026-10-06: the next funding sequence, never round two");
    assert.match(text(cardOf(html, "new_credit")), /A new card, loan or credit check \(inquiry\) can push back your next funding sequence\./);
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
    assert.ok(card.indexOf('class="needs-day"') < card.indexOf('class="watch"'), "the ask comes before the explanation");
    assert.match(text(ask), /Needs a day Which day of the month does this card's statement close\?/);
    assert.match(text(ask), /We need it so we can text you before it reports\./);
    assert.match(ask, new RegExp(`<label for="fa-cd-${VISA}">Day of the month its statement closes</label><select id="fa-cd-${VISA}" data-cd="${VISA}">`));
    assert.equal((ask.match(/<option value="\d+"/g) || []).length, 31);
    assert.match(ask, /<option value="1">1st<\/option>/);
    assert.match(ask, /<option value="22">22nd<\/option>/);
    assert.match(ask, /<option value="31">31st<\/option>/);
    assert.match(ask, /class="btn-primary" data-act="save-days">Save day</);
  });

  test("promo: 0% ends Dec 6, 2026 in 55 days, the API's payoff line, and the 60 / 30 / 7 schedule", () => {
    const card = cardOf(html, "promo_end");
    const c = text(card);
    assert.match(c, /Next text Nov 6 in 25 days · Business Amex ending 4404: 30 days before its promo ends\./);
    assert.match(c, /0% promo ends Dec 6, 2026 · in 55 days/);
    assert.match(c, /Left to pay: \$5,400\.00/);
    assert.match(c, /Pay about \$2,700\.00 a month for the next 2 months to clear it in time\./);
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
    assert.match(text(card), /We never add them together\./);
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

  test("tiles: what needs the client, the next text, the last text", () => {
    const tiles = text(html.slice(html.indexOf('class="grid tiles"'), html.indexOf('class="grid prots"')));
    assert.match(tiles, /Needs you 2 Add the statement day for Personal Visa ending 3303\. Add the day Personal cash is \$85\.57 short of 6 months of minimums\. See it/);
    assert.match(html, new RegExp(`data-act="jump" data-to="fa-cd-${VISA}">Add the day<`));
    assert.match(html, /data-act="jump" data-to="fa-cash-personal">See it</);
    assert.match(tiles, /Next text Nov 6 In 25 days\. Promo rate ending · Business Amex ending 4404: 30 days before its promo ends\./);
    assert.match(tiles, /Last text Today 2 texts: Cash cushion and Pay before the statement closes\./);
  });

  test("new credit says what happens and that the Blueprint client's team gets a task", () => {
    const c = text(cardOf(html, "new_credit"));
    assert.match(c, /Next text The day we find new credit We check every day\./);
    assert.match(c, /If one is not yours, reply to the text and tell us\. Your Fundhub team gets a task too, so they can help\./);
  });

  test("one filled button; every button has a name; every field has a label", () => {
    const open = A.render(fx(), { editPromo: AMEX }, {});
    for (const h of [html, open]) {
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
    const tiles = text(html.slice(html.indexOf('class="grid tiles"'), html.indexOf('class="grid prots"')));
    assert.match(tiles, /Next text — No dated text is planned\. We still check your cash and new credit every day\./);
  });

  test("STOP: an amber notice in words, no text anywhere, and what already went out still shows", () => {
    const d = fx();
    d.settings.texts_blocked = true;
    const html = A.render(d, null, {});
    const t = text(html);
    assert.match(t, /Texts are off for this phone You replied STOP, so we cannot text you\. Nothing on this page will be sent\. To turn texts back on, text START to us\./);
    assert.match(html, /class="card notice is-warn"/);
    assert.match(t, /Needs you 3 You replied STOP/);
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
    assert.match(text(html), /No texts go out yet This client has neither the Capital Blueprint nor a FinanceOS plan/);
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

  test("empty: nothing to watch, one filled button to add an account, and no tiles", () => {
    const d = fx();
    d.cards = [];
    d.alerts = [];
    d.reserve.personal = { state: "unknown", reason: "no_minimums", months: 6, cash_cents: null, cash_is_floor: false, cash_accounts: 0, minimums_cents: null, minimums_is_floor: false, clarity_cents: null, need_cents: null, short_cents: null, open_alert_id: null };
    d.reserve.business = { ...d.reserve.personal };
    assert.equal(A.isEmpty(d), true);
    assert.equal(A.isEmpty(fx()), false);
    const html = A.render(d, null, {});
    const t = text(html);
    assert.match(t, /Nothing to watch yet When a card or bank account is on your file, we can text you/);
    assert.equal((html.match(/class="btn-primary"/g) || []).length, 1);
    assert.match(html, /<a class="btn-primary" href="\/app\/financeos\.html#accounts">Add an account<\/a>/);
    assert.doesNotMatch(html, /class="grid tiles"/);
    assert.match(text(cardOf(html, "payment_timing")), /No credit cards on file yet\./);
    assert.doesNotMatch(t, /\$NaN|undefined/);
  });

  test("loading is a skeleton in the real layout; errors say what failed in words and offer a retry", () => {
    const l = A.renderLoading();
    assert.match(l, /class="grid tiles" aria-busy="true"/);
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
    assert.match(text(A.render(rate, null, {})), /3\.99% promo rate ends Dec 6, 2026.*The monthly amount does not count interest\./);
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
    assert.match(text(html), /Needs you 1 /);
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
});
