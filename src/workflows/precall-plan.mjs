import { createHash } from "node:crypto";
import { on } from "../events/registry.mjs";
import { creditTierFor } from "../config/survey-qualification.mjs";
import { dripSendTime } from "../messaging/send-window.mjs";
import { callHeldFor } from "./dpc-02-call-outcome-enforcement.mjs";
import { DECK_SLOTS, DECK_TITLES, DECK_INTROS, deckTime } from "./precall-decks.mjs";
import { sendTemplated } from "./messaging.mjs";

const HOUR = 3_600_000;
export const PRECALL_CHANNELS = Object.freeze(["email", "sms"]);
export const PRECALL_SLOTS = Object.freeze(DECK_SLOTS.map(slot => [slot.funding, slot.blueprint]));
export const precallLessonsEnabled = (env = process.env) => env.BS_DECK_LESSONS_ENABLED === "true";
export const precallPlannerEnabled = (env = process.env) => precallLessonsEnabled(env)
  && env.BS_PRECALL_PLANNER_ENABLED === "true";
export async function precallTemplatesReady(db, orgId) {
  for (const key of ["EMAIL-BS-DECK-LESSON", "SMS-BS-DECK"]) {
    const row = (await db.query("SELECT body, subject, compliance_passed FROM message_templates WHERE org_id = $1 AND template_key = $2 LIMIT 1", [orgId,key])).rows[0];
    if (!row?.compliance_passed || !String(row.body || "").trim()
      || (key.startsWith("EMAIL") && !String(row.subject || "").trim())
      || /\[DRAFT/i.test(row.body)) return false;
  }
  return true;
}

export function deckFor(slot, lane) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= PRECALL_SLOTS.length) return null;
  return PRECALL_SLOTS[slot][lane === "qualified" ? 0 : 1];
}

export function buildPrecallSchedule({ phase, startTime, now = new Date(), lane }) {
  if (!lane || !["booked", "prebooking"].includes(phase)) return [];
  const anchor = new Date(startTime || now).getTime();
  if (!Number.isFinite(anchor)) return [];
  if (phase === "prebooking") {
    const slugs = lane === "qualified"
      ? ["the-call", "pre-underwriting", "funding-sequence", "who-we-are"]
      : ["the-call", "bank-said-no", "thirteen-points", "who-we-are"];
    return slugs.map((slug, day) => {
      const slot = DECK_SLOTS.findIndex(s => s[lane === "qualified" ? "funding" : "blueprint"] === slug);
      return { slot, channel: DECK_SLOTS[slot].channel, deckSlug: slug,
        dueAt: dripSendTime(new Date(anchor + (day + 1) * 24 * HOUR)) };
    });
  }
  return DECK_SLOTS.flatMap((slot, i) => {
    const slug = deckFor(i, lane);
    const at = deckTime(startTime, i);
    if (!slug || !at || at - new Date(now) < HOUR || at.getTime() >= anchor
      || [48,24,2].some(lead => Math.abs(at.getTime() - (anchor - lead * HOUR)) < HOUR)) return [];
    return [{ slot: i, channel: slot.channel, deckSlug: slug, dueAt: at }];
  });
}

export async function clientLane(db, clientId, orgId) {
  if (!orgId) throw new TypeError("orgId is required");
  const result = await db.query("SELECT custom_fields FROM clients WHERE id = $1 AND org_id = $2", [clientId, orgId]);
  return creditTierFor(result.rows[0]?.custom_fields || {});
}

export async function cancelPrecall(db, { orgId, clientId, reason = "replanned", exceptEventId = null }) {
  if (!orgId || !clientId) throw new Error("orgId and clientId are required");
  const result = await db.query(
    `UPDATE precall_send_plans SET status = 'cancelled', reason = $3, updated_at = now()
      WHERE org_id = $1 AND client_id = $2 AND status IN ('planned', 'blocked', 'claimed', 'queued')
        AND ($4::text IS NULL OR source_event_id <> $4) RETURNING id`,
    [orgId, clientId, reason, exceptEventId]
  );
  // A lesson can already be in the outbound queue while the setter corrects
  // the lane or the booking moves. Block only still-queued rows for these plan
  // ids; dispatched history remains intact.
  if (result.rows.length) await db.query(
    `UPDATE messages m SET status = 'blocked', blocked_reason = 'precall_cancelled',
       blocked_at = now(), updated_at = now()
      WHERE m.org_id = $1 AND m.client_id = $2 AND m.status = 'queued'
        AND EXISTS (SELECT 1 FROM precall_send_plans p
          WHERE p.id = ANY($3::uuid[]) AND m.provider_ref LIKE '%:precall-plan:' || p.id::text)`,
    [orgId, clientId, result.rows.map((row) => row.id)]
  );
  return result.rows.length;
}

// Called when a survey finishes, a call is booked or moved, or a setter corrects
// the score. Sent/queued rows remain audit history and are never regenerated.
export async function planPrecall(db, {
  orgId, clientId, eventId, phase, startTime, bookingEventId = null,
  bookingUid = null, now = new Date()
}) {
  if (!orgId || !clientId || !eventId) throw new Error("orgId, clientId and eventId are required");
  const lane = await clientLane(db, clientId, orgId);
  await cancelPrecall(db, { orgId, clientId, reason: "new_plan", exceptEventId: eventId });
  const rows = buildPrecallSchedule({ phase, startTime, now, lane });
  for (const row of rows) {
    await db.query(
      `INSERT INTO precall_send_plans
        (org_id, client_id, source_event_id, booking_event_id, booking_uid, phase, slot, channel, deck_slug, due_at, call_start_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (org_id, client_id, source_event_id, slot) DO UPDATE SET
         deck_slug = EXCLUDED.deck_slug, due_at = EXCLUDED.due_at,
         status = 'planned', reason = NULL, retry_after = NULL, updated_at = now()
       WHERE precall_send_plans.status IN ('planned', 'blocked')`,
      [orgId, clientId, eventId, bookingEventId || (phase === "booked" ? eventId : null), bookingUid, phase, row.slot, row.channel,
        row.deckSlug, row.dueAt, phase === "booked" ? new Date(startTime) : null]
    );
  }
  return { lane, planned: rows.length };
}

async function claimDue(db, now, limit) {
  const result = await db.query(
    `WITH due AS (
       SELECT id FROM precall_send_plans
        WHERE (status = 'planned' AND due_at <= $1)
           OR (status = 'blocked' AND retry_after <= $1)
           OR (status = 'claimed' AND claimed_at < $1::timestamptz - interval '10 minutes')
        ORDER BY due_at, id LIMIT $2 FOR UPDATE SKIP LOCKED
     )
     UPDATE precall_send_plans p SET status = 'claimed', claimed_at = $1, updated_at = $1
       FROM due WHERE p.id = due.id
     RETURNING p.*`, [now, limit]
  );
  return result.rows;
}

async function finishRow(db, id, status, reason = null) {
  await db.query(
    `UPDATE precall_send_plans SET status = $2, reason = $3,
       queued_at = CASE WHEN $2 = 'queued' THEN now() ELSE queued_at END,
       retry_after = CASE WHEN $2 = 'blocked' THEN now() + interval '1 hour' ELSE NULL END,
       updated_at = now() WHERE id = $1 AND status = 'claimed'`,
    [id, status, reason]
  );
}

async function claimStillCurrent(db, row) {
  const result = await db.query(
    `SELECT 1 FROM precall_send_plans
      WHERE id = $1 AND status = 'claimed' AND source_event_id = $2 LIMIT 1`,
    [row.id, row.source_event_id]
  );
  return result.rows.length === 1;
}

export async function claimPushOnce(db, { planId, orgId }) {
  const result = await db.query(
    `INSERT INTO precall_push_receipts (plan_id, org_id, status)
      VALUES ($1,$2,'sending') ON CONFLICT (plan_id) DO NOTHING RETURNING plan_id`,
    [planId, orgId]
  );
  return result.rows.length === 1;
}

export async function finishPush(db, { planId, sent, error = null }) {
  await db.query(
    `UPDATE precall_push_receipts SET status = $2, finished_at = now(), error = $3
      WHERE plan_id = $1 AND status = 'sending'`,
    [planId, sent ? "sent" : "failed", error]
  );
}

async function stopReason(db, row, now) {
  if (row.call_start_at && new Date(now) >= new Date(row.call_start_at)) return "call_started";
  if (row.phase === "booked") {
    const current = (await db.query("SELECT status, starts_at, provider_uid FROM bookings WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 1", [row.org_id,row.client_id])).rows[0];
    if (!["booked","rescheduled"].includes(current?.status)
      || (row.booking_uid && current.provider_uid !== row.booking_uid)
      || new Date(current.starts_at).getTime() !== new Date(row.call_start_at).getTime()) return "booking_changed";
  }
  if (row.phase === "booked" && await callHeldFor(db, row.client_id, row.booking_event_id)) return "call_held";
  const paid = await db.query(
    `SELECT 1 FROM events WHERE org_id = $1 AND client_id = $2
       AND name IN ('deposit.paid', 'sale.closed', 'payment.received')
       AND created_at >= $3 LIMIT 1`,
    [row.org_id, row.client_id, row.created_at]
  );
  if (paid.rows.length) return "paid";
  const later = await db.query(
    `SELECT name FROM events WHERE org_id = $1 AND client_id = $2
       AND name IN ('booking.created', 'booking.rescheduled', 'booking.cancelled')
       AND created_at > $3
       AND ($4::text IS NULL OR COALESCE(payload->>'bookingUid', payload->>'booking_uid') = $4)
       ORDER BY created_at DESC LIMIT 1`,
    [row.org_id, row.client_id, row.created_at, row.booking_uid]
  );
  if (row.phase === "prebooking" && later.rows.length) return "booked";
  if (row.phase === "booked" && later.rows[0]?.name === "booking.created") return "new_booking";
  if (row.phase === "booked" && later.rows[0]?.name === "booking.cancelled") return "cancelled";
  if (row.phase === "booked" && later.rows[0]?.name === "booking.rescheduled") return "rescheduled";
  return null;
}

// The outbound dispatcher calls this immediately before provider routing. It
// closes the gap between a lesson being queued and a call move or lane change.
export async function durableOwnsBooking(db, {orgId,clientId,bookingUid,startTime}, {enabled=precallPlannerEnabled()}={}) {
  if (!enabled) return false;
  return (await db.query(`SELECT 1 FROM precall_send_plans WHERE org_id=$1 AND client_id=$2
    AND phase='booked' AND call_start_at=$3 AND ($4::text IS NULL OR booking_uid=$4) LIMIT 1`,
    [orgId,clientId,startTime,bookingUid || null])).rows.length>0;
}
export async function precallDispatchReason(db, message, now = new Date(), { enabled = precallLessonsEnabled(), durable = precallPlannerEnabled() } = {}) {
  const isDeck = ["EMAIL-BS-DECK-LESSON", "SMS-BS-DECK"].includes(message.template_key)
    || /^BS-DECK-/.test(String(message.template_key || ""));
  if (isDeck && !enabled) return "precall_lessons_disabled";
  if (isDeck && !await precallTemplatesReady(db,message.org_id)) return "precall_template_unapproved";
  const match = /:precall-plan:([0-9a-f-]{36})$/i.exec(String(message.provider_ref || ""));
  if (!match) return isDeck && durable ? "precall_legacy_plan" : null;
  if (!durable) return "precall_planner_disabled";
  const result = await db.query(
    `SELECT * FROM precall_send_plans WHERE id = $1 AND org_id = $2 AND client_id = $3 LIMIT 1`,
    [match[1], message.org_id, message.client_id]
  );
  const row = result.rows[0];
  if (!row || row.status !== "queued") return "precall_plan_inactive";
  const stop = await stopReason(db, row, now);
  if (stop) return `precall_${stop}`;
  const lane = await clientLane(db, row.client_id, row.org_id);
  const slug = lane && deckFor(Number(row.slot), lane);
  const expected = message.channel === "sms" ? "SMS-BS-DECK" : "EMAIL-BS-DECK-LESSON";
  if (slug) {
    const legacy = await db.query(`SELECT 1 FROM messages WHERE org_id=$1 AND client_id=$2
      AND template_key=$3 AND provider_ref=$4 AND status IN ('sending','sent') LIMIT 1`,
      [row.org_id,row.client_id,expected,`workflow:${expected}:bs-deck:${row.client_id}:${slug}`]);
    if (legacy.rows.length) return "precall_legacy_inflight_or_sent";
  }
  return slug && message.template_key === expected && String(message.rendered_body || "").includes(`/slideshows/${slug}.html`)
    ? null : "precall_lane_changed";
}

export async function sweepPrecall(db, { now = new Date(), limit = 50,
  enabled = precallPlannerEnabled(), send = sendTemplated } = {}) {
  if (!enabled) return { ok: true, claimed: 0, queued: 0, skipped: 0, blocked: 0, reason: "deck_lessons_disabled" };
  const rows = await claimDue(db, now, limit);
  const counts = { ok: true, claimed: rows.length, queued: 0, skipped: 0, blocked: 0 };
  for (const row of rows) {
    try {
      const stop = await stopReason(db, row, now);
      if (stop) { await finishRow(db, row.id, "skipped", stop); counts.skipped++; continue; }
      const lane = await clientLane(db, row.client_id, row.org_id);
      if (!lane) { await finishRow(db, row.id, "blocked", "no_score_lane"); counts.blocked++; continue; }
      // A setter correction or reschedule may have cancelled this row while
      // the sweep was checking the person's current state.
      if (!await claimStillCurrent(db, row)) { counts.skipped++; continue; }
      if (!await precallTemplatesReady(db,row.org_id)) {
        await finishRow(db,row.id,"blocked","template_pending");counts.blocked++;continue;
      }
      const slug = deckFor(Number(row.slot), lane);
      const url = `https://fundhub.ai/slideshows/${slug}.html`;
      let sent;
      if (!PRECALL_CHANNELS.includes(row.channel)) {
        await finishRow(db,row.id,"blocked","unsupported_channel");counts.blocked++;continue;
      }
      if (!DECK_TITLES[slug] || !DECK_INTROS[slug]) {
        await finishRow(db,row.id,"blocked","lesson_copy_missing");counts.blocked++;continue;
      }
      sent = await send(db, { orgId: row.org_id, clientId: row.client_id,
        channel: row.channel, templateKey: row.channel === "sms" ? "SMS-BS-DECK" : "EMAIL-BS-DECK-LESSON",
        eventId: `precall-plan:${row.id}`, context: { deck_title: DECK_TITLES[slug],
          deck_intro: DECK_INTROS[slug], deck_url: url } });
      if (sent?.sent) { await finishRow(db, row.id, "queued"); counts.queued++; }
      else { await finishRow(db, row.id, "blocked", sent?.reason || "template_pending"); counts.blocked++; }
    } catch (error) {
      await finishRow(db, row.id, "blocked", String(error?.message || error).slice(0, 200));
      counts.blocked++;
    }
  }
  return counts;
}


async function latestBooking(db, orgId, clientId) {
  return (await db.query("SELECT id, status, starts_at, provider_uid, raw FROM bookings WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC LIMIT 1",[orgId,clientId])).rows[0] || null;
}
export async function planForBooking(db, input, {enabled = precallPlannerEnabled(), now = new Date()} = {}) {
  if (!enabled) return {owned:false,reason:"deck_lessons_disabled"};
  const {orgId,clientId,eventId,startTime,bookingUid=null}=input;
  if (!orgId || !clientId || !eventId) return {owned:false,reason:"missing_scope"};
  if (!await precallTemplatesReady(db,orgId)) return {owned:false,reason:"deck_template_pending"};
  const booking=await latestBooking(db,orgId,clientId);
  const expected=new Date(startTime).getTime();
  if (!["booked","rescheduled"].includes(booking?.status) || !Number.isFinite(expected)
    || expected<=new Date(now).getTime() || new Date(booking.starts_at).getTime()!==expected
    || (bookingUid && booking.provider_uid!==bookingUid)) return {owned:false,reason:"booking_changed"};
  // The plan revision can be a synthetic setter-score key. Held-call checks
  // must keep the real booking event, otherwise an older call stops a callback.
  const anchor=booking.raw?.__event_id || eventId;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(anchor))) {
    return {owned:false,reason:"booking_event_missing"};
  }
  const bookingEvent=(await db.query(`SELECT id FROM events WHERE id=$1::uuid
    AND org_id=$2 AND client_id=$3 AND name IN ('booking.created','booking.rescheduled') LIMIT 1`,
    [anchor,orgId,clientId])).rows[0];
  if (!bookingEvent) return {owned:false,reason:"booking_event_missing"};
  return {owned:true,...await planPrecall(db,{orgId,clientId,eventId,phase:"booked",startTime:booking.starts_at,
    bookingUid:booking.provider_uid,bookingEventId:bookingEvent.id,now})};
}
export async function planAfterSurvey(event, db, {enabled = precallPlannerEnabled(), now = new Date()} = {}) {
  if (!enabled) return {owned:false,reason:"deck_lessons_disabled"};
  if (!event?.orgId || !event?.clientId || !event?.id) return {owned:false,reason:"missing_scope"};
  if (!await precallTemplatesReady(db,event.orgId)) return {owned:false,reason:"deck_template_pending"};
  const booking=await latestBooking(db,event.orgId,event.clientId);
  if (["booked","rescheduled"].includes(booking?.status) && new Date(booking.starts_at)>new Date(now)) {
    return {owned:false,reason:"booking_owns_plan"};
  }
  return {owned:true,...await planPrecall(db,{orgId:event.orgId,clientId:event.clientId,eventId:event.id,
    phase:"prebooking",now})};
}
export async function cancelForBookingEvent(event, db) {
  if (!event?.orgId || !event?.clientId) return {cancelled:0};
  const booking=await latestBooking(db,event.orgId,event.clientId);
  const uid=event.payload?.bookingUid || event.payload?.booking_uid;
  // A delayed cancellation for an older call must not cancel a replacement.
  if (booking?.status!=="cancelled" || (uid && uid!==booking.provider_uid)) return {cancelled:0,reason:"stale_cancel"};
  return {cancelled:await cancelPrecall(db,{orgId:event.orgId,clientId:event.clientId,reason:"booking_cancelled"})};
}
export async function refreshPrecallForScore(db, {orgId,clientId,surveyEdits}, {enabled=precallPlannerEnabled(),now=new Date()}={}) {
  if (!enabled) return {owned:false,reason:"deck_lessons_disabled"};
  const revision=createHash("sha256").update(JSON.stringify(Object.entries(surveyEdits || {}).sort())).digest("hex");
  const eventId=`setter-score:${clientId}:${revision}`;
  const booking=await latestBooking(db,orgId,clientId);
  if (["booked","rescheduled"].includes(booking?.status) && new Date(booking.starts_at)>new Date(now)) {
    return planForBooking(db,{orgId,clientId,eventId,startTime:booking.starts_at,bookingUid:booking.provider_uid},{enabled,now});
  }
  const completed=(await db.query("SELECT id FROM events WHERE org_id = $1 AND client_id = $2 AND name = 'survey.completed' ORDER BY created_at DESC LIMIT 1",[orgId,clientId])).rows[0];
  if (!completed) return {owned:false,reason:"survey_not_complete"};
  return planAfterSurvey({orgId,clientId,id:eventId},db,{enabled,now});
}
export function registerPrecallPlans() {
  on("survey.completed",planAfterSurvey);
  on("booking.cancelled",cancelForBookingEvent);
}
