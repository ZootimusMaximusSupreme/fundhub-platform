// public/app/fuel-cards.js — business gas cards under each business on the
// Accounts tab. Runs the block's own render functions in Node, with the block
// built by the real back end (src/finance/fuel-cards.mjs buildFuelCards) from
// the bank book's CHEVRON row, and runs money-accounts.js beside it so the
// block is checked where it is mounted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { buildFuelCards, RISK_LINE } from "../finance/fuel-cards.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const CARD_JS = fs.readFileSync(path.join(APP, "fuel-cards.js"), "utf8");
const ACCOUNTS_JS = fs.readFileSync(path.join(APP, "money-accounts.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "fuel-cards.css"), "utf8");
const PAGE = fs.readFileSync(path.join(APP, "money-accounts.html"), "utf8");
const FOS = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");

function load(withCard = true) {
  const sandbox = { window: {} };
  if (withCard) vm.runInNewContext(CARD_JS, sandbox);
  vm.runInNewContext(ACCOUNTS_JS, sandbox);
  return sandbox.window;
}
const W = load();
const F = W.FHFuelCards;
const text = (html) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();

const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const BIZ2 = "aaaaaaaa-0000-0000-0000-000000000003";
const CARD = "f1000000-0000-4000-8000-000000000001";
const CHEVRON = {
  id: CARD, lender_id: "87d7af03-247d-4f79-8f5c-f0e1c8adc144", name: "CHEVRON", product_name: null,
  logo_path: "/assets/lenders/chevron.png",
  application_url: "https://www.mycardapply.com/synindex/?ecdma-lc=12456&ecid=OTHE_25940&offertype=0",
  business_bureau_pulled: "D&B/SBFE", eligible_states: null
};
const block = (over = {}) => buildFuelCards({
  cards: [CHEVRON],
  tracked: [],
  businesses: [{ container_id: BIZ, state: "AZ" }, { container_id: BIZ2, state: null }],
  ...over
});
const biz = (id = BIZ) => ({ id, kind: "business", name: "Sample Fuel LLC", archived_at: null });

describe("the block's states", () => {
  test("not a business, no block, or no cards for this business: nothing", () => {
    assert.equal(F.renderForBusiness(block(), { id: "p1", kind: "personal" }), "");
    assert.equal(F.renderForBusiness(undefined, biz()), "");
    assert.equal(F.renderForBusiness(buildFuelCards({ cards: [], businesses: [{ container_id: BIZ }] }), biz()), "");
  });
  test("team view with an empty list says so, once per business", () => {
    const html = F.renderForBusiness(buildFuelCards({ cards: [], businesses: [{ container_id: BIZ }], viewer: "staff" }), biz());
    assert.match(text(html), /^Business gas cards No gas cards on the bank book list yet\.$/);
  });
  test("a failed read says so", () => {
    assert.match(text(F.renderForBusiness({ ok: false, reason: "read_failed" }, biz())), /We could not load gas cards right now\./);
  });
});

describe("a listed card", () => {
  test("the bank book's own logo and name, its own apply link, the risk line word for word, and Track it", () => {
    const html = F.renderForBusiness(block(), biz());
    assert.match(html, /<h3 class="fc-title">Business gas cards<\/h3>/);
    assert.match(html, /<img class="fc-logo" src="\/assets\/lenders\/chevron\.png" alt="CHEVRON logo"/);
    assert.match(html, /<span class="fc-name">CHEVRON<\/span>/);
    assert.match(html, /<p class="fc-risk">Miss a payment and it hurts your business credit\.<\/p>/);
    assert.equal(RISK_LINE, "Miss a payment and it hurts your business credit.");
    assert.match(html, /<a class="fc-link" href="https:\/\/www\.mycardapply\.com\/synindex\/\?ecdma-lc=12456&amp;ecid=OTHE_25940&amp;offertype=0" target="_blank" rel="noopener">Apply<\/a>/);
    assert.match(html, /<form data-form="track_fuel_card" data-fuel="f1000000-0000-4000-8000-000000000001" data-container="aaaaaaaa-0000-0000-0000-000000000002">/);
    assert.match(html, /name="due_day" inputmode="numeric" maxlength="2" placeholder="15" required/);
    assert.match(html, /name="limit" inputmode="decimal"/);
    assert.match(html, /name="last4" inputmode="numeric" maxlength="4"/);
    assert.match(html, /<button class="fc-btn" type="submit">Track it<\/button>/);
  });
  test("tracked: the word, its last 4 and due day; no form", () => {
    const html = F.renderForBusiness(block({
      tracked: [{ fuel_card_id: CARD, bank_account_id: "acct-1", entity_id: BIZ, account_name: "CHEVRON", mask: "4242", payment_due_day: 15 }]
    }), biz());
    assert.match(html, /<span class="fc-pill">Tracking<\/span><span class="caption">····4242 · Due the 15th<\/span>/);
    assert.doesNotMatch(html, /track_fuel_card/);
    assert.match(html, /fc-risk/, "the risk line stays on a tracked card");
  });
  test("a card the bank book does not offer in the business's state is not shown there", () => {
    const html = F.renderForBusiness(buildFuelCards({ cards: [{ ...CHEVRON, eligible_states: "TX" }], businesses: [{ container_id: BIZ, state: "AZ" }] }), biz());
    assert.equal(html, "");
  });
  test("no logo file: the name only, never a drawn mark", () => {
    const html = F.renderForBusiness(block({ cards: [{ ...CHEVRON, logo_path: null }] }), biz());
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /CHEVRON/);
  });
  test("ordinals read right", () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map(F.ordinal), ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"]);
  });
});

describe("mounted in the Accounts tab", () => {
  const view = (fc) => ({
    ok: true,
    client_id: "11111111-2222-3333-4444-555555555555",
    containers: [
      { id: BIZ, kind: "business", name: "Sample Fuel LLC", archived_at: null, business: null, accounts: [], cards: [], loans: [], bills: [] },
      { id: "p1", kind: "personal", name: "Sample (personal)", archived_at: null, business: null, accounts: [], cards: [], loans: [], bills: [] }
    ],
    unassigned: { accounts: [], cards: [], loans: [], bills: [] },
    billing: { containers: 2, price_per_container_cents: null, monthly_cents: null },
    fuel_cards: fc
  });
  test("inside the business's own card, after its accounts; never under You", () => {
    const html = W.FHMoneyAccounts.render(view(block()));
    const bizCard = html.match(/<section class="card container" data-container="aaaaaaaa-0000-0000-0000-000000000002"[\s\S]*?<\/section>/)[0];
    assert.match(bizCard, /fc-block/);
    assert.ok(bizCard.indexOf("fc-block") > bizCard.indexOf("acct-none"), "after the account list");
    const personal = html.match(/<section class="card container" data-container="p1"[\s\S]*?<\/section>/)[0];
    assert.doesNotMatch(personal, /fc-block/);
  });
  test("without fuel-cards.js the tab paints exactly as before", () => {
    assert.doesNotMatch(load(false).FHMoneyAccounts.render(view(block())), /fc-block/);
  });
  test("refusals the server can send have plain words", () => {
    assert.equal(W.FHMoneyAccounts.writeWords({ status: 409, body: { ok: false, error: "already_tracked" } }), "This gas card is already tracked for this business.");
    assert.equal(W.FHMoneyAccounts.writeWords({ status: 404, body: { ok: false, error: "fuel_card_not_found" } }), "That gas card is not on the list anymore. Reload the page.");
  });
  test("both pages load the block's script before money-accounts.js and its styles", () => {
    for (const html of [PAGE, FOS]) assert.match(html, /<script defer src="fuel-cards\.js"><\/script>\n<script defer src="money-accounts\.js"><\/script>/);
    assert.match(PAGE, /<link rel="stylesheet" href="fuel-cards\.css">/);
    assert.match(FOS, /<link rel="stylesheet" href="fuel-cards\.css">/);
  });
});

test("styles: scoped under .fc-block, 44px controls, 16px inputs, no hand-rolled shadow, one column on a phone", () => {
  for (const rule of CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "").split("}")) {
    const sel = rule.split("{")[0].trim();
    if (!sel) continue;
    for (const s of sel.split(/,(?![^(]*\))/)) assert.match(s.trim(), /^\.fc-block\b/, s);
  }
  assert.match(CSS, /\.fc-block \.fc-link\{[^}]*min-height:44px/);
  assert.match(CSS, /\.fc-block \.fc-btn\{[^}]*min-height:44px/);
  assert.match(CSS, /\.fc-block \.fc-track>summary\{[^}]*min-height:44px/);
  assert.match(CSS, /\.fc-block \.fc-f input\{[^}]*min-height:44px[^}]*font-size:16px/);
  assert.doesNotMatch(CSS, /box-shadow/);
  assert.match(CSS, /@media \(max-width:760px\)\{[\s\S]*\.fc-block \.fc-fields\{grid-template-columns:minmax\(0,1fr\)\}/);
});
