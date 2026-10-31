// Staff text when a call is booked. Not a client confirm.
// Owner-set 2026-08-23: optional, default off, flipped on Staff & Teams.
// Recipients: active owner + closer + setter + sales manager with the switch on and a phone.
// One closer for every call. Chris is owner today; when someone else is closer,
// they get it if their switch is on. Same person in two roles = one text.

import { renderTemplate } from "../lib/render-template.mjs";
import { isDraftTemplateRow } from "../messaging/draft-guard.mjs";
import { formatAppointmentStart } from "../workflows/messaging.mjs";
import { CF_SURVEY_QUESTIONS, surveyFicoBand } from "../survey/cf-question-map.mjs";
import { classifySurvey, PASS, DOWNSELL } from "../config/survey-qualification.mjs";
import { OFFERS, formatCents } from "../config/offers.mjs";
import { percentOf } from "../commissions/money.mjs";
import { drainMessageNow } from "../messaging/outbox.mjs";
import { STAFF_BOOKED_TEMPLATE, STAFF_BOOKED_ROLES } from "./message-recipient.mjs";
import { buildStaffLeadText, pushAssignedCloserLead } from "./lead-alerts.mjs";
import { sendNativeToStaff } from "../push/native-send.mjs";

export { STAFF_BOOKED_TEMPLATE, STAFF_BOOKED_ROLES };

function clean(v) {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

function isCfOptionId(v) {
  if (typeof v === "number") return v >= 10000;
  return typeof v === "string" && /^\d{5,}$/.test(v.trim());
}

function formatAnswer(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) {
    return v.filter((x) => x != null && x !== "" && !isCfOptionId(x)).map(clean).filter(Boolean).join(", ");
  }
  if (isCfOptionId(v)) return "";
  return clean(v);
}

function surveyAnswer(cf, key) {
  if (!cf || typeof cf !== "object") return "";
  const label = formatAnswer(cf[`${key}_label`]);
  if (label) return label;
  const labels = cf[`${key}_labels`];
  if (labels != null && labels !== "") {
    if (Array.isArray(labels)) return formatAnswer(labels);
    try {
      const parsed = JSON.parse(labels);
      if (Array.isArray(parsed)) return formatAnswer(parsed);
    } catch {
      /* not JSON — treat as words */
    }
    const asText = formatAnswer(labels);
    if (asText) return asText;
  }
  return formatAnswer(cf[key]);
}

function surveyLines(cf) {
  const lines = [];
  for (const q of CF_SURVEY_QUESTIONS) {
    if (q.type === "contact") continue;
    const answer = surveyAnswer(cf, q.payloadKey);
    if (!answer) continue;
    lines.push(q.title);
    lines.push(answer);
    lines.push("");
  }
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const UPSELL_LINE = "⚡ Always stack a second path. Funding + repair + mastery — don't close just one.";

function surveyLane(cf) {
  const band = surveyFicoBand(cf);
  return classifySurvey({
    cf_svy_self_reported_fico: band || cf.cf_svy_self_reported_fico || cf.cf_svy_self_reported_fico_label,
    cf_svy_has_negatives: cf.cf_svy_has_negatives_label || cf.cf_svy_has_negatives
  });
}

function playLines(cf) {
  const lane = surveyLane(cf);
  if (lane === PASS) {
    return ["🎯 RUN FIRST: Funding, done-for-you", UPSELL_LINE];
  }
  if (lane === DOWNSELL) {
    return ["🎯 RUN FIRST: Credit repair", UPSELL_LINE];
  }
  return ["🎯 Pick the path on the call", UPSELL_LINE];
}

/** Live closer/manager funding-deposit math. No repair dollars — those rules are not on the table. */
export function fundingPayFromRules(rows = [], depositCents = OFFERS.FUNDING_DFY.priceCents) {
  const list = Array.isArray(rows) ? rows : [];
  const closerFront = list.find((r) =>
    r && String(r.role || "").toLowerCase() === "closer"
    && r.amount_basis === "deposit_collected"
    && r.percent != null
  );
  if (!closerFront) return null;
  const managerFront = list.find((r) =>
    r && String(r.role || "").toLowerCase() === "sales_manager"
    && r.amount_basis === "deposit_collected"
    && r.percent != null
  );
  const closerBack = list.find((r) =>
    r && String(r.role || "").toLowerCase() === "closer"
    && r.amount_basis === "amount_funded"
    && r.percent != null
  );
  return {
    depositCents,
    closerDepositCents: percentOf(depositCents, closerFront.percent),
    managerDepositCents: managerFront ? percentOf(depositCents, managerFront.percent) : null,
    fundedPercent: closerBack != null ? Number(closerBack.percent) : null
  };
}

function payLines(pay) {
  if (!pay || pay.closerDepositCents == null) return [];
  const closer = formatCents(pay.closerDepositCents);
  const deposit = formatCents(pay.depositCents);
  if (!closer || !deposit) return [];
  const lines = [`💰 Close Funding, done-for-you: ${closer} on the ${deposit} deposit (closer)`];
  if (pay.managerDepositCents != null) {
    const manager = formatCents(pay.managerDepositCents);
    if (manager) lines.push(`Manager: ${manager} on that same deposit`);
  }
  if (pay.fundedPercent != null && Number.isFinite(pay.fundedPercent)) {
    lines.push(`Plus ${pay.fundedPercent}% of whatever funds`);
  }
  return lines;
}

export function pickRecipients(rows = []) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const id = row && row.id;
    const role = String(row && row.role || "").toLowerCase();
    const phone = clean(row && row.phone);
    if (!id || seen.has(id)) continue;
    if (!STAFF_BOOKED_ROLES.includes(role)) continue;
    if (!phone) continue;
    seen.add(id);
    out.push({ id, role, phone });
  }
  return out;
}

export function buildAlertBody({ client = {}, booking = {}, commissionRules = [] } = {}) {
  const cf = client.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields
    : {};
  const name = clean([client.first_name, client.last_name].filter(Boolean).join(" "))
    || clean(client.name)
    || clean(booking.name)
    || "Unnamed";
  const when = booking.startTime
    ? formatAppointmentStart(booking.startTime, booking.timezone)
    : "";
  const lines = [
    "🔥 YOU'RE UP — new book",
    "",
    name
  ];
  if (when) lines.push(when);
  const phone = clean(client.phone) || clean(booking.phone);
  if (phone) lines.push(phone);
  const email = clean(client.email) || clean(booking.email);
  if (email) lines.push(email);

  const play = playLines(cf);
  if (play.length) {
    lines.push("");
    lines.push(...play);
  }

  const payText = payLines(fundingPayFromRules(commissionRules));
  if (payText.length) {
    lines.push("");
    lines.push(...payText);
  }

  const qa = surveyLines(cf);
  if (qa.length) {
    lines.push("");
    lines.push(...qa);
  }
  return lines.join("\n");
}

export function buildSetterAlertBody({ client = {}, booking = {} } = {}) {
  return buildStaffLeadText({
    client: { ...client, first_name: client.first_name || clean(booking.name).split(/\s+/)[0],
      phone: client.phone || booking.phone, email: client.email || booking.email },
    startTime: booking.startTime
  });
}

export async function queueStaffBookedAlerts(db, {
  orgId, clientId, eventId, payload = {}, drainNowImpl = drainMessageNow,
  pushImpl = sendNativeToStaff
} = {}) {
  if (!orgId || !eventId) return { queued: 0, reason: "missing_ids" };

  const tpl = await db.query(
    `SELECT body, subject, compliance_passed
       FROM message_templates
      WHERE org_id = $1 AND template_key = $2
      LIMIT 1`,
    [orgId, STAFF_BOOKED_TEMPLATE]
  );
  const row = tpl.rows[0];
  if (!row || isDraftTemplateRow(row) || !row.compliance_passed) {
    return { queued: 0, reason: "template_pending" };
  }

  const staff = await db.query(
    `SELECT id, role, phone, notify_booked_call_sms
       FROM staff
      WHERE org_id = $1
        AND status = 'active'
        AND lower(role) = ANY($2::text[])`,
    [orgId, STAFF_BOOKED_ROLES]
  );
  const recipients = pickRecipients(staff.rows);
  const pushTargets = [...new Map(staff.rows
    .filter(row => STAFF_BOOKED_ROLES.includes(String(row.role || "").toLowerCase()))
    .map(row => [row.id, row])).values()];
  if (pushTargets.length === 0) return { queued: 0, reason: "no_recipients" };

  let client = { custom_fields: {} };
  if (clientId) {
    const cr = await db.query(
      `SELECT first_name, last_name, email, phone, channel_source, custom_fields
         FROM clients WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [clientId, orgId]
    );
    if (cr.rows[0]) client = cr.rows[0];
  }

  const booking = {
    name: payload.name,
    phone: payload.phone,
    email: payload.email,
    startTime: payload.startTime || payload.start_time,
    timezone: payload.timezone || payload.tzid || payload.tz
  };
  const setterBody = renderTemplate(row.body, { alert_body: buildSetterAlertBody({ client, booking }) });

  let queued = 0;
  let sent = 0;
  for (const person of pushTargets) {
    if (!recipients.some(recipient => recipient.id === person.id)) {
      try { await pushImpl(db, { orgId, staffId: person.id, clientId, kind: "lead", key: `booking:${eventId}` }); }
      catch (error) { console.warn(`[staff-booked-alert] push failed: ${error.message}`); }
      continue;
    }
    const providerRef = `workflow:${STAFF_BOOKED_TEMPLATE}:${eventId}:${person.id}`;
    const ins = await db.query(
      `INSERT INTO messages (org_id, client_id, direction, channel, template_key, rendered_body, provider, provider_ref, status, compliance_check_passed, to_address)
       VALUES ($1,$2,'outbound','sms',$3,$4,'internal',$5,'queued',true,$6)
       ON CONFLICT (org_id, provider_ref) WHERE provider_ref IS NOT NULL DO NOTHING
       RETURNING id`,
      [orgId, clientId || null, STAFF_BOOKED_TEMPLATE, setterBody, providerRef, person.phone]
    );
    const messageId = ins.rows[0]?.id;
    if (!messageId) {
      try { await pushImpl(db, { orgId, staffId: person.id, clientId, kind: "lead", key: `booking:${eventId}` }); }
      catch (error) { console.warn(`[staff-booked-alert] push failed: ${error.message}`); }
      continue;
    }
    queued += 1;
    // Only a fresh event-id/staff row is drained. A replay hits the unique
    // provider_ref and cannot text the same staff member a second time.
    // A refused or failed immediate drain leaves the row for the normal sweep.
    try {
      const result = await drainNowImpl(db, messageId, { orgId });
      if (result?.sent > 0) sent += 1;
    } catch (error) {
      console.warn(`[staff-booked-alert] immediate dispatch failed for ${messageId}: ${error.message}`);
    }
    try { await pushImpl(db, { orgId, staffId: person.id, clientId, kind: "lead", key: `booking:${eventId}` }); }
    catch (error) { console.warn(`[staff-booked-alert] push failed: ${error.message}`); }
  }
  await pushAssignedCloserLead(db, { orgId, clientId, key: `booking:${eventId}`, pushImpl });
  return { queued, sent };
}
