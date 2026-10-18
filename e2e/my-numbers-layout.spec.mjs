import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { CLOSER, openScreen, withSession, wireApi, json } from "./harness.mjs";

const evidence = path.resolve("ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18");
const full = {
  ok: true, staff_id: "staff-2", period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z", label: "this month" },
  shift: { on_shift: true, elapsed_ms: 7_200_000 },
  pace: { cash_cents: 1840000, cash_display: "$18,400", deposits: 8, target_deposits: 12, target_display: "12 deposits", rank: 2, team_size: 6 },
  month: { deposits_closed: 8, close_rate: .4, show_rate: .8, downsells: 2, deposit_to_funded: .5, avg_funded_cents: null, avg_funded_reason: "Average funded amount is not available for this closer.", calls_held: 20, no_shows: 5, unlogged: 3, prior: { deposits: 6, close_rate: .3 } },
  offer_stack_scope: { note: "A sale only counts for a closer once it has a commission row." },
  offer_stack: { available: true, period: { label: "October 2026" }, items: [
    { name: "Funding DFY", active: true, units: 8, sold_cents: 2400000, collected_cents: 1840000, refunded_cents: 50000 },
    { name: "Business credit course", active: true, units: 0, sold_cents: 0, collected_cents: 0 },
    { name: "Legacy advisory programme", active: false, units: null, units_reason: "Units are unknown.", sold_cents: null, sold_reason: "Amount sold is unknown.", collected_cents: null, collected_reason: "Cash collected is unknown." }
  ], totals: { units: 8, sold_cents: 2400000, collected_cents: 1840000, refunded_cents: 50000 } },
  money: { paid_cents: 125000, pending_cents: 250000, at_risk_cents: null, at_risk_reason: "At-risk commission needs aging rules on open deposits — not built yet" },
  team: [
    { rank: 1, staff_id: "other-1", name: "Avery Lane", deposits: 10, cash_cents: 2400000, close_rate: .45 },
    { rank: 2, staff_id: "staff-2", name: "Casey Reed", deposits: 8, cash_cents: 1840000, close_rate: .4 },
    { rank: 3, staff_id: "other-2", name: "Morgan Hale", deposits: 0, cash_cents: 0, close_rate: null }
  ],
  owed: [
    { urgency: "NOW", title: "Log Dana’s call", detail: "Missing outcome · held today", client_id: "client-1", task_id: "task-9" },
    { urgency: "TODAY", title: "Follow up with Lee", detail: "Quiet deposit · last contact 3 days ago", client_id: "client-2" },
    { urgency: "REVIEW", title: "Review call notes", detail: "An internal item without a client link" }
  ],
  call_quality: { available: false, reason: "Call recording and transcription do not exist yet." },
  compliance: { available: false, reason: "Compliance phrase detection needs call recordings." },
  streak: { available: false, reason: "Daily close streak is not stored yet." }
};
const empty = {
  ...full, shift: { on_shift: false }, pace: { cash_cents: 0, cash_display: "$0", rank: null, team_size: 0, target_reason: "No monthly target set." },
  month: { deposits_closed: 0, close_rate: null, show_rate: null, downsells: 0, deposit_to_funded: null, avg_funded_reason: "No funded amount is known.", calls_held: 0, no_shows: 0, unlogged: 0, prior: { deposits: 0, close_rate: null } },
  offer_stack: { available: true, items: [], reason: "No product sales have been recorded this month." },
  money: { paid_cents: 0, pending_cents: 0, at_risk_reason: "Not computed yet." }, team: [], owed: []
};

async function prepare(page, width) {
  await page.setViewportSize({ width, height: width === 1440 ? 960 : 844 });
  await page.route(/https:\/\/(fonts\.googleapis\.com|fonts\.gstatic\.com)\//, route => route.abort());
}
async function capture(page, name, selector, caption) {
  fs.mkdirSync(evidence, { recursive: true });
  await page.evaluate(({ selector, caption }) => {
    const el = document.querySelector(selector);
    if (el) { el.setAttribute("data-review-mark", "true"); el.style.outline = "2px solid #d32727"; el.style.outlineOffset = "-2px"; }
    const label = document.createElement("div"); label.id = "review-caption"; label.textContent = caption;
    label.style.cssText = "position:fixed;bottom:12px;left:12px;z-index:99999;max-width:calc(100vw - 24px);padding:9px 12px;border:2px solid #d32727;border-radius:6px;background:white;color:#9b1717;font:12px/1.4 system-ui;box-sizing:border-box;pointer-events:none";
    document.body.append(label);
  }, { selector, caption });
  await page.screenshot({ path: path.join(evidence, "page-my-numbers-" + name + ".png"), fullPage: true });
  await page.evaluate(() => { document.getElementById("review-caption")?.remove(); document.querySelectorAll("[data-review-mark]").forEach(el => { el.style.outline = ""; el.style.outlineOffset = ""; el.removeAttribute("data-review-mark"); }); });
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

for (const width of [1440, 390, 320]) {
  test("my numbers full details and next actions at " + width, async ({ page }) => {
    await prepare(page, width);
    const errors = await openScreen(page, "/app/my-numbers.html", CLOSER, { "/api/read/my-numbers": full });
    await expect(page.locator("#stackBody")).toContainText("Legacy advisory programme");
    await expect(page.locator("#numbersStatus")).toBeHidden();
    await expect(page.locator("#fh-workspace-scope-label")).toHaveText("Your performance");
    await expect(page.locator("#fh-workspace-header")).toHaveAttribute("data-fh-scope", "session-staff");
    await expect(page.locator("#shiftChip")).toHaveText("On shift · 2h 0m");
    await expect(page.locator("#staffChip")).toContainText("Casey Reed");
    await expect(page.locator(".pace .big").first()).toHaveText("$18,400");
    await expect(page.locator(".pace .bar")).toHaveAttribute("aria-valuenow", "67");
    await expect(page.locator("#stackBody")).toContainText("after $500 refunded");
    await expect(page.locator("#stackBody")).toContainText("retired product");
    for (const reason of ["Units are unknown.", "Amount sold is unknown.", "Cash collected is unknown."]) await expect(page.locator("#stackBody")).toContainText(reason);
    await expect(page.locator(".st-row").filter({ hasText: "Business credit course" })).toContainText("$0");
    await expect(page.locator(".st-row.tot")).toContainText("$24,000");
    await expect(page.locator(".money .mo").nth(0)).toContainText("$1,250");
    await expect(page.locator(".money .mo").nth(1)).toContainText("$2,500");
    await expect(page.locator(".money .mo").nth(2)).toContainText("—");
    await expect(page.locator(".days")).toHaveText("Daily close streak is not stored yet.");
    await expect(page.locator("#teamPanel")).toContainText("You");
    await expect(page.locator("#teamPanel")).toContainText("40%");
    const todo = page.locator("a.todo").first();
    await expect(todo).toHaveAttribute("href", "closer-dashboard.html?client_id=client-1&task_id=task-9");
    await expect(page.locator("a.todo").nth(1)).toHaveAttribute("href", "closer-dashboard.html?client_id=client-2");
    expect(await todo.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
    if (width < 600) expect(await todo.evaluate(el => el.getBoundingClientRect().top)).toBeLessThan(650);
    await noOverflow(page);
    await capture(page, "full-" + width, "#owedSection", "AFTER · Follow-up work stays beside the cash summary; exact client and task links remain.");
    await todo.focus(); await expect(todo).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/closer-dashboard\.html\?client_id=client-1&task_id=task-9/);
    expect(errors).toEqual([]);
  });

  test("my numbers honest empty state at " + width, async ({ page }) => {
    await prepare(page, width);
    await openScreen(page, "/app/my-numbers.html", CLOSER, { "/api/read/my-numbers": empty });
    await expect(page.locator(".pace .big").first()).toHaveText("$0");
    await expect(page.locator(".grid .m").nth(0).locator(".vl")).toHaveText("0");
    await expect(page.locator(".grid .m").nth(1).locator(".vl")).toHaveText("—");
    await expect(page.locator("#owedPanel")).toContainText("Nothing owed");
    await expect(page.locator("#teamPanel")).toContainText("No closer dispositions logged");
    await expect(page.locator("#stackBody")).toContainText("No product sales have been recorded");
    await noOverflow(page);
    await capture(page, "empty-" + width, "#stackBody", "EMPTY · Recorded zero stays 0; unknown values remain dashes with their available reasons.");
  });

  test("my numbers loading and recoverable error at " + width, async ({ page }) => {
    await prepare(page, width);
    await withSession(page, CLOSER);
    let release; const gate = new Promise(resolve => { release = resolve; }); let calls = 0;
    await wireApi(page, CLOSER, { "/api/read/my-numbers": async route => {
      calls++;
      if (calls === 1) { await gate; return json(route, { ok: false, error: "server_error", message: "Your numbers could not be loaded. Try again." }, 500); }
      return json(route, full);
    } });
    await page.goto("/app/my-numbers.html");
    await expect(page.locator("#numbersStatus")).toContainText("Loading your numbers");
    await expect(page.locator("#numbersContent")).toHaveAttribute("aria-busy", "true");
    await noOverflow(page);
    await capture(page, "loading-" + width, "#numbersStatus", "LOADING · Pending numbers are clearly identified; no sample sales or cash are shown.");
    release();
    await expect(page.locator("#numbersStatus")).toContainText("Your numbers could not be loaded");
    await expect(page.locator("#numbersRetry")).toBeVisible();
    await noOverflow(page);
    await capture(page, "error-" + width, "#numbersStatus", "ERROR · A clear read failure offers a keyboard- and touch-accessible retry.");
    await page.locator("#numbersRetry").focus(); await page.keyboard.press("Enter");
    await expect(page.locator("#numbersStatus")).toBeHidden();
    await expect(page.locator("#stackBody")).toContainText("Funding DFY");
    expect(calls).toBe(2);
  });
}

test("my numbers safely renders API strings and preserves unavailable sections", async ({ page }) => {
  const hostile = "<img src=x onerror=window.BAD=true>";
  await prepare(page, 390);
  await openScreen(page, "/app/my-numbers.html", CLOSER, { "/api/read/my-numbers": { ...full, team: [{ rank: 1, name: hostile, cash_cents: 0 }], owed: [{ title: hostile, detail: hostile }], call_quality: { reason: hostile }, streak: { reason: hostile }, offer_stack: { available: false, reason: "Sales are not available for this period." } } });
  await expect(page.locator("#stackBody")).toContainText("Sales are not available for this period.");
  await expect(page.locator("#qualityPanel")).toContainText(hostile);
  expect(await page.locator("#numbersContent img").count()).toBe(0);
  expect(await page.evaluate(() => window.BAD)).toBeUndefined();
});

test("my numbers refresh resets prior values and a later failure keeps the last loaded figures", async ({ page }) => {
  await prepare(page, 390);
  let reads = 0;
  await openScreen(page, "/app/my-numbers.html", CLOSER, { "/api/read/my-numbers": async route => {
    reads++;
    if (reads === 1) return json(route, full);
    if (reads === 2) return json(route, empty);
    return json(route, { ok: false, message: "Your numbers could not be refreshed." }, 500);
  } });
  await page.locator("#numbersRefresh").click();
  await expect(page.locator(".pace .big").first()).toHaveText("$0");
  await expect(page.locator(".pace .marks")).toContainText("Target —");
  await expect(page.locator(".grid .m").nth(7)).not.toHaveClass(/is-unlogged/);
  await expect(page.locator("#owedPanel a")).toHaveCount(0);
  await page.locator("#numbersRefresh").click();
  await expect(page.locator("#numbersStatus")).toContainText("Last loaded values remain below.");
  await expect(page.locator(".pace .big").first()).toHaveText("$0");
  expect(reads).toBe(3);
});
