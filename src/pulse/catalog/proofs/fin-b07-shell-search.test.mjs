// Practice test for the shell's Search button and Cmd/Ctrl+K: the REAL shell.js loaded on a real staff
// screen, in a browser, with the search read answered by a stand-in. The server half (company scope,
// refused roles, wildcards) is held by fin-b07-search.test.mjs; this holds the control itself:
//
//   * the Search button is on the screen and opens the overlay; Cmd/Ctrl+K opens it, and again closes it;
//     Escape and a click on the backdrop close it
//   * a typed word asks /api/read/search with that word, and the answer is drawn in the five groups the
//     read names (Clients, Contracts, Documents, Conversations, Pipeline), each hit linking where the
//     row says
//   * an empty box says what to type, a word with no matches says so, and a refused read says the
//     person is not signed in rather than "no matches"

import assert from "node:assert/strict";
import test from "node:test";

import { json, startScreens } from "./s4-screen-harness.mjs";

const OWNER = {
  ok: true,
  staff: { id: "staff-1", name: "Jordan Blake", email: "jordan@fundhub.test", role: "owner", org_id: "org-1", status: "active" },
};

const GROUPS = {
  clients: [{ title: "Ada Lovelace", subtitle: "ada@example.com", href: "/app/client-control-panel.html?id=11111111-1111-4111-8111-111111111111" }],
  contracts: [{ title: "Funding agreement", subtitle: "Signed October 3", href: "/app/contracts.html?id=22222222-2222-4222-8222-222222222222" }],
  documents: [{ title: "Bank statement", subtitle: "ada-statement.pdf", href: "/app/documents.html?client_id=11111111-1111-4111-8111-111111111111" }],
  conversations: [{ title: "Re: your funding round", subtitle: "Text thread", href: "/app/messaging.html?conversation_id=33333333-3333-4333-8333-333333333333" }],
  cards: [{ title: "Ada Co", subtitle: "Sales / Booked", href: "/app/pipeline.html?card=44444444-4444-4444-8444-444444444444" }],
};

function handlers(record, answer) {
  return {
    "/api/read/search": (route, { url }) => {
      record.push(url);
      return answer(route, url);
    },
  };
}

async function openStaffScreen(t, record, answer) {
  const { open } = await startScreens(t);
  const { page } = await open("/app/staff-teams.html", { session: OWNER, handlers: handlers(record, answer) });
  await page.waitForSelector("#fh-shell-search-btn");
  return page;
}

const isOpen = (page) => page.evaluate(() => document.getElementById("fh-shell-search-overlay").classList.contains("open"));

test("the Search button opens the overlay, Cmd/Ctrl+K opens and closes it, Escape and the backdrop close it", async (t) => {
  const record = [];
  const page = await openStaffScreen(t, record, (route) => json(route, { ok: true, groups: {} }));

  assert.equal(await isOpen(page), false);
  assert.match((await page.locator("#fh-shell-search-btn").innerText()), /Search/);

  await page.locator("#fh-shell-search-btn").click();
  assert.equal(await isOpen(page), true);
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "fh-shell-search-input", "the box is ready to type in");
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(page), false);

  // The shortcut: Control on this machine type, and Meta, both open it; the same chord closes it.
  await page.keyboard.press("Control+k");
  assert.equal(await isOpen(page), true, "Ctrl+K opens");
  await page.keyboard.press("Control+k");
  assert.equal(await isOpen(page), false, "Ctrl+K again closes");
  await page.keyboard.press("Meta+k");
  assert.equal(await isOpen(page), true, "Cmd+K opens");
  await page.keyboard.press("Escape");
  assert.equal(await isOpen(page), false);

  // a click on the dark backdrop (not the panel) closes it
  await page.locator("#fh-shell-search-btn").click();
  assert.equal(await isOpen(page), true);
  await page.mouse.click(5, 5);
  assert.equal(await isOpen(page), false);
  assert.deepEqual(record, [], "opening and closing asks the server nothing");
  await page.close();
});

test("a typed word asks the search read for that word and the answer is drawn in the five groups, each hit linking where its row says", async (t) => {
  const record = [];
  const page = await openStaffScreen(t, record, (route) => json(route, { ok: true, groups: GROUPS }));

  await page.locator("#fh-shell-search-btn").click();
  assert.match(await page.locator("#fh-shell-search-results").innerText(), /Type a name, email, phone/);
  await page.locator("#fh-shell-search-input").fill("ada");
  await page.waitForSelector("#fh-shell-search-results .fh-search-hit");

  assert.equal(record.length, 1);
  assert.equal(new URL(record[0]).searchParams.get("q"), "ada", "the typed word is what is asked");
  assert.equal(new URL(record[0]).pathname, "/api/read/search");

  const heads = await page.locator("#fh-shell-search-results .fh-search-ghead")
    .evaluateAll((els) => els.map((e) => e.childNodes[0].textContent.trim()));
  assert.deepEqual(heads, ["Clients", "Contracts", "Documents", "Conversations", "Pipeline"]);
  const hits = await page.locator("#fh-shell-search-results a.fh-search-hit").evaluateAll((els) =>
    els.map((a) => ({ title: a.querySelector(".fh-search-title").textContent, sub: a.querySelector(".fh-search-sub").textContent, href: a.getAttribute("href") })));
  assert.deepEqual(hits.map((h) => h.title), ["Ada Lovelace", "Funding agreement", "Bank statement", "Re: your funding round", "Ada Co"]);
  assert.deepEqual(hits.map((h) => h.href), Object.values(GROUPS).map((rows) => rows[0].href));
  assert.equal(hits[0].sub, "ada@example.com");
  await page.close();
});

test("a word with no matches says so, and a refused read says the person is not signed in", async (t) => {
  const record = [];
  const page = await openStaffScreen(t, record, (route, url) => {
    if (url.includes("q=nobody")) return json(route, { ok: true, groups: { clients: [], contracts: [], documents: [], conversations: [], cards: [] } });
    return json(route, { ok: false, error: "forbidden" }, 403);
  });
  await page.locator("#fh-shell-search-btn").click();

  await page.locator("#fh-shell-search-input").fill("nobody");
  await page.waitForFunction(() => /No matches for/.test(document.getElementById("fh-shell-search-results").textContent));
  assert.match(await page.locator("#fh-shell-search-results").innerText(), /No matches for .nobody./);

  await page.locator("#fh-shell-search-input").fill("refused");
  await page.waitForFunction(() => /Not signed in/.test(document.getElementById("fh-shell-search-results").textContent));
  assert.doesNotMatch(await page.locator("#fh-shell-search-results").innerText(), /No matches/);
  await page.close();
});
