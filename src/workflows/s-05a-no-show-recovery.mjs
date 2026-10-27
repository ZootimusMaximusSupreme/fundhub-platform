// S-05a — No-Show Recovery.
// Source: the CRM sticky "S-05a No-Show Recovery". Trigger: booking.noshow
// (dpc-02 emits this 5 minutes after a missed ClickFunnels call). Spec 4.4: four touches,
// email + SMS each. Stop on booking.created OR booking.rescheduled. Re-check before each send.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { sendTemplated } from "./messaging.mjs";

export const EMAIL_TEMPLATE_KEY = "EMAIL-S05A-NOSHOW-RECOVERY";
export const SMS_TEMPLATE_KEY = "SMS-S05A-NOSHOW-RECOVERY";
export const EMAIL_NOSHOW_02 = "EMAIL-S05A-NOSHOW-02";
export const SMS_NOSHOW_02 = "SMS-S05A-NOSHOW-02";
export const EMAIL_NOSHOW_03 = "EMAIL-S05A-NOSHOW-03";
export const SMS_NOSHOW_03 = "SMS-S05A-NOSHOW-03";
export const EMAIL_NOSHOW_04 = "EMAIL-S05A-NOSHOW-04";
export const SMS_NOSHOW_04 = "SMS-S05A-NOSHOW-04";
export const SOURCE_WORKFLOW = "s-05a-no-show-recovery";

// A reschedule of the same booking may not create another booking.created.
// Count both kinds before the first touch and again after each wait, scoped
// to the same company so unrelated events cannot stop recovery.
async function bookingActivityCount(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM events
      WHERE org_id = $1 AND client_id = $2
        AND name IN ('booking.created', 'booking.rescheduled')`,
    [orgId, clientId]
  );
  return Number(r.rows[0]?.n || 0);
}

async function hasRebooked(db, { orgId, clientId, priorCount }) {
  return (await bookingActivityCount(db, { orgId, clientId })) > priorCount;
}

async function sendPair(db, { orgId, clientId, eventId, emailKey, smsKey }) {
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: emailKey, eventId: `${eventId}:email`
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: smsKey, eventId: `${eventId}:sms`
  });
  return { email, sms };
}

export async function handle({ event, db, step }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const priorBookings = await step.run("snapshot-bookings", () => bookingActivityCount(db, { orgId, clientId }));

  await step.run("tag-no-show", () => addTags(db, clientId, ["call:no_show"]));

  const touch1 = await step.run("send-touch-1", () =>
    sendPair(db, {
      orgId, clientId, eventId: `${eventId}:1`,
      emailKey: EMAIL_TEMPLATE_KEY, smsKey: SMS_TEMPLATE_KEY
    }));

  const task = await step.run("create-recovery-task", () =>
    createTask(db, {
      orgId,
      clientId,
      title: "No-show recovery — rebook",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "closer",
      eventId,
      dueAt: null
    }));

  await step.sleep("wait-24h", "24h");
  if (await step.run("check-booked-2", () => hasRebooked(db, { orgId, clientId, priorCount: priorBookings }))) {
    return { done: true, stoppedAt: "before-touch-2", touch1, task };
  }
  const touch2 = await step.run("send-touch-2", () =>
    sendPair(db, {
      orgId, clientId, eventId: `${eventId}:2`,
      emailKey: EMAIL_NOSHOW_02, smsKey: SMS_NOSHOW_02
    }));

  await step.sleep("wait-48h", "48h");
  if (await step.run("check-booked-3", () => hasRebooked(db, { orgId, clientId, priorCount: priorBookings }))) {
    return { done: true, stoppedAt: "before-touch-3", touch1, touch2, task };
  }
  const touch3 = await step.run("send-touch-3", () =>
    sendPair(db, {
      orgId, clientId, eventId: `${eventId}:3`,
      emailKey: EMAIL_NOSHOW_03, smsKey: SMS_NOSHOW_03
    }));

  await step.sleep("wait-96h", "96h");
  if (await step.run("check-booked-4", () => hasRebooked(db, { orgId, clientId, priorCount: priorBookings }))) {
    return { done: true, stoppedAt: "before-touch-4", touch1, touch2, touch3, task };
  }
  const touch4 = await step.run("send-touch-4", () =>
    sendPair(db, {
      orgId, clientId, eventId: `${eventId}:4`,
      emailKey: EMAIL_NOSHOW_04, smsKey: SMS_NOSHOW_04
    }));

  return { done: true, touch1, touch2, touch3, touch4, task };
}

export const s05aNoShowRecovery = inngest.createFunction(
  {
    id: "s-05a-no-show-recovery",
    name: "S-05a — No-Show Recovery",
    cancelOn: [
      {
        event: "booking.created",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      },
      {
        event: "booking.rescheduled",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  { event: "booking.noshow" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
