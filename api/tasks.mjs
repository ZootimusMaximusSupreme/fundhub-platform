// /api/tasks — the work queue the workflows have been writing into.
//
//   GET   ?done=false (default) | true | all
//         ?client_id=<uuid>  ?q=<title search>  ?limit=<n, cap 200>
//         ?role=<employee role> | mine  — whose queue to read
//         ?mine=1                       — shorthand for role=mine
//         ?unclaimed=1                  — role queue only, nobody has picked it up
//         → { ok, tasks: [{ id, client_id, client_name, title, body, due_at,
//                           source_workflow, assignee_role, assignee_staff_id,
//                           assignee_name, meeting_url, detail, done, created_at }] }
//         detail is a readable note (tasks.detail, migration 472) — for the Blueprint
//         closing prep call and closer alert it is the document vault line. Null on most.
//   PATCH { id, done } | { id, claim: true } | { id, assignee_staff_id }
//
// Auth: any staff session.
//
// ?role= and ?mine= are FILTERS, not permissions: any staff session can read any
// role's queue, which is deliberate — covering someone else's work requires
// seeing it. The gate that matters is requireAuth. `mine` resolves to the
// caller's own staff id, never to a value from the query string, so it cannot be
// pointed at another person.
//
// ?role=mine is accepted as well as ?mine=1 because the screens ask both ways.
//
// *** THE PATCH BRANCH REQUIRES AN OPEN SHIFT. THE GET BRANCH DOES NOT. ***
//
// The rule this implements, verbatim from the owner: "Gate writes that affect
// attribution or pay: claiming a lead, logging a call outcome, moving a pipeline
// stage, sending client messages. Do not gate read-only screens." The owner then
// confirmed specifically that `PATCH { id, claim: true }` here is what "claiming
// a lead" meant in this codebase.
//
// THE WHOLE PATCH BRANCH IS GATED, NOT ONLY THE claim PATH. Reasoning, because
// this is the one judgement call in the change:
//
//   claim              writes assignee_staff_id = the caller. Named by the owner.
//   assignee_staff_id  writes the same column for somebody else. Reassignment is
//                      assignment; it is the same attribution write aimed at a
//                      different person, and exempting it would leave the column
//                      writable off the clock by the longer route.
//   done               writes no attribution column — `tasks` records no
//                      completed_by — so on the letter of the rule it is the weak
//                      one. It is gated anyway for two reasons. First, per-staff
//                      work IS counted off this pair: api/read/staff.mjs's
//                      `open_tasks` is count(*) WHERE assignee_staff_id = s.id
//                      AND done = false, so closing a task off the clock moves a
//                      named person's work number with no shift to attribute it
//                      to. Second, a gate placed in two of three code paths
//                      inside one method branch is a gate the fourth action
//                      written next month will not have, and nothing will fail
//                      when it does not — which is the exact drift
//                      requireActiveShift.mjs exists as one file to prevent.
//
// This is the same call made on api/inquiries.mjs POST, and it is made on
// weaker evidence here: there, every action in the branch wrote worked_by. Here
// `done` does not. Flagged in ops/workflows/comp-and-shift-gate.md so the owner
// can narrow it to claim + reassign in one line if that reading is wrong.
//
// GET is untouched. It is the queue screen — read-only, and the rule ends "do
// not gate read-only screens."

import { db } from "../src/db.mjs";
import { requirePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { requireActiveShift } from "../src/http/middleware/requireActiveShift.mjs";
import { SUPER_ROLES } from "../src/http/middleware/requireRole.mjs";
import { TASK_ROLES } from "../src/lib/create-task.mjs";
import { isUuid, CLIENT_DATA_ERRORS, boundedLimit } from "../src/http/read-api.mjs";
import { safeError } from "../src/http/health.mjs";

export default async function handler(req, res) {
  // STAFF ONLY, named explicitly. A client or affiliate session reaching the
  // internal work queue would be a real leak, and requirePrincipal denies any
  // kind an endpoint does not list.
  const principal = await requirePrincipal(req, res, ["staff"], { db });
  if (!principal) return;
  // requirePrincipal returns staffId; the queries below key ?mine=1 and claim on
  // it, and reading principal.id would silently be undefined.
  // orgId stays on the principal — every task query must bind the caller's org.
  const staff = { id: principal.staffId, role: principal.role };
  const orgId = principal.orgId;
  if (!orgId || !isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "no_org_on_session" });
  }

  if (req.method === "GET") {
    const q = req.query || {};
    const limit = boundedLimit(q.limit, { fallback: 100, cap: 200 });
    const where = [];
    const params = [];
    const add = (sql, val) => { params.push(val); where.push(sql.replace("?", `$${params.length}`)); };

    // Always scope to the session org. Without this, ?client_id=<foreign uuid>
    // and unfiltered queue reads leaked other companies' work.
    add("t.org_id = ?", orgId);

    const done = (q.done ?? "false").toLowerCase();
    if (done === "false") where.push("t.done = false");
    else if (done === "true") where.push("t.done = true");
    if (q.client_id) {
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "invalid_client_id" });
      }
      add("t.client_id = ?", q.client_id);
    }
    if (q.q) add("t.title ILIKE ?", `%${q.q}%`);

    // Whose queue. `mine` is resolved from the authenticated session, so it can
    // never be aimed at another staff member by editing the URL.
    const roleParam = String(q.role ?? "").trim().toLowerCase();
    const mine = q.mine === "1" || q.mine === "true" || roleParam === "mine";
    if (mine) {
      add("t.assignee_staff_id = ?", staff.id);
    } else if (roleParam) {
      if (!TASK_ROLES.has(roleParam)) {
        return res.status(400).json({
          ok: false, error: "unknown_role",
          message: `role must be one of ${[...TASK_ROLES].join(", ")}, or "mine"`
        });
      }
      add("t.assignee_role = ?", roleParam);
    }

    // Unclaimed work in a role queue — what a person picks from.
    if (q.unclaimed === "1" || q.unclaimed === "true") {
      where.push("t.assignee_staff_id IS NULL");
    }

    params.push(limit);
    /* tasks.detail (migration 472): a readable note. body is a dedupe key on many
       tasks; detail is the sentence the person should read. Null when none.
       The queue is how staff work, so it must not go down because a database has
       not applied 472 yet (a deploy preview does not migrate): on "no such
       column" the same read runs once more with detail as null. */
    const listSql = (detailColumn) => `
      SELECT t.id, t.client_id, t.title, t.body, t.due_at,
             t.source_workflow, t.done, t.created_at,
             t.assignee_role, t.assignee_staff_id,
             t.meeting_url,
             ${detailColumn} AS detail,
             s.name AS assignee_name,
             TRIM(COALESCE(c.first_name,'') || ' ' || COALESCE(c.last_name,'')) AS client_name
        FROM tasks t
        LEFT JOIN clients c ON c.id = t.client_id
        LEFT JOIN staff   s ON s.id = t.assignee_staff_id
       ${where.length ? "WHERE " + where.join(" AND ") : ""}
       ORDER BY t.due_at ASC NULLS LAST, t.created_at DESC
       LIMIT $${params.length}`;
    try {
      let result;
      try {
        result = await db.query(listSql("t.detail"), params);
      } catch (err) {
        if (!err || err.code !== "42703") throw err;
        result = await db.query(listSql("NULL::text"), params);
      }
      const { rows } = result;
      return res.status(200).json({ ok: true, count: rows.length, tasks: rows });
    } catch (err) {
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "query_failed", message: "Something went wrong loading tasks. Try again in a moment.", detail: safeError(err) });
    }
  }

  if (req.method === "PATCH") {
    /* Composes AFTER requirePrincipal above, never instead of it: that decides
       WHO this is, this decides whether they are on the clock. The principal is
       passed explicitly because requirePrincipal attaches nothing to `req` — it
       calls authenticate() directly, so there is no req.staff for the gate to
       read. Note `staff` above is a reshaped { id, role }, not a principal, and
       must not be passed in its place.

       First in the branch, before the body is destructured: whether you may
       write at all is not a question about the payload. The gate writes its own
       refusal and returns null, so `if (!shift) return;` is the whole contract —
       including the 503 it answers when the shift CHECK itself failed, which must
       never collapse into "you are not clocked in" and must never fall through to
       an UPDATE. It is deliberately outside the try/catch below, which maps
       failures onto 400/500 and would otherwise be able to reshape that 503. */
    /* Owners are exempt — owner decision, 2026-08-02: "Owners definitely don't
       clock in." Same reason as the other two gated endpoints: the decision is
       about who clocks in, not about which screen, and an owner who cannot
       claim or close a task is locked out of his own work queue. */
    const shift = await requireActiveShift(req, res, { db, principal, exempt: SUPER_ROLES });
    if (!shift) return;

    const { id, done, claim, assignee_staff_id } = req.body || {};
    const RET = `id, client_id, title, body, due_at, source_workflow,
                 assignee_role, assignee_staff_id, done, created_at`;

    if (!id) return res.status(400).json({ ok: false, error: "id_required" });

    try {
      // claim — take a task off the role queue. Deliberately conditional on
      // assignee_staff_id IS NULL: two people hitting Claim on the same row must
      // not both win, and the loser needs to be told, not silently overwritten.
      if (claim === true) {
        const { rows } = await db.query(
          `UPDATE tasks SET assignee_staff_id = $2, updated_at = now()
            WHERE id = $1 AND org_id = $3 AND assignee_staff_id IS NULL
            RETURNING ${RET}`,
          [id, staff.id, orgId]
        );
        if (rows[0]) return res.status(200).json({ ok: true, task: rows[0] });

        // Distinguish "gone" from "somebody got there first". Always org-scoped
        // so a foreign id never confirms existence or returns the row.
        const cur = await db.query(
          `SELECT ${RET} FROM tasks WHERE id = $1 AND org_id = $2`, [id, orgId]);
        if (!cur.rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
        if (cur.rows[0].assignee_staff_id === staff.id) {
          return res.status(200).json({ ok: true, task: cur.rows[0] });  // already mine
        }
        return res.status(409).json({
          ok: false, error: "already_claimed", task: cur.rows[0]
        });
      }

      // Reassign or hand back. null puts it back in the role queue.
      if (assignee_staff_id !== undefined) {
        const { rows } = await db.query(
          `UPDATE tasks SET assignee_staff_id = $2, updated_at = now()
            WHERE id = $1 AND org_id = $3 RETURNING ${RET}`,
          [id, assignee_staff_id || null, orgId]
        );
        if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
        return res.status(200).json({ ok: true, task: rows[0] });
      }

      if (typeof done !== "boolean") {
        return res.status(400).json({ ok: false, error: "done_claim_or_assignee_required" });
      }
      const { rows } = await db.query(
        `UPDATE tasks SET done = $2, updated_at = now()
          WHERE id = $1 AND org_id = $3
         RETURNING ${RET}`,
        [id, done, orgId]
      );
      if (!rows[0]) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json({ ok: true, task: rows[0] });
    } catch (err) {
      if (CLIENT_DATA_ERRORS.has(err && err.code)) {
        return res.status(400).json({ ok: false, error: "invalid_parameter" });
      }
      return res.status(500).json({ ok: false, error: "update_failed", message: "Something went wrong updating that task. Try again in a moment.", detail: safeError(err) });
    }
  }

  return res.status(405).json({ ok: false, error: "method_not_allowed" });
}
