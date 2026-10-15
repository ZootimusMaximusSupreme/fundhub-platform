// Finish-853 batch 02, generation 2: the sales floor hero, practice test (screen half).
//
// Row (desks-f.json, sales-floor.html): "Hero: 'Today' deposits, booked and held, 'Funded, not just
// sold' rate and target bar". The saved-result half is the live check in fin-b02-hero-live.test.mjs.
//
// This half runs the real page in Chromium with ONE fake read and holds what the hero paints:
//   - the four numbers (deposits today, booked, held, the funded rate and its "x of y"),
//   - a number the read could not give is a dash, never a zero,
//   - the target bar: the server has no daily deposit target, so the bar is empty and the words say
//     "no target set". The page never fills the bar and never prints a target it was not given.
//
// What this test does NOT hold, on purpose: a bar that follows a target. public/app/sales-floor.js
// sets the bar to 0% on every paint, so there is no such behaviour to hold yet. It is a product
// finding in the manifest, not a promise made here.
//
// REPAIR CYCLE 1: because that half does not exist, the hero row is NOT attached to a live check or
// to this test as proof. A fresh checker showed a read that carries hero.target_cents and
// hero.cash_cents still paints a 0% bar with every attached test green. A test that would go red on
// that (an assertion of 50%) cannot be committed, since the product is what is wrong. So the row went
// back to NOT_PROVED with the exact words (fin-b02-display-contracts.mjs HERO_GAP_REQUIREMENT). These
// four tests stay as the practice half for the numbers, dashes and empty bar; they run in the
// focused proof run, and they say nothing about a target bar.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, startScreens } from "./s4-screen-harness.mjs";

const NO_DAILY_TARGET = "No daily deposit target has been set for the sales team yet.";
const EMPTY_STACK = { available: true, items: [], totals: { units: 0, sold_cents: 0, collected_cents: 0 } };

function floor({ today, hero }) {
  return {
    ok: true,
    period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" },
    hero: { cash_cents: 0, cash_display: "$0", target_cents: null, target_reason: "No monthly deposit target has been set for the sales team yet.", ...hero },
    funnel: { booked: 0, held: 0, show_rate: null, deposits: 0, close_rate: null, funded: 0, funded_of_deposits: null, downsells: 0, downsell_cash_cents: 0, downsell_cash_display: "$0" },
    today: { date: "2026-10-14", target_cents: null, ...today },
    offer_stack: EMPTY_STACK,
    offer_stack_unattributed: { ...EMPTY_STACK, reason: "" },
    closers: [],
    beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
    compliance: { available: false, reason: "Call recording flags are not scored yet.", items: [] },
    cold_deals: [],
    recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet." },
    discipline: { unlogged_calls: 0, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "n/a" }, followups_overdue: null, followups_reason: "n/a", avg_log_lag_days: null, avg_log_lag_reason: "n/a" },
  };
}

async function until(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!(await done()) && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

async function paintHero(t, payload) {
  const { open } = await startScreens(t);
  const { page, errors } = await open("/app/sales-floor.html", {
    handlers: { "/api/read/sales-floor": (route) => json(route, payload) },
    viewport: { width: 1400, height: 1200 },
  });
  // textContent, not innerText: the page's own CSS upper-cases some labels on screen.
  const words = (selector) => page.locator(selector).evaluateAll((els) => els.map((el) => el.textContent.trim()));
  await until(async () => /closers on shift/i.test((await words("header .hl .chip")).join(" ")));
  const hero = {
    labels: await words(".hero .hl2"),
    bigs: await words(".hero .big"),
    subs: await words(".hero .sub"),
    barWidth: await page.locator(".hero .bar i").evaluate((el) => el.style.width),
    marks: await words(".hero .marks span"),
    text: await page.locator(".hero").evaluate((el) => el.textContent),
  };
  return { hero, errors, page };
}

test("hero: a busy day paints deposits, booked, held, the funded rate and its count, and an empty bar that says no target", { timeout: 120_000 }, async (t) => {
  const { hero, errors, page } = await paintHero(t, floor({
    today: { deposits: 7, booked: 11, held: 9, target_reason: NO_DAILY_TARGET },
    hero: { deposit_to_funded: 3 / 7, deposit_to_funded_n: { deposits: 7, funded: 3, rate: 3 / 7 } },
  }));
  assert.deepEqual(hero.labels, ["Today", "Funded, not just sold"]);
  assert.deepEqual(hero.bigs, ["7", "43%"]);
  assert.equal(hero.subs[0], `Booked 11 · Held 9 · ${NO_DAILY_TARGET}`);
  assert.equal(hero.subs[1], "3 of 7 deposits funded");
  // The bar: no daily target exists, so it is empty and the words say why. No target is invented.
  assert.equal(hero.barWidth, "0%");
  assert.deepEqual(hero.marks, ["0", NO_DAILY_TARGET]);
  assert.doesNotMatch(hero.text, /\$\s?\d/, "the hero prints no dollar target it was not given");
  assert.deepEqual(errors, []);
  await page.close();
});

test("hero: a quiet day is zeros and a dash, not a made-up rate", { timeout: 120_000 }, async (t) => {
  const { hero, errors, page } = await paintHero(t, floor({
    today: { deposits: 0, booked: 0, held: 0, target_reason: NO_DAILY_TARGET },
    hero: { deposit_to_funded: null, deposit_to_funded_n: { deposits: 0, funded: 0, rate: null } },
  }));
  assert.deepEqual(hero.bigs, ["0", "—"]);
  assert.equal(hero.subs[0], `Booked 0 · Held 0 · ${NO_DAILY_TARGET}`);
  assert.equal(hero.subs[1], "0 of 0 deposits funded");
  assert.equal(hero.barWidth, "0%");
  assert.deepEqual(errors, []);
  await page.close();
});

test("hero: a number the read could not give is a dash, never a zero", { timeout: 120_000 }, async (t) => {
  const { hero, errors, page } = await paintHero(t, floor({
    today: { deposits: null, booked: null, held: null, target_reason: NO_DAILY_TARGET },
    hero: { deposit_to_funded: null, deposit_to_funded_n: {} },
  }));
  assert.deepEqual(hero.bigs, ["—", "—"]);
  assert.equal(hero.subs[0], `Booked — · Held — · ${NO_DAILY_TARGET}`);
  assert.equal(hero.subs[1], "Of deposits taken this period");
  assert.deepEqual(errors, []);
  await page.close();
});

test("hero: with no reason from the server the bar still says there is no daily target", { timeout: 120_000 }, async (t) => {
  const { hero, errors, page } = await paintHero(t, floor({
    today: { deposits: 2, booked: 3, held: 3 },
    hero: { deposit_to_funded: 0.5, deposit_to_funded_n: { deposits: 2, funded: 1, rate: 0.5 } },
  }));
  assert.deepEqual(hero.bigs, ["2", "50%"]);
  assert.equal(hero.subs[0], "Booked 3 · Held 3 · No daily target");
  assert.deepEqual(hero.marks, ["0", "No daily target"]);
  assert.equal(hero.barWidth, "0%");
  assert.deepEqual(errors, []);
  await page.close();
});
