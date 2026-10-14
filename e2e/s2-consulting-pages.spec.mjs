// FH Consulting site (/consulting/) — the two journey steps a browser can judge
// without taking anyone's word for it:
//
//   1. "Open /consulting/"          the page answers with its own headline
//   4. "Open Terms, Privacy, Refund" each legal page answers, titled for itself,
//                                    and the home page links to all three
//
// The other steps of the intended journey (posted prices, education wording,
// the enrollment mail address) do NOT match the live page and are deliberately
// not asserted here; see the slice-2 manifest.
//
// NO BACKEND: the static server hands over public/.
import { test, expect } from "@playwright/test";

test.describe("FH Consulting pages open", () => {
  test("the home page opens at /consulting/ with its headline and the three legal links", async ({ page }) => {
    const response = await page.goto("/consulting/");
    expect(response.status()).toBe(200);
    await expect(page.locator("h1")).toHaveText("Set up the tools the team will use.");
    await expect(page).toHaveTitle(/FH Consulting/);
    for (const href of ["/consulting/terms/", "/consulting/privacy/", "/consulting/refund/"]) {
      await expect(page.locator(`footer a[href="${href}"]`)).toHaveCount(1);
    }
  });

  for (const [path, title] of [
    ["/consulting/terms/", /Terms/i],
    ["/consulting/privacy/", /Privacy/i],
    ["/consulting/refund/", /Refund/i],
  ]) {
    test(`${path} opens and is titled for itself`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response.status()).toBe(200);
      await expect(page).toHaveTitle(title);
      await expect(page.locator("h1")).toContainText(title);
    });
  }

  test("a footer link from the home page lands on each legal page", async ({ page }) => {
    for (const [href, title] of [
      ["/consulting/terms/", /Terms/i], ["/consulting/privacy/", /Privacy/i], ["/consulting/refund/", /Refund/i],
    ]) {
      await page.goto("/consulting/");
      await page.locator(`footer a[href="${href}"]`).click();
      await expect(page).toHaveURL(new RegExp(`${href}$`));
      await expect(page.locator("h1")).toContainText(title);
    }
  });
});
