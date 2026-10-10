// Daily pulse notices — one SMS to Chris, one Darwin ticket hook.
//
// COMPLIANCE REVIEW REQUIRED: this is an ops text, not a client message.
// No credit-outcome claims. No auto-fix.
//
// Chris: dest from PULSE_SMS_TO (or CHRIS_PULSE_SMS). Do not hardcode.
// Darwin: WhatsApp only when DARWIN_WHATSAPP is set. Do not invent a number.

import { send as sendSms } from "../messaging/providers/twilio.mjs";
import { send as sendWhatsApp } from "../messaging/providers/twilio-whatsapp.mjs";
import { inTextWindow, HELD } from "./quiet-hours.mjs";

/* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). textChris and textMorningBrief text
   Chris's own number, so each one checks inTextWindow(now) right before the hand-off to Twilio. Outside
   6 a.m. to 10 p.m. Arizona time nothing is sent and the answer says HELD ("held_quiet_hours"). */

export const PULSE_SMS_TO_ENV = "PULSE_SMS_TO";
export const CHRIS_PULSE_SMS_ENV = "CHRIS_PULSE_SMS";
export const DARWIN_WHATSAPP_ENV = "DARWIN_WHATSAPP";

export function chrisPulseSmsTo(env = process.env) {
  const raw = String(
    (env && (env[PULSE_SMS_TO_ENV] || env[CHRIS_PULSE_SMS_ENV])) || ""
  ).trim();
  return normalizeUsNumber(raw) || null;
}

/* THE NUMBER IN THE SHAPE TWILIO WANTS. The provider refuses anything that is
   not E.164 (+1 and ten digits for a US number). A value typed as
   "602 555 1234", "(602) 555-1234" or "16025551234" is the same phone and used
   to be a silent rejection. The stored value is never printed and never
   changed; only what is handed to the provider is tidied. */
export function normalizeUsNumber(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return "";
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  const digits = s.replace(/\D+/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return s;
}

export function darwinWhatsAppNumber(env = process.env) {
  const raw = String((env && env[DARWIN_WHATSAPP_ENV]) || "").trim();
  return raw || null;
}

export function formatChrisSms({ date, pass = 0, fail = 0, skip = 0, topFails = [] } = {}) {
  const day = String(date || "").trim() || "today";
  const first = Array.isArray(topFails) ? topFails.filter(Boolean).slice(0, 2) : [];
  const failLine = first.length
    ? ` Failed: ${first.join("; ")}.`
    : "";
  return (
    `Fundhub morning check ${day}: ${pass} passed, ${fail} failed, ${skip} skipped.` +
    failLine +
    " Suggested fixes are on the pulse board. I did not change any product code."
  );
}

export function formatDarwinTicket({ date, findings = [], suggestedFixes = [] } = {}) {
  const day = String(date || "").trim() || "today";
  const fails = Array.isArray(findings) ? findings.filter(Boolean) : [];
  const fixes = Array.isArray(suggestedFixes) ? suggestedFixes.filter(Boolean) : [];
  const failLines = fails.length
    ? fails.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "No FAIL rows.";
  const fixLines = fixes.length
    ? fixes.map((f, i) => `${i + 1}. ${f}`).join("\n")
    : "None.";
  return [
    `Fundhub pulse ticket ${day}`,
    "Audit only. No auto-fix.",
    "",
    "FAIL list:",
    failLines,
    "",
    "Suggested fixes:",
    fixLines
  ].join("\n");
}

export async function textChris({
  date,
  pass,
  fail,
  skip,
  topFails,
  env = process.env,
  dryRun = true,
  sendImpl = sendSms,
  now = new Date()
} = {}) {
  const body = formatChrisSms({ date, pass, fail, skip, topFails });
  const to = chrisPulseSmsTo(env);
  if (!to) {
    return { sent: false, reason: `${PULSE_SMS_TO_ENV} unset`, body, to: null };
  }
  if (dryRun) return { sent: false, reason: "dry_run", body, to };
  if (!inTextWindow(now)) return { sent: false, reason: HELD, body, to };
  const result = await sendImpl(
    { to, body, channel: "sms" },
    { env }
  );
  return { sent: result?.status === "sent", reason: result?.error || null, body, to, result };
}

export async function ticketDarwin({
  date,
  findings,
  suggestedFixes,
  env = process.env,
  dryRun = true,
  sendImpl = sendWhatsApp
} = {}) {
  const ticket = formatDarwinTicket({ date, findings, suggestedFixes });
  const to = darwinWhatsAppNumber(env);
  if (!to) {
    return {
      ticket,
      sent: false,
      reason: `${DARWIN_WHATSAPP_ENV} unset`,
      to: null
    };
  }
  if (dryRun) return { ticket, sent: false, reason: "dry_run", to };
  const result = await sendImpl(
    { to, body: ticket, channel: "whatsapp" },
    { env }
  );
  return { ticket, sent: result?.status === "sent", reason: result?.error || null, to, result };
}

/* THE MORNING AND EVENING BRIEF TEXT. Same number as the pulse
   (PULSE_SMS_TO, or CHRIS_PULSE_SMS). Same Twilio send. Only the last 4
   digits of the number ever leave this function. The stored Netlify value
   is used as-is. This function never invents a number. */
export function last4(number) {
  const digits = String(number || "").replace(/\D+/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

export async function textMorningBrief({
  body,
  env = process.env,
  dryRun = true,
  sendImpl = sendSms,
  now = new Date()
} = {}) {
  const to = chrisPulseSmsTo(env);
  if (!to) {
    return {
      delivery_status: "no_number",
      sent_to_last4: null,
      error: `${PULSE_SMS_TO_ENV} unset`,
      provider_message_id: null
    };
  }
  if (dryRun) {
    return { delivery_status: "dry_run", sent_to_last4: last4(to), error: null, provider_message_id: null };
  }
  if (!inTextWindow(now)) {
    return { delivery_status: HELD, sent_to_last4: last4(to), error: null, provider_message_id: null };
  }
  const result = await sendImpl({ to, body, channel: "sms" }, { env });
  const sent = result?.status === "sent";
  return {
    delivery_status: sent ? "sent" : "failed",
    sent_to_last4: last4(to),
    error: sent ? null : String(result?.error || "send failed").slice(0, 300),
    provider_message_id: sent ? (result?.providerMessageId || null) : null
  };
}
