// Human setter work is created from the same durable event bus as the sales card.
// One open task per client and event type; a later event can start new work
// after the earlier task is completed. Event IDs still dedupe event replays.
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

export async function createSetterTaskForEvent(event, db, env = process.env) {
  if (!setterTasksEnabled(env)) return { created: false, reason: "disabled" };
  if (!event?.id || !event?.orgId || !["entry.captured", "booking.created"].includes(event.name)) {
    return { created: false, reason: "unsupported_event" };
  }
  const clientId = await existingClientId(event, db);
  if (!clientId) return { created: false, reason: "client_not_found" };
  const booked = event.name === "booking.created";
  const sourceWorkflow = booked ? "setter-booking" : "setter-entry";
  return withTransaction(db, async (writer) => {
    // Funnel screens can each emit a distinct event for one opt-in. Lock the
    // client so concurrent posts cannot both create the same open job.
    await writer.query("SELECT id FROM clients WHERE org_id = $1 AND id = $2 FOR UPDATE", [event.orgId, clientId]);
    const open = await writer.query(
      `SELECT id FROM tasks
        WHERE org_id = $1 AND client_id = $2 AND source_workflow = $3 AND done = false
        ORDER BY created_at DESC LIMIT 1`,
      [event.orgId, clientId, sourceWorkflow]
    );
    if (open.rows[0]) return { created: false, id: open.rows[0].id, reason: "open_task" };
    return createTask(writer, {
      orgId: event.orgId,
      clientId,
      title: booked ? "Setter: confirm booked strategy call" : "Setter: call new opt-in",
      sourceWorkflow,
      assigneeRole: "setter",
      eventId: String(event.id),
      dueAt: new Date().toISOString(),
      detail: booked ? "Dial within 60 seconds, confirm and prepare handoff." : "Dial within 60 seconds and book a strategy call."
    });
  });
}

export function register() {
  on("entry.captured", createSetterTaskForEvent);
  on("booking.created", createSetterTaskForEvent);
}
