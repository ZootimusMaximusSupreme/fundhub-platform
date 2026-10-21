// Batch 11, repair cycle 2: the Company Brain screen, pressed where cycle 1 left it unseen.
//
// Practice tests in Chromium with a fake server. They add to fin-b11-company-brain.test.mjs and judge:
//   * Send: the chat keeps the name of its first question, and nothing a person or the server writes
//     is ever painted as markup (question, answer, file name, excerpt, chat name).
//   * Approve and Turn down: with TWO files waiting, the button on a file row decides THAT file's review
//     (the fixture lists the reviews in the opposite order to the files), both screens re-read after
//     either decision, the file row paints the right badge, and a button cannot be pressed twice.
//   * Files you added: the time each file was added is on its row and in its tooltip.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, clearShellOverlays, json, OWNER, sharedScreens, waitFor } from "./fin-b11-kit.mjs";

const { open } = sharedScreens();

function gate() {
  let release;
  const wait = new Promise((resolve) => { release = resolve; });
  return { wait, release };
}

const T1 = "7b000000-0000-4000-8000-000000000001";
const F1 = "7c000000-0000-4000-8000-000000000001";
const F2 = "7c000000-0000-4000-8000-000000000002";
const F3 = "7c000000-0000-4000-8000-000000000003";
const R1 = "7d000000-0000-4000-8000-000000000001";
const R3 = "7d000000-0000-4000-8000-000000000003";
const minutesAgo = (n) => new Date(Date.now() - n * 60_000).toISOString();

const UPLOADS = () => ({
  ok: true,
  uploads: [
    { id: F1, name: "Refund policy.pdf", approvalStatus: "pending", accessTier: "owner", sizeBytes: 2048, uploadedByName: "Casey Reed", uploadedAt: minutesAgo(20) },
    { id: F2, name: "Sales script.docx", approvalStatus: "approved", accessTier: "sales", sizeBytes: 2 * 1048576, uploadedByName: "Jordan Blake", uploadedAt: minutesAgo(5000) },
    { id: F3, name: "Second file.pdf", approvalStatus: "pending", accessTier: "owner", sizeBytes: 4096, uploadedByName: "Riley Park", uploadedAt: minutesAgo(3) }
  ],
  pendingCount: 2
});
// The review of the SECOND waiting file comes first, so "the first review" and "this file's review" differ.
const REVIEWS = () => ({
  ok: true,
  reviews: [
    { id: R3, file_id: F3, file_name: "Second file.pdf", proposed_tier: "sales", access_tier: "owner", rationale: "Sales material.", kind: "upload", web_view_link: null },
    { id: R1, file_id: F1, file_name: "Refund policy.pdf", proposed_tier: "staff", access_tier: "owner", rationale: "Reads like staff training.", kind: "upload", web_view_link: null }
  ]
});

/** Behaves like the real endpoint: the named review is decided, its file moves, and the next reads show it. */
function decideLikeServer(st) {
  return (body) => {
    const review = st.reviews.reviews.find((r) => r.id === body.review_id);
    if (!review) return { status: 404, body: { ok: false, error: "not_found" } };
    const file = st.uploads.uploads.find((u) => u.id === review.file_id);
    if (file) {
      file.approvalStatus = body.decision === "approve" ? "approved" : "rejected";
      file.accessTier = body.decision === "approve" ? review.proposed_tier : "owner";
    }
    st.uploads.pendingCount = st.uploads.uploads.filter((u) => u.approvalStatus === "pending").length;
    st.reviews.reviews = st.reviews.reviews.filter((r) => r.id !== review.id);
    return { status: 200, body: { ok: true, decision: body.decision === "approve" ? "approved" : "rejected" } };
  };
}

async function openBrain({ state = {}, askAnswer = null } = {}) {
  const st = { uploads: UPLOADS(), reviews: REVIEWS(), decide: null, decideGate: null, ...state };
  if (!st.decide) st.decide = decideLikeServer(st);
  const log = { asks: [], decides: [], uploadReads: 0, reviewReads: 0, threadReads: 0 };
  const handlers = {
    "/api/read/company-brain": async (route) => {
      const body = bodyOf(route);
      log.asks.push(body);
      return json(route, askAnswer(log.asks.length, body));
    },
    "/api/company-brain/threads": async (route, { url }) => {
      if (new URL(url).searchParams.get("thread_id")) return json(route, { ok: false, error: "thread_not_found" }, 404);
      log.threadReads += 1;
      return json(route, { ok: true, threads: [] });
    },
    "/api/company-brain/upload": async (route) => { log.uploadReads += 1; return json(route, st.uploads); },
    "/api/company-brain/reviews": async (route, { method }) => {
      if (method === "POST") {
        const body = bodyOf(route);
        log.decides.push(body);
        if (st.decideGate) await st.decideGate.wait;
        const out = st.decide(body);
        return json(route, out.body, out.status);
      }
      log.reviewReads += 1;
      return json(route, st.reviews);
    }
  };
  const opened = await open("/app/company-brain.html", { session: OWNER, handlers });
  await waitFor(() => log.uploadReads >= 1 && log.reviewReads >= 1 && log.threadReads >= 1, "the first reads");
  await clearShellOverlays(opened.page);
  return { ...opened, st, log };
}

const text = (page, selector) => page.locator(selector).innerText();
const rowOf = (page, name) => page.locator("#docList .docrow", { hasText: name });
const buttonsIn = (scope) => scope.getByRole("button");

// ── Send ───────────────────────────────────────────────────────────────────────────────────────

test("Send: the chat keeps the name of its first question, and nothing written by a person or the server is painted as markup", { timeout: 90_000 }, async () => {
  const hostile = '<b>Bold?</b> <img src=x onerror="window.__xss=1"> and more words to take it past sixty characters long';
  const answers = (n, body) => {
    const base = { ok: true, question: body.question, thread_id: T1, role: "owner" };
    if (n === 1) {
      return {
        ...base, answer: { text: '<script>window.__pwn=1</script><i>italic</i> & "quoted"', thin: false, source: "model" },
        sources: [{ n: 1, fileName: "<u>Evil</u>.pdf", webViewLink: null, accessTier: "staff", excerpt: '<img src=x onerror="window.__xss2=1">excerpt' }]
      };
    }
    return { ...base, answer: { text: "A plain second answer.", thin: false, source: "model" }, sources: [] };
  };
  const { page, log, errors } = await openBrain({ askAnswer: answers });
  const msgs = (sel) => page.locator(`#msgs ${sel}`);

  await page.locator("#q").fill(hostile);
  await page.locator("#askBtn").click();
  await waitFor(async () => /A plain|italic/.test(await text(page, "#msgs")), "the first answer");
  // What was typed is shown as typed, not as a bold word and a broken image.
  assert.equal(await msgs(".turn.user .bubble").innerText(), hostile);
  assert.equal(await msgs(".turn.user .bubble b").count(), 0, "no bold element came out of the question");
  assert.equal(await msgs(".turn.user .bubble img").count(), 0, "no image element came out of the question");
  // Likewise the answer, the file name and the excerpt.
  assert.equal(await msgs(".answer").innerText(), '<script>window.__pwn=1</script><i>italic</i> & "quoted"');
  assert.equal(await msgs(".answer i").count(), 0);
  assert.equal(await msgs(".answer script").count(), 0);
  assert.match(await msgs(".sname").innerText(), /^\[1\] <u>Evil<\/u>\.pdf$/);
  assert.equal(await msgs(".sname u").count(), 0);
  assert.match(await msgs(".sexc").innerText(), /^<img src=x onerror="window\.__xss2=1">excerpt$/);
  assert.equal(await msgs(".sexc img").count(), 0);
  assert.deepEqual(await page.evaluate(() => [window.__xss, window.__xss2, window.__pwn]), [undefined, undefined, undefined]);
  assert.deepEqual(errors, []);

  // The chat is named after the first question, cut at sixty characters.
  const firstTitle = hostile.slice(0, 60);
  assert.equal(await text(page, "#chatTitle"), firstTitle);
  assert.equal(await page.locator("#chatTitle").getAttribute("title"), firstTitle);

  // A second question in the same chat does not rename it.
  await page.locator("#q").fill("A completely different second question");
  await page.locator("#askBtn").click();
  await waitFor(async () => /A plain second answer\./.test(await text(page, "#msgs")), "the second answer");
  assert.deepEqual(log.asks[1], { question: "A completely different second question", thread_id: T1 });
  assert.equal(await text(page, "#chatTitle"), firstTitle, "the first question still names the chat");
  assert.equal(await page.locator("#chatTitle").getAttribute("title"), firstTitle);
  // A third one too, through Enter.
  await page.locator("#q").fill("And a third");
  await page.locator("#q").press("Enter");
  await waitFor(() => log.asks.length === 3, "the third question");
  await waitFor(async () => (await text(page, "#askBtn")) === "Send", "Send comes back");
  assert.equal(await text(page, "#chatTitle"), firstTitle);
  await page.close();
});

test("Send: a short first question names the chat in full, and an answer that fails keeps the chat's name as it was", { timeout: 60_000 }, async () => {
  const answers = (n, body) => (n === 1
    ? { ok: true, question: body.question, thread_id: T1, answer: { text: "Fine.", thin: false, source: "model" }, sources: [], role: "owner" }
    : { ok: false, error: "forbidden_role", status: 403 });
  const { page, log } = await openBrain({ askAnswer: answers });
  await page.locator("#q").fill("Short one");
  await page.locator("#askBtn").click();
  await waitFor(async () => /Fine\./.test(await text(page, "#msgs")), "the answer");
  assert.equal(await text(page, "#chatTitle"), "Short one");
  await page.locator("#q").fill("This one is refused");
  await page.locator("#askBtn").click();
  await waitFor(() => log.asks.length === 2, "the second question");
  await waitFor(async () => /Your role is not allowed to use Company Brain\./.test(await text(page, "#msgs")), "the refusal words");
  assert.equal(await text(page, "#chatTitle"), "Short one", "a refused question does not rename the chat");
  await page.close();

  // A first question that is refused leaves the chat unnamed. (What the next question that works does to
  // the name is a product finding, not asserted here: the page never sets it, see the manifest.)
  const second = await openBrain({ askAnswer: (n, body) => (n === 1
    ? { ok: false, error: "forbidden_role", status: 403 }
    : { ok: true, question: body.question, thread_id: T1, answer: { text: "Fine.", thin: false, source: "model" }, sources: [], role: "owner" }) });
  await second.page.locator("#q").fill("Refused first");
  await second.page.locator("#askBtn").click();
  await waitFor(async () => /Your role is not allowed to use Company Brain\./.test(await text(second.page, "#msgs")), "the refusal words");
  assert.equal(await text(second.page, "#chatTitle"), "New chat", "a refused first question names nothing");
  await second.page.close();
});

// ── Approve and Turn down ──────────────────────────────────────────────────────────────────────

test("a waiting file row decides its own review, both screens read again, and the row shows what happened", { timeout: 90_000 }, async () => {
  const { page, log } = await openBrain();
  await page.locator("#docsBtn").click();
  await waitFor(async () => (await page.locator("#docList .docrow").count()) === 3, "three files");

  // At the start: two waiting files, each with both buttons, the approved one with none.
  const badgeOf = async (name) => page.locator("#docList .docrow", { hasText: name }).locator(".badge").first();
  assert.equal(await (await badgeOf("Refund policy.pdf")).getAttribute("class"), "badge b-warn");
  assert.equal(await (await badgeOf("Sales script.docx")).getAttribute("class"), "badge b-ok");
  assert.equal(await (await badgeOf("Second file.pdf")).getAttribute("class"), "badge b-warn");
  assert.deepEqual(await buttonsIn(rowOf(page, "Refund policy.pdf")).allInnerTexts(), ["Approve", "Turn down"]);
  assert.deepEqual(await buttonsIn(rowOf(page, "Second file.pdf")).allInnerTexts(), ["Approve", "Turn down"]);
  assert.equal(await buttonsIn(rowOf(page, "Sales script.docx")).count(), 0);
  assert.equal(await page.locator("#pendPill2").evaluate((el) => el.textContent), "2 waiting");

  // Approve on the FIRST file's row. The first review in the list is the second file's, so a button that
  // sent "the first review" would approve the wrong file.
  const before = { uploads: log.uploadReads, reviews: log.reviewReads };
  await rowOf(page, "Refund policy.pdf").getByRole("button", { name: "Approve", exact: true }).click();
  await waitFor(() => log.decides.length === 1, "the approve request");
  assert.deepEqual(log.decides[0], { review_id: R1, decision: "approve" }, "this file's own review, not the first one in the list");
  await waitFor(() => log.uploadReads > before.uploads && log.reviewReads > before.reviews, "both screens read again");
  await waitFor(async () => (await (await badgeOf("Refund policy.pdf")).textContent()) === "approved", "the row shows approved");
  assert.equal(await (await badgeOf("Refund policy.pdf")).getAttribute("class"), "badge b-ok");
  assert.equal(await buttonsIn(rowOf(page, "Refund policy.pdf")).count(), 0, "a decided file has no buttons");
  assert.match(await rowOf(page, "Refund policy.pdf").innerText(), /seen by staff/);
  assert.match(await rowOf(page, "Refund policy.pdf").innerText(), /Company Brain can use this in answers\./);
  // The other waiting file is untouched, and the waiting review list holds only it.
  assert.equal(await (await badgeOf("Second file.pdf")).getAttribute("class"), "badge b-warn");
  assert.deepEqual(await page.locator("#reviewList .docrow .dn").allInnerTexts(), ["Second file.pdf"]);
  assert.equal(await page.locator("#pendPill2").evaluate((el) => el.textContent), "1 waiting");
  assert.equal(await page.locator("#pendPill").evaluate((el) => el.textContent), "1 waiting");

  // Turn down on the other file's row: that file's review, and the same re-reading afterwards.
  const mid = { uploads: log.uploadReads, reviews: log.reviewReads };
  await rowOf(page, "Second file.pdf").getByRole("button", { name: "Turn down", exact: true }).click();
  await waitFor(() => log.decides.length === 2, "the turn down request");
  assert.deepEqual(log.decides[1], { review_id: R3, decision: "reject" });
  await waitFor(() => log.uploadReads > mid.uploads && log.reviewReads > mid.reviews, "both screens read again after a turn down");
  await waitFor(async () => (await (await badgeOf("Second file.pdf")).textContent()) === "turned down", "the row shows turned down");
  assert.equal(await (await badgeOf("Second file.pdf")).getAttribute("class"), "badge b-alert", "a turned-down file is drawn as turned down, not as approved");
  assert.equal(await buttonsIn(rowOf(page, "Second file.pdf")).count(), 0, "a file that was turned down no longer offers its buttons");
  assert.match(await rowOf(page, "Second file.pdf").innerText(), /This will not be used in answers\./);
  assert.match(await text(page, "#reviewList"), /Nothing is waiting for you\./);
  assert.equal(await page.locator("#pendPill2").evaluate((el) => el.hidden), true, "nothing waiting, so the count is gone");
  assert.equal(await page.locator("#pendPill").evaluate((el) => el.hidden), true);
  await page.close();
});

test("the buttons in the waiting list decide the review on their own row, and a button cannot be pressed twice", { timeout: 90_000 }, async () => {
  const held = gate();
  const { page, log, st } = await openBrain();
  await page.locator("#docsBtn").click();
  await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 2, "two reviews");
  const reviewRows = page.locator("#reviewList .docrow");
  assert.match(await reviewRows.nth(0).innerText(), /Second file\.pdf/);
  assert.match(await reviewRows.nth(1).innerText(), /Refund policy\.pdf/);

  // The second row's own buttons: Approve is its review, not the first row's.
  await reviewRows.nth(1).getByRole("button", { name: "Approve", exact: true }).click();
  await waitFor(() => log.decides.length === 1, "the approve request");
  assert.deepEqual(log.decides[0], { review_id: R1, decision: "approve" });
  await waitFor(async () => (await page.locator("#reviewList .docrow").count()) === 1, "one review left");

  // Held answer: the pressed button is disabled while the request is out, and pressing it again sends nothing.
  st.decideGate = held;
  const only = page.locator("#reviewList .docrow").first();
  await only.getByRole("button", { name: "Turn down", exact: true }).click();
  await waitFor(() => log.decides.length === 2, "the turn down request");
  assert.deepEqual(log.decides[1], { review_id: R3, decision: "reject" });
  const stillThere = page.locator("#reviewList .docrow").first().getByRole("button", { name: "Turn down", exact: true });
  assert.equal(await stillThere.isDisabled(), true, "the pressed button is off while the answer is out");
  await stillThere.evaluate((el) => el.click());
  await page.waitForTimeout(150);
  assert.equal(log.decides.length, 2, "a second press while the first is out sends nothing");
  held.release();
  st.decideGate = null;
  await waitFor(async () => /Nothing is waiting for you\./.test(await text(page, "#reviewList")), "the list is empty after the decision");
  assert.equal(log.decides.length, 2);
  await page.close();
});

// ── Files you added ────────────────────────────────────────────────────────────────────────────

test("Files you added: each row carries when the file was added, in words and in its tooltip", { timeout: 60_000 }, async () => {
  const stamps = [new Date(Date.now() - 5_000).toISOString(), minutesAgo(20), minutesAgo(5 * 60), minutesAgo(5000)];
  const { page } = await openBrain({
    state: {
      uploads: {
        ok: true, pendingCount: 0,
        uploads: [
          { id: F1, name: "Just now.pdf", approvalStatus: "approved", accessTier: "staff", sizeBytes: 2048, uploadedByName: "Casey Reed", uploadedAt: stamps[0] },
          { id: F2, name: "Minutes.pdf", approvalStatus: "approved", accessTier: "staff", sizeBytes: 2048, uploadedByName: "Casey Reed", uploadedAt: stamps[1] },
          { id: F3, name: "Hours.pdf", approvalStatus: "approved", accessTier: "staff", sizeBytes: 2048, uploadedByName: "Casey Reed", uploadedAt: stamps[2] },
          { id: "7c000000-0000-4000-8000-000000000004", name: "Days.pdf", approvalStatus: "approved", accessTier: "sales", sizeBytes: 2 * 1048576, uploadedByName: "Jordan Blake", uploadedAt: stamps[3] },
          { id: "7c000000-0000-4000-8000-000000000005", name: "Unknown.pdf", approvalStatus: "rejected", accessTier: "owner", sizeBytes: null, uploadedByName: null, uploadedAt: null }
        ]
      },
      reviews: { ok: true, reviews: [] }
    }
  });
  await page.locator("#docsBtn").click();
  await waitFor(async () => (await page.locator("#docList .docrow").count()) === 5, "five files");
  const meta = async (name) => rowOf(page, name).locator(".dm").innerText();
  assert.equal(await meta("Just now.pdf"), "2 KB · seen by staff · added by Casey Reed · just now");
  assert.equal(await meta("Minutes.pdf"), "2 KB · seen by staff · added by Casey Reed · 20m ago");
  assert.equal(await meta("Hours.pdf"), "2 KB · seen by staff · added by Casey Reed · 5h ago");
  assert.match(await meta("Days.pdf"), /^2\.0 MB · seen by sales · added by Jordan Blake · [A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [AP]M$/);
  // A file with no known time, size or uploader shows only what is known.
  assert.equal(await meta("Unknown.pdf"), "seen by owner");
  // The tooltip is the full local time of the same instant.
  const titles = await page.locator("#docList .docrow").evaluateAll((els) => els.map((e) => e.title));
  for (let i = 0; i < 4; i += 1) {
    assert.equal(titles[i], await page.evaluate((iso) => new Date(iso).toLocaleString(), stamps[i]), `row ${i + 1} tooltip`);
  }
  assert.equal(titles[4], "", "no time, no tooltip");
  await page.close();
});
