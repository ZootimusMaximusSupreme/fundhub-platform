// Human setter sends. Every leg is a Fundhub message and uses the existing
// gate, routing and Twilio dispatcher. The two-recipient handoff is two SMS
// messages with stable keys; Twilio does not promise a shared group thread.
import { composeAndSend } from "../messaging/compose.mjs";
import { drainMessageNow } from "../messaging/outbox.mjs";
import { formatAppointmentStart } from "../workflows/messaging.mjs";

const URL_RE = /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i;
const PHONE_RE = /^\+[1-9]\d{7,14}$/;

export function hasSetterIntroVideo(env = process.env) {
  return URL_RE.test(String(env.SETTER_INTRO_VIDEO_URL || "").trim());
}

function clean(value, fallback = "") {
  return String(value ?? fallback).trim().replace(/\s+/g, " ").slice(0, 500);
}

function surveyFact(client) {
  const cf = client?.custom_fields || {};
  const survey = client?.survey || {};
  for (const key of ["cf_svy_money_change_now", "cf_svy_planned_use", "cf_svy_funding_target_amount"]) {
    const value = clean(survey[key] || cf[`${key}_label`] || cf[key]);
    if (value && !/^\d{5,}$/.test(value)) return value;
  }
  return null;
}

function bookedTime(client, booking) {
  const raw = booking?.starts_at || booking?.start_time || client?.booking_time || client?.booked_at;
  if (!raw) return "the booked time";
  try { return formatAppointmentStart(raw, "America/Phoenix"); }
  catch { return "the booked time"; }
}

/** SOP section “Three-way text to the closer”, filled only from saved facts. */
export function buildSetterHandoffText({ client = {}, handoff = {}, booking = {}, closer = {}, setter = {} } = {}) {
  const name = clean(client.first_name || client.client_name?.split(" ")[0], "there");
  const closerName = clean(closer?.name?.split(" ")[0], "Closer");
  const goal = clean(handoff.goal || handoff.triage_goal, "their funding goal");
  const problem = clean(handoff.problem || handoff.triage_problem, "their current funding path");
  const fact = surveyFact(client);
  const computer = handoff.computer_ready === true || handoff.computer_ready === "yes"
    ? "They can be at a computer." : handoff.computer_ready === false || handoff.computer_ready === "no"
      ? "They cannot be at a computer yet." : "Computer readiness needs confirming.";
  return `Hey ${name} — ${clean(setter?.name?.split(" ")[0] || handoff.setter_name, "Chris")} at Fundhub. You are set for ${bookedTime(client, booking)}. Be at a computer. We pull your credit live on that call. Your score does not move.\n\n${closerName}, ${name} is looking at ${goal}. The stuck part is ${problem}. ${fact ? `Survey said ${fact}. ` : ""}${computer}`;
}

async function staffRow(db, orgId, id) {
  if (!id) return null;
  const { rows } = await db.query(
    `SELECT id, name, phone, status FROM staff WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id]
  );
  return rows[0] || null;
}

function sendAccepted(result) {
  return result?.outcome === "sent" || result?.deduped === true &&
    ["sent", "delivered"].includes(result?.message?.status);
}

function response(result) {
  return { outcome: result?.outcome || result?.message?.status || "unknown",
    message_id: result?.message?.id || null, deduped: !!result?.deduped };
}

async function sendLead(db, { orgId, staffId, clientId, body, key, phone }) {
  if (!PHONE_RE.test(String(phone || ""))) throw new Error("lead phone is missing or invalid");
  return composeAndSend(db, {
    orgId, staffId, clientId, channel: "sms", body,
    toAddress: phone, idempotencyKey: key
  });
}

async function sendCloser(db, { orgId, clientId, staffId, closerId, phone, body, key }) {
  if (!PHONE_RE.test(String(phone || ""))) throw new Error("closer phone is missing or invalid");
  if (!closerId) throw new Error("closer staff id is missing");
  const ref = `setter:${key}:closer:${closerId}`;
  const inserted = await db.query(
    `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body,
       provider_ref, status, compliance_check_passed, to_address, sender_staff_id, sender_kind)
     VALUES ($1,$2,'outbound','sms',$3,$4,'queued',false,$5,$6,'staff')
     ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
     RETURNING id`,
    [orgId, clientId, body, ref, phone, staffId]
  );
  if (!inserted.rows[0]) {
    const existing = await db.query(
      `SELECT id, status FROM messages WHERE org_id = $1 AND provider_ref = $2 LIMIT 1`,
      [orgId, ref]
    );
    return { outcome: existing.rows[0]?.status || "unknown", message: existing.rows[0], deduped: true };
  }
  const drained = await drainMessageNow(db, inserted.rows[0].id, { orgId });
  return { outcome: drained.results?.[0]?.outcome || drained.reason || "queued",
    message: { id: inserted.rows[0].id }, deduped: false };
}

/** Called only after the authenticated dashboard action has saved its fields. */
export async function performSetterSendAction({
  action, client, handoff = {}, staff, db, orgId, setterStaffId, closerStaffId,
  env = process.env, sendLeadImpl = sendLead, sendCloserImpl = sendCloser
} = {}) {
  const clientId = client?.id || client?.client_id;
  if (!db || !orgId || !clientId || !staff?.id) throw new Error("setter send context is incomplete");
  const setterId = setterStaffId || staff.id;
  const closerId = closerStaffId || (staff.role === "owner" ? setterId : null);
  if (!closerId) throw new Error("closer staff assignment is missing");
  const sameStaff = String(setterId) === String(closerId);
  const closer = sameStaff ? staff : await staffRow(db, orgId, closerId);
  if (!closer) throw new Error("closer staff record is missing");
  // A former staff member may remain linked to an old booking. Never send the
  // customer's problem, funding goal, or appointment to their phone number.
  if (!sameStaff && String(closer.status || "").toLowerCase() !== "active") {
    throw new Error("closer staff assignment is not active");
  }
  const key = `${clientId}:${clean(client.booking_time || client.booked_at || "current")}`;

  if (action === "send_intro_video") {
    const url = clean(env.SETTER_INTRO_VIDEO_URL);
    if (!hasSetterIntroVideo(env)) throw new Error("SETTER_INTRO_VIDEO_URL must be a public HTTPS URL");
    const name = clean(client.first_name, "there");
    const body = sameStaff
      ? `Hey ${name}, this is Chris from Fundhub. I just saw you reach out. Here is a short intro before our strategy call: ${url}`
      : `Hey ${name}, this is Chris from Fundhub. I just saw you reach out. ${clean(closer.name?.split(" ")[0])} will handle your strategy call. Here is a short intro: ${url}`;
    const sent = await sendLeadImpl(db, { orgId, staffId: staff.id, clientId,
      body, key: `setter-video:${key}`, phone: client.phone });
    return { lead: response(sent), handoffPatch: sendAccepted(sent)
      ? { video_sent_at: new Date().toISOString() } : {} };
  }

  if (action !== "send_handoff") throw new Error("unsupported setter send action");
  if (!handoff.complete_at) throw new Error("complete the setter handoff before sending it");
  // Validate the second recipient before sending the first leg. Otherwise a
  // malformed closer number leaves the buyer told a handoff happened while no
  // closer can receive the private handoff.
  if (!sameStaff && !PHONE_RE.test(String(closer.phone || ""))) {
    throw new Error("closer phone is missing or invalid");
  }
  const body = buildSetterHandoffText({ client, handoff, closer, setter: staff });
  const leadBody = body.split("\n\n", 1)[0];
  const lead = await sendLeadImpl(db, { orgId, staffId: staff.id, clientId,
    body: leadBody, key: `setter-handoff:${key}:lead`, phone: client.phone });
  if (!sendAccepted(lead)) return { lead: response(lead), same_staff: sameStaff,
    handoffPatch: { handoff_text: body } };
  let closerLeg = null;
  if (!sameStaff) {
    closerLeg = await sendCloserImpl(db, { orgId, clientId, staffId: staff.id, closerId,
      phone: closer.phone, body, key });
  }
  const allSent = !closerLeg || sendAccepted(closerLeg);
  return { lead: response(lead), closer: closerLeg && response(closerLeg), same_staff: sameStaff,
    handoffPatch: { handoff_text: body, ...(allSent ? { handoff_sent_at: new Date().toISOString() } : {}) } };
}
