// The staff reply inbox, in a real browser, clicked by a real click.
//
// ═══════════════════════════════════════════════════════════════════════════
// WHAT THIS CATCHES THAT NOTHING ELSE DOES.
//
// src/http/messaging-screen.test.mjs drives the page's view model directly and
// asserts on its markup. That is genuine coverage — it is where the rules live
// — but it proves nothing about the page RUNNING. A screen can pass every one
// of those checks and still render blank: an element id that does not match the
// one the code looks up, a click handler bound to a selector that no longer
// exists, a null reference thrown on load that stops every later line.
//
// So each case here is a thing a person does: open the page, click a
// conversation, read the thread, type a reply, press Send, read what came back.
//
//
// NO BACKEND. The page is loaded over file:// and every /api/** request is
// answered by page.route(). That buys three things a live database cannot:
//
//   * these run anywhere, with no Postgres, no session and no seed data
//   * the states worth checking are reachable on demand — an empty inbox, a
//     message the compliance gate blocked, two o'clock in the morning
//   * a failure means the SCREEN is broken, never the backend, so a red result
//     here always points at the file that changed
//
// The trade is stated plainly: this does not prove the endpoints work. That is
// what the .pg.test.mjs files are for. This proves the screen does.

import { test, expect } from "@playwright/test";

/* Served by e2e/static-server.mjs over http, not opened off disk — see that
   file's header for the three separate things file:// breaks. */
const SCREEN = "/app/messaging.html";

/* Two threads: one the client spoke on last (owed a reply), one we answered. */
const INBOX = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      client_id: "aaaaaaaa-1111-4111-8111-111111111111",
      channel: "sms", summary: null, sentiment: null,
      last_pulse_at: "2026-08-02T11:50:00Z", created_at: "2026-08-01T10:00:00Z",
      first_name: "Dana", last_name: "Whitfield",
      last_message_id: "msg-1", last_direction: "inbound",
      last_body: "any update on my file?", last_status: "received",
      last_at: "2026-08-02T11:50:00Z", needs_reply: true,
      activity_at: "2026-08-02T11:50:00Z"
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      client_id: "bbbbbbbb-2222-4222-8222-222222222222",
      channel: "email", summary: null, sentiment: null,
      last_pulse_at: "2026-08-02T09:00:00Z", created_at: "2026-08-01T09:00:00Z",
      first_name: "Marcus", last_name: "Bell",
      last_message_id: "msg-9", last_direction: "outbound",
      last_body: "sent you the paperwork", last_status: "sent",
      last_at: "2026-08-02T09:00:00Z", needs_reply: false,
      activity_at: "2026-08-02T09:00:00Z"
    }
  ]
};

const THREAD = {
  ok: true, count: 2, limit: 200, offset: 0, hasMore: false,
  items: [
    { id: "msg-2", conversation_id: INBOX.items[0].id, direction: "outbound", channel: "sms",
      rendered_body: "looking now, one moment", subject: null, status: "sent", provider: "twilio",
      blocked_reason: null, last_error: null, scheduled_at: null,
      sender_staff_id: "staff-1", sender_name: "Jordan Blake", created_at: "2026-08-02T11:55:00Z" },
    { id: "msg-1", conversation_id: INBOX.items[0].id, direction: "inbound", channel: "sms",
      rendered_body: "any update on my file?", subject: null, status: "received", provider: "twilio",
      blocked_reason: null, last_error: null, scheduled_at: null,
      sender_staff_id: null, sender_name: null, created_at: "2026-08-02T11:50:00Z" }
  ]
};

const EMPTY = { ok: true, count: 0, limit: 200, offset: 0, hasMore: false, items: [] };

/* public/app/shell.js gates every screen on GET /api/auth/session before the
   page is allowed to paint, and redirects to /login.html when it does not get a
   staff object back. Without this the test lands on the login page and every
   assertion fails as "0 elements", which reads like a broken screen and is not.
   A closer, because that is who lives in this inbox. */
const SESSION = {
  ok: true,
  staff: {
    id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.ai",
    role: "closer", org_id: "org-1", status: "active"
  }
};

const json = (route, body) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/* wire — stand in for the backend.
   `onSend` receives the parsed POST body so a case can assert what the screen
   actually sent, and returns the response it should get back. */
async function wire(page, { inbox = INBOX, thread = THREAD, onSend } = {}) {
  const sent = [];
  await page.route("**/api/**", async (route) => {
    const url = route.request().url();
    if (route.request().method() === "POST" && url.includes("/api/messages")) {
      const body = JSON.parse(route.request().postData() || "{}");
      sent.push(body);
      return json(route, (onSend ? onSend(body) : {
        ok: true, message: { id: "new-1", status: "sent" },
        conversation_id: body.conversation_id, outcome: "sent", detail: null, deduped: false
      }));
    }
    if (url.includes("/api/auth/session")) return json(route, SESSION);
    if (url.includes("/api/health")) return json(route, { ok: true, db: "up" });
    if (url.includes("/api/read/inbox")) return json(route, inbox);
    if (url.includes("/api/read/messages")) return json(route, thread);
    if (url.includes("/api/read/conversations")) return json(route, EMPTY);
    return json(route, { ok: true, items: [] });
  });
  // The page reads a token from localStorage before it will call the API at
  // all; without one FHData short-circuits to "not signed in".
  await page.addInitScript(() => {
    localStorage.setItem("fh_token", "e2e-token");
    // shell.js reads this before the network answers, so the screen paints
    // without a flash of the wrong sidebar.
    localStorage.setItem("fh_role", "closer");
    localStorage.removeItem("fh_demo");
  });
  return sent;
}

/* A page whose clock is fixed, so the texting-hours cases assert about a stated
   instant rather than about whenever the suite happens to run. */
async function freezeClock(page, iso) {
  await page.addInitScript(`{
    const fixed = new Date(${JSON.stringify(iso)}).valueOf();
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
      static now() { return fixed; }
    }
    Date = FrozenDate;
  }`);
}

test.describe("the inbox loads and can be read", () => {

  test("it renders the real conversations, newest first", async ({ page }) => {
    await wire(page);
    await page.goto(SCREEN);
    /* The inbox opens on "Needs reply" (owner UI-audit answer, 2026-08-17,
       582c74255). These checks are about every conversation, so open "All". */
    await page.locator('.ctab[data-filter="all"]').click();

    const rows = page.locator(".convo");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("Dana Whitfield");
    await expect(rows.first()).toContainText("any update on my file?");
    await expect(rows.nth(1)).toContainText("Marcus Bell");
  });

  test("the thread waiting on a reply is the one marked", async ({ page }) => {
    await wire(page);
    await page.goto(SCREEN);
    /* The inbox opens on "Needs reply" (owner UI-audit answer, 2026-08-17,
       582c74255). These checks are about every conversation, so open "All". */
    await page.locator('.ctab[data-filter="all"]').click();

    await expect(page.locator(".convo").first()).toHaveClass(/unread/);
    await expect(page.locator(".convo").first().locator(".unread-dot")).toBeVisible();
    await expect(page.locator(".convo").nth(1)).not.toHaveClass(/unread/);
    await expect(page.locator("#nAll")).toHaveText("2");
    await expect(page.locator("#nReply")).toHaveText("1");
  });

  test("clicking a conversation opens its thread, both sides, oldest at the top",
    async ({ page }) => {
    await wire(page);
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();

    await expect(page.locator("#thName")).toHaveText("Dana Whitfield");
    const msgs = page.locator("#threadPane .msg, #thread .msg, .thread .msg");
    // At least the two scripted turns; ignore chrome/system rows if present.
    await expect(msgs.filter({ hasText: /any update on my file/i })).toHaveCount(1);
    await expect(msgs.filter({ hasText: /looking now, one moment/i })).toHaveCount(1);
    const count = await msgs.count();
    expect(count).toBeGreaterThanOrEqual(2);
    // The endpoint answers newest-first and the screen reverses it. If that
    // reversal is ever dropped the conversation reads backwards, which no
    // amount of markup assertion would notice.
    await expect(msgs.first()).toContainText("any update on my file?");
    await expect(msgs.nth(1)).toContainText("looking now, one moment");
    await expect(msgs.nth(1)).toContainText("Jordan Blake");
  });

  test("the compose box is dead until a conversation is open", async ({ page }) => {
    await wire(page);
    await page.goto(SCREEN);

    await expect(page.locator("#composeBody")).toBeDisabled();
    await expect(page.locator("#sendBtn")).toBeDisabled();

    await page.locator(".convo").first().click();
    await expect(page.locator("#composeBody")).toBeEnabled();
    await expect(page.locator("#sendBtn")).toBeEnabled();
  });
});

test.describe("sending a reply", () => {

  test("what is typed is what is sent, on the thread it was typed on", async ({ page }) => {
    const sent = await wire(page);
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();

    await page.locator("#composeBody").fill("calling you in ten minutes");
    await page.locator("#sendBtn").click();

    await expect(page.locator("#sendStatus")).toContainText("Sent.");
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toBe("calling you in ten minutes");
    expect(sent[0].conversation_id).toBe(INBOX.items[0].id);
    // Without this a retried request sends the message twice.
    expect(typeof sent[0].idempotency_key).toBe("string");
    expect(sent[0].idempotency_key.length).toBeGreaterThan(0);
    // A successful send clears the box, so the next reply starts empty.
    await expect(page.locator("#composeBody")).toHaveValue("");
  });

  /* THE CASE THAT MATTERS MOST ON THIS SCREEN. A held message must not read as
     a failure, or the staff member retypes it and the client gets it twice. */
  test("a text held for the night says so, and keeps the words", async ({ page }) => {
    await wire(page, {
      onSend: (body) => ({
        ok: true, message: { id: "new-2", status: "queued" },
        conversation_id: body.conversation_id, outcome: "deferred",
        detail: "2026-08-03T15:00:00Z", deduped: false
      })
    });
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();
    await page.locator("#composeBody").fill("first thing tomorrow");
    await page.locator("#sendBtn").click();

    const status = page.locator("#sendStatus");
    await expect(status).toContainText("8:00am Arizona time");
    await expect(status).toContainText("do not need to send it again");
    await expect(status).not.toContainText("failed");
    await expect(status).not.toContainText("Not sent");
  });

  /* And a blocked one must keep the words too — they need editing, not
     retyping from memory. */
  test("a blocked message says why and leaves the text in the box", async ({ page }) => {
    await wire(page, {
      onSend: (body) => ({
        ok: true, message: { id: "new-3", status: "blocked" },
        conversation_id: body.conversation_id, outcome: "blocked",
        detail: ["opted_out"], deduped: false
      })
    });
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();
    await page.locator("#composeBody").fill("just checking in");
    await page.locator("#sendBtn").click();

    await expect(page.locator("#sendStatus")).toContainText("Not sent");
    await expect(page.locator("#sendStatus")).toContainText("opted_out");
    await expect(page.locator("#composeBody")).toHaveValue("just checking in");
  });

  test("an empty box sends nothing at all", async ({ page }) => {
    const sent = await wire(page);
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();
    await page.locator("#composeBody").fill("   ");
    await page.locator("#sendBtn").click();
    await page.waitForTimeout(200);
    expect(sent).toHaveLength(0);
  });
});

test.describe("the texting-hours warning", () => {

  test("during the day it states the rule without alarm", async ({ page }) => {
    await freezeClock(page, "2026-08-02T17:00:00Z");   // 10am Arizona
    await wire(page);
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();

    const note = page.locator("#quietNote");
    await expect(note).toBeVisible();
    await expect(note).toContainText("8:00am to 8:00pm Arizona time");
    await expect(note).not.toHaveClass(/closed/);
  });

  test("at eleven at night it warns before a word is typed", async ({ page }) => {
    await freezeClock(page, "2026-08-02T06:00:00Z");   // 11pm Arizona
    await wire(page);
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();

    const note = page.locator("#quietNote");
    await expect(note).toBeVisible();
    await expect(note).toHaveClass(/closed/);
    await expect(note).toContainText("Texting hours are closed");
    await expect(note).toContainText("do not need to send it again");
  });

  test("an email thread says nothing about texting hours", async ({ page }) => {
    await freezeClock(page, "2026-08-02T06:00:00Z");
    await wire(page);
    await page.goto(SCREEN);
    /* The inbox opens on "Needs reply" (owner UI-audit answer, 2026-08-17,
       582c74255). These checks are about every conversation, so open "All". */
    await page.locator('.ctab[data-filter="all"]').click();
    await page.locator(".convo").nth(1).click();       // Marcus, email

    await expect(page.locator("#quietNote")).toBeHidden();
  });
});

test.describe("honest empty states", () => {

  test("a brand new company is told there is nothing yet, not shown an error",
    async ({ page }) => {
    await wire(page, { inbox: EMPTY });
    await page.goto(SCREEN);
    /* The inbox opens on "Needs reply" (owner UI-audit answer, 2026-08-17,
       582c74255). These checks are about every conversation, so open "All". */
    await page.locator('.ctab[data-filter="all"]').click();

    await expect(page.locator("#convoList")).toContainText("No conversations yet");
    await expect(page.locator(".convo")).toHaveCount(0);
    await expect(page.locator("#thName")).toHaveText("No conversation open");
  });

  test("a search with no match says so, and does not look like an outage",
    async ({ page }) => {
    await wire(page);
    await page.goto(SCREEN);
    await page.locator("#q").fill("nobody by that name");

    await expect(page.locator("#convoList")).toContainText("Nothing matches what you typed");
  });

  test("an empty Needs-reply tab reads as good news", async ({ page }) => {
    await wire(page, { inbox: EMPTY });
    await page.goto(SCREEN);
    await page.locator('.ctab[data-filter="reply"]').click();

    await expect(page.locator("#convoList")).toContainText("Nothing is waiting on a reply");
  });

  test("the Needs-reply tab asks the server for a filtered list", async ({ page }) => {
    const urls = [];
    await page.route("**/api/**", async (route) => {
      const url = route.request().url();
      if (url.includes("/api/auth/session")) return json(route, SESSION);
      if (url.includes("/api/read/inbox")) { urls.push(url); return json(route, INBOX); }
      return json(route, EMPTY);
    });
    await page.addInitScript(() => {
      localStorage.setItem("fh_token", "e2e-token");
      localStorage.setItem("fh_role", "closer");
    });
    await page.goto(SCREEN);
    await page.locator('.ctab[data-filter="reply"]').click();
    await expect.poll(() => urls.length).toBeGreaterThan(1);
    expect(urls[urls.length - 1]).toContain("needs_reply=1");
  });
});

test.describe("the page does not lie about who said what", () => {

  test("a message with no author is labelled automatic, not blamed on a person",
    async ({ page }) => {
    await wire(page, {
      thread: {
        ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
        items: [{ id: "m", conversation_id: INBOX.items[0].id, direction: "outbound",
                  channel: "sms", rendered_body: "an automated reminder", subject: null,
                  status: "sent", sender_staff_id: null, sender_name: null,
                  blocked_reason: null, last_error: null, created_at: "2026-08-02T11:00:00Z" }]
      }
    });
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();
    await expect(page.locator(".msg").first()).toContainText("Automatic");
  });

  test("a client's message is escaped, not run", async ({ page }) => {
    let alerted = false;
    await wire(page, {
      thread: {
        ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
        items: [{ id: "m", conversation_id: INBOX.items[0].id, direction: "inbound",
                  channel: "sms", rendered_body: "<img src=x onerror=\"window.__x=1\">",
                  subject: null, status: "received", sender_staff_id: null, sender_name: null,
                  blocked_reason: null, last_error: null, created_at: "2026-08-02T11:00:00Z" }]
      }
    });
    await page.goto(SCREEN);
    await page.locator(".convo").first().click();
    await expect(page.locator(".msg .bubble")).toContainText("<img");
    alerted = await page.evaluate(() => window.__x === 1);
    expect(alerted).toBe(false);
  });
});

/* Nothing on this screen may throw on load. A single uncaught error stops every
   line after it, and the page still LOOKS fine — it just quietly does nothing.
   That is the failure this case exists for, and it is the one a unit test
   cannot see.

   FAILED EXTERNAL RESOURCES ARE NOT COUNTED, and that is not a loophole. The
   screen links a Google Fonts stylesheet; the build container's egress policy
   refuses it, so Chromium logs ERR_CONNECTION_RESET on every load here and
   would not in a browser on the open internet. Counting it would make this case
   fail for a reason that has nothing to do with the page and teach whoever hit
   it to delete the check. A missing font is a cosmetic fallback. A thrown
   exception is not, and `pageerror` — which is the real signal — is counted
   unconditionally. */
const EXTERNAL_RESOURCE = /Failed to load resource/i;

test("the screen loads with no javascript errors", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !EXTERNAL_RESOURCE.test(m.text())) errors.push(m.text());
  });

  await wire(page);
  await page.goto(SCREEN);
  await page.locator(".convo").first().click();
  await expect(page.locator(".msg").first()).toBeVisible();

  expect(errors).toEqual([]);
});
