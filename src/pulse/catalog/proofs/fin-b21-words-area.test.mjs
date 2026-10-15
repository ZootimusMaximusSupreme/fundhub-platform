// Batch 21 practice test for the Teleprompter "Words area" row (teleprompter.html). Real Chromium, the real
// page and its scripts, fake /api answers built from the API contract's own example. Nothing is read from a
// live server and nothing is sent anywhere. This is a practice test, not a live check.
//
// The row's words (desks-f.json) say: one tap plays or pauses; double tap pauses and opens a cursor; hold a
// line edits that line; drag moves the words. Two of those were taken out by the owner on 2026-10-13
// (docs/journeys/CHANGELOG.md: "we just edit and copy and paste"; docs/journeys/shoot-flow.md section 4a:
// a double tap shows Copy script, Paste script and X, and nothing else). So this file proves what the owner
// chose and what a person gets today:
//   one tap plays, a second tap pauses;
//   a drag moves the words by hand (thumb up goes forward, thumb down goes back) and does not start them;
//   a double tap pauses the words and shows Copy script, Paste script and X, with no cursor, no keyboard,
//   no edit box and no Save;
//   holding a line changes nothing.
// The row's own words "opens a cursor" and "hold a line edits that line" are not what a person gets, and
// that is by owner call. If a cursor or a hold-to-edit box ever comes back, these tests go red by name.

import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT } from "../../../marketing/api-contract.mjs";
import { blockOutside, clone, json, openWorld, waitFor } from "./fin-b21-browser-kit.mjs";

const SHOOT = clone(CONTRACT["GET marketing/shoot"].example.response);

// A point in the middle of the words, clear of the top edge strip and the bottom bar.
const X = 195;
const Y = 420;

const state = (page) => page.evaluate(() => window.__fhtp.state());

/** Everything that would mean "a person can edit words on the phone". */
const editState = (page) => page.evaluate(() => {
  const content = document.getElementById("content");
  return {
    copying: document.body.classList.contains("copying"),
    wording: document.body.classList.contains("wording"),
    editing: document.body.classList.contains("editing"),
    editable: content.hasAttribute("contenteditable"),
    boxes: document.querySelectorAll("#content textarea, #content input, .edit-box, .word-box").length,
    saveShown: !document.getElementById("b-script-save").hidden && getComputedStyle(document.getElementById("b-script-save")).display !== "none",
    activeIsField: !!document.activeElement && /^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)
  };
});

async function openPage(world) {
  const page = await world.browser.newPage({ viewport: { width: 390, height: 844 } });
  await blockOutside(page, world.origin);
  const log = { marks: [], posts: [], errors: [] };
  page.on("pageerror", (e) => log.errors.push(String(e)));
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "practice-token");
    localStorage.setItem("fhtp.settings", JSON.stringify({ countdown: false }));
  });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const name = new URL(request.url()).pathname.replace(/^\/api\//, "");
    if (request.method() === "GET" && name === "marketing/shoot") return json(route, SHOOT);
    if (request.method() === "GET" && name === "marketing/health") {
      return json(route, { ok: true, outbox: { held_reason: null, token_present: true } });
    }
    if (request.method() === "POST") {
      log.posts.push(name);
      if (name === "marketing/shoot/mark") log.marks.push(JSON.parse(request.postData() || "{}"));
      return json(route, { marks: {} });
    }
    return json(route, { error: "not_found", path: name }, 404);
  });
  await page.goto(`${world.origin}/app/teleprompter.html`);
  await page.locator("#content .w").first().waitFor({ state: "visible" });
  return { page, log };
}

/** One finger down at (X, fromY), moved in six steps to toY, then up. */
async function drag(page, fromY, toY) {
  await page.mouse.move(X, fromY);
  await page.mouse.down();
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(X, fromY + ((toY - fromY) * i) / 6);
  await page.mouse.up();
}

test("the teleprompter words area practice tests run in a real browser", { timeout: 180_000 }, async (t) => {
  const world = await openWorld();
  t.after(() => world.close());

  await t.test("one tap on the words plays them and a second tap pauses them, and neither sends a mark", async () => {
    const { page, log } = await openPage(world);
    assert.equal((await state(page)).playing, false, "the words wait for a tap");
    await page.mouse.click(X, Y);
    await waitFor(async () => (await state(page)).playing, "one tap did not play the words", 3000);
    assert.equal(await page.locator("#play").innerText(), "Pause", "the Play button says Pause while the words roll");
    await page.waitForTimeout(450);
    const rolled = (await state(page)).t;
    assert.ok(rolled > 0.2, `the words rolled forward (${rolled})`);
    await page.mouse.click(X, Y);
    await waitFor(async () => !(await state(page)).playing, "a second tap did not pause the words", 3000);
    assert.equal(await page.locator("#play").innerText(), "Play");
    const stopped = (await state(page)).t;
    await page.waitForTimeout(500);
    assert.equal((await state(page)).t, stopped, "paused words do not move");
    assert.deepEqual(log.marks, [], "playing and pausing marks nothing");
    assert.deepEqual(log.errors, []);
    await page.close();
  });

  await t.test("a drag moves the words by hand, thumb up goes forward and thumb down goes back, and it does not start the roll", async () => {
    const { page, log } = await openPage(world);
    const start = (await state(page)).t;
    assert.equal(start, 0);
    await drag(page, 520, 360);
    const forward = await state(page);
    assert.ok(forward.t > start + 0.5, `thumb up moved the words forward (${start} to ${forward.t})`);
    assert.equal(forward.playing, false, "a drag does not start the roll");
    await drag(page, 360, 440);
    const back = await state(page);
    assert.ok(back.t < forward.t - 0.2, `thumb down moved the words back (${forward.t} to ${back.t})`);
    assert.ok(back.t >= 0);
    assert.equal(back.playing, false);
    assert.deepEqual((await editState(page)).copying, false, "a drag is not a double tap");
    assert.deepEqual(log.marks, []);
    assert.deepEqual(log.errors, []);
    await page.close();
  });

  await t.test("a double tap pauses the words and shows Copy script, Paste script and X, with no cursor, no keyboard and no edit box", async () => {
    // Paused first: the first tap of the pair must not start the words.
    const first = await openPage(world);
    await first.page.mouse.dblclick(X, Y);
    await waitFor(async () => (await editState(first.page)).copying, "a double tap did not show the Copy script bar", 3000);
    await first.page.waitForTimeout(500);
    const paused = await state(first.page);
    assert.equal(paused.playing, false, "two taps never play the words");
    assert.equal(paused.editing, false);
    const bar = await editState(first.page);
    assert.deepEqual({ ...bar, copying: undefined }, {
      copying: undefined, wording: false, editing: false, editable: false, boxes: 0, saveShown: false, activeIsField: false
    });
    assert.equal(await first.page.locator("#b-script-copy").isVisible(), true);
    assert.equal(await first.page.locator("#b-script-copy").innerText(), "Copy script");
    assert.equal(await first.page.locator("#b-script-paste").isVisible(), true);
    assert.equal(await first.page.locator("#b-script-paste").innerText(), "Paste script");
    assert.equal(await first.page.locator("#b-cancel").isVisible(), true);
    assert.equal(await first.page.locator("#b-cancel").innerText(), "X");
    // X closes the bar and the words are as they were.
    await first.page.locator("#b-cancel").click();
    await waitFor(async () => !(await editState(first.page)).copying, "X did not close the Copy script bar", 3000);
    assert.equal(await first.page.locator("#b-script-copy").isVisible(), false);
    assert.deepEqual(first.log.marks, []);
    assert.deepEqual(first.log.errors, []);
    await first.page.close();

    // Rolling: a double tap stops the words first, then shows the same bar.
    const rolling = await openPage(world);
    await rolling.page.locator("#play").click();
    await waitFor(async () => (await state(rolling.page)).playing, "Play did not roll the words", 3000);
    await rolling.page.mouse.dblclick(X, Y);
    await waitFor(async () => (await editState(rolling.page)).copying, "a double tap while rolling did not show the Copy script bar", 3000);
    await rolling.page.waitForTimeout(400);
    assert.equal((await state(rolling.page)).playing, false, "a double tap while rolling stops the words");
    const again = await editState(rolling.page);
    assert.equal(again.wording, false);
    assert.equal(again.editable, false);
    assert.equal(again.boxes, 0);
    assert.equal(again.activeIsField, false);
    assert.deepEqual(rolling.log.errors, []);
    await rolling.page.close();
  });

  await t.test("holding a line changes nothing: no edit box, no keyboard, no Copy bar, and the words stay where they are", async () => {
    const { page, log } = await openPage(world);
    await drag(page, 520, 440);
    const before = await state(page);
    assert.equal(before.playing, false);
    const NOTHING = { copying: false, wording: false, editing: false, editable: false, boxes: 0, saveShown: false, activeIsField: false };
    await page.mouse.move(X, Y);
    await page.mouse.down();
    await page.waitForTimeout(900); // longer than the page's own 550 ms hold
    // While the finger is still down: nothing opened under it (the page cleans up on release, so look now).
    assert.deepEqual(await editState(page), NOTHING, "nothing opens while the line is held");
    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await state(page);
    assert.equal(after.playing, false, "a hold does not play the words");
    assert.equal(after.t, before.t, "a hold does not move the words");
    assert.equal(after.editing, false);
    assert.deepEqual(await editState(page), NOTHING);
    assert.deepEqual(log.marks, []);
    assert.deepEqual(log.posts, [], "a hold sends nothing to the server");
    assert.deepEqual(log.errors, []);
    await page.close();
  });
});
