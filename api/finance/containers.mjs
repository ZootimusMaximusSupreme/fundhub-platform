// /api/finance/containers — a client's containers (one per person, one per
// business) with what each holds, plus the billing count.
//
//   GET  ?client_id=<uuid>                              → { ok, client_id, containers, unassigned, billing }
//   POST { action: "create",   client_id, kind, name }   kind: personal | business
//   POST { action: "rename",   container_id, name }
//   POST { action: "assign",   account_id, container_id } bank account → container; entity_kind follows
//   POST { action: "unassign", account_id }               back to no container, entity_kind 'unknown'
//
// Every rule lives in src/finance/containers.mjs. A container is an `entities`
// row (106); api/finance/entities.mjs keeps its archive action — there is no
// delete here.
//
// Gate: ROLE_SETS.FINANCE, the same set api/finance/bank-accounts.mjs uses,
// because assign/unassign write bank_accounts.entity_kind exactly the way that
// file's classify does. Org comes from the session only; a body naming org_id is
// refused. Client ids are checked with requireClientInOrg (404, not 403).
import { db } from "../../src/db.mjs";
import { requireAuth } from "../../src/http/middleware/requireAuth.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import {
  listContainers, createContainer, renameContainer,
  assignAccount, unassignAccount, containerBilling
} from "../../src/finance/containers.mjs";

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

const REASON_STATUS = {
  client_not_found: 404,
  account_not_found: 404,
  container_not_found: 404,
  container_belongs_to_another_client: 400,
  container_archived: 409
};

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const auth = deps.requireAuth || requireAuth;
  const env = deps.env || process.env;

  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return;

  const orgId = staff.org_id ?? null;
  if (!orgId) return res.status(403).json({ ok: false, error: "org_required" });

  const view = async (clientId) => ({
    client_id: clientId,
    ...(await listContainers(database, { orgId, clientId })),
    billing: await containerBilling(database, { orgId, clientId, env })
  });
  const refuse = (reason) => res.status(REASON_STATUS[reason] ?? 400).json({ ok: false, error: reason });

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      const clientId = String(q.client_id).trim();
      if (!(await requireClientInOrg(res, database, staff, clientId))) return;
      return res.status(200).json({ ok: true, ...(await view(clientId)) });
    }

    if (req.method === "POST") {
      const body = req.body && typeof req.body === "object" ? req.body : {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      switch (body.action) {
        case "create": {
          if (!isUuid(body.client_id)) {
            return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
          }
          const clientId = String(body.client_id).trim();
          if (!(await requireClientInOrg(res, database, staff, clientId))) return;
          const r = await createContainer(database, { orgId, clientId, kind: body.kind, name: body.name });
          if (!r.ok) return refuse(r.reason);
          return res.status(201).json({
            ok: true, action: "create", container_id: r.container.id, ...(await view(clientId))
          });
        }
        case "rename": {
          const r = await renameContainer(database, { orgId, containerId: body.container_id, name: body.name });
          if (!r.ok) return refuse(r.reason);
          return res.status(200).json({
            ok: true, action: "rename", container_id: r.container.id, ...(await view(String(r.container.client_id)))
          });
        }
        case "assign": {
          const r = await assignAccount(database, {
            orgId, accountId: body.account_id, containerId: body.container_id
          });
          if (!r.ok) return refuse(r.reason);
          return res.status(200).json({
            ok: true, action: "assign", account_id: r.account_id, container_id: r.container_id,
            kind: r.kind, changed: r.changed, ...(await view(String(r.client_id)))
          });
        }
        case "unassign": {
          const r = await unassignAccount(database, { orgId, accountId: body.account_id });
          if (!r.ok) return refuse(r.reason);
          return res.status(200).json({
            ok: true, action: "unassign", account_id: r.account_id, ...(await view(String(r.client_id)))
          });
        }
        default:
          return res.status(400).json({ ok: false, error: "invalid_action" });
      }
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof TypeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (e && (e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({
        ok: false, error: "rejected_by_a_column_rule",
        message: String(e.constraint || "a database rule") + " refused this value"
      });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
