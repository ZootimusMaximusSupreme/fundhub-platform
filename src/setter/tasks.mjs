// Human setter work is created from the same durable event bus as the sales card.
// Funnel screens may emit many distinct event IDs for one person's single opt-in.
// One open task per client and workflow kind; slot-normalized bookings share one row.
import { on } from "../events/registry.mjs";
import { createTask } from "../lib/create-task.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { hasBooked } from "../workflows/s-nobook-chase.mjs";
import { queueSurveyCompletedAlerts } from "../staff/lead-alerts.mjs";
import { messageCohortId } from "../workflows/messaging.mjs";

export function setterTasksEnabled(env = process.env) {
  return !["0", "false", "off"].includes(String(env.SETTER_TASKS_ENABLED ?? "1").toLowerCase());
}

async function existingClientId(event, db) {
  if (event.clientId) return event.clientId;
  const p = event.payload || {};
  if (p.clientId) return p.clientId;
  const email = String(p.email || "").trim().toLowerCase();
  if (email) {
    const found = await db.query(
      `SELECT id FROM clients WHERE org_id = $1 AND lower(email) = $2 LIMIT 1`,
      [event.orgId, email]
    );
    if (found.rows[0]) return found.rows[0].id;
  }
  return null;
}

function bookingSlot(value) {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function phoenixDay() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}

async function existingTask(event, db, clientId, booked, slot) {
  if (!booked) {
    const found = await db.query(
      `SELECT id, done FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND source_workflow = 'setter-entry'
        ORDER BY done ASC, updated_at DESC, id DESC LIMIT 1`,
      [event.orgId, clientId]
    );
    return found.rows[0] || null;
  }
  if (!slot) return null;
  // Older task bodies hold event IDs. Compare their event's appointment slot so
  // a form post and its later ClickFunnels appointment webhook share one task.
  const found = await db.query(
    `SELECT t.id, t.body, t.done, e.payload->>'startTime' AS event_start_time FROM tasks t
       LEFT JOIN events e ON e.id::text = t.body
      WHERE t.org_id = $1 AND t.client_id = $2
        AND t.source_workflow = 'setter-booking' AND t.done = false`,
    [event.orgId, clientId]
  );
  return found.rows.find(row => row.body === `setter-booking:${slot}` || bookingSlot(row.event_start_time) === slot) || null;
}

export async function createSetterTaskForEvent(event, db, env = process.env) {
  if (!setterTasksEnabled(env)) return { created: false, reason: "disabled" };
  if (!event?.id || !event?.orgId || !["entry.captured", "booking.created"].includes(event.name)) {
    return { created: false, reason: "unsupported_event" };
  }
  const clientId = await existingClientId(event, db);
  if (!clientId) return { created: false, reason: "client_not_found" };
  const booked = event.name === "booking.created";
  const slot = booked ? bookingSlot(event.payload?.startTime) : null;
  const sourceWorkflow = booked ? "setter-booking" : "setter-entry";

  return withTransaction(db, async (writer) => {
    await writer.query(
      "SELECT id FROM clients WHERE org_id = $1 AND id = $2 FOR UPDATE",
      [event.orgId, clientId]
    );
    if (booked) {
      await writer.query(
        `UPDATE tasks SET done = true,
           title = 'Setter: survey follow-up resolved by booking',
           detail = 'They booked a call. Confirm it in the booked-call task.',
           updated_at = now()
         WHERE org_id = $1 AND client_id = $2 AND done = false
           AND source_workflow IN ('setter-entry', 'setter-survey-done')
           AND body LIKE 'survey-completed:%'`,
        [event.orgId, clientId]
      );
    }
    const priorTask = await existingTask(event, writer, clientId, booked, slot);
    if (priorTask && !priorTask.done) {
      return { created: false, id: priorTask.id, reason: "duplicate_open_task" };
    }
    if (booked) {
      const open = await writer.query(
        `SELECT id FROM tasks
          WHERE org_id = $1 AND client_id = $2 AND source_workflow = $3 AND done = false
          ORDER BY created_at DESC LIMIT 1`,
        [event.orgId, clientId, sourceWorkflow]
      );
      if (open.rows[0]) return { created: false, id: open.rows[0].id, reason: "open_task" };
    }
    const body = booked && slot ? `setter-booking:${slot}` :
      !booked ? `setter-entry:${phoenixDay()}:${priorTask?.id || "initial"}` : undefined;
    return createTask(writer, {
      orgId: event.orgId,
      clientId,
      title: booked ? "Setter: confirm booked strategy call" : "Setter: call new opt-in",
      sourceWorkflow,
      assigneeRole: "setter",
      eventId: body === undefined ? String(event.id) : undefined,
      body,
      dueAt: new Date().toISOString(),
      detail: booked ? "Dial within 60 seconds, confirm and prepare handoff." : "Dial within 60 seconds and book a strategy call."
    });
  });
}

export const SURVEY_DONE_TASK_TITLE = "Setter: call now — survey done, no booking";
export const SURVEY_DONE_TASK_DETAIL = "They finished the survey without booking. Call now and help them pick a time.";

// A finished survey raises the existing opt-in task instead of stacking a second
// call task on the same lead. The client lock also serializes a booking task that
// arrives at the same moment. Replays can retry the staff alert independently.
export async function escalateCompletedSurvey(event, db, env = process.env,
  alertImpl = queueSurveyCompletedAlerts) {
  if (!setterTasksEnabled(env)) return { created: false, reason: "disabled" };
  if (!event?.id || !event?.orgId || event.name !== "survey.completed") {
    return { created: false, reason: "unsupported_event" };
  }
  const clientId = await existingClientId(event, db);
  if (!clientId) return { created: false, reason: "client_not_found" };
  const cohortId = await messageCohortId(db, {
    eventId: event.id, orgId: event.orgId, clientId, name: "survey.completed"
  });
  const dedupeKey = `survey-completed:${cohortId}`;

  const task = await withTransaction(db, async (writer) => {
    await writer.query("SELECT id FROM clients WHERE org_id = $1 AND id = $2 FOR UPDATE",
      [event.orgId, clientId]);
    if (await hasBooked(writer, clientId)) return { created: false, reason: "already_booked" };

    const handled = (await writer.query(
      `SELECT id FROM tasks WHERE org_id = $1 AND client_id = $2
         AND source_workflow IN ('setter-entry', 'setter-survey-done') AND body = $3
       LIMIT 1`, [event.orgId, clientId, dedupeKey]
    )).rows[0];
    if (handled) return { created: false, id: handled.id, reason: "completion_cycle_handled" };

    const open = (await writer.query(
      `SELECT id, source_workflow FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND done = false
          AND source_workflow IN ('setter-entry', 'setter-survey-done')
        ORDER BY CASE WHEN source_workflow = 'setter-entry' THEN 0 ELSE 1 END,
                 updated_at DESC LIMIT 1`,
      [event.orgId, clientId]
    )).rows[0];
    if (open) {
      await writer.query(
        `UPDATE tasks SET title = $2, detail = $3, body = $4,
            due_at = now(), updated_at = now()
          WHERE id = $1 AND org_id = $5 AND done = false`,
        [open.id, SURVEY_DONE_TASK_TITLE, SURVEY_DONE_TASK_DETAIL, dedupeKey, event.orgId]
      );
      return { created: false, id: open.id, reason: "promoted_open_task" };
    }
    return createTask(writer, {
      orgId: event.orgId, clientId, title: SURVEY_DONE_TASK_TITLE,
      sourceWorkflow: "setter-survey-done", assigneeRole: "setter",
      body: dedupeKey, dueAt: new Date().toISOString(), detail: SURVEY_DONE_TASK_DETAIL
    });
  });
  if (task.reason === "already_booked") return task;
  if (await hasBooked(db, clientId)) return { ...task, alerts: { queued: 0, reason: "already_booked" } };
  const alerts = await alertImpl(db, { orgId: event.orgId, clientId, cohortId });
  return { ...task, alerts };
}

export function register() {
  on("entry.captured", createSetterTaskForEvent);
  on("booking.created", createSetterTaskForEvent);
  on("survey.completed", escalateCompletedSurvey);
}
