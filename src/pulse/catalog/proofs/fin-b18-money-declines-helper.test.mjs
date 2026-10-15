// Batch 18 practice tests: two client money pages in a real Chromium with fake /api answers.
//
//   money-declines.html   the Bank name box under "Another bank", the Your bank applications list, and the
//                         Your steps list with Fundhub's steps fold
//   money-helper.html     the stopped / not switched on banner

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";
import { CLIENT, moneyResource, sampleAnswer } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const compact = (text) => String(text).replace(/\s+/g, " ").trim();

// ───────────────────────── money-declines.html ─────────────────────────

const LETTER = "We reviewed your application and we are unable to approve it at this time because of recent inquiries.";
const DECLINES_URL = "/api/blueprint/declines";

function declinesView(over = {}) {
  return {
    can_paste: true,
    applications: [
      { id: "app-chase", bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Waiting on the bank", decline_words: null },
      { id: "app-amex", bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "We plan to apply again" },
    ],
    declines: [],
    ...over,
  };
}

async function openDeclines(view, { session = CLIENT, clientId = "" } = {}) {
  const resource = moneyResource(DECLINES_URL, {
    read: () => ({ ok: true, view }),
    write: () => ({ status: 200, body: { ok: true, decline: { id: "dec-new", bank: "Another" } } }),
  });
  const opened = await screens.open(`/app/money-declines.html${clientId ? `?client_id=${clientId}` : ""}`, { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-declines h1");
  return { ...opened, ...resource.log };
}

test("Declines: Another bank shows the Bank name box, a missing name is refused, and a typed name goes with the letter", { timeout: 90_000 }, async () => {
  await proof.check(/^Bank name text box \(shown for Another bank\)/, async () => {
    const { page, posts, errors } = await openDeclines(declinesView());
    const other = page.locator('[data-slot="other"]');
    const nameBox = page.locator('[data-field="bank-name"]');
    const bank = page.locator('[data-field="bank"]');
    const say = () => page.locator('[data-slot="result"]').innerText();
    assert.equal(await other.evaluate((el) => el.hidden), true, "the Bank name box starts hidden");

    await bank.selectOption("__other");
    assert.equal(await other.evaluate((el) => el.hidden), false, "Another bank shows it");
    await bank.selectOption("app-chase");
    assert.equal(await other.evaluate((el) => el.hidden), true, "a listed bank hides it again");
    await bank.selectOption("__other");

    // no name: refused, nothing sent, the cursor goes to the name box
    await page.locator('[data-field="text"]').fill(LETTER);
    await page.locator('[data-act="paste"]').click();
    assert.match(await say(), /Tell us which bank sent it\./);
    assert.deepEqual(posts, [], "no name, no request");
    assert.equal(await nameBox.evaluate((el) => document.activeElement === el), true, "the cursor goes to the Bank name box");

    // a name made only of spaces is no name
    await nameBox.fill("   ");
    await page.locator('[data-act="paste"]').click();
    assert.match(await say(), /Tell us which bank sent it\./);
    assert.deepEqual(posts, []);

    // a typed name goes with the letter, trimmed, and no application id
    await nameBox.fill("  Local Credit Union  ");
    await page.locator('[data-act="paste"]').click();
    await waitFor(() => posts.length === 1, "the paste request");
    assert.deepEqual(posts[0], { action: "paste", text: LETTER, bank: "Local Credit Union" });
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-declines.html");
});

test("Declines: Your bank applications lists each bank and product with the bank's word, or says there are none", { timeout: 90_000 }, async () => {
  await proof.check(/^Your bank applications list/, async () => {
    const view = declinesView({
      applications: [
        { id: "a1", bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Waiting on the bank", decline_words: null },
        { id: "a2", bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "We plan to apply again" },
        { id: "a3", bank: "Capital One", product: null, decline_id: null, status_words: "Ready to apply", decline_words: null },
        { id: "a4", bank: null, product: "Mystery card", decline_id: null, status_words: "Status not set", decline_words: null },
        { id: "a5", bank: null, product: null, decline_id: null, status_words: "Approved", decline_words: null },
      ],
    });
    const { page, errors } = await openDeclines(view);
    const rows = (await page.locator(".dc-apps li").allInnerTexts()).map(compact);
    assert.deepEqual(rows, [
      "Chase · Ink Business Waiting on the bank",
      "American Express · Blue Business We plan to apply again",
      "Capital One Ready to apply",
      "Mystery card Status not set",
      "A bank Approved",
    ], "each application shows its bank, product and status words; a decline's words win over the application's");
    assert.equal(await page.locator("#dc-paste option").filter({ hasText: "American Express" }).count(), 0, "a bank already declined is not offered in the paste picker");
    assert.deepEqual(errors, []);
    await page.close();

    // no applications: the empty sentence, whether or not there are declines
    const none = await openDeclines(declinesView({ applications: [] }));
    assert.match(await none.page.locator(".fh-declines").innerText(), /No bank applications on your file yet\./);
    assert.equal(await none.page.locator(".dc-apps").count(), 0);
    await none.page.close();
    const declineOnly = await openDeclines(declinesView({
      applications: [],
      declines: [{ id: "dec-9", bank: "Wells Fargo", product: null, declined_on: "2026-10-02", outcome: "open", status_words: "We are working on it",
        reasons: [], needs_person: false, your_steps: [], fundhub_steps: [], fundhub_done: 0, fundhub_total: 0, when: [] }],
    }));
    assert.match(await declineOnly.page.locator(".dc-block").last().innerText(), /No bank applications on your file yet\./);
    await declineOnly.page.close();
  }, "public/app/money-declines.html");
});

test("Declines: the Your steps list marks each step Done, Skipped or Not done yet, and Fundhub's steps fold counts them", { timeout: 90_000 }, async () => {
  await proof.check(/^Your steps list \+ Fundhub's steps expander/, async () => {
    const decline = {
      id: "dec-1", bank: "American Express", product: "Blue Business", declined_on: "2026-10-02", outcome: "open",
      status_words: "We are working on it", reasons: [], needs_person: false, when: [],
      your_steps: [
        { text: "Send the second page of the letter", status: "done" },
        { text: "Confirm your business phone", status: "open" },
        { text: "Skip the survey", status: "skipped" },
      ],
      fundhub_steps: [
        { text: "Call the bank", status: "done" },
        { text: "Ask for reconsideration", status: "open" },
        { text: "Write the second letter", status: "skipped" },
      ],
      fundhub_done: 2, fundhub_total: 3,
    };
    const bare = { ...decline, id: "dec-2", bank: "Wells Fargo", your_steps: [], fundhub_steps: [], fundhub_done: 0, fundhub_total: 0 };
    const { page, errors } = await openDeclines(declinesView({ declines: [decline, bare] }));
    const card = page.locator('article[data-decline="dec-1"]');
    const steps = (locator) => locator.locator("li").evaluateAll((items) => items.map((li) => ({
      cls: li.className, mark: li.querySelector(".dc-mark").textContent, text: li.querySelector(".dc-step-text").textContent,
      word: li.querySelector(".dc-word").textContent,
    })));

    assert.deepEqual(await steps(card.locator(".dc-steps").first()), [
      { cls: "dc-step is-done", mark: "✓", text: "Send the second page of the letter", word: "Done" },
      { cls: "dc-step is-open", mark: "○", text: "Confirm your business phone", word: "Not done yet" },
      { cls: "dc-step is-skip", mark: "–", text: "Skip the survey", word: "Skipped" },
    ]);
    assert.match(await card.locator(".eyebrow", { hasText: /your steps/i }).first().innerText(), /your steps/i);

    const fold = card.locator("details.dc-ours");
    assert.equal(compact(await fold.locator("summary").innerText()), "Fundhub's steps — 2 of 3 done", "the fold counts finished and skipped steps");
    assert.equal(await fold.evaluate((el) => el.open), false, "Fundhub's steps start folded");
    assert.equal(await fold.locator("li").first().isVisible(), false);
    await fold.locator("summary").click();
    assert.equal(await fold.evaluate((el) => el.open), true);
    assert.deepEqual((await steps(fold)).map((s) => [s.word, s.text]), [
      ["Done", "Call the bank"], ["Not done yet", "Ask for reconsideration"], ["Skipped", "Write the second letter"],
    ]);

    // a decline with no steps shows no empty list and no empty fold
    const empty = page.locator('article[data-decline="dec-2"]');
    assert.equal(await empty.locator(".dc-steps").count(), 0);
    assert.equal(await empty.locator("details.dc-ours").count(), 0);
    assert.equal(await empty.locator(".eyebrow", { hasText: /your steps/i }).count(), 0);
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-declines.html");
});

// ───────────────────────── money-helper.html ─────────────────────────

const HELPER = sampleAnswer("money-helper.sample.json");

async function openHelper(helper) {
  const answer = { ...HELPER, helper: { ...HELPER.helper, ...helper } };
  const opened = await screens.open("/app/money-helper.html", { session: CLIENT, handlers: { "/api/money/helper": answer } });
  await opened.page.waitForSelector("#helper-root .card.thread");
  return opened;
}

test("Helper: the banner says it stopped, or that it is not switched on, and the Send box goes away with it", { timeout: 90_000 }, async () => {
  await proof.check(/^Banner: helper stopped \/ not switched on/, async () => {
    const banner = async (helper) => {
      const { page, errors } = await openHelper(helper);
      assert.deepEqual(errors, []);
      const text = (await page.locator(".banner").count()) ? compact(await page.locator(".banner").innerText()) : null;
      const composer = await page.locator("form.composer").count();
      await page.close();
      return { text, composer };
    };
    assert.deepEqual(await banner({ on: true, halted: false, halt_reason: null }), { text: null, composer: 1 }, "a helper that is on and running shows no banner and the Send box");
    assert.deepEqual(await banner({ on: true, halted: true, halt_reason: "stop" }), {
      text: "The money helper stopped here. You asked it to stop, so it will not text you. A person from Fundhub will follow up.",
      composer: 0,
    }, "a stop the client asked for says so, and there is nothing to send into");
    assert.deepEqual(await banner({ on: true, halted: true, halt_reason: "legal" }), {
      text: "The money helper stopped here. A person from Fundhub will follow up.",
      composer: 0,
    }, "a stop for another reason does not claim the client asked for it");
    assert.deepEqual(await banner({ on: false, halted: false, halt_reason: null }), {
      text: "The money helper is not switched on. Your advisor can turn it on.",
      composer: 0,
    }, "a helper that is off says so");
    assert.deepEqual(await banner({ on: false, halted: true, halt_reason: "stop" }), {
      text: "The money helper stopped here. You asked it to stop, so it will not text you. A person from Fundhub will follow up.",
      composer: 0,
    }, "stopped wins over not switched on");
  }, "public/app/money-helper.html");
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
