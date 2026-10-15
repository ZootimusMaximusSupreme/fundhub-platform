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

const ADMIN = { ok: true, staff: { id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai", role: "admin", org_id: "org-1", status: "active" } };
const CLOSER = { ok: true, staff: { id: "staff-3", name: "Riley Park", email: "riley@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } };
const CLIENT = { ok: true, staff: { id: "client-1", name: "Dana Whitfield", email: "dana@example.test", role: "client", org_id: "org-1", status: "active" } };
const PARTNER = { ok: true, staff: { id: "partner-1", name: "Pat Partner", email: "pat@partner.test", role: "partner", org_id: "org-1", status: "active", partner_id: "pppppppp-1111-4111-8111-111111111111" } };

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
    threads: THREADS(), uploads: UPLOADS(), reviews: REVIEWS(), transcript: TRANSCRIPT, decide: null, uploadsError: null, ...state
  };
  const log = { asks: [], decides: [], threadReads: 0, threadOpens: [], uploadReads: 0, reviewReads: 0 };
  const handlers = {
    "/api/read/company-brain": async (route) => {
      const body = bodyOf(route);
      log.asks.push(body);
      const out = askAnswer
        ? askAnswer(log.asks.length, body)
        : { ok: true, question: body.question, thread_id: T1, answer: { text: `Answer ${log.asks.length}.`, thin: false, source: "model" }, sources: [], role: "owner" };
      return json(route, out, out.status || 200);
    },
    "/api/company-brain/threads": async (route, { url }) => {
      const id = new URL(url).searchParams.get("thread_id");
      if (id) {
        log.threadOpens.push(id);
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
      return json(route, st.reviews);
    }
  };
  const opened = await open("/app/company-brain.html", { session, handlers, ...(viewport ? { viewport } : {}), ...(init ? { init } : {}) });
  await waitFor(() => log.threadReads >= 1 && log.uploadReads >= 1, "the first reads");
  return { ...opened, st, log };
}

const text = (page, selector) => page.locator(selector).innerText();
const hidden = (page, selector) => page.evaluate((s) => document.querySelector(s).hidden, selector);

test("the page loads for staff only, and its badge decides whether approval controls draw", { timeout: 90_000 }, async () => {
  await proof.check(/^Page itself: staff-only chat screen loads/, async () => {
    const { page, errors, log } = await openBrain();
    await waitFor(() => log.reviewReads >= 1, "the owner's first review read");
    assert.deepEqual(errors, [], "no script error on load");
    // The shell, ramp-quizzes.js and data.js all ran, and the three first reads were asked.
    const ran = await page.evaluate(() => ({
      quiz: typeof window.scoreRampQuiz, data: typeof window.FHData, nav: Boolean(document.querySelector("#fh-side-nav")),
      composer: Boolean(document.querySelector("#composer #q")), rail: Boolean(document.querySelector("#rail")),
      sidebarLink: Boolean(document.querySelector("#fh-side-nav a[href='company-brain.html']"))
    }));
    assert.deepEqual(ran, { quiz: "function", data: "object", nav: true, composer: true, rail: true, sidebarLink: true });
    assert.equal(log.threadReads, 1);
    assert.equal(log.uploadReads, 1);
    assert.match(await text(page, "#msgs"), /Nothing has been asked in this chat yet\./);
    assert.equal(await text(page, "#chatTitle"), "New chat");
    await page.close();

    // Staff only, and in practice owner and admin: a closer, a client and a partner are each sent to
    // their own screen, and nothing of the brain is read.
    for (const [session, landing] of [[CLOSER, "closer-dashboard.html"], [CLIENT, "client-portal.html"], [PARTNER, "partner-galaxy.html"]]) {
      const other = await open("/app/company-brain.html", { session, handlers: {} });
      await waitFor(() => other.page.url().includes(landing), `${session.staff.role} moved to ${landing}`);
      assert.doesNotMatch(other.page.url(), /company-brain/);
      await other.page.close();
    }
  });

  await proof.check(/^Role badge/, async () => {
    const owner = await openBrain({ session: OWNER });
    await waitFor(() => owner.log.reviewReads >= 1, "owner review read");
    assert.equal(await owner.page.locator("#rolePill").evaluate((el) => el.textContent), "owner");
    assert.equal(await hidden(owner.page, "#reviewPanel"), false, "the owner sees the approval panel");
    assert.ok(await owner.page.locator("#docList [data-decide='approve']").count() >= 1, "the owner gets Approve on a waiting file row");
    await owner.page.close();

    const admin = await openBrain({ session: ADMIN });
    await admin.page.waitForTimeout(300);
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
    await waitFor(() => fromSession.log.reviewReads >= 1, "the review read from the session role");
    assert.equal(await fromSession.page.locator("#rolePill").evaluate((el) => el.textContent), "owner");
    assert.equal(await hidden(fromSession.page, "#reviewPanel"), false);
    await fromSession.page.close();
  });
});

test("Send, Enter and Shift+Enter, then New chat starts clean", { timeout: 90_000 }, async () => {
  const { page, log } = await openBrain();
  await clearShellOverlays(page);

  await proof.check(/^Send question/, async () => {
    // Send sends the question as typed (trimmed), shows it, then shows the answer.
    await page.locator("#q").fill("  How do I send a contract?  ");
    await page.locator("#askBtn").click();
    await waitFor(() => log.asks.length === 1, "the first question");
    assert.deepEqual(log.asks[0], { question: "How do I send a contract?" });
    await waitFor(async () => /Answer 1\./.test(await text(page, "#msgs")), "the answer");
    assert.match(await text(page, "#msgs"), /How do I send a contract\?/);
    assert.equal(await page.locator("#q").inputValue(), "", "the box is cleared after sending");
    assert.equal(await text(page, "#askBtn"), "Send");
    assert.equal(await text(page, "#chatTitle"), "How do I send a contract?", "the first question names the chat");
    // The thread the answer opened rides on the next question, and the past-chats list was re-read.
    const reads = log.threadReads;
    await page.locator("#q").fill("And how do I void one?");
    await page.locator("#q").press("Enter");
    await waitFor(() => log.asks.length === 2, "the Enter question");
    assert.deepEqual(log.asks[1], { question: "And how do I void one?", thread_id: T1 });
    await waitFor(() => log.threadReads > reads, "the past chats list read again");
    // Shift+Enter makes a new line and sends nothing; an empty box sends nothing.
    await page.locator("#q").fill("line one");
    await page.locator("#q").press("Shift+Enter");
    await page.waitForTimeout(150);
    assert.equal(log.asks.length, 2);
    await page.locator("#q").fill("   ");
    await page.locator("#askBtn").click();
    await page.waitForTimeout(150);
    assert.equal(log.asks.length, 2, "a blank box sends nothing");
  });

  await proof.check(/^New chat button/, async () => {
    await page.locator("#newChat").click();
    assert.equal(await text(page, "#chatTitle"), "New chat");
    assert.match(await text(page, "#msgs"), /Nothing has been asked in this chat yet\./);
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
  await waitFor(async () => /Your role is not allowed to use Company Brain\./.test(await text(page, "#msgs")), "the refusal words");
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
    // Open the first one: the sources come back with their Drive link, never the word null.
    await page.locator(`#threadList [data-thread="${T1}"]`).click();
    await waitFor(async () => /Contracts SOP\.pdf/.test(await text(page, "#msgs")), "the first transcript");
    assert.match(await text(page, "#msgs"), /Files used · 1/);
    assert.equal(await page.locator("#msgs a.lnk", { hasText: "Open in Drive" }).getAttribute("href"), "https://drive.example.test/contracts");
    assert.doesNotMatch(await text(page, "#msgs"), /\bnull\b/);
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
  const docsOpen = () => page.locator("#chat").evaluate((el) => el.classList.contains("docs-open"));

  await proof.check(/^Documents button/, async () => {
    assert.equal(await docsOpen(), false);
    assert.equal(await page.locator("#docs").isVisible(), false, "the right-hand panel starts closed");
    await page.locator("#docsBtn").click();
    assert.equal(await docsOpen(), true);
    assert.equal(await page.locator("#docs").isVisible(), true);
    await page.locator("#docsClose").click();
    assert.equal(await docsOpen(), false);
    assert.equal(await page.locator("#docs").isVisible(), false);
    await page.locator("#docsBtn").click();
    await page.locator("#docsBtn").click();
    assert.equal(await docsOpen(), false, "the Documents button also closes it");
  });

  await proof.check(/^Files you added: list and Refresh button/, async () => {
    await page.locator("#docsBtn").click();
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
    assert.equal(await page.locator("#pendPill").evaluate((el) => el.textContent), "1 waiting");

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
  });
  await page.close();
});

test("the owner's review panel: Refresh, Approve and Turn down", { timeout: 90_000 }, async () => {
  const { page, log, st } = await openBrain();
  await clearShellOverlays(page);
  await page.locator("#docsBtn").click();
  await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "two reviews listed");

  await proof.check(/^Owner: 'Waiting for your approval' panel and its Refresh button/, async () => {
    const rows = await page.locator("#reviewList .docrow").allInnerTexts();
    assert.match(rows[0], /Refund policy\.pdf/);
    assert.match(rows[0], /asked for staff · now owner/);
    assert.match(rows[0], /Reads like staff training\./);
    assert.match(rows[1], /Affiliate guide\.pdf/);
    assert.match(rows[1], /asked for affiliate · now owner/);
    assert.equal(await page.locator("#reviewList a.lnk", { hasText: "Open in Drive" }).getAttribute("href"), "https://drive.example.test/guide");
    // Refresh reads the queue again; an empty queue says nothing is waiting.
    st.reviews = { ok: true, reviews: [] };
    const reads = log.reviewReads;
    await page.locator("#refreshReviews").click();
    await waitFor(() => log.reviewReads === reads + 1, "the second review read");
    await waitFor(async () => /Nothing is waiting for you\./.test(await text(page, "#reviewList")), "the empty words");
    st.reviews = REVIEWS();
    await page.locator("#refreshReviews").click();
    await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "two reviews again");
  });

  await proof.check(/^Owner: Approve a waiting file/, async () => {
    // From the review list.
    const readsBefore = { reviews: log.reviewReads, uploads: log.uploadReads };
    await page.locator("#reviewList [data-decide='approve']").first().click();
    await waitFor(() => log.decides.length === 1, "the approve request");
    assert.deepEqual(log.decides[0], { review_id: R1, decision: "approve" });
    await waitFor(() => log.reviewReads > readsBefore.reviews && log.uploadReads > readsBefore.uploads, "both lists read again");
    // From the file row in Files you added (the same request for the same review).
    await page.locator("#docList [data-decide='approve']").first().click();
    await waitFor(() => log.decides.length === 2, "the second approve request");
    assert.deepEqual(log.decides[1], { review_id: R1, decision: "approve" });
    // Someone else decided first: said in words, and the button comes back.
    st.decide = () => ({ status: 409, body: { ok: false, error: "not_pending" } });
    await page.locator("#reviewList [data-decide='approve']").first().click();
    await waitFor(async () => /Someone already decided on this one\./.test(await text(page, "#reviewList")), "the already-decided words");
  });

  await proof.check(/^Owner: Turn down a waiting file/, async () => {
    st.decide = null;
    st.reviews = REVIEWS();
    await page.locator("#refreshReviews").click();
    await waitFor(async () => (await page.locator("#reviewList [data-decide='reject']").count()) === 2, "two Turn down buttons");
    const before = log.decides.length;
    await page.locator("#reviewList [data-decide='reject']").nth(1).click();
    await waitFor(() => log.decides.length === before + 1, "the turn down request");
    assert.deepEqual(log.decides[before], { review_id: R2, decision: "reject" });
    // The same button on the file row of a waiting upload.
    await page.locator("#docList [data-decide='reject']").first().click();
    await waitFor(() => log.decides.length === before + 2, "the second turn down request");
    assert.deepEqual(log.decides[before + 1], { review_id: R1, decision: "reject" });
  });
  await page.close();
});

test("Class quiz: answers are scored in the page and nothing is saved", { timeout: 60_000 }, async () => {
  await proof.check(/^Class quiz: answer boxes and 'Check answers'/, async () => {
    const requests = [];
    const { page } = await openBrain({ session: ADMIN });
    page.on("request", (req) => { if (req.method() !== "GET") requests.push(`${req.method()} ${req.url()}`); });
    await clearShellOverlays(page);
    await page.locator("#docsBtn").click();
    const options = await page.locator("#quizPick option").allInnerTexts();
    assert.ok(options.length >= 10, options.join(" | "));
    assert.equal(await page.locator("#quizPick").inputValue(), "closer-d1");
    await page.locator("#quizPick").selectOption("closer-d1");
    assert.equal(await page.locator("#quizBox textarea").count(), 4);

    await page.locator("#qa-0").fill("No, we are not the bank");
    await page.locator("#qa-1").fill("Yes they do");
    await page.locator("#qa-2").fill("It pays for the soft pull of their credit file");
    // the fourth box is left empty on purpose
    await page.locator("#quizForm button[type=submit]").click();
    await waitFor(async () => (await text(page, "#qm-0")) !== "", "marks painted");
    assert.equal(await text(page, "#qm-0"), "Right");
    assert.equal(await text(page, "#qm-1"), "Wrong");
    assert.equal(await text(page, "#qm-2"), "Right");
    assert.equal(await text(page, "#qm-3"), "Write an answer.");
    assert.equal(await page.locator("#qm-0").getAttribute("class"), "qmark mono qok");
    assert.equal(await page.locator("#qm-1").getAttribute("class"), "qmark mono qbad");
    assert.equal(await text(page, "#quizResult"), "You got 2 of 4 right.");

    // Day 5 must miss zero: one wrong answer fails the day; every right answer passes it.
    await page.locator("#quizPick").selectOption("closer-d5");
    await page.locator("#qa-0").fill("We are not the bank. Lenders decide.");
    await page.locator("#qa-1").fill("It pays for a soft look at the file");
    await page.locator("#qa-2").fill("700 or 500 for funding, a course, and a cash downsell");
    await page.locator("#qa-3").fill("it counts toward the 10");
    await page.locator("#qa-4").fill("nothing");
    await page.locator("#quizForm button[type=submit]").click();
    await waitFor(async () => /^Fail\./.test(await text(page, "#quizResult")), "the fail line");
    assert.equal(await text(page, "#quizResult"), "Fail. Day 5 must miss zero. You got 4 of 5 right.");
    await page.locator("#qa-4").fill("never promise a score, a yes, or a dollar amount");
    await page.locator("#quizForm button[type=submit]").click();
    await waitFor(async () => /^Pass\./.test(await text(page, "#quizResult")), "the pass line");
    assert.equal(await text(page, "#quizResult"), "Pass. You got every question right (5 of 5).");
    assert.deepEqual(requests, [], "scoring the quiz sends nothing and saves nothing");

    assert.ok(options.some((o) => /^Closer/.test(o)) && options.some((o) => /^Funding advisor/.test(o)), "an admin is offered every seat's days");
    await page.close();
  });
});

test("every listed Company Brain row was pressed", () => {
  proof.assertAllClaimed();
});
