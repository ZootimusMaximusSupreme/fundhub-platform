// Finish-853 batch 20, repair cycle 1: the staff chat widget, the three things the first cycle left open.
//   1. A teammate note the server refuses says so. The person is not left believing it was sent.
//   2. A teammate's new note appears without the person doing anything (the widget asks again every four
//      seconds while the panel is open and a thread is picked), and stops when the panel is closed.
//   3. A teammate's name, a note's words, an answer and its sources are drawn as words, never as markup.
// The real shell.js and chat-widget.js run in a real Chromium; /api/chat/* is answered by the test, so no
// model is called and nothing is sent.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until } from "./fin-b20-browser-kit.mjs";

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

const words = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});

function chatApi(state) {
  return (call) => {
    if (call.path === "/api/chat/ask") {
      return { ok: true, answer: { text: state.answer || "An answer." }, sources: state.sources || [] };
    }
    if (call.path === "/api/chat/peers") return { ok: true, staff: state.peers };
    if (call.path === "/api/chat/messages" && call.method === "GET") {
      if (call.query.kind === "internal") return { ok: true, threads: [{ id: "conv-1", participants: [{ id: "peer-1" }, { id: "staff-proof" }] }] };
      if (call.query.conversation_id === "conv-1") return { ok: true, messages: state.messages };
      return { ok: true, messages: [] };
    }
    if (call.path === "/api/chat/messages" && call.method === "POST") {
      if (state.refuse) return { status: 403, body: { ok: false, error: state.refuse } };
      if (state.refuseBare) return { status: 500, body: { ok: false } };
      return { ok: true, conversation_id: "conv-1" };
    }
    return undefined;
  };
}

async function openMessage(state) {
  const page = await makePage(lab, { api: chatApi(state) });
  await page.addInitScript(() => { window.__proof_ran = undefined; });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#fh-chat-fab").waitFor({ state: "attached", timeout: 20_000 });
  await page.locator("#fh-chat-fab").click();
  await page.locator('#fh-chat-modes [data-mode="message"]').click();
  await until(async () => (await page.locator("#fh-chat-peer option").count()) === state.peers.length + 1, { message: "the teammates list" });
  return page;
}

// Built at run time: nothing in this file is an address.
const NO_NAME = ["<u>no-name</u>", "proof.invalid"].join("@");
const PEERS = [{ id: "peer-1", name: "Dana Fox" }, { id: "peer-2", name: "Ray Ortiz" }];

test("chat widget: a note the server refuses is shown as not sent, with the reason, and the box is not left looking sent", { timeout: 60_000 }, async () => {
  const state = { peers: PEERS, messages: [{ rendered_body: "Can you call the file?", sender_staff_id: "peer-1", channel: "internal" }], refuse: "forbidden" };
  const page = await openMessage(state);
  await page.locator("#fh-chat-peer").selectOption("peer-1");
  await page.locator("#fh-chat-body .msg.internal", { hasText: "Can you call the file?" }).waitFor();
  await page.locator("#fh-chat-input").fill("Done, called at 3.");
  await page.locator("#fh-chat-send").click();
  await until(() => callsTo(page, "/api/chat/messages", "POST").length === 1, { message: "the send" });
  // Rejected saves are NOT an outgoing bubble. The unsent draft stays editable,
  // and the reason is announced without claiming the server or carrier sent it.
  const refused = page.locator("#fh-chat-hint", { hasText: "Not confirmed (forbidden)" });
  await refused.waitFor();
  assert.equal(await refused.getAttribute("role"), "alert", "failure is accessible to screen readers");
  assert.equal(await page.locator("#fh-chat-body .msg.me").count(), 0, "no false sent bubble");
  assert.equal(await page.locator("#fh-chat-input").inputValue(), "Done, called at 3.", "unsaved draft survives");
  assert.equal(await page.locator("#fh-chat-input").isEnabled(), true, "draft can be corrected or retried");
  await page.close();

  // A bare server 500 still gives an explicit failed state, not an ACK.
  const bare = { peers: PEERS, messages: [], refuseBare: true };
  const page2 = await openMessage(bare);
  await page2.locator("#fh-chat-peer").selectOption("peer-2");
  await page2.locator("#fh-chat-input").fill("First note.");
  await page2.locator("#fh-chat-send").click();
  await page2.locator("#fh-chat-hint", { hasText: "Not confirmed (http_500)" }).waitFor();
  assert.equal(await page2.locator("#fh-chat-body .msg.me").count(), 0);
  assert.equal(await page2.locator("#fh-chat-input").inputValue(), "First note.");
  await page2.close();
});

test("chat widget: a teammate's new note appears on its own within a few seconds, and stops being asked for when the panel is closed", { timeout: 90_000 }, async () => {
  const state = { peers: PEERS, messages: [{ rendered_body: "First note.", sender_staff_id: "peer-1", channel: "internal" }] };
  const page = await openMessage(state);
  await page.locator("#fh-chat-peer").selectOption("peer-1");
  await page.locator("#fh-chat-body .msg", { hasText: "First note." }).waitFor();
  assert.equal(await page.locator("#fh-chat-body .msg", { hasText: "Second note, no click." }).count(), 0);
  state.messages = [...state.messages, { rendered_body: "Second note, no click.", sender_staff_id: "peer-1", channel: "internal" }];
  await page.locator("#fh-chat-body .msg", { hasText: "Second note, no click." }).waitFor({ timeout: 15_000 });

  // closing the panel ends the asking
  await page.locator("#fh-chat-close").click();
  await new Promise((resolve) => setTimeout(resolve, 600));
  const asked = callsTo(page, "/api/chat/messages", "GET").length;
  state.messages = [...state.messages, { rendered_body: "Third note, panel closed.", sender_staff_id: "peer-1", channel: "internal" }];
  await new Promise((resolve) => setTimeout(resolve, 9000));
  assert.equal(callsTo(page, "/api/chat/messages", "GET").length, asked, "no read while the panel is closed");
  await page.close();
});

test("chat widget: a teammate's name, a note, an answer and its sources are drawn as words, never as markup", { timeout: 90_000 }, async () => {
  const hostileName = '<img src=x onerror="window.__proof_ran = 1">Eve & Co';
  const hostileNote = '<b>bold</b> & <script>window.__proof_ran = 2</script> "quoted"';
  const state = {
    peers: [{ id: "peer-x", name: hostileName }, { id: "peer-y", name: "", email: NO_NAME }],
    messages: [{ rendered_body: hostileNote, sender_staff_id: "peer-x", channel: "internal" }],
    answer: '<i>Answer</i> & "words"',
    sources: [{ title: '<s>Source</s>', href: 'x"><img src=x onerror="window.__proof_ran = 3">' }, { title: "<em>plain</em>" }],
  };
  // the thread for peer-x
  const api = chatApi(state);
  const page = await makePage(lab, {
    api: (call) => {
      if (call.path === "/api/chat/messages" && call.method === "GET" && call.query.kind === "internal") {
        return { ok: true, threads: [{ id: "conv-1", participants: [{ id: "peer-x" }] }] };
      }
      return api(call);
    },
  });
  await page.goto(`${lab.origin}/app/pipeline.html`, { waitUntil: "domcontentloaded" });
  await page.locator("#fh-chat-fab").waitFor({ state: "attached", timeout: 20_000 });
  await page.locator("#fh-chat-fab").click();

  // an answer and its sources
  await page.locator("#fh-chat-input").fill("anything");
  await page.locator("#fh-chat-send").click();
  const answer = page.locator("#fh-chat-body .msg:not(.me)").last();
  await answer.waitFor();
  await until(async () => (await words(answer, "span.src").catch(() => "")).startsWith("Sources:"), { message: "the sources line" });
  const answerWords = await answer.evaluate((el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll("span.src").forEach((n) => n.remove());
    return copy.textContent.replace(/\s+/g, " ").trim();
  });
  assert.equal(answerWords, '<i>Answer</i> & "words"', "the answer reads as the words it was sent");
  assert.equal(await words(answer, "span.src"), "Sources: <s>Source</s> · <em>plain</em>");
  assert.equal(await answer.locator("a").first().getAttribute("href"), state.sources[0].href, "the address is one attribute value, whole");

  // a teammate's name and a note
  await page.locator('#fh-chat-modes [data-mode="message"]').click();
  await until(async () => (await page.locator("#fh-chat-peer option").count()) === 3, { message: "the teammates list" });
  assert.deepEqual(await page.locator("#fh-chat-peer option").allInnerTexts(), ["Pick a teammate…", hostileName, NO_NAME]);
  await page.locator("#fh-chat-peer").selectOption("peer-x");
  await page.locator("#fh-chat-body .msg.internal").first().waitFor();
  assert.equal(await words(page, "#fh-chat-body .msg.internal"), hostileNote);

  assert.equal(await page.locator("#fh-chat-panel img, #fh-chat-panel b, #fh-chat-panel script, #fh-chat-panel i, #fh-chat-panel u, #fh-chat-panel s, #fh-chat-panel em").count(), 0, "no element came out of the chat");
  assert.equal(await page.evaluate(() => window.__proof_ran === undefined), true, "nothing in the chat ran");
  await page.close();
});
