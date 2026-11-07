// The apply gate component (public/app/apply-gate.js) in a real browser, at
// 1440, 390 and 320 wide: all four states, the congrats line, Show all banks,
// the staff "Allow more here" control, 44px controls and no sideways scroll.
//
// The component is mounted the way a page mounts it (a <div data-fh-apply-gate>
// plus its stylesheet and script) inside a bare host page that loads the same
// shared Astra sheets as /app/financeos.html. The host page is served by this
// test only; it is not a file in public/. Every /api call is answered here from
// payloads the REAL back end builds (src/http/fixtures/apply-gate.sample.mjs).
import { test, expect } from "@playwright/test";
import { samplePayloads } from "../src/http/fixtures/apply-gate.sample.mjs";

const HOST = "/app/__apply-gate-check.html";
const EVIDENCE = "ops/workflows/build-evidence/finance-os-apply-gate-2026-11-07";
const P = samplePayloads(new Date().toISOString().slice(0, 10));

const HOST_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apply gate check</title>
<link rel="stylesheet" href="/app/fundhub-font.css">
<link rel="stylesheet" href="/app/fundhub-brand.css">
<link rel="stylesheet" href="/app/money-workspace.css">
<link rel="stylesheet" href="/app/fundhub-astra.css">
<link rel="stylesheet" href="/app/fundhub-astra-client.css">
<link rel="stylesheet" href="/app/apply-gate.css">
<style>/* host page only: the real pages carry their own shell reset */*,*::before,*::after{box-sizing:border-box}body{margin:0}</style>
</head><body class="fh-astra"><main class="fh-astra-page"><div data-fh-apply-gate></div></main>
<script defer src="/app/apply-gate.js"></script></body></html>`;

async function host(page, { state = "full", staff = false } = {}) {
  const seen = { gets: [], posts: [] };
  let release = null;
  const held = new Promise((resolve) => { release = resolve; });
  let current = state;
  await page.route(`**${HOST}*`, (route) => route.fulfill({ status: 200, contentType: "text/html", body: HOST_HTML }));
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (data, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(data) });
    if (url.pathname !== "/api/money/banks") return json({ ok: false }, 404);
    if (req.method() === "POST") {
      seen.posts.push(req.postDataJSON());
      if (!staff) return json({ ok: false, error: "forbidden" }, 403);
      current = "allowed";
      return json({ ok: true, action: "set_apply_override", id: "ov-1", bank_key: "bank of america", allow_more: true });
    }
    seen.gets.push(url.search);
    if (current === "loading") await held;
    if (current === "error") return json({ ok: false, db: "down" }, 503);
    if (current === "empty") return json(P.empty);
    if (current === "locked") return json(P.locked);
    if (current === "allowed") return json(P.staffAllowed);
    return json(staff ? P.staff : P.full);
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  return { seen, errors, release, set: (s) => { current = s; } };
}

async function noSidewaysScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

/** Every visible button and link inside the component is at least 44 by 44. */
async function bigTargets(page) {
  const small = await page.evaluate(() => [...document.querySelectorAll(".fh-apply-gate button, .fh-apply-gate a")]
    .filter((el) => el.offsetParent !== null)
    .map((el) => { const r = el.getBoundingClientRect(); return { t: el.textContent.trim(), w: r.width, h: r.height }; })
    .filter((r) => r.w < 44 || r.h < 44));
  expect(small).toEqual([]);
}

for (const width of [1440, 390, 320]) {
  test(`apply gate: client full, show all, and no writes at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page);
    await page.goto(HOST);
    const gate = page.locator(".fh-apply-gate");
    await expect(gate.getByRole("heading", { name: "Can you apply yet?" })).toBeVisible();
    await expect(gate.locator(".ag-head .ag-chip").first()).toHaveText("Ready to apply");
    await expect(gate.getByText("Congrats. Your Chase account is seasoned.")).toBeVisible();
    /* Short client words (QA16): no disclaimer, and a passing check is its title and Done. */
    await expect(gate.getByText(/not a promise/i)).toHaveCount(0);
    const inquiries = gate.locator(".ag-row").filter({ hasText: "No hard inquiries" });
    await expect(inquiries.locator(".ag-chip")).toHaveText("Done");
    await expect(inquiries.locator(".ag-cap")).toHaveCount(0);
    await expect(gate.getByText("No hard inquiries on your file.")).toHaveCount(0);
    await expect(gate.locator(".ag-bank:visible")).toHaveCount(6);
    await expect(gate.locator('[data-act="override"]')).toHaveCount(0);
    const boa = gate.locator(".ag-bank").filter({ hasText: "Bank of America" });
    await expect(boa.locator(".ag-chip")).toHaveText("Wait");
    await expect(boa).toContainText("You have 2 approved there. A large deposit can allow more. Your Fundhub team decides.");
    await expect(gate.locator('img.ag-logo[src="/assets/lenders/chase.png"]').first()).toBeVisible();
    await noSidewaysScroll(page);
    await bigTargets(page);
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-full-${width}.png`, fullPage: true });

    await gate.getByRole("button", { name: `Show all ${P.full.odds.length} banks` }).click();
    await expect(gate.locator(".ag-bank:visible")).toHaveCount(P.full.odds.length);
    await expect(gate.getByRole("button", { name: "Show fewer banks" })).toBeFocused();
    await noSidewaysScroll(page);
    expect(h.seen.posts).toEqual([]);
    expect(h.seen.gets).toEqual(["?view=apply_gate"]);
    expect(h.errors).toEqual([]);
  });

  test(`apply gate: locked, empty, error and loading at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page, { state: "locked" });
    await page.goto(HOST);
    const gate = page.locator(".fh-apply-gate");
    await expect(gate.locator(".ag-head .ag-chip").first()).toHaveText("Locked");
    await expect(gate.getByText(/3 hard inquiries are on your file/).first()).toBeVisible();
    await expect(gate.locator(".ag-bank .ag-chip").first()).toHaveText("Not yet");
    await noSidewaysScroll(page);
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-locked-${width}.png`, fullPage: true });

    h.set("empty");
    await page.goto(HOST);
    await expect(gate.getByText(/Starts after your soft pull/)).toBeVisible();
    await expect(gate.getByRole("link", { name: "Run your soft pull" })).toHaveAttribute("href", "/app/financeos.html#setup");
    await bigTargets(page);
    await noSidewaysScroll(page);
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-empty-${width}.png`, fullPage: true });

    h.set("error");
    await page.goto(HOST);
    await expect(gate.getByRole("alert")).toContainText("Our records are busy right now.");
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-error-${width}.png`, fullPage: true });
    h.set("full");
    await gate.getByRole("button", { name: "Try again" }).click();
    await expect(gate.locator(".ag-head .ag-chip").first()).toHaveText("Ready to apply");

    h.set("loading");
    await page.goto(HOST);
    await expect(gate.locator('[aria-busy="true"]')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-loading-${width}.png`, fullPage: true });
    h.release();
    await expect(gate.locator(".ag-head .ag-chip").first()).toHaveText("Ready to apply");
    expect(h.errors).toEqual([]);
  });

  test(`apply gate: staff allow more at Bank of America at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const h = await host(page, { staff: true });
    await page.goto(`${HOST}?client_id=sample-client`);
    const gate = page.locator(".fh-apply-gate");
    const boa = gate.locator(".ag-bank").filter({ hasText: "Bank of America" });
    await expect(boa.getByRole("button", { name: "Allow more here" })).toBeVisible();
    await bigTargets(page);
    await noSidewaysScroll(page);
    await page.screenshot({ path: `${EVIDENCE}/apply-gate-staff-${width}.png`, fullPage: true });
    await boa.getByRole("button", { name: "Allow more here" }).click();
    await expect(boa.getByRole("button", { name: "Back to the book's limit" })).toBeVisible();
    await expect(boa).toContainText("Your Fundhub team cleared more applications at Bank of America.");
    await expect(boa).toContainText("Team note: Large deposit");
    expect(h.seen.posts).toEqual([{ action: "set_apply_override", bank: "Bank of America", allow_more: true, client_id: "sample-client" }]);
    expect(h.seen.gets.every((q) => q === "?view=apply_gate&client_id=sample-client")).toBe(true);
    await noSidewaysScroll(page);
    expect(h.errors).toEqual([]);
  });
}
