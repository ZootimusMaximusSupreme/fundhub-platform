// Batch 04, practice test for the unlock modal's "Ask an advisor / Talk to an
// advisor" buttons on public/app/client-portal.html.
//
// The buttons save nothing themselves. They open the portal chat with one sentence
// typed in for the client ("I would like a call about: <topic>"); the client then
// presses Send and the note lands through api/chat/portal-message.mjs. A live check
// can only read that note, and a prefill that breaks leaves the note without its
// opening words, which is a note the live check does not count. So the page's own
// code is RUN here: the two functions are cut out of the page (not copied), given
// a fake chat box and a fake document, and every button on the page is pressed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

import { PORTAL_CALL_REQUEST_SQL } from "./fin-b04-sql-messages.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = path.resolve(HERE, "../../../../public/app/client-portal.html");
const HTML = fs.readFileSync(PAGE, "utf8");

/** The page's call-request code, cut out of the page between two lines that bound it. */
function callRequestSource() {
  const start = HTML.indexOf("var bmDone  = document.getElementById('bm-done');");
  const end = HTML.indexOf("window.__openBook = openBook;");
  assert.ok(start > 0 && end > start, "the call-request block moved: update the two markers");
  return HTML.slice(start, end + "window.__openBook = openBook;".length);
}

const SOURCE = callRequestSource();

/** Run the page code with a chat that is mounted (or not) and one live booking (or none). */
function pageWith({ chatMounted = true, booking = null, typed = "" } = {}) {
  const chatInput = { value: typed, focused: false, focus() { this.focused = true; } };
  const panel = { classList: { open: false, contains(name) { return name === "open" && this.open; } } };
  const fab = { clicks: 0, click() { this.clicks += 1; panel.classList.open = true; } };
  const text = {};
  const handlers = [];
  const shown = [];
  const byId = {
    "bm-done": { hidden: true, querySelector: () => ({ textContent: "" }) },
    "bm-title": { set textContent(v) { text["bm-title"] = v; } },
    "bm-desc": { set textContent(v) { text["bm-desc"] = v; } },
    "bm-done-d": { set textContent(v) { text["bm-done-d"] = v; } }
  };
  if (chatMounted) Object.assign(byId, { "fh-chat-fab": fab, "fh-chat-panel": panel, "fh-chat-input": chatInput });
  const document = {
    getElementById: (id) => byId[id] || null,
    addEventListener: (type, fn) => { if (type === "click") handlers.push(fn); }
  };
  const window = { __portalBooking: booking };
  const context = vm.createContext({
    document, window, openM: (modal) => shown.push(modal), bookM: "book-modal"
  });
  vm.runInContext(SOURCE, context);
  return {
    chatInput, fab, text, shown,
    openBook: (topic) => window.__openBook(topic),
    /** Press a button the way the page's click handler sees it. */
    press(topic, id = "") {
      const button = { id, dataset: { book: topic } };
      for (const handler of handlers) handler({ target: { closest: (selector) => (selector === "[data-book]" ? button : null) } });
    }
  };
}

// every topic a button on the page hands over
const TOPICS = [...HTML.matchAll(/data-book="([^"]*)"/g)].map((m) => m[1]);

test("the page has the buttons this test presses, each with a topic", () => {
  assert.ok(TOPICS.length >= 8, `expected the Ask / Talk to an advisor buttons, found ${TOPICS.length}`);
  for (const topic of TOPICS) assert.ok(topic.trim().length > 3, `a button hands over an empty or tiny topic: ${JSON.stringify(topic)}`);
});

test("pressing any Talk to an advisor button opens the chat with the topic filled in after the words the saved note starts with", () => {
  for (const topic of new Set(TOPICS)) {
    const page = pageWith();
    page.press(topic);
    assert.equal(page.fab.clicks, 1, `${topic}: the chat was not opened`);
    assert.equal(page.chatInput.value, `I would like a call about: ${topic}`, topic);
    assert.equal(page.chatInput.focused, true, `${topic}: the cursor is not in the box`);
    assert.doesNotMatch(page.chatInput.value, /undefined|null|NaN|\[object/i);
  }
});

test("a button with no topic falls back to a real one, never an empty or a broken word", () => {
  for (const empty of ["", undefined, null]) {
    const page = pageWith();
    page.openBook(empty);
    assert.equal(page.chatInput.value, "I would like a call about: More funding");
  }
});

test("what the client already typed is kept, not written over", () => {
  const page = pageWith({ typed: "Please call after 3." });
  page.press("Capital Blueprint");
  assert.equal(page.chatInput.value, "Please call after 3.");
  assert.equal(page.fab.clicks, 1);
});

test("an already open chat is not clicked closed", () => {
  const page = pageWith();
  page.press("Capital Blueprint");
  page.chatInput.value = "";
  page.press("Capital Academy");
  assert.equal(page.fab.clicks, 1);
  assert.equal(page.chatInput.value, "I would like a call about: Capital Academy");
});

test("with no chat on the page the client is still told something true, with the topic", () => {
  const page = pageWith({ chatMounted: false });
  page.press("Capital Blueprint");
  assert.equal(page.shown.length, 1, "the fallback panel did not open");
  assert.match(page.text["bm-desc"], /Nothing is booked yet\. Use the chat button to ask for a call\. About: Capital Blueprint\./);
});

test("a call already on file is shown with the topic and the chat is left alone", () => {
  const page = pageWith({ booking: { when: "Tue 3 pm", title: "Strategy call", status: "booked" } });
  page.press("Capital Blueprint");
  assert.equal(page.fab.clicks, 0);
  assert.match(page.text["bm-desc"], /Strategy call — Tue 3 pm \(booked\)\. About: Capital Blueprint\./);
});

test("the sentence the buttons hand over is the one the saved-note check reads", () => {
  assert.match(PORTAL_CALL_REQUEST_SQL, /LIKE 'I would like a call about:%'/);
  assert.match(PORTAL_CALL_REQUEST_SQL, /\^I would like a call about:/);
  const page = pageWith();
  page.press("Funding, done-for-you");
  assert.ok(page.chatInput.value.startsWith("I would like a call about:"));
});
