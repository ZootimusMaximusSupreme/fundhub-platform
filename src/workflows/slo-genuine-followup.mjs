// Genuine follow-up after someone leaves name/email/phone on /roadmap and
// does not pay the $297 diagnostic.
//
// Message 1 — ~15 minutes after slo.contact_started, if still unpaid.
// Fixed dig templates (SMS/EMAIL-SLO-GENUINE-01). No model. Not the free
// Meet / gift tease. Coupon is only after a real reply (message 2).
// Silence still gets SMS/EMAIL-SLO-197 from slo-no-reply-197.
// People who already hold slo_text_slot still get the first-five reply path.
//
// Message 2 — message.inbound. Resolve SMS by phone. Judge only that first
// reply (tiny hostile/brush-off gate). Real answer → SMS/EMAIL-SLO-COUPON-01.
// Hostile / dismissive → no coupon, stop that branch.
//
// Copy is Chris's. Outbound goes through sendTemplated → messages queued →
// src/messaging/providers (Twilio / mail). No second sender.
//
// Skips actor=agent, company/test emails (classifyVisitor), and anyone who
// already has a paid diagnostic payment_links row. Email-only opt-in still
// gets the email; SMS waits for a phone (or catches up at checkout).
// No backfill: only contacts that fire Inngest after skipInngest is off.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { resolveClient } from "../handlers/client-lifecycle.mjs";
import { sendTemplated } from "./messaging.mjs";
import { claimCustomFieldLock, mergeCustomFields } from "./custom-fields.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";
import { SLO_PURPOSE, SLO_SOURCE, sloRoadmapBookUrl } from "../slo/offer.mjs";
import { declinesRoadmap, DISCOUNT_REF_KEY, FIRST_FIVE, FREE_KEY, REPLIED_KEY, SLOT_KEY, discountCheckoutUrl, newDiscountRef } from "../slo/discount-197.mjs";
import { earnsCoupon, looksHostileOrBrushOff } from "../slo/reply-gate.mjs";
import { enrollSloDrip } from "../slo/drip-plan.mjs";
import { createTask } from "../lib/create-task.mjs";
import { formatQuestionList } from "../insights/questions.mjs";
import { meetBookingUrl } from "../insights/meet.mjs";
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";

export const SMS_M1_KEY = "SMS-SLO-GENUINE-01";
export const EMAIL_M1_KEY = "EMAIL-SLO-GENUINE-01";
export const SMS_FIRST5_KEY = "SMS-SLO-FIRST5-01";
export const EMAIL_FIRST5_KEY = "EMAIL-SLO-FIRST5-01";
export const SMS_GIFT_KEY = "SMS-SLO-GIFT-01";
export const EMAIL_GIFT_KEY = "EMAIL-SLO-GIFT-01";
export const SMS_COUPON_KEY = "SMS-SLO-COUPON-01";
export const EMAIL_COUPON_KEY = "EMAIL-SLO-COUPON-01";
export const SMS_FIRST5_REPLY_KEY = "SMS-SLO-FIRST5-REPLY";
export const EMAIL_FIRST5_REPLY_KEY = "EMAIL-SLO-FIRST5-REPLY";

export const LOCK_M1 = "slo_genuine_m1_sent_at";
export const LOCK_M2 = "slo_genuine_m2_sent_at";

export const WAIT_M1 = "15m";

export const M1_SMS_KEYS = [SMS_M1_KEY, SMS_FIRST5_KEY, SMS_GIFT_KEY, SMS_COUPON_KEY];

const CHRIS = { sender_name: "Chris", sender: { name: "Chris" } };

/** Non-creating SMS lookup — same rule as dpc-03 / comms inbound. */
async function findClientByPhone(db, orgId, phone) {
  const raw = String(phone || "").trim();
  if (!orgId || !raw) return null;
  const ph = normalizePhone(raw) || raw;
  const r = await db.query(
    `SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`,
    [orgId, ph]
  );
  if (r.rows[0]) return r.rows[0].id;
  if (ph !== raw) {
    const again = await db.query(
      `SELECT id FROM clients WHERE org_id=$1 AND phone=$2 LIMIT 1`,
      [orgId, raw]
    );
    if (again.rows[0]) return again.rows[0].id;
  }
  return null;
}

/** Attach inbound SMS/email to the person. Prefer clientId, then email, then phone. */
async function resolveReplyClient(db, event) {
  if (event.clientId) return resolveClient(db, event);
  const p = event.payload || {};
  if (String(p.email || "").trim()) return resolveClient(db, event);
  const channel = p.channel || "sms";
  if (channel === "email" && p.from) {
    return resolveClient(db, {
      ...event,
      payload: { ...p, email: p.from }
    });
  }
  return findClientByPhone(db, event.orgId, p.from || p.phone);
}

/* Opt-out only. A real answer like "YES" or "price" must still unlock message 2. */
const OPT_OUT_WORDS = new Set([
  "STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"
]);

/** True when this email (or client) already paid a real diagnostic. */
export async function hasPaidDiagnostic(db, { orgId, email, clientId } = {}) {
  const addr = String(email || "").trim().toLowerCase();
  if (!orgId) return false;
  if (!clientId && !addr) return false;
  const r = await db.query(
    `SELECT 1
       FROM payment_links pl
       JOIN clients c ON c.id = pl.client_id
      WHERE pl.org_id = $1::uuid
        AND pl.purpose = $2
        AND COALESCE(pl.is_demo, false) = false
        AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
        AND (
          ($3::uuid IS NOT NULL AND pl.client_id = $3::uuid)
          OR ($4 <> '' AND lower(c.email) = $4)
        )
      LIMIT 1`,
    [orgId, SLO_PURPOSE, clientId || null, addr]
  );
  return Boolean(r.rows[0]);
}

/** Gates that do not need the database. Phone is optional — email still goes. */
export function eligibleForGenuineM1(payload = {}) {
  if (payload.actor !== "person") return { ok: false, reason: "not_person" };
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) return { ok: false, reason: "no_email" };
  const who = classifyVisitor({ email });
  if (who.actor !== "person") return { ok: false, reason: who.reason || "not_person" };
  const phone = String(payload.phone || "").trim() || null;
  return { ok: true, email, phone };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The page saves the email first and merges the phone into the same
 * slo.contact_started row a moment later (api/public/slo-interest.mjs). This
 * run carries the row as it was at the email, so read it again after the wait.
 */
async function loadContactRow(db, eventId) {
  if (!UUID.test(String(eventId || ""))) return {};
  const r = await db.query(
    `SELECT payload->>'phone' AS phone, payload->>'name' AS contact_name
       FROM events
      WHERE id = $1::uuid AND name = 'slo.contact_started'
      LIMIT 1`,
    [eventId]
  );
  const row = r.rows[0] || {};
  return {
    phone: String(row.phone || "").trim() || null,
    name: String(row.contact_name || "").trim() || null
  };
}

async function loadClientPhone(db, clientId) {
  if (!clientId) return null;
  const r = await db.query(`SELECT phone FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
  return String(r.rows[0]?.phone || "").trim() || null;
}

/** True when this client already has a genuine M1 SMS row. */
export async function hasGenuineM1Sms(db, clientId) {
  if (!clientId) return false;
  const r = await db.query(
    `SELECT 1
       FROM messages
      WHERE client_id = $1
        AND channel = 'sms'
        AND template_key = ANY($2::text[])
      LIMIT 1`,
    [clientId, M1_SMS_KEYS]
  );
  return Boolean(r.rows[0]);
}

export async function handleM1({ event, db, step }) {
  const payload = event.payload || {};
  const gate = eligibleForGenuineM1(payload);
  if (!gate.ok) return { done: false, reason: gate.reason };

  await step.sleep("wait-15-min", WAIT_M1);

  const orgId = event.orgId;
  const paid = await step.run("check-still-unpaid", () =>
    hasPaidDiagnostic(db, { orgId, email: gate.email }));
  if (paid) return { done: true, sent: false, reason: "already_paid" };

  // Email-first opt-in: the phone may have merged into the row during the wait.
  // Without this the email-only run claims message 1 with no number, and the
  // run the phone started finds message 1 already claimed — no text at all.
  const row = gate.phone
    ? {}
    : await step.run("reload-contact", () => loadContactRow(db, event.id));
  const contactPhone = gate.phone || row.phone || null;

  const clientId = await step.run("resolve-client", () =>
    resolveClient(db, {
      orgId,
      payload: {
        email: gate.email,
        name: payload.name || row.name || null,
        phone: contactPhone,
        source: SLO_SOURCE
      }
    }));
  if (!clientId) return { done: false, reason: "no_client" };

  const stillPaid = await step.run("recheck-paid-after-resolve", () =>
    hasPaidDiagnostic(db, { orgId, email: gate.email, clientId }));
  if (stillPaid) return { done: true, sent: false, reason: "already_paid" };

  const claimed = await step.run("claim-m1", () =>
    claimCustomFieldLock(db, clientId, LOCK_M1));
  if (!claimed) return { done: false, reason: "already_sent_m1" };

  const eventId = event.id;
  // Phone may land after opt-in (merged on the contact row, or checkout during
  // the wait). Prefer event, then contact row, else client row.
  const phone = contactPhone
    || (await step.run("load-phone", () => loadClientPhone(db, clientId)));
  const email = await step.run("send-email-m1", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_M1_KEY, eventId, context: CHRIS
    }));
  let sms = null;
  if (phone) {
    sms = await step.run("send-sms-m1", () =>
      sendTemplated(db, {
        orgId, clientId, channel: "sms", templateKey: SMS_M1_KEY, eventId, context: CHRIS
      }));
  }

  return { done: true, sent: true, clientId, sms, email };
}

/**
 * Phone landed at checkout. If unpaid M1 never went, send email + SMS now.
 * If M1 email already went with no SMS, send only the SMS.
 */
export async function handleCheckoutM1Sms({ event, db, step }) {
  const payload = event.payload || {};
  const orgId = event.orgId;
  const clientId = payload.client_id || event.clientId || null;
  if (!clientId) return { done: false, reason: "no_client" };

  const email = String(payload.email || "").trim().toLowerCase()
    || (await step.run("load-email", async () => {
      const r = await db.query(`SELECT email FROM clients WHERE id = $1 LIMIT 1`, [clientId]);
      return String(r.rows[0]?.email || "").trim().toLowerCase();
    }));
  if (!email) return { done: false, reason: "no_email" };
  const who = classifyVisitor({ email });
  if (who.actor !== "person") return { done: false, reason: who.reason || "not_person" };

  const phone = await step.run("load-phone", () => loadClientPhone(db, clientId));
  if (!phone) return { done: false, sent: false, reason: "no_phone" };

  const paid = await step.run("check-paid", () =>
    hasPaidDiagnostic(db, { orgId, clientId, email }));
  if (paid) return { done: true, sent: false, reason: "already_paid" };

  const fields = await step.run("read-fields", () => clientFields(db, clientId));
  const eventId = event.id;

  // Full M1 never claimed — send dig email + SMS (no 15m wait; they already reached checkout).
  if (!fields[LOCK_M1]) {
    const claimed = await step.run("claim-m1", () =>
      claimCustomFieldLock(db, clientId, LOCK_M1));
    if (!claimed) return { done: false, reason: "already_sent_m1" };
    const mail = await step.run("send-email-m1", () =>
      sendTemplated(db, {
        orgId, clientId, channel: "email", templateKey: EMAIL_M1_KEY, eventId, context: CHRIS
      }));
    const sms = await step.run("send-sms-m1", () =>
      sendTemplated(db, {
        orgId, clientId, channel: "sms", templateKey: SMS_M1_KEY, eventId, context: CHRIS
      }));
    return { done: true, sent: true, clientId, sms, email: mail, lane: "full_m1" };
  }

  const already = await step.run("already-sms", () => hasGenuineM1Sms(db, clientId));
  if (already) return { done: true, sent: false, reason: "already_sent_sms" };

  const sms = await step.run("send-sms-catchup", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_M1_KEY, eventId, context: CHRIS
    }));
  return { done: true, sent: true, clientId, sms, lane: "sms_only" };
}

/**
 * Free Meet text while fewer than FIRST_FIVE people have both agreed
 * (slo_roadmap_free_at) and booked. Offered-but-unbooked does not consume a seat.
 */
export async function assignTextSlot(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT count(*)::int AS n
       FROM clients c
      WHERE c.org_id = $1
        AND c.custom_fields->>$2 IS NOT NULL
        AND (
          EXISTS (
            SELECT 1 FROM bookings b
             WHERE b.client_id = c.id
               AND b.org_id = c.org_id
          )
          OR EXISTS (
            SELECT 1 FROM events e
             WHERE e.client_id = c.id
               AND e.org_id = c.org_id
               AND e.name = 'booking.created'
          )
        )`,
    [orgId, FREE_KEY]
  );
  const used = Number(r.rows[0]?.n || 0);
  if (used >= FIRST_FIVE) return null;
  const slot = String(used + 1);
  await mergeCustomFields(db, clientId, { [SLOT_KEY]: slot });
  return slot;
}

async function clientFields(db, clientId) {
  const r = await db.query(
    `SELECT custom_fields FROM clients WHERE id = $1`,
    [clientId]
  );
  return r.rows[0]?.custom_fields || {};
}

/** True when this client got message 1 and has not gotten message 2. */
export async function awaitingGenuineM2(db, clientId) {
  if (!clientId) return false;
  const r = await db.query(
    `SELECT custom_fields->>$2 AS m1, custom_fields->>$3 AS m2
       FROM clients WHERE id = $1 LIMIT 1`,
    [clientId, LOCK_M1, LOCK_M2]
  );
  const row = r.rows[0];
  if (!row) return false;
  return Boolean(row.m1) && !row.m2;
}

export async function handleFirstFiveReply({ event, db, step, clientId, body }) {
  const orgId = event.orgId;
  const eventId = event.id;
  if (looksHostileOrBrushOff(body) || declinesRoadmap(body)) {
    await step.run("enroll-drip", () => enrollSloDrip(db, clientId));
    return { done: true, sent: false, reason: "first_five_no_agree", clientId };
  }
  const claimed = await step.run("claim-free", () =>
    claimCustomFieldLock(db, clientId, "slo_roadmap_free_at"));
  if (!claimed) return { done: false, reason: "already_free" };
  const bookUrl = meetBookingUrl() || sloRoadmapBookUrl();
  const context = { ...CHRIS, book_url: bookUrl };
  const sms = await step.run("send-sms-first5-reply", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_FIRST5_REPLY_KEY, eventId, context
    }));
  const email = await step.run("send-email-first5-reply", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_FIRST5_REPLY_KEY, eventId, context
    }));
  const task = await step.run("task-interview", () =>
    createTask(db, {
      orgId,
      clientId,
      title: "Free roadmap, then the video interview",
      sourceWorkflow: "slo-first-five-interview",
      assigneeRole: "csm",
      eventId,
      meetingUrl: bookUrl,
      body: [
        "They agreed. The roadmap is free.",
        "Do the soft pull on the interview before you hand them the roadmap. That is how we know the file is real.",
        bookUrl
          ? `Then send this Google Meet link: ${bookUrl}`
          : "Then book the Google Meet (INSIGHT_MEET_BOOKING_URL).",
        "Ask these questions and save the answers.",
        formatQuestionList("post"),
        `[event:${eventId}]`
      ].join("\n")
    }));
  return { done: true, sent: true, lane: "free_roadmap", clientId, sms, email, bookUrl, task };
}

export async function handleReply({ event, db, step }) {
  const payload = event.payload || {};
  const channel = payload.channel || "sms";
  if (channel !== "sms" && channel !== "email") {
    return { done: false, reason: "wrong_channel" };
  }
  const word = String(payload.body || "").trim().toUpperCase();
  if (!word) return { done: false, reason: "empty_body" };
  if (OPT_OUT_WORDS.has(word)) return { done: false, reason: "opt_out" };

  const clientId = await step.run("resolve-client", () => resolveReplyClient(db, event));
  if (!clientId) return { done: false, reason: "no_client" };

  await step.run("mark-replied", () =>
    mergeCustomFields(db, clientId, { [REPLIED_KEY]: new Date().toISOString() }));

  const fields = await step.run("read-lane", () => clientFields(db, clientId));
  if (fields[SLOT_KEY]) {
    return handleFirstFiveReply({
      event, db, step, clientId, body: payload.body
    });
  }

  const waiting = await step.run("check-awaiting-m2", () =>
    awaitingGenuineM2(db, clientId));
  if (!waiting) return { done: false, reason: "not_awaiting_m2" };

  const worthCoupon = await step.run("judge-reply", () => earnsCoupon(payload.body));
  if (!worthCoupon) {
    await step.run("claim-m2-brush-off", () =>
      claimCustomFieldLock(db, clientId, LOCK_M2));
    await step.run("enroll-drip-brush-off", () => enrollSloDrip(db, clientId));
    return { done: true, sent: false, reason: "brush_off", clientId };
  }

  const paid = await step.run("check-paid", () =>
    hasPaidDiagnostic(db, {
      orgId: event.orgId,
      clientId,
      email: (event.payload || {}).email
    }));
  if (paid) return { done: true, sent: false, reason: "already_paid" };

  const claimed = await step.run("claim-coupon", () =>
    claimCustomFieldLock(db, clientId, LOCK_M2));
  if (!claimed) return { done: false, reason: "already_sent_m2" };

  const orgId = event.orgId;
  const eventId = event.id;
  const ref = newDiscountRef();
  const payUrl = discountCheckoutUrl(ref);
  await step.run("save-coupon-ref", () =>
    mergeCustomFields(db, clientId, { [DISCOUNT_REF_KEY]: ref }));
  const context = { ...CHRIS, pay_url: payUrl };
  const sms = await step.run("send-sms-coupon", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "sms", templateKey: SMS_COUPON_KEY, eventId, context
    }));
  const email = await step.run("send-email-coupon", () =>
    sendTemplated(db, {
      orgId, clientId, channel: "email", templateKey: EMAIL_COUPON_KEY, eventId, context
    }));
  await step.run("enroll-drip", () => enrollSloDrip(db, clientId));

  return { done: true, sent: true, clientId, sms, email, payUrl };
}

/* For the journey runner (src/journeys/runner/registry.mjs), which never calls
   the Inngest wrapper (it closes over the live pool) and instead calls the
   module's own injectable handler. This one file serves three functions, so a
   single `handle` cannot be right for all of them: each id names its own. */
export const handles = Object.freeze({
  "slo-genuine-followup": handleM1,
  "slo-genuine-reply": handleReply,
  "slo-genuine-checkout-sms": handleCheckoutM1Sms
});

export const sloGenuineFollowup = inngest.createFunction(
  { id: "slo-genuine-followup", name: "SLO — genuine unpaid follow-up (message 1)" },
  { event: "slo.contact_started" },
  ({ event, step }) => handleM1({ event: event.data, db, step })
);

export const sloGenuineReply = inngest.createFunction(
  { id: "slo-genuine-reply", name: "SLO — genuine follow-up after reply (message 2)" },
  { event: "message.inbound" },
  ({ event, step }) => handleReply({ event: event.data, db, step })
);

export const sloGenuineCheckoutSms = inngest.createFunction(
  { id: "slo-genuine-checkout-sms", name: "SLO — unpaid M1 SMS when phone lands at checkout" },
  { event: "slo.checkout_started" },
  ({ event, step }) => handleCheckoutM1Sms({ event: event.data, db, step })
);
