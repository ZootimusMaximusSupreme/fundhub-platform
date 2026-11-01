// /api/company-brain/threads — Company Brain chat history.
//
// GET                    — this staff member's own threads, newest first, 50 max
// GET ?thread_id=<uuid>  — one thread and its messages, oldest first
// POST { title }         — start a thread
// DELETE ?thread_id=<uuid> — delete this staff member's own thread
//
// Board: ops/workflows/company-brain-chat-2026-08-17.md §3.3 (W4).
//
// Auth is the same four gates as api/read/company-brain.mjs, in the same order.
// Role and staff id come from the SESSION, never from the request. A thread is
// scoped to one org AND one staff member, so someone else's thread reads as
// 404 — the same answer a thread that never existed gets.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, isUuid, requireRole } from "../../src/http/read-api.mjs";
import { canQueryBrain } from "../../src/company-brain/access.mjs";
import {
  listThreads,
  getThread,
  createThread,
  deleteThread,
  titleFromQuestion
} from "../../src/company-brain/threads.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;

  const staff = deps.requireAuth
    ? await deps.requireAuth(req, res, { db: database })
    : await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  // External roles never reach Company Brain history.
  if (!canQueryBrain(staff.role)) {
    return res.status(403).json({ ok: false, error: "forbidden_role" });
  }

  /* Both halves of the scope have to be present. Without a staff id there is
     no "own threads" to read, and guessing one is exactly the mistake this
     endpoint exists not to make — so it is refused, not defaulted. */
  if (!staff.org_id || !staff.id) {
    return res.status(403).json({ ok: false, error: "no_org_scope" });
  }
  const scope = { orgId: staff.org_id, staffId: staff.id };

  if (req.method === "GET") {
    const raw = String((req.query && req.query.thread_id) || "").trim();

    if (raw) {
      if (!isUuid(raw)) {
        return res.status(400).json({ ok: false, error: "invalid_thread_id" });
      }
      const load = deps.getThread || getThread;
      const out = await load(database, { ...scope, threadId: raw });
      if (!out.ok) {
        return res.status(404).json({ ok: false, error: "thread_not_found" });
      }
      return res.status(200).json({
        ok: true,
        thread: out.thread,
        messages: out.messages || []
      });
    }

    const list = deps.listThreads || listThreads;
    const out = await list(database, { ...scope, limit: 50 });
    return res.status(200).json({ ok: true, threads: out.threads || [] });
  }

  if (req.method === "POST") {
    const title = titleFromQuestion((req.body && req.body.title) || "");
    const create = deps.createThread || createThread;
    const out = await create(database, { ...scope, title });
    if (!out.ok) {
      return res.status(400).json({ ok: false, error: out.reason || "create_failed" });
    }
    return res.status(200).json({ ok: true, thread: out.thread });
  }

  if (req.method === "DELETE") {
    const raw = String((req.query && req.query.thread_id) || "").trim();
    if (!isUuid(raw)) {
      return res.status(400).json({ ok: false, error: "invalid_thread_id" });
    }
    const remove = deps.deleteThread || deleteThread;
    const out = await remove(database, { ...scope, threadId: raw });
    if (!out.ok) {
      return res.status(404).json({ ok: false, error: "thread_not_found" });
    }
    return res.status(200).json({ ok: true });
  }

  res.setHeader("allow", "GET, POST, DELETE");
  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
