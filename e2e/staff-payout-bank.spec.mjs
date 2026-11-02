import { test, expect } from "@playwright/test";
import { CLOSER, OWNER, wireApi, gotoScreen } from "./harness.mjs";

test("closer links their own payout bank from the account menu", async ({ page }) => {
  const calls = [];
  await page.addInitScript(() => {
    window.Plaid = {
      create(options) {
        return {
          open() {
            options.onSuccess("public-token", {
              institution: { name: "Example Credit Union" },
              accounts: [{ id: "plaid-account-1" }]
            });
          }
        };
      }
    };
  });
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/read/staff-payout-account": () => ({ ok: true, account: null, linking_available: true }),
      "/api/staff/payout-account": (route) => {
        const body = JSON.parse(route.request().postData() || "{}");
        calls.push(body);
        if (body.action === "link_token") return { ok: true, link_token: "link-token" };
        return {
          ok: true,
          account: { institution: "Example Credit Union", mask: "1234", environment: "production" }
        };
      }
    }
  });
  await gotoScreen(page, "closer-dashboard.html", "", CLOSER);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "/privacy/");
  await expect(page.locator("#fh-account-payout-status")).toHaveText("No payout bank linked yet.");
  await page.locator("#fh-account-payout-link").click();
  await expect(page.locator("#fh-account-payout-status")).toContainText("Example Credit Union ··1234");
  expect(calls.map((call) => call.action)).toEqual(["link_token", "exchange"]);
  expect(calls[1].account_id).toBe("plaid-account-1");
  expect(calls[1].public_token).toBe("public-token");
});

test("payout link stays hidden when Plaid Transfer is unavailable", async ({ page }) => {
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/read/staff-payout-account": () => ({
        ok: true, account: null, linking_available: false,
        linking_message: "Payout bank linking is unavailable until Plaid Transfer is enabled."
      })
    }
  });
  await gotoScreen(page, "closer-dashboard.html", "", CLOSER);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.locator("#fh-account-payout-status")).toContainText("Plaid Transfer is enabled");
  await expect(page.locator("#fh-account-payout-link")).toBeHidden();
});

test("owner account menu has no employee payout bank control", async ({ page }) => {
  await wireApi(page, { session: OWNER });
  await gotoScreen(page, "closer-dashboard.html", "", OWNER);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.locator("#fh-account-payout")).toHaveCount(0);
});

test("sales manager sees their own payout bank status", async ({ page }) => {
  const manager = { ...CLOSER, staff: { ...CLOSER.staff, role: "sales_manager" } };
  await wireApi(page, {
    session: manager,
    handlers: {
      "/api/read/staff-payout-account": () => ({
        ok: true, linking_available: false,
        account: { institution: "Example Bank", mask: "9876", environment: "sandbox" }
      })
    }
  });
  await gotoScreen(page, "closer-dashboard.html", "", manager);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.locator("#fh-account-payout-status")).toContainText("Test bank saved: Example Bank ··9876");
  await expect(page.locator("#fh-account-payout-link")).toBeHidden();
});

test("owner sees only masked payout bank status in People", async ({ page }) => {
  const ownerSession = { ...OWNER, principal: "staff" };
  const staffId = "aaaaaaaa-1111-4111-8111-111111111111";
  let requestedId = null;
  await wireApi(page, {
    session: ownerSession,
    handlers: {
      "/api/read/staff-payout-account": (route) => {
        requestedId = new URL(route.request().url()).searchParams.get("staff_id");
        return {
          ok: true, linking_available: false,
          account: { institution: "Example Bank", mask: "9876", environment: "production" }
        };
      },
      "/api/read/staff": () => ({
        ok: true, count: 1, items: [{
          id: staffId, name: "Casey Reed", email: "casey@fundhub.ai",
          role: "closer", roles: ["closer"], status: "active"
        }]
      })
    }
  });
  await gotoScreen(page, "staff-teams.html", "", ownerSession);
  await page.locator("#rosterBody tr", { hasText: "Casey Reed" }).click();
  await expect(page.locator("#edPayoutBankWrap")).toBeVisible();
  await expect(page.locator("#edPayoutBankStatus")).toHaveText("Payout destination saved: Example Bank ··9876.");
  expect(requestedId).toBe(staffId);
  await expect(page.locator("#editor")).not.toContainText("123456789");
});

test("multiple Plaid accounts wait for employee choice before token exchange", async ({ page }) => {
  const calls = [];
  await page.addInitScript(() => {
    window.Plaid = {
      create(options) {
        return {
          open() {
            options.onSuccess("one-use-public-token", {
              institution: { name: "Example Bank" },
              accounts: [
                { id: "checking-1", name: "Checking", mask: "1111" },
                { id: "checking-2", name: "Checking", mask: "2222" }
              ]
            });
          }
        };
      }
    };
  });
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/read/staff-payout-account": () => ({ ok: true, account: null, linking_available: true }),
      "/api/staff/payout-account": (route) => {
        const body = JSON.parse(route.request().postData() || "{}");
        calls.push(body);
        return body.action === "link_token"
          ? { ok: true, link_token: "link-token" }
          : { ok: true, account: { institution: "Example Bank", mask: "2222", environment: "production" } };
      }
    }
  });
  await gotoScreen(page, "closer-dashboard.html", "", CLOSER);
  await page.locator("#fh-shell-chip-show").click();
  await page.locator("#fh-account-payout-link").click();
  await expect(page.locator("#fh-account-payout-choices button")).toHaveCount(2);
  expect(calls.map((call) => call.action)).toEqual(["link_token"]);
  await page.locator("#fh-account-payout-choices button", { hasText: "2222" }).click();
  await expect(page.locator("#fh-account-payout-status")).toContainText("Example Bank ··2222");
  expect(calls.map((call) => call.action)).toEqual(["link_token", "exchange"]);
  expect(calls[1].account_id).toBe("checking-2");
});

test("secondary closer role can see their own payout bank setup", async ({ page }) => {
  const setterCloser = {
    ...CLOSER,
    staff: { ...CLOSER.staff, role: "setter", roles: ["setter", "closer"] }
  };
  await wireApi(page, {
    session: setterCloser,
    handlers: {
      "/api/read/staff-payout-account": () => ({ ok: true, account: null, linking_available: false })
    }
  });
  await gotoScreen(page, "setter-dashboard.html", "", setterCloser);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.locator("#fh-account-payout-status")).toContainText("Plaid Transfer is enabled");
});

async function openDeferredPayoutLink(page) {
  const calls = [];
  await page.addInitScript(() => {
    window.Plaid = {
      create(options) {
        return { open() { window.finishPayoutLink = options.onSuccess; } };
      }
    };
  });
  await wireApi(page, {
    session: CLOSER,
    handlers: {
      "/api/read/staff-payout-account": () => ({ ok: true, account: null, linking_available: true }),
      "/api/staff/payout-account": (route) => {
        const body = route.request().postDataJSON();
        calls.push({ ...body, authorization: route.request().headers().authorization });
        return body.action === "link_token"
          ? { ok: true, link_token: "link-token-for-original-session" }
          : { ok: true, account: { institution: "Original Bank", mask: "1234", environment: "production" } };
      }
    }
  });
  await gotoScreen(page, "closer-dashboard.html", "", CLOSER);
  await page.locator("#fh-shell-chip-show").click();
  await expect(page.locator("#fh-account-payout-status")).toHaveText("No payout bank linked yet.");
  await page.locator("#fh-account-payout-link").click();
  await page.waitForFunction(() => typeof window.finishPayoutLink === "function");
  return calls;
}

for (const nextToken of ["another-account-token", null]) {
  test(`a delayed Plaid success cannot exchange after ${nextToken ? "account switch" : "sign-out"}`, async ({ page }) => {
    const calls = await openDeferredPayoutLink(page);
    await page.evaluate((token) => {
      if (token) localStorage.setItem("fh_token", token);
      else localStorage.removeItem("fh_token");
      window.finishPayoutLink("original-public-token", { accounts: [{ id: "original-account" }] });
    }, nextToken);
    await expect(page.locator("#fh-account-payout-link")).toBeHidden();
    await expect(page.locator("#fh-account-payout-status")).toContainText("Your sign-in changed");
    expect(calls.map(call => call.action)).toEqual(["link_token"]);
    expect(calls.filter(call => call.action === "exchange")).toHaveLength(0);
  });
}

test("a delayed Plaid success under the same session exchanges once with that original bearer", async ({ page }) => {
  const calls = await openDeferredPayoutLink(page);
  await page.evaluate(() => {
    const metadata = { accounts: [{ id: "original-account" }] };
    window.finishPayoutLink("original-public-token", metadata);
    window.finishPayoutLink("original-public-token", metadata);
  });
  await expect(page.locator("#fh-account-payout-status")).toContainText("Original Bank ··1234");
  expect(calls.map(call => call.action)).toEqual(["link_token", "exchange"]);
  expect(calls.every(call => call.authorization === "Bearer e2e-token")).toBe(true);
  expect(calls[1].public_token).toBe("original-public-token");
});

test("a pending account choice is cleared instead of exchanged under a new session", async ({ page }) => {
  const calls = await openDeferredPayoutLink(page);
  await page.evaluate(() => window.finishPayoutLink("original-public-token", {
    accounts: [{ id: "original-checking", name: "Checking", mask: "1111" }, { id: "original-savings", name: "Savings", mask: "2222" }]
  }));
  await expect(page.locator("#fh-account-payout-choices button")).toHaveCount(2);
  await page.evaluate(() => localStorage.setItem("fh_token", "another-account-token"));
  await page.locator("#fh-account-payout-choices button", { hasText: "1111" }).click();
  await expect(page.locator("#fh-account-payout-choices")).toBeHidden();
  await expect(page.locator("#fh-account-payout-choices button")).toHaveCount(0);
  expect(calls.filter(call => call.action === "exchange")).toHaveLength(0);
});
