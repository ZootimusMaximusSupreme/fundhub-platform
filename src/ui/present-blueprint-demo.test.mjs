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
//   * the checklist catalog follows the owner's paydown-first call order
//   * a tap changes the state, and the state survives a re-render
//   * broken data never throws

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createContext, runInContext } from "node:vm";
import { fileURLToPath } from "node:url";

import { FULL, SAMPLE, REPAIR, HOLD, NONE, BAD, BANNED, THRESHOLD_LABEL, CLIENT_ID, deckMoney, deckEsc } from "../../e2e/fixtures/present-blueprint-demo-ctx.mjs";

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
/* The words with the engine's own "$5,000+ limit" threshold taken out, so a
   "no dollar figure" check reads only client amounts. */
const amounts = (html) => text(html).split(THRESHOLD_LABEL).join("");
const heroTo = (html) => { const m = html.match(/data-key="qualify" data-to="(\d+)"/); return m ? Number(m[1]) : null; };
const heroCard = (html) => { const m = html.match(/<section class="fhv-blueprint-demo-card fhv-blueprint-demo-hero">([\s\S]*?)<\/section>/); return m ? m[1] : ""; };

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

describe("B-03 paydown-first order diagram", () => {
  for (const fixture of [FULL, SAMPLE, NONE, REPAIR, HOLD]) {
    test(`${fixture.clientId}: shows the same five phases without adding an unsupported amount`, () => {
      const env = load();
      const html = env.FHV.blueprintDemo(withHelpers(fixture));
      const phases = [...html.matchAll(/data-bd-phase="([^"]+)"/g)].map((m) => m[1]);
      assert.deepEqual(phases, ["paydown", "disputes", "business1", "business2", "fundability"]);
      assert.match(html, /data-bd-phase="paydown" aria-current="step"/);
      assert.match(text(html), /1 Pay cards down 2 Dispute items 3 Business 1 4 Business 2 5 More fundability/);
      assert.match(text(html), /Step 1 of \d+: Pay/);
      if (fixture.sample) assert.match(html, /fhv-blueprint-demo-tag">Sample</);
      if (!fixture.visual) assert.doesNotMatch(amounts(html), /\$/);
      if (fixture === REPAIR) assert.equal(heroTo(html), 0);
      if (fixture === HOLD) assert.equal(heroTo(html), null);
      const cardSteps = fixture.visual && Array.isArray(fixture.visual.cards) && fixture.visual.cards.length ? fixture.visual.cards.length : 1;
      let after = html;
      for (let i = 0; i < cardSteps; i++) after = tap(env, "next", fixture.clientId);
      assert.match(after, /data-bd-phase="disputes" aria-current="step"/);
      assert.match(after, /fhv-blueprint-demo-orderdone" data-bd-phase="paydown"/);
    });
    test(`${fixture.clientId}: the visible build reaches the 12-month view in five taps`, () => {
      const env = load();
      const id = fixture.clientId;
      let html = env.FHV.blueprintDemo(withHelpers(fixture));
      assert.equal((html.match(/data-bd-act="goto:/g) || []).length, 5, "five phase chips");
      for (let i = 0; i < 5; i++) {
        html = tap(env, "build", id);
        if (i < 4) assert.match(html, /data-bd-act="build"/);
      }
      assert.match(text(html), /Your next 12 months/);
      assert.match(html, /data-bd-act="restart"/);
      assert.doesNotMatch(html, /data-bd-act="build"/);
      if (!fixture.visual) assert.doesNotMatch(amounts(html), /\$/);
    });
  }
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
    assert.match(t, /From today’s pull\. Fully optimized: projects to \$121,000\./);
    assert.match(t, /Step 1 of 9: Pay Capital One Quicksilver down to \$1,600/);
    assert.match(t, /Do not open new credit while we work on your file\./);
    assert.doesNotMatch(t, /Sample/, "a real pull carries no sample tag");
    assert.match(html, /<button type="button" class="fhv-blueprint-demo-nextbtn" data-bd-act="build">Next step<\/button>/);
  });

  test("the steps put card paydown first, then disputes and the businesses", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(FULL));
    assert.deepEqual(host(steps.map((s) => s.key)), ["card0", "card1", "mail", "proof", "bureaus", "business", "biz1", "biz2", "sequence"]);
    assert.deepEqual(host(steps.slice(0, 6).map((s) => s.day)), [30, 30, 14, 21, 45, 30]);
    assert.equal(steps[0].title, "Pay Capital One Quicksilver down to $1,600");
    assert.equal(steps[1].title, "Pay Discover it down to $900");
    assert.deepEqual(host(steps[5].subs), ["File your LLC", "Get your EIN from the IRS", "Open a business checking account"]);
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

    // The first card moves, while negative items remain on the file.
    html = tap(env, "next", CLIENT_ID);
    assert.match(text(html), /Midland Credit Management Collection · Experian, Equifax On your file/);
    assert.doesNotMatch(text(html), /If it comes off/, "not answered yet");

    // The second card completes paydown. Mailing the letters follows.
    html = tap(env, "next", CLIENT_ID);
    let t = text(html);
    assert.match(t, /\$1,600 of \$16,000 10% used/);
    assert.match(t, /\$900 of \$9,000 10% used/);
    assert.match(t, /At target/);
    html = tap(env, "panel:home", CLIENT_ID);
    t = text(html);
    assert.match(t, /\$88,000/);
    assert.match(t, /After the cards are paid down\./);
    assert.match(t, /Step 3 of 9: Print and mail your dispute letters/);

    // Letters, proof, then the bureaus answer: the clean lever, "if it comes off".
    tap(env, "next", CLIENT_ID);
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

    // Business setup, Business 1, Business 2, then the next sequence.
    tap(env, "next", CLIENT_ID);
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
  test("the sample is tagged and prints the engine's amounts for the deck's sample file", () => {
    const env = load();
    const html = env.FHV.blueprintDemo(withHelpers(SAMPLE));
    const t = text(html);
    assert.match(html, /<span class="fhv-blueprint-demo-tag">Sample<\/span>/);
    assert.match(t, /\$24,749/);
    assert.match(t, /Fully optimized: projects to \$55,000\./);
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(SAMPLE));
    assert.deepEqual(host(steps.map((s) => s.key)), ["card0", "mail", "proof", "bureaus", "business", "biz1", "biz2", "sequence"]);
    assert.equal(steps[0].title, "Pay First Platypus Bank Visa down to $800");
    assert.equal(steps[5].name, "Fundhub LLC", "the deck's business when the engine lists no company");
    assert.equal(steps[5].amount, null);
    assert.equal(steps[6].name, "If you add a company");
    assert.equal(steps[6].amount, null, "newCompany null means no amount");
    // The climb: today, after the card, after the bureaus answer.
    tap(env, "next", SAMPLE.clientId);
    assert.equal(heroTo(tap(env, "panel:home", SAMPLE.clientId)), 33000);
    tap(env, "next", SAMPLE.clientId); tap(env, "next", SAMPLE.clientId); tap(env, "next", SAMPLE.clientId);
    assert.equal(heroTo(tap(env, "panel:home", SAMPLE.clientId)), 55000);
  });

  test("with no fundability count, the Fundability tab shows the six checks and what the plan does for each", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(SAMPLE));
    let t = text(tap(env, "tab:fundability", SAMPLE.clientId));
    assert.match(t, /Six checks\. Every step works on one\./);
    assert.match(t, /UnderwriteIQ counts them on your next pull\./);
    assert.doesNotMatch(t, /of 6/, "no count means no meter");
    assert.match(t, /Cards used 30% or less 0 of 1 card at target\. In progress/);
    assert.match(t, /No negative items 1 item on your file\. In progress/);
    assert.match(t, /No hard inquiries No new credit while we work\./);
    tap(env, "next", SAMPLE.clientId); // card
    t = text(tap(env, "tab:fundability", SAMPLE.clientId));
    assert.match(t, /Every card at its 10% target\. Done/);
    tap(env, "next", SAMPLE.clientId); // letters
    t = text(tap(env, "tab:fundability", SAMPLE.clientId));
    assert.match(t, /Letters out\. Disputed\. In progress/);
    tap(env, "next", SAMPLE.clientId); tap(env, "next", SAMPLE.clientId); // proof, bureaus
    t = text(tap(env, "tab:fundability", SAMPLE.clientId));
    assert.match(t, /Bureau answered\. If they come off\. Answered/);
    assert.doesNotMatch(t, /removed/i);
  });

  test("a repair-only file shows $0 today, and the climb is the pitch", () => {
    const env = load();
    const id = REPAIR.clientId;
    let html = env.FHV.blueprintDemo(withHelpers(REPAIR));
    assert.equal(heroTo(html), 0);
    let hero = text(heroCard(html));
    assert.match(hero, /\$0 Today From today’s pull\. Fully optimized: projects to \$41,000\./);
    tap(env, "next", id); // the one card
    html = tap(env, "panel:home", id);
    assert.equal(heroTo(html), 0, "the paydown lever does not apply, so the card step moves nothing");
    assert.match(text(heroCard(html)), /Today/);
    for (let i = 0; i < 3; i++) tap(env, "next", id); // letters, proof, bureaus
    html = tap(env, "panel:home", id);
    assert.equal(heroTo(html), 41000);
    hero = text(heroCard(html));
    assert.match(hero, /\$41,000 If the disputed items come off\. The fully optimized file\./);
    assert.doesNotMatch(hero, /Today/);
  });

  test("when the engine holds the money there is no qualify amount, and the steps and cards still work", () => {
    const env = load();
    const id = HOLD.clientId;
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(HOLD));
    assert.equal(steps[0].title, "Pay Chase Freedom down to $1,200");
    assert.equal(steps[7].name, "If you add a company");
    assert.equal(steps[7].amount, null);
    let html = env.FHV.blueprintDemo(withHelpers(HOLD));
    assert.equal(heroTo(html), null);
    assert.match(text(html), /UnderwriteIQ has not printed an amount for this pull\. The steps still move\./);
    assert.doesNotMatch(text(html).replace(/\$1,200/g, ""), /\$/, "no amount on Home but the card target in the step title");
    const credit = text(tap(env, "panel:money", id));
    assert.match(credit, /Chase Freedom Pay down \$5,100 of \$12,000 43% used · target \$1,200/);
    assert.match(credit, /LVNV Funding Collection · Equifax On your file/);
    for (let i = 0; i <= steps.length; i++) {
      html = tap(env, "next", id);
      assert.equal(heroTo(tap(env, "panel:home", id)), null, "step " + i + " printed a qualify amount");
    }
    const end = text(tap(env, "panel:home", id));
    assert.match(end, /Your next 12 months/);
    assert.doesNotMatch(end, /projects to \$/, "nothing projects when the engine holds the money");
  });

  test("no pull yet: the steps show with no amount anywhere", () => {
    const env = load();
    const home = env.FHV.blueprintDemo(withHelpers(NONE));
    assert.doesNotMatch(amounts(home), /\$/, "no dollar figure without a pull");
    assert.match(text(home), /No pull yet\./);
    assert.match(text(home), /Fills in from today’s pull\./);
    assert.match(text(home), /Step 1 of 8: Pay each card down to 10% of its limit/);
    const steps = env.FHV._blueprintDemo.buildSteps(withHelpers(NONE));
    assert.deepEqual(host(steps.map((s) => s.key)), ["cards", "mail", "proof", "bureaus", "business", "biz1", "biz2", "sequence"]);
    assert.equal(steps[0].title, "Pay each card down to 10% of its limit");
    for (const act of ["panel:progress", "panel:money", "tab:fundability", "tab:strategy", "tab:banks", "next", "next", "next"]) {
      const html = tap(env, act, "no-pull-yet");
      assert.doesNotMatch(amounts(html), /\$/, act + " printed a dollar figure with no pull");
    }
    assert.match(text(tap(env, "tab:fundability", "no-pull-yet")), /Fills in from today’s pull\./);
  });

  test("broken data never throws and still shows the plan", () => {
    const env = load();
    let html;
    assert.doesNotThrow(() => { html = env.FHV.blueprintDemo({ ...structuredClone(BAD), money: deckMoney, esc: deckEsc }); });
    assert.match(html, /data-fhv="blueprint-demo"/);
    assert.match(text(html), /Pay this card down/);
    assert.doesNotThrow(() => env.FHV.blueprintDemo(null));
    assert.doesNotThrow(() => env.FHV.blueprintDemo({ visual: { cards: 3 } }));
    assert.match(env.FHV.blueprintDemo(null), /data-fhv="blueprint-demo"/);
  });
});

describe("the owner's words", () => {
  test("no banned word on any screen, in any state", () => {
    for (const fixture of [FULL, SAMPLE, REPAIR, HOLD, NONE]) {
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
    assert.match(t, /projects to/);
    const badges = [...tap(env, "panel:progress", CLIENT_ID).matchAll(/class="fhv-blueprint-demo-badge [^"]*">([^<]+)</g)].map((m) => m[1]);
    assert.ok(badges.length > 0);
    for (const b of badges) assert.ok(b.trim().split(/\s+/).length <= 6, b);
  });
});

describe("the amount and the cards agree with the steps", () => {
  const dollars = (n) => deckMoney(n).replace(/\$/g, "\\$");

  test("the amount equals paydown.totalAfter after the last card step, then clean.totalAfter after the bureaus answer", () => {
    const env = load();
    env.FHV.blueprintDemo(withHelpers(FULL));
    const levers = FULL.visual.levers;
    tap(env, "next", CLIENT_ID); // card 1 of 2
    let html = tap(env, "panel:home", CLIENT_ID);
    assert.equal(heroTo(html), FULL.visual.todayTotal, "one card paid is not all the cards");
    assert.match(text(heroCard(html)), /Today/);

    tap(env, "next", CLIENT_ID); // card 2 of 2
    html = tap(env, "panel:home", CLIENT_ID);
    assert.equal(heroTo(html), levers[0].totalAfter);
    let hero = text(heroCard(html));
    assert.match(hero, /\$88,000/);
    assert.match(hero, /After the cards are paid down\./);
    assert.match(hero, /Fully optimized: projects to \$121,000\./);
    assert.doesNotMatch(hero, /Today/, "the Today badge shows only on today's amount");
    assert.equal((hero.match(/projects to/gi) || []).length, 1, "projects to is said once");

    tap(env, "next", CLIENT_ID); // letters
    tap(env, "next", CLIENT_ID); // proof
    tap(env, "next", CLIENT_ID); // the bureaus answer
    html = tap(env, "panel:home", CLIENT_ID);
    assert.equal(heroTo(html), levers[1].totalAfter);
    hero = text(heroCard(html));
    assert.match(hero, /\$121,000/);
    assert.match(hero, /If the disputed items come off\./);
    assert.match(hero, /The fully optimized file\./);
    assert.doesNotMatch(hero, /Today/);
  });

  function cardRows(html) {
    return html.split('<div class="fhv-blueprint-demo-cardrow">').slice(1).map((chunk) => ({
      fill: (chunk.match(/class="fhv-blueprint-demo-fill" style="width:([^"]+)"/) || [])[1],
      balance: Number((chunk.match(/data-key="bal\d+" data-to="(\d+)"/) || [])[1]),
      pct: Number((chunk.match(/data-key="pct\d+" data-to="(\d+)"/) || [])[1]),
      badge: (chunk.match(/fhv-blueprint-demo-badge-(?:ok|warn)">([^<]+)</) || [])[1],
      words: text(chunk)
    }));
  }

  test("each card's text matches its bar and its badge, before and after its own step", () => {
    for (const fixture of [FULL, SAMPLE, REPAIR, HOLD]) {
      const env = load();
      env.FHV.blueprintDemo(withHelpers(fixture));
      const id = fixture.clientId;
      const cards = fixture.visual.cards;
      const expectRows = (html, doneCount) => {
        const rows = cardRows(html);
        assert.equal(rows.length, cards.length, `${id}: one row per card`);
        rows.forEach((row, i) => {
          const card = cards[i];
          const done = i < doneCount;
          const bal = done ? Math.min(card.balance, card.target) : card.balance;
          const pct = Math.round((bal / card.limit) * 100);
          const where = `${id} card ${i} after ${doneCount} card step(s)`;
          assert.equal(row.balance, bal, `${where}: balance`);
          assert.equal(row.pct, pct, `${where}: percent`);
          assert.equal(row.fill, pct + "%", `${where}: bar`);
          assert.equal(row.badge, done ? "At target" : "Pay down", `${where}: badge`);
          assert.match(row.words, new RegExp(dollars(bal) + " of " + dollars(card.limit) + " " + pct + "% used"), `${where}: words`);
        });
      };
      expectRows(tap(env, "panel:money", id), 0);
      for (let k = 1; k <= cards.length; k++) expectRows(tap(env, "next", id), k);
    }
  });
});
