// S-04B — Booking confirmation + reminders.
// Source: the CRM S-04B (confirm / T-24h / T-2h). Owner 2026-08-15: port SMS leg
// only — no video links. Stops if the call is already held before a reminder.
// Owner 2026-08-22: S-04B also owns the single immediate booking-confirm EMAIL
// (the CRM S-04 "Appointment Confirmation"), written fresh — the old copy was
// Analyzer-era and was never wired.
//
// Trigger: booking.created. Spec 4.10: booking.rescheduled cancels the in-flight
// run and restarts against the new start_time (same content).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { callHappened } from "./dpc-02-call-outcome-enforcement.mjs";
import { drainMessageNow } from "../messaging/outbox.mjs";
import { portalLoginUrl } from "../auth/magic-link.mjs";
import { ensurePendingClientAccount } from "../auth/account-session.mjs";
import { createTask } from "../lib/create-task.mjs";

export const SMS_CONFIRM = "SMS-S04-01-CONFIRM";
export const EMAIL_CONFIRM = "EMAIL-S04-01-CONFIRM";
export const SMS_REMIND_24H = "SMS-S04-02-REMIND-24H";
export const SMS_REMIND_2H = "SMS-S04-03-REMIND-2H";

const HOUR = 60 * 60 * 1000;

/* How far from the intended moment a reminder may still be sent.
   A durable wake is never exact to the millisecond, and five minutes is far
   inside the resolution of "your call is tomorrow" while being far outside the
   nought-to-five minutes that F47 actually produced. */
export const REMINDER_SKEW_MS = 5 * 60 * 1000;

/* reminderPlan — WHEN each reminder is allowed to go out, decided once at
 * booking time.
 *
 * F47, measured 2026-09-03: four customers got "your call is tomorrow at ..."
 * within minutes of booking, one of them for a call three days away. The
 * subtraction in this file was never wrong; what was missing was any check that
 * the moment it produced is still in the future. `new Date("not a date")` is an
 * Invalid Date, `sleepUntil` on one wakes at once, and a customer who booked
 * twenty hours out has a "24 hours before" moment that is already four hours in
 * the past — both cases fired instantly and both said "tomorrow".
 *
 * So a reminder whose moment has already gone is not sent late. It is not sent.
 * A reminder is a promise about the clock; a late one is a lie about it, and
 * this lane exists to send fewer, truer messages rather than more.
 */
export function reminderPlan(startTime, nowMs) {
  const startMs = new Date(startTime).getTime();
  if (!Number.isFinite(startMs)) return { ok: false, reason: "unreadable_start_time" };
  if (startMs <= nowMs) return { ok: false, reason: "appointment_already_started" };
  const at = (offsetMs) => {
    const target = startMs - offsetMs;
    return target > nowMs + REMINDER_SKEW_MS ? new Date(target) : null;
  };
  return { ok: true, startMs, t24: at(24 * HOUR), t2: at(2 * HOUR) };
}

/* planFromMemo — turn the written-down plan back into dates.
 *
 * A step's answer is carried across a replay as JSON, so a Date goes in and a
 * string comes back. The two moments are stored as text on purpose and rebuilt
 * here, in one place, so the rest of the function works with dates exactly as
 * it did before.
 */
function planFromMemo(memo) {
  return {
    startMs: memo.startMs,
    t24: memo.t24 ? new Date(memo.t24) : null,
    t2: memo.t2 ? new Date(memo.t2) : null
  };
}

/* The same question asked again on waking, because a durable sleep can be
   resumed early after a retry or a replay and the sender must not take the
   scheduler's word for the time. */
function wakeRefusal(startMs, targetMs, nowMs) {
  if (nowMs >= startMs) return "appointment_already_started";
  if (nowMs < targetMs - REMINDER_SKEW_MS) return "woke_before_the_reminder_was_due";
  return null;
}

/* F1 — the booking confirmation lands in about three minutes and the owner
 * wants it inside sixty seconds. The dispatcher's sweep runs every five
 * minutes, so most of that wait is a message sitting in the queue waiting for a
 * clock tick.
 *
 * THE SWEEP CADENCE IS NOT TOUCHED. It is one setting for every kind of message
 * the company sends, and moving it would speed up things nobody asked to speed
 * up. Instead the two rows this workflow has just written — the booking text and
 * the booking email, and nothing else — ask to be worked now, by id, through the
 * dispatcher that already handles them. The sweep stays exactly as it is and
 * remains the backstop for these two rows and everything else.
 *
 * "Now" means it does not wait for a clock. It does not mean any check is
 * skipped: the company pause switch, the daily cap, quiet hours, opt-out and
 * the compliance screen are all the dispatcher's and all still run. Nothing here
 * can bypass one. See src/messaging/outbox.mjs.
 */
async function dispatchConfirmationNow(db, drainNow, { orgId, messageIds }) {
  const out = [];
  for (const id of messageIds) {
    // Never throws — a message that could not go out immediately is still
    // queued, and the sweep is still coming.
    out.push({ messageId: id, ...(await drainNow(db, id, { orgId })) });
  }
  return out;
}

/* Exported because AI-SET-04 sends about the same appointment and used to send
   about none — it called sendTemplated with no context at all, so the handoff
   text's {{appointment.meeting_location}} rendered as nothing and the customer
   got "link: ." (F49). One shape for one appointment, in one place. */
export function appointmentContext(payload = {}) {
  const startTime = payload.startTime || payload.start_time || null;
  const meeting =
    payload.meetingUrl || payload.meeting_url || payload.meeting_location || null;
  const timezone =
    payload.tzid || payload.timezone || payload.tz || payload.time_zone || null;
  return {
    appointment: {
      start_time: startTime,
      timezone,
      meeting_location: meeting
    }
  };
}

/* This is a permanent entry page, not a bearer credential. It asks the client
   to prove the email on their file and can issue a fresh sign-in link whenever
   they open it; old booking texts therefore never strand them. */
export function bookingClaimUrl(env = process.env) {
  return `${portalLoginUrl(env)}?mode=claim`;
}

export async function handle({
  event, db, step,
  ensurePendingClientAccountImpl = ensurePendingClientAccount,
  drainNowImpl = drainMessageNow,
  now = () => Date.now()
}) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const payload = event.payload || {};
  const startTime = payload.startTime || payload.start_time || null;
  const context = appointmentContext(payload);

  // The client account exists before the first text is queued. Its invited
  // state cannot sign in until the client proves control of the email address.
  const portalAccount = await step.run("ensure-booking-portal-account", () =>
    ensurePendingClientAccountImpl(db, { orgId, clientId }));
  const claimUrl = bookingClaimUrl();

  const confirm = await step.run("send-confirm", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_CONFIRM,
      eventId: `${eventId}:confirm`,
      context: { ...context, portal_claim: { url: claimUrl } }
    }));

  // Owner decision 2026-08-22: booked stage is one text + Josh dial + one email,
  // all immediate. Text first, email second; the AI setter dials on its own leg.
  // The confirmation email uses the same permanent entry page as the text.
  // Neither message contains a credential that can expire in the inbox.
  const confirmEmail = await step.run("send-confirm-email", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_CONFIRM,
      eventId: `${eventId}:confirm-email`,
      context: {
        ...context,
        magic_link: { url: claimUrl, expires_minutes: "" },
        call_confirm: { url: claimUrl },
        portal_claim: { url: claimUrl },
        app_download: { url: `${portalLoginUrl()}#download` },
        web_portal: { url: portalLoginUrl() }
      }
    }));

  // F1 — hand these two rows to the dispatcher now instead of waiting for the
  // next five-minute sweep. Everything else in the system still waits for it.
  const confirmDispatch = await step.run("dispatch-confirmation-now", () =>
    dispatchConfirmationNow(db, drainNowImpl, {
      orgId,
      messageIds: [confirm?.messageId, confirmEmail?.messageId].filter(Boolean)
    }));

  // A task failure must not delay the booking text or email. The workflow will
  // retry this step with the send steps already idempotently completed.
  const portalAccountTask = portalAccount?.ok ? null : await step.run("flag-booking-portal-account", () =>
    createTask(db, {
      orgId, clientId, eventId, sourceWorkflow: "s-04b-booking-reminders",
      title: "Resolve booked client's portal account",
      assigneeRole: "setter",
      detail: `Account not created at booking: ${portalAccount?.reason || "unknown"}. Confirm the client's email and help them claim the portal before the call.`
    }));

  const base = { done: true, portalAccount, portalAccountTask, confirm, confirmEmail, confirmDispatch };

  if (!startTime) {
    return { ...base, skippedReminders: "no_start_time" };
  }

  /* THE PLAN IS DECIDED ONCE, WHEN THE BOOKING ARRIVES, AND WRITTEN DOWN.
   *
   * Inngest does not run this function once from top to bottom. It runs it from
   * the top, does the first step it has not done yet, records that step's
   * answer, and then starts again from the top — replaying the steps it already
   * has and re-running everything OUTSIDE a step against whatever the clock says
   * on that later pass.
   *
   * So a plan computed out here was recomputed on every wake. When the run woke
   * at "24 hours before the call", it asked "is 24 hours before the call still
   * in the future?", answered no — it is this instant — and took the
   * booked_inside_24h branch instead of sending. The same thing happened again
   * at the 2-hour mark. Both reminders were silently switched off, which is why
   * this is inside a step now: a step's answer is recorded on the first pass and
   * handed back unchanged on every replay, so these are the moments chosen at
   * booking time and they do not move. Same shape as the memoized wake time in
   * src/workflows/ai-set-01-josh-setter.mjs.
   *
   * The live clock is still read, in wakeRefusal below — that is the check that
   * a wake really is the moment it claims to be, and it has to see the real
   * clock to be worth anything.
   */
  const planned = await step.run("plan-reminders", () => {
    const p = reminderPlan(startTime, now());
    if (!p.ok) return { ok: false, reason: p.reason };
    return {
      ok: true,
      startMs: p.startMs,
      t24: p.t24 ? p.t24.toISOString() : null,
      t2: p.t2 ? p.t2.toISOString() : null
    };
  });
  if (!planned.ok) {
    // An unreadable or already-past start time. The confirmation still goes —
    // it is a receipt for what they booked — but nothing that talks about
    // "tomorrow" or "in two hours" is sent about a moment we cannot place.
    return { ...base, skippedReminders: planned.reason };
  }
  const plan = planFromMemo(planned);

  const out = { ...base };

  if (!plan.t24) {
    // Booked less than 24 hours before the call. There is no "24 hours before"
    // left to reach, so this reminder does not exist for this booking.
    out.skipped24h = "booked_inside_24h";
  } else {
    await step.sleepUntil("wait-t-minus-24h", plan.t24);
    /* Inside a step for the same reason the plan is: the answer belongs to the
       moment the run actually woke, not to whatever the clock says on some
       later replay. */
    const refused24 = await step.run("wake-check-24h", () =>
      wakeRefusal(plan.startMs, plan.t24.getTime(), now()));
    if (refused24) {
      out.skipped24h = refused24;
    } else if (await step.run("recheck-24h", () => callHappened(db, clientId))) {
      return { ...out, stoppedAt: "before-24h", stoppedBecause: "call_held" };
    } else {
      out.remind24 = await step.run("send-remind-24h", () =>
        sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: SMS_REMIND_24H,
          eventId: `${eventId}:24h`, context
        }));
    }
  }

  if (!plan.t2) {
    out.skipped2h = "booked_inside_2h";
  } else {
    await step.sleepUntil("wait-t-minus-2h", plan.t2);
    const refused2 = await step.run("wake-check-2h", () =>
      wakeRefusal(plan.startMs, plan.t2.getTime(), now()));
    if (refused2) {
      out.skipped2h = refused2;
    } else if (await step.run("recheck-2h", () => callHappened(db, clientId))) {
      return { ...out, stoppedAt: "before-2h", stoppedBecause: "call_held" };
    } else {
      out.remind2 = await step.run("send-remind-2h", () =>
        sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: SMS_REMIND_2H,
          eventId: `${eventId}:2h`, context
        }));
    }
  }

  return out;
}

export const s04bBookingReminders = inngest.createFunction(
  {
    id: "s-04b-booking-reminders",
    name: "S-04B — Booking Confirm + Reminders",
    // Cross-company emails and provider UIDs may collide. Every cancellation
    // condition must also identify the SAME organization as the running job.
    cancelOn: [
      {
        event: "booking.rescheduled",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      },
      {
        event: "booking.rescheduled",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.bookingUid != null && event.data.payload.bookingUid == async.data.payload.bookingUid"
      },
      {
        event: "booking.cancelled",
        if: "event.data.orgId != null && event.data.orgId == async.data.orgId && event.data.payload.email != null && event.data.payload.email == async.data.payload.email"
      }
    ]
  },
  [{ event: "booking.created" }, { event: "booking.rescheduled" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
