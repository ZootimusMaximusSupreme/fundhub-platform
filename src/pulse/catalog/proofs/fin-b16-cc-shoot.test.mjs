// Batch 16 practice tests: the Shoot tab of the Marketing Command Center
// (public/app/cc-tab-shoot.js inside marketing-command-center.html#shoot), in a real Chromium with fake
// /api answers. No live data, nothing saved on the server.
//
//   the teleprompter link and the Drive folder link   the film key rides on the link; a foreign address is ignored
//   the "Before you roll" checklist                   four boxes saved in this browser only, one set per shoot
//   the plan rows and Save the plan (the screen half of the two live checks of the same names)
//                                                     the exact order the page sends, and what each row button does

import { test } from "node:test";
import assert from "node:assert/strict";

import { exampleResponse } from "../../../marketing/api-contract.mjs";
import { bodyOf, json, proofRows, sharedScreens, OWNER, waitFor } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const plain = (v) => JSON.parse(JSON.stringify(v));

const BASE = plain(exampleResponse("GET marketing/shoot"));
const [ONE, TWO] = BASE.shoot.scripts;
const NOW = "2026-10-13T16:06:00Z";
const HEX = "a".repeat(64);
const KEY = `11111111-1111-4111-8111-111111111111.${BASE.shoot.id}.1792000000.${HEX}`;
const FILM = `/app/teleprompter.html?k=${KEY}`;
const DRIVE = "https://drive.google.com/drive/folders/13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ";

const C3 = {
  ...ONE, id: "00000000-0000-4000-8000-000000000301", root_script_id: "00000000-0000-4000-8000-000000000301",
  ad_id: "93", title: "Your file is worth more", angle_name: "Your file is worth more", takes: 0, got_it: false,
  take_no: 2, take_file_name: "SLO Ad 93 — Your file is worth more Take 2.mp4", last_take_file_name: null, needs_retake: true,
};
const C1 = { ...ONE, takes: 0, got_it: false, take_no: 1, take_file_name: "SLO Ad 91 — Lenders read two files Take 1.mp4", last_take_file_name: null };
const C2 = { ...TWO, got_it: false, takes: 0 };
const NO_SHOOT = { shoot: null, plan_candidates: [C3, C1, C2], plan_estimated_minutes: 8, past_shoots: [], wpm: 150, as_of: "2026-10-13T16:06:00.000Z" };

/** One open shoot (two scripts, neither marked) and one more approved script waiting to be added. */
function openShoot(over = {}) {
  const scripts = [{ ...ONE, got_it: false, takes: 0 }, { ...TWO, got_it: false, takes: 0 }];
  return {
    ...BASE,
    shoot: { ...BASE.shoot, marks: {}, scripts, root_script_ids: scripts.map((s) => s.root_script_id), board: [] },
    plan_candidates: [C3],
    ...over,
  };
}

async function openShootTab({ get, init = null } = {}) {
  const log = { reads: 0, posts: [] };
  const handlers = {
    // The longer address first: a handler is picked by "the address contains this".
    "/api/marketing/shoot/mark": async (route) => { log.posts.push({ mark: bodyOf(route) }); return json(route, { marks: {} }); },
    "/api/marketing/shoot": async (route, { method }) => {
      const page = typeof get === "function" ? get() : get;
      if (method === "POST") {
        log.posts.push(bodyOf(route));
        return json(route, { shoot: page.shoot || BASE.shoot });
      }
      log.reads += 1;
      return json(route, page);
    },
  };
  const before = async (page) => { await page.clock.install({ time: new Date(NOW) }); };
  const opened = await screens.open("/app/marketing-command-center.html#shoot", { session: OWNER, handlers, before, init });
  await opened.page.waitForSelector(".cc-shoot, [aria-label='Shoot summary']");
  return { ...opened, log };
}

const rows = (page) => page.locator("ol[aria-label='Film order'] > li");
const order = async (page) => rows(page).evaluateAll((els) => els.map((e) => e.getAttribute("data-root")));

test("the teleprompter link carries the film key from the shoot; the Drive folder link opens the one SLO Ads folder", { timeout: 90_000 }, async () => {
  await proof.check(/^Shoot: 'Open the teleprompter' link/, async () => {
    const keyed = { ...openShoot(), film: { path: FILM, expires_at: "2026-10-14T16:00:00.000Z" } };
    const { page, errors } = await openShootTab({ get: keyed });
    const open = page.getByRole("link", { name: "Open the teleprompter" });
    assert.equal(await open.getAttribute("href"), FILM, "the key from the shoot rides on the link");
    assert.match(await open.getAttribute("class"), /primary/);
    // Each row's Roll it adds that script to the same keyed link.
    const roll = rows(page).first().getByRole("link", { name: "Roll it" });
    assert.equal(await roll.getAttribute("href"), `${FILM}&script=${ONE.root_script_id}`);
    // The key is kept on this device, tied to this shoot, so the teleprompter can save edits after the session ends.
    const stored = JSON.parse(await page.evaluate(() => localStorage.getItem("fhtp.filmAccess")));
    assert.deepEqual(stored, { shootId: BASE.shoot.id, key: KEY });
    // The Drive link goes to the one filmed-ads folder, in its own tab, and cannot reach back into this one.
    const drive = page.getByRole("link", { name: "Open SLO Ads in Drive" });
    assert.equal(await drive.getAttribute("href"), DRIVE);
    assert.equal(await drive.getAttribute("target"), "_blank");
    assert.match(await drive.getAttribute("rel"), /noopener/);
    assert.deepEqual(errors, []);
    await page.close();

    // A key that belongs to some other shoot is not remembered, and an address that is not the teleprompter is ignored.
    const other = { ...openShoot(), film: { path: `/app/teleprompter.html?k=11111111-1111-4111-8111-111111111111.99999999-9999-4999-8999-999999999999.1792000000.${HEX}`, expires_at: "2026-10-14T16:00:00.000Z" } };
    const wrong = await openShootTab({ get: other });
    assert.equal(await wrong.page.evaluate(() => localStorage.getItem("fhtp.filmAccess")), null, "a key for another shoot is not saved as this shoot's");
    await wrong.page.close();
    const foreign = await openShootTab({ get: { ...openShoot(), film: { path: "https://elsewhere.example/steal?k=1", expires_at: "2026-10-14T16:00:00.000Z" } } });
    assert.equal(await foreign.page.getByRole("link", { name: "Open the teleprompter" }).getAttribute("href"), "/app/teleprompter.html",
      "the button cannot leave the site");
    await foreign.page.close();
  });
});

test("the Before you roll checklist keeps four boxes on this device, one set per shoot, and writes nothing to the server", { timeout: 90_000 }, async () => {
  await proof.check(/^Shoot: checklist: Rig set, Mirror on/, async () => {
    const first = await openShootTab({ get: openShoot() });
    const group = first.page.getByRole("group", { name: "Before you roll" });
    const labels = (await group.locator("label").allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(labels, ["Rig set", "Mirror on", "Remote paired", "Phone charged, with storage free"]);
    assert.match(await first.page.locator("section.card:has([aria-label='Before you roll'])").innerText(), /Saved on this device\./);
    const boxes = group.locator("input[type=checkbox]");
    assert.equal(await boxes.count(), 4);
    for (let i = 0; i < 4; i += 1) assert.equal(await boxes.nth(i).isChecked(), false);
    await boxes.nth(0).check();
    await boxes.nth(2).check();
    const key = `fhcc.shoot.check.${BASE.shoot.id}`;
    assert.deepEqual(JSON.parse(await first.page.evaluate((k) => localStorage.getItem(k), key)), { rig: true, remote: true });
    assert.deepEqual(first.log.posts, [], "ticking a box is not a request");

    // Reloaded in the same browser, the same boxes are ticked; unticking one is saved too.
    await first.page.reload();
    await first.page.waitForSelector("[aria-label='Before you roll']");
    const again = first.page.getByRole("group", { name: "Before you roll" }).locator("input[type=checkbox]");
    assert.deepEqual(await again.evaluateAll((els) => els.map((e) => e.checked)), [true, false, true, false]);
    await again.nth(0).uncheck();
    await again.nth(3).check();
    assert.deepEqual(JSON.parse(await first.page.evaluate((k) => localStorage.getItem(k), key)), { rig: false, remote: true, phone: true });
    // Another shoot starts with its own empty list.
    const other = { ...openShoot() };
    other.shoot = { ...other.shoot, id: "00000000-0000-4000-8000-000000000999" };
    await first.page.close();
    const second = await openShootTab({ get: other });
    const fresh = second.page.getByRole("group", { name: "Before you roll" }).locator("input[type=checkbox]");
    assert.deepEqual(await fresh.evaluateAll((els) => els.map((e) => e.checked)), [false, false, false, false]);
    await second.page.close();
  });
});

test("before a shoot, Film first and the arrows set the order that Save the plan sends", { timeout: 90_000 }, async () => {
  await proof.check(/^Shoot: 'Save the plan'/, async () => {
    let saved = false;
    const { page, log, errors } = await openShootTab({ get: () => (saved ? openShoot() : NO_SHOOT) });
    await page.waitForSelector("ol[aria-label='Film order']");
    assert.deepEqual(await order(page), [C3.root_script_id, C1.root_script_id, C2.root_script_id]);
    assert.equal(await page.getByRole("button", { name: "Open the teleprompter" }).isDisabled(), true, "no teleprompter before a plan is saved");
    await page.getByRole("button", { name: "Save the plan" }).waitFor();

    // Film first moves the last one to the top; an arrow moves one down; the checkbox takes one off.
    await rows(page).nth(2).getByRole("button", { name: "Film first" }).click();
    assert.deepEqual(await order(page), [C2.root_script_id, C3.root_script_id, C1.root_script_id]);
    await page.getByRole("button", { name: "Move Ad 92 down" }).click();
    assert.deepEqual(await order(page), [C3.root_script_id, C2.root_script_id, C1.root_script_id]);
    await rows(page).nth(0).getByLabel("On the plan").uncheck();
    assert.equal(log.posts.length, 0, "nothing is sent until Save the plan");
    saved = true;
    await page.getByRole("button", { name: "Save the plan" }).click();
    await waitFor(() => log.posts.length === 1);
    assert.deepEqual(log.posts[0].root_script_ids, [C2.root_script_id, C1.root_script_id], "the plan, in the order on screen, without the one unticked");
    assert.match(log.posts[0].request_id, /^[A-Za-z0-9._:-]{8,200}$/, "one tap, one request id");
    assert.equal("id" in log.posts[0], false, "a new plan is a create, not a change to a shoot");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("on an open shoot, the arrows, Film first, Take off the plan and Add to the plan each send the whole new order", { timeout: 90_000 }, async () => {
  await proof.check(/^Shoot: plan row: include checkbox, Up \/ Down/, async () => {
    const { page, log, errors } = await openShootTab({ get: openShoot() });
    await page.waitForSelector("ol[aria-label='Film order']");
    const [a, b] = [ONE.root_script_id, TWO.root_script_id];
    assert.deepEqual(await order(page), [a, b]);
    assert.equal(await rows(page).nth(0).getByRole("button", { name: /Move Ad 91 up/ }).isDisabled(), true, "the first row cannot move up");
    assert.equal(await rows(page).nth(1).getByRole("button", { name: /Move Ad 92 down/ }).isDisabled(), true, "the last row cannot move down");
    assert.equal(await rows(page).nth(0).getByRole("button", { name: "Film first" }).isDisabled(), true, "the first row is already first");

    await rows(page).nth(0).getByRole("button", { name: "Move Ad 91 down" }).click();
    await waitFor(() => log.posts.length === 1);
    assert.deepEqual(log.posts[0], { id: BASE.shoot.id, root_script_ids: [b, a], request_id: log.posts[0].request_id, wpm: 150 },
      "the whole new order, the shoot it changes, and the reading speed this device saved");
    await rows(page).nth(1).getByRole("button", { name: "Film first" }).click();
    await waitFor(() => log.posts.length === 2);
    assert.deepEqual(log.posts[1].root_script_ids, [b, a], "the shown list did not change (the stand-in answers the same shoot), so the order sent is from that list: second to the top");
    await rows(page).nth(1).getByRole("button", { name: "Take off the plan" }).click();
    await waitFor(() => log.posts.length === 3);
    assert.deepEqual(log.posts[2].root_script_ids, [a], "the other script is dropped from the list, the one left stays");
    await page.getByRole("button", { name: "Add to the plan" }).click();
    await waitFor(() => log.posts.length === 4);
    assert.deepEqual(log.posts[3].root_script_ids, [a, b, C3.root_script_id], "an approved script is added to the end");
    for (const post of log.posts) assert.equal(post.id, BASE.shoot.id, "every change names the shoot it changes");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
