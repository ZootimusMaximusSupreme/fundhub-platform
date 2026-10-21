// Batch 11, repair cycle 2: the Company Brain endpoints run for real over stand-in rows.
//
// These are practice tests of the product's own code, not live checks. The page tests use a fake
// server, so they cannot see what the ask endpoint saves or what the chat list hands back. Here the
// real handler files (api/read/company-brain.mjs, api/company-brain/threads.mjs and
// api/company-brain/reviews.mjs) run with the real thread, answer and decision code from
// src/company-brain/, over an in-memory SQLite that holds the real column names (see
// fin-b11-handler-kit.mjs). Each test reads what the handler SAVED back out of the rows, and the live
// checks' own SQL is then run over those rows to show they read the real result as right.
//
// Nothing here reaches a real database, a model or the network. Every "model" is a stand-in fetch.

import { test } from "node:test";
import assert from "node:assert/strict";

import askHandler from "../../../../api/read/company-brain.mjs";
import threadsHandler from "../../../../api/company-brain/threads.mjs";
import reviewsHandler from "../../../../api/company-brain/reviews.mjs";
import { synthesizeAnswer } from "../../../company-brain/answer.mjs";
import { FIN_B11_CHECKS, sqlFor } from "./fin-b11-display-contracts.mjs";
import { mockRes, standInDatabase } from "./fin-b11-handler-kit.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const u = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OWNER = { id: u(900), org_id: ORG, role: "owner", name: "Casey Owner" };
const CLOSER = { id: u(901), org_id: ORG, role: "closer", name: "Riley Closer" };
const OTHER_OWNER = { id: u(902), org_id: OTHER_ORG, role: "owner", name: "Other Owner" };
const check = (key) => FIN_B11_CHECKS.find((c) => c.key === key);

const CHUNKS = [
  { fileName: "Contracts SOP.pdf", webViewLink: "https://drive.example.test/contracts", driveFileId: "1abc", accessTier: "staff",
    content: "Open the client and press Send contract.", mimeType: "application/pdf" },
  { fileName: "Refund policy.docx", webViewLink: null, driveFileId: null, accessTier: "owner",
    content: "Refunds over ten percent go to the manager.", mimeType: null }
];

/** A stand-in OpenAI answer, so the real synthesizeAnswer runs its model branch. */
function modelFetch(text) {
  return async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: text } }], usage: { prompt_tokens: 5, completion_tokens: 5 } }) });
}

function brainBook() {
  const database = standInDatabase(["brain_threads", "brain_messages", "staff"]);
  database.si.insert("staff", { id: OWNER.id, org_id: ORG, name: OWNER.name, role: "owner" });
  database.si.insert("staff", { id: CLOSER.id, org_id: ORG, name: CLOSER.name, role: "closer" });
  database.si.insert("staff", { id: OTHER_OWNER.id, org_id: OTHER_ORG, name: OTHER_OWNER.name, role: "owner" });
  return database;
}

/** One question through the real ask handler. `chunks` is what retrieval found; `model` is the model's words or null. */
async function ask(database, { staff = OWNER, question, threadId = null, chunks = CHUNKS, model = null } = {}) {
  const res = mockRes();
  const body = { question };
  if (threadId) body.thread_id = threadId;
  await askHandler({ method: "POST", body, headers: {} }, res, {
    db: database,
    requireAuth: async () => staff,
    retrieveChunks: async () => ({ ok: true, chunks }),
    synthesizeAnswer,
    env: model ? { OPENAI_API_KEY: "test-key-not-real" } : {},
    fetchImpl: model ? modelFetch(model) : undefined
  });
  return res;
}

test("Send: a model answer is saved as a question and an answer, with its files, its engine and a chat named after the question", async () => {
  const database = brainBook();
  const res = await ask(database, { question: "  How do I send a contract?  ", model: "Open the client and press Send contract [1]." });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.answer.source, "model");
  assert.equal(res.body.answer.thin, false);
  assert.equal(res.body.sources.length, 2);

  const threads = database.rows("brain_threads");
  assert.equal(threads.length, 1);
  assert.equal(res.body.thread_id, threads[0].id, "the answer names the chat it was saved in");
  assert.equal(threads[0].title, "How do I send a contract?", "the chat is named after its first question, trimmed");
  assert.equal(threads[0].org_id, ORG);
  assert.equal(threads[0].staff_id, OWNER.id, "the chat belongs to the person who asked");

  const messages = database.rows("brain_messages", "ORDER BY created_at ASC, id ASC");
  assert.deepEqual(messages.map((m) => m.role), ["user", "assistant"]);
  assert.equal(messages[0].text, "How do I send a contract?", "the question is saved as typed, trimmed");
  const [asked, answered] = messages;
  assert.equal(answered.text, "Open the client and press Send contract [1].");
  assert.equal(answered.answer_source, "model");
  assert.equal(answered.thin, false);
  assert.equal(asked.org_id, ORG);
  assert.equal(answered.org_id, ORG);
  // The files the answer was built from are saved with it, name and link, in order.
  assert.deepEqual(answered.sources.map((s) => [s.n, s.fileName, s.webViewLink, s.accessTier]),
    [[1, "Contracts SOP.pdf", "https://drive.example.test/contracts", "staff"], [2, "Refund policy.docx", null, "owner"]]);
  assert.match(answered.sources[0].excerpt, /press Send contract/);

  // The live check reads that saved chat as right: one chat, nothing wrong.
  assert.deepEqual(database.runCheck(sqlFor(check("brain-turns")), ORG), { sample_count: 1, bad_count: 0 });
});

test("Send: with no model the copy-out answer is saved as extractive and thin, still with its files", async () => {
  const database = brainBook();
  const res = await ask(database, { question: "Who approves a refund?" });
  assert.equal(res.body.answer.source, "extractive");
  assert.equal(res.body.answer.thin, true);
  const [, answered] = database.rows("brain_messages", "ORDER BY created_at ASC, id ASC");
  assert.equal(answered.answer_source, "extractive");
  assert.equal(answered.thin, true);
  assert.equal(answered.sources.length, 2, "a copied answer still lists the files it was copied from");
  assert.match(answered.text, /Refund policy\.docx/);
  assert.deepEqual(database.runCheck(sqlFor(check("brain-turns")), ORG), { sample_count: 1, bad_count: 0 });
});

test("Send: nothing matched is saved as none, thin, with no files and its own words", async () => {
  const database = brainBook();
  const res = await ask(database, { question: "What is the weather?", chunks: [] });
  assert.equal(res.body.answer.source, "none");
  const [, answered] = database.rows("brain_messages", "ORDER BY created_at ASC, id ASC");
  assert.equal(answered.answer_source, "none");
  assert.equal(answered.thin, true);
  assert.deepEqual(answered.sources, []);
  assert.equal(answered.text, "No matching documents in your clearance for that question.");
  assert.deepEqual(database.runCheck(sqlFor(check("brain-turns")), ORG), { sample_count: 1, bad_count: 0 });
});

test("Send: a second question lands in the same chat, keeps the first title, and the answer is paired with its question", async () => {
  const database = brainBook();
  // Sixty characters end exactly on a space ("Word " x 12), so a title that is not trimmed ends in one.
  const longQuestion = `${"Word ".repeat(12)}and then what is the next step for the client?`;
  const first = await ask(database, { question: longQuestion, model: "First answer [1]." });
  const chat = first.body.thread_id;
  const second = await ask(database, { question: "And how do I void one?", threadId: chat, model: "Second answer [1]." });
  assert.equal(second.body.thread_id, chat, "the follow-up rides in the chat it named");

  const threads = database.rows("brain_threads");
  assert.equal(threads.length, 1, "no second chat was made");
  assert.ok(threads[0].title.length <= 60, `title is at most 60 characters (was ${threads[0].title.length})`);
  assert.equal(threads[0].title, longQuestion.trim().slice(0, 60).trim(), "named after the first 60 characters of the first question");
  assert.equal(threads[0].title, threads[0].title.trim(), "no spaces around the title");
  assert.equal(threads[0].title, `${"Word ".repeat(11)}Word`, "cut at sixty and trimmed");

  const messages = database.rows("brain_messages", "ORDER BY created_at ASC, id ASC");
  assert.deepEqual(messages.map((m) => [m.role, m.text.slice(0, 20)]), [
    ["user", "Word Word Word Word "], ["assistant", "First answer [1]."], ["user", "And how do I void on"], ["assistant", "Second answer [1]."]
  ]);
  assert.deepEqual(database.runCheck(sqlFor(check("brain-turns")), ORG), { sample_count: 1, bad_count: 0 });
});

test("Send: a chat id that belongs to someone else starts a new chat and nothing is added to theirs", async () => {
  const database = brainBook();
  const theirs = await ask(database, { staff: CLOSER, question: "My own question", model: "Mine [1]." });
  const theirRows = () => JSON.stringify(database.rows("brain_messages", `WHERE thread_id = '${theirs.body.thread_id}' ORDER BY id`));
  const before = theirRows();
  const mine = await ask(database, { staff: OWNER, question: "Trying to write into your chat", threadId: theirs.body.thread_id, model: "Not theirs [1]." });
  assert.notEqual(mine.body.thread_id, theirs.body.thread_id, "the answer went to a chat of the asker's own");
  assert.equal(JSON.parse(theirRows()).length, 2, "nothing was added to the other person's chat");
  assert.equal(theirRows(), before, "and nothing in it changed");
  assert.equal(database.rows("brain_threads").length, 2);
  assert.equal(database.rows("brain_threads", `WHERE id = '${mine.body.thread_id}'`)[0].staff_id, OWNER.id);
});

test("Send: a refused or empty question saves nothing", async () => {
  const database = brainBook();
  const blank = await ask(database, { question: "   " });
  assert.equal(blank.statusCode, 400);
  const tooLong = await ask(database, { question: "x".repeat(2001) });
  assert.equal(tooLong.statusCode, 400);
  const client = await ask(database, { staff: { id: u(950), org_id: ORG, role: "client" }, question: "Hello" });
  assert.ok([401, 403].includes(client.statusCode), `a client is refused (${client.statusCode})`);
  assert.equal(database.rows("brain_threads").length, 0);
  assert.equal(database.rows("brain_messages").length, 0);
});

// ── Past chats: the list and the reopened chat, run for real ────────────────────────────────────

async function listChats(database, staff) {
  const res = mockRes();
  await threadsHandler({ method: "GET", query: {}, headers: {} }, res, { db: database, requireAuth: async () => staff });
  return res;
}
async function openChat(database, staff, id) {
  const res = mockRes();
  await threadsHandler({ method: "GET", query: { thread_id: id }, headers: {} }, res, { db: database, requireAuth: async () => staff });
  return res;
}

test("Past chats: the list holds this person's own chats only, newest first, with the number of messages", async () => {
  const database = brainBook();
  const a = await ask(database, { staff: OWNER, question: "First owner question", model: "A1 [1]." });
  await ask(database, { staff: OWNER, question: "Second owner question", model: "B1 [1]." });
  await ask(database, { staff: OWNER, question: "Follow up on the first", threadId: a.body.thread_id, model: "A2 [1]." });
  await ask(database, { staff: CLOSER, question: "A closer's question", model: "C1 [1]." });
  await ask(database, { staff: OTHER_OWNER, question: "Another company's question", model: "D1 [1]." });

  const mine = await listChats(database, OWNER);
  assert.equal(mine.statusCode, 200);
  assert.deepEqual(mine.body.threads.map((t) => t.title), ["First owner question", "Second owner question"],
    "the follow-up put the first chat on top again: newest activity first");
  assert.deepEqual(mine.body.threads.map((t) => t.messageCount), [4, 2]);
  assert.ok(mine.body.threads.every((t) => t.id && t.createdAt && t.updatedAt));
  // Someone else's chat is never in the list: not the closer's in the same company, not another company's.
  assert.equal(mine.body.threads.some((t) => /closer|Another company/.test(t.title)), false);
  const closer = await listChats(database, CLOSER);
  assert.deepEqual(closer.body.threads.map((t) => t.title), ["A closer's question"]);
  const other = await listChats(database, OTHER_OWNER);
  assert.deepEqual(other.body.threads.map((t) => t.title), ["Another company's question"]);
});

test("Past chats: a reopened chat is the whole conversation in order, with its files, and someone else's chat is not found", async () => {
  const database = brainBook();
  const first = await ask(database, { staff: OWNER, question: "How do I send a contract?", model: "Open the client [1]." });
  await ask(database, { staff: OWNER, question: "And void one?", threadId: first.body.thread_id, chunks: [], model: null });
  const theirs = await ask(database, { staff: CLOSER, question: "Closer only", model: "Hers [1]." });

  const opened = await openChat(database, OWNER, first.body.thread_id);
  assert.equal(opened.statusCode, 200);
  assert.equal(opened.body.thread.title, "How do I send a contract?");
  assert.deepEqual(opened.body.messages.map((m) => m.role), ["user", "assistant", "user", "assistant"], "oldest first, question before its answer");
  assert.equal(opened.body.messages[0].text, "How do I send a contract?");
  assert.equal(opened.body.messages[1].text, "Open the client [1].");
  assert.equal(opened.body.messages[1].answerSource, "model");
  assert.equal(opened.body.messages[1].thin, false);
  assert.deepEqual(opened.body.messages[1].sources.map((s) => s.fileName), ["Contracts SOP.pdf", "Refund policy.docx"]);
  assert.equal(opened.body.messages[3].answerSource, "none");
  assert.equal(opened.body.messages[3].thin, true);
  assert.deepEqual(opened.body.messages[3].sources, []);

  // A message that sits in another company is never part of this chat's transcript.
  database.si.insert("brain_messages", {
    id: u(5000), org_id: OTHER_ORG, thread_id: first.body.thread_id, role: "assistant", text: "From another company",
    sources: "[]", answer_source: "model", thin: 0, created_at: "2026-10-14T12:00:00.500Z"
  });
  const withStray = await openChat(database, OWNER, first.body.thread_id);
  assert.equal(withStray.body.messages.length, 4, "the message from another company is left out");
  assert.equal(withStray.body.messages.some((m) => m.text === "From another company"), false);

  // Another person's chat, another company's, and a chat that never existed all read the same way.
  for (const [who, id] of [[OWNER, theirs.body.thread_id], [OTHER_OWNER, first.body.thread_id], [OWNER, u(777)]]) {
    const missing = await openChat(database, who, id);
    assert.equal(missing.statusCode, 404, `${who.role} ${id.slice(-4)}`);
    assert.equal(missing.body.error, "thread_not_found");
    assert.equal(missing.body.messages, undefined);
  }
  const bad = await openChat(database, OWNER, "not-a-uuid");
  assert.equal(bad.statusCode, 400);
});

// ── the owner's decision through the real POST handler ────────────────────────────────────────────

const file = (id, over = {}) => ({
  id, org_id: ORG, drive_file_id: `upload:${id}`, name: `${id.slice(-3)}.pdf`, original_name: `${id.slice(-3)}.pdf`,
  mime_type: "application/pdf", web_view_link: null, source: "upload", approval_status: "pending",
  classification_status: "pending", access_tier: "owner", proposed_tier: "staff", size_bytes: 2048, uploaded_by: OWNER.id,
  created_at: "2026-10-14T10:00:00.000Z", updated_at: "2026-10-14T10:00:00.000Z", ...over
});
const reviewRow = (id, file_id, over = {}) => ({
  id, org_id: ORG, file_id, drive_file_id: "d", proposed_tier: "staff", rationale: "Reads like staff training.",
  status: "pending", kind: "upload", created_at: "2026-10-14T10:01:00.000Z", updated_at: "2026-10-14T10:01:00.000Z", ...over
});

function decisionBook() {
  const database = standInDatabase(["brain_files", "brain_classification_reviews", "brain_chunks", "brain_affiliate_allowlist", "staff"],
    { unique: { brain_affiliate_allowlist: ["org_id", "file_id"] } });
  const { si } = database;
  si.insert("staff", { id: OWNER.id, org_id: ORG, name: OWNER.name, role: "owner" });
  si.insert("staff", { id: OTHER_OWNER.id, org_id: OTHER_ORG, name: OTHER_OWNER.name, role: "owner" });
  // Two waiting uploads, so "this review" and "the first review" are different things.
  si.insert("brain_files", file(u(1)));
  si.insert("brain_files", file(u(2), { name: "Second.pdf" }));
  si.insert("brain_files", file(u(3), { name: "Third.pdf", proposed_tier: "affiliate" }));
  for (const [n, f] of [[21, u(1)], [22, u(2)], [23, u(3)]]) {
    si.insert("brain_chunks", { id: u(n + 10), org_id: ORG, file_id: f, chunk_index: 0, content: "c", access_tier: "owner" });
  }
  si.insert("brain_classification_reviews", reviewRow(u(11), u(1)));
  si.insert("brain_classification_reviews", reviewRow(u(12), u(2), { created_at: "2026-10-14T10:02:00.000Z" }));
  si.insert("brain_classification_reviews", reviewRow(u(13), u(3), { proposed_tier: "affiliate", created_at: "2026-10-14T10:03:00.000Z" }));
  return database;
}

async function decide(database, staff, reviewId, decision) {
  const res = mockRes();
  await reviewsHandler({ method: "POST", body: { review_id: reviewId, decision }, headers: {} }, res, { db: database, requireAuth: async () => staff });
  return res;
}

test("Approve and Turn down through the real POST handler: the named review is decided, by the owner who pressed, with the time", async () => {
  const database = decisionBook();
  const approved = await decide(database, OWNER, u(12), "approve");
  assert.equal(approved.statusCode, 200);
  const turned = await decide(database, OWNER, u(13), "reject");
  assert.equal(turned.statusCode, 200);

  const reviews = Object.fromEntries(database.rows("brain_classification_reviews").map((r) => [r.id, r]));
  assert.equal(reviews[u(12)].status, "approved");
  assert.equal(reviews[u(12)].decided_by, OWNER.id, "an approval names the owner who pressed it");
  assert.ok(reviews[u(12)].decided_at, "and when");
  assert.equal(reviews[u(13)].status, "rejected");
  assert.equal(reviews[u(13)].decided_by, OWNER.id, "a turn down names the owner who pressed it");
  assert.ok(reviews[u(13)].decided_at);
  assert.equal(reviews[u(11)].status, "pending", "the first review was not touched");
  assert.equal(reviews[u(11)].decided_by, null);

  const files = Object.fromEntries(database.rows("brain_files").map((f) => [f.id, f]));
  assert.deepEqual([files[u(1)].approval_status, files[u(1)].access_tier], ["pending", "owner"], "the first file is still waiting");
  assert.deepEqual([files[u(2)].approval_status, files[u(2)].access_tier], ["approved", "staff"]);
  assert.deepEqual([files[u(3)].approval_status, files[u(3)].access_tier], ["rejected", "owner"]);
  const chunks = Object.fromEntries(database.rows("brain_chunks").map((c) => [c.file_id, c.access_tier]));
  assert.deepEqual([chunks[u(1)], chunks[u(2)], chunks[u(3)]], ["owner", "staff", "owner"]);

  // The live checks read exactly this as right.
  assert.deepEqual(database.runCheck(sqlFor(check("brain-review-approved")), ORG, { after: 5 * 60_000 }), { sample_count: 1, bad_count: 0 });
  assert.deepEqual(database.runCheck(sqlFor(check("brain-review-rejected")), ORG, { after: 5 * 60_000 }), { sample_count: 1, bad_count: 0 });
});

test("Approve and Turn down: a refused or repeated decision changes nothing and says why", async () => {
  const database = decisionBook();
  const snapshot = () => JSON.stringify([database.rows("brain_files", "ORDER BY id"), database.rows("brain_classification_reviews", "ORDER BY id")]);
  const before = snapshot();
  const admin = await decide(database, { id: u(910), org_id: ORG, role: "admin" }, u(11), "approve");
  assert.equal(admin.statusCode, 403, "only an owner decides");
  const otherCompany = await decide(database, OTHER_OWNER, u(11), "approve");
  assert.equal(otherCompany.statusCode, 404, "another company's owner cannot decide this review");
  const badId = await decide(database, OWNER, "nope", "approve");
  assert.equal(badId.statusCode, 400);
  const badWord = await decide(database, OWNER, u(11), "maybe");
  assert.equal(badWord.statusCode, 400);
  assert.equal(snapshot(), before, "nothing was written by any refused decision");

  assert.equal((await decide(database, OWNER, u(11), "approve")).statusCode, 200);
  const again = await decide(database, OWNER, u(11), "reject");
  assert.equal(again.statusCode, 409, "a second decision on the same review is refused");
  assert.equal(database.rows("brain_files", `WHERE id = '${u(1)}'`)[0].approval_status, "approved", "the first decision stands");
});
