// Finish-853 batch 20: the staff chat widget the shell mounts on every desk. The real shell.js and
// chat-widget.js run in a real Chromium; /api/chat/* is answered by the test, so no model is called and
// no message is sent. Covers the three staff modes (Ask system, Knowledge, Message a teammate) and who
// is not offered the widget.

import assert from "node:assert/strict";
import test, { before, after } from "node:test";

import { openLab, makePage, callsTo, until, TOKEN } from "./fin-b20-browser-kit.mjs";

let lab;
before(async () => { lab = await openLab(); });
after(async () => { await lab.close(); });

const words = (scope, selector) => scope.locator(selector).first().evaluate((el) => {
  const parts = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) parts.push(walker.currentNode.nodeValue);
  return parts.join(" ").replace(/\s+/g, " ").trim();
});

function chatApi(state = {}) {
  return (call) => {
    if (call.path === "/api/chat/ask") {
      const sent = JSON.parse(call.body || "{}");
      if (state.askFails) return { status: 500, body: { ok: false, error: "model_unavailable" } };
      return {
        ok: true,
        answer: { text: `Answer for ${sent.mode}: ${sent.question}` },
        sources: [{ title: "Send a contract", href: "documents.html#send" }, { title: "SOP 4" }],
      };
    }
    if (call.path === "/api/chat/peers") {
      return { ok: true, staff: [{ id: "peer-1", name: "Dana Fox" }, { id: "peer-2", name: "Ray Ortiz" }] };
    }
    if (call.path === "/api/chat/messages" && call.method === "GET") {
      if (call.query.kind === "internal") {
        return { ok: true, threads: [{ id: "conv-1", participants: [{ id: "peer-1" }, { id: "staff-proof" }] }] };
      }
      if (call.query.conversation_id === "conv-1") {
        return {
          ok: true,
          messages: [
            { rendered_body: "Can you call the Whitfield file?", sender_staff_id: "peer-1", channel: "internal" },
            { rendered_body: "On it.", sender_staff_id: "staff-proof", channel: "internal" },
          ],
        };
      }
      return { ok: true, messages: [] };
    }
    if (call.path === "/api/chat/messages" && call.method === "POST") {
      const sent = JSON.parse(call.body || "{}");
      return { ok: true, conversation_id: sent.conversation_id || "conv-new" };
    }
    return undefined;
  };
}

async function openWidget(options = {}) {
  const page = await makePage(lab, { api: chatApi(options.state), ...options.page });
  await page.goto(`${lab.origin}${options.path || "/app/pipeline.html"}`, { waitUntil: "domcontentloaded" });
  await page.locator("#fh-chat-fab").waitFor({ state: "attached", timeout: 20_000 });
  return page;
}

test("chat widget: the Chat button opens a panel with Ask system, Knowledge and Message, Ask system first", { timeout: 60_000 }, async () => {
  const page = await openWidget();
  assert.equal(await page.locator("#fh-chat-fab").innerText(), "Chat");
  assert.equal(await page.locator("#fh-chat-panel").isVisible(), false);
  await page.locator("#fh-chat-fab").click();
  assert.equal(await page.locator("#fh-chat-panel").isVisible(), true);
  const modes = await page.locator("#fh-chat-modes .mode").evaluateAll((els) => els.map((e) => [e.textContent, e.classList.contains("on")]));
  assert.deepEqual(modes, [["Ask system", true], ["Knowledge", false], ["Message", false]]);
  assert.match(await words(page, "#fh-chat-body"), /^Ask how to use Fundhub/);
  await page.locator("#fh-chat-close").click();
  assert.equal(await page.locator("#fh-chat-panel").isVisible(), false);
  await page.close();
});

test("chat widget: Ask system and Knowledge send the question with the mode and show the answer and its sources", { timeout: 60_000 }, async () => {
  const page = await openWidget();
  await page.locator("#fh-chat-fab").click();
  await page.locator("#fh-chat-input").fill("how do I send a contract?");
  await page.locator("#fh-chat-send").click();
  await page.locator("#fh-chat-body .msg", { hasText: "Answer for system" }).waitFor();
  const first = callsTo(page, "/api/chat/ask", "POST");
  assert.equal(first.length, 1);
  assert.deepEqual(JSON.parse(first[0].body), { mode: "system", question: "how do I send a contract?" });
  assert.equal(first[0].headers.authorization, `Bearer ${TOKEN}`);
  const answer = page.locator("#fh-chat-body .msg", { hasText: "Answer for system" });
  assert.match(await words(answer, "span.src"), /^Sources: Send a contract · SOP 4$/);
  assert.equal(await answer.locator('a[href="documents.html#send"]').count(), 1);
  assert.equal(await page.locator("#fh-chat-input").inputValue(), "", "the box is cleared after sending");

  await page.locator('#fh-chat-modes [data-mode="knowledge"]').click();
  assert.match(await words(page, "#fh-chat-body"), /^Ask about company SOPs/);
  await page.locator("#fh-chat-input").fill("what is the refund rule?");
  await page.locator("#fh-chat-input").press("Enter");
  await page.locator("#fh-chat-body .msg", { hasText: "Answer for knowledge" }).waitFor();
  assert.deepEqual(JSON.parse(callsTo(page, "/api/chat/ask", "POST")[1].body), { mode: "knowledge", question: "what is the refund rule?" });
  await page.close();

  const down = await openWidget({ state: { askFails: true } });
  await down.locator("#fh-chat-fab").click();
  await down.locator("#fh-chat-input").fill("hello");
  await down.locator("#fh-chat-send").click();
  await down.locator("#fh-chat-body .msg", { hasText: "Could not answer (model_unavailable)." }).waitFor();
  await down.close();
});

test("chat widget: Message a teammate lists teammates, shows an existing thread, and sends into it or starts one", { timeout: 90_000 }, async () => {
  const page = await openWidget();
  await page.locator("#fh-chat-fab").click();
  await page.locator('#fh-chat-modes [data-mode="message"]').click();
  assert.equal(await page.locator("#fh-chat-hint").innerText(), "Internal — no quiet hours / TCPA gate.");
  await until(async () => (await page.locator("#fh-chat-peer option").count()) === 3, { message: "the teammates list" });
  assert.deepEqual(await page.locator("#fh-chat-peer option").allInnerTexts(), ["Pick a teammate…", "Dana Fox", "Ray Ortiz"]);

  // nobody picked yet: nothing is sent
  await page.locator("#fh-chat-input").fill("hello?");
  await page.locator("#fh-chat-send").click();
  await page.locator("#fh-chat-body .msg", { hasText: "Pick a teammate first." }).waitFor();
  assert.equal(callsTo(page, "/api/chat/messages", "POST").length, 0);

  // a teammate with an existing thread: the thread opens, mine on one side
  await page.locator("#fh-chat-peer").selectOption("peer-1");
  await page.locator("#fh-chat-body .msg.internal", { hasText: "Can you call the Whitfield file?" }).waitFor();
  assert.equal(await page.locator("#fh-chat-body .msg.me", { hasText: "On it." }).count(), 1);
  await page.locator("#fh-chat-input").fill("Done, called at 3.");
  await page.locator("#fh-chat-send").click();
  await until(() => callsTo(page, "/api/chat/messages", "POST").length === 1, { message: "the send" });
  assert.deepEqual(JSON.parse(callsTo(page, "/api/chat/messages", "POST")[0].body), { kind: "internal", body: "Done, called at 3.", conversation_id: "conv-1", peer_staff_id: "peer-1" });

  // a teammate with no thread yet: the send names the person
  await page.locator("#fh-chat-peer").selectOption("peer-2");
  await page.locator("#fh-chat-input").fill("First note to Ray.");
  await page.locator("#fh-chat-send").click();
  await until(() => callsTo(page, "/api/chat/messages", "POST").length === 2, { message: "the second send" });
  assert.deepEqual(JSON.parse(callsTo(page, "/api/chat/messages", "POST")[1].body), { kind: "internal", body: "First note to Ray.", peer_staff_id: "peer-2" });
  assert.equal(callsTo(page, "/api/chat/ask").length, 0, "a teammate message never asks the model");

  // Client mode names the compliance gate and asks for an id first
  await page.locator("#fh-chat-kind").selectOption("client");
  assert.equal(await page.locator("#fh-chat-hint").innerText(), "Client message — compliance gate applies.");
  await page.close();
});

test("chat widget: a partner and an affiliate are not offered it, a client gets only Message staff", { timeout: 90_000 }, async () => {
  for (const [role, path] of [["partner", "/app/partner-galaxy.html"], ["affiliate", "/app/affiliate.html"]]) {
    const page = await makePage(lab, { role });
    await page.goto(`${lab.origin}${path}`, { waitUntil: "domcontentloaded" });
    await page.locator("#fh-shell-chip").waitFor({ state: "attached", timeout: 20_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(await page.locator("#fh-chat-fab").count(), 0, `${role}: no chat button`);
    await page.close();
  }
  const client = await makePage(lab, { role: "client", api: chatApi() });
  await client.goto(`${lab.origin}/app/client-portal.html`, { waitUntil: "domcontentloaded" });
  await client.locator("#fh-chat-fab").waitFor({ state: "attached", timeout: 20_000 });
  await client.locator("#fh-chat-fab").click();
  assert.deepEqual(await client.locator("#fh-chat-modes .mode").allInnerTexts(), ["Message staff"]);
  await client.close();
});
