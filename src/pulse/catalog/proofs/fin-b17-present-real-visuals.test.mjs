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

// A real Next-click walk is the gate for every Framework v2 diagram. A null
// expected name accepts the visual's own data-fhv name for older scripts.
const FUNDING_SLOTS = [
  ["S-01", "callMap"], ["S-04", "goalLine"], ["S-05", "pullSplit"], ["S-06", "iceberg"],
  ["F-01", "findings"], ["L-01", "levers"], ["F-02", "wall"], ["S-08", "path"],
  ["S-09", "blindMatched"], ["S-10", "sequence"], ["S-11", "sequence"], ["S-12", "sequence"], ["S-13", "sequence"], ["S-14", "sequence"],
  ["S-15", "clock"], ["S-16", "proof-wall"], ["P-01", "partnerStaircase"], ["C-01", "companies"],
  ["S-19", "doorMatrix"], ["S-20", "moneyStrip"], ["S-21", "guarantees"], ["S-23", "nextSteps"],
];
const REPAIR_SLOTS = [
  ["S-01", "callMap"], ["S-04", "goalLine"], ["S-05", "pullSplit"], ["S-06", "iceberg"],
  ["F-01", "findings"], ["L-01", "levers"], ["F-02", "wall"], ["S-08", "path"],
  ["B-01", null], ["B-03", null], ["S-15", null], ["S-19", "doorMatrix"], ["S-23", "nextSteps"],
];

// One person, one file: W1's own engine output for the FinanceOS sample person
// with two companies (see e2e/fixtures/present-visuals-fixtures.js).
const FUNDING_VISUAL = {
  source: "engine",
  pulledOn: "2026-03-02",
  todayTotal: 96524,
  availableCredit: 6000,
  lenderReach: { now: 6, after: 9 },
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
  pulledOn: "2026-03-02",
  todayTotal: 0,
  availableCredit: 140,
  lenderReach: { now: 0, after: 15 },
  levers: [
    { key: "paydown", label: "Pay the cards down", applies: false, totalAfter: 0 },
    { key: "clean", label: "Clean the file", applies: true, totalAfter: 8250 },
    { key: "accounts", label: "Add accounts", applies: false, totalAfter: 8250 },
  ],
  optimizedTotal: 8250,
  tierNow: "REPAIR_ONLY",
  tierAfter: "FULL_FUNDING",
  cards: [
    { creditor: "CREDIT ONE BANK", limit: 1500, balance: 1490, target: 150, usePct: 99 },
    { creditor: "CAPITAL ONE", limit: 3000, balance: 2870, target: 300, usePct: 96 },
  ],
  items: [
    { creditor: "CAPITAL ONE", kind: "late", bureaus: ["EX", "TU", "EQ"] },
    { creditor: "MIDLAND CREDIT MGMT", kind: "collection", bureaus: ["EX", "TU"] },
    { creditor: "PORTFOLIO RECOVERY", kind: "collection", bureaus: ["TU", "EQ"] },
    { creditor: "SYNCB/CARE CREDIT", kind: "charge_off", bureaus: ["EX", "EQ"] },
  ],
  mismatches: [{ field: "name", values: { EX: "TEST SAMPLE / TEST SAMPL", TU: "TEST SAMPLE", EQ: "TEST SAMPLE" } }],
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
const MARKS = {
  "F-01": [".fhv-findings-bar", "1  Card pay-down target"],
  "L-01": [".fhv-levers-rise", "2  Each lever adds dollars"],
  "F-02": [".fhv-wall-tile.is-waiting:last-child", "3  More lender matches"],
  "B-03": ['[data-bd-act="goto:0"]', "4  Card pay-down first"],
  "S-16": [".fhv-proof-wall .fh-shot", "5  Source approval crop"],
  "S-19": [".fhw-picture", "6  Plan comparison"],
};

async function markedShot(page, label, code) {
  const mark = MARKS[code];
  if (!mark || !(await page.locator(`.client ${mark[0]}`).count())) return;
  await page.locator(`.client ${mark[0]}`).first().scrollIntoViewIfNeeded();
  await page.evaluate(([selector, caption]) => {
    const client = document.querySelector(".client");
    const target = client && client.querySelector(selector);
    if (!target) return;
    const box = client.getBoundingClientRect(), r = target.getBoundingClientRect();
    const w = client.clientWidth, h = client.clientHeight;
    const cx = r.left - box.left + r.width / 2, cy = r.top - box.top + r.height / 2;
    const rx = Math.min(80, Math.max(28, r.width / 2 + 8));
    const ry = Math.min(34, Math.max(18, r.height / 2 + 8));
    const ax = Math.min(w - 24, cx + rx + 38), ay = Math.max(32, cy - ry - 32);
    const tipX = cx + rx * .7, tipY = cy - ry * .65;
    const oldPosition = client.style.position;
    if (getComputedStyle(client).position === "static") client.style.position = "relative";
    const overlay = document.createElement("div");
    overlay.dataset.evidenceAnnotation = oldPosition;
    overlay.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:9999;overflow:hidden";
    overlay.innerHTML = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="position:absolute;inset:0" aria-hidden="true"><defs><marker id="fh-mark-arrow" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><path d="M0 0 L9 4.5 L0 9 Z" fill="#f6bf00"/></marker></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#d62525" stroke-width="5"/><path d="M${ax} ${ay} L${tipX} ${tipY}" fill="none" stroke="#f6bf00" stroke-width="5" marker-end="url(#fh-mark-arrow)"/><circle cx="${cx - rx + 12}" cy="${cy - ry - 4}" r="15" fill="#d62525"/><text x="${cx - rx + 12}" y="${cy - ry + 2}" text-anchor="middle" font-size="16" font-weight="800" fill="white">${caption[0]}</text></svg>`;
    const text = document.createElement("span");
    text.textContent = caption.slice(3);
    text.style.cssText = `position:absolute;left:${Math.max(4, Math.min(w - 170, ax - 156))}px;top:${Math.max(4, ay - 28)}px;max-width:166px;padding:4px 6px;background:#ffe275;border:1px solid #0d1113;border-radius:4px;color:#0d1113;font:700 13px/1.2 sans-serif`;
    overlay.appendChild(text);
    client.appendChild(overlay);
  }, mark);
  await page.locator(".client").screenshot({ path: path.join(SHOTS, `MARKED-${label}-${code}.png`) });
  await page.evaluate(() => { const client = document.querySelector(".client"); const overlay = client && client.querySelector("[data-evidence-annotation]"); if (overlay) { client.style.position = overlay.dataset.evidenceAnnotation; overlay.remove(); } });
}

/** Walk with real Next clicks; return [slide, visual] for every slide a visual drew on, and save a picture of each. */
async function walk(page, label, mark = false) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const seen = [];
  const allSlides = [];
  for (;;) {
    const code = await slideCode(page);
    const v = await drawn(page);
    if (page.viewportSize()?.width === 1440 && page.viewportSize()?.height === 900) {
      const fit = await page.locator(".client .slide-body").evaluate((el) => ({ shown: el.clientHeight, needed: el.scrollHeight }));
      assert.ok(fit.needed <= fit.shown + 1, `${code} clips slide content at 1440×900 (${fit.needed}px needed, ${fit.shown}px shown)`);
    }
    allSlides.push([code, v]);
    if (v) {
      seen.push([code, v]);
      await page.waitForTimeout(900); // let the count-ups finish before the picture
      await page.locator(".client").screenshot({ path: path.join(SHOTS, `${label}-${code}-${v}.png`) });
      if (mark) await markedShot(page, label, code);
    }
    if (await page.locator('[data-act="next"]').isDisabled()) break;
    await page.locator('[data-act="next"]').click();
  }
  seen.allSlides = allSlides;
  return seen;
}

function assertSlideVisuals(seen, required, route) {
  for (const [code, visual] of required) {
    assert.ok(seen.allSlides.some(([visited]) => visited === code), `${route}: ${code} was walked`);
    assert.ok(seen.some(([visited, drawnVisual]) => visited === code && (visual === null || drawnVisual === visual)),
      `${route}: ${code} drew ${visual || "a diagram"} inside the real deck`);
  }
}

test("the shipped visual files draw on their slides inside the real deck, with real-shaped numbers and no page errors", { timeout: 180_000 }, async () => {
  const funding = await openDeck({
    tier: "FUNDING_PLUS_REPAIR",
    visual: FUNDING_VISUAL,
    viewport: { width: 1440, height: 900 },
    businesses: [
      { id: "b1", name: "Cedar Mesa Consulting LLC", age_months: 55, incorporated_date: "2021-03-01" },
      { id: "b2", name: "Bright Mesa Marketing LLC", age_months: 20, incorporated_date: "2025-02-01" },
    ],
  });
  const fundSeen = await walk(funding.page, "funding-1440", true);
  assertSlideVisuals(fundSeen, FUNDING_SLOTS, "funding");
  assert.deepEqual(funding.errors, []);

  // The staff-only S-16 switch must draw the revenue diagram in the real deck.
  while ((await slideCode(funding.page)) !== "S-16") await funding.page.locator('[data-act="back"]').click();
  await funding.page.locator('[data-act="show-revenue"]').click();
  assert.equal(await drawn(funding.page), "revenueSplit");
  assert.equal(await funding.page.locator('.client [data-fhv="revenueSplit"] button').count(), 4);
  await funding.page.locator(".client").screenshot({ path: path.join(SHOTS, "funding-1440-S-16-revenueSplit.png") });
  await funding.page.locator('[data-act="show-proof"]').click();
  assert.equal(await drawn(funding.page), "proof-wall");

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

  const repair = await openDeck({ tier: "REPAIR_ONLY", visual: REPAIR_VISUAL, viewport: { width: 1440, height: 900 } });
  const repairSeen = await walk(repair.page, "repair");
  assertSlideVisuals(repairSeen, REPAIR_SLOTS, "repair");
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
      await markedShot(phone.page, "repair-390", await slideCode(phone.page));
    }
    if (await phone.page.locator('[data-act="next"]').isDisabled()) break;
    await phone.page.locator('[data-act="next"]').click();
  }
  assert.deepEqual(phone.errors, []);
  await phone.page.close();

  // Mark both exceptional slides at the other review width as well.
  const wideBlueprint = await openDeck({ tier: "REPAIR_ONLY", visual: REPAIR_VISUAL, viewport: { width: 1440, height: 900 } });
  while ((await slideCode(wideBlueprint.page)) !== "B-03") await wideBlueprint.page.locator('[data-act="next"]').click();
  await markedShot(wideBlueprint.page, "repair-1440", "B-03");
  assert.deepEqual(wideBlueprint.errors, []);
  await wideBlueprint.page.close();

  const phoneProof = await openDeck({ tier: "FUNDING_PLUS_REPAIR", visual: FUNDING_VISUAL, viewport: { width: 390, height: 844 } });
  while ((await slideCode(phoneProof.page)) !== "S-16") await phoneProof.page.locator('[data-act="next"]').click();
  assert.equal(await sideways(phoneProof.page), false, "S-16 scrolls sideways at 390");
  await markedShot(phoneProof.page, "funding-390", "S-16");
  assert.deepEqual(phoneProof.errors, []);
  await phoneProof.page.close();
});

test("the closer sees reported card headroom and can illustrate the Blueprint payment from confirmed terms", { timeout: 180_000 }, async () => {
  const funding = await openDeck({ tier: "FUNDING_PLUS_REPAIR", visual: FUNDING_VISUAL });
  await funding.page.locator('[data-act="phase:04"]').click();
  const credit = await funding.page.locator(".fh-credit-readout").innerText();
  assert.match(credit, /\$6,000/);
  assert.match(credit, /Soft pull 2026-03-02/);
  assert.match(credit, /Sample file/);
  assert.deepEqual(funding.errors, []);
  await funding.page.close();

  const repair = await openDeck({ tier: "REPAIR_ONLY", visual: REPAIR_VISUAL });
  await repair.page.locator('[data-act="phase:07"]').click();
  while ((await slideCode(repair.page)) !== "S-19") await repair.page.locator('[data-act="next"]').click();
  await repair.page.locator('[data-act="rung:2"]').click();
  await repair.page.locator('[data-act="phase:08"]').click();
  const helper = repair.page.locator(".fh-finance-helper");
  await helper.waitFor({ state: "visible" });
  assert.match(await repair.page.locator(".fh-credit-readout").innerText(), /\$140/);
  assert.match(await helper.innerText(), /Check the application with the client/);
  assert.match(await helper.innerText(), /No employer appears on this soft pull/);
  assert.equal(await helper.locator(".fh-finance-check").count(), 3);
  await helper.locator('.fh-finance-check[value="employer"]').check();
  assert.match(await helper.locator("#fh-fin-result").innerText(), /Enter the APR from the lender quote/);

  await helper.locator("#fh-fin-plan").selectOption("noInterest");
  assert.equal(await helper.locator('.fh-finance-check[value="employer"]').isChecked(), true, "a plan switch keeps the closer's application review state");
  assert.match(await helper.locator("#fh-fin-result").innerText(), /\$416\.67 per month for 12 months/);
  await helper.locator("#fh-fin-plan").selectOption("splitit");
  assert.match(await helper.locator("#fh-fin-result").innerText(), /exceeds reported card headroom/);
  await helper.locator("#fh-fin-amount").fill("120");
  assert.match(await helper.locator("#fh-fin-result").innerText(), /\$10 per month for 12 months/);
  await helper.locator("#fh-fin-plan").selectOption("flex");
  assert.match(await helper.locator("#fh-fin-result").innerText(), /Enter the APR from the lender quote/);
  assert.deepEqual(repair.errors, []);
  await repair.page.close();

  const withEmployer = await openDeck({
    tier: "REPAIR_ONLY",
    visual: { ...REPAIR_VISUAL, reportedEmployers: [{ name: "Sample Employer", bureaus: ["EX"] }] },
  });
  await withEmployer.page.locator('[data-act="phase:07"]').click();
  while ((await slideCode(withEmployer.page)) !== "S-19") await withEmployer.page.locator('[data-act="next"]').click();
  await withEmployer.page.locator('[data-act="rung:2"]').click();
  await withEmployer.page.locator('[data-act="phase:08"]').click();
  assert.match(await withEmployer.page.locator(".fh-finance-employers").innerText(), /Sample Employer\s+EX/);
  assert.match(await withEmployer.page.locator(".fh-finance-review").innerText(), /can be old/);
  assert.deepEqual(withEmployer.errors, []);
  await withEmployer.page.close();
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
