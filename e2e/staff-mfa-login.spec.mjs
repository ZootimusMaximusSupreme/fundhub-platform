import { test, expect } from "@playwright/test";

const reply = (route, body, status = 200) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(body)
});

async function openLogin(page, { setup = false, recovery = false, unavailable = false } = {}) {
  const calls = [];
  await page.route("**/api/auth/login", (route) => {
    if (route.request().method() === "GET") return reply(route, { demo: { enabled: false } });
    calls.loginBody = JSON.parse(route.request().postData() || "{}");
    if (unavailable) return reply(route, { ok: false, error: "mfa_unavailable" }, 503);
    return reply(route, { ok: true, mfa_required: true, mfa_setup_required: setup, mfa_token: "short-lived-challenge" });
  });
  await page.route("**/api/auth/mfa", (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    calls.push(body);
    if (body.action === "setup") return reply(route, {
      ok: true, secret: "TESTSETUPKEY123456", otpauth_uri: "otpauth://totp/Fundhub:test?secret=TESTSETUPKEY123456"
    });
    return reply(route, {
      ok: true, token: "verified-staff-session", principal: "staff",
      staff: { id: "staff-test", role: "closer", name: "Test Closer" },
      ...(recovery ? { recovery_codes: ["recovery-one", "recovery-two"] } : {})
    });
  });
  await page.route("**/app/financeos.html", (route) => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>Signed in</title>"
  }));
  await page.goto("/login.html?next=%2Fapp%2Ffinanceos.html");
  await page.locator("#email").fill("closer@example.test");
  await page.locator("#pw").fill("strong-test-password");
  await page.locator("#go").click();
  return calls;
}

test("new staff member enrolls without receiving a session before MFA and sees recovery codes once", async ({ page }) => {
  const calls = await openLogin(page, { setup: true, recovery: true });
  expect(calls.loginBody.mfa_for_payout).toBe(true);
  await expect(page.locator("#f")).toBeHidden();
  await expect(page.locator("#fh-mfa-form")).toBeVisible();
  await expect(page.locator("#fh-mfa-secret")).toHaveText("TESTSETUPKEY123456");
  expect(await page.evaluate(() => localStorage.getItem("fh_token"))).toBeNull();
  expect(await page.evaluate(() => localStorage.getItem("mfa_token"))).toBeNull();
  await page.locator("#fh-mfa-code").fill("123456");
  await page.locator("#fh-mfa-verify").click();
  await expect(page.locator("#fh-mfa-recovery")).toBeVisible();
  await expect(page.locator("#fh-mfa-recovery-codes")).toContainText("recovery-one");
  expect(await page.evaluate(() => localStorage.getItem("fh_token"))).toBeNull();
  await page.locator("#fh-mfa-continue").click();
  await expect(page).toHaveURL(/\/app\/financeos\.html$/);
  expect(calls.map((call) => call.action)).toEqual(["setup", "verify"]);
  expect(calls[1].mfa_token).toBe("short-lived-challenge");
});

test("enrolled staff must finish authenticator challenge before sign-in", async ({ page }) => {
  const calls = await openLogin(page);
  expect(calls.loginBody.mfa_for_payout).toBe(true);
  await expect(page.locator("#fh-mfa-form")).toBeVisible();
  await expect(page.locator("#fh-mfa-setup")).toBeHidden();
  expect(await page.evaluate(() => localStorage.getItem("fh_token"))).toBeNull();
  await page.locator("#fh-mfa-code").fill("123456");
  await page.locator("#fh-mfa-verify").click();
  await expect(page).toHaveURL(/\/app\/financeos\.html$/);
  expect(calls.map((call) => call.action)).toEqual(["verify"]);
});

test("missing MFA key shows a clear error and never starts a session", async ({ page }) => {
  await openLogin(page, { unavailable: true });
  await expect(page.locator("#err")).toHaveText("Security check is unavailable right now. Try again later.");
  await expect(page.locator("#f")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("fh_token"))).toBeNull();
});

test("leaving MFA setup clears secrets before browser back restores the page", async ({ page }) => {
  await openLogin(page, { setup: true });
  await expect(page.locator("#fh-mfa-secret")).toHaveText("TESTSETUPKEY123456");
  await page.goto("/portal-login.html");
  await page.goBack();
  await expect(page.locator("#fh-mfa-secret")).toBeEmpty();
  await expect(page.locator("#fh-mfa-open")).not.toHaveAttribute("href", /^otpauth:/);
  await expect(page.locator("#fh-mfa-form")).toBeHidden();
  await expect(page.locator("#f")).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("mfa_token"))).toBeNull();
});
