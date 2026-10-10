// POST /api/ops/notify-owner — one text to Chris, from an agent on the Mac.
//
// WHY. The laptop never holds the real Twilio keys (Netlify keeps them as secrets), so an agent
// on the Mac cannot text Chris itself. Chris asked to be texted when a ship lands (2026-10-09).
// This door lets the live site send that one text for it.
//
// WHO IT CAN TEXT. Only the owner pulse number (PULSE_SMS_TO, the same number as the morning
// text). The caller never names a number. A customer is never reachable from here.
//
// WHO CAN CALL IT. Only a caller holding OPS_NOTIFY_SECRET (32+ characters) in the
// x-ops-notify-secret header. No secret set on the server → 503. Wrong secret → 401.
//
// Body: { "text": "..." } — 1 to 600 characters. The reply names the last 4 digits only.
//
// TEXTING HOURS (owner law 2026-10-09, .claude/rules/texting-hours.md). textMorningBrief holds every text
// outside 6 a.m. to 10 p.m. Arizona time. Then nothing is sent and the answer is 202
// { ok: true, delivery_status: "held_quiet_hours" }: the door worked, the text waits for the caller to send
// it again inside the window. It is not a failure, so it is not a 502.

import crypto from "node:crypto";
import { textMorningBrief } from "../../src/pulse/notify.mjs";
import { HELD } from "../../src/pulse/quiet-hours.mjs";

export const NOTIFY_SECRET_ENV = "OPS_NOTIFY_SECRET";
export const NOTIFY_SECRET_HEADER = "x-ops-notify-secret";
export const MAX_TEXT = 600;

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(String(expected || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export default async function handler(req, res, deps = {}) {
  const env = deps.env || process.env;
  const send = deps.send || textMorningBrief;

  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const expected = String(env[NOTIFY_SECRET_ENV] || "");
  if (expected.length < 32 || expected.startsWith("*")) {
    return res.status(503).json({ ok: false, error: "not_configured" });
  }
  const headers = req.headers || {};
  const given = headers[NOTIFY_SECRET_HEADER] || headers[NOTIFY_SECRET_HEADER.toUpperCase()];
  if (!sameSecret(given, expected)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const text = String((req.body && req.body.text) || "").trim();
  if (!text || text.length > MAX_TEXT) {
    return res.status(400).json({ ok: false, error: "text_required", max: MAX_TEXT });
  }

  const out = await send({ body: text, env, dryRun: false });
  if (out && out.delivery_status === HELD) {
    return res.status(202).json({ ok: true, delivery_status: HELD, sent_to_last4: out.sent_to_last4 ?? null, error: null });
  }
  const sent = out && out.delivery_status === "sent";
  return res.status(sent ? 200 : 502).json({
    ok: sent,
    delivery_status: out ? out.delivery_status : "failed",
    sent_to_last4: out ? out.sent_to_last4 : null,
    error: sent ? null : (out && out.error) || "send failed"
  });
}
