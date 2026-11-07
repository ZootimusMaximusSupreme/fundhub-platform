// The Whop plans part of Payments (public/app/money-whop-plans.js, Finance OS unit W) in a real
// browser at 1440, 390 and 320 wide: full, staff, error and empty; Whop's and ClarityPay's own
// logos load; nothing overflows, clips or overlaps; 44px links; no sideways scroll.
//
// The section is painted the way the Payments section paints it (inside .fh-payments, under
// "What you owe Fundhub") on a bare host page that loads the Payments stylesheets and the
// shared Astra sheets. The host page is served by this test only; it is not a file in public/.
// /api/money/payments is answered with payloads the REAL back end builds
// (src/http/fixtures/whop-plans.sample.mjs). Run with E2E_PORT=43311.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { sampleWhopPayload, samplePhoneSummary } from "../src/http/fixtures/whop-plans.sample.mjs";

const HOST = "/app/__whop-plans-check.html";
const EVIDENCE = "ops/workflows/build-evidence/W";
fs.mkdirSync(EVIDENCE, { recursive: true });
const TODAY = new Date().toISOString().slice(0, 10);

const HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Whop plans check</title>
<link rel="stylesheet" href="/app/fundhub-font.css">
<link rel="stylesheet" href="/app/fundhub-brand.css">
<link rel="stylesheet" href="/app/money-payments.css">
<link rel="stylesheet" href="/app/money-whop-plans.css">
<link rel="stylesheet" href="/app/money-payments-ios.css">
<link rel="stylesheet" href="/app/fundhub-astra.css">
<link rel="stylesheet" href="/app/fundhub-astra-client.css">
<style>/* host page only */*,*::before,*::after{box-sizing:border-box}body{margin:0;background:#f7f7f5}main{padding:16px}</style>
</head><body class="fh-astra" data-client-ios><main><div id="root" aria-busy="true">Loading…</div></main>
<script src="/app/money-whop-plans.js"></script>
<script>
(function () {
  var staff = /staff=1/.test(location.search);
  var clarity = /clarity=1/.test(location.search);
  fetch("/api/money/payments").then(function (r) { return r.json(); }).then(function (d) {
    /* Two Clarity plans: one owed to ClarityPay wears its logo; one owed to Fundhub LLC does not
       (kind "clarity" alone does not prove ClarityPay, Codex CX21). */
    var clarityCard = clarity ? '<div class="plans"><article class="card plan" data-plan="cp"><div class="plan-head"><div>' +
      FHWhopPlans.providerLogo({ kind: "clarity", owed_to: "ClarityPay" }) + '<p class="plan-name">Fundhub payment plan with ClarityPay</p>' +
      '<p class="caption">Clarity Payment · owed to ClarityPay</p></div><div><span class="tag">On track</span></div></div></article>' +
      '<article class="card plan" data-plan="fh"><div class="plan-head"><div>' +
      FHWhopPlans.providerLogo({ kind: "clarity", owed_to: "Fundhub LLC" }) + '<p class="plan-name">Fundhub payment plan</p>' +
      '<p class="caption">Clarity Payment · owed to Fundhub LLC</p></div><div><span class="tag">On track</span></div></div></article></div>' : "";
    var root = document.getElementById("root");
    root.innerHTML = '<div class="fh-payments"><section class="block" aria-labelledby="b-owe"><h2 id="b-owe">What you owe Fundhub</h2>' +
      '<p class="caption">Each plan, the next payment, and anything late.</p>' + clarityCard +
      FHWhopPlans.renderSection(d, { staff: staff }) + '</section></div>';
    root.removeAttribute("aria-busy");
    document.body.setAttribute("data-ready", "1");
  });
})();
</script></body></html>`;

async function host(page, payload) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(`**${HOST}*`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/money/payments" || route.request().method() !== "GET") {
      return route.fulfill({ status: 404, contentType: "application/json", body: '{"ok":false}' });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  return errors;
}

/** No sideways scroll, nothing outside its card, no two text blocks on top of each other. */
async function formatCheck(page) {
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const bad = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > window.innerWidth) out.push(`page scrolls sideways (${document.documentElement.scrollWidth} > ${window.innerWidth})`);
    for (const card of document.querySelectorAll(".fh-payments .plan")) {
      const c = card.getBoundingClientRect();
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left < c.left - 1 || r.right > c.right + 1) out.push(`${el.className || el.tagName} spills out of its card`);
        if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX === "hidden") out.push(`${el.className || el.tagName} is clipped`);
      }
      const head = card.querySelector(".plan-head");
      const [left, right] = head ? head.children : [];
      if (left && right) {
        const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
        const overlap = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        if (overlap) out.push("the plan name and its status overlap");
      }
      const facts = [...card.querySelectorAll(".facts > div")].map((d) => d.getBoundingClientRect());
      for (let i = 0; i < facts.length; i += 1) for (let j = i + 1; j < facts.length; j += 1) {
        const a = facts[i], b = facts[j];
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) out.push("two facts overlap");
      }
    }
    for (const el of document.querySelectorAll(".fh-payments .nowrap")) {
      if (el.getClientRects().length > 1) out.push(`the date "${el.textContent}" breaks across lines`);
    }
    // .phone-line is a flex row: a loose date would be its own item, with a gap before its comma.
    for (const line of document.querySelectorAll(".whop-plan .phone-line")) {
      if (line.querySelector(":scope > .nowrap")) out.push("a date sits loose in the phone line");
    }
    for (const img of document.querySelectorAll("img.fh-provider-logo")) {
      if (!img.complete || img.naturalWidth === 0) out.push(`logo did not load: ${img.getAttribute("src")}`);
    }
    for (const el of document.querySelectorAll(".fh-payments a, .fh-payments button")) {
      if (el.offsetParent === null) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) out.push(`small target "${el.textContent.trim()}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
    return out;
  });
  expect(bad).toEqual([]);
}

for (const width of [1440, 390, 320]) {
  test(`Whop plans: full client view, logos and format at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = await host(page, sampleWhopPayload(TODAY, { summary: samplePhoneSummary({ has_phone: false }) }));
    await page.goto(`${HOST}?clarity=1`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
    const section = page.locator(".whop-plans");
    await expect(section.getByRole("heading", { name: "Whop plans" })).toBeVisible();
    await expect(section.locator(".whop-plan")).toHaveCount(5);
    await expect(section.locator('img[alt="Whop"]')).toBeVisible();
    await expect(page.locator('[data-plan="cp"] img[alt="ClarityPay"]')).toBeVisible();
    await expect(page.locator('[data-plan="fh"] img.fh-provider-logo')).toHaveCount(0);
    await expect(page.locator('img[alt="ClarityPay"]')).toHaveCount(1);
    await expect(section.locator(".whop-plan").filter({ hasText: "Sample Membership" }).locator(".late")).toHaveText("Late");
    await expect(section.getByRole("link", { name: "Set up my phone" }).first()).toBeVisible();
    await formatCheck(page);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${EVIDENCE}/whop-plans-full-${width}.png`, fullPage: true });
  });

  test(`Whop plans: staff view, error and empty at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let errors = await host(page, sampleWhopPayload(TODAY));
    await page.goto(`${HOST}?staff=1`);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
    await expect(page.locator(".whop-plan").first()).toContainText("Tied by Fundhub checkout");
    await expect(page.getByRole("link", { name: "Set up my phone" })).toHaveCount(0);
    await formatCheck(page);
    await page.screenshot({ path: `${EVIDENCE}/whop-plans-staff-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);

    await page.unrouteAll({ behavior: "ignoreErrors" });
    errors = await host(page, { ok: true, as_of: `${TODAY}T16:00:00.000Z`, phone: null, whop: null });
    await page.goto(HOST);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
    await expect(page.getByRole("status")).toHaveText("Whop plans could not load. Try again later.");
    await formatCheck(page);
    await page.screenshot({ path: `${EVIDENCE}/whop-plans-error-${width}.png`, fullPage: true });

    await page.unrouteAll({ behavior: "ignoreErrors" });
    errors = await host(page, sampleWhopPayload(TODAY, { rows: [] }));
    await page.goto(HOST);
    await expect(page.locator("body")).toHaveAttribute("data-ready", "1");
    await expect(page.locator(".whop-plans")).toHaveCount(0);
    await page.screenshot({ path: `${EVIDENCE}/whop-plans-empty-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
