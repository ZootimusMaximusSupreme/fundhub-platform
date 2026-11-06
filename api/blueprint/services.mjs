import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isUuid } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import {
  BlueprintServiceError, readBlueprintClientServices, requestBlueprintHelp,
  quoteBlueprintHelp, checkoutBlueprintHelp, requestBlueprintReport, readBlueprintServiceOversight, offerBlueprintHelp
} from "../../src/blueprint/client-services.mjs";

const STAFF_ROLES = new Set(["owner", "admin", "csm"]);
const FIELDS = {
  request_help: ["action", "serviceKind", "targetId", "note", "idempotencyKey"],
  request_report: ["action", "idempotencyKey"],
  quote: ["action", "requestId", "priceCents"],
  checkout: ["action", "requestId", "authorization"],
  offer: ["action", "client_id", "serviceKind", "targetId", "priceCents", "note", "idempotencyKey"]
};

export default async function handler(req, res, deps = {}) {
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }
  const database = deps.db || db;
  try {
    const principal = await (deps.requirePrincipal || requirePrincipal)(req, res, ["staff", "client"], { db: database });
    if (!principal) return;
    let scope;
    if (principal.kind === "client") {
      const access = deps.access || await import("../../src/blueprint/fulfillment-access.mjs");
      scope = await access.requireBlueprintFulfillmentScope(req, res, {
        ...deps, db: database, allowManagedWrites: true, requirePrincipal: async () => principal
      });
      if (!scope) return;
    } else {
      const staff = principal.staff || { id: principal.staffId, role: principal.role, org_id: principal.orgId };
      if (!STAFF_ROLES.has(String(staff.role || "").toLowerCase())) return res.status(403).json({ ok: false, error: "forbidden" });
      if (req.method === "GET" && req.query?.view === "oversight") {
        if (!isUuid(staff.org_id)) return res.status(403).json({ ok: false, error: "forbidden" });
        return res.status(200).json(await (deps.services?.readBlueprintServiceOversight || readBlueprintServiceOversight)(database,
          { orgId: staff.org_id }, { limit: req.query.limit, offset: req.query.offset }));
      }
      const clientId = req.query?.client_id || (req.body?.action === "offer" ? req.body.client_id : null);
      if (!isUuid(clientId)) return res.status(400).json({ ok: false, error: "client_id_required" });
      if (!await (deps.requireClientInOrg || requireClientInOrg)(res, database, staff, clientId)) return;
      const access = deps.access || await import("../../src/blueprint/fulfillment-access.mjs");
      const engagement = await access.getBlueprintFulfillmentAccess(database, { orgId: staff.org_id, clientId });
      if (!engagement) return res.status(404).json({ ok: false, error: "engagement_not_found" });
      scope = { orgId: staff.org_id, clientId, engagement, staffId: staff.id, now: new Date() };
    }
    const services = deps.services || {
      readBlueprintClientServices, requestBlueprintHelp, quoteBlueprintHelp,
      checkoutBlueprintHelp, requestBlueprintReport, offerBlueprintHelp
    };
    if (req.method === "GET") return res.status(200).json(await services.readBlueprintClientServices(database, scope));
    if (scope.engagement.status !== "active") return res.status(409).json({ ok: false, error: "engagement_completed" });
    const input = req.body;
    if (!input || typeof input !== "object" || Array.isArray(input) || !FIELDS[input.action]
      || Object.keys(input).some(key => !FIELDS[input.action].includes(key))) {
      return res.status(400).json({ ok: false, error: "invalid_service_action" });
    }
    if (["quote", "offer"].includes(input.action) !== !!scope.staffId) return res.status(403).json({ ok: false, error: "forbidden" });
    const operation = { request_help: services.requestBlueprintHelp, request_report: services.requestBlueprintReport,
      quote: services.quoteBlueprintHelp, offer: services.offerBlueprintHelp, checkout: services.checkoutBlueprintHelp }[input.action];
    return res.status(200).json(await operation(database, scope, input, deps.serviceDependencies || {}));
  } catch (error) {
    if (error instanceof BlueprintServiceError || error?.name === "SoftPullError") {
      return res.status(error.status || 409).json({ ok: false, error: error.code, message: error.message });
    }
    return res.status(500).json({ ok: false, error: "blueprint_services_unavailable", message: "Your service request could not be loaded. Check its saved status before trying again." });
  }
}
