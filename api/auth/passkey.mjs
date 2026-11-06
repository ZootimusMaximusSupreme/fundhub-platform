// POST-only authenticated bank-action passkeys. No login session is minted here.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { passkeyAction, PASSKEY_ORIGIN } from "../../src/auth/passkey-stepup.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  // Native callers use their explicit bearer; browsers must stay on our origin.
  const origin = req.headers?.origin;
  if (origin && origin !== PASSKEY_ORIGIN) return res.status(403).json({ ok: false, error: "forbidden_origin" });
  const site = req.headers?.["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) return res.status(403).json({ ok: false, error: "forbidden_origin" });
  let body;
  try {
    if (typeof req.body === "string" && req.body.length > 131072) throw new Error("large");
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || JSON.stringify(body).length > 131072) throw new Error("body");
  } catch { return res.status(400).json({ ok: false, error: "bad_body" }); }
  const database = deps.db || db;
  const env = deps.env || process.env;
  let identity;
  if (body.target_kind === "company_bank") {
    const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database, env });
    if (!staff) return;
    if (staff.role !== "owner") return res.status(403).json({ ok: false, error: "forbidden" });
    identity = { orgId: staff.org_id, staffId: staff.id, sessionId: req.session?.id,
      targetKind: "company_bank", targetId: staff.org_id };
  } else if (["client_bank", "affiliate_payout"].includes(body.target_kind)) {
    const principal = await (deps.requirePrincipal || requirePrincipal)(req, res, ["client", "affiliate"], { db: database, env });
    if (!principal) return;
    const targetId = body.target_kind === "client_bank" && principal.kind === "client" && !principal.authorizedRep
      ? principal.clientId : body.target_kind === "affiliate_payout" ? principal.affiliateId : null;
    if (!targetId) return res.status(403).json({ ok: false, error: "forbidden" });
    identity = { orgId: principal.orgId, accountId: principal.accountId, sessionId: principal.sessionId,
      targetKind: body.target_kind, targetId };
  } else return res.status(400).json({ ok: false, error: "bad_target" });
  try {
    const result = await (deps.passkeyAction || passkeyAction)(database, identity, body);
    const { status, ...payload } = result;
    return res.status(status || (result.ok ? 200 : 400)).json(payload);
  } catch (error) {
    if (dbDown(res, error)) return;
    // Never send verifier details, key material or database text to the caller.
    return res.status(503).json({ ok: false, error: "passkey_unavailable" });
  }
}
