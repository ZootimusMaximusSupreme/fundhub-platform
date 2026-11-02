import { test, expect } from "@playwright/test";
import { wireApi, withSession, OWNER, trackErrors } from "./harness.mjs";
import path from "node:path";

const FLOOR = {
  ok: true,
  period: { start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" },
  hero: {
    cash_cents: 2500000, cash_display: "$25,000", target_cents: null,
    target_reason: "No monthly deposit target has been set for the sales team yet.",
    deposit_to_funded: 2 / 3, deposit_to_funded_n: { deposits: 3, funded: 2, rate: 2 / 3 },
  },
  funnel: {
    booked: 12, held: 8, show_rate: 8 / 12, deposits: 3, close_rate: 3 / 8,
    funded: 2, funded_of_deposits: 2 / 3, downsells: 1, downsell_cash_cents: 40000, downsell_cash_display: "$400",
  },
  today: { date: "2026-10-13", booked: 4, held: 3, deposits: 1, target_cents: null, target_reason: "No daily deposit target has been set for the sales team yet." },
  offer_stack: {
    available: true,
    items: [
      { code: "REPAIR_DFY", name: "Repair, done-for-you", units: 2, sold_cents: 200000, collected_cents: 150000 },
      { code: "FUNDING_DFY", name: "Funding, done-for-you", units: 1, sold_cents: 300000, collected_cents: 300000 },
    ],
    totals: { units: 3, sold_cents: 500000, collected_cents: 450000 },
  },
  offer_stack_unattributed: {
    available: true,
    reason: "These sales have no call outcome tied to a closer.",
    items: [{ code: "SOFT_PULL", name: "Soft pull", units: 4, sold_cents: 12800, collected_cents: 12800 }],
    totals: { units: 4, sold_cents: 12800, collected_cents: 12800 },
  },
  closers: [
    {
      staff_id: "s-chris", name: "Chris Stanbridge", on_shift: true, shift_elapsed_ms: 3900000, calls: 6, close_rate: 0.5, funded_rate: 0.4,
      cash_cents: 1800000, cash_display: "$18,000", action: "Call the two deposits that have not funded.", deposits: 2,
      offer_stack: {
        available: true,
        items: [{ code: "REPAIR_DFY", name: "Repair, done-for-you", units: 1, sold_cents: 120000, collected_cents: 90000 }],
        totals: { units: 1, sold_cents: 120000, collected_cents: 90000 },
      },
    },
    {
      staff_id: "s-casey", name: "Casey Reed", on_shift: false, calls: 2, close_rate: 0.25, funded_rate: null,
      cash_cents: 700000, cash_display: "$7,000", action: null, deposits: 1,
      offer_stack: {
        available: true,
        items: [{ code: "FUNDING_DFY", name: "Funding, done-for-you", units: 2, sold_cents: 640000, collected_cents: 310000 }],
        totals: { units: 2, sold_cents: 640000, collected_cents: 310000 },
      },
    },
  ],
  setters: [
    { staff_id: "s-chris", name: "Chris Stanbridge", dials: 8, booked: 2, showed: 3, no_shows: 1, show_rate: 0.75 },
    { staff_id: "s-taylor", name: "Taylor Setter", dials: 12, booked: 1, showed: 0, no_shows: 0, show_rate: null },
  ],
  beliefs: { beliefs: [], sources: [], period: {}, prior: {} },
  compliance: { available: false, reason: "Call recording flags are not scored yet.", items: [] },
  cold_deals: [
    { name: "Dana Whitfield", detail: "Deposit taken Oct 2, not funded", quiet_days: 11 },
    { name: "Ray Ortiz", detail: "Deposit taken Oct 4, not funded", quiet_days: 9 },
  ],
  recordings: { drive_ready: false, items: [], reason: "Google Drive is not connected yet." },
  discipline: { unlogged_calls: 1, unrecorded_calls: 0, shifts_started_late: null, shifts_detail: { reason: "Needs scheduled shift times" }, followups_overdue: null, followups_reason: "n/a", avg_log_lag_days: null, avg_log_lag_reason: "n/a" },
};

// Safe fixture UI review. Every API is intercepted; no live account or writes.
const EVIDENCE = path.resolve("ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/sales-floor");
const emptyFloor = {
  ...FLOOR,
  today: { booked: 0, held: 0, deposits: 0, target_reason: "No daily target has been set." },
  hero: { deposit_to_funded: null },
  funnel: { booked: 0, held: 0, deposits: 0, funded: 0, downsells: 0, downsell_cash_cents: 0 },
  closers: [], setters: [], cold_deals: [],
  offer_stack: { available: true, items: [], reason: "No offers sold this month." },
  offer_stack_unattributed: null,
};
const fullFloor = {
  ...FLOOR,
  closers: [...FLOOR.closers, ...Array.from({ length: 25 }, (_, i) => ({
    ...FLOOR.closers[i % 2], staff_id: "fixture-" + i, name: "Alexandra Longname " + (i + 3),
  }))],
  beliefs: {
    beliefs: [{ belief: "trust", label: "Trust", this_count: 8, last_count: 3 }],
    sources: [{ lead_source: "October campaign", setter_key: "Team", held: 9, close_rate: 1/3, desire: 4 }],
  },
  recordings: { drive_ready: true, items: [
    { name: "Strategy session", client_name: "Dana Whitfield", when: "2026-10-13T18:00:00Z", is_today: true, has_words: true, excerpt: "Discussing the next funding steps.", url: "https://drive.google.com/file/d/fixture/view" },
    { name: "Follow-up recording", client_name: null, has_words: false, url: "javascript:alert(1)" },
  ] },
};
async function prepare(page, floor = fullFloor) {
  const writes = [];
  const errors = trackErrors(page);
  await withSession(page, OWNER);
  await page.route(/^https:\/\//, route => route.abort());
  await wireApi(page, OWNER, {
    "/api/read/sales-floor": floor,
    "/api/marketing-flags": (route) => {
      writes.push({ path: "/api/marketing-flags", body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    },
    "/api/company-brain/sync": (route) => {
      writes.push({ path: "/api/company-brain/sync", body: route.request().postDataJSON() });
      return route.fulfill({ contentType: "application/json", body: '{"ok":true}' });
    },
  });
  return { writes, errors };
}
async function evidence(page, name, selector, caption) {
  await page.locator(selector).first().evaluate((el, caption) => {
    const r = el.getBoundingClientRect();
    const mark = document.createElement("div"); mark.id = "floor-review-mark";
    mark.style.cssText = "position:fixed;left:" + Math.max(2,r.left) + "px;top:" + Math.max(2,r.top) + "px;width:" + Math.min(r.width,innerWidth-4) + "px;height:" + Math.min(r.height,innerHeight-r.top-4) + "px;border:2px solid #d93025;pointer-events:none;z-index:99999";
    const label = document.createElement("span"); label.textContent = caption;
    label.style.cssText = "position:fixed;bottom:6px;left:6px;max-width:calc(100vw - 12px);padding:6px 9px;background:#fff;border:1px solid #d93025;color:#a52017;font:12px/1.4 system-ui;z-index:99999";
    mark.appendChild(label); document.body.appendChild(mark);
  }, caption);
  await page.screenshot({ path: path.join(EVIDENCE, name + ".png") });
  await page.locator("#floor-review-mark").evaluate(el => el.remove());
}
async function setterEvidence(page, width) {
  await page.locator("#fh-floor-setters").evaluate(el => el.scrollIntoView({ block: "start" }));
  await page.evaluate(() => {
    const targets = ["Opt-in booked", "Show rate"].map(label =>
      document.querySelector(`#fh-floor-setters .setter-row [data-label="${label}"]`).getBoundingClientRect());
    const mark = document.createElement("div");
    mark.id = "setter-review-mark";
    mark.style.cssText = "position:fixed;inset:0;z-index:99999;pointer-events:none";
    const shapes = targets.map((r, i) => {
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      return `<ellipse cx="${x}" cy="${y}" rx="${Math.max(40, r.width / 2)}" ry="${Math.max(28, r.height / 2)}" fill="none" stroke="#d93025" stroke-width="4"/>` +
        `<circle cx="${Math.max(16, r.left + 4)}" cy="${Math.max(16, r.top - 8)}" r="14" fill="#d93025"/>` +
        `<text x="${Math.max(16, r.left + 4)}" y="${Math.max(16, r.top - 8) + 5}" fill="white" text-anchor="middle" font-size="15" font-weight="700">${i + 1}</text>` +
        `<path d="M ${Math.min(innerWidth - 6, x + 60)} ${Math.max(8, y - 66)} L ${x + 18} ${y - 20}" stroke="#eab308" stroke-width="5" fill="none" marker-end="url(#setter-arrow)"/>`;
    }).join("");
    mark.innerHTML = `<svg width="100%" height="100%"><defs><marker id="setter-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0 0 L8 3 L0 6" fill="none" stroke="#eab308" stroke-width="2"/></marker></defs>${shapes}</svg><div style="position:fixed;bottom:8px;left:8px;padding:8px 12px;background:white;border:2px solid #d93025;color:#222;font:600 14px system-ui">1 Booked opt-ins · 2 Show rate, from logged outcomes</div>`;
    document.body.appendChild(mark);
  });
  await page.screenshot({ path: path.join(EVIDENCE, width + "-setters-marked.png") });
  await page.locator("#setter-review-mark").evaluate(el => el.remove());
}
for (const width of [1440, 390, 320]) {
  for (const state of ["full", "empty", "loading", "error"]) {
    test(width + "px " + state + ": clear state, contained layout and real controls", async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      let release;
      const pending = new Promise(resolve => { release = resolve; });
      const fixture = state === "loading" ? async route => {
        await pending;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(emptyFloor) });
      } : state === "error" ? route => route.fulfill({
        status: 500, contentType: "application/json",
        body: '{"ok":false,"message":"The sales report is temporarily unavailable."}',
      }) : state === "empty" ? emptyFloor : fullFloor;
      const { errors, writes } = await prepare(page, fixture);
      await page.goto("/app/sales-floor.html", { waitUntil: "domcontentloaded" });
      await expect(page.locator("#fh-workspace-header h1")).toHaveText("Sales floor");
      if (state === "loading") {
        await expect(page.locator("#fh-floor-main")).toHaveAttribute("aria-busy", "true");
        await expect(page.locator("#fh-floor-status")).toHaveText("Loading sales floor…");
        await expect(page.locator("#fh-floor-refresh")).toBeDisabled();
      } else if (state === "error") {
        await expect(page.locator("#fh-floor-status")).toContainText("The sales report is temporarily unavailable.");
        await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
        await expect(page.locator(".hero")).toBeHidden();
      } else {
        await expect(page.locator("#fh-floor-main")).toHaveAttribute("aria-busy", "false");
        await expect(page.locator("#fh-floor-status")).toBeHidden();
        if (state === "full") {
          await expect(page.locator(".rost .rrow.pick")).toHaveCount(27);
          await expect(page.locator("#fh-floor-setters .setter-row")).toHaveCount(2);
          await expect(page.locator("#fh-floor-setters .setter-row").first()).toContainText("75%");
          await expect(page.locator(".hero .big").first()).toHaveText("1");
          await expect(page.locator(".hero .big").nth(1)).toHaveText("67%");
          await expect(page.locator("#fh-floor-on-shift")).toContainText("closers on shift");
          await expect(page.locator(".funnel").first().locator(".f")).toHaveCount(5);
        } else {
          await expect(page.locator(".hero .big").first()).toHaveText("0");
          await expect(page.locator(".hero .big").nth(1)).toHaveText("—");
          await expect(page.locator(".rost")).toContainText("No closers on this board");
          await expect(page.locator("#fh-floor-setters")).toContainText("No active setters yet");
          await expect(page.locator("#fh-offer-stack")).toContainText("No offers sold this month.");
          await expect(page.locator("#fh-flag-mkt")).toHaveCount(0);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await evidence(page, width + "-" + state, state === "error" || state === "loading" ? "#fh-floor-status" : ".hero", width + "px · " + state + " fixture · explicit state and readable overview");
      if (state === "full" && width !== 320) await setterEvidence(page, width);
      if (state === "full" && width < 600) {
        const setter = page.locator("#fh-floor-setters .setter-row").first();
        await setter.scrollIntoViewIfNeeded();
        await expect(setter.locator(".num")).toHaveCount(5);
        expect(await setter.locator(".num").first().evaluate(el => getComputedStyle(el, "::before").content)).toContain("Logged dials");
        const row = page.locator(".rost .rrow.pick").first();
        await row.scrollIntoViewIfNeeded();
        for (const cls of [".c2", ".c4", ".c5"]) await expect(row.locator(cls)).toBeVisible();
        expect(await row.locator(".c5").evaluate(el => getComputedStyle(el, "::before").content)).toContain("Cash");
        await evidence(page, width + "-roster", ".rost .rrow.pick", width + "px · calls, close rate, funded rate, cash and next action remain visible");
      }
      if (state === "loading") {
        release();
        await expect(page.locator("#fh-floor-main")).toHaveAttribute("aria-busy", "false");
      }
      expect(writes).toEqual([]); expect(errors).toEqual([]);
    });
  }
}
test("keyboard closer selection, wraparound, focus retention, safe flag and Drive sync", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const { writes, errors } = await prepare(page, FLOOR);
  await page.goto("/app/sales-floor.html");
  const rows = page.locator(".rost .rrow.pick");
  await rows.nth(1).focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".pickwho")).toContainText("Casey Reed");
  await expect(page.locator("#fh-floor-focus-title")).toBeFocused();
  await rows.first().focus(); await page.keyboard.press("Space");
  await expect(page.locator(".pickwho")).toContainText("Chris Stanbridge");
  await page.locator("#fh-closer-prev").focus(); await page.keyboard.press("Enter");
  await expect(page.locator(".pickwho")).toContainText("Casey Reed");
  await expect(page.locator("#fh-closer-prev")).toBeFocused();
  await page.locator("#fh-closer-next").click();
  await expect(page.locator('.pickb[data-fh-closer="0"]')).toHaveAttribute("aria-pressed", "true");
  await page.locator("#fh-drive-refresh").click();
  await expect(page.locator("#fh-drive-refresh")).toHaveText("Sync recordings from Drive");
  expect(writes).toEqual([{ path: "/api/company-brain/sync", body: {} }]);
  expect(errors).toEqual([]);
});
test("marketing flag preserves payload and only safe Drive links render", async ({ page }) => {
  const { writes, errors } = await prepare(page);
  await page.goto("/app/sales-floor.html");
  await expect(page.locator("#fh-recordings .row a")).toHaveCount(1);
  await expect(page.locator("#fh-recordings .row a")).toHaveAttribute("href", "https://drive.google.com/file/d/fixture/view");
  const dialog = new Promise(resolve => page.once("dialog", async d => {
    const text = d.message(); await d.accept(); resolve(text);
  }));
  await page.locator("#fh-flag-mkt").click();
  expect(await dialog).toContain("Nothing was sent externally.");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toEqual({ path: "/api/marketing-flags", body: {
    belief: "trust", lead_source: "October campaign", setter_label: "Team", outcome_count: 8,
    period_start: FLOOR.period.start, period_end: FLOOR.period.end,
    note: "Flagged from sales floor — Trust this period 8 vs last 3",
  } });
  expect(errors).toEqual([]);
});
test("failed load retries cleanly and a failed refresh labels retained numbers", async ({ page }) => {
  let reads = 0;
  await prepare(page, route => {
    reads += 1; const ok = reads === 2;
    return route.fulfill({ status: ok ? 200 : 503, contentType: "application/json",
      body: JSON.stringify(ok ? FLOOR : { ok: false, message: "Report is unavailable." }) });
  });
  await page.goto("/app/sales-floor.html");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.locator(".hero .big").first()).toHaveText("1");
  await page.locator("#fh-floor-refresh").click();
  await expect(page.locator("#fh-floor-status")).toContainText("last loaded numbers are still shown");
  await expect(page.locator(".hero .big").first()).toHaveText("1");
  await expect(page.locator(".hero")).toBeVisible();
  expect(reads).toBe(3);
});
test("phone touch targets, picker and contained offer scroll retain every control", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 320, height: 900 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const { writes, errors } = await prepare(page, FLOOR);
  await page.goto("/app/sales-floor.html");
  await page.getByRole("link", { name: "Your closers", exact: true }).tap();
  await page.locator(".rost .rrow.pick").nth(1).tap();
  await expect(page.locator(".pickwho")).toContainText("Casey Reed");
  await page.locator("#fh-closer-next").tap();
  await expect(page.locator(".pickwho")).toContainText("Chris Stanbridge");
  const controls = page.locator(".shell button, .sf-toolbar button, .sf-jumps a");
  for (const control of await controls.all()) {
    if (await control.isVisible()) expect((await control.boundingBox()).height).toBeGreaterThanOrEqual(44);
  }
  const offers = page.locator("#fh-offer-stack .ostack").first();
  await offers.scrollIntoViewIfNeeded();
  expect(await offers.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await offers.evaluate(el => { el.scrollLeft = el.scrollWidth; });
  expect(await offers.evaluate(el => el.scrollLeft > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(writes).toEqual([]); expect(errors).toEqual([]);
  await context.close();
});
test("unknown discipline and offer amounts remain distinct from recorded zero", async ({ page }) => {
  await prepare(page, { ...emptyFloor, discipline: { unlogged_calls: null, unrecorded_calls: null }, offer_stack: {
    available: true, items: [{ name: "Funding support", units: 0, sold_cents: null, collected_cents: 0, sold_reason: "Sale total was not recorded." }],
    totals: { units: 0, sold_cents: null, collected_cents: 0 },
  } });
  await page.goto("/app/sales-floor.html");
  const discipline = page.locator(".panel").filter({ has: page.getByRole("heading", { name: "Floor discipline" }) });
  await expect(discipline.locator(".row .r").nth(0)).toHaveText("—");
  await expect(discipline.locator(".row .r").nth(1)).toHaveText("—");
  const offer = page.locator("#fh-offer-stack .rrow").first();
  await expect(offer).toContainText("Not recorded");
  await expect(offer.locator(".num").last()).toHaveText("$0");
});
