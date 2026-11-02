// Batch 04, practice test for one control that leaves no saved result:
// the closer's cockpit script on public/app/present.html. It is drawn on the
// screen and nothing is written, so a live check has nothing to read. This runs
// the real page in Chromium with a fake deck read and judges what the closer is
// told to say: the line filter (FUND / REPAIR / EDU), [First Name], and the close
// wrap that follows the offer actually chosen.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { OWNER, json, startScreens } from "./s4-screen-harness.mjs";

// The course is off until it is filmed (COURSE_LIVE in present.js). The education route is judged on the real page
// with the one switch turned on in the script the browser is served.
const PRESENT_JS = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app/present.js"), "utf8");
const COURSE_OFF = "var COURSE_LIVE = false;";
assert.ok(PRESENT_JS.includes(COURSE_OFF), "present.js lost its one course switch");
const PRESENT_JS_COURSE = PRESENT_JS.replace(COURSE_OFF, "var COURSE_LIVE = true;");

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
  soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "crs-test", sample: false }
});

async function openDeck(open, tier, name, { course = false } = {}) {
  const opened = await open(`/app/present.html?contact=${CLIENT}`, {
    session: CLOSER,
    handlers: { "/api/read/closer-deck": async (route) => json(route, deckFor(tier, name)) },
    before: course
      ? (page) => page.route("**/app/present.js", (route) => route.fulfill({ status: 200, contentType: "text/javascript", body: PRESENT_JS_COURSE }))
      : null
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
  await page.locator('[data-act="phase:09"]').click();
  await page.locator('[data-act="next"]').first().click();
  await page.waitForFunction(() => /Wrap/.test(document.querySelector(".cockpit .ck-hd .t")?.textContent || ""));
}

const FUND = "Here is what your file supports today: [amount on screen]. A lender still decides each application.";
const REPAIR = "These are the specific items the report found. The higher amount is a projection after those changes, not a bank approval.";
const EDU = "If they ask to learn, name the file's path first. The Capital Blueprint is the guided plan; Capital Academy stays off until it is filmed.";

test("the reveal slide says the funding line to a funding client and nothing from the other two routes", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "FULL_FUNDING");
  await toReveal(page);
  assert.deepEqual(await saysNow(page), [FUND, "Here is what holds the rest back: [items on screen]. What stands out to you?"]);
  await page.close();
});

test("the reveal slide says the repair line to a repair client and nothing from the other two routes", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "REPAIR_ONLY");
  await toReveal(page);
  assert.deepEqual(await saysNow(page), [REPAIR]);
  await page.close();
});

test("with the course off there is no education path button on the reveal slide", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "FULL_FUNDING");
  await toReveal(page);
  assert.equal(await page.locator('[data-act="edu"]').count(), 0);
  assert.equal(await page.locator('[data-act="tier:FULL_FUNDING"]').count(), 1, "the three route buttons stay");
  await page.close();
});

test("the education path button (course switch on) swaps the cockpit to the education line only", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDeck(open, "FULL_FUNDING", undefined, { course: true });
  await toReveal(page);
  await page.locator('[data-act="edu"]').click();
  await page.waitForFunction(() => !/That's what your file supports today/.test(document.querySelector(".cockpit")?.textContent || ""));
  assert.deepEqual(await saysNow(page), [EDU]);
  await page.close();
});

test("[First Name] is the client's first word, and stays as written when no name is on file", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const named = await openDeck(open, "FULL_FUNDING", "Dana Whitfield");
  assert.equal(await titleNow(named.page), "Rapport");
  assert.match((await saysNow(named.page))[0], /^Hey Dana, it's \[Your Name\] with Fundhub\./);
  await named.page.close();
  const nameless = await openDeck(open, "FULL_FUNDING", "");
  assert.match((await saysNow(nameless.page))[0], /^Hey \[First Name\], it's \[Your Name\] with Fundhub\./);
  await nameless.page.close();
});

test("the closing wrap follows the offer that was chosen, not the funding wrap for everyone", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);

  const funding = await openDeck(open, "FULL_FUNDING");
  await toWrap(funding.page);
  assert.match((await saysNow(funding.page))[0], /^Your funding advisor begins the file within 24 business hours/);
  assert.match((await saysNow(funding.page)).at(-1), /The lender decides the result/);
  await funding.page.close();

  // a file that is not ready leads with the Capital Blueprint (row 2): its own wrap, no funding promise
  const blueprint = await openDeck(open, "REPAIR_ONLY");
  await toWrap(blueprint.page);
  assert.match((await saysNow(blueprint.page))[0], /^Your Capital Blueprint is built from the file we just reviewed\./);
  assert.equal((await saysNow(blueprint.page)).some((l) => /funding advisor|applications are submitted|how-to course/.test(l)), false);
  await blueprint.page.close();

  // stepped down to credit optimization on S-19: the repair wrap
  const repair = await openDeck(open, "REPAIR_ONLY");
  await repair.page.locator('[data-act="phase:07"]').click();
  await repair.page.locator('[data-act="next"]').first().click();
  await repair.page.locator('[data-act="next"]').first().click();
  await repair.page.locator('[data-act="rung:0"]').click();
  await toWrap(repair.page);
  assert.match((await saysNow(repair.page))[0], /^Your credit specialist prepares round one from the file we just reviewed\./);
  assert.equal((await saysNow(repair.page)).some((l) => /funding advisor|applications are submitted/.test(l)), false);
  await repair.page.close();

  const education = await openDeck(open, "FULL_FUNDING", undefined, { course: true });
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
  "Let's read the agreement and price together. What's the best email for your copy?",
  "After you review it, I'll send the matching payment link.",
  "Stay on until the payment shows paid, then show the first step in the portal."
];
const CLOSE_LOGISTICS_WATCH = "Confirm the agreement and payment before ending the call.";

const WRAPS = {
  FUNDING_DFY: {
    lines: [
      "Your funding advisor begins the file within 24 business hours and submits the first authorized applications within 72 business hours.",
      "The lender decides the result. Let's open your first portal step. Any questions before we wrap?"
    ],
    watch: "Confirm the payment posted before ending the call. Then log the disposition."
  },
  REPAIR_DFY: {
    lines: [
      "Your credit specialist prepares round one from the file we just reviewed. You will see the letters in your portal when they are sent.",
      "The specialist tracks each bureau reply, usually 30 to 45 days per round, and plans the next agreed step from the record.",
      "Let's open your first portal step. Any questions before we wrap?"
    ],
    watch: "No advisor and no applications on this sale — it is credit repair. Never promise a deletion, a score, or a result. Confirm the payment posted, then log the disposition."
  },
  REPAIR_TRIAL: {
    lines: [
      "Your credit specialist prepares the first round from your file. You will see the letters and replies in your portal as they are recorded.",
      "After that round, you decide whether to continue. Let's open your first portal step.",
      "Any questions before we wrap?"
    ],
    watch: "One round, then their decision. Do not describe it as the full program. Never promise a deletion, a score, or a result."
  },
  UWIQ_DELIVERABLES: {
    lines: [
      "Your Capital Blueprint is built from the file we just reviewed. Let's open the first step in your portal.",
      "You do the tasks and proof uploads; AI agents help track the checklist, and the Fundhub team handles questions and blockers.",
      "FinanceOS is included for 12 months. Any questions before we wrap?"
    ],
    watch: "This is the guided 12-month Blueprint. Name the buyer's next task and the Fundhub team's support."
  },
  EDU_DELIVERABLES: {
    lines: [
      "Your file deliverables and how-to course are available from today's pull.",
      "You work through those lessons on your own file at your own pace.",
      "Let's open your first lesson. Any questions before we wrap?"
    ],
    watch: "This is the course offer. Show only material included in the sale."
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
    "To start the funding work, the deposit is $3,000 today. It counts once toward the 10 percent success fee on confirmed approved limits or amounts.",
    "The fee includes approved credit access you do not draw. Let's read the agreement's example and payment timing together."
  ],
  REPAIR: ["Offer the 12-month Capital Blueprint first when that plan fits. If they decline, show the $1,000 done-for-you optimization or $200 first round at its actual terms."],
  EDU: ["If a course offer is live, use only the price and deliverables on its screen. Keep it separate from the Blueprint."]
};
const INVESTMENT_WATCH = "Name one offer, its full price and its written terms before payment.";

/**
 * Every way a closer can reach a sale, and what the cockpit must then say.
 * `setup` runs from the first slide and ends on S-19 ("The investment").
 * `fund` / `repair` / `edu` is which line bucket that slide must show.
 * `course` runs the route with the course switch on (the education rungs only).
 */
const ROUTES = [
  { name: "funding, full funding tier", offer: "FUNDING_DFY", tier: "FULL_FUNDING", bucket: "FUND",
    setup: async () => {} },
  { name: "funding plus repair tier", offer: "FUNDING_DFY", tier: "FULL_FUNDING", bucket: "FUND",
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="tier:FUNDING_PLUS_REPAIR"]').click(); } },
  { name: "repair only, lead rung (the Capital Blueprint)", offer: "UWIQ_DELIVERABLES", tier: "REPAIR_ONLY", bucket: "REPAIR",
    setup: async () => {} },
  { name: "repair only, done-for-you rung", offer: "REPAIR_DFY", tier: "REPAIR_ONLY", bucket: "REPAIR", rung: 0,
    setup: async () => {} },
  { name: "repair only, trial rung", offer: "REPAIR_TRIAL", tier: "REPAIR_ONLY", bucket: "REPAIR", rung: 1,
    setup: async () => {} },
  { name: "repair only, Capital Blueprint rung pressed", offer: "UWIQ_DELIVERABLES", tier: "REPAIR_ONLY", bucket: "REPAIR", rung: 2,
    setup: async () => {} },
  { name: "funding client sent down the descent to repair", offer: "REPAIR_DFY", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:dfy"]').click(); } },
  { name: "funding client sent down the descent to the trial", offer: "REPAIR_TRIAL", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:trial"]').click(); } },
  { name: "funding client sent down the descent to DIY", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "REPAIR",
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:diy"]').click(); } },
  { name: "education path, Funding Mastery", offer: "FUNDING_MASTERY", tier: "FULL_FUNDING", bucket: "EDU", course: true,
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="edu"]').click(); } },
  { name: "education path, deliverables rung", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "EDU", rung: 1, course: true,
    setup: async (page) => { await walkTo(page, /The reveal/); await page.locator('[data-act="edu"]').click(); } },
  { name: "descent to the education top rung", offer: "FUNDING_MASTERY", tier: "FULL_FUNDING", bucket: "EDU", course: true,
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:eduTop"]').click(); } },
  { name: "descent to the education low rung", offer: "UWIQ_DELIVERABLES", tier: "FULL_FUNDING", bucket: "EDU", course: true,
    setup: async (page) => { await walkTo(page, /Temperature check/); await page.locator('[data-act="desc:eduLow"]').click(); } }
];

/** The course route uses a different wrap from the Blueprint for the same underlying offer key. */
function wrapKey(offer, bucket) {
  return offer === "UWIQ_DELIVERABLES" && bucket === "EDU" ? "EDU_DELIVERABLES" : offer;
}

for (const route of ROUTES) {
  test(`${route.name}: the investment slide, the close and the wrap are the ${route.offer} ones`, { timeout: 120_000 }, async (t) => {
    const { open } = await startScreens(t);
    const { page } = await openDeck(open, route.tier, undefined, { course: !!route.course });
    await route.setup(page);
    // exact: B-04, the Blueprint's own price slide ("The investment."), sits on a repair file's walk first
    await walkTo(page, /^The investment$/);

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
    const wrap = WRAPS[wrapKey(route.offer, route.bucket)];
    assert.deepEqual(await saysNow(page), wrap.lines, `${route.name}: the wrap words`);
    assert.equal(await watchNow(page), wrap.watch, `${route.name}: the watch-for words`);
    await page.close();
  });
}
