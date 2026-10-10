// Content (Setup) — what a client sees in their portal, edited for real.
//
// The locked tiles (name, one line, price shown, Showing/Hidden), the welcome
// video per tier, and the upload box (Choose file, drag and drop, title,
// duration, tier). The list said the upload boxes were filled by no test and
// the drop zone had no test. This presses all of it and checks the exact save:
// price in whole cents, an empty price saved as unknown (never $0), and an
// upload that lands the new video on the tier picked.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const BUNDLE = {
  ok: true,
  videos: [{ id: "v1", title: "Welcome — funding", duration_label: "2:10", uploaded_at: "2026-10-01T12:00:00Z" }],
  map: { "card-stacking": "v1" },
  products: [{ id: "card-stacking", name: "Card Stacking DFY", note: "funding" }, { id: "repair", name: "Repair DFY", note: "repair" }],
  tiles: [
    { code: "REPAIR", name: "Credit repair", copy: "Clean up your file.", price_cents: 100000, on: true },
    { code: "MASTERY", name: "Funding Mastery", copy: "Learn the system.", price_cents: 49700, on: true }
  ]
};

async function open(page, { saveAnswer, uploadAnswer } = {}) {
  const saves = [];
  const uploads = [];
  await openScreen(page, "/app/content-admin.html", OWNER, {
    "/api/content/tiles": async (route, { method }) => {
      if (method === "POST") {
        const body = route.request().postDataJSON();
        saves.push(body);
        const out = saveAnswer ? saveAnswer(body) : { status: 200, body: { ...BUNDLE, map: body.map || BUNDLE.map } };
        return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
      }
      return json(route, BUNDLE);
    },
    "/api/content/upload": async (route) => {
      uploads.push({ type: route.request().headers()["content-type"], body: route.request().postDataBuffer()?.toString("latin1") || "" });
      const out = uploadAnswer || { status: 200, body: { ok: true, video: { id: "v-new", title: "Repair welcome" } } };
      return route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    }
  });
  await expect(page.locator("#saveBtn")).toBeVisible();
  await expect(page.locator('.ted[data-ed="REPAIR"]')).toBeVisible();
  return { saves, uploads };
}

const ed = (page, code) => page.locator(`.ted[data-ed="${code}"]`);

test.describe("content admin: tiles and tiers", () => {
  test("edit a tile, hide another, pick a tier video, Save: the exact save goes out, price in cents", async ({ page }) => {
    const { saves } = await open(page);
    await ed(page, "REPAIR").locator('[data-f="name"]').fill("Credit repair, done for you");
    await ed(page, "REPAIR").locator('[data-f="copy"]').fill("We fix your file.");
    await ed(page, "REPAIR").locator('[data-f="price"]').fill("1200");
    await ed(page, "MASTERY").locator("[data-toggle]").click();
    await expect(ed(page, "MASTERY").locator("[data-state]")).toHaveText("Hidden");
    await page.locator('select[data-tier="repair"]').selectOption("v1");
    await expect(page.locator("#liveTxt")).toContainText("unsaved");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({
      action: "save",
      tiles: [
        { code: "REPAIR", name: "Credit repair, done for you", copy: "We fix your file.", price_cents: 120000, on: true },
        { code: "MASTERY", name: "Funding Mastery", copy: "Learn the system.", price_cents: 49700, on: false }
      ],
      map: { "card-stacking": "v1", repair: "v1" }
    });
  });

  test("an empty price is saved as unknown (null), never as $0", async ({ page }) => {
    const { saves } = await open(page);
    await ed(page, "MASTERY").locator('[data-f="price"]').fill("");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].tiles[1].price_cents).toBe(null);
  });

  test("the Showing/Hidden switch works from the keyboard too (Space)", async ({ page }) => {
    const { saves } = await open(page);
    await ed(page, "REPAIR").locator("[data-toggle]").focus();
    await page.keyboard.press(" ");
    await expect(ed(page, "REPAIR").locator("[data-toggle]")).toHaveAttribute("aria-checked", "false");
    await page.locator("#saveBtn").click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0].tiles[0].on).toBe(false);
  });

  test("a refused save is said at the top, and the button comes back", async ({ page }) => {
    await open(page, { saveAnswer: () => ({ status: 403, body: { ok: false, error: "forbidden" } }) });
    await page.locator("#saveBtn").click();
    await expect(page.locator("#noBackendNotice")).toBeVisible();
    await expect(page.locator("#noticeTxt")).toContainText("not allowed");
    await expect(page.locator("#saveBtn")).toBeEnabled();
  });
});

test.describe("content admin: upload a welcome video", () => {
  const FILE = { name: "repair-welcome.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video, just bytes for the test") };

  test("Choose file fills the title; Upload sends the file, title and duration, then saves the tier it was put on", async ({ page }) => {
    const { saves, uploads } = await open(page);
    await expect(page.locator("#doUpload")).toBeDisabled();
    await page.locator("#vfile").setInputFiles(FILE);
    await expect(page.locator("#picked")).toContainText("repair-welcome.mp4");
    await expect(page.locator("#upTitle")).toHaveValue("repair-welcome");
    await page.locator("#upTitle").fill("Repair welcome");
    await page.locator("#upDur").fill("1:45");
    await page.locator("#upTier").selectOption("repair");
    await page.locator("#doUpload").click();
    await expect.poll(() => uploads.length).toBe(1);
    expect(uploads[0].type).toMatch(/^multipart\/form-data; boundary=/);
    expect(uploads[0].body).toContain('name="title"');
    expect(uploads[0].body).toContain("Repair welcome");
    expect(uploads[0].body).toContain('name="duration"');
    expect(uploads[0].body).toContain("1:45");
    expect(uploads[0].body).toContain('filename="repair-welcome.mp4"');
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ action: "save", map: { "card-stacking": "v1", repair: "v-new" } });
    // The box resets for the next file. (The "Uploaded." line is cleared by that
    // same reset, so it is not asserted here.)
    await expect(page.locator("#picked")).toHaveText("");
    await expect(page.locator("#doUpload")).toBeDisabled();
  });

  test("a file dropped on the box is picked the same way; Clear puts the box back", async ({ page }) => {
    const { uploads } = await open(page);
    await page.locator("#drop").evaluate((drop) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["bytes"], "dropped-welcome.mov", { type: "video/quicktime" }));
      drop.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await expect(page.locator("#picked")).toContainText("dropped-welcome.mov");
    await expect(page.locator("#doUpload")).toBeEnabled();
    await page.locator("#clearUpload").click();
    await expect(page.locator("#picked")).toHaveText("");
    await expect(page.locator("#doUpload")).toBeDisabled();
    expect(uploads).toEqual([]);
  });

  test("a refused upload says why and lets them try again; no tier is saved", async ({ page }) => {
    const { saves } = await open(page, { uploadAnswer: { status: 400, body: { ok: false, error: "too_big", message: "That file is over the size limit." } } });
    await page.locator("#vfile").setInputFiles(FILE);
    await page.locator("#upTier").selectOption("repair");
    await page.locator("#doUpload").click();
    await expect(page.locator("#upHint")).toHaveText("That file is over the size limit.");
    await expect(page.locator("#doUpload")).toBeEnabled();
    expect(saves).toEqual([]);
  });
});
