import fs from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";

// Offline fixtures only: every API call and external request is intercepted.
const CLIENT = "11111111-2222-4333-8444-555555555555";
const OTHER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const EVIDENCE = path.resolve("ops/workflows/build-evidence/crm-portal-layout-audit-2026-10-18/payment-success");
const held = { client_id: CLIENT, entitlement_code: "held", entitlement_name: "Credit analysis report", active: true };
const fresh = { client_id: CLIENT, entitlement_code: "new", entitlement_name: "Funding readiness roadmap", active: true };

test.use({ hasTouch: true });

async function openReturn(page, answer, { query = `?ref=checkout_fixture&client_id=${CLIENT}`, fast = true, account, token } = {}) {
  const calls = [];
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(({ fast, account, token }) => {
    if (account) localStorage.setItem("fh_account", JSON.stringify(account));
    if (token) localStorage.setItem("fh_token", token);
    if (fast) {
      const original = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...args) => original(fn, ms === 3000 ? 15 : ms, ...args);
    }
  }, { fast, account, token });
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) {
      calls.push({ url: request.url(), method: request.method(), headers: request.headers(), at: Date.now() });
      if (url.pathname !== "/api/read/entitlements" || request.method() !== "GET") {
        return route.fulfill({ status: 405, json: { ok: false, error: "Unexpected fixture request" } });
      }
      const response = await answer(calls.length);
      if (response === "abort") return route.abort("failed");
      return route.fulfill({ status: response.status || 200, json: response.body || response });
    }
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return route.abort("blockedbyclient");
    return route.continue();
  });
  await page.goto(`/app/payment-success.html${query}`, { waitUntil: "domcontentloaded" });
  return { calls, errors };
}

async function markedCapture(page, filename, selector, caption) {
  await fs.mkdir(EVIDENCE, { recursive: true });
  await page.evaluate(({ selector, caption }) => {
    const label = document.createElement("div");
    label.id = "review-caption";
    label.textContent = caption;
    Object.assign(label.style, {
      flex: "none", margin: "8px", padding: "7px 9px", background: "#fff", color: "#a51d1d",
      border: "1px solid #c82929", borderRadius: "4px", font: "600 12px/1.4 system-ui",
      letterSpacing: "normal", whiteSpace: "normal"
    });
    document.body.append(label);
    const rect = document.querySelector(selector).getBoundingClientRect();
    const box = document.createElement("div");
    box.id = "review-annotation";
    Object.assign(box.style, {
      position: "absolute", pointerEvents: "none", zIndex: "2147483647", boxSizing: "border-box",
      left: `${rect.left + window.scrollX - 3}px`, top: `${rect.top + window.scrollY - 3}px`,
      width: `${rect.width + 6}px`, height: `${rect.height + 6}px`, border: "2px solid #c82929", borderRadius: "4px"
    });
    document.body.append(box);
  }, { selector, caption });
  await page.screenshot({ path: path.join(EVIDENCE, filename), fullPage: true });
  await page.locator("#review-annotation").evaluate(node => node.remove());
  await page.locator("#review-caption").evaluate(node => node.remove());
}

if (process.env.PAYMENT_RETURN_CAPTURE === "before") {
  for (const width of [1440, 390]) {
    test(`before layout ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await openReturn(page, () => ({ status: 401, body: { ok: false } }));
      await expect(page.locator("#state")).toContainText("We cannot check your account from here");
      await markedCapture(page, `before-${width}.png`, ".card", "Before: compact centered card gives the portal action little priority.");
    });
  }
} else {
  const states = {
    full: { answer: n => ({ ok: true, items: n === 1 ? [held] : [held, fresh] }), text: "Just opened on your account" },
    empty: { answer: () => ({ ok: true, items: [] }), text: "Nothing is open on your account yet" },
    loading: { answer: () => ({ ok: true, items: [] }), text: "Checking your account…", fast: false },
    error: { answer: () => "abort", text: "We could not reach your account" }
  };
  for (const width of [1440, 390, 320]) {
    for (const [name, fixture] of Object.entries(states)) {
      test(`${name} is readable and actionable at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        const { calls, errors } = await openReturn(page, fixture.answer, { fast: fixture.fast !== false });
        await expect(page.locator("#state")).toContainText(fixture.text);
        await expect(page.locator("#back")).toHaveAttribute("href", `client-portal.html?client_id=${CLIENT}`);
        await expect(page.locator("#back")).toBeVisible();
        const dimensions = await page.evaluate(() => ({
          width: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          action: document.getElementById("back").getBoundingClientRect().height,
          title: parseFloat(getComputedStyle(document.querySelector("h1")).fontSize)
        }));
        expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.width);
        expect(dimensions.action).toBeGreaterThanOrEqual(44);
        expect(dimensions.title).toBeGreaterThanOrEqual(28);
        expect(errors).toEqual([]);
        expect(calls.every(call => call.method === "GET")).toBe(true);
        if (name === "full") {
          await expect(page.locator("#state")).toContainText(fresh.entitlement_name);
          await expect(page.locator("#state")).not.toContainText(held.entitlement_name);
        }
        if (name === "empty" || name === "error") {
          await expect(page.locator("#again")).toBeVisible();
          await expect(page.locator("#state")).toContainText("Do not pay again");
        }
        if (name === "loading") await expect(page.locator("#state")).toHaveAttribute("aria-busy", "true");
        if (process.env.PAYMENT_RETURN_CAPTURE === "after") {
          await markedCapture(page, `after-${width}-${name}.png`, "#state", `After · ${width}px · ${name}: account access status stays distinct from payment confirmation.`);
        }
      });
    }
  }

  test("baseline, account scope, inactive rows and retry remain honest; Enter retries", async ({ page }) => {
    const { calls } = await openReturn(page, n => ({ ok: true, items: n <= 6
      ? [held, { ...fresh, active: false }, { ...fresh, client_id: OTHER }]
      : [held, fresh] }));
    await expect(page.locator("#state")).toContainText("Nothing new has opened yet");
    await expect(page.locator("#state")).toContainText(held.entitlement_name);
    await expect(page.locator("#state")).not.toContainText(fresh.entitlement_name);
    expect(calls).toHaveLength(6);
    await page.locator("#again").focus();
    await expect(page.locator("#again")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#state")).toContainText("Just opened on your account");
    expect(calls).toHaveLength(7);
    expect(calls.every(call => new URL(call.url).searchParams.get("client_id") === CLIENT)).toBe(true);
    await page.route("**/app/client-portal.html**", route => route.fulfill({ contentType: "text/html", body: "<main>Fixture portal</main>" }));
    await page.locator("#back").tap();
    await expect(page).toHaveURL(new RegExp(`client-portal.html\\?client_id=${CLIENT}`));
  });

  test("401 and 403 stop after one read without claiming payment success", async ({ page }) => {
    for (const status of [401, 403]) {
      const { calls } = await openReturn(page, () => ({ status, body: { ok: false } }));
      await expect(page.locator("#state")).toContainText("We cannot check your account from here");
      await expect(page.locator("#again")).toHaveCount(0);
      await expect(page.locator("#state")).toContainText("If you completed a payment, do not pay again");
      expect(calls).toHaveLength(1);
      await page.unroute("**/*");
    }
  });

  test("missing scope never combines different people; ref and entitlement names stay plain text", async ({ page }) => {
    const ref = '<img src=x onerror="window.bad=1">';
    await openReturn(page, () => ({ ok: true, items: [held, { ...fresh, client_id: OTHER }] }), { query: `?ref=${encodeURIComponent(ref)}&client_id=invalid` });
    await expect(page.locator("#state")).toContainText("We cannot tell which account this is");
    await expect(page.locator("#state")).not.toContainText(held.entitlement_name);
    await expect(page.locator("#refline")).toHaveText(`Payment reference: ${ref}`);
    await expect(page.locator("#refline img")).toHaveCount(0);
    await expect(page.locator("#back")).toHaveAttribute("href", "client-portal.html");
  });

  test("account fallback and bearer token are retained; malformed successful data cannot become access", async ({ page }) => {
    const { calls } = await openReturn(page, () => ({ ok: false, items: [fresh] }), {
      query: "?client_id=invalid", account: { clientId: CLIENT }, token: "fixture-only-token"
    });
    await expect(page.locator("#state")).toContainText("We could not reach your account");
    expect(calls).toHaveLength(6);
    expect(calls.every(call => call.headers.authorization === "Bearer fixture-only-token")).toBe(true);
    expect(calls.every(call => new URL(call.url).searchParams.get("client_id") === CLIENT)).toBe(true);
    await expect(page.locator("#refline")).toBeHidden();
    await expect(page.locator("#state")).not.toContainText("Just opened");
  });

  test("new entitlement labels remain escaped text", async ({ page }) => {
    const label = '<img src=x onerror="window.bad=1">';
    await openReturn(page, n => ({ ok: true, items: n === 1 ? [] : [{ ...fresh, entitlement_name: label }] }));
    await expect(page.locator("#state")).toContainText("Just opened on your account");
    await expect(page.locator("#state li")).toHaveText(label);
    await expect(page.locator("#state img")).toHaveCount(0);
    expect(await page.evaluate(() => window.bad)).toBeUndefined();
  });

  test("the actual poll cadence is three seconds, bounded to six reads", async ({ page }) => {
    test.setTimeout(25_000);
    const { calls } = await openReturn(page, () => ({ ok: true, items: [held] }), { fast: false });
    await expect(page.locator("#state")).toContainText("Nothing new has opened yet", { timeout: 20_000 });
    expect(calls).toHaveLength(6);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(2800);
    await page.waitForTimeout(3200);
    expect(calls).toHaveLength(6);
    await expect(page.locator("#state")).toHaveAttribute("aria-busy", "false");
  });
}
