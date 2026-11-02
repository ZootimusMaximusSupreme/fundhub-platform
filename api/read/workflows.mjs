// GET /api/read/workflows — the real workflow registry, all 53.
//
// The registry is CODE, not a database table: every workflow is an
// inngest.createFunction() export in src/workflows/*.mjs, collected in
// src/workflows/index.mjs's `functions` array. This endpoint introspects those
// live function objects (f.opts.id / f.opts.name / f.opts.triggers) rather than
// hand-maintaining a parallel list — the two drifting apart is exactly the bug
// automations.html had before this endpoint existed.
//
// WHAT THIS ENDPOINT CAN AND CANNOT SEE. Read this before adding a field.
//
// It CAN see three things, all of them real:
//   1. the registry itself, by introspection, with no database at all;
//   2. whether a row has ever landed in the org-scoped `events` table for a
//      workflow's trigger event — src/events/bus.mjs's emit() appends there
//      before it does anything else, so "has this trigger ever been recorded"
//      is answerable;
//   3. whether the environment variable that gates a given emitter is set,
//      which is the only thing an env-var check has ever been able to prove.
//
// It CANNOT see whether any workflow ever RAN. There is no run record in this
// query, because there is no run record in this database: Inngest keeps run
// history on its own side and nothing in this repo mirrors it back. Every row
// therefore carries run_records_available:false, and the screen says so out
// loud. If run history is ever mirrored into Postgres, that flag is the hook.
//
// THREE THINGS THIS FILE USED TO CLAIM, ALL OF THEM WRONG. Recorded because
// each one was on the owner's screen, in confident wording, for months.
//
//   (a) `engine_active = Boolean(process.env.INNGEST_EVENT_KEY)`, stamped on
//       every row. That variable is a SEND key. Its presence proves a key
//       exists and nothing else — not that Inngest accepted an event, not that
//       a function was invoked. The field is gone. Nothing replaced it,
//       because there was nothing honest to replace it with from here.
//
//   (b) status "live" for any workflow whose trigger event had a row in
//       `events`. "The trigger fired" and "the workflow ran" are different
//       facts and that status conflated them. Proof it mattered: on
//       2026-08-18 five events had zero rows ever (deposit.paid,
//       inquiry.removed, message.inbound, mail.response, docs.received);
//       auditors fired those five as a test and the owner's screen moved from
//       44 "live" to 49 "live". Nothing ran. The number went up because
//       somebody poked it. The status is now "trigger_seen", named so that it
//       cannot be read as "it worked".
//
//   (c) status "never_triggered" for the cron-only jobs. A clock job does not
//       write an event row — that is how clock jobs work, not a fault — so
//       contract-chaser and message-dispatch-sweeper were permanently labelled
//       dead while working normally. Cron-only workflows are now "scheduled"
//       and report their timetable. This was audit item T6-04.
//
// The old header also said none of the 47 functions had ever run because
// INNGEST_EVENT_KEY was unset. Both halves are now false: there are 53
// functions, and INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY are both set on
// production (verified by name, 2026-08-19). Inngest has demonstrably executed
// function bodies. What is still UNPROVEN is whether events emitted by
// production reach Inngest at all — the event stream for the 2026-08-18
// 21:43-21:52 window carried none of the events this app emits. Do not let a
// future edit turn "we cannot see it from here" back into a green tick.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { readHandler, ROLE_SETS } from "../../src/http/read-api.mjs";
import { functions as workflowFunctions } from "../../src/workflows/index.mjs";

/* When a human last walked the emitters below and checked them against the
   code and the live row counts. The manifest is hand-maintained, so this date
   is the honest shelf-life marker on it. */
export const EMITTER_MANIFEST_VERIFIED_ON = "2026-08-22";

/* EVENT_EMITTERS — what actually causes each trigger event to be emitted.
//
// WHY THIS IS HAND-MAINTAINED AND NOT GREPPED. A grep-based guard would be
// confidently wrong. Almost no real emitter has the event-name literal on its
// emit() line: every webhook adapter calls emit(db, c.name, ...) where c.name
// came out of a mapToCanonical table one to three hundred lines earlier, and
// src/funding/card-stacking-rounds.mjs calls emit(db, eventName, ...) with the
// name computed from the stage. Grepping for emit(db, "round.funded" finds
// NOTHING, so a grep guard would report four working funding events as having
// no emitter. A stale hand-written map is a smaller lie than an automated one
// that is wrong by construction.
//
// What keeps it from going stale instead: src/workflows/index.test.mjs asserts
// every event any registered workflow triggers on has an entry here. Register a
// workflow listening to a new event and that test fails until somebody writes
// down how the event gets emitted.
//
// Shape: event name -> { emitters: [{ how, gate }], note }
//   how   — a plain sentence naming the code path, for a reader who does not
//           read code.
//   gate  — the environment variable that must be set for that path to work,
//           or null when the path has no gate at all. The gate's state is read
//           live from process.env at request time; it is NOT recorded here,
//           because a recorded copy of a live value is a lie with a delay.
//   note  — optional. A fact about the live rows that a reader would otherwise
//           guess wrong.
//
// An event with an empty `emitters` array means nothing in production code can
// ever emit it. That is a real finding, not a gap in this table — say it in the
// note when it happens. As of the verification date above, no event is in that
// state. */
export const EVENT_EMITTERS = {
  "entry.captured": {
    emitters: [
      { how: "The public survey form on the website posts it (api/public/survey-submit.mjs). No sign-in, no secret, anyone can trigger it.", gate: null },
      { how: "The ClickFunnels order webhook.", gate: "CLICKFUNNELS_WEBHOOK_SECRET" }
    ],
    note: "Busiest event on the system: 400 rows on file as of the verification date."
  },
  "survey.completed": {
    emitters: [
      { how: "The public survey form on the website posts it (api/public/survey-submit.mjs), in the same request as survey.submitted, once the last answer is in.", gate: null },
      { how: "The ClickFunnels order webhook, on the post that carries the last survey answer (cf_svy_available_capital).", gate: "CLICKFUNNELS_WEBHOOK_SECRET" }
    ],
    note: "Once per finished survey. Starts the never-booked chase (S-NOBOOK). survey.submitted fires after every answered screen and no longer starts a workflow (owner-set 2026-10-31)."
  },
  "analysis.completed": {
    emitters: [
      { how: "A staff member pulls a credit report on the funding desk (src/finance/crs-pull.mjs).", gate: null }
    ],
    note: "9 rows on file. Staff-driven only; nothing pulls a report on a schedule."
  },
  "booking.created": {
    emitters: [
      { how: "The ClickFunnels webhook, when the funnel books the call itself.", gate: "CLICKFUNNELS_WEBHOOK_SECRET" }
    ],
    note: "Live book page is ClickFunnels. Cal.com was removed 2026-08-23."
  },
  "booking.rescheduled": {
    emitters: [
      { how: "The ClickFunnels webhook, when the booked slot is moved.", gate: "CLICKFUNNELS_WEBHOOK_SECRET" }
    ],
    note: "Cancels in-flight S-04B and BS-01 runs and restarts them on the new start time."
  },
  "booking.noshow": {
    emitters: [
      { how: "dpc-02 marks a no-show 5 minutes after the appointment ends, then emits this.", gate: null }
    ],
    note: "Cal.com used to be the only emitter. It was removed 2026-08-23."
  },
  "call.completed": {
    emitters: [
      { how: "The Bland voice webhook, after a call finishes.", gate: "BLAND_WEBHOOK_SECRET" },
      { how: "A closer saves a call outcome (src/sales/call-outcomes.mjs). No secret gates this.", gate: null }
    ],
    note: "Closer payloads use disposition: \"closer\" so the no-answer SMS cadence does not fire."
  },
  "setter.no_answer": {
    emitters: [
      { how: "A setter saves \"No answer\" on the setter desk (src/setter/dashboard.mjs). Sent once per lead per Arizona day; a second dial the same day starts no second cadence.", gate: null }
    ],
    note: "Starts AI-SET-03, the no-answer text cadence. New 2026-10-31, so no rows on file before then."
  },
  "diagnostic.paid": {
    emitters: [
      { how: "The Commas payment webhook.", gate: "COMMAS_WEBHOOK_SECRET" }
    ],
    note: "3 rows on file."
  },
  "slo.contact_started": {
    emitters: [
      { how: "The /roadmap step-1 door (api/public/slo-interest.mjs) when someone leaves name and email (phone optional). Fans out to Inngest for the genuine unpaid follow-up.", gate: null }
    ],
    note: "Non-canonical allowNonCanonical event. Visits and engage stay skipInngest."
  },
  "slo.checkout_started": {
    emitters: [
      { how: "The /roadmap $297 till (api/public/slo-checkout.mjs) when someone starts checkout. Fans out so an unpaid M1 SMS can catch up if a phone just landed.", gate: null }
    ],
    note: "Non-canonical allowNonCanonical event."
  },
  "payment.received": {
    emitters: [
      { how: "The Commas payment webhook.", gate: "COMMAS_WEBHOOK_SECRET" }
    ],
    note: "4 rows on file."
  },
  "deposit.paid": {
    emitters: [
      { how: "The Commas payment webhook.", gate: "COMMAS_WEBHOOK_SECRET" }
    ],
    note: "Zero rows ever. The same webhook has delivered other payment events, so this means nobody has bought the deposit product yet — not that the plumbing is broken."
  },
  "mail.response": {
    emitters: [
      { how: "The Mailgun inbound-email webhook, when a bank replies by email.", gate: "MAILGUN_SIGNING_KEY" }
    ],
    note: "This is the only way into the whole bank-email funding branch. Nothing else opens that door."
  },
  "message.inbound": {
    emitters: [
      { how: "The Twilio webhook, when someone texts in.", gate: "TWILIO_AUTH_TOKEN" },
      { how: "The Mailgun inbound-email webhook, when someone emails in.", gate: "MAILGUN_SIGNING_KEY" }
    ],
    note: null
  },
  "docs.received": {
    emitters: [
      { how: "A staff member or the client uploads a document (api/documents-upload.mjs). No secret gates this at all.", gate: null },
      { how: "An inbound text with a photo attachment (src/handlers/inbound-mms-docs.mjs).", gate: "TWILIO_AUTH_TOKEN" }
    ],
    note: null
  },
  "inquiry.removed": {
    emitters: [
      { how: "A specialist clears an inquiry on the removal desk (src/inquiries/work.mjs).", gate: null },
      { how: "The inquiry-removal webhook from the specialist runtime.", gate: "INQUIRY_REMOVAL_WEBHOOK_SECRET" }
    ],
    note: null
  },
  "round.started": {
    emitters: [
      { how: "The Lendflow decision webhook.", gate: "LENDFLOW_WEBHOOK_SECRET" },
      { how: "A staff member drags a card on the funding board (src/funding/card-stacking-rounds.mjs, through src/workflows/cards.mjs). No secret gates this.", gate: null }
    ],
    note: "Every funding-round row on file came from a staff drag, not from Lendflow."
  },
  "round.submitted": {
    emitters: [
      { how: "The Lendflow decision webhook.", gate: "LENDFLOW_WEBHOOK_SECRET" },
      { how: "A staff member drags a card on the funding board (src/funding/card-stacking-rounds.mjs, through src/workflows/cards.mjs). No secret gates this.", gate: null }
    ],
    note: "Every funding-round row on file came from a staff drag, not from Lendflow."
  },
  "round.approved": {
    emitters: [
      { how: "The Lendflow decision webhook.", gate: "LENDFLOW_WEBHOOK_SECRET" },
      { how: "A staff member drags a card on the funding board (src/funding/card-stacking-rounds.mjs, through src/workflows/cards.mjs). No secret gates this.", gate: null }
    ],
    note: "Every funding-round row on file came from a staff drag, not from Lendflow."
  },
  "round.funded": {
    emitters: [
      { how: "The Lendflow decision webhook.", gate: "LENDFLOW_WEBHOOK_SECRET" },
      { how: "A staff member drags a card on the funding board (src/funding/card-stacking-rounds.mjs, through src/workflows/cards.mjs). No secret gates this.", gate: null }
    ],
    note: "Every funding-round row on file came from a staff drag, not from Lendflow."
  },
  "round.closeout": {
    emitters: [
      { how: "A staff member drags the funding card to Closed (src/funding/card-stacking-rounds.mjs, through src/workflows/cards.mjs). No secret gates this.", gate: null },
      { how: "The money chain, after a round is funded and the closeout row is written (src/handlers/money-chain.mjs). N-04 ignores this shape.", gate: null }
    ],
    note: "N-04 only sends when the payload says the engagement is complete (Closed column)."
  },
  "invoice.sent": {
    emitters: [
      { how: "F-07 marks the success-fee invoice sent after a round is funded (src/workflows/f-07-funding-locked.mjs).", gate: null }
    ],
    note: "AR collections listen only for funding success-fee invoices."
  }
};

/* The one sentence this endpoint most needs a reader to take away. Sent on the
   response envelope so the screen cannot forget to say it. */
export const RUN_RECORDS_NOTE =
  "This endpoint can see what STARTS a workflow. It cannot see whether the workflow finished, " +
  "because run history lives inside Inngest and nothing copies it back into this database.";

/* categoryOf — the code family a workflow id belongs to, derived from the id
   itself (the leading letters before its first numbered segment), not from a
   hand-authored label. "af-02-referral-ownership-capture" -> "AF",
   "ai-set-03-no-answer-cadence" -> "AI-SET". An id with no numbered segment
   (e.g. "round-started-client-notify") has no family and falls to "OTHER". */
export function categoryOf(id) {
  const parts = String(id || "").split("-");
  const idx = parts.findIndex((p) => /^[0-9]/.test(p));
  if (idx <= 0) return "OTHER";
  return parts.slice(0, idx).join("-").toUpperCase();
}

/* cronInPlainWords — a five-field cron turned into a sentence the owner can
   read. Only the two shapes this repo actually uses are translated; anything
   else falls back to the raw expression rather than being guessed at, because
   a wrong schedule in confident English is worse than a correct one in cron. */
export function cronInPlainWords(expr) {
  const s = String(expr || "").trim();
  let m = /^\*\/(\d+) \* \* \* \*$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return n === 1 ? "every minute" : `every ${n} minutes`;
  }
  m = /^(\d+) (\d+) \* \* \*$/.exec(s);
  if (m) {
    const hh = String(Number(m[2])).padStart(2, "0");
    const mm = String(Number(m[1])).padStart(2, "0");
    return `once a day at ${hh}:${mm} UTC`;
  }
  return s;
}

/* gateOpen — is the environment variable that guards an emitter actually set?
   This is the ONE question an env-var check can answer, and the only reason
   process.env is read in this file at all. Compare it with what (a) in the
   header used to do: that read a key's presence and reported it as "the engine
   is on". This reads a key's presence and reports it as "this key is present".
   An empty string counts as unset, because a blank secret verifies nothing. */
function gateOpen(gate, env) {
  if (!gate) return true; // no gate at all — the path is open to anyone
  const v = env[gate];
  return typeof v === "string" && v.trim().length > 0;
}

/* emitterFacts — for one workflow's list of trigger events, everything the
   manifest plus the live environment can say about how it could start.
   `known` is false for an event with no manifest entry; that state should be
   unreachable because src/workflows/index.test.mjs fails on it, but this
   endpoint must not crash if somebody ships past the test. */
function emitterFacts(events, env) {
  const rows = [];
  for (const ev of events) {
    const entry = EVENT_EMITTERS[ev];
    if (!entry) {
      rows.push({ event: ev, known: false, how: null, gate: null, gate_set: null, note: null });
      continue;
    }
    if (!entry.emitters.length) {
      rows.push({ event: ev, known: true, how: null, gate: null, gate_set: null, note: entry.note || null });
      continue;
    }
    for (const em of entry.emitters) {
      rows.push({
        event: ev,
        known: true,
        how: em.how,
        gate: em.gate || null,
        gate_set: em.gate ? gateOpen(em.gate, env) : null,
        note: entry.note || null
      });
    }
  }
  return rows;
}

/* registryRows — the registered functions, shaped for the screen. No database.
//
// PAGINATION IS HONOURED HERE NOW. readHandler resolves ?limit= and ?offset=
// and hands them to fetch(), and this function used to ignore both and return
// everything: automations.html asks for ?limit=200 and was silently getting an
// unbounded list. Harmless at 53 rows and wrong the moment anyone trusts it.
// The +1 is the repo-wide convention — every list endpoint asks for one row
// more than requested so page() in src/http/read-api.mjs can set hasMore
// without a second count query.
//
// Called with no arguments it still returns every row, so anything importing it
// for the whole registry keeps working. */
export function registryRows({ limit, offset = 0 } = {}) {
  const all = workflowFunctions
    .map((fn) => {
      const id = fn.opts && fn.opts.id;
      const name = fn.opts && fn.opts.name;
      const triggers = (fn.opts && fn.opts.triggers) || [];
      return {
        id,
        name,
        category: categoryOf(id),
        events: triggers.map((t) => t.event).filter(Boolean),
        crons: triggers.map((t) => t.cron).filter(Boolean)
      };
    })
    .filter((r) => r.id)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (!Number.isFinite(limit)) return all;
  const from = Number.isFinite(offset) && offset > 0 ? offset : 0;
  return all.slice(from, from + limit + 1);
}

async function lastTriggeredByEvent(db, { orgId, eventNames }) {
  if (!orgId || !eventNames.length) return {};
  const r = await db.query(
    `SELECT name, max(created_at) AS last_at
       FROM events
      WHERE org_id = $1 AND name = ANY($2::text[])
      GROUP BY name`,
    [orgId, eventNames]
  );
  const out = {};
  for (const row of r.rows) out[row.name] = row.last_at;
  return out;
}

/* statusOf — the honest four. Every value here is a different fact, and none of
   them means "it worked", because this endpoint cannot establish that.
     scheduled          — cron only. Inngest's own clock starts it. It writes no
                          event row, so asking when its trigger last fired is a
                          category error. This is the T6-04 fix.
     no_emitter         — the manifest says nothing in production code emits any
                          of its events, so it can never start.
     trigger_seen       — an event row exists. NOT proof the workflow ran.
     trigger_never_seen — an emitter exists but no event row has ever landed. */
export function statusOf({ events, crons, emitters, lastTriggeredAt }) {
  /* No events at all: either a clock job, or a workflow with no declared
     trigger whatsoever, which nothing can ever start. */
  if (!events.length) return crons.length ? "scheduled" : "no_emitter";
  /* An event NOBODY HAS WRITTEN DOWN is not an event nothing emits. Conflating
     those two is the exact fault this endpoint was rewritten to remove, and it
     would have been reintroduced here: an unmanifested event has no emitter
     with a `how`, so it fell through to "no_emitter" and the screen told the
     owner the absolute "nothing in the code emits this". src/workflows/
     index.test.mjs makes this state unreachable by failing on it, but an
     endpoint must not lie on the day somebody ships past a test. */
  if (emitters.some((e) => e.known === false)) return "emitter_unknown";
  if (!emitters.some((e) => e.how)) return "no_emitter";
  return lastTriggeredAt ? "trigger_seen" : "trigger_never_seen";
}

const run = readHandler({
  roles: ROLE_SETS.STAFF,
  fetch: async (db, { staff, limit, offset }) => {
    const rows = registryRows({ limit, offset });
    const orgId = (staff && staff.org_id) || null;
    const allEvents = [...new Set(rows.flatMap((r) => r.events))];
    const env = process.env;

    let lastByEvent = {};
    try {
      lastByEvent = await lastTriggeredByEvent(db, { orgId, eventNames: allEvents });
    } catch (_) {
      // The registry does not need a database; a query failure here must not
      // take the whole endpoint down with it. Rows fall back to null below.
      lastByEvent = {};
    }

    return rows.map((r) => {
      const lastTriggeredAt = r.events.reduce((latest, ev) => {
        const at = lastByEvent[ev];
        if (!at) return latest;
        return !latest || new Date(at) > new Date(latest) ? at : latest;
      }, null);

      const emitters = emitterFacts(r.events, env);
      const status = statusOf({ events: r.events, crons: r.crons, emitters, lastTriggeredAt });

      /* canStartToday — is there at least one live way in? An emitter with no
         gate is always a way in; a gated one counts only while its variable is
         set. Cron-only workflows get null rather than true: their clock is
         Inngest's, and this endpoint cannot see Inngest. */
      let canStartToday = null;
      let blockedReason = null;
      if (!r.events.length && !r.crons.length) {
        canStartToday = false;
        blockedReason = "This workflow declares no trigger at all, so nothing can ever start it.";
      } else if (r.events.length) {
        const open = emitters.filter((e) => e.how && e.gate_set !== false);
        canStartToday = open.length > 0;
        if (!canStartToday) {
          const missing = [...new Set(emitters.map((e) => e.gate).filter(Boolean))];
          const unknown = emitters.filter((e) => e.known === false).map((e) => e.event);
          blockedReason = unknown.length
            ? `Nobody has recorded how ${unknown.join(" or ")} gets sent, so this screen ` +
              `cannot say whether this job can start. That is a gap in our notes, not proof it is broken.`
            : missing.length
              ? `Nothing can start this right now. Every way in is switched off: ` +
                `${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.`
              : "Nothing in the code emits this workflow's trigger, so it can never start.";
        }
      }

      return {
        id: r.id,
        name: r.name,
        category: r.category,
        events: r.events,
        crons: r.crons,
        status,
        last_triggered_at: lastTriggeredAt,
        schedule_plain: r.crons.length ? r.crons.map(cronInPlainWords).join(", ") : null,
        can_start_today: canStartToday,
        blocked_reason: blockedReason,
        emitters,
        /* Always false, on every row, on purpose. There is no run record in
           this database to read. The day one exists, flip this — and not
           before. */
        run_records_available: false,
        run_records_note: RUN_RECORDS_NOTE,
        emitters_verified_on: EMITTER_MANIFEST_VERIFIED_ON
      };
    });
  }
});

export default (req, res) => run(req, res, { db, requireAuth });
