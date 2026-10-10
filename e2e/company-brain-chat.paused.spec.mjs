// Live proof for the Company Brain chat rebuild (batch company-brain-chat-2026-08-17).
//
// Runs against the DEPLOYED site, never localhost — local `netlify dev` answers 503
// "db down" under a screen's normal burst of reads and would poison the result.
//
// What it proves, end to end, with real writes:
//   1. The screen is a full-width chat, not a small card floating in empty space.
//   2. A staff member can upload a real document.
//   3. That document is NOT answerable while it waits for approval  <-- the safety claim
//   4. The owner can approve it.
//   5. After approval the same document IS answerable and gets cited.
//   6. The conversation survives a page reload.
//
// Step 3 is the one that matters most. If it ever goes green by accident, an
// unreviewed document is answering questions.

import { test, expect } from "@playwright/test";
import { BASE, apiLogin, liveStaffLogin } from "./live-auth.mjs";

const OWNER = "owner@fundhub.ai";

// A document with a phrase that cannot already be in the index, so a citation
// proves THIS upload was retrieved and not some pre-existing file.
const MARKER = "Zephyr Quill Protocol";
const DOC_TEXT = [
  "Fundhub internal test document — Company Brain upload proof.",
  "",
  `The ${MARKER} is the agreed name for our rate-objection rebuttal sequence.`,
  `When a client objects to the rate, the closer opens the ${MARKER} and works`,
  "through its three steps in order: acknowledge, reframe against cost of delay,",
  "then restate the funding amount.",
  "",
  "This file exists only to prove that an uploaded document can be searched."
].join("\n");

const QUESTION = `What is the ${MARKER}?`;

async function authedContext(request) {
  const { status, body } = await apiLogin(request, OWNER);
  expect(status, "owner login should succeed").toBe(200);
  const token = body.token || (body.session && body.session.token);
  expect(token, "login should return a token").toBeTruthy();
  return { authorization: `Bearer ${token}` };
}

test.describe("Company Brain — chat, upload, approval gating", () => {
  test("the screen is a wide chat, not a tiny box", async ({ page }) => {
    await liveStaffLogin(page, OWNER);
    await expect(page).toHaveURL(/\/app\/[^/]+\.html(?:[?#]|$)/, { timeout: 30_000 });
    await page.goto(`${BASE}/app/company-brain.html`, { waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 1440, height: 900 });

    const composer = page.locator("textarea").first();
    await expect(composer, "the chat composer should be on the page").toBeVisible();

    // The conversation column must actually use the window. The old screen put
    // everything in a narrow card; anything under half the viewport is that bug.
    const conversation = page.locator("[data-brain-conversation]").first();
    await expect(conversation).toBeVisible();
    const box = await conversation.boundingBox();
    expect(box, "conversation area should have a box").toBeTruthy();
    expect(box.width, "conversation should fill most of the window").toBeGreaterThan(700);

    // Nothing on the page may scroll sideways.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "page must not scroll sideways").toBeLessThanOrEqual(1);
  });

  test("upload stays unanswerable until the owner approves it", async ({ request }) => {
    const headers = await authedContext(request);

    // --- 1. upload -------------------------------------------------------
    const up = await request.post(`${BASE}/api/company-brain/upload`, {
      headers,
      multipart: {
        file: {
          name: `zephyr-quill-proof-${Date.now()}.txt`,
          mimeType: "text/plain",
          buffer: Buffer.from(DOC_TEXT, "utf8")
        }
      }
    });
    const upBody = await up.json();
    expect(up.status(), `upload failed: ${JSON.stringify(upBody)}`).toBe(200);
    expect(upBody.ok).toBe(true);
    expect(upBody.file.approvalStatus, "a fresh upload must be pending").toBe("pending");
    expect(upBody.file.chunkCount, "the document should have produced chunks").toBeGreaterThan(0);
    const reviewId = upBody.file.reviewId;
    expect(reviewId, "upload should enqueue a review").toBeTruthy();

    // --- 2. THE SAFETY CLAIM: pending is not answerable -------------------
    const blocked = await request.post(`${BASE}/api/read/company-brain`, {
      headers, data: { question: QUESTION }
    });
    const blockedBody = await blocked.json();
    expect(blocked.status()).toBe(200);
    const blockedCites = (blockedBody.sources || []).map((s) => s.fileName).join(" ");
    expect(blockedCites, "a PENDING upload must never be cited").not.toContain("zephyr-quill-proof");
    expect(blockedBody.answer.text,
      "a pending upload's contents must not reach the answer"
    ).not.toContain(MARKER);

    // --- 3. owner approves ------------------------------------------------
    const decide = await request.post(`${BASE}/api/company-brain/reviews`, {
      headers, data: { review_id: reviewId, decision: "approve" }
    });
    const decideBody = await decide.json();
    expect(decide.status(), `approve failed: ${JSON.stringify(decideBody)}`).toBe(200);
    expect(decideBody.ok).toBe(true);

    // --- 4. now it answers -------------------------------------------------
    const allowed = await request.post(`${BASE}/api/read/company-brain`, {
      headers, data: { question: QUESTION }
    });
    const allowedBody = await allowed.json();
    expect(allowed.status()).toBe(200);
    const allowedCites = (allowedBody.sources || []).map((s) => s.fileName).join(" ");
    expect(allowedCites, "after approval the upload should be cited").toContain("zephyr-quill-proof");
    expect(allowedBody.thread_id, "the turn should be saved to a conversation").toBeTruthy();
  });

  test("a conversation survives a reload", async ({ page, request }) => {
    const headers = await authedContext(request);

    const asked = await request.post(`${BASE}/api/read/company-brain`, {
      headers, data: { question: "What does the closer do on a rate objection?" }
    });
    const askedBody = await asked.json();
    expect(asked.status()).toBe(200);
    const threadId = askedBody.thread_id;
    expect(threadId, "asking should create a conversation").toBeTruthy();

    const back = await request.get(
      `${BASE}/api/company-brain/threads?thread_id=${threadId}`, { headers });
    const backBody = await back.json();
    expect(back.status()).toBe(200);
    expect(backBody.messages.length, "the question and its answer should both be saved").toBe(2);
    expect(backBody.messages[0].role).toBe("user");
    expect(backBody.messages[1].role).toBe("assistant");

    // And the screen shows it after a fresh load.
    await liveStaffLogin(page, OWNER);
    await page.goto(`${BASE}/app/company-brain.html`, { waitUntil: "domcontentloaded" });
    await expect(
      page.locator("[data-brain-thread-list]").first(),
      "past conversations should be listed"
    ).toBeVisible();
  });
});
