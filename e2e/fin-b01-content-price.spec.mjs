// Content admin, "Locked tile editor: price shown box" (finish-the-853, batch 01).
//
// The price a locked tile shows is saved as whole cents in one POST
// /api/content/tiles. Judged here: what the box paints from the saved cents, the
// exact cents the Save sends (a rounding trap, free, and unknown), and what the
// page says when the server refuses a price.
//
// NO BACKEND: page.route() answers /api/**, nothing is saved anywhere.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const BUNDLE = {
  ok: true,
  videos: [],
  map: {},
  products: [{ id: "repair", name: "Repair DFY", note: "repair" }],
  tiles: [
    { code: "REPAIR", name: "Credit repair", copy: "Clean up your file.", price_cents: 100000, on: true },
    { code: "MASTERY", name: "Funding Mastery", copy: "Learn the system.", price_cents: null, on: true },
    { code: "REPORT", name: "Credit analysis", copy: "Your report.", price_cents: 3200, on: true },
  ],
};

async function open(page, { saveAnswer } = {}) {
  const saves = [];
  await openScreen(page, "/app/content-admin.html", OWNER, {
    "/api/content/tiles": async (route, { method }) => {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        saves.push(body);
        const out = saveAnswer ? saveAnswer(body) : { status: 200, body: { ...BUNDLE } };
        return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
      }
      return json(route, BUNDLE);
    },
  });
  await expect(page.locator("#saveBtn")).toBeVisible();
  await expect(page.locator('.ted[data-ed="REPAIR"]')).toBeVisible();
  return { saves };
}

const price = (page, code) => page.locator(`.ted[data-ed="${code}"] [data-f="price"]`);
const savedTile = (body, code) => body.tiles.find((t) => t.code === code);

test.describe("content admin: the price shown box", () => {
  test("each box paints its saved cents as dollars, and an unknown price is an empty box, not $0", async ({ page }) => {
    await open(page);
    await expect(price(page, "REPAIR")).toHaveValue("1000");
    await expect(price(page, "REPORT")).toHaveValue("32");
    await expect(price(page, "MASTERY")).toHaveValue("");
  });

  test("a price with cents is saved as whole cents, rounded the way a person reads it", async ({ page }) => {
    const { saves } = await open(page);
    await price(page, "REPAIR").fill("19.99");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(savedTile(saves[0], "REPAIR").price_cents).toBe(1999);
    // The other two tiles go in the same save, untouched.
    expect(savedTile(saves[0], "REPORT").price_cents).toBe(3200);
    expect(savedTile(saves[0], "MASTERY").price_cents).toBe(null);
  });

  test("a price of 0 is saved as 0 (free), which is not the same as empty (unknown)", async ({ page }) => {
    const { saves } = await open(page);
    await price(page, "MASTERY").fill("0");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(savedTile(saves[0], "MASTERY").price_cents).toBe(0);
  });

  test("clearing a price saves unknown (null), never 0", async ({ page }) => {
    const { saves } = await open(page);
    await price(page, "REPORT").fill("");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(savedTile(saves[0], "REPORT").price_cents).toBe(null);
  });

  test("a price the server refuses is said in the server's own words, and the box keeps what was typed", async ({ page }) => {
    const { saves } = await open(page, {
      saveAnswer: () => ({
        status: 400,
        body: { ok: false, error: "invalid_price", message: "Price is whole cents, or leave it empty." },
      }),
    });
    await price(page, "REPAIR").fill("-5");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(savedTile(saves[0], "REPAIR").price_cents).toBe(-500);
    await expect(page.locator("body")).toContainText("Price is whole cents, or leave it empty.");
    await expect(price(page, "REPAIR")).toHaveValue("-5");
    await expect(page.locator("#saveBtn")).toBeEnabled();
  });
});
