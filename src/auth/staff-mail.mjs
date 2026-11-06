// Staff credential mail — invite and reset links go out through Resend.
// Fetch lives in src/messaging/providers/resend.mjs. This file only builds
// the words and the destination.

import { send as sendResend } from "../messaging/providers/resend.mjs";

export const APP_ORIGIN = "https://fundhub.ai";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function looksLikeEmail(v) {
  return EMAIL_RE.test(String(v || "").trim());
}

export function inviteMailCopy({ loginEmail, link, expiresAt = null }) {
  return {
    subject: "Your Fundhub login is ready",
    body:
      `Your Fundhub login is ${loginEmail}.\n\n` +
      `Open this link to set your password. ${expiresAt === null ? "The link does not expire" : "The link expires at " + new Date(expiresAt).toUTCString()} and works once.\n\n` +
      `${link}\n\n` +
      `If the link is missing, ask an owner or admin to send a new one.`
  };
}

export function resetMailCopy({ loginEmail, link, expiresAt = null }) {
  return {
    subject: "Reset your Fundhub password",
    body:
      `A password reset was requested for your Fundhub login ${loginEmail}.\n\n` +
      `Open this link to set a new password. ${expiresAt === null ? "The link does not expire" : "The link expires at " + new Date(expiresAt).toUTCString()} and works once.\n\n` +
      `${link}\n\n` +
      `If you did not ask for this, ignore this email.`
  };
}

export function credentialLink(path) {
  return APP_ORIGIN + String(path || "");
}

/** @returns {Promise<{ mailed: boolean, error?: string }>} */
export async function sendStaffCredentialEmail({ to, subject, body, fetchImpl, env } = {}) {
  const dest = String(to || "").trim().toLowerCase();
  if (!looksLikeEmail(dest)) return { mailed: false, error: "no_destination" };
  const out = await sendResend(
    { to: dest, subject, body },
    { fetchImpl, env: env || process.env }
  );
  if (out && out.status === "sent") return { mailed: true };
  return { mailed: false, error: (out && out.error) || "send_failed" };
}
