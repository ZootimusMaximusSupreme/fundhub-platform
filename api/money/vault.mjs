// GET  /api/money/vault[?client_id=<uuid>]
// POST /api/money/vault   { action, client_id, ... }          (staff only)
//
// The application document vault (Capital Blueprint unit B3): the papers a lender
// asks to see, what is on file against each, what is missing, and whether the file
// is complete. The logic lives in src/finance/document-vault.mjs; the shape of the
// answer is documented in docs/finance/document-vault.md. This file gates and answers.
//
// SAME TWO CALLERS AND GATE AS api/money/overview.mjs and ready-to-fund.mjs:
//   * a signed-in CLIENT sees their own file and nothing else. client_id comes off
//     the SESSION; one in the query or body is never read on this branch. A client
//     can read the list and upload through the existing upload endpoint
//     (POST /api/documents-upload — each line carries the exact fields to send); a
//     client cannot POST here. Accepting a paper is a person's job.
//   * STAFF: requireRole(ROLE_SETS.FINANCE) + requireClientInOrg on client_id. Staff
//     see the same list plus where each line's rule came from, and may POST:
//
//       accept       { document_id, item_key?, entity_id?, covers?, period_end? }
//       reject       { document_id, reason }                       reason is shown to the client
//       add_item     { title, note?, entity_id?, subtype?, need? }  a line the standard list lacks
//       retire_item  { item_id }                                    take a staff-added line off
//       waive        { item_key, entity_id?, reason }               this line does not apply here
//       unwaive      { item_key, entity_id? }
//
//     Every successful POST answers { ok, result, vault } where `vault` is the fresh
//     read (the same shape as GET), so a screen can redraw without a second call.
//
// A client in another org is 404, not 403. Nothing here texts anyone and nothing
// moves money: the ask is the daily sweeper (src/workflows/document-vault-chase.mjs).
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { baseUrlFromRequest } from "../../src/documents/signed-url.mjs";
import {
  readVault, decideDocument, addCustomItem, retireItem, waiveItem, unwaiveItem, VaultError
} from "../../src/finance/document-vault.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

export const ACTIONS = Object.freeze(["accept", "reject", "add_item", "retire_item", "waive", "unwaive"]);

/** Who is asking, and for which file. Same block as api/money/ready-to-fund.mjs. */
async function scope(req, res, { database, gate, body, method }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    if (method === "POST") {
      res.status(403).json({ ok: false, error: "forbidden", message: "Only staff can change the vault." });
      return null;
    }
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client", staffId: null };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId, id: principal.staffId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff", staffId: principal.staffId || staff.id || null };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const env = deps.env || process.env;
  const read = deps.readVault || readVault;
  const ops = {
    accept: deps.decideDocument || decideDocument,
    add_item: deps.addCustomItem || addCustomItem,
    retire_item: deps.retireItem || retireItem,
    waive: deps.waiveItem || waiveItem,
    unwaive: deps.unwaiveItem || unwaiveItem
  };

  const method = req.method || "GET";
  if (method !== "GET" && method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  }

  let body = null;
  if (method === "POST") {
    body = readBody(req.body);
    if (body === null) return res.status(400).json({ ok: false, error: "body must be JSON" });
  }

  const who = await scope(req, res, { database, gate, body, method });
  if (!who) return;
  const { orgId, clientId } = who;
  const now = clock();
  const sign = { baseUrl: baseUrlFromRequest(req) };
  const view = () => read(database, { orgId, clientId, audience: who.kind, now, env, sign });

  try {
    if (method === "GET") {
      const out = await view();
      if (!out) return res.status(404).json({ ok: false, error: "not_found" });
      return res.status(200).json(out);
    }

    const action = String(body.action || "").trim();
    if (!ACTIONS.includes(action)) {
      return res.status(400).json({ ok: false, error: "unknown_action", message: `action must be one of ${ACTIONS.join(", ")}` });
    }
    const base = { orgId, clientId, staffId: who.staffId };
    let result;
    if (action === "accept") {
      result = await ops.accept(database, {
        ...base, status: "accepted", documentId: body.document_id, itemKey: body.item_key,
        entityId: body.entity_id, covers: body.covers, periodEnd: body.period_end, now, env
      });
    } else if (action === "reject") {
      result = await ops.accept(database, {
        ...base, status: "rejected", documentId: body.document_id, reason: body.reason,
        itemKey: body.item_key, entityId: body.entity_id, now, env
      });
    } else if (action === "add_item") {
      result = await ops.add_item(database, {
        ...base, title: body.title, note: body.note, entityId: body.entity_id,
        subtype: body.subtype, need: body.need
      });
    } else if (action === "retire_item") {
      result = await ops.retire_item(database, { ...base, itemId: body.item_id });
    } else if (action === "waive") {
      result = await ops.waive(database, { ...base, itemKey: body.item_key, entityId: body.entity_id, reason: body.reason });
    } else {
      result = await ops.unwaive(database, { ...base, itemKey: body.item_key, entityId: body.entity_id });
    }
    const out = await view();
    return res.status(200).json({ ok: true, action, result, vault: out });
  } catch (e) {
    if (e instanceof VaultError) {
      return res.status(e.status).json({ ok: false, error: e.code, message: e.message });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
