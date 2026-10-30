/* Tests for public/app/messaging.html — the staff reply inbox.
 *
 * TWO HALVES, the same shape as src/http/pipeline-screen.test.mjs:
 *
 *   THE VIEW MODEL. The block between FH-INBOX-BEGIN/END is lifted out and run
 *   in a vm, so the rules with consequences — what a row says, which count is
 *   which, and above all what each send outcome MEANS — are driven directly
 *   rather than inferred from markup.
 *
 *   THE WIRING. Assertions on the page text: that the sample transcript is
 *   gone, that the three reads and the one write are actually called, and that
 *   nothing claims a fact no endpoint answers.
 *
 * THE OUTCOME CASES ARE THE ONES THAT MATTER. A message the compliance gate
 * held and a message queued for the morning are both "not delivered", and if
 * the screen says the same thing about them somebody either retypes a text
 * that is already going out, or believes a blocked one went. That is a real
 * consequence in a regulated product, so each outcome is asserted by name.
 *
 * It lives under src/ rather than public/ because package.json's test glob only
 * walks src/ and scripts/ (CLAUDE.md §12).
 */
import { test, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCREEN = path.resolve(HERE, "../../public/app/messaging.html");
const HTML = fs.readFileSync(SCREEN, "utf8");

const BEGIN = "/* FH-INBOX-BEGIN */";
const END = "/* FH-INBOX-END */";

function loadViewModel() {
  const a = HTML.indexOf(BEGIN);
  const b = HTML.indexOf(END);
  assert.ok(a !== -1 && b > a, "the FH-INBOX markers are gone from messaging.html");
  const sandbox = { window: {} };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(HTML.slice(a + BEGIN.length, b), sandbox, { filename: SCREEN + "#FH-INBOX" });
  assert.ok(sandbox.window.FHInbox, "the view model did not attach itself to window");
  return sandbox.window.FHInbox;
}

const NOW = Date.parse("2026-08-02T12:00:00Z");
const ago = (ms) => new Date(NOW - ms).toISOString();

describe("messaging.html — what a conversation row says", () => {

  test("a person with no name on file is named honestly, not left blank", () => {
    const V = loadViewModel();
    assert.equal(V.displayName({ first_name: "Ada", last_name: "Byron" }), "Ada Byron");
    assert.equal(V.displayName({ first_name: "Ada", last_name: null }), "Ada");
    assert.equal(V.displayName({}), "Unnamed client");
    assert.equal(V.displayName(null), "Unnamed client");
  });

  // An avatar reading "A" for somebody whose name we do not have is a small lie
  // that looks like data.
  test("initials fall back to a dash rather than to an invented letter", () => {
    const V = loadViewModel();
    assert.equal(V.initials({ first_name: "Ada", last_name: "Byron" }), "AB");
    assert.equal(V.initials({}), "—");
    assert.equal(V.initialsFromName(""), "—");
    assert.equal(V.initialsFromName("Jordan Blake"), "JB");
  });

  test("a thread with no messages says so instead of showing an empty quote", () => {
    const V = loadViewModel();
    assert.equal(V.previewOf({ last_body: null }), "No messages on this thread yet.");
    assert.equal(V.previewOf({ last_body: "   " }), "No messages on this thread yet.");
    assert.equal(V.previewOf({ last_body: "call me back" }), "call me back");
  });

  test("the time is coarse and never negative, whatever a clock says", () => {
    const V = loadViewModel();
    assert.equal(V.shortWhen(ago(30 * 1000), NOW), "now");
    assert.equal(V.shortWhen(ago(5 * 60 * 1000), NOW), "5m");
    assert.equal(V.shortWhen(ago(3 * 3600 * 1000), NOW), "3h");
    assert.equal(V.shortWhen(ago(2 * 86400 * 1000), NOW), "Jul 31");
    assert.equal(V.shortWhen(null, NOW), "");
    assert.equal(V.shortWhen("not a date", NOW), "");
    // A row stamped a second in the future (clock skew) must not read "-1m".
    assert.equal(V.shortWhen(new Date(NOW + 5000).toISOString(), NOW), "now");
  });

  test("the message body is escaped — a client's text is not markup", () => {
    const V = loadViewModel();
    const html = V.conversationRow(
      { id: "c1", first_name: "Ada", channel: "sms", last_body: "<img src=x onerror=alert(1)>" }, {});
    assert.ok(!html.includes("<img"), "a client's message was rendered as HTML");
    assert.ok(html.includes("&lt;img"));
  });

  test("provider JSON errors are shown as a useful delivery reason", () => {
    const V = loadViewModel();
    const html = V.messageRow({
      id: "m1", direction: "outbound", channel: "sms", status: "failed",
      rendered_body: "A message", last_error: JSON.stringify({ code: 21211, message: "Invalid To Phone Number: +1665..." })
    });
    assert.match(html, /Invalid recipient phone number \(Twilio 21211\)/);
    assert.doesNotMatch(html, /Invalid To Phone Number|&quot;code&quot;/);
  });
});

describe("messaging.html — the unread indication", () => {

  // "Needs reply", not "unread": nothing in this system records who has READ a
  // thread. See the header of api/read/inbox.mjs.
  test("a thread the client spoke on last is marked; one we answered is not", () => {
    const V = loadViewModel();
    const waiting = V.conversationRow({ id: "a", channel: "sms", needs_reply: true }, {});
    const answered = V.conversationRow({ id: "b", channel: "sms", needs_reply: false }, {});
    assert.match(waiting, /class="convo unread/);
    assert.match(waiting, /unread-dot/);
    assert.match(waiting, /Waiting on us/);
    assert.ok(!/unread-dot/.test(answered), "an answered thread is marked as needing a reply");
  });

  test("a thread with no messages is neither waiting nor answered", () => {
    const V = loadViewModel();
    // needs_reply is null when there is no last message. Null is not false and
    // must not be counted as either.
    const row = V.conversationRow({ id: "c", channel: "email", needs_reply: null }, {});
    assert.ok(!/unread-dot/.test(row));
    assert.deepEqual(V.countsFor([{ needs_reply: null }, { needs_reply: true }, { needs_reply: false }]),
      { all: 3, reply: 1 });
  });

  test("the counts are of real rows, and an empty inbox counts zero", () => {
    const V = loadViewModel();
    assert.deepEqual(V.countsFor([]), { all: 0, reply: 0 });
    assert.deepEqual(V.countsFor(null), { all: 0, reply: 0 });
  });

  test("the Needs-reply tab filters to exactly those threads", () => {
    const V = loadViewModel();
    const rows = [
      { id: "1", first_name: "Ada", needs_reply: true, last_body: "hello" },
      { id: "2", first_name: "Bob", needs_reply: false, last_body: "thanks" },
      { id: "3", first_name: "Cy", needs_reply: null, last_body: null }
    ];
    assert.deepEqual(V.filterRows(rows, { filter: "reply" }).map((r) => r.id), ["1"]);
    assert.deepEqual(V.filterRows(rows, { filter: "all" }).map((r) => r.id), ["1", "2", "3"]);
    assert.deepEqual(V.filterRows(rows, { filter: "all", q: "bob" }).map((r) => r.id), ["2"]);
    assert.deepEqual(V.filterRows(rows, { filter: "all", q: "thanks" }).map((r) => r.id), ["2"]);
    assert.deepEqual(V.filterRows(rows, { filter: "all", q: "nobody" }), []);
  });

  /* HOLE 15, the half the database fix does not reach. The screen opens on
     "Needs reply". Everything the system sends is outbound, so a client we have
     only ever texted is never on that tab — and typing their name into a box
     labelled "Search people and messages" answered "Nothing matches what you
     typed" about somebody the company had messaged three times. */
  test("a search looks at everyone, even from the Needs-reply tab", () => {
    const V = loadViewModel();
    const rows = [
      { id: "1", first_name: "Ada", needs_reply: true, last_body: "hello" },
      { id: "2", first_name: "Horse", last_name: "Twentyseven", needs_reply: false, last_body: "You're in" }
    ];
    assert.deepEqual(
      V.filterRows(rows, { filter: "reply", q: "horse" }).map((r) => r.id), ["2"],
      "a person we have only sent to is still hidden from the search");
    // And clearing the box hands the tab back, unchanged.
    assert.deepEqual(V.filterRows(rows, { filter: "reply", q: "" }).map((r) => r.id), ["1"]);
    assert.deepEqual(V.filterRows(rows, { filter: "reply", q: "  " }).map((r) => r.id), ["1"]);
  });

  test("and it says so, rather than quietly widening what the tab means", () => {
    const V = loadViewModel();
    assert.equal(V.searchScopeNote(12, false, "horse", "reply"), "Searching everyone, not just Needs reply.");
    assert.equal(V.searchScopeNote(12, false, "horse", "all"), "");
  });
});

describe("messaging.html — who sent a message", () => {

  test("a staff reply carries its author's name", () => {
    const V = loadViewModel();
    const html = V.messageRow(
      { id: "m1", direction: "outbound", channel: "sms", rendered_body: "on my way", status: "sent", sender_name: "Jordan Blake" },
      { clientName: "Ada Byron" });
    assert.match(html, /Jordan Blake/);
    assert.match(html, /out-human/);
    assert.ok(!/Automatic/.test(html));
  });

  // A workflow's message has no author. Attributing it to whoever is looking at
  // the screen would be inventing an actor.
  test("a message with no author is labelled automatic, not attributed to anyone", () => {
    const V = loadViewModel();
    const html = V.messageRow(
      { id: "m2", direction: "outbound", channel: "sms", rendered_body: "reminder", status: "sent", sender_name: null },
      { clientName: "Ada Byron" });
    assert.match(html, /Automatic/);
    assert.match(html, /out-agent/);
  });

  test("an inbound message is the client's, on the client's side", () => {
    const V = loadViewModel();
    const html = V.messageRow(
      { id: "m3", direction: "inbound", channel: "sms", rendered_body: "any update?", status: "received" },
      { clientName: "Ada Byron", clientInitials: "AB" });
    assert.match(html, /Ada Byron/);
    assert.match(html, /bubble in/);
    assert.ok(!/class="msg out"/.test(html));
  });

  // The one place a staff member learns their reply did not go out.
  test("a held or blocked message says so on the message itself", () => {
    const V = loadViewModel();
    const blocked = V.messageRow(
      { id: "m4", direction: "outbound", channel: "sms", rendered_body: "hi", status: "blocked",
        blocked_reason: "opted_out", sender_name: "Jordan Blake" }, {});
    assert.match(blocked, /msg-error/);
    assert.match(blocked, /compliance check stopped it/);
    assert.match(blocked, /opted_out/);

    const sent = V.messageRow(
      { id: "m5", direction: "outbound", channel: "sms", rendered_body: "hi", status: "sent", sender_name: "Jordan Blake" }, {});
    assert.ok(!/msg-error/.test(sent), "a message that went out is flagged as a problem");
  });

  test("an email's subject is shown and a text's absent subject adds nothing", () => {
    const V = loadViewModel();
    const email = V.messageRow(
      { id: "m6", direction: "inbound", channel: "email", subject: "Re: my file", rendered_body: "attached" }, {});
    assert.match(email, /email-subj/);
    assert.match(email, /Re: my file/);
    const sms = V.messageRow({ id: "m7", direction: "inbound", channel: "sms", subject: null, rendered_body: "hi" }, {});
    assert.ok(!/email-subj/.test(sms));
  });
});

/* HOLE N16 (2026-09-18). Staff Messaging showed #13's two emails as the raw
   HTML page we sent — "<!DOCTYPE html> <html lang=…" in the bubble and in the
   list preview — and the side panel read "Last activity: never ago" on the
   pipeline deep link. The email below is the shape every outbound email is
   stored in (the branded wrapper around <p> paragraphs). */
const SENT_EMAIL = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>You're in</title>
<style>p{margin:0}</style>
</head>
<body style="margin:0;padding:0;">
<table role="presentation" width="100%"><tr><td>
  <p style="margin:0 0 16px 0;">Hey Sim,</p>
  <p style="margin:0 0 16px 0;">You&#39;re in. Here&rsquo;s how this works &amp; what&nbsp;next.</p>
  <p style="margin:0 0 16px 0;">1. Finish your application<br>
  2. Book a call</p>
  <p>Start here: https://apply.fundhub.ai/funding-book-call</p>
</td></tr></table>
</body>
</html>`;

describe("messaging.html — an email reads as text, never as raw HTML (N16)", () => {

  test("the stored HTML page becomes its readable words, line by line", () => {
    const V = loadViewModel();
    assert.equal(V.emailText(SENT_EMAIL),
      "Hey Sim,\n\nYou're in. Here’s how this works & what next.\n\n1. Finish your application\n2. Book a call\n\n" +
      "Start here: https://apply.fundhub.ai/funding-book-call");
  });

  test("the bubble shows the words, not the tags, the title or the styles", () => {
    const V = loadViewModel();
    const html = V.messageRow({ id: "e1", direction: "outbound", channel: "email", status: "delivered",
      subject: "You're in — here's what happens next", rendered_body: SENT_EMAIL }, {});
    assert.ok(!/&lt;|DOCTYPE|<html|<table|<p\b|<style|margin:0/i.test(html), "raw email HTML reached the bubble");
    // The body starts at the greeting — the <title> did not leak in ahead of it.
    assert.match(html, /<\/div>Hey Sim,<br><br>You&#39;re in\. Here’s how this works &amp; what next\./);
    assert.match(html, /1\. Finish your application<br>2\. Book a call/);
  });

  test("nothing inside an email can run or render — the text is still escaped", () => {
    const V = loadViewModel();
    const evil = "<html><body><p>hi</p><script>window.__x=1</script>" +
      "<img src=x onerror=alert(1)><p>&lt;script&gt;alert(2)&lt;/script&gt;</p></body></html>";
    const html = V.messageRow({ id: "e2", direction: "inbound", channel: "email", rendered_body: evil }, {});
    assert.ok(!/<script|<img|onerror=alert\(1\)|window\.__x/i.test(html), "active markup survived");
    // An entity that spells a tag is decoded to text and then escaped again.
    assert.match(html, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  });

  test("the list preview is the email's words on one line", () => {
    const V = loadViewModel();
    const prev = V.previewOf({ channel: "email", last_body: SENT_EMAIL });
    assert.ok(prev.startsWith("Hey Sim, You're in."), prev);
    assert.ok(!/[<>\n]/.test(prev));
    const row = V.conversationRow({ id: "c9", first_name: "Sim", channel: "email", last_body: SENT_EMAIL }, {});
    assert.ok(!/DOCTYPE|&lt;html/i.test(row), "the list row still previews raw HTML");
    assert.equal(V.previewOf({ channel: "email", last_body: "<html><body><img src=x></body></html>" }),
      "An email with no text in it.");
  });

  test("a text message that merely contains '<' is left exactly as it was", () => {
    const V = loadViewModel();
    assert.equal(V.looksLikeHtmlEmail("I <3 you <br>", "sms"), false);
    assert.equal(V.previewOf({ channel: "sms", last_body: "I <3 you <b>" }), "I <3 you <b>");
    assert.equal(V.looksLikeHtmlEmail("see you at 3 < 4", "email"), false);
    const html = V.messageRow({ id: "s1", direction: "inbound", channel: "sms", rendered_body: "I <3 <b>you</b>" }, {});
    assert.match(html, /I &lt;3 &lt;b&gt;you&lt;\/b&gt;/);
  });
});

describe("messaging.html — Last activity is a real time or a plain word (N16)", () => {

  test("it never reads 'never ago', 'now ago' or '<date> ago'", () => {
    const V = loadViewModel();
    assert.equal(V.lastActivity(null, NOW), "No messages yet");
    assert.equal(V.lastActivity("not a date", NOW), "No messages yet");
    assert.equal(V.lastActivity(ago(20 * 1000), NOW), "Just now");
    assert.equal(V.lastActivity(ago(12 * 60 * 1000), NOW), "12m ago");
    assert.equal(V.lastActivity(ago(4 * 3600 * 1000), NOW), "4h ago");
    // After a day it is the Arizona date and time (UI-STANDARDS §7), no "ago".
    assert.equal(V.lastActivity("2026-07-31T01:30:00Z", NOW), "Jul 30, 6:30 PM");
  });

  test("the side panel uses it, and no longer glues ' ago' onto a word", () => {
    assert.ok(!/\|\|\s*"never"\)\s*\+\s*" ago/.test(HTML), "the old 'never' + ' ago' line is back");
    assert.match(HTML, /id="ctxLast"/);
    assert.match(HTML, /V\.lastActivity\(when, Date\.now\(\)\)/);
  });

  test("the pipeline deep link carries the thread's time into the side panel", () => {
    assert.match(HTML, /last_pulse_at: \(pick && pick\.last_pulse_at\) \|\| null/);
  });
});

describe("messaging.html — what the screen says after a send", () => {

  test("accepted is not delivered: each outcome is a different sentence", () => {
    const V = loadViewModel();
    const texts = ["sent", "deferred", "blocked", "no_route", "no_address", "retry", "rejected"]
      .map((o) => V.outcomeMessage(o).text);
    assert.equal(new Set(texts).size, texts.length,
      "two different send outcomes are reported to the user with the same words");
  });

  test("a text held for quiet hours tells the person NOT to send it again", () => {
    const V = loadViewModel();
    const out = V.outcomeMessage("deferred");
    assert.equal(out.tone, "hold");
    assert.match(out.text, /8:00am Arizona time/);
    assert.match(out.text, /do not need to send it again/i);
    assert.ok(!/failed|error|not sent/i.test(out.text), "a deferral is being reported as a failure");
  });

  /* ONE RULE, ONE SENTENCE. The warning above the compose box and the reply
     after Send describe the same thing, and if they drift a staff member reads
     them as two different rules. They said "11am Eastern" and "11:00am Eastern"
     for a while, which is exactly how that starts. The wording is Arizona time
     now; the drift risk is identical. */
  test("the hold message and the texting-hours warning use the same words", () => {
    const V = loadViewModel();
    const afterSend = V.outcomeMessage("deferred").text;
    const beforeTyping = V.quietNotice("sms", Date.parse("2026-01-15T07:00:00Z")).text;
    for (const phrase of ["8:00am Arizona time", "do not need to send it again"]) {
      assert.ok(afterSend.includes(phrase), `the post-send message dropped "${phrase}"`);
      assert.ok(beforeTyping.includes(phrase), `the pre-typing warning dropped "${phrase}"`);
    }
  });

  test("a blocked message is reported as not sent, and names why when we know", () => {
    const V = loadViewModel();
    const out = V.outcomeMessage("blocked", ["opted_out"]);
    assert.equal(out.tone, "stop");
    assert.match(out.text, /Not sent/);
    assert.match(out.text, /opted_out/);
  });

  test("a missing phone number and a missing provider are different problems", () => {
    const V = loadViewModel();
    assert.match(V.outcomeMessage("no_address").text, /phone number or email address/);
    assert.match(V.outcomeMessage("no_route").text, /provider is set up/);
  });

  // An outcome nobody has taught this screen about must not become "Sent."
  test("an unknown outcome is never reported as sent", () => {
    const V = loadViewModel();
    const out = V.outcomeMessage("something_new_from_the_dispatcher");
    assert.notEqual(out.tone, "ok");
    assert.ok(!/^Sent\./.test(out.text));
  });
});

describe("messaging.html — the wiring", () => {

  test("the sample transcript and its cast are gone from the page", () => {
    for (const sample of ["Priya Nair", "Jordan Blake", "Maria Delgado", "Felix Ndiaye",
                          "Grace Kowalski", "Nair Catering", "$12,400", "$18,500"]) {
      assert.ok(!HTML.includes(sample), `the sample value ${JSON.stringify(sample)} is still in the page`);
    }
  });

  test("the three reads and the one write are all actually called", () => {
    assert.match(HTML, /FHData\.inbox\(/, "the conversation list is not wired to /api/read/inbox");
    assert.match(HTML, /FHData\.thread\(/, "the thread is not wired to /api/read/messages");
    assert.match(HTML, /FHData\.conversations\(/, "the context panel is not wired to /api/read/conversations");
    assert.match(HTML, /FHData\.sendMessage\(/, "the compose box does not send anything");
  });

  test("the compose box is a real control, not a div pretending to be one", () => {
    assert.match(HTML, /<textarea[^>]*id="composeBody"/);
    assert.match(HTML, /<button class="send-btn" id="sendBtn"/);
    // Disabled until a conversation is open — there is nowhere to send to.
    assert.match(HTML, /id="composeBody"[\s\S]{0,200}?disabled/);
  });

  test("the send carries an idempotency key so a retry cannot double-send", () => {
    assert.match(HTML, /idempotency_key:/);
  });

  test("empty states are honest — no rows and a failed read say different things", () => {
    assert.match(HTML, /No conversations yet\./);
    assert.match(HTML, /Nothing matches what you typed\./);
    assert.match(HTML, /We could not load your conversations\./);
    assert.match(HTML, /Nothing has been said on this thread yet\./);
  });

  test("the context panel claims nothing the endpoints do not answer", () => {
    // These four were sample values with no endpoint behind them. A made-up
    // funding number beside a live thread is something somebody reads aloud.
    for (const invented of ["Prequal estimate", "Temperature", "Available credit", "Requested draw"]) {
      assert.ok(!HTML.includes(invented), `the context panel still shows "${invented}", which nothing answers`);
    }
  });

  // sentiment is NULL for every row in this codebase and nothing computes it.
  test("no sentiment is rendered, because nothing computes one", () => {
    assert.ok(!/Hot|Warm|Cold/.test(HTML.replace(/<!--[\s\S]*?-->/g, "")),
      "a Hot/Warm/Cold reading is on screen and no code in this repository produces one");
  });
});

describe("messaging.html — the texting-hours warning, before anyone types", () => {

  /* The owner had never heard of the overnight rule. That is the whole reason
     this block exists: the rule was enforced at send time and stated nowhere,
     so the first anybody knew of it was a reply that did not go out. */

  test("the screen's window is the same window the server enforces", async () => {
    const V = loadViewModel();
    // Read the gate's own constants rather than restating them, so the screen
    // cannot end up promising a window the server does not honour.
    const gate = await import("../messaging/gate.mjs");
    assert.equal(V.QUIET_START_HOUR, gate.QUIET_START_HOUR);
    assert.equal(V.QUIET_END_HOUR, gate.QUIET_END_HOUR);
  });

  test("it reads the hour in Arizona, not in the viewer's own timezone", () => {
    const V = loadViewModel();
    // Arizona is UTC-7 every day of the year. A staff member in Manila must see
    // the rule the server actually enforces, not the clock on their own wall.
    assert.equal(V.hourInZone(Date.parse("2026-01-15T04:00:00Z")), 21);
    assert.equal(V.hourInZone(Date.parse("2026-01-15T18:00:00Z")), 11);
  });

  test("the window wraps midnight — it is shut at midnight and open at 10am", () => {
    const V = loadViewModel();
    assert.equal(V.inQuietHours(Date.parse("2026-01-15T07:00:00Z")), true);  // 00:00 MST
    assert.equal(V.inQuietHours(Date.parse("2026-01-15T05:00:00Z")), true);  // 22:00 MST
    assert.equal(V.inQuietHours(Date.parse("2026-01-15T17:00:00Z")), false); // 10:00 MST
    // 19:00 MST is the last hour the window is OPEN — one hour before it shuts.
    // Getting this boundary backwards yields a window that is never open, which
    // is why it is asserted rather than assumed.
    assert.equal(V.inQuietHours(Date.parse("2026-01-15T02:00:00Z")), false); // 19:00 MST
    assert.equal(V.inQuietHours(Date.parse("2026-01-15T03:00:00Z")), true);  // 20:00 MST — shuts
  });

  test("a text thread states the rule up front, before anything is typed", () => {
    const V = loadViewModel();
    const open = V.quietNotice("sms", Date.parse("2026-01-15T17:00:00Z"));
    assert.equal(open.closed, false);
    assert.match(open.text, /8:00am to 8:00pm Arizona time/);
    assert.match(open.text, /held and sent the next morning/);
  });

  test("inside the window it says plainly that this will not go now, and when it will", () => {
    const V = loadViewModel();
    const shut = V.quietNotice("sms", Date.parse("2026-01-15T07:00:00Z"));
    assert.equal(shut.closed, true);
    assert.match(shut.text, /8:00am Arizona time/);
    // The single most important sentence on the screen at 2am: do not retype it.
    assert.match(shut.text, /do not need to send it again/i);
  });

  test("email threads say nothing about it, because it does not apply to them", () => {
    const V = loadViewModel();
    assert.equal(V.quietNotice("email", Date.parse("2026-01-15T07:00:00Z")).text, "");
    assert.equal(V.quietNotice(null, Date.parse("2026-01-15T07:00:00Z")).text, "");
  });

  test("the notice is in the page and repaints on a timer, not only on load", () => {
    assert.match(HTML, /id="quietNote"/);
    assert.match(HTML, /paintQuietNote\(/);
    // A browser left open across 11pm must stop saying the window is open.
    assert.match(HTML, /setInterval\([\s\S]{0,200}?paintQuietNote/);
  });
});

describe("messaging.html — pipeline deep link", () => {

  test("a client_id link honors channel=email or channel=sms", () => {
    assert.match(HTML, /FHData\.param\("client_id"\)/);
    assert.match(HTML, /FHData\.param\("channel"\)/);
    assert.match(HTML, /deepChannel === "email"/);
    assert.match(HTML, /deepChannel === "sms"/);
  });
});

describe("messaging.html — what happens when there are a lot of conversations", () => {

  test("the Needs-reply tab asks the server, so it cannot show a partial answer", () => {
    assert.match(HTML, /params\.needs_reply\s*=\s*1/,
      "the tab is still filtered in the browser, which at scale shows the unanswered " +
      "threads among the loaded page while looking like it shows all of them");
    // Switching tabs is a new question, so it refetches rather than re-slicing.
    assert.match(HTML, /state\.filter = tab\.getAttribute\("data-filter"\);\s*\n[\s\S]{0,300}?loadList\(\)/);
    // ...and a search lifts it, or the server would hand back a page that
    // cannot contain the person being searched for.
    assert.match(HTML, /state\.filter === "reply" && !String\(state\.q[\s\S]{0,40}?params\.needs_reply = 1/);
    // Crossing empty↔typed is what changes that query, so it refetches once.
    assert.match(HTML, /was !== now && state\.filter === "reply"[\s\S]{0,40}?loadList/);
  });

  test("the search box says when it is only searching what is loaded", () => {
    const V = loadViewModel();
    assert.equal(V.searchScopeNote(200, true, "ada", "all"), "Searching the 200 most recent conversations only.");
    // Nothing to disclose when everything is loaded, or when nobody is searching.
    assert.equal(V.searchScopeNote(12, false, "ada", "all"), "");
    assert.equal(V.searchScopeNote(200, true, "", "all"), "");
    assert.equal(V.searchScopeNote(200, true, "   ", "all"), "");
  });

  test("the inbox refreshes itself, so a message that arrives is actually seen", () => {
    assert.match(HTML, /REFRESH_MS/);
    assert.match(HTML, /setInterval\([\s\S]{0,300}?loadList\(\{ quiet: true \}\)/);
    // A background tab is not somebody looking at the screen.
    assert.match(HTML, /document\.hidden/);
    // And a refresh must not land in the middle of a send.
    assert.match(HTML, /if \(state\.sending\) return;/);
  });

  test("a failed background refresh leaves the working screen alone", () => {
    // Blanking a live inbox because one poll missed would take the thread
    // somebody is mid-reply to off the screen.
    assert.match(HTML, /if \(quiet\) \{ FHData\.explain\(res, "conversations"\); return; \}/);
  });

  test("an empty Needs-reply tab reads as good news, not as an error", () => {
    assert.match(HTML, /Nothing is waiting on a reply/);
  });
});

/* ── T5-08 / T5-12 / T5-13 · the destination box ──────────────────────────
   Proven live on 2026-08-18 as owner: the Messaging screen had 28 controls and
   exactly two inputs — the search box and the message body. There was nowhere
   to say who a message was going to, so it could only ever go to whatever was
   already on the person's record, and when that was empty the send failed with
   nothing the sender could do about it from this screen. */

describe("the destination box", () => {

  test("there is a real, labelled destination control", () => {
    assert.match(HTML, /<input[^>]*id="composeTo"/, "no destination input on the screen");
    assert.match(HTML, /<label for="composeTo"/, "the box has no label, so nobody knows what it is");
    // Disabled until a conversation is open, exactly like the body.
    assert.match(HTML, /id="composeTo"[\s\S]{0,240}?disabled/);
  });

  test("what is typed is actually sent", () => {
    assert.match(HTML, /payload\.to = to/, "the box is decoration unless it reaches the request");
  });

  test("the screen never writes the typed address back to the client record", () => {
    /* T5-13. Sending one message somewhere else and CORRECTING somebody's file
       are different acts, and doing the first by way of the second is how a
       one-off send permanently redirects a real client's mail. */
    assert.ok(!/FHData\.(updateClient|saveClient|patchClient)/.test(HTML),
      "the screen must not save the typed address onto the person's record");
  });

  test("a good email and a good phone number are accepted", () => {
    const V = loadViewModel();
    assert.equal(V.addressLooksRight("email", "someone@example.com").ok, true);
    assert.equal(V.addressLooksRight("sms", "+15551234567").ok, true);
    assert.equal(V.addressLooksRight("email", "  someone@example.com  ").ok, true, "trimmed");
  });

  test("a bad address is refused BEFORE anything is written", () => {
    const V = loadViewModel();
    for (const bad of ["someone", "someone@", "@example.com", "someone example.com"]) {
      assert.equal(V.addressLooksRight("email", bad).ok, false, `"${bad}" should be refused`);
    }
    for (const bad of ["5551234567", "555-123-4567", "+0555123", "not a number"]) {
      assert.equal(V.addressLooksRight("sms", bad).ok, false, `"${bad}" should be refused`);
    }
  });

  test("an empty box says what is missing, not just that it is wrong", () => {
    /* This is the sentence that replaces the dead end. Before, the person got
       "Not sent. We do not have a phone number or email address for this
        person." AFTER pressing Send, with no way to supply one. */
    const V = loadViewModel();
    const sms = V.addressLooksRight("sms", "");
    assert.equal(sms.ok, false);
    assert.equal(sms.empty, true);
    assert.match(sms.text, /phone number/i);
    assert.match(sms.text, /type one/i, "it has to say what to do about it");
    /* `empty` is reported separately from `ok` because the screen treats the two
       differently: an empty box still SENDS, falling back to the address on the
       client's record exactly as it always did. Gating Send on the box being
       filled coupled sending to a separate client read, so a slow or failed
       fetch killed the button — worse than the bug the box was added to fix. */

    const email = V.addressLooksRight("email", "");
    assert.match(email.text, /email address/i);
    assert.match(email.text, /type one/i);
  });

  test("an empty box and a malformed one are different sentences", () => {
    const V = loadViewModel();
    const empty = V.addressLooksRight("email", "");
    const wrong = V.addressLooksRight("email", "nonsense");
    assert.notEqual(empty.text, wrong.text,
      "'we have nothing for them' and 'that is not an address' are different problems");
  });

  test("the browser check matches what the server will accept", () => {
    /* If the box says yes to something compose.mjs refuses, the person is told
       it is fine and then told it is not. The two shapes are kept identical on
       purpose — this test is what notices when one of them moves. */
    const serverSrc = fs.readFileSync(path.resolve(HERE, "../messaging/compose.mjs"), "utf8");
    assert.ok(serverSrc.includes("/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/"),
      "the email shape in compose.mjs is not the one this screen checks");
    assert.ok(serverSrc.includes("/^\\+[1-9]\\d{7,14}$/"),
      "the phone shape in compose.mjs is not the one this screen checks");
  });

  test("a voice message cannot be addressed by hand", () => {
    const V = loadViewModel();
    assert.equal(V.addressLooksRight("voice", "+15551234567").ok, false,
      "there is no staff voice compose, and inventing one is a step no journey names");
  });
});

/* ───────────────────────────────────────────────────────────────────────────
   THE BROWSER TEST'S WORDS MUST BE THE SCREEN'S WORDS.

   CLAUDE.md §12 records that `npm test` globs `src/**` and `scripts/**` only.
   e2e/ is not in it — it runs under `npm run test:e2e`, in CI, in a browser.
   So when the texting-hours copy moved from Eastern to Arizona time, every
   unit test here was updated and went green, and two Playwright specs kept
   asserting the old sentence for another twenty minutes until CI said so.

   This closes that loop from the side that DOES run on every `npm test`: pull
   the quoted sentences straight out of the browser spec and check the screen
   still says them. It fails locally, in seconds, the next time the copy moves
   and the spec does not.
   ─────────────────────────────────────────────────────────────────────────── */
test("the texting-hours copy the browser test expects is the copy the screen ships", () => {
  const specPath = path.resolve(HERE, "../../e2e/messaging-inbox.spec.mjs");
  const spec = fs.readFileSync(specPath, "utf8");
  const html = fs.readFileSync(path.resolve(HERE, "../../public/app/messaging.html"), "utf8");

  // Every toContainText("...") the spec asserts against #quietNote or #sendStatus.
  const quoted = [...spec.matchAll(/toContainText\("([^"]+)"\)/g)].map((m) => m[1]);
  const aboutHours = quoted.filter((t) => /am|pm|Texting hours|send it again/i.test(t));

  assert.ok(aboutHours.length >= 3,
    `expected the browser spec to still assert the texting-hours wording, found ${aboutHours.length}`);

  for (const phrase of aboutHours) {
    assert.ok(
      html.includes(phrase),
      `e2e/messaging-inbox.spec.mjs expects "${phrase}" but messaging.html does not say it`
    );
  }

  // And the old zone must not survive in either place.
  assert.ok(!/Eastern/.test(spec), "the browser spec still mentions Eastern");
  assert.ok(!/Eastern/.test(html), "the messaging screen still mentions Eastern");
});
