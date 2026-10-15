// Batch 16 practice tests: the staff reply inbox (public/app/messaging.html) in a real Chromium with fake
// /api answers (no live data, nothing sent).
//
//   the two tabs and the search box          what each asks the server for, and what it paints
//   the Email / Text toggle                  opens that client's other-channel conversation, or an empty one
//   the compose box                          Enter sends, Shift+Enter is a new line, the texting-hours notice
//   the "Send this one to" box               filled from the record, sent for one message, never written back
//   deep links                               ?client_id= ?channel= ?conversation_id=
//   the right panel                          other threads, Their file link
//   the Reference key (who-sent-it colours)  opens and closes by itself; its three colours are the three
//                                            ways the thread paints a message. The brand stylesheet hides
//                                            the whole drawer today (UI-STANDARDS section 5), so the press
//                                            is made through the page (element.click()), not by a finger,
//                                            and the test prints whether a person can see it.

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
  [DANA_SMS]: [{ id: "m-s2", conversation_id: DANA_SMS, direction: "outbound", channel: "sms", rendered_body: "looking now, one moment", subject: null, status: "sent", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: "staff-1", sender_name: "Jordan Blake", created_at: "2026-10-13T11:55:00Z" },
    { id: "m-s1", conversation_id: DANA_SMS, direction: "inbound", channel: "sms", rendered_body: "any update on my file?", subject: null, status: "received", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: "2026-10-13T11:50:00Z" }],
  [DANA_EMAIL]: [{ id: "m-e1", conversation_id: DANA_EMAIL, direction: "outbound", channel: "email", rendered_body: "Your documents are attached.", subject: "Documents", status: "sent", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: "staff-1", sender_name: "Jordan Blake", created_at: "2026-10-12T09:00:00Z" }],
  [MARCUS_EMAIL]: [{ id: "m-m1", conversation_id: MARCUS_EMAIL, direction: "inbound", channel: "email", rendered_body: "Thanks, got it.", subject: "Re: Plan", status: "received", provider: "resend", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null, sender_name: null, created_at: "2026-10-13T08:00:00Z" }],
};
const page_of = (items) => ({ ok: true, count: items.length, limit: 200, offset: 0, hasMore: false, items });

/** The fake server: every read is logged, every write is kept, nothing leaves the test. */
function inboxApi({ inbox = null, sendOutcome = "sent" } = {}) {
  const log = { inbox: [], messages: [], conversations: [], client: [], posts: [], writes: [] };
  const handlers = {
    "/api/read/inbox": async (route, { url }) => {
      const query = new URL(url).search;
      log.inbox.push(query);
      if (inbox) return json(route, page_of(inbox(query)));
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
    if (at) await page.clock.install({ time: new Date(at) });
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
  await proof.check(/^Deep links: \?client_id=, \?channel=, \?conversation_id=/, async () => {
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
    await byId.page.close();

    // Something that is not an id opens nothing.
    const bad = await openInbox("?conversation_id=not-an-id");
    assert.equal(await bad.page.locator("#thName").innerText(), "No conversation open");
    assert.deepEqual(bad.log.messages, []);
    await bad.page.close();
  });
});

test("the right panel lists their other threads and links to their file", { timeout: 90_000 }, async () => {
  await proof.check(/^Right panel: 'Their other threads' list/, async () => {
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
  });
});

test("the Reference key opens and closes by itself, and its three colours are the three ways the thread paints a message", { timeout: 90_000 }, async (t) => {
  await proof.check(/^Reference disclosure \(who-sent-it colour key\)/, async () => {
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
    const press = () => page.evaluate(() => document.getElementById("demoToggle").click());
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
    t.diagnostic(`shown to a person on this page: ${await page.locator("#demoToggle").isVisible()}`);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
