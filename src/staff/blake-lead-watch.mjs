// Poll prove/Chris Gmail for Blake referral mail. Text Chris the name + phone.
// Same send path as the daily pulse (Twilio → PULSE_SMS_TO). Never texts the lead.

import { gmailConfigFromEnv, createGmailClientFromConfig } from "../gmail/index.mjs";
import { plainTextFromMessage } from "../gmail/client.mjs";
import { send as sendSms } from "../messaging/providers/twilio.mjs";
import { chrisPulseSmsTo } from "../pulse/notify.mjs";
import { inTextWindow, HELD } from "../pulse/quiet-hours.mjs";
import {
  BLAKE_GMAIL_QUERY,
  PROCESSED_LABEL,
  SEND_MAX_AGE_MS,
  formatChrisLeadSms,
  isBlakeMail,
  isInvitationSubject,
  parseReferredLead
} from "./blake-lead.mjs";

function messageDateMs(message, headerValue) {
  const raw = headerValue(message, "Date");
  const t = Date.parse(raw || "");
  return Number.isFinite(t) ? t : NaN;
}

export async function sendChrisLeadSms({
  name,
  phone,
  env = process.env,
  dryRun = false,
  sendImpl = sendSms,
  now = new Date()
} = {}) {
  const body = formatChrisLeadSms({ name, phone });
  const to = chrisPulseSmsTo(env);
  if (!to) {
    return { sent: false, reason: "PULSE_SMS_TO unset", body, to: null };
  }
  if (dryRun) return { sent: false, reason: "dry_run", body, to };
  /* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md): Chris's number, so nothing goes
     out from 10 p.m. to 6 a.m. Arizona time. Not sent means the mail is not labeled, so the first poll
     inside the window texts it (8 hours of hold is inside the 12 hour SEND_MAX_AGE_MS). */
  if (!inTextWindow(now)) return { sent: false, reason: HELD, body, to };
  const result = await sendImpl({ to, body, channel: "sms" }, { env });
  return { sent: result?.status === "sent", reason: result?.error || null, body, to, result };
}

export async function watchBlakeLeads({
  env = process.env,
  dryRun = false,
  gmailClient,
  sendImpl = sendSms,
  now
} = {}) {
  const to = chrisPulseSmsTo(env);
  if (!to) {
    return { scanned: 0, sent: 0, skipped: 0, reason: "PULSE_SMS_TO unset" };
  }

  let client = gmailClient;
  if (!client) {
    const cfg = gmailConfigFromEnv(env);
    if (!cfg.ready) {
      return { scanned: 0, sent: 0, skipped: 0, reason: "gmail_not_ready" };
    }
    client = createGmailClientFromConfig(cfg);
  }

  const labelId = await client.getOrCreateLabel(PROCESSED_LABEL);
  const listed = await client.listMessages({ maxResults: 20, q: BLAKE_GMAIL_QUERY });
  const rows = listed.messages || [];
  let sent = 0;
  let skipped = 0;

  for (const row of rows) {
    const msg = await client.getMessage(row.id, { format: "full" });
    const from = client.headerValue(msg, "From");
    const subject = client.headerValue(msg, "Subject");
    const body = plainTextFromMessage(msg);
    const mark = async () => {
      if (labelId) await client.addLabels(row.id, [labelId]);
    };

    if (!isBlakeMail({ from, subject, body, env }) || isInvitationSubject(subject)) {
      await mark();
      skipped += 1;
      continue;
    }
    const lead = parseReferredLead({ from, subject, body });
    if (!lead) {
      await mark();
      skipped += 1;
      continue;
    }
    const when = messageDateMs(msg, client.headerValue.bind(client));
    if (Number.isFinite(when) && Date.now() - when > SEND_MAX_AGE_MS) {
      await mark();
      skipped += 1;
      continue;
    }
    const out = await sendChrisLeadSms({
      name: lead.name,
      phone: lead.phone,
      env,
      dryRun,
      sendImpl,
      ...(now ? { now } : {})
    });
    if (out.sent || dryRun) {
      await mark();
      if (out.sent) sent += 1;
      else skipped += 1;
    } else {
      skipped += 1;
    }
  }

  return { scanned: rows.length, sent, skipped, reason: null };
}
