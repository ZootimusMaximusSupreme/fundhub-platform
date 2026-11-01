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
      totalBasis: businesses.length ? "personal_plus_business" : "personal_only", sample: true, visual,
    },
    soft_pull: null,
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

test("on a laptop screen the companies slide fits with nothing below the edge, before and after + Add a company; Business 2 keeps one color; a phone never shrinks", { timeout: 180_000 }, async () => {
  const businesses = [
    { id: "b1", name: "Cedar Mesa Consulting LLC", age_months: 55, incorporated_date: "2021-03-01" },
    { id: "b2", name: "Bright Mesa Marketing LLC", age_months: 20, incorporated_date: "2025-02-01" },
  ];
  // The three laptop screens the live look found the bottom of C-01 hidden on (2026-10-30).
  for (const viewport of [{ width: 1280, height: 900 }, { width: 1440, height: 900 }, { width: 1536, height: 864 }]) {
    const { page, errors } = await openDeck({ tier: "FUNDING_PLUS_REPAIR", visual: FUNDING_VISUAL, businesses, viewport });
    while ((await slideCode(page)) !== "C-01") await page.locator('[data-act="next"]').click();
    for (const when of ["first", "added"]) {
      if (when === "added") await page.locator(".client button", { hasText: "Add a company" }).first().click();
      await page.waitForTimeout(900);
      const fit = await page.evaluate(() => {
        const body = document.querySelector(".client .slide-body");
        const host = body.querySelector('[data-fhv="companies"]');
        return {
          hidden: body.scrollHeight - body.clientHeight,
          zoom: Number(host.style.zoom || 1),
          partners: !!host.querySelector(".fhv-companies-timeline"),
          proof: !!host.querySelector(".fhv-companies-proof"),
        };
      });
      const where = `${viewport.width}x${viewport.height}, ${when === "first" ? "at first" : "after + Add a company"}`;
      assert.ok(fit.partners && fit.proof, `${where}: Funding partners for life and the proof are on the slide`);
      assert.ok(fit.hidden <= 1, `${where}: ${fit.hidden}px of the slide sits below the edge`);
      assert.ok(fit.zoom >= 0.8, `${where}: shrunk to ${fit.zoom}, below 80 percent`);
      await page.locator(".client").screenshot({ path: path.join(SHOTS, `fit-C-01-${viewport.width}x${viewport.height}-${when}.png`) });
    }
    const colors = await page.evaluate(() => {
      const host = document.querySelector('.client [data-fhv="companies"]');
      const key = [...host.querySelectorAll(".fhv-companies-key")].find((k) => /Business 2/.test(k.textContent));
      const seg = [...host.querySelectorAll(".fhv-companies-seg")].find((s) => /^Business 2/.test(s.getAttribute("title") || ""));
      const chip = [...host.querySelectorAll(".fhv-companies-chip")].find((c) => /^Business 2/.test(c.textContent));
      return { key: getComputedStyle(key, "::before").backgroundColor, seg: getComputedStyle(seg).backgroundColor, chip: getComputedStyle(chip).backgroundColor };
    });
    assert.equal(colors.key, colors.seg, "Business 2's key is the color of its layer");
    assert.equal(colors.chip, colors.seg, "Business 2's chips are the color of its layer");
    assert.deepEqual(errors, []);
    await page.close();
  }

  const phone = await openDeck({ tier: "FUNDING_PLUS_REPAIR", visual: FUNDING_VISUAL, businesses, viewport: { width: 390, height: 844 } });
  while ((await slideCode(phone.page)) !== "C-01") await phone.page.locator('[data-act="next"]').click();
  await phone.page.waitForTimeout(900);
  const zoom = await phone.page.evaluate(() => document.querySelector('.client [data-fhv="companies"]').style.zoom);
  assert.equal(zoom, "", "a phone stacks and scrolls; the slide never shrinks there");
  assert.equal(await sideways(phone.page), false);
  assert.deepEqual(phone.errors, []);
  await phone.page.close();
});
