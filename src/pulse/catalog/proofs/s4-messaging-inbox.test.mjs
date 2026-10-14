// Proves the staff reply inbox (public/app/messaging.html): it opens on Needs
// reply and asks the server for only those threads, re-reads on its timer, and
// a click on a conversation reads that thread and that client and opens it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CLOSER = { ok: true, staff: { id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } };
const OWED = {
  id: "11111111-1111-4111-8111-111111111111", client_id: "aaaaaaaa-1111-4111-8111-111111111111", channel: "sms",
  summary: null, sentiment: null, last_pulse_at: "2026-08-02T11:50:00Z", created_at: "2026-08-01T10:00:00Z",
  first_name: "Dana", last_name: "Whitfield", last_message_id: "msg-1", last_direction: "inbound",
  last_body: "any update on my file?", last_status: "received", last_at: "2026-08-02T11:50:00Z", needs_reply: true,
  activity_at: "2026-08-02T11:50:00Z",
};
const THREAD = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "msg-2", conversation_id: OWED.id, direction: "outbound", channel: "sms", rendered_body: "looking now, one moment", subject: null,
      status: "sent", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: "staff-1",
      sender_name: "Jordan Blake", created_at: "2026-08-02T11:55:00Z" },
    { id: "msg-1", conversation_id: OWED.id, direction: "inbound", channel: "sms", rendered_body: "any update on my file?", subject: null,
      status: "received", provider: "twilio", blocked_reason: null, last_error: null, scheduled_at: null, sender_staff_id: null,
      sender_name: null, created_at: "2026-08-02T11:50:00Z" },
  ],
};

async function openInbox(open, { clock = false } = {}) {
  const calls = { inbox: [], messages: [], client: [] };
  const handlers = {
    "/api/read/inbox": async (route, { url }) => {
      calls.inbox.push(new URL(url).search);
      return json(route, { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [OWED] });
    },
    "/api/read/messages": async (route, { url }) => { calls.messages.push(new URL(url).search); return json(route, THREAD); },
    "/api/dashboard/client?id=": async (route, { url }) => {
      calls.client.push(new URL(url).searchParams.get("id"));
      return json(route, { ok: true, client: { id: OWED.client_id, first_name: "Dana", last_name: "Whitfield", email: "dana@example.com", phone: "+15550100", custom_fields: {} } });
    },
  };
  const init = () => { localStorage.setItem("fh_role", "closer"); };
  const opened = await open("/app/messaging.html", { session: CLOSER, handlers, init, clock });
  await opened.page.waitForSelector(".convo");
  return { ...opened, calls };
}

test("it opens on Needs reply, asks the server for those threads only, and re-reads on its timer", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page load: inbox read \(Needs-reply tab first\)/, async () => {
    const { page, calls, errors } = await openInbox(open, { clock: true });
    assert.match(await page.locator(".ctab.active").innerText(), /Needs reply/);
    assert.deepEqual(calls.inbox, ["?limit=200&needs_reply=1"], "the first read asks only for threads owed a reply");
    assert.equal(await page.locator(".convo").count(), 1);
    assert.match(await page.locator(".convo").first().innerText(), /Dana Whitfield/);
    assert.match(await page.locator(".convo").first().innerText(), /any update on my file\?/);

    await page.locator('.ctab[data-filter="all"]').click();
    await waitFor(() => calls.inbox.length === 2);
    assert.deepEqual(calls.inbox[1], "?limit=200", "All asks for every thread");

    // the timer: while the tab is on screen the inbox is read again by itself, every 30 seconds
    const before = calls.inbox.length;
    await page.clock.fastForward(29_000);
    await page.waitForTimeout(200);
    assert.equal(calls.inbox.length, before, "no read before 30 seconds");
    await page.clock.fastForward(2_000);
    await waitFor(() => calls.inbox.length === before + 1);

    // a tab nobody is looking at does not read; it reads again once it is on screen
    const setHidden = (hidden) => page.evaluate((value) => Object.defineProperty(document, "hidden", { configurable: true, get: () => value }), hidden);
    await setHidden(true);
    const hiddenAt = calls.inbox.length;
    await page.clock.fastForward(61_000);
    await page.waitForTimeout(200);
    assert.equal(calls.inbox.length, hiddenAt, "a hidden tab makes no read");
    await setHidden(false);
    await page.clock.fastForward(31_000);
    await waitFor(() => calls.inbox.length > hiddenAt);
    assert.deepEqual(errors, []);
    await page.close();
  });
});

test("clicking a conversation reads that thread and that client, and opens it oldest first", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Conversation list row: click opens the thread/, async () => {
    const { page, calls } = await openInbox(open);
    assert.equal(await page.locator("#composeBody").isDisabled(), true, "the compose box is dead until a thread is open");
    await page.locator(".convo").first().click();
    await page.waitForFunction(() => document.querySelector("#thName")?.textContent === "Dana Whitfield");
    await waitFor(() => calls.messages.length >= 1 && calls.client.length >= 1);
    assert.match(calls.messages[0], new RegExp(`conversation_id=${OWED.id}`));
    assert.match(calls.messages[0], /limit=200/);
    assert.deepEqual([...new Set(calls.client)], [OWED.client_id]);
    const msgs = page.locator("#thread .msg");
    assert.match(await msgs.nth(0).innerText(), /any update on my file\?/);
    assert.match(await msgs.nth(1).innerText(), /looking now, one moment/);
    assert.match(await msgs.nth(1).innerText(), /Jordan Blake/);
    assert.equal(await page.locator("#composeBody").isEnabled(), true);
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
