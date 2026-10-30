// The Blueprint dashboard inside the slides (visual C):
// public/app/present-blueprint-demo.js, run as the browser would run it, in
// node:vm with a tiny fake window and document. No browser, no server, no new
// library. The tap paths run for real in e2e/present-blueprint-demo.spec.mjs.
//
// What it holds the visual to (ops/workflows/weekend-2026-10-24.md 10.4 C,
// 10.5 and the 10.8 shared build rules):
//   * every amount comes from ctx.visual and is printed with ctx.money
//   * a null prints nothing: no pull means no dollar figure anywhere
//   * the sample is labeled
//   * the owner's banned words never appear
//   * the steps come from the checklist catalog, in due-window order
//   * a tap changes the state, and the state survives a re-render
//   * broken data never throws

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { FULL, SAMPLE, NONE, BAD, BANNED, CLIENT_ID, deckMoney, deckEsc } from "../../e2e/fixtures/present-blueprint-demo-ctx.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.resolve(HERE, "../../public/app/present-blueprint-demo.js"), "utf8");

/* The smallest document the script needs: a head to put one <style> in, one
   click listener, and getElementById so the style is added once. */
function load() {
  const appended = [];
  const listeners = { click: [] };
  const document = {
    head: { appendChild(el) { appended.push(el); } },
    getElementById(id) { return appended.find((e) => e.id === id) || null; },
    createElement(tag) { return { tagName: tag, id: "", textContent: "" }; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); }
  };
  const window = { document, matchMedia: () => ({ matches: true }) };
  window.window = window;
  const vm = createContext({ window, document, console });
  runInContext(SRC, vm);
  return { FHV: window.FHDeckVisuals, appended, listeners, document };
}

const withHelpers = (ctx) => ({ ...structuredClone(ctx), money: deckMoney, esc: deckEsc });
/* Arrays made inside the vm have the vm's Array prototype; copy them to this realm first. */
const host = (v) => JSON.parse(JSON.stringify(v));
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

/* A fake tap: the button carries data-bd-act, its root carries data-client. */
function tap(env, act, clientId) {
  const root = {
    innerHTML: "",
    getAttribute: (n) => (n === "data-client" ? clientId : null)
  };
  const btn = {
    disabled: false,
    getAttribute: (n) => (n === "data-bd-act" ? act : null),
    closest: (sel) => (sel.includes("data-bd-act") ? btn : root)
  };
  env.listeners.click[0]({ target: btn, preventDefault() {} });
  return root.innerHTML;
}

describe("the slot contract", () => {
  test("adds blueprintDemo to window.FHDeckVisuals, adds one style, listens once", () => {
    const env = load();
    assert.equal(typeof env.FHV.blueprintDemo, "function");
    env.FHV.blueprintDemo(withHelpers(FULL));
    env.FHV.blueprintDemo(withHelpers(FULL));
    env.FHV.blueprintDemo(withHelpers(SAMPLE));
    assert.equal(env.appended.length, 1, "one <style> element, added once");
    assert.equal(env.appended[0].id, "fhv-blueprint-demo-style");
    assert.match(env.appended[0].textContent, /\.fhv-blueprint-demo-root\{/);
    assert.equal(env.listeners.click.length, 1, "one delegated click listener on document");
  });

  test("the html is scoped to data-fhv and keeps the brand tokens only", () => {
    const env = load();
    const html = env.FHV.blueprintDemo(withHelpers(FULL));
    assert.match(html, /^<div class="fhv-blueprint-demo-root" data-fhv="blueprint-demo" data-client="/);
    const css = env.appended[0].textContent;
    assert.doesNotMatch(css, /#(?!fff\b)[0-9a-f]{3,6}\b/i, "no new hex colors; tokens and white only");
    assert.doesNotMatch(css, /box-shadow:[^;]*--spectrum/, "--spectrum never in a shadow");
    assert.doesNotMatch(css, /font-family:(?!var\(--sans\)|var\(--mono\)|inherit)/, "the brand faces only");
  });
});

describe("full file: Dana Whitfield", () => {
  test("home shows today's amount, the first step and the pinned rule", () => {
    const env = load();
    const html = env.FHV.blueprintDemo(withHelpers(FULL));
    const t = text(html);
    assert.match(t, /Your plan, step by step\. A preview built from today’s pull\./);
    assert.match(t, /How much you qualify for/);
    assert.match(t, /\$64,000/);
    assert.match(t, /Today/);
    assert.match(t, /Projects to \$121,000 once the file is optimized/);
    assert.match(t, /Step 1 of 9: Print and mail your dispute letters/);
    assert.match(t, /Do not open new credit while we work on your file\./);
    assert.doesNotMatch(t, /Sample/, "a real pull carries no sample tag");
    assert.match(html, /<button type="button" class="fhv-blueprint-demo-nextbtn" data-bd-act="next">Next step<\/button>/);
  });

  test("the steps follow the catalog's due windows, then the businesses and the next sequence", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(FULL));
    assert.deepEqual(host(steps.map((s) => s.key)), ["mail", "proof", "card0", "card1", "business", "bureaus", "biz1", "biz2", "sequence"]);
    assert.deepEqual(host(steps.slice(0, 6).map((s) => s.day)), [14, 21, 30, 30, 30, 45]);
    assert.equal(steps[2].title, "Pay Capital One Quicksilver down to $1,600");
    assert.equal(steps[3].title, "Pay Discover it down to $900");
    assert.deepEqual(host(steps[4].subs), ["File your LLC", "Get your EIN from the IRS", "Open a business checking account"]);
    assert.equal(steps[6].name, "Whitfield Freight LLC");
    assert.equal(steps[6].amount, null, "no company report means no amount");
    assert.equal(steps[7].name, "If you add a company");
    assert.equal(steps[7].amount, 44000, "the engine's year-1 amount for one added company");
    assert.equal(steps[8].title, "Next funding sequence");
    for (const s of steps) assert.ok(s.chip.split(" ").length <= 6, s.chip);
  });

  test("a tap walks the journey and the screens change; the state survives a re-render", () => {
    const env = load();
    const ctx = withHelpers(FULL);
    env.FHV.blueprintDemo(ctx);

    // Money, Credit: before the letters go out the items are on the file.
    let html = tap(env, "panel:money", CLIENT_ID);
    assert.match(text(html), /Midland Credit Management Collection · Experian, Equifax On your file/);
    assert.match(text(html), /\$9,100 of \$16,000 57% used · target \$1,600/);

    // Mail the letters: Disputed.
    html = tap(env, "next", CLIENT_ID);
    assert.match(text(html), /Midland Credit Management Collection · Experian, Equifax Disputed/);
    assert.doesNotMatch(text(html), /If it comes off/, "not answered yet");

    // Proof, then both cards: the bars drop to target, the amount climbs to the paydown lever.
    tap(env, "next", CLIENT_ID);
    tap(env, "next", CLIENT_ID);
    html = tap(env, "next", CLIENT_ID);
    let t = text(html);
    assert.match(t, /\$1,600 of \$16,000 10% used/);
    assert.match(t, /\$900 of \$9,000 10% used/);
    assert.match(t, /At target/);
    html = tap(env, "panel:home", CLIENT_ID);
    t = text(html);
    assert.match(t, /\$88,000/);
    assert.match(t, /Projects to/);
    assert.match(t, /Step 5 of 9: Set up your business/);

    // Business, then the bureaus answer: the clean lever, "if it comes off".
    tap(env, "next", CLIENT_ID);
    html = tap(env, "next", CLIENT_ID);
    assert.match(text(html), /\$121,000/);
    html = tap(env, "tab:credit", CLIENT_ID);
    t = text(html);
    assert.match(t, /Bureau answered If it comes off/);
    assert.doesNotMatch(t, /removed/i, "never shown as removed");

    // The fundability meter climbed with the file tasks.
    html = tap(env, "tab:fundability", CLIENT_ID);
    t = text(html);
    assert.match(t, /5 of 6/);
    assert.match(t, /Today 2 of 6\. Projects to 5 of 6/);

    // Business 1, Business 2, the next sequence, then "Your next 12 months".
    tap(env, "next", CLIENT_ID);
    tap(env, "next", CLIENT_ID);
    tap(env, "next", CLIENT_ID);
    html = tap(env, "panel:home", CLIENT_ID);
    t = text(html);
    assert.match(t, /Your next 12 months/);
    assert.match(t, /You said this changes: “I stop turning down loads I cannot haul\.”/);
    assert.match(t, /Business 2 ready If you add a company · projects to \$44,000 in year 1/);
    assert.match(t, /Next funding sequence Step by step\. Round after round\./);
    assert.match(html, /data-bd-act="restart">Start over</);

    // The deck re-renders: the same state comes back.
    const again = text(env.FHV.blueprintDemo(withHelpers(FULL)));
    assert.match(again, /Your next 12 months/);
    assert.match(again, /\$121,000/);

    // Start over goes back to step one.
    html = tap(env, "restart", CLIENT_ID);
    assert.match(text(html), /Step 1 of 9/);
    assert.match(text(html), /\$64,000/);
  });

  test("tapping a task opens the phone with the four reminders and the Fundhub team", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const html = tap(env, "task:card0", CLIENT_ID);
    const t = text(html);
    assert.match(t, /The reminders you get/);
    assert.match(t, /Day 30 · text/);
    assert.match(t, /Day 32 · email/);
    assert.match(t, /Day 35 · text/);
    assert.match(t, /Day 39 · the Fundhub team/);
    assert.match(t, /The Fundhub team steps in/);
    assert.match(html, /data-bd-act="close">Close</);
    const closed = text(tap(env, "close", CLIENT_ID));
    assert.doesNotMatch(closed, /The reminders you get/);
  });

  test("the setter's cash on hand shapes the paydown order on Strategy", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const t = text(tap(env, "tab:strategy", CLIENT_ID));
    assert.match(t, /You said you have \$6,000 on hand\. Start here\./);
    assert.match(t, /1 Capital One Quicksilver → \$1,600 \$7,500 to pay down\. Start here/);
    assert.match(t, /2 Discover it → \$900 \$2,400 to pay down\./);
  });

  test("Banks shows the walk order: personal file, each business, the lender list", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const t = text(tap(env, "tab:banks", CLIENT_ID));
    assert.match(t, /Personal file Prime first\. Nothing else is worth doing until it is\. In progress/);
    assert.match(t, /Business 1 Whitfield Freight LLC Waiting/);
    assert.match(t, /Business 2 If you add a company · projects to \$44,000 in year 1 Waiting/);
    assert.match(t, /The lender list/);
  });
});

describe("the sample and the empty file", () => {
  test("the sample is tagged and prints the roadmap sample's amounts", () => {
    const env = load();
    const html = env.FHV.blueprintDemo(withHelpers(SAMPLE));
    const t = text(html);
    assert.match(html, /<span class="fhv-blueprint-demo-tag">Sample<\/span>/);
    assert.match(t, /\$199,350/);
    assert.match(t, /Projects to \$221,500/);
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(SAMPLE));
    assert.equal(steps[2].title, "Pay American Express Blue Business Cash down to $2,500");
    assert.equal(steps[3].title, "Pay Chase Sapphire Preferred down to $1,200");
    assert.equal(steps[6].name, "If you add a company");
    assert.equal(steps[6].amount, null, "newCompany null means no amount");
  });

  test("no pull yet: the steps show with no amount anywhere", () => {
    const env = load();
    const home = env.FHV.blueprintDemo(withHelpers(NONE));
    assert.doesNotMatch(text(home), /\$/, "no dollar figure without a pull");
    assert.match(text(home), /No pull yet\./);
    assert.match(text(home), /Fills in from today’s pull\./);
    assert.match(text(home), /Step 1 of 8: Print and mail your dispute letters/);
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(NONE));
    assert.deepEqual(host(steps.map((s) => s.key)), ["mail", "proof", "cards", "business", "bureaus", "biz1", "biz2", "sequence"]);
    assert.equal(steps[2].title, "Pay each card down to 10% of its limit");
    for (const act of ["panel:progress", "panel:money", "tab:fundability", "tab:strategy", "tab:banks", "next", "next", "next"]) {
      const html = tap(env, act, "no-pull-yet");
      assert.doesNotMatch(text(html), /\$/, act + " printed a dollar figure with no pull");
    }
    assert.match(text(tap(env, "tab:fundability", "no-pull-yet")), /Fills in from today’s pull\./);
  });

  test("broken data never throws and still shows the plan", () => {
    const env = load();
    let html;
    assert.doesNotThrow(() => { html = env.FHV.blueprintDemo({ ...structuredClone(BAD), money: deckMoney, esc: deckEsc }); });
    assert.match(html, /data-fhv="blueprint-demo"/);
    assert.match(text(html), /Print and mail your dispute letters/);
    assert.doesNotThrow(() => env.FHV.blueprintDemo(null));
    assert.doesNotThrow(() => env.FHV.blueprintDemo({ visual: { cards: 3 } }));
    assert.match(env.FHV.blueprintDemo(null), /data-fhv="blueprint-demo"/);
  });
});

describe("the owner's words", () => {
  test("no banned word on any screen, in any state", () => {
    for (const fixture of [FULL, SAMPLE, NONE]) {
      const env = load();
      const ctx = withHelpers(fixture);
      const id = fixture.clientId;
      const seen = [env.FHV.blueprintDemo(ctx)];
      const acts = ["panel:progress", "panel:money", "tab:fundability", "tab:strategy", "tab:banks", "task:mail", "close", "task:business", "close", "task:biz2", "close", "panel:home"];
      for (let i = 0; i < 10; i++) {
        for (const act of acts) seen.push(tap(env, act, id));
        seen.push(tap(env, "next", id));
      }
      const all = text(seen.join("\n"));
      for (const word of BANNED) {
        const re = new RegExp("\\b" + word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        assert.doesNotMatch(all, re, `"${word}" appeared (${fixture.clientId})`);
      }
      assert.doesNotMatch(all, /\bapproved for\b|\bget approved\b|\bapproval (is|comes)\b/i, "nothing reads as an approval");
      assert.doesNotMatch(all, /Sample File/);
    }
  });

  test("labels are six words or fewer and amounts beyond today say projects to", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    for (let i = 0; i < 4; i++) tap(env, "next", CLIENT_ID);
    const t = text(tap(env, "panel:home", CLIENT_ID));
    assert.match(t, /Projects to/);
    const badges = [...tap(env, "panel:progress", CLIENT_ID).matchAll(/class="fhv-blueprint-demo-badge [^"]*">([^<]+)</g)].map((m) => m[1]);
    assert.ok(badges.length > 0);
    for (const b of badges) assert.ok(b.trim().split(/\s+/).length <= 6, b);
  });
});
