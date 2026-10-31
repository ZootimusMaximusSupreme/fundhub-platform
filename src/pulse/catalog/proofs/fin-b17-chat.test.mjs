// Batch 17 practice tests: the staff chat widget (public/app/chat-widget.js), four controls. The real script
// is loaded into a blank page in a real Chromium, mounted the way shell.js mounts it for staff, with fake
// /api answers. A second group loads real desk pages with the real shell.js and judges who gets the button
// and in which form. No live data, nothing leaves the browser.
//
//   Chat button and the close x     opens and closes the panel
//   Mode tabs                       Ask system / Knowledge / Message
//   Ask system / Knowledge          type a question, press Ask or Enter
//   Message > Staff (internal)      pick a teammate and send

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, waitFor } from "./fin-b17-kit.mjs";
import { asRole, bodyOf, json, OWNER, sharedScreens } from "./fin-b17-browser-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const BLANK = "/__fin_b17_blank.html";
const ME = OWNER.staff.id;
const PEER = "staff-2";
const PEER_NAME = "Casey Reed";
const PEER_2 = "staff-3";
const PEER_2_NAME = "Sam Rowe";

// A saved staff send carries an unpredictable idempotency key, which prevents
// duplicate sends after uncertain network outcomes. Still assert every other
// field, including the exact client/teammate, thread and message text.
function assertSendPayload(actual, expected, label) {
  assert.ok(typeof actual.idempotency_key === "string" && actual.idempotency_key.length >= 20, "a replay-safe send key is present");
  const { idempotency_key, ...fields } = actual;
  assert.deepEqual(fields, expected, label);
}

const blankPage = (page) => page.route(`**${BLANK}`, (route) => route.fulfill({
  status: 200, contentType: "text/html", body: "<!doctype html><html><head><title>blank</title></head><body></body></html>",
}));

/** The widget mounted for staff on a blank page. `calls` holds every /api request the widget makes. */
async function openWidget({ ask = null, peers = [{ id: PEER, name: PEER_NAME, email: "casey@example.test" }], clients = [], threads = [], thread = [], post = null, clock = false, url = BLANK, before = blankPage } = {}) {
  const calls = [];
  const handlers = {
    "/api/auth/session": async (route) => { calls.push("GET /api/auth/session"); return json(route, OWNER); },
    "/api/chat/ask": async (route) => {
      const body = bodyOf(route);
      calls.push({ post: "ask", body });
      return json(route, ask ? ask(body) : { ok: true, answer: { text: "Open the contract in Contracts and press Send." }, sources: [{ title: "How to send a contract", href: "/app/contracts.html" }, { title: "Contract SOP" }] });
    },
    "/api/chat/peers": async (route) => { calls.push("GET /api/chat/peers"); return json(route, { ok: true, staff: peers, clients }); },
    "/api/chat/messages": async (route, { url, method }) => {
      if (method === "POST") {
        const body = bodyOf(route);
        calls.push({ post: "messages", body });
        return json(route, post ? post(body) : { ok: true, kind: "internal", conversation_id: "conv-1", message: { id: "m-1" }, deduped: false });
      }
      const query = new URL(url).search;
      calls.push(`GET /api/chat/messages${query}`);
      if (query.includes("conversation_id=")) return json(route, { ok: true, messages: typeof thread === "function" ? thread() : thread });
      return json(route, { ok: true, kind: "internal", threads });
    },
  };
  const { page, errors } = await screens.open(url, { session: OWNER, handlers, before, clock });
  await page.addScriptTag({ url: "/app/chat-widget.js" });
  await page.evaluate(() => window.FHChat.mount({ portal: false, demo: false, hadCall: false, autoOpenPrecall: false }));
  const out = {
    page, errors, calls,
    posts: () => calls.filter((c) => typeof c === "object").map((c) => c.body),
    open: () => page.locator("#fh-chat-fab").click(),
    isOpen: () => page.locator("#fh-chat-panel").isVisible(),
    tabs: () => page.evaluate(() => [...document.querySelectorAll("#fh-chat-modes .mode")].map((b) => [b.textContent, b.classList.contains("on"), b.classList.contains("internal-hint")])),
    bubbles: () => page.evaluate(() => [...document.querySelectorAll("#fh-chat-body .msg")].map((m) => [m.className.replace("msg ", ""), m.textContent])),
    foot: () => page.evaluate(() => ({
      placeholder: document.getElementById("fh-chat-input")?.placeholder,
      send: document.getElementById("fh-chat-send")?.textContent,
      hint: document.getElementById("fh-chat-hint")?.textContent,
      kind: document.getElementById("fh-chat-kind")?.value ?? null,
    })),
    type: async (text) => { await page.locator("#fh-chat-input").fill(text); },
  };
  return out;
}

const mode = (w, label) => w.page.locator(`#fh-chat-modes .mode:text-is("${label}")`).click();

// ───────────────────────────── the chat button and the close x ─────────────────────────────

test("the Chat button opens and closes the panel and the close x closes it, with no request made", { timeout: 90_000 }, async () => {
  await proof.check(/^Chat button \(opens and closes the panel\) and close x/, async () => {
    const w = await openWidget();
    assert.equal(await w.page.locator("#fh-chat-fab").innerText(), "Chat");
    assert.equal(await w.page.locator("#fh-chat-fab").getAttribute("aria-label"), "Open chat");
    assert.equal(await w.isOpen(), false, "closed on first paint");

    await w.open();
    assert.equal(await w.isOpen(), true);
    assert.equal(await w.page.evaluate(() => document.activeElement && document.activeElement.id), "fh-chat-input", "the cursor is in the question box");
    assert.deepEqual((await w.tabs()).map((t) => t[0]), ["Ask system", "Knowledge", "Message"]);
    assert.match(await w.page.locator("#fh-chat-body").innerText(), /Ask how to use Fundhub/);

    await w.open();
    assert.equal(await w.isOpen(), false, "the same button closes it");
    await w.open();
    assert.equal(await w.isOpen(), true);
    await w.page.locator("#fh-chat-close").click();
    assert.equal(await w.isOpen(), false, "the close x closes it");
    assert.equal(await w.page.locator("#fh-chat-close").innerText(), "Close");

    // opening, closing and reopening asks the server nothing
    await w.open();
    await w.page.locator("#fh-chat-close").click();
    await w.open();
    assert.equal(await w.isOpen(), true);
    assert.deepEqual(w.calls, [], "no request was made by opening or closing");
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });
});

// ───────────────────────────── who gets the button: the real shell on real desk pages ─────────────────────────────

/** A real desk page with the real shell.js, signed in as `role`. Every /api answer is the test's own (the harness's defaults). */
async function openDesk(pathName, role) {
  const { page, errors } = await screens.open(pathName, { session: asRole(role), handlers: {} });
  return { page, errors };
}

test("shell.js puts the Chat button on every staff desk in its staff form, gives a client the portal form, and gives a partner or an affiliate none", { timeout: 180_000 }, async () => {
  await proof.check(/^Chat button \(opens and closes the panel\) and close x/, async () => {
    // staff: the button is drawn, closed on first paint, and the panel is the staff one (Ask system / Knowledge / Message)
    for (const [role, desk] of [
      ["owner", "/app/products-commissions.html"],
      ["admin", "/app/products-commissions.html"],
      ["sales_manager", "/app/products-commissions.html"],
      ["closer", "/app/closer-dashboard.html"],
    ]) {
      const { page, errors } = await openDesk(desk, role);
      await page.locator("#fh-chat-fab").waitFor({ state: "visible", timeout: 15_000 });
      assert.equal(await page.locator("#fh-chat-fab").innerText(), "Chat", `${role} has the Chat button on ${desk}`);
      assert.equal(await page.locator("#fh-chat-panel").isVisible(), false, `${role}: closed on first paint`);
      await page.locator("#fh-chat-fab").click();
      assert.equal(await page.locator("#fh-chat-panel").isVisible(), true, `${role}: the button opens it`);
      assert.deepEqual(
        await page.evaluate(() => [...document.querySelectorAll("#fh-chat-modes .mode")].map((b) => b.textContent)),
        ["Ask system", "Knowledge", "Message"],
        `${role}: the staff panel, not the client portal one`,
      );
      await page.locator("#fh-chat-close").click();
      assert.equal(await page.locator("#fh-chat-panel").isVisible(), false);
      assert.equal(await page.locator("#fh-chat-fab").count(), 1, `${role}: one button, not two`);
      assert.deepEqual(errors.filter((e) => /fh-chat|FHChat/.test(e)), []);
      await page.close();
    }

    // a client in the portal gets the portal form: one tab, Message staff
    const client = await openDesk("/app/client-portal.html", "client");
    await client.page.locator("#fh-chat-fab").waitFor({ state: "visible", timeout: 15_000 });
    await client.page.locator("#fh-chat-fab").click();
    assert.deepEqual(
      await client.page.evaluate(() => [...document.querySelectorAll("#fh-chat-modes .mode")].map((b) => b.textContent)),
      ["Message staff"],
      "a client sees only the portal message tab",
    );
    await client.page.close();

    // a partner and an affiliate get no widget at all: nothing is drawn, and the script is never even loaded
    for (const [role, desk] of [["partner", "/app/partner-galaxy.html"], ["affiliate", "/app/affiliate.html"]]) {
      const { page } = await openDesk(desk, role);
      await page.waitForFunction(() => document.documentElement.classList.contains("fh-page-access-confirmed"), null, { timeout: 15_000 });
      await page.waitForTimeout(1500);
      assert.equal(await page.locator("#fh-chat-fab").count(), 0, `${role} gets no Chat button`);
      assert.equal(await page.locator("#fh-chat-panel").count(), 0);
      assert.equal(await page.evaluate(() => typeof window.FHChat), "undefined", `${role}: the chat script was not loaded`);
      await page.close();
    }
  });
});

// ───────────────────────────── the three tabs ─────────────────────────────

test("the three mode tabs switch the panel's words, box and button, and ask nothing until Send", { timeout: 90_000 }, async () => {
  await proof.check(/^Mode tabs: Ask system \/ Knowledge \/ Message/, async () => {
    const w = await openWidget();
    await w.open();
    assert.deepEqual(await w.tabs(), [["Ask system", true, false], ["Knowledge", false, false], ["Message", false, true]]);
    assert.deepEqual(await w.foot(), { placeholder: "Ask a question…", send: "Ask", hint: "", kind: null });

    await mode(w, "Knowledge");
    assert.deepEqual(await w.tabs(), [["Ask system", false, false], ["Knowledge", true, false], ["Message", false, true]]);
    assert.match(await w.page.locator("#fh-chat-body").innerText(), /Ask about company SOPs, scripts, and Drive knowledge\. Same rules as Company Brain\./);
    assert.deepEqual(await w.foot(), { placeholder: "Ask a question…", send: "Ask", hint: "", kind: null });

    await mode(w, "Message");
    assert.deepEqual(await w.tabs(), [["Ask system", false, false], ["Knowledge", false, false], ["Message", true, true]]);
    assert.deepEqual(await w.foot(), { placeholder: "Type a message…", send: "Send", hint: "Internal — no quiet hours / TCPA gate.", kind: "internal" });
    assert.match(await w.page.locator("#fh-chat-body").innerText(), /Staff↔staff is blue and skips quiet-hours rules\. Staff↔client uses the real outbound path and compliance gate\./);
    assert.deepEqual(await w.page.evaluate(() => [...document.querySelectorAll("#fh-chat-kind option")].map((o) => o.textContent)), ["Staff (internal)", "Client"]);

    await mode(w, "Ask system");
    assert.match(await w.page.locator("#fh-chat-body").innerText(), /Ask how to use Fundhub/);
    assert.equal((await w.foot()).send, "Ask");

    // switching tabs sends nothing: the only read is the teammate list when Message opens
    assert.deepEqual(w.calls.filter((c) => typeof c === "object"), [], "no question or message was posted");
    assert.deepEqual(w.calls, ["GET /api/chat/peers"]);
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });
});

// ───────────────────────────── Ask system / Knowledge ─────────────────────────────

test("Ask and Enter send the question in the mode that is open, show the answer with its sources, and an empty box sends nothing", { timeout: 90_000 }, async () => {
  await proof.check(/^Ask system \/ Knowledge: type a question and press Ask or Enter/, async () => {
    const w = await openWidget();
    await w.open();

    // an empty box (or spaces) sends nothing
    await w.page.locator("#fh-chat-send").click();
    await w.type("   ");
    await w.page.locator("#fh-chat-input").press("Enter");
    assert.deepEqual(w.calls, []);

    // Ask system, by the button
    await w.type("how do I send a contract?");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 1, "the first question");
    assert.deepEqual(w.posts()[0], { mode: "system", question: "how do I send a contract?" });
    await waitFor(async () => (await w.bubbles()).length >= 3, "the answer");
    let bubbles = await w.bubbles();
    assert.deepEqual(bubbles.slice(-2).map((b) => b[0]), ["me", "them"]);
    assert.equal(bubbles.at(-2)[1], "how do I send a contract?");
    assert.match(bubbles.at(-1)[1], /^Open the contract in Contracts and press Send\.Sources: How to send a contract · Contract SOP$/);
    assert.equal(await w.page.locator("#fh-chat-body .msg a").getAttribute("href"), "/app/contracts.html", "a source with an address is a link");
    assert.equal(await w.page.locator("#fh-chat-input").inputValue(), "", "the box is emptied on send");

    // Knowledge, by Enter; Shift+Enter does not send
    await mode(w, "Knowledge");
    await w.type("what is the refund SOP?");
    await w.page.locator("#fh-chat-input").press("Shift+Enter");
    assert.equal(w.posts().length, 1, "Shift+Enter is not a send");
    await w.page.locator("#fh-chat-input").press("Enter");
    await waitFor(() => w.posts().length === 2, "the second question");
    assert.deepEqual(w.posts()[1], { mode: "knowledge", question: "what is the refund SOP?" });

    // an answer that failed says so in words
    const failing = await openWidget({ ask: () => ({ ok: false, error: "model_unavailable" }) });
    await failing.open();
    await failing.type("anything");
    await failing.page.locator("#fh-chat-send").click();
    await waitFor(async () => /Not confirmed \(model_unavailable\).*draft is kept/i.test(await failing.page.locator("#fh-chat-hint").innerText()), "the error words");
    assert.equal(await failing.page.locator("#fh-chat-input").inputValue(), "anything", "failed question remains editable");
    // an answer with no text says so, and no sources line is drawn when there are none
    const bare = await openWidget({ ask: () => ({ ok: true, answer: {}, sources: [] }) });
    await bare.open();
    await bare.type("anything");
    await bare.page.locator("#fh-chat-input").press("Enter");
    await waitFor(async () => (await bare.bubbles()).some((b) => b[1] === "No answer."), "No answer.");
    assert.equal(await bare.page.locator("#fh-chat-body .src").count(), 0);
    for (const x of [w, failing, bare]) assert.deepEqual(x.errors, []);
    await Promise.all([w, failing, bare].map((x) => x.page.close()));
  });
});

// ───────────────────────────── Message > Staff (internal) ─────────────────────────────

test("Message to staff: pick a teammate, send, and the thread opens; a second send continues the same thread", { timeout: 120_000 }, async () => {
  await proof.check(/^Message > Staff \(internal\): pick a teammate and send/, async () => {
    const thread = [];
    const w = await openWidget({
      thread: () => thread,
      post: (body) => {
        thread.push({ id: `m-${thread.length + 1}`, direction: "outbound", channel: "internal", rendered_body: body.body, sender_staff_id: ME, sender_kind: "staff" });
        return { ok: true, kind: "internal", conversation_id: "conv-1", message: { id: `m-${thread.length}` }, deduped: false };
      },
    });
    await w.open();
    await mode(w, "Message");
    await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 2, "the teammate list");
    assert.deepEqual(await w.page.evaluate(() => [...document.querySelectorAll("#fh-chat-peer option")].map((o) => [o.value, o.textContent])),
      [["", "Pick a teammate…"], [PEER, PEER_NAME]]);
    assert.ok(w.calls.includes("GET /api/chat/peers"));

    // no teammate picked: it says so and sends nothing
    await w.type("Are you on the 3pm?");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(async () => /Pick a teammate first.*not been sent/i.test(await w.page.locator("#fh-chat-hint").innerText()), "the pick-first line");
    assert.equal(await w.page.locator("#fh-chat-input").inputValue(), "Are you on the 3pm?", "unsent draft remains");
    assert.deepEqual(w.posts(), []);

    // pick the teammate: the widget looks for an existing thread with them
    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await waitFor(() => w.calls.includes("GET /api/chat/messages?kind=internal"), "the thread lookup");
    await w.type("Are you on the 3pm?");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 1, "the first message");
    assertSendPayload(w.posts()[0], { kind: "internal", body: "Are you on the 3pm?", peer_staff_id: PEER }, "a first message names the teammate, not a thread");
    await waitFor(() => w.calls.includes("GET /api/chat/messages?conversation_id=conv-1"), "the thread read");
    await waitFor(async () => (await w.bubbles()).some((b) => b[1] === "Are you on the 3pm?" && b[0] === "me"), "my bubble");

    // the second message goes to the same thread by its id
    await w.type("Great, see you there.");
    await w.page.locator("#fh-chat-input").press("Enter");
    await waitFor(() => w.posts().length === 2, "the second message");
    assertSendPayload(w.posts()[1], { kind: "internal", body: "Great, see you there.", conversation_id: "conv-1", peer_staff_id: PEER }, "the thread and the teammate it is with ride together, so the server can refuse a mismatch");
    await waitFor(async () => (await w.bubbles()).filter((b) => b[0] === "me").length === 2, "both bubbles");
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  await proof.check(/^Message > Staff \(internal\): pick a teammate and send/, async () => {
    // A thread that already exists with the picked teammate is opened with its messages: mine on the right, theirs as internal.
    const w = await openWidget({
      // the thread with someone else is listed first: the widget must pick the one that has the picked teammate
      threads: [{ id: "conv-8", kind: "internal", participants: [{ id: ME, name: "Jordan Blake" }, { id: "staff-3", name: "Someone Else" }] },
        { id: "conv-9", kind: "internal", participants: [{ id: ME, name: "Jordan Blake" }, { id: PEER, name: PEER_NAME }] }],
      thread: [
        { id: "m-1", direction: "outbound", channel: "internal", rendered_body: "Morning.", sender_staff_id: ME },
        { id: "m-2", direction: "outbound", channel: "internal", rendered_body: "Morning! Call at 3.", sender_staff_id: PEER },
      ],
    });
    await w.open();
    await mode(w, "Message");
    await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 2, "the teammate list");
    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await waitFor(() => w.calls.includes("GET /api/chat/messages?conversation_id=conv-9"), "the right thread was read");
    assert.ok(!w.calls.includes("GET /api/chat/messages?conversation_id=conv-8"), "not the thread with someone else");
    await waitFor(async () => (await w.bubbles()).length === 2, "two bubbles");
    assert.deepEqual(await w.bubbles(), [["me", "Morning."], ["internal", "Morning! Call at 3."]]);
    // a send into that thread carries its id
    await w.type("Yes.");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 1, "the send");
    assertSendPayload(w.posts()[0], { kind: "internal", body: "Yes.", conversation_id: "conv-9", peer_staff_id: PEER });
    await w.page.close();
  });

  await proof.check(/^Message > Staff \(internal\): pick a teammate and send/, async () => {
    // Pick one teammate and send, then pick another: the next message goes to the second person. It must not
    // ride into the first person's thread because the widget still held its id.
    const w = await openWidget({
      peers: [{ id: PEER, name: PEER_NAME }, { id: PEER_2, name: PEER_2_NAME }],
      post: (body) => ({ ok: true, kind: "internal", conversation_id: body.peer_staff_id === PEER ? "conv-casey" : "conv-sam", message: { id: "m-x" }, deduped: false }),
    });
    await w.open();
    await mode(w, "Message");
    await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 3, "the teammate list");

    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await w.type("Casey: are you on the 3pm?");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 1, "the first message");
    assertSendPayload(w.posts()[0], { kind: "internal", body: "Casey: are you on the 3pm?", peer_staff_id: PEER });
    await waitFor(() => w.calls.includes("GET /api/chat/messages?conversation_id=conv-casey"), "Casey's thread was opened");

    // a different teammate: the message names that person and carries no thread id from the first
    await w.page.locator("#fh-chat-peer").selectOption(PEER_2);
    await waitFor(() => w.calls.filter((c) => c === "GET /api/chat/messages?kind=internal").length === 2, "the thread lookup for the second teammate");
    await w.type("Sam: can you cover Friday?");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 2, "the second message");
    assertSendPayload(w.posts()[1], { kind: "internal", body: "Sam: can you cover Friday?", peer_staff_id: PEER_2 }, "the second message goes to the second teammate, not into the first thread");

    // and back to the first: Sam's thread id is not carried either
    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await waitFor(() => w.calls.filter((c) => c === "GET /api/chat/messages?kind=internal").length === 3, "the thread lookup back to the first teammate");
    await w.type("Casey: thanks.");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(() => w.posts().length === 3, "the third message");
    assertSendPayload(w.posts()[2], { kind: "internal", body: "Casey: thanks.", peer_staff_id: PEER });
    assert.deepEqual(w.errors, []);
    await w.page.close();
  });

  await proof.check(/^Message > Staff \(internal\): pick a teammate and send/, async () => {
    // A send the server refused says so in words, and the thread is not marked as started.
    const w = await openWidget({ post: () => ({ ok: false, error: "forbidden" }) });
    await w.open();
    await mode(w, "Message");
    await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 2, "the teammate list");
    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await w.type("hello");
    await w.page.locator("#fh-chat-send").click();
    await waitFor(async () => /Not confirmed \(forbidden\).*draft is kept/i.test(await w.page.locator("#fh-chat-hint").innerText()), "the refusal words");
    assert.equal(await w.page.locator("#fh-chat-input").inputValue(), "hello", "server refusal preserves the draft");
    assert.equal(w.calls.filter((c) => typeof c === "string" && c.includes("conversation_id=")).length, 0, "no thread was read after a refused send");
    await w.page.close();
  });
});

test("an open internal thread is read again every 4 seconds, and a closed panel stops reading", { timeout: 120_000 }, async () => {
  await proof.check(/^Message > Staff \(internal\): pick a teammate and send/, async () => {
    const w = await openWidget({
      clock: true,
      threads: [{ id: "conv-9", kind: "internal", participants: [{ id: ME, name: "Jordan Blake" }, { id: PEER, name: PEER_NAME }] }],
      thread: [{ id: "m-1", direction: "outbound", channel: "internal", rendered_body: "Morning.", sender_staff_id: ME }],
    });
    const reads = () => w.calls.filter((c) => c === "GET /api/chat/messages?conversation_id=conv-9").length;
    await w.open();
    await mode(w, "Message");
    await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 2, "the teammate list");
    await w.page.locator("#fh-chat-peer").selectOption(PEER);
    await waitFor(() => reads() === 1, "the first thread read");
    await w.page.clock.fastForward(4100);
    await waitFor(() => reads() === 2, "the first poll");
    await w.page.clock.fastForward(4100);
    await waitFor(() => reads() === 3, "the second poll");
    // closed: the clock moves and nothing is read
    await w.page.locator("#fh-chat-close").click();
    await w.page.clock.fastForward(13000);
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(reads(), 3, "a closed panel does not poll");
    await w.page.close();
  });
});

// ───────────────────────────── Message > Client: your own clients, and only the picked one ─────────────────────────────

const CLIENT_A = "c1000000-0000-4000-8000-0000000000a1";
const CLIENT_B = "c1000000-0000-4000-8000-0000000000b2";
const PAGE_CLIENT = "c1000000-0000-4000-8000-0000000000c3";
const MY_CLIENTS = [{ id: CLIENT_A, name: "Ana Diaz", client_code: "FH-000901" }, { id: CLIENT_B, name: "Ben Ito", client_code: null }];
const clientMode = async (w) => {
  await w.open();
  await mode(w, "Message");
  await w.page.locator("#fh-chat-kind").selectOption("client");
  await waitFor(async () => (await w.page.locator("#fh-chat-client option").count()) >= 2, "the client list");
};

test("Message > Client lists the clients assigned to you, and each text goes to the client on the picker and no one else", { timeout: 120_000 }, async () => {
  const w = await openWidget({
    clients: MY_CLIENTS,
    post: (body) => ({ ok: true, kind: "client", conversation_id: `conv-${body.client_id}`, outcome: "queued" }),
  });
  await clientMode(w);
  assert.deepEqual(await w.page.locator("#fh-chat-client option").allInnerTexts(), ["Pick one of your clients…", "Ana Diaz (FH-000901)", "Ben Ito"]);
  assert.equal(await w.page.locator("#fh-chat-client").evaluate((el) => el.tagName), "SELECT", "a list, not a box to paste an id into");

  // nobody picked: nothing is sent
  await w.type("Hi there");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(async () => /Pick one of your clients first.*not been sent/i.test(await w.page.locator("#fh-chat-hint").innerText()), "the pick-client line");
  assert.equal(w.posts().length, 0);

  // Ana, then Ben: the second text names Ben only and carries no thread from Ana
  await w.page.locator("#fh-chat-client").selectOption(CLIENT_A);
  await w.type("Ana: your call is at 3.");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(() => w.posts().length === 1, "the first text");
  assertSendPayload(w.posts()[0], { kind: "client", body: "Ana: your call is at 3.", client_id: CLIENT_A, channel: "sms" });
  await w.page.locator("#fh-chat-client").selectOption(CLIENT_B);
  await w.type("Ben: can we move to 4?");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(() => w.posts().length === 2, "the second text");
  assertSendPayload(w.posts()[1], { kind: "client", body: "Ben: can we move to 4?", client_id: CLIENT_B, channel: "sms" }, "Ben's text never rides Ana's thread");
  assert.deepEqual(w.errors, []);
  await w.page.close();
});

test("Message > Client says so when no client is assigned to you, and offers the client open on this page", { timeout: 120_000 }, async () => {
  const none = await openWidget({ clients: [] });
  await none.open();
  await mode(none, "Message");
  await none.page.locator("#fh-chat-kind").selectOption("client");
  await waitFor(async () => (await none.page.locator("#fh-chat-client option").allInnerTexts()).includes("No clients are assigned to you yet"), "the empty list");
  await none.page.close();

  const routeBlank = (page) => page.route(/__fin_b17_blank\.html/, (route) => route.fulfill({
    status: 200, contentType: "text/html", body: "<!doctype html><html><head><title>blank</title></head><body></body></html>",
  }));
  const w = await openWidget({ clients: MY_CLIENTS, url: `${BLANK}?client_id=${PAGE_CLIENT}`, before: routeBlank });
  await clientMode(w);
  assert.deepEqual(await w.page.locator("#fh-chat-client option").allInnerTexts(),
    ["Pick one of your clients…", "The client open on this page", "Ana Diaz (FH-000901)", "Ben Ito"]);
  assert.equal(await w.page.locator("#fh-chat-client").inputValue(), PAGE_CLIENT, "the page's client is picked to start");
  await w.type("Hello from your file.");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(() => w.posts().length === 1, "the text");
  assertSendPayload(w.posts()[0], { kind: "client", body: "Hello from your file.", client_id: PAGE_CLIENT, channel: "sms" });
  await w.page.close();
});

test("a slow answer to the note for the last teammate never sets the thread for the teammate picked now", { timeout: 120_000 }, async () => {
  // The note to Casey is answered late; Sam is picked before the answer lands. The next note, to Sam, must not
  // carry Casey's thread (it used to: the late answer set the widget's thread to Casey's).
  let releaseCasey;
  const caseyGate = new Promise((resolve) => { releaseCasey = resolve; });
  const w = await openWidget({ peers: [{ id: PEER, name: PEER_NAME }, { id: PEER_2, name: PEER_2_NAME }] });
  const sent = [];
  await w.page.route(/\/api\/chat\/messages$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = JSON.parse(route.request().postData() || "{}");
    sent.push(body);
    if (sent.length === 1) await caseyGate;
    return json(route, { ok: true, kind: "internal", conversation_id: body.peer_staff_id === PEER_2 ? "conv-sam" : "conv-casey", message: { id: "m-x" }, deduped: false });
  });
  await w.open();
  await mode(w, "Message");
  await waitFor(async () => (await w.page.locator("#fh-chat-peer option").count()) === 3, "the teammate list");
  await w.page.locator("#fh-chat-peer").selectOption(PEER);
  await w.type("Casey: are you on the 3pm?");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(() => sent.length === 1, "Casey's note is on its way");
  await w.page.locator("#fh-chat-peer").selectOption(PEER_2);
  releaseCasey();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await w.type("Sam: can you cover Friday?");
  await w.page.locator("#fh-chat-send").click();
  await waitFor(() => sent.length === 2, "Sam's note");
  assertSendPayload(sent[1], { kind: "internal", body: "Sam: can you cover Friday?", peer_staff_id: PEER_2 }, "no thread id from Casey");
  await w.page.close();
});

test("every listed row was exercised", () => {
  assert.equal(proof.rows.length, 4);
  proof.assertAllClaimed();
});
