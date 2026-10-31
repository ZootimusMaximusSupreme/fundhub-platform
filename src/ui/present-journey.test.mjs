// Visual D, the credit optimization journey (public/app/present-journey.js), in
// a bare VM with a tiny fake window and document: the full, no-data and sample
// ctx fixtures render; the amounts print only when the engine gave them; no
// banned sales word appears; and a tap through the real delegated listener
// changes the state the next render restores. The browser half is
// e2e/present-journey.spec.mjs. Fixtures: e2e/fixtures/present-journey-ctx.json.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");
const SRC = fs.readFileSync(path.join(ROOT, "public/app/present-journey.js"), "utf8");
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "e2e/fixtures/present-journey-ctx.json"), "utf8"));

/* The deck's own money() and esc() (public/app/present.js). */
const money = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : "$" + Number(n).toLocaleString("en-US"));
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function fakeDocument() {
  const listeners = {};
  const head = { children: [], appendChild(el) { this.children.push(el); return el; } };
  return {
    head,
    listeners,
    createElement(tag) { return { tagName: String(tag).toUpperCase(), id: "", textContent: "" }; },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, event) { for (const fn of listeners[type] || []) fn(event); }
  };
}

function load({ existing } = {}) {
  const document = fakeDocument();
  const sandbox = { console: { warn() {}, log() {}, error() {} }, document };
  if (existing) sandbox.FHDeckVisuals = existing;
  sandbox.window = sandbox;
  runInContext(SRC, createContext(sandbox));
  return { journey: sandbox.FHDeckVisuals.journey, sandbox, document };
}

const plain = (v) => JSON.parse(JSON.stringify(v));
const withFns = (fx) => ({ ...plain(fx), money, esc });

/* A tap on a round, the way the delegated listener sees it: the target's
   closest() finds the round button, the button's closest() finds the root. */
function tap(document, round, clientId) {
  const root = { getAttribute: (k) => (k === "data-fhv-client" ? clientId : null), querySelectorAll: () => [] };
  const btn = { getAttribute: (k) => (k === "data-fhv-round" ? round : null), closest: (sel) => (sel === '[data-fhv="journey"]' ? root : null) };
  document.fire("click", { target: { closest: (sel) => (sel.includes("[data-fhv-round]") ? btn : null) } });
}

const BANNED = ["number", "pre-approved", "funding gap", "funding snapshot", "credit repair", "guaranteed", "your score will go up", "0%", "we think", "might", "maybe", "could", "probably"];
const roundButtons = (html) => [...html.matchAll(/<button[^>]*data-fhv-round="(R\d)"[^>]*>/g)];
const expanded = (html, round) => new RegExp(`data-fhv-round="${round}"[^>]*aria-expanded="true"`).test(html);
const bodyHidden = (html, round) => new RegExp(`data-fhv-body="${round}" hidden>`).test(html);
const bodyShown = (html, round) => new RegExp(`data-fhv-body="${round}">`).test(html);
const titles = (html) => [...html.matchAll(/class="fhv-journey-rtitle">([^<]*)</g)].map((m) => m[1]);

describe("visual D, the credit optimization journey", () => {
  test("registers journey on window.FHDeckVisuals, creating the object or keeping the one already there", () => {
    const fresh = load();
    assert.equal(typeof fresh.journey, "function");
    const other = () => "x";
    const kept = load({ existing: { yourPath: other } });
    assert.equal(kept.sandbox.FHDeckVisuals.yourPath, other, "another visual's function survives");
    assert.equal(typeof kept.sandbox.FHDeckVisuals.journey, "function");
  });

  test("full: the ladder marks today and the projection with the engine's amounts", () => {
    const { journey } = load();
    const html = journey(withFns(FX.full));
    assert.match(html, /^<div class="fhv-journey" data-fhv="journey" data-fhv-client="fx-journey-repair">/);
    assert.match(html, /class="fhv-journey-rung is-now" data-level="REPAIR_ONLY"/);
    assert.match(html, /class="fhv-journey-rung is-after" data-level="FUNDING_PLUS_REPAIR"/);
    assert.match(html, /class="fhv-journey-rung" data-level="FULL_FUNDING"/, "no marker on the level the file is not at");
    assert.ok(html.includes('You are here</span><span class="fhv-journey-amt" data-fhv-count="0" data-fhv-key="today">$0</span>'));
    assert.ok(html.includes('Projects to</span><span class="fhv-journey-amt" data-fhv-count="8250" data-fhv-key="optimized">$8,250</span>'));
    assert.match(html, /<svg class="fhv-journey-link"[^>]*><line x1="16\.667%" y1="120" x2="50\.001%" y2="90"/, "a dotted line climbs from today's rung to the projected one");
    for (const name of ["Repair only", "Funding plus repair", "Full funding"]) assert.ok(html.includes(">" + name + "<"), name);
    assert.ok(!html.includes("fhv-journey-tag"), "a real file carries no Sample tag");
    assert.ok(!html.includes("No pull on this file yet"));
  });

  test("full: six rounds on one path, Round 1 open with the client's own items, every round with its timing", () => {
    const { journey } = load();
    const html = journey(withFns(FX.full));
    assert.equal(roundButtons(html).map((m) => m[1]).join(","), "R1,R2,R3,R4,R5,R6");
    assert.deepEqual(titles(html), ["Metro 2 dispute", "Method of verification", "Final notice", "CFPB complaint", "State attorney general complaint", "Final notice, again"]);
    for (const t of titles(html)) assert.ok(t.split(/\s+/).length <= 6, `six words or fewer: ${t}`);
    assert.equal((html.match(/The bureaus answer in 30 to 45 days\./g) || []).length, 6, "every round says the bureaus answer in 30 to 45 days");
    assert.equal((html.match(/Anything still on the file goes to the next round\./g) || []).length, 5, "Rounds 2 to 6 say what still sits on the file moves on");
    // Round 1: the creditor, the kind in plain words, which bureaus
    for (const c of ["MIDLAND CREDIT MGMT", "PORTFOLIO RECOVERY", "SYNCHRONY BANK", "ALLY FINANCIAL"]) assert.ok(html.includes(">" + c + "<"), c);
    assert.ok(html.includes(">Collection<") && html.includes(">Charge-off<") && html.includes(">Late payment<"), "kinds in plain words");
    assert.ok(!html.includes("charge_off") && !html.includes(">late<"), "never the saved code");
    assert.ok(html.includes(">Experian, Equifax<") && html.includes(">TransUnion, Experian<") && html.includes(">Experian, TransUnion, Equifax<") && html.includes(">Equifax, TransUnion<"));
    // The setter's stuck part sits next to Round 1
    assert.ok(html.includes("<b>You said:</b> “Two collections and a charge-off got me denied at Chase and Wells Fargo.”"));
    assert.ok(html.indexOf("You said:") < html.indexOf('data-fhv-body="R2"'), "the quote belongs to Round 1");
    // Round 1 open by default, the rest closed, each with its own body
    assert.ok(expanded(html, "R1") && bodyShown(html, "R1"));
    for (const r of ["R2", "R3", "R4", "R5", "R6"]) assert.ok(!expanded(html, r) && bodyHidden(html, r), `${r} starts closed`);
    assert.match(html, /aria-controls="fhv-journey-fx-journey-repair-R1"/);
    assert.match(html, /id="fhv-journey-fx-journey-repair-R1"/);
    // who the letter goes to, what it asks
    assert.ok(html.includes("<dt>Goes to</dt><dd>Each bureau reporting the item.</dd><dt>Asks</dt><dd>Reinvestigate every item under Metro 2 rules.</dd>"));
    assert.ok(html.includes("The CFPB, the federal regulator. You sign it."));
    assert.ok(html.includes("Your state attorney general. You sign it."));
    assert.ok(html.includes("Delete what it still cannot verify."));
    // every tap target is a real button with a label
    for (const m of roundButtons(html)) assert.ok(m[0].includes('type="button"'), "a real button");
    assert.equal((html.match(/<a /g) || []).length, 0, "no links pretending to be buttons");
  });

  test("no data yet: no amount, no marker, the path still describes the process", () => {
    const { journey } = load();
    const html = journey(withFns({ ...FX.full, visual: null, engine: null }));
    assert.ok(!html.includes("$"), "no dollar amount without a pull");
    assert.ok(!html.includes("You are here") && !html.includes("Projects to") && !html.includes("fhv-journey-link"));
    assert.ok(!html.includes("is-now") && !html.includes("is-after"));
    assert.ok(html.includes("No pull on this file yet. Your levels fill in after the pull."));
    assert.ok(html.includes("Your items from today’s pull show here."));
    assert.equal(roundButtons(html).length, 6);
    assert.equal((html.match(/30 to 45 days/g) || []).length, 6);
    assert.ok(html.includes("You said:"), "the setter's saved sentence still shows");
    const noSaid = journey(withFns({ ...FX.full, visual: null, handoff: {} }));
    assert.ok(!noSaid.includes("You said:"), "nothing saved, nothing invented");
  });

  test("sample: the Sample tag with the sample person's amounts and item", () => {
    const { journey } = load();
    const html = journey(withFns(FX.sample));
    assert.ok(html.includes('<span class="fhv-journey-tag">Sample</span>'));
    assert.ok(html.includes('data-fhv-key="today">$18,000<') && html.includes('data-fhv-key="optimized">$60,000<'));
    assert.match(html, /class="fhv-journey-rung is-now" data-level="FUNDING_PLUS_REPAIR"/);
    assert.match(html, /class="fhv-journey-rung is-after" data-level="FULL_FUNDING"/);
    assert.ok(html.includes(">TOYOTA MOTOR CREDIT<") && html.includes(">Late payment<") && html.includes(">Experian, Equifax, TransUnion<"));
    assert.ok(!html.includes("You said:"), "no handoff saved, so no sentence");
  });

  test("both markers on one rung when the tier does not change; a stray tier still prints its amount below the rungs", () => {
    const { journey } = load();
    const same = journey(withFns({ ...FX.sample, visual: { ...FX.sample.visual, tierAfter: "FUNDING_PLUS_REPAIR" } }));
    assert.match(same, /class="fhv-journey-rung is-now is-after" data-level="FUNDING_PLUS_REPAIR"/);
    assert.ok(same.includes("You are here") && same.includes("Projects to") && !same.includes("fhv-journey-link"));
    assert.match(same, /<span class="fhv-journey-dot is-now is-after"><\/span>/);
    const stray = journey(withFns({ ...FX.sample, tier: "MANUAL_REVIEW", visual: { ...FX.sample.visual, tierNow: "MANUAL_REVIEW", tierAfter: null } }));
    assert.ok(!stray.includes("You are here"));
    assert.ok(stray.includes('<p class="fhv-journey-ladder-note">Today $18,000 · Projects to $60,000</p>'));
    const premium = journey(withFns({ ...FX.sample, visual: { ...FX.sample.visual, tierNow: "PREMIUM" } }));
    assert.match(premium, /class="fhv-journey-rung is-now is-after" data-level="FULL_FUNDING"/, "premium shows as full funding");
    const noGuess = journey(withFns({ ...FX.sample, tier: "FUNDING_PLUS_REPAIR", visual: { ...FX.sample.visual, tierNow: null, tierAfter: null, todayTotal: null, optimizedTotal: null } }));
    assert.ok(!noGuess.includes("is-now") && !noGuess.includes("You are here"), "ctx.tier never fills in a level the engine withheld");
  });

  test("engine hold: tierNow and the amounts null, the levers null, the items still listed", () => {
    const { journey } = load();
    const html = journey(withFns({ ...FX.full, visual: { ...FX.full.visual, tierNow: null, tierAfter: null, todayTotal: null, optimizedTotal: null, levers: null } }));
    assert.ok(!html.includes("$"), "no amount");
    assert.ok(!html.includes("is-now") && !html.includes("is-after") && !html.includes("fhv-journey-link"), "no marker, no connector");
    assert.ok(html.includes("No level or amount on this file yet. The rounds below still run."));
    for (const c of ["MIDLAND CREDIT MGMT", "PORTFOLIO RECOVERY", "SYNCHRONY BANK", "ALLY FINANCIAL"]) assert.ok(html.includes(">" + c + "<"), c);
    assert.equal(roundButtons(html).length, 6);
    assert.ok(expanded(html, "R1"));
    assert.ok(html.includes("You said:"));
  });

  test("a null amount prints nothing where it would go; the step still shows", () => {
    const { journey } = load();
    const html = journey(withFns({ ...FX.full, visual: { ...FX.full.visual, optimizedTotal: null } }));
    assert.ok(html.includes('data-fhv-key="today">$0<'));
    assert.ok(html.includes("Projects to</span></div>"), "the projected marker stands with no amount");
    assert.ok(!html.includes("$8,250") && !html.includes("—"), "no dash, no amount");
  });

  test("no banned sales word in any state", () => {
    const { journey } = load();
    const outs = [
      journey(withFns(FX.full)),
      journey(withFns({ ...FX.full, visual: null })),
      journey(withFns(FX.sample)),
      journey(null)
    ];
    for (const html of outs) {
      const low = html.toLowerCase();
      for (const w of BANNED) assert.ok(!low.includes(w), `banned word "${w}"`);
      assert.ok(!/\bpromise/.test(low) && !/\bremoved\b/.test(low) && !/\bapproval\b/.test(low), "describes the process, promises nothing");
    }
  });

  test("bad data never throws: a plain fallback comes back with no amount", () => {
    const { journey } = load();
    for (const bad of [null, undefined, 7, "x", [], { visual: { items: 42, tierNow: {}, todayTotal: "abc", optimizedTotal: [] }, money: "nope", esc: 7, handoff: "x" }]) {
      const html = journey(bad);
      assert.equal(typeof html, "string");
      assert.ok(html.includes("Round 1"), "the path still shows");
      assert.ok(!html.includes("$"), "no amount from bad data");
    }
    const odd = journey(withFns({ ...FX.full, visual: { ...FX.full.visual, items: [null, 5, { creditor: "", kind: "weird_thing", bureaus: "EX|EQ" }, { kind: "late", bureaus: { TU: true, EQ: false } }] } }));
    assert.ok(odd.includes(">Unnamed creditor<") && odd.includes(">Weird thing<") && odd.includes(">Experian, Equifax<") && odd.includes(">TransUnion<"));
    const thrown = journey({ ...withFns(FX.full), esc() { throw new Error("boom"); } });
    assert.ok(thrown.includes('class="fhv-journey fhv-journey-fallback"') && thrown.includes("Round 6: Final notice, again"));
    assert.ok(!thrown.includes("$"));
  });

  test("a tap through the document listener opens that round, the next render restores it, and state is per client", () => {
    const { journey, document } = load();
    const fx = withFns(FX.full);
    const first = journey(fx);
    assert.equal(document.listeners.click.length, 1, "one delegated listener");
    assert.ok(expanded(first, "R1"));
    tap(document, "R2", fx.clientId);
    const second = journey(fx);
    assert.ok(expanded(second, "R2") && bodyShown(second, "R2"), "Round 2 opened");
    assert.ok(!expanded(second, "R1") && bodyHidden(second, "R1"), "Round 1 closed");
    assert.ok(second.includes('data-fhv-round="R2" aria-expanded="true"') && second.includes("fhv-journey-rbtn is-open"));
    tap(document, "R2", fx.clientId);
    const third = journey(fx);
    assert.equal(roundButtons(third).filter((m) => /aria-expanded="true"/.test(m[0])).length, 0, "tapping the open round closes it");
    tap(document, "R6", fx.clientId);
    assert.ok(expanded(journey(fx), "R6"));
    const other = journey({ ...fx, clientId: "someone-else" });
    assert.ok(expanded(other, "R1"), "a different client starts at Round 1");
    assert.ok(expanded(journey(fx), "R6"), "and the first client keeps Round 6");
    journey(fx); journey(fx);
    assert.equal(document.listeners.click.length, 1, "still one listener after many renders");
    // a click somewhere else is ignored
    document.fire("click", { target: { closest: () => null } });
    document.fire("click", {});
    assert.ok(expanded(journey(fx), "R6"));
  });

  test("the stylesheet goes into head once, uses brand tokens only, no shadow, no gradient, no size under the 13px floor", () => {
    const { journey, document } = load();
    journey(withFns(FX.full));
    journey(withFns(FX.sample));
    journey(null);
    const styles = document.head.children.filter((el) => el.tagName === "STYLE");
    assert.equal(styles.length, 1);
    assert.equal(styles[0].id, "fhv-journey-style");
    const css = styles[0].textContent;
    assert.ok(css.includes(".fhv-journey{") && css.includes("@container (min-width:720px)"));
    assert.ok(!/box-shadow/.test(css), "UI-STANDARDS 12.2: no hand-rolled shadow");
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "no new colors: tokens only");
    assert.ok(!/gradient\(/.test(css), "no gradient drawn here; --spectrum is a token background only");
    assert.ok(!/font-family\s*:\s*(?!var\()/.test(css), "fonts are var(--sans) and var(--mono)");
    for (const m of css.matchAll(/font-size\s*:\s*([\d.]+)px/g)) assert.ok(Number(m[1]) >= 13, `13px caption floor: ${m[0]}`);
    assert.ok(/min-height:56px/.test(css) && /min-height:44px/.test(css), "44px tap floor");
    assert.ok(/prefers-reduced-motion/.test(css));
    // every class in the markup is fhv-journey-*
    const html = journey(withFns(FX.full));
    for (const m of html.matchAll(/class="([^"]*)"/g)) {
      for (const c of m[1].split(/\s+/)) assert.ok(c === "is-now" || c === "is-after" || c === "is-open" || /^fhv-journey(-|$)/.test(c), `class ${c}`);
    }
  });

  test("the amounts carry their count-up targets, and a render without a frame scheduler stays quiet", () => {
    const { journey } = load();
    const html = journey(withFns(FX.sample));
    assert.ok(html.includes('data-fhv-count="18000" data-fhv-key="today"') && html.includes('data-fhv-count="60000" data-fhv-key="optimized"'));
    assert.doesNotThrow(() => { journey(withFns(FX.sample)); journey(withFns(FX.full)); });
  });
});
