// GET /api/read/blueprint-combined-approval?client_id=<uuid>
//
// Primary Blueprint buyer + optional credit partner: prequal per file and combined sum.

import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { loadCombinedApproval } from "../../src/blueprint/credit-partner.mjs";
import { formatPrequalUsd } from "../../src/http/portal-prequal.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;

  if (req.method && req.method !== "GET") {
    res.setHeader("allow", "GET");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const staff = await requireAuth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;

  const orgId = staff.org_id;
  if (!isUuid(orgId)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const query = req.query || {};
  if (!isUuid(query.client_id)) {
    return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
  }
  const clientId = String(query.client_id).trim();

  try {
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;

    const data = await loadCombinedApproval(database, { orgId: staff.org_id, primaryClientId: clientId });
    if (!data.ok) {
      return res.status(404).json({ ok: false, error: data.error || "not_found" });
    }

    return res.status(200).json({
      ok: true,
      primaryClientId: data.primaryClientId,
      partnerClientId: data.partnerClientId,
      primaryPrequal: data.primaryPrequal,
      partnerPrequal: data.partnerPrequal,
      combinedPrequal: data.combinedPrequal,
      primaryPrequalDisplay: formatPrequalUsd(data.primaryPrequal),
      partnerPrequalDisplay: formatPrequalUsd(data.partnerPrequal),
      combinedPrequalDisplay: formatPrequalUsd(data.combinedPrequal),
      primary: data.primary,
      partner: data.partner
    });
  } catch (err) {
    if (dbDown(res, err)) return;
    throw err;
  }
}
