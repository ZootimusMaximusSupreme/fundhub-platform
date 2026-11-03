// Owner-only Fundhub business bank. Plaid Link and sync only read account data.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  companyBankRead, companyCompleteLink, companyLinkToken, companyPlaidConfig,
  companyRefreshBalance, companySelectAccount, companySync
} from "../../src/finance/company-plaid.mjs";

const OWNER_ONLY = new Set(["owner"]);
export const COMPANY_BANK_CONSENT = "I confirm this is a Fundhub LLC business bank account and authorize read-only access to balances and transactions for company cash tracking.";

function bodyOf(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
function recentMfa(req, now = Date.now()) {
  const at = new Date(req.session?.mfaVerifiedAt || 0).getTime();
  const age = now - at;
  return Number.isFinite(at) && age >= 0 && age <= 15 * 60 * 1000;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, OWNER_ONLY)) return;
  if (!isUuid(staff.org_id) || !isUuid(staff.id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  const env = deps.env || process.env;
  try {
    if (req.method === "GET") {
      const bank = await (deps.read || companyBankRead)(database, { orgId: staff.org_id });
      return res.status(200).json({ ok: true, configured: companyPlaidConfig(env).ready,
        realtime_balance_available: companyPlaidConfig(env).ready &&
          env.OWNER_PLAID_REALTIME_BALANCE_ENABLED === "1", ...bank });
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }
    if (!recentMfa(req, deps.now?.getTime?.() ?? Date.now())) {
      return res.status(403).json({ ok: false, error: "mfa_required" });
    }
    const body = bodyOf(req.body);
    if (!body) return res.status(400).json({ ok: false, error: "body_must_be_json" });
    if (body.action === "link_token") {
      const out = await (deps.linkToken || companyLinkToken)({ orgId: staff.org_id, env,
        provider: deps.provider });
      return res.status(out.ok ? 200 : out.reason === "not_configured" ? 503 : 502).json(out);
    }
    if (body.action === "exchange") {
      if (typeof body.public_token !== "string" || !body.public_token.trim() ||
        typeof body.account_id !== "string" || !body.account_id.trim() ||
        body.confirm_business_account !== true || body.consent !== true) {
        return res.status(400).json({ ok: false, error: "business_account_and_consent_required" });
      }
      const out = await (deps.completeLink || companyCompleteLink)(database, {
        orgId: staff.org_id, staffId: staff.id, publicToken: body.public_token.trim(),
        accountId: body.account_id.trim(), businessConfirmed: true,
        consentText: COMPANY_BANK_CONSENT,
        institutionName: typeof body.institution_name === "string" ? body.institution_name.slice(0, 160) : null,
        env, provider: deps.provider, now: deps.now || new Date()
      });
      return res.status(out.ok ? 200 : out.reason === "not_configured" ? 503 : 400).json(out);
    }
    if (body.action === "select_account") {
      if (!isUuid(body.account_id)) return res.status(400).json({ ok: false, error: "account_id_required" });
      const out = await (deps.selectAccount || companySelectAccount)(database, {
        orgId: staff.org_id, staffId: staff.id, accountId: body.account_id,
        confirmed: body.confirm_business_account, now: deps.now || new Date()
      });
      return res.status(out.ok ? 200 : 400).json(out);
    }
    if (body.action === "sync") {
      if (!isUuid(body.item_id)) return res.status(400).json({ ok: false, error: "item_id_required" });
      const out = await (deps.sync || companySync)(database, {
        orgId: staff.org_id, itemId: body.item_id, env, provider: deps.provider, now: deps.now || new Date()
      });
      return res.status(out.ok ? 200 : out.reason === "not_found" ? 404 : 502).json(out);
    }
    if (body.action === "refresh_balance") {
      if (!isUuid(body.item_id)) return res.status(400).json({ ok: false, error: "item_id_required" });
      const out = await (deps.refreshBalance || companyRefreshBalance)(database, {
        orgId: staff.org_id, itemId: body.item_id, env, provider: deps.provider, now: deps.now || new Date()
      });
      return res.status(out.ok ? 200 : out.reason === "not_configured" ||
        out.reason === "realtime_balance_not_enabled" ? 503 :
        out.reason === "selected_account_not_found" ? 404 : 502).json(out);
    }
    return res.status(400).json({ ok: false, error: "action_required" });
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
