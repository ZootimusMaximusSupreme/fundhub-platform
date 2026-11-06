import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { getPropertyReport, orderPropertyReport, propertyStaffAllowed } from "../../src/finance/crs-property.mjs";
import { PropertyReportError } from "../../src/finance/crs-property-contract.mjs";

const PROPERTY_ROLES = new Set(["owner", "admin", "funding_advisor"]);

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  res.setHeader("Cache-Control", "no-store");
  const principal = deps.requirePrincipal
    ? await deps.requirePrincipal(req, res, ["staff"], { db: database })
    : await requirePrincipal(req, res, ["staff"], { db: database });
  if (!principal) return;
  if (!PROPERTY_ROLES.has(String(principal.role || "").toLowerCase()) || !propertyStaffAllowed(principal)) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST"); return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const body = req.method === "GET" ? req.query || {} : req.body || {};
  const allowed = req.method === "GET" ? ["client_id"] : ["client_id", "operation_id", "consent_accepted", "consent_version"];
  if (Object.keys(body).some(k => !allowed.includes(k)) || !isUuid(body.client_id)) {
    return res.status(400).json({ ok: false, error: "invalid_property_request" });
  }
  if (!(await requireClientInOrg(res, database, { org_id: principal.orgId }, body.client_id))) return;
  try {
    const out = req.method === "GET"
      ? await (deps.getPropertyReport || getPropertyReport)(database, principal, { clientId: body.client_id }, deps)
      : await (deps.orderPropertyReport || orderPropertyReport)(database, principal, {
        clientId: body.client_id, operationId: body.operation_id,
        consentAccepted: body.consent_accepted, consentVersion: body.consent_version
      }, deps);
    return res.status(out.status).json(out.body);
  } catch (error) {
    if (error instanceof PropertyReportError) return res.status(error.status).json({ ok: false, error: error.code });
    return res.status(500).json({ ok: false, error: "property_service_unavailable" });
  }
}
