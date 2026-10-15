// Batch 04, practice test for one control that leaves no saved result:
// the closer's cockpit script on public/app/present.html. It is drawn on the
// screen and nothing is written, so a live check has nothing to read. This runs
// the real page in Chromium with a fake deck read and judges what the closer is
// told to say: the line filter (FUND / REPAIR / EDU), [First Name], and the close
// wrap that follows the offer actually chosen.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";

const CLOSER = { ok: true, staff: { ...OWNER.staff, role: "closer" } };
const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";

const OFFERS = [
  ["REPAIR_DFY", "Repair done for you", 150000, "$1,500", false],
  ["REPAIR_TRIAL", "Repair trial", 50000, "$500", false],
  ["FUNDING_DFY", "Funding done for you", 500000, "$5,000", false],
  ["UWIQ_DELIVERABLES", "Capital Blueprint", 50000, "$500", false],
  ["FUNDING_MASTERY", "Funding Mastery", 500000, "$5,000", false]
].map(([key, name, priceCents, priceDisplay, letters]) => ({ key, name, priceCents, priceDisplay, letters }));

const deckFor = (tier, name = "Dana Whitfield") => ({
  ok: true,
  survey: { name },
  businesses: [],
  income_estimates: {},
  engine: { available: true, tier, fico: { experian: 700, equifax: 700, transunion: 700 }, reasons: [], total: 0 },
  offers: OFFERS,
  soft_pull: null
});

async function openDeck(open, tier, name) {
  const opened = await open(`/app/present.html?contact=${CLIENT}`, {
    session: CLOSER,
    handlers: { "/api/read/closer-deck": async (route) => json(route, deckFor(tier, name)) }
  });
  await opened.page.waitForSelector('[data-act="phase:03"]');
  return opened;
}

const saysNow = (page) => page.$$eval(".cockpit .say", (els) => els.map((el) => el.textContent.trim()));
const titleNow = (page) => page.$eval(".cockpit .ck-hd .t", (el) => el.textContent.trim());

async function toReveal(page) {
  await page.locator('[data-act="phase:03"]').click();
  await page.locator('[data-act="next"]').first().click();
  await page.locator('[data-act="next"]').first().click();
  await page.waitForFunction(() => /The reveal \+ the sort/.test(document.querySelector(".cockpit .ck-hd .t")?.textContent || ""));
}

async function toWrap(page) {
  await page.locator('[data-act="phase:07"]').click();
  await page.locator('[data-act="next"]').first().click();
  await page.waitForFunction(() => /Wrap/.test(document.querySelector(".cockpit .ck-hd .t")?.textContent || ""));
}

const FUND = "Alright Dana, the results are in. We can get you pre-approved for approximately [Amount] across multiple credit lines with 0 percent introductory rates.";
const REPAIR = "The results came back, and here's what the AI found. Some factors are limiting your approval potential. The good news: all fixable.";
const EDU = "If their ask is 'teach me to do this myself', route Education below. The sort still gets named first.";

test("the reveal slide says the funding line to a funding client and nothing from the other two routes", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "FULL_FUNDING");
  await toReveal(page);
  assert.deepEqual(await saysNow(page), [FUND, "Pause. Let the number land. Then: how does that sound?"]);
  await page.close();
});

test("the reveal slide says the repair line to a repair client and nothing from the other two routes", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "REPAIR_ONLY");
  await toReveal(page);
  assert.deepEqual(await saysNow(page), [REPAIR]);
  await page.close();
});

test("the education path button swaps the cockpit to the education line only", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "FULL_FUNDING");
  await toReveal(page);
  await page.locator('[data-act="edu"]').click();
  await page.waitForFunction(() => !/pre-approved for approximately/.test(document.querySelector(".cockpit")?.textContent || ""));
  assert.deepEqual(await saysNow(page), [EDU]);
  await page.close();
});

test("[First Name] is the client's first word, and stays as written when no name is on file", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const named = await openDeck(open, "FULL_FUNDING", "Dana Whitfield");
  assert.equal(await titleNow(named.page), "Rapport");
  assert.match((await saysNow(named.page))[0], /^Hey Dana! It's \[Your Name\] over at Fundhub\./);
  await named.page.close();
  const nameless = await openDeck(open, "FULL_FUNDING", "");
  assert.match((await saysNow(nameless.page))[0], /^Hey \[First Name\]! It's \[Your Name\] over at Fundhub\./);
  await nameless.page.close();
});

test("the closing wrap follows the offer that was chosen, not the funding wrap for everyone", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);

  const funding = await openDeck(open, "FULL_FUNDING");
  await toWrap(funding.page);
  assert.match((await saysNow(funding.page))[0], /^Within 24 business hours your funding advisor reaches out and starts on your file\./);
  assert.match((await saysNow(funding.page)).at(-1), /Congratulations, Dana\. You made a great decision\./);
  await funding.page.close();

  const repair = await openDeck(open, "REPAIR_ONLY");
  await toWrap(repair.page);
  assert.match((await saysNow(repair.page))[0], /^Round one goes out today, built from the pull we just ran\./);
  assert.equal((await saysNow(repair.page)).some((l) => /funding advisor|applications are submitted/.test(l)), false);
  await repair.page.close();

  const education = await openDeck(open, "FULL_FUNDING");
  await toReveal(education.page);
  await education.page.locator('[data-act="edu"]').click();
  await toWrap(education.page);
  assert.match((await saysNow(education.page))[0], /^Your access gets set up on this call/);
  assert.equal((await saysNow(education.page)).some((l) => /funding advisor|applications are submitted/.test(l)), false);
  await education.page.close();
});

// ── repair cycle 1: every offer's wrap, every route, the watch-for text ─────────
//
// The first version held three of the five close wraps and two of the four routes.
// An independent checker changed the product eight ways and the test stayed green:
// the Blueprint wrap swapped for the funding wrap, the trial wrap promising an
// advisor, a watch-for line telling the closer to guarantee deletions, the offer
// picked on rung 1 wrong on the repair and the education ladders, the funding-plus-
// repair tier no longer counted as funding, and the descent route ignored. Each of
// those is a promise made out loud to a client about what they just bought. So the
// whole matrix is pinned here: for each route the closer can be on, the offer that
// is chosen, the exact wrap words, and the exact "Watch for" words.

const nextTitle = (page) => page.$eval(".cockpit .ck-hd .t", (el) => el.textContent.trim());
const watchNow = (page) => page.$eval(".cockpit .watch div", (el) => el.textContent.trim());

async function walkTo(page, title) {
  for (let i = 0; i < 40; i += 1) {
    if (title.test(await nextTitle(page))) return;
    await page.locator('[data-act="next"]').first().click();
  }
  assert.fail(`never reached a slide titled ${title}`);
}

const CLOSE_LOGISTICS = [
  "Awesome. Let's get this going. I'm sending the agreement right now. Best email for that?",
  "Review it while I get your billing info. What's your billing address?",
  "Collect the card. Fire the pay link. Keep them on the line until it posts."
];
const CLOSE_LOGISTICS_WATCH = "Do not celebrate. Do not over-explain. No time to second-guess.";

const WRAPS = {
  FUNDING_DFY: {
    lines: [
      "Within 24 business hours your funding advisor reaches out and starts on your file. Within 72 business hours your first applications are submitted.",
      "Any questions before we wrap? ... Congratulations, Dana. You made a great decision. We're going to get to work on this. Talk soon."
    ],
    watch: "Confirm the payment posted before ending the call. Then log the disposition."
  },
  REPAIR_DFY: {
    lines: [
      "Round one goes out today, built from the pull we just ran. It lands in your email and in your dashboard.",
      "The bureaus have 30 to 45 days to answer each round, and you watch every dispute and every response happen live.",
      "Any questions before we wrap? ... Congratulations, Dana. Talk soon."
    ],
    watch: "No advisor and no applications on this sale — it is credit repair. Never promise a deletion, a score, or a result. Confirm the payment posted, then log the disposition."
  },
  REPAIR_TRIAL: {
    lines: [
      "We run your first full round today, bureaus and creditors, built from the pull we just ran.",
      "You watch every dispute and every response in your dashboard. After the round you decide whether to keep going.",
      "Any questions before we wrap? ... Talk soon, Dana."
    ],
    watch: "One round, then their decision. Do not describe it as the full program. Never promise a deletion, a score, or a result."
  },
  UWIQ_DELIVERABLES: {
    lines: [
      "Your deliverables generate from the pull we just ran and land in your email today, with the how-to course.",
      "You run it at your own pace. Nobody is working the file for you on this one — that's the whole point of it.",
      "Whenever you want us to run the process for you instead, we're here. Any questions before we wrap?"
    ],
    watch: "This is a do-it-yourself purchase. No advisor, no applications submitted, no funding promised."
  },
  FUNDING_MASTERY: {
    lines: [
      "Your access gets set up on this call, and the deliverables from today's pull land in your email.",
      "You work through the program at your own pace. This is education — you do the work, on your own file.",
      "Whenever you're ready for us to run the full funding process for you, we're here. Any questions before we wrap?"
    ],
    watch: "This is an education sale. Do not promise an advisor, submitted applications, or funding."
  }
};

// What the investment slide (S-19) says to the closer on each of the three routes.
const INVESTMENT = {
  FUND: [
    "Based on your pre-approval, I genuinely believe we get you to [Amount] in two weeks. To activate the system today, it's a $3,000 deposit.",
    "That $3,000 is not an additional fee. It goes directly toward your 10 percent success fee on the back end."
  ],
  REPAIR: ["Top down. Onboard now, full done-for-you, $1,000, letters fire today. If that's a no: trial round, we run your first round so you see it work, $200. Still a no: $1,000, the full deliverables plus course, you execute it."],
  EDU: ["Lead with the $5,000 full program. Only if that's a no: the $1,000 deliverables package plus the how-to course."]
};
const INVESTMENT_WATCH = "Rung buttons below on repair. Do NOT lead with the cheaper one.";

/**
 * Every way a closer can reach a sale, and what the cockpit must then say.
 * `setup` runs from the first slide and ends on S-19 ("The investment").
 * `fund` / `repair` / `edu` is which line bucket that slide must show.
 */
const ROUTES = [
  { name: "funding, full funding tier", offer: "FUNDING_DFY", tier: "FULL_FUNDING", bucket: "FUND",
    setup: async () => {} },
  { name: "funding plus repair tier", offer: "FUNDING_DFY", tier: "FULL_FUNDING", bucket: "FUND",
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="tier:FUNDING_PLUS_REPAIR"]').click(); } },
  { name: "repair only, top rung", offer: "REPAIR_DFY", tier: "REPAIR_ONLY", bucket: "REPAIR",
    setup: async () => {} },
  { name: "repair only, trial rung", offer: "REPAIR_TRIAL", tier: "REPAIR_ONLY", bucket: "REPAIR", rung: 1,
    setup: async () => {} },
  { name: "repair only, DIY rung", offer: "UWIQ_DELIVERABLES", tier: "REPAIR_ONLY", bucket: "REPAIR", rung: 2,
    setup: async () => {} },
  { name: "funding client sent down the descent to repair", offer: "REPAIR_DFY", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:dfy"]').click(); } },
  { name: "funding client sent down the descent to the trial", offer: "REPAIR_TRIAL", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:trial"]').click(); } },
  { name: "funding client sent down the descent to DIY", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:diy"]').click(); } },
  { name: "education path, Funding Mastery", offer: "FUNDING_MASTERY", tier: "FULL_FUNDING", bucket: "EDU",
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="edu"]').click(); } },
  { name: "education path, deliverables rung", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "EDU", rung: 1,
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="edu"]').click(); } },
  { name: "descent to the education top rung", offer: "FUNDING_MASTERY", tier: "FULL_FUNDING", bucket: "EDU",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:eduTop"]').click(); } },
  { name: "descent to the education low rung", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "EDU",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:eduLow"]').click(); } }
];

for (const route of ROUTES) {
  test(`${route.name}: the investment slide, the close and the wrap are the ${route.offer} ones`, { timeout: 120_000 }, async (t) => {
    const { open } = await startScreens(t);
    const { page } = await openDeck(open, route.tier);
    await route.setup(page);
    await walkTo(page, /The investment/);

    // the lines for this route's bucket, and none from the other two
    const says = await saysNow(page);
    assert.deepEqual(says, INVESTMENT[route.bucket], `${route.name}: lines on The investment`);
    assert.equal(await watchNow(page), INVESTMENT_WATCH);

    if (route.rung !== undefined) {
      await page.locator(`[data-act="rung:${route.rung}"]`).click();
    }

    await walkTo(page, /The close\. Logistics/);
    assert.deepEqual(await saysNow(page), CLOSE_LOGISTICS, `${route.name}: close logistics`);
    assert.equal(await watchNow(page), CLOSE_LOGISTICS_WATCH);

    await page.locator('[data-act="next"]').first().click();
    assert.equal(await nextTitle(page), "Wrap");
    const wrap = WRAPS[route.offer];
    assert.deepEqual(await saysNow(page), wrap.lines, `${route.name}: the wrap words`);
    assert.equal(await watchNow(page), wrap.watch, `${route.name}: the watch-for words`);
    await page.close();
  });
}
