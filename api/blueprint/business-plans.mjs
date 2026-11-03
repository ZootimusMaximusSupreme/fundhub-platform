// Authenticated Blueprint buyer preparation; identity always comes from the session.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { isBlueprintCoachClient } from "../../src/blueprint/coach.mjs";
import { BusinessPlanError, readBusinessPlans, writeBusinessPlans } from "../../src/blueprint/business-plans.mjs";

const SESSION_FIELDS = ["org_id", "orgId", "client_id", "clientId", "accountId", "staffId", "reviewed", "verified"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function requireBlueprintPlanScope(req, res, deps = {}) {
  res.setHeader("cache-control", "private, no-store");
  const database = deps.db || db;
  const principal = await (deps.requirePrincipal || requirePrincipal)(req, res, ["client"], { db: database });
  if (!principal) return null;
  if (principal.kind !== "client" || !UUID.test(principal.orgId || "") || !UUID.test(principal.clientId || "")) { res.status(403).json({ ok: false, error: "forbidden", message: "Sign in with your client account to open your plan." }); return null; }
  const scope = { orgId: principal.orgId, clientId: principal.clientId, now: deps.now ? deps.now() : new Date() };
  const belongs = (await database.query(`SELECT 1 FROM clients WHERE id = $1::uuid AND org_id = $2::uuid`, [scope.clientId, scope.orgId])).rows[0];
  if (!belongs) { res.status(404).json({ ok: false, error: "client_not_found" }); return null; }
  if (!(await (deps.isBlueprintCoachClient || isBlueprintCoachClient)(database, { orgId: scope.orgId, clientId: scope.clientId, asOf: scope.now }))) { res.status(403).json({ ok: false, error: "blueprint_access_inactive", message: "An active Capital Blueprint is needed to open this plan." }); return null; }
  return scope;
}
export default async function handler(req, res, deps = {}) {
  if (!["GET", "POST"].includes(req.method)) { res.setHeader("allow", "GET, POST"); return res.status(405).json({ ok: false, error: "method_not_allowed" }); }
  const database = deps.db || db;
  try {
    const scope = await requireBlueprintPlanScope(req, res, deps); if (!scope) return;
    if (req.method === "GET") return res.status(200).json({ ok: true, ...(await (deps.readBusinessPlans || readBusinessPlans)(database, scope)) });
    const body = req.body;
    if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(400).json({ ok: false, error: "invalid_input" });
    for (const field of SESSION_FIELDS) if (Object.prototype.hasOwnProperty.call(body, field)) return res.status(400).json({ ok: false, error: "field_not_accepted", message: `${field} cannot be changed here.` });
    const { action, ...fields } = body;
    const input = action === "save_business" ? fields.business : fields;
    if (action === "save_business" && Object.keys(fields).some(k => k !== "business")) return res.status(400).json({ ok: false, error: "field_not_accepted" });
    const view = await (deps.writeBusinessPlans || writeBusinessPlans)(database, scope, action, input, { now: scope.now });
    return res.status(200).json({ ok: true, action, ...view });
  } catch (e) {
    if (e instanceof BusinessPlanError) return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
    return res.status(500).json({ ok: false, error: "business_plans_unavailable", message: "Your business plans could not be loaded or saved. Try again." });
  }
}
