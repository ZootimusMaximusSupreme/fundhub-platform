// /api/money/connections[?client_id=<uuid>] — a client's merchant processors.
//
//   GET  → { ok, connections, containers, summary, open_api_url }
//   POST { action: "create",  provider: "commas"|"whop"|"api", entity_id }
//          → { ok, connection, api_key? }   api_key is shown THIS ONCE, never again
//   POST { action: "secret",  connection_id, secret }   (Whop / Commas signing secret)
//          → { ok, connection }
//   POST { action: "disable", connection_id } → { ok, connection }
//
// The client's OWN Commas / Whop / other processor — their sales and payouts in
// their Finance OS. NOT Fundhub's billing.
//
// TWO CALLERS, same gate as api/money/overview.mjs:
//   * a signed-in CLIENT sees and changes their own file only. client_id comes
//     off the session; one in the query or body is never read.
//   * STAFF with ROLE_SETS.FINANCE (owner / admin / sales_manager) name the
//     client with client_id (query on GET, body on POST), and the client must
//     be in their org. A client in another org is 404.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  listConnections, listContainers, createConnection, setWebhookSecret, disableConnection,
  merchantSummary, publicConnection, openApiUrl, MerchantError
} from "../../src/merchant/store.mjs";

function readBody(raw) {
  if (raw === null || raw === undefined || raw === "") return {};
  if (typeof raw === "object") return raw;
  try {
    const p = JSON.parse(String(raw));
    return p && typeof p === "object" ? p : null;
  } catch {
    return null;
  }
}

function baseUrlOf(env) {
  return String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const method = req.method || "GET";

  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  const body = method === "POST" ? readBody(req.body) : {};
  if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });

  let orgId;
  let clientId;
  let who;
  if (principal.kind === "client") {
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      return res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
    }
    who = { kind: "client", id: principal.accountId && isUuid(principal.accountId) ? principal.accountId : null };
  } else {
    const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
    if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;
    const qid = method === "GET" ? req.query && req.query.client_id : body.client_id;
    if (!isUuid(qid)) {
      return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    }
    clientId = String(qid).trim();
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;
    orgId = staff.org_id;
    who = { kind: "staff", id: staff.id && isUuid(staff.id) ? staff.id : null };
  }

  const baseUrl = baseUrlOf(env);
  const show = (row) => publicConnection(row, { baseUrl });

  try {
    if (method === "GET") {
      const rows = await listConnections(database, { orgId, clientId });
      const [containers, summary] = await Promise.all([
        listContainers(database, { orgId, clientId }),
        merchantSummary(database, { orgId, clientId, asOf: clock(), connections: rows })
      ]);
      return res.status(200).json({
        ok: true,
        client_id: clientId,
        as_of: clock().toISOString(),
        connections: rows.map(show),
        containers,
        summary,
        open_api_url: openApiUrl(baseUrl)
      });
    }

    const action = String(body.action || "");
    if (action === "create") {
      const provider = String(body.provider || "");
      if (!isUuid(body.entity_id)) return res.status(400).json({ ok: false, error: "entity_id is required and must be a uuid" });
      const { row, apiKey } = await createConnection(database, {
        orgId, clientId, entityId: String(body.entity_id).trim(), provider,
        createdByKind: who.kind, createdBy: who.id
      });
      res.setHeader("cache-control", "no-store");
      return res.status(201).json({
        ok: true,
        connection: show(row),
        ...(apiKey ? { api_key: apiKey, open_api_url: openApiUrl(baseUrl) } : {})
      });
    }
    if (action === "secret") {
      if (!isUuid(body.connection_id)) return res.status(400).json({ ok: false, error: "connection_id is required and must be a uuid" });
      const row = await setWebhookSecret(database, { orgId, clientId, connectionId: String(body.connection_id).trim(), secret: body.secret, env });
      return res.status(200).json({ ok: true, connection: show(row) });
    }
    if (action === "disable") {
      if (!isUuid(body.connection_id)) return res.status(400).json({ ok: false, error: "connection_id is required and must be a uuid" });
      const row = await disableConnection(database, { orgId, clientId, connectionId: String(body.connection_id).trim() });
      return res.status(200).json({ ok: true, connection: show(row) });
    }
    return res.status(400).json({ ok: false, error: "action must be create, secret or disable" });
  } catch (e) {
    if (e instanceof MerchantError) return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
    if (e && e.code === "NOT_CONFIGURED") return res.status(503).json({ ok: false, error: "not_configured", message: "Webhook secrets cannot be saved yet. The encryption key is not set." });
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
