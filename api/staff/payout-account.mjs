// A closer or sales manager links their own payout bank through Plaid.
// No staff member can choose another person's payout destination.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  canLinkStaffPayout, startStaffPayoutLink, completeStaffPayoutLink
} from "../../src/staff/payout-account.mjs";

function readBody(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}

export default async function handler(req, res, deps = {}) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  const env = deps.env || process.env;
  if (!canLinkStaffPayout(staff) || !isUuid(staff.id) || !isUuid(staff.org_id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const body = readBody(req.body);
  if (!body) return res.status(400).json({ ok: false, error: "body must be JSON" });

  try {
    if (body.action === "link_token") {
      const result = await (deps.startLink || startStaffPayoutLink)({ staffId: staff.id, env, http: deps.plaidHttp });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error,
        message: result.message, missing: result.missing ?? [] });
      return res.status(200).json({ ok: true, link_token: result.linkToken,
        expiration: result.expiration, environment: result.environment });
    }
    if (body.action === "exchange") {
      const publicToken = typeof body.public_token === "string" ? body.public_token.trim() : "";
      if (!publicToken) return res.status(400).json({ ok: false, error: "public_token is required" });
      const institution = body.institution && typeof body.institution === "object"
        ? { name: body.institution.name ?? null } : null;
      const result = await (deps.completeLink || completeStaffPayoutLink)(database, {
        orgId: staff.org_id, staffId: staff.id, publicToken,
        accountId: typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null,
        institution, env, plaid: deps.plaid
      });
      if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error,
        message: result.message, choices: result.choices ?? [], missing: result.missing ?? [] });
      return res.status(200).json({ ok: true, account: result.account });
    }
    return res.status(400).json({ ok: false, error: "action_required", allowed: ["link_token", "exchange"] });
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
