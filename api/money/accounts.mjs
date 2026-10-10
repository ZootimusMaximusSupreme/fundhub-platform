// /api/money/accounts — the Accounts page (/app/money-accounts.html).
//
//   GET                                                   → { ok, client_id, containers, unassigned, billing }
//   POST { action: "create_business", name, info? }        new business container + its info
//   POST { action: "save_business",   container_id, info } add or change a business's info
//   POST { action: "create_personal", name }               new personal container
//   POST { action: "rename",          container_id, name }
//   POST { action: "assign",          account_id, container_id }   "Move to…"
//   POST { action: "unassign",        account_id }                  back to "Not sorted yet"
//   POST { action: "add_account",     name, type, last4?, balance?, limit?, due_day?, minimum?, container_id? }
//
// Every POST answers with the whole view again, so the page repaints from one shape.
// The rules live in src/finance/money-accounts.mjs, src/finance/business-info.mjs
// and src/finance/containers.mjs. Nothing here deletes a row.
//
// TWO CALLERS — the same split as api/money/overview.mjs.
//
//   * A signed-in CLIENT (account session) manages ONLY their own file. The
//     client_id comes off the SESSION. A client_id in the query or body is never
//     read on this branch. Every write below also passes that clientId down, so
//     a container or account id belonging to another client answers 404 —
//     exactly like an id that does not exist.
//   * STAFF: ROLE_SETS.FINANCE_OS (its own requireRole call — requireAuth drops a
//     `roles` key, CLAUDE.md §12) + client_id (query on GET, body on POST) +
//     requireClientInOrg. The staff doors api/finance/containers.mjs and
//     api/finance/bank-accounts.mjs are unchanged.
//
// org_id is never read from a request: a body naming org_id is refused.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { dbDown } from "../../src/http/db-down.mjs";
import { BankAccountWriteError } from "../../src/banking/accounts.mjs";
import { createContainer, renameContainer, assignAccount, unassignAccount } from "../../src/finance/containers.mjs";
import { readBusinessInfo, saveBusinessInfo } from "../../src/finance/business-info.mjs";
import { accountsView, readHandAccount, addHandAccount } from "../../src/finance/money-accounts.mjs";

const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* Refused outright rather than ignored: this page stores the last 2-4 digits of
   an account and the last 4 of an EIN, and nothing else. */
const REFUSED_KEYS = [
  "account_number", "accountNumber", "full_account_number",
  "routing_number", "routingNumber", "aba", "iban", "swift", "bic",
  "ssn", "social", "ein", "full_ein", "tax_id"
];

const REASON_STATUS = {
  client_not_found: 404,
  account_not_found: 404,
  container_not_found: 404,
  not_a_business_container: 400,
  container_belongs_to_another_client: 404,
  container_archived: 409
};

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const env = deps.env || process.env;
  const clock = deps.now || (() => new Date());

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return;

  const body = req.method === "POST" && req.body && typeof req.body === "object" ? req.body : {};

  let orgId;
  let clientId;
  let by;
  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    clientId = principal.clientId || null;
    orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      return res.status(403).json({
        ok: false, error: "forbidden", message: "Your login is not attached to a client file."
      });
    }
    if (!(await requireClientInOrg(res, database, { org_id: orgId }, clientId))) return;
    by = { kind: "client", id: principal.accountId ?? null };
  } else {
    const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
    if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return;
    const raw = req.method === "GET" ? req.query && req.query.client_id : body.client_id;
    if (!isUuid(raw)) {
      return res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    }
    clientId = String(raw).trim();
    if (!(await requireClientInOrg(res, database, staff, clientId))) return;
    orgId = staff.org_id;
    by = { kind: "staff", id: staff.id ?? null };
  }

  const view = async () => accountsView(database, { orgId, clientId, env });
  const refuse = (reason) => res.status(REASON_STATUS[reason] ?? 400).json({ ok: false, error: reason });

  try {
    if (req.method === "GET") {
      return res.status(200).json({ ok: true, ...(await view()) });
    }

    for (const field of SESSION_OWNED) {
      if (hasOwn(body, field)) return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
    }
    const info = body.info && typeof body.info === "object" ? body.info : null;
    for (const field of REFUSED_KEYS) {
      if (hasOwn(body, field) || (info && hasOwn(info, field))) {
        return res.status(400).json({
          ok: false, error: `${field}_not_accepted`,
          message: "We store the last 4 digits of an account or an EIN, and nothing else."
        });
      }
    }

    switch (body.action) {
      case "create_business": {
        /* Read the info BEFORE creating the container, so a bad field leaves nothing behind. */
        const parsed = info ? readBusinessInfo(info, { now: clock() }) : null;
        const c = await createContainer(database, { orgId, clientId, kind: "business", name: body.name });
        if (!c.ok) return refuse(c.reason);
        let saved = null;
        if (parsed) {
          saved = await saveBusinessInfo(database, {
            orgId, clientId, containerId: String(c.container.id), info: parsed, fallbackName: c.container.name
          });
          if (!saved.ok) return refuse(saved.reason);
        }
        return res.status(201).json({
          ok: true, action: "create_business", container_id: c.container.id,
          business_id: saved ? saved.business_id : null, ...(await view())
        });
      }
      case "save_business": {
        const parsed = readBusinessInfo(info || {}, { now: clock() });
        const saved = await saveBusinessInfo(database, {
          orgId, clientId, containerId: body.container_id, info: parsed
        });
        if (!saved.ok) return refuse(saved.reason);
        return res.status(200).json({
          ok: true, action: "save_business", container_id: String(body.container_id).trim(),
          business_id: saved.business_id, created: saved.created, ...(await view())
        });
      }
      case "create_personal": {
        const c = await createContainer(database, { orgId, clientId, kind: "personal", name: body.name });
        if (!c.ok) return refuse(c.reason);
        return res.status(201).json({ ok: true, action: "create_personal", container_id: c.container.id, ...(await view()) });
      }
      case "rename": {
        const r = await renameContainer(database, { orgId, clientId, containerId: body.container_id, name: body.name });
        if (!r.ok) return refuse(r.reason);
        return res.status(200).json({ ok: true, action: "rename", container_id: r.container.id, ...(await view()) });
      }
      case "assign": {
        const r = await assignAccount(database, {
          orgId, clientId, accountId: body.account_id, containerId: body.container_id,
          source: by.kind === "client" ? "client_stated" : "staff_reviewed"
        });
        if (!r.ok) return refuse(r.reason);
        return res.status(200).json({
          ok: true, action: "assign", account_id: r.account_id, container_id: r.container_id, ...(await view())
        });
      }
      case "unassign": {
        const r = await unassignAccount(database, { orgId, clientId, accountId: body.account_id });
        if (!r.ok) return refuse(r.reason);
        return res.status(200).json({ ok: true, action: "unassign", account_id: r.account_id, ...(await view()) });
      }
      case "add_account": {
        const input = readHandAccount(body);
        const r = await addHandAccount(database, { orgId, clientId, input, by });
        if (!r.ok) return refuse(r.reason);
        return res.status(201).json({ ok: true, action: "add_account", account_id: r.account_id, ...(await view()) });
      }
      default:
        return res.status(400).json({ ok: false, error: "invalid_action" });
    }
  } catch (e) {
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    if (e instanceof BankAccountWriteError) {
      return res.status(e.status || 400).json({ ok: false, error: String(e.message).slice(0, 200) });
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
