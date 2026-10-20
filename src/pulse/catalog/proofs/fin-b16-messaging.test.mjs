// Batch 16 practice tests: the staff reply inbox (public/app/messaging.html) in a real Chromium with fake
// /api answers (no live data, nothing sent).
//
//   the two tabs and the search box          what each asks the server for, and what it paints
//   the Email / Text toggle                  opens that client's other-channel conversation, or an empty one
//   the compose box                          Enter sends, Shift+Enter is a new line, the texting-hours notice
//   the "Send this one to" box               filled from the record, sent for one message, never written back
//   deep links                               ?client_id= ?channel= ?conversation_id=
//   the right panel                          other threads, Their file link
//   the Reference key (who-sent-it colours)  is visible, opens and closes by a real click; its three colours
//                                            are the three ways the thread paints a message

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, proofRows, sharedScreens, waitFor } from "./fin-b16-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const CLOSER = { ok: true, staff: { id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } };
const init = () => { localStorage.setItem("fh_role", "closer"); };

const DANA_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const MARCUS_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const DANA_SMS = "11111111-1111-4111-8111-111111111111";
const DANA_EMAIL = "22222222-2222-4222-8222-222222222222";
const MARCUS_EMAIL = "33333333-3333-4333-8333-333333333333";

const base = { summary: null, sentiment: null, created_at: "2026-10-01T10:00:00Z" };
const CONVOS = {
  [DANA_SMS]: { ...base, id: DANA_SMS, client_id: DANA_ID, channel: "sms", first_name: "Dana", last_name: "Whitfield",
    last_body: "any update on my file?", last_direction: "inbound", needs_reply: true, last_at: "2026-10-13T11:50:00Z", last_pulse_at: "2026-10-13T11:50:00Z" },
  [DANA_EMAIL]: { ...base, id: DANA_EMAIL, client_id: DANA_ID, channel: "email", first_name: "Dana", last_name: "Whitfield",
    last_body: "Your documents are attached.", last_direction: "outbound", needs_reply: false, last_at: "2026-10-12T09:00:00Z", last_pulse_at: "2026-10-12T09:00:00Z" },
  [MARCUS_EMAIL]: { ...base, id: MARCUS_EMAIL, client_id: MARCUS_ID, channel: "email", first_name: "Marcus", last_name: "Okoye",
    last_body: "Thanks, got it.", last_direction: "inbound", needs_reply: false, last_at: "2026-10-13T08:00:00Z", last_pulse_at: "2026-10-13T08:00:00Z" },
};
const CLIENTS = {
  [DANA_ID]: { id: DANA_ID, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+15550100001", custom_fields: {} },
  [MARCUS_ID]: { id: MARCUS_ID, first_name: "Marcus", last_name: "Okoye", email: "marcus@example.com", phone: "+15550100002", custom_fields: {} },
};
const THREADS = {
  [DANA_SMS]: [{ id: "m-s2", conversation_id: DANA_SMS, client_id: DANA_ID, direction: "outbound", channel: "sms", rendered_body: "looking now, one moment", subject: null, status: "sent", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: "staff-1", sender_name: "Jordan Blake", created_at: "2026-10-13T11:55:00Z" },
    { id: "m-s1", conversation_id: DANA_SMS, client_id: DANA_ID, direction: "inbound", channel: "sms", rendered_body: "any update on my file?", subject: null, status: "received", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: "2026-10-13T11:50:00Z" }],
  [DANA_EMAIL]: [{ id: "m-e1", conversation_id: DANA_EMAIL, client_id: DANA_ID, direction: "outbound", channel: "email", rendered_body: "Your documents are attached.", subject: "Documents", status: "sent", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: "staff-1", sender_name: "Jordan Blake", created_at: "2026-10-12T09:00:00Z" }],
  [MARCUS_EMAIL]: [{ id: "m-m1", conversation_id: MARCUS_EMAIL, client_id: MARCUS_ID, direction: "inbound", channel: "email", rendered_body: "Thanks, got it.", subject: "Re: Plan", status: "received", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: "2026-10-13T08:00:00Z" }],
};
const page_of = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });

/** The fake server: every read is logged, every write is kept, nothing leaves the test. */
function inboxApi({ inbox = null, sendOutcome = "sent" } = {}) {
  const log = { inbox: [], messages: [], conversations: [], client: [], posts: [], writes: [] };
  const handlers = {
    "/api/read/inbox": async (route, { url }) => {
      const query = new URL(url).search;
      log.inbox.push(query);
      if (inbox) {
        const out = inbox(query);
        return json(route, Array.isArray(out) ? page_of(out) : out);
      }
      const owed = new URLSearchParams(query).get("needs_reply") === "1";
      const rows = [CONVOS[DANA_SMS], CONVOS[MARCUS_EMAIL]];
      return json(route, page_of(owed ? rows.filter((r) => r.needs_reply) : rows));
    },
    "/api/read/messages": async (route, { url }) => {
      const id = new URL(url).searchParams.get("conversation_id");
      log.messages.push(id);
      return json(route, page_of(THREADS[id] || []));
    },
    "/api/read/conversations": async (route, { url }) => {
      const clientId = new URL(url).searchParams.get("client_id");
      log.conversations.push(clientId);
      return json(route, page_of(Object.values(CONVOS).filter((c) => c.client_id === clientId)));
    },
    "/api/dashboard/client?id=": async (route, { url }) => {
      const id = new URL(url).searchParams.get("id");
      log.client.push(id);
      return json(route, { ok: true, client: CLIENTS[id] || { id }, transactions: [], crs_results: [], messages: [], tasks: [] });
    },
    "/api/messages": async (route, { method }) => {
      if (method !== "POST") return json(route, { ok: true });
      const body = bodyOf(route);
      log.posts.push(body);
      return json(route, { ok: true, deduped: false, outcome: sendOutcome, message: { id: "new-msg", status: "sent" }, detail: null });
    },
  };
  // Anything but a GET to some other address is a write the page should never make from here.
  const watch = (page) => page.on("request", (request) => {
    if (request.method() !== "GET" && !/\/api\/messages$/.test(new URL(request.url()).pathname)) {
      log.writes.push(`${request.method()} ${new URL(request.url()).pathname}`);
    }
  });
  return { log, handlers, watch };
}

async function openInbox(query = "", { api = inboxApi(), at = null, wait = ".convo" } = {}) {
  const before = async (page) => {
    api.watch(page);
    if (at) {
      // Fixed, not just started there: a slow machine must not drift past 8:00pm or 8:00am mid-test.
      await page.clock.install({ time: new Date(at) });
      await page.clock.setFixedTime(new Date(at));
    }
  };
  const opened = await screens.open(`/app/messaging.html${query}`, { session: CLOSER, handlers: api.handlers, init, before });
  if (wait) await opened.page.waitForSelector(wait);
  return { ...opened, api, log: api.log };
}
const list = (page) => page.locator(".convo").allInnerTexts();
const names = async (page) => (await page.locator(".convo .cv-name").allInnerTexts()).map((t) => t.trim());
const thread = (page) => page.locator("#thread .msg").allInnerTexts();
const opened = (page, name) => page.waitForFunction((n) => document.querySelector("#thName")?.textContent === n, name);

// 15:00 in Arizona (UTC-7) and 23:00 in Arizona.
const DAYTIME = "2026-10-13T22:00:00Z";
const NIGHT = "2026-10-14T06:00:00Z";

test("the two tabs ask the server for different lists, and an empty Needs reply says so as good news", { timeout: 90_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    const empty = inboxApi({ inbox: () => [] });
    const { page, log, errors } = await openInbox("", { api: empty, wait: "#convoEmpty" });
    await waitFor(() => log.inbox.length >= 1);
    assert.deepEqual(log.inbox, ["?limit=200&needs_reply=1"], "the first read asks only for threads owed a reply");
    assert.match(await page.locator(".ctab.active").innerText(), /Needs reply/);
    assert.match(await page.locator("#convoList").innerText(), /Nothing is waiting on a reply\. Everything has been answered\./);
    assert.equal(await page.locator("#nReply").innerText(), "0");
    await page.close();

    const full = await openInbox("");
    assert.deepEqual(full.log.inbox, ["?limit=200&needs_reply=1"]);
    assert.deepEqual(await names(full.page), ["Dana Whitfield"], "only the thread owed a reply is listed");
    assert.match(await full.page.locator(".convo").first().innerText(), /waiting on us/i);
    assert.equal(await full.page.locator("#nReply").innerText(), "1");
    assert.deepEqual(errors, []);
    await full.page.close();
  });

  await proof.check(/^Tab: All$/, async () => {
    const { page, log } = await openInbox("");
    await page.locator('.ctab[data-filter="all"]').click();
    await waitFor(() => log.inbox.length === 2);
    assert.equal(log.inbox[1], "?limit=200", "All asks for every thread, with no needs_reply");
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    assert.deepEqual((await names(page)).sort(), ["Dana Whitfield", "Marcus Okoye"]);
    assert.equal(await page.locator("#nAll").innerText(), "2");
    assert.equal(await page.locator("#nReply").innerText(), "1");
    assert.match(await page.locator(".ctab.active").innerText(), /^All/);
    await page.locator('.ctab[data-filter="reply"]').click();
    await waitFor(() => log.inbox.length === 3);
    assert.equal(log.inbox[2], "?limit=200&needs_reply=1", "and Needs reply asks again with it");
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 1);
    await page.close();
  });
});

test("the search box filters the loaded threads, and typing on Needs reply stops asking for only the owed ones", { timeout: 90_000 }, async () => {
  await proof.check(/^Search box: search people and messages/, async () => {
    const { page, log, errors } = await openInbox("");
    assert.deepEqual(await names(page), ["Dana Whitfield"]);
    // Typing a name that is NOT owed a reply: the server is asked again without needs_reply (crossing empty -> typed).
    await page.locator("#q").fill("marcus");
    await waitFor(() => log.inbox.length === 2);
    assert.equal(log.inbox[1], "?limit=200", "a search looks at every thread, not only the owed ones");
    await page.waitForFunction(() => [...document.querySelectorAll(".convo .cv-name")].map((n) => n.textContent.trim()).join() === "Marcus Okoye");
    assert.match(await page.locator("#convoList").innerText(), /Searching everyone, not just Needs reply\./);
    // The match is on the name, the words of the last message, and the channel.
    await page.locator("#q").fill("thanks, got");
    assert.deepEqual(await names(page), ["Marcus Okoye"]);
    await page.locator("#q").fill("sms");
    assert.deepEqual(await names(page), ["Dana Whitfield"]);
    await page.locator("#q").fill("zzzz");
    assert.match(await page.locator("#convoList").innerText(), /Nothing matches what you typed\./);
    assert.equal(log.inbox.length, 2, "more letters are not more requests");
    // Emptying the box puts the tab back in charge, and asks for the owed ones again.
    await page.locator("#q").fill("");
    await waitFor(() => log.inbox.length === 3);
    assert.equal(log.inbox[2], "?limit=200&needs_reply=1");
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 1);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the Email / Text toggle opens the other conversation of the same person, or an empty one", { timeout: 90_000 }, async () => {
  await proof.check(/^Channel toggle: Email \/ Text buttons/, async () => {
    const { page, log, errors } = await openInbox("");
    assert.equal(await page.locator("#composeChannelToggle").evaluate((n) => n.hidden), true, "no toggle before a thread is open");
    assert.equal(await page.locator("#chEmail").isDisabled() && await page.locator("#chText").isDisabled(), true, "and neither button works");
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    await waitFor(() => log.messages.includes(DANA_SMS));
    assert.equal(await page.locator("#composeChannelToggle").isVisible(), true);
    assert.equal(await page.locator("#chText").evaluate((b) => b.classList.contains("active")), true);
    assert.equal(await page.locator("#chEmail").evaluate((b) => b.classList.contains("active")), false);
    assert.match(await page.locator("#thSub").innerText(), /^SMS/);

    await page.locator("#chEmail").click();
    await page.waitForFunction(() => document.querySelector("#thSub")?.textContent.startsWith("EMAIL"));
    await waitFor(() => log.messages.includes(DANA_EMAIL));
    assert.equal(await page.locator("#chEmail").evaluate((b) => b.classList.contains("active")), true);
    assert.equal(await page.locator("#chText").evaluate((b) => b.classList.contains("active")), false);
    assert.ok(log.conversations.includes(DANA_ID), "it asks for this client's own conversations");
    assert.deepEqual((await thread(page)).length, 1);
    assert.match((await thread(page))[0], /Your documents are attached\./);
    assert.equal(await page.locator("#composeTo").getAttribute("placeholder"), "name@example.com");

    // Back to Text, then a person with no text thread at all: an empty conversation, not a wrong one.
    await page.locator("#chText").click();
    await page.waitForFunction(() => document.querySelector("#thSub")?.textContent.startsWith("SMS"));
    await page.locator('.ctab[data-filter="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    await page.locator('.convo:has-text("Marcus")').click();
    await opened(page, "Marcus Okoye");
    await page.locator("#chText").click();
    await page.waitForFunction(() => /no thread yet/.test(document.querySelector("#thSub")?.textContent || ""));
    assert.match(await page.locator("#thSub").innerText(), /^SMS · no thread yet/);
    assert.match(await page.locator("#thread").innerText(), /No texts with them yet\. Your reply below would be the first\./);
    assert.equal(await page.locator("#composeBody").isEnabled(), true, "a first message can still be written");
    assert.equal(await page.locator("#composeTo").getAttribute("placeholder"), "+15551234567");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("the compose box: Enter sends, Shift+Enter is a new line, and the texting-hours notice shows before anything is typed", { timeout: 90_000 }, async () => {
  await proof.check(/^Compose box: type reply, Enter sends/, async () => {
    const api = inboxApi();
    const { page, log, errors } = await openInbox("", { api, at: DAYTIME });
    assert.equal(await page.locator("#composeBody").isDisabled(), true, "the compose box is dead until a thread is open");
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    // The rule is stated before a letter is typed.
    assert.equal(await page.locator("#composeBody").inputValue(), "");
    assert.match(await page.locator("#quietNote").innerText(), /Texting hours: 8:00am to 8:00pm Arizona time\. Outside those hours a text is held and sent the next morning\./);
    assert.equal(await page.locator("#quietNote").evaluate((n) => n.classList.contains("closed")), false);

    // Shift+Enter is a new line and sends nothing.
    await page.locator("#composeBody").click();
    await page.keyboard.type("line one");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("line two");
    assert.equal(await page.locator("#composeBody").inputValue(), "line one\nline two");
    assert.equal(log.posts.length, 0, "Shift+Enter does not send");

    // Enter sends exactly what was typed, to the open thread, with a key that makes a double press one message.
    await page.keyboard.press("Enter");
    await waitFor(() => log.posts.length === 1);
    assert.equal(log.posts[0].body, "line one\nline two");
    assert.equal(log.posts[0].conversation_id, DANA_SMS);
    assert.match(log.posts[0].idempotency_key, new RegExp(`^inbox-${DANA_SMS}-`));
    await page.waitForFunction(() => document.querySelector("#sendStatus")?.textContent === "Sent.");
    assert.equal(await page.locator("#composeBody").inputValue(), "", "a sent message leaves the box empty");
    assert.equal(log.posts.length, 1, "one press, one message");
    await page.close();

    // After 8:00pm the notice says it will not go out now, and when it will.
    const night = await openInbox("", { api: inboxApi(), at: NIGHT });
    await night.page.locator(".convo").first().click();
    await opened(night.page, "Dana Whitfield");
    assert.match(await night.page.locator("#quietNote").innerText(), /Texting hours are closed\. Anything you send now is saved and goes out automatically at 8:00am Arizona time/);
    assert.equal(await night.page.locator("#quietNote").evaluate((n) => n.classList.contains("closed")), true);
    // An email thread has no such rule, so it says nothing.
    await night.page.locator("#chEmail").click();
    await night.page.waitForFunction(() => document.querySelector("#thSub")?.textContent.startsWith("EMAIL"));
    assert.equal(await night.page.locator("#quietNote").isHidden(), true);
    assert.deepEqual(errors, []);
    await night.page.close();
  });
});

test("Send this one to: filled from the record, sent for this message only, and never written back to the client", { timeout: 90_000 }, async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    const api = inboxApi();
    const { page, log, errors } = await openInbox("", { api, at: DAYTIME });
    assert.equal(await page.locator("#composeTo").isDisabled(), true, "no box until a thread is open");
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    await page.waitForFunction(() => document.querySelector("#composeTo")?.value === "+15550100001");
    assert.equal(await page.locator("#composeTo").inputValue(), "+15550100001", "the box starts as the number on the client's record");

    // A malformed address is caught before anything is written, and Send stays off.
    await page.locator("#composeTo").fill("555-0100");
    await page.locator("#composeBody").fill("hello");
    assert.equal(await page.locator("#sendBtn").isDisabled(), true);
    assert.equal(await page.locator("#composeToNote").isVisible(), true);
    assert.match(await page.locator("#composeToNote").innerText(), /full number with the country code/);
    assert.equal(log.posts.length, 0);

    // A good number typed over it goes on this one message.
    await page.locator("#composeTo").fill("+15550109999");
    assert.equal(await page.locator("#sendBtn").isEnabled(), true);
    await page.locator("#sendBtn").click();
    await waitFor(() => log.posts.length === 1);
    assert.equal(log.posts[0].to, "+15550109999");
    assert.equal(log.posts[0].body, "hello");
    await page.waitForFunction(() => document.querySelector("#sendStatus")?.textContent === "Sent.");
    // The page never writes anywhere but the message, so the client record is untouched.
    assert.deepEqual(log.writes, [], "nothing but POST /api/messages was written");
    // The next message opens from the record again: the typed number was for the one message.
    await page.locator(".convo").first().click();
    await page.waitForFunction(() => document.querySelector("#composeTo")?.value === "+15550100001");
    await page.locator("#composeBody").fill("and another");
    await page.locator("#sendBtn").click();
    await waitFor(() => log.posts.length === 2);
    assert.equal(log.posts[1].to, "+15550100001", "the on-file number is what goes the next time");

    // Emptied, the box sends nothing for `to` at all: the server uses the record.
    await page.waitForFunction(() => document.querySelector("#composeTo")?.value === "+15550100001" && !document.querySelector("#sendBtn")?.disabled);
    await page.locator("#composeTo").fill("");
    await page.locator("#composeBody").fill("third");
    assert.equal(await page.locator("#sendBtn").isEnabled(), true, "an empty box does not stop a send");
    await page.locator("#sendBtn").click();
    await waitFor(() => log.posts.length === 3);
    assert.equal("to" in log.posts[2], false);
    assert.deepEqual(log.writes, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("deep links open the named client's thread, on the named channel, or one conversation by id", { timeout: 120_000 }, async () => {
  await proof.check(/^Deep links:/, async () => {
    // ?client_id= alone opens their text thread.
    const bySms = await openInbox(`?client_id=${DANA_ID}`, { wait: null });
    await opened(bySms.page, "Dana Whitfield");
    await waitFor(() => bySms.log.messages.includes(DANA_SMS));
    assert.match(await bySms.page.locator("#thSub").innerText(), /^SMS/);
    assert.ok(bySms.log.conversations.includes(DANA_ID) && bySms.log.client.includes(DANA_ID), "it reads that client's threads and record");
    await bySms.page.close();

    // ?channel=email picks their email thread.
    const email = await openInbox(`?client_id=${DANA_ID}&channel=email`, { wait: null });
    await opened(email.page, "Dana Whitfield");
    await waitFor(() => email.log.messages.includes(DANA_EMAIL));
    assert.match(await email.page.locator("#thSub").innerText(), /^EMAIL/);
    assert.match((await thread(email.page)).join(" "), /Your documents are attached\./);
    await email.page.close();

    // A channel they have no thread on opens an empty one, never another channel's.
    const none = await openInbox(`?client_id=${MARCUS_ID}&channel=sms`, { wait: null });
    await opened(none.page, "Marcus Okoye");
    await none.page.waitForFunction(() => /no thread yet/.test(document.querySelector("#thSub")?.textContent || ""));
    assert.match(await none.page.locator("#thSub").innerText(), /^SMS · no thread yet/);
    await none.page.close();

    // ?conversation_id= opens that one conversation even when the list does not hold it.
    const byId = await openInbox(`?conversation_id=${MARCUS_EMAIL}`, { wait: null });
    await waitFor(() => byId.log.messages.includes(MARCUS_EMAIL));
    await byId.page.waitForFunction(() => /Thanks, got it\./.test(document.querySelector("#thread")?.textContent || ""));
    await opened(byId.page, "Marcus Okoye");
    await waitFor(() => byId.log.client.includes(MARCUS_ID));
    assert.match(await byId.page.locator("#thSub").innerText(), /^EMAIL/);
    assert.equal(await byId.page.locator('#ctxLinks a:has-text("Their file")').getAttribute("href"), `client-control-panel.html?id=${MARCUS_ID}`);
    assert.doesNotMatch(await byId.page.locator("#ctxLinks").innerText(), /null/i);
    await byId.page.close();

    // Something that is not an id opens nothing.
    const bad = await openInbox("?conversation_id=not-an-id");
    assert.equal(await bad.page.locator("#thName").innerText(), "No conversation open");
    assert.deepEqual(bad.log.messages, []);
    await bad.page.close();
  });
});

test("the right panel lists their other threads and links to their file", { timeout: 90_000 }, async () => {
  await proof.check(/^Right panel:/, async () => {
    const { page, log, errors } = await openInbox("");
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    await page.waitForFunction(() => /EMAIL/.test(document.querySelector("#ctxThreads")?.textContent || ""));
    const others = await page.locator("#ctxThreads").innerText();
    assert.match(others, /EMAIL/, "their email thread is listed");
    assert.doesNotMatch(others, /SMS/, "the thread that is open is not listed as another one");
    assert.ok(log.conversations.includes(DANA_ID));
    const link = page.locator('#ctxLinks a:has-text("Their file")');
    assert.equal(await link.getAttribute("href"), `client-control-panel.html?id=${DANA_ID}`);

    // A person with only one thread says so.
    await page.locator('.ctab[data-filter="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    await page.locator('.convo:has-text("Marcus")').click();
    await opened(page, "Marcus Okoye");
    await page.waitForFunction(() => /only thread with them/.test(document.querySelector("#ctxThreads")?.textContent || ""));
    assert.equal(await page.locator('#ctxLinks a:has-text("Their file")').getAttribute("href"), `client-control-panel.html?id=${MARCUS_ID}`);
    assert.deepEqual(errors, []);
    await page.close();

    const linked = await openInbox(`?conversation_id=${MARCUS_EMAIL}`, { wait: null });
    await opened(linked.page, "Marcus Okoye");
    await waitFor(() => linked.log.conversations.includes(MARCUS_ID));
    assert.equal(await linked.page.locator('#ctxLinks a:has-text("Their file")').getAttribute("href"), `client-control-panel.html?id=${MARCUS_ID}`);
    assert.ok(linked.log.conversations.every(Boolean), "the right panel never asks for threads with a missing client");
    await linked.page.close();
  });
});

test("the Reference key opens and closes by itself, and its three colours are the three ways the thread paints a message", { timeout: 90_000 }, async () => {
  await proof.check(/^Reference disclosure/, async () => {
    // One thread with all three kinds of sender: a person on the team, the system (no sender name) and the client.
    const AUTO = { id: "m-auto", conversation_id: DANA_SMS, direction: "outbound", channel: "sms", rendered_body: "Your next step is ready.", subject: null, status: "sent", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: "2026-10-13T11:56:00Z" };
    const api = inboxApi();
    api.handlers["/api/read/messages"] = async (route) => json(route, page_of([AUTO, ...THREADS[DANA_SMS]]));
    const { page, log, errors } = await openInbox("", { api });
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    await page.waitForFunction(() => document.querySelectorAll("#thread .msg").length === 3);

    // The key states three ways at once, and each way is on the message itself.
    const messages = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#thread .msg")].map((m) => [m.dataset.id, {
      out: m.classList.contains("out"),
      avatar: m.querySelector(".av").className.replace(/^av\s*/, ""),
      initials: m.querySelector(".av").textContent.trim(),
      bubble: m.querySelector(".bubble").className.replace(/^bubble\s*/, ""),
      name: m.querySelector(".nm").textContent.trim(),
      tag: m.querySelector(".agent-tag") ? m.querySelector(".agent-tag").textContent.trim() : null,
    }])));
    assert.deepEqual(messages["m-s2"], { out: true, avatar: "human", initials: "JB", bubble: "out-human", name: "Jordan Blake", tag: null },
      "someone on your team: dark avatar, dark bubble, their name on it, no Automatic tag");
    assert.deepEqual(messages["m-auto"], { out: true, avatar: "agent", initials: "SYS", bubble: "out-agent", name: "Automatic", tag: "Automatic" },
      "sent by the system: outlined avatar and the Automatic tag");
    assert.deepEqual(messages["m-s1"], { out: false, avatar: "client", initials: "DW", bubble: "in", name: "Dana Whitfield", tag: null },
      "the client: plain avatar, plain bubble, no tag");

    // The key's three colours are the colours those messages are painted with.
    const paint = await page.evaluate(() => {
      const pick = (selector) => {
        const style = getComputedStyle(document.querySelector(selector));
        return { bg: style.backgroundColor, border: style.borderTopColor, width: style.borderTopWidth, display: style.display };
      };
      return {
        keyHuman: pick("#demoBody .sw.human"), keyAgent: pick("#demoBody .sw.agent"), keyClient: pick("#demoBody .sw.client"),
        avHuman: pick("#thread .av.human"), avAgent: pick("#thread .av.agent"), avClient: pick("#thread .av.client"),
        bubbleHuman: pick("#thread .bubble.out-human"), bubbleIn: pick("#thread .bubble.in"),
      };
    });
    assert.equal(paint.keyHuman.bg, paint.avHuman.bg, "key swatch 1 is the colour of the team avatar");
    assert.equal(paint.keyHuman.bg, paint.bubbleHuman.bg, "and of the team bubble (dark avatar, dark bubble)");
    assert.equal(paint.keyAgent.bg, paint.avAgent.bg, "key swatch 2 is the system avatar fill");
    assert.equal(paint.keyAgent.border, paint.avAgent.border, "with the system avatar outline colour");
    assert.equal(paint.keyAgent.width, paint.avAgent.width, "and the same outline width");
    assert.equal(paint.keyClient.border, paint.avClient.border, "key swatch 3 has the client avatar outline");
    assert.equal(paint.keyClient.bg, paint.bubbleIn.bg, "and the plain bubble fill");
    for (const swatch of [paint.keyHuman, paint.keyAgent, paint.keyClient]) assert.notEqual(swatch.display, "none", "a swatch is drawn");
    assert.notEqual(paint.keyHuman.bg, paint.keyAgent.bg, "the team and system swatches are not the same colour");
    assert.notEqual(paint.keyHuman.bg, paint.keyClient.bg, "the team and client swatches are not the same colour");
    assert.notEqual(paint.keyAgent.border, paint.keyClient.border, "the system and client swatches are not outlined the same");

    // The three lines say who each colour is.
    const lines = await page.evaluate(() => [...document.querySelectorAll("#demoBody .legend .li")].map((n) => n.textContent.replace(/\s+/g, " ").trim()));
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^someone on your team — dark avatar, dark bubble, their name on it$/);
    assert.match(lines[1], /^sent automatically by the system — outlined avatar, “Automatic” tag$/);
    assert.match(lines[2], /^the client — plain avatar, plain bubble, no tag$/);

    // Closed to start; one press opens it; the next press closes it. It asks the server for nothing.
    const state = () => page.evaluate(() => ({
      hidden: document.getElementById("demoBody").hasAttribute("hidden"),
      expanded: document.getElementById("demoToggle").getAttribute("aria-expanded"),
      zoneOpen: document.getElementById("demozone").classList.contains("open"),
    }));
    const toggle = page.locator("#demoToggle");
    assert.equal(await toggle.isVisible(), true, "the who-sent-it key is visible to a person");
    const press = () => toggle.click();
    const traffic = () => JSON.stringify(log);
    assert.deepEqual(await state(), { hidden: true, expanded: "false", zoneOpen: false });
    const quiet = traffic();
    await press();
    assert.deepEqual(await state(), { hidden: false, expanded: "true", zoneOpen: true });
    await press();
    assert.deepEqual(await state(), { hidden: true, expanded: "false", zoneOpen: false });
    await press();
    assert.deepEqual(await state(), { hidden: false, expanded: "true", zoneOpen: true });
    assert.equal(traffic(), quiet, "pressing the Reference key sends and reads nothing");
    assert.deepEqual(log.writes, []);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

// ───────────────────────── second pass: the holes an independent check found ─────────────────────────

const NORA_ID = "cccccccc-3333-4333-8333-333333333333";
const NORA_EMAIL = "44444444-4444-4444-8444-444444444444";
const NORA_ROW = { ...base, id: NORA_EMAIL, client_id: NORA_ID, channel: "email", first_name: "Nora", last_name: "Quill",
  last_body: null, last_direction: null, needs_reply: null, last_at: null, last_pulse_at: null };

/** Hold an answer until the test lets it go. */
function gate() {
  let open;
  const promise = new Promise((resolve) => { open = resolve; });
  return { armed: false, promise, release: () => open() };
}

test("the two tab counts count only threads owed a reply; a thread with no messages is one thread and owes nothing", { timeout: 90_000 }, async () => {
  await proof.check(/^Tab: Needs reply \(client spoke last/, async () => {
    // The server answers all three whatever the query says (a stand-in), so the page itself must not call
    // the answered thread or the empty one "waiting on us".
    const api = inboxApi({ inbox: () => [CONVOS[DANA_SMS], CONVOS[MARCUS_EMAIL], NORA_ROW] });
    const { page, errors } = await openInbox("", { api });
    assert.deepEqual(await names(page), ["Dana Whitfield"], "the Needs reply tab lists only the thread that is owed");
    assert.equal(await page.locator("#nAll").innerText(), "3");
    assert.equal(await page.locator("#nReply").innerText(), "1", "one thread is owed; the answered one and the empty one are not");
    await page.locator('.ctab[data-filter="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 3);
    const flags = await page.locator(".convo").evaluateAll((els) => els.map((e) => ({
      name: e.querySelector(".cv-name").textContent.trim(),
      owed: e.classList.contains("unread"),
      tag: /Waiting on us/.test(e.textContent),
      preview: e.querySelector(".cv-prev").textContent.trim(),
    })));
    assert.deepEqual(flags.find((f) => f.name === "Dana Whitfield"), { name: "Dana Whitfield", owed: true, tag: true, preview: "any update on my file?" });
    assert.deepEqual(flags.find((f) => f.name === "Marcus Okoye"), { name: "Marcus Okoye", owed: false, tag: false, preview: "Thanks, got it." });
    assert.deepEqual(flags.find((f) => f.name === "Nora Quill"), { name: "Nora Quill", owed: false, tag: false, preview: "No messages on this thread yet." });
    assert.equal(await page.locator("#nReply").innerText(), "1");
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("after Email / Text the header, the avatar and the reply state still name the same person and the thread's own state", { timeout: 90_000 }, async () => {
  await proof.check(/^Channel toggle: Email \/ Text buttons/, async () => {
    const owed = async (page) => (await page.locator("#ctxRows .ctx-row").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim()).find((t) => t.startsWith("Waiting on us"));
    const { page, errors } = await openInbox("");
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    assert.equal((await page.locator("#thSub").innerText()).trim(), "SMS · waiting on a reply from us");

    await page.locator("#chEmail").click();
    await page.waitForFunction(() => document.querySelector("#thSub")?.textContent.startsWith("EMAIL"));
    assert.equal((await page.locator("#thName").innerText()).trim(), "Dana Whitfield", "the same person, not Unnamed client");
    assert.equal((await page.locator("#thAv").innerText()).trim(), "DW");
    assert.equal((await page.locator("#footName").textContent()).trim(), "Dana Whitfield");
    assert.equal((await page.locator("#thSub").innerText()).trim(), "EMAIL · no reply owed", "the email thread was answered");
    await page.waitForFunction(() => /Waiting on us\s*no/.test(document.querySelector("#ctxRows")?.textContent || ""));
    assert.match(await owed(page), /^Waiting on us no$/);

    await page.locator("#chText").click();
    await page.waitForFunction(() => document.querySelector("#thSub")?.textContent.startsWith("SMS"));
    assert.equal((await page.locator("#thName").innerText()).trim(), "Dana Whitfield");
    assert.equal((await page.locator("#thSub").innerText()).trim(), "SMS · waiting on a reply from us", "the text thread is still owed");
    await page.waitForFunction(() => /Waiting on us\s*yes/.test(document.querySelector("#ctxRows")?.textContent || ""));
    assert.match(await owed(page), /^Waiting on us yes$/);

    // A channel with no thread yet: still the same person, and nothing is owed.
    await page.locator('.ctab[data-filter="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    await page.locator('.convo:has-text("Marcus")').click();
    await opened(page, "Marcus Okoye");
    await page.locator("#chText").click();
    await page.waitForFunction(() => /no thread yet/.test(document.querySelector("#thSub")?.textContent || ""));
    assert.equal((await page.locator("#thName").innerText()).trim(), "Marcus Okoye");
    assert.equal((await page.locator("#thAv").innerText()).trim(), "MO");
    assert.equal((await page.locator("#thSub").innerText()).trim(), "SMS · no thread yet");
    assert.deepEqual(errors, []);
    await page.close();
  });

  await proof.check(/^Channel toggle: Email \/ Text buttons/, async () => {
    // Pressing Email and then opening somebody else before the answer comes back: the late answer must not
    // open the first person's thread over the second person's.
    const api = inboxApi();
    const held = gate();
    api.handlers["/api/read/conversations"] = async (route, { url }) => {
      const clientId = new URL(url).searchParams.get("client_id");
      api.log.conversations.push(clientId);
      if (held.armed && clientId === DANA_ID) await held.promise;
      return json(route, page_of(Object.values(CONVOS).filter((c) => c.client_id === clientId)));
    };
    const { page } = await openInbox("", { api });
    await page.locator('.ctab[data-filter="all"]').click();
    await page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    await page.locator('.convo:has-text("Dana")').click();
    await opened(page, "Dana Whitfield");
    await page.waitForFunction(() => /EMAIL/.test(document.querySelector("#ctxThreads")?.textContent || ""));
    held.armed = true;
    await page.locator("#chEmail").click();
    await page.locator('.convo:has-text("Marcus")').click();
    await opened(page, "Marcus Okoye");
    held.release();
    await page.waitForTimeout(400);
    assert.equal((await page.locator("#thName").innerText()).trim(), "Marcus Okoye", "the late answer did not take the screen back");
    assert.match(await page.locator("#thread").innerText(), /Thanks, got it\./);
    await page.close();
  });
});

test("the texting-hours notice flips exactly at 8:00pm and 8:00am Arizona time", { timeout: 120_000 }, async () => {
  await proof.check(/^Compose box: type reply, Enter sends/, async () => {
    const OPEN = /^Texting hours: 8:00am to 8:00pm Arizona time\./;
    const CLOSED = /^Texting hours are closed\./;
    // Arizona is UTC-7 all year.
    const cases = [
      ["19:59 is open", "2026-10-14T02:59:00Z", OPEN, false],
      ["20:00 is closed", "2026-10-14T03:00:00Z", CLOSED, true],
      ["23:30 is closed", "2026-10-14T06:30:00Z", CLOSED, true],
      ["07:59 is closed", "2026-10-14T14:59:00Z", CLOSED, true],
      ["08:00 is open", "2026-10-14T15:00:00Z", OPEN, false],
    ];
    for (const [label, at, words, closed] of cases) {
      const { page } = await openInbox("", { at });
      await page.locator(".convo").first().click();
      await opened(page, "Dana Whitfield");
      const note = page.locator("#quietNote");
      assert.match((await note.innerText()).trim(), words, label);
      assert.equal(await note.evaluate((n) => n.classList.contains("closed")), closed, label);
      await page.close();
    }
  });
});

test("the compose box: an empty box sends nothing, what was typed goes as typed, and words stay when the send is stopped", { timeout: 120_000 }, async () => {
  await proof.check(/^Compose box: type reply, Enter sends/, async () => {
    const send = async (outcome, words) => {
      const api = inboxApi({ sendOutcome: outcome });
      const run = await openInbox("", { api, at: DAYTIME });
      await run.page.locator(".convo").first().click();
      await opened(run.page, "Dana Whitfield");
      await run.page.locator("#composeBody").click();
      await run.page.keyboard.type(words);
      await run.page.keyboard.press("Enter");
      await waitFor(() => run.log.posts.length === 1);
      await run.page.waitForFunction(() => !/^Sending/.test(document.querySelector("#sendStatus")?.textContent || "Sending"));
      return run;
    };

    // Nothing, or only spaces, typed: Enter sends nothing.
    const empty = await openInbox("", { at: DAYTIME });
    await empty.page.locator(".convo").first().click();
    await opened(empty.page, "Dana Whitfield");
    await empty.page.locator("#composeBody").click();
    await empty.page.keyboard.press("Enter");
    await empty.page.keyboard.type("   ");
    await empty.page.keyboard.press("Enter");
    await empty.page.waitForTimeout(250);
    assert.deepEqual(empty.log.posts, [], "an empty or blank box is not a message");
    await empty.page.close();

    // What was typed is what is sent: spaces at either end are kept.
    const typed = await send("sent", "  spaced words  ");
    assert.equal(typed.log.posts[0].body, "  spaced words  ");
    assert.equal(await typed.page.locator("#sendStatus").innerText(), "Sent.");
    assert.equal(await typed.page.locator("#composeBody").inputValue(), "", "a sent message leaves the box empty");
    await typed.page.close();

    // Held for the morning: also saved, so the box is emptied and the words say when it goes out.
    const held = await send("deferred", "see you at nine");
    assert.match(await held.page.locator("#sendStatus").innerText(), /^Saved\. It goes out automatically at 8:00am Arizona time/);
    assert.equal(await held.page.locator("#composeBody").inputValue(), "");
    await held.page.close();

    // Stopped by the compliance check: the words stay in the box so nothing typed is lost, and it says so.
    const stopped = await send("blocked", "this one is stopped");
    assert.match(await stopped.page.locator("#sendStatus").innerText(), /^Not sent\. The compliance check stopped it/);
    assert.equal(await stopped.page.locator("#composeBody").inputValue(), "this one is stopped", "a hard stop keeps the words");
    await stopped.page.close();
  });
});

test("Send this one to: an email box checks its shape, and a late read of the record never wipes what was typed", { timeout: 120_000 }, async () => {
  await proof.check(/^'Send this one to' address box/, async () => {
    // An email thread: the box starts as the email on file; a bad shape stops Send and says why.
    const email = await openInbox("?client_id=" + MARCUS_ID, { wait: null });
    await opened(email.page, "Marcus Okoye");
    await email.page.waitForFunction(() => document.querySelector("#composeTo")?.value === "marcus@example.com");
    await email.page.locator("#composeBody").fill("hello");
    await email.page.locator("#composeTo").fill("marcus@@example");
    assert.equal(await email.page.locator("#sendBtn").isDisabled(), true);
    assert.match(await email.page.locator("#composeToNote").innerText(), /That does not look like an email address\./);
    await email.page.locator("#composeTo").fill("marcus at home");
    assert.equal(await email.page.locator("#sendBtn").isDisabled(), true, "a space is not an address");
    await email.page.locator("#composeTo").fill("other@example.com");
    assert.equal(await email.page.locator("#sendBtn").isEnabled(), true);
    assert.equal(await email.page.locator("#composeToNote").isHidden(), true);
    await email.page.locator("#sendBtn").click();
    await waitFor(() => email.log.posts.length === 1);
    assert.equal(email.log.posts[0].to, "other@example.com");
    assert.deepEqual(email.log.writes, []);
    await email.page.close();

    // The record answers late: what the person typed in the meantime is kept.
    const api = inboxApi();
    const slow = gate();
    api.handlers["/api/dashboard/client?id="] = async (route, { url }) => {
      const id = new URL(url).searchParams.get("id");
      api.log.client.push(id);
      await slow.promise;
      return json(route, { ok: true, client: CLIENTS[id] || { id }, transactions: [], crs_results: [], messages: [], tasks: [] });
    };
    const { page, log } = await openInbox("", { api, at: DAYTIME });
    await page.locator(".convo").first().click();
    await opened(page, "Dana Whitfield");
    await waitFor(() => log.client.includes(DANA_ID));
    await page.locator("#composeTo").fill("+15550107777");
    slow.release();
    await page.waitForFunction(() => /dana@example\.com/.test(document.querySelector("#ctxRows")?.textContent || ""));
    assert.equal(await page.locator("#composeTo").inputValue(), "+15550107777", "the late read did not overwrite the typed number");
    await page.locator("#composeBody").fill("hi");
    await page.locator("#sendBtn").click();
    await waitFor(() => log.posts.length === 1);
    assert.equal(log.posts[0].to, "+15550107777");
    await page.close();
  });
});

test("the search box ignores capitals and stray spaces, and says how much it searched", { timeout: 120_000 }, async () => {
  await proof.check(/^Search box: search people and messages/, async () => {
    const { page } = await openInbox("");
    await page.locator("#q").fill("MARCUS");
    await page.waitForFunction(() => [...document.querySelectorAll(".convo .cv-name")].map((n) => n.textContent.trim()).join() === "Marcus Okoye");
    await page.locator("#q").fill("  marcus  ");
    assert.deepEqual(await names(page), ["Marcus Okoye"], "spaces at either end of the word are not part of it");
    await page.locator("#q").fill("tHaNkS");
    assert.deepEqual(await names(page), ["Marcus Okoye"], "the words of the last message match in any case");
    await page.locator("#q").fill("SMS");
    assert.deepEqual(await names(page), ["Dana Whitfield"], "so does the channel");
    await page.close();

    // How much was searched. Everything loaded and nothing more waiting: no note on the All tab.
    const all = await openInbox("");
    await all.page.locator('.ctab[data-filter="all"]').click();
    await all.page.waitForFunction(() => document.querySelectorAll(".convo").length === 2);
    await all.page.locator("#q").fill("dana");
    assert.equal(await all.page.locator(".search-scope").count(), 0, "searching all of them says nothing extra");
    await all.page.close();

    // More waiting than was loaded: the box says it searched only the newest ones, on either tab.
    const more = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: true, items });
    const big = inboxApi({ inbox: () => more([CONVOS[DANA_SMS], CONVOS[MARCUS_EMAIL]]) });
    const onReply = await openInbox("", { api: big });
    await onReply.page.locator("#q").fill("dana");
    assert.equal((await onReply.page.locator(".search-scope").innerText()).trim(),
      "Searching the 2 most recent conversations only. Searching everyone, not just Needs reply.");
    await onReply.page.locator('.ctab[data-filter="all"]').click();
    await onReply.page.waitForFunction(() => !/not just Needs reply/.test(document.querySelector(".search-scope")?.textContent || ""));
    assert.equal((await onReply.page.locator(".search-scope").innerText()).trim(), "Searching the 2 most recent conversations only.");
    await onReply.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
