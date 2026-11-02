// S-04C — optional staff text when a call is booked.
// Trigger: booking.created. Does not touch S-04 / S-04B client jobs.
// Owner-set 2026-08-23: Staff & Teams switch, default off.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { queueStaffBookedAlerts } from "../staff/booked-call-alert.mjs";

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const queued = await step.run("queue-staff-alerts", () =>
    queueStaffBookedAlerts(db, {
      orgId: event.orgId,
      clientId,
      eventId: event.id,
      eventName: event.name,
      payload: event.payload || {}
    }));

  return { done: true, ...queued };
}

export const s04cStaffBookedAlert = inngest.createFunction(
  { id: "s-04c-staff-booked-alert", name: "S-04C — Staff booked-call text" },
  { event: "booking.created" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
