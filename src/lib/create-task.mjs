// createTask — the single place a workflow creates work for a person.
//
// Nineteen workflows had their own copy of a select-then-insert with
// assignee = NULL, so every one of them produced a task that reached nobody and
// each one had its own subtly-worded idempotency check. This is that code, once,
// with the owning role as a required argument.
//
// IDEMPOTENCY — read this before changing the key.
//
// The key is (client_id, source_workflow, dedupeKey), where dedupeKey defaults to
// the EVENT ID and is stored in `body`. That is what 006_tasks_idempotency.sql
// already enforces with a unique index, and it is what the standing rule "same
// event twice = one row" asks for: replaying an event produces one task, and two
// genuinely different events produce two.
//
// Unit 4 specified keying on (client_id, source_workflow, TITLE) instead. That is
// not implemented as the default on purpose, because title is not unique per
// occurrence: c-02's task is always "Remove inquiries — round in progress", so a
// client on their second optimization round would silently get no task at all —
// the work would be dropped, not deduped. Callers that genuinely want
// one-task-ever-per-client can pass dedupeOn: "title" explicitly, and the
// discrepancy is flagged rather than decided here.
//
// The insert is ON CONFLICT DO NOTHING against that unique index, so two
// concurrent dispatches of the same event cannot both create a row — the check
// below is an early out, not the guarantee.

const EMPLOYEE_ROLES = new Set([
  "owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter",
  // Owns the Sales pipeline and the closers under it, so it owns their tasks.
  // db/migrations/112_sales_manager_role.sql widens the matching CHECK on
  // tasks.assignee_role — this set and that constraint must stay in step, or a
  // task passes here and is rejected by the database.
  "sales_manager",
  // Owns the client after the sale — the mid check-in, the results interview,
  // and the human end of the AR ladder. db/migrations/290_csm_role.sql widens
  // tasks_assignee_role_ck to match; same standing rule as sales_manager above.
  "csm"
]);

export const TASK_ROLES = EMPLOYEE_ROLES;

/* createTask(db, spec) → { created, id, reason }

   Required: orgId, clientId, title, sourceWorkflow, assigneeRole
   Optional: eventId (the dedupe key, and what lands in body), body, dueAt,
             assigneeStaffId, dedupeOn ("event" | "title"), detail

   detail — a readable note for whoever opens the task (tasks.detail, migration
   472). body is the dedupe key, so it cannot carry sentences; this can. It is
   written only when the row is created, never part of the dedupe, and a caller
   that passes none runs exactly the INSERT it always did.

   created:false with a reason is a normal outcome, not an error — a replay
   hitting an existing task is the system working. */
export async function createTask(db, {
  orgId,
  clientId,
  title,
  sourceWorkflow,
  assigneeRole,
  assigneeStaffId = null,
  eventId = null,
  body = undefined,
  dueAt = null,
  meetingUrl = null,
  detail = null,
  dedupeOn = "event"
} = {}) {
  if (!orgId) throw new Error("createTask: orgId is required");
  if (!title) throw new Error("createTask: title is required");
  if (!sourceWorkflow) throw new Error("createTask: sourceWorkflow is required");

  // The whole point of the unit: work without an owner is work that reaches
  // nobody, so this is a hard error rather than a nullable field.
  if (!assigneeRole) {
    throw new Error(`createTask: assigneeRole is required (${sourceWorkflow}: "${title}")`);
  }
  const role = String(assigneeRole).trim().toLowerCase();
  if (!EMPLOYEE_ROLES.has(role)) {
    throw new Error(
      `createTask: "${assigneeRole}" is not an employee role. ` +
      `Expected one of ${[...EMPLOYEE_ROLES].join(", ")}. ` +
      `Principal types (client, affiliate, partner) must never own internal work.`
    );
  }

  // body carries the dedupe key in the shape 006's unique index expects. An
  // explicit body wins, so a caller can store real detail — it then becomes the
  // dedupe value, which is why it must stay stable across replays of one event.
  const dedupeValue = body !== undefined ? body : eventId;

  if (dedupeOn === "title") {
    const dup = await db.query(
      `SELECT id FROM tasks
        WHERE client_id = $1 AND source_workflow = $2 AND title = $3
        LIMIT 1`,
      [clientId, sourceWorkflow, title]
    );
    if (dup.rows[0]) return { created: false, id: dup.rows[0].id, reason: "duplicate_title" };
  } else if (dedupeValue != null) {
    const dup = await db.query(
      `SELECT id FROM tasks
        WHERE client_id = $1 AND source_workflow = $2 AND body = $3
        LIMIT 1`,
      [clientId, sourceWorkflow, dedupeValue]
    );
    if (dup.rows[0]) return { created: false, id: dup.rows[0].id, reason: "duplicate_event" };
  }

  /* detail is written only when the caller gave one. A caller with none runs the
     statement below unchanged, so a database that has not applied 472 yet (a deploy
     preview) keeps creating every other task. */
  const ins = detail === null || detail === undefined || String(detail).trim() === ""
    ? await db.query(
      `INSERT INTO tasks
         (org_id, client_id, assignee, title, body, due_at, source_workflow,
          assignee_role, assignee_staff_id, meeting_url)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orgId, clientId, title, dedupeValue, dueAt, sourceWorkflow, role, assigneeStaffId, meetingUrl]
    )
    : await db.query(
      `INSERT INTO tasks
         (org_id, client_id, assignee, title, body, due_at, source_workflow,
          assignee_role, assignee_staff_id, meeting_url, detail)
       VALUES ($1,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [orgId, clientId, title, dedupeValue, dueAt, sourceWorkflow, role, assigneeStaffId, meetingUrl, String(detail)]
    );

  // No row back means the unique index absorbed a concurrent insert. That is a
  // successful dedupe, not a failure.
  if (!ins.rows[0]) return { created: false, id: null, reason: "duplicate_race" };
  return { created: true, id: ins.rows[0].id, reason: null };
}

export default createTask;
