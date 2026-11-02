import test from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/read/company-brain.mjs";
import reviewsHandler from "../../api/company-brain/reviews.mjs";
import affiliateHandler from "../../api/read/company-brain-affiliate.mjs";
import { synthesizeAnswer } from "../company-brain/answer.mjs";

function mockRes() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
}

test("synthesizeAnswer extractive fallback when no API key", async () => {
  const out = await synthesizeAnswer({
    query: "objection script",
    chunks: [{
      fileName: "Closer script.docx",
      content: "When they say the rate is high, ask what they compared it to.",
      webViewLink: "https://drive.google.com/file/d/x",
      accessTier: "sales"
    }],
    env: {}
  });
  assert.equal(out.ok, true);
  assert.equal(out.source, "extractive");
  assert.match(out.text, /Closer script/);
  assert.equal(out.citations.length, 1);
});

test("POST /api/read/company-brain uses session role not body role", async () => {
  let seenRole = null;
  const res = mockRes();
  await handler(
    { method: "POST", body: { question: "scripts", role: "owner" } },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "closer" }),
      retrieveChunks: async (_db, args) => {
        seenRole = args.role;
        return {
          ok: true,
          chunks: [{
            fileName: "SOP.md",
            content: "Do the thing",
            accessTier: "staff",
            webViewLink: null
          }]
        };
      },
      synthesizeAnswer: async ({ chunks }) => ({
        ok: true,
        text: "Do the thing [1]",
        thin: false,
        source: "test",
        citations: [{ n: 1, fileName: chunks[0].fileName }]
      }),
      env: {}
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(seenRole, "closer");
  assert.equal(res.body.ok, true);
  assert.equal(res.body.role, "closer");
  assert.match(res.body.answer.text, /Do the thing/);
});

test("POST /api/read/company-brain rejects empty question", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: {} },
    res,
    { requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "owner" }) }
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "question_required");
});

test("reviews GET is owner-only", async () => {
  const denied = mockRes();
  await reviewsHandler(
    { method: "GET" },
    denied,
    { requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "admin" }) }
  );
  assert.equal(denied.statusCode, 403);

  const ok = mockRes();
  await reviewsHandler(
    { method: "GET" },
    ok,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "owner" }),
      listPendingReviews: async () => ({ ok: true, reviews: [{ id: "r1" }] })
    }
  );
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.reviews.length, 1);
  assert.equal(ok.body.pendingCount, 1);
});

test("reviews GET passes paging through and returns the full pending count", async () => {
  const res = mockRes();
  let paging;
  await reviewsHandler({ method: "GET", query: { limit: "25", offset: "25" } }, res, {
    requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "owner" }),
    listPendingReviews: async (_db, options) => {
      paging = options;
      return { ok: true, reviews: [{ id: "r26" }], pendingCount: 57 };
    }
  });
  assert.deepEqual(paging, { orgId: "org-1", limit: 25, offset: 25 });
  assert.equal(res.body.pendingCount, 57);
  assert.equal(res.body.reviews.length, 1);
});

test("reviews POST approve requires owner", async () => {
  const res = mockRes();
  await reviewsHandler(
    { method: "POST", body: { review_id: "550e8400-e29b-41d4-a716-446655440000", decision: "approve" } },
    res,
    {
      requireAuth: async () => ({ id: "s1", org_id: "org-1", role: "closer" })
    }
  );
  assert.equal(res.statusCode, 403);
});

test("affiliate endpoint refuses staff roles", async () => {
  const res = mockRes();
  await affiliateHandler(
    { method: "POST", body: { question: "kit" } },
    res,
    { requirePrincipal: async () => ({ kind: "staff", orgId: "org-1", role: "closer" }) }
  );
  assert.equal(res.statusCode, 403);
});

test("affiliate endpoint uses allowlist retrieve and rejects non-affiliate chunks", async () => {
  const res = mockRes();
  await affiliateHandler(
    { method: "POST", body: { question: "partner kit" } },
    res,
    {
      requirePrincipal: async () => ({ kind: "affiliate", orgId: "org-1", role: "affiliate" }),
      retrieveAffiliateChunks: async (_db, args) => {
        assert.equal(args.role, "affiliate");
        return {
          ok: true,
          chunks: [{
            fileName: "kit.doc",
            content: "Welcome partner",
            accessTier: "affiliate",
            webViewLink: null
          }]
        };
      },
      synthesizeAnswer: async () => ({
        ok: true, text: "Welcome [1]", thin: false, source: "test",
        citations: [{ n: 1, fileName: "kit.doc" }]
      })
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.scope, "affiliate_allowlist");
});

test("affiliate endpoint fails closed if a non-affiliate chunk is returned", async () => {
  const res = mockRes();
  await affiliateHandler(
    { method: "POST", body: { question: "secret" } },
    res,
    {
      requirePrincipal: async () => ({ kind: "partner", orgId: "org-1", role: "partner" }),
      retrieveAffiliateChunks: async () => ({
        ok: true,
        chunks: [{ fileName: "cap-table.pdf", content: "secret", accessTier: "owner" }]
      })
    }
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, "affiliate_tier_violation");
});

test("staff company-brain endpoint refuses affiliate role via ROLE_SETS.STAFF", async () => {
  const res = mockRes();
  await handler(
    { method: "POST", body: { question: "scripts" } },
    res,
    { requireAuth: async () => ({ id: "a1", org_id: "org-1", role: "affiliate" }) }
  );
  assert.equal(res.statusCode, 403);
});

/* Board §3.4 — the ask endpoint now writes the turn to chat history.
   These cases are additions; nothing above them changed. */

const HIST_ORG = "11111111-1111-4111-8111-111111111111";
const HIST_STAFF = "22222222-2222-4222-8222-222222222222";
const HIST_THREAD = "44444444-4444-4444-8444-444444444444";

function askDeps(over = {}) {
  const written = [];
  const created = [];
  return {
    written,
    created,
    deps: {
      requireAuth: async () => ({ id: HIST_STAFF, org_id: HIST_ORG, role: "closer" }),
      db: { query: async () => ({ rows: [] }) },
      retrieveChunks: async () => ({
        ok: true,
        chunks: [{
          fileName: "Closer Script v4.pdf",
          content: "Ask what they compared it to",
          accessTier: "sales",
          webViewLink: null
        }]
      }),
      synthesizeAnswer: async () => ({
        ok: true,
        text: "Ask what they compared it to [1]",
        thin: false,
        source: "model",
        citations: [{ n: 1, fileName: "Closer Script v4.pdf" }]
      }),
      createThread: async (_db, args) => {
        created.push(args);
        return { ok: true, thread: { id: HIST_THREAD, title: args.title } };
      },
      getThread: async (_db, args) => (
        args.threadId === HIST_THREAD && args.staffId === HIST_STAFF
          ? { ok: true, thread: { id: HIST_THREAD, title: "Rate objections" }, messages: [] }
          : { ok: false, reason: "not_found" }
      ),
      appendMessage: async (_db, args) => {
        written.push(args);
        return { ok: true, message: { id: "m" + written.length } };
      },
      env: {},
      ...over
    }
  };
}

test("§3.4 ask with no thread_id opens a thread and keeps every existing key", async () => {
  const res = mockRes();
  const { deps, written, created } = askDeps();
  await handler(
    { method: "POST", body: { question: "What is our rate objection script?" } },
    res,
    deps
  );

  assert.equal(res.statusCode, 200);
  // Every key the screens already read is still exactly where it was.
  assert.equal(res.body.ok, true);
  assert.equal(res.body.question, "What is our rate objection script?");
  assert.equal(res.body.answer.text, "Ask what they compared it to [1]");
  assert.equal(res.body.answer.thin, false);
  assert.equal(res.body.answer.source, "model");
  assert.equal(res.body.sources.length, 1);
  assert.equal(res.body.role, "closer");
  // Plus the new one.
  assert.equal(res.body.thread_id, HIST_THREAD);
  assert.equal(res.body.history_saved, undefined);

  assert.equal(created.length, 1);
  assert.equal(created[0].title, "What is our rate objection script?");
  assert.equal(created[0].staffId, HIST_STAFF);

  assert.equal(written.length, 2);
  assert.equal(written[0].role, "user");
  assert.equal(written[0].text, "What is our rate objection script?");
  assert.equal(written[1].role, "assistant");
  assert.equal(written[1].answerSource, "model");
  assert.equal(written[1].sources[0].fileName, "Closer Script v4.pdf");
});

test("§3.4 ask with a thread_id appends to that thread instead of opening one", async () => {
  const res = mockRes();
  const { deps, written, created } = askDeps();
  await handler(
    { method: "POST", body: { question: "and the follow up?", thread_id: HIST_THREAD } },
    res,
    deps
  );

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.thread_id, HIST_THREAD);
  assert.equal(created.length, 0);
  assert.equal(written.length, 2);
  assert.ok(written.every((w) => w.threadId === HIST_THREAD));
});

test("§3.4 ask never writes into a thread the session does not own", async () => {
  const res = mockRes();
  const { deps, written, created } = askDeps();
  const theirs = "99999999-9999-4999-8999-999999999999";
  await handler(
    { method: "POST", body: { question: "show me theirs", thread_id: theirs } },
    res,
    deps
  );

  assert.equal(res.statusCode, 200);
  // A fresh thread of our own, never theirs.
  assert.equal(created.length, 1);
  assert.equal(res.body.thread_id, HIST_THREAD);
  assert.ok(written.every((w) => w.threadId !== theirs));
});

test("§3.4 a failed history write still returns the answer", async () => {
  const res = mockRes();
  const { deps } = askDeps({
    createThread: async () => { throw new Error("brain_threads is missing"); }
  });
  await handler({ method: "POST", body: { question: "still answer me" } }, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.answer.text, "Ask what they compared it to [1]");
  assert.equal(res.body.history_saved, false);
  assert.equal(res.body.thread_id, null);
});

test("§3.4 a failed message write keeps the answer and the thread id", async () => {
  const res = mockRes();
  const { deps } = askDeps({
    appendMessage: async () => ({ ok: false, reason: "insert_failed" })
  });
  await handler({ method: "POST", body: { question: "half saved" } }, res, deps);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.answer.text, "Ask what they compared it to [1]");
  assert.equal(res.body.thread_id, HIST_THREAD);
  assert.equal(res.body.history_saved, false);
});
