// The real Payments pages with Whop plans and the ClarityPay logo (Finance OS unit W), at 1440, 390
// and 320 wide: /app/money-payments.html and the Payments tab of /app/financeos.html. The read
// GET /api/money/payments is answered with D2's sample (src/http/fixtures/money-payments.sample.json)
// plus the `whop` block the REAL back end builds (src/http/fixtures/whop-plans.sample.mjs). Every
// other read gets the client-portal sample bundle. Nothing is written; sample data only.
//
// It checks what a person would see: the ClarityPay logo only on the plan owed to ClarityPay (never
// on a Fundhub plan just because its kind is "clarity", Codex CX21), the Whop plans under the
// Clarity plans with Whop's logo, every logo loaded, and no sideways scroll, nothing spilling out of
// a card, no two facts on top of each other, no date broken across lines, 44px links.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import bundle from "../src/demo/client-portal-sample-bundle.json" with { type: "json" };
import { withSession, json, trackErrors } from "./harness.mjs";
import { sampleWhopPayload } from "../src/http/fixtures/whop-plans.sample.mjs";

const EVIDENCE = "ops/workflows/build-evidence/W";
fs.mkdirSync(EVIDENCE, { recursive: true });
const SAMPLE = JSON.parse(fs.readFileSync("src/http/fixtures/money-payments.sample.json", "utf8"));
const TODAY = String(SAMPLE.as_of).slice(0, 10);

/* A sample plan the client pays through ClarityPay: the BNPL sample, owed to ClarityPay. */
const CLARITYPAY_PLAN = "c1a71e00-0000-4000-8000-0000000000cc";

function payments() {
  const d = structuredClone(SAMPLE);
  const cp = { ...structuredClone(SAMPLE.plans.find((p) => p.kind === "bnpl")), id: CLARITYPAY_PLAN, kind: "clarity",
    owed_to: "ClarityPay", label: null, name: "Fundhub payment plan with ClarityPay" };
  d.plans = [...d.plans, cp];
  d.whop = sampleWhopPayload(TODAY).whop;
  d.upcoming = [...d.whop.upcoming, ...d.upcoming].sort((a, b) => String(a.on).localeCompare(String(b.on)));
  return d;
}

async function serve(page) {
  await withSession(page, { staff: { role: "client" } });
  const errors = trackErrors(page);
  const writes = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") { writes.push(path); return json(route, { ok: false, error: "sample_read_only" }, 409); }
    if (path === "/api/auth/session") return json(route, { ok: true, principal: "client", portal_sample_available: true, portal_sample: true, staff: { role: "client", name: "Portal Sample" } });
    if (path === "/api/read/affiliate-portal") return json(route, { ok: true, enrolled: false });
    if (path === "/api/money/payments") return json(route, payments());
    const data = bundle.reads[path] || (path === "/api/blueprint/declines" ? { ok: true, view: { eligible: true, can_paste: true, applications: [], declines: [] } } : { ok: true, items: [] });
    return json(route, { ...data, portal_sample: true, sample_notice: bundle.notice });
  });
  return { errors, writes };
}

async function formatCheck(page, scope) {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const bad = await page.evaluate((scope) => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    const root = document.querySelector(scope);
    if (!root) return [`no ${scope}`];
    for (const card of root.querySelectorAll(".plan")) {
      const c = card.getBoundingClientRect();
      for (const el of card.querySelectorAll(".plan-head *, .facts *, .phone-line, .phone-line *, .plan-brand *, .bar")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < c.left - 1 || r.right > c.right + 1) out.push(`${el.className || el.tagName} spills out of its card`);
      }
      const facts = [...card.querySelectorAll(".facts > div")].map((d) => d.getBoundingClientRect());
      for (let i = 0; i < facts.length; i += 1) for (let j = i + 1; j < facts.length; j += 1) {
        const a = facts[i], b = facts[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push("two facts overlap");
      }
    }
    for (const el of root.querySelectorAll(".nowrap")) if (el.getClientRects().length > 1) out.push(`the date "${el.textContent}" breaks across lines`);
    // .phone-line is a flex row: a loose date would be its own item, with a gap before its comma.
    for (const line of root.querySelectorAll(".whop-plan .phone-line")) if (line.querySelector(":scope > .nowrap")) out.push("a date sits loose in the phone line");
    for (const img of root.querySelectorAll("img.fh-provider-logo")) if (!img.complete || img.naturalWidth === 0) out.push(`logo did not load: ${img.getAttribute("src")}`);
    for (const el of root.querySelectorAll(".whop-plans a, .whop-plans button, .plan-brand a")) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push(`small target "${el.textContent.trim()}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  }, scope);
  expect(bad).toEqual([]);
}

async function checkPayments(page, scope, shot = null) {
  const root = page.locator(scope);
  const clarityPay = root.locator(`.plan[data-plan="${CLARITYPAY_PLAN}"]`);
  const fundhubPlan = root.locator(`.plan[data-plan="${SAMPLE.plans.find((p) => p.kind === "clarity").id}"]`);
  if (shot) {
    await root.locator(".tiles").screenshot({ path: `${EVIDENCE}/${shot}-tiles.png` });
    await clarityPay.locator(".plan-head").screenshot({ path: `${EVIDENCE}/${shot}-claritypay-card.png` });
  }
  await expect(clarityPay.locator('img.fh-provider-logo[alt="ClarityPay"]')).toBeVisible();
  await expect(fundhubPlan.locator("img.fh-provider-logo")).toHaveCount(0);
  await expect(root.locator(".plan").filter({ hasText: "buy now, pay later" }).locator("img.fh-provider-logo")).toHaveCount(0);
  const whop = root.locator(".whop-plans");
  await expect(whop.getByRole("heading", { name: "Whop plans" })).toBeVisible();
  await expect(whop.locator('img[alt="Whop"]')).toBeVisible();
  await expect(whop.locator(".whop-plan")).toHaveCount(5);
  await expect(whop.locator(".whop-plan").filter({ hasText: "Sample Membership" }).locator(".late")).toHaveText("Late");
  await expect(root.getByText("You do not owe Fundhub anything right now")).toHaveCount(0);
  await expect(root.locator(".tiles")).toContainText("on Whop");
  await expect(root.locator(".rows")).toContainText("Whop payment");
  await formatCheck(page, scope);
}

for (const width of [1440, 390, 320]) {
  test(`Payments page: ClarityPay logo and Whop plans, formatted at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { errors, writes } = await serve(page);
    await page.goto("/app/money-payments.html");
    await expect(page.locator(".fh-payments .whop-plans")).toBeVisible();
    await checkPayments(page, ".fh-payments", `payments-page-${width}`);
    await page.screenshot({ path: `${EVIDENCE}/payments-page-whop-${width}.png`, fullPage: true });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`Finance OS Payments tab: ClarityPay logo and Whop plans, formatted at ${width}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 1000 });
    const { errors, writes } = await serve(page);
    await page.goto("/app/financeos.html#payments");
    await expect(page.locator("#fos-payments .whop-plans")).toBeVisible({ timeout: 20_000 });
    await checkPayments(page, "#fos-payments", `financeos-payments-${width}`);
    await page.screenshot({ path: `${EVIDENCE}/financeos-payments-whop-${width}.png`, fullPage: true });
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}
