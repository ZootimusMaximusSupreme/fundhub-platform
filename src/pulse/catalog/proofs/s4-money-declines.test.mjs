// Proves the Applications (declines) section: the list shows each decline with
// its reasons, quotes and steps, and the paste box posts the exact letter for
// the right bank. Standalone page (money-declines.html) and frame tab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, STAFF, CLIENT_ID, entryUrl, moneyResource, waitFor } from "./s4-money-harness.mjs";
import { recordDecline } from "../../../blueprint/decline-defense.mjs";
import { memoryDb, SIM_APPLICATIONS, TEST_CLIENT, TEST_ORG } from "../../../blueprint/decline-defense.test.db.mjs";

const proof = proofRows(import.meta.url);
const TARGETS = {
  page: { entry: "page", file: "money-declines.html", surface: "public/app/money-declines.html" },
  frame: { entry: "frame", tab: "declines", surface: "financeos.html#declines" },
};
const LETTER = "We reviewed your application and we are unable to approve it at this time because of recent inquiries.";
const CHASE_LETTER = "Your application for the Ink Business card was not approved because of too many recent credit checks on your report.";
const SSN = "123-45-6789";
const LETTER_WITH_SSN = `${LETTER} Social Security number on file: ${SSN}.`;
const [CHASE, AMEX] = SIM_APPLICATIONS.map((a) => a.id);

const view = () => ({
  can_paste: true,
  applications: [
    { id: CHASE, bank: "Chase", product: "Ink Business", decline_id: null, status_words: "Applied", decline_words: null },
    { id: AMEX, bank: "American Express", product: "Blue Business", decline_id: "dec-1", status_words: "Declined", decline_words: "Declined. We are working on it." },
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

// The paste POST is answered by the real save path (recordDecline) over an in-memory stand-in for the
// tables, so what the screen sent is what gets stored: masked, counted and filed for the right bank.
async function openDeclines(open, target, { session = CLIENT, clientId = "" } = {}) {
  const db = memoryDb({ applications: SIM_APPLICATIONS.map((a) => ({ ...a })) });
  const statusCalls = [];
  const staff = session === STAFF;
  const resource = moneyResource("/api/blueprint/declines", {
    read: () => ({ ok: true, view: view() }),
    write: async (body) => {
      const out = await recordDecline(db, {
        orgId: TEST_ORG, clientId: TEST_CLIENT, now: new Date("2026-10-13T12:00:00Z"),
        by: staff ? { kind: "staff", staffId: "s1", name: "Dana Advisor" } : { kind: "client" },
        staff: staff ? { id: "s1", name: "Dana Advisor", email: "dana@example.com" } : undefined,
        source: staff ? "staff" : "client_paste",
        input: { text: body.text, bank: body.bank, product: body.product, application_id: body.application_id || null },
        deps: { setApplicationStatus: async (_db, args) => { statusCalls.push(args); return { id: args.applicationId, status: args.status }; } },
      });
      return out.ok
        ? { status: 200, body: { ok: true, decline: { id: out.decline_id, bank: db.t.declines.at(-1).bank } } }
        : { status: 400, body: { ok: false, error: out.error } };
    },
  });
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-declines .dc-paste");
  return { ...opened, ...resource.log, db, statusCalls };
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
  // The page lists the textarea and the button as two rows; the frame lists one row for the whole form.
  const rows = {
    page: { box: /^Paste the bank's letter or email textarea/, button: /^Read my decline/ },
    frame: { form: /^Paste a decline letter: bank select/ },
  };
  for (const target of Object.values(TARGETS)) {
    const staff = target.entry === "frame";
    const { page, posts, db, statusCalls } = await openDeclines(open, target, staff ? { session: STAFF, clientId: CLIENT_ID } : {});
    const clientPart = staff ? { client_id: CLIENT_ID } : {};
    const say = () => page.locator('[data-slot="result"]').innerText();
    const readIt = () => page.locator('[data-act="paste"]').click();
    const textBox = page.locator('[data-field="text"]');
    const bank = page.locator('[data-field="bank"]');
    // A good paste repaints the section; wait for the fresh button (the old one says "Reading…").
    const saved = async (count) => {
      await waitFor(() => posts.length === count);
      await page.waitForFunction(() => {
        const send = document.querySelector('[data-act="paste"]');
        return send && !send.disabled && send.textContent === "Read my decline" && /We read your letter from /.test(document.body.innerText);
      });
    };

    // the button: it needs a bank and the whole letter, then posts for the bank named or the application picked
    const button = async () => {
      await readIt();
      assert.match(await say(), /Pick the bank that sent the letter\./);
      await bank.selectOption("__other");
      await textBox.fill("too short");
      await readIt();
      assert.match(await say(), /Tell us which bank sent it\./);
      await page.locator('[data-field="bank-name"]').fill("Mountain Credit Union");
      await readIt();
      assert.match(await say(), /Paste the whole letter or email from the bank\./);
      assert.deepEqual(posts, [], "nothing is sent for a bad entry");

      await textBox.fill(LETTER);
      await readIt();
      await saved(1);
      assert.deepEqual(posts[0], { action: "paste", text: LETTER, bank: "Mountain Credit Union", ...clientPart });
      assert.equal(db.t.declines.at(-1).bank, "Mountain Credit Union", "the letter is filed under the bank typed");
      await page.waitForFunction(() => /We read your letter from Mountain Credit Union\./.test(document.body.innerText));

      await bank.selectOption(CHASE);
      await textBox.fill(CHASE_LETTER);
      await readIt();
      await saved(2);
      assert.deepEqual(posts[1], { action: "paste", text: CHASE_LETTER, application_id: CHASE, ...clientPart });
      assert.equal(db.t.declines.at(-1).application_id, CHASE, "the letter is filed on the application picked");
      // Staff recording a decline on an application marks it Denied; a client's paste never changes an application.
      assert.deepEqual(statusCalls.map((c) => [c.applicationId, c.status]), staff ? [[CHASE, "Denied"]] : []);
    };

    // the box: 20 letters and numbers is the least it takes, 20,000 the most, and a Social Security number is masked when it is saved
    const box = async () => {
      assert.equal(await textBox.getAttribute("maxlength"), "20000");
      await bank.selectOption("__other");
      await page.locator('[data-field="bank-name"]').fill("Mountain Credit Union");
      const before = posts.length;
      await textBox.fill("a".repeat(19));
      await readIt();
      assert.match(await say(), /Paste the whole letter or email from the bank\./);
      await textBox.fill(`${"a".repeat(10)} ${"b".repeat(9)}`);
      await readIt();
      assert.match(await say(), /Paste the whole letter or email from the bank\./, "spaces do not count toward the 20");
      assert.equal(posts.length, before, "nothing is sent for 19 letters");
      await textBox.fill("a".repeat(20001));
      assert.equal((await textBox.inputValue()).length, 20000, "the box holds 20,000 at most");

      await textBox.fill("a".repeat(20));
      await readIt();
      await saved(before + 1);
      assert.equal(posts[before].text, "a".repeat(20), "20 is enough");

      await bank.selectOption("__other");
      await page.locator('[data-field="bank-name"]').fill("Mountain Credit Union");
      await textBox.fill(LETTER_WITH_SSN);
      await readIt();
      await saved(before + 2);
      assert.match(posts[before + 1].text, new RegExp(SSN), "the page sends the letter as it was pasted");
      const stored = db.t.declines.at(-1).letter_text;
      assert.doesNotMatch(stored, new RegExp(SSN), "the Social Security number is masked before it is stored");
      assert.match(stored, /unable to approve/, "the rest of the letter is kept");
    };

    if (staff) {
      await proof.check(rows.frame.form, async () => { await button(); await box(); }, target.surface);
    } else {
      await proof.check(rows.page.button, button, target.surface);
      await proof.check(rows.page.box, box, target.surface);
    }
    await page.close();
  }
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
