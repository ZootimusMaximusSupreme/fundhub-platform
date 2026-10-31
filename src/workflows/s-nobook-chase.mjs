// S-NOBOOK — Chase for people who finished the survey and did not book a call.
// Owner 2026-08-15: three SMS, rebook link, no video / meme assets required.
// Text can mention "results" in plain language; MMS media is optional later.
//
// Trigger: survey.completed (owner-set 2026-10-31). It fires once, when the last
// question is answered. survey.submitted fires after the FIRST answer, so this
// chase used to treat a person who answered one question as finished.
//
// Timeline, counted from the finish:
//   15 minutes   a setter task: call them now and book them on their calendar
//   2 hours      text + email 1
//   +24 hours    text + email 2
//   +72 hours    text + email 3
// Each text goes out only inside the drip window, 9 a.m. to 5 p.m. Arizona
// (src/messaging/send-window.mjs). A text that comes due outside it is planned
// for the next 9 a.m., and the run sleeps until THAT moment before it checks
// anything: the dispatcher holds an out-of-window drip until 9 a.m. but does not
// look at bookings or replies again, so a check made at the first due time would
// be hours stale when the text really leaves. The planned moments are decided
// inside steps (one answer, recorded, the same on every replay):
//   text 1 at dripSendTime(finish + 2h)
//   text 2 at dripSendTime(text 1's moment + 24h)
//   text 3 at dripSendTime(text 2's moment + 72h)
// At each planned moment, in this order: sleep until it, stop if the person has
// booked (hasBooked), stop if they replied (message.inbound, stop-on-reply.mjs),
// then send. Every booking link follows the person's saved score
// (tierBookingLink in messaging.mjs): 700 and up opens the first calendar,
// everyone else the second.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { createTask } from "../lib/create-task.mjs";
import { messageCohortId, sendTemplated } from "./messaging.mjs";
import { hasReplied } from "./stop-on-reply.mjs";
import { dripSendTime } from "../messaging/send-window.mjs";

export const TRIGGER_EVENT = "survey.completed";

export const SMS_NOBOOK_01 = "SMS-NOBOOK-01";
export const SMS_NOBOOK_02 = "SMS-NOBOOK-02";
export const SMS_NOBOOK_03 = "SMS-NOBOOK-03";
export const EMAIL_NOBOOK_01 = "EMAIL-NOBOOK-01";
export const EMAIL_NOBOOK_02 = "EMAIL-NOBOOK-02";
export const EMAIL_NOBOOK_03 = "EMAIL-NOBOOK-03";

// The task a setter sees 15 minutes after a finished survey with no booking.
export const SETTER_TASK_SOURCE = "setter-survey-done";
export const SETTER_TASK_TITLE = "Setter: call — finished the survey, no call booked";
export const SETTER_TASK_DETAIL = "They finished the survey but did not pick a time. Call now and book them on their calendar.";

const HOUR = 60 * 60 * 1000;
// How long after the finish (text 1) or after the text before it (texts 2 and 3) each text is due.
export const TEXT_GAP_MS = Object.freeze({ 1: 2 * HOUR, 2: 24 * HOUR, 3: 72 * HOUR });
// The fixed waits a run that started under the old trigger (survey.submitted) still uses.
// Temporary: the longest such run ends about five days after this ships. Delete this,
// the `finished` branches below, sentByOtherTrigger and the old-trigger tests with it then.
const OLD_TRIGGER_WAIT = Object.freeze({ 1: ["wait-2h", "2h"], 2: ["wait-24h", "24h"], 3: ["wait-72h", "72h"] });
export const OLD_TRIGGER_EVENT = "survey.submitted";
/* Longer than a whole chase (2 + 24 + 72 hours), so a text from the other trigger's
   run newer than this, counted back from this run's start, is from a chase that is
   still going. Same temporary life as OLD_TRIGGER_WAIT. */
export const CROSS_TRIGGER_WINDOW_MS = 5 * 24 * HOUR;

/* ONE CHASE ACROSS THE TRIGGER CHANGE. A person who answered one question before
   this shipped has a survey.submitted run asleep. When they finish, survey.completed
   starts a second run. The two runs have different send keys (each keys on its own
   trigger's cohort), so without this the person gets every text twice: once from
   each run. So before each message, a run asks: did a run of the OTHER trigger send
   this same text to this person since `since`? If it did, this message is skipped
   and the run goes on (the setter task and the later checks still happen). The
   other run is read from the send key itself, `workflow:<key>:<cohort event id>:<n>`:
   its third part is the event that run keyed on, and that event's name is its
   trigger. Two runs of the SAME trigger are not touched here: a new finished survey
   more than six hours later still starts a new chase, as before. */
export async function sentByOtherTrigger(db, { orgId, clientId, templateKey, otherTrigger, since }) {
  const r = await db.query(
    `SELECT 1 AS sent
       FROM messages m
       JOIN events c ON c.org_id = m.org_id AND c.id::text = split_part(m.provider_ref, ':', 3)
      WHERE m.org_id = $1 AND m.client_id = $2 AND m.direction = 'outbound'
        AND m.template_key = $3 AND m.created_at > $4
        AND c.name = $5
      LIMIT 1`,
    [orgId, clientId, templateKey, since, otherTrigger]
  );
  return r.rows.length > 0;
}

/* hasBooked — has this person booked a call yet?
 *
 * THE OLD VERSION COULD ONLY EVER SAY NO. It asked for booking events
 * `WHERE client_id = $1`, and until 2026-09-03 the ClickFunnels adapter wrote
 * every funnel event with client_id NULL. So the chase never learned that
 * anybody had booked, and on 2026-09-03 one phone received 51 copies of "you
 * have not booked yet" from customers who were sitting in the Booked column.
 *
 * The adapter now stamps the client on new events. This is the other half:
 * every booking event ALREADY IN THE DATABASE still has a null client on it,
 * and every chase run sleeping in production is going to wake against those
 * rows. So the booking is also matched on the email address and the phone
 * number carried in the event's own payload — which is how a run that went to
 * sleep last night exits on wake instead of firing again.
 *
 * Scoped to the client's own company. The old query was not, and matching on an
 * email address without that scope would let one company's booking answer for
 * another's. Phone numbers are compared on their last ten digits so
 * "+1 555-000-1111" and "5550001111" are the same number.
 *
 * THE FALLBACKS ONLY APPLY TO UNSTAMPED ROWS (2026-09-17). The address match was
 * built to rescue the old rows that have no customer on them, and it was not
 * limited to those — so it also matched a NEW, properly-stamped booking that
 * belongs to somebody else who shares the address. Two people on one phone
 * number (a husband and wife, a business owner and their bookkeeper) is enough
 * to do it, and on the 2026-09-17 walk seven records shared one test number, so
 * four other people's bookings answered "yes, they booked" for a client who
 * never booked at all and the chase exited at already_booked every time.
 * `e.client_id IS NULL` on the two fallbacks confines them to exactly the
 * historical rows they were written for. A booking that IS stamped with this
 * client still stops the chase, through the first branch.
 */
export async function hasBooked(db, clientId) {
  const r = await db.query(
    `WITH me AS (SELECT org_id, email, phone FROM clients WHERE id = $1)
     SELECT 1 AS booked
       FROM events e, me
      WHERE e.name = 'booking.created'
        AND e.org_id = me.org_id
        AND (
             e.client_id = $1
          OR (e.client_id IS NULL
              AND me.email IS NOT NULL
              AND lower(COALESCE(e.payload->>'email','')) = lower(me.email))
          OR (e.client_id IS NULL
              AND length(regexp_replace(COALESCE(me.phone,''), '\\D', '', 'g')) >= 10
              AND right(regexp_replace(COALESCE(e.payload->>'phone',''), '\\D', '', 'g'), 10)
                = right(regexp_replace(me.phone, '\\D', '', 'g'), 10))
        )
      LIMIT 1`,
    [clientId]
  );
  return r.rows.length > 0;
}

/* When the survey was finished: the created_at of the event that started the run
   (a row in `events`, so it does not move between replays). Null when the row
   cannot be read. */
async function startedAt(db, { eventId, orgId }) {
  const r = await db.query(
    `SELECT created_at FROM events WHERE id = $1 AND org_id = $2`,
    [eventId, orgId]
  );
  const at = r.rows[0]?.created_at ? new Date(r.rows[0].created_at) : null;
  return at && Number.isFinite(at.getTime()) ? at : null;
}

export async function handle({ event, db, step, now = () => new Date() }) {
  const clientId = await step.run("resolve-client", () => resolveClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  // Already booked by the time we wake — common if they book on the thank-you page.
  if (await step.run("check-already-booked", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "already_booked" };
  }

  const orgId = event.orgId;
  const eventId = event.id;
  /* The name of the event that started THIS run. The Inngest wrapper below passes
     it. A run that was already asleep when the trigger moved from survey.submitted
     to survey.completed keeps going under the name it started with: same send keys
     (no text goes out twice), no setter task (a first answer is not a finished
     survey). Without a name the run is a survey.completed run. */
  const trigger = event.name || TRIGGER_EVENT;
  const finished = trigger === TRIGGER_EVENT;
  const replied = () => hasReplied(db, { clientId, eventId });

  /* One message of text n, unless the other trigger's run already sent it (see
     sentByOtherTrigger). The window counts back from this run's own start. */
  async function sendOnce(cohortId, channel, templateKey, n) {
    const start = (await startedAt(db, { eventId, orgId })) ?? now();
    const since = new Date(start.getTime() - CROSS_TRIGGER_WINDOW_MS).toISOString();
    const otherTrigger = finished ? OLD_TRIGGER_EVENT : TRIGGER_EVENT;
    if (await sentByOtherTrigger(db, { orgId, clientId, templateKey, otherTrigger, since })) {
      return { skipped: "sent_by_other_trigger" };
    }
    return sendTemplated(db, { orgId, clientId, channel, templateKey, eventId: `${cohortId}:${n}` });
  }

  /* 15 minutes in: a finished survey with no booking gets a person on the phone.
     Skipped when they booked or wrote back in the meantime. This is a task for a
     person, not a message, so it keeps its 15 minutes whatever the hour. */
  let task = null;
  if (finished) {
    await step.sleep("wait-15m", "15m");
    if (await step.run("check-booked-15m", () => hasBooked(db, clientId))) {
      return { done: true, exitedAt: "after-wait-15m" };
    }
    if (await step.run("check-replied-15m", replied)) {
      return { done: true, exitedAt: "replied" };
    }
    task = await step.run("setter-task", () => createTask(db, {
      orgId, clientId,
      title: SETTER_TASK_TITLE,
      sourceWorkflow: SETTER_TASK_SOURCE,
      assigneeRole: "setter",
      eventId,
      dueAt: now().toISOString(),
      detail: SETTER_TASK_DETAIL
    }));
  }

  /* Wait for text n. A survey.completed run plans the moment in a step (inside the
     drip window, see the header) and sleeps until it, so the checks that follow run
     at the moment the text really leaves. A run that was already asleep under the
     old trigger keeps its fixed waits; the dispatcher still holds its out-of-window
     drips, as it did before. */
  let plannedMs = 0;
  async function waitForText(n) {
    if (!finished) {
      await step.sleep(...OLD_TRIGGER_WAIT[n]);
      return;
    }
    const planned = await step.run(`plan-msg${n}`, async () => {
      /* Text 1 is due 2 hours after the finish, but never in the past: a run that
         starts late plans from the moment it really reaches this step. */
      const due = n === 1
        ? Math.max(((await startedAt(db, { eventId, orgId })) ?? now()).getTime() + TEXT_GAP_MS[1], now().getTime())
        : plannedMs + TEXT_GAP_MS[n];
      return dripSendTime(new Date(due)).toISOString();
    });
    plannedMs = Date.parse(planned);
    await step.sleepUntil(`wait-until-msg${n}`, new Date(planned));
  }

  await waitForText(1);
  if (await step.run("check-booked-1", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-wait-2h", task };
  }
  if (await step.run("check-replied-1", replied)) {
    return { done: true, exitedAt: "replied", task };
  }
  const msg1 = await step.run("send-nobook-1", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: trigger });
    return {
      sms: await sendOnce(cohortId, "sms", SMS_NOBOOK_01, "1"),
      email: await sendOnce(cohortId, "email", EMAIL_NOBOOK_01, "1e")
    };
  });

  await waitForText(2);
  if (await step.run("check-booked-2", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg1", task, msg1 };
  }
  if (await step.run("check-replied-2", replied)) {
    return { done: true, exitedAt: "replied", task, msg1 };
  }
  const msg2 = await step.run("send-nobook-2", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: trigger });
    return {
      sms: await sendOnce(cohortId, "sms", SMS_NOBOOK_02, "2"),
      email: await sendOnce(cohortId, "email", EMAIL_NOBOOK_02, "2e")
    };
  });

  await waitForText(3);
  if (await step.run("check-booked-3", () => hasBooked(db, clientId))) {
    return { done: true, exitedAt: "after-msg2", task, msg1, msg2 };
  }
  if (await step.run("check-replied-3", replied)) {
    return { done: true, exitedAt: "replied", task, msg1, msg2 };
  }
  const msg3 = await step.run("send-nobook-3", async () => {
    const cohortId = await messageCohortId(db, { eventId, orgId, clientId, name: trigger });
    return {
      sms: await sendOnce(cohortId, "sms", SMS_NOBOOK_03, "3"),
      email: await sendOnce(cohortId, "email", EMAIL_NOBOOK_03, "3e")
    };
  });

  return { done: true, exitedAt: "completed", task, msg1, msg2, msg3 };
}

export const sNobookChase = inngest.createFunction(
  { id: "s-nobook-chase", name: "S-NOBOOK — Never Booked Chase" },
  { event: TRIGGER_EVENT },
  ({ event, step }) => handle({ event: { ...event.data, name: event.name }, db, step })
);
