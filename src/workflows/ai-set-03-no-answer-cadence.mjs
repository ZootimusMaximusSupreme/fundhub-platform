// AI-SET-03 — No-Answer SMS Cadence.
// Source: the CRM system map AI SETTER section.
// Audit fix applied (workflow-coherence-audit.md: "all 3 waits = 1 min → triple-
// texts client in ~2 min. Change to 30 min / 2 hr / 24 hr") — done below. Real,
// compliance-scrubbed copy seeded via src/workflows/templates-seed.mjs. Despite the
// "AI Setter" naming this is pre-scripted SMS, not a live AI agent call (no
// `ai_agent` step in the source crawl) — safe to port as a plain templated cadence.
//
// Triggers (owner-set 2026-10-31):
//   setter.no_answer  the human setter saved "No answer" on the setter desk
//                     (src/setter/dashboard.mjs). One per lead per Phoenix day.
//   call.completed    a finished call whose disposition is a no-answer one (the
//                     retired AI setter's path, and the voice calls that still end
//                     this way). The disposition gate below applies to it.
//
// Two sets of words, picked just before the first text goes out, by whether the
// person has a call still ahead of them:
//   a booked or rescheduled booking that has not started yet -> SMS-AISET03-MSG1..3
//     (about their call; {{appointment.start_time}} is the time of that call)
//   anyone else                                              -> SMS-AISET03-OPTIN-1..3
//     (asks them to pick a time on {{custom_values.booking_link}})
//
// WHEN EACH TEXT GOES OUT. Texts leave only inside the drip window, 9 a.m. to
// 5 p.m. Arizona (src/messaging/send-window.mjs). The dispatcher holds a text that
// comes due outside it until 9 a.m. but does not look at bookings or replies
// again, so each moment is planned here and the run sleeps until it BEFORE it
// checks anything. The moments are decided inside steps (one answer, recorded, the
// same on every replay):
//   text 1 at dripSendTime(now)
//   text 2 at dripSendTime(text 1's moment + 30 minutes)
//   text 3 at dripSendTime(text 2's moment + 2 hours)
// So "No answer" at 4:50 p.m. sends text 1 at once, text 2 at 9:00 the next
// morning and text 3 at 11:00, not both at 9:00. At each moment, in this order:
// sleep until it, stop if the person booked or moved their call since the run
// began (booking.created / booking.rescheduled), stop if they wrote back
// (message.inbound, see stop-on-reply.mjs), then send. Both stops are measured
// from the run's own trigger event. The old check looked at the person's whole
// history, so anyone who had ever booked stopped after text 1 — which would end
// the "call booked" words after one text.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { hasReplied } from "./stop-on-reply.mjs";
import { dripSendTime } from "../messaging/send-window.mjs";

export const MSG1_KEY = "SMS-AISET03-MSG1";
export const MSG2_KEY = "SMS-AISET03-MSG2";
export const MSG3_KEY = "SMS-AISET03-MSG3";
export const OPTIN1_KEY = "SMS-AISET03-OPTIN-1";
export const OPTIN2_KEY = "SMS-AISET03-OPTIN-2";
export const OPTIN3_KEY = "SMS-AISET03-OPTIN-3";

const CALL_BOOKED_KEYS = [MSG1_KEY, MSG2_KEY, MSG3_KEY];
const NO_CALL_KEYS = [OPTIN1_KEY, OPTIN2_KEY, OPTIN3_KEY];

const MINUTE = 60 * 1000;
// How long after the text before it each of texts 2 and 3 is due.
export const TEXT_GAP_MS = Object.freeze({ 2: 30 * MINUTE, 3: 120 * MINUTE });

/* The start of the person's next call, as an ISO string, or null when they have
   none ahead of them. Same booking rule as the setter desk and the reply router:
   booked or rescheduled, and not yet started. */
export async function upcomingCall(db, orgId, clientId) {
  const r = await db.query(
    `SELECT starts_at FROM bookings
      WHERE org_id = $1 AND client_id = $2 AND status IN ('booked', 'rescheduled')
        AND starts_at > now()
      ORDER BY starts_at ASC LIMIT 1`,
    [orgId, clientId]
  );
  const at = r.rows[0]?.starts_at;
  if (!at) return null;
  const when = new Date(at);
  return Number.isFinite(when.getTime()) ? when.toISOString() : null;
}

/* Did the person book or move a call after this run began? */
export async function rebookedSince(db, clientId, eventId) {
  const r = await db.query(
    `SELECT 1 AS rebooked
       FROM events e, events s
      WHERE s.id = $2 AND e.org_id = s.org_id AND e.client_id = $1
        AND e.name IN ('booking.created', 'booking.rescheduled')
        AND e.created_at > s.created_at
      LIMIT 1`,
    [clientId, eventId]
  );
  return r.rows.length > 0;
}

export async function handle({ event, db, step, now = () => new Date() }) {
  if (!["no_answer", "no-answer", "voicemail"].includes(event.payload?.disposition)) {
    return { done: false, reason: "not_no_answer" };
  }

  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const eventId = event.id;
  const replied = () => hasReplied(db, { clientId, eventId });

  /* Wait for text n, then ask whether it should still go. Returns why the cadence
     should stop ("rebooked" or "replied"), or null to send. The moment is planned
     in a step; text 1 is due now, texts 2 and 3 after the text before them. */
  let plannedMs = 0;
  async function waitAndCheck(n) {
    const planned = await step.run(`plan-msg${n}`, () => {
      const due = n === 1 ? now().getTime() : plannedMs + TEXT_GAP_MS[n];
      return dripSendTime(new Date(due)).toISOString();
    });
    plannedMs = Date.parse(planned);
    await step.sleepUntil(`wait-until-msg${n}`, new Date(planned));
    if (await step.run(`check-rebooked-${n}`, () => rebookedSince(db, clientId, eventId))) return "rebooked";
    if (await step.run(`check-replied-${n}`, replied)) return "replied";
    return null;
  }

  const stop1 = await waitAndCheck(1);
  if (stop1) return { done: true, exitedAt: stop1 === "replied" ? "replied" : "before-msg1" };

  const callAt = await step.run("find-upcoming-call", () => upcomingCall(db, orgId, clientId));
  const keys = callAt ? CALL_BOOKED_KEYS : NO_CALL_KEYS;
  const context = callAt ? { appointment: { start_time: callAt } } : {};
  const send = (n) => sendTemplated(db, {
    orgId, clientId, channel: "sms", templateKey: keys[n - 1], eventId: `${eventId}:${n}`, context
  });

  const msg1 = await step.run("send-msg1", () => send(1));

  const stop2 = await waitAndCheck(2);
  if (stop2) return { done: true, exitedAt: stop2 === "replied" ? "replied" : "after-msg1", msg1 };
  const msg2 = await step.run("send-msg2", () => send(2));

  const stop3 = await waitAndCheck(3);
  if (stop3) return { done: true, exitedAt: stop3 === "replied" ? "replied" : "after-msg2", msg1, msg2 };
  const msg3 = await step.run("send-msg3", () => send(3));

  return { done: true, exitedAt: "completed", msg1, msg2, msg3 };
}

export const aiSet03NoAnswerCadence = inngest.createFunction(
  { id: "ai-set-03-no-answer-cadence", name: "AI-SET-03 — No-Answer SMS Cadence" },
  [{ event: "call.completed" }, { event: "setter.no_answer" }],
  ({ event, step }) => handle({ event: event.data, db, step })
);
