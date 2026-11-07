// public/app/local-banks.js — runs the component's own render functions in Node
// against payloads built by the REAL back end (src/http/fixtures/local-banks.sample.mjs
// → attachLocalBanks on the bundled FDIC and NCUA files), and checks the screen
// rules: short words, status in words, an unknown deposit says "Not set", no
// street from the client's own address, logos only from Plaid or the bank book,
// the four states, scoped styles with 44px controls and no inline style= attributes.
import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { samplePayloads } from "../http/fixtures/local-banks.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "local-banks.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "local-banks.css"), "utf8");

function load(extra = {}) {
  const sandbox = { window: { ...extra } };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHLocalBanks;
}
const L = load();
const links = { address: "/app/financeos.html#accounts" };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();

let P;
before(async () => { P = await samplePayloads("2026-11-07"); });

describe("the full screen", () => {
  test("the plan leads: up to 5 banks for the next 6 months, numbered, in plan order", () => {
    const html = L.render(P.full, links);
    const words = text(html);
    assert.match(words, /^Your bank plan Next 6 months · up to 5 banks 5 banks/);
    assert.ok(words.indexOf("Your bank plan") < words.indexOf("Branches near you"));
    const names = P.full.deposit_plan.map((r) => r.name);
    let at = 0;
    for (const n of names) { const i = words.indexOf(n, at); assert.ok(i >= at, `${n} in order`); at = i; }
    assert.match(words, /Chase Branch in the same ZIP as your home\. Deposit \$5,000 Status Planned/);
    assert.match(words, /Wells Fargo Branch in the same ZIP as your home\. Deposit Not set/);
  });

  test("a local credit union says where it is and to check who can join", () => {
    const words = text(L.renderPlan(P.full));
    assert.match(words, /Desert Financial Local credit union in the same ZIP as your home\. Credit union Check who can join Deposit Not set/);
  });

  test("branches near you: the ZIP of each place, never a street from the client's address", () => {
    const words = text(L.renderNearby(P.full));
    assert.match(words, /Branches near you Home 85004 · Cedar Grove LLC 85281/);
    assert.match(words, /Chase 101 E Washington St, Phoenix On our list Same ZIP as Home/);
    assert.match(words, /Bank of America 699 S Mill Ave, Tempe On our list Same ZIP as Cedar Grove LLC/);
    assert.match(words, /Local Credit union Check who can join/);
    assert.match(words, /From FDIC and NCUA public data\.$/);
    assert.doesNotMatch(words, /U-Haul|Navy Federal/i);
  });

  test("a distance in miles says About and the ZIP: it runs between ZIP-area centers, not from your door (Codex CX19)", () => {
    const words = text(L.renderNearby(P.full));
    const miles = words.match(/\S+ \d+(\.\d+)? mi from [^.]*?ZIP/g) || [];
    assert.ok(miles.length >= 3, "the sample has branches a few miles out");
    for (const m of miles) assert.match(m, /^About \d+(\.\d+)? mi from the Home ZIP$/, m);
    assert.doesNotMatch(words, /\d mi from (Home|you)\b/, "never an exact-sounding distance from Home");
  });

  test("logos only from the bank book or Plaid; a bank with none shows its name only", () => {
    const html = L.render(P.full, links);
    const srcs = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(srcs.length >= 4);
    for (const s of srcs) assert.match(s, /^(\/assets\/lenders\/[a-z0-9._-]+\.(png|svg)|data:image\/png;base64,)/);
    assert.match(html, /alt="Chase logo"/);
    assert.equal(L.logo("https://evil.example/x.png", "X"), "");
    assert.equal(L.logo("/assets/lenders/../x.png", "X"), "");
    assert.equal(L.logo(null, "X"), "");
    const shared = load({ FHBankLogo: { html: (src, name) => `<img class="fh-bank-logo" src="${src}" alt="${name} logo">` } });
    assert.match(shared.logo("/assets/lenders/chase.png", "Chase"), /class="fh-bank-logo lb-logo"/);
  });

  test("status in words, never colour alone", () => {
    const row = { ...P.full.deposit_plan[0], status: "seasoned" };
    assert.match(text(L.renderPlan({ ...P.full, deposit_plan: [row] })), /Seasoned/);
    const unknown = { ...P.full.deposit_plan[0], status: "weird" };
    assert.match(text(L.renderPlan({ ...P.full, deposit_plan: [unknown] })), /Planned/);
  });
});

describe("the other states", () => {
  test("loading is a skeleton in the real layout", () => {
    const html = L.renderLoading();
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /lb-sk/);
  });

  test("no address: the plan stays and one button asks for an address", () => {
    const words = text(L.render(P.needsAddress, links));
    assert.match(words, /No banks on your plan yet\. Your Fundhub team adds them\./);
    assert.match(words, /Add your home or business ZIP to see banks near you\. Add an address$/);
    assert.match(L.render(P.needsAddress, links), /href="\/app\/financeos\.html#accounts"/);
  });

  test("nothing near: Giovanni's banks stay on the plan", () => {
    const words = text(L.render(P.noneNear, links));
    assert.match(words, /Chase/);
    assert.match(words, /No banks found near your addresses\./);
  });

  test("the address read failed: the plan stays and Try again shows", () => {
    const html = L.render(P.unavailable, links);
    assert.match(html, /role="alert"/);
    assert.match(html, /data-act="retry"/);
    assert.match(text(html), /^Your bank plan .* Branches near you This did not load\./);
  });

  test("an error says what failed in plain words", () => {
    assert.match(text(L.renderError("offline")), /^Your bank plan This did not load\. You look offline\. Try again$/);
    assert.match(text(L.renderError("nope")), /Something went wrong on our side\./);
  });

  test("the server's answer is read the same way as every money screen", () => {
    assert.equal(L.classify({ status: 401, body: null }), "signin");
    assert.equal(L.classify({ status: 503, body: { ok: false } }), "nodb");
    assert.equal(L.classify({ status: 200, body: { ok: true } }), "ok");
    assert.equal(L.classify({ status: 200, body: { ok: false } }), "server");
  });

  test("helpers", () => {
    assert.equal(L.money(500000), "$5,000");
    assert.equal(L.money(123456), "$1,234.56");
    assert.equal(L.money(null), null);
    assert.equal(L.whereWords({ distance_text: "1.2 mi", near: { label: "Home" } }), "About 1.2 mi from the Home ZIP");
    assert.equal(L.whereWords({ distance_text: "14 mi", near: { label: "Cedar Grove LLC" } }), "About 14 mi from the Cedar Grove LLC ZIP");
    assert.equal(L.whereWords({ distance_text: "3.0 mi" }), "About 3.0 mi from your ZIP");
    assert.equal(L.whereWords({ distance_text: "Same ZIP", near: { label: "Home" } }), "Same ZIP as Home");
    assert.equal(L.withClient("/app/financeos.html#accounts", "c1"), "/app/financeos.html?client_id=c1#accounts");
  });
});

describe("Finance OS mounting", () => {
  test("the Banks tab gets an extra box; another unit's extra is never replaced", () => {
    const sandbox = { window: {} };
    vm.runInNewContext(JS, sandbox);
    assert.equal(typeof sandbox.window.FinanceOS.extras.banks.mount, "function");
    const theirs = { mount() {} };
    const taken = { window: { FinanceOS: { extras: { banks: theirs } } } };
    vm.runInNewContext(JS, taken);
    assert.equal(taken.window.FinanceOS.extras.banks, theirs);
  });

  test("the extra reads through the page's own fetch and keeps the client id", async () => {
    const sandbox = { window: {} };
    vm.runInNewContext(JS, sandbox);
    const asked = [];
    const el = { innerHTML: "", addEventListener() {}, removeEventListener() {} };
    await sandbox.window.FinanceOS.extras.banks.mount(el, {
      clientId: "c1",
      apiGet: (p) => { asked.push(p); return Promise.resolve({ status: 200, body: P.full }); }
    }).reload();
    assert.deepEqual(asked, ["/api/money/banks?view=local_banks&client_id=c1", "/api/money/banks?view=local_banks&client_id=c1"]);
    assert.match(el.innerHTML, /^<div class="fh-local-banks">/);
    assert.match(el.innerHTML, /Your bank plan/);
  });
});

describe("styles", () => {
  test("every rule is scoped, buttons are at least 44 by 44, no inline styles", () => {
    const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, "").split("}").map((r) => r.trim()).filter(Boolean);
    for (const r of rules) {
      const sel = r.split("{")[0].trim();
      if (!sel || sel.startsWith("@media")) continue;
      for (const s of sel.split(",")) assert.match(s.trim(), /^\.fh-local-banks\b/, s);
    }
    assert.match(CSS, /\.lb-btn\{[^}]*min-height:44px;min-width:44px/);
    assert.doesNotMatch(JS, /style=/);
  });
});
