// The words on a dashboard-built funnel (build unit X4): the prompt carries the
// facts and the laws, and the copy check refuses what the owner laws forbid.
// Pure: no database, no network, no model.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkCopy, buildPrompt, offerFactsBlock, numbersIn, pageLines, COPY_SCHEMA, FUNNEL_MODEL } from "./funnel-copy.mjs";
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
