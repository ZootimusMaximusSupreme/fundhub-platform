// The REAL visual files inside the real deck (sales-slides build, board 10.8).
//
// fin-b17-present-page.test.mjs proves the slots with stand-in files. This file
// loads the three shipped visual files (public/app/present-visuals.js,
// present-blueprint-demo.js, present-journey.js) into present.html with an
// engine.visual shaped exactly like buildDeckVisualData's output, walks the deck
// with real Next clicks, and checks that every visual draws on its slide, that a
// tap climbs the money, that nothing scrolls sideways on a phone, and that the
// page throws nothing. Pictures go to the gitignored evidence folder.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { offersForClient } from "../../../config/offers.mjs";
import { asRole, json, sharedScreens } from "./fin-b17-browser-kit.mjs";

const screens = sharedScreens();
const CONTACT = "33333333-3333-3333-3333-333333333333";
const PAGE = "/app/present.html";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const SHOTS = path.join(ROOT, "ops/workflows/build-evidence/slides-refresh-2026-10-29/in-deck");

// One person, one file: W1's own engine output for the FinanceOS sample person
// with two companies (see e2e/fixtures/present-visuals-fixtures.js).
const FUNDING_VISUAL = {
  source: "engine",
  todayTotal: 96524,
  levers: [
    { key: "paydown", label: "Pay the cards down", applies: true, totalAfter: 104775 },
    { key: "clean", label: "Clean the file", applies: true, totalAfter: 174625 },
    { key: "accounts", label: "Add accounts", applies: false, totalAfter: 174625 },
  ],
  optimizedTotal: 174625,
  tierNow: "FUNDING_PLUS_REPAIR",
  tierAfter: "FULL_FUNDING",
  cards: [{ creditor: "FIRST PLATYPUS BANK", limit: 10000, balance: 4000, target: 1000, usePct: 40 }],
  items: [{ creditor: "TOYOTA MOTOR CREDIT", kind: "late", bureaus: ["EX", "TU", "EQ"] }],
  mismatches: [],
  companies: [
    { name: "Cedar Mesa Consulting LLC", incorporatedDate: "2021-03-01", ageMonths: 55, amount: 59400 },
    { name: "Bright Mesa Marketing LLC", incorporatedDate: "2025-02-01", ageMonths: 20, amount: 12375 },
  ],
  newCompany: { year1: 27500, year2: 55000, after2: 110000 },
  fundability: null,
};

// The repair-only shape W1 printed: $0 today, the cleaned file routes up to 8,250.
const REPAIR_VISUAL = {
  source: "engine",
  todayTotal: 0,
  levers: [
    { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: 0 },
    { key: "clean", label: "Clean the file", applies: true, totalAfter: 8250 },
    { key: "accounts", label: "Add accounts", applies: false, totalAfter: 8250 },
  ],
  optimizedTotal: 8250,
  tierNow: "REPAIR_ONLY",
  tierAfter: "FUNDING_PLUS_REPAIR",
  cards: [{ creditor: "CAPITAL ONE", limit: 3000, balance: 2400, target: 300, usePct: 80 }],
  items: [
    { creditor: "MIDLAND CREDIT MGMT", kind: "collection", bureaus: ["EX", "EQ"] },
    { creditor: "SYNCHRONY BANK", kind: "charge_off", bureaus: ["EX", "TU", "EQ"] },
  ],
  mismatches: [],
  companies: [],
  newCompany: { year1: 4125, year2: 8250, after2: 16500 },
  fundability: null,
};

function payload(tier, visual, businesses) {
  return {
    ok: true,
    client_id: CONTACT,
    survey: { name: "Sam Sample", target: "$100k - $200k", use: "Growth (marketing, inventory, hiring)", capital: "$5,000", motivation: "Open a second location" },
    businesses,
    income_estimates: {},
    engine: {
      available: true, tier, label: tier, fico: { ex: 650, tu: 640, eq: 655 },
      total: visual.todayTotal, afterFix: null, negItems: null, reasons: [], plan: [],
      totalBasis: businesses.length ? "personal_plus_business" : "personal_only", sample: false, visual,
    },
    soft_pull: { consent_valid: true, diagnostic_paid: true, pull_status: "complete", crs_result_id: "visual-proof-result", sample: false },
    offers: offersForClient(),
  };
}

async function openDeck({ tier, visual, businesses = [], viewport = { width: 1280, height: 900 } }) {
  const handlers = {
    "/api/read/closer-deck": async (route) => json(route, payload(tier, visual, businesses)),
    // The real shape: api/read/agent-context.mjs answers { ok, context }.
    "/api/read/agent-context": async (route) => json(route, { ok: true, context: { setter_handoff: { problem: "Two banks turned me down this year and never said why.", goal: "Fund a second location.", complete_at: "2026-10-29T18:00:00Z" } } }),
    "/api/closer-deck": async (route) => json(route, { ok: true }),
  };
  const { page, errors } = await screens.open(`${PAGE}?contact=${CONTACT}`, { session: asRole("owner"), handlers, viewport });
  page.setDefaultTimeout(8000);
  await page.locator('[data-act="next"]').waitFor({ state: "visible" });
  return { page, errors };
}

const slideCode = async (page) => (await page.locator(".slide-hd .mono").first().textContent()).split(" / ")[0];
const drawn = (page) => page.evaluate(() => { const el = document.querySelector(".client [data-fhv]"); return el ? el.getAttribute("data-fhv") : null; });
const sideways = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);

/** Walk with real Next clicks; return [slide, visual] for every slide a visual drew on, and save a picture of each. */
async function walk(page, label) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const seen = [];
  for (;;) {
    const v = await drawn(page);
    if (v) {
      const code = await slideCode(page);
      seen.push([code, v]);
      await page.waitForTimeout(900); // let the count-ups finish before the picture
      await page.locator(".client").screenshot({ path: path.join(SHOTS, `${label}-${code}-${v}.png`) });
    }
    if (await page.locator('[data-act="next"]').isDisabled()) break;
    await page.locator('[data-act="next"]').click();
  }
  return seen;
}

test("the shipped visual files draw on their slides inside the real deck, with real-shaped numbers and no page errors", { timeout: 180_000 }, async () => {
  const funding = await openDeck({
    tier: "FUNDING_PLUS_REPAIR",
    visual: FUNDING_VISUAL,
    businesses: [
      { id: "b1", name: "Cedar Mesa Consulting LLC", age_months: 55, incorporated_date: "2021-03-01" },
      { id: "b2", name: "Bright Mesa Marketing LLC", age_months: 20, incorporated_date: "2025-02-01" },
    ],
  });
  const fundSeen = await walk(funding.page, "funding");
  assert.deepEqual(fundSeen.map(([code]) => code), ["L-01", "S-08", "C-01"]);
  assert.deepEqual(funding.errors, []);

  // The setter's own sentence and the survey goal reach the path on S-08.
  while ((await slideCode(funding.page)) !== "S-08") await funding.page.locator('[data-act="back"]').click();
  const pathText = await funding.page.locator(".client").innerText();
  assert.match(pathText, /Two banks turned me down this year/);
  assert.match(pathText, /\$100k - \$200k/);
  await funding.page.locator(".client").screenshot({ path: path.join(SHOTS, "funding-S-08-path.png") });

  // Tap the first lever on L-01: the projected amount climbs to the engine's paydown total.
  await funding.page.locator('[data-act="back"]').click();
  while ((await slideCode(funding.page)) !== "L-01") await funding.page.locator('[data-act="back"]').click();
  await funding.page.locator(".client button", { hasText: "Pay the cards down" }).first().click();
  await funding.page.waitForTimeout(900);
  assert.match(await funding.page.locator(".client").innerText(), /\$104,775/);
  assert.match(await funding.page.locator(".client").innerText(), /\$78,101/, "left on the table is always the whole gap");
  await funding.page.locator(".client").screenshot({ path: path.join(SHOTS, "funding-L-01-after-tap.png") });
  assert.deepEqual(funding.errors, []);
  await funding.page.close();

  const repair = await openDeck({ tier: "REPAIR_ONLY", visual: REPAIR_VISUAL });
  const repairSeen = await walk(repair.page, "repair");
  assert.deepEqual(repairSeen.map(([code]) => code), ["L-01", "S-08", "B-03", "S-15"]);
  assert.deepEqual(repair.errors, []);
  await repair.page.close();

  // A phone: the money levers and the Blueprint dashboard never scroll sideways.
  const phone = await openDeck({ tier: "REPAIR_ONLY", visual: REPAIR_VISUAL, viewport: { width: 390, height: 844 } });
  for (;;) {
    const v = await drawn(phone.page);
    if (v) {
      assert.equal(await sideways(phone.page), false, `${await slideCode(phone.page)} scrolls sideways at 390`);
      await phone.page.waitForTimeout(900);
      await phone.page.screenshot({ path: path.join(SHOTS, `phone-${await slideCode(phone.page)}-${v}.png`), fullPage: false });
    }
    if (await phone.page.locator('[data-act="next"]').isDisabled()) break;
    await phone.page.locator('[data-act="next"]').click();
  }
  assert.deepEqual(phone.errors, []);
  await phone.page.close();
});
