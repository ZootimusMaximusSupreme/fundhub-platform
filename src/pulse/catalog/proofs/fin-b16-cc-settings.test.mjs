// Batch 16 practice tests: the Settings tab of the Marketing Command Center (the gear)
// (public/app/marketing-cc-settings.js inside marketing-command-center.html#settings), in a real Chromium with
// fake /api answers. No live data, nothing saved on the server.
//
// This is the SCREEN half of the two live checks "quiet hours" and "schedule fields" (the live checks read what
// was saved: fin-b16-display-contracts.mjs). A saved result can only be right if the page sent each typed box
// under its own name, so this file types a different value into every box and reads the exact patch the page
// sends: the drop day, the drop time, scripts a day, days in a batch, how to count, each of the six script kinds,
// the drafts expiry, and the quiet hours start and end.

import { test } from "node:test";
import assert from "node:assert/strict";

import { exampleResponse } from "../../../marketing/api-contract.mjs";
import { bodyOf, json, proofRows, sharedScreens, OWNER, waitFor } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const plain = (v) => JSON.parse(JSON.stringify(v));

const PAGE = "/app/marketing-command-center.html#settings";
// 15:04:05 UTC is 8:04 AM in Arizona.
const NOW = "2026-10-12T15:04:05Z";
const SETTINGS = plain(exampleResponse("GET marketing/settings").settings);
const FUNNELS = plain(exampleResponse("GET marketing/funnels"));
const HEALTH = plain(exampleResponse("GET marketing/health"));

const QUIET_ROW = /^Settings: quiet hours: start and end time inputs/;
const SCHEDULE_ROW = /^Settings: schedule fields: drop day, drop time/;

async function openSettings() {
  const posts = [];
  const handlers = {
    "/api/marketing/settings": async (route, { method }) => {
      if (method === "POST") {
        const sent = bodyOf(route);
        posts.push(sent);
        const saved = { ...SETTINGS, ...sent.patch, updated_at: "2026-10-12T15:05:00.000Z" };
        if (sent.patch && sent.patch.format_style) saved.format_style = { ...SETTINGS.format_style, ...sent.patch.format_style };
        return json(route, { settings: saved });
      }
      return json(route, { settings: SETTINGS });
    },
    "/api/marketing/funnels": async (route) => json(route, FUNNELS),
    "/api/marketing/health": async (route) => json(route, HEALTH),
  };
  const before = async (page) => { await page.clock.install({ time: new Date(NOW) }); };
  const opened = await screens.open(PAGE, { session: OWNER, handlers, before, viewport: { width: 1280, height: 1000 } });
  await opened.page.waitForSelector("#set-quiet-start");
  return { ...opened, posts };
}

const save = (page) => page.locator("#setSave");
const live = (page, name) => page.locator(`[data-live="${name}"]`);
const FLIP = { bullets: "words", words: "bullets" };

test("every typed box is sent under its own name: drop day, drop time, counts, how to count, six styles, expiry, quiet hours", { timeout: 90_000 }, async () => {
  {
    const { page, posts, errors } = await openSettings();
    // The boxes start as the saved values, and Save is off until something changes.
    assert.equal(await page.locator("#set-day").inputValue(), "1");
    assert.equal(await page.locator("#set-time").inputValue(), "07:00");
    assert.equal(await page.locator("#set-quiet-start").inputValue(), "21:00");
    assert.equal(await page.locator("#set-quiet-end").inputValue(), "07:00");
    assert.equal(await save(page).isDisabled(), true);
    assert.equal((await live(page, "quiet").innerText()).trim(), "No buzzes from 9:00 PM to 7:00 AM, Arizona time. They wait until 7:00 AM.");

    // A different value in every box, so a box saved under another box's name shows up as the wrong patch.
    await page.locator("#set-day").selectOption("3");
    await page.locator("#set-time").fill("06:30");
    await page.locator("#set-per-day").fill("4");
    await page.locator("#set-days").fill("5");
    await page.locator('input[name="set-size-rule"][value="per_funnel"]').check();
    const styles = {};
    for (const kind of Object.keys(SETTINGS.format_style)) {
      styles[kind] = FLIP[SETTINGS.format_style[kind]];
      await page.locator(`#set-style-${kind}`).selectOption(styles[kind]);
    }
    await page.locator("#set-expiry").fill("21");
    await page.locator("#set-quiet-start").fill("22:30");
    await page.locator("#set-quiet-end").fill("06:15");
    assert.equal((await live(page, "quiet").innerText()).trim(), "No buzzes from 10:30 PM to 6:15 AM, Arizona time. They wait until 6:15 AM.");
    assert.equal(await save(page).isEnabled(), true);
    await save(page).click();
    await waitFor(() => posts.length === 1);
    assert.deepEqual(posts[0].patch, {
      batch_weekday: 3, batch_time: "06:30", scripts_per_day: 4, days_per_batch: 5, size_rule: "per_funnel",
      format_style: styles, draft_expiry_days: 21, quiet_start: "22:30", quiet_end: "06:15",
    }, "each box went into its own field, the numbers as numbers");
    assert.equal(posts[0].updated_at, SETTINGS.updated_at, "it names the version it read");
    assert.equal("enabled" in posts[0].patch, false, "Save never touches the weekly switch");
    await page.waitForFunction(() => /^Saved /.test(document.querySelector("#setSay")?.textContent || ""));
    // The boxes keep what was saved.
    assert.equal(await page.locator("#set-quiet-start").inputValue(), "22:30");
    assert.equal(await page.locator("#set-quiet-end").inputValue(), "06:15");
    assert.equal(await page.locator("#set-day").inputValue(), "3");
    assert.deepEqual(errors, []);
    await page.close();

    // The same save, read one row at a time.
    const patch = posts[0].patch;
    await proof.check(QUIET_ROW, async () => {
      assert.equal(patch.quiet_start, "22:30", "the start box went into quiet_start");
      assert.equal(patch.quiet_end, "06:15", "the end box went into quiet_end");
    });
    await proof.check(SCHEDULE_ROW, async () => {
      assert.equal(patch.batch_weekday, 3);
      assert.equal(patch.batch_time, "06:30");
      assert.equal(patch.scripts_per_day, 4);
      assert.equal(patch.days_per_batch, 5);
      assert.equal(patch.size_rule, "per_funnel");
      assert.equal(patch.draft_expiry_days, 21);
      assert.deepEqual(Object.keys(patch.format_style).sort(), Object.keys(SETTINGS.format_style).sort());
    });
  }
});

test("quiet hours: the start box alone sends quiet_start, the end box alone sends quiet_end, and nothing else rides along", { timeout: 90_000 }, async () => {
  await proof.check(QUIET_ROW, async () => {
    const start = await openSettings();
    await start.page.locator("#set-quiet-start").fill("20:00");
    assert.equal((await live(start.page, "quiet").innerText()).trim(), "No buzzes from 8:00 PM to 7:00 AM, Arizona time. They wait until 7:00 AM.");
    await save(start.page).click();
    await waitFor(() => start.posts.length === 1);
    assert.deepEqual(start.posts[0].patch, { quiet_start: "20:00" });
    assert.equal(await start.page.locator("#set-quiet-end").inputValue(), "07:00", "the end box was not changed by the start box");
    await start.page.close();

    const end = await openSettings();
    await end.page.locator("#set-quiet-end").fill("08:30");
    assert.equal((await live(end.page, "quiet").innerText()).trim(), "No buzzes from 9:00 PM to 8:30 AM, Arizona time. They wait until 8:30 AM.");
    await save(end.page).click();
    await waitFor(() => end.posts.length === 1);
    assert.deepEqual(end.posts[0].patch, { quiet_end: "08:30" });
    assert.equal(await end.page.locator("#set-quiet-start").inputValue(), "21:00", "the start box was not changed by the end box");
    await end.page.close();

    // A box left empty is not a time: it is named in words and nothing is sent.
    const bad = await openSettings();
    await bad.page.locator("#set-quiet-end").fill("");
    await save(bad.page).click();
    await bad.page.waitForFunction(() => /^Did not save\./.test(document.querySelector("#setSay")?.textContent || ""));
    assert.match(await bad.page.locator("#setSay").innerText(), /Quiet hours end must be a time/);
    assert.equal(bad.posts.length, 0);
    await bad.page.close();
  });
});

test("schedule: the drop day is sent when it is the only change, as a number, and the drop line names it", { timeout: 90_000 }, async () => {
  await proof.check(SCHEDULE_ROW, async () => {
    const day = await openSettings();
    await day.page.locator("#set-day").selectOption("3");
    assert.equal((await live(day.page, "schedule").innerText()).trim(), "Every Wednesday at 7:00 AM Arizona time: 21 scripts.");
    await save(day.page).click();
    await waitFor(() => day.posts.length === 1);
    assert.deepEqual(day.posts[0].patch, { batch_weekday: 3 });
    await day.page.waitForFunction(() => /^Saved /.test(document.querySelector("#setSay")?.textContent || ""));
    assert.equal(await save(day.page).isDisabled(), true, "saved, so nothing is waiting");
    await day.page.close();

    // Sunday is 0: a falsy day is still a change that is sent.
    const sunday = await openSettings();
    await sunday.page.locator("#set-day").selectOption("0");
    await save(sunday.page).click();
    await waitFor(() => sunday.posts.length === 1);
    assert.deepEqual(sunday.posts[0].patch, { batch_weekday: 0 });
    await sunday.page.close();

    // The count rule and each style one at a time, so none is carried by another's change.
    const rule = await openSettings();
    await rule.page.locator('input[name="set-size-rule"][value="per_funnel"]').check();
    await save(rule.page).click();
    await waitFor(() => rule.posts.length === 1);
    assert.deepEqual(rule.posts[0].patch, { size_rule: "per_funnel" });
    await rule.page.close();

    for (const kind of Object.keys(SETTINGS.format_style)) {
      const one = await openSettings();
      await one.page.locator(`#set-style-${kind}`).selectOption(FLIP[SETTINGS.format_style[kind]]);
      await save(one.page).click();
      await waitFor(() => one.posts.length === 1);
      assert.deepEqual(one.posts[0].patch, { format_style: { [kind]: FLIP[SETTINGS.format_style[kind]] } }, `${kind} goes under its own kind`);
      await one.page.close();
    }

    const counts = await openSettings();
    await counts.page.locator("#set-per-day").fill("5");
    await save(counts.page).click();
    await waitFor(() => counts.posts.length === 1);
    assert.deepEqual(counts.posts[0].patch, { scripts_per_day: 5 });
    await counts.page.close();

    const days = await openSettings();
    await days.page.locator("#set-days").fill("10");
    await save(days.page).click();
    await waitFor(() => days.posts.length === 1);
    assert.deepEqual(days.posts[0].patch, { days_per_batch: 10 });
    await days.page.close();

    const expiry = await openSettings();
    await expiry.page.locator("#set-expiry").fill("30");
    await save(expiry.page).click();
    await waitFor(() => expiry.posts.length === 1);
    assert.deepEqual(expiry.posts[0].patch, { draft_expiry_days: 30 });
    await expiry.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
