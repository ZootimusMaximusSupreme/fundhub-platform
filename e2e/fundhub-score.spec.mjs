// The Fundhub score, both views, clicked like a person at 1440, 390 and 320:
//   - the client's "Your Fundhub score" card on /app/money-fundability.html
//   - the staff "If they follow the plan" card on the closer cockpit
// Every API answer is a fixture. The look-ahead bodies are built by the real
// back end (src/finance/fundhub-lookahead.mjs) from one sample file, so the
// shape is the API's. No write leaves the page.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

import { buildLookahead } from "../src/finance/fundhub-lookahead.mjs";
import { addMonths } from "../src/finance/fundability.mjs";
import { CLIENT_ID, CLOSER, openScreen } from "./harness.mjs";

const SAMPLE = JSON.parse(fs.readFileSync(new URL("../src/http/fixtures/money-fundability.sample.json", import.meta.url)));
const EVIDENCE = path.resolve("ops/workflows/build-evidence/fundhub-score-2026-11-07");
const TODAY = new Date().toISOString().slice(0, 10);
const ago = (n) => addMonths(TODAY, -n);
const LINE = (id, lender, limit, balance, opened) => ({
  id, lender, kind: "revolving", credit_limit_cents: limit, balance_cents: balance, opened_on: opened, closed_at: null,
  last4: null, apr: null, raw: { accountStatusType: "Open" }
});
/* One messed-up sample file: a card at 90% use, two negative items under a
   dispute plan, a paydown step, one young business. Test rows only. */
function look(view, months) {
  return buildLookahead({
    client: { id: CLIENT_ID, first_name: "Sample", last_name: "Client",
      custom_fields: { crs_inquiries_ex: 1, crs_inquiries_eq: 1, crs_inquiries_tu: 0, crs_negative_items_count: 2, crs_late_payments_count: 0 } },
    asOf: new Date(),
    crsRows: [{ id: "p1", created_at: "2026-09-30T04:30:03.759Z", result: { scores: { ex: 712, eq: 705, tu: 700 }, environment: "simulated", simulated: true } }],
    tradelineRows: [LINE("a1", "CHASE", "1000000", "900000", ago(40)), LINE("a2", "AMEX", "800000", "100000", ago(40)), LINE("a3", "CAPITAL ONE", "600000", "50000", ago(40))],
    liabilities: ["a1", "a2", "a3"].map((id) => ({ tradeline_id: id, payment_status: "current", as_of: "2026-09-30" })),
    waypoints: [{ key: "pd", state: "not_started", due_at: addMonths(TODAY, 2), verify_kind: "paydown", params: { creditor: "CHASE", creditor_key: "chase", target_cents: 100000 } }],
    disputeItems: [
      { id: "d1", rule_id: "DEROG-COLLECTION", status: "open", creditor: "Midland Credit", account_last4: "1111" },
      { id: "d2", rule_id: "DEROG-CHARGEOFF", status: "sent", creditor: "Portfolio Recovery", account_last4: "2222" }
    ],
    businessRows: [{ id: "b1", name: "Sample Freight LLC", age_months: 8, entity_data: {}, created_at: "2026-03-01T00:00:00Z" }],
    relationships: view === "plan" ? [] : null,
    months, view
  });
}
const monthsOf = (url) => Number(new URL(url).searchParams.get("months") || 9);

async function noSidewaysScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function tall(locator) {
  const box = await locator.boundingBox();
  expect(box.height, "control is at least 44px tall").toBeGreaterThanOrEqual(44);
  expect(box.width, "control is at least 44px wide").toBeGreaterThanOrEqual(44);
}
/* Evidence: scroll the card's top just under any sticky top bar, then take the
   screen as a person sees it (an element shot stitches under the sticky bar). */
async function shot(page, selector, file) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    let bar = 0;
    for (const n of document.querySelectorAll("body *")) {
      const s = getComputedStyle(n);
      if (s.position !== "sticky" && s.position !== "fixed") continue;
      const r = n.getBoundingClientRect();
      if (r.top <= 1 && r.height > 0 && r.height < innerHeight / 3) bar = Math.max(bar, r.bottom);
    }
    el.scrollIntoView({ block: "start" });
    // The cockpit scrolls inside its own box, the client page scrolls the window.
    const gap = bar + 8 - el.getBoundingClientRect().top;
    if (gap > 0) {
      let box = el.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTop -= gap; else window.scrollBy(0, -gap);
    }
  }, selector);
  await page.screenshot({ path: path.join(EVIDENCE, file) });
}

for (const width of [1440, 390, 320]) {
  test(`client: Your Fundhub score, today and in 9 months, with the month picks, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const asked = [];
    let writes = 0;
    let plain = 0;
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      const p = new URL(url).pathname;
      const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
      if (route.request().method() !== "GET") { writes++; return json({ ok: false }, 403); }
      if (p === "/api/auth/session") return json({ ok: true, principal: "client" });
      if (p === "/api/read/affiliate-portal") return json({ ok: true, enrolled: false });
      if (p === "/api/money/fundability") {
        const view = new URL(url).searchParams.get("view");
        if (view === "lookahead") { asked.push(monthsOf(url)); return json(look("lookahead", monthsOf(url))); }
        plain++;
        // The section's one read carries the score look-ahead for month 9.
        return json({ ...SAMPLE, fundhub_lookahead: look("lookahead", 9) });
      }
      return json({ ok: false }, 404);
    });
    await page.goto("/app/money-fundability.html");
    const card = page.locator(".fd-fh");
    await expect(card).toBeVisible();
    await expect(card.locator("#fd-fh-title")).toHaveText("Your Fundhub score");
    await expect(card).toContainText("In 9 months if you follow your plan");
    await expect(card).toContainText("UnderwriteIQ estimate");
    await expect(card.locator('[data-fh-month="9"]')).toHaveAttribute("aria-pressed", "true");
    expect(plain, "a page load is one read").toBe(1);
    expect(asked).toEqual([]);
    await tall(card.locator('[data-fh-month="3"]'));
    await tall(card.locator("[data-fh-any]"));

    // A quick pick the read already holds repaints without a new read.
    await card.locator('[data-fh-month="3"]').click();
    await expect(card).toContainText("In 3 months if you follow your plan");
    await expect(card.locator('[data-fh-month="3"]')).toHaveAttribute("aria-pressed", "true");
    expect(asked).toEqual([]);

    // Any month asks UnderwriteIQ again for that month.
    await card.locator("[data-fh-any]").selectOption("18");
    await expect(card).toContainText("In 18 months if you follow your plan");
    expect(asked).toEqual([18]);
    expect(plain).toBe(1);

    await noSidewaysScroll(page);
    await shot(page, ".fd-fh", `client-fundhub-score-${width}.png`);
    expect(writes).toBe(0);
  });

  test(`staff: If they follow the plan on the closer cockpit, closing line and any month, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const asked = [];
    await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
      "/api/read/closer-now": { ok: true, current: null, next: null },
      "/api/money/fundability": (_route, { url, method }) => {
        if (method !== "GET") return { ok: false };
        const u = new URL(url);
        expect(u.searchParams.get("view")).toBe("plan");
        expect(u.searchParams.get("client_id")).toBe(CLIENT_ID);
        asked.push(monthsOf(url));
        return look("plan", monthsOf(url));
      }
    });
    const card = page.locator("#fh-plan-card");
    await expect(card).toBeVisible();
    await expect(card.locator("#fh-plan-title")).toHaveText("If they follow the plan");
    const closing = card.locator("[data-fpc-closing]");
    await expect(closing).toHaveText(/^Not fundable today\. If you follow this plan, the disputed items come off and nothing new hits your file, in 9 months UnderwriteIQ estimates Fundable, about \$55,000 personal\.$/);
    await expect(card.locator('[data-fpc-month="9"]')).toHaveAttribute("aria-pressed", "true");
    await expect(card).toContainText("The path");
    await expect(card).toContainText("Repair rounds end about");
    await expect(card).toContainText("Sample Freight LLC");
    await tall(card.locator('[data-fpc-month="12"]'));
    await tall(card.locator("[data-fpc-any]"));

    // Funding, then the credit facts, then this card: the facts stay inside the first phone screen.
    const funding = await page.locator(".funding-estimate").boundingBox();
    const facts = await page.locator(".client-facts").boundingBox();
    const box = await card.boundingBox();
    const precall = await page.locator(".precall-context").boundingBox();
    expect(funding.y + funding.height).toBeLessThanOrEqual(facts.y + 1);
    expect(facts.y + facts.height).toBeLessThanOrEqual(box.y + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(precall.y + 1);

    await card.locator('[data-fpc-month="12"]').click();
    await expect(closing).toContainText("in 12 months UnderwriteIQ estimates");
    await expect(card.locator('[data-fpc-month="12"]')).toHaveAttribute("aria-pressed", "true");
    await card.locator("[data-fpc-any]").selectOption("18");
    await expect(closing).toContainText("in 18 months UnderwriteIQ estimates");
    // Going back to a month already read uses what the card holds.
    await card.locator('[data-fpc-month="12"]').click();
    await expect(closing).toContainText("in 12 months UnderwriteIQ estimates");
    expect(asked).toEqual([9, 12, 18]);

    await card.locator(".fpc-assume summary").click();
    await expect(card.locator(".fpc-assume")).toContainText("Your credit scores stay where they are today");
    await noSidewaysScroll(page);
    await shot(page, "#fh-plan-card", `staff-plan-card-${width}.png`);
  });
}

test("staff: a role the door refuses hides the card instead of showing an error", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openScreen(page, `/app/closer-dashboard.html?client_id=${CLIENT_ID}`, CLOSER, {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/money/fundability": (route) => route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ ok: false, error: "forbidden" }) })
  });
  await page.waitForTimeout(600);
  await expect(page.locator("#fh-plan-card")).toBeHidden();
});
