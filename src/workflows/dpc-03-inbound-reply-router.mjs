// DPC-03 — Inbound Reply Router (merges in DPC-04 — Decision Finalizer, AND the
// separate "DPC-04 — Reschedule Rebooking" workflow filed under the AS-Series
// heading in the map — same key, unrelated content: a 2-step SMS + tag reacting to
// the identical "reschedule" reply this file already parses).
// Source: the CRM system map DECISION & PROGRESS CONTROL section.
// DPC-04 (Decision Finalizer) reacts to the decision status DPC-03 sets, in the same
// request — no separate trigger event exists for "decision status changed", so it's
// the second half of this same handler rather than its own file.
//
// Trigger: message.inbound (exact canonical match). Parses the reply body for
// YES / CONFIRM / RESCHEDULE / CLOSE keywords (case-insensitive), sets cf_decision_status,
// and finalizes: YES -> task to send contract + collect payment, move to closed;
// RESCHEDULE -> real SMS with the booking link (real copy exists,
// Workflow-SMS-Stragglers.md) + task + setter:reschedule tag; CLOSE -> move to
// closed, remove nurture tags (matches DPC-04's original "Remove tag:
// nurture:cold,warm,hot" step).

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { mergeCustomFields } from "./custom-fields.mjs";
import { removeTags, addTags } from "./tags.mjs";
import { moveCardToStage } from "./cards.mjs";
import { sendTemplated } from "./messaging.mjs";
import { drainMessageNow } from "../messaging/outbox.mjs";
import { clientIdForRepPhone } from "../auth/authorized-rep.mjs";
import { createTask } from "../lib/create-task.mjs";

export const SMS_RESCHEDULE_TEMPLATE_KEY = "SMS-DPC04-RESCHEDULE-REBOOKING";
export const SMS_CONFIRM_ACK_TEMPLATE_KEY = "SMS-S04-CONFIRM-ACK";
const SOURCE_WORKFLOW = "dpc-03-inbound-reply-router";

// Non-creating lookup by phone — an inbound reply must only ever LINK to an
// existing client, never mint one (same rule src/handlers/comms.mjs follows for
// every inbound-message handler: could be spam).
async function findClientByPhone(db, orgId, phone) {
  if (!orgId || !phone) return null;
  const r = await db.query(`SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`, [orgId, phone]);
  if (r.rows[0]) return r.rows[0].id;
  return clientIdForRepPhone(db, orgId, phone);
}

function parseDecision(body) {
  const b = String(body || "").trim().toLowerCase();
  // "stop" is a telco opt-out keyword — must not be consumed here (handled at carrier
  // layer). YES / CONFIRM are disambiguated downstream by call state (doc 3576-3578), not here.
  if (/\byes\b/.test(b) || /\bconfirm\b/.test(b)) return "yes";
  if (/\breschedule\b/.test(b)) return "reschedule";
  // 05/30 doc line 3560 lists CLOSE as the only close-file keyword. The bare "no" was
  // invented by this port and is far too broad — "no thanks", "no worries", "not today"
  // all matched, closing the file and stripping nurture off an ordinary reply.
  if (/\bclose\b/.test(b)) return "close_file";
  return null;
}

// 05/30 doc 3576-3578 disambiguates YES by CALL STATE, not by a context flag: when
// cf_call_outcome is still "booked" a YES is a call confirmation, otherwise it is the
// purchase decision. The old gate read `dpc03_awaiting_decision`, a field NOTHING in the
// repo ever writes — so the YES purchase branch was permanently unreachable.
async function callState(db, clientId) {
  const r = await db.query(`SELECT custom_fields FROM clients WHERE id = $1`, [clientId]);
  const cf = r.rows[0]?.custom_fields || {};
  return { callOutcome: cf.call_outcome || null, hardStopped: Boolean(cf.hard_stop_reason) };
}

async function createTaskOnce(db, { orgId, clientId, eventId, title, source }) {
  const dup = await db.query(`SELECT 1 FROM tasks WHERE client_id = $1 AND source_workflow = $2 AND body = $3`, [clientId, source, eventId]);
  if (dup.rows[0]) return { created: false };
  await createTask(db, {
      orgId: orgId,
      clientId: clientId,
      title: title,
      sourceWorkflow: source,
      assigneeRole: "funding_advisor",
      eventId: eventId
    });
  return { created: true };
}

export async function handle({ event, db, step, drainNowImpl = drainMessageNow }) {
  const decision = parseDecision(event.payload?.body);
  if (!decision) return { done: false, reason: "no_decision_keyword" };

  const clientId = event.clientId || await step.run("resolve-client", () => findClientByPhone(db, event.orgId, event.payload?.from));
  if (!clientId) return { done: false, reason: "no_client" };

  const state = await step.run("check-call-state", () => callState(db, clientId));

  // Doc 179 + Part B 154: a hard-stopped contact is out of the pipeline. DPC-04's
  // contract+payment task was merged into this file without that gate, so a fraud or
  // collections contact could still trigger it off an SMS.
  if (state.hardStopped) return { done: false, reason: "hard_stopped" };

  // YES while the call is still booked is a CALL CONFIRMATION (doc 3576-3578), not a
  // purchase decision — confirm the appointment and stop, do not close the sale.
  if (decision === "yes" && state.callOutcome === "booked") {
    await step.run("set-call-confirmed", () => mergeCustomFields(db, clientId, {
      call_confirmed: true, last_progress_timestamp: new Date().toISOString()
    }));
    const booking = await step.run("read-confirmed-call-time", () => db.query(
      `SELECT starts_at FROM bookings
       WHERE org_id = $1 AND client_id = $2 AND status IN ('booked', 'rescheduled')
         AND starts_at > now()
       ORDER BY starts_at ASC LIMIT 1`,
      [event.orgId, clientId]
    ));
    const sms = await step.run("send-confirm-ack", () => sendTemplated(db, {
      orgId: event.orgId, clientId, channel: "sms",
      templateKey: SMS_CONFIRM_ACK_TEMPLATE_KEY, eventId: event.id,
      context: { appointment: { start_time: booking.rows[0]?.starts_at
        ? new Date(booking.rows[0].starts_at).toISOString()
        : "your Fundhub call" } }
    }));
    const delivery = await step.run("drain-confirm-ack", () =>
      drainNowImpl(db, sms.messageId, { orgId: event.orgId }));
    return { done: true, decision: "call_confirmed", sms, delivery };
  }

  const orgId = event.orgId;
  const eventId = event.id;
  await step.run("set-decision-status", () => mergeCustomFields(db, clientId, { decision_status: decision, last_progress_timestamp: new Date().toISOString() }));

  if (decision === "yes") {
    const task = await step.run("create-yes-task", () =>
      createTaskOnce(db, { orgId, clientId, eventId, title: "Yes — send contract + collect payment", source: SOURCE_WORKFLOW }));
    return { done: true, decision, task };
  }

  if (decision === "reschedule") {
    const task = await step.run("create-reschedule-task", () =>
      createTaskOnce(db, { orgId, clientId, eventId, title: "Reschedule — send booking link", source: SOURCE_WORKFLOW }));
    const sms = await step.run("send-reschedule-sms", () =>
      sendTemplated(db, { orgId, clientId, channel: "sms", templateKey: SMS_RESCHEDULE_TEMPLATE_KEY, eventId }));
    await step.run("tag-setter-reschedule", () => addTags(db, clientId, ["setter:reschedule"]));
    return { done: true, decision, task, sms };
  }

  // close_file
  const card = await step.run("move-to-closed-file", () => moveCardToStage(db, { orgId, clientId, pipelineKey: "sales", stageKey: "downsell" }));
  await step.run("clear-nurture-tags", () => removeTags(db, clientId, ["nurture:cold", "nurture:warm", "nurture:hot"]));
  return { done: true, decision, card };
}

export const dpc03InboundReplyRouter = inngest.createFunction(
  { id: "dpc-03-inbound-reply-router", name: "DPC-03 — Inbound Reply Router" },
  { event: "message.inbound" },
  ({ event, step }) => handle({ event: event.data, db, step })
);
