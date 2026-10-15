// Practice test (fake data, real page): two behaviours of the teleprompter
// (public/app/teleprompter.html + teleprompter.js + teleprompter-edits.js).
//   1. While paused, every 5 seconds the page re-reads the shoot and sends the
//      marks and script edits that are waiting. Not sooner, not later, not
//      while the words are rolling.
//   2. Full screen is asked for again on the first tap, once, and not again.
// The page clock is paused and moved only by this test, so "every 5 seconds"
// is judged to the millisecond, which the older test did not do (it also passed
// with a 15 second wait).

import { test } from "node:test";
import assert from "node:assert/strict";

import { CONTRACT } from "../../../marketing/api-contract.mjs";
import { json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

function shootFixture() {
  const shoot = clone(CONTRACT["GET marketing/shoot"].example.response);
  const [script] = shoot.shoot.scripts;
  shoot.shoot.scripts = [{ ...script, got_it: false }];
  shoot.shoot.root_script_ids = [script.root_script_id];
  return { shoot, script };
}

test("while paused the page re-reads the shoot and flushes waiting marks and edits every 5 seconds, and only then", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const { shoot, script } = shootFixture();
  const mark = { request_id: "fin-b23-mark-request", shoot_id: shoot.shoot.id, root_script_id: script.root_script_id, mark: "got_it" };
  const edit = { request_id: "fin-b23-edit-request", id: script.id, version: script.version, body: "The queued words are saved." };

  const shootGets = [];
  const markPosts = [];
  const editPosts = [];
  const handlers = {
    "/api/marketing/health": { ok: true, outbox: { held_reason: null, token_present: true } },
    "/api/marketing/shoot/mark": async (route) => {
      markPosts.push(JSON.parse(route.request().postData() || "{}"));
      if (markPosts.length === 1) return route.abort("internetdisconnected");
      return json(route, { marks: {} });
    },
    "/api/marketing/scripts/edit": async (route) => {
      editPosts.push(JSON.parse(route.request().postData() || "{}"));
      if (editPosts.length === 1) return route.abort("internetdisconnected");
      return json(route, { script: { ...script, id: "00000000-0000-4000-8000-000000000499", version: Number(script.version) + 1, body: edit.body }, warnings: [] });
    },
    "/api/marketing/shoot": async (route, { url, method }) => {
      if (method !== "GET") return json(route, { ok: true });
      shootGets.push(new URL(url).pathname + new URL(url).search);
      return json(route, shoot);
    },
  };
  const init = ({ markItem, scriptItem, savedEdit }) => {
    localStorage.setItem("fhtp.queue", JSON.stringify([markItem]));
    localStorage.setItem("fhtp.edits", JSON.stringify({
      items: {
        [scriptItem.root_script_id]: {
          root: scriptItem.root_script_id, base_id: scriptItem.id, base_version: scriptItem.version,
          body: savedEdit.body, parts: null, edits: 1, dirty: false, sent: { ...savedEdit, edits: 1 },
          conflict: null, failed: null, savedBody: scriptItem.body, savedParts: scriptItem.parts ?? null,
        },
      },
      savedAt: null,
    }));
  };
  const { page, errors } = await open("/app/teleprompter.html?k=film-key-proof", {
    handlers, clock: true, viewport: { width: 390, height: 844 },
    init: `(${init.toString()})(${JSON.stringify({ markItem: { path: "marketing/shoot/mark", body: mark }, scriptItem: script, savedEdit: edit })})`,
  });
  await page.locator("#content .w").first().waitFor({ state: "visible" });
  await waitFor(() => shootGets.length === 1 && markPosts.length === 1 && editPosts.length === 1, "the first read and the first failed sends");
  const queued = () => page.evaluate(() => ({
    marks: JSON.parse(localStorage.getItem("fhtp.queue") || "[]").length,
    edits: Object.keys((JSON.parse(localStorage.getItem("fhtp.edits") || "{}").items) || {}).length,
  }));
  assert.deepEqual(await queued(), { marks: 1, edits: 1 });

  // Just under 5 seconds: nothing yet.
  await page.clock.fastForward(4_999);
  await page.waitForTimeout(200);
  assert.deepEqual({ gets: shootGets.length, marks: markPosts.length, edits: editPosts.length }, { gets: 1, marks: 1, edits: 1 });

  // The 5 second beat: one re-read, and the same saved mark and edit are sent again.
  await page.clock.fastForward(1);
  await waitFor(() => shootGets.length === 2 && markPosts.length === 2 && editPosts.length === 2, "the 5 second re-read and flush");
  assert.deepEqual(markPosts, [mark, mark]);
  assert.deepEqual(editPosts, [edit, edit]);
  assert.match(shootGets[1], /^\/api\/marketing\/shoot\?wpm=\d+$/);
  await page.waitForFunction(() => !JSON.parse(localStorage.getItem("fhtp.queue") || "[]").length);
  assert.deepEqual(await queued(), { marks: 0, edits: 0 });
  assert.equal((await page.locator("#play").innerText()).trim(), "Play", "the re-read leaves the teleprompter paused");

  // The next beat is another 5 seconds on, and nothing is left to send.
  await page.clock.fastForward(4_999);
  await page.waitForTimeout(200);
  assert.equal(shootGets.length, 2);
  await page.clock.fastForward(1);
  await waitFor(() => shootGets.length === 3, "the second 5 second re-read");
  assert.equal(markPosts.length, 2, "nothing is sent twice");
  assert.equal(editPosts.length, 2);

  // While the words roll nothing is re-read; paused again, the beat is back.
  await page.locator("#play").click();
  await page.clock.runFor(2_500); // the 3-2-1 count, then the words roll
  await page.waitForFunction(() => window.__fhtp.state().playing === true);
  const before = shootGets.length;
  await page.clock.fastForward(5_000);
  await page.waitForTimeout(200);
  assert.equal(shootGets.length, before, "no re-read while the words are rolling");
  await page.locator("#play").click();
  await page.waitForFunction(() => window.__fhtp.state().playing === false);
  await page.clock.fastForward(5_000);
  await waitFor(() => shootGets.length === before + 1, "the re-read after pausing");
  assert.deepEqual(errors, []);
  await page.close();
});

test("full screen is asked for again on the first tap, once, and not on later taps", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const { shoot } = shootFixture();
  const handlers = {
    "/api/marketing/health": { ok: true, outbox: { held_reason: null, token_present: true } },
    "/api/marketing/shoot": shoot,
  };
  const init = () => {
    window.__fullscreenCalls = [];
    Object.defineProperty(Element.prototype, "requestFullscreen", { configurable: true, value: function (options) {
      window.__fullscreenCalls.push({ element: this === document.documentElement, options: options || null });
      if (window.__fullscreenCalls.length === 1) return Promise.reject(new Error("not allowed before a user action"));
      return Promise.resolve();
    } });
  };
  const { page } = await open("/app/teleprompter.html", { handlers, viewport: { width: 390, height: 844 }, init: `(${init.toString()})()` });
  await page.locator("#wpm-up").waitFor({ state: "visible" });
  const calls = () => page.evaluate(() => window.__fullscreenCalls);
  await waitFor(async () => (await calls()).length === 1, "the page-load attempt");
  assert.deepEqual(await calls(), [{ element: true, options: { navigationUI: "hide" } }]);

  await page.locator("#wpm-up").click();
  assert.deepEqual(await calls(), [
    { element: true, options: { navigationUI: "hide" } },
    { element: true, options: { navigationUI: "hide" } },
  ], "the first tap asks again, on the document element");
  await page.locator("#wpm-down").click();
  await page.locator("#wpm-up").click();
  assert.equal((await calls()).length, 2, "later taps do not ask again");
  await page.close();
});
