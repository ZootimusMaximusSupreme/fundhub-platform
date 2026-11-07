// public/app/funding-paths.js — "Your funding paths" on the Fundability tab.
// Runs the card's own render functions, and its presses, in Node with the
// fictional sample block src/http/fixtures/money-fundability-paths.sample.json
// (built by src/finance/funding-paths.mjs from the Fundability sample file —
// one sample client, so its numbers agree with the rest of the tab). Also runs
// money-fundability.js beside it, so the card is checked where it is mounted.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { selfPath, othersPath, fundhubPath } from "../finance/funding-paths.mjs";
import { BOOK_CALL_URL } from "../deliverables/chrome.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const CARD_JS = fs.readFileSync(path.join(APP, "funding-paths.js"), "utf8");
const FUND_JS = fs.readFileSync(path.join(APP, "money-fundability.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "funding-paths.css"), "utf8");
const PAGE = fs.readFileSync(path.join(APP, "money-fundability.html"), "utf8");
const FOS = fs.readFileSync(path.join(APP, "financeos.html"), "utf8");
const PATHS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-fundability-paths.sample.json"), "utf8"));
const FUND = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/money-fundability.sample.json"), "utf8"));

function load(withCard = true) {
  const sandbox = { window: {} };
  if (withCard) vm.runInNewContext(CARD_JS, sandbox);
  vm.runInNewContext(FUND_JS, sandbox);
  return sandbox.window;
}
const W = load();
const P = W.FHFundingPaths;
const paths = () => JSON.parse(JSON.stringify(PATHS));
const text = (html) => html.replace(/<[^>]+>/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/\s+/g, " ").trim();
const block = (html, key) => {
  const m = html.match(new RegExp('<div class="fp-path" data-fp-path="' + key + '">[\\s\\S]*?(?=<div class="fp-path"|</div></section>$)'));
  assert.ok(m, "no path " + key);
  return m[0];
};

/* The live referral rules (db/migrations 261, 272, 399): 20% direct and 5%
   downline on done-for-you funding, credit repair, the Capital Blueprint and the
   roadmap, once per person. */
const LIVE_RULES = ["direct", "downline"].flatMap((tier) => [
  ["card-stacking-dfy", "partner_share_of_cash"], ["repair-bundle", "sale_price"],
  ["consulting-package", "sale_price"], ["diagnostic", "sale_price"]
].map(([product_code, amount_basis]) => ({
  tier, calc_method: "percent", percent: tier === "direct" ? "20" : "5", amount_basis, scope_rule: "first_paid_product", product_code
})));

test("the sample block is exactly what the back end builds from the sample file", () => {
  const RULES = LIVE_RULES;
  assert.deepEqual(PATHS, {
    ok: true,
    viewer: "client",
    self: selfPath(FUND, { title: "File your LLC", due_at: "2026-11-20" }),
    others: othersPath({ affiliate: null, counts: null, rules: RULES, env: {} }),
    fundhub: fundhubPath({ ready: { status: "none", round: 0, requested_at: null, done_at: null },
      products: { blueprint: { owned: false, name: "Capital Blueprint", sell: { how: "call", url: BOOK_CALL_URL } } }, plans: [] })
  });
});

describe("the card's states", () => {
  test("no block: nothing; a failed block: says so, with Try again", () => {
    assert.equal(P.renderCard(undefined), "");
    const html = P.renderCard({ ok: false });
    assert.match(text(html), /^Your funding paths We could not load your funding paths\. Try again$/);
    assert.match(html, /data-act="retry"/);
  });

  test("one path failing leaves the other two", () => {
    const p = paths();
    p.others = { ok: false };
    const html = P.renderCard(p);
    assert.match(text(block(html, "others")), /Fund other people We could not load this right now\./);
    assert.match(block(html, "self"), /\$212,000/);
    assert.match(block(html, "fundhub"), /I'm ready to get funded/);
  });

  test("full: three paths in order, short words", () => {
    const html = P.renderCard(paths());
    assert.match(html, /<h2 class="fp-title" id="fp-title">Your funding paths<\/h2>/);
    const order = ["self", "others", "fundhub"].map((k) => html.indexOf('data-fp-path="' + k + '"'));
    assert.ok(order[0] > 0 && order[0] < order[1] && order[1] < order[2]);
    assert.match(text(html), /1 Fund it yourself .* 2 Fund other people .* 3 Fundhub funds you/);
  });
});

describe("1 · fund it yourself", () => {
  test("the UnderwriteIQ estimate, marked sample, and the next step", () => {
    const t = text(block(P.renderCard(paths()), "self"));
    assert.match(t, /\$212,000 UnderwriteIQ estimate · sample/);
    assert.match(t, /Next: File your LLC/);
    assert.doesNotMatch(t, /On your plan/, "the plan figure equals today, so it is not said twice");
    assert.match(block(P.renderCard(paths()), "self"), /href="\/app\/financeos\.html#next">See your steps</);
  });
  test("a different plan figure is said; no estimate shows the checks; no pull says where it starts", () => {
    const p = paths();
    p.self.plan_cents = 23500000;
    assert.match(text(block(P.renderCard(p), "self")), /On your plan in 12 months: \$235,000/);
    p.self.today_cents = null;
    p.self.plan_cents = null;
    const t = text(block(P.renderCard(p), "self"));
    assert.match(t, /5 of 6 Fundability checks · sample/);
    assert.doesNotMatch(t, /\$0/);
    p.self.has_pull = false;
    assert.match(text(block(P.renderCard(p), "self")), /Starts with your soft pull\./);
  });
  test("staff links keep the client", () => {
    assert.match(P.renderCard(paths(), { clientId: "c-1" }), /href="\/app\/financeos\.html\?client_id=c-1#next"/);
  });
});

describe("2 · fund other people", () => {
  test("not joined: the rate with the sales it pays on, Get my link, and the partner program from the catalog", () => {
    const html = block(P.renderCard(paths()), "others");
    // Codex CX20: the percent names the sale it pays on, what it is a percent
    // of, and when it is earned — never "anyone you send".
    assert.match(text(html), new RegExp("20% of the first of these that someone you send buys " +
      "Done-for-you funding: what they pay, after they get funded " +
      "Credit repair: the price Capital Blueprint: the price The roadmap: the price"));
    assert.doesNotMatch(text(html), /anyone/);
    assert.doesNotMatch(text(html), /5%/, "the second level is left off until its terms can be said");
    assert.match(html, /data-act="fp-join">Get my link</);
    assert.match(text(html), /Your own brand: \$30,000 once 7-day trial: \$297/);
    assert.match(html, /href="\/partner\/" target="_blank" rel="noopener">See the partner program</);
  });
  test("joined: their link, Copy link, their numbers", () => {
    const p = paths();
    Object.assign(p.others.affiliate, { enrolled: true, share_url: "https://fundhub.ai/start.html?ref=AFF-000123", sent: 3, signed_up: 1 });
    const html = block(P.renderCard(p), "others");
    assert.match(html, /<p class="fp-url" data-fp-url>https:\/\/fundhub\.ai\/start\.html\?ref=AFF-000123<\/p>/);
    assert.match(html, /data-act="fp-copy" data-url="https:\/\/fundhub\.ai\/start\.html\?ref=AFF-000123">Copy link</);
    assert.match(text(html), /3 sent · 1 signed up/);
    assert.doesNotMatch(html, /fp-join/);
  });
  test("an unknown rate is not a number; staff see joined or not, never a button", () => {
    const p = paths();
    p.others.affiliate.direct_pct = null;
    p.others.affiliate.downline_pct = null;
    assert.match(text(block(P.renderCard(p), "others")), /Earn when someone you send buys\./);
    p.viewer = "staff";
    const staff = block(P.renderCard(p), "others");
    assert.match(text(staff), /Not joined yet/);
    assert.doesNotMatch(staff, /fp-join|fp-copy/);
  });
  test("a rate whose sale or basis cannot be said is left off (Codex CX20)", () => {
    for (const change of [{ pays_on: null }, { pays_on: [] }, { pays_once: null }]) {
      const p = paths();
      Object.assign(p.others.affiliate, change);
      const t = text(block(P.renderCard(p), "others"));
      assert.doesNotMatch(t, /20%/, JSON.stringify(change));
      assert.match(t, /Earn when someone you send buys\./);
    }
  });
});

describe("3 · Fundhub funds you", () => {
  test("done for you from the catalog, the ready button, and ClarityPay on the Blueprint", () => {
    const html = block(P.renderCard(paths()), "fundhub");
    assert.match(text(html), /Done-for-you funding \$3,000 to start · 10% of approved funding/);
    assert.doesNotMatch(text(html), /waives/, "not a Blueprint owner: nothing is waived");
    assert.match(html, /class="fp-btn-primary" type="button" data-act="fp-ready">I'm ready to get funded</);
    assert.match(text(html), /Capital Blueprint: pay over time with ClarityPay/);
    assert.match(html, /href="https:\/\/apply\.fundhub\.ai\/schedule\/phonecall" target="_blank" rel="noopener">Book a call</);
  });
  test("a Blueprint owner: $0 to start, the $3,000 deposit waived, the same 10%, no Blueprint upsell", () => {
    const p = paths();
    p.fundhub = fundhubPath({ ready: { status: "none", round: 0, requested_at: null, done_at: null },
      products: { blueprint: { owned: true, name: "Capital Blueprint", sell: null } }, plans: [] });
    const html = block(P.renderCard(p), "fundhub");
    assert.match(text(html), /Done-for-you funding \$0 to start · 10% of approved funding Your Blueprint waives the \$3,000 deposit\./);
    assert.doesNotMatch(text(html), /\$3,000 to start/);
    assert.doesNotMatch(html, /ClarityPay|Book a call/, "they already own the Blueprint");
    assert.match(html, /data-act="fp-ready">I'm ready to get funded</);
  });
  test("Blueprint ownership unknown: the fee alone, no deposit figure, never $0", () => {
    const p = paths();
    p.fundhub = fundhubPath({ ready: null, products: null, plans: [] });
    const t = text(block(P.renderCard(p), "fundhub"));
    assert.match(t, /Done-for-you funding 10% of approved funding/);
    assert.doesNotMatch(t, /\$0|\$3,000|to start|waives/);
  });
  test("a request that is open says so instead of the button", () => {
    const p = paths();
    p.fundhub.ready = { status: "requested", requested_at: "2026-11-07T18:00:00.000Z", done_at: null };
    let html = block(P.renderCard(p), "fundhub");
    assert.match(html, /<span class="fp-pill">Sent to our team<\/span><span class="caption">Nov 7<\/span>/);
    assert.doesNotMatch(html, /fp-ready/);
    p.fundhub.ready.status = "csm_assigned";
    assert.match(block(P.renderCard(p), "fundhub"), /A person has it/);
    p.fundhub.ready = { status: "done", requested_at: "2026-10-01T00:00:00Z", done_at: "2026-10-03T00:00:00Z" };
    html = block(P.renderCard(p), "fundhub");
    assert.match(html, /Prep call done<\/span><span class="caption">Oct 3/);
    assert.match(html, /fp-ready/, "after a done prep call the client may ask again");
  });
  test("their own payment plan wins over the Blueprint line; quiet makes the button an outline", () => {
    const p = paths();
    Object.assign(p.fundhub.financing, { plans_open: 1, left_cents: 120000 });
    const html = block(P.renderCard(p, { quiet: true }), "fundhub");
    assert.match(text(html), /Your payment plan: \$1,200 left/);
    assert.match(html, /See payments/);
    assert.doesNotMatch(html, /ClarityPay/);
    assert.match(html, /class="fp-btn-line" type="button" data-act="fp-ready"/);
    assert.doesNotMatch(P.renderCard(p, { quiet: true }), /fp-btn-primary/);
  });
});

describe("mounted in the Fundability section", () => {
  const withPaths = () => ({ ...JSON.parse(JSON.stringify(FUND)), paths: paths() });
  /* On purpose: the card sits right under the Fundhub score slot (the sales
     look-ahead), before the funding opportunity and the three tiles. */
  test("right under the Fundhub score slot, before the three tiles and the moves", () => {
    const html = W.FHMoneyFundability.render(withPaths(), {});
    const slot = html.indexOf("data-fh-score-slot");
    const card = html.indexOf('<section class="card fp-card"');
    const tiles = html.indexOf('class="fd-grid fd-thirds"');
    const moves = html.indexOf("fd-moves");
    assert.ok(slot > 0 && card > slot, "paths sit after the score slot");
    assert.doesNotMatch(html.slice(slot, card), /<section|fd-grid|fd-opportunity/, "nothing sits between the score slot and the paths");
    assert.ok(tiles > card, "paths sit before the tiles");
    assert.ok(moves > tiles, "the moves stay after the tiles");
    assert.equal((html.match(/fp-btn-primary/g) || []).length, 1, "one filled button on the tab");
  });
  test("the current-engine layout carries it under the score slot, before the funding opportunity", () => {
    const d = withPaths();
    d.opportunity = { basis: "current_crs_engine", personal: { status: "modeled", currentCents: 21200000, projectedCents: 21200000, blockers: [] },
      combined: {}, businesses: [], steps: [], limitations: [] };
    const html = W.FHMoneyFundability.render(d, {});
    const slot = html.indexOf("data-fh-score-slot");
    const card = html.indexOf('<section class="card fp-card"');
    const opportunity = html.indexOf("fd-opportunity");
    assert.ok(slot > 0 && card > slot, "paths sit after the score slot");
    assert.doesNotMatch(html.slice(slot, card), /<section|fd-grid|fd-opportunity/, "nothing sits between the score slot and the paths");
    assert.ok(opportunity > card, "the funding opportunity sits after the paths");
  });
  test("no pull yet: the card still shows, with no second filled button", () => {
    const d = { ok: true, has_pull: false, client: { name: "Sample" }, paths: paths() };
    const html = W.FHMoneyFundability.render(d, {});
    assert.match(html, /Run your soft pull/);
    assert.match(html, /fp-card/);
    assert.equal((html.match(/fp-btn-primary|fd-btn-primary/g) || []).length, 1);
  });
  test("without funding-paths.js the tab paints exactly as before", () => {
    const bare = load(false);
    assert.doesNotMatch(bare.FHMoneyFundability.render(withPaths(), {}), /fp-card/);
  });
  test("both pages load the card's script before money-fundability.js and its styles after money-fundability.css", () => {
    for (const html of [PAGE, FOS]) {
      assert.match(html, /<script defer src="funding-paths\.js"><\/script>\n<script defer src="money-fundability\.js"><\/script>/);
      assert.match(html, /<link rel="stylesheet" href="money-fundability\.css">\n<link rel="stylesheet" href="funding-paths\.css">/);
    }
  });
});

describe("the presses", () => {
  function fakeButton(attrs) {
    const slot = { textContent: "", hidden: true };
    const box = { querySelector: () => slot };
    return { slot, disabled: false, textContent: attrs.label || "Get my link", getAttribute: (k) => attrs[k] || null, closest: () => box };
  }

  test("Get my link calls the portal's own Refer a friend, then shows the link", async () => {
    const data = { paths: paths() };
    const sent = [];
    await new Promise((done) => P.act(fakeButton({}), "fp-join", {
      data, send: (p, b) => { sent.push({ p, b }); return Promise.resolve({ status: 200, body: { ok: true, enrolled: true, created: true, code: "AFF-1", shareUrl: "https://fundhub.ai/start.html?ref=AFF-1" } }); },
      repaint: done
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ p: "/api/affiliates/refer", b: {} }]);
    assert.equal(data.paths.others.affiliate.enrolled, true);
    assert.equal(data.paths.others.affiliate.share_url, "https://fundhub.ai/start.html?ref=AFF-1");
  });

  test("I'm ready to get funded calls the existing ready-to-fund door, with the client for staff", async () => {
    const data = { paths: paths() };
    const sent = [];
    await new Promise((done) => P.act(fakeButton({ label: "I'm ready to get funded" }), "fp-ready", {
      data, clientId: "c-1",
      send: (p, b) => { sent.push({ p, b }); return Promise.resolve({ status: 200, body: { ok: true, created: true, status: "requested", requested_at: "2026-11-07T18:00:00.000Z", done_at: null } }); },
      repaint: done
    }));
    assert.deepEqual(JSON.parse(JSON.stringify(sent)), [{ p: "/api/money/ready-to-fund", b: { client_id: "c-1" } }]);
    assert.equal(data.paths.fundhub.ready.status, "requested");
  });

  test("a refused press puts the button back and says why, in plain words", async () => {
    const data = { paths: paths() };
    const t = fakeButton({});
    let painted = 0;
    P.act(t, "fp-join", { data, send: () => Promise.resolve({ status: 403, body: { ok: false, error: "forbidden" } }), repaint: () => { painted += 1; } });
    assert.equal(t.disabled, true);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(painted, 0);
    assert.equal(t.disabled, false);
    assert.equal(t.textContent, "Get my link");
    assert.equal(t.slot.hidden, false);
    assert.equal(t.slot.textContent, "Only the client can do this from their own login.");
  });

  test("Copy link without a clipboard tells the person how instead", () => {
    const t = fakeButton({ "data-url": "https://fundhub.ai/start.html?ref=AFF-1", label: "Copy link" });
    P.act(t, "fp-copy", { data: { paths: paths() }, repaint() {} });
    assert.equal(t.slot.textContent, "Press and hold the link to copy it.");
  });

  test("only its own three buttons are handled here", () => {
    for (const a of ["fp-join", "fp-copy", "fp-ready"]) assert.equal(P.handles(a), true);
    for (const a of ["retry", "ready", "cancel-bill", null]) assert.equal(P.handles(a), false);
  });
});

test("styles: scoped under .fp-card, 44px controls, no hand-rolled shadow, stacks when narrow", () => {
  for (const rule of CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]*\{/g, "").split("}")) {
    const sel = rule.split("{")[0].trim();
    if (!sel) continue;
    for (const s of sel.split(/,(?![^(]*\))/)) assert.match(s.trim(), /^\.fp-card\b/, s);
  }
  assert.match(CSS, /\.fp-card \.fp-btn-primary,\.fp-card \.fp-btn-line\{[^}]*min-height:44px/);
  assert.match(CSS, /\.fp-card \.fp-link\{[^}]*min-height:44px/);
  assert.doesNotMatch(CSS, /box-shadow/);
  assert.match(CSS, /@media \(max-width:1050px\)\{\s*\.fp-card \.fp-paths\{grid-template-columns:minmax\(0,1fr\)\}/);
});
