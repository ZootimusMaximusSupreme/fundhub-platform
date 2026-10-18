// Practice test (fake data, real page): the "Thinking…" wait on the Money
// helper (public/app/money-helper.html + money-helper.js). A turn that waits for
// the helper is re-read every 3 seconds; after 100 re-reads it stops asking and
// shows "Check again"; pressing that asks once more and starts the 3 second
// wait again; an answered turn ends the waiting. The page clock is paused and
// moved by this test, so the counts are exact.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLIENT = { ok: true, staff: { ...OWNER.staff, role: "client" } };
const BUSY_RUN_WAIT_MS = 60_000;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const answered = JSON.parse(fs.readFileSync(path.join(ROOT, "src/http/fixtures/money-helper.sample.json"), "utf8"));
const waiting = {
  ...answered,
  turns: [{ ...answered.turns[0], id: "turn-wait", status: "queued", reply: null, answered_at: null, actions: [], brain: null }],
  pending: 1,
};

async function openHelper(open, answerNow) {
  const reads = { n: 0 };
  const handlers = {
    "/api/money/helper": async (route, { method }) => {
      if (method !== "GET") return json(route, { ok: true });
      reads.n += 1;
      return json(route, answerNow());
    },
  };
  const opened = await open("/app/money-helper.html", { session: CLIENT, handlers, clock: true });
  await opened.page.waitForFunction(() => /Thinking…/.test(document.body.innerText));
  return { ...opened, reads };
}

test("a waiting turn is re-read every 3 seconds, stops after 100 re-reads, and Check again asks once more", { timeout: 300_000 }, async (t) => {
  const { open } = await startPages(t);
  let current = waiting;
  const { page, reads } = await openHelper(open, () => current);
  assert.equal(reads.n, 1, "one read when the page opens");

  await page.clock.fastForward(2_999);
  await page.waitForTimeout(120);
  assert.equal(reads.n, 1, "no second read before 3 seconds");
  await page.clock.fastForward(1);
  await waitFor(() => reads.n === 2, "the first re-read at 3 seconds", BUSY_RUN_WAIT_MS);

  for (let i = 3; i <= 101; i += 1) {
    await page.clock.fastForward(3_000);
    await waitFor(() => reads.n === i, `re-read number ${i - 1}`, BUSY_RUN_WAIT_MS);
  }
  assert.equal(reads.n, 101, "the open read plus exactly 100 re-reads");
  await page.waitForFunction(() => document.querySelector('[data-act="refresh"]'));
  assert.match(await page.locator(".stuck").innerText(), /Still thinking\./);

  await page.clock.fastForward(60_000);
  await page.waitForTimeout(150);
  assert.equal(reads.n, 101, "after 100 re-reads it stops asking by itself");

  // Check again: one read now, and the 3 second wait starts over.
  await page.locator('[data-act="refresh"]').click();
  await waitFor(() => reads.n === 102, "the Check again read", BUSY_RUN_WAIT_MS);
  await page.waitForFunction(() => !document.querySelector('[data-act="refresh"]'));
  await page.clock.fastForward(3_000);
  await waitFor(() => reads.n === 103, "the re-read after Check again", BUSY_RUN_WAIT_MS);

  // The helper answers: the waiting ends and nothing is asked again.
  current = answered;
  await page.clock.fastForward(3_000);
  await waitFor(() => reads.n === 104, "the read that finds the answer", BUSY_RUN_WAIT_MS);
  await page.waitForFunction(() => !/Thinking…/.test(document.body.innerText));
  assert.equal(await page.locator('[data-act="refresh"]').count(), 0);
  assert.ok((await page.locator("body").innerText()).includes(answered.turns[0].reply.slice(0, 40)), "the answer is on the page");
  await page.clock.fastForward(30_000);
  await page.waitForTimeout(150);
  assert.equal(reads.n, 104, "an answered thread is not polled");
  await page.close();
});
