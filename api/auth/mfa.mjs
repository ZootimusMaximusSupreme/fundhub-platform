// POST /api/auth/mfa — completes a password-authenticated staff MFA challenge.
// The challenge token is not a session and grants no app access.
import { db } from "../../src/db.mjs";
import { beginMfaSetup, verifyMfaChallenge } from "../../src/auth/mfa.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

function clientIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  return typeof forwarded === "string" && forwarded.trim()
    ? forwarded.split(",")[0].trim() : req.socket?.remoteAddress || null;
}

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body)
    ? req.body : {};
  const mfaToken = body.mfa_token;
  if (typeof mfaToken !== "string" || !mfaToken) {
    return res.status(400).json({ ok: false, error: "mfa_token_required" });
  }
  const database = deps.db || db;
  const env = deps.env || process.env;
  try {
    if (body.action === "setup") {
      const result = await (deps.beginSetup || beginMfaSetup)(database, { mfaToken, env });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
      return res.status(200).json({ ok: true, secret: result.secret,
        otpauth_uri: result.otpauth_uri });
    }
    if (body.action === "verify") {
      if (typeof body.code !== "string" || !body.code.trim()) {
        return res.status(400).json({ ok: false, error: "mfa_code_required" });
      }
      const result = await (deps.verifyChallenge || verifyMfaChallenge)(database, {
        mfaToken, code: body.code.trim(), ip: clientIp(req),
        userAgent: req.headers?.["user-agent"] || null, env
      });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
      const maxAge = Math.max(60,
        Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000));
      res.setHeader("Set-Cookie",
        `fundhub_session=${encodeURIComponent(result.token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
      return res.status(200).json({ ok: true, token: result.token,
        expiresAt: result.expiresAt, principal: "staff", staff: result.staff,
        ...(result.recovery_codes ? { recovery_codes: result.recovery_codes } : {}) });
    }
    return res.status(400).json({ ok: false, error: "action_required",
      allowed: ["setup", "verify"] });
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
