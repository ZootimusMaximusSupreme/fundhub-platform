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
// Every message carries two merge tags, {{survey_stopped_at}} ("the credit score
// question") and {{survey_taps_left}} ("5 more taps"), which say it the way a person
// would (surveyProgressWords in src/survey/resume-state.mjs). The EMAIL also carries
// {{survey_resume_link}}, a signed link that opens /apply on the question where the
// person stopped (src/survey/resume-link.mjs). THE TEXT NEVER DOES. The link opens the
// person's saved answers, and the public form can put any phone on an existing lead's
// email, so a text can reach someone else; the email address is the lead's identity,
// so the email reaches the owner (review 2026-10-31). The text points to the email
// instead. The words are the seed's (SMS-S02-RESUME-1..3, EMAIL-S02-RESUME-1..3); this
// file only sends the keys.
//
// THE TWO PROGRESS TAGS ARE WORKED OUT AT SEND TIME, from the answers saved by then,
// because a person can answer more questions between one touch and the next. A touch
// that finds nothing left to answer does not send: the survey is done.
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
// ONE SEQUENCE AT A TIME. A person who comes back through the resume link and
// answers another question fires a new entry.captured (the adapter's six-hour
// repeat guard has run out), which starts a second run. Its send keys are
// different (messageCohortId looks back six hours), so without a guard the person
// would get a second touch 1 on top of the first run's touch 2. A run that finds
// resume messages already sent to the person in the last four days, from another
// opt-in, steps aside.
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
import { surveyResumeUrl } from "../survey/resume-link.mjs";
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
   after the opt-in), so "sent in the last four days" means "still running". */
export const SEQUENCE_WINDOW_MS = 4 * 24 * 60 * 60 * 1000;

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

/* Resume messages already sent to this person from a DIFFERENT opt-in, newer than
   `since`. Messages of this run's own cohort do not count: their send key ends in
   `:<cohortId>`. */
export async function sequenceInFlight(db, { orgId, clientId, cohortId, since }) {
  const r = await db.query(
    `SELECT 1 FROM messages
      WHERE org_id = $1 AND client_id = $2
        AND direction = 'outbound'
        AND template_key = ANY($3)
        AND created_at > $4
        AND COALESCE(provider_ref, '') NOT LIKE $5
      LIMIT 1`,
    [orgId, clientId, RESUME_TEMPLATE_KEYS, since, `%:${cohortId}`]
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
    return {
      startedAt: new Date(startMs).toISOString(),
      goesOutAt: resumePlan(startMs).map((at) => at.toISOString()),
      cohortId: await messageCohortId(db, { eventId: event.id, orgId, clientId, name: "entry.captured" })
    };
  });

  const crowded = await step.run("check-sequence-in-flight", () =>
    sequenceInFlight(db, {
      orgId, clientId, cohortId: plan.cohortId,
      since: new Date(Date.parse(plan.startedAt) - SEQUENCE_WINDOW_MS).toISOString()
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
      const words = {
        survey_stopped_at: progress.stoppedAt,
        survey_taps_left: progress.tapsLeft
      };
      return {
        sms: await sendTemplated(db, {
          orgId, clientId, channel: "sms", templateKey: touch.sms, eventId: plan.cohortId, context: words
        }),
        email: await sendTemplated(db, {
          orgId, clientId, channel: "email", templateKey: touch.email, eventId: plan.cohortId,
          context: { ...words, survey_resume_link: surveyResumeUrl({ orgId, clientId, now }) }
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
