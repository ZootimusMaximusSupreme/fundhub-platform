// Company cash is visible only to Fundhub's owner. It never initiates transfers.
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { isUuid, requireRole } from "../../src/http/read-api.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  cancelCompanyObligation, createCompanyObligation, matchCompanyPayment,
  readCompanyCash, tagCompanyTransaction, updateCompanyObligation
} from "../../src/finance/company-cash.mjs";

const OWNER_ONLY = new Set(["owner"]);
function bodyOf(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch { return null; }
}
export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const staff = await (deps.requireAuth || requireAuth)(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, OWNER_ONLY)) return;
  if (!isUuid(staff.org_id) || !isUuid(staff.id)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  try {
    if (req.method === "GET") {
      const out = await (deps.read || readCompanyCash)(database, { orgId: staff.org_id,
        metaSpend: deps.metaSpend });
      return res.status(200).json({ ok: true, ...out });
    }
    if (req.method !== "POST") {
      res.setHeader("allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }
    const body = bodyOf(req.body);
    if (!body) return res.status(400).json({ ok: false, error: "body_must_be_json" });
    const common = { orgId: staff.org_id, staffId: staff.id };
    let out;
    if (body.action === "create_obligation") {
      out = await (deps.create || createCompanyObligation)(database, { ...common, input: body.obligation || {} });
    } else if (body.action === "update_obligation") {
      if (!isUuid(body.obligation_id)) return res.status(400).json({ ok: false, error: "obligation_id_required" });
      out = await (deps.update || updateCompanyObligation)(database, {
        ...common, obligationId: body.obligation_id, input: body.obligation || {}
      });
    } else if (body.action === "cancel_obligation") {
      if (!isUuid(body.obligation_id)) return res.status(400).json({ ok: false, error: "obligation_id_required" });
      out = await (deps.cancel || cancelCompanyObligation)(database, {
        ...common, obligationId: body.obligation_id
      });
    } else if (body.action === "match_payment") {
      if (!isUuid(body.obligation_id) || !isUuid(body.transaction_id)) {
        return res.status(400).json({ ok: false, error: "obligation_and_transaction_required" });
      }
      out = await (deps.match || matchCompanyPayment)(database, {
        ...common, obligationId: body.obligation_id, transactionId: body.transaction_id
      });
    } else if (body.action === "tag_transaction") {
      if (!isUuid(body.transaction_id)) return res.status(400).json({ ok: false, error: "transaction_id_required" });
      out = await (deps.tag || tagCompanyTransaction)(database, {
        ...common, transactionId: body.transaction_id, category: body.category
      });
    } else return res.status(400).json({ ok: false, error: "action_required" });
    return res.status(out.ok ? 200 : 400).json(out);
  } catch (error) {
    if (dbDown(res, error)) return;
    throw error;
  }
}
