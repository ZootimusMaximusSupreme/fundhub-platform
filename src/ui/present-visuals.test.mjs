// The W3 slide visuals (public/app/present-visuals.js), run in a bare VM with a
// tiny fake window and document: the three functions draw the file's own
// amounts, print nothing where the data is null, carry a Sample tag when the
// deck says sample, never throw on bad data, never print a banned word, and a
// tap changes the state and the state survives a re-render. The browser half is
// e2e/present-visuals.spec.mjs. Board: ops/workflows/weekend-2026-10-24.md 10.8.

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = fs.readFileSync(path.join(ROOT, "public/app/present-visuals.js"), "utf8");
const FIXTURES = fs.readFileSync(path.join(ROOT, "e2e/fixtures/present-visuals-fixtures.js"), "utf8");

/* The deck's own helpers, as present.js defines them. */
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : "$" + Number(n).toLocaleString("en-US"));
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A document with a head, a style list, one click listener list and the hosts
 *  a tap can find. No timers and no requestAnimationFrame: nothing animates. */
function makeDom() {
  const styles = [];
  const listeners = {};
  const hosts = new Map();
  const document = {
    head: { appendChild: (el) => { styles.push(el); } },
    createElement: (tag) => ({ tagName: String(tag).toUpperCase(), id: "", textContent: "" }),
    getElementById: (id) => styles.find((s) => s.id === id) || null,
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    querySelector: (sel) => {
      const m = /\[data-fhv="(\w+)"\]\[data-fhv-client="([^"]*)"\]/.exec(sel);
      return m ? hosts.get(m[1] + "|" + m[2]) || null : null;
    }
  };
  const window = { document, matchMedia: () => ({ matches: true }), console };
  return { window, document, styles, listeners, hosts };
}

function load() {
  const dom = makeDom();
  const context = createContext({ window: dom.window, document: dom.document, console });
  runInContext(FIXTURES, context);
  runInContext(SRC, context);
  const V = dom.window.FHDeckVisuals;
  const fixtures = dom.window.FHV_FIXTURES;
  const ctxFor = (name) => ({ ...JSON.parse(JSON.stringify(fixtures[name])), money, esc });
  /* A host the tap handler can redraw, holding the HTML the deck inserted. */
  function host(name, html) {
    const client = /data-fhv-client="([^"]*)"/.exec(html)[1];
    const h = {
      innerHTML: html,
      getAttribute(k) { return k === "data-fhv" ? name : k === "data-fhv-client" ? client : null; },
      closest(sel) { return sel === "[data-fhv]" ? this : null; }
    };
    dom.hosts.set(name + "|" + client, h);
    return h;
  }
  function tap(h, act, { disabled = false } = {}) {
    const btn = {
      getAttribute(k) { return k === "data-fhv-act" ? act : k === "aria-disabled" && disabled ? "true" : null; },
      closest(sel) { return sel === "[data-fhv-act]" ? this : sel === "[data-fhv]" ? h : null; }
    };
    let prevented = false;
    for (const fn of dom.listeners.click || []) fn({ target: btn, preventDefault() { prevented = true; } });
    return { html: h.innerHTML, prevented };
  }
  return { V, fixtures, ctxFor, host, tap, dom };
}

/** Visible words only: tags out, entities back to characters. */
const words = (html) => html.replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ");
/** The client amounts printed, apart from the proof card's $100,000 (Chris's own
 *  line) and the survey's own range labels ("$100k - $200k"), which are saved words. */
const clientAmounts = (html) => (words(html)
  .replace(/Chris got \$100,000 credit lines/g, "")
  .replace(/\$\d+k\b/g, "")
  .match(/\$\d[\d,]*/g) || []);

const BANNED = /\b(number|pre-approved|funding gap|funding snapshot|credit repair|guaranteed|your score will go up|we think|might|maybe|could|probably|3 to 6 rounds|about every 3 months)\b/i;
const RENDERERS = ["yourPath", "moneyLevers", "fileFindings", "companies"];

describe("the three functions, on the full file", () => {
  let T;
  beforeEach(() => { T = load(); });

  test("they live on window.FHDeckVisuals and return the slide body for the client", () => {
    for (const fn of RENDERERS) assert.equal(typeof T.V[fn], "function", fn + " is a function");
    const html = T.V.moneyLevers(T.ctxFor("full"));
    assert.match(html, /^<div class="fhv-ui-root fhv-levers" data-fhv="levers" data-fhv-client="fx-visuals-full">/);
    assert.match(T.V.yourPath(T.ctxFor("full")), /data-fhv="path"/);
    assert.match(T.V.companies(T.ctxFor("full")), /data-fhv="companies"/);
  });

  test("your path: five stations, the door lit from ctx.door, the setter's words, no prices", () => {
    const html = T.V.yourPath(T.ctxFor("full"));
    for (const name of ["Your file today", "Clean up", "Your plan", "Funded", "Your goal"]) assert.ok(html.includes(name), name);
    assert.equal((html.match(/Your door/g) || []).length, 2, "fund_plus_optimize lights Clean up and Funded");
    assert.match(html, /is-lit[^>]*>[\s\S]*?Clean up/);
    assert.match(html, /is-lit[^>]*>[\s\S]*?Funded/);
    assert.ok(html.includes("You said"), "the stuck part is a You said note");
    assert.ok(html.includes("Two banks turned me down this year and never said why."));
    assert.ok(html.includes("$100k - $200k") && html.includes("Growth (marketing, inventory, hiring)"), "the goal station shows target and use");
    assert.ok(html.includes("You are here"));
    assert.doesNotMatch(words(html), /\$(200|1,000|3,000|5,000|10,000)\b/, "no offer prices on the path");
    assert.ok(!html.includes("Revenue funding"), "no side door unless the door is revenue");
    assert.equal((html.match(/<button /g) || []).length, 5, "every station is a real button");
    /* The first station opens first, like every visual starts at its first step
       (owner-set 2026-10-29). The door stays lit and opens on a tap. */
    assert.match(html, /fhv-path-detail[^>]*>[\s\S]*?Your file today/);
    assert.ok(html.includes("What is on your report decides which door fits right now."));
    assert.ok(!/fhv-path-detail[^>]*>[\s\S]*?Clean up · your door/.test(html), "the lit door waits for a tap");
  });

  test("your path: the revenue door lights a small side door off Funded", () => {
    const html = T.V.yourPath(T.ctxFor("revenue"));
    assert.ok(html.includes("Revenue funding"));
    assert.match(html, /fhv-path-side[^>]*data-fhv-act="path:open:revenue"/);
    assert.ok(!html.includes("fhv-path-side is-open"), "the side door is lit, and opens on a tap");
    const r = T.tap(T.host("path", html), "path:open:revenue");
    assert.match(r.html, /fhv-path-side is-open/);
    assert.ok(r.html.includes("You upload your bank statements in the portal"));
  });

  test("money levers: today, fully optimized, projected increase, the applying levers, the tier, the goal", () => {
    const html = T.V.moneyLevers(T.ctxFor("full"));
    assert.ok(html.includes("$96,524"), "today");
    assert.ok(html.includes("$174,625"), "fully optimized");
    assert.ok(html.includes("$78,101") && html.includes("projected increase"), "the difference");
    assert.ok(html.includes("Pay the cards down") && html.includes("Clean the file"));
    assert.ok(!html.includes("Add accounts"), "a lever that does not apply does not show");
    assert.equal((html.match(/data-fhv-act="levers:step:[12]"/g) || []).length, 2);
    assert.ok(html.includes("+$8,251") && html.includes("+$69,850"), "each lever's own amount");
    assert.ok(html.includes("projects to $104,775") && html.includes("projects to $174,625"));
    assert.ok(html.includes("Funding plus repair") && html.includes("Full funding"), "the tier in words");
    assert.ok(html.includes("Your goal · $100k - $200k"), "the goal line carries the saved words");
    assert.ok(!html.includes("fhv-levers-match"), "no mismatch block on a file with none");
    assert.ok(!/%/.test(html), "no percent sign anywhere in the markup");
  });

  test("companies: one layer per file, personal is today minus the known companies, the proof card", () => {
    const html = T.V.companies(T.ctxFor("full"));
    assert.ok(html.includes("$96,524"), "today's total");
    assert.ok(html.includes("$24,749"), "personal = 96,524 - 59,400 - 12,375");
    assert.ok(html.includes("$59,400") && html.includes("$12,375"));
    assert.ok(html.includes("needs the report") && html.includes("No Report Yet LLC"));
    assert.equal((html.match(/fhv-companies-seg /g) || []).length, 3, "three layers: personal and two companies with amounts");
    assert.ok(html.includes("+ Add a company"));
    assert.ok(!html.includes("fhv-companies-years"), "the years switch waits for an added company");
    assert.ok(html.includes("Chris got $100,000 credit lines for four companies off one personal credit file."));
    assert.ok(html.includes("Chris's own result. Not a promise."));
    assert.ok(html.includes("Funding partners for life"));
    assert.ok(html.includes("Today $96,524"), "today's total stays marked on its own line");
  });
});

describe("no data yet, sample and bad data", () => {
  let T;
  beforeEach(() => { T = load(); });

  test("a null visual prints no client amount and says the pull comes first", () => {
    const levers = T.V.moneyLevers(T.ctxFor("nodata"));
    const companies = T.V.companies(T.ctxFor("nodata"));
    const pathHtml = T.V.yourPath(T.ctxFor("nodata"));
    assert.ok(levers.includes("No credit pull on this file yet"));
    assert.ok(companies.includes("No credit pull on this file yet"));
    assert.deepEqual(clientAmounts(levers), [], "levers print no amount");
    assert.deepEqual(clientAmounts(companies), [], "companies print no amount");
    for (const html of [levers, companies]) {
      assert.ok(!html.includes("$96,524") && !html.includes("$174,625") && !html.includes("$24,749"));
    }
    assert.ok(pathHtml.includes("Your file today") && pathHtml.includes("Your goal"), "the path still draws from the setter's answers");
    assert.equal((pathHtml.match(/Your door/g) || []).length, 0, "no door lit when none is set");
    assert.ok(companies.includes("Business 1") && companies.includes("Cedar Mesa Consulting LLC"), "the deck's businesses still list by name");
  });

  test("a null amount inside a full visual prints nothing there and keeps the step", () => {
    const ctx = T.ctxFor("full");
    ctx.visual.optimizedTotal = null;
    ctx.visual.levers.forEach((l) => { l.totalAfter = null; });
    const html = T.V.moneyLevers(ctx);
    assert.ok(html.includes("$96,524"), "today still shows");
    assert.ok(!html.includes("$174,625") && !html.includes("projected increase"));
    assert.ok(html.includes("not on this file yet"), "the missing amount is named, not guessed");
    const co = T.ctxFor("full");
    co.visual.todayTotal = null;
    const chtml = T.V.companies(co);
    assert.ok(!chtml.includes("$24,749"), "no personal amount without today's total");
    assert.ok(chtml.includes("$59,400"), "a known company amount still shows");
  });

  test("the Sample tag shows only when ctx.sample is true", () => {
    for (const fn of RENDERERS) {
      assert.match(T.V[fn](T.ctxFor("sample")), /fhv-ui-tag[^>]*>[\s\S]*?Sample/, fn + " sample tag");
      assert.ok(!T.V[fn](T.ctxFor("full")).includes("fhv-ui-tag"), fn + " no tag on a real pull");
    }
  });

  test("bad data never throws: wrong types, no ctx, a string ctx", () => {
    const quiet = console.warn;
    console.warn = () => {};
    try {
      for (const fn of RENDERERS) {
        for (const ctx of [T.ctxFor("bad"), undefined, null, "ctx", 7, [], { visual: [] }, { visual: { levers: [null, 1, "x"], companies: [null], mismatches: [{ values: "x" }] } }]) {
          let html;
          assert.doesNotThrow(() => { html = T.V[fn](ctx); }, fn + " on " + JSON.stringify(ctx));
          assert.equal(typeof html, "string");
          assert.ok(html.includes("fhv-ui-root"), fn + " returns a visual root");
        }
      }
    } finally {
      console.warn = quiet;
    }
  });

  test("the style is added once and every class in it is namespaced", () => {
    for (const fn of RENDERERS) { T.V[fn](T.ctxFor("full")); T.V[fn](T.ctxFor("sample")); }
    assert.equal(T.dom.styles.length, 1, "one <style> element");
    const css = T.dom.styles[0].textContent;
    const classes = [...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]).filter((c) => !/^\d/.test(c));
    const stray = [...new Set(classes)].filter((c) => !/^fhv-(path|levers|findings|companies|ui)-/.test(c) && !/^is-/.test(c));
    assert.deepEqual(stray, [], "every class starts with fhv-<name>- (is-* are state flags on those)");
    assert.ok(!/box-shadow:[^;}]*--spectrum/.test(css), "the spectrum is never a shadow colour");
  });
});

describe("the words", () => {
  test("no banned word, in any state, in any visual", () => {
    const T = load();
    for (const name of Object.keys(T.fixtures)) {
      for (const fn of RENDERERS) {
        const html = T.V[fn](T.ctxFor(name));
        const hit = words(html).match(BANNED) || html.match(BANNED);
        assert.equal(hit, null, fn + " on " + name + " prints " + (hit && hit[0]));
        assert.doesNotMatch(html, /(^|[^\d])0%/, fn + " on " + name + " prints 0%");
        assert.ok(!html.includes("CSM"), "the team, never a CSM");
      }
    }
    const fixed = JSON.stringify(T.V.__visualsWords);
    assert.doesNotMatch(fixed, BANNED);
  });

  test("the words are the offers document's, not a promise", () => {
    const T = load();
    const html = T.V.yourPath(T.ctxFor("full"));
    assert.ok(words(html).includes("projects to") === false, "the path shows no projection: it has no amounts");
    const levers = T.V.moneyLevers(T.ctxFor("full"));
    assert.ok(levers.includes("projects to"), "the optimized side says projects to");
    assert.ok(!/approved for \$/.test(words(levers)));
  });
});

describe("taps", () => {
  let T;
  beforeEach(() => { T = load(); });

  test("a lever tap turns it and the ones before it on, climbs the bar, and the state survives a re-render", () => {
    const ctx = T.ctxFor("full");
    const first = T.V.moneyLevers(ctx);
    assert.match(first, /levers:step:1" aria-pressed="false"/);
    assert.match(first, /levers:step:2" aria-pressed="false"/, "every lever starts off: the closer builds the climb live");
    assert.ok(first.includes("Nothing applied yet"));
    assert.match(first, /data-fhv-act="levers:step:0" disabled>Reset to today</, "the reset waits for a tap");
    const h = T.host("levers", first);
    const one = T.tap(h, "levers:step:1");
    assert.ok(one.prevented, "the tap is handled");
    assert.match(one.html, /levers:step:1" aria-pressed="true"/);
    assert.match(one.html, /levers:step:2" aria-pressed="false"/);
    assert.ok(one.html.includes("$104,775"), "the optimized side climbs to lever 1's own amount");
    assert.ok(one.html.includes("$78,101") && one.html.includes("projected increase"), "projected increase stays the whole gap");
    assert.ok(one.html.includes("After lever 1 of 2."));
    assert.match(one.html, /data-fhv-act="levers:step:0">Reset to today</, "the reset is live once a lever is on");
    const again = T.V.moneyLevers(T.ctxFor("full"));
    assert.match(again, /levers:step:1" aria-pressed="true"/, "a deck re-render keeps the tapped state");
    assert.match(again, /levers:step:2" aria-pressed="false"/);
    const two = T.tap(h, "levers:step:2");
    assert.match(two.html, /levers:step:1" aria-pressed="true"/);
    assert.match(two.html, /levers:step:2" aria-pressed="true"/);
    assert.ok(two.html.includes("$174,625") && two.html.includes("$78,101"));
    const zero = T.tap(h, "levers:step:0");
    assert.match(zero.html, /levers:step:1" aria-pressed="false"/);
    assert.ok(zero.html.includes("Nothing applied yet"));
    assert.ok(zero.html.includes("$78,101") && zero.html.includes("projected increase"), "the whole gap shows at today too");
  });

  test("projected increase is always the whole gap, today to fully optimized, at every lever step", () => {
    for (const name of ["full", "thin", "mismatch", "repair"]) {
      const ctx = T.ctxFor(name);
      const whole = ctx.visual.optimizedTotal - ctx.visual.todayTotal;
      const h = T.host("levers", T.V.moneyLevers(ctx));
      const steps = ctx.visual.levers.filter((l) => l.applies).length;
      for (let s = 0; s <= steps; s++) {
        const html = T.tap(h, "levers:step:" + s).html;
        const m = /fhv-levers-gapamt" data-fhv-count="(\d+)"[^>]*>([^<]*)<\/span> projected increase/.exec(html);
        assert.ok(m, name + " step " + s + " prints projected increase");
        assert.equal(Number(m[1]), whole, name + " step " + s + ": the gap is optimized minus today");
        assert.equal(m[2], money(whole), name + " step " + s + ": printed with the deck's money()");
      }
    }
  });

  test("every visual starts at its first step; the levers' reset is off until a tap", () => {
    const levers = T.V.moneyLevers(T.ctxFor("full"));
    assert.equal((levers.match(/aria-pressed="true"/g) || []).length, 0, "no lever on at the start");
    assert.match(levers, /fhv-levers-headcell is-opt is-waiting"[^>]*>[\s\S]*?\$96,524/, "projects to starts at today");
    assert.match(levers, /levers:step:0" disabled>/);
    const pathHtml = T.V.yourPath(T.ctxFor("full"));
    assert.match(pathHtml, /path:open:today" aria-pressed="true"/, "station 1 is open");
    assert.match(pathHtml, /fhv-path-station is-lit"/, "the lit door is lit but not open");
    const companies = T.V.companies(T.ctxFor("full"));
    assert.match(companies, /companies:tab:personal" aria-pressed="true"/);
    assert.ok(!companies.includes("fhv-companies-seg is-added") && !companies.includes("companies:reset"), "no added company, so no reset yet");
  });

  test("adding companies stacks outlined layers that never change today's total; the years switch grows them", () => {
    const ctx = T.ctxFor("full");
    const h = T.host("companies", T.V.companies(ctx));
    let r = T.tap(h, "companies:add");
    assert.ok(r.html.includes("If you add 1 company") && r.html.includes("+$27,500"), "one company at year 1");
    assert.equal((r.html.match(/fhv-companies-seg is-added/g) || []).length, 1);
    r = T.tap(h, "companies:add");
    assert.ok(r.html.includes("If you add 2 companies") && r.html.includes("+$55,000"));
    assert.equal((r.html.match(/fhv-companies-seg is-added/g) || []).length, 2);
    assert.ok(r.html.includes("Today $96,524") && r.html.includes("$96,524"), "today's total stays marked and unchanged");
    assert.ok(r.html.includes("fhv-companies-years"), "the years switch shows once a company is on");
    r = T.tap(h, "companies:years:2");
    assert.ok(r.html.includes("+$220,000"), "two companies after 2 years");
    assert.match(r.html, /companies:years:2" aria-pressed="true"/);
    assert.ok(r.html.includes("$96,524"), "today still the same");
    for (let i = 0; i < 5; i++) r = T.tap(h, "companies:add");
    assert.equal((r.html.match(/fhv-companies-seg is-added/g) || []).length, 4, "four is the cap");
    assert.match(r.html, /companies:add" aria-disabled="true"/);
    const capped = T.tap(h, "companies:add", { disabled: true });
    assert.ok(!capped.prevented, "a disabled add is ignored");
    r = T.tap(h, "companies:reset");
    assert.equal((r.html.match(/fhv-companies-seg is-added/g) || []).length, 0);
    assert.ok(!r.html.includes("fhv-companies-years"), "the years switch hides again with no added company");
    const again = T.V.companies(T.ctxFor("full"));
    assert.ok(!again.includes("fhv-companies-seg is-added"), "a deck re-render keeps the reset");
    r = T.tap(h, "companies:add");
    assert.match(r.html, /companies:years:2" aria-pressed="true"/, "the years pick survives the reset and the re-render");
    assert.ok(r.html.includes("+$110,000"), "one company after 2 years");
  });

  test("a company tab shows that company's card, with the first-year note on a young one", () => {
    const h = T.host("companies", T.V.companies(T.ctxFor("full")));
    let r = T.tap(h, "companies:tab:1");
    assert.match(r.html, /companies:tab:1" aria-pressed="true"/);
    assert.ok(r.html.includes("Bright Mesa Marketing LLC: $12,375 today."));
    assert.ok(r.html.includes("Incorporated July 2025") && r.html.includes("8 months old"));
    assert.ok(r.html.includes("First year"));
    r = T.tap(h, "companies:tab:2");
    assert.ok(r.html.includes("Needs the company report before an amount shows."));
    r = T.tap(h, "companies:tab:personal");
    assert.ok(r.html.includes("Your personal file: $24,749 today."));
  });

  test("a station tap opens that station's lines; the state survives a re-render", () => {
    const h = T.host("path", T.V.yourPath(T.ctxFor("full")));
    const r = T.tap(h, "path:open:plan");
    assert.match(r.html, /path:open:plan" aria-pressed="true"/);
    assert.match(r.html, /fhv-path-detail[^>]*>[\s\S]*?Your plan/);
    assert.ok(r.html.includes("A written plan built from your own report"));
    assert.match(T.V.yourPath(T.ctxFor("full")), /path:open:plan" aria-pressed="true"/);
    const g = T.tap(h, "path:open:goal");
    assert.ok(g.html.includes("You said $100k - $200k for growth (marketing, inventory, hiring)."));
  });

  test("a tap meant for another visual, or an unknown action, changes nothing", () => {
    const html = T.V.moneyLevers(T.ctxFor("full"));
    const h = T.host("levers", html);
    assert.equal(T.tap(h, "companies:add").html, html, "another visual's action is not this host's");
    assert.equal(T.tap(h, "levers:nope:1").html, html, "an unknown action redraws nothing");
    assert.equal(T.tap(h, "levers:step:x").html, html, "a step that is not a count redraws nothing");
    assert.equal(T.tap(h, "").prevented, false);
    assert.equal(T.tap(h, "levers:nope:1").prevented, false, "and the click is left alone");
  });
});

describe("other files", () => {
  test("mismatched info: the three reports side by side, differences marked with a word, no dollar amount", () => {
    const T = load();
    const html = T.V.fileFindings(T.ctxFor("mismatch"));
    const h = T.host("findings", html);
    const shown = T.tap(h, "findings:open:5").html;
    const block = shown.slice(shown.indexOf('class="fhv-levers-match"'));
    for (const b of ["Experian", "TransUnion", "Equifax"]) assert.ok(block.includes(b), b);
    assert.ok(block.includes("Name · differs"));
    assert.ok(block.includes("Not on this report"), "a missing bureau value is named");
    assert.ok(block.includes("This mismatch will make a lender question the file. Confirm the right value before applying."));
    assert.deepEqual(block.match(/\$\d/g), null, "no dollar amount on mismatches");
    const levers = T.V.moneyLevers(T.ctxFor("mismatch"));
    assert.ok(levers.includes("$7,936") && levers.includes("$33,069"), "the levers still show their amounts");
    assert.ok(levers.includes("Your goal · Less than $50k"), "a single-amount goal still draws a line");
    assert.ok(!levers.includes("fhv-levers-match"), "the report grid stays on F-01 so L-01 fits a laptop");
  });

  test("a repair-only file: $0 today, one lever, Repair only to Full funding", () => {
    const T = load();
    const html = T.V.moneyLevers(T.ctxFor("repair"));
    assert.ok(html.includes("One lever"));
    assert.ok(html.includes("$8,250") && html.includes("Clean the file"));
    assert.ok(!html.includes("Pay the cards down"), "a lever that moves nothing stays off the slide");
    assert.ok(html.includes("Repair only") && html.includes("Full funding"));
    const p = T.V.yourPath(T.ctxFor("repair"));
    assert.equal((p.match(/Your door/g) || []).length, 1);
    assert.match(p, /is-lit[^>]*>[\s\S]*?Your plan/, "blueprint lights Your plan");
    const c = T.V.companies(T.ctxFor("repair"));
    assert.ok(c.includes("we can set it up for you"), "no business on file yet");
  });

  test("newCompany null: + Add a company still adds the step, with no amount and no years switch", () => {
    const T = load();
    const first = T.V.companies(T.ctxFor("mismatch"));
    assert.ok(first.includes("+ Add a company"), "the step shows without a price");
    assert.ok(first.includes("$7,936"));
    const h = T.host("companies", first);
    const r = T.tap(h, "companies:add");
    assert.ok(r.html.includes("If you add 1 company"), "the step counts");
    assert.ok(!r.html.includes("+$"), "no amount for the added company");
    assert.ok(!r.html.includes("fhv-companies-years"), "nothing to grow without an amount");
    assert.ok(!r.html.includes("fhv-companies-seg is-added"), "no layer with no amount behind it");
    assert.ok(r.html.includes("No amount for a new company on this file yet."));
    assert.match(r.html, /<b>\+1<\/b> if you add a company<\/span>/, "the legend names the step with no amount");
    assert.equal((r.html.match(/fhv-companies-chip is-added/g) || []).length, 2, "it joins the next funding sequence and the one after");
    assert.ok(r.html.includes("Today $7,936"), "today's total is untouched");
  });

  test("a thin file: paydown and accounts are the levers, numbered 1 and 2, clean stays off the slide", () => {
    const T = load();
    const html = T.V.moneyLevers(T.ctxFor("thin"));
    assert.ok(html.includes("Two levers"));
    assert.match(html, /levers:step:1"[^>]*>[\s\S]*?Pay the cards down/);
    assert.match(html, /levers:step:2"[^>]*>[\s\S]*?Add accounts/);
    assert.ok(!html.includes("Clean the file"));
    assert.ok(html.includes("$14,849") && html.includes("$19,800") && html.includes("$55,000"));
    assert.ok(html.includes("+$4,951") && html.includes("+$35,200"), "each lever's own climb");
    assert.ok(html.includes("$40,151") && html.includes("projected increase"));
    const h = T.host("levers", html);
    const r = T.tap(h, "levers:step:1");
    assert.ok(r.html.includes("$19,800") && r.html.includes("$4,951"), "lever 1 alone is the card paydown");
  });

  test("withheld money: the headline and the lists show, no other amount, no tier words, no lever", () => {
    const T = load();
    const levers = T.V.moneyLevers(T.ctxFor("withheld"));
    assert.ok(levers.includes("$212,000"), "the deck's own headline");
    assert.ok(!levers.includes("projected increase") && !levers.includes("projects to $"));
    assert.ok(!levers.includes("fhv-levers-chip"), "no tier words");
    assert.ok(!levers.includes('data-fhv-act="levers:step:'), "no lever button");
    assert.ok(levers.includes("They show once the optimized amount is on this file."));
    assert.ok(levers.includes("The optimized amount is not on this file yet."));
    const findings = T.V.fileFindings(T.ctxFor("withheld"));
    assert.ok(findings.includes("Name differs"), "the mismatch still shows on F-01");
    assert.ok(!levers.includes("fhv-levers-match"), "L-01 does not repeat the report grid");
    assert.deepEqual(clientAmounts(levers), ["$212,000"], "the headline is the only amount");
    const companies = T.V.companies(T.ctxFor("withheld"));
    assert.ok(companies.includes("$212,000") && companies.includes("needs the report"));
    assert.ok(companies.includes("+ Add a company"));
    const printed = clientAmounts(companies);
    assert.ok(printed.length > 0 && printed.every((a) => a === "$212,000"), "every amount is the headline: the head, the personal layer, the legend, the marker; nothing else: " + printed.join(" "));
    const p = T.V.yourPath(T.ctxFor("withheld"));
    assert.equal((p.match(/Your door/g) || []).length, 0, "no door on a file in review");
  });
});

describe("the live look fixes (2026-10-30)", () => {
  test("one lever reads as one lever: 'tap it' and 'Tap the lever', never 'each'", () => {
    const T = load();
    const one = T.V.moneyLevers(T.ctxFor("repair"));
    assert.ok(one.includes("One lever · tap it"), "the eyebrow over the lever");
    assert.ok(one.includes("Nothing applied yet. Tap the lever to build the climb."), "the line under Projects to");
    assert.ok(!one.includes("tap each one") && !one.includes("Tap each lever"), "no 'each' when there is one lever");
    const two = T.V.moneyLevers(T.ctxFor("full"));
    assert.ok(two.includes("Two levers · tap each one"));
    assert.ok(two.includes("Nothing applied yet. Tap each lever to build the climb."));
  });

  test("Business 2 is one color everywhere on the slide: its layer, its key and its chips", () => {
    const T = load();
    const html = T.V.companies(T.ctxFor("full"));
    assert.match(html, /fhv-companies-seg is-biz is-alt[^"]*" title="Business 2/, "the layer");
    assert.match(html, /fhv-companies-key is-biz is-alt"><b>Business 2<\/b>/, "the key");
    assert.equal((html.match(/fhv-companies-chip is-biz is-alt">Business 2</g) || []).length, 3, "a chip in each of the three funding sequences");
    assert.match(html, /fhv-companies-key is-biz"><b>Business 1<\/b>/, "Business 1 keeps the first color");
    const css = T.dom.styles[0].textContent;
    for (const rule of [".fhv-companies-seg.is-biz.is-alt{background:var(--ok)", ".fhv-companies-key.is-biz.is-alt::before{background:var(--ok)", ".fhv-companies-chip.is-biz.is-alt{background:var(--ok)"]) {
      assert.ok(css.includes(rule), rule);
    }
  });

  test("the tab's card and the proof share one row, above Funding partners for life", () => {
    const T = load();
    const html = T.V.companies(T.ctxFor("full"));
    assert.match(html, /<div class="fhv-companies-pair"><div class="fhv-companies-detail">[\s\S]*?<\/div><div class="fhv-companies-proof">/);
    assert.ok(html.indexOf("fhv-companies-pair") < html.indexOf("fhv-companies-timeline"));
  });
});

describe("File findings and waterfall", () => {
  test("F-01 full file shows only real card and item findings, with the card's paydown", () => {
    const T = load();
    const ctx = T.ctxFor("full");
    ctx.visual.pulledOn = "2026-03-11";
    const first = T.V.fileFindings(ctx);
    assert.match(first, /data-fhv="findings"/);
    assert.ok(first.includes("2 findings on this file"));
    assert.ok(first.includes("FIRST PLATYPUS BANK") && first.includes("TOYOTA MOTOR CREDIT"));
    assert.ok(first.includes("Pay $3,000 to the target") && first.includes("Balance $4,000"));
    assert.match(first, /--balance:40/);
    assert.ok(!first.includes("fhv-levers-match"), "no report grid on a file with no mismatch");
    assert.ok(first.includes("From your soft pull on 2026-03-11."));
    const h = T.host("findings", first);
    const card = T.tap(h, "findings:open:0");
    assert.ok(card.prevented && card.html.includes("Pay $3,000 on this card to reach $1,000."));
    assert.match(T.V.fileFindings(ctx), /findings:open:0" aria-expanded="true"/);
    const item = T.tap(h, "findings:open:1").html;
    assert.ok(item.includes("Review this late payment for accuracy, then dispute it"));
    assert.ok(!item.includes("Pay $3,000 on this card"), "one step opens at a time");
  });

  test("F-01 sample, no pull, repair-only and withheld states", () => {
    const T = load();
    const sample = T.V.fileFindings(T.ctxFor("sample"));
    assert.match(sample, /fhv-ui-tag[^>]*>Sample/);
    assert.equal((sample.match(/fhv-findings-row"/g) || []).length, 2);
    const none = T.V.fileFindings(T.ctxFor("nodata"));
    assert.ok(none.includes("No credit pull on this file yet") && !none.includes("fhv-findings-row"));
    const repair = T.V.fileFindings(T.ctxFor("repair"));
    assert.ok(repair.includes("CREDIT ONE BANK") && repair.includes("MIDLAND CREDIT MGMT"));
    assert.ok(repair.includes("7 findings on this file"), "two cards, four items, one mismatch");
    const withheld = T.V.fileFindings(T.ctxFor("withheld"));
    assert.ok(withheld.includes("1 finding on this file"));
    assert.ok(withheld.includes("Name differs") && !withheld.includes("Pay $"));
    const h = T.host("findings", withheld);
    const mismatch = T.tap(h, "findings:open:0").html;
    assert.ok(mismatch.includes("Experian") && mismatch.includes("TransUnion") && mismatch.includes("Equifax"));
    assert.ok(mismatch.includes("Confirm which report value is right"));
  });

  test("L-01 full file draws a to-scale rise for each applied lever and fills it on tap", () => {
    const T = load();
    const ctx = T.ctxFor("full");
    ctx.visual.pulledOn = "2026-03-11";
    const first = T.V.moneyLevers(ctx);
    assert.match(first, /fhv-levers-bars" style="--cols:4"/);
    assert.equal((first.match(/class="fhv-levers-col is-waterstep is-waiting"/g) || []).length, 2);
    assert.ok(first.includes("Cards down") && first.includes("File cleaned"));
    assert.ok(first.includes("+$8,251") && first.includes("+$69,850"));
    assert.match(first, /From your soft pull on 2026-03-11\./);
    const h = T.host("levers", first);
    const one = T.tap(h, "levers:step:1").html;
    assert.equal((one.match(/class="fhv-levers-col is-waterstep is-on"/g) || []).length, 1);
    assert.equal((one.match(/class="fhv-levers-col is-waterstep is-waiting"/g) || []).length, 1);
    assert.match(one, /fhv-levers-bar is-opt/);
    const two = T.tap(h, "levers:step:2").html;
    assert.equal((two.match(/class="fhv-levers-col is-waterstep is-on"/g) || []).length, 2);
    assert.ok(two.includes("$174,625"));
  });

  test("L-01 sample, no pull, repair-only and withheld states stay honest", () => {
    const T = load();
    const sample = T.V.moneyLevers(T.ctxFor("sample"));
    assert.match(sample, /fhv-ui-tag[^>]*>Sample/);
    assert.equal((sample.match(/is-waterstep/g) || []).length, 2);
    const none = T.V.moneyLevers(T.ctxFor("nodata"));
    assert.ok(none.includes("No credit pull on this file yet"));
    assert.ok(!none.includes("is-waterstep") && !none.includes("$96,524"));
    const repair = T.V.moneyLevers(T.ctxFor("repair"));
    assert.equal((repair.match(/is-waterstep/g) || []).length, 1);
    assert.ok(repair.includes("$0") && repair.includes("+$8,250"));
    assert.ok(!repair.includes("Cards down"), "the paydown lever does not apply");
    const withheld = T.V.moneyLevers(T.ctxFor("withheld"));
    assert.ok(!withheld.includes("is-waterstep") && !withheld.includes("+$"));
    assert.ok(withheld.includes("The optimized amount is not on this file yet."));
  });


});
