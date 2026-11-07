// public/app/pay-now.js — the "Pay now" / "I paid" controls on a card's due row
// (FinanceOS unit I6). Runs the file's own render functions in Node; the
// browser half is e2e/page_money_pay_now.spec.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "pay-now.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "pay-now.css"), "utf8");
const MONEY = fs.readFileSync(path.join(APP, "money.js"), "utf8");
const FOS = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");

function load(src) {
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox);
  return sandbox.window;
}
const W = load(JS);
const P = W.FHPayNow;
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

const CARD = "ca000000-0000-4000-8000-000000000001";
const entry = (o = {}) => ({
  account_id: CARD, name: "Chase Freedom", mask: "1234", due_on: "2026-11-21", min_due_cents: 3500,
  pay_url: "https://www.chase.com/", pay_site: "chase.com", can_check: true, claim: null, seen: null, ...o
});

test("the page loads the file and its styles; FinanceOS gets slot + enhance", () => {
  assert.match(FOS, /<script defer src="money-trends\.js"><\/script>\s*<script defer src="pay-now\.js"><\/script>/);
  assert.match(FOS, /<link rel="stylesheet" href="pay-now\.css">/);
  assert.equal(typeof W.FinanceOS.payNow.slot, "function");
  assert.equal(typeof W.FinanceOS.payNow.enhance, "function");
  assert.match(JS, /"\/api\/money\/payments"/);
  assert.match(JS, /\?part=pay_now/);
});

test("a slot only on a card row that names its card", () => {
  assert.equal(P.slot({ type: "card_due", account_id: CARD, on: "2026-11-21" }),
    `<div class="pay-now" data-pay-card="${CARD}" data-pay-due="2026-11-21"></div>`);
  assert.equal(P.slot({ type: "bill", account_id: CARD, on: "2026-11-21" }), "");
  assert.equal(P.slot({ type: "card_due", on: "2026-11-21" }), "", "an older read with no account_id → no controls");
  assert.equal(P.slot({ type: "card_due", account_id: '"><script>', on: "x" }).includes("<script>"), false);
});

test("Pay now is a link to the card company's own site, opened safely; I paid is a button; no money moves here", () => {
  const html = P.renderControls(entry(), "2026-11-21", { today: "2026-11-07" });
  assert.match(html, /<a class="pay-now-btn pay-now-go" data-pay-act="go" href="https:\/\/www\.chase\.com\/" target="_blank" rel="noopener noreferrer">Pay now/);
  assert.match(html, /data-pay-act="paid"/);
  assert.match(text(html), /Opens chase\.com\. You sign in and pay there\. Fundhub never moves your money\./);
  assert.doesNotMatch(html, /transfer|approve/i);
});

test("no website from Plaid → no link, and the row says where to pay", () => {
  const html = P.renderControls(entry({ pay_url: null, pay_site: null }), "2026-11-21", {});
  assert.doesNotMatch(html, /<a /);
  assert.match(text(html), /Pay it in your card's app or on its website\./);
  assert.match(html, /I paid/);
  const js = P.renderControls(entry({ pay_url: "javascript:alert(1)", pay_site: "x.com" }), "2026-11-21", {});
  assert.doesNotMatch(js, /<a /, "only an https link is ever drawn");
});

test("status is said in words, for each state; confirmed only when the server says Plaid shows it", () => {
  const k = (o) => ({ id: "k1", due_on: "2026-11-21", paid_on: "2026-11-06", amount_cents: null, by: "client", ...o });
  const st = (claim, opts) => P.statusText(entry({ claim }), opts);
  const done = st(k({ status: "confirmed", seen_on: "2026-11-07", seen_amount_cents: 3500 }));
  assert.equal(done.state, "confirmed");
  assert.equal(done.text, "Your bank shows your payment on Nov 7 ($35.00).");
  assert.equal(st(k({ status: "waiting" })).text, "You marked this paid on Nov 6. We are waiting for your bank to show it.");
  assert.equal(st(k({ status: "waiting", amount_cents: 3500 })).text, "You marked $35.00 paid on Nov 6. We are waiting for your bank to show it.");
  assert.equal(st(k({ status: "not_seen" })).text, "You marked this paid on Nov 6. Your bank has not shown it yet. Check your card's app.");
  assert.match(st(k({ status: "cannot_check" })).text, /not linked through Plaid, so we can't check it\./);
  assert.equal(st(k({ status: "waiting" }), { staff: true }).text, "Marked paid on Nov 6. Waiting for the bank to show it.");
  assert.equal(P.statusText(entry({ seen: { on: "2026-11-02", amount_cents: null } })).text, "Your bank shows a payment on Nov 2.");
  assert.equal(P.statusText(entry()), null, "nothing said, nothing shown");
  // A word goes with every colour mark.
  const html = P.renderControls(entry({ claim: k({ status: "not_seen" }) }), "2026-11-21", {});
  assert.match(html, /data-state="not_seen" role="status">You marked/);
});

test("with a claim: Undo instead of I paid; the form never shows twice", () => {
  const html = P.renderControls(entry({ claim: { id: "k1", paid_on: "2026-11-06", status: "waiting" } }), "2026-11-21", { open: true });
  assert.match(html, /data-pay-act="undo" data-claim="k1"/);
  assert.doesNotMatch(html, /data-pay-act="paid"/);
  assert.doesNotMatch(html, /data-pay-form/);
});

test("the form: the day (today, up to 30 days back), an optional amount, Mark as paid and Cancel", () => {
  const html = P.renderControls(entry(), "2026-11-21", { open: true, today: "2026-11-07" });
  assert.match(html, /name="paid_on" type="date" required value="2026-11-07" max="2026-11-07" min="2026-10-08"/);
  assert.match(html, /name="amount" type="text" inputmode="decimal"/);
  assert.match(html, /<input type="hidden" name="due_on" value="2026-11-21">/);
  assert.match(html, />Mark as paid</);
  assert.match(html, /data-pay-act="cancel">Cancel</);
  assert.match(html, /<label for="pn-[a-z0-9]+-on">/);
});

test("the form promises a bank check only for a card Plaid reads; a hand-typed card says it cannot be checked", () => {
  const formOf = (o, opts = {}) => {
    const html = P.renderControls(entry(o), "2026-11-21", { open: true, today: "2026-11-07", ...opts });
    return text(html.slice(html.indexOf("<form"), html.indexOf("</form>")));
  };
  // can_check true: the bank can confirm it later.
  assert.match(formOf({ can_check: true }), /^Tell us you paid\. Your bank confirms it later\./);
  assert.match(formOf({ can_check: true }, { staff: true }), /^Mark this card paid for the client\. The bank confirms it later\./);
  // can_check false (a card added by hand): no promise of a later confirmation.
  for (const staff of [false, true]) {
    const said = formOf({ can_check: false, pay_url: null, pay_site: null }, { staff });
    assert.match(said, /This card is not linked through Plaid, so we can't check it\./);
    assert.doesNotMatch(said, /confirms it later/);
  }
  // An older read that sends no can_check claims neither.
  const unknown = formOf({ can_check: undefined });
  assert.match(unknown, /^Tell us you paid\. Day you paid/);
  assert.doesNotMatch(unknown, /confirms it later|not linked through Plaid/);
});

test("amounts are read as cents with no float maths; nonsense is refused", () => {
  assert.equal(P.toCents("35"), 3500);
  assert.equal(P.toCents("$1,035.5"), 103550);
  assert.equal(P.toCents(""), null);
  assert.ok(Number.isNaN(P.toCents("35.555")));
  assert.ok(Number.isNaN(P.toCents("abc")));
  assert.ok(Number.isNaN(P.toCents("0")));
});

test("loading and error states say what is happening; error offers Try again", () => {
  assert.match(P.renderLoading(), /aria-busy="true"/);
  assert.match(text(P.renderLoading()), /Checking ways to pay this card/);
  assert.match(P.renderError("offline"), /We could not reach the server/);
  assert.match(P.renderError("server"), /data-pay-act="retry">Try again</);
});

test("the Overview's Coming up rows carry the slot for a card, not for a bill", () => {
  const M = load(MONEY).FHMoney;
  const d = {
    accounts: [{ id: CARD, name: "Chase Freedom", type: "credit" }], containers: [], cash: {}, debt: { cards: [], loans: [] },
    bills: [], cashflow: { months: [] }, billing: {},
    upcoming: [
      { type: "card_due", account_id: CARD, name: "Chase Freedom", on: "2026-11-21", amount_cents: 3500 },
      { type: "bill", name: "Rent", on: "2026-11-22", amount_cents: 100000 }
    ]
  };
  const html = M.renderFull(d);
  assert.match(html, new RegExp(`<li class="row has-pay-now">[\\s\\S]*?data-pay-card="${CARD}" data-pay-due="2026-11-21"`));
  assert.equal((html.match(/data-pay-card=/g) || []).length, 1);
});

test("styles: 44px controls, 16px inputs, 13px captions, no shadow on the inner form", () => {
  assert.match(CSS, /\.pay-now \.pay-now-btn\{[^}]*min-height:44px;min-width:44px/);
  assert.match(CSS, /\.pay-now \.pay-now-form input\{[^}]*min-height:44px[^}]*16px/);
  assert.match(CSS, /\.pay-now \.pay-now-status,[^{]*\{[^}]*font-size:13px/);
  assert.match(CSS, /\.pay-now \.pay-now-form\{[^}]*box-shadow:none/);
});
