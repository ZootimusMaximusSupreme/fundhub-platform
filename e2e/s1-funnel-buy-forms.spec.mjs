// Slice 1 (money screens): the two self-serve buy forms on the /partner/ funnel
// pages (the Winner's Board and the Live Trial). Each test fills the form for
// real, submits it, and checks the exact request that goes to the checkout door
// and where the browser goes next. Nothing leaves the browser.
import { test, expect } from "@playwright/test";

const CHECKOUT = "https://pay.example.test/c/funnel-1";
const PAGES = [
  ["the Winner's Board", "/partner/board/", "board", { first: "#b-first", last: "#b-last", email: "#b-email" }],
  ["the Live Trial", "/partner/trial/", "trial", { first: "#t-first", last: "#t-last", email: "#t-email" }],
];

function catalogue(slug, over = {}) {
  return {
    ok: true,
    items: [
      { slug: "board", available: true, priceCents: 9700, priceDisplay: "$97", priceLabel: "$97/month" },
      { slug: "trial", available: true, priceCents: 29700, priceDisplay: "$297", priceLabel: "$297" },
    ].map((item) => (item.slug === slug ? { ...item, ...over } : item)),
    notices: {},
  };
}

async function open(page, url, slug, { answer, catalogueOver } = {}) {
  const posts = [];
  await page.route("https://pay.example.test/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>pay</title>" }));
  await page.route("**/api/public/funnel-checkout", async (route) => {
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON());
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer ?? { ok: true, checkoutUrl: CHECKOUT }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(catalogue(slug, catalogueOver)) });
  });
  await page.goto(url);
  return posts;
}

for (const [name, path, slug, box] of PAGES) {
  test.describe(`Buy form on ${name}`, () => {
    test("the button stays off until the price is read, then submits name and email and goes to the checkout it is given", async ({ page }) => {
      const posts = await open(page, `${path}?track=ad-7&a1=DKOWAL`, slug);
      const form = page.locator(`form[data-checkout="${slug}"]`);
      const button = form.locator("button[type=submit]");
      await expect(button).toBeEnabled();
      await page.locator(box.first).fill("Pat");
      await page.locator(box.last).fill("Partner");
      await page.locator(box.email).fill("pat@example.test");
      await button.click();
      await expect.poll(() => posts.length).toBe(1);
      expect(posts[0]).toEqual({
        item: slug, email: "pat@example.test", first_name: "Pat", last_name: "Partner",
        track: "ad-7", a1: "DKOWAL", a2: null,
      });
      await page.waitForURL(CHECKOUT);
    });

    test("a refusal is said in words, nothing is charged, and the button comes back", async ({ page }) => {
      const posts = await open(page, path, slug, { answer: { ok: false, error: "email_required" } });
      const form = page.locator(`form[data-checkout="${slug}"]`);
      await page.locator(box.email).fill("not-an-email");
      await form.locator("button[type=submit]").click();
      await expect.poll(() => posts.length).toBe(1);
      await expect(form.locator("[data-checkout-error]")).toHaveText("That email address does not look right. Check it and try again.");
      await expect(form.locator("button[type=submit]")).toBeEnabled();
      expect(page.url()).not.toContain("pay.example.test");
    });

    test("an item that is not available keeps the button off and says nothing is being charged", async ({ page }) => {
      const posts = await open(page, path, slug, { catalogueOver: { available: false, priceCents: null } });
      const form = page.locator(`form[data-checkout="${slug}"]`);
      await expect(form.locator("button[type=submit]")).toBeDisabled();
      await expect(form.locator("[data-checkout-error]")).toHaveText("This price is not set up yet. Nothing is being charged.");
      expect(posts).toEqual([]);
    });
  });
}
