// AI-SET-04 — 3-Way Text Handoff.
// Source: the CRM system map AI SETTER section.
// Audit fix applied (Spec §6 + workflow-coherence-audit.md: "draft, never fires, no
// trigger, no advisor follow-up. Publish, wire into DPC-03, add advisor message") —
// this file IS that publish + wiring: real trigger (T-15 off the booked start), real
// compliance-scrubbed copy (Workflow-SMS-Fixes-Ready-to-Paste.md), plus the advisor
// follow-up task the original lacked.
//
// Trigger: booking.created, and booking.rescheduled (a moved call gets its text at
// the NEW time). Fires 15 minutes before the appointment's start time via a durable
// sleepUntil — not a poll, a single scheduled wake. A move or cancel stops the run
// for the old time (cancelOn below), and on waking the run re-checks the saved
// booking before it sends.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { createTask } from "../lib/create-task.mjs";
import { appointmentContext, REMINDER_SKEW_MS } from "./s-04b-booking-reminders.mjs";
import { portalLoginUrl } from "../auth/magic-link.mjs";
import { bookingStateAt, SLOT_STATE, fillMeetingUrl } from "../bookings/store.mjs";
import { findMeetLink, meetLinkValue } from "../bookings/meet-link.mjs";
import { CANCEL_RULES, RESCHEDULE_CANCEL_RULES } from "./booking-cancel-rules.mjs";

export const SMS_TEMPLATE_KEY = "SMS-AISET04-HANDOFF";
const SOURCE_WORKFLOW = "ai-set-04-3way-handoff";

/* F49 — the handoff text arrived reading "...so you're not walking in cold —
 * link: ." The template asks for {{appointment.meeting_location}} and this
 * workflow passed no context at all, so the tag rendered as nothing and the
 * customer was handed a full stop.
 *
 * Context alone is not enough, because the ClickFunnels webhook carries no
 * link (the adapter sets meetingUrl: null). The real link is the Google Meet
 * link on the host's calendar event for this call (src/bookings/meet-link.mjs),
 * which the early step in handle() keeps on the booking a couple of minutes
 * after it is made. Places are asked in order of how specific they are, and the
 * last one always answers:
 *   1. the booking event's own payload,
 *   2. the saved booking row for this client at this exact call time,
 *   3. the host calendar event for this exact call, read now and kept,
 *   4. the customer's portal sign-in page, clearly named as a fallback and not
 *      as the meeting link.
 * An older call for the same client is never a source for this text.
 */
async function meetingLinkFor(db, { orgId, clientId, payload = {}, findLink = findMeetLink }) {
  const fromPayload = meetLinkValue(
    payload.meetingUrl || payload.meeting_url || payload.meeting_location || null
  );
  if (fromPayload) return { url: fromPayload, from: "payload" };

  const startTime = payload.startTime || payload.start_time || null;
  const bookingUid = payload.bookingUid ? String(payload.bookingUid).trim() : null;

  try {
    if (startTime && (clientId || bookingUid)) {
      const exactCall = await db.query(
        `SELECT meeting_url FROM bookings
          WHERE org_id = $1
            AND starts_at = $3::timestamptz
            AND status IN ('booked', 'rescheduled')
            AND (($2::uuid IS NOT NULL AND client_id = $2::uuid)
                 OR ($4::text IS NOT NULL AND provider_uid = $4::text))
            AND meeting_url IS NOT NULL
          ORDER BY updated_at DESC
          LIMIT 1`,
        [orgId, clientId || null, new Date(startTime).toISOString(), bookingUid]
      );
      const saved = meetLinkValue(exactCall.rows[0]?.meeting_url);
      if (saved) return { url: saved, from: "booking_exact_call" };
    }
  } catch (err) {
    console.warn(`[ai-set-04] could not read a meeting link: ${String(err?.message || err)}`);
  }

  const fromCalendar = await meetLinkFromHostCalendar(db, { orgId, clientId, payload, findLink });
  if (fromCalendar.ok) return { url: fromCalendar.url, from: "host_calendar" };

  return { url: portalLoginUrl(), from: "portal_sign_in", reason: fromCalendar.reason || "not_found" };
}

function handoffMeetingLocation(link) {
  if (link.from !== "portal_sign_in") return link.url;
  return `Meet link unavailable. This is the Fundhub portal sign-in fallback, not the meeting link: ${link.url}`;
}

/* THE CALL'S OWN MEET LINK, READ FROM THE HOST CALENDAR AND KEPT.
 *
 * Used by the early step (a couple of minutes after booking, so the closer's
 * Join call button and the pulse see the link) and by the 15-minute text (in
 * case the early read missed). Never throws: a miss returns its reason, and that
 * is the step's recorded answer, so the run log says why a booking has no link.
 * Saving is a fill-the-blank write on the booking and its call task
 * (src/bookings/store.mjs fillMeetingUrl). A save that fails still hands back
 * the link it found. */
export async function meetLinkFromHostCalendar(db, { orgId, clientId, payload = {}, findLink = findMeetLink }) {
  let email = String(payload.email || payload.attendeeEmail || "").trim();
  try {
    if (!email && clientId) {
      const r = await db.query(`SELECT email FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
      email = String(r.rows[0]?.email || "").trim();
    }
  } catch (err) {
    return { ok: false, reason: `client_email_unreadable:${String(err?.message || err).slice(0, 120)}` };
  }
  const startTime = payload.startTime || payload.start_time || null;
  let found;
  try {
    found = await findLink({ email, startTime });
  } catch (err) {
    found = { ok: false, reason: `lookup_threw:${String(err?.message || err).slice(0, 120)}` };
  }
  if (!found || !found.ok || !found.url) return { ok: false, reason: (found && found.reason) || "not_found" };
  let saved;
  try {
    saved = await fillMeetingUrl(db, {
      orgId, clientId, providerUid: payload.bookingUid || null, startsAt: startTime, url: found.url
    });
  } catch (err) {
    saved = { error: String(err?.message || err).slice(0, 160) };
  }
  return { ok: true, url: found.url, source: found.source || null, saved };
}

async function createAdvisorTaskOnce(db, { orgId, clientId, eventId }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, SOURCE_WORKFLOW, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: "3-way handoff — advisor follow-up on UnderwriteIQ results",
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: "closer",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step, now = () => Date.now(), findLink = findMeetLink }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const payload = event.payload || {};
  const startTime = payload.startTime;
  if (!startTime) return { done: false, reason: "no_start_time" };
  const orgId = event.orgId;

  /* THE JOIN LINK, KEPT ON THE BOOKING SOON AFTER IT IS MADE.
   *
   * ClickFunnels puts the call on the host's Google Calendar about a second
   * after its webhook, and the form post that starts this run can arrive before
   * that (measured 2026-10-10: form post 19:42:42.4, calendar event 19:42:43).
   * So the run waits two minutes, reads the host calendar once, and keeps the
   * Meet link on the booking and the closer's call task. The 15-minute text
   * reads it from there, and asks the calendar again if this read missed. */
  await step.sleep("wait-for-host-calendar", "2m");
  const joinLink = await step.run("keep-meet-link", () =>
    meetLinkFromHostCalendar(db, { orgId, clientId, payload, findLink }));

  /* WHEN THIS TEXT IS ALLOWED TO GO, decided once and written down.
   *
   * Three ways this message used to be a lie about the clock, all the same
   * class as F47:
   *   * a start time nothing can read makes an Invalid Date, and sleepUntil on
   *     one wakes at once;
   *   * a booking whose start time is already in the past has a "fifteen
   *     minutes before" moment that is further in the past still, so the sleep
   *     also ends at once and the customer is told a finished call starts in
   *     fifteen minutes;
   *   * a booking taken inside the last fifteen minutes has no "fifteen minutes
   *     before" left to reach at all.
   * None of those is sent late. None of them is sent.
   *
   * The answer is worked out INSIDE a step, because Inngest re-runs everything
   * outside a step on every replay against the clock as it is then — which is
   * how the same shape switched both booking reminders off in
   * src/workflows/s-04b-booking-reminders.mjs. Recorded once, it does not move.
   * (A step's answer travels as JSON, so the moment is stored as text.)
   */
  const plan = await step.run("plan-handoff", () => {
    const startMs = new Date(startTime).getTime();
    if (!Number.isFinite(startMs)) return { ok: false, reason: "unreadable_start_time" };
    const nowMs = now();
    if (startMs <= nowMs) return { ok: false, reason: "appointment_already_started" };
    const targetMs = startMs - 15 * 60 * 1000;
    if (targetMs <= nowMs + REMINDER_SKEW_MS) return { ok: false, reason: "booked_inside_15m" };
    return { ok: true, at: new Date(targetMs).toISOString() };
  });
  if (!plan.ok) return { done: false, reason: plan.reason, joinLink };
  await step.sleepUntil("wait-until-t-minus-15", new Date(plan.at));

  /* A MOVED OR CANCELLED CALL GETS NO "STARTS IN 15 MINUTES" AT ITS OLD TIME.
   *
   * This run slept since the call was booked (or last moved). A move starts a
   * fresh run for the new time (the booking.rescheduled trigger below) and
   * cancelOn stops this one, but a cancelOn that misses — a call saved under an
   * old message id, two runs racing — must not let the old-time text out. So on
   * waking, the saved booking is asked: is a live booking still at THIS time?
   * Moved, cancelled or already marked a no-show → no text, no advisor task.
   * No saved row speaks to this time → send as before (src/bookings/store.mjs). */
  const slot = await step.run("check-call-still-at-this-time", () =>
    bookingStateAt(db, { orgId, clientId, bookingUid: payload.bookingUid, startTime }));
  if (slot === SLOT_STATE.MOVED || slot === SLOT_STATE.CANCELLED || slot === SLOT_STATE.NOSHOW) {
    return { done: false, reason: `call_${slot}` };
  }

  /* ONE TEXT PER CUSTOMER PER CALL TIME, never two. The queue row is keyed on
   * this, not on the event id, so the run from the booking and the run from a
   * move that kept the same time cannot both write a row (messages has a
   * unique (org_id, provider_ref)). Worked out from the payload alone — no
   * clock — so it is the same on every replay. */
  const eventId = sendKeyFor(clientId, startTime);
  const link = await step.run("resolve-meeting-link", () =>
    meetingLinkFor(db, { orgId, clientId, payload, findLink }));
  const context = appointmentContext({ ...payload, meetingUrl: handoffMeetingLocation(link) });
  const sms = await step.run("send-handoff-sms", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_TEMPLATE_KEY, eventId, context
    }));
  const task = await step.run("create-advisor-task", () => createAdvisorTaskOnce(db, { orgId, clientId, eventId }));

  return { done: true, sms, task, link, joinLink };
}

/** The one-per-call-time key for the text and the advisor task. */
export function sendKeyFor(clientId, startTime) {
  return `booking-start:${clientId}:${new Date(startTime).toISOString()}`;
}

/* A cancel stops this run; a move to a different time stops the run for the
   old time, and the booking.rescheduled trigger starts one for the new time.
   Rules shared with dpc-02 (src/workflows/booking-cancel-rules.mjs). */
export const aiSet043WayHandoff = inngest.createFunction(
  {
    id: "ai-set-04-3way-handoff",
    name: "AI-SET-04 — 3-Way Text Handoff",
    cancelOn: [...CANCEL_RULES, ...RESCHEDULE_CANCEL_RULES]
  },
  [{ event: "booking.created" }, { event: "booking.rescheduled" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
