// POST /api/auth/reset — the public half of password reset. Open, like
// /api/auth/login: no session required, because a locked-out person by
// definition has no session. See api/auth/admin-reset.mjs for the other half,
// which does require one (owner/admin) and is kept in its own file so this
// route's gate — none — stays a single, statically traceable fact rather than
// a branch a journey generator has to guess at.
//
//   { action: "request", email }
//     ALWAYS replies { ok:true }. When the address is a live staff, affiliate,
//     or partner login, Resend sends the reset link to that same address.
//     mailed is true only when Resend accepted the send. The token is never
//     returned here.
//
//   { action: "confirm", token, password }
//     The token IS the credential. Sets the new password and revokes every
//     existing session for that staff member.
//
// Thin mount over src/auth/invite.mjs — all the real logic lives there.

import { db } from "../../src/db.mjs";
import { requestPasswordReset, setPasswordWithToken, RESET_TTL_MS } from "../../src/auth/invite.mjs";
import {
  credentialLink, resetMailCopy, sendStaffCredentialEmail
} from "../../src/auth/staff-mail.mjs";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const body = req.body || {};
  const action = String(body.action || "").trim().toLowerCase();

  if (action === "request") {
    const result = await requestPasswordReset(db, { email: body.email, ttl: RESET_TTL_MS });
    let mailed = false;
    if (result && result.token) {
      const resetPath = "/reset-password.html?token=" + encodeURIComponent(result.token);
      const copy = resetMailCopy({
        loginEmail: String(body.email || "").trim().toLowerCase(),
        link: credentialLink(resetPath),
        expiresAt: result.expiresAt
      });
      const sent = await sendStaffCredentialEmail({ to: body.email, ...copy });
      mailed = sent.mailed;
    }
    return res.status(200).json({
      ok: true,
      mailed,
      message: mailed
        ? "Check that inbox. The reset link lasts 1 hour."
        : "Nothing was sent. Ask an owner or admin for a reset link."
    });
  }

  if (action === "confirm") {
    // Invite links and reset links share this page. Kind is on the token row.
    const result = await setPasswordWithToken(db, { token: body.token, password: body.password });
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error, detail: result.detail });
    }
    return res.status(200).json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: "unknown_action" });
}
