// Proves the client-portal content desk (public/app/content-admin.html): the
// locked tiles (name, one line, price, Showing/Hidden), the welcome video per
// tier, and the upload box. Every save is checked for the exact fields.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const BUNDLE = {
  ok: true,
  videos: [{ id: "v1", title: "Welcome — funding", duration_label: "2:10", uploaded_at: "2026-10-01T12:00:00Z" }],
  map: { "card-stacking": "v1" },
  products: [{ id: "card-stacking", name: "Card Stacking DFY", note: "funding" }, { id: "repair", name: "Repair DFY", note: "repair" }],
  tiles: [
    { code: "REPAIR", name: "Credit repair", copy: "Clean up your file.", price_cents: 100000, on: true },
    { code: "MASTERY", name: "Funding Mastery", copy: "Learn the system.", price_cents: 49700, on: true },
  ],
};
const FILE = { name: "repair-welcome.mp4", mimeType: "video/mp4", buffer: Buffer.from("not really a video, just bytes for the test") };
const ed = (page, code) => page.locator(`.ted[data-ed="${code}"]`);

async function openDesk(open, { saveStatus = 200 } = {}) {
  const saves = [];
  const uploads = [];
  const handlers = {
    "/api/content/tiles": async (route, { method }) => {
      if (method !== "POST") return json(route, BUNDLE);
      const body = bodyOf(route);
      saves.push(body);
      return route.fulfill({
        status: saveStatus, contentType: "application/json",
        body: JSON.stringify(saveStatus === 200 ? { ...BUNDLE, map: body.map || BUNDLE.map } : { ok: false, error: "forbidden" }),
      });
    },
    "/api/content/upload": async (route) => {
      const request = route.request();
      uploads.push({ type: request.headers()["content-type"] || "", body: request.postDataBuffer()?.toString("latin1") || "" });
      return json(route, { ok: true, video: { id: "v-new", title: "Repair welcome" } });
    },
  };
  const { page, errors } = await open("/app/content-admin.html", { session: OWNER, handlers });
  await page.waitForSelector('.ted[data-ed="REPAIR"]');
  return { page, errors, saves, uploads };
}

test("edited tiles, the switch and the tier videos save exactly, price in whole cents", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, saves, errors } = await openDesk(open);

  // Edit the desk, press Save once, then each row is proved by what that one save carried.
  await ed(page, "REPAIR").locator('[data-f="name"]').fill("Credit repair, done for you");
  await ed(page, "REPAIR").locator('[data-f="copy"]').fill("We fix your file.");
  await ed(page, "REPAIR").locator('[data-f="price"]').fill("1200");
  await ed(page, "MASTERY").locator("[data-toggle]").click();
  const mastery = await ed(page, "MASTERY").locator("[data-state]").innerText();
  await ed(page, "REPAIR").locator("[data-toggle]").focus();
  await page.keyboard.press(" ");
  const afterOneSpace = await ed(page, "REPAIR").locator("[data-toggle]").getAttribute("aria-checked");
  await page.keyboard.press(" ");
  const afterTwoSpaces = await ed(page, "REPAIR").locator("[data-toggle]").getAttribute("aria-checked");
  await page.locator('select[data-tier="repair"]').selectOption("v1");
  assert.match(await page.locator("#liveTxt").innerText(), /unsaved/i);
  await page.locator("#saveBtn").click();
  await waitFor(() => saves.length === 1);

  await proof.check(/^Locked tile editor: client-facing name box/, async () => {
    assert.equal(saves[0].tiles.find((x) => x.code === "REPAIR").name, "Credit repair, done for you");
    assert.equal(saves[0].tiles.find((x) => x.code === "MASTERY").name, "Funding Mastery", "a tile left alone keeps its name");
  });
  await proof.check(/^Locked tile editor: outcome copy box/, async () => {
    const repair = saves[0].tiles.find((x) => x.code === "REPAIR");
    assert.equal(repair.copy, "We fix your file.");
    assert.equal(repair.price_cents, 120000, "the price is saved in whole cents");
  });
  await proof.check(/^Locked tile editor: Showing\/Hidden switch/, async () => {
    assert.match(mastery, /^hidden$/i);
    assert.equal(afterOneSpace, "false", "Space flips it too");
    assert.equal(afterTwoSpaces, "true");
    assert.deepEqual(saves[0].tiles.map((x) => [x.code, x.on]), [["REPAIR", true], ["MASTERY", false]], "the switches are what is saved");
  });
  await proof.check(/^Save changes button/, async () => {
    assert.deepEqual(saves[0], {
      action: "save",
      tiles: [
        { code: "REPAIR", name: "Credit repair, done for you", copy: "We fix your file.", price_cents: 120000, on: true },
        { code: "MASTERY", name: "Funding Mastery", copy: "Learn the system.", price_cents: 49700, on: false },
      ],
      map: { "card-stacking": "v1", repair: "v1" },
    });
    // the desk repaints from the saved answer; then an emptied price is unknown, never $0
    await page.waitForFunction(() => !/unsaved/i.test(document.querySelector("#liveTxt")?.innerText || ""));
    await ed(page, "MASTERY").locator('[data-f="price"]').fill("");
    await page.locator("#saveBtn").click();
    await waitFor(() => saves.length === 2);
    assert.equal(saves[1].tiles[1].price_cents, null);
  });
  assert.deepEqual(errors, []);
  await page.close();
});

test("a refused save is said at the top and the button comes back", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page } = await openDesk(open, { saveStatus: 403 });
  await page.locator("#saveBtn").click();
  await page.waitForFunction(() => /not allowed/i.test(document.querySelector("#noticeTxt")?.innerText || ""));
  assert.equal(await page.locator("#saveBtn").isEnabled(), true);
  await page.close();
});

test("a dropped file is picked like a chosen one and Clear puts the box back", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, uploads } = await openDesk(open);

  await proof.check(/^Upload welcome video: Choose file button and drag-and-drop box/, async () => {
    assert.equal(await page.locator("#doUpload").isDisabled(), true, "nothing to send yet");
    await page.locator("#drop").evaluate((drop) => {
      const dt = new DataTransfer();
      dt.items.add(new File(["bytes"], "dropped-welcome.mov", { type: "video/quicktime" }));
      drop.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    assert.match(await page.locator("#picked").innerText(), /dropped-welcome\.mov/);
    assert.equal(await page.locator("#doUpload").isEnabled(), true);
    await page.locator("#clearUpload").click();
    assert.equal(await page.locator("#picked").innerText(), "");
    assert.equal(await page.locator("#doUpload").isDisabled(), true);
    assert.deepEqual(uploads, [], "nothing is sent by choosing or clearing");
  });
  await page.close();
});

test("Upload sends file, title and duration, then saves the tier the video was put on", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, saves, uploads } = await openDesk(open);

  await proof.check(/^Upload welcome video: Title, Duration, Assign to tier/, async () => {
    await page.locator("#vfile").setInputFiles(FILE);
    assert.match(await page.locator("#picked").innerText(), /repair-welcome\.mp4/);
    assert.equal(await page.locator("#upTitle").inputValue(), "repair-welcome", "the title starts from the file name");
    await page.locator("#upTitle").fill("Repair welcome");
    await page.locator("#upDur").fill("1:45");
    await page.locator("#upTier").selectOption("repair");
    await page.locator("#doUpload").click();
    await waitFor(() => uploads.length === 1);
    assert.match(uploads[0].type, /^multipart\/form-data; boundary=/);
    for (const part of ['name="title"', "Repair welcome", 'name="duration"', "1:45", 'filename="repair-welcome.mp4"']) {
      assert.ok(uploads[0].body.includes(part), `the upload carries ${part}`);
    }
    await waitFor(() => saves.length === 1);
    assert.deepEqual(saves[0], { action: "save", map: { "card-stacking": "v1", repair: "v-new" } }, "the new video is put on the tier picked");
    await page.waitForFunction(() => document.querySelector("#picked").innerText === "");
    assert.equal(await page.locator("#doUpload").isDisabled(), true, "the box resets for the next file");
  });
  await page.close();
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
