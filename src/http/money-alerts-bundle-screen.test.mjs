// The alerts bundle screen (public/app/money-alerts-bundle.js) — its own render
// functions run in Node against a `bundle` built by the REAL server builder
// (alertsBundlePayload over one fictional client), so the screen and the read are
// checked against one contract. The mount test drives it through ctx.apiGet and
// ctx.apiPost with a tiny fake element. No browser, no database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { sampleBundle } from "../finance/file-alerts/bundle-sample.mjs";
import { introCountdown } from "../finance/file-alerts/intro-countdown.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "money-alerts-bundle.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "money-alerts-bundle.css"), "utf8");

function load(extra = {}) {
  const sandbox = { window: { ...extra } };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window;
}
const W = load();
const B = W.FHAlertsBundle;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/\s+/g, " ");

const BUNDLE = await sampleBundle();
const fx = () => JSON.parse(JSON.stringify(BUNDLE));

describe("the full bundle", () => {
  const html = B.render(fx(), {});
  const words = text(html);

  test("four panels, each named for a screen reader", () => {
    for (const id of ["fb-card-rule", "fb-intro", "fb-business", "fb-weekly"]) {
      assert.match(html, new RegExp(`id="${id}" aria-labelledby="${id}-h"`), id);
      assert.match(html, new RegExp(`<h2 id="${id}-h">`), id);
    }
  });

  test("three switches, each a real switch with its words and On or Off", () => {
    const switches = html.match(/role="switch"/g) || [];
    assert.equal(switches.length, 3);
    for (const k of ["card_over_10", "business_credit", "weekly_money"]) assert.match(html, new RegExp(`data-kind="${k}" aria-checked="true"`));
    assert.match(words, /After funding Card over 10% Text me when a card goes over 10% On/);
  });

  test("Pay by and the over-10% rule are Smart alerts on the board above, so they are not here a second time", () => {
    assert.doesNotMatch(html, /id="fb-pay-by"/);
    assert.doesNotMatch(words, /Pay by|Pay about \$1,600|Over 10%|Under 10%|Not known/, "no card listed against the 10% rule here");
    const rule = B.renderCardRule(fx().card_rule, fx().switches.card_over_10, {});
    assert.doesNotMatch(text(rule), /Sample Card/, "the over-10% panel is only its switch");
    assert.match(rule, /data-kind="card_over_10"/);
    assert.equal(B.renderPayBy, undefined, "no second Pay by list to paint");
  });

  test("the 0% countdown: days left, the rate as a word, and the monthly payoff", () => {
    assert.match(words, /60 days left Ends Jan 5, 2027 Pay about \$1,200 a month for 2 months to clear \$2,400\.00\. 0%/);
  });

  /* Codex design review (binding): a promo that charges interest, or whose rate is not on
     file, is never told that a no-interest amount clears it. The rows come from the real read. */
  test("a 9.99% promo is paid off at its own rate; a promo with no rate on file shows the least, marked, and no payoff", () => {
    const card = { account_id: "x", name: "Sample Rate Card", mask: "9999", kind: "personal", balance_cents: 120000 };
    const row = (apr) => introCountdown(card, { promo_ends_on: "2027-03-06", promo_apr: apr }, { today: "2026-11-06" });
    const rated = text(B.renderIntro([row("0.09990")], 2026));
    assert.match(rated, /Sample Rate Card ending 9999 Personal 120 days left Ends Mar 6, 2027 Pay about \$307 a month for 4 months to clear \$1,200\.00\. 9\.99%/);
    assert.doesNotMatch(rated, /\$300 a month/, "the no-interest amount does not clear a 9.99% balance");
    const unknown = text(B.renderIntro([row(null)], 2026));
    assert.match(unknown, /120 days left Ends Mar 6, 2027 At least \$300 a month for 4 months\. Rate not on file\./);
    assert.doesNotMatch(unknown, /to clear|Pay about/, "no payoff claim without a rate");
    const zero = text(B.renderIntro([row("0.00000")], 2026));
    assert.match(zero, /Pay about \$300 a month for 4 months to clear \$1,200\.00\. 0%/, "0% is the even split");
    // One payment left with no rate: to the cent, as the Settings card says it.
    const last = (apr) => introCountdown(card, { promo_ends_on: "2026-11-26", promo_apr: apr }, { today: "2026-11-06" });
    assert.match(text(B.renderIntro([last(null)], 2026)), /At least \$1,200\.00 before it ends\. Rate not on file\./);
    assert.match(text(B.renderIntro([last("0.09990")], 2026)), /Pay all \$1,209\.99 before it ends\./, "the balance plus one month at 9.99%");
  });

  test("the panel is the intro RATE countdown: it never says 0% over a row that is not 0%", () => {
    const html = B.renderIntro([], 2026);
    assert.match(text(html), /^ ?Intro rate countdown Clear it before the rate goes up/);
    assert.doesNotMatch(B.render(fx(), {}), /0% intro countdown/);
  });

  test("business credit: both scores with what they were, and the change as a word", () => {
    assert.match(words, /Sample Cedar LLC Intelliscore 55 \(was 42\) · FSR 34 \(was 30\) Newest report Nov 5 Went up/);
  });

  test("weekly: the next Monday, the words the text will say, and when it last went", () => {
    assert.match(words, /Next one: Mon, Nov 9\./);
    assert.match(html, /<blockquote class="fb-preview"[^>]*>Fundhub weekly: Money came in 1 time to your personal accounts this week\./);
    assert.match(words, /Last sent Nov 2\./);
  });

  test("short words (owner rule 2026-11-07): no explanation lines, no disclaimers, no how-it-works", () => {
    for (const gone of [
      /can hurt your next funding sequence/, /We text you the first day a card goes over/,
      /Pay a couple of days early/, /No interest is counted/, /We still text you 60, 30 and 7 days/,
      /The text says "one of your cards"/, /never shows the card, the bank or an amount/,
      /Banks judge every business by itself/, /Plain words only/, /The amounts stay here/,
      /these alerts start on their own/, /Turn it on to get it again/, /in time\./
    ]) assert.doesNotMatch(words, gone);
    assert.doesNotMatch(html, /class="fb-cap fb-lock"/);
  });
});

describe("the other states", () => {
  test("not funded yet: the card rule says when it starts, in one line", () => {
    const b = fx();
    b.card_rule.funded = false;
    assert.match(text(B.renderCardRule(b.card_rule, b.switches.card_over_10, {})), /^ ?After funding Card over 10% Starts after your first approval\. Text me when a card goes over 10% On ?$/);
    assert.doesNotMatch(text(B.renderCardRule(fx().card_rule, fx().switches.card_over_10, {})), /Starts after/, "funded: no line at all");
  });

  test("the other short lines: an ended promo, no balance, no business report, nothing to say", () => {
    const b = fx();
    const ended = { ...b.intro[0], ended: true };
    assert.match(text(B.renderIntro([ended], 2026)), /Sample Card A ending 4404 Personal Promo ended Jan 5, 2027 Ended/);
    assert.match(text(B.renderIntro([{ ...b.intro[0], monthly_cents: null }], 2026)), /Balance not on file\./);
    assert.match(text(B.renderIntro([], 2026)), /No promo rates on file\. ?$/);
    assert.match(text(B.renderBusiness([{ id: "x", name: "Sample Oak LLC", latest: null, previous: null, change: null }], b.switches.business_credit, {}, 2026)),
      /Sample Oak LLC No report yet/);
    assert.match(text(B.renderBusiness([], b.switches.business_credit, {}, 2026)), /No business reports yet\./);
    assert.match(text(B.renderWeekly({ ...b.weekly, preview: null, preview_reason: "nothing_to_say" }, b.switches.weekly_money, {})), /On Nothing to say yet\. Last sent Nov 2\. ?$/);
  });

  test("a switch that is off reads Off, and a saving one is busy", () => {
    const b = fx();
    b.switches.weekly_money.enabled = false;
    const html = B.render(b, { busy: "card_over_10" });
    assert.match(html, /data-kind="weekly_money" aria-checked="false"/);
    assert.match(html, /data-kind="card_over_10" aria-checked="true" aria-busy="true" disabled/);
    assert.match(text(html), /The Monday text is off\./);
  });

  test("nothing to watch: one empty panel with a way forward, plus the weekly switch", () => {
    const b = fx();
    b.card_rule.cards = [];
    b.business_credit = [];
    b.weekly.preview = null;
    b.weekly.preview_reason = "nothing_to_say";
    assert.ok(B.isEmpty(b));
    const html = B.render(b, {});
    assert.match(text(html), /Nothing to watch yet/);
    assert.match(html, /href="\/app\/financeos\.html#accounts"/);
    assert.match(text(html), /Nothing to say yet/);
  });

  test("loading is marked busy; an error says what happened and offers Try again", () => {
    assert.match(B.renderLoading(), /aria-busy="true"/);
    const err = B.renderError("offline");
    assert.match(err, /role="alert"/);
    assert.match(text(err), /could not reach the server/);
    assert.match(err, /<button type="button" class="fb-btn" data-fb-retry>Try again<\/button>/);
  });

  test("no bundle in the read (an older endpoint) paints nothing at all", () => {
    assert.equal(B.render(null), "");
  });

  test("money never paints a made-up zero", () => {
    assert.equal(B.money(null), null);
    assert.equal(B.money(240000), "$2,400.00");
    assert.equal(B.dollarsUp(160001), "$1,601");
  });
});

function fakeEl() {
  const listeners = {};
  return {
    innerHTML: "",
    listeners,
    addEventListener(name, fn) { listeners[name] = fn; },
    querySelector() { return null; },
    contains() { return true; }
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("mount — one read, one write, through Finance OS's own api", () => {
  test("staff read carries the client; a client read does not", () => {
    assert.equal(B.readPath("abc"), "/api/money/alerts?part=bundle&client_id=abc");
    assert.equal(B.readPath(""), "/api/money/alerts?part=bundle");
  });

  test("it reads once, paints, and a switch posts set_bundle_alert with the client", async () => {
    const got = [];
    const posts = [];
    const el = fakeEl();
    const ctl = B.mount(el, {
      clientId: "client-9",
      apiGet: async (p) => { got.push(p); return { status: 200, body: { ok: true, bundle: fx() } }; },
      apiPost: async (p, body) => { posts.push([p, body]); return { status: 200, body: { ok: true } }; }
    });
    await ctl.ready;
    assert.deepEqual(got, ["/api/money/alerts?part=bundle&client_id=client-9"]);
    assert.match(el.innerHTML, /class="fh-bundle"/);
    const btn = { getAttribute: () => "weekly_money", hasAttribute: () => false };
    el.listeners.click({ target: { closest: () => btn } });
    await tick();
    // The body was built inside the page's own realm: compare it as JSON.
    assert.deepEqual(JSON.parse(JSON.stringify(posts)), [["/api/money/alerts", { action: "set_bundle_alert", kind: "weekly_money", enabled: false, client_id: "client-9" }]]);
    assert.match(el.innerHTML, /data-kind="weekly_money" aria-checked="false"/);
  });

  test("a refused save puts the switch back", async () => {
    const el = fakeEl();
    const ctl = B.mount(el, {
      apiGet: async () => ({ status: 200, body: { ok: true, bundle: fx() } }),
      apiPost: async () => ({ status: 500, body: { ok: false } })
    });
    await ctl.ready;
    el.listeners.click({ target: { closest: () => ({ getAttribute: () => "card_over_10", hasAttribute: () => false }) } });
    await tick();
    assert.match(el.innerHTML, /data-kind="card_over_10" aria-checked="true"/);
  });

  test("an answer without a bundle leaves the box empty; a failure shows the error", async () => {
    const el = fakeEl();
    await B.mount(el, { apiGet: async () => ({ status: 200, body: { ok: true } }) }).ready;
    assert.equal(el.innerHTML, "");
    const el2 = fakeEl();
    await B.mount(el2, { apiGet: async () => ({ status: 500, body: { ok: false } }) }).ready;
    assert.match(el2.innerHTML, /Try again/);
  });
});

describe("the Finance OS hook", () => {
  test("it registers as the Alerts extra", () => {
    assert.equal(typeof W.FinanceOS.extras.alerts.mount, "function");
  });

  test("an extra already there keeps its box; this one takes the next", () => {
    let priorMounted = 0;
    const w = load({ FinanceOS: { extras: { alerts: { mount: () => { priorMounted += 1; return {}; } } } } });
    const el = { innerHTML: "", firstChild: { innerHTML: "" }, lastChild: fakeEl(), addEventListener() {} };
    w.FinanceOS.extras.alerts.mount(el, { apiGet: async () => ({ status: 200, body: { ok: true } }) });
    assert.equal(priorMounted, 1);
  });

  test("loaded twice, it never chains onto itself, and the neighbour is kept", () => {
    let priorMounted = 0;
    const neighbour = { mount: () => { priorMounted += 1; return {}; } };
    const sandbox = { window: { FinanceOS: { extras: { alerts: neighbour } } } };
    vm.runInNewContext(JS, sandbox);
    vm.runInNewContext(JS, sandbox);
    const hook = sandbox.window.FinanceOS.extras.alerts;
    assert.equal(hook.fhAlertsBundle, true);
    assert.equal(hook.other, neighbour);
    const el = { innerHTML: "", firstChild: { innerHTML: "" }, lastChild: fakeEl(), addEventListener() {} };
    hook.mount(el, { apiGet: async () => ({ status: 200, body: { ok: true } }) });
    assert.equal(priorMounted, 1);
    const alone = { window: {} };
    vm.runInNewContext(JS, alone);
    vm.runInNewContext(JS, alone);
    assert.equal(alone.window.FinanceOS.extras.alerts.other, undefined);
  });
});

describe("the stylesheet", () => {
  test("every rule is under .fh-bundle", () => {
    const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]+\{/g, "").match(/[^{}]+(?=\{)/g) || [];
    for (const s of selectors.map((x) => x.trim()).filter(Boolean)) {
      for (const part of s.split(",")) assert.match(part.trim(), /^\.fh-bundle\b/, part);
    }
  });

  test("no px font sizes: type comes from the brand's tokens (UI-STANDARDS §12.7)", () => {
    assert.deepEqual(CSS.match(/font-size:\s*\d+(\.\d+)?px/g) || [], []);
    for (const m of CSS.match(/font-size:[^;}]+/g) || []) assert.match(m, /var\(--fs-(caption|body|title|metric)\)/, m);
  });

  test("every control is at least 44px", () => {
    for (const cls of ["fb-switch", "fb-btn"]) {
      const rule = CSS.match(new RegExp(`\\.fh-bundle \\.${cls}\\{[^}]*\\}`))[0];
      const h = Number((rule.match(/min-height:(\d+)px/) || [])[1]);
      assert.ok(h >= 44, `${cls} min-height ${h}`);
    }
  });

  test("the shadow is the token, never a hand-rolled value", () => {
    assert.deepEqual((CSS.match(/box-shadow:[^;}]+/g) || []), ["box-shadow:var(--panel-shadow)"]);
  });
});
