// public/app/apply-gate.js — runs the component's own render functions in Node
// against payloads built by the REAL back end (src/http/fixtures/apply-gate.sample.mjs
// → buildApplyGate), and checks the screen rules: status in words, an unknown is
// never a pass, short client words (owner rule 2026-11-07: no "not a promise"
// line, no sub-line that only repeats its title), the congrats line at 30 days,
// logos only from our own lender files, staff-only controls, the four states,
// scoped styles with 44px controls and no inline style= attributes.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { samplePayloads } from "../http/fixtures/apply-gate.sample.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, "../../public/app");
const JS = fs.readFileSync(path.join(APP, "apply-gate.js"), "utf8");
const CSS = fs.readFileSync(path.join(APP, "apply-gate.css"), "utf8");

function load() {
  const sandbox = { window: {} };
  vm.runInNewContext(JS, sandbox);
  return sandbox.window.FHApplyGate;
}
const G = load();
const TODAY = "2026-11-07";
const P = samplePayloads(TODAY);
const links = { setup: "/app/financeos.html#setup" };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

describe("the full screen", () => {
  const html = G.render(P.full, links, false);
  const words = text(html);

  test("the gate leads with its answer in words", () => {
    assert.match(words, /Can you apply yet\?/);
    assert.match(words, /Ready to apply/);
    assert.match(words, /Locked until every check is green\./);
    assert.doesNotMatch(words, /not a promise/i, "no disclaimer line (owner rule 2026-11-07)");
    assert.doesNotMatch(words, /One early application/);
    assert.match(words, /Sample report\./);
  });

  test("a passing check is its title and Done, with no sub-line that repeats it (QA16)", () => {
    const gate = G.renderGate(P.full);
    assert.match(text(gate), /UnderwriteIQ says fundable Done No hard inquiries Done A bank account seasoned 30\+ days Done/);
    assert.doesNotMatch(gate, /No hard inquiries on your file|UnderwriteIQ says your file is fundable|Your Chase account is seasoned 30\+ days/);
    /* A check that is not done keeps the line that says what is left. */
    const locked = text(G.renderGate(P.locked));
    assert.match(locked, /No hard inquiries 3 hard inquiries are on your file\. They come off before you apply\. Not yet/);
    assert.match(text(G.renderGate(P.empty)), /UnderwriteIQ says fundable No credit pull on file yet\./);
  });

  test("the seasoning clock shows the day, the congrats line at 30, and 60 and 90 as better", () => {
    assert.match(words, /Congrats\. Your Chase account is seasoned\./);
    assert.match(words, /Day 12 of 30\. Seasoned on Nov 25, 2026\./);
    assert.match(words, /30 · seasoned 60 · better 90 · even better/);
    assert.match(words, /Not open yet\. The clock starts the day you open your Wells Fargo account\./);
    /* The bar's width is a class step, never an inline style. */
    assert.match(html, /ag-fill ag-w8/);
    assert.match(html, /ag-fill ag-w2/);
  });

  test("odds are said in words with the book's own limit as the reason", () => {
    assert.match(words, /Chase .* Ready/);
    assert.match(words, /Bank of America .* Wait .* day 12 of 30/);
    assert.match(words, /up to 2 card approvals in 30 days at Bank of America\. You have 2 approved there\. A large deposit can allow more\. Your Fundhub team decides\./);
    assert.match(words, /Earliest day to apply here: Nov 28, 2026\./);
    assert.match(words, /2 ready|7 ready/);
  });

  test("the first six banks show, and the rest wait behind Show all", () => {
    assert.equal((html.match(/<li class="ag-bank" hidden>/g) || []).length, P.full.odds.length - G.SHOWN);
    assert.match(words, new RegExp(`Show all ${P.full.odds.length} banks`));
    const all = G.render(P.full, links, true);
    assert.equal((all.match(/<li class="ag-bank" hidden>/g) || []).length, 0);
    assert.match(text(all), /Show fewer banks/);
  });

  test("logos come only from our own lender files", () => {
    assert.match(html, /<img class="ag-logo" src="\/assets\/lenders\/chase\.png" alt=""/);
    assert.equal(G.logoSrc("https://example.com/logo.png"), "");
    assert.equal(G.logoSrc("/assets/lenders/../../x.png"), "");
  });

  test("a client sees no staff control", () => {
    assert.doesNotMatch(html, /data-act="override"/);
    assert.doesNotMatch(words, /Team note/);
  });
});

describe("staff", () => {
  test("staff see one control per bank with a stated limit, and their own note", () => {
    const html = G.render(P.staff, links, true);
    const controls = html.match(/data-act="override"/g) || [];
    const withLimits = P.staff.odds.filter((o) => o.limits.length).length;
    assert.equal(controls.length, withLimits);
    assert.ok(withLimits >= 2);
    assert.match(html, /data-bank="Bank of America" data-allow="true">Allow more here/);
    const allowed = G.render(P.staffAllowed, links, true);
    assert.match(allowed, /data-bank="Bank of America" data-allow="false">Back to the book's limit/);
    assert.match(text(allowed), /Team note: Large deposit/);
    assert.match(text(allowed), /Your Fundhub team cleared more applications at Bank of America\./);
  });
});

describe("the other three states", () => {
  test("locked: inquiries keep every bank at Not yet", () => {
    const words = text(G.render(P.locked, links, true));
    assert.match(words, /Locked/);
    assert.match(words, /3 hard inquiries are on your file\. They come off before you apply\./);
    assert.doesNotMatch(words, / Ready (?!to apply|means)/);
  });
  test("empty: no pull and no bank account says what will appear and gives one action", () => {
    assert.equal(G.isEmpty(P.empty), true);
    const html = G.render(P.empty, links);
    assert.match(text(html), /Starts after your soft pull\./);
    assert.doesNotMatch(text(html), /Then this shows/);
    assert.match(html, /<a class="ag-btn ag-dark" href="\/app\/financeos\.html#setup">Run your soft pull<\/a>/);
    assert.equal(G.isEmpty(P.full), false);
  });
  test("error says what failed in plain words, with Try again", () => {
    const html = G.renderError("nodb");
    assert.match(html, /role="alert"/);
    assert.match(text(html), /We could not load your apply check\. Our records are busy right now\./);
    assert.match(html, /data-act="retry"/);
    assert.equal(G.classify({ status: 503, body: { ok: false } }), "nodb");
    assert.equal(G.classify({ status: 401, body: null }), "signin");
    assert.equal(G.classify({ status: 200, body: { ok: true } }), "ok");
  });
  test("loading is a skeleton in the real layout", () => {
    const html = G.renderLoading();
    assert.match(html, /aria-busy="true"/);
    assert.match(html, /ag-sk/);
  });
  test("an unknown check reads Not on file, never Done", () => {
    const html = G.renderGate({ gate: { status: "locked", checks: [{ key: "fundable", label: "UnderwriteIQ says fundable", passed: null, text: "x" }] }, rules: {} });
    assert.match(text(html), /Not on file/);
    assert.doesNotMatch(text(html), /Done/);
  });
});

describe("the stylesheet", () => {
  test("every rule is scoped under .fh-apply-gate", () => {
    const selectors = CSS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/@media[^{]+\{/g, "").match(/[^{}]+(?=\{)/g) || [];
    for (const s of selectors.map((x) => x.trim()).filter(Boolean)) {
      for (const part of s.split(",")) assert.match(part.trim(), /^\.fh-apply-gate\b/, `unscoped selector: ${part.trim()}`);
    }
  });
  test("buttons are at least 44 by 44, and no caption is under 13px", () => {
    assert.match(CSS, /\.ag-btn\{[^}]*min-height:44px;min-width:44px/);
    for (const m of CSS.matchAll(/font-size:(\d+)px/g)) assert.ok(Number(m[1]) >= 13, `font-size ${m[1]}px is under 13px`);
  });
  test("the markup never carries an inline style", () => {
    for (const html of [G.render(P.full, links, true), G.render(P.staffAllowed, links, true), G.render(P.empty, links), G.renderLoading(), G.renderError("server")]) {
      assert.doesNotMatch(html, /\sstyle=/);
    }
  });
  test("the bar steps cover 0 to 90 days in 5-day steps", () => {
    assert.equal(G.barStep(null), 0);
    assert.equal(G.barStep(12), 2);
    assert.equal(G.barStep(40), 8);
    assert.equal(G.barStep(400), 18);
    for (let i = 0; i <= 18; i++) assert.match(CSS, new RegExp(`\\.ag-w${i}\\{width:`));
  });
});
