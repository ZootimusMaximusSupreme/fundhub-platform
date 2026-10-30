import test from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/company-brain/threads.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const OTHER_STAFF = "33333333-3333-4333-8333-333333333333";
const THREAD = "44444444-4444-4444-8444-444444444444";

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

const session = (over = {}) => async () => ({
  id: STAFF, org_id: ORG, role: "closer", ...over
});

/* A stand-in database, so these cases exercise the real src/company-brain
   scoping SQL rather than a stubbed data layer. Rows are only ever returned to
   the staff member who owns them. */
function fakeDb(rows = { threads: [], messages: [] }) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (/SELECT[\s\S]*FROM brain_threads t/.test(sql)) {
        const [orgId, staffId] = params;
        return {
          rows: rows.threads
            .filter((t) => t.org_id === orgId && t.staff_id === staffId)
            .map((t) => ({ ...t, message_count: 2 }))
        };
      }
      if (/SELECT[\s\S]*FROM brain_threads/.test(sql)) {
        const [id, orgId, staffId] = params;
        return {
          rows: rows.threads.filter(
            (t) => t.id === id && t.org_id === orgId && t.staff_id === staffId
          )
        };
      }
      if (/DELETE FROM brain_threads/.test(sql)) {
        const [id, orgId, staffId] = params;
        const index = rows.threads.findIndex(
          (t) => t.id === id && t.org_id === orgId && t.staff_id === staffId
        );
        if (index < 0) return { rows: [] };
        const [removed] = rows.threads.splice(index, 1);
        rows.messages = rows.messages.filter((m) => m.thread_id !== id);
        return { rows: [{ id: removed.id }] };
      }
      if (/FROM brain_messages/.test(sql)) {
        const [threadId] = params;
        return { rows: rows.messages.filter((m) => m.thread_id === threadId) };
      }
      if (/INSERT INTO brain_threads/.test(sql)) {
        const [org_id, staff_id, title] = params;
        const row = {
          id: THREAD, org_id, staff_id, title,
          created_at: "2026-08-17T00:00:00.000Z",
          updated_at: "2026-08-17T00:00:00.000Z"
        };
        rows.threads.push(row);
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
}

const ownedThread = {
  id: THREAD,
  org_id: ORG,
  staff_id: STAFF,
  title: "Rate objections",
  created_at: "2026-08-17T00:00:00.000Z",
  updated_at: "2026-08-17T01:00:00.000Z"
};

test("GET threads lists only this staff member's own conversations", async () => {
  const res = mockRes();
  const db = fakeDb({
    threads: [
      ownedThread,
      { ...ownedThread, id: "99999999-9999-4999-8999-999999999999", staff_id: OTHER_STAFF }
    ],
    messages: []
  });
  await handler({ method: "GET", query: {} }, res, { requireAuth: session(), db });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.threads.length, 1);
  assert.deepEqual(res.body.threads[0], {
    id: THREAD,
    title: "Rate objections",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T01:00:00.000Z",
    messageCount: 2
  });
});

test("GET threads with no history returns an empty list, not sample data", async () => {
  const res = mockRes();
  await handler(
    { method: "GET", query: {} },
    res,
    { requireAuth: session(), db: fakeDb() }
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.threads, []);
});

test("GET ?thread_id returns the thread and its messages oldest first", async () => {
  const res = mockRes();
  const db = fakeDb({
    threads: [ownedThread],
    messages: [
      {
        id: "m1", thread_id: THREAD, role: "user", text: "rate objection script?",
        sources: [], answer_source: null, thin: false,
        created_at: "2026-08-17T00:00:00.000Z"
      },
      {
        id: "m2", thread_id: THREAD, role: "assistant", text: "Ask what they compared it to [1]",
        sources: [{ n: 1, fileName: "Closer Script v4.pdf" }],
        answer_source: "model", thin: false,
        created_at: "2026-08-17T00:00:01.000Z"
      }
    ]
  });
  await handler({ method: "GET", query: { thread_id: THREAD } }, res, {
    requireAuth: session(), db
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.thread.title, "Rate objections");
  assert.equal(res.body.messages.length, 2);
  assert.equal(res.body.messages[0].role, "user");
  assert.equal(res.body.messages[1].answerSource, "model");
  assert.equal(res.body.messages[1].sources[0].fileName, "Closer Script v4.pdf");
});

test("GET ?thread_id rejects a malformed id with 400", async () => {
  const res = mockRes();
  const db = fakeDb();
  await handler({ method: "GET", query: { thread_id: "not-a-uuid" } }, res, {
    requireAuth: session(), db
  });

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_thread_id");
  assert.equal(db.calls.length, 0); // never reaches the database
});

test("GET ?thread_id of another staff member's thread is 404", async () => {
  const res = mockRes();
  const db = fakeDb({
    threads: [{ ...ownedThread, staff_id: OTHER_STAFF }],
    messages: [{
      id: "m1", thread_id: THREAD, role: "user", text: "secret",
      sources: [], answer_source: null, thin: false, created_at: null
    }]
  });
  await handler({ method: "GET", query: { thread_id: THREAD } }, res, {
    requireAuth: session(), db
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "thread_not_found");
  assert.equal(res.body.thread, undefined);
  assert.equal(res.body.messages, undefined);
  // Their messages were never read.
  assert.equal(db.calls.filter((c) => /FROM brain_messages/.test(c.sql)).length, 0);
});

test("DELETE removes only the signed-in staff member's chat and its messages", async () => {
  const otherId = "99999999-9999-4999-8999-999999999999";
  const rows = {
    threads: [ownedThread, { ...ownedThread, id: otherId, staff_id: OTHER_STAFF }],
    messages: [
      { id: "m1", thread_id: THREAD },
      { id: "m2", thread_id: otherId }
    ]
  };
  const db = fakeDb(rows);
  const res = mockRes();
  await handler({ method: "DELETE", query: { thread_id: THREAD } }, res, {
    requireAuth: session(), db
  });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.deepEqual(rows.threads.map((t) => t.id), [otherId]);
  assert.deepEqual(rows.messages.map((m) => m.id), ["m2"]);
  assert.deepEqual(db.calls[0].params, [THREAD, ORG, STAFF]);
});

test("DELETE returns 404 for another staff member's chat", async () => {
  const rows = { threads: [{ ...ownedThread, staff_id: OTHER_STAFF }], messages: [] };
  const res = mockRes();
  await handler({ method: "DELETE", query: { thread_id: THREAD } }, res, {
    requireAuth: session(), db: fakeDb(rows)
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "thread_not_found");
  assert.equal(rows.threads.length, 1);
});

test("DELETE rejects a missing or malformed thread id", async () => {
  const db = fakeDb();
  for (const query of [{}, { thread_id: "bad-id" }]) {
    const res = mockRes();
    await handler({ method: "DELETE", query }, res, { requireAuth: session(), db });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_thread_id");
  }
  assert.equal(db.calls.length, 0);
});

test("POST creates a thread owned by the session", async () => {
  const res = mockRes();
  const db = fakeDb();
  await handler({ method: "POST", body: { title: "Rate objections" } }, res, {
    requireAuth: session(), db
  });

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.thread.id, THREAD);
  assert.equal(res.body.thread.title, "Rate objections");

  const insert = db.calls.find((c) => /INSERT INTO brain_threads/.test(c.sql));
  assert.deepEqual(insert.params.slice(0, 2), [ORG, STAFF]);
});

test("POST with no title creates an untitled thread", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: {} }, res, {
    requireAuth: session(), db: fakeDb()
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.thread.title, "");
});

test("POST title is capped at 60 characters", async () => {
  const res = mockRes();
  await handler({ method: "POST", body: { title: "z".repeat(500) } }, res, {
    requireAuth: session(), db: fakeDb()
  });
  assert.equal(res.body.thread.title.length, 60);
});

test("a non-staff role is refused", async () => {
  const res = mockRes();
  const db = fakeDb();
  await handler({ method: "GET", query: {} }, res, {
    requireAuth: session({ role: "affiliate" }), db
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.ok, false);
  assert.equal(db.calls.length, 0);
});

test("a session with no org is refused", async () => {
  const res = mockRes();
  await handler({ method: "GET", query: {} }, res, {
    requireAuth: session({ org_id: null }), db: fakeDb()
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
});

test("a session with no staff id is refused", async () => {
  const res = mockRes();
  await handler({ method: "GET", query: {} }, res, {
    requireAuth: session({ id: null }), db: fakeDb()
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "no_org_scope");
});

test("an unsupported method is 405", async () => {
  const res = mockRes();
  await handler({ method: "PUT" }, res, {
    requireAuth: session(), db: fakeDb()
  });

  assert.equal(res.statusCode, 405);
  assert.equal(res.body.error, "method_not_allowed");
  assert.equal(res.headers.allow, "GET, POST, DELETE");
});
