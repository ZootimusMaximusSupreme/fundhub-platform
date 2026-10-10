// The words on a dashboard-built funnel (build unit X4): the prompt carries the
// facts and the laws, and the copy check refuses what the owner laws forbid.
// Pure: no database, no network, no model.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCopy, buildPrompt, offerFactsBlock, numbersIn, pageLines, fundingLeadFailures, COPY_SCHEMA, FUNNEL_MODEL } from "./funnel-copy.mjs";
import { FUNNEL_OFFERS, pagePaths } from "./funnel-paths.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOOD = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures/funnel-copy-good.json"), "utf8"));
const OFFER = { label: "Capital Blueprint", product: FUNNEL_OFFERS.capital_blueprint.product, lane: "uwiq" };
const FACTS = offerFactsBlock(OFFER);
const PRICE = OFFERS.UWIQ_DELIVERABLES.priceCents;
const copy = () => structuredClone(GOOD);
const check = (c, extra = "") => checkCopy(c, { sourceText: `${FACTS}\n${extra}`, priceCents: PRICE });

describe("the copy check", () => {
  test("clean words pass", () => {
    const r = check(copy());
    assert.deepEqual(r.failures, []);
    assert.equal(r.ok, true);
  });

  test("Fundhub spelled any other way is refused", () => {
    const c = copy();
    c.landing.lede = "FundHub reads your file with you on the call.";
    assert.match(check(c).failures.join("\n"), /lowercase h/);
  });

  test("a number that is not in the facts is refused; one that is passes", () => {
    const c = copy();
    c.landing.subhead = "Join 437 owners who got their plan.";
    assert.match(check(c).failures.join("\n"), /"437" is a number that is not in the facts/);
    assert.equal(check(c, "437 owners booked last month.").ok, true);
    const pct = copy();
    pct.booking.lede = "Most calls end with a 30% better plan.";
    assert.match(check(pct).failures.join("\n"), /30%/);
  });

  test("the price never goes on a page, even though it is a fact", () => {
    const c = copy();
    c.landing.cta_note = `One plan, ${formatCents(PRICE)}`;
    assert.match(check(c).failures.join("\n"), /puts the price on the page/);
  });

  test("no testimonials, no quotes, no reviews", () => {
    const quote = copy();
    quote.landing.lede = "“This call changed how I see my credit file forever,” one owner told us.";
    assert.match(check(quote).failures.join("\n"), /quotes someone/);
    const review = copy();
    review.thank_you.lede = "Read our five star reviews while you wait.";
    assert.match(check(review).failures.join("\n"), /testimonial or review/);
  });

  test("no Social Security number talk, no guarantee", () => {
    const ssn = copy();
    ssn.booking.prep = ["Your Social Security number", "A quiet place to talk"];
    assert.match(check(ssn).failures.join("\n"), /Social Security/);
    const g = copy();
    g.landing.subhead = "Approval guaranteed or you pay nothing.";
    assert.match(check(g).failures.join("\n"), /guarantee/);
  });

  test("outcome first: the headline is about the buyer, never about us", () => {
    const c = copy();
    c.landing.headline = "We read credit files for a living";
    assert.match(check(c).failures.join("\n"), /about us/);
  });

  test("lead with funding: the live test's headline is refused (credit before funding, fixing credit)", () => {
    // The headline the writer made in the live test on 2026-10-06 (funnel fnl-blueprint).
    const c = copy();
    c.landing.headline = "Get a clear plan to fix your credit and find funding";
    const f = check(c).failures.join("\n");
    assert.match(f, /puts credit before funding/);
    assert.match(f, /leads with fixing credit or a score\. Fundhub sells funding, never credit repair/);
    assert.equal(check(c).ok, false);
  });

  test("lead with funding: the landing headline must name funding", () => {
    const c = copy();
    c.landing.headline = "Know exactly what stands between you and a plan";
    assert.match(check(c).failures.join("\n"), /does not name funding/);
    for (const ok of [
      "Know exactly what stands between you and funding",
      "Get funded for the most your file allows",
      "Find the capital your business qualifies for",
      "Get approved for the most, then clean up what holds you back"
    ]) {
      const g = copy();
      g.landing.headline = ok;
      assert.deepEqual(fundingLeadFailures(g), [], ok);
    }
  });

  test("lead with funding: no headline and no landing eyebrow leads with fixing credit or a score", () => {
    for (const [role, key, text] of [
      ["landing", "eyebrow", "Credit repair plan"],
      ["landing", "headline", "Funding starts when you raise your score"],
      ["booking", "headline", "Book your credit fix call"],
      ["thank_you", "headline", "Your dispute call is booked, credit cleanup next"]
    ]) {
      const c = copy();
      c[role][key] = text;
      assert.match(fundingLeadFailures(c).join("\n"), new RegExp(`${role}: the ${key} .* leads with fixing credit or a score`), text);
    }
    // Credit work in the body is fine: it is a step on the way to funding.
    const body = copy();
    body.landing.bullets[0].detail = "We clean up the inquiries that cost you fundability.";
    assert.deepEqual(fundingLeadFailures(body), []);
  });

  test("lead with funding: 'score' as a verb and a credit limit are funding, not credit work (M2 repair)", () => {
    for (const ok of [
      "Score $100,000 in business funding",
      "Score the funding your business qualifies for",
      "Get funded and raise your credit limit",
      "Get approved and boost your credit lines"
    ]) {
      const c = copy();
      c.landing.headline = ok;
      assert.deepEqual(fundingLeadFailures(c), [], ok);
      // The whole check passes too (the $100,000 is in the facts it is given).
      assert.equal(check(c, "The most a file can reach is $100,000 in business funding.").ok, true, ok);
    }
    // The same words on the other pages and the eyebrow pass too.
    const c = copy();
    c.landing.eyebrow = "Score the capital you need";
    c.booking.headline = "Raise your credit limit on a call";
    c.thank_you.headline = "Your funding call is booked";
    assert.deepEqual(fundingLeadFailures(c), []);
  });

  test("lead with funding: a score the buyer has, and credit work, are still refused", () => {
    for (const bad of [
      "Know your score before you apply for funding",
      "Improve your credit score and get funded",
      "Raise your score, then get funding",
      "Fix your credit, then get funded",
      "Credit score too low? Funding starts here"
    ]) {
      const c = copy();
      c.landing.headline = bad;
      assert.notDeepEqual(fundingLeadFailures(c), [], bad);
    }
    const c = copy();
    c.booking.headline = "Book your score check call";
    assert.match(fundingLeadFailures(c).join("\n"), /booking: the headline .* leads with fixing credit or a score/);
  });

  test("the ad checker's hook rule holds on the landing headline only", () => {
    const land = copy();
    land.landing.headline = "Book your call today";
    assert.match(check(land).failures.join("\n"), /landing: cause-first/);
    const book = copy();
    book.booking.headline = "Book the time that works for you";
    assert.equal(check(book).failures.filter((f) => /cause-first/.test(f)).length, 0);
  });

  test("Part 0 words and banned words are refused", () => {
    const c = copy();
    c.landing.lede = "We could fix your credit repair problems and unlock the power of funding.";
    const out = check(c).failures.join("\n");
    assert.match(out, /could/);
    assert.match(out, /credit repair/);
    assert.match(out, /unlock the power of/);
  });

  test("HTML or links in the words are refused", () => {
    const c = copy();
    c.landing.cta_note = "<script>alert(1)</script>";
    assert.match(check(c).failures.join("\n"), /HTML or a link/);
  });

  test("empty fields and wrong list lengths are named", () => {
    const c = copy();
    c.landing.headline = "";
    c.landing.steps = c.landing.steps.slice(0, 2);
    c.booking.prep = [];
    const out = check(c).failures.join("\n");
    assert.match(out, /landing\.headline is empty/);
    assert.match(out, /landing\.steps has 2 items; it needs 3/);
    assert.match(out, /booking\.prep has 0 items; it needs 2 to 4/);
    assert.equal(checkCopy(null).ok, false);
  });
});

describe("the prompt", () => {
  test("carries the facts from src/config/offers.mjs and says no price", () => {
    const { system, user } = buildPrompt({ offer: OFFER, paths: pagePaths("/blueprint") });
    assert.match(user, /Capital Blueprint/);
    for (const item of OFFERS.UWIQ_DELIVERABLES.contents) assert.ok(user.includes(item), item);
    assert.ok(user.includes(formatCents(PRICE)), "the price is a fact the model is told");
    assert.match(user, /Do NOT put any price on these pages/);
    assert.match(user, /No avatar, offer or copy file exists/);
    assert.match(system, /Fundhub/);
    assert.match(system, /Never invent a number/);
    assert.match(system, /Social Security/);
    assert.match(system, /Lead with funding\. Fundhub sells funding, never credit repair/);
    assert.match(system, /inquiries cost fundability/);
  });

  test("names the campaign files when there are some, and the failures to fix", () => {
    const { user } = buildPrompt({
      offer: OFFER, paths: pagePaths("/blueprint"),
      sources: { avatar: "Owners who were told no.", offer: "", copy: "Hook lines.", ownerNotes: "" },
      fix: ["landing: \"437\" is a number that is not in the facts."]
    });
    assert.match(user, /WHO WE SELL TO/);
    assert.match(user, /APPROVED AD COPY/);
    assert.doesNotMatch(user, /No avatar, offer or copy file exists/);
    assert.match(user, /FAILED THESE CHECKS[\s\S]*437/);
  });

  test("the schema asks for words only, every key required", () => {
    assert.equal(FUNNEL_MODEL, "claude-opus-5-5");
    assert.deepEqual(COPY_SCHEMA.required, ["landing", "booking", "thank_you"]);
    for (const role of COPY_SCHEMA.required) {
      const s = COPY_SCHEMA.properties[role];
      assert.equal(s.additionalProperties, false);
      assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
    }
  });
});

describe("small helpers", () => {
  test("numbersIn reads dollar amounts, percents and plain numbers", () => {
    assert.deepEqual([...numbersIn("$5,000 and 12% and 3 steps")].sort(), ["12", "3", "5000"]);
  });

  test("pageLines starts with the headline", () => {
    assert.equal(pageLines(GOOD, "landing")[0], GOOD.landing.headline);
    assert.deepEqual(pageLines({}, "landing"), []);
  });
});
