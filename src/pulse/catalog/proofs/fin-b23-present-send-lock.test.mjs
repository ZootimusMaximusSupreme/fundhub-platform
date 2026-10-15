// Practice test (fake data, real page): the double-press guard on every send
// button of the closer's deck (present.html + present.js + contract-send.js).
// For each button that sends something to a client it proves, in the rendered
// page: one press sends one request, the button says "Sending…" and is
// disabled while the request is out, a success keeps it locked for the 4 second
// cooldown and leaves a "Sent at" line, the line counts repeat sends, and a
// failed send is not counted and can be pressed again at once.
// The page clock is paused, so the cooldown moves only when this test says.
//
// What is NOT proved here, and why the catalog row stays open (two product findings, see the
// batch 23 manifest): "Generate letters and email now" shows "Nothing was sent" and starts no
// cooldown when the pack WAS delivered, and "Send soft pull" is drawn as a plain button with no
// "Sending…", no "Sent at" line and no count. Only the half of those two that works today is judged.

import { test } from "node:test";
import assert from "node:assert/strict";

import { CLOSER } from "../../../../e2e/harness.mjs";
import { bodyOf, json, startPages, waitFor } from "./fin-b23-browser-kit.mjs";

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
// \s also takes the narrow no-break space newer browsers put before AM/PM
const SENT_AT = /^Sent at \d{1,2}:\d{2}\s(AM|PM)$/;

const OFFERS = [
  { key: "FUNDING_DFY", name: "Funding done for you", priceCents: 500000, priceDisplay: "$5,000", letters: true, contractTemplateKey: "FUNDING-AGREEMENT" },
  { key: "REPAIR_DFY", name: "Repair done for you", priceCents: 150000, priceDisplay: "$1,500", letters: false, contractTemplateKey: "REPAIR-AGREEMENT" },
  { key: "REPAIR_TRIAL", name: "Repair trial", priceCents: 50000, priceDisplay: "$500", letters: false },
  { key: "UWIQ_DELIVERABLES", name: "Deliverables", priceCents: 9900, priceDisplay: "$99", letters: true },
  { key: "FUNDING_MASTERY", name: "Funding mastery", priceCents: 200000, priceDisplay: "$2,000", letters: true },
];
const deck = (tier) => ({
  ok: true,
  survey: { name: "Dana Whitfield" },
  businesses: [],
  income_estimates: {},
  engine: { available: true, tier, fico: { experian: 700, equifax: 702, transunion: 698 }, reasons: [], total: 40000 },
  offers: OFFERS,
  soft_pull: null,
});

/** A POST the test holds open until it says go, so "Sending…" can be seen. */
function held() {
  const gate = { calls: [], release: null };
  const waiting = [];
  gate.handler = (answerFor) => async (route) => {
    const body = bodyOf(route);
    gate.calls.push(body);
    const answer = answerFor(body);
    await new Promise((resolve) => waiting.push(resolve));
    return json(route, answer.body, answer.status || 200);
  };
  gate.release = () => { while (waiting.length) waiting.shift()(); };
  return gate;
}

async function openDeck(open, { tier, handlers, phase = "07" }) {
  const opened = await open(`/app/present.html?contact=${CLIENT}`, {
    session: CLOSER,
    clock: true,
    handlers: { "/api/read/closer-deck": deck(tier), ...handlers },
  });
  await opened.page.waitForSelector(`[data-act="phase:${phase}"]`);
  await opened.page.locator(`[data-act="phase:${phase}"]`).click();
  return opened;
}

/** Real time for a stray request to reach the stand-in before a count is read. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

/**
 * The whole lock story for one send button.
 *   button: the data-act, label: its idle words, sent: how many requests one press made.
 */
async function proveLock({ page, gate, button, label, fail }) {
  const btn = page.locator(`[data-act="${button}"]`);
  assert.equal((await btn.textContent()).trim(), label);
  assert.equal(await btn.isDisabled(), false);

  // One press: one request, the button shows it is working and cannot be pressed again.
  await btn.click();
  await waitFor(() => gate.calls.length === 1, `${button} request`);
  await page.waitForFunction((b) => /Sending…/.test(document.querySelector(`[data-act="${b}"]`)?.textContent || ""), button);
  assert.equal(await btn.isDisabled(), true, "disabled while the request is out");
  await btn.click({ force: true });
  await btn.click({ force: true });
  assert.equal(gate.calls.length, 1, "extra presses while it is out send nothing");

  if (fail) {
    // A failed send is not a send: no time stamp, no cooldown, pressable at once.
    fail.answerWith.value = fail.answer;
    gate.release();
    await page.waitForFunction((b) => document.querySelector(`[data-act="${b}"]`) && !document.querySelector(`[data-act="${b}"]`).disabled
      && !/Sending…/.test(document.querySelector(`[data-act="${b}"]`).textContent), button);
    assert.equal((await btn.textContent()).trim(), label);
    assert.equal(await page.locator(".sent-at").count(), 0, "a failed send leaves no Sent at line");
    return;
  }

  // Success: locked for the cooldown, with a Sent at line that stays.
  gate.release();
  await page.waitForFunction((b) => /Sent — hold on/.test(document.querySelector(`[data-act="${b}"]`)?.textContent || ""), button);
  assert.equal(await btn.isDisabled(), true);
  const stamp = (await page.locator(".sent-at").first().textContent()).trim();
  assert.match(stamp, SENT_AT);
  await btn.click({ force: true });
  assert.equal(gate.calls.length, 1, "a press inside the cooldown sends nothing");

  await page.clock.fastForward(3_900);
  assert.equal((await btn.textContent()).trim(), "Sent — hold on", "still locked just before 4 seconds");
  await page.clock.fastForward(200);
  await page.waitForFunction((b) => !/Sent — hold on/.test(document.querySelector(`[data-act="${b}"]`)?.textContent || ""), button);
  assert.equal((await btn.textContent()).trim(), label, "the label is back after the cooldown");
  assert.equal(await btn.isDisabled(), false);
  assert.equal((await page.locator(".sent-at").first().textContent()).trim(), stamp, "the Sent at line stays");

  // A second real send is counted.
  await btn.click();
  await waitFor(() => gate.calls.length === 2, `${button} second request`);
  gate.release();
  await page.waitForFunction(() => /sent 2 times/.test(document.body.textContent));
  assert.match((await page.locator(".sent-at").first().textContent()).trim(), /^Sent at \d{1,2}:\d{2}\s(AM|PM) · sent 2 times$/);
}

test("Send agreement + pay link locks while sending, cools down for 4 seconds, and counts repeats", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const { page, errors } = await openDeck(open, {
    tier: "FULL_FUNDING",
    handlers: { "/api/closer-deck": gate.handler(() => ({ body: { ok: true } })) },
  });
  await proveLock({ page, gate, button: "pay", label: "Send agreement + pay link" });
  assert.equal(gate.calls[0].action, "send_pay_link");
  assert.equal(gate.calls[0].client_id, CLIENT);
  assert.deepEqual(errors, []);
  await page.close();
});

test("a failed pay link is not counted as sent and the button can be pressed again at once", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const answer = { value: null };
  const { page } = await openDeck(open, {
    tier: "FULL_FUNDING",
    handlers: { "/api/closer-deck": gate.handler(() => answer.value || { body: { ok: true } }) },
  });
  answer.value = { body: { ok: false, error: { message: "The pay link could not be made." } } };
  await proveLock({ page, gate, button: "pay", label: "Send agreement + pay link", fail: { answerWith: answer, answer: answer.value } });
  await page.close();
});

test("Generate letters and email now cannot be pressed again while its request is out", { timeout: 60_000 }, async (t) => {
  // Only the in-flight half is judged for this button. What the page shows after the answer comes back
  // is a product finding (see the manifest): present.js reads `delivered` off the wrapper, so a delivered
  // pack is shown as "Nothing was sent" and no cooldown starts. That is why the catalog row stays open.
  const { open } = await startPages(t);
  const gate = held();
  const { page } = await openDeck(open, {
    tier: "FULL_FUNDING",
    handlers: { "/api/closer-deck": gate.handler(() => ({ body: { ok: true, delivered: true, documentsStored: 2 } })) },
  });
  const btn = page.locator('[data-act="letters"]');
  await btn.click();
  await waitFor(() => gate.calls.length === 1, "the letters request");
  await page.waitForFunction(() => /Sending…/.test(document.querySelector('[data-act="letters"]')?.textContent || ""));
  assert.equal(await btn.isDisabled(), true);
  await btn.click({ force: true });
  await btn.click({ force: true });
  assert.equal(gate.calls.length, 1, "extra presses while it is out send nothing");
  assert.equal(gate.calls[0].action, "generate_letters");
  gate.release();
  await page.close();
});

test("Send soft pull sends once per press: more presses while it is out, or inside the 4 second hold, send nothing", { timeout: 90_000 }, async (t) => {
  // The soft pull button is drawn as a plain button (no "Sending…", no Sent at line): a product
  // finding in the manifest. What it still does is refuse a repeat press, and that is judged here.
  // A press is a bare click event so a toast sitting over the button cannot swallow it.
  const { open } = await startPages(t);
  const gate = held();
  const { page, errors } = await openDeck(open, {
    tier: "FULL_FUNDING",
    phase: "03",
    handlers: { "/api/closer-deck": gate.handler(() => ({ body: { ok: true, action: "send_soft_pull" } })) },
  });
  const btn = page.locator('[data-act="softpull"]');
  const press = () => btn.dispatchEvent("click");

  await press();
  await waitFor(() => gate.calls.length === 1, "the soft pull request");
  assert.equal(gate.calls[0].action, "send_soft_pull");
  assert.equal(gate.calls[0].client_id, CLIENT);
  await press();
  await press();
  await settle();
  assert.equal(gate.calls.length, 1, "presses while the request is out send nothing");

  gate.release();
  await page.waitForFunction(() => /Soft pull emailed/.test(document.body.innerText));
  await press();
  await settle();
  assert.equal(gate.calls.length, 1, "a press right after the send sends nothing");

  await page.clock.fastForward(3_900);
  await press();
  await settle();
  assert.equal(gate.calls.length, 1, "still held just before 4 seconds");

  await page.clock.fastForward(200);
  await press();
  await waitFor(() => gate.calls.length === 2, "the second soft pull request, after the hold");
  gate.release();
  assert.deepEqual(errors, []);
  await page.close();
});

test("a failed soft pull is not a send: the button works again at once", { timeout: 60_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const { page } = await openDeck(open, {
    tier: "FULL_FUNDING",
    phase: "03",
    handlers: { "/api/closer-deck": gate.handler(() => ({ body: { ok: false, error: "soft_pull_failed", message: "The soft pull could not be sent." } })) },
  });
  const btn = page.locator('[data-act="softpull"]');
  await btn.dispatchEvent("click");
  await waitFor(() => gate.calls.length === 1, "the soft pull request");
  gate.release();
  await page.waitForFunction(() => /could not be sent/.test(document.body.innerText));
  await btn.dispatchEvent("click");
  await waitFor(() => gate.calls.length === 2, "the second soft pull request, no hold after a failure");
  gate.release();
  await page.close();
});

test("Invoice this client locks, sends the open invoice and counts repeats", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const { page } = await openDeck(open, {
    tier: "FULL_FUNDING",
    handlers: {
      "/api/read/invoices": { ok: true, items: [{ id: "inv-void", status: "void" }, { id: "inv-open", status: "sent" }] },
      "/api/messages-outbound": gate.handler(() => ({ body: { ok: true } })),
    },
  });
  await page.locator('[data-act="more"]').click();
  await proveLock({ page, gate, button: "invoice", label: "Invoice this client" });
  assert.deepEqual(gate.calls[0], { action: "email_invoice", invoice_id: "inv-open" });
  await page.close();
});

test("Send contract locks, sends the agreement for the chosen offer and counts repeats", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const drafts = [];
  const { page } = await openDeck(open, {
    tier: "FULL_FUNDING",
    handlers: {
      "/api/read/contracts": { ok: true, items: [
        { id: "tpl-repair", template_key: "REPAIR-AGREEMENT", name: "Repair agreement", active: true },
        { id: "tpl-funding", template_key: "FUNDING-AGREEMENT", name: "Funding agreement", active: true },
      ] },
      "/api/contracts": gate.handler((body) => {
        drafts.push(body);
        return body.action === "create_draft"
          ? { body: { ok: true, contract: { id: "con-1" } } }
          : { body: { ok: true, links: [{ url: "https://sign.example.test/con-1" }] } };
      }),
    },
  });
  await page.locator('[data-act="more"]').click();
  const btn = page.locator('[data-act="contract"]');
  assert.equal((await btn.textContent()).trim(), "Send contract");
  await btn.click();
  await page.waitForFunction(() => /Sending…/.test(document.querySelector('[data-act="contract"]')?.textContent || ""));
  assert.equal(await btn.isDisabled(), true);
  await btn.click({ force: true });
  // Two requests make one send: the draft, then the send. Let both through.
  await waitFor(() => gate.calls.length === 1, "the draft request");
  gate.release();
  await waitFor(() => gate.calls.length === 2, "the send request");
  gate.release();
  await page.waitForFunction(() => /Sent — hold on/.test(document.querySelector('[data-act="contract"]')?.textContent || ""));
  assert.deepEqual(drafts.map((d) => d.action), ["create_draft", "send"]);
  assert.equal(drafts[0].template_id, "tpl-funding", "the agreement that matches the chosen offer");
  assert.equal(drafts[0].client_id, CLIENT);
  assert.match((await page.locator(".sent-at").first().textContent()).trim(), SENT_AT);
  assert.equal(await btn.isDisabled(), true, "locked inside the cooldown");
  await btn.click({ force: true });
  assert.equal(gate.calls.length, 2, "a press inside the cooldown sends nothing more");
  await page.clock.fastForward(3_900);
  assert.equal((await btn.textContent()).trim(), "Sent — hold on");
  await page.clock.fastForward(200);
  await page.waitForFunction(() => /^Send contract$/.test((document.querySelector('[data-act="contract"]')?.textContent || "").trim()));
  assert.equal(await btn.isDisabled(), false);
  await page.close();
});

test("Send letters now locks after the staged letters are mailed", { timeout: 90_000 }, async (t) => {
  const { open } = await startPages(t);
  const gate = held();
  const sends = [];
  const { page } = await openDeck(open, {
    tier: "REPAIR_ONLY",
    handlers: {
      "/api/repair/enroll": { ok: true },
      "/api/repair/generate": { ok: true, letters: [{ bureau: "Experian", itemCount: 2, body_text: "Dear Experian, remove these.", letter_id: "L-1" }] },
      "/api/repair/send": gate.handler((body) => { sends.push(body); return { body: { ok: true } }; }),
    },
  });
  const send = page.locator('[data-act="send-letters"]');
  assert.equal(await send.isDisabled(), true, "nothing staged, nothing to send");
  await page.locator("#fh-repair-paid").fill("500");
  await page.locator('[data-act="stage-letters"]').click();
  await page.waitForFunction(() => /Staged 1 letter\(s\)/.test(document.body.innerText));
  await proveLock({ page, gate, button: "send-letters", label: "Send letters now" });
  assert.equal(sends[0].client_id, CLIENT);
  assert.equal(sends[0].mail, true);
  await page.close();
});
