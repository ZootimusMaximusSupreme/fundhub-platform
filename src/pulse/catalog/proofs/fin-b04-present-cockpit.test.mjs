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
