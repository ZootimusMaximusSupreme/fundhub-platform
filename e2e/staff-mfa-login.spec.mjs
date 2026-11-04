import { test, expect } from "@playwright/test";

const reply = (route, body, status = 200) => route.fulfill({
  status, contentType: "application/json", body: JSON.stringify(body)
});

test("staff signs in with password and sees no authenticator step", async ({ page }) => {
  let loginBody;
  let mfaCalls = 0;
  await page.route("**/api/auth/login", route => {
    if (route.request().method() === "GET") return reply(route, { demo: { enabled: false } });
    loginBody = JSON.parse(route.request().postData() || "{}");
    return reply(route, { ok: true, token: "staff-session", principal: "staff",
      staff: { id: "staff-test", role: "closer", name: "Test Closer" } });
  });
  await page.route("**/api/auth/mfa", route => {
    mfaCalls++;
    return reply(route, { ok: false, error: "unexpected_mfa_request" }, 500);
  });
  await page.route("**/app/financeos.html", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<title>Signed in</title>"
  }));
  await page.goto("/login.html?next=%2Fapp%2Ffinanceos.html");
  await expect(page.locator("#fh-mfa-form")).toHaveCount(0);
  await page.locator("#email").fill("closer@example.test");
  await page.locator("#pw").fill("strong-test-password");
  await page.locator("#go").click();
  await expect(page).toHaveURL(/\/app\/financeos\.html$/);
  expect(loginBody).toEqual({ email: "closer@example.test", password: "strong-test-password" });
  expect(mfaCalls).toBe(0);
});
