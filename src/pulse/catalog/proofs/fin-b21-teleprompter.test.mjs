// Batch 21 practice tests for the Teleprompter (teleprompter.html). Real Chromium, the real page and its
// scripts, fake /api answers built from the API contract's own example. Nothing is read from a live
// server and nothing is sent anywhere. These are practice tests, not live checks.
//
// Rows proved here (see fin-b21-display-practice.mjs):
//   Empty and error states; Play / Pause and the 3-2-1 countdown; the tiny file-name chip; the top edge
//   of the phone; the 'Shoot finished' card; keyboard and remote keys; and the closed film link.

import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT } from "../../../marketing/api-contract.mjs";
import { FILM_LINK_CLOSED } from "../../../marketing/shoot-film-key.mjs";
import { blockOutside, clone, json, openWorld, waitFor } from "./fin-b21-browser-kit.mjs";

const PAGE = clone(CONTRACT["GET marketing/shoot"].example.response);
const [ONE, TWO] = PAGE.shoot.scripts;
const THREE = {
  ...ONE, id: "00000000-0000-4000-8000-000000000301", root_script_id: "00000000-0000-4000-8000-000000000301",
  ad_id: "93", title: "Your file is worth more", angle_name: "Your file is worth more", takes: 0, got_it: false,
  take_no: 1, take_file_name: "SLO Ad 93 — Your file is worth more Take 1.mp4", last_take_file_name: null, style: "words"
};
// ONE is already marked Got it. The page opens on THREE, then TWO is the one still to film after it.
const SHOOT = { ...PAGE, shoot: { ...PAGE.shoot, root_script_ids: [ONE.root_script_id, THREE.root_script_id, TWO.root_script_id], scripts: [ONE, THREE, TWO] } };
const LAST_ONE = { ...SHOOT, shoot: { ...SHOOT.shoot, root_script_ids: [ONE.root_script_id, THREE.root_script_id], scripts: [ONE, THREE] } };
const DRIVE = "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";
const SHOOT_TAB = "/app/marketing-command-center.html#shoot";

const state = (page) => page.evaluate(() => window.__fhtp.state());
const playing = async (page) => (await state(page)).playing;

/** Open the teleprompter with fake answers. `shootAnswer` may be a function (called per read). */
async function openPage(world, {
  shootAnswer = SHOOT, query = "", token = true, settings = { countdown: false }, keys = null, viewport = { width: 390, height: 844 },
  markStatus = 200, init = null, frozenClock = false
} = {}) {
  const page = await world.browser.newPage({ viewport });
  // A frozen clock keeps the page's own 5 second re-read from healing a dead button: only a press can.
  if (frozenClock) {
    await page.clock.install();
    await page.clock.pauseAt(Date.now() + 1000);
  }
  await blockOutside(page, world.origin);
  const log = { reads: [], marks: [], keys: [], errors: [], urls: [] };
  page.on("pageerror", (e) => log.errors.push(String(e)));
  page.on("framenavigated", (frame) => { if (frame === page.mainFrame()) log.urls.push(frame.url()); });
  await page.addInitScript(({ withToken, withSettings, withKeys }) => {
    if (withToken) localStorage.setItem("fh_token", "practice-token");
    if (withSettings) localStorage.setItem("fhtp.settings", JSON.stringify(withSettings));
    if (withKeys) localStorage.setItem("fhtp.keys", JSON.stringify(withKeys));
  }, { withToken: token, withSettings: settings, withKeys: keys });
  if (init) await page.addInitScript(init);
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const name = url.pathname.replace(/^\/api\//, "");
    if (request.method() === "GET" && name === "marketing/shoot") {
      log.reads.push({ filmKey: request.headers()["x-shoot-film"] || "", search: url.search });
      const out = typeof shootAnswer === "function" ? shootAnswer(log.reads.length) : shootAnswer;
      return json(route, out.body ?? out, out.status || 200);
    }
    if (request.method() === "GET" && name === "marketing/health") {
      return json(route, { ok: true, outbox: { held_reason: null, token_present: true } });
    }
    if (request.method() === "POST" && name === "marketing/shoot/mark") {
      log.marks.push(JSON.parse(request.postData() || "{}"));
      return json(route, { marks: {} }, markStatus);
    }
    return json(route, { error: "not_found", path: name }, 404);
  });
  await page.goto(`${world.origin}/app/teleprompter.html${query}`);
  return { page, log };
}

test("the teleprompter practice tests run in a real browser", { timeout: 240_000 }, async (t) => {
  const world = await openWorld();
  t.after(() => world.close());

  await t.test("empty and error states: no shoot says so and links to the Shoot tab", async () => {
    const { page, log } = await openPage(world, { shootAnswer: { ...PAGE, shoot: null } });
    await page.locator("#empty").waitFor({ state: "visible" });
    assert.equal(await page.locator("#empty-msg").innerText(), "No shoot is planned. Pick the scripts on the Shoot tab and save the plan.");
    const plan = page.getByRole("link", { name: "Plan it on the Shoot tab" });
    assert.equal(await plan.isVisible(), true);
    assert.equal(await plan.getAttribute("href"), SHOOT_TAB);
    assert.equal(await page.locator("#empty-retry").isHidden(), true, "no Try again when the answer was a real 'no shoot'");
    assert.deepEqual(log.errors, []);
    await page.close();
  });

  await t.test("empty and error states: a read that fails says so, and Try again reads the shoot again", async () => {
    let failing = true;
    const { page, log } = await openPage(world, { frozenClock: true, shootAnswer: () => (failing ? { status: 500, body: { error: "boom" } } : SHOOT) });
    await page.locator("#empty").waitFor({ state: "visible" });
    assert.equal(await page.locator("#empty-msg").innerText(), "The shoot did not load. Try again in a minute.");
    assert.equal(await page.locator("#empty-retry").isVisible(), true);
    assert.equal(await page.locator("#empty-retry").innerText(), "Try again");
    assert.equal(await page.locator("#empty-plan").isVisible(), true);
    const before = log.reads.length;
    failing = false;
    await page.locator("#empty-retry").click();
    await waitFor(() => log.reads.length > before, "Try again did not read the shoot again");
    assert.equal(log.reads.length, before + 1, "one press, one read");
    await page.locator("#empty").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#s-title").innerText(), "Your file is worth more");
    assert.match(await page.locator("#content").innerText(), /MOST lenders read TWO files/);
    await page.close();
  });

  await t.test("empty and error states: a phone with no connection and nothing saved says that, and offers Try again", async () => {
    const down = await world.browser.newPage({ viewport: { width: 390, height: 844 } });
    await blockOutside(down, world.origin);
    await down.addInitScript(() => localStorage.setItem("fh_token", "practice-token"));
    await down.route("**/api/**", (route) => route.abort("internetdisconnected"));
    await down.goto(`${world.origin}/app/teleprompter.html`);
    await down.locator("#empty").waitFor({ state: "visible" });
    assert.equal(await down.locator("#empty-msg").innerText(), "No connection, and no shoot is saved on this phone yet.");
    assert.equal(await down.locator("#empty-retry").isVisible(), true);
    await down.close();
  });

  await t.test("a film link the server closed says so in words, with no sign-in wall and no way to plan", async () => {
    const { page, log } = await openPage(world, {
      query: "?k=forged-film-key", token: false,
      shootAnswer: { status: 404, body: { error: "not_found", message: FILM_LINK_CLOSED } }
    });
    await page.locator("#empty").waitFor({ state: "visible" });
    assert.equal(await page.locator("#empty-msg").innerText(), FILM_LINK_CLOSED);
    assert.equal(await page.locator("#empty-plan").isHidden(), true, "a film link has no Shoot tab behind it");
    assert.equal(await page.locator("#empty-retry").isHidden(), true);
    assert.ok(log.reads.length >= 1);
    assert.equal(log.reads[0].filmKey, "forged-film-key", "the key goes on the read as the x-shoot-film header");
    assert.ok(log.urls.every((u) => !/login/i.test(u)), `no sign-in page was opened: ${log.urls.join(", ")}`);
    assert.equal(await page.getByText(/sign in/i).count(), 0);
    await page.close();
  });

  await t.test("Play becomes Pause, the 3-2-1 counts down before the words roll, and Pause stops them", async () => {
    const { page, log } = await openPage(world, { settings: {} });
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#play").innerText(), "Play");
    assert.equal(await page.locator("#play").getAttribute("aria-pressed"), "false");
    await page.evaluate(() => {
      window.__counts = [];
      const el = document.getElementById("count");
      new MutationObserver(() => { if (!el.hidden) window.__counts.push(el.textContent); }).observe(el, { childList: true, characterData: true, subtree: true, attributes: true });
    });
    await page.locator("#play").click();
    await page.locator("#count").waitFor({ state: "visible" });
    assert.equal(await page.locator("#play").innerText(), "Pause", "the button already says Pause while it counts");
    assert.equal((await state(page)).playing, false, "the words have not started during the count");
    await waitFor(() => playing(page), "the words never started rolling after the count", 6000);
    const counts = await page.evaluate(() => window.__counts.filter((v, i, a) => i === 0 || v !== a[i - 1]));
    assert.deepEqual(counts, ["3", "2", "1"]);
    assert.equal(await page.locator("#count").isHidden(), true);
    assert.equal(await page.locator("#play").innerText(), "Pause");
    assert.equal(await page.locator("#play").getAttribute("aria-pressed"), "true");
    await page.locator("#play").click();
    assert.equal((await state(page)).playing, false);
    assert.equal(await page.locator("#play").innerText(), "Play");
    // The second Play on the same script does not count again: the words roll at once.
    await page.evaluate(() => { window.__counts = []; });
    await page.locator("#play").click();
    await waitFor(() => playing(page), "the second Play did not roll at once", 1500);
    assert.deepEqual(await page.evaluate(() => window.__counts), []);
    // Nor does starting the take over (Page Up): the count is for the first play of a script only.
    await page.locator("#play").click();
    await waitFor(async () => !(await playing(page)), "Pause did not stop the words", 1500);
    await page.evaluate(() => { window.__counts = []; });
    await page.keyboard.press("PageUp");
    await waitFor(() => playing(page), "starting the take over did not roll at once", 1500);
    assert.deepEqual(await page.evaluate(() => window.__counts), [], "no second count");
    assert.equal(await page.locator("#count").isHidden(), true);
    assert.equal(log.marks.length, 0, "playing and pausing sends no mark");
    await page.close();
  });

  await t.test("Pause pressed during the count cancels it, and the words never start", async () => {
    const { page } = await openPage(world, { settings: {} });
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    await page.locator("#play").click();
    await page.locator("#count").waitFor({ state: "visible" });
    await page.locator("#play").click();
    assert.equal(await page.locator("#count").isHidden(), true);
    assert.equal(await page.locator("#play").innerText(), "Play");
    await page.waitForTimeout(3200);
    assert.equal((await state(page)).playing, false, "the cancelled count never starts the words");
    await page.close();
  });

  await t.test("the tiny file-name chip: one tap does nothing, two taps open Still to film, a tap loads that script", async () => {
    const { page, log } = await openPage(world, { viewport: { width: 1024, height: 768 } });
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    const chip = page.locator("#p-file");
    assert.equal(await chip.innerText(), "SLO Ad 93 — Your file is worth more Take 1.mp4");
    await chip.click();
    await page.waitForTimeout(450);
    assert.equal(await page.locator("#qmenu").isHidden(), true, "one tap does not open the list");
    await chip.dblclick();
    await page.locator("#qmenu").waitFor({ state: "visible" });
    const list = await page.locator("#qmenu").innerText();
    assert.match(list, /Your file is worth more/);
    assert.match(list, /Inquiries off first/);
    assert.doesNotMatch(list, /Lenders read two files/, "a script already marked Got it is not still to film");
    await page.locator("#qmenu").getByRole("button", { name: /Inquiries off first/ }).click();
    await page.locator("#qmenu").waitFor({ state: "hidden" });
    assert.equal(await page.locator("#s-title").innerText(), "Inquiries off first");
    assert.equal(await chip.innerText(), "Inquiries off first");
    assert.match(await page.locator("#content").innerText(), /Every hard pull/);
    assert.equal(log.marks.length, 0, "swapping scripts marks nothing");
    await page.close();
  });

  await t.test("the top edge: a tap then a scroll swaps to the next or previous script still to film, and two taps mark it Got it", async () => {
    const { page, log } = await openPage(world);
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#s-title").innerText(), "Your file is worth more");
    const drag = async (fromY, toY) => {
      await page.mouse.move(200, fromY);
      await page.mouse.down();
      for (let i = 1; i <= 6; i += 1) await page.mouse.move(200, fromY + ((toY - fromY) * i) / 6);
      await page.mouse.up();
    };
    // A tap on the top edge arms it and says what to do next.
    await page.mouse.click(200, 10);
    await page.locator("#toast").waitFor({ state: "visible" });
    assert.equal(await page.locator("#toast").innerText(), "Scroll up or down to change script.");
    // Scroll up: the next script still to film.
    await drag(400, 330);
    await waitFor(async () => (await page.locator("#s-title").innerText()) === "Inquiries off first", "scroll up did not load the next script");
    assert.equal(log.marks.length, 0, "a swap marks nothing");
    // Arm again, scroll down: the previous one.
    await page.waitForTimeout(500);
    await page.mouse.click(200, 10);
    await drag(300, 380);
    await waitFor(async () => (await page.locator("#s-title").innerText()) === "Your file is worth more", "scroll down did not load the previous script");
    assert.equal(log.marks.length, 0);
    // Two quick taps on the top edge ask first, and a no marks nothing.
    await page.waitForTimeout(1500);
    let asked = "";
    page.once("dialog", async (dialog) => { asked = dialog.message(); await dialog.dismiss(); });
    await page.mouse.dblclick(200, 10);
    await waitFor(() => asked !== "", "the two taps did not ask first");
    assert.match(asked, /Mark ".*Your file is worth more" as complete\?/);
    await page.waitForTimeout(300);
    assert.equal(log.marks.length, 0, "a no marks nothing");
    // A yes marks that script Got it, and the next one still to film loads.
    await page.waitForTimeout(1500);
    page.once("dialog", async (dialog) => { await dialog.accept(); });
    await page.mouse.dblclick(200, 10);
    await waitFor(() => log.marks.length === 1, "the yes did not mark the script");
    assert.equal(log.marks[0].mark, "got_it");
    assert.equal(log.marks[0].root_script_id, THREE.root_script_id);
    assert.equal(log.marks[0].shoot_id, SHOOT.shoot.id);
    await waitFor(async () => (await page.locator("#s-title").innerText()) === "Inquiries off first", "the next script did not load after Complete");
    await page.close();
  });

  await t.test("the Shoot finished card: Open SLO Ads and Back to the Shoot tab show once the last script is Got it", async () => {
    const { page, log } = await openPage(world, { shootAnswer: LAST_ONE });
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    assert.equal(await page.locator("#done").isHidden(), true);
    await page.evaluate(() => window.__fhtp.finish());
    await page.locator("#end").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Got it" }).click();
    await page.locator("#done").waitFor({ state: "visible" });
    assert.equal(await page.locator("#done h2").innerText(), "Every script is marked Got it.");
    const drive = page.getByRole("link", { name: "Open SLO Ads" });
    assert.equal(await drive.getAttribute("href"), DRIVE);
    assert.equal(await drive.getAttribute("target"), "_blank");
    const back = page.getByRole("link", { name: "Back to the Shoot tab" });
    assert.equal(await back.getAttribute("href"), SHOOT_TAB);
    assert.equal(log.marks.length, 1);
    assert.equal(log.marks[0].mark, "got_it");
    assert.equal(log.marks[0].root_script_id, THREE.root_script_id);
    await page.close();
  });

  await t.test("keys: Space, Enter and Page Down play and pause; the arrows change the speed; Page Up starts the take over", async () => {
    const { page } = await openPage(world);
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    for (const key of [" ", "Enter", "PageDown"]) {
      await page.keyboard.press(key);
      await waitFor(() => playing(page), `${JSON.stringify(key)} did not play`, 2000);
      await page.keyboard.press(key);
      await waitFor(async () => !(await playing(page)), `${JSON.stringify(key)} did not pause`, 2000);
    }
    const wpm = async () => (await state(page)).wpm;
    assert.equal(await wpm(), 150);
    await page.keyboard.press("ArrowUp");
    assert.equal(await wpm(), 155);
    await page.keyboard.press("ArrowRight");
    assert.equal(await wpm(), 160);
    await page.keyboard.press("ArrowDown");
    assert.equal(await wpm(), 155);
    await page.keyboard.press("ArrowLeft");
    assert.equal(await wpm(), 150);
    // Page Up: the take starts over from its first word.
    await page.keyboard.press(" ");
    await waitFor(() => playing(page), "Space did not play", 2000);
    await page.waitForTimeout(900);
    const rolled = (await state(page)).t;
    assert.ok(rolled > 0.4, `the words rolled (${rolled})`);
    await page.keyboard.press("PageUp");
    await page.waitForTimeout(60);
    const again = await state(page);
    assert.ok(again.t < rolled, `Page Up went back to the start (${again.t} < ${rolled})`);
    await page.close();
  });

  await t.test("keys: the volume buttons play from a pause and slow the roll by 5", async () => {
    const { page } = await openPage(world);
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    const volume = (key) => page.evaluate((k) => document.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })), key);
    assert.equal((await state(page)).playing, false);
    await volume("VolumeUp");
    await waitFor(() => playing(page), "Volume up did not roll the words", 2000);
    await volume("VolumeDown");
    assert.equal((await state(page)).wpm, 145, "Volume down slows the roll by 5");
    assert.equal((await state(page)).playing, true);
    await page.close();
  });

  await t.test("keys: at the end of a script Space, Enter and Page Down are Got it, and Page Up is Another take", async () => {
    for (const key of [" ", "Enter", "PageDown"]) {
      const { page, log } = await openPage(world);
      await page.locator("#content .w").first().waitFor({ state: "visible" });
      await page.evaluate(() => window.__fhtp.finish());
      await page.locator("#end").waitFor({ state: "visible" });
      await page.keyboard.press(key);
      await waitFor(() => log.marks.length === 1, `${JSON.stringify(key)} at the end did not mark the take`, 3000);
      assert.equal(log.marks[0].mark, "got_it", JSON.stringify(key));
      assert.equal(log.marks[0].root_script_id, THREE.root_script_id);
      assert.match(log.marks[0].request_id, /^[A-Za-z0-9._:-]{8,200}$/);
      await page.close();
    }
    const { page, log } = await openPage(world);
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    await page.evaluate(() => window.__fhtp.finish());
    await page.keyboard.press("PageUp");
    await waitFor(() => log.marks.length === 1, "Page Up at the end did not mark another take", 3000);
    assert.equal(log.marks[0].mark, "another_take");
    await waitFor(async () => (await page.locator("#s-file").innerText()) === "SLO Ad 93 — Your file is worth more Take 2.mp4", "the next file name did not move to take 2");
    await page.close();
  });

  await t.test("keys: a button saved on this phone for Got it or Play is still honoured", async () => {
    const { page, log } = await openPage(world, { keys: { got_it: ["key:b"], play: ["key:x"] } });
    await page.locator("#content .w").first().waitFor({ state: "visible" });
    await page.keyboard.press("x");
    await waitFor(() => playing(page), "the saved Play button did not play", 2000);
    await page.keyboard.press("x");
    await waitFor(async () => !(await playing(page)), "the saved Play button did not pause", 2000);
    await page.evaluate(() => window.__fhtp.finish());
    await page.locator("#end").waitFor({ state: "visible" });
    await page.keyboard.press("b");
    await waitFor(() => log.marks.length === 1, "the saved Got it button did not mark the take", 3000);
    assert.equal(log.marks[0].mark, "got_it");
    await page.close();
  });
});
