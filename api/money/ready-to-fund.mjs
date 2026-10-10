// GET  /api/money/ready-to-fund[?client_id=<uuid>]
// POST /api/money/ready-to-fund   { client_id? }
//
// "Ready to get funded" (FinanceOS wave 5, unit W5). The press runs the Capital
// Blueprint's own closing-prep step — createBlueprintCsmPrepCallTask in
// src/blueprint/closer-ready.mjs — so a CSM reaches out exactly as they do for a
// Blueprint client. The logic lives in src/finance/ready-to-fund.mjs; this file
// gates and answers.
//
// GET answers the current status — none / requested / csm_assigned / done —
// and `offers`: which of the two doors (Capital Blueprint, FinanceOS) this
// client already owns, so FinanceOS can show the Blueprint card and the
// client portal can show the FinanceOS card. POST makes the request (once while
// one is open) and answers the same shape plus `created`.
//
// SAME TWO CALLERS AS api/money/overview.mjs, same gate:
//   * a signed-in CLIENT acts on their own file only. client_id comes off the
//     session; one in the query or body is never read on this branch.
//   * STAFF: requireRole(ROLE_SETS.FINANCE_OS) + requireClientInOrg on client_id.
//     Staff may press it on a client's behalf; the log row says actor 'staff'.
//
// Nothing here texts anyone and nothing moves money.
import { db } from "../../src/db.mjs";
import { requirePrincipal } from "../../src/http/middleware/requirePrincipal.mjs";
import { ROLE_SETS, requireRole, isUuid, CLIENT_DATA_ERRORS } from "../../src/http/read-api.mjs";
import { requireClientInOrg } from "../../src/http/client-scope.mjs";
import { readyToFundStatus, requestReadyToFund, productOffers } from "../../src/finance/ready-to-fund.mjs";
import { readBody } from "../banking/sync-accounts.mjs";
import { dbDown } from "../../src/http/db-down.mjs";

/** Who is asking, and for which file. Same block as api/money/payments.mjs. */
async function scope(req, res, { database, gate, body }) {
  const principal = await gate(req, res, ["staff", "client"], { db: database });
  if (!principal) return null;

  if (principal.kind === "client") {
    /* PINNED TO SELF. Same block as api/money/overview.mjs. */
    const clientId = principal.clientId || null;
    const orgId = principal.orgId || null;
    if (!isUuid(clientId) || !orgId) {
      res.status(403).json({ ok: false, error: "forbidden", message: "Your login is not attached to a client file." });
      return null;
    }
    return { orgId, clientId, kind: "client" };
  }

  const staff = principal.staff || { role: principal.role, org_id: principal.orgId };
  if (!requireRole(res, staff, ROLE_SETS.FINANCE_OS)) return null;
  const qid = body ? body.client_id : req.query && req.query.client_id;
  if (!isUuid(qid)) {
    res.status(400).json({ ok: false, error: "client_id is required and must be a uuid" });
    return null;
  }
  const clientId = String(qid).trim();
  if (!(await requireClientInOrg(res, database, staff, clientId))) return null;
  return { orgId: staff.org_id, clientId, kind: "staff" };
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db || db;
  const gate = deps.requirePrincipal || requirePrincipal;
  const clock = deps.now || (() => new Date());
  const status = deps.readyToFundStatus || readyToFundStatus;
  const request = deps.requestReadyToFund || requestReadyToFund;
  const offersOf = deps.productOffers || productOffers;

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

  const who = await scope(req, res, { database, gate, body });
  if (!who) return;
  const { orgId, clientId } = who;
  const now = clock();

  try {
    const result = method === "GET"
      ? await status(database, { orgId, clientId })
      : await request(database, { orgId, clientId, actor: who.kind, todayIso: now.toISOString().slice(0, 10) });
    if (!result) return res.status(404).json({ ok: false, error: "not_found" });
    const offers = await offersOf(database, { orgId, clientId, asOf: now });
    return res.status(200).json({ ok: true, ...result, offers });
  } catch (e) {
    if (CLIENT_DATA_ERRORS.has(e && e.code)) return res.status(400).json({ ok: false, error: "invalid_parameter" });
    if (dbDown(res, e)) return;
    throw e;
  }
}
