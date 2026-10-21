// POST /api/affiliates/payout-account — an affiliate links their own bank for
// payouts through Plaid Link.
//
//   { action: "link_token" }                                   → { link_token, environment }
//   { action: "exchange", public_token, account_id?, institution? } → { account }
//
// WHO. An affiliate session, or a client who is a light affiliate
// (accounts.affiliate_id, 340). The affiliate id comes off the session and never
// from the body, so nobody can link a bank onto somebody else's payouts. Staff
// are refused: the affiliate finishing Plaid Link IS the consent.
//
// Plaid calls: src/affiliates/payout-rail.mjs → src/banking/providers/plaid-http.mjs.
// The access token is encrypted before it is stored and never returned.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { safeError } from "../../src/http/health.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { isUuid, startAffiliateBankLink, completeAffiliateBankLink } from "../../src/affiliates/payout-rail.mjs";

function readBody(raw) {
  if (raw == null) return {};
  if (typeof raw === "string") {
    try { return JSON.parse(raw || "{}"); } catch { return null; }
  }
  return typeof raw === "object" ? raw : null;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const env = deps.env || process.env;

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const gate = deps.requirePrincipal || requirePrincipal;
  const principal = await gate(req, res, ["affiliate", "client"], { db: database, env });
  if (!principal) return;
  const orgId = principal.orgId || null;
  const affiliateId = principal.affiliateId || null;
  if (!orgId || !isUuid(affiliateId)) {
    return res.status(403).json({ ok: false, error: "not_an_affiliate", message: "Your login is not an affiliate yet." });
  }

  const body = readBody(req.body);
  if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  const action = String(body.action || "").trim().toLowerCase();

  try {
    if (action === "link_token") {
      const r = await startAffiliateBankLink({ affiliateId, env, http: deps.plaidHttp || null });
      if (!r.ok) return res.status(r.status).json({ ok: false, error: r.error, message: r.message, missing: r.missing ?? [] });
      return res.status(200).json({ ok: true, link_token: r.linkToken, expiration: r.expiration, environment: r.environment });
    }
    if (action === "exchange") {
      const publicToken = typeof body.public_token === "string" ? body.public_token.trim() : "";
      if (!publicToken) return res.status(400).json({ ok: false, error: "public_token is required" });
      const institution = body.institution && typeof body.institution === "object"
        ? { name: body.institution.name ? String(body.institution.name) : null } : null;
      const r = await completeAffiliateBankLink(database, {
        orgId, affiliateId, publicToken,
        accountId: typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null,
        institution, linkedBy: `${principal.kind}:${principal.accountId || principal.id || affiliateId}`,
        env, plaid: deps.plaid || null
      });
      const { ok, status, ...rest } = r;
      return res.status(status || (ok ? 200 : 400)).json({ ok, ...rest });
    }
    return res.status(400).json({ ok: false, error: "action_required", allowed: ["link_token", "exchange"] });
  } catch (err) {
    if (dbDown(err)) return res.status(503).json({ ok: false, error: "db_unavailable" });
    return res.status(500).json({ ok: false, error: safeError(err) });
  }
}
