// Soft-pull approval (the client's signed link) — filled in and submitted.
//
// The client types their legal name, Social Security number, birth date and
// address here, adds businesses at $10 each, and gets a pay link. The list
// said only the page answered a ping: no test filled the form, watched the
// running total, or checked the refusals. This does all three, with the
// placeholder numbers the page itself shows (never a real person's).

import { test, expect } from "@playwright/test";

const LINK = "?org=org-1&client=c-1&exp=1999999999&sig=test-signature";
const READ = {
  ok: true,
  contact: { first_name: "Dana" },
  consent: { valid: false },
  disclosure: { version: "2.1", text: "I authorize a soft credit inquiry." },
  pricing: { base_cents: 3200, business_addon_cents: 1000, max_businesses: 20, base_display: "$32", business_addon_display: "$10" }
};

async function open(page, { query = LINK, read = READ, postAnswer } = {}) {
  const gets = [];
  const posts = [];
  await page.route("**/api/**", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      posts.push(req.postDataJSON());
      const out = postAnswer ? postAnswer() : { status: 200, body: { ok: true, pricing: { total_display: "$42" }, checkout: { checkout_url: "https://pay.example.test/c/abc", amount_display: "$42" } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
    gets.push(req.url());
    const body = typeof read === "function" ? read() : read;
    return route.fulfill({ status: body.ok ? 200 : 410, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.goto(`/app/soft-pull-approve.html${query}`);
  return { gets, posts };
}

async function fillPerson(page, { street = "12 Main St" } = {}) {
  await page.locator("#granted_name").fill("Dana Whitfield");
  await page.locator("#ssn").fill("123-45-6789");
  await page.locator("#dob").fill("1985-04-12");
  await page.locator("#address_line1").fill(street);
  await page.locator("#city").fill("Phoenix");
  await page.locator("#state").fill("AZ");
  await page.locator("#postal_code").fill("85004");
}

async function fillBiz(page, i, { ein = "123456789", inc = "2021-03" } = {}) {
  await page.locator(`#biz_name_${i}`).fill(`Acme ${i + 1} LLC`);
  await page.locator(`#biz_line1_${i}`).fill("500 Commerce Way");
  await page.locator(`#biz_city_${i}`).fill("Tempe");
  await page.locator(`#biz_state_${i}`).fill("AZ");
  await page.locator(`#biz_zip_${i}`).fill("85281");
  await page.locator(`#biz_ein_${i}`).fill(ein);
  if (inc) await page.locator(`#biz_inc_${i}`).fill(inc);
}

test.describe("soft-pull approval page", () => {
  test("a link missing its parts says so and asks the server nothing", async ({ page }) => {
    const { gets } = await open(page, { query: "?org=org-1" });
    await expect(page.locator("h1")).toHaveText("Link problem");
    await expect(page.locator(".err")).toHaveText("This page needs a full link from your advisor.");
    expect(gets).toEqual([]);
  });

  test("an expired link shows the server's words, not a form", async ({ page }) => {
    await open(page, { read: { ok: false, error: "link_expired", message: "This link has expired." } });
    await expect(page.locator(".err")).toHaveText("This link has expired.");
    await expect(page.locator("#f")).toHaveCount(0);
  });

  test("a signed link for someone without an account opens the lasting claim page", async ({ page }) => {
    await open(page, { read: { ok: false, error: "account_required", create_account_url: "/portal-login.html?mode=claim" } });
    await page.waitForURL("**/portal-login.html?mode=claim");
    await expect(page.getByRole("heading", { name: "Set up your Fundhub portal." })).toBeVisible();
  });

  test("the running total adds $10 per business and drops it when one is removed", async ({ page }) => {
    await open(page);
    await expect(page.locator("#total_line")).toContainText("Total due: $32");
    await page.locator("#add_biz").click();
    await expect(page.locator("#total_line")).toContainText("Total due: $42");
    await expect(page.locator("#total_line")).toContainText("1 × $10");
    await page.locator("#add_biz").click();
    await expect(page.locator("#total_line")).toContainText("Total due: $52");
    await page.locator('[data-rm="0"]').click();
    await expect(page.locator("#total_line")).toContainText("Total due: $42");
  });

  test("+ Add a business stops at 20: the button goes off, and the total stops at $232", async ({ page }) => {
    await open(page);
    for (let i = 0; i < 20; i += 1) await page.locator("#add_biz").click();
    await expect(page.locator("[data-rm]")).toHaveCount(20);
    await expect(page.locator("#add_biz")).toBeDisabled();
    await expect(page.locator("#total_line")).toContainText("Total due: $232");
    await expect(page.locator("#total_line")).toContainText("20 × $10");
    await page.locator('[data-rm="19"]').click();
    await expect(page.locator("#add_biz")).toBeEnabled();
    await expect(page.locator("#total_line")).toContainText("Total due: $222");
  });

  test("an address of only spaces is refused before anything is sent", async ({ page }) => {
    const { posts } = await open(page);
    await fillPerson(page, { street: "   " });
    await page.locator("#go").click();
    await expect(page.locator("#msg .err")).toHaveText("Enter your current street address, city, state and ZIP.");
    expect(posts).toEqual([]);
  });

  test("a business with a short EIN is refused before anything is sent", async ({ page }) => {
    const { posts } = await open(page);
    await fillPerson(page);
    await page.locator("#add_biz").click();
    await fillBiz(page, 0, { ein: "12345" });
    await page.locator("#go").click();
    await expect(page.locator("#msg .err")).toHaveText("Business 1: enter a 9-digit EIN (you can type 12-3456789).");
    expect(posts).toEqual([]);
  });

  test("a full form sends the link, the person, and each business (EIN written 12-3456789); the Pay link shows the total", async ({ page }) => {
    const { posts } = await open(page);
    await fillPerson(page);
    await page.locator("#add_biz").click();
    await fillBiz(page, 0);
    await page.locator("#go").click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toEqual({
      org: "org-1", client: "c-1", exp: "1999999999", sig: "test-signature",
      granted_name: "Dana Whitfield", ssn: "123-45-6789", dob: "1985-04-12",
      address_line1: "12 Main St", city: "Phoenix", state: "AZ", postal_code: "85004",
      businesses: [{
        name: "Acme 1 LLC", address_line1: "500 Commerce Way", city: "Tempe", state: "AZ", postal_code: "85281",
        ein: "12-3456789", incorporated_date: "2021-03", extra_owner_name: ""
      }]
    });
    await expect(page.locator("h1")).toHaveText("Consent saved");
    await expect(page.locator(".btn-pay")).toHaveText("Pay $42 assessment");
    await expect(page.locator(".btn-pay")).toHaveAttribute("href", "https://pay.example.test/c/abc");
  });

  test("no pay link came back: the screen says to ask the advisor for it, with the total", async ({ page }) => {
    await open(page, { postAnswer: () => ({ status: 200, body: { ok: true, pricing: { total_display: "$32" }, checkout: null, checkout_error: "commas_down" } }) });
    await fillPerson(page);
    await page.locator("#go").click();
    await expect(page.locator("h1")).toHaveText("Consent saved");
    await expect(page.locator(".lede").first()).toHaveText("Ask your advisor for the pay link for $32.");
    await expect(page.locator(".btn-pay")).toHaveCount(0);
  });

  test("a prior payment below the new total does not promise a report or charge", async ({ page }) => {
    await open(page, {
      read: { ...READ, paid: true },
      postAnswer: () => ({ status: 201, body: {
        ok: true, paid: true, payment_review_required: true, checkout: null,
        pricing: { total_display: "$42" },
        next: "Your earlier payment does not cover the updated assessment total. Contact your advisor to review the difference."
      } })
    });
    await expect(page.getByText(/previous assessment payment is on file/i)).toBeVisible();
    await fillPerson(page);
    await page.locator("#go").click();
    await expect(page.locator("h1")).toHaveText("Consent saved");
    await expect(page.locator(".err")).toContainText("earlier payment does not cover");
    await expect(page.locator(".btn-pay")).toHaveCount(0);
    await expect(page.getByText(/credit report will appear/i)).toHaveCount(0);
    await expect(page.locator(".lede").first()).toContainText("Contact your advisor");
  });

  test("a refusal from the server is shown and the button comes back", async ({ page }) => {
    await open(page, { postAnswer: () => ({ status: 400, body: { ok: false, error: "ssn_invalid", message: "Enter all 9 digits of your Social Security number." } }) });
    await fillPerson(page);
    await page.locator("#go").click();
    await expect(page.locator("#msg .err")).toHaveText("Enter all 9 digits of your Social Security number.");
    await expect(page.locator("#go")).toBeEnabled();
  });
});
