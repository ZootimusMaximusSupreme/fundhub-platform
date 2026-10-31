// S-02 — Quit-survey follow-up (the "Incomplete App (Survey)" workflow, rebuilt
// 2026-10-31). Source: the CRM system map SALES WORKFLOWS section, then the owner's
// funnel workflows fix: a lead who opts in on /apply and stops partway (or never
// starts the questions) gets a text AND an email that send them straight back to
// the survey question where they stopped.
//
// (A second, unrelated "S-02 — Attribution Capture" also exists in the map with the
// same key; that one is a duplicate of AT-01's First Touch Date logic and isn't
// ported separately — see workflow-migration-table.md.)
//
// Trigger: entry.captured. Three touches, text + email each:
//
//   touch 1  20 minutes after the opt-in (the next 9:00 a.m. Arizona if that is outside 9 to 5)
//   touch 2  9:00 a.m. Arizona on the day after touch 1 really goes out
//   touch 3  9:00 a.m. Arizona on the day after touch 2
//
// The messages link to the plain /apply page. surveyProgressWords still decides
// whether any questions remain, but progress details are not sent to an unproved
// phone. The words live in the SMS-S02-RESUME-1..3 and EMAIL-S02-RESUME-1..3
// templates; this file only sends their keys.
//
// Progress is checked at send time from the answers saved by then, because a person
// can answer more questions between one touch and the next. A touch
// that finds nothing left to answer does not send: the survey is done.
//
// CONTAINMENT (2026-10-31): no signed ?r= code goes in these messages. /apply accepts
// an existing lead's email with a new phone and writes that phone onto the record
// (resolveClient), so a come-back text can reach a number nobody has proved belongs to
// the lead, and a code in it would open that lead's saved answers. The link stays the
// plain /apply page until a link can prove the person opening it owns the record.
//
// EMAIL-S02-FINISH-APPLICATION, the old one-email nudge whose link went to the
// calendar, is not sent any more. Its template row is left alone.
//
// "FINISHED" IS survey.completed, NOT survey.submitted. survey.submitted fires after
// the first answer, so the old check called a person who answered one question
// finished and nudged only people who quit before question one. survey.completed
// fires once, when the last question is answered.
//
// WHEN A TOUCH GOES OUT IS WHEN IT IS CHECKED (owner-set 2026-10-31). Drips only go
// out 9 a.m. to 5 p.m. Arizona (src/messaging/send-window.mjs). The dispatcher
// holds a drip that comes due outside that window until 9 a.m., and it does not
// ask again whether the person finished, replied or booked; it looks at opt-out
// and nothing else. So a check made at 11:20 p.m. would send a come-back text at
// 9 a.m. to somebody who finished the survey at 8. Instead every send time is
// planned as the time the message really goes out (dripSendTime), the run sleeps
// to that moment, and only then asks "finished? replied? booked?", and sends.
//
// THE PLAN IS DECIDED ONCE AND WRITTEN DOWN, in a step, for the reason spelled out
// in s-04b-booking-reminders.mjs: Inngest runs this function from the top on every
// wake, so a time worked out in the open would be worked out again against a later
// clock and every touch would slide. A step's answer is recorded on the first pass
// and handed back unchanged on every replay.
//
// ONE SEQUENCE AT A TIME. A person who comes back through plain /apply and
// answers another question fires a new entry.captured (the adapter's six-hour
// repeat guard has run out), which starts a second run. Its send keys are
// different (messageCohortId looks back six hours), so without a guard the person
// would get a second touch 1 on top of the first run's touch 2. A run that finds
// resume messages already sent to the person in the last four days, from another
// opt-in, steps aside. A new opt-in after the prior sequence's final touch starts
// a new sequence even inside that window.
//
// Duplicate runs for ONE opt-in (several ClickFunnels posts, a replayed event)
// share messageCohortId, so they share one message per touch: the send key is
// `workflow:<template key>:<cohort event id>` and the insert is a no-op the second time.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { messageCohortId, sendTemplated } from "./messaging.mjs";
import { addTags } from "./tags.mjs";
import { hasBooked } from "./s-nobook-chase.mjs";
import { hasReplied } from "./stop-on-reply.mjs";
import { RESUME_BASE_URL } from "../survey/resume-link.mjs";
import { surveyProgressWords } from "../survey/resume-state.mjs";
import { DRIP_START_HOUR, SEND_WINDOW_TZ, dripSendTime, nextHourStrike } from "../messaging/send-window.mjs";

// Touch 1 under the names the old nudge used (the pulse reads EMAIL_TEMPLATE_KEY from this file).
export const SMS_TEMPLATE_KEY = "SMS-S02-RESUME-1";
export const EMAIL_TEMPLATE_KEY = "EMAIL-S02-RESUME-1";

export const TOUCHES = Object.freeze([
  { n: 1, sms: SMS_TEMPLATE_KEY, email: EMAIL_TEMPLATE_KEY },
  { n: 2, sms: "SMS-S02-RESUME-2", email: "EMAIL-S02-RESUME-2" },
  { n: 3, sms: "SMS-S02-RESUME-3", email: "EMAIL-S02-RESUME-3" }
]);
export const RESUME_TEMPLATE_KEYS = Object.freeze(TOUCHES.flatMap((t) => [t.sms, t.email]));

export const FIRST_TOUCH_WAIT_MS = 20 * 60 * 1000;
/* Longer than a whole sequence (the last touch lands at most 2 days and 17 hours
   after the opt-in). The completed-sequence boundary below lets a later fresh
   opt-in start even while an old touch is inside this duplicate window. */
export const SEQUENCE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

/** The last sent S-02 sequence before this opt-in, with no older touch still pending. */
export async function lastCompletedSequenceAt(db, { eventId, orgId, clientId }) {
  const r = await db.query(
    `SELECT MAX(m.created_at) AS completed_at
       FROM events s
       JOIN messages m ON m.org_id = s.org_id AND m.client_id = $3
      WHERE s.id = $1 AND s.org_id = $2 AND s.name = 'entry.captured'
        AND m.direction = 'outbound'
        AND m.template_key = ANY($4)
        AND m.status IN ('sent', 'delivered')
        AND COALESCE(m.last_attempt_at, m.created_at) < s.created_at
        AND NOT EXISTS (
          SELECT 1 FROM messages pending
           WHERE pending.org_id = s.org_id AND pending.client_id = $3
             AND pending.direction = 'outbound'
             AND pending.template_key = ANY($5)
             AND pending.created_at < s.created_at
             AND pending.created_at > s.created_at - interval '4 days'
             AND (pending.status IS NULL OR pending.status IN ('queued', 'sending')
               OR (pending.status IN ('sent', 'delivered') AND pending.last_attempt_at >= s.created_at))
        )`,
    [eventId, orgId, clientId, [TOUCHES[2].sms, TOUCHES[2].email], RESUME_TEMPLATE_KEYS]
  );
  return r.rows[0]?.completed_at || null;
}

/* resumePlan — WHEN each touch really goes out, from the moment of the opt-in.

   Touch 1 is 20 minutes later, or the next 9:00 a.m. Arizona when that moment is
   outside the drip window (dripSendTime). Touches 2 and 3 are 9:00 a.m. on the
   calendar day after the touch before them goes out, so the person gets one a day
   whatever hour they signed up at. */
export function resumePlan(startMs) {
  const touch1 = dripSendTime(new Date(startMs + FIRST_TOUCH_WAIT_MS));
  const touch2 = nextHourStrike(touch1, SEND_WINDOW_TZ, DRIP_START_HOUR);
  const touch3 = nextHourStrike(touch2, SEND_WINDOW_TZ, DRIP_START_HOUR);
  return [touch1, touch2, touch3];
}

// Match on client_id OR on the email inside the event payload. Capture sources
// that predate T14-11 wrote survey events with client_id NULL, which made the
// client_id-only check unsatisfiable — so this job nudged people who had in fact
// finished the survey. The email arm covers those rows, and only those rows: a row
// stamped with somebody else's id is somebody else's. Scoped to the company.
export async function surveyCompleted(db, clientId, email, orgId = null) {
  const addr = String(email || "").trim().toLowerCase();
  // Param order stays [clientId, names, ...] so the shared pg fake keeps matching.
  const r = await db.query(
    `SELECT DISTINCT name FROM events
      WHERE name = ANY($2)
        AND ($4::uuid IS NULL OR org_id = $4::uuid)
        AND (client_id = $1 OR (client_id IS NULL AND $3 <> '' AND lower(payload->>'email') = $3))`,
    [clientId, ["survey.completed"], addr, orgId]
  );
  return r.rows.some((row) => row.name === "survey.completed");
}

/* Resume messages already sent to this person, newer than `since`, from any run.
   It is asked once, before this run sends anything, so a message it finds came from
   another run: that sequence is already going and this run steps aside. Two runs
   that both start before either has sent (two visits the same evening) share one
   send key instead (messageCohortId over SEQUENCE_WINDOW_MS), so the database drops
   the second copy of each touch. Independent review of PR #346, 2026-10-31. */
export async function sequenceInFlight(db, { orgId, clientId, since }) {
  const r = await db.query(
    `SELECT 1 FROM messages
      WHERE org_id = $1 AND client_id = $2
        AND direction = 'outbound'
        AND template_key = ANY($3)
        AND created_at > $4
      LIMIT 1`,
    [orgId, clientId, RESUME_TEMPLATE_KEYS, since]
  );
  return r.rows.length > 0;
}

/* The answers the person has saved, as of now. Read at the moment a touch goes out. */
async function savedFields(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
    [clientId, orgId]
  );
  return r.rows[0]?.custom_fields || {};
}

/* stopReason — why this touch must not go: "finished", "replied", "booked", or null.
   Run at the moment the touch goes out, never earlier (see the header).

   A reply is anything the person wrote back after the opt-in that started this run
   (`eventId`), by text or by email: the same check S-NOBOOK and AI-SET-03 make
   (stop-on-reply.mjs), so every follow-up stops on the same words. */
export async function stopReason(db, { orgId, clientId, email, eventId }) {
  if (await surveyCompleted(db, clientId, email, orgId)) return "finished";
  if (await hasReplied(db, { clientId, eventId })) return "replied";
  if (await hasBooked(db, clientId)) return "booked";
  return null;
}

export async function handle({ event, db, step, now = () => Date.now() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  const orgId = event.orgId;
  const leadEmail = (event.payload || {}).email || null;

  const plan = await step.run("plan-resume-touches", async () => {
    const startMs = now();
    const completedAt = await lastCompletedSequenceAt(db, { eventId: event.id, orgId, clientId });
    return {
      startedAt: new Date(startMs).toISOString(),
      completedAt,
      goesOutAt: resumePlan(startMs).map((at) => at.toISOString()),
      // One send key for every visit inside the sequence window, so two runs never both send a touch.
      cohortId: await messageCohortId(db, { eventId: event.id, orgId, clientId, name: "entry.captured", windowMs: SEQUENCE_WINDOW_MS, after: completedAt })
    };
  });

  const crowded = await step.run("check-sequence-in-flight", () =>
    sequenceInFlight(db, {
      orgId, clientId,
      since: new Date(Math.max(Date.parse(plan.startedAt) - SEQUENCE_WINDOW_MS, plan.completedAt ? Date.parse(plan.completedAt) : -Infinity)).toISOString()
    }));
  if (crowded) return { done: false, reason: "sequence_in_flight" };

  const touches = [];
  for (const touch of TOUCHES) {
    // Sleep to the moment the message really goes out, THEN ask, THEN send.
    await step.sleepUntil(`wait-touch-${touch.n}`, new Date(plan.goesOutAt[touch.n - 1]));

    const stop = await step.run(`check-before-touch-${touch.n}`, () =>
      stopReason(db, { orgId, clientId, email: leadEmail, eventId: event.id }));
    if (stop) {
      if (stop === "finished") await step.run("tag-survey-complete", () => addTags(db, clientId, ["survey:complete"]));
      return { done: true, touches, stoppedAt: `before-touch-${touch.n}`, stoppedBecause: stop };
    }

    const sent = await step.run(`send-resume-${touch.n}`, async () => {
      const progress = surveyProgressWords(await savedFields(db, { orgId, clientId }));
      // Every question is answered: there is nothing to come back to, so nothing goes.
      if (progress.left === 0) return { skipped: "all_answered" };
      const context = {
        survey_resume_link: RESUME_BASE_URL
      };
      return {
        sms: await sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: touch.sms, eventId: plan.cohortId, context
        }),
        email: await sendTemplated(db, {
          orgId, clientId, channel: "email", templateKey: touch.email, eventId: plan.cohortId, context
        })
      };
    });
    if (sent.skipped) {
      await step.run("tag-survey-complete", () => addTags(db, clientId, ["survey:complete"]));
      return { done: true, touches, stoppedAt: `before-touch-${touch.n}`, stoppedBecause: sent.skipped };
    }
    touches.push({ n: touch.n, ...sent });
  }

  return { done: true, touches };
}

export const s02IncompleteSurveyNudge = inngest.createFunction(
  { id: "s-02-incomplete-survey-nudge", name: "S-02 — Incomplete App (Survey)" },
  { event: "entry.captured" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
