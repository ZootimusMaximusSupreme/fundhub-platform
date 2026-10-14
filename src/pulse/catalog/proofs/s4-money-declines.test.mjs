// Proves the Applications (declines) section: the list shows each decline with
// its reasons, quotes and steps, and the paste box posts the exact letter for
// the right bank. Standalone page (money-declines.html) and frame tab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, STAFF, CLIENT_ID, entryUrl, moneyResource, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const TARGETS = {
  page: { entry: "page", file: "money-declines.html", surface: "public/app/money-declines.html" },
  frame: { entry: "frame", tab: "declines", surface: "financeos.html#declines" },
};
const LETTER = "We reviewed your application and we are unable to approve it at this time because of recent inquiries.";

const view = () => ({
  can_paste: true,
  applications: [
    { id: "app-chase", bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Applied", decline_words: null },
    { id: "app-amex", bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "Declined. We are working on it." },
  ],
  declines: [{
    id: "dec-1", bank: "American Express", product: "Blue Business", declined_on: "2026-10-02", received_on: "2026-10-03",
    outcome: "reapply_later", status_words: "We plan to apply again",
    reasons: [{ label: "Too many inquiries", words: "Several recent credit checks.", quote: "recent inquiries on your credit report" }],
    needs_person: true, needs_person_why: "One line of the letter needs a person.", unknown_parts: ["see attached reference"],
    your_steps: [{ text: "Send the second page of the letter", status: "done" }, { text: "Confirm your business phone", status: "open" }, { text: "Skip the survey", status: "skipped" }],
    fundhub_steps: [{ text: "Call the bank", status: "done" }, { text: "Ask for reconsideration", status: "open" }], fundhub_done: 1, fundhub_total: 2,
    call_on: "2026-10-20", reapply_on: "2026-11-15", when: ["The call needs the letter on file."],
  }],
});

async function openDeclines(open, target, { session = CLIENT, clientId = "" } = {}) {
  const resource = moneyResource("/api/blueprint/declines", {
    read: () => ({ ok: true, view: view() }),
    write: (body) => ({ status: 200, body: { ok: true, decline: { id: "dec-2", bank: body.bank || "Chase" } } }),
  });
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-declines .dc-paste");
  return { ...opened, ...resource.log };
}

test("the list shows each decline with reasons, quotes, steps and what happens next", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Applications list: past declines with reasons/, async () => {
    const { page, errors } = await openDeclines(open, TARGETS.frame);
    const card = page.locator('article[data-decline="dec-1"]');
    const text = await card.innerText();
    assert.match(text, /American Express · Blue Business/);
    assert.match(text, /Declined Oct 2, 2026/);
    assert.match(text, /Too many inquiries/);
    assert.match(text, /Your letter says: “recent inquiries on your credit report”/);
    assert.match(text, /A Fundhub person will read this/);
    assert.match(text, /“see attached reference”/);
    assert.equal(await card.locator(".dc-steps").first().locator("li.is-done").count(), 1);
    assert.equal(await card.locator(".dc-steps").first().locator("li.is-open").count(), 1);
    assert.equal(await card.locator(".dc-steps").first().locator("li.is-skip").count(), 1);
    assert.match(text, /Fundhub's steps — 1 of 2 done/);
    assert.match(text, /We plan to call the bank on Oct 20, 2026\./);
    assert.match(text, /We plan to apply at this bank again on Nov 15, 2026\./);
    const apps = await page.locator(".dc-apps").innerText();
    assert.match(apps, /Chase · Ink Business\s+Applied/);
    assert.match(apps, /American Express · Blue Business\s+Declined\. We are working on it\./);
    assert.deepEqual(errors, []);
    await page.close();
  }, TARGETS.frame.surface);
});

test("the paste box refuses a bad entry and posts the exact letter for the right bank", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  const rows = {
    page: [/^Paste the bank's letter or email textarea/, /^Read my decline/],
    frame: [/^Paste a decline letter: bank select/],
  };
  for (const target of Object.values(TARGETS)) {
    const { page, posts } = await openDeclines(open, target, target.entry === "frame" ? { session: STAFF, clientId: CLIENT_ID } : {});
    const say = () => page.locator('[data-slot="result"]').innerText();
    const readIt = () => page.locator('[data-act="paste"]').click();
    const textBox = page.locator('[data-field="text"]');

    assert.equal(await textBox.getAttribute("maxlength"), "20000");
    await readIt();
    assert.match(await say(), /Pick the bank that sent the letter\./);
    await page.locator('[data-field="bank"]').selectOption("__other");
    await textBox.fill("too short");
    await readIt();
    assert.match(await say(), /Tell us which bank sent it\./);
    await page.locator('[data-field="bank-name"]').fill("Mountain Credit Union");
    await readIt();
    assert.match(await say(), /Paste the whole letter or email from the bank\./);
    assert.deepEqual(posts, [], "nothing is sent for a bad entry");

    await textBox.fill(LETTER);
    await readIt();
    await waitFor(() => posts.length === 1);
    const clientPart = target.entry === "frame" ? { client_id: CLIENT_ID } : {};
    assert.deepEqual(posts[0], { action: "paste", text: LETTER, bank: "Mountain Credit Union", ...clientPart });
    await page.waitForFunction(() => /We read your letter from Mountain Credit Union\./.test(document.body.innerText));

    await page.locator('[data-field="bank"]').selectOption("app-chase");
    await textBox.fill(LETTER);
    await readIt();
    await waitFor(() => posts.length === 2);
    assert.deepEqual(posts[1], { action: "paste", text: LETTER, application_id: "app-chase", ...clientPart });

    for (const matcher of rows[target.entry]) await proof.check(matcher, async () => {}, target.surface);
    await page.close();
  }
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
