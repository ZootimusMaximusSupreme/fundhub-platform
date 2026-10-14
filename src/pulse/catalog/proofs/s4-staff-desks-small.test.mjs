// Two staff desk rows: the contract Void button on the documents desk (asks for
// a reason, owner and admin only) and the interview form on the CSM queue (the
// channel, one box per question, the notes, and nothing written sends nothing).

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";
import { waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const CT = "c7000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const TASK = "7a000000-0000-4000-8000-000000000001";

const DOCS = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{
    id: "d-ct", kind: "contract", title: "Funding Agreement", client_name: "Dana Whitfield",
    created_at: "2026-10-08T10:00:00Z", generated_at: "2026-10-08T10:00:00Z", delivered_at: "2026-10-08T11:00:00Z",
    delivery_status: "sent", signature_required: true, signed_at: null, expires_at: "2026-11-08T10:00:00Z", mime_type: "application/pdf",
  }],
};

async function openDocuments(open, { role = "owner", status = "sent" } = {}) {
  const writes = [];
  const handlers = {
    "/api/read/documents": DOCS,
    "/api/read/contracts": { ok: true, items: [{ id: CT, document_id: "d-ct", status, signed_document_id: null }] },
    "/api/contracts": async (route) => {
      const body = bodyOf(route);
      writes.push(body);
      return json(route, { ok: true, message: "Contract voided." });
    },
  };
  const session = { ok: true, staff: { ...OWNER.staff, role } };
  const opened = await open("/app/documents.html", { session, handlers });
  await opened.page.waitForSelector("#body tr");
  return { ...opened, writes };
}

// Void is drawn for an owner or admin only, and only on a contract nobody has signed.
const VOID_ROLES = [["owner", true], ["admin", true], ["closer", false], ["csm", false]];

test("Void asks for a reason, sends it, and is offered only to an owner or admin on an unsigned contract", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Contract cell: Void button/, async () => {
    const { page, writes } = await openDocuments(open);
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator(`[data-ct="void"][data-cid="${CT}"]`).click();
    await page.waitForTimeout(150);
    assert.deepEqual(writes, [], "cancelling the question sends nothing");
    page.once("dialog", (dialog) => dialog.accept("Client chose a different plan"));
    await page.locator(`[data-ct="void"][data-cid="${CT}"]`).click();
    await waitFor(() => writes.length === 1);
    assert.deepEqual(writes[0], { action: "void", id: CT, reason: "Client chose a different plan" });
    await page.waitForFunction(() => /Contract voided\./.test(document.querySelector("#ctMsg")?.innerText || ""));
    await page.close();

    for (const [role, offered] of VOID_ROLES) {
      const desk = await openDocuments(open, { role });
      assert.equal(await desk.page.locator('[data-ct="void"]').count(), offered ? 1 : 0, `${role}: ${offered ? "is offered" : "is not offered"} Void`);
      await desk.page.close();
    }
    const signed = await openDocuments(open, { status: "signed" });
    assert.equal(await signed.page.locator('[data-ct="void"]').count(), 0, "a signed contract cannot be voided");
    await signed.page.close();
  });
});

const queueRow = (task, source) => ({
  task_id: task, client_id: CLIENT, client_name: "Dana Whitfield", client_code: "FH-000101",
  title: "Check-in call", due_at: new Date(Date.now() + 3_600_000).toISOString(),
  owned_codes: ["funding_bundle"], balance_due: null, open_invoices: 0, assignee_staff_id: null,
  source_workflow: source, meeting_url: null,
});
const POST_TASK = "7a000000-0000-4000-8000-000000000002";
const QUESTIONS = {
  mid: [{ id: "why_buy", prompt: "Why did you buy?" }, { id: "surprise", prompt: "What surprised you so far?" }],
  post: [{ id: "result", prompt: "What happened with your funding?" }],
};
// One interview per stage: the halfway call asks the mid questions, the after-funding call the post ones.
// `channel` is the way of speaking the box starts on for that stage.
const INTERVIEWS = [
  { stage: "mid", task: TASK, source: "customer-insights-mid", answerBox: "why_buy", answer: "I want a line of credit for inventory.", channel: "call" },
  { stage: "post", task: POST_TASK, source: "customer-insights-post", answerBox: "result", answer: "Two cards for $40,000.", channel: "google_meet" },
];
// The "How did you speak to them" box offers these three, in this order, for both stages.
const CHANNELS = [["call", "Phone call"], ["google_meet", "Google Meet"], ["ai_reachout", "AI reach-out"]];

async function openQueue(open) {
  const saves = [];
  const handlers = {
    "/api/shifts": { ok: true, shift: null },
    "/api/read/csm-queue": { ok: true, items: INTERVIEWS.map((i) => queueRow(i.task, i.source)) },
    "/api/read/customer-insights": { ok: true, items: [], questions: QUESTIONS },
    "/api/customer-insights": async (route) => {
      saves.push(bodyOf(route));
      return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, insight: { id: "i1" } }) });
    },
  };
  const session = { ok: true, staff: { ...OWNER.staff, role: "csm" } };
  const opened = await open("/app/csm-queue.html", { session, handlers });
  await opened.page.waitForSelector(`.card[data-row="${TASK}"]`);
  return { ...opened, saves };
}

test("the interview form sends the channel, each answer and the notes, and nothing written sends nothing", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Interview form: 'How did you speak to them' select/, async () => {
    for (const interview of INTERVIEWS) {
      const { page, saves } = await openQueue(open);
      await page.locator(`[data-open="${interview.task}"]`).click();
      await page.waitForSelector(`#qa-${interview.answerBox}`);
      const boxes = await page.locator('[id^="qa-"]').evaluateAll((els) => els.map((el) => el.id.replace("qa-", "")));
      assert.deepEqual(boxes, QUESTIONS[interview.stage].map((q) => q.id), `${interview.stage}: one box per question for this stage`);
      const chan = await page.locator("#qChan").evaluate((el) => ({ value: el.value, options: [...el.options].map((o) => [o.value, o.textContent]) }));
      assert.deepEqual(chan.options, CHANNELS, `${interview.stage}: the three ways of speaking`);
      assert.equal(chan.value, interview.channel, `${interview.stage}: the box starts on ${interview.channel}`);
      await page.locator(`[data-save="${interview.task}"]`).click();
      assert.equal(await page.locator("#qSay").innerText(), "Write down at least one answer before saving.");
      assert.deepEqual(saves, [], "nothing written, nothing sent");
      await page.locator("#qChan").selectOption("google_meet");
      await page.locator(`#qa-${interview.answerBox}`).fill(`  ${interview.answer} `);
      await page.locator("#qNotes").fill("Call back in May.");
      await page.locator(`[data-save="${interview.task}"]`).click();
      await waitFor(() => saves.length === 1);
      assert.deepEqual(saves[0], {
        client_id: CLIENT, task_id: interview.task, stage: interview.stage, channel: "google_meet",
        answers: { [interview.answerBox]: interview.answer }, notes: "Call back in May.",
      }, `${interview.stage}: the exact save`);
      await page.waitForFunction(() => /Answers saved for Dana Whitfield\./.test(document.body.innerText));
      await page.close();
    }
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
