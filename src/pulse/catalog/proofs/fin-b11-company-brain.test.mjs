// Batch 11 practice tests: the Company Brain screen (public/app/company-brain.html).
//
// Real page in Chromium, fake /api answers, every control pressed, and the exact request and the
// words painted judged. Nothing reaches a real database, a model or the network. This is a practice
// test, not a live check: the live checks for the saved results of Send, Past chats, Files you added
// and the owner's approve / turn down are in fin-b11-live-contracts.test.mjs.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bodyOf, dialogs, clearShellOverlays, json, OWNER, proofRows, sharedScreens, waitFor
} from "./fin-b11-kit.mjs";

const proof = proofRows(import.meta.url);
const { open } = sharedScreens();

/** A held answer: the stand-in server waits on wait() until release() is called. */
function gate() {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  return { wait, release };
}

const ADMIN = { ok: true, staff: { id: "staff-2", name: "Casey Reed", role: "admin", org_id: "org-1", status: "active" } };
const CLOSER = { ok: true, staff: { id: "staff-3", name: "Riley Park", role: "closer", org_id: "org-1", status: "active" } };
const CLIENT = { ok: true, staff: { id: "client-1", name: "Dana Whitfield", role: "client", org_id: "org-1", status: "active" } };
const PARTNER = { ok: true, staff: { id: "partner-1", name: "Pat Partner", role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111" } };

const T1 = "7b000000-0000-4000-8000-000000000001";
const T2 = "7b000000-0000-4000-8000-000000000002";
const F1 = "7c000000-0000-4000-8000-000000000001";
const F2 = "7c000000-0000-4000-8000-000000000002";
const F3 = "7c000000-0000-4000-8000-000000000003";
const R1 = "7d000000-0000-4000-8000-000000000001";
const R2 = "7d000000-0000-4000-8000-000000000002";
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const THREADS = () => ({
  ok: true,
  threads: [
    { id: T1, title: "How do I send a contract?", createdAt: minutesAgo(90), updatedAt: minutesAgo(30), messageCount: 2 },
    { id: T2, title: "Who approves a refund", createdAt: minutesAgo(3000), updatedAt: minutesAgo(2900), messageCount: 4 }
  ]
});
const TRANSCRIPT = {
  [T1]: {
    ok: true,
    thread: { id: T1, title: "How do I send a contract?" },
    messages: [
      { id: "m1", role: "user", text: "How do I send a contract?" },
      {
        id: "m2", role: "assistant", text: "Open the client and press Send contract.",
        sources: [{ n: 1, fileName: "Contracts SOP.pdf", webViewLink: "https://drive.example.test/contracts", accessTier: "staff", excerpt: "Press Send contract on the client." }],
        answerSource: "model", thin: false
      }
    ]
  },
  [T2]: {
    ok: true,
    thread: { id: T2, title: "Who approves a refund" },
    messages: [
      { id: "m3", role: "user", text: "Who approves a refund?" },
      { id: "m4", role: "assistant", text: "No matching documents in your clearance for that question.", sources: [], answerSource: "none", thin: true }
    ]
  }
};
const UPLOADS = () => ({
  ok: true,
  uploads: [
    { id: F1, name: "Refund policy.pdf", approvalStatus: "pending", accessTier: "owner", sizeBytes: 2048, uploadedByName: "Casey Reed", uploadedAt: minutesAgo(20) },
    { id: F2, name: "Sales script.docx", approvalStatus: "approved", accessTier: "sales", sizeBytes: 2 * 1048576, uploadedByName: "Jordan Blake", uploadedAt: minutesAgo(5000) },
    { id: F3, name: "Old notes.txt", approvalStatus: "rejected", accessTier: "owner", sizeBytes: null, uploadedByName: null, uploadedAt: minutesAgo(9000) }
  ],
  pendingCount: 1
});
const REVIEWS = () => ({
  ok: true,
  reviews: [
    { id: R1, file_id: F1, file_name: "Refund policy.pdf", proposed_tier: "staff", access_tier: "owner", rationale: "Reads like staff training.", kind: "upload", web_view_link: null },
    { id: R2, file_id: "drive-file-9", file_name: "Affiliate guide.pdf", drive_file_id: "1abc", proposed_tier: "affiliate", access_tier: "owner", rationale: "", kind: "classification", web_view_link: "https://drive.example.test/guide" }
  ]
});

/**
 * Open the screen with a stand-in server. `state` holds what each read answers (a test swaps them to
 * see a Refresh paint something new) and `log` holds every request the page made, in order.
 */
async function openBrain({ session = OWNER, viewport, state = {}, askAnswer, init = null } = {}) {
  const st = {
    threads: THREADS(), uploads: UPLOADS(), reviews: REVIEWS(), transcript: TRANSCRIPT, decide: null, uploadsError: null,
    reviewsError: null, askGate: null, openGate: null, ...state
  };
  const log = { asks: [], decides: [], threadReads: 0, threadOpens: [], uploadReads: 0, reviewReads: 0 };
  const handlers = {
    "/api/read/company-brain": async (route) => {
      const body = bodyOf(route);
      log.asks.push(body);
      if (st.askGate) await st.askGate.wait;
      const out = askAnswer
        ? askAnswer(log.asks.length, body)
        : { ok: true, question: body.question, thread_id: T1, answer: { text: `Answer ${log.asks.length}.`, thin: false, source: "model" }, sources: [], role: "owner" };
      return json(route, out, out.status || 200);
    },
    "/api/company-brain/threads": async (route, { url }) => {
      const id = new URL(url).searchParams.get("thread_id");
      if (id) {
        log.threadOpens.push(id);
        if (st.openGate) await st.openGate.wait;
        const found = st.transcript[id];
        return found ? json(route, found) : json(route, { ok: false, error: "thread_not_found" }, 404);
      }
      log.threadReads += 1;
      return json(route, st.threads);
    },
    "/api/company-brain/upload": async (route) => {
      log.uploadReads += 1;
      return st.uploadsError ? json(route, { ok: false, error: st.uploadsError.error }, st.uploadsError.status) : json(route, st.uploads);
    },
    "/api/company-brain/reviews": async (route, { method }) => {
      if (method === "POST") {
        const body = bodyOf(route);
        log.decides.push(body);
        const out = st.decide ? st.decide(body) : { status: 200, body: { ok: true, decision: body.decision === "approve" ? "approved" : "rejected" } };
        return json(route, out.body, out.status);
      }
      log.reviewReads += 1;
      return st.reviewsError ? json(route, { ok: false, error: st.reviewsError.error }, st.reviewsError.status) : json(route, st.reviews);
    }
  };
  const opened = await open("/app/company-brain.html", { session, handlers, ...(viewport ? { viewport } : {}), ...(init ? { init } : {}) });
  // File inventories and owner reviews load only after Manage files is opened.
  await waitFor(() => log.threadReads >= 1, "the first chat read");
  return { ...opened, st, log };
}

const text = (page, selector) => page.locator(selector).innerText();
const hidden = (page, selector) => page.evaluate((s) => document.querySelector(s).hidden, selector);

test("the page loads for staff only, and its badge decides whether approval controls draw", { timeout: 90_000 }, async () => {
  await proof.check(/^Page itself: staff-only chat screen loads/, async () => {
    const { page, errors, log } = await openBrain();
    assert.deepEqual(errors, [], "no script error on load");
    // The shell, ramp-quizzes.js and data.js all ran; private file lists stay closed.
    const ran = await page.evaluate(() => ({
      quiz: typeof window.scoreRampQuiz, data: typeof window.FHData, nav: Boolean(document.querySelector("#fh-side-nav")),
      composer: Boolean(document.querySelector("#composer #q")), rail: Boolean(document.querySelector("#rail")),
      sidebarLink: Boolean(document.querySelector("#fh-side-nav a[href='company-brain.html']"))
    }));
    assert.deepEqual(ran, { quiz: "function", data: "object", nav: true, composer: true, rail: true, sidebarLink: true });
    assert.equal(log.threadReads, 1);
    assert.equal(log.uploadReads, 0);
    assert.equal(log.reviewReads, 0);
    assert.match(await text(page, "#msgs"), /No messages in this chat yet\./);
    assert.equal(await text(page, "#chatTitle"), "New chat");
    await page.close();

    // A closer is a permitted staff user: read-only SOP discovery is available,
    // but private upload file names and owner reviews must never be requested.
    const closer = await openBrain({ session: CLOSER });
    assert.match(closer.page.url(), /\/app\/company-brain\.html/);
    assert.equal(await text(closer.page, "#rolePill"), "closer");
    assert.equal(closer.log.uploadReads, 0, "staff does not fetch owner-tier upload names");
    assert.equal(closer.log.reviewReads, 0, "staff does not fetch owner review items");
    assert.equal(await hidden(closer.page, "#reviewPanel"), true);
    assert.equal(await closer.page.locator("#docList .docrow").count(), 0);
    await closer.page.close();

    // External client and partner principals stay on their own screens, with no Brain reads.
    for (const [session, landing] of [[CLIENT, "client-portal.html"], [PARTNER, "partner-galaxy.html"]]) {
      const other = await open("/app/company-brain.html", { session, handlers: {} });
      await waitFor(() => other.page.url().includes(landing), `${session.staff.role} moved to ${landing}`);
      assert.doesNotMatch(other.page.url(), /company-brain/);
      await other.page.close();
    }
  });

  await proof.check(/^Role badge/, async () => {
    const owner = await openBrain({ session: OWNER });
    await owner.page.locator("#tabManage").click();
    await waitFor(() => owner.log.reviewReads >= 1, "owner review read");
    await waitFor(() => owner.log.uploadReads >= 1, "owner upload read");
    assert.equal(await owner.page.locator("#rolePill").evaluate((el) => el.textContent), "owner");
    assert.equal(await hidden(owner.page, "#reviewPanel"), false, "the owner sees the approval panel");
    await waitFor(async () => (await owner.page.locator("#reviewList [data-decide='approve']").count()) >= 1, "owner approval controls");
    assert.equal(await owner.page.locator("#docList [data-decide]").count(), 0, "file inventory is status only");
    await owner.page.close();

    const admin = await openBrain({ session: ADMIN });
    await admin.page.locator("#tabManage").click();
    await waitFor(() => admin.log.uploadReads >= 1, "admin upload read");
    assert.equal(await admin.page.locator("#rolePill").evaluate((el) => el.textContent), "admin");
    assert.equal(await hidden(admin.page, "#reviewPanel"), true, "a non-owner never sees the approval panel");
    assert.equal(admin.log.reviewReads, 0, "a non-owner never asks for the review queue");
    assert.equal(await admin.page.locator("[data-decide]").count(), 0, "a waiting file shows no Approve or Turn down to a non-owner");
    assert.match(await text(admin.page, "#docList"), /waiting/i);
    await admin.page.close();

    // With no cached fh_role the badge falls back to the saved session's role.
    const fromSession = await openBrain({
      session: OWNER,
      init: () => { try { localStorage.setItem("fh_role", ""); localStorage.setItem("fh_session", JSON.stringify({ role: "owner" })); } catch (e) {} }
    });
    await fromSession.page.locator("#tabManage").click();
    await waitFor(() => fromSession.log.reviewReads >= 1, "the review read from the session role");
    assert.equal(await fromSession.page.locator("#rolePill").evaluate((el) => el.textContent), "owner");
    assert.equal(await hidden(fromSession.page, "#reviewPanel"), false);
    await fromSession.page.close();

    // With no cached role and no saved session the badge says "staff", and none of the approval side is
    // drawn or read: the page must not call anyone an owner it cannot name.
    const nameless = await openBrain({
      session: OWNER,
      init: () => { try { localStorage.setItem("fh_role", ""); localStorage.removeItem("fh_session"); } catch (e) {} }
    });
    await nameless.page.waitForTimeout(300);
    assert.equal(await nameless.page.locator("#rolePill").evaluate((el) => el.textContent), "staff");
    assert.equal(await hidden(nameless.page, "#reviewPanel"), true, "no approval panel for an unnamed role");
    assert.equal(nameless.log.reviewReads, 0, "an unnamed role never asks for the review queue");
    assert.equal(await nameless.page.locator("[data-decide]").count(), 0, "no Approve or Turn down for an unnamed role");
    await nameless.page.close();
  });
});

const FILES_USED = [{ n: 1, fileName: "Contracts SOP.pdf", webViewLink: "https://drive.example.test/contracts", accessTier: "staff", excerpt: "Press Send contract on the client." }];
/** What the stand-in server answers to the nth question: a written answer with its files, then a copied one, then none. */
const ANSWERS = (n, body) => {
  const base = { ok: true, question: body.question, thread_id: T1, role: "owner" };
  if (n === 1) return { ...base, answer: { text: "Open the client and press Send contract.", thin: false, source: "model" }, sources: FILES_USED };
  if (n === 2) return { ...base, answer: { text: "Void it from the contract row.", thin: true, source: "extractive" }, sources: [] };
  if (n === 3) return { ...base, answer: { text: "No matching documents in your clearance for that question.", thin: true, source: "none" }, sources: [] };
  return { ...base, answer: { text: `Answer ${n}.`, thin: false, source: "model" }, sources: [], history_saved: false };
};

test("Send: the waiting line, one question at a time, the answer with its files, Enter and Shift+Enter", { timeout: 90_000 }, async () => {
  const { page, log, st } = await openBrain({ askAnswer: ANSWERS });
  await clearShellOverlays(page);

  await proof.check(/^Send question/, async () => {
    // The answer is held back, so the waiting state can be looked at.
    st.askGate = gate();
    await page.locator("#q").fill("  How do I send a contract?  ");
    await page.locator("#askBtn").click();
    await waitFor(() => log.asks.length === 1, "the first question");
    assert.deepEqual(log.asks[0], { question: "How do I send a contract?" }, "sent as typed, trimmed, with no chat yet");
    await waitFor(async () => /Reading your files…/.test(await text(page, "#msgs")), "the waiting line");
    assert.match(await text(page, "#msgs"), /How do I send a contract\?/, "the question is on screen while it waits");
    assert.equal(await text(page, "#askBtn"), "Sending…");
    assert.equal(await page.locator("#askBtn").isDisabled(), true);
    assert.equal(await page.locator("#q").inputValue(), "", "the box is cleared the moment it is sent");
    // One question at a time: Enter on a second question while the first waits sends nothing and keeps the words.
    await page.locator("#q").fill("A second question while waiting");
    await page.locator("#q").press("Enter");
    await page.waitForTimeout(250);
    assert.equal(log.asks.length, 1, "Enter during the wait sends no second question");
    assert.equal(await page.locator("#q").inputValue(), "A second question while waiting", "the typed words stay in the box");

    // The answer lands: the waiting line is gone, the words are there, and so are the files it used.
    st.askGate.release();
    st.askGate = null;
    await waitFor(async () => /Open the client and press Send contract\./.test(await text(page, "#msgs")), "the answer");
    await waitFor(async () => (await text(page, "#askBtn")) === "Send", "Send comes back");
    assert.doesNotMatch(await text(page, "#msgs"), /Reading your files/, "the waiting line leaves when the answer comes");
    assert.equal(await page.locator("#msgs .thinline").count(), 0);
    assert.equal(await page.locator("#askBtn").isEnabled(), true);
    assert.match(await text(page, "#msgs"), /Files used · 1/, "a fresh answer lists the files it used");
    assert.match(await text(page, "#msgs"), /Contracts SOP\.pdf/);
    assert.equal(await page.locator("#msgs a.lnk", { hasText: "Open in Drive" }).getAttribute("href"), "https://drive.example.test/contracts");
    assert.equal(await page.locator("#msgs .thinnote").count(), 0, "a written answer carries no copied-from-files note");
    assert.equal(await text(page, "#chatTitle"), "How do I send a contract?", "the first question names the chat");
    assert.equal(await page.locator("#q").inputValue(), "A second question while waiting");

    // The chat the answer opened rides on the next question (Enter sends), and the past-chats list is read again.
    const reads = log.threadReads;
    await page.locator("#q").fill("And how do I void one?");
    await page.locator("#q").press("Enter");
    await waitFor(() => log.asks.length === 2, "the Enter question");
    assert.deepEqual(log.asks[1], { question: "And how do I void one?", thread_id: T1 });
    await waitFor(async () => /Void it from the contract row\./.test(await text(page, "#msgs")), "the second answer");
    await waitFor(() => log.threadReads > reads, "the past chats list read again");
    // A copied answer says so; the first answer's files stay with the first answer.
    assert.match(await text(page, "#msgs"), /This is copied straight out of the files\. No writing helper was used\./);
    assert.equal(await page.locator("#msgs .thinnote").count(), 1);
    assert.equal(await page.locator("#msgs .srcs").count(), 1, "only the answer that used files lists them");

    // An answer with nothing behind it says that in its own words.
    await page.locator("#q").fill("What is the weather?");
    await page.locator("#askBtn").click();
    await waitFor(() => log.asks.length === 3, "the third question");
    await waitFor(async () => /Nothing in your files matched this question\./.test(await text(page, "#msgs")), "the nothing-matched note");
    assert.equal(await page.locator("#msgs .thinnote").count(), 2);

    // Shift+Enter makes a new line and sends nothing; an empty box sends nothing.
    await page.locator("#q").fill("line one");
    await page.locator("#q").press("Shift+Enter");
    await page.waitForTimeout(150);
    assert.equal(log.asks.length, 3);
    await page.locator("#q").fill("   ");
    await page.locator("#askBtn").click();
    await page.waitForTimeout(150);
    assert.equal(log.asks.length, 3, "a blank box sends nothing");

    // When the server could not keep the chat, the screen says so.
    await page.locator("#q").fill("One more");
    await page.locator("#askBtn").click();
    await waitFor(async () => /This chat was not saved to your history\./.test(await text(page, "#msgs")), "the not-saved note");
  });
  await page.close();
});

test("New chat: clears the chat, the highlight, the thread id and a 'gone' message", { timeout: 90_000 }, async () => {
  // The second chat's transcript is gone, so opening it shows the error that New chat has to clear.
  const { page, log, st } = await openBrain({ askAnswer: ANSWERS, state: { transcript: { [T1]: TRANSCRIPT[T1] } } });
  await clearShellOverlays(page);
  await waitFor(async () => (await page.locator("#threadList .threadbtn").count()) === 2, "two chats listed");

  await proof.check(/^New chat button/, async () => {
    // A chat is open and marked; New chat takes the mark, the title and the words away.
    await page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(async () => /Contracts SOP\.pdf/.test(await text(page, "#msgs")), "the chat opened");
    assert.equal(await page.locator(`#threadList [data-thread="${T1}"]`).getAttribute("class"), "threadbtn on");
    await page.locator("#newChat").click();
    assert.equal(await text(page, "#chatTitle"), "New chat");
    assert.match(await text(page, "#msgs"), /No messages in this chat yet\./);
    assert.equal(await page.locator("#threadList .threadbtn.on").count(), 0, "no past chat stays marked after New chat");
    assert.equal(await page.locator("#msgs .turn").count(), 0);

    // A chat that is gone shows its words; New chat clears them and opens a clean chat.
    await page.locator(`#threadList [data-thread="${T2}"]`).click();
    await waitFor(async () => /That chat is gone\./.test(await text(page, "#msgs")), "the gone words");
    await page.locator("#newChat").click();
    assert.doesNotMatch(await text(page, "#msgs"), /That chat is gone\./, "the error does not outlive New chat");
    assert.match(await text(page, "#msgs"), /No messages in this chat yet\./);
    assert.equal(await text(page, "#chatTitle"), "New chat");
    assert.equal(await page.locator("#threadList .threadbtn.on").count(), 0);

    // Pressed while a chat is still loading, it shows the empty chat, not the loading placeholder.
    st.openGate = gate();
    await page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(() => log.threadOpens.length === 3, "the slow chat read");
    assert.equal(await page.locator("#msgs .sk").count() > 0, true, "the loading placeholder shows while it loads");
    await page.locator("#newChat").click();
    assert.equal(await page.locator("#msgs .sk").count(), 0, "New chat does not leave the loading placeholder");
    assert.match(await text(page, "#msgs"), /No messages in this chat yet\./);
    st.openGate.release();
    st.openGate = null;

    // And the next question starts a chat of its own: no thread id rides along.
    await page.waitForTimeout(100);
    await page.locator("#newChat").click();
    const before = log.asks.length;
    await page.locator("#q").fill("A fresh question");
    await page.locator("#askBtn").click();
    await waitFor(() => log.asks.length === before + 1, "the fresh question");
    assert.deepEqual(log.asks[before], { question: "A fresh question" }, "no thread id after New chat");
  });
  await page.close();
});

test("Send says a refusal in words and gives Send back", { timeout: 60_000 }, async () => {
  const { page, log } = await openBrain({
    askAnswer: () => ({ ok: false, error: "forbidden_role", status: 403 })
  });
  await page.locator("#q").fill("Anything");
  await page.locator("#askBtn").click();
  await waitFor(() => log.asks.length === 1, "the question");
  await waitFor(async () => /Your role is not allowed to use the Knowledge Base\./.test(await text(page, "#msgs")), "the refusal words");
  assert.equal(await text(page, "#askBtn"), "Send");
  assert.equal(await page.locator("#askBtn").isEnabled(), true);
  await page.close();
});

test("Past chats: the list, click to reopen, and the hamburger on a narrow screen", { timeout: 90_000 }, async () => {
  await proof.check(/^Past chats list: click a chat to reopen it/, async () => {
    const { page, log } = await openBrain();
    await clearShellOverlays(page);
    await waitFor(async () => (await page.locator("#threadList .threadbtn").count()) === 2, "two chats listed");
    const rows = await page.locator("#threadList .threadbtn").allInnerTexts();
    assert.match(rows[0], /How do I send a contract\?/);
    assert.match(rows[0], /2 messages/);
    assert.match(rows[1], /Who approves a refund/);
    assert.match(rows[1], /4 messages/);
    // Click the second chat: its transcript is read by id and painted, and the row is marked.
    await page.locator(`#threadList [data-thread="${T2}"]`).click();
    await waitFor(() => log.threadOpens.length === 1, "the chat read");
    assert.deepEqual(log.threadOpens, [T2]);
    await waitFor(async () => /No matching documents in your clearance/.test(await text(page, "#msgs")), "the transcript");
    assert.equal(await text(page, "#chatTitle"), "Who approves a refund");
    assert.match(await text(page, "#msgs"), /Nothing in your files matched this question\./, "an answer with no files says so");
    assert.equal(await page.locator(`#threadList [data-thread="${T2}"]`).getAttribute("class"), "threadbtn on");
    // A reopened chat is the whole conversation: the question the person asked is there, before its answer.
    assert.deepEqual(await page.locator("#msgs .turn.user .bubble").allInnerTexts(), ["Who approves a refund?"]);
    assert.deepEqual(await page.locator("#msgs .turn").evaluateAll((els) => els.map((e) => (e.classList.contains("user") ? "question" : "answer"))), ["question", "answer"]);
    // Open the first one: the sources come back with their Drive link, never the word null.
    await page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(async () => /Contracts SOP\.pdf/.test(await text(page, "#msgs")), "the first transcript");
    assert.match(await text(page, "#msgs"), /Files used · 1/);
    assert.equal(await page.locator("#msgs a.lnk", { hasText: "Open in Drive" }).getAttribute("href"), "https://drive.example.test/contracts");
    assert.doesNotMatch(await text(page, "#msgs"), /\bnull\b/);
    assert.deepEqual(await page.locator("#msgs .turn.user .bubble").allInnerTexts(), ["How do I send a contract?"]);
    assert.equal(await page.locator("#msgs .turn").count(), 2, "one question and one answer, no more");
    // The next question carries the chat that was opened.
    await page.locator("#q").fill("Follow up");
    await page.locator("#askBtn").click();
    await waitFor(() => log.asks.length === 1, "the follow-up");
    assert.deepEqual(log.asks[0], { question: "Follow up", thread_id: T1 });
    await page.close();

    // A chat that is gone says so.
    const gone = await openBrain({ state: { transcript: {} } });
    await waitFor(async () => (await gone.page.locator("#threadList .threadbtn").count()) === 2, "chats listed");
    await gone.page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(async () => /That chat is gone\./.test(await text(gone.page, "#msgs")), "the gone message");
    await gone.page.close();
  });

  await proof.check(/^Past chats rail toggle/, async () => {
    const { page } = await openBrain({ viewport: { width: 700, height: 900 } });
    await clearShellOverlays(page);
    const railVisible = () => page.locator("#rail").isVisible();
    assert.equal(await railVisible(), false, "the rail is folded away on a narrow screen");
    assert.equal(await page.locator("#railToggle").isVisible(), true, "the hamburger shows on a narrow screen");
    await page.locator("#railToggle").click();
    assert.equal(await railVisible(), true);
    assert.equal(await page.locator("#chat").evaluate((el) => el.classList.contains("rail-open")), true);
    await waitFor(async () => (await page.locator("#threadList .threadbtn").count()) === 2, "chats listed");
    // Once open the rail sits over the hamburger, so the way out is a pick: a chat closes it...
    await page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(async () => !(await railVisible()), "the rail closes after a pick");
    // ...and so does New chat.
    await page.locator("#railToggle").click();
    assert.equal(await railVisible(), true);
    await page.locator("#newChat").click();
    await waitFor(async () => !(await railVisible()), "the rail closes after New chat");
    await page.close();

    // On a wide screen there is no hamburger.
    const wide = await openBrain();
    assert.equal(await wide.page.locator("#railToggle").isVisible(), false);
    await wide.page.close();
  });
});

test("Documents: open and close, Files you added with Refresh", { timeout: 90_000 }, async () => {
  const { page, log, st } = await openBrain({ session: ADMIN });
  await clearShellOverlays(page);

  await proof.check(/^Manage files tab/, async () => {
    assert.equal(await page.locator("#docs").isVisible(), false, "the right-hand panel starts closed");
    await page.locator("#tabManage").click();
    assert.equal(await page.locator("#docs").isVisible(), true);
    await page.locator("#tabAsk").click();
    assert.equal(await page.locator("#docs").isVisible(), false);
    await page.locator("#tabManage").click();
    assert.equal(await page.locator("#docs").isVisible(), true);
  });

  await proof.check(/^Files you added: list and Refresh button/, async () => {
    await waitFor(async () => (await page.locator("#docList .docrow").count()) === 3, "three files listed");
    const rows = await page.locator("#docList .docrow").allInnerTexts();
    assert.match(rows[0], /Refund policy\.pdf/);
    assert.match(rows[0], /waiting/i);
    assert.match(rows[0], /2 KB/);
    assert.match(rows[0], /seen by owner/);
    assert.match(rows[0], /added by Casey Reed/);
    assert.match(rows[0], /An owner has to approve this before it can be used in answers\./);
    assert.match(rows[1], /approved/i);
    assert.match(rows[1], /2\.0 MB/);
    assert.match(rows[1], /seen by sales/);
    assert.match(rows[2], /turned down/i);
    assert.match(rows[2], /This will not be used in answers\./);
    assert.doesNotMatch(rows[2], /added by|null|NaN/, "an unknown size and uploader are left out, never printed as null");
    assert.equal(await page.locator("#pendPill2").evaluate((el) => el.textContent), "1 waiting");
    assert.equal(await page.locator("#pendPill").evaluate((el) => el.textContent), "1");

    // A failed read says it in words and never as a code, and the waiting count it was showing goes away
    // with it: a count from before the failure would be a claim the screen can no longer back.
    st.uploadsError = { status: 500, error: "list_failed" };
    await page.locator("#refreshDocs").click();
    await waitFor(async () => /Something went wrong on our side/.test(await text(page, "#docList")), "the error words");
    assert.doesNotMatch(await text(page, "#docList"), /list_failed|500/);
    assert.equal(await page.locator("#pendPill2").evaluate((el) => el.hidden), true, "a failed read leaves no stale waiting count");
    assert.equal(await page.locator("#pendPill").evaluate((el) => el.hidden), true);
    st.uploadsError = null;
    await page.locator("#refreshDocs").click();
    await waitFor(async () => (await page.locator("#docList .docrow").count()) === 3, "the list comes back");
    assert.equal(await page.locator("#pendPill2").evaluate((el) => el.textContent), "1 waiting");

    // Refresh reads the list again and paints what came back.
    st.uploads = { ok: true, uploads: [{ id: F2, name: "Sales script.docx", approvalStatus: "approved", accessTier: "sales", sizeBytes: 100, uploadedByName: "Jordan Blake", uploadedAt: minutesAgo(1) }], pendingCount: 0 };
    const reads = log.uploadReads;
    await page.locator("#refreshDocs").click();
    await waitFor(() => log.uploadReads === reads + 1, "the second read");
    await waitFor(async () => (await page.locator("#docList .docrow").count()) === 1, "one file listed");
    assert.equal(await page.locator("#pendPill2").evaluate((el) => el.hidden), true, "the waiting count goes away at zero");

    // No files says so; a failed read says it in words and not as a code.
    st.uploads = { ok: true, uploads: [], pendingCount: 0 };
    await page.locator("#refreshDocs").click();
    await waitFor(async () => /No files added yet\./.test(await text(page, "#docList")), "the empty words");
    st.uploadsError = { status: 500, error: "list_failed" };
    await page.locator("#refreshDocs").click();
    await waitFor(async () => /Something went wrong on our side/.test(await text(page, "#docList")), "the error words");
    assert.doesNotMatch(await text(page, "#docList"), /list_failed|500/);
    assert.equal(await page.locator("#pendPill2").evaluate((el) => el.hidden), true, "a failed read leaves no stale waiting count");
    assert.equal(await page.locator("#pendPill").evaluate((el) => el.hidden), true);
  });
  await page.close();
});

test("the owner's review panel: Refresh, Approve and Turn down", { timeout: 90_000 }, async () => {
  const { page, log, st } = await openBrain();
  await clearShellOverlays(page);
  await page.locator("#tabManage").click();
  await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "two reviews listed");
  // The buttons are found by the words a person reads on them, never by a hidden attribute: a button
  // that says Approve has to approve, and one that says Turn down has to turn down.
  const approveIn = (scope) => page.locator(scope).getByRole("button", { name: "Approve", exact: true });
  const turnDownIn = (scope) => page.locator(scope).getByRole("button", { name: "Turn down", exact: true });

  await proof.check(/^Owner: 'Waiting for your approval' panel and its Refresh button/, async () => {
    const rows = await page.locator("#reviewList .docrow").allInnerTexts();
    assert.match(rows[0], /Refund policy\.pdf/);
    assert.match(rows[0], /asked for staff · now owner/);
    assert.match(rows[0], /Why this file\?/);
    await page.locator("#reviewList .docrow").first().locator("summary").click();
    assert.match(await text(page, "#reviewList .docrow:first-child .dsay"), /Reads like staff training\./);
    assert.match(rows[1], /Affiliate guide\.pdf/);
    assert.match(rows[1], /asked for affiliate · now owner/);
    assert.equal(await page.locator("#reviewList a.lnk", { hasText: "Open in Drive" }).getAttribute("href"), "https://drive.example.test/guide");
    // Every waiting file gets the two buttons, worded Approve and Turn down, in that order.
    for (const row of await page.locator("#reviewList .docrow").all()) {
      assert.deepEqual(await row.locator("button").allInnerTexts(), ["Approve", "Turn down"]);
    }
    // Refresh reads the queue again; an empty queue says nothing is waiting.
    st.reviews = { ok: true, reviews: [] };
    const reads = log.reviewReads;
    await page.locator("#refreshReviews").click();
    await waitFor(() => log.reviewReads === reads + 1, "the second review read");
    await waitFor(async () => /Nothing is waiting for you\./.test(await text(page, "#reviewList")), "the empty words");
    st.reviews = REVIEWS();
    await page.locator("#refreshReviews").click();
    await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "two reviews again");

    // A failed read says it in words and never as a code or a number.
    st.reviewsError = { status: 500, error: "list_failed" };
    await page.locator("#refreshReviews").click();
    await waitFor(async () => /Something went wrong on our side\./.test(await text(page, "#reviewList")), "the server-error words");
    assert.doesNotMatch(await text(page, "#reviewList"), /list_failed|500/);
    st.reviewsError = { status: 403, error: "forbidden_role" };
    await page.locator("#refreshReviews").click();
    await waitFor(async () => /Your role is not allowed to use the Knowledge Base\./.test(await text(page, "#reviewList")), "the role words");
    assert.doesNotMatch(await text(page, "#reviewList"), /forbidden_role|403/);
    st.reviewsError = null;
    await page.locator("#refreshReviews").click();
    await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "the list comes back");
  });

  await proof.check(/^Owner: Approve a waiting file/, async () => {
    // From the review list.
    const readsBefore = { reviews: log.reviewReads, uploads: log.uploadReads };
    await approveIn("#reviewList").first().click();
    await waitFor(() => log.decides.length === 1, "the approve request");
    assert.deepEqual(log.decides[0], { review_id: R1, decision: "approve" });
    await waitFor(() => log.reviewReads > readsBefore.reviews && log.uploadReads > readsBefore.uploads, "both lists read again");
    // The second review (a Drive file with no upload row) is approved by its own button.
    await approveIn("#reviewList").nth(1).click();
    await waitFor(() => log.decides.length === 2, "the second approve request");
    assert.deepEqual(log.decides[1], { review_id: R2, decision: "approve" });
    // Someone else decided first: said in words, and the button comes back.
    st.decide = () => ({ status: 409, body: { ok: false, error: "not_pending" } });
    await approveIn("#reviewList").first().click();
    await waitFor(async () => /Someone already decided on this one\./.test(await text(page, "#reviewList")), "the already-decided words");
  });

  await proof.check(/^Owner: Turn down a waiting file/, async () => {
    st.decide = null;
    st.reviews = REVIEWS();
    await page.locator("#refreshReviews").click();
    await waitFor(async () => (await turnDownIn("#reviewList").count()) === 2, "two Turn down buttons");
    const before = log.decides.length;
    await turnDownIn("#reviewList").nth(1).click();
    await waitFor(() => log.decides.length === before + 1, "the turn down request");
    assert.deepEqual(log.decides[before], { review_id: R2, decision: "reject" });
    // A waiting upload is turned down from its review row.
    await turnDownIn("#reviewList").first().click();
    await waitFor(() => log.decides.length === before + 2, "the second turn down request");
    assert.deepEqual(log.decides[before + 1], { review_id: R1, decision: "reject" });
  });
  await page.close();
});

test("Class quiz: answers are scored in the page, strictly, and nothing is saved", { timeout: 90_000 }, async () => {
  await proof.check(/^Class quiz: answer boxes and 'Check answers'/, async () => {
    const requests = [];
    const { page } = await openBrain({ session: ADMIN });
    page.on("request", (req) => { if (req.method() !== "GET") requests.push(`${req.method()} ${req.url()}`); });
    await clearShellOverlays(page);
    await page.locator("#tabTraining").click();
    const options = await page.locator("#quizPick option").allInnerTexts();
    assert.ok(options.length >= 10, options.join(" | "));
    assert.equal(await page.locator("#quizPick").inputValue(), "closer-d1");

    // Fill the boxes, press Check answers, and read back the marks and the result line.
    const score = async (answers) => {
      const boxes = await page.locator("#quizBox textarea").count();
      for (let i = 0; i < boxes; i += 1) await page.locator(`#qa-${i}`).fill(answers[i] ?? "");
      await page.locator("#quizForm button[type=submit]").click();
      await waitFor(async () => (await text(page, "#qm-0")) !== "", "marks painted");
      const marks = [];
      for (let i = 0; i < boxes; i += 1) marks.push(await text(page, `#qm-${i}`));
      return { marks, result: await text(page, "#quizResult") };
    };

    await page.locator("#quizPick").selectOption("closer-d1");
    assert.equal(await page.locator("#quizBox textarea").count(), 4);
    // Day 1: a plain yes/no, a yes/no answered wrongly, a two-part answer, and a blank box.
    let out = await score(["No, we are not the bank", "Yes they do", "It pays for the soft pull of their credit file", ""]);
    assert.deepEqual(out.marks, ["Right", "Wrong", "Right", "Write an answer."]);
    assert.equal(out.result, "You got 2 of 4 right.");
    assert.equal(await page.locator("#qm-0").getAttribute("class"), "qmark mono qok");
    assert.equal(await page.locator("#qm-1").getAttribute("class"), "qmark mono qbad");

    // The marking is strict where it has to be.
    // 1. An answer that says both yes and no is not the right "no".
    out = await score(["yes and no", "no", "x", ""]);
    assert.equal(out.marks[0], "Wrong", "yes and no together is not a no");
    assert.equal(out.marks[1], "Right");
    // 2. A two-part answer needs both parts: "soft" alone, or "file" alone, is not enough.
    out = await score(["no", "no", "it is soft", ""]);
    assert.equal(out.marks[2], "Wrong", "one part of a two-part answer is not right");
    out = await score(["no", "no", "it is for the credit file", ""]);
    assert.equal(out.marks[2], "Wrong");
    out = await score(["no", "no", "a SOFT look at the file", ""]);
    assert.equal(out.marks[2], "Right", "capitals and word order do not matter");
    // 3. "Name four things": three of the five listed marks is enough, two is not.
    out = await score(["no", "no", "soft file", "late payments, card utilization and inquiries"]);
    assert.equal(out.marks[3], "Right", "three of the listed things is enough");
    out = await score(["no", "no", "soft file", "late payments and inquiries"]);
    assert.equal(out.marks[3], "Wrong", "two of them is not");
    out = await score(["no", "no", "soft file", "personal information"]);
    assert.equal(out.marks[3], "Wrong", "one is not");
    out = await score(["no", "no", "soft file", "late payments, card utilization, inquiries, collections and personal information"]);
    assert.equal(out.marks[3], "Right", "more than needed is fine");
    assert.equal(out.result, "You got 4 of 4 right.");

    // 4. A banned phrase turns an otherwise matching answer wrong.
    await page.locator("#quizPick").selectOption("closer-d3");
    out = await score(["I cannot promise, only the lender decides", "I do not promise anything, but yes your score will go up", "a refund over the 10% needs the manager"]);
    assert.equal(out.marks[0], "Right");
    assert.equal(out.marks[1], "Wrong", "promising a score rise fails even with 'do not promise' in it");
    assert.equal(out.marks[2], "Right");
    out = await score(["We cannot promise, the lender decides", "We do not promise a score change", "refund goes to the manager"]);
    assert.deepEqual(out.marks, ["Right", "Right", "Right"]);

    // Day 5 must miss zero: one wrong answer fails the day; every right answer passes it.
    await page.locator("#quizPick").selectOption("closer-d5");
    out = await score([
      "We are not the bank. Lenders decide.", "It pays for a soft look at the file",
      "700 or 500 for funding, a course, and a cash downsell", "it counts toward the 10", "nothing"
    ]);
    assert.equal(out.result, "Fail. Day 5 must miss zero. You got 4 of 5 right.");
    // Naming only one of the three things never to promise still fails the day.
    out = await score([
      "We are not the bank. Lenders decide.", "It pays for a soft look at the file",
      "700 or 500 for funding, a course, and a cash downsell", "it counts toward the 10", "never promise a score"
    ]);
    assert.equal(out.marks[4], "Wrong", "one of three is not enough");
    assert.equal(out.result, "Fail. Day 5 must miss zero. You got 4 of 5 right.");
    out = await score([
      "We are not the bank. Lenders decide.", "It pays for a soft look at the file",
      "700 or 500 for funding, a course, and a cash downsell", "it counts toward the 10", "never promise a score, a yes, or a dollar amount"
    ]);
    assert.equal(out.result, "Pass. You got every question right (5 of 5).");
    assert.deepEqual(requests, [], "scoring the quiz sends nothing and saves nothing");

    assert.ok(options.some((o) => /^Closer/.test(o)) && options.some((o) => /^Funding advisor/.test(o)), "an admin is offered every seat's days");
    await page.close();
  });
});

test("every listed Company Brain row was pressed", () => {
  proof.assertAllClaimed();
});
