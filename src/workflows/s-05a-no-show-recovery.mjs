// S-05a — No-Show Recovery.
// Source: the CRM sticky "S-05a No-Show Recovery". Trigger: booking.noshow
// (dpc-02 emits this 5 minutes after a missed ClickFunnels call). Spec 4.4: four touches,
// email + SMS each. Stop on booking.created OR booking.rescheduled. Re-check before each send.
//
// SEND WINDOW (owner-set 2026-10-31). These are drip messages: they go out from
// 9 a.m. to 5 p.m. Arizona time only. The sender holds a drip that comes due
// outside that window until 9 a.m., and when it wakes it checks the opt-out and
// nothing else. A message written to the queue at 6 p.m. would therefore still
// go at 9 a.m. to a person who booked again at 8 a.m. So this workflow does the
// waiting itself: it works out each touch's real send time once (dripSendTime),
// sleeps until then, checks for a rebook, and only then writes the message. The
// closer's task does not wait; a person on the closer's list is there at once.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { addTags } from "./tags.mjs";
import { createTask } from "../lib/create-task.mjs";
import { sendTemplated } from "./messaging.mjs";
import { appointmentContext } from "./s-04b-booking-reminders.mjs";
import { dripSendTime } from "../messaging/send-window.mjs";

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
//
// The starting count stops at the moment of the no-show itself (`upToEventId`),
// not at the moment this run's first step happens to execute. A person who books
// again in that gap used to be folded into the starting count, so no later count
// was ever bigger and all four touches went (independent review of PR #346,
// 2026-10-31). If the no-show row cannot be found, the count runs to now, as before.
async function bookingActivityCount(db, { orgId, clientId, upToEventId = null }) {
  const r = await db.query(
    `SELECT COUNT(*)::int AS n
       FROM events
      WHERE org_id = $1 AND client_id = $2
        AND name IN ('booking.created', 'booking.rescheduled')
        AND ($3::uuid IS NULL OR created_at <= COALESCE(
              (SELECT s.created_at FROM events s WHERE s.id = $3::uuid AND s.org_id = $1), now()))`,
    [orgId, clientId, upToEventId]
  );
  return Number(r.rows[0]?.n || 0);
}

async function hasRebooked(db, { orgId, clientId, priorCount }) {
  return (await bookingActivityCount(db, { orgId, clientId })) > priorCount;
}

/* The call that was missed rides along as the appointment, the way the booking
   texts carry it. Without it the first email's "We had you down for
   {{appointment.start_time}}" printed "We had you down for  and didn't connect." */
async function sendPair(db, { orgId, clientId, eventId, emailKey, smsKey, context }) {
  const email = await sendTemplated(db, {
    orgId, clientId, channel: "email", templateKey: emailKey, eventId: `${eventId}:email`, context
  });
  const sms = await sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: smsKey, eventId: `${eventId}:sms`, context
  });
  return { email, sms };
}

const HOUR = 60 * 60 * 1000;

/* The four touches, in order, with the gap that comes BEFORE each (spec 4.4):
   touch 1 as soon as the window allows, touch 2 a day after touch 1, touch 3
   two days after touch 2, touch 4 four days after touch 3. */
const TOUCHES = [
  { emailKey: EMAIL_TEMPLATE_KEY, smsKey: SMS_TEMPLATE_KEY, gapMs: 0 },
  { emailKey: EMAIL_NOSHOW_02, smsKey: SMS_NOSHOW_02, gapMs: 24 * HOUR },
  { emailKey: EMAIL_NOSHOW_03, smsKey: SMS_NOSHOW_03, gapMs: 48 * HOUR },
  { emailKey: EMAIL_NOSHOW_04, smsKey: SMS_NOSHOW_04, gapMs: 96 * HOUR }
];

/* touchPlan — when each touch really goes, from the moment the no-show is seen.
   A gap is counted from the day the earlier touch really goes (dripSendTime of
   it), not from the day it was due, so a no-show at 6 p.m. is touched Thursday
   9 a.m., Friday 9 a.m., the Sunday after, and the Thursday after that. */
export function touchPlan(nowMs) {
  const at = [];
  for (const touch of TOUCHES) {
    const due = at.length === 0 ? nowMs : at[at.length - 1].getTime() + touch.gapMs;
    at.push(dripSendTime(new Date(due)));
  }
  return at;
}

export async function handle({ event, db, step, now = () => Date.now() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const context = appointmentContext(event.payload || {});
  const priorBookings = await step.run("snapshot-bookings", () => bookingActivityCount(db, { orgId, clientId, upToEventId: eventId }));

  await step.run("tag-no-show", () => addTags(db, clientId, ["call:no_show"]));

  // Immediate: the closer's list does not follow the send window.
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

  /* WHEN EACH TOUCH GOES, decided once and written down. Inngest re-runs
     everything outside a step against the clock as it is on every later pass,
     so the plan is a step: the moments chosen when the no-show arrived are the
     moments used. (A step's answer travels as JSON, so they are stored as text.) */
  const plan = await step.run("plan-touches", () => ({
    at: touchPlan(now()).map((d) => d.toISOString())
  }));

  const sent = {};
  for (let i = 0; i < TOUCHES.length; i += 1) {
    const n = i + 1;
    await step.sleepUntil(`wait-touch-${n}`, new Date(plan.at[i]));
    // After the wait and before the write: a person who booked again while the
    // touch was waiting for the window gets nothing.
    if (await step.run(`check-booked-${n}`, () => hasRebooked(db, { orgId, clientId, priorCount: priorBookings }))) {
      return { done: true, stoppedAt: `before-touch-${n}`, ...sent, task };
    }
    sent[`touch${n}`] = await step.run(`send-touch-${n}`, () =>
      sendPair(db, {
        orgId, clientId, eventId: `${eventId}:${n}`,
        emailKey: TOUCHES[i].emailKey, smsKey: TOUCHES[i].smsKey, context
      }));
  }

  return { done: true, ...sent, task };
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
