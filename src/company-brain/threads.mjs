// Company Brain chat history — threads and their messages.
//
// Board: ops/workflows/company-brain-chat-2026-08-17.md §3.3 (W4).
// Tables: db/migrations/175_company_brain_threads.sql.
//
// THE ONE RULE. A thread belongs to one org AND one staff member. Every read
// here filters on BOTH org_id and staff_id, so there is no argument shape that
// hands a staff member somebody else's conversation. Callers pass the org and
// the staff id off the SESSION — never off a request body.
//
// Row keys come back camelCased in the §3.3 shape so a handler can return them
// straight through without a second mapping layer.

const ROLES = new Set(["user", "assistant"]);

/** Title for a new thread: the first 60 characters of the question. */
export function titleFromQuestion(question) {
  return String(question || "").trim().slice(0, 60).trim();
}

/* jsonb comes back parsed from node-postgres, but a fake db in a test (and an
   older row written as text) can hand back a string. Never throw over a title
   bar's worth of citations — an unreadable value becomes an empty list. */
function parseSources(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapThread(row) {
  return {
    id: row.id,
    title: row.title || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    role: row.role,
    text: row.text || "",
    sources: parseSources(row.sources),
    answerSource: row.answer_source ?? null,
    thin: !!row.thin,
    createdAt: row.created_at
  };
}

/**
 * Newest-first list of a staff member's own threads, with a message count.
 * @returns {{ok: true, threads: Array}|{ok: false, reason: string, threads: []}}
 */
export async function listThreads(db, { orgId, staffId, limit = 50 } = {}) {
  if (!orgId || !staffId) {
    return { ok: false, reason: "org_and_staff_required", threads: [] };
  }
  const lim = Math.max(1, Math.min(50, Number(limit) || 50));
  const res = await db.query(
    `SELECT t.id, t.title, t.created_at, t.updated_at,
            (SELECT count(*) FROM brain_messages m WHERE m.thread_id = t.id)::int
              AS message_count
       FROM brain_threads t
      WHERE t.org_id = $1 AND t.staff_id = $2
      ORDER BY t.updated_at DESC
      LIMIT $3`,
    [orgId, staffId, lim]
  );
  const threads = (res.rows || []).map((row) => ({
    ...mapThread(row),
    messageCount: Number(row.message_count) || 0
  }));
  return { ok: true, threads };
}

/**
 * One thread and its transcript, oldest message first.
 * Not this staff member's thread → `not_found`. The same answer a thread that
 * never existed gets, on purpose: nothing here confirms someone else's thread.
 * @returns {{ok: true, thread: object, messages: Array}|{ok: false, reason: string}}
 */
export async function getThread(db, { orgId, staffId, threadId } = {}) {
  if (!orgId || !staffId || !threadId) {
    return { ok: false, reason: "org_staff_and_thread_required" };
  }
  const found = await db.query(
    `SELECT id, title, created_at, updated_at
       FROM brain_threads
      WHERE id = $1 AND org_id = $2 AND staff_id = $3`,
    [threadId, orgId, staffId]
  );
  const row = (found.rows || [])[0];
  if (!row) return { ok: false, reason: "not_found" };

  const msgs = await db.query(
    `SELECT id, role, text, sources, answer_source, thin, created_at
       FROM brain_messages
      WHERE thread_id = $1 AND org_id = $2
      ORDER BY created_at ASC, id ASC`,
    [threadId, orgId]
  );
  return {
    ok: true,
    thread: mapThread(row),
    messages: (msgs.rows || []).map(mapMessage)
  };
}

export async function deleteThread(db, { orgId, staffId, threadId } = {}) {
  if (!orgId || !staffId || !threadId) {
    return { ok: false, reason: "org_staff_and_thread_required" };
  }
  const res = await db.query(
    `DELETE FROM brain_threads
      WHERE id = $1 AND org_id = $2 AND staff_id = $3
      RETURNING id`,
    [threadId, orgId, staffId]
  );
  if (!(res.rows || [])[0]) return { ok: false, reason: "not_found" };
  return { ok: true };
}

/**
 * Start a conversation. Title may be empty — §3.3 says it fills in from the
 * first question, which the ask endpoint does by passing titleFromQuestion().
 * @returns {{ok: true, thread: object}|{ok: false, reason: string}}
 */
export async function createThread(db, { orgId, staffId, title = "" } = {}) {
  if (!orgId || !staffId) {
    return { ok: false, reason: "org_and_staff_required" };
  }
  const res = await db.query(
    `INSERT INTO brain_threads (org_id, staff_id, title)
     VALUES ($1, $2, $3)
     RETURNING id, title, created_at, updated_at`,
    [orgId, staffId, String(title || "").slice(0, 60)]
  );
  const row = (res.rows || [])[0];
  if (!row) return { ok: false, reason: "insert_failed" };
  return { ok: true, thread: mapThread(row) };
}

/**
 * Write one turn and bump the thread so the list stays in recency order.
 *
 * No staffId argument by design: ownership is proved BEFORE this is called,
 * either by createThread (which sets the owner) or by getThread (which filters
 * on it). org_id still scopes the write.
 * @returns {{ok: true, message: object}|{ok: false, reason: string}}
 */
export async function appendMessage(db, {
  orgId,
  threadId,
  role,
  text = "",
  sources = [],
  answerSource = null,
  thin = false
} = {}) {
  if (!orgId || !threadId) return { ok: false, reason: "org_and_thread_required" };
  if (!ROLES.has(String(role))) return { ok: false, reason: "invalid_role" };

  const res = await db.query(
    `INSERT INTO brain_messages
       (org_id, thread_id, role, text, sources, answer_source, thin)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
     RETURNING id, role, text, sources, answer_source, thin, created_at`,
    [
      orgId,
      threadId,
      String(role),
      String(text || ""),
      JSON.stringify(Array.isArray(sources) ? sources : []),
      answerSource ? String(answerSource) : null,
      !!thin
    ]
  );
  const row = (res.rows || [])[0];
  if (!row) return { ok: false, reason: "insert_failed" };

  await db.query(
    `UPDATE brain_threads SET updated_at = now()
      WHERE id = $1 AND org_id = $2`,
    [threadId, orgId]
  );
  return { ok: true, message: mapMessage(row) };
}
