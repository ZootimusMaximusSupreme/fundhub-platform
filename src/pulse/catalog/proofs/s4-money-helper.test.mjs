// Proves the Money helper: the three suggestion buttons and the message box send
// the exact words; the thread shows each message, the answer, which brain
// answered and what the helper did, and polls while a turn waits.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const WORDS = ["What is due this week?", "Which card should I pay first?", "Got declined? Paste the letter here"];
const PAGE = { entry: "page", file: "money-helper.html", surface: "public/app/money-helper.html" };
const FRAME = { entry: "frame", tab: "helper", surface: "financeos.html#helper" };

async function openHelper(open, target, { session = CLIENT, clientId = "", read }) {
  const resource = moneyResource("helper", { read, write: () => ({ status: 202, body: { ok: true } }) });
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-helper, #mh-input");
  return { ...opened, ...resource.log };
}

const emptyThread = () => ({ ...sampleAnswer("money-helper.sample.json"), turns: [], pending: 0 });

test("each suggestion button sends its own words; staff on a client file name the client", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Suggestion buttons x3/, async () => {
    const { page, posts } = await openHelper(open, PAGE, { read: emptyThread });
    const buttons = page.locator('[data-act="suggest"]');
    assert.equal(await buttons.count(), 3);
    for (const [i, words] of WORDS.entries()) {
      assert.equal(await buttons.nth(i).getAttribute("data-text"), words);
      await buttons.nth(i).click();
      await waitFor(() => posts.length === i + 1);
      assert.deepEqual(posts[i], { action: "send", message: words });
    }
    await page.close();
    const staff = await openHelper(open, PAGE, { session: STAFF, clientId: CLIENT_ID, read: emptyThread });
    await staff.page.locator('[data-act="suggest"]').nth(1).click();
    await waitFor(() => staff.posts.length === 1);
    assert.deepEqual(staff.posts[0], { action: "send", message: WORDS[1], client_id: CLIENT_ID });
    await staff.page.close();
  }, PAGE.surface);
});

test("Enter sends what was typed, Shift+Enter makes a new line, an empty box is refused", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Message box \+ Send/, async () => {
    const { page, posts } = await openHelper(open, PAGE, { read: emptyThread });
    await page.locator('button[type="submit"]').click();
    await page.waitForFunction(() => /Type a message first\./.test(document.body.innerText));
    assert.deepEqual(posts, []);
    const box = page.locator("#mh-input");
    await box.fill("Which card should I pay first?");
    await box.press("Shift+Enter");
    await page.waitForTimeout(150);
    assert.deepEqual(posts, [], "Shift+Enter sends nothing");
    await box.press("Enter");
    await waitFor(() => posts.length === 1);
    assert.equal(posts[0].action, "send");
    assert.equal(posts[0].message.trim(), "Which card should I pay first?");
    await page.close();
  }, PAGE.surface);
});

test("the thread shows messages, answers, the brain and the cards, and polls while a turn waits", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Thread: each message/, async () => {
    const answered = sampleAnswer("money-helper.sample.json");
    const waiting = { ...answered, turns: [{ ...answered.turns[0], id: "turn-wait", status: "queued", reply: null, answered_at: null, actions: [], brain: null }], pending: 1 };
    let calls = 0;
    const { page } = await openHelper(open, FRAME, { read: () => (++calls === 1 ? waiting : answered) });
    await page.waitForFunction(() => /Thinking…/.test(document.body.innerText));
    assert.equal(await page.locator(".msg.is-thinking").count(), 1, "a queued turn shows Thinking…");
    await page.waitForFunction(() => !/Thinking…/.test(document.body.innerText), null, { timeout: 10_000 });
    assert.ok(calls >= 2, "the page asked again by itself");
    const first = answered.turns[0];
    const text = await page.locator("body").innerText();
    assert.ok(text.includes(first.input), "the client's message is shown");
    assert.ok(text.includes(first.reply.slice(0, 60)), "the helper's answer is shown");
    assert.ok(await page.locator(".brain-ai").count() > 0, "the brain that answered is named");
    assert.equal(await page.locator(".msg.from-helper").first().locator(".acts li").count(), first.actions.filter((a) => a.type !== "no_action").length);
    await page.close();
  }, FRAME.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
