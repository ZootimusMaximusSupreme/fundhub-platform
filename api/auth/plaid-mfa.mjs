// POST /api/auth/plaid-mfa — explicit consent for one client bank or
// affiliate payout Link flow. No Plaid Link token is issued here.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { authorizeAccountPlaidLink,
  CONSENT_TEXT, CONSENT_VERSION, PRIVACY_URL } from "../../src/auth/account-plaid-mfa.mjs";

function readBody(raw) {
  if (raw == null) return {};
  if (typeof raw === "object") return raw;
  try { return JSON.parse(String(raw)); } catch { return null; }
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  res.setHeader("Cache-Control", "no-store");
  const database = deps.db || db;
  const env = deps.env || process.env;
  const auth = deps.requirePrincipal || requirePrincipal;
  const principal = await auth(req, res, ["client", "affiliate"],
    { db: database, env });
  if (!principal) return;
  const body = readBody(req.body);
  if (!body || typeof body !== "object") return res.status(400).json({ ok: false, error: "bad_body" });
  const kind = body.target_kind;
  const targetId = kind === "client_bank" && principal.kind === "client"
    ? principal.clientId
    : kind === "affiliate_payout" ? principal.affiliateId : null;
  if (!targetId || !principal.accountId || !principal.orgId || !principal.sessionId) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const identity = { accountId: principal.accountId, orgId: principal.orgId,
    sessionId: principal.sessionId, targetKind: kind, targetId, env };
  if (body.action === "consent_details") return res.status(200).json({
    ok: true, consent_text: CONSENT_TEXT[kind], consent_version: CONSENT_VERSION,
    privacy_url: PRIVACY_URL
  });
  if (body.action === "authorize") {
    const result = await (deps.authorize || authorizeAccountPlaidLink)(database, {
      ...identity, consent: body.consent === true
    });
    return res.status(result.status || (result.ok ? 200 : 400)).json(result);
  }
  return res.status(400).json({ ok: false, error: "action_required" });
}
