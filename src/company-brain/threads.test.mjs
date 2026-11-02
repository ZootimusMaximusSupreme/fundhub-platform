import test from "node:test";
import assert from "node:assert/strict";

import {
  titleFromQuestion,
  listThreads,
  getThread,
  createThread,
  deleteThread,
  appendMessage
} from "./threads.mjs";

const ORG = "11111111-1111-4111-8111-111111111111";
const STAFF = "22222222-2222-4222-8222-222222222222";
const OTHER_STAFF = "33333333-3333-4333-8333-333333333333";
const THREAD = "44444444-4444-4444-8444-444444444444";

/* Fake db: records every statement, answers from a supplied function.
   The recording is the point — the scoping assertions read it back. */
function fakeDb(reply = () => ({ rows: [] })) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      return reply(sql, params) || { rows: [] };
    }
  };
}

test("titleFromQuestion takes the first 60 characters, trimmed", () => {
  assert.equal(titleFromQuestion("  Rate objections  "), "Rate objections");
  assert.equal(titleFromQuestion(""), "");
  assert.equal(titleFromQuestion(null), "");
  assert.equal(titleFromQuestion(undefined), "");

  const long = "a".repeat(200);
  assert.equal(titleFromQuestion(long).length, 60);

  // A cut that lands on a space must not leave a trailing one.
  const q = "x".repeat(59) + "   tail";
  assert.equal(titleFromQuestion(q), "x".repeat(59));
});

test("listThreads filters on org AND staff, newest first", async () => {
  const db = fakeDb(() => ({
    rows: [{
      id: THREAD,
      title: "Rate objections",
      created_at: "2026-08-17T00:00:00.000Z",
      updated_at: "2026-08-17T01:00:00.000Z",
      message_count: 6
    }]
  }));
  const out = await listThreads(db, { orgId: ORG, staffId: STAFF });

  assert.equal(out.ok, true);
  assert.equal(out.threads.length, 1);
  assert.deepEqual(out.threads[0], {
    id: THREAD,
    title: "Rate objections",
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T01:00:00.000Z",
    messageCount: 6
  });

  const { sql, params } = db.calls[0];
  assert.match(sql, /org_id = \$1/);
  assert.match(sql, /staff_id = \$2/);
  assert.match(sql, /ORDER BY t\.updated_at DESC/);
  assert.equal(params[0], ORG);
  assert.equal(params[1], STAFF);
});

test("listThreads caps the limit at 50 and refuses a half scope", async () => {
  const db = fakeDb();
  await listThreads(db, { orgId: ORG, staffId: STAFF, limit: 5000 });
  assert.equal(db.calls[0].params[2], 50);

  const noStaff = await listThreads(fakeDb(), { orgId: ORG });
  assert.equal(noStaff.ok, false);
  assert.deepEqual(noStaff.threads, []);

  const noOrg = await listThreads(fakeDb(), { staffId: STAFF });
  assert.equal(noOrg.ok, false);
});

test("getThread scopes the thread read to org AND staff", async () => {
  const db = fakeDb((sql) => {
    if (/FROM brain_threads/.test(sql)) {
      return {
        rows: [{
          id: THREAD,
          title: "Rate objections",
          created_at: "2026-08-17T00:00:00.000Z",
          updated_at: "2026-08-17T01:00:00.000Z"
        }]
      };
    }
    return {
      rows: [
        {
          id: "m1", role: "user", text: "What is our rate objection script?",
          sources: [], answer_source: null, thin: false,
          created_at: "2026-08-17T00:00:00.000Z"
        },
        {
          id: "m2", role: "assistant", text: "Ask what they compared it to [1]",
          sources: '[{"n":1,"fileName":"Closer Script v4.pdf"}]',
          answer_source: "model", thin: false,
          created_at: "2026-08-17T00:00:01.000Z"
        }
      ]
    };
  });

  const out = await getThread(db, { orgId: ORG, staffId: STAFF, threadId: THREAD });
  assert.equal(out.ok, true);
  assert.equal(out.thread.id, THREAD);
  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[0].answerSource, null);
  assert.deepEqual(out.messages[0].sources, []);
  // jsonb handed back as a string still becomes a real array.
  assert.equal(out.messages[1].sources[0].fileName, "Closer Script v4.pdf");
  assert.equal(out.messages[1].answerSource, "model");
  assert.equal(out.messages[1].thin, false);

  const threadSql = db.calls[0];
  assert.match(threadSql.sql, /id = \$1 AND org_id = \$2 AND staff_id = \$3/);
  assert.deepEqual(threadSql.params, [THREAD, ORG, STAFF]);
  assert.match(db.calls[1].sql, /ORDER BY created_at ASC/);
});

test("getThread returns not_found for another staff member's thread", async () => {
  // The row exists, but only for OTHER_STAFF — the scoped SELECT matches nothing.
  const db = fakeDb((sql, params) => {
    if (/FROM brain_threads/.test(sql) && params[2] === OTHER_STAFF) {
      return { rows: [{ id: THREAD, title: "Theirs", created_at: null, updated_at: null }] };
    }
    return { rows: [] };
  });

  const mine = await getThread(db, { orgId: ORG, staffId: STAFF, threadId: THREAD });
  assert.equal(mine.ok, false);
  assert.equal(mine.reason, "not_found");
  // No message read at all once the thread is not ours.
  assert.equal(db.calls.length, 1);

  const theirs = await getThread(db, { orgId: ORG, staffId: OTHER_STAFF, threadId: THREAD });
  assert.equal(theirs.ok, true);
});

test("deleteThread only removes a thread owned by this org and staff member", async () => {
  const db = fakeDb((sql, params) => {
    if (/DELETE FROM brain_threads/.test(sql) &&
        params[0] === THREAD && params[1] === ORG && params[2] === OTHER_STAFF) {
      return { rows: [{ id: THREAD }] };
    }
    return { rows: [] };
  });

  const mine = await deleteThread(db, { orgId: ORG, staffId: STAFF, threadId: THREAD });
  assert.deepEqual(mine, { ok: false, reason: "not_found" });

  const theirs = await deleteThread(db, { orgId: ORG, staffId: OTHER_STAFF, threadId: THREAD });
  assert.deepEqual(theirs, { ok: true });
  assert.equal(db.calls.length, 2);
  for (const call of db.calls) {
    assert.match(call.sql, /^DELETE FROM brain_threads/);
    assert.match(call.sql, /WHERE id = \$1 AND org_id = \$2 AND staff_id = \$3/);
    assert.deepEqual(call.params.slice(0, 2), [THREAD, ORG]);
  }
});

test("deleteThread refuses an incomplete scope without querying", async () => {
  const db = fakeDb();
  assert.deepEqual(await deleteThread(db, { orgId: ORG, threadId: THREAD }), {
    ok: false, reason: "org_staff_and_thread_required"
  });
  assert.deepEqual(await deleteThread(db, { staffId: STAFF, threadId: THREAD }), {
    ok: false, reason: "org_staff_and_thread_required"
  });
  assert.equal(db.calls.length, 0);
});

test("getThread refuses an incomplete scope", async () => {
  const db = fakeDb();
  const out = await getThread(db, { orgId: ORG, threadId: THREAD });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "org_staff_and_thread_required");
  assert.equal(db.calls.length, 0);
});

test("createThread stores the owner and truncates the title", async () => {
  const db = fakeDb((_sql, params) => ({
    rows: [{
      id: THREAD,
      title: params[2],
      created_at: "2026-08-17T00:00:00.000Z",
      updated_at: "2026-08-17T00:00:00.000Z"
    }]
  }));
  const out = await createThread(db, { orgId: ORG, staffId: STAFF, title: "b".repeat(200) });
  assert.equal(out.ok, true);
  assert.equal(out.thread.title.length, 60);
  assert.deepEqual(db.calls[0].params.slice(0, 2), [ORG, STAFF]);
  assert.match(db.calls[0].sql, /INSERT INTO brain_threads/);

  const bad = await createThread(fakeDb(), { orgId: ORG });
  assert.equal(bad.ok, false);
  assert.equal(bad.reason, "org_and_staff_required");
});

test("appendMessage writes the turn and bumps the thread", async () => {
  const db = fakeDb((sql, params) => {
    if (/INSERT INTO brain_messages/.test(sql)) {
      return {
        rows: [{
          id: "m9", role: params[2], text: params[3], sources: params[4],
          answer_source: params[5], thin: params[6],
          created_at: "2026-08-17T00:00:02.000Z"
        }]
      };
    }
    return { rows: [] };
  });

  const out = await appendMessage(db, {
    orgId: ORG,
    threadId: THREAD,
    role: "assistant",
    text: "Ask what they compared it to [1]",
    sources: [{ n: 1, fileName: "Closer Script v4.pdf" }],
    answerSource: "model",
    thin: true
  });

  assert.equal(out.ok, true);
  assert.equal(out.message.role, "assistant");
  assert.equal(out.message.thin, true);
  assert.equal(out.message.sources[0].n, 1);
  assert.equal(db.calls[0].params[0], ORG);
  assert.match(db.calls[1].sql, /UPDATE brain_threads SET updated_at/);
  assert.deepEqual(db.calls[1].params, [THREAD, ORG]);
});

test("appendMessage rejects a role that is not user or assistant", async () => {
  const db = fakeDb();
  const out = await appendMessage(db, {
    orgId: ORG, threadId: THREAD, role: "system", text: "hi"
  });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "invalid_role");
  assert.equal(db.calls.length, 0);

  const noThread = await appendMessage(db, { orgId: ORG, role: "user", text: "hi" });
  assert.equal(noThread.ok, false);
  assert.equal(noThread.reason, "org_and_thread_required");
});

test("every read query names both org_id and staff_id", async () => {
  const db = fakeDb((sql) => (
    /FROM brain_threads/.test(sql)
      ? { rows: [{ id: THREAD, title: "t", created_at: null, updated_at: null }] }
      : { rows: [] }
  ));
  await listThreads(db, { orgId: ORG, staffId: STAFF });
  await getThread(db, { orgId: ORG, staffId: STAFF, threadId: THREAD });

  const threadReads = db.calls.filter((c) => /SELECT[\s\S]*FROM brain_threads/.test(c.sql));
  assert.equal(threadReads.length, 2);
  for (const call of threadReads) {
    assert.match(call.sql, /org_id = \$/);
    assert.match(call.sql, /staff_id = \$/);
    assert.ok(call.params.includes(ORG));
    assert.ok(call.params.includes(STAFF));
  }
});
