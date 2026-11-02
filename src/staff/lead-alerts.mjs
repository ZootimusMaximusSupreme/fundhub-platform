// Short internal alerts for the person working a lead. Every SMS uses the
// existing outbox gate; native push is a separate delivery to the same staffer.
import { CF_SURVEY_QUESTIONS } from "../survey/cf-question-map.mjs";
import { formatAppointmentStart } from "../workflows/messaging.mjs";
import { drainMessageNow } from "../messaging/outbox.mjs";
import { sendNativeToStaff } from "../push/native-send.mjs";

const E164 = /^\+[1-9]\d{7,14}$/;
const ALERT_ROLES = { lead: ["owner", "setter"], set: ["owner", "closer"], upcoming: ["owner", "closer"] };

function clean(value) { return String(value ?? "").trim(); }
function firstName(client = {}) { return clean(client.first_name) || clean(client.name).split(/\s+/)[0] || "Lead"; }

function answer(value) {
  if (Array.isArray(value)) return value.map(answer).filter(Boolean).join(", ");
  const text = clean(value);
  if (!text || /^\d{5,}$/.test(text)) return "";
  if (text.startsWith("[")) {
    try { return answer(JSON.parse(text)); } catch { /* A plain answer may start with [. */ }
  }
  return text;
}

function surveyLines(fields = {}) {
  const edits = fields.setter_survey_edits || {};
  return CF_SURVEY_QUESTIONS.filter(q => q.type !== "contact").flatMap(q => {
    const key = q.payloadKey;
    const value = Object.hasOwn(edits, key) ? edits[key]
      : fields[`${key}_label`] ?? fields[`${key}_labels`] ?? fields[key];
    const text = answer(value);
    return text ? [`${q.title}: ${text}`] : [];
  });
}

function contactLines(client = {}) {
  return [clean(client.phone) && `Phone: ${clean(client.phone)}`,
    clean(client.email) && `Email: ${clean(client.email)}`].filter(Boolean);
}

function bookingLine(startTime) {
  if (!startTime) return "Booked: No";
  const date = new Date(startTime);
  return Number.isFinite(date.getTime())
    ? `Booked: ${formatAppointmentStart(date.toISOString(), "America/Phoenix")}`
    : "Booked: Yes";
}

export function buildStaffLeadText({ client = {}, startTime = null } = {}) {
  return [`New lead: ${firstName(client)}`, ...contactLines(client), bookingLine(startTime),
    ...surveyLines(client.custom_fields || {})].join("\n");
}

export function buildCloserSetText({ client = {}, handoff = {}, startTime = null } = {}) {
  const details = [
    handoff.goal && `Goal: ${clean(handoff.goal)}`,
    handoff.problem && `Problem: ${clean(handoff.problem)}`,
    handoff.triage_personal_or_business && `Type: ${clean(handoff.triage_personal_or_business)}`,
    typeof handoff.computer_ready === "boolean" && `Computer ready: ${handoff.computer_ready ? "Yes" : "No"}`,
    typeof handoff.app_on_phone === "boolean" && `App on phone: ${handoff.app_on_phone ? "Yes" : "No"}`
  ].filter(Boolean);
  return [`Lead set: ${firstName(client)}`, ...contactLines(client), bookingLine(startTime),
    ...details, ...surveyLines(client.custom_fields || {})].join("\n");
}

export function buildCloserUpcomingText({ client = {}, startTime } = {}) {
  return [`Next call: ${firstName(client)}`, ...contactLines(client), bookingLine(startTime)].join("\n");
}

async function activeStaff(db, orgId, staffId, roles) {
  const result = await db.query(
    `SELECT id, role, phone FROM staff
      WHERE org_id = $1 AND id = $2 AND status = 'active'
        AND lower(role) = ANY($3::text[]) LIMIT 1`,
    [orgId, staffId, roles]
  );
  const row = result.rows[0];
  return row && roles.includes(String(row.role || "").toLowerCase()) ? row : null;
}

export async function queueStaffAlert(db, {
  orgId, clientId, staffId, kind, key, body,
  drainNowImpl = drainMessageNow, pushImpl = sendNativeToStaff, drain = true
} = {}) {
  if (!orgId || !clientId || !staffId || !key || !ALERT_ROLES[kind]) return { queued: 0, reason: "missing_context" };
  const staff = await activeStaff(db, orgId, staffId, ALERT_ROLES[kind]);
  if (!staff) return { queued: 0, reason: "staff_unavailable" };
  let messageId = null;
  if (E164.test(clean(staff.phone))) {
    const ref = `staff-alert:${kind}:${key}:${staff.id}`;
    const inserted = await db.query(
      `INSERT INTO messages (org_id, client_id, direction, channel, rendered_body,
         provider, provider_ref, status, compliance_check_passed, to_address)
       VALUES ($1,$2,'outbound','sms',$3,'internal',$4,'queued',false,$5)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [orgId, clientId, body, ref, staff.phone]
    );
    messageId = inserted.rows[0]?.id || null;
  }
  let sent = 0;
  if (drain && messageId) {
    try {
      const result = await drainNowImpl(db, messageId, { orgId });
      sent = result?.sent || 0;
    } catch (error) {
      console.warn(`[staff-alert] dispatch failed: ${error.message}`);
    }
  }
  let push = null;
  if (drain) {
    try { push = await pushImpl(db, { orgId, staffId: staff.id, clientId, kind, key }); }
    catch (error) { console.warn(`[staff-alert] push failed: ${error.message}`); }
  }
  return { queued: messageId ? 1 : 0, sent, messageId, push };
}

export async function queueNewLeadAlerts(db, { orgId, clientId, drainNowImpl, pushImpl } = {}) {
  if (!orgId || !clientId) return { queued: 0, reason: "missing_context" };
  const client = (await db.query(
    `SELECT first_name, last_name, phone, email, custom_fields FROM clients
      WHERE org_id = $1 AND id = $2 LIMIT 1`, [orgId, clientId]
  )).rows[0];
  if (!client) return { queued: 0, reason: "client_not_found" };
  const booking = (await db.query(
    `SELECT starts_at FROM bookings WHERE org_id = $1 AND client_id = $2
      AND status IN ('booked','rescheduled') ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId]
  )).rows[0];
  const staff = (await db.query(
    `SELECT id FROM staff WHERE org_id = $1 AND status = 'active'
      AND lower(role) = ANY($2::text[])`, [orgId, ALERT_ROLES.lead]
  )).rows;
  const body = buildStaffLeadText({ client, startTime: booking?.starts_at });
  const results = [];
  for (const person of staff) results.push(await queueStaffAlert(db, {
    orgId, clientId, staffId: person.id, kind: "lead", key: clientId, body,
    drainNowImpl, pushImpl
  }));
  const closerPush = await pushAssignedCloserLead(db, { orgId, clientId, key: clientId, pushImpl });
  return { queued: results.reduce((n, item) => n + item.queued, 0), results, closerPush };
}

export async function pushAssignedCloserLead(db, {
  orgId, clientId, key, pushImpl = sendNativeToStaff
} = {}) {
  if (!orgId || !clientId || !key) return { sent: 0, reason: "missing_context" };
  const assigned = (await db.query(
    `SELECT assignee_staff_id FROM tasks WHERE org_id = $1 AND client_id = $2
      AND assignee_role = 'closer' AND assignee_staff_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`, [orgId, clientId]
  )).rows[0]?.assignee_staff_id;
  if (!assigned) return { sent: 0, reason: "closer_unassigned" };
  const closer = await activeStaff(db, orgId, assigned, ALERT_ROLES.set);
  if (!closer) return { sent: 0, reason: "closer_unavailable" };
  try { return await pushImpl(db, { orgId, staffId: closer.id, clientId, kind: "lead", key }); }
  catch (error) {
    console.warn(`[staff-alert] closer lead push failed: ${error.message}`);
    return { sent: 0, reason: "push_failed" };
  }
}

export async function queueCloserSetAlert(db, {
  orgId, clientId, closerStaffId, handoff, client, startTime,
  drainNowImpl, pushImpl, drain = true
} = {}) {
  if (!closerStaffId) return { queued: 0, reason: "closer_unassigned" };
  return queueStaffAlert(db, { orgId, clientId, staffId: closerStaffId, kind: "set",
    key: clientId, body: buildCloserSetText({ client, handoff, startTime }),
    drainNowImpl, pushImpl, drain });
}

export async function queueCloserUpcomingAlert(db, {
  orgId, clientId, startTime, drainNowImpl, pushImpl
} = {}) {
  if (!orgId || !clientId || !startTime) return { queued: 0, reason: "missing_context" };
  const client = (await db.query(
    `SELECT first_name, last_name, phone, email, custom_fields FROM clients
      WHERE org_id = $1 AND id = $2 LIMIT 1`, [orgId, clientId]
  )).rows[0];
  if (!client) return { queued: 0, reason: "client_not_found" };
  const assigned = (await db.query(
    `SELECT assignee_staff_id FROM tasks WHERE org_id = $1 AND client_id = $2
      AND assignee_role = 'closer' AND assignee_staff_id IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`, [orgId, clientId]
  )).rows[0]?.assignee_staff_id || client.custom_fields?.setter_handoff?.closer_staff_id;
  let closerStaffId = assigned;
  if (!closerStaffId) {
    closerStaffId = (await db.query(
      `SELECT id FROM staff WHERE org_id = $1 AND role = 'owner' AND status = 'active'
        ORDER BY created_at LIMIT 1`, [orgId]
    )).rows[0]?.id;
  }
  if (!closerStaffId) return { queued: 0, reason: "closer_unassigned" };
  return queueStaffAlert(db, { orgId, clientId, staffId: closerStaffId, kind: "upcoming",
    key: `${clientId}:${new Date(startTime).toISOString()}`,
    body: buildCloserUpcomingText({ client, startTime }), drainNowImpl, pushImpl });
}
