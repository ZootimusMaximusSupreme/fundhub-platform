// Human setter work is created from the same durable event bus as the sales card.
// Funnel screens may emit many distinct event IDs for one person's single opt-in.
// One open task per client and workflow kind; slot-normalized bookings share one row.
import { on } from "../events/registry.mjs";
import { createTask } from "../lib/create-task.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

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
    const priorTask = await existingTask(event, writer, clientId, booked, slot);
    if (priorTask && !priorTask.done) {
      return { created: false, id: priorTask.id, reason: "duplicate_open_task" };
    }
    if (booked && !slot) {
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

export function register() {
  on("entry.captured", createSetterTaskForEvent);
  on("booking.created", createSetterTaskForEvent);
}
