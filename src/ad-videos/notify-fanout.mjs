// The buzz when a finished ad is ready: Chris's phone by TEXT, and the ntfy topic.
//
// WHY THIS EXISTS. The pipeline's notify port was ntfy only. ntfy is a push app;
// Chris asked to be TEXTED the finished video. The number is never written
// down here. AD_VIDEO_SMS_TO is the finished-ad destination. PULSE_SMS_TO stays
// the morning-check number and is only the fallback. The Twilio provider sends.
//
// TRANSMISSION STAYS IN THE PROVIDERS. This module calls two provider send()
// functions and nothing else; there is no fetch in this file (CLAUDE.md §12).
//
// Either channel landing is a success — the point is that a person finds out.
// Both failing is a failure the caller keeps on the row.

import { send as sendNtfy } from "../messaging/providers/ntfy.mjs";
import { send as sendSms } from "../messaging/providers/twilio.mjs";
import { chrisPulseSmsTo, normalizeUsNumber } from "../pulse/notify.mjs";
import { inTextWindow, HELD, HELD_REASON } from "../pulse/quiet-hours.mjs";

export const AD_VIDEO_SMS_TO_ENV = "AD_VIDEO_SMS_TO";

/* Finished-ad texts only. The pulse number is a different phone and must not
   win while this one is set. Empty here falls back to the pulse lookup. */
export function adVideoSmsTo(env = process.env) {
  const raw = String((env && env[AD_VIDEO_SMS_TO_ENV]) || "").trim();
  return normalizeUsNumber(raw) || chrisPulseSmsTo(env);
}

/** The text. Short, and every link on its own line so a phone makes each one tappable. */
export function smsBody(notification = {}) {
  const lines = [String(notification.title || "A Fundhub ad is ready").trim()];
  if (notification.click) lines.push(`Watch: ${notification.click}`);
  for (const a of notification.actions || []) {
    if (a?.url) lines.push(`${a.label || "Open"}: ${a.url}`);
  }
  return lines.join("\n");
}

export async function send(message = {}, options = {}) {
  const env = options.env || process.env;
  const out = { ntfy: null, sms: null };

  /* TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). Both roads ring Chris's own
     phone, so outside 6 a.m. to 10 p.m. Arizona time neither one is used. The answer is not "sent", so
     every caller keeps the buzz for later: the ad pipeline's renotify() tries again inside a day, and the
     marketing buzz queue tries again on a later pass. options.now is the clock (tests); default: now. */
  if (!inTextWindow(options.now || new Date())) {
    console.log(`[ad-video-notify] held: outside 6 a.m. to 10 p.m. Arizona time | sms: not sent | ntfy: not sent`);
    return { ok: false, status: HELD, channels: { ntfy: false, sms: false }, error: HELD_REASON };
  }

  try { out.ntfy = await sendNtfy(message, options); }
  catch (err) { out.ntfy = { ok: false, status: "failed", error: String((err && err.message) || err) }; }

  const to = adVideoSmsTo(env);
  if (to) {
    try {
      out.sms = await sendSms(
        { id: message.id, to, body: smsBody(message.notification), channel: "sms" },
        { env, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, signal: options.signal }
      );
    } catch (err) {
      out.sms = { ok: false, status: "failed", error: String((err && err.message) || err) };
    }
  } else {
    out.sms = { ok: false, status: "skipped", error: "AD_VIDEO_SMS_TO and PULSE_SMS_TO are not set — no text was attempted" };
  }

  const ntfyOk = out.ntfy?.ok === true || out.ntfy?.status === "sent";
  const smsOk = out.sms?.ok === true || out.sms?.status === "sent";
  /* ONE LOG LINE PER CHANNEL. The first real text (2026-09-24 05:45) could not
     be proved from the worker log because nothing here said what each channel
     did; the row only records that at least one of them landed. This line is
     what the log needs so "did the text go" has an answer next time. The
     number is never printed — only its last two digits. */
  console.log(`[ad-video-notify] sms: ${smsOk ? "sent" : `not sent (${out.sms?.error || "?"})`}` +
    `${to ? ` to …${String(to).slice(-2)}` : ""} | ntfy: ${ntfyOk ? "sent" : `not sent (${out.ntfy?.error || "?"})`}`);
  /* WHEN A NUMBER IS SET, THE TEXT IS WHAT COUNTS. Chris asked to be texted.
     Counting the ntfy push as success marked the first finished ad "notified"
     while the text had failed, and nothing ever tried again. With a number
     configured, sent means the text went; ntfy is the second channel. With no
     number, ntfy is all there is. */
  const sent = to ? smsOk : ntfyOk;
  if (sent) {
    return { ok: true, status: "sent", channels: { ntfy: ntfyOk, sms: smsOk },
      error: (to && !ntfyOk) ? `ntfy not sent: ${out.ntfy?.error || "unknown"}` : null };
  }
  return { ok: false, status: "failed", channels: { ntfy: ntfyOk, sms: smsOk },
    error: to
      ? `text not sent: ${out.sms?.error || "unknown"}${ntfyOk ? " (ntfy did send)" : `; ntfy: ${out.ntfy?.error || "failed"}`}`
      : `ntfy: ${out.ntfy?.error || "failed"}; no number set for a text` };
}

export default send;
